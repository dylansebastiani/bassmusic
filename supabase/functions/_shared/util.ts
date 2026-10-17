const ORIGIN = Deno.env.get("SITE_URL") || "*";
export const CORS = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Vary": "Origin",
};
export const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS, ...extra } });
export const err = (message: string, status = 400) => json({ error: message }, status);
export const preflight = (req: Request) => (req.method === "OPTIONS" ? new Response(null, { status: 204, headers: CORS }) : null);

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : null) || null;

export async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function clientIp(req: Request) {
  return (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "0.0.0.0";
}
// Never store a raw IP: hash it with a server-side salt kept in settings.ip_salt.
export const ipHash = async (req: Request, salt: string) => sha256(clientIp(req) + "|" + salt);

// 6 chars, no 0/O/1/I so it survives being read off a phone screen.
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function referralCode() {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(b).map((x) => ALPHA[x % ALPHA.length]).join("");
}
// US numbers to E.164. Anything else is returned as digits with a leading +.
export function e164(raw: string | null) {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  return d.length >= 8 && d.length <= 15 ? "+" + d : null;
}
export async function verifyTurnstile(token: string | null, ip: string) {
  const secret = Deno.env.get("TURNSTILE_SECRET");
  if (!secret) return true; // not configured yet: allow, the honeypot + rate limit still apply
  if (!token) return false;
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, response: token, remoteip: ip }),
  }).then((x) => x.json()).catch(() => ({ success: false }));
  return !!r.success;
}
