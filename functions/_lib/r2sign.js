// R2 (S3-compatible) SigV4 presigned GET URLs. Secrets come from env, never the client.
// Needs: R2_ACCOUNT_ID, R2_S3_ACCESS_KEY_ID, R2_S3_SECRET_ACCESS_KEY, R2_BUCKET.
// Object key defaults to env.R2_OBJECT_KEY.
const te = new TextEncoder();

function toAmzDate(d) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

async function hmac(key, msg) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, te.encode(msg)));
}

async function sha256Hex(msg) {
  const d = await crypto.subtle.digest("SHA-256", te.encode(msg));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Returns a bearer download URL valid for `expiresSec` (default 1800s = 30 min).
export async function presignedR2GetUrl(env, expiresSec = 1800) {
  const accountId = env.R2_ACCOUNT_ID;
  const accessKey = env.R2_S3_ACCESS_KEY_ID;
  const secretKey = env.R2_S3_SECRET_ACCESS_KEY;
  const bucket = env.R2_BUCKET;
  const objectKey = env.R2_OBJECT_KEY || "products/ai-projects-bundle-v1.zip";
  if (!accountId || !accessKey || !secretKey || !bucket) {
    throw new Error("R2 storage is not configured");
  }

  const region = "auto";
  const service = "s3";
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const encodedKey = objectKey.split("/").map(encodeURIComponent).join("/");

  const params = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${accessKey}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(Math.min(Math.max(expiresSec, 60), 3600)),
    "X-Amz-SignedHeaders": "host",
    "response-content-disposition": `attachment; filename="AI-Projects-Bundle.zip"`,
  });
  // SigV4 requires sorted params + strict RFC3986 encoding.
  const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  const canonicalQS = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${enc(k)}=${enc(v)}`).join("&");

  const canonicalRequest = [
    "GET", `/${bucket}/${encodedKey}`, canonicalQS,
    `host:${host}\n`, "host", "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join("\n");

  const kDate = await hmac(te.encode("AWS4" + secretKey), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  const kFinal = await crypto.subtle.importKey("raw", kSigning, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBytes = new Uint8Array(await crypto.subtle.sign("HMAC", kFinal, te.encode(stringToSign)));
  const signature = [...sigBytes].map((x) => x.toString(16).padStart(2, "0")).join("");

  return `https://${host}/${bucket}/${encodedKey}?${canonicalQS}&X-Amz-Signature=${signature}`;
}
