/**
 * Synthstudio – MacroSnapshotPanel (v3.115.0)
 *
 * Performance Live-Killer: Macro-Snapshot Morphing.
 * User definiert mehrere "Looks" (8-Macro-Konfigurationen) und morpht
 * live zwischen ihnen mit einem großen Slider.
 *
 * MIDI-Learn:
 *  - Morph-Slider via Rechtsklick → CC-Mapping ({type: "morphAmount"})
 *  - Recall-Buttons via Rechtsklick → Note/CC-Mapping
 *    ({type: "recallSnapshot", snapshotId})
 */
import { useState } from "react";
import { Pencil, Trash2, Plus } from "lucide-react";

import {
  useMacroSnapshotStore,
  addSnapshot,
  updateSnapshot,
  removeSnapshot,
  setMorphA,
  setMorphB,
  setMorphAmount,
  setMorphCurve,
  recallSnapshot,
  getCurrentMorphedValues,
  MACRO_SNAPSHOT_COLORS,
  MACRO_VALUES_LENGTH,
  type MacroSnapshot,
} from "@/store/useMacroSnapshotStore";
import { MORPH_CURVES, type MorphCurve } from "@/utils/macroMorph";
import { getMacros, setMacroValue } from "@/store/useMacroStore";
import { useMidiLearn } from "@/hooks/useMidiLearn";

interface MacroSnapshotPanelProps {
  className?: string;
}

// ─── kleine Macro-Preview-Vis (8 vertikale Bars) ────────────────────────────
function MacroPreviewBars({
  values,
  color,
  testId,
}: {
  values: number[];
  color?: string;
  testId?: string;
}) {
  return (
    <div className="flex items-end gap-[2px] h-6" data-testid={testId}>
      {values.slice(0, MACRO_VALUES_LENGTH).map((v, i) => (
        <div
          key={i}
          className="w-1.5 rounded-sm bg-accent-primary/60"
          style={{
            height: `${Math.max(2, v * 100)}%`,
            background: color ?? "var(--ss-accent-primary)",
            opacity: 0.4 + v * 0.6,
          }}
        />
      ))}
    </div>
  );
}

// ─── Snapshot-Card ──────────────────────────────────────────────────────────
function SnapshotCard({
  snapshot,
  isA,
  isB,
  onSelectA,
  onSelectB,
  onRecall,
  onEdit,
  onDelete,
}: {
  snapshot: MacroSnapshot;
  isA: boolean;
  isB: boolean;
  onSelectA: () => void;
  onSelectB: () => void;
  onRecall: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const learn = useMidiLearn({
    type: "recallSnapshot",
    snapshotId: snapshot.id,
    snapshotName: snapshot.name,
  });

  return (
    <div
      className="relative flex flex-col gap-1.5 p-2 rounded border border-border-color bg-bg-elevated"
      data-testid={`snapshot-card-${snapshot.id}`}
      onContextMenu={learn.onContextMenu}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ background: snapshot.color }}
        />
        <span
          className="text-xs text-text-primary truncate flex-1"
          title={snapshot.name}
        >
          {snapshot.name}
        </span>
        {learn.isMapped && (
          <span
            className="text-[9px] text-accent-secondary font-mono"
            data-testid={`snapshot-cc-${snapshot.id}`}
          >
            ·CC{learn.mappedCC}
          </span>
        )}
      </div>

      <MacroPreviewBars
        values={snapshot.values}
        color={snapshot.color}
        testId={`snapshot-preview-${snapshot.id}`}
      />

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onRecall}
          className="flex-1 text-[10px] py-1 rounded bg-bg-panel hover:bg-accent-primary/20 text-text-muted hover:text-accent-primary border border-border-color transition-colors"
          data-testid={`snapshot-recall-${snapshot.id}`}
          title="Sofort recall: A=B=Snapshot, amount=0"
        >
          Recall
        </button>
        <button
          type="button"
          onClick={onSelectA}
          className={`px-2 text-[10px] py-1 rounded border transition-colors ${
            isA
              ? "bg-accent-primary text-bg-base border-accent-primary"
              : "bg-bg-panel text-text-muted hover:text-accent-primary border-border-color"
          }`}
          data-testid={`snapshot-set-a-${snapshot.id}`}
          title="Als Morph A setzen"
        >
          A
        </button>
        <button
          type="button"
          onClick={onSelectB}
          className={`px-2 text-[10px] py-1 rounded border transition-colors ${
            isB
              ? "bg-accent-secondary text-bg-base border-accent-secondary"
              : "bg-bg-panel text-text-muted hover:text-accent-secondary border-border-color"
          }`}
          data-testid={`snapshot-set-b-${snapshot.id}`}
          title="Als Morph B setzen"
        >
          B
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="p-1 rounded hover:bg-bg-panel text-text-dim hover:text-text-primary transition-colors"
          data-testid={`snapshot-edit-${snapshot.id}`}
          title="Bearbeiten"
        >
          <Pencil className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="p-1 rounded hover:bg-accent-danger/20 text-text-dim hover:text-accent-danger transition-colors"
          data-testid={`snapshot-delete-${snapshot.id}`}
          title="Löschen"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {learn.menu}
    </div>
  );
}

