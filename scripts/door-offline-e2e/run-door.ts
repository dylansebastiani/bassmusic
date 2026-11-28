// Runs the real door function locally against fake-supabase.mjs, plus /__db to read the fake tables in tests.
const orig = Deno.serve;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (handler: (r: Request) => Response | Promise<Response>) => orig({ port: Number(Deno.env.get("PORT") || 54329), onListen() {} }, async (req: Request) => {
  if (new URL(req.url).pathname === "/__db") {
    const { __tables } = await import("npm:@supabase/supabase-js@2.45.4");
    return new Response(JSON.stringify(__tables), { headers: { "content-type": "application/json" } });
  }
  return handler(req);
});
await import("../../supabase/functions/door/index.ts");
