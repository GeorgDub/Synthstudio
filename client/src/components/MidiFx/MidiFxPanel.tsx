/**
 * Synthstudio – MidiFxPanel.tsx (v3.92.0)
 *
 * UI für MIDI-FX Chain (Transform-Layer vor der Engine).
 *
 * Layout:
 *   - Header mit Add-Dropdown (5 Node-Types).
 *   - Liste der aktuellen Chain (Reorder + Bypass + Remove + Per-Node-Params).
 *   - Empty-State wenn Chain leer.
 *
 * Verwendet ausschließlich semantische Tailwind-Tokens (bg-bg-*, text-*,
 * border-*, accent-*).
 */

import * as React from "react";
import { useState, useMemo } from "react";
import {
  useMidiFxStore,
  addNode,
  removeNode,
  moveNode,
  updateNode,
  setNodeBypass,
  clearChain,
  setAllNodes,
  MAX_MIDI_FX_CHAIN,
  type MidiFxNode,
  type MidiFxKind,
  type MidiScaleName,
  type VelocityCurveShape,
  type NoteRepeatRate,
  type ChordExpanderType,
  type PitchSweepDirection,
  type PitchSweepCurve,
  type PitchSweepStepRate,
} from "@/store/useMidiFxStore";
import { applyMidiFx } from "@/utils/midiFxEngine";
// v3.94.0: Built-In Preset-Chains (Strum, Glissando, Arp-Up, ...).
import {
  MIDI_FX_PRESETS,
  loadPreset,
  type MidiFxPresetId,
} from "@/utils/midiFxPresets";

const NODE_TYPE_LABELS: Record<MidiFxKind, string> = {
  "scale-snap":     "Scale-Snap",
  "velocity-curve": "Velocity-Curve",
  "octave-shift":   "Octave-Shift",
  "chord-expander": "Chord-Expander",
  "note-repeat":    "Note-Repeat",
  "pitch-sweep":    "Pitch-Sweep",
};

const NODE_TYPE_ICONS: Record<MidiFxKind, string> = {
  "scale-snap":     "♪",
  "velocity-curve": "↗",
  "octave-shift":   "⇅",
  "chord-expander": "♫",
  "note-repeat":    "↻",
  "pitch-sweep":    "～",
};

const ROOT_LABELS = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

export interface MidiFxPanelProps {
  /** Optional: kompakter Modus (kleinerer Header für Sidebar-Integration). */
  compact?: boolean;
}

