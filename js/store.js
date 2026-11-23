// TaskerBay data layer: one API, two back ends (Supabase for real use, browser storage for demo mode).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const PK = {
  profiles: ["id"], workspaces: ["id"], workspace_members: ["workspace_id", "user_id"], workspace_invites: ["id"],
  workflows: ["id"], tasks: ["id"], task_updates: ["id"], notifications: ["id"], automations: ["id"],
  routine_items: ["id"], routine_logs: ["item_id", "day"], journal: ["user_id", "day"], focus_sessions: ["id"],
  expenses: ["id"], budgets: ["user_id", "category"],
  chat_messages: ["id"], chat_reads: ["user_id", "workspace_id", "room"]
};
const TABLES = Object.keys(PK);
const WS_TABLES = ["workflows", "tasks", "task_updates", "automations", "workspace_members", "workspace_invites", "chat_messages"];
const USER_TABLES = ["routine_items", "routine_logs", "journal", "focus_sessions", "expenses", "budgets", "notifications", "chat_reads"];

export const S = {
  mode: SUPABASE_URL && SUPABASE_ANON_KEY ? "cloud" : "demo",
  ready: false, user: null, wsId: null, online: true,
  db: Object.fromEntries(TABLES.map(t => [t, []]))
};
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
export const keyOf = (t, r) => PK[t].map(k => r[k]).join("|");

const listeners = new Set();
export const onChange = fn => listeners.add(fn);
let emitTimer = null;
export function emit() { clearTimeout(emitTimer); emitTimer = setTimeout(() => listeners.forEach(f => f()), 16); }

export function localUpsert(t, row) {
  const arr = S.db[t], k = keyOf(t, row);
  const i = arr.findIndex(r => keyOf(t, r) === k);
  if (i >= 0) arr[i] = { ...arr[i], ...row }; else arr.push(row);
}
export function localRemove(t, row) {
  const k = keyOf(t, row);
  S.db[t] = S.db[t].filter(r => keyOf(t, r) !== k);
}

let errorHandler = () => {};
export const onError = fn => { errorHandler = fn; };

/* =================================================================
   Supabase back end
   ================================================================= */
let sb = null, channel = null;
async function sbClient() {
  if (sb) return sb;
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return sb;
}
const since = days => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); };

