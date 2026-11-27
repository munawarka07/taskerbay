// TaskerBay account emails, sent from noreply@taskerbay.com through Resend.
//  { action: "activation", target }  admin only: email an approved person their one-time activation link
//  { action: "activation" }          the person themself: send their activation link again
//  { action: "welcome" }             the person themself, right after activating: the welcome email (once)
//  { action: "digest" }              the person themself: send today's digest now (test)
//  { action: "digest-run" } + x-cron-secret   every 15 min: morning digests that are due, and follow-ups on overdue delegated tasks
//  { action: "nudge", task }          a workspace member reminds the task's owner by email now
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SITE = "https://taskerbay.com/";
const FROM = "TaskerBay <noreply@taskerbay.com>";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: string) => String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function layout(title: string, inner: string) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1b1f24;line-height:1.55">
<div style="height:6px;background:#0e7a74;border-radius:6px;margin-bottom:20px"></div>
<h2 style="margin:0 0 12px;font-size:22px">${title}</h2>${inner}
<p style="font-size:12px;color:#5f6b76;border-top:1px solid #e2e5e8;padding-top:12px;margin-top:24px">This is an automated message from TaskerBay. Please don't reply to this email.</p></div>`;
}
const button = (href: string, label: string) => `<p style="margin:22px 0"><a href="${href}" style="background:#0e7a74;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold;display:inline-block">${label}</a></p>`;

async function send(to: string, subject: string, html: string, text: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("Email sending isn't set up yet (RESEND_API_KEY missing).");
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: FROM, to: [to], subject, html, text }) });
  if (!r.ok) throw new Error(`Couldn't send the email (${r.status}): ${(await r.text()).slice(0, 200)}`);
}

async function sendActivation(uid: string) {
  const { data: p } = await db.from("profiles").select("full_name, approved, activated_at, access_until, activation_sent_at").eq("id", uid).maybeSingle();
  if (!p?.approved) throw new Error("This account isn't approved yet.");
  if (p.activated_at) return { already: true };
  if (p.activation_sent_at && Date.now() - new Date(p.activation_sent_at).getTime() < 60e3) throw new Error("An activation email was just sent. Please wait a minute before sending another.");
  const { data: u } = await db.auth.admin.getUserById(uid);
  const email = u?.user?.email; if (!email) throw new Error("No email on this account.");
  const { data: link, error } = await db.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo: SITE } });
  if (error || !link?.properties?.hashed_token) throw new Error(error?.message || "Couldn't create the activation link.");
  const first = (p.full_name || "").split(" ")[0] || "there";
  const trial = p.access_until ? ` Your access is a trial until ${new Date(p.access_until).toLocaleString("en-GB", { timeZone: "Asia/Dubai", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} (Dubai time).` : "";
  // The link only opens a page with an "Activate" button, so email scanners that open links can't use it up.
  const href = `${SITE}?activate=${encodeURIComponent(link.properties.hashed_token)}`;
  await send(email, "Activate your TaskerBay account",
    layout("Your TaskerBay access is approved ✅", `<p>Hi ${esc(first)},</p><p>Good news: your TaskerBay account has been approved.${esc(trial)}</p>
<p>Click the button below, then enter your password to activate your account.</p>${button(href, "Activate my account")}
<p style="font-size:13px;color:#5f6b76">This link works once and expires in 1 hour. If it has expired, sign in at taskerbay.com and tap “Send the activation email again”.</p>`),
    `Hi ${first},\n\nYour TaskerBay account has been approved.${trial}\n\nOpen this link, then enter your password to activate your account:\n${href}\n\nThe link works once and expires in 1 hour. If it has expired, sign in at taskerbay.com and tap "Send the activation email again".\n\nTaskerBay`);
  await db.from("profiles").update({ activation_sent_at: new Date().toISOString() }).eq("id", uid);
  return { sent: true, email };
}

