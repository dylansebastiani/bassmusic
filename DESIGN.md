# Website design notes

Read this before any visual or copy work on subduction.art. Colors, type, and UI patterns below were checked against the live CSS in this repo and the brand kit. Do not invent new colors or fonts.

## Brand colors

Use only these. Prefer the CSS variables already on the site when they exist.

- **Acid Green** (`hot`): `#B6FF00`. CSS `--hot` in `site/index.html`, `site/assets/app.css`, and other page stylesheets. The one brand color. Buttons with black text, the last word of a headline, a kicker. About one hit per view. Never body text on a light page. Never a green mark on bone or white.
- **Void** (`bg`): `#000000`. CSS `--bg`. Every page starts on pure black.
- **Bone** (`fg`): `#F4F1EE`. CSS `--fg`. Primary text and the wordmark on dark. Use this instead of `#FFFFFF` for text.
- **Chrome**: `#CFC9C5`. Not a CSS variable. Hardcoded for nav links in `site/index.html` and for some dates and labels elsewhere.
- **Deep Green**: `#1D2A00`. Used today for the selected-tab count in `site/assets/people.css` and for the fee rate on the highlighted homepage comparison row in `site/index.html`. Do not use it as ordinary body text.
- **Ash** (`mute`): `#9A9490`. CSS `--mute`. Secondary text, captions, and Space Mono labels on black.
- **Smoke**: `#6C6567`. Not a CSS variable. Hardcoded input borders and button seams in `site/index.html` and `site/assets/app.css`.
- **Line**: `#2A2627`. CSS `--line`. Hairlines and card borders on black.
- **Panel**: `#151515`. Fee-bar track on the homepage and on `/fees`.
- **Panel 2**: `#1C1C1C`. Footer and solid header borders on the homepage and `/artists`.

Two more tokens exist for print and docs only. They are not in the live site CSS. Do not use them on web pages.

- **Ink Grey**: `#3A3634`
- **Bone Rule**: `#D8D2CD`

The live CSS also has one-off tints such as `#E6E1DD`, `#B5AFAB`, `#8A8486`, `#4A4644`, and `#050505`. They are hover or art details, not brand colors. Do not build new work with them.

Button hover on the site turns the background `#fff`. That is an existing pattern. Do not use pure white for body text.

T.O.F.T.U. orange, violet, and gold belong to that event. They live under `.toftu` in `site/assets/tix.css`. Never use them on Subduction pages.

## Fonts

All brand fonts are self-hosted in `site/assets/fonts.css`. Font files are in `site/assets/fonts/`.

- **Anton** (`--disp`): headlines, buttons, and the wordmark. Always uppercase.
- **Archivo** (`--text`): body, leads, names, and prices. Weights 400, 500, and 600. Homepage body is Archivo 15px at line-height 1.55.
- **Space Mono** (`--mono`): kickers, labels, URLs, ticket meta, and footers. Usually uppercase and tracked.

Homepage type in `site/index.html`:

- Hero is Anton, about `clamp(84px, 8vw, 120px)` on desktop and smaller on phones, line-height around 0.92. The last word is acid green (`.disp em` or `.hot`). Current line: "Your show. Your page. Your money."
- Section headlines are Anton, large clamp sizes.
- Kickers (`.kick`) are Space Mono 12px, 0.14em tracking, uppercase, acid green.
- Buttons are Anton 22px, 0.08em tracking, uppercase. Phone buttons go down to 20px.
- Leads are Archivo. The homepage lead uses a one-off light bone `#E6E1DD`. For new work, use bone or ash rather than a new grey.

**Bungee** is loaded in `site/assets/fonts.css` and preloaded on `/underground`. It is the display font for T.O.F.T.U. in `site/assets/tix.css` (body class `toftu`). It is also used for artist names in `site/assets/artist.css`. Do not add Bungee to the Subduction homepage or other Subduction marketing pages.

## Logos, buttons, and spacing

This is how the site looks today. Match it. Do not invent a new system.

**Logo**

- The mark is the slash square. The site uses `site/assets/logo-64.webp` in the header (config also points `logoUrl` at `assets/logo.png`).
- Homepage header in `site/index.html`: the mark is 26px, then a 10px gap, then the wordmark (`.brand`). The wordmark is Anton 20px, uppercase, 0.08em tracking, in bone.
- The footer lockup is the same mark at 28px.
- `/artists` uses the same 26px webp lockup. `/fees` uses the 64px webp alone.
- If `logoUrl` is missing, `site/index.html` falls back to a three-bar SVG. That fallback is not the brand mark. Do not copy it.
- Keep corners square. Do not add a glow, gradient, drop shadow, or outline to the Subduction logo.

**Buttons and inputs**

- Primary button class is `.btn` in `site/index.html` and `site/assets/app.css`. Acid green background, black text, square corners (`border-radius: 0`), Anton uppercase, 0.08em tracking, padding about 14px 24px 12px. Hover and focus turn the background white.
- The header CTA (`.bar .go`) is the same idea, a bit smaller.
- Ghost buttons are transparent with bone text and a smoke or line border, still square.
- Inputs are square, black fill, smoke border, white border on focus.

**Spacing and layout**

- Every page sits on void black. The homepage CSS comment in `site/index.html` says promoters first, artists second, fans third.
- Common page inset is about 16px to 18px, plus safe-area padding.
- Section gaps are often 14px to 22px. Cards and lists use `--line` hairlines.
- App and member pages (`.wrap` in `site/assets/app.css`) cap at 560px.
- No rounded corners on buttons, cards, or inputs.

## Dylan's rules

- Never guess colors. Use only the tokens above.
- Keep it dead simple. Pages should feel mostly self-running.
- Audience order: promoters first, then artists, then fans.
- No "Powered by Subduction" on promoter surfaces.
- Fast pages: use webp, set width and height or `aspect-ratio` so the layout does not jump, lazy-load images below the fold, and do not pile heavy scripts on first load.
  - The homepage already lazy-loads the section art webp files and uses a mobile `picture` source.
  - `/underground` flyer thumbs are `poster-*-sm.webp` at 480x600, with `aspect-ratio: 4/5` in `site/assets/tix.css`. `#nights` and `#shop` reserve min-height. Do not undo that.
- Copy voice: no em dashes, no semicolons, no rhetorical questions, and never the phrase "follow up".
- Subduction is a ticketing and artist platform. Never call it a label.

## Do not touch

**T.O.F.T.U.** (slug `underground`, event `63b511f3-d838-404f-9c2e-5d4b98fbf013`)

Do not change its event content, checkout, ticket emails, artist passes, door, or Stripe account. The show page lives at `/underground/` (`site/tickets.html` plus `site/assets/tix.css` and `site/assets/tickets.js`). Its look and colors are the event's, not Subduction's.

**Held Supabase functions.** Never deploy or edit these:

- `tickets`
- `stripe-webhook`
- `door`
- `admin`
- `subscribe`
- `email-runner`

## Likes / dislikes

**Likes**

- Acid green used once per view, with black text on it
- Square corners, void black canvas, bone text
- Self-hosted fonts, webp images, and reserved image space
- Short, flat copy
- Promoter-first pages that run themselves

**Dislikes**

- Guessing colors or adding new ones
- Calling Subduction a label
- "Powered by Subduction" on promoter surfaces
- Em dashes, semicolons, rhetorical questions, and the phrase "follow up"
- Heavy scripts or layout shift on load
- Using T.O.F.T.U. colors or art in Subduction brand UI

Dylan will add more likes and dislikes here.