export function MidiFxPanel({ compact = false }: MidiFxPanelProps): React.ReactElement {
  const state = useMidiFxStore();
  const [addOpen, setAddOpen] = useState(false);

  const chainFull = state.chain.length >= MAX_MIDI_FX_CHAIN;

  return (
    <div
      className="flex flex-col gap-3 p-3 bg-bg-panel border border-border-color rounded"
      data-testid="midi-fx-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={compact ? "text-sm font-semibold text-text-primary" : "text-base font-semibold text-text-primary"}>
            MIDI-FX
          </span>
          <span className="text-xs text-text-dim tabular-nums">
            {state.chain.length}/{MAX_MIDI_FX_CHAIN}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <PresetDropdown />
          <AddNodeButton disabled={chainFull} open={addOpen} onToggle={setAddOpen} />
          {state.chain.length > 0 && (
            <button
              type="button"
              onClick={() => clearChain()}
              className="text-xs px-2 py-1 rounded border border-border-subtle text-text-muted hover:bg-bg-elevated hover:text-text-primary transition-colors"
              data-testid="midi-fx-clear"
              title="Chain leeren"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Chain */}
      {state.chain.length === 0 ? (
        <div
          className="px-3 py-6 text-center text-sm text-text-dim border border-dashed border-border-subtle rounded"
          data-testid="midi-fx-empty"
        >
          Noch keine MIDI-FX. Klick „+ Add" um anzufangen.
        </div>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="midi-fx-chain">
          {state.chain.map((node, index) => (
            <li key={node.id} data-testid={`midi-fx-node-${node.id}`}>
              <NodeCard
                node={node}
                index={index}
                isFirst={index === 0}
                isLast={index === state.chain.length - 1}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Preset-Dropdown (v3.94.0) ───────────────────────────────────────────────

/**
 * Native `<select>` mit Placeholder-Option. Bei Auswahl: lade die
 * Preset-Chain in den Store (ersetzt aktuelle Chain via setAllNodes).
 */
function PresetDropdown(): React.ReactElement {
  return (
    <select
      defaultValue=""
      onChange={(e) => {
        const id = e.target.value as MidiFxPresetId | "";
        if (!id) return;
        const chain = loadPreset(id);
        setAllNodes(chain);
        // Reset zurück auf Placeholder, damit der User dasselbe Preset
        // erneut anwählen kann (z.B. nach manueller Bearbeitung).
        e.target.value = "";
      }}
      className="text-xs px-2 py-1 rounded border border-border-subtle bg-bg-elevated text-text-primary hover:border-accent-primary transition-colors"
      data-testid="midi-fx-preset-select"
      title="Built-In Preset laden (ersetzt aktuelle Chain)"
    >
      <option value="" disabled>
        Load Preset…
      </option>
      {MIDI_FX_PRESETS.map((p) => (
        <option key={p.id} value={p.id} title={p.description}>
          {p.label}
        </option>
      ))}
    </select>
  );
}

// ─── Add-Node-Button ─────────────────────────────────────────────────────────

function AddNodeButton({
  disabled,
  open,
  onToggle,
}: {
  disabled: boolean;
  open: boolean;
  onToggle: (next: boolean) => void;
}): React.ReactElement {
  const kinds = useMemo<MidiFxKind[]>(
    () => [
      "scale-snap",
      "velocity-curve",
      "octave-shift",
      "chord-expander",
      "note-repeat",
      "pitch-sweep",
    ],
    [],
  );
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onToggle(!open)}
        className={
          "text-xs px-2 py-1 rounded border transition-colors " +
          (disabled
            ? "border-border-subtle text-text-dim cursor-not-allowed"
            : "border-accent-success/50 text-accent-success hover:bg-accent-success/10")
        }
        data-testid="midi-fx-add-toggle"
        title={disabled ? `Max ${MAX_MIDI_FX_CHAIN} Nodes` : "Neuen MIDI-FX-Node hinzufügen"}
      >
        + Add
      </button>
      {open && !disabled && (
        <div
          className="absolute right-0 top-full mt-1 bg-bg-elevated border border-border-color rounded shadow-lg z-10 min-w-[180px]"
          data-testid="midi-fx-add-menu"
        >
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                addNode(k);
                onToggle(false);
              }}
              className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-bg-panel first:rounded-t-md last:rounded-b-md flex items-center gap-2"
              data-testid={`midi-fx-add-${k}`}
            >
              <span className="text-text-muted w-4 text-center">{NODE_TYPE_ICONS[k]}</span>
              <span>{NODE_TYPE_LABELS[k]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Node-Card ───────────────────────────────────────────────────────────────

function NodeCard({
  node,
  index,
  isFirst,
  isLast,
}: {
  node: MidiFxNode;
  index: number;
  isFirst: boolean;
  isLast: boolean;
}): React.ReactElement {
  const bypassed = !!node.bypass;
  return (
    <div
      className={
        "rounded border p-2 flex flex-col gap-2 transition-opacity " +
        (bypassed
          ? "border-border-subtle bg-bg-base opacity-60"
          : "border-border-color bg-bg-elevated")
      }
    >
      {/* Header-Row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-text-muted w-4 text-center" aria-hidden>
            {NODE_TYPE_ICONS[node.kind]}
          </span>
          <span className="text-sm text-text-primary truncate">
            {NODE_TYPE_LABELS[node.kind]}
          </span>
          <span className="text-[10px] text-text-dim tabular-nums">#{index + 1}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={isFirst}
            onClick={() => moveNode(index, index - 1)}
            className="text-xs px-1.5 py-0.5 rounded text-text-muted hover:bg-bg-panel hover:text-text-primary disabled:opacity-30 disabled:hover:bg-transparent"
            data-testid={`midi-fx-up-${node.id}`}
            title="Nach oben"
          >
            ▲
          </button>
          <button
            type="button"
            disabled={isLast}
            onClick={() => moveNode(index, index + 1)}
            className="text-xs px-1.5 py-0.5 rounded text-text-muted hover:bg-bg-panel hover:text-text-primary disabled:opacity-30 disabled:hover:bg-transparent"
            data-testid={`midi-fx-down-${node.id}`}
            title="Nach unten"
          >
            ▼
          </button>
          <button
            type="button"
            onClick={() => setNodeBypass(node.id, !bypassed)}
            className={
              "text-xs px-2 py-0.5 rounded border transition-colors " +
              (bypassed
                ? "border-border-subtle text-text-dim"
                : "border-accent-success/50 text-accent-success hover:bg-accent-success/10")
            }
            data-testid={`midi-fx-bypass-${node.id}`}
            title={bypassed ? "Aktivieren" : "Bypass"}
          >
            {bypassed ? "off" : "on"}
          </button>
          <button
            type="button"
            onClick={() => removeNode(node.id)}
            className="text-xs px-1.5 py-0.5 rounded text-accent-danger hover:bg-accent-danger/10"
            data-testid={`midi-fx-remove-${node.id}`}
            title="Entfernen"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Params */}
      <NodeParams node={node} />
    </div>
  );
}

// ─── Per-Node Params ─────────────────────────────────────────────────────────

function NodeParams({ node }: { node: MidiFxNode }): React.ReactElement | null {
  switch (node.kind) {
    case "scale-snap":
      return <ScaleSnapParams node={node} />;
    case "velocity-curve":
      return <VelocityCurveParams node={node} />;
    case "octave-shift":
      return <OctaveShiftParams node={node} />;
    case "chord-expander":
      return <ChordExpanderParams node={node} />;
    case "note-repeat":
      return <NoteRepeatParams node={node} />;
    case "pitch-sweep":
      return <PitchSweepParams node={node} />;
    default:
      return null;
  }
}

function ScaleSnapParams({
  node,
}: {
  node: Extract<MidiFxNode, { kind: "scale-snap" }>;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-text-muted">Scale</label>
      <select
        value={node.scale}
        onChange={(e) => updateNode(node.id, { scale: e.target.value as MidiScaleName } as Partial<MidiFxNode>)}
        className="text-xs bg-bg-base border border-border-subtle rounded px-1.5 py-0.5 text-text-primary"
        data-testid={`midi-fx-scale-${node.id}`}
      >
        <option value="major">Major</option>
        <option value="minor">Minor</option>
        <option value="penta">Pentatonic</option>
      </select>
      <label className="text-xs text-text-muted ml-2">Root</label>
      <select
        value={node.root}
        onChange={(e) => updateNode(node.id, { root: Number(e.target.value) } as Partial<MidiFxNode>)}
        className="text-xs bg-bg-base border border-border-subtle rounded px-1.5 py-0.5 text-text-primary"
        data-testid={`midi-fx-root-${node.id}`}
      >
        {ROOT_LABELS.map((lbl, i) => (
          <option key={lbl} value={i}>
            {lbl}
          </option>
        ))}
      </select>
    </div>
  );
}

function VelocityCurveParams({
  node,
}: {
  node: Extract<MidiFxNode, { kind: "velocity-curve" }>;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <label className="text-xs text-text-muted">Curve</label>
      <select
        value={node.curve}
        onChange={(e) => updateNode(node.id, { curve: e.target.value as VelocityCurveShape } as Partial<MidiFxNode>)}
        className="text-xs bg-bg-base border border-border-subtle rounded px-1.5 py-0.5 text-text-primary"
        data-testid={`midi-fx-curve-${node.id}`}
      >
        <option value="linear">Linear</option>
        <option value="exp">Exponential</option>
        <option value="log">Logarithmic</option>
      </select>
      <label className="text-xs text-text-muted ml-2">Amount</label>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={node.amount}
        onChange={(e) => updateNode(node.id, { amount: Number(e.target.value) } as Partial<MidiFxNode>)}
        className="flex-1 min-w-[80px]"
        data-testid={`midi-fx-amount-${node.id}`}
      />
      <span className="text-xs text-text-dim tabular-nums w-10 text-right">
        {(node.amount * 100).toFixed(0)}%
      </span>
    </div>
  );
}

function OctaveShiftParams({
  node,
}: {
  node: Extract<MidiFxNode, { kind: "octave-shift" }>;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <label className="text-xs text-text-muted">Semitones</label>
      <input
        type="range"
        min={-24}
        max={24}
        step={1}
        value={node.semitones}
        onChange={(e) => updateNode(node.id, { semitones: Number(e.target.value) } as Partial<MidiFxNode>)}
        className="flex-1 min-w-[100px]"
        data-testid={`midi-fx-semitones-${node.id}`}
      />
      <span className="text-xs text-text-dim tabular-nums w-12 text-right">
        {node.semitones > 0 ? `+${node.semitones}` : `${node.semitones}`}
      </span>
    </div>
  );
}

function ChordExpanderParams({
  node,
}: {
  node: Extract<MidiFxNode, { kind: "chord-expander" }>;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-text-muted">Chord</label>
      <select
        value={node.chordType}
        onChange={(e) => updateNode(node.id, { chordType: e.target.value as ChordExpanderType } as Partial<MidiFxNode>)}
        className="text-xs bg-bg-base border border-border-subtle rounded px-1.5 py-0.5 text-text-primary"
        data-testid={`midi-fx-chord-${node.id}`}
      >
        <option value="major">Major (1-3-5)</option>
        <option value="minor">Minor (1-♭3-5)</option>
        <option value="7th">7th (1-3-5-♭7)</option>
      </select>
    </div>
  );
}

function NoteRepeatParams({
  node,
}: {
  node: Extract<MidiFxNode, { kind: "note-repeat" }>;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <label className="text-xs text-text-muted">Rate</label>
      <select
        value={node.rate}
        onChange={(e) => updateNode(node.id, { rate: e.target.value as NoteRepeatRate } as Partial<MidiFxNode>)}
        className="text-xs bg-bg-base border border-border-subtle rounded px-1.5 py-0.5 text-text-primary"
        data-testid={`midi-fx-rate-${node.id}`}
      >
        <option value="1/8">1/8</option>
        <option value="1/16">1/16</option>
        <option value="1/32">1/32</option>
      </select>
      <label className="text-xs text-text-muted ml-2">Count</label>
      <input
        type="number"
        min={2}
        max={8}
        step={1}
        value={node.count}
        onChange={(e) => updateNode(node.id, { count: Number(e.target.value) } as Partial<MidiFxNode>)}
        className="text-xs w-14 bg-bg-base border border-border-subtle rounded px-1.5 py-0.5 text-text-primary"
        data-testid={`midi-fx-count-${node.id}`}
      />
    </div>
  );
}

function PitchSweepParams({
  node,
}: {
  node: Extract<MidiFxNode, { kind: "pitch-sweep" }>;
}): React.ReactElement {
  // Live-Preview: generierte Event-Liste auf C4 (60) berechnen.
  const preview = useMemo(() => {
    const events = applyMidiFx(
      { note: 60, velocity: 100, channel: 1 },
      [node],
    );
    return events;
  }, [
    node.semitones,
    node.steps,
    node.direction,
    node.curve,
    node.stepRate,
    node.bypass,
  ]);

  return (
    <div className="flex flex-col gap-2">
      {/* Semitones */}
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs text-text-muted">Range</label>
        <input
          type="range"
          min={-24}
          max={24}
          step={1}
          value={node.semitones}
          onChange={(e) =>
            updateNode(node.id, { semitones: Number(e.target.value) } as Partial<MidiFxNode>)
          }
          className="flex-1 min-w-[100px]"
          data-testid={`midi-fx-sweep-semitones-${node.id}`}
        />
        <span className="text-xs text-text-dim tabular-nums w-12 text-right">
          {node.semitones > 0 ? `+${node.semitones}` : `${node.semitones}`} st
        </span>
      </div>

      {/* Steps */}
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs text-text-muted">Steps</label>
        <input
          type="number"
          min={4}
          max={32}
          step={1}
          value={node.steps}
          onChange={(e) =>
            updateNode(node.id, { steps: Number(e.target.value) } as Partial<MidiFxNode>)
          }
          className="text-xs w-14 bg-bg-base border border-border-subtle rounded px-1.5 py-0.5 text-text-primary"
          data-testid={`midi-fx-sweep-steps-${node.id}`}
        />
        <label className="text-xs text-text-muted ml-2">Rate</label>
        <select
          value={node.stepRate}
          onChange={(e) =>
            updateNode(node.id, {
              stepRate: e.target.value as PitchSweepStepRate,
            } as Partial<MidiFxNode>)
          }
          className="text-xs bg-bg-base border border-border-subtle rounded px-1.5 py-0.5 text-text-primary"
          data-testid={`midi-fx-sweep-rate-${node.id}`}
        >
          <option value="1/8">1/8</option>
          <option value="1/16">1/16</option>
          <option value="1/32">1/32</option>
        </select>
      </div>

      {/* Direction + Curve */}
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs text-text-muted">Dir</label>
        <div className="flex items-center gap-0.5" data-testid={`midi-fx-sweep-direction-${node.id}`}>
          {(["up", "down", "updown"] as PitchSweepDirection[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() =>
                updateNode(node.id, { direction: d } as Partial<MidiFxNode>)
              }
              className={
                "text-xs px-2 py-0.5 rounded border transition-colors " +
                (node.direction === d
                  ? "border-accent-primary text-accent-primary bg-accent-primary/10"
                  : "border-border-subtle text-text-muted hover:bg-bg-panel")
              }
              data-testid={`midi-fx-sweep-dir-${d}-${node.id}`}
            >
              {d === "up" ? "↑" : d === "down" ? "↓" : "↕"}
            </button>
          ))}
        </div>
        <label className="text-xs text-text-muted ml-2">Curve</label>
        <select
          value={node.curve}
          onChange={(e) =>
            updateNode(node.id, { curve: e.target.value as PitchSweepCurve } as Partial<MidiFxNode>)
          }
          className="text-xs bg-bg-base border border-border-subtle rounded px-1.5 py-0.5 text-text-primary"
          data-testid={`midi-fx-sweep-curve-${node.id}`}
        >
          <option value="linear">Linear</option>
          <option value="exp">Exp</option>
          <option value="log">Log</option>
        </select>
      </div>

      {/* Live-Preview: Event-List */}
      <div
        className="text-[10px] text-text-dim font-mono leading-tight border-t border-border-subtle pt-1 mt-1"
        data-testid={`midi-fx-sweep-preview-${node.id}`}
      >
        <span className="text-text-muted">Preview (C4 = 60):</span>{" "}
        <span className="tabular-nums">
          {preview.slice(0, 16).map((ev, i) => (
            <span key={i}>
              {i > 0 ? " → " : ""}
              {ev.note}
            </span>
          ))}
          {preview.length > 16 ? ` … (+${preview.length - 16})` : ""}
        </span>
      </div>
    </div>
  );
}

export default MidiFxPanel;
