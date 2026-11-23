// Public list of published promoter shows, read by the site build to give each one its own page at subduction.art/<slug>.
// Only what a link preview needs: slug, name and the share image. Self-contained on purpose (no shared imports).
//   GET  ?e=slug   one show's published page design (or null), for the public show page. Nothing private:
//                  the page design is already public once published.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  const one = new URL(req.url).searchParams.get("e");
  if (one !== null) {
    if (!/^[a-z0-9-]{1,80}$/.test(one)) return new Response(JSON.stringify({ page: null }), { status: 404, headers });
    const { data: ev } = await db.from("events").select("page,page_published_at").eq("slug", one).maybeSingle();
    return new Response(JSON.stringify({ page: ev && ev.page_published_at ? ev.page ?? null : null }), { headers: { ...headers, "Cache-Control": "public, max-age=60" } });
  }
  const { data, error } = await db.from("events").select("slug,name,share_url").not("page_published_at", "is", null).not("company_id", "is", null).order("created_at", { ascending: false }).limit(500);
  if (error) { console.error("shows", error.message); return new Response(JSON.stringify({ shows: [] }), { status: 500, headers }); }
  return new Response(JSON.stringify({ shows: data ?? [] }), { headers });
});
