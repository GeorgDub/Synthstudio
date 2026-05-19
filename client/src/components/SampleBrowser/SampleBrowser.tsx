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
  const handleSelectSample = useCallback((sample: Sample) => {
    setSelectedSampleId(sample.id);
    if (audioPreviewRef.current) {
      audioPreviewRef.current.pause();
      audioPreviewRef.current = null;
      setIsPreviewPlaying(false);
      setPlaybackPosition(0);
    }
  }, []);

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
  }, [handleNavigatePrev, handleNavigateNext, handlePreviewToggle, selectedSampleId, selectedSample, onAssignToChannel]);

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
              <div className="flex flex-col items-center justify-center h-full gap-3 text-text-dim">
                <div className="text-4xl">🎚️</div>
                <p className="text-sm">Keine Samples geladen</p>
                <p className="text-xs text-text-dim text-center px-4">
                  {electron.isElectron
                    ? "Dateien hierher ziehen oder über '+ Dateien', '+ Ordner' oder '+ ZIP' importieren"
                    : "Über '+ Dateien', '+ ZIP' importieren oder per Drag & Drop"}
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
                  <span className="text-[10px] text-text-dim ml-auto">
                    ↑↓ · Leertaste · Enter=Kanal
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
                        onClick={() => handleSelectSample(sample)}
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
                          isSelected
                            ? "bg-accent-primary/20 border-l-2 border-accent-primary"
                            : "hover:bg-bg-elevated/30 border-l-2 border-transparent",
                        ].join(" ")}
                        title={onAssignToChannel ? "Doppelklick: auf aktiven Kanal legen | Ziehen: auf Kanal-Zeile oder zum Umsortieren" : "Klick: auswählen | Ziehen: umsortieren oder auf Kanal"}
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
