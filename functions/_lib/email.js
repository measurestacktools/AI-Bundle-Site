// Purchase email delivery. Provider: Resend (REST, Workers-compatible).
// Configure RESEND_API_KEY + RESEND_FROM. If absent, delivery is SKIPPED
// (never faked) and the caller must surface that honestly.
export function emailConfigured(env) {
  return Boolean(env.RESEND_API_KEY && env.RESEND_FROM);
}

// Returns { sent: true } | { sent: false, reason } — never throws for provider errors.
export async function sendPurchaseEmail(env, { to, orderId, downloadUrl, siteUrl }) {
  if (!emailConfigured(env)) {
    console.log("[email] skipped: provider not configured");
    return { sent: false, reason: "provider_not_configured" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESEND_FROM,
        to: [to],
        subject: "Your AI Projects Bundle is ready (₹249)",
        html:
          `<p>Payment confirmed. Thank you!</p>` +
          `<p><strong>AI Projects Bundle</strong><br/>Order ${escapeHtml(orderId)} · ₹249 one-time</p>` +
          `<p><a href="${escapeHtml(downloadUrl)}">Download your ZIP</a> — ` +
          `this link is personal to your order and always checks payment status. ` +
          `You can generate a fresh link anytime from your <a href="${escapeHtml(siteUrl)}/success.html?oid=${encodeURIComponent(orderId)}">purchase page</a>.</p>` +
          `<p>Setup: unzip, add your free Groq API key per any project README, run locally.</p>` +
          `<p>Questions: see ${escapeHtml(siteUrl)}/contact.html</p>`,
      }),
    });
    if (!res.ok) {
      console.log(`[email] provider error http_${res.status}`);
      return { sent: false, reason: `provider_http_${res.status}` };
    }
    return { sent: true };
  } catch (e) {
    console.log("[email] send failed");
    return { sent: false, reason: "send_failed" };
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
