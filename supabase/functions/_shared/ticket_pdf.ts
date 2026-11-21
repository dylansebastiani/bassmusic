// PDF tickets in the T.O.F.T.U. look: one page per ticket, styled after the brand board's
// cut-corner HUD frames. Night one is orange, night two violet, a pass carries both.
// Art and fonts load from the site (siteUrl/assets/toftu/...), so nothing large ships in the function.
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import QRCode from "npm:qrcode@1.5.4";

export interface PdfTicket {
  typeName: string; nightIdx: number[]; nightLabels: string; doors: string | null;
  holder: string | null; code: string; tier: string | null; ticketUrl: string; comp: boolean;
}
export interface PdfData {
  eventName: string; venue: string | null; address: string | null; age: string | null;
  orderRef: string; tickets: PdfTicket[]; siteUrl: string;
  revealText?: string | null; // while the address is held back
}

const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const VOID = hex("#050505"), UV = hex("#2D1052"), LAV = hex("#B5A1C8"), INK = hex("#FFFFFF");
const ORANGE = hex("#FF5A1F"), VIOLET = hex("#8A2BE2"), VIOLET_TEXT = hex("#AA6EFF"), MUTE = hex("#8E84A0");
const W = 400, H = 760, M = 18, CUT = 18;

async function get(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error("asset " + url + " " + r.status);
  return new Uint8Array(await r.arrayBuffer());
}

// A cut-corner frame like the board's HUD panels: corners clipped top-right and bottom-left.
function frame(p: PDFPage, x: number, y: number, w: number, h: number, c: number, color = LAV, width = 1.2, fill?: ReturnType<typeof hex>) {
  const pts = [[x, y + c], [x + c, y], [x + w, y], [x + w, y + h - c], [x + w - c, y + h], [x, y + h]];
  const path = "M " + pts.map(([px, py]) => `${px} ${py}`).join(" L ") + " Z";
  p.drawSvgPath(path, { x: 0, y: H, borderColor: color, borderWidth: width, color: fill });
}
// pdf-lib's origin is bottom-left; everything here is laid out top-down, so flip y.
const T = (y: number) => H - y;
function text(p: PDFPage, s: string, x: number, y: number, size: number, font: PDFFont, color = INK, spacing = 0) {
  if (!spacing) { p.drawText(s, { x, y: T(y) - size, size, font, color }); return font.widthOfTextAtSize(s, size); }
  let cx = x; for (const ch of s) { p.drawText(ch, { x: cx, y: T(y) - size, size, font, color }); cx += font.widthOfTextAtSize(ch, size) + spacing; }
  return cx - x - spacing;
}
function centered(p: PDFPage, s: string, y: number, size: number, font: PDFFont, color = INK, spacing = 0) {
  const w = [...s].reduce((a, ch) => a + font.widthOfTextAtSize(ch, size) + spacing, -spacing);
  text(p, s, (W - w) / 2, y, size, font, color, spacing);
}
function fit(s: string, font: PDFFont, size: number, max: number) { while (size > 8 && font.widthOfTextAtSize(s, size) > max) size -= 1; return size; }
function img(p: PDFPage, im: PDFImage, x: number, y: number, w: number) { const h = im.height * w / im.width; p.drawImage(im, { x, y: T(y) - h, width: w, height: h }); return h; }
// Halftone dots shrinking away from a corner, the board's dot-grid texture.
function halftone(p: PDFPage, x0: number, y0: number, cols: number, rows: number, pitch: number, color: ReturnType<typeof hex>) {
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const d = Math.hypot(c, r) / Math.hypot(cols, rows); const rad = 2.4 * (1 - d);
    if (rad > 0.35) p.drawCircle({ x: x0 - c * pitch, y: T(y0 + r * pitch), size: rad, color, opacity: 0.9 });
  }
}

