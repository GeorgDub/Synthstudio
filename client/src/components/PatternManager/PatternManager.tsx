/**
 * PatternManager.tsx — Pattern-Manager-Tab (nach "Mixer").
 *
 * Phase 1 (MVP): Browse-by-INHALT (Suche nach Kanal-/Sample-Name, nicht nur
 * Nummer) + Sortierung (Dichte/Kanäle/Name) + Select/Delete/Rename/Duplicate +
 * Step-Vorschau. Phase 2 (Gruppen/Playlist) folgt separat.
 *
 * Liest/schreibt direkt über useDrumMachineStore — kein Prop-Drilling.
 */
import { useMemo, useState, useCallback } from "react";
import { useDrumMachineStore } from "@/store/useDrumMachineStore";
import { toast } from "@/store/useToastStore";
import {
  patternMatchesQuery,
  sortPatternsBy,
  countActiveSteps,
  countActiveChannels,
  collectPatternLabels,
  type PatternSortKey,
} from "@/utils/patternManager";

const SORT_LABELS: Record<PatternSortKey, string> = {
  original: "Reihenfolge",
  density: "Dichte (vollste zuerst)",
  channels: "Kanäle",
  name: "Name",
};

/** Kompakte Step-Vorschau: ein Mini-Grid der aktiven Steps des ersten Kanals mit Inhalt. */
function StepPreview({ steps }: { steps: { active: boolean }[] }) {
  return (
    <div className="flex gap-px" aria-hidden>
      {steps.slice(0, 64).map((s, i) => (
        <span
          key={i}
          className={`w-1 h-3 rounded-[1px] ${s.active ? "bg-accent-primary" : "bg-bg-base"}`}
        />
      ))}
    </div>
  );
}

export function PatternManager() {
  const dm = useDrumMachineStore();
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<PatternSortKey>("original");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const visible = useMemo(() => {
    const filtered = dm.patterns.filter(p => patternMatchesQuery(p, query));
    return sortPatternsBy(filtered, sortKey);
  }, [dm.patterns, query, sortKey]);

  const startRename = useCallback((id: string, name: string) => {
    setEditingId(id);
    setEditName(name);
  }, []);
  const commitRename = useCallback(() => {
    if (editingId && editName.trim()) dm.renamePattern(editingId, editName.trim());
    setEditingId(null);
  }, [editingId, editName, dm]);

  const handleDelete = useCallback((id: string, name: string) => {
    if (dm.patterns.length <= 1) {
      toast("Das letzte Pattern kann nicht gelöscht werden", { kind: "warning" });
      return;
    }
    if (dm.playbackPatternId === id) {
      toast("Das aktuell spielende Pattern kann nicht gelöscht werden", { kind: "warning" });
      return;
    }
    dm.removePattern(id);
    toast(`Pattern „${name}" gelöscht`, { kind: "info", duration: 2500 });
  }, [dm]);

  return (
    <div className="flex flex-col h-full bg-bg-base text-text-primary">
      {/* Kopfzeile: Suche + Sortierung */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-color bg-bg-panel flex-wrap">
        <h2 className="text-sm font-bold mr-2">Pattern-Manager</h2>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Suche nach Name oder Sample/Kanal (z.B. SNARE, Kick)…"
          className="flex-1 min-w-[200px] bg-bg-elevated border border-border-color rounded px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-primary"
          data-testid="pattern-manager-search"
        />
        <select
          value={sortKey}
          onChange={e => setSortKey(e.target.value as PatternSortKey)}
          className="bg-bg-elevated border border-border-color rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary"
          data-testid="pattern-manager-sort"
        >
          {(Object.keys(SORT_LABELS) as PatternSortKey[]).map(k => (
            <option key={k} value={k}>{SORT_LABELS[k]}</option>
          ))}
        </select>
        <span className="text-[11px] text-text-muted whitespace-nowrap">
          {visible.length}/{dm.patterns.length} Pattern(s)
        </span>
      </div>

      {/* Liste */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1" data-testid="pattern-manager-list">
        {visible.length === 0 ? (
          <div className="text-center text-text-dim text-xs py-12">
            Keine Patterns passen zur Suche „{query}".
          </div>
        ) : (
          visible.map(p => {
            const isActive = p.id === dm.activePatternId;
            const isPlaying = p.id === dm.playbackPatternId;
            const notes = countActiveSteps(p);
            const channels = countActiveChannels(p);
            const labels = collectPatternLabels(p).slice(1, 7); // ohne Pattern-Name selbst
            const firstWithContent = p.parts.find(pt => pt.steps.some(s => s.active)) ?? p.parts[0];
            return (
              <div
                key={p.id}
                onClick={() => dm.setActivePattern(p.id)}
                className={`group rounded border px-3 py-2 cursor-pointer transition-colors ${
                  isActive
                    ? "border-accent-primary bg-bg-elevated"
                    : "border-border-color bg-bg-panel hover:bg-bg-elevated"
                }`}
                data-testid={`pattern-manager-row-${p.id}`}
              >
                <div className="flex items-center gap-2">
                  {isPlaying && <span className="text-accent-danger text-[10px]" title="Spielt gerade">▶</span>}
                  {editingId === p.id ? (
                    <input
                      autoFocus
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditingId(null); }}
                      onClick={e => e.stopPropagation()}
                      className="flex-1 bg-bg-base border border-accent-primary rounded px-1.5 py-0.5 text-xs text-text-primary focus:outline-none"
                      data-testid="pattern-manager-rename-input"
                    />
                  ) : (
                    <span className="flex-1 text-xs font-medium truncate">{p.name}</span>
                  )}
                  <span className="text-[10px] text-text-dim whitespace-nowrap">
                    {channels} Kan · {notes} Steps · {p.stepCount ?? "?"}st
                  </span>
                  {/* Aktionen */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={e => { e.stopPropagation(); startRename(p.id, p.name); }}
                      title="Umbenennen"
                      className="px-1 text-text-dim hover:text-accent-primary text-[11px]"
                      data-testid={`pattern-manager-rename-${p.id}`}
                    >✎</button>
                    <button
                      onClick={e => { e.stopPropagation(); dm.duplicatePattern(p.id); toast(`„${p.name}" dupliziert`, { kind: "info", duration: 2000 }); }}
                      title="Duplizieren"
                      className="px-1 text-text-dim hover:text-accent-secondary text-[11px]"
                      data-testid={`pattern-manager-duplicate-${p.id}`}
                    >⧉</button>
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(p.id, p.name); }}
                      title="Löschen"
                      className="px-1 text-text-dim hover:text-accent-danger text-[11px]"
                      data-testid={`pattern-manager-delete-${p.id}`}
                    >🗑</button>
                  </div>
                </div>
                {/* Inhalt-Vorschau + Sample-Labels */}
                <div className="flex items-center gap-2 mt-1.5">
                  {firstWithContent && <StepPreview steps={firstWithContent.steps} />}
                  {labels.length > 0 && (
                    <span className="text-[10px] text-text-muted truncate">{labels.join(" · ")}</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Fußzeile: Hinweis auf Phase 2 */}
      <div className="px-4 py-2 border-t border-border-color bg-bg-panel text-[10px] text-text-dim">
        Tipp: Suche nach Sample-/Kanal-Namen, um Patterns nach Inhalt zu finden — unabhängig von der Nummer. Gruppen/Playlist folgen.
      </div>
    </div>
  );
}
