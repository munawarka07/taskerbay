// TaskerBay "email to task": Resend calls this webhook when mail arrives at task-<code>@taskerbay.com.
// Checks the webhook signature, finds whose private address it was, and only accepts mail sent FROM that
// person's own TaskerBay email. Attachments are never read or stored. The subject becomes the task title and
// the first part of the text goes into the notes.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const ok = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

async function verify(req: Request, body: string) {
  const secret = Deno.env.get("RESEND_WEBHOOK_SECRET"); if (!secret) return false;
  const id = req.headers.get("svix-id"), ts = req.headers.get("svix-timestamp"), sig = req.headers.get("svix-signature");
  if (!id || !ts || !sig || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(secret.replace(/^whsec_/, "")), c => c.charCodeAt(0)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  const expect = btoa(String.fromCharCode(...mac));
  return sig.split(" ").some(s => s.split(",")[1] === expect);
}
const addr = (s: string) => (String(s || "").match(/<([^>]+)>/)?.[1] || String(s || "")).trim().toLowerCase();

Deno.serve(async (req) => {
  if (req.method !== "POST") return ok({ error: "POST only" }, 405);
  const body = await req.text();
  if (!(await verify(req, body))) return ok({ error: "bad signature" }, 401);
  const ev = JSON.parse(body || "{}");
  if (ev.type !== "email.received") return ok({ ignored: ev.type });
  const d = ev.data || {};
  const tos: string[] = [...(d.to || []), ...(d.cc || [])].map(addr);
  const tok = tos.map(t => t.match(/^task-([a-z0-9]{10})@taskerbay\.com$/)?.[1]).find(Boolean);
  if (!tok) return ok({ ignored: "not a task address" });
  const { data: own } = await db.rpc("inbox_owner", { tok });
  const o = Array.isArray(own) ? own[0] : own;
  if (!o?.user_id || !o.ws) return ok({ ignored: "unknown address" });
  if (addr(d.from) !== String(o.email).toLowerCase()) return ok({ ignored: "not from the owner" });
  // full message (text only)
  let text = "", subject = String(d.subject || "");
  const key = Deno.env.get("RESEND_FULL_API_KEY");
  if (key && d.email_id) {
    const r = await fetch(`https://api.resend.com/emails/receiving/${d.email_id}`, { headers: { Authorization: `Bearer ${key}` } });
    if (r.ok) { const m = await r.json(); subject = m.subject || subject; text = String(m.text || "").trim() || String(m.html || "").replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim(); }
  }
  const title = subject.replace(/^\s*((re|fw|fwd|aw|wg)\s*:\s*)+/i, "").trim().slice(0, 300) || "Task from email";
  text = text.replace(/\n{3,}/g, "\n\n").split(/\n-- \n|\nOn .{5,80} wrote:\n|\n-{2,}\s*Original Message/)[0].slice(0, 3000);
  const now = new Date().toISOString();
  const { data: wf } = await db.from("workflows").select("id, stages, is_default").eq("workspace_id", o.ws).order("position");
  const def = (wf || []).find((w: any) => w.is_default) || (wf || [])[0];
  const stage = def?.stages?.[0]?.key || "todo";
  const { data: t, error } = await db.from("tasks").insert({ workspace_id: o.ws, title, notes: text ? `From email:\n${text}` : "From email", area: "Work", priority: "Medium", created_by: o.user_id, assignee_id: o.user_id, workflow_id: def?.id || null, stage, position: Date.now(), created_at: now, updated_at: now }).select("id").single();
  if (error) return ok({ error: error.message }, 500);
  await db.from("notifications").insert({ user_id: o.user_id, workspace_id: o.ws, task_id: t.id, body: `📧 Added from your email: “${title}”` });
  return ok({ created: t.id });
});
