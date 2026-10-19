/* AI Projects Bundle — checkout flow (no secrets here; price comes from the server).
   Buy Now -> Google sign-in (session cookie) -> mobile number -> POST /api/create-order ->
   cashfree.js checkout -> return to success.html -> poll /api/payment-status.
   The order email is taken from the verified session; Cashfree receives the mobile
   number the customer confirms here. */
(function () {
  "use strict";

  var SDK_URL = "https://sdk.cashfree.com/js/v3/cashfree.js";
  var DEFAULT_PRICE = 249;
  var DEFAULT_CURRENCY = "INR";

  var pricing = { price: DEFAULT_PRICE, currency: DEFAULT_CURRENCY };
  var pricingPromise = null;
  var lastFocus = null;
  var currentAccount = null;

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

  function formatPrice() {
    var amount = Number(pricing.price);
    if (!isFinite(amount) || amount <= 0) amount = DEFAULT_PRICE;
    var currency = pricing.currency || DEFAULT_CURRENCY;
    var whole = amount % 1 === 0;
    try {
      return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: currency,
        minimumFractionDigits: whole ? 0 : 2,
        maximumFractionDigits: whole ? 0 : 2,
      }).format(amount);
    } catch (e) {
      return (currency === "INR" ? "₹" : currency + " ") + amount;
    }
  }

  function getPricing() {
    if (!pricingPromise) {
      pricingPromise = fetch("/api/auth/config", { cache: "no-store" })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (d) {
          var amount = Number(d && d.price);
          var currency = d && typeof d.currency === "string" ? d.currency.toUpperCase() : "";
          if (isFinite(amount) && amount > 0) pricing.price = amount;
          if (/^[A-Z]{3}$/.test(currency)) pricing.currency = currency;
          var nodes = document.querySelectorAll("[data-price]");
          for (var i = 0; i < nodes.length; i++) nodes[i].textContent = formatPrice();
          return pricing;
        })
        .catch(function () { return pricing; });
    }
    return pricingPromise;
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
    ov.innerHTML = '<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="buyTitle" tabindex="-1"></div>';
    ov.addEventListener("click", function (e) { if (e.target === ov) closeModal(); });
    document.body.appendChild(ov);
    return ov;
  }

  function card() {
    return overlay().querySelector(".modal-card");
  }

  function focusCard() {
    var c = document.getElementById("buyModal");
    c = c && c.querySelector(".modal-card");
    if (!c) return;
    try { c.focus({ preventScroll: true }); } catch (e) { c.focus(); }
  }

  function bindCloseButtons() {
    var buttons = card().querySelectorAll("[data-buy-close]");
    for (var i = 0; i < buttons.length; i++) buttons[i].addEventListener("click", closeModal);
  }

  function closeModal() {
    var ov = document.getElementById("buyModal");
    if (ov) ov.remove();
    if (lastFocus && lastFocus.focus && document.documentElement.contains(lastFocus)) {
      try { lastFocus.focus({ preventScroll: true }); } catch (e) { lastFocus.focus(); }
    }
    lastFocus = null;
  }

  function openCheckout() {
    var existing = document.getElementById("buyModal");
    if (existing) existing.remove();
    else lastFocus = document.activeElement;
    overlay();
    renderLoading();
    if (!window.AIBundleAuth) {
      renderError("Sign-in could not load. Refresh the page and try again.", true);
      return;
    }
    Promise.all([getPricing(), window.AIBundleAuth.session()])
      .then(function (results) {
        var d = results[1] || {};
        route(d.account, d.orders);
      })
      .catch(function () {
        renderError("Something went wrong while loading checkout. Please try again.", true);
      });
  }

  function head(title, sub) {
    return '<header class="buy-head">' +
      '<div class="buy-head-top">' +
      '<span class="buy-badge">AI Projects Bundle</span>' +
      '<button class="buy-close" type="button" aria-label="Close checkout" data-buy-close>&times;</button>' +
      '</div>' +
      '<div class="buy-title-row">' +
      '<h2 id="buyTitle">' + esc(title) + '</h2>' +
      '<span class="buy-price-chip">' + esc(formatPrice()) + '</span>' +
      '</div>' +
      (sub ? '<p class="buy-sub">' + esc(sub) + '</p>' : "") +
      '</header>';
  }

  function foot() {
    return '<footer class="buy-foot"><span class="buy-foot-mark" aria-hidden="true"></span>Payments secured by Cashfree</footer>';
  }

  function summary() {
    return '<div class="info-box buy-summary">' +
      '<span class="buy-label">Order summary</span>' +
      '<ul class="buy-summary-list">' +
      '<li>10 complete AI projects — full source code</li>' +
      '<li>Setup guides and QUICKSTART</li>' +
      '<li>Instant ZIP download after payment</li>' +
      '</ul>' +
      '<div class="buy-total"><span>Total · one-time</span><strong>' + esc(formatPrice()) + '</strong></div>' +
      '</div>';
  }

  function accountBox(account) {
    var email = (account && account.email) || "";
    var initial = email ? email.charAt(0).toUpperCase() : "?";
    return '<div class="info-box buy-account">' +
      '<div class="buy-account-main">' +
      '<span class="buy-avatar" aria-hidden="true">' + esc(initial) + '</span>' +
      '<div>' +
      '<span class="buy-label">Signed in as</span>' +
      '<p class="buy-email">' + esc(email) + '</p>' +
      '</div>' +
      '</div>' +
      '<button class="buy-link" id="switchAccount" type="button">Switch account</button>' +
      '</div>';
  }

  function firstPaidOrder(orders) {
    orders = Array.isArray(orders) ? orders : [];
    for (var i = 0; i < orders.length; i++) {
      if (orders[i] && orders[i].status === "PAID") return orders[i];
    }
    return null;
  }

  // Sends a signed-in customer to the right step: owners get their download,
  // everyone else goes through confirm (or sign-in first).
  function route(account, orders) {
    currentAccount = account || null;
    var paid = firstPaidOrder(orders);
    if (account && paid) renderOwned(account, paid);
    else if (account) renderConfirm(account);
    else renderSignIn();
  }

  function renderOwned(account, order) {
    var orderId = order && (order.order_id || order.id);
    card().innerHTML =
      head("You already own this bundle", "Purchased with this Google account") +
      '<div class="buy-body">' +
      accountBox(account) +
      '<p class="buy-assure"><span class="buy-assure-mark" aria-hidden="true">✓</span>' +
      '<span>No need to pay again — this account already has the AI Projects Bundle. ' +
      'Download it here any time, or from your Orders page.</span></p>' +
      '<div class="buy-actions">' +
      '<button class="btn btn-primary btn-lg" id="ownedDownload" type="button">⬇ Download the bundle</button>' +
      '<button class="btn btn-ghost" id="cancelBuy" type="button">Close</button>' +
      '</div>' +
      '</div>' +
      foot();
    bindCloseButtons();
    document.getElementById("cancelBuy").addEventListener("click", closeModal);
    document.getElementById("switchAccount").addEventListener("click", switchAccount);
    var dl = document.getElementById("ownedDownload");
    if (dl && orderId) dl.addEventListener("click", function () { startDownload(orderId, dl); });
    else if (dl) dl.disabled = true;
    focusCard();
  }

  function renderLoading() {
    card().innerHTML =
      head("Preparing your checkout", "Checking your sign-in…") +
      '<div class="buy-body">' +
      '<div class="buy-loading" role="status"><span class="buy-spinner" aria-hidden="true"></span><span>Just a moment…</span></div>' +
      '</div>' +
      foot();
    bindCloseButtons();
    focusCard();
  }

  function renderSignIn() {
    card().innerHTML =
      head("Sign in to continue", "One-time payment · instant download") +
      '<div class="buy-body">' +
      summary() +
      '<p class="buy-assure"><span class="buy-assure-mark" aria-hidden="true">✓</span>' +
      '<span>We use Google to verify your email. No password to remember — your purchase stays linked to this account.</span></p>' +
      '<div class="buy-gsi" id="checkoutGsi"></div>' +
      '<p class="field-error" id="buyError" role="alert" hidden></p>' +
      '<div class="buy-actions">' +
      '<button class="btn btn-ghost" id="cancelBuy" type="button">Cancel</button>' +
      '</div>' +
      '</div>' +
      foot();
    bindCloseButtons();
    document.getElementById("cancelBuy").addEventListener("click", closeModal);
    focusCard();

    var slot = document.getElementById("checkoutGsi");
    var width = Math.max(200, Math.min(320, (window.innerWidth || 360) - 96));
    window.AIBundleAuth
      .signIn(slot, { button: { text: "signin_with", width: width } })
      .then(function () { return window.AIBundleAuth.session(); })
      .then(function (d) { route(d && d.account, d && d.orders); })
      .catch(function (err) {
        var el = document.getElementById("buyError");
        if (el) { el.textContent = err.message || "Sign-in failed. Try again."; el.hidden = false; }
      });
  }

  function renderConfirm(account) {
    card().innerHTML =
      head("Confirm your order", "One-time payment · instant download") +
      '<div class="buy-body">' +
      accountBox(account) +
      summary() +
      '<div class="buy-field">' +
      '<label class="field-label" for="phone">Mobile number</label>' +
      '<input class="field-input" id="phone" name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="98765 43210" maxlength="16" aria-describedby="phoneHint phoneError" required />' +
      '<p class="buy-hint" id="phoneHint">10-digit Indian mobile number.</p>' +
      '<p class="field-error" id="phoneError" role="alert" hidden></p>' +
      '</div>' +
      '<p class="field-error" id="buyError" role="alert" hidden></p>' +
      '<div class="buy-actions">' +
      '<button class="btn btn-primary btn-lg" id="continuePay" type="button" disabled>Pay ' + esc(formatPrice()) + '</button>' +
      '<button class="btn btn-ghost" id="cancelBuy" type="button">Cancel</button>' +
      '</div>' +
      '</div>' +
      foot();
    bindCloseButtons();
    document.getElementById("cancelBuy").addEventListener("click", closeModal);
    document.getElementById("switchAccount").addEventListener("click", switchAccount);
    document.getElementById("continuePay").addEventListener("click", startPayment);
    bindPhone();
    focusCard();
  }

  function switchAccount() {
    var btn = document.getElementById("switchAccount");
    if (btn) { btn.disabled = true; btn.textContent = "Switching…"; }
    window.AIBundleAuth.logout().then(function () { renderSignIn(); }).catch(function () { renderSignIn(); });
  }

  function renderError(message, retry) {
    if (!document.getElementById("buyModal")) overlay();
    card().innerHTML =
      head("Checkout unavailable", "We could not start the secure checkout.") +
      '<div class="buy-body">' +
      '<p class="field-error" role="alert">' + esc(message) + '</p>' +
      '<div class="buy-actions">' +
      (retry ? '<button class="btn btn-primary" id="retryBuy" type="button">Try again</button>' : '') +
      '<button class="btn btn-ghost" type="button" data-buy-close>Close</button>' +
      '</div>' +
      '</div>' +
      foot();
    bindCloseButtons();
    if (retry) document.getElementById("retryBuy").addEventListener("click", openCheckout);
    focusCard();
  }

  function showBuyError(msg) {
    var el = document.getElementById("buyError");
    if (!el) return toast(msg);
    el.textContent = msg;
    el.hidden = false;
  }

  function showPhoneError(msg) {
    var input = document.getElementById("phone");
    var el = document.getElementById("phoneError");
    if (input) input.setAttribute("aria-invalid", "true");
    if (!el) return showBuyError(msg);
    el.textContent = msg;
    el.hidden = false;
  }

  function clearPhoneError() {
    var input = document.getElementById("phone");
    var el = document.getElementById("phoneError");
    if (input) input.setAttribute("aria-invalid", "false");
    if (el) { el.textContent = ""; el.hidden = true; }
  }

  function normalizePhone(value) {
    var digits = String(value == null ? "" : value).replace(/\D/g, "");
    if (digits.length === 12 && digits.slice(0, 2) === "91") digits = digits.slice(2);
    else if (digits.length === 11 && digits.charAt(0) === "0") digits = digits.slice(1);
    return digits.length === 10 ? digits : "";
  }

  function isValidPhone(value) {
    return /^[6-9]\d{9}$/.test(normalizePhone(value));
  }

  function bindPhone() {
    var input = document.getElementById("phone");
    var pay = document.getElementById("continuePay");
    if (!input || !pay) return;
    function sync(showError) {
      var valid = isValidPhone(input.value);
      pay.disabled = !valid;
      if (valid) clearPhoneError();
      else if (showError) showPhoneError("Enter a valid 10-digit mobile number");
    }
    input.addEventListener("input", function () { sync(false); });
    input.addEventListener("blur", function () { if (input.value.trim()) sync(true); });
    input.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (!pay.disabled) startPayment();
      else sync(true);
    });
    sync(false);
  }

  function resetPayButton(btn) {
    if (!btn) return;
    var input = document.getElementById("phone");
    btn.disabled = !input || !isValidPhone(input.value);
    btn.textContent = "Pay " + formatPrice();
  }

  function startPayment() {
    var input = document.getElementById("phone");
    var phone = normalizePhone(input ? input.value : "");
    if (!isValidPhone(phone)) {
      showPhoneError("Enter a valid 10-digit mobile number");
      if (input) input.focus();
      return;
    }
    var btn = document.getElementById("continuePay");
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = "Starting secure payment…";
    clearPhoneError();
    var buyErr = document.getElementById("buyError");
    if (buyErr) { buyErr.textContent = ""; buyErr.hidden = true; }

    fetch("/api/create-order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: phone }),
    })
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
        if (res.status === 400) {
          showPhoneError((res.body && res.body.error) || "Enter a valid 10-digit mobile number");
          resetPayButton(btn);
          if (input) input.focus();
          return;
        }
        if (res.status === 409 && res.body && res.body.reason === "already_purchased") {
          if (res.body.order_id) renderOwned(currentAccount, { order_id: res.body.order_id });
          else showBuyError((res.body && res.body.error) || "You already own this bundle — download it from your Orders page.");
          return;
        }
        if (!res.body || res.body.ok !== true) throw new Error((res.body && res.body.error) || "Could not start payment");
        return loadSdk().then(function () {
          var cf = window.Cashfree({ mode: res.body.mode === "production" ? "production" : "sandbox" });
          cf.checkout({ paymentSessionId: res.body.payment_session_id, redirectTarget: "_self" });
        });
      })
      .catch(function (err) {
        resetPayButton(btn);
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

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" && e.key !== "Esc") return;
    if (!document.getElementById("buyModal")) return;
    e.preventDefault();
    closeModal();
  });

  window.AIBundleCheckout = { openCheckout: openCheckout, openModal: openCheckout, closeModal: closeModal, watchOrder: watchOrder };
})();
