/* Store data + cart. Single source of truth for products.
   PAYMENT_URL/CONFIG lives in script.js — checkout reads it from there. */
var PRODUCTS = [
  { id: "visionai", name: "VisionAI", tag: "Image AI", price: 0,
    img: "assets/showcase/visionai.jpg",
    short: "Upload an image, ask AI questions about what it contains.",
    desc: "AI image analysis: upload any photo, screenshot, or document and interrogate it with a Groq vision model. Server-side key, image validation and downscaling included.",
    feats: ["Ask anything about any photo", "JPG/PNG/WEBP/GIF up to 10MB", "Copy + retry + settings panel"] },
  { id: "pdfchat", name: "PDFChat", tag: "Documents", price: 0,
    img: "assets/showcase/pdfchat.jpg",
    short: "Chat with PDFs using local retrieval plus grounded AI answers.",
    desc: "Upload a text-based PDF. It gets chunked and indexed locally (TF-IDF, no downloads), then Groq answers with real page-number sources. Streaming answers included.",
    feats: ["Page-number citations", "Streaming answers", "New-thread + remove controls"] },
  { id: "voiceai", name: "VoiceAI", tag: "Voice", price: 0,
    img: "assets/showcase/voiceai.jpg",
    short: "Talk to AI with browser speech recognition and speech synthesis.",
    desc: "Mic recording with live VU meter, Groq Whisper transcription, Groq chat, and browser-native speech synthesis. No premium voice service needed.",
    feats: ["Live mic level meter", "60s auto-stop", "Voice picker + replay"] },
  { id: "studybattle", name: "StudyBattle", tag: "Game", price: 0,
    img: "assets/showcase/studybattle.jpg",
    short: "Arcade-style AI quiz battle with XP, streaks and boss rounds.",
    desc: "Timed questions, XP, levels, streaks, combos, a boss round every 5th battle, adaptive difficulty, and a validated question bank that never repeats.",
    feats: ["Boss rounds + 3x XP", "Streak/combo HUD", "Weak-topic report card"] },
  { id: "mindgame", name: "MindGame", tag: "Game", price: 0,
    img: "assets/showcase/mindgame.jpg",
    short: "Choice-based AI personality game with a fun archetype result.",
    desc: "Answer 6 vivid AI scenarios, pick cards, and get a playful archetype reading with strengths, style and fun weaknesses. Entertainment only — stamped on every screen.",
    feats: ["6 AI scenarios", "Shareable result card", "Keyboard shortcuts"] },
  { id: "roastbattle", name: "RoastBattle", tag: "Game", price: 0,
    img: "assets/showcase/roastbattle.jpg",
    short: "Three-round AI roast battle with comebacks and round scores.",
    desc: "Pick a target and a style, trade comebacks across 3 rounds, get scored for fun, and take home a verdict plus a copyable result. Safety redirect keeps it playful.",
    feats: ["4 roast styles", "Animated score reveal", "Copy + replay"] },
  { id: "charactercreator", name: "CharacterCreator", tag: "Characters", price: 0,
    img: "assets/showcase/character.jpg",
    short: "Create AI characters and chat with them in character.",
    desc: "Generate full character sheets (stats, backstory, catchphrases), chat in character, modify, export SillyTavern-compatible cards, and get a free AI portrait per character.",
    feats: ["Tavern card export/import", "AI portraits (keyless)", "Optional 18+ mature mode"] },
  { id: "storygame", name: "StoryGame", tag: "Story", price: 0,
    img: "assets/showcase/storygame.jpg",
    short: "Branching AI adventure with state, inventory and endings.",
    desc: "A short, contained adventure (~10 turns, auto-finale by design): persistent world state, inventory, health, flags, custom actions, multiple endings, markdown export.",
    feats: ["Story codex panel", "Health + inventory", "Export your tale"] },
  { id: "mysterydetective", name: "MysteryDetective", tag: "Mystery", price: 0,
    img: "assets/showcase/mystery.jpg",
    short: "Solve AI-generated mysteries with evidence and accusation.",
    desc: "Pulp-detective case files: interrogate suspects, pin evidence on the board, follow the timeline, manage 12 probes and 3 accusations. Culprit locked server-side until reveal.",
    feats: ["Evidence board", "Probe/accusation budget", "Spoiler-safe redaction"] },
  { id: "interviewsim", name: "InterviewSim", tag: "Career", price: 0,
    img: "assets/showcase/interview.jpg",
    short: "Mock interviews with AI scoring and a practice report.",
    desc: "Boardroom-style mock interviews: CV-tailored question plans, voice dictation, follow-ups, speech metrics (WPM, fillers, STAR hints) and a final report. Practice feedback, not employment assessment.",
    feats: ["CV upload + tailored plan", "Speech metrics", "Final report card"] }
];
var BUNDLE = { id: "bundle", name: "AI Projects Bundle (all 10 projects)" };

