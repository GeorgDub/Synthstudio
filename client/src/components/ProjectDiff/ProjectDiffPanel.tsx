/**
 * Synthstudio – ProjectDiffPanel (v3.118.0)
 *
 * Tools-Subtab "📊 Diff": Side-by-Side-Vergleich zweier .synth-Files.
 *
 * Workflow:
 *  1. User wählt zwei .synth-Files (per Click oder Drag-and-Drop)
 *  2. Panel zeigt Summary-Header + sektionierte Diff-Liste
 *  3. User kann Markdown exportieren (Clipboard) oder Project B als
 *     aktives Projekt übernehmen ("Use B as Base").
 *
 * Komplett semantische TailwindCSS --ss-*-Tokens, keine hardcodierten
 * Farben. Funktioniert isomorph (Browser-File-API; Electron-native-Dialog
 * ist nicht nötig — File-Drop reicht auch dort).
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { useProjectDiffStore } from "@/store/useProjectDiffStore";
import { parseProject, type SynthProject } from "@/utils/projectSerializer";
import {
  formatDiffMarkdown,
  formatDiffSummary,
  formatValue,
  isEmptyDiff,
  type FieldDiff,
} from "@/utils/projectDiff";

type Side = "left" | "right";

interface ProjectDiffPanelProps {
  /**
   * Optional: wird vom Tab gerufen wenn User "Use B as Base" klickt.
   * Caller ist verantwortlich für das tatsächliche Laden ins Projekt
   * (Engine-Reset, MixerStore-Restore, etc.). Diese Komponente nur
   * propagiert das gewählte Projekt.
   */
  onUseAsBase?: (project: SynthProject) => void;
}

