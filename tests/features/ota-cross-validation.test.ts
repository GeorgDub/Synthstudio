// @vitest-environment jsdom
/**
 * ota-cross-validation.test.ts — Sprint-101 Python↔TS Bytecompat.
 *
 * Verifies that a manifest signed by tools/ota/manifest.py (Python) gets
 * accepted by otaManifest.ts (TypeScript). Diese Garantie ist kritisch
 * weil die signing-seite (Build/CI) immer Python ist, die verifying-seite
 * (Browser) immer TS.
 *
 * Fixture: tests/fixtures/ota-python-signed-manifest.json
 *   secret: "cross-validation-secret"
 *   signed via: tools/ota/manifest.py sign <path> --secret cross-validation-secret
 */

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import {
  verifyManifest, type Manifest,
} from "../../client/src/utils/otaManifest";
import { secretFromString } from "../../client/src/utils/otaClient";

const FIXTURE_PATH = path.resolve(
  __dirname, "..", "fixtures", "ota-python-signed-manifest.json",
);
const CROSS_SECRET = secretFromString("cross-validation-secret");


describe("Python → TS Manifest Cross-Validation", () => {
  it("Python-signed manifest verifies in TS with same secret", async () => {
    const raw = fs.readFileSync(FIXTURE_PATH, "utf8");
    const m = JSON.parse(raw) as Manifest;
    const errors = await verifyManifest(CROSS_SECRET, m);
    expect(errors).toEqual([]);
  });

  it("Python-signed manifest rejected with wrong TS secret", async () => {
    const raw = fs.readFileSync(FIXTURE_PATH, "utf8");
    const m = JSON.parse(raw) as Manifest;
    const errors = await verifyManifest(
      secretFromString("wrong-secret"), m,
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it("HMAC hex values match Python-side exactly", async () => {
    const raw = fs.readFileSync(FIXTURE_PATH, "utf8");
    const m = JSON.parse(raw) as Manifest;
    // Diese Werte sind aus dem Python-sign-Output:
    expect(m.releases[0].hmac).toBe(
      "e4f02ef3cae6ee0e524b1eef2bf2ec2fa068666539a72bc3ff8731ba00120601",
    );
    expect(m.manifest_hmac).toBe(
      "b98f8c2e8ead5f1bbde254e0303bba0322017e5dc84285f3deb1d98ec330c7ee",
    );
  });
});