function money() { return (window.CONFIG && window.CONFIG.PRICE) || "₹299"; }

/* ---- cart (localStorage, bundle-only honest store) ---- */
var Cart = {
  key: "ab_cart_v1",
  get: function () {
    try { return JSON.parse(localStorage.getItem(this.key) || "[]"); } catch (e) { return []; }
  },
  set: function (items) { try { localStorage.setItem(this.key, JSON.stringify(items)); } catch (e) {} },
  has: function (id) { return this.get().indexOf(id) !== -1; },
  add: function (id) { var c = this.get(); if (c.indexOf(id) === -1) { c.push(id); this.set(c); } updateCartBadge(); },
  clear: function () { this.set([]); updateCartBadge(); }
};
function updateCartBadge() {
  document.querySelectorAll("[data-cart-count]").forEach(function (el) {
    var n = Cart.get().length;
    el.textContent = n;
    el.hidden = n === 0;
  });
}
function productById(id) {
  for (var i = 0; i < PRODUCTS.length; i++) if (PRODUCTS[i].id === id) return PRODUCTS[i];
  return null;
}
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function cardHTML(p) {
  return '<article class="pcard"><a class="pcover" href="product.html?id=' + p.id + '" aria-label="View ' + esc(p.name) + '">' +
    '<img src="' + p.img + '" alt="' + esc(p.name) + ' app screenshot" loading="lazy" /></a>' +
    '<div class="pbody"><p class="vendor">AI PROJECTS BUNDLE</p>' +
    '<h3><a href="product.html?id=' + p.id + '">' + esc(p.name) + '</a></h3>' +
    '<p class="pshort">' + esc(p.short) + '</p>' +
    '<p class="pprice">' + esc(money()) + '</p>' +
    '<button class="btn btn-buy" data-buy>Buy Now</button></div></article>';
}

/* global Buy-Now: bundle-only store — adds bundle, goes to checkout */
document.addEventListener("click", function (e) {
  var b = e.target.closest ? e.target.closest("[data-buy]") : null;
  if (!b) return;
  Cart.add("bundle");
  location.href = "checkout.html";
});

function storeToast(msg) {
  var t = document.createElement("div");
  t.textContent = msg;
  t.style.cssText = "position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#fffdf4;color:#211a10;border:2px solid #211a10;border-radius:10px;padding:12px 18px;font-size:14px;z-index:99;box-shadow:3px 3px 0 #211a10";
  document.body.appendChild(t);
  setTimeout(function () { t.remove(); }, 2200);
}

/* home: shelves + featured */
function renderHome() {
  var tags = [], seen = {};
  PRODUCTS.forEach(function (p) { if (!seen[p.tag]) { seen[p.tag] = 1; tags.push(p.tag); } });
  var row = document.getElementById("shelfRow");
  if (row) row.innerHTML = tags.map(function (t) {
    return '<a class="shelf" href="shop.html?tag=' + encodeURIComponent(t) + '">' + esc(t) + ' →</a>';
  }).join("");
  var feat = document.getElementById("featuredRow");
  if (feat) {
    var picks = ["roastbattle", "visionai", "pdfchat", "mysterydetective"];
    feat.innerHTML = picks.map(function (id) { return cardHTML(productById(id)); }).join("");
  }
  updateCartBadge();
}

/* shop: search + filter + grid */
function renderShop() {
  var params = new URLSearchParams(location.search);
  var activeTag = params.get("tag") || "All";
  var tags = ["All"], seen = {};
  PRODUCTS.forEach(function (p) { if (!seen[p.tag]) { seen[p.tag] = 1; tags.push(p.tag); } });
  var fr = document.getElementById("filterRow");
  function draw() {
    var q = (document.getElementById("search").value || "").toLowerCase();
    var list = PRODUCTS.filter(function (p) {
      var okTag = activeTag === "All" || p.tag === activeTag;
      var okQ = !q || (p.name + " " + p.short + " " + p.tag).toLowerCase().indexOf(q) !== -1;
      return okTag && okQ;
    });
    document.getElementById("shopGrid").innerHTML = list.map(cardHTML).join("");
    document.getElementById("noResults").hidden = list.length !== 0;
    fr.innerHTML = tags.map(function (t) {
      return '<button class="chip' + (t === activeTag ? " on" : "") + '" data-tag="' + esc(t) + '">' + esc(t) + "</button>";
    }).join("");
    fr.querySelectorAll("[data-tag]").forEach(function (b) {
      b.addEventListener("click", function () { activeTag = b.getAttribute("data-tag"); draw(); });
    });
  }
  document.getElementById("search").addEventListener("input", draw);
  draw();
  updateCartBadge();
}

