/**
 * tests/features/function-chains.test.ts
 *
 * v1.77: Function-Chains — mehrere Actions hintereinander auf einer Taste.
 * Pure-Test des `planChainExecution`-Helpers aus useMidi.
 */
import { describe, it, expect } from "vitest";
import { planChainExecution, type ChainStep } from "../../client/src/hooks/useMidi";

describe("planChainExecution (v1.77)", () => {
  it("leere Steps → leerer Plan", () => {
    const plan = planChainExecution([]);
    expect(plan.triggers).toEqual([]);
    expect(plan.dropped).toBe(0);
  });

  it("ein Step ohne delay → atMs=0", () => {
    const steps: ChainStep[] = [
      { target: { type: "playStop" } },
    ];
    const plan = planChainExecution(steps);
    expect(plan.triggers).toHaveLength(1);
    expect(plan.triggers[0].atMs).toBe(0);
    expect(plan.triggers[0].value).toBe(127); // default
  });

  it("mehrere Steps mit delayMs → kumulativer atMs", () => {
    const steps: ChainStep[] = [
      { target: { type: "playStop" }, delayMs: 200 },
      { target: { type: "tapTempo" }, delayMs: 100 },
      { target: { type: "record" } },
    ];
    const plan = planChainExecution(steps);
    expect(plan.triggers).toHaveLength(3);
    expect(plan.triggers[0].atMs).toBe(0);
    expect(plan.triggers[1].atMs).toBe(200);
    expect(plan.triggers[2].atMs).toBe(300);
  });

  it("Step mit explicit value < 127 wird durchgereicht", () => {
    const steps: ChainStep[] = [
      { target: { type: "volume", partId: "p1", partName: "Kick" }, value: 64 },
    ];
    const plan = planChainExecution(steps);
    expect(plan.triggers[0].value).toBe(64);
  });

  it("Step-Value wird auf 0-127 geclamped", () => {
    const steps: ChainStep[] = [
      { target: { type: "volume", partId: "p1" }, value: -5 },
      { target: { type: "volume", partId: "p2" }, value: 200 },
    ];
    const plan = planChainExecution(steps);
    expect(plan.triggers[0].value).toBe(0);
    expect(plan.triggers[1].value).toBe(127);
  });

  it("delayMs wird auf 0..60000 geclamped (defense gegen ewige Wartezeiten)", () => {
    const steps: ChainStep[] = [
      { target: { type: "playStop" }, delayMs: -100 },
      { target: { type: "record" },   delayMs: 999999 },
      { target: { type: "tapTempo" } },
    ];
    const plan = planChainExecution(steps);
    expect(plan.triggers[0].atMs).toBe(0);
    expect(plan.triggers[1].atMs).toBe(0); // 0 + clamp(-100,0)
    expect(plan.triggers[2].atMs).toBe(60_000); // + clamp(999999, 60000)
  });

  it("chain-of-chain wird übersprungen (1-level-nesting only)", () => {
    const innerChain = {
      type: "chain" as const,
      label: "Inner",
      steps: [{ target: { type: "playStop" as const } }],
    };
    // TS würde das ablehnen — wir umgehen es via Cast (Defense-in-depth-Test)
    const steps: ChainStep[] = [
      { target: { type: "playStop" } },
      // @ts-expect-error - bewusst invalid
      { target: innerChain },
      { target: { type: "record" } },
    ];
    const plan = planChainExecution(steps);
    expect(plan.triggers).toHaveLength(2);
    expect(plan.dropped).toBe(1);
    expect(plan.triggers[0].target.type).toBe("playStop");
    expect(plan.triggers[1].target.type).toBe("record");
  });

  it("Step ohne target wird übersprungen", () => {
    // @ts-expect-error - bewusst kein target
    const steps: ChainStep[] = [{ }, { target: { type: "playStop" } }];
    const plan = planChainExecution(steps);
    expect(plan.dropped).toBe(1);
    expect(plan.triggers).toHaveLength(1);
  });

  it("realistisches Beispiel: Drop-Combo (Stop + Clear + Play, je 100ms Abstand)", () => {
    const steps: ChainStep[] = [
      { target: { type: "playStop" }, delayMs: 100 },
      { target: { type: "patternClear" }, delayMs: 100 },
      { target: { type: "playStop" } },
    ];
    const plan = planChainExecution(steps);
    expect(plan.triggers.map(t => t.atMs)).toEqual([0, 100, 200]);
  });

  it("Step-Index ist 0-basiert und matched die Reihenfolge", () => {
    const steps: ChainStep[] = [
      { target: { type: "bpmUp" } },
      { target: { type: "bpmUp" } },
      { target: { type: "bpmUp" } },
    ];
    const plan = planChainExecution(steps);
    expect(plan.triggers.map(t => t.step)).toEqual([0, 1, 2]);
  });
});
