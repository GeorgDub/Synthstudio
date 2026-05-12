/**
 * ============================================================
 * AGENT SYSTEM — SHARED KNOWLEDGE INDEX
 * ============================================================
 * This file is the single source of truth for all agents.
 * Every agent READS this at session start and WRITES updates
 * at session end. No agent analyzes the project from scratch.
 *
 * PROTOCOL:
 *   1. At session start: const idx = require('./INDEX.js')
 *   2. Read relevant sections (project, files, lastWork)
 *   3. Do your work
 *   4. Call idx.update({ agent, done, next, changed }) before exit
 * ============================================================
 */

const INDEX = {

  // ─── PROJECT META ──────────────────────────────────────────
  project: {
    name: "Synthstudio",
    version: "1.18.0",
    type: "Electron + Web App",
    stack: {
      runtime:    "Electron 40",
      frontend:   "React 19 + TypeScript",
      styling:    "TailwindCSS v4",
      audio:      "Tone.js 15 + Web Audio API",
      bundler:    "Vite 7",
      testing:    "Vitest + Playwright",
      packageMgr: "pnpm",
      db:         "Drizzle ORM (optional, requires DATABASE_URL)"
    },
    rootDir:    "G:/IdeaProjects/Synthstudio",
    entryWeb:   "client/src/main.tsx",
    entryElec:  "electron/main.ts",
    configFiles: ["vite.config.ts", "tsconfig.json", "tsconfig.electron.json", "electron-builder.config.js"]
  },

  // ─── CRITICAL ARCHITECTURE RULES ───────────────────────────
  rules: [
    "Never use hardcoded Tailwind colors — always semantic classes (bg-bg-base, text-accent-primary, etc.)",
    "All Electron features must have browser fallbacks via useElectron() hook",
    "Never access window.electronAPI directly in components",
    "State stores use custom observer pattern — not Zustand npm package",
    "Always use pnpm — never npm or yarn",
    "Run pnpm check && pnpm test before every commit",
    "Test-first: write tests before implementing features",
    "Never delete test files — use it.skip with reason instead"
  ],

  // ─── ARCHITECTURE MAP ──────────────────────────────────────
  architecture: {
    frontend: {
      root:       "client/src/",
      components: "client/src/components/",
      stores:     "client/src/store/",
      utils:      "client/src/utils/",
      audio:      "client/src/audio/",
      hooks:      "client/src/hooks/",
      styles:     "client/src/index.css"
    },
    electron: {
      root:       "electron/",
      main:       "electron/main.ts",
      preload:    "electron/preload.ts",
      ipcBridge:  "electron/preload-additions.ts",
      collabSrv:  "electron/collab-server.ts",
      export:     "electron/export.ts"
    },
    generation: {
      engine:     "src/generation/",
      ui:         "client/src/components/generator/",
      util:       "client/src/utils/patternGenerator.ts"
    },
    tests: {
      unit:       "tests/features/",
      e2eElec:    "tests/electron/",
      e2eWeb:     "tests/web/"
    }
  },

  // ─── KNOWN FILE INDEX ──────────────────────────────────────
  // Key files agents have analyzed. Add new entries after working on a file.
  files: {
    "client/src/App.tsx": {
      role:     "Root component, tab routing (F1-F6), AudioEngine.onPosition() automation callback",
      lastSeen: null,
      ownedBy:  "frontend"
    },
    "client/src/store/useThemeStore.ts": {
      role:     "Theme state + persistence. WARNING: circular import risk if refactoring (imports from ThemeSettings.tsx)",
      lastSeen: null,
      ownedBy:  "frontend"
    },
    "client/src/store/useProjectStore.ts": {
      role:     "Project load/save, .synth JSON format, undo/redo stack",
      lastSeen: null,
      ownedBy:  "frontend"
    },
    "client/src/audio/AudioEngine.ts": {
      role:     "Web Audio API wrapper — synthesis, FX chains, playback scheduling",
      lastSeen: null,
      ownedBy:  "backend"
    },
    "client/src/audio/SynthEngine.ts": {
      role:     "Oscillators, ADSR, Wavetable + FM synthesis modes",
      lastSeen: null,
      ownedBy:  "backend"
    },
    "electron/main.ts": {
      role:     "Window lifecycle, menus, global shortcuts, native dialogs",
      lastSeen: null,
      ownedBy:  "backend"
    },
    "electron/preload.ts": {
      role:     "Secure IPC bridge (context isolation)",
      lastSeen: null,
      ownedBy:  "backend"
    },
    "client/src/index.css": {
      role:     "All 6+ themes, CSS design tokens (--ss-*), @theme Tailwind mappings",
      lastSeen: null,
      ownedBy:  "frontend"
    }
  },

  // ─── KNOWN FEATURES ────────────────────────────────────────
  features: {
    "Step Sequencer":    { store: "useSequencerStore.ts",    tab: "F1 (Sequencer)",    status: "stable" },
    "Mixer":             { store: "useMixerStore.ts",        tab: "F2 (Mixer)",        status: "stable" },
    "Song Mode":         { store: "useSongStore.ts",         tab: "F3 (Song-Modus)",   status: "stable" },
    "Humanizer":         { store: "useHumanizerStore.ts",    tab: "F4 (Humanizer)",    status: "stable" },
    "Script Runner":     { store: "useScriptStore.ts",       tab: "F5 (Tools)",        status: "stable (v1.17.0+)", notes: "Web-Worker-Sandbox, max 64 scripts, async ss.* API, Allowlist-Bridge, Key+Macro-Button triggers, project-scope or app-scope persistence" },
    "Collaboration":     { store: "useCollabStore.ts",       tab: "F6 (Kollaboration)",status: "stable" },
    "Automation":        { store: "useAutomationStore.ts",   tab: "Sequencer",         status: "stable" },
    "Scene Launch":      { store: "useSceneStore.ts",        tab: "Sequencer",         status: "stable" },
    "Pattern Morph":     { store: "useMorphStore.ts",        tab: "Sequencer",         status: "stable" },
    "Note Repeat":       { store: "useNoteRepeatStore.ts",   tab: "Sequencer",         status: "stable" },
    "Global Transpose":  { store: "useTransposeStore.ts",    tab: "Sequencer",         status: "stable" },
    "MIDI Import":       { store: null,                      tab: "Sequencer",         status: "stable" },
    "Keyboard Bindings": { store: "useKeyboardBindingsStore.ts", tab: "Settings",      status: "stable" },
    "Themes":            { count: 10,                        tab: "Settings",          status: "stable" },
    "KI-Generator":      { store: null,                      tab: "Tools",             status: "⚠️ requires API key" },
    "Audio Tracks":      { store: "useAudioTrackStore.ts",   tab: "F2 (Mixer)",        status: "stable (v1.16.0+)", notes: "Path-ref persistence in .synth, max 8 tracks, BPM-sync via playbackRate (Pitch+Tempo)" }
  },

  // ─── KNOWN BUGS ────────────────────────────────────────────
  // Update when bugs are found or fixed. Never delete — mark fixed: true.
  bugs: {
    "BUG-001": {
      title:   "Space key stops playback only when focus is not on step grid",
      severity: "low",
      details:  "When a step cell or text field has focus, Space toggles that step instead of transport. Click neutral area first.",
      fixed:    true,
      foundBy:  "testing",
      fixedBy:  "frontend",
      fixedIn:  "fe62713"
    },
    "BUG-002": {
      title:   "BPM +/- buttons appear clickable but are keyboard-only shortcuts",
      severity: "low / UX",
      details:  "On-screen BPM display is misleading. Change BPM via double-click on value OR keyboard + and - keys.",
      fixed:    false,
      foundBy:  "testing"
    },
    "BUG-003": {
      title:   "Double title bar on Windows — native + custom Electron titlebar both visible",
      severity: "medium",
      details:  "Windows native titlebar and custom Electron titlebar render simultaneously.",
      fixed:    true,
      foundBy:  "testing",
      fixedBy:  "backend",
      fixedIn:  "0db2a54"
    },
    "BUG-004": {
      title:   "KI-Generator hangs indefinitely on 'Generiere...'",
      severity: "high",
      details:  "Runtime require() in generateAndStore caused ES module error -> isGenerating stuck true forever. Replaced with proper ES import.",
      fixed:    true,
      foundBy:  "testing",
      fixedBy:  "frontend",
      fixedIn:  "fe62713"
    },
    "BUG-005": {
      title:   "Quantize crashes page (TypeError: undefined.active)",
      severity: "critical",
      details:  "Quantize buttons (1/8, 1/16, 1/32) threw TypeError when pt.steps.length < pattern.stepCount (after MIDI-Import, Morph, or project load). Unhandled in React setState -> white-screen page-crash. Fix: bounds-check in quantizeSteps via Math.min(steps.length, stepCount).",
      fixed:    true,
      foundBy:  "testing",
      fixedBy:  "testing",
      fixedIn:  "TASK-104 (v1.15.5)"
    },
    "BUG-006": {
      title:   "Macro knobs do not affect audio (no routing to AudioEngine)",
      severity: "high",
      details:  "useMacroStore stored bindings but had no subscription routing macro value changes to AudioEngine setters. App.tsx had stale-closure bug (dm/project captured at mount, never refreshed). Fix: pure applyMacroBindings() helper + ref-based handler in App.tsx. Master-vol, BPM, channel-vol/pan/sends now functional. LFO-rate/depth still pending (require new SynthEngine runtime setters).",
      fixed:    true,
      foundBy:  "user (15_3.md #5)",
      fixedBy:  "backend",
      fixedIn:  "TASK-100 (v1.15.5)"
    },
    "BUG-007": {
      title:   "Close buttons missing or inconsistent on ~12 floating/modal panels",
      severity: "high (UX)",
      details:  "Many panels (Granular, Polyrhythm via ResizableDrumPanel, FxPanel, StepInspector, WavetableEditor, ShortcutsHelp, NewProjectDialog, MidiSettings, CollabChat, SettingsPanel, ThemeSettings, CustomThemeCreator, MacroPanel BindingEditor, PianoRollModal, Scene EditModal, CollabStatus, MixAssistantPanel, PatternMorphPanel, NoteRepeatPanel, ModMatrix, SynthPanel) had ✕ text without aria-label or no close button at all. Standardized on lucide <X /> + aria-label='Close' + semantic tokens.",
      fixed:    true,
      foundBy:  "user (neue_todos.md)",
      fixedBy:  "frontend",
      fixedIn:  "TASK-105 (v1.15.5)"
    }
  },

  // ─── AGENT WORK LOG ────────────────────────────────────────
  // Each agent appends an entry here after completing work.
  // Format: { agent, timestamp, done[], next[], changed[] }
  workLog: [
    {
      agent:     "builder",
      timestamp: "2026-05-12T18:20:00.000Z",
      done: [
        "TASK-108: Build-Time-Codegen for sandbox-worker source — eliminates the dual-maintenance problem between sandbox-runtime.ts (documentation copy) and the inline SANDBOX_WORKER_SOURCE string in useScriptSandbox.ts.",
        "TASK-108: Chose Option (b) esbuild prebuild script — most robust, no Vite-magic, easy to debug, deterministic byte-identical output. Considered (a) ?raw import (rejected: .ts cannot run in Worker without transpile) and (c) Vite-plugin (rejected: needs to work for vitest+playwright too without Vite-pipeline).",
        "TASK-108: New script scripts/generate-sandbox-source.mjs (esbuild API: bundle=false, format=esm, target=es2020, keepNames, no minify) reads client/src/sandbox/sandbox-runtime.ts, transpiles to ES2020 JS, embeds via String.raw template literal in client/src/sandbox/sandbox-runtime.generated.ts. Idempotent (only rewrites when output differs).",
        "TASK-108: Generated file is committed (NOT gitignored) for fresh-checkout convenience — has AUTO-GENERATED header + embedded SHA256 of source for drift detection. Determinism verified by tests (8 codegen tests in tests/features/script-sandbox-codegen.test.ts).",
        "TASK-108: New pnpm scripts: gen:sandbox + predev + prebuild + precheck + pretest as automatic pre-hooks. Verified: pnpm check, pnpm test, pnpm dev all run gen:sandbox automatically before their main task. Pretest works with vitest.",
        "TASK-108: useScriptSandbox.ts now imports SANDBOX_WORKER_SOURCE from ./sandbox-runtime.generated instead of holding a 150-line String.raw inline copy. Replaced ~146 LOC with 1-line import.",
        "TASK-108: Drift-tests in tests/features/script-sandbox-pentest.test.ts (Tests 14-17) adapted to esbuild-output: pattern `undefined` ↔ `void 0` accepted via regex (semantically identical); added defineProperty + LOG_RATE_MAX + ss-prototype-freeze assertions.",
        "TASK-108: Same regex relaxation in tests/features/script-sandbox.test.ts (textual integrity check at line 155) — closes the issue refactor-agent flagged in its 18:15 entry.",
        "TASK-108: New test file tests/features/script-sandbox-codegen.test.ts (8 tests): determinism, source-SHA-match, IIFE-shape, no top-level export, output-SHA-match, escape safety, idempotency on no-change, hash-change on source-change. All 8 pass in ~900ms.",
        "TASK-108: pnpm check clean. pnpm test 1003/1018 grün (15 pre-existing skipped, 8 NEW codegen tests + 47 pre-existing sandbox tests = 55 sandbox-related tests all pass, 0 regressions across 58 test files)."
      ],
      next: [
        "Welle 2 (potential): if commit-the-generated-file is undesired noise (pollutes git status during dev), switch to gitignore-based flow + CI-step that runs gen:sandbox before any pnpm command. Currently checked in for robustness — esbuild output IS deterministic so the file rarely changes.",
        "Welle 2 (CI): add a CI-step `pnpm gen:sandbox && git diff --exit-code client/src/sandbox/sandbox-runtime.generated.ts` to enforce that PRs include the regenerated file (no stale .generated.ts).",
        "Welle 2 (Tests): add a Playwright E2E test that loads the actual sandbox-runtime.generated.ts content into a real browser Web Worker (instead of node:worker_threads shim) and runs a malicious script — to catch any difference between the esbuild-transpiled output and what real browsers execute.",
        "Welle 2 (DX): generate sourcemap for sandbox-runtime.generated.ts so Chrome DevTools can show user errors with line numbers from the .ts source instead of the bundled JS. Currently `sourcemap: false` in the script.",
        "Edge case: esbuild's `keepNames: true` injects `/* @__PURE__ */ __name(fn, \"fn\")` wrappers. These are harmless (just set Function.name for stack traces) but add noise to the diff. Could be removed via `keepNames: false` if diff-noise becomes a problem.",
        "Edge case: if esbuild major-version is bumped in pnpm-lock.yaml, the SHA256 of SANDBOX_WORKER_SOURCE will change → the generated file will be re-committed automatically on next gen. The determinism test 1 (identical across runs) still passes because both runs use the SAME esbuild version. Cross-version reproducibility is not guaranteed."
      ],
      changed: [
        "scripts/generate-sandbox-source.mjs",
        "client/src/sandbox/sandbox-runtime.generated.ts",
        "client/src/sandbox/sandbox-runtime.ts",
        "client/src/sandbox/useScriptSandbox.ts",
        "package.json",
        "tests/features/script-sandbox-codegen.test.ts",
        "tests/features/script-sandbox-pentest.test.ts",
        "tests/features/script-sandbox.test.ts"
      ]
    },
    {
      agent:     "refactor",
      timestamp: "2026-05-12T18:15:00.000Z",
      done: [
        "TASK-109 / A: Replaced hardcoded text-cyan-300 + bg-black/80 hover-tooltip color in client/src/components/WaveformDisplay/WaveformDisplay.tsx with semantic tokens (text-accent-secondary, bg-bg-base/80). Also corrected bg-black/60 on zoom-reset button to bg-bg-base/60. AudioTrackStrip.tsx (only direct WaveformDisplay consumer outside SampleBrowser) was already clean — no extra changes there.",
        "TASK-109 / B: De-duped AudioTrackChannelData. Single-source-of-truth is now client/src/audio/AudioEngine.ts (where engine methods registerAudioTrack/setAudioTracksGetter use it directly). useAudioTrackStore.ts deletes its own interface declaration and re-exports the type from AudioEngine.ts via `export type { AudioTrackChannelData }`. No circular import — AudioEngine.ts does not import from useAudioTrackStore. All existing consumer import paths (`@/store/useAudioTrackStore`) keep working unchanged: projectSerializer.ts, MixerView.tsx, AudioTrackStrip.tsx, audio-track-store.test.ts. audio-track.test.ts already imports directly from AudioEngine.ts.",
        "TASK-109 / C: Removed unused `MACRO_COLORS` named import + unused `React` default import from MacroPanel.tsx (only `useState` was actually used — JSX runtime is automatic-mode via plugin-react in Vite 7, no React-in-scope needed).",
        "Verification: pnpm check clean. pnpm test 964/981 green (15 pre-existing skipped). 2 failures remain in tests/features/script-sandbox*.test.ts — NOT caused by this refactor: those test files assert literal `self.<global> = undefined` strings in the codegen sandbox-runtime.generated.ts output, but esbuild transpiles `undefined` -> `void 0`. These are pre-existing pending issues in TASK-108 (sandbox hardening) — explicitly out of scope for this refactor (`client/src/sandbox/*` forbidden).",
        "All test files touching my changed modules confirmed green: audio-track-store.test.ts (25/25), audio-track.test.ts (20/20), macros.test.ts (48/48) — 93/93 affected tests pass."
      ],
      next: [
        "TASK-108 owner: fix tests/features/script-sandbox.test.ts:171 — `expect(src).toContain('self.${g} = undefined')` fails because esbuild emits `void 0` instead. The newer tests/features/script-sandbox-pentest.test.ts:263 already uses a regex `(undefined|void 0)` — port that pattern to the older assertion.",
        "SampleBrowser.tsx has ~20 hardcoded text-cyan-*, bg-cyan-*, border-cyan-*, bg-green-900, bg-blue-900 occurrences — large but scoped refactor candidate for a follow-up TASK. Kept out of scope here per tight TASK-109 boundaries.",
        "FOLLOWUP-102 (4): full Playwright round-trip E2E save→reopen→relocate still pending — type dedup did not require touching this.",
        "Consider standing up a CI lint rule that errors on `bg-slate-*|bg-gray-*|text-cyan-*|bg-cyan-*|text-blue-*` patterns under `client/src/components/**` to prevent future regressions. Currently relies on review."
      ],
      changed: [
        "client/src/components/WaveformDisplay/WaveformDisplay.tsx",
        "client/src/store/useAudioTrackStore.ts",
        "client/src/components/Macro/MacroPanel.tsx"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-12T18:30:00.000Z",
      done: [
        "TASK-103 / C3: Extended useMacroStore.ts schema with discriminated union mode: \"knob\" | \"button\". Added scriptId?, triggerMode?: \"edge\" fields. Default mode=\"knob\" + triggerMode=\"edge\" via migrateMacro() — old localStorage data (pre-v1.16) auto-defaults on load, existing applyMacroBindings behavior unchanged.",
        "TASK-103 / C3: New public API: setMacroMode(idx, \"knob\"|\"button\"), setMacroScriptId(idx, id|null), triggerMacroButton(idx) → dispatches \"macro:button:trigger\" CustomEvent with {macroIndex, scriptId} (analog zu macro:change pattern). Defensive: switching mode does NOT clear bindings or scriptId.",
        "TASK-103 / C3: MacroPanel.tsx erweitert um Mode-Toggle in BindingEditor (radiogroup Knob/Button), Script-Dropdown bei mode=button mit allen scripts aus useScriptStore + Missing-Script-Hinweis + 'Edit in Script Runner →'-Link (dispatcht ss:navigate {tab: 'tools', tool: 'script'}). Neue MacroButton-Komponente: großer Button mit script.name als Label, macro.color als Background (inline gestyled — User-defined), onMouseDown triggert triggerMacroButton, disabled wenn keine scriptId.",
        "TASK-103 / C3: App.tsx Wiring: macro:button:trigger Event-Handler ruft scriptSandbox.run(script.code, {maxRuntimeMs}) — nur wenn script.enabled, mit Re-Entrancy-Schutz via isRunning(). Reuses C1+C2 scriptSandboxInstance.ts (kein neuer Singleton). ss:navigate erweitert um optionales tool-Feld (setActiveTool(\"script\")).",
        "TASK-103 / C3: tests/features/macros.test.ts um 16 neue Tests erweitert (jetzt 48 total, alle grün): default knob mode, setMacroMode mit defensiver bindings/scriptId-Preservierung, out-of-range no-ops, invalid mode-string no-ops, setMacroScriptId set/null/out-of-range, triggerMacroButton happy/wrong-mode/no-script/out-of-range, Old-Format-Migration (Daten ohne mode), persistence round-trip (vi.resetModules), corrupted mode-Wert wird auf knob korrigiert.",
        "TASK-103 / C3: pnpm check clean. pnpm test 949/964 grün (15 pre-existing skipped, +16 neue Macro-Button-Tests, 0 Regressionen)."
      ],
      next: [
        "Welle 3 (v1.17.x): triggerMode=\"hold\" implementieren — Re-fire während Maus-Down via setInterval mit Throttle. Aktuell nur \"edge\" verdrahtet.",
        "Welle 3 (UX): visuelles Press-Feedback verstärken (haptic-like glow), Status-Indikator wenn Script läuft (z.B. spinning ring um den Button).",
        "Welle 3 (UX): bei Re-Entrancy (Sandbox isRunning) sollte der Button UI-disabled werden statt silent-no-op — aktuell wirft App.tsx-Handler nichts.",
        "Welle 3 (Cleanup): MACRO_COLORS und React-Import in MacroPanel.tsx sind unused (waren es schon vor C3) — Aufräumen in Refactor-Welle.",
        "Welle 3 (Tests): Playwright E2E (tests/web/macro-button.spec.ts) — User wechselt Mode, wählt Script, klickt Button → Script läuft sichtbar in Console.",
        "Welle 3 (Audit): Beim Laden fremder Projekte werden Scripts via disableAllForeignProject auf enabled=false gesetzt (C1). MacroPanel zeigt aktuell aber das Script trotzdem in der Liste mit '(deaktiviert)'-Suffix — Klick auf Button macht no-op. Eventuell expliziter Hinweis nötig."
      ],
      changed: [
        "client/src/store/useMacroStore.ts",
        "client/src/components/Macro/MacroPanel.tsx",
        "client/src/App.tsx",
        "tests/features/macros.test.ts"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-12T18:05:00.000Z",
      done: [
        "TASK-103 / C1: Complete ScriptRunner UI refactor — replaced single 'new Function' editor with List + Editor layout backed by useScriptStore (persistent scripts).",
        "TASK-103 / C1: Created client/src/components/Tools/ScriptList.tsx — Left sidebar with script count, list items showing name + KeyBinding-indicator (KeyRound icon) + Macro-slot badge (M0..M7) + Delete button, plus Examples accordion with 3 snippets (bpm-ramp, random-fill, drop-hit).",
        "TASK-103 / C1: Created client/src/components/Tools/ScriptEditor.tsx — Code editor (textarea with Tab→2 spaces + Ctrl+S local save, NO global keybinding), Name input with Save button, Enabled checkbox, Scope radios (App|Projekt), KeyBinding recording UI with findKeyConflict-warning (action wins over script), Macro-slot dropdown with cross-script conflict detection, Validation errors block, Code-size counter (turns red over 10 KB), Live console panel.",
        "TASK-103 / C1: Refactored client/src/components/Tools/ScriptRunner.tsx — Module-singleton scriptSandbox import (sandbox bridge wired in App.tsx via configureSandboxBridge already from C2 wave), Run/Abort with live onLog streaming into setLogs, SandboxRunResult status mapped to colored Status label, code byte length counter via TextEncoder. Kept backward-compatible prop interface (bpm, isPlaying, onBpmChange?, onPlayStop?, dm?) — these are now unused since App.tsx handles bridge wiring centrally, but kept for caller compatibility.",
        "TASK-103 / C1: Created tests/web/script-runner.spec.ts — 9 Playwright smoke tests covering: + Neu button visibility, new script creates list entry, Code editor onBlur persistence, Run button → console output + success status, Abort stops long-running script, Enabled toggle line-through, Validation/size counter on oversized code, Macro-slot dropdown, Examples drop-in.",
        "TASK-103 / C1: All UI uses ONLY semantic --ss-* tokens (verified via grep for hardcoded tailwind colors — 0 matches in components/Tools/).",
        "TASK-103 / C1: pnpm check clean, pnpm test 933/948 grün (15 pre-existing skipped). 81 script-related tests (store/sandbox/keybindings) all green."
      ],
      next: [
        "Verify pnpm test:web tests/web/script-runner.spec.ts against running Vite (requires `pnpm dev` running, then `pnpm test:web tests/web/script-runner.spec.ts`).",
        "Welle 2C3 (parallel): MacroPanel UI should add binding-row that selects a Script via macroButtonIndex (currently the macro slot is bound in ScriptEditor — bidirectional UI nice-to-have).",
        "Welle 3 (Polish): inline diff/lint of code via simple parser (catch unterminated strings, missing braces). Currently relies on user receiving error in console after Run.",
        "Welle 3 (Polish): right-click on a script list item → 'Duplicate', 'Export to .synth project', 'Move to App/Project scope'.",
        "Edge-case: when a script is removed while it's running, the Sandbox still completes (no auto-abort). Acceptable — log via runStatus shows the result regardless.",
        "Future: keybinding-recording currently captures KeyboardEvent.key (script-side) AND event.code (action-side check). Browser-locale variations may make this brittle for non-ASCII keys (eg German Y/Z swap). Consider always using `code` for storage, render via locale-aware label."
      ],
      changed: [
        "client/src/components/Tools/ScriptRunner.tsx",
        "client/src/components/Tools/ScriptList.tsx",
        "client/src/components/Tools/ScriptEditor.tsx",
        "client/src/App.tsx",
        "tests/web/script-runner.spec.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-12T17:46:00.000Z",
      done: [
        "TASK-103 / C2: Created client/src/sandbox/scriptSandboxInstance.ts — co-owned Module-Singleton (ScriptSandbox + mutable Bridge-Objekt) für gemeinsame Nutzung durch ScriptRunner UI (C1) und useScriptKeyBindings (C2). Top-Comment markiert Co-Ownership.",
        "TASK-103 / C2: Created client/src/hooks/useScriptKeyBindings.ts — globaler Keydown-Listener mit Input-Skip + Action-Override-Check. Konflikt-Regel: Wenn dieselbe Combo eine ACTION (User-Override oder Default) matched, gewinnt die ACTION (das Skript feuert NICHT). Hook ruft scriptSandbox.run(code, { maxRuntimeMs }) auf, mit isRunning()-Guard gegen Re-Entrance.",
        "TASK-103 / C2: Pure helpers exportiert für Tests: findKeyConflict(actionCombo, scriptCombo, scripts, actionBindings) → { kind: 'action'|'script', id } | null; eventToScriptCombo(e) → ScriptKeyCombo (lowercase-Normalisierung für Single-Char); findMatchingAction(combo, overrides) → actionId | null.",
        "TASK-103 / C2: Hook erkennt zwei verschiedene KeyCombo-Welten: useScriptStore (key-basiert, KeyboardEvent.key) vs keyboardActionDefs (code-basiert, KeyboardEvent.code). Beide Combos werden parallel pro Event berechnet.",
        "TASK-103 / C2: KeyboardBindingsPanel.tsx um Read-Only-Sektion 'Scripts' erweitert. Listet alle Scripts mit keyBinding (egal welcher Scope), zeigt disabled-Marker für enabled=false, Klick dispatched 'ss:navigate' CustomEvent mit { tab: 'tools', scriptId }.",
        "TASK-103 / C2: scriptComboToLabel-Helper (panel-lokal) für 'Ctrl+Shift+B'-Format aus ScriptKeyCombo (eigene Impl weil comboToLabel in keyboardActionDefs auf event.code basiert, unser Store auf event.key).",
        "TASK-103 / C2: App.tsx wiring — useScriptKeyBindings(true) direkt nach useGlobalKeyBindings(true) (Zeile 517). configureSandboxBridge useEffect (Zeile 523-554) verdrahtet setBpm/play/stop/setStep/dispatchAction/getMacroValue/setMacroValue. setStep liest aktuellen State via dmRef.getActivePattern() und ruft toggleStep nur wenn Soll!=Ist (idempotent). ss:navigate Event-Listener (Zeile 559-578) wechselt zu Tools-Tab + dispatched ss:script-select für ScriptRunner.",
        "TASK-103 / C2: Konsolidierung — setMacroValue zu existing getMacros/applyMacroBindings-Import in App.tsx hinzugefügt (Zeile 93), kein duplicate import.",
        "TASK-103 / C2: tests/features/script-keybindings.test.ts mit 14 Tests (alle grün) — covered: eventToScriptCombo lowercase + multi-char + alle Modifier; findMatchingAction default + override + null; findKeyConflict action-match / script-match / null / disabled-skip / no-keyBinding-skip / action-wins-over-script (Space-Kollision) / strict-modifier-match / non-action user-script-combo.",
        "TASK-103 / C2: pnpm check clean (nur C1-pre-existing ScriptList.tsx/ScriptRunner.tsx → ScriptEditor errors — nicht von uns), pnpm test 933/948 grün (15 pre-existing skipped, 14 neue Tests grün)."
      ],
      next: [
        "C1 (parallel): ScriptRunner.tsx muss ss:script-select-Event abonnieren um per Navigation aus KeyboardBindingsPanel auf das richtige Skript zu springen. Aktuell wird der Event von App.tsx weitergeleitet aber ScriptRunner.tsx ist Welle 2C1 — bitte dort Listener für 'ss:script-select' implementieren.",
        "C1 (parallel): scriptSandboxInstance.ts ist Co-owned. Wenn C1 die Datei ebenfalls anlegt, MÜSSEN beide Implementierungen identisch sein (Test: nach Merge keine Funktionsänderung).",
        "Welle 3 (optional): macroSlot-getter in scriptSandboxInstance.ts hinzufügen wenn TASK-103/C3 (MacroPanel) Skripte direkt vom Macro-Knob triggern soll. Aktuell ist setMacro/getMacro nur als Sandbox-Bridge verdrahtet, nicht als Trigger.",
        "Welle 3 (optional): KeyboardBindingsPanel könnte eine Direct-Edit-Spalte zeigen (Combo neu binden ohne ScriptRunner-Wechsel). Aktuell nur Read-Only-Liste.",
        "Edge-Case (gemeldet, nicht behoben): bei sehr schnellem Drücken zweier verschiedener Script-Combos hintereinander (< runtime) wird die zweite silent geschluckt wegen isRunning()-Guard. Sandbox müsste eine Queue haben — aktuelles Behavior ist akzeptabel (keine parallele Worker-Spawns)."
      ],
      changed: [
        "client/src/sandbox/scriptSandboxInstance.ts",
        "client/src/hooks/useScriptKeyBindings.ts",
        "client/src/components/Settings/KeyboardBindingsPanel.tsx",
        "client/src/App.tsx",
        "tests/features/script-keybindings.test.ts"
      ]
    },
    {
      agent:     "backend",
      timestamp: "2026-05-12T17:45:00.000Z",
      done: [
        "TASK-103 / B: Created client/src/sandbox/sandbox-runtime.ts (127 LOC) — Worker-Entry-Point mit Härtung (fetch/XHR/WebSocket/EventSource/indexedDB/caches/importScripts/Worker/SharedWorker/BroadcastChannel/Notification/RTC*/navigator/clients/postMessage neutralisiert)",
        "TASK-103 / B: Created client/src/sandbox/useScriptSandbox.ts (527 LOC) — ScriptSandbox-Klasse mit Allowlist-Bridge (8 Methoden: bpm/play/stop/setStep/dispatch/log/getMacro/setMacro), Wall-Clock-Timeout, Blob-URL-Worker-Factory, Param-Clamping/Validation",
        "TASK-103 / B: Created tests/features/script-sandbox.test.ts (487 LOC, 30 Tests) — nutzt Node worker_threads als MockWorker um den ECHTEN SANDBOX_WORKER_SOURCE-String im OS-Thread zu testen (statt nur Stubs). Damit lässt sich while(true){} ohne Test-Crash verifizieren.",
        "TASK-103 / B: Dispatch-Allowlist umfasst 16 idempotente Pattern/Transport-Actions (play-stop, pattern-*, bpm-*, part-*); alles sonst (save, load, delete-pattern, …) wird abgewiesen.",
        "TASK-103 / B: Param-Clamping: bpm 20..300 int, macro idx STRICT 0..7 (throws bei out-of-range — kein silent-clamp), macro v 0..1, stepIdx 0..63, log 500 chars, wait 0..60s. setStep on=boolean wird strikt validiert.",
        "TASK-103 / B: pnpm check clean, pnpm test 919/934 grün (15 pre-existing skipped, 30 neue Sandbox-Tests alle grün)",
        "TASK-103 / B: ScriptRunner.tsx unverändert gelassen (Welle 1 Constraint) — Wire-up in Welle 2."
      ],
      next: [
        "Welle 2 (UI): ScriptRunner.tsx von 'new Function()' auf ScriptSandbox umstellen — App.tsx liefert den Bridge-Setter-Bag (AudioEngine.setBpm, dm.toggleStep, getMacros/setMacroValue, window.dispatchEvent für kb:action).",
        "Welle 2 (UI): MacroPanel/KeyboardBindings können sandbox.run(script.code) für gespeicherte useScriptStore-Einträge triggern (TASK-103/A liefert findScriptByMacroIndex/findScriptByKeyCombo).",
        "Welle 2 (Security): SANDBOX_WORKER_SOURCE ist als String-Literal Duplikat zu sandbox-runtime.ts. CI sollte einen Diff-Check einbauen (z.B. via esbuild-Bundling der .ts-Datei + Snapshot-Compare).",
        "Welle 2 (Tests): Playwright-E2E in tests/web/script-sandbox.spec.ts für echten Web-Worker (statt worker_threads-Shim) — verifiziert dass Blob-URL + CSP zusammenspielen.",
        "Edge-Cases NOCH OFFEN (für Welle 2 Security Audit): (1) eval-via-Function-chains (z.B. user-code holt sich Function.constructor und ruft Function('return import(\"x\")')), (2) Promise.race mit Timeout-Starvation (massive microtask-flood verzögert das main-thread timer fire), (3) Message-Event-Spoofing wenn User-Code postMessage über Stack-Trace findet, (4) Prototype-Pollution auf ss-Objekt (Object.freeze fehlt aktuell), (5) Riesige Buffer in ss.log (potential OOM, aktuell nur length-truncate auf 500), (6) Log-Spam Rate-Limiting (1000 entries cap genügt, aber pro-Sekunde-throttle wäre ein Plus)."
      ],
      changed: [
        "client/src/sandbox/sandbox-runtime.ts",
        "client/src/sandbox/useScriptSandbox.ts",
        "tests/features/script-sandbox.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-12T17:40:00.000Z",
      done: [
        "TASK-103 / A: Created client/src/store/useScriptStore.ts — Custom Observer Store (Module-Singleton + Listener-Set), persistiert nur scope:'app' Scripts in localStorage (Key ss-scripts:v1). Project-scope wandert ausschließlich via .synth.",
        "TASK-103 / A: Public API — addScript/removeScript/updateScript/getScript/getAllScripts/getProjectScripts/getAppScripts/loadProjectScripts/clearProjectScripts/disableAllForeignProject + pure helpers validateScript/isValidScriptEntry/findScriptByKeyCombo/findScriptByMacroIndex + useScriptStore() React-Hook.",
        "TASK-103 / A: Constants — MAX_SCRIPTS=64, MAX_SCRIPT_CODE_BYTES=10_000 (UTF-8 byteLength), DEFAULT_MAX_RUNTIME_MS=5000.",
        "TASK-103 / A: Bumped client/src/utils/projectSerializer.ts SYNTH_FILE_VERSION '1.15' → '1.16'. Added optional scripts?: Script[] zu SynthProject. parseProject filtert invalide Items via isValidScriptEntry + ZWINGT enabled=false auf alle geladenen Scripts (User-Consent-Pflicht).",
        "TASK-103 / A: Wired into App.tsx — buildProjectSnapshot ruft getProjectScripts(); restoreProject ruft loadProjectScripts() + disableAllForeignProject() nach loadAudioTracks().",
        "TASK-103 / A: Tests tests/features/script-store.test.ts mit 37 Tests (alle grün): addScript happy/limit/oversized/empty-name, remove/update/no-op/id-immutable/createdAt-immutable, scope-Filter, loadProjectScripts replaced-only-project, clearProjectScripts, disableAllForeignProject preserves app, localStorage round-trip (app only), validateScript edge-cases (name/code/keyCombo/macroIdx), findByKeyCombo strict-modifier, findByMacroIndex, Serializer-Roundtrip incl. forced enabled=false, v1.15-Migration → scripts=[], Nicht-Array → [], invalid-Items silent.",
        "TASK-103 / A: Updated audio-track-store.test.ts version-assertions auf '1.16' (additive Migration).",
        "TASK-103 / A: pnpm check grün, pnpm test 919/934 (15 pre-existing skipped) komplett grün."
      ],
      next: [
        "Welle 1B (parallel): useScriptSandbox/sandbox-runtime liest jetzt aus dem fertigen Store — Wiring von Sandbox-Aufruf an key/macro events kann in Welle 2 angegangen werden.",
        "TASK-103 / Welle 2: ScriptRunner.tsx auf useScriptStore migrieren (CRUD-UI + 'Enable Script' Consent-Toggle für scope:project nach Project-Load).",
        "TASK-103 / Welle 2: useMacroStore erweitern um optionale scriptId-Routing (findScriptByMacroIndex bei macro:trigger statt nur Value-Bindings).",
        "TASK-103 / Welle 2: useKeyboardBindingsStore × findScriptByKeyCombo → global key handler routes zu Sandbox-Eval.",
        "Optional: Code-byteLength via TextEncoder fällt bei extrem alten Browsern auf encodeURIComponent zurück — beobachten falls Reports.",
        "Hinweis: parseProject erzwingt enabled=false auch beim eigenen Cache-Restore (loadCachedProject → parseProject). Falls Self-Persist gewünscht: eigener Pfad nötig. Aktuell sicher gewählt."
      ],
      changed: [
        "client/src/store/useScriptStore.ts",
        "client/src/utils/projectSerializer.ts",
        "client/src/App.tsx",
        "tests/features/script-store.test.ts",
        "tests/features/audio-track-store.test.ts"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-12T17:00:00.000Z",
      done: [
        "TASK-102 / F3: Created AudioTrackStrip.tsx (channel-strip-Variant für externe Audio-Tracks)",
        "TASK-102 / F3: MixerView.tsx erweitert um [+ Audio Track]-Button im Header (mit Counter X/8)",
        "TASK-102 / F3: MixerView.tsx rendert AudioTrackStrips zwischen drum-parts und master",
        "TASK-102 / F3: Engine-Getter AudioEngine.setAudioTracksGetter() einmalig im Mount-useEffect gesetzt",
        "TASK-102 / F3: DragDrop in MixerView channel-area – Audio-Dateien werden als Audio-Track ingestiert",
        "TASK-102 / F3: App.tsx Relocate-Probe nach loadAudioTracks() (Electron: getAudioMetadata; Browser: alle als broken markiert)",
        "TASK-102 / F3: App.tsx Browser-Warning-Toast bei Save mit Audio-Tracks + LocalStorage-Dismiss",
        "TASK-102 / F3: Playwright-Smoke tests/web/audio-track.spec.ts (5 Tests: Add-Button, Strip-Erscheinen, Controls, Remove, Sync-Mode)",
        "TASK-102 / F3: pnpm check + pnpm test grün (852/867, 15 pre-existing skipped)"
      ],
      next: [
        "Verifizieren: Playwright web-test gegen lokalen Vite-Server laufen lassen (pnpm test:web tests/web/audio-track.spec.ts)",
        "v1.17.0: Pitch-preserving stretch implementieren (aktuell nur playbackRate = Pitch+Tempo gekoppelt)",
        "Optional UI: WaveformDisplay Hover-Tooltip nutzt hardcoded text-cyan-300 — auf text-accent-secondary umstellen",
        "Audio-Track Solo-Logik: Drum-Parts werden NICHT von Audio-Track-Solo betroffen (gewollt — Audio-Track-Solo scope-isoliert in Engine)"
      ],
      changed: [
        "client/src/components/Mixer/AudioTrackStrip.tsx",
        "client/src/components/Mixer/MixerView.tsx",
        "client/src/components/Mixer/index.ts",
        "client/src/App.tsx",
        "tests/web/audio-track.spec.ts"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-12T16:37:00.000Z",
      done: [
        "TASK-102 / F2: Verified useAudioTrackStore module-singleton + Observer-Pattern implementation",
        "TASK-102 / F2: Verified projectSerializer.ts bumped to SYNTH_FILE_VERSION='1.15' with audioTracks field",
        "TASK-102 / F2: Verified App.tsx save/load wiring (buildProjectSnapshot calls getAllAudioTracks(), restoreProject calls loadAudioTracks())",
        "TASK-102 / F2: Wrote tests/features/audio-track-store.test.ts (25 tests across store + serializer)",
        "TASK-102 / F2: pnpm check clean, pnpm test 832/847 passing (15 pre-existing skipped)"
      ],
      next: [
        "F1 (AudioEngine) and F3 (Mixer UI) parallel tracks — wire UI to store after F1 lands buffer-decode pipeline",
        "Consider de-duping AudioTrackChannelData type: it lives in BOTH useAudioTrackStore.ts and AudioEngine.ts — once F1 stabilises, projectSerializer.ts + store should import from AudioEngine.ts as single source of truth",
        "F3 must ensure no hardcoded Tailwind colors when MixerView gets the new audio-track channels"
      ],
      changed: [
        "tests/features/audio-track-store.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-12T00:00:00.000Z",
      done: [
        "v1.15.5 bugfix wave coordinated and merged",
        "Synced INDEX.js version from 1.15.1 to 1.15.4 (match package.json)",
        "Marked BUG-001 (Space key) as fixed in fe62713",
        "Marked BUG-003 (double titlebar) as fixed in 0db2a54",
        "Marked BUG-004 (KI-Generator hang) as fixed in fe62713 (runtime require -> ES import)",
        "Added BUG-005 (Quantize-Crash) — fixed by TASK-104",
        "Added BUG-006 (Macro routing missing) — fixed by TASK-100",
        "Added BUG-007 (Close-Button inconsistency on ~20 panels) — fixed by TASK-105"
      ],
      next: [
        "TASK-101 (Layout-Bug) still open — needs reproducible repro from user",
        "BUG-002 (BPM +/- UX) still open — needs frontend fix or doc clarification",
        "v1.16.0: TASK-102 (Audio-Track for vocals/songs) — needs persistence decision (.synth path-ref vs blob vs session-only)",
        "v1.16.0: TASK-103 (Script persistence + key/macro binding) — useScriptStore does not exist yet, security review mandatory for eval sandbox",
        "v1.16.0: Phase-P Auto-Updater + Multi-Platform CI — blocked on Apple Developer + Windows EV cert procurement"
      ],
      changed: [
        "agents/INDEX.js",
        "client/src/utils/quantizeGrid.ts",
        "tests/features/quantize.test.ts",
        "tests/web/quantize.spec.ts",
        "client/src/store/useMacroStore.ts",
        "client/src/App.tsx",
        "tests/features/macros.test.ts",
        "client/src/components/PerformanceMode/NoteRepeatPanel.tsx",
        "client/src/components/PatternMorph/PatternMorphPanel.tsx",
        "client/src/components/DrumMachine/MixAssistantPanel.tsx",
        "client/src/components/DrumMachine/ResizableDrumPanel.tsx",
        "client/src/components/DrumMachine/FxPanel.tsx",
        "client/src/components/DrumMachine/StepInspector.tsx",
        "client/src/components/DrumMachine/WavetableEditor.tsx",
        "client/src/components/DrumMachine/CollabStatus.tsx",
        "client/src/components/DrumMachine/ModMatrix.tsx",
        "client/src/components/DrumMachine/SynthPanel.tsx",
        "client/src/components/Macro/MacroPanel.tsx",
        "client/src/components/PianoRoll/PianoRollModal.tsx",
        "client/src/components/ShortcutsHelp/ShortcutsHelp.tsx",
        "client/src/components/NewProjectDialog/NewProjectDialog.tsx",
        "client/src/components/MidiSettings/MidiSettings.tsx",
        "client/src/components/CollabSession/CollabChat.tsx",
        "client/src/components/Settings/CustomThemeCreator.tsx",
        "client/src/components/Settings/ThemeSettings.tsx",
        "client/src/components/Settings/SettingsPanel.tsx",
        "client/src/components/Scene/SceneLaunchPad.tsx",
        "tests/web/close-buttons.spec.ts"
      ]
    }
  ],

  // ─── CURRENT OPEN TASKS ────────────────────────────────────
  // High-level tasks visible to all agents. Coordinator manages this.
  openTasks: [
    {
      id:       "TASK-101",
      title:    "Layout verzogen — reproducible cases pending",
      severity: "high",
      target:   "v1.15.5 or v1.15.6",
      notes:    "User reported 'layout verzogen' but no concrete reproduction. Needs Playwright multi-viewport sweep."
    },
    {
      id:       "FOLLOWUP-102",
      title:    "Audio-Track refinements (post-v1.16.0)",
      severity: "low",
      target:   "v1.16.1 / v1.17.0",
      notes:    "(1) De-dup AudioTrackChannelData type (currently in both useAudioTrackStore.ts and AudioEngine.ts). (2) Pitch-preserving stretch via existing TimeStretchProcessor.js worklet. (3) Solo cross-store unification (drum+audio). (4) Full Playwright round-trip E2E (save → reopen → relocate)."
    },
    {
      id:       "TASK-103",
      title:    "Script persistence + key/macro binding",
      severity: "medium",
      target:   "v1.16.0",
      notes:    "useScriptStore does not exist. Requires security review for sandboxed eval/Function() — no globalThis/Node access."
    },
    {
      id:       "BUG-002",
      title:    "BPM +/- buttons UX clarification",
      severity: "low",
      target:   "any",
      notes:    "Buttons look clickable but are kbd-only. Either wire onClick or remove visual affordance."
    }
  ],

  // ─── API / IPC REFERENCE ───────────────────────────────────
  ipc: {
    note:     "All IPC calls go through useElectron() hook — never window.electronAPI directly",
    channels: [
      "file:save-project", "file:open-project", "file:export-wav",
      "collab:start-session", "collab:join-session", "collab:leave-session",
      "midi:export", "dialog:open", "dialog:save",
      "transport:play", "transport:stop", "transport:bpm"
    ]
  },

  // ─── SCRIPT RUNNER API ─────────────────────────────────────
  scriptAPI: {
    "ss.bpm(value)":       "Set BPM (number)",
    "ss.dispatch(event)":  "Fire transport/pattern event",
    "ss.wait(ms)":         "Async delay in scripts"
  },

  // ─── UPDATE FUNCTION ───────────────────────────────────────
  /**
   * Call this at the end of every agent session.
   * @param {Object} entry
   * @param {string} entry.agent    - Agent name (e.g. "frontend", "testing")
   * @param {string[]} entry.done   - What was completed
   * @param {string[]} entry.next   - What should happen next
   * @param {string[]} entry.changed - File paths that were modified
   */
  update(entry) {
    this.workLog.push({
      agent:     entry.agent,
      timestamp: new Date().toISOString(),
      done:      entry.done    || [],
      next:      entry.next    || [],
      changed:   entry.changed || []
    });

    // Update lastSeen for any changed files that are in the index
    (entry.changed || []).forEach(f => {
      if (this.files[f]) {
        this.files[f].lastSeen = new Date().toISOString();
      } else {
        this.files[f] = { role: "modified by " + entry.agent, lastSeen: new Date().toISOString(), ownedBy: entry.agent };
      }
    });

    console.log(`[INDEX] ${entry.agent} logged work at ${new Date().toISOString()}`);
  }
};

module.exports = INDEX;
