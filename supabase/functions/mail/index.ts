// TaskerBay account emails, sent from noreply@taskerbay.com through Resend.
//  { action: "activation", target }  admin only: email an approved person their one-time activation link
//  { action: "activation" }          the person themself: send their activation link again
//  { action: "welcome" }             the person themself, right after activating: the welcome email (once)
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
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
    if (body.action === "welcome") return json(await sendWelcome(u.user.id));
    return json({ error: "Unknown action" }, 400);
  } catch (e) { return json({ error: (e as Error).message }, 400); }
});
