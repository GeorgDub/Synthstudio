/**
 * Synthstudio – useLicenseStore (TASK-232, v2.97)
 *
 * Tracks the license state for Pro-feature gating. Lives as a singleton like
 * every other Synthstudio store (custom-observer pattern, no Zustand).
 *
 * Persistence:
 *   - In Electron:   IPC channels `license:read` / `license:write` (lazy)
 *   - In Browser:    `localStorage` under STORAGE_KEY
 *
 * Trial:
 *   - Starts on first call to `startTrial()`. Persists `trialStartedAt`.
 *   - Cannot be reset by users (no exported reset method — only test reset
 *     in `__resetLicenseForTests`).
 *
 * Status state-machine:
 *   unknown → trial    (user clicks "Start 30-day trial")
 *   unknown → pro      (user activates a key)
 *   unknown → expired  (loaded persisted trial but trial is over)
 *   trial   → expired  (clock ticked past 30 days)
 *   trial   → pro      (user activates a key mid-trial)
 *   *       → invalid  (deliberately set after a failed validation)
 */
import { useEffect, useReducer } from "react";
import { validateLicenseKey } from "@/utils/licenseValidator";
import {
  LICENSE_PUBLIC_KEY_HEX,
  TRIAL_DURATION_DAYS,
  DAY_MS,
  isMasterLicenseKey,
} from "@/utils/licenseConfig";

export type LicenseStatus = "unknown" | "trial" | "pro" | "expired" | "invalid";

export interface LicenseState {
  status: LicenseStatus;
  /** Unix-ms timestamp of trial start, or null. Once set, never overwritten by user code. */
  trialStartedAt: number | null;
  /** The activated license key string (null when not in pro mode). */
  licenseKey: string | null;
  /** Email returned by the validated payload — purely informational. */
  activatedEmail: string | null;
}

const STORAGE_KEY = "synthstudio:license:v1";

type Listener = () => void;

function defaultState(): LicenseState {
  return {
    status: "unknown",
    trialStartedAt: null,
    licenseKey: null,
    activatedEmail: null,
  };
}

let _state: LicenseState = defaultState();
const _listeners = new Set<Listener>();

function notify(): void { _listeners.forEach((fn) => fn()); }

// ─── Persistence ──────────────────────────────────────────────────────────────

interface ElectronAPILicenseHost {
  electronAPI?: {
    readLicense?: () => Promise<{ success: boolean; data?: unknown; error?: string }>;
    writeLicense?: (state: LicenseState) => Promise<{ success: boolean; error?: string }>;
  };
}

interface ElectronLicenseAPI {
  read: () => Promise<{ success: boolean; data?: unknown; error?: string }>;
  write: (state: LicenseState) => Promise<{ success: boolean; error?: string }>;
}

function getElectronLicenseAPI(): ElectronLicenseAPI | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as Window & ElectronAPILicenseHost;
  const api = w.electronAPI;
  if (!api || typeof api.readLicense !== "function" || typeof api.writeLicense !== "function") return undefined;
  return { read: api.readLicense.bind(api), write: api.writeLicense.bind(api) };
}

function loadFromLocalStorage(): LicenseState | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LicenseState>;
    return sanitizeState(parsed);
  } catch {
    return null;
  }
}

function persistToLocalStorage(state: LicenseState): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota or private-mode — silently ignore */
  }
}

/** Sanitises an arbitrary persisted blob. Defensive — bad data → defaults. */
export function sanitizeState(input: Partial<LicenseState> | null | undefined): LicenseState {
  if (!input || typeof input !== "object") return defaultState();
  const validStatus: LicenseStatus[] = ["unknown", "trial", "pro", "expired", "invalid"];
  const status: LicenseStatus = validStatus.includes(input.status as LicenseStatus)
    ? (input.status as LicenseStatus)
    : "unknown";
  const trialStartedAt =
    typeof input.trialStartedAt === "number" && Number.isFinite(input.trialStartedAt)
      ? input.trialStartedAt
      : null;
  const licenseKey =
    typeof input.licenseKey === "string" && input.licenseKey.length > 0 && input.licenseKey.length < 4096
      ? input.licenseKey
      : null;
  const activatedEmail =
    typeof input.activatedEmail === "string" && input.activatedEmail.length > 0 && input.activatedEmail.length < 254
      ? input.activatedEmail
      : null;
  return { status, trialStartedAt, licenseKey, activatedEmail };
}

async function persist(): Promise<void> {
  const api = getElectronLicenseAPI();
  if (api) {
    try {
      const result = await api.write(_state);
      if (result && result.success) return;
    } catch {
      // fall through to localStorage for resilience
    }
  }
  persistToLocalStorage(_state);
}

let _initialized = false;
let _initPromise: Promise<void> | null = null;

/**
 * Loads persisted state. Idempotent — returns a cached promise on repeat
 * calls. Call early (App-Mount) before reading status.
 */
