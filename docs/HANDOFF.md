# Subduction: how the site works and what it takes to run it

Written for Dylan to bring into research sessions. Plain words, no code. Everything below is what exists today,
not what is planned, unless the section says so.

## What it is, in one paragraph

Subduction is a new bass music label with a free members' club at **subduction.art**. Stickers with QR codes go
out at shows. A fan scans one, types their email, and a free unreleased track lands in "their collection" on the
site. The label gets an email list that grows every time a sticker is scanned. That list is the whole point:
it is the direct line to fans for drops and show announcements, and it is the asset the label owns.

## What a fan actually experiences

1. Sees a sticker at a show. Scans it. Lands on a page showing the track and artist.
2. Types their email. One box, nothing else.
3. The track unlocks right there. They can play it or download the WAV.
4. A welcome email arrives with a link back to their collection and the cover art.
5. On their collection page they can optionally add first name, phone, ZIP, and tick a box for texts.
   None of this is required.
6. Every future sticker they scan adds another track to the same collection. Shows show up in an Events tab.
7. They get a "friend link". When a friend joins through it and confirms, it counts toward small rewards.
8. Returning on a new device: they type their email and get a 6-digit code by email. No passwords.
9. Every email has an unsubscribe link. One click and they are out.

Privacy rule baked in: scanning a sticker with an email that is already on the list only shows tracks and events.
Personal info is only visible after signing in with the emailed code.

## What Dylan (or staff) does

There is a staff page at **subduction.art/admin.html**. It is the only control panel. From it you can:

- Upload a track (WAV + cover art, title, artist, description). The site generates its QR code and sticker link.
- Switch a track's QR on or off. Mark one as the "welcome" track new members get.
- Add shows (name, venue, date, address, ticket link). Each show gets its own sticker link so you can see which
  show produced which signups.
- Record how many stickers went out per show. The page shows scans per sticker.
- See the member list, total count, and who is confirmed.
- Pick which Brevo list new members sync into.

Everything else runs by itself.

## What runs by itself today

- Hosting, rebuilds, and publishing. The site rebuilds every 6 hours to pick up tracks added from the staff page.
- Signup, track unlock, welcome email, sign-in codes, unsubscribe.
- Bot protection on the signup form.
- Syncing members into Brevo (the email tool) once a list is picked on the staff page.
- A daily health check that pings the backend.
- Referral counting (only after the referred person confirms, so it cannot be gamed by typing fake emails).

## The pieces and where they live

| Piece | What it does | Account / vendor | Cost tier today |
|---|---|---|---|
| GitHub (dylansebastiani/bassmusic) | Holds all the code. Publishes the site. | GitHub | Free |
| GitHub Pages | Hosts the website | GitHub | Free |
| Domain subduction.art | The address | Domain registrar (check which) | Annual renewal |
| Supabase (project `label-waitlist`) | Database, file storage for WAVs and covers, and the backend functions | Supabase | Free tier now; paid tier needed as files and members grow |
| Brevo | Sends the emails, holds the marketing list | Brevo | Free tier now; paid as volume grows |
| Cloudflare Turnstile | Stops bots on the signup form | Cloudflare | Free |

Access to all of these sits with Dylan's accounts. Anyone hired to run this needs to be added to GitHub,
Supabase and Brevo. Nobody needs the domain registrar unless DNS changes.

## Data we hold on fans

Email, optional first name, phone, ZIP, text-message consent (with exact wording and timestamp), which tracks
they unlocked, which shows they scanned at, referral links, and a hashed version of their IP for abuse
prevention. No raw IPs, no passwords, no payment info. Database is locked so only the backend can read it.

## Rules the system enforces that a hire needs to know

- Email is the only required field. Everything else is optional and skippable.
- The "members joined" number on the homepage only appears once the real count passes 100. Never faked.
- Text consent is off by default and the wording shown is stored with the time it was ticked.
- Every email carries unsubscribe headers, a visible unsubscribe link, and a mailing address.
- Referrals count only after the friend confirms by email.
- No prices, and nothing from Dylan's day-job CRM, goes in this project.

## What is NOT built yet (the roadmap as written)

**Phase 2**: show check-in, QR kiosk mode for a table at shows, referral rewards actually delivered, winner picker.
Giveaways were dropped from the plan.

**Phase 3**: a 7-email welcome sequence, A/B test dashboard, CSV export, a broadcast composer so emails can be
written and sent from the staff page instead of inside Brevo.

**Phase 3.5**: fan scoring, segments (by city, by show, by activity), ad audience exports.

**Phase 4**: paid add-ons.

Right now a drop announcement or show email has to be written and sent inside Brevo by hand.

## Open loose ends as of today

- Brevo list not yet picked on the staff page, so members are not flowing into Brevo yet.
- Brevo sender domain authentication should be confirmed so emails land in inboxes, not spam.
- Mailing address in the footer is still a placeholder ("PO Box TBD").
- Facebook Messenger sometimes shows no cover art for one track link; the server is right, Facebook's cache is stale.
- 9 members in the database, most of them test accounts.
- Social links: only Instagram is filled in.

## What "hands off and growing" actually needs

The software needs almost no babysitting. Growth needs people and content. Honest view of the gaps:

**Content and release side (the engine)**
- Someone producing or sourcing unreleased tracks on a cadence. No tracks, no reason to scan.
- Cover art per track. Stickers per track and per show. Someone to design and get them printed.
- Someone physically at shows putting stickers out, or artists and promoters bribed to do it.

**Audience side**
- Someone writing and sending the emails and texts: drop announcements, show reminders, the welcome sequence.
- Someone running Instagram/TikTok so the sticker has a face attached.
- Promoter and venue relationships so stickers are welcome at shows.

**Operations side**
- Someone who watches the staff page weekly: uploads tracks, adds shows, enters sticker counts, checks the
  health ping, upgrades Supabase or Brevo plans when limits approach.
- A technical person on call for breakage or new features. Could be a freelancer at a few hours a month.
  All the code is readable and documented, and any competent web developer who knows JavaScript and Supabase
  can pick it up.

**Legal and money**
- A real mailing address for the footer (PO Box or registered agent).
- Text messaging compliance if texts go out: a 10DLC registration with a carrier-approved sender.
- Artist agreements for releasing tracks free to members.
- A business entity and bank account so vendor bills and any future revenue are clean.

## Roles worth researching, in rough priority

1. **Label manager / A&R** (part time). Owns the release calendar and artist relationships. Without this nothing
   else matters.
2. **Street team or promo lead**. Gets stickers into venues. Can be artists themselves with a per-show budget.
3. **Email and community manager** (part time, could be the same person as 2). Writes the drop and show emails,
   runs socials, watches the numbers on the staff page.
4. **Designer** (freelance, per project). Cover art, sticker sheets, the look of the label.
5. **Developer** (freelance, on call). Phase 2 and 3 builds, and fixes. Skills: JavaScript, Supabase, Deno,
   email deliverability. A few hours a month at idle.
6. **Music lawyer** (one-off). Artist release agreements and the texting consent language.

## Questions to answer in research

- What does a part-time label manager cost in the bass music scene, and are there people who do this for several
  small labels at once?
- Who prints durable, cheap QR stickers that survive a venue wall, and in what quantities?
- What do Supabase and Brevo cost at 1,000, 10,000 and 50,000 members, and at what point does moving email
  to a different provider make sense?
- What is required for compliant text messaging in the US (10DLC) and is it worth it at this size?
- Which bass labels run a similar free-track-for-email model, and what do their email cadences look like?
- What is a fair deal structure for artists giving a track to members for free?