// ─── Edit-Modal ─────────────────────────────────────────────────────────────
function EditModal({
  snapshot,
  onClose,
}: {
  snapshot: MacroSnapshot;
  onClose: () => void;
}) {
  const [name, setName] = useState(snapshot.name);
  const [color, setColor] = useState(snapshot.color);

  const onSave = () => {
    updateSnapshot(snapshot.id, { name, color });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
      data-testid="snapshot-edit-modal"
    >
      <div
        className="bg-bg-panel border border-border-color rounded-lg p-4 min-w-[280px] flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-text-primary">
          Snapshot bearbeiten
        </h3>

        <label className="flex flex-col gap-1 text-xs text-text-muted">
          Name
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="px-2 py-1 rounded border border-border-color bg-bg-base text-text-primary text-sm"
            data-testid="snapshot-edit-name"
          />
        </label>

        <div className="flex flex-col gap-1 text-xs text-text-muted">
          Farbe
          <div className="flex flex-wrap gap-1.5">
            {MACRO_SNAPSHOT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`w-6 h-6 rounded-full border-2 transition-all ${
                  color === c
                    ? "border-text-primary scale-110"
                    : "border-transparent hover:scale-105"
                }`}
                style={{ background: c }}
                data-testid={`snapshot-edit-color-${c}`}
                aria-label={`Farbe ${c}`}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 mt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded border border-border-color text-text-muted hover:text-text-primary"
            data-testid="snapshot-edit-cancel"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={onSave}
            className="px-3 py-1.5 text-xs rounded bg-accent-primary text-bg-base"
            data-testid="snapshot-edit-save"
          >
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Haupt-Panel ─────────────────────────────────────────────────────────────
export function MacroSnapshotPanel({ className }: MacroSnapshotPanelProps) {
  const state = useMacroSnapshotStore();
  const [editingId, setEditingId] = useState<string | null>(null);

  const morphLearn = useMidiLearn({ type: "morphAmount" });

  const onCapture = () => {
    const macros = getMacros();
    const values = macros.map((m) => m.value);
    const id = addSnapshot(`Snap ${state.snapshots.length + 1}`, values);
    // ergonomic default: erster Snapshot → automatisch in A, zweiter → in B
    if (!state.morphA) setMorphA(id);
    else if (!state.morphB) setMorphB(id);
  };

  const onMorphAmount = (v: number) => {
    setMorphAmount(v);
    // Apply morphed values to macros via existing setMacroValue pipeline
    const out = getCurrentMorphedValues();
    if (!out) return;
    for (let i = 0; i < out.length; i++) {
      setMacroValue(i, out[i]);
    }
  };

  const onRecall = (id: string) => {
    if (!recallSnapshot(id)) return;
    const out = getCurrentMorphedValues();
    if (!out) return;
    for (let i = 0; i < out.length; i++) {
      setMacroValue(i, out[i]);
    }
  };

  const currentMorphed = getCurrentMorphedValues();
  const previewValues = currentMorphed ?? getMacros().map((m) => m.value);
  const editingSnapshot =
    editingId !== null
      ? state.snapshots.find((s) => s.id === editingId) ?? null
      : null;

  return (
    <div
      className={`flex flex-col h-full p-3 gap-3 bg-bg-base text-text-primary overflow-hidden ${className ?? ""}`}
      data-testid="macro-snapshot-panel"
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">
            Macro-Snapshot Morphing
          </h2>
          <p className="text-[10px] text-text-dim">
            Live zwischen 8-Macro-Konfigurationen morphen
          </p>
        </div>
        <button
          type="button"
          onClick={onCapture}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-accent-primary text-bg-base hover:opacity-90"
          data-testid="snapshot-capture"
          title="Aktuelle Macro-Werte als neuen Snapshot speichern"
        >
          <Plus className="w-3.5 h-3.5" />
          Capture Current
        </button>
      </div>

      {/* ── Morph-Section (groß!) ─────────────────────────────────────── */}
      <div
        className="flex flex-col gap-2 p-3 rounded-lg border border-accent-secondary/30 bg-bg-panel flex-shrink-0"
        data-testid="snapshot-morph-section"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-text-muted font-semibold">
            Morph A → B
          </span>
          {morphLearn.isMapped && (
            <span
              className="text-[10px] text-accent-secondary font-mono"
              data-testid="morph-amount-cc"
            >
              ·CC{morphLearn.mappedCC}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={state.morphA ?? ""}
            onChange={(e) => setMorphA(e.target.value || null)}
            className="flex-1 px-2 py-1 text-xs rounded border border-border-color bg-bg-elevated text-text-primary"
            data-testid="morph-a-select"
          >
            <option value="">— A wählen —</option>
            {state.snapshots.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <span className="text-[10px] text-text-dim">→</span>
          <select
            value={state.morphB ?? ""}
            onChange={(e) => setMorphB(e.target.value || null)}
            className="flex-1 px-2 py-1 text-xs rounded border border-border-color bg-bg-elevated text-text-primary"
            data-testid="morph-b-select"
          >
            <option value="">— B wählen —</option>
            {state.snapshots.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* Großer Morph-Slider */}
        <div
          className="flex flex-col gap-1"
          onContextMenu={morphLearn.onContextMenu}
        >
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={state.morphAmount}
            onChange={(e) => onMorphAmount(parseFloat(e.target.value))}
            className="w-full h-3 accent-accent-secondary"
            data-testid="morph-amount-slider"
            aria-label="Morph Amount"
          />
          <div className="flex items-center justify-between text-[10px] text-text-dim">
            <span>A</span>
            <span
              className="font-mono text-text-muted"
              data-testid="morph-amount-value"
            >
              {Math.round(state.morphAmount * 100)}%
            </span>
            <span>B</span>
          </div>
          {morphLearn.menu}
        </div>

        {/* v3.129.0: Curve-Selector */}
        <div className="flex items-center gap-1 mt-1" data-testid="morph-curve-selector">
          <span className="text-[10px] text-text-dim whitespace-nowrap">Curve:</span>
          {MORPH_CURVES.map((c: MorphCurve) => {
            const active = state.morphCurve === c;
            return (
              <button
                key={c}
                onClick={() => setMorphCurve(c)}
                data-testid={`morph-curve-${c}`}
                title={
                  c === "linear" ? "Linear (gleichmäßig)" :
                  c === "exp"    ? "Exp (slow→fast)" :
                  c === "log"    ? "Log (fast→slow)" :
                                   "Sigmoid (S-curve)"
                }
                className={[
                  "px-2 py-0.5 rounded text-[9px] font-bold uppercase transition-colors",
                  active
                    ? "bg-accent-secondary/30 text-accent-secondary border border-accent-secondary/60"
                    : "bg-bg-elevated text-text-dim hover:text-text-primary border border-transparent",
                ].join(" ")}
              >
                {c}
              </button>
            );
          })}
        </div>

        {/* Current Morphed Preview */}
        <div
          className="flex items-center gap-2 mt-1"
          data-testid="morph-current-preview"
        >
          <span className="text-[10px] text-text-dim">Aktuell:</span>
          <MacroPreviewBars values={previewValues} />
        </div>
      </div>

      {/* ── Snapshot-Liste ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto" data-testid="snapshot-list">
        {state.snapshots.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-dim text-xs text-center px-4">
            Keine Snapshots. Drücke
            <span className="text-accent-primary mx-1">Capture Current</span>
            um zu starten.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {state.snapshots.map((s) => (
              <SnapshotCard
                key={s.id}
                snapshot={s}
                isA={state.morphA === s.id}
                isB={state.morphB === s.id}
                onSelectA={() => setMorphA(s.id)}
                onSelectB={() => setMorphB(s.id)}
                onRecall={() => onRecall(s.id)}
                onEdit={() => setEditingId(s.id)}
                onDelete={() => removeSnapshot(s.id)}
              />
            ))}
          </div>
        )}
      </div>

      {editingSnapshot && (
        <EditModal
          snapshot={editingSnapshot}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}

export default MacroSnapshotPanel;
