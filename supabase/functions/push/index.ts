// TaskerBay push sender. Called instantly by database triggers (new alerts, tasks due soon),
// every 20 seconds by pg_cron, and on demand for a test popup.
// Sends: 9 AM morning summary (in each person's own timezone), a popup at each task's due time
// (plus an earlier heads-up if chosen on the task), routine reminders at their time, and new Inbox items.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SITE = "https://taskerbay.com/";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info" } });

type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };
type Msg = { title: string; body: string; url?: string; tag?: string };

function localNow(tz: string) {
  let parts: Record<string, string> = {};
  try {
    parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(new Date()).map(p => [p.type, p.value]));
  } catch { return localNow("Asia/Dubai"); }
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { day: `${parts.year}-${parts.month}-${parts.day}`, min: (+parts.hour % 24) * 60 + +parts.minute, dow };
}
const toMin = (t: string | null) => { if (!t) return null; const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const dayNum = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5;
const plusDays = (d: string, n: number) => new Date((dayNum(d) + n) * 864e5).toISOString().slice(0, 10);
// minutes from "now" (in the person's own time zone) until a task is due
const minsUntil = (now: { day: string; min: number }, date: string, time: string) => (dayNum(date) - dayNum(now.day)) * 1440 + toMin(time)! - now.min;
function reminderMsg(t: { id: string; title: string; due_time: string; due_date: string; workspace_id: string }, left: number, today: string) {
  const when = left <= 0 ? "⏰ Due now" : left < 60 ? `Due in ${left} min` : left < 1440 && t.due_date === today ? `Due in ${Math.round(left / 60)} h` : "Due tomorrow";
  return { title: when, body: `${t.title} · ${t.due_date === today ? "" : t.due_date === plusDays(today, 1) ? "tomorrow " : t.due_date + " "}${fmt(t.due_time)}`, url: `${SITE}#task=${t.id}&ws=${t.workspace_id}`, tag: `task-${t.id}` };
}
// "early": the heads-up chosen on the task (e.g. 1 hour before); "due": the popup at the due time itself
function whichAlert(t: { remind_before: number; reminded_at: string | null; due_alerted_at: string | null }, left: number) {
  if (t.remind_before < 0) return null;
  if (left <= 0 && left >= -60 && !t.due_alerted_at) return "due";
  if (t.remind_before > 0 && left > 0 && left <= t.remind_before && !t.reminded_at) return "early";
  return null;
}
const fmt = (t: string) => { const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };

async function sendTo(subs: Sub[], msg: Msg) {
  let ok = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ url: SITE, ...msg }), { TTL: 3600, urgency: "high" });
      ok++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
      else console.error("push failed", code, (e as Error).message);
    }
  }
  return ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({});
  const { data: cfg, error: cfgErr } = await db.rpc("push_config");
  if (cfgErr || !cfg) return json({ error: "not configured" }, 500);
  webpush.setVapidDetails("mailto:munawarka07@gmail.com", cfg.pub, cfg.priv);

  // A signed-in person asking for a test popup on their own devices
  const authz = req.headers.get("authorization") || "";
  if (req.headers.get("x-cron-secret") !== cfg.cron) {
    const token = authz.replace(/^Bearer\s+/i, "");
    const { data: u } = await db.auth.getUser(token);
    if (!u?.user) return json({ error: "unauthorized" }, 401);
    const { data: subs } = await db.from("push_subscriptions").select("*").eq("user_id", u.user.id);
    const n = await sendTo(subs || [], { title: "TaskerBay popups are on ✅", body: "You'll get a 9 AM summary, reminders before tasks are due, and team updates.", tag: "test" });
    return json({ sent: n, devices: subs?.length || 0 });
  }

  const reqBody = await req.json().catch(() => ({}));
  const inboxUrl = (n: { task_id: string | null; body: string; workspace_id?: string | null }) => { const w = n.workspace_id ? `&ws=${n.workspace_id}` : ""; return n.task_id ? `${SITE}#task=${n.task_id}${w}` : /^New sign-up request/.test(n.body) ? `${SITE}#settings` : /^💬/.test(n.body) ? `${SITE}#chat${w}` : `${SITE}#inbox${w}`; };
  const inboxTitle = (body: string) => /^New sign-up request/.test(body) ? "👤 New sign-up request" : "TaskerBay";

  // Instant: one Inbox alert, called by the database the moment it is created
  if (reqBody.notification_id) {
    const { data: n } = await db.from("notifications").select("id, user_id, body, task_id, workspace_id, read, pushed_at").eq("id", reqBody.notification_id).maybeSingle();
    if (!n || n.read || n.pushed_at) return json({ skipped: true });
    const { data: subs } = await db.from("push_subscriptions").select("*").eq("user_id", n.user_id);
    if (!subs?.length) return json({ devices: 0 });
    // claim it first so the every-minute run can't send it a second time
    const { data: mine } = await db.from("notifications").update({ pushed_at: new Date().toISOString() }).eq("id", n.id).is("pushed_at", null).select("id");
    if (!mine?.length) return json({ skipped: true });
    const sent = await sendTo(subs, { title: inboxTitle(n.body), body: n.body, url: inboxUrl(n), tag: `n-${n.id}` });
    if (!sent) await db.from("notifications").update({ pushed_at: null }).eq("id", n.id);
    return json({ sent });
  }

  // Instant: a task saved with a time in the next 15 minutes
  if (reqBody.task_id) {
    const { data: t } = await db.from("tasks").select("id, title, due_date, due_time, reminded_at, due_alerted_at, completed_at, assignee_id, created_by, workspace_id, remind_before").eq("id", reqBody.task_id).maybeSingle();
    if (!t || t.completed_at || !t.due_time || !t.due_date || t.remind_before < 0) return json({ skipped: true });
    const uid = t.assignee_id || t.created_by; if (!uid) return json({ skipped: true });
    const { data: p } = await db.from("profiles").select("timezone").eq("id", uid).maybeSingle();
    const now = localNow(p?.timezone || "Asia/Dubai"), left = minsUntil(now, t.due_date, t.due_time);
    const kind = whichAlert(t, left); if (!kind) return json({ later: true });
    const { data: subs } = await db.from("push_subscriptions").select("*").eq("user_id", uid);
    if (!subs?.length) return json({ devices: 0 });
    const col = kind === "due" ? "due_alerted_at" : "reminded_at";
    const { data: claim } = await db.from("tasks").update({ [col]: new Date().toISOString() }).eq("id", t.id).is(col, null).select("id");
    if (!claim?.length) return json({ skipped: true });
    const sent = await sendTo(subs, reminderMsg(t, kind === "due" ? Math.min(left, 0) : left, now.day));
    return json({ sent });
  }

  // Scheduled run (every minute): morning summary, reminders as their time arrives, anything missed above
  const { data: subs } = await db.from("push_subscriptions").select("*");
  if (!subs?.length) return json({ users: 0 });
  const byUser = new Map<string, Sub[]>();
  subs.forEach(s => byUser.set(s.user_id, [...(byUser.get(s.user_id) || []), s]));
  const users = [...byUser.keys()];
  const { data: profiles } = await db.from("profiles").select("id, full_name, timezone, last_digest_on").in("id", users);
  const stats = { digests: 0, tasks: 0, routines: 0, inbox: 0 };

  for (const p of profiles || []) {
    const mine = byUser.get(p.id)!; const now = localNow(p.timezone || "Asia/Dubai");
    const first = (p.full_name || "").split(" ")[0];

    // Open tasks that belong to this person
    const { data: tasks } = await db.from("tasks").select("id, title, due_date, due_time, reminded_at, due_alerted_at, assignee_id, created_by, workspace_id, remind_before")
      .is("completed_at", null).not("due_date", "is", null).lte("due_date", plusDays(now.day, 2))
      .or(`assignee_id.eq.${p.id},and(assignee_id.is.null,created_by.eq.${p.id})`);
    const list = tasks || [];

    // 1) Morning summary at 9 AM local time
    if (now.min >= 540 && now.min < 600 && p.last_digest_on !== now.day) {
      const due = list.filter(t => t.due_date === now.day), late = list.filter(t => t.due_date < now.day);
      const tomorrow = list.filter(t => t.due_date === plusDays(now.day, 1)).length;
      const { data: rItems } = await db.from("routine_items").select("id, days").eq("user_id", p.id).eq("archived", false);
      const todays = (rItems || []).filter(r => (r.days || []).includes(now.dow));
      const timed = due.filter(t => t.due_time).sort((a, b) => a.due_time.localeCompare(b.due_time));
      const bits = [`${due.length} due today`]; if (late.length) bits.push(`${late.length} overdue`); if (todays.length) bits.push(`${todays.length} routines`); if (tomorrow) bits.push(`${tomorrow} tomorrow`);
      const next = timed[0] ? ` First: ${timed[0].title} at ${fmt(timed[0].due_time)}.` : due[0] ? ` Start with: ${due[0].title}.` : " Plan your day in TaskerBay.";
      if (await sendTo(mine, { title: `Good morning${first ? ", " + first : ""} ☀️`, body: bits.join(" · ") + "." + next, tag: "digest" })) {
        await db.from("profiles").update({ last_digest_on: now.day }).eq("id", p.id); stats.digests++;
      }
    }

    // 2) Task reminders: at each task's chosen time before it's due (and up to an hour after, if missed)
    for (const t of list) {
      if (!t.due_time || t.remind_before < 0) continue;
      const left = minsUntil(now, t.due_date, t.due_time), kind = whichAlert(t, left);
      if (!kind) continue;
      const col = kind === "due" ? "due_alerted_at" : "reminded_at";
      const { data: claim } = await db.from("tasks").update({ [col]: new Date().toISOString() }).eq("id", t.id).is(col, null).select("id");
      if (!claim?.length) continue;
      await sendTo(mine, reminderMsg(t, kind === "due" ? Math.min(left, 0) : left, now.day)); stats.tasks++;
    }

    // 3) Routine reminders at their time, if not yet done today
    const { data: routines } = await db.from("routine_items").select("id, name, icon, time_of_day, days, last_reminded_on").eq("user_id", p.id).eq("archived", false).not("time_of_day", "is", null);
    for (const r of routines || []) {
      const rm = toMin(r.time_of_day); if (rm === null || r.last_reminded_on === now.day || !(r.days || []).includes(now.dow)) continue;
      if (now.min >= rm && now.min < rm + 30) {
        const { count } = await db.from("routine_logs").select("item_id", { count: "exact", head: true }).eq("item_id", r.id).eq("day", now.day);
        if (!count) { await sendTo(mine, { title: `${r.icon} ${r.name}`, body: "Time for your routine. Tap to tick it off.", url: `${SITE}#routine`, tag: `routine-${r.id}` }); stats.routines++; }
        await db.from("routine_items").update({ last_reminded_on: now.day }).eq("id", r.id);
      }
    }

    // 4) New Inbox items (assignments, comments, automations)
    const { data: notes } = await db.from("notifications").select("id, body, task_id, workspace_id").eq("user_id", p.id).is("pushed_at", null).eq("read", false)
      .gte("created_at", new Date(Date.now() - 6 * 3600e3).toISOString()).order("created_at").limit(5);
    if (notes?.length) {
      const { data: claimed } = await db.from("notifications").update({ pushed_at: new Date().toISOString() }).in("id", notes.map(n => n.id)).is("pushed_at", null).select("id");
      const ok = new Set((claimed || []).map(c => c.id));
      for (const n of notes) { if (!ok.has(n.id)) continue; await sendTo(mine, { title: inboxTitle(n.body), body: n.body, url: inboxUrl(n), tag: `n-${n.id}` }); stats.inbox++; }
    }
  }
  return json(stats);
});
