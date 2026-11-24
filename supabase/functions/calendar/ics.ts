// Small iCalendar (.ics) reader for Outlook / Microsoft 365 published calendars.
// Handles: folded lines, time zones (VTIMEZONE rules, IANA and common Windows names), all-day events,
// recurring meetings (DAILY / WEEKLY / MONTHLY / YEARLY with INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY, BYMONTH, BYSETPOS),
// EXDATE, moved or cancelled single occurrences (RECURRENCE-ID), cancelled meetings and free/busy status.
// Plain JavaScript inside a .ts file so it runs in Deno (edge function) and Node (tests) alike.

const WIN = {
  "Arabian Standard Time": "Asia/Dubai", "Arab Standard Time": "Asia/Riyadh", "Arabic Standard Time": "Asia/Baghdad",
  "India Standard Time": "Asia/Kolkata", "Pakistan Standard Time": "Asia/Karachi", "Egypt Standard Time": "Africa/Cairo",
  "GMT Standard Time": "Europe/London", "Greenwich Standard Time": "Atlantic/Reykjavik", "UTC": "UTC", "Coordinated Universal Time": "UTC",
  "W. Europe Standard Time": "Europe/Berlin", "Romance Standard Time": "Europe/Paris", "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw", "E. Europe Standard Time": "Europe/Chisinau", "GTB Standard Time": "Europe/Bucharest",
  "FLE Standard Time": "Europe/Kiev", "Turkey Standard Time": "Europe/Istanbul", "Russian Standard Time": "Europe/Moscow",
  "Eastern Standard Time": "America/New_York", "Central Standard Time": "America/Chicago", "Mountain Standard Time": "America/Denver",
  "Pacific Standard Time": "America/Los_Angeles", "Singapore Standard Time": "Asia/Singapore", "China Standard Time": "Asia/Shanghai",
  "Tokyo Standard Time": "Asia/Tokyo", "AUS Eastern Standard Time": "Australia/Sydney", "South Africa Standard Time": "Africa/Johannesburg",
  "Sri Lanka Standard Time": "Asia/Colombo", "Nepal Standard Time": "Asia/Kathmandu", "Bangladesh Standard Time": "Asia/Dhaka",
  "SE Asia Standard Time": "Asia/Bangkok", "Philippine Standard Time": "Asia/Manila", "Jordan Standard Time": "Asia/Amman",
  "Middle East Standard Time": "Asia/Beirut", "Iran Standard Time": "Asia/Tehran", "Afghanistan Standard Time": "Asia/Kabul",
  "West Asia Standard Time": "Asia/Tashkent", "Morocco Standard Time": "Africa/Casablanca", "E. Africa Standard Time": "Africa/Nairobi",
  "W. Central Africa Standard Time": "Africa/Lagos", "Qatar Standard Time": "Asia/Qatar"
};
const DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

// ---- naive wall-clock helpers (a local time is stored as ms since epoch "as if UTC") ----
const W = (y, mo, d, h = 0, mi = 0, s = 0) => Date.UTC(y, mo - 1, d, h, mi, s);
const parts = t => { const d = new Date(t); return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), dow: d.getUTCDay() }; };
const dim = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate();
const DAY = 864e5;

function unfold(text) {
  return String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "").split("\n").filter(Boolean);
}
function parseLine(line) {
  // NAME;PARAM=VALUE;PARAM="quoted:value":VALUE
  let i = 0, inQ = false;
  for (; i < line.length; i++) { const c = line[i]; if (c === '"') inQ = !inQ; else if (c === ":" && !inQ) break; }
  const head = line.slice(0, i), value = line.slice(i + 1);
  const segs = []; let cur = "", q = false;
  for (const c of head) { if (c === '"') { q = !q; continue; } if (c === ";" && !q) { segs.push(cur); cur = ""; } else cur += c; }
  segs.push(cur);
  const params = {};
  for (const p of segs.slice(1)) { const k = p.indexOf("="); if (k > 0) params[p.slice(0, k).toUpperCase()] = p.slice(k + 1); }
  return { name: segs[0].toUpperCase(), params, value };
}
const unesc = v => String(v || "").replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1").trim();

function parseComponents(lines) {
  const root = { type: "ROOT", props: [], kids: [] }, stack = [root];
  for (const l of lines) {
    const p = parseLine(l);
    if (p.name === "BEGIN") { const c = { type: p.value.toUpperCase().trim(), props: [], kids: [] }; stack[stack.length - 1].kids.push(c); stack.push(c); }
    else if (p.name === "END") { if (stack.length > 1) stack.pop(); }
    else stack[stack.length - 1].props.push(p);
  }
  return root;
}
const prop = (c, n) => c.props.find(p => p.name === n);
const props = (c, n) => c.props.filter(p => p.name === n);

