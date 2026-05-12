/**
 * tests/features/ai-project-analysis.test.ts
 *
 * Unit-Tests für die KI-Projekt-Analyse.
 * fetch wird gemockt – keine echten API-Calls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { analyzeProjectWithAi, buildSnapshot } from "../../client/src/utils/aiProjectAnalysis";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("buildSnapshot", () => {
  it("erstellt einen Snapshot mit korrekter BPM + Pattern-Name", () => {
    const snap = buildSnapshot(140, {
      name: "Test Pattern",
      stepCount: 16,
      parts: [],
    });
    expect(snap.bpm).toBe(140);
    expect(snap.patternName).toBe("Test Pattern");
    expect(snap.stepCount).toBe(16);
    expect(snap.parts).toEqual([]);
  });

  it("berechnet activeStepCount korrekt", () => {
    const snap = buildSnapshot(120, {
      name: "Test",
      stepCount: 8,
      parts: [{
        name: "Kick",
        volume: 0.8, pan: 0, muted: false, soloed: false,
        steps: [
          { active: true, velocity: 100 },
          { active: false },
          { active: true, velocity: 80 },
          { active: false },
        ],
        fx: { filterEnabled: false, reverbEnabled: false, delayEnabled: false,
              distortionEnabled: false, compressorEnabled: false, eqEnabled: false },
      }],
    });
    expect(snap.parts[0].activeStepCount).toBe(2);
    expect(snap.parts[0].avgVelocity).toBe(90); // (100+80)/2
  });

  it("avgVelocity = 0 bei leeren Steps", () => {
    const snap = buildSnapshot(120, {
      name: "Test",
      stepCount: 4,
      parts: [{
        name: "Empty",
        volume: 0.5, pan: 0, muted: false, soloed: false,
        steps: [{ active: false }, { active: false }],
        fx: { filterEnabled: false, reverbEnabled: false, delayEnabled: false,
              distortionEnabled: false, compressorEnabled: false, eqEnabled: false },
      }],
    });
    expect(snap.parts[0].avgVelocity).toBe(0);
  });
});

describe("analyzeProjectWithAi", () => {
  it("wirft Error wenn kein API-Key", async () => {
    const snap = buildSnapshot(120, { name: "T", stepCount: 16, parts: [] });
    await expect(analyzeProjectWithAi(snap, "")).rejects.toThrow(/API-Key/);
  });

  it("parst gültige JSON-Antwort korrekt", async () => {
    const mockResponse = {
      content: [{
        type: "text",
        text: '```json\n{"summary":"Sehr gut","recommendations":[{"title":"Bass mehr","severity":"info","detail":"Volume erhöhen"}]}\n```',
      }],
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const snap = buildSnapshot(140, { name: "T", stepCount: 16, parts: [] });
    const result = await analyzeProjectWithAi(snap, "fake-key");
    expect(result.summary).toBe("Sehr gut");
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0].title).toBe("Bass mehr");
  });

  it("parst Antwort auch ohne Markdown-Code-Block", async () => {
    const mockResponse = {
      content: [{
        type: "text",
        text: '{"summary":"OK","recommendations":[]}',
      }],
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const snap = buildSnapshot(120, { name: "T", stepCount: 16, parts: [] });
    const result = await analyzeProjectWithAi(snap, "fake-key");
    expect(result.summary).toBe("OK");
  });

  it("wirft Error bei API-Fehler-Status", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    } as Response);

    const snap = buildSnapshot(120, { name: "T", stepCount: 16, parts: [] });
    await expect(analyzeProjectWithAi(snap, "fake-key")).rejects.toThrow(/API-Fehler 401/);
  });

  it("wirft Error bei ungültiger JSON-Antwort", async () => {
    const mockResponse = {
      content: [{ type: "text", text: "Das ist kein JSON" }],
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const snap = buildSnapshot(120, { name: "T", stepCount: 16, parts: [] });
    await expect(analyzeProjectWithAi(snap, "fake-key")).rejects.toThrow(/konnte nicht geparst/);
  });

  it("sendet korrekten POST-Request mit allen Headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: '{"summary":"X","recommendations":[]}' }],
      }),
    } as Response);
    global.fetch = fetchMock;

    const snap = buildSnapshot(140, { name: "T", stepCount: 16, parts: [] });
    await analyzeProjectWithAi(snap, "my-key");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.method).toBe("POST");
    expect(init.headers["x-api-key"]).toBe("my-key");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
  });
});
