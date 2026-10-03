# AI Bundle — Sales Site (STEP 2)

Static landing page for the AI Projects Bundle. No backend, no build step.

## Run locally

```powershell
cd AI-Bundle-Site
python -m http.server 8080
```

Open `http://127.0.0.1:8080/`.

## Deploy

Copy the folder contents (`index.html`, `style.css`, `script.js`, `assets/`) to any
static host (GitHub Pages, Cloudflare Pages, Netlify). No server code required.

## Going live with payment (later)

Open **`script.js`** — everything is in the `CONFIG` block at the top:

```js
var CONFIG = {
  PAYMENT_URL: "#",        // ← paste Razorpay/payment URL here
  PRICE: "₹299",           // ← change price once; all [data-price] spots update
  CONTACT_EMAIL: ""        // ← support inbox; footer Contact activates when set
};
```

Until `PAYMENT_URL` is a real URL, all buy buttons scroll to `#pricing`
and footer policy links show "coming soon" toasts. No checkout is faked.

## Structure

Multi-page static store (no backend, no build step):

- `index.html` — storefront home (hero, shelves, featured, value, pricing)
- `shop.html` — all 10 projects + search + category filters
- `product.html?id=...` — detail page, rendered from `store.js`
- `cart.html` / `checkout.html` — cart (localStorage) + honest payment placeholder
- `how.html`, `faq.html`, `refund.html`, `privacy.html` — info pages
- `store.js` — product data, cart, page renderers
- `script.js` — CONFIG + nav, FAQ accordion, reveal, buy-button wiring
- `style.css` — lab-notebook theme, mobile-first
- `assets/showcase/*.jpg` — real screenshots from the running apps (optimized)
