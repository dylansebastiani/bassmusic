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
(function(){var PD=false;try{PD=localStorage.getItem("pv_profile")==="1"}catch(e){}
 var demo={first_name:null,referral_code:"K7PX2Q",confirmed_referrals:1,confirmed:false,profile_done:PD,event_entered:/[?&]e=/.test(location.search),
 drop:{title:"Elite Depth",artist:"Badguy Moolah",locked:!PD,audio_url:null,artwork_url:"assets/drops/elite-depth.jpg"}};
 function unlockIf(col){if(col.profile_done)col.tracks.forEach(function(k){k.locked=false;k.audio_url="data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";k.download_url="#";});return col;}
 var real=window.fetch; window.fetch=function(u,o){u=String(u);if(u.indexOf("preview.invalid")<0)return real.apply(this,arguments);
  var body={ok:true};
  if(/\\/subscribe$/.test(u)){var b={};try{b=JSON.parse(o&&o.body||"{}")}catch(e){}body={access_token:"0b5e3f1a-7c2d-4e8a-9f10-2a3b4c5d6e7f",track:b.c?{slug:"elite-depth",title:"Elite Depth"}:null,already_member:/again|back/.test(b.email||""),event:b.e?{slug:b.e,name:"Shake It Up",prize:"a guest list +1"}:null};}
  else if(/\\/meta/.test(u)){var e=(u.match(/[?&]e=([^&]+)/)||[])[1];body={event:e?{slug:e,name:"Shake It Up",prize:"a guest list +1"}:null,count:null};}
  else if(/\\/collection/.test(u))body=window.__col||(window.__col=unlockIf({first_name:null,profile_done:PD,confirmed:true,has_welcome:true,
    tracks:[{slug:"elite-depth",title:"Elite Depth",artist:"Badguy Moolah",artwork_url:"assets/drops/elite-depth.jpg",audio_url:null,download_url:null,locked:true,unlocked_at:new Date().toISOString()}],
    coupons:[{title:"10% off",description:"On your first shop order.",code:"SUBDUCTION10",locked:false,need:0,expires_at:"2027-01-31T00:00:00Z"},{title:"Free sticker pack",description:"For collectors.",locked:true,need:2,code:null}],
    events:[{slug:"shake",name:"Shake It Up",kind:"show",venue:"The Venue",city:"Bloomington, IL",starts_at:"2026-12-05T21:00:00-06:00",description:"Doors at nine.",ticket_url:"https://example.com",prize:"a guest list +1"},
            {slug:"pop",name:"Warehouse pop-up",kind:"popup",city:"Chicago",starts_at:"2026-12-12T18:00:00-06:00"}]}));
  else if(/\\/profile/.test(u)){try{localStorage.setItem("pv_profile","1")}catch(e){}if(window.__col){window.__col.profile_done=true;unlockIf(window.__col);}demo.profile_done=true;body={ok:true};}
  else if(/\\/track/.test(u)){body=(o&&o.method==="POST")?{unlocked:true,new_unlock:true,slug:"elite-depth",title:"Elite Depth"}:{slug:"elite-depth",title:"Elite Depth",artist:"Badguy Moolah",artwork_url:"assets/drops/elite-depth.jpg"};}
  else if(/\\/me/.test(u))body=demo;
  return new Promise(function(r){setTimeout(function(){r(new Response(JSON.stringify(body),{status:200,headers:{"Content-Type":"application/json"}}))},400)});};
 window.__go=function(url){location.href=url==="/"?"index.html":url.replace(/^\\/in\\b\\/?/,"in.html").replace(/^\\/bonus\\b\\/?/,"bonus.html").replace(/^\\/privacy$/,"privacy.html").replace(/^\\/rules$/,"rules.html");};
})();</script>`;
for (const name of ["index.html", "in.html", "bonus.html", "privacy.html", "rules.html", "t.html", "collection.html"]) {
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
