/**
 * tests/electron/csp-header.test.ts
 *
 * Unit-Tests für den CSP-Builder aus electron/csp.ts (TASK-107 / v1.18).
 *
 * Die Tests stellen sicher, dass:
 *  - alle für die Sandbox-Worker (v1.17) + Kollaboration + Tailwind nötigen
 *    Directives vorhanden sind und korrekt formatiert werden
 *  - der Production-Header keine Dev-only-Origins enthält
 *  - der Dev-Header das Vite-HMR-Setup nicht blockt
 *  - die Serialisierung deterministisch ist (Snapshot)
 *
 * Wichtig: Diese Tests laufen in Vitest unter Node — sie importieren KEIN
 * Electron, weil electron/csp.ts pure ist.
 */
import { describe, it, expect } from "vitest";
import {
  CSP_DIRECTIVES_PROD,
  CSP_DIRECTIVES_DEV,
  buildCspHeader,
  buildProductionCsp,
  buildDevCsp,
  buildCspForMode,
  type CspDirective,
} from "../../electron/csp";

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

function getDirective(
  directives: readonly CspDirective[],
  name: string
): readonly string[] | undefined {
  return directives.find(([n]) => n === name)?.[1];
}

function headerToMap(header: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const segment of header.split(";")) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const [name, ...values] = trimmed.split(/\s+/);
    result.set(name, values);
  }
  return result;
}

// ─── Tests: Pflicht-Directives ────────────────────────────────────────────────

describe("CSP — Pflicht-Directives (TASK-107)", () => {
  it("default-src 'self' ist gesetzt (Basis)", () => {
    expect(getDirective(CSP_DIRECTIVES_PROD, "default-src")).toEqual(["'self'"]);
    expect(getDirective(CSP_DIRECTIVES_DEV, "default-src")).toEqual(["'self'"]);
  });

  it("script-src 'self' ist gesetzt (Vite bundled, keine inline scripts)", () => {
    const prod = getDirective(CSP_DIRECTIVES_PROD, "script-src");
    expect(prod).toEqual(["'self'"]);
    expect(prod).not.toContain("'unsafe-inline'");
    expect(prod).not.toContain("'unsafe-eval'");
  });

  it("style-src enthält 'self' und 'unsafe-inline' (Tailwind v4 JIT)", () => {
    const prod = getDirective(CSP_DIRECTIVES_PROD, "style-src");
    expect(prod).toContain("'self'");
    expect(prod).toContain("'unsafe-inline'");
  });

  it("img-src erlaubt 'self', data:, blob: (Inline-Bilder + Waveform-Bitmaps)", () => {
    const prod = getDirective(CSP_DIRECTIVES_PROD, "img-src");
    expect(prod).toContain("'self'");
    expect(prod).toContain("data:");
    expect(prod).toContain("blob:");
  });

  it("media-src erlaubt 'self', blob:, file: (Electron file:// + Web blobs)", () => {
    const prod = getDirective(CSP_DIRECTIVES_PROD, "media-src");
    expect(prod).toContain("'self'");
    expect(prod).toContain("blob:");
    expect(prod).toContain("file:");
  });

  it("worker-src enthält 'self' und blob: (v1.17 Sandbox via Blob-URL Worker)", () => {
    const prod = getDirective(CSP_DIRECTIVES_PROD, "worker-src");
    expect(prod).toContain("'self'");
    expect(prod).toContain("blob:");
  });

  it("connect-src erlaubt 'self', ws:, wss: (LAN-WebSocket-Kollaboration)", () => {
    const prod = getDirective(CSP_DIRECTIVES_PROD, "connect-src");
    expect(prod).toContain("'self'");
    expect(prod).toContain("ws:");
    expect(prod).toContain("wss:");
  });

  it("connect-src erlaubt api.openai.com + api.anthropic.com (BUG-024, v1.67)", () => {
    // AI-Script-Generator + Project-Analysis + Pattern-Generator rufen direkt
    // fetch() auf diese Hosts auf. Ohne diese Einträge blockt CSP den Call
    // im gepackten Electron-Build → User-Symptom: 'KI Script-Generator geht
    // nicht trotz API-Key'.
    const prod = getDirective(CSP_DIRECTIVES_PROD, "connect-src");
    expect(prod).toContain("https://api.openai.com");
    expect(prod).toContain("https://api.anthropic.com");

    const dev = getDirective(CSP_DIRECTIVES_DEV, "connect-src");
    expect(dev).toContain("https://api.openai.com");
    expect(dev).toContain("https://api.anthropic.com");
  });

  it("object-src 'none' (keine Plugins/Flash)", () => {
    expect(getDirective(CSP_DIRECTIVES_PROD, "object-src")).toEqual(["'none'"]);
    expect(getDirective(CSP_DIRECTIVES_DEV, "object-src")).toEqual(["'none'"]);
  });

  it("base-uri 'self' (verhindert <base href> Hijack)", () => {
    expect(getDirective(CSP_DIRECTIVES_PROD, "base-uri")).toEqual(["'self'"]);
    expect(getDirective(CSP_DIRECTIVES_DEV, "base-uri")).toEqual(["'self'"]);
  });

  it("form-action 'self' (verhindert externes Form-Submit)", () => {
    expect(getDirective(CSP_DIRECTIVES_PROD, "form-action")).toEqual(["'self'"]);
    expect(getDirective(CSP_DIRECTIVES_DEV, "form-action")).toEqual(["'self'"]);
  });

  it("Production hat frame-ancestors 'none' (Clickjacking-Schutz)", () => {
    expect(getDirective(CSP_DIRECTIVES_PROD, "frame-ancestors")).toEqual(["'none'"]);
  });
});

