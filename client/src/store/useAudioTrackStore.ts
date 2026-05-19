/**
 * Synthstudio – useAudioTrackStore.ts
 *
 * State-Management für externe Audio-Track-Channels (Vocals, Songs zum Remixen).
 *
 * - Persistenz als Pfad-Referenz in der .synth-Datei (über projectSerializer)
 * - localStorage-Fallback solange kein Projekt geladen ist (Key: `synthstudio:audiotracks:v1`)
 * - Custom Observer Store (Module-Singleton + Listener-Set), KEIN Zustand-npm-Package
 * - Maximal `MAX_AUDIO_TRACKS` (= 8) Tracks gleichzeitig
 *
 * Runtime-only State (broken-Flag, durationSec, peaks) wird NICHT persistiert.
 * Er wird in einer separaten Map gehalten und bei reload/restore zurückgesetzt.
 *
 * ─── TYP-OWNERSHIP ────────────────────────────────────────────────────────────
 * `AudioTrackChannelData` lebt als Single-Source-of-Truth in AudioEngine.ts
 * (dort hängen die Engine-Methoden registerAudioTrack/setAudioTracksGetter
 * direkt an dem Shape). Dieses Modul re-exportiert den Typ nur, damit
 * bestehende Importpfade (`@/store/useAudioTrackStore`) unverändert bleiben.
 *
 * Bei Schema-Erweiterungen: NUR in AudioEngine.ts ändern, alle Consumer
 * folgen automatisch (TASK-109 / v1.18-Cleanup).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useReducer } from "react";
import { nanoid } from "nanoid";
import type { AudioTrackChannelData } from "@/audio/AudioEngine";
import { normalizeChannelColor } from "@/utils/channelColors";

// ─── Typen ───────────────────────────────────────────────────────────────────

/**
 * Re-Export aus AudioEngine.ts. Die kanonische Definition lebt dort.
 * Bei Schema-Änderungen: AudioEngine.ts editieren – nicht hier.
 */
export type { AudioTrackChannelData };

/**
 * Runtime-only State pro Track. NICHT persistiert.
 * - broken: Datei konnte nicht geladen werden (z.B. Pfad ungültig nach Project-Reload)
 * - durationSec: ermittelt von AudioEngine nach Decode
 * - peaks: Wellenform-Peaks für Display (Float32Array)
 */
export interface AudioTrackRuntimeState {
  broken: boolean;
  durationSec?: number;
  peaks?: Float32Array;
}

// ─── Konstanten ──────────────────────────────────────────────────────────────

export const MAX_AUDIO_TRACKS = 8;
/**
 * Maximale Anzahl gleichzeitiger Tracks mit `syncMode === "timestretch"`.
 * Begründung: AudioWorklet-OLA ist deutlich teurer als `playbackRate` (CPU-Schutz).
 * UI sollte die Option ab diesem Limit deaktivieren (mit Tooltip).
 */
export const MAX_TIMESTRETCH_TRACKS = 4;
const STORAGE_KEY = "synthstudio:audiotracks:v1";
const ID_PREFIX = "audiotrack:";

// ─── Persistierter State ─────────────────────────────────────────────────────

let _tracks: AudioTrackChannelData[] = loadFromStorage();

// Runtime-only Map (NICHT in localStorage / .synth)
const _runtime: Map<string, AudioTrackRuntimeState> = new Map();

type Listener = () => void;
const _listeners = new Set<Listener>();
function notify(): void {
  _listeners.forEach((l) => l());
}

// ─── Persistence Helpers ─────────────────────────────────────────────────────

function loadFromStorage(): AudioTrackChannelData[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidTrack).slice(0, MAX_AUDIO_TRACKS);
  } catch {
    return [];
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_tracks));
  } catch {
    // Quota voll / nicht verfügbar – ignorieren
  }
}

