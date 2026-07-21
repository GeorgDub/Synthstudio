/**
 * E2sFxPanel — Live-FX-Steuerung eines E2/hacktribe-Geräts über NRPN.
 *
 * Fluss: Part + IFX-A/B (oder MFX) wählen → "FX lesen" liest den Live-Edit-Buffer
 * (RAM) → FX-Typ + aktuelle Param-Werte → benannte Slider; jede Änderung sendet
 * sofort ein NRPN-FX-Edit ans Gerät. Nur mit hacktribe-Firmware (RAM-Zugriff).
 */
import { useState } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { useE2sDeviceStore } from "@/store/useE2sDeviceStore";
import { ifxFxSlot, MFX_FX_SLOT } from "@/utils/korg/e2Nrpn";
import { fxTypeDef, type FxEditBuffer } from "@/utils/korg/e2FxParams";

type SlotKind = "ifxA" | "ifxB" | "mfx";

function resolveSlot(part: number, kind: SlotKind): number {
  if (kind === "mfx") return MFX_FX_SLOT;
  return ifxFxSlot(part, kind === "ifxB" ? 1 : 0);
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
