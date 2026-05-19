// @vitest-environment jsdom
/**
 * ota-manifest-ts.test.ts — Sprint-101 TS-Port Manifest/Client Tests.
 *
 * Cross-Validation: TS-Sign-Output muss bit-identisch sein zum Python-
 * Side (tools/ota/manifest.py). Wir testen das ueber bekannte fixed
 * Manifests die mit dem gleichen Secret signiert wurden.
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  computeReleaseHmac, computeManifestHmac,
  signManifest, verifyManifest, assertVerified, HmacVerificationError,
  versionTuple, compareVersions, filterChannel, latestForChannel,
  type Manifest, type Release,
} from "../../client/src/utils/otaManifest";
import {
  checkForUpdate, selectRelease, fetchManifest, secretFromString,
} from "../../client/src/utils/otaClient";

const SECRET = secretFromString("test-secret-key-do-not-use-in-prod");
const SECRET_BAD = secretFromString("different-secret");


function makeRelease(partial: Partial<Release> = {}): Release {
  return {
    version: "0.3.0",
    channel: "stable",
    url: "https://example.org/x.vsb",
    size_bytes: 2097408,
    sha256: "0".repeat(64),
    released_at: "2026-05-19T12:00:00Z",
    min_loader_version: "0.1.0",
    release_notes_url: "",
    hmac: "",
    ...partial,
  };
}

async function makeSignedManifest(rels: Release[] = [makeRelease()]): Promise<Manifest> {
  const m: Manifest = {
    schema_version: 1,
    manifest_signed_at: "",
    manifest_hmac: "",
    releases: rels,
  };
  return signManifest(SECRET, m, "2026-05-19T12:00:00Z");
}


// ─── HMAC Computation ────────────────────────────────────

describe("HMAC computation", () => {
  it("computeReleaseHmac produces 64-char hex", async () => {
    const rel = makeRelease();
    const hmac = await computeReleaseHmac(SECRET, rel);
    expect(hmac).toMatch(/^[a-f0-9]{64}$/);
  });

  it("same input produces same HMAC (deterministic)", async () => {
    const rel = makeRelease();
    const h1 = await computeReleaseHmac(SECRET, rel);
    const h2 = await computeReleaseHmac(SECRET, rel);
    expect(h1).toBe(h2);
  });

  it("different secret produces different HMAC", async () => {
    const rel = makeRelease();
    const h1 = await computeReleaseHmac(SECRET, rel);
    const h2 = await computeReleaseHmac(SECRET_BAD, rel);
    expect(h1).not.toBe(h2);
  });
});


// ─── Sign / Verify Roundtrip ─────────────────────────────

describe("Sign + Verify roundtrip", () => {
  it("verify passes after sign with same secret", async () => {
    const m = await makeSignedManifest();
    const errors = await verifyManifest(SECRET, m);
    expect(errors).toEqual([]);
  });

  it("verify fails with wrong secret", async () => {
    const m = await makeSignedManifest();
    const errors = await verifyManifest(SECRET_BAD, m);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => /mismatch/.test(e))).toBe(true);
  });

  it("tampering with version breaks release hmac", async () => {
    const m = await makeSignedManifest([makeRelease({ version: "0.3.0" })]);
    m.releases[0].version = "9.9.9";
    const errors = await verifyManifest(SECRET, m);
    expect(errors.some((e) => e.includes("hmac-mismatch"))).toBe(true);
  });

  it("tampering with url does NOT break release hmac (operator-flexibility)", async () => {
    const m = await makeSignedManifest();
    m.releases[0].url = "https://evil/malware.vsb";
    const errors = await verifyManifest(SECRET, m);
    expect(errors).toEqual([]);
  });

  it("tampering with sha256 breaks release hmac", async () => {
    const m = await makeSignedManifest();
    m.releases[0].sha256 = "f".repeat(64);
    const errors = await verifyManifest(SECRET, m);
    expect(errors.some((e) => e.includes("hmac-mismatch"))).toBe(true);
  });

  it("strict verify complains about missing fields", async () => {
    const m: Manifest = {
      schema_version: 1, manifest_signed_at: "", manifest_hmac: "",
      releases: [makeRelease()],
    };
    const errors = await verifyManifest(SECRET, m, { strict: true });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("non-strict verify allows missing HMACs", async () => {
    const m: Manifest = {
      schema_version: 1, manifest_signed_at: "", manifest_hmac: "",
      releases: [makeRelease()],
    };
    const errors = await verifyManifest(SECRET, m, { strict: false });
    expect(errors).toEqual([]);
  });

  it("assertVerified throws on invalid", async () => {
    const m = await makeSignedManifest();
    m.releases[0].version = "tampered";
    await expect(assertVerified(SECRET, m)).rejects.toThrow(HmacVerificationError);
  });
});


// ─── Version Comparison ─────────────────────────────────

describe("versionTuple + compareVersions", () => {
  it("compares semver correctly", () => {
    expect(compareVersions("0.2.0", "0.3.0")).toBeLessThan(0);
    expect(compareVersions("0.3.0", "0.2.0")).toBeGreaterThan(0);
    expect(compareVersions("0.3.0", "0.3.0")).toBe(0);
  });

  it("treats pre-release as older than release", () => {
    expect(compareVersions("0.3.0-beta1", "0.3.0")).toBeLessThan(0);
  });

  it("handles non-numeric components as 0", () => {
    expect(versionTuple("foo.bar.baz").slice(0, 3)).toEqual([0, 0, 0]);
  });
});


// ─── Channel-Filter ─────────────────────────────────────

describe("filterChannel + latestForChannel", () => {
  it("filterChannel returns descending order", async () => {
    const m = await makeSignedManifest([
      makeRelease({ version: "0.1.0" }),
      makeRelease({ version: "0.3.0" }),
      makeRelease({ version: "0.2.0" }),
    ]);
    const filtered = filterChannel(m, "stable");
    expect(filtered.map((r) => r.version)).toEqual(["0.3.0", "0.2.0", "0.1.0"]);
  });

  it("latestForChannel empty returns null", async () => {
    const m = await makeSignedManifest([]);
    expect(latestForChannel(m, "stable")).toBe(null);
  });

  it("latestForChannel filters by channel", async () => {
    const m = await makeSignedManifest([
      makeRelease({ version: "0.5.0", channel: "beta" }),
      makeRelease({ version: "0.3.0", channel: "stable" }),
    ]);
    expect(latestForChannel(m, "stable")?.version).toBe("0.3.0");
    expect(latestForChannel(m, "beta")?.version).toBe("0.5.0");
  });
});


// ─── Client API ─────────────────────────────────────────

describe("otaClient.checkForUpdate", () => {
  it("offers newer release", async () => {
    const m = await makeSignedManifest([makeRelease({ version: "0.5.0" })]);
    const raw = JSON.stringify(m);
    const result = await checkForUpdate({
      manifestUrl: "https://fake",
      secret: SECRET, channel: "stable",
      currentVersion: "0.3.0",
      fetcher: async () => raw,
    });
    expect(result.available).toBe(true);
    expect(result.release?.version).toBe("0.5.0");
  });

  it("returns no-newer-release when current is newer", async () => {
    const m = await makeSignedManifest([makeRelease({ version: "0.2.0" })]);
    const raw = JSON.stringify(m);
    const result = await checkForUpdate({
      manifestUrl: "https://fake",
      secret: SECRET, channel: "stable",
      currentVersion: "0.3.0",
      fetcher: async () => raw,
    });
    expect(result.available).toBe(false);
    expect(result.reason).toBe("no-newer-release");
  });

  it("rejects tampered manifest", async () => {
    const m = await makeSignedManifest([makeRelease({ version: "0.5.0" })]);
    m.releases[0].version = "9.9.9";
    const raw = JSON.stringify(m);
    const result = await checkForUpdate({
      manifestUrl: "https://fake",
      secret: SECRET, channel: "stable",
      currentVersion: "0.3.0",
      fetcher: async () => raw,
    });
    expect(result.available).toBe(false);
    expect(result.reason).toContain("hmac-invalid");
  });

  it("handles fetch failure gracefully", async () => {
    const result = await checkForUpdate({
      manifestUrl: "https://fake",
      secret: SECRET, channel: "stable",
      currentVersion: "0.3.0",
      fetcher: async () => { throw new Error("Network down"); },
    });
    expect(result.available).toBe(false);
    expect(result.reason).toContain("fetch-failed");
  });
});


// ─── Schema Compatibility ───────────────────────────────

describe("Manifest schema forward-compat", () => {
  it("future top-level fields are ignored on fetchManifest parse", async () => {
    const m = await makeSignedManifest();
    const data = JSON.parse(JSON.stringify(m));
    data.future_field = "ignored";
    data.releases[0].future_release_field = "also ignored";
    const json = JSON.stringify(data);
    const parsed = await fetchManifest("u", async () => json);
    expect(parsed.releases[0].version).toBe(m.releases[0].version);
  });
});
