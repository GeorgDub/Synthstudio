/**
 * Synthstudio – quickActionExecutor (v3.68.0)
 *
 * Sequenzieller Ausführer für QuickActionMacros (siehe useQuickActionStore).
 *
 * Architektur: Pure Funktion ohne direkte Store-Imports. Aufrufer
 * (App.tsx / useQuickActionKeyBindings) injiziert einen `QuickActionContext`
 * mit den nötigen Settern. So bleibt der Executor unit-testbar ohne
 * Browser/Audio-Engine.
 */
import type { QuickActionMacro, QuickActionMacroAction } from "@/store/useQuickActionStore";

/**
 * Context-Bag mit allen Side-Effect-Settern, die ein Macro auslösen kann.
 * Jeder Setter ist optional — Aufrufer (App.tsx) injiziert nur die für
 * sein Setup verfügbaren. Fehlende Setter → no-op für die jeweilige
 * Action (mit `onUnhandled`-Log).
 */
export interface QuickActionContext {
  setBpm?: (bpm: number) => void;
  setMasterVolume?: (value: number) => void;
  setChannelVolume?: (channelId: string, value: number) => void;
  setChannelPan?: (channelId: string, value: number) => void;
  setChannelMute?: (channelId: string, value: boolean) => void;
  /** Mute ALLE Drum-Parts (idR. dm.muteAllDrumParts(value)). */
  setAllDrumPartsMuted?: (value: boolean) => void;
  switchPattern?: (patternId: string) => void;
  triggerScene?: (sceneIndex: number) => void;
  playPad?: (padIndex: number) => void;
  /** Optional: Hook für Logging/Telemetry bei unbekannten/nicht-handle-baren Actions. */
  onUnhandled?: (action: QuickActionMacroAction, reason: "no-setter" | "invalid") => void;
  /**
   * Custom Sleep-Funktion. In Tests injizierbar damit Delays nicht real warten.
   * Default ist `setTimeout`-basiert.
   */
  sleep?: (ms: number) => Promise<void>;
}

/** Default-Sleep: setTimeout-Promise. In Tests kann man eine no-op-Variante injizieren. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

/**
 * Führt eine einzelne Action aus. Pure relativ zu `ctx` (keine Imports
 * von Stores). Liefert true wenn ein Setter dispatched wurde, sonst false.
 */
export async function executeQuickAction(
  action: QuickActionMacroAction,
  ctx: QuickActionContext,
): Promise<boolean> {
  switch (action.kind) {
    case "mute-all-drum-parts":
      if (ctx.setAllDrumPartsMuted) {
        ctx.setAllDrumPartsMuted(action.value);
        return true;
      }
      ctx.onUnhandled?.(action, "no-setter");
      return false;
    case "set-channel-volume":
      if (ctx.setChannelVolume) {
        ctx.setChannelVolume(action.channelId, action.value);
        return true;
      }
      ctx.onUnhandled?.(action, "no-setter");
      return false;
    case "set-channel-pan":
      if (ctx.setChannelPan) {
        ctx.setChannelPan(action.channelId, action.value);
        return true;
      }
      ctx.onUnhandled?.(action, "no-setter");
      return false;
    case "set-channel-mute":
      if (ctx.setChannelMute) {
        ctx.setChannelMute(action.channelId, action.value);
        return true;
      }
      ctx.onUnhandled?.(action, "no-setter");
      return false;
    case "switch-pattern":
      if (ctx.switchPattern) {
        ctx.switchPattern(action.patternId);
        return true;
      }
      ctx.onUnhandled?.(action, "no-setter");
      return false;
    case "set-bpm":
      if (ctx.setBpm) {
        ctx.setBpm(action.bpm);
        return true;
      }
      ctx.onUnhandled?.(action, "no-setter");
      return false;
    case "trigger-scene":
      if (ctx.triggerScene) {
        ctx.triggerScene(action.sceneIndex);
        return true;
      }
      ctx.onUnhandled?.(action, "no-setter");
      return false;
    case "play-pad":
      if (ctx.playPad) {
        ctx.playPad(action.padIndex);
        return true;
      }
      ctx.onUnhandled?.(action, "no-setter");
      return false;
    case "set-master-volume":
      if (ctx.setMasterVolume) {
        ctx.setMasterVolume(action.value);
        return true;
      }
      ctx.onUnhandled?.(action, "no-setter");
      return false;
    case "delay": {
      const sleep = ctx.sleep ?? defaultSleep;
      await sleep(action.ms);
      return true;
    }
    default: {
      // Exhaustiveness-Check.
      const _exhaustive: never = action;
      void _exhaustive;
      return false;
    }
  }
}

/**
 * Führt alle Actions eines Macros sequenziell aus. Reihenfolge bleibt
 * exakt erhalten — auch Delays. Wenn ein Setter fehlt wird die Action
 * skipped (mit `onUnhandled`-Log) und mit der nächsten Action fortgefahren.
 *
 * Returns Anzahl der erfolgreich dispatched-en Actions.
 */
export async function executeQuickActionMacro(
  macro: QuickActionMacro,
  ctx: QuickActionContext,
): Promise<number> {
  if (!macro || !Array.isArray(macro.actions)) return 0;
  let dispatched = 0;
  for (const action of macro.actions) {
    const ok = await executeQuickAction(action, ctx);
    if (ok) dispatched++;
  }
  return dispatched;
}
