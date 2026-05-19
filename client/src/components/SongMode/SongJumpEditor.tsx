/**
 * Synthstudio – SongJumpEditor (v3.117.0)
 *
 * Sub-panel of SongModePanel that manages conditional jumps for a song.
 *
 * Features:
 *   - List existing jumps with a short description (From / To / Condition)
 *   - Add new jump via inline form (From/To step pickers + condition editor)
 *   - Edit / Remove existing jumps
 *
 * All colors via semantic --ss-* tokens (no hardcoded Tailwind colors).
 */
import { useMemo, useState } from "react";
import { Plus, Trash2, Pencil, X } from "lucide-react";
import {
  useSongJumpStore,
  addJump,
  removeJump,
  updateJump,
  type Jump,
  type JumpCondition,
} from "@/store/useSongJumpStore";
import { describeCondition } from "@/utils/songJumpLogic";
import type { Song } from "@/utils/songSequencer";

type ConditionKind = JumpCondition["kind"];

interface SongJumpEditorProps {
  song: Song;
  className?: string;
}

const CONDITION_KINDS: Array<{ id: ConditionKind; label: string }> = [
  { id: "always", label: "Always" },
  { id: "macro-above", label: "Macro >" },
  { id: "macro-below", label: "Macro <" },
  { id: "midi-note", label: "MIDI Note" },
  { id: "midi-cc", label: "MIDI CC >" },
];

interface FormState {
  fromStepId: string;
  toStepId: string;
  kind: ConditionKind;
  macroIdx: number;
  threshold: number;
  note: number;
  channel: number | "";
  cc: number;
  valueAbove: number;
  label: string;
}

function defaultForm(song: Song): FormState {
  const firstId = song.steps[0]?.id ?? "";
  const secondId = song.steps[1]?.id ?? firstId;
  return {
    fromStepId: firstId,
    toStepId: secondId,
    kind: "always",
    macroIdx: 0,
    threshold: 0.5,
    note: 60,
    channel: "",
    cc: 1,
    valueAbove: 64,
    label: "",
  };
}

function formToCondition(f: FormState): JumpCondition | null {
  switch (f.kind) {
    case "always":
      return { kind: "always" };
    case "macro-above":
      return { kind: "macro-above", macroIdx: f.macroIdx, threshold: f.threshold };
    case "macro-below":
      return { kind: "macro-below", macroIdx: f.macroIdx, threshold: f.threshold };
    case "midi-note": {
      const out: JumpCondition = { kind: "midi-note", note: f.note };
      if (typeof f.channel === "number") out.channel = f.channel;
      return out;
    }
    case "midi-cc":
      return { kind: "midi-cc", cc: f.cc, valueAbove: f.valueAbove };
    default:
      return null;
  }
}

function conditionToForm(cond: JumpCondition, base: FormState): FormState {
  switch (cond.kind) {
    case "always":
      return { ...base, kind: "always" };
    case "macro-above":
    case "macro-below":
      return {
        ...base,
        kind: cond.kind,
        macroIdx: cond.macroIdx,
        threshold: cond.threshold,
      };
    case "midi-note":
      return {
        ...base,
        kind: "midi-note",
        note: cond.note,
        channel: typeof cond.channel === "number" ? cond.channel : "",
      };
    case "midi-cc":
      return {
        ...base,
        kind: "midi-cc",
        cc: cond.cc,
        valueAbove: cond.valueAbove,
      };
    default:
      return base;
  }
}

