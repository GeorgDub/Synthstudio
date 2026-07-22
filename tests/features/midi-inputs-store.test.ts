import { describe, it, expect, beforeEach } from "vitest";
import {
  defaultInputConfig,
  roleAcceptsCc,
  roleAcceptsNote,
  roleAcceptsSysex,
  roleAcceptsClock,
  getInputConfig,
  isInputEnabled,
  enabledInputNames,
  setInputEnabled,
  setInputRole,
  removeInputConfig,
  migrateSingleInput,
  getMidiInputsState,
  __resetMidiInputsForTests,
} from "../../client/src/store/useMidiInputsStore";

describe("role gates (pure)", () => {
  it("'all' accepts every message type", () => {
    expect(roleAcceptsCc("all")).toBe(true);
    expect(roleAcceptsNote("all")).toBe(true);
    expect(roleAcceptsSysex("all")).toBe(true);
    expect(roleAcceptsClock("all")).toBe(true);
  });
  it("'controller' = CC + notes only", () => {
    expect(roleAcceptsCc("controller")).toBe(true);
    expect(roleAcceptsNote("controller")).toBe(true);
    expect(roleAcceptsSysex("controller")).toBe(false);
    expect(roleAcceptsClock("controller")).toBe(false);
  });
  it("'keys' = notes only", () => {
    expect(roleAcceptsNote("keys")).toBe(true);
    expect(roleAcceptsCc("keys")).toBe(false);
    expect(roleAcceptsSysex("keys")).toBe(false);
  });
  it("'sysex' = sysex only (E2S device comm)", () => {
    expect(roleAcceptsSysex("sysex")).toBe(true);
    expect(roleAcceptsCc("sysex")).toBe(false);
    expect(roleAcceptsNote("sysex")).toBe(false);
    expect(roleAcceptsClock("sysex")).toBe(false);
  });
  it("'clock' = clock only (external tempo master)", () => {
    expect(roleAcceptsClock("clock")).toBe(true);
    expect(roleAcceptsCc("clock")).toBe(false);
    expect(roleAcceptsNote("clock")).toBe(false);
  });
});

describe("useMidiInputsStore state", () => {
  beforeEach(() => __resetMidiInputsForTests());

  it("default config is disabled + role 'all'", () => {
    expect(defaultInputConfig()).toEqual({ enabled: false, role: "all" });
    expect(getInputConfig("Unknown")).toEqual({ enabled: false, role: "all" });
    expect(isInputEnabled("Unknown")).toBe(false);
  });

  it("enable/disable + role, tracked by name (multi-device)", () => {
    setInputEnabled("Electribe 2", true);
    setInputRole("Electribe 2", "sysex");
    setInputEnabled("Akai MPK", true);
    setInputRole("Akai MPK", "controller");
    expect(enabledInputNames().sort()).toEqual(["Akai MPK", "Electribe 2"]);
    expect(getInputConfig("Electribe 2")).toEqual({
      enabled: true,
      role: "sysex",
    });
    expect(getInputConfig("Akai MPK").role).toBe("controller");
    // disabling one leaves the other active (parallel devices)
    setInputEnabled("Akai MPK", false);
    expect(enabledInputNames()).toEqual(["Electribe 2"]);
  });

  it("setting role preserves enabled and vice versa", () => {
    setInputEnabled("Dev", true);
    setInputRole("Dev", "keys");
    expect(getInputConfig("Dev")).toEqual({ enabled: true, role: "keys" });
  });

  it("remove deletes a device's config", () => {
    setInputEnabled("Dev", true);
    removeInputConfig("Dev");
    expect("Dev" in getMidiInputsState().byName).toBe(false);
  });
});

describe("migrateSingleInput", () => {
  beforeEach(() => __resetMidiInputsForTests());

  it("adopts the old single device as enabled 'all' when config is empty", () => {
    expect(migrateSingleInput("Old Device")).toBe(true);
    expect(getInputConfig("Old Device")).toEqual({
      enabled: true,
      role: "all",
    });
  });

  it("is a no-op when devices already configured or name is null", () => {
    setInputEnabled("Existing", true);
    expect(migrateSingleInput("Old Device")).toBe(false);
    expect("Old Device" in getMidiInputsState().byName).toBe(false);
    __resetMidiInputsForTests();
    expect(migrateSingleInput(null)).toBe(false);
  });
});
