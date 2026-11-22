// TaskerBay workflow & automation engine.
// Every task change goes through here so the same rules apply on every device:
// activity log, completion stamps, recurring tasks, notifications, step roll-up and your own automations.
import { S, uuid, insert, update, remove, emit } from "./store.js";

export const dkey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const parseKey = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/* ---------- Workflow helpers ---------- */
export const workflows = () => [...S.db.workflows].sort((a, b) => a.position - b.position);
export const defaultWorkflow = () => workflows().find(w => w.is_default) || workflows()[0] || null;
export const FALLBACK_STAGES = [{ key: "todo", name: "To do", color: "#64748B", type: "todo" }, { key: "doing", name: "In progress", color: "#3B6FD4", type: "active" }, { key: "done", name: "Done", color: "#2E9B5B", type: "done" }];
export function workflowOf(t) { return S.db.workflows.find(w => w.id === t.workflow_id) || defaultWorkflow(); }
export function stagesOf(t) { return workflowOf(t)?.stages || FALLBACK_STAGES; }
export function stageOf(t) { const st = stagesOf(t); return st.find(s => s.key === t.stage) || st[0]; }
export const isDone = t => stageOf(t)?.type === "done";
export const firstStage = wf => (wf?.stages || FALLBACK_STAGES)[0].key;
export const doneStage = wf => ((wf?.stages || FALLBACK_STAGES).find(s => s.type === "done") || (wf?.stages || FALLBACK_STAGES).slice(-1)[0]).key;
export function nextStageKey(t) {
  const st = stagesOf(t); const i = st.findIndex(s => s.key === t.stage);
  return st[Math.min(st.length - 1, i + 1)].key;
}
export const childrenOf = id => S.db.tasks.filter(t => t.parent_id === id).sort((a, b) => a.position - b.position);
export function descendants(id) { const out = []; const walk = p => childrenOf(p).forEach(c => { out.push(c); walk(c.id); }); walk(id); return out; }
export function progressOf(id) { const all = descendants(id); if (!all.length) return null; const done = all.filter(isDone).length; return { done, total: all.length, pct: done / all.length }; }
export function pathOf(t) { const p = []; let cur = t; while (cur?.parent_id) { cur = S.db.tasks.find(x => x.id === cur.parent_id); if (cur) p.unshift(cur); } return p; }

export function dueStatus(t) {
  if (isDone(t)) return "done";
  if (!t.due_date) return "none";
  const d = Math.round((parseKey(t.due_date) - parseKey(dkey())) / 864e5);
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  if (d <= 7) return "week";
  return "later";
}

const me = () => S.user?.id;
const nameOf = id => S.db.profiles.find(p => p.id === id)?.full_name || "Someone";

/* ---------- Notifications & updates ---------- */
async function notify(userId, task, body) {
  if (!userId || userId === me()) return;
  if (!S.db.workspace_members.some(m => m.user_id === userId)) return;
  const n = { id: uuid(), user_id: userId, workspace_id: task.workspace_id, task_id: task.id, actor_id: me(), body, read: false, created_at: new Date().toISOString() };
  // Notifications for other people are not in our local list; write straight through.
  try { const { api } = await import("./store.js"); await api.insert("notifications", n); } catch (e) {}
}
export async function postUpdate(task, body, kind = "comment", extra = {}) {
  const u = { id: uuid(), workspace_id: task.workspace_id, task_id: task.id, author_id: me(), kind, body, created_at: new Date().toISOString(), ...extra };
  await insert("task_updates", u);
  if (kind === "comment") {
    const who = new Set([task.assignee_id, task.created_by]);
    who.forEach(uid => notify(uid, task, `${nameOf(me())} posted an update on “${task.title}”: ${body.slice(0, 120)}`));
  }
  return u;
}

/* ---------- Create / change / delete ---------- */
let posSeq = 0;
export async function createTask(fields, depth = 0) {
  const wf = S.db.workflows.find(w => w.id === fields.workflow_id) || (fields.parent_id ? defaultWorkflow() : defaultWorkflow());
  const t = {
    id: uuid(), workspace_id: S.wsId, parent_id: null, workflow_id: wf?.id || null, stage: firstStage(wf), title: "", notes: "",
    area: "Personal", priority: "Medium", due_date: null, due_time: null, start_date: null, estimate_min: null, repeat: "",
    starred: false, assignee_id: me(), created_by: me(), position: Date.now() + (++posSeq) / 1000, completed_at: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...fields
  };
  if (!t.workflow_id && wf) t.workflow_id = wf.id;
  await insert("tasks", t);
  if (t.assignee_id && t.assignee_id !== me()) notify(t.assignee_id, t, `${nameOf(me())} assigned you “${t.title}”`);
  await runAutomations("task_created", t, {}, depth);
  return t;
}