export function SongJumpEditor({ song, className = "" }: SongJumpEditorProps) {
  const state = useSongJumpStore();
  const jumps = useMemo(
    () => state.jumpsBySong[song.id] ?? [],
    [state.jumpsBySong, song.id]
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(() => defaultForm(song));

  const stepLabelById = useMemo(() => {
    const m = new Map<string, string>();
    song.steps.forEach((st, i) => {
      m.set(st.id, st.label ?? `Step ${i + 1}`);
    });
    return m;
  }, [song.steps]);

  function describeStep(stepId: string): string {
    return stepLabelById.get(stepId) ?? "?";
  }

  function handleStartAdd() {
    setForm(defaultForm(song));
    setEditingId(null);
    setShowForm(true);
  }

  function handleStartEdit(jump: Jump) {
    const base = defaultForm(song);
    const fromForm = conditionToForm(jump.condition, {
      ...base,
      fromStepId: jump.fromStepId,
      toStepId: jump.toStepId,
      label: jump.label ?? "",
    });
    setForm(fromForm);
    setEditingId(jump.id);
    setShowForm(true);
  }

  function handleSubmit() {
    if (!form.fromStepId || !form.toStepId) return;
    const cond = formToCondition(form);
    if (!cond) return;
    if (editingId) {
      updateJump(song.id, editingId, {
        fromStepId: form.fromStepId,
        toStepId: form.toStepId,
        condition: cond,
        label: form.label || undefined,
      });
    } else {
      addJump(song.id, {
        fromStepId: form.fromStepId,
        toStepId: form.toStepId,
        condition: cond,
        ...(form.label ? { label: form.label } : {}),
      });
    }
    setShowForm(false);
    setEditingId(null);
  }

  function handleCancel() {
    setShowForm(false);
    setEditingId(null);
  }

  const canSubmit = !!form.fromStepId && !!form.toStepId && song.steps.length >= 1;

  return (
    <div
      className={`flex flex-col bg-bg-panel text-text-primary ${className}`}
      data-testid="song-jump-editor"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-color">
        <span className="text-sm font-semibold">↪ Conditional Jumps</span>
        <span className="text-xs text-text-dim" data-testid="song-jump-count">
          {jumps.length} jump{jumps.length === 1 ? "" : "s"}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleStartAdd}
          disabled={song.steps.length === 0}
          className="px-2 py-1 text-xs rounded border border-border-color text-text-muted hover:text-accent-primary hover:border-accent-primary disabled:opacity-50 disabled:hover:text-text-muted disabled:hover:border-border-color transition-colors"
          data-testid="song-jump-add-btn"
          title="Neuen Jump anlegen"
        >
          <Plus size={12} className="inline" /> Jump
        </button>
      </div>

      {/* Jump list */}
      <div className="px-3 py-2 space-y-1 max-h-64 overflow-y-auto">
        {jumps.length === 0 && !showForm && (
          <div className="text-xs text-text-dim italic py-2">
            Noch keine Jumps. Klick „+ Jump" zum Anlegen.
          </div>
        )}

        {jumps.map(jump => (
          <div
            key={jump.id}
            className="flex items-center gap-2 px-2 py-1.5 rounded border border-border-color bg-bg-base text-xs"
            data-testid={`song-jump-row-${jump.id}`}
          >
            <span className="text-text-muted flex-1 truncate">
              {jump.label && (
                <span className="text-accent-secondary mr-1">[{jump.label}]</span>
              )}
              <span className="text-text-primary">{describeStep(jump.fromStepId)}</span>
              <span className="mx-1 text-text-dim">→</span>
              <span className="text-text-primary">{describeStep(jump.toStepId)}</span>
              <span className="mx-1 text-text-dim">when</span>
              <span className="text-accent-primary">{describeCondition(jump.condition)}</span>
            </span>
            <button
              type="button"
              onClick={() => handleStartEdit(jump)}
              className="p-1 rounded text-text-dim hover:text-accent-primary transition-colors"
              title="Bearbeiten"
              data-testid={`song-jump-edit-${jump.id}`}
            >
              <Pencil size={12} />
            </button>
            <button
              type="button"
              onClick={() => removeJump(song.id, jump.id)}
              className="p-1 rounded text-text-dim hover:text-accent-danger transition-colors"
              title="Löschen"
              data-testid={`song-jump-remove-${jump.id}`}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div
          className="px-3 py-2 border-t border-border-color bg-bg-base space-y-2"
          data-testid="song-jump-form"
        >
          <div className="flex items-center gap-2 text-xs">
            <span className="text-text-muted">From:</span>
            <select
              value={form.fromStepId}
              onChange={e => setForm(f => ({ ...f, fromStepId: e.target.value }))}
              className="flex-1 px-2 py-1 rounded bg-bg-elevated border border-border-color text-xs text-text-primary"
              data-testid="song-jump-form-from"
            >
              {song.steps.map((s, i) => (
                <option key={s.id} value={s.id}>
                  {i + 1}. {s.label ?? `Step ${i + 1}`}
                </option>
              ))}
            </select>
            <span className="text-text-muted">To:</span>
            <select
              value={form.toStepId}
              onChange={e => setForm(f => ({ ...f, toStepId: e.target.value }))}
              className="flex-1 px-2 py-1 rounded bg-bg-elevated border border-border-color text-xs text-text-primary"
              data-testid="song-jump-form-to"
            >
              {song.steps.map((s, i) => (
                <option key={s.id} value={s.id}>
                  {i + 1}. {s.label ?? `Step ${i + 1}`}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 text-xs flex-wrap">
            <span className="text-text-muted">When:</span>
            <select
              value={form.kind}
              onChange={e => setForm(f => ({ ...f, kind: e.target.value as ConditionKind }))}
              className="px-2 py-1 rounded bg-bg-elevated border border-border-color text-xs text-text-primary"
              data-testid="song-jump-form-kind"
            >
              {CONDITION_KINDS.map(k => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>

            {(form.kind === "macro-above" || form.kind === "macro-below") && (
              <>
                <select
                  value={form.macroIdx}
                  onChange={e => setForm(f => ({ ...f, macroIdx: Number(e.target.value) }))}
                  className="px-2 py-1 rounded bg-bg-elevated border border-border-color text-xs text-text-primary"
                  data-testid="song-jump-form-macro-idx"
                >
                  {Array.from({ length: 8 }, (_, i) => (
                    <option key={i} value={i}>
                      Macro {i + 1}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step={0.05}
                  min={0}
                  max={1}
                  value={form.threshold}
                  onChange={e =>
                    setForm(f => ({ ...f, threshold: Number(e.target.value) || 0 }))
                  }
                  className="w-16 px-1 py-0.5 rounded bg-bg-elevated border border-border-color text-xs text-text-primary"
                  data-testid="song-jump-form-threshold"
                />
                <span className="text-text-dim">
                  ({Math.round(form.threshold * 100)}%)
                </span>
              </>
            )}

            {form.kind === "midi-note" && (
              <>
                <span className="text-text-muted">Note:</span>
                <input
                  type="number"
                  min={0}
                  max={127}
                  value={form.note}
                  onChange={e => setForm(f => ({ ...f, note: Number(e.target.value) || 0 }))}
                  className="w-16 px-1 py-0.5 rounded bg-bg-elevated border border-border-color text-xs text-text-primary"
                  data-testid="song-jump-form-note"
                />
                <span className="text-text-muted">Ch:</span>
                <input
                  type="number"
                  min={1}
                  max={16}
                  value={form.channel === "" ? "" : form.channel + 1}
                  onChange={e => {
                    const v = e.target.value;
                    if (v === "") {
                      setForm(f => ({ ...f, channel: "" }));
                    } else {
                      const n = Number(v);
                      if (Number.isFinite(n) && n >= 1 && n <= 16) {
                        setForm(f => ({ ...f, channel: n - 1 }));
                      }
                    }
                  }}
                  placeholder="any"
                  className="w-14 px-1 py-0.5 rounded bg-bg-elevated border border-border-color text-xs text-text-primary"
                  data-testid="song-jump-form-channel"
                />
              </>
            )}

            {form.kind === "midi-cc" && (
              <>
                <span className="text-text-muted">CC:</span>
                <input
                  type="number"
                  min={0}
                  max={127}
                  value={form.cc}
                  onChange={e => setForm(f => ({ ...f, cc: Number(e.target.value) || 0 }))}
                  className="w-16 px-1 py-0.5 rounded bg-bg-elevated border border-border-color text-xs text-text-primary"
                  data-testid="song-jump-form-cc"
                />
                <span className="text-text-muted">Value &gt;</span>
                <input
                  type="number"
                  min={0}
                  max={127}
                  value={form.valueAbove}
                  onChange={e =>
                    setForm(f => ({ ...f, valueAbove: Number(e.target.value) || 0 }))
                  }
                  className="w-16 px-1 py-0.5 rounded bg-bg-elevated border border-border-color text-xs text-text-primary"
                  data-testid="song-jump-form-value-above"
                />
              </>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-text-muted">Label:</span>
            <input
              type="text"
              placeholder="(optional)"
              value={form.label}
              onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
              className="flex-1 px-2 py-1 rounded bg-bg-elevated border border-border-color text-xs text-text-muted"
              data-testid="song-jump-form-label"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="px-3 py-1 text-xs rounded bg-accent-primary text-text-primary disabled:opacity-50 hover:opacity-90 transition-opacity"
              data-testid="song-jump-form-submit"
            >
              {editingId ? "Update" : "Add"}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="px-3 py-1 text-xs rounded border border-border-color text-text-muted hover:text-text-primary transition-colors"
              data-testid="song-jump-form-cancel"
            >
              <X size={12} className="inline" /> Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default SongJumpEditor;
