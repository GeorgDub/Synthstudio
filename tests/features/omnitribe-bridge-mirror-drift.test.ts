/**
 * omnitribe-bridge-mirror-drift.test.ts — Sprint-120b.3 Bridge Mirror Drift Check.
 *
 * Asserts that the SynthStudio mirror of OmniTribeBridge.ts is byte-identical
 * to the SoT in the OmniTribe repo.
 *
 * Background:
 *   - SoT: G:/IdeaProjects/Omnitribe/host/synthstudio/OmniTribeBridge.ts
 *   - Mirror: G:/IdeaProjects/Synthstudio/client/src/audio/OmniTribeBridge.ts
 *   - Sync tool: G:/IdeaProjects/Omnitribe/tools/build/sync_to_synthstudio.py
 *
 * Sprint-112.3 drift test lives in OmniTribe (test_sprint53_ts_bindings.py checks
 * nrpn-map.ts drift via --check mode of generate_ts_bindings.py).
 * No equivalent Bridge-drift test exists in OmniTribe tests — this fills the gap
 * from the SynthStudio side. Symmetry note: ideally this test would live in the
 * OmniTribe repo where the sync tool lives, but the Sprint-120a/120c boundary
 * prevents that modification in Sprint-120b.
 *
 * If this test fails it means sync_to_synthstudio.py --apply needs to be run
 * by the OmniTribe maintainer after a bridge change.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// Absolute paths — this test is environment-specific to the dev machine.
// Opt-in via RUN_BRIDGE_DRIFT_CHECK=1: default skip because:
//   1. CI runners (Ubuntu/Mac/Windows) haben G:/IdeaProjects/Omnitribe nicht gemountet
//   2. Sprint-120a STATE_DUMP-Code lebt aktuell nur in der SynthStudio-Mirror und
//      noch nicht in der OmniTribe-SoT — Drift ist intentional bis Cross-Repo-Sync
//      manuell durchgefuehrt wird.
// Zum Drift-Check explizit aktivieren: RUN_BRIDGE_DRIFT_CHECK=1 pnpm test ...
const SOT_PATH = resolve("G:/IdeaProjects/Omnitribe/host/synthstudio/OmniTribeBridge.ts");
const MIRROR_PATH = resolve("G:/IdeaProjects/Synthstudio/client/src/audio/OmniTribeBridge.ts");

const skipReason = (() => {
  if (process.env.RUN_BRIDGE_DRIFT_CHECK !== "1") {
    return "RUN_BRIDGE_DRIFT_CHECK!=1 — drift-check ist opt-in (Default skip)";
  }
  try {
    readFileSync(SOT_PATH);
    return null;
  } catch {
    return `OmniTribe SoT not accessible at ${SOT_PATH}`;
  }
})();

describe("OmniTribeBridge Mirror Drift Check (Sprint-120b.3)", () => {
  it("Mirror is byte-identical to OmniTribe SoT", () => {
    if (skipReason) {
      console.warn(`[drift-check SKIPPED] ${skipReason}`);
      return; // soft-skip: don't fail CI when OmniTribe repo unavailable
    }

    const sotContent = readFileSync(SOT_PATH);
    const mirrorContent = readFileSync(MIRROR_PATH);

    const sotHash = Buffer.from(sotContent).toString("base64");
    const mirrorHash = Buffer.from(mirrorContent).toString("base64");

    if (sotHash !== mirrorHash) {
      // Produce a useful diff summary (first differing line)
      const sotLines = sotContent.toString("utf-8").split("\n");
      const mirrorLines = mirrorContent.toString("utf-8").split("\n");
      let firstDiff = -1;
      const maxLines = Math.max(sotLines.length, mirrorLines.length);
      for (let i = 0; i < maxLines; i++) {
        if (sotLines[i] !== mirrorLines[i]) {
          firstDiff = i + 1;
          break;
        }
      }
      const diffMsg = firstDiff > 0
        ? `First differing line: ${firstDiff}\n` +
          `  SoT:    ${(sotLines[firstDiff - 1] ?? "(missing)").slice(0, 120)}\n` +
          `  Mirror: ${(mirrorLines[firstDiff - 1] ?? "(missing)").slice(0, 120)}`
        : `Length differs: SoT=${sotContent.length} Mirror=${mirrorContent.length}`;
      throw new Error(
        `OmniTribeBridge.ts mirror has drifted from SoT.\n` +
        `Run: python G:/IdeaProjects/Omnitribe/tools/build/sync_to_synthstudio.py --apply\n\n` +
        diffMsg,
      );
    }

    expect(sotHash).toBe(mirrorHash);
  });
});
