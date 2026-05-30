/**
 * PatternManager.tsx — Pattern-Manager-Tab (nach "Mixer").
 *
 * Links: Gruppen/Playlists (eigenes System, NICHT Song-Modus) — Patterns zu
 * benannten, geordneten Gruppen bündeln, umordnen, als Sequenz abspielen.
 * Rechts: Browse-by-INHALT (Suche nach Kanal-/Sample-Name) + Sortierung +
 * Select/Delete/Rename/Duplicate + Step-Vorschau.
 *
 * Bekommt das geteilte dm per Prop (NICHT useDrumMachineStore() selbst aufrufen —
 * das gäbe eine isolierte State-Kopie).
 */
import { useMemo, useState, useCallback } from "react";
import type { DrumMachineState, DrumMachineActions } from "@/store/useDrumMachineStore";
import { toast } from "@/store/useToastStore";
import {
  usePatternGroupStore, addGroup, renameGroup, removeGroup,
  addPatternToGroup, removePatternFromGroup, moveInGroup, purgePattern, setPlayingGroup,
} from "@/store/usePatternGroupStore";
import {
  patternMatchesQuery, sortPatternsBy, countActiveSteps, countActiveChannels,
  collectPatternLabels, type PatternSortKey,
} from "@/utils/patternManager";

const SORT_LABELS: Record<PatternSortKey, string> = {
  original: "Reihenfolge",
  density: "Dichte (vollste zuerst)",
  channels: "Kanäle",
  name: "Name",
};

function StepPreview({ steps }: { steps: { active: boolean }[] }) {
  return (
    <div className="flex gap-px" aria-hidden>
      {steps.slice(0, 64).map((s, i) => (
        <span key={i} className={`w-1 h-3 rounded-[1px] ${s.active ? "bg-accent-primary" : "bg-bg-base"}`} />
      ))}
    </div>
  );
}

interface Props {
  dm: DrumMachineState & DrumMachineActions;
  /** Startet die Gruppen-Sequenz beim ersten Pattern (App verkabelt Transport). */
  onPlayGroup?: (firstPatternId: string, groupId: string) => void;
}

