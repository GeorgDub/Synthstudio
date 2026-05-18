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

import {
  applyElectribeDrumMap,
  getAllPartMidiOutConfigs,
  setPartMidiOutConfig,
} from "../store/useMidiNoteOutStore";
import { addScene } from "../store/useSceneStore";
import {
  loadPadBankSlots,
  savePadBankSlots,
  type PadBankSlot,
} from "./padBankPersistence";
import {
  enumerateMidiOutputs,
  type MidiAccessLike,
  type MidiOutputInfo,
} from "./midiOutput";

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
  /**
   * Stelle Part-Anzahl her (drum + synth). Implementierungen sollten
   * bestehende Parts ggf. droppen und Defaults erzeugen. Liefert die neuen
   * Part-IDs in Reihenfolge zurück (drum vor synth) — werden für die
   * MIDI-Note-Out-Mappings (Drum-GM-Map) benötigt.
   */
  reseedParts?: (drumCount: number, synthCount: number) => string[];
  /**
   * Aktiviere MIDI-Clock-Output. Wenn `resolvedOutputId` gesetzt ist, wurde
   * via {@link KorgTemplateApplyDeps.midiAccess} ein passendes Device gefunden
   * und kann direkt als Clock-Out-Target gesetzt werden. Andernfalls flagt
   * der UI-Layer den User dass er manuell wählen muss.
   */
  enableClockOut?: (deviceHintRegex: string | null, resolvedOutputId: string | null) => void;
  /**
   * Aktiviere LED-Feedback (nanoKONTROL2). Symmetrisch zu `enableClockOut`.
   */
  enableLedFeedback?: (deviceHintRegex: string | null, resolvedOutputId: string | null) => void;
  /** Ergebnis von Apply: dem Caller zurückgegebene Apply-Notes für Toast. */
  postApplyNotice?: (msg: string) => void;
  /**
   * v3.50.0: Optionaler MIDIAccess (oder Mock) ODER eine flach enumerierte
   * `MidiOutputInfo[]` (z.B. aus `useMidi().outputDevices`). Wenn gesetzt,
   * sucht der Apply-Helper nach einem Output dessen Name auf den Template-
   * Regex matched und ersetzt die `__pending__:`-Placeholder in den
   * MIDI-Note-Out-Configs mit der echten outputId. Fehlt der Match, bleibt
   * der Placeholder stehen und der UI-Layer zeigt einen Hinweis-Toast.
   */
  midiAccess?: MidiAccessLike | MidiOutputInfo[] | null;
  /**
   * v3.50.0: Wird gerufen wenn der Apply-Helper für ein erwartetes Device
   * keinen Match in der MIDIAccess findet — der UI-Layer kann dann einen
   * Info-Toast rendern ("Output 'electribe' nicht gefunden — manuell wählen").
   */
  onMissingDevice?: (deviceHintRegex: string, sectionLabel: string) => void;
}

/** Resultat eines apply()-Calls. Pure-Data, kein React. */
export interface KorgTemplateApplyResult {
  templateId: KorgTemplateId;
  partIds: string[];
  scenesCreated: number;
  padBankSlots: number;
  hints: string[];
  /**
   * v3.50.0: Wenn der MIDIAccess durchsucht wurde, hier die outputId des
   * Matches (oder null bei kein-Match). Nützlich für UI-Toast und für
   * Tests die das Auto-Resolve-Verhalten verifizieren.
   */
  resolvedOutputId: string | null;
}

/**
 * v3.50.0: Pure-Helper. Sucht in einer Output-Liste nach einem Output dessen
 * Name auf das angegebene Regex matched (case-insensitive). Liefert die
 * outputId oder null. Wird im Apply-Pfad benutzt, ist aber export-sichtbar
 * damit andere UI-Pfade (Welcome-Wizard, Settings) den gleichen Mechanismus
 * benutzen können.
 *
 * @param source MIDIAccess (Web-MIDI), Mock, oder einfach ein
 *               MidiOutputInfo[]-Array (z.B. aus useMidi().outputDevices).
 *               Kann null/undefined sein → liefert null.
 * @param hint Regex-String (z.B. "electribe", "nanokontrol|nano kontrol"). Wenn
 *             null/leer → liefert null.
 * @returns ID des ersten matchenden connected-Output, oder null.
 */
export function resolveMidiOutputIdByHint(
  source: MidiAccessLike | MidiOutputInfo[] | null | undefined,
  hint: string | null,
): string | null {
  if (!source || !hint) return null;
  let re: RegExp;
  try {
    re = new RegExp(hint, "i");
  } catch {
    return null; // invalid regex
  }
  const outputs: MidiOutputInfo[] = Array.isArray(source)
    ? source
    : enumerateMidiOutputs(source);
  // Bevorzuge connected vor disconnected (User hat ggf. mehrere Devices).
  const connected = outputs.find(
    (o) => o.state === "connected" && re.test(o.name),
  );
  if (connected) return connected.id;
  const any = outputs.find((o) => re.test(o.name));
  return any?.id ?? null;
}

