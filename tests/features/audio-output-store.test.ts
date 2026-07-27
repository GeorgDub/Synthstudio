import { describe, it, expect, beforeEach } from "vitest";
import {
  getAudioOutputState,
  getAudioOutputDeviceId,
  setAudioOutputDeviceId,
  isDefaultAudioOutput,
  __resetAudioOutputForTests,
} from "../../client/src/store/useAudioOutputStore";

describe("useAudioOutputStore", () => {
  beforeEach(() => __resetAudioOutputForTests());

  it("defaults to system output (empty deviceId)", () => {
    expect(getAudioOutputDeviceId()).toBe("");
    expect(isDefaultAudioOutput()).toBe(true);
  });

  it("selects a specific output device (e.g. Scarlett)", () => {
    setAudioOutputDeviceId("scarlett-2i2-id");
    expect(getAudioOutputState().deviceId).toBe("scarlett-2i2-id");
    expect(isDefaultAudioOutput()).toBe(false);
  });

  it("empty string returns to system default", () => {
    setAudioOutputDeviceId("dev");
    setAudioOutputDeviceId("");
    expect(isDefaultAudioOutput()).toBe(true);
  });

  it("coerces non-string to default", () => {
    // @ts-expect-error runtime robustness
    setAudioOutputDeviceId(undefined);
    expect(getAudioOutputDeviceId()).toBe("");
  });
});