/** Validiert ein einzelnes Track-Objekt strukturell. */
function isValidTrack(t: unknown): t is AudioTrackChannelData {
  if (!t || typeof t !== "object") return false;
  const o = t as Record<string, unknown>;
  // syncMode (optional) muss – wenn gesetzt – einer der erlaubten Strings sein.
  // Alte v1.16-Files ohne Feld bleiben gültig (undefined). Migration: kein
  // Auto-Upgrade von "stretch" → "timestretch" (User-Entscheidung).
  if (o.syncMode !== undefined && o.syncMode !== null) {
    if (
      o.syncMode !== "free" &&
      o.syncMode !== "stretch" &&
      o.syncMode !== "timestretch"
    ) {
      return false;
    }
  }
  // v3.52.0 (v1.22): stretchRatio/pitchLocked/bpmHint sind alle optional.
  // Wenn gesetzt müssen sie den richtigen Typ haben — invalid → Track verwerfen.
  if (o.stretchRatio !== undefined && typeof o.stretchRatio !== "number") return false;
  if (o.pitchLocked !== undefined && typeof o.pitchLocked !== "boolean") return false;
  if (o.bpmHint !== undefined && typeof o.bpmHint !== "number") return false;
  // v3.70.0 (v1.26): Loop-Engine-Wiring. Alle drei optional, bei falschem Typ
  // → Track verwerfen.
  if (o.loopEnabled !== undefined && typeof o.loopEnabled !== "boolean") return false;
  if (
    o.loopStartSample !== undefined &&
    o.loopStartSample !== null &&
    typeof o.loopStartSample !== "number"
  ) {
    return false;
  }
  if (
    o.loopEndSample !== undefined &&
    o.loopEndSample !== null &&
    typeof o.loopEndSample !== "number"
  ) {
    return false;
  }
  // v3.72.0 (v1.27): Loop-Crossfade-Länge (ms). Optional, bei falschem Typ
  // → Track verwerfen.
  if (o.loopCrossfadeMs !== undefined && typeof o.loopCrossfadeMs !== "number") return false;
  // v3.74.0 (v1.29): Channel-Strip Color (Hex). Optional, bei falschem Typ
  // → Track verwerfen. Hex-Validierung (Format) passiert nicht hier.
  if (o.color !== undefined && typeof o.color !== "string") return false;
  return (
    typeof o.id === "string" &&
    o.id.startsWith(ID_PREFIX) &&
    typeof o.name === "string" &&
    typeof o.filePath === "string" &&
    typeof o.fileName === "string" &&
    typeof o.volume === "number" &&
    typeof o.pan === "number" &&
    typeof o.muted === "boolean" &&
    typeof o.soloed === "boolean" &&
    o.sends !== null &&
    typeof o.sends === "object" &&
    typeof (o.sends as { reverb?: unknown }).reverb === "number" &&
    typeof (o.sends as { delay?: unknown }).delay === "number"
  );
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fügt einen neuen Audio-Track hinzu.
 * @throws Error wenn bereits `MAX_AUDIO_TRACKS` Tracks existieren.
 * @returns Die generierte ID im Format `audiotrack:<nanoid>`.
 */
export function addAudioTrack(data: Omit<AudioTrackChannelData, "id">): string {
  if (_tracks.length >= MAX_AUDIO_TRACKS) {
    throw new Error(
      `Maximum number of audio tracks reached (${MAX_AUDIO_TRACKS}).`,
    );
  }
  const id = `${ID_PREFIX}${nanoid()}`;
  const track: AudioTrackChannelData = { id, ...data };
  _tracks = [..._tracks, track];
  persist();
  notify();
  return id;
}

/** Entfernt einen Audio-Track + runtime-state. No-op wenn ID unbekannt. */
export function removeAudioTrack(id: string): void {
  const next = _tracks.filter((t) => t.id !== id);
  if (next.length === _tracks.length) return;
  _tracks = next;
  _runtime.delete(id);
  persist();
  notify();
}

/** Patcht nur die angegebenen Felder. ID kann NICHT geändert werden. */
export function updateAudioTrack(
  id: string,
  patch: Partial<AudioTrackChannelData>,
): void {
  const idx = _tracks.findIndex((t) => t.id === id);
  if (idx < 0) return;
  // ID darf nicht überschrieben werden
  const { id: _ignoredId, ...safePatch } = patch;
  void _ignoredId;
  const updated: AudioTrackChannelData = { ..._tracks[idx], ...safePatch };
  _tracks = [..._tracks.slice(0, idx), updated, ..._tracks.slice(idx + 1)];
  persist();
  notify();
}

// ─── v3.52.0: Manual Stretch Actions ────────────────────────────────────────

/** Clamp wie der TimeStretchProcessor-Param (0.25..4.0). */
const STRETCH_MIN = 0.25;
const STRETCH_MAX = 4.0;

/** Pure-fn: clampt eine Stretch-Ratio in den erlaubten Bereich. NaN/Inf → 1.0. */
export function clampStretchRatio(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1.0;
  return Math.max(STRETCH_MIN, Math.min(STRETCH_MAX, v));
}

/**
 * v3.52.0: Setzt den manuellen Stretch-Faktor (0.25..4.0).
 * 1.0 = Original-Geschwindigkeit. Werte ausserhalb werden geclamped.
 */
export function setTrackStretchRatio(id: string, ratio: number): void {
  const safe = clampStretchRatio(ratio);
  updateAudioTrack(id, { stretchRatio: safe });
}

/**
 * v3.52.0: Setzt den Pitch-Lock-Flag. true → Worklet (Pitch erhalten),
 * false → Resample (Pitch+Tempo gekoppelt).
 */
export function setTrackPitchLocked(id: string, locked: boolean): void {
  updateAudioTrack(id, { pitchLocked: !!locked });
}

/**
 * v3.52.0: Setzt den User-detektierten Original-BPM-Hint (für autoWarp).
 * Bei null/0/negativen Werten wird das Feld entfernt (undefined).
 */
export function setTrackBpmHint(id: string, bpm: number | null): void {
  if (bpm === null || !Number.isFinite(bpm) || bpm <= 0) {
    updateAudioTrack(id, { bpmHint: undefined });
    return;
  }
  updateAudioTrack(id, { bpmHint: bpm });
}

// ─── v3.70.0: Loop-Point Actions ─────────────────────────────────────────────

/**
 * v3.70.0: Setzt den `loopEnabled`-Flag des Tracks. Engine ignoriert den
 * Loop-Range solange das Flag nicht true ist (UI-State bleibt erhalten,
 * damit User Enable/Disable togglen kann ohne die Marker zu verlieren).
 */
export function setTrackLoopEnabled(id: string, enabled: boolean): void {
  updateAudioTrack(id, { loopEnabled: !!enabled });
}

/**
 * v3.70.0: Setzt loopStartSample + loopEndSample in einer einzelnen Action.
 * Defensive: NaN/Infinity → null (unset). Wenn end ≤ start, wird die
 * Eingabe in-place getauscht damit Loops nie negative Länge haben. null
 * wird explizit unterstützt (User klärt einen Marker).
 */
export function setTrackLoopPoints(
  id: string,
  loopStartSample: number | null,
  loopEndSample: number | null,
): void {
  const ns = sanitizeLoopSample(loopStartSample);
  const ne = sanitizeLoopSample(loopEndSample);
  // Wenn beide gesetzt und end ≤ start → swap (defensive UI-Input).
  if (ns !== null && ne !== null && ne <= ns) {
    updateAudioTrack(id, { loopStartSample: ne, loopEndSample: ns });
    return;
  }
  updateAudioTrack(id, { loopStartSample: ns, loopEndSample: ne });
}

function sanitizeLoopSample(v: number | null): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isFinite(v) || v < 0) return null;
  return Math.floor(v);
}

