/* AI Projects Bundle — checkout flow (no secrets here; price comes from the server).
   Buy Now -> email modal -> POST /api/create-order -> cashfree.js checkout ->
   return to success.html -> poll /api/payment-status -> paid download. */
(function () {
  "use strict";

  var EMAIL_RE = /^[^\s@<>(),;:\\"[\]]+@[^\s@<>(),;:\\"[\]]+\.[^\s@<>(),;:\\"[\]]{2,}$/;
  var SDK_URL = "https://sdk.cashfree.com/js/v3/cashfree.js";

  function toast(msg) {
    var t = document.createElement("div");
    t.textContent = msg;
    t.setAttribute("role", "status");
    t.style.cssText = "position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#fffdf4;color:#211a10;border:2px solid #211a10;border-radius:10px;padding:12px 18px;font-size:14px;z-index:99;box-shadow:3px 3px 0 #211a10;max-width:90vw";
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3200);
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

  function openModal() {
    closeModal();
    var ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.id = "buyModal";
    ov.innerHTML =
      '<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="buyTitle">' +
      "<h2 id=\"buyTitle\">Get the Bundle — ₹249</h2>" +
      "<p class=\"buy-lead\">AI Projects Bundle · One-time payment</p>" +
      "<label class=\"field-label\" for=\"buyEmail\">Where should we send your download?</label>" +
      "<input class=\"field-input\" id=\"buyEmail\" type=\"email\" autocomplete=\"email\" placeholder=\"you@example.com\" />" +
      "<label class=\"field-label\" for=\"buyPhone\">Mobile number <span class=\"fine\">(10-digit, required by the payment gateway)</span></label>" +
      "<input class=\"field-input\" id=\"buyPhone\" type=\"tel\" autocomplete=\"tel\" inputmode=\"numeric\" placeholder=\"10-digit mobile\" />" +
      "<p class=\"fine\">Your download link will be sent to this email after payment is confirmed.</p>" +
      "<p class=\"field-error\" id=\"buyError\" hidden></p>" +
      "<button class=\"btn btn-primary btn-lg\" id=\"continuePay\" type=\"button\">Continue to payment</button> " +
      "<button class=\"btn btn-ghost\" id=\"cancelBuy\" type=\"button\">Cancel</button>" +
      "<p class=\"fine\">Secure payment powered by Cashfree</p>" +
      "</div>";
    document.body.appendChild(ov);
    document.getElementById("cancelBuy").addEventListener("click", closeModal);
    ov.addEventListener("click", function (e) { if (e.target === ov) closeModal(); });
    document.getElementById("continuePay").addEventListener("click", submitEmail);
    var input = document.getElementById("buyEmail");
    input.focus();
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") submitEmail(); });
  }

  function closeModal() {
    var ov = document.getElementById("buyModal");
    if (ov) ov.remove();
  }

  function showError(msg) {
    var el = document.getElementById("buyError");
    if (!el) return toast(msg);
    el.textContent = msg;
    el.hidden = false;
  }

  function submitEmail() {
    var input = document.getElementById("buyEmail");
    var btn = document.getElementById("continuePay");
    var phoneInput = document.getElementById("buyPhone");
    var email = (input.value || "").trim();
    if (!EMAIL_RE.test(email) || email.length > 254) {
      showError("Enter a valid email address.");
      input.focus();
      return;
    }
    var payload = { email: email };
    var digits = ((phoneInput && phoneInput.value) || "").replace(/[^\d]/g, "").replace(/^91(?=\d{10}$)/, "");
    if (!/^[6-9]\d{9}$/.test(digits)) {
      showError("Enter a valid 10-digit mobile number — the payment gateway requires it.");
      phoneInput.focus();
      return;
    }
    payload.phone = digits;
    btn.disabled = true;
    btn.textContent = "Starting payment…";
    fetch("/api/create-order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) throw new Error(data.error || "Could not start payment");
        return loadSdk().then(function () {
          var cf = window.Cashfree({ mode: data.mode === "production" ? "production" : "sandbox" });
          cf.checkout({ paymentSessionId: data.payment_session_id, redirectTarget: "_self" });
        });
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = "Continue to payment";
        showError(err.message || "Could not start payment, please try again.");
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
            if (sub) sub.textContent = "Your AI Projects Bundle is ready.";
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

  window.AIBundleCheckout = { openModal: openModal, closeModal: closeModal, watchOrder: watchOrder };
})();
