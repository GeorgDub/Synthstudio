/**
 * PatternVariationsBar.tsx (v3.269)
 *
 * Verdrahtung des bis dahin toten A/B/C/D-Variation-Slot-Features
 * (usePatternVariationsStore). Jedes Pattern kann 4 Variationen halten:
 *  - A = Basis (das Pattern, mit dem die Gruppe angelegt wurde)
 *  - B/C/D = Kopien, frei editierbar (Fills, Breakdowns, Outros)
 *
 * Klick auf einen gefüllten Slot → dm.setActivePattern (Live-Switch).
 * Klick auf einen leeren Slot → aktuelles Pattern dorthin kopieren + aktivieren.
 */
import type { DrumMachineState, DrumMachineActions } from "@/store/useDrumMachineStore";
import {
  usePatternVariationsStore,
  createVariationSet,
  updateVariationSlot,
  setActiveVariation,
  findSetContainingPattern,
  type VariationSlot,
} from "@/store/usePatternVariationsStore";

const SLOTS: VariationSlot[] = ["A", "B", "C", "D"];

interface Props {
  dm: DrumMachineState & DrumMachineActions;
}

export function PatternVariationsBar({ dm }: Props) {
  const { sets } = usePatternVariationsStore();
  const active = dm.getActivePattern();
  if (!active) return null;

  const set = findSetContainingPattern(sets, active.id);

  if (!set) {
    return (
      <div
        data-testid="pattern-variations-bar"
        className="flex items-center gap-2 px-3 py-1.5 border-b border-border-color bg-bg-panel text-xs"
      >
        <span className="text-text-dim uppercase tracking-wide">Variationen</span>
        <button
          data-testid="varslot-create"
          onClick={() => createVariationSet(active.id, active.name, active.id)}
          title="A/B/C/D-Variationen für dieses Pattern anlegen"
          className="px-2 py-1 rounded bg-bg-elevated text-text-muted hover:text-text-primary hover:bg-bg-base transition-colors"
        >
          A/B/C/D anlegen
        </button>
      </div>
    );
  }

  const handleSlot = (slot: VariationSlot) => {
    const slotId = set.slots[slot];
    if (slotId) {
      // Gefüllter Slot → Live-Switch auf das gespeicherte Pattern.
      setActiveVariation(set.basePatternId, slot);
      dm.setActivePattern(slotId);
    } else {
      // Leerer Slot → aktuelles Pattern hineinkopieren (neues Pattern) + aktiv.
      const cur = dm.getActivePattern();
      if (!cur) return;
      const newId = dm.addPatternData({ ...cur, name: `${set.name} ${slot}` });
      updateVariationSlot(set.basePatternId, slot, newId);
      setActiveVariation(set.basePatternId, slot);
      dm.setActivePattern(newId);
    }
  };

  return (
    <div
      data-testid="pattern-variations-bar"
      className="flex items-center gap-2 px-3 py-1.5 border-b border-border-color bg-bg-panel text-xs"
    >
      <span className="text-text-dim uppercase tracking-wide truncate max-w-[10rem]" title={set.name}>
        Variationen · {set.name}
      </span>
      <div className="flex items-center gap-1">
        {SLOTS.map((slot) => {
          const slotId = set.slots[slot];
          const filled = !!slotId;
          const isActive = set.activeSlot === slot && active.id === slotId;
          return (
            <button
              key={slot}
              data-testid={`varslot-${slot}`}
              aria-pressed={isActive}
              onClick={() => handleSlot(slot)}
              title={filled ? `Variation ${slot} aktivieren` : `Aktuelles Pattern in Slot ${slot} kopieren`}
              className={`w-8 h-7 rounded font-bold transition-colors active:scale-95 ${
                isActive
                  ? "bg-accent-primary text-bg-base"
                  : filled
                    ? "bg-bg-elevated text-text-primary hover:bg-bg-base"
                    : "bg-bg-base text-text-dim hover:text-text-muted border border-dashed border-border-color"
              }`}
            >
              {slot}{!filled && <span className="text-[9px] align-top">+</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
