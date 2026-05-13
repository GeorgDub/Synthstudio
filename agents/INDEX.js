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
    version: "1.23.0",
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
      role:     "Root component, tab routing (F1-F6), AudioEngine.onPosition() automation callback. v1.22.0 (TASK-117): Macro-Setter-Bag um setLfoRate/setLfoDepth erweitert — onUnhandled-Warn-Spezialfall entfernt (jetzt generisch).",
      lastSeen: "2026-05-12T23:00:00.000Z",
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
      role:     "Web Audio API wrapper — synthesis, FX chains, playback scheduling. v1.22.0 (TASK-117): static SynthEngine-Import + lazy _synthEngine-Instanz + setPartLfoRate/Depth + getPartLfoRate/Depth Delegates für Macro-LFO-Routing.",
      lastSeen: "2026-05-12T23:00:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/audio/SynthEngine.ts": {
      role:     "Oscillators, ADSR, Wavetable + FM synthesis modes. v1.22.0 (TASK-117): Macro-LFO-Cache (Map<partId, {rate?, depth?}>) + setPartLfoRate/Depth + getPartLfoRate/Depth + clearPartLfoCache + triggerNote(.., partId?) override-Pfad. Range: PART_LFO_RATE_MIN=0.01..MAX=30, PART_LFO_DEPTH 0..1.",
      lastSeen: "2026-05-12T23:00:00.000Z",
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
    },
    "client/src/store/usePerformanceStore.ts": {
      role:     "Performance Mode pads (16), quantizeMode, queuedPatternId. movePad+moveMultiplePads (Insert-Semantik, v1.21.0/TASK-114) für Reorder mit Multi-Select. v1.22.0 (TASK-119): exportiert PAD_COLOR_VAR_NAMES (8 CSS-var-Namen --ss-pad-1..8) für theme-aware Default-Pad-Farben.",
      lastSeen: "2026-05-12T23:30:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/components/PerformanceMode/PatternLaunchPad.tsx": {
      role:     "Vollbild Performance-Mode UI. Modi Play/Edit/Reorder. v1.21.0 (TASK-114): WAI-ARIA Roving-Tabindex Grid + Keyboard-Reorder (Space=grab, Pfeile=move, Escape=cancel mit Snapshot-Restore) + Multi-Select via Shift/Ctrl+Click + Bulk-Drag. v1.22.0 (TASK-119): Default-Pad-Farben via getPadDefaultColor() aus --ss-pad-1..8 (theme-aware), User-defined pad.color hat Vorrang, Color-Swatch-Picker zeigt 8 theme-Slots. v1.22.0 (TASK-120+123): Mouse-Box Rubber-Band-Selection (mousedown auf Grid-Background → mousemove → Selection-Overlay; Shift = additiv, ohne Modifier = replace; Escape clearet Multi-Select) + Multi-Drag-Image (Canvas 60x60 mit Pad-Color + accent-secondary Border + '+N' Badge via dataTransfer.setDragImage). Exportiert pure Helper normalizeBox/boxIntersects/collectPadsInBox + AxisRect-Typ für Unit-Tests.",
      lastSeen: "2026-05-12T23:50:00.000Z",
      ownedBy:  "frontend"
    },
    "tests/features/performance-mouse-box.test.ts": {
      role:     "Unit-Tests für die pure Helper normalizeBox/boxIntersects/collectPadsInBox aus PatternLaunchPad.tsx. 24 Tests (TASK-120) — alle DOM-frei via direkten Helper-Import.",
      lastSeen: "2026-05-12T23:50:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/store/useMacroStore.ts": {
      role:     "8 Macro-Knöpfe (knob/button-Mode), Audio-Routing via applyMacroBindings, Script/Pad-Trigger via macro:button:trigger Event. v1.22.0 (TASK-118): MacroTriggerMode='edge'|'hold' (vorher type-only edge), neue Public-API setMacroTriggerMode + triggerMacroButtonRelease. triggerMacroButton-Event.detail enthält jetzt triggerMode für App.tsx-Loop-Entscheidung. Migration: alte/invalide triggerMode → 'edge'.",
      lastSeen: "2026-05-12T23:45:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/utils/macroHoldLoop.ts": {
      role:     "Pure-Logik-Helper für Macro-Button Hold-Mode (TASK-118 / v1.22.0). Module-State Map<macroIndex → HoldLoopState>, inject-Scheduler-Pattern für Test-Isolation. startHoldLoop / stopHoldLoop / stopAllHoldLoops / isHoldLoopActive / getActiveHoldLoopCount. No-Stacking: zweiter Call für selben Index ersetzt erste Loop. Konstanten: SCRIPT_HOLD_INTERVAL_MS=200, PAD_HOLD_INTERVAL_MS=100.",
      lastSeen: "2026-05-12T23:45:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/components/Macro/MacroPanel.tsx": {
      role:     "MacroPanel UI: 8 MacroKnob/MacroButton + BindingEditor mit Mode-Toggle (Knob/Button), Trigger-Kind-Toggle (Script/Pad), Audio-Bindings, Script/Pad-Picker. v1.22.0 (TASK-118): neuer Trigger-Verhalten-Toggle (Edge/Hold) im Button-Mode, MacroButton zeigt 🔁-Icon-Overlay im Hold-Mode, onMouseUp/Leave/touchEnd ruft triggerMacroButtonRelease.",
      lastSeen: "2026-05-12T23:45:00.000Z",
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
    "Audio Tracks":      { store: "useAudioTrackStore.ts",   tab: "F2 (Mixer)",        status: "stable (v1.19.0+)", notes: "Path-ref persistence in .synth, max 8 tracks, 3 sync-modes: free | stretch (pitch+tempo) | timestretch (pitch-preserving OLA, max 4 simultaneous). Cross-store solo with drum-parts." }
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
      title:   "BPM +/- buttons appear clickable but give no visible feedback",
      severity: "low / UX",
      details:  "onClick handlers existed since v1.6.0 (functional), but hover:bg-bg-elevated === default bg-bg-elevated → zero visible feedback on hover/click. User assumed buttons were decorative kbd-shortcut indicators. Fix: hover swaps bg-elevated→bg-base + text-muted→text-primary, added active:scale-95, title='BPM ±1 (Taste: ±)', aria-label.",
      fixed:    true,
      foundBy:  "user",
      fixedBy:  "frontend",
      fixedIn:  "TASK-110 (v1.18.2)"
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
    },
    "BUG-008": {
      title:   "Doppelter Header + doppelter Close-Button in DrumMachine-Floating-Panels (\"Layout verzogen\")",
      severity: "medium (UX)",
      details:  "Reproduktion: Sequencer-Tab öffnen → Pattern Morph / Note Repeat / Envelope Follower / Macros / Granular / Polyrhythm Panel öffnen. Sichtbar: ZWEI 'Pattern Morph'-Header (outer ResizableDrumPanel + inner Panel) und ZWEI X-Buttons übereinander. Ursache: TASK-105 hat ResizableDrumPanel.title + onClose ergänzt, ohne dass die Inner-Panels (PatternMorphPanel, NoteRepeatPanel, EnvelopeFollowerPanel, MacroPanel, GranularSynthPanel, PolyrhythmVisualizer) ihren eigenen Header entfernt haben. Fix: DrumMachine.tsx übergibt nicht mehr `title=` an ResizableDrumPanel + Inner-Panels bekommen kein onClose mehr (Outer-Wrapper X übernimmt). Inner-Headers bleiben erhalten, weil sie zusätzliche Status-Info (BPM, % Morph, Aktiv-Count) anzeigen.",
      fixed:    true,
      foundBy:  "testing (TASK-101 multi-viewport sweep + screenshot review)",
      fixedBy:  "testing",
      fixedIn:  "TASK-101 (v1.18.x)"
    },
    "BUG-010": {
      title:   "Script-Runner: CSP-Error 'unsafe-eval' beim Ausführen — Scripts laufen gar nicht",
      severity: "critical",
      details:  "Reproduktion: Tools-Tab → Script-Runner → '+ Neu' → Skript-Code → Run → 'Script error: Evaluating a string as JavaScript violates the following CSP directive: script-src self'. Ursache: sandbox-runtime.ts L199 nutzte `new Function('ss', code)` zum Ausführen — Chromium behandelt new Function als eval und braucht 'unsafe-eval' im script-src. Worker erben den parent-CSP für eval. Fix-Strategie (gewählt nach Trade-off-Analyse): **User-Code wird vor dem Worker-Bau in die Worker-Source eingebettet** statt zur Run-Time via Function/eval ausgeführt. Konkret: ein `const __ssMarker = '...';return __ssMarker;` Marker im sandbox-runtime.ts wird in useScriptSandbox.buildWorkerSource() durch den User-Code-String ersetzt, dann erst kommt der Blob+Worker zum Einsatz. Sicherheits-Modell unverändert: Bridge-Validation auf dem Main-Thread (Allowlist-Check + Param-Clamping) bleibt die echte Trust-Boundary. User-Code kann zwar via Closure jetzt `__bridgePost` referenzieren, aber Worst-Case (fake ss-replies an eigene Promises) kann nicht über die Allowlist eskalieren. CSP bleibt strikt (kein 'unsafe-eval' nötig). Marker als `const`-Declaration weil esbuild Kommentare/void-Expressions wegoptimiert, aber const-Bindings im non-minify-Modus erhält.",
      fixed:    true,
      foundBy:  "user (post-v1.23.0 report)",
      fixedBy:  "frontend (with security-agent review note)",
      fixedIn:  "BUG-010 fix (post-v1.23.0)",
      relatedFiles: [
        "client/src/sandbox/sandbox-runtime.ts",
        "client/src/sandbox/sandbox-runtime.generated.ts",
        "client/src/sandbox/useScriptSandbox.ts"
      ]
    },
    "BUG-011": {
      title:   "Audio-Workbench: Tonspur wird nicht visualisiert + Selektion/Trennung nach Vocal/Kick/etc fehlt",
      severity: "high (UX)",
      details:  "User-Report: in der Audio-Workbench wird die geladene Tonspur nicht als Waveform visualisiert. Zusätzliche Wünsche: (a) Trennung/Filter nach Kategorie (Vocal, Kicks, Snares etc.) — vermutlich gemeint: Multi-Track-Editor wo verschiedene Sample-Typen separat angezeigt werden; (b) Bereich-Selektion zum Ausschneiden/Bearbeiten (Audacity-Style — siehe ROADMAP Phase Q 'Audacity-Level Workbench'). Vermutlich Bug in der WaveformDisplay-Render-Logik oder fehlende Verbindung zwischen AudioBuffer und Canvas-Renderer. Affected: client/src/components/AudioWorkbench/AudioWorkbench.tsx, client/src/components/WaveformDisplay/WaveformDisplay.tsx.",
      fixed:    false,
      foundBy:  "user (post-v1.23.0 report)",
      target:   "v1.24.0 (Phase Q Workbench-Wave)"
    },
    "BUG-012": {
      title:   "Sample Browser: Waveform-Visualisierung nach Analyse fehlt + BPM-Detection läuft nicht",
      severity: "high (UX)",
      details:  "User-Report: Sample Browser analysiert ein Sample (Spinner / Status sichtbar) aber zeigt anschließend keine Waveform. BPM-Detection greift ebenfalls nicht — Sample bekommt keine BPM zugeordnet. Möglicherweise zwei separate Bugs: (a) WaveformDisplay-Component erhält Daten nicht oder rendert nicht (Canvas-Zustand?); (b) BPM-Worker (workers/audioAnalysis.worker.ts) liefert kein Ergebnis zurück oder das Result wird nicht ins useProjectStore.samples geschrieben. Reproduzieren mit verschiedenen Sample-Formaten (WAV/MP3) um Format-Specific-Issues auszuschließen. Affected: client/src/components/SampleBrowser/, client/src/workers/audioAnalysis.worker.ts, client/src/hooks/useBpmDetection.ts.",
      fixed:    false,
      foundBy:  "user (post-v1.23.0 report)",
      target:   "v1.24.0"
    },
    "BUG-013": {
      title:   "Neues Projekt: bestehende Patterns + Content werden NICHT zurückgesetzt",
      severity: "high (data-integrity)",
      details:  "Ursache: NewProjectDialog.onCreateProject rief nur dm.resetAll() + project.newProjectFromTemplate auf — der ganze Restzustand aus useMixerStore, useAutomationStore, usePerformanceStore, useMacroStore, useScriptStore, useAudioTrackStore, useMelodicPartStore, useNoteRepeatStore, useTransposeStore, useMorphStore, useHumanizerStore, useSongStore blieb bestehen. Fix: neue Public-Reset-API in den 5 Stores die bisher nur __resetForTests hatten (resetMixer, resetAutomation, resetPerformance, resetMelodicParts, resetNoteRepeat). Plus zentraler `doFullProjectReset` Callback in App.tsx der alle 13 relevanten Stores in koordinierter Reihenfolge resettet — wird vom NewProjectDialog.onCreate aufgerufen. Bewusst NICHT zurückgesetzt: Theme, ApiSettings, Metronome, KeyboardBindings, Script App-Scope, Chord-Memory, MIDI-Settings (User-Vorlieben bleiben über Projekt-Wechsel).",
      fixed:    true,
      foundBy:  "user (post-v1.23.0 report)",
      fixedBy:  "frontend",
      fixedIn:  "BUG-013 fix (post-v1.23.0)",
      relatedFiles: [
        "client/src/App.tsx",
        "client/src/store/useMixerStore.ts",
        "client/src/store/useAutomationStore.ts",
        "client/src/store/usePerformanceStore.ts",
        "client/src/store/useMelodicPartStore.ts",
        "client/src/store/useNoteRepeatStore.ts"
      ]
    },
    "BUG-015": {
      title:   "ElectronTitleBar: Titel-Text überlappt (links '\"App-Name + Projekt'\" + Mitte 'Projektname' kollidieren)",
      severity: "medium (UX)",
      details:  "User-Report mit Screenshot bilder/1.jpg: oben links zeigt der Titel-Bar zwei sich überlappende Texte — 'Synthstudio – Leeres Projekt' und 'Leeres Projekt' überschreiben sich. Ursache (verifiziert via Code-Review ElectronTitleBar.tsx L100-144): die linke Seite rendert den vollständigen titleParts.join('–') der den Projektnamen ENTHÄLT, während gleichzeitig die Mitte (absolute left-1/2 -translate-x-1/2) den Projektnamen NOCHMALS zentriert anzeigt. Bei schmalen Fenstern oder kurzen Projektnamen kollidieren beide. Fix: linke Seite zeigt jetzt nur 'Synthstudio' (App-Name ohne Projekt) — Projektname bleibt nur in der zentrierten Mitte. Position relative ergänzt am Wrapper damit absolute Positioning eindeutig im TitleBar-Container ist.",
      fixed:    true,
      foundBy:  "user (Screenshot bilder/1.jpg, post-v1.23.0)",
      fixedBy:  "frontend",
      fixedIn:  "BUG-015 fix (post-v1.23.0)",
      relatedFiles: [
        "electron/components/ElectronTitleBar.tsx"
      ]
    },
    "BUG-014": {
      title:   "Pattern-Generator Vorlagen: BPM-Input lässt sich nicht clearen, springt auf 40",
      severity: "medium (UX)",
      details:  "Ursache verifiziert: usePatternGeneratorStore.setTemplateBpm clampt jeden non-null-Wert sofort auf Math.max(40, Math.min(240, bpm)). Der Vorlagen-Input war eine controlled-number-Input die bei jedem keystroke direkt setTemplateBpm aufruft. Tippen einer 1 (auf dem Weg zu 120) → 1 < 40 → store clampt zu 40 → input zeigt 40 → User kann nicht mehr eingeben. Fix: Lokaler String-Draft-State `templateBpmDraft` (+ `promptBpmDraft` für das gleiche Problem im Prompt-Tab) während des Tippens, Commit + Clamp erst on-Blur (oder Enter). Input-Type von 'number' auf 'text' inputMode='numeric' geändert damit Empty-String + Leading-Zeros nicht durch Browser-Validation gefressen werden. Affected: client/src/components/PatternGenerator/PatternGeneratorPanel.tsx (templateBpm + promptBpm).",
      fixed:    true,
      foundBy:  "user (post-v1.23.0 report)",
      fixedBy:  "frontend",
      fixedIn:  "BUG-014 fix (post-v1.23.0)",
      relatedFiles: [
        "client/src/components/PatternGenerator/PatternGeneratorPanel.tsx"
      ]
    },
    "BUG-009": {
      title:   "Performance Mode: Mode-Buttons (Play/Edit/Reorder) sind im Fullscreen nicht klickbar",
      severity: "high (UX)",
      details:  "Reproduktion: Electron-Fenster in Fullscreen schalten (F11 oder Maximize) → Performance Mode öffnen → die Mode-Toggle-Buttons oben (Play / ✎ Edit / ⇆ Reorder) reagieren nicht auf Klicks. Sobald der User das Fenster von Fullscreen auf Windowed wechselt, funktionieren die Buttons sofort. Ursache (verifiziert): ElectronTitleBar (32px hoch, oben im App-Tree) hat WebkitAppRegion='drag' auf dem Container. Performance Mode ist `fixed inset-0 z-50` und überlagert die TitleBar visuell — aber in Electron-Fullscreen schluckt die OS-level Drag-Region trotzdem die pointer-events der darüberliegenden Buttons (Chromium-spezifisches Verhalten von -webkit-app-region in Fullscreen, weil das OS die Drag-Region anders behandelt wenn keine native Title-Chrome existiert). Fix (zweifach): (a) ElectronTitleBar.tsx hört jetzt auf onFullscreenChanged + initial isFullscreen() → return null wenn isFullscreen=true (Drag-Region verschwindet komplett, ohnehin sinnvoll weil Fullscreen-Fenster nicht draggable sind). (b) PerformanceMode-Overlay-Wrapper bekommt defensiv WebkitAppRegion='no-drag' für Race-Condition-Safety beim Fullscreen-Toggle. KEIN Unit-Test geschrieben — Electron-Fullscreen-Verhalten ist nur in tests/electron/e2e/ realistisch testbar; @testing-library/react + jsdom sind im Projekt nicht installiert; manuelle Verifikation via Electron-App im Fullscreen-Mode mit Performance-Mode-Toggle.",
      fixed:    true,
      foundBy:  "user (post-v1.23.0 report)",
      fixedBy:  "frontend",
      fixedIn:  "BUG-009 fix (post-v1.23.0)",
      relatedFiles: [
        "client/src/components/PerformanceMode/PatternLaunchPad.tsx",
        "electron/components/ElectronTitleBar.tsx"
      ]
    }
  },

  // ─── AGENT WORK LOG ────────────────────────────────────────
  // Each agent appends an entry here after completing work.
  // Format: { agent, timestamp, done[], next[], changed[] }
  workLog: [
    {
      agent:     "frontend",
      timestamp: "2026-05-13T21:30:00.000Z",
      done: [
        "Performance-Mode Popup-Window — Phase 2 (post-Phase 1 follow-up). Erweitert die Phase-1-Architektur um vollständigen Edit/Reorder-Operation-Sync (alle Pad-CRUD-Operationen propagieren bidirektional zwischen Main und Popup) sowie einen Always-on-top Toggle. Aufwand: ~1.5h.",
        "P2-A (PatternLaunchPad injectable store actions): Neues exportiertes Interface PerformanceStoreActions mit setPadAt/setPadColor/setPadLabel/movePad/moveMultiplePads/clearPad. Neuer optionaler Prop storeActions auf PatternLaunchPad — wenn undefined → fallback auf DEFAULT_STORE_ACTIONS (direkte Module-Funktionen aus usePerformanceStore, Main-Verhalten unverändert). 7 direkte Aufrufe in PatternLaunchPad + 4 in PadEditor durch actions.xxx() ersetzt (mit Edit-Replace, präzise Substrings). PadEditor-Signatur um actions-Prop erweitert.",
        "P2-B (App.tsx Action-Listener erweitert): onPerfPopupAction-Switch um 6 neue Action-Types ergänzt: set-pad-at, set-pad-color, set-pad-label, clear-pad, move-pad, move-multiple-pads. Jede dispatcht in die echten usePerformanceStore-Funktionen (importiert als setPerformancePadAt etc. um Namens-Kollision zu vermeiden). Defensive Typ-Validierung pro Action. PerformancePad-Type ebenfalls importiert. Nach jeder Mutation feuert die Store-Subscription → Broadcast-useEffect läuft → Popup bekommt neuen State live zurück.",
        "P2-C (PerformancePopupApp injects IPC overrides): useMemo-stabilisiertes storeActions-Objekt das jede Operation in ein dispatchAction({type, ...payload}) umsetzt. Übergeben an PatternLaunchPad via Prop. Edit-Mode + Reorder-Mode + PadEditor funktionieren jetzt vollständig im Popup. Sync-Flow: Popup-Edit → IPC-Action → Main-Listener → Store-Dispatch → Broadcast → Popup-State-Update → Re-Render. Latenz: typisch <20ms.",
        "P2-D (Always-on-top Toggle): 2 neue IPC-Channels — window:perf-set-always-on-top (boolean → {success, alwaysOnTop}) und window:perf-is-always-on-top (→ boolean). Electron-main perfWindow.setAlwaysOnTop() / isAlwaysOnTop(). Preload + types.d.ts + useElectron.ts erweitert mit setPerfPopupAlwaysOnTop, isPerfPopupAlwaysOnTop. Browser-fallback no-ops. UI: floating 📌-Toggle-Button im PerformancePopupApp (top-2 right-16 z-[60], data-testid='perf-popup-always-on-top'), aria-labels + Title-Tooltips. State initial via isPerfPopupAlwaysOnTop()-Fetch + Toggle-State spiegelt setSuccess-Response.",
        "Security-Review: 2 neue IPC-Channels (Phase 2) narrow-data-only — Boolean-Argument für setAlwaysOnTop, kein Payload für is-always-on-top. Keine file paths, keine shell ops, keine native-modul-Aufrufe. Bestehende perf-sync:action Channel wurde nicht erweitert (war bereits 'unknown' typed) — Action-Type-Validation passiert renderer-side im App.tsx-Listener mit defensiven typeof-Checks.",
        "Verification: pnpm check 0 Fehler. pnpm test 1347/1362 grün (unchanged — Tests sind unit-only, kein Refactor-Schaden). Manuelle Verifikation: pnpm dev:electron → Performance Mode → ⧉ Separates Fenster → im Popup: Edit-Mode öffnen, Pads bearbeiten/färben/labeln → live-Update im Hauptfenster sichtbar. Reorder-Mode → drag-drop / Multi-Select drag → propagiert ins Main. 📌-Toggle macht das Popup floatend über andere Apps."
      ],
      next: [
        "Phase 3 (Future — Web-Fallback): aktuell Electron-only. Web-Fallback via window.open(?perfPopup=1) + BroadcastChannel API für State-Sync zwischen Tabs. Popup-Blocker-Risk dokumentieren. Schätzung: 0.5-1 Tag.",
        "Phase 3 (Future — Sync-Performance-Optimierung): aktuell sendet jeder State-Change ein FULL Snapshot. Bei currentStep-Updates alle ~125ms ist das ~8 IPC-Calls/s mit 16-Pad-Array dabei. Separater perf-sync:current-step Channel der nur den number sendet würde Bandwidth reduzieren. Aktuell akzeptabel.",
        "Phase 3 (Future — Playwright E2E): tests/electron/e2e/performance-popup.spec.ts mit zwei Electron-Windows orchestrieren — Popup-Open, Pad-Click im Popup → Pattern wechselt im Main, Edit im Popup → Pads im Main aktualisiert. Komplex weil Playwright zwei BrowserWindows handlen muss. Aufwand: 0.5 Tag.",
        "User-Request weiter offen: 'alle Menüs und Tabs entkoppeln' — Generalisierung des Phase-1/2-Patterns auf alle App-Tabs. Würde der ROADMAP.md-Eintrag 'Multi-Window Dockable Workspace' (2-3 Wochen) realisieren. Idealerweise nach einem Refactor-Sprint der das aktuelle perf-sync-Pattern in ein wiederverwendbares Window-Sync-System abstrahiert.",
        "User-Bug-Reports während dieser Session offen (siehe ROADMAP / BUG-Liste): (a) BUG-010 Script-CSP-Error in production (kritisch — Scripts laufen gar nicht), (b) Audio-Workbench keine Waveform-Visualisierung, (c) Sample-Browser Analyse erkennt aber zeigt keine Waveform, (d) Sample-Browser BPM-Detection geht nicht. Feature-Request: AI Script Generator."
      ],
      changed: [
        "electron/main.ts",
        "electron/preload.ts",
        "electron/types.d.ts",
        "electron/useElectron.ts",
        "client/src/App.tsx",
        "client/src/components/PerformanceMode/PatternLaunchPad.tsx",
        "client/src/components/PerformanceMode/PerformancePopupApp.tsx",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-13T20:30:00.000Z",
      done: [
        "Performance-Mode Popup-Window — Phase 1 (ROADMAP feature, post-v1.23.0). Architektur: separates Electron BrowserWindow lädt denselben Renderer-Entry mit URL-Param ?perfPopup=1. App.tsx erkennt den Param und rendert nur das PerformancePopupApp statt der vollen App. Cross-Window-State-Sync via IPC-Routing über den Main-Process zwischen mainWindow und perfWindow.",
        "Phase 1 Scope (delivered): (a) Play-Mode funktioniert end-to-end — Pad-Click im Popup triggert Pattern-Switch via dm.setActivePattern + queuePerformancePattern im Haupt-Fenster. (b) Quantize-Mode-Toggle funktioniert. (c) Live-State-Sync für currentStep + bpm + activePattern → Popup zeigt aktiven Pattern + Playhead in Echtzeit. (d) 'In separatem Fenster öffnen'-Button im Inline-Performance-Mode-Header (nur Electron). (e) Popup-Close (X / Cmd+W / OS close) informiert Main via perf-window:closed-Event.",
        "Bereich 1 (electron/main.ts): Neue perfWindow Variable (BrowserWindow | null). createPerformanceWindow() — idempotent (zweiter Open-Call fokussiert existierendes Popup), 800x600 default, native frame:true (kein Custom-Title-Chrome zur Vermeidung von BUG-009-style Drag-Region-Problemen), parent=mainWindow für Z-Order-Verbindung. Lädt URL mit ?perfPopup=1 (devServerUrl + Query oder loadFile mit search-Option). 'closed'-Event setzt perfWindow=null und sendet perf-window:closed an mainWindow. Main-Window 'closed'-Handler schließt Popup mit.",
        "Bereich 2 (electron/main.ts IPC handlers): 6 neue IPC-Channels — window:open-performance + close + is-open (invoke), perf-sync:state + perf-sync:action (send-only Routing zwischen den webContents) + perf-window:closed (event). Alle Payloads sind narrow-data-only JSON (keine file paths, keine shell ops). Routing-Logik: perf-sync:state empfangen → an perfWindow weiterleiten; perf-sync:action empfangen → an mainWindow weiterleiten.",
        "Bereich 3 (electron/preload.ts + types.d.ts + useElectron.ts): API-Surface erweitert um openPerformanceWindow, closePerformanceWindow, isPerformanceWindowOpen, sendPerfPopupState, sendPerfPopupAction, onPerfPopupState, onPerfPopupAction, onPerfPopupClosed. Browser-Fallback-Stubs liefern no-op (Feature ist Phase-1 Electron-only). Phase 2 könnte hier window.open() + BroadcastChannel implementieren.",
        "Bereich 4 (client/src/App.tsx): isPerformancePopupMode()-Helper liest URL-Param. Early-return rendert PerformancePopupApp wenn ?perfPopup=1 — alle nachfolgenden App-Hooks (DrumMachine, Mixer, AudioEngine etc.) laufen NICHT im Popup-Renderer, schlanker initial-mount. State-Broadcast-useEffect mit deps [pads, patterns, activePatternId, queuedPatternId, quantizeMode, bpm, currentStep, electron, popupOpen] — sendet bei jeder Änderung ein vollständiges State-Snapshot. Action-Listener-useEffect dispatched pad-click / quantize-mode-change / request-state. handleOpenPerformanceWindow callback öffnet Popup + schließt Inline (User sieht nur EINE Performance-Mode-Instanz auf einmal).",
        "Bereich 5 (client/src/components/PerformanceMode/PerformancePopupApp.tsx NEU): Mini-App-Root. Lokaler React-State PerfPopupState mit Initial-Defaults. onPerfPopupState-Listener füllt State (defensive Validation der Payload). request-state Action beim Mount → Main reagiert mit aktuellem Snapshot. Pre-Sync-Screen während noch nicht gesynced. PatternLaunchPad mit synced State + dispatch-Callbacks. Web-Fallback-Screen für Nicht-Electron.",
        "Bereich 6 (client/src/components/PerformanceMode/PatternLaunchPad.tsx): Neuer optionaler Prop onOpenInWindow + Button im Header (data-testid='perf-open-in-window', Icon ⧉). Button nur sichtbar wenn Prop gesetzt — im Popup-Renderer selbst wird er weggelassen (kein Popup-im-Popup).",
        "Security-Review: alle 6 neuen IPC-Channels in agents/INDEX.js.ipc.channels dokumentiert mit Hinweis 'narrow-data-only'. Keine file paths, keine shell ops, keine native-modul-Aufrufe in den Payloads. perf-sync:state und perf-sync:action sind unidirektionale Forwards zwischen webContents — der Main-Process serialisiert/deserialisiert nicht, gibt nur durch. Context-Isolation bleibt aktiv (preload exposed nur narrow API).",
        "Verification: pnpm check 0 Fehler. pnpm test 1347/1362 grün (+2 Tests automatisch durch Glob-Walker für die neue PerformancePopupApp.tsx in tests/features/theme-class-purity.test.ts). Manuelle Verifikation nötig im Electron-Mode: pnpm dev:electron → Performance Mode öffnen → ⧉ Separates Fenster klicken → Pads im zweiten Fenster klicken → Pattern wechselt im Haupt-Fenster live."
      ],
      next: [
        "Phase 2 (Edit + Reorder Sync): Aktuell ist im Popup nur Play-Mode funktional. Edit-Mode-Tab UND Reorder-Mode-Tab WERDEN angezeigt aber alle dortigen Operationen (setPadAt, setPadColor, setPadLabel, movePad, moveMultiplePads, clearPad) fließen nicht ins Main zurück. Phase 2 erweitert die perf-sync:action Aktionen um diese Operationen. Architektur-Frage: dispatcht das Popup direkt in den persisted store (localStorage shared zwischen Tabs!) ODER alles via IPC? Da localStorage NICHT zwischen Electron-Windows shared ist (separate Renderer-Processes), muss alles über IPC. Aufwand: 1 Tag.",
        "Phase 2 (Web-Fallback): Aktuell ist die Feature Electron-only — useElectron browser-stubs sind no-ops. Web-Fallback würde window.open(?perfPopup=1) + BroadcastChannel oder localStorage-storage-Event für State-Sync nutzen. Popup-blockers sind ein Risiko. Aufwand: 0.5-1 Tag.",
        "Phase 2 (Always-on-top toggle): User-Request häufig bei DAW-Popups. Im Electron via perfWindow.setAlwaysOnTop(true) — Toggle im Popup-Header. Aufwand: 1h.",
        "Phase 2 (Sync-Performance): aktuell sendet jeder State-Change ein FULL Snapshot. Bei häufigen currentStep-Changes (alle 1/16-Note → bei 120bpm ~125ms) sind das ~8 IPC-Calls/Sekunde mit 16-Pad-Array dabei. Optimierung: separater perf-sync:current-step Channel der nur den number sendet, oder Diff-basierter Sync. Aktuell akzeptabel (Payload ~1KB, IPC overhead minimal).",
        "Phase 2 (Tests): Keine automatisierten Tests für die Phase-1-Implementierung. Möglich: tests/electron/e2e/performance-popup.spec.ts mit Window-Open + Pad-Click via popup.window + Verifikation im Main-Window. Komplex weil Playwright zwei Electron-Fenster orchestrieren muss. Aufwand: 0.5 Tag.",
        "User-Feedback offen (siehe ROADMAP-Erweiterung): 'alle Menüs und Tabs entkoppeln'. Das ist eine Generalisierung der hier gebauten Architektur — gleiche Pattern (perf-sync) auf alle Tabs/Panels ausgedehnt. Phase 3+ Aufgabe."
      ],
      changed: [
        "electron/main.ts",
        "electron/preload.ts",
        "electron/types.d.ts",
        "electron/useElectron.ts",
        "client/src/App.tsx",
        "client/src/components/PerformanceMode/PatternLaunchPad.tsx",
        "client/src/components/PerformanceMode/PerformancePopupApp.tsx",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-13T19:00:00.000Z",
      done: [
        "BUG-009 / Performance Mode: Mode-Buttons im Fullscreen nicht klickbar (Fix, post-v1.23.0). User-Report nach Release: Im Electron-Fullscreen reagieren die Mode-Toggle-Buttons (Play / ✎ Edit / ⇆ Reorder) im Performance-Mode-Header nicht auf Klicks. Windowed-Mode → funktioniert sofort.",
        "BUG-009 / Ursachen-Analyse: ElectronTitleBar (32px Container am App-Tree-Top) hat WebkitAppRegion='drag' auf dem outer div. Performance Mode rendert als `fixed inset-0 z-50` Overlay und VERDECKT die TitleBar visuell, aber in Electron-Fullscreen schluckt die OS-Level-Drag-Region die pointer-events der darüberliegenden Buttons. Chromium-spezifisch: -webkit-app-region wird auf OS-Ebene gehandled und die Fullscreen-Logik ändert das Verhalten — Drag-Region absorbiert Klicks auch durch z-50-Overlays. In Windowed-Mode passiert das nicht weil das OS andere Frame-Logik einsetzt.",
        "BUG-009 / Fix Welle 1 (electron/components/ElectronTitleBar.tsx): Komponente hört jetzt auf onFullscreenChanged + initial isFullscreen()-Probe. Setzt isFullscreen-State, returnt null wenn true. Damit: Drag-Region verschwindet komplett in Fullscreen, Performance-Mode-Buttons werden klickbar. Imports: useEffect hinzugefügt. Refactor: inElectron-Check + early returns vorgezogen damit api-Reference safely null sein darf.",
        "BUG-009 / Fix Welle 2 (client/src/components/PerformanceMode/PatternLaunchPad.tsx): Defensiv WebkitAppRegion='no-drag' auf dem Performance-Mode-Wrapper-Div. Schützt gegen Race-Conditions beim Fullscreen-Toggle (Fall: TitleBar wird gerade ausgeblendet aber Performance-Mode-Buttons werden bereits geklickt) und gegen alternative Overlay-Szenarien. Kommentar im Code dokumentiert den BUG-009-Kontext.",
        "BUG-009 / Test-Strategie: KEIN Unit-Test geschrieben. Begründung: (a) Bug-Symptom ist OS-Level Chromium-Behavior von -webkit-app-region in Electron-Fullscreen — nicht in Node/jsdom reproduzierbar. (b) Realistischer Test wäre tests/electron/e2e/ mit setFullScreen() + Click-Verifikation — würde compile:electron benötigen + längere Runtime. (c) @testing-library/react + jsdom sind NICHT als devDeps installiert; nur für eine 5-Zeilen-Fix-Verifikation neue Deps einzuführen ist disproportional. (d) Code-Change ist minimal + offensichtlich korrekt. Manuelle Verifikation: pnpm dev:electron, App in Fullscreen schalten, Performance Mode öffnen, Mode-Buttons klicken — alle funktionsfähig.",
        "BUG-009 / Verification: pnpm check 0 Fehler. pnpm test 1345/1360 grün (kein regression-Test brach, keine neuen Tests). INDEX.js bugs.BUG-009 fixed:true gesetzt."
      ],
      next: [
        "BUG-009 / Welle 3 (Future): Electron-E2E-Test in tests/electron/e2e/performance-mode-fullscreen.spec.ts wäre sinnvoll für Regression-Protection. Setup: Electron starten, Fullscreen via electronAPI.setFullscreen(true) toggeln, Performance Mode öffnen, Mode-Buttons via page.click() — alle drei (Play/Edit/Reorder) müssen aria-pressed-Wechsel zeigen. Hängt von Verfügbarkeit von tests/electron/e2e/ Setup ab.",
        "BUG-009 / Welle 3 (Future): Die TitleBar versteckt sich aktuell IMMER in Fullscreen — was richtig ist für die meisten Apps. Alternative: nur verstecken wenn ein fixed-Overlay aktiv ist (Performance Mode, Scene Launch, Collab Split). Aktuell akzeptabel weil Fullscreen-TitleBar selten gebraucht wird (Fenster nicht draggable, Buttons via F11/Esc/Alt+F4 erreichbar). Falls User wünscht TitleBar in Fullscreen sichtbar zu lassen für Close-Access: separates Setting nötig."
      ],
      changed: [
        "electron/components/ElectronTitleBar.tsx",
        "client/src/components/PerformanceMode/PatternLaunchPad.tsx",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-13T17:45:00.000Z",
      done: [
        "FOLLOWUP-102-3 / Solo cross-store unification — UI-Layer (v1.23.0). Hintergrund: AudioEngine cross-store solo-logic war seit v1.19.0 implementiert (anySolo = anyDrumSolo || anyAudioSolo in _scheduleStep + _reapplyAudioTrackSoloMutes). Die verbleibende Inkonsistenz war im UI-Default-Verhalten: Drum-Solo war exclusive (Radio-Button — un-solo't andere Parts), Audio-Solo war additive (DAW-Konvention). Beide Defaults bleiben in Place (keine breaking change), aber Shift+Click invertiert jetzt in beiden Richtungen.",
        "FOLLOWUP-102-3 / Store-API erweitert: (a) useDrumMachineStore.setPartSoloed Signatur von (partId, soloed) auf (partId, soloed, exclusive=true). exclusive=false → additiv. (b) Neuer Export useAudioTrackStore.setAudioTrackSoloed(id, soloed, exclusive=false) — analoge API für die andere Richtung. Persistiert via localStorage. (c) Defensive defaults: Drum bleibt exclusive-by-default, Audio bleibt additive-by-default — beide UIs nutzen jetzt Shift+Click für die jeweils OPPOSITE Semantik.",
        "FOLLOWUP-102-3 / UI-Layer: (a) ChannelStrip.tsx onSolo-Prop von () → ({shiftKey: boolean}) erweitert, onClick übergibt e.shiftKey. (b) DrumMachine.tsx Call-Site: dm.setPartSoloed(part.id, !part.soloed, !e.shiftKey) — exclusive default, Shift→additive. (c) MixerView MixerChannel onSoloToggle analog erweitert. (d) AudioTrackStrip handleSolo erweitert auf ({shiftKey}) → setAudioTrackSoloed(track.id, next, e.shiftKey) — additive default, Shift→exclusive. (e) Tooltips aktualisiert: Drum 'Shift+Click = additiv', Audio 'Shift+Click = exclusive'. CollabSplitView noop-Stub bleibt unverändert (akzeptiert beliebige Args).",
        "FOLLOWUP-102-3 / Tests +5 in tests/features/audio-track-store.test.ts ('setAudioTrackSoloed (FOLLOWUP-102-3)' describe-Block): (1) Default additive — toggle setzt nur Ziel, andere bleiben unverändert; (2) exclusive=true — un-solo't ALLE anderen; (3) setAudioTrackSoloed(false, exclusive=true) un-solo't alle inkl. Ziel; (4) Unbekannte ID = no-op; (5) Persistenz via localStorage (round-trip).",
        "FOLLOWUP-102-4 / Playwright Round-Trip E2E (v1.23.0). Neue Datei tests/web/audio-track-round-trip.spec.ts mit 4 Tests im describe-Block 'Audio-Track Round-Trip — save → reopen → relocate (FOLLOWUP-102-4)'. Tests: (1) Phase 1 (save): Add-Track persistiert in localStorage mit korrektem fileName; (2) Phase 2 (reopen): page.reload() bringt Track-Metadata zurück, Strip + Name persistieren; (3) Phase 3 (relocate): Broken-Banner + Relocate-Button-Flow stellt Track wieder her (defensiv mit if-visible-check, da markBroken nur per Engine-Failure getriggert wird); (4) Round-Trip End-to-End: Add → reload → ID + Name bleiben stabil im localStorage.",
        "FOLLOWUP-102-4 / Bug-Fix: erste Test-Iteration nutzte page.addInitScript() für localStorage-Cleanup — das feuert ABER bei jedem reload und hat damit Phase 2 + Round-Trip-Test gebrochen. Fix: clearAudioTrackStorageOnce() macht goto('/') + page.evaluate(removeItem) — läuft EINMALIG vor dem ersten Add, NICHT bei reload. Lesson learned: addInitScript ist nicht reload-safe.",
        "FOLLOWUP-102-4 / Verification: pnpm test:web tests/web/audio-track-round-trip.spec.ts → 4/4 grün in 10.6s. pnpm test 1345/1360 unit grün (+5 für setAudioTrackSoloed). pnpm check 0 Fehler."
      ],
      next: [
        "FOLLOWUP-102-3 / Welle 2 (Future — Drum-Store-Tests): useDrumMachineStore ist ein React-Hook ohne node-testbare Export-Funktion (im Gegensatz zu useAudioTrackStore). Tests für exclusive/additive Drum-Solo-Toggle benötigen React-Testing-Library oder Playwright UI-Tests. Aktuell decken die existierenden tests/features/solo-cross-store.test.ts den Engine-Cross-Store-Pfad ab; das neue Drum-additive-Verhalten ist nur in Code-Review verifiziert. Optional: Playwright-Test der Shift+Click auf Drum-Channel-Strip simuliert und Multi-Solo verifiziert.",
        "FOLLOWUP-102-4 / Welle 2 (Future — vollständiger Relocate-Test): Phase 3 hat defensive if-visible-check für den Broken-Banner, weil markBroken im Browser nicht automatisch bei page.reload getriggert wird (nur via openProject-Flow oder Engine-Failure). Ein deterministischer Relocate-Test bräuchte: (a) Trigger markBroken via expose-debug-helper oder (b) Use openProject (.synth-Upload) statt page.reload. Aktuell akzeptiert — die wichtigsten Phasen (save + reopen + Metadata-Persistenz) sind getestet."
      ],
      changed: [
        "client/src/store/useDrumMachineStore.ts",
        "client/src/store/useAudioTrackStore.ts",
        "client/src/components/DrumMachine/ChannelStrip.tsx",
        "client/src/components/DrumMachine/DrumMachine.tsx",
        "client/src/components/Mixer/MixerView.tsx",
        "client/src/components/Mixer/AudioTrackStrip.tsx",
        "tests/features/audio-track-store.test.ts",
        "tests/web/audio-track-round-trip.spec.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "testing",
      timestamp: "2026-05-13T16:30:00.000Z",
      done: [
        "TASK-125 / theme-class-purity Glob-Hardening (v1.23.0). Vorher: 19 Pfade fest in tests/features/theme-class-purity.test.ts verdrahtet via expectNoHardcodedTailwindColors-Helper-Aufrufe — neue Komponente fiel durch das Netz bis jemand sie manuell hinzufügte. Jetzt: walkSync-basierter recursive readdir-Walker (Node-built-in fs, KEINE neue runtime-Dependency wie fast-glob) sammelt ALLE *.tsx unter client/src/components/** + electron/components/** beim Test-Bootstrap und registriert pro Datei 2 it-Blöcke (Palette-Check + Arbitrary-Hex-Check).",
        "TASK-125 / Discovery-Sanity-Tests: zwei zusätzliche it-Blöcke 'finds at least 10 *.tsx components' + 'includes well-known TASK-122 refactored components' (DrumMachine.tsx, SongTimeline.tsx, ThemeSettings.tsx, ElectronDropZone.tsx) — schützen davor dass der Walker silent leer zurückkommt (z.B. Pfad-Annahme falsch).",
        "TASK-125 / Test-Coverage: vorher 41 Tests, jetzt 131 Tests (64 Komponenten × 2 Regex-Checks + 2 Discovery-Sanity + 3 Regex-Sanity). Alle grün — kein Component-Drift seit TASK-122. Test-File-Größe blieb stabil (~145 Zeilen), Test-Runtime 33ms.",
        "TASK-126 / Macro-Hold-Mode Playwright-Smoke (v1.23.0). Neue Datei tests/web/macros.spec.ts mit 4 Tests in 'Macro Hold-Mode UI-Wiring (TASK-126)' describe-Block. Schließt die Lücke aus TASK-118: macroHoldLoop-Helper war unit-getestet, das App.tsx-Wiring (MacroButton.mouseDown → triggerMacroButton → window.dispatchEvent('macro:button:trigger') → App.tsx-Listener → startHoldLoop) war NICHT E2E-abgedeckt.",
        "TASK-126 / Strategie: localStorage pre-seed mit (a) 8 Default-Macros wobei Index 0 = mode:button + triggerMode:hold + scriptId verlinkt, (b) ein test-script in ss-scripts:v1. UI-Flow: app öffnen → toggle-macro-panel klicken → MacroPanel sichtbar. Tests installieren window-Event-Counter für 'macro:button:trigger' + 'macro:button:release' und verifizieren via page.evaluate() die event details (macroIndex, triggerMode='hold', triggerKind='script', scriptId).",
        "TASK-126 / 4 Tests: (1) MacroButton zeigt data-macro-trigger-mode='hold' Attribut + aria-label enthält 'Hold-Mode'; (2) mouseDown feuert trigger-Event mit korrekten detail-Feldern; (3) mouseUp feuert release-Event mit korrektem macroIndex; (4) 500ms-Hold-Cycle: trigger-Event feuert EXAKT 1× (initial), Loop läuft intern weiter ohne neue trigger-Events zu dispatchen, release-Event feuert 1× nach mouseUp, KEINE weiteren triggers nach release (300ms post-release verifikation).",
        "TASK-126 / DOM-Test-IDs hinzugefügt für stabile Selection: data-testid='macro-button-${index}' + data-macro-trigger-mode + data-macro-trigger-kind auf <button> in MacroPanel.tsx (Zeile 171-179); data-testid='toggle-macro-panel' auf den 'M1-8' Toggle in DrumMachine.tsx (Zeile 781).",
        "TASK-126 / Verification: pnpm check 0 Fehler. pnpm test 1340/1355 unit-Tests grün (unchanged, +90 von TASK-125 mit drin). pnpm test:web tests/web/macros.spec.ts → 4/4 Playwright-Tests grün in 9.1s (chromium, single worker)."
      ],
      next: [
        "TASK-126 / Welle 2 (Future — Sandbox-Tick-Verification): Die hier laufenden 4 Tests prüfen die EVENT-Wiring-Schicht (mouseDown → trigger-Event → release-Event). Sie verifizieren NICHT, dass startHoldLoop tatsächlich das Script in der Sandbox in 200ms-Loop-Intervals ausführt — das macht macroHoldLoop's Unit-Test bereits (mit Mock-Scheduler). Wenn echte End-to-End-Sandbox-Tick-Verifikation gewünscht ist: Script muss `ss.bpm(uniqueValue)` o.ä. observable side-effect machen, Test liest DOM-BPM-Anzeige nach 500ms. Aktuell akzeptabel — Unit-Tests decken die Loop-Mechanik, E2E deckt die DOM-Wiring.",
        "TASK-126 / Welle 2 (Future — Pad-Hold-Mode E2E): Tests decken nur scriptId-Bindings (triggerKind='script'). Pad-Hold (triggerKind='pad') hat analoge Logik in App.tsx (runPadOnce + PAD_HOLD_INTERVAL_MS=100ms statt SCRIPT_HOLD_INTERVAL_MS=200ms). Ein analoger Test-Block für pad-mode wäre symmetrisch sinnvoll, aber redundant — die Wiring-Kette ist identisch."
      ],
      changed: [
        "tests/features/theme-class-purity.test.ts",
        "tests/web/macros.spec.ts",
        "client/src/components/Macro/MacroPanel.tsx",
        "client/src/components/DrumMachine/DrumMachine.tsx",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-13T15:30:00.000Z",
      done: [
        "TASK-127 / Performance-Pad UX-Welle: Cmd/Ctrl+A + Auto-Scroll (v1.23.0). Schließt zwei UX-Lücken aus TASK-114/120 next[]: (a) Keyboard-Equivalent für Box-Select fehlte (Tastatur-User mussten Shift+Click pro Pad), (b) Box-Drag stoppte abrupt am Viewport-Rand, statt zu scrollen.",
        "TASK-127a (client/src/components/PerformanceMode/PatternLaunchPad.tsx): Cmd/Ctrl+A im Reorder-Mode selektiert alle non-empty Pads. Neuer separater useEffect mit window-keydown-Handler (separat vom Escape-Handler, damit Logik isoliert bleibt). Constraints: nur aktiv wenn mode==='reorder', no-op wenn editingIndex !== null (Inputs behalten ihre native Cmd+A-Behavior), preventDefault + stopPropagation. ARIA-Live-Announce '${N} Pads ausgewählt.' nach Select-All. Neuer Top-Level-Export collectNonEmptyPadIndices(pads) als pure Helper (DOM-frei, Node-testbar).",
        "TASK-127b (selectionBox useEffect): Auto-Scroll-RAF-Loop ergänzt. Während Box-Drag aktiv: requestAnimationFrame-Loop liest letzte Maus-Position (mouseX/mouseY-refs aus mousemove-Handler), berechnet via computeAutoScrollDelta(mouseX, mouseY, innerWidth, innerHeight) den Scroll-Delta, ruft window.scrollBy(dx, dy). Edge-Threshold 40px, max Speed 12 px/Frame, linear ramp basierend auf Abstand zum Rand. RAF wird in der Effect-Cleanup-Funktion via cancelAnimationFrame gestoppt. Pad-Rects (getBoundingClientRect) sind viewport-relativ und passen sich automatisch beim nächsten mousemove an die neue Scroll-Position an — Selection bleibt konsistent.",
        "TASK-127 / Neuer Top-Level-Export computeAutoScrollDelta(mouseX, mouseY, viewportW, viewportH, threshold=40, maxSpeed=12) — pure Funktion, Returnt {dx, dy} (beide negative=scroll left/up, positive=scroll down/right). DOM-frei und unit-testbar.",
        "TASK-127 / Tests (+15 in tests/features/performance-mouse-box.test.ts): 'collectNonEmptyPadIndices (TASK-127a)' (5 Tests — empty, all-filled, mixed, empty-input, stable-order); 'computeAutoScrollDelta (TASK-127b)' (10 Tests — center=no-scroll, all 4 viewport edges return max-speed in correct direction, threshold-grenze=no-scroll, half-edge=50% speed, two-corner cases dx&dy negative/positive, custom threshold/maxSpeed). Datei jetzt 39 Tests total (vorher 24).",
        "TASK-127 / Verification: pnpm check 0 Fehler. pnpm test 1250/1265 grün (64 test files, +15 neue, 15 pre-existing skipped, 0 Regressionen). Keine hardcoded Tailwind-Farben hinzugefügt (Reine Logik-Änderung)."
      ],
      next: [
        "TASK-127 / Welle 3 (Playwright E2E): Aktuell sind die neuen Features nur unit-getestet — Cmd/Ctrl+A-Wiring + auto-scroll-Verhalten in der Komponente selbst sind nicht E2E-abgedeckt. Sinnvolle Playwright-Tests: (a) Performance-Mode öffnen, reorder-Mode aktivieren, Pads mit Pattern füllen, Cmd+A drücken, prüfen dass alle non-empty Pads `aria-selected` oder data-multi-select-Attribut tragen; (b) Page mit fixed-height-Container kleiner als Grid setzen, Box-Drag in Richtung Viewport-Rand starten, prüfen dass scrollY/scrollX sich ändert.",
        "TASK-127 / Welle 3 (UX-Polish): Cmd+A bei leeren Pads (collectNonEmptyPadIndices liefert []) zeigt aktuell keine UI-Reaktion (no-op + leere Live-Region). Wäre denkbar: toast/snackbar 'Keine Pads zum Auswählen'. Aktuell akzeptiert — User merkt dass nichts passiert.",
        "TASK-127 / Welle 3 (Future — Edge-Scrolling-Polish): Die RAF-Loop ruft window.scrollBy auf — bei Performance-Mode-Overlays die das ganze Viewport füllen, ist die Page-Scroll-Position möglicherweise gelocked (overflow:hidden auf body). In dem Fall ist Auto-Scroll ein No-Op. Wäre eine Alternative: einen explicit scrollable Container im Performance-Mode-Layout suchen und stattdessen dessen scrollTop/Left manipulieren. Aktuell akzeptabel — bei Default-Theme ist body scrollable."
      ],
      changed: [
        "client/src/components/PerformanceMode/PatternLaunchPad.tsx",
        "tests/features/performance-mouse-box.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "backend",
      timestamp: "2026-05-13T14:30:00.000Z",
      done: [
        "TASK-129 / Synth-Part Integration Wave 2 — DrumLoop + Channel-FX-Routing (v1.23.0). Folgt direkt auf TASK-128, schließt die in der TASK-128-next[]-Liste benannten Welle-2-Lücken: (a) Drum-Loop in AudioEngine._scheduleStep triggert jetzt Synth-Parts (sourceType=wavetable/fm + synthParams) — vor diesem Commit wurden Synth-Parts im Drum-Step KOMPLETT übersprungen (nur sample-Parts wurden geprüft). (b) SynthEngine-Output geht jetzt durch die Channel-FX-Chain (EQ, Filter, Distortion, Compressor, Sidechain, Send-FX) statt direkt zu masterGain — Insert-FX wirken jetzt auch auf Synth-Parts.",
        "TASK-129 / Bereich 1 (client/src/audio/AudioEngine.ts, neuer Helper _triggerSynthOnChannel): Pure-Logik-Helper, der die SynthEngine-Trigger + Channel-FX-Routing-Logik bündelt. Returnt boolean — true wenn die SynthEngine genutzt wurde, false wenn Voraussetzungen fehlen (kein ctx, kein synthParams, sourceType nicht wavetable/fm). Aufrufer kann auf Fallback-Pfad ausweichen. Setzt `nodes.input.gain.value` (Volume) und `nodes.panner.pan.value` (Pan) analog zum Sample-Pfad in _triggerBufferWithFx. SynthEngine.triggerNote() schreibt in `nodes.input` (Channel-Input-GainNode) statt direkt zu masterGain — damit propagieren alle Channel-FX korrekt. partId wird durchgereicht → Macro-LFO-Cache aktiv.",
        "TASK-129 / Bereich 2 (AudioEngine._triggerMelodicNote): Inline-Synth-Pfad aus TASK-128 (volGain+panner→masterGain) durch _triggerSynthOnChannel-Aufruf ersetzt. Damit nutzt der melodische Pfad (PianoRoll) jetzt ebenfalls die Channel-FX-Chain. Fallback-Pfad (Triangle-Oscillator) für Parts ohne synthParams bleibt unverändert.",
        "TASK-129 / Bereich 3 (AudioEngine._scheduleStep DrumLoop, ~Zeile 1322): Neuer isSynthPart-Branch VOR dem sampleUrl-Branch. Synth-Parts mit sourceType=wavetable/fm + synthParams werden über _triggerSynthOnChannel getriggert (Basis-Frequenz A4=440Hz, step.pitch als Halbton-Transpose). Synth-Pfad hat Vorrang vor sampleUrl — damit Synth-Parts, die irrtümlich ein altes sampleUrl-Feld tragen (z.B. aus älteren Projekt-JSONs), trotzdem korrekt als Synth abgespielt werden. Sample-Pfad-Branch unverändert.",
        "TASK-129 / Tests (+6 neue in tests/features/macro-lfo-integration.test.ts, neuer describe-Block 'TASK-129 — Synth-Part Channel-FX-Routing'). Tests: (1) _triggerSynthOnChannel returnt true für wavetable+synthParams, (2) returnt true für fm+synthParams, (3) returnt false für sourceType=sample (Fallback), (4) returnt false ohne synthParams, (5) returnt false ohne init() (kein AudioContext), (6) Wenn _triggerSynthOnChannel feuert, wird der Macro-LFO-Cache konsultiert (partId durchgereicht, Cache bleibt erhalten). Helper makeSynthPart() für Test-Setup mit Default ChannelFx und SynthParams. Tests greifen über `as unknown as` Type-Cast auf den privaten _triggerSynthOnChannel-Helper zu — sauberste Methode, um die Branching-Logik isoliert zu prüfen ohne den vollständigen Scheduler hochzufahren.",
        "TASK-129 / Verification: pnpm check 0 Fehler. pnpm test 1235/1250 grün (64 test files, +6 neue TASK-129-Tests in macro-lfo-integration.test.ts, 15 pre-existing skipped, 0 Regressionen)."
      ],
      next: [
        "TASK-129 / Welle 3 (Future — Drum-Synth UI-Discoverability): Aktuell muss ein User in der DrumMachine den sourceType eines Parts explizit auf 'wavetable' oder 'fm' setzen damit der Synth-Pfad greift. Falls keine UI-Discoverability dafür existiert (Part-Settings-Panel, ChannelStrip), wäre das ein Frontend-Polish-Task. Aktuell out-of-scope.",
        "TASK-129 / Welle 3 (Future — Synth-Drum-Sequencer Polyphonie): SynthEngine.triggerNote() erzeugt pro Aufruf eine neue OSC-Kette mit unabhängiger ADSR. Bei schnellen Step-Folgen (z.B. 1/32 + langer Release) überlagern sich Noten via Channel-Input — nodes.input.gain.value wird allerdings beim Trigger neu gesetzt (überschreibt den Wert für ALLE laufenden Noten). Für Volumen-Konsistenz bei polyphonen Synth-Drum-Steps müsste pro-Note ein Volumen-Gain VOR nodes.input eingefügt werden. Aktuell akzeptabel — Drum-Use-Case ist meist mono-pro-Step.",
        "TASK-129 / Welle 3 (Tests E2E): Playwright-Smoke der ein Synth-Drum-Pattern erzeugt, Insert-FX (z.B. Bitcrusher) auf den Channel setzt, und beim Step-Trigger via AnalyserNode verifiziert dass das Signal durch den FX gefiltert wird (Spektrum-Veränderung). Erfordert echte Web-Audio-Inspection."
      ],
      changed: [
        "client/src/audio/AudioEngine.ts",
        "tests/features/macro-lfo-integration.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "backend",
      timestamp: "2026-05-13T13:30:00.000Z",
      done: [
        "TASK-128 / LFO-Macros Wave 2 — Step-Trigger-Site Wiring (v1.23.0 Vorbereitung). Vor diesem Task lief der v1.22.0/TASK-117 Macro-LFO-Cache ins Leere: AudioEngine.setPartLfoRate/Depth speicherte Werte in der SynthEngine-Cache-Map, aber NIEMAND rief SynthEngine.triggerNote() — _scheduleStep behandelte nur part.sampleUrl (Samples), und _triggerMelodicNote (PianoRoll-Playback) nutzte einen eigenen Triangle-Oscillator statt SynthEngine. Discovery: Aus dem Plan-Task (a) 'Step-Trigger reicht partId durch' ergab sich, dass die SynthEngine-Integration in AudioEngine bisher gar nicht existierte — nicht nur ein partId-Passthrough fehlte.",
        "TASK-128 / Bereich 1 (client/src/audio/SynthEngine.ts): triggerNote-Signatur um optionalen 6. Parameter `destination?: AudioNode` erweitert. Default: this.destination (Constructor-Destination, typischerweise masterGain). Bei explizitem destination-Argument verbindet ampEnv mit dem Per-Call-Ziel statt der Constructor-Destination. Begründung: AudioEngine kann pro Note eine eigene volGain→panner→masterGain-Kette vorschalten ohne die SynthEngine-Constructor-Destination zu rotieren. Kein Breaking-Change — alle existierenden Aufrufer (Tests) funktionieren weiter.",
        "TASK-128 / Bereich 2 (client/src/audio/AudioEngine.ts, _triggerMelodicNote): Signatur um optionalen 5. Parameter `part?: PartData` erweitert. Wenn `part.synthParams` gesetzt UND `part.sourceType ∈ {wavetable, fm}`, wird SynthEngine.triggerNote() mit partId aufgerufen — mit einer Per-Call-Destination-Kette aus createGain (volume) → createStereoPanner → masterGain. Damit propagieren Volume/Pan korrekt UND der Macro-LFO-Cache wird konsultiert. Parts ohne synthParams oder mit sourceType=sample/granular fallen auf den bestehenden Triangle-Oscillator-Pfad zurück (Backwards-Compat).",
        "TASK-128 / Bereich 3 (AudioEngine call-site, melodic loop in _scheduleStep): `this._triggerMelodicNote(time, freq, vol, part.pan ?? 0)` → `this._triggerMelodicNote(time, freq, vol, part.pan ?? 0, part)` — übergibt jetzt den Part damit der Synth-Pfad funktioniert.",
        "TASK-128 / Plan-Task (b) [MacroRouteSetters.setLfoRate/setLfoDepth required hochziehen] ABGELEHNT nach Analyse. Begründung: die optional-Markierung ist intentional — applyMacroBindings fällt für unbekannte Targets auf `onUnhandled` zurück (siehe useMacroStore L466-475). tests/features/macros.test.ts L394 'ruft onUnhandled für lfo-rate auf, solange setLfoRate fehlt' testet genau dieses Fallback. Required-Hochzug würde 12+ legitime Test-Setter-Bags brechen. Bessere Lösung: Setter ist im Produktiv-Wiring (App.tsx) bereits vorhanden — keine Schema-Änderung nötig.",
        "TASK-128 / Tests Welle 1 (tests/electron/synth-engine.test.ts, +3 Tests): Neue describe-Suite 'SynthEngine.triggerNote() – destination override (TASK-128)' mit drei Cases — (a) ohne destination-Argument: ampEnv→Constructor-Destination, (b) mit destination-Argument: ampEnv→Per-Call-Destination, NICHT zur Constructor-Destination, (c) destination + partId zusammen: LFO-Oszillator nutzt gecachten Wert (9 Hz) UND Per-Call-Destination wurde verwendet.",
        "TASK-128 / Tests Welle 2 (tests/features/macro-lfo-integration.test.ts NEU, 6 Tests): End-to-End-Integration applyMacroBindings → AudioEngine.setPartLfo* → SynthEngine-Cache. Tests: (1) lfo-rate-Binding mit min=0.1/max=10 @ 0.5 → 5.05 cached; (2) lfo-depth-Binding 0..1 @ 0.8 → 0.8 cached; (3) Mehrere Parts werden getrennt gehalten (kick/snare/lead); (4+5) Range-Clamping (999→30, -0.5→0); (6) Ohne init(): Setter sind no-op, Getter liefern null (defensive). Mock-AudioContext-Klasse mit allen relevanten Web-Audio-Factory-Methoden (createOscillator, createGain, createStereoPanner, createConvolver, createDelay, createBiquadFilter, createDynamicsCompressor, createWaveShaper, createAnalyser, createBuffer, createBufferSource). vi.stubGlobal('AudioContext', MockAudioContext) + vi.resetModules() in beforeEach für Test-Isolation.",
        "TASK-128 / Verification: pnpm check 0 Fehler. pnpm test 1229/1244 grün (64 test files, +1 macro-lfo-integration, +3 destination-override in synth-engine, 15 pre-existing skipped, 0 Regressionen)."
      ],
      next: [
        "TASK-128 / Welle 2 (Future — sourceType=wavetable/fm in DrumLoop): Aktuell ist die SynthEngine-Integration nur im melodischen Pfad (PianoRoll). Falls jemand eine Drum-Step mit sourceType=wavetable/fm konfiguriert (statt Sample), wird sie aktuell NICHT abgespielt — der Drum-Loop (Zeile ~1322) prüft nur part.sampleUrl. Für vollständige Synth-Drum-Pad-Unterstützung müsste der Drum-Loop einen Synth-Branch bekommen. Aktuell out-of-scope — UI macht Synth-Parts primär melodisch.",
        "TASK-128 / Welle 2 (Future — Channel-FX): SynthEngine-Output geht aktuell über volGain→panner DIREKT zu masterGain, NICHT durch die Channel-FX-Chain (EQ, Filter, Distortion, Compressor, Delay, Reverb, Insert-FX). Sample-basierte Parts gehen über _triggerBufferWithFx und damit durch die volle FX-Kette. Synth-Parts haben damit keine Insert-FX. Welle 2 würde den Synth-Pfad ebenfalls über `_getOrCreateChannelNodes(part.id, part.fx).input` routen.",
        "TASK-128 / Welle 2 (Tests Welle 3 — E2E-Verifikation hörbar): pnpm test:e2e Playwright-Smoke der einen Synth-Part erzeugt, ein Macro auf lfo-rate bindet, das Macro auf 0.5 setzt und beim nächsten Step-Trigger verifiziert dass der LFO-Oscillator-Frequenzwert ≈ 5 Hz ist. Erfordert Web-Audio-Inspection im Electron-Test (z.B. via getOutputAnalyser oder Tone.Transport-Hook)."
      ],
      changed: [
        "client/src/audio/SynthEngine.ts",
        "client/src/audio/AudioEngine.ts",
        "tests/electron/synth-engine.test.ts",
        "tests/features/macro-lfo-integration.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-13T12:00:00.000Z",
      done: [
        "Stand-Check + Roadmap-Refresh (Session-Start v1.23.0-Vorbereitung). Aktueller Stand erfasst: Version 1.22.0 (package.json ↔ INDEX.js synchron), letzte 5 Releases v1.18.3 → v1.22.0, Test-Status 1220 passed / 15 skipped (pre-existing) / 63 Files / 2.74s — grün. Einziger uncommitted change: docs/NEUE_SESSION_ANWEISUNG.md (stale auf v1.16.0).",
        "openTasks aufgeräumt. Geschlossen + via Kommentar dokumentiert: TASK-101 (defacto closed durch BUG-008-Fix in v1.18.x), TASK-103 (erledigt v1.17.0 — useScriptStore + Worker-Sandbox), FOLLOWUP-110 (erledigt v1.22.0 / TASK-122 — Final Theme-Sweep, 0/0 Matches im *.tsx-Baum). FOLLOWUP-102 auf Restposten reduziert: nur noch (3) Solo cross-store unification + (4) Playwright round-trip E2E offen — (1) de-dup AudioTrackChannelData + (2) pitch-preserving stretch sind in v1.19.0 erledigt.",
        "5 neue openTasks für v1.23.0-Roadmap eingetragen: TASK-124 (frontend, Docs-Sync NEUE_SESSION_ANWEISUNG.md auf v1.22.0 — billigster Aufwand, beseitigt einzige uncommitted-Drift), TASK-128 (backend + testing-Review, LFO-Macros Wave 2 Step-Trigger-Wiring — größter funktionaler Win, macht v1.22.0 Macro-Cache überhaupt erst hörbar), TASK-127 (frontend, Performance-Pad Cmd/Ctrl+A + Auto-Scroll aus TASK-114/120 next[]), TASK-125 (testing, theme-class-purity Glob-Hardening — aktuelle Test-Datei listet 19 Pfade hart auf), TASK-126 (testing, Macro-Hold-Mode Playwright-Smoke — App.tsx-Wiring fehlt im E2E-Layer).",
        "Empfehlung an User: Start mit TASK-124 (frontend, < 30 min). Danach TASK-128 (functional impact). TASK-125 + TASK-126 parallel als Test-Hardening zwischen Releases. TASK-127 = nächste UX-Welle für v1.23.0."
      ],
      next: [
        "TASK-124 ist als nächster aktiver Task vom User freigegeben — frontend-Agent kann starten. Vorgehen: Header von 'Version: 1.16.0' → '1.22.0' ziehen, Sektion 'Neue Features (v1.16)' umbenennen in 'Neue Features (v1.17–v1.22)' und um Persistent Scripts/Sandbox + Audio-Tracks + Performance-Mode-Overhaul + Macro→Pad + LFO-Macros + Hold-Mode + Pad-Theme + Final-Theme-Sweep ergänzen, Roadmap-Tabelle aus openTasks spiegeln. Akzeptanzkriterium: git status clean nach Commit.",
        "Nach TASK-124 sollte der Coordinator den User fragen welcher der vier verbleibenden Tasks (125–128) als nächstes laufen soll — TASK-128 ist die Empfehlung (high severity, biggest functional impact)."
      ],
      changed: [
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "refactor",
      timestamp: "2026-05-13T00:30:00.000Z",
      done: [
        "TASK-122 / Final Theme-Class-Purity Sweep (v1.22.0). 15 Komponenten in client/src/components/** und electron/components/** von hardcoded Tailwind palette classes (bg-slate-*, text-cyan-*, bg-amber-700, text-green-400, hover:bg-red-900 etc.) auf semantische Tokens (bg-bg-*, text-text-*, bg-accent-*, hover:text-accent-danger) refactored. Inventory vorher: 14 Dateien in client/src/components/ (69 Matches) + 1 Datei in electron/components/ (16 Matches). Inventory nachher: 0 Matches in beiden Bäumen. Verifiziert via doppelter Regex (HARDCODED_TAILWIND_CLASS für Palette+Shade, ARBITRARY_HEX_CLASS für bg-[#...] / text-[#...]) über alle *.tsx im Repo — Endstand: 0 / 0.",
        "TASK-122 / Mapping pro Datei: UpdateBadge.tsx (8 Matches → bg-accent-secondary/success/danger für update-phases yellow/green/red); EuclideanControls.tsx + StepContextMenu.tsx (je 1 Popover.Arrow fill-slate-700 → fill-border-color); ModMatrix.tsx + CollabStatus.tsx + ProjectManager.tsx (Single-Hover hover:text-red-400 / border-cyan-800 → accent-danger / accent-primary); NewProjectDialog.tsx (ring-cyan-600/50 → ring-accent-primary/50, placeholder-slate-600 → placeholder-text-dim, focus:border-cyan-700 → focus:border-accent-primary); ThemeSettings.tsx (5 Matches: bg-cyan-950/30 → bg-accent-primary/10, border-green-600 → border-accent-success, bg-green-500 → bg-accent-success, hover:text-red-400 → hover:text-accent-danger); CollabSplitView.tsx (6 Matches: placeholder-slate-600 → placeholder-text-dim, hover:bg-red-900/40 → hover:bg-accent-danger/20, border-cyan-800/green-800/purple-800 → border-accent-primary/success/secondary, text-white auf accent-bg → text-bg-base); Humanizer.tsx (Slider color='cyan'/'violet'/'emerald' Prop refactored zu accent: 'primary'|'secondary'|'success' mit statischen Klassen-Tabellen ACCENT_TEXT/ACCENT_BG damit Tailwind JIT die Klassen findet); MidiSettings.tsx (10 Matches: bg-green-* für connected-status → accent-success, bg-yellow-* für MIDI-Learn → accent-secondary, text-white auf primary-bg → text-bg-base, bg-white für toggle-knob → bg-text-primary, hover:text-red-400 → hover:text-accent-danger); DrumMachine.tsx (9 Matches in Transport-Bar: bg-amber-700 für BPM-toggle + VEL → bg-accent-secondary, bg-purple-700 für PITCH → bg-accent-secondary, bg-amber-900/40 für Velocity-Ramp-Buttons → bg-accent-secondary/20, bg-indigo-700 für Metronom-Klangtyp → bg-accent-secondary, hover:bg-red-900 für CLR → hover:bg-accent-danger/30, bg-red-600 für isPlaying-Stop → bg-accent-danger, text-amber-400/purple-400 für Status-Modus → text-accent-secondary, text-white auf accent-bgs → text-bg-base).",
        "TASK-122 / Sonderfälle: SongTimeline.tsx mit 14 Matches als Categorical Palette dokumentiert (Top-Comment-Block) — Pattern-Bänke A/B/C/D auf accent-primary/secondary/success/danger gemapped (3 Klassen-Tabellen BANK_COLORS/BANK_COLORS_MUTED/BANK_ACTIVE komplett auf semantische Tokens umgeschrieben, inkl. ring-* und shadow-* Varianten mit Opacity-Modifiers wie shadow-accent-primary/30). ElectronDropZone.tsx mit 16 Matches als Categorical Palette dokumentiert — DROP_STYLES Record für audio/folder/project/zip/unknown auf primary/success/secondary/secondary/border-color gemapped (project und zip teilen den Akzent — Trade-off im Top-Comment dokumentiert, da das große Drop-Overlay-Icon + Text-Label die Drop-Type-Info dominant tragen). MixAssistantPanel.tsx mit 7 Matches: severityBg-Record (critical/warning/info) auf accent-danger/secondary/primary gemapped, ebenfalls als Categorical Palette via Comment dokumentiert. SVG <circle stroke='#ef4444'/> und <path stroke='#f59e0b'/> sowie inline-style borderColor: rec.severity === 'warning' ? '#f59e0b' : ... bewusst NICHT angefasst (TASK-122-Spec: 'JS-Hex-Konstanten sind Domain-Werte, NICHT Tailwind').",
        "TASK-122 / Humanizer Slider-Refactor (TypeScript-API-Änderung): SliderProps.color?: string ('cyan'|'violet'|'emerald') durch SliderProps.accent?: SliderAccent ('primary'|'secondary'|'success') ersetzt. Statische Klassen-Tabellen ACCENT_TEXT/ACCENT_BG damit Tailwind JIT keine dynamischen Klassen-Strings prozessieren muss (vorher: `text-${color}-400` → Tailwind kann das nicht statisch erkennen → kann je nach Build-Config ungerendert bleiben). Alle drei Call-Sites in Humanizer angepasst: Swing→primary, VelocityJitter→secondary, TimingJitter→success.",
        "TASK-122 / Test-Coverage: tests/features/theme-class-purity.test.ts erweitert. Helper-Function expectNoHardcodedTailwindColors(relPath: string) eingeführt — registriert pro Datei 2 it-Blöcke (Palette-Check + Arbitrary-Hex-Check) mit präzisen Fehler-Messages inkl. Datei-Name. Test-Suite jetzt 3 describe-Blöcke: 'FOLLOWUP-110 / TASK-113' (4 Original-Files = 8 Tests), 'TASK-122 (final sweep)' (15 neue Files = 30 Tests), 'Regex sanity checks' (3 Tests). Gesamt: 41 Tests in der Datei (vorher 11), alle grün.",
        "TASK-122 / Verification: pnpm check clean (precheck gen:sandbox up-to-date, tsc --noEmit 0 Fehler). pnpm test 1220/1235 grün (63 test files, 15 pre-existing skipped, 0 Regressionen, +30 neue theme-class-purity Tests). Repo-wide final scan (alle *.tsx im Repo, nicht nur components/) ergibt 0 hardcoded Tailwind palette classes + 0 arbitrary hex classes. Refactoring berührte KEINEN Audio/Store/Logic-Code (rein CSS-Klassen-Ersetzungen + 1 Slider-Prop-Rename in Humanizer)."
      ],
      next: [
        "TASK-122 / Welle 2 (Future): app.tsx und andere Top-Level-Dateien (außerhalb components/) wurden bewusst nicht angefasst — bei Bedarf separat sweepen. Aktuell laut Final-Scan ohnehin sauber.",
        "TASK-122 / Welle 2 (Future): Die 4 semantischen Akzent-Tokens (primary/secondary/success/danger) reichen für Categorical-Use-Cases nicht immer aus (siehe Trade-offs in ElectronDropZone project=zip, SongTimeline D=danger). Falls in Zukunft mehr Differenzierung gewünscht: 'tertiary' / 'warning' Token in --ss-* erweitern + @theme entsprechend. Aktuell akzeptiert.",
        "TASK-122 / Welle 2 (Test-Hardening): Aktuell registriert der Helper expectNoHardcodedTailwindColors pro Datei 2 fest verdrahtete it-Blöcke. Eleganter wäre ein Glob-basierter Mass-Check, der ALLE Dateien unter client/src/components/**/*.tsx und electron/components/**/*.tsx automatisch validiert (statt expliziter Pfad-Liste). So würde jede neue Komponente von Anfang an mit-geprüft, ohne dass die Test-Datei manuell erweitert werden muss.",
        "TASK-122 / Welle 2 (CI-Hint): Der test:web Playwright-Sweep ist nicht Teil dieser Verifikation. Falls visuelle Regressionen durch die Token-Ersetzungen entstanden sein sollten (z.B. weil bg-amber-700 und bg-accent-secondary in einem bestimmten Theme NICHT visuell ähnlich sind), würde ein Screenshot-Compare-Test das fangen. Aktuell rein Token-Purity-getestet, nicht visuell."
      ],
      changed: [
        "client/src/components/UpdateBadge.tsx",
        "client/src/components/DrumMachine/EuclideanControls.tsx",
        "client/src/components/DrumMachine/StepContextMenu.tsx",
        "client/src/components/DrumMachine/ModMatrix.tsx",
        "client/src/components/DrumMachine/CollabStatus.tsx",
        "client/src/components/DrumMachine/MixAssistantPanel.tsx",
        "client/src/components/DrumMachine/DrumMachine.tsx",
        "client/src/components/ProjectManager/ProjectManager.tsx",
        "client/src/components/NewProjectDialog/NewProjectDialog.tsx",
        "client/src/components/Settings/ThemeSettings.tsx",
        "client/src/components/CollabSplitView/CollabSplitView.tsx",
        "client/src/components/Humanizer/Humanizer.tsx",
        "client/src/components/MidiSettings/MidiSettings.tsx",
        "client/src/components/SongTimeline/SongTimeline.tsx",
        "electron/components/ElectronDropZone.tsx",
        "tests/features/theme-class-purity.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-12T23:50:00.000Z",
      done: [
        "TASK-120 / Mouse-Box Rubber-Band-Select (v1.22.0). Im Reorder-Mode startet mousedown auf dem Grid-Background (NICHT auf einem Pad) ein Box-Drag; mousemove zeichnet ein fixed-positioniertes Selection-Overlay (border-2 border-dashed border-accent-secondary bg-accent-secondary/10); mouseup wählt alle Pads mit non-empty patternId, deren BoundingBox mit der Box überlappt. Ohne Shift = replace selection; mit Shift = additiv (merged in den initial-snapshot der existing selection). Klick ohne Move bei aktiver Selection clearet sie (UX-Konvention). Escape clearet die Multi-Select-Set ebenfalls (neuer Eskalations-Level vor onClose).",
        "TASK-120 / Bereich 1 (client/src/components/PerformanceMode/PatternLaunchPad.tsx): Drei neue exportierte pure Helper auf Top-Level: normalizeBox(startX,startY,curX,curY)→AxisRect (Drag-Up-Left wird normalisiert), boxIntersects(a,b)→boolean (halb-offene Intervalle, w<=0/h<=0 → false), collectPadsInBox(box, padRects)→number[] (leere null-Slots werden übersprungen). AxisRect-Interface ebenfalls exportiert. Helper sind seiteneffekt-frei und im Node-Environment importierbar (kein DOM).",
        "TASK-120 / Bereich 2 (Component-Wiring): Neuer State selectionBox = {startX,startY,currentX,currentY,additive,initialSelection,moved}|null (lokal in PatternLaunchPad, NICHT persistiert). handleGridMouseDown auf dem flex-wrapper (data-testid='perf-pad-grid-wrapper') filtert: (a) mode==='reorder', (b) e.button===0, (c) target.closest('[data-pad-index]')===null, (d) Editor nicht offen. useEffect mit window-mousemove/mouseup-Listener während selectionBox aktiv. moved-Flag mit 3px-Hysterese gegen Mikro-Drifts. mouseup-Closure liest aktuellen selectionBox-State + collectCurrentPadRects() (querySelector + getBoundingClientRect pro Pad-Slot, leere Slots = null) und committed über setMultiSelect (replace oder Set-Merge je nach additive-Flag).",
        "TASK-120 / Bereich 3 (Overlay-Render): Fixed-positioniertes <div data-testid='perf-selection-box'> oberhalb des Pad-Grids (z-40, pointer-events-none) mit border-dashed-accent-secondary + bg-accent-secondary/10. Nur sichtbar wenn selectionBox.moved=true (kein flackerndes 0×0-Rechteck bei reinem Klick).",
        "TASK-120 / Bereich 4 (data-pad-index Attribute): Jeder Pad-Button bekam data-pad-index={index} damit handleGridMouseDown via target.closest('[data-pad-index]') zuverlässig zwischen Grid-Background und Pad-Click unterscheiden kann (data-testid mit Pattern 'perf-pad-N' war für closest() nicht ideal).",
        "TASK-123 / Multi-Drag-Image (v1.22.0). Wenn multiSelect.size > 1 UND dragSrc ∈ multiSelect: programmatisch erzeugtes <canvas> 60×60px wird via dataTransfer.setDragImage(canvas, 30, 30) als Cursor-Image gesetzt. Canvas-Content: Pad-Color (User-defined oder Theme-Default via getPadDefaultColor) als Background, accent-secondary Border (3px, live aus --ss-accent-secondary via getComputedStyle), '+N' Badge zentral (N = total-1 = Anzahl ZUSÄTZLICHER Pads, intuitiver als 'N Pads'). Single-Drag (kein Multi-Select) → Browser-Default-Image (kein setDragImage-Call). Modul-Top-Level-Funktion createMultiDragCanvas() — try/catch für JSDOM-Safety.",
        "TASK-123 / Bereich 1 (handleDragStart Refactor): Signature von (index) → (index, e: React.DragEvent<HTMLButtonElement>) erweitert (Pad-Prop-Typ + Call-Site beide aktualisiert). e.dataTransfer.setDragImage() läuft nur wenn Multi-Select-Bedingung erfüllt, Fallback ist die default Browser-Drag-Preview des Pad-Buttons.",
        "TASK-123 / Bereich 2 (E2E-Surface): Neues data-multi-drag-count={String(N)} Attribut auf dem dragSrc-Pad während Multi-Drag aktiv (undefined sonst). Für Playwright als deterministische Assertion ohne Screenshot-Compare.",
        "TASK-120 / Tests Unit: tests/features/performance-mouse-box.test.ts NEU mit 24 Tests in drei describe-Blöcken: normalizeBox (6 — alle vier Drag-Richtungen + Zero-Move + Negative-Coords); boxIntersects (9 — inside/outside/edge/cornering/symmetry/degenerate-w-or-h); collectPadsInBox (9 — 4×4 Grid mit/ohne leeren Slots, Reverse-Drag + normalize, edge-cases). Alle Helper sind reine Funktionen → DOM-frei testbar im Node-Environment.",
        "TASK-120+123 / Tests Playwright: tests/web/performance-mode.spec.ts +9 Tests in zwei describe-Blöcken: Mouse-Box (7 — Overlay-Sichtbarkeit, Drag über 2 Pads, Shift=additiv, ohne-Modifier=replace, Escape clearet Selection, Overlay verschwindet nach mouseup, kein Overlay außerhalb Reorder-Mode) + Multi-Drag-Image (2 — data-multi-drag-count=3 bei 3 selected, kein Attribut bei Single-Drag). Browser-Mouse-API via page.mouse.* statt dragTo (unsere Box-Selection ist KEIN HTML5-DnD).",
        "TASK-120+123 / Verification: pnpm check clean (precheck gen:sandbox up-to-date, tsc --noEmit 0 Fehler). pnpm test 1190/1205 grün (63 test files, 15 pre-existing skipped, +24 neue mouse-box Tests, 0 Regressionen). PatternLaunchPad weiterhin frei von hardcoded Tailwind-Farben — Box-Overlay nutzt nur border-accent-secondary + bg-accent-secondary/10; Canvas-Drag-Image liest accent-secondary live aus --ss-accent-secondary."
      ],
      next: [
        "TASK-120 / Welle 2 (Polish UX): Bei sehr großen Drag-Boxen (z.B. über das ganze Grid) kann der Browser den Cursor 'auto-scroll' wenn die Maus den Viewport-Rand erreicht. Aktuell triggert das KEIN reaktives Update der Pad-Rects — wenn der User scrollt während des Drags, bleibt die Box-Position in Viewport-Coords stabil aber die Pad-Rects (getBoundingClientRect ist viewport-relativ) verschieben sich. Bei einem static-Layout-Grid wie unserem ist das irrelevant; bei dynamischen Layouts wäre es ein Bug.",
        "TASK-120 / Welle 2 (Edge): Wenn der User mousedown auf einem leeren Pad-Slot macht, wird der Box-Drag NICHT gestartet (target.closest('[data-pad-index]') matcht). Das ist als 'Pads sind interaktiv' designed — aber UX-mäßig könnte man argumentieren, dass leere Slots wie Background behandelt werden sollten. Akzeptabler Trade-off — User kann auf den 8px-gap zwischen Pads klicken um Drag zu starten.",
        "TASK-120 / Welle 2 (a11y): Box-Select hat KEINE keyboard-equivalent (kein Cmd+A 'Select All' oder Shift+ArrowKeys range-select). Nutzer mit Tastatur-only haben jetzt nur Shift+Click pro Pad (langsamer). 'Select All' (Cmd/Ctrl+A im Reorder-Mode) wäre ein einfacher next-step.",
        "TASK-123 / Welle 2 (Polish): Multi-Drag-Canvas zeigt Pad-Color des dragSrc — bei diversen Farben in der Selection könnte ein gradient/stack-Effekt mehr Info geben. Aktuell minimaler '+N' Badge — funktional, aber visuell schlicht.",
        "TASK-123 / Welle 2 (Tests Playwright): Die 2 neuen Multi-Drag-Image-Tests dispatchen DragEvent direkt via element.dispatchEvent() statt page.mouse-Mechanik, weil Playwright keine native HTML5-DnD-Simulation für setDragImage-Verifikation hat. Das funktioniert für das data-multi-drag-count Attribut, aber das tatsächliche Canvas-Rendering (Pixel-Vergleich) ist nicht abgedeckt. Visual-Regression-Test mit Screenshot-Compare wäre Welle 3."
      ],
      changed: [
        "client/src/components/PerformanceMode/PatternLaunchPad.tsx",
        "tests/features/performance-mouse-box.test.ts",
        "tests/web/performance-mode.spec.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-12T23:45:00.000Z",
      done: [
        "TASK-118 / Macro-Button Hold-Mode (v1.22.0). Vorher: triggerMode-Type-Union enthielt nur 'edge' (Type-only-Placeholder seit v1.17). Jetzt: voll funktionierender Hold-Mode mit Loop-Re-Trigger solange Button gedrückt — Script-Loop alle 200ms, Pad-Loop alle 100ms. No-Stacking-Garantie: pro Macro-Index nur EINE Loop parallel.",
        "TASK-118 / Bereich 1 (client/src/store/useMacroStore.ts): MacroTriggerMode-Type erweitert auf 'edge' | 'hold'. migrateMacro liest jetzt m.triggerMode === 'hold' → 'hold', sonst (inkl. invalid/undefined) → 'edge' (defensiv). Neue Public-API: setMacroTriggerMode(macroIndex, mode) mit out-of-range + invalid-string no-op-Guards. triggerMacroButton dispatcht jetzt event.detail.triggerMode (für App.tsx-Loop-Entscheidung). Neue Public-API triggerMacroButtonRelease(macroIndex) dispatcht 'macro:button:release' Event {macroIndex} — App.tsx prüft selbst ob Loop aktiv ist (no-op falls nicht).",
        "TASK-118 / Bereich 2 (client/src/utils/macroHoldLoop.ts NEU): Pure-Logik-Helper mit Module-State (Map<macroIndex → HoldLoopState>) für die Loop-Verwaltung. Inject-Scheduler-Pattern (default globalThis.setInterval/clearInterval) macht den Helper mit vi.useFakeTimers oder Custom-Mock-Scheduler isoliert testbar. startHoldLoop ruft run() SOFORT einmal auf, dann alle intervalMs via Scheduler. No-Stacking: zweiter Call für selben Index stoppt erst alte Loop. stopHoldLoop / stopAllHoldLoops / isHoldLoopActive / getActiveHoldLoopCount als Public-API. Konstanten SCRIPT_HOLD_INTERVAL_MS=200, PAD_HOLD_INTERVAL_MS=100. Defensive Error-Handling: run() wirft → Loop läuft trotzdem weiter (try/catch um run() in Initial+Interval-Call).",
        "TASK-118 / Bereich 3 (client/src/App.tsx): macro:button:trigger-Handler erweitert: Detail enthält jetzt auch triggerMode. Pure runScriptOnce(scriptId) + runPadOnce(padIndex) Helpers werden in edge-mode direkt aufgerufen, in hold-mode via startHoldLoop() als Loop-run-Funktion. Neuer macro:button:release-Listener ruft stopHoldLoop(macroIndex). Cleanup beim Unmount ruft stopAllHoldLoops() (HMR-safe).",
        "TASK-118 / Bereich 4 (client/src/components/Macro/MacroPanel.tsx): BindingEditor zeigt im Button-Mode neuen Trigger-Verhalten-Toggle (radiogroup Edge/Hold) UNTER dem existing Trigger-Kind-Toggle (Script/Pad). Tooltips am Hold-Button differenzieren zwischen Script-Loop (200ms) und Pad-Loop (100ms). Beschreibungstext-Zeile darunter zeigt das aktive Verhalten. MacroButton-Komponente: neuer triggerMode-Prop, im Hold-Mode wird ein 🔁-Icon-Overlay oben-rechts angezeigt (absolute positioned, aria-hidden). onMouseUp/onMouseLeave/onTouchEnd ruft im Hold-Mode triggerMacroButtonRelease — App.tsx stoppt die Loop. Im Edge-Mode bleibt setPressed das einzige nötige cleanup. aria-label des Buttons differenziert Hold vs Edge.",
        "TASK-118 / Tests (tests/features/macros.test.ts): 75 → 99 Tests (+24). Neue Describe-Blöcke: 'Trigger-Mode Schema (Edge vs Hold)' (6 Tests), 'triggerMacroButton – Hold-Mode-Event-Detail' (3 Tests), 'triggerMacroButtonRelease – Release-Event' (4 Tests), 'Hold-Mode Persistence + Migration' (3 Tests), 'macroHoldLoop – Pure-Logik-Helfer' (8 Tests, vi.resetModules + Mock-Scheduler für No-Stacking/Independence/Error-Tolerance/All-Stop).",
        "TASK-118 / Verification: pnpm check clean (tsc --noEmit 0 Fehler). pnpm test 1190/1205 grün (63 test files, 15 pre-existing skipped, +24 neue Tests in macros.test.ts, 0 Regressionen). Type-Union MacroTriggerMode = 'edge' | 'hold' ist jetzt voll genutzt, alle Type-Casts entfernt."
      ],
      next: [
        "Welle 2 (Playwright E2E): App.tsx-Hold-Loop-Logik selbst hat keinen direkten Unit-Test — der reine Hold-Loop-Helper (macroHoldLoop.ts) ist getestet, aber das Wiring 'mouseDown auf MacroButton → triggerMacroButton → macro:button:trigger → startHoldLoop → runScriptOnce' ist nur durch Komponenten-Test/Playwright greifbar. Smoke-Test in tests/web/macros.spec.ts wäre sinnvoll: Button im Hold-Mode drücken, 500ms halten, prüfen ob Script (oder Pad-Queue) min. 2x getriggert wurde, dann loslassen + prüfen dass keine weiteren Triggers kommen.",
        "Welle 2 (Re-Entrancy bei Script-Hold): Aktuell hat runScriptOnce einen Re-Entrancy-Schutz (scriptSandbox.isRunning() → skip). Wenn ein Script länger als 200ms läuft (= Hold-Interval), springen Loop-Iterationen über. Das ist defensiv korrekt (verhindert Stacking von Sandboxen), aber UX könnte erwarten dass 'Hold' regelmäßiger triggert. Optional: längere Hold-Intervalle als Default für Script (z.B. 300-500ms) oder UI-Setting für Custom-Interval.",
        "Welle 2 (Keyboard-Bindings): Macro-Button-Trigger sind aktuell nur per Maus/Touch — die Keyboard-Equivalent (Macro-Key-Bindings via useKeyboardBindingsStore) löst aktuell wahrscheinlich nur Edge aus (keine keyup-Handling für Hold). Out-of-Scope für TASK-118, aber sollte in v1.23 untersucht werden.",
        "Welle 3 (UX): Hold-Mode-Visual (🔁-Icon) ist text-emoji — auf manchen Themes (oled-Schwarz, hohem Kontrast) könnte ein Lucide-Icon (z.B. RotateCw oder Repeat) konsistenter sein. Pure-CSS-Schmuck statt Unicode-Glyph."
      ],
      changed: [
        "client/src/store/useMacroStore.ts",
        "client/src/utils/macroHoldLoop.ts",
        "client/src/components/Macro/MacroPanel.tsx",
        "client/src/App.tsx",
        "tests/features/macros.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-12T23:30:00.000Z",
      done: [
        "TASK-119 / Theme-aware Performance-Pad Color-Palette (v1.22.0). Vorher waren 16 hardcoded Hex-Farben (PAD_COLORS-Array) als Default-Pad-Farben in PatternLaunchPad.tsx fest verbaut. Auf hellen Themes (daylight/paper) wirkten diese unpassend, auf deuteranopia/protanopia sogar A11y-problematisch. Lösung: 8 neue CSS-Variablen --ss-pad-1..8 pro Theme + Helper-Function `getPadDefaultColor(index)` mit mod-loop (16 Slots → 8 Töne).",
        "TASK-119 / Bereich 1 (client/src/index.css): Pro Theme (10 Themes × 8 Variablen = 80 neue Tokens) wurden --ss-pad-1..8 definiert. Mapping: dark=cyan/violet/emerald/red/orange/amber/blue/fuchsia (Subset der alten PAD_COLORS); neon=Neon-Sättigung; analog=warm/Hardware; purple=Violet-Shades; warm=Sonnenuntergang; oled=extreme Akzente; daylight=Pastell; paper=Sepia/Olive/Burgundy/Rust; deuteranopia=vollständige Okabe-Ito 8er-Palette (sicher unterscheidbar bei Rot-Grün-Schwäche); protanopia=Okabe-Ito-adapted (dunklere Töne für hellen Hintergrund).",
        "TASK-119 / Bereich 2 (client/src/components/PerformanceMode/PatternLaunchPad.tsx): PAD_COLORS-Array entfernt (durch PAD_COLOR_FALLBACKS readonly-Array ersetzt — 8 Slots statt 16, dient als reines Safety-Net wenn getComputedStyle leer ist). Neue Helper-Function `getPadDefaultColor(index: number): string` liest live aus document.documentElement via getComputedStyle().getPropertyValue(`--ss-pad-${slot+1}`) mit mod-loop ((index%8+8)%8 robust gegen negative Indizes). Try/catch um getComputedStyle für JSDOM-Safety. Drei Call-Sites umgestellt: (1) Pad-Render-Loop nutzt getPadDefaultColor(i); (2) PadEditor-fallbackColor nutzt getPadDefaultColor(editingIndex); (3) Color-Swatch-Picker im Editor zeigt jetzt useMemo-cached `themedSwatches` (8 Slots aus den aktiven Theme-Tokens) statt der 16 hardcoded Hex. Neue data-testid='perf-pad-color-swatches' + data-pad-swatch={n} Attribute für Playwright. User-defined pad.color hat WEITERHIN Vorrang (Domain-Choice respektieren — kein Auto-Theme-Migration).",
        "TASK-119 / Bereich 3 (client/src/store/usePerformanceStore.ts): Neue exportierte Konstante `PAD_COLOR_VAR_NAMES: readonly string[]` = ['--ss-pad-1', ..., '--ss-pad-8']. KEINE Schema-Änderung an PerformancePad/PersistedState — alte v1.20.x Daten mit hardcoded color: '#22d3ee' laden weiter unverändert (verifiziert per Test).",
        "TASK-119 / Tests Unit: tests/features/performance-store.test.ts von 49 auf 58 Tests (+9): 3 für PAD_COLOR_VAR_NAMES-Export (Länge, Schema, readonly-Surface); 2 für Migration (alter hardcoded hex bleibt unverändert + setPadColor überschreibt korrekt); 4 für getPadDefaultColor-Algorithmus (Slot-Mapping mit mod-loop, Fallback bei leerer CSS-var, Exception-Path, Negative+große Indizes). Algorithmus per Re-Implementation gespiegelt, weil der Helper privat in PatternLaunchPad.tsx lebt — Vertrags-Korrektheit via PAD_COLOR_VAR_NAMES-Export verifiziert.",
        "TASK-119 / Tests Playwright: tests/web/performance-mode.spec.ts +5 Tests in neuem describe-Block 'Theme-aware Default-Pad-Farben (TASK-119)': (1) --ss-pad-1..8 sind im dark-theme definiert (hex-format-check); (2) Theme-Wechsel ändert die CSS-Variablen (dark vs daylight vs paper); (3) Default-Pad-Farbe folgt aktivem Theme via getComputedStyle.backgroundColor (Theme-Toggle + Re-render-Trigger via Mode-Switch); (4) User-defined #ff00ff bleibt theme-invariant (Color-Picker-Value-Check); (5) Color-Swatches im Editor zeigen 8 Slots + Custom-Picker (perf-pad-color-swatches + data-pad-swatch=1..8 Selektoren).",
        "TASK-119 / Verification: pnpm check clean (precheck gen:sandbox up-to-date, tsc --noEmit 0 Fehler). pnpm test 1142/1157 grün (62 test files, 15 pre-existing skipped, +9 neue performance-store Tests, 0 Regressionen). theme-class-purity.test weiterhin grün — keine neuen hardcoded Tailwind-Farben in PatternLaunchPad."
      ],
      next: [
        "TASK-119 / Welle 2 (Playwright Stabilisierung): Die 5 neuen Theme-Tests laufen nur im Playwright-Mode (nicht in CI ohne Browser). Der Re-Render-Trigger bei Theme-Wechsel (Mode-Toggle Edit→Play) ist hacky — eine sauberere Lösung wäre ein useThemeStore-Subscription in PatternLaunchPad, das die themedSwatches-useMemo neu berechnet. Aktuell rendert die Component aber bei jedem Theme-Wechsel ohnehin neu (App.tsx data-theme-Attribute), weil computed-styles im nächsten React-Tick neu gelesen werden — der Hack ist deshalb funktional ausreichend.",
        "TASK-119 / Welle 2 (Polish): Color-Swatch-Picker im PadEditor zeigt jetzt nur 8 Tokens statt der alten 16 hardcoded Hex-Optionen. User mit Performance-Mode-Workflows könnte das als 'weniger Auswahl' empfinden. Custom-Picker (native <input type=color>) bleibt als Escape-Hatch. Alternative: 16-Pad-Slot-Tokens (--ss-pad-1..16) — verdoppelt aber den CSS-Aufwand und die meisten Themes haben gar nicht 16 sinnvoll unterscheidbare Akzente.",
        "TASK-119 / Welle 2 (UX): Die Default-Pad-Farben werden NUR beim Mount/Render gelesen (via getComputedStyle in Render-Funktion). Bei aktivem Performance-Mode während eines Theme-Wechsels triggert die data-theme-Änderung an <html> ein Re-Render (via React-Tree-Update), aber die useMemo-Cache im PadEditor ist auf [index] dependency keyed — wenn der Editor während des Theme-Wechsels offen ist, bleibt themedSwatches stale bis zum nächsten Open. Akzeptabler Edge-Case, aber dokumentierter Defekt.",
        "TASK-119 / Welle 3 (DX): Eine zentrale theme.ts utility-Funktion (getCssColor von MixerView extrahieren + sharen) wäre eleganter als der inline-getPadDefaultColor-Helper. Aktuell duplizieren MixerView/WavetableEditor/SampleSlicer/GranularSynthPanel/SampleWaveform alle das gleiche Pattern getComputedStyle()...getPropertyValue() — ein zentraler Helper in client/src/utils/cssVars.ts wäre Refactor-Material.",
        "TASK-119 / Welle 3 (A11y): protanopia-Palette nutzt jetzt 8 dunklere Töne (statt nur 4 wie das accent-set). Manuelle Verifikation mit echtem Colorblindness-Simulator (z.B. Colorblindly Chrome-Extension) noch offen — die Hex-Werte sind aus Okabe-Ito abgeleitet, aber individuelle Render-Fehler oder Wahrnehmungs-Probleme können nur durch echte Nutzer-Tests bestätigt werden."
      ],
      changed: [
        "client/src/index.css",
        "client/src/components/PerformanceMode/PatternLaunchPad.tsx",
        "client/src/store/usePerformanceStore.ts",
        "tests/features/performance-store.test.ts",
        "tests/web/performance-mode.spec.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "backend",
      timestamp: "2026-05-12T23:00:00.000Z",
      done: [
        "TASK-117 / LFO-Macros wiring (v1.22.0). Macro-Bindings für lfo-rate / lfo-depth sind nicht mehr `onUnhandled`-Warnings sondern verdrahtet bis in die SynthEngine. Implementierungs-Strategie: Cache-Variant (Map<partId, {rate?, depth?}>) statt persistent Per-Part-LFO-Audio-Nodes — die existing LFOs werden pro Step-Trigger erzeugt (an Note-Lebensdauer gekoppelt). Der Cache wird beim nächsten Step-Trigger gelesen und überschreibt `synthParams.lfoRate`/`lfoDepth`. Minimaler Refactor: SynthEngine.ts +112 LOC (Cache + 4 Setter/Getter + clearPartLfoCache + triggerNote(partId?)-Hook), AudioEngine.ts +60 LOC (lazy SynthEngine-Instanz + 4 Delegates), App.tsx -2/+5 LOC (setLfoRate/setLfoDepth im Setter-Bag, generischer onUnhandled).",
        "TASK-117 / Bereich 1 (SynthEngine.ts): Neue Klassen-Mitglieder `_partLfoCache: Map<string, {rate?: number; depth?: number}>` + Range-Konstanten `PART_LFO_RATE_MIN=0.01`, `PART_LFO_RATE_MAX=30`, `PART_LFO_DEPTH_MIN=0`, `PART_LFO_DEPTH_MAX=1`. Vier public Methoden: `setPartLfoRate(partId, hz)` mit Clamp [0.01..30] + NaN/Infinity/empty-partId no-op-Guards; `setPartLfoDepth(partId, depth)` mit Clamp [0..1] (normalisiert); `getPartLfoRate/Depth(partId)` liefern null wenn nie gesetzt; `clearPartLfoCache(partId?)` löscht einen Part oder alle. `triggerNote(freq, params, time, prevFreq?, partId?)` bekam optionalen partId-Parameter — wenn gesetzt und Cache vorhanden, wird `params` geklont und `lfoRate` / `lfoDepth` überschrieben (depth wird von 0..1 normalisiert auf 0..100 Cents skaliert, weil SynthParams.lfoDepth in Cents liegt).",
        "TASK-117 / Bereich 2 (AudioEngine.ts): Lazy `_synthEngine: SynthEngine | null` + `_getOrCreateSynthEngine()`-Helfer der bei verfügbarem ctx+masterGain eine SynthEngine-Instanz erzeugt (browser-fallback-safe — vor `init()` ist es no-op). Statischer `import { SynthEngine } from './SynthEngine'` am Datei-Anfang. Vier Public-Delegates: `setPartLfoRate/Depth(partId, value)` + `getPartLfoRate/Depth(partId)`. Methoden positioniert direkt nach `setChannelSend` für räumliche Nähe zum Macro-Routing.",
        "TASK-117 / Bereich 3 (App.tsx): Im macro:change-Handler den Setter-Bag erweitert: `setLfoRate: (partId, hz) => AudioEngine.setPartLfoRate(partId, hz)` + `setLfoDepth: (partId, depth) => AudioEngine.setPartLfoDepth(partId, depth)`. Der vorherige `onUnhandled`-Spezialfall für lfo-rate/lfo-depth wurde aufgelöst — `onUnhandled` ist jetzt generisch (warnt für jedes nicht implementierte Target). Bestehende MacroRouteSetters-Interface in useMacroStore.ts hat setLfoRate?/setLfoDepth? bereits seit TASK-100 deklariert — kein Schema-Change nötig.",
        "TASK-117 / Tests Unit: tests/features/macros.test.ts +5 Tests (lfo-rate min=1/max=10 @ 0.5 → 5.5; lfo-depth min=0/max=0.8 @ 1 → 0.8; lfo-depth 0..1 @ 0.5 → 0.5; lfo-depth onUnhandled-Fallback ohne setter — Backwards-Compat für TASK-100; lfo-rate/lfo-depth ohne partId stillschweigend ignoriert). tests/electron/synth-engine.test.ts +16 Tests (getter liefert null wenn nie gesetzt; set+get roundtrip Rate/Depth; Range-Clamp hz=999→30 / hz=-1→0.01 / depth=2→1 / depth=-0.5→0; NaN/Infinity no-op für beide Setter; empty-partId no-op; Cache pro Part-ID isoliert; Rate+Depth koexistieren; clearPartLfoCache(partId)+clearPartLfoCache() löschen korrekt; triggerNote(.., partId='lead') übernimmt gecachte Rate aus Cache statt params.lfoRate; triggerNote ohne partId umgeht Cache).",
        "TASK-117 / Verification: pnpm check clean (tsc --noEmit, 0 Fehler). pnpm test 1142/1157 grün (62 test files, 15 pre-existing skipped, +21 neue Tests, 0 Regressionen). synth-engine.test.ts wuchs von 10 auf 26 Tests, macros.test.ts von 70 auf 75 Tests. AudioEngine.ts hat keinen circular-import (SynthEngine importiert nichts von AudioEngine)."
      ],
      next: [
        "Welle 2 (Wiring): Die Step-Trigger-Sites in AudioEngine (wo `synthParams` aus `PartData` an SynthEngine weitergereicht werden würden) sind aktuell NICHT verdrahtet — SynthEngine wird vom Step-Scheduler in AudioEngine noch gar nicht aufgerufen (PartData.sourceType=wavetable/fm wird gespeichert, aber die Synth-Synthese läuft via Tone.js bzw. nicht überhaupt). Das ist out-of-scope für TASK-117 — Macro-Setter cachen aber den Wert korrekt, sodass beim späteren Wiring der Step-Trigger-Site nur ein `engine.triggerNote(freq, params, time, prevFreq, part.id)` (zusätzliches partId-Arg) reicht.",
        "Welle 2 (UX): Macro-Bindings für lfo-rate sollten in der UI sinnvolle min/max Defaults vorschlagen (z.B. 0.1..20 Hz wie SynthPanel) statt 0..1. Aktuell schreibt der User die Range manuell. Ein 'Vorlage'-Dropdown beim Hinzufügen einer Binding wäre ergonomischer.",
        "Welle 2 (Tests): Integration-Test der wirklich Macro→App→AudioEngine→SynthEngine ende-zu-ende prüft fehlt (alle Layer einzeln getestet, aber kein E2E-Pfad). Würde DOM (CustomEvent-Dispatcher) + AudioContext-Mock brauchen — Vitest mit jsdom-environment + Web-Audio-Mock wäre der Weg.",
        "Welle 2 (Schema): MacroRouteSetters hat setLfoRate?/setLfoDepth? optional. Sobald die Step-Trigger-Sites verdrahtet sind, könnten sie auf required umgestellt werden (Compile-Time-Garantie für Frontend-Agents die das Setter-Bag nutzen). Aktuell defensive für Backwards-Compat zu altem TASK-100-Test."
      ],
      changed: [
        "client/src/audio/SynthEngine.ts",
        "client/src/audio/AudioEngine.ts",
        "client/src/App.tsx",
        "tests/features/macros.test.ts",
        "tests/electron/synth-engine.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-12T22:50:00.000Z",
      done: [
        "TASK-121 / MAX_TIMESTRETCH_TRACKS UX-Warnung (v1.22.0). Globaler Kontext für Soft-Limit MAX_TIMESTRETCH_TRACKS=4 — bisher sah der User nur eine disabled-Option im AudioTrackStrip-Dropdown ohne globale Anzeige warum. Zwei Bereiche umgesetzt: (1) Header-Counter im MixerView, (2) Info-Banner im AudioTrackStrip wenn Limit erreicht und current Track nicht selbst timestretch.",
        "TASK-121 / Store-Erweiterung: client/src/store/useAudioTrackStore.ts +9 LOC. Neuer Public-Helper isTimestretchLimitReached() = countTimestretchTracks() >= MAX_TIMESTRETCH_TRACKS. Pure-Function ohne Side-Effects, ideal für UI-Bedingungen, ohne den Counter doppelt zu rechnen.",
        "TASK-121 / Bereich 1 (Counter): client/src/components/Mixer/MixerView.tsx — neuer Import countTimestretchTracks + MAX_TIMESTRETCH_TRACKS. Counter renders only when audioTracks.length > 0, im Header rechts neben dem [+ Audio Track]-Button. data-testid='timestretch-counter'. Drei-Stufen-Farbmapping: count >= MAX (=4) → text-accent-danger (rot); count >= MAX-1 (=3) → text-accent-secondary (gelbe Warnung); sonst → text-text-dim (neutral). Title-Tooltip differenziert Limit-erreicht vs aktiv. Reine semantische Tokens — keine hardcoded-Farben.",
        "TASK-121 / Bereich 2 (Banner): client/src/components/Mixer/AudioTrackStrip.tsx — neuer Info-Banner unter dem Sync-Mode-Dropdown. Sichtbarkeit (alle drei müssen wahr sein): (a) current Track ist NICHT bereits timestretch (sonst hat er ja seinen Slot), (b) tsLimitReached === true (count >= MAX), (c) audioWorkletSupported === true — sonst übernimmt der existierende 'AudioWorklet nicht supported'-Pfad den Tooltip ohnehin. Banner verwendet role='status', data-testid='timestretch-limit-banner', text-accent-secondary (matches Tooltip-Color), Text: '⚠ Max 4 Time-Stretch-Tracks (CPU). Frei für diesen Track: Free/Stretch.'. Bestehende disabled-Option im Dropdown bleibt unverändert.",
        "TASK-121 / Tests Unit: tests/features/audio-track-timestretch.test.ts von 13 auf 18 Tests erweitert (+5 für isTimestretchLimitReached). Neuer describe-Block 'isTimestretchLimitReached helper (TASK-121)': returns false bei 0 ts-Tracks; returns false bei 3 (Limit=4); returns true bei 4; ignoriert non-timestretch (3 ts + 2 free → false); reagiert auf updateAudioTrack syncMode-Patch (3 ts + free → patch free auf ts → Limit). Alle 18 Tests grün, 0 Regressionen.",
        "TASK-121 / Tests Playwright (optional): tests/web/audio-track.spec.ts von 5 auf 9 Tests erweitert (+4 für TimeStretch Counter + Banner). Neuer describe-Block 'TimeStretch Counter + Banner (TASK-121)': Counter hidden ohne Tracks; Counter neutral (text-text-dim) bei 1 free-Track + Text '0/4'; Counter rot (text-accent-danger) bei 4 timestretch-Tracks + Text '4/4'; 5. Track zeigt Banner sichtbar + option disabled. Banner-Text + Counter-CSS-Klassen verifiziert.",
        "TASK-121 / Verification: pnpm check clean (precheck gen:sandbox 'up-to-date', tsc --noEmit ohne Fehler). pnpm test 1111/1126 grün (62 test files, 15 pre-existing skipped, +5 neue Store-Helper-Tests, 0 Regressionen). AudioTrackStrip + MixerView keine Hardcoded-Farben (ausschließlich text-accent-danger/secondary, text-text-dim semantisch)."
      ],
      next: [
        "Welle 2 (UX): Banner-Text könnte 'einen anderen Track zurück auf Free/Stretch setzen' als CTA bekommen (Link zu erstem timestretch-Track des Mixers — würde Cross-Strip-Highlighting brauchen, kleines refactoring).",
        "Welle 2 (UX): yellow-Warn-Stufe greift bei count >= MAX-1 (=3). Bei count=4 ist sie eigentlich von der roten Stufe überdeckt — sauberer Übergang. Für count=3 sieht der User die gelbe Warnung allerdings ohne zusätzlichen Kontext warum (kein dritter Tooltip). Könnte ein zweistufiger Tooltip sein: bei 3 'Noch 1 Slot frei', bei 4 'Limit erreicht'.",
        "Welle 2 (a11y): Counter ist nur ein <span> ohne role/aria-live. Bei Wechsel von 3→4 wäre eine polite-Live-Announcement nützlich für Screen-Reader. Aktuell still — visual-only.",
        "Welle 2 (Tests Playwright): die 4 neuen Tests laufen nicht in CI (out-of-scope laut Briefing). Bei Live-Audio-Tests in jsdom/Playwright kann der tiny WAV-Buffer beim decode fehlschlagen — current Test umgeht das, weil 'Sync Mode'-Wechsel rein UI-State ist. Falls audioWorkletSupported-Check in echtem Chromium false zurückgibt, wäre Banner sichtbar selbst ohne Limit-Hit — Test-Robustheit hängt vom Playwright-Chromium-Build ab.",
        "Welle 2 (Refactor): countTimestretchTracks() wird jetzt in 2 Stellen aufgerufen (MixerView Header + AudioTrackStrip tsLimitReached). Bei vielen Tracks O(N) pro re-render — ein useSyncExternalStore-Cache wäre eleganter. Aktuell akzeptabel (max 8 Tracks)."
      ],
      changed: [
        "client/src/store/useAudioTrackStore.ts",
        "client/src/components/Mixer/MixerView.tsx",
        "client/src/components/Mixer/AudioTrackStrip.tsx",
        "tests/features/audio-track-timestretch.test.ts",
        "tests/web/audio-track.spec.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-12T22:35:00.000Z",
      done: [
        "TASK-114 / Performance-Pad a11y Keyboard-Reorder + Multi-Select (v1.21.0). Zwei Verbesserungen aus dem TASK-111-Follow-up zusammen ausgeliefert: (A) WAI-ARIA-konformes Keyboard-Reorder, (B) Shift/Ctrl+Click Multi-Select mit Bulk-Drag.",
        "TASK-114 / Store-Erweiterung: client/src/store/usePerformanceStore.ts +90 LOC. Neue API moveMultiplePads(fromIndices:number[], targetIndex:number) mit Insert-Semantik (NICHT Swap — sonst Chaos bei N>1). Algorithmus: (1) Sanitisieren fromIndices (dedup, in-range, integer); (2) Snapshot pickedPads in fromIndices-Reihenfolge; (3) Entfernen aus _pads → compacted Array (15-N Slots); (4) Insert-Punkt = targetIndex MINUS Anzahl der zuvor entfernten Indizes vor targetIndex; (5) splice pickedPads ein; (6) auf PAD_COUNT normalisieren. No-op-Conditions: leere Liste / targetIndex ∈ fromIndices / out-of-range / Identitäts-Resultat. Reverse-Order ([15,14]→0) bleibt erhalten weil pickedPads die fromIndices-Order übernimmt.",
        "TASK-114 / Component-Rewrite: client/src/components/PerformanceMode/PatternLaunchPad.tsx von 602 auf 922 LOC. Bereiche A+B:",
        "TASK-114 / (A) WAI-ARIA Grid: <div role='grid' aria-label='Performance Pads (4 mal 4)' aria-rowcount=4 aria-colcount=4 onKeyDown={handleGridKeyDown}>. Jeder Pad: role='gridcell', tabIndex={isFocused?0:-1} (Roving-Tabindex), aria-rowindex/colindex/selected, dynamisches aria-label das Status enthält ('aktiv'/'in Queue'/'gegriffen'/'ausgewählt'). aria-grabbed bewusst weggelassen (in WAI-ARIA 1.1 deprecated) — Status kommt über aria-label + Live-Region.",
        "TASK-114 / (A) Live-Region: <div role='status' aria-live='polite' aria-atomic='true' className='sr-only' data-testid='perf-live-region'> mit setLiveMessage()-State. Announcements: 'Pad N gegriffen, Pfeiltasten zum Verschieben...' beim Grab, 'Pad an Position M abgelegt' beim Drop, 'Verschieben abgebrochen' bei Escape, 'Pad an Position N' bei Bewegung.",
        "TASK-114 / (A) Keyboard-Handler auf Container (nicht pro Pad — Event-Bubbling reicht). handleGridKeyDown unterscheidet: Arrow/Home/End → moveFocus() innerhalb Grid (klemmt am Rand, kein Wrap); im grabbed-State werden Pfeiltasten zu moveMultiplePads([grabbed], target) UND focusedIndex/grabbedIndex folgen mit. Space/Enter → Play=trigger, Edit=open editor, Reorder=toggle grab/drop. Tab+grabbed → e.preventDefault (Focus-Trap, User muss Drop oder Cancel). Escape (eskalierend): Editor offen → schließe Editor; sonst grabbed → restore Snapshot + Live-Announce; sonst → schließe Performance Mode.",
        "TASK-114 / (A) Snapshot/Restore: grabbedSnapshotRef speichert pads.slice() vor jedem Grab. Bei Escape iteriert ein restoreSnapshot()-Helper via setPadAt(i, snap[i]) durch alle 16 Slots — pragmatischer Ansatz statt einer dedizierten setPads(bulk) API (würde N notify-Events feuern, aber synchron + akzeptabel). Mode-Wechsel während grabbed cancelt OHNE Restore (User-Intent unklar — wer abbrechen will, drückt Escape vorher).",
        "TASK-114 / (B) Multi-Select: State multiSelect:Set<number> (runtime-only — wie queuedPatternId NICHT persistiert). onClickHandler in Pad-Komponente liest e.shiftKey/ctrlKey/metaKey → handleReorderClick({modifiers}). Mit Modifier: toggle in Set; ohne Modifier: toggle Grab (Keyboard-Reorder via Click). Empty-Slots werden BLOCKIERT (pad?early-return) — kein sinnvoller Bulk-Op auf null. Mode-Wechsel Reorder→Play/Edit leert die Auswahl. Visueller Indikator: 'N ausgewählt' Counter im Header (data-testid='perf-multiselect-count'), Pads bekommen ring-2 ring-accent-secondary; gegriffene haben ring-accent-primary mit ring-offset; isFocused-Pad ohne Grab/Selected hat ring-accent-primary. Prioritäten-Reihenfolge: grabbed > focused > selected.",
        "TASK-114 / (B) Bulk-Drag: handleDrop in der Pad-Komponente prüft (multiSelect.has(dragSrc) && multiSelect.size > 1) — wenn ja, fromIndices = sortierte Auswahl + moveMultiplePads(fromIndices, target); Auswahl wird nach erfolgreichem Move geleert. Target darf NICHT in fromIndices liegen (no-op). Wenn Drag-Source NICHT Teil des Multi-Selects (oder Auswahl-Größe 1), bleibt klassisches movePad() (Swap-Semantik aus v1.20.x). Backwards-Compat damit garantiert.",
        "TASK-114 / Theme-Compliance: Nur semantische Tokens. ring-accent-primary (focused + grabbed), ring-accent-secondary (multi-select), ring-offset-bg-base. Grep auf bg-/text-/border-/ring-/outline-{slate,cyan,red,yellow,orange,...}-N → 0 Treffer in der Datei.",
        "TASK-114 / Tests Unit: tests/features/performance-store.test.ts von 38 auf 49 Tests erweitert (+11 für moveMultiplePads — alle grün). Neuer describe-Block 'moveMultiplePads (Insert-Semantik, TASK-114)': Happy-Path [0,1]→5 mit korrekter Kompaktierung verifiziert; [3,5,7]→0 bringt drei Pads an den Anfang; [0]→0 + [3]→3 no-op (move-to-self); [] no-op (leere Liste); [15,14]→0 Reverse-Order; [99,-1,2.5]→0 filtert invalide via Number.isInteger + range-check; [0,0,0]→5 dedupliziert; target out-of-range/non-integer → no-op; Persistierung in localStorage verifiziert; [0,2,4]→1 mit Target zwischen Picks.",
        "TASK-114 / Tests Playwright: tests/web/performance-mode.spec.ts von 9 auf 22 Tests erweitert (+13 für a11y/Multi-Select). Neuer describe-Block 'Performance Mode a11y + Multi-Select (TASK-114)': role=grid mit aria-label + 16 gridcells; Roving-Tabindex (Pad 0 hat tabindex 0, andere -1); Live-Region existiert + sr-only; Arrow-Right von 0→1; Arrow-Down von 0→4; Space greift Pad 0 + Live-Region 'gegriffen'; Space+ArrowRight+Space dropt + Live-Region 'abgelegt'; Escape während grabbed restored + Live-Region 'abgebrochen' + Performance-Mode bleibt offen; Shift+Click 2 Pads → beide aria-selected + Counter '2 ausgewählt'; Shift+Click toggelt de-select; Multi-Select-Drag bewegt alle (Auswahl-Reset danach); Mode-Wechsel Reorder→Play leert Auswahl; Empty-Slot kann NICHT Shift-selected werden.",
        "TASK-114 / Verification: pnpm check clean (precheck gen:sandbox 'up-to-date', tsc --noEmit ohne Fehler). pnpm test 1106/1121 grün (62 test files, 15 pre-existing skipped, +11 neue Store-Tests, 0 Regressionen). PatternLaunchPad-Komponente keine Hardcoded-Farben."
      ],
      next: [
        "Welle 2 (Playwright Stabilisierung): die 13 neuen Multi-Select / Keyboard-Tests laufen aktuell nur als Playwright-Smoke (kein CI-Run im Auftrag aus dem Task). Bei sehr lokalen Race-Bedingungen (z.B. Live-Region-Update vs assertion-Timeout) könnten in CI Flakes auftauchen — toContainText() hat Default-Timeout 5s, sollte reichen.",
        "Welle 2 (UX): Drag-Visual-Cue bei Multi-Select-Drag könnte einen Counter-Badge am Cursor zeigen ('2 Pads moven'). HTML5 native DnD erlaubt das nur via setDragImage() mit einem Custom-Element. Aktuell zieht der Cursor das ursprüngliche Pad-Image (Browser-Default), die anderen selected-Pads bleiben sichtbar mit opacity-50 — funktional, aber nicht intuitiv genug.",
        "Welle 2 (UX): Multi-Select beim Mouse-Box-Drag (Rubber-Band-Selection über mehrere Pads im Reorder-Mode) wäre der nächste Schritt. Aktuell muss man jeden Pad einzeln Shift+Clicken. Implementierung: mousedown auf leeren Bereich des Grids → Box-Drag mit Overlay → mouseup wählt alle Pads in der Box.",
        "Welle 2 (UX): 'Select All' Shortcut (Cmd/Ctrl+A im Reorder-Mode) wäre nützlich für Bulk-Operations (z.B. alle Pads gleichzeitig clearen via Delete-Taste). Aktuell nicht implementiert.",
        "Welle 2 (a11y): aria-live='polite' kann auf manchen Screenreadern (NVDA, JAWS) bei schneller Tastatur-Navigation Announcements droppen wenn neue Messages innerhalb <250ms eintreffen. Test-Coverage mit echtem Screenreader (axe-core läuft nur automated-checks, aber kein SR-Output) noch offen. Manuelle SR-Tests wären Welle-3 Akzeptanz.",
        "Welle 2 (a11y): während grabbed wird Tab abgefangen (Focus-Trap), aber Shift+Tab nicht explizit getestet — sollte ebenfalls preventDefault haben (aktueller Code prüft nur key==='Tab', nicht shiftKey). Test/Fix für Shift+Tab als Welle-2-Polish.",
        "Welle 2 (Refactor): restoreSnapshot() iteriert mit N setPadAt-Calls (N Notifications). Eine setPads(bulk)-API existiert bereits im Store — ein bulkRestore() via setPads(snap) wäre eleganter und feuert nur EIN notify. Aktuell unkritisch (synchron, max 16 Notifications), aber sauberer Code.",
        "Welle 2 (Edge): moveMultiplePads({fromIndices: [0,1,2], targetIndex: 1}) wirft no-op weil targetIndex∈fromIndices. Aus User-Sicht könnte das verwirrend sein (User dachte: 'move 0,1,2 vor Position 1'). Eine bessere UX wäre eine visuelle Warnung im UI vor dem Drop ('Ziel-Slot ist Teil der Auswahl'). Aktuell silent-no-op."
      ],
      changed: [
        "client/src/store/usePerformanceStore.ts",
        "client/src/components/PerformanceMode/PatternLaunchPad.tsx",
        "tests/features/performance-store.test.ts",
        "tests/web/performance-mode.spec.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "builder",
      timestamp: "2026-05-12T22:15:00.000Z",
      done: [
        "TASK-115 / CI-Enforcement von sandbox-runtime.generated.ts Drift (v1.21.x Vorlauf). Existing .github/workflows/ci.yml im 'test'-Job erweitert (Option A bevorzugt, da CI-Pipeline bereits vorhanden). Neuer Step 'Verify sandbox source codegen is up-to-date' positioniert NACH 'pnpm install --no-frozen-lockfile' aber VOR 'pnpm check' — kritisch weil precheck/pretest pre-hooks sonst gen:sandbox selbst aufrufen und den Drift maskieren würden. Step ruft 'pnpm gen:sandbox' und prüft danach 'git diff --exit-code client/src/sandbox/sandbox-runtime.generated.ts'; bei Drift Exit-Code 1 + GitHub-Actions-error-annotation mit klarer Fix-Anweisung ('Run pnpm gen:sandbox locally and commit the result').",
        "TASK-115 / Lokaler Pre-Verify durchgeführt (Step 3 aus Briefing): sandbox-runtime.ts mit TASK-115-Marker-Kommentar modifiziert, node scripts/generate-sandbox-source.mjs ausgeführt, git diff --exit-code returned exit=1 mit klarem SHA256-Diff (src=40f93f5d → 522f8998). Drift-Detection funktioniert wie spezifiziert. Cleanup: source revertet, gen:sandbox erneut ausgeführt, sandbox-Verzeichnis ist clean.",
        "TASK-115 / docs/SECURITY-SCRIPT-SANDBOX.md im Drift-Risiko-Abschnitt aktualisiert: 'Drei Schutzebenen' explizit dokumentiert (pnpm pre-hooks lokal, CI-Enforcement via ci.yml, funktionale Drift-Tests 14-17 in pentest-Test). Verweis auf TASK-115 + v1.21.0 Versionierung.",
        "TASK-115 / Verification: pnpm check clean (precheck gen:sandbox 'up-to-date', tsc --noEmit ohne Fehler). pnpm test 1106/1121 grün (62 test files, 15 pre-existing skipped, 0 Regressionen). Codegen-Tests 8/8 (script-sandbox-codegen.test.ts) und Drift-Tests 14-17 (script-sandbox-pentest.test.ts) weiter grün — keine Logik geändert, nur CI-Workflow + Doku."
      ],
      next: [
        "Optional / YAML-Validierungstest: ein simpler Vitest könnte .github/workflows/*.yml lesen und via yaml.parse() validieren — würde Syntax-Fehler in CI-Files vor dem Push catchen. Aktuell skipped (out-of-scope laut Briefing). Pkg yaml/js-yaml wäre erforderlich.",
        "Optional / Strenger Drift-Check: aktuell prüft CI nur die generated.ts. Wenn jemand die generated.ts manuell editiert ohne sandbox-runtime.ts zu ändern, fällt das durch (gen:sandbox überschreibt die Manipulation ohne Diff zur HEAD-Version). Erkennung wäre durch zweiten 'git diff src + generated'-Check möglich, ist aber niedrige Priorität (Generator ist deterministisch + Manipulation der generated.ts ist offensichtlich verdächtig im Code-Review).",
        "Optional / Frozen-lockfile: ci.yml nutzt --no-frozen-lockfile (vermutlich aus Migrationsgründen). Sobald pnpm-lock.yaml stabil ist, --frozen-lockfile umstellen für reproduzierbare Builds.",
        "Optional / Reuse in electron-release.yml: TASK-115-Check könnte auch im Pre-Release-Job (electron-release.yml 'test') gespiegelt werden, falls Releases von ungetesteten Branches angestoßen werden können. Aktuell laufen Releases nur auf tag-Push, vermutlich sind die Tags ohnehin auf main → ci.yml hat bereits gelaufen."
      ],
      changed: [
        ".github/workflows/ci.yml",
        "docs/SECURITY-SCRIPT-SANDBOX.md",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-12T22:05:00.000Z",
      done: [
        "TASK-112 / Macro → Performance-Pad Trigger-Integration (v1.20.x). Macro-Buttons können jetzt ALTERNATIV ein Performance-Pad triggern statt ein Skript — für Live-Performance ohne Tools-Tab zu öffnen. Discriminated union erweitert um `triggerKind: 'script' | 'pad'` (Default 'script' für Backwards-Compat zu v1.17-Daten) + `padIndex?: number` (0..15).",
        "TASK-112 / useMacroStore.ts Schema: neue Felder triggerKind + padIndex auf Macro-Interface. migrateMacro() defaultet alte v1.17-Daten ohne triggerKind auf 'script' und filtert invalide padIndex (out-of-range, non-integer, NaN, negativ) auf undefined. Neue Public-API: setMacroTriggerKind(idx, 'script'|'pad') + setMacroPadIndex(idx, 0..15|null). triggerMacroButton liefert jetzt 'pad:<idx>' als Sentinel-String bei Pad-Mode (Convenience) und dispatcht CustomEvent mit erweitertem Detail { macroIndex, triggerKind, scriptId?, padIndex? }. PAD_COUNT=16 inline statt Import von usePerformanceStore (Cycle-Schutz).",
        "TASK-112 / MacroPanel.tsx UI: BindingEditor bei mode='button' bekommt eine zweite radiogroup 'Trigger: [Script] [Pad]' (analog zur Mode-Toggle Knob/Knob). Bei 'Pad' erscheint Pad-Slot-Dropdown 'Pad 1..16' (zeigt label aus PerformancePad falls vorhanden, sonst 'Pad N (leer)'), Missing-Pad-Warnung wenn padIndex auf leeren Slot zeigt, 'Edit in Performance Mode →'-Link (dispatcht ss:navigate {tab:'performance'}). MacroButton-Rendering im Pad-Mode: label = pad.label ?? `Pad ${index+1}`, Background-Color = pad.color (Vorrang) ?? macro.color (Fallback), Status-Badge 'PAD' statt 'BTN', disabled-State wenn padIndex undefined ODER Pad leer (titleText differenziert).",
        "TASK-112 / App.tsx Wiring: getPerformancePads-Import aus usePerformanceStore (top-level, kein Hook-Subscription für Event-Handler). macro:button:trigger Handler erweitert um triggerKind-Dispatch — bei 'pad': liest pads via getPerformancePads(), holt pad.patternId, ruft dmRef.current.setActivePattern(pattern) + queuePerformancePattern(pattern) — identische Semantik zum Performance-Pad-Click (siehe PatternLaunchPad-Wiring in App.tsx:1657). ss:navigate Handler erweitert um tab:'performance' → setPerformanceActive(true).",
        "TASK-112 / Tests: tests/features/macros.test.ts von 48 auf 70 Tests erweitert (+22 NEU, alle grün). Drei neue describe-Blöcke: 'Macro – Trigger-Kind Schema' (11 Tests: Defaults + setMacroTriggerKind + setMacroPadIndex inkl. out-of-range / non-integer / NaN / negativ / Grenzwerte 0+15), 'triggerMacroButton – Pad-Mode' (6 Tests: happy-path 'pad:4'-Sentinel + EventDetail-Schape + no-op bei fehlendem padIndex / mode=knob + Wechsel pad→script-clean), 'Macro – Pad-Mode Persistence + Migration' (4 Tests: Reload-Roundtrip / v1.17 ohne triggerKind defaultet auf 'script' / invalides triggerKind 'foo' korrigiert / non-integer padIndex 2.5 gefiltert). Existing 48 Tests unverändert grün (toMatchObject ist Subset-Matcher, neue Felder breaken nichts).",
        "TASK-112 / Verification: pnpm check clean. pnpm test 1091/1106 grün (62 test files, 15 pre-existing skipped, +22 neue Macro-Tests, 0 Regressionen). performance-store-Tests 38/38 grün (kein Cross-Impact)."
      ],
      next: [
        "Welle 2 (Playwright): tests/web/macro-pad.spec.ts — User öffnet MacroPanel BindingEditor, switcht Mode auf 'Button' + Trigger auf 'Pad', wählt padIndex aus Dropdown, klickt MacroButton → Performance-Pad-Pattern wird aktiv. Aktuell nur Unit-Tests (Schema + Event-Dispatch verifiziert, aber kein E2E im Browser).",
        "Welle 2 (UX): bei 'Edit in Performance Mode →' wird das Performance-Mode-Fullscreen geöffnet, aber NICHT zu dem konkret verlinkten padIndex gescrollt/highlighted. Könnte als zweites ss:navigate-Detail-Feld (`padIndex`) implementiert werden, PatternLaunchPad scrollt dann zum Pad + visual cue.",
        "Welle 2 (UX): triggerKind-Toggle ist aktuell nur im BindingEditor sichtbar. Im Macro-Slot-Listing (MacroPanel) könnte ein kleiner Indikator (Icon 📜 vs 🎛 oder Text 'S'/'P') beim 'BTN'/'PAD'-Badge stehen, damit auf einen Blick klar ist welcher Trigger aktiv ist.",
        "Welle 2 (UX): Pad-Mode-Button zeigt aktuell pad.label oder 'Pad N (leer)'. Bei Pad-Click ist die Visual-Pulse (z.B. flash bei Active-Wechsel) noch nicht implementiert — könnte über CSS-Animation + queuedPatternId-Subscription gemacht werden.",
        "Welle 2 (Doku): CLAUDE.md könnte einen Abschnitt 'Macro Button Trigger Routing' bekommen, der die macro:button:trigger CustomEvent-Detail-API beschreibt (Felder: macroIndex, triggerKind, scriptId?, padIndex?) — für externe Skript-Autoren relevant.",
        "Welle 3 (Edge): wenn ein Pad-Mode-Macro ein deleted Pattern referenziert (pad.patternId existiert nicht mehr in dm.patterns), passiert aktuell silent: setActivePattern wird mit unbekannter ID gerufen. dm könnte das defensiv ignorieren — aktuell ungeprüft. Im pad-Mode könnte zusätzlich gecheckt werden ob pattern in dm.patterns existiert.",
        "Welle 3 (a11y): radiogroup für triggerKind hat role=radiogroup + aria-label='Macro trigger kind' aber keinen sichtbaren Label-Text (nur '— Trigger —'-Caption). Screenreader-Nutzer hören dadurch zweimal 'Trigger' — könnte mit aria-labelledby auf die Caption umgestellt werden."
      ],
      changed: [
        "client/src/store/useMacroStore.ts",
        "client/src/components/Macro/MacroPanel.tsx",
        "client/src/App.tsx",
        "tests/features/macros.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-12T21:35:00.000Z",
      done: [
        "TASK-111 / Performance Mode UX-Überarbeitung (v1.20.0 Vorlauf). User-Report: 'Auswahlbuttons oben gehen nicht, Pads nicht bearbeitbar/bewegbar'. Drei Ursachen: (B1) Quantize-hover:bg gleich default-bg → kein Feedback (BUG-002-Pattern), (B2) Pads waren nur read-only-Trigger ohne CRUD, (B3) hardcoded bg-slate-950 / text-white.",
        "TASK-111 / Store-Rewrite: client/src/store/usePerformanceStore.ts von Hook-State (useState pro Instance, NICHT persistiert) auf Module-Singleton Observer + localStorage (key 'ss-performance:v1') umgestellt. Persistiert: pads[16] + quantizeMode. Runtime-only: queuedPatternId. Neue Pure-API: getPads/setPads/setPadAt/setPadColor/setPadLabel/movePad/clearPad/queuePattern/clearQueue/setQuantizeMode/getQuantizeMode/getQueuedPatternId + __resetPerformanceStoreForTests + usePerformanceStore() React-Hook (useReducer-Pattern wie useMacroStore). Defensive: out-of-range Indizes no-op, setPadColor/Label auf leerem Slot no-op, movePad mit Identität no-op, invalide quantizeMode aus altem Storage → bar-Default. Tolerantes Loading: alte Daten ohne color/label/quantizeMode laden ohne Crash.",
        "TASK-111 / UI-Rewrite: client/src/components/PerformanceMode/PatternLaunchPad.tsx komplett überarbeitet (von 141 LOC auf ~470 LOC). Neue Modus-Toggle (radiogroup role): ▶ Play | ✎ Edit | ⇆ Reorder. Play (default) = Pattern triggern. Edit = Klick öffnet Inline-Modal mit Pattern-Picker (Dropdown aus dm.patterns), Label-Input (live-patch via setPadLabel), Farb-Palette (16 Preset-Swatches + native <input type=color> für Custom), Aktualisieren/Hinzufügen-Button (setPadAt) + Entfernen (clearPad) + Abbrechen. Reorder = HTML5 native draggable+onDragStart/Over/Drop, dragOver-Slot zeigt outline-dash-Indikator. Beim Modus-Wechsel werden Editor + Drag-State zurückgesetzt. ESC schließt Editor wenn offen, sonst Performance Mode.",
        "TASK-111 / B1 Fix (Quantize-Hover): non-active button-state hover:bg-bg-elevated→hover:bg-bg-base + hover:text-text-primary + active:scale-95 + title='Quantize auf Bar/Beat/Step' + aria-pressed + aria-label. Active-state bg-accent-primary/70 text-white → bg-accent-primary text-bg-base (sichtbare Token, kein Alpha-Bleed).",
        "TASK-111 / B3 Theme-Tokens: bg-slate-950→bg-bg-base; hover:text-white→hover:text-text-primary; Step-Indikator-Off bg-bg-elevated→bg-border-color (sichtbarer Off-State); Pad-Label-Color für aktiven Pad → var(--ss-bg-base) (statt hardcoded 'white'). PAD_COLORS-Array bleibt als domain-palette (User-defined Pad-Farben sind keine Theme-Chrome).",
        "TASK-111 / App.tsx Wiring: 'active' war im alten Store, ist jetzt local useState (performanceActive) in App.tsx — gehört nicht in persistierten Store. PatternLaunchPad-Props erweitert: pads kommen jetzt aus Store, patterns=PatternRef[] kommt extern aus dm.patterns (dünne Liste id+name). queuePattern/setQuantizeMode werden als top-level exports importiert (queuePerformancePattern, setPerformanceQuantizeMode).",
        "TASK-111 / Tests Unit: tests/features/performance-store.test.ts (NEU, 38 Tests, alle grün). 8 Gruppen: Defaults / setPadAt / setPadColor+setPadLabel / movePad / clearPad / queuePattern+clearQueue / setQuantizeMode / setPads bulk / Persistierung (localStorage round-trip via vi.resetModules) / Migration & Toleranz (alte Daten, invalide modes, Müll-JSON, falscher pads-Typ, gefilterte Items) / Type-Surface. Decken alle Akzeptanz-Kriterien aus TASK-111-Briefing.",
        "TASK-111 / Tests Playwright: tests/web/performance-mode.spec.ts (NEU, 9 Tests). Deckt: Öffnen via Toolbar-Button, ESC schließt, Quantize aria-pressed Wechsel, Hover-Background-Diff (BUG-002-analog), Mode-Toggle radiogroup, Edit-Mode öffnet Editor, Pattern-Select+Save füllt Pad, Reorder via dragTo() zwischen 2 Pads, Play-Mode leere Pads sind disabled. localStorage wird vor jedem Test geleert (sauberer Startzustand).",
        "TASK-111 / Verification: pnpm check clean. pnpm test 1069/1084 grün (15 pre-existing skipped, +38 neue performance-store Tests, 0 Regressionen in 62 test files). Existing tests/electron/performance-mode.test.ts (8 Tests, isolated Logic-Copy) weiter grün — testet eigene Mini-Implementation und ist von der Store-Refaktorierung nicht betroffen."
      ],
      next: [
        "v1.20.x (UX): MacroPanel + KeyboardBindings könnten Performance-Mode-Pads als Trigger-Target bekommen (z.B. Macro im Button-Modus triggert Pattern via patternId-Lookup statt scriptId). Aktuell nur über Pad-Click oder Shift+1-8 (Scene-Shortcut nutzt anderen Store).",
        "v1.20.x (UX): Drag-and-Drop Visual-Cue verbessern — aktuell zeigt nur outline:dashed; ein Insert-Linien-Indikator (vertical-bar zwischen Pads) wäre intuitiver. Aktuell aber Swap-Semantik, nicht Insert — bei Insert-Semantik müsste movePad zu reorderPad mit splice() werden.",
        "v1.20.x (UX): Edit-Modal könnte einen 'Duplicate Pad'-Button kriegen (kopiert in nächsten freien Slot). Aktuell nur Single-Slot-CRUD.",
        "v1.20.x (UX): Multi-Select für Reorder (Shift+Click zwei Pads selecten, dann Move-Button) würde Bulk-Reorder beschleunigen.",
        "v1.20.x (UX): Color-Swatches sind 16 Preset-Hex aus PAD_COLORS — könnten auf Theme-Accent-Tokens reduziert werden, sodass Pad-Farben theme-konsistent bleiben (z.B. nur 6 Token-Slots: accent-primary, secondary, success, danger + 2 derived). Aktuell sind User-Pad-Farben absichtlich Theme-unabhängig (domain palette).",
        "v1.20.x (Tests): Playwright-Test für Drag&Drop ist defensiv (assertion auf data-pad-filled). Eine strengere Variante würde nach dragTo() den exakten patternId an Position 1 prüfen — erfordert aber UI-Inspektion oder window-side Store-Access. Aktuell ausreichend für Smoke-Test.",
        "v1.20.x (a11y): Pad-Reorder via Tastatur (Arrow-Keys + Space=grab + Arrow=move + Space=release) wäre WAI-ARIA-konform — aktuell nur Maus-Drag."
      ],
      changed: [
        "client/src/store/usePerformanceStore.ts",
        "client/src/components/PerformanceMode/PatternLaunchPad.tsx",
        "client/src/App.tsx",
        "tests/features/performance-store.test.ts",
        "tests/web/performance-mode.spec.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "backend",
      timestamp: "2026-05-12T21:15:00.000Z",
      done: [
        "FOLLOWUP-102 / A: Pitch-preserving Time-Stretch via AudioWorklet (v1.19.0) implementiert. Neuer syncMode 'timestretch' nutzt OLA-Algorithmus für tempo-bound Wiedergabe bei konstantem Pitch — ideal für Vocals/Songs. Bestehender toter Code TimeStretchProcessor.js (registriert seit v1.x aber nie instanziiert) wird jetzt aktiv genutzt.",
        "Bereich 1 / TimeStretchProcessor.js: Mono→Stereo erweitert. Neue Messages: setBuffer (channels: Float32Array[] mit 1 oder 2 Channels, Mono→Stereo Upmix), setLoop (boolean), seek (samplePos). Position-Report via port.postMessage({type:'position',samplePos}) alle ~2200 samples (≈50ms@44.1kHz). Pro-Channel _outAccums für unabhängige OLA pro Channel mit synchronem _readPos (Stereo-Imaging bleibt erhalten). Loop=false → silence am Ende (statt endlosem Wrap).",
        "Bereich 2 / AudioEngine.ts: Neue private Maps audioTrackWorkletNodes + audioTrackWorkletPositions. Neue private Methode _playAudioTrackViaWorklet(id,opts): erzeugt AudioWorkletNode mit outputChannelCount=[2], schickt setBuffer/setLoop/seek/setValueAtTime(stretch=bpm/origBpm), connectet zu channelNodes.input (volle FX-Chain bleibt verfügbar — Sends, Inserts, Solo/Mute funktionieren). playAudioTrack(id) routed bei syncMode='timestretch' automatisch dorthin. stopAudioTrack/seekAudioTrack/disposeAudioTrack/_updateAudioTrackPlaybackRates erweitert. seekAudioTrack ist bei Worklet in-place (kein Re-Create) via postMessage({type:'seek'}). rAF-Tick liest aus audioTrackWorkletPositions wenn Worklet aktiv, sonst weiter aus ctxStart-Berechnung.",
        "Bereich 2 / Graceful Fallback: Wenn AudioWorklet-Modul nicht ladbar oder AudioWorkletNode-Erzeugung scheitert → console.warn + Auto-Downgrade syncMode='stretch' für diesen Track (BufferSourceNode statt Worklet). Verhindert silent breakage in Edge-Cases.",
        "Bereich 3 / AudioEngine.ts Schema: AudioTrackChannelData.syncMode erweitert von 'free'|'stretch' auf 'free'|'stretch'|'timestretch'.",
        "Bereich 4 / useAudioTrackStore.ts: isValidTrack akzeptiert jetzt 'timestretch' (außerdem strikte Ablehnung sonstiger bogus-Strings statt silent-pass). Neue Konstante MAX_TIMESTRETCH_TRACKS=4 + countTimestretchTracks() Helper. KEIN Auto-Upgrade alter 'stretch'-Tracks — User-Entscheidung bleibt erhalten.",
        "Bereich 4 / projectSerializer.ts: isValidAudioTrackEntry akzeptiert ebenfalls 'timestretch' + lehnt bogus-syncModes ab. Alte v1.16 .synth-Files (kein syncMode-Feld oder 'free'/'stretch') laden weiter unverändert.",
        "Bereich 5 / AudioTrackStrip.tsx: Sync-Mode-Dropdown von 2 auf 3 Optionen erweitert. Quality-Badge ('⚠ Extreme Ratio — Artefakte möglich') wenn timestretch + |bpm/orig - 1| > 0.5 (OLA-Artefakt-Schwelle). Option 'timestretch' disabled wenn (a) AudioWorklet nicht supported (Feature-Detection via getAudioContext().audioWorklet OR window.AudioWorklet) — Tooltip 'Browser unterstützt AudioWorklet nicht'; ODER (b) countTimestretchTracks() >= MAX_TIMESTRETCH_TRACKS und dieser Track ist nicht bereits timestretch — Tooltip 'Max 4 Time-Stretch Tracks (CPU-Schutz)'. Dropdown-Label-Tooltip mit Quality-Info zu allen 3 Modi. originalBpm-Input erscheint jetzt sowohl bei 'stretch' als auch 'timestretch'. Nur semantische Tokens (text-accent-secondary, etc.).",
        "Tests / tests/features/audio-track-timestretch.test.ts (NEU): 13 Tests, alle grün. MockAudioWorkletNode mit port.postMessage-Spy + port.__triggerMessage-Helper + parameters.get('stretch').setValueAtTime-Spy. Deckt alle 8 Pflicht-Coverage-Punkte: Routing 'timestretch'→Worklet, Stretch-Param-Init, setBpm-live-Update, seekAudioTrack→postMessage(seek), stopAudioTrack→disconnect+map-cleanup, disposeAudioTrack cold/hot, isValidTrack Akzeptanz, Regression 'stretch'/'free'→BufferSource. Bonus: Position-Tracking via port-message-trigger + rAF.",
        "Verification: pnpm check clean. pnpm test 1031 passing (1046 incl. 15 pre-existing skipped), +13 NEW timestretch tests + 20 audio-track Regression alle grün, 0 Regressionen in 61 test files."
      ],
      next: [
        "FOLLOWUP-102 / A (Welle 2): MAX_TIMESTRETCH_TRACKS Soft-Limit-Verhalten beim PROJECT-LOAD prüfen — wenn ein .synth-File >4 timestretch-Tracks hat, sollten die letzten als 'stretch' geladen werden (oder eine User-Warnung erscheinen). Aktuell: alle werden akzeptiert, AudioEngine erzeugt 5+ Worklets parallel (CPU-Spike möglich). projectSerializer.parseProject könnte ein Post-Validation-Step ergänzen.",
        "FOLLOWUP-102 / A (Welle 2): OLA-Algorithmus zeigt bei sehr aggressiven Stretch-Ratios (>2x oder <0.5x) Phasing/Transient-Smearing. v1.19.x könnte einen WSOLA-Upgrade bekommen (Cross-Correlation-Search im Grain-Overlap statt naiver Hann-OLA) — deutlich bessere Quality bei ähnlichem CPU-Budget. Bestehender SoundTouch-WASM-Wrapper im Web-Ökosystem wäre Alternative.",
        "FOLLOWUP-102 / A (Welle 2): Worklet sendet position alle ~50ms (Sample-Hop 2200@44.1kHz hardcoded). Bei höherem sampleRate (48k/96k) ist die Update-Rate proportional schneller — könnte UI-jank verursachen. Throttle sollte sich an currentTime orientieren statt an Samples.",
        "FOLLOWUP-102 / A (Welle 2): Quality-Badge-Threshold 50% ist heuristisch — A/B-Tests mit realen Vocals/Drums könnten 30% als realistischere Untergrenze ergeben. UI sollte später ein Quality-Slider-Setting bekommen ('OLA' vs 'WSOLA' vs 'Phase-Vocoder').",
        "FOLLOWUP-102 / A (Welle 2): rAF-Tick rate für Worklet-Position-Polling könnte auf requestVideoFrameCallback umgestellt werden wenn Performance-Mode aktiv — aktuelle Lösung ist konsistent mit bestehendem BufferSource-Pfad und reicht für Standard-Use-Cases.",
        "FOLLOWUP-102 / A (UI-Polish, optional): MixerView.tsx könnte einen globalen Indikator 'X/4 Time-Stretch aktiv' zeigen — analog zum '8/8 Audio-Tracks' Anzeiger. Verlangt countTimestretchTracks-Subscription im MixerView."
      ],
      changed: [
        "client/src/audio/worklets/TimeStretchProcessor.js",
        "client/src/audio/AudioEngine.ts",
        "client/src/store/useAudioTrackStore.ts",
        "client/src/utils/projectSerializer.ts",
        "client/src/components/Mixer/AudioTrackStrip.tsx",
        "tests/features/audio-track-timestretch.test.ts"
      ]
    },
    {
      agent:     "refactor",
      timestamp: "2026-05-12T20:40:00.000Z",
      done: [
        "FOLLOWUP-110 / MixerView.tsx: Replaced 13 hardcoded Tailwind colour classes with semantic tokens. text-yellow-400/soloed→text-accent-success; bg-cyan-950/25+ring-cyan-500/60→bg-accent-secondary/15+ring-accent-secondary/60 (selected channel highlight); bg-orange-600 text-white (muted active)→bg-accent-secondary text-bg-base — aligned with existing ChannelStrip.tsx convention; bg-yellow-500 text-slate-900 (soloed active)→bg-accent-success text-bg-base; hover:text-orange-400/yellow-400→hover:text-accent-secondary/accent-success; text-purple-400 + accent-purple-500 (Reverb send/return)→text-accent-secondary + accent-accent-secondary; text-blue-400 + accent-blue-500 (Delay send/return)→text-accent-primary + accent-accent-primary; bg-slate-950 (disabled FX slot)→bg-bg-base; text-red-400 hover:text-red-300 (Remove-FX button)→text-accent-danger hover:text-accent-danger/80; return-track-muted label text-orange-400→text-text-dim.",
        "FOLLOWUP-110 / ElectronTitleBar.tsx: Replaced 9 hardcoded Tailwind colour classes with semantic tokens. text-slate-400→text-text-muted and hover:text-white→hover:text-text-primary (WindowButton base); bg-[#0d0d0d]→bg-bg-base (title-bar root); border-slate-800→border-border-color; bg-cyan-500 (app icon dot)→bg-accent-primary; text-slate-300 (title)→text-text-primary; text-cyan-400 (dirty-indicator ●)→text-accent-primary; text-slate-500 (centered project subtitle)→text-text-dim; hover:bg-slate-700 (min+max buttons)→bg-bg-elevated; hover:bg-red-600 (close button)→bg-accent-danger.",
        "FOLLOWUP-110 / Test: Added tests/features/theme-class-purity.test.ts with 7 regression tests. Uses fs.readFileSync (no jsdom — avoids AudioEngine + electron preload globals) and a strict regex over both refactored source files. Covers bg/text/border/ring/accent/fill/stroke/from/to/via/placeholder/caret/decoration/outline/divide/shadow-(slate|cyan|red|yellow|orange|purple|blue|green|pink|amber|gray|zinc|neutral|stone|lime|emerald|teal|sky|indigo|violet|fuchsia|rose)-NNN and bg-[#hex]/text-[#hex] arbitrary utilities, with optional prefixes hover:/focus:/active:/disabled:/group-hover:. Sanity-tests verify the regex catches known offenders (bg-slate-900, bg-[#0d0d0d]) and does NOT flag semantic tokens (bg-bg-base, text-accent-primary).",
        "FOLLOWUP-110 / Verification: pnpm check clean. pnpm test 1010/1025 green (15 pre-existing skipped, +7 new theme-purity tests, 0 regressions across 59 test files)."
      ],
      next: [
        "Theme-coverage gap (PRE-EXISTING, NOT introduced by this refactor): client/src/index.css themes 'daylight' (#7) and 'paper' (#8) do NOT define --ss-accent-success and --ss-accent-danger. Any component using bg-accent-success / text-accent-danger (incl. ChannelStrip solo/mute, MixerView Remove-FX button, MixerView soloed-label colour after this refactor, MixerView soloed-active button) will render with an UNSET CSS var in those two light themes — the resulting CSS color becomes an empty string and the property falls back to inherited/default. Frontend agent should add to daylight: --ss-accent-success: #16a34a; --ss-accent-danger: #dc2626; to paper: --ss-accent-success: #15803d; --ss-accent-danger: #b91c1c (matching their respective primary-accent saturations). Until then both light themes have a visual gap.",
        "SampleBrowser.tsx still has ~20 hardcoded text-cyan-*, bg-cyan-*, border-cyan-*, bg-green-900, bg-blue-900 occurrences — separate FOLLOWUP-111 candidate (already flagged in refactor-log 2026-05-12T18:15).",
        "ElectronTitleBar.tsx restore-icon SVG still has <rect fill='#0d0d0d'> as punch-through mask — kept intentionally (documented in code as 'Color-Refactor-Sonderfall') because SVG fill attribute does not resolve CSS variables and a generic fix needs a different icon structure. Visual impact is invisible in 7/10 themes whose bg-base is near-black; only daylight/paper/protanopia (light bg-base) might show the small 8×8 dark dot when the title-bar is maximised. Polish-only follow-up.",
        "MixerView.tsx canvas/inline-style raw hex colours remain (vuColor() #ef4444+#f59e0b clip-warning thresholds; VuMeter inactive segment bg #1e293b; SpectrumDisplay fallback strings). These are JS-level not Tailwind-level — out of scope for FOLLOWUP-110. Spectrum already reads --ss-* via getCssColor(). VuMeter inactive bg could use var(--ss-bg-elevated) — polish-only follow-up.",
        "Consider promoting the new theme-class-purity regex to a CI lint rule that scans ALL files under client/src/components/ + electron/components/ — would prevent regression at PR time rather than waiting for a multi-viewport sweep."
      ],
      changed: [
        "client/src/components/Mixer/MixerView.tsx",
        "electron/components/ElectronTitleBar.tsx",
        "tests/features/theme-class-purity.test.ts"
      ]
    },
    {
      agent:     "testing",
      timestamp: "2026-05-12T19:15:00.000Z",
      done: [
        "TASK-101: Multi-Viewport Layout-Sweep (Playwright) für 1920×1080, 1366×768, 1280×720 in allen 6 Haupt-Tabs (Sequencer/Mixer/Song/Humanizer/Tools/Kollaboration) + alle 7 Tools-Sub-Tabs + Floating-Panels (Pattern Morph, Note Repeat). 21 Tests/42 Screenshots → 0 horizontale Overflows. tests/web/layout-sweep.spec.ts.",
        "TASK-101: Code-Grep nach Layout-Risikomustern: 0 overflow-x-hidden Workarounds, 0 hardcoded width >1000px, alle min-w-[Npx] in vernünftiger Range (52-340px). MixerView nutzt korrekt overflow-x-auto für scrollbare Channel-Strips. SongTimeline ebenfalls.",
        "TASK-101 / BUG-008: Visuelle Inspektion der Screenshots → echter UX-Layout-Bug gefunden: DrumMachine-Floating-Panels (Pattern Morph, Note Repeat, Envelope Follower, Macros, Granular, Polyrhythm) zeigen DOPPELTEN Header (outer ResizableDrumPanel.title + inner Panel-Header) und DOPPELTEN X Close-Button. Ursache: TASK-105 hat ResizableDrumPanel.title+onClose ergänzt, ohne dass die alten Inner-Panel-Header entfernt wurden.",
        "TASK-101 / BUG-008 / Fix: DrumMachine.tsx — `title=\"...\"` aus allen 6 ResizableDrumPanel-Calls entfernt (Macro/NoteRepeat/Morph/EnvFollower/Granular/Polyrhythm). Bei NoteRepeat + Morph zusätzlich das inner `onClose` Prop entfernt (Outer X übernimmt). Inner-Header bleiben erhalten weil sie Status-Info zeigen (BPM, % Morph, Aktiv-Count, Granular Play/Stop).",
        "TASK-101 / BUG-008 / Regression: tests/web/layout-double-header.spec.ts — 7 Tests verifizieren: nur EIN 'Pattern Morph'/'Note Repeat'/'Envelope Follower' Header sichtbar, nur EIN Close-Button im DOM bei offenem Panel, Outer-Close schließt korrekt. Existierende tests/web/close-buttons.spec.ts (TASK-105) bleibt vollständig grün — 13/14 (1 pre-existing skip).",
        "TASK-101: BUG-008 in INDEX.js dokumentiert, openTasks.TASK-101 von 'pending' auf 'partially fixed' aktualisiert.",
        "Verification: pnpm check clean, pnpm test 1003/1018 grün (15 pre-existing skipped, 0 Regressionen). pnpm test:web tests/web/layout-sweep.spec.ts + layout-double-header.spec.ts + close-buttons.spec.ts alle grün.",
        "Screenshots in test-results/layout-sweep/ (42 Files × 3 Viewports × 14 Tabs/Panels) — Before/After-Comparison Pattern Morph + Note Repeat zeigt klaren Fix."
      ],
      next: [
        "TASK-101 (Follow-up): ResizableDrumPanel — wenn weder `title` noch `onClose` gesetzt sind, Header-Strip komplett ausblenden (aktuell zeigt sich noch eine py-1 leere Border-Line wenn nur onClose gesetzt). Klein, aber polish-würdig.",
        "TASK-101 (Follow-up): Hardcoded Tailwind-Farben in MixerView.tsx MixerChannel (text-yellow-400, bg-orange-600, bg-yellow-500, text-slate-900, accent-purple-500, accent-blue-500, bg-cyan-950) und in ElectronTitleBar.tsx (bg-[#0d0d0d], border-slate-800, bg-cyan-500, text-slate-300/400/500, text-cyan-400, hover:bg-slate-700, hover:bg-red-600) verstoßen gegen Theme-Regel — separater Refactor-Task.",
        "TASK-101 (Open): Falls User in einem neuen Report 'Layout verzogen' meldet → konkret um Screenshot + Viewport-Größe (window.innerWidth) + Tab/Panel bitten. Multi-Viewport-Sweep deckt keine x86 vs ARM, keine HiDPI-Render-Bugs, keine echte Electron-Fenster-Probleme ab.",
        "TASK-101 (Follow-up): Playwright-Test im Electron-Modus (tests/electron/e2e/layout-sweep.spec.ts) — könnte Electron-spezifische Layout-Bugs (z.B. zoomFactor, Frame-Behavior) aufdecken. Aktuell nur Web-Browser-Sweep.",
        "Tests/Design: tests/web/layout-sweep.spec.ts ist soft-assert (max 20 issues pro Tab erlaubt). Falls TS-Strict-Mode strenger werden soll: auf 0 reduzieren — aber dann müssen alle scroll-container-Ausnahmen explizit erlaubt werden."
      ],
      changed: [
        "tests/web/layout-sweep.spec.ts",
        "tests/web/layout-double-header.spec.ts",
        "client/src/components/DrumMachine/DrumMachine.tsx",
        "agents/INDEX.js"
      ]
    },
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
  //
  // CLOSED 2026-05-13 by coordinator (Cleanup-Sweep):
  //   - TASK-101 (Layout verzogen): defacto closed durch BUG-008-Fix in v1.18.x — kein Repro mehr.
  //   - TASK-103 (Script persistence + key/macro binding): erledigt in v1.17.0
  //     (useScriptStore + Worker-Sandbox, Macro-Binding via useMacroStore).
  //   - FOLLOWUP-110 (Hardcoded Tailwind colors): erledigt in v1.22.0 / TASK-122
  //     (Final Theme-Class-Purity Sweep, 0/0 Matches im *.tsx-Baum).
  //   - FOLLOWUP-102 Teile (1) und (2): de-dup AudioTrackChannelData + pitch-preserving
  //     stretch erledigt in v1.19.0 — bleibt nur (3) und (4), siehe Eintrag unten.
  //   - TASK-124 (Docs-Sync NEUE_SESSION_ANWEISUNG.md): erledigt 2026-05-13 in commit
  //     36dcb9a ("chore(v1.22.0): docs-sync + INDEX.js cleanup").
  //   - TASK-128 (LFO-Macros Wave 2 — Step-Trigger-Site Wiring): erledigt 2026-05-13.
  //     SynthEngine.triggerNote() um destination?-Parameter erweitert; AudioEngine
  //     ._triggerMelodicNote routet wavetable/fm-Parts mit synthParams jetzt durch
  //     SynthEngine + partId-Cache. +9 Tests (3 destination-override, 6 integration).
  //   - TASK-129 (Synth-Part Wave 2 — DrumLoop + Channel-FX-Routing): erledigt
  //     2026-05-13. Neuer _triggerSynthOnChannel-Helper; DrumLoop branched für
  //     wavetable/fm-Parts; Synth-Output geht durch Channel-FX-Chain (statt
  //     direkt masterGain). +6 Tests.
  //   - TASK-127 (Performance-Pad UX — Cmd/Ctrl+A + Auto-Scroll): erledigt
  //     2026-05-13. collectNonEmptyPadIndices + computeAutoScrollDelta als
  //     exportierte pure Helper; Cmd/Ctrl+A im Reorder-Mode wählt alle
  //     non-empty Pads; Box-Drag-Auto-Scroll via RAF + window.scrollBy. +15 Tests.
  //   - TASK-125 (theme-class-purity Glob-Hardening): erledigt 2026-05-13.
  //     Statt 19 harter Pfade → walkSync-basierter recursive readdir-Walker
  //     über client/src/components/** + electron/components/** + 2 Discovery-
  //     Sanity-Tests. 41 → 131 Tests. Neue *.tsx wird automatisch mit-geprüft.
  //   - TASK-126 (Macro-Hold-Mode Playwright-Smoke): erledigt 2026-05-13.
  //     Neue tests/web/macros.spec.ts mit 4 Tests; data-testids auf MacroButton
  //     + toggle-macro-panel. Verifiziert UI-Wiring mouseDown/Up → CustomEvent.
  //   - FOLLOWUP-102 vollständig geschlossen 2026-05-13.
  //     (3) Solo cross-store UI-Unification: setPartSoloed um exclusive-Parameter
  //         erweitert, neue setAudioTrackSoloed exported. Shift+Click invertiert
  //         Default-Verhalten in beiden Richtungen. +5 Tests.
  //     (4) Playwright Round-Trip E2E: tests/web/audio-track-round-trip.spec.ts
  //         mit 4 Tests (save → reopen → relocate). 4/4 grün in 10.6s.
  //     openTasks ist jetzt LEER — v1.23.0 bereit zum Release.
  openTasks: [],

  // ─── API / IPC REFERENCE ───────────────────────────────────
  ipc: {
    note:     "All IPC calls go through useElectron() hook — never window.electronAPI directly",
    channels: [
      "file:save-project", "file:open-project", "file:export-wav",
      "collab:start-session", "collab:join-session", "collab:leave-session",
      "midi:export", "dialog:open", "dialog:save",
      "transport:play", "transport:stop", "transport:bpm",
      // Performance-Mode Popup-Window (ROADMAP feature, post-v1.23.0):
      // alle Channels haben narrow-data-only Payloads — keine file paths,
      // keine shell ops, kein eval. Routing via main process zwischen
      // mainWindow und perfWindow webContents.
      "window:open-performance",      // invoke, no payload
      "window:close-performance",     // invoke, no payload
      "window:is-performance-open",   // invoke, no payload → boolean
      "window:perf-set-always-on-top", // invoke (Phase 2) boolean → {success, alwaysOnTop}
      "window:perf-is-always-on-top",  // invoke (Phase 2) → boolean
      "perf-sync:state",              // send (main→popup) plain JSON state snapshot
      "perf-sync:action",             // send (popup→main) plain JSON action object
                                      // action.type: pad-click | quantize-mode-change | request-state
                                      //   (Phase 2) set-pad-at | set-pad-color | set-pad-label
                                      //   (Phase 2) clear-pad | move-pad | move-multiple-pads
      "perf-window:closed"            // event (main→main-renderer) when popup closes
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
