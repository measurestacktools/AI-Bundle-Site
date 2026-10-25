/* Email + password accounts UI. Backend: /api/auth/register, /api/auth/login,
   /api/auth/session, /api/auth/logout. Google stays available via AIBundleAuth. */
(function () {
  "use strict";
  var HELP_EMAIL = "support@eggermath.com"; // owner email; set once, used by the Help link
  var modal, msgEl, tabIn, tabUp, formIn, formUp, googleBox;

  var css = document.createElement("style");
  css.textContent = [
    ".authmodal{position:fixed;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(26,22,16,.55)}",
    ".authmodal[hidden]{display:none}",
    ".authbox{width:min(420px,100%);max-height:calc(100vh - 32px);overflow:auto;background:#fbf8f1;border:2px solid #1a1610;box-shadow:6px 6px 0 #1a1610;padding:22px}",
    ".authbox h2{margin:0 0 4px;font-size:22px}",
    ".authtabs{display:flex;gap:8px;margin:14px 0 12px}",
    ".authtabs button{flex:1;padding:8px;border:1px solid #1a1610;background:transparent;font:inherit;cursor:pointer}",
    ".authtabs button[aria-selected=true]{background:#1a1610;color:#fbf8f1}",
    ".authbox label{display:block;font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin:10px 0 4px}",
    ".authbox input{width:100%;padding:10px;border:1px solid #6b6357;background:#fff;font:inherit}",
    ".authbox .authmsg{min-height:18px;margin:10px 0 0;font-size:13px;color:#8a3324}",
    ".authbox .authmsg.ok{color:#1f6b3a}",
    ".authalt{margin-top:14px;padding-top:12px;border-top:1px solid #d8d0c2;font-size:13px}",
    ".authclose{float:right;border:1px solid #1a1610;background:transparent;width:28px;height:28px;cursor:pointer}"
  ].join("");
  document.head.appendChild(css);
  modal = document.createElement("div");
  modal.className = "authmodal";
  modal.hidden = true;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Account");
  modal.innerHTML =
    '<div class="authbox">' +
      '<button class="authclose" type="button" aria-label="Close">x</button>' +
      '<h2>Your account</h2>' +
      '<p style="margin:0;font-size:14px;color:#4a443a">Sign in to see your orders and download again any time.</p>' +
      '<div class="authtabs" role="tablist">' +
        '<button type="button" id="tabIn" role="tab" aria-selected="true">Sign in</button>' +
        '<button type="button" id="tabUp" role="tab" aria-selected="false">Create account</button>' +
      '</div>' +
      '<form id="formIn" autocomplete="on">' +
        '<label for="inEmail">Email</label><input id="inEmail" type="email" required autocomplete="email" />' +
        '<label for="inPass">Password</label><input id="inPass" type="password" required autocomplete="current-password" />' +
        '<button class="btn btn-primary" style="width:100%;margin-top:14px" type="submit">Sign in</button>' +
      '</form>' +
      '<form id="formUp" autocomplete="on" hidden>' +
        '<label for="upEmail">Email</label><input id="upEmail" type="email" required autocomplete="email" />' +
        '<label for="upPass">Password (8+ characters)</label><input id="upPass" type="password" required minlength="8" autocomplete="new-password" />' +
        '<button class="btn btn-primary" style="width:100%;margin-top:14px" type="submit">Create account</button>' +
      '</form>' +
      '<p class="authmsg" id="authMsg" role="status"></p>' +
      '<div class="authalt" id="googleBox"></div>' +
    '</div>';
  document.body.appendChild(modal);
  var $ = function (id) { return document.getElementById(id); };
  tabIn = $("tabIn"); tabUp = $("tabUp");
  formIn = $("formIn"); formUp = $("formUp");
  msgEl = $("authMsg"); googleBox = $("googleBox");

  function post(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        return { status: r.status, body: d || {} };
      });
    });
  }

  function say(text, ok) {
    msgEl.textContent = text || "";
    msgEl.className = "authmsg" + (ok ? " ok" : "");
  }

  function tab(which) {
    var up = which === "up";
    tabUp.setAttribute("aria-selected", up ? "true" : "false");
    tabIn.setAttribute("aria-selected", up ? "false" : "true");
    formUp.hidden = !up;
    formIn.hidden = up;
    say("");
  }
  function open(which) {
    modal.hidden = false;
    tab(which || "in");
    var first = which === "up" ? $("upEmail") : $("inEmail");
    setTimeout(function () { if (first) first.focus(); }, 30);
  }
  function close() { modal.hidden = true; }

  modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
  modal.querySelector(".authclose").addEventListener("click", close);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !modal.hidden) close(); });
  tabIn.addEventListener("click", function () { tab("in"); });
  tabUp.addEventListener("click", function () { tab("up"); });
  formUp.addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("upEmail").value.trim();
    var pass = $("upPass").value;
    if (pass.length < 8) { say("Use at least 8 characters."); return; }
    say("Creating your account...", true);
    post("/api/auth/register", { email: email, password: pass }).then(function (r) {
      if (r.status === 200 && r.body.ok) { say("Account created. You are signed in.", true); setTimeout(function () { close(); refresh(); }, 600); }
      else if (r.status === 409) say("That email already has an account. Try Sign in.");
      else say((r.body && r.body.error) || "Could not create the account.");
    }).catch(function () { say("Network error. Try again."); });
  });

  formIn.addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("inEmail").value.trim();
    var pass = $("inPass").value;
    say("Signing in...", true);
    post("/api/auth/login", { email: email, password: pass }).then(function (r) {
      if (r.status === 200 && r.body.ok) { say("Signed in.", true); setTimeout(function () { close(); refresh(); }, 500); }
      else if (r.status === 401) say("Email or password is incorrect.");
      else say((r.body && r.body.error) || "Could not sign in.");
    }).catch(function () { say("Network error. Try again."); });
  });
  var signedBox = document.createElement("div");
  signedBox.hidden = true;
  signedBox.innerHTML =
    '<p id="signedEmail" style="font-size:15px;margin:6px 0 14px"></p>' +
    '<a class="btn btn-primary" style="display:block;text-align:center" href="account.html">View my orders</a>' +
    '<button class="btn" style="width:100%;margin-top:10px" type="button" id="signOutBtn">Sign out</button>';
  modal.querySelector(".authbox").appendChild(signedBox);
  $("signOutBtn").addEventListener("click", function () {
    fetch("/api/auth/logout", { method: "POST" }).then(function () { close(); refresh(); });
  });

  function showSignedIn(account) {
    signedBox.hidden = false;
    formIn.hidden = true; formUp.hidden = true;
    tabIn.parentNode.hidden = true;
    googleBox.hidden = true;
    say("");
    $("signedEmail").textContent = "Signed in as " + account.email;
  }
  function showForms() {
    signedBox.hidden = true;
    tabIn.parentNode.hidden = false;
    googleBox.hidden = false;
    tab("in");
  }
  var navBtn = document.createElement("button");
  navBtn.type = "button";
  navBtn.className = "btn btn-ghost btn-sm";
  navBtn.textContent = "Sign in";
  var cta = document.querySelector(".nav-cta");
  if (cta) cta.insertBefore(navBtn, cta.firstChild);

  var helpLink = document.createElement("a");
  helpLink.className = "btn btn-ghost btn-sm";
  helpLink.textContent = "Help";
  helpLink.href = HELP_EMAIL ? "mailto:" + HELP_EMAIL : "contact.html";
  if (HELP_EMAIL) helpLink.title = "Email " + HELP_EMAIL;
  if (cta) cta.insertBefore(helpLink, navBtn);

  navBtn.addEventListener("click", function () {
    open("in");
    fetch("/api/auth/session", { cache: "no-store" }).then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.account) showSignedIn(d.account); else showForms(); })
      .catch(function () { showForms(); });
  });

  function refresh() {
    fetch("/api/auth/session", { cache: "no-store" }).then(function (r) { return r.json(); })
      .then(function (d) {
        var acct = d && d.account;
        navBtn.textContent = acct ? "My account" : "Sign in";
        navBtn.setAttribute("data-signed", acct ? "1" : "0");
      }).catch(function () {});
  }

  if (window.AIBundleAuth && googleBox) {
    AIBundleAuth.signIn(googleBox, {}).catch(function () { googleBox.hidden = true; });
  }
  refresh();
})();
