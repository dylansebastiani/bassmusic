// Draws the site's page art as SVG and writes webp files with sharp.
// Everything is generated from code so the set stays consistent and small.
// Run: node scripts/art.mjs [outDir]   (default site/assets/art)
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const out = process.argv[2] || join(root, "site/assets/art");
mkdirSync(out, { recursive: true });

// Two palettes. "laser" is the neon light-burst Dylan picked for the sample show.
// "brand" is acid green on void per DESIGN.md.
const PAL = {
  laser: { a: "#00e5ff", b: "#ff2bd6", haze: "#2a0a33", core: "#ffffff" },
  brand: { a: "#B6FF00", b: "#B6FF00", haze: "#1D2A00", core: "#F4F1EE" },
};

// Seeded random so rebuilding gives the same image.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Light burst: rays fan out from one point, color a above, color b below, with a glow core.
function burst(w, h, o = {}) {
  const p = PAL[o.pal || "laser"], cx = (o.cx ?? 0.5) * w, cy = (o.cy ?? 0.5) * h, n = o.rays || 64, r = rng(o.seed || 7);
  let up = "", dn = "";
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = -w * 0.2 + t * w * 1.4, op = (0.25 + r() * 0.75).toFixed(2), sw = (0.6 + r() * 1.6).toFixed(1);
    up += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(0)}" y2="${-h * 0.1}" stroke-opacity="${op}" stroke-width="${sw}"/>`;
    dn += `<line x1="${cx}" y1="${cy}" x2="${(w - x).toFixed(0)}" y2="${h * 1.1}" stroke-opacity="${op}" stroke-width="${sw}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><radialGradient id="hz" cx="${cx / w}" cy="${cy / h}" r="0.7"><stop offset="0" stop-color="${p.haze}"/><stop offset="1" stop-color="#000"/></radialGradient>
<radialGradient id="cr" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${p.core}" stop-opacity=".9"/><stop offset=".25" stop-color="${p.b}" stop-opacity=".5"/><stop offset="1" stop-color="${p.b}" stop-opacity="0"/></radialGradient>
<filter id="gl" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${Math.max(2, w / 260)}"/></filter></defs>
<rect width="100%" height="100%" fill="url(#hz)"/>
<g filter="url(#gl)" opacity=".8"><g stroke="${p.a}">${up}</g><g stroke="${p.b}">${dn}</g></g>
<g opacity=".9"><g stroke="${p.a}">${up}</g><g stroke="${p.b}">${dn}</g></g>
<line x1="0" y1="${cy}" x2="${w}" y2="${cy}" stroke="${p.core}" stroke-opacity=".5" stroke-width="1"/>
<ellipse cx="${cx}" cy="${cy}" rx="${w * 0.22}" ry="${h * 0.12}" fill="url(#cr)"/>
${fade(w, h, o.fade)}</svg>`;
}

// Sub rings: a speaker cone seen head on, rings pushing out like a bass hit.
function rings(w, h, o = {}) {
  const p = PAL[o.pal || "brand"], cx = (o.cx ?? 0.5) * w, cy = (o.cy ?? 0.5) * h, R = Math.hypot(w, h) * 0.6, n = o.n || 34;
  let g = "";
  for (let i = 1; i <= n; i++) {
    const t = i / n, rr = R * Math.pow(t, 1.6), op = (1 - t) * 0.9 + 0.08;
    g += `<circle cx="${cx}" cy="${cy}" r="${rr.toFixed(1)}" stroke-opacity="${op.toFixed(2)}" stroke-width="${(2.4 - t * 1.6).toFixed(2)}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><radialGradient id="hz" cx="${cx / w}" cy="${cy / h}" r="0.55"><stop offset="0" stop-color="${p.haze}"/><stop offset="1" stop-color="#000"/></radialGradient>
<filter id="gl"><feGaussianBlur stdDeviation="${Math.max(2, w / 300)}"/></filter></defs>
<rect width="100%" height="100%" fill="url(#hz)"/>
<g fill="none" stroke="${p.a}" filter="url(#gl)" opacity=".7">${g}</g><g fill="none" stroke="${p.a}">${g}</g>
<circle cx="${cx}" cy="${cy}" r="${Math.min(w, h) * 0.05}" fill="#000" stroke="${p.core}" stroke-opacity=".6"/>
${fade(w, h, o.fade)}</svg>`;
}

// Bass wave: stacked waveform lines, tall in the middle, like a sub drop on a spectrum.
function wave(w, h, o = {}) {
  const p = PAL[o.pal || "brand"], n = o.lines || 26, r = rng(o.seed || 3);
  let g = "";
  for (let k = 0; k < n; k++) {
    const y0 = h * (0.15 + 0.7 * k / (n - 1)), f = 1.5 + r() * 2.5, ph = r() * 6.28, amp = h * (0.03 + 0.05 * Math.sin(Math.PI * k / (n - 1)));
    let d = "";
    for (let x = 0; x <= w; x += w / 160) {
      const env = Math.exp(-Math.pow((x - w / 2) / (w * 0.22), 2));
      d += (x ? "L" : "M") + x.toFixed(1) + " " + (y0 + Math.sin(x / w * f * 6.28 + ph) * amp * (0.2 + env * 2.4)).toFixed(1);
    }
    const mid = Math.abs(k - (n - 1) / 2) < n * 0.08;
    g += `<path d="${d}" stroke="${mid ? p.core : (k < n / 2 ? p.a : p.b)}" stroke-opacity="${(0.25 + 0.6 * Math.sin(Math.PI * k / (n - 1))).toFixed(2)}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><filter id="gl"><feGaussianBlur stdDeviation="${Math.max(2, w / 280)}"/></filter></defs>
<rect width="100%" height="100%" fill="#000"/>
<g fill="none" stroke-width="1.4" filter="url(#gl)" opacity=".8">${g}</g><g fill="none" stroke-width="1.2">${g}</g>
${fade(w, h, o.fade)}</svg>`;
}

// Optional black fade on one side so the art sits under text cleanly.
function fade(w, h, side) {
  if (!side) return "";
  const v = { left: [1, 0, 0, 0], right: [0, 0, 1, 0], bottom: [0, 0, 0, 1], top: [0, 1, 0, 0] }[side];
  return `<defs><linearGradient id="fd" x1="${v[0]}" y1="${v[1]}" x2="${v[2]}" y2="${v[3]}"><stop offset="0" stop-color="#000"/><stop offset=".55" stop-color="#000" stop-opacity="0"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#fd)"/>`;
}

const ART = { burst, rings, wave };
export async function render(name, kind, w, h, o = {}, q = 72) {
  const file = join(out, name + ".webp");
  await sharp(Buffer.from(ART[kind](w, h, o))).webp({ quality: q, effort: 6 }).toFile(file);
  return file;
}

// The set. Each entry: file name, style, size, options.
export const SET = [
  // /fees banner, green bass wave
  ["fees-wave", "wave", 960, 300, { pal: "brand", seed: 3 }, 62],
  // fan pages: /shows empty states, /collection and /me sign-in. One file, cached across pages.
  ["fans-burst", "burst", 960, 400, { pal: "laser", seed: 11 }, 62],
  // /privacy and /terms strip, green sub rings
  ["legal-rings", "rings", 960, 160, { pal: "brand", cx: 0.82, n: 28 }, 62],
];

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [name, kind, w, h, o, q] of SET) console.log(await render(name, kind, w, h, o, q));
}
