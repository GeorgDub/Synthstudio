/**
 * Synthstudio – projectSerializer.ts
 *
 * Serialisiert den vollständigen Projekt-State in ein JSON-Objekt (SynthProject)
 * und stellt Lade-Utilities bereit.
 *
 * Format-Version: "1.24"
 *   - "1.15": audioTracks hinzugefügt – v1.14-Dateien laden weiter
 *   - "1.16": scripts hinzugefügt (project-scope, additiv-optional)
 *     v1.15/v1.14-Dateien laden ohne scripts-Feld weiter → defaultet auf [].
 *   - "1.17": padBank hinzugefügt (Custom-Pad-Bank, v2.81).
 *   - "1.18": liveInputs + midiNoteOut + slicePads hinzugefügt (v2.93).
 *     Schließt eine silent-data-loss-Lücke aus v2.85–v2.92, in der diese
 *     Stores ausschließlich in localStorage lebten und beim File-Transport
 *     zwischen Rechnern verloren gingen. Alle drei Felder sind additiv-
 *     optional. Pre-v1.18-Files laden unverändert mit Feldern=undefined.
 *   - "1.19": PatternData.stepCount erweitert um 64 (v3.39, KORG-Parität).
 *     Backward-compatible: v1.18-Files mit stepCount=16/32 laden unverändert.
 *     Pre-v1.19-Files mit stepCount=64 sind impossible (Typ ließ es nicht zu);
 *     v1.19-Files mit stepCount=64 sind in v1.18-Readern ein Type-Mismatch,
 *     werden aber tolerant geladen (parseProject validiert stepCount nicht).
 *   - "1.20": mixer.pluginSlots hinzugefügt (v3.44.0, TASK-239 Phase 1,
 *     AudioWorklet-Plugin-Host). Additive/optional — Pre-v1.20-Files laden
 *     unverändert mit pluginSlots=undefined; parseProject mappt undefined
 *     auf leeres {} im MixerStore (kein silent-data-loss da Mixer ohnehin
 *     ein eigener Persist-Layer ist, das Project-File ist nur ein Snapshot).
 *   - "1.21": mixer.pluginSlots wechselt von Single-Slot pro Channel
 *     (Record<partId, MixerPluginSlot | undefined>) zu Multi-Slot
 *     (Record<partId, MixerPluginSlot[]>, max 4 pro Channel). v3.45.0
 *     Multi-Slot Plugin-Chain. Backward-compat: parseProject migriert
 *     v1.20-Files (single-slot Objects) automatisch in [slot]-Arrays.
 *     Pre-v1.20-Files bleiben unverändert (Feld fehlt → undefined).
 *   - "1.22": AudioTrack erweitert um stretchRatio/pitchLocked/bpmHint
 *     (v3.52.0, manueller Time-Stretch UI für die existing Engine). Alle
 *     drei Felder sind additiv-optional. Pre-v1.22-Tracks ohne diese
 *     Felder laden unverändert (stretchRatio defaultet effektiv auf 1.0
 *     in _calcAudioTrackPlaybackRate, pitchLocked auf false).
 *   - "1.23": Sample erweitert um tags?: string[] (v3.55.0). Closes v3.54
 *     Caveat "Sample-Tags landen nicht im .synth-File". Backward-Compat:
 *     pre-v1.23-Files mit Samples ohne tags-Property → tags bleibt
 *     undefined und wird in getSampleTags() als [] interpretiert.
 *     Validator: Non-String-Entries werden silent gefiltert,
 *     non-Array → tags-Property entfernt (defensive).
 *   - "1.24": projectId hinzugefügt (v3.58.0). Closes v3.57-Caveat
 *     "projectNameToId(projectName) als AutoSave-ID → Rename verliert
 *     History". projectId ist eine stable UUID v4, einmal bei newProject
 *     generiert, immutable, im File persistiert. Backward-Compat:
 *     pre-v1.24-Files ohne projectId → parseProject generiert eine frische
 *     UUID via ensureProjectId() (Auto-Upgrade beim ersten Load). Invalid
 *     projectId (non-string oder kein UUID-v4-Format) → ebenfalls regeneriert.
 *   - "1.25": macros hinzugefügt (v3.69.0). Quick-Action Macros aus
 *     useQuickActionStore werden mit-serialisiert, damit User-Macros beim
 *     File-Transport zwischen Maschinen erhalten bleiben. Closes v3.68
 *     Caveat "Quick-Action Macros sind NICHT teil des .synth-Projektformat".
 *     Backward-Compat: pre-v1.25-Files ohne macros-Feld → parseProject
 *     mappt auf []; restoreProject lässt dann den User-localStorage in
 *     Ruhe (kein Overwrite). Explicit [] wird respektiert (User hat alle
 *     Macros gelöscht und gespeichert). Invalide Einträge werden silent
 *     gefiltert via isValidQuickActionMacro.
 *   - "1.26": AudioTrack loopEnabled/loopStartSample/loopEndSample (v3.70.0).
 *     Closes v3.67-Caveat "Loop-Marker waren visual-only". Engine respektiert
 *     die Loop-Range im AudioBufferSourceNode (.loop=true + loopStart/End in
 *     Sekunden) wenn loopEnabled=true UND start < end. Alle 3 Felder additiv-
 *     optional; pre-v1.26-Files laden unverändert (Engine fällt auf das
 *     legacy `loop`-Flag zurück).
 *   - "1.27": AudioTrack loopCrossfadeMs (v3.72.0). Closes v3.71-Caveat
 *     "harter Cut bei loopEnd → loopStart Click-Artefakte". 0..200ms,
 *     additiv-optional. BufferSource-Pfad mit GainNode + scheduled
 *     setValueCurveAtTime equal-power-Envelope an Loop-Boundary;
 *     Worklet-Pfad mit in-process Sample-Mix (Tail + Head fade).
 *     Backward-Compat: pre-v1.27-Files laden ohne Crash, Feld bleibt
 *     undefined → 0 (hard cut wie vorher).
 *   - "1.28": PartData.color hinzugefügt (v3.73.0). Channel-Strip
 *     Color-Coding für Mixer + DrumMachine (DAW-Standard: Drums rot,
 *     Bass blau etc.). Hex-String ("#RRGGBB" oder "#RGB"), lowercase,
 *     additiv-optional. Pre-v1.28-Files laden unverändert — color bleibt
 *     undefined und die UI fällt auf den zyklischen Palette-Default
 *     zurück (resolveChannelColor in utils/channelColors).
 *     Validierung: invalide color-Strings werden beim Load via
 *     sanitizePartColors silent gestrippt (Part bleibt, nur color=undefined).
 *   - "1.29": AudioTrackChannelData.color + LiveInputChannelData.color
 *     hinzugefügt (v3.74.0). Closes v3.73-Caveat — Color-Coding war nur auf
 *     Drum/Synth-Channels sichtbar. AudioTracks (Vocals/Songs) und
 *     LiveInputs (USB-Audio) bekommen den gleichen ChannelColorPicker.
 *     Beide Felder additiv-optional. Pre-v1.29-Files laden unverändert.
 *     Validierung: invalide color-Strings werden beim Load via
 *     sanitizeAudioTrackColors/sanitizeLiveInputColors silent gestrippt.
 *   - "1.30": masterFx hinzugefügt (v3.75.0). Master-FX-Bus mit globaler
 *     Reverb/Delay/EQ-Konfiguration (decay, damping, preDelay, wet, time,
 *     feedback, EQ-Bands). Closes v3.74-Caveat — bis dahin waren die globalen
 *     Sends (_globalReverbBus, _globalDelayBus) hart codiert ohne User-Control.
 *     Additiv-optional: pre-v1.30-Files haben das Feld nicht → masterFx
 *     bleibt undefined (Signal an Restore: User-localStorage nicht über-
 *     schreiben). Explicit null/non-Object → undefined. Validierung
 *     ist permissiv: sanitizeMasterFx clampt jedes einzelne Feld und
 *     setzt Defaults für Fehlendes ein — verloren geht nichts.
 *   - "1.31": Master-Limiter + Mid-Band-Q (v3.76.0). Additiv-erweitert auf
 *     dem masterFx-Subtree:
 *       - masterFx.limiter {threshold, knee, ratio, release, gain, bypass}
 *         als brick-wall-Limiter am Ende der Master-Chain.
 *       - masterFx.eq.midQ (0.3..10) closes v3.75-Caveat (Q-Param exposable).
 *     Beide Felder additiv-optional. sanitizeMasterFx (im Store) fillt
 *     fehlende Felder mit Defaults — pre-v1.31-Files laden ohne Crash, die
 *     fehlenden Limiter/midQ-Werte werden mit den Defaults gefüllt.
 *   - "1.32": Sub-Mix-Buses (v3.79.0, 100. Release). Channel-Grouping mit
 *     shared FX (DAW-Standard). Max 8 Buses pro Projekt; jeder Bus hat
 *     id/name/color/volume/pan/mute/solo/channelIds[] + optional fx. Channels
 *     ohne Bus default zu master (kein Eintrag in irgendeinem Bus).
 *     Additiv-optional: pre-v1.32-Files haben das Feld nicht → subMixBuses
 *     bleibt undefined (Signal an Restore: User-localStorage nicht über-
 *     schreiben). Explicit `null`/non-Array → undefined. Invalide Bus-Einträge
 *     werden via sanitizeBus silent gefiltert (Cap auf 8 hart enforced).
 * Dateiendung: .synth
 */