export async function changeTask(task, patch, depth = 0, opts = {}) {
  const before = S.db.tasks.find(x => x.id === task.id) || task;
  const after = { ...before, ...patch };
  const stageChanged = patch.stage !== undefined && patch.stage !== before.stage;
  if (patch.workflow_id && patch.workflow_id !== before.workflow_id && patch.stage === undefined) {
    // keep the stage meaningful in the new workflow
    const wf = S.db.workflows.find(w => w.id === patch.workflow_id);
    const was = stageOf(before);
    const same = wf?.stages.find(s => s.type === was.type);
    patch.stage = after.stage = same ? same.key : firstStage(wf);
  }
  const nowDone = isDone(after), wasDone = isDone(before);
  if (nowDone && !wasDone) patch.completed_at = after.completed_at = new Date().toISOString();
  if (!nowDone && wasDone) patch.completed_at = after.completed_at = null;
  await update("tasks", before, patch);

  if (stageChanged || (nowDone !== wasDone)) {
    const from = stageOf(before), to = stageOf(after);
    if (!opts.silent) await postUpdate(after, `${nameOf(me())} moved this from ${from.name} to ${to.name}`, "status", { from_stage: before.stage, to_stage: after.stage });
    [after.assignee_id, after.created_by].forEach(uid => notify(uid, after, `${nameOf(me())} moved “${after.title}” to ${to.name}`));
    if (nowDone && !wasDone) {
      if (after.repeat) await spawnNext(after);
      if (after.parent_id && !opts.noRollup) await checkParent(after.parent_id, depth);
    }
    await runAutomations("stage_changed", after, { from: before, to_type: to.type }, depth);
  }
  if (patch.assignee_id !== undefined && patch.assignee_id !== before.assignee_id && patch.assignee_id) {
    notify(patch.assignee_id, after, `${nameOf(me())} assigned you “${after.title}”`);
    await runAutomations("assigned", after, {}, depth);
  }
  return after;
}

export async function completeTask(task) {
  const wf = workflowOf(task);
  const kids = descendants(task.id).filter(k => !isDone(k));
  for (const k of kids) await changeTask(k, { stage: doneStage(workflowOf(k)) }, 1, { silent: true, noRollup: true });
  return changeTask(task, { stage: doneStage(wf) });
}
export async function reopenTask(task) { return changeTask(task, { stage: firstStage(workflowOf(task)) }); }

export async function deleteTask(task) { return remove("tasks", task); }

function nextDate(t) {
  const base = t.due_date ? parseKey(t.due_date) : new Date();
  const today = parseKey(dkey());
  let d = base < today ? today : base;
  if (t.repeat === "daily") d = addDays(d, 1);
  else if (t.repeat === "weekdays") { do { d = addDays(d, 1); } while (d.getDay() === 0 || d.getDay() === 6); } // UAE working week: Mon–Fri
  else if (t.repeat === "weekly") d = addDays(d, 7);
  else if (t.repeat === "monthly") { d = new Date(d); d.setMonth(d.getMonth() + 1); }
  return dkey(d);
}
async function spawnNext(t) {
  const wf = workflowOf(t);
  const copy = await createTask({ title: t.title, notes: t.notes, area: t.area, priority: t.priority, due_date: nextDate(t), due_time: t.due_time, repeat: t.repeat, workflow_id: t.workflow_id, stage: firstStage(wf), assignee_id: t.assignee_id, parent_id: t.parent_id, estimate_min: t.estimate_min }, 2);
  // copy the step structure, reset
  const cloneKids = async (fromId, toId) => {
    for (const k of childrenOf(fromId)) {
      const n = await createTask({ title: k.title, notes: k.notes, area: k.area, priority: k.priority, workflow_id: k.workflow_id, stage: firstStage(workflowOf(k)), assignee_id: k.assignee_id, parent_id: toId, position: k.position }, 3);
      await cloneKids(k.id, n.id);
    }
  };
  await cloneKids(t.id, copy.id);
  await postUpdate(copy, `Repeats ${t.repeat}. Created from the previous one.`, "system");
  return copy;
}
async function checkParent(parentId, depth) {
  const p = S.db.tasks.find(x => x.id === parentId); if (!p || isDone(p)) return;
  const kids = childrenOf(parentId);
  if (kids.length && kids.every(isDone)) {
    await postUpdate(p, "All steps are done.", "system");
    await runAutomations("all_steps_done", p, {}, depth);
  }
}

