# Working on The Stack

Dylan does not write code. Describe what changed in plain words, in one or two sentences, and
say where to look. Run `npm run check` before every push; a failing check means fix, not push.

## Shape
- Static site in `site/` (plain HTML/CSS/JS, no framework; every page must stay under 150KB).
  `scripts/build.mjs` injects `config/stack.json` + public env into `window.STACK`.
- Supabase project `label-waitlist` (`hxfuelulxsituzcgsvhg`). Edge Functions in `supabase/functions/`,
  shared code in `_shared/`. `_shared/stack.json` is a COPY of `config/stack.json`; run
  `node scripts/sync-config.mjs` after editing config, then redeploy functions that read it.
- Email goes through `_shared/email/provider.ts`. Brevo is the only implementation. Swap = one import.

## Rules that aren't negotiable
- RLS is on for every table with NO policies. Only the service role (inside functions) reads or writes.
  Never add an anon policy, never ship the service key to the browser.
- No raw IPs anywhere; `ipHash()` only. No emails or phones in URLs; tokens only.
- Email only on the first screen. Extra fields live on `/in` step 2, skippable.
- Never fake the social-proof number. It shows only from the real count past `socialProofMin`.
- SMS consent box is unchecked by default and the exact wording + timestamp are stored.
- Every email carries List-Unsubscribe headers, a visible unsubscribe link and the mailing address.
- A referral counts only after the referred member confirms (`confirm` function), never on signup.
- Don't put prices, the real label name or anything from the Elite Energy CRM in here.

## Phases
1 (this): capture + instant unlock + welcome email + unsubscribe + privacy.
2: events, QR, kiosk, giveaways, winner picker, referral rewards UI.
3: full 7-email sequence, A/B dashboard, admin, CSV export, broadcast composer.
3.5: fan score, segments, ad exports. 4: paid add-ons.
