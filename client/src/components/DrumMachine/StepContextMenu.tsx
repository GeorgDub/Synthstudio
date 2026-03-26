/**
 * StepContextMenu – Rechtsklick-Popover für Step-Probability und Condition
 */
import React, { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import type { StepCondition } from "@/audio/AudioEngine";

interface StepContextMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  probability: number;        // 0–100
  condition: StepCondition;
  onProbabilityChange: (value: number) => void;
  onConditionChange: (condition: StepCondition) => void;
  children: React.ReactNode; // Der Step-Button als Trigger
}

const CONDITION_OPTIONS: { label: string; value: StepCondition }[] = [
  { label: "Immer", value: { type: "always" } },
  { label: "Jeden 2. Loop", value: { type: "every", n: 1, of: 2 } },
  { label: "Jeden 4. Loop", value: { type: "every", n: 1, of: 4 } },
  { label: "2. von 2 Loops", value: { type: "every", n: 2, of: 2 } },
  { label: "Fill", value: { type: "fill" } },
  { label: "!Fill", value: { type: "not_fill" } },
];

function conditionLabel(cond: StepCondition): string {
  if (cond.type === "always") return "Immer";
  if (cond.type === "every") return `Jeden ${cond.n}. von ${cond.of}`;
  if (cond.type === "fill") return "Fill";
  if (cond.type === "not_fill") return "!Fill";
  return "Immer";
}

export function StepContextMenu({
  open,
  onOpenChange,
  probability,
  condition,
  onProbabilityChange,
  onConditionChange,
  children,
}: StepContextMenuProps) {
  const [everyN, setEveryN] = useState(1);
  const [everyOf, setEveryOf] = useState(2);

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-50 w-52 rounded-lg bg-slate-900 border border-slate-700 p-3 shadow-xl text-white text-xs"
          side="top"
          sideOffset={4}
          onContextMenu={e => e.preventDefault()}
        >
          <Popover.Arrow className="fill-slate-700" />

          {/* Probability */}
          <div className="mb-3">
            <div className="flex justify-between mb-1">
              <span className="text-slate-400">Probability</span>
              <span className="font-mono text-cyan-400">{probability}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={probability}
              onChange={e => onProbabilityChange(Number(e.target.value))}
              className="w-full accent-cyan-500"
            />
            <div className="flex justify-between text-slate-600 text-[10px] mt-0.5">
              <span>0%</span><span>50%</span><span>100%</span>
            </div>
          </div>

          {/* Condition */}
          <div>
            <div className="text-slate-400 mb-1">Condition</div>
            <div className="flex flex-col gap-1">
              {CONDITION_OPTIONS.map(opt => (
                <button
                  key={JSON.stringify(opt.value)}
                  onClick={() => onConditionChange(opt.value)}
                  className={`text-left px-2 py-1 rounded text-xs transition-colors ${
                    condition.type === opt.value.type
                      ? "bg-cyan-700 text-white"
                      : "bg-slate-800 hover:bg-slate-700 text-slate-300"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
              {/* Custom Every N:M */}
              <div className="flex items-center gap-1 mt-1">
                <span className="text-slate-500">Jed.</span>
                <input
                  type="number"
                  min={1}
                  max={16}
                  value={everyN}
                  onChange={e => setEveryN(Number(e.target.value))}
                  className="w-10 bg-slate-800 rounded px-1 py-0.5 text-center font-mono text-xs"
                />
                <span className="text-slate-500">von</span>
                <input
                  type="number"
                  min={1}
                  max={16}
                  value={everyOf}
                  onChange={e => setEveryOf(Number(e.target.value))}
                  className="w-10 bg-slate-800 rounded px-1 py-0.5 text-center font-mono text-xs"
                />
                <button
                  onClick={() => onConditionChange({ type: "every", n: everyN, of: everyOf })}
                  className="bg-slate-700 hover:bg-slate-600 px-1.5 py-0.5 rounded text-xs"
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
