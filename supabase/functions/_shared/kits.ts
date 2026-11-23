// Brand kit (per promoter) + event kit (per show) -> a first page draft for the studio.
// Promoters only ever deal in files and three colours; this turns that into a full page description.
import { cleanUrl, cleanPage, DEFAULT_THEME, type Page } from "./page_spec.ts";

export interface Brand {
  logo?: string;                 // wordmark / logo, transparent
  partners?: string;             // partner + sound-system logo strip
  figures?: string[];            // signature characters / cutouts, reused across shows
  colors?: { main?: string; second?: string; background?: string };
  socials?: { instagram?: string; tiktok?: string; facebook?: string; website?: string };
}
export interface Kit {
  logo?: string;                 // a logo just for this show (else the brand logo)
  subtitle?: string;             // a second line as art (e.g. a tagline wordmark)
  hero?: string; hero_small?: string;
  flyers?: string[];             // one per night, in night order
  figures?: string[];            // one cutout per night (else the brand's figures)
  icons?: string[];              // small emblem per night
  partners?: string;             // a partner strip just for this show (else the brand's)
  video?: string; share?: string;
  links?: string;                // "here's a Drive link" for Dylan to upload from
}

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v: unknown) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : undefined);
const handle = (v: unknown) => (typeof v === "string" ? v.trim().replace(/^@/, "").slice(0, 60).replace(/[^A-Za-z0-9._-]/g, "") : "") || undefined;

export function cleanBrand(v: unknown, hosts: string[]): Brand {
  const b = (v && typeof v === "object" ? v : {}) as Record<string, any>, u = (x: unknown) => cleanUrl(x, hosts) || undefined;
  const c = (b.colors || {}) as Record<string, unknown>, s = (b.socials || {}) as Record<string, unknown>;
  let site: string | undefined; try { const w = new URL(String(s.website || "")); if (w.protocol === "https:") site = w.toString().slice(0, 200); } catch { /* none */ }
  return strip({
    logo: u(b.logo), partners: u(b.partners),
    figures: Array.isArray(b.figures) ? b.figures.slice(0, 8).map(u).filter(Boolean) as string[] : undefined,
    colors: strip({ main: hex(c.main), second: hex(c.second), background: hex(c.background) }),
    socials: strip({ instagram: handle(s.instagram), tiktok: handle(s.tiktok), facebook: handle(s.facebook), website: site }),
  });
}
export function cleanKit(v: unknown, hosts: string[]): Kit {
  const k = (v && typeof v === "object" ? v : {}) as Record<string, any>, u = (x: unknown) => cleanUrl(x, hosts) || undefined;
  const list = (x: unknown) => (Array.isArray(x) ? x.slice(0, 6).map((y) => cleanUrl(y, hosts)) : undefined);  // keeps night positions
  return strip({
    logo: u(k.logo), subtitle: u(k.subtitle), hero: u(k.hero), hero_small: u(k.hero_small), partners: u(k.partners), video: u(k.video), share: u(k.share),
    flyers: list(k.flyers), figures: list(k.figures), icons: list(k.icons),
    links: typeof k.links === "string" ? k.links.slice(0, 1000) : undefined,
  });
}
function strip<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) {
    const v = o[k] as unknown;
    if (v === undefined || v === "" || (Array.isArray(v) && !v.some(Boolean)) || (v && typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length)) delete o[k];
  }
  return o;
}

// ---- colour helpers: promoters pick three colours, the rest is worked out so text stays readable ----
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (c: number[]) => "#" + c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("");
const mix = (a: string, b: string, t: number) => { const x = rgb(a), y = rgb(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
const lum = (h: string) => { const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

// Event kit beats brand kit; anything missing is simply left out (the renderer skips empty sections).
export function buildDraft(brand: Brand, kit: Kit, nightCount: number, opts: { secret?: boolean } = {}, hosts: string[] = []): Page {
  const D = DEFAULT_THEME.colors, c = brand.colors || {};
  const bg = c.background || D.bg, main = c.main || D.accent, second = c.second || (c.main ? mix(c.main, "#ffffff", 0.35) : D.nights[1]);
  const dark = lum(bg) < 0.4;
  const text = dark ? "#f4f1ee" : "#111111";
  const colors = { bg, text, accent: main, nights: [main, second], muted: mix(text, bg, 0.35), line: mix(second, bg, 0.6) };
  const n = Math.max(1, Math.min(6, nightCount));
  const figs = (i: number) => kit.figures?.[i] || (brand.figures?.length ? brand.figures[i % brand.figures.length] : undefined);
  const art = {
    wordmark: kit.logo || brand.logo, subtitle: kit.subtitle, hero: kit.hero, hero_small: kit.hero_small,
    partners: kit.partners || brand.partners, video: kit.video, share: kit.share, flyers: kit.flyers,
    nights: Array.from({ length: n }, (_, i) => ({ figure: figs(i), icon: kit.icons?.[i] })),
  };
  const has = (x: unknown) => !!x;
  const sections = [
    { type: "brand", variant: art.wordmark ? "wordmark" : "text" },
    has(art.hero) && { type: "hero", variant: "fade" },
    { type: "dates", variant: "flyer", note: opts.secret ? "The address comes with your tickets." : "" },
    (kit.flyers || []).some(Boolean) && { type: "flyers", variant: n > 1 ? "grid" : "stack", show: "after_lineup" },
    { type: "nights", variant: "cards" },
    has(art.video) && { type: "video", variant: "teaser" },
    { type: "tickets", variant: "cards" },
    has(art.partners) && { type: "partners", variant: "strip" },
  ].filter(Boolean);
  return cleanPage({ theme: { ...DEFAULT_THEME, colors }, art, sections, custom_css: "", meta: {} }, hosts);
}
