// Reads Excel (.xlsx / .xlsm) and CSV files in the browser. Nothing is uploaded anywhere.
// Returns { sheets: [{ name, rows: [[cell, ...], ...] }] } where cell = { v, t } and t is
// "text" | "num" | "date" (v = "YYYY-MM-DD") | "time" (v = "HH:MM") | "datetime" (v = "YYYY-MM-DDTHH:MM") | "bool".

const pad = n => String(n).padStart(2, "0");

/* ---------- zip ---------- */
async function inflateRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}
async function unzip(buf) {
  const b = new Uint8Array(buf), dv = new DataView(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("This doesn't look like an Excel file.");
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const files = {}, dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
    files[name] = { method, csize, off };
    p += 46 + nlen + xlen + clen;
  }
  const read = async name => {
    const f = files[name] || files[Object.keys(files).find(k => k.toLowerCase() === String(name).toLowerCase())]; if (!f) return null;
    const start = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true);
    const raw = b.subarray(start, start + f.csize);
    const data = f.method === 0 ? raw : f.method === 8 ? await inflateRaw(raw) : null;
    if (!data) throw new Error("This Excel file uses a format TaskerBay can't read. Save it again as .xlsx.");
    return dec.decode(data);
  };
  return { files, read };
}

/* ---------- xlsx ---------- */
const xml = s => new DOMParser().parseFromString(s, "application/xml");
const kids = (el, tag) => [...el.getElementsByTagName("*")].filter(e => e.localName === tag);
const kid = (el, tag) => kids(el, tag)[0] || null;
const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const TIME_IDS = new Set([18, 19, 20, 21, 45, 46, 47]);
function fmtKind(code) {
  const c = String(code || "").replace(/"[^"]*"|\[[^\]]*\]|\\./g, "").toLowerCase();
  if (!/[dmyhs]/.test(c) || /^[#0.,%e+\- ]*$/.test(c)) return null;
  const hasDate = /[dy]/.test(c) || (/m/.test(c) && !/h|s/.test(c)), hasTime = /h|s/.test(c);
  return hasDate && hasTime ? "datetime" : hasTime ? "time" : hasDate ? "date" : null;
}
function serialTo(v, kind, d1904) {
  const ms = Math.round(((+v) + (d1904 ? 1462 : 0) - 25569) * 864e5), d = new Date(ms);
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  if (kind === "time") return { t: "time", v: time };
  if (kind === "datetime" || (kind === "date" && (+v) % 1)) return time === "00:00" ? { t: "date", v: date } : { t: "datetime", v: `${date}T${time}` };
  return { t: "date", v: date };
}
const colIdx = ref => { const m = String(ref || "").match(/^([A-Z]+)/); if (!m) return -1; let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

async function readXlsx(buf) {
  if (typeof DecompressionStream === "undefined") throw new Error("This browser can't open Excel files. Update it, or save the sheet as CSV.");
  const z = await unzip(buf);
  const wbXml = await z.read("xl/workbook.xml"); if (!wbXml) throw new Error("This doesn't look like an Excel workbook.");
  const wb = xml(wbXml);
  const d1904 = /date1904="(1|true)"/i.test(wbXml);
  const rels = xml(await z.read("xl/_rels/workbook.xml.rels") || "<Relationships/>");
  const relMap = Object.fromEntries(kids(rels, "Relationship").map(r => [r.getAttribute("Id"), r.getAttribute("Target")]));
  const ss = await z.read("xl/sharedStrings.xml");
  const strings = ss ? kids(xml(ss), "si").map(si => kids(si, "t").filter(t => t.parentNode === si || t.parentNode.localName === "r").map(t => t.textContent).join("")) : [];
  const st = await z.read("xl/styles.xml");
  let xfKind = [];
  if (st) {
    const sx = xml(st), custom = {};
    kids(sx, "numFmt").forEach(n => { custom[+n.getAttribute("numFmtId")] = n.getAttribute("formatCode"); });
    const cellXfs = kid(sx, "cellXfs");
    xfKind = cellXfs ? kids(cellXfs, "xf").filter(x => x.parentNode === cellXfs).map(x => { const id = +x.getAttribute("numFmtId") || 0; return custom[id] ? fmtKind(custom[id]) : DATE_IDS.has(id) ? (TIME_IDS.has(id) ? "time" : id === 22 ? "datetime" : "date") : null; }) : [];
  }
  const sheets = [];
  for (const s of kids(wb, "sheet")) {
    if (s.getAttribute("state") === "hidden" || s.getAttribute("state") === "veryHidden") continue;
    const rid = s.getAttribute("r:id") || [...s.attributes].find(a => a.localName === "id")?.value;
    let target = relMap[rid] || ""; if (!target) continue;
    target = target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "");
    const sxml = await z.read(target); if (!sxml) continue;
    const doc = xml(sxml), rows = [];
    for (const r of kids(doc, "row")) {
      const ri = (+r.getAttribute("r") || rows.length + 1) - 1; const row = [];
      let auto = 0;
      for (const c of kids(r, "c")) {
        const ref = c.getAttribute("r"); const ci = ref ? colIdx(ref) : auto; auto = ci + 1;
        const t = c.getAttribute("t"), sIdx = +c.getAttribute("s") || 0, vEl = kid(c, "v"), raw = vEl ? vEl.textContent : null;
        let cell = null;
        if (t === "s") cell = { t: "text", v: strings[+raw] ?? "" };
        else if (t === "inlineStr") cell = { t: "text", v: kids(c, "t").map(x => x.textContent).join("") };
        else if (t === "str") cell = { t: "text", v: raw ?? "" };
        else if (t === "b") cell = { t: "bool", v: raw === "1" };
        else if (t === "e") cell = null;
        else if (t === "d") { const d = String(raw || ""); cell = /T\d/.test(d) ? { t: "datetime", v: d.slice(0, 16) } : { t: "date", v: d.slice(0, 10) }; }
        else if (raw != null && raw !== "") { const k = xfKind[sIdx]; cell = k ? serialTo(raw, k, d1904) : { t: "num", v: +raw }; }
        if (cell && !(cell.t === "text" && !String(cell.v).trim())) row[ci] = cell;
      }
      rows[ri] = row;
    }
    sheets.push({ name: s.getAttribute("name") || `Sheet ${sheets.length + 1}`, rows: [...rows].map(r => r || []) });
  }
  return sheets;
}

/* ---------- csv ---------- */
function readCsv(text) {
  text = text.replace(/^﻿/, "");
  const first = text.split(/\r?\n/).find(l => l.trim()) || "";
  const delim = [",", ";", "\t", "|"].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; continue; }
    if (ch === '"' && cur === "") q = true;
    else if (ch === delim) { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return [{ name: "CSV", rows: rows.map(r => r.map(v => (v = v.trim()) ? { t: "text", v } : undefined)) }];
}

export async function readSheetFile(file) {
  if (file.size > 15 * 1024 * 1024) throw new Error("That file is too big (over 15 MB).");
  const name = (file.name || "").toLowerCase();
  if (/\.xls$/.test(name)) throw new Error("Old .xls files can't be read. In Excel choose File → Save As → Excel Workbook (.xlsx), then try again.");
  if (/\.(csv|txt|tsv)$/.test(name) || file.type === "text/csv") return { sheets: readCsv(await file.text()) };
  return { sheets: await readXlsx(await file.arrayBuffer()) };
}
