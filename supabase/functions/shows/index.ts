// Public list of published promoter shows, read by the site build to give each one its own page at subduction.art/<slug>.
// Only what a link preview needs: slug, name and the share image. Self-contained on purpose (no shared imports).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  const { data, error } = await db.from("events").select("slug,name,share_url").not("page_published_at", "is", null).not("company_id", "is", null).order("created_at", { ascending: false }).limit(500);
  if (error) { console.error("shows", error.message); return new Response(JSON.stringify({ shows: [] }), { status: 500, headers }); }
  return new Response(JSON.stringify({ shows: data ?? [] }), { headers });
});