export function initializeLicenseStore(now: number = Date.now()): Promise<void> {
  if (_initialized) return Promise.resolve();
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    let next: LicenseState | null = null;
    const api = getElectronLicenseAPI();
    if (api) {
      try {
        const result = await api.read();
        if (result && result.success && result.data) {
          next = sanitizeState(result.data as Partial<LicenseState>);
        }
      } catch {
        /* fall through */
      }
    }
    if (!next) next = loadFromLocalStorage();
    if (next) {
      _state = next;
    }
    // Recompute derived status (trial → expired if clock advanced).
    refreshStatusFromClock(now);
    _initialized = true;
    notify();
  })();
  return _initPromise;
}

/** Re-evaluates whether a `trial` should auto-flip to `expired`. */
function refreshStatusFromClock(now: number = Date.now()): void {
  if (_state.status === "trial" && _state.trialStartedAt !== null) {
    const trialEnds = _state.trialStartedAt + TRIAL_DURATION_DAYS * DAY_MS;
    if (now >= trialEnds) {
      _state = { ..._state, status: "expired" };
    }
  } else if (_state.status === "unknown" && _state.trialStartedAt !== null) {
    // Persisted trialStartedAt but somehow status is unknown — re-derive.
    const trialEnds = _state.trialStartedAt + TRIAL_DURATION_DAYS * DAY_MS;
    _state = { ..._state, status: now < trialEnds ? "trial" : "expired" };
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

export function getLicenseState(): LicenseState { return _state; }

/** True iff the user currently has access to Pro-features. */
export function isPro(now: number = Date.now()): boolean {
  if (_state.status === "pro") return true;
  if (_state.status === "trial" && _state.trialStartedAt !== null) {
    return now < _state.trialStartedAt + TRIAL_DURATION_DAYS * DAY_MS;
  }
  return false;
}

/** Days left in the trial (rounded up). Returns 0 if not in trial / expired. */
export function daysRemainingInTrial(now: number = Date.now()): number {
  if (_state.trialStartedAt === null) return 0;
  const ends = _state.trialStartedAt + TRIAL_DURATION_DAYS * DAY_MS;
  const ms = ends - now;
  if (ms <= 0) return 0;
  return Math.ceil(ms / DAY_MS);
}

/**
 * Starts a 30-day trial. No-op if a trial has been started before — users
 * cannot reset their trial through the UI (security).
 */
export function startTrial(now: number = Date.now()): boolean {
  if (_state.trialStartedAt !== null) {
    // Trial already started → ensure status is up-to-date but don't reset clock.
    refreshStatusFromClock(now);
    notify();
    return false;
  }
  _state = {
    ..._state,
    status: "trial",
    trialStartedAt: now,
  };
  void persist();
  notify();
  return true;
}

/**
 * Validates and activates a license key. On success, switches status → 'pro'.
 * On failure, returns false and (if the user is not already in trial) sets
 * status → 'invalid'.
 */
export async function activate(key: string, _email?: string, now: number = Date.now()): Promise<boolean> {
  // ⚠️ TEMPORÄRER DEV-MASTER-KEY (vor Release entfernen, siehe licenseConfig.ts):
  // schaltet Pro direkt frei, ohne Signatur-Validierung.
  if (isMasterLicenseKey(key)) {
    _state = {
      ..._state,
      status: "pro",
      licenseKey: key.trim(),
      activatedEmail: "dev-master@synthstudio.local",
    };
    void persist();
    notify();
    return true;
  }

  const result = await validateLicenseKey(key.trim(), LICENSE_PUBLIC_KEY_HEX, now);
  if (!result.valid) {
    if (_state.status === "unknown") {
      _state = { ..._state, status: "invalid" };
      notify();
    }
    return false;
  }
  _state = {
    ..._state,
    status: "pro",
    licenseKey: key.trim(),
    activatedEmail: result.payload.email,
  };
  void persist();
  notify();
  return true;
}

/** Removes the activated license but **keeps** the trial-start timestamp. */
export function clear(): void {
  _state = {
    status: _state.trialStartedAt !== null ? "trial" : "unknown",
    trialStartedAt: _state.trialStartedAt,
    licenseKey: null,
    activatedEmail: null,
  };
  refreshStatusFromClock();
  void persist();
  notify();
}

/** Used by ActivationModal to remember "user picked free, don't show modal". */
export function markUnknownAsExpired(): void {
  if (_state.status === "unknown") {
    _state = { ..._state, status: "expired" };
    void persist();
    notify();
  }
}

// ─── React Hook ────────────────────────────────────────────────────────────────

export function useLicenseStore(): LicenseState {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    if (!_initialized && !_initPromise) {
      void initializeLicenseStore();
    }
    return () => { _listeners.delete(rerender); };
  }, []);
  return _state;
}

// ─── Test Helpers ──────────────────────────────────────────────────────────────

export function __resetLicenseForTests(): void {
  _state = defaultState();
  _initialized = false;
  _initPromise = null;
  if (typeof window !== "undefined" && window.localStorage) {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* */ }
  }
  notify();
}

/** Force-set state from tests. Bypasses persistence. */
export function __setLicenseStateForTests(next: LicenseState): void {
  _state = sanitizeState(next);
  _initialized = true;
  notify();
}
