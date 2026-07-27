/**
 * E2sDevicePanel — Live-Verbindung zu einer echten Korg Electribe 2 / E2S
 * über natives Korg-SysEx (0x42). Connect → Identity → Pattern-Pull.
 *
 * Nutzt `useE2sDeviceStore` (das die `E2SysexBridge` orchestriert). Rein
 * host-seitig, brick-frei. Nur semantische Theme-Klassen (kein hardcoded Hex).
 */
import { useState } from "react";
import {
  RefreshCw,
  Plug,
  Unplug,
  Download,
  Upload,
  AlertTriangle,
  FolderInput,
} from "lucide-react";
import { useE2sDeviceStore } from "@/store/useE2sDeviceStore";
import { useDrumMachineStore } from "@/store/useDrumMachineStore";
import { E2sPatternEditor } from "./E2sPatternEditor";
import { e2PatternToSynthstudio } from "@/utils/korg/e2PatternToSynthstudio";
import { synthstudioPatternToBody } from "@/utils/korg/synthstudioToE2Pattern";
import type { PatternSummary, E2PatternDecoded } from "@/utils/korg/e2Sysex";

function modelName(model: number): string {
  if (model === 0x24) return "Electribe 2 Sampler";
  if (model === 0x23) return "Electribe 2 Synth";
  return `Unknown (0x${model.toString(16)})`;
}

/** Nur belegte Part-Refs (0 = leer) für die kompakte Anzeige. */
function nonEmptyRefs(
  summary: PatternSummary
): { part: number; ref: number }[] {
  return summary.oscRefs
    .map((ref, part) => ({ part, ref }))
    .filter(x => x.ref > 0);
}

