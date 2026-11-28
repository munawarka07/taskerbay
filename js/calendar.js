// TaskerBay region calendar: each person's working week and public holidays, from their own country.
// Gulf and other Muslim-majority countries use built-in rules (Islamic dates worked out with the Umm al-Qura calendar,
// marked "expected" because official dates follow moon sighting). Other countries come from the free Nager.Date list
// through our own server. People can add their own days off or switch any holiday off.

const FRI_SAT = [5, 6], SAT_SUN = [0, 6], FRI = [5];
// [code, name, weekend]
export const COUNTRIES = [
  ["AE", "United Arab Emirates", SAT_SUN], ["SA", "Saudi Arabia", FRI_SAT], ["QA", "Qatar", FRI_SAT], ["KW", "Kuwait", FRI_SAT],
  ["BH", "Bahrain", FRI_SAT], ["OM", "Oman", FRI_SAT], ["JO", "Jordan", FRI_SAT], ["EG", "Egypt", FRI_SAT], ["IQ", "Iraq", FRI_SAT],
  ["LB", "Lebanon", SAT_SUN], ["MA", "Morocco", SAT_SUN], ["TN", "Tunisia", SAT_SUN], ["DZ", "Algeria", FRI_SAT], ["TR", "Türkiye", SAT_SUN],
  ["IR", "Iran", FRI], ["PK", "Pakistan", SAT_SUN], ["IN", "India", SAT_SUN], ["BD", "Bangladesh", FRI_SAT], ["LK", "Sri Lanka", SAT_SUN],
  ["NP", "Nepal", [6]], ["PH", "Philippines", SAT_SUN], ["MY", "Malaysia", SAT_SUN], ["ID", "Indonesia", SAT_SUN], ["SG", "Singapore", SAT_SUN],
  ["CN", "China", SAT_SUN], ["HK", "Hong Kong", SAT_SUN], ["JP", "Japan", SAT_SUN], ["KR", "South Korea", SAT_SUN], ["TH", "Thailand", SAT_SUN],
  ["VN", "Vietnam", SAT_SUN], ["AU", "Australia", SAT_SUN], ["NZ", "New Zealand", SAT_SUN], ["GB", "United Kingdom", SAT_SUN], ["IE", "Ireland", SAT_SUN],
  ["US", "United States", SAT_SUN], ["CA", "Canada", SAT_SUN], ["MX", "Mexico", SAT_SUN], ["BR", "Brazil", SAT_SUN], ["AR", "Argentina", SAT_SUN],
  ["DE", "Germany", SAT_SUN], ["FR", "France", SAT_SUN], ["ES", "Spain", SAT_SUN], ["IT", "Italy", SAT_SUN], ["NL", "Netherlands", SAT_SUN],
  ["BE", "Belgium", SAT_SUN], ["CH", "Switzerland", SAT_SUN], ["AT", "Austria", SAT_SUN], ["SE", "Sweden", SAT_SUN], ["NO", "Norway", SAT_SUN],
  ["DK", "Denmark", SAT_SUN], ["FI", "Finland", SAT_SUN], ["PL", "Poland", SAT_SUN], ["PT", "Portugal", SAT_SUN], ["GR", "Greece", SAT_SUN],
  ["RO", "Romania", SAT_SUN], ["CZ", "Czechia", SAT_SUN], ["HU", "Hungary", SAT_SUN], ["UA", "Ukraine", SAT_SUN], ["RU", "Russia", SAT_SUN],
  ["ZA", "South Africa", SAT_SUN], ["NG", "Nigeria", SAT_SUN], ["KE", "Kenya", SAT_SUN], ["GH", "Ghana", SAT_SUN], ["ET", "Ethiopia", SAT_SUN]
].sort((a, b) => a[1].localeCompare(b[1]));

