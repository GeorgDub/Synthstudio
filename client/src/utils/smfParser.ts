/**
 * smfParser.ts
 *
 * Standard MIDI File (SMF) Parser – pure TypeScript, reines Uint8Array.
 * Unterstützt Type 0 und Type 1, extrahiert GM-Drum-Noten (Channel 9).
 * Kein Node.js/Buffer-Abhängigkeit – läuft auch im Browser-Context.
 */

// ─── Öffentliche Typen ────────────────────────────────────────────────────────

export interface ParsedMidiNote {
  /** MIDI-Noten-Nummer (typischerweise 35–81 für GM-Drums) */
  note: number;
  /** Auf 16 Steps quantisierter Step-Index (0–15) */
  stepIndex: number;
  /** MIDI-Velocity (0–127) */
  velocity: number;
}

export interface ParsedMidiFile {
  /** Tempo in BPM aus Set-Tempo-Meta-Event; null wenn kein Tempo-Event vorhanden */
  bpm: number | null;
  /** Ticks pro Viertelrnote (PPQN) aus dem MIDI-Header */
  ticksPerQuarterNote: number;
  /** Maximaler Tick-Zeitstempel über alle Tracks */
  totalTicks: number;
  /** Alle gefundenen Drum-Noten (Channel 9, Note-On, Velocity > 0) */
  notes: ParsedMidiNote[];
  /** Anzahl erfolgreich geparster Tracks */
  trackCount: number;
}

// ─── Detaillierte Variante (v3.303) ──────────────────────────────────────────
//
// Warum eine zweite Ausgabe statt einer Erweiterung der ersten: `ParsedMidiNote`
// trägt nur einen auf 16 Steps quantisierten `stepIndex` mit `% 16`. Damit ist
// die Taktinformation schon verloren, bevor ein Aufrufer sie sehen kann —
// mehrtaktige Dateien fallen zu einem Takt zusammen. Für den Pattern-Import
// braucht es den absoluten Tick, den Quell-Track und die Taktart. Die alte
// Ausgabe bleibt unverändert, weil sie getestet und in Benutzung ist.

/** Eine Note mit vollständiger Herkunft — nichts vorquantisiert. */
export interface DetailedMidiNote {
  /** Index des MTrk-Chunks (0-basiert), in Dateireihenfolge. */
  trackIndex: number;
  /** MIDI-Kanal 0..15 (9 = GM-Drums). */
  channel: number;
  note: number;
  velocity: number;
  /** Absoluter Tick ab Dateianfang — NICHT quantisiert, NICHT modulo. */
  tick: number;
  /** Länge in Ticks bis zum passenden Note-Off; `null` wenn keins gefunden. */
  durationTicks: number | null;
}

/** Was in einem Track steckt — Grundlage für die Track-Auswahl in der UI. */
export interface MidiTrackInfo {
  index: number;
  /** Aus Meta-Event 0x03 (Track Name); leer, wenn keiner gesetzt ist. */
  name: string;
  /** Alle Kanäle, auf denen dieser Track Noten sendet (aufsteigend). */
  channels: number[];
  noteCount: number;
  /** Erster/letzter Noten-Tick in diesem Track (`null` wenn leer). */
  firstTick: number | null;
  lastTick: number | null;
}

export interface MidiTimeSignature {
  numerator: number;
  denominator: number;
}

export interface DetailedMidiFile {
  bpm: number | null;
  ticksPerQuarterNote: number;
  totalTicks: number;
  /** Taktart aus Meta-Event 0x58; Vorgabe 4/4, wenn die Datei keine angibt. */
  timeSignature: MidiTimeSignature;
  /** `true`, wenn die Taktart aus der Datei stammt (sonst Vorgabe). */
  timeSignatureFromFile: boolean;
  notes: DetailedMidiNote[];
  tracks: MidiTrackInfo[];
}

// ─── Interne Helfer ───────────────────────────────────────────────────────────