async function sendWelcome(uid: string) {
  const { data: p } = await db.from("profiles").select("full_name, activated_at, welcome_sent_at").eq("id", uid).maybeSingle();
  if (!p?.activated_at) throw new Error("Account not activated yet.");
  if (p.welcome_sent_at) return { already: true };
  // claim first so it can only ever go out once
  const { data: claim } = await db.from("profiles").update({ welcome_sent_at: new Date().toISOString() }).eq("id", uid).is("welcome_sent_at", null).select("id");
  if (!claim?.length) return { already: true };
  const { data: u } = await db.auth.admin.getUserById(uid);
  const email = u?.user?.email; if (!email) return { skipped: true };
  const first = (p.full_name || "").split(" ")[0] || "there";
  try {
    await send(email, "Welcome to TaskerBay 👋",
      layout("Welcome to TaskerBay 👋", `<p>Hi ${esc(first)},</p><p>Your account is active. Welcome to <b>TaskerBay</b>, your private planner for tasks, reminders, routines and team work.</p>
<p>Sign in any time with <b>${esc(email)}</b> and your password.</p>${button(SITE, "Open TaskerBay")}
<p style="margin-bottom:6px"><b>A few tips to get started:</b></p><ul style="padding-left:20px;margin-top:0">
<li>Type a task in plain words, like <i>"call HR tomorrow 10am high priority"</i>, and TaskerBay sets the date, time and reminder for you.</li>
<li>Turn on popups in <b>Settings</b> so you get reminders on your phone and computer.</li>
<li>On iPhone, open taskerbay.com in Safari → Share → <b>Add to Home Screen</b> to use it like an app.</li></ul>
<p>If you forget your password, use <b>"Forgot password?"</b> on the sign-in screen.</p><p>Welcome aboard,<br><b>TaskerBay</b></p>`),
      `Hi ${first},\n\nYour account is active. Welcome to TaskerBay, your private planner for tasks, reminders, routines and team work.\n\nSign in any time at ${SITE} with ${email} and your password.\n\nTips:\n- Type a task in plain words, like "call HR tomorrow 10am high priority".\n- Turn on popups in Settings.\n- On iPhone: Safari > Share > Add to Home Screen.\n\nForgot your password? Use "Forgot password?" on the sign-in screen.\n\nWelcome aboard,\nTaskerBay`);
  } catch (e) { await db.from("profiles").update({ welcome_sent_at: null }).eq("id", uid); throw e; }
  return { sent: true };
}

// ---------- Daily email digest ----------
const localNow = (tz: string) => {
  const o = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short" }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { date: `${o.year}-${o.month}-${o.day}`, hour: +o.hour % 24, dow: o.weekday };
};
const fmtD = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const fmtT = (t: string | null) => { if (!t) return ""; const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };

