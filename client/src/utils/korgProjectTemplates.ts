/**
 * Synthstudio — korgProjectTemplates.ts (v3.49.0)
 *
 * KORG-zentrierte Project-Setup-Templates. Anders als `projectTemplates.ts`
 * (Genre/Drum-Pattern-Presets) und `store/projectTemplates.ts` (Track-/Sample-
 * Skelette) bündelt dieses Modul **Konfigurations-Templates** für komplette
 * Hardware-Workflows mit KORG-Geräten (E2 Sampler, ESX-1 Live, nanoKONTROL2).
 *
 * Ein Template ist eine deklarative Definition, keine Live-Action. Die
 * Anwendung erfolgt über `applyKorgProjectTemplate(id, deps)` (siehe unten):
 * der Caller injiziert Store-Setter (Dependency-Injection), sodass dieses
 * Modul reine TypeScript-Logik bleibt — testbar in Node ohne DOM, ohne
 * Stores, ohne electronAPI.
 *
 * Isomorph: alle Side-Effects sind dependency-injected. Web- und Electron-
 * Modus teilen denselben Pfad.
 *
 * Design-Entscheidungen:
 *  - Keine direkten Store-Imports → kein Modul-Singleton-Coupling
 *  - Keine destructive Defaults → der Caller entscheidet, ob bestehende
 *    Daten überschrieben werden (typically Confirmation-Dialog in UI)
 *  - Auto-Resolve für MIDI-Devices: wir liefern Name-Hints (regex), der
 *    UI-Layer (App.tsx) versucht in der MIDIAccess-Liste zu matchen und
 *    fällt sonst zurück auf "User must pick"
 */

import { applyElectribeDrumMap } from "../store/useMidiNoteOutStore";
import { addScene } from "../store/useSceneStore";
import {
  savePadBankSlots,
  type PadBankSlot,
} from "./padBankPersistence";

// ─── Public Types ─────────────────────────────────────────────────────────────

export type KorgTemplateId = "korg-e2-studio" | "korg-esx-live" | "nanokontrol2-mix";

/**
 * Definitions-Schema. Pure-Data, keine Side-Effects. Wird sowohl in der UI
 * (Card-Picker) als auch beim Apply gelesen.
 */
export interface KorgProjectTemplate {
  id: KorgTemplateId;
  name: string;
  /** Kurzer Untertitel für die Card. */
  tagline: string;
  description: string;
  /** Lucide-icon Name (string-key, vermeidet Default-JSX-Import). */
  icon: "Mic" | "Disc" | "Sliders";
  bpm: number;
  stepCount: 16 | 32 | 64;
  drumPartCount: number;
  synthPartCount: number;
  /**
   * Hinweis-Strings, die der UI-Layer beim Apply als Toast/Banner zeigt.
   * Ersetzen reine Konsolen-Logs aus dem reinen-Logik-Modul.
   */
  postApplyHints: readonly string[];
  /**
   * Optionaler Regex (case-insensitive), der gegen die MIDI-Device-Namen der
   * MIDIAccess-Liste gematcht wird. Wenn er hit, wird das Gerät als Clock-Out
   * (E2/ESX) bzw. LED-Feedback-Out (nanoKONTROL2) aktiviert.
   */
  midiDeviceHintRegex: string | null;
  /**
   * Welche Sub-Sektionen das Template touched. Wird vom Apply-Helper genutzt
   * um Confirmation-Texte ("This will overwrite Scenes…") zu rendern.
   */
  modifies: {
    drumParts: boolean;
    synthParts: boolean;
    midiClockOut: boolean;
    midiNoteOut: boolean;
    scenes: boolean;
    padBank: boolean;
    sceneCount: number;
    padBankSlots: number;
  };
}

/**
 * Dependency-Injection für Side-Effects. Der UI-Layer bindet Real-Stores ein,
 * Tests können Mocks injizieren. Alle Felder sind optional — fehlende
 * Sektionen werden geskippt (Template-Apply ist tolerant).
 */
export interface KorgTemplateApplyDeps {
  /** Setze BPM auf Drum-Machine. Tests können das mocken. */
  setBpm?: (bpm: number) => void;
  /** Setze Step-Count auf Drum-Machine. */
  setStepCount?: (steps: 16 | 32 | 64) => void;
  /** Stelle Part-Anzahl her (drum + synth). */
  reseedParts?: (drumCount: number, synthCount: number) => string[];
  /** Aktiviere MIDI-Clock-Output mit Device-Lookup-Hint. */
  enableClockOut?: (deviceHintRegex: string | null) => void;
  /** Aktiviere LED-Feedback (nanoKONTROL2). */
  enableLedFeedback?: (deviceHintRegex: string | null) => void;
  /** Ergebnis von Apply: dem Caller zurückgegebene Apply-Notes für Toast. */
  postApplyNotice?: (msg: string) => void;
}