function readUint32(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] << 24) |
      (data[offset + 1] << 16) |
      (data[offset + 2] << 8) |
      data[offset + 3]) >>>
    0
  );
}

function readUint16(data: Uint8Array, offset: number): number {
  return ((data[offset] << 8) | data[offset + 1]) & 0xffff;
}

/**
 * Dekodiert einen Variable-Length-Quantity-Wert (VLQ).
 * VLQ: jedes Byte enthält 7 Nutzbits; MSB=1 → weitere Bytes folgen.
 */
function readVlq(
  data: Uint8Array,
  offset: number,
): { value: number; bytesRead: number } {
  let value = 0;
  let bytesRead = 0;
  let b: number;
  do {
    if (bytesRead >= 4) {
      throw new Error("VLQ-Wert überschreitet maximale Länge von 4 Bytes");
    }
    b = data[offset + bytesRead];
    value = (value << 7) | (b & 0x7f);
    bytesRead++;
  } while (b & 0x80);
  return { value, bytesRead };
}

/**
 * Quantisiert einen absoluten Tick-Zeitstempel auf einen 16-Step-Index.
 * Formel: stepIndex = round((tick / tpq) × (16 / 4)) mod 16
 * → 4 Steps pro Viertelrnote, 16 Steps pro Takt (ein Takt = 4 Beats).
 */
function quantizeToStep(tick: number, ticksPerQuarterNote: number): number {
  return Math.round((tick / ticksPerQuarterNote) * 4) % 16;
}

// ─── Haupt-Parser ─────────────────────────────────────────────────────────────

/**
 * Parst eine SMF-Datei (Uint8Array) und gibt alle GM-Drum-Noten zurück.
 *
 * @throws Error wenn Magic-Bytes fehlen, Format nicht Type 0/1 ist,
 *               oder SMPTE-Zeitbasis erkannt wird.
 */
