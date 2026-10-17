// Builds a click-through preview of the site as a Claude artifact: same pages,
// same styles, but every backend call is faked so it works with no database.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const root = new URL("..", import.meta.url).pathname;
const out = process.argv[2] || join(root, "preview");
mkdirSync(out, { recursive: true });
const cfg = JSON.parse(readFileSync(join(root, "config/stack.json"), "utf8"));
const css = readFileSync(join(root, "site/style.css"), "utf8");
const app = readFileSync(join(root, "site/app.js"), "utf8");
const stub = `
// PREVIEW: no network. Fake the backend so the flow can be clicked through.
(function(){var S=window.Stack;var demo={first_name:null,referral_code:"K7PX2Q",confirmed_referrals:1,confirmed:false,profile_done:false,event_entered:!!S.q.get("e"),
 drop:{title:"UNTITLED 01 (UNRELEASED)",artist:"${cfg.labelName}",audio_url:null,artwork_url:null}};
 S.api=function(name,body){return new Promise(function(res){setTimeout(function(){
   if(name==="subscribe")res({access_token:"demo",already_member:/again|back/.test(body.email||""),event:body.e?{slug:body.e,name:"Shake It Up",prize:"a guest list +1"}:null});
   else res({ok:true});},500);});};
 S.get=function(name,p){return new Promise(function(res){setTimeout(function(){
   if(name==="meta")res({event:p&&p.e?{slug:p.e,name:"Shake It Up",prize:"a guest list +1"}:null,count:null});
   else res(demo);},200);});};
 S.pageview=function(){};
 window.__go=function(url){location.href=url==="/"?"index.html":url.replace(/^\\/in\\?/,"in.html?").replace(/^\\/bonus\\?/,"bonus.html?");};
})();`;
function page(name, title) {
  let html = readFileSync(join(root, "site", name), "utf8");
  const body = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>"));
  let inline = body
    .replace('<script src="/app.js"></script>', "<script>" + app + "\n" + stub + "</script>")
    .replace(/location\.href = ([^;]*);/g, "window.__go($1);")
    .replace(/location\.replace\(([^;]*)\);/g, "window.__go($1);")
    .replace(/href="\/(privacy|rules|in)"/g, 'href="$1.html"')
    .replace(/\$\("back"\)\.href = "\/in\?t="/g, '$("back").href = "in.html?t="');
  const head = `<title>${title}</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@900&family=Share+Tech+Mono&display=swap" rel="stylesheet">\n<style>${css}\n.pv{position:fixed;left:0;right:0;bottom:0;z-index:9;background:#111;color:#999;font:11px/1.4 ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;text-align:center;padding:8px 16px calc(8px + env(safe-area-inset-bottom,0px));border-top:1px solid #333}</style>\n<script>window.STACK=${JSON.stringify({ ...cfg, supabaseUrl: "", turnstileSiteKey: "", siteUrl: "" })};</script>`;
  const full = name === "index.html"
    ? head + "\n" + inline + '\n<div class="pv">Preview · no real signups · <a href="index.html?e=shake-it-up" style="color:#ccc">try event mode</a></div>'
    : "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" + head + "</head><body>" + inline + '<div class="pv">Preview · no real signups</div></body></html>';
  writeFileSync(join(out, name), full);
}
page("index.html", "The Stack Preview"); page("in.html", "You're in"); page("bonus.html", "Bonus"); page("privacy.html", "Privacy"); page("rules.html", "Rules");
console.log("preview written to", out);
