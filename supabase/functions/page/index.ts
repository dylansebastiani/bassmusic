import { db } from "../_shared/db.ts";
import { json, err, preflight, clean } from "../_shared/util.ts";
import { requireAdmin } from "../_shared/admin.ts";
import { cleanPage, DEFAULT_THEME, FONTS, SECTIONS, type Page } from "../_shared/page_spec.ts";

// The page studio's backend. Dylan (anyone on the platform staff list) builds and publishes show pages here;
// Claude can edit the same draft from chat. Every save goes through cleanPage(), so nothing unsafe is stored.
//   GET  ?a=list                     every show, whether it has a page, when the draft last changed
//   GET  ?a=get&e=slug               the draft (or the published page, or a starter), plus the option lists
//   GET  ?a=draft-at&e=slug          just when the draft last changed (the studio polls this to pick up Claude's edits)
//   POST {a:"save", e, page}         clean + store the draft
//   POST {a:"publish", e}            the draft goes live
//   POST {a:"start", e, from}        a new draft styled like another show's page (art and words not copied)
const CORS_P = { "Access-Control-Allow-Headers": "content-type, x-admin-token" };
const SLUG = /^[a-z0-9-]{1,80}$/;
const STORAGE_HOSTS = (() => { try { return [new URL(Deno.env.get("SUPABASE_URL") || "").host]; } catch { return []; } })();

// A plain starting page for a show that has nothing yet: the default theme and the usual sections.
const STARTER = (): Page => cleanPage({
  theme: DEFAULT_THEME, art: {},
  sections: [{ type: "brand", variant: "text" }, { type: "hero", variant: "fade" }, { type: "dates", variant: "flyer" }, { type: "flyers", variant: "grid", show: "after_lineup" },
    { type: "nights", variant: "cards" }, { type: "tickets", variant: "cards" }, { type: "partners", variant: "strip" }],
}, STORAGE_HOSTS);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") { const r = preflight(req)!; return new Response(null, { status: 204, headers: { ...Object.fromEntries(r.headers), ...CORS_P } }); }
  const ok = (body: unknown) => json(body, 200, { "Cache-Control": "no-store", ...CORS_P });
  const no = (m: string, s = 400) => json({ error: m }, s, CORS_P);
  const admin = await requireAdmin(req);
  if (!admin) return no("Sign in again.", 401);
  const u = new URL(req.url);
  const a = req.method === "GET" ? u.searchParams.get("a") || "" : "";

  if (req.method === "GET" && a === "list") {
    const { data } = await db.from("events").select("slug,name,starts_at,page_published_at,page_draft_at,company_id,page,page_draft").order("created_at", { ascending: false }).limit(200);
    const { data: cos } = await db.from("companies").select("id,name");
    return ok({ shows: (data || []).map((e) => ({ slug: e.slug, name: e.name, starts_at: e.starts_at, company: cos?.find((c) => c.id === e.company_id)?.name || null,
      has_page: !!e.page, has_draft: !!e.page_draft, published_at: e.page_published_at, draft_at: e.page_draft_at })) });
  }

  if (req.method === "GET" && (a === "get" || a === "draft-at")) {
    const slug = u.searchParams.get("e") || "";
    if (!SLUG.test(slug)) return no("Not found", 404);
    const { data: ev } = await db.from("events").select("slug,name,page,page_draft,page_draft_at,page_published_at,page_published_by").eq("slug", slug).maybeSingle();
    if (!ev) return no("Not found", 404);
    if (a === "draft-at") return ok({ draft_at: ev.page_draft_at });
    const draft = ev.page_draft ?? ev.page;
    return ok({ slug: ev.slug, name: ev.name, draft: draft ? cleanPage(draft, STORAGE_HOSTS) : STARTER(), is_new: !draft,
      published: ev.page ? cleanPage(ev.page, STORAGE_HOSTS) : null, draft_at: ev.page_draft_at, published_at: ev.page_published_at, published_by: ev.page_published_by,
      options: { fonts: FONTS, sections: SECTIONS, frames: ["angled", "square", "rounded"], titles: ["outline", "solid"] } });
  }

  if (req.method !== "POST") return no("Not allowed", 405);
  let b: Record<string, unknown>; try { b = await req.json(); } catch { return no("Bad request"); }
  const slug = clean(b.e, 80) || "";
  if (!SLUG.test(slug)) return no("Not found", 404);
  const { data: ev } = await db.from("events").select("id,page,page_draft").eq("slug", slug).maybeSingle();
  if (!ev) return no("Not found", 404);
  const log = (type: string, meta: Record<string, unknown>) => db.from("engagement_events").insert({ subscriber_id: admin.id, type: "admin:" + type, meta });

  if (b.a === "save") {
    if (JSON.stringify(b.page ?? null).length > 200_000) return no("That page is too big.");
    const page = cleanPage(b.page, STORAGE_HOSTS);
    const { data: row, error } = await db.from("events").update({ page_draft: page }).eq("id", ev.id).select("page_draft_at").single();
    if (error) return no("Couldn't save. Try again.", 500);
    return ok({ draft: page, draft_at: row.page_draft_at });
  }

  if (b.a === "publish") {
    const draft = ev.page_draft ?? ev.page;
    if (!draft) return no("Nothing to publish yet. Save a draft first.");
    const page = cleanPage(draft, STORAGE_HOSTS);
    const at = new Date().toISOString();
    const { error } = await db.from("events").update({ page, page_published_at: at, page_published_by: admin.email }).eq("id", ev.id);
    if (error) return no("Couldn't publish. Try again.", 500);
    await log("page_publish", { slug });
    return ok({ published: page, published_at: at });
  }

  if (b.a === "start") {
    const from = clean(b.from, 80) || "";
    const { data: src } = SLUG.test(from) ? await db.from("events").select("page,page_draft").eq("slug", from).maybeSingle() : { data: null };
    const base = src?.page ?? src?.page_draft;
    if (!base) return no("That show has no page to copy.");
    const s = cleanPage(base, STORAGE_HOSTS);
    // The look carries over (theme, section order and looks, custom styling); art and show-specific words don't.
    const page = cleanPage({ theme: s.theme, art: {}, custom_css: s.custom_css, meta: {},
      sections: s.sections.map((x) => ({ type: x.type, variant: x.variant, show: (x as Record<string, unknown>).show })) }, STORAGE_HOSTS);
    const { data: row } = await db.from("events").update({ page_draft: page }).eq("id", ev.id).select("page_draft_at").single();
    return ok({ draft: page, draft_at: row?.page_draft_at ?? null });
  }

  return no("Bad request");
});
