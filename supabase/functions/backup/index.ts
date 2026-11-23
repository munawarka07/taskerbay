// TaskerBay daily backup. Saves every table as one JSON file in the private "backups" storage bucket
// (no public or app-user access), keeps the last 30 days. The admin can download the latest copy.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const TABLES = ["profiles", "workspaces", "workspace_members", "workspace_invites", "workflows", "tasks", "task_updates",
  "automations", "routine_items", "routine_logs", "journal", "focus_sessions", "expenses", "budgets", "chat_messages", "chat_reads", "notifications"];
const KEEP_DAYS = 30;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function dumpAll() {
  const out: Record<string, unknown[]> = {};
  for (const t of TABLES) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(t).select("*").range(from, from + 999);
      if (error) throw new Error(`${t}: ${error.message}`);
      rows.push(...(data || [])); if (!data || data.length < 1000) break;
    }
    out[t] = rows;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const { data: cfg } = await db.rpc("push_config");
  const fromCron = cfg && req.headers.get("x-cron-secret") === cfg.cron;

  if (!fromCron) {
    // The admin asking to download the latest backup (or make one now)
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await db.auth.getUser(token);
    if (!u?.user) return json({ error: "unauthorized" }, 401);
    const { data: isAdmin } = await db.rpc("is_site_admin", { uid: u.user.id });
    if (!isAdmin) return json({ error: "Only the admin can download backups" }, 403);
    const body = await req.json().catch(() => ({}));
    if (body.action === "now") {
      const data = await dumpAll();
      return new Response(JSON.stringify({ app: "TaskerBay", made_at: new Date().toISOString(), tables: data }), { headers: { ...cors, "Content-Type": "application/json" } });
    }
    const { data: files } = await db.storage.from("backups").list("", { limit: 100, sortBy: { column: "name", order: "desc" } });
    const latest = (files || []).find(f => f.name.endsWith(".json"));
    if (!latest) return json({ error: "No backup yet. The first one runs tonight." }, 404);
    const { data: blob, error } = await db.storage.from("backups").download(latest.name);
    if (error || !blob) return json({ error: "Couldn't read the backup" }, 500);
    return new Response(blob, { headers: { ...cors, "Content-Type": "application/json", "X-Backup-Name": latest.name, "Access-Control-Expose-Headers": "X-Backup-Name" } });
  }

  // Nightly run
  const data = await dumpAll();
  const name = `taskerbay-${new Date().toISOString().slice(0, 10)}.json`;
  const payload = JSON.stringify({ app: "TaskerBay", made_at: new Date().toISOString(), tables: data });
  const { error } = await db.storage.from("backups").upload(name, new Blob([payload], { type: "application/json" }), { upsert: true, contentType: "application/json" });
  if (error) return json({ error: error.message }, 500);
  const { data: files } = await db.storage.from("backups").list("", { limit: 200 });
  const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  const old = (files || []).map(f => f.name).filter(n => /^taskerbay-\d{4}-\d{2}-\d{2}\.json$/.test(n) && n.slice(10, 20) < cutoff);
  if (old.length) await db.storage.from("backups").remove(old);
  return json({ saved: name, bytes: payload.length, rows: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])), removed: old.length });
});
