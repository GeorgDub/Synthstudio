// @vitest-environment jsdom
/**
 * tests/features/use-updater-hook.test.ts (TASK-CVG-USE-UPDATER / v2.70)
 *
 * Hook-Coverage für useUpdater — verwaltet einen kompakten Phase-State
 * für den electron-updater. Test-Strategie: vi.mock auf den
 * electron/useElectron-Pfad (relativ vom Hook aus). Listener werden in
 * ref-Variablen "captured", so dass Tests die Updater-Events synthetisch
 * triggern können.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

// ─── Mock-Setup (vi.hoisted für sauberes Hoisting der Refs) ──────────────────

const mocks = vi.hoisted(() => {
  const listeners = {
    checking:        null as (() => void) | null,
    available:       null as ((info: { version: string }) => void) | null,
    upToDate:        null as (() => void) | null,
    downloadProgress: null as ((p: { percent: number }) => void) | null,
    downloaded:      null as ((info: { version: string }) => void) | null,
    error:           null as ((err: { message: string }) => void) | null,
  };
  const unsubs = {
    checking:        vi.fn(),
    available:       vi.fn(),
    upToDate:        vi.fn(),
    downloadProgress: vi.fn(),
    downloaded:      vi.fn(),
    error:           vi.fn(),
  };
  return {
    listeners,
    unsubs,
    checkForUpdatesSpy: vi.fn(),
    isElectronRef: { current: true },
  };
});
const { listeners, unsubs, checkForUpdatesSpy, isElectronRef } = mocks;

// Pfad-Hinweis: der Hook (client/src/hooks/useUpdater.ts) importiert
// "../../../electron/useElectron". Aus Test-Sicht (tests/features/) sind
// es 2 Levels nach oben statt 3. Vitest matched die mock auf die resolved
// Module-ID, daher muss die Pfad-Auflösung übereinstimmen.
vi.mock("../../electron/useElectron", () => ({
  useElectron: () => ({
    isElectron: mocks.isElectronRef.current,
    checkForUpdates: mocks.checkForUpdatesSpy,
    onUpdaterChecking: (cb: () => void) => {
      mocks.listeners.checking = cb;
      return mocks.unsubs.checking;
    },
    onUpdaterUpdateAvailable: (cb: (info: { version: string }) => void) => {
      mocks.listeners.available = cb;
      return mocks.unsubs.available;
    },
    onUpdaterUpToDate: (cb: () => void) => {
      mocks.listeners.upToDate = cb;
      return mocks.unsubs.upToDate;
    },
    onUpdaterDownloadProgress: (cb: (p: { percent: number }) => void) => {
      mocks.listeners.downloadProgress = cb;
      return mocks.unsubs.downloadProgress;
    },
    onUpdaterUpdateDownloaded: (cb: (info: { version: string }) => void) => {
      mocks.listeners.downloaded = cb;
      return mocks.unsubs.downloaded;
    },
    onUpdaterError: (cb: (err: { message: string }) => void) => {
      mocks.listeners.error = cb;
      return mocks.unsubs.error;
    },
  }),
}));

import { useUpdater } from "@/hooks/useUpdater";

// ─── Test-Setup ──────────────────────────────────────────────────────────────

beforeEach(() => {
  isElectronRef.current = true;
  Object.keys(listeners).forEach((k) => {
    listeners[k as keyof typeof listeners] = null;
  });
  Object.values(unsubs).forEach((fn) => fn.mockClear());
  checkForUpdatesSpy.mockClear();
});

afterEach(() => {
  cleanup();
});

// ─── Browser-Fallback (isElectron=false) ─────────────────────────────────────

describe("useUpdater – Browser-Fallback (isElectron=false)", () => {
  beforeEach(() => {
    isElectronRef.current = false;
  });

  it("Initial-State ist {phase:'idle'}", () => {
    const { result } = renderHook(() => useUpdater());
    expect(result.current.state).toEqual({ phase: "idle" });
  });

  it("Keine Listener werden registriert (Effect early-returnt)", () => {
    renderHook(() => useUpdater());
    expect(listeners.checking).toBeNull();
    expect(listeners.available).toBeNull();
    expect(listeners.upToDate).toBeNull();
  });

  it("checkForUpdates() ist no-op (electron.checkForUpdates wird NICHT aufgerufen)", () => {
    const { result } = renderHook(() => useUpdater());
    act(() => result.current.checkForUpdates());
    expect(checkForUpdatesSpy).not.toHaveBeenCalled();
  });
});

// ─── Electron-Mode: Listener-Registrierung ───────────────────────────────────

describe("useUpdater – Electron-Mode: Listener-Setup", () => {
  it("Mount registriert alle 6 Updater-Listener", () => {
    renderHook(() => useUpdater());
    expect(listeners.checking).not.toBeNull();
    expect(listeners.available).not.toBeNull();
    expect(listeners.upToDate).not.toBeNull();
    expect(listeners.downloadProgress).not.toBeNull();
    expect(listeners.downloaded).not.toBeNull();
    expect(listeners.error).not.toBeNull();
  });

  it("Initial-State ist {phase:'idle'}", () => {
    const { result } = renderHook(() => useUpdater());
    expect(result.current.state).toEqual({ phase: "idle" });
  });

  it("Unmount ruft alle 6 unsubscribe-Funktionen", () => {
    const { unmount } = renderHook(() => useUpdater());
    unmount();
    expect(unsubs.checking).toHaveBeenCalledTimes(1);
    expect(unsubs.available).toHaveBeenCalledTimes(1);
    expect(unsubs.upToDate).toHaveBeenCalledTimes(1);
    expect(unsubs.downloadProgress).toHaveBeenCalledTimes(1);
    expect(unsubs.downloaded).toHaveBeenCalledTimes(1);
    expect(unsubs.error).toHaveBeenCalledTimes(1);
  });
});

// ─── State-Transitions pro Event ─────────────────────────────────────────────

describe("useUpdater – State-Transitions", () => {
  it("checking-Event → phase='checking'", () => {
    const { result } = renderHook(() => useUpdater());
    act(() => listeners.checking!());
    expect(result.current.state).toEqual({ phase: "checking" });
  });

  it("update-available-Event → phase='available' + version", () => {
    const { result } = renderHook(() => useUpdater());
    act(() => listeners.available!({ version: "2.99.0" }));
    expect(result.current.state).toEqual({ phase: "available", version: "2.99.0" });
  });

  it("up-to-date-Event → phase='up-to-date'", () => {
    const { result } = renderHook(() => useUpdater());
    act(() => listeners.upToDate!());
    expect(result.current.state).toEqual({ phase: "up-to-date" });
  });

  it("download-progress-Event → phase='downloading' + percent", () => {
    const { result } = renderHook(() => useUpdater());
    act(() => listeners.downloadProgress!({ percent: 42.5 }));
    expect(result.current.state.phase).toBe("downloading");
    expect(result.current.state.percent).toBe(42.5);
  });

  it("downloaded-Event → phase='ready' + version", () => {
    const { result } = renderHook(() => useUpdater());
    act(() => listeners.downloaded!({ version: "3.0.0" }));
    expect(result.current.state).toEqual({ phase: "ready", version: "3.0.0" });
  });

  it("error-Event → phase='error' + errorMessage", () => {
    const { result } = renderHook(() => useUpdater());
    act(() => listeners.error!({ message: "Connection refused" }));
    expect(result.current.state).toEqual({ phase: "error", errorMessage: "Connection refused" });
  });
});

// ─── Progress-State preserviert vorherige Felder via prev-Spread ─────────────

describe("useUpdater – Progress-Spread", () => {
  it("Progress nach available behält version (state-Spread via prev)", () => {
    const { result } = renderHook(() => useUpdater());
    act(() => listeners.available!({ version: "2.99.0" }));
    act(() => listeners.downloadProgress!({ percent: 30 }));
    // setState((prev) => ({ ...prev, phase: "downloading", percent }))
    expect(result.current.state.phase).toBe("downloading");
    expect(result.current.state.percent).toBe(30);
    expect(result.current.state.version).toBe("2.99.0");
  });

  it("Mehrere Progress-Updates aktualisieren percent ohne Reset anderer Felder", () => {
    const { result } = renderHook(() => useUpdater());
    act(() => listeners.available!({ version: "2.99.0" }));
    act(() => listeners.downloadProgress!({ percent: 10 }));
    act(() => listeners.downloadProgress!({ percent: 60 }));
    act(() => listeners.downloadProgress!({ percent: 99 }));
    expect(result.current.state.percent).toBe(99);
    expect(result.current.state.version).toBe("2.99.0");
  });
});

// ─── State-Reset bei terminal events ─────────────────────────────────────────

describe("useUpdater – State-Reset (terminal events)", () => {
  it("Downloaded ersetzt komplett (kein prev-Spread): percent wird ge-undefined", () => {
    const { result } = renderHook(() => useUpdater());
    act(() => listeners.downloadProgress!({ percent: 80 }));
    act(() => listeners.downloaded!({ version: "3.0.0" }));
    expect(result.current.state).toEqual({ phase: "ready", version: "3.0.0" });
    expect(result.current.state.percent).toBeUndefined();
  });

  it("Error nach availability ersetzt komplett (version weg)", () => {
    const { result } = renderHook(() => useUpdater());
    act(() => listeners.available!({ version: "3.0.0" }));
    act(() => listeners.error!({ message: "Network error" }));
    expect(result.current.state.phase).toBe("error");
    expect(result.current.state.version).toBeUndefined();
    expect(result.current.state.errorMessage).toBe("Network error");
  });
});

// ─── checkForUpdates Trigger ─────────────────────────────────────────────────

describe("useUpdater – checkForUpdates()", () => {
  it("ruft electron.checkForUpdates() in Electron-Mode", () => {
    const { result } = renderHook(() => useUpdater());
    act(() => result.current.checkForUpdates());
    expect(checkForUpdatesSpy).toHaveBeenCalledTimes(1);
  });

  it("Mehrere Aufrufe forwarden mehrfach", () => {
    const { result } = renderHook(() => useUpdater());
    act(() => result.current.checkForUpdates());
    act(() => result.current.checkForUpdates());
    act(() => result.current.checkForUpdates());
    expect(checkForUpdatesSpy).toHaveBeenCalledTimes(3);
  });
});