// ─── Tests: Production vs Development ─────────────────────────────────────────

describe("CSP — Production vs Development", () => {
  it("Production-script-src enthält KEINE localhost-Origins", () => {
    const prod = getDirective(CSP_DIRECTIVES_PROD, "script-src");
    expect(prod?.some((v) => v.includes("localhost"))).toBe(false);
    expect(prod?.some((v) => v.includes("127.0.0.1"))).toBe(false);
  });

  it("Production verbietet 'unsafe-eval' überall", () => {
    for (const [, values] of CSP_DIRECTIVES_PROD) {
      expect(values).not.toContain("'unsafe-eval'");
    }
  });

  it("Development-script-src enthält localhost + 127.0.0.1 (Vite-HMR)", () => {
    const dev = getDirective(CSP_DIRECTIVES_DEV, "script-src");
    expect(dev).toContain("http://localhost:*");
    expect(dev).toContain("http://127.0.0.1:*");
  });

  it("Development-connect-src enthält ws://localhost:* (Vite-HMR-Socket)", () => {
    const dev = getDirective(CSP_DIRECTIVES_DEV, "connect-src");
    expect(dev).toContain("ws://localhost:*");
    expect(dev).toContain("ws://127.0.0.1:*");
  });

  it("Development verbietet 'unsafe-eval' (Vite nutzt esbuild, kein eval)", () => {
    for (const [, values] of CSP_DIRECTIVES_DEV) {
      expect(values).not.toContain("'unsafe-eval'");
    }
  });

  it("buildCspForMode(true) === buildDevCsp()", () => {
    expect(buildCspForMode(true)).toBe(buildDevCsp());
  });

  it("buildCspForMode(false) === buildProductionCsp()", () => {
    expect(buildCspForMode(false)).toBe(buildProductionCsp());
  });
});

// ─── Tests: Serialisierung / Header-Format ────────────────────────────────────

describe("CSP — Serialisierung", () => {
  it("buildCspHeader formatiert Directives als 'name v1 v2; name v1 v2'", () => {
    const directives: readonly CspDirective[] = [
      ["default-src", ["'self'"]],
      ["img-src", ["'self'", "data:"]],
    ];
    expect(buildCspHeader(directives)).toBe(
      "default-src 'self'; img-src 'self' data:"
    );
  });

  it("buildCspHeader behandelt einzelne Directive korrekt", () => {
    expect(buildCspHeader([["object-src", ["'none'"]]])).toBe("object-src 'none'");
  });

  it("buildCspHeader gibt bei leeren Werten nur den Namen zurück (defensive)", () => {
    expect(buildCspHeader([["sandbox", []]])).toBe("sandbox");
  });

  it("Production-Header ist deterministisch (gleiche Aufrufe → gleicher String)", () => {
    expect(buildProductionCsp()).toBe(buildProductionCsp());
  });

  it("Dev-Header ist deterministisch (gleiche Aufrufe → gleicher String)", () => {
    expect(buildDevCsp()).toBe(buildDevCsp());
  });

  it("Production-Header enthält alle 12 Pflicht-Directives in Reihenfolge", () => {
    const header = buildProductionCsp();
    const map = headerToMap(header);
    expect([...map.keys()]).toEqual([
      "default-src",
      "script-src",
      "style-src",
      "img-src",
      "media-src",
      "font-src",
      "worker-src",
      "connect-src",
      "object-src",
      "base-uri",
      "form-action",
      "frame-ancestors",
    ]);
  });

  it("Production-Header startet mit default-src 'self'", () => {
    expect(buildProductionCsp().startsWith("default-src 'self'; ")).toBe(true);
  });

  it("Production-Header enthält worker-src 'self' blob: als zusammenhängendes Segment", () => {
    // Bricht v1.17 Sandbox wenn das nicht stimmt → harter Regression-Test
    expect(buildProductionCsp()).toContain("worker-src 'self' blob:");
  });

  it("Production-Header endet mit frame-ancestors 'none' (kein trailing semicolon)", () => {
    const header = buildProductionCsp();
    expect(header.endsWith("frame-ancestors 'none'")).toBe(true);
    expect(header.endsWith(";")).toBe(false);
  });
});

// ─── Tests: Snapshot (Drift-Schutz) ───────────────────────────────────────────

describe("CSP — Snapshot (verhindert unbeabsichtigte Änderungen)", () => {
  it("Production-CSP-Header-Snapshot", () => {
    // Wenn dieser Snapshot bricht: bewusste Änderung?
    //  → docs/SECURITY-SCRIPT-SANDBOX.md updaten,
    //  → alle Pflicht-Directive-Tests müssen grün bleiben.
    expect(buildProductionCsp()).toMatchSnapshot();
  });

  it("Development-CSP-Header-Snapshot", () => {
    expect(buildDevCsp()).toMatchSnapshot();
  });
});
