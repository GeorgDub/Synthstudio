/**
 * Synthstudio – SettingsPanel
 *
 * Einheitliche Einstellungsoberfläche mit Sidebar-Navigation.
 * Enthält alle Settings an einem Ort:
 *  - Design (Themes)
 *  - KI & API (Claude API Key)
 *  - Tastatur (Key Bindings)
 *  - MIDI Geräte & Clock
 *  - MIDI CC-Zuweisungen (alle Funktionen)
 *  - MIDI Note-Zuweisungen
 *  - Über
 */
import React, { useState, useCallback, useEffect, useReducer } from "react";
import { X } from "lucide-react";
import { KeyboardBindingsPanel } from "./KeyboardBindingsPanel";
// v3.16.0 — OmniTribe Hardware-Bridge
import { DeviceConnectionPanel } from "./DeviceConnectionPanel";
import {
  useApiSettingsStore,
  setApiKey,
  setAiModel,
  setAutoSaveEnabled,
  setSnapshotsEnabled,
  setAutoSaveInterval,
  setActiveProvider,
  setProviderKey,
  setProviderModel,
  AI_PROVIDERS,
  AVAILABLE_MODELS,
  type AiProvider,
} from "@/store/useApiSettingsStore";
import { useWorkspaceMode, setWorkspaceMode } from "@/store/useWorkspaceMode";
import {
  useMetronomeStore,
  updateMetronome,
  uploadCustomMetronomeSound,
  clearCustomMetronomeSound,
} from "@/store/useMetronomeStore";
import {
  useChordMemoryStore,
  setChordMemoryEnabled,
  setChordType,
  setChordVoicing,
  setChordSpread,
  CHORD_LABELS,
  type ChordType,
} from "@/store/useChordMemoryStore";
import {
  useThemeStore, applyCustomTheme, deleteCustomTheme,
  applyTheme as applyBaseThemeFromStore,
} from "@/store/useThemeStore";
import {
  THEMES, applyTheme, loadSavedTheme, type ThemeId,
} from "./ThemeSettings";
import { parseMidiLayoutJson, checkPartIdsExist } from "@/utils/midiLayoutImport";
import {
  usePatchStore,
  deletePatch,
  renamePatch,
  clearAllPatches,
  exportLibrary as exportPatchLibrary,
  importLibrary as importPatchLibrary,
} from "@/store/usePatchStore";
import { toast } from "@/store/useToastStore";
import { useOscOutConfig, setOscOutConfig } from "@/store/useOscOutStore";
import { CustomThemeCreator } from "./CustomThemeCreator";
import type { MidiState, MidiActions, MidiLearnTarget } from "@/hooks/useMidi";
import type { PartData } from "@/audio/AudioEngine";
import { useElectron } from "../../../../electron/useElectron";
import { useUpdater } from "@/hooks/useUpdater";
// TASK-232-FOLLOWUP-2 / v2.98: License-Section + ActivationModal-Re-Mount aus Settings.
import {
  useLicenseStore,
  clear as clearLicense,
  daysRemainingInTrial,
  isPro,
} from "@/store/useLicenseStore";
import { ActivationModal } from "@/components/License/ActivationModal";
import { GUMROAD_PRODUCT_URL, TRIAL_DURATION_DAYS } from "@/utils/licenseConfig";
// v3.0.0 (TASK-236-ALT): Audio-Engine-Low-Latency-Config.
import {
  useAudioEngineConfigStore,
  setLatencyHint,
  setSampleRate,
  type LatencyHint,
  type SampleRateOption,
} from "@/store/useAudioEngineConfigStore";
import { AudioEngine } from "@/audio/AudioEngine";

// ─── Sidebar-Abschnitte ───────────────────────────────────────────────────────

type Section =
  | "design"
  | "ki"
  | "workspace"
  | "keyboard"
  | "metronome"
  | "audio-engine"
  | "midi-devices"
  | "midi-cc"
  | "midi-notes"
  | "midi-chord"
  | "midi-mpe"
  | "omnitribe"
  | "osc"
  | "plugins"
  | "patches"
  | "saving"
  | "license"
  | "about";

const SECTIONS: Array<{ id: Section; icon: string; label: string; group?: string }> = [
  { id: "design",       icon: "🎨", label: "Design",             group: "Erscheinungsbild" },
  { id: "workspace",    icon: "🧱", label: "Workspace",          group: "Erscheinungsbild" },
  { id: "ki",           icon: "✨", label: "KI & API",            group: "Erscheinungsbild" },
  { id: "keyboard",     icon: "⌨️", label: "Tastatur",            group: "Steuerung" },
  { id: "metronome",    icon: "🥁", label: "Metronom",            group: "Audio" },
  { id: "audio-engine", icon: "⚡", label: "Audio Engine",         group: "Audio" },
  { id: "midi-devices", icon: "🎹", label: "MIDI Geräte",         group: "MIDI" },
  { id: "midi-cc",      icon: "🎛",  label: "CC-Zuweisungen",      group: "MIDI" },
  { id: "midi-notes",   icon: "🎵", label: "Note-Zuweisungen",    group: "MIDI" },
  { id: "midi-chord",   icon: "🎼", label: "Chord Memory",        group: "MIDI" },
  { id: "midi-mpe",     icon: "🖐", label: "MPE",                 group: "MIDI" },
  { id: "omnitribe",    icon: "🔌", label: "OmniTribe Device",     group: "Hardware" },
  { id: "saving",       icon: "💾", label: "Speichern",           group: "App" },
  { id: "patches",      icon: "🎚", label: "Patch-Library",       group: "App" },
  { id: "osc",          icon: "📡", label: "OSC",                 group: "App" },
  { id: "plugins",      icon: "🧩", label: "Plugins",             group: "App" },
  { id: "license",      icon: "🔑", label: "Lizenz",              group: "App" },
  { id: "about",        icon: "ℹ",  label: "Über",                group: "App" },
];

// ─── MIDI CC Target Definitionen ─────────────────────────────────────────────

interface CcTargetDef {
  target: MidiLearnTarget;
  label: string;
  category: string;
}

function buildCcTargets(parts: PartData[]): CcTargetDef[] {
  const defs: CcTargetDef[] = [
    // Transport
    { target: { type: "playStop" },        label: "Play / Stop",        category: "Transport" },
    { target: { type: "record" },          label: "Record",             category: "Transport" },
    { target: { type: "tapTempo" },        label: "Tap Tempo",          category: "Transport" },
    { target: { type: "bpm" },             label: "BPM (absolut)",      category: "Transport" },
    { target: { type: "bpmUp" },           label: "BPM +1",             category: "Transport" },
    { target: { type: "bpmDown" },         label: "BPM -1",             category: "Transport" },
    { target: { type: "masterVolume" },    label: "Master Volume",      category: "Transport" },
    // Pattern
    { target: { type: "patternNext" },     label: "Pattern →",          category: "Pattern" },
    { target: { type: "patternPrev" },     label: "Pattern ←",          category: "Pattern" },
    { target: { type: "patternClear" },    label: "Pattern leeren",     category: "Pattern" },
    { target: { type: "patternFill" },     label: "Pattern füllen",     category: "Pattern" },
    { target: { type: "patternRandomize" },label: "Pattern zufällig",   category: "Pattern" },
    { target: { type: "patternDuplicate" },label: "Pattern duplizieren",category: "Pattern" },
    // Parts
    { target: { type: "partUp" },          label: "Part ↑",             category: "Parts" },
    { target: { type: "partDown" },        label: "Part ↓",             category: "Parts" },
    // Navigation
    { target: { type: "tab", tabId: "sequencer" },   label: "Tab: Sequencer",    category: "Navigation" },
    { target: { type: "tab", tabId: "mixer" },        label: "Tab: Mixer",        category: "Navigation" },
    { target: { type: "tab", tabId: "song" },         label: "Tab: Song",         category: "Navigation" },
    { target: { type: "tab", tabId: "humanizer" },    label: "Tab: Humanizer",    category: "Navigation" },
    { target: { type: "tab", tabId: "tools" },        label: "Tab: Tools",        category: "Navigation" },
    { target: { type: "tab", tabId: "kollaboration" },label: "Tab: Kollaboration",category: "Navigation" },
    // Performance
    { target: { type: "toggleNoteRepeat" },label: "Note Repeat",        category: "Performance" },
    { target: { type: "toggleMorph" },     label: "Pattern Morph",      category: "Performance" },
    { target: { type: "commitLiveEdit" },  label: "Live Edit Commit",   category: "Performance" },
    // Scenes 1-8
    ...Array.from({ length: 8 }, (_, i) => ({
      target: { type: "scenelaunch" as const, sceneIndex: i },
      label: `Scene ${i + 1} starten`,
      category: "Scenes",
    })),
    // System
    { target: { type: "openSettings" },    label: "Einstellungen öffnen", category: "System" },
    // Pro Kanal: Volume, Pan, Mute, Solo
    ...parts.flatMap(p => [
      { target: { type: "volume" as const, partId: p.id, partName: p.name }, label: `${p.name} – Volume`, category: "Kanäle" },
      { target: { type: "pan"    as const, partId: p.id, partName: p.name }, label: `${p.name} – Pan`,    category: "Kanäle" },
      { target: { type: "mute"   as const, partId: p.id, partName: p.name }, label: `${p.name} – Mute`,   category: "Kanäle" },
      { target: { type: "solo"   as const, partId: p.id, partName: p.name }, label: `${p.name} – Solo`,   category: "Kanäle" },
    ]),
  ];
  return defs;
}

// ─── Inline Sections ─────────────────────────────────────────────────────────

