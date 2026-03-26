/**
 * EuclideanControls – Inline-Euclidean-Rhythm-Editor pro Channel-Row
 * Öffnet Mini-Popover mit Hits/Steps/Rotation-Inputs und Apply-Button
 */
import React, { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { euclidean } from "@/utils/euclidean";

interface EuclideanControlsProps {
  partId: string;
  stepCount: number;
  onApply: (partId: string, hits: number, steps: number, rotation: number) => void;
}

export function EuclideanControls({ partId, stepCount, onApply }: EuclideanControlsProps) {
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState(3);
  const [steps, setSteps] = useState(stepCount);
  const [rotation, setRotation] = useState(0);

  const preview = euclidean(hits, steps, rotation);
  const activeCount = preview.filter(Boolean).length;

  const handleApply = () => {
    onApply(partId, hits, steps, rotation);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          title="Euclidean Rhythm Generator"
          className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-cyan-400 transition-colors border border-slate-700"
        >
          E:{hits}/{steps}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-50 w-56 rounded-lg bg-slate-900 border border-slate-700 p-3 shadow-xl text-white text-xs"
          side="bottom"
          sideOffset={4}
        >
          <Popover.Arrow className="fill-slate-700" />
          <div className="font-semibold text-slate-300 mb-2">Euclidean Generator</div>

          <div className="flex gap-2 mb-2">
            <label className="flex flex-col gap-0.5 flex-1">
              <span className="text-slate-500">Hits</span>
              <input
                type="number"
                min={0}
                max={steps}
                value={hits}
                onChange={e => setHits(Math.max(0, Math.min(steps, Number(e.target.value))))}
                className="bg-slate-800 rounded px-2 py-1 font-mono text-center w-full"
              />
            </label>
            <label className="flex flex-col gap-0.5 flex-1">
              <span className="text-slate-500">Steps</span>
              <input
                type="number"
                min={1}
                max={32}
                value={steps}
                onChange={e => setSteps(Math.max(1, Math.min(32, Number(e.target.value))))}
                className="bg-slate-800 rounded px-2 py-1 font-mono text-center w-full"
              />
            </label>
            <label className="flex flex-col gap-0.5 flex-1">
              <span className="text-slate-500">Rot.</span>
              <input
                type="number"
                min={-steps}
                max={steps}
                value={rotation}
                onChange={e => setRotation(Number(e.target.value))}
                className="bg-slate-800 rounded px-2 py-1 font-mono text-center w-full"
              />
            </label>
          </div>

          {/* Preview */}
          <div className="flex gap-0.5 mb-2 flex-wrap">
            {preview.map((active, i) => (
              <div
                key={i}
                className={`w-4 h-4 rounded-sm ${active ? "bg-cyan-500" : "bg-slate-700"}`}
              />
            ))}
          </div>
          <div className="text-slate-500 mb-2">{activeCount} von {steps} Steps aktiv</div>

          <button
            onClick={handleApply}
            className="w-full bg-cyan-700 hover:bg-cyan-600 text-white rounded py-1.5 font-semibold transition-colors"
          >
            Anwenden
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