export function PatternManager({ dm, onPlayGroup }: Props) {
  const groupStore = usePatternGroupStore();
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<PatternSortKey>("original");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupNameDraft, setGroupNameDraft] = useState("");

  const patternById = useMemo(() => new Map(dm.patterns.map(p => [p.id, p])), [dm.patterns]);
  const visible = useMemo(() => {
    const filtered = dm.patterns.filter(p => patternMatchesQuery(p, query));
    return sortPatternsBy(filtered, sortKey);
  }, [dm.patterns, query, sortKey]);

  const selectedGroup = groupStore.groups.find(g => g.id === selectedGroupId) ?? null;

  const commitRename = useCallback(() => {
    if (editingId && editName.trim()) dm.renamePattern(editingId, editName.trim());
    setEditingId(null);
  }, [editingId, editName, dm]);

  const handleDelete = useCallback((id: string, name: string) => {
    if (dm.patterns.length <= 1) { toast("Das letzte Pattern kann nicht gelöscht werden", { kind: "warning" }); return; }
    if (dm.playbackPatternId === id) { toast("Das spielende Pattern kann nicht gelöscht werden", { kind: "warning" }); return; }
    dm.removePattern(id);
    purgePattern(id); // aus allen Gruppen entfernen
    toast(`Pattern „${name}" gelöscht`, { kind: "info", duration: 2500 });
  }, [dm]);

  const handleNewGroup = useCallback(() => {
    const id = addGroup(`Gruppe ${groupStore.groups.length + 1}`);
    setSelectedGroupId(id);
    setEditingGroupId(id);
    setGroupNameDraft(`Gruppe ${groupStore.groups.length + 1}`);
  }, [groupStore.groups.length]);

  const playGroup = useCallback((groupId: string) => {
    const g = groupStore.groups.find(x => x.id === groupId);
    const first = g?.patternIds.find(pid => patternById.has(pid));
    if (!g || !first) { toast("Gruppe hat keine (gültigen) Patterns", { kind: "warning" }); return; }
    setPlayingGroup(groupId);
    dm.setActivePattern(first);
    onPlayGroup?.(first, groupId);
    toast(`Gruppe „${g.name}" als Sequenz gestartet`, { kind: "success", duration: 2500 });
  }, [groupStore.groups, patternById, dm, onPlayGroup]);

  return (
    <div className="flex h-full bg-bg-base text-text-primary">
      {/* ── Linke Spalte: Gruppen/Playlists ───────────────────────────────── */}
      <aside className="w-72 flex flex-col border-r border-border-color bg-bg-panel">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-color">
          <span className="text-sm font-bold">Gruppen</span>
          <button
            onClick={handleNewGroup}
            className="px-2 py-1 text-[11px] rounded bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30"
            data-testid="pm-new-group"
          >+ Neue Gruppe</button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {groupStore.groups.length === 0 ? (
            <div className="text-[11px] text-text-dim text-center py-6">
              Noch keine Gruppen.<br />Bündle Patterns zu Playlists.
            </div>
          ) : groupStore.groups.map(g => {
            const isSel = g.id === selectedGroupId;
            const isPlaying = g.id === groupStore.playingGroupId;
            return (
              <div key={g.id} className={`rounded border ${isSel ? "border-accent-primary" : "border-border-color"} bg-bg-elevated`}>
                <div className="flex items-center gap-1.5 px-2 py-1.5">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                  {editingGroupId === g.id ? (
                    <input
                      autoFocus value={groupNameDraft}
                      onChange={e => setGroupNameDraft(e.target.value)}
                      onBlur={() => { if (groupNameDraft.trim()) renameGroup(g.id, groupNameDraft.trim()); setEditingGroupId(null); }}
                      onKeyDown={e => { if (e.key === "Enter") { if (groupNameDraft.trim()) renameGroup(g.id, groupNameDraft.trim()); setEditingGroupId(null); } if (e.key === "Escape") setEditingGroupId(null); }}
                      className="flex-1 bg-bg-base border border-accent-primary rounded px-1 py-0.5 text-xs"
                    />
                  ) : (
                    <button onClick={() => setSelectedGroupId(isSel ? null : g.id)} className="flex-1 text-left text-xs font-medium truncate">
                      {isPlaying && <span className="text-accent-danger mr-1">▶</span>}{g.name}
                      <span className="text-text-dim ml-1">({g.patternIds.length})</span>
                    </button>
                  )}
                  <button onClick={() => playGroup(g.id)} title="Als Sequenz abspielen" className="px-1 text-text-dim hover:text-accent-success text-[11px]" data-testid={`pm-play-group-${g.id}`}>▶</button>
                  <button onClick={() => { setEditingGroupId(g.id); setGroupNameDraft(g.name); }} title="Umbenennen" className="px-1 text-text-dim hover:text-accent-primary text-[11px]">✎</button>
                  <button onClick={() => { removeGroup(g.id); if (selectedGroupId === g.id) setSelectedGroupId(null); }} title="Gruppe löschen" className="px-1 text-text-dim hover:text-accent-danger text-[11px]">🗑</button>
                </div>
                {isSel && (
                  <div className="px-2 pb-2 space-y-1">
                    {g.patternIds.length === 0 ? (
                      <div className="text-[10px] text-text-dim py-1">Rechts ein Pattern mit „+" hinzufügen.</div>
                    ) : g.patternIds.map((pid, idx) => {
                      const p = patternById.get(pid);
                      return (
                        <div key={pid} className="flex items-center gap-1 text-[11px]">
                          <span className="text-text-dim w-4 text-right">{idx + 1}.</span>
                          <button onClick={() => p && dm.setActivePattern(pid)} className={`flex-1 text-left truncate ${p ? "hover:text-accent-primary" : "text-text-dim line-through"}`}>
                            {p ? p.name : "(gelöscht)"}
                          </button>
                          <button disabled={idx === 0} onClick={() => moveInGroup(g.id, idx, idx - 1)} className="px-0.5 disabled:opacity-20 hover:text-accent-primary" title="hoch">▲</button>
                          <button disabled={idx === g.patternIds.length - 1} onClick={() => moveInGroup(g.id, idx, idx + 1)} className="px-0.5 disabled:opacity-20 hover:text-accent-primary" title="runter">▼</button>
                          <button onClick={() => removePatternFromGroup(g.id, pid)} className="px-0.5 hover:text-accent-danger" title="aus Gruppe entfernen">✕</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {groupStore.playingGroupId && (
          <button onClick={() => setPlayingGroup(null)} className="m-2 px-2 py-1.5 text-[11px] rounded bg-accent-danger/20 text-accent-danger hover:bg-accent-danger/30">
            ■ Gruppen-Sequenz stoppen
          </button>
        )}
      </aside>

      {/* ── Rechte Spalte: Pattern-Liste ──────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-color bg-bg-panel flex-wrap">
          <input
            type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Suche nach Name oder Sample/Kanal (z.B. SNARE, Kick)…"
            className="flex-1 min-w-[180px] bg-bg-elevated border border-border-color rounded px-2.5 py-1.5 text-xs placeholder:text-text-dim focus:outline-none focus:border-accent-primary"
            data-testid="pattern-manager-search"
          />
          <select value={sortKey} onChange={e => setSortKey(e.target.value as PatternSortKey)} className="bg-bg-elevated border border-border-color rounded px-2 py-1.5 text-xs focus:outline-none focus:border-accent-primary" data-testid="pattern-manager-sort">
            {(Object.keys(SORT_LABELS) as PatternSortKey[]).map(k => <option key={k} value={k}>{SORT_LABELS[k]}</option>)}
          </select>
          <span className="text-[11px] text-text-muted whitespace-nowrap">{visible.length}/{dm.patterns.length}</span>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1" data-testid="pattern-manager-list">
          {visible.length === 0 ? (
            <div className="text-center text-text-dim text-xs py-12">Keine Patterns passen zur Suche „{query}".</div>
          ) : visible.map(p => {
            const isActive = p.id === dm.activePatternId;
            const isPlaying = p.id === dm.playbackPatternId;
            const notes = countActiveSteps(p);
            const channels = countActiveChannels(p);
            const labels = collectPatternLabels(p).slice(1, 7);
            const firstWithContent = p.parts.find(pt => pt.steps.some(s => s.active)) ?? p.parts[0];
            const inSelGroup = selectedGroup?.patternIds.includes(p.id) ?? false;
            return (
              <div key={p.id} onClick={() => dm.setActivePattern(p.id)}
                className={`group rounded border px-3 py-2 cursor-pointer transition-colors ${isActive ? "border-accent-primary bg-bg-elevated" : "border-border-color bg-bg-panel hover:bg-bg-elevated"}`}
                data-testid={`pattern-manager-row-${p.id}`}>
                <div className="flex items-center gap-2">
                  {isPlaying && <span className="text-accent-danger text-[10px]" title="Spielt gerade">▶</span>}
                  {editingId === p.id ? (
                    <input autoFocus value={editName} onChange={e => setEditName(e.target.value)} onBlur={commitRename}
                      onKeyDown={e => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditingId(null); }}
                      onClick={e => e.stopPropagation()}
                      className="flex-1 bg-bg-base border border-accent-primary rounded px-1.5 py-0.5 text-xs focus:outline-none" />
                  ) : (
                    <span className="flex-1 text-xs font-medium truncate">{p.name}</span>
                  )}
                  <span className="text-[10px] text-text-dim whitespace-nowrap">{channels} Kan · {notes} St · {p.stepCount}</span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {selectedGroup && (
                      <button
                        onClick={e => { e.stopPropagation(); if (!inSelGroup) { addPatternToGroup(selectedGroup.id, p.id); toast(`zu „${selectedGroup.name}" hinzugefügt`, { kind: "info", duration: 1500 }); } }}
                        disabled={inSelGroup}
                        title={inSelGroup ? "schon in der Gruppe" : `zu „${selectedGroup.name}" hinzufügen`}
                        className={`px-1 text-[11px] ${inSelGroup ? "text-accent-success" : "text-text-dim hover:text-accent-primary"}`}
                        data-testid={`pm-add-to-group-${p.id}`}
                      >{inSelGroup ? "✓" : "+"}</button>
                    )}
                    <button onClick={e => { e.stopPropagation(); setEditingId(p.id); setEditName(p.name); }} title="Umbenennen" className="px-1 text-text-dim hover:text-accent-primary text-[11px]">✎</button>
                    <button onClick={e => { e.stopPropagation(); dm.duplicatePattern(p.id); toast(`„${p.name}" dupliziert`, { kind: "info", duration: 2000 }); }} title="Duplizieren" className="px-1 text-text-dim hover:text-accent-secondary text-[11px]">⧉</button>
                    <button onClick={e => { e.stopPropagation(); handleDelete(p.id, p.name); }} title="Löschen" className="px-1 text-text-dim hover:text-accent-danger text-[11px]">🗑</button>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  {firstWithContent && <StepPreview steps={firstWithContent.steps} />}
                  {labels.length > 0 && <span className="text-[10px] text-text-muted truncate">{labels.join(" · ")}</span>}
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-4 py-2 border-t border-border-color bg-bg-panel text-[10px] text-text-dim">
          {selectedGroup
            ? `Gruppe gewählt: ${selectedGroup.name} — Patterns rechts mit + hinzufügen.`
            : "Tipp: Links eine Gruppe wählen, dann Patterns rechts mit + zur Playlist hinzufügen."}
        </div>
      </div>
    </div>
  );
}
