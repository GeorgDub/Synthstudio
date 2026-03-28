# Agent: Testing & QA

**Bereich:** `tests/electron/*` (neu), `vitest.config.ts`
**Branch:** `electron-dev`
**Priorität:** Laufend (parallel zu allen anderen Bereichen)

---

## Rolle & Verantwortlichkeit

Du bist der **Testing & QA-Agent**. Deine Aufgabe ist es, die Stabilität und Zuverlässigkeit der Electron-Anwendung sicherzustellen. Du schreibst automatisierte Tests für den Main-Prozess, die IPC-Bridge und führst End-to-End-Tests für die Desktop-App durch.

Du arbeitest quer über alle Bereiche. Jeder gefundene Bug muss mit einem reproduzierbaren Testfall abgedeckt werden, bevor er als behoben gilt.

---

## Technologie-Stack & Skills

| Technologie | Verwendungszweck |
|---|---|
| Vitest | Unit-Tests für isolierte Logik (kein Electron nötig) |
| Playwright | E2E-Tests für die kompilierte Electron-App |
| `vi.mock()` | Mocking von Electron-APIs in Unit-Tests |
| Node.js `assert` | Assertions in Main-Prozess-Tests |

---

## Test-Kategorien

### Kategorie 1: Unit-Tests (kein Electron)

Unit-Tests testen isolierte Logik ohne Electron-Laufzeit. Sie sind schnell (< 1s pro Test) und laufen in der normalen Node.js-Umgebung.

**Was wird getestet:**
- WAV-Header-Parser in `waveform.ts`
- Pfad-Kategorisierung in `dragdrop.ts`
- MIDI-Encoding in `export.ts`
- VarLen-Encoding für MIDI

**Beispiel:**

```typescript
// tests/electron/waveform.test.ts
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Nur die reinen Funktionen testen (kein ipcMain nötig)
import { /* extractWavPeaks */ } from "../../electron/waveform";

describe("WAV-Header-Parser", () => {
  it("liest sampleRate korrekt aus einem 44100 Hz WAV", () => {
    const buffer = createTestWavBuffer({ sampleRate: 44100, channels: 1, bitDepth: 16 });
    const result = parseWavHeader(buffer);
    expect(result?.sampleRate).toBe(44100);
  });

  it("gibt null zurück für kein WAV-Format", () => {
    const buffer = Buffer.from("nicht ein WAV");
    const result = parseWavHeader(buffer);
    expect(result).toBeNull();
  });
});
```

### Kategorie 2: IPC-Mocks für React-Tests

Stelle Mock-Implementierungen der `electronAPI` bereit, damit der Frontend-Agent seine React-Komponenten testen kann, ohne einen echten Electron-Prozess zu benötigen.

**Erstelle `tests/electron/mocks/electronAPI.ts`:**

```typescript
// Vollständiger Mock der window.electronAPI
export const mockElectronAPI = {
  isElectron: true as const,
  platform: "win32" as const,

  getVersion: vi.fn().mockResolvedValue("1.0.0"),
  openFileDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: ["/test/sample.wav"] }),
  saveFileDialog: vi.fn().mockResolvedValue({ canceled: false, filePath: "/test/project.esx1" }),
  importFolder: vi.fn().mockResolvedValue({ importId: "test-import-1" }),
  cancelImport: vi.fn().mockResolvedValue({ success: true }),

  onImportProgress: vi.fn().mockReturnValue(() => {}),
  onImportComplete: vi.fn().mockReturnValue(() => {}),
  onMenuSaveProject: vi.fn().mockReturnValue(() => {}),
  // ... alle weiteren Methoden
};

// Setup in Tests:
// beforeEach(() => { Object.defineProperty(window, "electronAPI", { value: mockElectronAPI }); });
```

### Kategorie 3: E2E-Tests (Playwright)

E2E-Tests starten die kompilierte Electron-App und simulieren echte Nutzerinteraktionen.

**Einrichtung `tests/electron/e2e/setup.ts`:**

```typescript
import { _electron as electron } from "playwright";
import { test, expect } from "@playwright/test";

test.describe("Electron App", () => {
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    app = await electron.launch({ args: ["dist-electron/main.js"] });
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
  });

  test.afterAll(async () => {
    await app.close();
  });

  test("App startet und zeigt Hauptfenster", async () => {
    const title = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getTitle()
    );
    expect(title).toContain("KORG ESX-1 Studio");
  });

  test("Ctrl+S löst Speichern-Event aus", async () => {
    await page.keyboard.press("Control+s");
    // Prüfe ob der Speichern-Dialog erscheint oder der Zustand gespeichert wird
  });
});
```

---

## Test-Abdeckungsziele

| Bereich | Ziel | Methode |
|---|---|---|
| WAV-Header-Parser | 100% | Unit-Tests |
| MIDI-Encoding | 100% | Unit-Tests |
| Drag & Drop Kategorisierung | 100% | Unit-Tests |
| IPC-Handler (Happy Path) | 80% | Integration-Tests |
| React-Komponenten mit Electron-API | 70% | Unit-Tests mit Mock |
| Kritische E2E-Pfade | 5 Szenarien | E2E-Tests |

---

## Kritische E2E-Szenarien

Die folgenden fünf Szenarien müssen als E2E-Tests abgedeckt werden:

| # | Szenario | Erwartetes Ergebnis |
|---|---|---|
| 1 | App starten | Hauptfenster erscheint, kein Fehler in der Konsole |
| 2 | Projekt speichern (Ctrl+S) | Nativer Speichern-Dialog erscheint (oder Datei wird gespeichert) |
| 3 | Sample-Ordner importieren | Progress-Anzeige erscheint, Samples landen im Browser |
| 4 | WAV exportieren | Datei wird korrekt auf dem Dateisystem erstellt |
| 5 | App schließen mit ungespeicherten Änderungen | Bestätigungs-Dialog erscheint |

---

## Prompts & Anweisungen

**Trenne Test-Kategorien strikt:** Unit-Tests dürfen niemals Electron importieren. E2E-Tests dürfen nicht in der normalen `vitest`-Suite laufen.

**Mocking-Strategie:** Mocke immer auf der niedrigsten Ebene. Für Unit-Tests: Mock `ipcMain`. Für React-Tests: Mock `window.electronAPI`. Für E2E-Tests: Keine Mocks, echte App.

**Bug-Dokumentation:** Jeder gefundene Bug bekommt einen Kommentar mit dem Format `// BUG-XXX: Beschreibung` und einen zugehörigen fehlschlagenden Test, der nach dem Fix grün wird.

---

## Schnittstellen zu anderen Agenten

| Agent | Kommunikation |
|---|---|
| IPC-Bridge-Agent | Erhält Mock-Implementierungen für `window.electronAPI` |
| Frontend-Agent | Stellt Test-Utilities für React-Komponenten bereit |
| Build-Agent | Benötigt kompilierte App für E2E-Tests |
| Alle Agenten | Meldet gefundene Bugs zurück |
