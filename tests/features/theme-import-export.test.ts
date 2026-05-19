/**
 * Synthstudio – tests/features/theme-import-export.test.ts (v3.140.0)
 *
 * Pure-Helper-Tests für themeImportExport.ts (Round-Trip + Validation).
 */
import { describe, it, expect } from "vitest";
import type { CustomTheme } from "@/store/useThemeStore";
import {
  serializeTheme,
  parseTheme,
  defaultThemeFilename,
  THEME_EXPORT_MAGIC,
  THEME_EXPORT_SCHEMA_VERSION,
} from "@/utils/themeImportExport";

function makeTheme(overrides: Partial<CustomTheme> = {}): CustomTheme {
  return {
    id: "custom-test-1",
    name: "Test Theme",
    colors: {
      "--ss-bg-base": "#0a0a0f",
      "--ss-bg-panel": "#15151c",
      "--ss-bg-elevated": "#20202a",
      "--ss-text-primary": "#ffffff",
      "--ss-text-muted": "#a0a0b0",
      "--ss-text-dim": "#606070",
      "--ss-border": "#30303a",
      "--ss-border-subtle": "#20202a",
      "--ss-accent-primary": "#00d4ff",
      "--ss-accent-secondary": "#ff00d4",
      "--ss-accent-success": "#00ff90",
      "--ss-accent-danger": "#ff3060",
    },
    ...overrides,
  };
}