import type { Sample } from "@/store/useProjectStore";
import type { PatternData } from "@/audio/AudioEngine";
import type { SongSlot } from "@/store/useSongStore";
import type { MixerState } from "@/store/useMixerStore";
import type { HumanizerState } from "@/store/useHumanizerStore";
import type { AutomationLane } from "@/store/useAutomationStore";
import type { AudioTrackChannelData } from "@/store/useAudioTrackStore";
import type { Script } from "@/store/useScriptStore";
import { isValidScriptEntry } from "@/store/useScriptStore";
import type { PadBankSlot } from "@/utils/padBankPersistence";
import { isValidPadBankSlot } from "@/utils/padBankPersistence";
import type { LiveInputChannelData } from "@/store/useLiveInputStore";
import { isValidChannel as isValidLiveInputChannel } from "@/store/useLiveInputStore";
import type { MidiPartConfig } from "@/audio/MidiNoteOut";
import {
  clampMidiChannel,
  clampMidiNote,
  clampNoteDuration,
  DEFAULT_NOTE_DURATION_MS,
} from "@/audio/MidiNoteOut";
import { ensureProjectId } from "@/utils/projectId";
import type { QuickActionMacro } from "@/store/useQuickActionStore";
import { isValidQuickActionMacro } from "@/store/useQuickActionStore";
import { isValidChannelColor } from "@/utils/channelColors";
import type { MasterFxState } from "@/store/useMasterFxStore";
import { sanitizeMasterFx } from "@/store/useMasterFxStore";
import type { SubMixBus } from "@/store/useSubMixStore";
import { sanitizeBus, MAX_SUB_MIX_BUSES } from "@/store/useSubMixStore";

export const SYNTH_FILE_VERSION = "1.32";
export const SYNTH_LATEST_KEY = "synthstudio:last-project";

