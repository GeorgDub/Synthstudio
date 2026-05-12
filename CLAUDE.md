# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Synthstudio

A professional audio production workstation (drum machine, synthesizer, piano roll, mixer, sample manager) that runs as both an **Electron desktop app** and a **web app in the browser** from a single React codebase.

**Stack:** React 19, TypeScript, TailwindCSS v4, Electron 40, Tone.js 15, Vite 7, pnpm

## Commands

```bash
pnpm dev                  # Web app only (Vite, port 5173)
pnpm dev:electron         # Electron + hot reload (starts Vite first)
pnpm check                # TypeScript type-check
pnpm build                # Web app → dist/public
pnpm build:electron       # Full Electron build (compile + package)
pnpm build:electron:win   # Windows NSIS installer
pnpm build:electron:mac   # macOS DMG (Intel + ARM)
pnpm build:electron:linux # Linux AppImage + DEB
pnpm test                 # Vitest unit tests (all)
pnpm test:features        # Nur tests/features/ (eine Datei pro Store)
pnpm test:watch           # Vitest watch-mode
pnpm test:all             # check + test + test:web (CI-Variante)
pnpm test:e2e             # Playwright E2E in Electron (braucht compile:electron)
pnpm test:web             # Playwright E2E im Browser (Chromium)
pnpm format               # Prettier formatting
pnpm db:push              # Drizzle ORM migrations (requires DATABASE_URL env var)
```

**Always use `pnpm`. Never use `npm` or `yarn`.**

## Architecture

### Three-Layer Stack

**1. Frontend** (`client/src/`) — React 19 + TypeScript, bundled by Vite 7
- UI: Radix UI (headless components) + TailwindCSS 4 + Lucide icons
- State: custom lightweight stores in `client/src/store/` (see pattern below)
- Routing: tab-based in `App.tsx` — no React Router or Wouter used in practice
- Charts: Recharts (mix analytics)

**2. Electron** (`electron/`) — compiled to CJS via `tsconfig.electron.json` → `electron-dist/`
- `main.ts`: Window lifecycle, menus, global shortcuts, native dialogs
- `preload.ts` + `preload-additions.ts`: Secure IPC bridge (context isolation — renderer has no direct Node.js access)
- `collab-server.ts` / `collab-discovery.ts`: WebSocket LAN server + mDNS session discovery
- `export.ts` / `export-stereo.ts` / `wav-writer.ts`: WAV + MIDI export
- `useElectron.ts`: React hook wrapping all IPC calls **with browser fallbacks**

**3. Audio Engine** (`client/src/audio/`)
- `AudioEngine.ts`: Web Audio API wrapper — synthesis, per-channel FX chains, playback scheduling
- `SynthEngine.ts`: Oscillators, ADSR, Wavetable + FM modes
- `SpectrumAnalyzer.ts`: Real-time FFT for visual metering
- Tone.js v15 for advanced synthesis and scheduling
- `workers/audioAnalysis.worker.ts`: off-thread BPM detection

### Isomorphic Design (Critical Invariant)

Every Electron feature must have a browser fallback. All platform-specific code is gated through the hook — never access `window.electronAPI` directly in components:

```ts
const electron = useElectron(); // returns browser-safe stubs when not in Electron
if (electron.isElectron) { /* native path */ }
```

The web app must remain fully functional without Electron.

### State Management Pattern

Stores are custom manual observer implementations — **not the Zustand npm package**:

```typescript
let _state = loadState();
const _listeners = new Set<Listener>();
function notify() { _listeners.forEach(l => l()); }

export function useThemeStore() {
  const [, rerender] = useReducer(x => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => _listeners.delete(rerender);
  }, []);
  return _state;
}
```

Each major feature has three co-located pieces:
1. **Store** (`store/use<Feature>Store.ts`) — reactive UI state
2. **Utilities** (`utils/<feature>.ts`) — pure logic (pattern gen, scales, etc.)
3. **Component** (`components/<Feature>/`) — UI binding store + utilities

### CSS Design Token System

All themes are defined in `client/src/index.css` using `[data-theme="..."]` selectors. Every theme **must** define all 12 `--ss-*` variables. A `@theme` block at the top of `index.css` maps them to Tailwind color tokens so utility classes work:

```css
@theme {
  --color-bg-base:       var(--ss-bg-base);
  --color-accent-primary: var(--ss-accent-primary);
  /* … all 12 tokens … */
}
```

**Critical rule: never use hardcoded Tailwind colors in components.** Always use the semantic classes below — they respond to theme switches automatically. Using `bg-slate-900`, `text-cyan-400`, `bg-gray-800` etc. will break theming.

**Semantic class mapping** (use these in all components):

| Tailwind class | Resolves to |
|---|---|
| `bg-bg-base` | `--ss-bg-base` (darkest bg) |
| `bg-bg-panel` | `--ss-bg-panel` |
| `bg-bg-elevated` | `--ss-bg-elevated` |
| `text-text-primary` | `--ss-text-primary` |
| `text-text-muted` | `--ss-text-muted` |
| `text-text-dim` | `--ss-text-dim` |
| `border-border-color` | `--ss-border` |
| `bg-accent-primary` / `text-accent-primary` | `--ss-accent-primary` |
| `bg-accent-secondary` / `text-accent-secondary` | `--ss-accent-secondary` |
| `bg-accent-success` / `text-accent-success` | `--ss-accent-success` |
| `bg-accent-danger` / `text-accent-danger` | `--ss-accent-danger` |

