// Midwest cities that always get their own /shows/<slug> page, with or without a show up.
// A city with a show in the directory gets a page too, even if it is not listed here.
export const KNOWN_CITIES = [
  ["Chicago", "IL"], ["Peoria", "IL"], ["Springfield", "IL"], ["Champaign", "IL"], ["Bloomington", "IL"], ["Rockford", "IL"], ["Normal", "IL"],
  ["Indianapolis", "IN"], ["Bloomington", "IN"], ["Fort Wayne", "IN"], ["South Bend", "IN"],
  ["Des Moines", "IA"], ["Iowa City", "IA"], ["Cedar Rapids", "IA"],
  ["Kansas City", "MO"], ["St. Louis", "MO"], ["Columbia", "MO"], ["Lawrence", "KS"], ["Wichita", "KS"],
  ["Detroit", "MI"], ["Grand Rapids", "MI"], ["Ann Arbor", "MI"],
  ["Minneapolis", "MN"], ["St. Paul", "MN"], ["Duluth", "MN"],
  ["Omaha", "NE"], ["Lincoln", "NE"], ["Fargo", "ND"], ["Sioux Falls", "SD"],
  ["Columbus", "OH"], ["Cleveland", "OH"], ["Cincinnati", "OH"],
  ["Milwaukee", "WI"], ["Madison", "WI"],
];

// JSON for an inline <script>: "<" is escaped so data like "</script>" can never close the tag.
export const jsonInline = (x) => JSON.stringify(x).replace(/</g, "\\u003c");
