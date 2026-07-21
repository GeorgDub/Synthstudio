/**
 * E2sPresetEditor — Feld-Editor für ein device-gelesenes IFX-Preset (0x20C) oder
 * Groove-Template (0x140) Backup.
 *
 * Anders als der Blob-Restore-Weg erlaubt dieser Editor gezieltes Ändern
 * *bekannter* Offsets (FX-Param, pre/post-Level, Name / Groove-Step trigger,
 * velocity, gate) — nicht-destruktiv über e2FxPreset.ts. Alle unbekannten Bytes
 * bleiben exakt erhalten, weil die Basis vom Gerät gelesen wurde.
 *
 * Fluss: Backup dekodieren → benannte Slider → jede Änderung erzeugt neue Bytes
 * (setter-Kopie) → updateBackupBytes hält das Backup aktuell → "In Slot
 * schreiben" persistiert über die Bridge (nur bei gestopptem Sequencer).
 */
import { useMemo, useState } from "react";
import { Save, X } from "lucide-react";
import {
  type PresetBackup,
  useE2sPresetStore,
} from "@/store/useE2sPresetStore";
import {
  decodeIfxPreset,
  setIfxPresetParam,
  setIfxPresetLevel,
  setIfxPresetName,
  decodeGroove,
  setGrooveStep,
  GROOVE_STEP_COUNT,
  type PresetSlotRole,
  type GrooveStep,
} from "@/utils/korg/e2FxPreset";

function Slider({
  label,
  value,
  min,
  max,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  testId?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="text-[10px] text-text-muted w-28 shrink-0 truncate"
        title={label}
      >
        {label}
      </span>
      <input
        data-testid={testId}
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 accent-accent-primary"
      />
      <span className="text-[10px] text-text-dim w-8 text-right tabular-nums">
        {value}
      </span>
    </div>
  );
}

function IfxEditor({ backup }: { backup: PresetBackup }) {
  const preset = useE2sPresetStore();
  const decoded = useMemo(() => decodeIfxPreset(backup.bytes), [backup.bytes]);

  const apply = (next: Uint8Array) => preset.updateBackupBytes(backup.id, next);

  return (
    <div className="space-y-2" data-testid="e2s-ifx-editor">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-text-muted w-28 shrink-0">Name</span>
        <input
          data-testid="e2s-ifx-name"
          type="text"
          maxLength={15}
          value={decoded.name}
          onChange={e => apply(setIfxPresetName(backup.bytes, e.target.value))}
          className="flex-1 text-xs px-1.5 py-1 rounded bg-bg-base border border-border-color text-text-primary"
        />
      </div>
      {decoded.slots.map(slot => (
        <div
          key={slot.role}
          className="p-2 rounded bg-bg-base border border-border-color space-y-1.5"
          data-testid={`e2s-ifx-slot-${slot.role}`}
        >
          <div className="text-[11px] font-medium text-text-primary">
            {slot.role.toUpperCase()} ·{" "}
            <span className="text-accent-primary">{slot.deviceName}</span>
          </div>
          <Slider
            label="pre level"
            value={slot.preLevel}
            min={0}
            max={127}
            onChange={v =>
              apply(setIfxPresetLevel(backup.bytes, slot.role, "pre", v))
            }
            testId={`e2s-ifx-${slot.role}-pre`}
          />
          <Slider
            label="post level"
            value={slot.postLevel}
            min={0}
            max={127}
            onChange={v =>
              apply(setIfxPresetLevel(backup.bytes, slot.role, "post", v))
            }
            testId={`e2s-ifx-${slot.role}-post`}
          />
          {slot.paramNames.length === 0 ? (
            <div className="text-[10px] text-text-dim">
              Keine editierbaren Parameter für diesen FX-Typ.
            </div>
          ) : (
            slot.paramNames.map((name, i) => (
              <Slider
                key={i}
                label={name}
                value={slot.params[i] ?? 0}
                min={0}
                max={127}
                onChange={v =>
                  apply(
                    setIfxPresetParam(
                      backup.bytes,
                      slot.role as PresetSlotRole,
                      i,
                      v
                    )
                  )
                }
                testId={`e2s-ifx-${slot.role}-p${i}`}
              />
            ))
          )}
        </div>
      ))}
    </div>
  );
}

