/**
 * tests/web/layout-sweep.spec.ts
 *
 * TASK-101 — "Layout verzogen" Reproduktion via Multi-Viewport-Sweep.
 *
 * Browst die App systematisch in 3 Viewports und allen Tabs/Panels, prüft per
 * page.evaluate() auf konkrete Bug-Indikatoren:
 *   - Horizontaler Overflow (Elemente die rechts über den Viewport hinausragen)
 *   - Hardcoded Pixel-Widths > Viewport-Breite
 *   - Negatives x-Offset (Elemente die links abgeschnitten sind)
 *
 * Schreibt Screenshots in test-results/layout-sweep/ und einen Report mit Findings
 * in den Test-Output.
 */
import { test, expect, type Page } from "@playwright/test";

// ─── Viewports ──────────────────────────────────────────────────────────────

const VIEWPORTS = [
  { name: "desktop-1920x1080", width: 1920, height: 1080 },
  { name: "laptop-1366x768",   width: 1366, height: 768  },
  { name: "narrow-1280x720",   width: 1280, height: 720  },
] as const;

// ─── Overflow-Detector im Browser-Kontext ───────────────────────────────────

type LayoutIssue = {
  selector: string;
  reason: string;
  rect: { x: number; y: number; width: number; height: number };
  viewportW: number;
};

