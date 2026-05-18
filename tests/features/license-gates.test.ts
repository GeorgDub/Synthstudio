/**
 * tests/features/license-gates.test.ts (TASK-232-FOLLOWUP / v2.98)
 *
 * Coverage für die NEUEN Pro-Feature-Gates aus v2.98 (Live-Looping +
 * MIDI-Note-Out). Die existierende license.test.ts deckt Trial-Lifecycle und
 * Signatur-Validation ab — hier fokussieren wir auf die "Aktion wird beim
 * locked-State zum no-op + Toast"-Verträge.
 *
 * Strategie: wir testen NICHT die React-Komponenten (DOM-Layer ist
 * Playwright-Sache, siehe license-polish.spec.ts) sondern die Pure-Logik
 * unter `proFeatures.requireProFeature` für die beiden neuen Constants und
 * stellen sicher dass `isFeatureUnlocked` über alle 5 PRO_FEATURES sauber
 * je nach State antwortet.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── In-memory localStorage shim (identisch zu license.test.ts) ──────────────
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
const w = (globalThis as unknown as { window: { localStorage: MemoryStorage; open?: (url: string) => void } }).window;
if (!w.localStorage || typeof w.localStorage.getItem !== "function") {
  (w as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
}
// Stub window.open damit die Toast-Action keine Errors wirft.
w.open = vi.fn(() => undefined);

// ─── Imports (nach dem window-Shim, damit der License-Store ihn benutzt) ─────
import {
  __resetLicenseForTests,
  __setLicenseStateForTests,
  startTrial,
  isPro,
} from "../../client/src/store/useLicenseStore";
import {
  isFeatureUnlocked,
  requireProFeature,
  PRO_FEATURE_LIVE_LOOPING,
  PRO_FEATURE_MIDI_NOTE_OUT,
  PRO_FEATURE_STEM_BOUNCE,
  PRO_FEATURE_USB_AUDIO_IN,
  PRO_FEATURE_ELECTRIBE_IMPORT,
  PRO_FEATURE_KORG_BANK_IMPORT,
  PRO_FEATURE_KORG_BANK_WRITE,
  PRO_FEATURES,
} from "../../client/src/utils/proFeatures";

// Mock des Toast-Stores: wir zählen Calls statt echte DOM-Toasts zu rendern.
vi.mock("../../client/src/store/useToastStore", () => ({
  toast: vi.fn(),
}));
import { toast as toastMock } from "../../client/src/store/useToastStore";

beforeEach(() => {
  __resetLicenseForTests();
  w.localStorage.clear();
  (toastMock as unknown as { mockClear: () => void }).mockClear();
});

// ─── PRO_FEATURES Registry ───────────────────────────────────────────────────

describe("PRO_FEATURES registry (v2.98 / v3.3 / v3.4)", () => {
  it("enthält alle 7 erwarteten Features (v3.4.0: +korg-bank-write)", () => {
    expect(PRO_FEATURES).toContain(PRO_FEATURE_LIVE_LOOPING);
    expect(PRO_FEATURES).toContain(PRO_FEATURE_MIDI_NOTE_OUT);
    expect(PRO_FEATURES).toContain(PRO_FEATURE_STEM_BOUNCE);
    expect(PRO_FEATURES).toContain(PRO_FEATURE_USB_AUDIO_IN);
    expect(PRO_FEATURES).toContain(PRO_FEATURE_ELECTRIBE_IMPORT);
    expect(PRO_FEATURES).toContain(PRO_FEATURE_KORG_BANK_IMPORT);
    expect(PRO_FEATURES).toContain(PRO_FEATURE_KORG_BANK_WRITE);
    expect(PRO_FEATURES).toHaveLength(7);
  });
});

// ─── Live-Looping Gate ───────────────────────────────────────────────────────

describe("Live-Looping Pro-Gate (v2.98)", () => {
  it("ohne Pro / nach Trial-Expire → isFeatureUnlocked=false", () => {
    __setLicenseStateForTests({
      status: "expired",
      trialStartedAt: 1_700_000_000_000,
      licenseKey: null,
      activatedEmail: null,
    });
    expect(isFeatureUnlocked(PRO_FEATURE_LIVE_LOOPING)).toBe(false);
  });

  it("requireProFeature feuert Toast wenn locked und gibt false zurück", () => {
    __setLicenseStateForTests({
      status: "expired",
      trialStartedAt: 1_700_000_000_000,
      licenseKey: null,
      activatedEmail: null,
    });
    const allowed = requireProFeature(PRO_FEATURE_LIVE_LOOPING);
    expect(allowed).toBe(false);
    expect(toastMock).toHaveBeenCalledTimes(1);
    const [msg, opts] = (toastMock as unknown as { mock: { calls: [string, { kind: string; action?: { label: string } }][] } }).mock.calls[0];
    expect(msg).toMatch(/Pro-Feature/);
    expect(opts.kind).toBe("warning");
    expect(opts.action?.label).toBe("Lizenz kaufen");
  });

  it("im Trial-Mode → unlocked, kein Toast", () => {
    startTrial(Date.now());
    expect(isPro()).toBe(true);
    const allowed = requireProFeature(PRO_FEATURE_LIVE_LOOPING);
    expect(allowed).toBe(true);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("expired-Status liefert speziellen Toast-Text (Trial-Hinweis)", () => {
    __setLicenseStateForTests({
      status: "expired",
      trialStartedAt: 1_700_000_000_000,
      licenseKey: null,
      activatedEmail: null,
    });
    requireProFeature(PRO_FEATURE_LIVE_LOOPING);
    const [msg] = (toastMock as unknown as { mock: { calls: [string][] } }).mock.calls[0];
    expect(msg).toMatch(/30-Tage-Trial ist abgelaufen/);
  });
});

// ─── MIDI-Note-Out Gate ──────────────────────────────────────────────────────

describe("MIDI-Note-Out Pro-Gate (v2.98)", () => {
  it("locked → no-Pro, requireProFeature=false + Toast", () => {
    __setLicenseStateForTests({
      status: "expired",
      trialStartedAt: 1_700_000_000_000,
      licenseKey: null,
      activatedEmail: null,
    });
    const allowed = requireProFeature(PRO_FEATURE_MIDI_NOTE_OUT);
    expect(allowed).toBe(false);
    expect(toastMock).toHaveBeenCalledTimes(1);
    const [msg] = (toastMock as unknown as { mock: { calls: [string][] } }).mock.calls[0];
    expect(msg).toMatch(/MIDI-Note-Out/);
  });

  it("im Trial → freigeschaltet", () => {
    startTrial(Date.now());
    expect(isFeatureUnlocked(PRO_FEATURE_MIDI_NOTE_OUT)).toBe(true);
  });

  it("status=pro → freigeschaltet", () => {
    __setLicenseStateForTests({
      status: "pro",
      trialStartedAt: null,
      licenseKey: "fake-pro-key",
      activatedEmail: "pro@example.com",
    });
    expect(isFeatureUnlocked(PRO_FEATURE_MIDI_NOTE_OUT)).toBe(true);
  });
});

// ─── ProLockBadge-Semantik (pure Sichtbarkeit, ohne DOM-Render) ─────────────

describe("ProLockBadge-Sichtbarkeit (v2.98) — Sichtbarkeits-Regel", () => {
  it("im Trial → Badge unsichtbar (isFeatureUnlocked=true)", () => {
    startTrial(Date.now());
    for (const f of PRO_FEATURES) {
      expect(isFeatureUnlocked(f)).toBe(true);
    }
  });

  it("expired → Badge sichtbar für alle 5 Pro-Features", () => {
    __setLicenseStateForTests({
      status: "expired",
      trialStartedAt: 1_700_000_000_000,
      licenseKey: null,
      activatedEmail: null,
    });
    for (const f of PRO_FEATURES) {
      expect(isFeatureUnlocked(f)).toBe(false);
    }
  });

  it("status=unknown (vor Trial-Start) → Badge sichtbar", () => {
    // Default ohne Init → status='unknown', kein trialStartedAt.
    expect(isPro()).toBe(false);
    for (const f of PRO_FEATURES) {
      expect(isFeatureUnlocked(f)).toBe(false);
    }
  });
});
