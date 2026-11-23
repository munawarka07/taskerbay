// TaskerBay app: screens, interactions and animations.
import { S, api, initBackend, onChange, onError, emit, insert, upsert, update, remove, uuid, localUpsert } from "./store.js";
import * as E from "./engine.js";
import { ENABLE_GOOGLE, ENABLE_AI, CURRENCY, VAPID_PUBLIC_KEY } from "./config.js";

const { dkey, parseKey, addDays } = E;
/* ================= Helpers ================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const money = n => `${CURRENCY} ${nf.format(Math.round(n || 0))}`;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };
const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DOW_S = ["S", "M", "T", "W", "T", "F", "S"];
let AI_ON = false;
const timeAgo = iso => { const s = (Date.now() - new Date(iso)) / 1000; if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; if (s < 604800) return `${Math.floor(s / 86400)}d ago`; return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }); };
const fmtTime = t => t ? t.slice(0, 5) : "";

const CATS = {
  Food: ["🍽️", "#E07A1F"], Transport: ["🚕", "#3B6FD4"], Rent: ["🏠", "#8B5CF6"], Bills: ["🧾", "#64748B"],
  Loans: ["🏦", "#D2453F"], Family: ["💞", "#E2557A"], Shopping: ["🛍️", "#D946A8"], Health: ["💊", "#C99A06"],
  Travel: ["✈️", "#0E9AA7"], Wedding: ["💍", "#A855F7"], Salary: ["💼", "#2E9B5B"], Other: ["✨", "#7C8691"]
};
const AREAS = ["Work", "Personal", "Projects"];
const AREA_C = { Work: "var(--blue)", Personal: "var(--green)", Projects: "var(--gold)" };
const PRI_C = { High: "var(--red)", Medium: "var(--gold)", Low: "var(--line)" };
const MOODS = [["😫", "Rough"], ["😕", "Meh"], ["🙂", "Okay"], ["😄", "Good"], ["🤩", "Great"]];
const AV_COLORS = ["#0E7A74", "#3B6FD4", "#8B5CF6", "#E07A1F", "#D2453F", "#2E9B5B", "#D946A8", "#0E9AA7"];

const U = { view: "today", taskMode: "list", taskFilter: "open", areaFilter: "All", boardWf: null, planDay: dkey(), planWeek: 0, month: dkey().slice(0, 7), sheet: null, plan: null, planState: "idle", monthAI: null, monthAIState: "idle", expanded: new Set() };

const me = () => S.user?.id;
const profile = id => S.db.profiles.find(p => p.id === id);
const nameOf = id => profile(id)?.full_name || "Someone";
const initials = id => (nameOf(id).replace(/\(.*\)/, "").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("") || "?").toUpperCase();
const avColor = id => AV_COLORS[[...String(id || "x")].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_COLORS.length];
const avatar = (id, lg) => id ? `<span class="av ${lg ? "lg" : ""}" style="--c:${avColor(id)}" title="${esc(nameOf(id))}">${esc(initials(id))}</span>` : "";
const ws = () => S.db.workspaces.find(w => w.id === S.wsId);
const myRole = () => S.db.workspace_members.find(m => m.user_id === me())?.role || "member";
const isTeam = () => S.db.workspace_members.length > 1;
const task = id => S.db.tasks.find(t => t.id === id);

function dueLabel(t) {
  if (!t.due_date) return "";
  const d = Math.round((parseKey(t.due_date) - parseKey(dkey())) / 864e5);
  let s = d === 0 ? "Today" : d === 1 ? "Tomorrow" : d === -1 ? "Yesterday" : d < 0 ? `${-d}d late` : d < 7 ? parseKey(t.due_date).toLocaleDateString("en-GB", { weekday: "short" }) : parseKey(t.due_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  if (t.due_time) s += " " + fmtTime(t.due_time);
  return s;
}
function sortTasks(a, b) {
  const ad = a.due_date || "9999-99-99", bd = b.due_date || "9999-99-99";
  if (ad !== bd) return ad < bd ? -1 : 1;
  if ((a.due_time || "99") !== (b.due_time || "99")) return (a.due_time || "99") < (b.due_time || "99") ? -1 : 1;
  const pr = { High: 0, Medium: 1, Low: 2 };
  if (pr[a.priority] !== pr[b.priority]) return pr[a.priority] - pr[b.priority];
  return a.position - b.position;
}

/* Quick add: "Send payslips tomorrow 3pm #work !high @sara *"
   Also understands plain sentences: "call bank on 25 nov at 3 pm", "in 2 days", "next week", "noon". */
