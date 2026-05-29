/**
 * Synthstudio – License Configuration (TASK-232, v2.97)
 *
 * Static constants for the license validation layer. The public key is the
 * VERIFICATION key (NOT a signing/secret key). Keeping it in the client is
 * standard practice for offline license verification — only the **secret**
 * key, held by the vendor, can mint new keys.
 *
 * ─── HOW TO PRODUCE THE REAL VALUES ─────────────────────────────────────────
 *
 * 1) Generate an Ed25519 keypair (offline, on a trusted machine):
 *
 *    import * as ed from "@noble/ed25519";
 *    import { etc } from "@noble/ed25519";
 *    const { secretKey, publicKey } = await ed.keygenAsync();
 *    console.log("SECRET (KEEP PRIVATE):", etc.bytesToHex(secretKey));
 *    console.log("PUBLIC  (paste below):", etc.bytesToHex(publicKey));
 *
 * 2) Store the SECRET KEY in a **secure** location (password manager,
 *    encrypted vault). Never commit it. Use it on your Gumroad webhook /
 *    signing server to mint license payloads.
 *
 * 3) Replace LICENSE_PUBLIC_KEY_HEX below with the public key hex string.
 *
 * 4) Update GUMROAD_PRODUCT_URL with the real product slug once the Gumroad
 *    listing exists.
 *
 * ─── LICENSE-KEY FORMAT ─────────────────────────────────────────────────────
 *
 *   <base64url(payload-json)>.<base64url(signature-64-bytes)>
 *
 * Payload JSON shape:
 *   { email: string, expiresAt: number|null, productId: "synthstudio-pro-1" }
 *
 * expiresAt:
 *   - null  → perpetual license
 *   - number → unix-ms timestamp after which the key is rejected
 */

// TODO: replace with real public key from your ED25519 keypair (32 bytes hex)
// This placeholder is the all-zero key — verification will always fail with it.
export const LICENSE_PUBLIC_KEY_HEX =
  "0000000000000000000000000000000000000000000000000000000000000000";

/** Stable product identifier embedded in the signed payload. */
export const LICENSE_PRODUCT_ID = "synthstudio-pro-1";

/**
 * ⚠️ TEMPORÄRER DEV-MASTER-KEY — NUR im Dev-/Test-Build aktiv.
 *
 * Schaltet die Vollversion (Pro) ohne Ed25519-Signatur-Validierung frei.
 * Nur für die Entwicklungsphase gedacht, solange noch kein echter Public-Key /
 * Gumroad-Flow existiert.
 *
 * WICHTIG: Der Check ist hinter `import.meta.env.PROD` gegated, damit der Key
 * NIEMALS in einen Production-Build (z.B. öffentliches Vercel-Deploy) gelangt —
 * sonst wäre der Pro-Bypass für jeden im JS-Bundle lesbar. Im Prod-Build wird
 * der frühe `return false` zu totem Code danach → das Literal wird wegoptimiert.
 *
 * TODO(release): Sobald LICENSE_PUBLIC_KEY_HEX ein echter Key ist, diese
 * Funktion + den Branch in useLicenseStore.activate() ganz entfernen.
 */
export function isMasterLicenseKey(key: string): boolean {
  if (import.meta.env.PROD) return false; // im Prod-Build deaktiviert (Key nicht öffentlich)
  return key.trim() === "137924568";
}

/** Trial duration in days. v2.97 ships with 30-day default. */
export const TRIAL_DURATION_DAYS = 30;

/** Milliseconds per day (cached for arithmetic). */
export const DAY_MS = 24 * 60 * 60 * 1000;

// TODO: replace with the real Gumroad product URL once the listing exists.
export const GUMROAD_PRODUCT_URL = "https://gumroad.com/l/synthstudio-pro";

/** Returns true if the public key is still the placeholder — UI may warn. */
export function isUsingPlaceholderPublicKey(): boolean {
  return LICENSE_PUBLIC_KEY_HEX === "0".repeat(64);
}
