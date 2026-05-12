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
    version: "1.16.0",
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
    "Script Runner":     { store: null,                      tab: "F5 (Tools)",        status: "stable" },
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
