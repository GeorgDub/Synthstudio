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
  setIfxPresetDevice,
  decodeGroove,
  setGrooveStep,
  decodePresetControlMap,
  setPresetControlSlot,
  PRESET_CONTROL_MAP_SLOTS,
  PRESET_FX_SOURCES,
  PRESET_CHAIN_INDEX,
  GROOVE_STEP_COUNT,
  type PresetSlotRole,
  type GrooveStep,
  type IfxPresetDecoded,
} from "@/utils/korg/e2FxPreset";
import { IFX_TYPES, MFX_TYPES } from "@/utils/korg/e2FxParams";

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
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-text-primary">
              {slot.role.toUpperCase()}
            </span>
            <select
              data-testid={`e2s-ifx-${slot.role}-device`}
              value={slot.device}
              onChange={e =>
                apply(
                  setIfxPresetDevice(
                    backup.bytes,
                    slot.role,
                    Number(e.target.value)
                  )
                )
              }
              className="flex-1 text-[11px] px-1 py-0.5 rounded bg-bg-elevated border border-border-color text-accent-primary"
            >
              {Object.entries(slot.role === "mfx" ? MFX_TYPES : IFX_TYPES).map(
                ([id, def]) => (
                  <option key={id} value={id}>
                    {def.name}
                  </option>
                )
              )}
            </select>
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
      <PresetControlMapEditor backup={backup} decoded={decoded} apply={apply} />
    </div>
  );
}

/** Ziel-Param-Namen je chain_index (welches Kettenglied). */
function targetParamsForChain(
  decoded: IfxPresetDecoded,
  chainIndex: number
): string[] {
  if (chainIndex === 0x00) return decoded.slots[0].paramNames; // IFX 1
  if (chainIndex === 0x01) return decoded.slots[1].paramNames; // IFX 2
  if (chainIndex === 0x02) return decoded.slots[2].paramNames; // MFX
  return []; // Input/Output Level → kein Param-Index
}

function PresetControlMapEditor({
  backup,
  decoded,
  apply,
}: {
  backup: PresetBackup;
  decoded: IfxPresetDecoded;
  apply: (next: Uint8Array) => void;
}) {
  const [slotIdx, setSlotIdx] = useState(0);
  const map = useMemo(
    () => decodePresetControlMap(backup.bytes),
    [backup.bytes]
  );
  const slot = map[slotIdx];
  const targetNames = targetParamsForChain(decoded, slot.chainIndex);

  const write = (patch: Partial<typeof slot>) =>
    apply(setPresetControlSlot(backup.bytes, slotIdx, { ...slot, ...patch }));

  return (
    <div
      className="p-2 rounded bg-bg-base border border-border-color space-y-1.5"
      data-testid="e2s-preset-controlmap"
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-medium text-text-primary">
          Control-Map
        </span>
        <span className="text-[10px] text-text-dim">
          (persistent im Preset)
        </span>
        <select
          data-testid="e2s-pcmap-slot"
          value={slotIdx}
          onChange={e => setSlotIdx(Number(e.target.value))}
          className="ml-auto text-[11px] px-1 py-0.5 rounded bg-bg-elevated border border-border-color text-text-primary"
        >
          {Array.from({ length: PRESET_CONTROL_MAP_SLOTS }, (_, i) => (
            <option key={i} value={i}>
              Slot {i}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-text-muted w-20 shrink-0">
          Source
        </span>
        <select
          data-testid="e2s-pcmap-source"
          value={slot.sourceControl}
          onChange={e => write({ sourceControl: Number(e.target.value) })}
          className="flex-1 text-[11px] px-1 py-0.5 rounded bg-bg-elevated border border-border-color text-text-primary"
        >
          {Object.entries(PRESET_FX_SOURCES).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-text-muted w-20 shrink-0">Chain</span>
        <select
          data-testid="e2s-pcmap-chain"
          value={slot.chainIndex}
          onChange={e => write({ chainIndex: Number(e.target.value) })}
          className="flex-1 text-[11px] px-1 py-0.5 rounded bg-bg-elevated border border-border-color text-text-primary"
        >
          {Object.entries(PRESET_CHAIN_INDEX).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-text-muted w-20 shrink-0">
          Ziel-Param
        </span>
        <select
          data-testid="e2s-pcmap-target"
          value={slot.targetParam}
          onChange={e => write({ targetParam: Number(e.target.value) })}
          className="flex-1 text-[11px] px-1 py-0.5 rounded bg-bg-elevated border border-border-color text-text-primary"
        >
          {targetNames.length === 0 ? (
            <option value={slot.targetParam}>—</option>
          ) : (
            targetNames.map((name, i) => (
              <option key={i} value={i}>
                {i}: {name}
              </option>
            ))
          )}
        </select>
      </div>
      <Slider
        label="min"
        value={slot.minValue}
        min={0}
        max={127}
        onChange={v => write({ minValue: v })}
        testId="e2s-pcmap-min"
      />
      <Slider
        label="max"
        value={slot.maxValue}
        min={0}
        max={127}
        onChange={v => write({ maxValue: v })}
        testId="e2s-pcmap-max"
      />
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
      {/* 64-Step-Übersicht: Balkenhöhe ~ Velocity, Farbe markiert Micro-Timing */}
      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}
        data-testid="e2s-groove-grid"
      >
        {decoded.steps.map((gs, i) => {
          const active = gs.velocity > 0 || gs.trigger !== 0 || gs.gate > 0;
          return (
            <button
              key={i}
              data-testid={`e2s-groove-cell-${i}`}
              onClick={() => setStep(i)}
              title={`Step ${i + 1}: trig ${gs.trigger}, vel ${gs.velocity}, gate ${gs.gate}`}
              className={`h-5 rounded-sm text-[7px] leading-none flex items-end justify-center transition-colors ${
                active
                  ? "bg-accent-primary/70 text-text-primary"
                  : "bg-bg-base text-text-dim hover:bg-bg-panel"
              } ${step === i ? "ring-1 ring-accent-secondary" : ""}`}
            >
              {gs.trigger > 0 ? "▸" : gs.trigger < 0 ? "◂" : ""}
            </button>
          );
        })}
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
