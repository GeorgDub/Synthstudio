/**
 * Synthstudio – usePopupCloseBridges (v2.49)
 *
 * Bündelt das wiederkehrende Pattern aus App.tsx (BUG-023-Diagnose-Welle):
 *
 *   useEffect(() => {
 *     if (!electron.isElectron) return;
 *     const cleanup = electron.onXxxPopupClosed?.(() => {
 *       electron.logRendererEvent?.("popup-closed-received", { key: "xxx" });
 *       setXxxPopupOpen(false);
 *     });
 *     return cleanup;
 *   }, [electron]);
 *
 * Statt sechs einzelner useEffects gibt es jetzt ein Array von
 * `PopupCloseBridge`-Objekten. Mixer-Window mit seinem speziellen Guard-Ref
 * + setTimeout-Reset (BUG-023) bleibt als eigener Effekt — der ist atypisch.
 */
import { useEffect } from "react";

export interface PopupCloseBridge {
  /**
   * Subscribe-Funktion (z.B. `electron.onPerfPopupClosed`). Wenn falsy
   * (nicht in Electron), wird die Bridge übersprungen.
   */
  subscribe?: ((cb: () => void) => (() => void) | void) | undefined;
  /** State-Setter der bei Close auf false gesetzt wird. */
  setter: (open: false) => void;
  /** Symbolischer Key fürs Renderer-Log (Diagnose, BUG-023). */
  logKey: string;
}

export interface UsePopupCloseBridgesArgs {
  /** Nur in Electron aktiv; in Browser No-Op. */
  isElectron: boolean;
  /** Optional logger (matched electron.logRendererEvent-Signatur). */
  log?: (event: string, data: Record<string, unknown>) => void;
  /** Liste der Bridges. */
  bridges: PopupCloseBridge[];
}

export function usePopupCloseBridges(args: UsePopupCloseBridgesArgs): void {
  const { isElectron, log, bridges } = args;
  useEffect(() => {
    if (!isElectron) return;
    const cleanups: Array<() => void> = [];
    for (const b of bridges) {
      const sub = b.subscribe;
      if (!sub) continue;
      const c = sub(() => {
        log?.("popup-closed-received", { key: b.logKey });
        b.setter(false);
      });
      if (typeof c === "function") cleanups.push(c);
    }
    return () => {
      for (const c of cleanups) {
        try { c(); } catch { /* ignore */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isElectron]);
}
