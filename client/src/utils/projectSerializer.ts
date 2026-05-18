/**
 * Synthstudio – projectSerializer.ts
 *
 * Serialisiert den vollständigen Projekt-State in ein JSON-Objekt (SynthProject)
 * und stellt Lade-Utilities bereit.
 *
 * Format-Version: "1.19"
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

export const SYNTH_FILE_VERSION = "1.22";
export const SYNTH_LATEST_KEY = "synthstudio:last-project";

// ─── Typen ───────────────────────────────────────────────────────────────────

export interface SynthProject {
  version:     string;
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
  data: Omit<SynthProject, "version" | "savedAt">,
  opts: SerializeProjectOptions = {},
): SynthProject {
  const includeSliceBuffers = opts.includeSliceBuffers ?? true;
  const result: SynthProject = {
    version: SYNTH_FILE_VERSION,
    savedAt: new Date().toISOString(),
    ...data,
  };
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

// ─── Deserialisierung ─────────────────────────────────────────────────────────

export function parseProject(json: string): SynthProject {
  const data = JSON.parse(json) as SynthProject;
  if (!data.version || !data.patterns) {
    throw new Error("Ungültiges Synthstudio-Projektformat");
  }

  // ─── audioTracks (seit v1.15) ────────────────────────────────────────────
  // Alte v1.14-Dateien: Feld fehlt → defaulte auf [] (KEIN Throw).
  // Invalid: Array filtern (silent + warn), Nicht-Array: hart auf [] mappen.
  const rawTracks = (data as { audioTracks?: unknown }).audioTracks;
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
  const rawLive = (data as { liveInputs?: unknown }).liveInputs;
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