const TZ = {
  "Asia/Dubai": "AE", "Asia/Riyadh": "SA", "Asia/Qatar": "QA", "Asia/Kuwait": "KW", "Asia/Bahrain": "BH", "Asia/Muscat": "OM", "Asia/Amman": "JO",
  "Africa/Cairo": "EG", "Asia/Baghdad": "IQ", "Asia/Beirut": "LB", "Asia/Karachi": "PK", "Asia/Kolkata": "IN", "Asia/Calcutta": "IN", "Asia/Dhaka": "BD",
  "Asia/Colombo": "LK", "Asia/Kathmandu": "NP", "Asia/Manila": "PH", "Asia/Kuala_Lumpur": "MY", "Asia/Jakarta": "ID", "Asia/Singapore": "SG",
  "Asia/Shanghai": "CN", "Asia/Hong_Kong": "HK", "Asia/Tokyo": "JP", "Asia/Seoul": "KR", "Asia/Bangkok": "TH", "Asia/Tehran": "IR", "Europe/Istanbul": "TR",
  "Europe/London": "GB", "Europe/Dublin": "IE", "Europe/Berlin": "DE", "Europe/Paris": "FR", "Europe/Madrid": "ES", "Europe/Rome": "IT",
  "Europe/Amsterdam": "NL", "Africa/Johannesburg": "ZA", "Africa/Lagos": "NG", "Africa/Nairobi": "KE", "Australia/Sydney": "AU", "Australia/Melbourne": "AU",
  "America/New_York": "US", "America/Chicago": "US", "America/Denver": "US", "America/Los_Angeles": "US", "America/Toronto": "CA"
};
export function guessCountry() {
  try { const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; if (TZ[tz]) return TZ[tz]; } catch (e) {}
  const r = (navigator.language || "").split("-")[1]?.toUpperCase();
  return COUNTRIES.some(c => c[0] === r) ? r : "AE";
}
export const countryName = c => (COUNTRIES.find(x => x[0] === c) || [c, c])[1];
export const defaultWorkDays = c => { const we = (COUNTRIES.find(x => x[0] === c) || [0, 0, SAT_SUN])[2]; return [0, 1, 2, 3, 4, 5, 6].filter(d => !we.includes(d)); };

// ---- Islamic (Umm al-Qura) dates for a Gregorian year: "month-day" -> [dates]
const pad = n => String(n).padStart(2, "0");
const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hijriCache = {};
function hijriMap(year) {
  if (hijriCache[year]) return hijriCache[year];
  const m = {}; let fmt;
  try { fmt = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { day: "numeric", month: "numeric" }); if (!/umalqura/.test(fmt.resolvedOptions().calendar)) fmt = new Intl.DateTimeFormat("en-u-ca-islamic", { day: "numeric", month: "numeric" }); }
  catch (e) { return (hijriCache[year] = {}); }
  for (let d = new Date(year, 0, 1, 12); d.getFullYear() === year; d.setDate(d.getDate() + 1)) {
    const p = Object.fromEntries(fmt.formatToParts(d).map(x => [x.type, x.value]));
    (m[`${+p.month}-${+p.day}`] ||= []).push(key(d));
  }
  return (hijriCache[year] = m);
}
// Islamic events: [hijri month, first day, number of days, name]
const IS = {
  fitr: n => [10, 1, n, "Eid al-Fitr"], arafat: [12, 9, 1, "Arafat Day"], adha: n => [12, 10, n, "Eid al-Adha"],
  hny: [1, 1, 1, "Islamic New Year"], mawlid: [3, 12, 1, "Prophet's Birthday"], isra: [7, 27, 1, "Isra and Mi'raj"], ashura: [1, 9, 2, "Ashura"]
};
const nthDow = (y, m, dow, n) => { const d = new Date(y, m - 1, 1); while (d.getDay() !== dow) d.setDate(d.getDate() + 1); d.setDate(d.getDate() + 7 * (n - 1)); return key(d); };
// built-in countries: fixed ["MM-DD", name] or functions(year) -> [[date, name]], plus Islamic events
const RULES = {
  AE: { fixed: [["01-01", "New Year's Day"], ["12-01", "Commemoration Day"], ["12-02", "National Day"], ["12-03", "National Day"]], islamic: [IS.fitr(3), IS.arafat, IS.adha(3), IS.hny, IS.mawlid] },
  SA: { fixed: [["02-22", "Founding Day"], ["09-23", "National Day"]], islamic: [IS.fitr(4), IS.arafat, IS.adha(3)] },
  QA: { fixed: [["12-18", "National Day"]], extra: y => [[nthDow(y, 2, 2, 2), "National Sport Day"]], islamic: [IS.fitr(3), IS.arafat, IS.adha(3)] },
  KW: { fixed: [["01-01", "New Year's Day"], ["02-25", "National Day"], ["02-26", "Liberation Day"]], islamic: [IS.isra, IS.fitr(3), IS.arafat, IS.adha(3), IS.hny, IS.mawlid] },
  BH: { fixed: [["01-01", "New Year's Day"], ["05-01", "Labour Day"], ["12-16", "National Day"], ["12-17", "National Day"]], islamic: [IS.fitr(3), IS.arafat, IS.adha(3), IS.hny, IS.ashura, IS.mawlid] },
  OM: { fixed: [["11-20", "National Day"], ["11-21", "National Day"]], islamic: [IS.isra, IS.fitr(3), IS.arafat, IS.adha(3), IS.hny, IS.mawlid] },
  JO: { fixed: [["01-01", "New Year's Day"], ["05-01", "Labour Day"], ["05-25", "Independence Day"], ["12-25", "Christmas Day"]], islamic: [IS.fitr(3), IS.arafat, IS.adha(3), IS.hny, IS.mawlid] },
  IQ: { fixed: [["01-01", "New Year's Day"], ["01-06", "Army Day"], ["03-21", "Nowruz"], ["05-01", "Labour Day"], ["07-14", "Republic Day"], ["10-03", "National Day"], ["12-10", "Victory Day"], ["12-25", "Christmas Day"]], islamic: [IS.fitr(3), IS.arafat, IS.adha(3), IS.hny, IS.ashura, IS.mawlid] },
  PK: { fixed: [["02-05", "Kashmir Day"], ["03-23", "Pakistan Day"], ["05-01", "Labour Day"], ["08-14", "Independence Day"], ["11-09", "Iqbal Day"], ["12-25", "Quaid-e-Azam Day"]], islamic: [IS.fitr(3), IS.adha(3), IS.ashura, IS.mawlid] },
  BD: { fixed: [["02-21", "Language Martyrs' Day"], ["03-17", "Sheikh Mujibur Rahman's Birthday"], ["03-26", "Independence Day"], ["04-14", "Bengali New Year"], ["05-01", "May Day"], ["12-16", "Victory Day"], ["12-25", "Christmas Day"]], islamic: [IS.fitr(3), IS.adha(3), IS.ashura, IS.mawlid] },
  IN: { fixed: [["01-26", "Republic Day"], ["08-15", "Independence Day"], ["10-02", "Gandhi Jayanti"], ["12-25", "Christmas Day"]], islamic: [] },
  IR: { fixed: [["02-11", "Revolution Day"], ["03-20", "Nowruz"], ["03-21", "Nowruz"], ["03-22", "Nowruz"], ["03-23", "Nowruz"], ["04-01", "Republic Day"], ["04-02", "Nature Day"]], islamic: [IS.fitr(2), IS.adha(1), IS.ashura, IS.mawlid] },
  LK: { fixed: [["02-04", "Independence Day"], ["04-13", "New Year"], ["04-14", "New Year"], ["05-01", "May Day"], ["12-25", "Christmas Day"]], islamic: [IS.fitr(1), IS.adha(1), IS.mawlid] },
  MY: { fixed: [["01-01", "New Year's Day"], ["05-01", "Labour Day"], ["08-31", "National Day"], ["09-16", "Malaysia Day"], ["12-25", "Christmas Day"]], islamic: [IS.fitr(2), IS.adha(1), IS.hny, IS.mawlid] }
};
const NOTE = { IN: "Only national holidays are listed. Add your state's festivals as your own days off." };
export const countryNote = c => NOTE[c] || "";
export const hasBuiltIn = c => !!RULES[c];

