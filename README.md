# The Stack

Fan membership funnel for the label. One email field in, instant unreleased track out.
Static site on Cloudflare Pages, data and functions on Supabase, email through Brevo.

- `config/stack.json`: every name, headline, perk and consent sentence. Edit here, nowhere else.
- `site/`: the pages. `/` landing, `/in` welcome track, `/collection` member app (Collection, Coupons, Events, Shop), `/t?c=CODE` track QR landing, `/bonus`, `/privacy`, `/rules`.
- `supabase/functions/`: `subscribe`, `track`, `collection`, `me`, `profile`, `engage`, `confirm`, `unsubscribe`, `email-runner`, `email-webhook`, `meta`, `pageview`, `health`.
- `supabase/migrations/`: schema (`0001`), cron (`0002`), downloads, sign-in codes, and the collection (`0005`).
- `config/catalog.json`: your tracks, events and coupons. `config/catalog.example.json` shows every field.

```
npm run check     # build + sanity checks, run before every push
npm run build     # writes dist/ (what Cloudflare Pages serves)
```

Cloudflare Pages settings: build command `npm run build`, output directory `dist`,
environment variables `SUPABASE_URL`, `TURNSTILE_SITE_KEY`, `SITE_URL`.

Edge Function secrets (set in Supabase → Edge Functions → Secrets): `SITE_URL`, `TURNSTILE_SECRET`, `BREVO_API_KEY`, `FROM_EMAIL`, `FROM_NAME`.
The runner, webhook and IP salt secrets are generated in the database (`settings` table). See SETUP.md for the walkthrough.

## Adding tracks, events and coupons

1. Upload the audio (and cover, and optional WAV) to the private `drops` bucket in Supabase Storage.
2. Add the track to `config/catalog.json` (copy the shape from `config/catalog.example.json`). List the shows it will be placed at in `placements`.
3. `node scripts/catalog.mjs` writes `supabase/seed/catalog.sql` and the printable QR codes in `qr/` (see `qr/README.md`).
4. Run `supabase/seed/catalog.sql` against the project. Re-running is safe; a track's QR code never changes once made.

Scans are logged per track in `track_scans` (views, unlocks, repeat scans), so each artist can be measured.
A QR tagged with a show also enters the member in that show's giveaway.
