// Pure helpers (no Deno) so scripts/ can test them. Client IP: cf-connecting-ip first, then the LAST x-forwarded-for hop
// (the one the platform's own proxy appended; earlier hops are client-supplied), then x-real-ip. Never one shared bucket.
export function ipFromHeaders(get) {
  const cf = (get("cf-connecting-ip") || "").split(",")[0].trim();
  if (cf) return cf;
  const hops = (get("x-forwarded-for") || "").split(",").map((h) => h.trim()).filter(Boolean);
  if (hops.length) return hops[hops.length - 1];
  const real = (get("x-real-ip") || "").trim();
  return real || "unknown";
}
// Constant-time string compare: the work does not depend on where the first difference is.
export function sameSecret(a, b) {
  const x = String(a ?? ""), y = String(b ?? "");
  let d = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) d |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return d === 0;
}
