// Is this show's venue and address still hidden? Hidden until address_reveal_at. A secret-location show with no
// reveal time stays hidden. Anything else with no reveal time shows, as it always has.
export function addressHeld(ev, now = Date.now()) {
  const at = ev.address_reveal_at ? Date.parse(ev.address_reveal_at) : NaN;
  if (Number.isFinite(at)) return at > now;
  return !!ev.location_secret;
}
