/**
 * tests/features/electribe-motion-bridge.test.ts
 *
 * TASK-237-FOLLOWUP-1 (v2.90) — Tests fuer die Bridge zwischen
 * Electribe-Motion-Lanes (CustomEvent-Payload) und Synthstudio-
 * AutomationLanes (useAutomationStore).
 */

import { describe, it, expect } from "vitest";
import {
  parseElectribeLaneTarget,
  mapElectribeLaneToAutomationTarget,
  scaleMotionPointsToStepCount,
  selectConvertableLanes,
  type ElectribeMotionLane,
} from "../../client/src/utils/electribeMotionMapping";

// ─── parseElectribeLaneTarget ────────────────────────────────────────────────

describe("parseElectribeLaneTarget", () => {
  it("zerlegt 'Volume:3' in paramName + partIndex", () => {
    const r = parseElectribeLaneTarget("Volume:3");
    expect(r).toEqual({ paramName: "Volume", partIndex: 3 });
  });

  it("zerlegt 'Filter Cutoff:0' korrekt (Space im paramName)", () => {
    const r = parseElectribeLaneTarget("Filter Cutoff:0");
    expect(r).toEqual({ paramName: "Filter Cutoff", partIndex: 0 });
  });

  it("nimmt den letzten Doppelpunkt als Trenner", () => {
    const r = parseElectribeLaneTarget("Send Foo:Bar:7");
    expect(r).toEqual({ paramName: "Send Foo:Bar", partIndex: 7 });
  });

  it("liefert null bei fehlendem partIndex", () => {
    expect(parseElectribeLaneTarget("Volume")).toBeNull();
    expect(parseElectribeLaneTarget("Volume:")).toBeNull();
    expect(parseElectribeLaneTarget("Volume:abc")).toBeNull();
  });

  it("liefert null bei leerem paramName", () => {
    expect(parseElectribeLaneTarget(":3")).toBeNull();
  });

  it("liefert null bei negativem partIndex", () => {
    expect(parseElectribeLaneTarget("Volume:-1")).toBeNull();
  });
});

// ─── mapElectribeLaneToAutomationTarget ──────────────────────────────────────

describe("mapElectribeLaneToAutomationTarget", () => {
  const partIds = [
    "part-a", "part-b", "part-c", "part-d",
    "part-e", "part-f", "part-g", "part-h",
  ];

  it("Volume:0 → vol:part-a", () => {
    expect(mapElectribeLaneToAutomationTarget("Volume:0", partIds)).toBe("vol:part-a");
  });

  it("Pan:3 → pan:part-d", () => {
    expect(mapElectribeLaneToAutomationTarget("Pan:3", partIds)).toBe("pan:part-d");
  });

  it("FX Send:7 → send-rev:part-h (Default-Bus)", () => {
    expect(mapElectribeLaneToAutomationTarget("FX Send:7", partIds)).toBe("send-rev:part-h");
  });

  it("liefert null bei unsupported Param ('Filter Cutoff:0')", () => {
    expect(mapElectribeLaneToAutomationTarget("Filter Cutoff:0", partIds)).toBeNull();
  });

  it("liefert null bei partIndex ausserhalb der partIds-Range", () => {
    expect(mapElectribeLaneToAutomationTarget("Volume:99", partIds)).toBeNull();
  });

  it("liefert null bei kaputtem Target-String", () => {
    expect(mapElectribeLaneToAutomationTarget("garbage", partIds)).toBeNull();
  });
});

// ─── scaleMotionPointsToStepCount ────────────────────────────────────────────

describe("scaleMotionPointsToStepCount", () => {
  it("16-Steps Pattern: Points werden 1:1 uebernommen", () => {
    const input = { 0: 0.1, 5: 0.5, 15: 0.9 };
    expect(scaleMotionPointsToStepCount(input, 16)).toEqual(input);
    // Aber: kein Identity-Object
    expect(scaleMotionPointsToStepCount(input, 16)).not.toBe(input);
  });

  it("32-Steps Pattern: Step 5 → Step 10 (Faktor 2)", () => {
    const scaled = scaleMotionPointsToStepCount({ 5: 0.5 }, 32);
    expect(scaled).toEqual({ 10: 0.5 });
  });

  it("32-Steps Pattern: alle 16 Electribe-Steps in den 0..30-Range", () => {
    const input: Record<number, number> = {};
    for (let i = 0; i < 16; i++) input[i] = i / 15;
    const scaled = scaleMotionPointsToStepCount(input, 32);
    expect(scaled[0]).toBe(0);
    expect(scaled[30]).toBe(1);
    expect(scaled[15]).toBeUndefined();   // kein Eintrag bei ungeradem Index
  });

  it("32-Steps Pattern: clampt auf max-Index (31, nicht 32)", () => {
    // Edge-Case: synthetischer Input mit key=20 → 20*2=40, gecappt auf 31.
    const scaled = scaleMotionPointsToStepCount({ 20: 0.42 }, 32);
    expect(scaled[31]).toBe(0.42);
  });
});