describe("themeImportExport", () => {
  describe("serializeTheme", () => {
    it("produces JSON with magic header + schemaVersion + ISO timestamp", () => {
      const theme = makeTheme();
      const json = serializeTheme(theme);
      const env = JSON.parse(json);
      expect(env.magic).toBe(THEME_EXPORT_MAGIC);
      expect(env.schemaVersion).toBe(THEME_EXPORT_SCHEMA_VERSION);
      expect(typeof env.exportedAt).toBe("string");
      expect(env.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("strips id field from theme (import generates fresh ID)", () => {
      const theme = makeTheme({ id: "custom-secret-xyz" });
      const json = serializeTheme(theme);
      expect(json).not.toContain("custom-secret-xyz");
      const env = JSON.parse(json);
      expect(env.theme.id).toBeUndefined();
    });

    it("preserves extras", () => {
      const theme = makeTheme({
        extras: { fontSize: 14, borderRadius: 6, glassEffect: 0.3 },
      });
      const json = serializeTheme(theme);
      const env = JSON.parse(json);
      expect(env.theme.extras.fontSize).toBe(14);
      expect(env.theme.extras.borderRadius).toBe(6);
      expect(env.theme.extras.glassEffect).toBe(0.3);
    });
  });

  describe("parseTheme", () => {
    it("round-trip: serialize → parse liefert identische Werte", () => {
      const theme = makeTheme();
      const json = serializeTheme(theme);
      const parsed = parseTheme(json);
      expect(parsed).not.toBeNull();
      expect(parsed!.name).toBe(theme.name);
      expect(parsed!.colors["--ss-bg-base"]).toBe("#0a0a0f");
      expect(parsed!.colors["--ss-accent-primary"]).toBe("#00d4ff");
    });

    it("returns null bei invalid JSON", () => {
      expect(parseTheme("not json")).toBeNull();
      expect(parseTheme("{")).toBeNull();
      expect(parseTheme("")).toBeNull();
    });

    it("returns null bei fehlendem magic header", () => {
      const env = {
        schemaVersion: 1,
        theme: makeTheme(),
      };
      expect(parseTheme(JSON.stringify(env))).toBeNull();
    });

    it("returns null bei fehlendem Required-Color-Key", () => {
      const theme = makeTheme();
      // @ts-expect-error — Test: löschen eines required keys
      delete theme.colors["--ss-accent-primary"];
      const json = serializeTheme(theme);
      expect(parseTheme(json)).toBeNull();
    });

    it("returns null bei ungültigem Color-String (script-injection-Try)", () => {
      const env = {
        magic: THEME_EXPORT_MAGIC,
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        theme: {
          name: "Bad",
          colors: {
            "--ss-bg-base": "javascript:alert(1)",
            "--ss-bg-panel": "#000",
            "--ss-bg-elevated": "#111",
            "--ss-text-primary": "#fff",
            "--ss-text-muted": "#aaa",
            "--ss-text-dim": "#666",
            "--ss-border": "#222",
            "--ss-border-subtle": "#333",
            "--ss-accent-primary": "#0ff",
            "--ss-accent-secondary": "#f0f",
            "--ss-accent-success": "#0f0",
            "--ss-accent-danger": "#f00",
          },
        },
      };
      expect(parseTheme(JSON.stringify(env))).toBeNull();
    });

    it("strips dangerous customCss (<script> + javascript:)", () => {
      const theme = makeTheme({
        extras: { customCss: "body { color: red; } <script>alert(1)</script>" },
      });
      const json = serializeTheme(theme);
      const parsed = parseTheme(json);
      expect(parsed).not.toBeNull();
      // <script>-tainted Wert → ganz weggelassen (kein partial accept).
      expect(parsed!.extras?.customCss).toBeUndefined();
    });

    it("accepts hex-6, hex-8 (mit alpha), rgb, hsl, oklch, var", () => {
      const theme = makeTheme({
        colors: {
          "--ss-bg-base": "#0a0a0fcc",
          "--ss-bg-panel": "rgb(20, 20, 28)",
          "--ss-bg-elevated": "hsl(240, 10%, 12%)",
          "--ss-text-primary": "oklch(0.95 0 0)",
          "--ss-text-muted": "var(--my-muted)",
          "--ss-text-dim": "#666",
          "--ss-border": "#30303a",
          "--ss-border-subtle": "#20202a",
          "--ss-accent-primary": "#00d4ff",
          "--ss-accent-secondary": "#ff00d4",
          "--ss-accent-success": "#00ff90",
          "--ss-accent-danger": "#ff3060",
        },
      });
      const json = serializeTheme(theme);
      const parsed = parseTheme(json);
      expect(parsed).not.toBeNull();
      expect(parsed!.colors["--ss-bg-panel"]).toBe("rgb(20, 20, 28)");
    });

    it("strips unknown color keys", () => {
      const env = {
        magic: THEME_EXPORT_MAGIC,
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        theme: {
          name: "Plus",
          colors: {
            ...makeTheme().colors,
            "--ss-malicious-key": "purple",
          },
        },
      };
      const parsed = parseTheme(JSON.stringify(env));
      expect(parsed).not.toBeNull();
      expect((parsed!.colors as Record<string, unknown>)["--ss-malicious-key"]).toBeUndefined();
    });

    it("clamps extras: fontSize out-of-range wird verworfen", () => {
      const env = {
        magic: THEME_EXPORT_MAGIC,
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        theme: {
          name: "Out",
          colors: makeTheme().colors,
          extras: { fontSize: 99 },
        },
      };
      const parsed = parseTheme(JSON.stringify(env));
      expect(parsed).not.toBeNull();
      expect(parsed!.extras?.fontSize).toBeUndefined();
    });
  });

  describe("defaultThemeFilename", () => {
    it("sanitizes name + appends .synth-theme.json", () => {
      expect(defaultThemeFilename("My Theme!")).toBe("My-Theme-.synth-theme.json");
    });

    it("fällt auf 'theme' zurück bei leerem Namen", () => {
      expect(defaultThemeFilename("")).toBe("theme.synth-theme.json");
      expect(defaultThemeFilename("   ")).toBe("theme.synth-theme.json");
    });

    it("kürzt zu langen Namen", () => {
      const long = "a".repeat(200);
      const result = defaultThemeFilename(long);
      // 64 chars sanitized name + ".synth-theme.json" (17) = 81 max
      expect(result.length).toBeLessThanOrEqual(81);
    });
  });
});
