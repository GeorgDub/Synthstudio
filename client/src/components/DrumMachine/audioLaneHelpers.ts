/**
 * Synthstudio – audioLaneHelpers.ts (TASK-246)
 *
 * Pure, Node-testbare Render-Logik für die Continuous-Audio-Clip-Lanes im
 * Sequencer (Option B — durchgehende Wellenform-Lane statt Step-Grid).
 *
 * Bewusst KEINE React-/Canvas-Abhängigkeiten hier — diese Helpers bilden die
 * Daten-Schicht (welche Tracks → Lanes, Solo/Mute-Audibility), damit sie ohne
 * jsdom/AudioContext in Vitest abgedeckt werden können (siehe
 * tests/features/audio-clip-lane.test.ts).
 *
 * Die UI-Komponente (AudioClipLane.tsx) konsumiert diese Funktionen nur.
 */
import type { AudioTrackChannelData } from "@/audio/AudioEngine";

/**
 * Minimal-Shape eines Tracks, soweit die Lane-Resolution ihn braucht.
 * Wir akzeptieren bewusst nur die Felder die wir lesen, damit die Helpers
 * auch in Tests mit Teil-Objekten benutzbar bleiben.
 */
export interface AudioLaneTrackLike {
  id: string;
  muted: boolean;
  soloed: boolean;
}

/**
 * Liefert die Tracks, die als Lane gerendert werden sollen.
 *
 * Aktuell ist jeder im Store vorhandene Audio-Track eine Lane (Option B:
 * 1 Track = 1 Continuous-Clip-Lane). Defensiv: null/undefined → []; Items
 * ohne `id` werden verworfen (kein React-Key möglich).
 *
 * Eigene Funktion (statt inline `.map`), damit die "welche Tracks ergeben
 * Lanes"-Regel testbar ist und später erweiterbar bleibt (z.B. versteckte
 * Lanes).
 */
export function resolveAudioLanes<T extends AudioLaneTrackLike>(
  tracks: readonly T[] | null | undefined,
): T[] {
  if (!Array.isArray(tracks)) return [];
  return tracks.filter(
    (t): t is T => !!t && typeof t.id === "string" && t.id.length > 0,
  );
}

/**
 * `true` wenn mindestens ein Audio-Track soloed ist (Solo-Gruppe aktiv).
 * Audio-Track-Solo ist eine EIGENE Solo-Gruppe — unabhängig von Drum-Part-Solo
 * (bewusste Produkt-Entscheidung, siehe AudioTrackStrip / FOLLOWUP-102-3).
 */
export function anyAudioTrackSoloed(
  tracks: readonly AudioLaneTrackLike[] | null | undefined,
): boolean {
  if (!Array.isArray(tracks)) return false;
  return tracks.some((t) => !!t && t.soloed === true);
}

/**
 * Audibility-Resolution für einen einzelnen Track im Kontext aller Tracks.
 *
 * DAW-Konvention:
 *  - Wenn IRGENDEIN Track soloed ist → nur nicht-gemutete soloed Tracks klingen.
 *  - Wenn KEIN Track soloed ist → alle nicht-gemuteten Tracks klingen.
 *
 * Reine Funktion (kein Store-Zugriff). Die tatsächliche Stummschaltung passiert
 * in der Engine (`setAudioTrackMute`/`setAudioTrackSolo` +
 * `_reapplyAudioTrackSoloMutes`); dieser Helper bildet die Logik nur für UI-
 * Indikatoren (z.B. "dim"-Darstellung einer Lane) und Tests ab.
 */
export function isAudioLaneAudible(
  track: AudioLaneTrackLike,
  allTracks: readonly AudioLaneTrackLike[] | null | undefined,
): boolean {
  if (!track) return false;
  if (track.muted) return false;
  if (anyAudioTrackSoloed(allTracks)) {
    return track.soloed === true;
  }
  return true;
}

/**
 * Liefert die CSS-Token-Klasse für die Lane-Beschriftung, abhängig von
 * broken/muted/soloed — analog zu AudioTrackStrip.labelColor. Nur semantische
 * `--ss-*`-Tokens (keine hardcodierten Tailwind-Farben).
 *
 * Reihenfolge der Priorität: broken > muted > soloed > default.
 */
