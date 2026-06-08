/**
 * tests/features/api-key-test.test.ts
 *
 * Coverage für interpretApiTestResponse — die Pure-Logik hinter dem neuen
 * "Test"-Button im KI-Settings (Synth.md: "api key wird nicht akzeptiert").
 */
import { describe, it, expect } from "vitest";
import { interpretApiTestResponse } from "../../client/src/utils/aiScriptGenerator";

describe("interpretApiTestResponse", () => {
  it("Happy Path: 200 → ok=true", () => {
    const r = interpretApiTestResponse(200);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/gültig/);
  });

  it("204 (auch 2xx) → ok=true", () => {
    expect(interpretApiTestResponse(204).ok).toBe(true);
  });

  it("401 → Key abgelehnt", () => {
    const r = interpretApiTestResponse(401);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/401/);
    expect(r.message).toMatch(/abgelehnt/);
  });

  it("403 → kein Zugriff/Guthaben", () => {
    expect(interpretApiTestResponse(403).message).toMatch(/403/);
  });

  it("404 → Modell nicht gefunden", () => {
    expect(interpretApiTestResponse(404).message).toMatch(/Modell/);
  });

  it("Edge Case: 400 hängt Body-Snippet an", () => {
    const r = interpretApiTestResponse(400, "invalid model id 'claude-x'");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/invalid model id/);
  });

  it("429 → Rate-Limit/Quota", () => {
    expect(interpretApiTestResponse(429).message).toMatch(/429/);
  });

  it("5xx → Serverfehler", () => {
    expect(interpretApiTestResponse(503).message).toMatch(/Serverfehler/);
  });

  it("unbekannter 4xx-Status → generische Meldung mit Status", () => {
    expect(interpretApiTestResponse(418).message).toMatch(/418/);
  });

  it("schneidet überlangen Body ab (kein UI-Overflow)", () => {
    const long = "x".repeat(1000);
    const r = interpretApiTestResponse(400, long);
    expect(r.message.length).toBeLessThan(200);
  });
});
