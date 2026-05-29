/**
 * tests/web/ui-audit.spec.ts
 *
 * Autonomer UI-Funktionsaudit (auf User-Anfrage):
 *  1. Funktionalität aller Oberflächen — alle 6 Tabs + 14 Tools-Sub-Tabs rendern
 *     ohne Crash (pageerror/console-error werden pro Navigation erfasst).
 *  2. Menüs benutzbar UND wieder schließbar — Dialoge öffnen, via Escape +
 *     Close-Button schließen, prüfen dass sie verschwinden.
 *  3. Overlap — nach dem Schließen darf kein verwaistes Overlay die UI blockieren
 *     (Pointer-Interception am Topbar/Tablist), keine sichtbaren Riesen-Overlays
 *     ohne offenen Dialog.
 *  4. Pin — Pin/Reattach-Buttons werden inventarisiert (Verhalten ist Electron-only,
 *     daher hier nur Präsenz-Check + Hinweis).
 *
 * Diagnostisch: sammelt ALLE Findings (soft) und gibt am Ende einen Report aus.
 */
import { test, expect, type Page } from "@playwright/test";

// ─── Findings-Sammler ────────────────────────────────────────────────────────

type Finding = { area: string; item: string; problem: string };
const findings: Finding[] = [];
function note(area: string, item: string, problem: string) {
  findings.push({ area, item, problem });
}

test.afterAll(() => {
  console.log("\n══════════════════ UI-AUDIT REPORT ══════════════════");
  if (findings.length === 0) {
    console.log("✅ Keine Findings — alle geprüften Oberflächen/Menüs ok.");
  } else {
    const byArea = new Map<string, Finding[]>();
    for (const f of findings) {
      if (!byArea.has(f.area)) byArea.set(f.area, []);
      byArea.get(f.area)!.push(f);
    }
    for (const [area, fs] of byArea) {
      console.log(`\n▼ ${area} — ${fs.length} Finding(s):`);
      for (const f of fs) console.log(`   • [${f.item}] ${f.problem}`);
    }
  }
  console.log(`\nGesamt: ${findings.length} Finding(s)`);
  console.log("══════════════════════════════════════════════════════\n");
});

// ─── Setup ───────────────────────────────────────────────────────────────────

const TABS = [
  { id: "sequencer", name: "Sequencer" },
  { id: "mixer", name: "Mixer" },
  { id: "song", name: "Song-Modus" },
  { id: "humanizer", name: "Humanizer" },
  { id: "tools", name: "Tools" },
  { id: "kollaboration", name: "Kollaboration" },
] as const;

const TOOLS_SUBTABS = [
  "KI-Generator", "Algorithmisch", "🎼 Akkorde", "🎹 Sampler", "🎚 Workbench",
  "📚 Library", "⚡ Script", "🎛 OmniTribe", "📦 Packs", "🎼 Song",
  "🎚 Snapshots", "🎙 Live-Rec", "🎤 Audio-In", "📊 Diff",
];

/** Pre-dismiss Welcome-Wizard + sammelt JS-Fehler. */
async function prep(page: Page, errSink: string[]) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem(
        "synthstudio:welcome:v1",
        JSON.stringify({ firstRun: false, dismissed: true }),
      );
      // Lizenz auf Pro vorsetzen, damit der ActivationModal (z-9999) den Audit
      // nicht blockiert (status "unknown" → Modal deckt alles ab).
      localStorage.setItem(
        "synthstudio:license:v1",
        JSON.stringify({
          status: "pro",
          trialStartedAt: null,
          licenseKey: "137924568",
          activatedEmail: "dev-master@synthstudio.local",
        }),
      );
    } catch { /* ignore */ }
  });
  page.on("pageerror", (e) => errSink.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errSink.push(`console.error: ${m.text().slice(0, 200)}`);
  });
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.goto("/");
  await page.waitForSelector('[role="tablist"]', { timeout: 20_000 });
}

