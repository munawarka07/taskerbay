// TaskerBay spelling fixer (free, works offline once loaded).
// Rules: only fixes words that are NOT real English words and are 1–2 letters away from a known word.
// Names and anything it doesn't recognise are left exactly as typed. Words you keep are learned.

// Everyday + office/HR words it prefers when choosing a correction
const VOCAB = `
about above regarding regards docs doc reminder reminders follow-up followup accept accepted access account accountant accounts accrual accruals across action actions activate add added address adjust adjustment admin administration advance advice advise after afternoon again agenda agent agreement allowance allowances already also amend amendment amount analysis annual another answer apply applied application appointment appraisal approval approvals approve approved april arrange arrangement arrival arrive assessment asset assets assign assigned assist assistant attach attached attachment attend attendance audit august authority available bank banking before behalf benefit benefits between bill billing birthday board bonus book booked booking boss branch break bring budget building business buy calculate calculation calendar call called cancel cancelled cancellation candidate candidates card cards care cash certificate certificates change changes charge charges check checked checking checklist cheque children claim claims clarify clarification class clean clear clearance client clients close closed closing collect collected collection company complaint complete completed compliance confirm confirmation confirmed contact contract contracts copy correct correction cost costs coordinate court cover create created credit current customer daily data date deadline december decision deduction deductions delay deliver delivered delivery department deposit details dinner director discuss discussion dismissal doctor document documents done draft driver driving due during early email emails employee employees employer employment end ending entry evening event exam exit expense expenses expiry explain extend extension family february fees file files final finance financial fine fines finish finished first fix flight follow followup form forms forward friday fuel gift give grade gratuity groceries group hand handover health hearing help hire hiring holiday holidays home hospital hotel hours house husband immediately include increment information inform inspection install insurance interview interviews invoice invoices issue issued items january joining journey july june junior keep labour late leave leaves legal letter letters license licence list loan lunch maintenance manager march market medical meeting meetings message ministry monday month monthly morning name needed new next notice november number october offer office officer onboarding order original overtime owner paid passport payment payments payroll payslip payslips penalty pending permit personal phone plan please policy position post prepare prepared presentation previous print priority probation problem procedure proceed process processed processing project promotion purchase quotation receipt receive received recruitment refund register registration reimbursement reject rejected remind reminder renew renewal rent replacement reply report reports request requested required resignation resolve resume return review revised revision salary salaries saturday schedule school second send sent service services settlement share shared sheet shift sign signature signatures signed site sponsor staff start statement status submit submitted sunday supplier support system target tax team termination thursday ticket tickets today tomorrow training transfer travel tuesday update updated upload urgent vacation vehicle verify visa visit wages warning wednesday week weekly wife work working
`.trim().split(/\s+/);
const ACRONYMS = { eosb: "EOSB", wps: "WPS", hr: "HR", vat: "VAT", mohre: "MOHRE", uae: "UAE", noc: "NOC", ceo: "CEO", cfo: "CFO", gm: "GM", hod: "HOD", lpo: "LPO", gosi: "GOSI", mol: "MOL", gdrfa: "GDRFA", eid: "EID", kpi: "KPI", kpis: "KPIs", pdf: "PDF", it: null };

let DICT = null, loading = null;
const vocabSet = new Set(VOCAB);
const LKEY = "tb.spell.keep";
const learned = () => { try { return new Set(JSON.parse(localStorage.getItem(LKEY) || "[]")); } catch (e) { return new Set(); } };
export function learn(words) {
  const s = learned(); (Array.isArray(words) ? words : [words]).forEach(w => w && s.add(String(w).toLowerCase()));
  try { localStorage.setItem(LKEY, JSON.stringify([...s].slice(-2000))); } catch (e) {}
}
// extra known words (people's names in your workspaces, words in your existing tasks)
let extraKnown = new Set();
export function setKnown(list) { extraKnown = new Set(list.map(w => String(w).toLowerCase())); }

