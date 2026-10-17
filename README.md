# The Stack

Fan membership funnel for the label. One email field in, instant unreleased track out.
Static site on Cloudflare Pages, data and functions on Supabase, email through Brevo.

- `config/stack.json`: every name, headline, perk and consent sentence. Edit here, nowhere else.
- `site/`: the pages. `/` landing, `/in` unlock, `/bonus`, `/privacy`, `/rules`.
- `supabase/functions/`: `subscribe`, `me`, `profile`, `engage`, `confirm`, `unsubscribe`, `email-runner`, `email-webhook`, `meta`, `pageview`, `health`.
- `supabase/migrations/`: schema (`0001`) and the cron job (`0002`).

```
npm run check     # build + sanity checks, run before every push
npm run build     # writes dist/ (what Cloudflare Pages serves)
```

Cloudflare Pages settings: build command `npm run build`, output directory `dist`,
environment variables `SUPABASE_URL`, `TURNSTILE_SITE_KEY`, `SITE_URL`.

Edge Function secrets (set in Supabase → Edge Functions → Secrets): `SITE_URL`, `TURNSTILE_SECRET`, `BREVO_API_KEY`, `FROM_EMAIL`, `FROM_NAME`.
The runner, webhook and IP salt secrets are generated in the database (`settings` table). See SETUP.md for the walkthrough.
