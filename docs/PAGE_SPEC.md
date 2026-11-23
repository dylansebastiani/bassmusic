# Show pages: how a page is described

Every Subduction show page is a short description, not hand-written code: a theme, the show's art,
an ordered list of sections, and an optional custom-styling slot. The renderer (`site/show.html`)
draws it. The studio and Claude edit it. Anything saved is cleaned by `cleanPage()` in
`supabase/functions/_shared/page_spec.ts`, so a typo can't break the page or the checkout.

The show's facts (name, dates, doors, lineup, ticket tiers, venue or secret location, age) are not in
the page. They come from the show itself, so the page and the checkout always agree.

## Theme

| Setting | What it does | Options |
| --- | --- | --- |
| `colors.bg` | Page background | hex, e.g. `#050505` |
| `colors.text` | Main text | hex |
| `colors.muted` | Small print, labels | hex |
| `colors.line` | Borders and card edges | hex |
| `colors.accent` | Buttons and calls to action | hex |
| `colors.nights` | One colour per night, in order | list of hex |
| `fonts.display` | Headlines | Bungee, Anton, Archivo, Space Mono |
| `fonts.body` | Body text | Archivo, Space Mono |
| `frame` | Card corners | `angled` (cut corners), `square`, `rounded` |
| `titles` | Section headings | `outline` (stroked letters) or `solid` |
| `glow` | Soft glow in the night colours | true / false |
| `dots` | Halftone dot texture over the hero | true / false |

## Art

All art must live on the site (`assets/...`) or in Subduction's storage. Anything else is dropped.

| Key | What it is |
| --- | --- |
| `wordmark` | Logo or wordmark (transparent PNG/WebP) |
| `subtitle` | Optional second line as an image (else `brand.subtitle_text` is used) |
| `hero`, `hero_small` | Main background art, full and phone size |
| `nights` | Per night: `figure` (cutout character) and `icon` (small emblem) |
| `flyers` | One flyer per night, in night order |
| `partners` | Partner / sound-system logo strip |
| `share` | 1200×630 link preview image |
| `video` | Teaser MP4 |

## Sections (in page order)

| Type | Looks | Words you can set |
| --- | --- | --- |
| `brand` | `wordmark`, `text` | `subtitle_text` |
| `hero` | `fade`, `full`, `framed` | none |
| `dates` | `flyer`, `simple` | `note` (e.g. "Address drops Jan 1") |
| `flyers` | `grid`, `stack` | `show`: `always` or `after_lineup` |
| `nights` | `cards`, `list` | `soon_text` (when no lineup yet) |
| `tickets` | `cards` | `title`, `fineprint`. Always exactly one. |
| `partners` | `strip` | none |
| `text` | `plain`, `boxed` | `title`, `body` |
| `video` | `teaser` | none (uses `art.video`) |
| `faq` | `list` | `items`: list of `{q, a}` |

## Custom styling

`custom_css` is for the last 5% the sections can't do. It only applies to that show's page, can only
point at Subduction art, and can't load anything from outside.

## Draft and published

`page_draft` is the working copy; `page` is what the public sees. Publishing copies the draft over.
Shows with no page yet keep using the original tickets page.