async function sendDigest(uid: string, force = false) {
  const { data: p } = await db.from("profiles").select("full_name, timezone, email_digest, email_digest_hour, email_digest_sent_on").eq("id", uid).maybeSingle();
  if (!p) return { skipped: "no profile" };
  const { date: today } = localNow(p.timezone || "Asia/Dubai");
  const soon = new Date(Date.parse(today + "T00:00:00Z") + 6 * 864e5).toISOString().slice(0, 10);
  const { data: rows } = await db.from("tasks").select("title, due_date, due_time, priority, assignee_id, created_by, workspace_id")
    .is("completed_at", null).is("parent_id", null).not("due_date", "is", null).lte("due_date", soon)
    .or(`assignee_id.eq.${uid},and(assignee_id.is.null,created_by.eq.${uid})`).order("due_date").order("due_time", { nullsFirst: false }).limit(200);
  const all: any[] = rows || [];
  const overdue = all.filter(t => t.due_date < today), todays = all.filter(t => t.due_date === today), next = all.filter(t => t.due_date > today).slice(0, 8);
  const { data: owned } = await db.from("fund_projects").select("id, name").eq("owner_id", uid);
  let waiting = 0;
  if (owned?.length) { const { count } = await db.from("fund_entries").select("id", { count: "exact", head: true }).eq("status", "pending").in("project_id", owned.map((f: any) => f.id)); waiting = count || 0; }
  const { count: unread } = await db.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("read", false);
  if (!force && !overdue.length && !todays.length && !waiting) { await db.from("profiles").update({ email_digest_sent_on: today }).eq("id", uid); return { skipped: "nothing due" }; }
  const { data: u } = await db.auth.admin.getUserById(uid); const email = u?.user?.email; if (!email) return { skipped: "no email" };
  const first = (p.full_name || "").split(" ")[0] || "there";
  const pr = (t: any) => t.priority === "high" ? ` <span style="color:#c0392b;font-weight:bold">!</span>` : "";
  const li = (t: any, showDate: boolean) => `<li style="margin:4px 0">${esc(t.title)}${pr(t)} <span style="color:#5f6b76">${showDate ? fmtD(t.due_date) + " " : ""}${fmtT(t.due_time)}</span></li>`;
  const sec = (title: string, list: any[], showDate: boolean, color: string) => list.length ? `<h3 style="font-size:15px;margin:18px 0 6px;color:${color}">${title} (${list.length})</h3><ul style="padding-left:20px;margin:0">${list.slice(0, 15).map(t => li(t, showDate)).join("")}</ul>${list.length > 15 ? `<p style="color:#5f6b76;font-size:13px">…and ${list.length - 15} more</p>` : ""}` : "";
  const txt = (title: string, list: any[], showDate: boolean) => list.length ? `\n${title} (${list.length}):\n` + list.slice(0, 15).map(t => `- ${t.title}${t.priority === "high" ? " !" : ""} ${showDate ? fmtD(t.due_date) + " " : ""}${fmtT(t.due_time)}`).join("\n") + "\n" : "";
  const extra = [waiting ? `💰 ${waiting} fund entr${waiting === 1 ? "y is" : "ies are"} waiting for your approval.` : "", unread ? `🔔 ${unread} unread update${unread === 1 ? "" : "s"} in your inbox.` : ""].filter(Boolean);
  const subj = `Your day: ${todays.length} due today${overdue.length ? `, ${overdue.length} overdue` : ""}`;
  await send(email, subj,
    layout(`Good morning, ${esc(first)} ☀️`, `<p style="color:#5f6b76;margin-top:0">${fmtD(today)}</p>
${todays.length || overdue.length ? "" : "<p>Nothing is due today. A good day to get ahead.</p>"}
${sec("Overdue", overdue, true, "#c0392b")}${sec("Due today", todays, false, "#0e7a74")}${sec("Coming up this week", next, true, "#1b1f24")}
${extra.length ? `<p style="margin-top:18px">${extra.join("<br>")}</p>` : ""}${button(SITE + "#today", "Open TaskerBay")}
<p style="font-size:12px;color:#5f6b76">You get this because the daily email is on in TaskerBay Settings. You can turn it off there.</p>`),
    `Good morning ${first},\n${fmtD(today)}\n${txt("Overdue", overdue, true)}${txt("Due today", todays, false)}${txt("Coming up this week", next, true)}\n${extra.join("\n")}\n\nOpen TaskerBay: ${SITE}\n\nTurn this email off in TaskerBay Settings.`);
  await db.from("profiles").update({ email_digest_sent_on: today }).eq("id", uid);
  return { sent: true, email };
}
async function runDigests() {
  const { data: people } = await db.from("profiles").select("id, timezone, email_digest, email_digest_hour, email_digest_sent_on, approved, activated_at, is_admin, access_until").neq("email_digest", "off").eq("approved", true);
  let sent = 0;
  for (const p of (people || []) as any[]) {
    if (!p.is_admin && (!p.activated_at || (p.access_until && new Date(p.access_until) <= new Date()))) continue;
    const n = localNow(p.timezone || "Asia/Dubai");
    if (p.email_digest_sent_on === n.date || n.hour < p.email_digest_hour || n.hour > p.email_digest_hour + 3) continue;
    if (p.email_digest === "weekdays" && (n.dow === "Sat" || n.dow === "Sun")) continue;
    try { const r: any = await sendDigest(p.id); if (r.sent) sent++; } catch (e) { console.error("digest", p.id, (e as Error).message); }
  }
  return { sent };
}

