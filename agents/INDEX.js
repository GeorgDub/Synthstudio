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
    version: "1.15.1",
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
    "KI-Generator":      { store: null,                      tab: "Tools",             status: "⚠️ requires API key" }
  },

  // ─── KNOWN BUGS ────────────────────────────────────────────
  // Update when bugs are found or fixed. Never delete — mark fixed: true.
  bugs: {
    "BUG-001": {
      title:   "Space key stops playback only when focus is not on step grid",
      severity: "low",
      details:  "When a step cell or text field has focus, Space toggles that step instead of transport. Click neutral area first.",
      fixed:    false,
      foundBy:  "testing"
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
      fixed:    false,
      foundBy:  "testing"
    },
    "BUG-004": {
      title:   "KI-Generator hangs indefinitely on 'Generiere...'",
      severity: "high",
      details:  "KI-Generator stuck in loading state. Likely requires API key or network access that is not configured.",
      fixed:    false,
      foundBy:  "testing"
    }
  },

  // ─── AGENT WORK LOG ────────────────────────────────────────
  // Each agent appends an entry here after completing work.
  // Format: { agent, timestamp, done[], next[], changed[] }
  workLog: [],

  // ─── CURRENT OPEN TASKS ────────────────────────────────────
  // High-level tasks visible to all agents. Coordinator manages this.
  openTasks: [],

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