const FILLER = new Set(["on", "at", "by", "due", "for", "to", "until", "till", "before", "from", "this", "next", "the", "of"]);
const MONTH_N = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
const monthIdx = w => MONTH_N[w] ?? -1;
function dateFromDM(dd, mm, today) { if (dd < 1 || dd > 31 || mm < 0 || mm > 11) return null; let d = new Date(today.getFullYear(), mm, dd); if (d < parseKey(dkey(today))) d = new Date(today.getFullYear() + 1, mm, dd); return dkey(d); }
function parseQuick(text) {
  const out = { title: "", area: S.db.workspace_members.length > 1 ? "Work" : "Personal", priority: "Medium", due_date: null, due_time: null, starred: false, repeat: "", assignee_id: me() };
  const words = text.trim().split(/\s+/).filter(Boolean); const used = new Set(); const today = new Date();
  const lws = words.map(w => w.toLowerCase().replace(/[,.;!?]+$/, ""));
  const setTime = (h, m) => { if (h < 24 && m < 60) { out.due_time = `${pad(h)}:${pad(m)}`; if (!out.due_date) out.due_date = dkey(today); return true; } return false; };
  for (let i = 0; i < words.length; i++) {
    const w = words[i], lw = lws[i], nx = lws[i + 1] || "";
    const take = (...idx) => idx.forEach(k => used.add(k));
    if (/^#w(ork)?$/.test(lw)) { out.area = "Work"; take(i); continue; }
    if (/^#p(ersonal)?$/.test(lw)) { out.area = "Personal"; take(i); continue; }
    if (/^#proj(ect|ects)?$/.test(lw)) { out.area = "Projects"; take(i); continue; }
    if (/^!(h|high|1)$/.test(lw) || (lw === "urgent")) { out.priority = "High"; take(i); continue; }
    if (/^!(m|med|medium|2)$/.test(lw)) { out.priority = "Medium"; take(i); continue; }
    if (/^!(l|low|3)$/.test(lw)) { out.priority = "Low"; take(i); continue; }
    if (lw === "*" || lw === "⭐") { out.starred = true; take(i); continue; }
    if (lw.startsWith("@") && lw.length > 1) { const p = S.db.profiles.find(p => p.full_name.toLowerCase().startsWith(lw.slice(1))); if (p) { out.assignee_id = p.id; take(i); continue; } }
    if (/^(every|each)$/.test(lw) && /^(day|weekday|week|month)$/.test(nx)) { out.repeat = { day: "daily", weekday: "weekdays", week: "weekly", month: "monthly" }[nx]; take(i, i + 1); continue; }
    if (lw === "daily") { out.repeat = "daily"; take(i); continue; }
    if (lw === "today" || lw === "tod" || lw === "tonight") { out.due_date = dkey(today); if (lw === "tonight" && !out.due_time) out.due_time = "20:00"; take(i); continue; }
    if (lw === "tomorrow" || lw === "tmr" || lw === "tmrw") { out.due_date = dkey(addDays(today, 1)); take(i); continue; }
    if (lw === "nextweek" || (lw === "next" && nx === "week")) { out.due_date = dkey(addDays(today, 7)); take(i); if (lw === "next") take(i + 1); continue; }
    if (lw === "in" && /^\d{1,3}$/.test(nx) && /^(day|days|week|weeks)$/.test(lws[i + 2] || "")) { const n = +nx * (lws[i + 2].startsWith("week") ? 7 : 1); out.due_date = dkey(addDays(today, n)); take(i, i + 1, i + 2); continue; }
    if (lw === "noon" || lw === "midday") { setTime(12, 0); take(i); continue; }
    const part = { morning: 9, afternoon: 14, evening: 18 }[lw];
    if (part && (out.due_date || i > 0 && used.has(i - 1)) && !out.due_time) { setTime(part, 0); take(i); continue; }
    // times: 3pm, 3:30pm, 15:00, "3 pm"
    let tm = lw.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/) || lw.match(/^(\d{1,2}):(\d{2})$/);
    if (!tm && /^\d{1,2}(:\d{2})?$/.test(lw) && /^(am|pm)$/.test(nx)) { const [h, m] = lw.split(":"); tm = [lw, h, m, nx]; take(i + 1); }
    if (tm) { let h = +tm[1], m = +(tm[2] || 0); if (tm[3] === "pm" && h < 12) h += 12; if (tm[3] === "am" && h === 12) h = 0; if (setTime(h, m)) { take(i); continue; } }
    // weekdays: fri, friday, next friday
    const di = DOW.findIndex(d => lw === d || lw === d + "day" || (d === "tue" && (lw === "tuesday" || lw === "tues")) || (d === "wed" && lw === "wednesday") || (d === "thu" && (lw === "thursday" || lw === "thurs")) || (d === "sat" && lw === "saturday"));
    if (di >= 0) { let n = (di - today.getDay() + 7) % 7; if (n === 0) n = 7; out.due_date = dkey(addDays(today, n)); take(i); continue; }
    // dates: 25/11, 25-11, 25 nov, nov 25, 25th november
    const m = lw.match(/^(\d{1,2})[\/\-.](\d{1,2})$/);
    if (m) { const d = dateFromDM(+m[1], +m[2] - 1, today); if (d) { out.due_date = d; take(i); continue; } }
    const dn = lw.match(/^(\d{1,2})(st|nd|rd|th)?$/);
    if (dn && monthIdx(nx) >= 0) { const d = dateFromDM(+dn[1], monthIdx(nx), today); if (d) { out.due_date = d; take(i, i + 1); continue; } }
    if (monthIdx(lw) >= 0) { const d2 = nx.match(/^(\d{1,2})(st|nd|rd|th)?$/); if (d2) { const d = dateFromDM(+d2[1], monthIdx(lw), today); if (d) { out.due_date = d; take(i, i + 1); continue; } } }
  }
  // drop little linking words that only introduced a date or time ("on", "at", "by"...)
  const keep = words.filter((w, i) => { if (used.has(i)) return false; if (FILLER.has(lws[i])) { let j = i + 1; while (j < words.length && FILLER.has(lws[j]) && !used.has(j)) j++; if (j >= words.length || used.has(j)) return false; } return true; });
  out.title = keep.join(" ").replace(/[\s,;:-]+$/, "");
  return out;
}

/* Smart reader: decides whether a sentence is a NEW task or an UPDATE to an existing one.
   "mark payroll report done", "salary sheet waiting for approval from finance",
   "move visa renewal to thursday 3pm", "payroll: sent to bank, follow up tomorrow" */
const STOP = new Set(["the", "a", "an", "and", "or", "to", "for", "of", "on", "at", "by", "in", "with", "my", "is", "it", "its", "this", "that", "task", "please", "now", "be", "has", "have", "was", "are", "from", "as"]);
const STATUS_RX = [
  ["done", /\b(mark(ed)? (as )?done|done|completed?|finished|closed|resolved|sorted|submitted|delivered|paid|approved)\b/],
  ["wait", /\b(waiting|on hold|pending|blocked|awaiting|stuck|hold)\b/],
  ["active", /\b(in progress|started|starting|working on|ongoing|underway|doing)\b/],
  ["todo", /\b(reopen(ed)?|not started|back to (to ?do|todo))\b/]
];
const UPDATE_VERB = /^(mark|set|move|update|change|reschedule|postpone|push|shift|complete|finish|close|start|reopen|status)\b/;
const words3 = s => s.toLowerCase().replace(/[^a-z0-9؀-ۿ\s]/g, " ").split(/\s+/).filter(w => w.length > 1 && !STOP.has(w));
function stageFor(t, kind) {
  const st = E.stagesOf(t);
  if (kind === "done") return E.doneStage(E.workflowOf(t));
  if (kind === "todo") return st[0].key;
  if (kind === "wait") return (st.find(s => /wait|hold|block|pend|review|approv/i.test(s.name) && s.type !== "done") || st.find(s => s.type === "active") || st[0]).key;
  return (st.find(s => s.type === "active") || st[0]).key;
}
function parseIntent(text) {
  const raw = text.trim(); if (!raw || raw.startsWith("+")) return null;
  const low = raw.toLowerCase();
  const vm = low.match(UPDATE_VERB), verb = !!vm;
  const kind = STATUS_RX.find(([, rx]) => rx.test(low))?.[0] || ({ complete: "done", finish: "done", close: "done", start: "active", reopen: "todo" }[vm?.[1]]) || null;
  const q = parseQuick(raw);
  const moving = verb && (q.due_date || q.due_time);
  if (!kind && !verb && !/[:–—]| - /.test(raw)) return null;
  // find the existing task the sentence talks about
  const sw = new Set(words3(raw));
  let best = null;
  for (const t of S.db.tasks) {
    const tw = [...new Set(words3(t.title))]; if (!tw.length) continue;
    const hit = tw.filter(w => sw.has(w) || [...sw].some(x => x.length > 4 && (x.startsWith(w) || w.startsWith(x)))).length;
    if (!hit) continue;
    const score = hit / tw.length + (E.isDone(t) ? -0.2 : 0) + (t.parent_id ? -0.05 : 0);
    if ((score >= 0.6 || hit >= 2) && (!best || score > best.score || (score === best.score && (hit > best.hit || (hit === best.hit && (t.updated_at || t.created_at || "") > (best.t.updated_at || best.t.created_at || "")))))) best = { t, score, hit };
  }
  if (!best) return null;
  if (!kind && !moving && !/[:–—]| - /.test(raw)) return null;
  const t = best.t;
  // the note: after ":" / " - ", or from the status phrase on (for waiting / in-progress updates)
  let note = "";
  const sep = raw.match(/[:–—]\s*(.+)$|\s-\s(.+)$/);
  if (sep) note = (sep[1] || sep[2]).trim();
  else if (kind === "wait" || kind === "active") { const m = low.match(STATUS_RX.find(([k]) => k === kind)[1]); if (m) note = raw.slice(m.index); }
  if (note) { const nq = parseQuick(note); if (nq.title) note = nq.title; note = note.charAt(0).toUpperCase() + note.slice(1); }
  const stage = kind ? stageFor(t, kind) : undefined;
  return { type: "update", task: t, stage, note, due_date: q.due_date || undefined, due_time: q.due_time || undefined };
}

/* ================= Feedback: toast, confetti, ripple, count-up ================= */
let toastTimer, undoFn = null;
function toast(msg, undo) {
  if (!msg) return;
  $("#toast-msg").textContent = msg; undoFn = undo || null;
  $("#toast-undo").style.display = undo ? "" : "none";
  $("#toast").classList.add("on"); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("on"), 4200);
}
$("#toast-undo").addEventListener("click", () => { undoFn && undoFn(); undoFn = null; $("#toast").classList.remove("on"); });
onError(e => toast(e?.message?.includes("Failed to fetch") ? "You're offline. That change wasn't saved." : `Couldn't save: ${e?.message || "unknown error"}`));

const cv = $("#confetti"), cx = cv.getContext("2d"); let parts = [], raf = null;
function burst(x, y, n = 26) {
  if (reduced) return;
  cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio; cx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  const cols = ["#0E7A74", "#E39B2D", "#2E9B5B", "#3B6FD4", "#E2557A"];
  for (let i = 0; i < n; i++) parts.push({ x, y, vx: (Math.random() - .5) * 9, vy: -Math.random() * 8 - 2, r: Math.random() * 4 + 3, c: cols[i % 5], a: 1, rot: Math.random() * 6 });
  if (!raf) raf = requestAnimationFrame(tick);
}
function tick() {
  cx.clearRect(0, 0, innerWidth, innerHeight);
  parts.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += .32; p.a -= .018; p.rot += .2; cx.save(); cx.globalAlpha = Math.max(0, p.a); cx.translate(p.x, p.y); cx.rotate(p.rot); cx.fillStyle = p.c; cx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 1.6); cx.restore(); });
  parts = parts.filter(p => p.a > 0);
  raf = parts.length ? requestAnimationFrame(tick) : (cx.clearRect(0, 0, innerWidth, innerHeight), null);
}
document.addEventListener("pointerdown", e => {
  const b = e.target.closest(".btn,.fab,.ai-btn"); if (!b || reduced) return;
  const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height); const sp = document.createElement("span");
  sp.className = "ripple"; sp.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
  b.appendChild(sp); setTimeout(() => sp.remove(), 650);
});
function countUp(el, to, fmt, animate) {
  fmt = fmt || (v => nf.format(v));
  if (!animate || reduced) { el.textContent = fmt(to); return; }
  const start = performance.now();
  const step = now => { const p = Math.min(1, (now - start) / 900); el.textContent = fmt(Math.round(to * (1 - Math.pow(1 - p, 3)))); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

/* Theme */
const THEMES = ["auto", "light", "dark"];
let theme = "auto"; try { theme = localStorage.getItem("tb.theme") || "auto"; } catch (e) {}
const applyTheme = t => { if (t === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", t); };
applyTheme(theme);
function cycleTheme() { theme = THEMES[(THEMES.indexOf(theme) + 1) % 3]; applyTheme(theme); try { localStorage.setItem("tb.theme", theme); } catch (e) {} toast(`Theme: ${theme === "auto" ? "matches your device" : theme}`); }

/* ================= Icons ================= */
const ic = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const I = {
  today: ic('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  plan: ic('<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/><path d="M7.5 13h3M7.5 17h6"/>'),
  tasks: ic('<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),
  routine: ic('<path d="M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z"/><path d="M12 7v5l3 2"/>'),
  money: ic('<rect x="2" y="6" width="20" height="13" rx="3"/><path d="M2 10h20M6 15h3"/>'),
  focus: ic('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>'),
  team: ic('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14a5 5 0 0 1 5.5 5"/>'),
  flow: ic('<rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="15" y="15" width="6" height="6" rx="1.5"/><path d="M6 9v4a3 3 0 0 0 3 3h6"/>'),
  bolt: ic('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'),
  bell: ic('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
  gear: ic('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  more: ic('<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'),
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  search: ic('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  moon: ic('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  check: `<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  star: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.3L12 17.1 6.3 20.2l1.2-6.3L2.8 9.5l6.4-.8z"/></svg>`,
  chev: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`,
  left: ic('<path d="M15 18l-6-6 6-6"/>'), right: ic('<path d="M9 18l6-6-6-6"/>'),
  repeat: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>`
};

/* ================= Shell ================= */
const NAV = [
  ["today", "Today", I.today], ["plan", "Planner", I.plan], ["tasks", "Tasks", I.tasks], ["routine", "Routine", I.routine],
  ["money", "Money", I.money], ["focus", "Focus", I.focus], ["team", "Team & updates", I.team], ["workflows", "Workflows", I.flow],
  ["automations", "Automations", I.bolt], ["inbox", "Inbox", I.bell], ["settings", "Settings", I.gear]
];
const unread = () => S.db.notifications.filter(n => !n.read && (!n.workspace_id || S.db.workspaces.some(w => w.id === n.workspace_id))).length;

function shell() {
  $("#root").innerHTML = `
  <div class="app">
    <nav class="rail" aria-label="Sections">
      <div class="brand"><div class="brand-mark"><span></span></div>TaskerBay</div>
      ${NAV.slice(0, 6).map(([k, l, i]) => `<button class="tab" data-go="${k}">${i}${l}</button>`).join("")}
      <div class="sec">Team</div>
      ${NAV.slice(6).map(([k, l, i]) => `<button class="tab" data-go="${k}">${i}${l}${k === "inbox" ? `<span class="badge" id="rail-badge" hidden></span>` : ""}</button>`).join("")}
      <button class="fab-wide" data-action="add">${I.plus}Add</button>
    </nav>
    <main>
      <div class="topbar">
        <button class="ws-btn" data-action="ws-switch" aria-label="Switch workspace"><span class="ic" id="ws-ic"></span><span class="n" id="ws-name"></span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M6 9l6 6 6-6"/></svg></button>
        <div class="top-actions">
          ${S.mode === "claude" ? `<div class="sync" id="sync"><i></i><span>Synced</span></div>` : S.mode === "demo" ? `<span class="demo-tag" title="Data stays in this browser">${api.isClean?.() ? "This device" : "Demo"}</span>` : `<div class="sync" id="sync"><i></i><span>Synced</span></div>`}
          <button class="icon-btn" data-action="palette" aria-label="Search and commands">${I.search}</button>
          <button class="icon-btn bell" data-go="inbox" aria-label="Inbox">${I.bell}<span class="dot" id="bell-dot" hidden></span></button>
          <button class="icon-btn" data-action="theme" aria-label="Switch theme">${I.moon}</button>
        </div>
      </div>
      <div id="banner"></div>
      <section class="view on" id="view" aria-live="polite"></section>
    </main>
  </div>
  <nav class="tabbar" aria-label="Sections">
    <button class="tab" data-go="today">${I.today}Today</button>
    <button class="tab" data-go="plan">${I.plan}Plan</button>
    <button class="fab" data-action="add" aria-label="Add">${I.plus}</button>
    <button class="tab" data-go="tasks">${I.tasks}Tasks</button>
    <button class="tab" data-go="more">${I.more}More<span class="badge" id="more-badge" hidden></span></button>
  </nav>`;
}
function renderChrome() {
  const w = ws();
  $("#ws-ic").textContent = w?.icon || "🏠"; $("#ws-name").textContent = w?.name || "Workspace";
  const n = unread();
  ["#rail-badge", "#more-badge"].forEach(s => { const b = $(s); if (b) { b.hidden = !n; b.textContent = n; } });
  const d = $("#bell-dot"); if (d) d.hidden = !n;
  const sy = $("#sync"); if (sy) { sy.className = "sync " + (S.online ? "cloud" : "local"); $("span", sy).textContent = S.online ? "Synced" : "Reconnecting"; }
  const moreViews = ["more", "routine", "money", "focus", "team", "workflows", "automations", "inbox", "settings"];
  $$("[data-go]").forEach(b => { if (!b.classList.contains("tab")) return; const k = b.dataset.go; b.classList.toggle("on", k === U.view || (k === "more" && moreViews.includes(U.view) && b.closest(".tabbar"))); });
  $("#banner").innerHTML = S.mode !== "demo" ? "" : api.isClean?.() ? (U.view === "settings" ? `<div class="banner"><span>💾</span><span><b>Saved on this device only.</b> Sync between phone and computer switches on once your TaskerBay account server is connected. Use <b>Copy all my data</b> below as a backup.</span></div>` : "") : `<div class="banner"><span>🧪</span><span><b>Demo mode</b> with sample data. To start your own planner, go to Settings → <b>Start my own planner</b>.</span></div>`;
}

/* ================= Routing & render ================= */
const VIEWS = { today: vToday, plan: vPlan, tasks: vTasks, routine: vRoutine, money: vMoney, focus: vFocus, team: vTeam, workflows: vWorkflows, automations: vAutomations, inbox: vInbox, settings: vSettings, more: vMore };
function render(animate = false) {
  if (!S.ready) return;
  renderChrome();
  const v = $("#view");
  const ae = document.activeElement, aeId = ae && v.contains(ae) ? ae.id : null, val = aeId ? ae.value : null, sel = aeId && ae.selectionStart != null ? [ae.selectionStart, ae.selectionEnd] : null;
  v.innerHTML = VIEWS[U.view](animate);
  if (aeId) { const n = $("#" + aeId); if (n) { if (val != null) n.value = val; n.focus(); if (sel) try { n.setSelectionRange(...sel); } catch (e) {} } }
  afterRender(animate);
  if (animate) { v.classList.remove("enter"); void v.offsetWidth; v.classList.add("enter"); setTimeout(() => v.classList.remove("enter"), 900); }
  if (U.sheet?.type === "task") refreshTaskSheet();
}
function go(view, opts = {}) {
  if (!VIEWS[view]) view = "today";
  U.view = view; Object.assign(U, opts);
  if (location.hash !== "#" + view) history.replaceState(null, "", "#" + view);
  render(true); scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
}
addEventListener("hashchange", () => { if (S.ready && openFromHash()) return; const v = location.hash.slice(1); if (v && v !== U.view && VIEWS[v]) go(v); });
let afterFns = [];
const after = fn => afterFns.push(fn);
function afterRender(animate) {
  $$("[data-count]").forEach(n => countUp(n, +n.dataset.count, n.dataset.fmt === "money" ? v => money(v) : n.dataset.fmt === "sign" ? v => (v > 0 ? "+" : "") + nf.format(v) : null, animate));
  if (animate) requestAnimationFrame(() => requestAnimationFrame(() => {
    $$("[data-dash]").forEach(c => c.style.strokeDashoffset = c.dataset.dash);
    $$("[data-h]").forEach(c => c.style.height = c.dataset.h + "%");
    $$("[data-w]").forEach(c => c.style.width = c.dataset.w + "%");
    $$("[data-len]").forEach(c => c.setAttribute("stroke-dasharray", c.dataset.len));
  }));
  const fns = afterFns; afterFns = []; fns.forEach(f => f());
}

/* ================= Shared components ================= */
const thinking = label => `<div class="thinking"><i></i><i></i><i></i>${esc(label)}</div>`;
const emptyBox = (title, sub, icon = I.tasks) => `<div class="empty"><div class="art">${icon}</div><b>${title}</b>${sub}</div>`;
function stageChip(t) { const s = E.stageOf(t); return `<span class="stage-chip" style="--c:${s.color}">${esc(s.name)}</span>`; }
function taskRow(t, opts = {}) {
  const ds = E.dueStatus(t), done = E.isDone(t), pg = E.progressOf(t.id);
  const chips = [];
  if (t.due_date) chips.push(`<span class="chip ${ds}">${esc(dueLabel(t))}</span>`);
  if (!done) chips.push(stageChip(t));
  if (pg) chips.push(`<span class="chip subbar">${pg.done}/${pg.total}<span><i style="width:${pg.pct * 100}%"></i></span></span>`);
  chips.push(`<span class="chip dot" style="--c:${AREA_C[t.area] || "var(--muted)"}">${esc(t.area)}</span>`);
  if (t.repeat) chips.push(`<span class="chip">${I.repeat} ${esc(t.repeat)}</span>`);
  if (t.parent_id && opts.showParent) { const p = task(t.parent_id); if (p) chips.push(`<span class="chip">↳ ${esc(p.title).slice(0, 24)}</span>`); }
  return `<div class="row ${done ? "done" : ""}" style="--p:${PRI_C[t.priority]}" data-id="${t.id}" data-swipe="1">
    <button class="check" data-action="toggle" data-id="${t.id}" aria-label="${done ? "Reopen" : "Complete"}: ${esc(t.title)}">${I.check}</button>
    <div class="main" data-action="open-task" data-id="${t.id}" role="button" tabindex="0"><div class="t">${esc(t.title)}</div>${t.status_note && !done ? `<div class="st-note" title="Latest status">💬 ${esc(t.status_note)}${t.status_at ? ` <small>· ${timeAgo(t.status_at)}</small>` : ""}</div>` : ""}<div class="meta">${chips.join("")}</div></div>
    ${isTeam() && t.assignee_id ? avatar(t.assignee_id) : ""}
    <button class="star ${t.starred ? "on" : ""}" data-action="star" data-id="${t.id}" aria-label="${t.starred ? "Unstar" : "Star for today"}">${I.star}</button>
  </div>`;
}
function quickAdd(id, placeholder) {
  return `<form class="qa" data-form="quick" autocomplete="off"><label for="${id}" class="sr">New task</label><input id="${id}" data-quick="1" placeholder="${placeholder}" enterkeyhint="done"><button class="btn" type="submit">${I.plus}<span>Add</span></button></form>
  <div class="qa-hint" data-hint-for="${id}">${hintFor("")}</div>`;
}
function hintFor(v) {
  if (!v.trim()) return `<span>Shortcuts:</span><code>today</code><code>fri</code><code>3pm</code><code>#work</code><code>!high</code>${isTeam() ? "<code>@name</code>" : ""}<code>*</code><code>every week</code><span>· or update one:</span><code>payroll done</code><code>move visa to thu 3pm</code>`;
  const it = parseIntent(v);
  if (it) {
    const st = it.stage ? E.stagesOf(it.task).find(s => s.key === it.stage) : null, fake = { ...it.task, due_date: it.due_date ?? it.task.due_date, due_time: it.due_time ?? it.task.due_time };
    return `<span>Will update:</span><span class="chip upd-chip">${esc(it.task.title.slice(0, 40))}</span>${st ? `<span class="chip" style="color:${st.color}">→ ${esc(st.name)}</span>` : ""}${it.due_date || it.due_time ? `<span class="chip ${E.dueStatus({ ...fake, stage: "todo" })}">${esc(dueLabel(fake))}</span>` : ""}${it.note ? `<span class="chip">💬 ${esc(it.note.slice(0, 40))}</span>` : ""}<span class="muted" style="font-size:11.5px">Start with <b>+</b> to add as a new task instead</span>`;
  }
  const p = parseQuick(v.replace(/^\+\s*/, "")), fake = { ...p, stage: "todo" };
  return `<span>Will add:</span>${p.due_date ? `<span class="chip ${E.dueStatus(fake)}">${esc(dueLabel(fake))}</span>` : `<span class="chip">No date</span>`}<span class="chip dot" style="--c:${AREA_C[p.area]}">${p.area}</span><span class="chip" style="color:${PRI_C[p.priority]}">${p.priority}</span>${p.assignee_id !== me() ? `<span class="chip">→ ${esc(nameOf(p.assignee_id))}</span>` : ""}${p.starred ? `<span class="chip today">⭐</span>` : ""}${p.repeat ? `<span class="chip">${I.repeat} ${p.repeat}</span>` : ""}`;
}
function ring(pct, size = 118, stroke = 11, id = "") {
  const r = (size - stroke) / 2 - 4, C = 2 * Math.PI * r;
  return `<svg viewBox="0 0 ${size} ${size}"><circle class="trk" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/><circle class="val" ${id ? `id="${id}"` : ""} cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}" stroke-dasharray="${C}" stroke-dashoffset="${C}" data-dash="${C * (1 - pct)}" style="stroke-dashoffset:${C * (1 - pct)}"/></svg>`;
}

/* ================= Routine helpers ================= */
const routineToday = (day = new Date()) => S.db.routine_items.filter(r => !r.archived && (r.days || []).includes(day.getDay())).sort((a, b) => (a.time_of_day || "99").localeCompare(b.time_of_day || "99") || a.position - b.position);
const logged = (item, k = dkey()) => S.db.routine_logs.some(l => l.item_id === item.id && l.day === k);
function streak(item) {
  let n = 0, d = new Date();
  if (!logged(item, dkey(d))) d = addDays(d, -1);
  for (let i = 0; i < 400; i++) { if (!(item.days || []).includes(d.getDay())) { d = addDays(d, -1); continue; } if (logged(item, dkey(d))) { n++; d = addDays(d, -1); } else break; }
  return n;
}
async function toggleRoutine(item, el) {
  const k = dkey();
  if (logged(item, k)) await remove("routine_logs", { item_id: item.id, day: k });
  else { if (el) { const r = el.getBoundingClientRect(); burst(r.left + 30, r.top + r.height / 2, 18); } buzz(15); await insert("routine_logs", { item_id: item.id, user_id: me(), day: k }); }
}

/* ================= TODAY ================= */
function greeting() { const h = new Date().getHours(); return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; }
function dayScore() {
  const tk = dkey();
  const doneToday = S.db.tasks.filter(t => t.completed_at && dkey(new Date(t.completed_at)) === tk && (t.assignee_id === me() || !t.assignee_id)).length;
  const sessions = S.db.focus_sessions.filter(f => f.day === tk).length;
  const rt = routineToday(); const rDone = rt.filter(r => logged(r)).length;
  const overdue = S.db.tasks.filter(t => E.dueStatus(t) === "overdue" && t.assignee_id === me()).length;
  const p = { tasks: Math.min(40, doneToday * 10), focus: Math.min(30, sessions * 10), routine: rt.length ? Math.round(rDone / rt.length * 30) : 0, penalty: Math.min(20, overdue * 4) };
  return { score: Math.max(0, Math.min(100, p.tasks + p.focus + p.routine - p.penalty)), p };
}
function vToday(animate) {
  const tk = dkey(), mine = t => !t.assignee_id || t.assignee_id === me();
  const open = S.db.tasks.filter(t => !E.isDone(t) && mine(t));
  const dueToday = S.db.tasks.filter(t => t.due_date === tk && mine(t));
  const doneToday = S.db.tasks.filter(t => t.completed_at && dkey(new Date(t.completed_at)) === tk && mine(t));
  const ids = new Set([...dueToday, ...doneToday].map(t => t.id));
  const doneIds = new Set([...dueToday.filter(E.isDone), ...doneToday].map(t => t.id));
  const pct = ids.size ? doneIds.size / ids.size : 0;
  const overdue = open.filter(t => E.dueStatus(t) === "overdue");
  const focus = open.filter(t => t.starred || ["overdue", "today"].includes(E.dueStatus(t))).sort((a, b) => (b.starred - a.starred) || sortTasks(a, b));
  const rt = routineToday(); const rDone = rt.filter(r => logged(r)).length;
  const nowT = `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;
  const nextRt = rt.filter(r => !logged(r));
  const mk = tk.slice(0, 7);
  const spent = S.db.expenses.filter(x => x.flow !== "in" && x.date.startsWith(mk)).reduce((s, x) => s + +x.amount, 0);
  const weekAgo = addDays(new Date(), -6); weekAgo.setHours(0, 0, 0, 0);
  const doneWeek = S.db.tasks.filter(t => t.completed_at && new Date(t.completed_at) >= weekAgo && mine(t)).length;
  const review = S.db.tasks.filter(t => !E.isDone(t) && E.stageOf(t).key === "review");
  const waiting = S.db.tasks.filter(t => !E.isDone(t) && t.created_by === me() && t.assignee_id && t.assignee_id !== me());
  const sc = dayScore(), SC = 2 * Math.PI * 34;
  const j = S.db.journal.find(x => x.day === tk && x.user_id === me()) || {};
  const first = (profile(me())?.full_name || "").split(" ")[0];
  const msg = !ids.size ? "Nothing due today. Star a task to make today count." : pct === 1 ? "Everything due today is done. Brilliant work." : `${ids.size - doneIds.size} left for today. You've got this.`;
  return `
  ${pushBanner()}<div class="hello"><div><h1>${greeting()}${first && first !== "You" ? `, <em>${esc(first)}</em>` : ""}</h1><p>${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} · ${esc(ws()?.name || "")}</p></div></div>
  <div class="grid g-hero">
    <div class="card hero">
      <div class="ring">${ring(animate ? 0 : pct)}<div class="lbl"><div><b class="num">${Math.round(pct * 100)}%</b><small>${doneIds.size} of ${ids.size} today</small></div></div></div>
      <div class="hero-copy"><h2>Today's progress</h2><p>${msg}</p><span class="pill">🔁 ${rDone}/${rt.length} routine · ⏱ ${S.db.focus_sessions.filter(f => f.day === tk).reduce((s, f) => s + f.minutes, 0)} focus min</span></div>
    </div>
    <div class="grid g-stats" style="grid-template-columns:repeat(2,1fr)">
      <button class="card stat hov" style="--c:var(--accent);text-align:left" data-go="tasks" data-tf="open"><div class="k"><i></i>My open tasks</div><div class="v num" data-count="${open.length}">0</div><div class="d">${waiting.length} handed to others</div></button>
      <button class="card stat hov" style="--c:var(--red);text-align:left" data-go="tasks" data-tf="overdue"><div class="k"><i></i>Overdue</div><div class="v num" data-count="${overdue.length}">0</div><div class="d">${overdue.length ? "Tap to clear them" : "All caught up"}</div></button>
      <button class="card stat hov" style="--c:var(--green);text-align:left" data-go="tasks" data-tf="done"><div class="k"><i></i>Done this week</div><div class="v num" data-count="${doneWeek}">0</div><div class="d">Last 7 days</div></button>
      <button class="card stat hov" style="--c:var(--gold);text-align:left" data-go="money"><div class="k"><i></i>Spent this month</div><div class="v num" data-count="${Math.round(spent)}" data-fmt="money">0</div><div class="d">${new Date().toLocaleDateString("en-GB", { month: "long" })}</div></button>
    </div>
  </div>
  <div class="grid g-2 mt">
    <div class="grid" style="gap:14px;align-content:start">
      <div class="card">
        <div class="card-h"><h2>🎯 Focus now</h2><button class="link" data-go="tasks">All tasks</button></div>
        <div class="list">${focus.length ? focus.slice(0, 8).map(t => taskRow(t, { showParent: true })).join("") : emptyBox("Clear runway", "Tap ＋ to add a task, or ⭐ star one to focus on it today.")}</div>
        ${focus.length ? `<div class="swipe-hint">Swipe right to finish · left to delete · tap to open</div>` : ""}
      </div>
      ${review.length || waiting.length ? `<div class="card"><div class="card-h"><h2>👥 Team pulse</h2><button class="link" data-go="team">Updates</button></div><div class="list">
        ${review.slice(0, 4).map(t => taskRow(t)).join("")}${waiting.filter(t => !review.includes(t)).slice(0, 4).map(t => taskRow(t)).join("")}</div></div>` : ""}
      ${aiPlanCard()}
    </div>
    <div class="grid" style="gap:14px;align-content:start">
      <div class="card">
        <div class="card-h"><h2>🔁 Today's routine</h2><button class="link" data-go="routine">Manage</button></div>
        <div class="list">${rt.length ? rt.map(r => { const on = logged(r); const late = !on && r.time_of_day && fmtTime(r.time_of_day) < nowT; return `<button class="rt ${on ? "on" : ""}" data-action="routine" data-id="${r.id}" aria-pressed="${on}"><span class="ic">${esc(r.icon)}</span><span class="t">${esc(r.name)}</span>${r.time_of_day ? `<span class="chip ${late ? "overdue" : ""}">${fmtTime(r.time_of_day)}</span>` : ""}<span class="check ${on ? "on" : ""}">${I.check}</span></button>`; }).join("") : emptyBox("No routine yet", "Add your daily habits in Routine.", I.routine)}</div>
        ${nextRt.length ? `<p class="muted" style="margin:10px 2px 0;font-size:13px">Next up: <b style="color:var(--ink)">${esc(nextRt[0].icon)} ${esc(nextRt[0].name)}</b>${nextRt[0].time_of_day ? ` at ${fmtTime(nextRt[0].time_of_day)}` : ""}</p>` : rt.length ? `<p class="muted" style="margin:10px 2px 0;font-size:13px">🎉 Routine complete for today.</p>` : ""}
      </div>
      <div class="card">
        <div class="card-h"><h2>Productivity score</h2><span class="sub">${sc.score >= 80 ? "On fire" : sc.score >= 55 ? "Strong day" : sc.score >= 25 ? "Building" : "Warming up"}</span></div>
        <div class="score"><div class="gauge"><svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="34" fill="none" stroke="var(--surface-2)" stroke-width="9"/><circle class="val" cx="40" cy="40" r="34" fill="none" stroke="${sc.score >= 55 ? "var(--green)" : sc.score >= 25 ? "var(--gold)" : "var(--red)"}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${SC}" style="stroke-dashoffset:${animate ? SC : SC * (1 - sc.score / 100)}" data-dash="${SC * (1 - sc.score / 100)}"/></svg><b class="num" data-count="${sc.score}">0</b></div>
        <div class="bd"><div>Tasks done <b>+${sc.p.tasks}</b></div><div>Focus <b>+${sc.p.focus}</b></div><div>Routine <b>+${sc.p.routine}</b></div><div>Overdue <b style="color:${sc.p.penalty ? "var(--red)" : "inherit"}">−${sc.p.penalty}</b></div></div></div>
      </div>
      <div class="card">
        <div class="card-h"><h2>Journal</h2><span class="sub">${j.mood != null ? MOODS[j.mood][1] : "How's today?"}</span></div>
        <div class="moods">${MOODS.map((m, i) => `<button class="mood ${j.mood === i ? "on" : ""}" data-action="mood" data-v="${i}" aria-label="${m[1]}" aria-pressed="${j.mood === i}">${m[0]}</button>`).join("")}</div>
        <div class="field" style="margin:12px 0 0"><label for="j-win">Win of the day</label><input class="inp" id="j-win" data-journal="win" value="${esc(j.win || "")}" placeholder="One thing that went well…"></div>
      </div>
    </div>
  </div>`;
}
function aiPlanCard() {
  if (!AI_ON) return "";
  let body;
  if (U.planState === "loading") body = thinking("Claude is planning your day…");
  else if (U.planState === "error") body = `<p class="muted" style="margin:0 0 10px">${esc(U.planErr)}</p><button class="ai-btn" data-action="ai-plan"><span class="spark">✨</span>Try again</button>`;
  else if (U.plan) {
    const p = U.plan, tops = (p.top3 || []).map(task).filter(Boolean);
    body = `<div class="plan-h">${esc(p.headline)}</div>${(p.plan || []).length ? `<div class="timeline">${p.plan.slice(0, 8).map(b => `<div><b>${esc(b.time)}</b><span>${esc(b.what)}</span></div>`).join("")}</div>` : ""}${p.tip ? `<div class="tip">💡 ${esc(p.tip)}</div>` : ""}
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">${tops.length ? `<button class="btn" data-action="ai-plan-star">⭐ Star top ${tops.length}</button>` : ""}<button class="btn ghost" data-action="ai-plan">Re-plan</button></div>`;
  } else body = `<p class="muted" style="margin:0 0 12px">Claude reads your tasks, routine and deadlines, then builds a realistic schedule for the rest of today.</p><button class="ai-btn" data-action="ai-plan"><span class="spark">✨</span>Plan my day</button>`;
  return `<div class="card ai-card"><div class="card-h"><h2>✨ AI day planner</h2><span class="sub">Claude</span></div>${body}</div>`;
}

/* ================= PLANNER ================= */
function vPlan() {
  const base = addDays(new Date(), U.planWeek * 7);
  const start = addDays(base, -((base.getDay() + 6) % 7)); // Monday
  const days = [...Array(7)].map((_, i) => addDays(start, i));
  const sel = U.planDay, selDate = parseKey(sel), tk = dkey();
  const dayTasks = k => S.db.tasks.filter(t => t.due_date === k && !t.parent_id || (t.due_date === k && t.parent_id && t.due_time)).sort(sortTasks);
  const timed = dayTasks(sel).filter(t => t.due_time);
  const allday = dayTasks(sel).filter(t => !t.due_time);
  const rt = routineToday(selDate);
  const items = [...timed.map(t => ({ time: fmtTime(t.due_time), t })), ...rt.filter(r => r.time_of_day).map(r => ({ time: fmtTime(r.time_of_day), r }))].sort((a, b) => a.time.localeCompare(b.time));
  const nowT = `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;
  let nowPlaced = sel !== tk;
  const unscheduled = S.db.tasks.filter(t => !t.due_date && !t.parent_id && !E.isDone(t)).sort(sortTasks);
  const tl = items.map(it => {
    let line = "";
    if (!nowPlaced && it.time > nowT) { nowPlaced = true; line = `<div class="tl now"><div class="tm">${nowT}</div><div class="now-line"></div></div>`; }
    const body = it.t ? taskRow(it.t) : `<button class="rt ${logged(it.r, sel) ? "on" : ""}" data-action="routine" data-id="${it.r.id}" ${sel !== tk ? "disabled" : ""}><span class="ic">${esc(it.r.icon)}</span><span class="t">${esc(it.r.name)}</span><span class="st">Routine</span></button>`;
    return line + `<div class="tl"><div class="tm">${it.time}</div><div>${body}</div></div>`;
  }).join("") + (!nowPlaced ? `<div class="tl now"><div class="tm">${nowT}</div><div class="now-line"></div></div>` : "");
  return `
  <div class="view-h"><div><h1>Planner</h1><p>${selDate.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</p></div>
    <div class="month-nav"><button class="icon-btn" data-action="week" data-v="-1" aria-label="Previous week">${I.left}</button><button class="btn ghost" data-action="week" data-v="0" style="padding:8px 12px">This week</button><button class="icon-btn" data-action="week" data-v="1" aria-label="Next week">${I.right}</button></div></div>
  <div class="card"><div class="weekstrip">${days.map(d => { const k = dkey(d); const ts = S.db.tasks.filter(t => t.due_date === k && !E.isDone(t) && !t.parent_id); const od = ts.some(t => E.dueStatus(t) === "overdue"); return `<button class="day ${k === tk ? "today" : ""} ${sel === k ? "on" : ""}" data-action="plan-day" data-v="${k}"><small>${d.toLocaleDateString("en-GB", { weekday: "short" })}</small><b class="num">${d.getDate()}</b><span class="dots">${ts.slice(0, 4).map(() => `<i class="${od ? "r" : ""}"></i>`).join("")}</span></button>`; }).join("")}</div></div>
  <div class="pl-cols">${days.map(d => { const k = dkey(d); const ts = S.db.tasks.filter(t => t.due_date === k && !t.parent_id).sort(sortTasks); return `<div class="pl-day ${k === tk ? "today" : ""}" data-drop-day="${k}"><h4>${d.toLocaleDateString("en-GB", { weekday: "short" })}<b>${d.getDate()}</b></h4>${ts.map(t => `<div class="pl-item ${E.isDone(t) ? "done" : ""}" draggable="true" data-drag-task="${t.id}" data-action="open-task" data-id="${t.id}" style="--p:${PRI_C[t.priority]}">${t.due_time ? `<small>${fmtTime(t.due_time)}</small>` : ""}${esc(t.title)}</div>`).join("")}<button class="add-card" style="color:var(--muted);font-weight:700;font-size:12px;padding:6px;text-align:left" data-action="new-task" data-due="${k}">＋ Add</button></div>`; }).join("")}</div>
  <div class="grid g-2 mt">
    <div class="card"><div class="card-h"><h2>⏰ Timeline</h2><button class="link" data-action="new-task" data-due="${sel}">＋ Add</button></div>
      ${items.length ? `<div class="timeline2">${tl}</div>` : emptyBox("Nothing scheduled", "Give tasks a time (e.g. <b style='display:inline'>3pm</b>) and add routine times to see them here.", I.plan)}
    </div>
    <div class="grid" style="gap:14px;align-content:start">
      <div class="card"><div class="card-h"><h2>📌 All day</h2><span class="sub">${allday.length}</span></div><div class="list">${allday.length ? allday.map(t => taskRow(t)).join("") : `<p class="muted" style="margin:0">No all-day tasks.</p>`}</div></div>
      ${aiPlanCard()}
      <div class="card"><div class="card-h"><h2>🗂️ Not scheduled</h2><span class="sub">${unscheduled.length}</span></div>
        <div class="list">${unscheduled.slice(0, 8).map(t => `<div class="li"><div class="grow" data-action="open-task" data-id="${t.id}" style="cursor:pointer"><b>${esc(t.title)}</b><small>${esc(t.area)} · ${esc(E.stageOf(t).name)}</small></div><button class="btn ghost" data-action="schedule" data-id="${t.id}" data-v="${sel}" style="padding:7px 10px">→ ${sel === tk ? "Today" : parseKey(sel).toLocaleDateString("en-GB", { weekday: "short" })}</button></div>`).join("") || `<p class="muted" style="margin:0">Everything has a date. 👏</p>`}</div></div>
    </div>
  </div>`;
}

/* ================= TASKS ================= */
function vTasks() {
  const area = t => U.areaFilter === "All" || t.area === U.areaFilter;
  const top = S.db.tasks.filter(t => !t.parent_id && area(t));
  const F = {
    open: ["Open", t => !E.isDone(t)],
    mine: ["Mine", t => !E.isDone(t) && t.assignee_id === me()],
    today: ["Today", t => !E.isDone(t) && (["today", "overdue"].includes(E.dueStatus(t)) || t.starred)],
    overdue: ["Overdue", t => E.dueStatus(t) === "overdue"],
    upcoming: ["Upcoming", t => !E.isDone(t) && ["week", "later"].includes(E.dueStatus(t))],
    done: ["Done", t => E.isDone(t)]
  };
  if (!F[U.taskFilter]) U.taskFilter = "open";
  const list = top.filter(F[U.taskFilter][1]).sort(U.taskFilter === "done" ? (a, b) => (b.completed_at || "").localeCompare(a.completed_at || "") : sortTasks);
  const wfs = E.workflows();
  if (!U.boardWf || !wfs.some(w => w.id === U.boardWf)) U.boardWf = E.defaultWorkflow()?.id;
  let body;
  if (U.taskMode === "board") {
    const wf = wfs.find(w => w.id === U.boardWf);
    const inWf = top.filter(t => (t.workflow_id || E.defaultWorkflow()?.id) === U.boardWf && (!E.isDone(t) || (t.completed_at && Date.now() - new Date(t.completed_at) < 14 * 864e5)));
    body = `<div class="filters">${wfs.map(w => `<button class="fchip ${w.id === U.boardWf ? "on" : ""}" data-action="board-wf" data-v="${w.id}">${esc(w.icon)} ${esc(w.name)}</button>`).join("")}</div>
    <div class="board">${(wf?.stages || []).map(s => { const cards = inWf.filter(t => (E.stagesOf(t).some(x => x.key === t.stage) ? t.stage : E.stagesOf(t)[0].key) === s.key).sort(sortTasks); return `<div class="col" data-drop-stage="${esc(s.key)}"><div class="col-h"><i style="--c:${s.color}"></i>${esc(s.name)}<b class="num">${cards.length}</b></div>
      ${cards.map(t => { const pg = E.progressOf(t.id); return `<div class="card-t" draggable="true" data-drag-task="${t.id}" data-action="open-task" data-id="${t.id}" style="--p:${PRI_C[t.priority]}"><div class="t">${t.starred ? "⭐ " : ""}${esc(t.title)}</div>${t.status_note && !E.isDone(t) ? `<div class="st-note">💬 ${esc(t.status_note)}</div>` : ""}<div class="meta">${t.due_date ? `<span class="chip ${E.dueStatus(t)}">${esc(dueLabel(t))}</span>` : ""}${pg ? `<span class="chip subbar">${pg.done}/${pg.total}<span><i style="width:${pg.pct * 100}%"></i></span></span>` : ""}${isTeam() && t.assignee_id ? avatar(t.assignee_id) : ""}</div></div>`; }).join("")}
      <button class="add-card" data-action="new-task" data-wf="${wf.id}" data-stage="${esc(s.key)}">＋ Add card</button></div>`; }).join("")}</div>
    <p class="swipe-hint">Drag cards between columns on a computer. On a phone, open a card and tap a stage.</p>`;
  } else if (!list.length) {
    body = S.db.tasks.length ? emptyBox("Nothing here", "Try another filter, or add something above.") : emptyBox("Your list is empty", "Type a task above, e.g. <b style='display:inline'>Send payslips tomorrow 3pm #work !high</b>");
  } else if (U.taskFilter === "open" || U.taskFilter === "mine") {
    const G = [["overdue", "Overdue", "var(--red)"], ["today", "Today", "var(--orange)"], ["week", "Next 7 days", "var(--yellow)"], ["later", "Later", "var(--accent)"], ["none", "No date", "var(--muted)"]];
    body = G.map(([k, l, c]) => { const items = list.filter(t => E.dueStatus(t) === k); return items.length ? `<div class="group-h"><i style="--c:${c}"></i>${l}<b class="num">${items.length}</b></div><div class="list">${items.map(t => taskRow(t)).join("")}</div>` : ""; }).join("");
  } else body = `<div class="list" style="margin-top:10px">${list.map(t => taskRow(t)).join("")}</div>`;
  const counts = Object.fromEntries(Object.entries(F).map(([k, [, f]]) => [k, top.filter(f).length]));
  return `
  <div class="view-h"><div><h1>Tasks</h1><p>${counts.open} open · ${counts.done} done${isTeam() ? ` · ${S.db.workspace_members.length} people` : ""}</p></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><div class="seg" role="group" aria-label="View"><button class="${U.taskMode === "list" ? "on" : ""}" data-action="task-mode" data-v="list">List</button><button class="${U.taskMode === "board" ? "on" : ""}" data-action="task-mode" data-v="board">Board</button></div>
    <div class="seg" role="group" aria-label="Area">${["All", ...AREAS].map(a => `<button class="${U.areaFilter === a ? "on" : ""}" data-action="area" data-v="${a}">${a}</button>`).join("")}</div></div></div>
  ${quickAdd("qa-tasks", "Add a task… e.g. Send payslips tomorrow 3pm #work !high")}
  ${AI_ON ? `<div style="margin-top:8px"><button class="ai-btn" data-action="capture"><span class="spark">✨</span>Say it in your own words</button></div>` : ""}
  ${U.taskMode === "list" ? `<div class="filters">${Object.entries(F).map(([k, [l]]) => `<button class="fchip ${U.taskFilter === k ? "on" : ""}" data-action="filter" data-v="${k}">${l}<b class="num">${counts[k]}</b></button>`).join("")}</div>` : ""}
  <div class="mt">${body}</div>
  ${U.taskMode === "list" && list.length ? `<div class="swipe-hint">Swipe right to finish · left to delete · tap to open steps & updates</div>` : ""}`;
}

/* ================= TASK DETAIL SHEET ================= */
function openSheet(html, cls = "") {
  const sh = $("#sheet"); sh.className = "sheet " + cls; sh.innerHTML = `<div class="grab"></div>` + html;
  $("#backdrop").classList.add("on"); requestAnimationFrame(() => sh.classList.add("on"));
  setTimeout(() => { const f = $("#sheet [autofocus]"); if (f && matchMedia("(min-width:820px)").matches) f.focus(); }, 380);
}
function closeSheet() {
  if (U.sheetAbort) { U.sheetAbort.abort(); U.sheetAbort = null; }
  $("#backdrop").classList.remove("on"); $("#sheet").classList.remove("on"); U.sheet = null;
}
$("#backdrop").addEventListener("click", closeSheet);
const picks = (name, opts, val, cls = {}) => `<div class="picks" data-pick="${name}">${opts.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<button type="button" class="pick ${val === v ? "on" : ""} ${cls[v] || ""}" data-v="${esc(v)}">${l}</button>`; }).join("")}</div>`;
const pickVal = n => $(`#sheet [data-pick="${n}"] .pick.on`)?.dataset.v ?? "";

function openTask(id) {
  const t = task(id); if (!t) return;
  U.sheet = { type: "task", id };
  openSheet(`<div id="ts"></div>`, "tall wide");
  refreshTaskSheet(true);
}
function stepTree(parentId, depth = 0) {
  return childrenOf(parentId).map(s => {
    const kids = E.childrenOf(s.id), open = U.expanded.has(s.id), done = E.isDone(s), pg = E.progressOf(s.id);
    return `<div class="node"><div class="srow ${done ? "done" : ""}">
      <button class="tw ${open ? "open" : ""}" data-action="expand" data-id="${s.id}" aria-label="${open ? "Collapse" : "Expand"}" style="${kids.length || open ? "" : "visibility:hidden"}">${I.chev}</button>
      <button class="check ${done ? "on" : ""}" data-action="toggle" data-id="${s.id}" aria-label="${done ? "Reopen" : "Complete"} step">${I.check}</button>
      <span class="t" data-action="open-task" data-id="${s.id}">${esc(s.title)}</span>
      ${pg ? `<span class="mini">${pg.done}/${pg.total}</span>` : ""}
      ${s.due_date ? `<span class="chip ${E.dueStatus(s)}">${esc(dueLabel(s))}</span>` : ""}
      ${isTeam() && s.assignee_id && s.assignee_id !== task(parentId)?.assignee_id ? avatar(s.assignee_id) : ""}
      ${depth < 4 ? `<button class="iconbtn-s" data-action="add-sub" data-id="${s.id}" aria-label="Add a sub-step">＋</button>` : ""}
    </div>
    ${open ? `<div class="kids">${stepTree(s.id, depth + 1)}<div class="inline-add"><input data-sub-input="${s.id}" placeholder="Add a sub-step and press Enter" aria-label="New sub-step"></div></div>` : ""}</div>`;
  }).join("");
}
const childrenOf = E.childrenOf;
function refreshTaskSheet(first) {
  const t = task(U.sheet?.id); const host = $("#ts");
  if (!host) return;
  if (!t) { closeSheet(); return; }
  const keep = {}; ["tf-title", "tf-notes", "upd-text", "step-new"].forEach(id => { const n = $("#" + id); if (n) keep[id] = n.value; });
  // keep the status form's date/time/stage only if the person changed them, so they never go stale
  ["upd-date", "upd-time"].forEach(id => { const n = $("#" + id); if (n && n.value !== n.defaultValue) keep[id] = n.value; });
  { const n = $("#upd-stage"); if (n && !n.options[n.selectedIndex]?.defaultSelected) keep["upd-stage"] = n.value; }
  const sub = {}; $$("[data-sub-input]").forEach(n => { if (n.value) sub[n.dataset.subInput] = n.value; });
  const aeId = document.activeElement?.id || (document.activeElement?.dataset?.subInput ? "sub:" + document.activeElement.dataset.subInput : null);
  const path = E.pathOf(t), wf = E.workflowOf(t), pg = E.progressOf(t.id);
  const ups = S.db.task_updates.filter(u => u.task_id === t.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const members = S.db.workspace_members.map(m => m.user_id);
  host.innerHTML = `
    ${path.length ? `<div class="crumbs">${path.map(p => `<button data-action="open-task" data-id="${p.id}">${esc(p.title)}</button><span>›</span>`).join("")}<span>this step</span></div>` : ""}
    <div style="display:flex;gap:10px;align-items:flex-start">
      <button class="check ${E.isDone(t) ? "on" : ""}" style="margin-top:8px" data-action="toggle" data-id="${t.id}" aria-label="${E.isDone(t) ? "Reopen" : "Complete"} task">${I.check}</button>
      <label for="tf-title" class="sr">Title</label><input class="title-inp" id="tf-title" data-tfield="title" value="${esc(t.title)}">
      <button class="star ${t.starred ? "on" : ""}" data-action="star" data-id="${t.id}" aria-label="Star">${I.star}</button>
    </div>
    <div class="field" style="margin-top:12px"><span class="lab">Stage · ${esc(wf?.icon || "")} ${esc(wf?.name || "")}</span><div class="stages">${E.stagesOf(t).map(s => `<button class="stage-chip ${s.key === E.stageOf(t).key ? "on" : ""}" style="--c:${s.color}" data-action="set-stage" data-v="${esc(s.key)}">${esc(s.name)}</button>`).join("")}</div></div>
    <div class="fgrid">
      <div class="field"><label for="tf-due">Due date</label><input class="inp" type="date" id="tf-due" data-tfield="due_date" value="${t.due_date || ""}"></div>
      <div class="field"><label for="tf-time">Time</label><input class="inp" type="time" id="tf-time" data-tfield="due_time" value="${fmtTime(t.due_time)}"></div>
      <div class="field"><label for="tf-pri">Priority</label><select class="inp" id="tf-pri" data-tfield="priority">${["High", "Medium", "Low"].map(p => `<option ${t.priority === p ? "selected" : ""}>${p}</option>`).join("")}</select></div>
      <div class="field"><label for="tf-area">Area</label><select class="inp" id="tf-area" data-tfield="area">${AREAS.map(a => `<option ${t.area === a ? "selected" : ""}>${a}</option>`).join("")}</select></div>
      <div class="field"><label for="tf-wf">Workflow</label><select class="inp" id="tf-wf" data-tfield="workflow_id">${E.workflows().map(w => `<option value="${w.id}" ${w.id === wf?.id ? "selected" : ""}>${esc(w.icon)} ${esc(w.name)}</option>`).join("")}</select></div>
      <div class="field"><label for="tf-rep">Repeat</label><select class="inp" id="tf-rep" data-tfield="repeat">${[["", "Never"], ["daily", "Every day"], ["weekdays", "Weekdays (Mon–Fri)"], ["weekly", "Every week"], ["monthly", "Every month"]].map(([v, l]) => `<option value="${v}" ${t.repeat === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      ${members.length > 1 ? `<div class="field"><label for="tf-as">Assigned to</label><select class="inp" id="tf-as" data-tfield="assignee_id"><option value="">Nobody</option>${members.map(u => `<option value="${u}" ${t.assignee_id === u ? "selected" : ""}>${esc(nameOf(u))}${u === me() ? " (me)" : ""}</option>`).join("")}</select></div>` : ""}
      <div class="field"><label for="tf-est">Estimate (min)</label><input class="inp" type="number" min="0" step="5" id="tf-est" data-tfield="estimate_min" value="${t.estimate_min ?? ""}" inputmode="numeric"></div>
    </div>
    <div class="field"><label for="tf-notes">Notes</label><textarea class="inp" id="tf-notes" data-tfield="notes" placeholder="Details, links, decisions…">${esc(t.notes)}</textarea></div>
    <div class="card" style="padding:14px;box-shadow:none">
      <div class="card-h" style="margin-bottom:8px"><h2>Steps ${pg ? `<span class="sub">${pg.done}/${pg.total} · ${Math.round(pg.pct * 100)}%</span>` : ""}</h2>${AI_ON ? `<button class="ai-btn" data-action="ai-breakdown" style="padding:6px 11px;font-size:12.5px"><span class="spark">✨</span>Break it down</button>` : ""}</div>
      ${pg ? `<div class="budget" style="padding:0 0 10px"><div class="track"><i style="width:${pg.pct * 100}%"></i></div></div>` : ""}
      <div class="tree">${stepTree(t.id)}</div>
      <div id="steps-status"></div>
      <div class="inline-add" style="margin-top:8px"><input id="step-new" placeholder="Add a step and press Enter" aria-label="New step"></div>
      <p class="muted" style="font-size:12px;margin:8px 2px 0">Steps can have their own steps, as many levels deep as you need. Tap a step to give it a date, owner or notes.</p>
    </div>
    <div class="card" style="padding:14px;box-shadow:none;margin-top:12px">
      <div class="card-h" style="margin-bottom:4px"><h2>Status & timeline</h2><span class="sub">${ups.length}</span></div>
      ${t.status_note ? `<div class="status-now"><span class="lab">Current status</span><p>${esc(t.status_note)}</p><small>${t.status_at ? timeAgo(t.status_at) : ""}${t.due_date ? ` · next: ${esc(dueLabel(t))}` : ""}</small></div>` : ""}
      <div class="activity">${ups.length ? ups.map(u => u.kind === "comment" ? `<div class="upd">${avatar(u.author_id, true)}<div class="bubble"><b>${esc(nameOf(u.author_id))}</b><small>${timeAgo(u.created_at)}</small><p>${esc(u.body)}</p>${u.new_due_date || u.new_due_time ? `<em class="next">→ Next: ${esc(dueLabel({ due_date: u.new_due_date || t.due_date, due_time: u.new_due_time || (u.new_due_date ? null : t.due_time) }))}</em>` : ""}</div></div>` : `<div class="upd sys"><i style="--c:${u.to_stage ? (E.stagesOf(t).find(s => s.key === u.to_stage)?.color || "var(--muted)") : "var(--muted)"}"></i><span>${esc(u.body)} · ${timeAgo(u.created_at)}</span></div>`).join("") : `<p class="muted" style="margin:0;font-size:13px">No updates yet. Add the latest status below. You can move the date and time at the same time, and every update stays here as a timeline.</p>`}</div>
      <div class="post status-form">
        <label for="upd-text" class="sr">Status update</label><textarea class="inp" id="upd-text" placeholder="What's the latest? e.g. Sent to HR, waiting for approval"></textarea>
        <div class="fgrid upd-grid">
          <div class="field"><label for="upd-date">Next date</label><input class="inp" type="date" id="upd-date" value="${t.due_date || ""}"></div>
          <div class="field"><label for="upd-time">Time</label><input class="inp" type="time" id="upd-time" value="${fmtTime(t.due_time)}"></div>
          <div class="field"><label for="upd-stage">Stage</label><select class="inp" id="upd-stage">${E.stagesOf(t).map(s => `<option value="${esc(s.key)}" ${s.key === E.stageOf(t).key ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>
        </div>
        <button class="btn" data-action="post-update">Save update</button>
      </div>
    </div>
    <div class="sheet-actions" style="margin-top:14px"><button class="btn danger" data-action="delete-task" data-id="${t.id}">Delete</button>${!E.isDone(t) ? `<button class="btn ghost" data-action="focus-task" data-id="${t.id}">⏱ Focus</button>` : ""}<button class="btn" data-action="close-sheet">Done</button></div>
    <p class="muted" style="font-size:11.5px;text-align:center;margin:10px 0 0">Created ${timeAgo(t.created_at)} by ${esc(nameOf(t.created_by))}${t.completed_at ? ` · finished ${timeAgo(t.completed_at)}` : ""}</p>`;
  Object.entries(keep).forEach(([id, v]) => { const n = $("#" + id); if (n && v !== undefined && document.activeElement !== n) n.value = v; });
  Object.entries(sub).forEach(([id, v]) => { const n = $(`[data-sub-input="${id}"]`); if (n) n.value = v; });
  if (aeId) { const n = aeId.startsWith("sub:") ? $(`[data-sub-input="${aeId.slice(4)}"]`) : $("#" + aeId); if (n && !first) n.focus(); }
}
async function saveTaskField(el) {
  const t = task(U.sheet?.id); if (!t) return;
  const f = el.dataset.tfield; let v = el.value;
  if (f === "title") { v = v.trim(); if (!v) { el.value = t.title; return; } }
  if (f === "due_date" || f === "due_time" || f === "assignee_id" || f === "workflow_id") v = v || null;
  if (f === "estimate_min") v = v === "" ? null : Math.max(0, parseInt(v, 10) || 0);
  if ((t[f] ?? null) === v || (f === "due_time" && fmtTime(t[f]) === (v || ""))) return;
  await E.changeTask(t, { [f]: v });
}

/* ================= ROUTINE ================= */
function vRoutine() {
  const items = S.db.routine_items.filter(r => !r.archived).sort((a, b) => (a.time_of_day || "99").localeCompare(b.time_of_day || "99") || a.position - b.position);
  const today = routineToday(); const done = today.filter(r => logged(r)).length;
  const last30 = [...Array(30)].map((_, i) => addDays(new Date(), i - 29));
  const pct = today.length ? done / today.length : 0;
  const best = items.map(r => [r, streak(r)]).sort((a, b) => b[1] - a[1])[0];
  return `
  <div class="view-h"><div><h1>Daily routine</h1><p>Your habits and fixed times, tracked every day</p></div><button class="btn" data-action="routine-new">${I.plus}New item</button></div>
  <div class="grid g-hero">
    <div class="card hero"><div class="ring">${ring(pct)}<div class="lbl"><div><b class="num">${done}/${today.length}</b><small>done today</small></div></div></div>
      <div class="hero-copy"><h2>${pct === 1 ? "Routine complete 🎉" : "Keep the chain going"}</h2><p>${best && best[1] ? `Longest streak: ${esc(best[0].icon)} ${esc(best[0].name)}, ${best[1]} days.` : "Tick items as you do them. Streaks build from day one."}</p></div></div>
    <div class="card"><div class="card-h"><h2>Today</h2><span class="sub">${new Date().toLocaleDateString("en-GB", { weekday: "long" })}</span></div>
      <div class="list">${today.map(r => { const on = logged(r); return `<button class="rt ${on ? "on" : ""}" data-action="routine" data-id="${r.id}" aria-pressed="${on}"><span class="ic">${esc(r.icon)}</span><span class="t">${esc(r.name)}</span>${r.time_of_day ? `<span class="chip">${fmtTime(r.time_of_day)}</span>` : ""}<span class="check ${on ? "on" : ""}">${I.check}</span></button>`; }).join("") || `<p class="muted" style="margin:0">Nothing scheduled for today.</p>`}</div></div>
  </div>
  <div class="card mt"><div class="card-h"><h2>All items · last 30 days</h2><span class="sub">Tap an item to edit</span></div>
    <div class="list">${items.map(r => { const st = streak(r); const n = last30.filter(d => logged(r, dkey(d))).length; const sched = last30.filter(d => r.days.includes(d.getDay())).length; return `<div class="li" style="display:block"><div style="display:flex;align-items:center;gap:12px"><span style="font-size:24px">${esc(r.icon)}</span><div class="grow" data-action="routine-edit" data-id="${r.id}" style="cursor:pointer"><b>${esc(r.name)}</b><small>${r.time_of_day ? fmtTime(r.time_of_day) + " · " : ""}${r.days.length === 7 ? "Every day" : r.days.map(d => DOW_S[d]).join(" ")} · ${st ? `🔥 ${st}-day streak · ` : ""}${sched ? Math.round(n / sched * 100) : 0}% in 30 days</small></div></div>
      <div class="heat">${last30.map(d => `<i class="${logged(r, dkey(d)) ? "y" : ""} ${r.days.includes(d.getDay()) ? "" : "off"}" title="${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}"></i>`).join("")}</div></div>`; }).join("") || emptyBox("No routine items", "Add habits like Workout, Reading or Prayer times.", I.routine)}</div></div>`;
}
function routineSheet(r) {
  const isNew = !r; r = r || { id: uuid(), name: "", icon: "✅", time_of_day: null, days: [0, 1, 2, 3, 4, 5, 6], position: S.db.routine_items.length };
  U.sheet = { type: "routine" };
  openSheet(`<h2 id="sheet-title">${isNew ? "New routine item" : "Edit routine item"}</h2>
  <form data-form="routine" data-id="${r.id}" data-new="${isNew ? 1 : ""}">
    <div class="two"><div class="field" style="grid-column:span 1"><label for="rf-name">Name</label><input class="inp" id="rf-name" value="${esc(r.name)}" required autofocus placeholder="e.g. Workout"></div>
    <div class="field"><label for="rf-icon">Icon (emoji)</label><input class="inp" id="rf-icon" value="${esc(r.icon)}" maxlength="4"></div></div>
    <div class="field"><label for="rf-time">Time (optional)</label><input class="inp" type="time" id="rf-time" value="${fmtTime(r.time_of_day)}"></div>
    <div class="field"><span class="lab">Days</span><div class="daysel">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button type="button" class="${r.days.includes(d) ? "on" : ""}" data-day="${d}">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d].slice(0, 2)}</button>`).join("")}</div></div>
    <div class="sheet-actions">${isNew ? "" : `<button type="button" class="btn danger" data-action="routine-del" data-id="${r.id}">Delete</button>`}<button class="btn" type="submit">${isNew ? "Add" : "Save"}</button></div>
  </form>`);
}

/* ================= MONEY ================= */
function monthData(mk) {
  const inMonth = S.db.expenses.filter(x => x.date.startsWith(mk));
  const spent = inMonth.filter(x => x.flow !== "in").reduce((s, x) => s + +x.amount, 0);
  const income = inMonth.filter(x => x.flow === "in").reduce((s, x) => s + +x.amount, 0);
  const byCat = {}; inMonth.filter(x => x.flow !== "in").forEach(x => byCat[x.category] = (byCat[x.category] || 0) + +x.amount);
  return { inMonth, spent, income, byCat };
}
function vMoney(animate) {
  const mk = U.month, [yy, mm] = mk.split("-").map(Number);
  const monthName = new Date(yy, mm - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const { inMonth, spent, income, byCat } = monthData(mk);
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const isCur = mk === dkey().slice(0, 7), dim = new Date(yy, mm, 0).getDate(), elapsed = isCur ? new Date().getDate() : dim;
  const perDay = spent / elapsed, forecast = isCur ? perDay * dim : spent;
  const budgets = Object.fromEntries(S.db.budgets.map(b => [b.category, +b.amount])), totalB = Object.values(budgets).reduce((a, b) => a + b, 0);
  const R = 56, C = 2 * Math.PI * R; let acc = 0;
  const segs = cats.map(([k, v]) => { const len = spent ? v / spent * C : 0; const s = `<circle class="seg" cx="70" cy="70" r="${R}" stroke="${CATS[k]?.[1] || "#7C8691"}" stroke-dasharray="${animate ? `0 ${C}` : `${Math.max(0, len - 2)} ${C}`}" data-len="${Math.max(0, len - 2)} ${C}" stroke-dashoffset="${-acc}"><title>${esc(k)}: ${money(v)}</title></circle>`; acc += len; return s; }).join("");
  const months = [...Array(6)].map((_, i) => { const d = new Date(yy, mm - 1 - (5 - i), 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; });
  const mT = months.map(m => monthData(m).spent), maxM = Math.max(1, ...mT);
  const sorted = [...inMonth].sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
  const groups = {}; sorted.forEach(x => (groups[x.date] = groups[x.date] || []).push(x));
  const budRows = Object.entries(budgets).sort((a, b) => (byCat[b[0]] || 0) / b[1] - (byCat[a[0]] || 0) / a[1]);
  let aiBody = "";
  if (AI_ON) {
    if (U.monthAIState === "loading") aiBody = thinking("Claude is reading your month…");
    else if (U.monthAIState === "error") aiBody = `<p class="muted" style="margin:0 0 10px">${esc(U.monthAIErr)}</p><button class="ai-btn" data-action="ai-month"><span class="spark">✨</span>Try again</button>`;
    else if (U.monthAI && U.monthAIFor === mk) aiBody = `<div class="ai-out">${esc(U.monthAI)}</div><div style="margin-top:10px"><button class="btn ghost" data-action="ai-month">Refresh</button></div>`;
    else aiBody = `<p class="muted" style="margin:0 0 12px">A plain-English read on ${esc(monthName.split(" ")[0])}: where the money went, what's unusual, one thing to try.</p><button class="ai-btn" data-action="ai-month" ${inMonth.length ? "" : "disabled"}><span class="spark">✨</span>Explain my month</button>`;
  }
  return `
  <div class="view-h"><div><h1>Money</h1><p>Private to you, even in shared workspaces</p></div>
    <div class="month-nav"><button class="icon-btn" data-action="month" data-v="-1" aria-label="Previous month">${I.left}</button><b style="min-width:130px;text-align:center">${monthName}</b><button class="icon-btn" data-action="month" data-v="1" aria-label="Next month">${I.right}</button></div></div>
  <div class="grid g-stats">
    <div class="card stat hov" style="--c:var(--red)"><div class="k"><i></i>Spent</div><div class="v num" data-count="${Math.round(spent)}">0</div><div class="d">${CURRENCY}${totalB ? ` · ${Math.round(spent / totalB * 100)}% of budget` : ""}</div></div>
    <div class="card stat hov" style="--c:var(--green)"><div class="k"><i></i>Received</div><div class="v num" data-count="${Math.round(income)}">0</div><div class="d">${CURRENCY}</div></div>
    <div class="card stat hov" style="--c:${income - spent >= 0 ? "var(--accent)" : "var(--red)"}"><div class="k"><i></i>Net</div><div class="v num" data-count="${Math.round(income - spent)}" data-fmt="sign">0</div><div class="d">${CURRENCY}</div></div>
    <div class="card stat hov" style="--c:var(--gold)"><div class="k"><i></i>${isCur ? "Month-end forecast" : "Daily average"}</div><div class="v num" data-count="${Math.round(isCur ? forecast : perDay)}">0</div><div class="d">${isCur ? `at ${money(perDay)}/day${totalB ? (forecast > totalB ? " · ⚠️ over budget" : " · within budget") : ""}` : `${CURRENCY} per day`}</div></div>
  </div>
  <div class="grid g-2 mt">
    <div class="card"><div class="card-h"><h2>Where it went</h2><span class="sub">${cats.length} categories</span></div>
      ${cats.length ? `<div class="donut-wrap"><div class="donut"><svg viewBox="0 0 140 140"><circle cx="70" cy="70" r="${R}" stroke="var(--surface-2)" style="stroke-width:18"/>${segs}</svg><div class="c"><div><b class="num">${nf.format(Math.round(spent))}</b><small>${CURRENCY} spent</small></div></div></div>
      <div class="legend">${cats.slice(0, 6).map(([k, v]) => `<div><i style="--c:${CATS[k]?.[1] || "#7C8691"}"></i><span>${CATS[k]?.[0] || "✨"} ${esc(k)}</span><b>${Math.round(v / spent * 100)}%</b></div>`).join("")}</div></div>` : emptyBox(`No spending in ${monthName.split(" ")[0]}`, "Tap ＋ and choose Expense.", I.money)}</div>
    <div class="card"><div class="card-h"><h2>Budgets</h2><button class="link" data-action="budgets">${budRows.length ? "Edit" : "Set budgets"}</button></div>
      ${budRows.length ? budRows.map(([k, b]) => { const s = byCat[k] || 0, p = s / b; return `<div class="budget ${p > 1 ? "over" : p > .8 ? "warn" : ""}"><div class="bh">${CATS[k]?.[0] || ""} ${esc(k)}<span class="num">${nf.format(Math.round(s))} / ${nf.format(b)}${p > 1 ? " · over!" : ""}</span></div><div class="track"><i style="width:${animate ? 0 : Math.min(100, p * 100)}%" data-w="${Math.min(100, p * 100)}"></i></div></div>`; }).join("") : `<p class="muted" style="margin:0 0 12px">Set a monthly limit per category. Bars turn amber at 80% and red when you go over.</p><button class="btn" data-action="budgets">Set budgets</button>`}</div>
    <div class="card"><div class="card-h"><h2>6-month trend</h2><span class="sub">${CURRENCY} spent</span></div>
      <div class="bars" style="height:150px">${months.map((m, i) => { const d = new Date(+m.slice(0, 4), +m.slice(5) - 1, 1), h = Math.max(3, mT[i] / maxM * 100); return `<div class="bar"><div class="col ${i === 5 ? "hi" : ""}" style="height:${animate ? 3 : h}%" data-h="${h}"><span class="num">${nf.format(mT[i])}</span></div><small>${d.toLocaleDateString("en-GB", { month: "short" })}</small></div>`; }).join("")}</div></div>
    ${AI_ON ? `<div class="card ai-card"><div class="card-h"><h2>✨ Money insights</h2><span class="sub">Claude</span></div>${aiBody}</div>` : ""}
  </div>
  <div class="card mt"><div class="card-h"><h2>Entries</h2><div style="display:flex;gap:8px">${inMonth.length ? `<button class="btn ghost" data-action="csv" style="padding:8px 12px">Copy CSV</button>` : ""}<button class="btn" data-action="new-expense" style="padding:8px 12px">${I.plus}Add</button></div></div>
    ${sorted.length ? Object.entries(groups).map(([d, xs]) => `<div class="group-h"><i style="--c:var(--accent)"></i>${parseKey(d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}<b class="num">${money(xs.filter(x => x.flow !== "in").reduce((s, x) => s + +x.amount, 0))}</b></div><div class="list money-list">${xs.map(x => { const c = CATS[x.category] || CATS.Other; return `<div class="row" style="--c:${c[1]}"><span class="cat-ic" style="--c:${c[1]}">${c[0]}</span><div class="main" data-action="edit-expense" data-id="${x.id}" role="button" tabindex="0"><div class="t">${esc(x.title)}</div><div class="meta"><span class="chip">${esc(x.category)}</span><span class="chip">${esc(x.paid_by)}</span>${x.note ? `<span class="chip">📝 ${esc(x.note.slice(0, 30))}</span>` : ""}</div></div><span class="${x.flow === "in" ? "amt-in" : "amt-out"}">${x.flow === "in" ? "+" : "−"}${nf2.format(+x.amount)}</span></div>`; }).join("")}</div>`).join("") : `<p class="muted" style="margin:0">No entries in ${monthName}.</p>`}</div>`;
}
function expenseSheet(x) {
  const isNew = !x; x = x || { id: uuid(), title: "", amount: "", flow: "out", category: "Food", paid_by: "Card", date: dkey(), note: "" };
  U.sheet = { type: "expense" };
  openSheet(`<h2 id="sheet-title">${isNew ? "New entry" : "Edit entry"}</h2>
  <form data-form="expense" data-id="${x.id}" data-new="${isNew ? 1 : ""}">
    <div class="field">${picks("flow", [["out", "💸 Spent"], ["in", "💵 Received"]], x.flow, { out: "red", in: "green" })}</div>
    <div class="field"><label for="ef-amt">Amount (${CURRENCY})</label><input class="inp amt num" id="ef-amt" inputmode="decimal" value="${esc(x.amount)}" placeholder="0" required autofocus></div>
    <div class="field"><label for="ef-title">What for</label><input class="inp" id="ef-title" value="${esc(x.title)}" placeholder="e.g. Groceries at Carrefour"></div>
    <div class="field"><span class="lab">Category</span>${picks("cat", Object.keys(CATS).map(k => [k, `${CATS[k][0]} ${k}`]), x.category)}</div>
    <div class="two"><div class="field"><label for="ef-date">Date</label><input class="inp" type="date" id="ef-date" value="${x.date}"></div>
    <div class="field"><label for="ef-paid">Paid by</label><select class="inp" id="ef-paid">${["Card", "Cash", "Bank transfer", "Me", "Someone else"].map(v => `<option ${x.paid_by === v ? "selected" : ""}>${v}</option>`).join("")}</select></div></div>
    <div class="field"><label for="ef-note">Note</label><input class="inp" id="ef-note" value="${esc(x.note)}" placeholder="Who holds the cash, split details…"></div>
    <div class="sheet-actions">${isNew ? "" : `<button type="button" class="btn danger" data-action="del-expense" data-id="${x.id}">Delete</button>`}<button class="btn" type="submit">${isNew ? "Add entry" : "Save"}</button></div>
  </form>`);
}
function budgetSheet() {
  const b = Object.fromEntries(S.db.budgets.map(x => [x.category, +x.amount]));
  const avg = k => { const ms = [1, 2, 3].map(i => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }); return Math.round(ms.reduce((s, m) => s + (monthData(m).byCat[k] || 0), 0) / 3); };
  U.sheet = { type: "budgets" };
  openSheet(`<h2 id="sheet-title">Monthly budgets</h2><p class="muted" style="margin:-6px 0 14px;font-size:13.5px">${CURRENCY} per month. Leave empty for no limit. Grey shows your 3-month average.</p>
  <form data-form="budgets"><div class="bud-grid">${Object.keys(CATS).filter(k => k !== "Salary").map(k => { const a = avg(k); return `<label for="bud-${k}">${CATS[k][0]} ${k}${a ? ` <span style="font-weight:600">· avg ${nf.format(a)}</span>` : ""}<input class="inp num" id="bud-${k}" data-cat="${k}" inputmode="numeric" value="${b[k] || ""}" placeholder="No limit"></label>`; }).join("")}</div>
  <div class="sheet-actions" style="margin-top:16px"><button class="btn" type="submit">Save budgets</button></div></form>`);
}

/* ================= FOCUS ================= */
const FT = { mode: "focus", len: 1500, left: 1500, running: false, timer: null, endAt: 0, taskId: "" };
function vFocus() {
  const tk = dkey(), today = S.db.focus_sessions.filter(f => f.day === tk);
  const wk = [...Array(7)].map((_, i) => { const d = addDays(new Date(), i - 6); return { d, n: S.db.focus_sessions.filter(f => f.day === dkey(d)).reduce((s, f) => s + f.minutes, 0) }; });
  const maxW = Math.max(1, ...wk.map(x => x.n)), C = 2 * Math.PI * 52;
  const open = S.db.tasks.filter(t => !E.isDone(t) && (!t.assignee_id || t.assignee_id === me())).sort((a, b) => (b.starred - a.starred) || sortTasks(a, b));
  const ft = task(FT.taskId);
  return `
  <div class="view-h"><div><h1>Focus</h1><p>25 minutes on one thing, then a short break</p></div></div>
  <div class="grid g-2">
    <div class="card focus-card">
      <div class="seg"><button class="${FT.mode === "focus" ? "on" : ""}" data-action="ft-mode" data-v="focus">Focus 25</button><button class="${FT.mode === "short" ? "on" : ""}" data-action="ft-mode" data-v="short">Break 5</button><button class="${FT.mode === "long" ? "on" : ""}" data-action="ft-mode" data-v="long">Long 15</button></div>
      <div class="fring ${FT.mode !== "focus" ? "brk" : ""} ${FT.running ? "run" : ""}"><svg viewBox="0 0 120 120"><circle class="trk" cx="60" cy="60" r="52" fill="none" stroke-width="7"/><circle class="val" id="fval" cx="60" cy="60" r="52" fill="none" stroke-width="7" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - FT.left / FT.len)}"/></svg>
        <div class="c"><div><b id="ftime">${fmtT(FT.left)}</b><small>${FT.mode === "focus" ? esc(ft ? ft.title.slice(0, 26) : "Focus") : "Break"}</small></div></div></div>
      <div class="field" style="max-width:340px;margin:0 auto;text-align:left"><label for="ft-task">Working on</label><select class="inp" id="ft-task"><option value="">Choose a task (optional)</option>${open.map(t => `<option value="${t.id}" ${FT.taskId === t.id ? "selected" : ""}>${t.starred ? "⭐ " : ""}${esc(t.title)}</option>`).join("")}</select></div>
      <div class="controls"><button class="btn" data-action="ft-toggle" style="min-width:130px">${FT.running ? "Pause" : FT.left < FT.len ? "Resume" : "Start"}</button><button class="btn ghost" data-action="ft-reset">Reset</button>${ft && FT.mode === "focus" ? `<button class="btn ghost" data-action="ft-finish">✓ Task done</button>` : ""}</div>
    </div>
    <div class="grid" style="gap:14px;align-content:start">
      <div class="grid g-stats" style="grid-template-columns:1fr 1fr">
        <div class="card stat hov" style="--c:var(--accent)"><div class="k"><i></i>Today</div><div class="v num">${today.length}<small>· ${today.reduce((s, f) => s + f.minutes, 0)} min</small></div><div class="d">Four is a strong day</div></div>
        <div class="card stat hov" style="--c:var(--gold)"><div class="k"><i></i>This week</div><div class="v num">${Math.round(wk.reduce((s, x) => s + x.n, 0) / 6) / 10}<small>h</small></div><div class="d">Last 7 days</div></div>
      </div>
      <div class="card"><div class="card-h"><h2>Focus minutes</h2><span class="sub">Last 7 days</span></div><div class="bars">${wk.map((x, i) => `<div class="bar"><div class="col ${i === 6 ? "hi" : ""}" style="height:${Math.max(4, x.n / maxW * 100)}%"><span class="num">${x.n}</span></div><small>${x.d.toLocaleDateString("en-GB", { weekday: "narrow" })}</small></div>`).join("")}</div></div>
    </div>
  </div>`;
}
const fmtT = s => `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
function ftTick() {
  FT.left = Math.max(0, Math.round((FT.endAt - Date.now()) / 1000));
  const t = $("#ftime"), v = $("#fval"); if (t) t.textContent = fmtT(FT.left); if (v) v.style.strokeDashoffset = 2 * Math.PI * 52 * (1 - FT.left / FT.len);
  document.title = FT.running ? `${fmtT(FT.left)} · TaskerBay` : "TaskerBay";
  if (FT.left <= 0) ftDone();
}
function setMode(m) { FT.mode = m; FT.len = { focus: 25, short: 5, long: 15 }[m] * 60; FT.left = FT.len; }
let actx;
function beep() { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); [0, .18, .36].forEach((t, i) => { const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = [660, 880, 990][i]; g.gain.setValueAtTime(.0001, actx.currentTime + t); g.gain.exponentialRampToValueAtTime(.25, actx.currentTime + t + .02); g.gain.exponentialRampToValueAtTime(.0001, actx.currentTime + t + .16); o.connect(g).connect(actx.destination); o.start(actx.currentTime + t); o.stop(actx.currentTime + t + .18); }); } catch (e) {} }
async function ftDone() {
  clearInterval(FT.timer); FT.running = false; document.title = "TaskerBay"; beep(); buzz([120, 80, 120]);
  if (FT.mode === "focus") {
    await insert("focus_sessions", { id: uuid(), user_id: me(), task_id: FT.taskId || null, minutes: 25, day: dkey(), created_at: new Date().toISOString() });
    burst(innerWidth / 2, innerHeight / 2.5, 40); toast("Session complete. Take a 5-minute break."); setMode("short");
  } else { toast("Break over. Ready for another?"); setMode("focus"); }
  if (U.view === "focus") render();
}

/* ================= TEAM & UPDATES ================= */
function vTeam() {
  const w = ws(), admin = ["owner", "admin"].includes(myRole());
  const feed = [...S.db.task_updates].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 40);
  const byPerson = S.db.workspace_members.map(m => { const ts = S.db.tasks.filter(t => t.assignee_id === m.user_id && !E.isDone(t)); return { m, open: ts.length, overdue: ts.filter(t => E.dueStatus(t) === "overdue").length, done: S.db.tasks.filter(t => t.assignee_id === m.user_id && t.completed_at && Date.now() - new Date(t.completed_at) < 7 * 864e5).length }; });
  return `
  <div class="view-h"><div><h1>${esc(w?.icon || "")} ${esc(w?.name || "Workspace")}</h1><p>${S.db.workspace_members.length} member${S.db.workspace_members.length === 1 ? "" : "s"} · you are ${myRole()}</p></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">${admin ? `<button class="btn ghost" data-action="ws-edit">Rename</button>` : ""}<button class="btn" data-action="ws-new">${I.plus}New workspace</button></div></div>
  <div class="grid g-2">
    <div class="card"><div class="card-h"><h2>People & workload</h2>${admin ? `<button class="link" data-action="invite">＋ Invite</button>` : ""}</div>
      <div class="list">${byPerson.map(({ m, open, overdue, done }) => `<div class="li">${avatar(m.user_id, true)}<div class="grow"><b>${esc(nameOf(m.user_id))}${m.user_id === me() ? " (you)" : ""}</b><small>${m.role} · ${open} open${overdue ? ` · <span style="color:var(--red)">${overdue} overdue</span>` : ""} · ${done} done this week</small></div>${admin && m.user_id !== me() && m.role !== "owner" ? `<select class="inp" style="width:auto;padding:7px" data-role-for="${m.user_id}" aria-label="Role"><option ${m.role === "member" ? "selected" : ""}>member</option><option ${m.role === "admin" ? "selected" : ""}>admin</option></select><button class="iconbtn-s" data-action="member-remove" data-id="${m.user_id}" aria-label="Remove">×</button>` : ""}</div>`).join("")}
      ${S.db.workspace_invites.map(i => `<div class="li" style="opacity:.75"><span class="av lg" style="--c:#7C8691">✉️</span><div class="grow"><b>${esc(i.email)}</b><small>Invited as ${i.role}. They join automatically when they sign up or sign in with this email.</small></div>${admin ? `<button class="iconbtn-s" data-action="invite-cancel" data-id="${i.id}" aria-label="Cancel invite">×</button>` : ""}</div>`).join("")}</div>
      ${S.db.workspace_members.length === 1 ? `<p class="muted" style="font-size:13px;margin:12px 2px 0">Invite family or colleagues to share tasks, assign work and post status updates. Your Money, Routine and Journal always stay private.</p>` : ""}
    </div>
    <div class="card"><div class="card-h"><h2>Latest updates</h2><span class="sub">Across this workspace</span></div>
      <div class="activity feed">${feed.length ? feed.map(u => { const t = task(u.task_id); return u.kind === "comment" ? `<div class="upd">${avatar(u.author_id, true)}<div class="bubble"><b>${esc(nameOf(u.author_id))}</b><small>${timeAgo(u.created_at)}</small><p>${esc(u.body)}</p>${t ? `<span class="on-task" data-action="open-task" data-id="${t.id}">on “${esc(t.title)}” →</span>` : ""}</div></div>` : `<div class="upd sys" ${t ? `data-action="open-task" data-id="${t.id}" style="cursor:pointer"` : ""}><i></i><span>${esc(u.body)}${t ? ` · <b style="color:var(--ink)">${esc(t.title)}</b>` : ""} · ${timeAgo(u.created_at)}</span></div>`; }).join("") : `<p class="muted" style="margin:0">No updates yet. Status changes and posts appear here.</p>`}</div></div>
  </div>
  <div class="card mt"><div class="card-h"><h2>Your workspaces</h2></div><div class="list">${S.db.workspaces.map(x => `<button class="li" data-action="ws-go" data-id="${x.id}" style="text-align:left;width:100%"><span style="font-size:24px">${esc(x.icon)}</span><div class="grow"><b>${esc(x.name)}</b><small>${x.id === S.wsId ? "Current workspace" : "Tap to switch"}</small></div>${x.id === S.wsId ? `<span class="chip today">Active</span>` : ""}</button>`).join("")}</div></div>`;
}

/* ================= WORKFLOWS ================= */
function vWorkflows() {
  const admin = ["owner", "admin"].includes(myRole());
  return `
  <div class="view-h"><div><h1>Workflows</h1><p>The stages a task moves through. Each task can use a different one.</p></div>${admin ? `<button class="btn" data-action="wf-new">${I.plus}New workflow</button>` : ""}</div>
  <div class="list">${E.workflows().map(w => { const used = S.db.tasks.filter(t => t.workflow_id === w.id && !E.isDone(t)).length; return `<div class="card hov" style="cursor:pointer" data-action="wf-edit" data-id="${w.id}"><div class="card-h"><h2>${esc(w.icon)} ${esc(w.name)} ${w.is_default ? `<span class="chip today" style="margin-left:6px">Default</span>` : ""}</h2><span class="sub">${used} active task${used === 1 ? "" : "s"}</span></div>
    <div class="stages">${w.stages.map((s, i) => `<span class="stage-chip" style="--c:${s.color}">${esc(s.name)}</span>${i < w.stages.length - 1 ? `<span class="muted">→</span>` : ""}`).join("")}</div></div>`; }).join("")}</div>
  <p class="muted mt" style="font-size:13px">Tip: the <b>Payroll cycle</b> workflow matches a monthly payroll run. Combine it with <b>Repeat: every month</b> and steps, and next month's run is created for you when this one is done.</p>`;
}
function wfSheet(w) {
  const isNew = !w; w = w ? JSON.parse(JSON.stringify(w)) : { id: uuid(), name: "", icon: "🔀", is_default: false, position: S.db.workflows.length, stages: [{ key: "todo", name: "To do", color: "#64748B", type: "todo" }, { key: "doing", name: "In progress", color: "#3B6FD4", type: "active" }, { key: "done", name: "Done", color: "#2E9B5B", type: "done" }] };
  U.sheet = { type: "workflow", wf: w, isNew };
  const row = (s, i) => `<div class="stage-edit" data-si="${i}"><input type="color" value="${esc(s.color)}" aria-label="Colour"><input class="inp" value="${esc(s.name)}" aria-label="Stage name" placeholder="Stage name"><select class="inp" aria-label="Stage type"><option value="todo" ${s.type === "todo" ? "selected" : ""}>Not started</option><option value="active" ${s.type === "active" ? "selected" : ""}>Active</option><option value="done" ${s.type === "done" ? "selected" : ""}>Done</option></select><button type="button" class="iconbtn-s" data-action="st-up" aria-label="Move up">↑</button><button type="button" class="iconbtn-s" data-action="st-down" aria-label="Move down">↓</button><button type="button" class="iconbtn-s" data-action="st-del" aria-label="Remove">×</button></div>`;
  openSheet(`<h2 id="sheet-title">${isNew ? "New workflow" : "Edit workflow"}</h2>
  <form data-form="workflow">
    <div class="two"><div class="field"><label for="wf-name">Name</label><input class="inp" id="wf-name" value="${esc(w.name)}" required autofocus placeholder="e.g. Hiring"></div><div class="field"><label for="wf-icon">Icon</label><input class="inp" id="wf-icon" value="${esc(w.icon)}" maxlength="4"></div></div>
    <div class="field"><span class="lab">Stages, in order</span><div id="wf-stages">${w.stages.map(row).join("")}</div><button type="button" class="btn ghost" data-action="st-add" style="margin-top:4px">＋ Add stage</button>
    <p class="muted" style="font-size:12px;margin:6px 0 0">Mark at least one stage as <b>Done</b>: tasks there count as finished, trigger repeats and roll up to their parent.</p></div>
    <label class="switch-row"><span><b>Default workflow</b><br><small class="muted">New tasks use this unless you choose another</small></span><input type="checkbox" id="wf-def" ${w.is_default ? "checked" : ""} style="width:22px;height:22px;accent-color:var(--accent)"></label>
    <div class="sheet-actions">${!isNew ? `<button type="button" class="btn danger" data-action="wf-del">Delete</button>` : ""}<button class="btn" type="submit">${isNew ? "Create" : "Save"}</button></div>
  </form>`);
  U.stageRow = row;
}
function readStages() {
  return $$("#wf-stages .stage-edit").map((r, i) => { const [color, name] = $$("input", r); const type = $("select", r).value; const nm = name.value.trim(); return nm ? { key: (U.sheet.wf.stages[+r.dataset.si]?.key) || (nm.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "s" + i), name: nm, color: color.value, type } : null; }).filter(Boolean);
}

/* ================= AUTOMATIONS ================= */
function describeRule(a) {
  const c = a.conditions || {}, wfStageName = k => { for (const w of S.db.workflows) { const s = w.stages.find(s => s.key === k); if (s) return s.name; } return k; };
  let when = E.TRIGGERS[a.trigger] || a.trigger;
  if (a.trigger === "stage_changed" && c.to_stage) when = `A task moves to <b>${esc(wfStageName(c.to_stage))}</b>`;
  const ifs = [c.area && `area is <b>${esc(c.area)}</b>`, c.priority && `priority is <b>${esc(c.priority)}</b>`, c.workflow_id && `workflow is <b>${esc(S.db.workflows.find(w => w.id === c.workflow_id)?.name || "?")}</b>`].filter(Boolean);
  const then = (a.actions || []).map(x => { const v = x.value; switch (x.type) { case "set_stage": return `move it to <b>${v === "next" ? "the next stage" : v === "done" ? "Done" : esc(wfStageName(v))}</b>`; case "set_priority": return `set priority <b>${esc(v)}</b>`; case "assign": return `assign to <b>${v === "creator" ? "the creator" : v === "me" ? "me" : esc(nameOf(v))}</b>`; case "set_due_in_days": return `due in <b>${esc(v)} day${v == 1 ? "" : "s"}</b>`; case "star": return "<b>star it</b>"; case "add_steps": return `add <b>${(Array.isArray(v) ? v : String(v).split("\n")).filter(Boolean).length} steps</b>`; case "comment": return `post “${esc(String(v).slice(0, 40))}”`; case "notify": return `notify <b>${v === "workspace" ? "everyone" : v === "assignee" ? "the assignee" : v === "creator" ? "the creator" : esc(nameOf(v))}</b>`; case "set_workflow": return `switch to <b>${esc(S.db.workflows.find(w => w.id === v)?.name || "?")}</b>`; case "advance_parent": return "<b>move the parent forward</b>"; } return x.type; });
  return `When ${when.charAt(0).toLowerCase() + when.slice(1)}${ifs.length ? ` and ${ifs.join(" and ")}` : ""}, then ${then.join(", ") || "do nothing"}.`;
}
function vAutomations() {
  return `
  <div class="view-h"><div><h1>Automations</h1><p>Rules that run by themselves when tasks change</p></div><button class="btn" data-action="auto-new">${I.plus}New rule</button></div>
  <div class="list">${S.db.automations.map(a => `<div class="li"><span style="font-size:22px">⚡</span><div class="grow" data-action="auto-edit" data-id="${a.id}" style="cursor:pointer"><b>${esc(a.name)}</b><div class="rule">${describeRule(a)}</div><small>Ran ${a.run_count || 0} time${a.run_count === 1 ? "" : "s"}</small></div><button class="toggle ${a.enabled ? "on" : ""}" data-action="auto-toggle" data-id="${a.id}" role="switch" aria-checked="${a.enabled}" aria-label="Enable ${esc(a.name)}"></button></div>`).join("") || emptyBox("No rules yet", "Create one to automate your workflow.", I.bolt)}</div>
  <div class="card mt"><div class="card-h"><h2>Always on</h2><span class="sub">Built in</span></div><ul class="muted" style="margin:0;padding-left:18px;display:grid;gap:6px;font-size:14px">
    <li>Every stage change is logged as a status update on the task.</li><li>Finishing a repeating task creates the next one, with all its steps reset.</li><li>When every step of a task is done, its "all steps done" rules run.</li><li>Assigning a task, or moving one someone else owns, sends them a notification.</li><li>Completing a parent task completes all its open steps.</li></ul></div>`;
}
function autoSheet(a, forceNew) {
  const isNew = forceNew ?? !a; a = a ? JSON.parse(JSON.stringify(a)) : { id: uuid(), name: "", enabled: true, trigger: "stage_changed", conditions: {}, actions: [{ type: "notify", value: "workspace", message: "was updated" }] };
  U.sheet = { type: "automation", a, isNew };
  const allStages = []; S.db.workflows.forEach(w => w.stages.forEach(s => { if (!allStages.some(x => x.key === s.key)) allStages.push(s); }));
  const members = S.db.workspace_members.map(m => m.user_id);
  const valueCtl = (x, i) => {
    switch (x.type) {
      case "set_stage": return `<select class="inp" data-av="${i}"><option value="next" ${x.value === "next" ? "selected" : ""}>Next stage</option><option value="done" ${x.value === "done" ? "selected" : ""}>Done</option>${allStages.map(s => `<option value="${esc(s.key)}" ${x.value === s.key ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>`;
      case "set_priority": return `<select class="inp" data-av="${i}">${["High", "Medium", "Low"].map(p => `<option ${x.value === p ? "selected" : ""}>${p}</option>`).join("")}</select>`;
      case "assign": return `<select class="inp" data-av="${i}"><option value="creator" ${x.value === "creator" ? "selected" : ""}>The creator</option><option value="me" ${x.value === "me" ? "selected" : ""}>Whoever triggers it</option>${members.map(u => `<option value="${u}" ${x.value === u ? "selected" : ""}>${esc(nameOf(u))}</option>`).join("")}</select>`;
      case "set_due_in_days": return `<input class="inp" type="number" min="0" data-av="${i}" value="${esc(x.value ?? 1)}">`;
      case "star": case "advance_parent": return `<span class="muted" style="font-size:13px">No setting needed</span>`;
      case "add_steps": return `<textarea class="inp" data-av="${i}" placeholder="One step per line">${esc(Array.isArray(x.value) ? x.value.join("\n") : x.value || "")}</textarea>`;
      case "comment": return `<input class="inp" data-av="${i}" value="${esc(x.value || "")}" placeholder="Update text">`;
      case "notify": return `<select class="inp" data-av="${i}"><option value="workspace" ${x.value === "workspace" ? "selected" : ""}>Everyone</option><option value="assignee" ${x.value === "assignee" ? "selected" : ""}>The assignee</option><option value="creator" ${x.value === "creator" ? "selected" : ""}>The creator</option>${members.map(u => `<option value="${u}" ${x.value === u ? "selected" : ""}>${esc(nameOf(u))}</option>`).join("")}</select>`;
      case "set_workflow": return `<select class="inp" data-av="${i}">${S.db.workflows.map(w => `<option value="${w.id}" ${x.value === w.id ? "selected" : ""}>${esc(w.name)}</option>`).join("")}</select>`;
    }
    return "";
  };
  const c = a.conditions || {};
  openSheet(`<h2 id="sheet-title">${isNew ? "New automation" : "Edit automation"}</h2>
  <form data-form="automation">
    <div class="field"><label for="au-name">Name</label><input class="inp" id="au-name" value="${esc(a.name)}" placeholder="e.g. Ask Sara to approve payroll" required autofocus></div>
    <div class="field"><label for="au-trigger">When</label><select class="inp" id="au-trigger">${Object.entries(E.TRIGGERS).map(([k, l]) => `<option value="${k}" ${a.trigger === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
    <div class="fgrid" style="margin-top:0">
      <div class="field" id="au-stage-f" style="${a.trigger === "stage_changed" ? "" : "display:none"}"><label for="au-stage">Stage</label><select class="inp" id="au-stage"><option value="">Any stage</option>${allStages.map(s => `<option value="${esc(s.key)}" ${c.to_stage === s.key ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>
      <div class="field"><label for="au-area">Only if area is</label><select class="inp" id="au-area"><option value="">Any</option>${AREAS.map(x => `<option ${c.area === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
      <div class="field"><label for="au-pri">Only if priority is</label><select class="inp" id="au-pri"><option value="">Any</option>${["High", "Medium", "Low"].map(x => `<option ${c.priority === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
      <div class="field"><label for="au-wf">Only in workflow</label><select class="inp" id="au-wf"><option value="">Any</option>${S.db.workflows.map(w => `<option value="${w.id}" ${c.workflow_id === w.id ? "selected" : ""}>${esc(w.name)}</option>`).join("")}</select></div>
    </div>
    <div class="field"><span class="lab">Then</span><div id="au-actions">${a.actions.map((x, i) => `<div class="act-row" data-ai="${i}"><select class="inp" data-at="${i}">${Object.entries(E.ACTIONS).map(([k, l]) => `<option value="${k}" ${x.type === k ? "selected" : ""}>${l}</option>`).join("")}</select><div>${valueCtl(x, i)}${x.type === "notify" ? `<input class="inp" data-am="${i}" style="margin-top:6px" value="${esc(x.message || "")}" placeholder="Message, e.g. needs your review">` : ""}</div><button type="button" class="iconbtn-s" data-action="au-del" data-i="${i}" aria-label="Remove">×</button></div>`).join("")}</div>
      <button type="button" class="btn ghost" data-action="au-add">＋ Add action</button></div>
    <div class="sheet-actions">${!isNew ? `<button type="button" class="btn danger" data-action="auto-del">Delete</button>` : ""}<button class="btn" type="submit">${isNew ? "Create rule" : "Save"}</button></div>
  </form>`);
}
function readAutoForm() {
  const a = U.sheet.a;
  a.name = $("#au-name").value.trim(); a.trigger = $("#au-trigger").value;
  a.conditions = Object.fromEntries([["to_stage", a.trigger === "stage_changed" ? $("#au-stage").value : ""], ["area", $("#au-area").value], ["priority", $("#au-pri").value], ["workflow_id", $("#au-wf").value]].filter(([, v]) => v));
  a.actions = $$("#au-actions .act-row").map(r => { const i = r.dataset.ai; const type = $(`[data-at="${i}"]`, r).value; const vEl = $(`[data-av="${i}"]`, r); let value = vEl ? vEl.value : true; if (type === "add_steps") value = value.split("\n").map(s => s.trim()).filter(Boolean); if (type === "set_due_in_days") value = +value || 0; const o = { type, value }; const m = $(`[data-am="${i}"]`, r); if (m) o.message = m.value.trim(); return o; });
  return a;
}

/* ================= INBOX, MORE, SETTINGS ================= */
function vInbox() {
  const list = [...S.db.notifications].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return `<div class="view-h"><div><h1>Inbox</h1><p>${unread()} unread</p></div>${list.some(n => !n.read) ? `<button class="btn ghost" data-action="read-all">Mark all read</button>` : ""}</div>
  <div class="list">${list.map(n => `<div class="notif ${n.read ? "" : "unread"}" data-action="notif" data-id="${n.id}">${avatar(n.actor_id, true)}<div><p>${esc(n.body)}</p><small>${timeAgo(n.created_at)}${n.workspace_id && n.workspace_id !== S.wsId ? ` · ${esc(S.db.workspaces.find(w => w.id === n.workspace_id)?.name || "")}` : ""}</small></div></div>`).join("") || emptyBox("All quiet", "Assignments, status changes and updates from your team appear here.", I.bell)}</div>`;
}
function vMore() {
  const H = [["routine", "🔁", "Routine", "Daily habits & streaks"], ["money", "💰", "Money", "Spending & budgets"], ["focus", "⏱", "Focus", "25-minute sessions"], ["team", "👥", "Team & updates", "People, invites, feed"], ["workflows", "🔀", "Workflows", "Stages tasks move through"], ["automations", "⚡", "Automations", "Rules that run themselves"], ["inbox", "🔔", "Inbox", `${unread()} unread`], ["settings", "⚙️", "Settings", "Profile, theme, install"]];
  return `<div class="view-h"><div><h1>More</h1><p>Everything else in TaskerBay</p></div></div><div class="hub">${H.map(([k, i, l, s]) => `<button data-go="${k}"><span class="ic">${i}</span><b>${l}</b><small>${s}</small></button>`).join("")}</div>`;
}
function vSettings() {
  const p = profile(me()) || {};
  return `<div class="view-h"><div><h1>Settings</h1><p>${esc(S.user?.email || "")}</p></div></div>
  <div class="grid g-2">
    <div class="card"><div class="card-h"><h2>Profile</h2></div>
      <form data-form="profile"><div class="field"><label for="pf-name">Your name</label><input class="inp" id="pf-name" value="${esc(p.full_name || "")}"></div><button class="btn" type="submit">Save</button></form></div>
    ${pushCard()}
    <div class="card"><div class="card-h"><h2>Appearance</h2></div><div class="seg">${THEMES.map(t => `<button class="${theme === t ? "on" : ""}" data-action="set-theme" data-v="${t}">${t === "auto" ? "Auto" : t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div></div>
    <div class="card"><div class="card-h"><h2>Install on your phone</h2></div><ol class="muted" style="margin:0;padding-left:18px;display:grid;gap:6px;font-size:14px">
      <li><b>iPhone:</b> open this page in Safari → Share → <b>Add to Home Screen</b>.</li><li><b>Android:</b> open in Chrome → ⋮ menu → <b>Install app</b>.</li><li>Sign in with the same account on every device. Everything syncs live.</li></ol>
      ${deferredInstall ? `<button class="btn mt" data-action="install">Install TaskerBay</button>` : ""}</div>
    <div class="card"><div class="card-h"><h2>Your data</h2></div><p class="muted" style="margin:0 0 12px;font-size:14px">${S.mode === "demo" ? "Demo mode: data is stored in this browser only." : S.mode === "claude" ? "Saved privately in your Claude account and synced across every device where you open TaskerBay while signed in to Claude." : "Stored securely in your TaskerBay database. Only you and your workspace members can see shared tasks. Money, routine and journal are private to you."}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" data-action="export">Copy all my data (JSON)</button>${S.mode === "demo" ? `<button class="btn danger" data-action="demo-fresh">${api.isClean?.() ? "Erase & start over" : "Start my own planner"}</button>` : ""}${S.mode === "claude" ? "" : `<button class="btn danger" data-action="sign-out">Sign out</button>`}</div></div>
  </div>
  <p class="muted mt" style="font-size:12px;text-align:center">TaskerBay · ${S.mode === "demo" ? "demo mode" : S.mode === "claude" ? "synced with your Claude account" : "connected"} · keyboard: <b>N</b> new task, <b>/</b> or <b>Ctrl+K</b> search</p>`;
}

/* ================= Add chooser, capture, palette ================= */
function chooser() {
  U.sheet = { type: "chooser" };
  openSheet(`<h2 id="sheet-title">Add to ${esc(ws()?.name || "TaskerBay")}</h2>
  <div class="choose"><button data-action="new-task"><span class="ic">${I.tasks}</span><b>Task</b><small>With steps, stage & owner</small></button>
  <button data-action="new-expense"><span class="ic g">${I.money}</span><b>Expense</b><small>Money in or out</small></button>
  <button data-action="routine-new"><span class="ic">${I.routine}</span><b>Routine item</b><small>A daily habit</small></button>
  <button data-action="auto-new"><span class="ic g">${I.bolt}</span><b>Automation</b><small>A rule that runs itself</small></button></div>
  ${AI_ON ? `<button class="ai-btn" data-action="capture" style="width:100%;justify-content:center;padding:14px;margin-top:4px"><span class="spark">✨</span>Just say it, Claude sorts it out</button>` : ""}`);
}
function newTaskSheet(preset = {}) {
  U.sheet = { type: "newtask", preset };
  const tk = dkey(), tm = dkey(addDays(new Date(), 1));
  openSheet(`<h2 id="sheet-title">New task</h2>
  <form data-form="newtask">
    <div class="field"><label for="nt-title">Task</label><input class="inp" id="nt-title" required autofocus placeholder="What needs doing? Try: Payroll review fri 3pm !high"></div>
    <div class="field"><span class="lab">Due</span><div class="picks" data-quickdue><button type="button" class="pick ${preset.due_date === tk ? "on" : ""}" data-v="${tk}">Today</button><button type="button" class="pick ${preset.due_date === tm ? "on" : ""}" data-v="${tm}">Tomorrow</button><button type="button" class="pick ${!preset.due_date ? "on" : ""}" data-v="">No date</button></div><input class="inp" type="date" id="nt-due" value="${preset.due_date || ""}" aria-label="Due date" style="margin-top:6px"></div>
    <div class="fgrid" style="margin-top:0">
      <div class="field"><label for="nt-wf">Workflow</label><select class="inp" id="nt-wf">${E.workflows().map(w => `<option value="${w.id}" ${(preset.workflow_id || E.defaultWorkflow()?.id) === w.id ? "selected" : ""}>${esc(w.icon)} ${esc(w.name)}</option>`).join("")}</select></div>
      <div class="field"><label for="nt-area">Area</label><select class="inp" id="nt-area">${AREAS.map(a => `<option ${(preset.area || (isTeam() ? "Work" : "Personal")) === a ? "selected" : ""}>${a}</option>`).join("")}</select></div>
      <div class="field"><label for="nt-pri">Priority</label><select class="inp" id="nt-pri">${["High", "Medium", "Low"].map(p => `<option ${p === "Medium" ? "selected" : ""}>${p}</option>`).join("")}</select></div>
      ${isTeam() ? `<div class="field"><label for="nt-as">Assign to</label><select class="inp" id="nt-as">${S.db.workspace_members.map(m => `<option value="${m.user_id}" ${m.user_id === me() ? "selected" : ""}>${esc(nameOf(m.user_id))}</option>`).join("")}</select></div>` : ""}
    </div>
    <div class="field"><label for="nt-steps">Steps (optional, one per line)</label><textarea class="inp" id="nt-steps" placeholder="Collect inputs\nValidate\nSend for approval"></textarea></div>
    <div class="sheet-actions"><button class="btn" type="submit">Create task</button></div>
  </form>`);
}
function captureSheet() {
  U.sheet = { type: "capture" };
  openSheet(`<h2 id="sheet-title">✨ Just say it</h2><p class="muted" style="margin:-6px 0 12px;font-size:13.5px">Write everything on your mind. Claude turns it into tasks (with steps) and expenses for you to check.</p>
  <div class="field"><label for="cap-text" class="sr">What's on your mind</label><textarea class="inp" id="cap-text" style="min-height:120px" autofocus placeholder="e.g. Paid 45 for a taxi. Payroll needs approval from Sara by Thursday, urgent: check overtime, send summary, upload WPS file. Call the bank about the loan tomorrow."></textarea>
  <div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="ai-btn" data-action="capture-run"><span class="spark">✨</span>Sort it out</button></div></div><div id="cap-out"></div>`);
}
let palItems = [], palSel = 0;
function openPalette() { $("#palette-wrap").classList.add("on"); const i = $("#pal-input"); i.value = ""; renderPalette(""); setTimeout(() => i.focus(), 30); }
function closePalette() { $("#palette-wrap").classList.remove("on"); }
function renderPalette(q) {
  q = q.trim().toLowerCase();
  const acts = [["✅", "New task", "add create", () => newTaskSheet()], ["💸", "New expense", "money spend", () => expenseSheet()], ["🔁", "New routine item", "habit", () => routineSheet()], ["⚡", "New automation", "rule", () => autoSheet()], ["🔀", "New workflow", "stages", () => wfSheet()],
    AI_ON && ["✨", "Just say it (AI)", "capture ai", () => captureSheet()], AI_ON && ["🗓️", "Plan my day (AI)", "ai schedule", () => { go("today"); aiPlan(); }],
    ...NAV.map(([k, l]) => ["→", `Go to ${l}`, k, () => go(k)]), ["🌓", "Switch theme", "dark light", cycleTheme], ["👥", "Invite someone", "team member", () => { go("team"); inviteSheet(); }]]
    .filter(Boolean).map(([ico, l, k, run]) => ({ ico, l, k, run })).filter(a => !q || (a.l + " " + a.k).toLowerCase().includes(q));
  const ts = q ? S.db.tasks.filter(t => (t.title + " " + t.notes).toLowerCase().includes(q)).slice(0, 10).map(t => ({ ico: E.isDone(t) ? "☑️" : "⬜", l: t.title, sub: t.parent_id ? "step" : (t.due_date ? dueLabel(t) : E.stageOf(t).name), run: () => openTask(t.id) })) : [];
  const xs = q ? S.db.expenses.filter(x => (x.title + " " + x.category + " " + x.note).toLowerCase().includes(q)).slice(0, 5).map(x => ({ ico: CATS[x.category]?.[0] || "💸", l: x.title, sub: `${x.flow === "in" ? "+" : "−"}${nf2.format(x.amount)} · ${x.date}`, run: () => expenseSheet(x) })) : [];
  palItems = [...ts, ...xs, ...acts]; palSel = 0;
  const sec = (t, arr, off) => arr.length ? `<div class="pal-sec">${t}</div>` + arr.map((a, i) => `<button class="pal-item ${off + i === 0 ? "sel" : ""}" data-pi="${off + i}"><span class="ico">${a.ico}</span><span>${esc(a.l)}</span>${a.sub ? `<small>${esc(a.sub)}</small>` : ""}</button>`).join("") : "";
  $("#pal-list").innerHTML = (sec("Tasks", ts, 0) + sec("Money", xs, ts.length) + sec("Actions", acts, ts.length + xs.length)) || `<div class="pal-sec">No matches</div>`;
}
$("#pal-input").addEventListener("input", e => renderPalette(e.target.value));
$("#pal-input").addEventListener("keydown", e => {
  const items = $$("#pal-list .pal-item");
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!items.length) return; palSel = (palSel + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; items.forEach((b, i) => b.classList.toggle("sel", i === palSel)); items[palSel].scrollIntoView({ block: "nearest" }); }
  if (e.key === "Enter") { e.preventDefault(); const it = palItems[palSel]; closePalette(); it && setTimeout(it.run, 60); }
});
$("#palette-wrap").addEventListener("click", e => { if (e.target.id === "palette-wrap") closePalette(); const b = e.target.closest(".pal-item"); if (b) { const it = palItems[+b.dataset.pi]; closePalette(); it && setTimeout(it.run, 60); } });

function inviteSheet() {
  U.sheet = { type: "invite" };
  openSheet(`<h2 id="sheet-title">Invite to ${esc(ws()?.name)}</h2><p class="muted" style="margin:-6px 0 12px;font-size:13.5px">They join this workspace automatically the moment they sign up or sign in to TaskerBay with this email. Send them the link to your TaskerBay.</p>
  <form data-form="invite"><div class="field"><label for="iv-email">Email</label><input class="inp" type="email" id="iv-email" required autofocus placeholder="name@example.com"></div>
  <div class="field"><span class="lab">Role</span>${picks("role", [["member", "Member"], ["admin", "Admin"]], "member")}</div>
  <div class="sheet-actions"><button class="btn" type="submit">Send invite</button></div></form>`);
}
function wsSheet(edit) {
  U.sheet = { type: "ws", edit };
  const w = edit ? ws() : { name: "", icon: "👥" };
  openSheet(`<h2 id="sheet-title">${edit ? "Rename workspace" : "New workspace"}</h2>${edit ? "" : `<p class="muted" style="margin:-6px 0 12px;font-size:13.5px">A separate space with its own tasks, workflows and members, e.g. "Family" or "HR Team".</p>`}
  <form data-form="ws"><div class="two"><div class="field"><label for="ws-name">Name</label><input class="inp" id="ws-name" value="${esc(w.name)}" required autofocus></div><div class="field"><label for="ws-icon">Icon</label><input class="inp" id="ws-icon" value="${esc(w.icon)}" maxlength="4"></div></div>
  <div class="sheet-actions"><button class="btn" type="submit">${edit ? "Save" : "Create"}</button></div></form>`);
}
function wsSwitchSheet() {
  U.sheet = { type: "wsswitch" };
  openSheet(`<h2 id="sheet-title">Workspaces</h2><div class="list">${S.db.workspaces.map(x => `<button class="li" data-action="ws-go" data-id="${x.id}" style="width:100%;text-align:left"><span style="font-size:24px">${esc(x.icon)}</span><div class="grow"><b>${esc(x.name)}</b><small>${x.id === S.wsId ? "Current" : "Switch"}</small></div>${x.id === S.wsId ? `<span class="check on">${I.check}</span>` : ""}</button>`).join("")}</div>
  <div class="sheet-actions mt"><button class="btn ghost" data-action="ws-new">${I.plus}New workspace</button></div>`);
}
async function switchWs(id) {
  if (id === S.wsId) { closeSheet(); return; }
  closeSheet(); S.wsId = id; try { localStorage.setItem("tb.ws", id); } catch (e) {}
  $("#view").innerHTML = `<div class="skel" style="height:150px"></div><div class="skel mt"></div>`;
  await api.loadWorkspace(id); U.plan = null; U.planState = "idle"; U.boardWf = null;
  render(true); E.runOverdue();
  toast(`Switched to ${ws()?.name}`);
}

/* ================= AI ================= */
const aiTasks = () => S.db.tasks.filter(t => !E.isDone(t) && (!t.assignee_id || t.assignee_id === me())).slice(0, 60).map(t => ({ id: t.id, title: t.title, due: t.due_date, time: t.due_time, priority: t.priority, area: t.area, stage: E.stageOf(t).name, starred: t.starred, steps_open: E.descendants(t.id).filter(x => !E.isDone(x)).length, is_step: !!t.parent_id }));
const aiErr = e => `Couldn't reach Claude: ${e?.message || "unknown error"}. Check the AI setup in the README.`;
async function aiPlan() {
  if (U.planState === "loading") return;
  U.planState = "loading"; render();
  try {
    const r = await api.ai("plan_day", { now: new Date().toString(), today: dkey(), tasks: aiTasks(), routine: routineToday().map(r => ({ name: r.name, time: fmtTime(r.time_of_day), done: logged(r) })), focus_minutes: S.db.focus_sessions.filter(f => f.day === dkey()).reduce((s, f) => s + f.minutes, 0) });
    U.plan = { headline: String(r?.headline || "Here's your plan"), top3: Array.isArray(r?.top3) ? r.top3.map(String) : [], plan: Array.isArray(r?.plan) ? r.plan.map(b => ({ time: String(b.time || ""), what: String(b.what || "") })) : [], tip: String(r?.tip || "") };
    U.planState = "done";
  } catch (e) { U.planState = "error"; U.planErr = aiErr(e); }
  render();
}
async function aiBreakdown() {
  const t = task(U.sheet?.id); if (!t) return;
  const st = $("#steps-status"); st.innerHTML = thinking("Breaking it down…");
  try {
    const arr = await api.ai("breakdown", { title: t.title, notes: t.notes.slice(0, 800), existing: E.childrenOf(t.id).map(c => c.title), path: E.pathOf(t).map(p => p.title) });
    if (!Array.isArray(arr)) throw new Error("unexpected answer");
    for (const s of arr.slice(0, 10)) await E.createTask({ title: String(s.title || s), parent_id: t.id, area: t.area, assignee_id: t.assignee_id, workflow_id: E.defaultWorkflow()?.id }, 1);
    if ($("#steps-status")) $("#steps-status").innerHTML = ""; buzz(20);
  } catch (e) { if ($("#steps-status")) $("#steps-status").innerHTML = `<p class="muted" style="font-size:13px">${esc(aiErr(e))}</p>`; }
}
let capItems = [];
async function aiCapture() {
  const text = $("#cap-text")?.value.trim(); if (!text) { toast("Write something first."); return; }
  const out = $("#cap-out"); out.innerHTML = thinking("Claude is sorting it out…");
  try {
    const arr = await api.ai("capture", { text: text.slice(0, 4000), today: dkey(), weekday: new Date().toLocaleDateString("en-GB", { weekday: "long" }), people: S.db.workspace_members.map(m => nameOf(m.user_id)), categories: Object.keys(CATS) });
    if (!Array.isArray(arr)) throw new Error("unexpected answer");
    capItems = arr.slice(0, 20).map(x => x.type === "expense"
      ? { type: "expense", title: String(x.title || "Expense"), amount: Math.abs(+x.amount || 0), flow: x.flow === "in" ? "in" : "out", category: CATS[x.category] ? x.category : "Other", date: /^\d{4}-\d{2}-\d{2}$/.test(x.date || "") ? x.date : dkey() }
      : { type: "task", title: String(x.title || "Task"), due_date: /^\d{4}-\d{2}-\d{2}$/.test(x.due || "") ? x.due : null, area: AREAS.includes(x.area) ? x.area : "Personal", priority: ["High", "Medium", "Low"].includes(x.priority) ? x.priority : "Medium", steps: Array.isArray(x.steps) ? x.steps.map(String).slice(0, 10) : [], assignee: x.assignee ? S.db.profiles.find(p => p.full_name.toLowerCase().startsWith(String(x.assignee).toLowerCase()))?.id : null })
      .filter(x => x.type === "task" || x.amount > 0);
    if (!capItems.length) { out.innerHTML = `<p class="muted">Nothing to add found. Try more detail.</p>`; return; }
    out.innerHTML = `<div class="cap-list">${capItems.map((x, i) => `<label class="cap-item" style="animation-delay:${i * 50}ms"><input type="checkbox" checked data-ci="${i}"><span style="font-size:18px">${x.type === "task" ? "✅" : CATS[x.category][0]}</span><span class="t">${esc(x.title)}${x.steps?.length ? `<br><small class="muted">${x.steps.length} steps</small>` : ""}</span>${x.type === "task" ? `${x.due_date ? `<span class="chip">${esc(dueLabel(x))}</span>` : ""}${x.assignee ? avatar(x.assignee) : ""}` : `<span class="${x.flow === "in" ? "amt-in" : "amt-out"}">${x.flow === "in" ? "+" : "−"}${nf2.format(x.amount)}</span>`}</label>`).join("")}</div><div class="sheet-actions"><button class="btn" data-action="capture-save">Add ${capItems.length} item${capItems.length > 1 ? "s" : ""}</button></div>`;
  } catch (e) { out.innerHTML = `<p class="muted">${esc(aiErr(e))}</p>`; }
}
async function aiMonth() {
  const mk = U.month, d = monthData(mk), [y, m] = mk.split("-").map(Number), pv = new Date(y, m - 2, 1);
  U.monthAIState = "loading"; U.monthAIFor = mk; render();
  try {
    U.monthAI = await api.ai("month_insights", { month: mk, currency: CURRENCY, spent: Math.round(d.spent), income: Math.round(d.income), by_category: d.byCat, budgets: Object.fromEntries(S.db.budgets.map(b => [b.category, +b.amount])), previous: monthData(`${pv.getFullYear()}-${pad(pv.getMonth() + 1)}`).byCat, largest: d.inMonth.filter(x => x.flow !== "in").sort((a, b) => b.amount - a.amount).slice(0, 8).map(x => ({ t: x.title, a: +x.amount, c: x.category, d: x.date })) });
    U.monthAIState = "done";
  } catch (e) { U.monthAIState = "error"; U.monthAIErr = aiErr(e); }
  render();
}

/* ================= Swipe & drag ================= */
let sw = null, swipedAt = 0;
document.addEventListener("pointerdown", e => {
  const row = e.target.closest(".row[data-swipe]");
  if (!row || e.target.closest("button") || e.pointerType === "mouse") return;
  sw = { row, x: e.clientX, y: e.clientY, dx: 0, active: false, id: e.pointerId };
});
document.addEventListener("pointermove", e => {
  if (!sw || e.pointerId !== sw.id) return;
  const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
  if (!sw.active) { if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.4) { sw.active = true; sw.row.classList.add("swiping"); } else if (Math.abs(dy) > 12) { sw = null; return; } else return; }
  sw.dx = dx; const a = Math.min(1, Math.abs(dx) / 110);
  sw.row.style.transform = `translateX(${dx}px)`;
  sw.row.style.background = `color-mix(in srgb, ${dx > 0 ? "var(--green)" : "var(--red)"} ${a * 30}%, var(--surface))`;
  if (Math.abs(dx) > 100 && !sw.buzzed) { buzz(12); sw.buzzed = true; }
});
function endSwipe() {
  if (!sw) return; const { row, dx, active } = sw; sw = null; if (!active) return;
  swipedAt = Date.now(); row.classList.remove("swiping");
  const t = task(row.dataset.id);
  if (t && Math.abs(dx) > 100) {
    row.style.transition = "transform .25s ease, opacity .25s"; row.style.transform = `translateX(${dx > 0 ? 110 : -110}%)`; row.style.opacity = "0";
    setTimeout(() => dx > 0 ? toggleDone(t) : deleteWithUndo(t), 220);
  } else { row.style.transform = ""; row.style.background = ""; }
}
document.addEventListener("pointerup", endSwipe); document.addEventListener("pointercancel", endSwipe);
document.addEventListener("dragstart", e => { const c = e.target.closest("[data-drag-task]"); if (!c) return; e.dataTransfer.setData("text/plain", c.dataset.dragTask); e.dataTransfer.effectAllowed = "move"; c.classList.add("dragging"); });
document.addEventListener("dragend", e => { e.target.closest?.("[data-drag-task]")?.classList.remove("dragging"); $$(".over").forEach(x => x.classList.remove("over")); });
document.addEventListener("dragover", e => { const z = e.target.closest("[data-drop-stage],[data-drop-day]"); if (!z) return; e.preventDefault(); $$(".over").forEach(x => x !== z && x.classList.remove("over")); z.classList.add("over"); });
document.addEventListener("drop", async e => {
  const z = e.target.closest("[data-drop-stage],[data-drop-day]"); if (!z) return; e.preventDefault(); z.classList.remove("over");
  const t = task(e.dataTransfer.getData("text/plain")); if (!t) return;
  if (z.dataset.dropStage) { if (t.stage !== z.dataset.dropStage) { await E.changeTask(t, { stage: z.dataset.dropStage }); if (E.isDone(task(t.id))) { const r = z.getBoundingClientRect(); burst(r.left + r.width / 2, r.top + 60); } } }
  else if (t.due_date !== z.dataset.dropDay) { await E.changeTask(t, { due_date: z.dataset.dropDay }); toast(`Moved to ${parseKey(z.dataset.dropDay).toLocaleDateString("en-GB", { weekday: "long" })}`); }
});

/* ================= Actions ================= */
async function toggleDone(t, el) {
  if (E.isDone(t)) { await E.reopenTask(t); toast("Reopened."); return; }
  const r = el?.getBoundingClientRect(); burst(r ? r.left + 20 : innerWidth / 2, r ? r.top + r.height / 2 : innerHeight / 2); buzz(25);
  const before = { ...t };
  await E.completeTask(t);
  toast(t.repeat ? "Done. The next one is scheduled." : "Nice. Task done.", async () => { await E.changeTask(task(t.id) || before, { stage: before.stage }); });
}
async function deleteWithUndo(t) {
  const removed = await remove("tasks", t);
  closeSheetIfTask(t.id);
  toast(`Deleted “${t.title.slice(0, 30)}”${removed.length > 1 ? ` and ${removed.length - 1} step${removed.length > 2 ? "s" : ""}` : ""}.`, async () => {
    const sorted = [...removed].sort((a, b) => E.pathOf(a).length - E.pathOf(b).length);
    for (const r of sorted) await insert("tasks", r);
  });
}
function closeSheetIfTask(id) { if (U.sheet?.type === "task" && (U.sheet.id === id || !task(U.sheet.id))) closeSheet(); }

document.addEventListener("click", async e => {
  if (Date.now() - swipedAt < 350 && e.target.closest(".row")) { e.preventDefault(); return; }
  const g = e.target.closest("[data-go]");
  if (g) { closeSheet(); go(g.dataset.go, g.dataset.tf ? { taskFilter: g.dataset.tf, taskMode: "list" } : {}); return; }
  const p = e.target.closest("#sheet .pick");
  if (p && !e.target.closest("[data-action]")) {
    const wrap = p.parentElement; $$(".pick", wrap).forEach(x => x.classList.toggle("on", x === p));
    if (wrap.hasAttribute("data-quickdue")) { const d = $("#nt-due"); if (d) d.value = p.dataset.v; }
    return;
  }
  const dayBtn = e.target.closest("#sheet .daysel button"); if (dayBtn) { dayBtn.classList.toggle("on"); return; }
  const a = e.target.closest("[data-action]"); if (!a) return;
  const id = a.dataset.id, act = a.dataset.action, t = id ? task(id) : null;
  switch (act) {
    case "add": chooser(); break;
    case "close-sheet": closeSheet(); break;
    case "new-task": closeSheet(); setTimeout(() => newTaskSheet({ due_date: a.dataset.due || (U.view === "plan" ? U.planDay : null), workflow_id: a.dataset.wf, stage: a.dataset.stage }), 10); break;
    case "open-task": openTask(id); break;
    case "toggle": if (t) await toggleDone(t, a.closest(".row,.srow") || a); break;
    case "star": if (t) { await E.changeTask(t, { starred: !t.starred }); buzz(10); if (!t.starred) toast("Starred for today ⭐"); } break;
    case "filter": U.taskFilter = a.dataset.v; render(); break;
    case "area": U.areaFilter = a.dataset.v; render(); break;
    case "task-mode": U.taskMode = a.dataset.v; render(true); break;
    case "board-wf": U.boardWf = a.dataset.v; render(); break;
    case "set-stage": { const tt = task(U.sheet?.id); if (tt && tt.stage !== a.dataset.v) { await E.changeTask(tt, { stage: a.dataset.v }); if (E.isDone(task(tt.id))) { const r = a.getBoundingClientRect(); burst(r.left + r.width / 2, r.top); } buzz(10); } break; }
    case "expand": U.expanded.has(id) ? U.expanded.delete(id) : U.expanded.add(id); refreshTaskSheet(); if (U.expanded.has(id)) setTimeout(() => $(`[data-sub-input="${id}"]`)?.focus(), 30); break;
    case "add-sub": U.expanded.add(id); refreshTaskSheet(); setTimeout(() => $(`[data-sub-input="${id}"]`)?.focus(), 30); break;
    case "post-update": {
      const tt = task(U.sheet?.id); if (!tt) break;
      const note = $("#upd-text").value.trim(), d = $("#upd-date").value || null, tm = $("#upd-time").value || null, st = $("#upd-stage").value;
      const res = await E.statusUpdate(tt, { note, due_date: d, due_time: tm, stage: st });
      if (!res) { toast("Type a status or change the date, time or stage first."); break; }
      $("#upd-text").value = ""; ["upd-date", "upd-time"].forEach(id => { const n = $("#" + id); if (n) n.defaultValue = n.value; });
      buzz(10); toast(E.isDone(res) ? "Done! Update saved." : res.due_date ? `Update saved · next: ${dueLabel(res)}` : "Update saved."); break;
    }
    case "delete-task": if (t) { closeSheet(); await deleteWithUndo(t); } break;
    case "focus-task": closeSheet(); FT.taskId = id; if (!FT.running) setMode("focus"); go("focus"); break;
    case "schedule": if (t) { await E.changeTask(t, { due_date: a.dataset.v }); toast("Scheduled."); } break;
    case "week": U.planWeek = +a.dataset.v === 0 ? 0 : U.planWeek + +a.dataset.v; if (+a.dataset.v === 0) U.planDay = dkey(); else { const b = addDays(new Date(), U.planWeek * 7); U.planDay = dkey(addDays(b, -((b.getDay() + 6) % 7))); } render(); break;
    case "plan-day": U.planDay = a.dataset.v; render(); break;
    case "routine": { const r = S.db.routine_items.find(x => x.id === id); if (r) await toggleRoutine(r, a); break; }
    case "routine-new": closeSheet(); setTimeout(() => routineSheet(), 10); break;
    case "routine-edit": routineSheet(S.db.routine_items.find(x => x.id === id)); break;
    case "routine-del": { const r = S.db.routine_items.find(x => x.id === id); closeSheet(); await remove("routine_items", r); toast("Routine item deleted.", () => insert("routine_items", r)); break; }
    case "mood": { const v = +a.dataset.v, j = S.db.journal.find(x => x.day === dkey() && x.user_id === me()) || {}; await upsert("journal", { user_id: me(), day: dkey(), mood: j.mood === v ? null : v, win: j.win || "", note: j.note || "" }); buzz(10); break; }
    case "month": { const [y, m] = U.month.split("-").map(Number), d = new Date(y, m - 1 + +a.dataset.v, 1); U.month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; render(true); break; }
    case "new-expense": closeSheet(); setTimeout(() => expenseSheet(), 10); break;
    case "edit-expense": expenseSheet(S.db.expenses.find(x => x.id === id)); break;
    case "del-expense": { const x = S.db.expenses.find(y => y.id === id); closeSheet(); await remove("expenses", x); toast("Entry deleted.", () => insert("expenses", x)); break; }
    case "budgets": budgetSheet(); break;
    case "csv": { const { inMonth } = monthData(U.month); const csv = ["Date,Title,Flow,Category,Amount,Paid by,Note", ...inMonth.sort((a, b) => a.date.localeCompare(b.date)).map(x => [x.date, x.title, x.flow === "in" ? "Income" : "Expense", x.category, x.amount, x.paid_by, x.note].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))].join("\n"); navigator.clipboard?.writeText(csv).then(() => toast(`Copied ${inMonth.length} rows. Paste into Excel or Sheets.`), () => toast("Couldn't copy here.")); break; }
    case "ft-mode": if (!FT.running) { setMode(a.dataset.v); render(); } else toast("Pause first to switch."); break;
    case "ft-toggle": if (FT.running) { clearInterval(FT.timer); FT.running = false; document.title = "TaskerBay"; } else { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume?.(); } catch (e) {} FT.running = true; FT.endAt = Date.now() + FT.left * 1000; FT.timer = setInterval(ftTick, 250); } render(); break;
    case "ft-reset": clearInterval(FT.timer); FT.running = false; FT.left = FT.len; document.title = "TaskerBay"; render(); break;
    case "ft-finish": { const ft = task(FT.taskId); if (ft) { await toggleDone(ft); FT.taskId = ""; render(); } break; }
    case "ws-switch": wsSwitchSheet(); break;
    case "ws-go": switchWs(id); break;
    case "ws-new": closeSheet(); setTimeout(() => wsSheet(false), 10); break;
    case "ws-edit": wsSheet(true); break;
    case "invite": inviteSheet(); break;
    case "invite-cancel": { const i = S.db.workspace_invites.find(x => x.id === id); if (i) await remove("workspace_invites", i); break; }
    case "member-remove": { const m = S.db.workspace_members.find(x => x.user_id === id); if (m) { await remove("workspace_members", m); toast(`${nameOf(id)} removed from the workspace.`); } break; }
    case "wf-new": wfSheet(); break;
    case "wf-edit": if (["owner", "admin"].includes(myRole())) wfSheet(S.db.workflows.find(w => w.id === id)); else toast("Only admins can edit workflows."); break;
    case "st-add": { const n = $$("#wf-stages .stage-edit").length; U.sheet.wf.stages.push({ key: "", name: "", color: "#64748B", type: "active" }); $("#wf-stages").insertAdjacentHTML("beforeend", U.stageRow({ key: "", name: "", color: "#64748B", type: "active" }, n)); $$("#wf-stages .stage-edit input.inp").pop().focus(); break; }
    case "st-del": a.closest(".stage-edit").remove(); break;
    case "st-up": { const r = a.closest(".stage-edit"); r.previousElementSibling?.before(r); break; }
    case "st-down": { const r = a.closest(".stage-edit"); r.nextElementSibling?.after(r); break; }
    case "wf-del": { const w = U.sheet.wf; if (S.db.workflows.length < 2) { toast("Keep at least one workflow."); break; } const used = S.db.tasks.filter(t => t.workflow_id === w.id).length; closeSheet(); const orig = S.db.workflows.find(x => x.id === w.id); await remove("workflows", orig); toast(`Workflow deleted${used ? `. ${used} task${used > 1 ? "s" : ""} now use the default` : ""}.`); break; }
    case "auto-new": closeSheet(); setTimeout(() => autoSheet(), 10); break;
    case "auto-edit": autoSheet(S.db.automations.find(x => x.id === id)); break;
    case "auto-toggle": { const r = S.db.automations.find(x => x.id === id); await update("automations", r, { enabled: !r.enabled }); toast(r.enabled ? "Rule paused." : "Rule on."); break; }
    case "auto-del": { const r = S.db.automations.find(x => x.id === U.sheet.a.id); closeSheet(); if (r) { await remove("automations", r); toast("Rule deleted.", () => insert("automations", r)); } break; }
    case "au-add": readAutoForm(); U.sheet.a.actions.push({ type: "set_priority", value: "High" }); reopenAuto(); break;
    case "au-del": readAutoForm(); U.sheet.a.actions.splice(+a.dataset.i, 1); reopenAuto(); break;
    case "notif": { const n = S.db.notifications.find(x => x.id === id); if (n && !n.read) update("notifications", n, { read: true }); if (n?.workspace_id && n.workspace_id !== S.wsId) await switchWs(n.workspace_id); if (n?.task_id && task(n.task_id)) openTask(n.task_id); break; }
    case "read-all": for (const n of S.db.notifications.filter(n => !n.read)) update("notifications", n, { read: true }); break;
    case "palette": openPalette(); break;
    case "theme": cycleTheme(); render(); break;
    case "set-theme": theme = a.dataset.v; applyTheme(theme); try { localStorage.setItem("tb.theme", theme); } catch (e) {} render(); break;
    case "install": deferredInstall?.prompt(); break;
    case "export": { const data = JSON.stringify({ exported: new Date().toISOString(), workspace: ws(), ...S.db }, null, 2); navigator.clipboard?.writeText(data).then(() => toast("All your data is copied as JSON."), () => toast("Couldn't copy here.")); break; }
    case "demo-reset": localStorage.removeItem("taskerbay.demo.v1"); location.reload(); break;
    case "demo-fresh": { const ok = U.confirmFresh === true; if (!ok) { U.confirmFresh = true; toast("Tap again to erase everything on this device and start fresh."); setTimeout(() => U.confirmFresh = false, 4000); break; } await api.startFresh(profile(me())?.full_name !== "You" ? profile(me())?.full_name : "", true); break; }
    case "sign-out": { try { const reg = await navigator.serviceWorker?.ready; const sub = await reg?.pushManager?.getSubscription(); if (sub) { await api.removePush(sub.endpoint); await sub.unsubscribe(); } } catch (e) {} await api.signOut(); break; }
    case "push-on": await enablePush(); break;
    case "push-test": { const r = await api.testPush().catch(e => ({ error: e.message })); toast(r?.sent ? `Test popup sent to ${r.sent} device${r.sent > 1 ? "s" : ""}.` : r?.error ? `Couldn't send: ${r.error}` : "No device is set up for popups yet."); break; }
    case "push-off": { try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) { await api.removePush(sub.endpoint); await sub.unsubscribe(); } } catch (e) {} U.pushOn = false; try { localStorage.setItem("tb.pushOff", "1"); } catch (e) {} toast("Popups turned off on this device."); render(); break; }
    case "push-banner-x": { try { localStorage.setItem("tb.pushBanner", "no"); } catch (e) {} render(); break; }
    case "ai-plan": aiPlan(); break;
    case "ai-plan-star": { const ids = (U.plan?.top3 || []).filter(task); for (const i of ids) { const tt = task(i); if (!tt.starred) await E.changeTask(tt, { starred: true }); } toast(`Starred ${ids.length} for today ⭐`); break; }
    case "ai-breakdown": aiBreakdown(); break;
    case "ai-month": aiMonth(); break;
    case "capture": closeSheet(); setTimeout(captureSheet, 10); break;
    case "capture-run": aiCapture(); break;
    case "capture-save": {
      const chosen = $$("#cap-out input[data-ci]").filter(c => c.checked).map(c => capItems[+c.dataset.ci]); closeSheet(); let nt = 0, ne = 0;
      for (const x of chosen) {
        if (x.type === "task") { const nt_ = await E.createTask({ title: x.title, due_date: x.due_date, area: x.area, priority: x.priority, assignee_id: x.assignee || me() }); for (const s of x.steps) await E.createTask({ title: s, parent_id: nt_.id, area: x.area }, 1); nt++; }
        else { await insert("expenses", { id: uuid(), user_id: me(), title: x.title, amount: x.amount, flow: x.flow, category: x.category, date: x.date, paid_by: "Card", note: "", created_at: new Date().toISOString() }); ne++; }
      }
      burst(innerWidth / 2, innerHeight / 2, 30); toast(`Added ${[nt && `${nt} task${nt > 1 ? "s" : ""}`, ne && `${ne} expense${ne > 1 ? "s" : ""}`].filter(Boolean).join(" and ") || "nothing"}.`); break;
    }
  }
});
function reopenAuto() { const s = U.sheet; autoSheet(s.a, s.isNew); }

document.addEventListener("change", async e => {
  const el = e.target;
  if (el.dataset.tfield) { await saveTaskField(el); return; }
  if (el.id === "ft-task") { FT.taskId = el.value; render(); }
  if (el.id === "nt-due") $$("#sheet [data-quickdue] .pick").forEach(x => x.classList.toggle("on", x.dataset.v === el.value));
  if (el.id === "au-trigger") $("#au-stage-f").style.display = el.value === "stage_changed" ? "" : "none";
  if (el.dataset.at !== undefined) { readAutoForm(); reopenAuto(); }
  if (el.dataset.roleFor) { const m = S.db.workspace_members.find(x => x.user_id === el.dataset.roleFor); if (m) { await update("workspace_members", m, { role: el.value }); toast("Role updated."); } }
});
let journalTimer;
document.addEventListener("input", e => {
  const el = e.target;
  if (el.dataset.quick) { const h = $(`[data-hint-for="${el.id}"]`); if (h) h.innerHTML = hintFor(el.value); }
  if (el.dataset.journal) { clearTimeout(journalTimer); const v = el.value; journalTimer = setTimeout(() => { const j = S.db.journal.find(x => x.day === dkey() && x.user_id === me()) || {}; upsert("journal", { user_id: me(), day: dkey(), mood: j.mood ?? null, win: v.trim(), note: j.note || "" }); }, 900); }
});
document.addEventListener("keydown", async e => {
  const el = e.target;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#palette-wrap").classList.contains("on") ? closePalette() : openPalette(); return; }
  if (e.key === "Escape") { if ($("#palette-wrap").classList.contains("on")) closePalette(); else closeSheet(); return; }
  const typing = el.matches?.("input,textarea,select");
  if (!typing && S.ready && e.key === "/") { e.preventDefault(); openPalette(); return; }
  if (!typing && S.ready && e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey && !U.sheet) { e.preventDefault(); newTaskSheet(); return; }
  if ((e.key === "Enter" || e.key === " ") && el.matches?.(".main[role=button]")) { e.preventDefault(); el.click(); return; }
  if (e.key === "Enter" && el.id === "tf-title") { e.preventDefault(); el.blur(); return; }
  if (e.key === "Enter" && (el.id === "step-new" || el.dataset?.subInput)) {
    e.preventDefault(); const v = el.value.trim(); if (!v) return;
    const parent = el.id === "step-new" ? U.sheet.id : el.dataset.subInput, pt = task(parent);
    el.value = ""; await E.createTask({ title: v, parent_id: parent, area: pt?.area || "Personal", assignee_id: pt?.assignee_id || me(), workflow_id: E.defaultWorkflow()?.id }, 1);
    U.expanded.add(parent); buzz(8);
    setTimeout(() => (el.id === "step-new" ? $("#step-new") : $(`[data-sub-input="${parent}"]`))?.focus(), 40);
  }
  if (e.key === "Enter" && el.id === "upd-text" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('[data-action="post-update"]').click(); }
});

document.addEventListener("submit", async e => {
  e.preventDefault(); const f = e.target, kind = f.dataset.form;
  if (kind === "quick") {
    const inp = $("input", f), raw = inp.value, h = $(`[data-hint-for="${inp.id}"]`);
    const it = parseIntent(raw);
    if (it) {
      inp.value = ""; if (h) h.innerHTML = hintFor("");
      const res = await E.statusUpdate(it.task, { note: it.note, due_date: it.due_date, due_time: it.due_time, stage: it.stage });
      buzz(15);
      if (!res) toast(`“${it.task.title}” already looks like that.`);
      else toast(`Updated “${it.task.title}”${E.isDone(res) ? " · done ✅" : ` · ${E.stageOf(res).name}`}${it.due_date || it.due_time ? ` · next: ${dueLabel(res)}` : ""}`, null);
      if (res && E.isDone(res)) { const r = inp.getBoundingClientRect(); burst(r.left + r.width / 2, r.top); }
      inp.focus(); return;
    }
    const p = parseQuick(raw.replace(/^\+\s*/, "")); if (!p.title) { toast("Type what needs doing first."); return; }
    inp.value = ""; if (h) h.innerHTML = hintFor("");
    await E.createTask({ title: p.title, area: p.area, priority: p.priority, due_date: p.due_date, due_time: p.due_time, starred: p.starred, repeat: p.repeat, assignee_id: p.assignee_id });
    inp.focus(); buzz(15); toast("Task added.");
  }
  if (kind === "newtask") {
    const raw = $("#nt-title").value.trim(); if (!raw) return;
    const p = parseQuick(raw), wfId = $("#nt-wf").value, wf = S.db.workflows.find(w => w.id === wfId);
    const preset = U.sheet.preset || {};
    const nt = await E.createTask({ title: p.title || raw, due_date: $("#nt-due").value || p.due_date, due_time: p.due_time, area: $("#nt-area").value, priority: raw.includes("!") ? p.priority : $("#nt-pri").value, workflow_id: wfId, stage: preset.stage && wf?.stages.some(s => s.key === preset.stage) ? preset.stage : E.firstStage(wf), assignee_id: $("#nt-as")?.value || p.assignee_id || me(), starred: p.starred, repeat: p.repeat });
    for (const s of $("#nt-steps").value.split("\n").map(x => x.trim()).filter(Boolean)) await E.createTask({ title: s, parent_id: nt.id, area: nt.area, assignee_id: nt.assignee_id }, 1);
    closeSheet(); buzz(15); toast("Task created.");
  }
  if (kind === "expense") {
    const amount = parseFloat(($("#ef-amt").value || "").replace(/,/g, "")); if (!(amount > 0)) { $("#ef-amt").focus(); toast("Enter an amount above zero."); return; }
    const flow = pickVal("flow") || "out", cat = pickVal("cat") || "Other";
    const old = S.db.expenses.find(x => x.id === f.dataset.id);
    const x = { id: f.dataset.id, user_id: me(), amount, flow, category: cat, title: $("#ef-title").value.trim() || cat, date: $("#ef-date").value || dkey(), paid_by: $("#ef-paid").value, note: $("#ef-note").value.trim(), created_at: old?.created_at || new Date().toISOString() };
    closeSheet(); await upsert("expenses", x); buzz(15);
    const b = S.db.budgets.find(y => y.category === cat);
    if (flow === "out" && b) { const used = monthData(x.date.slice(0, 7)).byCat[cat] || 0; if (used > b.amount) return toast(`⚠️ ${cat} is over budget: ${money(used)} of ${money(b.amount)}.`); if (used > b.amount * .8) return toast(`Heads up: ${cat} is at ${Math.round(used / b.amount * 100)}% of budget.`); }
    toast(f.dataset.new ? `${flow === "in" ? "Income" : "Expense"} of ${money(amount)} added.` : "Saved.");
  }
  if (kind === "budgets") {
    const want = {}; $$("[data-cat]", f).forEach(i => { const v = parseFloat((i.value || "").replace(/,/g, "")); if (v > 0) want[i.dataset.cat] = Math.round(v); });
    closeSheet();
    for (const b of [...S.db.budgets]) if (!want[b.category]) await remove("budgets", b);
    for (const [category, amount] of Object.entries(want)) await upsert("budgets", { user_id: me(), category, amount });
    toast("Budgets saved.");
  }
  if (kind === "routine") {
    const days = $$("#sheet .daysel button.on").map(b => +b.dataset.day).sort();
    if (!days.length) { toast("Pick at least one day."); return; }
    const old = S.db.routine_items.find(x => x.id === f.dataset.id);
    const r = { id: f.dataset.id, user_id: me(), name: $("#rf-name").value.trim(), icon: $("#rf-icon").value.trim() || "✅", time_of_day: $("#rf-time").value || null, days, position: old?.position ?? S.db.routine_items.length, archived: false, created_at: old?.created_at || new Date().toISOString() };
    closeSheet(); await upsert("routine_items", r); toast(f.dataset.new ? "Added to your routine." : "Saved.");
  }
  if (kind === "workflow") {
    const s = U.sheet, stages = readStages();
    if (stages.length < 2) { toast("A workflow needs at least two stages."); return; }
    if (!stages.some(x => x.type === "done")) { toast("Mark one stage as Done."); return; }
    const keys = new Set(); stages.forEach((x, i) => { while (keys.has(x.key)) x.key += "_" + i; keys.add(x.key); });
    const w = { ...s.wf, workspace_id: S.wsId, name: $("#wf-name").value.trim(), icon: $("#wf-icon").value.trim() || "🔀", stages, is_default: $("#wf-def").checked };
    closeSheet();
    if (w.is_default) for (const o of S.db.workflows.filter(x => x.is_default && x.id !== w.id)) await update("workflows", o, { is_default: false });
    if (s.isNew) await insert("workflows", { ...w, created_at: new Date().toISOString() }); else await update("workflows", S.db.workflows.find(x => x.id === w.id), { name: w.name, icon: w.icon, stages: w.stages, is_default: w.is_default });
    toast(s.isNew ? "Workflow created." : "Workflow saved.");
  }
  if (kind === "automation") {
    const a = readAutoForm(); if (!a.name) { toast("Give the rule a name."); return; }
    if (!a.actions.length) { toast("Add at least one action."); return; }
    const isNew = U.sheet.isNew; closeSheet();
    if (isNew) await insert("automations", { ...a, workspace_id: S.wsId, run_count: 0, created_by: me(), created_at: new Date().toISOString() });
    else await update("automations", S.db.automations.find(x => x.id === a.id), { name: a.name, trigger: a.trigger, conditions: a.conditions, actions: a.actions });
    toast(isNew ? "Automation created ⚡" : "Automation saved.");
  }
  if (kind === "invite") {
    const email = $("#iv-email").value.trim().toLowerCase(); if (!email) return;
    if (S.db.workspace_invites.some(i => i.email === email)) { toast("Already invited."); return; }
    closeSheet(); await insert("workspace_invites", { id: uuid(), workspace_id: S.wsId, email, role: pickVal("role") || "member", invited_by: me(), created_at: new Date().toISOString() });
    toast(`Invited ${email}. Ask them to sign up at your TaskerBay link with this email.`);
  }
  if (kind === "ws") {
    const name = $("#ws-name").value.trim(), icon = $("#ws-icon").value.trim() || "👥"; if (!name) return;
    if (U.sheet.edit) { closeSheet(); await update("workspaces", ws(), { name, icon }); toast("Workspace renamed."); }
    else { closeSheet(); const id = await api.rpc("create_workspace", { ws_name: name, ws_icon: icon }); await api.loadAll(); await switchWs(id); }
  }
  if (kind === "profile") { const n = $("#pf-name").value.trim(); if (n) { await api.updateProfile({ full_name: n }); localUpsert("profiles", { ...profile(me()), full_name: n }); emit(); toast("Saved."); } }
});

/* ================= Auth screen ================= */
function authScreen(mode = "in", msg = null) {
  const demo = S.mode === "demo";
  $("#root").innerHTML = `<div class="auth"><div class="auth-card">
    <div class="brand"><div class="brand-mark"><span></span></div>TaskerBay</div>
    <h1>${mode === "up" ? "Create your account" : mode === "magic" ? "Email me a link" : mode === "reset" ? "Reset password" : "Welcome back"}</h1>
    <p class="lead">Private workspace. Sign in to continue.</p>
    ${msg ? `<div class="msg ${msg.ok ? "ok" : "err"}">${esc(msg.text)}</div>` : ""}
    ${demo ? `<form id="fresh-form"><div class="field"><label for="fr-name">Your name</label><input class="inp" id="fr-name" autocomplete="given-name" placeholder="e.g. Munawar" required></div><button class="btn" type="submit">Start my planner</button></form>
    <p class="muted" style="font-size:12.5px;margin:10px 2px 0">Your data is saved on this device. Sign-in and sync across devices switch on once the account server is connected.</p>
    <div class="alt">or</div><button class="btn ghost" data-auth="demo">Explore with sample data</button>` : `
    ${mode === "in" || mode === "up" ? `<div class="seg"><button class="${mode === "in" ? "on" : ""}" data-auth-mode="in">Sign in</button><button class="${mode === "up" ? "on" : ""}" data-auth-mode="up">Create account</button></div>` : ""}
    <form id="auth-form">
      ${mode === "up" ? `<div class="field"><label for="au-c">Access code</label><input class="inp" id="au-c" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="TB-XXXX-XXXX" required></div><div class="field"><label for="au-n">Your name</label><input class="inp" id="au-n" autocomplete="name" required></div>` : ""}
      <div class="field"><label for="au-e">Email</label><input class="inp" type="email" id="au-e" autocomplete="email" required></div>
      ${mode === "in" || mode === "up" ? `<div class="field"><label for="au-p">Password</label><input class="inp" type="password" id="au-p" autocomplete="${mode === "up" ? "new-password" : "current-password"}" minlength="8" required></div>` : ""}
      <button class="btn" type="submit">${mode === "up" ? "Create account" : mode === "magic" ? "Send sign-in link" : mode === "reset" ? "Send reset link" : "Sign in"}</button>
    </form>
    <div class="alt">or</div>
    ${ENABLE_GOOGLE ? `<button class="btn ghost" data-auth="google" style="margin-bottom:8px">Continue with Google</button>` : ""}
    ${mode !== "magic" ? `<button class="btn ghost" data-auth-mode="magic">Email me a sign-in link</button>` : `<button class="btn ghost" data-auth-mode="in">Use a password instead</button>`}
    ${mode === "in" ? `<p style="text-align:center;margin:14px 0 0"><button class="link" data-auth-mode="reset">Forgot password?</button></p>` : ""}`}
    ${demo ? `<div class="feature-pills"><span>🔁 Routine</span><span>🗓️ Planner</span><span>✅ Tasks & steps</span><span>🔀 Workflows</span><span>⚡ Automations</span><span>👥 Teams</span><span>💰 Money</span></div>` : ""}
  </div></div>`;
  $$("[data-auth-mode]").forEach(b => b.onclick = () => authScreen(b.dataset.authMode));
  $("[data-auth=demo]")?.addEventListener("click", () => api.signIn());
  $("#fresh-form")?.addEventListener("submit", e => { e.preventDefault(); e.stopPropagation(); api.startFresh($("#fr-name").value.trim()); }, true);
  $("[data-auth=google]")?.addEventListener("click", () => api.google().catch(err => authScreen(mode, { text: err.message })));
  $("#auth-form")?.addEventListener("submit", async e => {
    e.preventDefault(); e.stopPropagation();
    const btn = $("#auth-form .btn"); btn.disabled = true; btn.textContent = "Please wait…";
    const email = $("#au-e").value.trim(), pw = $("#au-p")?.value;
    try {
      if (mode === "in") { await api.signIn(email, pw); location.reload(); }
      else if (mode === "up") { const live = await api.signUp($("#au-n").value.trim(), email, pw, $("#au-c").value.trim().toUpperCase()); if (live) location.reload(); else authScreen("in", { ok: true, text: "Check your email to confirm your account, then sign in." }); }
      else if (mode === "magic") { await api.magic(email); authScreen("magic", { ok: true, text: `We sent a sign-in link to ${email}. Open it on this device.` }); }
      else if (mode === "reset") { await api.reset(email); authScreen("in", { ok: true, text: "If that email has an account, a reset link is on its way." }); }
    } catch (err) {
      const m = String(err.message || "");
      const text = mode === "up" && /database error|access_code|INVALID_ACCESS_CODE/i.test(m) ? "That access code isn't right. Check it and try again."
        : mode === "magic" && /signups not allowed|not found|otp_disabled/i.test(m) ? "No account uses that email. Create an account with your access code first."
        : m || "Something went wrong.";
      authScreen(mode, { text });
    }
  }, true);
}

/* ================= PWA install ================= */
let deferredInstall = null;
addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredInstall = e; });
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});


/* ================= Popup notifications (Web Push) ================= */
const IS_IOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const STANDALONE = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
function pushState() {
  if (S.mode !== "cloud" || !VAPID_PUBLIC_KEY) return "na";
  if (!pushSupported()) return IS_IOS && !STANDALONE ? "ios-install" : "unsupported";
  return Notification.permission === "granted" ? (U.pushOn ? "on" : "granted") : Notification.permission; // default | denied
}
const b64u = s => { const p = "=".repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, c => c.charCodeAt(0)); };
async function syncPush(quiet) {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(VAPID_PUBLIC_KEY) });
  const j = sub.toJSON();
  await api.savePush({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 200) });
  U.pushOn = true; if (!quiet) render();
}
async function enablePush() {
  const st = pushState();
  if (st === "ios-install") { toast("On iPhone, first add TaskerBay to your Home Screen (Share → Add to Home Screen), then open it from there."); return; }
  if (st === "unsupported") { toast("This browser can't show popups. Try Chrome, Edge, Safari or Firefox."); return; }
  if (st === "denied") { toast("Popups are blocked for taskerbay.com. Allow notifications in your browser's site settings, then try again."); return; }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("No problem. You can turn popups on any time in Settings."); render(); return; }
    await syncPush(true); try { localStorage.removeItem("tb.pushOff"); } catch (e) {}
    const r = await api.testPush().catch(() => null);
    toast(r?.sent ? "Popups are on. A test popup is on its way." : "Popups are on.");
    render();
  } catch (e) { console.error(e); toast(`Couldn't turn on popups: ${e.message || e}`); }
}
function pushCard() {
  const st = pushState(); if (st === "na") return "";
  const body = {
    on: `<p class="muted" style="margin:0 0 12px;font-size:14px">✅ On for this device. You'll get a <b>9 AM summary</b> (your local time), reminders <b>15 minutes before</b> tasks with a time, routine reminders, and team updates.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" data-action="push-test">Send a test popup</button><button class="btn ghost" data-action="push-off">Turn off on this device</button></div>`,
    granted: `<p class="muted" style="margin:0 0 12px;font-size:14px">Popups are off on this device.</p><button class="btn" data-action="push-on">🔔 Turn on popups</button>`,
    default: `<p class="muted" style="margin:0 0 12px;font-size:14px">Get a <b>9 AM summary</b> of your day, reminders before tasks are due, and team updates, even when TaskerBay is closed. Turn it on once on each device you use.</p><button class="btn" data-action="push-on">🔔 Turn on popups</button>`,
    denied: `<p class="muted" style="margin:0;font-size:14px">Popups are blocked for this site. Open your browser's site settings for taskerbay.com, allow <b>Notifications</b>, then reload.</p>`,
    "ios-install": `<p class="muted" style="margin:0;font-size:14px">On iPhone, popups work once TaskerBay is on your Home Screen: Safari → Share → <b>Add to Home Screen</b>, open it from there, then come back here.</p>`,
    unsupported: `<p class="muted" style="margin:0;font-size:14px">This browser can't show popups. Chrome, Edge, Safari (iOS 16.4+) and Firefox all can.</p>`
  }[st];
  return `<div class="card"><div class="card-h"><h2>🔔 Popup notifications</h2></div>${body}</div>`;
}
function pushBanner() {
  const st = pushState(); let hid = false; try { hid = localStorage.getItem("tb.pushBanner") === "no"; } catch (e) {}
  if (hid || !["default", "ios-install"].includes(st)) return "";
  return `<div class="push-banner"><span class="ic">🔔</span><div><b>Get your 9 AM summary and reminders</b><small>${st === "ios-install" ? "Add TaskerBay to your Home Screen first, then turn on popups." : "Popups arrive even when TaskerBay is closed."}</small></div>${st === "default" ? `<button class="btn" data-action="push-on">Turn on</button>` : ""}<button class="x" data-action="push-banner-x" aria-label="Dismiss">✕</button></div>`;
}
if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", e => { if (e.data?.type === "open" && e.data.url) { const h = new URL(e.data.url).hash; if (h) { if (location.hash === h) openFromHash(); else location.hash = h; } } });
function openFromHash() {
  const h = location.hash.slice(1);
  if (h.startsWith("task=")) { const id = h.slice(5); history.replaceState(null, "", "#" + U.view); if (task(id)) openTask(id); else toast("That task isn't in this workspace."); return true; }
  return false;
}

/* ================= Boot ================= */
async function boot() {
  try {
    await initBackend();
    AI_ON = ENABLE_AI && (S.mode === "cloud" || (S.mode === "claude" && api.hasAI()));
    const user = await api.session();
    if (!user) { authScreen(); return; }
    S.user = user;
    await api.loadAll();
    let saved = null; try { saved = localStorage.getItem("tb.ws"); } catch (e) {}
    S.wsId = S.db.workspaces.some(w => w.id === saved) ? saved : (S.db.workspaces.find(w => w.owner_id === user.id && w.name === "Personal") || S.db.workspaces[0])?.id;
    if (!S.wsId) { $("#root").innerHTML = `<div class="auth"><div class="auth-card"><h1>Almost there</h1><p class="lead">Your account has no workspace yet. Make sure the database setup script has been run, then reload.</p><button class="btn" onclick="location.reload()">Reload</button></div></div>`; return; }
    await api.loadWorkspace(S.wsId);
    shell(); S.ready = true;
    const h = location.hash.slice(1); U.view = VIEWS[h] ? h : "today";
    render(true);
    openFromHash();
    if (S.mode === "cloud") {
      try { const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; const pr = profile(me()); if (tz && pr && pr.timezone !== tz) { await api.updateProfile({ timezone: tz }); localUpsert("profiles", { ...pr, timezone: tz }); } } catch (e) {}
      let off = false; try { off = localStorage.getItem("tb.pushOff") === "1"; } catch (e) {}
      if (!off && pushSupported() && Notification.permission === "granted") syncPush(true).then(() => render()).catch(() => {});
    }
    onChange(() => { if (S.mode === "claude") AI_ON = ENABLE_AI && api.hasAI(); render(); });
    E.runOverdue(); setInterval(() => E.runOverdue(), 3600e3);
    let lastDay = dkey(); setInterval(() => { if (dkey() !== lastDay) { lastDay = dkey(); U.plan = null; U.planState = "idle"; render(); } }, 60e3);
  } catch (e) {
    console.error(e);
    $("#root").innerHTML = `<div class="auth"><div class="auth-card"><h1>Can't load TaskerBay</h1><p class="lead">${esc(e.message || e)}</p><p class="muted" style="font-size:13px">Check your internet connection and the Supabase keys in js/config.js.</p><button class="btn" onclick="location.reload()">Try again</button></div></div>`;
  }
}
boot();
