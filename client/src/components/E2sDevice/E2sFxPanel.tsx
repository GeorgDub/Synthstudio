/**
 * E2sFxPanel — Live-FX-Steuerung eines E2/hacktribe-Geräts über NRPN.
 *
 * Fluss: Part + IFX-A/B (oder MFX) wählen → "FX lesen" liest den Live-Edit-Buffer
 * (RAM) → FX-Typ + aktuelle Param-Werte → benannte Slider; jede Änderung sendet
 * sofort ein NRPN-FX-Edit ans Gerät. Nur mit hacktribe-Firmware (RAM-Zugriff).
 */
import { useState } from "react";
import { RefreshCw, AlertTriangle, Send } from "lucide-react";
import { useE2sDeviceStore } from "@/store/useE2sDeviceStore";
import { ifxFxSlot, MFX_FX_SLOT } from "@/utils/korg/e2Nrpn";
import {
  fxTypeDef,
  FX_SOURCE_CONTROLS,
  FX_CONTROL_MAP_SLOTS,
  type FxEditBuffer,
} from "@/utils/korg/e2FxParams";

type SlotKind = "ifxA" | "ifxB" | "mfx";

function resolveSlot(part: number, kind: SlotKind): number {
  if (kind === "mfx") return MFX_FX_SLOT;
  return ifxFxSlot(part, kind === "ifxB" ? 1 : 0);
}

/**
 * FX-Control-Map-Editor: konfiguriert einen der 10 Map-Slots (Source → Target-
 * Param, Min/Max) via NRPN. Zeigt die aus dem Live-Buffer dekodierten Slots und
 * lässt einen davon setzen. Nur hacktribe.
 */