// ─── Typen ───────────────────────────────────────────────────────────────────

export interface SynthProject {
  version:     string;
  /**
   * Stabile UUID v4 — einmal bei `newProject` generiert, immutable für
   * die Lebenszeit des Projekts (auch bei Rename). Wird von AutoSave
   * statt des Project-Name-Slugs verwendet, damit der Versions-Verlauf
   * Rename-resistent ist.
   *
   * Seit v1.24 (Synthstudio v3.58.0). Pre-v1.24-Files haben das Feld
   * nicht → parseProject generiert beim ersten Load eine frische UUID
   * (Auto-Upgrade). Das Feld ist im Type nicht optional, weil
   * parseProject die Backward-Compat-Lücke beim Load schließt.
   */
  projectId:   string;
  projectName: string;
  savedAt:     string;         // ISO-Timestamp
  bpm:         number;
  samples:     Sample[];
  patterns:    PatternData[];
  activePatternId: string;
  song: {
    slots: SongSlot[];
    songModeActive: boolean;
    loopSong: boolean;
  };
  mixer: {
    masterVolume: number;
    channels: MixerState["channels"];
    returnTracks: MixerState["returnTracks"];
    insertChains: MixerState["insertChains"];
    eq16: MixerState["eq16"];
    sidechains: MixerState["sidechains"];
    transientShapers: MixerState["transientShapers"];
    /**
     * v3.44.0 (v1.20) / v3.45.0 (v1.21): Plugin-Slots pro Channel.
     * v1.20: single-slot (Record<partId, MixerPluginSlot | undefined>).
     * v1.21: multi-slot (Record<partId, MixerPluginSlot[]>, max 4).
     * Optional/additiv. Backward-compat: parseProject migriert v1.20-Single
     * automatisch zu [slot]-Array. Pre-v1.20-Files: Feld fehlt → undefined.
     */
    pluginSlots?: MixerState["pluginSlots"];
  };
  humanizer: {
    global: HumanizerState["global"];
  };
  automation: {
    lanes: AutomationLane[];
    stepCount: 16 | 32 | 64;
  };
  /**
   * Externe Audio-Track-Channels (Vocals, Songs zum Remixen).
   * Pfad-Referenz – Datei wird beim Project-Load asynchron resolved/decoded.
   * Seit v1.15. Bei älteren v1.14-Dateien fehlt das Feld → defaultet auf [].
   */
  audioTracks?: AudioTrackChannelData[];
  /**
   * Projekt-lokale Scripts (Skripting + Key/Macro-Bindings).
   * Nur Scripts mit `scope: "project"` werden hier persistiert; app-scope
   * Scripts wohnen ausschließlich in localStorage und folgen NICHT der
   * .synth-Datei zwischen Maschinen.
   *
   * Seit v1.16. Bei älteren v1.15-Dateien fehlt das Feld → defaultet auf [].
   *
   * Sicherheitsregel: Beim Load fremder Projekte werden ALLE geladenen
   * Scripts auf `enabled: false` gesetzt (siehe parseProject). User-Consent
   * ist erforderlich, bevor Code läuft.
   */
  scripts?: Script[];
  /**
   * MIDI Pad-Bank-Setup (Custom-Pad-Bank-Builder, v2.79).
   *
   * Seit v1.17 (Synthstudio v2.81). Bei v1.16 und älter fehlt das Feld
   * → undefined wird als 'don't touch' interpretiert: parseProject ändert
   * dann den User-localStorage NICHT. Explizites [] wird respektiert
   * (User hat alle Slots gelöscht und gespeichert).
   */
  padBank?: PadBankSlot[];

  /**
   * Live-Input-Channels (TASK-233 / v2.85). Persistiert Device-ID, Name,
   * Mixer-Settings, Sends, Latency-Compensation, Record-Arm-Flag.
   *
   * Seit v1.18 (Synthstudio v2.93). Pre-v1.18-Files haben das Feld nicht
   * → liveInputs bleibt undefined (Signal: User-localStorage nicht
   * überschreiben — der User hat sein Setup lokal weiterlaufen). Explizit
   * leeres Array [] wird respektiert (User hat alle Channels gelöscht und
   * gespeichert).
   *
   * CAVEAT: MediaStream wird NICHT persistiert. Beim Load muss
   * AudioEngine.attachLiveInput erneut den Stream über das Device-ID
   * erwerben. Wenn der Rechner gewechselt wurde, ist die Device-ID
   * vermutlich nicht mehr auflösbar → Channel ist da, aber stumm bis User
   * ein neues Input-Device wählt.
   */
  liveInputs?: LiveInputChannelData[];

  /**
   * MIDI-Note-Out-Konfiguration (TASK-240 / v2.92). Pro Drum-Part: outputId,
   * channel, note, duration, localSoundEnabled. + global enabled-Flag.
   *
   * Seit v1.18 (Synthstudio v2.93). Pre-v1.18-Files haben das Feld nicht
   * → midiNoteOut bleibt undefined (Signal: User-localStorage nicht
   * überschreiben).
   *
   * CAVEAT: outputId ist Web-MIDI-spezifisch und ändert sich beim
   * Reconnect / Rechner-Wechsel. Beim Load auf einem anderen Rechner sind
   * die Configs zwar geladen, aber die outputIds matchen keine
   * verfügbaren Geräte → keine MIDI-Nachrichten gehen raus, bis User die
   * Geräte per ChannelInspector neu wählt.
   */
  midiNoteOut?: SerializedMidiNoteOut;

