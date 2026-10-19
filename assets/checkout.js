/* AI Projects Bundle — checkout flow (no secrets here; price comes from the server).
   Buy Now -> Google sign-in (session cookie) -> POST /api/create-order ->
   cashfree.js checkout -> return to success.html -> poll /api/payment-status.
   There is deliberately no email or phone form: the order email is taken from
   the verified session, and Cashfree gets a dummy phone from the server. */
(function () {
  "use strict";

  var SDK_URL = "https://sdk.cashfree.com/js/v3/cashfree.js";

  function toast(msg) {
    var t = document.createElement("div");
    t.textContent = msg;
    t.setAttribute("role", "status");
    t.style.cssText = "position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#fffdf4;color:#211a10;border:2px solid #211a10;border-radius:10px;padding:12px 18px;font-size:14px;z-index:99;box-shadow:3px 3px 0 #211a10;max-width:90vw";
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3200);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function loadSdk() {
    return new Promise(function (resolve, reject) {
      if (window.Cashfree) return resolve();
      var s = document.createElement("script");
      s.src = SDK_URL;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("payment sdk failed")); };
      document.head.appendChild(s);
    });
  }

  function overlay() {
    var ov = document.getElementById("buyModal");
    if (ov) return ov;
    ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.id = "buyModal";
    ov.innerHTML = '<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="buyTitle"></div>';
    ov.addEventListener("click", function (e) { if (e.target === ov) closeModal(); });
    document.body.appendChild(ov);
    return ov;
  }

  function card() {
    return overlay().querySelector(".modal-card");
  }

  function closeModal() {
    var ov = document.getElementById("buyModal");
    if (ov) ov.remove();
  }

  function openCheckout() {
    closeModal();
    overlay();
    renderLoading();
    if (!window.AIBundleAuth) {
      return renderError("Sign-in could not load. Refresh the page and try again.", true);
    }
    window.AIBundleAuth.session().then(function (d) {
      if (d.account) renderConfirm(d.account);
      else renderSignIn();
    });
  }

  function renderLoading() {
    card().innerHTML =
      '<h2 id="buyTitle">Get the Bundle — ₹249</h2>' +
      '<p class="buy-lead">AI Projects Bundle · One-time payment</p>' +
      '<p class="fine">Checking your sign-in…</p>';
  }

  function renderSignIn() {
    card().innerHTML =
      '<h2 id="buyTitle">Sign in to buy</h2>' +
      '<p class="buy-lead">AI Projects Bundle · One-time payment · ₹249</p>' +
      '<p class="fine">Sign in with Google using the email you want to buy with. ' +
      "Your order is saved to this account, so you can download it again from <strong>Orders</strong> anytime.</p>" +
      '<div id="checkoutGsi" style="margin-top:16px"></div>' +
      '<p class="field-error" id="buyError" role="alert" hidden></p>' +
      '<button class="btn btn-ghost" id="cancelBuy" type="button">Cancel</button>' +
      '<p class="fine">Secure payment powered by Cashfree</p>';
    document.getElementById("cancelBuy").addEventListener("click", closeModal);
    var slot = document.getElementById("checkoutGsi");
    window.AIBundleAuth
      .signIn(slot, { button: { text: "signin_with" } })
      .then(function (account) { renderConfirm(account); })
      .catch(function (err) {
        var el = document.getElementById("buyError");
        if (el) { el.textContent = err.message || "Sign-in failed. Try again."; el.hidden = false; }
      });
  }

  function renderConfirm(account) {
    card().innerHTML =
      '<h2 id="buyTitle">Get the Bundle — ₹249</h2>' +
      '<p class="buy-lead">AI Projects Bundle · One-time payment</p>' +
      '<div class="info-box" style="margin-top:14px">' +
      '<p class="fine" style="margin:0">Signed in as</p>' +
      "<p style=\"margin:4px 0 0\"><strong>" + esc(account.email) + "</strong></p>" +
      '<p class="fine" style="margin:8px 0 0">Your purchase is linked to this account. ' +
      "After payment you can download it from <strong>Orders</strong> whenever you need it.</p>" +
      "</div>" +
      '<p class="field-error" id="buyError" role="alert" hidden></p>' +
      '<button class="btn btn-primary btn-lg" id="continuePay" type="button">Pay ₹249</button>' +
      '<button class="btn btn-ghost" id="cancelBuy" type="button">Cancel</button>' +
      '<p class="fine">Secure payment powered by Cashfree</p>';
    document.getElementById("cancelBuy").addEventListener("click", closeModal);
    document.getElementById("continuePay").addEventListener("click", startPayment);
  }

  function renderError(message, retry) {
    if (!document.getElementById("buyModal")) overlay();
    card().innerHTML =
      '<h2 id="buyTitle">Checkout unavailable</h2>' +
      '<p class="field-error" role="alert">' + esc(message) + "</p>" +
      '<button class="btn btn-primary" id="retryBuy" type="button">Try again</button>' +
      '<button class="btn btn-ghost" id="cancelBuy" type="button">Close</button>';
    document.getElementById("cancelBuy").addEventListener("click", closeModal);
    if (retry) document.getElementById("retryBuy").addEventListener("click", openCheckout);
  }

  function showBuyError(msg) {
    var el = document.getElementById("buyError");
    if (!el) return toast(msg);
    el.textContent = msg;
    el.hidden = false;
  }

  function startPayment() {
    var btn = document.getElementById("continuePay");
    btn.disabled = true;
    btn.textContent = "Starting payment…";
    fetch("/api/create-order", { method: "POST" })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          return { status: r.status, body: d };
        });
      })
      .then(function (res) {
        if (res.status === 401) {
          renderSignIn();
          return;
        }
        if (!res.body || res.body.ok !== true) throw new Error((res.body && res.body.error) || "Could not start payment");
        return loadSdk().then(function () {
          var cf = window.Cashfree({ mode: res.body.mode === "production" ? "production" : "sandbox" });
          cf.checkout({ paymentSessionId: res.body.payment_session_id, redirectTarget: "_self" });
        });
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = "Pay ₹249";
        showBuyError(err.message || "Could not start payment, please try again.");
      });
  }

  function setSteps(items) {
    var box = document.getElementById("statusSteps");
    if (!box) return;
    box.innerHTML = "";
    items.forEach(function (t) {
      var li = document.createElement("li");
      li.textContent = t;
      box.appendChild(li);
    });
  }

  function watchOrder(oid) {
    var title = document.getElementById("statusTitle");
    var sub = document.getElementById("statusSub");
    var dl = document.getElementById("downloadBtn");
    var note = document.getElementById("emailNote");
    if (!oid || !/^[A-Za-z0-9_-]{8,64}$/.test(oid)) {
      if (title) title.textContent = "Order not found";
      setSteps(["We could not identify this order. Check the link or contact support."]);
      return;
    }
    var tries = 0;
    function poll() {
      tries += 1;
      fetch("/api/payment-status?order_id=" + encodeURIComponent(oid), { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.state === "UNKNOWN" && tries === 1) {
            if (title) title.textContent = "Order not found";
            setSteps(["We could not identify this order.", "Check the link, or contact support if you just paid."]);
            return;
          }
          if (d.state === "PAID") {
            if (title) title.textContent = "Payment confirmed 🎉";
            if (sub) sub.textContent = "Your AI Projects Bundle is ready. It is also saved under Orders.";
            setSteps(["✓ Payment confirmed", "✓ Order created", "✓ Download ready", d.email_sent ? "✓ Email sent" : "✓ Download below (email pending)"]);
            if (dl) {
              dl.hidden = false;
              dl.onclick = function () { startDownload(oid, dl); };
            }
            if (note && d.email_sent) note.hidden = false;
            return;
          }
          if (d.state === "PAYMENT_FAILED") {
            if (title) title.textContent = "Payment was not completed";
            setSteps(["The payment did not go through. No file was unlocked.", "Try the purchase again from the product page."]);
            return;
          }
          if (tries < 40) {
            setSteps(["⏳ Payment is still being confirmed. Please wait a moment… (check " + tries + ")"]);
            setTimeout(poll, 3000);
            return;
          }
          if (title) title.textContent = "Still confirming…";
          setSteps(["Payment is taking longer than usual.", "If you paid, your download unlocks automatically once confirmed — keep this page open or check your email."]);
        })
        .catch(function () {
          if (tries < 40) { setTimeout(poll, 3000); return; }
          setSteps(["Could not reach the order server. Check your connection and refresh."]);
        });
    }
    poll();
  }

  function startDownload(oid, btn) {
    btn.disabled = true;
    btn.textContent = "Preparing download…";
    fetch("/api/create-download", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ order_id: oid }),
    })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, body: d }; }); })
      .then(function (res) {
        if (!res.body.ok) throw new Error(res.status === 403 ? "Download is not available for this order." : "Download failed, try again.");
        window.location.href = res.body.url;
        btn.disabled = false;
        btn.textContent = "⬇ Download your ZIP";
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = "⬇ Download your ZIP";
        toast(err.message || "Download failed, try again.");
      });
  }

  window.AIBundleCheckout = { openCheckout: openCheckout, openModal: openCheckout, closeModal: closeModal, watchOrder: watchOrder };
})();