// ─── v3.72.0: Loop-Crossfade Action ──────────────────────────────────────────

/**
 * v3.72.0: Maximaler Crossfade in ms an der Loop-Boundary. Werte > 200ms
 * werden geclamped — Crossfade > 200ms macht akustisch keinen Sinn und
 * würde bei kurzen Loops > halbe Range werden. Engine clampt zusätzlich
 * gegen `loopRange / 2` zur Laufzeit.
 */
export const LOOP_CROSSFADE_MAX_MS = 200;

/** Pure-fn: clampt eine Crossfade-Länge (ms) in [0, 200]. NaN/Inf/negativ → 0. */
export function clampLoopCrossfadeMs(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.min(LOOP_CROSSFADE_MAX_MS, v);
}

/**
 * v3.72.0: Setzt die Loop-Boundary-Crossfade-Länge in Millisekunden (0..200).
 * 0 = hard cut (backward-compat zu v3.71). > 0 = smooth equal-power fade
 * an loopStart/loopEnd. Closes v3.71-Caveat "harter Cut bei loopEnd → loopStart".
 */
export function setTrackLoopCrossfadeMs(id: string, ms: number): void {
  const safe = clampLoopCrossfadeMs(ms);
  updateAudioTrack(id, { loopCrossfadeMs: safe });
}