/**
 * v3.50.0: Confirmation-Heuristik. Liefert `true` wenn der Apply destructive
 * wäre (existierende Pad-Bank non-default, Scenes vorhanden, oder mehr Parts
 * als Default). Der UI-Layer benutzt das vor `window.confirm()`.
 *
 * Hinweis: wir testen die persistierten Stores (localStorage) für Pad-Bank +
 * Scenes. Drum-/Synth-Parts laufen über DI — Caller muss `existingPartCount`
 * selbst befüllen wenn er die Heuristik aktivieren will. Default 9 = Standard
 * Drum-Bank.
 */
export function isKorgTemplateApplyDestructive(opts: {
  existingPartCount?: number;
  defaultPartCount?: number;
} = {}): boolean {
  const { existingPartCount, defaultPartCount = 9 } = opts;
  if (typeof existingPartCount === "number" && existingPartCount > defaultPartCount) {
    return true;
  }
  try {
    const pad = loadPadBankSlots();
    if (pad.length > 0) {
      // Default ist 16 perf-pad mit param 0..15. Wenn etwas anderes vorhanden
      // ist (z.B. Macro-/Script-Slots), ist das destructive.
      const isAllDefault = pad.length === 16 && pad.every(
        (s, i) => s.kind === "perf-pad" && s.param === String(i),
      );
      if (!isAllDefault) return true;
    }
  } catch { /* ignore */ }
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem("ss-scenes:v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.scenes) && parsed.scenes.length > 0) {
          return true;
        }
      }
    }
  } catch { /* ignore */ }
  return false;
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

  // v3.50.0 — Auto-Resolve MIDI-Output via MIDIAccess + Regex-Hint.
  // resolvedOutputId wird in den nachfolgenden Steps statt des __pending__-
  // Placeholders verwendet. null bei: kein MIDIAccess, kein Hint, kein Match.
  const resolvedOutputId = resolveMidiOutputIdByHint(
    deps.midiAccess ?? null,
    tmpl.midiDeviceHintRegex,
  );

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
    deps.enableClockOut?.(tmpl.midiDeviceHintRegex, resolvedOutputId);
    if (
      tmpl.midiDeviceHintRegex
      && deps.midiAccess
      && !resolvedOutputId
      && deps.onMissingDevice
    ) {
      deps.onMissingDevice(tmpl.midiDeviceHintRegex, "Clock-Out");
    }
  }

  // 4. LED-Feedback (nur nanoKONTROL2 Mix)
  if (tmpl.id === "nanokontrol2-mix") {
    deps.enableLedFeedback?.(tmpl.midiDeviceHintRegex, resolvedOutputId);
    if (
      tmpl.midiDeviceHintRegex
      && deps.midiAccess
      && !resolvedOutputId
      && deps.onMissingDevice
    ) {
      deps.onMissingDevice(tmpl.midiDeviceHintRegex, "LED-Feedback");
    }
  }

  // 5. MIDI Note-Out (E2 Studio + ESX Live). Wir nutzen den DI-Store-Helper
  //    `applyElectribeDrumMap` aus useMidiNoteOutStore — der ist Store-Layer-
  //    Code, aber storage-only (kein UI). Wenn Auto-Resolve einen echten
  //    outputId gefunden hat, schreiben wir ihn direkt. Andernfalls bleibt
  //    der Placeholder + onMissingDevice-Toast.
  if (tmpl.modifies.midiNoteOut && partIds.length > 0) {
    const targetOutputId =
      resolvedOutputId
      ?? `__pending__:${tmpl.midiDeviceHintRegex ?? ""}`;
    const drumPartIds = partIds.slice(0, tmpl.drumPartCount);
    applyElectribeDrumMap(drumPartIds, targetOutputId);
    if (
      !resolvedOutputId
      && tmpl.midiDeviceHintRegex
      && deps.midiAccess
      && deps.onMissingDevice
    ) {
      deps.onMissingDevice(tmpl.midiDeviceHintRegex, "Note-Out");
    }
  } else if (resolvedOutputId && tmpl.modifies.midiNoteOut) {
    // Defensive: midiAccess vorhanden + Match aber partIds leer → kein-op
    // (reseedParts wurde nicht injected). UI sieht das via partIds-Länge.
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

  // v3.50.0 — Wenn nachträglich ein Match gefunden wurde (z.B. weil
  // applyKorgProjectTemplate von einem späteren useEffect erneut gerufen
  // wird, sobald die MIDIAccess gepopulated ist), ersetze leftover
  // __pending__:* outputIds in der Note-Out-Map mit der echten ID.
  if (resolvedOutputId) {
    try {
      const all = getAllPartMidiOutConfigs();
      for (const [partId, cfg] of Object.entries(all)) {
        if (cfg.outputId.startsWith("__pending__:")) {
          setPartMidiOutConfig(partId, { ...cfg, outputId: resolvedOutputId });
        }
      }
    } catch { /* defensive — store kann in test-Env fehlen */ }
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
    resolvedOutputId,
  };
}