/* product detail */
function renderProduct() {
  var id = new URLSearchParams(location.search).get("id");
  var p = productById(id) || PRODUCTS[0];
  document.title = p.name + " — AI Projects Bundle";
  document.getElementById("crumbName").textContent = p.name;
  document.getElementById("productBox").innerHTML =
    '<div class="detail"><div class="dcover"><img src="' + p.img + '" alt="' + esc(p.name) + ' app screenshot" /></div>' +
    '<div class="dinfo"><p class="pill">◈ ' + esc(p.tag) + '</p>' +
    '<h1 class="page-title">' + esc(p.name) + '</h1>' +
    '<p class="fine">Available in: <strong>AI Projects Bundle</strong></p>' +
    '<div class="pricebox"><p class="price">' + esc(money()) + '</p>' +
    '<p class="fine">one-time · all 10 projects · yours to keep</p></div>' +
    '<p>' + esc(p.desc) + '</p><ul class="feat-list">' +
    p.feats.map(function (f) { return "<li>✓ " + esc(f) + "</li>"; }).join("") + "</ul>" +
    '<p class="fine">Needs your own Groq API key · runs on your computer</p>' +
    '<div class="hero-cta"><button class="btn btn-buy btn-lg" data-buy>🛒 Buy Now</button> ' +
    '<button class="btn btn-ghost" id="shareBtn">⤴ Share</button></div>' +
    '<p style="margin-top:14px"><a href="shop.html">← All projects</a></p></div></div>';
  document.getElementById("shareBtn").addEventListener("click", function () {
    var data = { title: p.name + " — AI Projects Bundle", text: p.name + ": " + p.short, url: location.href };
    if (navigator.share) { navigator.share(data).catch(function () {}); }
    else if (navigator.clipboard) {
      navigator.clipboard.writeText(data.title + " " + data.url).then(function () { storeToast("Link copied!"); });
    }
  });
  var others = PRODUCTS.filter(function (x) { return x.id !== p.id; }).slice(0, 3);
  document.getElementById("relatedRow").innerHTML = others.map(cardHTML).join("");
  updateCartBadge();
}

/* cart */
function renderCart() {
  var box = document.getElementById("cartBox");
  if (!Cart.has("bundle")) {
    box.innerHTML = '<div class="empty-cart"><p>Your cart is empty.</p><a class="btn btn-primary" href="shop.html">Browse projects →</a></div>';
  } else {
    box.innerHTML = '<div class="cart-line"><div><strong>' + esc(BUNDLE.name) + '</strong>' +
      '<p class="fine">10 projects · source code · ZIP download</p></div>' +
      '<div class="cart-price">' + esc(money()) + '</div></div>' +
      '<div class="cart-total"><span>Total</span><strong>' + esc(money()) + '</strong></div>' +
      '<div class="hero-cta"><a class="btn btn-primary" href="checkout.html">Proceed to Checkout →</a> ' +
      '<button class="btn btn-ghost" id="clearCart">Clear cart</button></div>';
    document.getElementById("clearCart").addEventListener("click", function () { Cart.clear(); renderCart(); });
  }
  updateCartBadge();
}

/* checkout (placeholder until payment goes live) */
function renderCheckout() {
  var box = document.getElementById("checkoutBox");
  var live = window.CONFIG && window.CONFIG.PAYMENT_URL && window.CONFIG.PAYMENT_URL !== "#";
  var summary = Cart.has("bundle")
    ? '<div class="cart-line"><div><strong>' + esc(BUNDLE.name) + '</strong></div><div class="cart-price">' + esc(money()) + '</div></div>'
    : '<p>Your cart is empty. <a href="shop.html">Browse projects →</a></p>';
  box.innerHTML = summary +
    (Cart.has("bundle") ? '<div class="cart-total"><span>Total</span><strong>' + esc(money()) + '</strong></div>' +
    (live
      ? '<p><a class="btn btn-primary btn-lg" href="' + esc(window.CONFIG.PAYMENT_URL) + '">Pay ' + esc(money()) + ' →</a></p>'
      : '<div class="key-note"><strong>Checkout is not connected yet.</strong><br />Payment integration is coming soon — add the bundle to cart and check back, or contact us via the footer.</div>') : "");
  updateCartBadge();
}