// ─── v3.74.0: Channel-Strip Color (closes v3.73-Caveat) ──────────────────────

/**
 * v3.74.0: Setzt die Color eines Audio-Tracks. closes v3.73-Caveat — vorher
 * konnten nur Drum/Synth-Parts colorized werden, AudioTrack-Strips fehlte
 * der Picker.
 *
 * - Valider Hex (#RRGGBB oder #RGB) → lowercase gespeichert
 * - undefined → Reset auf Palette-Default (color-Feld wird entfernt)
 * - Invalider Wert → silent als undefined behandelt (defensive Reset,
 *   keine Exception)
 *
 * No-op wenn Track-ID unbekannt oder identischer State.
 */
export function setAudioTrackColor(id: string, color: string | undefined): void {
  const idx = _tracks.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const existing = _tracks[idx];
  const normalized = color === undefined ? undefined : normalizeChannelColor(color);
  if ((existing.color ?? undefined) === normalized) return;
  const { color: _omit, ...rest } = existing;
  void _omit;
  const next: AudioTrackChannelData =
    normalized === undefined
      ? (rest as AudioTrackChannelData)
      : ({ ...rest, color: normalized } as AudioTrackChannelData);
  _tracks = [..._tracks.slice(0, idx), next, ..._tracks.slice(idx + 1)];
  persist();
  notify();
}

/**
 * v3.52.0: Pure-fn die die nötige stretchRatio berechnet damit ein Track mit
 * Source-BPM `sourceBpm` zum `projectBpm` warpt. null wenn kein valid hint.
 */
export function computeWarpRatio(
  projectBpm: number,
  sourceBpm: number | null | undefined,
): number | null {
  if (!sourceBpm || !Number.isFinite(sourceBpm) || sourceBpm <= 0) return null;
  if (!projectBpm || !Number.isFinite(projectBpm) || projectBpm <= 0) return null;
  return clampStretchRatio(projectBpm / sourceBpm);
}

/**
 * v3.52.0: Berechnet stretchRatio aus `projectBpm / bpmHint` und setzt sie auf
 * den Track. Fällt auf `originalBpm` zurück wenn kein `bpmHint` gesetzt ist
 * (Backward-Compat — User kann den existing originalBpm-Eintrag direkt warpen).
 * Returnt die effektive ratio oder null wenn keine Quelle vorhanden.
 */
export function autoWarpToBpm(id: string, projectBpm: number): number | null {
  const track = getAudioTrack(id);
  if (!track) return null;
  const source = track.bpmHint ?? track.originalBpm ?? null;
  const ratio = computeWarpRatio(projectBpm, source);
  if (ratio === null) return null;
  updateAudioTrack(id, { stretchRatio: ratio });
  return ratio;
}

