// Staff actions for the People page: one-tap email, mark contacted, notes, "they said stop".
// Plain JS with everything passed in (database, mailer, config), so scripts/owner-staff.test.mjs can run it with stubs.
// Every action is logged to engagement_events (type staff:*) with the staff member as subscriber_id.
// Email goes out one at a time as a plain personal note from Dylan, never in bulk.

// T.O.F.T.U. people are never contacted from this tool.
export const TOFTU_EVENT = "63b511f3-d838-404f-9c2e-5d4b98fbf013";
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const SEND_KINDS = ["nudge_stripe", "invite", "pitch", "custom"];
export const LOG_KINDS = ["contacted", "note", "stop"];
export const HOURLY_LIMIT = 20;
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// deps: { db, brevo, config:{mailingAddress,fromEmail,fromName}, fromEmail, fnBase, brevoBlocked(email) -> true|false|null }
export function makeStaff(deps) {
  const { db, brevo, config, fnBase } = deps;
  const json = deps.json || ((body, status = 200) => ({ status, body }));

  // Exact match on the lowercased address. Never a pattern match, where "%" and "_" would act as wildcards.
  // Returns { known, toftu }. Any T.O.F.T.U. order, invite or signup makes the address off limits.
  async function lookup(email) {
    const r = await Promise.all([
      db.from("companies").select("id").eq("contact_email", email).limit(1),
      db.from("demo_leads").select("email,token").eq("email", email).limit(1),
      db.from("artist_waitlist").select("email").eq("email", email).limit(1),
      db.from("artist_invites").select("id,event_id").eq("email", email).limit(200),
      db.from("ticket_orders").select("id,event_id").eq("email", email).limit(200),
      db.from("subscribers").select("id,event_id,status,unsubscribe_token").eq("email", email).limit(1),
    ]);
    if (r.some((x) => x.error)) return { error: true };
    const rows = (i) => r[i].data || [];
    const toftu = [3, 4, 5].some((i) => rows(i).some((x) => x.event_id === TOFTU_EVENT));
    const sub = rows(5)[0] || null;
    const known = [0, 1, 2, 3, 4, 5].some((i) => rows(i).length > 0);
    return { known, toftu, sub, lead: rows(1)[0] || null };
  }

  // True when we must not email them: any subscriber status other than active (unsubscribed, bounced,
  // complained, sunset, deleted), a "They said stop" note, or a block on the Brevo contact (demo ticket unsubscribe).
  async function stopped(email, sub) {
    if (sub && sub.status !== "active") return true;
    const { data: stop, error } = await db.from("engagement_events").select("id").eq("type", "staff:stop").eq("meta->>to", email).limit(1);
    if (error || (stop || []).length > 0) return true;
    // null = couldn't ask Brevo. Fail closed.
    const blocked = await deps.brevoBlocked(email);
    return blocked !== false;
  }

  async function guard(to) {
    const k = await lookup(to);
    if (k.error) return { fail: json({ error: "Couldn't check that address. Try again." }, 500) };
    if (!k.known || k.toftu) return { fail: json({ error: "Only people already in Subduction can be emailed from here." }, 400) };
    return { k };
  }

  // Claim the slot BEFORE calling Brevo. The claim row is written first, then we count in a fixed order
  // (created_at, id), so parallel requests can't all pass: only the earliest claims survive, the rest delete theirs.
  async function claim(admin, to, kind, subject) {
    const ins = await db.from("engagement_events").insert({ subscriber_id: admin.id, type: "staff:email", meta: { to, kind, subject, ok: null, pending: true, by: admin.email } }).select("id,created_at").single();
    if (ins.error || !ins.data) return { fail: json({ error: "Couldn't send. Try again." }, 500) };
    const id = ins.data.id;
    const drop = () => db.from("engagement_events").delete().eq("id", id);
    const hour = new Date(Date.now() - 3600e3).toISOString(), ten = new Date(Date.now() - 600e3).toISOString();
    const [mine, theirs] = await Promise.all([
      db.from("engagement_events").select("id").eq("type", "staff:email").eq("subscriber_id", admin.id).gte("created_at", hour).order("created_at", { ascending: true }).order("id", { ascending: true }).limit(HOURLY_LIMIT),
      db.from("engagement_events").select("id").eq("type", "staff:email").eq("meta->>to", to).gte("created_at", ten).order("created_at", { ascending: true }).order("id", { ascending: true }).limit(1),
    ]);
    if (mine.error || theirs.error) { await drop(); return { fail: json({ error: "Couldn't send. Try again." }, 500) }; }
    if (!(mine.data || []).some((r) => r.id === id)) { await drop(); return { fail: json({ error: "That's 20 emails this hour. Try again later." }, 429) }; }
    if (((theirs.data || [])[0] || {}).id !== id) { await drop(); return { fail: json({ error: "They got an email from here in the last 10 minutes." }, 429) }; }
    return { id };
  }

  // The real unsubscribe link for this person: their member link, or their demo ticket link.
  // People who are in neither list get a plain address to write to, never a promise that a reply is read by a robot.
  function unsubLink(k) {
    if (k.sub && k.sub.unsubscribe_token) return `${fnBase}/unsubscribe?u=${k.sub.unsubscribe_token}`;
    if (k.lead && k.lead.token) return `${fnBase}/demo?a=unsub&t=${k.lead.token}`;
    return null;
  }

  async function post(b, admin) {
    const to = String(b.to || "").trim().toLowerCase();
    if (!EMAIL_RE.test(to) || to.length > 254) return json({ error: "That email doesn't look right." }, 400);

    if (b.a === "log") {
      const kind = String(b.kind || "");
      if (!LOG_KINDS.includes(kind)) return json({ error: "Unknown action." }, 400);
      const text = String(b.text || "").trim().slice(0, 1000);
      if (kind === "note" && !text) return json({ error: "Write a note first." }, 400);
      const g = await guard(to); if (g.fail) return g.fail;
      const { error } = await db.from("engagement_events").insert({ subscriber_id: admin.id, type: "staff:" + kind, meta: { to, text: text || null, by: admin.email } });
      if (error) { console.error("owner log", error.message); return json({ error: "Couldn't save. Try again." }, 500); }
      return json({ ok: true });
    }

    if (b.a === "send") {
      const kind = String(b.kind || "custom");
      const subject = String(b.subject || "").trim().replace(/[\r\n]+/g, " ");
      const body = String(b.body || "").trim();
      const name = String(b.name || "").trim().slice(0, 80) || null;
      if (!SEND_KINDS.includes(kind)) return json({ error: "Unknown email." }, 400);
      if (subject.length < 2 || subject.length > 140) return json({ error: "Subject needs 2 to 140 characters." }, 400);
      if (body.length < 10 || body.length > 4000) return json({ error: "Message needs 10 to 4000 characters." }, 400);
      const g = await guard(to); if (g.fail) return g.fail;
      if (await stopped(to, g.k.sub)) return json({ error: "They asked not to get email. Not sent." }, 409);
      const c = await claim(admin, to, kind, subject); if (c.fail) return c.fail;

      const addr = String(config.mailingAddress || "").trim();
      const from = deps.fromEmail || String(config.fromEmail || "");
      const link = unsubLink(g.k);
      const unsub = link || `mailto:${from}?subject=unsubscribe`;
      const foot = `Subduction${addr && !/TBD/i.test(addr) ? " · " + addr : ""}`;
      const paras = body.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
      const html = `<!doctype html><html><body style="margin:0;padding:24px;font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111">${paras}` +
        `<p style="margin:28px 0 0;font-size:12px;color:#777">${esc(foot)}<br><a href="${esc(unsub)}" style="color:#777">Unsubscribe</a>${link ? "" : ` (this opens an email to ${esc(from)}; we remove you by hand)`}</p></body></html>`;
      const text = `${body}\n\n--\n${foot}\nUnsubscribe: ${unsub}`;
      let res;
      try {
        res = await brevo.send({ to: { email: to, name }, subject, html, text, tags: ["staff-" + kind], fromName: String(config.fromName || "Dylan @ Subduction"),
          headers: link ? { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : { "List-Unsubscribe": `<${unsub}>` } });
      } catch (e) { res = { ok: false, status: 0, error: String((e && e.message) || e) }; }
      await db.from("engagement_events").update({ meta: { to, kind, subject, ok: res.ok, error: res.ok ? null : String(res.error || "").slice(0, 200), by: admin.email } }).eq("id", c.id);
      if (!res.ok) { console.error("owner send", res.status, res.error); return json({ error: "Brevo didn't send it. Try again in a minute." }, 502); }
      return json({ ok: true });
    }
    return json({ error: "Unknown action." }, 400);
  }
  return { post, lookup, stopped };
}
