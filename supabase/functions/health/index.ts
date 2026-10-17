import { db } from "../_shared/db.ts";
import { json } from "../_shared/util.ts";

// Hit daily by the keep-alive job. A write keeps the free project from pausing.
Deno.serve(async () => {
  const { error } = await db.from("settings").upsert({ key: "last_ping", value: JSON.stringify(new Date().toISOString()), updated_at: new Date().toISOString() });
  return json({ ok: !error, at: new Date().toISOString() }, error ? 500 : 200);
});