// ─── v3.53.0: UI-Polish Helpers ──────────────────────────────────────────────

/**
 * Snap-Threshold für den logarithmischen Stretch-Slider:
 * Werte innerhalb dieses Abstands von 1.0 werden auf exakt 1.0 gesnappt.
 * UX-Effekt: Reset-Button bleibt sauber deaktivierbar (vorher: 0.999 hielt ihn aktiv).
 * 0.05 = 5% — gross genug für komfortablen Snap, klein genug um nicht in den
 * Nutzbereich zu schneiden (1.0 ± 5% = 0.95..1.05).
 */
export const STRETCH_SNAP_THRESHOLD = 0.05;

/**
 * v3.53.0: Snap-zu-1.0 für den Stretch-Slider.
 * Wenn der Wert in [1 - threshold, 1 + threshold] liegt → exakt 1.0.
 * Sonst wird der Wert unverändert (aber clamped 0.25..4.0) zurückgegeben.
 * Pure-fn — keine Store-Mutation.
 */
export function snapStretchRatio(
  value: number,
  threshold = STRETCH_SNAP_THRESHOLD,
): number {
  if (!Number.isFinite(value) || value <= 0) return 1.0;
  if (Math.abs(value - 1.0) < threshold) return 1.0;
  return clampStretchRatio(value);
}

/**
 * v3.53.0: Berechnet die *effektive* Playback-Rate eines Tracks bei aktuellem
 * Projekt-BPM. Kombiniert BPM-Sync (projectBpm / originalBpm) × manualStretch.
 *
 * - syncMode = 'free' oder kein originalBpm → nur stretchRatio
 * - syncMode = 'stretch' | 'timestretch' mit originalBpm → bpmRate × stretchRatio
 *
 * Wert wird auf [0.25, 4.0] geclamped wie es die Engine intern auch tut.
 * Returnt { rate, clamped, bpmRate } für UI-Anzeige (Warning-Icon wenn clamped).
 */
export interface EffectiveStretchRate {
  rate: number;
  bpmRate: number;
  manualRatio: number;
  clamped: boolean;
}

export function computeEffectiveStretchRate(
  projectBpm: number,
  originalBpm: number | null | undefined,
  syncMode: "free" | "stretch" | "timestretch" | undefined,
  stretchRatio: number | undefined,
): EffectiveStretchRate {
  const manualRatio =
    Number.isFinite(stretchRatio) && (stretchRatio as number) > 0
      ? (stretchRatio as number)
      : 1.0;

  let bpmRate = 1.0;
  if (
    (syncMode === "stretch" || syncMode === "timestretch") &&
    Number.isFinite(originalBpm) &&
    (originalBpm as number) > 0 &&
    Number.isFinite(projectBpm) &&
    projectBpm > 0
  ) {
    bpmRate = projectBpm / (originalBpm as number);
  }

  const raw = bpmRate * manualRatio;
  const clampedRate = Math.max(STRETCH_MIN, Math.min(STRETCH_MAX, raw));
  const clamped = Math.abs(clampedRate - raw) > 1e-6;

  return {
    rate: Number.isFinite(clampedRate) ? clampedRate : 1.0,
    bpmRate,
    manualRatio,
    clamped,
  };
}

// ─── v3.53.0: Auto-BPM-Detection ─────────────────────────────────────────────

/**
 * v3.53.0: Confidence-Threshold für automatische `bpmHint`-Setzung beim
 * Track-Add. Liegt der Worker-Result-Confidence unter dieser Schwelle, wird
 * der detected BPM NICHT auto-gesetzt — UI darf den Wert dim anzeigen aber
 * nicht persistieren. 0.5 ist Branchenkompromiss (≥0.5 = "wahrscheinlich
 * rhythmisch", <0.5 = "zu unsicher um den User zu nerven").
 */