// ---------- Follow-ups on delegated tasks ----------
const canUse = (p: any) => p && p.approved && (p.is_admin || (p.activated_at && (!p.access_until || new Date(p.access_until) > new Date())));
async function chaseOne(t: any, fromId: string | null, manual: boolean) {
  const { data: who } = await db.from("profiles").select("id, full_name, approved, is_admin, activated_at, access_until").in("id", [t.assignee_id, fromId || t.created_by]);
  const owner = (who || []).find((p: any) => p.id === t.assignee_id), from = (who || []).find((p: any) => p.id === (fromId || t.created_by));
  if (!canUse(owner)) return { skipped: "owner has no access" };
  const { data: u } = await db.auth.admin.getUserById(t.assignee_id); const email = u?.user?.email; if (!email) return { skipped: "no email" };
  const first = (owner.full_name || "").split(" ")[0] || "there", fromName = from?.full_name || "Your team";
  const due = t.due_date ? fmtD(t.due_date) + (t.due_time ? " " + fmtT(t.due_time) : "") : "";
  const url = `${SITE}#task=${t.id}&ws=${t.workspace_id}`;
  const lead = manual ? `${esc(fromName)} sent you a reminder about this task.` : `This task assigned by ${esc(fromName)} is overdue.`;
  await send(email, `${manual ? "Reminder" : "Overdue"}: ${t.title}`,
    layout(`⏰ ${esc(t.title)}`, `<p>Hi ${esc(first)},</p><p>${lead}</p><p style="background:#f4f6f7;border-radius:10px;padding:12px 14px"><b>${esc(t.title)}</b>${due ? `<br><span style="color:#c0392b">Due ${esc(due)}</span>` : ""}${t.status_note ? `<br><span style="color:#5f6b76">Last update: ${esc(t.status_note)}</span>` : ""}</p><p>Please update it or mark it done in TaskerBay.</p>${button(url, "Open the task")}`),
    `Hi ${first},\n\n${manual ? `${fromName} sent you a reminder about this task.` : `This task assigned by ${fromName} is overdue.`}\n\n${t.title}${due ? `\nDue ${due}` : ""}\n\nOpen it: ${url}\n\nTaskerBay`);
  await db.from("tasks").update({ chased_at: new Date().toISOString(), chase_count: (t.chase_count || 0) + 1 }).eq("id", t.id);
  await db.from("notifications").insert({ user_id: t.assignee_id, workspace_id: t.workspace_id, task_id: t.id, actor_id: fromId || t.created_by, body: `⏰ ${manual ? `${fromName} reminded you` : "Overdue"}: “${t.title}”` });
  return { sent: true, email };
}
async function runChases() {
  const n = localNow("Asia/Dubai");
  if (n.hour < 9 || n.hour >= 18 || n.dow === "Sat" || n.dow === "Sun") return { chased: 0 };
  const dayAgo = new Date(Date.now() - 22 * 36e5).toISOString();
  const twoWeeks = new Date(Date.parse(n.date + "T00:00:00Z") - 14 * 864e5).toISOString().slice(0, 10); // older ones were already chased or are stale
  const { data: rows } = await db.from("tasks").select("id, title, due_date, due_time, assignee_id, created_by, workspace_id, chase_count, chased_at, status_note")
    .is("completed_at", null).not("assignee_id", "is", null).not("created_by", "is", null).lt("due_date", n.date).gte("due_date", twoWeeks).lt("chase_count", 3)
    .or(`chased_at.is.null,chased_at.lt.${dayAgo}`).limit(100);
  let chased = 0;
  for (const t of (rows || []) as any[]) {
    if (t.assignee_id === t.created_by) continue;
    try { const r: any = await chaseOne(t, null, false); if (r.sent) chased++; else await db.from("tasks").update({ chased_at: new Date().toISOString() }).eq("id", t.id); } catch (e) { console.error("chase", t.id, (e as Error).message); }
  }
  return { chased };
}
async function nudge(uid: string, taskId: string) {
  const { data: t } = await db.from("tasks").select("id, title, due_date, due_time, assignee_id, created_by, workspace_id, chase_count, chased_at, status_note, completed_at").eq("id", taskId).maybeSingle();
  if (!t) throw new Error("Task not found.");
  const { data: mem } = await db.from("workspace_members").select("user_id").eq("workspace_id", t.workspace_id).eq("user_id", uid).maybeSingle();
  if (!mem) throw new Error("You're not in this workspace.");
  if (!t.assignee_id || t.assignee_id === uid) throw new Error("This task isn't assigned to someone else.");
  if (t.completed_at) throw new Error("This task is already done.");
  if (t.chased_at && Date.now() - new Date(t.chased_at).getTime() < 60 * 60e3) throw new Error("A reminder was sent less than an hour ago.");
  return await chaseOne(t, uid, true);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const body0 = await req.clone().json().catch(() => ({}));
    if (body0.action === "digest-run") {
      const { data: cfg } = await db.rpc("push_config");
      if (!cfg || req.headers.get("x-cron-secret") !== cfg.cron) return json({ error: "forbidden" }, 403);
      const d = await runDigests(); const c = await runChases().catch(e => ({ chaseError: (e as Error).message }));
      return json({ ...d, ...c });
    }
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await db.auth.getUser(token);
    if (!u?.user) return json({ error: "Please sign in again." }, 401);
    const body = await req.json().catch(() => ({}));
    if (body.action === "activation") {
      if (body.target && body.target !== u.user.id) {
        const { data: isAdmin } = await db.rpc("is_site_admin", { uid: u.user.id });
        if (!isAdmin) return json({ error: "Only the admin can do that." }, 403);
        return json(await sendActivation(body.target));
      }
      return json(await sendActivation(u.user.id));
    }
    if (body.action === "digest") return json(await sendDigest(u.user.id, true));
    if (body.action === "nudge") return json(await nudge(u.user.id, String(body.target || "")));
    if (body.action === "welcome") return json(await sendWelcome(u.user.id));
    return json({ error: "Unknown action" }, 400);
  } catch (e) { return json({ error: (e as Error).message }, 400); }
});
