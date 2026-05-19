/**
 * otaManifest.ts — Sprint-101 TS-Port von tools/ota/manifest.py.
 *
 * Spec-Mirror des OmniTribe-OTA-Channels. Bytes-fuer-Bytes identische
 * Signature-Berechnung wie Python-Side damit ein dort signiertes
 * Manifest hier verifiziert wird (und umgekehrt).
 *
 * Algorithmus:
 *   release.hmac = HMAC-SHA256(secret, version + "\n" + channel + "\n" +
 *                              sha256 + "\n" + size_bytes + "\n" +
 *                              min_loader_version)
 *   manifest.hmac = HMAC-SHA256(secret, sorted(release.hmacs).join("\n") +
 *                               "\n" + manifest_signed_at)
 *
 * WebCrypto: browser & Node 20+ haben native SubtleCrypto. Vitest mit
 * jsdom braucht ggf. webcrypto-Polyfill — nur falls Tests crashen.
 */

export const OTA_SCHEMA_VERSION = 1;

export type Channel = "stable" | "beta" | "dev";

export interface Release {
  version: string;
  channel: Channel;
  url: string;
  size_bytes: number;
  sha256: string;
  released_at: string;
  min_loader_version: string;
  release_notes_url: string;
  hmac: string;
}

export interface Manifest {
  schema_version: number;
  manifest_signed_at: string;
  manifest_hmac: string;
  releases: Release[];
}

// ─── Defaults / Builders ────────────────────────────────────

export function makeReleaseDefaults(partial: Partial<Release>): Release {
  return {
    version: partial.version ?? "0.0.0",
    channel: partial.channel ?? "stable",
    url: partial.url ?? "",
    size_bytes: partial.size_bytes ?? 0,
    sha256: partial.sha256 ?? "",
    released_at: partial.released_at ?? "",
    min_loader_version: partial.min_loader_version ?? "0.1.0",
    release_notes_url: partial.release_notes_url ?? "",
    hmac: partial.hmac ?? "",
  };
}

// ─── HMAC-Signing (WebCrypto) ───────────────────────────────

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function hex(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let out = "";
  for (const b of arr) out += b.toString(16).padStart(2, "0");
  return out;
}

async function hmacSha256(secret: Uint8Array, payload: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", secret as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, payload as BufferSource);
  return hex(sig);
}

function releaseSignedPayload(rel: Release): Uint8Array {
  // Mirror von _release_signed_payload in manifest.py:
  // join([version, channel, sha256, str(size_bytes), min_loader_version], "\n")
  const parts = [
    rel.version,
    rel.channel,
    rel.sha256,
    String(rel.size_bytes),
    rel.min_loader_version,
  ];
  return utf8(parts.join("\n"));
}

function manifestSignedPayload(rels: Release[], signedAt: string): Uint8Array {
  // sorted-by-hmac + "\n" + signedAt — Mirror der Python-Impl
  const sortedHmacs = rels.map((r) => r.hmac).sort();
  return utf8(sortedHmacs.join("\n") + "\n" + signedAt);
}

export async function computeReleaseHmac(
  secret: Uint8Array, rel: Release,
): Promise<string> {
  return hmacSha256(secret, releaseSignedPayload(rel));
}

export async function computeManifestHmac(
  secret: Uint8Array, m: Manifest,
): Promise<string> {
  return hmacSha256(secret, manifestSignedPayload(m.releases, m.manifest_signed_at));
}

/**
 * Signiert ein Manifest in-place: pro Release wird hmac berechnet, dann
 * der Manifest-HMAC. Liefert das gleiche Objekt zurueck.
 */
export async function signManifest(
  secret: Uint8Array, m: Manifest, signedAt?: string,
): Promise<Manifest> {
  m.manifest_signed_at = signedAt ?? new Date().toISOString().replace(/\.\d+Z$/, "Z");
  for (const rel of m.releases) {
    rel.hmac = await computeReleaseHmac(secret, rel);
  }
  m.manifest_hmac = await computeManifestHmac(secret, m);
  return m;
}

// ─── Verify ────────────────────────────────────────────────

export class HmacVerificationError extends Error {
  constructor(msg: string) { super(msg); this.name = "HmacVerificationError"; }
}

/**
 * Constant-time HMAC-Hex-Compare. Beide Strings muessen gleich lang sein
 * sonst wird false zurueckgegeben (keine fruehe Returns bei Length-Mismatch).
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export interface VerifyOptions {
  strict?: boolean;
}

/**
 * Verifiziert Manifest + alle Releases. Returns Array von Fehler-Strings;
 * leer = alles ok. strict=true erfordert HMAC-Felder (Default).
 */
export async function verifyManifest(
  secret: Uint8Array, m: Manifest, opts: VerifyOptions = {},
): Promise<string[]> {
  const strict = opts.strict ?? true;
  const errors: string[] = [];

  if (m.schema_version !== OTA_SCHEMA_VERSION) {
    errors.push(
      `schema_version mismatch: ${m.schema_version} != ${OTA_SCHEMA_VERSION}`,
    );
  }
  if (!m.manifest_signed_at && strict) {
    errors.push("manifest_signed_at fehlt");
  }
  for (let i = 0; i < m.releases.length; i++) {
    const rel = m.releases[i];
    if (!rel.hmac) {
      if (strict) errors.push(`release[${i}] (${rel.version}): hmac fehlt`);
      continue;
    }
    const expected = await computeReleaseHmac(secret, rel);
    if (!constantTimeEqual(expected, rel.hmac)) {
      errors.push(`release[${i}] (${rel.version}): hmac-mismatch`);
    }
  }
  if (!m.manifest_hmac) {
    if (strict) errors.push("manifest_hmac fehlt");
  } else {
    const expected = await computeManifestHmac(secret, m);
    if (!constantTimeEqual(expected, m.manifest_hmac)) {
      errors.push("manifest_hmac mismatch (Tampering?)");
    }
  }
  return errors;
}

export async function assertVerified(
  secret: Uint8Array, m: Manifest, opts: VerifyOptions = {},
): Promise<void> {
  const errs = await verifyManifest(secret, m, opts);
  if (errs.length) {
    throw new HmacVerificationError(errs.join("; "));
  }
}

// ─── Channel-Filter + Version-Selection ────────────────────

export function versionTuple(v: string): number[] {
  // Mirror der Python-_version_tuple-Logik.
  const [base, ...suffix] = v.split("-");
  const parts: number[] = [];
  for (const p of base.split(".")) {
    const n = parseInt(p, 10);
    parts.push(Number.isNaN(n) ? 0 : n);
  }
  while (parts.length < 3) parts.push(0);
  // Suffix-Slot: 1 wenn kein pre-release suffix (= release), 0 sonst
  parts.push(suffix.length === 0 ? 1 : 0);
  return parts;
}

export function compareVersions(a: string, b: string): number {
  const ta = versionTuple(a);
  const tb = versionTuple(b);
  for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
    const av = ta[i] ?? 0;
    const bv = tb[i] ?? 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

export function filterChannel(m: Manifest, channel: Channel): Release[] {
  return m.releases
    .filter((r) => r.channel === channel)
    .sort((a, b) => compareVersions(b.version, a.version));   // descending
}

export function latestForChannel(m: Manifest, channel: Channel): Release | null {
  const rels = filterChannel(m, channel);
  return rels.length ? rels[0] : null;
}