export function audioLaneLabelColorClass(opts: {
  broken: boolean;
  muted: boolean;
  soloed: boolean;
}): string {
  if (opts.broken) return "text-accent-danger";
  if (opts.muted) return "text-text-dim";
  if (opts.soloed) return "text-accent-primary";
  return "text-text-primary";
}

// ─── TASK-267: Per-Lane-Transport entkoppelt vom Global-Transport ────────────

/**
 * Berechnet den lokalen `playing`-State einer Audio-Lane/-Strips, wenn sich der
 * globale Transport ändert (oder beim Mount synchron aus `AudioEngine.isPlaying`).
 *
 * Semantik (TASK-267): Global-Play startet via Engine
 * `playAllRegisteredAudioTracks()` jede Lane, ABER nur wenn sie weder gemutet
 * noch broken ist (gemutete Tracks werden übersprungen, bufferlose können nicht
 * starten). Damit der lokale `playing`-State WAHRHAFTIG widerspiegelt, was die
 * Engine tatsächlich tut:
 *  - globalPlaying === true  → `true` NUR wenn !muted && !broken
 *  - globalPlaying === false → `false` (Global-Stop killt ALLE Voices)
 *
 * Dadurch macht der nächste manuelle Button-Klick das Richtige (Stop statt
 * Re-Start), und eine mid-playback gemountete Lane zeigt sofort den korrekten
 * Zustand. Reine Funktion → Node-testbar (siehe
 * tests/features/audio-track-play-stop.test.ts).
 *
 * Defensive: nicht-boolesche Eingaben werden truthy-koerziert; Resultat immer
 * echter boolean.
 */
export function laneStateOnGlobalChange(
  globalPlaying: boolean,
  opts: { muted: boolean; broken: boolean },
): boolean {
  return globalPlaying ? !opts.muted && !opts.broken : false;
}

// ─── TASK-252: Global-Transport-Kopplung (DEPRECATED ab TASK-267) ────────────
// Diese beiden Helper koppelten den per-Lane-Button an den globalen Transport
// (effektiv-OR + Toggle-Lock während Global-Play). TASK-267 entkoppelt den
// Button bewusst: jede Lane ist nun unabhängig vom globalen Transport start-/
// stoppbar (User-Anforderung „separat im Sequenzer gestartet und gestoppt").
// Die Funktionen bleiben exportiert (bestehende Tests/Consumer importieren sie),
// werden aber von den Komponenten NICHT mehr verwendet. NICHT löschen.

/**
 * @deprecated Seit TASK-267 nicht mehr von den Komponenten verwendet — der
 * per-Lane-Button ist jetzt vom globalen Transport entkoppelt. Bleibt für
 * bestehende Tests/Consumer exportiert. Reine OR-Verknüpfung.
 */
export function shouldLaneFollowGlobalTransport(
  globalPlaying: boolean,
  laneLocalPlaying: boolean,
): boolean {
  return !!globalPlaying || !!laneLocalPlaying;
}

/**
 * @deprecated Seit TASK-267 nicht mehr von den Komponenten verwendet — der
 * per-Lane Play/Stop-Button bleibt während Global-Play ENABLED (entkoppelt).
 * Bleibt für bestehende Tests/Consumer exportiert.
 */
export function isLaneTransportToggleLocked(globalPlaying: boolean): boolean {
  return !!globalPlaying;
}

// ─── TASK-252-FOLLOWUP: synchroner Positions-Snapshot ────────────────────────
// TASK-258: Die reine Positions-Formel `computeAudioTrackPos01` + ihr Input-Typ
// `AudioTrackPosInput` leben jetzt im neutralen Blattmodul
// `@/utils/audioLanePosition` — die Audio-Engine konsumiert sie von dort, ohne in
// die components-Schicht zu greifen (Schicht-Inversion aufgelöst). Hier nur noch
// Re-Export, damit AudioClipLane.tsx + bestehende Tests unverändert weiterlaufen.
export {
  computeAudioTrackPos01,
  type AudioTrackPosInput,
} from "@/utils/audioLanePosition";

/** Re-export des kanonischen Track-Typs für Consumer dieser Datei. */
export type { AudioTrackChannelData };