export function ProjectDiffPanel({ onUseAsBase }: ProjectDiffPanelProps) {
  const store = useProjectDiffStore();
  const { leftProject, rightProject, currentDiff } = store;

  const [errorLeft, setErrorLeft] = useState<string | null>(null);
  const [errorRight, setErrorRight] = useState<string | null>(null);

  const inputLeftRef = useRef<HTMLInputElement | null>(null);
  const inputRightRef = useRef<HTMLInputElement | null>(null);

  // ─── File-Reading (Browser File-API) ───────────────────────────────────
  const readFile = useCallback(async (file: File, side: Side) => {
    try {
      const text = await file.text();
      const project = parseProject(text);
      if (side === "left") {
        store.setLeftProject(project);
        setErrorLeft(null);
      } else {
        store.setRightProject(project);
        setErrorRight(null);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Datei konnte nicht gelesen werden.";
      if (side === "left") setErrorLeft(msg);
      else setErrorRight(msg);
    }
  }, [store]);

  const onPick = useCallback((side: Side) => {
    const ref = side === "left" ? inputLeftRef : inputRightRef;
    ref.current?.click();
  }, []);

  const onInputChange = useCallback((side: Side) => (
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) readFile(file, side);
      // Reset damit das selbe File erneut wählbar bleibt.
      e.target.value = "";
    }
  ), [readFile]);

  const onDrop = useCallback((side: Side) => (
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (file) readFile(file, side);
    }
  ), [readFile]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // ─── Markdown-Export ───────────────────────────────────────────────────
  const onExportMarkdown = useCallback(async () => {
    if (!currentDiff) return;
    const md = formatDiffMarkdown(currentDiff);
    try {
      await navigator.clipboard.writeText(md);
    } catch {
      // Fallback: Trigger Download.
      const blob = new Blob([md], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "project-diff.md";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }, [currentDiff]);

  const onUseB = useCallback(() => {
    if (rightProject && onUseAsBase) onUseAsBase(rightProject);
  }, [rightProject, onUseAsBase]);

  const summary = useMemo(() => {
    if (!currentDiff) return null;
    return formatDiffSummary(currentDiff);
  }, [currentDiff]);

  return (
    <div className="h-full flex flex-col overflow-hidden" data-testid="project-diff-panel">
      {/* Header ─────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-border-color bg-bg-panel">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-text-primary">
              📊 Project-Diff Compare
            </h2>
            <span className="text-xs text-text-dim">
              v3.118 — vergleicht zwei .synth-Files
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onExportMarkdown}
              disabled={!currentDiff}
              data-testid="project-diff-export-md"
              className="px-3 py-1.5 text-xs rounded border border-border-color text-text-muted hover:text-accent-primary hover:border-accent-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Markdown kopieren
            </button>
            <button
              type="button"
              onClick={onUseB}
              disabled={!rightProject || !onUseAsBase}
              data-testid="project-diff-use-b"
              className="px-3 py-1.5 text-xs rounded bg-accent-primary text-bg-base hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              Project B als Base laden
            </button>
            <button
              type="button"
              onClick={() => store.clearAll()}
              data-testid="project-diff-clear"
              className="px-3 py-1.5 text-xs rounded border border-border-color text-text-muted hover:text-accent-danger hover:border-accent-danger transition-colors"
            >
              Zurücksetzen
            </button>
          </div>
        </div>
        {summary && (
          <div
            className="mt-2 text-xs text-text-muted"
            data-testid="project-diff-summary"
          >
            {summary}
          </div>
        )}
      </div>

      {/* File-Picker Side-by-Side ───────────────────────────────────── */}
      <div className="flex-shrink-0 grid grid-cols-1 lg:grid-cols-2 gap-3 p-4 border-b border-border-color">
        <FilePickerCard
          side="left"
          label="Project A (vorher)"
          project={leftProject}
          error={errorLeft}
          onPick={() => onPick("left")}
          onDrop={onDrop("left")}
          onDragOver={onDragOver}
        />
        <FilePickerCard
          side="right"
          label="Project B (nachher)"
          project={rightProject}
          error={errorRight}
          onPick={() => onPick("right")}
          onDrop={onDrop("right")}
          onDragOver={onDragOver}
        />
        <input
          ref={inputLeftRef}
          type="file"
          accept=".synth,.json"
          className="hidden"
          onChange={onInputChange("left")}
          data-testid="project-diff-input-left"
        />
        <input
          ref={inputRightRef}
          type="file"
          accept=".synth,.json"
          className="hidden"
          onChange={onInputChange("right")}
          data-testid="project-diff-input-right"
        />
      </div>

      {/* Diff-Sections ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4">
        {!leftProject || !rightProject ? (
          <EmptyHint />
        ) : currentDiff && isEmptyDiff(currentDiff) ? (
          <div
            className="text-center text-text-dim text-sm py-12"
            data-testid="project-diff-no-changes"
          >
            ✅ Keine Unterschiede zwischen den beiden Projekten gefunden.
          </div>
        ) : currentDiff ? (
          <DiffSections diff={currentDiff} />
        ) : null}
      </div>
    </div>
  );
}

// ─── Sub-Components ─────────────────────────────────────────────────────────

function FilePickerCard({
  side,
  label,
  project,
  error,
  onPick,
  onDrop,
  onDragOver,
}: {
  side: Side;
  label: string;
  project: SynthProject | null;
  error: string | null;
  onPick: () => void;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
}) {
  return (
    <div
      className="rounded border border-border-color bg-bg-elevated p-3 flex flex-col gap-2 min-h-[110px]"
      onDrop={onDrop}
      onDragOver={onDragOver}
      data-testid={`project-diff-picker-${side}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-muted">{label}</span>
        <button
          type="button"
          onClick={onPick}
          className="text-xs px-2 py-1 rounded border border-border-color text-text-muted hover:text-accent-primary hover:border-accent-primary transition-colors"
          data-testid={`project-diff-pick-${side}`}
        >
          Datei wählen…
        </button>
      </div>
      {project ? (
        <div className="text-xs text-text-primary leading-relaxed">
          <div className="font-semibold truncate" title={project.projectName}>
            {project.projectName}
          </div>
          <div className="text-text-dim">
            v{project.version} · BPM {project.bpm} · {project.patterns?.length ?? 0} Patterns ·{" "}
            {project.samples?.length ?? 0} Samples
          </div>
          <div className="text-text-dim text-[10px] truncate">
            gespeichert: {project.savedAt ?? "—"}
          </div>
        </div>
      ) : (
        <div className="text-xs text-text-dim flex-1 flex items-center justify-center py-2 border border-dashed border-border-color rounded">
          .synth-File hier ablegen oder „Datei wählen…“
        </div>
      )}
      {error && (
        <div className="text-[11px] text-accent-danger" data-testid={`project-diff-error-${side}`}>
          ⚠ {error}
        </div>
      )}
    </div>
  );
}

function EmptyHint() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="max-w-md text-center text-text-dim">
        <div className="text-3xl mb-2">📊</div>
        <p className="text-sm text-text-muted">
          Wähle zwei <code className="text-accent-primary">.synth</code>-Files zum Vergleichen.
        </p>
        <p className="text-xs mt-1">
          Project A links, Project B rechts. Der Diff zeigt Metadaten, Patterns, Channels,
          Samples, Mixer und Macros.
        </p>
      </div>
    </div>
  );
}

function DiffSections({ diff }: { diff: import("@/utils/projectDiff").ProjectDiff }) {
  return (
    <div className="space-y-4">
      {/* Metadata */}
      {diff.metadata.fieldDiffs.length > 0 && (
        <SectionCard title="Metadata" testId="project-diff-section-metadata">
          <FieldDiffList diffs={diff.metadata.fieldDiffs} />
        </SectionCard>
      )}

      {/* Patterns */}
      {(diff.patterns.added.length || diff.patterns.removed.length || diff.patterns.changed.length) > 0 && (
        <SectionCard title="Patterns" testId="project-diff-section-patterns">
          <AddedRemovedList
            added={diff.patterns.added.map((p) => ({ key: p.id, label: p.name ?? p.id }))}
            removed={diff.patterns.removed.map((p) => ({ key: p.id, label: p.name ?? p.id }))}
          />
          {diff.patterns.changed.map((p) => (
            <ChangedItem
              key={p.id}
              title={`${p.name} (${p.id.slice(0, 8)}…)`}
              diffs={p.fieldDiffs}
            />
          ))}
        </SectionCard>
      )}

      {/* Channels */}
      {(diff.channels.added.length || diff.channels.removed.length || diff.channels.changed.length) > 0 && (
        <SectionCard title="Channels" testId="project-diff-section-channels">
          <AddedRemovedList
            added={diff.channels.added.map((c) => ({ key: c.id, label: c.name ?? c.id }))}
            removed={diff.channels.removed.map((c) => ({ key: c.id, label: c.name ?? c.id }))}
          />
          {diff.channels.changed.map((c) => (
            <ChangedItem key={c.id} title={c.name} diffs={c.fieldDiffs} />
          ))}
        </SectionCard>
      )}

      {/* Samples */}
      {(diff.samples.added.length || diff.samples.removed.length || diff.samples.changed.length) > 0 && (
        <SectionCard title="Samples" testId="project-diff-section-samples">
          <AddedRemovedList
            added={diff.samples.added.map((s) => ({ key: s.id, label: s.name }))}
            removed={diff.samples.removed.map((s) => ({ key: s.id, label: s.name }))}
          />
          {diff.samples.changed.map((s) => (
            <ChangedItem key={s.id} title={s.name} diffs={s.fieldDiffs} />
          ))}
        </SectionCard>
      )}

      {/* Mixer */}
      {diff.mixer.fieldDiffs.length > 0 && (
        <SectionCard title="Mixer" testId="project-diff-section-mixer">
          <FieldDiffList diffs={diff.mixer.fieldDiffs} />
        </SectionCard>
      )}

      {/* Macros */}
      {diff.macros.fieldDiffs.length > 0 && (
        <SectionCard title="Macros" testId="project-diff-section-macros">
          <FieldDiffList diffs={diff.macros.fieldDiffs} />
        </SectionCard>
      )}
    </div>
  );
}

function SectionCard({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded border border-border-color bg-bg-panel" data-testid={testId}>
      <div className="px-3 py-2 border-b border-border-color text-xs font-semibold text-text-primary">
        {title}
      </div>
      <div className="p-3 space-y-2">{children}</div>
    </div>
  );
}

function AddedRemovedList({
  added,
  removed,
}: {
  added: Array<{ key: string; label: string }>;
  removed: Array<{ key: string; label: string }>;
}) {
  if (added.length === 0 && removed.length === 0) return null;
  return (
    <div className="space-y-1">
      {added.map((a) => (
        <div key={`add-${a.key}`} className="text-xs text-accent-success flex gap-2">
          <span className="font-semibold">+</span>
          <span>{a.label}</span>
        </div>
      ))}
      {removed.map((r) => (
        <div key={`rem-${r.key}`} className="text-xs text-accent-danger flex gap-2">
          <span className="font-semibold">−</span>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

function ChangedItem({ title, diffs }: { title: string; diffs: FieldDiff[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border border-border-subtle bg-bg-elevated">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-2 py-1.5 text-left flex items-center justify-between text-xs text-text-primary hover:bg-bg-panel transition-colors"
      >
        <span>
          <span className="text-accent-secondary mr-1">~</span>
          {title}
        </span>
        <span className="text-text-dim">
          {diffs.length} {diffs.length === 1 ? "Feld" : "Felder"}
          {" "}
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <div className="px-2 py-1 border-t border-border-subtle">
          <FieldDiffList diffs={diffs} />
        </div>
      )}
    </div>
  );
}

function FieldDiffList({ diffs }: { diffs: FieldDiff[] }) {
  if (diffs.length === 0) return null;
  return (
    <div className="space-y-1">
      {diffs.map((d, idx) => (
        <div
          key={`${d.path}-${idx}`}
          className="text-[11px] font-mono flex flex-wrap items-baseline gap-2"
        >
          <span className="text-text-muted">{d.path}</span>
          <span className="text-accent-danger" title="Vorher">
            {formatValue(d.before)}
          </span>
          <span className="text-text-dim">→</span>
          <span className="text-accent-success" title="Nachher">
            {formatValue(d.after)}
          </span>
        </div>
      ))}
    </div>
  );
}