function DesignSection() {
  const { customThemes, activeCustomTheme } = useThemeStore();
  const [current, setCurrent] = useState<ThemeId>(loadSavedTheme);
  const [showCreator, setShowCreator] = useState(false);

  const selectBase = (id: ThemeId) => {
    setCurrent(id);
    applyBaseThemeFromStore(id);
    localStorage.setItem("ss-theme", id);
  };

  return (
    <div>
      <h3 className="text-sm font-bold text-text-primary mb-4">Design-Theme</h3>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {THEMES.map(theme => {
          const isSelected = current === theme.id && !activeCustomTheme;
          return (
            <button key={theme.id} onClick={() => selectBase(theme.id as ThemeId)}
              className={`flex items-center gap-2 p-2.5 rounded border text-left transition-all ${isSelected ? "border-accent-secondary bg-accent-secondary/10" : "border-border-color hover:border-border-subtle bg-bg-elevated"}`}>
              <div className="flex gap-0.5 flex-shrink-0">
                {theme.preview.map((c, i) => <div key={i} className="rounded-sm" style={{ background: c, width: i === 0 ? 18 : 9, height: 24 }} />)}
              </div>
              <div className="min-w-0">
                <div className={`text-xs font-medium ${isSelected ? "text-accent-secondary" : "text-text-primary"}`}>{theme.name}</div>
                <div className="text-[10px] text-text-dim truncate">{theme.description}</div>
              </div>
              {isSelected && <div className="ml-auto w-2 h-2 rounded-full bg-accent-secondary flex-shrink-0" />}
            </button>
          );
        })}
      </div>

      {customThemes.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-text-dim mb-2">Eigene Designs</h4>
          <div className="grid grid-cols-2 gap-2">
            {customThemes.map(theme => {
              const isSelected = activeCustomTheme === theme.id;
              return (
                <div key={theme.id} className={`flex items-center gap-2 p-2.5 rounded border ${isSelected ? "border-accent-success bg-accent-success/10" : "border-border-color"}`}>
                  <button onClick={() => { applyCustomTheme(theme.id); setCurrent("dark"); }} className="flex-1 flex items-center gap-2 min-w-0">
                    <div className="rounded-sm flex-shrink-0" style={{ background: theme.colors["--ss-bg-base"], width: 18, height: 24 }} />
                    <div className="rounded-sm flex-shrink-0" style={{ background: theme.colors["--ss-accent-primary"], width: 9, height: 24 }} />
                    <span className={`text-xs font-medium truncate ${isSelected ? "text-accent-success" : "text-text-primary"}`}>{theme.name}</span>
                  </button>
                  <button onClick={() => deleteCustomTheme(theme.id)} className="text-text-dim hover:text-accent-danger text-xs flex-shrink-0">✕</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showCreator
        ? <CustomThemeCreator onClose={() => setShowCreator(false)} />
        : <button onClick={() => setShowCreator(true)} className="w-full text-center text-xs text-text-dim hover:text-text-primary py-2 rounded border border-dashed border-border-color">
            + Eigenes Design erstellen
          </button>
      }
    </div>
  );
}

/** Sichtbarer Label + Provider-spezifischer Hinweis. */
const PROVIDER_META: Record<AiProvider, { label: string; placeholder: string; helpUrl: string; helpLabel: string }> = {
  anthropic: {
    label: "Anthropic (Claude)",
    placeholder: "sk-ant-…",
    helpUrl: "console.anthropic.com",
    helpLabel: "console.anthropic.com",
  },
  openai: {
    label: "OpenAI (ChatGPT / GPT)",
    placeholder: "sk-…",
    helpUrl: "platform.openai.com/api-keys",
    helpLabel: "platform.openai.com/api-keys",
  },
};

function KiSection() {
  const api = useApiSettingsStore();
  const provider: AiProvider = api.activeProvider;
  const providerCfg = api.providers[provider];
  // Lokales Draft-State pro provider damit der Save-Button auch beim Wechsel
  // sinnvoll funktioniert. useState-Init wird beim Provider-Wechsel via key gerefresht.
  const [keyDraft, setKeyDraft] = useState(providerCfg.apiKey);
  const meta = PROVIDER_META[provider];

  // Wenn der User den aktiven Provider wechselt, das Draft auf den Key des
  // neuen Providers setzen.
  useEffect(() => {
    setKeyDraft(providerCfg.apiKey);
  }, [provider, providerCfg.apiKey]);

  const handleSave = () => {
    setProviderKey(provider, keyDraft);
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-bold text-text-primary mb-1">AI Beat Co-Pilot</h3>
        <p className="text-xs text-text-dim mb-3">
          Wähle deinen AI-Provider, füge deinen API-Key hinzu und wähle ein Modell.
          Keys werden lokal gespeichert — nicht synchronisiert, nicht geloggt.
        </p>

        {/* Provider-Picker */}
        <label className="text-xs text-text-muted block mb-1">Provider</label>
        <div className="flex gap-2 mb-3" data-testid="ki-provider-picker">
          {AI_PROVIDERS.map((p) => (
            <button
              key={p}
              type="button"
              data-testid={`ki-provider-btn-${p}`}
              onClick={() => setActiveProvider(p)}
              className={[
                "flex-1 px-3 py-1.5 text-xs rounded border transition-colors",
                provider === p
                  ? "bg-accent-primary/20 border-accent-primary text-accent-primary"
                  : "bg-bg-elevated border-border-color text-text-muted hover:text-text-primary hover:border-accent-secondary",
              ].join(" ")}
            >
              {PROVIDER_META[p].label}
            </button>
          ))}
        </div>

        {/* API-Key Eingabe */}
        <label className="text-xs text-text-muted block mb-1">{meta.label} API Key</label>
        <div className="flex gap-2">
          <input
            type="password"
            value={keyDraft}
            onChange={e => setKeyDraft(e.target.value)}
            placeholder={meta.placeholder}
            data-testid={`ki-api-key-${provider}`}
            className="flex-1 bg-bg-elevated text-text-primary text-xs px-3 py-2 rounded border border-border-color placeholder:text-text-dim focus:border-accent-primary outline-none"
          />
          <button
            onClick={handleSave}
            data-testid={`ki-api-key-save-${provider}`}
            className="px-3 py-1.5 text-xs rounded bg-accent-primary text-white hover:opacity-80 transition-opacity"
          >
            Speichern
          </button>
        </div>
        {providerCfg.apiKey && (
          <p className="text-[10px] text-accent-success mt-1.5">✓ API Key aktiv – KI-Generierung verfügbar</p>
        )}
      </div>

      {/* Modell-Picker für den aktiven Provider */}
      <div>
        <label className="text-xs text-text-muted block mb-1">Modell ({meta.label})</label>
        <select
          value={providerCfg.model}
          onChange={e => setProviderModel(provider, e.target.value)}
          data-testid={`ki-model-${provider}`}
          className="w-full bg-bg-elevated text-text-primary text-xs px-3 py-2 rounded border border-border-color"
        >
          {AVAILABLE_MODELS[provider].map(m => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <p className="text-[10px] text-text-dim mt-1">
          Kleinere Modelle = niedrigere Latenz + günstiger. Größere = kreativer.
        </p>
      </div>

      <div className="border-t border-border-color pt-3 text-[10px] text-text-dim space-y-1">
        <div>
          API Key holen: <span className="text-accent-secondary">{meta.helpLabel}</span>
        </div>
        <div>
          Ohne Key wird prozedurale Generierung verwendet. Free-Tier-Plan via Synthstudio-Proxy
          ist auf der Roadmap (Phase B), aktuell nicht verfügbar.
        </div>
      </div>
    </div>
  );
}

// Silence "setApiKey is unused" warning — bleibt für Backward-compat re-exportiert
// von useApiSettingsStore und in Tests verwendet.
void setApiKey;
void setAiModel;

/**
 * Workspace Mode Toggle (MIG-2B feature-flag).
 * Aktiviert den neuen Dockview-Workspace anstelle der Legacy-Tab-Bar.
 * Während der MIG-2 Migration läuft beides parallel — User kann selbst wählen.
 */
function WorkspaceSection() {
  const enabled = useWorkspaceMode();
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-bold text-text-primary mb-1">Workspace-Modus (Beta)</h3>
        <p className="text-xs text-text-dim mb-3">
          Aktiviert den neuen Dockview-basierten Workspace mit drag-bar Tabs, Splits und Floating-Panels.
          Während der Beta-Phase läuft Workspace parallel zur alten Tab-Bar — du kannst jederzeit zurück.
          Migrierte Tabs aktuell: <span className="font-mono">Mixer</span>, <span className="font-mono">Channel Inspector</span>.
        </p>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setWorkspaceMode(e.target.checked)}
            data-testid="workspace-mode-toggle"
            className="cursor-pointer accent-accent-primary"
          />
          <span className="text-xs text-text-primary">
            Dockview Workspace aktivieren
          </span>
        </label>
      </div>
      <div className="border-t border-border-color pt-3 text-[10px] text-text-dim space-y-1">
        <div>Im nächsten Welle der Migration: alle restlichen Tabs + echtes Multi-Window-Drag-Out (Browser-Tab-Stil).</div>
      </div>
    </div>
  );
}

function MetronomeSection() {
  const state = useMetronomeStore();
  const clickRef = React.useRef<HTMLInputElement>(null);
  const beatRef  = React.useRef<HTMLInputElement>(null);
  const [error, setError] = React.useState<string | null>(null);

  const handleFile = async (type: "downbeat" | "beat", file: File) => {
    setError(null);
    try {
      await uploadCustomMetronomeSound(type, file);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload fehlgeschlagen");
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-text-primary">Metronom</h3>
      <p className="text-xs text-text-dim">Passe den Metronom-Klang an. Eigene WAV-Dateien als Click-Sound laden – persistent gespeichert.</p>

      {error && (
        <div className="text-[10px] text-accent-danger bg-accent-danger/10 rounded px-2 py-1">
          {error}
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="text-xs text-text-muted block mb-1">Lautstärke</label>
          <input type="range" min={0} max={1} step={0.01} value={state.volume}
            onChange={e => updateMetronome({ volume: Number(e.target.value) })}
            className="w-full accent-accent-primary" />
        </div>

        <div>
          <label className="text-xs text-text-muted block mb-1">Downbeat-Sound (Erster Schlag)</label>
          <div className="flex gap-2 items-center">
            <button onClick={() => clickRef.current?.click()}
              className="px-3 py-1.5 text-xs rounded bg-bg-elevated border border-border-color text-text-muted hover:text-text-primary">
              WAV laden…
            </button>
            {state.customDownbeatName && <span className="text-[10px] text-accent-secondary truncate">{state.customDownbeatName}</span>}
            {state.customDownbeatUrl && <button onClick={() => clearCustomMetronomeSound("downbeat")} className="text-text-dim hover:text-accent-danger text-xs">✕</button>}
          </div>
          <input ref={clickRef} type="file" accept=".wav,.mp3,.ogg" className="hidden"
            onChange={e => { if (e.target.files?.[0]) void handleFile("downbeat", e.target.files[0]); e.target.value = ""; }} />
        </div>

        <div>
          <label className="text-xs text-text-muted block mb-1">Beat-Sound (alle anderen Schläge)</label>
          <div className="flex gap-2 items-center">
            <button onClick={() => beatRef.current?.click()}
              className="px-3 py-1.5 text-xs rounded bg-bg-elevated border border-border-color text-text-muted hover:text-text-primary">
              WAV laden…
            </button>
            {state.customBeatName && <span className="text-[10px] text-accent-secondary truncate">{state.customBeatName}</span>}
            {state.customBeatUrl && <button onClick={() => clearCustomMetronomeSound("beat")} className="text-text-dim hover:text-accent-danger text-xs">✕</button>}
          </div>
          <input ref={beatRef} type="file" accept=".wav,.mp3,.ogg" className="hidden"
            onChange={e => { if (e.target.files?.[0]) void handleFile("beat", e.target.files[0]); e.target.value = ""; }} />
        </div>

        <p className="text-[10px] text-text-dim">Ohne Custom Sound: synthetischer Klick. Max. 2 MB pro Datei.</p>
      </div>
    </div>
  );
}

/**
 * Banner, der oberhalb jeder MIDI-Section angezeigt wird und auf den
 * vollständigen MIDI-Modal (MidiSettings.tsx, Ctrl+M) verweist. Dort sind
 * Auto-Learn, Hardware-Templates (Korg Electribe 2 etc.), MIDI-Monitor und
 * der Live-Activity-Indicator zuhause — die SettingsPanel-Sections decken
 * historisch nur einen Subset ab.
 */
function AdvancedMidiBanner({ onOpenAdvancedMidi }: { onOpenAdvancedMidi?: () => void }) {
  if (!onOpenAdvancedMidi) return null;
  return (
    <div
      data-testid="advanced-midi-banner"
      className="mb-4 rounded-lg border border-accent-secondary/60 bg-accent-secondary/10 p-3"
    >
      <div className="flex items-start gap-3">
        <span className="text-xl leading-none" aria-hidden="true">🎛</span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-accent-secondary mb-1">
            Erweiterte MIDI-Einstellungen
          </div>
          <div className="text-[11px] text-text-muted leading-relaxed">
            Auto-Learn (Mixer / Pads / Komplett-Presets), 12 Hardware-Templates
            (Korg Electribe 2, MPK Mini, X-Touch Mini, Volca Beats, TR-8 …),
            MIDI-Monitor mit Live-Aktivitäts-Anzeige sowie Layout-Import /
            -Export findest du im vollständigen MIDI-Dialog.
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenAdvancedMidi}
          className="px-3 py-1.5 rounded text-xs font-medium bg-accent-secondary text-bg-base hover:bg-accent-secondary/80 flex-shrink-0"
          title="Vollen MIDI-Dialog öffnen (Tastatur: Strg+M)"
          data-testid="advanced-midi-open"
        >
          Öffnen
        </button>
      </div>
    </div>
  );
}

function MidiDevicesSection({ midi, onOpenAdvancedMidi }: { midi: MidiState & MidiActions; onOpenAdvancedMidi?: () => void }) {
  return (
    <div className="space-y-4">
      <AdvancedMidiBanner onOpenAdvancedMidi={onOpenAdvancedMidi} />
      <h3 className="text-sm font-bold text-text-primary">MIDI Geräte & Clock</h3>
      {!midi.isAvailable ? (
        <div className="text-xs text-accent-danger">Web MIDI API nicht verfügbar (Chrome/Edge empfohlen).</div>
      ) : !midi.isEnabled ? (
        <button onClick={midi.enable} className="px-4 py-2 rounded bg-accent-primary text-white text-xs font-bold">
          MIDI aktivieren
        </button>
      ) : (
        <>
          {/* MIDI Eingang */}
          <div>
            <h4 className="text-xs font-semibold text-text-muted mb-2">Eingang (Input)</h4>
            <select value={midi.activeDeviceId ?? ""}
              onChange={e => midi.setActiveDevice(e.target.value || null)}
              className="w-full bg-bg-elevated text-text-primary text-xs px-3 py-2 rounded border border-border-color">
              <option value="">Alle Geräte</option>
              {midi.devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>

          {/* MIDI Ausgang */}
          <div>
            <h4 className="text-xs font-semibold text-text-muted mb-2">Ausgang (Output)</h4>
            <label className="flex items-center gap-2 mb-2 cursor-pointer">
              <input type="checkbox" checked={midi.midiOutEnabled}
                onChange={e => midi.setMidiOutEnabled(e.target.checked)} className="accent-accent-primary" />
              <span className="text-xs text-text-primary">MIDI Out aktiv (Steps an Hardware-Synth senden)</span>
            </label>
            {midi.midiOutEnabled && (
              <>
                <select value={midi.activeOutputDeviceId ?? ""}
                  onChange={e => midi.setActiveOutputDevice(e.target.value || null)}
                  className="w-full mb-2 bg-bg-elevated text-text-primary text-xs px-3 py-2 rounded border border-border-color">
                  <option value="">Ausgangsgerät wählen</option>
                  {midi.outputDevices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <div className="flex items-center gap-2 mb-2">
                  <label className="text-xs text-text-muted">MIDI-Kanal:</label>
                  <input type="number" min={1} max={16} value={midi.midiOutChannel}
                    onChange={e => midi.setMidiOutChannel(Number(e.target.value))}
                    className="w-16 bg-bg-elevated text-text-primary text-xs px-2 py-1 rounded border border-border-color" />
                  <span className="text-[10px] text-text-dim">(10 = GM Drums)</span>
                </div>
                {/* v1.89: MIDI-Output-Test-Button */}
                {midi.activeOutputDeviceId && (
                  <div className="flex items-center gap-2 pt-1 border-t border-border-color/50">
                    <button
                      type="button"
                      onClick={() => {
                        // Note On 60 (C4) + 250ms später Note Off → kurzer Test-Ton
                        midi.sendNoteOn(60, 100);
                        setTimeout(() => midi.sendNoteOff(60), 250);
                      }}
                      className="px-2 py-1 text-[10px] rounded bg-accent-primary/30 hover:bg-accent-primary/50 text-accent-primary"
                      title="Note On 60 (C4) für 250ms — testet ob das Ausgangsgerät reagiert"
                    >
                      🔊 Note testen
                    </button>
                    <button
                      type="button"
                      onClick={() => midi.sendCC(74, 100)}
                      className="px-2 py-1 text-[10px] rounded bg-accent-secondary/30 hover:bg-accent-secondary/50 text-accent-secondary"
                      title="CC 74 (Filter) auf Wert 100 — testet ob CCs ankommen"
                    >
                      🎛 CC testen
                    </button>
                    {/* v1.98: MIDI Panic */}
                    <button
                      type="button"
                      onClick={midi.sendPanic}
                      className="px-2 py-1 text-[10px] rounded bg-accent-danger/30 hover:bg-accent-danger/50 text-accent-danger font-semibold"
                      title="MIDI Panic — sendet All Notes Off + All Sound Off auf allen 16 Channels. Löst hängende Noten."
                    >
                      🚨 Panic
                    </button>
                    <span className="text-[10px] text-text-dim ml-auto">
                      Test / Reset ans aktive Ausgangsgerät
                    </span>
                  </div>
                )}
                {/* v1.97: MIDI-Clock-Out — sendet 24 PPQ an aktives Output-Device */}
                {midi.activeOutputDeviceId && (
                  <label className="flex items-center gap-2 cursor-pointer pt-2 border-t border-border-color/50">
                    <input type="checkbox" checked={midi.clockOutEnabled}
                      onChange={e => midi.setClockOutEnabled(e.target.checked)} className="accent-accent-primary" />
                    <span className="text-xs text-text-primary">
                      MIDI-Clock senden ({midi.clockOutBpm} BPM, 24 PPQ)
                    </span>
                    <span className="text-[10px] text-text-dim ml-auto">
                      v1.97: Externe Synths synct zu Synthstudio
                    </span>
                  </label>
                )}
              </>
            )}
          </div>

          {/* MIDI Clock */}
          <div>
            <h4 className="text-xs font-semibold text-text-muted mb-2">Clock Sync</h4>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={midi.clockSync} onChange={e => midi.setClockSync(e.target.checked)} className="accent-accent-primary" />
              <span className="text-xs text-text-primary">MIDI Clock Sync (empfange BPM vom Controller)</span>
            </label>
            {midi.clockSync && midi.externalBpm !== null && (
              <div className="text-xs text-accent-secondary mt-1">Externer BPM: {midi.externalBpm}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ChordMemorySection() {
  const chordState = useChordMemoryStore();
  const allTypes = Object.keys(CHORD_LABELS) as ChordType[];

  return (
    <div>
      <h3 className="text-sm font-bold text-text-primary mb-4">Chord Memory</h3>
      <p className="text-xs text-text-dim mb-3">
        Eine einzelne MIDI-Note löst automatisch den gewählten Akkord aus.
      </p>

      <label className="flex items-center gap-2 mb-4 cursor-pointer">
        <input type="checkbox" checked={chordState.enabled}
          onChange={e => setChordMemoryEnabled(e.target.checked)} className="accent-accent-primary" />
        <span className="text-xs text-text-primary font-medium">Chord Memory aktiv</span>
      </label>

      {chordState.enabled && (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-text-muted block mb-1.5">Akkord-Typ</label>
            <div className="grid grid-cols-4 gap-1">
              {allTypes.map(t => (
                <button key={t} onClick={() => setChordType(t)}
                  className={`py-1 text-xs rounded border transition-colors ${chordState.chordType === t ? "border-accent-primary bg-accent-primary/20 text-accent-primary" : "border-border-color text-text-dim hover:text-text-primary"}`}>
                  {CHORD_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-xs text-text-muted block mb-1">Lage (Voicing)</label>
              <div className="flex gap-1">
                {([0, 1, 2] as const).map(v => (
                  <button key={v} onClick={() => setChordVoicing(v)}
                    className={`flex-1 py-1 text-xs rounded border ${chordState.voicing === v ? "border-accent-secondary text-accent-secondary bg-accent-secondary/20" : "border-border-color text-text-dim"}`}>
                    {v === 0 ? "Grund" : `${v}. Umk`}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1">
              <label className="text-xs text-text-muted block mb-1">Oktaven-Spread</label>
              <div className="flex gap-1">
                {([0, 1, 2] as const).map(s => (
                  <button key={s} onClick={() => setChordSpread(s)}
                    className={`flex-1 py-1 text-xs rounded border ${chordState.spread === s ? "border-accent-secondary text-accent-secondary bg-accent-secondary/20" : "border-border-color text-text-dim"}`}>
                    +{s * 12}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MpeSectionSimple() {
  const [enabled, setEnabled] = React.useState(false);
  const [pbRange, setPbRange] = React.useState(48);

  useEffect(() => {
    localStorage.setItem("ss-mpe-enabled", enabled ? "1" : "0");
    localStorage.setItem("ss-mpe-pb-range", String(pbRange));
  }, [enabled, pbRange]);

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-text-primary">MPE (MIDI Polyphonic Expression)</h3>
      <p className="text-xs text-text-dim">
        MPE ermöglicht individuelle Pitch Bend, Pressure und Timbre-Kontrolle pro Note.
        Geeignet für MPE-fähige Controller wie ROLI Seaboard, Linnstrument, Sensel Morph.
      </p>

      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}
          className="accent-accent-primary" />
        <span className="text-xs text-text-primary font-medium">MPE-Modus aktivieren</span>
      </label>

      {enabled && (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-text-muted block mb-1">
              Pitch-Bend-Bereich: <span className="font-mono text-accent-secondary">±{pbRange} Halbtöne</span>
            </label>
            <input type="range" min={1} max={96} value={pbRange}
              onChange={e => setPbRange(Number(e.target.value))}
              className="w-full accent-accent-primary" />
            <div className="flex justify-between text-[10px] text-text-dim mt-0.5">
              <span>±1 (eng)</span><span>±48 (MPE Standard)</span><span>±96 (max)</span>
            </div>
          </div>

          <div className="text-[10px] text-text-dim space-y-0.5">
            <div>• MIDI Kanal 1 = Global Zone</div>
            <div>• Kanäle 2–15 = individuelle Noten-Kanäle</div>
            <div>• CC#74 = Timbre/Slide (z.B. Filtersteuerung)</div>
            <div>• Aftertouch = Pressure (z.B. Vibrato/Intensity)</div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * MidiLayoutImportButton — File-Picker für Synthstudio-JSON Layouts
 * (MIDI-Controller-Mapping-Import, post-v1.38.0).
 *
 * Akzeptiert eine `.json`-Datei im Format aus `utils/midiLayoutImport.ts`.
 * Bei Erfolg ruft `midi.loadTemplate(cc, notes)` auf — bestehende Mappings
 * werden komplett ersetzt (genau wie bei den vordefinierten Hardware-Templates).
 */
function MidiLayoutImportButton({
  midi,
  parts,
}: {
  midi: MidiState & MidiActions;
  parts: PartData[];
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [feedback, setFeedback] = React.useState<{ kind: "ok" | "error"; msg: string } | null>(null);

  // Auto-clear feedback nach 5s
  React.useEffect(() => {
    if (!feedback) return;
    const id = setTimeout(() => setFeedback(null), 5000);
    return () => clearTimeout(id);
  }, [feedback]);

  const handleFile = async (file: File) => {
    setFeedback(null);
    if (!file.name.toLowerCase().endsWith(".json")) {
      setFeedback({ kind: "error", msg: "Bitte eine .json-Datei wählen." });
      return;
    }
    try {
      const text = await file.text();
      const result = parseMidiLayoutJson(text);
      if (!result.ok || !result.layout) {
        setFeedback({ kind: "error", msg: result.error ?? "Parse fehlgeschlagen." });
        return;
      }
      // Cross-Check: gibt es Note-Mappings die unbekannte partIds referenzieren?
      const knownIds = parts.map((p) => p.id);
      const partWarnings = checkPartIdsExist(result.layout.noteMappings, knownIds);
      const totalWarnings = (result.warnings?.length ?? 0) + partWarnings.length;

      midi.loadTemplate(result.layout.ccMappings, result.layout.noteMappings);

      const cc = result.layout.ccMappings.length;
      const notes = result.layout.noteMappings.length;
      const name = result.layout.name ? ` "${result.layout.name}"` : "";
      const warnSuffix = totalWarnings > 0 ? ` (${totalWarnings} Warnungen — siehe Konsole)` : "";
      setFeedback({
        kind: "ok",
        msg: `Layout${name} importiert: ${cc} CC + ${notes} Note Mappings.${warnSuffix}`,
      });
      if (result.warnings?.length) {
        console.warn("[MidiLayoutImport] Parser-Warnungen:", result.warnings);
      }
      if (partWarnings.length) {
        console.warn("[MidiLayoutImport] Part-Warnungen:", partWarnings);
      }
    } catch (e) {
      setFeedback({ kind: "error", msg: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        title="MIDI-Layout aus JSON-Datei importieren"
        data-testid="midi-layout-import-btn"
        className="px-2 py-1 text-xs rounded border border-accent-secondary/50 text-accent-secondary hover:bg-accent-secondary/10"
      >
        📥 Layout importieren
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = "";
        }}
      />
      {feedback && (
        <span
          data-testid="midi-layout-import-feedback"
          className={[
            "text-[10px] ml-2",
            feedback.kind === "ok" ? "text-accent-success" : "text-accent-danger",
          ].join(" ")}
        >
          {feedback.msg}
        </span>
      )}
    </>
  );
}

function MidiCcSection({ midi, parts, onOpenAdvancedMidi }: { midi: MidiState & MidiActions; parts: PartData[]; onOpenAdvancedMidi?: () => void }) {
  const targets = buildCcTargets(parts);
  const categories = [...new Set(targets.map(t => t.category))];

  const getExisting = (target: MidiLearnTarget) =>
    midi.mappings.find(m => JSON.stringify(m.target) === JSON.stringify(target));

  const isLearning = (target: MidiLearnTarget) =>
    midi.isLearning && JSON.stringify(midi.learnTarget) === JSON.stringify(target);

  return (
    <div>
      <AdvancedMidiBanner onOpenAdvancedMidi={onOpenAdvancedMidi} />
      <div className="flex items-center gap-3 mb-4">
        <h3 className="text-sm font-bold text-text-primary">MIDI CC-Zuweisungen</h3>
        <MidiLayoutImportButton midi={midi} parts={parts} />
        {midi.mappings.length > 0 && (
          <button onClick={midi.clearAllMappings} className="ml-auto text-xs text-accent-danger hover:opacity-80">
            Alle löschen
          </button>
        )}
      </div>
      <p className="text-xs text-text-dim mb-4">
        Klicke auf eine Funktion → drücke einen CC-Regler → Zuweisung gespeichert.
        {midi.isLearning && <span className="ml-2 text-accent-primary font-bold animate-pulse">Warte auf MIDI-Signal…</span>}
      </p>

      {categories.map(cat => (
        <div key={cat} className="mb-5">
          <div className="text-[10px] text-text-dim uppercase tracking-widest mb-2 border-b border-border-color pb-1">{cat}</div>
          <div className="space-y-1">
            {targets.filter(t => t.category === cat).map((def, i) => {
              const existing = getExisting(def.target);
              const learning = isLearning(def.target);
              return (
                <div key={i} className={`flex items-center gap-2 px-2 py-1.5 rounded transition-colors ${learning ? "bg-accent-primary/20 ring-1 ring-accent-primary" : "hover:bg-bg-elevated"}`}>
                  <span className="flex-1 text-xs text-text-muted">{def.label}</span>
                  <button
                    onClick={() => learning ? midi.cancelLearn() : midi.startLearn(def.target)}
                    className={`min-w-[80px] px-2 py-0.5 rounded border font-mono text-[11px] text-center transition-colors ${
                      learning ? "border-accent-primary text-accent-primary animate-pulse" :
                      existing ? "border-accent-secondary text-accent-secondary hover:border-accent-danger" :
                      "border-border-color text-text-dim hover:border-accent-primary hover:text-text-primary"
                    }`}
                  >
                    {learning ? "…" : existing ? `CC${existing.cc}${existing.channel ? ` Ch${existing.channel}` : ""}` : "Zuweisen"}
                  </button>
                  {existing && (
                    <button onClick={() => midi.removeMapping(existing.cc, existing.channel)}
                      className="text-text-dim hover:text-accent-danger text-sm leading-none flex-shrink-0" title="Entfernen">✕</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function MidiNotesSection({ midi, parts, onOpenAdvancedMidi }: { midi: MidiState & MidiActions; parts: PartData[]; onOpenAdvancedMidi?: () => void }) {
  const [manualNote, setManualNote] = useState(36);
  const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","A","A#","H"];
  const noteToName = (n: number) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

  return (
    <div>
      <AdvancedMidiBanner onOpenAdvancedMidi={onOpenAdvancedMidi} />
      <h3 className="text-sm font-bold text-text-primary mb-4">MIDI Note-Zuweisungen</h3>
      <div className="space-y-2 mb-4">
        {parts.map(part => {
          const mapping = midi.noteMappings.find(m => m.partId === part.id);
          return (
            <div key={part.id} className="flex items-center gap-2 px-2 py-1.5 rounded border border-border-color hover:border-border-subtle">
              <span className="flex-1 text-xs text-text-primary">{part.name}</span>
              {mapping ? (
                <>
                  <span className="font-mono text-xs text-accent-secondary">{noteToName(mapping.note)} (Note {mapping.note})</span>
                  <button onClick={() => midi.removeNoteMapping(mapping.note, mapping.channel)} className="text-text-dim hover:text-accent-danger text-sm">✕</button>
                </>
              ) : (
                <span className="text-xs text-text-dim">–</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="border-t border-border-color pt-3">
        <div className="text-xs text-text-muted mb-2">Neue Zuweisung manuell</div>
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] text-text-dim">Note</label>
            <div className="flex items-center gap-1">
              <input type="number" min={0} max={127} value={manualNote} onChange={e => setManualNote(Number(e.target.value))}
                className="w-16 bg-bg-elevated text-text-primary text-xs px-2 py-1 rounded border border-border-color" />
              <span className="text-xs text-text-dim">{noteToName(manualNote)}</span>
            </div>
          </div>
          {parts.map(part => (
            <button key={part.id}
              onClick={() => midi.addNoteMapping(manualNote, 0, part.id, part.name)}
              className="px-2 py-1 text-[10px] rounded bg-bg-elevated text-text-muted hover:bg-accent-primary/20 hover:text-accent-primary transition-colors">
              → {part.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SavingSection() {
  const api = useApiSettingsStore();

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-bold text-text-primary">Speichern & Auto-Save</h3>

      {/* Auto-Save */}
      <div className="rounded-lg border border-border-color p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-text-primary">Auto-Save</div>
            <div className="text-[10px] text-text-dim mt-0.5">
              Speichert das Projekt automatisch im Browser-Cache
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={api.autoSaveEnabled}
              onChange={e => setAutoSaveEnabled(e.target.checked)}
              className="accent-accent-primary w-4 h-4" />
            <span className={`text-xs font-bold ${api.autoSaveEnabled ? "text-accent-success" : "text-text-dim"}`}>
              {api.autoSaveEnabled ? "AN" : "AUS"}
            </span>
          </label>
        </div>

        {api.autoSaveEnabled && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-text-muted">Intervall:</span>
            <div className="flex gap-1">
              {[1, 3, 5, 10, 15].map(min => (
                <button key={min} onClick={() => setAutoSaveInterval(min)}
                  className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                    api.autoSaveIntervalMin === min
                      ? "border-accent-primary bg-accent-primary/20 text-accent-primary"
                      : "border-border-color text-text-dim hover:text-text-primary"
                  }`}>
                  {min} Min
                </button>
              ))}
            </div>
            <span className="text-[10px] text-text-dim">
              Nächster Save in ~{api.autoSaveIntervalMin} Min.
            </span>
          </div>
        )}
      </div>

      {/* Version Snapshots */}
      <div className="rounded-lg border border-border-color p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-text-primary">Version-Snapshots</div>
            <div className="text-[10px] text-text-dim mt-0.5">
              Erstellt alle 5 Minuten einen Checkpoint (max. 10) → Kollaborations-Tab
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={api.snapshotsEnabled}
              onChange={e => setSnapshotsEnabled(e.target.checked)}
              className="accent-accent-secondary w-4 h-4" />
            <span className={`text-xs font-bold ${api.snapshotsEnabled ? "text-accent-success" : "text-text-dim"}`}>
              {api.snapshotsEnabled ? "AN" : "AUS"}
            </span>
          </label>
        </div>
        {api.snapshotsEnabled && (
          <div className="text-[10px] text-text-dim">
            Snapshots findest du im Kollaborations-Tab → Version-Snapshots.
            Sie werden nicht beim Schließen gelöscht.
          </div>
        )}
      </div>

      {/* Info */}
      <div className="text-[10px] text-text-dim space-y-1 border-t border-border-color pt-3">
        <div>💡 <strong>Auto-Save</strong> speichert im <code>localStorage</code> des Browsers — kein echter Datei-Export.</div>
        <div>💡 Zum echten Speichern: <strong>Ctrl+S</strong> oder ProjectManager → Speichern (exportiert <code>.synth</code>-Datei).</div>
        <div>💡 Beim nächsten App-Start wird der letzte Auto-Save automatisch geladen.</div>
      </div>
    </div>
  );
}

function OscSection() {
  const [url, setUrl] = React.useState("ws://localhost:8080");
  const [connected, setConnected] = React.useState(false);
  const wsRef = React.useRef<WebSocket | null>(null);
  // v2.23: Direkter UDP-Listener (Electron-only)
  const electron = useElectron();
  // v2.26: OSC-Out (BPM-Sync etc.)
  const oscOut = useOscOutConfig();
  const testSendOscOut = async () => {
    if (!electron.isElectron) return;
    const res = await electron.sendOscMessage({
      host: oscOut.host,
      port: oscOut.port,
      address: "/synth/test",
      args: [123.45],
    });
    if (res.success) {
      toast(`Test-OSC an ${oscOut.host}:${oscOut.port} gesendet`, { kind: "success" });
    } else {
      toast(`OSC-Send fehlgeschlagen: ${res.error}`, { kind: "error" });
    }
  };
  const [udpPort, setUdpPort] = React.useState(7400);
  const [udpAcceptNetwork, setUdpAcceptNetwork] = React.useState(false);
  const [udpStatus, setUdpStatus] = React.useState<{
    listening: boolean;
    port: number | null;
    bindHost: string | null;
    receivedCount: number;
    errorCount: number;
    lastMessage: { address: string; args: Array<number | string | boolean | null>; source: string; at: number } | null;
  } | null>(null);
  React.useEffect(() => {
    if (!electron.isElectron) return;
    let stop = false;
    const tick = async () => {
      const s = await electron.getOscServerStatus();
      if (!stop) setUdpStatus(s);
    };
    void tick();
    const id = window.setInterval(tick, 1000);
    return () => { stop = true; window.clearInterval(id); };
  }, [electron]);
  const startUdp = async () => {
    if (!electron.isElectron) return;
    const res = await electron.startOscServer({ port: udpPort, acceptFromNetwork: udpAcceptNetwork });
    if (!res.success) {
      toast(`UDP-Listener konnte nicht gestartet werden: ${res.error ?? "Unbekannter Fehler"}`, { kind: "error" });
    } else {
      toast(`OSC-UDP-Listener läuft auf ${udpAcceptNetwork ? "0.0.0.0" : "127.0.0.1"}:${res.port}`, { kind: "success" });
    }
  };
  const stopUdp = async () => {
    if (!electron.isElectron) return;
    await electron.stopOscServer();
    toast("OSC-UDP-Listener gestoppt", { kind: "info" });
  };

  const connect = () => {
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    try {
      const ws = new WebSocket(url);
      ws.onopen  = () => setConnected(true);
      ws.onclose = () => { setConnected(false); wsRef.current = null; };
      ws.onerror = () => { setConnected(false); wsRef.current = null; };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          window.dispatchEvent(new CustomEvent("osc:message", { detail: msg }));
        } catch { /* ignore */ }
      };
      wsRef.current = ws;
    } catch { setConnected(false); }
  };

  React.useEffect(() => () => { wsRef.current?.close(); }, []);

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-text-primary">OSC (Open Sound Control)</h3>

      {/* v2.23: Direkter UDP-Listener (Electron-only) */}
      {electron.isElectron && (
        <div className="rounded-lg border border-accent-secondary/50 bg-accent-secondary/5 p-3 space-y-2" data-testid="osc-udp-listener">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-accent-secondary">📡 Direkter UDP-Listener</div>
            {udpStatus?.listening && (
              <span className="text-[10px] text-accent-success font-mono">
                ● {udpStatus.bindHost}:{udpStatus.port} · {udpStatus.receivedCount} msgs
              </span>
            )}
          </div>
          <p className="text-[10px] text-text-muted leading-relaxed">
            Empfange OSC direkt per UDP — keine Bridge nötig. TouchOSC, Lemur,
            Reaktor und CLI-Tools wie <code>oscchief</code> können direkt senden.
            Default-Bind ist <code>127.0.0.1</code> (localhost-only).
          </p>
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-text-muted">Port:</label>
            <input
              type="number"
              min={1024}
              max={65535}
              value={udpPort}
              onChange={e => setUdpPort(Number(e.target.value))}
              disabled={udpStatus?.listening}
              className="w-20 text-xs bg-bg-elevated border border-border-color rounded px-2 py-1 text-text-primary disabled:opacity-50"
              data-testid="osc-udp-port"
            />
            <label className="flex items-center gap-1 text-[10px] text-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={udpAcceptNetwork}
                onChange={e => setUdpAcceptNetwork(e.target.checked)}
                disabled={udpStatus?.listening}
                className="accent-accent-secondary"
              />
              auch aus dem Netzwerk
            </label>
            {udpStatus?.listening ? (
              <button
                onClick={stopUdp}
                className="ml-auto px-2 py-1 text-[11px] rounded bg-accent-danger text-white"
                data-testid="osc-udp-stop"
              >
                Stoppen
              </button>
            ) : (
              <button
                onClick={startUdp}
                className="ml-auto px-2 py-1 text-[11px] rounded bg-accent-secondary text-bg-base"
                data-testid="osc-udp-start"
              >
                Starten
              </button>
            )}
          </div>
          {udpStatus?.lastMessage && (
            <div className="text-[10px] text-text-dim font-mono border-t border-border-color pt-2">
              <span className="text-text-muted">letzte:</span> {udpStatus.lastMessage.address}
              {udpStatus.lastMessage.args.length > 0 && (
                <span className="text-accent-secondary"> {JSON.stringify(udpStatus.lastMessage.args)}</span>
              )}
              <span className="text-text-dim ml-2">← {udpStatus.lastMessage.source}</span>
            </div>
          )}
        </div>
      )}

      {/* v2.26: OSC-Out (Electron-only) */}
      {electron.isElectron && (
        <div className="rounded-lg border border-accent-primary/40 bg-accent-primary/5 p-3 space-y-2" data-testid="osc-udp-sender">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-accent-primary">📤 OSC-Out (BPM-Sync)</div>
            <label className="flex items-center gap-1 text-[10px] text-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={oscOut.enabled}
                onChange={e => setOscOutConfig({ enabled: e.target.checked })}
                className="accent-accent-primary"
                data-testid="osc-out-enabled"
              />
              aktiv
            </label>
          </div>
          <p className="text-[10px] text-text-muted leading-relaxed">
            Sendet bei jeder BPM-Änderung <code>/synth/bpm/current &lt;float&gt;</code> per
            UDP. Nutze einen externen OSC-Receiver (TouchOSC, Lemur, Reaktor,
            MaxMSP, PD) am angegebenen Host/Port.
          </p>
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-text-muted">Host:</label>
            <input
              type="text"
              value={oscOut.host}
              onChange={e => setOscOutConfig({ host: e.target.value })}
              placeholder="127.0.0.1"
              className="flex-1 text-xs bg-bg-elevated border border-border-color rounded px-2 py-1 text-text-primary"
              data-testid="osc-out-host"
            />
            <label className="text-[10px] text-text-muted">Port:</label>
            <input
              type="number"
              min={1}
              max={65535}
              value={oscOut.port}
              onChange={e => setOscOutConfig({ port: Number(e.target.value) })}
              className="w-20 text-xs bg-bg-elevated border border-border-color rounded px-2 py-1 text-text-primary"
              data-testid="osc-out-port"
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <label className="flex items-center gap-1 text-[10px] text-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={oscOut.syncBpm}
                onChange={e => setOscOutConfig({ syncBpm: e.target.checked })}
                disabled={!oscOut.enabled}
                className="accent-accent-primary"
              />
              BPM
            </label>
            <label className="flex items-center gap-1 text-[10px] text-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={oscOut.syncTransport}
                onChange={e => setOscOutConfig({ syncTransport: e.target.checked })}
                disabled={!oscOut.enabled}
                className="accent-accent-primary"
                data-testid="osc-out-sync-transport"
              />
              Transport
            </label>
            <label className="flex items-center gap-1 text-[10px] text-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={oscOut.syncStep}
                onChange={e => setOscOutConfig({ syncStep: e.target.checked })}
                disabled={!oscOut.enabled}
                className="accent-accent-primary"
                data-testid="osc-out-sync-step"
              />
              Step-Position
            </label>
            <label className="flex items-center gap-1 text-[10px] text-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={oscOut.syncMutes}
                onChange={e => setOscOutConfig({ syncMutes: e.target.checked })}
                disabled={!oscOut.enabled}
                className="accent-accent-primary"
                data-testid="osc-out-sync-mutes"
              />
              Mutes
            </label>
            <label className="flex items-center gap-1 text-[10px] text-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={oscOut.syncMacros}
                onChange={e => setOscOutConfig({ syncMacros: e.target.checked })}
                disabled={!oscOut.enabled}
                className="accent-accent-primary"
                data-testid="osc-out-sync-macros"
              />
              Macros
            </label>
            <label className="flex items-center gap-1 text-[10px] text-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={oscOut.syncVolumes}
                onChange={e => setOscOutConfig({ syncVolumes: e.target.checked })}
                disabled={!oscOut.enabled}
                className="accent-accent-primary"
                data-testid="osc-out-sync-volumes"
              />
              Volumes
            </label>
            <label className="flex items-center gap-1 text-[10px] text-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={oscOut.syncPatternSwitch}
                onChange={e => setOscOutConfig({ syncPatternSwitch: e.target.checked })}
                disabled={!oscOut.enabled}
                className="accent-accent-primary"
                data-testid="osc-out-sync-pattern"
              />
              Pattern
            </label>
            {oscOut.syncStep && (
              <span className="flex items-center gap-1 text-[10px] text-text-muted">
                jeden
                <input
                  type="number"
                  min={1}
                  max={16}
                  value={oscOut.stepRate}
                  onChange={e => setOscOutConfig({ stepRate: Number(e.target.value) })}
                  disabled={!oscOut.enabled}
                  className="w-12 bg-bg-elevated border border-border-color rounded px-1 py-0.5 text-text-primary"
                  title="1 = jeden Step, 4 = jeden Viertel, 16 = einmal pro Bar"
                  data-testid="osc-out-step-rate"
                />
                Step
              </span>
            )}
            <button
              type="button"
              onClick={testSendOscOut}
              disabled={!oscOut.enabled}
              className="ml-auto px-2 py-1 text-[11px] rounded bg-accent-primary text-bg-base disabled:opacity-40 disabled:cursor-not-allowed"
              data-testid="osc-out-test"
            >
              Test senden
            </button>
          </div>
        </div>
      )}

      <p className="text-xs text-text-dim">
        Alternativ: verbinde Synthstudio mit TouchOSC, Protokol oder einem anderen OSC-fähigen Gerät
        über eine WebSocket-Bridge (z.B. <code className="text-accent-secondary">osc-websocket-bridge</code>).
      </p>

      <div className="flex gap-2">
        <input value={url} onChange={e => setUrl(e.target.value)}
          placeholder="ws://localhost:8080"
          className="flex-1 text-xs bg-bg-elevated border border-border-color rounded px-3 py-2 text-text-primary placeholder:text-text-dim" />
        <button onClick={connect}
          className={`px-3 py-1.5 text-xs rounded font-bold transition-colors ${connected ? "bg-accent-success text-white" : "bg-bg-elevated border border-border-color text-text-muted hover:text-accent-primary"}`}>
          {connected ? "✓ Verbunden" : "Verbinden"}
        </button>
        {connected && <button onClick={() => { wsRef.current?.close(); setConnected(false); }}
          className="px-2 py-1.5 text-xs rounded text-text-dim hover:text-accent-danger border border-border-color">✕</button>}
      </div>

      <div className="text-[10px] text-text-dim space-y-1 border-t border-border-color pt-3">
        <div className="font-semibold text-text-muted mb-1">OSC-Adress-Mapping:</div>
        <div><code className="text-accent-secondary">/synthstudio/play</code> → Play/Stop</div>
        <div><code className="text-accent-secondary">/synthstudio/bpm</code> <span className="text-text-dim">float</span> → BPM setzen</div>
        <div><code className="text-accent-secondary">/synthstudio/volume/{"{0-8}"}</code> <span className="text-text-dim">float 0–1</span> → Kanal-Volume</div>
        <div><code className="text-accent-secondary">/synthstudio/macro/{"{0-7}"}</code> <span className="text-text-dim">float 0–1</span> → Makro-Wert</div>
        <div><code className="text-accent-secondary">/synthstudio/scene/{"{1-8}"}</code> → Scene starten</div>
      </div>
    </div>
  );
}

/**
 * PatchesSection — UI für die in v2.16 eingeführte Hot-Swap-Patch-Library.
 * Vor v2.19 war der Store `usePatchStore` zwar implementiert, aber nirgends
 * im UI angebunden — die Patches waren reines dead code. Diese Section
 * exponiert: Liste, Inline-Rename, Delete, Library-Export/Import, Clear-All.
 * Das eigentliche "Save Patch from Part"-Affordance lebt in den
 * Part-Editor-Panels (Synth/Granular/Sampler) und kommt in einer Folge-Welle.
 */
function PatchesSection() {
  const { patches } = usePatchStore();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  // v2.33: Suche/Filter — bis zu 200 Patches sind ohne Suche unbedienbar.
  const [query, setQuery] = React.useState("");
  const filteredPatches = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return patches;
    return patches.filter(p => {
      if (p.name.toLowerCase().includes(q)) return true;
      if ((p.sourceType ?? "").toLowerCase().includes(q)) return true;
      if (p.tags?.some(t => t.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [patches, query]);

  const startRename = (id: string, current: string) => {
    setEditingId(id);
    setDraft(current);
  };
  const commitRename = () => {
    if (editingId && draft.trim()) renamePatch(editingId, draft);
    setEditingId(null);
  };
  const handleExport = () => {
    const blob = new Blob([exportPatchLibrary()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `synthstudio-patches-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`${patches.length} Patches exportiert`, { kind: "success" });
  };
  const handleImport = async (file: File) => {
    const text = await file.text();
    const count = importPatchLibrary(text, "merge");
    if (count > 0) {
      toast(`${count} Patches importiert (Merge)`, { kind: "success" });
    } else {
      toast("Keine Patches in der Datei gefunden", { kind: "error" });
    }
  };
  const handleClear = () => {
    if (!patches.length) return;
    if (confirm(`Alle ${patches.length} Patches löschen? Das kann nicht rückgängig gemacht werden.`)) {
      clearAllPatches();
      toast("Patch-Library geleert", { kind: "info" });
    }
  };

  const sourceTypeLabel = (t?: string): string => {
    switch (t) {
      case "wavetable": return "Wavetable";
      case "fm":        return "FM";
      case "granular":  return "Granular";
      case "sample":    return "Sample";
      default:          return "—";
    }
  };

  return (
    <div data-testid="patches-section">
      <div className="flex items-center gap-3 mb-4">
        <h3 className="text-sm font-bold text-text-primary">Patch-Library</h3>
        <span className="text-xs text-text-dim">{patches.length} / 200</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            disabled={patches.length === 0}
            className="px-2 py-1 text-[11px] rounded border border-border-color text-text-muted hover:text-text-primary hover:border-accent-secondary disabled:opacity-40 disabled:cursor-not-allowed"
            title="Library als JSON-Datei herunterladen"
          >
            Exportieren
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-2 py-1 text-[11px] rounded border border-border-color text-text-muted hover:text-text-primary hover:border-accent-secondary"
            title="JSON-Library importieren (Merge mit bestehenden Patches)"
          >
            Importieren
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) void handleImport(f);
              e.target.value = "";
            }}
            className="hidden"
            data-testid="patches-import-input"
          />
          {patches.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              className="px-2 py-1 text-[11px] rounded text-accent-danger hover:bg-accent-danger/10"
              title="Alle Patches löschen"
            >
              Alle löschen
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-text-muted mb-4 leading-relaxed">
        Patches sind portable Sound-Konfigurationen (Sample / Synth-Parameter /
        FX-Chain) eines Parts. Speichere Klänge die du wiederverwenden willst
        und ziehe sie später auf andere Parts. Library wird im localStorage
        gespeichert (max. 200) — JSON-Export für Backup / Sharing.
      </p>

      {patches.length > 0 && (
        <div className="mb-3 flex items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter nach Name, Type (FM/Wavetable/...) oder Tag"
            className="flex-1 text-xs bg-bg-elevated border border-border-color rounded px-2 py-1 text-text-primary placeholder:text-text-dim"
            data-testid="patches-search"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-text-dim hover:text-text-primary text-xs"
              title="Filter zurücksetzen"
              aria-label="Filter zurücksetzen"
            >
              ✕
            </button>
          )}
          <span className="text-[10px] text-text-dim font-mono">
            {filteredPatches.length}/{patches.length}
          </span>
        </div>
      )}

      {patches.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-color p-8 text-center text-xs text-text-dim">
          Noch keine Patches gespeichert. Aus einem Part-Editor heraus
          (Synth- / Sample- / Granular-Panel) lassen sich Sound-Konfigurationen
          hier ablegen.
        </div>
      ) : filteredPatches.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-color p-6 text-center text-xs text-text-dim">
          Kein Patch matcht „{query}".
        </div>
      ) : (
        <div className="space-y-1.5">
          {filteredPatches.map(p => (
            <div
              key={p.id}
              data-testid={`patch-item-${p.id}`}
              className="flex items-center gap-2 px-3 py-2 rounded border border-border-color hover:border-border-subtle bg-bg-elevated/30"
            >
              <div className="flex-1 min-w-0">
                {editingId === p.id ? (
                  <input
                    autoFocus
                    type="text"
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={e => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="w-full bg-bg-base text-text-primary text-xs px-2 py-0.5 rounded border border-accent-primary"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => startRename(p.id, p.name)}
                    className="text-xs text-text-primary font-medium truncate text-left hover:text-accent-secondary"
                    title="Klick zum Umbenennen"
                  >
                    {p.name}
                  </button>
                )}
                <div className="flex items-center gap-2 text-[10px] text-text-dim mt-0.5">
                  <span className="px-1.5 py-0.5 rounded bg-bg-base">
                    {sourceTypeLabel(p.sourceType)}
                  </span>
                  {p.fx && <span>+FX</span>}
                  {p.tags && p.tags.length > 0 && <span>· {p.tags.join(", ")}</span>}
                  <span className="ml-auto">{new Date(p.createdAt).toLocaleString()}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Patch "${p.name}" löschen?`)) {
                    deletePatch(p.id);
                  }
                }}
                className="text-text-dim hover:text-accent-danger text-xs flex-shrink-0 px-2"
                title="Patch löschen"
                aria-label={`Patch ${p.name} löschen`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PluginsSection() {
  const [url, setUrl] = React.useState("");
  const [plugins, setPlugins] = React.useState<Array<{ id: string; meta: { name: string; version: string; author?: string }; url: string }>>([]);
  const [loading, setLoading] = React.useState(false);
  const [lastError, setLastError] = React.useState<string | null>(null);

  const load = async () => {
    if (!url.trim()) return;
    setLoading(true); setLastError(null);
    const { loadPlugin, getLoadedPlugins } = await import("@/utils/pluginApi");
    const result = await loadPlugin(url.trim(), {});
    setLoading(false);
    if (result.success) { setUrl(""); setPlugins(getLoadedPlugins()); }
    else setLastError(result.error ?? "Unbekannter Fehler");
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-text-primary">Plugins (ESM)</h3>
      <p className="text-xs text-text-dim">
        Lade externe JavaScript-Plugins (ESM-Format) über eine URL. Plugins haben Zugriff
        auf die Synthstudio Plugin API (setBpm, setStep, dispatch, onStep, …).
      </p>

      <div className="flex gap-2">
        <input value={url} onChange={e => setUrl(e.target.value)}
          placeholder="https://example.com/my-plugin.js"
          className="flex-1 text-xs bg-bg-elevated border border-border-color rounded px-3 py-2 text-text-primary placeholder:text-text-dim" />
        <button onClick={load} disabled={loading || !url.trim()}
          className="px-3 py-1.5 text-xs rounded bg-accent-primary text-white hover:opacity-80 disabled:opacity-40 font-bold">
          {loading ? "Lade…" : "Laden"}
        </button>
      </div>
      {lastError && <div className="text-[10px] text-accent-danger">{lastError}</div>}

      {plugins.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] text-text-dim uppercase tracking-wide mb-1">Aktive Plugins</div>
          {plugins.map(p => (
            <div key={p.id} className="flex items-center gap-2 px-3 py-2 rounded bg-bg-elevated border border-border-color text-xs">
              <span className="flex-1">
                <span className="text-text-primary font-medium">{p.meta.name}</span>
                <span className="text-text-dim ml-2">v{p.meta.version}</span>
                {p.meta.author && <span className="text-text-dim ml-2">by {p.meta.author}</span>}
              </span>
              <button onClick={async () => {
                const { unloadPlugin, getLoadedPlugins } = await import("@/utils/pluginApi");
                unloadPlugin(p.id);
                setPlugins(getLoadedPlugins());
              }} className="text-text-dim hover:text-accent-danger">✕</button>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-border-color pt-3 text-[10px] text-text-dim">
        Plugin API: <code className="text-accent-secondary">export function onLoad(api)</code>
        {" · "}
        <code className="text-accent-secondary">api.setBpm()</code>
        {" · "}
        <code className="text-accent-secondary">api.onStep(cb)</code>
        {" · "}
        <code className="text-accent-secondary">api.dispatch()</code>
      </div>
    </div>
  );
}

// ─── License Section (TASK-232-FOLLOWUP-2 / v2.98) ───────────────────────────

function LicenseSection() {
  const state = useLicenseStore();
  const [showActivation, setShowActivation] = useState(false);

  const pro = isPro();
  const days = daysRemainingInTrial();

  // Status-Label + Farbe je Status für leichtes Scannen.
  const statusInfo = (() => {
    if (pro && state.status === "pro") {
      return { label: "Pro — aktiviert", color: "text-accent-success", desc: "Alle Pro-Features freigeschaltet." };
    }
    if (state.status === "trial") {
      return {
        label: `Trial — Tag ${TRIAL_DURATION_DAYS - days + 1} von ${TRIAL_DURATION_DAYS}`,
        color: days <= 3 ? "text-accent-secondary" : "text-accent-primary",
        desc: `Noch ${days} Tag${days === 1 ? "" : "e"} Pro-Features kostenlos.`,
      };
    }
    if (state.status === "expired") {
      return { label: "Trial abgelaufen", color: "text-accent-danger", desc: "Pro-Features sind gesperrt." };
    }
    if (state.status === "invalid") {
      return { label: "Ungültige Lizenz", color: "text-accent-danger", desc: "Die zuletzt eingegebene Lizenz wurde nicht akzeptiert." };
    }
    return { label: "Free", color: "text-text-muted", desc: "Du nutzt die kostenlose Variante." };
  })();

  const handleDeactivate = () => {
    if (!window.confirm("Pro-Lizenz wirklich entfernen? Pro-Features werden gesperrt.")) return;
    clearLicense();
    toast("Lizenz entfernt — Pro-Features gesperrt.", { kind: "info", duration: 4000 });
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-text-primary">Lizenz</h3>

      <div className="rounded border border-border-color bg-bg-elevated p-3 space-y-2" data-testid="settings-license-status">
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted">Status</span>
          <span className={["text-xs font-semibold", statusInfo.color].join(" ")}>
            {statusInfo.label}
          </span>
        </div>
        <div className="text-[11px] text-text-dim">{statusInfo.desc}</div>
        {state.activatedEmail && (
          <div className="text-[11px] text-text-dim">
            Aktiviert für <span className="font-mono text-text-muted">{state.activatedEmail}</span>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setShowActivation(true)}
          data-testid="settings-license-activate"
          className="w-full rounded bg-accent-primary px-4 py-2 text-sm font-medium text-bg-base hover:opacity-90"
        >
          🔑 Lizenz aktivieren
        </button>

        <a
          href={GUMROAD_PRODUCT_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="settings-license-buy"
          className="block w-full rounded border border-accent-secondary/40 text-accent-secondary bg-accent-secondary/10 px-4 py-2 text-sm font-medium text-center hover:bg-accent-secondary/20"
        >
          🛒 Pro-Lizenz kaufen
        </a>

        {state.status === "pro" && (
          <button
            type="button"
            onClick={handleDeactivate}
            data-testid="settings-license-deactivate"
            className="w-full rounded border border-accent-danger/40 text-accent-danger bg-accent-danger/10 px-4 py-2 text-sm font-medium hover:bg-accent-danger/20"
          >
            Lizenz deaktivieren
          </button>
        )}
      </div>

      <div className="border-t border-border-subtle pt-3 text-[10px] text-text-dim space-y-1">
        <div>Pro-Features: Live-Looping, USB-Audio-Eingang, Stem-Bounce, Electribe-Import, MIDI-Note-Out.</div>
        <div>Die Aktivierung läuft offline — kein Konto, kein Tracking.</div>
      </div>

      {/* Re-Mount des ActivationModals mit forceOpen aus dem Settings-Kontext.
          Funktioniert auch wenn das App-Level-ActivationModal bereits gemountet
          ist — beides sind unabhängige Instanzen mit eigenem lokalen Mode-State,
          aber sie teilen sich den Singleton-License-Store. Toggle via lokalem
          showActivation-State. */}
      {showActivation && (
        <ActivationModal forceOpen onClose={() => setShowActivation(false)} />
      )}
    </div>
  );
}

// ─── Audio-Engine-Section (v3.0.0 / TASK-236-ALT) ────────────────────────────
//
// Low-Latency-Konfiguration für den AudioContext. Sicherer Web-Audio-Pfad
// statt nativem WASAPI Exclusive Mode (TASK-236):
//   - latencyHint: 'interactive' → ~10-20ms Output-Latenz auf Windows
//   - sampleRate: 'auto' | 44.1k | 48k | 96k — fixiert den Mix-Sample-Rate
//
// Beim "Apply" wird AudioEngine.reinit() aufgerufen — der AudioContext wird
// kurz geschlossen + neu erzeugt. Playback unterbricht.
function AudioEngineSection() {
  const cfg = useAudioEngineConfigStore();
  const [busy, setBusy] = useState(false);
  // Tickender Latenz-Anzeige-Refresh (~1×/s) — getEstimatedSystemLatencyMs
  // ist kein React-State, also brauchen wir ein Trigger.
  const [, tickLatency] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const t = setInterval(tickLatency, 1000);
    return () => clearInterval(t);
  }, []);

  const latencyMs = AudioEngine.getEstimatedSystemLatencyMs();
  // AudioEngine.ctx ist privat — wir lesen es defensiv über einen
  // strukturellen Cast (kein ts-expect-error, der Cast ist explizit).
  const ctxRate =
    typeof window !== "undefined" && (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext
      ? (AudioEngine as unknown as { ctx?: AudioContext | null }).ctx?.sampleRate ?? null
      : null;
  const rateMismatch =
    typeof cfg.sampleRate === "number" &&
    ctxRate !== null &&
    Math.abs(ctxRate - cfg.sampleRate) > 1;

  const handleApply = async () => {
    setBusy(true);
    try {
      // Toast vor reinit damit User die Unterbrechung erwartet.
      toast("Audio-Engine wird neu gestartet — kurze Unterbrechung …", {
        kind: "info",
        duration: 2500,
      });
      await AudioEngine.reinit();
      toast("Audio-Engine aktualisiert.", { kind: "success", duration: 2500 });
    } catch (e) {
      toast(`Re-Init fehlgeschlagen: ${(e as Error).message ?? "unbekannt"}`, {
        kind: "warning",
        duration: 5000,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="settings-audio-engine">
      <h3 className="text-sm font-bold text-text-primary">Audio Engine</h3>

      <div className="text-[11px] text-text-muted leading-relaxed">
        Konfiguriert den Web-Audio-Context. Niedrigere Latenz reduziert das
        spürbare Verzögerung zwischen Tastendruck und Klang, kostet aber
        mehr CPU und kann bei sehr alten Geräten zu Glitches führen.
        <span className="text-text-dim"> Empfehlung für Live-Performance: „Interactive".</span>
      </div>

      {/* Latency-Hint-Dropdown */}
      <div className="space-y-1">
        <label className="text-xs text-text-muted">Latenz-Profil</label>
        <select
          value={cfg.latencyHint}
          onChange={(e) => setLatencyHint(e.target.value as LatencyHint)}
          data-testid="audio-engine-latency-hint"
          className="w-full bg-bg-elevated border border-border-color rounded px-3 py-2 text-sm text-text-primary focus:border-accent-primary focus:outline-none"
        >
          <option value="interactive">Interactive — ~10-20 ms (empfohlen)</option>
          <option value="balanced">Balanced — ~30-50 ms (Browser-Default)</option>
          <option value="playback">Playback — ~50-200 ms (CPU-schonend)</option>
        </select>
      </div>

      {/* Sample-Rate-Dropdown */}
      <div className="space-y-1">
        <label className="text-xs text-text-muted">Sample-Rate</label>
        <select
          value={String(cfg.sampleRate)}
          onChange={(e) => {
            const v = e.target.value;
            setSampleRate(v === "auto" ? "auto" : (Number(v) as SampleRateOption));
          }}
          data-testid="audio-engine-sample-rate"
          className="w-full bg-bg-elevated border border-border-color rounded px-3 py-2 text-sm text-text-primary focus:border-accent-primary focus:outline-none"
        >
          <option value="auto">Auto — Hardware-Default</option>
          <option value="44100">44.1 kHz — Audio-CD</option>
          <option value="48000">48 kHz — Studio/Video</option>
          <option value="96000">96 kHz — High-Res (CPU-intensiv)</option>
        </select>
        {rateMismatch && (
          <div
            className="text-[11px] text-accent-danger mt-1"
            data-testid="audio-engine-rate-mismatch"
          >
            ⚠ Hardware liefert {ctxRate} Hz — der Browser muss resampeln, was
            CPU kostet. Wenn das nicht gewünscht ist: „Auto" wählen.
          </div>
        )}
      </div>

      {/* Live-Latenz-Anzeige */}
      <div
        className="rounded border border-border-color bg-bg-elevated p-3"
        data-testid="audio-engine-status"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted">Aktuelle System-Latenz</span>
          <span className="text-xs font-mono font-semibold text-accent-primary">
            {latencyMs > 0 ? `${latencyMs} ms` : "—"}
          </span>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs text-text-muted">Aktive Sample-Rate</span>
          <span className="text-xs font-mono text-text-primary">
            {ctxRate !== null ? `${ctxRate} Hz` : "—"}
          </span>
        </div>
      </div>

      {/* Apply-Button */}
      <button
        type="button"
        onClick={handleApply}
        disabled={busy}
        data-testid="audio-engine-apply"
        className={[
          "w-full rounded px-4 py-2 text-sm font-medium transition-colors",
          busy
            ? "bg-bg-elevated text-text-dim cursor-not-allowed"
            : "bg-accent-primary text-bg-base hover:opacity-90",
        ].join(" ")}
      >
        {busy ? "Audio-Engine wird neu gestartet …" : "Anwenden (Audio-Engine neu starten)"}
      </button>

      <div className="border-t border-border-subtle pt-3 text-[10px] text-text-dim space-y-1">
        <div>
          Hinweis: Beim Anwenden wird der AudioContext zerstört + neu erzeugt.
          Playback wird kurz unterbrochen. Aktive Aufnahmen und Live-Inputs
          werden beendet.
        </div>
        <div>
          Wenn nach dem Wechsel kein Ton kommt: prüfe das System-Audio-Device
          oder starte die App neu.
        </div>
      </div>
    </div>
  );
}

function AboutSection() {
  const electron = useElectron();
  const { state: updaterState, checkForUpdates } = useUpdater();
  const [appVersion, setAppVersion] = useState<string>("1.23.0");

  // Live-Version vom Electron-Main holen (oder package.json-Fallback)
  useEffect(() => {
    if (!electron.isElectron) return;
    electron.getVersion?.().then((v) => {
      if (typeof v === "string" && v.length > 0) setAppVersion(v);
    }).catch(() => {});
  }, [electron]);

  // Update-Status als lesbarer Text
  const updaterLabel = (() => {
    switch (updaterState.phase) {
      case "idle":        return "Bereit zur Update-Prüfung";
      case "checking":    return "Suche nach Updates…";
      case "up-to-date":  return "Du bist auf dem neuesten Stand";
      case "available":   return `Update ${updaterState.version ? `v${updaterState.version}` : ""} verfügbar — wird heruntergeladen…`;
      case "downloading": return `Lade Update… ${updaterState.percent ?? 0}%`;
      case "ready":       return `Update v${updaterState.version} bereit — beim nächsten Start installiert`;
      case "error":       return `Fehler: ${updaterState.errorMessage ?? "unbekannt"}`;
      default:            return "";
    }
  })();

  const updaterLabelColor = (() => {
    switch (updaterState.phase) {
      case "up-to-date":  return "text-accent-success";
      case "available":   return "text-accent-secondary";
      case "downloading": return "text-accent-primary";
      case "ready":       return "text-accent-success";
      case "error":       return "text-accent-danger";
      default:            return "text-text-muted";
    }
  })();

  const canCheck = electron.isElectron && (updaterState.phase === "idle" || updaterState.phase === "up-to-date" || updaterState.phase === "error");

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-text-primary">Über Synthstudio</h3>
      <div className="text-xs text-text-muted space-y-1">
        <div>Version <span className="font-mono text-text-primary">{appVersion}</span></div>
        <div>Professionelle Drum Machine & Sample Synthesizer</div>
        <div className="text-text-dim pt-2">
          Gebaut mit React 19, Electron 40, Tone.js, Web Audio API.
        </div>
      </div>

      {/* Updates-Sektion (nur Electron — Web hat keinen Auto-Updater) */}
      {electron.isElectron && (
        <div className="border-t border-border-color pt-3 space-y-2">
          <h4 className="text-xs font-bold text-text-primary">Updates</h4>
          <div className={["text-[11px]", updaterLabelColor].join(" ")}>
            {updaterLabel}
          </div>
          {/* Download-Progress nur sichtbar während downloading */}
          {updaterState.phase === "downloading" && (
            <div className="w-full h-1.5 rounded-full bg-bg-elevated overflow-hidden">
              <div
                className="h-full bg-accent-primary transition-all duration-200"
                style={{ width: `${updaterState.percent ?? 0}%` }}
              />
            </div>
          )}
          <button
            data-testid="settings-check-updates"
            onClick={checkForUpdates}
            disabled={!canCheck}
            className={[
              "mt-1 px-3 py-1.5 rounded text-[11px] font-medium transition-colors",
              canCheck
                ? "bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30 border border-accent-primary/40"
                : "bg-bg-elevated text-text-dim border border-border-color cursor-not-allowed",
            ].join(" ")}
            title={canCheck ? "Manuell nach Updates suchen" : "Läuft bereits …"}
          >
            ↻ Jetzt nach Updates suchen
          </button>
        </div>
      )}

      <div className="border-t border-border-color pt-3 text-[10px] text-text-dim space-y-1">
        <div>Speicher-Nutzung: localStorage für Settings & Presets</div>
        <div>Projekte: <code>.synth</code> JSON Format</div>
        <button onClick={() => { localStorage.clear(); window.location.reload(); }}
          className="mt-3 text-accent-danger hover:opacity-80 text-[10px]">
          Alle Einstellungen zurücksetzen (localStorage löschen)
        </button>
      </div>
    </div>
  );
}

// ─── Haupt-Komponente ─────────────────────────────────────────────────────────

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  midi: MidiState & MidiActions;
  parts: PartData[];
  initialSection?: Section;
  /**
   * Optional: öffnet den vollständigen MIDI-Modal (MidiSettings.tsx, Ctrl+M).
   * Wird vom AdvancedMidiBanner in allen MIDI-Sections benutzt, damit User
   * von hier aus auf Auto-Learn, Hardware-Templates und Live-Activity-Indicator
   * springen können (sonst nur per Tastatur-Shortcut erreichbar).
   */
  onOpenAdvancedMidi?: () => void;
}

export function SettingsPanel({ isOpen, onClose, midi, parts, initialSection = "design", onOpenAdvancedMidi }: SettingsPanelProps) {
  const [active, setActive] = useState<Section>(initialSection);

  // Esc zum Schließen
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const groups = [...new Set(SECTIONS.map(s => s.group))];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-4xl max-h-[90vh] bg-bg-panel border border-border-color rounded-2xl shadow-2xl flex overflow-hidden">

        {/* ── Sidebar ────────────────────────────────────────────────────── */}
        <nav className="w-48 flex-shrink-0 bg-bg-base border-r border-border-color flex flex-col py-4 overflow-y-auto">
          <div className="px-4 mb-4">
            <span className="text-xs font-bold text-text-dim uppercase tracking-widest">Einstellungen</span>
          </div>
          {groups.map(group => (
            <div key={group} className="mb-2">
              <div className="px-4 py-1 text-[10px] text-text-dim uppercase tracking-wider">{group}</div>
              {SECTIONS.filter(s => s.group === group).map(sec => (
                <button key={sec.id} onClick={() => setActive(sec.id)}
                  className={`w-full flex items-center gap-2 px-4 py-2 text-xs text-left transition-colors ${
                    active === sec.id
                      ? "bg-accent-primary/15 text-accent-primary border-r-2 border-accent-primary"
                      : "text-text-muted hover:text-text-primary hover:bg-bg-elevated"
                  }`}>
                  <span className="text-base leading-none">{sec.icon}</span>
                  {sec.label}
                </button>
              ))}
            </div>
          ))}
          <div className="mt-auto px-4 pb-2">
            <button onClick={onClose} className="text-[10px] text-text-dim hover:text-text-muted">
              ✕ Schließen
            </button>
          </div>
        </nav>

        {/* ── Content ────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-6">
          {active === "design"       && <DesignSection />}
          {active === "workspace"    && <WorkspaceSection />}
          {active === "ki"           && <KiSection />}
          {active === "keyboard"     && <KeyboardBindingsPanel />}
          {active === "metronome"    && <MetronomeSection />}
          {active === "audio-engine" && <AudioEngineSection />}
          {active === "midi-devices" && <MidiDevicesSection midi={midi} onOpenAdvancedMidi={onOpenAdvancedMidi} />}
          {active === "midi-cc"      && <MidiCcSection midi={midi} parts={parts} onOpenAdvancedMidi={onOpenAdvancedMidi} />}
          {active === "midi-notes"   && <MidiNotesSection midi={midi} parts={parts} onOpenAdvancedMidi={onOpenAdvancedMidi} />}
          {active === "midi-chord"   && <ChordMemorySection />}
          {active === "midi-mpe"     && <MpeSectionSimple />}
          {active === "omnitribe"    && <DeviceConnectionPanel />}
          {active === "saving"        && <SavingSection />}
          {active === "patches"      && <PatchesSection />}
          {active === "osc"          && <OscSection />}
          {active === "plugins"      && <PluginsSection />}
          {active === "license"      && <LicenseSection />}
          {active === "about"        && <AboutSection />}
        </div>

        {/* ── Close Button ───────────────────────────────────────────────── */}
        <button onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors"
          aria-label="Close"
          title="Schließen (ESC)"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
