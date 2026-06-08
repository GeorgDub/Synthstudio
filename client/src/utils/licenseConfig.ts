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

/** Der Demo-/Master-Key, der die Vollversion ohne Signatur freischaltet. */
export const MASTER_LICENSE_KEY = "137924568";

/**
 * Build-Umgebung, die entscheidet ob der Master-Key akzeptiert wird.
 * Wird in Tests explizit übergeben (deterministisch), zur Laufzeit via
 * {@link detectMasterKeyEnv} aus `import.meta.env` + `window.electronAPI`.
 */
export interface MasterKeyEnv {
  /** true im Production-Bundle (`import.meta.env.PROD`). */
  isProd: boolean;
  /** true wenn die App in der gepackten Electron-Desktop-App läuft. */
  isElectron: boolean;
}

/** Ermittelt die Master-Key-Umgebung zur Laufzeit. */
export function detectMasterKeyEnv(): MasterKeyEnv {
  const isProd = Boolean(import.meta.env.PROD);
  const isElectron =
    typeof window !== "undefined" &&
    Boolean(
      (window as unknown as { electronAPI?: { isElectron?: boolean } })
        .electronAPI?.isElectron,
    );
  return { isProd, isElectron };
}

/**
 * ⚠️ TEMPORÄRER DEMO-/MASTER-KEY — schaltet die Vollversion (Pro) ohne
 * Ed25519-Signatur-Validierung frei. Gedacht für die Entwicklungsphase +
 * die ausgelieferte Desktop-App, solange noch kein echter Public-Key /
 * Gumroad-Flow existiert.
 *
 * AKZEPTIERT in:
 *   - Dev-/Test-Build (`!isProd`) — lokale Entwicklung & Vitest.
 *   - Gepackter Electron-Desktop-App (`isElectron`) — das ausgelieferte
 *     Produkt (Win/Mac/Linux). Der Demo-Key soll dort funktionieren.
 *
 * BLOCKIERT in:
 *   - Öffentlichem Web-Prod-Build (Vercel: `isProd && !isElectron`), damit der
 *     Pro-Bypass NICHT im public JS-Bundle für jeden lesbar ist.
 *
 * TODO(release): Sobald LICENSE_PUBLIC_KEY_HEX ein echter Key ist, diese
 * Funktion + den Branch in useLicenseStore.activate() ganz entfernen.
 */
export function isMasterLicenseKey(
  key: string,
  env: MasterKeyEnv = detectMasterKeyEnv(),
): boolean {
  // Nur im öffentlichen Web-Prod-Build deaktiviert (Key dort öffentlich lesbar).
  if (env.isProd && !env.isElectron) return false;
  return key.trim() === MASTER_LICENSE_KEY;
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