// ─── selectConvertableLanes ──────────────────────────────────────────────────

describe("selectConvertableLanes", () => {
  const partIds = ["p0", "p1", "p2"];

  it("filtert unsupported Param-Names heraus", () => {
    const lanes: ElectribeMotionLane[] = [
      { target: "Volume:0", label: "Vol", points: { 0: 0.5 }, min: 0, max: 1 },
      { target: "Filter Cutoff:1", label: "FC", points: { 0: 0.5 }, min: 0, max: 1 },
      { target: "Pan:2", label: "Pan", points: { 0: 0.5 }, min: 0, max: 1 },
    ];
    const result = selectConvertableLanes(lanes, partIds);
    expect(result).toHaveLength(2);
    expect(result[0].target).toBe("vol:p0");
    expect(result[1].target).toBe("pan:p2");
  });

  it("filtert Lanes mit out-of-range partIndex heraus", () => {
    const lanes: ElectribeMotionLane[] = [
      { target: "Volume:0", label: "Vol", points: {}, min: 0, max: 1 },
      { target: "Volume:99", label: "Vol99", points: {}, min: 0, max: 1 },
    ];
    expect(selectConvertableLanes(lanes, partIds)).toHaveLength(1);
  });

  it("leere Lanes-Liste → leeres Resultat", () => {
    expect(selectConvertableLanes([], partIds)).toEqual([]);
  });
});

// ─── End-to-End: Motion-Lane-Event → AutomationStore-Calls (mock) ────────────

describe("Motion-Lane → AutomationStore Wiring (mocked)", () => {
  it("addLane wird mit korrekt gemapptem Target gerufen", () => {
    // Simuliert die Bridge-Logik aus App.tsx ohne React.
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const mockStore = {
      addLane: (target: string, label: string) => {
        calls.push({ method: "addLane", args: [target, label] });
        return "mock-lane-id";
      },
      setPoint: (laneId: string, step: number, value: number) => {
        calls.push({ method: "setPoint", args: [laneId, step, value] });
      },
    };

    const partIds = ["p-kick", "p-snare", "p-hat"];
    const lanes: ElectribeMotionLane[] = [
      { target: "Volume:0", label: "Vol (Part 1)", points: { 0: 0.2, 8: 0.8 }, min: 0, max: 1 },
      { target: "Filter Cutoff:1", label: "FC (Part 2)", points: { 0: 0.5 }, min: 0, max: 1 }, // ignored
      { target: "Pan:2", label: "Pan (Part 3)", points: { 4: -0.5 }, min: -1, max: 1 },
    ];

    for (const lane of lanes) {
      const target = mapElectribeLaneToAutomationTarget(lane.target, partIds);
      if (!target) continue;
      const laneId = mockStore.addLane(target, lane.label);
      const scaled = scaleMotionPointsToStepCount(lane.points, 16);
      for (const key of Object.keys(scaled)) {
        mockStore.setPoint(laneId, Number(key), scaled[Number(key)]);
      }
    }

    // Volume + Pan kommen durch, Filter Cutoff wird ignoriert.
    const addLaneCalls = calls.filter(c => c.method === "addLane");
    expect(addLaneCalls).toHaveLength(2);
    expect(addLaneCalls[0].args[0]).toBe("vol:p-kick");
    expect(addLaneCalls[1].args[0]).toBe("pan:p-hat");

    // setPoint-Aufrufe pro Lane: Lane Volume hat 2 Points, Lane Pan hat 1 Point.
    const setPointCalls = calls.filter(c => c.method === "setPoint");
    expect(setPointCalls).toHaveLength(3);
  });

  it("32-Step-Pattern: Points werden auf den groesseren Step-Range gestreckt", () => {
    const setPointArgs: Array<[string, number, number]> = [];
    const mockStore = {
      addLane: () => "lane",
      setPoint: (laneId: string, step: number, value: number) => {
        setPointArgs.push([laneId, step, value]);
      },
    };

    const lanes: ElectribeMotionLane[] = [
      { target: "Volume:0", label: "V", points: { 0: 0.1, 8: 0.5, 15: 0.9 }, min: 0, max: 1 },
    ];
    const partIds = ["p0"];

    for (const lane of lanes) {
      const target = mapElectribeLaneToAutomationTarget(lane.target, partIds);
      if (!target) continue;
      const laneId = mockStore.addLane();
      const scaled = scaleMotionPointsToStepCount(lane.points, 32);
      for (const key of Object.keys(scaled)) {
        mockStore.setPoint(laneId, Number(key), scaled[Number(key)]);
      }
    }

    // Step 0 → 0, Step 8 → 16, Step 15 → 30
    const steps = setPointArgs.map(a => a[1]).sort((a, b) => a - b);
    expect(steps).toEqual([0, 16, 30]);
  });
});