All 12 `--ss-*` CSS variables (use in inline styles where Tailwind classes don't fit):

```css
--ss-bg-base          /* Main background */
--ss-bg-panel         /* Panel background */
--ss-bg-elevated      /* Elevated surface */
--ss-accent-primary   /* Primary accent color */
--ss-accent-secondary /* Secondary accent */
--ss-accent-success   /* Success (green) */
--ss-accent-danger    /* Danger (red) */
--ss-text-primary     /* Primary text */
--ss-text-muted       /* Muted text */
--ss-text-dim         /* Dim/subtle text */
--ss-border           /* Border color */
--ss-border-subtle    /* Subtle border */
```

The six built-in themes: DarkStudio, NeonCircuit, AnalogHardware, Nacht, Sonnenuntergang, OLED-Schwarz.

Custom themes stored via `useThemeStore` must also contain all 12 variables. After saving: call `applyCustomTheme(id)` with the ID returned by `addCustomTheme()` — omitting this is the most common custom-theme bug.

### Relevant Files for Custom Themes

- `client/src/components/Settings/ThemeSettings.tsx` — theme selection dialog
- `client/src/components/Settings/CustomThemeCreator.tsx` — custom theme form
- `client/src/store/useThemeStore.ts` — state + persistence (note: circular import risk if refactoring — `useThemeStore.ts` currently imports from `ThemeSettings.tsx`)

### Collaboration (LAN)

WebSocket server runs in Electron main process. Protocol events: `step:toggle`, `bpm:change`, `pattern:switch`, `transport:play/stop`, `snapshot:full`. `CollabSplitView` shows a split-screen for two simultaneous users. mDNS auto-discovers sessions on the local network.

### Phase C Features (implementiert)

| Feature | Store | Component | Status |
|---|---|---|---|
| **Automation Clips** | `useAutomationStore.ts` | `Automation/AutomationView.tsx` | ✅ Step-basiert, BPM + Vol |
| **Scene Launch** | `useSceneStore.ts` | `Scene/SceneLaunchPad.tsx` | ✅ Shift+1-8 Shortcuts |
| **Sidechain** | `useMixerStore` sidechains | `MixerView` Inspector | ✅ Step-triggered ducking |
| **Spectrum Analyzer** | — | In `MixerView.tsx` | ✅ Canvas FFT |
| **Note Repeat** | `useNoteRepeatStore.ts` | `PerformanceMode/NoteRepeatPanel.tsx` | ✅ In DrumMachine |
| **Global Transpose** | `useTransposeStore.ts` | `PianoRoll/TransposeControl.tsx` | ✅ In DrumMachine |
| **Pattern Morph** | `useMorphStore.ts` | `PatternMorph/PatternMorphPanel.tsx` | ✅ In DrumMachine |
| **MIDI Import** | — | In `DrumMachine.tsx` | ✅ GM Drum Map |
| **Keyboard Bindings** | `useKeyboardBindingsStore.ts` | `Settings/KeyboardBindingsPanel.tsx` | ✅ In ShortcutsHelp |

**Automation-Playback**: `AudioEngine.onPosition()` Callback in `App.tsx` liest Lanes und setzt BPM/Volume pro Step.

**Scene Launch Architektur**: Singleton-Store (`useSceneStore.ts`, localStorage) mit `addScene/updateScene/removeScene/setActiveScene`. Pad-Klick oder `Shift+1-8` → `dm.setActivePattern(patternId)`.

### Generation / AI Layer

`src/generation/` (plain JS) contains a standalone procedural pattern generation engine. `client/src/components/generator/` has the JSX UI for AI-assisted pattern creation. `client/src/utils/patternGenerator.ts` is a separate client-side utility. These don't depend on the audio engine directly.

## TypeScript Configs

| Config | Purpose |
|---|---|
| `tsconfig.json` | Main app (ES2020, JSX preserve, strict) |
| `tsconfig.electron.json` | Electron main process (CommonJS → `electron-dist/`) |
| `tsconfig.node.json` | Build scripts |

## Test-First-Workflow (verbindlich)

Bei **jeder neuen Implementierung** (Store, Util, Feature) gilt:

1. **Vor Code**: Test-Datei wählen oder neu anlegen (`tests/features/<feature>.test.ts`)
2. **Während Code**: mind. 3 Tests pro Public Function (Happy Path / Edge Case / Persistence)
3. **Vor Commit**: `pnpm check && pnpm test` muss grün sein
4. **Bei UI-Features**: zusätzlich Playwright-Smoke in `tests/web/`

Vollständige Doku: siehe `TESTING.md` (Templates, Coverage-Ziele, was nicht in Node testbar ist).

Test-Files niemals löschen wenn obsolet → entweder anpassen oder `it.skip` mit Begründung.

## Project File Formats

- **Projects**: `.synth` JSON files; managed by `useProjectStore` with undo/redo stack
- **Samples**: individual audio files or `.zip` packs (extracted by `electron/zip-import.ts` + `client/src/utils/zipSampleImport.ts`)
- **MIDI**: parsed by `utils/smfParser.ts`, exported via `electron/export.ts`