export async function renderTicketPdf(d: PdfData): Promise<Uint8Array> {
  const base = d.siteUrl.replace(/\/$/, "") + "/assets/toftu/";
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  doc.setTitle(`${d.eventName} tickets`); doc.setAuthor("T.O.F.T.U."); doc.setCreator("subduction.art");
  const [heavyB, monoB, wmB, ftuB, eyeFB, eyeSB, figFB, figSB] = await Promise.all([
    get(base + "fonts/Bungee.woff"), get(base + "fonts/SpaceMono-Bold.woff"),
    get(base + "email/wordmark.png"), get(base + "email/ftu.png"),
    get(base + "email/eye-fri.png"), get(base + "email/eye-sat.png"),
    get(base + "email/figure-fri.png"), get(base + "email/figure-sat.png"),
  ]);
  const heavy = await doc.embedFont(heavyB, { subset: true }), mono = await doc.embedFont(monoB, { subset: true });
  const wm = await doc.embedPng(wmB), ftu = await doc.embedPng(ftuB);
  const eyes = [await doc.embedPng(eyeFB), await doc.embedPng(eyeSB)];
  const figs = [await doc.embedPng(figFB), await doc.embedPng(figSB)];
  // The partner logo row (sound, crews). Optional: a ticket still renders without it.
  const partners = await get(base + "partners.png").then((b) => doc.embedPng(b)).catch(() => null);

  for (const [i, t] of d.tickets.entries()) {
    const p = doc.addPage([W, H]);
    const pass = t.nightIdx.length > 1, n0 = t.nightIdx[0] ?? 0;
    const accent = pass ? INK : n0 % 2 ? VIOLET : ORANGE;
    const accentText = pass ? INK : n0 % 2 ? VIOLET_TEXT : ORANGE;
    p.drawRectangle({ x: 0, y: 0, width: W, height: H, color: VOID });

    // ---- main ticket ----
    const top = M, mainH = 592;
    frame(p, M, top, W - 2 * M, mainH, CUT, UV, 1, VOID);
    halftone(p, W - M - 10, top + 10, 9, 7, 9, pass ? VIOLET : accent);
    // night accent bar across the top-left, like the board's frame tabs
    if (pass) {
      p.drawRectangle({ x: M + CUT, y: T(top) - 5, width: 70, height: 5, color: ORANGE });
      p.drawRectangle({ x: M + CUT + 70, y: T(top) - 5, width: 70, height: 5, color: VIOLET });
    } else p.drawRectangle({ x: M + CUT, y: T(top) - 5, width: 140, height: 5, color: accent });

    let y = top + 26;
    y += img(p, wm, (W - 200) / 2, y, 200) + 10;
    y += img(p, ftu, (W - 220) / 2, y, 220) + 22;

    // the night's figure on the right, the ticket name on the left
    const fig = figs[pass ? 1 : n0 % 2];
    const figW = 78; img(p, fig, W - M - figW - 12, y - 4, figW);
    let ex = M + 18;
    for (const n of t.nightIdx) { p.drawImage(eyes[n % 2], { x: ex, y: T(y) - 26, width: 26, height: 26 }); ex += 20; }
    const nameSize = fit(t.typeName.toUpperCase(), heavy, 30, W - 2 * M - figW - 40);
    text(p, t.typeName.toUpperCase(), M + 18, y + 30, nameSize, heavy, accentText);
    text(p, (t.comp ? "GUEST LIST" : (t.tier || "ADMIT ONE")).toUpperCase(), M + 18, y + 34 + nameSize + 6, 9, mono, LAV, 1.4);
    y += 34 + nameSize + 26;
    text(p, t.nightLabels.toUpperCase(), M + 18, y, 10, mono, INK, 1.2);
    if (t.doors) text(p, t.doors.toUpperCase(), M + 18, y + 15, 10, mono, LAV, 1.2);
    y += 44;

    // QR in a white plate
    const qrPng = await QRCode.toBuffer(t.ticketUrl, { type: "png", width: 600, margin: 1, errorCorrectionLevel: "M" });
    const qr = await doc.embedPng(new Uint8Array(qrPng));
    const qs = 150, qx = (W - qs) / 2;
    p.drawRectangle({ x: qx - 12, y: T(y) - qs - 12, width: qs + 24, height: qs + 24, color: INK });
    p.drawImage(qr, { x: qx, y: T(y + 12) - qs + 12, width: qs, height: qs });
    y += qs + 36;
    centered(p, t.code, y, 20, mono, INK, 6);
    y += 34;

    // details: holder + the secret location
    const col = M + 18;
    text(p, "HOLDER", col, y, 7.5, mono, MUTE, 1.5);
    text(p, (t.holder || "-").toUpperCase(), col, y + 11, fit((t.holder || "-").toUpperCase(), heavy, 12, 150), heavy, INK);
    text(p, "ORDER", col + 190, y, 7.5, mono, MUTE, 1.5);
    text(p, `${d.orderRef} · ${i + 1}/${d.tickets.length}`, col + 190, y + 11, 10, mono, INK);
    y += 40;
    if (d.address) {
      text(p, "THE SECRET LOCATION", col, y, 7.5, mono, ORANGE, 1.5);
      text(p, (d.venue || "").toUpperCase(), col, y + 11, 13, heavy, INK);
      text(p, d.address, col, y + 29, fit(d.address, mono, 9, W - 2 * M - 36), mono, LAV);
    } else if (d.revealText) {
      text(p, "THE SECRET LOCATION", col, y, 7.5, mono, ORANGE, 1.5);
      const drop = ("DROPS " + d.revealText).toUpperCase();
      text(p, drop, col, y + 11, fit(drop, heavy, 13, W - 2 * M - 36), heavy, INK);
      text(p, "WE'LL EMAIL YOU THE ADDRESS", col, y + 29, 9, mono, LAV, 0.6);
    }

    // ---- perforation + stub ----
    if (partners) {
      const ph = 22, pw = Math.min(W - 2 * M - 60, partners.width * ph / partners.height);
      const h2 = partners.height * pw / partners.width;
      p.drawImage(partners, { x: (W - pw) / 2, y: T(top + mainH - 12) , width: pw, height: h2, opacity: 0.85 });
    }
    const perf = top + mainH + 18;
    for (let x = M; x < W - M; x += 9) p.drawLine({ start: { x, y: T(perf) }, end: { x: x + 4.5, y: T(perf) }, thickness: 0.8, color: UV });
    p.drawCircle({ x: 0, y: T(perf), size: 9, color: hex("#000000") }); p.drawCircle({ x: W, y: T(perf), size: 9, color: hex("#000000") });
    const sTop = perf + 16, sH = H - sTop - M;
    frame(p, M, sTop, W - 2 * M, sH, 12, accent === INK ? LAV : accent, 1.2, VOID);
    text(p, "ADMIT ONE", M + 16, sTop + 16, 8, mono, LAV, 2);
    text(p, t.typeName.toUpperCase(), M + 16, sTop + 30, fit(t.typeName.toUpperCase(), heavy, 22, 200), heavy, accentText);
    text(p, t.code, M + 16, sTop + 64, 12, mono, INK, 3);
    text(p, (d.age ? d.age + " · BRING ID" : "BRING ID"), M + 16, sTop + 84, 8, mono, LAV, 1.4);
    const sw = 120; img(p, wm, W - M - sw - 14, sTop + 22, sw);
    text(p, "ONE SCAN PER NIGHT · DON'T SHARE", W - M - 14 - mono.widthOfTextAtSize("ONE SCAN PER NIGHT · DON'T SHARE", 6.5) - 7, sTop + 84, 6.5, mono, MUTE, 0.2);
  }
  return await doc.save();
}
