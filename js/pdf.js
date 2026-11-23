// Tiny PDF writer for TaskerBay reports: A4 pages, Helvetica, text, boxes, lines and tables. No outside libraries.
const W = { r: [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,761,556,761,222,556,333,1000,556,556,333,1000,667,333,1000,761,611,761,761,222,222,333,333,350,556,1000,333,1000,500,333,944,761,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500], b: [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,761,556,761,278,556,500,1000,556,556,333,1000,667,333,1000,761,611,761,761,278,278,500,500,350,556,1000,333,1000,556,333,944,761,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556] };
const CP = { 0x20ac: 128, 0x201a: 130, 0x192: 131, 0x201e: 132, 0x2026: 133, 0x2020: 134, 0x2021: 135, 0x2c6: 136, 0x2030: 137, 0x160: 138, 0x2039: 139, 0x152: 140, 0x17d: 142, 0x2018: 145, 0x2019: 146, 0x201c: 147, 0x201d: 148, 0x2022: 149, 0x2013: 150, 0x2014: 151, 0x2dc: 152, 0x2122: 153, 0x161: 154, 0x203a: 155, 0x153: 156, 0x17e: 158, 0x178: 159 };
// characters the built-in font can't draw (Arabic, emoji...) become "?"
const enc = s => { let o = ""; for (const ch of String(s ?? "")) { const c = ch.codePointAt(0); if (c >= 32 && c < 127 || c >= 160 && c <= 255) o += String.fromCharCode(c); else if (CP[c]) o += String.fromCharCode(CP[c]); else if (!(c >= 0x1f000 || (c >= 0x2600 && c <= 0x27bf) || c === 0xfe0f || c === 0x200d || c < 32)) o += "?"; } return o.replace(/ {2,}/g, " "); };
const esc = s => s.replace(/[\\()]/g, m => "\\" + m);
const num = n => (Math.round(n * 100) / 100).toString();
export const PAGE = { w: 595.28, h: 841.89 };

export class Pdf {
  constructor() { this.pages = []; this.cur = null; }
  page() { this.cur = []; this.pages.push(this.cur); return this; }
  width(s, size = 10, bold = false) { const t = W[bold ? "b" : "r"]; let n = 0; for (const ch of enc(s)) { const c = ch.charCodeAt(0); n += c >= 32 ? t[c - 32] : 0; } return n * size / 1000; }
  fit(s, max, size = 10, bold = false) { s = String(s ?? ""); if (this.width(s, size, bold) <= max) return s; while (s.length > 1 && this.width(s + "...", size, bold) > max) s = s.slice(0, -1); return s.trimEnd() + "..."; }
  color(c, stroke) { const [r, g, b] = c.map(x => num(x / 255)); return `${r} ${g} ${b} ${stroke ? "RG" : "rg"}`; }
  text(s, x, y, o = {}) {
    const size = o.size || 10, bold = !!o.bold; let str = enc(s);
    if (o.max) str = enc(this.fit(s, o.max, size, bold));
    const w = this.width(str, size, bold); if (o.align === "right") x -= w; else if (o.align === "center") x -= w / 2;
    this.cur.push(`BT ${this.color(o.color || [20, 24, 31])} /${bold ? "F2" : "F1"} ${size} Tf ${num(x)} ${num(PAGE.h - y)} Td (${esc(str)}) Tj ET`);
    return w;
  }
  rect(x, y, w, h, fill, stroke) { this.cur.push(`${fill ? this.color(fill) : ""} ${stroke ? this.color(stroke, true) + " 0.6 w" : ""} ${num(x)} ${num(PAGE.h - y - h)} ${num(w)} ${num(h)} re ${fill && stroke ? "B" : fill ? "f" : "S"}`); }
  line(x1, y1, x2, y2, c = [220, 224, 230], w = 0.6) { this.cur.push(`${this.color(c, true)} ${num(w)} w ${num(x1)} ${num(PAGE.h - y1)} m ${num(x2)} ${num(PAGE.h - y2)} l S`); }
  blob() {
    const objs = [], add = s => { objs.push(s); return objs.length; };
    add("<< /Type /Catalog /Pages 2 0 R >>"); add(""); add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"); add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const kids = [];
    for (const p of this.pages) { const body = p.join("\n"); const c = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`); kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${c} 0 R >>`)); }
    objs[1] = `<< /Type /Pages /Kids [${kids.map(k => k + " 0 R").join(" ")}] /Count ${kids.length} >>`;
    let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"; const off = [];
    objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const x = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
    const bytes = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    return new Blob([bytes], { type: "application/pdf" });
  }
}