function parseRRule(v) {
  const r = {};
  for (const kv of String(v).split(";")) { const [k, val] = kv.split("="); if (k && val != null) r[k.toUpperCase()] = val; }
  return r;
}
// wall-clock value from "20261124T090000" (+ "Z" means UTC)
function parseDT(v) {
  const m = String(v).trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  return { t: W(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)), date: !m[4], utc: !!m[7] };
}

// ---- time zones ----
function intlOffset(tz, utcMs) {
  try {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const o = Object.fromEntries(f.formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
    return (W(+o.year, +o.month, +o.day, +o.hour % 24, +o.minute, +o.second) - utcMs) / 6e4;
  } catch (e) { return null; }
}
const validIana = tz => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch (e) { return false; } };
const offMin = s => { const m = String(s || "").trim().match(/^([+-])(\d{2})(\d{2})/); return m ? (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +m[3]) : 0; };

// nth weekday of a month: n=1..5 or -1..-5
function nthDow(y, mo, dow, n) {
  if (n > 0) { const first = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay(); const d = 1 + ((dow - first + 7) % 7) + (n - 1) * 7; return d <= dim(y, mo) ? d : null; }
  const last = dim(y, mo), ld = new Date(Date.UTC(y, mo - 1, last)).getUTCDay(); const d = last - ((ld - dow + 7) % 7) + (n + 1) * 7; return d >= 1 ? d : null;
}
function makeVtz(c) {
  const rules = [];
  for (const k of c.kids) {
    if (k.type !== "STANDARD" && k.type !== "DAYLIGHT") continue;
    const st = parseDT(prop(k, "DTSTART")?.value || "16010101T000000");
    rules.push({ start: st.t, to: offMin(prop(k, "TZOFFSETTO")?.value), from: offMin(prop(k, "TZOFFSETFROM")?.value), rr: prop(k, "RRULE") ? parseRRule(prop(k, "RRULE").value) : null });
  }
  if (!rules.length) return null;
  // offset (minutes) in effect at a local wall-clock time
  return local => {
    const y = parts(local).y; let best = null;
    for (const r of rules) {
      const sp = parts(r.start);
      for (const yy of [y - 1, y]) {
        let at;
        if (r.rr && r.rr.FREQ === "YEARLY") {
          if (r.rr.UNTIL) { const u = parseDT(r.rr.UNTIL); if (u && W(yy, 1, 1) > u.t) continue; }
          const mo = +(r.rr.BYMONTH || sp.mo); let d = sp.d;
          if (r.rr.BYDAY) { const m = r.rr.BYDAY.match(/^([+-]?\d)?([A-Z]{2})$/); if (m) d = nthDow(yy, mo, DAYS[m[2]], +(m[1] || 1)); }
          else if (r.rr.BYMONTHDAY) d = +r.rr.BYMONTHDAY;
          if (!d) continue; at = W(yy, mo, d, sp.h, sp.mi, sp.s);
          if (at < r.start) continue;
        } else { at = r.start; if (parts(at).y !== yy) continue; }
        if (at <= local && (!best || at > best.at)) best = { at, off: r.to };
      }
    }
    if (!best) { const earliest = rules.slice().sort((a, b) => a.start - b.start)[0]; return earliest.from; }
    return best.off;
  };
}

