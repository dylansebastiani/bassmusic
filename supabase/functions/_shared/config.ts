// One source of truth for copy and brand values. scripts/sync-config.mjs copies
// config/stack.json here so the functions and the site never disagree.
import cfg from "./stack.json" with { type: "json" };
export const CONFIG = cfg as typeof cfg & { [k: string]: unknown };
export const SITE_URL = (Deno.env.get("SITE_URL") || cfg.siteUrl).replace(/\/$/, "");
export const fill = (s: string, map: Record<string, unknown>) =>
  String(s || "").replace(/\{\{(\w+)\}\}/g, (_, k) => (map[k] ?? "") as string);
