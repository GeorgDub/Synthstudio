/**
 * Synthstudio – audioLanePosition.ts (TASK-258)
 *
 * Neutrales Blattmodul (utils-Schicht) für die rein-numerische Berechnung der
 * normalisierten Wiedergabeposition `pos01` einer Audio-Clip-Lane.
 *
 * Hierher extrahiert aus components/DrumMachine/audioLaneHelpers.ts, um eine
 * Schicht-Inversion aufzulösen: die Audio-Engine (audio-Schicht) braucht diese
 * reine Formel und darf nicht in die components-Schicht greifen. Dieses Modul
 * hat KEINE Abhängigkeiten (kein React, kein AudioContext, keine Stores) und ist
 * damit ein zulässiges Blatt, das sowohl von audio/ als auch components/ und
 * Tests konsumiert werden kann.
 *
 * audioLaneHelpers.ts re-exportiert die Symbole für bestehende Consumer.
 */

/**
 * Eingabe für {@link computeAudioTrackPos01}. Bewusst eine flache, primitive-
 * only-Struktur (kein AudioContext / kein BufferSourceNode), damit die Berechnung
 * in Node (Vitest) ohne Web-Audio-Runtime deterministisch testbar ist.
 *
 * - `ctxStart`/`currentTime`/`offsetSec`/`rate` spiegeln exakt die Felder die der
 *   Position-rAF in AudioEngine nutzt (`sec = offsetSec + (currentTime-ctxStart)*rate`).
 * - `startMeta` darf `null` sein (Track nicht gestartet) → Ergebnis 0.
 */
export interface AudioTrackPosInput {
  /** Wiedergabe-Metadaten oder null, wenn der Track nicht (mehr) spielt. */
  startMeta: { ctxStart: number; offsetSec: number } | null | undefined;
  /** `ctx.currentTime` zum Abfragezeitpunkt. */
  currentTime: number;
  /** Effektive playbackRate (inkl. evtl. Time-Stretch-Ratio). */
  rate: number;
  /** Buffer-Dauer in Sekunden (>0). */
  durationSec: number;
  /** Ob der Track loopt (Modulo statt Clamp). */
  loop?: boolean;
}

/**
 * Berechnet die normalisierte Wiedergabeposition `pos01` ∈ [0, 1) eines Audio-
 * Tracks SYNCHRON aus dem aktuellen Engine-Zustand — ohne auf den nächsten
 * rAF-Frame zu warten.
 *
 * Hintergrund (TASK-252-FOLLOWUP): Wechselt man auf den Sequencer-Tab während der
 * globale Transport bereits läuft, mountet die Lane spät. Der Position-rAF wird
 * zwar bei Late-Subscribe gestartet (onAudioTrackPosition), liefert den ersten
 * Wert aber erst beim nächsten Frame → der Playhead blitzt sichtbar bei 0 auf.
 * Mit diesem reinen Helfer kann die Lane (bzw. `getAudioTrackPosition`) den Wert
 * sofort beim Mount seeden.
 *
 * Identische Formel wie der rAF-Tick in AudioEngine (Buffer-Source-Pfad), damit
 * Snapshot und Stream nicht divergieren.
 *
 * Defensive: fehlendes `startMeta`, nicht-finite Eingaben oder `durationSec<=0`
 * → 0 (Track gilt als nicht-spielend/unbekannt).
 */
export function computeAudioTrackPos01(input: AudioTrackPosInput): number {
  const { startMeta, currentTime, rate, durationSec, loop } = input;
  if (!startMeta) return 0;
  const dur = durationSec > 0 && Number.isFinite(durationSec) ? durationSec : 0;
  if (dur <= 0) return 0;
  const r = Number.isFinite(rate) ? rate : 1;
  const elapsed = currentTime - startMeta.ctxStart;
  if (!Number.isFinite(elapsed)) return 0;
  const sec = startMeta.offsetSec + elapsed * r;
  let pos01 = sec / dur;
  if (!Number.isFinite(pos01)) return 0;
  if (loop) {
    pos01 = ((pos01 % 1) + 1) % 1;
  } else {
    pos01 = Math.min(1, Math.max(0, pos01));
  }
  return pos01;
}
