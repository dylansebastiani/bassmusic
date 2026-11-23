// A show page, described as data: theme + art + an ordered list of sections + optional custom CSS.
// The renderer (site/show.html) draws it; the studio edits it; Claude writes it in chat.
// cleanPage() is the single gate: everything saved goes through it, so a bad value can never
// break a live page, load art from somewhere we don't control, or touch the checkout.
// Plain-words reference for people (and the page-builder skill): docs/PAGE_SPEC.md.

export const FONTS = {
  display: ["Bungee", "Anton", "Archivo", "Space Mono"],
  body: ["Archivo", "Space Mono"],
} as const;

export const SECTIONS: Record<string, readonly string[]> = {
  brand: ["wordmark", "text"],          // logo image (or the show name as text) + optional subtitle
  hero: ["fade", "full", "framed"],     // the main background art
  dates: ["flyer", "simple"],           // the dates line in night colours + place + age
  flyers: ["grid", "stack"],            // one flyer per night
  nights: ["cards", "list"],            // each night: doors, lineup (or "coming soon")
  tickets: ["cards"],                   // ticket types + checkout (always present, exactly once)
  partners: ["strip"],                  // partner / sound-system logos image
  text: ["plain", "boxed"],             // a heading and a paragraph
  video: ["teaser"],                    // a short MP4 teaser
  faq: ["list"],                        // questions and answers
};

export interface Theme {
  colors: { bg: string; text: string; muted: string; line: string; accent: string; nights: string[] };
  fonts: { display: string; body: string };
  frame: "angled" | "square" | "rounded";
  titles: "outline" | "solid";
  glow: boolean;
  dots: boolean;
}
export interface NightArt { figure?: string; icon?: string }
export interface Art { wordmark?: string; subtitle?: string; hero?: string; hero_small?: string; partners?: string; share?: string; video?: string; nights?: NightArt[]; flyers?: string[] }
export interface Section { type: string; variant: string; [k: string]: unknown }
export interface Page { v: 1; theme: Theme; art: Art; sections: Section[]; custom_css: string; meta: { title?: string; description?: string } }

export const DEFAULT_THEME: Theme = {
  colors: { bg: "#050505", text: "#f3effa", muted: "#b5a1c8", line: "#3b1760", accent: "#ff5a1f", nights: ["#ff5a1f", "#8a2be2"] },
  fonts: { display: "Bungee", body: "Archivo" },
  frame: "angled", titles: "outline", glow: true, dots: false,
};

const HEX = /^#[0-9a-f]{6}$/i;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");
const pick = <T extends string>(v: unknown, ok: readonly T[], dflt: T): T => (ok.includes(v as T) ? (v as T) : dflt);
const hex = (v: unknown, dflt: string) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : dflt);

// Art may only come from the site itself (assets/...) or our Supabase storage, never anywhere else.
export function cleanUrl(v: unknown, storageHosts: string[]): string {
  if (typeof v !== "string" || v.length > 500) return "";
  if (/^assets\/[a-z0-9/_.-]+\.(webp|png|jpe?g|svg|mp4)$/i.test(v) && !v.includes("..")) return v;
  try {
    const u = new URL(v);
    if (u.protocol === "https:" && storageHosts.includes(u.host) && u.pathname.startsWith("/storage/v1/object/public/") && !u.pathname.includes("..")) return u.toString();
  } catch { /* not a URL */ }
  return "";
}

// Custom CSS is a per-show escape hatch for things the sections can't do. It's scoped by the
// renderer to that show's page. Nothing that can load outside resources or escape the <style> tag.
export function cleanCss(v: unknown, storageHosts: string[]): string {
  let css = str(typeof v === "string" ? v.replace(/[\r\n\t]+/g, "\n") : "", 20000);
  if (/<|@import|expression\s*\(|javascript:|behavior\s*:|-moz-binding/i.test(css)) return "";
  css = css.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (_m, _q, u) => { const ok = cleanUrl(u, storageHosts); return ok ? `url("${ok}")` : "none"; });
  return css;
}

