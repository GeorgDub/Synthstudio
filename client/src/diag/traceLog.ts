/**
 * Diagnose-Log — Kern.
 *
 * Ein Ringpuffer mit lückenloser laufender Nummer. Die Nummer ist die Wahrheit
 * über die Reihenfolge; Zeitstempel allein reichen nicht, weil zwei Ereignisse
 * in derselben Millisekunde nicht unterscheidbar wären.
 *
 * Verdrängte Einträge hinterlassen eine sichtbare Lücke in den Nummern. Ein
 * Puffer, der neu durchnummeriert, machte aus einem Verlust eine lückenlose
 * Lüge — und die Datei-Senke hätte kein Mittel, den Verlust zu melden.
 *
 * Entwurf: `docs/superpowers/specs/2026-08-11-diagnose-log-design.md`
 */

export type TraceKind = "click" | "midi-out" | "midi-in" | "step" | "error";

/** Was ein Aufrufer beisteuert. */
export interface TraceInput {
  kind: TraceKind;
  /** Wer das Ereignis erzeugt hat, z. B. `HacktribeRamTransfer.readRam`. */
  src: string;
  /** Die Deutung — lesbar, aber immer nur eine Deutung. */
  msg: string;
  /** Klammert eine Kette (Klick → Frame → Antwort → Ergebnis). */
  corr?: string;
  /** Roher Rahmen als Hex. Der Beleg neben der Deutung. */
  hex?: string;
}

/** Was im Puffer landet. */
export interface TraceEvent extends TraceInput {
  seq: number;
}

export interface TraceLogOptions {
  /** Wie viele Ereignisse im Speicher gehalten werden. */
  capacity: number;
}

export interface TraceLog {
  push(input: TraceInput): TraceEvent;
  recent(): TraceEvent[];
  /** Wie viele Ereignisse der Puffer verworfen hat. */
  droppedCount(): number;
  /**
   * Eröffnet eine neue Kette und gibt ihre Kennung zurück. Alle folgenden
   * Ereignisse ohne eigenes `corr` hängen daran.
   *
   * ☠ Bewusst eine laufende „aktuelle Kette" statt einer sauberen
   * Ablaufverfolgung über `await` hinweg: im Browser gibt es kein
   * AsyncLocalStorage. Überlappen zwei Vorgänge, landen ihre Ereignisse in
   * derselben Kette. Die laufende Nummer bleibt trotzdem lückenlos, die
   * Reihenfolge geht also nie verloren — nur die Zuordnung wird unscharf.
   */
  beginChain(): string;
  currentChain(): string | null;
}

export function createTraceLog(options: TraceLogOptions): TraceLog {
  const capacity = Math.max(1, Math.floor(options.capacity));
  const buffer: TraceEvent[] = [];
  let seq = 0;
  let dropped = 0;
  let chain = 0;
  let currentChain: string | null = null;

  return {
    push(input: TraceInput): TraceEvent {
      seq += 1;
      const event: TraceEvent = {
        ...input,
        seq,
        corr: input.corr ?? currentChain ?? undefined,
      };
      buffer.push(event);
      if (buffer.length > capacity) {
        buffer.shift();
        dropped += 1;
      }
      return event;
    },
    recent(): TraceEvent[] {
      return [...buffer];
    },
    droppedCount(): number {
      return dropped;
    },
    beginChain(): string {
      chain += 1;
      currentChain = `c${chain}`;
      return currentChain;
    },
    currentChain(): string | null {
      return currentChain;
    },
  };
}
