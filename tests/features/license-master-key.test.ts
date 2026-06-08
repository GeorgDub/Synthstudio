/**
 * tests/features/license-master-key.test.ts
 *
 * Coverage für das Build-abhängige Gating des Demo-/Master-Keys
 * (isMasterLicenseKey). Synth.md-Bug: "Der Demo Lizenz Key geht nicht" —
 * Ursache war das harte `import.meta.env.PROD`-Gate, das den Key in der
 * gepackten Desktop-App (Electron-Prod-Build) deaktivierte.
 *
 * Neue Regel:
 *   - Dev/Test  (!isProd)            → Key akzeptiert
 *   - Electron  (isProd & isElectron)→ Key akzeptiert (ausgeliefertes Produkt)
 *   - Web-Prod  (isProd & !isElectron)→ Key blockiert (public Bundle)
 */
import { describe, it, expect } from "vitest";
import {
  isMasterLicenseKey,
  MASTER_LICENSE_KEY,
  type MasterKeyEnv,
} from "../../client/src/utils/licenseConfig";

const DEV: MasterKeyEnv = { isProd: false, isElectron: false };
const ELECTRON_PROD: MasterKeyEnv = { isProd: true, isElectron: true };
const ELECTRON_DEV: MasterKeyEnv = { isProd: false, isElectron: true };
const WEB_PROD: MasterKeyEnv = { isProd: true, isElectron: false };

describe("isMasterLicenseKey — Build-Gating", () => {
  it("Dev-Build (Happy Path): Master-Key akzeptiert", () => {
    expect(isMasterLicenseKey(MASTER_LICENSE_KEY, DEV)).toBe(true);
  });

  it("gepackte Electron-Desktop-App (Prod): Master-Key akzeptiert", () => {
    expect(isMasterLicenseKey(MASTER_LICENSE_KEY, ELECTRON_PROD)).toBe(true);
  });

  it("Electron im Dev-Mode: Master-Key akzeptiert", () => {
    expect(isMasterLicenseKey(MASTER_LICENSE_KEY, ELECTRON_DEV)).toBe(true);
  });

  it("öffentlicher Web-Prod-Build (Edge Case): Master-Key BLOCKIERT", () => {
    expect(isMasterLicenseKey(MASTER_LICENSE_KEY, WEB_PROD)).toBe(false);
  });

  it("trimmt umgebende Leerzeichen", () => {
    expect(isMasterLicenseKey(`  ${MASTER_LICENSE_KEY}  `, ELECTRON_PROD)).toBe(true);
  });

  it("falscher Key wird auch in erlaubter Umgebung abgelehnt", () => {
    expect(isMasterLicenseKey("137924569", DEV)).toBe(false);
    expect(isMasterLicenseKey("", ELECTRON_PROD)).toBe(false);
  });

  it("falscher Key bleibt im Web-Prod abgelehnt", () => {
    expect(isMasterLicenseKey("137924569", WEB_PROD)).toBe(false);
  });
});