export function loadDict() {
  if (DICT || loading) return loading;
  loading = fetch("words/en.txt").then(r => r.ok ? r.text() : "").then(t => { DICT = new Set(t.split("\n")); }).catch(() => { DICT = new Set(); });
  return loading;
}
export const ready = () => !!DICT;

const isKnown = w => vocabSet.has(w) || extraKnown.has(w) || (DICT && (DICT.has(w) || (w.endsWith("s") && DICT.has(w.slice(0, -1))) || (w.endsWith("es") && DICT.has(w.slice(0, -2))) || (w.endsWith("ed") && (DICT.has(w.slice(0, -2)) || DICT.has(w.slice(0, -1)))) || (w.endsWith("ing") && (DICT.has(w.slice(0, -3)) || DICT.has(w.slice(0, -3) + "e")))));

// Damerau–Levenshtein distance (with adjacent swaps), capped for speed
function dist(a, b, cap = 3) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > cap) return cap + 1;
  }
  return d[a.length][b.length];
}
const ALPHA = "abcdefghijklmnopqrstuvwxyz";
function edits1(w) {
  const out = new Set();
  for (let i = 0; i <= w.length; i++) {
    const L = w.slice(0, i), R = w.slice(i);
    if (R) out.add(L + R.slice(1));
    if (R.length > 1) out.add(L + R[1] + R[0] + R.slice(2));
    for (const c of ALPHA) { if (R) out.add(L + c + R.slice(1)); out.add(L + c + R); }
  }
  return out;
}
const squash = w => w.replace(/(.)\1+/g, "$1"); // "proceeed" -> "proced", "insuurance" -> "insurance"

function suggest(w) {
  // 1) close match among everyday/office words (up to 2 changes for longer words)
  const maxD = w.length >= 7 ? 2 : 1;
  let best = null, bestD = 9;
  for (const v of VOCAB) {
    if (Math.abs(v.length - w.length) > maxD) continue;
    const dd = Math.min(dist(w, v, maxD), squash(w) === squash(v) ? 1 : 9);
    if (dd < bestD || (dd === bestD && best && v[0] === w[0] && best[0] !== w[0])) { best = v; bestD = dd; }
  }
  if (best && bestD <= maxD) return best;
  // 2) otherwise, only if exactly one real English word is one change away (and the word is long enough to be sure)
  if (DICT && w.length >= 6) {
    const c = [...edits1(w)].filter(x => DICT.has(x) && x.length >= 5);
    if (c.length === 1) return c[0];
  }
  return null;
}

// Returns { text, changes: [{ from, to }] }. Never touches names, numbers, #tags, @people, !priority, links.
export function fix(text) {
  const keep = learned(), changes = [];
  const out = text.replace(/[A-Za-z][A-Za-z']*/g, (m, off) => {
    const lw = m.toLowerCase();
    const before = text[off - 1] || "";
    if ("#@!*/\\.".includes(before) && before !== "") { if (before !== ".") return m; }
    if (/[a-z]\.[a-z]/i.test(text.slice(Math.max(0, off - 1), off + m.length + 2)) && /https?:|www\.|@/.test(text)) return m;
    if (ACRONYMS[lw]) { if (m !== ACRONYMS[lw]) changes.push({ from: m, to: ACRONYMS[lw] }); return ACRONYMS[lw]; }
    if (m.length < 4 || keep.has(lw) || isKnown(lw)) return m;
    if (m === m.toUpperCase()) return m;                  // ACRONYMS you typed in capitals stay
    if (!DICT) return m;                                   // wait for the dictionary before changing anything
    const s = suggest(lw); if (!s || s === lw) return m;
    const to = m[0] === m[0].toUpperCase() ? s[0].toUpperCase() + s.slice(1) : s;
    changes.push({ from: m, to }); return to;
  });
  return { text: out, changes };
}
