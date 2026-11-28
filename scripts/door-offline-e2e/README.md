# Door offline mode, end-to-end test

Runs the real door page in headless Chromium at phone size against the real `supabase/functions/door/index.ts`,
with an in-memory database (`fake-supabase.mjs`) instead of Supabase. Signal is cut by failing the door's
requests and putting the browser offline. Not part of `npm run check` (needs Deno and a browser).

```sh
SUPABASE_URL=https://hxfuelulxsituzcgsvhg.supabase.co node scripts/build.mjs   # CSP on door.html names this host
(cd dist && python3 -m http.server 8080 --bind 127.0.0.1 &)
cd scripts/door-offline-e2e && node make-seed.mjs
FAKE_SEED=seed.json SUPABASE_URL=http://x SUPABASE_SERVICE_ROLE_KEY=x deno run -A --config deno.json run-door.ts &
node e2e.mjs            # offline mode on: 35 checks
# restart run-door.ts with DOOR_OFFLINE=off, then:
node e2e.mjs off        # offline mode off: the door behaves exactly as before, 7 checks
```

The browser's requests go to the live Supabase host name but are answered by the local function. Nothing reaches Supabase.
