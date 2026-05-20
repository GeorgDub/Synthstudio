/**
 * Synthstudio – SampleBrowser (v4)
 *
 * Vollständig überarbeiteter Sample-Browser:
 * - Kategorien (Kicks, Snares, Hi-Hats, Claps, Toms, Perc, FX, Loops, Vocals, Sonstige)
 * - Playlists: Benutzer kann eigene Sammlungen erstellen und benennen
 * - Sample auf aktiven Kanal legen: Doppelklick oder "Auf Kanal"-Button
 * - Drag & Drop: Sample aus Browser auf Kanal-Zeile ziehen
 * - Waveform-Visualisierung beim Selektieren
 * - Audio-Preview mit Playhead-Animation
 * - Kategorie-Zuweisung per Rechtsklick
 *
 * ─── GOLDENES GESETZ ─────────────────────────────────────────────────────────
 * Alle Electron-Aufrufe gehen ausschließlich über den useElectron()-Hook.
 * Kein direktes window.electronAPI. Jede Electron-Logik hinter if (electron.isElectron).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, {
  useRef,
  useCallback,
  useState,
  useMemo,
  useEffect,
} from "react";

import { useElectron } from "../../../../electron/useElectron";
import type { Sample } from "../../store/useProjectStore";
import { WaveformDisplay } from "../WaveformDisplay";
import { useAudioAnalysis } from "../../hooks/useAudioAnalysis";
// v3.54.0: Pure-fn Sample-Library Filter + Search.
// v3.55.0: getTopTagSuggestions für Autocomplete-Liste im Tag-Editor.
import {
  applySampleFilters,
  extractAllTags,
  getSampleTags,
  getTopTagSuggestions,
  type FilterMode,
} from "@/utils/sampleLibrary";
// v3.116.0: Time-Stretch + Pitch-Shift Dialog für Samples.
import { SampleTransformDialog } from "./SampleTransformDialog";
import { AudioEngine } from "@/audio/AudioEngine";
// v3.148: Sample-Sort-Modes.
import {
  sortSamples,
  SAMPLE_SORT_MODES,
  SAMPLE_SORT_LABELS,
  type SampleSortMode,
} from "@/utils/sampleSort";
// v3.152: Multi-Select Pure-Helpers.
import {
  toggleInSet,
  rangeSelect,
  clearSelection,
  filterSelected,
  invertSelection,
  selectAll,
} from "@/utils/sampleMultiSelect";
// v3.162: Pure-Helper für Duration-Aggregation in der Bulk-Bar.
// formatDuration wird als formatBulkDuration aliasiert — ein lokales
// formatDuration() für Single-Sample-Anzeige existiert bereits in dieser Datei.
import {
  aggregateSampleDuration,
  formatDuration as formatBulkDuration,
  type DurationCandidate,
} from "@/utils/sampleDurationAggregator";
import { useConfirm } from "@/components/common/ConfirmDialog";
// v3.171: Bulk-Normalize-Action.
import {
  batchNormalizeSamples,
  type BatchNormalizeMode,
} from "@/utils/sampleNormalizeBatch";
import type { AudioBufferLike } from "@/utils/sampleEmbedding";
import { encodeWav } from "@/audio/wavEncoder";
import { toast } from "@/store/useToastStore";
import {
  distributeDrumKit,
  type SampleCandidate,
} from "@/utils/drumKitDistribution";
// v3.177: Spectral-Centroid → Brightness-Verteilung der selektierten Samples.
import { computeSpectralCentroid } from "@/utils/sampleSpectralCentroid";
// v3.177: Onset-Detection-Bulk-Action für selektierte Samples.
import { detectOnsets } from "@/utils/onsetDetector";
// v3.182: Bulk-LUFS-Analyse für selektierte Samples (BS.1770 simplified).
import { computeLufsApprox } from "@/utils/sampleLufsApprox";
// v3.184: Bulk-Stereo-Width-Analyse (M/S-Decomposition) für selektierte Samples.
import { analyzeStereoWidth } from "@/utils/sampleStereoWidth";
// v3.185: Bulk-Convolution-Reverb für selektierte Samples (Preset-IRs).
import {
  applyConvolutionReverb,
  generateSyntheticIR,
  REVERB_PRESETS,
} from "@/utils/sampleConvolutionReverb";
// v3.186: Bulk-Noise-Gate für selektierte Samples (Preset-Parameter).
import {
  applyNoiseGate,
  NOISE_GATE_PRESETS,
} from "@/utils/sampleNoiseGate";
// v3.187: Bulk-AutoTune-Analyse (Pitch-Detect + Scale-Snap, Preview-only).
import { analyzeAutoTune } from "@/utils/sampleAutoTune";
// v3.188: Bulk-Compressor (Threshold/Ratio/Attack/Release/Knee/Makeup Preset).
import {
  applyCompressor,
  COMPRESSOR_PRESETS,
} from "@/utils/sampleCompressor";
// v3.191: Bulk-Delay (Slapback/Echo/Long/Dub-Preset).
import {
  applyDelay,
  DELAY_PRESETS,
} from "@/utils/sampleDelay";
// v3.192: Bulk-Sidechain (Pump) für selektierte Samples mit 4-on-the-floor Trigger.
import {
  applySidechain,
  SIDECHAIN_PRESETS,
} from "@/utils/sampleSidechain";
// v3.194: Bulk-Pitch-Shift (Resample) für selektierte Samples.
import { applyPitchShift } from "@/utils/samplePitchShift";
// v3.195: Bulk-Saturator (tanh/soft-clip/tube/tape) für selektierte Samples.
import {
  applySaturator,
  SATURATOR_PRESETS,
} from "@/utils/sampleSaturator";
// v3.197: Bulk-Stereo-Enhancer (M/S Width-Slider 0..2) für selektierte Samples.
import { applyStereoEnhance } from "@/utils/sampleStereoEnhancer";
// v3.199: Bulk-LowPass (one-pole, cutoff slider 500..10000 Hz) für selektierte Samples.
import { applyLowPass } from "@/utils/sampleLowPass";
// v3.201: Bulk-HighPass (one-pole, cutoff slider 50..800 Hz) für selektierte Samples.
import { applyHighPass } from "@/utils/sampleHighPass";
// v3.202: Bulk-BandPass (HP+LP-Cascade, center 100..10000 Hz / width 100..5000 Hz) für selektierte Samples.
import { applyBandPass } from "@/utils/sampleBandPass";
// v3.203: Bulk-AllPass (Biquad-Phaser, center 100..5000 Hz / stages 1..8) für selektierte Samples.
import { applyAllPass } from "@/utils/sampleAllPass";
// v3.204: Bulk-Speed (changeSpeedRatio, ratio 0.25..4) für selektierte Samples.
import { changeSpeedRatio } from "@/utils/sampleResampler";
// v3.205: Bulk-SampleRateReduce (LoFi/Bitcrush, factor 1..16 / bitDepth 2..16) für selektierte Samples.
import { applySampleRateReduce } from "@/utils/sampleSampleRateReduce";
// v3.206: Bulk-Chorus (single-voice, rateHz 0.1..10 / mix 0..1) für selektierte Samples.
import { applyChorus } from "@/utils/sampleChorus";
// v3.207: Bulk-Flanger (modulierte Delay-Line + Feedback, rateHz 0.05..5 / feedback -0.95..+0.95) für selektierte Samples.
import { applyFlanger } from "@/utils/sampleFlanger";
// v3.208: Bulk-Tremolo (Amplitude-Modulation via LFO, rateHz 0.1..20 / depth 0..1) für selektierte Samples.
import { applyTremolo } from "@/utils/sampleTremolo";
// v3.209: Bulk-Vibrato (Pitch-Modulation via LFO, rateHz 0.1..20 / depthCents 0..100) für selektierte Samples.
import { applyVibrato } from "@/utils/sampleVibrato";
// v3.211: Bulk-AutoPan (Stereo-Pan-Modulation via LFO, rateHz 0.05..10 / depth 0..1) für selektierte Samples.
import { applyAutoPan } from "@/utils/sampleAutoPan";
// v3.212: Bulk-Stutter-Buffer (Slice-Repeat sliceMs 5..500 / repeats 1..32) für selektierte Samples.
import { applyStutterBuffer } from "@/utils/sampleStutterBuffer";
// v3.213: Bulk-ADSR (Gain-Envelope, attackMs 0..2000 / releaseMs 0..5000) für selektierte Samples.
import { applyAdsr } from "@/utils/sampleGainEnvelope";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface Playlist {
  id: string;
  name: string;
  sampleIds: string[];
  createdAt: number;
}

export interface SampleBrowserProps {
  samples: Sample[];
  onImportSamples: (paths: string[]) => void;
  onImportFolder?: (folderPath: string) => void;
  onRemoveSample?: (id: string) => void;
  /** Callback wenn Samples via ZIP importiert wurden (mit vollständigen Sample-Daten) */
  onSamplesImported?: (samples: Sample[]) => void;
  /** Callback wenn Sample auf aktiven Kanal gelegt werden soll */
  onAssignToChannel?: (sampleUrl: string, sampleName: string) => void;
  /** Name des aktuell aktiven Kanals (für Anzeige) */
  activeChannelName?: string;
  /** Callback zum Umsortieren der Sample-Liste per Drag & Drop */
  onReorderSamples?: (draggedId: string, targetId: string) => void;
  /** Callback wenn Kategorie eines Samples geändert wurde */
  onUpdateSampleCategory?: (id: string, category: string) => void;
  /** v3.55.0: Tag zu einem Sample hinzufügen */
  onAddTagToSample?: (id: string, tag: string) => void;
  /** v3.55.0: Tag aus einem Sample entfernen */
  onRemoveTagFromSample?: (id: string, tag: string) => void;
  /**
   * v3.116.0: Sample wurde transformiert (Stretch/Pitch). Der Aufrufer
   * ersetzt `sample.path` mit der neuen Blob-URL und markiert das Projekt
   * als dirty. Der neue AudioBuffer wird parallel im AudioEngine-Cache
   * abgelegt (damit das Sample sofort hörbar ist).
   */
  onTransformSample?: (id: string, newBlobUrl: string, newBuffer: AudioBuffer) => void;
  /**
   * v3.141: Auto-Slice-Apply — Aufrufer erstellt für jeden Slice ein neues
   * Sample im Browser. Optional — wenn nicht gesetzt, wird der Apply-Button
   * im Transform-Dialog ausgeblendet (Slice-Detection bleibt Preview-only).
   */
  onAutoSliceSample?: (slices: AudioBuffer[], baseSampleName: string) => void;
}

// ─── Konstanten ───────────────────────────────────────────────────────────────

const AUDIO_EXTENSIONS = [".wav", ".mp3", ".ogg", ".flac", ".aiff", ".aif", ".m4a"];

/**
 * Alle verfügbaren Kategorien mit Labels und Farben.
 *
 * Hinweis zur Theme-Kompatibilität (TASK-113):
 * Die ursprüngliche Palette nutzte 9 unterschiedliche Tailwind-Farben (red,
 * orange, yellow, green, teal, cyan, blue, indigo, purple) um Kategorien
 * visuell zu unterscheiden. Da Synthstudio nur 4 semantische Akzente bietet
 * (accent-primary, accent-secondary, accent-success, accent-danger), wurden
 * die Kategorien auf diese Akzente abgebildet — die 3-Buchstaben-Labels
 * ("KIC", "SNA", …) plus Emojis bleiben als primäres Unterscheidungsmerkmal.
 */
const CATEGORIES: Array<{ id: string; label: string; color: string; emoji: string }> = [
  { id: "all",        label: "Alle",        color: "bg-bg-elevated text-text-primary",            emoji: "◈" },
  { id: "kicks",      label: "Kicks",       color: "bg-accent-danger/60 text-accent-danger",      emoji: "🥁" },
  { id: "snares",     label: "Snares",      color: "bg-accent-secondary/60 text-accent-secondary",emoji: "🪘" },
  { id: "hihats",     label: "Hi-Hats",     color: "bg-accent-secondary/60 text-accent-secondary",emoji: "🎩" },
  { id: "claps",      label: "Claps",       color: "bg-accent-success/60 text-accent-success",    emoji: "👏" },
  { id: "toms",       label: "Toms",        color: "bg-accent-primary/60 text-accent-primary",    emoji: "🔵" },
  { id: "percussion", label: "Perc",        color: "bg-accent-primary/60 text-accent-primary",    emoji: "🎵" },
  { id: "fx",         label: "FX",          color: "bg-accent-primary/60 text-accent-primary",    emoji: "⚡" },
  { id: "loops",      label: "Loops",       color: "bg-accent-secondary/60 text-accent-secondary",emoji: "🔁" },
  { id: "vocals",     label: "Vocals",      color: "bg-accent-secondary/60 text-accent-secondary",emoji: "🎤" },
  { id: "other",      label: "Sonstige",    color: "bg-bg-elevated/60 text-text-muted",           emoji: "📁" },
  { id: "imported",   label: "Importiert",  color: "bg-bg-elevated/60 text-text-muted",           emoji: "📥" },
];

const CATEGORY_WAVEFORM_COLORS: Record<string, string> = {
  kicks:      "#ef4444",
  snares:     "#f97316",
  hihats:     "#eab308",
  claps:      "#22c55e",
  toms:       "#14b8a6",
  percussion: "#06b6d4",
  fx:         "#3b82f6",
  loops:      "#6366f1",
  vocals:     "#a855f7",
  other:      "#64748b",
  imported:   "#22d3ee",
};

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function formatBytes(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds?: number): string {
  if (!seconds) return "";
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)} ms`;
  if (seconds < 60) return `${seconds.toFixed(2)} s`;
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
}

function getCategoryColor(categoryId: string): string {
  return CATEGORIES.find((c) => c.id === categoryId)?.color ?? "bg-bg-elevated/60 text-text-muted";
}

function getWaveformColor(categoryId: string): string {
  return CATEGORY_WAVEFORM_COLORS[categoryId] ?? "#22d3ee";
}

function makePlaylistId(): string {
  return `pl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ─── Import-Fortschritts-Overlay ─────────────────────────────────────────────

interface ImportProgressProps {
  current: number;
  total: number;
  percentage: number;
  phase: string;
  currentFile?: string;
  onCancel?: () => void;
}

function ImportProgress({ current, total, percentage, phase, currentFile, onCancel }: ImportProgressProps) {
  const phaseLabel = phase === "counting" ? "Zähle Dateien…"
    : phase === "reading" ? "Lese Archiv…"
    : phase === "extracting" ? "Extrahiere…"
    : "Importiere…";

  return (
    <div className="absolute inset-0 bg-bg-panel/95 flex flex-col items-center justify-center gap-3 z-10 rounded-lg">
      <p className="text-sm font-semibold text-accent-secondary">{phaseLabel}</p>
      {total > 0 && (
        <>
          <div className="w-48 h-1.5 bg-bg-elevated rounded-full overflow-hidden">
            <div
              className="h-full bg-accent-primary rounded-full transition-all duration-200"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <p className="text-xs text-text-dim">
            {current} / {total} ({percentage}%)
          </p>
        </>
      )}
      {currentFile && (
        <p className="text-xs text-text-dim truncate max-w-[180px]" title={currentFile}>
          {currentFile}
        </p>
      )}
      {onCancel && (
        <button
          onClick={onCancel}
          className="mt-1 px-3 py-1 text-xs rounded bg-accent-danger/40 text-accent-danger border border-accent-danger hover:bg-accent-danger/60 transition-colors"
        >
          Abbrechen
        </button>
      )}
    </div>
  );
}

// ─── Waveform-Panel ───────────────────────────────────────────────────────────

interface WaveformPanelProps {
  sample: Sample;
  isPlaying: boolean;
  playbackPosition: number;
  onSeek: (position: number) => void;
  onPlayToggle: () => void;
  onAssignToChannel?: () => void;
  activeChannelName?: string;
  analysisResult: { peaks: number[]; duration: number; sampleRate?: number; channels?: number; estimatedBpm?: number } | null;
  isAnalyzing: boolean;
  /** v3.116.0: Time-Stretch + Pitch-Shift Dialog öffnen. */
  onTransform?: () => void;
}

