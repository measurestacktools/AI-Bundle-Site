/* AI Projects Bundle — sales site config + interactions.
   ============================================================
   STEP-2 PLACEHOLDERS — EDIT THESE WHEN READY:
   - PAYMENT_URL: paste the Razorpay/payment link here when payment
     goes live. Until then it MUST stay "#" (buttons scroll to
     pricing instead of charging anyone).
   - PRICE: the displayed price. Change once here; every [data-price]
     element on the page updates automatically.
   - CONTACT_EMAIL: leave "" until there is a support inbox; the footer
     Contact link stays a harmless placeholder meanwhile.
   ============================================================ */
const PAYMENT_URL = "#";
var CONFIG = {
  PAYMENT_URL: PAYMENT_URL,
  PRICE: "₹299",
  CONTACT_EMAIL: ""
};

(function () {
  "use strict";

  /* price injection (single source of truth) */
  document.querySelectorAll("[data-price]").forEach(function (el) {
    el.textContent = CONFIG.PRICE;
  });

  /* buy buttons: placeholder -> scroll to pricing; live URL -> go pay */
  function wireBuy(btn) {
    if (!btn) return;
    if (CONFIG.PAYMENT_URL && CONFIG.PAYMENT_URL !== "#") {
      btn.setAttribute("href", CONFIG.PAYMENT_URL);
    } else {
      btn.addEventListener("click", function (e) {
        if (btn.id === "buyBtn" || btn.id === "buyBtn2") {
          e.preventDefault();
          document.getElementById("pricing").scrollIntoView({ behavior: "smooth" });
        }
      });
    }
  }
  wireBuy(document.getElementById("buyBtn"));
  wireBuy(document.getElementById("buyBtn2"));
  document.querySelectorAll("[data-cta]").forEach(function (a) {
    if (a.id === "buyBtn" || a.id === "buyBtn2") return;
    if (CONFIG.PAYMENT_URL && CONFIG.PAYMENT_URL !== "#") return;
    /* nav/hero CTAs keep their #pricing href (native smooth scroll) */
  });

  /* footer placeholders: contact / refund / privacy (coming soon pages) */
  var contact = document.getElementById("contactLink");
  if (contact) {
    if (CONFIG.CONTACT_EMAIL) contact.setAttribute("href", "mailto:" + CONFIG.CONTACT_EMAIL);
    else contact.addEventListener("click", function (e) { e.preventDefault(); toast("Contact inbox coming soon — check the FAQ meanwhile."); });
  }
  [["refundLink", "Refund policy page coming soon."], ["privacyLink", "Privacy policy page coming soon."]].forEach(function (pair) {
    var el = document.getElementById(pair[0]);
    if (el) el.addEventListener("click", function (e) { e.preventDefault(); toast(pair[1]); });
  });

  /* project card -> showcase figure scroll */
  document.querySelectorAll("[data-goto]").forEach(function (a) {
    a.addEventListener("click", function () {
      var t = document.getElementById("shot-" + a.getAttribute("data-goto"));
      if (!t) return;
      setTimeout(function () {
        t.scrollIntoView({ behavior: "smooth", block: "center" });
        t.style.outline = "2px solid var(--signal)";
        setTimeout(function () { t.style.outline = ""; }, 1600);
      }, 60);
    });
  });

  /* mobile nav */
  var toggle = document.getElementById("navToggle");
  var links = document.getElementById("navLinks");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    });
    links.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () { links.classList.remove("open"); });
    });
  }

  /* FAQ accordion (one open at a time, keyboard native via <button>) */
  document.querySelectorAll(".faq-item").forEach(function (item) {
    var q = item.querySelector(".faq-q");
    var a = item.querySelector(".faq-a");
    if (!q || !a) return;
    q.addEventListener("click", function () {
      var isOpen = item.classList.contains("open");
      document.querySelectorAll(".faq-item.open").forEach(function (o) {
        o.classList.remove("open");
        o.querySelector(".faq-a").style.maxHeight = "0px";
        o.querySelector(".faq-q").setAttribute("aria-expanded", "false");
      });
      if (!isOpen) {
        item.classList.add("open");
        a.style.maxHeight = a.scrollHeight + "px";
        q.setAttribute("aria-expanded", "true");
      }
    });
  });

  /* subtle reveal on scroll (skipped for reduced-motion users by CSS) */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll(".card, .pcard, .shots figure, .price-card, .steps li").forEach(function (el) {
    el.classList.add("reveal");
    io.observe(el);
  });

  function toast(msg) {
    var t = document.createElement("div");
    t.textContent = msg;
    t.style.cssText = "position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#131a29;color:#f2ecdf;border:1px solid rgba(245,165,36,.5);border-radius:10px;padding:12px 18px;font-size:14px;z-index:99";
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }
})();