export const AUTO_BPM_CONFIDENCE_THRESHOLD = 0.5;

export interface AutoBpmDetectionResult {
  bpm: number;
  confidence: number;
  applied: boolean;
}

/**
 * v3.53.0: Pure-fn die entscheidet ob ein BPM-Detection-Result aufs Track
 * angewendet werden soll. Returnt { bpm, confidence, applied } für UI-Toast.
 * Wird vom Auto-BPM-Hook (siehe MixerView ingestAudioFile) aufgerufen.
 *
 * Defensive: NaN/Infinity/0/negative bpm → applied=false, confidence < threshold
 * → applied=false (UI darf dim-display anzeigen aber nicht setzen).
 */
export function shouldApplyAutoBpm(
  bpm: number,
  confidence: number,
  threshold = AUTO_BPM_CONFIDENCE_THRESHOLD,
): AutoBpmDetectionResult {
  const validBpm =
    Number.isFinite(bpm) && bpm > 0 && bpm < 1000 ? bpm : 0;
  const validConf = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0;
  const applied = validBpm > 0 && validConf >= threshold;
  return { bpm: validBpm, confidence: validConf, applied };
}

/**
 * v3.53.0: Wendet ein Auto-BPM-Detection-Result auf einen Track an,
 * wenn die Confidence ausreicht. Returnt das Detection-Result für UI-Toast.
 * NO-OP wenn Track unbekannt oder confidence < threshold.
 */
export function applyAutoBpmToTrack(
  id: string,
  bpm: number,
  confidence: number,
  threshold = AUTO_BPM_CONFIDENCE_THRESHOLD,
): AutoBpmDetectionResult {
  const result = shouldApplyAutoBpm(bpm, confidence, threshold);
  if (!result.applied) return result;
  const track = getAudioTrack(id);
  if (!track) return { ...result, applied: false };
  // Nur setzen wenn kein User-eingegebener bpmHint existiert (kein Overwrite).
  if (track.bpmHint !== undefined && track.bpmHint > 0) {
    return { ...result, applied: false };
  }
  updateAudioTrack(id, { bpmHint: result.bpm });
  return result;
}

// ─── Solo (FOLLOWUP-102-3) ──────────────────────────────────────────────────

/**
 * Setzt den Solo-Status eines Audio-Tracks (FOLLOWUP-102-3).
 * @param exclusive Default `false` (additiv — toggle nur diesen Track,
 *                  andere bleiben unverändert; DAW-Konvention).
 *                  `true` = exclusive (Radio-Button — un-solo't alle anderen).
 *                  UI: Click = additive (current), Shift+Click = exclusive.
 *
 * Hinweis: setzt nur das `soloed`-Flag auf den Track-Daten. Das tatsächliche
 * Stummschalten passiert in AudioEngine._reapplyAudioTrackSoloMutes (via
 * setAudioTrackSolo, das nach diesem Store-Update via App.tsx synced wird).
 */
export function setAudioTrackSoloed(
  id: string,
  soloed: boolean,
  exclusive = false,
): void {
  const idx = _tracks.findIndex((t) => t.id === id);
  if (idx < 0) return;
  _tracks = _tracks.map((t, i) => {
    if (i === idx) return { ...t, soloed };
    // exclusive=true: un-solo alle anderen. exclusive=false (default): bleiben.
    return exclusive ? { ...t, soloed: false } : t;
  });
  persist();
  notify();
}

/** Gibt einen Track per ID zurück oder null wenn unbekannt. */
export function getAudioTrack(id: string): AudioTrackChannelData | null {
  return _tracks.find((t) => t.id === id) ?? null;
}

/** Snapshot aller Tracks (defensive Kopie). */
export function getAllAudioTracks(): AudioTrackChannelData[] {
  return _tracks.slice();
}