  /**
   * Slice-Pad-Slot-Buffers (TASK-238-FOLLOWUP-1 / v2.90). 16 Pads, jeder
   * Slot trägt optional einen Float32-Mono-Audio-Buffer.
   *
   * Seit v1.18 (Synthstudio v2.93). Pre-v1.18-Files haben das Feld nicht
   * → slicePads bleibt undefined.
   *
   * SCHEMA-ENTSCHEIDUNG: Embed-Full als plain-Number-Array. Begründung:
   * (1) Slice-Buffer sind Session-kritisch — ohne sie sind die Pads leer
   * und der User müsste das Quellsample neu slicen.
   * (2) Wir akzeptieren die File-Größe (16 Slots × ~1MB @ 1s/48kHz = ~16MB
   * raw, JSON ~50MB) als Trade-Off. UI bietet `includeSliceBuffers`-Toggle
   * via serializeProject-Option.
   * (3) Alternative "metadata-only mit Sample-Hash-Rebuild" wurde verworfen
   * — der User-Workflow ist "slice → mute → load again", nicht "slice →
   * save → reload mit selbem Sample im Library". Metadata-only würde
   * silent-data-loss bringen wenn das Quellsample fehlt.
   *
   * Format: Array fester Länge MAX_SLICE_PADS (16). Slots ohne Audio
   * werden als `null` serialisiert (nicht weggelassen — Index-Stabilität).
   */
  slicePads?: SerializedSlicePads;

  /**
   * Quick-Action Macros (User-defined Multi-Action-Shortcuts, v3.68.0).
   * Pro Macro: id, name, optionaler keybind, sequenzielle Action-Liste.
   *
   * Seit v1.25 (Synthstudio v3.69.0). Pre-v1.25-Files haben das Feld
   * nicht → parseProject defaultet auf `undefined` (Signal an
   * restoreProject: "User-localStorage nicht überschreiben"). Explicit
   * leeres Array [] wird respektiert (User hat alle Macros gelöscht
   * und gespeichert).
   *
   * Validation: Invalide Entries werden silent via isValidQuickActionMacro
   * gefiltert (kein Throw bei korruptem Schema).
   */
  macros?: QuickActionMacro[];

  /**
   * Master-FX-Bus Konfiguration (v3.75.0+, v1.30+). Global Reverb (decay,
   * damping, preDelay, wet, bypass), Global Delay (time, feedback, wet,
   * bypass), Master EQ (low/mid/high Gain + low/high Freq + midQ + bypass),
   * v1.31 NEU Master-Limiter (threshold, knee, ratio, release, gain, bypass).
   *
   * Seit v1.30. Pre-v1.30-Files haben das Feld nicht → parseProject lässt
   * masterFx undefined (Signal an Restore: User-localStorage nicht über-
   * schreiben). Explicit null/non-Object → undefined. Sanitizer
   * sanitizeMasterFx clampt jedes Feld und setzt Defaults für Fehlendes.
   */
  masterFx?: MasterFxState;

  /**
   * Sub-Mix-Buses (v3.79.0+, v1.32+). Channel-Grouping mit shared FX (DAW-
   * Standard: gruppier alle Drums in einen Bus, apply Reverb/Compressor
   * einmal auf Group, send to Master). Pro Bus: id/name/color/volume/pan/
   * mute/solo/channelIds[] + optional fx-Snapshot. Max 8 Buses pro Projekt.
   *
   * Seit v1.32. Pre-v1.32-Files haben das Feld nicht → parseProject lässt
   * subMixBuses undefined (Signal an Restore: User-localStorage nicht über-
   * schreiben — der User hat sein Bus-Setup lokal weiterlaufen). Explicit
   * leeres Array [] wird respektiert (User hat alle Buses gelöscht und
   * gespeichert). null oder non-Array → undefined.
   *
   * Channels ohne Bus-Membership routen direkt zu master (additiv-Feature,
   * keine Breaking-Change am bestehenden Channel-Routing).
   */
  subMixBuses?: SubMixBus[];
}

// ─── v1.18 Sub-Types ─────────────────────────────────────────────────────────

export interface SerializedMidiNoteOut {
  enabled: boolean;
  configs: Record<string, MidiPartConfig>;
}

/**
 * Slice-Pad-Slot-Serialisierung. `frames` ist null wenn der Slot leer ist
 * ODER wenn beim Save `includeSliceBuffers: false` gewählt wurde
 * (Metadata-only-Modus). In beiden Fällen wird der Pad-Slot beim Load
 * unbestückt sein.
 */
export interface SerializedSlicePadSlot {
  index: number;
  sampleRate: number;
  sampleName: string;
  sliceIndex: number;
  /** Plain-number-Array (JSON-friendly Float32-Repräsentation), oder null. */
  frames: number[] | null;
}

export type SerializedSlicePads = Array<SerializedSlicePadSlot | null>;

/** Optionen für serializeProject (v2.93). */
export interface SerializeProjectOptions {
  /**
   * Wenn false, werden Slice-Pad-Buffer NICHT in das JSON eingebettet
   * (nur Metadata). Default: true. Bei großen Sessions kann der User
   * das per UI-Toggle abschalten, um die File-Size klein zu halten.
   */
  includeSliceBuffers?: boolean;
}

// ─── Validation Helpers ──────────────────────────────────────────────────────

