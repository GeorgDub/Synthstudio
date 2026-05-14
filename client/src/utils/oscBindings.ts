/**
 * Synthstudio – OSC-Bindings (v2.17)
 *
 * Mappt OSC-Adressen wie "/synth/bpm" auf interne Window-Events
 * (analog zu MIDI-Bindings via "midi:bpm"). Pure-Logik damit Tests
 * ohne Browser laufen.
 *
 * Standard-Mapping (Default-Handler):
 *
 *   /synth/bpm <i|f>            → window event "midi:bpm"     value=<arg>
 *   /synth/play                 → window event "midi:playStop" toggle=true
 *   /synth/stop                 → window event "midi:stop"
 *   /synth/pattern <i>          → window event "midi:pattern"  index=<arg>
 *   /synth/macro/<n> <f>        → window event "macro:set"     index=<n>, value=<f>
 *   /synth/volume <f>           → window event "midi:masterVolume" value=<f>
 *   /synth/mute/<partId> <T|F>  → window event "midi:partMute" partId=<partId>, value=<T|F>
 */
import type { OscMessage } from "./oscEncoder";

export interface MappedOscAction {
  /** Window-Event-Name. */
  event: string;
  /** Detail-Payload (wird als CustomEvent.detail dispatcht). */
  detail: Record<string, unknown>;
}

/**
 * Übersetzt eine OSC-Message in eine intern dispatchbare Action.
 * Liefert null wenn die Address nicht in das Standard-Schema passt.
 */
export function mapOscToAction(msg: OscMessage): MappedOscAction | null {
  const addr = msg.address;
  const args = msg.args;
  const arg0 = args.length > 0 ? args[0] : undefined;

  if (addr === "/synth/bpm" && typeof arg0 === "number") {
    return { event: "midi:bpm", detail: { value: arg0 } };
  }
  if (addr === "/synth/play") {
    return { event: "midi:playStop", detail: { toggle: true } };
  }
  if (addr === "/synth/stop") {
    return { event: "midi:stop", detail: {} };
  }
  if (addr === "/synth/pattern" && typeof arg0 === "number") {
    return { event: "midi:pattern", detail: { index: Math.round(arg0) } };
  }
  if (addr === "/synth/volume" && typeof arg0 === "number") {
    return { event: "midi:masterVolume", detail: { value: arg0 } };
  }

  // /synth/macro/<n> <f>
  const macroMatch = addr.match(/^\/synth\/macro\/(\d+)$/);
  if (macroMatch && typeof arg0 === "number") {
    return {
      event: "macro:set",
      detail: { index: parseInt(macroMatch[1], 10), value: arg0 },
    };
  }

  // /synth/mute/<partId> <T|F>
  const muteMatch = addr.match(/^\/synth\/mute\/(.+)$/);
  if (muteMatch && typeof arg0 === "boolean") {
    return {
      event: "midi:partMute",
      detail: { partId: decodeURIComponent(muteMatch[1]), value: arg0 },
    };
  }

  return null;
}

/**
 * Dispatcht die mapping-resolved Action als window CustomEvent.
 * Im Browser/Electron wird so jede registrierte UI-Komponente getriggered
 * — das gleiche Modell wie bei MIDI-Bindings.
 */
export function dispatchOscAction(action: MappedOscAction): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(action.event, { detail: action.detail }));
}
