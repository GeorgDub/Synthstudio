/**
 * Synthstudio — Hacktribe-RAM-Transfer (v3.285.0)
 *
 * Seiteneffekt-Schicht über `utils/korg/hacktribeRam.ts`: Web-MIDI, Timeouts,
 * Chunking mit Pausen, Read-Back-Verifikation.
 *
 * ⚠️ Getrennt vom Live-Regelwerk (`KorgRemoteSender.ts`) und mit Absicht
 * unbequemer: jeder Schreibvorgang verlangt ein Bestätigungs-Objekt, wird
 * grundsätzlich zurückgelesen und bricht beim ersten Fehler ab, statt
 * weiterzuschreiben. Ein halb geschriebener FX-Preset ist schlimmer als ein
 * nicht geschriebener.
 *
 * Was wir **nicht** können: prüfen, ob das Gerät gerade spielt. Es gibt kein
 * Kommando, das den Transportzustand abfragt. Wir schicken vor jedem Write ein
 * MIDI-Stop (`0xFC`) — das hilft, wenn das Gerät auf externe Clock hört — und
 * verlangen ansonsten die ausdrückliche Bestätigung des Nutzers. Das ist
 * ehrlicher als eine Automatik vorzutäuschen, die es nicht gibt.
 */
import { getE2MidiAccess, resolveE2Output } from "./E2NativeSysexTransfer";
import { isE2SysexFrame } from "../utils/korg/e2NativeSysex";
import {
  RAM_READ_CHUNK,
  RAM_WRITE_CHUNK,
  buildRamReadRequest,
  buildRamWriteAddress,
  buildRamWriteData,
  parseRamResponse,
  splitRamRead,
  splitRamWrite,
  validateRamRange,
  verifyRamWrite,
  type RamVerifyResult,
} from "../utils/korg/hacktribeRam";

/** Wartezeit auf eine Geräteantwort. RAM-Lesen ist schnell, aber nicht instant. */
export const RAM_TIMEOUT_MS = 4000;

/** Pause zwischen zwei Häppchen. Verhindert Überlauf der Geräte-Sysex-Puffer. */
export const RAM_CHUNK_DELAY_MS = 30;

/** MIDI-Realtime-Stop. */
const MIDI_STOP = 0xfc;

export type RamOpResult<T> = { ok: true; value: T } | { ok: false; error: string };

interface Ports {
  out: MIDIOutput;
  ins: MIDIInput[];
}

async function resolvePorts(): Promise<RamOpResult<Ports>> {
  let access: MIDIAccess | null = null;
  try {
    access = await getE2MidiAccess();
  } catch (err) {
    return { ok: false, error: `Web MIDI nicht verfügbar: ${(err as Error)?.message ?? "unbekannt"}` };
  }
  if (!access) return { ok: false, error: "Web MIDI nicht verfügbar" };
  const out = resolveE2Output(access);
  if (!out) return { ok: false, error: "Kein MIDI-Ausgang zur Electribe gefunden" };
  return { ok: true, value: { out, ins: Array.from(access.inputs.values()) } };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Schickt einen Frame und wartet auf die erste Antwort, die ein E2-Sysex ist.
 *
 * Gehört wird auf **allen** Eingängen: welcher Port die Antwort bringt, hängt
 * vom Treiber ab, und ein Fremdgerät am selben Bus wird durch den
 * `isE2SysexFrame`-Filter aussortiert.
 */
function requestAndWait(
  ports: Ports,
  frame: Uint8Array,
  timeoutMs: number,
): Promise<RamOpResult<Uint8Array>> {
  return new Promise((resolve) => {
    let done = false;
    const handlers: { input: MIDIInput; prev: ((e: MIDIMessageEvent) => void) | null }[] = [];

    const cleanup = () => {
      clearTimeout(timer);
      for (const h of handlers) h.input.onmidimessage = h.prev;
    };

    const finish = (res: RamOpResult<Uint8Array>) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(res);
    };

    const timer = setTimeout(
      () => finish({ ok: false, error: `Keine Antwort vom Gerät (${timeoutMs} ms)` }),
      timeoutMs,
    );

    for (const input of ports.ins) {
      const prev = input.onmidimessage as ((e: MIDIMessageEvent) => void) | null;
      handlers.push({ input, prev });
      input.onmidimessage = (event: MIDIMessageEvent) => {
        // Fremde Handler nicht verschlucken — z. B. den MIDI-Monitor.
        try { prev?.call(input, event); } catch { /* Fremdhandler-Fehler ignorieren */ }
        const data = event.data;
        if (!data || !isE2SysexFrame(data)) return;
        finish({ ok: true, value: Uint8Array.from(data) });
      };
    }

    try {
      ports.out.send(frame);
    } catch (err) {
      finish({ ok: false, error: `Senden fehlgeschlagen: ${(err as Error)?.message ?? "unbekannt"}` });
    }
  });
}

/**
 * Liest `len` Bytes ab `addr` aus dem CPU-RAM.
 *
 * Wird automatisch in Häppchen zerlegt; abgebrochen wird beim ersten Häppchen,
 * das nicht antwortet — Teildaten mit Löchern wären wertlos und irreführend.
 */
