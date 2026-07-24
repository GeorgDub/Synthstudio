/**
 * Synthstudio — E2 Native Sysex Transfer (v3.268.0)
 *
 * Seiteneffekt-Schicht für den Pattern-Austausch mit einer ECHTEN Korg
 * Electribe 2 (Stock oder Hacktribe) über deren natives `F0 42 …`-Protokoll.
 *
 * Arbeitsteilung:
 *   - `utils/korg/e2NativeSysex.ts` — reine Bytes (getestet)
 *   - dieses Modul                  — MIDIAccess, Ports, Timeouts
 *
 * Port-Strategie (bewusst asymmetrisch, damit der Nutzer nichts konfigurieren
 * MUSS): gesendet wird auf dem in `useE2sPatternSyncStore` gewählten Output —
 * fehlt der, wird per Namensheuristik gesucht. Empfangen wird auf **allen**
 * Inputs gleichzeitig; die erste Nachricht, die `isE2SysexFrame` besteht,
 * gewinnt. Fremde Geräte am selben Bus stören dadurch nicht.
 */
import {
  buildCurrentPatternDumpRequest,
  buildPatternDumpRequest,
  buildCurrentPatternDump,
  isE2SysexFrame,
  parseE2SysexResponse,
  type E2SysexResponse,
} from "../utils/korg/e2NativeSysex";
import { getE2sPatternSyncState } from "../store/useE2sPatternSyncStore";

/** Default-Wartezeit auf einen Dump. Ein 18.7-KB-Frame braucht über DIN-MIDI
 *  (31250 Baud) rechnerisch ~6 s — deshalb großzügig. */
export const DEFAULT_DUMP_TIMEOUT_MS = 12000;

export type E2TransferResult =
  | { ok: true; response: E2SysexResponse }
  | { ok: false; error: string };

// ─── MIDIAccess ──────────────────────────────────────────────────────────────

let _midiAccess: MIDIAccess | null = null;
let _midiAccessPromise: Promise<MIDIAccess> | null = null;

async function ensureMidiAccess(): Promise<MIDIAccess | null> {
  if (_midiAccess) return _midiAccess;
  if (typeof navigator === "undefined" || !navigator.requestMIDIAccess) return null;
  if (!_midiAccessPromise) {
    _midiAccessPromise = navigator.requestMIDIAccess({ sysex: true });
  }
  try {
    _midiAccess = await _midiAccessPromise;
    return _midiAccess;
  } catch {
    _midiAccessPromise = null;
    return null;
  }
}

/** Nur für Tests: gecachten MIDIAccess verwerfen. */
export function __resetE2NativeTransferForTests(): void {
  _midiAccess = null;
  _midiAccessPromise = null;
}

/** Erkennt Electribe-Ports am Namen, wenn nichts konfiguriert ist. */
function looksLikeElectribePort(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return n.includes("electribe") || n.includes("korg") || n.includes("hacktribe");
}

function resolveOutput(access: MIDIAccess): MIDIOutput | null {
  const configured = getE2sPatternSyncState().outputPortId;
  if (configured) {
    const out = access.outputs.get(configured);
    if (out) return out;
  }
  for (const out of access.outputs.values()) {
    if (looksLikeElectribePort(out.name)) return out;
  }
  return null;
}

// ─── Empfang ─────────────────────────────────────────────────────────────────

/**
 * Wartet auf den ersten Electribe-Sysex-Frame auf irgendeinem Input.
 * Räumt seine Listener in jedem Ausgang (Treffer, Timeout, Abbruch) wieder ab.
 */
function awaitE2Response(access: MIDIAccess, timeoutMs: number): Promise<E2TransferResult> {
  return new Promise((resolve) => {
    const inputs = Array.from(access.inputs.values());
    if (inputs.length === 0) {
      resolve({ ok: false, error: "Kein MIDI-Eingang gefunden — ist die Electribe angeschlossen?" });
      return;
    }

    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timer);
      for (const inp of inputs) inp.removeEventListener("midimessage", onMessage as EventListener);
    };

    const onMessage = (ev: MIDIMessageEvent) => {
      if (settled || !ev.data) return;
      const bytes = ev.data instanceof Uint8Array ? ev.data : new Uint8Array(ev.data);
      if (!isE2SysexFrame(bytes)) return; // fremdes Gerät / kurze Realtime-Message
      settled = true;
      cleanup();
      resolve({ ok: true, response: parseE2SysexResponse(bytes) });
    };

    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        ok: false,
        error:
          `Keine Antwort innerhalb von ${Math.round(timeoutMs / 1000)} s. ` +
          `Prüfe: richtiger MIDI-Port, Global-Channel, und ob das Gerät gerade abspielt.`,
      });
    }, timeoutMs);

    for (const inp of inputs) inp.addEventListener("midimessage", onMessage as EventListener);
  });
}