function WaveformPanel({
  sample,
  isPlaying,
  playbackPosition,
  onSeek,
  onPlayToggle,
  onAssignToChannel,
  activeChannelName,
  analysisResult,
  isAnalyzing,
  onTransform,
}: WaveformPanelProps) {
  const waveformColor = getWaveformColor(sample.category);

  return (
    <div className="border-t border-border-color bg-bg-base flex flex-col">
      {/* Sample-Name + Zuweisung */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-color/50">
        <span className="text-xs text-accent-primary font-medium truncate flex-1" title={sample.name}>
          {sample.name}
        </span>
        <div className="flex items-center gap-1 ml-2 flex-shrink-0">
          {onAssignToChannel && (
            <button
              onClick={onAssignToChannel}
              title={activeChannelName ? `Auf Kanal "${activeChannelName}" legen` : "Auf aktiven Kanal legen (Doppelklick)"}
              className="px-2 py-0.5 rounded text-[10px] bg-accent-primary/70 text-bg-base hover:bg-accent-primary transition-colors font-medium"
            >
              → {activeChannelName ? activeChannelName.slice(0, 8) : "Kanal"}
            </button>
          )}
          <button
            onClick={onPlayToggle}
            className={[
              "w-7 h-7 rounded flex items-center justify-center text-xs transition-all duration-100 flex-shrink-0",
              isPlaying
                ? "bg-accent-secondary text-bg-base"
                : "bg-bg-elevated text-text-primary hover:bg-bg-elevated hover:text-text-primary",
            ].join(" ")}
            title={isPlaying ? "Preview stoppen (Leertaste)" : "Preview abspielen (Leertaste)"}
          >
            {isPlaying ? "■" : "▶"}
          </button>
          {onTransform && (
            <button
              onClick={onTransform}
              data-testid="sample-transform-open"
              className="w-7 h-7 rounded flex items-center justify-center text-[11px] bg-bg-elevated text-text-primary hover:bg-accent-primary/30 hover:text-accent-primary transition-colors flex-shrink-0"
              title="Time-Stretch + Pitch-Shift (Transformieren)"
            >
              ⤬
            </button>
          )}
        </div>
      </div>

      {/* Waveform */}
      <div className="px-2 py-1.5">
        <WaveformDisplay
          peaks={analysisResult?.peaks ?? []}
          duration={analysisResult?.duration ?? 0}
          playbackPosition={playbackPosition}
          isPlaying={isPlaying}
          onSeek={onSeek}
          color={waveformColor}
          height={72}
          isLoading={isAnalyzing}
          zoomEnabled={true}
          className="rounded overflow-hidden"
        />
      </div>

      {/* Sample-Details */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-3 pb-2 text-[10px] text-text-dim">
        {analysisResult?.duration != null && (
          <span title="Dauer">⏱ {formatDuration(analysisResult.duration)}</span>
        )}
        {analysisResult?.sampleRate != null && (
          <span title="Samplerate">{(analysisResult.sampleRate / 1000).toFixed(1)} kHz</span>
        )}
        {analysisResult?.channels != null && (
          <span title="Kanäle">{analysisResult.channels === 1 ? "Mono" : "Stereo"}</span>
        )}
        {analysisResult?.estimatedBpm != null && (
          <span title="Geschätztes BPM" className="text-accent-primary">
            ♩ {analysisResult.estimatedBpm} BPM
          </span>
        )}
        {sample.size != null && (
          <span title="Dateigröße">{formatBytes(sample.size)}</span>
        )}
        {isAnalyzing && (
          <span className="text-accent-primary animate-pulse">Analysiere…</span>
        )}
      </div>
    </div>
  );
}

// ─── Kategorie-Kontextmenü ────────────────────────────────────────────────────

interface CategoryMenuProps {
  x: number;
  y: number;
  currentCategory: string;
  onSelect: (category: string) => void;
  onClose: () => void;
}

function CategoryMenu({ x, y, currentCategory, onSelect, onClose }: CategoryMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-bg-elevated border border-border-color rounded-lg shadow-2xl py-1 min-w-[160px]"
      style={{ left: Math.min(x, window.innerWidth - 180), top: Math.min(y, window.innerHeight - 300) }}
    >
      <div className="px-3 py-1 text-[10px] text-text-dim border-b border-border-color mb-1">
        Kategorie ändern
      </div>
      {CATEGORIES.filter(c => c.id !== "all").map(cat => (
        <button
          key={cat.id}
          onClick={() => { onSelect(cat.id); onClose(); }}
          className={[
            "w-full text-left px-3 py-1 text-xs transition-colors flex items-center gap-2",
            cat.id === currentCategory
              ? "text-accent-secondary bg-accent-primary/20"
              : "text-text-primary hover:bg-bg-elevated",
          ].join(" ")}
        >
          <span className={`text-[9px] px-1 py-0.5 rounded-full ${cat.color}`}>
            {cat.id.slice(0, 3).toUpperCase()}
          </span>
          {cat.label}
          {cat.id === currentCategory && <span className="ml-auto text-accent-primary">✓</span>}
        </button>
      ))}
    </div>
  );
}

// ─── Playlist-Panel ───────────────────────────────────────────────────────────

interface PlaylistPanelProps {
  playlists: Playlist[];
  activePlaylistId: string | null;
  samples: Sample[];
  selectedSampleId: string | null;
  onSelectPlaylist: (id: string | null) => void;
  onCreatePlaylist: (name: string) => void;
  onRenamePlaylist: (id: string, name: string) => void;
  onDeletePlaylist: (id: string) => void;
  onAddToPlaylist: (playlistId: string, sampleId: string) => void;
  onRemoveFromPlaylist: (playlistId: string, sampleId: string) => void;
}

function PlaylistPanel({
  playlists,
  activePlaylistId,
  samples,
  selectedSampleId,
  onSelectPlaylist,
  onCreatePlaylist,
  onRenamePlaylist,
  onDeletePlaylist,
  onAddToPlaylist,
  onRemoveFromPlaylist,
}: PlaylistPanelProps) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [showAddMenu, setShowAddMenu] = useState<string | null>(null);

  const handleCreate = () => {
    const name = newName.trim() || `Playlist ${playlists.length + 1}`;
    onCreatePlaylist(name);
    setNewName("");
  };

  return (
    <div className="flex flex-col h-full">
      {/* Neue Playlist erstellen */}
      <div className="flex gap-1 px-3 py-2 border-b border-border-color">
        <input
          type="text"
          placeholder="Neue Playlist…"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") handleCreate(); }}
          className="flex-1 bg-bg-panel border border-border-color rounded px-2 py-1 text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-primary"
        />
        <button
          onClick={handleCreate}
          className="px-2 py-1 text-xs rounded bg-accent-primary/40 text-accent-secondary border border-accent-primary hover:bg-accent-primary/60 transition-colors"
        >
          +
        </button>
      </div>

      {/* Alle Samples (kein Filter) */}
      <button
        onClick={() => onSelectPlaylist(null)}
        className={[
          "flex items-center gap-2 px-3 py-1.5 text-xs transition-colors border-b border-border-color/50",
          activePlaylistId === null
            ? "text-accent-secondary bg-accent-primary/20"
            : "text-text-muted hover:bg-bg-elevated/30",
        ].join(" ")}
      >
        <span className="text-text-dim">◈</span>
        <span className="flex-1 text-left">Alle Samples</span>
        <span className="text-[10px] text-text-dim">{samples.length}</span>
      </button>

      {/* Playlist-Liste */}
      <div className="flex-1 overflow-y-auto">
        {playlists.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 text-text-dim text-xs gap-1">
            <span>Keine Playlists</span>
            <span className="text-[10px]">Oben erstellen</span>
          </div>
        ) : (
          playlists.map(pl => {
            const count = pl.sampleIds.filter(id => samples.some(s => s.id === id)).length;
            const isActive = pl.id === activePlaylistId;
            const isEditing = editingId === pl.id;

            return (
              <div
                key={pl.id}
                className={[
                  "group flex items-center gap-1 px-3 py-1.5 border-b border-border-color/30 transition-colors",
                  isActive ? "bg-accent-primary/20" : "hover:bg-bg-elevated/20",
                ].join(" ")}
              >
                {isEditing ? (
                  <input
                    autoFocus
                    type="text"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onBlur={() => {
                      if (editName.trim()) onRenamePlaylist(pl.id, editName.trim());
                      setEditingId(null);
                    }}
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        if (editName.trim()) onRenamePlaylist(pl.id, editName.trim());
                        setEditingId(null);
                      }
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="flex-1 bg-bg-elevated border border-accent-primary rounded px-1.5 py-0.5 text-xs text-text-primary focus:outline-none"
                  />
                ) : (
                  <button
                    onClick={() => onSelectPlaylist(pl.id)}
                    onDoubleClick={() => { setEditingId(pl.id); setEditName(pl.name); }}
                    className={[
                      "flex-1 text-left text-xs truncate",
                      isActive ? "text-accent-primary" : "text-text-primary",
                    ].join(" ")}
                    title={`${pl.name} – Doppelklick zum Umbenennen`}
                  >
                    ♪ {pl.name}
                  </button>
                )}

                <span className="text-[10px] text-text-dim flex-shrink-0">{count}</span>

                {/* Sample zur Playlist hinzufügen */}
                {selectedSampleId && !pl.sampleIds.includes(selectedSampleId) && (
                  <button
                    onClick={() => onAddToPlaylist(pl.id, selectedSampleId)}
                    title="Ausgewähltes Sample hinzufügen"
                    className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded text-[10px] bg-accent-primary/40 text-accent-primary hover:bg-accent-primary/60 transition-all"
                  >
                    +
                  </button>
                )}
                {selectedSampleId && pl.sampleIds.includes(selectedSampleId) && (
                  <button
                    onClick={() => onRemoveFromPlaylist(pl.id, selectedSampleId)}
                    title="Ausgewähltes Sample entfernen"
                    className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded text-[10px] bg-accent-danger/40 text-accent-danger hover:bg-accent-danger/60 transition-all"
                  >
                    −
                  </button>
                )}

                {/* Playlist löschen */}
                <button
                  onClick={() => onDeletePlaylist(pl.id)}
                  title="Playlist löschen"
                  className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded text-[10px] text-text-dim hover:text-accent-danger transition-all"
                >
                  ✕
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Hauptkomponente ──────────────────────────────────────────────────────────

export function SampleBrowser({
  samples,
  onImportSamples,
  onImportFolder,
  onRemoveSample,
  onSamplesImported,
  onAssignToChannel,
  activeChannelName,
  onUpdateSampleCategory,
  onReorderSamples,
  onAddTagToSample,
  onRemoveTagFromSample,
  onTransformSample,
  onAutoSliceSample,
}: SampleBrowserProps) {
  // ── Einziger Zugriffspunkt auf Electron-Features ──────────────────────────
  const electron = useElectron();
  const { analyzeFile, isAnalyzing } = useAudioAnalysis();
  // v3.152: Confirm-Hook für Bulk-Delete-Bestätigung.
  const confirm = useConfirm();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  // ── Tabs: Samples / Playlists ─────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"samples" | "playlists">("samples");

  // ── Filter-State ──────────────────────────────────────────────────────────
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  // v3.54.0: Multi-Tag-Filter + AND/OR-Mode (Default OR — DAW-üblich).
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [tagFilterMode, setTagFilterMode] = useState<FilterMode>("OR");
  // v3.148: Sort-Mode mit localStorage-Persistenz.
  const [sortMode, setSortModeState] = useState<SampleSortMode>(() => {
    if (typeof window === "undefined") return "import";
    const v = window.localStorage.getItem("synthstudio:sample-sort-mode") as SampleSortMode | null;
    return v && SAMPLE_SORT_MODES.includes(v) ? v : "import";
  });
  const setSortMode = useCallback((m: SampleSortMode) => {
    setSortModeState(m);
    try { window.localStorage.setItem("synthstudio:sample-sort-mode", m); } catch { /* ignore */ }
  }, []);

  // ── Reorder-DnD-State ─────────────────────────────────────────────────────
  const [dragOverSampleId, setDragOverSampleId] = useState<string | null>(null);

  // ── Playlist-State ────────────────────────────────────────────────────────
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);

  // ── Sample-Navigation und Selektion ──────────────────────────────────────
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null);
  // v3.152: Multi-Select via Ctrl/Shift+Click. selectedSampleId bleibt der
  // "Single-Select"-Anker (Preview-Sample). multiSelectIds = zusätzlich
  // mehrfach-markierte Samples für Bulk-Operationen.
  const [multiSelectIds, setMultiSelectIds] = useState<Set<string>>(() => new Set());
  const lastClickedIdRef = useRef<string | null>(null);

  // v3.162: Aggregierte Duration für die Bulk-Bar.
  // size (bytes) → grober Estimate via sampleDurationAggregator. Sample.size
  // ist optional — fehlende Werte landen im unknownCount und werden via
  // "~" + "(N unbekannt)" gekennzeichnet.
  const bulkDurationInfo = useMemo(() => {
    if (multiSelectIds.size === 0) return null;
    const candidates: DurationCandidate[] = [];
    for (const s of samples) {
      if (!multiSelectIds.has(s.id)) continue;
      candidates.push({
        sizeBytes: typeof s.size === "number" ? s.size : undefined,
        sampleRate: 48000,
      });
    }
    return aggregateSampleDuration(candidates);
  }, [multiSelectIds, samples]);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number>(0);

  // ── Kategorie-Kontextmenü ─────────────────────────────────────────────────
  const [categoryMenu, setCategoryMenu] = useState<{
    x: number; y: number; sampleId: string; currentCategory: string;
  } | null>(null);

  // ── v3.116.0: Sample-Transform-Dialog ────────────────────────────────────
  const [transformSample, setTransformSample] = useState<Sample | null>(null);
  const [transformBuffer, setTransformBuffer] = useState<AudioBuffer | null>(null);

  // ── Waveform-Analyse-Cache ────────────────────────────────────────────────
  const [analysisCache, setAnalysisCache] = useState<Record<string, {
    peaks: number[];
    duration: number;
    sampleRate?: number;
    channels?: number;
    estimatedBpm?: number;
    tags?: string[];
  }>>({});
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);

  // ── Import-Fortschritt ────────────────────────────────────────────────────
  const [importProgress, setImportProgress] = useState<{
    active: boolean;
    importId: string;
    current: number;
    total: number;
    percentage: number;
    phase: string;
    currentFile?: string;
  } | null>(null);

  // Stabiler Ref für onSamplesImported – verhindert Listener-Teardown während laufendem Import
  const onSamplesImportedRef = useRef(onSamplesImported);
  useEffect(() => { onSamplesImportedRef.current = onSamplesImported; });

  // ── Electron Import-Events abonnieren ─────────────────────────────────────
  useEffect(() => {
    const cleanupStarted = electron.onImportStarted((data) => {
      setImportProgress({
        active: true,
        importId: data.importId,
        current: 0,
        total: 0,
        percentage: 0,
        phase: "counting",
      });
    });

    // Kein prev-Guard: Progress-Events initialisieren den Overlay auch ohne started-Event
    const cleanupProgress = electron.onImportProgress((data) => {
      setImportProgress({
        active: true,
        importId: data.importId,
        current: data.current,
        total: data.total,
        percentage: data.percentage,
        phase: data.phase,
        currentFile: data.currentFile,
      });
    });

    const cleanupComplete = electron.onImportComplete((data) => {
      setImportProgress(null);
      if (data.samples && data.samples.length > 0 && onSamplesImportedRef.current) {
        onSamplesImportedRef.current(data.samples);
      }
    });

    const cleanupCancelled = electron.onImportCancelled(() => {
      setImportProgress(null);
    });

    return () => {
      cleanupStarted();
      cleanupProgress();
      cleanupComplete();
      cleanupCancelled();
    };
  // electron ist stabil; onSamplesImported wird per Ref abgeholt – kein erneutes Abonnieren
  }, [electron]);

  // ── Gefilterte Samples (mit Playlist-Filter) ──────────────────────────────
  // v3.54.0: Filter-Pipeline läuft jetzt durch pure-fn applySampleFilters.
  // Analyse-Cache-Tags werden vor dem Filter in eine virtuelle "tags"-Liste
  // gemerged, damit der pure Filter ohne separate Cache-Awareness arbeitet.
  const filteredSamples = useMemo(() => {
    let base = samples;

    // Playlist-Filter
    if (activePlaylistId) {
      const playlist = playlists.find(p => p.id === activePlaylistId);
      if (playlist) {
        base = samples.filter(s => playlist.sampleIds.includes(s.id));
      }
    }

    // Analyse-Tags virtuell anhängen (z.B. BPM-Genre-Tags).
    const enriched = base.map((s) => {
      const cacheTags = analysisCache[s.id]?.tags;
      if (!cacheTags || cacheTags.length === 0) return s;
      const ownTags = getSampleTags(s);
      const merged = Array.from(new Set([...ownTags, ...cacheTags]));
      return { ...s, tags: merged };
    });

    const filtered = applySampleFilters(enriched, {
      category: activeCategory,
      tags: activeTags,
      tagMode: tagFilterMode,
      query: searchQuery,
    });
    // v3.148: Sort nach User-Wahl.
    return sortSamples(filtered, sortMode);
  }, [samples, activeCategory, searchQuery, activeTags, tagFilterMode, activePlaylistId, playlists, analysisCache, sortMode]);

  // v3.164: Aggregierte Duration über die GEFILTERTE Sample-Liste für die
  // Status-Leiste. Orthogonal zu bulkDurationInfo (Multi-Select). Gleicher
  // Pure-Helper, gleicher 48 kHz Stereo-16bit-Estimate-Fallback.
  const filteredDurationInfo = useMemo(() => {
    const candidates: DurationCandidate[] = filteredSamples.map((s) => ({
      sizeBytes: typeof s.size === "number" ? s.size : undefined,
      sampleRate: 48000,
    }));
    return aggregateSampleDuration(candidates);
  }, [filteredSamples]);

  // ── Verfügbare Tags aller Samples (aus Import + Analyse-Cache) ─────────────
  const availableTags = useMemo(() => {
    // Auch hier mit Analyse-Cache-Tags ergänzen.
    const enriched = samples.map((s) => {
      const cacheTags = analysisCache[s.id]?.tags;
      if (!cacheTags || cacheTags.length === 0) return s;
      const ownTags = getSampleTags(s);
      return { ...s, tags: Array.from(new Set([...ownTags, ...cacheTags])) };
    });
    return extractAllTags(enriched);
  }, [samples, analysisCache]);

  // v3.54.0: Filter aktiv? Für "Clear Filters"-Button-Disabled-State.
  const hasActiveFilters =
    activeCategory !== "all" ||
    searchQuery !== "" ||
    activeTags.length > 0 ||
    activePlaylistId !== null;

  const handleClearFilters = useCallback(() => {
    setActiveCategory("all");
    setSearchQuery("");
    setActiveTags([]);
    setActivePlaylistId(null);
  }, []);

  const handleToggleTag = useCallback((tag: string) => {
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }, []);

  // ── v3.55.0: Tag-Editor pro Sample ────────────────────────────────────────
  // Inline-Input: nur EIN Sample hat gerade den Add-Tag-Input geöffnet.
  // null = niemand. Bei Open wird der Input fokussiert; Blur/Enter committet,
  // Escape/leer-Submit canceln.
  const [tagEditorOpenFor, setTagEditorOpenFor] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState<string>("");

  // Top-10-most-used Tags aus dem aktuellen Sample-Set (Frequency-Map).
  // Wird als Suggestion-Liste neben dem Input gezeigt — mit den hardcoded
  // COMMON_TAG_SUGGESTIONS als Fallback wenn die Library noch leer ist.
  const tagSuggestions = useMemo<string[]>(
    () => getTopTagSuggestions(samples, 10),
    [samples],
  );

  const handleOpenTagEditor = useCallback((sampleId: string) => {
    setTagEditorOpenFor(sampleId);
    setTagDraft("");
  }, []);

  const handleCommitTagDraft = useCallback((sampleId: string) => {
    const raw = tagDraft.trim();
    if (raw.length > 0 && onAddTagToSample) {
      onAddTagToSample(sampleId, raw);
    }
    setTagEditorOpenFor(null);
    setTagDraft("");
  }, [tagDraft, onAddTagToSample]);

  const handleRemoveTag = useCallback((sampleId: string, tag: string) => {
    if (onRemoveTagFromSample) onRemoveTagFromSample(sampleId, tag);
  }, [onRemoveTagFromSample]);

  const handleApplySuggestion = useCallback((sampleId: string, tag: string) => {
    if (onAddTagToSample) onAddTagToSample(sampleId, tag);
    setTagEditorOpenFor(null);
    setTagDraft("");
  }, [onAddTagToSample]);

  // v3.116.0: Transform-Dialog öffnen — lädt AudioBuffer via Engine.
  const handleOpenTransform = useCallback(async (sample: Sample) => {
    try {
      const buf = await AudioEngine.loadSample(sample.path);
      if (!buf) {
        console.warn("[SampleBrowser] Transform: Konnte Buffer nicht laden:", sample.path);
        return;
      }
      setTransformBuffer(buf);
      setTransformSample(sample);
    } catch (err) {
      console.warn("[SampleBrowser] Transform: Fehler beim Laden:", err);
    }
  }, []);

  const handleTransformApply = useCallback((newBuffer: AudioBuffer, newBlobUrl: string) => {
    if (!transformSample || !onTransformSample) return;
    onTransformSample(transformSample.id, newBlobUrl, newBuffer);
  }, [transformSample, onTransformSample]);

  const handleTransformClose = useCallback(() => {
    setTransformSample(null);
    setTransformBuffer(null);
  }, []);

  const selectedIndex = useMemo(() => {
    if (!selectedSampleId) return -1;
    return filteredSamples.findIndex((s) => s.id === selectedSampleId);
  }, [selectedSampleId, filteredSamples]);

  const selectedSample = useMemo(() =>
    samples.find((s) => s.id === selectedSampleId) ?? null,
    [samples, selectedSampleId]
  );

  // ── Kategorie-Zähler ──────────────────────────────────────────────────────
  const categoryCounts = useMemo(() => {
    const base = activePlaylistId
      ? samples.filter(s => playlists.find(p => p.id === activePlaylistId)?.sampleIds.includes(s.id))
      : samples;
    const counts: Record<string, number> = { all: base.length };
    for (const sample of base) {
      counts[sample.category] = (counts[sample.category] ?? 0) + 1;
    }
    return counts;
  }, [samples, activePlaylistId, playlists]);

  // ── Waveform-Analyse beim Selektieren ─────────────────────────────────────
  useEffect(() => {
    if (!selectedSampleId || !selectedSample) return;
    if (analysisCache[selectedSampleId]) return;

    setAnalyzingId(selectedSampleId);

    const run = async () => {
      try {
        let audioData: ArrayBuffer | undefined;

        // Audio-Daten via fetch holen in zwei Fällen:
        //  - Browser (kein Electron-FS-Zugriff)
        //  - Electron + Blob-/HTTP-URL (z.B. Mic-Aufnahme, Stem-Export, Download)
        //    weil das Electron-Backend dann fs.statSync() nicht nutzen kann
        const isBlobOrHttp = /^(blob:|https?:|data:)/.test(selectedSample.path ?? "");
        if ((!electron.isElectron || isBlobOrHttp) && selectedSample.path) {
          try {
            const response = await fetch(selectedSample.path);
            audioData = await response.arrayBuffer();
          } catch (err) {
            console.warn("[SampleBrowser] fetch fehlgeschlagen:", err);
          }
        }

        const result = await analyzeFile(selectedSample.path, audioData);

        if (result) {
          setAnalysisCache((prev) => ({
            ...prev,
            [selectedSampleId]: {
              peaks: result.peaks,
              duration: result.duration,
              sampleRate: result.sampleRate,
              channels: result.channels,
              estimatedBpm: result.estimatedBpm,
              tags: result.tags,
            },
          }));
        }
      } catch (err) {
        console.warn("[SampleBrowser] Analyse fehlgeschlagen:", err);
      } finally {
        setAnalyzingId(null);
      }
    };

    run();
  }, [selectedSampleId, selectedSample, analyzeFile, electron.isElectron]);

  // ── Playback-Position-Tracking ────────────────────────────────────────────
  useEffect(() => {
    const audio = audioPreviewRef.current;
    if (!audio || !isPreviewPlaying) return;

    const update = () => {
      if (audio.duration > 0) {
        setPlaybackPosition(audio.currentTime / audio.duration);
      }
      rafRef.current = requestAnimationFrame(update);
    };

    rafRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPreviewPlaying]);

  // ── Sample-Selektion ──────────────────────────────────────────────────────
  const handleSelectSample = useCallback((sample: Sample, event?: React.MouseEvent) => {
    // v3.152: Ctrl/Cmd+Click toggle, Shift+Click range. Sonst single-select.
    const isCtrl = !!event && (event.ctrlKey || event.metaKey);
    const isShift = !!event && event.shiftKey;
    if (isCtrl) {
      setMultiSelectIds((prev) => toggleInSet(prev, sample.id));
      lastClickedIdRef.current = sample.id;
      setSelectedSampleId(sample.id);
      return;
    }
    if (isShift && lastClickedIdRef.current) {
      setMultiSelectIds((prev) =>
        rangeSelect(filteredSamples.map((s) => s.id), lastClickedIdRef.current!, sample.id, prev),
      );
      setSelectedSampleId(sample.id);
      return;
    }
    // Single-select: clear multi.
    setMultiSelectIds(clearSelection());
    lastClickedIdRef.current = sample.id;
    setSelectedSampleId(sample.id);
    if (audioPreviewRef.current) {
      audioPreviewRef.current.pause();
      audioPreviewRef.current = null;
      setIsPreviewPlaying(false);
      setPlaybackPosition(0);
    }
  }, [filteredSamples]);

  // v3.152: Bulk-Delete-Handler. Asks confirmation, dann removeSample für jede ID.
  // v3.154: Bulk-Category-Change — wendet Kategorie auf alle ausgewählten Samples.
  const handleBulkCategory = useCallback((categoryId: string) => {
    if (multiSelectIds.size === 0 || !onUpdateSampleCategory) return;
    for (const id of multiSelectIds) {
      onUpdateSampleCategory(id, categoryId);
    }
  }, [multiSelectIds, onUpdateSampleCategory]);

  // v3.153: Bulk-Tag-Add — Tag-Input-State + Handler.
  const [bulkTagInputVisible, setBulkTagInputVisible] = useState(false);
  const [bulkTagDraft, setBulkTagDraft] = useState("");
  const handleBulkAddTag = useCallback(() => {
    if (multiSelectIds.size === 0 || !onAddTagToSample) return;
    const tag = bulkTagDraft.trim();
    if (tag.length === 0) {
      setBulkTagInputVisible(false);
      return;
    }
    for (const id of multiSelectIds) {
      onAddTagToSample(id, tag);
    }
    setBulkTagDraft("");
    setBulkTagInputVisible(false);
  }, [bulkTagDraft, multiSelectIds, onAddTagToSample]);

  const handleBulkDelete = useCallback(async () => {
    if (multiSelectIds.size === 0 || !onRemoveSample) return;
    const ids = Array.from(multiSelectIds);
    const ok = await confirm({
      title: `${ids.length} Sample(s) wirklich löschen?`,
      message: "Diese Aktion entfernt die Samples aus dem Projekt. Originaldateien bleiben unverändert.",
      confirmLabel: "Löschen",
      destructive: true,
    });
    if (!ok) return;
    for (const id of ids) {
      onRemoveSample(id);
    }
    setMultiSelectIds(clearSelection());
    setSelectedSampleId(null);
  }, [multiSelectIds, onRemoveSample, confirm]);

  // v3.171: Bulk-Normalize — alle ausgewählten Samples auf gemeinsames
  // Loudness-Target. Wird via sampleNormalizeBatch (pure) berechnet, dann
  // pro Result als WAV-Blob enkodiert und via onTransformSample zurück ins
  // Projekt geschrieben (+ AudioEngine-Cache via neuem AudioBuffer).
  const [bulkNormalizeMode, setBulkNormalizeMode] =
    useState<BatchNormalizeMode>("uniform-peak");

  const handleBulkNormalize = useCallback(async () => {
    if (multiSelectIds.size === 0 || !onTransformSample) return;
    const ids = Array.from(multiSelectIds);
    // Phase 1: AudioBuffer laden für jede selected Sample-ID.
    const inputs: Array<{ id: string; buffer: AudioBufferLike }> = [];
    for (const id of ids) {
      const sample = samples.find((s) => s.id === id);
      if (!sample) continue;
      try {
        const buf = await AudioEngine.loadSample(sample.path);
        if (buf) inputs.push({ id, buffer: buf as unknown as AudioBufferLike });
      } catch {
        /* skip unloadable */
      }
    }
    if (inputs.length === 0) {
      toast("Keine ladbaren Sample-Buffer in der Auswahl", { kind: "warning" });
      return;
    }
    // Phase 2: Pure Batch-Normalize.
    const result = batchNormalizeSamples(inputs, { mode: bulkNormalizeMode });
    // Phase 3: pro Result WAV encodieren + AudioBuffer rekonstruieren +
    // onTransformSample aufrufen.
    let applied = 0;
    for (const entry of result.entries) {
      if (entry.gainAppliedDb === 0) continue; // no-op
      const buf = entry.buffer;
      // Defensiv: 0-channel oder 0-length Buffers überspringen.
      if (buf.numberOfChannels === 0 || buf.length === 0) continue;
      const channels = (Math.min(2, buf.numberOfChannels) as 1 | 2);
      const wav = encodeWav(
        Array.from({ length: channels }, (_, c) =>
          buf.getChannelData(c) as Float32Array,
        ),
        { sampleRate: buf.sampleRate, channels, bitDepth: 16 },
      );
      const blob = new Blob([wav], { type: "audio/wav" });
      const newUrl = URL.createObjectURL(blob);
      // AudioBufferLike → echter AudioBuffer via OfflineAudioContext (für
      // AudioEngine-Cache). Selbe Pattern wie SampleTransformDialog.
      const Ctor = (window.OfflineAudioContext ||
        // @ts-expect-error legacy webkit fallback
        window.webkitOfflineAudioContext) as typeof OfflineAudioContext;
      const ctx = new Ctor(
        Math.max(1, buf.numberOfChannels),
        Math.max(1, buf.length),
        buf.sampleRate,
      ) as BaseAudioContext;
      const audioBuf = ctx.createBuffer(
        Math.max(1, buf.numberOfChannels),
        Math.max(1, buf.length),
        buf.sampleRate,
      );
      for (let c = 0; c < buf.numberOfChannels; c++) {
        // copyToChannel erwartet Float32Array<ArrayBuffer>; getChannelData liefert
        // strukturell Float32Array<ArrayBufferLike>. Kopie in frisches ArrayBuffer
        // (vermeidet TS-Strict-Mismatch + entkoppelt vom Pipeline-Buffer).
        const src = buf.getChannelData(c);
        const copy = new Float32Array(src.length);
        copy.set(src);
        audioBuf.copyToChannel(copy, c, 0);
      }
      onTransformSample(entry.id, newUrl, audioBuf);
      applied++;
    }
    const cappedMsg =
      result.cappedCount > 0 ? ` (${result.cappedCount} gecappt)` : "";
    if (applied === 0) {
      toast(`Keine Änderung nötig${cappedMsg}`, { kind: "info" });
    } else {
      toast(`${applied} Sample(s) normalisiert${cappedMsg}`, { kind: "success" });
    }
  }, [multiSelectIds, samples, onTransformSample, bulkNormalizeMode]);

  // v3.174 — Auto-Distribute Preview:
  // Mapped selected Samples auf das 16-Slot-GM-Drum-Layout via
  // distributeDrumKit (Pure-Helper aus utils/drumKitDistribution.ts).
  // Preview-only: zeigt Plan via Toast + console.log. Direct-Apply
  // benötigt eine neue Per-Part-Assign-API (z.B. onAssignToPartIndex),
  // die aktuell noch nicht durchgewired ist — Caveat für v3.175+.
  const handleAutoDistribute = useCallback(() => {
    if (multiSelectIds.size === 0) return;
    const candidates: SampleCandidate[] = [];
    for (const s of samples) {
      if (!multiSelectIds.has(s.id)) continue;
      candidates.push({
        id: s.id,
        name: s.name,
        tags: s.tags,
        category: s.category,
      });
    }
    if (candidates.length === 0) return;
    const result = distributeDrumKit(candidates);
    const assigned = result.partAssignments.filter(
      (p) => p.sampleId !== null,
    ).length;
    const total = candidates.length;
    toast(
      `Distribute-Plan: ${assigned}/${total} zugeordnet (${result.unassignedSamples.length} unzugeordnet). Apply: per-part Drag&Drop manuell — onAssignToPart-Wire pending.`,
      { kind: "info", duration: 6000 },
    );
    console.log("[Auto-Distribute v3.174 Preview]", result);
  }, [multiSelectIds, samples]);

  // v3.177 — Brightness-Verteilung der selektierten Samples:
  // Lädt für jede selected Sample-ID den AudioBuffer und berechnet via
  // computeSpectralCentroid (Pure-Helper) die Brightness-Kategorie.
  // Anschließend Toast mit Histogram der 5 Kategorien.
  const handleBulkBrightness = useCallback(async () => {
    if (multiSelectIds.size === 0) return;
    const histogram = { dark: 0, warm: 0, neutral: 0, bright: 0, harsh: 0 };
    let analyzed = 0;
    for (const id of multiSelectIds) {
      const sample = samples.find((s) => s.id === id);
      if (!sample) continue;
      try {
        const buf = await AudioEngine.loadSample(sample.path);
        if (!buf) continue;
        const result = computeSpectralCentroid(
          buf as unknown as AudioBufferLike,
        );
        histogram[result.brightness]++;
        analyzed++;
      } catch {
        /* skip unloadable */
      }
    }
    if (analyzed === 0) {
      toast("Keine ladbaren Sample-Buffer", { kind: "warning" });
      return;
    }
    const parts = Object.entries(histogram)
      .filter(([, c]) => c > 0)
      .map(([k, c]) => `${k}: ${c}`);
    toast(
      `Brightness von ${analyzed} Samples: ${parts.join(", ")}`,
      { kind: "info", duration: 6000 },
    );
    console.log("[Brightness-Analyze]", histogram);
  }, [multiSelectIds, samples]);

  // v3.177 — Onset-Analyse der selektierten Samples:
  // Lädt für jede selected Sample-ID den AudioBuffer und detektiert via
  // detectOnsets (Pure-Helper) die Anzahl Onsets/Transients.
  // Anschließend Toast mit total + Durchschnitt pro Sample.
  const handleBulkOnsets = useCallback(async () => {
    if (multiSelectIds.size === 0) return;
    let totalOnsets = 0;
    let analyzed = 0;
    for (const id of multiSelectIds) {
      const sample = samples.find((s) => s.id === id);
      if (!sample) continue;
      try {
        const buf = await AudioEngine.loadSample(sample.path);
        if (!buf) continue;
        const onsets = detectOnsets(buf as unknown as AudioBufferLike);
        totalOnsets += onsets.length;
        analyzed++;
      } catch {
        /* skip unloadable */
      }
    }
    if (analyzed === 0) {
      toast("Keine ladbaren Sample-Buffer", { kind: "warning" });
      return;
    }
    toast(
      `${analyzed} Samples analysiert: ${totalOnsets} Onsets gefunden (Ø ${(totalOnsets / analyzed).toFixed(1)}/sample)`,
      { kind: "info", duration: 6000 },
    );
    console.log("[Onset-Analyze]", { analyzed, totalOnsets });
  }, [multiSelectIds, samples]);

  // v3.182 — LUFS-Bulk-Analyse der selektierten Samples:
  // Lädt für jede selected Sample-ID den AudioBuffer und berechnet via
  // computeLufsApprox (BS.1770 simplified) die Integrated Loudness.
  // Toast zeigt Anzahl analysierter Samples + Ø/Min/Max LUFS.
  const handleBulkLufs = useCallback(async () => {
    if (multiSelectIds.size === 0) return;
    let totalLufs = 0;
    let analyzed = 0;
    let minLufs = Infinity;
    let maxLufs = -Infinity;
    for (const id of multiSelectIds) {
      const sample = samples.find((s) => s.id === id);
      if (!sample) continue;
      try {
        const buf = await AudioEngine.loadSample(sample.path);
        if (!buf) continue;
        const result = computeLufsApprox(
          buf as unknown as AudioBufferLike,
        );
        if (Number.isFinite(result.integratedLufs)) {
          totalLufs += result.integratedLufs;
          if (result.integratedLufs < minLufs) minLufs = result.integratedLufs;
          if (result.integratedLufs > maxLufs) maxLufs = result.integratedLufs;
          analyzed++;
        }
      } catch {
        /* skip unloadable */
      }
    }
    if (analyzed === 0) {
      toast("Keine ladbaren Sample-Buffer mit messbarem LUFS", {
        kind: "warning",
      });
      return;
    }
    const avg = totalLufs / analyzed;
    toast(
      `LUFS-Analyse: ${analyzed} Samples · Ø ${avg.toFixed(1)} · Min ${minLufs.toFixed(1)} · Max ${maxLufs.toFixed(1)} LUFS`,
      { kind: "info", duration: 6000 },
    );
    console.log("[LUFS-Analyze]", { analyzed, avg, minLufs, maxLufs });
  }, [multiSelectIds, samples]);

  // v3.184 — Bulk-Stereo-Width-Analyse der selektierten Samples:
  // Lädt für jede selected Sample-ID den AudioBuffer und berechnet via
  // analyzeStereoWidth (M/S-Decomposition) die Width-Kategorie.
  // Toast zeigt die Verteilung der Kategorien (mono/narrow/balanced/wide/extreme).
  const handleBulkWidth = useCallback(async () => {
    if (multiSelectIds.size === 0) return;
    const histogram: Record<
      "mono" | "narrow" | "balanced" | "wide" | "extreme",
      number
    > = { mono: 0, narrow: 0, balanced: 0, wide: 0, extreme: 0 };
    let analyzed = 0;
    for (const id of multiSelectIds) {
      const sample = samples.find((s) => s.id === id);
      if (!sample) continue;
      try {
        const buf = await AudioEngine.loadSample(sample.path);
        if (!buf) continue;
        const r = analyzeStereoWidth(
          buf as unknown as AudioBufferLike,
        );
        histogram[r.width]++;
        analyzed++;
      } catch {
        /* skip unloadable */
      }
    }
    if (analyzed === 0) {
      toast("Keine ladbaren Sample-Buffer", { kind: "warning" });
      return;
    }
    const parts = Object.entries(histogram)
      .filter(([, c]) => c > 0)
      .map(([k, c]) => `${k}: ${c}`);
    toast(`Stereo-Width: ${parts.join(", ")}`, {
      kind: "info",
      duration: 6000,
    });
    console.log("[Width-Analyze]", { analyzed, histogram });
  }, [multiSelectIds, samples]);

  // v3.185 — Bulk-Convolution-Reverb für selektierte Samples:
  // Generiert eine synthetische IR via REVERB_PRESETS-Konfiguration, faltet
  // jeden geladenen Sample-Buffer (applyConvolutionReverb mono-out), encodet
  // das Ergebnis als WAV und schreibt via onTransformSample zurück ins Projekt
  // (+ rekonstruierter AudioBuffer für AudioEngine-Cache).
  const [bulkReverbPresetId, setBulkReverbPresetId] = useState<string>("room");

  const handleBulkReverb = useCallback(async () => {
    if (multiSelectIds.size === 0 || !onTransformSample) return;
    const preset = REVERB_PRESETS.find((p) => p.id === bulkReverbPresetId);
    if (!preset) return;
    let applied = 0;
    for (const id of multiSelectIds) {
      const sample = samples.find((s) => s.id === id);
      if (!sample) continue;
      try {
        const buf = await AudioEngine.loadSample(sample.path);
        if (!buf) continue;
        const sr = buf.sampleRate;
        const ir = generateSyntheticIR(preset.durationMs, sr, preset.decay);
        const wet = applyConvolutionReverb(
          buf as unknown as AudioBufferLike,
          ir,
          { wet: 0.4 },
        );
        if (wet.numberOfChannels === 0 || wet.length === 0) continue;
        // wet ist mono → encodeWav mit channels=1 (oder 2 wenn vorhanden).
        const channels = Math.min(2, wet.numberOfChannels) as 1 | 2;
        const wav = encodeWav(
          Array.from({ length: channels }, (_, c) =>
            wet.getChannelData(c) as Float32Array,
          ),
          { sampleRate: wet.sampleRate, channels, bitDepth: 16 },
        );
        const blob = new Blob([wav], { type: "audio/wav" });
        const newUrl = URL.createObjectURL(blob);
        // AudioBufferLike → echter AudioBuffer für AudioEngine-Cache.
        const Ctor = (window.OfflineAudioContext ||
          // @ts-expect-error legacy webkit fallback
          window.webkitOfflineAudioContext) as typeof OfflineAudioContext;
        const ctx = new Ctor(
          Math.max(1, wet.numberOfChannels),
          Math.max(1, wet.length),
          wet.sampleRate,
        ) as BaseAudioContext;
        const audioBuf = ctx.createBuffer(
          Math.max(1, wet.numberOfChannels),
          Math.max(1, wet.length),
          wet.sampleRate,
        );
        for (let c = 0; c < wet.numberOfChannels; c++) {
          const src = wet.getChannelData(c);
          const copy = new Float32Array(src.length);
          copy.set(src);
          audioBuf.copyToChannel(copy, c, 0);
        }
        onTransformSample(id, newUrl, audioBuf);
        applied++;
      } catch {
        /* skip */
      }
    }
    toast(`Reverb "${preset.name}" angewandt: ${applied} Samples`, {
      kind: "success",
    });
  }, [multiSelectIds, samples, onTransformSample, bulkReverbPresetId]);

  // v3.186 — Bulk-Noise-Gate für selektierte Samples:
  // Ein in NOISE_GATE_PRESETS definiertes Preset bestimmt thresholdDb,
  // attackMs und releaseMs. Jeder geladene Buffer wird gepasst, als WAV
  // encodet und via onTransformSample zurück ins Projekt geschrieben
  // (+ rekonstruierter AudioBuffer für AudioEngine-Cache).
  const [bulkGatePresetId, setBulkGatePresetId] = useState<string>("vocal");

  const handleBulkNoiseGate = useCallback(async () => {
    if (multiSelectIds.size === 0 || !onTransformSample) return;
    const preset = NOISE_GATE_PRESETS.find((p) => p.id === bulkGatePresetId);
    if (!preset) return;
    let applied = 0;
    for (const id of multiSelectIds) {
      const sample = samples.find((s) => s.id === id);
      if (!sample) continue;
      try {
        const buf = await AudioEngine.loadSample(sample.path);
        if (!buf) continue;
        const gated = applyNoiseGate(buf as unknown as AudioBufferLike, {
          thresholdDb: preset.thresholdDb,
          attackMs: preset.attackMs,
          releaseMs: preset.releaseMs,
        });
        if (gated.numberOfChannels === 0 || gated.length === 0) continue;
        const channels = Math.min(2, gated.numberOfChannels) as 1 | 2;
        const wav = encodeWav(
          Array.from({ length: channels }, (_, c) =>
            gated.getChannelData(c) as Float32Array,
          ),
          { sampleRate: gated.sampleRate, channels, bitDepth: 16 },
        );
        const blob = new Blob([wav], { type: "audio/wav" });
        const newUrl = URL.createObjectURL(blob);
        const Ctor = (window.OfflineAudioContext ||
          // @ts-expect-error legacy webkit fallback
          window.webkitOfflineAudioContext) as typeof OfflineAudioContext;
        const ctx = new Ctor(
          Math.max(1, gated.numberOfChannels),
          Math.max(1, gated.length),
          gated.sampleRate,
        ) as BaseAudioContext;
        const audioBuf = ctx.createBuffer(
          Math.max(1, gated.numberOfChannels),
          Math.max(1, gated.length),
          gated.sampleRate,
        );
        for (let c = 0; c < gated.numberOfChannels; c++) {
          const src = gated.getChannelData(c);
          const copy = new Float32Array(src.length);
          copy.set(src);
          audioBuf.copyToChannel(copy, c, 0);
        }
        onTransformSample(id, newUrl, audioBuf);
        applied++;
      } catch {
        /* skip */
      }
    }
    toast(`NoiseGate "${preset.name}": ${applied} Samples`, { kind: "success" });
  }, [multiSelectIds, samples, onTransformSample, bulkGatePresetId]);

  // v3.187 — Bulk-AutoTune-Analyse: Pitch-Detect via Autocorrelation +
  // Snap-to-Scale (C-Dur, rootMidi 60). Liefert nur Preview/Analysis,
  // KEIN tatsächlicher pitch-shift des Audios. Statistik (Anzahl pitched
  // Samples + Ø |semitoneShift|) als Toast; detected MIDI-Noten zusätzlich
  // in der Konsole für Drill-Down.
  const handleBulkAutoTune = useCallback(async () => {
    if (multiSelectIds.size === 0) return;
    let totalShift = 0;
    let analyzed = 0;
    const detectedNotes: number[] = [];
    for (const id of multiSelectIds) {
      const sample = samples.find((s) => s.id === id);
      if (!sample) continue;
      try {
        const buf = await AudioEngine.loadSample(sample.path);
        if (!buf) continue;
        const result = analyzeAutoTune(buf as unknown as AudioBufferLike, {
          scale: "major",
          rootMidi: 60,
        });
        if (result.confidence > 0.3 && result.detectedMidi > 0) {
          totalShift += Math.abs(result.semitoneShift);
          detectedNotes.push(result.detectedMidi);
          analyzed++;
        }
      } catch {
        /* skip */
      }
    }
    if (analyzed === 0) {
      toast("Keine pitch-detect-bare Samples", { kind: "warning" });
      return;
    }
    const avgShift = totalShift / analyzed;
    toast(
      `AutoTune-Analyse: ${analyzed} pitched Samples · Ø Shift ${avgShift.toFixed(1)} semitones`,
      { kind: "info", duration: 6000 },
    );
    // eslint-disable-next-line no-console
    console.log("[AutoTune-Analyze]", detectedNotes);
  }, [multiSelectIds, samples]);

  // v3.188 — Bulk-Compressor für selektierte Samples:
  // Ein in COMPRESSOR_PRESETS definiertes Preset bestimmt thresholdDb, ratio,
  // attackMs, releaseMs, kneeDb und makeupGainDb. Jeder geladene Buffer wird
  // komprimiert, als WAV encodet und via onTransformSample zurück ins Projekt
  // geschrieben (+ rekonstruierter AudioBuffer für AudioEngine-Cache).
  const [bulkCompPresetId, setBulkCompPresetId] = useState<string>("vocal");

  const handleBulkCompressor = useCallback(async () => {
    if (multiSelectIds.size === 0 || !onTransformSample) return;
    const preset = COMPRESSOR_PRESETS.find((p) => p.id === bulkCompPresetId);
    if (!preset) return;
    let applied = 0;
    for (const id of multiSelectIds) {
      const sample = samples.find((s) => s.id === id);
      if (!sample) continue;
      try {
        const buf = await AudioEngine.loadSample(sample.path);
        if (!buf) continue;
        const compressed = applyCompressor(
          buf as unknown as AudioBufferLike,
          {
            thresholdDb: preset.thresholdDb,
            ratio: preset.ratio,
            attackMs: preset.attackMs,
            releaseMs: preset.releaseMs,
            kneeDb: preset.kneeDb,
            makeupGainDb: preset.makeupGainDb,
          },
        );
        if (compressed.numberOfChannels === 0 || compressed.length === 0) continue;
        const channels = Math.min(2, compressed.numberOfChannels) as 1 | 2;
        const wav = encodeWav(
          Array.from({ length: channels }, (_, c) =>
            compressed.getChannelData(c) as Float32Array,
          ),
          { sampleRate: compressed.sampleRate, channels, bitDepth: 16 },
        );
        const blob = new Blob([wav], { type: "audio/wav" });
        const newUrl = URL.createObjectURL(blob);
        const Ctor = (window.OfflineAudioContext ||
          // @ts-expect-error legacy webkit fallback
          window.webkitOfflineAudioContext) as typeof OfflineAudioContext;
        const ctx = new Ctor(
          Math.max(1, compressed.numberOfChannels),
          Math.max(1, compressed.length),
          compressed.sampleRate,
        ) as BaseAudioContext;
        const audioBuf = ctx.createBuffer(
          Math.max(1, compressed.numberOfChannels),
          Math.max(1, compressed.length),
          compressed.sampleRate,
        );
        for (let c = 0; c < compressed.numberOfChannels; c++) {
          const src = compressed.getChannelData(c);
          const copy = new Float32Array(src.length);
          copy.set(src);
          audioBuf.copyToChannel(copy, c, 0);
        }
        onTransformSample(id, newUrl, audioBuf);
        applied++;
      } catch {
        /* skip */
      }
    }
    toast(`Compressor "${preset.name}": ${applied} Samples`, { kind: "success" });
  }, [multiSelectIds, samples, onTransformSample, bulkCompPresetId]);

  // v3.191 — Bulk-Delay für selektierte Samples:
  // Ein in DELAY_PRESETS definiertes Preset bestimmt delayMs, feedback und wet.
  // Jeder geladene Buffer wird mit applyDelay (Circular-Buffer-Delay-Line)
  // verarbeitet, als WAV encodet und via onTransformSample zurück ins Projekt
  // geschrieben (+ rekonstruierter AudioBuffer für AudioEngine-Cache).
  const [bulkDelayPresetId, setBulkDelayPresetId] = useState<string>("echo");

  const handleBulkDelay = useCallback(async () => {
    if (multiSelectIds.size === 0 || !onTransformSample) return;
    const preset = DELAY_PRESETS.find((p) => p.id === bulkDelayPresetId);
    if (!preset) return;
    let applied = 0;
    for (const id of multiSelectIds) {
      const sample = samples.find((s) => s.id === id);
      if (!sample) continue;
      try {
        const buf = await AudioEngine.loadSample(sample.path);
        if (!buf) continue;
        const delayed = applyDelay(buf as unknown as AudioBufferLike, {
          delayMs: preset.delayMs,
          feedback: preset.feedback,
          wet: preset.wet,
        });
        if (delayed.numberOfChannels === 0 || delayed.length === 0) continue;
        const channels = Math.min(2, delayed.numberOfChannels) as 1 | 2;
        const wav = encodeWav(
          Array.from({ length: channels }, (_, c) =>
            delayed.getChannelData(c) as Float32Array,
          ),
          { sampleRate: delayed.sampleRate, channels, bitDepth: 16 },
        );
        const blob = new Blob([wav], { type: "audio/wav" });
        const newUrl = URL.createObjectURL(blob);
        const Ctor = (window.OfflineAudioContext ||
          // @ts-expect-error legacy webkit fallback
          window.webkitOfflineAudioContext) as typeof OfflineAudioContext;
        const ctx = new Ctor(
          Math.max(1, delayed.numberOfChannels),
          Math.max(1, delayed.length),
          delayed.sampleRate,
        ) as BaseAudioContext;
        const audioBuf = ctx.createBuffer(
          Math.max(1, delayed.numberOfChannels),
          Math.max(1, delayed.length),
          delayed.sampleRate,
        );
        for (let c = 0; c < delayed.numberOfChannels; c++) {
          const src = delayed.getChannelData(c);
          const copy = new Float32Array(src.length);
          copy.set(src);
          audioBuf.copyToChannel(copy, c, 0);
        }
        onTransformSample(id, newUrl, audioBuf);
        applied++;
      } catch {
        /* skip */
      }
    }
    toast(`Delay "${preset.name}": ${applied} Samples`, { kind: "success" });
  }, [multiSelectIds, samples, onTransformSample, bulkDelayPresetId]);

  // v3.192 — Bulk-Sidechain (Pump) für selektierte Samples:
  // 4-on-the-floor Trigger-Pattern (16-step) und ein SIDECHAIN_PRESETS-Eintrag
  // bestimmen Duck-Tiefe + Attack/Release. applySidechain rendert offline,
  // der gepumpte Buffer wird als WAV encodet und via onTransformSample
  // zurück ins Projekt geschrieben (+ AudioBuffer für AudioEngine-Cache).
  const [bulkSidechainPresetId, setBulkSidechainPresetId] = useState<string>("subtle-pump");

  const handleBulkSidechain = useCallback(async () => {
    if (multiSelectIds.size === 0 || !onTransformSample) return;
    const preset = SIDECHAIN_PRESETS.find((p) => p.id === bulkSidechainPresetId);
    if (!preset) return;
    // 4-on-the-floor trigger pattern (16-step)
    const triggerPattern = [
      true, false, false, false,
      true, false, false, false,
      true, false, false, false,
      true, false, false, false,
    ];
    let applied = 0;
    for (const id of multiSelectIds) {
      const sample = samples.find((s) => s.id === id);
      if (!sample) continue;
      try {
        const buf = await AudioEngine.loadSample(sample.path);
        if (!buf) continue;
        const ducked = applySidechain(buf as unknown as AudioBufferLike, {
          triggerPattern,
          bpm: 120,
          stepsPerBeat: 4,
          duckDb: preset.duckDb,
          attackMs: preset.attackMs,
          releaseMs: preset.releaseMs,
        });
        if (ducked.numberOfChannels === 0 || ducked.length === 0) continue;
        const channels = Math.min(2, ducked.numberOfChannels) as 1 | 2;
        const wav = encodeWav(
          Array.from({ length: channels }, (_, c) =>
            ducked.getChannelData(c) as Float32Array,
          ),
          { sampleRate: ducked.sampleRate, channels, bitDepth: 16 },
        );
        const blob = new Blob([wav], { type: "audio/wav" });
        const newUrl = URL.createObjectURL(blob);
        const Ctor = (window.OfflineAudioContext ||
          // @ts-expect-error legacy webkit fallback
          window.webkitOfflineAudioContext) as typeof OfflineAudioContext;
        const ctx = new Ctor(
          Math.max(1, ducked.numberOfChannels),
          Math.max(1, ducked.length),
          ducked.sampleRate,
        ) as BaseAudioContext;
        const audioBuf = ctx.createBuffer(
          Math.max(1, ducked.numberOfChannels),
          Math.max(1, ducked.length),
          ducked.sampleRate,
        );
        for (let c = 0; c < ducked.numberOfChannels; c++) {
          const src = ducked.getChannelData(c);
          const copy = new Float32Array(src.length);
          copy.set(src);
          audioBuf.copyToChannel(copy, c, 0);
        }
        onTransformSample(id, newUrl, audioBuf);
        applied++;
      } catch {
        /* skip */
      }
    }
    toast(`Sidechain "${preset.name}" (4-on-floor): ${applied} Samples`, { kind: "success" });
  }, [multiSelectIds, samples, onTransformSample, bulkSidechainPresetId]);

  // v3.194 — Bulk-Pitch-Shift (Resample) für selektierte Samples. Semitones-Slider
  // im Bulk-Bar steuert die Verschiebung (±12 st). applyPitchShift rendert pure,
  // der neue Buffer wird als WAV encodet und via onTransformSample zurück ins
  // Projekt geschrieben (+ AudioBuffer für AudioEngine-Cache).
  const [bulkPitchSemitones, setBulkPitchSemitones] = useState<number>(0);

  const handleBulkPitchShift = useCallback(async () => {
    if (multiSelectIds.size === 0 || !onTransformSample || bulkPitchSemitones === 0) return;
    let applied = 0;
    for (const id of multiSelectIds) {
      const sample = samples.find((s) => s.id === id);
      if (!sample) continue;
      try {
        const buf = await AudioEngine.loadSample(sample.path);
        if (!buf) continue;
        const shifted = applyPitchShift(buf as unknown as AudioBufferLike, {
          semitones: bulkPitchSemitones,
        });
        if (shifted.numberOfChannels === 0 || shifted.length === 0) continue;
        const channels = Math.min(2, shifted.numberOfChannels) as 1 | 2;
        const wav = encodeWav(
          Array.from({ length: channels }, (_, c) =>
            shifted.getChannelData(c) as Float32Array,
          ),
          { sampleRate: shifted.sampleRate, channels, bitDepth: 16 },
        );
        const blob = new Blob([wav], { type: "audio/wav" });
        const newUrl = URL.createObjectURL(blob);
        const Ctor = (window.OfflineAudioContext ||
          // @ts-expect-error legacy webkit fallback
          window.webkitOfflineAudioContext) as typeof OfflineAudioContext;
        const ctx = new Ctor(
          Math.max(1, shifted.numberOfChannels),
          Math.max(1, shifted.length),
          shifted.sampleRate,
        ) as BaseAudioContext;
        const audioBuf = ctx.createBuffer(
          Math.max(1, shifted.numberOfChannels),
          Math.max(1, shifted.length),
          shifted.sampleRate,
        );
        for (let c = 0; c < shifted.numberOfChannels; c++) {
          const src = shifted.getChannelData(c);
          const copy = new Float32Array(src.length);
          copy.set(src);
          audioBuf.copyToChannel(copy, c, 0);
        }
        onTransformSample(id, newUrl, audioBuf);
        applied++;
      } catch {
        /* skip */
      }
    }
    toast(
      `Pitch-Shift ${bulkPitchSemitones > 0 ? "+" : ""}${bulkPitchSemitones} st: ${applied} Samples`,
      { kind: "success" },
    );
  }, [multiSelectIds, samples, onTransformSample, bulkPitchSemitones]);

  // v3.195 — Bulk-Saturator für selektierte Samples. Preset (subtle / tube / tape /
  // hard-clip) steuert type+drive+outputGain.  applySaturator rendert pure, der
  // neue Buffer wird als WAV encodet und via onTransformSample zurück ins Projekt
  // geschrieben (+ AudioBuffer für AudioEngine-Cache).
  const [bulkSatPresetId, setBulkSatPresetId] = useState<string>("subtle");

  const handleBulkSaturator = useCallback(async () => {
    if (multiSelectIds.size === 0 || !onTransformSample) return;
    const preset = SATURATOR_PRESETS.find((p) => p.id === bulkSatPresetId);
    if (!preset) return;
    let applied = 0;
    for (const id of multiSelectIds) {
      const sample = samples.find((s) => s.id === id);
      if (!sample) continue;
      try {
        const buf = await AudioEngine.loadSample(sample.path);
        if (!buf) continue;
        const sat = applySaturator(buf as unknown as AudioBufferLike, {
          type: preset.type,
          drive: preset.drive,
          outputGain: preset.outputGain,
        });
        if (sat.numberOfChannels === 0 || sat.length === 0) continue;
        const channels = Math.min(2, sat.numberOfChannels) as 1 | 2;
        const wav = encodeWav(
          Array.from({ length: channels }, (_, c) =>
            sat.getChannelData(c) as Float32Array,
          ),
          { sampleRate: sat.sampleRate, channels, bitDepth: 16 },
        );
        const blob = new Blob([wav], { type: "audio/wav" });
        const newUrl = URL.createObjectURL(blob);
        const Ctor = (window.OfflineAudioContext ||
          // @ts-expect-error legacy webkit fallback
          window.webkitOfflineAudioContext) as typeof OfflineAudioContext;
        const ctx = new Ctor(
          Math.max(1, sat.numberOfChannels),
          Math.max(1, sat.length),
          sat.sampleRate,
        ) as BaseAudioContext;
        const audioBuf = ctx.createBuffer(
          Math.max(1, sat.numberOfChannels),
          Math.max(1, sat.length),
          sat.sampleRate,
        );
        for (let c = 0; c < sat.numberOfChannels; c++) {
          const src = sat.getChannelData(c);
          const copy = new Float32Array(src.length);
          copy.set(src);
          audioBuf.copyToChannel(copy, c, 0);
        }
        onTransformSample(id, newUrl, audioBuf);
        applied++;
      } catch {
        /* skip */
      }
    }
    toast(`Saturator "${preset.name}": ${applied} Samples`, { kind: "success" });
  }, [multiSelectIds, samples, onTransformSample, bulkSatPresetId]);

  // v3.197 — Bulk-Stereo-Enhancer (M/S Width-Slider) für selektierte Samples.
  // width = 0 (mono collapse), 1 (identity, no-op), 2 (extreme wide). applyStereoEnhance
  // rendert pure, der neue Buffer wird als WAV encodet und via onTransformSample zurück
  // ins Projekt geschrieben (+ AudioBuffer für AudioEngine-Cache).
  const [bulkWidth, setBulkWidth] = useState<number>(1);

  const handleBulkStereo = useCallback(async () => {
    if (multiSelectIds.size === 0 || !onTransformSample || bulkWidth === 1) return;
    let applied = 0;
    for (const id of multiSelectIds) {
      const sample = samples.find((s) => s.id === id);
      if (!sample) continue;
      try {
        const buf = await AudioEngine.loadSample(sample.path);
        if (!buf) continue;
        const out = applyStereoEnhance(buf as unknown as AudioBufferLike, {
          width: bulkWidth,
        });
        if (out.numberOfChannels === 0 || out.length === 0) continue;
        const channels = Math.min(2, out.numberOfChannels) as 1 | 2;
        const wav = encodeWav(
          Array.from({ length: channels }, (_, c) =>
            out.getChannelData(c) as Float32Array,
          ),
          { sampleRate: out.sampleRate, channels, bitDepth: 16 },
        );
        const blob = new Blob([wav], { type: "audio/wav" });
        const newUrl = URL.createObjectURL(blob);
        const Ctor = (window.OfflineAudioContext ||
          // @ts-expect-error legacy webkit fallback
          window.webkitOfflineAudioContext) as typeof OfflineAudioContext;
        const ctx = new Ctor(
          Math.max(1, out.numberOfChannels),
          Math.max(1, out.length),
          out.sampleRate,
        ) as BaseAudioContext;
        const audioBuf = ctx.createBuffer(
          Math.max(1, out.numberOfChannels),
          Math.max(1, out.length),
          out.sampleRate,
        );
        for (let c = 0; c < out.numberOfChannels; c++) {
          const src = out.getChannelData(c);
          const copy = new Float32Array(src.length);
          copy.set(src);
          audioBuf.copyToChannel(copy, c, 0);
        }
        onTransformSample(id, newUrl, audioBuf);
        applied++;
      } catch {
        /* skip */
      }
    }
    toast(`Stereo-Width ${bulkWidth.toFixed(2)}: ${applied} Samples`, { kind: "success" });
  }, [multiSelectIds, samples, onTransformSample, bulkWidth]);

  // v3.199 — Bulk-Low-Pass-Filter für selektierte Samples. cutoffHz-Slider
  // 500..10000 Hz (default 5000 = "bright" preset). applyLowPass rendert pure,
  // der neue Buffer wird als WAV encodet und via onTransformSample zurück ins
  // Projekt geschrieben (+ AudioBuffer für AudioEngine-Cache).
  const [bulkLowPassCutoff, setBulkLowPassCutoff] = useState<number>(5000);

  const handleBulkLowPass = useCallback(async () => {
    if (multiSelectIds.size === 0 || !onTransformSample) return;
    let applied = 0;
    for (const id of multiSelectIds) {
      const sample = samples.find((s) => s.id === id);
      if (!sample) continue;
      try {
        const buf = await AudioEngine.loadSample(sample.path);
        if (!buf) continue;
        const out = applyLowPass(buf as unknown as AudioBufferLike, {
          cutoffHz: bulkLowPassCutoff,
        });
        if (out.numberOfChannels === 0 || out.length === 0) continue;
        const channels = Math.min(2, out.numberOfChannels) as 1 | 2;
        const wav = encodeWav(
          Array.from({ length: channels }, (_, c) =>
            out.getChannelData(c) as Float32Array,
          ),
          { sampleRate: out.sampleRate, channels, bitDepth: 16 },
        );
        const blob = new Blob([wav], { type: "audio/wav" });
        const newUrl = URL.createObjectURL(blob);
        const Ctor = (window.OfflineAudioContext ||
          // @ts-expect-error legacy webkit fallback
          window.webkitOfflineAudioContext) as typeof OfflineAudioContext;
        const ctx = new Ctor(
          Math.max(1, out.numberOfChannels),
          Math.max(1, out.length),
          out.sampleRate,
        ) as BaseAudioContext;
        const audioBuf = ctx.createBuffer(
          Math.max(1, out.numberOfChannels),
          Math.max(1, out.length),
          out.sampleRate,
        );
        for (let c = 0; c < out.numberOfChannels; c++) {
          const src = out.getChannelData(c);
          const copy = new Float32Array(src.length);
          copy.set(src);
          audioBuf.copyToChannel(copy, c, 0);
        }
        onTransformSample(id, newUrl, audioBuf);
        applied++;
      } catch {
        /* skip */
      }
    }
    toast(`Low-Pass ${bulkLowPassCutoff}Hz: ${applied} Samples`, { kind: "success" });
  }, [multiSelectIds, samples, onTransformSample, bulkLowPassCutoff]);

  // v3.201 — Bulk-High-Pass-Filter für selektierte Samples. cutoffHz-Slider
  // 50..800 Hz (default 80 = "rumble" preset). applyHighPass rendert pure,
  // der neue Buffer wird als WAV encodet und via onTransformSample zurück ins
  // Projekt geschrieben (+ AudioBuffer für AudioEngine-Cache).
  const [bulkHighPassCutoff, setBulkHighPassCutoff] = useState<number>(80);

  const handleBulkHighPass = useCallback(async () => {
    if (multiSelectIds.size === 0 || !onTransformSample) return;
    let applied = 0;
    for (const id of multiSelectIds) {
      const sample = samples.find((s) => s.id === id);
      if (!sample) continue;
      try {
        const buf = await AudioEngine.loadSample(sample.path);
        if (!buf) continue;
        const out = applyHighPass(buf as unknown as AudioBufferLike, {
          cutoffHz: bulkHighPassCutoff,
        });
        if (out.numberOfChannels === 0 || out.length === 0) continue;
        const channels = Math.min(2, out.numberOfChannels) as 1 | 2;
        const wav = encodeWav(
          Array.from({ length: channels }, (_, c) =>
            out.getChannelData(c) as Float32Array,
          ),
          { sampleRate: out.sampleRate, channels, bitDepth: 16 },
        );
        const blob = new Blob([wav], { type: "audio/wav" });
        const newUrl = URL.createObjectURL(blob);
        const Ctor = (window.OfflineAudioContext ||
          // @ts-expect-error legacy webkit fallback
          window.webkitOfflineAudioContext) as typeof OfflineAudioContext;
        const ctx = new Ctor(
          Math.max(1, out.numberOfChannels),
          Math.max(1, out.length),
          out.sampleRate,
        ) as BaseAudioContext;
        const audioBuf = ctx.createBuffer(
          Math.max(1, out.numberOfChannels),
          Math.max(1, out.length),
          out.sampleRate,
        );
        for (let c = 0; c < out.numberOfChannels; c++) {
          const src = out.getChannelData(c);
          const copy = new Float32Array(src.length);
          copy.set(src);
          audioBuf.copyToChannel(copy, c, 0);
        }
        onTransformSample(id, newUrl, audioBuf);
        applied++;
      } catch {
        /* skip */
      }
    }
    toast(`High-Pass ${bulkHighPassCutoff}Hz: ${applied} Samples`, { kind: "success" });
  }, [multiSelectIds, samples, onTransformSample, bulkHighPassCutoff]);

  // v3.202 — Bulk-Band-Pass für selektierte Samples. Center 100..10000 Hz
  // (default 1500 = "telephone" preset), Width 100..5000 Hz (default 2000).
  // applyBandPass cascadiert HighPass→LowPass pure, der neue Buffer wird als
  // WAV encodet und via onTransformSample zurück ins Projekt geschrieben
  // (+ AudioBuffer für AudioEngine-Cache).
  const [bulkBandPassCenter, setBulkBandPassCenter] = useState<number>(1500);
  const [bulkBandPassWidth, setBulkBandPassWidth] = useState<number>(2000);

  const handleBulkBandPass = useCallback(async () => {
    if (multiSelectIds.size === 0 || !onTransformSample) return;
    let applied = 0;
    for (const id of multiSelectIds) {
      const sample = samples.find((s) => s.id === id);
      if (!sample) continue;
      try {
        const buf = await AudioEngine.loadSample(sample.path);
        if (!buf) continue;
        const out = applyBandPass(buf as unknown as AudioBufferLike, {
          centerHz: bulkBandPassCenter,
          bandwidthHz: bulkBandPassWidth,
        });
        if (out.numberOfChannels === 0 || out.length === 0) continue;
        const channels = Math.min(2, out.numberOfChannels) as 1 | 2;
        const wav = encodeWav(
          Array.from({ length: channels }, (_, c) =>
            out.getChannelData(c) as Float32Array,
          ),
          { sampleRate: out.sampleRate, channels, bitDepth: 16 },
        );
        const blob = new Blob([wav], { type: "audio/wav" });
        const newUrl = URL.createObjectURL(blob);
        const Ctor = (window.OfflineAudioContext ||
          // @ts-expect-error legacy webkit fallback
          window.webkitOfflineAudioContext) as typeof OfflineAudioContext;
        const ctx = new Ctor(
          Math.max(1, out.numberOfChannels),
          Math.max(1, out.length),
          out.sampleRate,
        ) as BaseAudioContext;
        const audioBuf = ctx.createBuffer(
          Math.max(1, out.numberOfChannels),
          Math.max(1, out.length),
          out.sampleRate,
        );
        for (let c = 0; c < out.numberOfChannels; c++) {
          const src = out.getChannelData(c);
          const copy = new Float32Array(src.length);
          copy.set(src);
          audioBuf.copyToChannel(copy, c, 0);
        }
        onTransformSample(id, newUrl, audioBuf);
        applied++;
      } catch {
        /* skip */
      }
    }
    toast(
      `Band-Pass ${bulkBandPassCenter}Hz ±${bulkBandPassWidth}Hz: ${applied} Samples`,
      { kind: "success" },
    );
  }, [
    multiSelectIds,
    samples,
    onTransformSample,
    bulkBandPassCenter,
    bulkBandPassWidth,
  ]);

  // v3.203 — Bulk-All-Pass (Phaser-Like) für selektierte Samples.
  // Phaser-Preset defaults: center 1000 Hz, stages 4. applyAllPass ist pure;
  // der resultierende Buffer wird als WAV encodet und via onTransformSample
  // zurück ins Projekt geschrieben (+ AudioBuffer für AudioEngine-Cache).
  const [bulkAllPassCenter, setBulkAllPassCenter] = useState<number>(1000);
  const [bulkAllPassStages, setBulkAllPassStages] = useState<number>(4);

  const handleBulkAllPass = useCallback(async () => {
    if (multiSelectIds.size === 0 || !onTransformSample) return;
    let applied = 0;
    for (const id of multiSelectIds) {
      const sample = samples.find((s) => s.id === id);
      if (!sample) continue;
      try {
        const buf = await AudioEngine.loadSample(sample.path);
        if (!buf) continue;
        const out = applyAllPass(buf as unknown as AudioBufferLike, {
          centerHz: bulkAllPassCenter,
          stages: bulkAllPassStages,
        });
        if (out.numberOfChannels === 0 || out.length === 0) continue;
        const channels = Math.min(2, out.numberOfChannels) as 1 | 2;
        const wav = encodeWav(
          Array.from({ length: channels }, (_, c) =>
            out.getChannelData(c) as Float32Array,
          ),
          { sampleRate: out.sampleRate, channels, bitDepth: 16 },
        );
        const blob = new Blob([wav], { type: "audio/wav" });
        const newUrl = URL.createObjectURL(blob);
        const Ctor = (window.OfflineAudioContext ||
          // @ts-expect-error legacy webkit fallback
          window.webkitOfflineAudioContext) as typeof OfflineAudioContext;
        const ctx = new Ctor(
          Math.max(1, out.numberOfChannels),
          Math.max(1, out.length),
          out.sampleRate,
        ) as BaseAudioContext;
        const audioBuf = ctx.createBuffer(
          Math.max(1, out.numberOfChannels),
          Math.max(1, out.length),
          out.sampleRate,
        );
        for (let c = 0; c < out.numberOfChannels; c++) {
          const src = out.getChannelData(c);
          const copy = new Float32Array(src.length);
          copy.set(src);
          audioBuf.copyToChannel(copy, c, 0);
        }
        onTransformSample(id, newUrl, audioBuf);
        applied++;
      } catch {
        /* skip */
      }
    }
    toast(
      `All-Pass ${bulkAllPassCenter}Hz ×${bulkAllPassStages}: ${applied} Samples`,
      { kind: "success" },
    );
  }, [
    multiSelectIds,
    samples,
    onTransformSample,
    bulkAllPassCenter,
    bulkAllPassStages,
  ]);

  // v3.204 — Bulk-Speed (changeSpeedRatio) für selektierte Samples.
  // ratio=1 identity (=disabled), >1 schneller+höher pitch, <1 langsamer+tiefer pitch.
  // changeSpeedRatio ist pure; resultierender Buffer wird als WAV encodet und via
  // onTransformSample zurück ins Projekt geschrieben (+ AudioBuffer für AudioEngine-Cache).
  const [bulkSpeedRatio, setBulkSpeedRatio] = useState<number>(1);

  const handleBulkSpeed = useCallback(async () => {
    if (multiSelectIds.size === 0 || !onTransformSample) return;
    let applied = 0;
    for (const id of multiSelectIds) {
      const sample = samples.find((s) => s.id === id);
      if (!sample) continue;
      try {
        const buf = await AudioEngine.loadSample(sample.path);
        if (!buf) continue;
        const out = changeSpeedRatio(buf as unknown as AudioBufferLike, bulkSpeedRatio);
        if (out.numberOfChannels === 0 || out.length === 0) continue;
        const channels = Math.min(2, out.numberOfChannels) as 1 | 2;
        const wav = encodeWav(
          Array.from({ length: channels }, (_, c) =>
            out.getChannelData(c) as Float32Array,
          ),
          { sampleRate: out.sampleRate, channels, bitDepth: 16 },
        );
        const blob = new Blob([wav], { type: "audio/wav" });
        const newUrl = URL.createObjectURL(blob);
        const Ctor = (window.OfflineAudioContext ||
          // @ts-expect-error legacy webkit fallback
          window.webkitOfflineAudioContext) as typeof OfflineAudioContext;
        const ctx = new Ctor(
          Math.max(1, out.numberOfChannels),
          Math.max(1, out.length),
          out.sampleRate,
        ) as BaseAudioContext;
        const audioBuf = ctx.createBuffer(
          Math.max(1, out.numberOfChannels),
          Math.max(1, out.length),
          out.sampleRate,
        );
        for (let c = 0; c < out.numberOfChannels; c++) {
          const src = out.getChannelData(c);
          const copy = new Float32Array(src.length);
          copy.set(src);
          audioBuf.copyToChannel(copy, c, 0);
        }
        onTransformSample(id, newUrl, audioBuf);
        applied++;
      } catch {
        /* skip */
      }
    }
    toast(
      `Speed ${bulkSpeedRatio.toFixed(2)}x: ${applied} Samples`,
      { kind: "success" },
    );
  }, [
    multiSelectIds,
    samples,
    onTransformSample,
    bulkSpeedRatio,
  ]);

  // v3.205 — Bulk-SampleRateReduce (LoFi/Bitcrush) für selektierte Samples.
  // factor=1 + bitDepth=16 = identity (=disabled). Sample-and-Hold + optional
  // Bit-Depth-Quantize → digitale Aliasing-Aesthetik. applySampleRateReduce ist
  // pure; resultierender Buffer wird als WAV encodet und via onTransformSample
  // zurück ins Projekt geschrieben (+ AudioBuffer für AudioEngine-Cache).
  // Default-Preset: lofi (factor=4, bitDepth=12).
  const [bulkSrFactor, setBulkSrFactor] = useState<number>(4);
  const [bulkSrBitDepth, setBulkSrBitDepth] = useState<number>(12);

  const handleBulkSrReduce = useCallback(async () => {
    if (multiSelectIds.size === 0 || !onTransformSample) return;
    let applied = 0;
    for (const id of multiSelectIds) {
      const sample = samples.find((s) => s.id === id);
      if (!sample) continue;
      try {
        const buf = await AudioEngine.loadSample(sample.path);
        if (!buf) continue;
        const out = applySampleRateReduce(buf as unknown as AudioBufferLike, {
          reductionFactor: bulkSrFactor,
          bitDepth: bulkSrBitDepth,
        });
        if (out.numberOfChannels === 0 || out.length === 0) continue;
        const channels = Math.min(2, out.numberOfChannels) as 1 | 2;
        const wav = encodeWav(
          Array.from({ length: channels }, (_, c) =>
            out.getChannelData(c) as Float32Array,
          ),
          { sampleRate: out.sampleRate, channels, bitDepth: 16 },
        );
        const blob = new Blob([wav], { type: "audio/wav" });
        const newUrl = URL.createObjectURL(blob);
        const Ctor = (window.OfflineAudioContext ||
          // @ts-expect-error legacy webkit fallback
          window.webkitOfflineAudioContext) as typeof OfflineAudioContext;
        const ctx = new Ctor(
          Math.max(1, out.numberOfChannels),
          Math.max(1, out.length),
          out.sampleRate,
        ) as BaseAudioContext;
        const audioBuf = ctx.createBuffer(
          Math.max(1, out.numberOfChannels),
          Math.max(1, out.length),
          out.sampleRate,
        );
        for (let c = 0; c < out.numberOfChannels; c++) {
          const src = out.getChannelData(c);
          const copy = new Float32Array(src.length);
          copy.set(src);
          audioBuf.copyToChannel(copy, c, 0);
        }
        onTransformSample(id, newUrl, audioBuf);
        applied++;
      } catch {
        /* skip */
      }
    }
    toast(
      `LoFi factor=${bulkSrFactor} bits=${bulkSrBitDepth}: ${applied} Samples`,
      { kind: "success" },
    );
  }, [
    multiSelectIds,
    samples,
    onTransformSample,
    bulkSrFactor,
    bulkSrBitDepth,
  ]);

  // v3.206 — Bulk-Chorus (single-voice, modulierte Delay-Line) für selektierte
  // Samples. mix=0 = identity (=disabled). applyChorus ist pure; resultierender
  // Buffer wird als WAV encodet und via onTransformSample zurück ins Projekt
  // geschrieben (+ AudioBuffer für AudioEngine-Cache). Default-Preset: classic
  // (rateHz=1, mix=0.5).
  const [bulkChorusRate, setBulkChorusRate] = useState<number>(1);
  const [bulkChorusMix, setBulkChorusMix] = useState<number>(0.5);

  const handleBulkChorus = useCallback(async () => {
    if (multiSelectIds.size === 0 || !onTransformSample) return;
    let applied = 0;
    for (const id of multiSelectIds) {
      const sample = samples.find((s) => s.id === id);
      if (!sample) continue;
      try {
        const buf = await AudioEngine.loadSample(sample.path);
        if (!buf) continue;
        const out = applyChorus(buf as unknown as AudioBufferLike, {
          rateHz: bulkChorusRate,
          mix: bulkChorusMix,
        });
        if (out.numberOfChannels === 0 || out.length === 0) continue;
        const channels = Math.min(2, out.numberOfChannels) as 1 | 2;
        const wav = encodeWav(
          Array.from({ length: channels }, (_, c) =>
            out.getChannelData(c) as Float32Array,
          ),
          { sampleRate: out.sampleRate, channels, bitDepth: 16 },
        );
        const blob = new Blob([wav], { type: "audio/wav" });
        const newUrl = URL.createObjectURL(blob);
        const Ctor = (window.OfflineAudioContext ||
          // @ts-expect-error legacy webkit fallback
          window.webkitOfflineAudioContext) as typeof OfflineAudioContext;
        const ctx = new Ctor(
          Math.max(1, out.numberOfChannels),
          Math.max(1, out.length),
          out.sampleRate,
        ) as BaseAudioContext;
        const audioBuf = ctx.createBuffer(
          Math.max(1, out.numberOfChannels),
          Math.max(1, out.length),
          out.sampleRate,
        );
        for (let c = 0; c < out.numberOfChannels; c++) {
          const src = out.getChannelData(c);
          const copy = new Float32Array(src.length);
          copy.set(src);
          audioBuf.copyToChannel(copy, c, 0);
        }
        onTransformSample(id, newUrl, audioBuf);
        applied++;
      } catch {
        /* skip */
      }
    }
    toast(
      `Chorus rate=${bulkChorusRate.toFixed(2)}Hz mix=${bulkChorusMix.toFixed(2)}: ${applied} Samples`,
      { kind: "success" },
    );
  }, [
    multiSelectIds,
    samples,
    onTransformSample,
    bulkChorusRate,
    bulkChorusMix,
  ]);

  // v3.207 — Bulk-Flanger (modulierte Delay-Line + Feedback-Loop) für
  // selektierte Samples. applyFlanger ist pure; resultierender Buffer wird
  // als WAV encodet und via onTransformSample zurück ins Projekt geschrieben
  // (+ AudioBuffer für AudioEngine-Cache). Default-Preset: classic
  // (rateHz=0.5, feedback=0.5). depthMs+delayMs bleiben auf Helper-Defaults.
  const [bulkFlangerRate, setBulkFlangerRate] = useState<number>(0.5);
  const [bulkFlangerFeedback, setBulkFlangerFeedback] = useState<number>(0.5);

  const handleBulkFlanger = useCallback(async () => {
    if (multiSelectIds.size === 0 || !onTransformSample) return;
    let applied = 0;
    for (const id of multiSelectIds) {
      const sample = samples.find((s) => s.id === id);
      if (!sample) continue;
      try {
        const buf = await AudioEngine.loadSample(sample.path);
        if (!buf) continue;
        const out = applyFlanger(buf as unknown as AudioBufferLike, {
          rateHz: bulkFlangerRate,
          feedback: bulkFlangerFeedback,
        });
        if (out.numberOfChannels === 0 || out.length === 0) continue;
        const channels = Math.min(2, out.numberOfChannels) as 1 | 2;
        const wav = encodeWav(
          Array.from({ length: channels }, (_, c) =>
            out.getChannelData(c) as Float32Array,
          ),
          { sampleRate: out.sampleRate, channels, bitDepth: 16 },
        );
        const blob = new Blob([wav], { type: "audio/wav" });
        const newUrl = URL.createObjectURL(blob);
        const Ctor = (window.OfflineAudioContext ||
          // @ts-expect-error legacy webkit fallback
          window.webkitOfflineAudioContext) as typeof OfflineAudioContext;
        const ctx = new Ctor(
          Math.max(1, out.numberOfChannels),
          Math.max(1, out.length),
          out.sampleRate,
        ) as BaseAudioContext;
        const audioBuf = ctx.createBuffer(
          Math.max(1, out.numberOfChannels),
          Math.max(1, out.length),
          out.sampleRate,
        );
        for (let c = 0; c < out.numberOfChannels; c++) {
          const src = out.getChannelData(c);
          const copy = new Float32Array(src.length);
          copy.set(src);
          audioBuf.copyToChannel(copy, c, 0);
        }
        onTransformSample(id, newUrl, audioBuf);
        applied++;
      } catch {
        /* skip */
      }
    }
    toast(
      `Flanger rate=${bulkFlangerRate.toFixed(2)}Hz fb=${bulkFlangerFeedback.toFixed(2)}: ${applied} Samples`,
      { kind: "success" },
    );
  }, [
    multiSelectIds,
    samples,
    onTransformSample,
    bulkFlangerRate,
    bulkFlangerFeedback,
  ]);

  // v3.208 — Bulk-Tremolo (Amplitude-Modulation via LFO) für selektierte
  // Samples. depth=0 = identity (=disabled). applyTremolo ist pure;
  // resultierender Buffer wird als WAV encodet und via onTransformSample
  // zurück ins Projekt geschrieben (+ AudioBuffer für AudioEngine-Cache).
  // Default-Preset: classic (rateHz=5, depth=0.5).
  const [bulkTremoloRate, setBulkTremoloRate] = useState<number>(5);
  const [bulkTremoloDepth, setBulkTremoloDepth] = useState<number>(0.5);

  const handleBulkTremolo = useCallback(async () => {
    if (multiSelectIds.size === 0 || !onTransformSample) return;
    let applied = 0;
    for (const id of multiSelectIds) {
      const sample = samples.find((s) => s.id === id);
      if (!sample) continue;
      try {
        const buf = await AudioEngine.loadSample(sample.path);
        if (!buf) continue;
        const out = applyTremolo(buf as unknown as AudioBufferLike, {
          rateHz: bulkTremoloRate,
          depth: bulkTremoloDepth,
        });
        if (out.numberOfChannels === 0 || out.length === 0) continue;
        const channels = Math.min(2, out.numberOfChannels) as 1 | 2;
        const wav = encodeWav(
          Array.from({ length: channels }, (_, c) =>
            out.getChannelData(c) as Float32Array,
          ),
          { sampleRate: out.sampleRate, channels, bitDepth: 16 },
        );
        const blob = new Blob([wav], { type: "audio/wav" });
        const newUrl = URL.createObjectURL(blob);
        const Ctor = (window.OfflineAudioContext ||
          // @ts-expect-error legacy webkit fallback
          window.webkitOfflineAudioContext) as typeof OfflineAudioContext;
        const ctx = new Ctor(
          Math.max(1, out.numberOfChannels),
          Math.max(1, out.length),
          out.sampleRate,
        ) as BaseAudioContext;
        const audioBuf = ctx.createBuffer(
          Math.max(1, out.numberOfChannels),
          Math.max(1, out.length),
          out.sampleRate,
        );
        for (let c = 0; c < out.numberOfChannels; c++) {
          const src = out.getChannelData(c);
          const copy = new Float32Array(src.length);
          copy.set(src);
          audioBuf.copyToChannel(copy, c, 0);
        }
        onTransformSample(id, newUrl, audioBuf);
        applied++;
      } catch {
        /* skip */
      }
    }
    toast(
      `Tremolo rate=${bulkTremoloRate.toFixed(2)}Hz depth=${bulkTremoloDepth.toFixed(2)}: ${applied} Samples`,
      { kind: "success" },
    );
  }, [
    multiSelectIds,
    samples,
    onTransformSample,
    bulkTremoloRate,
    bulkTremoloDepth,
  ]);

  // v3.209 — Bulk-Vibrato (Pitch-Modulation via LFO) für selektierte
  // Samples. depthCents=0 = identity (=disabled). applyVibrato ist pure;
  // resultierender Buffer wird als WAV encodet und via onTransformSample
  // zurück ins Projekt geschrieben (+ AudioBuffer für AudioEngine-Cache).
  // Default-Preset: classic (rateHz=5, depthCents=20).
  const [bulkVibratoRate, setBulkVibratoRate] = useState<number>(5);
  const [bulkVibratoDepth, setBulkVibratoDepth] = useState<number>(20);

  const handleBulkVibrato = useCallback(async () => {
    if (multiSelectIds.size === 0 || !onTransformSample) return;
    let applied = 0;
    for (const id of multiSelectIds) {
      const sample = samples.find((s) => s.id === id);
      if (!sample) continue;
      try {
        const buf = await AudioEngine.loadSample(sample.path);
        if (!buf) continue;
        const out = applyVibrato(buf as unknown as AudioBufferLike, {
          rateHz: bulkVibratoRate,
          depthCents: bulkVibratoDepth,
        });
        if (out.numberOfChannels === 0 || out.length === 0) continue;
        const channels = Math.min(2, out.numberOfChannels) as 1 | 2;
        const wav = encodeWav(
          Array.from({ length: channels }, (_, c) =>
            out.getChannelData(c) as Float32Array,
          ),
          { sampleRate: out.sampleRate, channels, bitDepth: 16 },
        );
        const blob = new Blob([wav], { type: "audio/wav" });
        const newUrl = URL.createObjectURL(blob);
        const Ctor = (window.OfflineAudioContext ||
          // @ts-expect-error legacy webkit fallback
          window.webkitOfflineAudioContext) as typeof OfflineAudioContext;
        const ctx = new Ctor(
          Math.max(1, out.numberOfChannels),
          Math.max(1, out.length),
          out.sampleRate,
        ) as BaseAudioContext;
        const audioBuf = ctx.createBuffer(
          Math.max(1, out.numberOfChannels),
          Math.max(1, out.length),
          out.sampleRate,
        );
        for (let c = 0; c < out.numberOfChannels; c++) {
          const src = out.getChannelData(c);
          const copy = new Float32Array(src.length);
          copy.set(src);
          audioBuf.copyToChannel(copy, c, 0);
        }
        onTransformSample(id, newUrl, audioBuf);
        applied++;
      } catch {
        /* skip */
      }
    }
    toast(
      `Vibrato rate=${bulkVibratoRate.toFixed(1)}Hz depth=${bulkVibratoDepth.toFixed(0)}c: ${applied} Samples`,
      { kind: "success" },
    );
  }, [
    multiSelectIds,
    samples,
    onTransformSample,
    bulkVibratoRate,
    bulkVibratoDepth,
  ]);

  // v3.211 — Bulk-AutoPan (Stereo-Pan-Modulation via LFO) für selektierte
  // Samples. depth=0 = equal-power center (L==R). applyAutoPan ist pure;
  // resultierender Buffer wird als WAV encodet und via onTransformSample
  // zurück ins Projekt geschrieben (+ AudioBuffer für AudioEngine-Cache).
  // Default-Preset: classic (rateHz=0.5, depth=0.7).
  const [bulkAutoPanRate, setBulkAutoPanRate] = useState<number>(0.5);
  const [bulkAutoPanDepth, setBulkAutoPanDepth] = useState<number>(0.7);

  const handleBulkAutoPan = useCallback(async () => {
    if (multiSelectIds.size === 0 || !onTransformSample) return;
    let applied = 0;
    for (const id of multiSelectIds) {
      const sample = samples.find((s) => s.id === id);
      if (!sample) continue;
      try {
        const buf = await AudioEngine.loadSample(sample.path);
        if (!buf) continue;
        const out = applyAutoPan(buf as unknown as AudioBufferLike, {
          rateHz: bulkAutoPanRate,
          depth: bulkAutoPanDepth,
        });
        if (out.numberOfChannels === 0 || out.length === 0) continue;
        const channels = Math.min(2, out.numberOfChannels) as 1 | 2;
        const wav = encodeWav(
          Array.from({ length: channels }, (_, c) =>
            out.getChannelData(c) as Float32Array,
          ),
          { sampleRate: out.sampleRate, channels, bitDepth: 16 },
        );
        const blob = new Blob([wav], { type: "audio/wav" });
        const newUrl = URL.createObjectURL(blob);
        const Ctor = (window.OfflineAudioContext ||
          // @ts-expect-error legacy webkit fallback
          window.webkitOfflineAudioContext) as typeof OfflineAudioContext;
        const ctx = new Ctor(
          Math.max(1, out.numberOfChannels),
          Math.max(1, out.length),
          out.sampleRate,
        ) as BaseAudioContext;
        const audioBuf = ctx.createBuffer(
          Math.max(1, out.numberOfChannels),
          Math.max(1, out.length),
          out.sampleRate,
        );
        for (let c = 0; c < out.numberOfChannels; c++) {
          const src = out.getChannelData(c);
          const copy = new Float32Array(src.length);
          copy.set(src);
          audioBuf.copyToChannel(copy, c, 0);
        }
        onTransformSample(id, newUrl, audioBuf);
        applied++;
      } catch {
        /* skip */
      }
    }
    toast(
      `AutoPan rate=${bulkAutoPanRate.toFixed(2)}Hz depth=${bulkAutoPanDepth.toFixed(2)}: ${applied} Samples`,
      { kind: "success" },
    );
  }, [
    multiSelectIds,
    samples,
    onTransformSample,
    bulkAutoPanRate,
    bulkAutoPanDepth,
  ]);

  // v3.212 — Bulk-Stutter-Buffer (Slice-Repeat) für selektierte Samples.
  // Extrahiert eine Slice (sliceMs ab 0) und wiederholt sie `repeats` mal.
  // applyStutterBuffer ist pure; resultierender Buffer (Länge =
  // repeats * sliceSamples, NICHT input.length) wird als WAV encodet und
  // via onTransformSample zurück ins Projekt geschrieben (+ AudioBuffer
  // für AudioEngine-Cache). Default-Preset: classic (sliceMs=50, repeats=4).
  const [bulkStutterSlice, setBulkStutterSlice] = useState<number>(50);
  const [bulkStutterRepeats, setBulkStutterRepeats] = useState<number>(4);

  const handleBulkStutter = useCallback(async () => {
    if (multiSelectIds.size === 0 || !onTransformSample) return;
    let applied = 0;
    for (const id of multiSelectIds) {
      const sample = samples.find((s) => s.id === id);
      if (!sample) continue;
      try {
        const buf = await AudioEngine.loadSample(sample.path);
        if (!buf) continue;
        const out = applyStutterBuffer(buf as unknown as AudioBufferLike, {
          sliceMs: bulkStutterSlice,
          repeats: bulkStutterRepeats,
        });
        if (out.numberOfChannels === 0 || out.length === 0) continue;
        const channels = Math.min(2, out.numberOfChannels) as 1 | 2;
        const wav = encodeWav(
          Array.from({ length: channels }, (_, c) =>
            out.getChannelData(c) as Float32Array,
          ),
          { sampleRate: out.sampleRate, channels, bitDepth: 16 },
        );
        const blob = new Blob([wav], { type: "audio/wav" });
        const newUrl = URL.createObjectURL(blob);
        const Ctor = (window.OfflineAudioContext ||
          // @ts-expect-error legacy webkit fallback
          window.webkitOfflineAudioContext) as typeof OfflineAudioContext;
        const ctx = new Ctor(
          Math.max(1, out.numberOfChannels),
          Math.max(1, out.length),
          out.sampleRate,
        ) as BaseAudioContext;
        const audioBuf = ctx.createBuffer(
          Math.max(1, out.numberOfChannels),
          Math.max(1, out.length),
          out.sampleRate,
        );
        for (let c = 0; c < out.numberOfChannels; c++) {
          const src = out.getChannelData(c);
          const copy = new Float32Array(src.length);
          copy.set(src);
          audioBuf.copyToChannel(copy, c, 0);
        }
        onTransformSample(id, newUrl, audioBuf);
        applied++;
      } catch {
        /* skip */
      }
    }
    toast(
      `Stutter ${bulkStutterSlice}ms ×${bulkStutterRepeats}: ${applied} Samples`,
      { kind: "success" },
    );
  }, [
    multiSelectIds,
    samples,
    onTransformSample,
    bulkStutterSlice,
    bulkStutterRepeats,
  ]);

  // v3.213 — Bulk-ADSR (Gain-Envelope) für selektierte Samples.
  // applyAdsr ist pure; resultierender Buffer (gleiche Länge wie Input) wird
  // als WAV encodet und via onTransformSample zurück ins Projekt geschrieben
  // (+ AudioBuffer für AudioEngine-Cache). Vereinfacht: nur Attack + Release
  // exposed; Decay (100ms) + Sustain (0.7) bleiben Helper-Defaults.
  const [bulkAdsrAttack, setBulkAdsrAttack] = useState<number>(10);
  const [bulkAdsrRelease, setBulkAdsrRelease] = useState<number>(200);

  const handleBulkAdsr = useCallback(async () => {
    if (multiSelectIds.size === 0 || !onTransformSample) return;
    let applied = 0;
    for (const id of multiSelectIds) {
      const sample = samples.find((s) => s.id === id);
      if (!sample) continue;
      try {
        const buf = await AudioEngine.loadSample(sample.path);
        if (!buf) continue;
        const out = applyAdsr(buf as unknown as AudioBufferLike, {
          attackMs: bulkAdsrAttack,
          releaseMs: bulkAdsrRelease,
        });
        if (out.numberOfChannels === 0 || out.length === 0) continue;
        const channels = Math.min(2, out.numberOfChannels) as 1 | 2;
        const wav = encodeWav(
          Array.from({ length: channels }, (_, c) =>
            out.getChannelData(c) as Float32Array,
          ),
          { sampleRate: out.sampleRate, channels, bitDepth: 16 },
        );
        const blob = new Blob([wav], { type: "audio/wav" });
        const newUrl = URL.createObjectURL(blob);
        const Ctor = (window.OfflineAudioContext ||
          // @ts-expect-error legacy webkit fallback
          window.webkitOfflineAudioContext) as typeof OfflineAudioContext;
        const ctx = new Ctor(
          Math.max(1, out.numberOfChannels),
          Math.max(1, out.length),
          out.sampleRate,
        ) as BaseAudioContext;
        const audioBuf = ctx.createBuffer(
          Math.max(1, out.numberOfChannels),
          Math.max(1, out.length),
          out.sampleRate,
        );
        for (let c = 0; c < out.numberOfChannels; c++) {
          const src = out.getChannelData(c);
          const copy = new Float32Array(src.length);
          copy.set(src);
          audioBuf.copyToChannel(copy, c, 0);
        }
        onTransformSample(id, newUrl, audioBuf);
        applied++;
      } catch {
        /* skip */
      }
    }
    toast(
      `ADSR A=${bulkAdsrAttack}ms R=${bulkAdsrRelease}ms: ${applied} Samples`,
      { kind: "success" },
    );
  }, [
    multiSelectIds,
    samples,
    onTransformSample,
    bulkAdsrAttack,
    bulkAdsrRelease,
  ]);

  // v3.152: Wenn Samples aus dem Projekt verschwinden (extern gelöscht),
  // multi-select-Set defensiv auf Existenz-Filter laufen lassen.
  useEffect(() => {
    setMultiSelectIds((prev) => {
      if (prev.size === 0) return prev;
      const filtered = filterSelected(samples.map((s) => s.id), prev);
      return filtered.size === prev.size ? prev : filtered;
    });
  }, [samples]);

  // ── Doppelklick → Sample auf aktiven Kanal legen ──────────────────────────
  const handleDoubleClickSample = useCallback((sample: Sample) => {
    if (onAssignToChannel) {
      onAssignToChannel(sample.path, sample.name);
    }
  }, [onAssignToChannel]);

  // ── Preview-Toggle ────────────────────────────────────────────────────────
  const handlePreviewToggle = useCallback((sample?: Sample) => {
    const target = sample ?? selectedSample;
    if (!target) return;

    if (audioPreviewRef.current && isPreviewPlaying) {
      audioPreviewRef.current.pause();
      audioPreviewRef.current = null;
      setIsPreviewPlaying(false);
      setPlaybackPosition(0);
      return;
    }

    const audio = new Audio(target.path);
    audio.volume = 0.8;
    audio.onended = () => {
      setIsPreviewPlaying(false);
      setPlaybackPosition(0);
      audioPreviewRef.current = null;
    };
    audio.onerror = () => {
      setIsPreviewPlaying(false);
      audioPreviewRef.current = null;
    };
    audioPreviewRef.current = audio;
    audio.play()
      .then(() => setIsPreviewPlaying(true))
      .catch(() => setIsPreviewPlaying(false));
  }, [isPreviewPlaying, selectedSample]);

  // ── Seek per Waveform-Klick ───────────────────────────────────────────────
  const handleSeek = useCallback((position: number) => {
    const audio = audioPreviewRef.current;
    if (audio && audio.duration > 0) {
      audio.currentTime = position * audio.duration;
      setPlaybackPosition(position);
    } else if (selectedSample) {
      const newAudio = new Audio(selectedSample.path);
      newAudio.volume = 0.8;
      newAudio.onloadedmetadata = () => {
        newAudio.currentTime = position * newAudio.duration;
        newAudio.play().then(() => setIsPreviewPlaying(true)).catch(() => {});
      };
      newAudio.onended = () => {
        setIsPreviewPlaying(false);
        setPlaybackPosition(0);
        audioPreviewRef.current = null;
      };
      audioPreviewRef.current = newAudio;
    }
  }, [selectedSample]);

  // ── Navigation ────────────────────────────────────────────────────────────
  const handleNavigatePrev = useCallback(() => {
    if (filteredSamples.length === 0) return;
    const idx = selectedIndex <= 0 ? filteredSamples.length - 1 : selectedIndex - 1;
    handleSelectSample(filteredSamples[idx]);
  }, [filteredSamples, selectedIndex, handleSelectSample]);

  const handleNavigateNext = useCallback(() => {
    if (filteredSamples.length === 0) return;
    const idx = selectedIndex >= filteredSamples.length - 1 ? 0 : selectedIndex + 1;
    handleSelectSample(filteredSamples[idx]);
  }, [filteredSamples, selectedIndex, handleSelectSample]);

  // ── Keyboard-Shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === "INPUT") return;
      if (document.activeElement?.tagName === "TEXTAREA") return;
      // v3.156: Ctrl/Cmd+A → alle (gefilterten) Samples selektieren.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setMultiSelectIds(selectAll(filteredSamples.map((s) => s.id)));
        return;
      }
      // v3.156: Escape → Multi-Select clearen (Single-Select bleibt).
      if (e.key === "Escape" && multiSelectIds.size > 0) {
        e.preventDefault();
        setMultiSelectIds(clearSelection());
        return;
      }
      // v3.156: Delete/Backspace → Bulk-Delete bei Multi-Select.
      if ((e.key === "Delete" || e.key === "Backspace") && multiSelectIds.size > 0 && onRemoveSample) {
        e.preventDefault();
        void handleBulkDelete();
        return;
      }
      if (e.key === "ArrowUp") { e.preventDefault(); handleNavigatePrev(); }
      if (e.key === "ArrowDown") { e.preventDefault(); handleNavigateNext(); }
      if (e.key === " " && selectedSampleId) {
        e.preventDefault();
        handlePreviewToggle();
      }
      // Enter = Sample auf aktiven Kanal legen
      if (e.key === "Enter" && selectedSample && onAssignToChannel) {
        e.preventDefault();
        onAssignToChannel(selectedSample.path, selectedSample.name);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleNavigatePrev, handleNavigateNext, handlePreviewToggle, selectedSampleId, selectedSample, onAssignToChannel, filteredSamples, multiSelectIds, onRemoveSample, handleBulkDelete]);

  // ── Drag-Start (für Drag & Drop auf Kanal-Zeilen + Reordering) ───────────
  const handleDragStart = useCallback((e: React.DragEvent, sample: Sample) => {
    e.dataTransfer.setData("sampleId", sample.id);
    e.dataTransfer.setData("sampleUrl", sample.path);
    e.dataTransfer.setData("sampleName", sample.name);
    e.dataTransfer.effectAllowed = "copyMove";
  }, []);

  // ── Reorder-Handler für interne Liste ────────────────────────────────────
  const handleDragOverSample = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverSampleId(targetId);
  }, []);

  const handleDropOnSample = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    setDragOverSampleId(null);
    const draggedId = e.dataTransfer.getData("sampleId");
    if (draggedId && draggedId !== targetId && onReorderSamples) {
      onReorderSamples(draggedId, targetId);
    }
  }, [onReorderSamples]);

  const handleDragLeaveSample = useCallback((e: React.DragEvent) => {
    // Nur zurücksetzen wenn der Cursor das <li> wirklich verlässt (nicht in Kindelement)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverSampleId(null);
    }
  }, []);

  // ── Kategorie-Änderung ────────────────────────────────────────────────────
  const handleCategoryChange = useCallback((sampleId: string, category: string) => {
    onUpdateSampleCategory?.(sampleId, category);
  }, [onUpdateSampleCategory]);

  // ── Playlist-Aktionen ─────────────────────────────────────────────────────
  const handleCreatePlaylist = useCallback((name: string) => {
    const pl: Playlist = {
      id: makePlaylistId(),
      name,
      sampleIds: [],
      createdAt: Date.now(),
    };
    setPlaylists(prev => [...prev, pl]);
    setActivePlaylistId(pl.id);
    setActiveTab("playlists");
  }, []);

  const handleRenamePlaylist = useCallback((id: string, name: string) => {
    setPlaylists(prev => prev.map(p => p.id === id ? { ...p, name } : p));
  }, []);

  const handleDeletePlaylist = useCallback((id: string) => {
    setPlaylists(prev => prev.filter(p => p.id !== id));
    if (activePlaylistId === id) setActivePlaylistId(null);
  }, [activePlaylistId]);

  const handleAddToPlaylist = useCallback((playlistId: string, sampleId: string) => {
    setPlaylists(prev => prev.map(p =>
      p.id === playlistId && !p.sampleIds.includes(sampleId)
        ? { ...p, sampleIds: [...p.sampleIds, sampleId] }
        : p
    ));
  }, []);

  const handleRemoveFromPlaylist = useCallback((playlistId: string, sampleId: string) => {
    setPlaylists(prev => prev.map(p =>
      p.id === playlistId
        ? { ...p, sampleIds: p.sampleIds.filter(id => id !== sampleId) }
        : p
    ));
  }, []);

  // ── Import: Einzelne Dateien ──────────────────────────────────────────────
  const handleImportFiles = useCallback(async () => {
    if (electron.isElectron) {
      const result = await electron.openFileDialog({
        title: "Samples importieren",
        filters: [
          { name: "Audio-Dateien", extensions: ["wav", "mp3", "ogg", "flac", "aiff", "aif", "m4a"] },
          { name: "Alle Dateien", extensions: ["*"] },
        ],
        multiSelections: true,
      });
      if (!result.canceled && result.filePaths.length > 0) {
        onImportSamples(result.filePaths);
      }
    } else {
      fileInputRef.current?.click();
    }
  }, [electron, onImportSamples]);

  // ── Import: Ordner ────────────────────────────────────────────────────────
  const handleImportFolder = useCallback(async () => {
    if (electron.isElectron) {
      const result = await electron.openFolderDialog({ title: "Sample-Ordner importieren" });
      if (!result.canceled && result.filePaths[0]) {
        const folderPath = result.filePaths[0];
        // Primär den nativen rekursiven Import mit Progress nutzen.
        const started = await electron.importFolder(folderPath).catch(() => null);

        // Fallback: Falls kein Import gestartet werden kann, Verzeichnisinhalt direkt importieren.
        if (!started?.importId) {
          const dirResult = await electron.listDirectory(folderPath);
          if (dirResult.success && dirResult.entries) {
            const audioPaths = dirResult.entries
              .filter((entry) => !entry.isDirectory && entry.isAudio)
              .map((entry) => entry.path);
            if (audioPaths.length > 0) {
              onImportSamples(audioPaths);
            } else {
              await electron.showErrorDialog(
                "Import fehlgeschlagen",
                "Der Ordner enthält keine direkt importierbaren Audio-Dateien."
              );
            }
          } else {
            await electron.showErrorDialog(
              "Import fehlgeschlagen",
              dirResult.error ?? "Ordner konnte nicht gelesen werden."
            );
          }
        }
      }
    } else {
      folderInputRef.current?.click();
    }
  }, [electron, onImportSamples]);

  // ── Import: ZIP-Archiv ────────────────────────────────────────────────────
  const handleImportZip = useCallback(async () => {
    if (electron.isElectron) {
      const result = await electron.openFileDialog({
        title: "ZIP-Archiv mit Samples importieren",
        filters: [{ name: "ZIP-Archive", extensions: ["zip"] }],
        multiSelections: false,
      });
      if (!result.canceled && result.filePaths[0]) {
        try {
          const started = await electron.importZip(result.filePaths[0]);
          if (!started?.importId) {
            await electron.showErrorDialog(
              "ZIP-Import fehlgeschlagen",
              "Der ZIP-Import konnte nicht gestartet werden."
            );
          }
        } catch (err) {
          await electron.showErrorDialog(
            "ZIP-Import fehlgeschlagen",
            err instanceof Error ? err.message : String(err)
          );
        }
      }
    } else {
      zipInputRef.current?.click();
    }
  }, [electron]);

  // ── Import: Abbrechen ─────────────────────────────────────────────────────
  const handleCancelImport = useCallback(() => {
    if (importProgress?.importId && electron.isElectron) {
      electron.cancelImport(importProgress.importId);
    }
    setImportProgress(null);
  }, [electron, importProgress]);

  // ── Browser-Fallback: Datei-Input onChange ────────────────────────────────
  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      const audioPaths = files
        .filter((f) => AUDIO_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext)))
        .map((f) => f.name);
      if (audioPaths.length > 0) onImportSamples(audioPaths);
      e.target.value = "";
    },
    [onImportSamples]
  );

  const handleFolderInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      const audioPaths = files
        .filter((f) => AUDIO_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext)))
        .map((f) => (f as File & { webkitRelativePath: string }).webkitRelativePath || f.name);
      if (audioPaths.length > 0) onImportSamples(audioPaths);
      e.target.value = "";
    },
    [onImportSamples]
  );

  const handleZipInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";

      try {
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(file);
        const audioEntries: Array<{ name: string; file: import("jszip").JSZipObject }> = [];

        zip.forEach((relativePath, zipFile) => {
          if (zipFile.dir) return;
          const ext = relativePath.split(".").pop()?.toLowerCase() ?? "";
          if (["wav", "mp3", "ogg", "flac", "aiff", "aif", "m4a"].includes(ext)) {
            audioEntries.push({ name: relativePath, file: zipFile });
          }
        });

        if (audioEntries.length === 0) {
          alert("Keine Audio-Dateien im ZIP-Archiv gefunden.");
          return;
        }

        setImportProgress({
          active: true,
          importId: `browser_zip_${Date.now()}`,
          current: 0,
          total: audioEntries.length,
          percentage: 0,
          phase: "extracting",
        });

        const importedSamples: Sample[] = [];
        for (let i = 0; i < audioEntries.length; i++) {
          const entry = audioEntries[i];
          const blob = await entry.file.async("blob");
          const url = URL.createObjectURL(blob);
          const name = entry.name.split("/").pop()?.replace(/\.[^.]+$/, "") ?? entry.name;

          importedSamples.push({
            id: `zip_${Date.now()}_${i}`,
            name,
            path: url,
            category: "imported",
          });

          setImportProgress((prev) => prev ? {
            ...prev,
            current: i + 1,
            percentage: Math.round(((i + 1) / audioEntries.length) * 100),
            currentFile: name,
          } : null);
        }

        setImportProgress(null);
        if (onSamplesImported) {
          onSamplesImported(importedSamples);
        } else {
          onImportSamples(importedSamples.map((s) => s.path));
        }
      } catch (err) {
        setImportProgress(null);
        console.error("[SampleBrowser] ZIP-Import Fehler:", err);
      }
    },
    [onImportSamples, onSamplesImported]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="relative flex flex-col h-full bg-bg-elevated border border-border-color rounded-lg overflow-hidden">

      {/* Import-Fortschritt-Overlay */}
      {importProgress?.active && (
        <ImportProgress
          current={importProgress.current}
          total={importProgress.total}
          percentage={importProgress.percentage}
          phase={importProgress.phase}
          currentFile={importProgress.currentFile}
          onCancel={handleCancelImport}
        />
      )}

      {/* Kategorie-Kontextmenü */}
      {categoryMenu && (
        <CategoryMenu
          x={categoryMenu.x}
          y={categoryMenu.y}
          currentCategory={categoryMenu.currentCategory}
          onSelect={(cat) => handleCategoryChange(categoryMenu.sampleId, cat)}
          onClose={() => setCategoryMenu(null)}
        />
      )}

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 bg-bg-panel border-b border-border-color">
        <h2 className="text-xs font-semibold text-text-primary tracking-wide uppercase">
          Sample-Browser
        </h2>
        <div className="flex gap-1">
          <button
            onClick={handleImportFiles}
            title="Audio-Dateien importieren"
            className="px-2 py-1 text-xs rounded bg-accent-primary/40 text-accent-secondary border border-accent-primary hover:bg-accent-primary/60 hover:text-accent-secondary transition-colors"
          >
            + Dateien
          </button>
          <button
            onClick={handleImportFolder}
            title="Ordner mit Samples importieren"
            className="px-2 py-1 text-xs rounded bg-bg-elevated/60 text-text-muted border border-border-color hover:bg-bg-elevated/60 hover:text-text-primary transition-colors"
          >
            + Ordner
          </button>
          <button
            onClick={handleImportZip}
            title="ZIP-Archiv mit Samples importieren"
            className="px-2 py-1 text-xs rounded bg-bg-elevated/60 text-text-muted border border-border-color hover:bg-bg-elevated/60 hover:text-text-primary transition-colors"
          >
            + ZIP
          </button>
          {/* Pin/Detach (Multi-Window-Workspace, post-v1.27.0). Nur Electron.
              Öffnet den Sample-Browser in eigenem Fenster für Multi-Monitor. */}
          {electron.isElectron && (
            <button
              type="button"
              onClick={() => electron.openSampleBrowserWindow?.()}
              data-testid="sample-browser-open-in-window"
              title="Sample Browser in eigenes Fenster abkoppeln"
              className="px-2 py-1 text-xs rounded bg-bg-elevated/60 text-text-muted border border-border-color hover:text-accent-primary hover:border-accent-primary transition-colors"
            >
              📌 Pin
            </button>
          )}
        </div>
      </div>

      {/* ── Aktiver Kanal Hinweis ────────────────────────────────────────────── */}
      {onAssignToChannel && activeChannelName && (
        <div className="flex items-center gap-2 px-3 py-1 bg-accent-primary/10 border-b border-accent-primary/30">
          <span className="text-[10px] text-accent-primary">Aktiver Kanal:</span>
          <span className="text-[10px] text-accent-secondary font-medium">{activeChannelName}</span>
          <span className="text-[10px] text-text-dim ml-auto">Doppelklick oder Enter zum Zuweisen</span>
        </div>
      )}

      {/* ── Tabs: Samples / Playlists ────────────────────────────────────────── */}
      <div className="flex border-b border-border-color bg-bg-panel">
        <button
          onClick={() => setActiveTab("samples")}
          className={[
            "flex-1 py-1.5 text-xs font-medium transition-colors border-b-2",
            activeTab === "samples"
              ? "border-accent-primary text-accent-secondary"
              : "border-transparent text-text-dim hover:text-text-muted",
          ].join(" ")}
        >
          Samples {samples.length > 0 && <span className="ml-1 text-text-dim">{samples.length}</span>}
        </button>
        <button
          onClick={() => setActiveTab("playlists")}
          className={[
            "flex-1 py-1.5 text-xs font-medium transition-colors border-b-2",
            activeTab === "playlists"
              ? "border-accent-primary text-accent-secondary"
              : "border-transparent text-text-dim hover:text-text-muted",
          ].join(" ")}
        >
          Playlists {playlists.length > 0 && <span className="ml-1 text-text-dim">{playlists.length}</span>}
        </button>
      </div>

      {/* ── Playlist-Tab ─────────────────────────────────────────────────────── */}
      {activeTab === "playlists" && (
        <div className="flex-1 overflow-hidden">
          <PlaylistPanel
            playlists={playlists}
            activePlaylistId={activePlaylistId}
            samples={samples}
            selectedSampleId={selectedSampleId}
            onSelectPlaylist={(id) => { setActivePlaylistId(id); setActiveTab("samples"); }}
            onCreatePlaylist={handleCreatePlaylist}
            onRenamePlaylist={handleRenamePlaylist}
            onDeletePlaylist={handleDeletePlaylist}
            onAddToPlaylist={handleAddToPlaylist}
            onRemoveFromPlaylist={handleRemoveFromPlaylist}
          />
        </div>
      )}

      {/* ── Samples-Tab ──────────────────────────────────────────────────────── */}
      {activeTab === "samples" && (
        <>
          {/* Aktive Playlist-Anzeige */}
          {activePlaylistId && (
            <div className="flex items-center gap-2 px-3 py-1 bg-accent-secondary/10 border-b border-accent-secondary/30">
              <span className="text-[10px] text-accent-secondary">
                ♪ {playlists.find(p => p.id === activePlaylistId)?.name ?? "Playlist"}
              </span>
              <button
                onClick={() => setActivePlaylistId(null)}
                className="ml-auto text-[10px] text-text-dim hover:text-text-muted transition-colors"
              >
                × Alle anzeigen
              </button>
            </div>
          )}

          {/* Suche + Sort */}
          <div className="px-3 py-2 border-b border-border-color/50 flex items-center gap-1.5">
            <input
              type="text"
              placeholder="Samples suchen…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-bg-panel border border-border-color rounded px-2 py-1 text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-primary transition-colors"
            />
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SampleSortMode)}
              className="bg-bg-panel border border-border-color rounded px-1.5 py-1 text-[10px] text-text-muted hover:text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
              title="Samples sortieren"
              data-testid="sample-browser-sort"
            >
              {SAMPLE_SORT_MODES.map((m) => (
                <option key={m} value={m}>{SAMPLE_SORT_LABELS[m]}</option>
              ))}
            </select>
          </div>

          {/* Kategorie-Filter */}
          {samples.length > 0 && (
            <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-border-color/50">
              {CATEGORIES.filter((cat) => cat.id === "all" || (categoryCounts[cat.id] ?? 0) > 0).map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`
                    px-2 py-0.5 text-xs rounded-full border transition-all duration-100
                    ${activeCategory === cat.id
                      ? `${cat.color} border-current opacity-100`
                      : "bg-transparent text-text-dim border-border-color hover:text-text-muted hover:border-border-color"
                    }
                  `}
                >
                  {cat.label}
                  {categoryCounts[cat.id] != null && (
                    <span className="ml-1 opacity-60">
                      {cat.id === "all" ? (activePlaylistId ? categoryCounts.all : samples.length) : categoryCounts[cat.id]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Tag-Filter (v3.54.0: Multi-Select + AND/OR-Mode + Clear-Button) */}
          {(availableTags.length > 0 || hasActiveFilters) && (
            <div className="flex flex-col gap-1 px-3 py-2 border-b border-border-color/50">
              {availableTags.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] text-text-dim">Tags:</span>
                  {availableTags.map((tag) => {
                    const active = activeTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        data-testid={`sample-browser-tag-${tag}`}
                        onClick={() => handleToggleTag(tag)}
                        title={`Tag #${tag} ${active ? "abwählen" : "auswählen"}`}
                        className={[
                          "px-2 py-0.5 text-[10px] rounded-full border transition-all duration-100",
                          active
                            ? "bg-accent-primary/60 text-accent-primary border-accent-primary"
                            : "bg-transparent text-text-dim border-border-color hover:text-text-muted hover:border-border-color",
                        ].join(" ")}
                      >
                        #{tag}
                      </button>
                    );
                  })}
                </div>
              )}
              {/* AND/OR-Toggle + Clear-Button (immer sichtbar wenn Filter aktiv ODER mehr als 1 Tag) */}
              {(activeTags.length > 1 || hasActiveFilters) && (
                <div className="flex items-center gap-2 mt-1">
                  {activeTags.length > 1 && (
                    <>
                      <span className="text-[10px] text-text-dim">Modus:</span>
                      <button
                        data-testid="sample-browser-tag-mode-or"
                        onClick={() => setTagFilterMode("OR")}
                        className={[
                          "px-2 py-0.5 text-[10px] rounded border transition-colors",
                          tagFilterMode === "OR"
                            ? "bg-accent-secondary/40 text-accent-secondary border-accent-secondary"
                            : "bg-transparent text-text-dim border-border-color hover:text-text-muted",
                        ].join(" ")}
                        title="Sample passt, wenn mindestens ein Tag übereinstimmt"
                      >
                        OR
                      </button>
                      <button
                        data-testid="sample-browser-tag-mode-and"
                        onClick={() => setTagFilterMode("AND")}
                        className={[
                          "px-2 py-0.5 text-[10px] rounded border transition-colors",
                          tagFilterMode === "AND"
                            ? "bg-accent-secondary/40 text-accent-secondary border-accent-secondary"
                            : "bg-transparent text-text-dim border-border-color hover:text-text-muted",
                        ].join(" ")}
                        title="Sample passt nur, wenn alle Tags übereinstimmen"
                      >
                        AND
                      </button>
                    </>
                  )}
                  {hasActiveFilters && (
                    <button
                      data-testid="sample-browser-clear-filters"
                      onClick={handleClearFilters}
                      className="ml-auto px-2 py-0.5 text-[10px] rounded border border-accent-danger/60 text-accent-danger hover:bg-accent-danger/20 transition-colors"
                      title="Alle Filter zurücksetzen"
                    >
                      ✕ Filter löschen
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Sample-Liste */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {samples.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center h-full gap-4 px-6"
                data-testid="sample-browser-empty"
              >
                <div className="flex flex-col items-center gap-2">
                  <div className="text-5xl" aria-hidden="true">🎚️</div>
                  <p className="text-sm font-semibold text-text-primary">Noch keine Samples</p>
                  <p className="text-[11px] text-text-muted text-center max-w-[28ch] leading-snug">
                    Drag &amp; Drop hierher, oder importiere via den Buttons:
                  </p>
                </div>
                <div className="flex flex-col gap-1.5 w-full max-w-[200px]">
                  <button
                    type="button"
                    onClick={handleImportFiles}
                    className="px-3 py-1.5 rounded text-xs bg-accent-primary text-bg-base font-semibold hover:bg-accent-primary/80 transition-colors"
                    data-testid="sample-browser-empty-files-btn"
                  >
                    Dateien wählen
                  </button>
                  {electron.isElectron && (
                    <button
                      type="button"
                      onClick={handleImportFolder}
                      className="px-3 py-1.5 rounded text-xs border border-border-color text-text-primary hover:border-accent-primary hover:text-accent-primary transition-colors"
                      data-testid="sample-browser-empty-folder-btn"
                    >
                      Ordner importieren
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleImportZip}
                    className="px-3 py-1.5 rounded text-xs border border-border-color text-text-primary hover:border-accent-primary hover:text-accent-primary transition-colors"
                    data-testid="sample-browser-empty-zip-btn"
                  >
                    ZIP-Pack importieren
                  </button>
                </div>
                <p className="text-[10px] text-text-dim text-center max-w-[28ch] leading-snug">
                  Unterstützte Formate: WAV, MP3, OGG, FLAC, AIFF, M4A
                </p>
              </div>
            ) : filteredSamples.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-text-dim">
                <p className="text-sm">Keine Treffer</p>
                <button
                  onClick={handleClearFilters}
                  className="text-xs text-accent-secondary hover:text-accent-primary transition-colors"
                >
                  Filter zurücksetzen
                </button>
              </div>
            ) : (
              <>
                {/* v3.152: Bulk-Action-Bar (nur sichtbar bei multi-select). */}
                {multiSelectIds.size > 0 && (
                  <div
                    className="flex flex-col gap-1.5 px-3 py-1.5 border-b border-border-color/50 bg-accent-secondary/10"
                    data-testid="sample-browser-bulk-bar"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-accent-secondary">
                        {multiSelectIds.size} Sample{multiSelectIds.size === 1 ? "" : "s"} ausgewählt
                        {bulkDurationInfo && bulkDurationInfo.knownCount > 0 && (
                          <span
                            className="ml-2 font-normal text-text-muted"
                            data-testid="sample-browser-bulk-duration"
                          >
                            · {bulkDurationInfo.unknownCount > 0 ? "~" : ""}
                            {formatBulkDuration(bulkDurationInfo.totalSec)} total
                            {bulkDurationInfo.unknownCount > 0 &&
                              ` (${bulkDurationInfo.unknownCount} unbekannt)`}
                          </span>
                        )}
                      </span>
                      <select
                        value=""
                        onChange={(e) => {
                          if (e.target.value) {
                            handleBulkCategory(e.target.value);
                            e.target.value = "";
                          }
                        }}
                        disabled={!onUpdateSampleCategory}
                        data-testid="sample-browser-bulk-category"
                        className="ml-auto bg-bg-panel border border-border-color rounded px-1.5 py-0.5 text-[10px] text-text-primary hover:border-accent-primary focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Kategorie für alle ausgewählten Samples setzen"
                      >
                        <option value="">Kategorie…</option>
                        {CATEGORIES.filter((c) => c.id !== "all").map((c) => (
                          <option key={c.id} value={c.id}>{c.label}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => {
                          setBulkTagInputVisible((v) => !v);
                          setBulkTagDraft("");
                        }}
                        disabled={!onAddTagToSample}
                        data-testid="sample-browser-bulk-tag"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-primary hover:text-accent-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Tag zu allen ausgewählten Samples hinzufügen"
                      >
                        + Tag
                      </button>
                      <select
                        value={bulkNormalizeMode}
                        onChange={(e) => setBulkNormalizeMode(e.target.value as BatchNormalizeMode)}
                        disabled={!onTransformSample}
                        data-testid="sample-browser-bulk-normalize-mode"
                        className="bg-bg-panel border border-border-color rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:border-accent-primary focus:outline-none disabled:opacity-50 transition-colors"
                        title="Normalize-Modus"
                      >
                        <option value="uniform-peak">Uniform Peak</option>
                        <option value="match-loudest">Match Loudest</option>
                        <option value="relative-mix">Relative Mix</option>
                      </select>
                      <button
                        onClick={handleBulkNormalize}
                        disabled={!onTransformSample}
                        data-testid="sample-browser-bulk-normalize"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-primary hover:text-accent-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Alle ausgewählten Samples normalisieren (Mode aus Select)"
                      >
                        Normalize
                      </button>
                      <button
                        onClick={handleAutoDistribute}
                        data-testid="sample-browser-bulk-distribute"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-secondary hover:text-accent-secondary transition-colors"
                        title="Distribute-Plan zeigen (auf 16 Drum-Parts mappen via Name/Tag-Matching)"
                      >
                        Distribute
                      </button>
                      <button
                        onClick={handleBulkBrightness}
                        data-testid="sample-browser-bulk-brightness"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-secondary hover:text-accent-secondary transition-colors"
                        title="Brightness-Verteilung analysieren (FFT-basiert)"
                      >
                        Brightness
                      </button>
                      <button
                        onClick={handleBulkOnsets}
                        data-testid="sample-browser-bulk-onsets"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-secondary hover:text-accent-secondary transition-colors"
                        title="Onset/Transient-Count pro Sample"
                      >
                        Onsets
                      </button>
                      <button
                        onClick={handleBulkLufs}
                        data-testid="sample-browser-bulk-lufs"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-secondary hover:text-accent-secondary transition-colors"
                        title="LUFS-Loudness analysieren (BS.1770 simplified)"
                      >
                        LUFS
                      </button>
                      <button
                        onClick={handleBulkWidth}
                        data-testid="sample-browser-bulk-width"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-secondary hover:text-accent-secondary transition-colors"
                        title="Stereo-Width-Verteilung (M/S)"
                      >
                        Width
                      </button>
                      <select
                        value={bulkReverbPresetId}
                        onChange={(e) => setBulkReverbPresetId(e.target.value)}
                        data-testid="sample-browser-bulk-reverb-preset"
                        className="bg-bg-panel border border-border-color rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:border-accent-primary focus:outline-none transition-colors"
                        title="Reverb-Preset"
                      >
                        {REVERB_PRESETS.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={handleBulkReverb}
                        disabled={!onTransformSample}
                        data-testid="sample-browser-bulk-reverb"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-secondary hover:text-accent-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Reverb auf alle ausgewählten Samples"
                      >
                        Reverb
                      </button>
                      <select
                        value={bulkGatePresetId}
                        onChange={(e) => setBulkGatePresetId(e.target.value)}
                        data-testid="sample-browser-bulk-gate-preset"
                        className="bg-bg-panel border border-border-color rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:border-accent-primary focus:outline-none transition-colors"
                        title="Noise-Gate-Preset"
                      >
                        {NOISE_GATE_PRESETS.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={handleBulkNoiseGate}
                        disabled={!onTransformSample}
                        data-testid="sample-browser-bulk-gate"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-secondary hover:text-accent-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Noise-Gate auf alle ausgewählten Samples"
                      >
                        Gate
                      </button>
                      <button
                        onClick={handleBulkAutoTune}
                        data-testid="sample-browser-bulk-autotune"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-secondary hover:text-accent-secondary transition-colors"
                        title="Pitch-Detect + Scale-Snap Analyse"
                      >
                        AutoTune
                      </button>
                      <select
                        value={bulkCompPresetId}
                        onChange={(e) => setBulkCompPresetId(e.target.value)}
                        data-testid="sample-browser-bulk-comp-preset"
                        className="bg-bg-panel border border-border-color rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:border-accent-primary focus:outline-none transition-colors"
                        title="Compressor-Preset"
                      >
                        {COMPRESSOR_PRESETS.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={handleBulkCompressor}
                        disabled={!onTransformSample}
                        data-testid="sample-browser-bulk-comp"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-secondary hover:text-accent-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Compressor auf alle ausgewählten Samples"
                      >
                        Comp
                      </button>
                      <select
                        value={bulkDelayPresetId}
                        onChange={(e) => setBulkDelayPresetId(e.target.value)}
                        data-testid="sample-browser-bulk-delay-preset"
                        className="bg-bg-panel border border-border-color rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:border-accent-primary focus:outline-none transition-colors"
                        title="Delay-Preset"
                      >
                        {DELAY_PRESETS.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={handleBulkDelay}
                        disabled={!onTransformSample}
                        data-testid="sample-browser-bulk-delay"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-secondary hover:text-accent-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Delay auf alle ausgewählten Samples"
                      >
                        Delay
                      </button>
                      <select
                        value={bulkSidechainPresetId}
                        onChange={(e) => setBulkSidechainPresetId(e.target.value)}
                        data-testid="sample-browser-bulk-sidechain-preset"
                        className="bg-bg-panel border border-border-color rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:border-accent-primary focus:outline-none transition-colors"
                        title="Sidechain-Preset (4-on-the-floor Trigger)"
                      >
                        {SIDECHAIN_PRESETS.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={handleBulkSidechain}
                        disabled={!onTransformSample}
                        data-testid="sample-browser-bulk-sidechain"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-secondary hover:text-accent-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Sidechain-Pump (4-on-the-floor) auf alle ausgewählten Samples"
                      >
                        Pump
                      </button>
                      <input
                        type="range"
                        min={-12}
                        max={12}
                        step={1}
                        value={bulkPitchSemitones}
                        onChange={(e) => setBulkPitchSemitones(parseInt(e.target.value, 10))}
                        data-testid="sample-browser-bulk-pitch-slider"
                        className="w-20 accent-accent-secondary"
                        title="Pitch ±12 semitones"
                      />
                      <span className="text-[10px] font-mono text-text-muted w-8 text-center">
                        {bulkPitchSemitones > 0 ? "+" : ""}{bulkPitchSemitones}st
                      </span>
                      <button
                        onClick={handleBulkPitchShift}
                        disabled={!onTransformSample || bulkPitchSemitones === 0}
                        data-testid="sample-browser-bulk-pitch"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-secondary hover:text-accent-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Pitch-Shift auf alle ausgewählten Samples"
                      >
                        Pitch
                      </button>
                      <select
                        value={bulkSatPresetId}
                        onChange={(e) => setBulkSatPresetId(e.target.value)}
                        data-testid="sample-browser-bulk-sat-preset"
                        className="bg-bg-panel border border-border-color rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:border-accent-primary focus:outline-none transition-colors"
                        title="Saturator-Preset"
                      >
                        {SATURATOR_PRESETS.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      <button
                        onClick={handleBulkSaturator}
                        disabled={!onTransformSample}
                        data-testid="sample-browser-bulk-sat"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-secondary hover:text-accent-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Saturator (analog warmth) auf alle ausgewählten Samples"
                      >
                        Sat
                      </button>
                      <input
                        type="range"
                        min={0}
                        max={2}
                        step={0.1}
                        value={bulkWidth}
                        onChange={(e) => setBulkWidth(parseFloat(e.target.value))}
                        data-testid="sample-browser-bulk-width-slider"
                        className="w-20 accent-accent-secondary"
                        title="Stereo-Width 0=mono 1=identity 2=extreme"
                      />
                      <span className="text-[10px] font-mono text-text-muted w-8 text-center">
                        {bulkWidth.toFixed(1)}
                      </span>
                      <button
                        onClick={handleBulkStereo}
                        disabled={!onTransformSample || bulkWidth === 1}
                        data-testid="sample-browser-bulk-stereo"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-secondary hover:text-accent-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Stereo-Width (M/S Enhancer) auf alle ausgewählten Samples"
                      >
                        Stereo
                      </button>
                      <input
                        type="range"
                        min={500}
                        max={10000}
                        step={500}
                        value={bulkLowPassCutoff}
                        onChange={(e) => setBulkLowPassCutoff(parseInt(e.target.value, 10))}
                        data-testid="sample-browser-bulk-lowpass-slider"
                        className="w-20 accent-accent-secondary"
                        title="Low-Pass Cutoff 500..10000 Hz"
                      />
                      <span className="text-[10px] font-mono text-text-muted w-12 text-center">
                        {bulkLowPassCutoff}Hz
                      </span>
                      <button
                        onClick={handleBulkLowPass}
                        disabled={!onTransformSample}
                        data-testid="sample-browser-bulk-lowpass"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-secondary hover:text-accent-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Low-Pass Filter auf alle ausgewählten Samples"
                      >
                        LP
                      </button>
                      <input
                        type="range"
                        min={50}
                        max={800}
                        step={10}
                        value={bulkHighPassCutoff}
                        onChange={(e) => setBulkHighPassCutoff(parseInt(e.target.value, 10))}
                        data-testid="sample-browser-bulk-highpass-slider"
                        className="w-20 accent-accent-secondary"
                        title="High-Pass Cutoff 50..800 Hz"
                      />
                      <span className="text-[10px] font-mono text-text-muted w-12 text-center">
                        {bulkHighPassCutoff}Hz
                      </span>
                      <button
                        onClick={handleBulkHighPass}
                        disabled={!onTransformSample}
                        data-testid="sample-browser-bulk-highpass"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-secondary hover:text-accent-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="High-Pass Filter auf alle ausgewählten Samples"
                      >
                        HP
                      </button>
                      <input
                        type="range"
                        min={100}
                        max={10000}
                        step={100}
                        value={bulkBandPassCenter}
                        onChange={(e) => setBulkBandPassCenter(parseInt(e.target.value, 10))}
                        data-testid="sample-browser-bulk-bandpass-center"
                        className="w-20 accent-accent-secondary"
                        title="Band-Pass Center 100..10000 Hz"
                      />
                      <span className="text-[10px] font-mono text-text-muted w-12 text-center">
                        {bulkBandPassCenter}Hz
                      </span>
                      <input
                        type="range"
                        min={100}
                        max={5000}
                        step={100}
                        value={bulkBandPassWidth}
                        onChange={(e) => setBulkBandPassWidth(parseInt(e.target.value, 10))}
                        data-testid="sample-browser-bulk-bandpass-width"
                        className="w-20 accent-accent-secondary"
                        title="Band-Pass Width 100..5000 Hz"
                      />
                      <span className="text-[10px] font-mono text-text-muted w-12 text-center">
                        ±{bulkBandPassWidth}Hz
                      </span>
                      <button
                        onClick={handleBulkBandPass}
                        disabled={!onTransformSample}
                        data-testid="sample-browser-bulk-bandpass"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-secondary hover:text-accent-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Band-Pass Filter (HP+LP Cascade) auf alle ausgewählten Samples"
                      >
                        BP
                      </button>
                      <input
                        type="range"
                        min={100}
                        max={5000}
                        step={100}
                        value={bulkAllPassCenter}
                        onChange={(e) => setBulkAllPassCenter(parseInt(e.target.value, 10))}
                        data-testid="sample-browser-bulk-allpass-center"
                        className="w-20 accent-accent-secondary"
                        title="All-Pass Center 100..5000 Hz"
                      />
                      <span className="text-[10px] font-mono text-text-muted w-12 text-center">
                        {bulkAllPassCenter}Hz
                      </span>
                      <input
                        type="range"
                        min={1}
                        max={8}
                        step={1}
                        value={bulkAllPassStages}
                        onChange={(e) => setBulkAllPassStages(parseInt(e.target.value, 10))}
                        data-testid="sample-browser-bulk-allpass-stages"
                        className="w-20 accent-accent-secondary"
                        title="All-Pass Stages 1..8"
                      />
                      <span className="text-[10px] font-mono text-text-muted w-12 text-center">
                        ×{bulkAllPassStages}
                      </span>
                      <button
                        onClick={handleBulkAllPass}
                        disabled={!onTransformSample}
                        data-testid="sample-browser-bulk-allpass"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-secondary hover:text-accent-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="All-Pass Filter (Phaser-Like) auf alle ausgewählten Samples"
                      >
                        AP
                      </button>
                      <input
                        type="range"
                        min={0.25}
                        max={4}
                        step={0.05}
                        value={bulkSpeedRatio}
                        onChange={(e) => setBulkSpeedRatio(parseFloat(e.target.value))}
                        data-testid="sample-browser-bulk-speed-slider"
                        className="w-20 accent-accent-secondary"
                        title="Speed-Ratio 0.25..4x (1 = identity, >1 schneller+höher, <1 langsamer+tiefer)"
                      />
                      <span className="text-[10px] font-mono text-text-muted w-14 text-center">
                        {bulkSpeedRatio.toFixed(2)}x
                      </span>
                      <button
                        onClick={handleBulkSpeed}
                        disabled={!onTransformSample || bulkSpeedRatio === 1}
                        data-testid="sample-browser-bulk-speed"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-secondary hover:text-accent-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Speed (Resample, Pitch ändert sich mit) auf alle ausgewählten Samples"
                      >
                        SPD
                      </button>
                      <input
                        type="range"
                        min={1}
                        max={16}
                        step={1}
                        value={bulkSrFactor}
                        onChange={(e) => setBulkSrFactor(parseInt(e.target.value, 10))}
                        data-testid="sample-browser-bulk-srreduce-factor"
                        className="w-20 accent-accent-secondary"
                        title="SampleRate-Reduce Factor 1..16 (1 = identity, 4 = lofi, 8 = crunch, 16 = destroy)"
                      />
                      <span className="text-[10px] font-mono text-text-muted w-10 text-center">
                        ÷{bulkSrFactor}
                      </span>
                      <input
                        type="range"
                        min={2}
                        max={16}
                        step={1}
                        value={bulkSrBitDepth}
                        onChange={(e) => setBulkSrBitDepth(parseInt(e.target.value, 10))}
                        data-testid="sample-browser-bulk-srreduce-bitdepth"
                        className="w-20 accent-accent-secondary"
                        title="BitDepth 2..16 (16 = aus / kein Quantize, 12 = lofi, 8 = crunch, 4 = destroy)"
                      />
                      <span className="text-[10px] font-mono text-text-muted w-12 text-center">
                        {bulkSrBitDepth}b
                      </span>
                      <button
                        onClick={handleBulkSrReduce}
                        disabled={!onTransformSample || (bulkSrFactor === 1 && bulkSrBitDepth === 16)}
                        data-testid="sample-browser-bulk-srreduce"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-secondary hover:text-accent-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="LoFi / Bitcrush (Sample-and-Hold + Bit-Depth-Quantize) auf alle ausgewählten Samples"
                      >
                        LoFi
                      </button>
                      <input
                        type="range"
                        min={0.1}
                        max={10}
                        step={0.1}
                        value={bulkChorusRate}
                        onChange={(e) => setBulkChorusRate(parseFloat(e.target.value))}
                        data-testid="sample-browser-bulk-chorus-rate"
                        className="w-20 accent-accent-secondary"
                        title="Chorus LFO-Rate 0.1..10 Hz (1 = classic, 0.5 = subtle, 3 = shimmer)"
                      />
                      <span className="text-[10px] font-mono text-text-muted w-12 text-center">
                        {bulkChorusRate.toFixed(1)}Hz
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={bulkChorusMix}
                        onChange={(e) => setBulkChorusMix(parseFloat(e.target.value))}
                        data-testid="sample-browser-bulk-chorus-mix"
                        className="w-20 accent-accent-secondary"
                        title="Chorus Wet/Dry-Mix 0..1 (0 = aus, 0.5 = classic, 0.7 = lush)"
                      />
                      <span className="text-[10px] font-mono text-text-muted w-10 text-center">
                        {bulkChorusMix.toFixed(2)}
                      </span>
                      <button
                        onClick={handleBulkChorus}
                        disabled={!onTransformSample || bulkChorusMix === 0}
                        data-testid="sample-browser-bulk-chorus"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-secondary hover:text-accent-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Chorus (single-voice, modulierte Delay-Line) auf alle ausgewählten Samples"
                      >
                        CHO
                      </button>
                      <input
                        type="range"
                        min={0.05}
                        max={5}
                        step={0.05}
                        value={bulkFlangerRate}
                        onChange={(e) => setBulkFlangerRate(parseFloat(e.target.value))}
                        data-testid="sample-browser-bulk-flanger-rate"
                        className="w-20 accent-accent-secondary"
                        title="Flanger LFO-Rate 0.05..5 Hz (0.5 = classic, 0.3 = subtle, 1.0 = jet, 0.2 = metallic)"
                      />
                      <span className="text-[10px] font-mono text-text-muted w-12 text-center">
                        {bulkFlangerRate.toFixed(2)}Hz
                      </span>
                      <input
                        type="range"
                        min={-0.95}
                        max={0.95}
                        step={0.05}
                        value={bulkFlangerFeedback}
                        onChange={(e) => setBulkFlangerFeedback(parseFloat(e.target.value))}
                        data-testid="sample-browser-bulk-flanger-feedback"
                        className="w-20 accent-accent-secondary"
                        title="Flanger Feedback -0.95..+0.95 (0.5 = classic, 0.7 = jet, 0.85 = metallic; negative = invertierte Resonanz)"
                      />
                      <span className="text-[10px] font-mono text-text-muted w-10 text-center">
                        {bulkFlangerFeedback.toFixed(2)}
                      </span>
                      <button
                        onClick={handleBulkFlanger}
                        disabled={!onTransformSample}
                        data-testid="sample-browser-bulk-flanger"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-secondary hover:text-accent-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Flanger (modulierte Delay-Line + Feedback-Loop) auf alle ausgewählten Samples"
                      >
                        FLG
                      </button>
                      <input
                        type="range"
                        min={0.1}
                        max={20}
                        step={0.1}
                        value={bulkTremoloRate}
                        onChange={(e) => setBulkTremoloRate(parseFloat(e.target.value))}
                        data-testid="sample-browser-bulk-tremolo-rate"
                        className="w-20 accent-accent-secondary"
                        title="Tremolo LFO-Rate 0.1..20 Hz (5 = classic, 3 = subtle, 8 = pulse, 6 = vintage)"
                      />
                      <span className="text-[10px] font-mono text-text-muted w-12 text-center">
                        {bulkTremoloRate.toFixed(1)}Hz
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={bulkTremoloDepth}
                        onChange={(e) => setBulkTremoloDepth(parseFloat(e.target.value))}
                        data-testid="sample-browser-bulk-tremolo-depth"
                        className="w-20 accent-accent-secondary"
                        title="Tremolo Depth 0..1 (0 = aus, 0.3 = subtle, 0.5 = classic, 0.8 = pulse)"
                      />
                      <span className="text-[10px] font-mono text-text-muted w-10 text-center">
                        {bulkTremoloDepth.toFixed(2)}
                      </span>
                      <button
                        onClick={handleBulkTremolo}
                        disabled={!onTransformSample || bulkTremoloDepth === 0}
                        data-testid="sample-browser-bulk-tremolo"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-secondary hover:text-accent-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Tremolo (Amplitude-Modulation via LFO) auf alle ausgewählten Samples"
                      >
                        TRM
                      </button>
                      <input
                        type="range"
                        min={0.1}
                        max={20}
                        step={0.1}
                        value={bulkVibratoRate}
                        onChange={(e) => setBulkVibratoRate(parseFloat(e.target.value))}
                        data-testid="sample-browser-bulk-vibrato-rate"
                        className="w-20 accent-accent-secondary"
                        title="Vibrato LFO-Rate 0.1..20 Hz (5 = classic, 4 = subtle, 6 = expressive, 8 = warble)"
                      />
                      <span className="text-[10px] font-mono text-text-muted w-12 text-center">
                        {bulkVibratoRate.toFixed(1)}Hz
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={bulkVibratoDepth}
                        onChange={(e) => setBulkVibratoDepth(parseFloat(e.target.value))}
                        data-testid="sample-browser-bulk-vibrato-depth"
                        className="w-20 accent-accent-secondary"
                        title="Vibrato Depth 0..100 cents (0 = aus, 10 = subtle, 20 = classic, 35 = expressive, 60 = warble)"
                      />
                      <span className="text-[10px] font-mono text-text-muted w-10 text-center">
                        {bulkVibratoDepth.toFixed(0)}c
                      </span>
                      <button
                        onClick={handleBulkVibrato}
                        disabled={!onTransformSample || bulkVibratoDepth === 0}
                        data-testid="sample-browser-bulk-vibrato"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-secondary hover:text-accent-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Vibrato (Pitch-Modulation via LFO) auf alle ausgewählten Samples"
                      >
                        VIB
                      </button>
                      <input
                        type="range"
                        min={0.05}
                        max={10}
                        step={0.05}
                        value={bulkAutoPanRate}
                        onChange={(e) => setBulkAutoPanRate(parseFloat(e.target.value))}
                        data-testid="sample-browser-bulk-autopan-rate"
                        className="w-20 accent-accent-secondary"
                        title="AutoPan LFO-Rate 0.05..10 Hz (0.5 = classic, 0.2 = subtle, 2 = fast)"
                      />
                      <span className="text-[10px] font-mono text-text-muted w-12 text-center">
                        {bulkAutoPanRate.toFixed(2)}Hz
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={bulkAutoPanDepth}
                        onChange={(e) => setBulkAutoPanDepth(parseFloat(e.target.value))}
                        data-testid="sample-browser-bulk-autopan-depth"
                        className="w-20 accent-accent-secondary"
                        title="AutoPan Depth 0..1 (0 = center, 0.4 = subtle, 0.7 = classic, 1 = full L-R)"
                      />
                      <span className="text-[10px] font-mono text-text-muted w-10 text-center">
                        {bulkAutoPanDepth.toFixed(2)}
                      </span>
                      <button
                        onClick={handleBulkAutoPan}
                        disabled={!onTransformSample}
                        data-testid="sample-browser-bulk-autopan"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-secondary hover:text-accent-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="AutoPan (Stereo-Pan-Modulation via LFO) auf alle ausgewählten Samples"
                      >
                        PAN
                      </button>
                      <input
                        type="range"
                        min={5}
                        max={500}
                        step={5}
                        value={bulkStutterSlice}
                        onChange={(e) => setBulkStutterSlice(parseFloat(e.target.value))}
                        data-testid="sample-browser-bulk-stutter-slice"
                        className="w-20 accent-accent-secondary"
                        title="Stutter Slice-Länge 5..500 ms (50 = classic, 30 = short, 20 = glitch, 100 = fade)"
                      />
                      <span className="text-[10px] font-mono text-text-muted w-12 text-center">
                        {bulkStutterSlice}ms
                      </span>
                      <input
                        type="range"
                        min={1}
                        max={32}
                        step={1}
                        value={bulkStutterRepeats}
                        onChange={(e) => setBulkStutterRepeats(parseFloat(e.target.value))}
                        data-testid="sample-browser-bulk-stutter-repeats"
                        className="w-20 accent-accent-secondary"
                        title="Stutter Repeats 1..32 (4 = classic, 8 = short, 16 = glitch, 6 = fade)"
                      />
                      <span className="text-[10px] font-mono text-text-muted w-10 text-center">
                        ×{bulkStutterRepeats}
                      </span>
                      <button
                        onClick={handleBulkStutter}
                        disabled={!onTransformSample}
                        data-testid="sample-browser-bulk-stutter"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-secondary hover:text-accent-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Stutter-Buffer (Slice-Repeat) auf alle ausgewählten Samples — Output-Länge = sliceMs × repeats"
                      >
                        STR
                      </button>
                      <input
                        type="range"
                        min={0}
                        max={2000}
                        step={10}
                        value={bulkAdsrAttack}
                        onChange={(e) => setBulkAdsrAttack(parseFloat(e.target.value))}
                        data-testid="sample-browser-bulk-adsr-attack"
                        className="w-20 accent-accent-secondary"
                        title="ADSR Attack 0..2000 ms (10 = stab, 100 = soft, 500 = pad, 2000 = drone)"
                      />
                      <span className="text-[10px] font-mono text-text-muted w-12 text-center">
                        A{bulkAdsrAttack}ms
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={5000}
                        step={50}
                        value={bulkAdsrRelease}
                        onChange={(e) => setBulkAdsrRelease(parseFloat(e.target.value))}
                        data-testid="sample-browser-bulk-adsr-release"
                        className="w-20 accent-accent-secondary"
                        title="ADSR Release 0..5000 ms (200 = default, 1000 = pad, 2000 = drone)"
                      />
                      <span className="text-[10px] font-mono text-text-muted w-12 text-center">
                        R{bulkAdsrRelease}ms
                      </span>
                      <button
                        onClick={handleBulkAdsr}
                        disabled={!onTransformSample}
                        data-testid="sample-browser-bulk-adsr"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-primary hover:border-accent-secondary hover:text-accent-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="ADSR Gain-Envelope (Attack + Release) auf alle ausgewählten Samples"
                      >
                        ADSR
                      </button>
                      <button
                        onClick={handleBulkDelete}
                        disabled={!onRemoveSample}
                        data-testid="sample-browser-bulk-delete"
                        className="px-2 py-0.5 rounded text-[10px] bg-accent-danger text-white hover:bg-accent-danger/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Alle ausgewählten Samples aus dem Projekt entfernen"
                      >
                        Löschen
                      </button>
                      <button
                        onClick={() => setMultiSelectIds(invertSelection(filteredSamples.map((s) => s.id), multiSelectIds))}
                        data-testid="sample-browser-bulk-invert"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-muted hover:text-text-primary transition-colors"
                        title="Auswahl invertieren (von gefilterten Samples)"
                      >
                        Invertieren
                      </button>
                      <button
                        onClick={() => setMultiSelectIds(clearSelection())}
                        data-testid="sample-browser-bulk-clear"
                        className="px-2 py-0.5 rounded text-[10px] border border-border-color text-text-muted hover:text-text-primary transition-colors"
                        title="Auswahl aufheben"
                      >
                        Aufheben
                      </button>
                    </div>
                    {/* v3.153: Bulk-Tag-Input (inline) */}
                    {bulkTagInputVisible && (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          autoFocus
                          value={bulkTagDraft}
                          onChange={(e) => setBulkTagDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleBulkAddTag();
                            if (e.key === "Escape") { setBulkTagInputVisible(false); setBulkTagDraft(""); }
                          }}
                          placeholder="Tag eingeben + Enter…"
                          className="flex-1 bg-bg-panel border border-border-color rounded px-2 py-0.5 text-[11px] text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-primary"
                          data-testid="sample-browser-bulk-tag-input"
                        />
                        <button
                          onClick={handleBulkAddTag}
                          disabled={bulkTagDraft.trim().length === 0}
                          className="px-2 py-0.5 rounded text-[10px] bg-accent-primary text-bg-base font-semibold hover:bg-accent-primary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          data-testid="sample-browser-bulk-tag-apply"
                        >
                          Hinzufügen
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Navigation-Leiste */}
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-color/50 bg-bg-panel/50">
                  <button
                    onClick={handleNavigatePrev}
                    title="Vorheriges Sample (Pfeil hoch)"
                    className="w-6 h-6 rounded bg-bg-elevated text-text-muted hover:bg-bg-elevated hover:text-text-primary transition-colors text-xs"
                  >▲</button>
                  <button
                    onClick={handleNavigateNext}
                    title="Nächstes Sample (Pfeil runter)"
                    className="w-6 h-6 rounded bg-bg-elevated text-text-muted hover:bg-bg-elevated hover:text-text-primary transition-colors text-xs"
                  >▼</button>
                  {selectedIndex >= 0 && (
                    <span className="text-[10px] text-text-dim">
                      {selectedIndex + 1} / {filteredSamples.length}
                    </span>
                  )}
                  <button
                    onClick={() => setMultiSelectIds(selectAll(filteredSamples.map((s) => s.id)))}
                    className="text-[10px] text-text-dim hover:text-accent-secondary transition-colors px-1"
                    title="Alle gefilterten Samples auswählen (Multi-Select)"
                    data-testid="sample-browser-select-all"
                  >
                    Alle
                  </button>
                  <span className="text-[10px] text-text-dim ml-auto" title="Tastatur-Shortcuts">
                    ↑↓ · Space · Enter · ⌘A · Esc · Del
                  </span>
                </div>

                <ul
                  className="divide-y divide-border-color/50"
                  onDragLeave={(e) => {
                    // Cursor hat die gesamte Liste verlassen
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setDragOverSampleId(null);
                    }
                  }}
                >
                  {filteredSamples.map((sample) => {
                    const isSelected = sample.id === selectedSampleId;
                    const isThisPlaying = isSelected && isPreviewPlaying;
                    const isDragTarget = dragOverSampleId === sample.id;
                    return (
                      <li
                        key={sample.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, sample)}
                        onDragOver={(e) => handleDragOverSample(e, sample.id)}
                        onDrop={(e) => handleDropOnSample(e, sample.id)}
                        onDragLeave={handleDragLeaveSample}
                        onClick={(e) => handleSelectSample(sample, e)}
                        onDoubleClick={() => handleDoubleClickSample(sample)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setCategoryMenu({
                            x: e.clientX,
                            y: e.clientY,
                            sampleId: sample.id,
                            currentCategory: sample.category,
                          });
                        }}
                        className={[
                          "flex items-center gap-2 px-3 py-1.5 group cursor-pointer",
                          isDragTarget ? "border-t-2 border-accent-secondary bg-accent-primary/10" : "border-t border-border-color/50",
                          multiSelectIds.has(sample.id)
                            ? "bg-accent-secondary/15 border-l-2 border-accent-secondary"
                            : isSelected
                              ? "bg-accent-primary/20 border-l-2 border-accent-primary"
                              : "hover:bg-bg-elevated/30 border-l-2 border-transparent",
                        ].join(" ")}
                        title={onAssignToChannel ? "Doppelklick: auf aktiven Kanal | Ctrl/Cmd+Klick: Multi-Select | Shift+Klick: Range-Select" : "Klick: auswählen | Ctrl/Cmd+Klick: Multi-Select"}
                      >
                        {/* Kategorie-Badge (Rechtsklick zum Ändern) */}
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 cursor-context-menu ${getCategoryColor(sample.category)}`}
                          title={`Kategorie: ${sample.category} (Rechtsklick zum Ändern)`}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setCategoryMenu({
                              x: e.clientX,
                              y: e.clientY,
                              sampleId: sample.id,
                              currentCategory: sample.category,
                            });
                          }}
                        >
                          {sample.category.slice(0, 3).toUpperCase()}
                        </span>

                        {/* Name + v3.55.0 Tag-Chips/Editor */}
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs truncate ${isSelected ? "text-accent-primary" : "text-text-primary"}`}>
                            {sample.name}
                          </p>
                          {/* v3.55.0: Tag-Chips + Add-Tag-Input. Nur sichtbar wenn Tags
                             vorhanden ODER User gerade den Editor geöffnet hat ODER
                             Sample selektiert ist (für sauberen ersten "+"-Click). */}
                          {(getSampleTags(sample).length > 0 || tagEditorOpenFor === sample.id || isSelected) && (
                            <div
                              className="flex flex-wrap items-center gap-1 mt-0.5"
                              data-testid={`sample-tags-${sample.id}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {getSampleTags(sample).map((tag) => (
                                <span
                                  key={tag}
                                  data-testid={`sample-tag-chip-${sample.id}-${tag}`}
                                  className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full text-[9px] bg-accent-secondary/30 text-accent-secondary border border-accent-secondary/40"
                                  title={`Tag #${tag}`}
                                >
                                  #{tag}
                                  {onRemoveTagFromSample && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRemoveTag(sample.id, tag);
                                      }}
                                      data-testid={`sample-tag-remove-${sample.id}-${tag}`}
                                      title="Tag entfernen"
                                      className="ml-0.5 w-3 h-3 inline-flex items-center justify-center rounded-full text-text-dim hover:text-accent-danger hover:bg-accent-danger/20 transition-colors leading-none"
                                    >
                                      ×
                                    </button>
                                  )}
                                </span>
                              ))}
                              {/* Add-Tag-Trigger / Inline-Input */}
                              {onAddTagToSample && (
                                tagEditorOpenFor === sample.id ? (
                                  <span className="inline-flex items-center gap-1">
                                    <input
                                      type="text"
                                      autoFocus
                                      value={tagDraft}
                                      onChange={(e) => setTagDraft(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          handleCommitTagDraft(sample.id);
                                        } else if (e.key === "Escape") {
                                          e.preventDefault();
                                          setTagEditorOpenFor(null);
                                          setTagDraft("");
                                        }
                                      }}
                                      onBlur={() => handleCommitTagDraft(sample.id)}
                                      placeholder="tag…"
                                      data-testid={`sample-tag-input-${sample.id}`}
                                      list={`sample-tag-suggest-${sample.id}`}
                                      className="px-1 py-0 text-[10px] rounded bg-bg-elevated border border-border-color text-text-primary w-20 focus:border-accent-primary outline-none"
                                    />
                                    <datalist id={`sample-tag-suggest-${sample.id}`}>
                                      {tagSuggestions.map((t) => (
                                        <option key={t} value={t} />
                                      ))}
                                    </datalist>
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenTagEditor(sample.id);
                                    }}
                                    data-testid={`sample-tag-add-${sample.id}`}
                                    title="Tag hinzufügen"
                                    className="px-1 py-0 text-[9px] rounded-full border border-dashed border-border-color text-text-dim hover:text-accent-primary hover:border-accent-primary transition-colors"
                                  >
                                    + Tag
                                  </button>
                                )
                              )}
                            </div>
                          )}
                        </div>

                        {/* Größe */}
                        {sample.size && (
                          <span className="text-[10px] text-text-dim flex-shrink-0">
                            {formatBytes(sample.size)}
                          </span>
                        )}

                        {/* Waveform-Indikator */}
                        {analysisCache[sample.id] && !isSelected && (
                          <span className="text-[8px] text-text-dim flex-shrink-0">≋</span>
                        )}

                        {/* Auf Kanal legen (nur wenn Callback vorhanden) */}
                        {onAssignToChannel && isSelected && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onAssignToChannel(sample.path, sample.name);
                            }}
                            title={`Auf Kanal "${activeChannelName ?? "aktiv"}" legen`}
                            className="flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] bg-accent-primary/70 text-bg-base hover:bg-accent-primary transition-colors font-medium"
                          >
                            →
                          </button>
                        )}

                        {/* Preview-Button */}
                        <button
                          onClick={(e) => { e.stopPropagation(); handlePreviewToggle(sample); }}
                          title={isThisPlaying ? "Preview stoppen (Leertaste)" : "Preview abspielen (Leertaste)"}
                          className={[
                            "w-6 h-6 rounded flex items-center justify-center text-[10px] transition-all duration-100",
                            isThisPlaying
                              ? "bg-accent-primary text-bg-base opacity-100"
                              : "opacity-0 group-hover:opacity-100 bg-bg-elevated text-text-muted hover:bg-bg-elevated hover:text-text-primary",
                          ].join(" ")}
                        >
                          {isThisPlaying ? "■" : "▶"}
                        </button>

                        {/* Entfernen-Button */}
                        {onRemoveSample && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onRemoveSample(sample.id); }}
                            title="Sample entfernen"
                            className="opacity-0 group-hover:opacity-100 text-text-dim hover:text-accent-danger transition-all duration-100 text-xs px-1"
                          >
                            ✕
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </>
      )}

      {/* ── Waveform-Panel (wenn Sample selektiert) ──────────────────────────── */}
      {selectedSample && activeTab === "samples" && (
        <WaveformPanel
          sample={selectedSample}
          isPlaying={isPreviewPlaying}
          playbackPosition={playbackPosition}
          onSeek={handleSeek}
          onPlayToggle={() => handlePreviewToggle()}
          onAssignToChannel={onAssignToChannel ? () => onAssignToChannel(selectedSample.path, selectedSample.name) : undefined}
          activeChannelName={activeChannelName}
          analysisResult={analysisCache[selectedSample.id] ?? null}
          isAnalyzing={analyzingId === selectedSample.id}
          onTransform={onTransformSample ? () => handleOpenTransform(selectedSample) : undefined}
        />
      )}

      {/* v3.116.0: Sample-Transform-Dialog */}
      <SampleTransformDialog
        sample={transformSample}
        buffer={transformBuffer}
        onClose={handleTransformClose}
        onApply={handleTransformApply}
        onAutoSlice={onAutoSliceSample}
      />

      {/* ── Status-Leiste ─────────────────────────────────────────────────────── */}
      <div className="px-3 py-1 bg-bg-panel border-t border-border-color flex items-center gap-2">
        <p className="text-[10px] text-text-dim flex-1">
          {samples.length === 0
            ? "Keine Samples"
            : filteredSamples.length < samples.length
            ? `${filteredSamples.length} von ${samples.length} Samples`
            : `${samples.length} Sample${samples.length !== 1 ? "s" : ""}`}
          {/* v3.164: Total-Duration der GEFILTERTEN Samples — orthogonal zur
              Bulk-Bar-Duration (Multi-Select, v3.163). Nur sichtbar wenn
              mindestens ein Sample eine bekannte/estimate-bare Duration hat. */}
          {filteredDurationInfo.knownCount > 0 && (
            <span
              className="ml-2 text-text-muted"
              data-testid="sample-browser-status-duration"
            >
              · {filteredDurationInfo.unknownCount > 0 ? "~" : ""}
              {formatBulkDuration(filteredDurationInfo.totalSec)} total
            </span>
          )}
          {electron.isElectron && (
            <span className="ml-2 text-accent-primary">• Electron</span>
          )}
        </p>
        {playlists.length > 0 && (
          <button
            onClick={() => setActiveTab("playlists")}
            className="text-[10px] text-accent-secondary hover:text-accent-primary transition-colors"
          >
            {playlists.length} Playlist{playlists.length !== 1 ? "s" : ""}
          </button>
        )}
      </div>

      {/* ── Versteckte Browser-Fallback-Inputs ──────────────────────────────── */}
      {!electron.isElectron && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept={AUDIO_EXTENSIONS.join(",")}
            multiple
            className="hidden"
            onChange={handleFileInputChange}
            aria-hidden="true"
          />
          <input
            ref={folderInputRef}
            type="file"
            // @ts-expect-error webkitdirectory ist kein Standard-HTML-Attribut
            webkitdirectory=""
            multiple
            className="hidden"
            onChange={handleFolderInputChange}
            aria-hidden="true"
          />
          <input
            ref={zipInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={handleZipInputChange}
            aria-hidden="true"
          />
        </>
      )}
    </div>
  );
}

export default SampleBrowser;
