// TaskerBay app: screens, interactions and animations.
import { S, api, initBackend, onChange, onError, emit, insert, upsert, update, remove, uuid, localUpsert } from "./store.js";
import * as E from "./engine.js";
import * as SP from "./spell.js";
import * as TP from "./templates.js";
import * as CAL from "./calendar.js";
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

/* Spelling: fix obvious typos (never names), unless the person chose to keep their spelling */
function spellFix(text, keepKey) {
  if (!text || U.spellOff || (keepKey && U.keepSpell === keepKey)) return { text, changes: [] };
  return SP.fix(text);
}
function refreshKnownWords() {
  const w = new Set();
  S.db.profiles.forEach(p => String(p.full_name || "").split(/\s+/).forEach(x => x && w.add(x)));
  S.db.tasks.forEach(t => String(t.title || "").split(/[^A-Za-z']+/).forEach(x => x.length > 3 && w.add(x)));
  SP.setKnown([...w]);
}
const spellNote = ch => ch.length ? `<span class="chip spell-chip" title="Spelling fixed">✏️ ${ch.slice(0, 3).map(c => `${esc(c.from)}→<b>${esc(c.to)}</b>`).join(", ")}${ch.length > 3 ? "…" : ""}</span>` : "";

/* Quick add: "Send payslips tomorrow 3pm #work !high @sara *"
   Also understands plain sentences: "call bank on 25 nov at 3 pm", "in 2 days", "next week", "noon". */
const FILLER = new Set(["on", "at", "by", "due", "for", "to", "until", "till", "before", "from", "this", "next", "the", "of"]);
const MONTH_N = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
const monthIdx = w => MONTH_N[w] ?? -1;
function dateFromDM(dd, mm, today) { if (dd < 1 || dd > 31 || mm < 0 || mm > 11) return null; let d = new Date(today.getFullYear(), mm, dd); if (d < parseKey(dkey(today))) d = new Date(today.getFullYear() + 1, mm, dd); return dkey(d); }
function parseQuick(text0) {
  const rr = E.extractRepeat(text0), text = rr && rr.rest ? rr.rest : text0;
  const out = { title: "", area: S.db.workspace_members.length > 1 ? "Work" : "Personal", priority: "Medium", due_date: null, due_time: null, starred: false, repeat: rr?.rule || "", assignee_id: me() };
  const words = text.trim().split(/\s+/).filter(Boolean); const used = new Set(); const today = new Date();
  // "remind me at 10.45 pm regarding payroll", "reminder: ...", "set a reminder ..." -> pop up exactly at that time
  if (/^\s*(please\s+|pls\s+|kindly\s+)?(remind(er)?s?\b|set\s+(a\s+)?reminder|alert\s+me)/i.test(text)) out.remind_before = 0;
  const lws = words.map(w => w.toLowerCase().replace(/[,.;!?]+$/, ""));
  let autoDay = false;
  const withYear = (d, y, k) => { if (/^20\d{2}$/.test(y || "")) { used.add(k); return `${y}${d.slice(4)}`; } return d; };
  const setTime = (h, m) => { if (h < 24 && m < 60) { out.due_time = `${pad(h)}:${pad(m)}`; if (!out.due_date) { out.due_date = dkey(today); autoDay = true; } return true; } return false; };
  for (let i = 0; i < words.length; i++) {
    const w = words[i], lw = lws[i], nx = lws[i + 1] || "";
    const take = (...idx) => idx.forEach(k => used.add(k));
    if (/^#w(ork)?$/.test(lw)) { out.area = "Work"; take(i); continue; }
    if (/^#p(ersonal)?$/.test(lw)) { out.area = "Personal"; take(i); continue; }
    if (/^#proj(ect|ects)?$/.test(lw)) { out.area = "Projects"; take(i); continue; }
    if (/^!(h|high|1)$/.test(lw) || lw === "urgent" || lw === "asap") { out.priority = "High"; take(i); continue; }
    if (/^(high|low|medium|normal)$/.test(lw) && /^(priority|prio|pri)$/.test(nx)) { out.priority = { high: "High", low: "Low", medium: "Medium", normal: "Medium" }[lw]; take(i, i + 1); continue; }
    if (/^(priority|prio|pri)$/.test(lw) && /^(high|low|medium|normal)$/.test(nx)) { out.priority = { high: "High", low: "Low", medium: "Medium", normal: "Medium" }[nx]; take(i, i + 1); continue; }
    if (/^(high|low)$/.test(lw) && i === words.length - 1 && i > 1) { out.priority = lw === "high" ? "High" : "Low"; take(i); continue; }
    if (/^!(m|med|medium|2)$/.test(lw)) { out.priority = "Medium"; take(i); continue; }
    if (/^!(l|low|3)$/.test(lw)) { out.priority = "Low"; take(i); continue; }
    if (lw === "*" || lw === "⭐") { out.starred = true; take(i); continue; }
    if (lw.startsWith("@") && lw.length > 1) { const p = S.db.profiles.find(p => p.full_name.toLowerCase().startsWith(lw.slice(1))); if (p) { out.assignee_id = p.id; take(i); continue; } }
    if (/^(every|each)$/.test(lw) && /^(day|weekday|week|month)$/.test(nx)) { out.repeat = { day: "daily", weekday: "weekdays", week: "weekly", month: "monthly" }[nx]; take(i, i + 1); continue; }
    if (lw === "daily") { out.repeat = "daily"; take(i); continue; }
    if (lw === "today" || lw === "tod" || lw === "tonight") { autoDay = false; out.due_date = dkey(today); if (lw === "tonight" && !out.due_time) out.due_time = "20:00"; take(i); continue; }
    if (lw === "tomorrow" || lw === "tmr" || lw === "tmrw") { out.due_date = dkey(addDays(today, 1)); take(i); continue; }
    if (lw === "day" && nx === "after" && lws[i + 2] === "tomorrow") { out.due_date = dkey(addDays(today, 2)); take(i, i + 1, i + 2); i += 2; continue; }
    if (/^(eod|cob|eob)$/.test(lw) || (/^(end|close)$/.test(lw) && nx === "of" && /^(day|business|today)$/.test(lws[i + 2] || ""))) { if (!out.due_date) out.due_date = dkey(today); if (!out.due_time) out.due_time = "17:00"; if (lw === "end" || lw === "close") { take(i, i + 1, i + 2); i += 2; } else take(i); continue; }
    if (lw === "eow" || (lw === "end" && nx === "of" && /^(the|this)?$/.test(lws[i + 2] === "week" ? "" : lws[i + 2]) && (lws[i + 2] === "week" || lws[i + 3] === "week"))) { let n = (5 - today.getDay() + 7) % 7; out.due_date = dkey(addDays(today, n)); if (!out.due_time) out.due_time = "17:00"; const k = lw === "eow" ? 1 : lws[i + 2] === "week" ? 3 : 4; for (let j = 0; j < k; j++) take(i + j); i += k - 1; continue; }
    if (lw === "eom" || (lw === "end" && nx === "of" && (lws[i + 2] === "month" || lws[i + 3] === "month"))) { out.due_date = dkey(new Date(today.getFullYear(), today.getMonth() + 1, 0)); const k = lw === "eom" ? 1 : lws[i + 2] === "month" ? 3 : 4; for (let j = 0; j < k; j++) take(i + j); i += k - 1; continue; }
    if (lw === "next" && nx === "month") { const d = new Date(today.getFullYear(), today.getMonth() + 1, 1); d.setDate(Math.min(today.getDate(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); out.due_date = dkey(d); take(i, i + 1); i++; continue; }
    if (lw === "nextweek" || (lw === "next" && nx === "week")) { out.due_date = dkey(addDays(today, 7)); take(i); if (lw === "next") take(i + 1); continue; }
    // how long it takes: "for 1 hour", "for 30 mins", "for 1.5 hours" (blocks that much time in Free time)
    if (lw === "for" && !out.estimate_min) {
      const mm = (nx || "").match(/^(\d{1,3}(?:\.\d)?)(mins?|minutes?|m|hrs?|hours?|h)$/), un = lws[i + 2] || "";
      let n = null, u = null, span = 0;
      if (mm) { n = +mm[1]; u = /^h/.test(mm[2]) ? 60 : 1; span = 2; }
      else if (/^(\d{1,3}(\.\d)?|an?|one|two|half)$/.test(nx) && /^(mins?|minutes?|hrs?|hours?)$/.test(un)) { n = { a: 1, an: 1, one: 1, two: 2, half: .5 }[nx] ?? +nx; u = /^h/.test(un) ? 60 : 1; span = 3; }
      else if (nx === "half" && un === "an" && lws[i + 3] === "hour") { n = 30; u = 1; span = 4; }
      if (n && u) { out.estimate_min = Math.round(n * u); for (let k = 0; k < span; k++) take(i + k); i += span - 1; continue; }
    }
    if (lw === "quick" && !out.estimate_min) out.estimate_min = 15;
    // relative: "after 2 minutes", "in 30 mins", "within 1 hour", "in 2 days", "after a week", "in half an hour", "2 hours later"
    {
      const UNIT = { min: 1, mins: 1, minute: 1, minutes: 1, m: 1, hr: 60, hrs: 60, hour: 60, hours: 60, h: 60, day: 1440, days: 1440, week: 10080, weeks: 10080 };
      const num = x => /^\d{1,4}$/.test(x) ? +x : { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30 }[x];
      let n = null, u = null, span = 0;
      if (/^(in|after|within)$/.test(lw)) {
        const o = nx === "the" && lws[i + 2] === "next" ? 2 : nx === "next" && /^\d|^(an?|one|two|three|five|ten)$/.test(lws[i + 2] || "") ? 1 : 0;
        if (o) { lws.splice(i + 1, o); words.splice(i + 1, o); }
        const nx2 = lws[i + 1] || "";
        if (nx2 === "half" && /^(an?|hour)$/.test(lws[i + 2] || "")) { n = 30; u = 1; span = lws[i + 2] === "hour" ? 3 : 4; }
        else { const mm = (nx2 || "").match(/^(\d{1,4})(mins?|minutes?|m|hrs?|hours?|h|days?|weeks?)$/); if (mm) { n = +mm[1]; u = UNIT[mm[2]]; span = 2; } else if (num(nx2) != null && UNIT[lws[i + 2]]) { n = num(nx2); u = UNIT[lws[i + 2]]; span = 3; } }
      } else if (num(lw) != null && UNIT[nx] && /^(later|from)$/.test(lws[i + 2] || "")) { n = num(lw); u = UNIT[nx]; span = lws[i + 2] === "from" && lws[i + 3] === "now" ? 4 : 3; }
      if (n != null && u) {
        const at = new Date(Date.now() + n * u * 60e3);
        out.due_date = dkey(at); if (u < 1440) out.due_time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
        for (let k = 0; k < span; k++) take(i + k); i += span - 1; continue;
      }
    }
    if (lw === "noon" || lw === "midday") { setTime(12, 0); take(i); continue; }
    const part = { morning: 9, afternoon: 14, evening: 18 }[lw];
    if (part && (out.due_date || i > 0 && used.has(i - 1)) && !out.due_time) { setTime(part, 0); take(i); continue; }
    // times: 3pm, 3:30pm, 15:00, "3 pm"
    let tm = lw.match(/^(\d{1,2})(?:[:.](\d{2}))?(am|pm)$/);
    if (!tm && /^\d{1,2}([:.]\d{2})?$/.test(lw) && /^(am|pm|a\.m\.?|p\.m\.?)$/.test(nx)) { const [h, m] = lw.split(/[:.]/); tm = [lw, h, m, nx.startsWith("p") ? "pm" : "am"]; take(i + 1); }
    if (!tm) tm = lw.match(/^(\d{1,2}):(\d{2})$/) || (lws[i - 1] === "at" && lw.match(/^(\d{1,2})\.(\d{2})$/));
    if (!tm && /^\d{1,2}$/.test(lw) && +lw >= 1 && +lw <= 12 && (lws[i - 1] === "at" || (i > 0 && used.has(i - 1) && out.due_date && !out.due_time)) && monthIdx(nx) < 0 && !/^(min|mins|minutes?|hrs?|hours?|days?|weeks?|st|nd|rd|th)$/.test(nx)) { const h = +lw; tm = [lw, h <= 7 ? h + 12 : h, 0, ""]; }
    if (tm) { let h = +tm[1], m = +(tm[2] || 0); if (tm[3] === "pm" && h < 12) h += 12; if (tm[3] === "am" && h === 12) h = 0; if (setTime(h, m)) { take(i); continue; } }
    // weekdays: fri, friday, next friday
    const di = DOW.findIndex(d => lw === d || lw === d + "day" || (d === "tue" && (lw === "tuesday" || lw === "tues")) || (d === "wed" && lw === "wednesday") || (d === "thu" && (lw === "thursday" || lw === "thurs")) || (d === "sat" && lw === "saturday"));
    if (di >= 0) { let n = (di - today.getDay() + 7) % 7; if (n === 0) n = 7; out.due_date = dkey(addDays(today, n)); take(i); continue; }
    // dates: 25/11, 25-11, 25 nov, nov 25, 25th november
    let fy = lw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/); const iso = lw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); if (iso) fy = [lw, iso[3], iso[2], iso[1]];
    if (fy) { const y = +fy[3] < 100 ? 2000 + +fy[3] : +fy[3], d = new Date(y, +fy[2] - 1, +fy[1]); if (d.getMonth() === +fy[2] - 1) { out.due_date = dkey(d); take(i); continue; } }
    const m = lw.match(/^(\d{1,2})[\/\-.](\d{1,2})$/);
    if (m) { const d = dateFromDM(+m[1], +m[2] - 1, today); if (d) { out.due_date = d; take(i); continue; } }
    const dn = lw.match(/^(\d{1,2})(st|nd|rd|th)?$/);
    if (dn && monthIdx(nx) >= 0) { const d = dateFromDM(+dn[1], monthIdx(nx), today); if (d) { out.due_date = withYear(d, lws[i + 2], i + 2); take(i, i + 1); continue; } }
    if (dn && (dn[2] || lws[i - 1] === "on") && +dn[1] >= 1 && +dn[1] <= 31 && !out.due_date) { let d = new Date(today.getFullYear(), today.getMonth(), +dn[1]); if (d.getDate() !== +dn[1] || d < parseKey(dkey(today))) { d = new Date(today.getFullYear(), today.getMonth() + 1, +dn[1]); } if (d.getDate() === +dn[1]) { out.due_date = dkey(d); take(i); continue; } }
    if (monthIdx(lw) >= 0) { const d2 = nx.match(/^(\d{1,2})(st|nd|rd|th)?$/); if (d2) { const d = dateFromDM(+d2[1], monthIdx(lw), today); if (d) { out.due_date = withYear(d, lws[i + 2], i + 2); take(i, i + 1); continue; } } }
  }
  // a time with no day that has already passed today ("at 9" said at 11 pm) means tomorrow
  if (autoDay && out.due_date === dkey(today) && out.due_time) { const [h, m] = out.due_time.split(":").map(Number); if (h * 60 + m <= today.getHours() * 60 + today.getMinutes()) out.due_date = dkey(addDays(today, 1)); }
  // a repeat tied to a day with no date given: start on its next occurrence ("rent every month on 25th")
  if (out.repeat && (!out.due_date || autoDay) && /^(monthly:|weekly:|weekdays)/.test(out.repeat)) { const d0 = E.nextRepeat(out.repeat, today, true); if (autoDay && dkey(d0) === dkey(today) && out.due_time) { const [h, m] = out.due_time.split(":").map(Number); if (h * 60 + m <= today.getHours() * 60 + today.getMinutes()) { out.due_date = dkey(E.nextRepeat(out.repeat, today)); } else out.due_date = dkey(d0); } else out.due_date = dkey(d0); autoDay = false; }
  // drop little linking words that only introduced a date or time ("on", "at", "by"...)
  const keep = words.filter((w, i) => { if (used.has(i)) return false; if (FILLER.has(lws[i])) { let j = i + 1; while (j < words.length && FILLER.has(lws[j]) && !used.has(j)) j++; if (j >= words.length || used.has(j)) return false; } return true; });
  // tidy the title: drop "remind me ... regarding", "about", leftover "priority", and similar wrappers
  const LEAD = /^(please|pls|kindly|remind|reminder|reminders|reminder:|me|to|about|abt|for|of|re|re:|reg|set|a|an|alert|the|at|on|that|i|need|have|has)$/i;
  const REG = /^r[ae]{1,2}g\w{0,6}d(ing|in|ng|g)?:?$/i;  // regarding, regardin, ragerdin, regrading…
  let tw = keep.slice();
  if (out.remind_before === 0 || REG.test(tw[0] || "")) { while (tw.length && (LEAD.test(tw[0]) || REG.test(tw[0]))) tw.shift(); if (!tw.length) tw = ["Reminder"]; }
  tw = tw.filter((w, i) => !(/^(priority|prio)$/i.test(w)));
  out.title = tw.join(" ").replace(/^[\s,;:-]+|[\s,;:-]+$/g, "");
  if (out.title) out.title = out.title.charAt(0).toUpperCase() + out.title.slice(1);
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

/* Smart status update: "collect docs done, next is send to HR, remind me thursday 10am"
   -> ticks the matching step, adds/sets the next step, moves the task's date/time and sets the popup. */
const DONE_RX = /\b(done|completed?|finished|over|submitted|sent|received|collected|signed|approved|cleared|paid|uploaded|closed|ok)\b/i;
function analyzeUpdate(t, text) {
  const res = { note: "", spell: [], doneSteps: [], next: null, due_date: null, due_time: null };
  if (!text.trim()) return res;
  const sp = spellFix(text); res.spell = sp.changes; const fixed = sp.text; res.note = fixed.trim(); res.note = res.note.charAt(0).toUpperCase() + res.note.slice(1);
  const q = parseQuick(fixed); if (q.due_date) res.due_date = q.due_date; if (q.due_time) res.due_time = q.due_time;
  const steps = E.descendants(t.id).filter(x => !E.isDone(x));
  const bestStep = phrase => { const pw = new Set(words3(phrase)); let best = null; for (const st of steps) { const tw = [...new Set(words3(st.title))]; if (!tw.length) continue; const hit = tw.filter(w => pw.has(w) || [...pw].some(x => x.length > 4 && (x.startsWith(w) || w.startsWith(x)))).length; const sc = hit / tw.length; if (hit && (sc >= 0.5 || hit >= 2) && (!best || sc > best.sc)) best = { st, sc }; } return best?.st || null; };
  // split "A done, next is B, remind me ..." into parts
  const nextM = fixed.match(/\bnext(?:\s+step)?\s*(?:is|will be|would be|to|:|-|–|=)?\s+(.+)$/i);
  const before = nextM ? fixed.slice(0, nextM.index) : fixed;
  before.split(/[,.;]|\band\b|\bthen\b/i).forEach(seg => { if (!DONE_RX.test(seg)) return; const st = bestStep(seg); if (st && !res.doneSteps.includes(st)) res.doneSteps.push(st); });
  if (nextM) {
    let phrase = nextM[1].split(/\b(remind(er)?|alert|follow ?up on|(?:in|after|within) (?=\d|an? |half|one|two|three|five|ten)|\d+ ?(?:mins?|minutes?|hrs?|hours?) later|on (?=\d|mon|tue|wed|thu|fri|sat|sun|tomorrow|today|next))\b/i)[0];
    phrase = parseQuick(phrase).title.replace(/^(to|is|the|step)\s+/i, "").replace(/[\s,;:.-]+$/, "");
    if (phrase && phrase.length > 1) { const st = bestStep(phrase); res.next = st ? { step: st } : { title: phrase.charAt(0).toUpperCase() + phrase.slice(1) }; }
  }
  return res;
}
function updatePreview(t) {
  const host = $("#upd-preview"), ta = $("#upd-text"); if (!host || !ta) return;
  const a = analyzeUpdate(t, ta.value);
  // fill the date/time boxes from the sentence, unless the person set them by hand
  const dEl = $("#upd-date"), tEl = $("#upd-time");
  if (a.due_date && dEl && !dEl.dataset.manual) dEl.value = a.due_date;
  if (a.due_time && tEl && !tEl.dataset.manual) tEl.value = a.due_time;
  const bits = [];
  a.doneSteps.forEach(st => bits.push(`<span class="chip done-chip">✓ ${esc(st.title)}</span>`));
  if (a.next) bits.push(`<span class="chip next-chip">➜ Next: ${esc(a.next.step ? a.next.step.title : a.next.title)}${a.next.step ? "" : " (new step)"}</span>`);
  if (a.due_date || a.due_time) bits.push(`<span class="chip today">🔔 ${esc(dueLabel({ due_date: a.due_date || dEl?.value || dkey(), due_time: a.due_time || tEl?.value || null }))}</span>`);
  if (a.spell.length) bits.push(spellNote(a.spell));
  host.innerHTML = bits.length ? `<span class="muted" style="font-size:12px;font-weight:700">Will do:</span>${bits.join("")}` : "";
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
  send: ic('<path d="M4 12 20 4l-6 16-3-7z"/><path d="m11 13 9-9"/>'),
  chat: ic('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.5-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 11h7M8.5 14h4"/>'),
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
  ["money", "Money", I.money], ["focus", "Focus", I.focus], ["team", "Team & updates", I.team], ["chat", "Team chat", I.chat], ["workflows", "Workflows", I.flow],
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
      ${NAV.slice(6).map(([k, l, i]) => `<button class="tab" data-go="${k}">${i}${l}${k === "inbox" ? `<span class="badge" id="rail-badge" hidden></span>` : k === "chat" ? `<span class="badge" id="chat-badge" hidden></span>` : ""}</button>`).join("")}
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
  { const c = chatUnreadAll(), b = $("#chat-badge"); if (b) { b.hidden = !c; b.textContent = c; } }
  const sy = $("#sync"); if (sy) { sy.className = "sync " + (S.online ? "cloud" : "local"); $("span", sy).textContent = S.online ? "Synced" : "Reconnecting"; }
  const moreViews = ["more", "routine", "money", "funds", "focus", "team", "chat", "workflows", "automations", "inbox", "settings"];
  $$("[data-go]").forEach(b => { if (!b.classList.contains("tab")) return; const k = b.dataset.go; b.classList.toggle("on", k === U.view || (k === "more" && moreViews.includes(U.view) && b.closest(".tabbar"))); });
  $("#banner").innerHTML = S.mode !== "demo" ? "" : api.isClean?.() ? (U.view === "settings" ? `<div class="banner"><span>💾</span><span><b>Saved on this device only.</b> Sync between phone and computer switches on once your TaskerBay account server is connected. Use <b>Copy all my data</b> below as a backup.</span></div>` : "") : `<div class="banner"><span>🧪</span><span><b>Demo mode</b> with sample data. To start your own planner, go to Settings → <b>Start my own planner</b>.</span></div>`;
}

/* ================= Routing & render ================= */
const VIEWS = { chat: vChat, today: vToday, plan: vPlan, tasks: vTasks, routine: vRoutine, money: vMoney, funds: vFunds, approvals: vApprovals, timeline: vTimeline, report: vReport, activity: vActivity, admin: vAdmin, focus: vFocus, team: vTeam, workflows: vWorkflows, automations: vAutomations, inbox: vInbox, settings: vSettings, more: vMore };
function render(animate = false) {
  if (!S.ready) return;
  renderChrome();
  const v = $("#view");
  const ae = document.activeElement, aeId = ae && v.contains(ae) ? ae.id : null, val = aeId ? ae.value : null, sel = aeId && ae.selectionStart != null ? [ae.selectionStart, ae.selectionEnd] : null;
  v.innerHTML = VIEWS[U.view](animate);
  if (aeId) { const n = $("#" + aeId); if (n) { if (val != null) n.value = val; n.focus(); if (sel) try { n.setSelectionRange(...sel); } catch (e) {} } }
  afterRender(animate);
  { let tp = document.getElementById("timer-pill-wrap"); if (!tp) { tp = document.createElement("div"); tp.id = "timer-pill-wrap"; document.body.appendChild(tp); } tp.innerHTML = timerPill(); }
  if (animate) { v.classList.remove("enter"); void v.offsetWidth; v.classList.add("enter"); setTimeout(() => v.classList.remove("enter"), 900); }
  if (U.sheet?.type === "task") refreshTaskSheet();
}
function go(view, opts = {}) {
  if (!VIEWS[view]) view = "today";
  if (view === "settings") { U.access = null; U.cal = undefined; U.mfa = undefined; }
  if (view === "activity") U.act = null;
  if (view === "admin") U.adm = undefined; // always show fresh access requests and calendar status
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
  if (t.repeat) chips.push(`<span class="chip">${I.repeat} ${esc(E.repeatLabel(t.repeat))}</span>`);
  if (!done) { const w = waitingOn(t); if (w.length) chips.push(`<span class="chip warn" title="Waiting on: ${esc(w.map(x => x.title).join(", "))}">🔒 Waiting on ${w.length}</span>`); }
  { const tm = trackedMin(t.id); if (tm) chips.push(`<span class="chip">⏱ ${durTxt(tm)}</span>`); if (runningEntry()?.task_id === t.id) chips.push(`<span class="chip ok">● Timer on</span>`); }
  { const cu = chatUnread(t.id); if (cu) chips.push(`<span class="chip chat-chip">💬 ${cu}</span>`); }
  if (t.parent_id && opts.showParent) { const p = task(t.parent_id); if (p) chips.push(`<span class="chip">↳ ${esc(p.title).slice(0, 24)}</span>`); }
  return `<div class="row ${done ? "done" : ""}" style="--p:${PRI_C[t.priority]}" data-id="${t.id}" data-swipe="1">
    <button class="check" data-action="toggle" data-id="${t.id}" aria-label="${done ? "Reopen" : "Complete"}: ${esc(t.title)}">${I.check}</button>
    <div class="main" data-action="open-task" data-id="${t.id}" role="button" tabindex="0"><div class="t">${esc(t.title)}</div>${t.status_note && !done ? `<div class="st-note" title="Latest status">💬 ${esc(t.status_note)}${t.status_at ? ` <small>· ${timeAgo(t.status_at)}</small>` : ""}</div>` : ""}<div class="meta">${chips.join("")}</div></div>
    ${isTeam() && t.assignee_id ? avatar(t.assignee_id) : ""}
    <button class="star ${t.starred ? "on" : ""}" data-action="star" data-id="${t.id}" aria-label="${t.starred ? "Unstar" : "Star for today"}">${I.star}</button>
  </div>`;
}
function quickAdd(id, placeholder) {
  return `<form class="qa" data-form="quick" autocomplete="off"><label for="${id}" class="sr">New task</label><input id="${id}" data-quick="1" placeholder="${placeholder}" enterkeyhint="done">${SPEECH ? `<button class="qa-mic" type="button" data-action="voice" data-for="${id}" title="Say the task" aria-label="Say the task">🎤</button>` : ""}<button class="btn" type="submit">${I.plus}<span>Add</span></button><button class="btn ghost qa-bulk" type="button" data-action="bulk" title="Paste a list of tasks">☰<span>Bulk</span></button></form>
  <div class="qa-hint" data-hint-for="${id}">${hintFor("")}</div>`;
}
function hintFor(raw) {
  const sp = spellFix(raw, raw), v = sp.text;
  const keepBtn = sp.changes.length ? `${spellNote(sp.changes)}<button type="button" class="link" data-action="keep-spell" style="font-size:12px">Keep my spelling</button>` : "";
  return hintCore(v, raw) + keepBtn;
}
function hintCore(v, raw) {
  if (!v.trim()) return `<span>Shortcuts:</span><code>today</code><code>fri</code><code>3pm</code><code>#work</code><code>!high</code>${isTeam() ? "<code>@name</code>" : ""}<code>*</code><code>every month on 25th</code><span>· or update one:</span><code>report done</code><code>move dentist to thu 3pm</code>`;
  const it = parseIntent(v);
  if (it) {
    const st = it.stage ? E.stagesOf(it.task).find(s => s.key === it.stage) : null, fake = { ...it.task, due_date: it.due_date ?? it.task.due_date, due_time: it.due_time ?? it.task.due_time };
    return `<span>Will update:</span><span class="chip upd-chip">${esc(it.task.title.slice(0, 40))}</span>${st ? `<span class="chip" style="color:${st.color}">→ ${esc(st.name)}</span>` : ""}${it.due_date || it.due_time ? `<span class="chip ${E.dueStatus({ ...fake, stage: "todo" })}">${esc(dueLabel(fake))}</span>` : ""}${it.note ? `<span class="chip">💬 ${esc(it.note.slice(0, 40))}</span>` : ""}<span class="muted" style="font-size:11.5px">Start with <b>+</b> to add as a new task instead</span>`;
  }
  const p = parseQuick(v.replace(/^\+\s*/, "")), fake = { ...p, stage: "todo" };
  return `<span>Will add:</span>${p.due_date ? `<span class="chip ${E.dueStatus(fake)}">${esc(dueLabel(fake))}</span>` : `<span class="chip">No date</span>`}<span class="chip dot" style="--c:${AREA_C[p.area]}">${p.area}</span><span class="chip" style="color:${PRI_C[p.priority]}">${p.priority}</span>${p.assignee_id !== me() ? `<span class="chip">→ ${esc(nameOf(p.assignee_id))}</span>` : ""}${p.starred ? `<span class="chip today">⭐</span>` : ""}${p.repeat ? `<span class="chip">${I.repeat} ${esc(E.repeatLabel(p.repeat))}</span>` : ""}`;
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
  ${pushBanner()}<div class="hello"><div><h1>${greeting()}${first && first !== "You" ? `, <em>${esc(first)}</em>` : ""}</h1><p>${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} · ${esc(ws()?.name || "")}${E.holidayOn(dkey()) ? ` · 🎉 ${esc(E.holidayOn(dkey()).name)}` : ""}</p></div></div>
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
      ${meetingsCard()}
      ${freeCard()}
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
  const mtgs = meetingsOn(sel);
  const items = [...timed.map(t => ({ time: fmtTime(t.due_time), t })), ...rt.filter(r => r.time_of_day).map(r => ({ time: fmtTime(r.time_of_day), r })), ...mtgs.filter(m => !m.allDay).map(m => ({ time: hm(m.sm), m }))].sort((a, b) => a.time.localeCompare(b.time));
  const nowT = `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`;
  let nowPlaced = sel !== tk;
  const unscheduled = S.db.tasks.filter(t => !t.due_date && !t.parent_id && !E.isDone(t)).sort(sortTasks);
  const tl = items.map(it => {
    let line = "";
    if (!nowPlaced && it.time > nowT) { nowPlaced = true; line = `<div class="tl now"><div class="tm">${nowT}</div><div class="now-line"></div></div>`; }
    const body = it.m ? meetRow(it.m) : it.t ? taskRow(it.t) : `<button class="rt ${logged(it.r, sel) ? "on" : ""}" data-action="routine" data-id="${it.r.id}" ${sel !== tk ? "disabled" : ""}><span class="ic">${esc(it.r.icon)}</span><span class="t">${esc(it.r.name)}</span><span class="st">Routine</span></button>`;
    return line + `<div class="tl"><div class="tm">${it.time}</div><div>${body}</div></div>`;
  }).join("") + (!nowPlaced ? `<div class="tl now"><div class="tm">${nowT}</div><div class="now-line"></div></div>` : "");
  return `
  <div class="view-h"><div><h1>Planner</h1><p>${selDate.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}${E.holidayOn(dkey(selDate)) ? ` · 🎉 ${esc(E.holidayOn(dkey(selDate)).name)}` : !E.isWorkday(selDate) ? " · day off" : ""}</p></div><button class="btn ghost" data-action="plan-week">✨ Plan my week</button>
    <div class="month-nav"><button class="icon-btn" data-action="week" data-v="-1" aria-label="Previous week">${I.left}</button><button class="btn ghost" data-action="week" data-v="0" style="padding:8px 12px">This week</button><button class="icon-btn" data-action="week" data-v="1" aria-label="Next week">${I.right}</button></div></div>
  <div class="card"><div class="weekstrip">${days.map(d => { const k = dkey(d); const ts = S.db.tasks.filter(t => t.due_date === k && !E.isDone(t) && !t.parent_id); const od = ts.some(t => E.dueStatus(t) === "overdue"); return `<button class="day ${k === tk ? "today" : ""} ${sel === k ? "on" : ""} ${E.isWorkday(d) ? "" : "off"} ${E.holidayOn(k) ? "hol" : ""}" data-action="plan-day" data-v="${k}" ${E.holidayOn(k) ? `title="${esc(E.holidayOn(k).name)}"` : ""}><small>${d.toLocaleDateString("en-GB", { weekday: "short" })}</small><b class="num">${d.getDate()}</b><span class="dots">${ts.slice(0, 4).map(() => `<i class="${od ? "r" : ""}"></i>`).join("")}</span></button>`; }).join("")}</div></div>
  <div class="pl-cols">${days.map(d => { const k = dkey(d); const ts = S.db.tasks.filter(t => t.due_date === k && !t.parent_id).sort(sortTasks); return `<div class="pl-day ${k === tk ? "today" : ""}" data-drop-day="${k}"><h4>${d.toLocaleDateString("en-GB", { weekday: "short" })}<b>${d.getDate()}</b></h4>${E.holidayOn(k) ? `<div class="pl-hol">🎉 ${esc(E.holidayOn(k).name)}</div>` : ""}${meetingsOn(k).filter(m => !m.allDay).map(m => `<div class="pl-item pl-meet" data-action="plan-day" data-v="${k}"><small>${hm(m.sm)}</small>${esc(m.title)}</div>`).join("")}${ts.map(t => `<div class="pl-item ${E.isDone(t) ? "done" : ""}" draggable="true" data-drag-task="${t.id}" data-action="open-task" data-id="${t.id}" style="--p:${PRI_C[t.priority]}">${t.due_time ? `<small>${fmtTime(t.due_time)}</small>` : ""}${esc(t.title)}</div>`).join("")}<button class="add-card" style="color:var(--muted);font-weight:700;font-size:12px;padding:6px;text-align:left" data-action="new-task" data-due="${k}">＋ Add</button></div>`; }).join("")}</div>
  <div class="grid g-2 mt">
    <div class="card"><div class="card-h"><h2>⏰ Timeline</h2><button class="link" data-action="new-task" data-due="${sel}">＋ Add</button></div>
      ${items.length ? `<div class="timeline2">${tl}</div>` : emptyBox("Nothing scheduled", "Give tasks a time (e.g. <b style='display:inline'>3pm</b>) and add routine times to see them here." + ((S.db.calendar_events || []).length ? "" : " Connect your Outlook calendar in Settings to see meetings too."), I.plan)}
    </div>
    <div class="grid" style="gap:14px;align-content:start">
      <div class="card"><div class="card-h"><h2>📌 All day</h2><span class="sub">${allday.length + mtgs.filter(m => m.allDay).length}</span></div><div class="list">${mtgs.filter(m => m.allDay).map(meetRow).join("")}${allday.length ? allday.map(t => taskRow(t)).join("") : mtgs.some(m => m.allDay) ? "" : `<p class="muted" style="margin:0">No all-day tasks.</p>`}</div></div>
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
  if (U.taskMode === "list" && U.taskFilter === "done" && S.mode === "cloud") body += U.oldDone === S.wsId ? `<p class="muted" style="text-align:center;font-size:12.5px;margin:14px 0 0">Showing every finished task in this workspace.</p>` : `<div style="text-align:center;margin-top:14px"><button class="btn ghost" data-action="old-done">Show finished tasks older than 4 months</button></div>`;
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
  const keep = {}; ["tf-title", "tf-notes", "upd-text", "step-new", "chat-in-task"].forEach(id => { const n = $("#" + id); if (n) keep[id] = n.value; });
  const chatEl = $("#chat-list-" + t.id), chatAtEnd = !chatEl || chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 120, chatTop = chatEl?.scrollTop;
  // keep the status form's date/time/stage only if the person changed them, so they never go stale
  ["upd-date", "upd-time"].forEach(id => { const n = $("#" + id); if (n && n.value !== n.defaultValue) keep[id] = n.value; });
  ["upd-stage", "upd-rem"].forEach(id => { const n = $("#" + id); if (n && !n.options[n.selectedIndex]?.defaultSelected) keep[id] = n.value; });
  const manual = { d: $("#upd-date")?.dataset.manual, t: $("#upd-time")?.dataset.manual };
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
      <div class="field"><label for="tf-rem">Reminder ${t.due_time ? "" : `<small class="muted">(set a time)</small>`}</label>${remindSelect("tf-rem", t.remind_before, `data-tfield="remind_before"`)}</div>
      <div class="field"><label for="tf-pri">Priority</label><select class="inp" id="tf-pri" data-tfield="priority">${["High", "Medium", "Low"].map(p => `<option ${t.priority === p ? "selected" : ""}>${p}</option>`).join("")}</select></div>
      <div class="field"><label for="tf-area">Area</label><select class="inp" id="tf-area" data-tfield="area">${AREAS.map(a => `<option ${t.area === a ? "selected" : ""}>${a}</option>`).join("")}</select></div>
      <div class="field"><label for="tf-wf">Workflow</label><select class="inp" id="tf-wf" data-tfield="workflow_id">${E.workflows().map(w => `<option value="${w.id}" ${w.id === wf?.id ? "selected" : ""}>${esc(w.icon)} ${esc(w.name)}</option>`).join("")}</select></div>
      <div class="field"><label for="tf-rep">Repeat</label><select class="inp" id="tf-rep" data-tfield="repeat">${(() => { const base = [["", "Never"], ["daily", "Every day"], ["weekdays", "Every working day"], ["weekly", "Every week"], ["every:2w", "Every other week"], ["monthly", "Every month"], ["monthly:lastwd", "Last working day of the month"], ["monthly:firstwd", "First working day of the month"], ["monthly:last", "Last day of the month"], ["yearly", "Every year"]]; if (t.due_date) { const d = parseKey(t.due_date); base.splice(6, 0, [`monthly:${d.getDate()}`, `Monthly on the ${E.repeatLabel("monthly:" + d.getDate()).replace("monthly on the ", "")}`], [`weekly:${d.getDay()}`, `Every ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()]}`]); } if (t.repeat && !base.some(b => b[0] === t.repeat)) base.push([t.repeat, E.repeatLabel(t.repeat)]); return base.filter((b, i, a) => a.findIndex(x => x[0] === b[0]) === i).map(([v, l]) => `<option value="${v}" ${t.repeat === v ? "selected" : ""}>${esc(l[0].toUpperCase() + l.slice(1))}</option>`).join(""); })()}</select></div>
      ${members.length > 1 ? `<div class="field"><label for="tf-as">Assigned to</label><select class="inp" id="tf-as" data-tfield="assignee_id"><option value="">Nobody</option>${members.map(u => `<option value="${u}" ${t.assignee_id === u ? "selected" : ""}>${esc(nameOf(u))}${u === me() ? " (me)" : ""}</option>`).join("")}</select></div>` : ""}
      <div class="field"><label for="tf-est">Takes (minutes)</label><input class="inp" type="number" min="0" step="5" id="tf-est" data-tfield="estimate_min" value="${t.estimate_min ?? ""}" inputmode="numeric"></div>
    </div>
    ${depsField(t)}
    ${timeField(t)}
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
        <label for="upd-text" class="sr">Status update</label><textarea class="inp" id="upd-text" placeholder="What's the latest? e.g. Draft done, next is send for review, remind me Thursday 10am"></textarea>
        <div id="upd-preview" class="upd-preview"></div>
        <div class="fgrid upd-grid">
          <div class="field"><label for="upd-date">Next date</label><input class="inp" type="date" id="upd-date" value="${t.due_date || ""}"></div>
          <div class="field"><label for="upd-time">Time</label><input class="inp" type="time" id="upd-time" value="${fmtTime(t.due_time)}"></div>
          <div class="field"><label for="upd-rem">Reminder</label>${remindSelect("upd-rem", t.remind_before ?? 0)}</div>
          <div class="field"><label for="upd-stage">Stage</label><select class="inp" id="upd-stage">${E.stagesOf(t).map(s => `<option value="${esc(s.key)}" ${s.key === E.stageOf(t).key ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>
        </div>
        <button class="btn" data-action="post-update">Save update</button>
      </div>
    </div>
    ${isTeam() ? `<div class="card" style="padding:14px;box-shadow:none;margin-top:12px"><div class="card-h" style="margin-bottom:6px"><h2>💬 Chat</h2><span class="sub">${S.db.workspace_members.length} people in ${esc(ws()?.name || "this workspace")}</span></div>${chatPanel(t.id, "chat-in-task")}</div>` : ""}
    <div class="sheet-actions" style="margin-top:14px"><button class="btn danger" data-action="delete-task" data-id="${t.id}">Delete</button>${!E.isDone(t) ? `<button class="btn ghost" data-action="focus-task" data-id="${t.id}">⏱ Focus</button>` : ""}${E.childrenOf(t.id).length ? `<button class="btn ghost" data-action="tpl-save" data-id="${t.id}">📋 Save as template</button>` : ""}${!E.isDone(t) && isTeam() ? `<button class="btn ghost" data-action="ap-new" data-task="${t.id}">✅ Ask for approval</button>` : ""}${!E.isDone(t) && t.assignee_id && t.assignee_id !== me() && S.mode === "cloud" ? `<button class="btn ghost" data-action="nudge" data-id="${t.id}">⏰ Remind ${esc(nameOf(t.assignee_id).split(" ")[0])}</button>` : ""}<button class="btn" data-action="close-sheet">Done</button></div>
    <p class="muted" style="font-size:11.5px;text-align:center;margin:10px 0 0">Created ${timeAgo(t.created_at)} by ${esc(nameOf(t.created_by))}${t.completed_at ? ` · finished ${timeAgo(t.completed_at)}` : ""}</p>`;
  Object.entries(keep).forEach(([id, v]) => { const n = $("#" + id); if (n && v !== undefined && document.activeElement !== n) n.value = v; });
  Object.entries(sub).forEach(([id, v]) => { const n = $(`[data-sub-input="${id}"]`); if (n) n.value = v; });
  if (aeId) { const n = aeId.startsWith("sub:") ? $(`[data-sub-input="${aeId.slice(4)}"]`) : $("#" + aeId); if (n && !first) n.focus(); }
  if (manual.d && $("#upd-date")) $("#upd-date").dataset.manual = "1"; if (manual.t && $("#upd-time")) $("#upd-time").dataset.manual = "1";
  updatePreview(t);
  if (isTeam()) { const el = $("#chat-list-" + t.id); if (el) { if (chatAtEnd) el.scrollTop = el.scrollHeight; else el.scrollTop = chatTop; } if (chatUnread(t.id)) markRead(t.id); }
}
async function saveTaskField(el) {
  const t = task(U.sheet?.id); if (!t) return;
  const f = el.dataset.tfield; let v = el.value;
  if (f === "title") { v = v.trim(); if (!v) { el.value = t.title; return; } }
  if (f === "due_date" || f === "due_time" || f === "assignee_id" || f === "workflow_id") v = v || null;
  if (f === "estimate_min") v = v === "" ? null : Math.max(0, parseInt(v, 10) || 0);
  if (f === "remind_before") { v = parseInt(v, 10); if ((t.remind_before ?? 0) === v) return; }
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


/* ================= FREE TIME (home screen) =================
   Your working hours minus tasks that have a time (each takes its "Takes" minutes, 30 by default,
   15 for quick ones) and timed routines. Pick any of the next 7 days, then copy/share or book a slot. */
const FREE = (() => { const d = { start: "09:00", end: "18:00", min: 30 }; try { return { ...d, ...JSON.parse(localStorage.getItem("tb.free") || "{}") }; } catch (e) { return d; } })();
const saveFree = () => { try { localStorage.setItem("tb.free", JSON.stringify(FREE)); } catch (e) {} };
const toMin = t => { const [h, m] = String(t || "0:0").split(":").map(Number); return h * 60 + (m || 0); };
const minT = n => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;
const fmt12 = n => { let h = Math.floor(n / 60) % 24; const m = n % 60, ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return `${h}:${pad(m)} ${ap}`; };
const durTxt = n => n >= 60 ? `${Math.floor(n / 60)}h${n % 60 ? ` ${n % 60}m` : ""}` : `${n}m`;
const taskMins = t => +t.estimate_min > 0 ? +t.estimate_min : /\bquick\b/i.test(t.title || "") ? 15 : 30;
function dayBusy(k) {
  const mine = t => !t.assignee_id || t.assignee_id === me();
  const items = S.db.tasks.filter(t => t.due_date === k && t.due_time && !E.isDone(t) && mine(t))
    .map(t => { const s = toMin(fmtTime(t.due_time)), d = taskMins(t); return { s, e: s + d, d, label: t.title, id: t.id, quick: d <= 15 }; });
  routineToday(parseKey(k)).filter(r => r.time_of_day).forEach(r => { const s = toMin(fmtTime(r.time_of_day)); items.push({ s, e: s + 15, d: 15, label: `${r.icon} ${r.name}`, quick: true }); });
  meetingsOn(k).filter(m => m.busy !== "FREE" && (!m.allDay || m.busy === "OOF" || m.busy === "BUSY")).forEach(m => items.push(m.allDay ? { s: 0, e: 1440, d: 1440, label: `📅 ${m.title} (all day)`, meet: true } : { s: m.sm, e: m.em, d: m.em - m.sm, label: `📅 ${m.title}`, meet: true }));
  return items.sort((a, b) => a.s - b.s);
}
/* Outlook / Microsoft 365 meetings (read-only copy from the connected calendar) */
function meetingsOn(k) {
  const d0 = parseKey(k).getTime(), d1 = addDays(parseKey(k), 1).getTime(), out = [];
  for (const e of S.db.calendar_events || []) {
    if (e.all_day) { const sd = String(e.start_at).slice(0, 10), ed = String(e.end_at).slice(0, 10); if (sd <= k && k < (ed > sd ? ed : sd + "~")) out.push({ ...e, allDay: true }); continue; }
    const s = new Date(e.start_at).getTime(), en = new Date(e.end_at).getTime();
    if (en <= d0 || s >= d1 || (en === s && (s < d0 || s >= d1))) continue;
    out.push({ ...e, sm: Math.max(0, Math.round((s - d0) / 6e4)), em: Math.min(1440, Math.max(Math.round((en - d0) / 6e4), Math.round((s - d0) / 6e4) + 1)) });
  }
  return out.sort((a, b) => (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0) || (a.sm ?? 0) - (b.sm ?? 0));
}
const hm = n => fmtTime(minT(Math.min(n, 1439)));
const meetRow = m => { const now = new Date(), nm = now.getHours() * 60 + now.getMinutes(), live = !m.allDay && m.start_at.slice(0, 10) <= dkey() && new Date(m.start_at) <= now && now < new Date(m.end_at);
  return `<div class="mtg ${m.busy === "FREE" ? "free" : ""} ${live ? "live" : ""}"><div class="mt-t">${m.allDay ? "All day" : `${hm(m.sm)}<small>${hm(m.em)}</small>`}</div><div class="mt-b"><b>${esc(m.title)}</b><small>${[m.location, m.busy === "TENTATIVE" ? "Tentative" : m.busy === "OOF" ? "Out of office" : m.busy === "FREE" ? "Free" : "", m.recurring ? "Repeats" : ""].filter(Boolean).map(esc).join(" · ")}</small></div>${live ? `<span class="chip ok">Now</span>` : ""}</div>`; };
function meetingsCard() {
  if (!(S.db.calendar_events || []).length) return "";
  const k = dkey(), list = meetingsOn(k), now = new Date(), nm = now.getHours() * 60 + now.getMinutes();
  const left = list.filter(m => m.allDay || m.em > nm), next = list.find(m => !m.allDay && m.sm > nm);
  return `<div class="card"><div class="card-h"><h2>📅 Today's meetings</h2><span class="sub">${list.length ? (next ? `Next at ${hm(next.sm)}` : left.length ? "" : "All done") : "None"}</span></div>
    ${list.length ? `<div class="mtgs">${list.map(meetRow).join("")}</div>` : `<p class="muted" style="margin:0">No meetings in your Outlook calendar today.</p>`}
    <p class="muted" style="font-size:12px;margin:8px 0 0">From your Outlook calendar · read only</p></div>`;
}
function freeSlots(k) {
  const S0 = toMin(FREE.start), S1 = Math.max(toMin(FREE.end), S0 + 30);
  if (!E.isWorkday(parseKey(k))) return { busy: dayBusy(k), gaps: [], slots: [], S0, S1, from: S1, off: E.holidayOn(k)?.name || "Day off" };
  let from = S0;
  if (k === dkey()) { const n = new Date(); from = Math.max(S0, Math.ceil((n.getHours() * 60 + n.getMinutes()) / 5) * 5); }
  const busy = dayBusy(k), gaps = []; let cur = from;
  for (const b of busy) { if (b.e <= cur) continue; if (b.s >= S1) break; if (b.s > cur) gaps.push([cur, Math.min(b.s, S1)]); cur = Math.max(cur, b.e); }
  if (cur < S1) gaps.push([cur, S1]);
  return { busy, gaps, slots: gaps.filter(([a, b]) => b - a >= FREE.min), S0, S1, from };
}
const dayName = k => parseKey(k).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
function freeText(keys) {
  const lines = [];
  for (const k of keys) { const { slots } = freeSlots(k); lines.push(`${dayName(k)}: ${slots.length ? slots.map(([a, b]) => `${fmt12(a)} – ${fmt12(b)}`).join(", ") : "no free time"}`); }
  return `My free times${keys.length === 1 ? "" : " (next 7 days)"}:\n${lines.join("\n")}`;
}
async function shareText(text, title) {
  if (navigator.share && matchMedia("(pointer:coarse)").matches) { try { await navigator.share({ title, text }); return; } catch (e) { if (e?.name === "AbortError") return; } }
  try { await navigator.clipboard.writeText(text); toast("Copied. Paste it in WhatsApp, email or Teams."); } catch (e) { toast("Couldn't copy here."); }
}
function freeCard() {
  const tk = dkey(); if (!U.freeDay || U.freeDay < tk) U.freeDay = tk;
  const k = U.freeDay, { busy, gaps, slots, S0, S1, from } = freeSlots(k), span = S1 - S0;
  const pct = n => Math.max(0, Math.min(100, (n - S0) / span * 100));
  const total = slots.reduce((s, [a, b]) => s + b - a, 0), dow = parseKey(k).getDay();
  const bar = `<div class="fbar" role="img" aria-label="Free and busy times">
    ${from > S0 ? `<i class="past" style="left:0;width:${pct(from)}%"></i>` : ""}
    ${gaps.map(([a, b]) => `<i class="${b - a >= FREE.min ? "free" : "gap"}" style="left:${pct(a)}%;width:${pct(b) - pct(a)}%" title="Free ${fmt12(a)} – ${fmt12(b)}"></i>`).join("")}
    ${busy.filter(b => b.e > S0 && b.s < S1).map(b => `<i class="busy ${b.meet ? "meet" : b.quick ? "quick" : ""}" style="left:${pct(b.s)}%;width:${Math.max(.8, pct(b.e) - pct(b.s))}%" title="${esc(b.label)} ${fmt12(b.s)}"></i>`).join("")}
  </div><div class="fticks"><span>${fmt12(S0)}</span><span>${fmt12(S0 + Math.round(span / 2 / 30) * 30)}</span><span>${fmt12(S1)}</span></div>`;
  return `<div class="card free-card">
    <div class="card-h"><h2>🕒 Free time</h2><span class="sub">${total ? `${durTxt(total)} free` : "Fully booked"}</span></div>
    <div class="fdays">${[...Array(7)].map((_, i) => { const d = addDays(new Date(), i), dk = dkey(d), f = freeSlots(dk).slots.reduce((s, [a, b]) => s + b - a, 0); const offD = !E.isWorkday(d), hol = E.holidayOn(dk); return `<button class="${dk === k ? "on" : ""} ${offD ? "wkend" : ""}" data-action="free-day" data-v="${dk}" ${hol ? `title="${esc(hol.name)}"` : ""}><small>${i === 0 ? "Today" : d.toLocaleDateString("en-GB", { weekday: "short" })}</small><b class="num">${d.getDate()}</b><em>${hol ? "Holiday" : offD ? "Off" : f ? durTxt(f) : "full"}</em></button>`; }).join("")}</div>
    ${bar}
    <div class="flegend"><span><i class="free"></i>Free</span><span><i class="busy"></i>Busy</span><span><i class="busy quick"></i>Quick task</span>${busy.some(b => b.meet) ? `<span><i class="busy meet"></i>Meeting</span>` : ""}${E.holidayOn(k) ? `<span class="chip">🎉 ${esc(E.holidayOn(k).name)}</span>` : !E.isWorkday(parseKey(k)) ? `<span class="chip">Day off</span>` : ""}</div>
    <div class="slots">${slots.length ? slots.map(([a, b]) => `<div class="slot"><div><b>${fmt12(a)} – ${fmt12(b)}</b><small>${durTxt(b - a)} free</small></div><button class="btn ghost" data-action="free-book" data-d="${k}" data-t="${minT(a)}">Book</button></div>`).join("")
      : !E.isWorkday(parseKey(k)) ? `<p class="muted" style="margin:4px 0">${E.holidayOn(k) ? `${esc(E.holidayOn(k).name)}: a public holiday` : "Not a working day"}${E.CAL.country ? ` in ${esc(CAL.countryName(E.CAL.country))}` : ""}. Change your working days in Settings → Region.</p>`
      : `<p class="muted" style="margin:4px 0">No free slot of ${durTxt(FREE.min)} or more ${k === tk ? "left today" : `on ${dayName(k)}`} between ${fmt12(S0)} and ${fmt12(S1)}.</p>`}</div>
    ${busy.length ? `<details class="fbusy"><summary>Busy: ${busy.length} item${busy.length > 1 ? "s" : ""}</summary>${busy.map(b => `<div ${b.id ? `data-action="open-task" data-id="${b.id}" role="button" tabindex="0"` : ""}><b>${fmt12(b.s)}</b><span>${esc(b.label)}</span><small>${durTxt(b.d)}</small></div>`).join("")}</details>` : ""}
    <div class="fact"><button class="btn" data-action="free-share" data-v="day">Share ${k === tk ? "today" : dayName(k)}</button><button class="btn ghost" data-action="free-share" data-v="week">Share next 7 days</button></div>
    <details class="fset"><summary>Working hours &amp; slot length</summary><div class="fgrid" style="margin-top:8px"><div class="field"><label for="free-start">From</label><input class="inp" type="time" id="free-start" value="${FREE.start}"></div><div class="field"><label for="free-end">To</label><input class="inp" type="time" id="free-end" value="${FREE.end}"></div></div>
      <div class="seg" role="group" aria-label="Shortest slot">${[15, 30, 60, 120].map(m => `<button class="${FREE.min === m ? "on" : ""}" data-action="free-min" data-v="${m}">${durTxt(m)}+</button>`).join("")}</div>
      <p class="muted" style="font-size:12.5px;margin:8px 0 0">Tasks block their “Takes” time (30 min if not set, 15 min for quick ones). Write “for 1 hour” or “quick” when adding a task.${(S.db.calendar_events || []).length ? " Outlook meetings marked Busy, Tentative or Away also count." : " Connect your Outlook calendar in Settings so meetings count too."}</p></details>
  </div>`;
}

/* ================= FUNDS (shared event / project money) ================= */
const F_CATS = ["General", "Food", "Transport", "Venue", "Decor", "Gifts", "Printing", "Supplies", "Contribution", "Donation", "Sponsorship", "Other"];
const fundOf = id => S.db.fund_projects.find(f => f.id === id);
const isFundOwner = f => f?.owner_id === me();
const fMembers = f => S.db.fund_members.filter(m => m.project_id === f.id).sort((a, b) => (b.user_id === f.owner_id) - (a.user_id === f.owner_id) || a.name.localeCompare(b.name));
const fEntries = f => S.db.fund_entries.filter(x => x.project_id === f.id);
const myFundMember = f => S.db.fund_members.find(m => m.project_id === f.id && m.user_id === me());
const fmoney = (f, n) => `${f.currency} ${famt(n)}`;
const famt = n => { const v = Math.round((+n || 0) * 100) / 100; return v % 1 ? v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : nf.format(v); };
function fundStats(f) {
  const es = fEntries(f), ok = es.filter(x => x.status === "approved"), pend = es.filter(x => x.status === "pending");
  const sum = (arr, k) => arr.filter(x => x.kind === k).reduce((s, x) => s + +x.amount, 0);
  const people = fMembers(f).map(m => {
    const a = ok.filter(x => x.member_id === m.id), p = pend.filter(x => x.member_id === m.id), lim = m.limit_amount == null ? null : +m.limit_amount;
    const inn = sum(a, "in"), out = sum(a, "out"), pOut = sum(p, "out"), pIn = sum(p, "in");
    return { m, inn, out, pIn, pOut, pend: p.length, hand: inn - out, lim, left: lim == null ? null : lim - out, over: lim != null && out > lim, warn: lim != null && out + pOut > lim };
  });
  const byCat = {}; ok.forEach(x => { const c = byCat[x.category] = byCat[x.category] || { in: 0, out: 0 }; c[x.kind] += +x.amount; });
  const collected = sum(ok, "in"), spent = sum(ok, "out"), budget = +f.total_budget || 0;
  return { es, ok, pend, people, byCat, collected, spent, hand: collected - spent, budget, left: budget - spent, allocated: people.reduce((s, p) => s + (p.lim || 0), 0), pendIn: sum(pend, "in"), pendOut: sum(pend, "out"), overBudget: budget > 0 && spent > budget };
}
const moneyTabs = on => `<div class="seg" role="group" aria-label="Money"><button class="${on === "money" ? "on" : ""}" data-go="money">My spending</button><button class="${on === "funds" ? "on" : ""}" data-go="funds">Funds${fundsWaiting() ? ` <span class="badge">${fundsWaiting()}</span>` : ""}</button></div>`;
const fundsWaiting = () => S.db.fund_entries.filter(x => x.status === "pending" && isFundOwner(fundOf(x.project_id))).length;
const stChip = s => s === "approved" ? `<span class="chip ok">Approved</span>` : s === "rejected" ? `<span class="chip bad">Rejected</span>` : `<span class="chip wait">Waiting</span>`;

function vFunds() {
  const f = U.fundId && fundOf(U.fundId);
  if (f) return vFundDetail(f);
  const list = [...S.db.fund_projects].sort((a, b) => (a.status === "closed") - (b.status === "closed") || b.created_at.localeCompare(a.created_at));
  return `<div class="view-h"><div><h1>Funds</h1><p>Budgets for events and projects, shared with the people who collect and spend</p></div>${moneyTabs("funds")}</div>
  <div style="display:flex;justify-content:flex-end;margin-bottom:12px"><button class="btn" data-action="fd-new">${I.plus}New fund</button></div>
  ${list.length ? `<div class="fund-grid">${list.map(x => { const st = fundStats(x), own = isFundOwner(x), p = st.budget ? Math.min(100, st.spent / st.budget * 100) : 0, waiting = own ? st.pend.length : st.pend.filter(e => e.created_by === me()).length, flags = st.people.filter(q => q.over).length;
    return `<button class="card fund-card hov ${x.status === "closed" ? "closed" : ""}" data-action="fd-open" data-id="${x.id}">
      <div class="fc-h"><b>${esc(x.name)}</b><span class="chip ${own ? "ok" : ""}">${own ? "Admin" : "Member"}</span>${x.status === "closed" ? `<span class="chip">Closed</span>` : ""}</div>
      ${x.description ? `<p class="muted fc-d">${esc(x.description)}</p>` : ""}
      <div class="fc-n"><div><small>Collected</small><b class="amt-in">${fmoney(x, st.collected)}</b></div><div><small>Spent</small><b class="amt-out">${fmoney(x, st.spent)}</b></div><div><small>In hand</small><b>${fmoney(x, st.hand)}</b></div></div>
      ${st.budget ? `<div class="budget ${st.overBudget ? "over" : p > 80 ? "warn" : ""}" style="padding:0"><div class="bh">Budget ${fmoney(x, st.budget)}<span class="num">${Math.round(st.spent / st.budget * 100)}% used</span></div><div class="track"><i style="width:${p}%"></i></div></div>` : ""}
      <div class="fc-f">${waiting ? `<span class="chip wait">⏳ ${waiting} waiting</span>` : ""}${flags ? `<span class="chip bad">⚠️ ${flags} over limit</span>` : ""}<span class="muted">${st.people.length} ${st.people.length === 1 ? "person" : "people"} · ${st.es.length} entries</span></div>
    </button>`; }).join("")}</div>`
    : `<div class="card">${emptyBox("No funds yet", "Create one for an event, trip, party or project. Set the total budget, add the people who collect or spend money, and give each a limit. You approve what they add, and you can download a PDF report any time.", I.money)}<div style="text-align:center;margin-top:12px"><button class="btn" data-action="fd-new">${I.plus}Create your first fund</button></div></div>`}`;
}

function vFundDetail(f) {
  const st = fundStats(f), own = isFundOwner(f), mm = myFundMember(f), cur = f.currency;
  const filt = U.fundFilter || "all", who = U.fundWho || "";
  let rows = [...st.es].filter(x => x.status !== "rejected" || filt === "rejected" || filt === "all");
  if (filt === "in" || filt === "out") rows = rows.filter(x => x.kind === filt && x.status !== "rejected");
  if (filt === "pending") rows = rows.filter(x => x.status === "pending");
  if (filt === "rejected") rows = rows.filter(x => x.status === "rejected");
  if (who) rows = rows.filter(x => x.member_id === who);
  rows.sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
  const mName = id => S.db.fund_members.find(m => m.id === id)?.name || "Removed person";
  const waiting = own ? st.pend : st.pend.filter(x => x.created_by === me());
  const pb = st.budget ? Math.min(100, st.spent / st.budget * 100) : 0;
  const entryRow = x => { const canEdit = own || (x.created_by === me() && x.status === "pending"); return `<div class="row fe-row ${x.status}" style="--c:${x.kind === "in" ? "var(--green)" : "var(--red)"}">
      <div class="main" ${canEdit ? `data-action="fd-entry" data-id="${x.id}" role="button" tabindex="0"` : ""}><div class="t">${esc(x.title || x.category)}</div>
      <div class="meta"><span class="chip">${esc(mName(x.member_id))}</span><span class="chip">${esc(x.category)}</span><span class="chip">${parseKey(x.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>${stChip(x.status)}${x.note ? `<span class="chip">📝 ${esc(x.note.slice(0, 30))}</span>` : ""}${x.status === "rejected" && x.review_note ? `<span class="chip bad">${esc(x.review_note.slice(0, 40))}</span>` : ""}</div></div>
      <span class="${x.kind === "in" ? "amt-in" : "amt-out"}">${x.kind === "in" ? "+" : "−"}${famt(x.amount)}</span></div>`; };
  return `<div class="view-h"><div><button class="link" data-action="fd-back" style="margin-bottom:6px;font-weight:700">‹ All funds</button><h1>${esc(f.name)}</h1><p>${own ? "You're the admin" : "Admin: " + esc(fMembers(f).find(m => m.user_id === f.owner_id)?.name || "the creator")} · ${cur}${f.status === "closed" ? " · Closed" : ""}</p></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">${f.status === "active" && (own || mm) ? `<button class="btn" data-action="fd-entry">${I.plus}Add entry</button>` : ""}<button class="btn ghost" data-action="fd-pdf" data-id="${f.id}">📄 PDF report</button>${own ? `<button class="btn ghost" data-action="fd-edit" data-id="${f.id}">Edit</button>` : ""}</div></div>
  ${f.description ? `<p class="muted" style="margin:-4px 0 14px">${esc(f.description)}</p>` : ""}
  <div class="grid g-stats fund-stats">
    <div class="card stat" style="--c:var(--accent)"><div class="k"><i></i>Budget</div><div class="v num">${famt(st.budget)}</div><div class="d">${st.allocated ? `${famt(st.allocated)} given as limits` : cur}</div></div>
    <div class="card stat" style="--c:var(--green)"><div class="k"><i></i>Collected</div><div class="v num">${famt(st.collected)}</div><div class="d">${st.pendIn ? `+${famt(st.pendIn)} waiting` : "Approved"}</div></div>
    <div class="card stat" style="--c:var(--red)"><div class="k"><i></i>Spent</div><div class="v num">${famt(st.spent)}</div><div class="d">${st.pendOut ? `+${famt(st.pendOut)} waiting` : "Approved"}</div></div>
    <div class="card stat" style="--c:var(--gold)"><div class="k"><i></i>Cash in hand</div><div class="v num">${famt(st.hand)}</div><div class="d">Collected − spent</div></div>
    <div class="card stat" style="--c:${st.left < 0 ? "var(--red)" : "var(--blue)"}"><div class="k"><i></i>Budget left</div><div class="v num" style="${st.left < 0 ? "color:var(--red)" : ""}">${famt(st.left)}</div><div class="d">${st.budget ? (st.overBudget ? "⚠️ Over budget" : `${Math.round(pb)}% used`) : "No total budget set"}</div></div>
  </div>
  ${st.budget ? `<div class="card mt"><div class="budget ${st.overBudget ? "over" : pb > 80 ? "warn" : ""}" style="padding:0"><div class="bh">Budget used<span class="num">${famt(st.spent)} / ${famt(st.budget)}</span></div><div class="track"><i style="width:${pb}%"></i></div></div></div>` : ""}
  ${waiting.length ? `<div class="card mt fund-wait"><div class="card-h"><h2>⏳ ${own ? "Waiting for your approval" : "Your entries waiting for approval"}</h2>${own && waiting.length > 1 ? `<button class="btn ghost" data-action="fd-approve-all" data-id="${f.id}" style="padding:7px 12px">Approve all ${waiting.length}</button>` : `<span class="sub">${waiting.length}</span>`}</div>
    <div class="list">${waiting.map(x => { const p = st.people.find(q => q.m.id === x.member_id), willOver = x.kind === "out" && p && p.lim != null && p.out + +x.amount > p.lim;
      return `<div class="li fw-row"><div class="grow" ${own ? `data-action="fd-entry" data-id="${x.id}" role="button" tabindex="0"` : ""}><b>${x.kind === "in" ? "Collected" : "Spent"} ${fmoney(f, x.amount)} · ${esc(x.title || x.category)}</b><small>${esc(mName(x.member_id))} · ${esc(x.category)} · ${parseKey(x.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}${x.note ? " · " + esc(x.note) : ""}</small>${willOver ? `<small class="flag">⚠️ Takes ${esc(p.m.name)} over their limit: ${famt(p.out + +x.amount)} of ${famt(p.lim)}</small>` : ""}</div>
      ${own ? `<div class="fw-btns"><button class="btn" data-action="fd-approve" data-id="${x.id}" style="padding:7px 12px">Approve</button><button class="btn ghost" data-action="fd-reject" data-id="${x.id}" style="padding:7px 12px">Reject</button></div>` : `<button class="btn ghost" data-action="fd-entry" data-id="${x.id}" style="padding:7px 12px">Edit</button>`}</div>`; }).join("")}</div></div>` : ""}
  <div class="card mt"><div class="card-h"><h2>👥 People</h2>${own ? `<button class="btn ghost" data-action="fd-person" style="padding:7px 12px">${I.plus}Add person</button>` : ""}</div>
    <div class="ftable-wrap"><table class="ftable"><thead><tr><th>Person</th><th>Limit</th><th>Collected</th><th>Spent</th><th>In hand</th><th>Limit left</th></tr></thead><tbody>
    ${st.people.map(p => `<tr class="${p.over ? "over" : p.warn ? "warn" : ""}" ${own ? `data-action="fd-person" data-id="${p.m.id}" role="button" tabindex="0"` : ""}>
      <td><b>${esc(p.m.name)}</b>${p.m.user_id === f.owner_id ? ` <span class="chip ok">Admin</span>` : p.m.user_id ? "" : ` <span class="chip">No app</span>`}${p.pend ? ` <span class="chip wait">${p.pend} waiting</span>` : ""}</td>
      <td>${p.lim == null ? "—" : famt(p.lim)}</td><td class="amt-in">${famt(p.inn)}</td><td class="amt-out">${famt(p.out)}</td><td>${famt(p.hand)}</td>
      <td>${p.lim == null ? "—" : `${p.over ? "⚠️ " : ""}${famt(p.left)}`}</td></tr>`).join("")}
    </tbody><tfoot><tr><td>Total</td><td>${st.allocated ? famt(st.allocated) : "—"}</td><td>${famt(st.collected)}</td><td>${famt(st.spent)}</td><td>${famt(st.hand)}</td><td></td></tr></tfoot></table></div>
    ${st.budget && st.allocated > st.budget ? `<p class="flag" style="margin:10px 0 0">⚠️ Limits given (${famt(st.allocated)}) are more than the total budget (${famt(st.budget)}).</p>` : ""}
    <p class="muted" style="font-size:12.5px;margin:10px 0 0">In hand = what they collected minus what they spent. A minus means the fund owes them. Only approved entries count; waiting ones are shown separately.</p></div>
  ${Object.keys(st.byCat).length ? `<div class="card mt"><div class="card-h"><h2>🗂️ By category</h2></div><div class="list">${Object.entries(st.byCat).sort((a, b) => (b[1].out + b[1].in) - (a[1].out + a[1].in)).map(([c, v]) => `<div class="li"><div class="grow"><b>${esc(c)}</b></div>${v.in ? `<span class="amt-in">+${famt(v.in)}</span>` : ""}${v.out ? `<span class="amt-out" style="margin-left:10px">−${famt(v.out)}</span>` : ""}</div>`).join("")}</div></div>` : ""}
  <div class="card mt"><div class="card-h"><h2>Entries</h2><span class="sub">${rows.length}</span></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px"><div class="seg fund-filter" role="group" aria-label="Show">${[["all", "All"], ["in", "Collected"], ["out", "Spent"], ["pending", "Waiting"], ["rejected", "Rejected"]].map(([v, l]) => `<button class="${filt === v ? "on" : ""}" data-action="fd-filter" data-v="${v}">${l}</button>`).join("")}</div>
      <select class="inp" id="fd-who" style="width:auto;padding:7px 10px" aria-label="Person"><option value="">Everyone</option>${fMembers(f).map(m => `<option value="${m.id}" ${who === m.id ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select></div>
    <div class="list money-list">${rows.length ? rows.map(entryRow).join("") : `<p class="muted" style="margin:0">Nothing here yet.${f.status === "active" && (own || mm) ? " Tap “Add entry” to record money collected or spent." : ""}</p>`}</div></div>`;
}

function fundSheet(f) {
  const isNew = !f; f = f || { id: uuid(), name: "", description: "", total_budget: "", currency: CURRENCY || "AED", status: "active" };
  U.sheet = { type: "fund" };
  openSheet(`<h2 id="sheet-title">${isNew ? "New fund" : "Edit fund"}</h2>
  <form data-form="fd-fund" data-id="${f.id}" data-new="${isNew ? 1 : ""}">
    <div class="field"><label for="fd-name">Name</label><input class="inp" id="fd-name" required maxlength="120" value="${esc(f.name)}" placeholder="e.g. Annual staff party, Family Eid trip, Office renovation"></div>
    <div class="field"><label for="fd-desc">Description (optional)</label><textarea class="inp" id="fd-desc" maxlength="500" placeholder="What the money is for">${esc(f.description)}</textarea></div>
    <div class="fgrid"><div class="field"><label for="fd-budget">Total budget</label><input class="inp num" id="fd-budget" inputmode="decimal" value="${f.total_budget === "" ? "" : esc(f.total_budget)}" placeholder="0"></div>
    <div class="field"><label for="fd-cur">Currency</label><input class="inp" id="fd-cur" maxlength="8" value="${esc(f.currency)}"></div></div>
    ${isNew ? `<p class="muted" style="font-size:13px;margin:0 0 10px">You'll be the admin: you add people, set their limits and approve what they add.</p>` : `<div class="field"><span class="lab">Status</span>${picks("fdst", [["active", "Active"], ["closed", "Closed (no new entries)"]], f.status)}</div>`}
    <div class="sheet-actions">${isNew ? "" : `<button type="button" class="btn danger" data-action="fd-delete" data-id="${f.id}">Delete fund</button>`}<button class="btn" type="submit">${isNew ? "Create fund" : "Save"}</button></div>
  </form>`);
}

function personSheet(f, m) {
  const isNew = !m; m = m || { id: uuid(), name: "", user_id: null, limit_amount: null };
  const inFund = new Set(fMembers(f).map(x => x.user_id).filter(Boolean));
  const known = S.db.profiles.filter(p => p.id !== me() && (!inFund.has(p.id) || p.id === m.user_id));
  const isOwnerRow = m.user_id === f.owner_id;
  U.sheet = { type: "fund-person", fund: f.id, linked: m.user_id ? { id: m.user_id, name: m.name } : null };
  openSheet(`<h2 id="sheet-title">${isNew ? "Add person" : esc(m.name)}</h2>
  <form data-form="fd-person" data-id="${m.id}" data-new="${isNew ? 1 : ""}">
    ${isOwnerRow ? "" : `<div class="field"><label for="fp-link">Uses TaskerBay?</label><select class="inp" id="fp-link"><option value="">No, just track them by name</option>${known.map(p => `<option value="${p.id}" ${m.user_id === p.id ? "selected" : ""}>${esc(p.full_name || p.email)}</option>`).join("")}${m.user_id && !known.some(p => p.id === m.user_id) ? `<option value="${m.user_id}" selected>${esc(m.name)} (TaskerBay)</option>` : ""}<option value="email">Someone else, find by email…</option></select></div>
    <div class="field" id="fp-email-f" style="display:none"><label for="fp-email">Their TaskerBay email</label><div style="display:flex;gap:8px"><input class="inp" id="fp-email" type="email" placeholder="name@example.com"><button type="button" class="btn ghost" data-action="fd-find">Find</button></div><small class="muted" id="fp-found"></small></div>`}
    <div class="field"><label for="fp-name">Name</label><input class="inp" id="fp-name" required maxlength="80" value="${esc(m.name)}" placeholder="e.g. Ahmed"></div>
    <div class="field"><label for="fp-limit">Spending limit (${esc(f.currency)}, optional)</label><input class="inp num" id="fp-limit" inputmode="decimal" value="${m.limit_amount == null ? "" : esc(m.limit_amount)}" placeholder="No limit"></div>
    <p class="muted" style="font-size:13px;margin:0 0 10px">${isOwnerRow ? "This is you, the admin." : "People who use TaskerBay can add their own entries; you approve them. For people without the app, you add entries for them."} If their approved spending goes over the limit, they're flagged in red.</p>
    <div class="sheet-actions">${isNew || isOwnerRow ? "" : `<button type="button" class="btn danger" data-action="fd-person-del" data-id="${m.id}">Remove</button>`}<button class="btn" type="submit">${isNew ? "Add person" : "Save"}</button></div>
  </form>`);
}

function fundEntrySheet(f, x) {
  const own = isFundOwner(f), mm = myFundMember(f), isNew = !x;
  x = x || { id: uuid(), kind: "out", amount: "", member_id: own ? (U.fundWho || mm?.id) : mm?.id, title: "", category: "General", date: dkey(), note: "", status: own ? "approved" : "pending" };
  const cats = [...new Set([...F_CATS, ...fEntries(f).map(e => e.category)])];
  U.sheet = { type: "fund-entry", fund: f.id };
  openSheet(`<h2 id="sheet-title">${isNew ? "Add entry" : "Entry"}</h2>
  <form data-form="fd-entry" data-id="${x.id}" data-new="${isNew ? 1 : ""}">
    <div class="field"><span class="lab">Type</span>${picks("fekind", [["out", "💸 Spent"], ["in", "💰 Collected / received"]], x.kind)}</div>
    <div class="fgrid"><div class="field"><label for="fe-amt">Amount (${esc(f.currency)})</label><input class="inp num" id="fe-amt" inputmode="decimal" required value="${esc(x.amount)}" placeholder="0.00" ${isNew ? "autofocus" : ""}></div>
    <div class="field"><label for="fe-date">Date</label><input class="inp" type="date" id="fe-date" value="${x.date}"></div></div>
    <div class="field"><label for="fe-who">Person</label>${own ? `<select class="inp" id="fe-who">${fMembers(f).map(m => `<option value="${m.id}" ${m.id === x.member_id ? "selected" : ""}>${esc(m.name)}${m.user_id === me() ? " (me)" : ""}</option>`).join("")}</select>` : `<input class="inp" disabled value="${esc(mm?.name || "Me")}"><input type="hidden" id="fe-who" value="${mm?.id || ""}">`}</div>
    <div class="field"><label for="fe-title">What for</label><input class="inp" id="fe-title" maxlength="140" value="${esc(x.title)}" placeholder="e.g. Cake from bakery, Contribution from Ali"></div>
    <div class="field"><label for="fe-cat">Category</label><input class="inp" id="fe-cat" list="fe-cats" maxlength="40" value="${esc(x.category)}"><datalist id="fe-cats">${cats.map(c => `<option value="${esc(c)}">`).join("")}</datalist></div>
    <div class="field"><label for="fe-note">Note (optional)</label><input class="inp" id="fe-note" maxlength="300" value="${esc(x.note)}" placeholder="Receipt no., paid by card, etc."></div>
    <p class="muted" id="fe-warn" style="font-size:13px;margin:0 0 10px">${own ? "Entries you add are approved straight away." : "The admin will review this. You can edit or delete it until it's approved."}</p>
    ${!isNew && x.status !== "pending" ? `<p style="margin:0 0 10px">${stChip(x.status)}${x.review_note ? ` <span class="muted">${esc(x.review_note)}</span>` : ""}</p>` : ""}
    <div class="sheet-actions">${isNew ? "" : `<button type="button" class="btn danger" data-action="fd-entry-del" data-id="${x.id}">Delete</button>`}
      ${own && !isNew && x.status === "pending" ? `<button type="button" class="btn ghost" data-action="fd-reject" data-id="${x.id}">Reject</button><button class="btn" type="submit" data-approve="1">Save &amp; approve</button>` : `<button class="btn" type="submit">${isNew ? (own ? "Add" : "Send for approval") : "Save"}</button>`}</div>
  </form>`);
  warnLimit();
}
function warnLimit() {
  const f = fundOf(U.sheet?.fund), w = $("#fe-warn"); if (!f || !w) return;
  const amt = parseFloat(($("#fe-amt")?.value || "").replace(/,/g, "")) || 0, kind = pickVal("fekind"), mid = $("#fe-who")?.value;
  const p = fundStats(f).people.find(q => q.m.id === mid), id = $("#sheet form")?.dataset.id, cur = S.db.fund_entries.find(e => e.id === id);
  const base = p ? p.out - (cur && cur.status === "approved" && cur.kind === "out" ? +cur.amount : 0) : 0;
  if (kind === "out" && p && p.lim != null && base + amt > p.lim) { w.className = "flag"; w.textContent = `⚠️ This takes ${p.m.name} over their limit: ${famt(base + amt)} of ${famt(p.lim)}. It will be flagged.`; }
  else { w.className = "muted"; w.textContent = isFundOwner(f) ? "Entries you add are approved straight away." : "The admin will review this. You can edit or delete it until it's approved."; }
}
function rejectSheet(x) {
  U.sheet = { type: "fund-reject", fund: x.project_id };
  openSheet(`<h2 id="sheet-title">Reject entry</h2><form data-form="fd-reject" data-id="${x.id}">
    <p class="muted" style="margin:-4px 0 12px">${x.kind === "in" ? "Collected" : "Spent"} ${fmoney(fundOf(x.project_id), x.amount)} · ${esc(x.title || x.category)}</p>
    <div class="field"><label for="fr-why">Reason (they'll see this)</label><input class="inp" id="fr-why" maxlength="200" placeholder="e.g. No receipt, not part of this budget" autofocus></div>
    <div class="sheet-actions"><button class="btn danger" type="submit">Reject</button></div></form>`);
}

/* PDF report: built in the browser, nothing is uploaded */
async function fundPdf(f) {
  const { Report } = await import("./pdf.js");
  const st = fundStats(f), cur = f.currency, mName = id => S.db.fund_members.find(m => m.id === id)?.name || "Removed";
  const r = new Report({ title: f.name, subtitle: `Fund report · ${cur} · ${f.status === "closed" ? "Closed · " : ""}Admin: ${fMembers(f).find(m => m.user_id === f.owner_id)?.name || ""} · Generated ${new Date().toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`, footer: `TaskerBay · ${f.name} · Approved entries only unless marked Waiting` });
  if (f.description) r.note(f.description, [70, 80, 92]);
  r.heading("Summary");
  const red = [200, 40, 40], green = [22, 140, 80];
  r.boxes([["Total budget", `${cur} ${famt(st.budget)}`], ["Collected", `${cur} ${famt(st.collected)}`, green], ["Spent", `${cur} ${famt(st.spent)}`, red], ["Cash in hand", `${cur} ${famt(st.hand)}`], ["Budget left", `${cur} ${famt(st.left)}`, st.left < 0 ? red : null], ["Waiting approval", st.pend.length ? `${st.pend.length} · +${famt(st.pendIn)} / -${famt(st.pendOut)}` : "None"]]);
  if (st.overBudget) r.note(`Over budget by ${cur} ${famt(st.spent - st.budget)}.`, red);
  r.heading("People");
  r.table([{ h: "Person", w: .27, bold: true }, { h: "Limit", w: .13, align: "right" }, { h: "Collected", w: .15, align: "right" }, { h: "Spent", w: .15, align: "right" }, { h: "In hand", w: .14, align: "right" }, { h: "Limit left", w: .16, align: "right" }],
    st.people.map(p => [p.m.name + (p.m.user_id === f.owner_id ? " (admin)" : ""), p.lim == null ? "-" : famt(p.lim), famt(p.inn), famt(p.out), famt(p.hand), p.lim == null ? "-" : (p.over ? "OVER " : "") + famt(p.left)]),
    { rowColor: (row, i) => st.people[i]?.over ? red : null, total: ["Total", st.allocated ? famt(st.allocated) : "-", famt(st.collected), famt(st.spent), famt(st.hand), ""] });
  const flagged = st.people.filter(p => p.over);
  if (flagged.length) r.note(`Over their limit: ${flagged.map(p => `${p.m.name} (${famt(p.out)} of ${famt(p.lim)})`).join(", ")}.`, red);
  if (Object.keys(st.byCat).length) {
    r.heading("By category");
    const cats = Object.entries(st.byCat).sort((a, b) => b[1].out - a[1].out);
    r.table([{ h: "Category", w: .5, bold: true }, { h: "Collected", w: .25, align: "right" }, { h: "Spent", w: .25, align: "right" }], cats.map(([c, v]) => [c, v.in ? famt(v.in) : "-", v.out ? famt(v.out) : "-"]), { total: ["Total", famt(st.collected), famt(st.spent)] });
  }
  r.heading("All entries");
  const es = st.es.filter(x => x.status !== "rejected").sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at));
  if (es.length) r.table([{ h: "Date", w: .12 }, { h: "Person", w: .17 }, { h: "Type", w: .11 }, { h: "Category", w: .13 }, { h: "Description", w: .25 }, { h: "Amount", w: .12, align: "right" }, { h: "Status", w: .10 }],
    es.map(x => [parseKey(x.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }), mName(x.member_id), x.kind === "in" ? "Collected" : "Spent", x.category, x.title + (x.note ? ` (${x.note})` : ""), (x.kind === "in" ? "+" : "-") + famt(x.amount), x.status === "approved" ? "Approved" : "Waiting"]),
    { rowColor: (row, i) => es[i].status === "pending" ? [150, 110, 0] : null });
  else r.note("No entries yet.");
  const rej = st.es.filter(x => x.status === "rejected");
  if (rej.length) { r.heading("Rejected (not counted)"); r.table([{ h: "Date", w: .12 }, { h: "Person", w: .18 }, { h: "Description", w: .35 }, { h: "Amount", w: .13, align: "right" }, { h: "Reason", w: .22 }], rej.map(x => [parseKey(x.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }), mName(x.member_id), x.title || x.category, (x.kind === "in" ? "+" : "-") + famt(x.amount), x.review_note || ""])); }
  const blob = r.blob(), name = `${f.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "fund"}-report-${dkey()}.pdf`;
  const file = new File([blob], name, { type: "application/pdf" });
  if (navigator.canShare?.({ files: [file] }) && matchMedia("(pointer:coarse)").matches) { try { await navigator.share({ files: [file], title: `${f.name} report` }); return; } catch (e) { if (e?.name === "AbortError") return; } }
  const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast("PDF report downloaded.");
}

async function fundAction(act, a, id) {
  switch (act) {
    case "free-day": U.freeDay = a.dataset.v; render(); return true;
    case "free-min": FREE.min = +a.dataset.v; saveFree(); render(); return true;
    case "free-book": closeSheet(); setTimeout(() => newTaskSheet({ due_date: a.dataset.d, due_time: a.dataset.t }), 10); return true;
    case "free-share": { const k = U.freeDay || dkey(); await shareText(freeText(a.dataset.v === "week" ? [...Array(7)].map((_, i) => dkey(addDays(new Date(), i))) : [k]), "My free time"); return true; }
    case "fd-new": fundSheet(); return true;
    case "fd-open": U.fundId = id; U.fundFilter = "all"; U.fundWho = ""; history.replaceState(null, "", "#funds"); render(true); scrollTo({ top: 0 }); return true;
    case "fd-back": U.fundId = null; render(true); return true;
    case "fd-edit": fundSheet(fundOf(id)); return true;
    case "fd-filter": U.fundFilter = a.dataset.v; render(); return true;
    case "fd-pdf": { const f = fundOf(id); if (!f) return true; a.disabled = true; try { await fundPdf(f); } catch (e) { toast("Couldn't make the PDF: " + (e.message || e)); } a.disabled = false; return true; }
    case "fd-person": { const f = fundOf(U.fundId); if (f && isFundOwner(f)) personSheet(f, id ? S.db.fund_members.find(m => m.id === id) : null); return true; }
    case "fd-entry": { const f = fundOf(U.fundId); if (!f) return true; const x = id ? S.db.fund_entries.find(e => e.id === id) : null; if (!x && f.status === "closed") { toast("This fund is closed."); return true; } if (!x && !isFundOwner(f) && !myFundMember(f)) return true; fundEntrySheet(f, x); return true; }
    case "fd-approve": { const x = S.db.fund_entries.find(e => e.id === id); if (!x) return true; await update("fund_entries", x, { status: "approved", review_note: "", reviewed_by: me(), reviewed_at: new Date().toISOString() }); buzz(15); toast("Approved."); return true; }
    case "fd-approve-all": { const xs = S.db.fund_entries.filter(e => e.project_id === id && e.status === "pending"); for (const x of xs) await update("fund_entries", x, { status: "approved", review_note: "", reviewed_by: me(), reviewed_at: new Date().toISOString() }); toast(`Approved ${xs.length} entries.`); return true; }
    case "fd-reject": { const x = S.db.fund_entries.find(e => e.id === id); if (x) rejectSheet(x); return true; }
    case "fd-find": {
      const addr = $("#fp-email")?.value.trim(), out = $("#fp-found"); if (!addr) return true;
      try { const r = await api.rpc("fund_find_user", { addr }); const u = Array.isArray(r) ? r[0] : r;
        if (u?.id) { U.sheet.linked = { id: u.id, name: u.full_name }; out.textContent = `✓ Found ${u.full_name}. They'll get a notice when you save.`; if (!$("#fp-name").value.trim()) $("#fp-name").value = u.full_name; }
        else { U.sheet.linked = null; out.textContent = "No approved TaskerBay account uses that email. You can still add them by name only."; } }
      catch (e) { out.textContent = "Couldn't search right now."; }
      return true;
    }
    case "fd-person-del": {
      const m = S.db.fund_members.find(x => x.id === id); if (!m) return true;
      const n = S.db.fund_entries.filter(e => e.member_id === m.id).length;
      if (n && a.dataset.sure !== "1") { a.dataset.sure = "1"; a.textContent = `Remove + delete ${n} entries?`; return true; }
      closeSheet(); await remove("fund_members", m); S.db.fund_entries = S.db.fund_entries.filter(e => e.member_id !== m.id); render(); toast(`${m.name} removed.`); return true;
    }
    case "fd-entry-del": { const x = S.db.fund_entries.find(e => e.id === id); if (!x) return true; if (a.dataset.sure !== "1") { a.dataset.sure = "1"; a.textContent = "Tap again to delete"; return true; } closeSheet(); await remove("fund_entries", x); toast("Entry deleted."); return true; }
    case "fd-delete": {
      const f = fundOf(id); if (!f) return true;
      if (a.dataset.sure !== "1") { a.dataset.sure = "1"; a.textContent = "Delete everything? Tap again"; return true; }
      closeSheet(); U.fundId = null; await remove("fund_projects", f);
      S.db.fund_members = S.db.fund_members.filter(m => m.project_id !== f.id); S.db.fund_entries = S.db.fund_entries.filter(x => x.project_id !== f.id);
      render(true); toast(`“${f.name}” deleted.`); return true;
    }
  }
  return false;
}

async function fundSubmit(kind, f, e) {
  const num = v => { const n = parseFloat(String(v || "").replace(/,/g, "")); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };
  if (kind === "fd-fund") {
    const old = fundOf(f.dataset.id), name = $("#fd-name").value.trim(); if (!name) return;
    const budget = num($("#fd-budget").value) ?? 0; if (budget < 0) { toast("Budget can't be negative."); return; }
    const row = { id: f.dataset.id, name, description: $("#fd-desc").value.trim(), total_budget: budget, currency: ($("#fd-cur").value.trim() || "AED").toUpperCase().slice(0, 8), status: old ? (pickVal("fdst") || old.status) : "active" };
    closeSheet();
    if (old) { await update("fund_projects", old, { ...row, updated_at: new Date().toISOString() }); toast("Saved."); }
    else {
      const now = new Date().toISOString();
      await insert("fund_projects", { ...row, owner_id: me(), created_at: now, updated_at: now });
      if (api.reloadFunds) await api.reloadFunds().catch(() => {}); // the server adds you as the first person
      U.fundId = row.id; render(true); toast("Fund created. Add the people next."); setTimeout(() => personSheet(fundOf(row.id)), 350);
    }
    return;
  }
  if (kind === "fd-person") {
    const fund = fundOf(U.sheet.fund), old = S.db.fund_members.find(m => m.id === f.dataset.id); if (!fund) return;
    const name = $("#fp-name").value.trim(); if (!name) return;
    const lim = $("#fp-limit").value.trim() === "" ? null : num($("#fp-limit").value); if (lim != null && lim < 0) { toast("Limit can't be negative."); return; }
    let user_id = old?.user_id || null; const sel = $("#fp-link");
    if (sel) { if (sel.value === "email") user_id = U.sheet.linked?.id || null; else user_id = sel.value || null; }
    if (user_id && fMembers(fund).some(m => m.user_id === user_id && m.id !== f.dataset.id)) { toast("That person is already in this fund."); return; }
    closeSheet();
    const row = { id: f.dataset.id, project_id: fund.id, user_id, name, limit_amount: lim };
    if (old) await update("fund_members", old, row); else await insert("fund_members", { ...row, created_at: new Date().toISOString() });
    toast(old ? "Saved." : `${name} added${user_id ? ". They'll get a notice." : "."}`);
    return;
  }
  if (kind === "fd-entry") {
    const fund = fundOf(U.sheet.fund); if (!fund) return;
    const amount = num($("#fe-amt").value); if (!(amount > 0)) { $("#fe-amt").focus(); toast("Enter an amount above zero."); return; }
    const own = isFundOwner(fund), old = S.db.fund_entries.find(x => x.id === f.dataset.id), member_id = $("#fe-who").value;
    if (!member_id) { toast("You're not part of this fund."); return; }
    const approve = e?.submitter?.dataset.approve === "1";
    const row = { id: f.dataset.id, project_id: fund.id, member_id, kind: pickVal("fekind") || "out", amount, title: $("#fe-title").value.trim(), category: $("#fe-cat").value.trim() || "General", date: $("#fe-date").value || dkey(), note: $("#fe-note").value.trim() };
    const p = fundStats(fund).people.find(q => q.m.id === member_id), base = p ? p.out - (old && old.status === "approved" && old.kind === "out" ? +old.amount : 0) : 0;
    const over = row.kind === "out" && p && p.lim != null && base + amount > p.lim;
    closeSheet(); buzz(15);
    if (old) await update("fund_entries", old, { ...row, ...(approve ? { status: "approved", review_note: "" } : {}), updated_at: new Date().toISOString() });
    else { const now = new Date().toISOString(); await insert("fund_entries", { ...row, status: own ? "approved" : "pending", review_note: "", created_by: me(), reviewed_by: own ? me() : null, reviewed_at: own ? now : null, created_at: now, updated_at: now }); }
    toast(over ? `⚠️ Saved, but ${p.m.name} is now over their limit (${famt(base + amount)} of ${famt(p.lim)}).` : old ? (approve ? "Saved and approved." : "Saved.") : own ? "Entry added." : "Sent to the admin for approval.");
    return;
  }
  if (kind === "fd-reject") {
    const x = S.db.fund_entries.find(y => y.id === f.dataset.id); if (!x) return;
    closeSheet(); await update("fund_entries", x, { status: "rejected", review_note: $("#fr-why").value.trim(), reviewed_by: me(), reviewed_at: new Date().toISOString() }); toast("Rejected. They'll see your reason.");
  }
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
  <div class="view-h"><div><h1>Money</h1><p>Private to you, even in shared workspaces</p><div style="margin-top:10px">${moneyTabs("money")}</div></div>
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
  <p class="muted mt" style="font-size:13px">Tip: build a workflow for any process you repeat (a monthly report, a client project, a payroll run). Combine it with <b>Repeat: every month</b> and steps, and next month's run is created for you when this one is done.</p>`;
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
    <div class="field"><label for="au-name">Name</label><input class="inp" id="au-name" value="${esc(a.name)}" placeholder="e.g. Ask Sara to review the report" required autofocus></div>
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
  const H = [["routine", "🔁", "Routine", "Daily habits & streaks"], ["money", "💰", "Money", "Spending, budgets & funds"], ["funds", "🤝", "Funds", fundsWaiting() ? `${fundsWaiting()} waiting for you` : "Event & project budgets"], ["approvals", "✅", "Approvals", apprWaiting() ? `${apprWaiting()} waiting for you` : "Ask, approve, keep a record"], ["report", "📈", "Weekly report", "What got done, what slipped · PDF"], ["timeline", "📅", "Timeline", "Tasks laid out by day, with dependencies"], ["focus", "⏱", "Focus", "25-minute sessions"], ["team", "👥", "Team & updates", "People, invites, feed"], ["chat", "💬", "Team chat", isTeam() ? (chatUnreadAll() ? `${chatUnreadAll()} unread` : "Talk with your workspace") : "For shared workspaces"], ["workflows", "🔀", "Workflows", "Stages tasks move through"], ["automations", "⚡", "Automations", "Rules that run themselves"], ["inbox", "🔔", "Inbox", `${unread()} unread`], ["activity", "🧾", "Activity log", "Who changed what, and when"], ["settings", "⚙️", "Settings", "Profile, theme, install"], ...(U.isAdmin ? [["admin", "🛡️", "Admin", "Users, sign-ins, trials"]] : [])];
  return `<div class="view-h"><div><h1>More</h1><p>Everything else in TaskerBay</p></div></div><div class="hub">${H.map(([k, i, l, s]) => `<button data-go="${k}"><span class="ic">${i}</span><b>${l}</b><small>${s}</small></button>`).join("")}</div>`;
}
function vSettings() {
  const p = profile(me()) || {};
  return `<div class="view-h"><div><h1>Settings</h1><p>${esc(S.user?.email || "")}</p></div></div>
  <div class="grid g-2">
    <div class="card"><div class="card-h"><h2>Profile</h2></div>
      <form data-form="profile"><div class="field"><label for="pf-name">Your name</label><input class="inp" id="pf-name" value="${esc(p.full_name || "")}"></div><button class="btn" type="submit">Save</button></form></div>
    ${accessCard()}
    ${calendarCard()}
    ${regionCard()}
    ${escCard()}
    ${digestCard()}
    ${packsCard()}
    ${mfaCard()}
    ${pushCard()}
    ${backupCard()}
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
  <button data-action="auto-new"><span class="ic g">${I.bolt}</span><b>Automation</b><small>A rule that runs itself</small></button>
  <button data-action="bulk-import"><span class="ic">📄</span><b>From Excel / list</b><small>Import a file or paste many</small></button>
  <button data-action="tpl-open"><span class="ic g">📋</span><b>From a template</b><small>Projects, trips, events, bills…</small></button></div>
  ${AI_ON ? `<button class="ai-btn" data-action="capture" style="width:100%;justify-content:center;padding:14px;margin-top:4px"><span class="spark">✨</span>Just say it, Claude sorts it out</button>` : ""}`);
}
/* ================= Bulk add: paste many lines, each becomes a task ================= */
const WORK_RX = /\b(payroll|payslips?|salar(y|ies)|wps|hr|invoices?|clients?|meetings?|reports?|visa|labou?r|mohre|employees?|staff|leaves?|gratuity|offer letters?|contracts?|audit|vat|finance|office|manager|boss|team|project|onboarding|recruit\w*|interview\w*|attendance|overtime|eosb|insur\w*|emirates id|approval|fines?|signatures?|d?docs?|documents?|process\w*|procee+d\w*|check with|follow up with|medical|passport|resignation|termination|settlement|allowances?|deductions?|bonus|appraisal)\b/i;
const URGENT_RX = /\b(urgent|asap|immediately|important|critical|today itself)\b/i;
function nextWorkday(from = new Date()) { let d = addDays(from, 1); while (!E.isWorkday(d)) d = addDays(d, 1); return dkey(d); } // the person's own working week and holidays
function splitBulk(text) {
  let lines = text.replace(/\r/g, "").split(/\n+/);
  if (lines.filter(l => l.trim()).length === 1) { const one = lines.join(" "); lines = one.includes(";") ? one.split(";") : one.split(/(?<=[.!?])\s+(?=[A-Z0-9])/); }
  return lines.map(l => l.replace(/^\s*(?:[-–—•*▪◦·>]+|\d+[.)\]]|\[\s?[xX ]?\s?\]|☐|☑|✅|✔️?)\s*/, "").replace(/\s+/g, " ").trim()).filter(l => l.length > 1);
}
function bulkParse(text) {
  const def = U.bulk.def;
  const rows = splitBulk(text).map(original => { const sp = U.bulk.fixSpell === false ? { text: original, changes: [] } : SP.fix(original); const line = sp.text; const spell = sp.changes;
    const it = U.bulk.allowUpdates ? parseIntent(line) : null;
    if (it) return { on: true, kind: "update", line, spell, task: it.task, stage: it.stage, note: it.note, due_date: it.due_date ?? it.task.due_date, due_time: it.due_time ?? (it.task.due_time ? fmtTime(it.task.due_time) : "") };
    const q = parseQuick(line.replace(/^\+\s*/, ""));
    const explicitDate = !!q.due_date, explicitTime = !!q.due_time;
    return {
      on: true, kind: "new", line, spell, title: q.title || line, estimate_min: q.estimate_min || null,
      area: /#(w|work|p|personal|proj)/i.test(line) ? q.area : WORK_RX.test(line) ? "Work" : (isTeam() ? "Work" : "Personal"),
      priority: /![hml123]/i.test(line) ? q.priority : URGENT_RX.test(line) ? "High" : q.priority,
      due_date: explicitDate ? q.due_date : def.date, due_time: explicitTime ? q.due_time : def.time,
      auto: !explicitDate || !explicitTime, assignee_id: q.assignee_id, repeat: q.repeat, starred: q.starred,
      guessed: !/#(w|work|p|personal|proj)/i.test(line) && !WORK_RX.test(line)
    };
  }).map(r => r.kind === "new" ? { ...r, title: r.title.charAt(0).toUpperCase() + r.title.slice(1) } : r);
  // a list that is mostly work items is treated as all work (and the same for personal)
  const news = rows.filter(r => r.kind === "new"), work = news.filter(r => !r.guessed && r.area === "Work").length;
  if (news.length > 2 && work >= news.length / 2) news.forEach(r => { if (r.guessed) r.area = "Work"; });
  return rows;
}

/* ================= Import tasks from an Excel / CSV file (read on the device, never uploaded) ================= */
const COLS = {
  title: /^(tasks?|title|subject|descriptions?|activit(y|ies)|items?|actions?( items?)?|to ?dos?|work|particulars|issues?|requirements?|what|task name|task details|job)$|task|description|activity|action item|particular/i,
  date: /^(due|dates?|deadlines?|target|by when|due on|when|day)$|due ?date|deadline|target date|end date|follow ?up date|reminder date|due by|completion date|date/i,
  time: /^(time|hours?|at|due time|reminder time|start time)$|time/i,
  priority: /priority|urgen|importance|severity/i,
  area: /^(area|category|type|department|dept|section|group)$/i,
  owner: /^(owner|assigned( to)?|assignee|responsible( person)?|pic|done by|handled by|action by|person in charge)$/i,
  who: /^(employee|employee name|staff|staff name|name|candidate|client|customer|person|emp|emp name|full name|vendor|company)$/i,
  status: /^(status|progress|state|current status|done\??|completed\??)$/i,
  notes: /notes?|remarks?|comments?|details|update|info|description of work/i,
};
const DONE_CELL = /^(done|completed?|closed|finished|resolved|yes|✓|✔|complete)$/i;
const cellText = c => c == null ? "" : c.t === "bool" ? (c.v ? "Yes" : "No") : c.t === "num" ? String(Math.round(c.v * 1e6) / 1e6) : String(c.v);
function guessHeader(rows) {
  const letters = n => { let s = ""; n++; while (n) { s = String.fromCharCode(65 + (n - 1) % 26) + s; n = Math.floor((n - 1) / 26); } return s; };
  const filled = rows.map((r, i) => [i, r]).filter(([, r]) => r && r.some(c => c && cellText(c).trim()));
  if (!filled.length) return { headerRow: -1, headers: [] };
  const width = Math.max(...filled.slice(0, 60).map(([, r]) => r.length), 0);
  // the header is the row (near the top) with the most cells that look like column names; titles above it are skipped
  let best = null;
  for (const [i, r] of filled.slice(0, 20)) {
    const cells = r.filter(Boolean); if (cells.length < 2 && width > 1) continue;
    if (!cells.every(c => c.t === "text")) continue;
    const score = cells.filter(c => Object.values(COLS).some(rx => rx.test(cellText(c).trim()))).length;
    if (score && (!best || score > best.score)) best = { i, score };
  }
  if (!best) { // no recognised names: treat the first row as names only if it's all text and the rows below are not
    const [i, r] = filled.find(([, r]) => r.filter(Boolean).length >= Math.min(2, width)) || filled[0];
    const below = filled.filter(([k]) => k > i).slice(0, 10);
    if (r.every(c => !c || c.t === "text") && below.some(([, x]) => x.some(c => c && c.t !== "text"))) best = { i };
  }
  if (!best) return { headerRow: filled[0][0] - 1, headers: [...Array(width)].map((_, k) => `Column ${letters(k)}`) };
  const r = rows[best.i];
  return { headerRow: best.i, headers: [...Array(width)].map((_, k) => r[k] && cellText(r[k]).trim() ? cellText(r[k]).trim() : `Column ${letters(k)}`) };
}
function guessMap(headers, body) {
  const used = new Set(), pick = (key, test) => { const k = headers.findIndex((h, i) => !used.has(i) && test(h, i)); if (k >= 0) used.add(k); return k; };
  const kindOf = i => { const cs = body.map(r => r[i]).filter(Boolean).slice(0, 40); const cnt = t => cs.filter(c => c.t === t).length; return { n: cs.length, date: cnt("date") + cnt("datetime"), time: cnt("time"), text: cnt("text"), avg: cs.filter(c => c.t === "text").reduce((s, c) => s + cellText(c).length, 0) / Math.max(1, cnt("text")) }; };
  const m = {};
  m.title = pick("title", h => COLS.title.test(h) && !COLS.date.test(h));
  m.date = pick("date", (h, i) => COLS.date.test(h) && !/time/i.test(h)); if (m.date < 0) m.date = pick("date", (h, i) => { const k = kindOf(i); return k.n && (k.date) / k.n > .6; });
  m.time = pick("time", (h, i) => COLS.time.test(h) || (kindOf(i).n && kindOf(i).time / kindOf(i).n > .6));
  m.priority = pick("priority", h => COLS.priority.test(h));
  m.area = pick("area", h => COLS.area.test(h));
  m.owner = pick("owner", h => COLS.owner.test(h));
  m.who = pick("who", h => COLS.who.test(h));
  m.status = pick("status", h => COLS.status.test(h));
  m.notes = pick("notes", h => COLS.notes.test(h));
  if (m.title < 0) { // no "Task" column: use the column with the longest text
    let best = -1, bl = 0; headers.forEach((h, i) => { if (used.has(i)) return; const k = kindOf(i); if (k.text && k.avg > bl) { bl = k.avg; best = i; } });
    if (best >= 0) { m.title = best; used.add(best); } else if (m.who >= 0) { m.title = m.who; m.who = -1; }
  }
  return m;
}
function fileRows() {
  const F = U.bulk.file, def = U.bulk.def, sh = F.sheets[F.sheet], m = F.map;
  const body = sh.rows.slice(F.headerRow + 1);
  const open = new Set(S.db.tasks.filter(t => !E.isDone(t)).map(t => t.title.trim().toLowerCase()));
  const person = name => { const n = String(name || "").trim().toLowerCase(); if (!n) return null; return S.db.profiles.find(p => { const f = (p.full_name || "").toLowerCase(); return f && (f === n || f.split(" ")[0] === n.split(" ")[0]); }) || null; };
  const out = [];
  for (const r of body) {
    if (!r || !r.some(c => c && cellText(c).trim())) continue;
    const get = i => i >= 0 ? r[i] : null, txt = i => cellText(get(i)).replace(/\s+/g, " ").trim();
    let title = txt(m.title); const who = txt(m.who);
    if (!title && !who) continue;
    if (who && title && !title.toLowerCase().includes(who.toLowerCase())) title = `${who} – ${title}`; else if (!title) title = who;
    if (U.bulk.fixSpell !== false) title = SP.fix(title).text;
    // date and time from their cells (real Excel dates, or text such as "25/11", "tomorrow 3pm")
    let due_date = "", due_time = "";
    const dc = get(m.date), tc = get(m.time);
    if (dc) { if (dc.t === "date") due_date = dc.v; else if (dc.t === "datetime") { due_date = dc.v.slice(0, 10); due_time = dc.v.slice(11, 16); } else if (dc.t === "text") { const q = parseQuick(cellText(dc)); due_date = q.due_date || ""; due_time = q.due_time || due_time; } }
    if (tc) { if (tc.t === "time") due_time = tc.v; else if (tc.t === "datetime") due_time = tc.v.slice(11, 16); else if (tc.t === "num" && tc.v >= 0 && tc.v < 1) { const mins = Math.round(tc.v * 1440); due_time = `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`; } else { const q = parseQuick("at " + cellText(tc)); due_time = q.due_time || due_time; } }
    const q = parseQuick(title); // a date written inside the task text itself
    if (!due_date && q.due_date) { due_date = q.due_date; if (!due_time && q.due_time) due_time = q.due_time; title = q.title || title; }
    const pr = txt(m.priority).toLowerCase(), ar = txt(m.area), notesTxt = txt(m.notes), stTxt = txt(m.status), ow = txt(m.owner), op = person(ow);
    const priority = /high|urgent|critical|^1$|^h$|top|asap/.test(pr) ? "High" : /low|^3$|^l$|minor/.test(pr) ? "Low" : URGENT_RX.test(title) ? "High" : "Medium";
    const area = AREAS.find(a => a.toLowerCase() === ar.toLowerCase()) || (/work|office|hr|payroll|admin|finance/i.test(ar) ? "Work" : /personal|home|family/i.test(ar) ? "Personal" : WORK_RX.test(title) || isTeam() ? "Work" : "Personal");
    const doneInFile = DONE_CELL.test(stTxt) || (m.status < 0 && DONE_CELL.test(notesTxt));
    const exists = open.has(title.trim().toLowerCase());
    const extra = [notesTxt && !DONE_CELL.test(notesTxt) ? notesTxt : "", stTxt && !doneInFile && !/^(open|new|pending|not started|to ?do|-)$/i.test(stTxt) ? `Status: ${stTxt}` : "", ow && !op ? `Owner: ${ow}` : ""].filter(Boolean).join("\n");
    out.push({ on: !doneInFile && !exists, kind: "new", line: title, spell: [], title: title.charAt(0).toUpperCase() + title.slice(1), area, priority,
      due_date: due_date || def.date, due_time: due_time || def.time, auto: !due_date || !due_time, assignee_id: op?.id || null, notes: extra,
      flag: doneInFile ? "Done in file" : exists ? "Already in TaskerBay" : "" });
    if (out.length >= 500) break;
  }
  return out;
}
async function bulkFile(file) {
  const host = $("#bk-file-info"); if (host) host.innerHTML = `<p class="muted" style="margin:6px 0">Reading ${esc(file.name)}…</p>`;
  try {
    const { readSheetFile } = await import("./sheetread.js");
    const { sheets } = await readSheetFile(file);
    const usable = sheets.filter(s => s.rows.some(r => r && r.some(Boolean)));
    if (!usable.length) throw new Error("No data found in that file.");
    const sheet = 0, g = guessHeader(usable[0].rows);
    U.bulk.file = { name: file.name, sheets: usable, sheet, headerRow: g.headerRow, headers: g.headers };
    U.bulk.file.map = guessMap(g.headers, usable[0].rows.slice(g.headerRow + 1));
    if (U.bulk.file.map.title < 0) throw new Error("Couldn't find a column with task text in that file.");
    U.bulk.allowUpdates = false;
    bulkFilePanel(); bulkRefresh(true);
  } catch (e) { U.bulk.file = null; if (host) host.innerHTML = `<p class="flag" style="margin:6px 0">${esc(e.message || "Couldn't read that file.")}</p>`; }
}
function bulkFilePanel() {
  const F = U.bulk.file, host = $("#bk-file-info"); if (!host) return;
  $("#bk-text-f")?.classList.toggle("hidden", !!F); $("#bk-upd-l")?.classList.toggle("hidden", !!F);
  if (!F) { host.innerHTML = ""; return; }
  const opts = sel => `<option value="-1">—</option>` + F.headers.map((h, i) => `<option value="${i}" ${sel === i ? "selected" : ""}>${esc(h)}</option>`).join("");
  const f = (key, label) => `<label class="bk-map"><span>${label}</span><select class="inp" data-bkmap="${key}">${opts(F.map[key])}</select></label>`;
  host.innerHTML = `<div class="bk-file"><div class="bk-file-h"><b>📄 ${esc(F.name)}</b><button type="button" class="link" data-action="bk-file-clear">Use pasted text instead</button></div>
    ${F.sheets.length > 1 ? `<label class="bk-map"><span>Sheet</span><select class="inp" id="bk-sheet">${F.sheets.map((s, i) => `<option value="${i}" ${i === F.sheet ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>` : ""}
    <details class="bk-cols"><summary>Columns: ${["title", "who", "date", "time", "priority", "notes"].filter(k => F.map[k] >= 0).map(k => esc(F.headers[F.map[k]])).join(", ") || "none found"} · <u>change</u></summary>
    <p class="muted" style="margin:6px 0 8px;font-size:12.5px">Pick which column is which. Rows below update straight away.</p>
    <div class="bk-maps">${f("title", "Task")}${f("who", "Add name from")}${f("date", "Due date")}${f("time", "Time")}${f("priority", "Priority")}${f("area", "Area")}${f("owner", "Assigned to")}${f("status", "Status")}${f("notes", "Notes")}</div>
    <label class="bk-chk" style="margin-top:6px"><input type="checkbox" id="bk-hdr" ${F.headers.some(h => !/^Column [A-Z]+$/.test(h)) ? "checked" : ""}> First row is column names</label></details></div>`;
}
function bulkSheet(prefill = "") {
  U.bulk = { def: { date: nextWorkday(), time: "09:00" }, rows: [], allowUpdates: true };
  U.sheet = { type: "bulk" };
  openSheet(`<h2 id="sheet-title">Bulk add</h2>
    <p class="muted" style="margin:-4px 0 12px;font-size:13.5px">Paste a list (one task per line) or import an Excel / CSV file. Dates and times are picked up; rows without a date get the default reminder below, and you can change any row before saving.</p>
    <div class="bk-import"><label class="btn ghost" for="bk-file">📄 Import Excel / CSV file</label><input type="file" id="bk-file" accept=".xlsx,.xlsm,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden><span class="muted">Read on your device, never uploaded</span></div>
    <div id="bk-file-info"></div>
    <div class="field" id="bk-text-f"><label for="bk-text">Your list</label><textarea class="inp" id="bk-text" rows="6" placeholder="Send monthly report by 28/11\nCall bank about loan settlement tomorrow 11am\nRenew Emirates ID - urgent\nBook car service sat">${esc(prefill)}</textarea></div>
    <div class="bk-def"><span class="lab">Default reminder for lines without a date</span>
      <div class="bk-def-row"><input class="inp" type="date" id="bk-date" value="${U.bulk.def.date}" aria-label="Default date"><input class="inp" type="time" id="bk-time" value="${U.bulk.def.time}" aria-label="Default time">${remindSelect("bk-rem", 0, 'aria-label="Reminder for all"')}<button type="button" class="pick" data-action="bk-def" data-v="next">Next working day 9 AM</button></div>
      <label class="bk-chk" id="bk-upd-l"><input type="checkbox" id="bk-upd" checked> Lines about existing tasks update them (e.g. “report done”)</label>
      <label class="bk-chk"><input type="checkbox" id="bk-spell" checked> Fix spelling mistakes (names are never changed)</label></div>
    <div id="bk-preview"></div>
    <div class="sheet-actions"><button class="btn ghost" data-action="close-sheet">Cancel</button><button class="btn" data-action="bk-save" id="bk-save" disabled>Add tasks</button></div>`, "tall wide");
  bulkRefresh(true);
}
function bulkRefresh(reparse) {
  if (!U.bulk) return;
  if (reparse) U.bulk.rows = U.bulk.file ? fileRows() : bulkParse($("#bk-text")?.value || "");
  const rows = U.bulk.rows, host = $("#bk-preview"); if (!host) return;
  const n = rows.filter(r => r.on && r.kind === "new").length, u = rows.filter(r => r.on && r.kind === "update").length;
  host.innerHTML = rows.length ? `<div class="bk-head"><b>${rows.length} ${U.bulk.file ? "row" : "line"}${rows.length > 1 ? "s" : ""} found</b><span>${n} new${u ? ` · ${u} update${u > 1 ? "s" : ""}` : ""}</span></div>
    <div class="bk-list">${rows.map((r, i) => r.kind === "update" ? `
      <div class="bk-row upd ${r.on ? "" : "off"}"><label class="bk-on"><input type="checkbox" data-bk="on" data-i="${i}" ${r.on ? "checked" : ""} aria-label="Include"></label>
        <div class="bk-main"><span class="bk-tag">Update</span><b>${esc(r.task.title)}</b><small>${r.stage ? `→ ${esc(E.stagesOf(r.task).find(s => s.key === r.stage)?.name || "")} ` : ""}${r.note ? `· 💬 ${esc(r.note)}` : ""}</small></div>
        <div class="bk-when"><input class="inp" type="date" data-bk="due_date" data-i="${i}" value="${r.due_date || ""}" aria-label="Date"><input class="inp" type="time" data-bk="due_time" data-i="${i}" value="${r.due_time || ""}" aria-label="Time"></div></div>` : `
      <div class="bk-row ${r.on ? "" : "off"}"><label class="bk-on"><input type="checkbox" data-bk="on" data-i="${i}" ${r.on ? "checked" : ""} aria-label="Include"></label>
        <div class="bk-main"><input class="inp bk-title" data-bk="title" data-i="${i}" value="${esc(r.title)}" aria-label="Task title">
          <div class="bk-meta"><select class="inp" data-bk="area" data-i="${i}" aria-label="Area">${AREAS.map(a => `<option ${r.area === a ? "selected" : ""}>${a}</option>`).join("")}</select><select class="inp" data-bk="priority" data-i="${i}" aria-label="Priority">${["High", "Medium", "Low"].map(p => `<option ${r.priority === p ? "selected" : ""}>${p}</option>`).join("")}</select>${r.auto ? `<span class="bk-auto" title="Uses the default reminder">auto</span>` : ""}${r.flag ? `<span class="bk-auto warn">${esc(r.flag)}</span>` : ""}${r.notes ? `<span class="bk-note" title="${esc(r.notes)}">📝 ${esc(r.notes.split("\n")[0].slice(0, 40))}</span>` : ""}${spellNote(r.spell || [])}</div></div>
        <div class="bk-when"><input class="inp" type="date" data-bk="due_date" data-i="${i}" value="${r.due_date || ""}" aria-label="Date"><input class="inp" type="time" data-bk="due_time" data-i="${i}" value="${r.due_time || ""}" aria-label="Time"></div></div>`).join("")}</div>` : `<p class="muted" style="font-size:13px;margin:8px 2px">Your tasks will appear here as you paste or type.</p>`;
  const b = $("#bk-save"); if (b) { b.disabled = !(n + u); b.textContent = n + u ? `Add ${n ? `${n} task${n > 1 ? "s" : ""}` : ""}${n && u ? " & " : ""}${u ? `${u} update${u > 1 ? "s" : ""}` : ""}` : "Add tasks"; }
}
async function bulkSave() {
  const rows = U.bulk.rows.filter(r => r.on); if (!rows.length) return;
  const b = $("#bk-save"); if (b) { b.disabled = true; b.textContent = "Adding…"; }
  let added = 0, updated = 0;
  for (const r of rows) {
    try {
      if (r.kind === "update") { if (await E.statusUpdate(r.task, { note: r.note, due_date: r.due_date || null, due_time: r.due_time || null, stage: r.stage })) updated++; }
      else { await E.createTask({ title: r.title.trim() || r.line, remind_before: parseInt($("#bk-rem")?.value ?? "0", 10), area: r.area, priority: r.priority, due_date: r.due_date || null, due_time: r.due_time || null, assignee_id: r.assignee_id || me(), repeat: r.repeat || "", starred: !!r.starred, estimate_min: r.estimate_min || null, ...(r.notes ? { notes: r.notes } : {}) }); added++; }
    } catch (e) { console.error(e); }
  }
  closeSheet(); U.bulk = null; buzz(20);
  toast(`${added ? `Added ${added} task${added > 1 ? "s" : ""}` : ""}${added && updated ? " · " : ""}${updated ? `updated ${updated}` : ""}.`);
  if (U.view !== "tasks" && U.view !== "today") go("tasks");
}

const REMIND_OPTS = [[0, "At the due time"], [5, "5 min before + at time"], [15, "15 min before + at time"], [30, "30 min before + at time"], [60, "1 hour before + at time"], [120, "2 hours before + at time"], [1440, "1 day before + at time"], [-1, "No reminder"]];
const remindSelect = (id, val, attrs = "") => `<select class="inp" id="${id}" ${attrs}>${REMIND_OPTS.map(([v, l]) => `<option value="${v}" ${(val ?? 0) === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
function newTaskSheet(preset = {}) {
  U.sheet = { type: "newtask", preset };
  const tk = dkey(), tm = dkey(addDays(new Date(), 1));
  openSheet(`<h2 id="sheet-title">New task</h2>
  <form data-form="newtask">
    <div class="field"><label for="nt-title">Task</label><input class="inp" id="nt-title" required autofocus placeholder="What needs doing? Try: Review proposal fri 3pm !high"></div>
    <div class="field"><span class="lab">Due</span><div class="picks" data-quickdue><button type="button" class="pick ${preset.due_date === tk ? "on" : ""}" data-v="${tk}">Today</button><button type="button" class="pick ${preset.due_date === tm ? "on" : ""}" data-v="${tm}">Tomorrow</button><button type="button" class="pick ${!preset.due_date ? "on" : ""}" data-v="">No date</button></div><input class="inp" type="date" id="nt-due" value="${preset.due_date || ""}" aria-label="Due date" style="margin-top:6px"></div>
    <div class="fgrid" style="margin:0 0 4px"><div class="field"><label for="nt-time">Time (optional)</label><input class="inp" type="time" id="nt-time" value="${preset.due_time || ""}"></div><div class="field"><label for="nt-rem">Reminder</label>${remindSelect("nt-rem", 0)}</div></div>
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
  <div class="field"><label for="cap-text" class="sr">What's on your mind</label><textarea class="inp" id="cap-text" style="min-height:120px" autofocus placeholder="e.g. Paid 45 for a taxi. The proposal needs sign-off from Sara by Thursday, urgent: check numbers, send summary, book the venue. Call the bank about the loan tomorrow."></textarea>
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
  openSheet(`<h2 id="sheet-title">${edit ? "Rename workspace" : "New workspace"}</h2>${edit ? "" : `<p class="muted" style="margin:-6px 0 12px;font-size:13.5px">A separate space with its own tasks, workflows and members, e.g. "Family" or "Sales team".</p>`}
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
    if (U.sheet?.type === "fund-entry") warnLimit();
    return;
  }
  const dayBtn = e.target.closest("#sheet .daysel button"); if (dayBtn) { dayBtn.classList.toggle("on"); return; }
  const a = e.target.closest("[data-action]"); if (!a) return;
  const id = a.dataset.id, act = a.dataset.action, t = id ? task(id) : null;
  if ((act.startsWith("fd-") || act.startsWith("free-")) && await fundAction(act, a, id)) return;
  if (act.startsWith("cal-")) { await calendarAction(act, a); return; }
  if (act.startsWith("dg-")) { await digestAction(act, a); return; }
  if (act === "voice") { voiceStart(a); return; }
  if (act.startsWith("rg-")) { try { await regionAction(act, a); } catch (e) { toast(e.message); } return; }
  if (act.startsWith("mfa-")) { await mfaAction(act, a); return; }
  if (act.startsWith("ap-")) { await apAction(act, a); return; }
  if (act === "nudge") { a.disabled = true; try { const r = await api.mail("nudge", a.dataset.id); toast(r?.sent ? `Reminder emailed to ${r.email}.` : "They can't be emailed right now."); } catch (e) { toast(e.message); } a.disabled = false; return; }
  if (act === "rep-off") { U.repOff = +a.dataset.v; render(); return; }
  if (act === "dep-del") { const t = task(a.dataset.id); if (t) await depSet(t, (t.blocked_by || []).filter(x => x !== a.dataset.v)); return; }
  if (act === "tm-start") { try { await tmStart(a.dataset.id); } catch (e) { toast(e.message); } return; }
  if (act === "tm-stop") { try { await tmStop(); } catch (e) { toast(e.message); } return; }
  if (act === "tm-del") { const e0 = (S.db.time_entries || []).find(x => x.id === a.dataset.v); if (e0) { try { await remove("time_entries", e0); } catch (e) { toast(e.message); } } return; }
  if (act === "tl-span") { U.tlSpan = +a.dataset.v; render(); return; }
  if (act === "plan-week") { planSheet(); return; }
  if (act === "esc-toggle" || act === "esc-del") { const r = (S.db.escalation_rules || []).find(x => x.id === a.dataset.id); if (!r) return; try { act === "esc-del" ? await remove("escalation_rules", r) : await update("escalation_rules", r, { active: !r.active }); } catch (e) { toast(e.message); } render(); return; }
  if (act === "rep-pdf") { a.disabled = true; try { await reportPdf(); } catch (e) { toast("Couldn't make the PDF: " + (e.message || e)); } a.disabled = false; return; }
  if (act === "act-kind") { U.actKind = a.dataset.v; render(); return; }
  if (act === "act-more") { a.disabled = true; try { await actMore(); } catch (e) { toast(e.message); a.disabled = false; } return; }
  if (act === "adm-refresh") { U.adm = undefined; render(); return; }
  if (act === "tpl-open") { closeSheet(); setTimeout(() => templateSheet(), 10); return; }
  if (act === "tpl-pick") { templateSheet(a.dataset.k); return; }
  if (act === "tpl-save") { await tplSave(a.dataset.id); return; }
  if (act === "tpl-del") { const r = (S.db.task_templates || []).find(x => x.id === a.dataset.id); if (r) { await remove("task_templates", r); toast("Template deleted."); templateSheet(); } return; }
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
      const an = analyzeUpdate(tt, $("#upd-text").value);
      const note = an.note, d = $("#upd-date").value || null, tm = $("#upd-time").value || null, st = $("#upd-stage").value, rem = parseInt($("#upd-rem")?.value ?? "0", 10);
      for (const s0 of an.doneSteps) { const cur = task(s0.id); if (cur && !E.isDone(cur)) await E.completeTask(cur); }
      if (an.next) {
        if (an.next.step) { const cur = task(an.next.step.id); if (cur) await E.changeTask(cur, { due_date: d, due_time: tm, remind_before: -1, starred: true }); }
        else await E.createTask({ title: an.next.title, parent_id: tt.id, area: tt.area, assignee_id: tt.assignee_id, due_date: d, due_time: tm, remind_before: -1, workflow_id: tt.workflow_id }, 1);
      }
      if ((tt.remind_before ?? 0) !== rem) await E.changeTask(task(tt.id), { remind_before: rem });
      const res = await E.statusUpdate(task(tt.id), { note, due_date: d, due_time: tm, stage: E.isDone(task(tt.id)) ? undefined : st });
      if (!res && !an.doneSteps.length && !an.next) { toast("Type a status or change the date, time or stage first."); break; }
      $("#upd-text").value = ""; ["upd-date", "upd-time"].forEach(id => { const n = $("#" + id); if (n) { n.defaultValue = n.value; delete n.dataset.manual; } });
      const fin = task(tt.id) || res; buzz(10);
      toast([an.doneSteps.length ? `✓ ${an.doneSteps.length} step${an.doneSteps.length > 1 ? "s" : ""} done` : "", an.next ? `next: ${an.next.step ? an.next.step.title : an.next.title}` : "", fin?.due_date ? `🔔 ${dueLabel(fin)}` : ""].filter(Boolean).join(" · ") || "Update saved."); break;
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
    case "notif": { const n = S.db.notifications.find(x => x.id === id); if (n && !n.read) update("notifications", n, { read: true }); if (n?.workspace_id && n.workspace_id !== S.wsId) await switchWs(n.workspace_id); if (n?.task_id && task(n.task_id)) openTask(n.task_id); else if (/^New sign-up request/.test(n?.body || "")) go("settings"); else if (/^💬/.test(n?.body || "")) go("chat"); else if (/^💰/.test(n?.body || "")) { U.fundId = null; go("funds"); } else if (/^📝/.test(n?.body || "")) go("approvals"); break; }
    case "read-all": for (const n of S.db.notifications.filter(n => !n.read)) update("notifications", n, { read: true }); break;
    case "palette": openPalette(); break;
    case "theme": cycleTheme(); render(); break;
    case "set-theme": theme = a.dataset.v; applyTheme(theme); try { localStorage.setItem("tb.theme", theme); } catch (e) {} render(); break;
    case "install": deferredInstall?.prompt(); break;
    case "export": { const data = JSON.stringify({ exported: new Date().toISOString(), workspace: ws(), ...S.db }, null, 2); navigator.clipboard?.writeText(data).then(() => toast("All your data is copied as JSON."), () => toast("Couldn't copy here.")); break; }
    case "demo-reset": localStorage.removeItem("taskerbay.demo.v1"); location.reload(); break;
    case "demo-fresh": { const ok = U.confirmFresh === true; if (!ok) { U.confirmFresh = true; toast("Tap again to erase everything on this device and start fresh."); setTimeout(() => U.confirmFresh = false, 4000); break; } await api.startFresh(profile(me())?.full_name !== "You" ? profile(me())?.full_name : "", true); break; }
    case "sign-out": { try { const reg = await navigator.serviceWorker?.ready; const sub = await reg?.pushManager?.getSubscription(); if (sub) { await api.removePush(sub.endpoint); await sub.unsubscribe(); } } catch (e) {} await api.signOut(); break; }
    case "chat-del": { const m = S.db.chat_messages.find(x => x.id === id); if (m && m.author_id === me()) { if (U.confirmDel !== id) { U.confirmDel = id; toast("Tap ✕ again to delete this message."); setTimeout(() => { if (U.confirmDel === id) U.confirmDel = null; }, 3000); break; } U.confirmDel = null; await remove("chat_messages", m); } break; }
    case "bulk": bulkSheet(); setTimeout(() => $("#bk-text")?.focus(), 60); break;
    case "bk-save": await bulkSave(); break;
    case "bulk-import": { closeSheet(); setTimeout(() => bulkSheet(), 10); break; }
    case "bk-file-clear": { U.bulk.file = null; U.bulk.allowUpdates = !!$("#bk-upd")?.checked; const fi = $("#bk-file"); if (fi) fi.value = ""; bulkFilePanel(); bulkRefresh(true); break; }
    case "bk-def": { U.bulk.def = { date: nextWorkday(), time: "09:00" }; $("#bk-date").value = U.bulk.def.date; $("#bk-time").value = U.bulk.def.time; bulkRefresh(true); break; }
    case "backup-dl": case "backup-now": {
      a.disabled = true; const label = a.textContent; a.textContent = "Preparing…";
      try { const { blob, name } = await api.downloadBackup(act === "backup-now"); const url = URL.createObjectURL(blob); const l = document.createElement("a"); l.href = url; l.download = name; document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000); toast(`Downloaded ${name}. Keep it somewhere private.`); }
      catch (e) { toast(e.message); }
      a.disabled = false; a.textContent = label; break;
    }
    case "old-done": { a.disabled = true; a.textContent = "Loading…"; try { const n = await api.loadOldDone(S.wsId); U.oldDone = S.wsId; toast(n ? `Loaded ${n} older finished task${n > 1 ? "s" : ""}.` : "No older finished tasks."); } catch (e) { toast(e.message); } render(); break; }
    case "keep-spell": { const inp = a.closest(".qa-hint")?.previousElementSibling?.querySelector?.("input") || $("[data-quick]"); const v = inp?.value || ""; const sp = SP.fix(v); SP.learn(sp.changes.map(c => c.from)); U.keepSpell = v; const h = $(`[data-hint-for="${inp?.id}"]`); if (h) h.innerHTML = hintFor(v); toast("OK, I'll keep your spelling for those words from now on."); break; }
    case "push-on": await enablePush(); break;
    case "acc-mfa": { a.disabled = true; try { await api.rpc("admin_mfa_reset", { target: a.dataset.id }); toast("Done. They can sign in with just their password and set up 2-step again."); } catch (e) { toast(e.message); } a.disabled = false; break; }
    case "acc-email": {
      const x = (U.access || []).find(r => r.id === id); if (!x) break;
      U.sheet = { type: "acc-email" };
      openSheet(`<h2 id="sheet-title">Change email</h2><form data-form="acc-email" data-id="${x.id}">
        <p class="muted" style="margin:-4px 0 12px">${esc(x.full_name || "This person")} signs in with <b>${esc(x.email || "")}</b>. After the change they use the new email with their same password. Their tasks and access stay the same.</p>
        <div class="field"><label for="ae-mail">New email</label><input class="inp" id="ae-mail" type="email" required autocomplete="off" value="${esc(x.email || "")}"></div>
        <div class="sheet-actions"><button class="btn" type="submit">Save new email</button></div></form>`);
      setTimeout(() => { const i = $("#ae-mail"); i?.focus(); i?.select(); }, 50);
      break;
    }
    case "acc-grant": {
      const x = (U.access || []).find(r => r.id === id), days = a.dataset.days ? +a.dataset.days : null; a.disabled = true;
      try {
        await api.setAccess(id, true, days);
        let note = days ? `${x?.full_name || "They"} can use TaskerBay for ${days} days.` : `${x?.full_name || "They"} now have permanent access.`;
        if (x && !x.activated_at && api.mail) { try { const r = await api.mail("activation", id); if (r.sent) note += ` Activation email sent to ${r.email}.`; } catch (e) { note += ` (Activation email failed: ${e.message})`; } }
        toast(note);
      } catch (e) { toast(e.message); }
      U.access = null; render(); break;
    }
    case "acc-activate": { a.disabled = true; try { const r = await api.mail("activation", id); toast(r.sent ? `Activation email sent to ${r.email}.` : "They've already activated."); } catch (e) { toast(e.message); } U.access = null; render(); break; }
    case "acc-approve": { const x = (U.access || []).find(r => r.id === id); try { await api.setAccess(id, true); toast(`${x?.full_name || "They"} can now use TaskerBay.`); } catch (e) { toast(e.message); } U.access = null; render(); break; }
    case "acc-remove": { const x = (U.access || []).find(r => r.id === id); if (U.confirmRm !== id) { U.confirmRm = id; toast(`Tap again to remove ${x?.full_name || "this account"} and all their data.`); setTimeout(() => { if (U.confirmRm === id) U.confirmRm = null; }, 4000); break; } U.confirmRm = null; try { await api.setAccess(id, false); toast("Account removed."); } catch (e) { toast(e.message); } U.access = null; render(); break; }
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
  if (e.target.id === "dep-add" && e.target.value) { const t = task(e.target.dataset.id); if (t) await depSet(t, [...(t.blocked_by || []), e.target.value]); return; }
  if (e.target.id === "rg-c") { const c = e.target.value; try { await saveRegion({ region: c, work_days: CAL.defaultWorkDays(c) }); toast(`Using ${CAL.countryName(c)}'s weekend and holidays.`); } catch (err) { toast(err.message); } return; }
  if (e.target.dataset?.hol) { const d = e.target.dataset.hol, p = { off: [], add: [], ...holPrefs() }; const set = new Set(p.off); e.target.checked ? set.delete(d) : set.add(d); p.off = [...set]; try { await saveRegion({ holiday_prefs: p }); } catch (err) { toast(err.message); } return; }
  if (e.target.dataset?.pack) { const k = e.target.dataset.pack, cur = new Set(myPacks()); e.target.checked ? cur.add(k) : cur.delete(k); const v = [...cur], pr = profile(me());
    try { localStorage.setItem("tb.packs", JSON.stringify(v)); } catch (err) {}
    if (pr) localUpsert("profiles", { ...pr, template_packs: v });
    if (S.mode === "cloud") { try { await api.updateProfile({ template_packs: v }); } catch (err) { toast(err.message); return; } }
    toast(e.target.checked ? "Pack added to your templates." : "Pack removed."); return; }
  if (e.target.id === "tp-date") { tplPreview(); return; }
  if (e.target.id === "dg-hour") { const h = +e.target.value, pr = profile(me()); try { await api.updateProfile({ email_digest_hour: h }); if (pr) localUpsert("profiles", { ...pr, email_digest_hour: h }); toast("Saved."); } catch (err) { toast(err.message); } return; }
  if (U.bulk && e.target.dataset?.bk === "on") { const r = U.bulk.rows[+e.target.dataset.i]; if (r) { r.on = e.target.checked; bulkRefresh(false); } return; }
  if (U.bulk && e.target.id === "bk-upd") { U.bulk.allowUpdates = e.target.checked; bulkRefresh(true); return; }
  if (U.bulk && e.target.id === "bk-spell") { U.bulk.fixSpell = e.target.checked; bulkRefresh(true); return; }
  if (U.bulk && e.target.id === "bk-file") { const f = e.target.files?.[0]; if (f) bulkFile(f); return; }
  if (U.bulk?.file && e.target.dataset?.bkmap) { U.bulk.file.map[e.target.dataset.bkmap] = +e.target.value; bulkRefresh(true); return; }
  if (U.bulk?.file && e.target.id === "bk-sheet") { const F = U.bulk.file; F.sheet = +e.target.value; const g = guessHeader(F.sheets[F.sheet].rows); Object.assign(F, { headerRow: g.headerRow, headers: g.headers, map: guessMap(g.headers, F.sheets[F.sheet].rows.slice(g.headerRow + 1)) }); bulkFilePanel(); bulkRefresh(true); return; }
  if (U.bulk?.file && e.target.id === "bk-hdr") { const F = U.bulk.file, rows = F.sheets[F.sheet].rows, first = rows.findIndex(r => r && r.some(Boolean)); const width = F.headers.length;
    if (e.target.checked) { const g = guessHeader(rows); const hr = /^Column [A-Z]+$/.test(g.headers[0] || "") && g.headers.every(h => /^Column [A-Z]+$/.test(h)) ? first : g.headerRow; F.headerRow = hr; F.headers = [...Array(width)].map((_, k) => rows[hr]?.[k] ? cellText(rows[hr][k]) : `Column ${String.fromCharCode(65 + k)}`); } else { F.headerRow = first - 1; F.headers = [...Array(width)].map((_, k) => `Column ${String.fromCharCode(65 + k)}`); }
    F.map = guessMap(F.headers, rows.slice(F.headerRow + 1)); bulkFilePanel(); bulkRefresh(true); return; }
  const el = e.target;
  if (el.dataset.tfield) { await saveTaskField(el); return; }
  if (el.id === "ft-task") { FT.taskId = el.value; render(); }
  if (el.id === "fd-who") { U.fundWho = el.value; render(); return; }
  if (el.id === "fe-who") { warnLimit(); return; }
  if (el.id === "fp-link") { const fe = $("#fp-email-f"); if (fe) fe.style.display = el.value === "email" ? "" : "none"; const o = el.selectedOptions[0]; if (el.value && el.value !== "email" && !$("#fp-name").value.trim()) $("#fp-name").value = o.textContent.replace(/ \(TaskerBay\)$/, ""); return; }
  if (el.id === "free-start" || el.id === "free-end") { if (el.value) { FREE[el.id === "free-start" ? "start" : "end"] = el.value; saveFree(); render(); } return; }
  if (el.id === "nt-due") $$("#sheet [data-quickdue] .pick").forEach(x => x.classList.toggle("on", x.dataset.v === el.value));
  if (el.id === "au-trigger") $("#au-stage-f").style.display = el.value === "stage_changed" ? "" : "none";
  if (el.dataset.at !== undefined) { readAutoForm(); reopenAuto(); }
  if (el.dataset.roleFor) { const m = S.db.workspace_members.find(x => x.user_id === el.dataset.roleFor); if (m) { await update("workspace_members", m, { role: el.value }); toast("Role updated."); } }
});
let journalTimer;
document.addEventListener("input", e => {
  if (U.sheet?.type === "fund-entry" && e.target.id === "fe-amt") warnLimit();
  if (U.sheet?.type === "task" && ["upd-text", "upd-date", "upd-time"].includes(e.target.id)) { if (e.target.id !== "upd-text") e.target.dataset.manual = "1"; clearTimeout(U.updT); U.updT = setTimeout(() => { const t = task(U.sheet?.id); if (t) updatePreview(t); }, 200); }
  if (U.bulk && e.target.closest?.("#sheet")) {
    const el = e.target;
    if (el.id === "bk-text") { clearTimeout(U.bulkT); U.bulkT = setTimeout(() => bulkRefresh(true), 250); return; }
    if (el.id === "bk-date" || el.id === "bk-time") { U.bulk.def = { date: $("#bk-date").value || nextWorkday(), time: $("#bk-time").value || "09:00" }; bulkRefresh(true); return; }
    if (el.dataset.bk && el.dataset.bk !== "on") { const r = U.bulk.rows[+el.dataset.i]; if (r) { r[el.dataset.bk] = el.value; if (el.dataset.bk === "due_date" || el.dataset.bk === "due_time") r.auto = false; } return; }
  }
  if (e.target.closest?.('[data-form="chat"]')) { const t = e.target; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 140) + "px"; }
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
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && el.closest?.('[data-form="chat"]')) { e.preventDefault(); el.closest("form").requestSubmit(); return; }
  if (e.key === "Enter" && el.id === "upd-text" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('[data-action="post-update"]').click(); }
});

document.addEventListener("submit", async e => {
  e.preventDefault(); const f = e.target, kind = f.dataset.form;
  if (kind?.startsWith("fd-")) { await fundSubmit(kind, f, e); return; }
  if (kind === "tpl") { await tplCreate(f); return; }
  if (kind === "tm-add") { const m = parseInt($("#tm-min").value, 10); if (!(m > 0 && m <= 1440)) return toast("Enter minutes, 1 to 1440."); const t = task(f.dataset.id); try { await insert("time_entries", { id: uuid(), user_id: me(), workspace_id: t?.workspace_id || S.wsId, task_id: f.dataset.id, started_at: new Date(Date.now() - m * 6e4).toISOString(), ended_at: new Date().toISOString(), minutes: m, note: "", created_at: new Date().toISOString() }); toast(`Added ${durTxt(m)}.`); render(); } catch (err) { toast(err.message); } return; }
  if (kind === "plan2") { const picks = [...f.querySelectorAll("input[data-i]:checked")].map(x => U.plan2[+x.dataset.i]); const b = f.querySelector("[type=submit]"); b.disabled = true;
    try { for (const p of picks) await E.changeTask(p.t, { due_date: p.k, due_time: minT(p.s) + ":00", estimate_min: p.t.estimate_min || p.need }); closeSheet(); toast(`Scheduled ${picks.length} task${picks.length === 1 ? "" : "s"}.`); } catch (err) { b.disabled = false; toast(err.message); } return; }
  if (kind === "esc-add") { const n = parseInt($("#esc-n").value, 10), u = +$("#esc-u").value, w = $("#esc-who").value; if (!(n > 0)) return toast("Enter how long."); const hours = Math.min(2160, n * u);
    try { await insert("escalation_rules", { id: uuid(), workspace_id: S.wsId, kind: $("#esc-kind").value, hours, notify: w.startsWith("p:") ? "person" : w, person_id: w.startsWith("p:") ? w.slice(2) : null, high_only: $("#esc-high").checked, active: true, created_by: me(), created_at: new Date().toISOString() }); toast("Rule added. Matching items are checked every 15 minutes."); render(); } catch (err) { toast(err.message); } return; }
  if (kind === "rg-add") { const d = $("#rg-date").value; if (!d) return; const p = { off: [], add: [], ...holPrefs() }; p.add = [...p.add.filter(h => h.date !== d), { date: d, name: $("#rg-name").value.trim() || "Day off" }].sort((a, b) => a.date.localeCompare(b.date)).slice(-200); try { await saveRegion({ holiday_prefs: p }); toast("Day off added."); } catch (err) { toast(err.message); } return; }
  if (kind === "ap-new") { await apSubmit(f); return; }
  if (kind === "ap-decide") { const row = (S.db.approvals || []).find(x => x.id === f.dataset.id); if (!row) return; const ok = f.dataset.ok === "1", b = f.querySelector("[type=submit]"); b.disabled = true;
    try { await update("approvals", row, { status: ok ? "approved" : "rejected", decision_note: $("#ap-note").value.trim() }); closeSheet(); toast(ok ? "Approved." : "Rejected."); } catch (err) { b.disabled = false; toast(err.message); } return; }
  if (kind === "mfa-verify") { const b = f.querySelector("[type=submit]"); b.disabled = true; try { await api.mfaVerify(U.mfaEnroll.id, $("#mfa-new").value); U.mfaEnroll = null; U.mfa = undefined; toast("2-step sign-in is on. You'll need a code next time you sign in."); render(); } catch (err) { b.disabled = false; toast(err.message); } return; }
  if (kind === "acc-email") {
    const mail = $("#ae-mail").value.trim(), btn = f.querySelector("[type=submit]"); btn.disabled = true;
    try { await api.setEmail(f.dataset.id, mail); closeSheet(); toast(`Email changed to ${mail.toLowerCase()}. They'll sign in with it from now on.`); U.access = null; render(); }
    catch (err) { btn.disabled = false; toast(err.message || "Couldn't change the email."); }
    return;
  }
  if (kind === "chat") { await sendChat(f.dataset.task || null, $("textarea", f)); return; }
  if (kind === "quick") {
    const inp = $("input", f), typed = inp.value, h = $(`[data-hint-for="${inp.id}"]`);
    const sp = spellFix(typed, typed), raw = sp.text; U.keepSpell = null;
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
    const nt = await E.createTask({ title: p.title, area: p.area, priority: p.priority, due_date: p.due_date, due_time: p.due_time, starred: p.starred, repeat: p.repeat, assignee_id: p.assignee_id, remind_before: p.remind_before ?? 0, estimate_min: p.estimate_min || null });
    inp.focus(); buzz(15);
    if (sp.changes.length) toast(`Task added · spelling fixed: ${sp.changes.map(c => c.from + " → " + c.to).join(", ")}`, async () => { const orig = parseQuick(typed.replace(/^\+\s*/, "")).title; SP.learn(sp.changes.map(c => c.from)); if (task(nt.id) && orig) await E.changeTask(task(nt.id), { title: orig }); });
    else toast("Task added.");
  }
  if (kind === "newtask") {
    const typedNt = $("#nt-title").value.trim(); if (!typedNt) return;
    const spNt = spellFix(typedNt), raw = spNt.text;
    const p = parseQuick(raw), wfId = $("#nt-wf").value, wf = S.db.workflows.find(w => w.id === wfId);
    const preset = U.sheet.preset || {};
    const ntTime = $("#nt-time")?.value || p.due_time || null, ntRem = p.remind_before ?? parseInt($("#nt-rem")?.value ?? "0", 10);
    const nt = await E.createTask({ title: p.title || raw, due_date: $("#nt-due").value || p.due_date || (ntTime ? dkey() : null), due_time: ntTime, remind_before: ntRem, area: $("#nt-area").value, priority: raw.includes("!") ? p.priority : $("#nt-pri").value, workflow_id: wfId, stage: preset.stage && wf?.stages.some(s => s.key === preset.stage) ? preset.stage : E.firstStage(wf), assignee_id: $("#nt-as")?.value || p.assignee_id || me(), starred: p.starred, repeat: p.repeat, estimate_min: p.estimate_min || null });
    for (const s of $("#nt-steps").value.split("\n").map(x => x.trim()).filter(Boolean)) await E.createTask({ title: s, parent_id: nt.id, area: nt.area, assignee_id: nt.assignee_id }, 1);
    closeSheet(); buzz(15);
    if (spNt.changes.length) toast(`Task created · spelling fixed: ${spNt.changes.map(c => c.from + " → " + c.to).join(", ")}`, async () => { SP.learn(spNt.changes.map(c => c.from)); const orig = parseQuick(typedNt).title || typedNt; if (task(nt.id)) await E.changeTask(task(nt.id), { title: orig }); });
    else toast("Task created.");
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
      else if (mode === "up") { const live = await api.signUp($("#au-n").value.trim(), email, pw, $("#au-c").value.trim().toUpperCase()); if (live) location.reload(); else authScreen("in", { ok: true, text: "Account created. Sign in with your email and password." }); }
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


/* ================= Voice add ================= */
const SPEECH = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
let REC = null;
function voiceStart(btn) {
  const inp = $("#" + btn.dataset.for); if (!inp || !SPEECH) return;
  if (REC) { REC.stop(); return; }
  const r = new SPEECH(); REC = r;
  r.lang = navigator.language?.startsWith("en") ? navigator.language : "en-GB"; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
  const before = inp.value ? inp.value.trim() + " " : "";
  const ph = inp.placeholder; btn.classList.add("on"); btn.textContent = "⏺"; inp.placeholder = "Listening… say the task, day and time";
  r.onresult = e => { let txt = ""; for (const x of e.results) txt += x[0].transcript; inp.value = before + txt.trim(); inp.dispatchEvent(new Event("input", { bubbles: true })); };
  r.onerror = e => { if (e.error === "not-allowed" || e.error === "service-not-allowed") toast("Allow the microphone for taskerbay.com to use voice."); else if (e.error !== "no-speech" && e.error !== "aborted") toast("Couldn't hear that. Try again."); };
  r.onend = () => { REC = null; btn.classList.remove("on"); btn.textContent = "🎤"; inp.placeholder = ph; inp.focus(); };
  try { r.start(); } catch (e) { REC = null; btn.classList.remove("on"); btn.textContent = "🎤"; }
}

// Pasting several lines into a quick-add box opens Bulk add with them
document.addEventListener("paste", e => {
  const el = e.target; if (!el.matches?.("[data-quick]")) return;
  const txt = e.clipboardData?.getData("text") || "";
  if (splitBulk(txt).length > 1 && /\n/.test(txt.trim())) { e.preventDefault(); bulkSheet(txt.trim()); }
});

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
/* Outlook / Microsoft 365 calendar (one way: Outlook -> TaskerBay) */
function calendarCard() {
  if (!api.calendarStatus) return "";
  if (U.cal === undefined) { U.cal = null; api.calendarStatus().then(x => { U.cal = x || false; render(); }, () => { U.cal = "na"; render(); }); }
  if (U.cal === "na") return ""; // not available on this server yet
  const c = U.cal, n = (S.db.calendar_events || []).length;
  const ago = t => { if (!t) return "not yet"; const m = Math.round((Date.now() - new Date(t)) / 6e4); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
  const howTo = `<details class="cal-how" ${c ? "" : "open"}><summary>How to get your Outlook calendar link</summary><ol>
      <li>On a computer, open <b>outlook.office.com</b> (Outlook on the web) and sign in with your work account.</li>
      <li>Click ⚙ <b>Settings</b> → <b>Calendar</b> → <b>Shared calendars</b>.</li>
      <li>Under <b>Publish a calendar</b>, pick <b>Calendar</b> and choose <b>Can view all details</b> (meeting titles) or <b>Can view when I'm busy</b> (times only, more private). Click <b>Publish</b>.</li>
      <li>Click the <b>ICS</b> link, choose <b>Copy link</b>, and paste it below.</li></ol>
      <p>If “Publish a calendar” isn't shown, your company has switched it off; ask IT to allow calendar publishing.</p></details>`;
  const form = `<div class="field" style="margin-top:10px"><label for="cal-url">Outlook ICS link</label><input class="inp" id="cal-url" type="url" inputmode="url" autocomplete="off" placeholder="https://outlook.office365.com/owa/calendar/…/calendar.ics"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-action="cal-connect">Connect calendar</button>${c ? `<button class="btn ghost" data-action="cal-cancel">Cancel</button>` : ""}</div>`;
  let body;
  if (c === null) body = `<p class="muted" style="margin:0">Checking…</p>`;
  else if (!c || U.calEdit) body = `<p class="muted" style="margin:0 0 6px;font-size:14px">Show your Outlook / Microsoft 365 meetings in TaskerBay: on Today, in the Planner timeline, and as busy time in Free time. <b>One way only</b>: TaskerBay never changes your Outlook calendar.</p>${howTo}${form}`;
  else body = `<p style="margin:0 0 4px;font-size:14px">✅ Connected to <b>${esc(c.host || "Outlook")}</b></p>
    <p class="muted" style="margin:0 0 10px;font-size:13.5px">${n} meeting${n === 1 ? "" : "s"} from last week to 2 months ahead · checked ${ago(c.last_synced_at)} · updates every 10 minutes</p>
    ${c.last_error ? `<p class="flag" style="margin:0 0 10px">⚠️ Last check failed: ${esc(c.last_error)}</p>` : ""}
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" data-action="cal-sync">Sync now</button><button class="btn ghost" data-action="cal-edit">Change link</button><button class="btn ghost danger-t" data-action="cal-clear">Disconnect</button></div>
    <p class="muted" style="font-size:12.5px;margin:10px 0 0">Only you can see these meetings. The link is stored privately on the server and never shown again. To stop sharing completely, also click <b>Unpublish</b> in Outlook.</p>`;
  return `<div class="card"><div class="card-h"><h2>📅 Outlook calendar</h2>${c ? `<span class="chip ok">On</span>` : ""}</div>${body}</div>`;
}
async function calendarAction(act, a) {
  switch (act) {
    case "cal-connect": {
      const url = ($("#cal-url")?.value || "").trim();
      if (!url) { $("#cal-url")?.focus(); toast("Paste the ICS link from Outlook first."); return; }
      a.disabled = true; a.textContent = "Connecting…";
      try { await api.calendarSet(url); U.calEdit = false; const r = await api.calendarSync(); toast(`Connected. ${r?.n ?? (S.db.calendar_events || []).length} meetings loaded.`); }
      catch (e) { toast(e.message || "Couldn't connect."); }
      U.cal = undefined; render(); return;
    }
    case "cal-sync": { a.disabled = true; a.textContent = "Syncing…"; try { const r = await api.calendarSync(); toast(`Up to date. ${r?.n ?? 0} meetings.`); } catch (e) { toast(e.message); } U.cal = undefined; render(); return; }
    case "cal-edit": U.calEdit = true; render(); return;
    case "cal-cancel": U.calEdit = false; render(); return;
    case "cal-clear": {
      if (a.dataset.sure !== "1") { a.dataset.sure = "1"; a.textContent = "Tap again to disconnect"; return; }
      try { await api.calendarClear(); toast("Outlook calendar disconnected. Meetings removed from TaskerBay."); } catch (e) { toast(e.message); }
      U.cal = undefined; U.calEdit = false; render(); return;
    }
  }
}
function pushCard() {
  const st = pushState(); if (st === "na") return "";
  const body = {
    on: `<p class="muted" style="margin:0 0 12px;font-size:14px">✅ On for this device. You'll get a <b>9 AM summary</b> (your local time), a popup <b>at each task's time</b> (or earlier if you choose), routine reminders, and team updates.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" data-action="push-test">Send a test popup</button><button class="btn ghost" data-action="push-off">Turn off on this device</button></div>`,
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
// Links from popups: "#task=<id>&ws=<workspace>", "#chat&ws=<workspace>", "#inbox&ws=..."
function openFromHash() {
  const h = location.hash.slice(1); if (!h) return false;
  const parts = h.split("&"), head = parts[0], q = Object.fromEntries(parts.slice(1).map(x => x.split("=")));
  const isTask = head.startsWith("task="), view = isTask ? null : head;
  if (!isTask && !q.ws) return false;
  (async () => {
    let wsId = q.ws;
    if (isTask && !wsId && !task(head.slice(5))) { try { wsId = await api.taskWorkspace?.(head.slice(5)); } catch (e) {} }
    if (wsId && wsId !== S.wsId && S.db.workspaces.some(w => w.id === wsId)) await switchWs(wsId);
    if (isTask) {
      history.replaceState(null, "", "#" + U.view); const id = head.slice(5), t = task(id);
      if (!t) { toast("That task was deleted or you no longer have access to it."); return; }
      // buttons on the system notification: "Done" and "Snooze"
      if (q.do === "done") { if (!E.isDone(t)) await E.completeTask(t); markAlert(alertKey(t, "due")); toast(`Done: ${t.title}`); return; }
      if (q.do === "snooze") { const m = lastSnooze(), d = new Date(Date.now() + m * 60e3); await E.changeTask(t, { due_date: dkey(d), due_time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }); toast(`Snoozed ${snzLabel(m)}: ${t.title}`); return; }
      openTask(id);
    }
    else if (VIEWS[view]) go(view);
  })();
  return true;
}

/* ================= Chat (task chats + team chat) ================= */
const roomKey = taskId => taskId || "team";
const roomMsgs = taskId => S.db.chat_messages.filter(m => (m.task_id || null) === (taskId || null)).sort((a, b) => a.created_at.localeCompare(b.created_at));
const lastRead = taskId => S.db.chat_reads.find(r => r.workspace_id === S.wsId && r.room === roomKey(taskId))?.last_read_at || "";
const chatUnread = taskId => roomMsgs(taskId).filter(m => m.author_id !== me() && m.created_at > lastRead(taskId)).length;
const chatUnreadAll = () => S.db.chat_messages.filter(m => m.author_id !== me() && m.created_at > lastRead(m.task_id)).length;
const markTimers = {};
function markRead(taskId) {
  if (!chatUnread(taskId)) return;
  const k = roomKey(taskId); clearTimeout(markTimers[k]);
  markTimers[k] = setTimeout(() => {
    const latest = roomMsgs(taskId).slice(-1)[0]?.created_at || new Date().toISOString();
    upsert("chat_reads", { user_id: me(), workspace_id: S.wsId, room: k, last_read_at: latest > new Date().toISOString() ? latest : new Date().toISOString() }).catch(() => {});
    // the matching Inbox alert is read too
    S.db.notifications.filter(n => !n.read && /^💬/.test(n.body) && n.workspace_id === S.wsId && (n.task_id || null) === (taskId || null)).forEach(n => update("notifications", n, { read: true }).catch(() => {}));
  }, 400);
}
function chatTime(iso) { const d = new Date(iso); return dkey(d) === dkey() ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); }
function chatPanel(taskId, inputId) {
  const msgs = roomMsgs(taskId), lr = lastRead(taskId); let prev = null, shownNew = false;
  const body = msgs.map(m => {
    const mine = m.author_id === me(), grouped = prev && prev.author_id === m.author_id && (new Date(m.created_at) - new Date(prev.created_at)) < 5 * 60e3;
    let sep = ""; if (!shownNew && !mine && lr && m.created_at > lr) { sep = `<div class="chat-new"><span>New</span></div>`; shownNew = true; }
    const day = !prev || dkey(new Date(prev.created_at)) !== dkey(new Date(m.created_at)) ? `<div class="chat-day">${dkey(new Date(m.created_at)) === dkey() ? "Today" : new Date(m.created_at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</div>` : "";
    prev = m;
    return `${day}${sep}<div class="msg-row ${mine ? "me" : ""} ${grouped && !day && !sep ? "grouped" : ""}">${!mine ? (grouped && !day && !sep ? `<span class="av-sp"></span>` : avatar(m.author_id)) : ""}<div class="msg">${!mine && !(grouped && !day && !sep) ? `<b>${esc(nameOf(m.author_id))}</b>` : ""}<p>${esc(m.body)}</p><small>${chatTime(m.created_at)}${mine ? ` <button class="msg-del" data-action="chat-del" data-id="${m.id}" aria-label="Delete message">✕</button>` : ""}</small></div></div>`;
  }).join("");
  return `<div class="chat-box" data-chat-room="${roomKey(taskId)}"><div class="chat-list" id="chat-list-${roomKey(taskId)}">${body || `<p class="muted chat-empty">${taskId ? "No messages yet. Ask a question or share an update about this task." : "Say hello to your team 👋"}</p>`}</div>
    <form class="chat-send" data-form="chat" data-task="${taskId || ""}" autocomplete="off"><label for="${inputId}" class="sr">Message</label><textarea id="${inputId}" class="inp" rows="1" placeholder="Message${taskId ? "" : " the team"}…" enterkeyhint="send"></textarea><button class="btn" type="submit" aria-label="Send">${I.send || "➤"}</button></form></div>`;
}
function scrollChat(taskId, force) {
  const el = $("#chat-list-" + roomKey(taskId)); if (!el) return;
  const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  if (force || near || !el.dataset.seen) { el.scrollTop = el.scrollHeight; el.dataset.seen = "1"; }
}
function vChat() {
  const w = ws();
  if (!isTeam()) return `<div class="view-h"><div><h1>💬 Team chat</h1><p>${esc(w?.name || "")}</p></div></div>${emptyBox("Chat is for shared workspaces", "Create a shared workspace in Team & updates and invite people. Then you can chat here and inside every shared task.", I.chat)}<div style="text-align:center;margin-top:12px"><button class="btn" data-go="team">Go to Team</button></div>`;
  setTimeout(() => { scrollChat(null); markRead(null); }, 0);
  return `<div class="view-h"><div><h1>💬 Team chat</h1><p>${esc(w?.icon || "")} ${esc(w?.name || "")} · ${S.db.workspace_members.map(m => esc(nameOf(m.user_id).split(" ")[0])).join(", ")}</p></div></div>
  <div class="card chat-card">${chatPanel(null, "chat-in-team")}</div>`;
}
async function sendChat(taskId, input) {
  const body = input.value.trim(); if (!body) return;
  input.value = ""; input.style.height = "";
  const row = { id: uuid(), workspace_id: S.wsId, task_id: taskId || null, author_id: me(), body: body.slice(0, 4000), created_at: new Date().toISOString() };
  try { await insert("chat_messages", row); upsert("chat_reads", { user_id: me(), workspace_id: S.wsId, room: roomKey(taskId), last_read_at: row.created_at }).catch(() => {}); buzz(8); }
  catch (e) { input.value = body; }
  setTimeout(() => scrollChat(taskId, true), 30);
}

/* ================= On-screen due alerts (while TaskerBay is open, on every device) ================= */
const myTask = t => (t.assignee_id || t.created_by) === me();
function dueAt(t) { if (!t.due_date || !t.due_time) return null; const [y, m, d] = t.due_date.split("-").map(Number), [h, mi] = fmtTime(t.due_time).split(":").map(Number); return new Date(y, m - 1, d, h, mi).getTime(); }
const alertKey = (t, kind) => `tb.al.${t.id}.${t.due_date}${fmtTime(t.due_time)}.${t.remind_before ?? 0}.${kind}`;
const seenAlert = k => { try { return !!localStorage.getItem(k); } catch (e) { return false; } };
const markAlert = k => { try { localStorage.setItem(k, "1"); } catch (e) {} };
function checkDueAlerts() {
  if (!S.ready || U.dueAlert) return;
  const now = Date.now();
  for (const t of S.db.tasks) {
    if (E.isDone(t) || !myTask(t) || (t.remind_before ?? 0) < 0) continue;
    const at = dueAt(t); if (!at) continue;
    const rb = t.remind_before ?? 0;
    if (now >= at && now - at < 60 * 60e3 && !seenAlert(alertKey(t, "due"))) return showDueAlert(t, "due");
    if (rb > 0 && now >= at - rb * 60e3 && now < at && !seenAlert(alertKey(t, "early"))) return showDueAlert(t, "early");
  }
}
function alertBeep() {
  try { const C = window.AudioContext || window.webkitAudioContext; const c = new C(); [0, .22, .44].forEach(o => { const g = c.createGain(), osc = c.createOscillator(); osc.type = "sine"; osc.frequency.value = 880; g.gain.setValueAtTime(0.0001, c.currentTime + o); g.gain.exponentialRampToValueAtTime(0.25, c.currentTime + o + .02); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + o + .18); osc.connect(g).connect(c.destination); osc.start(c.currentTime + o); osc.stop(c.currentTime + o + .2); }); } catch (e) {}
  try { navigator.vibrate?.([200, 100, 200]); } catch (e) {}
}
const SNOOZE = [5, 10, 15, 30, 60, 120, 240];
const snzLabel = m => m >= 60 ? `${m / 60} h` : `${m} min`;
const lastSnooze = () => { try { const v = +localStorage.getItem("tb.snooze"); return SNOOZE.includes(v) ? v : 10; } catch (e) { return 10; } };
const saveSnooze = m => { try { localStorage.setItem("tb.snooze", String(m)); } catch (e) {} };
function showDueAlert(t, kind) {
  markAlert(alertKey(t, kind)); U.dueAlert = t.id;
  const left = Math.round((dueAt(t) - Date.now()) / 60e3);
  const head = kind === "due" ? "⏰ Due now" : left >= 60 * 20 ? "Due tomorrow" : left >= 60 ? `Due in ${Math.round(left / 60)} h` : `Due in ${Math.max(1, left)} min`;
  let host = $("#due-alert"); if (!host) { host = document.createElement("div"); host.id = "due-alert"; document.body.appendChild(host); }
  host.innerHTML = `<div class="da-card ${kind}" role="alertdialog" aria-labelledby="da-t" style="--p:${PRI_C[t.priority]}">
    <div class="da-head">${head}<span>${esc(dueLabel(t))}</span></div>
    <div class="da-t" id="da-t">${esc(t.title)}</div>
    ${t.status_note ? `<div class="da-note">💬 ${esc(t.status_note)}</div>` : ""}
    <div class="da-meta"><span class="chip" style="color:${PRI_C[t.priority]}">${esc(t.priority)}</span><span class="chip">${esc(t.area)}</span></div>
    <div class="da-actions"><button class="btn" data-da="done">✓ Done</button><button class="btn ghost" data-da="snz" data-m="${lastSnooze()}">Snooze ${snzLabel(lastSnooze())}</button><button class="btn ghost" data-da="snz-more" aria-expanded="false">More…</button><button class="btn ghost" data-da="open">Open</button></div>
    <div class="da-snooze" hidden><div class="da-snz-h">Snooze for</div>
      <div class="da-snz-grid">${SNOOZE.map(m => `<button class="pick ${m === lastSnooze() ? "on" : ""}" data-da="snz" data-m="${m}">${snzLabel(m)}</button>`).join("")}<button class="pick" data-da="snz" data-m="tomorrow">Tomorrow 9 AM</button><button class="pick" data-da="snz" data-m="nextwd">Next working day 9 AM</button></div>
      <div class="da-snz-custom"><input class="inp" type="datetime-local" id="da-when" aria-label="Pick a date and time"><button class="btn ghost" data-da="snz-custom">Set</button></div></div>
    <button class="da-x" data-da="close" aria-label="Dismiss">✕</button></div>`;
  host.classList.add("on"); alertBeep();
  const when = $("#da-when"); if (when) { const d = new Date(Date.now() + 60 * 60e3); when.value = `${dkey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; when.min = `${dkey()}T00:00`; }
  host.onclick = async e => {
    const b = e.target.closest("[data-da]"); if (!b) return;
    const act = b.dataset.da, cur = task(t.id);
    if (act === "snz-more") { const p = host.querySelector(".da-snooze"); p.hidden = !p.hidden; b.setAttribute("aria-expanded", String(!p.hidden)); b.textContent = p.hidden ? "More…" : "Hide"; return; }
    let target = null;
    if (act === "snz") { const m = b.dataset.m; target = m === "tomorrow" ? (() => { const d = addDays(new Date(), 1); d.setHours(9, 0, 0, 0); return d; })() : m === "nextwd" ? (() => { const d = parseKey(nextWorkday()); d.setHours(9, 0, 0, 0); return d; })() : new Date(Date.now() + +m * 60e3); if (/^\d+$/.test(m)) saveSnooze(+m); }
    if (act === "snz-custom") { const v = $("#da-when")?.value; const d = v ? new Date(v) : null; if (!d || isNaN(d) || d <= new Date()) { toast("Pick a time in the future."); return; } target = d; }
    host.classList.remove("on"); U.dueAlert = null;
    if (act === "done" && cur) { await E.completeTask(cur); toast(`Done: ${cur.title}`); }
    if (target && cur) { await E.changeTask(cur, { due_date: dkey(target), due_time: `${pad(target.getHours())}:${pad(target.getMinutes())}` }); toast(`Snoozed to ${target.toDateString() === new Date().toDateString() ? "" : target.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) + " "}${fmtTime(`${pad(target.getHours())}:${pad(target.getMinutes())}`)}`); }
    if (act === "open" && cur) openTask(cur.id);
    setTimeout(checkDueAlerts, 600);
  };
}
setInterval(checkDueAlerts, 15e3);
document.addEventListener("visibilitychange", () => { if (!document.hidden) setTimeout(checkDueAlerts, 800); });

/* ================= Templates ================= */
// optional packs (HR & people) only show for people who switch them on in Settings
const myPacks = () => profile(me())?.template_packs || (() => { try { return JSON.parse(localStorage.getItem("tb.packs") || "[]"); } catch (e) { return []; } })();
const allTemplates = () => [...TP.BUILT_IN.filter(t => !t.pack || myPacks().includes(t.pack)), ...(S.db.task_templates || []).map(r => ({ ...r.data, id: r.id, key: "u:" + r.id, name: r.name, mine: true }))];
function templateSheet(key) {
  const list = allTemplates();
  U.sheet = { type: "tpl" };
  if (!key) {
    openSheet(`<h2 id="sheet-title">Start from a template</h2><p class="muted" style="margin:-4px 0 12px;font-size:14px">Creates the main task and every step with its own date. Change anything afterwards.</p>
    ${(() => { const card = t => `<button class="tpl-card" data-action="tpl-pick" data-k="${esc(t.key)}"><span class="ic">${esc(t.icon || "📋")}</span><span><b>${esc(t.name)}</b><small>${esc(t.blurb || `${t.steps.length} steps`)}</small></span><em>${t.steps.length} steps</em></button>`;
      const groups = [["Mine", list.filter(t => t.mine)], ...TP.CATS.map(c => [c, list.filter(t => !t.mine && t.cat === c)])].filter(g => g[1].length);
      return groups.map(([c, ts], i) => `<div class="tp-h" style="margin:${i ? 14 : 0}px 0 6px">${esc(c === "Mine" ? "My templates" : c)}</div><div class="tpl-list">${ts.map(card).join("")}</div>`).join(""); })()}
    <p class="muted" style="font-size:12.5px;margin:12px 0 0">Tip: open any task with steps and tap <b>📋 Save as template</b> to add your own here.</p>`, "wide");
    return;
  }
  const t = list.find(x => x.key === key); if (!t) return;
  const members = S.db.workspace_members.map(m => m.user_id);
  let anchor = TP.defaultAnchor(t); if (t.rule && TP.planSteps(t, anchor).some(x => x.due < dkey())) anchor = dkey(E.nextRepeat(t.rule, parseKey(anchor))); // this cycle already started: plan the next one
  const needsName = /\{name\}/.test(t.title || "");
  const who = (id, sel) => `<select class="inp" id="${id}">${(members.length ? members : [me()]).map(u => `<option value="${u}" ${u === sel ? "selected" : ""}>${esc(nameOf(u))}${u === me() ? " (me)" : ""}</option>`).join("")}</select>`;
  openSheet(`<h2 id="sheet-title">${esc(t.icon || "📋")} ${esc(t.name)}</h2>
  <form data-form="tpl" data-k="${esc(t.key)}" autocomplete="off">
    ${needsName ? `<div class="field"><label for="tp-name">${esc(t.nameLabel || "Name")}</label><input class="inp" id="tp-name" required></div>` : ""}
    <div class="grid g-2" style="gap:10px"><div class="field"><label for="tp-date">${esc(t.anchor || "Due date")}</label><input class="inp" type="date" id="tp-date" value="${anchor}" required></div>
    ${members.length > 1 ? `<div class="field"><label for="tp-who">Steps assigned to</label>${who("tp-who", me())}</div>` : ""}</div>
    ${members.length > 1 && t.steps.some(s => s[2] === "approval") ? `<div class="field"><label for="tp-appr">Approval by</label>${who("tp-appr", me())}</div>` : ""}
    ${t.repeat ? `<label class="tog" style="margin:4px 0 10px"><input type="checkbox" id="tp-rep" checked> Repeat ${esc(E.repeatLabel(t.rule))}. The next cycle and all its steps are created when this one is done.</label>` : ""}
    <div class="tpl-prev" id="tp-prev"></div>
    <div class="sheet-actions">${t.mine ? `<button type="button" class="btn danger" data-action="tpl-del" data-id="${t.id}">Delete template</button>` : `<button type="button" class="btn ghost" data-action="tpl-open">Back</button>`}<button class="btn" type="submit">Create ${t.steps.length + 1} tasks</button></div>
  </form>`, "wide");
  tplPreview();
}
function tplPreview() {
  const f = $('[data-form="tpl"]'), box = $("#tp-prev"); if (!f || !box) return;
  const t = allTemplates().find(x => x.key === f.dataset.k), a = $("#tp-date").value; if (!t || !a) return;
  const today = dkey();
  const plan = TP.planSteps(t, a), at = plan.filter(s => s.offset <= 0).length;
  const dl = k => parseKey(k).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const row = s => `<div class="tp-row ${s.due < today ? "past" : ""}"><span class="tp-d">${dl(s.due)}</span><span>${s.approval ? "✅ " : ""}${esc(s.title)}</span></div>`;
  box.innerHTML = `<div class="tp-h">Plan</div>` + plan.slice(0, at).map(row).join("") + `<div class="tp-row key"><span class="tp-d">${dl(a)}</span><b>${esc(t.anchor || "Due")}</b></div>` + plan.slice(at).map(row).join("");
  if (TP.planSteps(t, a).some(s => s.due < today)) box.insertAdjacentHTML("beforeend", `<p class="muted" style="font-size:12.5px;margin:8px 0 0">Steps in grey are already in the past. They'll show as overdue.</p>`);
}
async function tplCreate(f) {
  const t = allTemplates().find(x => x.key === f.dataset.k); if (!t) return;
  const a = $("#tp-date").value, name = $("#tp-name")?.value.trim() || "";
  if (!a) return toast("Pick the date first.");
  const owner = $("#tp-who")?.value || me(), appr = $("#tp-appr")?.value || owner;
  const wfs = E.workflows(), payWf = t.key === "payroll" ? wfs.find(w => w.name === "Payroll cycle") : null, apprWf = wfs.find(w => w.name === "Approval");
  const btn = f.querySelector('button[type="submit"]'); btn.disabled = true; btn.textContent = "Creating…";
  try {
    const parent = await E.createTask({ title: TP.fillTitle(t, a, name) || t.name, due_date: a, priority: t.priority || "Medium", area: "Work", assignee_id: owner, repeat: t.repeat && $("#tp-rep")?.checked ? t.rule : "", ...(payWf ? { workflow_id: payWf.id, stage: E.firstStage(payWf) } : {}) });
    let pos = Date.now();
    for (const s of TP.planSteps(t, a)) await E.createTask({ parent_id: parent.id, title: s.title, due_date: s.due, area: "Work", priority: s.approval ? "High" : "Medium", assignee_id: s.approval ? appr : owner, position: pos++, ...(s.approval && apprWf ? { workflow_id: apprWf.id, stage: E.firstStage(apprWf) } : {}) });
    closeSheet(); toast(`Created “${parent.title}” with ${t.steps.length} steps.`); setTimeout(() => openTask(parent.id), 250);
  } catch (e) { btn.disabled = false; btn.textContent = "Create"; toast(e.message); }
}
async function tplSave(id) {
  const t = task(id); if (!t) return;
  const data = TP.fromTask(t, E.childrenOf(t.id));
  const row = { id: uuid(), user_id: me(), name: (t.title || "My template").slice(0, 200), data, created_at: new Date().toISOString() };
  try { await insert("task_templates", row); toast(`Saved “${row.name}” as a template.`); } catch (e) { toast(e.message); }
}

/* ================= 2-step sign-in ================= */
function mfaScreen(factor) {
  $("#root").innerHTML = `<div class="auth"><div class="auth-card">
    <div class="brand"><div class="brand-mark"><span></span></div>TaskerBay</div>
    <h1>Enter your code</h1><p class="lead">Open your authenticator app and type the 6-digit code for TaskerBay.</p>
    <form id="mfa-f"><div class="field"><label for="mfa-c">6-digit code</label><input class="inp" id="mfa-c" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" required autofocus style="letter-spacing:.3em;font-size:20px;text-align:center"></div>
    <button class="btn" type="submit" style="width:100%">Continue</button><p class="muted" id="mfa-msg" style="margin:10px 0 0;font-size:13.5px"></p></form>
    <div class="alt">or</div><button class="btn ghost" id="mfa-out">Sign out</button>
    <p class="muted" style="font-size:12.5px;margin-top:14px">Lost your phone? Ask the TaskerBay admin to switch 2-step sign-in off for your account.</p></div></div>`;
  $("#mfa-out").onclick = () => api.signOut();
  $("#mfa-c").focus();
  $("#mfa-f").onsubmit = async e => {
    e.preventDefault(); const b = e.target.querySelector("button"); b.disabled = true;
    try { await api.mfaVerify(factor.id, $("#mfa-c").value); location.reload(); }
    catch (err) { b.disabled = false; $("#mfa-msg").textContent = err.message; $("#mfa-c").select(); }
  };
}
function mfaCard() {
  if (S.mode !== "cloud") return "";
  if (U.mfa === undefined) { U.mfa = null; api.mfaState().then(x => { U.mfa = x; render(); }, () => { U.mfa = { err: true }; render(); }); }
  const m = U.mfa, en = U.mfaEnroll;
  let body;
  if (!m) body = `<p class="muted" style="margin:0">Checking…</p>`;
  else if (m.err) body = `<p class="muted" style="margin:0">2-step sign-in isn't available right now.</p>`;
  else if (m.factor) body = `<p style="margin:0 0 10px;font-size:14px"><span class="chip ok">On</span> Signing in needs your password <b>and</b> a code from your authenticator app.</p><button class="btn ghost danger-t" data-action="mfa-off">Turn off 2-step sign-in</button>`;
  else if (en) body = `<ol class="muted" style="margin:0 0 10px;padding-left:18px;font-size:14px;display:grid;gap:4px"><li>Open an authenticator app (Microsoft Authenticator, Google Authenticator…).</li><li>Scan this code, or type the key below.</li><li>Enter the 6-digit code it shows.</li></ol>
    <div class="mfa-qr"><img alt="QR code for your authenticator app" src="${en.qr.startsWith("data:") ? en.qr : "data:image/svg+xml;utf8," + encodeURIComponent(en.qr)}"></div>
    <p style="font-size:12.5px;text-align:center;margin:6px 0 12px;word-break:break-all"><span class="muted">Key:</span> <code>${esc(en.secret)}</code></p>
    <form data-form="mfa-verify"><div class="field"><label for="mfa-new">6-digit code</label><input class="inp" id="mfa-new" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required style="letter-spacing:.3em;text-align:center"></div>
    <div class="sheet-actions" style="margin:0"><button type="button" class="btn ghost" data-action="mfa-cancel">Cancel</button><button class="btn" type="submit">Turn on</button></div></form>`;
  else body = `<p class="muted" style="margin:0 0 10px;font-size:14px">Add a second lock: after your password, TaskerBay asks for a 6-digit code from an app on your phone. Strongly recommended for the admin account.</p><button class="btn" data-action="mfa-on">Set up 2-step sign-in</button>`;
  return `<div class="card"><div class="card-h"><h2>🔐 2-step sign-in</h2></div>${body}</div>`;
}
async function mfaAction(act, a) {
  if (act === "mfa-on") { a.disabled = true; try { U.mfaEnroll = await api.mfaEnroll(); } catch (e) { toast(e.message); } render(); return; }
  if (act === "mfa-cancel") { U.mfaEnroll = null; U.mfa = undefined; render(); return; }
  if (act === "mfa-off") { if (!U.mfa?.factor) return; a.disabled = true; try { await api.mfaOff(U.mfa.factor.id); toast("2-step sign-in is off."); } catch (e) { toast(e.message); } U.mfa = undefined; render(); }
}

function packsCard() {
  const on = myPacks();
  return `<div class="card"><div class="card-h"><h2>📋 Template packs</h2></div><p class="muted" style="margin:0 0 10px;font-size:14px">Extra ready-made templates for specific kinds of work. Only you see the packs you switch on.</p>
    ${TP.PACKS.map(pk => `<label class="tog" style="margin:6px 0"><input type="checkbox" data-pack="${pk.key}" ${on.includes(pk.key) ? "checked" : ""}> <span><b>${esc(pk.name)}</b><br><span class="muted">${esc(pk.blurb)}</span></span></label>`).join("")}</div>`;
}
/* ================= Approvals ================= */
const KINDS = [["Sign-off", "✍️"], ["Leave", "🌴"], ["Expense", "💳"], ["Purchase", "🛒"], ["Document", "📄"], ["Other", "📌"]];
const kindIc = k => (KINDS.find(x => x[0] === k) || KINDS[5])[1];
const apprWaiting = () => (S.db.approvals || []).filter(a => a.approver_id === me() && a.status === "pending").length;
function apRow(a) {
  const mine = a.requested_by === me(), forMe = a.approver_id === me() && a.status === "pending";
  const st = { pending: ["Waiting", "warn"], approved: ["Approved", "ok"], rejected: ["Rejected", "bad"], cancelled: ["Cancelled", ""] }[a.status];
  const other = mine ? `to ${esc(nameOf(a.approver_id))}` : `from ${esc(nameOf(a.requested_by))}`;
  return `<div class="ap-card ${a.status}">
    <div class="ap-top"><span class="ap-ic">${kindIc(a.kind)}</span><div class="ap-main"><b>${esc(a.title)}</b><small>${esc(a.kind)} · ${other} · ${timeAgo(a.created_at)}${a.needed_by ? ` · needed by ${esc(dueLabel({ due_date: a.needed_by }))}` : ""}${a.amount != null ? ` · ${esc(String(a.amount))}` : ""}</small></div><span class="chip ${st[1]}">${st[0]}</span></div>
    ${a.details ? `<p class="ap-det">${esc(a.details)}</p>` : ""}
    ${a.task_id && task(a.task_id) ? `<button class="link" data-action="open-task" data-id="${a.task_id}">↳ ${esc(task(a.task_id).title)}</button>` : ""}
    ${a.decided_at ? `<p class="ap-dec">${a.status === "approved" ? "✅" : "❌"} ${esc(nameOf(a.approver_id))}, ${esc(fmtWhen(a.decided_at))}${a.decision_note ? `: “${esc(a.decision_note)}”` : ""}</p>` : ""}
    ${forMe ? `<div class="ap-btns"><button class="btn ghost danger-t" data-action="ap-reject" data-id="${a.id}">Reject</button><button class="btn" data-action="ap-approve" data-id="${a.id}">Approve</button></div>` : ""}
    ${mine && a.status === "pending" ? `<div class="ap-btns"><button class="btn ghost" data-action="ap-cancel" data-id="${a.id}">Cancel request</button></div>` : ""}
  </div>`;
}
function vApprovals() {
  const all = S.db.approvals || [], tab = U.apTab || (apprWaiting() ? "me" : "mine");
  const lists = { me: all.filter(a => a.approver_id === me() && a.status === "pending"), mine: all.filter(a => a.requested_by === me() && a.status === "pending"), done: all.filter(a => a.status !== "pending") };
  const L = lists[tab] || [];
  return `<div class="view-h"><div><h1>Approvals</h1><p>Ask for a yes, give one, and keep a record of who decided what.</p></div><button class="btn" data-action="ap-new">＋ New request</button></div>
  <div class="seg" style="margin-bottom:14px">${[["me", `Waiting for me${lists.me.length ? ` (${lists.me.length})` : ""}`], ["mine", `My requests${lists.mine.length ? ` (${lists.mine.length})` : ""}`], ["done", "History"]].map(([k, l]) => `<button class="${tab === k ? "on" : ""}" data-action="ap-tab" data-v="${k}">${l}</button>`).join("")}</div>
  ${L.length ? `<div class="ap-list">${L.map(apRow).join("")}</div>` : emptyBox(tab === "me" ? "Nothing to approve" : tab === "mine" ? "No open requests" : "No history yet", tab === "done" ? "Decided requests are kept here." : isTeam() ? "Tap ＋ New request to ask someone in this workspace." : "Approvals work in a shared workspace. Invite someone from Team & updates first.")}`;
}
function apSheet(taskId) {
  const t = taskId ? task(taskId) : null;
  const people = S.db.workspace_members.map(m => m.user_id).filter(u => u !== me());
  if (!people.length) { toast("Invite someone to this workspace first. Approvals go to another person."); return; }
  openSheet(`<h2 id="sheet-title">Ask for approval</h2>
  <form data-form="ap-new" autocomplete="off" data-task="${t ? t.id : ""}">
    <div class="field"><span class="lab">Type</span><div class="seg wrap" id="ap-kind">${KINDS.map(([k, i], n) => `<button type="button" class="${n === 0 ? "on" : ""}" data-action="ap-kind" data-v="${k}">${i} ${k}</button>`).join("")}</div></div>
    <div class="field"><label for="ap-title">What needs approval</label><input class="inp" id="ap-title" required maxlength="300" value="${t ? esc(t.title) : ""}" placeholder="e.g. Annual leave 3–5 Dec"></div>
    <div class="field"><label for="ap-det">Details <span class="muted">(optional)</span></label><textarea class="inp" id="ap-det" rows="3" maxlength="4000"></textarea></div>
    <div class="grid g-2" style="gap:10px"><div class="field"><label for="ap-who">Approver</label><select class="inp" id="ap-who">${people.map(u => `<option value="${u}">${esc(nameOf(u))}</option>`).join("")}</select></div>
    <div class="field"><label for="ap-by">Needed by <span class="muted">(optional)</span></label><input class="inp" type="date" id="ap-by" value="${t?.due_date || ""}"></div></div>
    <div class="field"><label for="ap-amt">Amount <span class="muted">(optional)</span></label><input class="inp" id="ap-amt" inputmode="decimal" placeholder="e.g. 1250"></div>
    <div class="sheet-actions"><button type="button" class="btn ghost" data-action="close-sheet">Cancel</button><button class="btn" type="submit">Send request</button></div>
  </form>`);
}
async function apSubmit(f) {
  const title = $("#ap-title").value.trim(); if (!title) return;
  const amt = $("#ap-amt").value.replace(/[^\d.]/g, "");
  const row = { id: uuid(), workspace_id: S.wsId, task_id: f.dataset.task || null, kind: $("#ap-kind .on")?.dataset.v || "Sign-off", title, details: $("#ap-det").value.trim(), amount: amt ? +amt : null, needed_by: $("#ap-by").value || null, requested_by: me(), approver_id: $("#ap-who").value, status: "pending", decision_note: "", created_at: new Date().toISOString() };
  const b = f.querySelector("[type=submit]"); b.disabled = true;
  try { await insert("approvals", row); if (row.task_id && task(row.task_id)) await E.postUpdate?.(task(row.task_id), `Asked ${nameOf(row.approver_id)} for approval.`, "system"); closeSheet(); U.apTab = "mine"; toast(`Sent to ${nameOf(row.approver_id)}.`); if (U.view !== "approvals") go("approvals"); else render(); }
  catch (e) { b.disabled = false; toast(e.message); }
}
function apDecideSheet(id, ok) {
  const a = (S.db.approvals || []).find(x => x.id === id); if (!a) return;
  openSheet(`<h2 id="sheet-title">${ok ? "Approve" : "Reject"}: ${esc(a.title)}</h2>
  <form data-form="ap-decide" data-id="${id}" data-ok="${ok ? 1 : 0}"><div class="field"><label for="ap-note">${ok ? "Note (optional)" : "Reason"}</label><textarea class="inp" id="ap-note" rows="3" maxlength="1000" ${ok ? "" : "required"} placeholder="${ok ? "e.g. Approved, enjoy the break" : "e.g. Please add the quotation"}"></textarea></div>
  <div class="sheet-actions"><button type="button" class="btn ghost" data-action="close-sheet">Back</button><button class="btn ${ok ? "" : "danger"}" type="submit">${ok ? "Approve" : "Reject"}</button></div></form>`);
}
async function apAction(act, a) {
  const row = (S.db.approvals || []).find(x => x.id === a.dataset.id);
  switch (act) {
    case "ap-tab": U.apTab = a.dataset.v; render(); return;
    case "ap-new": closeSheet(); setTimeout(() => apSheet(a.dataset.task), 10); return;
    case "ap-kind": a.parentElement.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === a)); return;
    case "ap-approve": apDecideSheet(a.dataset.id, true); return;
    case "ap-reject": apDecideSheet(a.dataset.id, false); return;
    case "ap-cancel": if (row) { try { await update("approvals", row, { status: "cancelled" }); toast("Request cancelled."); } catch (e) { toast(e.message); } } return;
  }
}

/* ================= Weekly report ================= */
function weekData(offset = 0) {
  const end = addDays(new Date(), -7 * offset), start = addDays(end, -6), sk = dkey(start), ek = dkey(end), nk = dkey(addDays(end, 7));
  const inWs = S.db.tasks;
  const doneIn = inWs.filter(t => t.completed_at && dkey(new Date(t.completed_at)) >= sk && dkey(new Date(t.completed_at)) <= ek);
  const mineOnly = t => !isTeam() || t.assignee_id === me() || (!t.assignee_id && t.created_by === me());
  const overdue = inWs.filter(t => !E.isDone(t) && t.due_date && t.due_date < dkey());
  const late = doneIn.filter(t => t.due_date && dkey(new Date(t.completed_at)) > t.due_date);
  const next = inWs.filter(t => !E.isDone(t) && t.due_date && t.due_date > ek && t.due_date <= nk).sort((a, b) => (a.due_date + (a.due_time || "")).localeCompare(b.due_date + (b.due_time || "")));
  const focusMin = S.db.focus_sessions.filter(f => f.day >= sk && f.day <= ek).reduce((x, f) => x + (f.minutes || 0), 0);
  const byArea = {}; doneIn.forEach(t => { byArea[t.area || "Other"] = (byArea[t.area || "Other"] || 0) + 1; });
  const byPerson = {}; if (isTeam()) doneIn.forEach(t => { const u = t.assignee_id || t.created_by; byPerson[u] = (byPerson[u] || 0) + 1; });
  const onTime = doneIn.filter(t => t.due_date).length ? Math.round(100 * (1 - late.length / doneIn.filter(t => t.due_date).length)) : null;
  const tEnt = (S.db.time_entries || []).filter(e => e.ended_at && dkey(new Date(e.started_at)) >= sk && dkey(new Date(e.started_at)) <= ek);
  const tracked = tEnt.reduce((x, e) => x + (e.minutes || 0), 0), byTask = {};
  tEnt.forEach(e => { const k = e.task_id || "-"; byTask[k] = (byTask[k] || 0) + (e.minutes || 0); });
  return { start, end, sk, ek, doneIn, overdue, late, next, focusMin, byArea, byPerson, onTime, mineOnly, tracked, byTask };
}
function vReport() {
  const off = U.repOff || 0, d = weekData(off), f = x => x.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const list = (ts, empty, showDue) => ts.length ? `<div class="list">${ts.slice(0, 12).map(t => `<div class="rep-row" data-action="open-task" data-id="${t.id}"><span>${esc(t.title)}</span><small>${showDue ? esc(dueLabel(t)) : t.completed_at ? esc(new Date(t.completed_at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })) : ""}${isTeam() ? ` · ${esc(nameOf(t.assignee_id || t.created_by).split(" ")[0])}` : ""}</small></div>`).join("")}${ts.length > 12 ? `<p class="muted" style="font-size:13px;margin:6px 2px 0">…and ${ts.length - 12} more in the PDF</p>` : ""}</div>` : `<p class="muted" style="margin:0">${empty}</p>`;
  return `<div class="view-h"><div><h1>Weekly report</h1><p>${f(d.start)} – ${f(d.end)} · ${esc(ws()?.name || "")}</p></div><button class="btn" data-action="rep-pdf">⬇ PDF</button></div>
  <div class="seg" style="margin-bottom:14px">${[[0, "Last 7 days"], [1, "Week before"], [2, "2 weeks before"]].map(([k, l]) => `<button class="${off === k ? "on" : ""}" data-action="rep-off" data-v="${k}">${l}</button>`).join("")}</div>
  <div class="grid g-stats" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-bottom:14px">
    <div class="card stat" style="--c:var(--green)"><div class="k"><i></i>Done</div><div class="v num">${d.doneIn.length}</div><div class="s">${d.onTime == null ? "tasks finished" : `${d.onTime}% on time`}</div></div>
    <div class="card stat" style="--c:var(--red)"><div class="k"><i></i>Overdue now</div><div class="v num">${d.overdue.length}</div><div class="s">still open</div></div>
    <div class="card stat" style="--c:var(--gold)"><div class="k"><i></i>Finished late</div><div class="v num">${d.late.length}</div><div class="s">after the due date</div></div>
    <div class="card stat" style="--c:var(--accent)"><div class="k"><i></i>Time tracked</div><div class="v num">${Math.floor((d.tracked + d.focusMin) / 60)}h ${(d.tracked + d.focusMin) % 60}m</div><div class="s">timers ${durTxt(d.tracked) || "0m"} · focus ${durTxt(d.focusMin) || "0m"}</div></div>
  </div>
  <div class="grid g-2">
    <div class="card"><div class="card-h"><h2>✅ Done</h2></div>${list(d.doneIn.sort((a, b) => a.completed_at.localeCompare(b.completed_at)), "Nothing finished in this week.")}</div>
    <div class="grid" style="gap:14px;align-content:start">
      <div class="card"><div class="card-h"><h2>⚠️ Overdue</h2></div>${list(d.overdue.sort((a, b) => a.due_date.localeCompare(b.due_date)), "Nothing overdue. 👏", true)}</div>
      <div class="card"><div class="card-h"><h2>➡️ Coming up next week</h2></div>${list(d.next, "Nothing scheduled yet.", true)}</div>
      ${Object.keys(d.byTask).length ? `<div class="card"><div class="card-h"><h2>⏱ Time by task</h2></div>${Object.entries(d.byTask).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, m]) => `<div class="rep-row" ${task(id) ? `data-action="open-task" data-id="${id}"` : ""}><span>${esc(task(id)?.title || "Other")}</span><b>${durTxt(m)}</b></div>`).join("")}</div>` : ""}
      ${Object.keys(d.byPerson).length ? `<div class="card"><div class="card-h"><h2>👥 Done by person</h2></div>${Object.entries(d.byPerson).sort((a, b) => b[1] - a[1]).map(([u, n]) => `<div class="rep-row"><span>${esc(nameOf(u))}</span><b>${n}</b></div>`).join("")}</div>` : ""}
    </div>
  </div>`;
}
async function savePdf(r, name, title) {
  const blob = r.blob(), file = new File([blob], name, { type: "application/pdf" });
  if (navigator.canShare?.({ files: [file] }) && matchMedia("(pointer:coarse)").matches) { try { await navigator.share({ files: [file], title }); return; } catch (e) { if (e?.name === "AbortError") return; } }
  const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast("PDF downloaded.");
}
async function reportPdf() {
  const { Report } = await import("./pdf.js");
  const d = weekData(U.repOff || 0), f = x => x.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }), who = t => nameOf(t.assignee_id || t.created_by);
  const r = new Report({ title: "Weekly report", subtitle: `${f(d.start)} – ${f(d.end)} · ${ws()?.name || ""} · ${nameOf(me())}`, footer: "TaskerBay · taskerbay.com" });
  r.heading("Summary");
  r.boxes([["Done", String(d.doneIn.length), [22, 140, 80]], ["On time", d.onTime == null ? "-" : d.onTime + "%"], ["Finished late", String(d.late.length), [170, 120, 0]], ["Overdue now", String(d.overdue.length), [200, 40, 40]], ["Due next week", String(d.next.length)], ["Time tracked", `${Math.floor((d.tracked + d.focusMin) / 60)}h ${(d.tracked + d.focusMin) % 60}m`]]);
  const dt = k => k ? parseKey(k).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "-";
  const cols = isTeam() ? [{ h: "Task", w: .5, bold: true }, { h: "Person", w: .2 }, { h: "Due", w: .15 }, { h: "Done", w: .15 }] : [{ h: "Task", w: .64, bold: true }, { h: "Due", w: .18 }, { h: "Done", w: .18 }];
  const rowOf = t => isTeam() ? [t.title, who(t), dt(t.due_date), t.completed_at ? dt(dkey(new Date(t.completed_at))) : ""] : [t.title, dt(t.due_date), t.completed_at ? dt(dkey(new Date(t.completed_at))) : ""];
  r.heading("Done this week");
  if (d.doneIn.length) r.table(cols, d.doneIn.map(rowOf), { rowColor: (row, i) => d.late.includes(d.doneIn[i]) ? [170, 120, 0] : null }); else r.note("Nothing finished in this week.");
  if (d.late.length) r.note("Rows in amber were finished after their due date.");
  r.heading("Overdue (still open)");
  if (d.overdue.length) r.table(cols, d.overdue.map(rowOf), { rowColor: () => [200, 40, 40] }); else r.note("Nothing overdue.");
  r.heading("Coming up next week");
  if (d.next.length) r.table(cols, d.next.map(rowOf)); else r.note("Nothing scheduled yet.");
  if (Object.keys(d.byArea).length) { r.heading("Done by area"); r.table([{ h: "Area", w: .7, bold: true }, { h: "Tasks", w: .3, align: "right" }], Object.entries(d.byArea).sort((a, b) => b[1] - a[1]).map(([a, n]) => [a, String(n)])); }
  if (Object.keys(d.byTask).length) { r.heading("Time by task"); r.table([{ h: "Task", w: .75, bold: true }, { h: "Time", w: .25, align: "right" }], Object.entries(d.byTask).sort((a, b) => b[1] - a[1]).map(([id, m]) => [task(id)?.title || "Other", durTxt(m)])); }
  if (Object.keys(d.byPerson).length) { r.heading("Done by person"); r.table([{ h: "Person", w: .7, bold: true }, { h: "Tasks", w: .3, align: "right" }], Object.entries(d.byPerson).sort((a, b) => b[1] - a[1]).map(([u, n]) => [nameOf(u), String(n)])); }
  await savePdf(r, `weekly-report-${d.ek}.pdf`, "Weekly report");
}

/* ================= Activity log ================= */
const ACT_KINDS = [["", "All"], ["task", "Tasks"], ["approval", "Approvals"], ["fund", "Money"], ["member", "Team"], ["account", "Accounts"]];
function vActivity() {
  if (S.mode !== "cloud") return `<div class="view-h"><div><h1>Activity log</h1><p>Who changed what, and when</p></div></div>${emptyBox("Recorded on the live site", "Every change to tasks, approvals, money and accounts is logged automatically once you use your own account.")}`;
  const k = U.actKind || "";
  if (!U.act || U.act.kind !== k) { U.act = { kind: k, rows: null, more: true }; api.auditLog({ kind: k || null }).then(rows => { if (U.act?.kind === k) { U.act.rows = rows; U.act.more = rows.length === 100; render(); } }, e => { U.act.rows = []; U.act.err = e.message; render(); }); }
  const rows = U.act.rows, ic = { task: "✅", approval: "📝", fund: "💰", member: "👥", account: "🔑" };
  let last = "";
  return `<div class="view-h"><div><h1>Activity log</h1><p>Who changed what, and when. Kept for a year.</p></div></div>
  <div class="seg wrap" style="margin-bottom:14px">${ACT_KINDS.map(([v, l]) => `<button class="${k === v ? "on" : ""}" data-action="act-kind" data-v="${v}">${l}</button>`).join("")}</div>
  <div class="card">${!rows ? `<p class="muted" style="margin:0">Loading…</p>` : U.act.err ? `<p class="muted" style="margin:0">${esc(U.act.err)}</p>` : !rows.length ? `<p class="muted" style="margin:0">Nothing recorded yet.</p>` :
    rows.map(r => { const day = new Date(r.at).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }); const h = day !== last ? `<div class="act-day">${day}</div>` : ""; last = day;
      return `${h}<div class="act-row"><span class="act-ic">${ic[r.kind] || "•"}</span><div><p>${esc(r.summary)}</p><small>${esc(r.actor_id ? nameOf(r.actor_id) : "TaskerBay")} · ${new Date(r.at).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" })}</small></div></div>`; }).join("")}
  ${rows && U.act.more ? `<button class="btn ghost" data-action="act-more" style="margin-top:10px;width:100%">Show older</button>` : ""}</div>`;
}
async function actMore() {
  const rows = U.act?.rows; if (!rows?.length) return;
  const more = await api.auditLog({ kind: U.act.kind || null, before: rows[rows.length - 1].at }); U.act.rows = rows.concat(more); U.act.more = more.length === 100; render();
}

/* ================= Admin dashboard ================= */
function vAdmin() {
  if (!U.isAdmin) return emptyBox("Admins only", "");
  if (U.adm === undefined) { U.adm = null; api.rpc("admin_overview").then(r => { U.adm = r || []; render(); }, e => { U.adm = { err: e.message }; render(); }); }
  const A = U.adm;
  if (!A) return `<div class="view-h"><div><h1>Admin</h1></div></div><p class="muted">Loading…</p>`;
  if (A.err) return `<div class="view-h"><div><h1>Admin</h1></div></div><p class="muted">${esc(A.err)}</p>`;
  const now = Date.now(), week = now - 7 * 864e5, soon = now + 3 * 864e5;
  const active = A.filter(u => u.last_active && new Date(u.last_active) > week).length;
  const trials = A.filter(u => u.access_until && new Date(u.access_until) > now);
  const ending = trials.filter(u => new Date(u.access_until) < soon);
  const waiting = A.filter(u => !u.approved);
  const ago = t => t ? timeAgo(t) : "never";
  return `<div class="view-h"><div><h1>Admin</h1><p>Everyone with a TaskerBay account</p></div><button class="btn ghost" data-action="adm-refresh">↻ Refresh</button></div>
  <div class="grid g-stats" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-bottom:14px">
    <div class="card stat" style="--c:var(--accent)"><div class="k"><i></i>People</div><div class="v num">${A.filter(u => u.approved).length}</div><div class="s">${waiting.length} waiting for approval</div></div>
    <div class="card stat" style="--c:var(--green)"><div class="k"><i></i>Active this week</div><div class="v num">${active}</div><div class="s">signed in or made changes</div></div>
    <div class="card stat" style="--c:var(--gold)"><div class="k"><i></i>On trial</div><div class="v num">${trials.length}</div><div class="s">${ending.length} ending in 3 days</div></div>
    <div class="card stat" style="--c:var(--red)"><div class="k"><i></i>2-step sign-in</div><div class="v num">${A.filter(u => u.mfa).length}/${A.filter(u => u.approved).length}</div><div class="s">accounts protected</div></div>
  </div>
  <div class="card"><div class="card-h"><h2>People</h2><button class="link" data-go="settings">Manage access</button></div>
  <div class="adm-list">${A.map(u => `<div class="adm-row">
    <div class="adm-who"><b>${esc(u.full_name || u.email)}</b>${u.is_admin ? ` <span class="chip">Admin</span>` : ""}<small>${esc(u.email || "")}</small></div>
    <div class="adm-tags">${!u.approved ? `<span class="chip warn">Waiting</span>` : !u.is_admin && !u.activated_at ? `<span class="chip warn">Not activated</span>` : u.access_until ? (new Date(u.access_until) > now ? `<span class="chip ${new Date(u.access_until) < soon ? "warn" : ""}">Trial to ${esc(fmtWhen(u.access_until))}</span>` : `<span class="chip bad">Trial ended</span>`) : `<span class="chip ok">Permanent</span>`}${u.mfa ? `<span class="chip ok">🔐 2-step</span>` : ""}${u.email_digest && u.email_digest !== "off" ? `<span class="chip">☀️ Email</span>` : ""}</div>
    <div class="adm-nums"><span><b>${u.open_tasks}</b> open</span><span><b>${u.done_7d}</b> done 7d</span><span class="${u.overdue ? "red" : ""}"><b>${u.overdue}</b> overdue</span><span>Last seen ${esc(ago(u.last_active))}</span></div>
  </div>`).join("")}</div></div>`;
}

/* ================= Region: working week + public holidays ================= */
const holPrefs = () => profile(me())?.holiday_prefs || (() => { try { return JSON.parse(localStorage.getItem("tb.holprefs") || "{}"); } catch (e) { return {}; } })();
function myRegion() {
  const p = profile(me()) || {}; let c = p.region; try { c = c || localStorage.getItem("tb.region"); } catch (e) {}
  c = c || CAL.guessCountry();
  const work = p.work_days?.length ? p.work_days : (() => { try { return JSON.parse(localStorage.getItem("tb.workdays") || "null"); } catch (e) { return null; } })() || CAL.defaultWorkDays(c);
  return { c, work };
}
const holBase = {}; // "AE:2026" -> [{date,name,expected}]
async function baseHolidays(c, y) {
  const k = `${c}:${y}`; if (holBase[k]) return holBase[k];
  const built = CAL.builtInHolidays(c, y); if (built) return (holBase[k] = built);
  try { const c0 = JSON.parse(localStorage.getItem("tb.hol." + k) || "null"); if (c0 && Date.now() - c0.t < 7 * 864e5) return (holBase[k] = c0.list); } catch (e) {}
  if (S.mode !== "cloud") return (holBase[k] = []);
  try { const r = await api.holidays(c, y); holBase[k] = r.holidays || []; holBase[k].available = r.available; try { localStorage.setItem("tb.hol." + k, JSON.stringify({ t: Date.now(), list: holBase[k] })); } catch (e) {} }
  catch (e) { holBase[k] = []; }
  return holBase[k];
}
async function loadCalendar() {
  const { c, work } = myRegion(), y = new Date().getFullYear();
  E.CAL.country = c; E.CAL.work = new Set(work);
  const base = [...await baseHolidays(c, y), ...await baseHolidays(c, y + 1)];
  E.CAL.off = CAL.mergeHolidays(base, holPrefs());
}
async function saveRegion(patch) {
  const pr = profile(me());
  if (patch.region) try { localStorage.setItem("tb.region", patch.region); } catch (e) {}
  if (patch.work_days) try { localStorage.setItem("tb.workdays", JSON.stringify(patch.work_days)); } catch (e) {}
  if (patch.holiday_prefs) try { localStorage.setItem("tb.holprefs", JSON.stringify(patch.holiday_prefs)); } catch (e) {}
  if (pr) localUpsert("profiles", { ...pr, ...patch });
  if (S.mode === "cloud") await api.updateProfile(patch);
  await loadCalendar(); render();
}
function regionCard() {
  const { c, work } = myRegion(), y = U.holYear || new Date().getFullYear(), prefs = holPrefs(), off = new Set(prefs.off || []);
  const base = holBase[`${c}:${y}`];
  if (!base) baseHolidays(c, y).then(() => render());
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], order = [1, 2, 3, 4, 5, 6, 0];
  const mine = (prefs.add || []).filter(h => h.date.startsWith(String(y)));
  const fd = k => parseKey(k).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return `<div class="card"><div class="card-h"><h2>🌍 Region &amp; working days</h2></div>
    <p class="muted" style="margin:0 0 10px;font-size:14px">Your country's weekend and public holidays are skipped by working-day repeats, templates, “next working day” and Free time.</p>
    <div class="field"><label for="rg-c">Country</label><select class="inp" id="rg-c">${CAL.COUNTRIES.map(([k, n]) => `<option value="${k}" ${k === c ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></div>
    <div class="field"><span class="lab">Working days</span><div class="seg wrap">${order.map(d => `<button class="${work.includes(d) ? "on" : ""}" data-action="rg-day" data-v="${d}">${days[d]}</button>`).join("")}</div></div>
    <div class="hol-h"><b>Public holidays ${y}</b><span><button class="link" data-action="rg-year" data-v="${y - 1}">‹ ${y - 1}</button> <button class="link" data-action="rg-year" data-v="${y + 1}">${y + 1} ›</button></span></div>
    ${!base ? `<p class="muted">Loading…</p>` : !base.length && !mine.length ? `<p class="muted" style="font-size:13.5px">${base.available === false ? `We don't have a public holiday list for ${esc(CAL.countryName(c))} yet. Add your days off below.` : "No public holidays found."}</p>` :
      `<div class="hol-list">${base.map(h => `<label class="hol ${off.has(h.date) ? "off" : ""}"><input type="checkbox" data-hol="${h.date}" ${off.has(h.date) ? "" : "checked"}><span class="d">${fd(h.date)}</span><span>${esc(h.name)}${h.expected ? ` <small class="muted">expected</small>` : ""}</span></label>`).join("")}
       ${mine.map(h => `<div class="hol mine"><span class="d">${fd(h.date)}</span><span>${esc(h.name)} <small class="muted">your day off</small></span><button class="link danger-t" data-action="rg-del" data-v="${h.date}">Remove</button></div>`).join("")}</div>`}
    ${base?.some(h => h.expected) ? `<p class="muted" style="font-size:12.5px;margin:8px 0 0">“Expected” dates follow the moon sighting and can move by a day. Untick a day that isn't off, or add the official one below.</p>` : ""}
    ${CAL.countryNote(c) ? `<p class="muted" style="font-size:12.5px;margin:8px 0 0">${esc(CAL.countryNote(c))}</p>` : ""}
    <form data-form="rg-add" class="hol-add"><input class="inp" type="date" id="rg-date" required aria-label="Date"><input class="inp" id="rg-name" placeholder="e.g. Company holiday" maxlength="60" aria-label="Name"><button class="btn ghost" type="submit">Add day off</button></form>
  </div>`;
}
async function regionAction(act, a) {
  const { work } = myRegion(), prefs = { off: [], add: [], ...holPrefs() };
  if (act === "rg-day") { const d = +a.dataset.v, set = new Set(work); set.has(d) ? set.delete(d) : set.add(d); if (!set.size) return toast("Keep at least one working day."); await saveRegion({ work_days: [...set].sort() }); return; }
  if (act === "rg-year") { U.holYear = +a.dataset.v; render(); return; }
  if (act === "rg-del") { prefs.add = prefs.add.filter(h => h.date !== a.dataset.v); await saveRegion({ holiday_prefs: prefs }); toast("Removed."); }
}

/* ================= Dependencies ================= */
const waitingOn = t => (t.blocked_by || []).map(id => task(id)).filter(x => x && !E.isDone(x));
const blocksOthers = t => S.db.tasks.filter(x => (x.blocked_by || []).includes(t.id) && !E.isDone(x));
function depsField(t) {
  const w = (t.blocked_by || []).map(id => task(id)).filter(Boolean), after = blocksOthers(t);
  const cand = S.db.tasks.filter(x => x.id !== t.id && !E.isDone(x) && !(t.blocked_by || []).includes(x.id) && !(x.blocked_by || []).includes(t.id) && x.parent_id !== t.id).sort((a, b) => (a.due_date || "9").localeCompare(b.due_date || "9")).slice(0, 200);
  return `<div class="field deps"><span class="lab">Waiting on</span>
    ${w.length ? `<div class="dep-list">${w.map(x => `<span class="dep ${E.isDone(x) ? "ok" : ""}"><button class="link" data-action="open-task" data-id="${x.id}">${E.isDone(x) ? "✅" : "🔒"} ${esc(x.title)}</button>${x.due_date && t.due_date && x.due_date > t.due_date && !E.isDone(x) ? ` <small class="red">due after this one</small>` : ""}<button class="x" data-action="dep-del" data-id="${t.id}" data-v="${x.id}" aria-label="Remove">×</button></span>`).join("")}</div>` : ""}
    ${cand.length ? `<select class="inp" id="dep-add" data-id="${t.id}"><option value="">${w.length ? "Add another task it waits on…" : "Can't start until another task is done? Pick it…"}</option>${cand.map(x => `<option value="${x.id}">${esc(x.title.slice(0, 70))}${x.due_date ? ` · ${esc(dueLabel(x))}` : ""}</option>`).join("")}</select>` : ""}
    ${after.length ? `<p class="muted" style="font-size:12.5px;margin:6px 0 0">Holding up: ${after.map(x => `<button class="link" data-action="open-task" data-id="${x.id}">${esc(x.title)}</button>`).join(", ")}</p>` : ""}</div>`;
}
async function depSet(t, list) { try { await E.changeTask(t, { blocked_by: list }); } catch (e) { toast(e.message); } }

/* ================= Time tracking ================= */
const runningEntry = () => (S.db.time_entries || []).find(e => e.user_id === me() && !e.ended_at) || null;
const trackedMin = id => (S.db.time_entries || []).filter(e => e.task_id === id).reduce((s, e) => s + (e.ended_at ? e.minutes || 0 : Math.round((Date.now() - new Date(e.started_at)) / 6e4)), 0);
function timeField(t) {
  const run = runningEntry(), mine = run?.task_id === t.id, tot = trackedMin(t.id);
  const ents = (S.db.time_entries || []).filter(e => e.task_id === t.id && e.ended_at).slice(0, 5);
  return `<div class="field time-f"><span class="lab">Time spent${tot ? ` · ${durTxt(tot)}` : ""}</span>
    <div class="time-btns">${mine ? `<button class="btn danger" data-action="tm-stop">⏹ Stop timer</button>` : `<button class="btn ghost" data-action="tm-start" data-id="${t.id}">▶ Start timer</button>`}
    <form data-form="tm-add" data-id="${t.id}" class="tm-add"><input class="inp" id="tm-min" inputmode="numeric" placeholder="min" aria-label="Minutes" maxlength="4"><button class="btn ghost" type="submit">Add time</button></form></div>
    ${ents.length ? `<div class="tm-list">${ents.map(e => `<span>${esc(new Date(e.started_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }))} · ${durTxt(e.minutes || 0)}${e.user_id !== me() ? ` · ${esc(nameOf(e.user_id).split(" ")[0])}` : ""}${e.user_id === me() ? `<button class="x" data-action="tm-del" data-v="${e.id}" aria-label="Delete">×</button>` : ""}</span>`).join("")}</div>` : ""}</div>`;
}
async function tmStart(taskId) {
  const run = runningEntry(); if (run) await tmStop(true);
  const t = task(taskId);
  await insert("time_entries", { id: uuid(), user_id: me(), workspace_id: t?.workspace_id || S.wsId, task_id: taskId, started_at: new Date().toISOString(), ended_at: null, minutes: null, note: "", created_at: new Date().toISOString() });
  toast("Timer started."); render();
}
async function tmStop(quiet) {
  const run = runningEntry(); if (!run) return;
  const min = Math.max(1, Math.min(1440, Math.round((Date.now() - new Date(run.started_at)) / 6e4)));
  await update("time_entries", run, { ended_at: new Date().toISOString(), minutes: min });
  if (!quiet) toast(`Logged ${durTxt(min)}${run.task_id && task(run.task_id) ? ` on “${task(run.task_id).title}”` : ""}.`); render();
}
function timerPill() {
  const r = runningEntry(); if (!r) return "";
  const t = r.task_id ? task(r.task_id) : null, sec = Math.max(0, Math.floor((Date.now() - new Date(r.started_at)) / 1000));
  const hh = String(Math.floor(sec / 3600)).padStart(2, "0"), mm = String(Math.floor(sec / 60) % 60).padStart(2, "0"), ss = String(sec % 60).padStart(2, "0");
  return `<div class="timer-pill"><button class="tp-main" ${t ? `data-action="open-task" data-id="${t.id}"` : ""}><span class="dot"></span><b class="num" id="tp-clock">${hh}:${mm}:${ss}</b><span class="tp-t">${esc(t?.title || "Timer")}</span></button><button class="tp-stop" data-action="tm-stop" aria-label="Stop timer">⏹</button></div>`;
}
setInterval(() => { const el = document.getElementById("tp-clock"), r = runningEntry(); if (!el || !r) return; const sec = Math.max(0, Math.floor((Date.now() - new Date(r.started_at)) / 1000)); el.textContent = `${String(Math.floor(sec / 3600)).padStart(2, "0")}:${String(Math.floor(sec / 60) % 60).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`; }, 1000);

/* ================= Timeline ================= */
function vTimeline() {
  const span = U.tlSpan || 28, start = addDays(parseKey(dkey()), -(U.tlBack ?? 3)), days = [...Array(span)].map((_, i) => addDays(start, i)), sk = dkey(days[0]), ek = dkey(days[span - 1]);
  const ts = S.db.tasks.filter(t => !E.isDone(t) && (t.due_date || t.start_date) && ((t.start_date || t.due_date) <= ek) && ((t.due_date || t.start_date) >= sk))
    .sort((a, b) => ((a.start_date || a.due_date) + (a.due_time || "")).localeCompare((b.start_date || b.due_date) + (b.due_time || "")));
  const W = 34, idx = k => Math.round((parseKey(k) - days[0]) / 864e5);
  const head = days.map(d => { const k = dkey(d), off = !E.isWorkday(d), hol = E.holidayOn(k); return `<div class="tl-d ${k === dkey() ? "today" : ""} ${off ? "off" : ""}" title="${hol ? esc(hol.name) : ""}"><small>${d.toLocaleDateString("en-GB", { weekday: "narrow" })}</small><b>${d.getDate()}</b>${hol ? "<i>🎉</i>" : ""}</div>`; }).join("");
  const rows = ts.map(t => {
    const a = Math.max(0, idx(t.start_date && t.start_date < (t.due_date || t.start_date) ? t.start_date : (t.due_date || t.start_date))), b = Math.min(span - 1, idx(t.due_date || t.start_date));
    const w = waitingOn(t), late = w.some(x => x.due_date && t.start_date ? x.due_date > t.start_date : x.due_date && t.due_date && x.due_date > t.due_date);
    return `<div class="tl-row"><button class="tl-name" data-action="open-task" data-id="${t.id}">${w.length ? "🔒 " : ""}${esc(t.title)}<small>${isTeam() ? esc(nameOf(t.assignee_id || t.created_by).split(" ")[0]) + " · " : ""}${esc(dueLabel(t))}</small></button>
      <div class="tl-track" style="width:${span * W}px">${days.map((d, i) => !E.isWorkday(d) ? `<i class="tl-off" style="left:${i * W}px;width:${W}px"></i>` : "").join("")}
      <span class="tl-bar ${E.dueStatus(t)} ${late ? "clash" : ""}" style="left:${a * W + 3}px;width:${Math.max(1, b - a + 1) * W - 6}px;--p:${PRI_C[t.priority]}" title="${esc(t.title)}${w.length ? ` · waiting on ${esc(w.map(x => x.title).join(", "))}` : ""}"></span></div></div>`;
  }).join("");
  return `<div class="view-h"><div><h1>Timeline</h1><p>Open tasks with dates, laid out by day. 🔒 = waiting on another task; red outline = it waits on something due later.</p></div></div>
  <div class="seg" style="margin-bottom:12px">${[[14, "2 weeks"], [28, "4 weeks"], [56, "8 weeks"]].map(([v, l]) => `<button class="${span === v ? "on" : ""}" data-action="tl-span" data-v="${v}">${l}</button>`).join("")}</div>
  ${ts.length ? `<div class="card tl-card"><div class="tl-scroll"><div class="tl-grid" style="--w:${W}px"><div class="tl-row tl-head"><div class="tl-name"></div><div class="tl-track" style="width:${span * W}px;display:flex">${head}</div></div>${rows}</div></div>
  <p class="muted" style="font-size:12.5px;margin:10px 0 0">Give a task a <b>start date</b> (in the task) to show it as a bar across several days.</p></div>` : emptyBox("Nothing to show", "Tasks with a due or start date in this period appear here.")}`;
}

/* ================= Auto-schedule ================= */
function planWeek() {
  const today = dkey(), cand = S.db.tasks.filter(t => !E.isDone(t) && (t.assignee_id === me() || (!t.assignee_id && t.created_by === me())) && !E.childrenOf(t.id).some(k => !E.isDone(k)) && !waitingOn(t).length && (!t.due_time) && (!t.due_date || t.due_date <= dkey(addDays(new Date(), 6))));
  const pr = { High: 0, Medium: 1, Low: 2 };
  cand.sort((a, b) => (a.due_date && a.due_date < today ? 0 : 1) - (b.due_date && b.due_date < today ? 0 : 1) || (b.starred ? 1 : 0) - (a.starred ? 1 : 0) || pr[a.priority] - pr[b.priority] || (a.due_date || "9").localeCompare(b.due_date || "9"));
  const days = []; for (let i = 0; days.length < 5 && i < 21; i++) { const d = addDays(new Date(), i); if (E.isWorkday(d)) days.push(dkey(d)); }
  const gaps = Object.fromEntries(days.map(k => [k, freeSlots(k).gaps.map(g => [...g]).filter(([a, b]) => b - a >= 15)]));
  const out = [];
  for (const t of cand) {
    const need = Math.max(10, t.estimate_min || 30), latest = t.due_date && t.due_date >= today ? t.due_date : null;
    let placed = null;
    for (const k of days) {
      if (latest && k > latest && out.length) { /* allow after due only if nothing earlier fits */ }
      const g = gaps[k].find(([a, b]) => b - a >= need);
      if (g) { placed = { k, s: g[0] }; g[0] += need + 5; break; }
    }
    if (placed) out.push({ t, k: placed.k, s: placed.s, need, late: latest && placed.k > latest });
  }
  return { out, skipped: cand.length - out.length, days };
}
function planSheet() {
  const { out, skipped, days } = planWeek();
  if (!out.length) { toast(skipped ? "No free slots left in your next working days." : "Nothing to schedule: tasks already have times, or none are due soon."); return; }
  U.plan2 = out;
  openSheet(`<h2 id="sheet-title">✨ Plan my week</h2><p class="muted" style="margin:-4px 0 10px;font-size:14px">${out.length} task${out.length > 1 ? "s" : ""} fitted into your free time over the next ${days.length} working days, most urgent first. Untick any you don't want.</p>
  <form data-form="plan2"><div class="plan2">${out.map((p, i) => `<label class="p2 ${p.late ? "late" : ""}"><input type="checkbox" checked data-i="${i}"><span class="d">${esc(parseKey(p.k).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" }))}<br><b>${fmt12(p.s)}</b></span><span>${esc(p.t.title)}<small>${durTxt(p.need)}${p.t.due_date ? ` · was due ${esc(dueLabel(p.t))}` : ""}${p.late ? " · after its due date" : ""}</small></span></label>`).join("")}</div>
  ${skipped ? `<p class="muted" style="font-size:12.5px">${skipped} more didn't fit. Free up time or plan again tomorrow.</p>` : ""}
  <p class="muted" style="font-size:12.5px">Tasks without a “Takes” time count as 30 minutes. Tasks waiting on others are skipped.</p>
  <div class="sheet-actions"><button type="button" class="btn ghost" data-action="close-sheet">Cancel</button><button class="btn" type="submit">Schedule them</button></div></form>`, "wide");
}

/* ================= Escalation rules ================= */
const ESC_KIND = { task_overdue: "a task is overdue", task_no_update: "a task has no update", approval_waiting: "an approval is still waiting" };
function escCard() {
  if (!isTeam()) return "";
  const admin = E.canAdmin?.() ?? (ws()?.owner_id === me() || S.db.workspace_members.some(m => m.user_id === me() && /owner|admin/.test(m.role)));
  const rules = S.db.escalation_rules || [], people = S.db.workspace_members.map(m => m.user_id);
  const who = r => r.notify === "owner" ? (r.kind === "approval_waiting" ? "the approver" : "the owner") : r.notify === "creator" ? (r.kind === "approval_waiting" ? "the person who asked" : "whoever created it") : nameOf(r.person_id);
  const hrs = h => h % 24 === 0 ? `${h / 24} day${h / 24 > 1 ? "s" : ""}` : `${h} hour${h > 1 ? "s" : ""}`;
  return `<div class="card"><div class="card-h"><h2>🚨 Escalation rules</h2><span class="sub">${esc(ws()?.name || "")}</span></div>
    <p class="muted" style="margin:0 0 10px;font-size:14px">Alert someone when work stalls. Each item is escalated once per rule, with a popup and an inbox note.</p>
    ${rules.length ? `<div class="esc-list">${rules.map(r => `<div class="esc ${r.active ? "" : "off"}"><span>If ${ESC_KIND[r.kind]}${r.high_only ? " (high priority)" : ""} for more than <b>${hrs(r.hours)}</b> → alert <b>${esc(who(r))}</b></span>${admin ? `<span class="esc-b"><button class="link" data-action="esc-toggle" data-id="${r.id}">${r.active ? "Pause" : "Resume"}</button><button class="link danger-t" data-action="esc-del" data-id="${r.id}">Delete</button></span>` : ""}</div>`).join("")}</div>` : `<p class="muted" style="font-size:13.5px">No rules yet.</p>`}
    ${admin ? `<form data-form="esc-add" class="esc-form"><span>If</span><select class="inp" id="esc-kind">${Object.entries(ESC_KIND).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select><span>for more than</span>
      <input class="inp" id="esc-n" inputmode="numeric" value="1" style="width:64px" aria-label="How long"><select class="inp" id="esc-u" style="width:auto"><option value="24">days</option><option value="1">hours</option></select>
      <span>alert</span><select class="inp" id="esc-who"><option value="owner">the owner / approver</option><option value="creator">the creator / requester</option>${people.map(u => `<option value="p:${u}">${esc(nameOf(u))}</option>`).join("")}</select>
      <label class="tog"><input type="checkbox" id="esc-high"> High priority only</label><button class="btn" type="submit">Add rule</button></form>` : `<p class="muted" style="font-size:12.5px">Only workspace admins can change rules.</p>`}
  </div>`;
}

/* ================= Morning email ================= */
function digestCard() {
  if (S.mode !== "cloud") return "";
  const p = profile(me()) || {}, mode = p.email_digest || "off", hr = p.email_digest_hour ?? 7;
  const hl = h => `${h % 12 || 12}:00 ${h < 12 ? "AM" : "PM"}`;
  return `<div class="card"><div class="card-h"><h2>☀️ Morning email</h2></div>
    <p class="muted" style="margin:0 0 10px;font-size:14px">A short email each morning with what's due today, what's overdue, the week ahead and anything waiting for your approval. Days with nothing due are skipped.</p>
    <div class="seg" role="group" aria-label="Morning email">${[["off", "Off"], ["weekdays", "Mon–Fri"], ["daily", "Every day"]].map(([v, l]) => `<button class="${mode === v ? "on" : ""}" data-action="dg-mode" data-v="${v}">${l}</button>`).join("")}</div>
    ${mode !== "off" ? `<div class="field" style="margin-top:12px"><label for="dg-hour">Send at</label><select class="inp" id="dg-hour">${[5, 6, 7, 8, 9, 10].map(h => `<option value="${h}" ${h === hr ? "selected" : ""}>${hl(h)}</option>`).join("")}</select></div>` : ""}
    <button class="btn ghost" data-action="dg-test" style="margin-top:12px">Send me today's email now</button></div>`;
}
async function digestAction(act, a) {
  const pr = profile(me());
  if (act === "dg-mode") { const v = a.dataset.v; try { await api.updateProfile({ email_digest: v }); if (pr) localUpsert("profiles", { ...pr, email_digest: v }); toast(v === "off" ? "Morning email turned off." : "Morning email is on."); } catch (e) { toast(e.message); } render(); return; }
  if (act === "dg-test") { a.disabled = true; a.textContent = "Sending…"; try { const r = await api.mail("digest"); toast(r?.sent ? `Sent to ${r.email}.` : "Nothing to send."); } catch (e) { toast(e.message); } a.disabled = false; a.textContent = "Send me today's email now"; }
}

/* ================= Access approval ================= */
const accessOk = acc => !!acc?.approved && (acc.is_admin || (!!acc.activated_at && (!acc.access_until || new Date(acc.access_until) > new Date())));
const fmtWhen = t => new Date(t).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
// Opened from the activation email: wait for a real tap before using the one-time token (mail scanners open links but don't tap buttons)
function activateLinkScreen(tok) {
  $("#root").innerHTML = `<div class="auth"><div class="auth-card">
    <div class="brand"><div class="brand-mark"><span></span></div>TaskerBay</div>
    <h1>Activate your account</h1><p class="lead">Your TaskerBay access is approved. Tap the button to continue, then choose your password.</p>
    <button class="btn" id="act-go" style="width:100%">Activate my account</button><p class="muted" id="act-msg" style="margin:10px 0 0;font-size:13.5px"></p></div></div>`;
  $("#act-go").onclick = async e => {
    e.target.disabled = true; e.target.textContent = "Checking the link…";
    try { await api.verifyActivation(tok); history.replaceState(null, "", location.pathname); location.reload(); }
    catch (err) { history.replaceState(null, "", location.pathname); e.target.disabled = false; e.target.textContent = "Go to sign in"; e.target.onclick = () => location.reload();
      $("#act-msg").textContent = "This activation link has expired or was already used. Sign in with your email and password, then tap “Send the activation email again”."; }
  };
}
async function activationScreen(acc) {
  const via = await api.signInMethods?.().catch(() => []) || [];
  const fromLink = via.some(m => /otp|magiclink|recovery|invite|email/.test(m));
  const first = acc?.full_name ? ", " + esc(acc.full_name.split(" ")[0]) : "";
  $("#root").innerHTML = `<div class="auth"><div class="auth-card">
    <div class="brand"><div class="brand-mark"><span></span></div>TaskerBay</div>
    ${fromLink ? `<h1>Activate your account</h1>
    <p class="lead">Welcome${first}! Your access is approved. Enter your password to activate your account (${esc(S.user.email || "")}).</p>
    <form id="act-f"><div class="field"><label for="act-p">Password</label><input class="inp" id="act-p" type="password" minlength="8" required autocomplete="new-password" placeholder="At least 8 characters"></div>
    <div class="field"><label for="act-p2">Type it again</label><input class="inp" id="act-p2" type="password" minlength="8" required autocomplete="new-password"></div>
    <p class="muted" style="font-size:13px;margin:-2px 0 12px">You can use the same password you chose when you signed up.</p>
    <button class="btn" type="submit" style="width:100%">Activate my account</button><p class="muted" id="act-msg" style="margin:10px 0 0;font-size:13.5px"></p></form>`
    : `<h1>You're approved 🎉</h1>
    <p class="lead">Thanks${first}. Your access has been approved. We've emailed an activation link to <b>${esc(S.user.email || "")}</b>. Open it, then enter your password to activate your account.</p>
    <button class="btn" id="act-resend">Send the activation email again</button><p class="muted" id="act-msg" style="margin:10px 0 0;font-size:13.5px"></p>
    <div class="alt">or</div><button class="btn ghost" onclick="location.reload()">I've activated, check again</button>`}
    <div class="alt">or</div><button class="btn ghost" id="pend-out">Sign out</button></div></div>`;
  $("#pend-out").onclick = () => api.signOut();
  const msg = t => { const m = $("#act-msg"); if (m) m.textContent = t; };
  if ($("#act-resend")) $("#act-resend").onclick = async e => { e.target.disabled = true; try { await api.mail("activation"); msg(`Sent. Check ${S.user.email} (and the spam folder).`); } catch (err) { msg(err.message); } setTimeout(() => { e.target.disabled = false; }, 60e3); };
  if ($("#act-f")) $("#act-f").onsubmit = async e => {
    e.preventDefault(); const p1 = $("#act-p").value, p2 = $("#act-p2").value;
    if (p1.length < 8) return msg("Use at least 8 characters.");
    if (p1 !== p2) return msg("The two passwords don't match.");
    const b = e.target.querySelector("button"); b.disabled = true; b.textContent = "Activating…";
    try { await api.activate(p1); msg("Activated! Opening TaskerBay…"); history.replaceState(null, "", location.pathname); setTimeout(() => location.reload(), 800); }
    catch (err) { b.disabled = false; b.textContent = "Activate my account"; msg(err.message); }
  };
}
function pendingScreen(acc) {
  const ended = acc?.approved && acc.access_until && new Date(acc.access_until) <= new Date();
  if (acc?.approved && !acc.is_admin && !acc.activated_at && !ended) { activationScreen(acc); return; }
  $("#root").innerHTML = `<div class="auth"><div class="auth-card">
    <div class="brand"><div class="brand-mark"><span></span></div>TaskerBay</div>
    ${ended ? `<h1>Your trial has ended</h1>
    <p class="lead">Your 1-week trial ended on ${esc(fmtWhen(acc.access_until))}. Your tasks are kept safe. Ask the owner to extend your access or make it permanent, then tap <b>Check again</b>.</p>` : `<h1>Waiting for approval</h1>
    <p class="lead">Thanks${acc?.full_name ? ", " + esc(acc.full_name.split(" ")[0]) : ""}. Your account (${esc(S.user.email || "")}) has been created and the owner has been notified. Once it's approved you'll get an <b>activation email</b>: open it and enter your password to start using TaskerBay.</p>`}
    <button class="btn" onclick="location.reload()">Check again</button>
    <div class="alt">or</div>
    <button class="btn ghost" id="pend-out">Sign out</button></div></div>`;
  $("#pend-out").onclick = () => api.signOut();
}
function accessCard() {
  if (!U.isAdmin) return "";
  if (!U.access) { U.access = "loading"; api.accessRequests().then(r => { U.access = r || []; render(); }).catch(e => { U.access = { error: e.message }; render(); }); }
  const list = Array.isArray(U.access) ? U.access : [];
  const now = new Date(), expired = x => x.approved && !x.is_admin && x.access_until && new Date(x.access_until) <= now;
  const pend = list.filter(x => !x.approved), ended = list.filter(expired), ok = list.filter(x => x.approved && !expired(x));
  const trialRow = (x, isEnded) => `<div class="acc-row"><div>${avatarText(x.full_name || x.email)}</div><div class="who"><b>${esc(x.full_name || "(no name)")}</b><small>${esc(x.email || "")} · ${isEnded ? `<span class="flag">trial ended ${esc(fmtWhen(x.access_until))}</span>` : x.access_until ? `trial until ${esc(fmtWhen(x.access_until))}` : x.is_admin ? "admin" : "permanent"}${!x.is_admin && !x.activated_at ? ` · <span class="flag" style="color:var(--orange)!important">not activated yet${x.activation_sent_at ? ", link sent " + esc(timeAgo(x.activation_sent_at)) : ""}</span>` : ""}</small></div>
    <div class="acc-btns">${!x.is_admin && !x.activated_at && !isEnded ? `<button class="btn ghost" data-action="acc-activate" data-id="${x.id}">Resend activation email</button>` : ""}<button class="btn ghost" data-action="acc-email" data-id="${x.id}">Change email</button>${x.id !== me() ? `<button class="btn ghost" data-action="acc-mfa" data-id="${x.id}" title="If they lost their phone">Reset 2-step sign-in</button>` : ""}${x.is_admin ? "" : `${x.access_until ? `<button class="btn ghost" data-action="acc-grant" data-days="7" data-id="${x.id}">${isEnded ? "Give 1 more week" : "+1 week"}</button><button class="btn ghost" data-action="acc-grant" data-id="${x.id}">Make permanent</button>` : `<button class="btn ghost" data-action="acc-grant" data-days="7" data-id="${x.id}">Change to 1-week trial</button>`}<button class="btn ghost danger-t" data-action="acc-remove" data-id="${x.id}">Remove</button>`}</div></div>`;
  const row = (x, pending) => `<div class="acc-row"><div>${avatarText(x.full_name || x.email)}</div><div class="who"><b>${esc(x.full_name || "(no name)")}</b><small>${esc(x.email || "")} · ${pending ? "asked " + timeAgo(x.created_at) : x.is_admin ? "admin" : "approved"}</small></div><div class="acc-btns"><button class="btn" data-action="acc-grant" data-id="${x.id}">Permanent</button><button class="btn ghost" data-action="acc-grant" data-days="7" data-id="${x.id}">1-week trial</button><button class="btn ghost danger-t" data-action="acc-remove" data-id="${x.id}">Reject</button></div></div>`;
  return `<div class="card"><div class="card-h"><h2>👤 Access requests</h2>${pend.length ? `<span class="badge-n">${pend.length}</span>` : ""}</div>
    ${U.access === "loading" ? `<p class="muted" style="margin:0">Loading…</p>` : U.access?.error ? `<p class="muted" style="margin:0">${esc(U.access.error)}</p>` : `
    ${pend.length ? pend.map(x => row(x, true)).join("") : `<p class="muted" style="margin:0 0 8px;font-size:14px">No one is waiting. When someone signs up with your access code, they'll appear here and you'll get an alert.</p>`}
    ${ended.length ? `<div class="acc-sec">⏳ Trial ended (${ended.length})</div>${ended.map(x => trialRow(x, true)).join("")}` : ""}
    ${ok.length ? `<details class="acc-ok" ${ok.some(x => x.access_until) ? "open" : ""}><summary>People with access (${ok.length})</summary>${ok.map(x => trialRow(x, false)).join("")}</details>` : ""}
    <p class="muted" style="font-size:12.5px;margin:10px 0 0"><b>1-week trial</b>: access stops by itself after 7 days and you get an alert. Their tasks are kept, so you can extend or make it permanent later. <b>Remove</b> deletes the account and its data.</p>`}</div>`;
}
function backupCard() {
  if (!U.isAdmin) return "";
  return `<div class="card"><div class="card-h"><h2>🗄️ Backups</h2></div>
    <p class="muted" style="margin:0 0 12px;font-size:14px">A full copy of all TaskerBay data is saved <b>every night at 3 AM</b> in a private, locked store that only you (the admin) can download. The last 30 days are kept.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" data-action="backup-dl">⬇ Download latest backup</button><button class="btn ghost" data-action="backup-now">Download a fresh copy now</button></div></div>`;
}
const avatarText = n => `<span class="av-t">${esc(String(n || "?").trim().charAt(0).toUpperCase())}</span>`;

/* ================= Boot ================= */
async function boot() {
  try {
    await initBackend();
    AI_ON = ENABLE_AI && (S.mode === "cloud" || (S.mode === "claude" && api.hasAI()));
    const actTok = new URLSearchParams(location.search).get("activate");
    if (actTok && S.mode === "cloud") { activateLinkScreen(actTok); return; }
    const user = await api.session();
    if (!user) { authScreen(); return; }
    S.user = user;
    if (S.mode === "cloud") {
      const mf = await api.mfaState().catch(() => null);
      if (mf?.factor && mf.current !== "aal2") { mfaScreen(mf.factor); return; }
      const acc = await api.myAccess();
      if (!accessOk(acc)) { pendingScreen(acc); return; }
      U.isAdmin = !!acc.is_admin;
    }
    await api.loadAll();
    let saved = null; try { saved = localStorage.getItem("tb.ws"); } catch (e) {}
    S.wsId = S.db.workspaces.some(w => w.id === saved) ? saved : (S.db.workspaces.find(w => w.owner_id === user.id && w.name === "Personal") || S.db.workspaces[0])?.id;
    if (!S.wsId) { $("#root").innerHTML = `<div class="auth"><div class="auth-card"><h1>Almost there</h1><p class="lead">Your account has no workspace yet. Make sure the database setup script has been run, then reload.</p><button class="btn" onclick="location.reload()">Reload</button></div></div>`; return; }
    await api.loadWorkspace(S.wsId);
    { const cal = loadCalendar().catch(() => {}); await Promise.race([cal, new Promise(r => setTimeout(r, 1500))]); cal.then(() => S.ready && render()); }
    shell(); S.ready = true;
    const h = location.hash.slice(1); U.view = VIEWS[h] ? h : "today";
    render(true);
    openFromHash();
    if (S.mode === "cloud") {
      try { const pr = profile(me()); if (pr && !pr.region) { const rg = myRegion(); await api.updateProfile({ region: rg.c }); localUpsert("profiles", { ...pr, region: rg.c }); } } catch (e) {}
      try { const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; const pr = profile(me()); if (tz && pr && pr.timezone !== tz) { await api.updateProfile({ timezone: tz }); localUpsert("profiles", { ...pr, timezone: tz }); } } catch (e) {}
      let off = false; try { off = localStorage.getItem("tb.pushOff") === "1"; } catch (e) {}
      if (!off && pushSupported() && Notification.permission === "granted") syncPush(true).then(() => render()).catch(() => {});
    }
    onChange(() => { if (S.mode === "claude") AI_ON = ENABLE_AI && api.hasAI(); render(); });
    E.runOverdue(); setInterval(() => E.runOverdue(), 3600e3); setTimeout(checkDueAlerts, 1500);
    refreshKnownWords(); SP.loadDict().then(() => { refreshKnownWords(); $$("[data-quick]").forEach(i => { const h = $(`[data-hint-for="${i.id}"]`); if (h && i.value) h.innerHTML = hintFor(i.value); }); });
    // Coming back to the app (phone unlocked, tab reopened, back online): fetch the latest from every device
    if (S.mode === "cloud") {
      let hiddenAt = 0, busy = false;
      const resync = async () => { if (busy) return; busy = true; try { const acc = await api.myAccess(); if (!accessOk(acc)) { pendingScreen(acc); busy = false; return; } await api.refresh(); } catch (e) {} busy = false; };
      document.addEventListener("visibilitychange", () => { if (document.hidden) hiddenAt = Date.now(); else if (hiddenAt && Date.now() - hiddenAt > 15e3) resync(); });
      addEventListener("online", resync);
      addEventListener("pageshow", e => { if (e.persisted) resync(); });
      setInterval(() => { if (!document.hidden) resync(); }, 5 * 60e3);
    }
    let lastDay = dkey(); setInterval(() => { if (dkey() !== lastDay) { lastDay = dkey(); U.plan = null; U.planState = "idle"; render(); } }, 60e3);
  } catch (e) {
    console.error(e);
    $("#root").innerHTML = `<div class="auth"><div class="auth-card"><h1>Can't load TaskerBay</h1><p class="lead">${esc(e.message || e)}</p><p class="muted" style="font-size:13px">Check your internet connection and the Supabase keys in js/config.js.</p><button class="btn" onclick="location.reload()">Try again</button></div></div>`;
  }
}
boot();