// ─── Öffentliche Operationen ─────────────────────────────────────────────────

export interface E2TransferOptions {
  /** MIDI-Global-Channel 0..15. Default: aus dem Sync-Store. */
  globalChannel?: number;
  timeoutMs?: number;
}

function channelFromOptions(opts?: E2TransferOptions): number {
  if (typeof opts?.globalChannel === "number") return opts.globalChannel;
  const st = getE2sPatternSyncState() as { channel?: number };
  return typeof st.channel === "number" ? st.channel : 0;
}

/**
 * Fordert ein Pattern vom Gerät an und liefert den 16384-Byte-PTST-Body.
 *
 * @param patternIndex 0-basierter Slot, oder `undefined` für den Edit-Buffer
 *                     (= das, was gerade auf dem Gerät läuft).
 */
export async function requestPatternFromDevice(
  patternIndex?: number,
  opts?: E2TransferOptions,
): Promise<E2TransferResult> {
  const access = await ensureMidiAccess();
  if (!access) {
    return { ok: false, error: "Web MIDI nicht verfügbar (Berechtigung verweigert oder Browser ohne Sysex-Support)." };
  }
  const out = resolveOutput(access);
  if (!out) {
    return { ok: false, error: "Kein MIDI-Ausgang gewählt — bitte in den MIDI-Einstellungen einen Electribe-Port setzen." };
  }

  const globalChannel = channelFromOptions(opts);
  const frame =
    typeof patternIndex === "number"
      ? buildPatternDumpRequest(patternIndex, { globalChannel })
      : buildCurrentPatternDumpRequest({ globalChannel });

  // Listener VOR dem Senden aufsetzen — das Gerät antwortet teils sehr schnell.
  const pending = awaitE2Response(access, opts?.timeoutMs ?? DEFAULT_DUMP_TIMEOUT_MS);
  try {
    out.send(Array.from(frame));
  } catch (e) {
    return { ok: false, error: `Senden fehlgeschlagen: ${(e as Error).message}` };
  }
  return pending;
}

/**
 * Schickt einen 16384-Byte-PTST-Body in den Edit-Buffer des Geräts.
 *
 * Bewusst NUR in den Edit-Buffer (0x40), nicht in einen Slot (0x4C): so
 * überschreibt ein Fehlgriff niemals ein gespeichertes Pattern auf der Korg.
 * Der Nutzer speichert am Gerät selbst, wenn er das Ergebnis behalten will.
 */
export async function sendPatternToDevice(
  body: Uint8Array,
  opts?: E2TransferOptions & { expectAck?: boolean },
): Promise<E2TransferResult> {
  const access = await ensureMidiAccess();
  if (!access) {
    return { ok: false, error: "Web MIDI nicht verfügbar (Berechtigung verweigert oder Browser ohne Sysex-Support)." };
  }
  const out = resolveOutput(access);
  if (!out) {
    return { ok: false, error: "Kein MIDI-Ausgang gewählt — bitte in den MIDI-Einstellungen einen Electribe-Port setzen." };
  }

  let frame: Uint8Array;
  try {
    frame = buildCurrentPatternDump(body, { globalChannel: channelFromOptions(opts) });
  } catch (e) {
    return { ok: false, error: `Pattern konnte nicht kodiert werden: ${(e as Error).message}` };
  }

  // Auf ACK/NAK lauschen, bevor gesendet wird.
  const wantAck = opts?.expectAck !== false;
  const pending = wantAck ? awaitE2Response(access, opts?.timeoutMs ?? DEFAULT_DUMP_TIMEOUT_MS) : null;

  try {
    out.send(Array.from(frame));
  } catch (e) {
    return { ok: false, error: `Senden fehlgeschlagen: ${(e as Error).message}` };
  }

  if (!pending) return { ok: true, response: { kind: "ack", cmd: 0x23 } };
  return pending;
}