function isValidAudioTrackEntry(t: unknown): t is AudioTrackChannelData {
  if (!t || typeof t !== "object") return false;
  const o = t as Record<string, unknown>;
  const hasSends =
    o.sends !== null &&
    typeof o.sends === "object" &&
    typeof (o.sends as { reverb?: unknown }).reverb === "number" &&
    typeof (o.sends as { delay?: unknown }).delay === "number";
  // syncMode (optional) muss – wenn gesetzt – einer der erlaubten Strings sein.
  // v1.16-Dateien haben "free"/"stretch", v1.19+ zusätzlich "timestretch".
  // Migration: kein Auto-Upgrade – alte syncModes bleiben erhalten.
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
  // Bei falschem Typ → Track verwerfen (defensive).
  if (o.stretchRatio !== undefined && typeof o.stretchRatio !== "number") return false;
  if (o.pitchLocked !== undefined && typeof o.pitchLocked !== "boolean") return false;
  if (o.bpmHint !== undefined && typeof o.bpmHint !== "number") return false;
  // v3.70.0 (v1.26): loopEnabled + loopStartSample/loopEndSample. Alle 3
  // additiv-optional. Invalide Typen → Track verwerfen.
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
  // v3.72.0 (v1.27): loopCrossfadeMs (optional, number). Invalider Typ → Track verwerfen.
  if (o.loopCrossfadeMs !== undefined && typeof o.loopCrossfadeMs !== "number") {
    return false;
  }
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.filePath === "string" &&
    o.filePath.length > 0 &&
    typeof o.fileName === "string" &&
    typeof o.volume === "number" &&
    typeof o.pan === "number" &&
    typeof o.muted === "boolean" &&
    typeof o.soloed === "boolean" &&
    hasSends
  );
}

// ─── v1.23 Sample-Tags Sanitizer ─────────────────────────────────────────────

/**
 * v1.23: Sanitiziert die `tags`-Property eines Sample-Eintrags.
 *
 * Regeln (siehe v3.55.0 Schema-Bump):
 *  - Property fehlt komplett (pre-v1.23-Files)             → unverändert (undefined bleibt)
 *  - tags === null                                          → tags-Property wird entfernt
 *  - tags ist kein Array (z.B. string, number, object)      → tags-Property wird entfernt
 *  - tags ist ein Array                                     → non-string Entries werden
 *    silent gefiltert; verbleibende Strings werden ge-trimmed/lowercased + dedupliziert
 *
 * Mutiert das übergebene Objekt in-place und gibt es zurück.
 */
export function sanitizeSampleTags(sample: unknown): unknown {
  if (!sample || typeof sample !== "object") return sample;
  const s = sample as Record<string, unknown>;
  if (!("tags" in s)) return sample;
  const raw = s.tags;
  if (raw === undefined) return sample;
  if (raw === null || !Array.isArray(raw)) {
    delete s.tags;
    return sample;
  }
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const norm = t.trim().toLowerCase();
    if (norm.length === 0 || seen.has(norm)) continue;
    seen.add(norm);
    cleaned.push(norm);
  }
  s.tags = cleaned;
  return sample;
}

// ─── v1.18 Validation Helpers ────────────────────────────────────────────────

function isValidMidiPartConfigEntry(x: unknown): x is MidiPartConfig {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.outputId !== "string" || !o.outputId) return false;
  if (typeof o.channel !== "number") return false;
  if (typeof o.note !== "number") return false;
  if (o.noteDurationMs !== undefined && typeof o.noteDurationMs !== "number") return false;
  if (o.localSoundEnabled !== undefined && typeof o.localSoundEnabled !== "boolean") return false;
  return true;
}

function isValidSerializedSlicePadSlot(x: unknown): x is SerializedSlicePadSlot {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.index !== "number" || !Number.isInteger(o.index) || o.index < 0) return false;
  if (typeof o.sampleRate !== "number" || o.sampleRate <= 0) return false;
  if (typeof o.sampleName !== "string") return false;
  if (typeof o.sliceIndex !== "number") return false;
  // frames darf null sein (leerer Slot oder metadata-only-Save).
  if (o.frames !== null && !Array.isArray(o.frames)) return false;
  return true;
}

// ─── Serialisierung ───────────────────────────────────────────────────────────

export function serializeProject(
  data: Omit<SynthProject, "version" | "savedAt" | "projectId"> & { projectId?: string },
  opts: SerializeProjectOptions = {},
): SynthProject {
  const includeSliceBuffers = opts.includeSliceBuffers ?? true;
  // v3.58.0: projectId ist immer erforderlich im Output — falls der Caller
  // sie nicht mitliefert (Legacy-Tests, Plugin-Code), generieren wir eine
  // frische UUID. Auf dem normalen App-Pfad kommt sie aus useProjectStore.
  const result: SynthProject = {
    version: SYNTH_FILE_VERSION,
    savedAt: new Date().toISOString(),
    projectId: ensureProjectId(data.projectId),
    ...data,
    // Explicit overwrite: ...data spreadet projectId u.U. wieder weg, wenn
    // sie undefined ist; nach dem Spread setzen wir sie noch einmal sicher.
  } as SynthProject;
  result.projectId = ensureProjectId(data.projectId);
  // Metadata-only-Modus: alle slice-pads-frames auf null setzen, Index +
  // sampleName etc. bleiben erhalten damit beim Reload zumindest die
  // Slot-Belegung-Info da ist (für UI-Recovery).
  if (!includeSliceBuffers && result.slicePads) {
    result.slicePads = result.slicePads.map((slot) =>
      slot === null ? null : { ...slot, frames: null },
    );
  }
  return result;
}

/**
 * Konvertiert eine Float32Array in ein plain Number-Array für JSON.
 * Für leere Buffer (null) wird null zurückgegeben.
 */
export function float32ToFrames(buf: Float32Array | null): number[] | null {
  if (!buf) return null;
  // Array.from würde reichen, ist aber ~3× langsamer als manueller Push für
  // große Buffers. Hier reicht Array.from — Slice-Buffers sind selten >5MB.
  return Array.from(buf);
}

/** Umkehr-Helper. null → null. Float-Werte werden NICHT geclamped (lossless). */
export function framesToFloat32(frames: number[] | null): Float32Array | null {
  if (!frames || !Array.isArray(frames)) return null;
  return Float32Array.from(frames);
}

