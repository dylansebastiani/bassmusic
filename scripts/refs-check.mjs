// Decides whether the artist-sales refs response is safe to build /go/ pages from.
// In CI only the full list (sent when the build key matches) is acceptable; the public list leaves out hands-off tags.
export function refsProblem(body, { ci, hasKey }) {
  if (!ci) return null;
  if (!hasKey) return "BUILD_REFS_KEY is not set; refusing to build without the full /go/ list";
  const refs = Array.isArray(body?.refs) ? body.refs : [];
  if (!refs.length) return "the artist link list came back empty; refusing to build zero /go/ pages";
  if (body.full !== true) return "the link list is not the full list (BUILD_REFS_KEY missing or wrong on the function); refusing to build without every /go/ page";
  return null;
}