export function parseMidiFile(data: Uint8Array): ParsedMidiFile {
  // ── Header-Chunk validieren ──────────────────────────────────────────────
  if (
    data.length < 14 ||
    data[0] !== 0x4d ||
    data[1] !== 0x54 ||
    data[2] !== 0x68 ||
    data[3] !== 0x64
  ) {
    throw new Error(
      "Ungültige MIDI-Datei: MThd-Magic-Bytes fehlen oder Datei zu kurz",
    );
  }

  const headerLength = readUint32(data, 4);
  if (headerLength < 6) {
    throw new Error(
      "Ungültige MIDI-Datei: Header-Chunk-Länge kleiner als 6 Bytes",
    );
  }

  const format = readUint16(data, 8);
  if (format > 1) {
    throw new Error(
      `Nicht unterstütztes MIDI-Format: ${format}. Nur Type 0 und Type 1 werden unterstützt.`,
    );
  }

  const numTracks = readUint16(data, 10);
  const timeDivision = readUint16(data, 12);

  // SMPTE-Zeitbasis (MSB gesetzt) wird nicht unterstützt
  if (timeDivision & 0x8000) {
    throw new Error(
      "SMPTE-Zeitbasis wird nicht unterstützt; nur PPQN (Ticks/Quarternote)",
    );
  }
  if (timeDivision === 0) {
    throw new Error(
      "Ungültige MIDI-Datei: ticksPerQuarterNote ist 0",
    );
  }

  const ticksPerQuarterNote = timeDivision;

  // ── Tracks parsen ─────────────────────────────────────────────────────────
  let chunkOffset = 8 + headerLength; // Erste Position nach dem Header-Chunk
  let bpm: number | null = null;
  const notes: ParsedMidiNote[] = [];
  let totalTicks = 0;
  let parsedTracks = 0;

  while (chunkOffset + 8 <= data.length && parsedTracks < numTracks) {
    // MTrk-Magic prüfen
    if (
      data[chunkOffset] !== 0x4d ||
      data[chunkOffset + 1] !== 0x54 ||
      data[chunkOffset + 2] !== 0x72 ||
      data[chunkOffset + 3] !== 0x6b
    ) {
      // Unbekannter Chunk-Typ → überspringen
      const unknownLength = readUint32(data, chunkOffset + 4);
      chunkOffset += 8 + unknownLength;
      continue;
    }

    const trackLength = readUint32(data, chunkOffset + 4);
    const trackStart = chunkOffset + 8;
    const trackEnd = trackStart + trackLength;

    let pos = trackStart;
    let currentTick = 0;
    let runningStatus = 0;

    while (pos < trackEnd && pos < data.length) {
      // Delta-Zeit lesen
      const { value: delta, bytesRead: deltaBytes } = readVlq(data, pos);
      pos += deltaBytes;
      currentTick += delta;

      if (pos >= trackEnd) break;
      const firstByte = data[pos];

      if (firstByte === 0xff) {
        // ── Meta-Event ──────────────────────────────────────────────────────
        pos++; // 0xFF konsumieren
        const metaType = data[pos++];
        const { value: metaLength, bytesRead: metaLenBytes } = readVlq(
          data,
          pos,
        );
        pos += metaLenBytes;

        if (metaType === 0x51 && metaLength === 3 && pos + 2 < data.length) {
          // Set Tempo: 3 Bytes µs/Beat
          const microsPerBeat =
            (data[pos] << 16) | (data[pos + 1] << 8) | data[pos + 2];
          if (microsPerBeat > 0) {
            bpm = Math.round(60_000_000 / microsPerBeat);
          }
        }

        pos += metaLength;
        // Meta-Events unterbrechen Running Status nicht im praktischen Einsatz,
        // aber per Spec sicherheitshalber beibehalten.
      } else if (firstByte === 0xf0 || firstByte === 0xf7) {
        // ── SysEx-Event ─────────────────────────────────────────────────────
        pos++;
        const { value: sysexLength, bytesRead: sysexLenBytes } = readVlq(
          data,
          pos,
        );
        pos += sysexLenBytes + sysexLength;
        runningStatus = 0;
      } else {
        // ── Channel-Message ──────────────────────────────────────────────────
        let status: number;

        if (firstByte & 0x80) {
          // Explizites Status-Byte
          status = firstByte;
          runningStatus = status;
          pos++;
        } else {
          // Running Status: firstByte ist bereits das erste Daten-Byte
          if (runningStatus === 0) {
            // Fehlerhafter Stream ohne Running Status → Byte überspringen
            pos++;
            continue;
          }
          status = runningStatus;
          // pos NICHT erhöhen – firstByte wird als d1 gelesen
        }

        const messageType = (status >> 4) & 0x0f;
        const channel = status & 0x0f;

        // Nachrichten mit zwei Daten-Bytes: Note Off (8), Note On (9),
        // Aftertouch (A), Control Change (B), Pitch Bend (E)
        if (
          messageType === 0x8 ||
          messageType === 0x9 ||
          messageType === 0xa ||
          messageType === 0xb ||
          messageType === 0xe
        ) {
          const d1 = data[pos++];
          const d2 = data[pos++];

          // Note-On auf Channel 9 (= MIDI-Channel 10, GM-Drum-Channel)
          // Velocity 0 gilt als Note-Off → ignorieren
          if (messageType === 0x9 && channel === 9 && d2 > 0) {
            const stepIndex = quantizeToStep(currentTick, ticksPerQuarterNote);
            notes.push({ note: d1, stepIndex, velocity: d2 });
          }
        } else if (messageType === 0xc || messageType === 0xd) {
          // Program Change (C), Channel Aftertouch (D): ein Daten-Byte
          pos++;
        }
        // System-Messages (0xF*) mit MSB gesetzt wurden bereits oben abgefangen
      }

      if (currentTick > totalTicks) {
        totalTicks = currentTick;
      }
    }

    chunkOffset = trackEnd;
    parsedTracks++;
  }

  return { bpm, ticksPerQuarterNote, totalTicks, notes, trackCount: parsedTracks };
}

// ─── Detaillierter Parser (v3.303) ───────────────────────────────────────────