export function toJson(project: SynthProject): string {
  return JSON.stringify(project, null, 2);
}

// ─── v1.28 Sanitizer (Channel-Strip Color-Coding) ────────────────────────────

/**
 * v3.73.0 / v1.28: Strippt invalide `color`-Werte aus PartData (in-place).
 * Valider Hex bleibt erhalten (lowercased), alles andere wird gelöscht damit
 * die UI auf den Palette-Default zurückfällt statt mit invalider Color zu
 * rendern. Pre-v1.28-Parts ohne color-Feld bleiben unverändert.
 */
export function sanitizePartColors(patterns: unknown): void {
  if (!Array.isArray(patterns)) return;
  for (const p of patterns) {
    if (!p || typeof p !== "object") continue;
    const parts = (p as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) continue;
    for (const pt of parts) {
      if (!pt || typeof pt !== "object") continue;
      const o = pt as Record<string, unknown>;
      if (!("color" in o)) continue;
      const raw = o.color;
      if (raw === undefined || raw === null) {
        delete o.color;
        continue;
      }
      if (!isValidChannelColor(raw)) {
        delete o.color;
        continue;
      }
      o.color = (raw as string).toLowerCase();
    }
  }
}

// ─── v1.29 Sanitizer (AudioTrack + LiveInput Color-Coding) ───────────────────

/**
 * v3.74.0 / v1.29: Strippt invalide `color`-Werte aus AudioTrack-Einträgen
 * (in-place). Valider Hex bleibt erhalten (lowercased), alles andere wird
 * gelöscht damit die UI auf den Palette-Default zurückfällt. Pre-v1.29-Tracks
 * ohne color-Feld bleiben unverändert.
 *
 * WICHTIG: arbeitet auf einem rohen unknown-Array (vor isValidAudioTrackEntry),
 * damit invalide color-Strings nicht zum kompletten Verwerfen des Tracks
 * führen — der Track soll geladen werden, nur die Color wird gestrippt.
 */
export function sanitizeAudioTrackColors(tracks: unknown): void {
  if (!Array.isArray(tracks)) return;
  for (const t of tracks) {
    if (!t || typeof t !== "object") continue;
    const o = t as Record<string, unknown>;
    if (!("color" in o)) continue;
    const raw = o.color;
    if (raw === undefined || raw === null) {
      delete o.color;
      continue;
    }
    if (!isValidChannelColor(raw)) {
      delete o.color;
      continue;
    }
    o.color = (raw as string).toLowerCase();
  }
}

/**
 * v3.74.0 / v1.29: Strippt invalide `color`-Werte aus LiveInput-Channel-
 * Einträgen (in-place). Selbe Semantik wie sanitizeAudioTrackColors.
 */
export function sanitizeLiveInputColors(channels: unknown): void {
  if (!Array.isArray(channels)) return;
  for (const c of channels) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    if (!("color" in o)) continue;
    const raw = o.color;
    if (raw === undefined || raw === null) {
      delete o.color;
      continue;
    }
    if (!isValidChannelColor(raw)) {
      delete o.color;
      continue;
    }
    o.color = (raw as string).toLowerCase();
  }
}

// ─── Deserialisierung ─────────────────────────────────────────────────────────

