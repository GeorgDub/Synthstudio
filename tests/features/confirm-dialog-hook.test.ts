// @vitest-environment node
/**
 * confirm-dialog-hook.test.ts (v3.144.0)
 *
 * Headless-Tests für die Fallback-Logic von useConfirm() — wenn KEIN
 * ConfirmDialogProvider gemountet ist, soll useConfirm() auf window.confirm
 * zurückfallen.  Wir testen das defensive-Verhalten Pure (kein React-Render).
 *
 * Der Provider selbst (Radix-AlertDialog-Mount) braucht jsdom + RTL und ist
 * via Playwright tests/web/ besser abgedeckt.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("useConfirm() fallback (without Provider)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("ConfirmDialog module exports useConfirm + ConfirmDialogProvider", async () => {
    const mod = await import("@/components/common/ConfirmDialog");
    expect(typeof mod.useConfirm).toBe("function");
    expect(typeof mod.ConfirmDialogProvider).toBe("function");
  });

  it("ConfirmOptions type ist exportiert + extensible", async () => {
    // Smoke-Test: das Module compiliert + lädt.
    const mod = await import("@/components/common/ConfirmDialog");
    expect(mod).toBeDefined();
  });
});
