// @vitest-environment jsdom
/**
 * Synthstudio – korg-e2-pull-parts-hook.test.ts (v3.318.0)
 *
 * Der Hook-Vertrag, den die reinen Transforms NICHT abdecken können:
 * `ensureParts(16)` gibt IDs für Parts zurück, die es im committeten State noch
 * gar nicht gibt. Der Pull-Handler befüllt sie **im selben Tick** per
 * `setPartSteps(id, …)` / `renamePart(id, …)`.
 *
 * Genau daran hängt der Fix. Wären die Updates nicht der Reihe nach als
 * funktionale Updater eingereiht, liefen die Folgeaufrufe ins Leere: 16 Parts
 * da, die letzten 7 leer — und niemand würde es melden. Deshalb ruft dieser
 * Test beide Aktionen in EINEM `act()` auf, so wie der Handler es tut.
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDrumMachineStore } from "../../client/src/store/useDrumMachineStore";

const E2_PART_COUNT = 16;

describe("ensureParts — Vertrag mit dem Pull-Handler", () => {
  it("gibt IDs zurück, mit denen ein frisch angelegter Part im selben Tick befüllbar ist", () => {
    const { result } = renderHook(() => useDrumMachineStore());
    const vorher = result.current.getActivePattern()?.parts.length ?? 0;
    expect(vorher).toBeLessThan(E2_PART_COUNT); // Default sind 9 Kanäle

    const steps = Array.from({ length: 16 }, (_, i) => i === 7);
    const vels = Array.from({ length: 16 }, () => 100);

    act(() => {
      const ids = result.current.ensureParts(E2_PART_COUNT);
      // Genau die Reihenfolge des Handlers: anlegen, dann sofort adressieren.
      result.current.setPartSteps(ids[15], steps, vels);
      result.current.renamePart(ids[15], "Kanal 16 · #501");
    });

    const pattern = result.current.getActivePattern();
    expect(pattern?.parts).toHaveLength(E2_PART_COUNT);
    expect(pattern?.parts[15].name).toBe("Kanal 16 · #501");
    expect(pattern?.parts[15].steps[7].active).toBe(true);
  });

  it("legt nichts an, wenn schon genug Parts da sind, und liefert die vorhandenen IDs", () => {
    const { result } = renderHook(() => useDrumMachineStore());

    let ids: string[] = [];
    act(() => {
      ids = result.current.ensureParts(3);
    });

    const pattern = result.current.getActivePattern();
    expect(pattern?.parts.length).toBeGreaterThan(3);
    expect(ids.slice(0, 3)).toEqual(
      pattern?.parts.slice(0, 3).map(p => p.id)
    );
  });
});
