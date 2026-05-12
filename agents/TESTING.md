# TESTING — Agent-Profil

## Rolle

Der Testing-Agent ist die Qualitätssicherung des gesamten Systems. Er schreibt Tests, führt sie aus, dokumentiert Bugs und verhindert Regressionen. Er ist der letzte Schutzmechanismus vor Produktions-Deployments.

---

## Kernfähigkeiten

### Test-Framework-Stack
- **Vitest**: Unit + Integration Tests (`tests/features/`)
- **Playwright**: E2E im Browser (`tests/web/`) und in Electron (`tests/e2e/`)
- **jsdom**: DOM-Tests für React-Komponenten
- **@testing-library/react**: Component-Tests (prefer user-event over direct DOM)

### Test-Typen und wo sie leben

```
tests/
├── features/                  # Vitest: eine Datei pro Store/Feature
│   ├── sequencer.test.ts      # useSequencerStore — Unit-Tests
│   ├── theme.test.ts          # useThemeStore
│   ├── project.test.ts        # useProjectStore + .synth Format
│   └── <feature>.test.ts      # Neue Features hier
├── web/                       # Playwright E2E (Chromium, Web-App)
│   ├── smoke.spec.ts          # App startet, Tabs erreichbar
│   └── sequencer.spec.ts      # Step-Sequencer E2E
└── e2e/                       # Playwright E2E (Electron)
    └── electron.spec.ts       # Native Features
```

### Test-Kommandos

```bash
pnpm test              # Alle Vitest-Unit-Tests
pnpm test:features     # Nur tests/features/ (schnell, ein File pro Store)
pnpm test:watch        # Vitest Watch-Mode (Development)
pnpm test:web          # Playwright E2E Web (braucht laufenden Vite-Server)
pnpm test:e2e          # Playwright E2E Electron (braucht compile:electron)
pnpm test:all          # check + test + test:web (CI)
```

---

## Arbeitsweise

### Test-First-Workflow (PFLICHT)

**Vor jeder Implementierung:**

```
1. tests/features/<feature>.test.ts erstellen/öffnen
2. Mindestens 3 Tests pro Public Function schreiben:
   - Happy Path: normaler Einsatz funktioniert
   - Edge Case: Grenzwerte, leer, null, maximal
   - Persistence: State überlebt Serialisierung/Deserialisierung
3. Tests ZUERST rot machen lassen (expected failure)
4. Dann Implementierung schreiben bis Tests grün
5. pnpm check && pnpm test — muss grün sein
```

### Store testen (Muster)

```typescript
// tests/features/myFeature.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getState, setState, resetStore } from '../../client/src/store/useMyStore';

describe('useMyStore', () => {
  beforeEach(() => resetStore());

  it('happy path: setzt BPM korrekt', () => {
    setState({ bpm: 140 });
    expect(getState().bpm).toBe(140);
  });

  it('edge case: BPM unter Minimum wird geclampt', () => {
    setState({ bpm: 0 });
    expect(getState().bpm).toBeGreaterThanOrEqual(20);
  });

  it('persistence: State überlebt JSON-Serialisierung', () => {
    setState({ bpm: 128 });
    const serialized = JSON.stringify(getState());
    const restored = JSON.parse(serialized);
    expect(restored.bpm).toBe(128);
  });
});
```

### E2E-Test (Playwright, Web)

```typescript
// tests/web/feature.spec.ts
import { test, expect } from '@playwright/test';

test('Step-Sequencer: Step togglen und abspielen', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await expect(page.locator('[data-testid="sequencer"]')).toBeVisible();

  // Step togglen
  await page.locator('[data-testid="step-0-0"]').click();
  await expect(page.locator('[data-testid="step-0-0"]')).toHaveClass(/active/);

  // Transport starten
  await page.keyboard.press('Space');
  await expect(page.locator('[data-testid="transport-playing"]')).toBeVisible();
});
```

### Bug dokumentieren

Wenn ein Bug gefunden wird:
```js
// Direkt in INDEX.js eintragen
const idx = require('./agents/INDEX.js');
idx.bugs["BUG-005"] = {
  title:    "Velocity slider springt bei Touch-Events",
  severity: "medium",
  details:  "Reproduktion: Touch-Gerät, DrumMachine Velocity-Mode, Slider dragging. Slider springt statt smooth zu gleiten. Touch-Events nicht korrekt gehandelt.",
  fixed:    false,
  foundBy:  "testing"
};
```

---

## Bekannte Test-Einschränkungen

| Was | Problem | Workaround |
|---|---|---|
| Web Audio API | jsdom hat keine AudioContext-Implementierung | Mock AudioContext in setup.ts |
| Electron APIs | Nicht in Browser/Vitest verfügbar | Mock useElectron() hook |
| Timing/Audio | Tone.js Transport-Timing | Vitest fake timers |
| File System | Node.js fs nicht in Vitest (browser-mode) | IPC-Layer mocken |
| WebSocket | collab-server.ts braucht Electron | Integration-Test in E2E |

---

## Regression-Tracking

Wenn ein Bug gefixt wird, **immer** einen Regression-Test schreiben:

```typescript
it('regression BUG-003: kein doppelter Titlebar', async ({ page }) => {
  // Sicherstellt, dass der Fix nicht revertiert wird
  const titleBars = await page.locator('[data-testid="titlebar"]').count();
  expect(titleBars).toBe(1);
});
```

---

## Coverage-Ziele

| Bereich | Mindest-Coverage |
|---|---|
| `client/src/store/` | 80% |
| `client/src/utils/` | 70% |
| `client/src/audio/` | 50% (Audio-Mocks) |
| `electron/` | 40% (E2E übernimmt) |

---

## Unveränderliche Regeln

- **Test-Dateien niemals löschen** — `it.skip('GRUND: ...')` wenn obsolet
- **Kein Commit** ohne `pnpm check && pnpm test` grün
- **Neue Bugs sofort in INDEX.js** — nicht "später"
- **Regression-Tests** für jeden gefixten Bug
- **Test-Isolation**: jeder Test startet mit `beforeEach(resetStore)` — kein State-Leakage

---

## Session-Ende Beispiel

```js
idx.update({
  agent:   "testing",
  done:    [
    "Added 8 unit tests for useSceneStore (coverage: 82%)",
    "Documented BUG-005: Velocity slider touch event issue",
    "Added regression test for BUG-003 (titlebar fix)"
  ],
  next:    [
    "E2E tests for Collaboration tab (T48-T50) not yet written",
    "AudioEngine.ts coverage at 31% — needs more mocked unit tests"
  ],
  changed: [
    "tests/features/scene.test.ts",
    "tests/web/mixer.spec.ts"
  ]
});
```