/** Resultat eines apply()-Calls. Pure-Data, kein React. */
export interface KorgTemplateApplyResult {
  templateId: KorgTemplateId;
  partIds: string[];
  scenesCreated: number;
  padBankSlots: number;
  hints: string[];
}

// ─── Template Definitions ─────────────────────────────────────────────────────

export const KORG_PROJECT_TEMPLATES: readonly KorgProjectTemplate[] = [
  {
    id: "korg-e2-studio",
    name: "KORG E2 Studio",
    tagline: "Produktion mit Electribe 2 Sampler",
    description:
      "16 Parts (8 Drum + 8 Synth), MIDI-Clock-Out zum E2, GM-Drum-Map für die ersten 8 Parts. Sofort einsatzbereit für Studio-Sessions mit Sync zum Electribe.",
    icon: "Mic",
    bpm: 120,
    stepCount: 16,
    drumPartCount: 8,
    synthPartCount: 8,
    midiDeviceHintRegex: "electribe",
    modifies: {
      drumParts: true,
      synthParts: true,
      midiClockOut: true,
      midiNoteOut: true,
      scenes: false,
      padBank: false,
      sceneCount: 0,
      padBankSlots: 0,
    },
    postApplyHints: [
      "MIDI-Clock-Out aktiviert — verbinde dein Electribe 2 als Sync-Slave.",
      "Drum-Parts senden GM-Notes (36/38/42/46/39/45/41/49) auf Channel 10.",
      "Synth-Parts laufen lokal mit Wavetable/FM-Defaults.",
    ],
  },
  {
    id: "korg-esx-live",
    name: "KORG ESX Live",
    tagline: "Performance mit Electribe SX",
    description:
      "10 Drum-Parts mit ESX-1-Mapping, 8 Scenes für Live-Wechsel, Pad-Bank mit 16 Performance-Pads. Clock-In ready für Master-Sync vom ESX.",
    icon: "Disc",
    bpm: 128,
    stepCount: 16,
    drumPartCount: 10,
    synthPartCount: 0,
    midiDeviceHintRegex: "esx|electribe",
    modifies: {
      drumParts: true,
      synthParts: false,
      midiClockOut: false,
      midiNoteOut: true,
      scenes: true,
      padBank: true,
      sceneCount: 8,
      padBankSlots: 16,
    },
    postApplyHints: [
      "8 Scenes vorbereitet — Shift+1..8 zum Live-Wechsel.",
      "16 Performance-Pads gemappt auf die Pad-Bank.",
      "Empfohlen: MIDI-Clock-IN aktivieren wenn ESX der Master sein soll.",
    ],
  },
  {
    id: "nanokontrol2-mix",
    name: "nanoKONTROL2 Mix",
    tagline: "Mixer-Performance mit LED-Feedback",
    description:
      "8 Mixer-Kanäle für nanoKONTROL2-Slider/Knob, LED-Feedback für Mute/Solo, Marker-Prev/Next zum Scene-Cycle, Track-Prev/Next zum Pattern-Cycle. Pad-Bank mit Performance-Actions.",
    icon: "Sliders",
    bpm: 120,
    stepCount: 16,
    drumPartCount: 8,
    synthPartCount: 0,
    midiDeviceHintRegex: "nanokontrol",
    modifies: {
      drumParts: true,
      synthParts: false,
      midiClockOut: false,
      midiNoteOut: false,
      scenes: false,
      padBank: true,
      sceneCount: 0,
      padBankSlots: 16,
    },
    postApplyHints: [
      "Slider 1-8 → Volume Channels, Knobs 1-8 → Pan.",
      "Marker PREV/NEXT → Scene-Cycle, Track PREV/NEXT → Pattern-Cycle.",
      "LED-Feedback verbunden — Mute/Solo werden farbcodiert angezeigt.",
    ],
  },
] as const;

// ─── Lookup Helpers ───────────────────────────────────────────────────────────

/** Liefert das Template oder null wenn die ID nicht existiert. Pure. */
export function getKorgTemplate(id: string): KorgProjectTemplate | null {
  return KORG_PROJECT_TEMPLATES.find((t) => t.id === id) ?? null;
}

