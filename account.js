/* Account page: Google Sign-In (GIS) + session-backed purchases.
   The ID token is posted to /api/auth/google, which verifies it against
   Google's JWKS before creating a session cookie. The client never decides
   whether a login is valid. */
(function () {
  "use strict";

  var GOOGLE_CLIENT_ID = "";

  var loading = document.getElementById("loading");
  var signedOut = document.getElementById("signedOut");
  var signedIn = document.getElementById("signedIn");
  var authError = document.getElementById("authError");
  var orderList = document.getElementById("orderList");
  var gsiSlot = document.getElementById("gsiButton");
  var gsiLoaded = false;
  var state = { account: null, orders: [] };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function show(el, on) { if (el) el.hidden = !on; }
  function err(msg) {
    if (!msg) { show(authError, false); return; }
    authError.textContent = msg;
    show(authError, true);
  }

  function loadGsi() {
    if (gsiLoaded) return;
    gsiLoaded = true;
    var s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = initGsi;
    s.onerror = function () {
      err("Google Sign-In could not load. Check your connection and refresh.");
    };
    document.head.appendChild(s);
  }

  function initGsi() {
    if (!window.google || !google.accounts || !google.accounts.id) {
      return err("Google Sign-In is unavailable in this browser.");
    }
    if (!GOOGLE_CLIENT_ID) {
      gsiSlot.innerHTML =
        '<p class="fine"><strong>Google sign-in is not configured yet.</strong> ' +
        'Add <code>GOOGLE_CLIENT_ID</code> as a Cloudflare Pages environment variable, ' +
        'then redeploy. Until then use <a href="purchases.html">My Purchases</a>.</p>';
      return;
    }
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: onCredential,
      auto_select: false,
      cancel_on_tap_outside: true,
      use_fedcm_for_prompt: true,
    });
    google.accounts.id.renderButton(gsiSlot, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "signin_with",
      shape: "rectangular",
      logo_alignment: "left",
      width: 280,
    });
  }

  function onCredential(res) {
    if (!res || !res.credential) return err("Sign-in was cancelled.");
    err("");
    fetch("/api/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credential: res.credential }),
    })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        if (!d || d.ok !== true || !d.account) {
          err((d && d.error) || "Sign-in could not be verified. Try again.");
          return;
        }
        return refresh();
      })
      .catch(function () { err("Could not reach the server. Check your connection and retry."); });
  }

  function refresh() {
    return fetch("/api/auth/session", { cache: "no-store" })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        show(loading, false);
        state.account = (d && d.account) || null;
        state.orders = (d && Array.isArray(d.orders)) ? d.orders : [];
        if (!state.account) {
          show(signedIn, false);
          show(signedOut, true);
          loadGsi();
          return;
        }
        show(signedOut, false);
        show(signedIn, true);
        renderAccount();
        renderOrders();
      })
      .catch(function () {
        show(loading, false);
        show(signedOut, true);
        err("Could not check your session. Refresh to try again.");
        loadGsi();
      });
  }

  function renderAccount() {
    var a = state.account;
    document.getElementById("accName").textContent = a.name || "Signed in";
    document.getElementById("accEmail").textContent = a.email;
    var img = document.getElementById("avatar");
    if (a.picture) { img.src = a.picture; img.alt = ""; show(img, true); }
  }

  function renderOrders() {
    orderList.innerHTML = "";
    if (!state.orders.length) {
      var li = document.createElement("li");
      li.innerHTML =
        "No paid purchases found for <strong>" + esc(state.account.email) + "</strong>. " +
        'If you paid with a different email, use <a href="purchases.html">My Purchases</a> with that address.';
      orderList.appendChild(li);
      return;
    }
    state.orders.forEach(function (o) {
      var li = document.createElement("li");
      var title = document.createElement("div");
      title.innerHTML =
        "<strong>AI Projects Bundle</strong> — paid" +
        (o.paid_at ? " on " + esc(String(o.paid_at).slice(0, 10)) : "") +
        " · free forever";
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      btn.style.marginTop = "10px";
      btn.textContent = "⬇ Download — Free";
      btn.addEventListener("click", function () { download(o.order_id, btn, li); });
      var note = document.createElement("div");
      note.className = "fine";
      li.appendChild(title);
      li.appendChild(btn);
      li.appendChild(note);
      orderList.appendChild(li);
    });
  }

  function download(orderId, btn, li) {
    var note = li.querySelector(".fine");
    btn.disabled = true;
    btn.textContent = "Preparing link…";
    note.textContent = "";
    fetch("/api/account/download", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ order_id: orderId }),
    })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        if (!d || d.ok !== true || !d.url) throw new Error("mint");
        return fetch(d.url).then(function (r) {
          if (!r.ok) throw new Error("dl");
          return r.blob();
        });
      })
      .then(function (blob) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "AI-Projects-Bundle.zip";
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
        btn.disabled = false;
        btn.textContent = "⬇ Download — Free";
        note.textContent = "✓ Downloaded. That link is spent — press again anytime for a fresh one.";
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = "⬇ Download — Free";
        note.textContent = "⚠ Could not prepare the download. Refresh and try again.";
      });
  }

  document.getElementById("logoutBtn").addEventListener("click", function () {
    fetch("/api/auth/logout", { method: "POST" })
      .catch(function () {})
      .then(function () { return refresh(); });
  });

  function boot() {
    fetch("/api/auth/config", { cache: "no-store" })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        GOOGLE_CLIENT_ID = (d && d.google_client_id) || "";
      })
      .catch(function () { GOOGLE_CLIENT_ID = ""; })
      .then(refresh);
  }

  boot();
})();