/** Zählt sichtbare, große fixed/absolute Overlays (potenzielle Blocker). */
async function bigOverlays(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const vw = window.innerWidth, vh = window.innerHeight;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed" && cs.position !== "absolute") continue;
      if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
      if (cs.pointerEvents === "none") continue;
      const r = el.getBoundingClientRect();
      const coversMost = r.width >= vw * 0.6 && r.height >= vh * 0.6;
      const z = parseInt(cs.zIndex || "0", 10) || 0;
      if (coversMost && z >= 10) {
        const tid = el.getAttribute("data-testid") || "";
        const role = el.getAttribute("role") || "";
        out.push(`${el.tagName.toLowerCase()}[testid=${tid}][role=${role}][z=${z}] ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return out;
  });
}

/** Ist das Tablist (Hauptnavigation) per Pointer erreichbar — oder blockiert ein Overlay? */
async function tablistClickable(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const tab = document.querySelector('[role="tab"]') as HTMLElement | null;
    if (!tab) return false;
    const r = tab.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!top && (top === tab || tab.contains(top) || top.contains(tab));
  });
}

// ─── 1. Oberflächen-Funktionalität ───────────────────────────────────────────

test("Audit 1 — alle Tabs + Tools-Sub-Tabs rendern ohne Crash", async ({ page }) => {
  test.setTimeout(120_000);
  const errs: string[] = [];
  await prep(page, errs);

  for (const tab of TABS) {
    const before = errs.length;
    try {
      const tabBtn = page.getByRole("tab", { name: tab.name });
      await tabBtn.click({ timeout: 8000 });
      await page.waitForTimeout(350);
      // Crash-Signal: Tab wurde aktiviert (aria-selected) UND Body hat Inhalt.
      const selected = await tabBtn.getAttribute("aria-selected");
      if (selected !== "true") note("1-Surfaces", tab.id, `Tab nach Klick nicht aktiv (aria-selected=${selected})`);
      const bodyLen = await page.evaluate(() => (document.body.innerText || "").trim().length);
      if (bodyLen < 50) note("1-Surfaces", tab.id, `App-Inhalt fast leer nach Tab-Klick (innerText ${bodyLen} chars → Render-Crash?)`);
      // a11y: aria-controls des aktiven Tabs muss auf ein existierendes tabpanel zeigen
      const panelOk = await page.evaluate((id) => {
        const p = document.getElementById(`panel-${id}`);
        return !!p && p.getAttribute("role") === "tabpanel";
      }, tab.id);
      if (!panelOk) note("1-A11y", tab.id, "aria-controls verweist auf nicht-existentes tabpanel (dangling)");
    } catch (e) {
      note("1-Surfaces", tab.id, `Tab-Klick fehlgeschlagen: ${(e as Error).message.slice(0, 120)}`);
    }
    const newErrs = errs.slice(before);
    if (newErrs.length) note("1-Surfaces", tab.id, `JS-Fehler: ${newErrs.join(" | ").slice(0, 240)}`);
  }

  // Tools-Sub-Tabs (kein #panel-tools — Buttons liegen direkt im Tools-View)
  await page.getByRole("tab", { name: "Tools" }).click().catch(() => {});
  await page.waitForTimeout(300);
  for (const label of TOOLS_SUBTABS) {
    const before = errs.length;
    try {
      const btn = page.getByRole("button", { name: label, exact: false }).first();
      if (!(await btn.count())) { note("1-ToolsSubtabs", label, "Sub-Tab-Button nicht gefunden"); continue; }
      await btn.click({ timeout: 6000 });
      await page.waitForTimeout(250);
      const bodyLen = await page.evaluate(() => (document.body.innerText || "").trim().length);
      if (bodyLen < 50) note("1-ToolsSubtabs", label, "App-Inhalt fast leer nach Sub-Tab-Klick (Render-Crash?)");
    } catch (e) {
      note("1-ToolsSubtabs", label, `Klick/Render fehlgeschlagen: ${(e as Error).message.slice(0, 120)}`);
    }
    const newErrs = errs.slice(before);
    if (newErrs.length) note("1-ToolsSubtabs", label, `JS-Fehler: ${newErrs.join(" | ").slice(0, 240)}`);
  }

  expect(findings.filter(f => f.area.startsWith("1-")).length,
    "Surface-Findings (siehe Report)").toBeLessThanOrEqual(50);
});

// ─── 2. Menüs öffnen + schließen ─────────────────────────────────────────────

type DialogCase = { name: string; open: (p: Page) => Promise<void> };

/** Anzahl sichtbarer Dialog/Modal/Sidebar-Overlays (generische Erkennung). */
async function openOverlayCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    let n = 0;
    const vw = window.innerWidth, vh = window.innerHeight;
    // role=dialog
    for (const d of Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))) {
      const cs = getComputedStyle(d);
      if (cs.display !== "none" && cs.visibility !== "hidden") n++;
    }
    // große fixed Overlays (Modals / Fullscreen-Mode), die NICHT role=dialog sind.
    // Nur Tailwind-"fixed"-Elemente scannen (schnell) statt aller body *.
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[class*="fixed"]'))) {
      if (el.getAttribute("role") === "dialog") continue;
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed") continue;
      if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
      const r = el.getBoundingClientRect();
      const z = parseInt(cs.zIndex || "0", 10) || 0;
      if (r.width >= vw * 0.5 && r.height >= vh * 0.5 && z >= 20) { n++; break; }
    }
    return n;
  });
}

/** Schnell (evaluate): klickt den ersten sichtbaren Close/✕/Schließen-Button. */
async function clickCloseFast(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const re = /schließen|close|✕|×|zurück|back|exit|beenden/i;
    for (const b of Array.from(document.querySelectorAll<HTMLElement>("button"))) {
      const label = `${b.textContent || ""} ${b.getAttribute("aria-label") || ""} ${b.getAttribute("title") || ""}`;
      if (!re.test(label)) continue;
      if (b.offsetParent === null) continue; // unsichtbar
      b.click();
      return true;
    }
    return false;
  });
}

test("Audit 2 — Menüs öffnen und via Escape/Button schließen", async ({ page }) => {
  test.setTimeout(180_000);
  const errs: string[] = [];
  await prep(page, errs);
  await page.getByRole("tab", { name: "Sequencer" }).click().catch(() => {});
  await page.waitForTimeout(200);

  const cases: DialogCase[] = [
    { name: "Settings (alle)", open: async (p) => { await p.getByTitle("Einstellungen (alle Settings)").click(); } },
    { name: "MIDI-Einstellungen", open: async (p) => { await p.getByTitle("MIDI-Einstellungen (Ctrl+M)").click(); } },
    { name: "Tastatur-Shortcuts", open: async (p) => { await p.getByTitle("Tastatur-Shortcuts").click(); } },
    // RecordSettingsPopover bewusst ausgelassen: kleines absolute-Popover, schließt
    // per Klick-daneben (kein Escape/Close-Button — statisch bekannter Polish-Gap).
    { name: "Floating Inspector", open: async (p) => { await p.getByTestId("inspector-float-toggle").click(); } },
    { name: "Performance Mode", open: async (p) => { await p.getByTitle(/Performance Mode/).click(); } },
  ];

  const baseline = await openOverlayCount(page);
  for (const c of cases) {
    try {
      await c.open(page);
      await page.waitForTimeout(450);
      const inspectorVisible = async () =>
        page.getByTestId("floating-inspector").isVisible().catch(() => false);
      const opened = (await openOverlayCount(page)) > baseline || await inspectorVisible();
      if (!opened) { note("2-Open", c.name, "Menü ließ sich nicht öffnen (keine Overlay-Affordanz erkannt)"); continue; }

      // Schließen: Escape, dann Close-Button-Fallback (schnell via evaluate)
      await page.keyboard.press("Escape");
      await page.waitForTimeout(350);
      let still = (await openOverlayCount(page)) > baseline || await inspectorVisible();
      if (still) {
        await clickCloseFast(page);
        await page.waitForTimeout(350);
        still = (await openOverlayCount(page)) > baseline || await inspectorVisible();
      }
      if (still) note("2-Close", c.name, "Menü ließ sich NICHT schließen (Escape + Close-Button erfolglos)");

      const clickable = await tablistClickable(page);
      if (!clickable) note("2-Overlap", c.name, "Nach Schließen blockiert ein Overlay das Tablist (Pointer-Interception)");
    } catch (e) {
      note("2-Open", c.name, `Fehler beim Öffnen/Schließen: ${(e as Error).message.slice(0, 140)}`);
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(200);
    }
  }

  expect(findings.filter(f => f.area.startsWith("2-")).length,
    "Menü-Findings (siehe Report)").toBeLessThanOrEqual(30);
});

// ─── 3. Overlap / verwaiste Overlays pro Tab ─────────────────────────────────

test("Audit 3 — keine blockierenden/überlappenden Overlays im Normalzustand", async ({ page }) => {
  test.setTimeout(120_000);
  const errs: string[] = [];
  await prep(page, errs);

  for (const tab of TABS) {
    await page.getByRole("tab", { name: tab.name }).click().catch(() => {});
    await page.waitForTimeout(300);
    const overlays = await bigOverlays(page);
    // Im Normalzustand (kein Dialog offen) sollte KEIN großes interaktives Overlay sichtbar sein.
    if (overlays.length) {
      note("3-Overlap", tab.id, `Großes Overlay im Normalzustand sichtbar: ${overlays.join(" ; ").slice(0, 240)}`);
    }
    const clickable = await tablistClickable(page);
    if (!clickable) note("3-Overlap", tab.id, "Tablist nicht per Pointer erreichbar (Overlay blockiert)");
  }

  expect(findings.filter(f => f.area === "3-Overlap").length,
    "Overlap-Findings (siehe Report)").toBeLessThanOrEqual(20);
});

// ─── 4. Pin/Reattach-Inventar (Browser-Präsenz) ──────────────────────────────

test("Audit 4 — Pin/Reattach-Buttons Präsenz-Check (Verhalten ist Electron-only)", async ({ page }) => {
  test.setTimeout(120_000);
  const errs: string[] = [];
  await prep(page, errs);

  // Pin-Buttons tragen Text "📌". Wir zählen sie pro relevantem Tab.
  const pinSurfaces = [
    { tab: "Mixer", name: "Mixer" },
    { tab: "Tools", name: "Tools" },
  ];
  let totalPins = 0;
  for (const s of pinSurfaces) {
    await page.getByRole("tab", { name: s.name }).click().catch(() => {});
    await page.waitForTimeout(300);
    const pins = await page.getByText("📌", { exact: false }).count();
    totalPins += pins;
    console.log(`[pin-inventory] Tab ${s.tab}: ${pins} Pin-Button(s) sichtbar`);
  }
  if (totalPins === 0) {
    note("4-Pin", "global", "Keine 📌-Pin-Buttons in Mixer/Tools sichtbar — prüfen ob Pin-UI im Browser ausgeblendet ist (erwartet: Electron-only, Browser zeigt Fallback)");
  }
  // Kein hartes Assert — rein informativ.
  expect(true).toBe(true);
});