/**
 * Anzahl der Tracks mit `syncMode === "timestretch"`.
 * UI nutzt das, um die Time-Stretch-Option in weiteren Tracks zu deaktivieren
 * wenn `MAX_TIMESTRETCH_TRACKS` erreicht ist (CPU-Schutz).
 */
export function countTimestretchTracks(): number {
  let n = 0;
  for (const t of _tracks) {
    if (t.syncMode === "timestretch") n++;
  }
  return n;
}

/**
 * Convenience-Helper: `true` wenn das `MAX_TIMESTRETCH_TRACKS`-Limit erreicht
 * (oder überschritten) ist. UI-Komponenten nutzen das für Banner-/Counter-
 * Sichtbarkeit ohne den Counter erneut zu zählen.
 */
export function isTimestretchLimitReached(): boolean {
  return countTimestretchTracks() >= MAX_TIMESTRETCH_TRACKS;
}

/**
 * Ersetzt den gesamten State (verwendet von projectSerializer beim Projekt-Load).
 * Filtert invalide Items + cappt auf MAX_AUDIO_TRACKS.
 * Setzt runtime-state komplett zurück.
 */
export function loadAudioTracks(tracks: AudioTrackChannelData[]): void {
  const valid = (tracks ?? []).filter(isValidTrack).slice(0, MAX_AUDIO_TRACKS);
  _tracks = valid;
  _runtime.clear();
  persist();
  notify();
}

/** Leert sämtliche Audio-Tracks (z.B. bei "Neues Projekt"). */
export function clear(): void {
  if (_tracks.length === 0 && _runtime.size === 0) return;
  _tracks = [];
  _runtime.clear();
  persist();
  notify();
}

/**
 * Setzt/Löscht das runtime-only `broken`-Flag eines Tracks.
 * NICHT persistiert.
 */
export function markBroken(id: string, broken: boolean): void {
  const existing = _runtime.get(id) ?? { broken: false };
  const next: AudioTrackRuntimeState = { ...existing, broken };
  _runtime.set(id, next);
  notify();
}

/** Setzt Duration + Peaks (von AudioEngine nach Decode). NICHT persistiert. */
export function setRuntimeWaveform(
  id: string,
  durationSec: number,
  peaks?: Float32Array,
): void {
  const existing = _runtime.get(id) ?? { broken: false };
  _runtime.set(id, { ...existing, durationSec, peaks });
  notify();
}

/** Liest runtime-state (broken/duration/peaks). Defaults zu broken:false wenn unbekannt. */
export function getRuntimeState(id: string): AudioTrackRuntimeState {
  return _runtime.get(id) ?? { broken: false };
}

/**
 * Reset für Tests. Nicht für Produktiv-Code gedacht.
 * @internal
 */
export function __resetForTests(): void {
  _tracks = [];
  _runtime.clear();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  notify();
}

// ─── React Hook ──────────────────────────────────────────────────────────────

export interface AudioTrackStoreApi {
  tracks: AudioTrackChannelData[];
  add: (data: Omit<AudioTrackChannelData, "id">) => string;
  remove: (id: string) => void;
  update: (id: string, patch: Partial<AudioTrackChannelData>) => void;
  get: (id: string) => AudioTrackChannelData | null;
  getRuntime: (id: string) => AudioTrackRuntimeState;
  markBroken: (id: string, broken: boolean) => void;
}

/**
 * React-Hook: Observer-Pattern mit `useReducer` für rerender-Trigger.
 * Returnt einen Snapshot + die Public Mutation API.
 */
export function useAudioTrackStore(): AudioTrackStoreApi {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => {
      _listeners.delete(rerender);
    };
  }, []);
  return {
    tracks: _tracks,
    add: addAudioTrack,
    remove: removeAudioTrack,
    update: updateAudioTrack,
    get: getAudioTrack,
    getRuntime: getRuntimeState,
    markBroken,
  };
}
