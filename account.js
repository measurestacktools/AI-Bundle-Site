/* Orders page: Google Sign-In (shared helper) + automatic order tracking.
   Every purchase is created under the signed-in account's email, so this page
   lists orders straight from D1 — no order ID or email lookup needed. Pending
   orders refresh themselves until Cashfree's webhook marks them PAID. */
(function () {
  "use strict";

  var loading = document.getElementById("loading");
  var signedOut = document.getElementById("signedOut");
  var signedIn = document.getElementById("signedIn");
  var authError = document.getElementById("authError");
  var orderList = document.getElementById("orderList");
  var gsiSlot = document.getElementById("gsiButton");
  var state = { account: null, orders: [] };
  var pollTimer = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function show(el, on) { if (el) el.hidden = !on; }
  function err(msg) {
    if (!authError) return;
    if (!msg) { show(authError, false); return; }
    authError.textContent = msg;
    show(authError, true);
  }

  function refresh() {
    return window.AIBundleAuth.session().then(function (d) {
      show(loading, false);
      state.account = d.account || null;
      state.orders = Array.isArray(d.orders) ? d.orders : [];
      if (!state.account) {
        state.orders = [];
        show(signedIn, false);
        show(signedOut, true);
        renderSignIn();
        return;
      }
      show(signedOut, false);
      show(signedIn, true);
      renderAccount();
      renderOrders();
    });
  }

  function renderSignIn() {
    if (!gsiSlot || gsiSlot.getAttribute("data-ready") === "1") return;
    gsiSlot.setAttribute("data-ready", "1");
    err("");
    window.AIBundleAuth
      .signIn(gsiSlot)
      .then(function () { return refresh(); })
      .catch(function (e) {
        gsiSlot.setAttribute("data-ready", "0");
        gsiSlot.innerHTML = "";
        err(e.message || "Sign-in failed. Try again.");
        renderSignIn();
      });
  }

  function renderAccount() {
    var a = state.account;
    var nameEl = document.getElementById("accName");
    var emailEl = document.getElementById("accEmail");
    if (nameEl) nameEl.textContent = a.name || "Signed in";
    if (emailEl) emailEl.textContent = a.email;
    var img = document.getElementById("avatar");
    if (img) {
      if (a.picture) { img.src = a.picture; img.alt = ""; show(img, true); }
      else { show(img, false); }
    }
  }

  function statusLabel(o) {
    if (o.status === "PAID") return "Paid";
    if (o.status === "PAYMENT_FAILED" || o.status === "CANCELLED") return "Payment failed";
    return "Payment pending";
  }

  function renderOrders() {
    orderList.innerHTML = "";
    if (!state.orders.length) {
      var li = document.createElement("li");
      li.innerHTML =
        "No orders yet for <strong>" + esc(state.account.email) + "</strong>. " +
        'Your purchases appear here automatically after checkout — <a href="bundle.html">get the bundle</a>.';
      orderList.appendChild(li);
      return;
    }
    state.orders.forEach(function (o) {
      var li = document.createElement("li");
      var title = document.createElement("div");
      var when = o.paid_at || o.created_at;
      var date = when ? " · " + esc(String(when).slice(0, 10)) : "";
      title.innerHTML =
        "<strong>AI Projects Bundle</strong> · ₹249 — <strong>" + esc(statusLabel(o)) + "</strong>" + date;
      li.appendChild(title);

      if (o.status === "PAID") {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn-primary";
        btn.style.marginTop = "10px";
        btn.textContent = "⬇ Download — Free";
        btn.addEventListener("click", function () { download(o.order_id, btn, li); });
        var note = document.createElement("div");
        note.className = "fine";
        li.appendChild(btn);
        li.appendChild(note);
      } else if (o.status === "PAYMENT_FAILED" || o.status === "CANCELLED") {
        var retry = document.createElement("p");
        retry.className = "fine";
        retry.innerHTML = 'Payment did not go through — <a href="bundle.html">try the purchase again</a>.';
        li.appendChild(retry);
      } else {
        var pending = document.createElement("p");
        pending.className = "fine";
        pending.innerHTML =
          "Waiting for the payment gateway to confirm. This page updates itself " +
          '— you can also <a href="bundle.html">start a fresh checkout</a>.';
        li.appendChild(pending);
      }
      orderList.appendChild(li);
    });
    schedulePoll();
  }

  function schedulePoll() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    var pending = state.orders.some(function (o) {
      return o.status !== "PAID" && o.status !== "PAYMENT_FAILED" && o.status !== "CANCELLED";
    });
    if (!pending) return;
    pollTimer = setTimeout(function () {
      if (document.hidden) return schedulePoll();
      refresh();
    }, 5000);
  }

  function download(orderId, btn, li) {
    var note = li.querySelector(".fine");
    btn.disabled = true;
    btn.textContent = "Preparing link…";
    if (note) note.textContent = "";
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
        if (note) note.textContent = "✓ Downloaded. That link is spent — press again anytime for a fresh one.";
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = "⬇ Download — Free";
        if (note) note.textContent = "⚠ Could not prepare the download. Refresh and try again.";
      });
  }

  document.getElementById("logoutBtn").addEventListener("click", function () {
    window.AIBundleAuth.logout().then(function () {
      gsiSlot.setAttribute("data-ready", "0");
      gsiSlot.innerHTML = "";
      return refresh();
    });
  });

  function boot() {
    if (!window.AIBundleAuth) {
      show(loading, false);
      show(signedOut, true);
      err("Sign-in could not load. Refresh the page and try again.");
      return;
    }
    refresh();
  }

  boot();
})();
