/**
 * EuclideanControls – Inline-Euclidean-Rhythm-Editor pro Channel-Row
 * Öffnet Mini-Popover mit Hits/Steps/Rotation-Inputs und Apply-Button
 *
 * v3.17.0: Apply spiegelt Euclidean-Params an OmniTribe via NRPN 0x11
 * (N-Steps 0x00, K-Hits 0x01, Rotation 0x02, Enable 0x03). Disconnected
 * sind die Calls NO-OPs (sendEuclideanParam checkt isConnected).
 */
import React, { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { euclidean } from "@/utils/euclidean";
import { sendEuclideanParam, clampPartIndex } from "@/utils/omniTribeWiring";
// v3.158: Klassische Euclidean-Presets (aus v3.157).
import { EUCLIDEAN_PRESETS } from "@/utils/euclideanRhythm";

interface EuclideanControlsProps {
  partId: string;
  /** v3.17: numerischer Part-Index 0..15 fuer OmniTribe-NRPN. Default 0. */
  partIndex?: number;
  stepCount: number;
  onApply: (partId: string, hits: number, steps: number, rotation: number) => void;
}

export function EuclideanControls({ partId, partIndex = 0, stepCount, onApply }: EuclideanControlsProps) {
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState(3);
  const [steps, setSteps] = useState(stepCount);
  const [rotation, setRotation] = useState(0);

  const preview = euclidean(hits, steps, rotation);
  const activeCount = preview.filter(Boolean).length;

  const handleApply = () => {
    onApply(partId, hits, steps, rotation);
    // v3.17: an OmniTribe spiegeln (NO-OP wenn nicht connected).
    const part = clampPartIndex(partIndex);
    sendEuclideanParam(part, "nSteps", steps);
    sendEuclideanParam(part, "kHits", hits);
    sendEuclideanParam(part, "rotation", rotation < 0 ? rotation + steps : rotation);
    sendEuclideanParam(part, "enable", 1);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          title="Euclidean Rhythm Generator"
          className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-bg-elevated hover:bg-bg-elevated text-text-muted hover:text-accent-secondary transition-colors border border-border-color"
        >
          E:{hits}/{steps}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-50 w-56 rounded-lg bg-bg-panel border border-border-color p-3 shadow-xl text-white text-xs"
          side="bottom"
          sideOffset={4}
        >
          <Popover.Arrow className="fill-border-color" />
          <div className="font-semibold text-text-primary mb-2">Euclidean Generator</div>

          {/* v3.158: Quick-Presets (Tresillo, Cinquillo, ...) */}
          <div className="mb-2">
            <div className="text-[10px] text-text-dim mb-1">Presets</div>
            <div className="flex flex-wrap gap-1">
              {EUCLIDEAN_PRESETS.slice(0, 5).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setHits(preset.hits);
                    setSteps(preset.steps);
                    setRotation(0);
                  }}
                  title={preset.description}
                  className="px-1.5 py-0.5 rounded text-[10px] bg-bg-elevated hover:bg-accent-primary/40 hover:text-accent-primary text-text-muted transition-colors"
                  data-testid={`euclidean-preset-${preset.id}`}
                >
                  {preset.hits}/{preset.steps}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 mb-2">
            <label className="flex flex-col gap-0.5 flex-1">
              <span className="text-text-dim">Hits</span>
              <input
                type="number"
                min={0}
                max={steps}
                value={hits}
                onChange={e => setHits(Math.max(0, Math.min(steps, Number(e.target.value))))}
                className="bg-bg-elevated rounded px-2 py-1 font-mono text-center w-full"
              />
            </label>
            <label className="flex flex-col gap-0.5 flex-1">
              <span className="text-text-dim">Steps</span>
              <input
                type="number"
                min={1}
                max={32}
                value={steps}
                onChange={e => setSteps(Math.max(1, Math.min(32, Number(e.target.value))))}
                className="bg-bg-elevated rounded px-2 py-1 font-mono text-center w-full"
              />
            </label>
            <label className="flex flex-col gap-0.5 flex-1">
              <span className="text-text-dim">Rot.</span>
              <input
                type="number"
                min={-steps}
                max={steps}
                value={rotation}
                onChange={e => setRotation(Number(e.target.value))}
                className="bg-bg-elevated rounded px-2 py-1 font-mono text-center w-full"
              />
            </label>
          </div>

          {/* Preview */}
          <div className="flex gap-0.5 mb-2 flex-wrap">
            {preview.map((active, i) => (
              <div
                key={i}
                className={`w-4 h-4 rounded-sm ${active ? "bg-accent-primary" : "bg-bg-elevated"}`}
              />
            ))}
          </div>
          <div className="text-text-dim mb-2">{activeCount} von {steps} Steps aktiv</div>

          <button
            onClick={handleApply}
            className="w-full bg-accent-primary/70 hover:bg-accent-primary text-white rounded py-1.5 font-semibold transition-colors"
          >
            Anwenden
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