export function builtInHolidays(c, year) {
  const r = RULES[c]; if (!r) return null;
  const out = [];
  for (const [md, name] of r.fixed || []) out.push({ date: `${year}-${md}`, name });
  for (const [d, name] of r.extra?.(year) || []) out.push({ date: d, name });
  const hm = hijriMap(year);
  for (const [mo, day, n, name] of r.islamic || []) {
    for (const first of hm[`${mo}-${day}`] || []) {
      for (let i = 0; i < n; i++) { const d = new Date(first + "T12:00:00"); d.setDate(d.getDate() + i); out.push({ date: key(d), name: n > 1 ? `${name} (day ${i + 1})` : name, expected: true }); }
    }
  }
  // the year's last Islamic event can begin in December and run into next year: also pull ones that started in the previous year
  const prev = hijriMap(year - 1);
  for (const [mo, day, n, name] of r.islamic || []) for (const first of prev[`${mo}-${day}`] || []) for (let i = 1; i < n; i++) { const d = new Date(first + "T12:00:00"); d.setDate(d.getDate() + i); if (d.getFullYear() === year) out.push({ date: key(d), name: `${name} (day ${i + 1})`, expected: true }); }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---- the person's merged list: built-in or downloaded, minus switched-off ones, plus their own days off
export function mergeHolidays(base, prefs) {
  const off = new Set(prefs?.off || []), add = prefs?.add || [];
  const m = new Map();
  for (const h of base || []) if (!off.has(h.date)) m.set(h.date, { ...h, source: "public" });
  for (const h of add) m.set(h.date, { date: h.date, name: h.name || "Day off", source: "mine" });
  return m;
}
