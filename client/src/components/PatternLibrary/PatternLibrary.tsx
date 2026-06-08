/**
 * Synthstudio – PatternLibrary
 *
 * Lokale Pattern-Bibliothek: Patterns speichern, suchen, laden, exportieren.
 * Wird als Panel im Tools-Tab oder als Modal geöffnet.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  usePatternLibraryStore,
  savePatternToLibrary,
  deleteLibraryEntry,
  updateLibraryEntry,
  searchLibrary,
  exportLibrary,
  importLibrary,
  type PatternLibraryEntry,
} from "@/store/usePatternLibraryStore";
import { AudioEngine, type PatternData } from "@/audio/AudioEngine";
import {
  computePatternPreviewHits,
  previewDurationMs,
} from "@/utils/patternPreview";

const GENRES = ["Techno", "House", "Hip-Hop", "Trap", "DnB", "Reggaeton", "Ambient", "Experimental", "Unbekannt"];
const STARS = [1, 2, 3, 4, 5];

interface PatternLibraryProps {
  currentPattern: PatternData | undefined;
  globalBpm: number;
  onLoadPattern: (pattern: PatternData) => void;
}

function StarRating({ rating, onChange }: { rating: number; onChange?: (r: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {STARS.map(s => (
        <button key={s} onClick={() => onChange?.(s === rating ? 0 : s)}
          className={`text-xs transition-colors ${s <= rating ? "text-accent-primary" : "text-text-dim"} ${onChange ? "hover:text-accent-primary cursor-pointer" : "cursor-default"}`}
          disabled={!onChange}>
          ★
        </button>
      ))}
    </div>
  );
}

function EntryCard({ entry, isPreviewing, onLoad, onDelete, onRate, onPreview, onRename }: {
  entry: PatternLibraryEntry;
  isPreviewing: boolean;
  onLoad: () => void;
  onDelete: () => void;
  onRate: (r: number) => void;
  onPreview: () => void;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) { setDraft(entry.name); inputRef.current?.focus(); inputRef.current?.select(); }
  }, [editing, entry.name]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== entry.name) onRename(next);
    setEditing(false);
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded border border-border-color bg-bg-elevated hover:border-accent-primary/40 transition-colors group">
      <button onClick={onPreview} title={isPreviewing ? "Vorschau stoppen" : "Pattern anhören"}
        data-testid={`pattern-preview-${entry.id}`}
        className={`text-sm flex-shrink-0 transition-colors ${isPreviewing ? "text-accent-success" : "text-text-dim hover:text-accent-primary"}`}>
        {isPreviewing ? "■" : "▶"}
      </button>
      <div className="flex-1 min-w-0">
        {editing ? (
          <input ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
            data-testid={`pattern-rename-input-${entry.id}`}
            className="w-full text-xs font-medium bg-bg-base border border-accent-primary rounded px-1 py-0.5 text-text-primary outline-none" />
        ) : (
          <div className="text-xs font-medium text-text-primary truncate" onDoubleClick={() => setEditing(true)} title="Doppelklick zum Umbenennen">
            {entry.name}
          </div>
        )}
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-text-dim">{entry.genre}</span>
          <span className="text-[10px] text-text-dim">·</span>
          <span className="text-[10px] font-mono text-accent-secondary">{entry.bpm} BPM</span>
          <span className="text-[10px] text-text-dim">{entry.stepCount} Steps</span>
          {entry.tags.length > 0 && <span className="text-[10px] text-text-dim truncate">{entry.tags.join(", ")}</span>}
        </div>
      </div>
      <StarRating rating={entry.rating} onChange={onRate} />
      <button onClick={() => setEditing(true)} title="Umbenennen"
        data-testid={`pattern-rename-${entry.id}`}
        className="text-text-dim hover:text-accent-primary text-xs opacity-0 group-hover:opacity-100 transition-colors flex-shrink-0">
        ✎
      </button>
      <button onClick={onLoad}
        className="px-2 py-0.5 text-[10px] rounded bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0">
        Laden
      </button>
      <button onClick={onDelete}
        className="text-text-dim hover:text-accent-danger text-sm opacity-0 group-hover:opacity-100 transition-colors flex-shrink-0">
        ✕
      </button>
    </div>
  );
}

export function PatternLibrary({ currentPattern, globalBpm, onLoadPattern }: PatternLibraryProps) {
  const { entries } = usePatternLibraryStore();
  const [query, setQuery] = useState("");
  const [filterGenre, setFilterGenre] = useState("");
  const [saveName, setSaveName] = useState("");
  const [saveGenre, setSaveGenre] = useState("Unbekannt");
  const [saveTags, setSaveTags] = useState("");
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const previewTimers = useRef<number[]>([]);

  const filtered = searchLibrary(query, filterGenre || undefined);

  const stopPreview = useCallback(() => {
    previewTimers.current.forEach(id => clearTimeout(id));
    previewTimers.current = [];
    setPreviewingId(null);
  }, []);

  // Vorschau via previewSample — stört den laufenden Transport NICHT.
  const handlePreview = useCallback((entry: PatternLibraryEntry) => {
    const wasPreviewing = previewingId === entry.id;
    stopPreview();
    if (wasPreviewing) return; // Toggle: zweiter Klick stoppt.
    let pattern: PatternData;
    try { pattern = JSON.parse(entry.patternJson); } catch { return; }
    const opts = { bpm: entry.bpm || globalBpm };
    const hits = computePatternPreviewHits(pattern, opts);
    if (hits.length === 0) {
      alert("Dieses Pattern hat keine Sample-Spuren zum Vorhören.");
      return;
    }
    setPreviewingId(entry.id);
    for (const hit of hits) {
      const t = window.setTimeout(() => {
        void AudioEngine.previewSample(hit.sampleUrl, hit.volume);
      }, hit.timeMs);
      previewTimers.current.push(t);
    }
    const end = window.setTimeout(stopPreview, previewDurationMs(pattern, opts) + 250);
    previewTimers.current.push(end);
  }, [previewingId, globalBpm, stopPreview]);

  // Beim Unmount alle laufenden Vorschau-Timer abräumen.
  useEffect(() => () => stopPreview(), [stopPreview]);

  const handleSave = useCallback(() => {
    if (!currentPattern) return;
    const name = saveName.trim() || currentPattern.name;
    savePatternToLibrary({ ...currentPattern, bpm: currentPattern.bpm ?? globalBpm }, {
      name, genre: saveGenre, tags: saveTags.split(",").map(t => t.trim()).filter(Boolean),
    });
    setSaveName(""); setSaveTags(""); setShowSaveForm(false);
  }, [currentPattern, saveName, saveGenre, saveTags, globalBpm]);

  const handleLoad = useCallback((entry: PatternLibraryEntry) => {
    try {
      const pattern: PatternData = JSON.parse(entry.patternJson);
      onLoadPattern(pattern);
    } catch { alert("Pattern konnte nicht geladen werden."); }
  }, [onLoadPattern]);

  const handleExport = () => {
    const json = exportLibrary();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "synthstudio-library.json"; a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then(json => { importLibrary(json, true); }).catch(() => alert("Import fehlgeschlagen."));
    e.target.value = "";
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-color bg-bg-panel flex-shrink-0 flex-wrap">
        <span className="text-xs font-bold text-text-dim uppercase tracking-widest">Pattern Library</span>
        <span className="text-[10px] text-text-dim">{entries.length} Patterns</span>
        <div className="flex-1" />
        <button onClick={() => setShowSaveForm(p => !p)} disabled={!currentPattern}
          className="px-2 py-1 text-[10px] rounded bg-accent-primary text-white hover:opacity-80 disabled:opacity-40 font-bold transition-opacity">
          + Speichern
        </button>
        <button onClick={handleExport} className="px-2 py-1 text-[10px] rounded bg-bg-elevated text-text-muted border border-border-color hover:text-text-primary">
          Export
        </button>
        <button onClick={() => importRef.current?.click()} className="px-2 py-1 text-[10px] rounded bg-bg-elevated text-text-muted border border-border-color hover:text-text-primary">
          Import
        </button>
        <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
      </div>

      {/* Save Form */}
      {showSaveForm && (
        <div className="px-3 py-2 border-b border-border-color bg-bg-panel space-y-2 flex-shrink-0">
          <div className="flex gap-2">
            <input value={saveName} onChange={e => setSaveName(e.target.value)}
              placeholder={currentPattern?.name ?? "Pattern-Name"}
              className="flex-1 text-xs bg-bg-elevated border border-border-color rounded px-2 py-1 text-text-primary placeholder:text-text-dim" />
            <select value={saveGenre} onChange={e => setSaveGenre(e.target.value)}
              className="text-xs bg-bg-elevated border border-border-color rounded px-2 py-1 text-text-primary">
              {GENRES.map(g => <option key={g}>{g}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <input value={saveTags} onChange={e => setSaveTags(e.target.value)}
              placeholder="Tags: kick, 130bpm, minimal …"
              className="flex-1 text-xs bg-bg-elevated border border-border-color rounded px-2 py-1 text-text-primary placeholder:text-text-dim" />
            <button onClick={handleSave}
              className="px-3 py-1 text-xs rounded bg-accent-success text-white hover:opacity-80 font-bold">
              Speichern
            </button>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-color flex-shrink-0">
        <input value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Suchen …"
          className="flex-1 text-xs bg-bg-elevated border border-border-color rounded px-2 py-1 text-text-primary placeholder:text-text-dim" />
        <select value={filterGenre} onChange={e => setFilterGenre(e.target.value)}
          className="text-xs bg-bg-elevated border border-border-color rounded px-2 py-1 text-text-muted">
          <option value="">Alle Genres</option>
          {GENRES.map(g => <option key={g}>{g}</option>)}
        </select>
      </div>

      {/* Liste */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {filtered.length === 0 ? (
          <div className="text-xs text-text-dim text-center py-8">
            {entries.length === 0 ? "Noch keine gespeicherten Patterns." : "Keine Ergebnisse."}
          </div>
        ) : filtered.map(entry => (
          <EntryCard key={entry.id} entry={entry}
            isPreviewing={previewingId === entry.id}
            onLoad={() => handleLoad(entry)}
            onDelete={() => { if (previewingId === entry.id) stopPreview(); deleteLibraryEntry(entry.id); }}
            onRate={r => updateLibraryEntry(entry.id, { rating: r })}
            onPreview={() => handlePreview(entry)}
            onRename={name => updateLibraryEntry(entry.id, { name })}
          />
        ))}
      </div>
    </div>
  );
}
