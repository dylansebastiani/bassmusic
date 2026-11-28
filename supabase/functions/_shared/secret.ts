// Constant-time compare for the runner secret, so a wrong guess can't be timed.
export function sameSecret(given: string | null, secret: string | null): boolean {
  if (!given || !secret) return false;
  const a = new TextEncoder().encode(given), b = new TextEncoder().encode(secret);
  let d = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) d |= (a[i] ?? 0) ^ b[i];
  return d === 0;
}
