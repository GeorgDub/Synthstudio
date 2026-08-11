/**
 * Diagnose-Log — Datei-Senke.
 *
 * Schreibt den Ereignisstrom als JSONL weg. Das ist der Teil, den der
 * Bedienende weiterreicht; das Panel zeigt live dasselbe, aber lange Ketten
 * passen auf keinen Screenshot.
 *
 * Die Senke zieht nach laufender Nummer nach — sie hängt nicht am Puffer,
 * sondern merkt sich, bis wohin sie gekommen ist. Verwirft der Ringpuffer
 * zwischendurch etwas, wird das als Fehlerzeile MITGESCHRIEBEN. Eine Datei mit
 * stiller Lücke ist schlimmer als eine mit Fehlermeldung: sie sieht vollständig
 * aus.
 */
import type { TraceLog, TraceEvent } from "./traceLog";

export interface FileSinkOptions {
  /** Hängt Text an die Sitzungsdatei an. Wirft im Fehlerfall. */
  schreibe: (text: string) => Promise<void>;
}

export interface FileSink {
  /** Schreibt alles Neue weg. Wirft nie. */
  flush(): Promise<void>;
  /** Startet das regelmässige Wegschreiben. Gibt den Stopper zurück. */
  start(intervalMs?: number): () => void;
}

export function createFileSink(
  log: TraceLog,
  opts: FileSinkOptions
): FileSink {
  let letzte = 0;
  let gemeldeteLuecke = 0;

  const flush = async (): Promise<void> => {
    try {
      const neu = log.recent().filter(e => e.seq > letzte);
      const zeilen: string[] = [];

      // Verworfenes zuerst melden — die Meldung gehört VOR die Ereignisse,
      // zwischen denen die Lücke klafft.
      const verworfen = log.droppedCount();
      if (verworfen > gemeldeteLuecke) {
        zeilen.push(
          JSON.stringify({
            seq: letzte,
            kind: "error",
            src: "fileSink",
            msg:
              `${verworfen - gemeldeteLuecke} Ereignisse vom Ringpuffer ` +
              `verworfen, bevor sie geschrieben werden konnten — hier fehlt etwas`,
          })
        );
        gemeldeteLuecke = verworfen;
      }

      for (const e of neu) zeilen.push(JSON.stringify(e as TraceEvent));
      if (zeilen.length === 0) return;
      if (neu.length > 0) letzte = neu[neu.length - 1].seq;
      await opts.schreibe(zeilen.join("\n") + "\n");
    } catch {
      // Ein Schreibfehler darf weder die Bedienung noch das Panel mitreissen —
      // das Log läuft im Speicher weiter.
    }
  };

  return {
    flush,
    start(intervalMs = 500) {
      const id = setInterval(() => void flush(), intervalMs);
      return () => {
        clearInterval(id);
        void flush(); // was seit dem letzten Takt kam, geht sonst verloren
      };
    },
  };
}
