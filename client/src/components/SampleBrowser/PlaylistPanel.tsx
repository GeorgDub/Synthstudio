// ─── Playlist-Panel ───────────────────────────────────────────────────────────
// v3.280 (TASK-265): aus SampleBrowser.tsx extrahiert (verbatim Move,
// verhaltensneutral). Props-only + interner useState-State, keine Modul-Helfer.
// Die Playlist-Typdefinition zieht mit hierher (kein anderer Importeur) — so
// importiert SampleBrowser einseitig von hier, kein Zirkel.

import { useState } from "react";
import type { Sample } from "../../store/useProjectStore";

export interface Playlist {
  id: string;
  name: string;
  sampleIds: string[];
  createdAt: number;
}

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

export function PlaylistPanel({
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
