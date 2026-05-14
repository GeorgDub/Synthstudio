/**
 * tests/features/midi-runscript-target.test.ts
 *
 * v1.78: Script-Run als bindbarer MidiLearnTarget.
 * Test der Type-Shape + Layout-Import-Validation.
 */
import { describe, it, expect } from "vitest";
import { labelForTarget, type MidiLearnTarget } from "../../client/src/hooks/useMidi";
import { parseMidiLayoutJson, VALID_TARGET_TYPES } from "../../client/src/utils/midiLayoutImport";
import { buildMidiLayoutJson } from "../../client/src/utils/midiLayoutExport";

describe("runScript MidiLearnTarget (v1.78)", () => {
  it("labelForTarget zeigt scriptName falls vorhanden", () => {
    const t: MidiLearnTarget = { type: "runScript", scriptId: "abc-123-def", scriptName: "Meine BPM-Rampe" };
    expect(labelForTarget(t)).toBe("Script: Meine BPM-Rampe");
  });

  it("labelForTarget fällt auf gekürzte scriptId zurück wenn kein scriptName", () => {
    const t: MidiLearnTarget = { type: "runScript", scriptId: "abc-123-def-456" };
    expect(labelForTarget(t)).toBe("Script: abc-123-");
  });

  it("VALID_TARGET_TYPES enthält 'runScript'", () => {
    expect(VALID_TARGET_TYPES.has("runScript")).toBe(true);
  });

  it("runScript-Target Round-Trip: Export → Import 1:1", () => {
    const ccMapping = {
      cc: 50,
      channel: 1,
      target: { type: "runScript" as const, scriptId: "script-xyz", scriptName: "Build-up" },
      label: "Script: Build-up",
    };
    const json = buildMidiLayoutJson({
      name: "Setup mit Script",
      ccMappings: [ccMapping],
      noteMappings: [],
    });
    const result = parseMidiLayoutJson(json);
    expect(result.ok).toBe(true);
    expect(result.layout!.ccMappings[0].target).toEqual(ccMapping.target);
    expect(result.layout!.ccMappings[0].cc).toBe(50);
  });

  it("runScript-Target ist orthogonal zu chain (kein nesting confusion)", () => {
    const ccMappings = [
      {
        cc: 1,
        channel: 0,
        target: {
          type: "chain" as const,
          label: "Combo",
          steps: [
            { target: { type: "runScript" as const, scriptId: "s1", scriptName: "Drop" } },
            { target: { type: "playStop" as const } },
          ],
        },
        label: "Combo",
      },
    ];
    const json = buildMidiLayoutJson({ name: "Mixed", ccMappings, noteMappings: [] });
    const result = parseMidiLayoutJson(json);
    expect(result.ok).toBe(true);
    // chain als top-level target wird akzeptiert, runScript als Sub-Target im chain auch
    expect(result.layout!.ccMappings).toHaveLength(1);
    expect(result.layout!.ccMappings[0].target.type).toBe("chain");
  });
});