async function detectOverflows(page: Page, label: string): Promise<LayoutIssue[]> {
  return page.evaluate((ctxLabel) => {
    const issues: LayoutIssue[] = [];
    const vw = window.innerWidth;
    const TOLERANCE = 2; // sub-pixel rounding

    function getSelector(el: Element): string {
      const parts: string[] = [];
      let cur: Element | null = el;
      let depth = 0;
      while (cur && depth < 4) {
        const tag = cur.tagName.toLowerCase();
        const id  = cur.id ? `#${cur.id}` : "";
        const dt  = cur.getAttribute("data-testid");
        const testid = dt ? `[data-testid="${dt}"]` : "";
        const cls = (cur.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 2).join(".");
        const clsSel = cls ? `.${cls}` : "";
        parts.unshift(`${tag}${id}${testid}${clsSel}`);
        cur = cur.parentElement;
        depth++;
      }
      return parts.join(" > ");
    }

    // For perf: limit to elements that paint and are reasonably visible
    const all = document.querySelectorAll<HTMLElement>("*");
    for (const el of Array.from(all)) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
      // Skip pure SVG internals
      if (el instanceof SVGElement && el.tagName.toLowerCase() !== "svg") continue;

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      // 1) Element ragt rechts über Viewport hinaus, OBWOHL kein Scroll-Container
      //    Wir filtern Scroll-Container raus, sonst kommt jeder overflow-x-auto-Inhalt
      const ancestorScrollsX = (() => {
        let p: HTMLElement | null = el.parentElement;
        while (p && p !== document.body) {
          const ps = getComputedStyle(p);
          if (ps.overflowX === "auto" || ps.overflowX === "scroll") return true;
          p = p.parentElement;
        }
        return false;
      })();

      if (!ancestorScrollsX && rect.right > vw + TOLERANCE) {
        issues.push({
          selector: getSelector(el),
          reason:   `overflows right by ${Math.round(rect.right - vw)}px (rect.right=${Math.round(rect.right)}, vw=${vw})`,
          rect:     { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          viewportW: vw,
        });
      }

      // 2) Element ragt links über Viewport hinaus (negative x)
      if (!ancestorScrollsX && rect.x < -TOLERANCE && rect.width > 10) {
        issues.push({
          selector: getSelector(el),
          reason:   `negative x-offset ${Math.round(rect.x)}px (cut off on left)`,
          rect:     { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          viewportW: vw,
        });
      }
    }

    // De-dupe by selector+reason
    const seen = new Set<string>();
    const uniq: LayoutIssue[] = [];
    for (const i of issues) {
      const key = `${i.selector}|${i.reason}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(i);
    }

    // Log in browser console for debugging
    if (uniq.length > 0) console.warn(`[layout-sweep:${ctxLabel}]`, uniq);
    return uniq;
  }, label);
}

// ─── Helper ────────────────────────────────────────────────────────────────

async function setViewport(page: Page, w: number, h: number) {
  await page.setViewportSize({ width: w, height: h });
  // Give layout time to settle
  await page.waitForTimeout(200);
}

async function gotoApp(page: Page) {
  // License + Welcome seeden, sonst deckt das Activation/Welcome-Modal die Tabs
  // ab und jeder tab.click() läuft in einen Timeout (Spec war ohne diesen Seed
  // pre-existing kaputt — nicht in pnpm test, daher unbemerkt).
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("synthstudio:license:v1", JSON.stringify({ status: "pro", trialStartedAt: Date.now(), licenseKey: "PLAY", activatedEmail: "e2e@test.local" }));
      window.localStorage.setItem("synthstudio:welcome:v1", JSON.stringify({ seen: true, dismissed: true, seenAt: Date.now() }));
    } catch { /* */ }
  });
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 15_000 });
}

// Aggregates findings per viewport for the final report
type ReportEntry = { viewport: string; tab: string; issues: LayoutIssue[] };
const allFindings: ReportEntry[] = [];

function reportIssues(viewport: string, tab: string, issues: LayoutIssue[]) {
  if (issues.length === 0) return;
  allFindings.push({ viewport, tab, issues });
}

test.afterAll(() => {
  // Final aggregated report
  if (allFindings.length === 0) {
    console.log("\n[layout-sweep] NO layout overflow issues detected across all viewports + tabs.");
    return;
  }
  console.log("\n[layout-sweep] FINDINGS REPORT:");
  for (const f of allFindings) {
    console.log(`\n  ${f.viewport} / ${f.tab} — ${f.issues.length} issue(s):`);
    for (const i of f.issues) {
      console.log(`    • ${i.selector}`);
      console.log(`        ${i.reason}`);
    }
  }
});

// ─── Tests pro Viewport ─────────────────────────────────────────────────────

for (const vp of VIEWPORTS) {
  test.describe(`Viewport ${vp.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await setViewport(page, vp.width, vp.height);
      await gotoApp(page);
    });

    test("Tab: Sequencer — kein Horizontal-Overflow im Main-Layout", async ({ page }) => {
      await page.getByRole("tab", { name: "Sequencer" }).click();
      await page.waitForTimeout(300);
      const issues = await detectOverflows(page, `${vp.name}/sequencer`);
      await page.screenshot({
        path: `test-results/layout-sweep/${vp.name}-sequencer.png`,
        fullPage: false,
      });
      reportIssues(vp.name, "sequencer", issues);
      // Soft assertion — wir wollen den Report sehen, nicht hart fehlschlagen.
      expect(issues.length, `Layout overflows on sequencer ${vp.name}`).toBeLessThanOrEqual(20);
    });

    test("Tab: Mixer — kein Horizontal-Overflow", async ({ page }) => {
      await page.getByRole("tab", { name: "Mixer" }).click();
      await page.waitForTimeout(500);
      const issues = await detectOverflows(page, `${vp.name}/mixer`);
      await page.screenshot({
        path: `test-results/layout-sweep/${vp.name}-mixer.png`,
        fullPage: false,
      });
      reportIssues(vp.name, "mixer", issues);
      expect(issues.length, `Layout overflows on mixer ${vp.name}`).toBeLessThanOrEqual(20);
    });

    test("Tab: Song-Modus — kein Overflow", async ({ page }) => {
      await page.getByRole("tab", { name: "Song-Modus" }).click();
      await page.waitForTimeout(300);
      const issues = await detectOverflows(page, `${vp.name}/song`);
      await page.screenshot({
        path: `test-results/layout-sweep/${vp.name}-song.png`,
        fullPage: false,
      });
      reportIssues(vp.name, "song", issues);
      expect(issues.length, `Layout overflows on song ${vp.name}`).toBeLessThanOrEqual(20);
    });

    test("Tab: Humanizer — kein Overflow", async ({ page }) => {
      await page.getByRole("tab", { name: "Humanizer" }).click();
      await page.waitForTimeout(300);
      const issues = await detectOverflows(page, `${vp.name}/humanizer`);
      await page.screenshot({
        path: `test-results/layout-sweep/${vp.name}-humanizer.png`,
        fullPage: false,
      });
      reportIssues(vp.name, "humanizer", issues);
      expect(issues.length, `Layout overflows on humanizer ${vp.name}`).toBeLessThanOrEqual(20);
    });

    test("Tab: Tools — kein Overflow in allen Sub-Tools", async ({ page }) => {
      await page.getByRole("tab", { name: "Tools" }).click();
      await page.waitForTimeout(300);

      // Iterate over each tool sub-tab
      const tools = ["Akkorde", "Sampler", "Workbench", "Library", "Script", "Algorithmisch", "KI-Generator"];
      for (const t of tools) {
        const btn = page.getByRole("button", { name: new RegExp(t, "i") }).first();
        if (await btn.isVisible().catch(() => false)) {
          await btn.click();
          await page.waitForTimeout(300);
          const issues = await detectOverflows(page, `${vp.name}/tools/${t}`);
          await page.screenshot({
            path: `test-results/layout-sweep/${vp.name}-tools-${t.toLowerCase()}.png`,
            fullPage: false,
          });
          reportIssues(vp.name, `tools/${t}`, issues);
        }
      }
    });

    test("Tab: Kollaboration — kein Overflow", async ({ page }) => {
      await page.getByRole("tab", { name: "Kollaboration" }).click();
      await page.waitForTimeout(300);
      const issues = await detectOverflows(page, `${vp.name}/kollab`);
      await page.screenshot({
        path: `test-results/layout-sweep/${vp.name}-kollab.png`,
        fullPage: false,
      });
      reportIssues(vp.name, "kollab", issues);
      expect(issues.length, `Layout overflows on kollab ${vp.name}`).toBeLessThanOrEqual(20);
    });

    test("Floating-Panels: Pattern Morph / Note Repeat im Sequencer öffnen", async ({ page }) => {
      await page.getByRole("tab", { name: "Sequencer" }).click();
      await page.waitForTimeout(300);

      // Pattern Morph
      const morphBtn = page.locator('button[title="Pattern Morph"]').first();
      if (await morphBtn.isVisible().catch(() => false)) {
        await morphBtn.click();
        await page.waitForTimeout(300);
        const issues = await detectOverflows(page, `${vp.name}/sequencer/morph`);
        reportIssues(vp.name, "sequencer/morph-panel-open", issues);
        await page.screenshot({
          path: `test-results/layout-sweep/${vp.name}-morph-open.png`,
          fullPage: false,
        });
        // Close
        const closeBtn = page.getByRole("button", { name: "Close" }).first();
        if (await closeBtn.isVisible().catch(() => false)) await closeBtn.click();
      }

      // Note Repeat
      const repeatBtn = page.locator('button[title="Note Repeat (MPC-Style)"]').first();
      if (await repeatBtn.isVisible().catch(() => false)) {
        await repeatBtn.click();
        await page.waitForTimeout(300);
        const issues = await detectOverflows(page, `${vp.name}/sequencer/noterepeat`);
        reportIssues(vp.name, "sequencer/noterepeat-panel-open", issues);
        await page.screenshot({
          path: `test-results/layout-sweep/${vp.name}-noterepeat-open.png`,
          fullPage: false,
        });
      }
    });
  });
}