/* ---------- Your automations ---------- */
export const TRIGGERS = {
  task_created: "A task is created",
  stage_changed: "A task moves to a stage",
  all_steps_done: "All steps of a task are done",
  assigned: "A task is assigned to someone",
  overdue: "A task becomes overdue"
};
export const ACTIONS = {
  set_stage: "Move it to stage",
  set_priority: "Set priority",
  assign: "Assign to",
  set_due_in_days: "Set due date (days from now)",
  star: "Star it for today",
  add_steps: "Add steps",
  comment: "Post an update",
  notify: "Notify",
  set_workflow: "Switch workflow",
  advance_parent: "Move its parent task forward"
};
function conditionsMatch(a, t, ctx) {
  const c = a.conditions || {};
  if (c.to_stage && t.stage !== c.to_stage) return false;
  if (c.to_type && ctx.to_type !== c.to_type) return false;
  if (c.area && t.area !== c.area) return false;
  if (c.priority && t.priority !== c.priority) return false;
  if (c.workflow_id && t.workflow_id !== c.workflow_id) return false;
  if (c.top_level && t.parent_id) return false;
  return true;
}
export async function runAutomations(trigger, task, ctx = {}, depth = 0) {
  if (depth > 3) return;
  const rules = S.db.automations.filter(a => a.enabled && a.trigger === trigger && conditionsMatch(a, task, ctx));
  for (const a of rules) {
    let t = S.db.tasks.find(x => x.id === task.id) || task;
    for (const act of a.actions || []) {
      try { t = await applyAction(act, t, depth + 1) || t; } catch (e) { console.warn("automation", a.name, e); }
    }
    update("automations", a, { run_count: (a.run_count || 0) + 1 }).catch(() => {});
  }
}
async function applyAction(act, t, depth) {
  switch (act.type) {
    case "set_stage": {
      const st = stagesOf(t);
      const key = act.value === "next" ? nextStageKey(t) : act.value === "done" ? doneStage(workflowOf(t)) : (st.some(s => s.key === act.value) ? act.value : null);
      if (key && key !== t.stage) return changeTask(t, { stage: key }, depth);
      return t;
    }
    case "set_priority": return t.priority === act.value ? t : changeTask(t, { priority: act.value }, depth);
    case "assign": { const uid = act.value === "creator" ? t.created_by : act.value === "me" ? me() : act.value; return uid && uid !== t.assignee_id ? changeTask(t, { assignee_id: uid }, depth) : t; }
    case "set_due_in_days": return changeTask(t, { due_date: dkey(addDays(new Date(), +act.value || 0)) }, depth);
    case "star": return t.starred ? t : changeTask(t, { starred: true }, depth);
    case "add_steps": {
      const titles = (Array.isArray(act.value) ? act.value : String(act.value || "").split("\n")).map(s => s.trim()).filter(Boolean);
      const existing = new Set(childrenOf(t.id).map(c => c.title));
      for (const title of titles) if (!existing.has(title)) await createTask({ title, parent_id: t.id, area: t.area, workflow_id: defaultWorkflow()?.id }, depth);
      return t;
    }
    case "comment": await postUpdate(t, String(act.value || ""), "system"); return t;
    case "notify": {
      const msg = `“${t.title}” ${act.message || act.value_message || "was updated"}`;
      const targets = act.value === "workspace" ? S.db.workspace_members.map(m => m.user_id) : act.value === "assignee" ? [t.assignee_id] : act.value === "creator" ? [t.created_by] : [act.value];
      targets.forEach(uid => notify(uid, t, msg));
      return t;
    }
    case "set_workflow": return act.value && act.value !== t.workflow_id ? changeTask(t, { workflow_id: act.value }, depth) : t;
    case "advance_parent": { const p = S.db.tasks.find(x => x.id === t.parent_id); if (p) await changeTask(p, { stage: nextStageKey(p) }, depth); return t; }
  }
  return t;
}

/* Overdue rules run once per task per day, when the app opens and every hour */
export async function runOverdue() {
  const rules = S.db.automations.filter(a => a.enabled && a.trigger === "overdue");
  if (!rules.length) return;
  const today = dkey();
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem("tb.overdue." + S.wsId) || "{}"); } catch (e) {}
  if (seen._day !== today) seen = { _day: today };
  const overdue = S.db.tasks.filter(t => dueStatus(t) === "overdue" && !seen[t.id]);
  for (const t of overdue) { seen[t.id] = 1; await runAutomations("overdue", t, {}, 0); }
  try { localStorage.setItem("tb.overdue." + S.wsId, JSON.stringify(seen)); } catch (e) {}
  emit();
}
