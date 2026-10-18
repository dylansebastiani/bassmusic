/* One email box: new members get in, returning members get a 6-digit code. Used by /t (QR scan) and the signed-out /collection.
   Join.mount(el, { track: "CODE" | null, cta: "UNLOCK", onDone: function ({ token, track }) {} })
   Talks to the same `subscribe` and `verify` functions as the landing page, bot check included. */
window.Join = (function () {
  var S = window.Stack, C = S.C;
  var FIX = { "gmial.com": "gmail.com", "gmal.com": "gmail.com", "gmai.com": "gmail.com", "gamil.com": "gmail.com", "gnail.com": "gmail.com", "hotmial.com": "hotmail.com", "hotmal.com": "hotmail.com", "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "outlok.com": "outlook.com", "iclod.com": "icloud.com", "icoud.com": "icloud.com" };
  var EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
  function suggest(email) {
    var at = email.lastIndexOf("@"); if (at < 0) return null;
    var dom = email.slice(at + 1).toLowerCase(), fixed = FIX[dom];
    if (!fixed && /\.(con|cmo|ocm|vom|cm)$/.test(dom)) fixed = dom.replace(/\.(con|cmo|ocm|vom|cm)$/, ".com");
    return fixed && fixed !== dom ? email.slice(0, at + 1) + fixed : null;
  }

  // Bot check, started on page load so the pass is usually ready before they finish typing.
  var tsLoaded = false, tsToken = null, tsId = null, tsWaiters = [], tsErr = null, tsEl = null;
  function tsGot(tok) { tsToken = tok; var w = tsWaiters; tsWaiters = []; w.forEach(function (f) { f(); }); }
  function loadTurnstile() {
    if (tsLoaded || !C.turnstileSiteKey) return; tsLoaded = true;
    window.__tsOnload = function () {
      tsId = turnstile.render(tsEl, { sitekey: C.turnstileSiteKey, action: "signup", appearance: "interaction-only", "refresh-expired": "auto",
        callback: tsGot, "expired-callback": function () { tsToken = null; }, "error-callback": function (code) { tsToken = null; tsErr = String(code || "error").slice(0, 20); } });
    };
    var s = document.createElement("script"); s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__tsOnload&render=explicit"; s.async = true; document.head.appendChild(s);
  }
  function tsPass(ms) {
    if (!C.turnstileSiteKey || tsToken) return Promise.resolve();
    loadTurnstile();
    return new Promise(function (res) { tsWaiters.push(res); setTimeout(res, ms); });
  }

  function mount(el, opts) {
    opts = opts || {};
    el.innerHTML =
      '<form class="jf" novalidate>' +
        '<label class="sr" for="jemail">Email address</label>' +
        '<div class="unit"><input type="email" id="jemail" placeholder="email" autocomplete="email" inputmode="email" required autocapitalize="off" spellcheck="false">' +
        '<button type="submit" class="btn">' + S.esc(opts.cta || C.cta || "GET EARLY ACCESS") + "</button></div>" +
        '<div class="msg hintrow" hidden><button type="button" class="hint"></button></div>' +
        '<input type="text" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
        '<div class="ts"></div>' +
      "</form>" +
      '<form class="jc" novalidate hidden>' +
        '<label class="sr" for="jcode">6-digit code</label>' +
        '<div class="unit"><input type="text" id="jcode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" placeholder="6-digit code" spellcheck="false">' +
        '<button type="submit" class="btn">Sign in</button></div>' +
        '<p class="fine"><button type="button" class="hint resend">Send a new code</button> &middot; <button type="button" class="hint other">Different email</button></p>' +
      "</form>" +
      '<p class="msg" role="status"></p>';
    var f = el.querySelector(".jf"), cf = el.querySelector(".jc"), msg = el.querySelector(".msg[role]"), email = el.querySelector("#jemail"),
        btn = f.querySelector(".btn"), hintRow = el.querySelector(".hintrow"), hintBtn = hintRow.querySelector(".hint"),
        code = el.querySelector("#jcode"), cbtn = cf.querySelector(".btn");
    tsEl = el.querySelector(".ts");
    var pendingSuggest = null, last = null, trackInfo = null;
    function say(t, ok) { msg.textContent = t; msg.className = "msg" + (ok ? " ok" : ""); }
    function done(token, track) { S.remember(token); if (opts.onDone) opts.onDone({ token: token, track: track || trackInfo }); }
    email.addEventListener("focus", loadTurnstile, { once: true });
    if (document.readyState === "complete") loadTurnstile(); else addEventListener("load", loadTurnstile);
    hintBtn.addEventListener("click", function () { email.value = pendingSuggest; hintRow.hidden = true; pendingSuggest = null; });

    function submit(body, resend) {
      last = body;
      tsPass(12000).then(function () { body.turnstile = tsToken; body.ts_err = tsToken ? null : (tsErr || (tsLoaded ? "no-pass" : "not-loaded")); return S.api("subscribe", body); })
        // A pass works once: clear it and fetch a fresh one for any retry.
        .then(function (r) { tsToken = null; if (tsId !== null) turnstile.reset(tsId); return r; }, function (e) { tsToken = null; if (tsId !== null) turnstile.reset(tsId); throw e; })
        .then(function (r) {
          trackInfo = r.track || null;
          if (r.check_email) { f.hidden = true; cf.hidden = false; code.value = ""; cbtn.disabled = false;
            say((resend ? "New code sent to " : "You're already in. We emailed a 6-digit code to ") + body.email + ".", true); setTimeout(function () { code.focus(); }, 50); return; }
          done(r.access_token, r.track);
        })
        .catch(function (err) {
          btn.disabled = false;
          if (err.status === 429) return say("Slow down a sec and try again.");
          if (err.status === 403) return say("Couldn't confirm you're human. Give it a second and tap again.");
          if (err.status && err.status < 500) return say(err.message || "Couldn't sign you up.");
          say("No signal. Try again in a sec.");
        });
    }
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = email.value.trim();
      if (!EMAIL_OK.test(v)) { say("That email doesn't look right."); email.focus(); return; }
      var sug = suggest(v);
      if (sug && pendingSuggest !== sug) { pendingSuggest = sug; hintBtn.textContent = "Did you mean " + sug + "?"; hintRow.hidden = false; say(""); return; }
      hintRow.hidden = true; btn.disabled = true; say("One sec...");
      submit({ email: v, hp: f.querySelector(".hp").value, c: opts.track || null, variant: S.variant(), src: S.attr.src || null, e: S.attr.e || null, r: S.attr.r || null,
        utm_source: S.attr.utm_source || null, utm_medium: S.attr.utm_medium || null, utm_campaign: S.attr.utm_campaign || null, turnstile: null });
    });
    code.addEventListener("input", function () {
      var c = code.value.replace(/\D/g, "").slice(0, 6); code.value = c;
      if (c.length === 6) cf.requestSubmit ? cf.requestSubmit() : cbtn.click();
    });
    cf.addEventListener("submit", function (e) {
      e.preventDefault();
      var c = code.value.replace(/\D/g, "");
      if (c.length !== 6) return say("Enter the 6-digit code from your email.");
      cbtn.disabled = true; say("Checking...");
      S.api("verify", { email: last.email, code: c }).then(function (r) { done(r.access_token); })
        .catch(function (err) { cbtn.disabled = false; code.select(); say(err.message || "That didn't work. Try again."); });
    });
    cf.querySelector(".resend").addEventListener("click", function () { if (last) { say("Sending a new code..."); submit(last, true); } });
    cf.querySelector(".other").addEventListener("click", function () { cf.hidden = true; f.hidden = false; btn.disabled = false; say(""); email.focus(); });
  }
  return { mount: mount };
})();
