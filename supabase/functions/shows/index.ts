// Public list of approved, published promoter shows, read by the site build to give each one its own page
// at subduction.art/<slug>. A show a promoter has only sent (draft, submitted, rejected) is not in this list
// and has no share image here. Only what a link preview needs: slug, name and the share image.
// Self-contained on purpose (no shared imports).
//   GET  ?e=slug   one approved show's published page design (or null). Nothing private.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  const one = new URL(req.url).searchParams.get("e");
  if (one !== null) {
    if (!/^[a-z0-9-]{1,80}$/.test(one)) return new Response(JSON.stringify({ page: null }), { status: 404, headers });
    const { data: ev } = await db.from("events").select("page,page_published_at,review_status").eq("slug", one).maybeSingle();
    // Not approved: say so with an empty page, and don't cache it, so the moment it is approved the design can show.
    if (ev && ev.review_status !== "approved") return new Response(JSON.stringify({ page: null }), { status: 404, headers: { ...headers, "Cache-Control": "no-store" } });
    return new Response(JSON.stringify({ page: ev && ev.page_published_at ? ev.page ?? null : null }), { headers: { ...headers, "Cache-Control": "public, max-age=60" } });
  }
  const { data, error } = await db.from("events").select("slug,name,share_url,review_status").eq("review_status", "approved").not("page_published_at", "is", null).not("company_id", "is", null).order("created_at", { ascending: false }).limit(500);
  if (error) { console.error("shows", error.message); return new Response(JSON.stringify({ shows: [] }), { status: 500, headers }); }
  return new Response(JSON.stringify({ shows: data ?? [] }), { headers });
});
