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
import React, { useState, useCallback, useEffect } from "react";
import { X } from "lucide-react";
import { KeyboardBindingsPanel } from "./KeyboardBindingsPanel";
import { useApiSettingsStore, setApiKey, setAiModel, setAutoSaveEnabled, setSnapshotsEnabled, setAutoSaveInterval } from "@/store/useApiSettingsStore";
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
import { CustomThemeCreator } from "./CustomThemeCreator";
import type { MidiState, MidiActions, MidiLearnTarget } from "@/hooks/useMidi";
import type { PartData } from "@/audio/AudioEngine";

// ─── Sidebar-Abschnitte ───────────────────────────────────────────────────────

type Section =
  | "design"
  | "ki"
  | "keyboard"
  | "metronome"
  | "midi-devices"
  | "midi-cc"
  | "midi-notes"
  | "midi-chord"
  | "midi-mpe"
  | "osc"
  | "plugins"
  | "saving"
  | "about";

const SECTIONS: Array<{ id: Section; icon: string; label: string; group?: string }> = [
  { id: "design",       icon: "🎨", label: "Design",             group: "Erscheinungsbild" },
  { id: "ki",           icon: "✨", label: "KI & API",            group: "Erscheinungsbild" },
  { id: "keyboard",     icon: "⌨️", label: "Tastatur",            group: "Steuerung" },
  { id: "metronome",    icon: "🥁", label: "Metronom",            group: "Audio" },
  { id: "midi-devices", icon: "🎹", label: "MIDI Geräte",         group: "MIDI" },
  { id: "midi-cc",      icon: "🎛",  label: "CC-Zuweisungen",      group: "MIDI" },
  { id: "midi-notes",   icon: "🎵", label: "Note-Zuweisungen",    group: "MIDI" },
  { id: "midi-chord",   icon: "🎼", label: "Chord Memory",        group: "MIDI" },
  { id: "midi-mpe",     icon: "🖐", label: "MPE",                 group: "MIDI" },
  { id: "saving",       icon: "💾", label: "Speichern",           group: "App" },
  { id: "osc",          icon: "📡", label: "OSC",                 group: "App" },
  { id: "plugins",      icon: "🧩", label: "Plugins",             group: "App" },
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

function KiSection() {
  const api = useApiSettingsStore();
  const [key, setKey] = useState(api.anthropicApiKey);
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-bold text-text-primary mb-1">AI Beat Co-Pilot</h3>
        <p className="text-xs text-text-dim mb-3">
          Verbinde den Pattern Generator mit Claude AI. Der API Key wird lokal gespeichert.
        </p>
        <label className="text-xs text-text-muted block mb-1">Anthropic API Key</label>
        <div className="flex gap-2">
          <input type="password" value={key} onChange={e => setKey(e.target.value)}
            placeholder="sk-ant-…"
            className="flex-1 bg-bg-elevated text-text-primary text-xs px-3 py-2 rounded border border-border-color placeholder:text-text-dim focus:border-accent-primary outline-none" />
          <button onClick={() => setApiKey(key)}
            className="px-3 py-1.5 text-xs rounded bg-accent-primary text-white hover:opacity-80 transition-opacity">
            Speichern
          </button>
        </div>
        {api.anthropicApiKey && <p className="text-[10px] text-accent-success mt-1.5">✓ API Key aktiv – KI-Generierung verfügbar</p>}
      </div>
      <div>
        <label className="text-xs text-text-muted block mb-1">Claude Modell</label>
        <select value={api.aiModel} onChange={e => setAiModel(e.target.value)}
          className="w-full bg-bg-elevated text-text-primary text-xs px-3 py-2 rounded border border-border-color">
          <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 – schnell &amp; günstig</option>
          <option value="claude-sonnet-4-6">Claude Sonnet 4.6 – kreativ &amp; ausgewogen</option>
          <option value="claude-opus-4-7">Claude Opus 4.7 – maximal kreativ</option>
        </select>
        <p className="text-[10px] text-text-dim mt-1">Haiku empfohlen für Pattern-Generierung (niedrige Latenz).</p>
      </div>
      <div className="border-t border-border-color pt-3 text-[10px] text-text-dim">
        API Key kostenlos testen: <span className="text-accent-secondary">console.anthropic.com</span>.
        Ohne Key wird prozedurale Generierung verwendet.
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

function MidiDevicesSection({ midi }: { midi: MidiState & MidiActions }) {
  return (
    <div className="space-y-4">
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
                <div className="flex items-center gap-2">
                  <label className="text-xs text-text-muted">MIDI-Kanal:</label>
                  <input type="number" min={1} max={16} value={midi.midiOutChannel}
                    onChange={e => midi.setMidiOutChannel(Number(e.target.value))}
                    className="w-16 bg-bg-elevated text-text-primary text-xs px-2 py-1 rounded border border-border-color" />
                  <span className="text-[10px] text-text-dim">(10 = GM Drums)</span>
                </div>
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

function MidiCcSection({ midi, parts }: { midi: MidiState & MidiActions; parts: PartData[] }) {
  const targets = buildCcTargets(parts);
  const categories = [...new Set(targets.map(t => t.category))];

  const getExisting = (target: MidiLearnTarget) =>
    midi.mappings.find(m => JSON.stringify(m.target) === JSON.stringify(target));

  const isLearning = (target: MidiLearnTarget) =>
    midi.isLearning && JSON.stringify(midi.learnTarget) === JSON.stringify(target);

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h3 className="text-sm font-bold text-text-primary">MIDI CC-Zuweisungen</h3>
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

function MidiNotesSection({ midi, parts }: { midi: MidiState & MidiActions; parts: PartData[] }) {
  const [manualNote, setManualNote] = useState(36);
  const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","A","A#","H"];
  const noteToName = (n: number) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

  return (
    <div>
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
      <p className="text-xs text-text-dim">
        Verbinde Synthstudio mit TouchOSC, Protokol oder einem anderen OSC-fähigen Gerät
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

function AboutSection() {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-text-primary">Über Synthstudio</h3>
      <div className="text-xs text-text-muted space-y-1">
        <div>Version 1.14</div>
        <div>Professionelle Drum Machine & Sample Synthesizer</div>
        <div className="text-text-dim pt-2">
          Gebaut mit React 19, Electron 40, Tone.js, Web Audio API.
        </div>
      </div>
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
}

export function SettingsPanel({ isOpen, onClose, midi, parts, initialSection = "design" }: SettingsPanelProps) {
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
          {active === "ki"           && <KiSection />}
          {active === "keyboard"     && <KeyboardBindingsPanel />}
          {active === "metronome"    && <MetronomeSection />}
          {active === "midi-devices" && <MidiDevicesSection midi={midi} />}
          {active === "midi-cc"      && <MidiCcSection midi={midi} parts={parts} />}
          {active === "midi-notes"   && <MidiNotesSection midi={midi} parts={parts} />}
          {active === "midi-chord"   && <ChordMemorySection />}
          {active === "midi-mpe"     && <MpeSectionSimple />}
          {active === "saving"        && <SavingSection />}
          {active === "osc"          && <OscSection />}
          {active === "plugins"      && <PluginsSection />}
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
