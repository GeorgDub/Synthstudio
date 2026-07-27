/**
 * tests/features/worklet-public-urls.test.ts
 *
 * v3.291: Built-In-Plugin-Worklets müssen als STABILE publicDir-URLs
 * (`./worklets/<file>`) referenziert werden — NICHT via `data:`-Inlining oder
 * gehashte Bundle-Assets. Der frühere `new URL("./worklets/X.js",
 * import.meta.url)`-Weg liess Vite die kleinen Worklets als
 * `data:text/javascript`-URLs inlinen; im gepackten Electron-Build blockt
 * `script-src 'self'` `data:`-Worklet-Module → "Unable to load a worklet's
 * module". Dieser Test verriegelt die stabile URL-Form.
 */
import { describe, it, expect } from "vitest";
import {
  BUILT_IN_TAPE_SAT,
  BUILT_IN_NOTCH,
  BUILT_IN_WIDTH,
  BUILT_IN_PLUGINS,
} from "@/audio/PluginRegistry";

describe("v3.291 Built-In-Worklet publicDir-URLs", () => {
  const manifests = [BUILT_IN_TAPE_SAT, BUILT_IN_NOTCH, BUILT_IN_WIDTH];

  it("jede Manifest-workletUrl ist eine stabile ./worklets/-Referenz", () => {
    for (const m of manifests) {
      expect(m.workletUrl).toMatch(/^\.\/worklets\/[A-Za-z]+Processor\.js$/);
    }
  });

  it("keine data:/blob:/import.meta-Inlining-Form", () => {
    for (const m of BUILT_IN_PLUGINS) {
      expect(m.workletUrl.startsWith("data:")).toBe(false);
      expect(m.workletUrl.startsWith("blob:")).toBe(false);
      expect(m.workletUrl).not.toContain("import.meta");
    }
  });

  it("Namen matchen die publicDir-Dateien (TapeSat/Notch/Width)", () => {
    expect(BUILT_IN_TAPE_SAT.workletUrl).toBe("./worklets/TapeSatProcessor.js");
    expect(BUILT_IN_NOTCH.workletUrl).toBe("./worklets/NotchProcessor.js");
    expect(BUILT_IN_WIDTH.workletUrl).toBe("./worklets/WidthProcessor.js");
  });
});
