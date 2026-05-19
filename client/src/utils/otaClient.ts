/**
 * otaClient.ts — Sprint-101 TS-Port von tools/ota/client.py.
 *
 * High-Level Update-Check-Workflow:
 *   1. fetchManifest(url)        → Manifest (JSON)
 *   2. verifyManifest(secret, m) → HMAC-Check (siehe otaManifest.ts)
 *   3. selectRelease(...)        → Release oder null
 *
 * Default-Implementierung nutzt window.fetch — fuer Tests kann ein
 * Custom-Fetcher injected werden.
 */

import {
  Channel, Manifest, Release,
  compareVersions, latestForChannel,
  verifyManifest,
} from "./otaManifest";

export type Fetcher = (url: string) => Promise<string>;

export interface CheckResult {
  available: boolean;
  release: Release | null;
  reason: string;
}

const defaultFetcher: Fetcher = async (url: string) => {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.text();
};

export async function fetchManifest(
  url: string, fetcher: Fetcher = defaultFetcher,
): Promise<Manifest> {
  const raw = await fetcher(url);
  return JSON.parse(raw) as Manifest;
}

export function selectRelease(
  m: Manifest, channel: Channel, currentVersion: string,
): Release | null {
  const candidate = latestForChannel(m, channel);
  if (!candidate) return null;
  if (compareVersions(candidate.version, currentVersion) <= 0) {
    return null;
  }
  return candidate;
}

export interface CheckForUpdateParams {
  manifestUrl: string;
  secret: Uint8Array;
  channel: Channel;
  currentVersion: string;
  fetcher?: Fetcher;
  strict?: boolean;
}

export async function checkForUpdate(p: CheckForUpdateParams): Promise<CheckResult> {
  let m: Manifest;
  try {
    m = await fetchManifest(p.manifestUrl, p.fetcher);
  } catch (e) {
    return {
      available: false, release: null,
      reason: `fetch-failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  const errs = await verifyManifest(p.secret, m, { strict: p.strict ?? true });
  if (errs.length) {
    return {
      available: false, release: null,
      reason: `hmac-invalid: ${errs.join("; ")}`,
    };
  }
  const rel = selectRelease(m, p.channel, p.currentVersion);
  if (!rel) {
    return { available: false, release: null, reason: "no-newer-release" };
  }
  return { available: true, release: rel, reason: "" };
}

/**
 * Convert ein UTF-8 String zu Uint8Array (Secret-Encoding).
 * Wrapper damit der Caller nicht selbst TextEncoder bauen muss.
 */
export function secretFromString(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
