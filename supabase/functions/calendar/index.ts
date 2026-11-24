// TaskerBay calendar feed: reads each person's published Outlook / Microsoft 365 calendar (ICS link)
// and saves their meetings (7 days back to 60 days ahead) so they show in Today, Planner and Free time.
// One way only: nothing is ever written to Outlook. Runs every 10 minutes from pg_cron, or on "Sync now".
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { parseICS } from "./ics.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const ALLOWED = /^(outlook\.office365\.com|outlook\.office\.com|outlook\.live\.com|outlook\.office365\.us|outlook\.office\.de|calendar\.google\.com)$/i;

async function syncOne(f: { user_id: string; url: string; tz: string }) {
  try {
    const u = new URL(f.url);
    if (u.protocol !== "https:" || !ALLOWED.test(u.hostname)) throw new Error("Not an Outlook calendar link");
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 20000);
    const r = await fetch(u, { headers: { "User-Agent": "TaskerBay calendar sync", Accept: "text/calendar, */*" }, redirect: "follow", signal: ctl.signal });
    clearTimeout(timer);
    if (!r.ok) throw new Error(r.status === 404 || r.status === 410 ? "Outlook says this link no longer exists. It may have been reset or unpublished. Paste the new link." : `Outlook answered ${r.status}`);
    const text = await r.text();
    if (text.length > 15_000_000) throw new Error("Calendar is too large");
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("That link didn't return a calendar. Use the ICS link (ends with .ics), not the HTML one.");
    const events = parseICS(text, { tz: f.tz, from: Date.now() - 7 * 864e5, to: Date.now() + 60 * 864e5 }).slice(0, 3000);
    const { error } = await db.rpc("calendar_save", { target_user: f.user_id, events, err: null });
    if (error) throw new Error(error.message);
    return { ok: true, n: events.length };
  } catch (e) {
    const msg = (e as Error).name === "AbortError" ? "Outlook took too long to answer" : (e as Error).message;
    await db.rpc("calendar_save", { target_user: f.user_id, events: [], err: msg });
    return { ok: false, error: msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const { data: cfg } = await db.rpc("push_config");
  if (cfg && req.headers.get("x-cron-secret") === cfg.cron) {
    const { data: feeds } = await db.rpc("calendar_feeds_for_sync", { only_user: null });
    const results = [];
    for (const f of feeds || []) results.push(await syncOne(f));
    return json({ feeds: results.length, ok: results.filter(r => r.ok).length });
  }
  // a signed-in person pressing "Sync now"
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await db.auth.getUser(token);
  if (!u?.user) return json({ error: "unauthorized" }, 401);
  const { data: feeds } = await db.rpc("calendar_feeds_for_sync", { only_user: u.user.id });
  if (!feeds?.length) return json({ error: "No calendar connected" }, 404);
  return json(await syncOne(feeds[0]));
});
