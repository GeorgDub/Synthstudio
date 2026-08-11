/**
 * Diagnose-Log — MIDI-Tap.
 *
 * Hüllt `navigator.requestMIDIAccess` EINMAL um. Danach laufen alle Aufrufer
 * durchs Log, ohne dass eine ihrer Dateien angefasst wird — es gibt keinen
 * anderen Engpass, durch den beide konkurrierenden RAM-Pfade laufen.
 *
 * ☠ Eingehendes wird über `addEventListener` beobachtet, NICHT über
 * `onmidimessage`. Letzteres ist ein einzelner Steckplatz: wer ihn belegt,
 * wirft den vorherigen Inhaber hinaus. Ein Tap, der das täte, stellte je nach
 * Reihenfolge entweder sich selbst oder den Aufrufer taub — `HacktribeRamTransfer`
 * umschifft genau das schon von Hand.
 *
 * Roh-Hex wird IMMER festgehalten, auch ohne Deutung. Ein Banner, das nur ein
 * gedeutetes Byte druckt, hinterlässt keinen Beleg — genau daran ist die
 * Sitzung vom 2026-08-11 gescheitert.
 */
import type { TraceLog } from "./traceLog";

/** Ports, die schon einen Tap haben — verhindert doppeltes Protokollieren. */
const getappt = new WeakSet<object>();

export function toHex(bytes: Uint8Array | number[]): string {
  const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  return Array.from(b)
    .map(x => x.toString(16).toUpperCase().padStart(2, "0"))
    .join(" ");
}

interface TapfaehigerEingang extends EventTarget {
  id?: string;
  name?: string;
  open?: () => Promise<unknown>;
}

interface TapfaehigerAusgang {
  id?: string;
  name?: string;
  send: (data: Uint8Array | number[], timestamp?: number) => void;
}

function portName(p: { id?: string; name?: string }): string {
  return p.name ?? p.id ?? "?";
}

function tapEingang(input: TapfaehigerEingang, log: TraceLog): void {
  if (getappt.has(input)) return;
  getappt.add(input);
  input.addEventListener("midimessage", (event: Event) => {
    try {
      const data = (event as Event & { data?: Uint8Array }).data;
      if (!data) return;
      log.push({
        kind: "midi-in",
        src: portName(input),
        msg: `${data.length} B`,
        hex: toHex(data),
      });
    } catch {
      /* Das Log darf die App nie zum Absturz bringen. */
    }
  });
  // Ohne `open()` liefert ein Port, den niemand sonst geöffnet hat, nichts.
  try {
    void input.open?.();
  } catch {
    /* egal — dann hat ihn ein anderer schon geöffnet */
  }
}

function tapAusgang(output: TapfaehigerAusgang, log: TraceLog): void {
  if (getappt.has(output)) return;
  getappt.add(output);
  const echt = output.send.bind(output);
  output.send = (data: Uint8Array | number[], timestamp?: number) => {
    try {
      log.push({
        kind: "midi-out",
        src: portName(output),
        msg: `${data.length} B`,
        hex: toHex(data),
      });
    } catch {
      /* nie den Sendeweg blockieren */
    }
    return echt(data, timestamp);
  };
}

interface TapfaehigerZugriff {
  inputs?: { forEach: (fn: (v: TapfaehigerEingang) => void) => void };
  outputs?: { forEach: (fn: (v: TapfaehigerAusgang) => void) => void };
  addEventListener?: EventTarget["addEventListener"];
}

function tapZugriff(access: TapfaehigerZugriff, log: TraceLog): void {
  access.inputs?.forEach(i => tapEingang(i, log));
  access.outputs?.forEach(o => tapAusgang(o, log));
}

/**
 * Installiert den Tap. Gibt eine Funktion zurück, die ihn wieder entfernt.
 *
 * Muss laufen, BEVOR irgendein Aufrufer `requestMIDIAccess` aufruft — ein Tap,
 * der einen Tick zu spät greift, verpasst still, welcher Pfad zuerst lief.
 */
export function installMidiTap(log: TraceLog): () => void {
  const nav = navigator as unknown as Record<string, unknown>;
  const original = nav.requestMIDIAccess as
    | ((options?: unknown) => Promise<unknown>)
    | undefined;
  if (typeof original !== "function") {
    log.push({
      kind: "error",
      src: "midiTap",
      msg: "navigator.requestMIDIAccess fehlt — kein MIDI in dieser Umgebung",
    });
    return () => {};
  }

  const umhuellt = async (options?: unknown) => {
    const access = await original.call(navigator, options);
    try {
      tapZugriff(access as TapfaehigerZugriff, log);
      // Nachträglich eingesteckte Geräte ebenfalls tappen. addEventListener,
      // damit `onstatechange` des Aufrufers unangetastet bleibt.
      (access as TapfaehigerZugriff).addEventListener?.call(
        access as EventTarget,
        "statechange",
        () => tapZugriff(access as TapfaehigerZugriff, log)
      );
    } catch {
      /* ein kaputter Tap darf MIDI nicht verhindern */
    }
    return access;
  };

  nav.requestMIDIAccess = umhuellt;
  return () => {
    nav.requestMIDIAccess = original;
  };
}