export function parseProject(json: string): SynthProject {
  const data = JSON.parse(json) as SynthProject;
  if (!data.version || !data.patterns) {
    throw new Error("Ungültiges Synthstudio-Projektformat");
  }

  // ─── projectId Migration (seit v1.24) ────────────────────────────────────
  // Pre-v1.24-Files haben kein projectId → ensureProjectId generiert eine
  // frische UUID (Auto-Upgrade). Beim nächsten Save wird sie persistiert.
  // Invalid (non-string oder kein UUID-v4) → ebenfalls regeneriert.
  // Defensive: nie crashen, immer eine valide projectId returnieren.
  data.projectId = ensureProjectId((data as { projectId?: unknown }).projectId);

  // ─── samples[].tags Sanitization (seit v1.23) ────────────────────────────
  // Pre-v1.23-Files: Samples haben kein tags-Feld → bleibt unverändert.
  // v1.23+: tags muss string[] sein. Non-string Entries silent filtern,
  // non-Array → tags-Property entfernen.
  if (Array.isArray(data.samples)) {
    for (const s of data.samples) {
      sanitizeSampleTags(s);
    }
  }

  // ─── patterns[].parts[].color Sanitization (seit v1.28, v3.73.0) ─────────
  // Pre-v1.28-Files: Parts ohne color bleiben unverändert. Invalide color-
  // Werte werden silent gestrippt (UI fällt auf Palette-Default zurück).
  sanitizePartColors(data.patterns);

  // ─── audioTracks (seit v1.15) ────────────────────────────────────────────
  // Alte v1.14-Dateien: Feld fehlt → defaulte auf [] (KEIN Throw).
  // Invalid: Array filtern (silent + warn), Nicht-Array: hart auf [] mappen.
  //
  // v1.29 (v3.74.0): Color-Sanitization VOR der Validierung — damit ein
  // invalider color-String nicht den ganzen Track verwirft, sondern nur die
  // Color gestrippt wird (Track bleibt sonst intakt).
  const rawTracks = (data as { audioTracks?: unknown }).audioTracks;
  sanitizeAudioTrackColors(rawTracks);
  if (rawTracks === undefined || rawTracks === null) {
    data.audioTracks = [];
  } else if (!Array.isArray(rawTracks)) {
    console.warn(
      "[Serializer] audioTracks ist kein Array – defaulte auf leere Liste.",
    );
    data.audioTracks = [];
  } else {
    const filtered: AudioTrackChannelData[] = [];
    for (const t of rawTracks) {
      if (isValidAudioTrackEntry(t)) {
        filtered.push(t);
      } else {
        console.warn("[Serializer] Audio-Track invalid – wird übersprungen.", t);
      }
    }
    data.audioTracks = filtered;
  }

  // ─── padBank (seit v1.17) ────────────────────────────────────────────────
  // Pre-v1.17-Files haben das Feld nicht → undefined bleibt undefined
  // (Signal an restoreProject: "User-localStorage nicht überschreiben").
  // Explizites Array → invalid Items silent filtern, leeres Array bleibt.
  // null oder non-array → undefined (kein Vertrauen in das Schema).
  const rawPadBank = (data as { padBank?: unknown }).padBank;
  if (rawPadBank === undefined) {
    // nothing — data.padBank bleibt undefined
  } else if (rawPadBank === null || !Array.isArray(rawPadBank)) {
    delete (data as { padBank?: unknown }).padBank;
  } else {
    const filtered = rawPadBank.filter(isValidPadBankSlot);
    data.padBank = filtered as PadBankSlot[];
  }

  // ─── liveInputs (seit v1.18) ─────────────────────────────────────────────
  // Pre-v1.18-Files haben das Feld nicht → undefined bleibt undefined
  // (Signal an Loader: User-localStorage nicht überschreiben). null oder
  // non-Array → undefined. Explizites Array → invalid Items silent filtern.
  //
  // v1.29 (v3.74.0): Color-Sanitization VOR der Validierung — invalider
  // color-String soll nur gestrippt werden, nicht den Channel verwerfen.
  const rawLive = (data as { liveInputs?: unknown }).liveInputs;
  sanitizeLiveInputColors(rawLive);
  if (rawLive === undefined) {
    // nothing — bleibt undefined
  } else if (rawLive === null || !Array.isArray(rawLive)) {
    delete (data as { liveInputs?: unknown }).liveInputs;
  } else {
    const filtered = rawLive.filter(isValidLiveInputChannel) as LiveInputChannelData[];
    data.liveInputs = filtered;
  }

  // ─── midiNoteOut (seit v1.18) ────────────────────────────────────────────
  // Pre-v1.18-Files haben das Feld nicht → undefined bleibt undefined.
  // Falls vorhanden: enabled muss boolean sein (sonst false), configs muss
  // ein Objekt sein (sonst {}). Invalide configs werden silent gefiltert.
  const rawMno = (data as { midiNoteOut?: unknown }).midiNoteOut;
  if (rawMno === undefined) {
    // nothing — bleibt undefined
  } else if (rawMno === null || typeof rawMno !== "object" || Array.isArray(rawMno)) {
    delete (data as { midiNoteOut?: unknown }).midiNoteOut;
  } else {
    const mno = rawMno as { enabled?: unknown; configs?: unknown };
    const enabled = mno.enabled === true;
    const outConfigs: Record<string, MidiPartConfig> = {};
    if (mno.configs && typeof mno.configs === "object" && !Array.isArray(mno.configs)) {
      for (const [partId, cfg] of Object.entries(mno.configs as Record<string, unknown>)) {
        if (!isValidMidiPartConfigEntry(cfg)) continue;
        outConfigs[partId] = {
          outputId: cfg.outputId,
          channel: clampMidiChannel(cfg.channel),
          note: clampMidiNote(cfg.note),
          noteDurationMs: clampNoteDuration(cfg.noteDurationMs ?? DEFAULT_NOTE_DURATION_MS),
          localSoundEnabled: cfg.localSoundEnabled !== false,
        };
      }
    }
    data.midiNoteOut = { enabled, configs: outConfigs };
  }

  // ─── slicePads (seit v1.18) ──────────────────────────────────────────────
  // Pre-v1.18: undefined bleibt undefined. null/non-Array → undefined.
  // Slot-Werte können null oder ein gültiges SerializedSlicePadSlot sein.
  // Invalide Items werden silent in null umgewandelt (Index-Stabilität).
  const rawSlices = (data as { slicePads?: unknown }).slicePads;
  if (rawSlices === undefined) {
    // nothing
  } else if (rawSlices === null || !Array.isArray(rawSlices)) {
    delete (data as { slicePads?: unknown }).slicePads;
  } else {
    const filtered: SerializedSlicePads = rawSlices.map((slot) => {
      if (slot === null || slot === undefined) return null;
      if (!isValidSerializedSlicePadSlot(slot)) return null;
      return {
        index: slot.index,
        sampleRate: slot.sampleRate,
        sampleName: slot.sampleName,
        sliceIndex: slot.sliceIndex,
        frames: slot.frames ? slot.frames.slice() : null,
      };
    });
    data.slicePads = filtered;
  }

  // ─── mixer.pluginSlots Migration v1.20 → v1.21 ──────────────────────────
  // v1.20 hatte Single-Slot pro Channel: Record<partId, MixerPluginSlot|undef>
  // v1.21 ist Multi-Slot: Record<partId, MixerPluginSlot[]>, max 4.
  // Migration: ein Single-Object → [Object]; Array bleibt; null/undefined → [].
  // Pre-v1.20-Files (keine pluginSlots im JSON) bleiben unangetastet —
  // der MixerStore-Loader defaultet beim Re-Load auf {}.
  if (data.mixer && typeof data.mixer === "object") {
    const rawSlots = (data.mixer as { pluginSlots?: unknown }).pluginSlots;
    if (rawSlots !== undefined && rawSlots !== null && typeof rawSlots === "object" && !Array.isArray(rawSlots)) {
      const migrated: Record<string, unknown[]> = {};
      for (const [partId, value] of Object.entries(rawSlots as Record<string, unknown>)) {
        if (Array.isArray(value)) {
          migrated[partId] = value.slice(0, 4);
        } else if (value && typeof value === "object") {
          // v1.20 single-slot → wrap in [slot]
          migrated[partId] = [value];
        } else {
          migrated[partId] = [];
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data.mixer as any).pluginSlots = migrated;
    }
  }

  // ─── scripts (seit v1.16) ────────────────────────────────────────────────
  // v1.15/v1.14-Dateien ohne Feld → []. Nicht-Array → []. Invalide Items
  // werden silent + warn übersprungen. Wichtig: ALLE Scripts werden zwangs-
  // weise auf `enabled: false` gesetzt (User-Consent erforderlich, bevor
  // fremder Code läuft).
  const rawScripts = (data as { scripts?: unknown }).scripts;
  if (rawScripts === undefined || rawScripts === null) {
    data.scripts = [];
  } else if (!Array.isArray(rawScripts)) {
    console.warn(
      "[Serializer] scripts ist kein Array – defaulte auf leere Liste.",
    );
    data.scripts = [];
  } else {
    const filtered: Script[] = [];
    for (const s of rawScripts) {
      if (isValidScriptEntry(s)) {
        // Hartes Disable beim Load (User-Consent-Flow).
        filtered.push({ ...s, enabled: false });
      } else {
        console.warn("[Serializer] Script invalid – wird übersprungen.", s);
      }
    }
    data.scripts = filtered;
  }

  // ─── macros (seit v1.25) ─────────────────────────────────────────────────
  // Pre-v1.25-Files haben das Feld nicht → undefined bleibt undefined
  // (Signal an restoreProject: User-localStorage nicht überschreiben).
  // Null oder non-Array → undefined (kein Vertrauen in das Schema).
  // Explicit leeres Array → bleibt [] (User-Intent "keine Macros").
  // Invalide Entries werden silent via isValidQuickActionMacro gefiltert.
  const rawMacros = (data as { macros?: unknown }).macros;
  if (rawMacros === undefined) {
    // nothing — bleibt undefined
  } else if (rawMacros === null || !Array.isArray(rawMacros)) {
    delete (data as { macros?: unknown }).macros;
  } else {
    const filtered = (rawMacros as unknown[]).filter(isValidQuickActionMacro) as QuickActionMacro[];
    data.macros = filtered;
  }

  // ─── masterFx (seit v1.30, v3.75.0) ──────────────────────────────────────
  // Pre-v1.30-Files haben das Feld nicht → undefined bleibt undefined
  // (Signal an Restore: User-localStorage nicht überschreiben).
  // Null oder non-Object → undefined (kein Vertrauen ins Schema).
  // Explicit Object → sanitizeMasterFx clampt alle Felder + setzt Defaults.
  const rawMasterFx = (data as { masterFx?: unknown }).masterFx;
  if (rawMasterFx === undefined) {
    // nothing — bleibt undefined
  } else if (rawMasterFx === null || typeof rawMasterFx !== "object" || Array.isArray(rawMasterFx)) {
    delete (data as { masterFx?: unknown }).masterFx;
  } else {
    data.masterFx = sanitizeMasterFx(rawMasterFx);
  }

  // ─── subMixBuses (seit v1.32, v3.79.0) ───────────────────────────────────
  // Pre-v1.32-Files haben das Feld nicht → undefined bleibt undefined
  // (Signal an Restore: User-localStorage nicht überschreiben). Explicit
  // leeres Array → bleibt [] (User-Intent "keine Buses"). null oder
  // non-Array → undefined. Invalide Bus-Einträge werden via sanitizeBus
  // silent gefiltert. Cap auf MAX_SUB_MIX_BUSES (=8) hart enforced.
  const rawBuses = (data as { subMixBuses?: unknown }).subMixBuses;
  if (rawBuses === undefined) {
    // nothing — bleibt undefined
  } else if (rawBuses === null || !Array.isArray(rawBuses)) {
    delete (data as { subMixBuses?: unknown }).subMixBuses;
  } else {
    const seenIds = new Set<string>();
    const filtered: SubMixBus[] = [];
    for (const raw of rawBuses) {
      const b = sanitizeBus(raw);
      if (!b || seenIds.has(b.id)) continue;
      seenIds.add(b.id);
      filtered.push(b);
      if (filtered.length >= MAX_SUB_MIX_BUSES) break;
    }
    data.subMixBuses = filtered;
  }

  return data;
}

// ─── Browser: Download als .synth-Datei ──────────────────────────────────────

export function downloadProjectFile(project: SynthProject): void {
  const json = toJson(project);
  const blob = new Blob([json], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${project.projectName.replace(/[^\w\s-]/g, "")}.synth`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Browser: Datei öffnen ────────────────────────────────────────────────────

export function openProjectFilePicker(): Promise<SynthProject | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type  = "file";
    input.accept = ".synth,.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      try {
        const text = await file.text();
        resolve(parseProject(text));
      } catch {
        alert("Datei konnte nicht gelesen werden.");
        resolve(null);
      }
    };
    input.click();
  });
}

// ─── localStorage: letztes Projekt cachen ────────────────────────────────────

export function cacheProjectLocally(project: SynthProject): void {
  try {
    localStorage.setItem(SYNTH_LATEST_KEY, toJson(project));
  } catch (e) {
    console.warn("[Serializer] localStorage voll – Cache übersprungen", e);
  }
}

export function loadCachedProject(): SynthProject | null {
  try {
    const raw = localStorage.getItem(SYNTH_LATEST_KEY);
    if (!raw) return null;
    return parseProject(raw);
  } catch {
    return null;
  }
}
