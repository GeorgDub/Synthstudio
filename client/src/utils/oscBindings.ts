/**
 * Synthstudio – OSC-Bindings (v2.17 + v2.34 Loop-Closing)
 *
 * Mappt OSC-Adressen wie "/synth/bpm" auf interne Window-Events
 * (analog zu MIDI-Bindings via "midi:bpm"). Pure-Logik damit Tests
 * ohne Browser laufen.
 *
 * Schema-Tabelle (v2.34: Symmetrie zu OSC-Out aus v2.26-v2.31 hergestellt):
 *
 *   /synth/bpm <i|f>              → midi:bpm           value=<arg>
 *   /synth/bpm/current <i|f>      → midi:bpm           value=<arg>          (Alias)
 *   /synth/play                   → midi:playStop      toggle=true
 *   /synth/transport/play         → midi:playStop      toggle=true          (Alias)
 *   /synth/stop                   → midi:stop
 *   /synth/transport/stop         → midi:stop                                (Alias)
 *   /synth/pattern <i>            → midi:pattern       index=<arg>
 *   /synth/pattern <s>            → midi:pattern       patternId=<arg>      (v2.34)
 *   /synth/macro/<n> <f>          → macro:set          index=<n>, value=<f>
 *   /synth/volume <f>             → midi:masterVolume  value=<f>            (Master)
 *   /synth/volume/<partId> <f>    → midi:partVolume    {partId,value}        (v2.34)
 *   /synth/pan/<partId> <f>       → midi:partPan       {partId,value}        (v2.34)
 *   /synth/mute/<partId> <T|F|i|s>→ midi:partMute      partId=<id>           (v2.34)
 *   /synth/solo/<partId>          → midi:partSolo      partId=<id>           (v2.34)
 *
 * Truthy-Konvention für Mute (v2.34): boolean True, integer != 0, string in
 * {"1","true","T","on","yes"} → mute=an. Symmetrisch zur OSC-Out-Variante,
 * die "1"/"0"-Strings sendet.
 */
import type { OscMessage } from "./oscEncoder";

export interface MappedOscAction {
  /** Window-Event-Name. */
  event: string;
  /** Detail-Payload (wird als CustomEvent.detail dispatcht). */
  detail: unknown;
}

/** v2.34: Truthy-Check für gemischte Bool/Int/String-Inputs aus OSC. */
export function oscIsTruthy(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "1" || s === "true" || s === "t" || s === "on" || s === "yes";
  }
  return false;
}

/**
 * Übersetzt eine OSC-Message in eine intern dispatchbare Action.
 * Liefert null wenn die Address nicht in das Standard-Schema passt.
 */
export function mapOscToAction(msg: OscMessage): MappedOscAction | null {
  const addr = msg.address;
  const args = msg.args;
  const arg0 = args.length > 0 ? args[0] : undefined;

  // ── BPM ─────────────────────────────────────────────────────────────────
  if ((addr === "/synth/bpm" || addr === "/synth/bpm/current") && typeof arg0 === "number") {
    return { event: "midi:bpm", detail: { value: arg0 } };
  }

  // ── Transport ───────────────────────────────────────────────────────────
  if (addr === "/synth/play" || addr === "/synth/transport/play") {
    return { event: "midi:playStop", detail: { toggle: true } };
  }
  if (addr === "/synth/stop" || addr === "/synth/transport/stop") {
    return { event: "midi:stop", detail: {} };
  }

  // ── Pattern: akzeptiert Integer-Index ODER Pattern-ID-String ────────────
  if (addr === "/synth/pattern") {
    if (typeof arg0 === "number") {
      return { event: "midi:pattern", detail: { index: Math.round(arg0) } };
    }
    if (typeof arg0 === "string" && arg0.length > 0) {
      return { event: "midi:pattern", detail: { patternId: arg0 } };
    }
  }

  // ── Master-Volume ───────────────────────────────────────────────────────
  if (addr === "/synth/volume" && typeof arg0 === "number") {
    return { event: "midi:masterVolume", detail: { value: arg0 } };
  }

  // ── /synth/macro/<n> <f> ────────────────────────────────────────────────
  const macroMatch = addr.match(/^\/synth\/macro\/(\d+)$/);
  if (macroMatch && typeof arg0 === "number") {
    return {
      event: "macro:set",
      detail: { index: parseInt(macroMatch[1], 10), value: arg0 },
    };
  }

  // ── /synth/volume/<partId> <f> (v2.34) ──────────────────────────────────
  const volumeMatch = addr.match(/^\/synth\/volume\/(.+)$/);
  if (volumeMatch && typeof arg0 === "number") {
    return {
      event: "midi:partVolume",
      detail: { partId: decodeURIComponent(volumeMatch[1]), value: arg0 },
    };
  }

  // ── /synth/pan/<partId> <f> (v2.34) ─────────────────────────────────────
  const panMatch = addr.match(/^\/synth\/pan\/(.+)$/);
  if (panMatch && typeof arg0 === "number") {
    return {
      event: "midi:partPan",
      detail: { partId: decodeURIComponent(panMatch[1]), value: arg0 },
    };
  }

  // ── /synth/mute/<partId> <T|F|i|s> ──────────────────────────────────────
  // Truthy-Check über oscIsTruthy() damit "1"/"0"-Strings (OSC-Out-Format),
  // Integer 1/0 und Boolean T/F gleichermaßen funktionieren. Wenn truthy
  // dispatchen wir ein Toggle-Event (App-Listener liest aktuellen Mute-State
  // und togglet) — falsy NICHT dispatchen damit „explizit unmute" kein
  // toggle wird; das wird über separates Event handhabt.
  const muteMatch = addr.match(/^\/synth\/mute\/(.+)$/);
  if (muteMatch && args.length > 0) {
    const partId = decodeURIComponent(muteMatch[1]);
    // App-Listener `midi:partMute` toggelt — als detail wird die partId
    // direkt als String erwartet (siehe App.tsx v1.76 handleMute).
    if (oscIsTruthy(arg0)) {
      return { event: "midi:partMute", detail: partId };
    }
    // Falsy (z.B. "0"/false): explizites Setzen via Helper-Event,
    // damit wir nicht unbeabsichtigt toggeln. App-Listener kann separat
    // hooken; existiert noch nicht, ist aber für Reverse-Sync nötig.
    return { event: "midi:partMuteSet", detail: { partId, value: false } };
  }

  // ── /synth/solo/<partId> (v2.34) ────────────────────────────────────────
  const soloMatch = addr.match(/^\/synth\/solo\/(.+)$/);
  if (soloMatch) {
    return { event: "midi:partSolo", detail: decodeURIComponent(soloMatch[1]) };
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
