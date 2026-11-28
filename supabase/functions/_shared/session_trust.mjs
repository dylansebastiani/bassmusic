// A session made from a fan's member key (the key in fan email links) lasts 24 hours. An email sign-in lasts 30 days.
// A short session is the lower-trust kind: it may show a fan their own page, but it never acts as staff or a promoter.
export const LIMITED_MAX_MS = 2 * 86400000;
export const isLimitedSession = (createdAt, expiresAt) => {
  const c = new Date(createdAt).getTime(), e = new Date(expiresAt).getTime();
  return !(c > 0) || !(e > 0) || e - c <= LIMITED_MAX_MS;
};
