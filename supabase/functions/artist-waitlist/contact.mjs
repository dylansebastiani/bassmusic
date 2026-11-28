// Pure helpers for the artist waitlist contact and the promoter role label.
// No list, no template, no double opt-in. Callers must post this body to /v3/contacts only.

export function smsNumber(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (digits.length >= 11 && digits.length <= 15) return "+" + digits;
  return null;
}

// A crew account is a promoter. Everyone else on the member list stays a member.
// Artists, buyers and guests are ranked above this in crm-sync, so this never relabels them.
export function subscriberRole(source, onCrew) {
  return source === "promoter" || source === "promoter-open" || onCrew ? "Promoter" : "Member";
}

// Contact attributes only. The returned object has no list and no mail fields.
export function artistContactBody(person, withSms) {
  const name = String(person.name || "").trim();
  const [first, ...rest] = name ? name.split(/\s+/) : [];
  const attributes = { ROLE: "Artist", SOURCE: "artist-waitlist" };
  if (first) attributes.FIRSTNAME = first;
  const last = rest.join(" ");
  if (last) attributes.LASTNAME = last;
  if (withSms && person.phone) attributes.SMS = person.phone;
  return { email: person.email, updateEnabled: true, attributes };
}