// Turn anything (a draft from the studio, a page Claude wrote) into a safe, complete page.
// Unknown keys are dropped, bad values fall back to defaults, and a tickets section is guaranteed.
export function cleanPage(input: unknown, storageHosts: string[]): Page {
  const p = (input && typeof input === "object" ? input : {}) as Record<string, any>;
  const t = (p.theme || {}) as Record<string, any>, c = (t.colors || {}) as Record<string, any>, f = (t.fonts || {}) as Record<string, any>;
  const D = DEFAULT_THEME;
  const theme: Theme = {
    colors: {
      bg: hex(c.bg, D.colors.bg), text: hex(c.text, D.colors.text), muted: hex(c.muted, D.colors.muted),
      line: hex(c.line, D.colors.line), accent: hex(c.accent, D.colors.accent),
      nights: (Array.isArray(c.nights) ? c.nights : D.colors.nights).slice(0, 6).map((x: unknown, i: number) => hex(x, D.colors.nights[i % 2])),
    },
    fonts: { display: pick(f.display, FONTS.display, D.fonts.display), body: pick(f.body, FONTS.body, D.fonts.body) },
    frame: pick(t.frame, ["angled", "square", "rounded"] as const, D.frame),
    titles: pick(t.titles, ["outline", "solid"] as const, D.titles),
    glow: typeof t.glow === "boolean" ? t.glow : D.glow,
    dots: typeof t.dots === "boolean" ? t.dots : D.dots,
  };
  const a = (p.art || {}) as Record<string, any>, u = (x: unknown) => cleanUrl(x, storageHosts);
  const art: Art = {};
  for (const k of ["wordmark", "subtitle", "hero", "hero_small", "partners", "share", "video"] as const) { const v = u(a[k]); if (v) art[k] = v; }
  if (Array.isArray(a.nights)) art.nights = a.nights.slice(0, 6).map((n: any) => { const o: NightArt = {}; const fg = u(n?.figure), ic = u(n?.icon); if (fg) o.figure = fg; if (ic) o.icon = ic; return o; });
  if (Array.isArray(a.flyers)) art.flyers = a.flyers.slice(0, 6).map(u).filter(Boolean);

  const sections: Section[] = [];
  for (const s of Array.isArray(p.sections) ? p.sections.slice(0, 30) : []) {
    const type = typeof s?.type === "string" && SECTIONS[s.type] ? s.type : "";
    if (!type || (type === "tickets" && sections.some((x) => x.type === "tickets"))) continue;
    const out: Section = { type, variant: pick(s.variant, SECTIONS[type], SECTIONS[type][0]) };
    // Per-section words. Everything is plain text; the renderer escapes it.
    if (type === "brand") { out.subtitle_text = str(s.subtitle_text, 120); }
    if (type === "dates") { out.note = str(s.note, 200); }
    if (type === "flyers") { out.show = pick(s.show, ["always", "after_lineup"] as const, "after_lineup"); }
    if (type === "nights") { out.soon_text = str(s.soon_text, 60) || "Lineup coming soon"; }
    if (type === "tickets") { out.title = str(s.title, 40) || "Tickets"; out.fineprint = str(s.fineprint, 1200); }
    if (type === "text") { out.title = str(s.title, 80); out.body = str(s.body, 2000); }
    if (type === "faq") { out.items = (Array.isArray(s.items) ? s.items.slice(0, 20) : []).map((q: any) => ({ q: str(q?.q, 200), a: str(q?.a, 1000) })).filter((q: { q: string }) => q.q); }
    sections.push(out);
  }
  if (!sections.some((x) => x.type === "tickets")) sections.push({ type: "tickets", variant: "cards", title: "Tickets", fineprint: "" });

  const m = (p.meta || {}) as Record<string, any>;
  return { v: 1, theme, art, sections, custom_css: cleanCss(p.custom_css, storageHosts), meta: { title: str(m.title, 120), description: str(m.description, 300) } };
}
