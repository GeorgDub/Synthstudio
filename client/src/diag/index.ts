/**
 * Diagnose-Log — Zusammenbau.
 *
 * EINE Stelle, an der Puffer, Taps und Senke zusammenkommen. Panel und Datei
 * lesen denselben Puffer; zwei Quellen wären genau die Fehlerklasse, die am
 * 2026-08-10 eine Sitzung gekostet hat (zwei Knöpfe für denselben Vorgang).
 *
 * ☠ `starteDiagnose()` muss laufen, BEVOR irgendein Modul
 * `requestMIDIAccess` aufruft — deshalb steht der Aufruf in `main.tsx` ganz
 * oben, vor den React-Importen. Ein Tap, der einen Tick zu spät greift,
 * verpasst still, welcher Pfad zuerst lief, und das läse sich später als
 * „dieser Pfad sendet gar nichts".
 */
import { createTraceLog, type TraceLog } from "./traceLog";
import { installMidiTap } from "./midiTap";
import { installClickTap } from "./clickTap";
import { createFileSink } from "./fileSink";

/** Der Puffer der laufenden Sitzung. Von überall lesbar, u. a. vom Panel. */
export const diagLog: TraceLog = createTraceLog({ capacity: 5000 });

/** Kennung der Sitzung — geht als Dateiname mit (validiert im Hauptprozess). */
export const diagSitzung = new Date()
  .toISOString()
  .replace(/[:]/g, "-")
  .replace(/\..+$/, "");

let laeuft = false;

interface DiagBridge {
  diagAppend?: (kennung: string, text: string) => Promise<unknown>;
}

/**
 * Schreibt eine Stufe der Kette ins Log. Für die sechs Diagnose-Pfade
 * (RAM-Lesen/-Schreiben, Pattern-Pull/-Push, Sample-Resolver, Bank-Laden).
 */
export function diagSchritt(src: string, msg: string): void {
  try {
    diagLog.push({ kind: "step", src, msg });
  } catch {
    /* nie den Aufrufer stören */
  }
}

/** Wie {@link diagSchritt}, aber für Fehlschläge. */
export function diagFehler(src: string, msg: string): void {
  try {
    diagLog.push({ kind: "error", src, msg });
  } catch {
    /* nie den Aufrufer stören */
  }
}

/** Startet Taps und Datei-Senke. Mehrfachaufruf ist harmlos. */
export function starteDiagnose(): void {
  if (laeuft) return;
  laeuft = true;
  try {
    installMidiTap(diagLog);
    if (typeof document !== "undefined") installClickTap(diagLog);

    const bridge = (globalThis as { electronAPI?: DiagBridge }).electronAPI;
    if (bridge?.diagAppend) {
      const sink = createFileSink(diagLog, {
        schreibe: text => bridge.diagAppend!(diagSitzung, text).then(() => {}),
      });
      sink.start(500);
    }
    diagLog.push({
      kind: "step",
      src: "diag",
      msg: `Sitzung ${diagSitzung} — Aufzeichnung läuft`,
    });
  } catch {
    /* Ein kaputtes Log darf die App nicht am Starten hindern. */
  }
}
