/**
 * Synthstudio – tempoMap.ts (v3.95.0)
 *
 * Pure-Resolver fuer Tempo-Map / BPM-Automation.
 * Keine React-Abhaengigkeit, voll unit-testbar.
 *
 * Algorithm:
 *  - Leere Map → null (Caller verwendet Fallback-BPM)
 *  - 1 Event mit atBar <= position → konstant dessen BPM
 *  - Mehrere Events:
 *      - Position vor dem ersten Event → null (Fallback)
 *      - Position nach dem letzten Event → BPM des letzten Events
 *      - Position zwischen prev und next:
 *          - next.ramp === true → lineare Interpolation prev.bpm → next.bpm
 *          - sonst → hard-change: prev.bpm bis < next.atBar, ab >= next.atBar dann next.bpm
 *
 * "Ramp" gehoert zum Ziel-Event (next), nicht zum Quell-Event (prev) — wie in
 * Logic Pro / Bitwig Tempo-Map: man markiert das Ziel als ramp.
 */
import type { TempoEvent } from "../store/useTempoMapStore";

/**
 * Liefert das BPM an der gegebenen Bar-Position.
 *
 * @param events Bar-sortierte (oder unsortierte) Liste an Tempo-Events.
 * @param atBar Aktuelle Position in Bars (Float OK fuer Sub-Bar-Position).
 * @returns BPM-Zahl, oder null wenn keine Events vorhanden / vor dem ersten.
 */
export function getCurrentBpm(events: TempoEvent[], atBar: number): number | null {
  if (!events || events.length === 0) return null;
  if (!Number.isFinite(atBar)) return null;

  // Defensiv: lokale Sort-Kopie. Store sortiert zwar bereits, aber der Resolver
  // soll robust sein (Tests / externe Caller).
  const sorted = [...events].sort((a, b) => a.atBar - b.atBar);

  // Position vor dem allerersten Event → null (Fallback-BPM nutzen)
  if (atBar < sorted[0].atBar) return null;

  // Letztes Event finden, dessen atBar <= position
  let prevIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].atBar <= atBar) prevIdx = i;
    else break;
  }

  if (prevIdx < 0) return null;
  const prev = sorted[prevIdx];
  const next = sorted[prevIdx + 1];

  // Kein folgendes Event → konstant prev.bpm
  if (!next) return prev.bpm;

  // Wenn das naechste Event "ramp" markiert ist, interpolieren wir linear
  // zwischen prev und next.
  if (next.ramp === true) {
    const span = next.atBar - prev.atBar;
    if (span <= 0) return next.bpm;
    const t = (atBar - prev.atBar) / span;
    const clampedT = Math.max(0, Math.min(1, t));
    return prev.bpm + clampedT * (next.bpm - prev.bpm);
  }

  // Hard-change: bis < next.atBar gilt prev.bpm.
  // (Der Caller fragt typischerweise mit position < next.atBar, weil bei
  // position >= next.atBar wuerde prevIdx auf next gezeigt haben.)
  return prev.bpm;
}

/**
 * Convenience: liefert das BPM oder den fallback-Wert wenn die Map leer ist
 * bzw. die Position noch vor dem ersten Event liegt.
 */
export function getCurrentBpmOrFallback(
  events: TempoEvent[],
  atBar: number,
  fallbackBpm: number
): number {
  const resolved = getCurrentBpm(events, atBar);
  return resolved === null ? fallbackBpm : resolved;
}

/**
 * Round-Trip-Helper fuer .synth-Schema v1.35.
 * Sanitisiert + serialisiert eine Liste an Events fuer JSON-Persistenz.
 */
export function serializeTempoEvents(events: TempoEvent[]): TempoEvent[] {
  return [...events]
    .filter((e) => e && Number.isFinite(e.atBar) && Number.isFinite(e.bpm))
    .map((e) => ({
      atBar: e.atBar,
      bpm: e.bpm,
      ...(e.ramp === true ? { ramp: true } : {}),
    }))
    .sort((a, b) => a.atBar - b.atBar);
}

/**
 * Round-Trip-Helper: liest eine Events-Liste aus dem .synth-File.
 * Filtert invalide Eintraege weg.
 */
export function parseTempoEvents(input: unknown): TempoEvent[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      (e: unknown): e is TempoEvent =>
        !!e &&
        typeof e === "object" &&
        typeof (e as TempoEvent).atBar === "number" &&
        typeof (e as TempoEvent).bpm === "number"
    )
    .map((e: TempoEvent) => ({
      atBar: e.atBar,
      bpm: e.bpm,
      ramp: e.ramp === true,
    }))
    .sort((a, b) => a.atBar - b.atBar);
}
