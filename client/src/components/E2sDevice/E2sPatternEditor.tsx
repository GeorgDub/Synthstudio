/**
 * E2sPatternEditor — Feld-Editor für den gepullten Edit-Buffer eines E2/E2S.
 *
 * Bearbeitet NUR verifizierte Felder (Pattern-Name/BPM, Part vol/pan/sampleRef,
 * Step active/note/velocity/gate/gateLen) nicht-destruktiv über e2PatternEdit.ts.
 * Jede Änderung erzeugt einen neuen Body → applyCurrentBodyEdit hält Store +
 * Decode aktuell → „Zum Gerät schreiben" pusht den Edit-Buffer (nur bei
 * gestopptem Sequencer). Opake/unbekannte Bytes (inkl. Motion) bleiben erhalten.
 */
import { useState } from "react";
import { Save, RefreshCw, RotateCcw, RotateCw } from "lucide-react";
import { useE2sDeviceStore } from "@/store/useE2sDeviceStore";
import {
  setStepField,
  setPartField,
  setPatternBpm,
  setPatternName,
  rotatePartSequence,
  type StepField,
} from "@/utils/korg/e2PatternEdit";

export function E2sPatternEditor() {
  const device = useE2sDeviceStore();
  const [part, setPart] = useState(0);
  const [step, setStep] = useState(0);

  const body = device.currentBody;
  const dec = device.currentDecoded;
  if (device.status !== "connected" || !body || !dec) return null;

  const edit = (next: Uint8Array) => device.applyCurrentBodyEdit(next);
  const p = dec.parts[part];
  const s = p?.steps[step];

  const setStepF = (field: StepField, value: number) =>
    edit(setStepField(body, part, step, field, value));

  return (
    <div
      className="p-3 bg-bg-elevated rounded-lg border border-accent-secondary/40 space-y-2"
      data-testid="e2s-pattern-editor"
    >
      <div className="text-sm font-medium text-text-primary">
        Edit-Buffer bearbeiten{" "}
        <span className="text-[10px] text-text-dim">
          (verifizierte Felder · nicht-destruktiv)
        </span>
      </div>

      {/* Pattern-Kopf */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          data-testid="e2s-pat-name"
          type="text"
          maxLength={16}
          value={dec.name}
          onChange={e => edit(setPatternName(body, e.target.value))}
          className="flex-1 min-w-32 text-xs px-1.5 py-1 rounded bg-bg-base border border-border-color text-text-primary"
          aria-label="Pattern-Name"
        />
        <label className="text-[10px] text-text-dim">BPM</label>
        <input
          data-testid="e2s-pat-bpm"
          type="number"
          min={20}
          max={300}
          step={0.1}
          value={dec.bpm}
          onChange={e => edit(setPatternBpm(body, Number(e.target.value) || 0))}
          className="w-20 text-xs px-1.5 py-1 rounded bg-bg-base border border-border-color text-text-primary"
        />
      </div>

      {/* Part-Auswahl + Felder */}
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="text-[10px] text-text-dim">Part</label>
        <select
          data-testid="e2s-pat-part"
          value={part}
          onChange={e => {
            setPart(Number(e.target.value));
            setStep(0);
          }}
          className="text-xs px-1.5 py-1 rounded bg-bg-base border border-border-color text-text-primary"
        >
          {dec.parts.map((_, i) => (
            <option key={i} value={i}>
              Part {i + 1}
            </option>
          ))}
        </select>
        <span className="text-[10px] text-text-dim">
          {p?.activeCount ?? 0} aktiv · Osc {p?.sampleRef ?? 0}
        </span>
        <div className="flex items-center gap-0.5 ml-auto">
          <span className="text-[10px] text-text-dim">Seq</span>
          <button
            data-testid="e2s-seq-rot-left"
            onClick={() =>
              edit(rotatePartSequence(body, part, 1, dec.stepLength))
            }
            title="Sequenz um 1 Step nach links rotieren"
            className="p-1 rounded bg-bg-base text-text-muted hover:text-text-primary transition-colors"
          >
            <RotateCcw size={12} />
          </button>
          <button
            data-testid="e2s-seq-rot-right"
            onClick={() =>
              edit(rotatePartSequence(body, part, -1, dec.stepLength))
            }
            title="Sequenz um 1 Step nach rechts rotieren"
            className="p-1 rounded bg-bg-base text-text-muted hover:text-text-primary transition-colors"
          >
            <RotateCw size={12} />
          </button>
        </div>
      </div>

      {p && (
        <div className="grid grid-cols-3 gap-2">
          <NumField
            label="Volume"
            testId="e2s-part-vol"
            value={p.volume}
            max={127}
            onChange={v => edit(setPartField(body, part, "volume", v))}
          />
          <NumField
            label="Pan"
            testId="e2s-part-pan"
            value={p.pan}
            max={127}
            onChange={v => edit(setPartField(body, part, "pan", v))}
          />
          <NumField
            label="Osc/Sample"
            testId="e2s-part-osc"
            value={p.sampleRef}
            max={9999}
            onChange={v => edit(setPartField(body, part, "sampleRef", v))}
          />
        </div>
      )}

      {/* Step-Grid */}
      {p && (
        <div className="space-y-1.5">
          <div
            className="grid gap-0.5"
            style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}
            data-testid="e2s-step-grid"
          >
            {p.steps.map((st, i) => (
              <button
                key={i}
                data-testid={`e2s-step-${i}`}
                onClick={() => {
                  setStep(i);
                  edit(
                    setStepField(body, part, i, "active", st.active ? 0 : 1)
                  );
                }}
                onContextMenu={e => {
                  e.preventDefault();
                  setStep(i);
                }}
                title={`Step ${i + 1} (Rechtsklick: nur auswählen)`}
                className={`h-5 rounded-sm text-[8px] transition-colors ${
                  st.active
                    ? "bg-accent-primary text-text-primary"
                    : "bg-bg-base text-text-dim hover:bg-bg-panel"
                } ${step === i ? "ring-1 ring-accent-secondary" : ""}`}
              >
                {i + 1}
              </button>
            ))}
          </div>

          {s && (
            <div
              className="grid grid-cols-3 gap-2"
              data-testid="e2s-step-detail"
            >
              <NumField
                label={`Step ${step + 1} Note`}
                testId="e2s-step-note"
                value={s.note}
                max={127}
                onChange={v => setStepF("note", v)}
              />
              <NumField
                label="Velocity"
                testId="e2s-step-vel"
                value={s.velocity}
                max={127}
                onChange={v => setStepF("velocity", v)}
              />
              <NumField
                label="Gate-Len"
                testId="e2s-step-gatelen"
                value={s.gateLen}
                max={255}
                onChange={v => setStepF("gateLen", v)}
              />
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1 border-t border-border-color">
        <button
          data-testid="e2s-pat-write"
          disabled={device.busy}
          onClick={() => device.pushCurrent(body)}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-accent-primary text-text-primary disabled:opacity-50 hover:opacity-90 transition-opacity"
          title="Edit-Buffer ins Gerät schreiben (nur bei gestopptem Sequencer)"
        >
          {device.busy ? (
            <RefreshCw size={12} className="animate-spin" />
          ) : (
            <Save size={12} />
          )}
          Zum Gerät schreiben
        </button>
        <span className="text-[10px] text-text-dim">
          Schreibt den Edit-Buffer (0x40). Nur bei gestopptem Sequencer.
        </span>
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  max,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (v: number) => void;
  testId?: string;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] text-text-dim truncate" title={label}>
        {label}
      </span>
      <input
        data-testid={testId}
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={e => onChange(Number(e.target.value) || 0)}
        className="text-xs px-1.5 py-1 rounded bg-bg-base border border-border-color text-text-primary"
      />
    </label>
  );
}