const DEFAULT_TIME_SIGNATURE: MidiTimeSignature = { numerator: 4, denominator: 4 };

/**
 * Parst eine SMF-Datei **ohne** zu quantisieren oder zu verwerfen.
 *
 * Unterschiede zu {@link parseMidiFile}:
 *  - alle Kanäle, nicht nur 9 (Melodie-Spuren gehen sonst verloren)
 *  - absoluter Tick pro Note statt `stepIndex % 16` (Takte bleiben erhalten)
 *  - Track-Index + Track-Name, damit die Oberfläche Spuren anbieten kann
 *  - Taktart aus Meta 0x58 — ohne sie ist „Takt 3 bis 8" nicht berechenbar
 *  - Note-Off-Paarung für Längen (die E2-Gate-Länge braucht sie)
 *
 * @throws Error bei fehlendem MThd, Format > 1 oder SMPTE-Zeitbasis.
 */
export function parseMidiFileDetailed(data: Uint8Array): DetailedMidiFile {
  if (
    data.length < 14 ||
    data[0] !== 0x4d || data[1] !== 0x54 || data[2] !== 0x68 || data[3] !== 0x64
  ) {
    throw new Error(
      "Ungültige MIDI-Datei: MThd-Magic-Bytes fehlen oder Datei zu kurz",
    );
  }
  const headerLength = readUint32(data, 4);
  if (headerLength < 6) {
    throw new Error("Ungültige MIDI-Datei: Header-Chunk-Länge kleiner als 6 Bytes");
  }
  const format = readUint16(data, 8);
  if (format > 1) {
    throw new Error(
      `Nicht unterstütztes MIDI-Format: ${format}. Nur Type 0 und Type 1 werden unterstützt.`,
    );
  }
  const numTracks = readUint16(data, 10);
  const timeDivision = readUint16(data, 12);
  if (timeDivision & 0x8000) {
    throw new Error("SMPTE-Zeitbasis wird nicht unterstützt; nur PPQN (Ticks/Quarternote)");
  }
  if (timeDivision === 0) {
    throw new Error("Ungültige MIDI-Datei: ticksPerQuarterNote ist 0");
  }
  const ticksPerQuarterNote = timeDivision;

  let chunkOffset = 8 + headerLength;
  let bpm: number | null = null;
  let timeSignature = DEFAULT_TIME_SIGNATURE;
  let timeSignatureFromFile = false;
  let totalTicks = 0;
  const notes: DetailedMidiNote[] = [];
  const tracks: MidiTrackInfo[] = [];
  let trackIndex = 0;

  while (chunkOffset + 8 <= data.length && trackIndex < numTracks) {
    if (
      data[chunkOffset] !== 0x4d || data[chunkOffset + 1] !== 0x54 ||
      data[chunkOffset + 2] !== 0x72 || data[chunkOffset + 3] !== 0x6b
    ) {
      chunkOffset += 8 + readUint32(data, chunkOffset + 4);
      continue;
    }
    const trackLength = readUint32(data, chunkOffset + 4);
    const trackStart = chunkOffset + 8;
    const trackEnd = trackStart + trackLength;

    let pos = trackStart;
    let currentTick = 0;
    let runningStatus = 0;
    let trackName = "";
    const trackChannels = new Set<number>();
    let trackNotes = 0;
    let firstTick: number | null = null;
    let lastTick: number | null = null;

    // Offene Note-Ons je (Kanal, Note) — für die Längenberechnung. Mehrfache
    // Note-Ons derselben Tonhöhe ohne Off dazwischen kommen vor; dann gilt das
    // jüngste (Stack), was dem Verhalten der meisten Sequencer entspricht.
    const open = new Map<number, number[]>();
    const keyOf = (ch: number, n: number) => ch * 128 + n;

    while (pos < trackEnd && pos < data.length) {
      const { value: delta, bytesRead: deltaBytes } = readVlq(data, pos);
      pos += deltaBytes;
      currentTick += delta;
      if (pos >= trackEnd) break;
      const firstByte = data[pos];

      if (firstByte === 0xff) {
        pos++;
        const metaType = data[pos++];
        const { value: metaLength, bytesRead: metaLenBytes } = readVlq(data, pos);
        pos += metaLenBytes;
        if (metaType === 0x51 && metaLength === 3 && pos + 2 < data.length) {
          const microsPerBeat = (data[pos] << 16) | (data[pos + 1] << 8) | data[pos + 2];
          if (microsPerBeat > 0) bpm = Math.round(60_000_000 / microsPerBeat);
        } else if (metaType === 0x58 && metaLength >= 2 && pos + 1 < data.length) {
          // Time Signature: numerator, denominator als Zweierpotenz-Exponent.
          const num = data[pos];
          const denPow = data[pos + 1];
          if (num > 0 && denPow <= 6) {
            timeSignature = { numerator: num, denominator: 1 << denPow };
            timeSignatureFromFile = true;
          }
        } else if (metaType === 0x03 && metaLength > 0) {
          let s = "";
          for (let i = 0; i < metaLength && pos + i < data.length; i++) {
            const c = data[pos + i];
            if (c >= 0x20 && c < 0x7f) s += String.fromCharCode(c);
          }
          if (!trackName) trackName = s.trim();
        }
        pos += metaLength;
      } else if (firstByte === 0xf0 || firstByte === 0xf7) {
        pos++;
        const { value: sysexLength, bytesRead: sysexLenBytes } = readVlq(data, pos);
        pos += sysexLenBytes + sysexLength;
        runningStatus = 0;
      } else {
        let status: number;
        if (firstByte & 0x80) {
          status = firstByte;
          runningStatus = status;
          pos++;
        } else {
          if (runningStatus === 0) {
            pos++;
            continue;
          }
          status = runningStatus;
        }
        const messageType = (status >> 4) & 0x0f;
        const channel = status & 0x0f;

        if (
          messageType === 0x8 || messageType === 0x9 || messageType === 0xa ||
          messageType === 0xb || messageType === 0xe
        ) {
          const d1 = data[pos++];
          const d2 = data[pos++];
          const isNoteOn = messageType === 0x9 && d2 > 0;
          // Velocity 0 auf Note-On gilt als Note-Off — verbreitete Kodierung.
          const isNoteOff = messageType === 0x8 || (messageType === 0x9 && d2 === 0);

          if (isNoteOn) {
            trackChannels.add(channel);
            trackNotes++;
            if (firstTick === null) firstTick = currentTick;
            lastTick = currentTick;
            notes.push({
              trackIndex, channel, note: d1, velocity: d2,
              tick: currentTick, durationTicks: null,
            });
            const k = keyOf(channel, d1);
            const stack = open.get(k);
            if (stack) stack.push(notes.length - 1);
            else open.set(k, [notes.length - 1]);
          } else if (isNoteOff) {
            const stack = open.get(keyOf(channel, d1));
            const idx = stack?.pop();
            if (idx !== undefined) {
              notes[idx].durationTicks = Math.max(0, currentTick - notes[idx].tick);
            }
          }
        } else if (messageType === 0xc || messageType === 0xd) {
          pos++;
        }
      }
      if (currentTick > totalTicks) totalTicks = currentTick;
    }

    tracks.push({
      index: trackIndex,
      name: trackName,
      channels: [...trackChannels].sort((a, b) => a - b),
      noteCount: trackNotes,
      firstTick,
      lastTick,
    });

    chunkOffset = trackEnd;
    trackIndex++;
  }

  // Noten in zeitlicher Reihenfolge — Type-1-Dateien liefern sie trackweise,
  // und ein Aufrufer, der nach Position gruppiert, erwartet Sortierung.
  notes.sort((a, b) => a.tick - b.tick || a.trackIndex - b.trackIndex || a.note - b.note);

  return {
    bpm, ticksPerQuarterNote, totalTicks,
    timeSignature, timeSignatureFromFile,
    notes, tracks,
  };
}