const cloud = {
  async session() {
    const c = await sbClient();
    const { data } = await c.auth.getSession();
    c.auth.onAuthStateChange((ev, sess) => { if (ev === "SIGNED_OUT") location.reload(); if (ev === "SIGNED_IN" && !S.user && sess) location.reload(); });
    return data.session?.user || null;
  },
  async signIn(email, password) { const c = await sbClient(); const { error } = await c.auth.signInWithPassword({ email, password }); if (error) throw error; },
  async signUp(name, email, password, code) {
    const c = await sbClient();
    const { data, error } = await c.auth.signUp({ email, password, options: { data: { full_name: name, access_code: code }, emailRedirectTo: location.origin + location.pathname } });
    if (error) throw error;
    return !!data.session;
  },
  async magic(email) { const c = await sbClient(); const { error } = await c.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } }); if (error) throw error; },
  async google() { const c = await sbClient(); const { error } = await c.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } }); if (error) throw error; },
  async reset(email) { const c = await sbClient(); const { error } = await c.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); if (error) throw error; },
  async signOut() { const c = await sbClient(); await c.auth.signOut(); },

  async loadAll() {
    const c = await sbClient();
    await c.rpc("accept_my_invites").then(() => {}, () => {});
    const uid = S.user.id;
    const q = (t, fn) => fn(c.from(t).select("*")).then(({ data, error }) => { if (error) throw error; S.db[t] = data || []; });
    await Promise.all([
      q("workspaces", x => x.order("created_at")),
      q("routine_items", x => x.eq("user_id", uid).order("position")),
      q("routine_logs", x => x.eq("user_id", uid).gte("day", since(400))),
      q("journal", x => x.eq("user_id", uid).gte("day", since(400))),
      q("focus_sessions", x => x.eq("user_id", uid).gte("day", since(120))),
      q("expenses", x => x.eq("user_id", uid).gte("date", since(800))),
      q("budgets", x => x.eq("user_id", uid)),
      q("notifications", x => x.eq("user_id", uid).order("created_at", { ascending: false }).limit(150)),
      q("chat_reads", x => x.eq("user_id", uid))
    ]);
  },
  async loadWorkspace(ws) {
    const c = await sbClient();
    const q = (t, fn) => fn(c.from(t).select("*")).then(({ data, error }) => { if (error) throw error; S.db[t] = data || []; });
    await Promise.all([
      q("workflows", x => x.eq("workspace_id", ws).order("position")),
      q("tasks", x => x.eq("workspace_id", ws).or(`completed_at.is.null,completed_at.gte.${since(120)}`)),
      q("task_updates", x => x.eq("workspace_id", ws).order("created_at", { ascending: false }).limit(400)),
      q("automations", x => x.eq("workspace_id", ws).order("created_at")),
      q("workspace_members", x => x.eq("workspace_id", ws)),
      q("workspace_invites", x => x.eq("workspace_id", ws)),
      q("chat_messages", x => x.eq("workspace_id", ws).order("created_at", { ascending: false }).limit(600))
    ]);
    const ids = [...new Set([S.user.id, ...S.db.workspace_members.map(m => m.user_id)])];
    const { data } = await c.from("profiles").select("*").in("id", ids);
    S.db.profiles = data || [];
    this.subscribe(ws);
  },
  subscribe(ws) {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel("tb-" + ws);
    const apply = (t) => (p) => {
      if (p.eventType === "DELETE") localRemove(t, p.old);
      else localUpsert(t, p.new);
      emit();
    };
    WS_TABLES.forEach(t => channel.on("postgres_changes", { event: "*", schema: "public", table: t, filter: `workspace_id=eq.${ws}` }, apply(t)));
    USER_TABLES.forEach(t => channel.on("postgres_changes", { event: "*", schema: "public", table: t, filter: `user_id=eq.${S.user.id}` }, apply(t)));
    // Deletions can't be filtered by Supabase, so listen to them separately (only the row's id is sent)
    [...WS_TABLES, ...USER_TABLES].forEach(t => channel.on("postgres_changes", { event: "DELETE", schema: "public", table: t }, p => {
      if (p.old && PK[t].every(k => p.old[k] != null)) { localRemove(t, p.old); emit(); }
    }));
    channel.subscribe(status => { S.online = status === "SUBSCRIBED"; emit(); });
  },
  async insert(t, row) { const c = await sbClient(); const { error } = await c.from(t).insert(row); if (error) throw error; },
  async upsert(t, row) { const c = await sbClient(); const { error } = await c.from(t).upsert(row); if (error) throw error; },
  async update(t, row, patch) {
    const c = await sbClient(); let q = c.from(t).update(patch);
    PK[t].forEach(k => { q = q.eq(k, row[k]); });
    const { error } = await q; if (error) throw error;
  },
  async remove(t, row) {
    const c = await sbClient(); let q = c.from(t).delete();
    PK[t].forEach(k => { q = q.eq(k, row[k]); });
    const { error } = await q; if (error) throw error;
  },
  async rpc(name, args) { const c = await sbClient(); const { data, error } = await c.rpc(name, args); if (error) throw error; return data; },
  async ai(kind, payload) {
    const c = await sbClient();
    const { data, error } = await c.functions.invoke("ai", { body: { kind, payload } });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data?.result;
  },
  async updateProfile(patch) { await this.update("profiles", { id: S.user.id }, patch); },
  async loadOldDone(ws) { const c = await sbClient(); const out = []; for (let from = 0; ; from += 1000) { const { data, error } = await c.from("tasks").select("*").eq("workspace_id", ws).lt("completed_at", since(120)).order("completed_at", { ascending: false }).range(from, from + 999); if (error) throw error; out.push(...(data || [])); if (!data || data.length < 1000) break; } out.forEach(r => localUpsert("tasks", r)); emit(); return out.length; },
  async taskWorkspace(id) { const c = await sbClient(); const { data } = await c.from("tasks").select("workspace_id").eq("id", id).maybeSingle(); return data?.workspace_id || null; },
  async downloadBackup(fresh) {
    const c = await sbClient(); const { data: { session } } = await c.auth.getSession();
    const r = await fetch(`${SUPABASE_URL}/functions/v1/backup`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}`, apikey: SUPABASE_ANON_KEY }, body: JSON.stringify(fresh ? { action: "now" } : {}) });
    if (!r.ok) { let m = "Couldn't download the backup."; try { m = (await r.json()).error || m; } catch (e) {} throw new Error(m); }
    return { blob: await r.blob(), name: r.headers.get("X-Backup-Name") || `taskerbay-${new Date().toISOString().slice(0, 10)}-now.json` };
  },
  async refresh() { const ws = S.wsId; await this.loadAll(); if (ws && S.db.workspaces.some(w => w.id === ws)) await this.loadWorkspace(ws); emit(); },
  async savePush(sub) { const c = await sbClient(); const { error } = await c.from("push_subscriptions").upsert({ ...sub, user_id: S.user.id }, { onConflict: "endpoint" }); if (error) throw error; },
  async removePush(endpoint) { const c = await sbClient(); await c.from("push_subscriptions").delete().eq("endpoint", endpoint); },
  async myAccess() { const c = await sbClient(); const { data, error } = await c.from("profiles").select("approved, is_admin, full_name").eq("id", S.user.id).maybeSingle(); if (error) throw error; return data || { approved: false, is_admin: false }; },
  async accessRequests() { return this.rpc("access_requests"); },
  async setAccess(target, allow) { return this.rpc("set_access", { target, allow }); },
  async testPush() { const c = await sbClient(); const { data, error } = await c.functions.invoke("push", { body: { test: true } }); if (error) throw error; return data; }
};

/* =================================================================
   Demo back end (browser storage)
   ================================================================= */
const DKEY = "taskerbay.demo.v1";
const dsave = () => { try { localStorage.setItem(DKEY, JSON.stringify(demoDB)); } catch (e) {} };
let demoDB = null;
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plus = n => { const d = new Date(); d.setDate(d.getDate() + n); return dayKey(d); };

export const DEFAULT_WORKFLOWS = [
  { name: "Simple", icon: "✅", is_default: true, position: 0, stages: [{ key: "todo", name: "To do", color: "#64748B", type: "todo" }, { key: "doing", name: "In progress", color: "#3B6FD4", type: "active" }, { key: "waiting", name: "Waiting", color: "#E39B2D", type: "active" }, { key: "done", name: "Done", color: "#2E9B5B", type: "done" }] },
  { name: "Approval", icon: "🖊️", is_default: false, position: 1, stages: [{ key: "draft", name: "Draft", color: "#64748B", type: "todo" }, { key: "review", name: "In review", color: "#8B5CF6", type: "active" }, { key: "approved", name: "Approved", color: "#0E9AA7", type: "active" }, { key: "done", name: "Done", color: "#2E9B5B", type: "done" }] },
  { name: "Payroll cycle", icon: "💰", is_default: false, position: 2, stages: [{ key: "inputs", name: "Collect inputs", color: "#64748B", type: "todo" }, { key: "validate", name: "Validate", color: "#3B6FD4", type: "active" }, { key: "approval", name: "Approval", color: "#8B5CF6", type: "active" }, { key: "bankfile", name: "Bank file", color: "#E39B2D", type: "active" }, { key: "payslips", name: "Payslips", color: "#0E9AA7", type: "active" }, { key: "done", name: "Done", color: "#2E9B5B", type: "done" }] }
];
export const DEFAULT_AUTOMATIONS = [
  { name: "Finish a task when all its steps are done", trigger: "all_steps_done", conditions: {}, actions: [{ type: "set_stage", value: "done" }] },
  { name: "Overdue tasks become High priority and starred", trigger: "overdue", conditions: {}, actions: [{ type: "set_priority", value: "High" }, { type: "star", value: true }] },
  { name: "Tell everyone when something needs review", trigger: "stage_changed", conditions: { to_stage: "review" }, actions: [{ type: "notify", value: "workspace", message: "needs your review" }] }
];
const DEFAULT_ROUTINE = [["Fajr & morning walk", "🌅", "05:30", [0, 1, 2, 3, 4, 5, 6]], ["Plan the day", "🗓️", "08:00", [0, 1, 2, 3, 4, 5, 6]], ["Workout", "💪", "18:30", [0, 1, 2, 3, 4]], ["Arabic practice", "🗣️", "20:00", [0, 1, 2, 3, 4, 5, 6]], ["Read 20 min", "📖", "22:00", [0, 1, 2, 3, 4, 5, 6]]];

function demoSeedWorkspace(db, ws) {
  DEFAULT_WORKFLOWS.forEach(w => db.workflows.push({ id: uuid(), workspace_id: ws, ...JSON.parse(JSON.stringify(w)), created_at: new Date().toISOString() }));
  DEFAULT_AUTOMATIONS.forEach(a => db.automations.push({ id: uuid(), workspace_id: ws, enabled: true, run_count: 0, created_by: db._uid, created_at: new Date().toISOString(), ...JSON.parse(JSON.stringify(a)) }));
}
function cleanSeed(name) {
  const db = Object.fromEntries(TABLES.map(t => [t, []]));
  const me = uuid(), now = new Date().toISOString(), personal = uuid();
  db._uid = me; db._clean = true;
  db.profiles.push({ id: me, full_name: name || "You", email: "", timezone: "Asia/Dubai", created_at: now });
  db.workspaces.push({ id: personal, name: "Personal", icon: "🏠", owner_id: me, created_at: now });
  db.workspace_members.push({ workspace_id: personal, user_id: me, role: "owner" });
  demoSeedWorkspace(db, personal);
  DEFAULT_ROUTINE.forEach(([n, icon, t, days], i) => db.routine_items.push({ id: uuid(), user_id: me, name: n, icon, time_of_day: t, days, position: i, archived: false, created_at: now }));
  return db;
}
function demoSeed() {
  const db = Object.fromEntries(TABLES.map(t => [t, []]));
  const me = uuid(), sara = uuid(), omar = uuid();
  db._uid = me;
  const now = new Date().toISOString();
  db.profiles.push({ id: me, full_name: "You", email: "you@taskerbay.com", timezone: "Asia/Dubai", created_at: now },
    { id: sara, full_name: "Sara (demo)", email: "sara@example.com", created_at: now },
    { id: omar, full_name: "Omar (demo)", email: "omar@example.com", created_at: now });
  const personal = uuid(), team = uuid();
  db.workspaces.push({ id: personal, name: "Personal", icon: "🏠", owner_id: me, created_at: now }, { id: team, name: "HR Team (demo)", icon: "👥", owner_id: me, created_at: now });
  db.workspace_members.push({ workspace_id: personal, user_id: me, role: "owner" }, { workspace_id: team, user_id: me, role: "owner" }, { workspace_id: team, user_id: sara, role: "admin" }, { workspace_id: team, user_id: omar, role: "member" });
  demoSeedWorkspace(db, personal); demoSeedWorkspace(db, team);
  DEFAULT_ROUTINE.forEach(([name, icon, t, days], i) => db.routine_items.push({ id: uuid(), user_id: me, name, icon, time_of_day: t, days, position: i, archived: false, created_at: now }));
  // Sample tasks
  const wf = ws => db.workflows.filter(w => w.workspace_id === ws);
  const simpleP = wf(personal).find(w => w.name === "Simple"), payroll = wf(team).find(w => w.name === "Payroll cycle"), approval = wf(team).find(w => w.name === "Approval"), simpleT = wf(team).find(w => w.name === "Simple");
  let pos = 0;
  const T = (o) => { const t = { id: uuid(), parent_id: null, notes: "", area: "Work", priority: "Medium", due_date: null, due_time: null, start_date: null, estimate_min: null, repeat: "", starred: false, assignee_id: me, created_by: me, position: ++pos, completed_at: null, created_at: now, updated_at: now, ...o }; db.tasks.push(t); return t; };
  const pr = T({ workspace_id: team, workflow_id: payroll.id, stage: "approval", title: "November payroll", priority: "High", due_date: plus(0), due_time: "15:00", starred: true, repeat: "monthly", notes: "Share with approvers, then upload the bank file." });
  T({ workspace_id: team, parent_id: pr.id, workflow_id: simpleT.id, stage: "done", title: "Collect attendance & overtime", completed_at: now });
  T({ workspace_id: team, parent_id: pr.id, workflow_id: simpleT.id, stage: "done", title: "Validate variances vs last month", completed_at: now });
  const appr = T({ workspace_id: team, parent_id: pr.id, workflow_id: simpleT.id, stage: "doing", title: "Get approvals", assignee_id: sara });
  T({ workspace_id: team, parent_id: appr.id, workflow_id: simpleT.id, stage: "done", title: "Send summary to approvers", completed_at: now });
  T({ workspace_id: team, parent_id: appr.id, workflow_id: simpleT.id, stage: "todo", title: "Chase sign-off" });
  T({ workspace_id: team, parent_id: pr.id, workflow_id: simpleT.id, stage: "todo", title: "Upload bank file (WPS)" });
  T({ workspace_id: team, workflow_id: approval.id, stage: "review", title: "Updated leave policy", assignee_id: omar, due_date: plus(2), priority: "Medium" });
  T({ workspace_id: team, workflow_id: simpleT.id, stage: "waiting", title: "Visa renewal documents", due_date: plus(-1), priority: "Low", notes: "Waiting on PRO" });
  T({ workspace_id: personal, workflow_id: simpleP.id, stage: "todo", area: "Personal", title: "Call bank about loan settlement", due_date: plus(1), priority: "High" });
  T({ workspace_id: personal, workflow_id: simpleP.id, stage: "todo", area: "Personal", title: "Book car service", due_date: plus(4) });
  db.task_updates.push({ id: uuid(), workspace_id: team, task_id: pr.id, author_id: sara, kind: "comment", body: "Variances look fine. Sending to approvers now.", created_at: now });
  db.expenses.push({ id: uuid(), user_id: me, title: "Groceries", amount: 240, flow: "out", category: "Food", date: plus(0), paid_by: "Card", note: "", created_at: now },
    { id: uuid(), user_id: me, title: "Taxi", amount: 65, flow: "out", category: "Transport", date: plus(-1), paid_by: "Cash", note: "", created_at: now },
    { id: uuid(), user_id: me, title: "Salary", amount: 18000, flow: "in", category: "Salary", date: plus(-20), paid_by: "Bank transfer", note: "", created_at: now });
  db.budgets.push({ user_id: me, category: "Food", amount: 1500 }, { user_id: me, category: "Transport", amount: 600 });
  return db;
}
function demoLoad() {
  try { demoDB = JSON.parse(localStorage.getItem(DKEY) || "null"); } catch (e) { demoDB = null; }
  if (!demoDB || !demoDB._uid) { demoDB = demoSeed(); dsave(); }
  TABLES.forEach(t => { demoDB[t] = demoDB[t] || []; });
}
const match = (t, row) => r => PK[t].every(k => r[k] === row[k]);
const demo = {
  async session() {
    demoLoad();
    if (localStorage.getItem("taskerbay.demo.signedin") !== "1") return null;
    return { id: demoDB._uid, email: "you@taskerbay.com" };
  },
  async signIn() { localStorage.setItem("taskerbay.demo.signedin", "1"); location.reload(); },
  async startFresh(name, force) { if (!force && demoDB?._clean) { localStorage.setItem("taskerbay.demo.signedin", "1"); location.reload(); return; } demoDB = cleanSeed(name); dsave(); localStorage.setItem("taskerbay.demo.signedin", "1"); location.reload(); },
  isClean() { return !!demoDB?._clean; },
  async signUp(name) { demoLoad(); const p = demoDB.profiles.find(x => x.id === demoDB._uid); if (p && name) p.full_name = name; dsave(); localStorage.setItem("taskerbay.demo.signedin", "1"); location.reload(); return true; },
  async magic() { return this.signIn(); }, async google() { return this.signIn(); }, async reset() {},
  async signOut() { localStorage.removeItem("taskerbay.demo.signedin"); location.reload(); },
  async loadAll() {
    const uid = demoDB._uid;
    S.db.workspaces = demoDB.workspaces.filter(w => demoDB.workspace_members.some(m => m.workspace_id === w.id && m.user_id === uid));
    USER_TABLES.forEach(t => { S.db[t] = demoDB[t].filter(r => r.user_id === uid).map(r => ({ ...r })); });
  },
  async loadWorkspace(ws) {
    WS_TABLES.forEach(t => { S.db[t] = demoDB[t].filter(r => r.workspace_id === ws).map(r => JSON.parse(JSON.stringify(r))); });
    const ids = new Set([demoDB._uid, ...S.db.workspace_members.map(m => m.user_id)]);
    S.db.profiles = demoDB.profiles.filter(p => ids.has(p.id)).map(p => ({ ...p }));
    if (!this._listening) { this._listening = true; addEventListener("storage", e => { if (e.key === DKEY) { demoLoad(); this.loadAll().then(() => this.loadWorkspace(S.wsId)).then(emit); } }); }
  },
  async insert(t, row) { demoDB[t].push(JSON.parse(JSON.stringify(row))); dsave(); },
  async upsert(t, row) { const i = demoDB[t].findIndex(match(t, row)); if (i >= 0) demoDB[t][i] = { ...demoDB[t][i], ...row }; else demoDB[t].push({ ...row }); dsave(); },
  async update(t, row, patch) { demoDB[t].forEach((r, i) => { if (match(t, row)(r)) demoDB[t][i] = { ...r, ...patch }; }); dsave(); },
  async remove(t, row) {
    demoDB[t] = demoDB[t].filter(r => !match(t, row)(r));
    if (t === "tasks") { // cascade like the database does
      const gone = new Set([row.id]); let grew = true;
      while (grew) { grew = false; demoDB.tasks.forEach(x => { if (x.parent_id && gone.has(x.parent_id) && !gone.has(x.id)) { gone.add(x.id); grew = true; } }); }
      demoDB.tasks = demoDB.tasks.filter(x => !gone.has(x.id));
      demoDB.task_updates = demoDB.task_updates.filter(u => !gone.has(u.task_id));
    }
    dsave();
  },
  async rpc(name, args) {
    if (name === "create_workspace") {
      const id = uuid();
      demoDB.workspaces.push({ id, name: args.ws_name, icon: args.ws_icon || "👥", owner_id: demoDB._uid, created_at: new Date().toISOString() });
      demoDB.workspace_members.push({ workspace_id: id, user_id: demoDB._uid, role: "owner" });
      demoSeedWorkspace(demoDB, id); dsave(); return id;
    }
    return null;
  },
  async ai() { throw new Error("AI needs the live version. In demo mode there is no server to talk to Claude."); },
  async updateProfile(patch) { const p = demoDB.profiles.find(x => x.id === demoDB._uid); Object.assign(p, patch); dsave(); }
};

/* =================================================================
   Claude-account back end: when TaskerBay is opened inside claude.ai,
   your data is kept privately in your Claude account and syncs across devices.
   ================================================================= */
let cdb = null, cuser = null, cuid = null, csample = null, cbase = null;
const ALL = Object.fromEntries(TABLES.map(t => [t, []]));
const docId = (t, r) => PK[t].map(k => String(r[k])).join("~");
const plain = o => JSON.parse(JSON.stringify(o));
const WS_SET = new Set(["workflows", "tasks", "task_updates", "automations", "workspace_members", "workspace_invites"]);
function project(t) {
  if (WS_SET.has(t)) S.db[t] = ALL[t].filter(r => r.workspace_id === S.wsId).map(r => ({ ...r }));
  else S.db[t] = ALL[t].map(r => ({ ...r }));
}
async function waitClaude(ms = 2500) {
  const t0 = Date.now();
  while (!(window.claude && typeof window.claude.use === "function") && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 100));
  return !!(window.claude && typeof window.claude.use === "function");
}
async function claudeInit() {
  if (!(await waitClaude())) return false;
  const timeout = new Promise(r => setTimeout(() => r([null, null]), 11000));
  const [db, user] = await Promise.race([Promise.all([window.claude.use("db"), window.claude.use("user")]), timeout]);
  if (!db || !user) return false;
  const id = await user.id().catch(() => null);
  if (!id) return false;
  cdb = db; cuser = user; cuid = id;
  cbase = cdb.doc(`data/users/${id}/taskerbay`);
  window.claude.use("sample").then(x => { csample = x || null; emit(); }).catch(() => {});
  return true;
}
const coll = t => cbase.collection(t);
const cwrite = (t, row) => coll(t).doc(docId(t, row)).set(plain(row));
const AI_PROMPTS = {
  plan_day: p => [true, "default", `You are a calm, practical productivity coach for an HR and payroll professional in Dubai (UAE working week Mon–Fri).
It is now ${p.now}. Today's date key is ${p.today}.
Open tasks assigned to the user (JSON): ${JSON.stringify(p.tasks).slice(0, 20000)}
Today's routine (JSON): ${JSON.stringify(p.routine)}
Focus minutes so far today: ${p.focus_minutes}.
Build a realistic plan for the REST of today, starting from the current time. Respect fixed routine times. Put overdue and high-priority work first, include at least one 25-minute focus block and a short break, and don't overload the day.
Reply with only JSON: {"headline":"max 12 words, specific and encouraging","top3":["task id"],"plan":[{"time":"HH:MM","what":"max 10 words"}],"tip":"one practical sentence"}
top3 holds up to 3 ids copied exactly from the task list. plan has 3 to 7 entries.`],
  breakdown: p => [true, "quick", `Break this task into 3 to 7 small, concrete next steps a busy professional can tick off. Each step starts with a verb and is at most 8 words.
Task: ${JSON.stringify(p.title)}
${p.path?.length ? `It is a step inside: ${JSON.stringify(p.path)}` : ""}
Notes: ${JSON.stringify(p.notes ?? "")}
Steps already listed (don't repeat): ${JSON.stringify(p.existing ?? [])}
Reply with only a JSON array of strings.`],
  capture: p => [true, "quick", `Turn this note into tasks and money entries. Today is ${p.weekday} ${p.today}. Resolve relative dates to YYYY-MM-DD.
People in the workspace: ${JSON.stringify(p.people)}
Note: ${JSON.stringify(p.text)}
Reply with only a JSON array. Each item is either
{"type":"task","title":"short, starts with a verb","due":"YYYY-MM-DD or null","area":"Work|Personal|Projects","priority":"High|Medium|Low","steps":["optional sub-steps"],"assignee":"first name from the people list or null"}
or {"type":"expense","title":"short","amount":number,"flow":"out|in","category":"${(p.categories ?? []).join("|")}","date":"YYYY-MM-DD"}.
Money already spent or received becomes an expense. Use High priority only for urgent items. Put sub-steps in "steps" when the note lists them.`],
  month_insights: p => [false, "default", `You are a friendly personal-finance coach in Dubai. Amounts are in ${p.currency}.
Month ${p.month}: spent ${p.spent}, received ${p.income}.
By category: ${JSON.stringify(p.by_category)}
Monthly budgets: ${JSON.stringify(p.budgets)}
Previous month by category: ${JSON.stringify(p.previous)}
Largest entries: ${JSON.stringify(p.largest)}
Write 3 short bullet points (start each with "• "): where most money went, anything unusual versus last month or budgets, and one specific action for next month. Plain text, under 90 words.`]
};
const claudeApi = {
  hasAI: () => !!csample,
  async session() {
    let me = null; try { me = await cuser.me(); } catch (e) {}
    return { id: cuid, email: me?.email || "", name: me?.name || "" };
  },
  async signIn() {}, async signUp() {}, async magic() {}, async google() {}, async reset() {},
  async signOut() { location.reload(); },
  async loadAll() {
    let wsConfirmed = false;
    const firsts = TABLES.map(t => new Promise(res => {
      let done = false, confirmed = false;
      coll(t).onSnapshot(snap => {
        ALL[t] = snap.docs.map(d => d.data());
        if (S.wsId || !WS_SET.has(t)) project(t);
        if (!snap.metadata.fromCache && !confirmed) { confirmed = true; S.online = true; if (t === "workspaces") wsConfirmed = true; }
        if (!done && (!snap.metadata.fromCache || t !== "workspaces")) { done = true; res(); }
        if (S.ready) emit();
      }, e => { S.online = false; emit(); if (!done) { done = true; res(); } });
    }));
    await Promise.race([Promise.all(firsts), new Promise(r => setTimeout(r, 12000))]);
    if (!ALL.workspaces.length) {
      if (!wsConfirmed) throw new Error("Can't reach your TaskerBay data right now. Check your connection and try again.");
      await this.seed();
    }
    S.db.workspaces = ALL.workspaces.map(w => ({ ...w }));
    USER_TABLES.forEach(project); project("profiles");
  },
  async seed() {
    const me = cuid, now = new Date().toISOString(), ws = uuid();
    let name = ""; try { name = (await cuser.me())?.name || ""; } catch (e) {}
    const db = Object.fromEntries(TABLES.map(t => [t, []])); db._uid = me;
    db.profiles.push({ id: me, full_name: name || "You", email: "", timezone: "Asia/Dubai", created_at: now });
    db.workspaces.push({ id: ws, name: "Personal", icon: "🏠", owner_id: me, created_at: now });
    db.workspace_members.push({ workspace_id: ws, user_id: me, role: "owner" });
    demoSeedWorkspace(db, ws);
    DEFAULT_ROUTINE.forEach(([n, icon, t, days], i) => db.routine_items.push({ id: uuid(), user_id: me, name: n, icon, time_of_day: t, days, position: i, archived: false, created_at: now }));
    for (const t of TABLES) for (const r of db[t]) { ALL[t].push(r); await cwrite(t, r); }
  },
  async loadWorkspace(ws) {
    S.wsId = ws;
    TABLES.forEach(project);
    if (!S.db.profiles.some(p => p.id === cuid)) S.db.profiles.push({ id: cuid, full_name: "You" });
  },
  async insert(t, row) { const i = ALL[t].findIndex(r => docId(t, r) === docId(t, row)); if (i >= 0) ALL[t][i] = row; else ALL[t].push(row); await cwrite(t, row); },
  async upsert(t, row) { const cur = ALL[t].find(r => docId(t, r) === docId(t, row)); await this.insert(t, { ...(cur || {}), ...row }); },
  async update(t, row, patch) { const cur = ALL[t].find(r => docId(t, r) === docId(t, row)) || S.db[t].find(r => docId(t, r) === docId(t, row)) || row; await this.insert(t, { ...cur, ...patch }); },
  async remove(t, row) {
    const ids = [[t, row]];
    if (t === "tasks") {
      const gone = new Set([row.id]); let grew = true;
      while (grew) { grew = false; ALL.tasks.forEach(x => { if (x.parent_id && gone.has(x.parent_id) && !gone.has(x.id)) { gone.add(x.id); grew = true; } }); }
      ALL.tasks.filter(x => gone.has(x.id) && x.id !== row.id).forEach(x => ids.push(["tasks", x]));
      ALL.task_updates.filter(u => gone.has(u.task_id)).forEach(u => ids.push(["task_updates", u]));
    }
    for (const [tt, r] of ids) { ALL[tt] = ALL[tt].filter(x => docId(tt, x) !== docId(tt, r)); await coll(tt).doc(docId(tt, r)).delete(); }
  },
  async rpc(name, args) {
    if (name !== "create_workspace") return null;
    const id = uuid(), now = new Date().toISOString();
    const db = Object.fromEntries(TABLES.map(t => [t, []])); db._uid = cuid;
    db.workspaces.push({ id, name: args.ws_name, icon: args.ws_icon || "👥", owner_id: cuid, created_at: now });
    db.workspace_members.push({ workspace_id: id, user_id: cuid, role: "owner" });
    demoSeedWorkspace(db, id);
    for (const t of TABLES) for (const r of db[t]) await this.insert(t, r);
    return id;
  },
  async ai(kind, payload) {
    if (!csample) throw new Error("Claude isn't available here");
    const build = AI_PROMPTS[kind]; if (!build) throw new Error("Unknown AI request");
    const [json, tier, prompt] = build(payload || {});
    try {
      return json ? await csample.json(prompt, { modelTier: tier, cache: false }) : (await csample(prompt, { modelTier: tier, cache: false })).text.trim();
    } catch (e) {
      const c = e?.code;
      if (["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"].includes(c)) { csample = null; emit(); throw new Error("AI is switched off for this app"); }
      if (c === "rate_limited") throw new Error("Claude is busy or you've hit a usage limit. Try again in a bit");
      if (c === "invalid_json") throw new Error("Claude's answer came back in the wrong shape. Try again");
      throw new Error(e?.message || "Claude didn't answer");
    }
  },
  async updateProfile(patch) { const cur = ALL.profiles.find(p => p.id === cuid) || { id: cuid }; await this.insert("profiles", { ...cur, ...patch }); },
  isClean: () => true
};

export let api = S.mode === "cloud" ? cloud : demo;
// Pick the back end: your own Supabase server if configured, otherwise your Claude account (inside claude.ai), otherwise this device.
export async function initBackend() {
  if (S.mode === "cloud") return;
  if (await claudeInit().catch(() => false)) { S.mode = "claude"; api = claudeApi; }
}

/* =================================================================
   Optimistic writes: change the screen first, then save; undo on failure
   ================================================================= */
const queue = new Map();
function serial(k, fn) {
  const p = (queue.get(k) || Promise.resolve()).then(fn);
  queue.set(k, p.catch(() => {}));
  return p;
}
export async function insert(t, row) {
  localUpsert(t, row); emit();
  try { await serial(t + keyOf(t, row), () => api.insert(t, row)); }
  catch (e) { localRemove(t, row); emit(); errorHandler(e); throw e; }
  return row;
}
export async function upsert(t, row) {
  const before = S.db[t].find(r => keyOf(t, r) === keyOf(t, row));
  localUpsert(t, row); emit();
  try { await serial(t + keyOf(t, row), () => api.upsert(t, row)); }
  catch (e) { if (before) localUpsert(t, before); else localRemove(t, row); emit(); errorHandler(e); throw e; }
}
export async function update(t, row, patch) {
  const before = { ...S.db[t].find(r => keyOf(t, r) === keyOf(t, row)) };
  localUpsert(t, { ...row, ...patch }); emit();
  try { await serial(t + keyOf(t, row), () => api.update(t, row, patch)); }
  catch (e) { localUpsert(t, before); emit(); errorHandler(e); throw e; }
}
export async function remove(t, row) {
  const before = S.db[t].find(r => keyOf(t, r) === keyOf(t, row));
  const removed = [];
  if (t === "tasks") { // remove nested steps from the screen as well
    const gone = new Set([row.id]); let grew = true;
    while (grew) { grew = false; S.db.tasks.forEach(x => { if (x.parent_id && gone.has(x.parent_id) && !gone.has(x.id)) { gone.add(x.id); grew = true; } }); }
    S.db.tasks.filter(x => gone.has(x.id) && x.id !== row.id).forEach(x => removed.push(x));
    S.db.tasks = S.db.tasks.filter(x => !gone.has(x.id) || x.id === row.id);
  }
  localRemove(t, row); emit();
  try { await serial(t + keyOf(t, row), () => api.remove(t, row)); }
  catch (e) { if (before) localUpsert(t, before); removed.forEach(x => localUpsert("tasks", x)); emit(); errorHandler(e); throw e; }
  return [before, ...removed].filter(Boolean);
}
