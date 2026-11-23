/* Page studio: pick a show, edit its page description, watch the preview change live, save, publish.
   Claude can edit the same draft from chat; an open studio notices within a few seconds and reloads it. */
(function () {
  var C = window.STACK || {}, FN = (C.supabaseUrl || "") + "/functions/v1/page";
  var $ = function (id) { return document.getElementById(id); };
  var tok = ""; try { tok = localStorage.getItem("stack_admin") || ""; } catch (e) {}
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var LABEL = { brand: "Logo / name", hero: "Hero art", dates: "Dates line", flyers: "Flyers", nights: "Nights & lineup", tickets: "Tickets", partners: "Partner logos", text: "Text block", video: "Teaser video", faq: "FAQ" };
  var WORDS = { brand: [["subtitle_text", "Subtitle (if no subtitle image)"]], dates: [["note", "Small line under the dates"]], nights: [["soon_text", "Text when no lineup yet"]],
    tickets: [["title", "Heading"], ["fineprint", "Fine print", true]], text: [["title", "Heading"], ["body", "Text", true]] };
  var ART = [["wordmark", "Logo / wordmark"], ["subtitle", "Subtitle image"], ["hero", "Hero art"], ["hero_small", "Hero art (phone size)"], ["partners", "Partner logo strip"], ["share", "Link preview (1200×630)"], ["video", "Teaser video (MP4)"]];
  var slug = "", page = null, opts = null, draftAt = null, dirty = false, frameReady = false, timer = null;

  function req(url, body) {
    return fetch(url, { method: body ? "POST" : "GET", headers: Object.assign({ "x-admin-token": tok }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (j) { if (r.status === 401) { signin(); throw new Error("Sign in again."); } if (!r.ok) throw new Error(j.error || "Something went wrong."); return j; }); });
  }
  function status(t, cls) { var s = $("status"); s.textContent = t; s.className = "status mono " + (cls || ""); }
  function toast(t) { var d = document.createElement("div"); d.className = "toast"; d.textContent = t; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 2600); }
  function signin() { $("signin").hidden = false; $("app").hidden = true; }
  function setDirty(v) { dirty = v; $("save").disabled = !v; status(v ? "Unsaved changes" : draftAt ? "Draft saved" : "", v ? "dirty" : "ok"); }

  // ---- preview: the real show page in a frame, fed the draft as it changes ----
  function push() { if (frameReady && page) $("preview").contentWindow.postMessage({ type: "subduction:page", page: page }, location.origin); }
  function changed() { setDirty(true); $("raw").value = JSON.stringify(page, null, 2); clearTimeout(timer); timer = setTimeout(push, 120); }
  $("preview").addEventListener("load", function () { frameReady = true; setTimeout(push, 400); });
  function setView(wide) { $("frameWrap").classList.toggle("wide", wide); $("vWide").setAttribute("aria-pressed", wide); $("vPhone").setAttribute("aria-pressed", !wide); }
  $("vPhone").onclick = function () { setView(false); }; $("vWide").onclick = function () { setView(true); };

  // ---- editor panels ----
  function sel(opts, val, attrs) { return "<select " + (attrs || "") + ">" + opts.map(function (o) { return '<option value="' + esc(o) + '"' + (o === val ? " selected" : "") + ">" + esc(o) + "</option>"; }).join("") + "</select>"; }
  function drawSections() {
    $("sections").innerHTML = page.sections.map(function (s, i) {
      var words = (WORDS[s.type] || []).map(function (w) {
        return '<div class="field"><label>' + esc(w[1]) + "</label>" + (w[2] ? '<textarea rows="3" data-i="' + i + '" data-k="' + w[0] + '">' + esc(s[w[0]] || "") + "</textarea>"
          : '<input type="text" data-i="' + i + '" data-k="' + w[0] + '" value="' + esc(s[w[0]] || "") + '">') + "</div>";
      }).join("");
      if (s.type === "flyers") words += '<div class="field"><label>Show flyers</label>' + sel(["after_lineup", "always"], s.show || "after_lineup", 'data-i="' + i + '" data-k="show"') + "</div>";
      if (s.type === "faq") words += '<div class="field"><label>Questions (one per line: question | answer)</label><textarea rows="4" data-i="' + i + '" data-k="items">' +
        esc((s.items || []).map(function (x) { return x.q + " | " + x.a; }).join("\n")) + "</textarea></div>";
      return '<div class="sec-item"><div class="sec-head"><b>' + esc(LABEL[s.type] || s.type) + "</b>" + sel(opts.sections[s.type], s.variant, 'data-i="' + i + '" data-k="variant" aria-label="Look"') +
        '<button type="button" data-mv="' + i + '" data-d="-1" aria-label="Move up"' + (i ? "" : " disabled") + ">↑</button>" +
        '<button type="button" data-mv="' + i + '" data-d="1" aria-label="Move down"' + (i < page.sections.length - 1 ? "" : " disabled") + ">↓</button>" +
        (s.type === "tickets" ? "" : '<button type="button" data-rm="' + i + '" aria-label="Remove">×</button>') + "</div>" + words + "</div>";
    }).join("");
    $("addType").innerHTML = Object.keys(opts.sections).filter(function (t) { return t !== "tickets"; }).map(function (t) { return '<option value="' + t + '">' + esc(LABEL[t] || t) + "</option>"; }).join("");
  }
  $("sections").addEventListener("input", function (e) {
    var i = e.target.getAttribute("data-i"), k = e.target.getAttribute("data-k"); if (i == null || !k) return;
    var s = page.sections[+i];
    if (k === "items") s.items = e.target.value.split("\n").map(function (l) { var p = l.split("|"); return { q: (p[0] || "").trim(), a: p.slice(1).join("|").trim() }; }).filter(function (x) { return x.q; });
    else s[k] = e.target.value;
    changed();
  });
  $("sections").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.hasAttribute("data-mv")) { var i = +b.getAttribute("data-mv"), j = i + +b.getAttribute("data-d"); var t = page.sections[i]; page.sections[i] = page.sections[j]; page.sections[j] = t; }
    else if (b.hasAttribute("data-rm")) page.sections.splice(+b.getAttribute("data-rm"), 1);
    else return;
    drawSections(); changed();
  });
  $("addBtn").onclick = function () {
    var t = $("addType").value, s = { type: t, variant: opts.sections[t][0] };
    var at = page.sections.findIndex(function (x) { return x.type === "tickets"; });
    page.sections.splice(at < 0 ? page.sections.length : at, 0, s); drawSections(); changed();
  };

  function color(key, label, val) { return '<div class="color"><label>' + esc(label) + '</label><input type="color" data-c="' + key + '" value="' + esc(val) + '"><input type="text" data-c="' + key + '" value="' + esc(val) + '" maxlength="7"></div>'; }
  function drawTheme() {
    var t = page.theme, c = t.colors;
    $("theme").innerHTML = '<div class="colors">' + color("bg", "Page", c.bg) + color("text", "Text", c.text) + color("muted", "Small text", c.muted) + color("line", "Borders", c.line) + color("accent", "Buttons", c.accent) + "</div>" +
      '<p class="shint">Night colors</p><div class="colors">' + c.nights.map(function (n, i) { return color("n" + i, "Night " + (i + 1), n); }).join("") + "</div>" +
      '<div class="row"><button type="button" class="ghostbtn" id="addNight">+ night color</button>' + (c.nights.length > 1 ? '<button type="button" class="ghostbtn" id="rmNight">− night color</button>' : "") + "</div>" +
      '<div class="field"><label>Headline font</label>' + sel(opts.fonts.display, t.fonts.display, 'data-t="display"') + "</div>" +
      '<div class="field"><label>Body font</label>' + sel(opts.fonts.body, t.fonts.body, 'data-t="body"') + "</div>" +
      '<div class="field"><label>Card corners</label>' + sel(opts.frames, t.frame, 'data-t="frame"') + "</div>" +
      '<div class="field"><label>Section titles</label>' + sel(opts.titles, t.titles, 'data-t="titles"') + "</div>" +
      '<label class="check"><input type="checkbox" data-t="glow"' + (t.glow ? " checked" : "") + "> Glow in the night colors</label>" +
      '<label class="check"><input type="checkbox" data-t="dots"' + (t.dots ? " checked" : "") + "> Dot texture over the hero</label>";
  }
  $("theme").addEventListener("input", function (e) {
    var el = e.target, t = page.theme, c = el.getAttribute("data-c"), k = el.getAttribute("data-t");
    if (c) {
      var v = el.value.trim(); if (!/^#[0-9a-f]{6}$/i.test(v)) return;
      if (c[0] === "n" && /^n\d$/.test(c)) t.colors.nights[+c.slice(1)] = v; else t.colors[c] = v;
      $("theme").querySelectorAll('[data-c="' + c + '"]').forEach(function (x) { if (x !== el) x.value = v; });
    } else if (k === "glow" || k === "dots") t[k] = el.checked;
    else if (k === "display" || k === "body") t.fonts[k] = el.value;
    else if (k) t[k] = el.value;
    else return;
    changed();
  });
  $("theme").addEventListener("click", function (e) {
    var n = page.theme.colors.nights;
    if (e.target.id === "addNight") n.push(n[n.length % 2] || "#ffffff"); else if (e.target.id === "rmNight") n.pop(); else return;
    drawTheme(); changed();
  });

  function drawArt() {
    var a = page.art, nights = Math.max((a.nights || []).length, page.theme.colors.nights.length, 1);
    var h = ART.map(function (x) { return '<div class="field"><label>' + esc(x[1]) + '</label><input type="text" data-a="' + x[0] + '" value="' + esc(a[x[0]] || "") + '" placeholder="https://… or assets/…"></div>'; }).join("");
    for (var i = 0; i < nights; i++) {
      var n = (a.nights || [])[i] || {};
      h += '<div class="field"><label>Night ' + (i + 1) + ' figure</label><input type="text" data-n="' + i + '" data-k="figure" value="' + esc(n.figure || "") + '"></div>' +
        '<div class="field"><label>Night ' + (i + 1) + ' icon</label><input type="text" data-n="' + i + '" data-k="icon" value="' + esc(n.icon || "") + '"></div>';
    }
    h += '<div class="field"><label>Flyers, one per night (one link per line)</label><textarea rows="3" data-a="flyers">' + esc((a.flyers || []).join("\n")) + "</textarea></div>";
    $("art").innerHTML = h;
  }
  $("art").addEventListener("input", function (e) {
    var el = e.target, a = page.art, k = el.getAttribute("data-a"), n = el.getAttribute("data-n");
    if (k === "flyers") a.flyers = el.value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
    else if (k) { if (el.value.trim()) a[k] = el.value.trim(); else delete a[k]; }
    else if (n != null) { a.nights = a.nights || []; while (a.nights.length <= +n) a.nights.push({}); a.nights[+n][el.getAttribute("data-k")] = el.value.trim(); }
    else return;
    changed();
  });
  $("css").addEventListener("input", function () { page.custom_css = this.value; changed(); });
  $("applyRaw").onclick = function () {
    try { var p = JSON.parse($("raw").value); if (!p || typeof p !== "object") throw 0; page = p; drawAll(); changed(); toast("Applied. Save to keep it."); }
    catch (e) { toast("That isn't a valid page description."); }
  };

  function drawAll() {
    page.art = page.art || {}; page.meta = page.meta || {}; page.custom_css = page.custom_css || "";
    drawSections(); drawTheme(); drawArt(); $("css").value = page.custom_css; $("raw").value = JSON.stringify(page, null, 2);
  }

  // ---- shows, loading, saving, publishing ----
  function loadShows() {
    return req(FN + "?a=list").then(function (r) {
      var o = r.shows.map(function (s) { return '<option value="' + esc(s.slug) + '">' + esc(s.name) + (s.company ? " · " + esc(s.company) : "") + (s.has_page ? "" : " (no page yet)") + "</option>"; }).join("");
      $("show").innerHTML = '<option value="">Pick a show…</option>' + o;
      $("fromShow").innerHTML = r.shows.filter(function (s) { return s.has_page; }).map(function (s) { return '<option value="' + esc(s.slug) + '">' + esc(s.name) + "</option>"; }).join("");
      var want = new URLSearchParams(location.search).get("e");
      if (want && r.shows.some(function (s) { return s.slug === want; })) { $("show").value = want; open(want); }
    });
  }
  function open(s) {
    if (dirty && !confirm("You have unsaved changes. Leave them?")) { $("show").value = slug; return; }
    slug = s; if (!s) return;
    req(FN + "?a=get&e=" + encodeURIComponent(s)).then(function (r) {
      page = r.draft; opts = r.options; draftAt = r.draft_at; drawAll(); setDirty(r.is_new);
      $("empty").hidden = true; $("editor").hidden = false; $("publish").disabled = false;
      $("pubinfo").textContent = r.published_at ? "Live version published " + new Date(r.published_at).toLocaleString() + (r.published_by ? " by " + r.published_by : "") + "." : "Not published yet. The public still sees the original tickets page.";
      var url = "show.html?e=" + encodeURIComponent(s) + "&preview=1"; frameReady = false; $("preview").src = url; $("openPreview").href = url; $("openPreview").hidden = false;
      try { history.replaceState(null, "", "?e=" + encodeURIComponent(s)); } catch (e) {}
    }).catch(function (e) { toast(e.message); });
  }
  $("show").onchange = function () { open(this.value); };
  function save() {
    status("Saving…");
    return req(FN, { a: "save", e: slug, page: page }).then(function (r) { page = r.draft; draftAt = r.draft_at; drawAll(); setDirty(false); push(); return r; });
  }
  $("save").onclick = function () { save().catch(function (e) { status(e.message, "dirty"); }); };
  $("publish").onclick = function () {
    if (!confirm("Publish this page? Ticket buyers will see it right away.")) return;
    (dirty ? save() : Promise.resolve()).then(function () { return req(FN, { a: "publish", e: slug }); })
      .then(function (r) { toast("Live."); $("pubinfo").textContent = "Live version published " + new Date(r.published_at).toLocaleString() + "."; })
      .catch(function (e) { toast(e.message); });
  };
  $("fromBtn").onclick = function () {
    var from = $("fromShow").value; if (!from || !confirm("Replace this draft's look with " + from + "'s?")) return;
    req(FN, { a: "start", e: slug, from: from }).then(function (r) { page = r.draft; draftAt = r.draft_at; drawAll(); setDirty(false); push(); toast("Style copied."); }).catch(function (e) { toast(e.message); });
  };

  // Claude edits the draft from chat; when nothing here is unsaved, pick those edits up automatically.
  setInterval(function () {
    if (!slug || dirty || document.hidden) return;
    req(FN + "?a=draft-at&e=" + encodeURIComponent(slug)).then(function (r) {
      if (r.draft_at && r.draft_at !== draftAt) {
        return req(FN + "?a=get&e=" + encodeURIComponent(slug)).then(function (g) { page = g.draft; draftAt = g.draft_at; drawAll(); setDirty(false); push(); toast("Updated from chat."); });
      }
    }).catch(function () {});
  }, 4000);
  window.addEventListener("beforeunload", function (e) { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  if (!tok) { signin(); return; }
  $("app").hidden = false;
  loadShows().catch(function (e) { toast(e.message); });
})();
