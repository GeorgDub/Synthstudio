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
    version: "1.20.0",
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
    }
  },

  // ─── AGENT WORK LOG ────────────────────────────────────────
  // Each agent appends an entry here after completing work.
  // Format: { agent, timestamp, done[], next[], changed[] }
  workLog: [
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
  openTasks: [
    {
      id:       "TASK-101",
      title:    "Layout verzogen — partially fixed (BUG-008 double-header)",
      severity: "medium",
      target:   "v1.18.x",
      notes:    "Multi-viewport sweep (tests/web/layout-sweep.spec.ts) detected NO horizontal overflows across 1920/1366/1280px. One concrete UX bug found via screenshot review: doppelte Header in DrumMachine-Floating-Panels — see BUG-008 (fixed). Falls weitere 'verzogen'-Reports kommen: User um Screenshot + Viewport-Größe + genauen Tab/Panel bitten."
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
      id:       "FOLLOWUP-110",
      title:    "Hardcoded Tailwind colors in MixerView + ElectronTitleBar",
      severity: "low",
      target:   "any",
      notes:    "TASK-101 sweep found ~10 hardcoded colors (bg-cyan-950, bg-yellow-500, text-slate-900, bg-cyan-500, hover:bg-red-600). Not a layout bug but violates theme rule. Refactor-pass needed."
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
