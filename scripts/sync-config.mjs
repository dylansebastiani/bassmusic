import { copyFileSync } from "node:fs";
const root = new URL("..", import.meta.url).pathname;
copyFileSync(root + "config/stack.json", root + "supabase/functions/_shared/stack.json");
console.log("config synced to functions");
