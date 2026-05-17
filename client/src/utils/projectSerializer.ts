/**
 * Synthstudio – projectSerializer.ts
 *
 * Serialisiert den vollständigen Projekt-State in ein JSON-Objekt (SynthProject)
 * und stellt Lade-Utilities bereit.
 *
 * Format-Version: "1.16"
 *   - "1.15": audioTracks hinzugefügt – v1.14-Dateien laden weiter
 *   - "1.16": scripts hinzugefügt (project-scope, additiv-optional)
 *     v1.15/v1.14-Dateien laden ohne scripts-Feld weiter → defaultet auf [].
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

export const SYNTH_FILE_VERSION = "1.17";
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
  };
  humanizer: {
    global: HumanizerState["global"];
  };
  automation: {
    lanes: AutomationLane[];
    stepCount: 16 | 32;
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

// ─── Serialisierung ───────────────────────────────────────────────────────────

export function serializeProject(data: Omit<SynthProject, "version" | "savedAt">): SynthProject {
  return {
    version: SYNTH_FILE_VERSION,
    savedAt: new Date().toISOString(),
    ...data,
  };
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
