// TaskerBay push sender. Runs every 5 minutes (pg_cron) and on demand for a test popup.
// Sends: 9 AM morning summary (in each person's own timezone), task reminders 15 min before
// the due time, routine reminders at their time, and new Inbox items.
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

  // Scheduled run
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
    const { data: tasks } = await db.from("tasks").select("id, title, due_date, due_time, reminded_at, assignee_id, created_by")
      .is("completed_at", null).not("due_date", "is", null).lte("due_date", now.day)
      .or(`assignee_id.eq.${p.id},and(assignee_id.is.null,created_by.eq.${p.id})`);
    const list = tasks || [];

    // 1) Morning summary at 9 AM local time
    if (now.min >= 540 && now.min < 600 && p.last_digest_on !== now.day) {
      const due = list.filter(t => t.due_date === now.day), late = list.filter(t => t.due_date < now.day);
      const { data: rItems } = await db.from("routine_items").select("id, days").eq("user_id", p.id).eq("archived", false);
      const todays = (rItems || []).filter(r => (r.days || []).includes(now.dow));
      const timed = due.filter(t => t.due_time).sort((a, b) => a.due_time.localeCompare(b.due_time));
      const bits = [`${due.length} due today`]; if (late.length) bits.push(`${late.length} overdue`); if (todays.length) bits.push(`${todays.length} routines`);
      const next = timed[0] ? ` First: ${timed[0].title} at ${fmt(timed[0].due_time)}.` : due[0] ? ` Start with: ${due[0].title}.` : " Plan your day in TaskerBay.";
      if (await sendTo(mine, { title: `Good morning${first ? ", " + first : ""} ☀️`, body: bits.join(" · ") + "." + next, tag: "digest" })) {
        await db.from("profiles").update({ last_digest_on: now.day }).eq("id", p.id); stats.digests++;
      }
    }

    // 2) Task reminders: 15 minutes before the due time (and up to an hour after, if missed)
    for (const t of list) {
      const dm = toMin(t.due_time); if (dm === null || t.reminded_at || t.due_date !== now.day) continue;
      if (now.min >= dm - 15 && now.min <= dm + 60) {
        const left = dm - now.min;
        await sendTo(mine, { title: left > 0 ? `Due in ${left} min` : "Due now", body: `${t.title} · ${fmt(t.due_time)}`, url: `${SITE}#task=${t.id}`, tag: `task-${t.id}` });
        await db.from("tasks").update({ reminded_at: new Date().toISOString() }).eq("id", t.id); stats.tasks++;
      }
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
    const { data: notes } = await db.from("notifications").select("id, body, task_id").eq("user_id", p.id).is("pushed_at", null).eq("read", false)
      .gte("created_at", new Date(Date.now() - 6 * 3600e3).toISOString()).order("created_at").limit(5);
    for (const n of notes || []) {
      await sendTo(mine, { title: "TaskerBay", body: n.body, url: n.task_id ? `${SITE}#task=${n.task_id}` : `${SITE}#inbox`, tag: `n-${n.id}` });
      stats.inbox++;
    }
    if (notes?.length) await db.from("notifications").update({ pushed_at: new Date().toISOString() }).in("id", notes.map(n => n.id));
  }
  return json(stats);
});
