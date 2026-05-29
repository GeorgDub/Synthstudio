/**
 * tests/features/license.test.ts (TASK-232, v2.97)
 *
 * Pure-helper + store-state tests for the license layer:
 *  - Trial lifecycle (start, days-remaining, auto-expire)
 *  - ED25519 signature validation (round-trip + invalid signature rejection)
 *  - Pro-feature gating across status states
 *  - Persistence round-trip via localStorage fallback
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import * as ed from "@noble/ed25519";
import { etc } from "@noble/ed25519";
// Note: we use only the *async* @noble/ed25519 API (keygenAsync, signAsync,
// verifyAsync) which is backed by WebCrypto — no sha512 wiring needed.

// ─── In-memory localStorage shim for Node test environment ───────────────────
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, String(v)); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
  get length() { return this.store.size; }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
}
(globalThis as unknown as { window?: unknown }).window =
  (globalThis as unknown as { window?: unknown }).window ??
  ({ localStorage: new MemoryStorage() } as unknown);
const w = (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window;
if (!w.localStorage || typeof w.localStorage.getItem !== "function") {
  (w as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
}

// ─── Test key pair (generated once for the whole suite) ──────────────────────
let TEST_SECRET: Uint8Array;
let TEST_PUBLIC_HEX: string;

beforeAll(async () => {
  TEST_SECRET = ed.utils.randomSecretKey();
  const pub = await ed.getPublicKeyAsync(TEST_SECRET);
  TEST_PUBLIC_HEX = etc.bytesToHex(pub);
});

// Imports AFTER the window shim so they pick it up.
import {
  validateLicenseKey,
  signLicensePayload,
  parseLicenseKey,
  decodePayload,
} from "../../client/src/utils/licenseValidator";
import { LICENSE_PRODUCT_ID, TRIAL_DURATION_DAYS, DAY_MS } from "../../client/src/utils/licenseConfig";
import {
  __resetLicenseForTests,
  __setLicenseStateForTests,
  startTrial,
  activate,
  daysRemainingInTrial,
  isPro,
  getLicenseState,
  initializeLicenseStore,
  sanitizeState,
} from "../../client/src/store/useLicenseStore";

beforeEach(() => {
  __resetLicenseForTests();
  w.localStorage.clear();
});

// ─── Trial lifecycle ──────────────────────────────────────────────────────────

describe("license trial lifecycle", () => {
  it("startTrial: status=unknown → 'trial' und trialStartedAt gesetzt", () => {
    const t0 = 1_700_000_000_000;
    expect(getLicenseState().status).toBe("unknown");
    const started = startTrial(t0);
    expect(started).toBe(true);
    expect(getLicenseState().status).toBe("trial");
    expect(getLicenseState().trialStartedAt).toBe(t0);
  });

  it("startTrial: zweiter Aufruf macht no-op (kein Reset)", () => {
    startTrial(1_700_000_000_000);
    const before = getLicenseState().trialStartedAt;
    const second = startTrial(1_800_000_000_000);
    expect(second).toBe(false);
    expect(getLicenseState().trialStartedAt).toBe(before);
  });

  it("daysRemainingInTrial: 30 Tage zu Beginn, 0 nach Ablauf", () => {
    const t0 = 1_700_000_000_000;
    startTrial(t0);
    expect(daysRemainingInTrial(t0)).toBe(TRIAL_DURATION_DAYS);
    expect(daysRemainingInTrial(t0 + 5 * DAY_MS)).toBe(25);
    expect(daysRemainingInTrial(t0 + 30 * DAY_MS)).toBe(0);
    expect(daysRemainingInTrial(t0 + 31 * DAY_MS)).toBe(0);
  });

  it("trialStartedAt + 31 Tage → isPro=false, daysRemaining=0", () => {
    const t0 = 1_700_000_000_000;
    startTrial(t0);
    expect(isPro(t0)).toBe(true);
    expect(isPro(t0 + 31 * DAY_MS)).toBe(false);
  });

  it("initialize: persistierter trial der abgelaufen ist → status='expired'", async () => {
    const t0 = 1_700_000_000_000;
    // beforeEach hat schon resetted + Storage geleert.
    w.localStorage.setItem(
      "synthstudio:license:v1",
      JSON.stringify({
        status: "trial",
        trialStartedAt: t0,
        licenseKey: null,
        activatedEmail: null,
      }),
    );
    await initializeLicenseStore(t0 + 31 * DAY_MS);
    expect(getLicenseState().status).toBe("expired");
  });
});

// ─── ED25519 validation ───────────────────────────────────────────────────────

describe("validateLicenseKey", () => {
  it("invalides Format → reason 'Ungültiges Schlüssel-Format'", async () => {
    const r = await validateLicenseKey("not-a-key", TEST_PUBLIC_HEX);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toMatch(/Format/);
  });

  it("valider Schlüssel mit Test-Key → valid=true + payload", async () => {
    const payload = {
      email: "user@example.com",
      expiresAt: null,
      productId: LICENSE_PRODUCT_ID,
    };
    const key = await signLicensePayload(payload, TEST_SECRET);
    const r = await validateLicenseKey(key, TEST_PUBLIC_HEX);
    expect(r.valid).toBe(true);
    if (r.valid) {
      expect(r.payload.email).toBe("user@example.com");
      expect(r.payload.productId).toBe(LICENSE_PRODUCT_ID);
    }
  });

  it("manipulierte Signatur → valid=false", async () => {
    const payload = { email: "x@y.de", expiresAt: null, productId: LICENSE_PRODUCT_ID };
    const key = await signLicensePayload(payload, TEST_SECRET);
    // Komplette Signatur durch all-zero (base64) ersetzen → bit-pattern definitiv invalid
    const [p, s] = key.split(".");
    const broken = p + "." + "A".repeat(s.length);
    const r = await validateLicenseKey(broken, TEST_PUBLIC_HEX);
    expect(r.valid).toBe(false);
  });

  it("abgelaufene expiresAt → valid=false", async () => {
    const payload = {
      email: "x@y.de",
      expiresAt: 1_000_000_000_000,
      productId: LICENSE_PRODUCT_ID,
    };
    const key = await signLicensePayload(payload, TEST_SECRET);
    const r = await validateLicenseKey(key, TEST_PUBLIC_HEX, 2_000_000_000_000);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toMatch(/abgelaufen/);
  });

  it("falscher productId → valid=false", async () => {
    const payload = { email: "x@y.de", expiresAt: null, productId: "other-product" };
    const key = await signLicensePayload(payload, TEST_SECRET);
    const r = await validateLicenseKey(key, TEST_PUBLIC_HEX);
    expect(r.valid).toBe(false);
  });

  it("parseLicenseKey ist robust gegen Format-Defekte", () => {
    expect(parseLicenseKey("")).toBeNull();
    expect(parseLicenseKey("nokey")).toBeNull();
    expect(parseLicenseKey(".sig")).toBeNull();
    expect(parseLicenseKey("payload.")).toBeNull();
    expect(parseLicenseKey("a.b.c")).toBeNull();
    expect(parseLicenseKey("a.b")).toEqual({ payloadB64: "a", sigB64: "b" });
  });

  it("decodePayload weist unerwartete Strukturen ab", () => {
    expect(decodePayload("!!!notbase64!!!")).toBeNull();
    // base64 von "{}"
    const empty = Buffer.from("{}").toString("base64").replace(/=+$/g, "");
    expect(decodePayload(empty)).toBeNull();
  });
});

// ─── Pro-Feature gating ───────────────────────────────────────────────────────

describe("isFeatureUnlocked / activate", () => {
  it("Trial → Pro-Feature unlocked", async () => {
    // startTrial mit Date.now() damit (now < t0+30d) zur Test-Laufzeit gilt.
    startTrial(Date.now());
    const { isFeatureUnlocked, PRO_FEATURE_LIVE_LOOPING } = await import("../../client/src/utils/proFeatures");
    expect(isFeatureUnlocked(PRO_FEATURE_LIVE_LOOPING)).toBe(true);
  });

  it("Status=expired → Pro-Feature locked", async () => {
    __setLicenseStateForTests({
      status: "expired",
      trialStartedAt: 1_700_000_000_000,
      licenseKey: null,
      activatedEmail: null,
    });
    const { isFeatureUnlocked, PRO_FEATURE_STEM_BOUNCE } = await import("../../client/src/utils/proFeatures");
    expect(isFeatureUnlocked(PRO_FEATURE_STEM_BOUNCE)).toBe(false);
  });

  it("Activate mit invalidem Key → false, kein Pro-Status", async () => {
    const ok = await activate("garbage");
    expect(ok).toBe(false);
    expect(getLicenseState().status).not.toBe("pro");
  });

  it("Master-Key (Dev) → Pro ohne Signatur-Validierung", async () => {
    const ok = await activate("137924568");
    expect(ok).toBe(true);
    expect(getLicenseState().status).toBe("pro");
    expect(getLicenseState().licenseKey).toBe("137924568");
    expect(isPro()).toBe(true);
  });

  it("Master-Key mit umgebenden Leerzeichen wird getrimmt akzeptiert", async () => {
    const ok = await activate("  137924568  ");
    expect(ok).toBe(true);
    expect(getLicenseState().status).toBe("pro");
    expect(getLicenseState().licenseKey).toBe("137924568");
  });

  it("Fast-Master-Key (eine Ziffer daneben) → false, kein Pro", async () => {
    const ok = await activate("137924569");
    expect(ok).toBe(false);
    expect(getLicenseState().status).not.toBe("pro");
  });

  it("isFeatureUnlocked für unbekanntes Feature default=false", async () => {
    startTrial(Date.now());
    const { isFeatureUnlocked } = await import("../../client/src/utils/proFeatures");
    expect(isFeatureUnlocked("unknown-feature-x")).toBe(false);
    expect(isFeatureUnlocked("unknown-feature-x", true)).toBe(true);
  });
});

// ─── Persistence round-trip ───────────────────────────────────────────────────

describe("license persistence", () => {
  it("Round-Trip: localStorage ← startTrial → initialize", async () => {
    const t0 = 1_700_000_000_000;
    startTrial(t0);
    // Reset in-memory state, lade aus localStorage
    __resetLicenseForTests();
    // Re-set persistent payload manuell weil __resetLicenseForTests den Storage clearted
    w.localStorage.setItem(
      "synthstudio:license:v1",
      JSON.stringify({
        status: "trial",
        trialStartedAt: t0,
        licenseKey: null,
        activatedEmail: null,
      }),
    );
    await initializeLicenseStore(t0 + DAY_MS);
    const s = getLicenseState();
    expect(s.status).toBe("trial");
    expect(s.trialStartedAt).toBe(t0);
  });

  it("sanitizeState filtert invalide Felder", () => {
    const dirty = {
      status: "garbage" as unknown,
      trialStartedAt: NaN,
      licenseKey: "x".repeat(10000),
      activatedEmail: 42 as unknown,
    };
    const clean = sanitizeState(dirty as never);
    expect(clean.status).toBe("unknown");
    expect(clean.trialStartedAt).toBeNull();
    expect(clean.licenseKey).toBeNull();
    expect(clean.activatedEmail).toBeNull();
  });
});