/* A report page flow: margins, a moving cursor, headings, tables that continue on new pages */
export class Report {
  constructor({ title, subtitle, footer }) { this.pdf = new Pdf(); this.m = 40; this.title = title; this.subtitle = subtitle; this.footer = footer; this.newPage(); }
  get w() { return PAGE.w - this.m * 2; }
  newPage() {
    const p = this.pdf.page(), n = p.pages.length;
    p.rect(0, 0, PAGE.w, 6, [43, 108, 176]);
    if (n === 1) { p.text(this.title, this.m, 52, { size: 20, bold: true, max: this.w }); if (this.subtitle) p.text(this.subtitle, this.m, 70, { size: 10, color: [100, 110, 122], max: this.w }); this.y = 92; }
    else { p.text(this.title, this.m, 30, { size: 9, bold: true, color: [100, 110, 122], max: this.w - 60 }); this.y = 48; }
  }
  need(h) { if (this.y + h > PAGE.h - 46) this.newPage(); }
  heading(s) { this.need(40); this.y += 8; this.pdf.text(s, this.m, this.y + 12, { size: 13, bold: true }); this.y += 20; this.pdf.line(this.m, this.y, this.m + this.w, this.y, [43, 108, 176], 1); this.y += 8; }
  note(s, color = [100, 110, 122]) { this.need(16); this.pdf.text(s, this.m, this.y + 10, { size: 9, color, max: this.w }); this.y += 15; }
  // boxes: [[label, value, color?]] laid out in a row
  boxes(items, perRow = 3) {
    const gap = 8, bw = (this.w - gap * (perRow - 1)) / perRow, bh = 46;
    for (let i = 0; i < items.length; i += perRow) {
      this.need(bh + gap);
      items.slice(i, i + perRow).forEach(([l, v, c], k) => { const x = this.m + k * (bw + gap); this.pdf.rect(x, this.y, bw, bh, [245, 247, 250], [225, 229, 235]); this.pdf.text(l.toUpperCase(), x + 10, this.y + 16, { size: 7.5, bold: true, color: [100, 110, 122], max: bw - 20 }); this.pdf.text(v, x + 10, this.y + 35, { size: 13, bold: true, color: c || [20, 24, 31], max: bw - 20 }); });
      this.y += bh + gap;
    }
  }
  // cols: [{ h, w (fraction), align }], rows: [[cells...]], opts.rowColor(row) -> [r,g,b] for the text, opts.total row
  table(cols, rows, opts = {}) {
    const size = 8.5, rh = 17, tw = this.w, ws = cols.map(c => c.w * tw);
    const head = () => { this.pdf.rect(this.m, this.y, tw, rh, [235, 240, 246]); let x = this.m; cols.forEach((c, i) => { this.pdf.text(c.h, c.align === "right" ? x + ws[i] - 5 : x + 5, this.y + 11.5, { size: 7.5, bold: true, color: [70, 80, 92], align: c.align, max: ws[i] - 10 }); x += ws[i]; }); this.y += rh; };
    this.need(rh * 2); head();
    const all = opts.total ? [...rows, opts.total] : rows;
    all.forEach((r, ri) => {
      const isTotal = opts.total && ri === all.length - 1;
      if (this.y + rh > PAGE.h - 46) { this.newPage(); head(); }
      if (isTotal) this.pdf.rect(this.m, this.y, tw, rh, [245, 247, 250]); else if (ri % 2) this.pdf.rect(this.m, this.y, tw, rh, [251, 252, 253]);
      const col = !isTotal && opts.rowColor ? opts.rowColor(r, ri) : null;
      let x = this.m; cols.forEach((c, i) => { this.pdf.text(r[i] ?? "", c.align === "right" ? x + ws[i] - 5 : x + 5, this.y + 11.5, { size, bold: isTotal || (c.bold && !!r[i]), color: col || [20, 24, 31], align: c.align, max: ws[i] - 10 }); x += ws[i]; });
      this.y += rh; this.pdf.line(this.m, this.y, this.m + tw, this.y, [235, 238, 242], 0.4);
    });
    this.y += 10;
  }
  blob() {
    const n = this.pdf.pages.length;
    this.pdf.pages.forEach((p, i) => { this.pdf.cur = p; this.pdf.text(this.footer || "", this.m, PAGE.h - 22, { size: 7.5, color: [130, 138, 148], max: this.w - 80 }); this.pdf.text(`Page ${i + 1} of ${n}`, PAGE.w - this.m, PAGE.h - 22, { size: 7.5, color: [130, 138, 148], align: "right" }); });
    return this.pdf.blob();
  }
}