function FxControlMapEditor({
  fxSlot,
  buffer,
  paramNames,
}: {
  fxSlot: number;
  buffer: FxEditBuffer;
  paramNames: string[];
}) {
  const device = useE2sDeviceStore();
  const [mapSlot, setMapSlot] = useState(0);
  const current = buffer.controlMap[mapSlot];
  const [source, setSource] = useState(current?.sourceControl ?? 0);
  const [target, setTarget] = useState(current?.targetParam ?? 0);
  const [min, setMin] = useState(current?.minValue ?? 0);
  const [max, setMax] = useState(current?.maxValue ?? 0x7f);

  // Beim Wechsel des Map-Slots die Felder aus dem dekodierten Buffer laden.
  const selectSlot = (n: number) => {
    setMapSlot(n);
    const s = buffer.controlMap[n];
    setSource(s?.sourceControl ?? 0);
    setTarget(s?.targetParam ?? 0);
    setMin(s?.minValue ?? 0);
    setMax(s?.maxValue ?? 0x7f);
  };

  const send = () =>
    device.sendFxControlMapSlot(fxSlot, {
      mapSlot,
      sourceControl: source,
      targetParam: target,
      minValue: min,
      maxValue: max,
    });

  return (
    <div
      className="space-y-1.5 pt-2 border-t border-border-color"
      data-testid="e2s-fx-controlmap"
    >
      <div className="text-xs text-text-muted">
        Control-Map{" "}
        <span className="text-[10px] text-text-dim">
          (XY/Pad → Param, 10 Slots)
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="text-[10px] text-text-dim">Map-Slot</label>
        <select
          data-testid="e2s-cmap-slot"
          value={mapSlot}
          onChange={e => selectSlot(Number(e.target.value))}
          className="text-xs px-1.5 py-1 rounded bg-bg-base border border-border-color text-text-primary"
        >
          {Array.from({ length: FX_CONTROL_MAP_SLOTS }, (_, i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-text-muted w-20 shrink-0">
          Source
        </span>
        <select
          data-testid="e2s-cmap-source"
          value={source}
          onChange={e => setSource(Number(e.target.value))}
          className="flex-1 text-xs px-1.5 py-1 rounded bg-bg-base border border-border-color text-text-primary"
        >
          {Object.entries(FX_SOURCE_CONTROLS).map(([id, name]) => (
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
          data-testid="e2s-cmap-target"
          value={target}
          onChange={e => setTarget(Number(e.target.value))}
          className="flex-1 text-xs px-1.5 py-1 rounded bg-bg-base border border-border-color text-text-primary"
        >
          {paramNames.length === 0 ? (
            <option value={0}>—</option>
          ) : (
            paramNames.map((name, i) => (
              <option key={i} value={i}>
                {i}: {name}
              </option>
            ))
          )}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-text-muted w-20 shrink-0">Min</span>
        <input
          data-testid="e2s-cmap-min"
          type="range"
          min={0}
          max={127}
          value={min}
          onChange={e => setMin(Number(e.target.value))}
          className="flex-1 accent-accent-primary"
        />
        <span className="text-[10px] text-text-dim w-8 text-right tabular-nums">
          {min}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-text-muted w-20 shrink-0">Max</span>
        <input
          data-testid="e2s-cmap-max"
          type="range"
          min={0}
          max={127}
          value={max}
          onChange={e => setMax(Number(e.target.value))}
          className="flex-1 accent-accent-primary"
        />
        <span className="text-[10px] text-text-dim w-8 text-right tabular-nums">
          {max}
        </span>
      </div>
      <button
        data-testid="e2s-cmap-send"
        onClick={send}
        className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-accent-primary text-text-primary hover:opacity-90 transition-opacity"
        title="Map-Slot via NRPN ans Gerät senden"
      >
        <Send size={12} /> Map senden
      </button>
    </div>
  );
}

export function E2sFxPanel() {
  const device = useE2sDeviceStore();
  const [part, setPart] = useState(0);
  const [kind, setKind] = useState<SlotKind>("ifxA");
  const [buffer, setBuffer] = useState<FxEditBuffer | null>(null);
  const [values, setValues] = useState<number[]>([]);
  const [reading, setReading] = useState(false);

  if (device.status !== "connected") return null;

  const fxSlot = resolveSlot(part, kind);
  const isMfx = kind === "mfx";
  const def = buffer ? fxTypeDef(buffer.device, isMfx) : undefined;

  const readFx = async () => {
    setReading(true);
    const buf = await device.readFxBuffer(fxSlot);
    setReading(false);
    setBuffer(buf);
    setValues(buf ? [...buf.params] : []);
  };

  const setParam = (index: number, value: number) => {
    setValues(v => {
      const next = [...v];
      next[index] = value;
      return next;
    });
    device.sendFxParam(fxSlot, index, value);
  };

  return (
    <div
      className="p-3 bg-bg-elevated rounded-lg border border-accent-secondary/40 space-y-2"
      data-testid="e2s-fx-section"
    >
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-text-primary">
          FX Live-Control{" "}
          <span className="text-[10px] text-text-dim">(NRPN · hacktribe)</span>
        </div>
      </div>

      {/* Slot-Auswahl */}
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="text-[10px] text-text-dim">Part</label>
        <input
          data-testid="e2s-fx-part"
          type="number"
          min={1}
          max={16}
          value={part + 1}
          disabled={isMfx}
          onChange={e =>
            setPart(
              Math.max(0, Math.min(15, (Number(e.target.value) || 1) - 1))
            )
          }
          className="w-14 text-xs px-1.5 py-1 rounded bg-bg-base border border-border-color text-text-primary disabled:opacity-40"
        />
        <div className="flex rounded overflow-hidden border border-border-color">
          {(["ifxA", "ifxB", "mfx"] as SlotKind[]).map(k => (
            <button
              key={k}
              data-testid={`e2s-fx-kind-${k}`}
              onClick={() => setKind(k)}
              className={`text-[10px] px-2 py-1 transition-colors ${
                kind === k
                  ? "bg-accent-primary text-text-primary"
                  : "bg-bg-base text-text-muted hover:text-text-primary"
              }`}
            >
              {k === "mfx" ? "MFX" : k === "ifxA" ? "IFX-A" : "IFX-B"}
            </button>
          ))}
        </div>
        <button
          data-testid="e2s-fx-read-btn"
          disabled={reading}
          onClick={readFx}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-bg-base text-text-primary disabled:opacity-50 hover:bg-bg-panel transition-colors"
        >
          <RefreshCw size={12} className={reading ? "animate-spin" : ""} /> FX
          lesen
        </button>
      </div>

      {/* FX-Typ + Slider */}
      {buffer && (
        <div className="space-y-1.5" data-testid="e2s-fx-params">
          <div className="text-xs text-text-muted">
            Slot 0x{fxSlot.toString(16)} ·{" "}
            <span className="text-text-primary font-medium">
              {def?.name ?? `Unknown (0x${buffer.device.toString(16)})`}
            </span>
          </div>
          {!def || def.params.length === 0 ? (
            <div className="text-[10px] text-text-dim">
              Dieser FX-Typ hat keine editierbaren Parameter.
            </div>
          ) : (
            def.params.map((name, i) => (
              <div key={i} className="flex items-center gap-2">
                <span
                  className="text-[10px] text-text-muted w-32 shrink-0 truncate"
                  title={name}
                >
                  {name}
                </span>
                <input
                  data-testid={`e2s-fx-slider-${i}`}
                  type="range"
                  min={0}
                  max={127}
                  value={values[i] ?? 0}
                  onChange={e => setParam(i, Number(e.target.value))}
                  className="flex-1 accent-accent-primary"
                />
                <span className="text-[10px] text-text-dim w-8 text-right tabular-nums">
                  {values[i] ?? 0}
                </span>
              </div>
            ))
          )}
          <FxControlMapEditor
            fxSlot={fxSlot}
            buffer={buffer}
            paramNames={def?.params ?? []}
          />
        </div>
      )}

      <div className="flex items-start gap-1.5 text-[10px] text-text-dim">
        <AlertTriangle
          size={11}
          className="mt-0.5 shrink-0 text-accent-secondary"
        />
        <span>
          Nur hacktribe. Slider senden live NRPN-FX-Edits (0–127). Der FX-Typ
          wird im Preset gesetzt, nicht per NRPN. Wertebereiche sind roh 0–127
          (semantische Min/Max nicht dokumentiert).
        </span>
      </div>
    </div>
  );
}