function PatternSummaryRow({
  label,
  summary,
  onImport,
}: {
  label: string;
  summary: PatternSummary;
  onImport?: () => void;
}) {
  const refs = nonEmptyRefs(summary);
  return (
    <div
      className="p-2 rounded bg-bg-base border border-border-color"
      data-testid="e2s-pattern-summary"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-muted">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">
            {summary.name || (
              <span className="text-text-dim italic">(ohne Namen)</span>
            )}
          </span>
          {onImport && (
            <button
              data-testid="e2s-import-btn"
              onClick={onImport}
              className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-accent-primary text-text-primary hover:opacity-90 transition-opacity"
              title="Als SynthStudio-Pattern in die DrumMachine importieren"
            >
              <FolderInput size={11} /> Import
            </button>
          )}
        </div>
      </div>
      <div className="mt-0.5 text-[10px] text-text-dim">
        {summary.bpm.toFixed(1)} BPM · {summary.stepLength} Steps ·{" "}
        {summary.totalActive} aktive Trigger
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {refs.length === 0 ? (
          <span className="text-[10px] text-text-dim">
            keine belegten Part-Referenzen
          </span>
        ) : (
          refs.map(({ part, ref }) => (
            <span
              key={part}
              className="text-[10px] px-1.5 py-0.5 rounded bg-bg-elevated text-text-muted"
              title={`Part ${part + 1} → Sample/OSC ${ref}`}
            >
              P{part + 1}:{ref}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

export function E2sDevicePanel() {
  const device = useE2sDeviceStore();
  const dm = useDrumMachineStore();
  const [slot, setSlot] = useState(0);

  const connected = device.status === "connected";
  const connecting = device.status === "connecting";

  const importDecoded = (
    decoded: E2PatternDecoded | undefined,
    fallbackName: string
  ) => {
    if (!decoded) return;
    dm.addPatternData(e2PatternToSynthstudio(decoded, { fallbackName }));
  };

  const pushActive = (target: "current" | "slot") => {
    const pattern = dm.getActivePattern();
    if (!pattern) return;
    const body = synthstudioPatternToBody(pattern);
    if (target === "current") device.pushCurrent(body);
    else device.push(slot, body);
  };

  return (
    <div
      className="p-3 bg-bg-elevated rounded-lg border border-accent-secondary/40 space-y-3"
      data-testid="e2s-device-section"
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-text-primary">
            Electribe 2 — Live (SysEx){" "}
            <span className="text-[10px] text-text-dim">
              (natives Korg-0x42)
            </span>
          </div>
          <div className="text-xs text-text-muted mt-0.5">
            Verbindet direkt mit einer echten E2/E2S (Stock oder hacktribe) und
            liest Patterns aus.
          </div>
        </div>
        {connected ? (
          <button
            data-testid="e2s-disconnect-btn"
            onClick={() => device.disconnect()}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-bg-base text-text-muted hover:text-accent-danger transition-colors"
          >
            <Unplug size={13} /> Trennen
          </button>
        ) : (
          <button
            data-testid="e2s-connect-btn"
            disabled={connecting}
            onClick={() => device.connect()}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-accent-primary text-text-primary disabled:opacity-50 transition-colors"
          >
            <Plug size={13} /> {connecting ? "Verbinde…" : "Verbinden"}
          </button>
        )}
      </div>

      {/* Status / Identity */}
      <div className="flex items-center gap-2 text-xs" data-testid="e2s-status">
        <span
          className={`inline-block w-2 h-2 rounded-full ${
            connected
              ? "bg-accent-success"
              : device.status === "error"
                ? "bg-accent-danger"
                : "bg-text-dim"
          }`}
        />
        {connected && device.identity ? (
          <span className="text-text-muted" data-testid="e2s-status-connected">
            Verbunden · {modelName(device.identity.model)} · v
            {device.identity.versionMajor}.{device.identity.versionMinor} · Ch{" "}
            {device.identity.globalChannel + 1}
          </span>
        ) : (
          <span className="text-text-dim">
            {connecting ? "Verbinde…" : "Nicht verbunden"}
          </span>
        )}
      </div>

      {device.error && (
        <div
          className="flex items-start gap-1.5 p-2 rounded bg-accent-danger/15 border border-accent-danger/40 text-xs text-accent-danger"
          data-testid="e2s-error"
        >
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>{device.error}</span>
        </div>
      )}

      {/* Pull-Controls */}
      {connected && (
        <div className="space-y-2" data-testid="e2s-pull-controls">
          <div className="flex items-center gap-2">
            <button
              data-testid="e2s-pull-current-btn"
              disabled={device.busy}
              onClick={() => device.pullCurrent()}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-bg-base text-text-primary disabled:opacity-50 hover:bg-bg-panel transition-colors"
            >
              {device.busy ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <Download size={13} />
              )}
              Edit-Buffer
            </button>
            <div className="flex items-center gap-1">
              <input
                data-testid="e2s-slot-input"
                type="number"
                min={0}
                max={249}
                value={slot}
                onChange={e =>
                  setSlot(
                    Math.max(0, Math.min(249, Number(e.target.value) || 0))
                  )
                }
                className="w-16 text-xs px-2 py-1 rounded bg-bg-base border border-border-color text-text-primary"
                aria-label="Pattern-Slot (0–249)"
              />
              <button
                data-testid="e2s-pull-slot-btn"
                disabled={device.busy}
                onClick={() => device.pull(slot)}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-bg-base text-text-primary disabled:opacity-50 hover:bg-bg-panel transition-colors"
              >
                <Download size={13} /> Slot {slot}
              </button>
            </div>
          </div>

          {device.currentPattern && (
            <PatternSummaryRow
              label="Edit-Buffer"
              summary={device.currentPattern}
              onImport={() =>
                importDecoded(
                  device.currentDecoded ?? undefined,
                  "E2 Edit-Buffer"
                )
              }
            />
          )}
          {device.currentBody && <E2sPatternEditor />}
          {Object.entries(device.patterns)
            .sort((a, b) => Number(a[0]) - Number(b[0]))
            .map(([n, summary]) => (
              <PatternSummaryRow
                key={n}
                label={`Slot ${n}`}
                summary={summary}
                onImport={() =>
                  importDecoded(device.decoded[Number(n)], `E2 Slot ${n}`)
                }
              />
            ))}

          {/* ── Push: aktives SynthStudio-Pattern → Gerät ── */}
          <div
            className="pt-2 mt-1 border-t border-border-color space-y-1.5"
            data-testid="e2s-push-controls"
          >
            <div className="text-[10px] text-text-muted">
              Aktives SynthStudio-Pattern aufs Gerät schreiben:
            </div>
            <div className="flex items-center gap-2">
              <button
                data-testid="e2s-push-current-btn"
                disabled={device.busy}
                onClick={() => pushActive("current")}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-bg-base text-text-primary disabled:opacity-50 hover:bg-bg-panel transition-colors"
              >
                <Upload size={13} /> → Edit-Buffer
              </button>
              <button
                data-testid="e2s-push-slot-btn"
                disabled={device.busy}
                onClick={() => pushActive("slot")}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-bg-base text-text-primary disabled:opacity-50 hover:bg-bg-panel transition-colors"
              >
                <Upload size={13} /> → Slot {slot}
              </button>
            </div>
            <div className="text-[10px] text-text-dim">
              Wichtig: den Sequencer am Gerät stoppen (sonst lehnt es das
              Schreiben ab). Samples gehen nicht über SysEx — nur
              Patterns/Globals.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
