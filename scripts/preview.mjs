// Builds a click-through preview of the site as a Claude artifact: same pages,
// same assets, but fetch() is faked so it works with no database.
import { readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { join } from "node:path";
const root = new URL("..", import.meta.url).pathname;
const out = process.argv[2] || join(root, "preview");
mkdirSync(out, { recursive: true });
cpSync(join(root, "site/assets"), join(out, "assets"), { recursive: true });
const cfg = JSON.parse(readFileSync(join(root, "config/stack.json"), "utf8"));
const stub = `<script>window.STACK=${JSON.stringify({ ...cfg, supabaseUrl: "https://preview.invalid", turnstileSiteKey: "", siteUrl: "" })};
(function(){var demo={first_name:null,referral_code:"K7PX2Q",confirmed_referrals:1,confirmed:false,profile_done:false,event_entered:/[?&]e=/.test(location.search),
 drop:{title:"FILE 001 (UNRELEASED)",artist:"${cfg.membershipName}",audio_url:null,artwork_url:null}};
 var real=window.fetch; window.fetch=function(u,o){u=String(u);if(u.indexOf("preview.invalid")<0)return real.apply(this,arguments);
  var body={ok:true};
  if(/\\/subscribe$/.test(u)){var b={};try{b=JSON.parse(o&&o.body||"{}")}catch(e){}body={access_token:"demo",already_member:/again|back/.test(b.email||""),event:b.e?{slug:b.e,name:"Shake It Up",prize:"a guest list +1"}:null};}
  else if(/\\/meta/.test(u)){var e=(u.match(/[?&]e=([^&]+)/)||[])[1];body={event:e?{slug:e,name:"Shake It Up",prize:"a guest list +1"}:null,count:null};}
  else if(/\\/me/.test(u))body=demo;
  return new Promise(function(r){setTimeout(function(){r(new Response(JSON.stringify(body),{status:200,headers:{"Content-Type":"application/json"}}))},400)});};
 window.__go=function(url){location.href=url==="/"?"index.html":url.replace(/^\\/in\\b\\/?/,"in.html").replace(/^\\/bonus\\b\\/?/,"bonus.html").replace(/^\\/privacy$/,"privacy.html").replace(/^\\/rules$/,"rules.html");};
})();</script>`;
for (const name of ["index.html", "in.html", "bonus.html", "privacy.html", "rules.html"]) {
  let s = readFileSync(join(root, "site", name), "utf8").replace("<!--CONFIG-->", stub)
    .replace(/location\.href = ([^;]*);/g, "window.__go($1);")
    .replace(/location\.replace\(([^;]*)\);/g, "window.__go($1);")
    
    .replace(/action="\/in"/g, 'action="in.html"');
  if (name === "index.html") { // artifact page: no document skeleton of its own
    s = s.replace(/^[\s\S]*?<head>/, "").replace(/<meta charset[^>]*>|<meta name="viewport"[^>]*>/g, "").replace("</head>\n<body>", "").replace(/<\/body>\s*<\/html>\s*$/, "");
    s = s.replace("<title>", '<meta name="claude:viewport-fit-sides" content="cover"><title>');
  }
  writeFileSync(join(out, name), s);
}
console.log("preview written to", out);
