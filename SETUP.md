# Setting up The Stack (one time)

Everything below is clicking around in three dashboards. No code. Do them in order.

## 1. Supabase (already created: project `label-waitlist`)

1. Run the schema: Claude does this from the chat (`supabase/migrations/0001_phase1.sql`).
2. Edge Functions → Secrets. Add these. Claude will prompt each one so the value never touches the chat:
   - `SITE_URL`: your site address, e.g. `https://bassmusic.pages.dev` (change when the domain lands)
   - `IP_SALT`: any long random string. Never change it once live.
   - `TURNSTILE_SECRET`: from Cloudflare, step 3
   - `BREVO_API_KEY`: from Brevo, step 4
   - `FROM_EMAIL` / `FROM_NAME`: the address and name emails come from, e.g. `dylan@mail.yourdomain.com` / `Dylan @ LABEL`
   - `RUNNER_SECRET`: any long random string (the cron job uses it to call the email runner)
   - `WEBHOOK_SECRET`: any long random string (Brevo uses it to report bounces)
3. Claude deploys the functions and turns on the 10-minute email cron.

## 2. GitHub → Cloudflare Pages

1. Cloudflare dashboard → Workers & Pages → Create → Pages → **Connect to Git** → pick `dylansebastiani/bassmusic`.
2. Build settings: Framework **None** · Build command `npm run build` · Output directory `dist`.
3. Environment variables (Production):
   - `SUPABASE_URL` = `https://hxfuelulxsituzcgsvhg.supabase.co`
   - `TURNSTILE_SITE_KEY` = from step 3
   - `SITE_URL` = the `*.pages.dev` address Cloudflare gives you (or your domain later)
4. Save and deploy. Every push to `main` redeploys in about a minute.
5. When you have a domain: Pages project → Custom domains → add it. Then update `SITE_URL` in both places.

## 3. Cloudflare Turnstile (bot check, free)

Cloudflare dashboard → Turnstile → Add site → domain = your pages.dev address (add the real domain later) → mode **Invisible**.
Copy the **Site key** into Cloudflare Pages env (`TURNSTILE_SITE_KEY`) and the **Secret key** into Supabase secrets (`TURNSTILE_SECRET`).

## 4. Brevo (email, free: 300/day)

1. brevo.com → sign up (free plan).
2. Settings → SMTP & API → API Keys → Generate. Paste into Supabase as `BREVO_API_KEY`.
3. Senders, Domains & Dedicated IPs → Domains → Add `mail.yourdomain.com`. Brevo shows DNS records; add them in Cloudflare DNS (step 5).
4. Senders → add `dylan@mail.yourdomain.com` and verify it.
5. Transactional → Settings → Webhook → Add: URL = `https://hxfuelulxsituzcgsvhg.supabase.co/functions/v1/email-webhook?k=YOUR_WEBHOOK_SECRET`, events: hard bounce, spam, unsubscribed, opened, blocked, invalid email.

Until you own a domain, Brevo can send from a verified Gmail address, but Gmail/Yahoo will treat it as less trustworthy. Fine for testing, not for a real list.

## 5. DNS (once you have a domain, in Cloudflare DNS)

Sending from a subdomain keeps your main domain's reputation clean.

| Type | Name | Value | Why |
|---|---|---|---|
| TXT | `mail` | `v=spf1 include:spf.brevo.com -all` | SPF: Brevo may send as you |
| TXT | `mail._domainkey.mail` | (the DKIM value Brevo shows you) | DKIM: signs each email |
| TXT | `_dmarc.mail` | `v=DMARC1; p=quarantine; rua=mailto:dmarc@yourdomain.com` | DMARC: tells inboxes what to do with fakes |
| TXT | `@` | `brevo-code:...` (shown by Brevo) | proves you own the domain |

Brevo's domain page shows the exact names and values; use theirs if they differ from this table. After adding, click **Authenticate** in Brevo. Green ticks = done.

## 6. Keep-alive (so the free database never sleeps)

GitHub repo → Settings → Secrets and variables → Actions → New secret:
`HEALTH_URL` = `https://hxfuelulxsituzcgsvhg.supabase.co/functions/v1/health`.
The workflow in `.github/workflows/keepalive.yml` pings it daily.

## 7. First drop

Supabase → Storage → bucket `drops` → upload your MP3 and artwork. Then tell Claude the file names, the title and the artist; it adds the `drops` row and marks it current. Same for the bonus track.
