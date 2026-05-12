# Synthstudio – Test-Strategie & Workflow

Dieses Dokument beschreibt **wie** Tests in Synthstudio organisiert sind und **wie** bei jeder neuen Implementierung Tests geschrieben + ausgeführt werden.

## Test-Pyramide

```
       ┌─────────────────────┐
       │  Playwright E2E     │  ← UI-Smoke-Tests (Chromium + Electron)
       │  tests/web/         │     Tab-Navigation, Panel-Sichtbarkeit
       │  tests/electron/e2e │
       └─────────────────────┘
   ┌───────────────────────────────┐
   │  Vitest Integration           │  ← Server-Protokolle, Multi-Modul-Flows
   │  tests/*.test.ts              │     Relay-Server, Collab-Server, Export
   │  tests/electron/*.test.ts     │
   └───────────────────────────────┘
┌──────────────────────────────────────┐
│  Vitest Unit                         │  ← Stores, Utilities, Pure Logic
│  tests/features/*.test.ts            │     ein File pro Feature/Store
└──────────────────────────────────────┘
```

## Verzeichnisstruktur

| Pfad | Zweck | Test-Runner |
|---|---|---|
| `tests/*.test.ts` | Top-Level Unit + Integration (existing features) | Vitest |
| `tests/features/*.test.ts` | **Pro Feature/Store eine Datei** – wird bei jeder neuen Funktion erweitert | Vitest |
| `tests/electron/*.test.ts` | Electron-spezifische Logik (z.B. IPC, Filesystem-Mocks) | Vitest |
| `tests/electron/e2e/*.spec.ts` | End-to-End in Electron (braucht `pnpm compile:electron`) | Playwright |
| `tests/web/*.spec.ts` | End-to-End im Browser gegen Vite-Dev-Server | Playwright |

## Befehle

```bash
pnpm test                        # Alle Vitest-Tests (Unit + Integration)
pnpm vitest run tests/features   # Nur Feature-Tests
pnpm test:web                    # Playwright im Browser (Chromium)
pnpm test:e2e                    # Playwright in Electron (braucht compile:electron)
pnpm test -- --watch             # Watch-Modus
pnpm test -- <pattern>           # Nur Tests die <pattern> enthalten
```

## Test-First-Workflow

### Bei jeder neuen Implementierung gilt:

1. **Vor Code-Änderungen** – passende Test-Datei wählen oder neu anlegen
   - Neuer Store? → `tests/features/<feature-name>.test.ts`
   - Neue Util-Funktion? → erweitert eine bestehende Test-Datei
   - Neue UI? → Playwright-Smoke in `tests/web/`

2. **Während der Implementierung** – Tests parallel schreiben
   - Mindestens **3 Tests pro Public Function** (Happy Path, Edge Case, Persistence/Cleanup)
   - Mock localStorage immer am Datei-Anfang (siehe Template unten)

3. **Vor dem Commit** – Tests müssen grün sein
   ```bash
   pnpm check && pnpm test
   ```

4. **Bei UI-Features** – zusätzlich Playwright-Smoke schreiben
   - Tab-Navigation, Panel-Öffnen, Button-Existenz
   - **Keine** Audio-Korrektheit testen (würde echte WebAudio brauchen)

## Standard-Template für neue Test-Datei

```typescript
/**
 * tests/features/<feature>.test.ts
 *
 * Unit-Tests für <FeatureName>.
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── localStorage Mock ────────────────────────────────────────────────────────

function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem:    (k: string) => store[k] ?? null,
    setItem:    (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear:      () => { store = {}; },
  };
}
const localStorageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock, writable: true, configurable: true,
});

// DANACH den Store importieren (nicht vorher!)
import { /* ... */ } from "../../client/src/store/use<Feature>Store";

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorageMock.clear();
});

describe("<FeatureName> Store", () => {
  it("Happy Path: ...", () => { /* ... */ });
  it("Edge Case: ...", () => { /* ... */ });
  it("Persistiert in localStorage", () => { /* ... */ });
});
```

## Was getestet wird (Coverage-Ziele)

### Pflicht (in jedem Store)

- [x] **Hinzufügen** einer neuen Entität → ID wird zurückgegeben + State enthält sie
- [x] **Entfernen** via ID → State enthält sie nicht mehr
- [x] **Aktualisieren** (partial update) → andere Felder bleiben unverändert
- [x] **localStorage-Persistierung** → nach Schreiben ist Daten im Mock
- [x] **Default-State** wenn localStorage leer

### Optional (wo sinnvoll)

- [ ] Reactive Subscribe (`useStore()` Hook) – braucht `@testing-library/react` + `jsdom`
- [ ] Window-Events (`CustomEvent`) – mit `vi.fn()` als Mock
- [ ] Time-basierte Logik – mit `vi.useFakeTimers()`

### Nicht testen (sinnlos in Node)

- WebAudio (AudioContext, AnalyserNode) → würde echten Browser brauchen
- DOM-Manipulation (document.documentElement) → nur Playwright
- Drag & Drop, Pointer-Events → nur Playwright
- WebSocket-Connection-Status (außer im Relay-Test der einen echten Server startet)

## Skipped Tests dokumentieren

Wenn ein Test in Node nicht ausführbar ist, **nicht löschen** sondern als `it.skip` markieren mit Begründung:

```typescript
it.skip("setBpm löst React-Rerender aus", () => {
  // Skip: Hook braucht @testing-library/react + jsdom (s. TESTING.md).
  // Abgedeckt durch tests/web/new-features.spec.ts.
});
```

## Aktueller Stand (Stand: dieser Commit)

| Kategorie | Tests |
|---|---|
| Unit (`tests/`) | 437 |
| Feature (`tests/features/`) | 68 + 15 skipped |
| Integration (`tests/electron/*.test.ts`) | 222 |
| **Total Vitest** | **727** |
| E2E Playwright (`tests/web/`) | 9 |
| E2E Playwright (Electron) | (5 Suites, separate Ausführung) |

## CI-Integration (Empfehlung)

In `.github/workflows/test.yml`:

```yaml
- run: pnpm install --frozen-lockfile
- run: pnpm check
- run: pnpm test
- run: pnpm test:web
```

## Bei Test-Failure: was tun?

1. **Failure liegt am Test selbst** (z.B. veralteter Store-API) → Test anpassen oder als obsolet löschen
2. **Failure liegt am Code** → Code fixen, Test bleibt
3. **Test ist „flaky"** (intermittierend rot) → Bug-Report, Workaround mit `it.skip` + Kommentar bis fix