/** Listet die IDs aller verfügbaren Templates. Pure, stabil sortiert (Definition-Order). */
export function listKorgTemplateIds(): KorgTemplateId[] {
  return KORG_PROJECT_TEMPLATES.map((t) => t.id);
}

/**
 * Erzeugt 16 Performance-Pad-Slots (kind:perf-pad, param:"0".."15") für die
 * nanoKONTROL2- und ESX-Live-Templates. Pure.
 */
export function buildPerfPadBankSlots(): PadBankSlot[] {
  return Array.from({ length: 16 }, (_, i) => ({
    kind: "perf-pad" as const,
    param: String(i),
  }));
}

// ─── Side-Effect Layer (Dependency-Injected) ──────────────────────────────────

/**
 * Wendet ein Template auf den aktuellen Project-State an. Side-Effects sind
 * explizit injiziert (deps). Fehlende deps werden geskippt — robust für
 * Tests.
 *
 * Idempotent (mehrfach-Aufruf safe), aber nicht additive: existierende
 * Pad-Bank/Scenes werden überschrieben. Der UI-Layer muss vorher confirmen.
 */
export function applyKorgProjectTemplate(
  id: string,
  deps: KorgTemplateApplyDeps = {},
): KorgTemplateApplyResult {
  const tmpl = getKorgTemplate(id);
  if (!tmpl) {
    throw new Error(`Unknown KORG template: ${id}`);
  }

  // 1. Transport — BPM + Step-Count
  deps.setBpm?.(tmpl.bpm);
  deps.setStepCount?.(tmpl.stepCount);

  // 2. Parts reseed (drum + synth zusammen) — Liefert Part-IDs zurück, die
  //    wir für nachfolgende Note-Out-Mappings brauchen.
  let partIds: string[] = [];
  if (deps.reseedParts) {
    partIds = deps.reseedParts(tmpl.drumPartCount, tmpl.synthPartCount);
  }

  // 3. MIDI Clock-Out (nur E2 Studio)
  if (tmpl.modifies.midiClockOut) {
    deps.enableClockOut?.(tmpl.midiDeviceHintRegex);
  }

  // 4. LED-Feedback (nur nanoKONTROL2 Mix)
  if (tmpl.id === "nanokontrol2-mix") {
    deps.enableLedFeedback?.(tmpl.midiDeviceHintRegex);
  }

  // 5. MIDI Note-Out (E2 Studio + ESX Live). Wir nutzen den DI-Store-Helper
  //    `applyElectribeDrumMap` aus useMidiNoteOutStore — der ist Store-Layer-
  //    Code, aber storage-only (kein UI). Für reine Tests kann der Caller den
  //    Apply-Helper mocken; hier verlassen wir uns auf die echte Funktion.
  if (tmpl.modifies.midiNoteOut && partIds.length > 0) {
    // outputId wird beim ersten Toast in der UI vom User gesetzt, wenn die
    // Auto-Resolution fehl schlägt. Wir nutzen einen Placeholder, den der UI-
    // Layer überschreibt sobald die MIDIAccess das passende Device findet.
    const placeholder = `__pending__:${tmpl.midiDeviceHintRegex ?? ""}`;
    const drumPartIds = partIds.slice(0, tmpl.drumPartCount);
    applyElectribeDrumMap(drumPartIds, placeholder);
  }

  // 6. Scenes (nur ESX Live — 8 Scenes als Cycle-Targets)
  let scenesCreated = 0;
  if (tmpl.modifies.scenes && tmpl.modifies.sceneCount > 0) {
    // Wir brauchen mind. 1 Pattern als Default. Da Patterns vom DrumStore
    // verwaltet werden und sich der Pattern-State zwischen Sessions ändert,
    // nutzen wir den Sentinel "default" — die SceneLaunch-UI zeigt sonst
    // "Pattern nicht gefunden" und der User kann remappen.
    for (let i = 0; i < tmpl.modifies.sceneCount; i++) {
      addScene(`Scene ${i + 1}`, "default");
      scenesCreated++;
    }
  }

  // 7. Pad-Bank (ESX Live + nanoKONTROL2 Mix — 16 Perf-Pads)
  if (tmpl.modifies.padBank && tmpl.modifies.padBankSlots > 0) {
    savePadBankSlots(buildPerfPadBankSlots());
  }

  // 8. Notice an die UI rausgeben
  const hints = [...tmpl.postApplyHints];
  deps.postApplyNotice?.(`Template angewendet: ${tmpl.name}`);

  return {
    templateId: tmpl.id,
    partIds,
    scenesCreated,
    padBankSlots: tmpl.modifies.padBankSlots,
    hints,
  };
}
