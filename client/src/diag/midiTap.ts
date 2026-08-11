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

/**
 * Wie ein Rahmen im Log heißen soll — die DEUTUNG.
 *
 * ☠ Sie steht immer NEBEN dem Roh-Hex, nie an seiner Stelle. Genau daran ist
 * der Befund vom 2026-08-11 gescheitert: das Banner druckte ein gedeutetes
 * Kommando-Byte und hinterliess keinen Beleg — hinterher liess sich nicht mehr
 * feststellen, ob das Gerät wirklich so geantwortet hatte.
 */
export function deute(b: Uint8Array): string {
  if (b.length === 0) return "leer";
  const s = b[0];
  if (s === 0xf8) return "Clock-Tick";
  if (s === 0xfa) return "Start";
  if (s === 0xfb) return "Continue";
  if (s === 0xfc) return "Stop";
  if (s === 0xfe) return "Active Sensing";
  if (s === 0xf0) {
    if (b[1] === 0x42) {
      // Adresse und Länge stecken 7-in-8-kodiert dahinter und werden hier
      // BEWUSST nicht dekodiert: eine falsch dekodierte Adresse sähe richtig
      // aus. Das Kommando-Byte und die Rahmenlänge reichen als Anhalt, den
      // Rest belegt das Hex.
      return `Korg-Sysex cmd 0x${(b[6] ?? 0).toString(16)}, ${b.length} B`;
    }
    return `Sysex (fremd), ${b.length} B`;
  }
  const typ = s & 0xf0;
  const kanal = (s & 0x0f) + 1;
  if (typ === 0xb0) return `CC ${b[1]} = ${b[2]} (Kanal ${kanal})`;
  if (typ === 0x90) return `Note ${b[1]} an, Anschlag ${b[2]} (Kanal ${kanal})`;
  if (typ === 0x80) return `Note ${b[1]} aus (Kanal ${kanal})`;
  if (typ === 0xe0) return `Pitch-Bend (Kanal ${kanal})`;
  return `${b.length} B`;
}

/**
 * Was zu Zählern verdichtet werden darf: Clock, Active Sensing, Noten.
 *
 * Sysex, CC und NRPN NIE — das sind genau die Rahmen, wegen derer es das Log
 * gibt. `null` heisst „nicht verdichten".
 */
function verdichtungsArt(b: Uint8Array): string | null {
  if (b.length === 0) return null;
  const s = b[0];
  if (s === 0xf8) return "Clock-Ticks";
  if (s === 0xfe) return "Active-Sensing";
  const typ = s & 0xf0;
  if (typ === 0x90 || typ === 0x80) return "Noten";
  return null;
}

/** Sammelt gleichartige Ereignisse, bis etwas anderes kommt. */
function macheVerdichter(log: TraceLog, aktiv: boolean) {
  let art: string | null = null;
  let anzahl = 0;
  let quelle = "";
  let richtung: "midi-in" | "midi-out" = "midi-in";

  const spuele = () => {
    if (art && anzahl > 0) {
      log.push({
        kind: richtung,
        src: quelle,
        msg: `${anzahl} ${art} (zusammengefasst)`,
      });
    }
    art = null;
    anzahl = 0;
  };

  return {
    /** true = das Ereignis wurde verdichtet und darf nicht einzeln rein. */
    nimm(b: Uint8Array, src: string, dir: "midi-in" | "midi-out"): boolean {
      if (!aktiv) return false;
      const neu = verdichtungsArt(b);
      if (!neu) {
        spuele(); // erst den Zähler, dann das interessante Ereignis
        return false;
      }
      if (art !== neu || quelle !== src || richtung !== dir) spuele();
      art = neu;
      quelle = src;
      richtung = dir;
      anzahl += 1;
      return true;
    },
    spuele,
  };
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

type Verdichter = ReturnType<typeof macheVerdichter>;

function tapEingang(
  input: TapfaehigerEingang,
  log: TraceLog,
  verdichter: Verdichter
): void {
  if (getappt.has(input)) return;
  getappt.add(input);
  input.addEventListener("midimessage", (event: Event) => {
    try {
      const data = (event as Event & { data?: Uint8Array }).data;
      if (!data) return;
      const src = portName(input);
      if (verdichter.nimm(data, src, "midi-in")) return;
      log.push({
        kind: "midi-in",
        src,
        msg: deute(data),
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

function tapAusgang(
  output: TapfaehigerAusgang,
  log: TraceLog,
  verdichter: Verdichter
): void {
  if (getappt.has(output)) return;
  getappt.add(output);
  const echt = output.send.bind(output);
  output.send = (data: Uint8Array | number[], timestamp?: number) => {
    try {
      const bytes = data instanceof Uint8Array ? data : Uint8Array.from(data);
      const src = portName(output);
      if (verdichter.nimm(bytes, src, "midi-out")) return echt(data, timestamp);
      log.push({
        kind: "midi-out",
        src,
        msg: deute(bytes),
        hex: toHex(bytes),
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

function tapZugriff(
  access: TapfaehigerZugriff,
  log: TraceLog,
  verdichter: Verdichter
): void {
  access.inputs?.forEach(i => tapEingang(i, log, verdichter));
  access.outputs?.forEach(o => tapAusgang(o, log, verdichter));
}

/**
 * Installiert den Tap. Gibt eine Funktion zurück, die ihn wieder entfernt.
 *
 * Muss laufen, BEVOR irgendein Aufrufer `requestMIDIAccess` aufruft — ein Tap,
 * der einen Tick zu spät greift, verpasst still, welcher Pfad zuerst lief.
 */
export interface MidiTapOptions {
  /**
   * Clock und Noten zu Zaehlern zusammenfassen. Standard: an.
   *
   * Bei 185 BPM sind 24 Ticks je Viertel rund 74 Ereignisse pro Sekunde —
   * einzeln protokolliert deckt das jede interessante Zeile zu und leert den
   * Ringpuffer binnen Sekunden.
   */
  verdichten?: boolean;
}

export function installMidiTap(
  log: TraceLog,
  opts: MidiTapOptions = {}
): () => void {
  const verdichter = macheVerdichter(log, opts.verdichten !== false);
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
      tapZugriff(access as TapfaehigerZugriff, log, verdichter);
      // Nachträglich eingesteckte Geräte ebenfalls tappen. addEventListener,
      // damit `onstatechange` des Aufrufers unangetastet bleibt.
      (access as TapfaehigerZugriff).addEventListener?.call(
        access as EventTarget,
        "statechange",
        () => tapZugriff(access as TapfaehigerZugriff, log, verdichter)
      );
    } catch {
      /* ein kaputter Tap darf MIDI nicht verhindern */
    }
    return access;
  };

  nav.requestMIDIAccess = umhuellt;
  return () => {
    verdichter.spuele(); // sonst faellt der letzte Zaehler unter den Tisch
    nav.requestMIDIAccess = original;
  };
}