function GrooveEditor({ backup }: { backup: PresetBackup }) {
  const preset = useE2sPresetStore();
  const decoded = useMemo(() => decodeGroove(backup.bytes), [backup.bytes]);
  const [step, setStep] = useState(0);
  const s: GrooveStep = decoded.steps[step] ?? {
    trigger: 0,
    velocity: 0,
    gate: 0,
  };

  const apply = (field: keyof GrooveStep, v: number) =>
    preset.updateBackupBytes(
      backup.id,
      setGrooveStep(backup.bytes, step, field, v)
    );

  return (
    <div className="space-y-2" data-testid="e2s-groove-editor">
      <div className="text-[10px] text-text-muted">
        Groove „{decoded.name || "—"}" · Länge {decoded.length}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-text-muted w-28 shrink-0">
          Step (0–{GROOVE_STEP_COUNT - 1})
        </span>
        <input
          data-testid="e2s-groove-step"
          type="number"
          min={0}
          max={GROOVE_STEP_COUNT - 1}
          value={step}
          onChange={e =>
            setStep(
              Math.max(
                0,
                Math.min(GROOVE_STEP_COUNT - 1, Number(e.target.value) || 0)
              )
            )
          }
          className="w-16 text-xs px-1.5 py-1 rounded bg-bg-base border border-border-color text-text-primary"
        />
      </div>
      <Slider
        label="trigger (µtiming)"
        value={s.trigger}
        min={-0x30}
        max={0x30}
        onChange={v => apply("trigger", v)}
        testId="e2s-groove-trigger"
      />
      <Slider
        label="velocity"
        value={s.velocity}
        min={0}
        max={127}
        onChange={v => apply("velocity", v)}
        testId="e2s-groove-velocity"
      />
      <Slider
        label="gate"
        value={s.gate}
        min={0}
        max={0x60}
        onChange={v => apply("gate", v)}
        testId="e2s-groove-gate"
      />
    </div>
  );
}

export function E2sPresetEditor({
  backup,
  onClose,
}: {
  backup: PresetBackup;
  onClose: () => void;
}) {
  const preset = useE2sPresetStore();
  const [target, setTarget] = useState(backup.index);
  const max = backup.kind === "ifx" ? 99 : 127;

  return (
    <div
      className="p-2 rounded bg-bg-elevated border border-accent-primary/50 space-y-2"
      data-testid="e2s-preset-editor"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-primary">
          Editor · {backup.kind.toUpperCase()} Slot {backup.index}
        </span>
        <button
          data-testid="e2s-editor-close"
          onClick={onClose}
          className="text-text-dim hover:text-text-primary transition-colors"
          aria-label="Editor schließen"
        >
          <X size={14} />
        </button>
      </div>

      {backup.kind === "ifx" ? (
        <IfxEditor backup={backup} />
      ) : (
        <GrooveEditor backup={backup} />
      )}

      <div className="flex items-center gap-1.5 pt-1 border-t border-border-color">
        <span className="text-[10px] text-text-dim">In Slot</span>
        <input
          data-testid="e2s-editor-target"
          type="number"
          min={0}
          max={max}
          value={target}
          onChange={e =>
            setTarget(Math.max(0, Math.min(max, Number(e.target.value) || 0)))
          }
          className="w-14 text-xs px-1.5 py-0.5 rounded bg-bg-base border border-border-color text-text-primary"
          aria-label="Ziel-Slot"
        />
        <button
          data-testid="e2s-editor-write"
          disabled={preset.busy}
          onClick={() => preset.writeBytes(backup.kind, target, backup.bytes)}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-accent-primary text-text-primary disabled:opacity-50 hover:opacity-90 transition-opacity"
          title="Editierte Bytes ins Gerät schreiben (nur bei gestopptem Sequencer)"
        >
          <Save size={12} /> Schreiben
        </button>
      </div>
    </div>
  );
}
