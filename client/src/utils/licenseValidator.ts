/**
 * Synthstudio – License Validator (TASK-232, v2.97)
 *
 * Pure helpers around the ED25519 license-key format described in
 * `licenseConfig.ts`. Stateless: the store wires them up.
 *
 * Key format:
 *   <base64url(payload-json)>.<base64url(signature-64)>
 *
 * Verification uses @noble/ed25519 verifyAsync (WebCrypto-backed sha512 → no
 * synchronous setup needed). All inputs are defensively bounded.
 */
import * as ed from "@noble/ed25519";
import { etc } from "@noble/ed25519";
import { LICENSE_PRODUCT_ID } from "./licenseConfig";

export interface LicensePayload {
  email: string;
  /** Unix-ms timestamp. null = perpetual. */
  expiresAt: number | null;
  productId: string;
}

export interface LicenseValidationOk {
  valid: true;
  payload: LicensePayload;
}
export interface LicenseValidationFail {
  valid: false;
  reason: string;
}
export type LicenseValidationResult = LicenseValidationOk | LicenseValidationFail;

const MAX_KEY_LENGTH = 4096;
const MAX_EMAIL_LENGTH = 254;

/** Standard base64url decode → Uint8Array. Pure, no allocs beyond result. */
export function base64UrlDecode(input: string): Uint8Array {
  if (typeof input !== "string") throw new Error("base64UrlDecode: not a string");
  // Normalise base64url → base64
  let s = input.replace(/-/g, "+").replace(/_/g, "/");
  const padNeeded = (4 - (s.length % 4)) % 4;
  s += "=".repeat(padNeeded);
  // Decode via atob in browser, Buffer in node (test env)
  let binary: string;
  if (typeof atob === "function") {
    binary = atob(s);
  } else {
    // node fallback used by vitest
    binary = (globalThis as unknown as { Buffer: { from(input: string, enc: string): { toString(e: string): string } } })
      .Buffer.from(s, "base64").toString("binary");
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Standard base64url encode (no padding). */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  let b64: string;
  if (typeof btoa === "function") {
    b64 = btoa(binary);
  } else {
    // node fallback used by vitest
    b64 = (globalThis as unknown as { Buffer: { from(input: string, enc: string): { toString(e: string): string } } })
      .Buffer.from(binary, "binary").toString("base64");
  }
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** Splits a `<payload>.<signature>` key into its raw parts. */
export function parseLicenseKey(key: string): { payloadB64: string; sigB64: string } | null {
  if (typeof key !== "string") return null;
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) return null;
  const dot = key.indexOf(".");
  if (dot < 1 || dot === key.length - 1) return null;
  // Reject more than one dot (avoid ambiguity)
  if (key.indexOf(".", dot + 1) !== -1) return null;
  return { payloadB64: key.slice(0, dot), sigB64: key.slice(dot + 1) };
}

/** Pure payload-decoder. Returns null on any structural error. */
export function decodePayload(payloadB64: string): LicensePayload | null {
  let bytes: Uint8Array;
  try { bytes = base64UrlDecode(payloadB64); } catch { return null; }
  if (bytes.length === 0 || bytes.length > 1024) return null;
  let json: unknown;
  try {
    const text = new TextDecoder().decode(bytes);
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;
  if (typeof obj.email !== "string" || obj.email.length === 0 || obj.email.length > MAX_EMAIL_LENGTH) return null;
  if (obj.productId !== LICENSE_PRODUCT_ID) return null;
  const exp = obj.expiresAt;
  if (exp !== null && (typeof exp !== "number" || !Number.isFinite(exp))) return null;
  return {
    email: obj.email,
    expiresAt: exp === null ? null : (exp as number),
    productId: obj.productId as string,
  };
}

/**
 * Verifies an ED25519-signed license key against a public key (hex).
 *
 * Returns `{valid:true, payload}` on success or `{valid:false, reason}` on
 * any defect — never throws.
 */
export async function validateLicenseKey(
  key: string,
  publicKeyHex: string,
  now: number = Date.now(),
): Promise<LicenseValidationResult> {
  const parts = parseLicenseKey(key);
  if (!parts) return { valid: false, reason: "Ungültiges Schlüssel-Format" };

  const payload = decodePayload(parts.payloadB64);
  if (!payload) return { valid: false, reason: "Payload nicht lesbar" };

  // Public key sanity: 32 bytes
  let pubBytes: Uint8Array;
  try { pubBytes = etc.hexToBytes(publicKeyHex); } catch { return { valid: false, reason: "Public-Key ungültig" }; }
  if (pubBytes.length !== 32) return { valid: false, reason: "Public-Key Länge ≠32" };

  let sigBytes: Uint8Array;
  try { sigBytes = base64UrlDecode(parts.sigB64); } catch { return { valid: false, reason: "Signatur nicht dekodierbar" }; }
  if (sigBytes.length !== 64) return { valid: false, reason: "Signatur Länge ≠64" };

  // Verify the signature over the **raw payload bytes** (not the b64 form).
  let payloadBytes: Uint8Array;
  try { payloadBytes = base64UrlDecode(parts.payloadB64); } catch { return { valid: false, reason: "Payload nicht dekodierbar" }; }

  let ok = false;
  try {
    ok = await ed.verifyAsync(sigBytes, payloadBytes, pubBytes);
  } catch {
    return { valid: false, reason: "Signatur-Verifikation fehlgeschlagen" };
  }
  if (!ok) return { valid: false, reason: "Signatur ungültig" };

  if (payload.expiresAt !== null && payload.expiresAt < now) {
    return { valid: false, reason: "Lizenz abgelaufen" };
  }

  return { valid: true, payload };
}

/**
 * Helper used by tests/dev tooling to **mint** a license key with a known
 * secret key. Never used in production — the secret never lives in the
 * client. Exported here so tests can round-trip without duplicating logic.
 */
export async function signLicensePayload(
  payload: LicensePayload,
  secretKey: Uint8Array,
): Promise<string> {
  const payloadJson = JSON.stringify(payload);
  const payloadBytes = new TextEncoder().encode(payloadJson);
  const sig = await ed.signAsync(payloadBytes, secretKey);
  return `${base64UrlEncode(payloadBytes)}.${base64UrlEncode(sig)}`;
}