export function parseICS(text, opts = {}) {
  const from = opts.from ?? Date.now() - 7 * DAY, to = opts.to ?? Date.now() + 60 * DAY, defTz = opts.tz || "Asia/Dubai";
  const root = parseComponents(unfold(text));
  const cal = root.kids.find(k => k.type === "VCALENDAR") || root;
  const vtz = {};
  for (const k of cal.kids) if (k.type === "VTIMEZONE") { const id = prop(k, "TZID")?.value?.trim(); const fn = makeVtz(k); if (id && fn) vtz[id] = fn; }
  const calTz = prop(cal, "X-WR-TIMEZONE")?.value?.trim();

  // local wall-clock -> real UTC ms
  const toUTC = (t, tzid) => {
    if (tzid && vtz[tzid]) return t - vtz[tzid](t) * 6e4;
    const iana = tzid ? (validIana(tzid) ? tzid : WIN[tzid] || WIN[tzid.replace(/^\/|"/g, "")] || null) : (calTz && validIana(calTz) ? calTz : defTz);
    const tz = iana || defTz;
    let off = intlOffset(tz, t); if (off == null) return t;
    off = intlOffset(tz, t - off * 6e4) ?? off;
    return t - off * 6e4;
  };
  const when = p => { if (!p) return null; const d = parseDT(p.value); if (!d) return null; const tzid = p.params.TZID; return { local: d.t, date: d.date || p.params.VALUE === "DATE", utc: d.utc, tzid }; };
  const real = w => w.date ? w.local : w.utc ? w.local : toUTC(w.local, w.tzid);

  const events = cal.kids.filter(k => k.type === "VEVENT");
  const overrides = new Map(); // uid -> Map(originalStartRealMs -> event comp)
  for (const e of events) {
    const rid = prop(e, "RECURRENCE-ID"); if (!rid) continue;
    const uid = prop(e, "UID")?.value || ""; const w = when(rid); if (!w) continue;
    if (!overrides.has(uid)) overrides.set(uid, new Map()); overrides.get(uid).set(real(w), e);
  }
  const out = [];
  const info = e => {
    const busy = (prop(e, "X-MICROSOFT-CDO-BUSYSTATUS")?.value || "").trim().toUpperCase() || ((prop(e, "TRANSP")?.value || "").trim().toUpperCase() === "TRANSPARENT" ? "FREE" : "BUSY");
    return { title: unesc(prop(e, "SUMMARY")?.value) || "Busy", location: unesc(prop(e, "LOCATION")?.value), busy, cancelled: (prop(e, "STATUS")?.value || "").trim().toUpperCase() === "CANCELLED" || /^Canceled: |^Cancelled: /.test(unesc(prop(e, "SUMMARY")?.value)) };
  };
  const durationMs = v => { const m = String(v || "").match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/); if (!m) return null; return (+(m[2] || 0) * 7 * DAY + +(m[3] || 0) * DAY + +(m[4] || 0) * 36e5 + +(m[5] || 0) * 6e4 + +(m[6] || 0) * 1e3) * (m[1] === "-" ? -1 : 1); };
  const push = (uid, e, sLocal, dur, allDay, tzid, recurring) => {
    const i = info(e); if (i.cancelled) return;
    const s = allDay ? sLocal : toUTC(sLocal, tzid), en = allDay ? sLocal + Math.max(dur, DAY) : toUTC(sLocal + dur, tzid);
    if (en <= from || s >= to) return;
    out.push({ uid, title: i.title, location: i.location, start: new Date(s).toISOString(), end: new Date(Math.max(en, s)).toISOString(), all_day: allDay, busy: i.busy, recurring });
  };

  for (const e of events) {
    if (prop(e, "RECURRENCE-ID")) continue;
    const uid = prop(e, "UID")?.value || String(out.length);
    const ds = when(prop(e, "DTSTART")); if (!ds) continue;
    const de = when(prop(e, "DTEND"));
    const allDay = ds.date;
    const sLocal = ds.utc ? null : ds.local;
    // duration in wall-clock terms
    let dur = durationMs(prop(e, "DURATION")?.value);
    if (dur == null) dur = de ? (de.utc || ds.utc ? real(de) - real(ds) : de.tzid && de.tzid !== ds.tzid ? real(de) - real(ds) : de.local - ds.local) : allDay ? DAY : 0;
    const rr = prop(e, "RRULE") ? parseRRule(prop(e, "RRULE").value) : null;
    const tzid = ds.utc ? "UTC" : ds.tzid;
    const startLocal = ds.utc ? ds.local : ds.local; // when UTC, wall clock == UTC
    const ov = overrides.get(uid) || new Map();
    const exd = new Set();
    for (const p of props(e, "EXDATE")) for (const v of String(p.value).split(",")) { const d = parseDT(v); if (d) exd.add(d.date || allDay ? d.t : d.utc ? d.t : toUTC(d.t, p.params.TZID || tzid)); }
    const realStart = l => allDay ? l : ds.utc ? l : toUTC(l, tzid);
    const emit = l => {
      const r = realStart(l);
      if (exd.has(r)) return;
      const o = ov.get(r);
      if (o) { // this occurrence was moved or changed
        const os = when(prop(o, "DTSTART")), oe = when(prop(o, "DTEND"));
        if (!os) return; const od = durationMs(prop(o, "DURATION")?.value) ?? (oe ? real(oe) - real(os) : dur);
        const sReal = real(os); const i = info(o); if (i.cancelled) return;
        if (sReal + od <= from || sReal >= to) return;
        out.push({ uid, title: i.title, location: i.location, start: new Date(sReal).toISOString(), end: new Date(sReal + Math.max(od, 0)).toISOString(), all_day: os.date, busy: i.busy, recurring: true });
        return;
      }
      if (ds.utc) { const i = info(e); if (i.cancelled) return; const en = l + dur; if (en <= from || l >= to) return; out.push({ uid, title: i.title, location: i.location, start: new Date(l).toISOString(), end: new Date(en).toISOString(), all_day: false, busy: i.busy, recurring: !!rr }); return; }
      push(uid, e, l, dur, allDay, tzid, !!rr);
    };
    if (!rr) { emit(startLocal); continue; }

    // ---- expand the recurrence in wall-clock time ----
    const freq = rr.FREQ, interval = Math.max(1, +(rr.INTERVAL || 1)), count = rr.COUNT ? +rr.COUNT : null;
    const until = rr.UNTIL ? parseDT(rr.UNTIL) : null;
    const untilReal = until ? (until.utc ? until.t : until.date ? until.t + DAY - 1 : toUTC(until.t, tzid)) : null;
    const sp = parts(startLocal);
    const byday = (rr.BYDAY || "").split(",").filter(Boolean).map(x => { const m = x.match(/^([+-]?\d{1,2})?([A-Z]{2})$/); return m ? { n: m[1] ? +m[1] : null, dow: DAYS[m[2]] } : null; }).filter(Boolean);
    const bymd = (rr.BYMONTHDAY || "").split(",").filter(Boolean).map(Number);
    const bymo = (rr.BYMONTH || "").split(",").filter(Boolean).map(Number);
    const setpos = rr.BYSETPOS ? rr.BYSETPOS.split(",").map(Number) : null;
    const wkst = DAYS[rr.WKST || "MO"];
    const at = (y, mo, d) => W(y, mo, d, sp.h, sp.mi, sp.s);
    const windowEndLocal = to + 2 * DAY;
    let n = 0, guard = 0, done = false;
    const take = list => {
      list.sort((a, b) => a - b);
      if (setpos) list = setpos.map(p => p > 0 ? list[p - 1] : list[list.length + p]).filter(v => v != null).sort((a, b) => a - b);
      for (const l of list) {
        if (l < startLocal) continue;
        if (untilReal != null && realStart(l) > untilReal) { done = true; return; }
        if (count != null && n >= count) { done = true; return; }
        n++; emit(l);
      }
    };
    if (freq === "DAILY") {
      for (let l = startLocal; !done && l <= windowEndLocal && guard++ < 4000; l += interval * DAY) {
        const p = parts(l);
        if (bymo.length && !bymo.includes(p.mo)) continue;
        if (byday.length && !byday.some(b => b.dow === p.dow)) continue;
        take([l]);
      }
    } else if (freq === "WEEKLY") {
      const days = byday.length ? byday.map(b => b.dow) : [sp.dow];
      let wk = startLocal - ((sp.dow - wkst + 7) % 7) * DAY; wk = at(parts(wk).y, parts(wk).mo, parts(wk).d);
      for (; !done && wk <= windowEndLocal && guard++ < 2000; wk += interval * 7 * DAY) {
        take(days.map(dw => wk + ((dw - wkst + 7) % 7) * DAY));
      }
    } else if (freq === "MONTHLY" || freq === "YEARLY") {
      let y = sp.y, mo = sp.mo;
      while (!done && W(y, mo, 1) <= windowEndLocal && guard++ < 1200) {
        const months = freq === "YEARLY" ? (bymo.length ? bymo : [sp.mo]) : [mo];
        const list = [];
        for (const m of months) {
          const last = dim(y, m);
          if (bymd.length) bymd.forEach(d => { const dd = d < 0 ? last + 1 + d : d; if (dd >= 1 && dd <= last) list.push(at(y, m, dd)); });
          else if (byday.length) byday.forEach(b => {
            if (b.n) { const d = nthDow(y, m, b.dow, b.n); if (d) list.push(at(y, m, d)); }
            else for (let d = 1; d <= last; d++) if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === b.dow) list.push(at(y, m, d));
          });
          else if (sp.d <= last) list.push(at(y, m, sp.d));
        }
        take(list);
        if (freq === "YEARLY") y += interval; else { mo += interval; while (mo > 12) { mo -= 12; y++; } }
      }
    } else emit(startLocal);
  }
  out.sort((a, b) => a.start.localeCompare(b.start));
  return out;
}
