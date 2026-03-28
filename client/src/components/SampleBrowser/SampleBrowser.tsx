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
}

// ─── Konstanten ───────────────────────────────────────────────────────────────

const AUDIO_EXTENSIONS = [".wav", ".mp3", ".ogg", ".flac", ".aiff", ".aif", ".m4a"];

/** Alle verfügbaren Kategorien mit Labels und Farben */
const CATEGORIES: Array<{ id: string; label: string; color: string; emoji: string }> = [
  { id: "all",        label: "Alle",        color: "bg-slate-700 text-slate-200",         emoji: "◈" },
  { id: "kicks",      label: "Kicks",       color: "bg-red-900/60 text-red-300",           emoji: "🥁" },
  { id: "snares",     label: "Snares",      color: "bg-orange-900/60 text-orange-300",     emoji: "🪘" },
  { id: "hihats",     label: "Hi-Hats",     color: "bg-yellow-900/60 text-yellow-300",     emoji: "🎩" },
  { id: "claps",      label: "Claps",       color: "bg-green-900/60 text-green-300",       emoji: "👏" },
  { id: "toms",       label: "Toms",        color: "bg-teal-900/60 text-teal-300",         emoji: "🔵" },
  { id: "percussion", label: "Perc",        color: "bg-cyan-900/60 text-cyan-300",         emoji: "🎵" },
  { id: "fx",         label: "FX",          color: "bg-blue-900/60 text-blue-300",         emoji: "⚡" },
  { id: "loops",      label: "Loops",       color: "bg-indigo-900/60 text-indigo-300",     emoji: "🔁" },
  { id: "vocals",     label: "Vocals",      color: "bg-purple-900/60 text-purple-300",     emoji: "🎤" },
  { id: "other",      label: "Sonstige",    color: "bg-slate-800/60 text-slate-400",       emoji: "📁" },
  { id: "imported",   label: "Importiert",  color: "bg-slate-800/60 text-slate-400",       emoji: "📥" },
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
  return CATEGORIES.find((c) => c.id === categoryId)?.color ?? "bg-slate-800/60 text-slate-400";
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
    <div className="absolute inset-0 bg-[#0d0d0d]/95 flex flex-col items-center justify-center gap-3 z-10 rounded-lg">
      <p className="text-sm font-semibold text-cyan-400">{phaseLabel}</p>
      {total > 0 && (
        <>
          <div className="w-48 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-cyan-500 rounded-full transition-all duration-200"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <p className="text-xs text-slate-500">
            {current} / {total} ({percentage}%)
          </p>
        </>
      )}
      {currentFile && (
        <p className="text-xs text-slate-600 truncate max-w-[180px]" title={currentFile}>
          {currentFile}
        </p>
      )}
      {onCancel && (
        <button
          onClick={onCancel}
          className="mt-1 px-3 py-1 text-xs rounded bg-red-900/40 text-red-400 border border-red-800 hover:bg-red-800/60 transition-colors"
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
}: WaveformPanelProps) {
  const waveformColor = getWaveformColor(sample.category);

  return (
    <div className="border-t border-slate-800 bg-[#0a0a0a] flex flex-col">
      {/* Sample-Name + Zuweisung */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800/50">
        <span className="text-xs text-cyan-300 font-medium truncate flex-1" title={sample.name}>
          {sample.name}
        </span>
        <div className="flex items-center gap-1 ml-2 flex-shrink-0">
          {onAssignToChannel && (
            <button
              onClick={onAssignToChannel}
              title={activeChannelName ? `Auf Kanal "${activeChannelName}" legen` : "Auf aktiven Kanal legen (Doppelklick)"}
              className="px-2 py-0.5 rounded text-[10px] bg-cyan-700 text-white hover:bg-cyan-600 transition-colors font-medium"
            >
              → {activeChannelName ? activeChannelName.slice(0, 8) : "Kanal"}
            </button>
          )}
          <button
            onClick={onPlayToggle}
            className={[
              "w-7 h-7 rounded flex items-center justify-center text-xs transition-all duration-100 flex-shrink-0",
              isPlaying
                ? "bg-orange-600 text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white",
            ].join(" ")}
            title={isPlaying ? "Preview stoppen (Leertaste)" : "Preview abspielen (Leertaste)"}
          >
            {isPlaying ? "■" : "▶"}
          </button>
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
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-3 pb-2 text-[10px] text-slate-600">
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
          <span title="Geschätztes BPM" className="text-cyan-900">
            ♩ {analysisResult.estimatedBpm} BPM
          </span>
        )}
        {sample.size != null && (
          <span title="Dateigröße">{formatBytes(sample.size)}</span>
        )}
        {isAnalyzing && (
          <span className="text-cyan-900 animate-pulse">Analysiere…</span>
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
      className="fixed z-50 bg-[#111] border border-slate-700 rounded-lg shadow-2xl py-1 min-w-[160px]"
      style={{ left: Math.min(x, window.innerWidth - 180), top: Math.min(y, window.innerHeight - 300) }}
    >
      <div className="px-3 py-1 text-[10px] text-slate-500 border-b border-slate-800 mb-1">
        Kategorie ändern
      </div>
      {CATEGORIES.filter(c => c.id !== "all").map(cat => (
        <button
          key={cat.id}
          onClick={() => { onSelect(cat.id); onClose(); }}
          className={[
            "w-full text-left px-3 py-1 text-xs transition-colors flex items-center gap-2",
            cat.id === currentCategory
              ? "text-cyan-400 bg-cyan-900/20"
              : "text-slate-300 hover:bg-slate-800",
          ].join(" ")}
        >
          <span className={`text-[9px] px-1 py-0.5 rounded-full ${cat.color}`}>
            {cat.id.slice(0, 3).toUpperCase()}
          </span>
          {cat.label}
          {cat.id === currentCategory && <span className="ml-auto text-cyan-500">✓</span>}
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
      <div className="flex gap-1 px-3 py-2 border-b border-slate-800">
        <input
          type="text"
          placeholder="Neue Playlist…"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") handleCreate(); }}
          className="flex-1 bg-[#0d0d0d] border border-slate-800 rounded px-2 py-1 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-cyan-800"
        />
        <button
          onClick={handleCreate}
          className="px-2 py-1 text-xs rounded bg-cyan-900/40 text-cyan-400 border border-cyan-800 hover:bg-cyan-800/60 transition-colors"
        >
          +
        </button>
      </div>

      {/* Alle Samples (kein Filter) */}
      <button
        onClick={() => onSelectPlaylist(null)}
        className={[
          "flex items-center gap-2 px-3 py-1.5 text-xs transition-colors border-b border-slate-800/50",
          activePlaylistId === null
            ? "text-cyan-400 bg-cyan-900/20"
            : "text-slate-400 hover:bg-slate-800/30",
        ].join(" ")}
      >
        <span className="text-slate-600">◈</span>
        <span className="flex-1 text-left">Alle Samples</span>
        <span className="text-[10px] text-slate-600">{samples.length}</span>
      </button>

      {/* Playlist-Liste */}
      <div className="flex-1 overflow-y-auto">
        {playlists.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 text-slate-700 text-xs gap-1">
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
                  "group flex items-center gap-1 px-3 py-1.5 border-b border-slate-800/30 transition-colors",
                  isActive ? "bg-cyan-900/20" : "hover:bg-slate-800/20",
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
                    className="flex-1 bg-slate-800 border border-cyan-700 rounded px-1.5 py-0.5 text-xs text-slate-200 focus:outline-none"
                  />
                ) : (
                  <button
                    onClick={() => onSelectPlaylist(pl.id)}
                    onDoubleClick={() => { setEditingId(pl.id); setEditName(pl.name); }}
                    className={[
                      "flex-1 text-left text-xs truncate",
                      isActive ? "text-cyan-300" : "text-slate-300",
                    ].join(" ")}
                    title={`${pl.name} – Doppelklick zum Umbenennen`}
                  >
                    ♪ {pl.name}
                  </button>
                )}

                <span className="text-[10px] text-slate-600 flex-shrink-0">{count}</span>

                {/* Sample zur Playlist hinzufügen */}
                {selectedSampleId && !pl.sampleIds.includes(selectedSampleId) && (
                  <button
                    onClick={() => onAddToPlaylist(pl.id, selectedSampleId)}
                    title="Ausgewähltes Sample hinzufügen"
                    className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded text-[10px] bg-cyan-900/40 text-cyan-500 hover:bg-cyan-800/60 transition-all"
                  >
                    +
                  </button>
                )}
                {selectedSampleId && pl.sampleIds.includes(selectedSampleId) && (
                  <button
                    onClick={() => onRemoveFromPlaylist(pl.id, selectedSampleId)}
                    title="Ausgewähltes Sample entfernen"
                    className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded text-[10px] bg-red-900/40 text-red-500 hover:bg-red-800/60 transition-all"
                  >
                    −
                  </button>
                )}

                {/* Playlist löschen */}
                <button
                  onClick={() => onDeletePlaylist(pl.id)}
                  title="Playlist löschen"
                  className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded text-[10px] text-slate-600 hover:text-red-400 transition-all"
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
  const [activeTag, setActiveTag] = useState<string>("");

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
  const filteredSamples = useMemo(() => {
    let base = samples;

    // Playlist-Filter
    if (activePlaylistId) {
      const playlist = playlists.find(p => p.id === activePlaylistId);
      if (playlist) {
        base = samples.filter(s => playlist.sampleIds.includes(s.id));
      }
    }

    return base.filter((sample) => {
      const matchesCategory = activeCategory === "all" || sample.category === activeCategory;
      const matchesSearch = searchQuery === "" ||
        sample.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesTag = activeTag === "" ||
        (sample.tags?.includes(activeTag) ?? false) ||
        (analysisCache[sample.id]?.tags?.includes(activeTag) ?? false);
      return matchesCategory && matchesSearch && matchesTag;
    });
  }, [samples, activeCategory, searchQuery, activeTag, activePlaylistId, playlists, analysisCache]);

  // ── Verfügbare Tags aller Samples (aus Import + Analyse-Cache) ─────────────
  const availableTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const sample of samples) {
      sample.tags?.forEach(t => tagSet.add(t));
      analysisCache[sample.id]?.tags?.forEach(t => tagSet.add(t));
    }
    return Array.from(tagSet).sort();
  }, [samples, analysisCache]);

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

        if (!electron.isElectron && selectedSample.path) {
          try {
            const response = await fetch(selectedSample.path);
            audioData = await response.arrayBuffer();
          } catch {
            // Fetch fehlgeschlagen
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
    <div className="relative flex flex-col h-full bg-[#111] border border-slate-800 rounded-lg overflow-hidden">

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
      <div className="flex items-center justify-between px-3 py-2 bg-[#0d0d0d] border-b border-slate-800">
        <h2 className="text-xs font-semibold text-slate-300 tracking-wide uppercase">
          Sample-Browser
        </h2>
        <div className="flex gap-1">
          <button
            onClick={handleImportFiles}
            title="Audio-Dateien importieren"
            className="px-2 py-1 text-xs rounded bg-cyan-900/40 text-cyan-400 border border-cyan-800 hover:bg-cyan-800/60 hover:text-cyan-300 transition-colors"
          >
            + Dateien
          </button>
          <button
            onClick={handleImportFolder}
            title="Ordner mit Samples importieren"
            className="px-2 py-1 text-xs rounded bg-slate-800/60 text-slate-400 border border-slate-700 hover:bg-slate-700/60 hover:text-slate-300 transition-colors"
          >
            + Ordner
          </button>
          <button
            onClick={handleImportZip}
            title="ZIP-Archiv mit Samples importieren"
            className="px-2 py-1 text-xs rounded bg-slate-800/60 text-slate-400 border border-slate-700 hover:bg-slate-700/60 hover:text-slate-300 transition-colors"
          >
            + ZIP
          </button>
        </div>
      </div>

      {/* ── Aktiver Kanal Hinweis ────────────────────────────────────────────── */}
      {onAssignToChannel && activeChannelName && (
        <div className="flex items-center gap-2 px-3 py-1 bg-cyan-900/10 border-b border-cyan-900/30">
          <span className="text-[10px] text-cyan-700">Aktiver Kanal:</span>
          <span className="text-[10px] text-cyan-400 font-medium">{activeChannelName}</span>
          <span className="text-[10px] text-slate-700 ml-auto">Doppelklick oder Enter zum Zuweisen</span>
        </div>
      )}

      {/* ── Tabs: Samples / Playlists ────────────────────────────────────────── */}
      <div className="flex border-b border-slate-800 bg-[#0d0d0d]">
        <button
          onClick={() => setActiveTab("samples")}
          className={[
            "flex-1 py-1.5 text-xs font-medium transition-colors border-b-2",
            activeTab === "samples"
              ? "border-cyan-500 text-cyan-400"
              : "border-transparent text-slate-600 hover:text-slate-400",
          ].join(" ")}
        >
          Samples {samples.length > 0 && <span className="ml-1 text-slate-600">{samples.length}</span>}
        </button>
        <button
          onClick={() => setActiveTab("playlists")}
          className={[
            "flex-1 py-1.5 text-xs font-medium transition-colors border-b-2",
            activeTab === "playlists"
              ? "border-cyan-500 text-cyan-400"
              : "border-transparent text-slate-600 hover:text-slate-400",
          ].join(" ")}
        >
          Playlists {playlists.length > 0 && <span className="ml-1 text-slate-600">{playlists.length}</span>}
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
            <div className="flex items-center gap-2 px-3 py-1 bg-indigo-900/10 border-b border-indigo-900/30">
              <span className="text-[10px] text-indigo-400">
                ♪ {playlists.find(p => p.id === activePlaylistId)?.name ?? "Playlist"}
              </span>
              <button
                onClick={() => setActivePlaylistId(null)}
                className="ml-auto text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
              >
                × Alle anzeigen
              </button>
            </div>
          )}

          {/* Suche */}
          <div className="px-3 py-2 border-b border-slate-800/50">
            <input
              type="text"
              placeholder="Samples suchen…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#0d0d0d] border border-slate-800 rounded px-2 py-1 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-cyan-800 transition-colors"
            />
          </div>

          {/* Kategorie-Filter */}
          {samples.length > 0 && (
            <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-slate-800/50">
              {CATEGORIES.filter((cat) => cat.id === "all" || (categoryCounts[cat.id] ?? 0) > 0).map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`
                    px-2 py-0.5 text-xs rounded-full border transition-all duration-100
                    ${activeCategory === cat.id
                      ? `${cat.color} border-current opacity-100`
                      : "bg-transparent text-slate-600 border-slate-800 hover:text-slate-400 hover:border-slate-700"
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

          {/* Tag-Filter */}
          {availableTags.length > 0 && (
            <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-slate-800/50">
              {availableTags.map(tag => (
                <button
                  key={tag}
                  onClick={() => setActiveTag(activeTag === tag ? "" : tag)}
                  title={`Nach Tag #${tag} filtern`}
                  className={[
                    "px-2 py-0.5 text-[10px] rounded-full border transition-all duration-100",
                    activeTag === tag
                      ? "bg-cyan-900/60 text-cyan-300 border-cyan-700"
                      : "bg-transparent text-slate-600 border-slate-800 hover:text-slate-400 hover:border-slate-700",
                  ].join(" ")}
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}

          {/* Sample-Liste */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {samples.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-600">
                <div className="text-4xl">🎚️</div>
                <p className="text-sm">Keine Samples geladen</p>
                <p className="text-xs text-slate-700 text-center px-4">
                  {electron.isElectron
                    ? "Dateien hierher ziehen oder über '+ Dateien', '+ Ordner' oder '+ ZIP' importieren"
                    : "Über '+ Dateien', '+ ZIP' importieren oder per Drag & Drop"}
                </p>
              </div>
            ) : filteredSamples.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-600">
                <p className="text-sm">Keine Treffer</p>
                <button
                  onClick={() => { setActiveCategory("all"); setSearchQuery(""); setActivePlaylistId(null); setActiveTag(""); }}
                  className="text-xs text-cyan-700 hover:text-cyan-500 transition-colors"
                >
                  Filter zurücksetzen
                </button>
              </div>
            ) : (
              <>
                {/* Navigation-Leiste */}
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-800/50 bg-[#0d0d0d]/50">
                  <button
                    onClick={handleNavigatePrev}
                    title="Vorheriges Sample (Pfeil hoch)"
                    className="w-6 h-6 rounded bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white transition-colors text-xs"
                  >▲</button>
                  <button
                    onClick={handleNavigateNext}
                    title="Nächstes Sample (Pfeil runter)"
                    className="w-6 h-6 rounded bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white transition-colors text-xs"
                  >▼</button>
                  {selectedIndex >= 0 && (
                    <span className="text-[10px] text-slate-600">
                      {selectedIndex + 1} / {filteredSamples.length}
                    </span>
                  )}
                  <span className="text-[10px] text-slate-700 ml-auto">
                    ↑↓ · Leertaste · Enter=Kanal
                  </span>
                </div>

                <ul
                  className="divide-y divide-slate-800/50"
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
                          isDragTarget ? "border-t-2 border-cyan-400 bg-cyan-900/10" : "border-t border-slate-800/50",
                          isSelected
                            ? "bg-cyan-900/20 border-l-2 border-cyan-500"
                            : "hover:bg-slate-800/30 border-l-2 border-transparent",
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

                        {/* Name */}
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs truncate ${isSelected ? "text-cyan-300" : "text-slate-200"}`}>
                            {sample.name}
                          </p>
                        </div>

                        {/* Größe */}
                        {sample.size && (
                          <span className="text-[10px] text-slate-600 flex-shrink-0">
                            {formatBytes(sample.size)}
                          </span>
                        )}

                        {/* Waveform-Indikator */}
                        {analysisCache[sample.id] && !isSelected && (
                          <span className="text-[8px] text-slate-700 flex-shrink-0">≋</span>
                        )}

                        {/* Auf Kanal legen (nur wenn Callback vorhanden) */}
                        {onAssignToChannel && isSelected && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onAssignToChannel(sample.path, sample.name);
                            }}
                            title={`Auf Kanal "${activeChannelName ?? "aktiv"}" legen`}
                            className="flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] bg-cyan-700 text-white hover:bg-cyan-600 transition-colors font-medium"
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
                              ? "bg-cyan-600 text-white opacity-100"
                              : "opacity-0 group-hover:opacity-100 bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-white",
                          ].join(" ")}
                        >
                          {isThisPlaying ? "■" : "▶"}
                        </button>

                        {/* Entfernen-Button */}
                        {onRemoveSample && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onRemoveSample(sample.id); }}
                            title="Sample entfernen"
                            className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all duration-100 text-xs px-1"
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
        />
      )}

      {/* ── Status-Leiste ─────────────────────────────────────────────────────── */}
      <div className="px-3 py-1 bg-[#0d0d0d] border-t border-slate-800 flex items-center gap-2">
        <p className="text-[10px] text-slate-600 flex-1">
          {samples.length === 0
            ? "Keine Samples"
            : filteredSamples.length < samples.length
            ? `${filteredSamples.length} von ${samples.length} Samples`
            : `${samples.length} Sample${samples.length !== 1 ? "s" : ""}`}
          {electron.isElectron && (
            <span className="ml-2 text-cyan-900">• Electron</span>
          )}
        </p>
        {playlists.length > 0 && (
          <button
            onClick={() => setActiveTab("playlists")}
            className="text-[10px] text-indigo-700 hover:text-indigo-500 transition-colors"
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