export async function readRam(
  addr: number,
  len: number,
  globalChannel = 0,
): Promise<RamOpResult<Uint8Array>> {
  const check = validateRamRange(addr, len);
  if (!check.ok) return { ok: false, error: check.reason };

  const ports = await resolvePorts();
  if (!ports.ok) return ports;

  const out = new Uint8Array(len);
  let written = 0;

  for (const part of splitRamRead(addr, len, RAM_READ_CHUNK)) {
    const frame = buildRamReadRequest(part.addr, part.len, { globalChannel });
    const res = await requestAndWait(ports.value, frame, RAM_TIMEOUT_MS);
    if (!res.ok) {
      return {
        ok: false,
        error: `Lesen bei 0x${part.addr.toString(16).toUpperCase()} fehlgeschlagen: ${res.error}`,
      };
    }
    const parsed = parseRamResponse(res.value);
    if (!parsed || parsed.kind !== "data") {
      return {
        ok: false,
        error:
          parsed?.kind === "unknown"
            ? `Unerwartete Antwort (cmd 0x${parsed.cmd.toString(16)}) — läuft auf dem Gerät wirklich Hacktribe?`
            : "Antwort war kein Datenblock",
      };
    }
    // Das Gerät darf mehr liefern als angefragt (7↔8-Bit-Blockgrenzen) — wir
    // nehmen genau die angefragte Länge.
    const chunk = parsed.data.subarray(0, part.len);
    if (chunk.length < part.len) {
      return {
        ok: false,
        error: `Gerät lieferte nur ${chunk.length} von ${part.len} Bytes bei 0x${part.addr.toString(16).toUpperCase()}`,
      };
    }
    out.set(chunk, written);
    written += part.len;
    await sleep(RAM_CHUNK_DELAY_MS);
  }

  return { ok: true, value: out };
}

/** Bestätigung, die ein Schreibvorgang zwingend braucht. */
export interface RamWriteConfirmation {
  /**
   * Der Nutzer hat bestätigt, dass das Gerät **gestoppt** ist. Ohne das wird
   * nicht geschrieben — RAM-Writes während der Wiedergabe können kollidieren.
   */
  deviceStopped: true;
  /** Der Nutzer hat bestätigt, dass er weiß, was an dieser Adresse liegt. */
  understood: true;
}

export interface RamWriteReport {
  bytesWritten: number;
  chunks: number;
  verify: RamVerifyResult;
}

/**
 * Schreibt Bytes in den CPU-RAM — mit Stop-Signal, Chunking und Read-Back.
 *
 * Ablauf pro Häppchen: `0x53` Adresse setzen → `0x54` Daten → ACK abwarten.
 * Danach wird der **gesamte** Bereich zurückgelesen und byteweise verglichen.
 * Schlägt irgendetwas fehl, bricht die Funktion ab und meldet, wie weit sie kam
 * — wichtig, weil ein teilweise geschriebener Bereich ein anderer Zustand ist
 * als ein unangetasteter.
 */
export async function writeRam(
  addr: number,
  data: Uint8Array,
  confirmation: RamWriteConfirmation,
  globalChannel = 0,
): Promise<RamOpResult<RamWriteReport>> {
  if (!confirmation?.deviceStopped || !confirmation?.understood) {
    return { ok: false, error: "Schreiben ohne vollständige Bestätigung abgelehnt" };
  }
  const check = validateRamRange(addr, data.length);
  if (!check.ok) return { ok: false, error: check.reason };

  const ports = await resolvePorts();
  if (!ports.ok) return ports;

  // Stop ans Gerät. Wirkt nur, wenn es auf externe Clock hört — deshalb ist die
  // Nutzerbestätigung oben die eigentliche Absicherung, nicht das hier.
  try {
    ports.value.out.send([MIDI_STOP]);
  } catch {
    // Wenn schon das Stop nicht durchgeht, wird der Write ohnehin scheitern —
    // wir lassen ihn laufen und melden den echten Fehler dort.
  }
  await sleep(RAM_CHUNK_DELAY_MS);

  const chunks = splitRamWrite(addr, data, RAM_WRITE_CHUNK);
  let written = 0;

  for (const [i, chunk] of chunks.entries()) {
    const addrFrame = buildRamWriteAddress(chunk.addr, chunk.bytes.length, { globalChannel });
    try {
      ports.value.out.send(addrFrame);
    } catch (err) {
      return {
        ok: false,
        error: `Adress-Setzung für Häppchen ${i + 1}/${chunks.length} fehlgeschlagen: ${(err as Error)?.message ?? "unbekannt"} (${written} Bytes bereits geschrieben)`,
      };
    }
    await sleep(RAM_CHUNK_DELAY_MS);

    const dataFrame = buildRamWriteData(chunk.bytes, { globalChannel });
    const res = await requestAndWait(ports.value, dataFrame, RAM_TIMEOUT_MS);
    if (!res.ok) {
      return {
        ok: false,
        error: `Häppchen ${i + 1}/${chunks.length} bei 0x${chunk.addr.toString(16).toUpperCase()}: ${res.error} (${written} Bytes bereits geschrieben)`,
      };
    }
    const parsed = parseRamResponse(res.value);
    if (!parsed || parsed.kind !== "ack") {
      return {
        ok: false,
        error: `Gerät hat Häppchen ${i + 1}/${chunks.length} nicht bestätigt (${written} Bytes bereits geschrieben)`,
      };
    }
    written += chunk.bytes.length;
    await sleep(RAM_CHUNK_DELAY_MS);
  }

  // Read-Back — nicht optional. Ein Write ohne Gegenprobe ist ein Write, von
  // dem man nichts weiß.
  const back = await readRam(addr, data.length, globalChannel);
  if (!back.ok) {
    return { ok: false, error: `Geschrieben, aber Rücklesen fehlgeschlagen: ${back.error}` };
  }
  const verify = verifyRamWrite(data, back.value);
  if (!verify.ok) {
    return {
      ok: false,
      error:
        verify.diffCount < 0
          ? "Rücklesen ergab eine andere Länge als geschrieben"
          : `Rücklesen weicht ab: ${verify.diffCount} Byte(s), erstes bei Offset ${verify.firstDiff}`,
    };
  }

  return { ok: true, value: { bytesWritten: written, chunks: chunks.length, verify } };
}
