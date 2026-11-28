// Which short-link tags the public list may show. The full list stays available to the site build (with its key).
// A tag is hidden when its show is not approved, is hands-off (T.O.F.T.U. and its company), or the artist is a secret act.
export const UNDERGROUND_EVENT_ID = "63b511f3-d838-404f-9c2e-5d4b98fbf013";
const TAG = /^[a-z0-9]{1,24}$/;

export function handsOffShow(ev, co) {
  return ev.id === UNDERGROUND_EVENT_ID || ev.slug === "underground" || co?.slug === "quantum" || co?.legacy_stripe === true;
}
// events: {id: {id, slug, review_status, company_id}}, companies: {id: {slug, legacy_stripe}},
// secretActs: {eventId: [lowercase act names marked secret in the lineup draft]}
export function publicRefs({ invites, links, events, companies, secretActs }) {
  const showOk = (eventId) => {
    const ev = events[eventId];
    if (!ev || ev.review_status !== "approved") return false;
    const co = companies[ev.company_id];
    if (!co) return false;                      // unknown company: hide rather than guess
    return !handsOffShow(ev, co);
  };
  const out = [];
  for (const v of invites || []) {
    if (!showOk(v.event_id)) continue;
    if ((secretActs?.[v.event_id] || []).includes(String(v.name || "").trim().toLowerCase())) continue;
    if (TAG.test(v.sell_ref || "")) out.push(v.sell_ref);
  }
  for (const t of links || []) if (showOk(t.event_id) && TAG.test(t.tag || "")) out.push(t.tag);
  return out;
}
