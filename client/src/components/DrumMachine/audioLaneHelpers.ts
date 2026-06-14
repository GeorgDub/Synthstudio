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

// ─── TASK-252: Global-Transport-Kopplung ─────────────────────────────────────

/**
 * Effektiver "spielt"-Zustand einer Audio-Clip-Lane.
 *
 * Eine Lane gilt als spielend, wenn ENTWEDER der globale Transport läuft
 * (Global-Play startet via Engine alle registrierten Audio-Tracks parallel zum
 * Step-Sequencer) ODER der lokale per-Lane Vorhör-Play aktiv ist.
 *
 * Vorher war der Lane-`playing`-State rein component-local — Global-Play/Stop
 * wurde nicht reflektiert (Button-Label falsch, Playhead eingefroren). Diese
 * reine Funktion ist die kanonische OR-Verknüpfung; sie wird in AudioClipLane
 * mit dem (per Engine-Seam abonnierten) globalen Play-State und dem lokalen
 * useState gespeist.
 *
 * Defensive: nicht-boolesche Eingaben werden truthy-koerziert; das Resultat ist
 * immer ein echter boolean.
 */
export function shouldLaneFollowGlobalTransport(
  globalPlaying: boolean,
  laneLocalPlaying: boolean,
): boolean {
  return !!globalPlaying || !!laneLocalPlaying;
}

/**
 * `true` wenn der per-Lane Play/Stop-Button gesperrt sein soll.
 *
 * Produkt-Entscheidung (TASK-252): Während der globale Transport läuft, gewinnt
 * er die Anzeige + den Playhead der Lane. Der per-Lane-Button würde sonst
 * widersprüchlich werden (er stoppt nur EINE Source, der effektive Zustand
 * bliebe aber "spielend" weil global noch läuft → Button springt zurück). Daher
 * wird der Toggle während Global-Play deaktiviert (No-Op) und dient nur dem
 * isolierten Vorhören solange der globale Transport gestoppt ist.
 */
export function isLaneTransportToggleLocked(globalPlaying: boolean): boolean {
  return !!globalPlaying;
}

/** Re-export des kanonischen Track-Typs für Consumer dieser Datei. */
export type { AudioTrackChannelData };
