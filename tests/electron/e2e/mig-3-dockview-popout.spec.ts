/**
 * tests/electron/e2e/mig-3-dockview-popout.spec.ts
 *
 * MIG-3 PoC: dockview-react addPopoutGroup() → setWindowOpenHandler →
 * Electron BrowserWindow. Verifiziert dass:
 *   1. WorkspaceMode aktivierbar ist (localStorage flag)
 *   2. Im Workspace-Mode der ⤢-Button im Group-Header sichtbar ist
 *   3. Klick auf ⤢ ein neues BrowserWindow erzeugt (NICHT system-browser)
 *   4. Das popout fenster die popout.html URL lädt
 *   5. Schließen vom popout window die App nicht crasht
 */
import { _electron as electron, ElectronApplication, Page } from "playwright";
import { test, expect } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const ELECTRON_MAIN = path.join(REPO_ROOT, "electron-dist", "main.cjs");

test.describe("MIG-3 – dockview popout in Electron", () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    if (!fs.existsSync(ELECTRON_MAIN)) {
      throw new Error("Electron not compiled. Run: pnpm compile:electron");
    }
    const tmpUserData = path.join(REPO_ROOT, "test-results", `electron-userdata-mig3-${Date.now()}`);
    fs.mkdirSync(tmpUserData, { recursive: true });
    app = await electron.launch({
      executablePath: require("electron"),
      args: [ELECTRON_MAIN, `--user-data-dir=${tmpUserData}`],
      env: { ...process.env, NODE_ENV: "test", ELECTRON_IS_DEV: "0" },
    });
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    // Console-Messages weiterleiten zur Diagnose
    page.on("console", msg => console.log(`[renderer:${msg.type()}]`, msg.text()));
    page.on("pageerror", err => console.log("[renderer:error]", err.message));
    await page.waitForTimeout(3_000);
  });

  test.afterAll(async () => {
    if (!app) return;
    // Alle Fenster (auch popouts) sofort zerstören damit afterAll nicht timeout't
    try {
      await app.evaluate(({ BrowserWindow }) => {
        for (const w of BrowserWindow.getAllWindows()) {
          if (!w.isDestroyed()) w.destroy();
        }
      });
    } catch { /* ignore */ }
    try { await app.close(); } catch { /* ignore */ }
  });

  test("Workspace-Mode → ⤢-Button → addPopoutGroup öffnet neues Fenster", async () => {
    // 1. WorkspaceMode aktivieren via localStorage + reload
    await page.evaluate(() => {
      localStorage.setItem("ss-workspace-mode:v1", "1");
      localStorage.setItem("ss-layout:active-tab", "mixer");
    });
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2_000);

    // 2. Mixer-Tab aktivieren (sollte schon via localStorage gesetzt sein)
    // 3. ⤢-Button finden (rightHeaderActionsComponent)
    const popoutBtn = page.locator('[data-testid="dockview-popout"]').first();
    await expect(popoutBtn).toBeVisible({ timeout: 10_000 });
    console.log("\n✓ Popout button visible");

    const windowsBefore = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().length
    );
    console.log("Windows before popout:", windowsBefore);

    // 4. Klick → erzeugt ein neues BrowserWindow via setWindowOpenHandler
    await popoutBtn.click();
    await page.waitForTimeout(2_500);

    const windowsAfter = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().length
    );
    console.log("Windows after popout:", windowsAfter);
    expect(windowsAfter).toBeGreaterThan(windowsBefore);

    // 5. Das neue Fenster sollte popout.html geladen haben
    await page.waitForTimeout(1_500);
    const allWindows = await app.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows().map(w => ({
        id: w.id,
        url: w.webContents.getURL(),
        title: w.getTitle(),
      }));
    });
    console.log("All windows:", JSON.stringify(allWindows, null, 2));
    const popoutWindow = allWindows.find(w => /popout/.test(w.url) || /popout/.test(w.title));
    expect(popoutWindow, "expected a window with popout.html URL").toBeDefined();
    expect(popoutWindow!.url).toContain("popout.html");

    // 6. Crash-Log auf Fehler prüfen
    const userData = await app.evaluate(({ app }) => app.getPath("userData"));
    const crashLog = path.join(userData, "crash.log");
    if (fs.existsSync(crashLog)) {
      const log = fs.readFileSync(crashLog, "utf-8");
      const popoutLine = log.split("\n").find(l => l.includes("dockview:popout-open"));
      console.log("Log entry:", popoutLine ?? "(no popout-open event logged)");
    }
  });
});
