// Private product delivery WITHOUT R2 (₹0 architecture).
// The ZIP lives as a single binary value in a private Workers KV namespace
// (binding: env.BUNDLE_FILES). KV has no public URL surface: the ONLY read
// path is this module, called after the D1 PAID gate in the route handlers.
export const BUNDLE_KEY = "ai-projects-bundle-v1.zip";
export const BUNDLE_FILENAME = "AI-Projects-Bundle.zip";
export const MAX_BUNDLE_BYTES = 10 * 1024 * 1024;

// Returns ArrayBuffer, or null when the bundle is not deployed.
export async function getBundleBytes(env) {
  const kv = env.BUNDLE_FILES;
  if (!kv) throw new Error("Bundle storage is not configured");
  const bytes = await kv.get(BUNDLE_KEY, "arrayBuffer");
  if (!bytes || bytes.byteLength === 0) return null;
  if (bytes.byteLength > MAX_BUNDLE_BYTES) throw new Error("Bundle oversize");
  return bytes;
}

export function zipResponse(bytes) {
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${BUNDLE_FILENAME}"`,
      "content-length": String(bytes.byteLength),
      "cache-control": "no-store",
    },
  });
}
