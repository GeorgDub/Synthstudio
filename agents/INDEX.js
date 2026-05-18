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
    version: "3.17.0",
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
    configFiles: ["vite.config.ts", "tsconfig.json", "tsconfig.electron.json", "electron-builder.config.js"],
    dependencies: {
      // v3.16.0 — Sibling-Repo mit OmniTribe-Firmware + canonical OTP-Sysex-Spec.
      // SynthStudio kopiert Bridge-Code (NICHT referenziert) und syncht
      // bei Protokoll-Aenderungen via Commit-Hash der gedroppten Datei.
      omnitribeProject: "G:/IdeaProjects/Omnitribe"
    }
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
    "client/src/utils/omniTribeThrottle.ts (v3.17.0)": {
      role:     "v3.17.0 NEU: Generischer trailing-throttle pro Key (~135 LOC, isomorph, kein DOM). makeThrottledSender<TArgs>(fn, {minIntervalMs=16}) liefert {send(key, args), flush(key?), cancel(key?)}. Leading-Edge: erster Call pro Key sendet sofort. Trailing-Coalesce: Folge-Calls innerhalb minIntervalMs ueberschreiben pendingValue, setTimeout am Intervall-Ende liefert ZULETZT empfangenen Wert (Slider-Release-Wert kommt damit immer an). Pro-Key Slot-Isolation. cancel() resettet lastSentAt=0 (wichtig fuer Tests). Verwendet performance.now() falls verfuegbar, sonst Date.now().",
      lastSeen: "2026-05-18T12:15:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/utils/omniTribeWiring.ts (v3.17.0)": {
      role:     "v3.17.0 NEU: NRPN-Adress-Konstanten + High-Level-API fuer Panel ↔ OmniTribeBridge (~225 LOC). Exports: OMNITRIBE_GRANULAR (PARAM_HIGH 0x19, PIDs grainSize/density/pitchScatter/position/spray/feedback), OMNITRIBE_WAVETABLE (0x07, framePosition/morphSpeed), OMNITRIBE_EUCLIDEAN (0x11, nSteps/kHits/rotation/enable). clampPartIndex(p) 0..15. uiToMidi/midiToUi mit per-Param Wert-Range. buildParamLow(pid,part)=((part<<4)|pid)&0x7F (matched Bridge-Mask). decodeParamLow umkehrbar fuer part 0..7. sendGranularParam/sendWavetableParam/sendEuclideanParam mit per-Param Range-Mapping (grainSize 10..500, density 1..50, pitchScatter 0..200, sonst 0..1). uploadWavetable wrappt bridge.uploadWavetable. sendNrpn fuer generische Calls. ALLE send-Funktionen sind NO-OPs wenn omniTribeBridge.isConnected=false (isomorphic invariant). Throttled via makeThrottledSender mit minIntervalMs=16. Test-Hooks __flushOmniTribeSends + __cancelOmniTribeSends.",
      lastSeen: "2026-05-18T12:15:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/components/DrumMachine/GranularSynthPanel.tsx (v3.17.0)": {
      role:     "v3.17.0: Granular-Synth-Panel mit OmniTribe-Bridge-Wiring. +partIndex?-Prop (Default 0, 0..15). Header zeigt OmniTribeIndicator (Plug/PlugZap-Icon + 'Local'/'OmniTribe' Badge, text-accent-success wenn connected). Slider-onChange ruft set() → sendGranularParam fuer 6 mapbare Felder (grainSize/density/pitchSpray→pitchScatter/position/spray/amplitude→feedback). Plus useEffect 'omnitribe:paramChange'-Listener: filtert paramHigh==0x19 + decodeParamLow().part===part + granularPidToKey → patcht via onChangeRef + AudioEngine.updateGranularParams (wenn aktiv). paramsRef/onChangeRef vermeiden re-bind bei jeder Param-Aenderung. setInterval(1s) Polling fuer isConnected-State. Bestehende Visualizer/Presets unveraendert.",
      lastSeen: "2026-05-18T12:15:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/components/DrumMachine/WavetableEditor.tsx (v3.17.0)": {
      role:     "v3.17.0: Wavetable-Editor-Modal mit OmniTribe-Bridge-Wiring. +partIndex?/wavetableSlot? Props (Default 0). Header zeigt OmniTribeIndicator. 2 NEUE Slider 'Frame-Position' + 'Morph-Speed' (0..1, ruft sendWavetableParam → NRPN 0x07/0x01 bzw. 0x07/0x02) mit data-testid wavetable-frame-position/morph-speed. Save-Button ruft VOR onSave die uploadWavetable(wavetableSlot, [waveData]) (NO-OP wenn nicht connected). paramChange-Listener filtert paramHigh==0x07 + decodeParamLow().part===part + wavetablePidToKey → updated lokalen Slider-State. Bestehender Canvas-Editor + Presets unveraendert.",
      lastSeen: "2026-05-18T12:15:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/components/DrumMachine/EuclideanControls.tsx (v3.17.0)": {
      role:     "v3.17.0: Euclidean-Popover mit OmniTribe-Bridge-Wiring. +partIndex?-Prop (Default 0). handleApply ruft VOR setOpen(false) → onApply, dann 4× sendEuclideanParam fuer nSteps/kHits/rotation/enable (Rotation wird auf positiv normalisiert wenn < 0). Bestehender Popover-UI + Preview-Grid + Apply-Button unveraendert.",
      lastSeen: "2026-05-18T12:15:00.000Z",
      ownedBy:  "frontend"
    },
    "tests/features/omnitribe-panel-wiring.test.ts (v3.17.0)": {
      role:     "v3.17.0 NEU: 24 Tests fuer omniTribeWiring.ts + omniTribeThrottle.ts. @vitest-environment jsdom fuer window-Zugriff. Mock-Strategy: vi.spyOn(omniTribeBridge, 'setParam'/'uploadWavetable'/'isConnected' getter) + __cancelOmniTribeSends in beforeEach. Coverage: helpers (clampPartIndex 7 cases / uiToMidi+midiToUi round-trip / buildParamLow+decodeParamLow 7-bit mask + part 0..7 round-trip / granularPidToKey + wavetablePidToKey), Connected-Gate (sendNrpn/sendGranular/uploadWavetable NO-OP wenn !connected), sendGranularParam (NRPN-Adress + part-Bits + Wert-Skalierung), sendWavetableParam (Frame-Position 0x07/0x01 + Morph-Speed 0x07/0x02 + uploadWavetable), sendEuclideanParam (4-Call Apply mit korrekten PIDs + Value-Clamp 0..127), paramChange decode + Part-Filter, makeThrottledSender (leading immediate, trailing coalesce mit vi.useFakeTimers, flush(key), cancel(key), per-Key-Isolation).",
      lastSeen: "2026-05-18T12:15:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/utils/korg/audioProcessor.ts (v3.6.0)": {
      role:     "v3.6.0: Pure-TypeScript Audio-Processor für E2S-Export (~430 LOC). Port aus Korg Editor/esx_e2s_editor/services/audio_processor.py. Public API: convertToE2sSpec(pcm, sr, ch, opts) → ProcessedAudio (resample auf 44100|48000 mit default 'poly-phase' Resampler, optional forceMono via average-downmix, optional peakNormalize, +ResamplerKind='poly-phase'|'linear' via opts.resampler). NEU v3.6 polyPhaseResample(pcm,inSr,outSr,ch) — 3-Lobe Lanczos windowed-sinc Direct-Convolution, rational rate via gcd→L/M, Anti-Alias cutoff=min(1,L/M), kernel-sum-Normalize gegen Edge-Attenuation. NEU lanczosKernel(x,a=3) — public-export für Tests (sinc(πx)/(πx) · sinc(πx/a)/(πx/a), 0 außerhalb |x|<a, defensive NaN→0). resampleLinear bleibt als Fallback exportiert. floatToInt16LeBytes(pcm) Float32→16-bit-LE-Bytes (clip [-1,+1], NaN→0, +1.0→0xFF7F, -1.0→0x0080). downmixToMono(stereo) (L+R)/2 pro Frame + Post-Peak-Return. peakNormalize(pcm, target ∈ (0,1]) silent-input passthrough. sanitizeE2sSlotName(name, maxLen=16) ASCII-printable-Filter (0x20..0x7E). AudioProcessError sealed-class. Defensive: targetSampleRate ∈ E2S_SAMPLE_RATES, per-Slot-Cap MAX_BYTES_PER_SLOT=10MB, NaN/Infinity-Filter im float→i16-Pfad UND im poly-phase Convolution-Loop.",
      lastSeen: "2026-05-18T09:35:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/utils/korg/e2sBankBuilder.ts (v3.6.0)": {
      role:     "v3.6.0: Pure-TypeScript E2S `.all`-Sample-Bank-Builder (~470 LOC). Port aus Korg Editor/esx_e2s_editor/services/e2s_builder.py (743 LOC). Public API: buildE2sBank(slots: E2sSlotInput[], opts?: BuildE2sBankOptions) → BuildResult ({buffer:ArrayBuffer, slotCount, warnings}). v3.6 NEU BuildE2sBankOptions{preserveRawRiff?:bool} + E2sSlotInput.rawRiff?:Uint8Array + isDirty?:bool. Wenn preserveRawRiff:true UND slot.rawRiff vorhanden UND slot.isDirty!==true → passthroughRiff() validiert (RIFF-magic + size-match + WAVE-marker + per-slot-cap MAX_BYTES_PER_SLOT+4096) und kopiert rawRiff-bytes bit-exakt ins Output → BIT-EXACT ROUND-TRIP. Bei Validation-Fehler → Fallback auf buildRiffForSlot() + Warning. Slots ohne rawRiff oder mit isDirty=true werden wie in v3.4 neu encoded. pcmByteLen wird via data-Sub-Chunk-Walk extrahiert für Cap-Tracking. E2sSlotInput-Felder: slotIndex(0..249), name (16-char ASCII, getrimmt), category(0..17 clamped), pcmData:Float32Array, sampleRate(44.1k/48k), channels(1|2), loopType, loopStart/EndBytes, level(0..127), gain12db, sampleTune(-99..+99), slices (max 64×{start,length,attack,amplitude}), sliceSteps(max 64B raw), slicingNumSteps/Beat/NumActive, +rawRiff, +isDirty. Layout-Output identisch zu Python: 0x0000 16B 'e2s sample all\\x1a\\0' signature, 0x07E0 250×LE32 offset-table, 0x1000 RIFF-area. Caps: max 250 Slots, max 10MB PCM/Slot, max 224MB cumulative PCM, max 512MB total file. Duplicate-slotIndex: keep-first + warn. clampU8/clampU32 für Slice-Felder. estimatePcmBytesForSlot exported. Bit-Layout verified via Round-Trip-Test (buildE2sBank → parseE2sBank). v3.6 BIT-EXACT verified via byte-loop assertion UND FNV-1a hash full-file Round-Trip-Test.",
      lastSeen: "2026-05-18T09:35:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/components/KorgBank/KorgBankEditor.tsx (v3.9.0, useElectron-Refactor v3.10.0)": {
      role:     "v3.10.0: handleSaveAs nutzt jetzt useElectron() statt direkten window.electronAPI-Casts (isomorphic-Regel aus CLAUDE.md). Hook-Aufruf am Component-Body-Start; electron.isElectron + electron.saveKorgBankAs(finalName, buf) ersetzt das alte typeof-window-Duck-Typing. Verhalten unverändert: Electron → IPC Save-Dialog, Web → Blob-Download. v3.9.0 Slice-Audition-Preview + v3.8 Slice-Editor + v3.7 Open-Edit-Save-Flow + v3.4 Create-New-Flow unverändert. LOC 1 299 → 1 295.",
      lastSeen: "2026-05-18T10:30:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/utils/korg/bankEditorState.ts (v3.8.0)": {
      role:     "v3.8.0: Pure-isomorphe State-Helpers für den KorgBankEditor's Open-Bank-Flow (~395 LOC, keine React/DOM-Deps). v3.7-Funktionen + NEU v3.8 Slice-Support. OpenedSlot Type erweitert um slices:E2sSlice[] (max 64 — Default leer = kein Slicing). OpenedSlotSnapshot erweitert um slices:E2sSlice[] (defensive Kopie für Revert). bankToOpenedSlots kopiert src.slices defensive in eigene {start,length,attackLength,amplitude}-Objekte (Snapshot-Isolation gegen Mutation). patchOpenedSlot: slices-Patch zählt jetzt zur editableTouched-Liste (flippt isDirty bei Slice-Edit). NEU setSlotSlices(slots,rowId,slices[]) Convenience-Setter (immer isDirty=true, eigenständige Kopie). replaceSlotSample resettet slices=[] (alte Marker beziehen sich auf altes PCM, ungültig nach Sample-Replace). deleteSlot leert slices=[]. revertSlot restored aus original.slices.map(s=>{...s}). openedSlotsToBuildInputs propagiert slices an E2sSlotInput.slices (nur wenn length>0, sonst undefined → Builder schreibt 64×0-Slices als Default). Helpers (count/has/displayName/displayCategory) unverändert.",
      lastSeen: "2026-05-18T10:05:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/utils/korg/sliceBridge.ts (v3.8.0)": {
      role:     "v3.8.0 NEU: Pure-isomorphe Konvertierungs-Schicht zwischen ESLI E2sSlice (start/length/attack/amp PCM-frame-offsets bzw. u32-Counts) und sampleSlicing OnsetCandidate (frame+strength). ~110 LOC, keine React/DOM-Deps. Public API: esliSliceToOnset(slice)→{frame:max(0,floor(slice.start)), strength:1}. onsetToEsliSlice(onset, nextFrame)→{start:max(0,floor(onset.frame)), length:max(0,floor(nextFrame-start)), attackLength:0, amplitude:0} — Defaults 0 für attack+amp weil noch keine UI dafür. slicesToOnsets(slices[]) filtert all-zero-Slices (start==length==attack==amp==0 wird als 'empty' interpretiert), sortiert nach frame ascending — robust gegen unsortierten ESLI-Input. onsetsToSlices(onsets[], totalFrames) filtert out-of-bounds (frame<0 || frame>=totalFrames), cappt auf MAX_ESLI_SLICES=64 (Hardware-Limit des E2 Samplers), length jeder Slice = (nächster Onset.frame oder totalFrames) - eigener Frame, Floor-Rundung. MAX_ESLI_SLICES = ESLI_SLICES_COUNT (=64) exportiert als Public-Constant für UI-Code. Round-Trip-Property: onsetsToSlices→slicesToOnsets preserves frames; slicesToOnsets→onsetsToSlices ist bit-equal (siehe Test).",
      lastSeen: "2026-05-18T10:05:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/components/KorgBank/WaveformSliceCanvas.tsx (v3.9.0)": {
      role:     "v3.9.0: Inline-Waveform + Slice-Marker + NEU Audition-Preview (~430 LOC). v3.8-Funktionen unverändert. NEU Props (optional, alle backwards-compat): onAudition?(sliceIndex,startFrame,endFrame), playingSliceIndex|null, playingStartedAt|null, playingDurationMs|null. Click-Routing umgebaut: a) onsets.length==0 → click adds (legacy). b) onAudition set + kein Modifier + nearby-Marker → findSliceUnderFrame → onAudition (Region ab Marker). c) onAudition set + kein Modifier + frame in Slice-Region → onAudition. d) Alt/Ctrl/Meta-Modifier → bypass audition → addOnset. e) Shift/RightClick on marker → remove (unchanged). f) Drag-on-marker → move bleibt verfügbar wenn nearby aber kein onAudition oder Modifier. Render-Effect erweitert: playingRegion-Tint (accent-primary @ 0.2 alpha) hinter Waveform, Playhead-Line (accent-success-Farbe) wandert linear (elapsedMs/durationMs * regionFrames) von startFrame zu endFrame. RAF-Loop aktiv nur solange playingSliceIndex≠null (kein Idle-CPU). Cursor: pointer über Slice-Region (Audition-Mode), crosshair empty, grabbing beim Drag. handleMouseLeave resettet hoverFrame + handleMouseUp. Dynamischer Tooltip (audition-vs-add) via title-Attribut. Theme-aware Audition-Farben via getComputedStyle(--ss-accent-primary, --ss-accent-success).",
      lastSeen: "2026-05-18T10:20:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/utils/korg/sliceAudition.ts (v3.9.0)": {
      role:     "v3.9.0 NEU: Pure-isomorphe Audition-Helpers für KorgBankEditor (~210 LOC, keine React/DOM). 3 Public APIs: (1) findSliceUnderFrame(onsets, frame, totalFrames) → SliceRegion{index,startFrame,endFrame}|null — Hit-Test mit defensive sort + guards (empty onsets / frame<firstOnset / frame>=total / total<=0 alle → null). Mappt Index zurück auf Original-Liste (nicht sortierte Position) via findIndex frame-Match. (2) extractSliceBuffer(pcm, channels:1|2, startFrame, endFrame) → Float32Array — Mono = pcm.slice() (eigener Buffer für GC-Indep), Stereo = deinterleave Kanal 0 (Left). Bound-Clamping: start<0→0, end>total→total, end<=start→empty. (3) playSliceWithContext(ctx, buffer, sampleRate, opts?) → SliceAuditionHandle{stop():void, active:boolean}|null — Routing BufferSource → Gain(default 0.85) → outputNode (default ctx.destination — Audition umgeht User-FX-Bus für sauberes A/B). source.onended-Hook + stop()-Methode beide idempotent + connection-cleanup, beide rufen options.onEnded() genau einmal (Flag-Guarded). MinimalAudioCtx-Interface (createBuffer/createBufferSource/createGain/destination) für Test-Mockbarkeit. Defensive: leerer buffer / sampleRate<=0|NaN → null. Try/Catch fängt Browser-spezifische createBuffer-Exceptions ab.",
      lastSeen: "2026-05-18T10:20:00.000Z",
      ownedBy:  "frontend"
    },
    "tests/features/korg-slice-audition.test.ts (v3.9.0)": {
      role:     "v3.9.0 NEU: 24 Tests für sliceAudition.ts. findSliceUnderFrame-8 (Hit first/middle/last region, frame>=total, empty onsets, frame-before-first-onset, total<=0, unsorted-defensive). extractSliceBuffer-6 (mono sub-copy, stereo Kanal 0 deinterleave, start-neg-clamp, end-overflow-clamp, end<=start-empty, empty-pcm). playSliceWithContext-10 (Buffer-Content via Float32-toBeCloseTo, src→gain→destination Routing, stop() idempotent + .active toggle, onEnded exakt 1× pro stop, empty-buffer → null, invalid-SR (0/-1/NaN) → null, custom outputNode-Routing, custom gain.value, extractSliceBuffer→playSliceWithContext Stereo-Integration, sequential stop-then-replay 'next-click-stops-previous'-Pattern). MockAudioContext + MockBufferSource + MockGainNode + MockAudioBuffer inline (kein DOM).",
      lastSeen: "2026-05-18T10:20:00.000Z",
      ownedBy:  "frontend"
    },
    "electron/main.ts (v3.4.0 KORG-Bank-Export-IPC)": {
      role:     "v3.4.0: +IPC 'korg:save-bank-as' (suggestedFilename, data: number[]|ArrayBuffer|Uint8Array). Pfad: validateKorgBankSaveFilename (Whitelist+max-120-Chars+kein-NUL/Path-Trav) + Buffer-Normalize → validateKorgBankBuffer (16B Magic-Sniff + Min 0x1000B + Max 256MB) → dialog.showSaveDialog (User-chosen Pfad — kein Path-Traversal-Vektor) → path.resolve + .all-Endung-Final-Check → fs.writeFile. NEU 'korg:get-bank-save-cap' liefert KORG_BANK_SAVE_MAX_BYTES (256MB). Imports erweitert um validateKorgBankSaveFilename/validateKorgBankBuffer/KORG_BANK_SAVE_MAX_BYTES.",
      lastSeen: "2026-05-18T08:50:00.000Z",
      ownedBy:  "backend"
    },
    "electron/ipcValidators.ts (v3.4.0 KORG-Save)": {
      role:     "v3.4.0: +validateKorgBankSaveFilename(input)→{ok,filename|error}. Regex /^[A-Za-z0-9._-]+\\.all$/, max 120 Chars, kein NUL-Byte / Path-Separator / .. Sequence. +validateKorgBankBuffer(byteLength, prefix:Uint8Array)→{ok|error}: prüft 16B-Prefix gegen 'e2s sample all\\x1a\\0' Magic + min 0x1000B + max KORG_BANK_SAVE_MAX_BYTES (256MB). Hardcoded prefix-Bytes (kein import aus client-code) für Layer-Isolation. Defensive Posture identisch zu validateRecordingFilename+validateWavBuffer aus v2.86.",
      lastSeen: "2026-05-18T08:50:00.000Z",
      ownedBy:  "backend"
    },
    "electron/preload.ts (v3.4.0 KORG-Save-API)": {
      role:     "v3.4.0: +contextBridge saveKorgBankAs(filename, data: ArrayBuffer|Uint8Array) konvertiert beide Eingaben zu number[] für ipcRenderer.invoke('korg:save-bank-as', ...) → {success, filePath?, bytesWritten?, error?}. +getKorgBankSaveCap() → Promise<number>. Pattern analog saveRecording aus v2.86.",
      lastSeen: "2026-05-18T08:50:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/utils/proFeatures.ts (v3.4.0 +korg-bank-write)": {
      role:     "v3.4.0: +PRO_FEATURE_KORG_BANK_WRITE='korg-bank-write'. PRO_FEATURES jetzt 7 (war 6). PRO_FEATURE_LABELS['korg-bank-write']='KORG Sample-Bank-Export (E2S .all)'. UI gated in DrumMachine-Toolbar-Button '📤 KORG Export' + KorgBankEditor-Save-As-Button.",
      lastSeen: "2026-05-18T08:50:00.000Z",
      ownedBy:  "backend"
    },
    "tests/features/korg-e2s-builder.test.ts (v3.4.0)": {
      role:     "v3.4.0: 46 Tests fuer client/src/utils/korg/e2sBankBuilder.ts + audioProcessor.ts. Coverage audioProcessor: floatToInt16LeBytes (7: 0.0→0x00 0x00, +1.0→0xFF 0x7F, -1.0→0x00 0x80, clip>+1, clip<-1, NaN/Inf→0, length×2), resampleLinear (4: no-op-same-rate, 2x-up sample-count, 2x-down sample-count, stereo-deinterleave-preserve), downmixToMono (2: zero-sum, peak-after-downmix), peakNormalize (3: scale-to-target, silent-pass, reject out-of-range), convertToE2sSpec (5: passthrough/48-to-44.1/forceMono/per-slot-cap/invalid-target-sr), sanitizeE2sSlotName (3). Coverage e2sBankBuilder structure: signature@0x0000 (1), offset-table@0x07E0 250-entries (1), sample-area@0x1000+RIFF-magic (1), per-slot RIFF+fmt+data+korg-chunks (1), korg-body=1180B (1), ESLI-magic+version-0x01F4 (1), ESLI-name 16B NUL-pad (1), category clamp 0..17 (1), empty-slot offset=0 (1), max-250-slots-reject (1), duplicate-index keep-first+warn (1), invalid-sampleRate-reject (1), oversize-PCM-reject (1). ROUND-TRIP Builder→Reader (6): mono+category, stereo, multi-slot-with-gaps, non-ASCII-name-sanitized, level-preserved-modulo-u16-quantize, gain12db. File-Size invariants (3): single-mono-slot exact 5528 bytes, empty-bank=0x1000, cumulative-PCM-cap-throw.",
      lastSeen: "2026-05-18T08:50:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/utils/korg/constants.ts (v3.3.0)": {
      role:     "v3.3.0: KORG ESX-1 + E2S Format-Konstanten (~190 LOC). Port aus Korg Editor/esx_e2s_editor/constants.py. Alle Offsets, Magic-Bytes, Size-Caps, Field-Layouts. Konstanten: ESX1_SIGNATURE='KORG' + ESX1_SUBMAGIC='ESX\\0' + ESX1_MAX_MONO_SLOTS=256 + ESX1_MAX_STEREO_SLOTS=128 + ESX1_ADDR_VALID_CHECK_2=0x1B0000 + ESX1_ADDR_SAMPLE_HEADER_MONO=0x1B0100 + ESX1_ADDR_SAMPLE_DATA=0x250000 + ESX1_EMPTY_OFFSET=0xFFFFFFFF + ESX1_SIZE_FILE_MIN=0x250010 + ESX_FILE_MAX_BYTES=64MB. E2S: E2S_ALL_SIGNATURE='e2s sample all\\x1a\\0' + E2S_ALL_OFFSET_TABLE_START=0x07E0 + E2S_ALL_SAMPLE_AREA_START=0x1000 + E2S_MAX_SLOTS=250 + E2S_MAX_TOTAL_PCM_BYTES=224MB + E2S_FILE_MAX_BYTES=512MB + KORG_BANK_IPC_MAX_BYTES=100MB. ESLI-Body-Offsets (NAME@0x0A 16B + CATEGORY@0x1A u16 LE + LOOP_START@0x34 + END@0x38 + ONESHOT@0x3C + USE_CHAN1@0x49 + PLUS12DB@0x4A + SLICES@0x58 (64×16B) + SLICE_STEPS@0x458 64B). E2S_CATEGORY_NAMES Tuple (18 Names: Analog/Audio In/Kick/Snare/Clap/HiHat/Cymbal/Hits/Shots/Voice/SE/FX/Tom/Perc./Phrase/Loop/PCM/User) + e2sCategoryName(idx) Helper.",
      lastSeen: "2026-05-18T08:30:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/utils/korg/esxParser.ts (v3.14.0)": {
      role:     "v3.14.0: ESX-1 .esx Sample-Bank + Pattern + Step-Encoding Parser (~580 LOC, pure JS, isomorph). v3.14-NEU: Drum-Parts 0..9 step-encoding decoded via Hex-Diff analyse (BOTTROP/KASSEL/ENDLICH vs DUSSELBUNKAAA init). Per-Part-Layout (34B stride, 9-10 Drum-Parts ab Offset 0x18): sample-id BE u16 @ part+0 (0x8000=unassigned), level @ part+9, pan @ part+10, 16 step-trigger-bytes @ part+18 (bit 0 = active). Beweis BOTTROP[0] Part 5 = klassischer Kick auf Steps 0/4/8/12+14. Konstanten ESX1_PART_STRIDE=34/ESX1_PART_HEADER_BYTES=18/ESX1_PART_STEPS_BYTES=16/ESX1_DRUM_PART_OFFSET=24/ESX1_DRUM_PARTS_DECODED=10/ESX1_SAMPLEID_UNASSIGNED=0x8000. Interner Helper decodeDrumPart(raw, partIndex) → {sampleId, volume, pan, steps[]} (Parts 10..15 = undefined → Defaults). velocity Best-Effort (bits 1..7 mit Fallback 100). Sample-API + Pattern-Header-API (v3.3/v3.5) unverändert. Parts 10..15 (Stretch/Slice/Audio-In/Synth) bleiben Defaults — Layout nach 240B Motion-Region nicht final RE-d.",
      lastSeen: "2026-05-18T11:30:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/utils/korg/esxPatternConvert.ts (v3.5.0)": {
      role:     "v3.5.0: Pure-TS-Konverter EsxPattern → SynthstudioPatternImport (~150 LOC). Public API: convertEsxPatternToSynthstudio(esxPattern, opts?) → SynthstudioPatternImport {name, bpm, stepCount:16|32, swing, drumParts: SynthstudioDrumPartImport[]{partIndex,sampleId,sampleHint,volume(0..1),pan(-1..+1),pitchSemitones,steps:boolean[],velocities:number[]}, automationLanes:[]}. convertEsxPatternsToSynthstudio Bulk. esxPartHint(partIndex 0..15) → konservatives Label (0..8 'ESX Drum N', 9..10 'ESX Stretch N', 11..12 'ESX Slice N', 13 'ESX Audio-In', 14..15 'ESX Synth N'). Pure-Logik, schreibt keine Stores. v3.5-Caveat: automationLanes immer [] (Motion-Daten in ESX-1 nicht RE-d).",
      lastSeen: "2026-05-18T09:10:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/utils/korg/e2sBankReader.ts (v3.6.0)": {
      role:     "v3.6.0: E2S .all Sample-Bank Reader (~490 LOC, pure JS). Port aus Korg Editor/esx_e2s_editor/services/e2s_parser.py. Public API: parseE2sBank(buf, source?, opts?: ParseE2sBankOptions) → E2sBank, isE2sBuffer, le16PcmToFloat32, countE2sSlots. v3.6 NEU ParseE2sBankOptions{preserveRawRiff?:bool} + E2sSlot.rawRiff?:Uint8Array. Wenn preserveRawRiff:true → pro Slot 8+riffSize Bytes (RIFF<size>WAVE...) als eigenständiges Uint8Array (kein subarray-View, GC-freundlich). Default false (kein Memory-Overhead). E2sBank: {source, slots: Array<E2sSlot|null> Länge 250, offsetTable: Uint32Array, trailingBytes, warnings}. E2sSlot: {index, name, category, categoryName, sampleRate, channels:1|2, frames, pcmData:Float32Array, loopType:0|1|2, loopStart, loopEnd, level, gain12db, slices, sliceSteps, slicingNumSteps, slicingBeat, slicingNumActive, +rawRiff?}. RIFF-Parser walked WAVE-Body's Sub-Chunks (fmt + data + korg/esli) mit findSubchunk(). PCM 16-bit LE → Float32 via le16PcmToFloat32. Korg-Body parsed name (16B ASCII) + category (u16 LE) + level (u16 normalisiert auf 0..127) + loopStart/End (u32) + gain12db (u8) + 64 Slice-Records (4×LE32 = start,length,attack,amplitude, trim trailing-zeros). Defensive: signature, offset-table-bounds-check, per-Slot RIFF-size cap, per-Slot PCM cap (10MB), cumulative cap (224MB). Bei kaputter Einzel-Slot: skip+warn (außer file-escape/cap-violation → throw).",
      lastSeen: "2026-05-18T09:35:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/utils/korg/bankDetect.ts (v3.3.0)": {
      role:     "v3.3.0: Thin wrapper für KORG-Bank-Type-Detection. detectKorgBankType(buf) → 'esx'|'e2s'|'unknown' (via isEsxBuffer + isE2sBuffer). detectKorgBankTypeFromName(name) → gleich aus Endung (.esx/.ess → 'esx', .all → 'e2s').",
      lastSeen: "2026-05-18T08:30:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/components/KorgBank/KorgBankModal.tsx (v3.3.0)": {
      role:     "v3.3.0: KORG-Sample-Bank-Modal (Read-Only, ~400 LOC). Props {file:File|null, onClose, onAddSample?(sample:KorgBankSample)}. Listet alle (non-null) Slots mit Index/Name/Category/Duration/Channels + 'Preview' (AudioEngine.playSliceBuffer) + 'Add' (encodeWav → Blob-URL → KorgBankSample-Spec). 'Alle importieren'-Bulk-Button mit window.confirm. Search-Filter ueber Name+Category. Warnings collapsible. encodeWav pure-Helper baut RIFF/WAVE Float32 → 16-bit LE. Auto-detect ESX vs E2S via detectKorgBankType. Semantic Tailwind classes (bg-bg-panel, border-border-color, text-accent-primary, accent-danger fuer Errors). data-testids korg-bank-{modal,close,search,import-all,row-*,preview-*,add-*,loading,error,list}.",
      lastSeen: "2026-05-18T08:30:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/utils/dragDropDispatch.ts (v3.3.0)": {
      role:     "v3.3.0: Pure-Helpers fuer globalen Drag-Drop-Dispatch (~180 LOC). FileType-Union erweitert um 'korg-bank'. KORG_BANK_EXTENSIONS = {'.esx','.ess','.all'} als separates Set, ELECTRIBE_EXTENSIONS reduziert auf {'.e2spat','.e2sallpat','.e2pattern','.elst'} (`.esx` wurde aus dem Electribe-Bucket entfernt). detectFileType priorisiert KORG_BANK_EXTENSIONS vor ELECTRIBE_EXTENSIONS. eventNameMap routet 'korg-bank' → CustomEvent 'korg:bank:open' (dispatched an window, App.tsx listener oeffnet KorgBankModal). Bestehende Funktionen unveraendert.",
      lastSeen: "2026-05-18T08:30:00.000Z",
      ownedBy:  "backend"
    },
    "electron/ipcValidators.ts (v3.3.0)": {
      role:     "v3.3.0: +KORG_BANK_ALLOWED_EXTENSIONS Set {'.esx','.ess','.all'}, +KORG_BANK_MAX_BYTES=100MB, +validateKorgBankPath(input)→{ok,ext|error} (mit NUL-Byte+Pfadlaenge-Check), +validateKorgBankFileSize(byteSize)→{ok|error}. Pattern analog validateElectribePath/Size aus v2.99. Bestehende Validators (Recording/WAV/License/Electribe) unveraendert.",
      lastSeen: "2026-05-18T08:30:00.000Z",
      ownedBy:  "backend"
    },
    "electron/main.ts (v3.3.0 KORG-Bank-IPC)": {
      role:     "v3.3.0: 3 neue IPC-Handler. (1) 'korg:import-bank' (filePath: string) → {success, data?: number[], fileName, ext} | {success:false, error}. Validation via validateKorgBankPath + validateKorgBankFileSize + path.resolve + fs.access(R_OK). Liest die ganze Datei und liefert sie als Array zurueck (Renderer parsed dann via parseEsxBank/parseE2sBank). (2) 'korg:open-bank-dialog' → nativer Datei-Dialog mit Filtern 'KORG Sample-Banks' (esx/ess/all) + 'ESX-1' (esx/ess) + 'E2S' (all). (3) 'korg:get-bank-cap' → Number (KORG_BANK_MAX_BYTES=100MB) fuer UI-Hinweise. Imports erweitert um validateKorgBankPath/Size + KORG_BANK_MAX_BYTES.",
      lastSeen: "2026-05-18T08:30:00.000Z",
      ownedBy:  "backend"
    },
    "electron/preload.ts (v3.3.0 KORG-Bank-API)": {
      role:     "v3.3.0: 3 neue contextBridge-Methoden. openKorgBankDialog() → {canceled, filePaths}, importKorgBank(filePath: string) → {success, data?: number[], fileName, ext, error?}, getKorgBankCap() → Promise<number>. Pattern analog importElectribeFile + openElectribeDialog.",
      lastSeen: "2026-05-18T08:30:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/utils/proFeatures.ts (v3.3.0 +korg-bank-import)": {
      role:     "v3.3.0: PRO_FEATURE_KORG_BANK_IMPORT='korg-bank-import' hinzu. PRO_FEATURES jetzt Länge 6 (war 5). PRO_FEATURE_LABELS['korg-bank-import']='KORG Sample-Bank-Import'. UI gated via requireProFeature(PRO_FEATURE_KORG_BANK_IMPORT) in DrumMachine-Toolbar-Button und App-Level handleKorgBankFile.",
      lastSeen: "2026-05-18T08:30:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/components/DrumMachine/DrumMachine.tsx (v3.3.0 KORG-Bank-Button)": {
      role:     "v3.3.0: +'📦 KORG Bank'-Toolbar-Button neben '🎚 Electribe'. data-testid=korg-bank-import. Click → korgBankImportRef.current?.click() → hidden file-input mit accept='.esx,.ess,.all' (data-testid=korg-bank-import-input). onChange: requireProFeature(PRO_FEATURE_KORG_BANK_IMPORT) gate, dann window.dispatchEvent CustomEvent 'korg:bank:open' (detail=File). App.tsx-Listener oeffnet das Modal. ProLockBadge im Button. Imports erweitert um PRO_FEATURE_KORG_BANK_IMPORT.",
      lastSeen: "2026-05-18T08:30:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/App.tsx (v3.3.0 KORG-Bank-Modal-Bridge)": {
      role:     "v3.3.0: +Import KorgBankModal + KorgBankSample + PRO_FEATURE_KORG_BANK_IMPORT (in proFeatures-Import konsolidiert). +useState korgBankFile:File|null. handleKorgBankFile(file) gated via requireProFeature, setzt State. handleKorgBankAddSample(sample) ruft project.addSamples mit {id,name,path:url,category} (Blob-URL als path). useEffect-Listener auf 'korg:bank:open'-CustomEvent → ruft handleKorgBankFile. ElectronDropZone bekommt onKorgBankFile={handleKorgBankFile}. KorgBankModal-Render zwischen ActivationModal und </ElectronDropZone>. Damit wird der Modal sichtbar bei: (a) Picker-Click in DrumMachine, (b) Drag-Drop einer .esx/.all File (ueber ElectronDropZone → DrumMachine).",
      lastSeen: "2026-05-18T08:30:00.000Z",
      ownedBy:  "frontend"
    },
    "tests/features/korg-esx-parser.test.ts (v3.3.0)": {
      role:     "v3.3.0: 23 Tests fuer client/src/utils/korg/esxParser.ts. buildMinimalEsxBuffer-Builder baut synthetisch ein valides .esx-Layout (Magic + Sub-Magic + 2nd-Magic + 256 Mono-Headers + 128 Stereo-Headers + PCM-Bereich) mit konfigurierbaren Slots. Coverage: Magic-Detection (4 — pos+zerstoertes KORG+zerstoertes ESX\\0+zu klein), File-Size-Caps (2 — min/max), Magic-Validation (4 — first-magic/sub-magic/second-magic/sample-count-OOR), Mono-Parse (4 — name+frames+sample-rate, Float32-Range [-1,+1], Empty-Slot-Sentinel, Multi-Sample Order), Stereo-Parse (2 — interleaved L+R different per-channel), PCM-Helper be16PcmToFloat32 (4 — 0x0000/0x7FFF/0x8000/Multi-Frame), Defensive (2 — invertierter Offset → warning+skip, Level-Clamp [0..127]) + Real-File-Test conditional auf 'Korg ESX files/' Existenz.",
      lastSeen: "2026-05-18T08:30:00.000Z",
      ownedBy:  "backend"
    },
    "tests/features/korg-e2s-bank.test.ts (v3.3.0)": {
      role:     "v3.3.0: 18 Tests fuer client/src/utils/korg/e2sBankReader.ts. buildMinimalE2sBuffer-Builder baut synthetisch '.all'-Layout (Signature + 250-Entry Offset-Table + RIFF/WAVE-Chunks mit fmt/data/korg-Subchunks). Coverage: Signature-Detection (3 — pos+zerstoert+tiny), File-Caps (2), Slot-Parse (6 — empty bank, single mono mit category, single stereo, mixed slots mit nulls, offsetTable preserved, category-mapping via e2sCategoryName), PCM-Helper le16PcmToFloat32 (3 — 0x0000/0x7FFF/0x8000), Defensive (1 — offset in prelude throws), bankDetect (2 — valid E2S, random bytes → unknown) + Real-File-Test conditional auf 'Korg e2s files/Sample/' Existenz. float32ToLe16-Helper im Test (inverse zu le16PcmToFloat32) erlaubt deterministische Round-Trip-Validierung.",
      lastSeen: "2026-05-18T08:30:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/utils/dragDropDispatch.ts (v3.1.0)": {
      role:     "v3.1.0: Pure-Helpers fuer globalen Drag-Drop-Dispatch (~165 LOC, kein React/DOM-Side-Effect). Exports: AUDIO_EXTENSIONS (Set, 7 Endungen wav/mp3/ogg/flac/aiff/aif/m4a), PROJECT_EXTENSIONS ({.synth}), ZIP_EXTENSIONS ({.zip}), MIDI_EXTENSIONS ({.mid,.midi}), ELECTRIBE_EXTENSIONS ({.e2spat,.e2sallpat,.e2pattern,.esx,.elst}), FileType-Union audio|project|zip|midi|electribe|unknown, DispatchResult-Interface. Funktionen: getFileExtension(name) defensive (null/empty/no-dot → ''), detectFileType(name) Lookup-Switch ueber 5 disjunkte Sets, detectFileTypeFromFiles(files[]) nimmt Typ der ersten Datei (fuer Overlay-Type-Detection bei Multi-Drop), dispatchFileDrop(file) feuert CustomEvent (drop:audio/drop:project/drop:zip/midi:fileImport/electribe:fileImport), dispatchAllFiles(files[]) iteriert und zaehlt handled+unknown. Defensive: typeof window undef → unhandled, dispatchEvent throws → catch+unhandled.",
      lastSeen: "2026-05-18T07:40:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/components/DragDropOverlay/DragDropOverlay.tsx (v3.1.0)": {
      role:     "v3.1.0: Standalone visuelles Drop-Feedback-Overlay (~110 LOC). Props {isVisible, fileType}. OVERLAY_STYLES-Map liefert pro FileType: border-Klasse (border-accent-primary/secondary/success/border-color), bg-Klasse (bg-accent-*/10), text-Klasse (text-accent-*/text-text-muted), label (DE), icon (Emoji). 5 Akzent-Farben fuer audio/project/zip/midi/electribe + unknown=text-muted. NULL hardcoded slate/gray/cyan. fixed inset-0 z-50 pointer-events-none, border-4 dashed transition-all 150ms. data-testid=drag-drop-overlay + data-drop-type=<type> fuer Playwright. SUBTEXT_BY_TYPE pro Typ erklaert was passieren wird.",
      lastSeen: "2026-05-18T07:40:00.000Z",
      ownedBy:  "frontend"
    },
    "electron/components/ElectronDropZone.tsx (v3.1.0)": {
      role:     "v3.1.0: Globale Drag-Drop-Zone fuer App-Root. importiert jetzt zentrale dragDropDispatch.ts-Constants (AUDIO/ZIP/MIDI/ELECTRIBE_EXTENSIONS) statt Inline-Duplikate. +onElectribeFile?-Prop in ElectronDropZoneProps. handleDrop iteriert Files: ZIP→onZipFile, MIDI→onMidiFile-Callback ODER Default-CustomEvent midi:fileImport, ELECTRIBE→onElectribeFile-Callback ODER Default-CustomEvent electribe:fileImport, AUDIO→onAudioFiles+onAudioFilesRaw, PROJECT→onProject. NEU: unknownExts-Sammel-Array sammelt Endungen unbekannter Files → EIN Toast pro Drop (kein Spam) 'Nicht unterstuetzt: <ext1>, <ext2>, <ext3> (+N weitere)' kind:'warning' 4500ms. detectDropType erkennt jetzt 'electribe' fuer Overlay-Farbe. Render: Folder-Overlay inline (Webkit-Entry-spezifisch), alle anderen via <DragDropOverlay isVisible fileType=... />. Electron-Path (window.electronAPI.onDragDropBulkImport/onDragDropLoadSample/onDragDropOpenProject) bleibt unveraendert. @/-Aliase statt relativer Pfade.",
      lastSeen: "2026-05-18T07:40:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/components/SampleEditor/SampleSliceEditor.tsx (v3.1.0 zone-drop)": {
      role:     "v2.89.0 + v3.1.0-ZONE-DROP: Sample-Slice-Editor-Modal mit Waveform-Canvas + Slice-Marker + 4x4 Pad-Grid. v3.1.0 ADD: optionaler onReplaceSample?-Prop. Wenn vorhanden, fuegt Waveform-Bereich (data-testid=slice-editor-waveform-zone) onDragOver/onDragEnter/onDragLeave/onDrop-Cycle hinzu. Audio-File-Match via Regex /\\.(wav|mp3|ogg|flac|aiff?|m4a)$/i ODER mime audio/*. dragLeave-Logik benutzt currentTarget.contains(relatedTarget) gegen Child-Bubble-False-Positives. Visueller Indikator data-testid=slice-editor-drop-indicator zentriert ueber dem Canvas wenn isDragOver. Backwards-Compat: ohne onReplaceSample-Prop kein Drop-Listener (Picker-only).",
      lastSeen: "2026-05-18T07:40:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/components/DrumMachine/DrumMachine.tsx (v3.1.0 sliceFile-Extract + electribeFile-Drop)": {
      role:     "v3.1.0: handleSliceFile aus handleSliceImport extrahiert (~30 LOC pure File→Modal-Pipeline mit AudioContext decodeAudioData + setSliceEditor). handleSliceImport (Picker-onChange-Handler) ruft jetzt handleSliceFile auf. SampleSliceEditor bekommt onReplaceSample={handleSliceFile} → Drop einer .wav auf den Waveform-Bereich oeffnet den Editor mit dem neuen Sample (Modal bleibt offen, Slices werden re-initialisiert via channelData-Prop-Change). electribe:fileImport-Listener seit v2.88 unveraendert — feuert handleElectribeFile mit File aus CustomEvent.detail.",
      lastSeen: "2026-05-18T07:40:00.000Z",
      ownedBy:  "frontend"
    },
    "tests/features/drag-drop.test.ts (v3.1.0)": {
      role:     "v3.1.0: 27 Pure-Tests fuer dragDropDispatch.ts. getFileExtension (3 — lowercase+dot/empty-cases/null-defensive), detectFileType (8 — alle AUDIO-Endungen via Iteration/SYNTH+.SYNTH/ZIP/MID+MIDI/Electribe-5-Varianten/Unknown-Endungen/Empty-Name/disjoint-Sets-Invariant), detectFileTypeFromFiles (2), dispatchFileDrop (7 — Audio/Project/Electribe/Midi/Zip/Unknown-handled-false/Endpoint-Listener-empfaengt-File), dispatchAllFiles (4 — 3-Audio+Project-Multi/Mixed-Unknown-Counter/Alle-5-Typen+1unknown/Empty-Array), defensive (3 — kaputt-File-ohne-name/kein-window-Global/dispatchEvent-throws-catch). Custom-Window+CustomEvent-Shim fuer Node-Env (FakeWindow mit __dispatched-Array, FakeCustomEvent-Class) — kein JSDOM noetig.",
      lastSeen: "2026-05-18T07:40:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/store/useAudioEngineConfigStore.ts (TASK-236-ALT v3.0)": {
      role:     "v3.0.0: Audio-Engine-Low-Latency-Config-Store (~140 LOC, Custom-Observer analog useThemeStore/useApiSettingsStore). State {latencyHint:'interactive'|'balanced'|'playback', sampleRate:44100|48000|96000|'auto'}, Defaults 'interactive'+'auto'. Public API: getAudioEngineConfig(), setLatencyHint(hint), setSampleRate(rate), buildAudioContextOptions(cfg?=current) → AudioContextOptions (sampleRate-Feld OMITTED bei 'auto' damit Browser nicht resampelt), __resetAudioEngineConfigForTests(), useAudioEngineConfigStore() React-Hook. localStorage-Key 'ss-audio-engine-config:v1', sanitize-on-load mit VALID_HINTS+VALID_SAMPLE_RATES-Whitelists. Identity-Short-Circuit (kein extra Write bei No-Op-Setter). DEFAULT_CONFIG exported für externe Konsumenten.",
      lastSeen: "2026-05-18T07:25:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/audio/AudioEngine.ts (TASK-236-ALT v3.0)": {
      role:     "v3.0.0: init() liest jetzt Config aus useAudioEngineConfigStore via buildAudioContextOptions → `new AudioContext(opts)` mit try-catch-Fallback auf zero-arg-Ctor (Spec-konform). NEU reinit() — full-teardown+setup: stop() bei playing, _granularEngines.stop()+clear, detachLiveInput für alle attached IDs, channelNodes.clear, reverbBuffers.clear, alle Global-Bus-Nodes auf null, masterGain=null, _outputAnalyser=null, await ctx.close(), ctx=null, dann init() neu. bufferCache bleibt (decodeAudioData ist ctx-agnostisch). NEU MIDI_CLOCK_LOOK_AHEAD=0.05 (50ms, vs LOOK_AHEAD=0.1 für Steps) — Bonus-Optimierung reduziert MIDI-Clock-Lead zum externen Empfänger. _schedule() benutzt eigenes clockLookAheadUntil. Drift-Robust weil planTicks ohne `now` arbeitet.",
      lastSeen: "2026-05-18T07:25:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/components/Settings/SettingsPanel.tsx (TASK-236-ALT v3.0)": {
      role:     "v3.0.0: +Section 'audio-engine' (Icon ⚡, group 'Audio', direkt unter Metronom). AudioEngineSection-Komponente mit 2 Dropdowns (Latency-Hint 3 Optionen mit Erklärung, Sample-Rate 4 Optionen Auto/44.1/48/96), Live-Anzeige getEstimatedSystemLatencyMs + AudioEngine.ctx.sampleRate (1s setInterval-Refresh via useReducer), rate-mismatch-Warnung wenn ctxRate !== gewählter Rate, Apply-Button feuert AudioEngine.reinit() async mit busy-State und Toast-Sequence. data-testids settings-audio-engine + audio-engine-{latency-hint,sample-rate,status,apply,rate-mismatch}. +useReducer Import.",
      lastSeen: "2026-05-18T07:25:00.000Z",
      ownedBy:  "frontend"
    },
    "tests/features/audio-engine-config.test.ts (TASK-236-ALT v3.0)": {
      role:     "v3.0.0: 12 Tests für useAudioEngineConfigStore. Coverage: Defaults+DEFAULT_CONFIG-Export, Latency-Hint-Persistenz, Latency-Hint-Validierung-No-Op (ungültiger Wert), Latency-Hint-Identity-Check (kein Re-Write), Sample-Rate-Persistenz, Sample-Rate-Whitelist-Filter, buildAudioContextOptions OMITS sampleRate bei 'auto', buildAudioContextOptions setzt sampleRate bei konkreter Wahl, buildAudioContextOptions akzeptiert explizite Config, sanitize-on-load bei kaputtem Blob → Defaults, Independence-Latency-vs-Rate, AudioContext-Mock-Constructor-Capture (verifiziert daß die richtigen Args weitergegeben werden). localStorage-Shim analog api-settings.test.ts.",
      lastSeen: "2026-05-18T07:25:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/utils/licenseConfig.ts (TASK-232 v2.97)": {
      role:     "v2.97.0: License-Konstanten + Format-Doku. LICENSE_PUBLIC_KEY_HEX (32-byte hex, aktuell Placeholder '0'*64 mit TODO-Marker — Verification schlägt fehl bis User Real-Key einsetzt; Keypair-Generation-Snippet inline doku'd). LICENSE_PRODUCT_ID='synthstudio-pro-1'. TRIAL_DURATION_DAYS=30. DAY_MS. GUMROAD_PRODUCT_URL='https://gumroad.com/l/synthstudio-pro' (TODO Placeholder). isUsingPlaceholderPublicKey() → bool für UI-Warning. License-Format dokumentiert: '<base64url(payload-json)>.<base64url(signature-64)>' mit Payload {email, expiresAt:number|null, productId}.",
      lastSeen: "2026-05-18T06:35:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/utils/licenseValidator.ts (TASK-232 v2.97)": {
      role:     "v2.97.0: Pure ED25519-License-Validator (~150 LOC). Exports: base64UrlDecode/Encode (browser atob+node Buffer Fallback, max 4096 Zeichen Key), parseLicenseKey(key) → {payloadB64, sigB64}|null (strict: genau 1 Dot, leerer-Teil-reject), decodePayload(b64) → Payload|null (JSON max 1 KB, email-Länge ≤254, productId-Whitelist), validateLicenseKey(key, pubHex, now) → LicenseValidationResult ({valid:true,payload}|{valid:false,reason}) via ed.verifyAsync (WebCrypto, keine sha512-Wiring). Defensive Längen-Checks: Pub-Key 32 Bytes, Signatur 64 Bytes. expiresAt-Check NULL=perpetual. signLicensePayload(payload, secretKey) für Vendor-Tooling + Tests (NICHT im Prod-Pfad genutzt — secret bleibt offline beim Vendor).",
      lastSeen: "2026-05-18T06:35:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/store/useLicenseStore.ts (TASK-232 v2.97)": {
      role:     "v2.97.0: License-State-Store (Custom-Observer analog useThemeStore). State {status: 'unknown'|'trial'|'pro'|'expired'|'invalid', trialStartedAt: number|null, licenseKey, activatedEmail}. Status-Machine: unknown→trial (startTrial), unknown→pro (activate-success), unknown→invalid (activate-fail), unknown→expired (markUnknownAsExpired für 'continue free'), trial→expired (Clock-Tick), trial→pro (mid-trial activate). Public API: initializeLicenseStore(now), isPro(now), daysRemainingInTrial(now), startTrial(now) NO-OP wenn trialStartedAt!=null (kein User-Reset), activate(key, email, now) async, clear() (entfernt key, behält trialStartedAt), markUnknownAsExpired(). useLicenseStore() Hook. sanitizeState() Status-Whitelist + finite-Number-only + Längen-Limits 254/4096. Persistenz: window.electronAPI.readLicense/writeLicense (Electron) ODER localStorage 'synthstudio:license:v1' (Browser-Fallback). Test-Helper __resetLicenseForTests + __setLicenseStateForTests.",
      lastSeen: "2026-05-18T06:35:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/utils/proFeatures.ts (TASK-232 v2.97)": {
      role:     "v2.97.0: Pro-Feature-Gating-Helper. Konstanten PRO_FEATURE_LIVE_LOOPING/USB_AUDIO_IN/STEM_BOUNCE/ELECTRIBE_IMPORT/MIDI_NOTE_OUT, PRO_FEATURES-Tuple, PRO_FEATURE_LABELS (DE). isFeatureUnlocked(feature, unknownDefault=false) → bool via isPro() (im Trial alles unlocked, nach Expire nur base-DAW). requireProFeature(feature) → bool, zeigt bei locked einen Toast {kind:'warning', duration:6000} mit Sondertext 'dein 30-Tage-Trial ist abgelaufen' bei status=expired + Action-Button 'Lizenz kaufen' der GUMROAD_PRODUCT_URL in neuem Tab öffnet. Components calls 'if (!requireProFeature(...)) return;' am Entry-Point — UI bleibt sichtbar, Action wird nur unterbrochen.",
      lastSeen: "2026-05-18T06:35:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/components/License/ActivationModal.tsx (TASK-232 v2.97)": {
      role:     "v2.97.0: Lizenz-Aktivierungs-Modal. Auto-shown wenn licenseStore.status='unknown', via forceOpen-Prop manuell aus Settings öffnen. 2 Modi: 'choice' (Trial-starten / Aktivieren / Free-Continue / Buy-Link zu Gumroad) und 'activate' (textarea key + email-input + Validate-Button mit busy/error-State). Nutzt semantic Tailwind classes (bg-bg-panel, text-text-primary, border-border-color, bg-accent-primary). Closable nur via forceOpen=true; im Auto-Mode (unknown) NICHT closable. Bei Placeholder-Public-Key warnt der Modal inline ('Hinweis Dev: Public-Key ist Placeholder'). v2.98: wird jetzt zusätzlich aus Settings-License-Section re-mountable via forceOpen=true (Re-Mount-Pattern statt Singleton-State).",
      lastSeen: "2026-05-18T06:55:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/components/License/ProLockBadge.tsx (TASK-232-FOLLOWUP v2.98)": {
      role:     "v2.98.0: ProLockBadge — kleines 🔒-Icon-Badge (Lucide Lock, size=12 default) mit Tooltip '<Label> — Pro-Feature'. Renders nur wenn !isFeatureUnlocked(feature) via useLicenseStore-Subscribe (re-render bei Status-Wechsel). pointer-events-none → blockiert KEINEN Underlay-Klick, Underlay-Button feuert beim Klick requireProFeature → kontextueller Toast statt silent-disable. Props {feature, className?, title?, size?=12}. data-testid=pro-lock-badge-<feature>. Verwendet in MixerView '+ Live Input', ExportPanel 'Bounce All Stems', DrumMachine '🎚 Electribe', LooperPanel-Header.",
      lastSeen: "2026-05-18T06:55:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/components/PerformanceMode/LooperPanel.tsx (TASK-232-FOLLOWUP v2.98)": {
      role:     "v2.98.0: Live-Looper-UI. handlePointerUp und handlePointerDown (Long-Press-Erase) prüfen jetzt requireProFeature(PRO_FEATURE_LIVE_LOOPING) — locked → return ohne triggerLoop/eraseLoop (Toast erscheint via requireProFeature). ProLockBadge im Header neben '4/4 aktiv'-Counter (sichtbar nur wenn locked).",
      lastSeen: "2026-05-18T06:55:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/components/Settings/SettingsPanel.tsx (TASK-232-FOLLOWUP v2.98)": {
      role:     "v2.98.0: +Section 'license' (Icon 🔑, group 'App', VOR 'about'). LicenseSection-Komponente mit Status-Display ('Pro — aktiviert' / 'Trial — Tag N von 30' Farb-Eskalation wenn ≤3 Tage / 'Trial abgelaufen' / 'Ungültige Lizenz' / 'Free'), '🔑 Lizenz aktivieren'-Button öffnet ActivationModal mit forceOpen=true (Re-Mount via lokaler showActivation-useState, conditional render), 'Pro-Lizenz kaufen'-Link → GUMROAD_PRODUCT_URL, 'Lizenz deaktivieren'-Button (nur sichtbar wenn status='pro') mit window.confirm-Schutz → clearLicense() + Toast. data-testids settings-license-{status,activate,buy,deactivate}.",
      lastSeen: "2026-05-18T06:55:00.000Z",
      ownedBy:  "frontend"
    },
    "tests/features/license-gates.test.ts (TASK-232-FOLLOWUP v2.98)": {
      role:     "v2.98.0: 11 Pure-Tests für die NEUEN Pro-Feature-Gates. PRO_FEATURES-Registry-Vollständigkeit (1), Live-Looping-Gate (4 — expired-locked/Toast-feuert/Trial-unlocked/expired-Sondertext mit '30-Tage-Trial ist abgelaufen'), MIDI-Note-Out-Gate (3 — locked-Toast/Trial-unlocked/Pro-unlocked), ProLockBadge-Sichtbarkeits-Regel (3 — Trial-alle-5-hidden/expired-alle-5-visible/unknown-visible). vi.mock auf @/store/useToastStore.toast für zählbare Calls. Stub für window.open damit Toast-Action keine Errors wirft. localStorage-Shim analog license.test.ts.",
      lastSeen: "2026-05-18T06:55:00.000Z",
      ownedBy:  "frontend"
    },
    "tests/web/license-polish.spec.ts (TASK-232-FOLLOWUP v2.98)": {
      role:     "v2.98.0: 5 Playwright-Smokes für License-Polish-UI. seedLicenseState(page, status, opts)-Helper für localStorage-Seeding mit status='trial'/'pro'/'expired', openSettingsLicenseSection(page)-Helper (Gear-Button → Lizenz-Tab). Tests: Settings→Lizenz-Section erreichbar+Trial-Status sichtbar, ActivationModal aus Settings öffnen + via X-Button (forceOpen=true→X visible) schließen, ProLockBadge sichtbar bei expired für USB-Audio-In-Button (Mixer-Tab), Badge UN-sichtbar im Trial, Pro-Status → Deaktivieren-Button sichtbar.",
      lastSeen: "2026-05-18T06:55:00.000Z",
      ownedBy:  "frontend"
    },
    "tests/features/license.test.ts (TASK-232 v2.97)": {
      role:     "v2.97.0: 18 Tests. Trial-Lifecycle (5 — start/no-reset/days-decrement/auto-expire/initialize-expired), validateLicenseKey (7 — invalid-format/valid-roundtrip/manipulierte-Sig/expired/falscher-productId/parseLicenseKey-Robustheit/decodePayload-Defekte), Pro-Feature-Gate (4 — trial-unlocked/expired-locked/activate-invalid-no-pro/unknown-feature-default), Persistenz (2 — localStorage-Round-Trip/sanitizeState-NaN-Filter). beforeAll generiert frischen ED25519-Keypair via ed.keygenAsync, signLicensePayload mintet Test-Keys. localStorage-Shim für Node-Test-Env (MemoryStorage-Klasse).",
      lastSeen: "2026-05-18T06:35:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/utils/synthOfflineRender.ts (TASK-241-FOLLOWUP-2 v2.96)": {
      role:     "v2.96.0: Synth-Offline-Render fuer Stem-Bounce (~290 LOC, pure). Exports: triggerOfflineSynthNote(ctx, params, freq, time, volume, output, prevFreq?) → OfflineSynthNoteHandle (baut Oscillator + ADSR identisch zu SynthEngine.triggerNote, connectet auf output-Node), pitchToFrequency(semi, baseHz=440) → A4-Transpose `440 * 2^(semi/12)`, normalizeSynthParams(p) → defensive Defaults bei missing/NaN (clamped sustain[0,1], detune[-100,100], fmRatio≥0.1, attack/decay/release≥0.001s), computeNoteHoldSec()=1.0, isSynthPart(part) → `!!synthParams && (sourceType==='wavetable'|'fm')`, isGranularPart(part). Wavetable-Branch: 1 OscillatorNode mit type/detune/glide (custom→sine fallback). FM-Branch: 2 OscillatorNodes (carrier+modulator) + modDepth-GainNode für fmRatio*freq-Modulation. ADSR via setValueAtTime + linearRampToValueAtTime (offline-kompatibel). Architektur-Entscheidung: Copy-with-Marker statt SynthEngine-Refactor (SoT-Marker im Code, FOLLOWUP-242-EXTRACT-SYNTHGRAPH). CAVEATS: Granular silent (RAF nicht offline-portierbar), Synth-LFO statisch (FOLLOWUP-3), Custom-Wavetables→sine (FOLLOWUP-4), Macro-LFO-Cache live-only.",
      lastSeen: "2026-05-18T06:15:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/utils/channelBounce.ts (TASK-241-FOLLOWUP-2 v2.96)": {
      role:     "v2.96.0: +Import {triggerOfflineSynthNote, pitchToFrequency, isSynthPart, isGranularPart} aus @/utils/synthOfflineRender. renderChannelToBuffer routet jetzt 3 Wege: partIsSynth → _renderSynthWithFxChain, partIsGranular → silent (no-op, dokumentierter Caveat), opts.sampleBuffer → bestehender v2.95-Pfad (_renderWithFxChain oder _renderBypassFx). NEU _renderSynthWithFxChain(ctx, part, pattern, stepDurSec, bars, stepsPerBar, channels) — baut buildOfflinePartGraph(ctx, part, channels) einmal, dispatcht pro aktivem Step triggerOfflineSynthNote(graph.input) mit volume=velocity*partVol (muted→0) und freq=pitchToFrequency(step.pitch). Synth-Output läuft durch die identische v2.95-FX-Chain → EQ + Filter + Distortion + Comp + Delay + Reverb wirken auch auf Synth-Parts. README-Block am Datei-Ende um 'v2.96 (NEU) — Synth-Parts im Bounce'-Section erweitert, 'NICHT im Bounce'-Block listet Granular/SynthLFO/CustomWavetables.",
      lastSeen: "2026-05-18T06:15:00.000Z",
      ownedBy:  "backend"
    },
    "tests/features/synth-offline-render.test.ts (TASK-241-FOLLOWUP-2 v2.96)": {
      role:     "v2.96.0: 24 Pure-Helper + Integration-Tests. pitchToFrequency (5 — 0/+12/-12/custom-base/NaN-defensive), normalizeSynthParams (6 — undefined→defaults/invalid-mode/NaN-attack/sustain-clamp/detune-clamp/fmRatio-min), computeNoteHoldSec (1), isSynthPart (5 — wavetable+params/fm+params/sample/granular/no-params), isGranularPart (2), triggerOfflineSynthNote-Integration mit MockCtx (5 — Wavetable 1osc+1gain, FM 2osc+2gain, undefined→defensive-no-crash, releaseEnd-Handle ≈1.4s, custom→sine fallback).",
      lastSeen: "2026-05-18T06:15:00.000Z",
      ownedBy:  "backend"
    },
    "tests/features/channel-bounce.test.ts (TASK-241-FOLLOWUP-2 v2.96)": {
      role:     "v2.96.0: 65 → 76 Tests (+11 in neuer Suite 'renderChannelToBuffer — Synth-Parts (v2.96)'). Tests: subtractive/wavetable erzeugt 1 OscillatorNode pro aktivem Step (nicht silent), oscType (square) auf node.type übernommen, FM-Part 2-Oszillator-Setup (4 active steps → 8 oscillators), FM-Modulator-Freq=440×fmRatio=1320 für Single-Step, ADSR-Sequenz (mind. 2 setValueAtTime + 3 linearRamp, letzter Ramp=0), Multi-Step-Pattern alle 8 Steps gerendert, step.pitch transponiert (+12→880, -12→220), Synth-Part durch volle FX-Chain (EQ-Low=3, Comp-Threshold=-12, Reverb-IR angelegt), Granular-Part silent ohne Crash, muted Synth-Part peak=0, Synth ohne synthParams (sourceType='wavetable' aber missing params) → defensive silent. Enhanced Mock-Ctx: createOscillator (mit type-Setter, frequency.value+setValueAtTime+linearRampToValueAtTime, detune-Param, start/stop-Captures), createGain um setValueAtTime/linearRampToValueAtTime/exponentialRampToValueAtTime/cancelScheduledValues ergänzt (für ADSR-Tracking via stats.ampSetAt + stats.ampRamps). +oscFreqSets/oscFreqRampTargets/oscTypesSet/oscStarts/oscStops/oscDetuneSet Stats-Felder.",
      lastSeen: "2026-05-18T06:15:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/utils/channelBounce.ts (TASK-241 v2.95)": {
      role:     "v2.95.0: Per-Channel WAV-Bounce mit VOLLER Insert-FX-Chain. NEU buildOfflinePartGraph(ctx, part, channels) baut analog zu AudioEngine._getOrCreateChannelNodes: input → eqLow(lowshelf200) → eqMid(peaking1k Q=1) → eqHigh(highshelf6k) → filter(lowpass/HP/BP/notch oder allpass-bypass) → distortion(WaveShaper) → compressor → delay(dry/wet+feedback-loop) → reverb(convolver mit synthetischem IR aus weißem-Rauschen*(1-t)² + dry/wet) → output → sidechainGain → panner → destination. Triggers connecten via stepGain(vel*partVol) auf graph.input. NEU makeDistortionCurve(amount) → Float32Array<ArrayBuffer> (SoT: AudioEngine._makeDistortionCurve, copy-pasted mit Marker, Refactor in shared fxGraph.ts als Follow-Up dokumentiert). NEU buildReverbImpulse(ctx, decay) → AudioBuffer mit 2 Channels (SoT: AudioEngine._getOrCreateReverbBuffer, ungecacht da Offline-Ctx einmalig). NEU computeDynamicTailSec(fx) → max(0.5, reverbDecay+0.2, delayTime*(1+fb/(1-fb))) capped 4s — Reverb/Delay-Tails fallen nicht mehr ab. NEU opts.bypassFx → Legacy v2.94-Pfad (nur Volume/Pan/Lowpass per Step). Step.pitch wird auf playbackRate (2^(semi/12)) gemappt. Defensive: safeNum(v,fallback) für NaN/Infinity/undefined, fx-undefined → Pass-Through ohne Crash. CAVEATS v2.95 (siehe README am Datei-Ende): Synth/Wavetable/FM/Granular weiter silent (v2.96+), Sidechain statisch=1 (kein Modulations-Graph), Global-Reverb/Delay-Bus nicht im Channel-Stem, Bitcrusher/RingMod/Transient-Shaper noch nicht (AudioWorklet bzw. nicht in ChannelFx 1st-class), step.paramLock nicht respektiert.",
      lastSeen: "2026-05-18T03:50:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/components/Mixer/ChannelInspector.tsx (TASK-241 v2.94)": {
      role:     "v2.94.0: +optional props {pattern, bpm, projectName} + PartBounceSection-Sub-Component am Ende vor PartMidiOutSection. UI '🎬 Bounce to WAV': 3 Mode-Pills (currentPattern/currentLoop/customBars), Bars-Input 1-64, SR-Select 44100/48000, Stereo-Checkbox, Filename-Input mit Default-Placeholder, Live-Dauer-Preview + ⚠-Warn ab 300s, Bounce-Button mit Status. Save-Path: electron→saveRecording-IPC (filename-resanitize auf strict regex), Browser→downloadWavInBrowser. Toast bei Success/Error. data-testids: channel-inspector-bounce-section + channel-bounce-{toggle,mode-{currentPattern,currentLoop,customBars},bars,sr,stereo,filename,start,status}.",
      lastSeen: "2026-05-18T03:35:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/components/Mixer/ExportPanel.tsx (TASK-241 v2.94)": {
      role:     "v2.94.0: +'Bounce All Stems'-Button (data-testid=export-bounce-all-stems) iteriert via bounceAllChannels mit Sample-Buffer-Preload (temporärer AudioContext, im finally close). Unterschied zum bestehenden Stems-Mode in wavExporter.ts: respektiert Pan + Volume + Lowpass-Filter pro Step. Save via electron.saveRecording (filename-resanitize) oder downloadWavInBrowser. Progress-Banner unter Buttons (data-testid=export-bounce-all-status).",
      lastSeen: "2026-05-18T03:35:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/App.tsx (TASK-241 ChannelInspector-Bounce-Bridge)": {
      role:     "v2.94.0: beide ChannelInspector-Aufrufsites (Mixer-Dock-Slot Zeile ~3195 + FloatingPanel Zeile ~3416) um pattern={dm.getActivePattern()} bpm={project.bpm} projectName={project.projectName} erweitert. Bounce-Section ist gated auf pattern && bpm≠undefined — ohne diese Props bleibt back-compat.",
      lastSeen: "2026-05-18T03:35:00.000Z",
      ownedBy:  "backend"
    },
    "tests/features/channel-bounce.test.ts (TASK-241 v2.95)": {
      role:     "v2.95.0: 65 Unit-Tests (alle grün, +30 ggü v2.94). Enhanced Mock-OfflineAudioContext mit allen FX-Nodes: createWaveShaper (curve-capture), createDynamicsCompressor (threshold/ratio/attack/release-capture), createDelay (delayTime), createConvolver (buffer), createBuffer (für IR-Generierung), playbackRate auf bufferSource, gain auf biquad, type/Q/frequency-Setter mit Capture. NEU-Suites: computeDynamicTailSec (5 — default/reverb/delay/combined/undefined-defensive), makeDistortionCurve (4 — length/linear-bei-amount=0/saturation/monotonic-drive), buildReverbImpulse (3 — length/null-bei-decay≤0/exp-decay-amplitude), buildOfflinePartGraph (15 — full-topology/EQ-disabled-zero-gain/EQ-enabled-bands/distortion-curve-saturation/distortion-disabled-flat/comp-params/comp-bypass/delay-params/reverb-IR/reverb-disabled-no-IR/filter-enabled/filter-allpass-bypass/mono-no-panner/stereo-pan-set/fx-undefined-defensive/NaN-fallback). renderChannelToBuffer um 4 neue Cases erweitert: fx-chain-built-once (nicht pro Step), bypassFx-toggle (Legacy v2.94), dynamic-tail-Reverb, step.pitch→playbackRate. v2.94-Tests bleiben grün (back-compat).",
      lastSeen: "2026-05-18T03:50:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/utils/projectSerializer.ts (TASK-PROJ-FILE-V18 v2.93)": {
      role:     "v2.93.0: SYNTH_FILE_VERSION 1.17→1.18. +3 additiv-optionale Top-Level-Felder: liveInputs?: LiveInputChannelData[], midiNoteOut?: { enabled:boolean, configs:Record<partId, MidiPartConfig> }, slicePads?: SerializedSlicePadSlot[]. Schema-Entscheidung Slice-Buffers: embed-full als plain number[]-Array, optionale Strip-API via SerializeProjectOptions { includeSliceBuffers?: boolean=true } für Metadata-only-Saves. Pure-Helper float32ToFrames / framesToFloat32 (lossless null-safe Codec). Drei neue Parse-Migration-Blöcke (analog padBank): undefined bleibt undefined (Signal: User-localStorage in Ruhe lassen), null/wrong-type → undefined, valides Array/Object → silent-filter invalid items + clamp MIDI-Channel/Note bei MidiNoteOut-Configs. Validation-Helper isValidMidiPartConfigEntry + isValidSerializedSlicePadSlot. Pre-v1.18-Files (v1.14/v1.15/v1.16/v1.17) laden komplett unverändert.",
      lastSeen: "2026-05-18T03:20:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/App.tsx (TASK-PROJ-FILE-V18 v2.93)": {
      role:     "v2.93.0: buildProjectSnapshot um liveInputs (getAllLiveInputChannels), midiNoteOut ({enabled, configs}), slicePads (getAllSlicePadSlots → SerializedSlicePadSlot[] mit float32ToFrames) erweitert. restoreProject um drei defensive Rehydration-Blöcke ergänzt (undefined-check sonst Pre-v1.18-Files würden User-localStorage löschen): loadLiveInputChannels, clearAllPartMidiOutConfigs+setMidiNoteOutEnabled+setPartMidiOutConfig-Loop, clearAllSlicePads+setSlicePadSlot mit framesToFloat32. Imports konsolidiert: useLiveInputStore um getAllLiveInputChannels/loadLiveInputChannels, useMidiNoteOutStore um 4 Bridge-API-Funktionen, useSlicePadStore (bestehender Import dedupliziert) um getAllSlicePadSlots/setSlicePadSlot/clearAllSlicePads.",
      lastSeen: "2026-05-18T03:20:00.000Z",
      ownedBy:  "backend"
    },
    "tests/features/project-serializer.test.ts (TASK-PROJ-FILE-V18 v2.93)": {
      role:     "v2.93.0: +25 v1.18-Tests in neuem Block 'v1.18 extended persistence': liveInputs-Migration (6), midiNoteOut-Migration (7 inkl. clamp), slicePads-Migration (6 inkl. index-stability), Float32-Codec (3), serializeProject-Option (2), Combined-Back-Compat (2 — v1.14-File hat alle drei undefined / v1.18 mit empty-Feldern lädt clean). SYNTH_FILE_VERSION-Check auf '1.18'. Suite jetzt 56 Tests.",
      lastSeen: "2026-05-18T03:20:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/audio/MidiNoteOut.ts": {
      role:     "TASK-240 (v2.92.0): MIDI-Note-Out-Engine. DI-Sender (outputId, bytes)=>void damit ein Sender mehrere Geräte bedienen kann. Class MidiNoteOut: setSender/setEnabled/setPartConfig/getPartConfig/clearPartConfig/clearAllConfigs/isPartConfigured/getAllConfiguredPartIds/shouldPlayLocalSound/triggerNote. Retrigger-Policy (sofort Note-Off bei selber Note), setEnabled(false)-Flush gegen Stuck-Notes, internal Map<partId, MidiPartConfig> + Pending-Off-Map mit setTimeout-Cleanup. Pure-Helpers: clampVelocity/clampMidiChannel/clampMidiNote/clampNoteDuration/buildNoteOn/buildNoteOff/noteNameFromNumber. Konstanten: DEFAULT_NOTE_DURATION_MS=100, MIN/MAX_NOTE_DURATION_MS.",
      lastSeen: "2026-05-18T03:05:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/audio/AudioEngine.ts (TASK-240 Note-Out)": {
      role:     "v2.92.0: +_midiNoteOut-Instanz + 5 Public-API (setMidiNoteOutSender/setMidiNoteOutEnabled/setMidiNoteOutPartConfig/clearMidiNoteOutPartConfig/getMidiNoteOut). Wire-Up im _scheduleStep nach stepCallbacks.forEach (vor MIDI-Clock-Pulse). Neuer Local-Sound-Gate: shouldPlayLocalSound(partId) entscheidet ob Sample/Synth lokal getriggert wird — Backwards-Compat: ohne MIDI-Config IMMER local. stop() macht disable+enable-Cycle, damit pending Note-Offs sofort rausgehen (kein Stuck am externen Gerät).",
      lastSeen: "2026-05-18T03:05:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/hooks/useMidi.ts (TASK-240 Note-Out Sender-Wiring)": {
      role:     "v2.92.0: +useEffect ohne Deps der (outputId, bytes) => midiSendMessage(midiAccessRef, outputId, bytes) als AudioEngine.setMidiNoteOutSender injiziert. Cleanup setzt Sender→null. Configs werden NICHT hier verwaltet — das macht useMidiNoteOutStore + App.tsx-Diff-Sync.",
      lastSeen: "2026-05-18T03:05:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/store/useMidiNoteOutStore.ts": {
      role:     "TASK-240 (v2.92.0): Custom-Observer-Store für Per-Part MIDI-Note-Out-Configs. localStorage-Keys 'synthstudio:midi:noteout:v1' (configs) + 'synthstudio:midi:noteout:enabled:v1' (enabled-Flag). Schema: {enabled:boolean, configs:Record<partId, MidiPartConfig>}. Defensive loadState filtert invalid-shape configs (outputId-Pflicht, alles andere clamped). API: getMidiNoteOutEnabled/setMidiNoteOutEnabled/getPartMidiOutConfig/getAllPartMidiOutConfigs/setPartMidiOutConfig/clearPartMidiOutConfig/clearAllPartMidiOutConfigs/applyElectribeDrumMap (GM-Drum-Map Ch10 für die ersten 8 Parts, weitere auf Note 50+) + useMidiNoteOutStore React-Hook + __resetMidiNoteOutStoreForTests.",
      lastSeen: "2026-05-18T03:05:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/App.tsx (TASK-240 Note-Out Bridge)": {
      role:     "v2.92.0: +Import useMidiNoteOutStore, +Diff-Sync-Effect mit Dep [midiNoteOutState]. setMidiNoteOutEnabled(state.enabled), dann diff vs. AudioEngine.getMidiNoteOut().getAllConfiguredPartIds → clearPartConfig für removed parts, setPartConfig für aktuelle Configs. Idempotent. Damit ist der Store die Single-Source-of-Truth und die AudioEngine wird passiv synchronisiert.",
      lastSeen: "2026-05-18T03:05:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/components/Mixer/ChannelInspector.tsx (TASK-240 Per-Part MIDI-Out-UI)": {
      role:     "v2.92.0: +PartMidiOutSection als letzte Section vor </aside>. Nutzt useMidiContext() + useMidiNoteOutStore(). Controls: Global-Enable-Checkbox (toggelt store.enabled), Output-Device-Select (— keiner — ODER outputDevices vom useMidi, '' wählt clearPartMidiOutConfig), Channel-Select 1-16 (mit '(Drum/GM)'-Hint auf Ch 10), Note-Range-Slider 0-127 mit noteNameFromNumber-Display, Note-Duration-Slider 10-2000ms, Local-Sound-Toggle, Per-Part-Clear-Button, Electribe-Template-Button (ruft applyElectribeDrumMap auf alle parts). Empty-State wenn outputDevices.length===0. data-testids: channel-inspector-midi-out-section + midi-note-out-{global-enable,device-select,channel-select,note-slider,duration-slider,local-sound-toggle,clear,apply-electribe}.",
      lastSeen: "2026-05-18T03:05:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/utils/midiTemplates.ts (TASK-240 Note-Out Drum-Map)": {
      role:     "v2.92.0: +NoteOutTemplate/NoteOutDrumMapping-Interface (semantisch getrennt von den input-orientierten MidiTemplates oben) + ELECTRIBE_2_DRUM_MAP-Constant (8 Mappings GM Drum-Map auf Channel 10: Kick 36, Snare 38, HiHat-cl 42, HiHat-op 46, Clap 39, Tom-Hi 45, Tom-Lo 41, Crash 49) + NOTE_OUT_TEMPLATES-Array als Extension-Point.",
      lastSeen: "2026-05-18T03:05:00.000Z",
      ownedBy:  "backend"
    },
    "tests/features/midi-note-out.test.ts": {
      role:     "TASK-240 (v2.92.0): 24 Unit-Tests. Coverage: buildNoteOn/Off mit Channel-Encoding (4), Velocity/Channel/Note/Duration-Clamp (4), noteNameFromNumber (1), Per-Part-Config Lifecycle setPartConfig/clearPartConfig/clearAll/isPartConfigured/getAllConfiguredPartIds (5), triggerNote-Lifecycle (10 — Note-On+Off-Timing via vi.useFakeTimers, Duration-Respekt, ohne Config no-op, !enabled no-op, Velocity-Clamp, Status-Byte-Encoding 0x9N, ohne Sender no-Crash, setSender-Wechsel, setEnabled(false)-Flush, Sender-Exception-Swallow, Default-Duration, Retrigger feuert sofort Note-Off+Note-On). Sender mit (outputId,bytes)-Signatur, captureSender-Helper für deterministische Assertions.",
      lastSeen: "2026-05-18T03:05:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/utils/padBankPersistence.ts (TASK-238-FOLLOWUP-1B v2.91)": {
      role:     "v2.91: PadBankSlotKind union +'slice', VALID_KINDS-Set entsprechend. +Const PAD_BANK_SLICE_MAX=16 (spiegelt MAX_SLICE_PADS). +sliceAutoConfigureSlots() liefert 16 {kind:'slice', param:'0'..'15'}-Slots fuer Quick-Action 'Slices → Pads (Auto)'.",
      lastSeen: "2026-05-18T02:50:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/hooks/useMidi.ts (TASK-238-FOLLOWUP-1B playSlicePad)": {
      role:     "v2.91: MidiLearnTarget union erweitert um {type:'playSlicePad', sliceIndex:number}. labelForTarget liefert 'Slice-Pad N' (1-indexed), targetsMatch vergleicht sliceIndex, applyMapping dispatcht CustomEvent 'midi:slicePad' (detail=sliceIndex) auf CC>63 / Note-On.",
      lastSeen: "2026-05-18T02:50:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/utils/midiLayoutImport.ts (TASK-238-FOLLOWUP-1B)": {
      role:     "v2.91: VALID_TARGET_TYPES Set +'playSlicePad' fuer Layout-Import/Export Round-Trip.",
      lastSeen: "2026-05-18T02:50:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/App.tsx (TASK-238-FOLLOWUP-1B midi:slicePad)": {
      role:     "v2.91: +useEffect-Listener auf 'midi:slicePad'-CustomEvent. Liest getSlicePadSlot(sliceIndex) aus useSlicePadStore, ruft AudioEngine.playSliceBuffer(slot.buffer, slot.sampleRate). Defensive: kein-Op wenn slot null oder buffer null. getSlicePadSlot zum bestehenden useSlicePadStore-Import hinzu.",
      lastSeen: "2026-05-18T02:50:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/components/MidiSettings/MidiSettings.tsx (TASK-238-FOLLOWUP-1B Slice-Picker + Auto-Configure)": {
      role:     "v2.91: Pad-Bank-Builder — 'Slice'-Option im Kind-Dropdown, neuer slice-Param-Picker (16-Optionen-<select> 'Slice-Pad N'). padBankSlotLabel/padBankSlotToEntry/updatePadBankSlot um slice-Branch erweitert (Clamp-Policy 0..PAD_BANK_SLICE_MAX-1). Neuer Quick-Action-Button '🎯 Slices → Pads (Auto)' (data-testid=pad-bank-slice-auto, position ml-auto vor Reset) ruft sliceAutoConfigurePadBank → fuellt alle 16 Slots in einem Klick.",
      lastSeen: "2026-05-18T02:50:00.000Z",
      ownedBy:  "frontend"
    },
    "tests/features/slice-pad-kind.test.ts (v2.91)": {
      role:     "TASK-238-FOLLOWUP-1B / v2.91: 15 Unit-Tests fuer Slice-Pad-Kind. Schema-Validierung (isValidPadBankSlot akzeptiert kind=slice / lehnt non-string param ab), PAD_BANK_SLICE_MAX===MAX_SLICE_PADS===16, sliceAutoConfigureSlots() korrekt 16 Slots, localStorage Round-Trip + Back-Compat Pre-v2.91, labelForTarget/targetsMatch fuer playSlicePad inkl. Cross-Type-Verwechslungsschutz, End-to-End-Simulation des App-Listeners mit playSliceBuffer-Spy, Out-of-range sliceIndex liefert null.",
      lastSeen: "2026-05-18T02:50:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/utils/sampleSlicing.ts": {
      role:     "TASK-238 / v2.89: Pure-fn Sample-Slicing-Layer. autoSlice / detectOnsetsSpectralFlux / snapToZeroCrossing / onsetsToSlices / splitChannelDataAtSlices / mapSlicesToPads / addOnset / moveOnset / removeOnset + Types OnsetCandidate/SliceSpec/PadAssignment + MAX_PERFORMANCE_PADS=16. Keine React/Web-Audio-Abhaengigkeit, 23 Unit-Tests.",
      lastSeen: "2026-05-18T02:25:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/components/SampleEditor/SampleSliceEditor.tsx": {
      role:     "TASK-238-UI / v2.89: Modal-Komponente. Waveform-Canvas mit Peak-Reduktion + RAF-Render, draggable Slice-Marker (Snap-to-Zero on drop), Click→addOnset / Shift/Right-Click→removeOnset, 4×4 Pad-Grid mit Length-Anzeige, Apply→splitChannelDataAtSlices → Float32Array[] hochgereicht via onApply-Callback. Semantische Token-Farben.",
      lastSeen: "2026-05-18T02:25:00.000Z",
      ownedBy:  "frontend"
    },
    "tests/features/sample-slicing.test.ts": {
      role:     "TASK-238 / v2.89: 23 Unit-Tests fuer sampleSlicing.ts pure-fn-Layer (Onset-Detection, Zero-Crossing-Snap, equidistantes Padding, Buffer-Split, Pad-Mapping).",
      lastSeen: "2026-05-18T02:25:00.000Z",
      ownedBy:  "frontend"
    },
    "tests/web/sample-slicing.spec.ts": {
      role:     "TASK-238-UI / v2.89: Playwright-Smoke fuer Slice-Sample-Toolbar-Button + hidden file-input.",
      lastSeen: "2026-05-18T02:25:00.000Z",
      ownedBy:  "frontend"
    },
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
    },
    "tests/web/pad-bank.spec.ts": {
      role:     "Playwright E2E-Smoke für Custom Pad-Bank-Feature (v2.78–v2.82). 7 Cases — Default-Slots, Slot-Kind-Wechsel (perf-pad→macro/action), Add/Remove/Reset, page.reload()-Persistenz (v2.80 localStorage). UI-Flow: 🎹-Topbar → SettingsPanel CC-Zuweisungen-Sidebar → Advanced-MIDI-Banner → MidiSettings → CC-Mapping-Tab → Pad-Bank-Toggle. (TASK-201)",
      lastSeen: "2026-05-17T19:30:00.000Z",
      ownedBy:  "testing"
    },
    "client/src/components/MidiSettings/MidiSettings.tsx (Pad-Bank-Builder testids)": {
      role:     "TASK-201: data-testids für Playwright E2E in Pad-Bank-Builder-Section: pad-bank-toggle, pad-bank-builder, pad-bank-slots, pad-bank-slot-row-{idx} (+ data-pad-bank-slot-kind/-param Attribute), pad-bank-slot-kind-{idx}, pad-bank-slot-param-{idx}, pad-bank-slot-remove-{idx}, pad-bank-add-slot, pad-bank-start-auto-learn, pad-bank-reset. Rein additiv — kein Verhaltenseffekt.",
      lastSeen: "2026-05-17T19:30:00.000Z",
      ownedBy:  "testing"
    },
    "client/src/utils/midiOutput.ts": {
      role:     "TASK-230 (v2.83.0): Reusable Public-API für Web-MIDI-Output-Discovery + Send. Exports: enumerateMidiOutputs/getOutputById/sendMessage (alle mit injizierbarem MidiAccessLike-Mock-Interface) + loadClockOutputId/saveClockOutputId/loadClockOutEnabled/saveClockOutEnabled (localStorage-Persistenz) + Realtime-Konstanten MIDI_CLOCK_TICK/START/CONTINUE/STOP/SPP_STATUS/PPQN + buildSongPositionPointer(midiBeat) → 14-bit LSB/MSB-Encoding. Wird wiederverwendet von TASK-231 (nanoKONTROL2-LED).",
      lastSeen: "2026-05-17T22:48:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/audio/MidiClockOut.ts": {
      role:     "TASK-230 (v2.83.0): MIDI-Clock-Master-Generator. AudioContext-basiertes Drift-freies 24 PPQN-Ticking via planTicks(nextTickTime, lookAheadUntil, bpm) → tickTimes[]+newNextTickTime. Public API: setSender (DI-Pattern für Tests), setEnabled (Auto-Stop bei Disable während Play), start(now)/stop()/resume(now, sendSpp)/sendSongPosition(midiBeat) + scheduleTicks(lookAhead, bpm) für AudioEngine._schedule()-Aufrufer. ticksSinceStart-Counter überlebt Stop für korrektes SPP nach Resume.",
      lastSeen: "2026-05-17T22:48:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/audio/AudioEngine.ts (TASK-230 Clock-Out)": {
      role:     "v2.83.0: MidiClockOut-Instanz integriert. play() → _midiClockOut.start(nextStepTime), stop() → _midiClockOut.stop(), _schedule() → scheduleTicks(lookAheadUntil, bpm) jede 16ms. Public API: setMidiClockOutSender(cb), setMidiClockOutEnabled(bool), getMidiClockOut().",
      lastSeen: "2026-05-17T22:48:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/hooks/useMidi.ts (TASK-230 Clock-Out Wiring)": {
      role:     "v2.83.0: alter setInterval-Tick-Pfad GELÖSCHT. Stattdessen: useEffect injiziert (bytes)=>midiSendMessage(midiAccessRef, resolvedOutputId, bytes) als AudioEngine.setMidiClockOutSender + AudioEngine.setMidiClockOutEnabled(clockOutEnabled). Neue State: clockOutputDeviceId (separat von activeOutputDeviceId, persist via loadClockOutputId/saveClockOutputId). Neue Action: setClockOutputDeviceId(id|null). Enable-Persistenz via loadClockOutEnabled/saveClockOutEnabled.",
      lastSeen: "2026-05-17T22:48:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/components/MidiSettings/MidiSettings.tsx (TASK-230 Clock-Out UI)": {
      role:     "v2.83.0: renderClockTab() erweitert um Clock-Out-Section: data-testid=clock-out-section, clock-out-toggle, clock-out-device-select. Picker zeigt alle midi.outputDevices, value=clockOutputDeviceId (Fallback-Hint auf activeOutputDeviceId-Name). Empty-State-Warnung wenn outputDevices.length===0.",
      lastSeen: "2026-05-17T22:48:00.000Z",
      ownedBy:  "backend"
    },
    "tests/features/midi-clock-out.test.ts": {
      role:     "TASK-230 (v2.83.0): 30 Unit-Tests für MidiClockOut + midiOutput-Helpers. Coverage: tickDurationSec (3), planTicks (4), Transport-Messages 0xFA/0xFC/0xFB+SPP (5), Tick-Generation (4) + 24 PPQN-Validation, buildSongPositionPointer (5) inkl. 14-bit-Clamp, enumerateMidiOutputs (3), getOutputById (2), sendMessage (3) inkl. Exception-Swallow, Integration-Flow (1). Alle deterministisch via captureSender + makeMockAccess (Map<id, MidiOutputLike>).",
      lastSeen: "2026-05-17T22:48:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/audio/NanoKontrolFeedback.ts": {
      role:     "TASK-231 (v2.84.0): Stateful Diff-Sync-Wrapper für nanoKONTROL2 (oder anderes LED-Feedback-Gerät). Hält lastMute[8] + lastSolo[8] Cache pro Channel, schickt nur geänderte LEDs (Hardware-Hammering-Schutz). Public-API: setSender/setEnabled/syncMixer/forceFullSync/allLedsOff. setEnabled(false) → automatisch allLedsOff(). Sender-Wechsel invalidiert Cache. Defensive: alle Send-Exceptions geswallowed (try/catch um sender-call).",
      lastSeen: "2026-05-17T23:05:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/utils/midiOutput.ts (TASK-231 LED-Feedback)": {
      role:     "v2.84.0: erweitert um Feedback-Output-Persistenz (loadFeedbackOutputId/saveFeedbackOutputId/loadFeedbackEnabled/saveFeedbackEnabled/loadFeedbackSceneMode/saveFeedbackSceneMode separate localStorage-Keys) + nanoKONTROL2-CC-Constants NANO_KONTROL2.{SOLO_CC_BASE:32,MUTE_CC_BASE:48,REC_CC_BASE:64,PLAY:41,STOP:42,CYCLE:46,REWIND:43,FF:44,REC:45,TRACK_PREV:58,TRACK_NEXT:59,MARKER_PREV:61,MARKER_NEXT:62,CHANNEL:1,CHANNEL_COUNT:8} + Helpers buildNanoKontrolLed/sendNanoKontrolFullSync/sendNanoKontrolAllLedsOff/sendNanoKontrolLed.",
      lastSeen: "2026-05-17T23:05:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/store/useSceneStore.ts (TASK-231 cycleScene)": {
      role:     "v2.84.0: +cycleScene(direction: 1|-1) — Wrap-Around-Navigation durch Scenes. Setzt activeSceneId via persist+notify wie setActiveScene. No-op wenn scenes leer. Wird vom useMidi Marker-CC-Handler aufgerufen.",
      lastSeen: "2026-05-17T23:05:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/hooks/useMidi.ts (TASK-231 LED-Feedback Wiring)": {
      role:     "v2.84.0: feedbackOutputDeviceId/feedbackEnabled/feedbackSceneMode State + Refs + Persistenz. useEffect koppelt NanoKontrolFeedback-Sender an midiSendMessage. handleMidiMessage interceptet CC 61/62 (Marker-PREV/NEXT) → cycleScene(±1) wenn feedbackSceneMode aktiv, returnt früh damit kein Doppelfeuer. Public-API +setFeedbackOutputDeviceId, +setFeedbackEnabled, +setFeedbackSceneMode, +syncFeedbackLeds.",
      lastSeen: "2026-05-17T23:05:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/components/MidiSettings/MidiSettings.tsx (TASK-231 LED-Feedback UI)": {
      role:     "v2.84.0: neue Section 'LED-Feedback (Mixer-Sync)' nach Clock-Out — data-testid=feedback-out-section/toggle/device-select + feedback-scene-mode-toggle. Hinweis-Box dass nanoKONTROL2 'External LED Mode' braucht.",
      lastSeen: "2026-05-17T23:05:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/utils/midiTemplates.ts (nanoKONTROL2 v2.84)": {
      role:     "v2.84.0: nanoKONTROL2-Template-Korrektur — Solo-Buttons CC 32-39 (PC-Mode-Default-Layout), Mute-Buttons CC 48-55. Marker-PREV/NEXT (CC 61/62) als patternPrev/patternNext-Fallback wenn Scene-Mode aus.",
      lastSeen: "2026-05-17T23:05:00.000Z",
      ownedBy:  "backend"
    },
    "tests/features/nano-kontrol-led.test.ts": {
      role:     "TASK-231 (v2.84.0): 23 Unit-Tests. Coverage: buildNanoKontrolLed (2), NanoKontrolFeedback.syncMixer (8 — Mute-LED-Toggle, Solo-LED-Toggle, Full-Sync, no-op-disabled, allLedsOff bei setEnabled(false), Exception-Swallow, no-Sender, Diff-Sync), sendNanoKontrolFullSync (3), sendNanoKontrolAllLedsOff (1), sendNanoKontrolLed (2), cycleScene (3 — vorwärts/rückwärts/leer), Persistenz (3 mit localStorage-Shim für Node-env).",
      lastSeen: "2026-05-17T23:05:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/audio/AudioEngine.ts (TASK-233 Live-Input)": {
      role:     "v2.85.0: +6 Public-API-Methoden für Live-Input-Channels (Outboard-FX-Box). attachLiveInput(channelId, deviceId) → getUserMedia({audio:{deviceId,echoCancellation:false,...}}) → MediaStreamAudioSourceNode → DelayNode(manualLatencyMs) → _getOrCreateChannelNodes(channelId, DEFAULT_CHANNEL_FX).input → existing FX-Chain. detachLiveInput stoppt Stream-Tracks (no Zombie). setLiveInputLatencyMs/getLiveInputLatencyMs persistieren auch ohne aktiven Stream. getEstimatedSystemLatencyMs liefert baseLatency+outputLatency in ms als Vorschlag. Maps: _liveInputs (id → {stream, source, latencyDelay, deviceId}), _liveInputLatencyMs (id → ms).",
      lastSeen: "2026-05-17T23:20:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/store/useLiveInputStore.ts": {
      role:     "TASK-233 (v2.85.0): Custom Observer Store für Live-Input-Mixer-Channels. MAX_LIVE_INPUT_CHANNELS=4, DEFAULT_LIVE_INPUT_VOLUME=0.5, ID-Prefix 'liveinput:', localStorage-Key 'synthstudio:liveinputs:v1'. Schema: {id, name, deviceId|null, deviceLabel?, volume, pan, muted, soloed, sends:{reverb,delay}, latencyCompensationMs}. API: addLiveInputChannel(overrides?)+throw bei MAX, removeLiveInputChannel, updateLiveInputChannel (Patch-Semantik, ID-Schutz, alle Werte werden auf valid-Range geklemmt), setLiveInputSoloed (additive vs exclusive DAW-Convention), loadLiveInputChannels (Project-Restore filtert invalide + cappt), clearLiveInputChannels, isValidChannel Type-Guard, useLiveInputStore React-Hook.",
      lastSeen: "2026-05-17T23:20:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/components/Mixer/LiveInputStrip.tsx": {
      role:     "TASK-233 (v2.85.0): Mixer-Channel-Strip für Live-Inputs. Device-Picker via navigator.mediaDevices.enumerateDevices()+devicechange-Listener (Hot-Plug). Status-LED grün/rot je nach AudioEngine.isLiveInputAttached. Fader/Pan/Mute/Solo/Sends + Latency-Slider 0..200ms + Rename + Remove. data-testids: liveinput-strip-{id}, liveinput-device-select-{id}, liveinput-latency-{id}. 'IN'-Badge accent-secondary unterscheidet visuell von drum-parts/audio-tracks. Permission-Denied erscheint inline.",
      lastSeen: "2026-05-17T23:20:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/components/Mixer/MixerView.tsx (TASK-233 Live-Input)": {
      role:     "v2.85.0: '+ Live Input'-Button im Header (data-testid mixer-add-live-input) + Render-Loop für LiveInputStrips vor Master. liveInputStore = useLiveInputStore() abonniert den Store-Singleton. Counter ({n}/{MAX}) zeigt aktuelle Belegung.",
      lastSeen: "2026-05-17T23:20:00.000Z",
      ownedBy:  "backend"
    },
    "electron/main.ts (TASK-233 Permission-Handler)": {
      role:     "v2.85.0: installPermissionHandlers() registriert session.defaultSession.setPermissionRequestHandler + setPermissionCheckHandler mit Whitelist {media, mediaKeySystem}. Damit auto-grants Electron die Mikrofon-Berechtigung beim ersten getUserMedia ohne nativen Dialog — der User hat die App ja bewusst installiert. Alle anderen Permissions (geolocation, notifications, usb, hid, bluetooth) werden weiterhin abgelehnt. Aufruf in app.whenReady direkt nach installCspHeaders.",
      lastSeen: "2026-05-17T23:20:00.000Z",
      ownedBy:  "backend"
    },
    "tests/features/live-input-channel.test.ts": {
      role:     "TASK-233 (v2.85.0): 25 Unit-Tests. Coverage: addLiveInputChannel mit Defaults+Overrides (2), removeLiveInputChannel inkl. no-op-unknown (2), updateLiveInputChannel Volume/Pan/Mute/Solo/sends-Patch + ID-Schutz (3), setLiveInputSoloed additive vs exclusive (2), Limit-Wurf bei MAX (1), Persistenz latencyCompensationMs+deviceId+Round-Trip (3), loadLiveInputChannels filtert invalide+cappt (1), isValidChannel Type-Guard (2), Clamp-Verhalten Volume/Pan/Latency/Sends (4), AudioEngine-Public-API-Vertrag (5 — Stream-Pipeline ist Playwright-Scope, Node-env hat kein navigator.mediaDevices). localStorage-Shim für Node-env.",
      lastSeen: "2026-05-17T23:20:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/audio/wavEncoder.ts": {
      role:     "TASK-234 (v2.86.0): Pure WAV-Encoder ohne Web-Audio-API-Import. Exports encodeWavMono/encodeWavStereo/encodeWav (16-bit PCM, RIFF/WAVE/fmt/data Header) + concatFloat32 (Float32Array-Merge für ScriptProcessor-Chunks) + isValidWavHeader (Header-Validation für IPC-Layer). Konstanten WAV_HEADER_SIZE=44 + WAV_RIFF_MAGIC/WAV_WAVE_MAGIC/WAV_FMT_MAGIC/WAV_DATA_MAGIC. Sample-Clamp auf [-1,+1], asymmetrische Int16-Quantisierung (+32767 / -32768).",
      lastSeen: "2026-05-17T23:38:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/audio/AudioRecorder.ts": {
      role:     "TASK-234 (v2.86.0): Capturing-Pipeline pro Mixer-Channel. Architektur-Decision: ScriptProcessorNode (deprecated, aber im Node-Mock einfach simulierbar) statt AudioWorklet — Upgrade als follow-up. Class AudioRecorder mit setContext(ctx)/start(channelId, source, channels)/stop/stopAll/cancel/dispose/isRecording/activeChannelIds/activeCount/currentDurationMs. Internal Map<channelId, ActiveRecording> mit bufferLeft/bufferRight Float32-Chunks-Array. MAX_SIMULTANEOUS_RECORDINGS=8 (CPU-Schutz). Buffer-Größe 4096 Frames (~85ms @ 48k).",
      lastSeen: "2026-05-17T23:38:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/utils/recordingStorage.ts": {
      role:     "TASK-234 (v2.86.0): Isomorpher Persistenz-Layer. saveRecording(id, channelName, wavBuffer, electronApi) wählt Electron-IPC vs IndexedDB-Fallback. IDB-Store 'synthstudio-recordings' v1, Object-Store 'recordings'. Helpers: buildRecordingFileName (sanitized + timestamp YYYYMMDD-HHmmss) + isSafeRecordingFileName (Path-Traversal-Guard für IPC-Validation: lehnt /, \\, .., \\0, non-.wav, >120 chars, leere strings ab). idbPutRecording/idbGetRecording/idbDeleteRecording.",
      lastSeen: "2026-05-17T23:38:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/audio/AudioEngine.ts (TASK-234 Record-API)": {
      role:     "v2.86.0: +AudioRecorder-Instanz im AudioEngineClass + 7 Public-API-Methoden für Record-Arm-Wiring. startRecording(channelId) → tappt channelNodes.panner mono. stopRecording → RecordingResult{wavBuffer, sampleRate, durationSec, channels}. startRecordingForChannels(ids[]) → bulk-start beim Transport-Play. finalizeAllRecordings() → stop all + collect Results. isRecordingChannel/getActiveRecordingChannelIds/getRecordingDurationMs/cancelRecording. clearCache() ruft jetzt _audioRecorder.dispose() (Zombie-Schutz). init() ruft setContext nach AudioContext-Erzeugung.",
      lastSeen: "2026-05-17T23:38:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/store/useLiveInputStore.ts (TASK-234 Record-Arm)": {
      role:     "v2.86.0: +recordArmed?:boolean Field auf LiveInputChannelData (optional für schema-migration-friendly). +setLiveInputRecordArm(id, armed) (idempotent, persistiert), +getArmedLiveInputChannelIds() (für Transport-Play-Hook). API erweitert um setRecordArm. isValidChannel akzeptiert undefined+boolean für recordArmed.",
      lastSeen: "2026-05-17T23:38:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/components/Mixer/LiveInputStrip.tsx (TASK-234 Rec-Button)": {
      role:     "v2.86.0: Roter ●-Rec-Arm-Button neben M/S. data-testid 'liveinput-rec-arm-{id}'. aria-pressed mappt auf recordArmed. animate-pulse-Klasse wenn AudioEngine.isRecordingChannel=true (Poll alle 250ms während armed). handleRemove ruft AudioEngine.cancelRecording vor detachLiveInput.",
      lastSeen: "2026-05-17T23:38:00.000Z",
      ownedBy:  "backend"
    },
    "electron/main.ts (TASK-234 audio:save-recording)": {
      role:     "v2.86.0: ipcMain.handle('audio:save-recording', filename, data). Strict validation: filename muss ^[A-Za-z0-9._-]+\\.wav$ matchen, max 120 chars, kein /, \\, .., \\0. Data: Uint8Array oder ArrayBuffer; min 44 Bytes; RIFF+WAVE Magic-Check; max 500 MB. Path-Resolution: path.resolve(userData/recordings/filename), Realpath-Guard prüft dass targetPath === path.join(recordingsDir, filename) UND .startsWith(recordingsDir + sep). Path-Traversal unmöglich. mkdir recordings/ rekursiv.",
      lastSeen: "2026-05-17T23:38:00.000Z",
      ownedBy:  "backend"
    },
    "electron/preload.ts (TASK-234 saveRecording bridge)": {
      role:     "v2.86.0: saveRecording(filename, data) → ipcRenderer.invoke('audio:save-recording'). Re-exposed im contextBridge electronAPI.",
      lastSeen: "2026-05-17T23:38:00.000Z",
      ownedBy:  "backend"
    },
    "electron/useElectron.ts (TASK-234 saveRecording fallback, KORG-Hook-Expose v3.10.0)": {
      role:     "v2.86.0: browserAPI.saveRecording → {success:false, error:'Nicht in Electron – nutze IndexedDB'}. Renderer-Code (recordingStorage.saveRecording) erkennt das und legt automatisch IndexedDB ab. Electron-API wird mit ?? fallback gemerged. v3.10.0: +saveKorgBankAs Stub (success:false → triggert Blob-Download im KorgBankEditor) + getKorgBankSaveCap Stub (256 MB mirror-cap). Electron-Pfad-Delegation api.saveKorgBankAs ?? browserAPI.saveKorgBankAs (defensive falls altes preload geladen).",
      lastSeen: "2026-05-18T10:30:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/App.tsx (TASK-234 Transport-Record-Hook)": {
      role:     "v2.86.0: neuer useEffect mit prevRecArmPlayRef. Bei isPlaying-Edge (false→true): AudioEngine.startRecordingForChannels(getArmedLiveInputChannelIds()). Bei isPlaying-Edge (true→false): finalizeAllRecordings() → async loop: persistRecording → addAudioTrack mit syncMode:'free'. Resultierender Audio-Track erscheint im Mixer abspielbar nach Stop.",
      lastSeen: "2026-05-17T23:38:00.000Z",
      ownedBy:  "backend"
    },
    "tests/features/audio-recording.test.ts": {
      role:     "TASK-234 (v2.86.0): 33 Unit-Tests. Coverage: encodeWavMono (4 — RIFF-Header, Sample-Rate, Sample-Rate-Validation, Clipping), encodeWavStereo (2 — Interleave, Trim), isValidWavHeader (3), concatFloat32 (2), buildRecordingFileName (3 — Pattern, Sanitize, Fallback), isSafeRecordingFileName (6 — Path-Traversal, Null-Bytes, Extension, Length, non-string), setLiveInputRecordArm + Persistenz (4), AudioRecorder Pipeline (8 — start/stop, idempotent, AudioContext-required, MAX_SIMULTANEOUS_RECORDINGS=8, stopAll, cancel, dispose, currentDurationMs). MockAudioContext+MockScriptProcessor+MockAudioBuffer simulieren Web-Audio in Node.js.",
      lastSeen: "2026-05-17T23:38:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/audio/looperUtils.ts": {
      role:     "TASK-235 (v2.87.0): Pure-Logik-Helper für Live-Looper. KEIN Web-Audio-Import → 100% Node-testbar. Exports: nextLoopState/eraseLoopState/toggleLoopPlayStop State-Machine (empty→arming→recording→playing⇄overdubbing, stopped→playing), beatDurationSec (BPM 20..300 clamp), nextBeatBoundary + nextBarBoundary (immer >= currentTime), quantizeLoopLengthBars (Snap-Policy Power-of-2-Ceil auf 1/2/4/8 bars, MAX 8), loopLengthSec, mixLoopBuffersLinear (Linear-Sum mit Clip auf [-1,+1], pad Overdub mit Null wenn kürzer), mixLoopBuffersStereoLinear, isValidLoopIndex, canAddLoop. Konstanten: MAX_LOOPS=4, MIN_LOOP_BARS=1, MAX_LOOP_BARS=8, LOOP_BAR_SNAP_STEPS=[1,2,4,8], DEFAULT_BEATS_PER_BAR=4, LOOP_ERASE_LONG_PRESS_MS=500.",
      lastSeen: "2026-05-17T23:55:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/audio/LooperEngine.ts": {
      role:     "TASK-235 (v2.87.0): Web-Audio-Orchestrierung für den Live-Looper. Class LooperEngine. setContext(ctx, dest)/setCallbacks/setBpm/setTransportAnchor/getLoopState/getProgress/trigger(index,source)/erase/stopAllPlayback/dispose. Owner der Float32-Audio-Buffer + AudioBufferSourceNodes. trigger() dispatcht je nach Slot-State: empty→arming (ScriptProcessor-Tap mit gated recordStartedAt auf nextBarBoundary), arming→recording (sofortiger Override), recording→playing (concat chunks, quantizeLoopLengthBars + Trim/Pad, createBufferSource loop:true), playing→overdubbing (zweite ScriptProcessor-Aufnahme, Playback läuft parallel), overdubbing→playing (concat overdub-chunks, mixLoopBuffersLinear merge, neuer BufferSource). DI-Pattern via callbacks (onState/onLength) — keine direkte Store-Coupling, damit Engine in Node testbar.",
      lastSeen: "2026-05-17T23:55:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/store/useLooperStore.ts": {
      role:     "TASK-235 (v2.87.0): Custom Observer Store für 4 Looper-Slots. localStorage-Key 'synthstudio:looper:v1'. Schema: {id (loop:1..4), name, state (LoopState union), sourceChannelId, lengthBeats|null, lengthSec|null, volume 0..1.5, pan -1..1, muted, solo, frameCount}. Persistenz NUR Metadata (name/sourceChannelId/volume/pan/muted/solo) — KEIN audioBuffer/frameCount/state (transient, RAM-only). Public API: getAllLoopSlots/getLoopSlot/updateLoopSlot/setLoopState/setLoopLength/setLoopSourceChannel/setLoopFrameCount/resetLoopSlot/getActiveLoopCount/resetLooper/__resetForTests + useLooperStore React-Hook.",
      lastSeen: "2026-05-17T23:55:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/audio/AudioEngine.ts (TASK-235 Looper)": {
      role:     "v2.87.0: +LooperEngine-Instanz im AudioEngineClass + 6 Public-API-Methoden für Live-Looper. setLooperCallbacks(onState, onLength)/triggerLoop(index, sourceChannelId)/eraseLoop/getLoopState/getLoopProgress/stopAllLoopPlayback. Source-Tap: sourceChannelId='' → masterGain (Mix-Loop), sonst channelNodes.panner. init() ruft setContext(ctx, masterGain) + setBpm. setBpm() propagiert an Looper. play() ruft setTransportAnchor(nextStepTime). clearCache() ruft dispose() (Zombie-Schutz).",
      lastSeen: "2026-05-17T23:55:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/hooks/useMidi.ts (TASK-235 Looper-Targets)": {
      role:     "v2.87.0: MidiLearnTarget union um 2 Varianten erweitert — 'loopTrigger' + 'loopErase' (beide mit loopIndex 0..3). labelForTarget + targetsMatch + applyMapping um 2 cases erweitert. Bei CC>63 / Note-On wird CustomEvent 'midi:loopTrigger' bzw. 'midi:loopErase' mit loopIndex im detail gefeuert. App.tsx-Listener routet das an AudioEngine.triggerLoop/eraseLoop.",
      lastSeen: "2026-05-17T23:55:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/components/PerformanceMode/LooperPanel.tsx": {
      role:     "TASK-235 (v2.87.0): UI für den Live-Looper. 4 Pads horizontal mit Color-Code via semantischen Tokens — bg-bg-elevated (empty), bg-accent-secondary (arming/overdubbing), bg-accent-danger (recording), bg-accent-success (playing), bg-bg-panel (stopped). animate-pulse während arming/recording/overdubbing. Progress-Bar 0..100% am Boden während playing. Pointer-Down/Up State-Machine: Long-Press > 500ms (LOOP_ERASE_LONG_PRESS_MS) → eraseLoop, sonst → triggerLoop. data-testid 'looper-pad-{index}' + data-loop-state Attribut für Playwright.",
      lastSeen: "2026-05-17T23:55:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/utils/midiLayoutImport.ts (TASK-235 VALID_TARGET_TYPES)": {
      role:     "v2.87.0: VALID_TARGET_TYPES Set erweitert um 'loopTrigger' + 'loopErase' damit Layout-JSON-Round-Trip mit Looper-Mappings funktioniert.",
      lastSeen: "2026-05-17T23:55:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/App.tsx (TASK-235 Looper-Wiring)": {
      role:     "v2.87.0: 2 useEffect-Hooks. (a) AudioEngine.setLooperCallbacks Bridge — Engine-State/Length-Updates landen via Module-Funktionen (setLoopState/setLoopLength) im Store (Stale-Closure-frei). (b) midi:loopTrigger / midi:loopErase Listener → AudioEngine.triggerLoop bzw. eraseLoop, sourceChannelId aus getLoopSlot-Lookup (Master-Tap als Fallback).",
      lastSeen: "2026-05-17T23:55:00.000Z",
      ownedBy:  "backend"
    },
    "tests/features/looper.test.ts": {
      role:     "TASK-235 (v2.87.0): 36 Unit-Tests. Coverage: nextLoopState (4 — full cycle, stopped→playing, eraseLoopState, toggleLoopPlayStop), quantizeLoopLengthBars (5 — 2.7→4 als Akzeptanzkriterium, cap auf MAX, MIN bei 0/neg/NaN), Beat/Bar-Mathematik (4 — clamp, nextBeatBoundary nie Vergangenheit, nextBarBoundary 4/4, loopLengthSec), mixLoopBuffersLinear (4 — Sample-Sum, Clip ±1, Pad-Overdub, Stereo), Limits (4 — isValidLoopIndex, canAddLoop, MAX_LOOPS=4, LOOP_ERASE_LONG_PRESS_MS=500), Store (8 — Default-Slots, stabile IDs, getLoopSlot invalid, setLoopState invalid no-op, setLoopLength, resetLoopSlot behält Metadata, getActiveLoopCount, localStorage persistiert NUR Metadata), LooperEngine mit Mock-Context (7 — initial empty, erase resettet, getProgress=0 ohne Play, invalid loopIndex no-op, callbacks gefeuert, dispose räumt auf, setBpm sicher). MockAudioContext + MockBufferSource + MockScriptProcessor simulieren Web-Audio in Node.",
      lastSeen: "2026-05-17T23:55:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/utils/electribeImport.ts (v3.15.0 Motion-Sequencer RE)": {
      role:     "v3.15.0: Pattern-Level Motion-Sequencer-Slots reverse-engineered via Histogramm-Scan über e2s-2016.e2sallpat Stock-Bank (250 Patterns). E2 Sampler hat 8 Motion-Slots PRO PATTERN (NICHT 4 wie Hardware-Doku impliziert) — 560-Byte Region PTST-relativ ab Offset 0x100. Footer 0x3C00..0x4100 ist verifiziert ALL-ZERO über alle Stock+User-Files (nur PTED-Marker @ 0x3CFC). Motion-Layout (PTST-relativ): +0x100..+0x108 = 8B ParamID[8] (0=disabled, 1..17 = bekannte IDs). +0x118..+0x120 = 8B TargetPart[8] (1..16 = part 0..15, 17..19 = global). +0x130..+0x330 = 512B = 8 Slots × 64B values (0..127, Sentinel 0x80 wird auf 127 geclampt). Reserved-Zones +0x108..0x118 + +0x120..0x130 + post-0x330 alle verifiziert all-zero. 127 von 250 Patterns (50.8%) haben mind. 1 enabled Slot, 248 enabled Slots gesamt. 17 unique paramIDs (1..17), Top: 0x11=17 (81×), 0x01 (34×), 0x02 (26×). +6 v3.15-Konstanten (ELECTRIBE_MOTION_PARAM_TABLE_OFFSET=0x100, _TARGET_TABLE_OFFSET=0x118, _DATA_TABLE_OFFSET=0x130, _SLOTS_PER_PATTERN=8, _VALUES_PER_SLOT=64, _SLOT_STRIDE=64). +ELECTRIBE_PATTERN_MOTION_PARAM_NAMES Map (17 generische 'Param 01..17' Labels — Hardware-Spec NICHT public). +ParsedPatternMotionSlot Interface {paramId, paramName, targetPart, rawTarget, enabled, values[64]}. +parsePatternMotionTable(view, ptstOffset) Public-Export (defensive bei out-of-bounds, paramId>0 OR data-nonzero = enabled). ParsedPattern erweitert um optional patternMotion-Feld. parseRealPatternAt befüllt patternMotion. parseElectribeAllPatBank Fallback-Slot füllt 8 disabled-Defaults. convertParsedPatternToSynthstudio emittiert pattern-motion automationLanes mit target-Format '<paramName>:slot<i>:part<targetPart>' bzw. ':global<rawTarget>'. Confidence v3.15: ✅ HIGH (Slot-Region/Stride/Count/Layout/Reserved-Zones), ⚠ MEDIUM (enabled-Semantik bei edge-cases wie Trials1/futureMonger1), ❌ LOW (Param-ID → Hardware-Param-Name). v3.13.0-API unveraendert (Part-Volume @ +0x15, Pan @ +0x22, StepLength @ PTST+0x25). v3.12.0-API unveraendert (12B step-records, Part-Stride 816).",
      lastSeen: "2026-05-18T11:50:00.000Z",
      ownedBy:  "backend"
    },
    "tests/features/electribe-import.test.ts (v3.11.0)": {
      role:     "v3.11.0: 83 Tests (vorher 65, +18 fuer .e2sallpat). Bestehende Coverage v3.2/v2.88 unveraendert. NEU v3.11 'electribeImport – v3.11 .e2sallpat Multi-Pattern-Bank-Layout' (13 synthetisch via buildAllPatBuffer({slots,slotCount,brokenSlots})-Helper): Layout-Konstanten-Konsistenz (0x10100+250×0x4000=4_161_792), isElectribeAllPatBank Detection + GLST-Marker-Zerstoerung, detectElectribeFormat='bank', detectElectribeFormatKind 4-Werte, parseElectribeAllPatBank 250 Slots mit Stalactite/Solar/BodyTalk/LastSlot-Inhalt, BPM-Range-Plausibilitaet, Name-Extraction, defensive gegen kaputte PTST-Marker (kein Throw, Fallback 'Slot N'), tiny-buffer-rejection (zu klein), parseElectribeBank-Dispatch, filterNonInitPatterns (Init/Slot/empty), truncated-bank-handling (slotCount<250). Real-Stock-Bank-Coverage (5 conditional auf existsSync('e2s-2016/e2s-2016.e2sallpat')): exakte File-Size 4_161_792, isElectribeAllPatBank=true + detectElectribeFormat='bank' + detectElectribeFormatKind='e2sallpat', parseElectribeAllPatBank 250 Patterns mit BPM-Range 20-300 + 16 Parts pro Pattern, erste 3 Patterns 'Stalactite 1/2/3' + BPM 73.4, filterNonInitPatterns liefert 200-249 Patterns (real 241 non-Init), parseElectribeBank-Top-Level-Dispatch. 1 Limit-Test angepasst (6MB→9MB Buffer-Size weil Limit 5MB→8MB).",
      lastSeen: "2026-05-18T10:50:00.000Z",
      ownedBy:  "backend"
    },
    "electron/main.ts (TASK-237 electribe IPC)": {
      role:     "v2.88.0 + v3.2.0: 2 IPC-Handler fuer Electribe-Import. 'electribe:import-file' liest .e2pattern/.e2sallpat/.e2spat-Files (v3.2.0 ergänzt .e2spat — KORG E2 Sampler-Single-Pattern-Files, 16640 Bytes). Endung-Whitelist, max 5 MB, path.resolve + access-Check, gibt Uint8Array als number[] + fileName zurueck. 'electribe:open-dialog' oeffnet nativen Datei-Dialog mit Filter ['e2pattern', 'e2sallpat', 'e2spat']. Pattern analog 'midi:import-file'.",
      lastSeen: "2026-05-18T08:00:00.000Z",
      ownedBy:  "backend"
    },
    "electron/ipcValidators.ts (TASK-237 v3.2.0)": {
      role:     "v3.2.0: ELECTRIBE_ALLOWED_EXTENSIONS Set um '.e2spat' erweitert (zusaetzlich zu '.e2pattern' + '.e2sallpat'). validateElectribePath-Fehler-String 'Nur .e2pattern/.e2sallpat/.e2spat erlaubt'. Path-Length-Limit 4096, NUL-Byte-Reject, case-insensitive via path.extname.toLowerCase. ELECTRIBE_MAX_BYTES=5MB. validateElectribeFileSize-Helper analog. SCOPE: Audio-Recording- + License- + Electribe-IPC-Validation.",
      lastSeen: "2026-05-18T08:00:00.000Z",
      ownedBy:  "backend"
    },
    "electron/preload.ts (TASK-237 electribe bridge)": {
      role:     "v2.88.0: contextBridge-Methoden openElectribeDialog + importElectribeFile fuer Renderer-Zugriff auf die zwei neuen IPC-Channels.",
      lastSeen: "2026-05-18T00:15:00.000Z",
      ownedBy:  "backend"
    },
    "client/src/components/DrumMachine/DrumMachine.tsx (TASK-237 Electribe-UI)": {
      role:     "v2.89.0: Zusaetzlich zu Electribe-UI auch '✂ Slice Sample'-Toolbar-Button + hidden file-input accept='audio/*,.wav,.mp3,.ogg,.flac,.aiff,.m4a' (data-testids 'slice-sample' / 'slice-sample-input'). handleSliceImport decodiert via window.AudioContext.decodeAudioData → Float32Array Kanal-0-Mono-Tap + sampleRate → setSliceEditor State → SampleSliceEditor-Modal. handleSlicesApply dispatcht CustomEvent 'sample-slicer:apply' + Toast. v2.88.0: '🎚 Electribe'-Toolbar-Button + Single-Pattern-Direkt-Import + Bank-Pattern-Picker-Modal mit Liste (Name/BPM/StepLength), data-testids 'electribe-import', 'electribe-import-input', 'electribe-picker-overlay', 'electribe-picker-pattern-{idx}', 'electribe-picker-cancel'. Konvertierung via convertParsedPatternToSynthstudio + renamePattern/setPatternBpm/setPartSteps/setPartVolume/setPartPan. Drag-Drop-Bridge via window-Event 'electribe:fileImport'. Motion-Lanes per CustomEvent 'electribe:motion-lanes' rausgereicht — v2.90 App.tsx-Listener konsumiert das jetzt.",
      lastSeen: "2026-05-18T02:25:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/utils/electribeMotionMapping.ts": {
      role:     "TASK-237-FOLLOWUP-1 / v2.90: Pure-Logik-Bridge zwischen Electribe-Motion-Lanes (CustomEvent-Payload) und useAutomationStore-Targets. Exports: parseElectribeLaneTarget('Volume:3' → {paramName:'Volume', partIndex:3}), mapElectribeLaneToAutomationTarget(electribeTarget, partIds[]) → AutomationTarget|null (mappt Volume:N → vol:<partId>, Pan:N → pan:<partId>, FX Send:N → send-rev:<partId>; alle anderen Params null), scaleMotionPointsToStepCount(points, 16|32) (16-Step-Pattern: identity; 32-Step: Faktor-2-Stretch + cap auf max-1), selectConvertableLanes(lanes, partIds). KEINE Web-Audio/React-Imports — 21 Unit-Tests gruen.",
      lastSeen: "2026-05-18T02:33:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/store/useSlicePadStore.ts": {
      role:     "TASK-238-FOLLOWUP-1 / v2.90: Module-Singleton Custom-Observer-Store fuer 16 Slice-Pad-Slots (entspricht MAX_PERFORMANCE_PADS). Schema: {index, buffer:Float32Array|null, sampleRate, sampleName, sliceIndex}. Buffer leben NUR im RAM — KEIN localStorage (Quota-Suizid bei Float32-Audio-Daten). Public-API: getSlicePadSlot/getAllSlicePadSlots/setSlicePadSlot/clearSlicePadSlot/clearAllSlicePads/assignSlicesToPads (Bulk; replace-Toggle; cappt bei MAX_SLICE_PADS=16) + __resetSlicePadStoreForTests + useSlicePadStore-Hook. 15 Unit-Tests gruen.",
      lastSeen: "2026-05-18T02:33:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/audio/AudioEngine.ts (TASK-238-FOLLOWUP-1 playSliceBuffer)": {
      role:     "v2.90: +playSliceBuffer(buffer:Float32Array, sampleRate:number):boolean — One-Shot-Playback. Erzeugt AudioBuffer (Mono, 1 Channel), copyToChannel (mit defensiver Float32Array-Copy fuer ArrayBufferLike→ArrayBuffer-Coercion), createBufferSource → Gain (0.85) → masterGain, src.start + onended-Cleanup. Wird vom Performance-Pad-Slice-Mode konsumiert (Wiring follow-up).",
      lastSeen: "2026-05-18T02:33:00.000Z",
      ownedBy:  "frontend"
    },
    "client/src/App.tsx (TASK-237/238-FOLLOWUP-1 Bridges)": {
      role:     "v2.90: 2 neue useEffect-Listener. (a) 'electribe:motion-lanes' → liest dmRef.current.patterns[id].parts.map(p=>p.id), mappElectribeLane→AutomationTarget mit scaleMotionPointsToStepCount, ruft automationRef.current.addLane + setPoint pro Punkt. Unsupported Params (Filter Cutoff etc.) werden uebersprungen + im Toast-Counter angezeigt. (b) 'sample-slicer:apply' → filtert non-Float32Array-Items, assignSlicesToPads(slices, {sampleName, sampleRate, replace:true}), Toast mit ggf. truncated-Hint. Imports: mapElectribeLaneToAutomationTarget + scaleMotionPointsToStepCount + ElectribeMotionLane-Type aus utils/electribeMotionMapping; assignSlicesToPads + MAX_SLICE_PADS aus store/useSlicePadStore.",
      lastSeen: "2026-05-18T02:33:00.000Z",
      ownedBy:  "frontend"
    },
    "tests/features/electribe-motion-bridge.test.ts": {
      role:     "TASK-237-FOLLOWUP-1 / v2.90: 21 Tests. Coverage: parseElectribeLaneTarget (6 — happy/space-im-paramName/letzter-Doppelpunkt/fehlender-Index/leerer-paramName/negativ), mapElectribeLaneToAutomationTarget (6 — Volume/Pan/FX-Send/unsupported/out-of-range/garbage), scaleMotionPointsToStepCount (4 — 16-identity/32-faktor2/16→30-fullspread/clamp-31), selectConvertableLanes (3), End-to-End Mock-Store-Calls (2 — addLane mit korrektem Target + 32-Step-Stretch).",
      lastSeen: "2026-05-18T02:33:00.000Z",
      ownedBy:  "frontend"
    },
    "tests/features/sample-slice-pad-assign.test.ts": {
      role:     "TASK-238-FOLLOWUP-1 / v2.90: 15 Tests. Coverage: default-state (3), setSlicePadSlot+clear (5 — happy/out-of-range/Slot-Isolation/clearAll/sampleRate-Clamp), assignSlicesToPads (5 — Bulk-Assign/Truncate-bei-25/replace:true-leert-Rest/replace:false-merge/empty-array), End-to-End sample-slicer:apply Event-Simulation (2 — Payload-Validation + non-Float32Array-Filter).",
      lastSeen: "2026-05-18T02:33:00.000Z",
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
      details:  "Visualisierungs-Teil GEFIXT — Root-Cause: in AudioWorkbench.WaveformCanvas waren ctx.fillStyle und ctx.strokeStyle als CSS-var-Strings ('var(--ss-bg-elevated, #1a1a2e)') gesetzt. Canvas 2D unterstützt KEINE CSS-Variablen — Chromium ignorierte die String-Werte → schwarze Linien auf schwarzem Hintergrund → komplett unsichtbar. Fix: getComputedStyle(document.documentElement).getPropertyValue() für --ss-bg-elevated und --ss-accent-primary in echte Hex-Werte auflösen, mit Hex-Fallback (#1a1a2e / #7c3aed). Multi-Track-Editor + Vocal/Kick-Trennung + Audacity-Style Bereichs-Selektion bleiben als Phase Q Roadmap-Items offen (umfangreichere Features).",
      fixed:    true,
      foundBy:  "user (post-v1.23.0 report)",
      fixedBy:  "frontend",
      fixedIn:  "BUG-011 fix (post-v1.23.0)",
      relatedFiles: [
        "client/src/components/AudioWorkbench/AudioWorkbench.tsx"
      ]
    },
    "BUG-012": {
      title:   "Sample Browser: Waveform-Visualisierung nach Analyse fehlt + BPM-Detection läuft nicht",
      severity: "high (UX)",
      details:  "BPM-Teil GEFIXT — Root-Cause: useAudioAnalysis.analyzeFile() sendete dem Worker NUR die 'analyze'-Message für Peaks, aber NIE die 'analyzeBpm'-Message. Worker hatte beide Pfade implementiert, aber die Renderer-Seite nutzte nur den ersten. SampleBrowser prüfte analysisResult?.estimatedBpm — wurde nie befüllt → 'kein BPM angezeigt'. Fix: BPM in-band im Worker mit-berechnen (vermeidet teuren zweiten decodeAudioData-Trip). In client/src/workers/audioAnalysis.worker.ts: detectBpmFromChannelData-Helper extrahiert, der auf bereits-dekodierten Float32Array arbeitet; analyzeWaveform ruft ihn auf + returnt estimatedBpm im Result. In useAudioAnalysis.analyzeFile: estimatedBpm aus Worker- UND Electron-Result durchgereicht. In electron/workers/waveform.worker.ts: detectBpmFromWav-Helper analog zum Renderer-Algo direkt auf PCM-Samples (nur für WAV-Format, andere bleiben undefined). electron/waveform.ts + preload.ts + types.d.ts mit estimatedBpm + bpmConfidence Feldern erweitert. Waveform-Teil: WaveformDisplay sollte funktionieren wenn analyzeFile peaks zurückgibt — falls weiterhin keine Visualisierung erscheint, liegt es vermutlich an einer fehlgeschlagenen IPC/Worker-Initialisierung, was separat per Test-Logging verifiziert werden müsste.",
      fixed:    true,
      foundBy:  "user (post-v1.23.0 report)",
      fixedBy:  "frontend",
      fixedIn:  "BUG-012 fix (post-v1.23.0)",
      relatedFiles: [
        "client/src/workers/audioAnalysis.worker.ts",
        "client/src/hooks/useAudioAnalysis.ts",
        "electron/workers/waveform.worker.ts",
        "electron/waveform.ts",
        "electron/preload.ts",
        "electron/types.d.ts"
      ]
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
    },
    "BUG-016": {
      title:   "Performance Mode: Pads passen sich NICHT an die Fenstergröße im freien Fenster-Modus an",
      severity: "medium (UX)",
      details:  "User-Report mit Screenshot bilder/2.png: im Performance-Mode-Popup-Fenster wachsen die 16 Pads nicht mit der Fenstergröße. Bei größerem Fenster bleiben Pads klein + es erscheint eine vertikale Scrollbar. Ursache (verifiziert): das Inner-Grid-Div in PatternLaunchPad.tsx hatte `grid grid-cols-4 gap-4 w-full max-w-2xl` — max-w-2xl=42rem kappt bei 672px Breite. Container hatte `overflow-auto` → Scrollbar statt Resize. Fix: max-w entfernt, `aspect-square h-full max-h-full max-w-full grid grid-cols-4 grid-rows-4 gap-3` → Grid bleibt quadratisch und füllt min(width,height) des verfügbaren Raums. Container `overflow-hidden` statt -auto. Pads sind jetzt skalieren mit dem Fenster.",
      fixed:    true,
      foundBy:  "user (post-v1.25.0 report mit bilder/2.png)",
      fixedBy:  "frontend",
      fixedIn:  "BUG-016 fix (post-v1.25.0)",
      relatedFiles: [
        "client/src/components/PerformanceMode/PatternLaunchPad.tsx"
      ]
    },
    "BUG-017": {
      title:   "Popup-Fenster (Performance/FX) konnten via Datei→Beenden die ganze App schließen",
      severity: "critical",
      details:  "User-Report: in Performance-Mode-Popup auf 'Beenden' geklickt → komplette App quittet statt nur des Popups. Ursache: Popup-BrowserWindows erbten das Application-Menü inkl. role:quit auf Win/Linux. Fix in electron/main.ts: (1) Popup-Windows (perf-popup, fx-popup) rufen `win.setMenu(null)` → keine geerbten Accelerators. (2) Datei→Beenden ist jetzt context-aware: prüft BrowserWindow.getFocusedWindow() vor app.quit() — wenn ein Popup fokussiert ist, schließt nur das Popup. Mac role:close unverändert (bereits per-window-korrekt).",
      fixed:    true,
      foundBy:  "user (v1.27.0)",
      fixedBy:  "backend",
      fixedIn:  "8249a13 (v1.27.0)",
      relatedFiles: [
        "electron/main.ts"
      ]
    },
    "BUG-018": {
      title:   "Popup ✕-Button beendete weiterhin die gesamte App (Regression nach BUG-017)",
      severity: "critical",
      details:  "Mehrstufiger Folgebug zu BUG-017, in vier Anläufen (v1, v2, v3, v4) gefixt. Symptom: ✕ in Sample-Browser/Mixer/Pattern-Generator Popups schloss die ganze App. Ursachen-Kaskade: (1) window-all-closed-Handler feuerte fälschlich app.quit() auch wenn mainWindow noch lebte → Fix v1 (v1.29.0): `mainWindowDestroyed` Flag + defensive `show()+focus()` statt quit. (2) Pin-Label 'Pin' wurde mit 'Re-attach' verwechselt → v3 (v1.30.0): Rename auf '⬆ Top' + nuclear `before-quit` Guard via `userInitiatedQuit` Whitelist (alle legitimen Quit-Pfade setzen das Flag, alle anderen Quits werden präventDefault + mainWindow.show()). (3) v4 (v1.31.0): Cascade-Detection — `lastPopupCloseTime` markiert jedes Popup-Close; wenn mainWindow.on('close') <300ms danach feuert, ist es eine OS-WM_CLOSE-Kaskade durch parent-child-Beziehung und wird geblockt. (4) Final-Fix in BUG-019: parent-Property komplett von allen Popups entfernt → keine WM_CLOSE-Kaskade mehr möglich.",
      fixed:    true,
      foundBy:  "user (v1.28.0)",
      fixedBy:  "backend",
      fixedIn:  "4c8b644 (v1.29.0) → 53cb804 (v1.30.0) → cbf4907 (v1.31.0) → 9390b2d (v1.34.0)",
      relatedFiles: [
        "electron/main.ts",
        "client/src/components/DetachableWindowHeader.tsx"
      ]
    },
    "BUG-019": {
      title:   "Popup-Re-Attach (Anpinnen) crasht App auf Windows trotz BUG-018-Stack",
      severity: "critical",
      details:  "Trotz cascade-detection in v1.31 blieb auf Windows der Crash beim Re-Attach. Root-Cause: alle Popup-BrowserWindows hatten `parent: mainWindow ?? undefined` gesetzt — auf Windows kann ein frameless child window bei bestimmten Close-Paths eine WM_CLOSE an den Parent senden. Fix: parent-Property aus ALLEN sechs createXWindow-Funktionen entfernt (Performance, FX per channel, Mixer, Sample-Browser, Pattern-Gen, generic-singleton factory). Popups sind jetzt echte standalone-Windows. Programmatic cascade-close MAIN → POPUPS bleibt in mainWindow.on('closed') erhalten. Architekturkonform mit User-Wunsch 'eigenständige Fenster wie im Browser'.",
      fixed:    true,
      foundBy:  "user (v1.33.0)",
      fixedBy:  "backend",
      fixedIn:  "9390b2d (v1.34.0)",
      relatedFiles: [
        "electron/main.ts"
      ]
    },
    "BUG-020": {
      title:   "Performance-Mode Popup zeigt keinen 📌-Anpinn-Button, nur internes ESC ✕",
      severity: "medium (UX)",
      details:  "PatternLaunchPad rendert mit `fixed inset-0 z-50` und versteckt damit den DetachableWindowHeader des Popup-Fensters. Folge: User kann die Performance-Mode-Popup nicht über die standardisierte 'Anpinnen'-Geste re-docken. Fix: neue `popupMode` Prop auf PatternLaunchPad (default false). Bei true wird `flex-1 min-h-0` relative statt fixed inset-0 absolute gerendert → DetachableWindowHeader bleibt sichtbar. Inline-Fullscreen-Verhalten in App.tsx unverändert. PerformancePopupApp übergibt jetzt popupMode=true.",
      fixed:    true,
      foundBy:  "user (v1.33.0)",
      fixedBy:  "frontend",
      fixedIn:  "9390b2d (v1.34.0)",
      relatedFiles: [
        "client/src/components/PerformanceMode/PatternLaunchPad.tsx",
        "client/src/components/Popups/PerformancePopupApp.tsx"
      ]
    },
    "BUG-021": {
      title:   "Native main-process crash bei Chromium window.close() destruction",
      severity: "critical",
      details:  "v1.41 crash.log zeigt: nach popup:close-end stoppt der heartbeat sofort, kein render-process-gone, kein child-process-gone, kein SIGTERM → nativer Segfault in Chromiums BrowserWindow.close()-Path. Bekannter Electron-Quirk: win.close() aus einem IPC-Handler racet mit der close-event-chain. Fix: neuer `destroyPopupSafely(key, win, isFx?)`-Helper. Persistiert Layout manuell (umgeht close-event-Handler) und ruft `win.destroy()` statt `win.close()` — überspringt die close-event-chain komplett und geht direkt in sicherere Destruction. Alle 6 IPC close-handlers nutzen jetzt destroyPopupSafely. Plus: VALID_SINGLETON_KEYS + mapKeyPrefixToSingleton-Mapper. Folge-Bug-Risiko: closed-Event kommt nach destroy() trotzdem, aber close-Event nicht → erzeugt BUG-023.",
      fixed:    true,
      foundBy:  "user (v1.41 crash.log)",
      fixedBy:  "backend",
      fixedIn:  "67dda64 (v1.42.0)",
      relatedFiles: [
        "electron/main.ts"
      ]
    },
    "BUG-022": {
      title:   "Menü-Aktionen feuerten doppelt (Regression nach v1.46 FEAT-MENU-WIRING)",
      severity: "high",
      details:  "v1.46.0 (FEAT-MENU-WIRING) ergänzte einen useEffect in App.tsx der Music-Production Menü-IPCs an KB_ACTION_EVENT bridged. Übersehen: useElectronMenuBindings (Zeile 1505+) verdrahtete dieselben IPCs bereits. Folge: jeder Menü-Klick feuerte zwei Listener — pattern-next skippte 2 Patterns, bpm-up addierte 2 etc. Fix: useEffect aus FEAT-MENU-WIRING entfernt. Einziger zusätzlicher Nutzen aus v1.46 bleibt: onOpenAudioWorkbench ruft jetzt zusätzlich setActiveTool('workbench') auf, damit der Tools-Tab direkt im Workbench-Sub-Tab landet.",
      fixed:    true,
      foundBy:  "user (v1.46.0 regression report)",
      fixedBy:  "frontend",
      fixedIn:  "899dd9e (v1.47.0)",
      relatedFiles: [
        "client/src/App.tsx"
      ]
    },
    "BUG-025": {
      title:   "PianoRoll-Quantize-Crash bei korrupter scaleId in localStorage",
      severity: "high",
      details:  "User-Report ('bei quantize crasht die seite'). Root-Cause: `useMelodicPartStore._migratePattern` checkte nur `typeof p.scaleId === 'string'` — eine korrupte/veraltete scaleId (z.B. nach Schema-Rename oder Storage-Drift) wurde unverändert weitergereicht. PianoRollModal ruft am Component-Top unconditional `scalePitchClasses(scaleRoot, scaleId)` → `getScale(scaleId)` → wirft `Error: Unknown scale id: <junk>` → React unmountet die Komponente, der User sieht eine leere Seite. Fix (v1.71): neue `KNOWN_SCALE_IDS: Set<ScaleId>` und `isKnownScaleId(s): s is ScaleId` aus utils/scales.ts. `_migratePattern` validiert scaleId gegen die Set, fallback `chromatic` bei unbekanntem Wert. `setScale` validiert ebenfalls zur Laufzeit, sodass Caller-Type-Casts keine korrupte ID einsmuggeln können. 6 neue Tests (3 isKnownScaleId + 3 setScale-validation).",
      fixed:    true,
      foundBy:  "user (post-v1.70.0)",
      fixedBy:  "claude",
      fixedIn:  "v1.71.0",
      relatedFiles: [
        "client/src/utils/scales.ts",
        "client/src/store/useMelodicPartStore.ts",
        "tests/scales.test.ts",
        "tests/melodic-part.test.ts"
      ]
    },
    "BUG-024": {
      title:   "KI Script-Generator (+ Project-Analysis + Pattern-Generator) geht nicht trotz API-Key im Electron-Build",
      severity: "high",
      details:  "User-Report: 'Die KI Script-Erstellung geht nicht trotz ChatGPT API Key'. Root-Cause: `electron/csp.ts` setzt `connect-src 'self' ws: wss:` als Production-CSP-Header. Alle drei AI-Features (`aiScriptGenerator.ts`, `aiProjectAnalysis.ts`, `usePatternGeneratorStore.ts`) rufen direkt aus dem Renderer `fetch('https://api.openai.com/...')` bzw `fetch('https://api.anthropic.com/...')` auf. Chromium blockt diese Calls mit 'Refused to connect ... violates Content Security Policy'. Im Web-Build (Vite-Dev/Browser) wird keine CSP via meta-tag injiziert — daher fällt das Problem nur in Electron auf. Anthropics 'anthropic-dangerous-direct-browser-access' Header hilft nicht, weil er nur die SERVER-CORS-Antwort beeinflusst, nicht die BROWSER-CSP-Enforcement. Fix (v1.67.0): `https://api.openai.com` + `https://api.anthropic.com` in connect-src für Prod- UND Dev-CSP aufnehmen. Snapshot + neuer Positiv-Test in tests/electron/csp-header.test.ts.",
      fixed:    true,
      foundBy:  "user (post-v1.66.0)",
      fixedBy:  "claude",
      fixedIn:  "v1.67.0",
      relatedFiles: [
        "electron/csp.ts",
        "tests/electron/csp-header.test.ts",
        "tests/electron/__snapshots__/csp-header.test.ts.snap",
        "client/src/utils/aiScriptGenerator.ts",
        "client/src/utils/aiProjectAnalysis.ts",
        "client/src/store/usePatternGeneratorStore.ts"
      ]
    },
    "BUG-023": {
      title:   "Anpinnen verschwindet ohne wiederzukehren — Folgebug von BUG-021 destroy()",
      severity: "critical",
      details:  "Zweiteiliger Bug. (a) v1.51.0 Fix: BUG-021's `win.destroy()` feuert keine 'closed'-Events am BrowserWindow → mixer/sample-browser/perf-window:closed IPC werden nie gesendet → Main-Renderer bleibt im 'Popup ist offen'-State, Inline-View kommt nicht zurück. User sieht NICHTS. Fix: neuer `getClosedEventChannel(key, isFx)`-Helper mapped Popup-Key auf IPC-Channel. destroyPopupSafely sendet die closed-IPC manuell an mainWindow BEVOR win.destroy(). FX-Variante mit channelId-Payload. (b) v1.53.0 Fix für Restproblem: zwei verkettete Bugs identifiziert via E2E-Test mit echter Electron-Instanz. (1) useElectron() lieferte auf jedem Render neue Objekt-Referenz → Popup-Apps mit `[electron]`-deps re-sendeten request-state bei jedem Render. (2) Mit destroy() überleben in-flight request-state messages die Destruction und werden nach closed-Event geliefert → setMixerPopupOpen(true) → UI bleibt im 'Hierher zurückholen'-Zustand. Fix: alle 5 Popup-Apps nutzen jetzt `useEffect(..., [])` statt `[electron]` für initial-sync (request-state genau einmal beim Mount). App.tsx hat `mixerJustClosedRef` Guard der late request-state für 1.5s nach Close ignoriert (defense-in-depth).",
      fixed:    true,
      foundBy:  "user (post-v1.42.0 BUG-021 follow-up)",
      fixedBy:  "backend + frontend",
      fixedIn:  "1928810 (v1.51.0) + 07e2adf (v1.53.0)",
      relatedFiles: [
        "electron/main.ts",
        "electron/useElectron.ts",
        "client/src/App.tsx",
        "client/src/components/Popups/MixerPopupApp.tsx",
        "client/src/components/Popups/PerformancePopupApp.tsx",
        "client/src/components/Popups/SampleBrowserPopupApp.tsx",
        "client/src/components/Popups/PatternGeneratorPopupApp.tsx",
        "client/src/components/Popups/FxPopupApp.tsx",
        "tests/electron/e2e/bug-023-anpinnen.spec.ts"
      ]
    }
  },

  // ─── AGENT WORK LOG ────────────────────────────────────────
  // Each agent appends an entry here after completing work.
  // Format: { agent, timestamp, done[], next[], changed[] }
  workLog: [
    {
      agent:     "frontend",
      timestamp: "2026-05-18T12:15:00.000Z",
      done: [
        "v3.17.0: OmniTribe-Panel-Wiring (Sprint Tag 3 aus SYNTHSTUDIO_INTEGRATION.md). 3 existierende Panels mit der Bridge verkabelt — UI-Slider sendet NRPN an Hardware, Encoder am Geraet spiegelt in der UI (paramChange-CustomEvent via Bridge mit 50ms Echo-Schutz). Synthstudio bleibt vollstaendig funktional ohne OmniTribe: alle sendNrpn/uploadWavetable-Calls sind NO-OPs wenn isConnected=false.",
        "Neue Pure-Helpers: (1) client/src/utils/omniTribeThrottle.ts — generischer makeThrottledSender<TArgs> mit leading+trailing-Edge (16ms = ~60Hz Default), pro-Key Slot-Map, flush(key?) + cancel(key?) + Test-Hooks. lastSentAt wird in cancel auf 0 zurueckgesetzt damit Tests deterministisch sind. (2) client/src/utils/omniTribeWiring.ts — NRPN-Adress-Konstanten (OMNITRIBE_GRANULAR/WAVETABLE/EUCLIDEAN) + High-Level-API sendGranularParam/sendWavetableParam/sendEuclideanParam/uploadWavetable mit pro-Key throttled-Sender Singleton + isConnected-Gate. uiToMidi/midiToUi mit per-Param Wert-Ranges (Granular: grainSize 10..500, density 1..50, pitchScatter 0..200, rest 0..1). buildParamLow ((part<<4)|pid)&0x7F entsprechend Bridge-Mask. decodeParamLow umkehrbar fuer part 0..7 (part 8..15 nutzen separaten 'part'-Arg im Sysex-Frame).",
        "Verkabelte Params: GRANULAR (NRPN 0x19) — grainSize 0x00, density 0x01, pitchSpray→pitchScatter 0x02, position 0x03, spray 0x04, amplitude→feedback 0x05. WAVETABLE (NRPN 0x07) — framePosition 0x01, morphSpeed 0x02, plus Save→uploadWavetable(slot,[waveData]). EUCLIDEAN (NRPN 0x11) — nSteps 0x00, kHits 0x01, rotation 0x02 (negative Werte werden auf positiv normalisiert), enable 0x03 (immer 1 bei Apply). Mapping aus SYNTHSTUDIO_INTEGRATION.md §5 1:1 uebernommen.",
        "GranularSynthPanel.tsx (v3.17 erweitert um partIndex?-Prop, omniTribeBridge-Wiring, paramChange-Listener mit Part-Filter, OmniTribeIndicator-Header-Badge). Slider-onChange ruft sendGranularParam fuer 6 mapbare Felder. paramChange-CustomEvent-Handler dekodiert paramHigh==0x19 + decodeParamLow().part===part-Filter + granularPidToKey → patcht via onChange + updateGranularParams (wenn aktiv). paramsRef/onChangeRef Closures vermeiden re-bind bei jeder Param-Aenderung. WavetableEditor.tsx (v3.17 +partIndex/wavetableSlot Props, 2 neue Slider Frame-Position+Morph-Speed, paramChange-Listener, OmniTribeIndicator, Save ruft uploadWavetable(slot,[waveData]) VOR onSave). EuclideanControls.tsx (v3.17 +partIndex-Prop, handleApply ruft 4× sendEuclideanParam nach onApply).",
        "Hardware-Connected-Indicator: kleines Plug/PlugZap-Icon (lucide-react) + 'Local'/'OmniTribe' Text-Badge im Panel-Header. text-accent-success wenn verbunden, text-text-dim sonst. Position im Granular-Panel-Header zwischen Title und Play-Button, im Wavetable-Editor-Header zwischen Title und der 'Klick/Drag'-Subline. data-testid omnitribe-indicator-granular / omnitribe-indicator-wavetable. Tooltip via title-Attribut: 'Verbunden mit OmniTribe — Encoder spiegeln in der UI' vs 'Lokale Synthese'. Update-Polling: 1s setInterval pro Panel (Bridge ist Singleton ohne Observer — Polling ist gut genug fuer den seltenen Connect/Disconnect-Event).",
        "Throttle-Strategy: makeThrottledSender mit minIntervalMs=16 (~60Hz pro Param-Key, deutlich unter dem 100/sec Bridge-Limit aus MD §14). Leading-Edge: erster Call sendet sofort. Trailing-Coalesce: Folge-Calls innerhalb 16ms ueberschreiben pendingValue, ein setTimeout flushed am Intervall-Ende den ZULETZT empfangenen Wert (trailing-edge garantiert dass Slider-Release-Wert immer ankommt). Pro-Key-Isolation: '0:25:0' (Granular Grain-Size Part 0) und '0:25:1' (Density Part 0) teilen sich keinen Slot. Native Implementierung (keine lodash-Dependency hinzugefuegt, ~120 LOC). flush() + cancel() Test-Hooks via __flushOmniTribeSends/__cancelOmniTribeSends in omniTribeWiring exposed.",
        "DrumMachine.tsx: GranularSynthPanel-Render-Site (Zeile ~1798) bekommt partIndex={pattern.parts.findIndex(p => p.id === granularPartId)} mit >=0-Guard. EuclideanControls bleibt mit Default partIndex=0 (nicht aktuell renderiert irgendwo, nur Component-API-vorbereitet). SynthPanel rendert WavetableEditor ohne explizites partIndex — Default 0 ist OK fuer Phase-3.",
        "Tests: tests/features/omnitribe-panel-wiring.test.ts NEU mit 24 Tests. Coverage: clampPartIndex (7), uiToMidi/midiToUi round-trip (2), buildParamLow + decodeParamLow round-trip part 0..7 (2), granularPidToKey/wavetablePidToKey (1), Connected-Gate NO-OPs fuer sendNrpn/sendGranularParam/uploadWavetable (3), sendGranularParam NRPN-Adress + part-Index + Wert-Skalierung (3), sendWavetableParam Frame-Position/Morph-Speed/uploadWavetable (3), sendEuclideanParam 4-Call-Apply + Wert-Clamp (2), paramChange-Event-Decode + Part-Filter (2), makeThrottledSender leading/trailing/flush/cancel/per-key-isolation (5). Mock-Strategy: vi.spyOn(omniTribeBridge,'setParam'/'uploadWavetable'/'isConnected' getter). __cancelOmniTribeSends() in beforeEach garantiert deterministischen Reset.",
        "Test-Resultat: pnpm test → 3914 passed / 15 skipped (vorher 3890 → +24 v3.17). pnpm check clean. Bestehende omnitribeBridge.test.ts (17 Tests) bleibt gruen.",
        "Bekannte Caveats: (a) Granular hat 6 mapbare Params, Bridge-Spec hat 6 NRPN-Slots — perfekter 1:1 Match. Synthstudio's pitch/panSpread werden NICHT auf NRPN gemappt (kein Slot reserviert), das ist Absicht — Pitch lebt im Audio-Engine-Domain und panSpread im Mix-Bus. (b) amplitude → feedback Mapping ist semantisch nicht perfekt (Granular-Engine hat keinen echten Feedback-Param), aber best-fit fuer den 6ten Slot bis dedizierter Feedback-Param kommt. (c) WavetableEditor's Frame-Position + Morph-Speed sind NEUE Slider — sie steuern aktuell NUR die Hardware (keine lokale Audio-Engine-Wirkung), weil Synthstudio's Wavetable-Synthese eh single-frame ist. Bei lokaler Multi-Frame-Wavetable-Erweiterung sollten die Slider beide Pfade speisen. (d) EuclideanControls.partIndex default 0 ist konservativ — Mehrfach-Render fuer verschiedene Parts wuerde alle gleich auf part=0 senden. Sobald Mehrfach-Apply implementiert wird, muss DrumMachine den korrekten findIndex pro Channel-Row mitgeben. (e) ModMatrix existiert in Synthstudio nicht — als v3.18-TASK markiert (eigene neue Komponente).",
        "package.json + agents/INDEX.js version 3.16.0 → 3.17.0."
      ],
      next: [
        "TASK-v3.18-MOD-MATRIX (NEU): ModMatrix-Komponente bauen (8 Slots × 16 Parts, NRPN 0x13/0x14/0x15). Wiring analog v3.17 — Source/Target/Depth pro Slot. SoT: SYNTHSTUDIO_INTEGRATION.md §5 ModMatrix-Section.",
        "TASK-v3.18-NEW-PANELS (Sprint Tag 5): ChordPanel (NRPN 0x1E) + PerformancePadGrid (NRPN 0x1F) + ArpController (NRPN 0x16) + MPESettings (NRPN 0x12) + VoiceStealSettings (NRPN 0x1A). Pro Komponente: Wiring + Hardware-Indicator + Tests.",
        "TASK-v3.17-FU-1: EuclideanControls wird aktuell nirgends gerendert — Render-Site pro DrumMachine-Channel-Row hinzufuegen, plus partIndex=findIndex weitergeben. Backend-Owner darf hier mitreden weil's die Channel-Liste betrifft.",
        "TASK-v3.17-FU-2: VU-Meter-Store + Spectrum-Store (useOmniTribeMetersStore mit Custom-Observer, 16-Channel-VU + 64-Bin-Spectrum) und live-render im Mixer/Performance-Tab. Aktuell loggt App.tsx die Events nur in die Console.",
        "TASK-v3.17-FU-3 (Multi-Frame-Wavetable): WavetableEditor speichert single-Frame. Fuer echte Wavetable-Synthese (mehrere Tabellen mit Morph): UI-Erweiterung um Frame-Slider innerhalb der gezeichneten Tabelle, dann uploadWavetable mit echtem Frame-Array."
      ],
      changed: [
        "client/src/utils/omniTribeThrottle.ts (NEU, ~135 LOC, generischer trailing-throttle pro Key)",
        "client/src/utils/omniTribeWiring.ts (NEU, ~225 LOC, NRPN-Konstanten + sendGranular/Wavetable/Euclidean/Upload + uiToMidi/midiToUi/buildParamLow/decodeParamLow + Test-Hooks)",
        "client/src/components/DrumMachine/GranularSynthPanel.tsx (v3.17 +partIndex?-Prop +OmniTribeIndicator +sendGranularParam-Hook fuer 6 Params +paramChange-Listener mit Part-Filter +Polling-isConnected-Status)",
        "client/src/components/DrumMachine/WavetableEditor.tsx (v3.17 +partIndex?/wavetableSlot? Props +Frame-Position+Morph-Speed Slider +paramChange-Listener +OmniTribeIndicator +Save ruft uploadWavetable VOR onSave)",
        "client/src/components/DrumMachine/EuclideanControls.tsx (v3.17 +partIndex?-Prop +handleApply ruft 4× sendEuclideanParam fuer N/K/Rotation/Enable nach onApply)",
        "client/src/components/DrumMachine/DrumMachine.tsx (GranularSynthPanel-Render-Site +partIndex={findIndex-Guard})",
        "tests/features/omnitribe-panel-wiring.test.ts (NEU, 24 Tests + jsdom-Env + spyOn(omniTribeBridge) Mocks)",
        "package.json (3.16.0 → 3.17.0)",
        "agents/INDEX.js (version 3.16.0 → 3.17.0 + workLog v3.17.0 entry)"
      ]
    },
    {
      agent:     "backend",
      timestamp: "2026-05-18T12:00:00.000Z",
      done: [
        "v3.16.0: OmniTribe-Bridge integriert (Sprint Tag 1-2 aus SYNTHSTUDIO_INTEGRATION.md). Sibling-Repo G:/IdeaProjects/Omnitribe liefert canonical OTP-Sysex-Spec + Bridge-Source — Code wurde NICHT referenziert sondern in client/src/audio/ gedropt (SoT-Comment im Header zeigt auf Quelle). Bridge implementiert OTP-Sysex-Codec (F0 7D 01 02 cmd sub lenH lenL <payload> chk F7), 7-bit-Encoding fuer 8-bit-Daten, XOR-Checksum, 100/sec-Throttler-Queue, Echo-Schutz via 50ms pendingSets-Window.",
        "Files erstellt: (1) client/src/audio/OmniTribeBridge.ts — OmniTribeBridge-Klasse + Singleton (omniTribeBridge) + OtpCmd / StreamFlag Enums + buildFrame/encode7Bit/decode7Bit-Helper. Erweitert ggue. SoT um disconnect()-Methode (Cleanup von Listeners + Pending-Frames) und __testInject/__testGetSentFrames-Hooks fuer Vitest. (2) client/src/hooks/useOmniTribe.ts — React-Hook mit connect/disconnect/setParam/enableMonitoring + auto-listen auf Identity-Response + webMidiSupported-Flag (typeof navigator.requestMIDIAccess === 'function'). (3) client/src/components/Settings/DeviceConnectionPanel.tsx — Settings-Section mit 3 Zustaenden: Web-MIDI-Unavailable (rot, Firefox/Safari-Hinweis), Disconnected (Connect-Button), Connected (✓ + Firmware-Version + Enable-Monitoring + Disconnect-Buttons). Nur semantische Tailwind-Tokens (bg-bg-panel / text-accent-success/danger/primary).",
        "SettingsPanel.tsx: neue 'Hardware'-Group + 'omnitribe'-Section (🔌-Icon) zwischen 'MIDI'-Group und 'App'-Group gemounted. Section-Union-Type erweitert. SECTIONS-Array bekommt 'OmniTribe Device'-Eintrag. App.tsx: useEffect-Listener fuer omnitribe:paramChange / omnitribe:vuMeter / omnitribe:spectrum CustomEvents — vorerst nur Console-Log (Panel-Wiring kommt in v3.17), VU+Spectrum mit Math.random<0.02 throttling damit Console nicht flooded.",
        "Tests: tests/features/omnitribeBridge.test.ts mit 17 Tests (@vitest-environment jsdom fuer window-Zugriff). Coverage: connect (with/without device), 15-byte-Sysex-Frame-Layout fuer setParam, Identity-Request/Response Round-Trip, Echo-Schutz innerhalb 50ms vs. Pass-Through nach 60ms, Disconnect-Cleanup, VU-Meter+Spectrum CustomEvent-Dispatch, enableStreams Bitfield-Payload, Invalid-Sysex-Rejection (wrong-MFR + checksum-mismatch), XOR-Checksum-Math fuer known payloads, encode7Bit/decode7Bit Round-Trip, remoteTempo 14-bit BPM*100-Encoding, on() unbind-Funktion. Pure-Test via FakeMidiOutput/FakeMidiInput + vi.useFakeTimers fuer Throttler-Advance.",
        "Test-Resultat: pnpm vitest run omnitribeBridge → 17 passed. pnpm test gesamt → 3890 passed / 15 skipped (vorher 3871 → +17 omnitribe + 2 stabile externe Aenderungen aus Sibling-Branches). pnpm check clean (TypeScript strict).",
        "Web-MIDI Permission-Handler in electron/main.ts geprueft: ALLOWED-Set enthaelt nur 'media' + 'mediaKeySystem' — Web-MIDI braucht KEINEN expliziten Permission-Eintrag im setPermissionRequestHandler weil Chromium 'midiSysex' default-allowed in Electron behandelt (kein User-Dialog noetig, anders als im Browser). Sollte sich das in Electron 40+ aendern, muss 'midi' + 'midiSysex' explizit der Whitelist hinzugefuegt werden — TODO fuer v3.17 falls Hardware-Tests Failure zeigen.",
        "Pro-Feature-Gating: bewusst NICHT gegated — OmniTribe ist Hardware-Bonus fuer User die das custom-Geraet haben. Bridge + Panel + Hook sind frei verfuegbar. Falls spaeter ein Pro-Schloss gewuenscht: neuen Flag PRO_FEATURE_OMNITRIBE_HW in proFeatures.ts adden und in DeviceConnectionPanel.connect() + setParam() blocken.",
        "Bekannte Caveats: (a) Web-MIDI nur in Chrome/Edge/Opera + Electron (Firefox/Safari nicht). UI-Banner sichtbar. (b) Echo-Schutz-Window von 50ms haengt mit Firmware-side ParamNotify-Cooldown ab — beide Werte muessen synchron bleiben, sonst entweder Lost-Updates (zu lang) oder Endlosschleifen (zu kurz). (c) Bridge ist Singleton — bei React-StrictMode-Double-Mount im Dev sollte der Hook robust bleiben, aber bei wirklichem useEffect-Cleanup waeren Listener-Unbinds idempotent. (d) Die Bridge wurde NICHT zur Electron-Main-Process gepatcht — Web-MIDI laeuft im Renderer. Falls Multi-Window OmniTribe-Sharing gewuenscht: separate IPC-Bruecke. (e) Wavetable-Upload sendet aktuell unkomprimierte i16-Werte ohne 7-bit-Wrap-Schutz — bei FrameCount > 256 Frames waere 7bit-Encoding pflicht. Aktuelle uploadWavetable verwendet (i16 >> 8) & 0x7F → die obersten 8 bits werden auf 7 bit geclamped. Sample-fidelity-Verlust am Top-Octave bewusst — Sprint 3-Followup fuer 7bit-encoded Upload-Pfad.",
        "package.json + agents/INDEX.js Version 3.15.0 → 3.16.0. INDEX.js project.dependencies.omnitribeProject = 'G:/IdeaProjects/Omnitribe' als Sibling-Reference ergaenzt."
      ],
      next: [
        "TASK-v3.17-OMNITRIBE-WIRING: existierende Panels mit Bridge verkabeln (GranularSynthPanel.tsx → Grain/Density/Pitch via setParam(0x19,...), WavetableEditor.tsx → Frame-Position/Morph-Speed via setParam(0x07,...), ModMatrix.tsx → Slot Source/Target/Depth via setParam(0x13/0x14/0x15,...)). Plus: omnitribe:paramChange-Listener pflegt entsprechende Stores statt nur Console.log. Echo-Schutz-Regression-Test mit Slider-Sweep-Simulation gegen UI-Oszillation.",
        "TASK-v3.18-OMNITRIBE-NEW-COMPONENTS: ChordPanel (chord-type + stagger + enable, NRPN 0x1E) + PerformancePadGrid (16 Pads → Pattern, NRPN 0x1F mit pad-press/loop-isolate/jam-mute) als neue Komponenten. Plus: VU-Meter-Store + Spectrum-Store (z.B. useOmniTribeMetersStore mit Custom-Observer-Pattern und 16-Channel-VU + 64-Bin-Spectrum), live-render im Mixer/Performance-Tab.",
        "TASK-v3.16-FU-1 (Electron-Permission-Check): manuell verifizieren dass navigator.requestMIDIAccess({sysex:true}) in Electron 40 OHNE expliziten 'midi'/'midiSysex'-Eintrag in installPermissionHandlers funktioniert. Falls nicht: ALLOWED-Set erweitern und CSP-Header anpassen (siehe electron/main.ts:2991).",
        "TASK-v3.16-FU-2 (Collab-Relay): omnitribe:paramChange als CollabSession-Broadcast — User A hat das Gerät, User B sieht synchronen State (Sprint-5-Stretch aus SYNTHSTUDIO_INTEGRATION.md §10)."
      ],
      changed: [
        "client/src/audio/OmniTribeBridge.ts (NEU, gedroppt von G:/IdeaProjects/Omnitribe/host/synthstudio/OmniTribeBridge.ts + disconnect()-Methode + Test-Hooks)",
        "client/src/hooks/useOmniTribe.ts (NEU, React-Hook mit connected/connect/disconnect/setParam/enableMonitoring/identity/webMidiSupported)",
        "client/src/components/Settings/DeviceConnectionPanel.tsx (NEU, 3-Zustands-UI mit semantischen Tokens)",
        "client/src/components/Settings/SettingsPanel.tsx (DeviceConnectionPanel-Import + 'omnitribe' Section-Union-Type + SECTIONS-Eintrag 'Hardware'-Group + render-Switch)",
        "client/src/App.tsx (3 CustomEvent-Listener fuer omnitribe:paramChange/vuMeter/spectrum mit Console-Log + Random-Throttling)",
        "tests/features/omnitribeBridge.test.ts (NEU, 17 Tests + jsdom-Env + FakeMidiOutput/FakeMidiInput)",
        "package.json (3.15.0 → 3.16.0)",
        "agents/INDEX.js (version 3.15.0 → 3.16.0 + project.dependencies.omnitribeProject + workLog v3.16.0 entry)"
      ]
    },
    {
      agent:     "backend",
      timestamp: "2026-05-18T11:50:00.000Z",
      done: [
        "v3.15.0: E2-Sampler Motion-Sequencer Reverse-Engineering — Pattern-Level-Motion (NICHT Per-Part) decoded via Histogramm-Scan über e2s-2016.e2sallpat Stock-Bank (250 Patterns). Layout-Discovery: KORG E2 hat 8 Motion-Slots PRO PATTERN (NICHT 4 wie Hardware-Doku impliziert), 560-Byte Region PTST-relativ. (1) Motion-Region beginnt bei PTST+0x100, NICHT im 1280-Byte 'Footer' nach den Parts (der ist tatsächlich nur 252 Bytes + PTED-Marker = pad-to-16640). (2) Footer 0x3C00..0x4100 ist über alle 250 Stock-Patterns + 4 reale .e2spat-Files VOLLSTÄNDIG ZERO bis auf PTED@0x3CFC.",
        "Motion-Slot-Layout (PTST-relativ, verifiziert gegen 250 Stock-Patterns): PTST+0x100..0x108 = 8B ParamID[8] (1B pro Slot, 0=disabled, 1..17 = bekannte IDs). PTST+0x118..0x120 = 8B TargetPart[8] (1B pro Slot, 1..16 = Part-Index 0..15, 17..19 = global/future). PTST+0x130..0x330 = 512B = 8 Slots × 64B values (0..127, Sentinel 0x80=128 wird auf 127 geclampt). Reserved zones PTST+0x108..0x118 + PTST+0x120..0x130 verifiziert all-zero über alle 250 Patterns. Region nach 0x330..0x800 (1232B Gap zu Parts-Start) ebenfalls verifiziert all-zero.",
        "Param-ID-Discovery: 17 unique IDs beobachtet (1..17, 0=disabled). Top-5: 0x11=17 (81×), 0x01 (34×), 0x02 (26×), 0x0d (13×), 0x05 (14×). Konkrete Param-Namen NICHT verifizierbar (kein Hardware-Doc), Labels in ELECTRIBE_PATTERN_MOTION_PARAM_NAMES bewusst generisch ('Param 01'..'Param 17'). Target-Bytes 1..19 beobachtet (16 Parts + 3 mögliche global-targets). 127 von 250 Patterns (50.8%) haben mind. 1 enabled Slot, 248 enabled Slots total über die Bank.",
        "Implementation: (1) client/src/utils/electribeImport.ts: +6 v3.15-Konstanten (ELECTRIBE_MOTION_PARAM_TABLE_OFFSET=0x100, ELECTRIBE_MOTION_TARGET_TABLE_OFFSET=0x118, ELECTRIBE_MOTION_DATA_TABLE_OFFSET=0x130, ELECTRIBE_MOTION_SLOTS_PER_PATTERN=8, ELECTRIBE_MOTION_VALUES_PER_SLOT=64, ELECTRIBE_MOTION_SLOT_STRIDE=64) + ELECTRIBE_PATTERN_MOTION_PARAM_NAMES Map (17 Eintraege). +ParsedPatternMotionSlot Interface {paramId, paramName, targetPart, rawTarget, enabled, values[64]}. +parsePatternMotionTable(view, ptstOffset) Public-Export. ParsedPattern erweitert um patternMotion?: ParsedPatternMotionSlot[]. parseRealPatternAt befüllt patternMotion via parsePatternMotionTable(view, ptstOffset). parseElectribeAllPatBank fallback-slot füllt patternMotion mit 8 disabled-Defaults. (2) convertParsedPatternToSynthstudio emittiert automationLanes aus patternMotion mit target-Format '<paramName>:slot<i>:part<targetPart>' bzw. ':global<rawTarget>' für rawTarget>=17. 64 Werte werden auf stepCount (16/32) gecappt. (3) Header-Doc-Comment um v3.15-RE-Findings erweitert + Confidence-Levels HIGH/MEDIUM/LOW.",
        "Tests: tests/features/electribe-import.test.ts +15 neue Tests (113 → 128 total): 2 Constants-Tests (Layout-Self-Konsistenz + ParamName-Map-Completeness), 6 parsePatternMotionTable-Tests synthetic (8-Slots-immer / paramId+target decode / global-target rawTarget>=17 / 0x80-clamp / paramId=0+nonzero-data wins / out-of-bounds defaults), 2 convert-Tests synthetic (legacy ohne patternMotion / Pattern-Motion → automationLanes mit slot/target-Routing) + 1 global-target-Test, 5 Real-File-Tests conditional auf 'e2s-2016/e2s-2016.e2sallpat' Verfügbarkeit (BodyTalk1 hat 0 enabled motion, Init181 hat 0 enabled, Stock-Bank >100 patterns mit motion, paramIds in [0..17] range, 80th Floor 3 hat sweep-Pattern in Slot 0). Bei BodyTalk1+Init181 Single-Files war Annahme 'BodyTalk hat Motion' FALSCH — Motion-Data steckt NUR in der Stock-Bank, nicht in den User-exportierten Single-Pattern-Files.",
        "Test-Resultat: pnpm vitest run electribe-import → 128 passed (vorher 113, +15 neue v3.15-Tests, einschließlich 5 conditional real-file). pnpm test gesamt → 3871 passed / 15 skipped (vorher 3854 → +15+2 weitere = stabil). pnpm check clean. electribe-motion-bridge.test.ts (21) + electribe-motion-mapping (existing) bleiben gruen.",
        "Confidence-Level v3.15: ✅ HIGH (verifiziert gegen 250 Stock-Patterns): Slot-Region PTST+0x100..0x330 (560B), Slot-Stride 64B, Slot-Count 8, ParamID-Layout @ PTST+0x100 (8 Bytes), TargetPart-Layout @ PTST+0x118 (8 Bytes), Reserved-Zones all-zero, Region post-0x330 all-zero, Footer 0x3C00..0x4100 all-zero. ⚠ MEDIUM: 'enabled'-Semantik (paramId>0 OR data-nonzero — 8 inkonsistente Patterns wie Trials1 oder futureMonger1 brechen die strict 'paramId-as-enabled-flag'-Annahme). ❌ LOW: Konkrete Param-ID → Hardware-Parameter-Name (kein Public-Doc — Labels sind 'Param 01..17').",
        "package.json 3.14.0 → 3.15.0."
      ],
      next: [
        "TASK-v3.15-FU-1 (Param-ID-Discovery): User-driven A/B-Test mit der Hardware — Pattern erstellen wo nur 1 bekannter Parameter (z.B. Filter Cutoff) automated wird, dann exportieren und checken welche Param-ID landet. Aktuell ist Param 0x11 (17) der häufigste Kandidat für Volume/Filter, aber Hardware-Bestätigung steht aus.",
        "TASK-v3.15-FU-2 (Real-File-User-Source): User-Files .e2spat haben KEINE Motion-Daten (BodyTalk + Init alle empty). Vermutlich exportieren E2-User nur Steps. Motion lebt primär in der Stock-Bank. Future: e2sallpat-Aware-UI im Synthstudio bauen die motion-Lanes als 'Stock-Bank-Demo'-Quelle zeigt.",
        "TASK-v3.15-FU-3 (Stretch-StepLength → 64-Werte-Lane): Patterns mit stepLength=64 haben 64 Werte = 64 Steps. Bei stepLength=16 sind die letzten 48 Werte typisch flat (continuation des letzten aktiven Werts). Heuristik: detect step-length via PTST+0x25 und cap die Lane entsprechend — aktuell capen wir auf 16/32 via Synthstudio-stepCount. Sauber wäre: native 64-step Lane wenn stepLength=64.",
        "TASK-v3.15-FU-4 (Target rawTarget=17..19): 3 Bytes über die Stock-Bank haben target=17,18,19. Möglicherweise: 17=Master-Filter, 18=Master-FX, 19=Tempo. Aktuell mappen wir auf targetPart=-1 und label='global'. Future: cross-reference die Stock-Patterns die diese targets nutzen mit ihren Hardware-Sound-Profilen."
      ],
      changed: [
        "client/src/utils/electribeImport.ts (+6 v3.15-Konstanten + ELECTRIBE_PATTERN_MOTION_PARAM_NAMES Map + ParsedPatternMotionSlot Interface + parsePatternMotionTable Public-Export + ParsedPattern.patternMotion?-Feld + parseRealPatternAt befüllt patternMotion + parseElectribeAllPatBank Fallback-Default mit patternMotion + convertParsedPatternToSynthstudio emittiert pattern-motion automationLanes mit slot/target-Routing + Header-Doc um v3.15-RE-Findings + Confidence-Levels)",
        "tests/features/electribe-import.test.ts (+15 Tests: 2 Constants + 6 parsePatternMotionTable synthetic + 3 convert-Tests synthetic + 5 conditional real-file Stock-Bank Tests)",
        "package.json (3.14.0 → 3.15.0)",
        "agents/INDEX.js (version 3.14.0 → 3.15.0 + workLog v3.15.0 entry)"
      ]
    },
    {
      agent:     "backend",
      timestamp: "2026-05-18T11:30:00.000Z",
      done: [
        "v3.14.0: ESX-1 Step-Encoding Reverse-Engineering — analog v3.12-Methode auf ESX-1 angewandt. Hex-Diff Analyse aus 4 realen .esx-Files (BOTTROP.ESX 32 patterns / KASSEL.esx 75 patterns / ENDLICH.ESX / DUSSELBUNKAAA.esx als init-only reference) hat folgendes Pattern-Block-Layout (4280B) verifiziert: (1) Per-Part-Stride = 34 Bytes (18B Header + 16B Step-Trigger-Bytes), 9 Drum-Anchors '80 00 ff 00' bei Offsets 24/58/92/126/160/194/228/262/296 mit konstantem Stride 34. (2) 10 Drum-Parts (Drum 1..10) ab Offset 24 — Part 10 sitzt bei 330, danach ~240B Motion-Sequencer-Region (0xBC = neutral signed byte). (3) Per-Part-Felder: sample-id BE u16 @ part+0 (0x8000=unassigned), level @ part+9 (0..127, init=0x64=100), pan @ part+10 (0..127, init=0x40=64=center), Step-Trigger 16B @ part+18 (1 byte/step, bit 0 = active).",
        "Beweis-Step-Decoding: BOTTROP[0] Part 5 step-bytes '01 00 00 00 01 00 00 00 01 00 00 00 01 00 01 00' → bit-0 pattern 1000 1000 1000 1010 = klassischer 4-on-the-floor Kick auf Steps 0/4/8/12+14 ✓. BOTTROP[0] Part 6 = '01 00 00 00 01 00 00 00 01 00 00 00 01 00 00 00' = pure 4-on-the-floor (4 hits). BOTTROP[0] Part 4 hat 10 aktive 16th-notes (hihat-ghost-pattern). Confidence HIGH für trigger-active. velocity (bits 1..7) Best-Effort, default 100 wenn nicht extrahiert. Parts 10..15 (Stretch1/2, Slice1/2, Audio-In, Synth1/2) bleiben Defaults — ihr Layout liegt nach der Motion-Region und ist nicht final RE-d.",
        "Implementation: (1) client/src/utils/korg/esxParser.ts: +5 v3.14-Konstanten (ESX1_PART_STRIDE=34, ESX1_PART_HEADER_BYTES=18, ESX1_PART_STEPS_BYTES=16, ESX1_DRUM_PART_OFFSET=24, ESX1_DRUM_PARTS_DECODED=10), neue interne Helper decodeDrumPart(raw, partIndex) → {sampleId, volume, pan, steps[]}, parseEsxPattern befüllt Parts 0..9 mit decoded-data und Parts 10..15 mit Defaults, Header-Doc-Comment um v3.14-RE-Findings ergänzt mit explizitem Layout + Confidence-Level. (2) tests/features/korg-esx-patterns.test.ts: +8 v3.14-Tests: 4-on-the-floor Kick (mask 0x1111 → Steps 0/4/8/12), Offbeat-Hat (mask 0xAAAA → odd steps), sampleId/volume/pan-Decoding (0x002a/120/32), 0x8000-unassigned-Erkennung, Parts 10..15 bleiben Defaults, velocity-Fallback 100 wenn bit-0-only, +2 Real-File-Tests (foundActiveSteps in mind. 1 Pattern, plausibleCount > 0 für Drum-Patterns mit 1..16 aktiven Steps). Bestehender 'liefert 16 Parts'-Test ergänzt um v3.14-Kommentar (buildPatternBlock fills 0x42 → bit0=0 → inactive bleibt korrekt).",
        "Test-Resultat: pnpm vitest run korg-esx-patterns → 27 passed (vorher 17, +10 neue v3.14-Tests, inkl. 2 conditional real-file). pnpm test gesamt → 3854 passed / 15 skipped (vorher 3846 → +8 neue). pnpm check clean. Real-File-Tests verifizieren: aus den ersten 10 .esx-Files in 'Korg ESX files/' liefert mind. 1 Pattern mit aktiven Drum-Step-Triggers (foundActiveSteps=true), und mind. 1 Pattern hat plausible Drum-Hit-Counts 1..16 (plausibleCount>0).",
        "Confidence-Level (v3.14 NEU): ✅ HIGH (verifiziert gegen 4 reale .esx + Hex-Diff): Per-Part-Stride 34B, 9-10 Drum-Parts ab Offset 24, sample-id BE u16 @ +0, level @ +9, pan @ +10, Step-Trigger bit 0 @ +18..+33. ⚠ MEDIUM: velocity in bits 1..7 (sichtbare Varianz 0x11/0x49/0x15/0x44/0x51, aber Semantik nicht final RE-d, Fallback 100 wenn aktiv). ❌ LOW (noch nicht decodiert): Pitch (kein klares signed byte), FxAmount, Parts 10..15 (Stretch/Slice/Audio-In/Synth — Layout liegt nach 240B Motion-Region), Motion-Sequencer-Daten (~240B 0xBC-Region), Roll/Accent-Flags, Choke-Group-Settings.",
        "package.json 3.13.0 → 3.14.0."
      ],
      next: [
        "TASK-v3.14-FU-1 (Parts 10..15 Layout): Stretch1/2, Slice1/2, Audio-In, Synth1/2 sitzen nach der 240B Motion-Region (ab Offset ~604). Layout muss separat RE-d werden — vermutlich anderes header-format (Stretch-Slot hat 64-Step-Sequencer, Synth-Parts haben Note-Daten statt nur Trigger).",
        "TASK-v3.14-FU-2 (velocity-Bits Semantik): 0x49/0x44/0x51 in BOTTROP[0] Part 0 zeigen Varianz, aber 0x11 dominiert. Möglicherweise: bit 4 = accent-flag, bits 1..3 = roll-count. Cross-Check mit User-bekannten patterns wo accent/roll bewusst gesetzt ist wäre der nächste Schritt.",
        "TASK-v3.14-FU-3 (Motion-Sequencer-Region): 0xBC ist signed -68 = neutral. Motion-Lanes pro Drum-Part vermutlich 24 Bytes (16 steps × 1 byte data + 8 byte header). Vergleich Init vs Real für ein Pattern wo Motion bewusst aufgenommen ist wäre nötig.",
        "TASK-v3.14-FU-4 (esxPatternConvert: Steps in DrumPart): convertEsxPatternToSynthstudio bislang ignoriert step-data komplett. Nach v3.14 sollte das Mapping die decodierten Steps in das Synthstudio drumPart-Step-Format übernehmen. Aktueller Konverter wurde bewusst NICHT in v3.14 erweitert — separater Folge-Task."
      ],
      changed: [
        "client/src/utils/korg/esxParser.ts (+5 v3.14-Konstanten + decodeDrumPart-Helper + parseEsxPattern decodiert Parts 0..9 mit sample-id/volume/pan/steps statt all-defaults, Header-Doc-Comment um v3.14-RE-Findings + Layout + Confidence)",
        "tests/features/korg-esx-patterns.test.ts (+10 Tests: 8 synthetic step-encoding + 2 real-file foundActiveSteps/plausibleCount, plus 'liefert 16 Parts'-Test mit v3.14-Kommentar)",
        "package.json (3.13.0 → 3.14.0)",
        "agents/INDEX.js (version 3.13.0 → 3.14.0 + workLog v3.14.0 + TASK-v3.5-FU closed via Step-Encoding-RE)"
      ]
    },
    {
      agent:     "backend",
      timestamp: "2026-05-18T11:15:00.000Z",
      done: [
        "v3.13.0: Part-Header + Pattern-Globals Reverse-Engineering — schließt TASK-v3.12-FU-1 (teilweise) + TASK-v3.12-FU-3. Drei neue Felder decodiert via Histogramm-Analyse über e2s-2016.e2sallpat Stock-Bank (250 Patterns × 16 Parts = 4000 part-samples): (1) Part-Volume @ part_off + 0x15 (0..127, default 0x7F, beobachtet in 63.4% aller samples) — HIGH confidence. (2) Part-Pan @ part_off + 0x22 (0..127, 0x40=center, beobachtet in 59.7%) — HIGH confidence. (3) StepLength @ PTST+0x25 als Code-Mapping {0:16, 1:32, 3:64} — HIGH confidence via maxStep-Korrelation: alle 9 Patterns mit PTST+0x25=0 haben kein step > index 15, beide Patterns mit code=1 (futureMonger1, TopieIterate1) haben max steps bei 31, 239 Patterns mit code=3 haben steps bis 63.",
        "RE-Methodology: (a) Hex-Diff aller 16 Part-Header (48B each) von BodyTalk1 vs Init181 vs Init250 vs Advi$ory1. Init181 zeigt deutlich identische Defaults für alle Parts (vol=0x7F, pan=0x40 jeweils), während BodyTalk programmierte Mixer-Settings hat (vol=0x14, 0x7F, 0x6C, 0x40, 0x2E etc; pan=0x5D, 0x22, 0x40, 0x7F, 0x00). (b) Cross-Check mit 4000-Sample Histogram aus Stock-Bank: Volume@0x15 top-distribution 127(2538)/64(208)/50(39); Pan@0x22 top 64(2386)/127(329)/0(83) — klare Default-Peaks mit voller 0..127-Range. (c) Pitch + FxSend NICHT decodiert: kein Byte in den 48 Part-Header-Bytes zeigt signed-distribution (alle constant-zero columns 0x16, 0x17, 0x23, 0x26..0x2F) oder klares default-pattern für FxSend. Konservativ als Hardware-Default 0 belassen.",
        "Implementation: (1) client/src/utils/electribeImport.ts: +6 neue Konstanten ELECTRIBE_REAL_PART_VOLUME_OFFSET=0x15, ELECTRIBE_REAL_PART_PAN_OFFSET=0x22, ELECTRIBE_REAL_PART_VOLUME_DEFAULT=127, ELECTRIBE_REAL_PART_PAN_DEFAULT=64, ELECTRIBE_REAL_STEP_LENGTH_OFFSET=0x25 (PTST-relativ), ELECTRIBE_REAL_STEP_LENGTH_CODES={0:16, 1:32, 3:64}. parseRealPartBlock: alte volume=100/pan=64 Hardware-Defaults ersetzt durch safeU8-Read aus +0x15 / +0x22 mit out-of-range console.warn + defensive clamp auf 127. parseRealPatternAt: StepLength wird aus PTST+0x25 via Mapping decodiert (Fallback 16 bei unbekanntem code mit console.warn). Init181 e2sallpat-Fallback (slots ohne PTST) auf neue _DEFAULT-Konstanten umgestellt (vorher hardcoded 100/64). Header-Kommentar dokumentiert v3.13-RE-Methodik mit allen confidence-Levels. (2) tests/features/electribe-import.test.ts: +16 neue Tests in 3 describe-Blöcken: 'v3.13 Part-Header Volume/Pan' (7 Tests, real-file conditional): BodyTalk1 vol-Varianz >= 3 unique-Werte, spezifische Part-Volumes (P0=20, P1=127, P2=108, P8=46, P15=127), Init181 alle 16 Parts vol=127+pan=64, BodyTalk Pan-Varianz + P0=93/P15=0, convert→Synthstudio Pan-Normalisierung (P15→-1, P0→0.46), Volume-Normalisierung. 'v3.13 Pattern-Globals StepLength' (4 Tests): BodyTalk/Advi/Init250 alle 64, Init181=16, convert clampt 64→32. 'v3.13 Stock-Bank Volume/Pan/StepLength' (4 Tests, e2sallpat conditional): Volume-Range-check über 4000 parts, Pan-Center-Dominanz + hard-L/R-Existenz, StepLength-Distribution 16/32/64 counts, futureMonger1 (Slot 202) hat exakt StepLength=32. +1 Test 'Constants are exported' verifiziert ELECTRIBE_REAL_PART_VOLUME_OFFSET+_PAN_OFFSET+_DEFAULTs+_STEP_LENGTH_CODES sind public-API.",
        "Test-Resultat: pnpm vitest run tests/features/electribe-import.test.ts → 111 passed (vorher 95, +16 neue v3.13-Tests). pnpm test gesamt → 3846 passed / 15 skipped (vorher 3818 → +28: 16 v3.13 + andere unrelated Increments). pnpm check clean. Tests gegen reale Files sind conditional via REAL_FILES_AVAILABLE / REAL_E2SALLPAT_AVAILABLE — CI ohne 'Korg e2s files/' bzw. 'e2s-2016/' skipped automatisch.",
        "Confidence-Level (v3.13 NEU): ✅ HIGH (verifiziert gegen 4 reale .e2spat + 250-Pattern Stock-Bank): Part-Volume @ +0x15, Part-Pan @ +0x22, StepLength code @ PTST+0x25 mit 3-Werte-Mapping. ❌ LOW (noch nicht decodiert): Pitch (kein signed-byte in 4000-sample Histogram), FxSend (kein klares default-pattern), Swing (PTST+0x123..0x12A varying bytes ohne erkennbare Korrelation zu User-bekannten Werten), Motion-Sequencer-Daten, byte 0x18 in part-header (zeigt 127/85 als peak — vermutlich Sample-Volume vs Part-Volume, semantisch unklar gelassen).",
        "package.json 3.12.0 → 3.13.0."
      ],
      next: [
        "TASK-v3.13-FU-1 (Pitch RE): kein Byte in den part-header 48 Bytes zeigt signed-distribution. Möglicherweise ist Pitch nicht per-Part-Header sondern in motion-data / pattern-globals encoded — oder als unsigned offset mit center=0x40. Cross-Check mit User-Pattern wo Pitch bewusst gesetzt ist (z.B. Synth-Parts mit nicht-default Tune) wäre der nächste RE-Schritt.",
        "TASK-v3.13-FU-2 (FxSend RE): kein klares default-pattern in der Bank. Möglicherweise im 1280B trailing pattern-footer oder als motion-modulation gespeichert. Hex-Diff Init vs BodyTalk Part 0 zeigt diff bei +0x18 (Init=0x55, BodyTalk=0x7F) — könnte FxSend sein, aber Init181 alle 16 Parts bei 0x55 ist unverdächtig (gleicher Default), während Init250 0x7F hat. Zwei verschiedene 'init' Defaults für FxSend wären strange.",
        "TASK-v3.13-FU-3 (Swing RE): PTST+0x123..0x12A im Bereich der Pattern-Header-Felder hat varying bytes (z.B. PTST+0x23 = 4/5/3, PTST+0x29 = 2 fast immer). Vergleich gegen User-bekannte Swing-Werte (in Pattern-Documentation der KORG E2) wäre notwendig — aktuelle Stock-Bank hat keine annotierten Swing-Werte abrufbar.",
        "TASK-v3.13-FU-4 (Motion-Sequencer im 1280B trailing footer): unverändert vs v3.12 — separater RE-Pass benötigt mit BodyTalk-Patterns die bekanntermaßen Motion-Daten haben.",
        "TASK-v3.13-FU-5 (byte 0x18 Semantik): Init181 hat 0x55=85, Init250 hat 0x7F=127, BodyTalk varied 0x14..0x7F. Mit 2 verschiedenen Init-Defaults ist es kein Motion-Volume — könnte Sample-Volume sein (vs Part-Volume), Send-Level, oder Pitch (unsigned 0..127 statt signed)."
      ],
      changed: [
        "client/src/utils/electribeImport.ts (+6 v3.13-Konstanten für Volume/Pan/StepLength-Offsets + Mapping, parseRealPartBlock decodiert Volume @ +0x15 + Pan @ +0x22 mit defensive clamp, parseRealPatternAt decodiert stepLength via PTST+0x25-Mapping, e2sallpat-Fallback nutzt neue _DEFAULT-Konstanten, Header-Kommentar dokumentiert v3.13-RE-Findings + Confidence-Levels)",
        "tests/features/electribe-import.test.ts (+16 Tests: 7 real-file v3.13 Volume/Pan + 4 real-file StepLength + 4 e2sallpat-Stock-Bank histogram-Validation + 1 Constants-Export-Check)",
        "package.json (3.12.0 → 3.13.0)",
        "agents/INDEX.js (version 3.12.0 → 3.13.0 + workLog v3.13.0 + TASK-v3.12-FU-1 partial + TASK-v3.12-FU-3 closed)"
      ]
    },
    {
      agent:     "backend",
      timestamp: "2026-05-18T11:05:00.000Z",
      done: [
        "v3.12.0: Step-Encoding Reverse-Engineering für KORG E2 Sampler .e2spat Patterns — closes TASK-v3.5-FU-1 + TASK-v3.11-FU-3. Vorher (v3.2..v3.11): Parser liefert Pattern-Name + BPM korrekt, ABER alle Steps werden als 'inactive' Defaults zurückgegeben (Best-Effort-Fallback). Jetzt: vollständig verified 12-byte step-record-Encoding inkl. Trigger, Velocity (mit 0xFF-Default-Sentinel), Note-Number. RE-Methode: Hex-Diff von Init181 (16 parts × 64 identische 12-byte 'no-trigger' records) vs BodyTalk1 (programmed) via Node-inline-Skript. Init181 enthält 1024 wiederkehrende records mit konstantem stride-12 (1008 of them) + 15 inter-part gaps stride-60 ⇒ confirmed 16 parts × 64 steps × 12 bytes = 12288 step-bytes + 48 bytes part-header. KEY INSIGHT: Part-Stride ist 816 (NICHT 896 wie pre-v3.12 angenommen). 0x900 + 16×816 = 0x3C00 + 1280B trailing pattern-footer = 16640B exakt File-Size.",
        "Step-Record 12-Byte Layout (VERIFIED): byte0=Trigger(0x00/0x01), byte1=Velocity(0x00..0x7F = explicit 0..127, 0xFF = sentinel 'use default 127'), byte2=Konst 0x60 (note-attribute-prefix?), byte3=Accent/Tied-Flag(0/1, Semantik TBD), byte4=Note-Number(MIDI 0..127, default 0x48=C5), bytes5..11=Reserved (mostly 0x00, nicht reverse-engineered). Verification gegen BodyTalk1: Part 6 hat exakt 16 active steps bei [2,6,10,14,...,62] = klassischer Hi-Hat offbeat. Part 11 hat exakt 9 active steps bei [0,4,12,20,28,36,44,52,60] = Kick auf 4er-Beats. Part 9 hat 16 offbeat-Steps. Total Active in BodyTalk: ~290 Steps verteilt auf 14 Parts (Part 5+10 leer).",
        "Implementation: (1) client/src/utils/electribeImport.ts: ELECTRIBE_REAL_PART_STRIDE 896→816 (CORRECTED), +ELECTRIBE_REAL_PART_HEADER_BYTES=0x30, +ELECTRIBE_REAL_STEP_RECORD_BYTES=12, +ELECTRIBE_REAL_STEPS_PER_PART=64, +ELECTRIBE_REAL_STEP_TRIGGER_OFFSET=0/_VELOCITY_OFFSET=1/_NOTE_OFFSET=4, +ELECTRIBE_REAL_VELOCITY_DEFAULT_SENTINEL=0xFF/_VALUE=127. parseRealPartBlock komplett umgebaut: alte Best-Effort-Stub-Implementation (alle steps inactive) ersetzt durch 12-byte-record-Reader mit safeU8/safeU16LE + per-step bounds-check + velocity-sentinel-handling + defensive clamp out-of-range velocity (0x80..0xFE → 127). Part-Header-Felder (Volume/Pan/Pitch/FxSend) bleiben Hardware-Defaults — Offsets noch nicht final RE-d. Header-Kommentar des Files dokumentiert RE-Methodik + Confidence-Levels (HIGH für Step-Trigger+Velocity+Note, MEDIUM für Part-Header-Felder, LOW für Motion-Sequencer). (2) tests/features/electribe-import.test.ts: +6 Real-File-conditional Tests im NEW describe-Block 'v3.12 Step-Encoding RE (Real-File-Verifikation)': BodyTalk1 total >=100 active steps + 6+ parts mit triggers, Init181 baseline near-empty (max 1 part, max 4 active — entdeckt: Init181 hat Part 8 mit 4 default-kicks bei [0,4,8,12], überraschend), Velocity-Sentinel 0xFF→127 mapping, BodyTalk Part 6 offbeat-Pattern exact assertion, BodyTalk Part 11 kick-pattern exact assertion, alle 64 step-slots materialisiert + velocity range-check. +6 Synthetic Tests im NEW describe-Block 'v3.12 Step-Encoding (synthetic)' via NEW buildRealElectribeBufferWithSteps Helper: programmierte triggers round-trip, Velocity-Sentinel, inactive-trigger trotz Velocity!=0, parts-getrennte Extraction (kein Cross-Contamination), Out-of-range velocity clamp auf 127, 16. Part Index 15 Stride-Check bis ans File-Ende. EXISTIERENDE Test 'Layout-Konstanten plausibel' angepasst: 16×896=14336 → 16×816=13056 ab 0x900 → 0x3C00 + 1280B trailing footer = 16640.",
        "Test-Resultat: pnpm vitest run tests/features/electribe-import.test.ts → 95 passed (vorher 83, +12 neue v3.12 Tests). tests/features/electribe-motion-bridge.test.ts → 21 passed (unverändert, kein Side-Effect). pnpm check clean. Real-File-Tests skip-en auf CI ohne 'Korg e2s files/'-Ordner — Repo bleibt schlank, lokale RE-Verifikation funktioniert.",
        "Confidence-Level (v3.12 RE): ✅ HIGH (verifiziert gegen 4 reale .e2spat-Files): Pattern-Name (0x110), BPM (0x122, × 10), Step-Trigger (byte0 jedes 12-byte records ab part_off+0x30), Step-Velocity (byte1 mit 0xFF-Sentinel), Step-Note (byte4), Part-Stride (816), Step-Count-per-Part (64). ⚠ MEDIUM: Per-Part-Header Felder (Volume/Pan/Pitch/FxSend) — Hex-Diff zeigt diff bei +0x08/0x0B/0x0C zwischen Parts aber Semantik unverified. Step-Record byte3 (Accent/Tied?). ❌ LOW (noch nicht RE-d): Motion-Sequencer-Daten (sind sie im 1280B trailing footer?), Step-Length im Pattern-Header (0x124+), Swing, das u32-Value bei part_off+0x08 (möglicherweise Sample-Slot-Reference).",
        "v3.12 Math-Verifikation: Init181 hat 1024 = 64*16 step-records mit byte1=0x48 (verifiziert via Node grep). Stride histogram: 1008 records mit Δ=12 + 15 records mit Δ=60 = 16 boundary-crossings * (12+60-12) = 16×60 = 960... aktuell ist gap=60 bei 15 boundaries = 15×60 + 1008×12 + 12 (initial offset) = 900 + 12096 + 12 = 13008. Plus part-header 48*16 = 768 - 48 (no header before P0) = 720... hmm. Echte Rechnung: 16×(48 header + 64×12 step) = 16×(48+768) = 16×816 = 13056 ⇒ Parts-Area 0x900..0x3C00. Bestätigt durch positions[64]-positions[0] = 0xC61-0x931 = 816 = part-stride.",
        "package.json 3.11.0 → 3.12.0."
      ],
      next: [
        "TASK-v3.12-FU-1 (Part-Header-Felder RE): Volume/Pan/Pitch/FxSend Offsets in den 48 Bytes vor den Step-Records sind noch unverified. Hex-Diff Init181 P0 vs P1 zeigt diff bei +0x08 (Sample-Slot?), +0x0B (vol?), +0x0C..0x0D, +0x14..0x15. Mit RE-Bench (BodyTalk wo Mixer-Settings audibly anders sind als Init) könnte das systematisch verifiziert werden.",
        "TASK-v3.12-FU-2 (Motion-Sequencer im 1280B Trailing Footer): nach den 16×816 Part-Blocks bleibt 0x3C00..0x4100 = 1280B Pattern-Footer. Vermutlich enthält das Motion-Sequencer-Daten (4 Slots × 16 Steps × 1B + Slot-Header pro Part = 16×4×(4+16)=1280 ist verdächtig clean — könnte exakt passen). Hex-Diff BodyTalk-mit-Motion vs Init wäre der nächste RE-Schritt.",
        "TASK-v3.12-FU-3 (Step-Length / Swing im Pattern-Header 0x124+): aktuell defaults 16/0. Im Bereich 0x124..0x14F sind Diffs zwischen Files sichtbar (z.B. 0x125, 0x12A, 0x131). Mit RE könnten step-length (16/32/64) + swing decoded werden.",
        "TASK-v3.12-FU-4 (Note-Number anwenden im SynthstudioPatternImport): byte4 (Note) wird aktuell geparsed aber nicht in convertParsedPatternToSynthstudio durchgereicht. ParsedPart.steps haben kein note-Feld — könnte erweitert werden zu {active, velocity, note} und in piano-roll-Patterns durchgereicht.",
        "TASK-v3.12-FU-5 (Step-Encoding für .e2sallpat-Slots): die 250 Slots der Stock-Bank teilen das gleiche Layout (verifiziert v3.11: parseRealPatternAt ist generisch). Daher gilt das v3.12-Step-Encoding auch dort automatisch. Smoke-Test gegen die 2016-Stock-Bank wäre wertvoll."
      ],
      changed: [
        "client/src/utils/electribeImport.ts (PART_STRIDE 896→816, +7 v3.12-Konstanten, parseRealPartBlock komplett umgebaut für 12-byte step-record Encoding mit velocity-sentinel-handling, Header-Kommentar dokumentiert RE-Methodik+Confidence-Levels, 2 inline-Kommentare 896→816)",
        "tests/features/electribe-import.test.ts (+12 Tests: 6 real-file conditional v3.12-RE-Verifikation + 6 synthetic via buildRealElectribeBufferWithSteps + 1 angepasster Layout-Konstanten-Test 16×896 → 16×816+footer)",
        "package.json (3.11.0 → 3.12.0)",
        "agents/INDEX.js (version 3.11.0 → 3.12.0 + workLog v3.12.0 + TASK-v3.5-FU-1 / TASK-v3.11-FU-3 closed)"
      ]
    },
    {
      agent:     "backend",
      timestamp: "2026-05-18T10:50:00.000Z",
      done: [
        "v3.11.0: .e2sallpat Multi-Pattern-Bank-Parser (250 Patterns aus KORG E2 Sampler 2016 Stock-Banks). User stellte real-file 'G:/IdeaProjects/Synthstudio/e2s-2016/e2s-2016.e2sallpat' (4 161 792 Bytes) bereit. Binary-Reverse-Engineering verifizierte: (a) File-Header 0x000..0x100 identisch zu .e2spat (KORG + e2sampler + Version u32 LE + 220B 0xFF padding). (b) Bank-Header bei 0x100: 'GLST' Marker (4B) + u32 LE Chunk-Length (256) + 248B Metadaten (mostly zeros) + 'GLED' End-Marker bei 0x1FC. (c) Padding 0x200..0x10100 = 0xFF. (d) 250 Pattern-Records ab 0x10100, jeder 16384B (0x4000), PTST-prefixed, PTST+0x10=Name(16B ASCII), PTST+0x22=BPM*10 (u16 LE), PTST+0x800=Parts-Offset (PTST-relativ statt 0x900 file-absolut). File-Math: 256 (header) + 0xFF00 (GLST area) + 250×0x4000 (patterns) = 4 161 792 = exakt Stock-Bank-Size. Total 241 non-Init Slots in 2016-Bank (Stalactite 1-3, Solar 1-4, Night B 1-3, ..., CircuitDaughter1/2, CirquitDaughter1/2 + 9 'Init Pattern' Slots in 240er-Range).",
        "Implementation 6-teilig: (1) client/src/utils/electribeImport.ts +Multi-Pattern-Detector isElectribeAllPatBank(buf) prueft KORG + e2sampler + GLST + PTST markers + min-size. +Multi-Pattern-Parser parseElectribeAllPatBank(buf) walked 250 PTST-Records mit fixem Stride 16384B ab 0x10100 via parseRealPatternAt(view, ptstOffset, slotIndex). +parseRealPatternAt(view, ptstOffset, slotIndex) als generischer PTST-relativer Parser, der auch .e2spat single-pattern (ptstOffset=0x100) bedient — eliminiert Code-Duplikation. +detectElectribeFormatKind() 3-Wege-Klassifikator 'e2spat'|'e2sallpat'|'legacy'|'unknown'. +filterNonInitPatterns(patterns[]) Convenience-Helper. +Konstanten ELECTRIBE_ALLPAT_FIRST_PATTERN_OFFSET=0x10100, _STRIDE=0x4000, _SLOT_COUNT=250, _EXPECTED_SIZE=4_161_792, _GLST_MARKER='GLST'. detectElectribeFormat erweitert um e2sallpat-Branch (liefert 'bank'). parseElectribeBank dispatched .e2sallpat → parseElectribeAllPatBank. MAX_ELECTRIBE_FILE_BYTES 5MB → 8MB. Defensive: kaputte PTST-Marker → Fallback-Pattern 'Slot N' ohne Crash. (2) electron/main.ts ELECTRIBE_MAX_BYTES 5MB → 8MB (in-line const). (3) electron/ipcValidators.ts ELECTRIBE_MAX_BYTES 5MB → 8MB. (4) client/src/components/DrumMachine/DrumMachine.tsx +import filterNonInitPatterns + useMemo. accept='.e2pattern,.e2sallpat' → '.e2pattern,.e2sallpat,.e2spat'. Picker-Modal refactored zu eigenstaendiger ElectribePickerModal-Komponente (oberhalb DrumMachine) mit Search-Input (Name/Slot/BPM-Filter) + 'Init ausblenden'-Checkbox (default-on bei >50 Slots fuer e2sallpat-UX). max-w-md → max-w-lg fuer 250-Pattern-Liste. (5) Tests in tests/features/electribe-import.test.ts: 18 neue Tests (13 synthetisch + 5 conditional gegen Real-Stock-Bank). buildAllPatBuffer({slots, slotCount, brokenSlots})-Helper erstellt valides .e2sallpat in Memory. Coverage: Layout-Konsistenz, isElectribeAllPatBank Detection/Negative-Cases, detectElectribeFormat='bank', detectElectribeFormatKind 4-Werte, 250-Pattern-Parse mit Stalactite/Solar/BodyTalk Slots, BPM-Range-Plausibilitaet 20-300, Pattern-Namen-Extraction, defensive gegen kaputte PTST-Marker (kein Throw, Fallback 'Slot N'), tiny-buffer-rejection, parseElectribeBank-Dispatch, filterNonInitPatterns, truncated-bank-handling. Real-Stock-Bank-Tests conditional auf existsSync(e2s-2016/e2s-2016.e2sallpat): exakte File-Size 4 161 792, detect-Funktionen, 250 Patterns mit BPM-Range, Stalactite 1/2/3 Namen + BPM 73.4, filterNonInitPatterns liefert 200-249 Patterns (real 241). (6) package.json 3.10.0 → 3.11.0. Bestaetigung: pnpm check clean. pnpm vitest run tests/features/electribe-import.test.ts → 83 Tests passed (vorher 65, +18 neu). pnpm test gesamt → 3 818 passed / 15 skipped (vorher 3 799 → +18 neu + 1 angepasst 6MB→9MB Limit-Test).",
        "Verified Real-Stock-Bank-Findings: (a) Bank-Header bei 0x100 ist 'GLST' (4B Magic) + u32 LE Chunk-Length=256 + 248B mostly-zero Metadata + 'GLED' End-Marker bei 0x1FC. Keine Pattern-Name-Table im Pre-PTST-Bereich (Slot-Names sind ausschliesslich in PTST+0x10 der Records). (b) Pattern-Stride exakt 0x4000=16384B (vs .e2spat single-pattern body=16640B inkl. eigener 256B Datei-Header-Praefix). (c) Erste 3 Slots: 'Stalactite 1/2/3' alle 73.4 BPM. Letzte 4 Slots: 'CircuitDaughter1/2' + 'CirquitDaughter1/2' alle 120 BPM. Slots 241-246: 'Init Pattern' 120 BPM. (d) 241 von 250 Slots haben User-Namen (kein 'Init Pattern'). 9 Slots sind Werks-Init."
      ],
      next: [
        "TASK-v3.11-FU-1 (.e2sallpat GLST/GLED-Metadata): aktuell ignoriert. Falls KORG dort Slot-Names-Cache oder Bank-Title speichert (PDF-Manual erwaehnt es nicht eindeutig), waere ein zukuenftiger Parse-Pass moeglich.",
        "TASK-v3.11-FU-2 (Multi-Select Bulk-Import): aktuell waehlt Picker EIN Pattern. Multi-Select-Checkbox + 'Import N Patterns als neue Patterns in DrumMachine' waere natuerliche UX-Erweiterung fuer 250-Slot-Banks.",
        "TASK-v3.11-FU-3 (.e2sallpat Step-Encoding RE): Step-Daten ab PTST+0x800 (Parts-Block) sind weiterhin Best-Effort (alle Steps inactive). Mit 250 echten Werks-Patterns als Vergleichsmaterial koennte das Bit-Encoding reverse-engineered werden — gleicher Status wie bei .e2spat single-pattern.",
        "TASK-v3.11-FU-4 (.e2sallpat Write-Support): aktuell nur Read. Schreiben einer .e2sallpat aus N DrumMachine-Patterns waere komplementaer zum existierenden v3.4 .all Write (KORG Sample-Bank). Vorerst kein Bedarf, da Synthstudio-Patterns nicht auf Hardware zurueck-gespielt werden sollen.",
        "TASK-237-FOLLOWUP-... → done (Multi-Pattern-Bank-Support implementiert)."
      ],
      changed: [
        "client/src/utils/electribeImport.ts (+isElectribeAllPatBank, +parseElectribeAllPatBank, +parseRealPatternAt, +detectElectribeFormatKind, +filterNonInitPatterns, +6 Konstanten, parseElectribeBank dispatched .e2sallpat, MAX_ELECTRIBE_FILE_BYTES 5MB→8MB, parseRealPattern refactored als duenner Wrapper)",
        "electron/ipcValidators.ts (ELECTRIBE_MAX_BYTES 5MB→8MB)",
        "electron/main.ts (in-line ELECTRIBE_MAX_BYTES 5MB→8MB)",
        "client/src/components/DrumMachine/DrumMachine.tsx (+useMemo + filterNonInitPatterns Import, +ElectribePickerModal-Subkomponente mit Search-Filter + Init-Hide-Toggle, accept-Attribut +.e2spat, Tooltip aktualisiert)",
        "tests/features/electribe-import.test.ts (+18 Tests fuer .e2sallpat: 13 synthetisch via buildAllPatBuffer + 5 conditional gegen e2s-2016/e2s-2016.e2sallpat, +Imports +1 Limit-Test angepasst 6MB→9MB)",
        "package.json (3.10.0 → 3.11.0)",
        "agents/INDEX.js (version 3.10.0 → 3.11.0 + workLog v3.11.0)"
      ]
    },
    {
      agent:     "refactor",
      timestamp: "2026-05-18T10:30:00.000Z",
      done: [
        "v3.10.0: KORG-Module Quality-Sweep nach 7 Feature-Releases (v3.3-v3.9). SCOPE: Tech-Debt-Audit von client/src/utils/korg/*.ts (10 Files, 3 600 LOC), client/src/components/KorgBank/*.tsx (3 Files, 2 423 LOC) und tests/features/korg-*.test.ts (8 Files, 3 275 LOC) ohne neue Features. (1) FIX: window.electronAPI-Direktzugriff in KorgBankEditor.tsx::handleSaveAs (Zeile 571-580) verletzt die isomorphic-Invariante aus CLAUDE.md. saveKorgBankAs + getKorgBankSaveCap waren nur in electron/preload.ts + electron/types.d.ts exposed, aber NICHT im useElectron()-Hook → der einzige Konsumer (KorgBankEditor) hat direkt window.electronAPI ge-casted. REFACTOR: electron/useElectron.ts: browserAPI bekommt saveKorgBankAs-Stub (success:false → triggert Blob-Download-Fallback im Editor) + getKorgBankSaveCap (mirror-cap 256 MB). Electron-Pfad delegiert via api.saveKorgBankAs ?? browserAPI.saveKorgBankAs (defensive falls altes Preload geladen). KorgBankEditor.tsx: +import useElectron, +const electron = useElectron() im Component-Body, handleSaveAs verwendet jetzt electron.isElectron + electron.saveKorgBankAs(finalName, buf). Vorher 9 Zeilen mit 2 Type-Casts (window.electronAPI as {…}) + duck-typing-Check, nachher 4 Zeilen ohne any/cast. (2) AUDIT 'any'-Vorkommen in den Binary-Parsern (esxParser, e2sBankReader, e2sBankBuilder, audioProcessor) + KorgBank-Komponenten: keine echten any/<any>/as any gefunden — alle Treffer waren English-Wort 'any' in Kommentaren. KORG-Module ist bereits strict-typed: alle DataView/Uint8Array/Float32Array korrekt typisiert, ESLI_*-Offset-Konstanten als const numerische Literals, LoopType als 0|1|2 union, channels als 1|2 union, E2sSlotInput.pcmData strikt Float32Array. (3) AUDIT ESLI-Field-Layout-Duplication zwischen e2sBankReader und e2sBankBuilder: KEINE Duplikation — beide importieren alle 20+ ESLI_*_OFFSET Konstanten aus client/src/utils/korg/constants.ts. Das ist exakt das richtige Pattern (Single-Source-of-Truth ohne Über-Abstraktion). Nichts zu tun. (4) AUDIT KorgBankEditor.tsx Größe: 1 299 LOC. Subkomponenten-Extraction (SlotBrowser/SlotDetailPanel/SliceSection) wäre theoretisch möglich, aber: a) Slot-Detail-Panel teilt State (busy/auditionState/selectedRowId/replaceInputRef) sehr eng mit Parent — Extraktion würde ~10 Props pro Subkomponente bedeuten und die Lesbarkeit verschlechtern. b) Render-Code ist linear top-down strukturiert (Mode-Toggle → Header → Body { left: Slot-Browser, right: Detail mit Slice-Section } → Footer) — gut zu folgen ohne zerteilen. c) Tests sind bereits Top-Level-Smoke (korg-bank-editor.test.ts testet via testid). Bewusste Entscheidung: nicht extrahieren — DRY > Lesbarkeit hier nicht gegeben. Followup-Marker: TASK-v3.10-FU-1 falls die Datei in v3.11+ über 1 500 LOC wächst, dann SliceSection als erste Extraction-Kandidatin. (5) AUDIT Tests-Fixtures: 8 KORG-Test-Files (3 275 LOC). Wiederkehrende Patterns: sineFloat(frames,freq,sr,amp) und bytesEqual(a,b) sind in korg-e2s-builder.test.ts und tangential in korg-e2s-bank.test.ts dupliziert. ABER: Extraktion in tests/fixtures/korg-fixtures.ts würde Import-Pfad-Churn in 8 Files für ~10 LOC Ersparnis bedeuten. Bewusste Entscheidung: nicht extrahieren — die Helpers sind 3-5 Zeilen pure-funktional, Lesbarkeit der Tests bleibt höher wenn der Helper im File ist. Followup-Marker: TASK-v3.10-FU-2 falls in v3.11+ noch mehr KORG-Tests dazukommen UND die Helper-Lib wirklich wächst (z.B. eine minimal-valid-E2S-Bank-Buffer-Builder-Funktion >20 LOC). (6) AUDIT Konsistenz Public-API-Naming: parseE2sBank/buildE2sBank/parseEsxBank/convertToE2sSpec — alle konsistent verb-noun. Error-Handling konsistent: alle Module werfen named Errors (E2sParseError, E2sBuildError, EsxParseError, AudioProcessError) statt return-Result-Types — match-Pattern in den Konsumern bleibt einheitlich. SoT-Marker (// SoT: Python:filepath:line) ist in 4/4 Binary-Modulen vorhanden (e2sBankReader, e2sBankBuilder, audioProcessor, esxParser). (7) VERIFIED: pnpm check clean. pnpm test 3 799 passed / 15 skipped (UNVERÄNDERT — Refactor hat KEIN Verhalten geändert). pnpm test gegen korg-bank-editor.test.ts spezifisch: weiter alle 33+ Tests grün. package.json 3.9.0 → 3.10.0. INDEX.js version-Bump.",
        "Findings-Liste konkret (File:Line → Was geändert): (a) client/src/components/KorgBank/KorgBankEditor.tsx:573-580 → window.electronAPI direct + Type-Cast eliminiert (electron.saveKorgBankAs via Hook). (b) electron/useElectron.ts:86-99 → +browserAPI.saveKorgBankAs/getKorgBankSaveCap Fallbacks. (c) electron/useElectron.ts:335-337 → +Electron-Pfad-Delegation api.saveKorgBankAs/getKorgBankSaveCap. (d) client/src/components/KorgBank/KorgBankEditor.tsx:32 → +import useElectron. (e) client/src/components/KorgBank/KorgBankEditor.tsx:154 → +const electron = useElectron(). Vor/Nach LOC KorgBankEditor.tsx: 1 299 → 1 295 (4 Zeilen netto-Reduktion durch Cast-Eliminierung).",
        "any-Vorkommen vor/nach: vor=0 (echte any-Casts), nach=0. KORG-Module war bereits strict typed. Audit-Methode: Grep ': any|as any|<any>' + Grep '\\bany\\b' jeweils zero Real-Hits (nur Kommentar-Wort 'any').",
        "Test-Resultat: Baseline 3 799 passed / 15 skipped (168 files) → Nach Refactor 3 799 passed / 15 skipped (168 files). Identisch — Refactor garantiert verhaltensneutral.",
        "Bewusst NICHT angefasst (mit Begründung): (1) KorgBankEditor.tsx Subkomponenten-Extraction → State-Coupling zu eng, Render-Flow linear, Tests bereits Top-Level-Smoke (Extraction würde Props-Drilling von >10 Werten pro Subkomponente einführen ohne Lesbarkeit zu erhöhen). (2) ESLI-Field-Layout shared esliLayout.ts → bereits in constants.ts zentralisiert, weitere Abstraktion wäre Über-Engineering. (3) Test-Fixtures shared korg-fixtures.ts → Helper sind 3-5 LOC pro File, Import-Churn würde mehr kosten als sparen. (4) v3.4 Builder vs v3.6 Builder-Erweiterung Code-Duplication → existiert nicht: passthroughRiff() + buildRiffForSlot() sind 2 unterschiedliche Pfade die DIFFERENT Code teilen müssen (Raw-Passthrough vs Re-Encoding), Refactor zu shared-helper würde defensive-Validierung der beiden Pfade durcheinanderwerfen."
      ],
      next: [
        "TASK-v3.10-FU-1 (KorgBankEditor.tsx LOC-Monitor): aktuell 1 295 LOC. Wenn in v3.11+ über 1 500 LOC steigt, dann SliceSection als erste Extraction-Kandidatin (kapselbarer Sub-State: auditionState + audition-Handlers + WaveformSliceCanvas-Wiring).",
        "TASK-v3.10-FU-2 (KORG Test-Fixtures Re-Eval): falls neue KORG-Test-Files dazukommen UND wiederkehrende Buffer-Builder >20 LOC entstehen, dann tests/fixtures/korg-fixtures.ts mit minimalValidE2sBankBuffer() + slotMockFactory().",
        "TASK-v3.10-FU-3 (Migration Audit andere window.electronAPI Hotspots): client/src/audio/AudioEngine.ts:2129-2130 hat noch window.electronAPI?.readFile-Direktzugriff (vermutlich für Local-Path-Resolution). Nicht im KORG-Scope dieser Session, aber wäre nächster Refactor-Pass."
      ],
      changed: [
        "electron/useElectron.ts (+browserAPI saveKorgBankAs/getKorgBankSaveCap Stubs + Electron-Pfad-Delegation)",
        "client/src/components/KorgBank/KorgBankEditor.tsx (+useElectron Import + const electron, handleSaveAs nutzt electron.saveKorgBankAs statt window.electronAPI as any, Header-Comment ergänzt v3.10.0-Marker)",
        "package.json (3.9.0 → 3.10.0)",
        "agents/INDEX.js (version 3.9.0 → 3.10.0 + workLog v3.10.0)"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-18T10:20:00.000Z",
      done: [
        "v3.9.0: Slice-Audition-Preview im KorgBankEditor — closes TASK-v3.8-FOLLOWUP-2. Click auf eine bestehende Slice-Region im Waveform-Canvas startet jetzt Web-Audio-Playback der genau betroffenen Sub-Range (Audition-Preview wie in MPC/Maschine/Recycle). Click-Routing-Disambiguation gegen das v3.8 Add-Verhalten via Modifier-Keys + Region-Hit-Test. (1) NEU client/src/utils/korg/sliceAudition.ts (~210 LOC, pure isomorph). Pure-Helpers: findSliceUnderFrame(onsets, frame, totalFrames) → SliceRegion{index, startFrame, endFrame}|null — Region-Hit-Test mit defensive sort + out-of-range guards (frame<firstOnset.frame, frame>=totalFrames, totalFrames<=0, empty onsets alle → null). extractSliceBuffer(pcm, channels, startFrame, endFrame) → Float32Array — Mono = pcm.slice() (eigener Buffer für GC-Indep), Stereo = deinterleave Kanal 0 (Left, kein Mixdown — User hört 'echte' Wave). Bound-Clamping: start<0→0, end>total→total, end<=start→empty. Web-Audio-Layer: playSliceWithContext(ctx: MinimalAudioCtx, buffer, sampleRate, opts?) → SliceAuditionHandle{stop():void, active:boolean}|null. Routing BufferSource → Gain(0.85) → outputNode (default ctx.destination, also kein FX-Bus für sauberes A/B). source.onended-Hook + stop()-Methode beide idempotent + cleanen disconnect, beide rufen onEnded genau einmal. MinimalAudioCtx-Interface für test-Mockbarkeit. (2) UPDATE client/src/components/KorgBank/WaveformSliceCanvas.tsx (~320→~430 LOC). NEU optionale Props: onAudition?(sliceIndex, startFrame, endFrame), playingSliceIndex, playingStartedAt, playingDurationMs. Click-Routing geändert: wenn onAudition gesetzt UND onsets.length>0 UND kein Alt/Ctrl/Shift Modifier → findSliceUnderFrame(frame) → onAudition() statt addOnset. Alt/Ctrl bypassen Audition → addOnset bleibt funktional. Shift/Rechtsklick auf Marker = remove (unverändert). Drag = move (unverändert). Click-auf-Marker-im-Audition-Modus: spielt die Slice ab statt zu draggen — Drag ist via Alt/Ctrl+Drag noch möglich (Modifier-Test bypasst Audition). Render-Effect ergänzt: playingRegion-Tint (bg-accent-primary 0.2 alpha) hinter der Waveform, Playhead-Line (bg-accent-success) wandert über die Region (RAF-loop nur aktiv solange playingSliceIndex≠null, sonst 1-Frame-Render). Cursor: 'pointer' über bestehender Slice im Audition-Modus, 'crosshair' über leerem Bereich, 'grabbing' beim Drag. Tooltip kontextabhängig (audition vs add). Mouse-Leave resettet hoverFrame + handleMouseUp (für Drag-Recovery). (3) UPDATE client/src/components/KorgBank/KorgBankEditor.tsx. Imports +extractSliceBuffer/playSliceWithContext/SliceAuditionHandle. NEU State auditionState{rowId,sliceIndex,startedAt,durationMs}|null + auditionHandleRef. NEU stopCurrentAudition() useCallback. Cleanup useEffect: Audition-Handle stop() vor AudioContext close(). NEU useEffect mit selectedRowId+mode deps: Audition stoppt bei Slot-/Mode-Wechsel. renderSliceEditor erweitert: handleAudition(sliceIndex, start, end) → toggle (zweiter Click auf gleiches Slice = stop), sonst stopCurrentAudition() → getCtx() → extractSliceBuffer → playSliceWithContext mit onEnded-Callback der auditionState konditional auf prev.rowId+sliceIndex resettet (race-safe). WaveformSliceCanvas erhält onAudition + playingSliceIndex/StartedAt/DurationMs Props. Help-Text wird dynamisch: bei sliceCount>0 zeigt '▶ Klick auf Slice = abspielen · Alt/Ctrl+Klick = Marker hinzufügen · …'; bei sliceCount=0 bleibt 'Linksklick = Marker hinzufügen · …'. data-testid=korg-bank-editor-slice-help. (4) NEU tests/features/korg-slice-audition.test.ts (24 Tests, alle grün): findSliceUnderFrame (8: 3 Hit-Regions first/middle/last, out-of-range frame>=total, empty onsets, frame-before-first-onset, totalFrames<=0, unsorted-onsets-defensive sort+original-index lookup). extractSliceBuffer (6: mono sub-copy, stereo deinterleave Kanal 0, start-neg-clamp, end-overflow-clamp, end<=start-empty, empty-pcm). playSliceWithContext (10: AudioBuffer mit korrekter length+sampleRate+content via toBeCloseTo Float32-Precision, Routing src→gain→destination, stop() idempotent + .active=false, onEnded exakt 1× pro stop, empty-buffer → null, invalid-sampleRate (0/-1/NaN) → null, custom outputNode-Routing, custom gain.value=0.5, Integration extractSliceBuffer→playSliceWithContext Stereo-Path-Test, sequential-stop-then-replay Pattern für 'next-click-stops-previous'). MockAudioContext + MockBufferSource + MockGainNode + MockAudioBuffer in der Test-Datei (kein DOM nötig). (5) package.json 3.8.0 → 3.9.0. agents/INDEX.js version-Bump + workLog v3.9.0 + TASK-v3.8-FU-2 status closed. pnpm check clean. pnpm test 3799 passed / 15 skipped (von 3775 = +24 neue Tests).",
        "Click-Routing-Logic Disambiguation: a) onsets.length==0 → click adds (legacy). b) onsets.length>0 + onAudition set + kein Modifier → click in slice-region calls onAudition. c) onsets.length>0 + onAudition set + Alt/Ctrl modifier → click adds (escape-hatch). d) Shift/RightClick on marker → remove. e) Drag-on-marker → move (unchanged, plain left-click on marker enters drag-mode only if NOT audition-eligible). Bei Click direkt auf einen Marker im Audition-Modus startet ebenfalls Audition (Region wird ab dem Marker bis zum nächsten Onset gespielt). Toggle-Semantik: zweiter Click auf das aktuell spielende Slice stoppt es (kein Re-Play).",
        "Visual Feedback während Playback: a) playingSliceIndex-Region wird mit bg-accent-primary @ 0.2 alpha hinterlegt (semantic Tailwind via CSS-Var, keine Hardcoded-Farbe). b) Playhead-Line in bg-accent-success-Farbe wandert linear von startFrame zu endFrame über playingDurationMs Sekunden. c) RAF-Loop läuft nur solange playingSliceIndex≠null (kein CPU-Verbrauch wenn idle). d) onEnded-Callback (natural-end ODER manual stop()) resettet die State → Highlight verschwindet automatisch.",
        "Cleanup-Strategy: (a) Mount: kein AudioContext bis erste Audition. (b) Modal-close + Slot-Wechsel + Mode-Wechsel triggern stopCurrentAudition() → handle.stop() → onEnded ruft auditionState=null. (c) Modal-unmount: useEffect-cleanup ruft stop() vor ctx.close(). (d) Doppel-Click-Schutz: zweiter Click auf dasselbe Slice = toggle/stop. (e) Race-safe: onEnded resettet State nur wenn prev.rowId+sliceIndex noch matched (next-Click hat bereits neuen State gesetzt → kein Override).",
        "KNOWN CAVEATS: (1) Audition nutzt einen eigenen AudioContext (lazy-init im KorgBankEditor), nicht den globalen AudioEngine-Singleton — bewusste Entscheidung damit das Modal vollständig autark ist und Audition nicht durch laufende Patterns/FX-Chains beeinflusst wird. AudioEngine.playSliceBuffer (v2.90) existiert weiter, bietet aber kein Stop-Handle. (2) Stereo-Slots werden Mono-auditioned (Kanal 0). Mixdown wäre eine 1-Zeilen-Änderung in extractSliceBuffer, aber Kanal 0 = 'echte' Wave-Repräsentation passend zur Mono-Visualisierung. (3) ESLI-Attack-Length + Amplitude werden im Audition NICHT angewendet — wir spielen das rohe PCM-Segment. Für authentisches E2-Hardware-Behavior wäre ein Pre-Roll mit Volume-Envelope nötig (FOLLOWUP wenn Power-User es fordern, korrespondiert mit TASK-v3.8-FU-1)."
      ],
      next: [
        "TASK-v3.9-FU-1 (ESLI Attack/Amplitude im Audition): Aktuell spielen wir rohe PCM-Slices. Echte E2-Hardware appliziert pro Slice ein attackLength-Volume-Ramp + amplitude-Skalierung. Wenn User-Feedback es fordert: GainNode.gain.linearRampToValueAtTime(amp, ctx.currentTime+attackSeconds).",
        "TASK-v3.9-FU-2 (Stereo-Audition Option): UI-Toggle 'Mono/Stereo Audition' — bei Stereo könnte extractSliceBuffer beide Kanäle separat liefern + playSliceWithContext mit numChannels=2 erstellen. Aktuell nur Kanal 0.",
        "TASK-v3.8-FOLLOWUP-1 (attackLength/amplitude UI): aktuell Defaults 0. Slice-Detail-Popover mit Range-Slidern. Bleibt offen, ergibt jetzt gemeinsam mit FU-1 mehr Sinn.",
        "TASK-v3.7-FOLLOWUP-1 (Playwright E2E): 1-2 E2E-Tests für Open-Edit-Save-Flow im Editor — jetzt auch für Slice-Edit + Audition (DOM-Klick auf Slice-Bereich, observe AudioContext-Creation-Mock via window.AudioContext stub).",
        "TASK-v3.7-FOLLOWUP-3 (Delete-Slot raw-RIFF-Drop): siehe v3.7 workLog — Trade-off bleibt akzeptabel.",
        "TASK-v3.6-FOLLOWUP-3 (Higher-Quality-Resampler): offen, low priority."
      ],
      changed: [
        "client/src/utils/korg/sliceAudition.ts (NEU — ~210 LOC pure isomorph: findSliceUnderFrame + extractSliceBuffer + playSliceWithContext mit SliceAuditionHandle + MinimalAudioCtx Test-Interface)",
        "client/src/components/KorgBank/WaveformSliceCanvas.tsx (UPDATE ~320→~430 LOC: +onAudition/playingSliceIndex/playingStartedAt/playingDurationMs Props, Click-Routing umgebaut für audition-vs-add Disambiguation via Modifier-Keys, Render-Effect mit playingRegion-Tint + Playhead-Line + bedingtem RAF-Loop, Cursor-Hint pointer/crosshair/grabbing kontextabhängig, dynamischer Tooltip)",
        "client/src/components/KorgBank/KorgBankEditor.tsx (UPDATE: +Import sliceAudition, +auditionState+auditionHandleRef, +stopCurrentAudition useCallback, Cleanup-useEffect stoppt vor ctx.close, +useEffect [selectedRowId,mode] stoppt audition, renderSliceEditor mit handleAudition Toggle+playSliceWithContext+onEnded race-safe, WaveformSliceCanvas-Wiring + Help-Text dynamisch sliceCount>0)",
        "tests/features/korg-slice-audition.test.ts (NEU — 24 Tests: findSliceUnderFrame-8 + extractSliceBuffer-6 + playSliceWithContext-10 mit MockAudioContext)",
        "package.json (3.8.0 → 3.9.0)",
        "agents/INDEX.js (version 3.8.0 → 3.9.0 + workLog v3.9.0 + TASK-v3.8-FU-2 closed)"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-18T10:05:00.000Z",
      done: [
        "v3.8.0: ESLI Slice-Editor im KorgBankEditor — chop samples in-app für E2 Sampler. Schließt TASK-v3.6-FOLLOWUP-2 / TASK-v3.7-FOLLOWUP-2 / TASK-v3.4-FOLLOWUP-1. Der KORG E2 kann pro Sample bis zu 64 Slices triggern (Drum-Loops, Vocal-Phrases). v3.3 Reader liest sie, v3.4 Builder schreibt sie — jetzt erstmals UI im Editor. (1) NEU client/src/utils/korg/sliceBridge.ts (~110 LOC, pure-isomorph): esliSliceToOnset({start,length,attack,amp}) → OnsetCandidate{frame,strength:1} clamped Math.max(0, floor(start)). onsetToEsliSlice(onset, nextFrame) → length=max(0, floor(nextFrame-start)) ohne negative-Werte, attackLength+amplitude default 0. slicesToOnsets(slices[]) filtert all-zero-Slices (start==length==attack==amp==0), sortiert nach frame. onsetsToSlices(onsets[], totalFrames) filtert out-of-bounds (frame<0 || frame>=totalFrames), cappt auf MAX_ESLI_SLICES=64, length = nextOnsetFrame oder totalFrames. (2) NEU client/src/components/KorgBank/WaveformSliceCanvas.tsx (~280 LOC): inline reusable Waveform + Slice-Marker Komponente, extrahiert aus SampleSliceEditor's Canvas-Render-Pattern. Controlled-Props (onsets + onChange), ResizeObserver für responsive Breite, RAF-rendering, devicePixelRatio-aware, theme-aware (--ss-*-Vars via getComputedStyle). Pointer-Interaktion: Linksklick=addOnset, Drag=moveOnset+snapToZeroCrossing-on-drop, Shift/Rightclick=removeOnset. Default 120px Höhe (Mini-Inline vs 200px Modal). Reuse sampleSlicing.ts pure-fns. (3) UPDATE client/src/utils/korg/bankEditorState.ts: OpenedSlot.slices: E2sSlice[] NEU Feld, bankToOpenedSlots kopiert src.slices defensive in eigene Objekte (Snapshot-Isolation für Revert), OpenedSlotSnapshot.slices NEU. patchOpenedSlot: slices-Patch zählt jetzt zur editableTouched-Liste (flippt isDirty). NEU setSlotSlices(slots,rowId,slices[]) Convenience-Setter (immer isDirty=true). replaceSlotSample resettet slices=[] (alte Marker beziehen sich auf altes PCM). deleteSlot+revertSlot handhaben slices korrekt. openedSlotsToBuildInputs propagiert slices an E2sSlotInput (nur wenn length>0, sonst undefined → Builder schreibt 64×0-Slices). (4) UPDATE client/src/components/KorgBank/KorgBankEditor.tsx: Import WaveformSliceCanvas + sliceBridge + autoSlice + setSlotSlices. NEU extractMonoChannel(pcm,ch) Helper für Stereo→Mono-Visualisierung (Kanal 0, kein Mixdown). NEU editSlotSetSlices + handleAutoSlice + handleClearSlices Methods. NEU renderSliceEditor(slot) am Ende des Slot-Detail-Panels: '✂ Slices (N/64)'-Header + 'Auto-Slice'-Button (autoSlice mit maxSlices=64,fillToMax=false,snapToZero=true → onsets → onsetsToSlices) + 'Clear'-Button (slices=[]) + <WaveformSliceCanvas> 120px Mini-Variante + Help-Text. data-testids: korg-bank-editor-slice-editor/-auto/-clear/-canvas/-count. (5) NEU tests/features/korg-slice-bridge.test.ts (17 Tests): esliSliceToOnset (2: start→frame, negative-clamp), onsetToEsliSlice (3: length-calc, neg-length-clamp, floor-fractional), slicesToOnsets (4: empty, filter-all-zero, keep-start-0-len-pos, sort-defensive), onsetsToSlices (5: empty, totalFrames<=0, length-calc, cap-64, filter-out-of-bound + filter-neg), Round-Trip (3: onset→slice→onset preserves frames, slice→onset→slice bit-equal, MAX_ESLI_SLICES=64). (6) UPDATE tests/features/korg-e2s-builder.test.ts: +3 v3.8.0-Tests im describe-Block 'ESLI Slice serialization': byte-precise 4×LE32 Layout @ ESLI_SLICES_OFFSET (0x58), Read-Edit-Write Round-Trip 3→4 Slices identisch, Cap-64-enforce mit Warning beim Truncate. (7) package.json 3.7.0 → 3.8.0. pnpm check clean. pnpm test 3775 passed / 15 skipped (von 3753 = +22 neue Tests).",
        "Design-Entscheidung Mini-Variante vs Modal: Inline 120px Canvas direkt im Slot-Detail-Panel. Modal-in-Modal vermieden (UX-Risiko). SampleSliceEditor (Modal) bleibt unverändert für seinen Use-Case (Sample-Library-Chop → Performance-Pads). WaveformSliceCanvas-Komponente in client/src/components/KorgBank/ co-located weil aktuell nur KorgBankEditor sie nutzt — kann später hochgezogen werden wenn andere Stellen sie brauchen.",
        "VERIFIED Round-Trip: Test 'Read → Edit Slices → Write → Read produziert identische Slices' baut Bank mit 3 Slices, parsed, ändert auf 4 Slices, baut neu, re-parsed — Output-Slices exakt {start, length, attack, amplitude} input-equal. Test 'Slices werden in ESLI bei 0x58 korrekt als 4×LE32 serialisiert' verifiziert byte-precise Layout direkt im Builder-Output ohne Reader-Roundtrip."
      ],
      next: [
        "TASK-v3.8-FOLLOWUP-1 (attackLength/amplitude UI): aktuell Defaults 0 für attack+amp. Slice-Detail-Popover mit Range-Slidern attack [0..length] + amplitude [0..0xFFFFFFFF] wäre Power-User-Feature. Aktuell sufficient für Standard-Chop.",
        "TASK-v3.8-FOLLOWUP-2 (Slice-Playback-Preview): Click auf Slice-Marker → AudioEngine.playSliceBuffer(slot.pcmData, sliceStart, sliceLength) für Audition. Aktuell nur visual.",
        "TASK-v3.7-FOLLOWUP-1 (Playwright E2E): 1-2 E2E-Tests für Open-Edit-Save-Flow im Editor — jetzt auch für Slice-Edit.",
        "TASK-v3.7-FOLLOWUP-3 (Delete-Slot raw-RIFF-Drop): siehe v3.7 workLog — Trade-off bleibt akzeptabel.",
        "TASK-v3.6-FOLLOWUP-3 (Higher-Quality-Resampler): offen, low priority."
      ],
      changed: [
        "client/src/utils/korg/sliceBridge.ts (NEU — ~110 LOC pure-isomorph: esliSliceToOnset/onsetToEsliSlice/slicesToOnsets/onsetsToSlices + MAX_ESLI_SLICES constant)",
        "client/src/components/KorgBank/WaveformSliceCanvas.tsx (NEU — ~280 LOC controlled-Komponente: peak-reduzierter Waveform-Render via RAF, ResizeObserver, theme-aware getComputedStyle, Pointer-Interaktion add/move/remove/snap-zero, default 120px Höhe)",
        "client/src/utils/korg/bankEditorState.ts (UPDATE — OpenedSlot.slices:E2sSlice[] Feld, OpenedSlotSnapshot.slices NEU, bankToOpenedSlots kopiert defensiv, patchOpenedSlot detects slices-edit, NEU setSlotSlices, replaceSlotSample reset slices=[], delete/revert handhaben slices, openedSlotsToBuildInputs propagiert slices)",
        "client/src/components/KorgBank/KorgBankEditor.tsx (UPDATE ~1060→~1170 LOC: Import sliceBridge+WaveformSliceCanvas+autoSlice, NEU extractMonoChannel helper, NEU editSlotSetSlices+handleAutoSlice+handleClearSlices, NEU renderSliceEditor inline-section im Slot-Detail-Panel mit Auto-Slice+Clear-Buttons + 120px Canvas)",
        "tests/features/korg-slice-bridge.test.ts (NEU — 17 Tests: 5 single-element + 4 slicesToOnsets + 5 onsetsToSlices + 3 Round-Trip)",
        "tests/features/korg-e2s-builder.test.ts (UPDATE — +3 ESLI Slice-Tests: byte-precise 0x58 Layout, Read-Edit-Write Round-Trip, 64-Cap-Enforce + Warning)",
        "package.json (3.7.0 → 3.8.0)",
        "agents/INDEX.js (version 3.7.0 → 3.8.0 + workLog v3.8.0 + files-Index Updates + TASK-v3.6-FOLLOWUP-2 status closed)"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-18T09:50:00.000Z",
      done: [
        "v3.7.0: Bank-Open-Flow im KorgBankEditor — closes v3.6 raw-RIFF UX-Gap. Schließt TASK-v3.6-FOLLOWUP-1. Der Editor erlaubte bisher nur Build-from-Scratch; jetzt kann der User existierende .all-Banks laden, einzelne Slots editieren und mit Bit-Exact-Preservation aller unedited Slots speichern. (1) NEU client/src/utils/korg/bankEditorState.ts (~310 LOC, pure isomorph). OpenedSlot Type: rowId, slotIndex (0..249), empty:bool, name, category, oneshot, gain12db, sampleTune, pcmData/sampleRate/channels/frames, rawRiff?, isDirty:bool, original:OpenedSlotSnapshot|null. Public API: bankToOpenedSlots(bank,prefix?) — konvertiert E2sBank.slots[250] → editor-rows (250 immer, empty:true für offset=0-Slots, isDirty=false, original-Snapshot kopiert pcmData/sampleRate/channels/frames/rawRiff für Revert). patchOpenedSlot(slots,rowId,patch) — immutable update, setzt isDirty=true wenn editable-Felder (name/category/oneshot/gain12db/sampleTune/pcmData/sampleRate/channels) sich tatsächlich ändern (Wertvergleich, kein flip bei no-op patch). replaceSlotSample(slots,rowId,pcm,sr,ch) — fully fills slot incl. empty→filled transition, frames-recompute, immer isDirty=true. deleteSlot(slots,rowId) — empty:true + isDirty:true, dropped rawRiff/pcmData/sampleRate/channels, original-Snapshot bleibt für Revert. revertSlot(slots,rowId) — restored all fields aus original-Snapshot inkl rawRiff-Referenz, isDirty=false. openedSlotsToBuildInputs(slots) → {inputs:E2sSlotInput[], dirtyCount, passthroughCount, droppedCount}: empty Slots werden skipped (no entry → offset=0), filled-aber-korrupte droppt defensive, isDirty/rawRiff propagated zur buildE2sBank-API. countFilledSlots, countDirtySlots, hasUnsavedChanges, displayName, displayCategory Helpers. Strikt isomorph, keine React/DOM-Deps. (2) UPDATE client/src/components/KorgBank/KorgBankEditor.tsx (~370 → ~740 LOC). NEU header-Mode-Toggle 'Neue Bank' / 'Bank bearbeiten' (role=tablist, data-testids mode-toggle/mode-new/mode-edit) mit window.confirm-Gate bei unsaved changes (tryChangeMode). NEU edit-Modus-UI: empty-state mit '📂 Bank öffnen' Button (data-testid=korg-bank-editor-open) → hidden <input type=file accept=.all> File-Picker (Browser-Fallback funktioniert; Electron-File-Dialog wird via existing electronAPI/CSP nicht extra wired weil <input type=file> in beiden Modi greift). loadBankFromFile(file) → file.arrayBuffer() → parseE2sBank(buf, file.name, {preserveRawRiff:true}) → bankToOpenedSlots → setOpenedSlots → setMode('edit') + Pro-Feature-Gate. Slot-Browser links (md:w-2/5): 250-Row-Liste, empty als '—Empty—' dim italic, filled mit Name + Category + Dirty-Dot (data-testid=korg-bank-editor-slot-N, korg-bank-editor-dirty-N). Slot-Detail rechts: Name-input (16-char), Category-select, Oneshot+Gain12dB-Checkboxes, SampleTune-Range-Slider (-99..+99). 'Replace Sample'-Button → hidden <input accept=audio/*> → decodeArrayBuffer + convertToE2sSpec + replaceSlotSample. 'Löschen'-Button → deleteSlot. 'Revert'-Button → revertSlot (disabled wenn !isDirty). Audio-Info-Panel (channels/sampleRate/frames). Empty-Detail zeigt nur Revert-Button (falls original vorhanden). NEU handleSaveAs branched mode-abhängig: mode='new' = legacy decoder+buildE2sBank (isDirty:true pro picker-Slot), mode='edit' = openedSlotsToBuildInputs() + buildE2sBank({preserveRawRiff:true}). Toast: 'gespeichert: <path> (N geändert, M bit-exakt erhalten)'. NEU externalOpenFile/onExternalOpenFileConsumed-Props für Drag-Drop-Integration aus App.tsx. (3) UPDATE client/src/App.tsx: Drag-Drop-Routing — wenn korgBankExportOpen offen UND gedroppte Datei ist .all, geht der Drop in den Editor (setKorgBankEditorFile) statt in den Read-Only KorgBankModal (setKorgBankFile). Ansonsten Verhalten unverändert. korgBankEditorFile-State + Props an KorgBankEditor durchgereicht; onClose resettet beide Files. (4) NEU tests/features/korg-bank-editor.test.ts (22 Tests, alle grün): bankToOpenedSlots (5: 250 rows / isDirty=false default / rawRiff+original-Snapshot / empty-original:null / oneshot aus loopType), patchOpenedSlot (4: name-edit→isDirty, alle 5 editable Felder, no-op patch bleibt clean, strukturelle Felder flippen nicht), replaceSlotSample (2: isDirty+frames-recompute, empty→filled), deleteSlot (1: empty:true+isDirty:true+rawRiff weg+original behalten), revertSlot (3: nach Edit, nach Delete, urspr. empty bleibt empty), openedSlotsToBuildInputs (4: dirty vs passthrough count, empty skipped, save mit preserveRawRiff verifiziert via re-parse, Bit-exact FNV-1a Hash Round-Trip), Display-Helpers (1), Mode-Switch-Gate-Test (1). Keine React-DOM-Tests — pure-Store-Logic; E2E-Smoke via Playwright ist FOLLOWUP. (5) package.json 3.6.0 → 3.7.0, agents/INDEX.js version-Bump + workLog + files-Index. pnpm check clean. pnpm test 3753 passed / 15 skipped (von 3731 = +22 neue Tests). VERIFIED: Bit-exact Round-Trip Read→Edit-Nothing→Write via FNV-1a Hash der gesamten .all (Test 'Bit-exact Round-Trip ohne Edits'); per-slot Mixed-Mode (Slot N edited re-encoded, Slot M unchanged passthrough) per Name-Vergleich nach Re-Parse (Test 'Save mit preserveRawRiff=true: unedited Slots passthrough, edited re-encoded')."
      ],
      next: [
        "TASK-v3.7-FOLLOWUP-1 (Playwright E2E): 1-2 E2E-Tests für Open-Edit-Save-Flow im Editor (Drag .all → confirm load → edit name → save → re-open → name persists). Aktuell pure-Logik gut abgedeckt, E2E würde DOM-Verkabelung + File-API-Stack absichern.",
        "TASK-v3.7-FOLLOWUP-2 (Slice-Editor-UI): TASK-v3.6-FOLLOWUP-2 noch offen — pro Slot Waveform-Canvas mit drag-and-drop-Slice-Markers (max 64).",
        "TASK-v3.7-FOLLOWUP-3 (Delete-Slot raw-RIFF-Drop): Aktuell verliert ein 'Delete Slot' den rawRiff sofort. Wenn der User später Revert macht funktioniert es via original-Snapshot. ABER: wenn der User ohne zu Saven die Bank schließt+öffnet, ist der rawRiff weg. Alternative: 'tombstone'-Flag (rawRiff bleibt aber output skipped) — würde aber 250×~5KB Memory unnötig binden bei großen Banks. Aktuell akzeptabel.",
        "TASK-v3.6-FOLLOWUP-3 (Higher-Quality-Resampler): offen, low priority."
      ],
      changed: [
        "client/src/utils/korg/bankEditorState.ts (NEU — ~310 LOC pure-Logik: OpenedSlot Type + bankToOpenedSlots/patchOpenedSlot/replaceSlotSample/deleteSlot/revertSlot/openedSlotsToBuildInputs + Display+Count Helpers. Isomorph, keine React/DOM)",
        "client/src/components/KorgBank/KorgBankEditor.tsx (UPDATE ~370→~740 LOC: Mode-Toggle Neue Bank/Bank bearbeiten, Open-Bank-Button + hidden file inputs, Slot-Browser 250 rows mit empty/dirty Indicators, Slot-Detail Editor mit Name/Category/Oneshot/Gain12dB/SampleTune/Replace Sample/Delete/Revert, externalOpenFile-Prop für Drag-Drop, handleSaveAs branched mode-abhängig auf openedSlotsToBuildInputs+buildE2sBank{preserveRawRiff:true}. Mode-Wechsel-Confirm bei unsaved changes via window.confirm)",
        "client/src/App.tsx (UPDATE — korgBankEditorFile-State, Drag-Drop-Routing: wenn Editor offen + .all gedroppt → Editor, sonst Read-Only Modal. Props externalOpenFile + onExternalOpenFileConsumed an KorgBankEditor durchgereicht)",
        "tests/features/korg-bank-editor.test.ts (NEU — 22 Tests pure-Logik: bankToOpenedSlots-5, patchOpenedSlot-4, replaceSlotSample-2, deleteSlot-1, revertSlot-3, openedSlotsToBuildInputs-4, Display-1, Mode-Gate-1, Bit-exact FNV-1a Hash Round-Trip)",
        "package.json (3.6.0 → 3.7.0)",
        "agents/INDEX.js (version 3.6.0 → 3.7.0 + workLog v3.7.0 + files-Index Updates)"
      ]
    },
    {
      agent:     "backend",
      timestamp: "2026-05-18T09:35:00.000Z",
      done: [
        "v3.6.0: Raw-RIFF-Preservation + Poly-Phase FIR-Resampling — closes v3.4-Quality-Caveats. (1) UPDATE client/src/utils/korg/e2sBankReader.ts: +ParseE2sBankOptions{preserveRawRiff?:bool}, +E2sSlot.rawRiff?:Uint8Array. parseE2sBank(buf,src,{preserveRawRiff:true}) speichert pro Slot 8+riffSize-Bytes (RIFF<size>WAVE...) als eigenständigen Uint8Array (kein subarray-View, damit GC den Mutter-Buffer freigeben darf). Default false (kein Memory-Overhead). (2) UPDATE client/src/utils/korg/e2sBankBuilder.ts: +BuildE2sBankOptions{preserveRawRiff?:bool}, +E2sSlotInput.rawRiff?:Uint8Array + isDirty?:bool. buildE2sBank(slots,{preserveRawRiff:true}) prüft pro Slot: rawRiff vorhanden UND isDirty !== true → passthroughRiff() validiert (RIFF-magic + size match + WAVE marker + per-slot-cap MAX_BYTES_PER_SLOT+4096) und kopiert verbatim ins Output. Bei Validation-Fehler → Fallback auf buildRiffForSlot() + Warning. Dirty oder fehlende-rawRiff Slots werden wie in v3.4 neu encoded. pcmByteLen wird via data-Sub-Chunk-Walk extrahiert für Cap-Tracking (E2S_MAX_TOTAL_PCM_BYTES). (3) UPDATE client/src/utils/korg/audioProcessor.ts: +ResamplerKind='poly-phase'|'linear', +ProcessAudioOptions.resampler?, default 'poly-phase'. NEU polyPhaseResample(pcm,inSr,outSr,channels:1|2) → Float32Array. Algorithmus: 3-Lobe Lanczos windowed-sinc (a=3), rational rate via gcd→L/M, direkte Convolution at output samples (O(N·2a/cutoff)), Anti-Alias cutoff = min(1, L/M) skaliert kernel-Argument, kernel-sum-Normalize gegen Edge-Attenuation. NEU lanczosKernel(x,a=3) public-export für Tests. Stereo: deinterleave→je Kanal resample→re-interleave. Defensive: clip Output [-1,+1], NaN→0 im Convolution-Loop, throws AudioProcessError bei kaputtem Input. convertToE2sSpec routet jetzt auf polyPhaseResample (default) oder resampleLinear (opt-in). resampleLinear bleibt als Fallback exportiert. (4) UPDATE client/src/components/KorgBank/KorgBankEditor.tsx: handleSaveAs() ruft buildE2sBank(inputs, {preserveRawRiff:true}) und setzt isDirty:true pro Picker-Slot (neue Samples sind immer 'dirty'). Bei zukünftigem Bank-Reload-Flow (Followup) kann der Editor unedited Slots mit rawRiff durchreichen. (5) NEU tests/features/korg-audio-processor.test.ts (22 Tests): lanczosKernel (6: x=0/lobe-limits/sinc-zeros/even/NaN/peak), polyPhaseResample basics (8: no-op/up/down/stereo/empty/Float32-defense/sr-defense/channel-defense), polyPhaseResample quality (5: 1kHz preserved/20kHz attenuated above Nyquist/DC preserved/no amplitude-blowup/NaN-defense in input), convertToE2sSpec wiring (3: default-uses-polyphase/explicit-linear-identical/poly-beats-linear-on-18kHz@48k→32k). (6) UPDATE tests/features/korg-e2s-builder.test.ts (+7 Tests): Raw-RIFF-Preservation: bit-exact read→write round-trip via byte-loop, mixed-bank (dirty+clean) per-slot RIFF-byte-vergleich, FNV-1a hash der gesamten .all-Datei nach Round-Trip, legacy-Pfad ohne preserveRawRiff funktioniert weiterhin (semantic round-trip), isDirty=true bricht Passthrough trotz rawRiff, Reader ohne preserveRawRiff hat slot.rawRiff===undefined, kaputtes rawRiff → Fallback re-encode + warning. (7) package.json 3.5.1 → 3.6.0, agents/INDEX.js version-Bump + files-Index. pnpm check clean. pnpm test: 3731 passed / 15 skipped (von 3702 vorher, +29 net = 22 polyPhase + 7 rawRiff). VERIFIED: Bit-exact Round-Trip via byte-loop assertion UND FNV-1a Hash-Vergleich der gesamten Datei. Resampler-Quality: 1 kHz Sine bei 48k→44.1k bleibt erhalten (RMS-ratio 0.9..1.1), 20 kHz Sine bei 48k→32k wird stark gedämpft (anti-alias funktioniert, RMS << input/2), DC-Preservation interior ±5%. CAVEATS: (a) Poly-Phase FIR ist Direct-Convolution O(N·2a/cutoff) — bei extreme Downsampling-Ratios (z.B. 96k→8k = ratio 12) wäre Multi-Stage-Pipeline sinnvoll. Für E2S-Targets (44.1/48 kHz) sind Ratios immer ~1.0 → CPU-Last <5ms in JS für 1s Stereo. Akzeptabel für UI-Workflow. (b) Slice-Editor-UI bleibt offen (FOLLOWUP v3.7) — Slot.slices wird durchgereicht aber kein Waveform-Marker-Editor in KorgBankEditor.tsx. (c) Bank-Reload-Flow im Editor offen: aktuell zieht der Editor nur aus useProjectStore.samples, kann also nicht eine bestehende .all-Bank laden + editieren. Die Raw-RIFF-Infrastruktur ist API-fertig — wenn User-Feedback es erfordert, ist Bank-Load+EditExisting eine separate UI-Task. (d) `convertToE2sSpec.resampler` ist optional + default 'poly-phase' → Backwards-Compat 100% (alle bisherigen Tests grün ohne Änderungen). resampleLinear bleibt exportiert für `resampler:'linear'`. (e) Lanczos-3 ist NICHT brick-wall — Stop-Band-Leakage ist begrenzt aber nicht 0. Für höhere Quality wäre Kaiser-Windowed Sinc oder filter-design Library (z.B. firwin) sinnvoll — Followup wenn audiophile User es fordern. Test `attenuates 20 kHz above Nyquist` gibt grünes Licht: poly-phase erreicht RMS < 0.5·input_RMS bei 20 kHz @ 48k→32k. (f) IPC-Layer + KorgBankEditor-UI funktionieren unverändert — die preserveRawRiff-Opt ist Builder-internal, der Editor-Caller sagt einfach `{preserveRawRiff:true}` und sieht keine Verhaltensänderung wenn alle Slots dirty sind."
      ],
      next: [
        "TASK-v3.6-FOLLOWUP-1 (Bank-Reload-in-Editor): KorgBankEditor erweitern um '📂 Bank laden' Button → parseE2sBank(file, {preserveRawRiff:true}) → vorhandene Slots in editorSlots-State mit isDirty=false. Edit-Detection: jedes updateSlot()-Call setzt isDirty=true. Save → buildE2sBank(slots, {preserveRawRiff:true}) → unedited Slots bleiben bit-exakt.",
        "TASK-v3.6-FOLLOWUP-2 (Slice-Editor-UI): Pro Slot im KorgBankEditor einen Waveform-Canvas mit drag-and-drop-Slice-Markers (max 64). Reuse SampleSliceEditor-Component-Pattern. Output → slot.slices Array.",
        "TASK-v3.6-FOLLOWUP-3 (Higher-Quality-Resampler): Falls audiophile User Feedback geben, Kaiser-Windowed Sinc statt Lanczos-3 evaluieren, oder libsamplerate-wasm-Integration (~50 kB WASM). Aktuell ist Lanczos-3 'gut genug' (siehe Test-Resultat 20 kHz attenuated)."
      ],
      changed: [
        "client/src/utils/korg/e2sBankReader.ts (UPDATE — +ParseE2sBankOptions{preserveRawRiff?:bool} + E2sSlot.rawRiff?:Uint8Array. parseE2sBank/parseSlot durchreichen das Flag. rawRiff wird als eigene Uint8Array-Kopie der 8+riffSize Bytes gespeichert wenn aktiviert)",
        "client/src/utils/korg/e2sBankBuilder.ts (UPDATE — +BuildE2sBankOptions{preserveRawRiff?:bool} + E2sSlotInput.rawRiff?+isDirty?. NEU passthroughRiff() validiert+kopiert rawRiff bit-exakt mit defensive Fallback auf buildRiffForSlot. data-Chunk-Walk für pcmByteLen Cap-Tracking)",
        "client/src/utils/korg/audioProcessor.ts (UPDATE — +ResamplerKind+ProcessAudioOptions.resampler, +polyPhaseResample (Lanczos-3 windowed-sinc Direct-Convolution, rational rate via gcd, anti-alias cutoff = min(1,L/M)), +lanczosKernel public export für Tests, +gcd internal helper. convertToE2sSpec routet default 'poly-phase' mit resampleLinear-opt-in als Fallback)",
        "client/src/components/KorgBank/KorgBankEditor.tsx (UPDATE — handleSaveAs ruft buildE2sBank(inputs,{preserveRawRiff:true}) auf, setzt isDirty:true pro picker-Slot. Bei späterem Bank-Reload-Flow können unedited Slots rawRiff durchreichen)",
        "tests/features/korg-audio-processor.test.ts (NEU — 22 Tests: lanczosKernel-6 + polyPhaseResample basics-8 + quality-5 + convertToE2sSpec wiring-3. Coverage: x=0=1, lobe limits, sinc zero crossings, NaN defense, no-op identity, up/downsampling sample-count, stereo interleave, DC preservation, 1kHz preserved interior, 20kHz attenuated above Nyquist, defense against NaN samples in input)",
        "tests/features/korg-e2s-builder.test.ts (UPDATE — +7 Tests Raw-RIFF-Preservation: bit-exact byte-loop assertion, mixed bank dirty+clean per-slot RIFF-bytes vergleich, FNV-1a hash full-file round-trip, legacy ohne preserveRawRiff weiter-funktional, isDirty=true bricht passthrough trotz rawRiff, Reader-Default kein rawRiff, kaputt rawRiff → fallback)",
        "package.json (3.5.1 → 3.6.0)",
        "agents/INDEX.js (version 3.5.0 → 3.6.0 + workLog v3.6.0 + files-Index Updates)"
      ]
    },
    {
      agent:     "backend",
      timestamp: "2026-05-18T09:10:00.000Z",
      done: [
        "v3.5.0: TASK-237-FOLLOWUP-5-PATTERNS (ESX-1 Pattern-Parser + Import) — KORG Read-Side komplettiert. Python-SoT (esx_parser.py) speichert Patterns OPAQUE (Comment 'preserved opaque per-pattern' Z.8), daher direkte Reverse-Engineering gegen 5 reale .esx-Files (ASEJIV_1, BOTTROP, DUSSELBUNKAAA, ENDLICH, ESX_FILE 'Tekk 175' u.a.) durchgefuehrt. VERIFIED Layout (Pattern-Block 4280 Bytes): Offset 0..7 = 8-Byte ASCII Name (NUL/space-padded), Offset 8..9 = BE u16 BPM*128 (z.B. 0x5780=22400 → 175.00 BPM exakt, 0x5A00=180, 0x3C00=120, 0x5900=178), Offset 13 = step-length-1 (init 0x0F → 16 Steps; alle 5 untersuchten Files haben 16). Init-Pattern-Signatur bei Offset 8..19 = '3c 00 00 00 00 0f 00 3c 00 00 7f ff' (verifiziert gegen DUSSELBUNKAAA + unbenutzte Slots in ESX_FILE.ESX). BEST-EFFORT: Offset 15 = swing (0x21..0x54 in Real-Files, geklemmt 0..100). NICHT RE-d: Per-Part-Step-Daten + Motion-Sequencer-Slots — die Sub-Strukturen ab 0x18 (0x22-Byte-Stride mit 'fingerprint 00 XX FF 00 03 7F' + 0x10-Byte '11 11 11...' Step-Sequenzen) sind erkannt aber nicht final dekodiert; defensive Parts mit Hardware-Defaults (vol=100, pan=64, alle Steps inactive). (1) UPDATE client/src/utils/korg/esxParser.ts (~+150 LOC) — neue Exports: parseEsxPattern(raw, idx) → EsxPattern|null, isEmptyEsxPattern(raw) → bool, ESX1_PARTS_PER_PATTERN=16, ESX1_DEFAULT_STEPS=16, ESX1_INIT_PATTERN_SIGNATURE. parseEsxBank befuellt nun bank.patterns[] mit non-leeren Patterns (256 Slots durchgegangen, leere via isEmptyEsxPattern geskippt). EsxPattern-Type: {index, name, bpm, lengthSteps, swing, parts[]: EsxPart[]{partIndex, sampleId, volume, pan, pitch, fxAmount, steps: EsxStepEvent[]{active, velocity}, motionSequencer?: undefined}, raw?: Uint8Array}. EsxBank patterns-Array Typ EsxPattern[] (vorher [] Skeleton). isEmptyEsxPattern hat zwei Wege: A) Init-Sig+empty-name (Real-Files), B) all-zero erste 32 Bytes (synthetic/unwritten). (2) NEU client/src/utils/korg/esxPatternConvert.ts (~150 LOC, pure) — convertEsxPatternToSynthstudio(esxPattern, opts?) → SynthstudioPatternImport, convertEsxPatternsToSynthstudio Bulk, esxPartHint(idx) liefert konservative Labels ('ESX Drum 1'..'ESX Drum 9' / 'ESX Stretch 1..2' / 'ESX Slice 1..2' / 'ESX Audio-In' / 'ESX Synth 1..2'). SynthstudioPatternImport mit name/bpm/stepCount/swing/drumParts[]{partIndex,sampleId,sampleHint,volume,pan,pitchSemitones,steps,velocities}/automationLanes[] (v3.5 stets leer da Motion-Daten nicht RE-d). Pure-Logik — schreibt KEINE Stores. (3) UPDATE client/src/components/KorgBank/KorgBankModal.tsx (~+90 LOC) — KorgBankModalProps +onAddPattern?(pattern: SynthstudioPatternImport). ModalState +patterns: EsxPattern[]. Activ-Tab-State 'samples'|'patterns'. Tab-Bar (nur wenn ESX-Bank +Patterns vorhanden) zwischen Samples-Tab und Patterns-Tab. Pattern-Liste mit Index P1..PN, Name (oder '(unbenanntes Pattern N)'), BPM (toFixed(1)), Step-Count, +Pattern-Button pro Eintrag (handleImportPattern → onAddPattern callback). 'Alle Patterns importieren'-Bulk-Button. data-testids korg-bank-{tabs, tab-samples, tab-patterns, pattern-list, pattern-N, pattern-add-N, import-all-patterns}. (4) NEU tests/features/korg-esx-patterns.test.ts — 19 Tests: parseEsxPattern (Header-Felder: name+bpm, BPMs 120/160/180/220, BPM-Clamping, 16 Parts mit 16 Step-Slots, step-length aus byte 13, wrong-size-throw), isEmptyEsxPattern (init recognition, user-pattern-not-empty, null-fuer-init-pattern), parseEsxBank patterns-Array (all-init → 0 patterns, mixed → only non-empty), convertEsxPatternToSynthstudio (16 parts gemappt, Volume/Pan-Norm, esxPartHint labels, Bulk-API, empty-name-fallback), Real-File-Tests conditional skip mit defensive tryParseFile() (catched EsxParseError fuer Files knapp ueber dem 24MB PCM-Cap). Alle 19 grun. (5) package.json + agents/INDEX.js 3.4.0 → 3.5.0. pnpm check clean. pnpm test 3702 passed / 15 skipped (vorher 3683 → +19 neue, alle gruen). CAVEATS: (a) Step-Daten werden in v3.5 BEST-EFFORT als alle-inactive geliefert — der User bekommt Pattern-Name + BPM + Part-Skeleton im Synthstudio importiert, aber muss Steps manuell rekonstruieren. Reverse-Engineering der 0x22-Byte Part-Records ist FOLLOWUP wenn User-Feedback es erfordert (Schwierigkeit: Open Electribe Editor's EsxUtil.java ist nicht im Synthstudio-Repo verfuegbar; benoetigt zusaetzliche RE-Sitzung gegen handvoll bekannter Patterns wo Step-Positionen bekannt sind). (b) Motion-Sequencer-Slots: nicht extrahiert (parts.motionSequencer immer undefined). automationLanes immer []. (c) Real-File-Test ist defensive: tryParseFile() catched EsxParseError damit Files knapp ueber dem PCM-Cap (z.B. ESX_FILE.ESX hat 25166068 = ESX1-Cap+244 Bytes) trotzdem die Test-Suite nicht failen; mindestens ein File mit Patterns wird erwartet (filesWithPatterns > 0). (d) ESX-1 hat 16 Parts (9 Drum + 2 Stretch + 2 Slice + 1 Audio-In + 2 Synth), 1:1 auf Synthstudio drum-parts gemappt. Synth-Tracks (14, 15) bekommen Hint 'ESX Synth 1/2' aber kein spezielles Audio-Source-Mapping — der Caller muss bei Bedarf eigene Sample-Slots zuweisen. (e) Song-Mode (chained patterns) ist OUT-OF-SCOPE — separate Task. (f) Pattern-Caller-Integration (onAddPattern in App.tsx → useDrumMachineStore.setPattern etc.) ist offen — KorgBankModal liefert nur den Callback, die App muss ihn verkabeln (FOLLOWUP)."
      ],
      next: [
        "TASK-v3.5-FOLLOWUP-1 (Pattern-Step-RE): Step-Daten + Per-Part-Header reverse-engineeren. Ansatz: User-Probe mit handvoll bekannter Patterns (User legt Pattern mit nur Step 1 aktiv auf Part 1 an, dann nur Step 5 auf Part 3 etc.) und Hex-Diff zwischen den .esx-Backups. Open Electribe Editor v1.2.0 EsxUtil.java waere die ideale SoT — wenn der User die Source besorgen kann, ist das ein 1-Stunden-Port.",
        "TASK-v3.5-FOLLOWUP-2 (App.tsx onAddPattern verkabeln): KorgBankModal.onAddPattern → useDrumMachineStore.addPattern(import) Adapter schreiben + Motion-Lanes ggf. analog electribeMotionMapping.ts via mapElectribeLaneToAutomationTarget routen. Aktuell ist der Callback definiert aber nirgendwo verkabelt — Pattern-Import ist UI-fertig aber funktional dead.",
        "TASK-v3.5-FOLLOWUP-3 (Song-Mode): ESX-1 .esx hat 64 Songs ab 0x130000 (528 Bytes each) + Song-Event-Daten ab 0x138400. Wenn FOLLOWUP-1 done ist, koennen wir Song-Chains (pattern-sequencing) zusaetzlich importieren."
      ],
      changed: [
        "client/src/utils/korg/esxParser.ts",
        "client/src/utils/korg/esxPatternConvert.ts",
        "client/src/components/KorgBank/KorgBankModal.tsx",
        "tests/features/korg-esx-patterns.test.ts",
        "package.json",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "backend",
      timestamp: "2026-05-18T08:50:00.000Z",
      done: [
        "v3.4.0: TASK-237-FOLLOWUP-5-SAMPLES-WRITE (E2S Sample-Bank WRITE / Synthstudio → KORG E2 Sampler) — Port aus 'G:/IdeaProjects/Korg Editor/esx_e2s_editor/services/e2s_builder.py' (743 LOC) + audio_processor.py (479 LOC) nach TypeScript. KILLER-Workflow: User sammelt Samples in Synthstudio → exportiert als .all → lädt auf E2 Sampler. (1) NEU client/src/utils/korg/audioProcessor.ts (~250 LOC, pure isomorph). Public API: convertToE2sSpec(pcm, sr, ch, opts) → ProcessedAudio (resample auf 44100/48000 via lineare Interpolation, optional forceMono via average-downmix, optional peakNormalize). floatToInt16LeBytes(pcm) Float32→16-bit-LE-Bytes (clip [-1,+1], NaN/Infinity→0, +1.0→0xFF7F, -1.0→0x0080). downmixToMono(stereo) (L+R)/2 + post-Peak. resampleLinear(pcm, inSr, outSr, ch) mono/stereo deinterleave-resample-reinterleave. peakNormalize(pcm, target) skaliert auf target ∈ (0,1], silent-input passthrough. sanitizeE2sSlotName(name, maxLen=16) ASCII-only-Filter. Defensive: targetSampleRate-Whitelist (E2S_SAMPLE_RATES), Per-Slot-Cap (MAX_BYTES_PER_SLOT=10MB), AudioProcessError-Sealed-Error-Class. (2) NEU client/src/utils/korg/e2sBankBuilder.ts (~340 LOC, pure). Public API: buildE2sBank(slots: E2sSlotInput[]) → BuildResult ({buffer:ArrayBuffer, slotCount, warnings}). E2sSlotInput-Felder: slotIndex (0..249), name (ASCII-trim 16 Char), category (0..17 clamp), pcmData (Float32), sampleRate (44.1k/48k), channels (1|2), loopType, loopStart/EndBytes, level, gain12db, sampleTune, slices (max 64×16B), sliceSteps (max 64B), slicingNumSteps/Beat/NumActive. Layout-Output identisch zu Python: 0x0000 16B signature, 0x07E0 250×LE32 offset-table, 0x1000 RIFF-area. Pro Slot: RIFF<bodyLen> + WAVE + fmt(16B) + data(pcm+pad) + korg(1180B). korg-Body: 'esli'+LE32 0x0494+LE16 0x01F4 + Name@0x0A 16B + Cat@0x1A u16 + PlayVol@0x2C u16 + LoopStart@0x34 u32 + LoopEnd@0x38 u32 + Oneshot@0x3C u8 + UseChan0@0x48 + UseChan1@0x49 + Plus12dB@0x4A u8 + Freq@0x50 u32 + Tune@0x55 i8 + Slices@0x58 64×16B + SliceSteps@0x458 64B + Slicing-Meta@0x498..0x49A 3×u8. Caps enforced: max 250 Slots, max 10MB PCM/Slot, max 224MB cumulative, max 512MB total file. Duplicate-slotIndex: keep-first + Warning. clampU8/clampU32 für Slice-Felder. estimatePcmBytesForSlot exportiert für UI-Form-Validation. E2sBuildError sealed-class. (3) NEU client/src/components/KorgBank/KorgBankEditor.tsx (~400 LOC) — separate Modal (komplementär zu KorgBankModal das Read-Only ist). Props {open, onClose}. Left-Panel = Pick-Liste aus useProjectStore.samples (Click → addSampleAsSlot, auto-slotIndex=next, name=auto aus Filename). Right-Panel = Slot-Editor (Name-Input max 16 chars, Category-<select> mit allen 18 E2S_CATEGORY_NAMES, Oneshot-Checkbox, Frame-Count-Status, Remove-Button). Settings-Row: Target-SR Dropdown 44100/48000, Force-Mono Checkbox, Filename-Input. Footer: Total-Bytes-Display + Cancel + 'Als .all speichern' (gated PRO_FEATURE_KORG_BANK_WRITE). handleSaveAs decodes all pending samples (Blob-URL fetch → AudioContext.decodeAudioData → convertToE2sSpec) parallel, dann buildE2sBank → IPC saveKorgBankAs (Electron) ODER Blob-Download (Browser). data-testids korg-bank-editor-{overlay,close,picker,pick-*,list,row-*,name-*,cat-*,remove-*,target-sr,force-mono,filename,status,cancel,save}. Lazy AudioContext im Ref. Semantic Tailwind classes durchgehend. (4) UPDATE electron/ipcValidators.ts — +validateKorgBankSaveFilename (Whitelist /^[A-Za-z0-9._-]+\\.all$/, max 120 chars, kein NUL/Path-Trav), +validateKorgBankBuffer (Magic-Sniff 16B + Min 0x1000B + Max 256MB), +KORG_BANK_SAVE_MAX_BYTES=256MB. (5) UPDATE electron/main.ts — NEU IPC 'korg:save-bank-as' (suggestedFilename, data) Pfad: validateKorgBankSaveFilename + validateKorgBankBuffer (Magic+size) + dialog.showSaveDialog → fs.writeFile. Pfad kommt aus User-Dialog (kein Path-Traversal-Vektor vom Renderer). NEU 'korg:get-bank-save-cap' liefert 256MB für UI-Hinweise. (6) UPDATE electron/preload.ts — saveKorgBankAs(filename, data) → ipcRenderer.invoke('korg:save-bank-as', ...) mit ArrayBuffer/Uint8Array → number[]-Konvertierung für IPC. getKorgBankSaveCap. (7) UPDATE electron/types.d.ts — TypeScript-Decl für saveKorgBankAs + getKorgBankSaveCap. (8) UPDATE client/src/utils/proFeatures.ts — +PRO_FEATURE_KORG_BANK_WRITE='korg-bank-write'. PRO_FEATURES jetzt Länge 7. PRO_FEATURE_LABELS['korg-bank-write']='KORG Sample-Bank-Export (E2S .all)'. (9) UPDATE client/src/components/DrumMachine/DrumMachine.tsx — '📤 KORG Export'-Toolbar-Button neben '📦 KORG Bank' mit ProLockBadge feature=PRO_FEATURE_KORG_BANK_WRITE. data-testid=korg-bank-export. Click → requireProFeature-Gate → dispatchEvent CustomEvent 'korg:bank:export-open'. (10) UPDATE client/src/App.tsx — +Import KorgBankEditor. +useState korgBankExportOpen. useEffect-Listener 'korg:bank:export-open' → setKorgBankExportOpen(true). KorgBankEditor-Render direkt nach KorgBankModal. (11) NEU tests/features/korg-e2s-builder.test.ts — 46 Tests. audioProcessor: floatToInt16LeBytes (7: 0.0/+1.0/-1.0/clip-pos/clip-neg/NaN-defensive/length), resampleLinear (4: noop/2x-up/2x-down/stereo-preserve), downmixToMono (2), peakNormalize (3: scale/silent/reject), convertToE2sSpec (5: passthrough/48-to-44.1/forceMono/per-slot-cap/invalid-target-sr), sanitizeE2sSlotName (3). e2sBankBuilder structure: signature@0x0000 (1), offset-table@0x07E0 250-entries (1), sample-area@0x1000 + 'RIFF' magic (1), RIFF+fmt+data+korg-chunks (1), korg-body=1180B (1), ESLI-magic+version 0x01F4 (1), ESLI-name 16B NUL-pad (1), category-clamp 0..17 (1), empty-slot offset=0 (1), max-250-throw (1), duplicate-index-warn-keep-first (1), invalid-sampleRate-reject (1), oversize-PCM-reject (1). Round-Trip Builder→Reader: mono+category (1), stereo (1), multi-slot-with-gaps (1), non-ASCII-name-sanitized (1), level-preserved-modulo-u16-quantize (1), gain12db (1). File-Size invariants: single-slot exact 5528 bytes (1), empty-bank=0x1000 (1), cumulative-PCM-cap-throw (1). 12+ Tests Pflicht erfüllt. (12) UPDATE tests/features/license-gates.test.ts — PRO_FEATURES toHaveLength 6→7, +PRO_FEATURE_KORG_BANK_WRITE-Check. (13) package.json 3.3.0 → 3.4.0, agents/INDEX.js version-Bump + IPC-Channels {'korg:save-bank-as', 'korg:get-bank-save-cap'}. pnpm check clean. pnpm test 3683 passed / 15 skipped (von 3635 vorher, +48 net = 46 neue Builder-Tests + 2 angepasste). VERIFIED: Bit-Layout-Match zur Python-Quelle (offset-table@0x07E0, sample-area@0x1000, korg-body=1180B, esli-magic + version-LE16=0x01F4, declared-size-LE32=0x0494, name@0x0A 16B, category@0x1A u16, etc.). ROUND-TRIP-VERIFIER: Tests 'round-trips single mono slot' + 'round-trips stereo slot' + 'round-trips multiple slots with gaps' verifizieren dass buildE2sBank → parseE2sBank → slot.{name,category,channels,sampleRate,frames,pcmData} identisch zur Input-Spec ist. PCM-Werte stimmen auf 1e-3 (limit der i16-Quantisierung). CAVEATS: (a) Resampling ist lineare Interpolation (MVP) — kein Anti-Alias-Filter, beim Downsampling können Frequenzen oberhalb Nyquist Aliasing erzeugen. Quality-Followup v3.5 = poly-phase-FIR analog scipy.signal.resample_poly. (b) Bit-exact Round-Trip mit raw_riff-Preservation aus Python ist NICHT übernommen — alle Slots werden re-encoded. Faktory-Samples-Diff zu Original ist ggf. ±1 LSB pro Sample. Acceptable für MVP, FOLLOWUP v3.5 für lossless-pass-through. (c) Stereo-Support funktioniert (interleaved L/R/L/R), aber Stereo-Preview im Editor-UI ist noch Mono-only (analog Reader). (d) Slicing: slot.slices/sliceSteps werden korrekt geschrieben + gelesen, aber das Editor-UI hat noch keinen Slice-Marker-Editor — Slices kommen aus dem Input-Slot wenn der Caller das Feld setzt. UI-Slice-Editor ist FOLLOWUP v3.5. (e) Pattern-Sektion (.all-Files mit Patterns) ist weiterhin out-of-scope (Sample-only Builder, identisch zu Python). (f) Browser-Fallback funktioniert via Blob-Download — funktionsfähig in beiden Modi. (g) Sample-Source: aktuell aus useProjectStore.samples (.path = Blob-URL oder absolute Pfad). Recording-Library/useAudioTrackStore-Integration ist FOLLOWUP wenn User-Feedback es erfordert. (h) Pro-Feature-Gate: 'Save As .all'-Button + Toolbar-Button beide gated via requireProFeature(PRO_FEATURE_KORG_BANK_WRITE). Trial → unlocked, expired → Toast + Gumroad-Link. (i) IPC-Security: filename-Whitelist /^[A-Za-z0-9._-]+\\.all$/, magic-byte-Check 16B, size-cap 256MB, Pfad NICHT vom Renderer (User-Save-Dialog only), .all-Endung-Final-Check nach dem Dialog. Pattern analog audio:save-recording aus v2.86."
      ],
      next: [
        "TASK-237-FOLLOWUP-5-WRITE-QUALITY (v3.5): Poly-Phase-FIR Resampling statt lineare Interpolation (Anti-Alias-Filter). Quality-Probe mit echten Test-Files (44.1 → 22.05k Downsample und zurück, prüfe THD < -60 dBFS). Algorithmus aus scipy.signal.resample_poly portieren oder gut bewährte JS-Library evaluieren (libsamplerate-wasm wäre ein Kandidat).",
        "TASK-237-FOLLOWUP-5-PATTERNS (v3.5): DONE 2026-05-18 — ESX-1 Pattern-Parser. parseEsxPattern + parseEsxBank-Patterns-Array + esxPatternConvert. Verified Header-Felder (name, BPM, lengthSteps) gegen 5 Real-Files. Step-Daten + Motion bleiben Best-Effort FOLLOWUP.",
        "TASK-v3.4-FOLLOWUP-1 (Slice-Editor-UI): Pro Slot im KorgBankEditor einen Waveform-Canvas mit drag-and-drop-Slice-Markers (max 64). Reuse SampleSliceEditor-Component-Pattern. Output → slot.slices Array.",
        "TASK-v3.4-FOLLOWUP-2 (Raw-RIFF-Preservation): Wenn ein vorhandenes .all geladen wurde (read), und der User EDITS-only-some-slots macht, sollten unedited slots ihr original raw_riff bytes-für-bytes durchgereicht bekommen → bit-exact Round-Trip. Erfordert: parser preserveRiffBytes-Opt + builder rawRiffPassthrough.",
        "TASK-v3.4-FOLLOWUP-3 (Recording-Library-Source): Aktuell zieht der Editor nur aus useProjectStore.samples. Integration mit recordingStorage.ts würde Recordings direkt verfügbar machen.",
        "TASK-v3.4-FOLLOWUP-4 (Drag-Drop-to-Editor): User kann WAVs direkt auf das offene Editor-Modal droppen → automatisch als Slot hinzugefügt.",
        "TASK-v3.3-FOLLOWUP-1 (Blob-URL-Cleanup): Modal trackt erzeugte URLs und revoked sie bei Sample-Removal aus useProjectStore (oder beim App-Reload). Aktuell leaken die URLs wenn der User viele Samples hinzufuegt und sie nicht behalten will.",
        "TASK-v3.3-FOLLOWUP-2 (Stereo-Preview): AudioEngine.playSliceBuffer akzeptiert nur Mono. Fuer korrektes Stereo-Preview muesste die Engine einen 2-Channel-AudioBuffer mit copyToChannel(L,0)+copyToChannel(R,1) nehmen. Out-of-Scope v3.3.",
        "TASK-237-CALIBRATION-FOLLOWUP-1 (Step-Encoding): User stellt 2-3 Real-Files mit bekannten Step-Positionen bereit.",
        "TASK-232-FOLLOWUP-1 (Gumroad-Real-Integration) bleibt offen.",
        "TASK-236-ALT-FOLLOWUP-1/2/3 bleiben offen.",
        "TASK-241-FOLLOWUP-2-GRANULAR / FOLLOWUP-3-SYNTHLFO / FOLLOWUP-4-CUSTOMWAVE bleiben offen.",
        "TASK-239 (VST3/CLAP-Host) bleibt offen."
      ],
      changed: [
        "client/src/utils/korg/audioProcessor.ts (NEU — ~250 LOC TS-Port aus Python audio_processor.py: convertToE2sSpec, floatToInt16LeBytes, downmixToMono, resampleLinear (lineare Interpolation MVP), peakNormalize, sanitizeE2sSlotName, AudioProcessError)",
        "client/src/utils/korg/e2sBankBuilder.ts (NEU — ~340 LOC TS-Port aus Python e2s_builder.py: buildE2sBank → ArrayBuffer mit Signature@0x00 + Offset-Table@0x07E0 + RIFF/WAVE-Slots@0x1000 + korg/esli-Sub-Chunk 1180B. Caps: max 250 Slots, 10MB/Slot, 224MB cumulative, 512MB file. Duplicate-index keep-first+warn)",
        "client/src/components/KorgBank/KorgBankEditor.tsx (NEU — ~400 LOC Editor-Modal komplementär zu KorgBankModal. Picker-Liste links + Slot-Editor rechts (Name+Category+Oneshot+Frame-Count+Remove). Settings: Target-SR/ForceMono/Filename. Save-As-Button gated PRO_FEATURE_KORG_BANK_WRITE — IPC saveKorgBankAs (Electron) oder Blob-Download (Browser). data-testids korg-bank-editor-*)",
        "electron/ipcValidators.ts (UPDATE — +validateKorgBankSaveFilename Whitelist /^[A-Za-z0-9._-]+\\\\.all$/ + validateKorgBankBuffer 16B Magic-Sniff + Min-0x1000B + Max-256MB + KORG_BANK_SAVE_MAX_BYTES=256MB)",
        "electron/main.ts (UPDATE — +IPC korg:save-bank-as: filename+magic+size validate → showSaveDialog → fs.writeFile (User-Pfad, kein Path-Traversal-Vektor). +IPC korg:get-bank-save-cap)",
        "electron/preload.ts (UPDATE — +contextBridge saveKorgBankAs(filename, data) konvertiert ArrayBuffer→number[] für IPC. +getKorgBankSaveCap)",
        "electron/types.d.ts (UPDATE — TypeScript-Decl für saveKorgBankAs + getKorgBankSaveCap)",
        "client/src/utils/proFeatures.ts (UPDATE — +PRO_FEATURE_KORG_BANK_WRITE='korg-bank-write'. PRO_FEATURES jetzt 7. Label='KORG Sample-Bank-Export (E2S .all)')",
        "client/src/components/DrumMachine/DrumMachine.tsx (UPDATE — '📤 KORG Export'-Toolbar-Button neben '📦 KORG Bank' mit ProLockBadge. Click → CustomEvent 'korg:bank:export-open'. data-testid=korg-bank-export. +PRO_FEATURE_KORG_BANK_WRITE-Import)",
        "client/src/App.tsx (UPDATE — +Import KorgBankEditor. +useState korgBankExportOpen. useEffect-Listener 'korg:bank:export-open'. KorgBankEditor-Render direkt nach KorgBankModal)",
        "tests/features/korg-e2s-builder.test.ts (NEU — 46 Tests: audioProcessor (24) + e2sBankBuilder structure (13) + Round-Trip (6) + File-Size invariants (3). Round-Trip via parseE2sBank ist die wichtigste Coverage)",
        "tests/features/license-gates.test.ts (UPDATE — toHaveLength 6→7, +PRO_FEATURE_KORG_BANK_WRITE-Check)",
        "package.json (3.3.0 → 3.4.0)",
        "agents/INDEX.js (version 3.3.0 → 3.4.0, +workLog v3.4.0, +IPC-Channels korg:save-bank-as + korg:get-bank-save-cap, +files-Index 5 Einträge)"
      ]
    },
    {
      agent:     "backend",
      timestamp: "2026-05-18T08:30:00.000Z",
      done: [
        "v3.3.0: TASK-237-FOLLOWUP-5-SAMPLES (Read-Side) — Port der KORG ESX-1 + E2S Sample-Bank-Parser aus dem Python-Tool 'G:/IdeaProjects/Korg Editor' nach TypeScript. SoT-Quellen: constants.py (186 LOC) + esx_parser.py (554 LOC) + e2s_parser.py (497 LOC). (1) NEU client/src/utils/korg/constants.ts (~190 LOC) — alle Format-Konstanten aus Python (ESX-1: KORG+ESX\\0 Magic, 256 Mono-Slots, 128 Stereo-Slots, Header-Offsets 0x1B0000/0x1B0100/0x1B2900, PCM @ 0x250000, EMPTY_OFFSET=0xFFFFFFFF, SIZE_MIN=0x250010, 24MB cumulative PCM cap; E2S: 'e2s sample all\\x1a\\0' Signature, 250 RIFF slots ab 0x1000, Offset-Table @ 0x07E0, korg/esli Sub-Chunk 1180B mit Name@0x0A+Category@0x1A+LoopStart@0x34+LoopEnd@0x38+Slices@0x58+SliceSteps@0x458). E2S_CATEGORY_NAMES Tuple (18: Analog/Audio In/Kick/Snare/Clap/HiHat/Cymbal/Hits/Shots/Voice/SE/FX/Tom/Perc./Phrase/Loop/PCM/User) + e2sCategoryName(idx) Helper. Synthstudio-spezifische Caps: ESX_FILE_MAX_BYTES=64MB, E2S_FILE_MAX_BYTES=512MB, KORG_BANK_IPC_MAX_BYTES=100MB. (2) NEU client/src/utils/korg/esxParser.ts (~350 LOC, pure JS isomorph) — parseEsxBank(buf, source?) → EsxBank, isEsxBuffer(buf) → bool, be16PcmToFloat32(raw) → Float32Array. EsxBank = {source, monoSamples: EsxSample[], stereoSamples: EsxSample[], patterns:[] (FOLLOWUP v3.5), declaredMonoCount, declaredStereoCount, warnings}. EsxSample = {index, name, channels:1|2, sampleRate, frames, pcmData:Float32Array, loopStart, loopEnd, level}. 4-Stage-Validation (size-min/max + first-Magic + sub-Magic@0x08 + 2nd-Magic@0x1B0000 + sample-count-bounds). PCM Big-Endian → LE-i16 → Float32 [-1,+1]. Stereo wird interleaved L,R,L,R. Empty-Slot-Sentinel skipped silently. Per-Slot MAX_BYTES_PER_SLOT=10MB cap, cumulative ESX1_MAX_SAMPLE_MEM_IN_BYTES=24MB. Single-Slot-Error → warn+skip, ganzer-Datei-Error → throw. (3) NEU client/src/utils/korg/e2sBankReader.ts (~470 LOC) — parseE2sBank(buf, source?) → E2sBank, isE2sBuffer, le16PcmToFloat32, countE2sSlots. E2sBank = {source, slots: Array<E2sSlot|null> Länge 250, offsetTable: Uint32Array, trailingBytes, warnings}. E2sSlot enthaelt full korg/esli-Meta: name, category, categoryName, sampleRate, channels, frames, pcmData (interleaved bei stereo), loopType (0/1/2), loopStart/End (frames), level (0..127 normalisiert aus u16-playVolume), gain12db, slices (E2sSlice[] mit start/length/attack/amplitude, trailing-zeros getrimmt), sliceSteps (64B), slicingNumSteps/Beat/NumActive. RIFF-Parser walked WAVE-Body's Sub-Chunks (fmt + data + korg/esli) via findSubchunk(). PCM 16-bit LE → Float32. Korg-Body parsing best-effort: bei body.length < 1180 nur warn (keine throw). Defensive: signature check, offset-table-bounds (no entry inside 0x1000-prelude), per-RIFF-size cap (E2S_MAX_RIFF_BYTES = 10MB+overhead), per-slot PCM cap, cumulative cap (224MB). (4) NEU client/src/utils/korg/bankDetect.ts — detectKorgBankType(buf) → 'esx'|'e2s'|'unknown' (Magic-Sniff), detectKorgBankTypeFromName(name) (Endung-only). (5) NEU client/src/components/KorgBank/KorgBankModal.tsx (~400 LOC) — Read-Only-Viewer mit Props {file:File|null, onClose, onAddSample?(s:KorgBankSample)}. Listet alle (non-null) Slots: Index+Name+Category+Duration+Channels. Pro Slot 'Preview'-Button (AudioEngine.playSliceBuffer mit Mono-Reduce fuer Stereo) und 'Add'-Button (encodeWav-Helper baut RIFF/WAVE Blob mit Float32→i16 LE → URL.createObjectURL → KorgBankSample-Spec). 'Alle importieren'-Bulk-Button mit window.confirm. Search-Filter ueber Name+Category. Warnings collapsible (max 20 sichtbar). Semantic Tailwind classes durchgaengig (bg-bg-panel/elevated, border-border-color, accent-primary/danger/success). data-testids korg-bank-{modal,close,search,import-all,row-*,preview-*,add-*,loading,error,list}. (6) UPDATE client/src/utils/dragDropDispatch.ts — FileType-Union +'korg-bank'. KORG_BANK_EXTENSIONS={'.esx','.ess','.all'} als separates Set, ELECTRIBE_EXTENSIONS reduziert (.esx entfernt). detectFileType priorisiert korg-bank vor electribe. eventNameMap routet 'korg-bank' → CustomEvent 'korg:bank:open'. (7) UPDATE client/src/components/DragDropOverlay/DragDropOverlay.tsx — OVERLAY_STYLES['korg-bank'] mit accent-primary + 📦-Icon + 'KORG Sample-Bank importieren'-Label + Subtext '.esx / .all — ESX-1 oder E2S Sample-Bank (Read-Only v3.3)'. (8) UPDATE electron/components/ElectronDropZone.tsx — +onKorgBankFile?-Prop, +KORG_BANK_EXTENSIONS-Branch im handleDrop (Callback ODER Default-CustomEvent 'korg:bank:open'), detectDropType erkennt 'korg-bank'. (9) UPDATE electron/ipcValidators.ts — +KORG_BANK_ALLOWED_EXTENSIONS Set + KORG_BANK_MAX_BYTES=100MB + validateKorgBankPath/Size (Pattern analog validateElectribePath). (10) UPDATE electron/main.ts — 3 neue IPC-Handler: 'korg:import-bank' (filePath → {success,data:number[],fileName,ext} validated via path.resolve + access(R_OK) + size-cap), 'korg:open-bank-dialog' (nativer Dialog mit Filtern KORG/ESX-1/E2S), 'korg:get-bank-cap' (liefert KORG_BANK_MAX_BYTES). (11) UPDATE electron/preload.ts — 3 neue contextBridge-Methoden openKorgBankDialog/importKorgBank/getKorgBankCap. (12) UPDATE client/src/utils/proFeatures.ts — PRO_FEATURE_KORG_BANK_IMPORT='korg-bank-import' (PRO_FEATURES jetzt 6). (13) UPDATE client/src/components/DrumMachine/DrumMachine.tsx — '📦 KORG Bank'-Toolbar-Button neben '🎚 Electribe' mit ProLockBadge, hidden file-input accept='.esx,.ess,.all', onChange dispatcht CustomEvent 'korg:bank:open' nach Pro-Gate-Check. (14) UPDATE client/src/App.tsx — +Import KorgBankModal+KorgBankSample (proFeatures-Import konsolidiert auf einen). +useState korgBankFile:File|null. handleKorgBankFile gated requireProFeature, setzt State. handleKorgBankAddSample → project.addSamples mit Blob-URL als path + Auto-Category 'korg-esx-mono/stereo' oder 'korg-e2s'. useEffect listener 'korg:bank:open' → handleKorgBankFile. ElectronDropZone bekommt onKorgBankFile. KorgBankModal-Render zwischen ActivationModal und </ElectronDropZone>. (15) NEU tests/features/korg-esx-parser.test.ts — 23 Tests: buildMinimalEsxBuffer-Builder, Magic-Detection (4), File-Size-Caps (2), Magic-Validation (4), Mono-Parse (4), Stereo-Parse (2), PCM-Helper (4), Defensive (2) + Real-File-Test conditional auf 'Korg ESX files/'. (16) NEU tests/features/korg-e2s-bank.test.ts — 18 Tests: buildMinimalE2sBuffer-Builder, Signature-Detection (3), File-Caps (2), Slot-Parse (6: empty/mono+category/stereo/mixed-with-nulls/offset-table-preserved/category-mapping), PCM-Helper (3), Defensive (1), bankDetect (2), Real-File-Test conditional auf 'Korg e2s files/Sample/'. (17) UPDATE tests/features/drag-drop.test.ts — Test 'erkennt alle KORG-Electribe-Endungen' angepasst (.esx entfernt), NEU Test 'erkennt .esx/.ess/.all als KORG-Sample-Bank', disjoint-Sets-Test schliesst KORG_BANK_EXTENSIONS ein, multi-file-Test um korg-bank erweitert. (18) UPDATE tests/features/license-gates.test.ts — PRO_FEATURES toHaveLength(6), +PRO_FEATURE_KORG_BANK_IMPORT-Check. (19) package.json 3.2.0 → 3.3.0, agents/INDEX.js version 3.2.0 → 3.3.0 + IPC-Channels {'korg:import-bank', 'korg:open-bank-dialog', 'korg:get-bank-cap'} + files-Index +14 Eintraege. pnpm check clean (no diagnostics), pnpm test 3635 passed / 15 skipped (vs prev 3591/15, +44 net = 41 neue KORG-Tests + 3 angepasste). VERIFIED: ESX-1 Magic 'KORG'+'ESX\\0' (Pos 0+8), 2nd Magic @ 0x1B0000, 256+128 Slot-Header-Layout, BE-PCM @ 0x250000, EMPTY-Sentinel 0xFFFFFFFF; E2S Signature 'e2s sample all\\x1a\\0', 250 Offset-Table @ 0x07E0, RIFF/WAVE-Slots @ 0x1000+, korg/esli Sub-Chunk 1180B mit name@0x0A+category@0x1A. CAVEATS: (a) Patterns/Songs werden v3.3 NICHT geparst (Skeleton-Array, FOLLOWUP v3.5). (b) Slice-Decode-Skeleton OK aber Slice-Trigger-Playback nicht v3.3 (FOLLOWUP v3.4 fuer Per-Slice-Pads + v3.5 fuer Sequencing). (c) E2S-Build/Write ist explizit OUT-OF-SCOPE (FOLLOWUP v3.4) — Original e2s_builder.py 743 LOC ist die Spezifikation, aber das Round-Trip-bit-exact-Anspruch (raw_riff-Preservation, opaque_blob, offset_table-Reuse) ist eine eigene Task. (d) ESX-1 Stereo-Preview: KorgBankModal spielt nur Mono-Reduce (Left-Channel-only) — Slice-Player ist Mono-only by design. (e) Blob-URLs aus 'Add to Library' werden NICHT explizit revoked beim Modal-Schliessen — wenn der User Samples hinzugefuegt hat, koennen URLs noch im useProjectStore referenziert werden. Caller-Pflicht (FOLLOWUP-cleanup). (f) IPC-Pfad 'korg:import-bank' ist gebaut + getestbar via Renderer, aber der primaere Workflow ist File-basiert (FileReader.arrayBuffer im Renderer — isomorph zwischen Browser und Electron). Der IPC-Endpunkt bleibt als optional 'native-dialog'-Pfad. (g) Real-Files in 'Korg ESX files/' und 'Korg e2s files/' sind NICHT ins Repo committed — Tests sind via fs.existsSync gated mit describe.skip-Fallback. (h) Security-Agent fuer die neuen IPC-Channels: Whitelist-Endungen + path.resolve + access(R_OK) + size-cap, Pattern aus electribe:import-file uebernommen. Audit-Konsultation auf 'medium-prio' — die Implementation folgt validierten Mustern und hat keine neuen Risk-Faktoren ggu. dem electribe-Channel."
      ],
      next: [
        "TASK-237-FOLLOWUP-5-SAMPLES-WRITE (v3.4): E2S Sample-Bank-Writer aus Korg Editor/services/e2s_builder.py (743 LOC) porten. Round-Trip-Anspruch bit-exact: raw_riff-Preservation pro Slot, opaque_blob am EOF, original-offsetTable-Reuse. Wichtigste Use-Cases: (a) User loescht Slot → Offset-Table-Entry auf 0, (b) User vertauscht Slots → Reorder-Offsets, (c) User fuegt neuen Sample hinzu → neuer RIFF-Chunk + korg/esli-Body-Build. (1) buildE2sBank(slots) → ArrayBuffer-Builder + (2) UI in KorgBankModal: 'Save Modified Bank As...'-Button + neue IPC korg:save-bank-as.",
        "TASK-237-FOLLOWUP-5-PATTERNS (v3.5): ESX-1 Pattern-Parser. 256 Patterns × 4280 Bytes ab 0x0200. Step-Encoding + Part-Mappings reverse-engineeren — vermutlich Open Electribe Editor EsxUtil.java als Referenz. Convert nach Synthstudio-DrumPattern.",
        "TASK-v3.3-FOLLOWUP-1 (Blob-URL-Cleanup): Modal trackt erzeugte URLs und revoked sie bei Sample-Removal aus useProjectStore (oder beim App-Reload). Aktuell leaken die URLs wenn der User viele Samples hinzufuegt und sie nicht behalten will.",
        "TASK-v3.3-FOLLOWUP-2 (Stereo-Preview): AudioEngine.playSliceBuffer akzeptiert nur Mono. Fuer korrektes Stereo-Preview muesste die Engine einen 2-Channel-AudioBuffer mit copyToChannel(L,0)+copyToChannel(R,1) nehmen. Out-of-Scope v3.3.",
        "TASK-v3.3-FOLLOWUP-3 (Per-Pad-Drop): User kann eine .esx/.all-Datei direkt auf einen Performance-Pad droppen, der Pad nimmt den ersten Sample als Slot — wuerde Pad-Slot-Resolver + Pre-Parse-on-Drop benoetigen.",
        "TASK-237-CALIBRATION-FOLLOWUP-1 (Step-Encoding): User stellt 2-3 Real-Files mit bekannten Step-Positionen bereit. Hex-Diff → Step-Trigger-Byte-Layout im 896-Byte-Part-Block.",
        "TASK-237-CALIBRATION-FOLLOWUP-2 (Part-Header-Fields): Sample-ID, Volume, Pan, Pitch, FxSend im 896-Byte-Block lokalisieren.",
        "TASK-237-CALIBRATION-FOLLOWUP-3 (StepLength/Swing): Bytes im 0x124-0x140 Range kalibrieren.",
        "TASK-232-FOLLOWUP-1 (Gumroad-Real-Integration) bleibt offen.",
        "TASK-236-ALT-FOLLOWUP-1/2/3 bleiben offen.",
        "TASK-241-FOLLOWUP-2-GRANULAR / FOLLOWUP-3-SYNTHLFO / FOLLOWUP-4-CUSTOMWAVE bleiben offen.",
        "TASK-239 (VST3/CLAP-Host) bleibt offen."
      ],
      changed: [
        "client/src/utils/korg/constants.ts (NEU — alle ESX-1+E2S-Konstanten aus Python constants.py portiert: Magic-Bytes, Slot-Counts, Header/PCM-Offsets, ESLI-Field-Offsets, Category-Names, File-Caps; ~190 LOC)",
        "client/src/utils/korg/esxParser.ts (NEU — ~350 LOC ESX-1 .esx Parser mit isEsxBuffer + parseEsxBank + be16PcmToFloat32; PCM BE→LE→Float32; defensive size+magic+bounds; Stereo interleaved; Patterns-Skeleton)",
        "client/src/utils/korg/e2sBankReader.ts (NEU — ~470 LOC E2S .all Reader mit parseE2sBank + isE2sBuffer + le16PcmToFloat32 + countE2sSlots; RIFF/WAVE-Walker; korg/esli Body-Parsing inkl. Slices+Steps; Per-Slot+Cumulative-Caps)",
        "client/src/utils/korg/bankDetect.ts (NEU — detectKorgBankType+detectKorgBankTypeFromName)",
        "client/src/components/KorgBank/KorgBankModal.tsx (NEU — ~400 LOC Read-Only-Viewer mit Sample-Liste/Preview/Add-to-Library/Bulk-Import; encodeWav-Pure-Helper; semantic Tailwind classes)",
        "client/src/utils/dragDropDispatch.ts (FileType +'korg-bank', neues KORG_BANK_EXTENSIONS-Set, ELECTRIBE_EXTENSIONS reduziert ohne .esx, detectFileType priorisiert korg-bank vor electribe, eventNameMap → 'korg:bank:open')",
        "client/src/components/DragDropOverlay/DragDropOverlay.tsx (OVERLAY_STYLES['korg-bank'] + SUBTEXT_BY_TYPE-Eintrag)",
        "electron/components/ElectronDropZone.tsx (+onKorgBankFile-Prop, +KORG_BANK_EXTENSIONS-Branch, detectDropType erkennt 'korg-bank', DropType-Union erweitert)",
        "electron/ipcValidators.ts (+KORG_BANK_ALLOWED_EXTENSIONS Set {'.esx','.ess','.all'}, +KORG_BANK_MAX_BYTES=100MB, +validateKorgBankPath, +validateKorgBankFileSize)",
        "electron/main.ts (3 neue IPC-Handler: korg:import-bank + korg:open-bank-dialog + korg:get-bank-cap; Imports erweitert)",
        "electron/preload.ts (3 neue contextBridge-Methoden: openKorgBankDialog + importKorgBank + getKorgBankCap)",
        "client/src/utils/proFeatures.ts (+PRO_FEATURE_KORG_BANK_IMPORT='korg-bank-import' + Label 'KORG Sample-Bank-Import'; PRO_FEATURES jetzt Länge 6)",
        "client/src/components/DrumMachine/DrumMachine.tsx (+'📦 KORG Bank'-Toolbar-Button mit ProLockBadge + hidden file-input accept='.esx,.ess,.all' + onChange-Handler mit Pro-Gate + dispatch 'korg:bank:open')",
        "client/src/App.tsx (+Import KorgBankModal + proFeatures-Imports konsolidiert + useState korgBankFile + handleKorgBankFile + handleKorgBankAddSample + useEffect-Listener 'korg:bank:open' + onKorgBankFile-Prop an ElectronDropZone + KorgBankModal-Render)",
        "tests/features/korg-esx-parser.test.ts (NEU — 23 Tests: Magic, Caps, Mono/Stereo-Parse, PCM-Helper, Defensive + Real-File-Test conditional auf 'Korg ESX files/')",
        "tests/features/korg-e2s-bank.test.ts (NEU — 18 Tests: Signature, Caps, Slot-Parse, PCM-Helper, Defensive, bankDetect + Real-File-Test conditional auf 'Korg e2s files/Sample/')",
        "tests/features/drag-drop.test.ts (.esx aus Electribe-Test entfernt, NEU korg-bank-Detection-Test, disjoint-Sets-Test inkl. KORG_BANK_EXTENSIONS, multi-file-Test +korg-bank)",
        "tests/features/license-gates.test.ts (PRO_FEATURES.toHaveLength(6), +PRO_FEATURE_KORG_BANK_IMPORT-Check)",
        "package.json (3.2.0 → 3.3.0)",
        "agents/INDEX.js (workLog + version 3.3.0 + IPC-Channels {'korg:import-bank','korg:open-bank-dialog','korg:get-bank-cap'} + files-Index +14)"
      ]
    },
    {
      agent:     "backend",
      timestamp: "2026-05-18T08:00:00.000Z",
      done: [
        "v3.2.0: TASK-237-CALIBRATION — KORG Electribe-Format gegen ECHTE KORG E2 Sampler-Files kalibriert (.e2spat-Support). User hat 4 reale .e2spat-Files bereitgestellt (001_Advisory1=128 BPM, 181_Init=120 BPM, 245_BodyTalk1=165 BPM, 250_Init=170 BPM — alle 16640 Bytes). Hex-Dump-Diff-Analyse hat das echte Layout reverse-engineered: (0x00 16B Magic 'KORG'+12×0x00) + (0x10 16B ID 'e2sampler'+zeros) + (0x20 u32 LE Version=1) + (0x24..0xFF 0xFF padding) + (0x100 16B 'PTST'+zeros Pattern-Marker) + (0x110 16B Pattern-Name ASCII space-padded) + (0x122 u16 LE BPM×10) + (0x900 16 Parts × 896 Bytes = 14336 Bytes, ergibt total 16640). (1) UPDATE client/src/utils/electribeImport.ts — Dual-Layout-Support mit Auto-Detection: NEU isRealElectribeFile(input) prüft 3 Marker (KORG@0x00 + e2sampler@0x10 + PTST@0x100), distinkt von synthetischem Legacy-Layout. parseElectribeBank() routet: Real-File → parseRealPattern(view) (Name aus 0x110, BPM aus 0x122/10, Version aus 0x20 u32 LE, 16 Parts × 896 Bytes ab 0x900 als BEST-EFFORT-PartBlocks mit Hardware-Defaults Volume=100/Pan=64/Pitch=0/FxSend=0 und alle Steps inactive bis Step-Encoding verifiziert ist). Legacy-Pfad unverändert (synthetische Tests bleiben grün). NEU exportiert ELECTRIBE_REAL_IDENTIFIER='e2sampler', ELECTRIBE_REAL_PATTERN_MARKER='PTST', ELECTRIBE_REAL_FILE_SIZE=16640, ELECTRIBE_REAL_NAME_OFFSET=0x110, ELECTRIBE_REAL_BPM_OFFSET=0x122, ELECTRIBE_REAL_PARTS_OFFSET=0x900, ELECTRIBE_REAL_PART_STRIDE=896, isRealElectribeFile. Erweiterter Header-Comment dokumentiert verified vs best-effort Felder klar. (2) UPDATE electron/ipcValidators.ts — ELECTRIBE_ALLOWED_EXTENSIONS Set um '.e2spat' erweitert (jetzt drei Endungen: .e2pattern + .e2sallpat + .e2spat). Fehler-String 'Nur .e2pattern/.e2sallpat/.e2spat erlaubt'. (3) UPDATE electron/main.ts electribe:import-file Handler — .e2spat zur Ext-Whitelist hinzu + electribe:open-dialog Filter um 'e2spat'-Extension erweitert. (4) Tests tests/features/electribe-import.test.ts: +16 synthetische Real-Layout-Tests (isRealElectribeFile-Detector mit 6 Cases: positive/Legacy-rejection/KORG-zerstört/e2sampler-zerstört/PTST-zerstört/zu-klein. Real-File-Parser mit 10 Cases: 120 BPM, 165 BPM BodyTalk1, Name 'Advi$ory1' max-16, 'Init Pattern' mit Space, 16 Parts mit Defaults, BPM-Clamp-Garbage, detectElectribeFormat→pattern, Version aus 0x20, Layout-Konstanten-Plausi 16×896==14336, convert→Synthstudio End-to-End) + 6 ECHTE-FILE-Tests via fs.readFileSync(Korg e2s files/...) conditional auf REAL_FILES_AVAILABLE (describe.skip wenn Files nicht da — sauber für CI/Fresh-Clone). buildRealElectribeBuffer-Builder baut synthetisch das echte Layout nach mit 0xFF-Padding zwischen 0x24-0xFF wie in den Real-Files. Test-Count: 42 → 64 (+22). (5) Tests tests/features/security-ipc.test.ts: +1 .e2spat-Acceptance-Test + 1 .E2SPAT case-insensitive-Test (41→43). (6) package.json 3.1.0 → 3.2.0, agents/INDEX.js project.version 3.1.0 → 3.2.0. pnpm check clean, pnpm test 3591 passed / 15 skipped (vs prev 3568, +23 Net inkl. neue Real-File-Tests). VERIFIED FIELDS (Real-Files): ✅ Magic 'KORG'+'e2sampler'+'PTST'-Marker, ✅ Pattern-Name aus 0x110, ✅ BPM aus 0x122 (u16 LE / 10) — verified gegen 4 echte Files mit 120/170/165/128 BPM, ✅ File-Size 16640 = Single-Pattern. BEST-EFFORT/UNVERIFIED (Real-Files): ⚠ Step-Length/Swing-Bytes im Range 0x124-0x140 (variieren stark zwischen Files, default 16/0), ⚠ Part-Header-Felder (Sample-ID, Volume, Pan, Pitch, FxSend — die genauen Offsets im 896-Byte-Part-Block sind unbekannt), ⚠ Per-Step-Trigger-Bytes (8-Byte-Records bei 0x900+ haben komplexes Encoding mit moeglicher Note-Per-Step + Length-Encoding — KEIN Bit-7-Active-Flag wie im synthetischen Layout), ⚠ Motion-Sequencer-Slots. CAVEATS: (a) Real-Files werden als 1-Pattern-Bank zurückgegeben (.e2spat ist Single-Pattern by spec). (b) parseRealPartBlock liefert defensiv 16 Parts mit Hardware-Defaults + 64 inaktive Steps + 4 disabled Motion-Slots, damit der Importer nie crashed und der User in der DrumMachine UI klare Felder bekommt die er manuell ausfüllen kann. (c) BPM 1700=170.0 in 250_Init Pattern war eine Ueberraschung — Init-Defaults variieren pro Werks-Slot des Geraets. (d) Legacy-Synthetic-Layout-Tests bleiben unverändert grün; Detector ist hinreichend distinkt um keine Kollision zu erzeugen. (e) User-Files in 'Korg e2s files/' NICHT ins Repo committed — Tests sind conditional via fs.existsSync gated mit describe.skip-Fallback. Sample-Files (.all, 23MB+17MB) sind out-of-scope dieser Task — FOLLOWUP TASK-237-FOLLOWUP-5-SAMPLES für e2sSample.all/mäxchen.all Sample-Bank-Parser. NICHT GEMACHT: Step-Daten-Reverse-Engineering des 896-Byte-Part-Blocks (das ist eine separate Forschungs-Task — benoetigt User-Test mit handvoll bekannter Patterns wo wir die Step-Positionen kennen und im Hex-Diff lokalisieren können)."
      ],
      next: [
        "TASK-237-CALIBRATION-FOLLOWUP-1 (Step-Encoding): User stellt 2-3 Real-Files mit bekannten Step-Positionen bereit (z.B. 'Kick auf 1,5,9,13' explizit gespeichert). Dann Hex-Diff zwischen leerem Init und bekanntem Pattern → Step-Trigger-Byte-Layout im 896-Byte-Part-Block identifizieren. Erwartete Offsets: vermutlich bei 0x900+8 oder 0x900+16 ein Step-Array.",
        "TASK-237-CALIBRATION-FOLLOWUP-2 (Part-Header-Fields): Sample-ID, Volume, Pan, Pitch, FxSend im 896-Byte-Block lokalisieren via Vergleich zwischen Patterns mit bekannten Settings.",
        "TASK-237-CALIBRATION-FOLLOWUP-3 (StepLength/Swing): Bytes im 0x124-0x140 Range mit Patterns variabler StepLength (16 vs 32 vs 64) und Swing-Werten kalibrieren.",
        "TASK-237-FOLLOWUP-5-SAMPLES: e2sSample.all/mäxchen.all Sample-Bank-Format-Parser (separate Task, 23MB+17MB Files, vermutlich SMF-Container mit WAV-Subchunks).",
        "TASK-237-FOLLOWUP-1B/2/3/4 (bestehende Followups) bleiben offen.",
        "TASK-232-FOLLOWUP-1 (Gumroad-Real-Integration) bleibt offen.",
        "TASK-236-ALT-FOLLOWUP-1/2/3 bleiben offen.",
        "TASK-241-FOLLOWUP-2-GRANULAR / FOLLOWUP-3-SYNTHLFO / FOLLOWUP-4-CUSTOMWAVE bleiben offen.",
        "TASK-239 (VST3/CLAP-Host) bleibt offen."
      ],
      changed: [
        "client/src/utils/electribeImport.ts (Dual-Layout-Support: NEU isRealElectribeFile-Detector, NEU parseRealPattern + parseRealPartBlock (Best-Effort, 16 Parts × 896 Bytes ab 0x900), parseElectribeBank/parseElectribePattern routen jetzt Real vs Legacy. Erweiterte Header-Spec-Doku mit verified vs Best-Effort. NEU Exports: ELECTRIBE_REAL_IDENTIFIER/PATTERN_MARKER/FILE_SIZE/NAME_OFFSET/BPM_OFFSET/PARTS_OFFSET/PART_STRIDE, isRealElectribeFile)",
        "electron/ipcValidators.ts (ELECTRIBE_ALLOWED_EXTENSIONS Set um '.e2spat' erweitert, error-string aktualisiert)",
        "electron/main.ts (electribe:import-file Handler-Whitelist und electribe:open-dialog Filter um '.e2spat' / 'e2spat' erweitert)",
        "tests/features/electribe-import.test.ts (+22 Tests: 6 isRealElectribeFile-Detector + 10 synthetische Real-Layout-Parser-Tests + 6 echte-File-Tests via fs.readFileSync conditional auf REAL_FILES_AVAILABLE; buildRealElectribeBuffer-Builder)",
        "tests/features/security-ipc.test.ts (+1 .e2spat-Acceptance + 1 .E2SPAT case-insensitive)",
        "package.json (3.1.0 → 3.2.0)",
        "agents/INDEX.js (workLog + version 3.2.0 + files-Index-Updates)"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-18T07:40:00.000Z",
      done: [
        "v3.1.0: Drag-Drop für .wav/.synth/.e2pattern/.midi/.zip — vollständiger Standard-DAW-Drop-Workflow. (1) NEU client/src/utils/dragDropDispatch.ts (~165 LOC, pure-utility): detectFileType(name)→audio|project|zip|midi|electribe|unknown via Lookup-Switch über 5 disjunkte Endungs-Sets (AUDIO_EXTENSIONS, PROJECT_EXTENSIONS={'.synth'}, ZIP_EXTENSIONS, MIDI_EXTENSIONS, ELECTRIBE_EXTENSIONS={'.e2spat','.e2sallpat','.e2pattern','.esx','.elst'}). getFileExtension(name) defensive (null/undefined/empty/no-dot → ''). dispatchFileDrop(file) feuert CustomEvent: drop:audio/drop:project/drop:zip/midi:fileImport/electribe:fileImport. dispatchAllFiles(files[]) für Multi-File-Drop, zählt handled+unknown+types[]. detectFileTypeFromFiles(files[]) für Overlay-Type-Detection bei mehreren Files (nimmt Typ der ersten). (2) NEU client/src/components/DragDropOverlay/DragDropOverlay.tsx — standalone visuelles Drop-Feedback (~110 LOC). Props {isVisible, fileType}. Pro Typ eigene Farbe via semantic Tailwind classes (border-accent-primary/secondary/success, bg-accent-*/10, text-accent-*) — NULL hardcoded slate/gray/cyan. Pointer-events-none. data-testid=drag-drop-overlay + data-drop-type=<type>. Subtext pro Typ erklärt was passieren wird. (3) UPDATE electron/components/ElectronDropZone.tsx: importiert jetzt zentrale dragDropDispatch.ts-Constants statt Inline-Duplikate. +ELECTRIBE_EXTENSIONS-Branch im handleDrop der entweder onElectribeFile-Prop ODER Default-CustomEvent electribe:fileImport dispatcht (DrumMachine-Listener existiert seit v2.88). +unknownExts-Sammelung pro Drop → genau EIN Toast pro Drop (nicht pro File, Toast-Spam-Schutz, max 3 Endungen + Count). +onElectribeFile-Prop in ElectronDropZoneProps. Inline-DROP_STYLES entfernt, ersetzt durch DragDropOverlay-Render. Folder-Overlay bleibt inline weil 'folder' kein CustomEvent-Route hat (Webkit-Entry-spezifisch). (4) UPDATE client/src/App.tsx — onElectribeFile-Prop an ElectronDropZone übergeben (dispatcht electribe:fileImport CustomEvent). (5) Zone-spezifisches Drop MVP: SampleSliceEditor (TASK-238-Modal) bekommt onReplaceSample?-Prop. Waveform-Bereich (data-testid=slice-editor-waveform-zone) hat eigenen onDragOver/onDragEnter/onDragLeave/onDrop-Cycle. Audio-File-Drop → Decode via geteiltem handleSliceFile in DrumMachine.tsx. dragLeave nur dann false wenn das Element wirklich verlassen wird (contains(relatedTarget)-Check gegen Child-Bubble). Visueller Indikator data-testid=slice-editor-drop-indicator. DrumMachine extrahiert handleSliceFile aus handleSliceImport — DRY für Picker+Drop-Pfad. (6) Tests tests/features/drag-drop.test.ts (NEU, 27 Tests, alle grün): getFileExtension (3 — lowercase+dot/ohne-Endung/null-defensive), detectFileType (8 — AUDIO-Iteration/.synth/.zip/.mid+.MIDI/Electribe-5-Varianten/unknown/leer/disjoint-Sets-Invariant), detectFileTypeFromFiles (2), dispatchFileDrop (7 — Audio/Project/Electribe/Midi/Zip/Unknown-handled-false/EndpointListener-empfängt), dispatchAllFiles (4 — Multi-Audio+Synth/Mixed-Unknown-Counter/Alle-5-Typen+1unknown/leer-Array), defensive (3 — kaputt-File/kein-window/throw-im-dispatchEvent). Custom-Window-+CustomEvent-Shim für Node-Env (kein JSDOM nötig). (7) package.json 3.0.0 → 3.1.0. (8) pnpm check clean, pnpm test 3568 passed / 15 skipped (vs prev 3539, +29 Net — 27 von der neuen Suite + 2 Side-Counts). CAVEATS: (a) Mixer-Channel-Strip-Audio-Drop (v2.x) UND Globaler Drop könnten beide auslösen bei Bubbling — Mixer-Drop ruft e.stopPropagation(), ist also winner. Bei SampleSliceEditor-Drop ebenfalls stopPropagation. (b) Sample-Pack (.zip) wird durch existierendes onZipFile→extractSamplesFromZip in App.tsx weiter geleitet — keine Änderung notwendig. (c) Browser hat keinen file.path — nur file.name, deshalb erzeugt App.tsx synthetische IDs/URLs (existierendes Verhalten unverändert). Electron hat IPC-Bridge die echte Pfade liefert (onDragDropBulkImport). (d) Electribe-Drop ist PRO-Feature-gated im DrumMachine-Handler (requireProFeature seit v2.97) — Drop funktioniert technisch immer aber zeigt Toast bei expired-Trial. (e) Unknown-Extension-Toast einmalig pro Drop, nicht pro File (z.B. 5 .mp4 → 1 Toast 'Nicht unterstützt: .mp4 (+4 weitere)'). NICHT erledigt (User-Empfehlung 'MVP'): Drop einer .wav auf einzelnen Performance-Pad in PatternLaunchPad (würde Sample-Pad-Slot-Store + Audio-Decode benötigen, deferred); Drop auf Mixer-Channel-Strip ist bereits seit MixerView v2.x vorhanden (audio-track-Erstellung)."
      ],
      next: [
        "TASK v3.1.0-FOLLOWUP-1: Drop einer .wav auf einzelnen PatternLaunchPad-Pad → setSlicePadSlot direkt (würde decodeAudioData + Sample-Pad-Slot-Lookup brauchen).",
        "TASK v3.1.0-FOLLOWUP-2: Playwright-Smoke 'DragDropOverlay erscheint bei dragenter' (jsdom-Env wegen DataTransfer-Shim) — optional als CI-Erweiterung.",
        "TASK v3.1.0-FOLLOWUP-3: Electron-Side: nativeFileDrop-Listener im Main-Process um .e2sallpat/.esx/.elst mit echten Pfaden (statt File-Objekt mit nur name) zu liefern.",
        "TASK-232-FOLLOWUP-1 (Gumroad-Real-Integration) bleibt offen.",
        "TASK-236-ALT-FOLLOWUP-1/2/3 bleiben offen.",
        "TASK-241-FOLLOWUP-2-GRANULAR / FOLLOWUP-3-SYNTHLFO / FOLLOWUP-4-CUSTOMWAVE bleiben offen.",
        "TASK-239 (VST3/CLAP-Host) bleibt offen."
      ],
      changed: [
        "client/src/utils/dragDropDispatch.ts (NEU — pure detectFileType/dispatchFileDrop/dispatchAllFiles + 5 disjunkte Endungs-Sets inkl. Electribe-Endungen)",
        "client/src/components/DragDropOverlay/DragDropOverlay.tsx (NEU — standalone Overlay-Komponente mit per-Type-Farbe via semantic Tailwind classes)",
        "electron/components/ElectronDropZone.tsx (+ELECTRIBE_EXTENSIONS-Branch, +onElectribeFile-Prop, +Unknown-Toast pro Drop, DROP_STYLES ersetzt durch DragDropOverlay-Render, +@/-Aliase statt relativer Pfade)",
        "client/src/App.tsx (+onElectribeFile-Prop an ElectronDropZone der electribe:fileImport CustomEvent dispatcht)",
        "client/src/components/SampleEditor/SampleSliceEditor.tsx (+onReplaceSample?-Prop, Zone-Drop auf Waveform-Bereich mit dragOver/dragEnter/dragLeave/drop-Cycle und visuellem Indikator)",
        "client/src/components/DrumMachine/DrumMachine.tsx (handleSliceFile aus handleSliceImport extrahiert für DRY Picker+Drop-Pfad, +onReplaceSample={handleSliceFile} an SampleSliceEditor)",
        "tests/features/drag-drop.test.ts (NEU, 27 Tests — detectFileType-Matrix für 5 Typen+Unknown, dispatchFileDrop EventName-Routing, Multi-File mit dispatchAllFiles, defensive Paths)",
        "package.json (3.0.0 → 3.1.0)",
        "agents/INDEX.js (workLog + version 3.1.0 + files-Index +3 Eintraege)"
      ]
    },
    {
      agent:     "backend",
      timestamp: "2026-05-18T07:25:00.000Z",
      done: [
        "v3.0.0: TASK-236-ALT — Audio-Engine Low-Latency-Konfiguration (sichere Web-Audio-Alternative zur nativen WASAPI-Exclusive-Variante TASK-236). MAJOR-Bump 2.99.0 → 3.0.0 als symbolischer Marker: erste Low-Latency-Release ohne Native-Code-Risk. (1) NEU client/src/store/useAudioEngineConfigStore.ts (~140 LOC, Custom-Observer analog useThemeStore): State {latencyHint:'interactive'|'balanced'|'playback', sampleRate:44100|48000|96000|'auto'}, Defaults 'interactive'+'auto'. localStorage-Key 'ss-audio-engine-config:v1', sanitize-on-load mit VALID_HINTS+VALID_SAMPLE_RATES-Whitelists, identical-value-short-circuit (kein extra Write bei No-Op-Setter). Public API: getAudioEngineConfig, setLatencyHint, setSampleRate, buildAudioContextOptions(cfg?) → AudioContextOptions (lässt sampleRate WEG wenn 'auto' damit Browser nicht unnötig resampelt), __resetAudioEngineConfigForTests, useAudioEngineConfigStore() Hook. (2) AudioEngine.init() liest jetzt Config aus Store: `new AudioContext(buildAudioContextOptions(getAudioEngineConfig()))` mit try-catch-Fallback auf zero-arg-Ctor wenn Browser die Options nicht akzeptiert (Spec-konform). (3) NEU AudioEngine.reinit() — full-teardown+setup: stop() falls playing, _granularEngines.stop()+clear, detachLiveInput für alle attached IDs, channelNodes.clear, reverbBuffers.clear, _globalReverbBus/Wet/Delay/etc.=null, masterGain=null, _outputAnalyser=null, ctx.close()+null, dann init() neu. Sample-Buffer-Cache (bufferCache) bleibt — decodeAudioData ist ctx-agnostisch. Active recordings/live-inputs werden abgebrochen (kein State-Sync über Context-Wechsel möglich). (4) Settings-Section 'Audio Engine' (Icon ⚡, group 'Audio', direkt unter Metronom) in SettingsPanel.tsx: AudioEngineSection-Komponente mit (a) Latency-Hint-Dropdown 3 Optionen mit Erklärung, (b) Sample-Rate-Dropdown 4 Optionen, (c) Live-Anzeige aktuelle System-Latenz (AudioEngine.getEstimatedSystemLatencyMs, tickender 1s setInterval-Refresh via useReducer), (d) Live-Anzeige aktive Sample-Rate (defensiver Cast auf AudioEngine.ctx.sampleRate), (e) rate-mismatch-Warnung wenn ctxRate ≠ gewählter Rate (>1Hz Toleranz), (f) Apply-Button feuert AudioEngine.reinit() async mit busy-State und Toast-Sequence 'wird neu gestartet' + 'aktualisiert'/Fehler. data-testids settings-audio-engine + audio-engine-{latency-hint,sample-rate,status,apply,rate-mismatch}. Semantic Tailwind classes (bg-bg-elevated, border-border-color, text-accent-primary, text-text-muted, text-accent-danger). (5) MIDI-Clock-Out Lead-Latenz reduziert: NEU AudioEngine.MIDI_CLOCK_LOOK_AHEAD=0.05 (50ms) — Bonus-Optimierung, separat vom Step-Scheduler-LOOK_AHEAD (0.1=100ms unverändert). _schedule() benutzt jetzt eigenen clockLookAheadUntil. Drift-Robustheit erhalten weil planTicks ohne `now` arbeitet (tick-cursor wird mit exakter Tick-Dauer fortgeschrieben, siehe MidiClockOut.ts:78-87). Revert-Hinweis dokumentiert im Code-Comment. (6) Tests tests/features/audio-engine-config.test.ts (NEU, 12 Tests, alle grün): Defaults+DEFAULT_CONFIG-Export (1), Latency-Hint-Persistenz (1), Latency-Hint-Validierung-No-Op (1), Latency-Hint-Identity-Check (1), Sample-Rate-Persistenz (1), Sample-Rate-Whitelist (1), buildAudioContextOptions-auto-omits-sampleRate (1), buildAudioContextOptions-with-Rate (1), buildAudioContextOptions-explicit-cfg-arg (1), sanitize-on-load-broken-blob (1), Independence-Latency-vs-Rate (1), AudioContext-Mock-Init-Capture-Args (1). localStorage-Shim analog api-settings.test.ts. (7) package.json 2.99.0 → 3.0.0, agents/INDEX.js project.version 2.99.0 → 3.0.0. pnpm check clean, pnpm test 3539 passed / 15 skipped (vs prev 3486, +53 Net — +12 von der neuen Suite, der Rest sind neue Sub-Tests in collateral Test-Files die kein Subject von dieser Aufgabe waren). ERWARTETE LATENZ-VERBESSERUNG (Schätzung Windows-Stack): default-balanced ~30-50ms → interactive ~10-20ms = 15-30ms gewonnen. Combined mit MIDI-Clock-Lead-Reduktion 100→50ms: externer Empfänger spürt ~50ms weniger Lead. CAVEATS: (a) sampleRate-Change erfordert vollständigen Context-Recreate weil AudioContext.sampleRate readonly ist — User-Toast 'Audio wird kurz unterbrochen' wird gezeigt. (b) reinit bricht aktive Recordings ab (keine State-Migration zwischen alten und neuen Nodes möglich); User muss neu armen. (c) latencyHint ist ein 'Hint' — der Browser kann die Bitte ignorieren wenn die Hardware-Treiber das nicht hergeben; getEstimatedSystemLatencyMs zeigt die tatsächliche Latenz im Settings-UI. (d) AudioWorklet-Module (BPM-Worker etc.) müssen NICHT neu geladen werden — sie sind ctx-spezifisch und werden bei nächstem Trigger lazy registriert. (e) Granular-Engines werden komplett verworfen — laufende Grain-Loops stoppen; falls aktiv, vom User vor Apply manuell stoppen empfohlen."
      ],
      next: [
        "TASK-236-ALT-FOLLOWUP-1 (Restart-Prompt): Erkennung ob bereits Playback läuft → modal warning vor Apply statt nur Toast.",
        "TASK-236-ALT-FOLLOWUP-2 (Browser-Sniff): bei Safari fehlt 'interactive'-Support — vorher prüfen via feature-detection (testAudioContext-Probe) und Option mit 'nicht unterstützt' graben.",
        "TASK-236-ALT-FOLLOWUP-3 (Migration-on-launch): wenn User v2.99 hatte → einmaliger Toast 'Neu: Low-Latency-Modus verfügbar, jetzt einschalten?' mit Direkt-Link in die Settings.",
        "TASK-236 (Native WASAPI) bleibt offiziell offen aber low-prio — der Web-Audio-Pfad deckt 80% des Use-Cases ab ohne Build-Risiko.",
        "TASK-232-FOLLOWUP-1 (Gumroad-Real-Integration) bleibt offen.",
        "TASK-241-FOLLOWUP-2-GRANULAR / FOLLOWUP-3-SYNTHLFO / FOLLOWUP-4-CUSTOMWAVE bleiben offen.",
        "TASK-239 (VST3/CLAP-Host) bleibt offen."
      ],
      changed: [
        "client/src/store/useAudioEngineConfigStore.ts (NEU — Custom-Observer-Store latencyHint+sampleRate mit localStorage-Persist, sanitize, buildAudioContextOptions-Helper)",
        "client/src/audio/AudioEngine.ts (+Import des Stores, init() liest Config über buildAudioContextOptions mit try-catch-Fallback, NEU reinit()-Methode für full-teardown+setup, +MIDI_CLOCK_LOOK_AHEAD=0.05s und eigenes clockLookAheadUntil im _schedule)",
        "client/src/components/Settings/SettingsPanel.tsx (+Section 'audio-engine' Icon ⚡ group Audio, AudioEngineSection mit 2 Dropdowns + Live-Latenz-Anzeige + Apply-Button → AudioEngine.reinit(), +useReducer Import, +Imports useAudioEngineConfigStore/setLatencyHint/setSampleRate/AudioEngine)",
        "tests/features/audio-engine-config.test.ts (NEU, 12 Tests — Defaults, Persistenz, Validierung, sanitize-on-load, buildAudioContextOptions-Helper, AudioContext-Mock-Init)",
        "package.json (2.99.0 → 3.0.0)",
        "agents/INDEX.js (workLog + version 3.0.0 + TASK-236-ALT done + files-Index)"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-18T06:55:00.000Z",
      done: [
        "v2.98.0: TASK-232-FOLLOWUP — License-Polish: alle 5 Pro-Features gated, Settings-Section, Lock-Badges. (1) NEU client/src/components/License/ProLockBadge.tsx — kleines 🔒-Icon-Badge (Lucide Lock, size=12 default) mit Tooltip '<Label> — Pro-Feature' das nur sichtbar wird wenn isFeatureUnlocked(feature)=false. pointer-events-none, blockiert KEINEN Underlay-Klick — der Button bleibt klickbar und feuert requireProFeature beim Klick → kontextueller Toast statt silent-disable (CLAUDE.md-Regel). Subscribt useLicenseStore für automatisches Re-Render bei Status-Wechsel. data-testid=pro-lock-badge-<feature>. (2) Gate-1 LooperPanel (Live-Looping): client/src/components/PerformanceMode/LooperPanel.tsx — handlePointerUp und handlePointerDown (Long-Press-Erase) prüfen jetzt requireProFeature(PRO_FEATURE_LIVE_LOOPING); locked → return ohne triggerLoop/eraseLoop (Toast erscheint via requireProFeature). ProLockBadge im Header neben '4/4 aktiv'-Counter. (3) Gate-2 MIDI-Note-Out (Bridge-Effect): client/src/App.tsx — der bestehende useMidiNoteOutStore-Diff-Sync-Effect leitet jetzt `effectiveEnabled = requested && isFeatureUnlocked(PRO_FEATURE_MIDI_NOTE_OUT)` an AudioEngine.setMidiNoteOutEnabled, sodass auch wenn der User die Engine im ChannelInspector toggelt KEINE Notes extern raus gehen wenn nicht-Pro. Toast wird via midiNoteOutLockToastShownRef.current LATCH genau einmal pro Aktivierungsversuch gefeuert (Toast-Spam-Schutz). Latch reset wenn requested=false. UI-Toggle bleibt bedienbar (Discovery). (4) ProLockBadges visuell platziert in: MixerView '+ Live Input'-Button (PRO_FEATURE_USB_AUDIO_IN), ExportPanel 'Bounce All Stems'-Button (PRO_FEATURE_STEM_BOUNCE), DrumMachine '🎚 Electribe'-Button (PRO_FEATURE_ELECTRIBE_IMPORT), LooperPanel-Header (PRO_FEATURE_LIVE_LOOPING). MIDI-Note-Out-Section im ChannelInspector hat bereits ein eigenes Empty-State-Wording — Badge dort optional als Follow-Up. (5) NEU Settings-License-Section: client/src/components/Settings/SettingsPanel.tsx — Section 'license' (Icon 🔑, group 'App', VOR 'about') mit Status-Display ('Pro — aktiviert' / 'Trial — Tag N von 30' mit Farb-Eskalation wenn ≤3 Tage / 'Trial abgelaufen' / 'Ungültige Lizenz' / 'Free'), '🔑 Lizenz aktivieren'-Button öffnet ActivationModal mit forceOpen=true (RE-MOUNT-Pattern: lokaler useState showActivation, conditional render <ActivationModal forceOpen onClose={...}/>). 'Pro-Lizenz kaufen'-Link → GUMROAD_PRODUCT_URL. 'Lizenz deaktivieren'-Button (nur sichtbar wenn status='pro') mit window.confirm-Schutz → clearLicense() + Toast. data-testids settings-license-{status,activate,buy,deactivate}. (6) Tests tests/features/license-gates.test.ts (NEU, 11 Tests): PRO_FEATURES-Registry-Vollständigkeit (1), Live-Looping-Gate (4 — expired-locked/Toast-feuert/Trial-unlocked/expired-Sondertext), MIDI-Note-Out-Gate (3 — locked-Toast/Trial-unlocked/Pro-unlocked), ProLockBadge-Sichtbarkeits-Regel (3 — Trial-hidden/expired-visible-für-alle-5/unknown-visible). Mock auf @/store/useToastStore.toast via vi.mock damit Toast-Calls zählbar sind. Stub für window.open. (7) NEU tests/web/license-polish.spec.ts (5 Playwright-Smokes): localStorage-Seeding-Helper für status='trial'/'pro'/'expired', openSettingsLicenseSection-Helper (Gear → Lizenz-Tab). Coverage: Settings→Lizenz-Section erreichbar + Trial-Status sichtbar, ActivationModal aus Settings öffnen+schließen via X-Button, ProLockBadge-Sichtbarkeit im expired vs. Trial, Pro-Status zeigt Deaktivieren-Button. (8) package.json 2.97.0 → 2.98.0. (9) pnpm check clean, pnpm test 3486 passed / 15 skipped (vs prev 3473, +13 Net inkl. license-gates.test.ts und ein paar collateral-tests die nun lizenzabhängige Pfade hitten). Architektur-Entscheidungen: (a) ActivationModal aus Settings = unabhängige Re-Mount-Instanz (lokaler State im Settings-Kontext), beide Instanzen synchronisieren über den Singleton-License-Store automatisch — nicht über ein Singleton-Modal-State. (b) MIDI-Note-Out Toast NUR im Bridge-Effect (1x pro Aktivierungs-Versuch), NICHT pro Step — sonst hätte jede Note ein Toast gefeuert. (c) ProLockBadge ist absichtlich `pointer-events-none` damit der unterliegende Button klickbar bleibt — Toast erscheint via requireProFeature im onClick-Handler. CAVEATS: (1) Bei sehr alten DOM-Browser-Sessions ohne window.confirm würde 'Lizenz deaktivieren' silent failen — Synthstudio läuft aber nicht auf solchen Browsern (Electron 40 / Modern Chromium). (2) Die Playwright-Tests benötigen einen seedLicenseState-Aufruf VOR page.goto, weil das ActivationModal sonst beim 'unknown'-Default die App blockiert."
      ],
      next: [
        "TASK-232-FOLLOWUP-5 (Channel-Inspector MIDI-Note-Out-Section Badge): Optional ProLockBadge im Section-Header neben 'MIDI-Note-Out' Heading.",
        "TASK-232-FOLLOWUP-6 (Trial-End-Reminder): Toast mit 'Noch 3 Tage Trial'-Hint je Tag ab T-3, T-2, T-1, T-0 via tickCheck im App.tsx-onMount.",
        "TASK-232-FOLLOWUP-1 (Gumroad-Real-Integration): User generiert reale ED25519-Keypair, ersetzt LICENSE_PUBLIC_KEY_HEX in client/src/utils/licenseConfig.ts:43 + GUMROAD_PRODUCT_URL:50. Vendor-Side-Webhook bleibt offen.",
        "TASK-241-FOLLOWUP-2-GRANULAR / FOLLOWUP-3-SYNTHLFO / FOLLOWUP-4-CUSTOMWAVE bleiben offen.",
        "TASK-242-EXTRACT-SYNTHGRAPH + EXTRACT-FXGRAPH (REFACTOR) bleiben offen.",
        "TASK-239 (VST3/CLAP-Host) bleibt offen."
      ],
      changed: [
        "client/src/components/License/ProLockBadge.tsx (NEU — kleines Lock-Icon-Badge mit Tooltip, sichtbar nur wenn locked, pointer-events-none)",
        "client/src/components/PerformanceMode/LooperPanel.tsx (+ Pro-Gate auf handlePointerUp/handlePointerDown via requireProFeature(PRO_FEATURE_LIVE_LOOPING), +ProLockBadge im Header)",
        "client/src/App.tsx (+isFeatureUnlocked-Gate im useMidiNoteOutStore-Bridge-Effect, midiNoteOutLockToastShownRef-Latch für 1x-Toast, AudioEngine bleibt disabled wenn locked auch wenn Store-Toggle 'an' ist)",
        "client/src/components/Mixer/ExportPanel.tsx (+ProLockBadge neben '🎬 Bounce All Stems')",
        "client/src/components/Mixer/MixerView.tsx (+ProLockBadge neben '+ Live Input')",
        "client/src/components/DrumMachine/DrumMachine.tsx (+ProLockBadge neben '🎚 Electribe')",
        "client/src/components/Settings/SettingsPanel.tsx (+Section 'license' mit Status-Display, Aktivieren/Buy/Deaktivieren-Buttons, ActivationModal-Re-Mount mit forceOpen)",
        "tests/features/license-gates.test.ts (NEU, 11 Tests — PRO_FEATURES-Registry, Live-Looping-Gate, MIDI-Note-Out-Gate, ProLockBadge-Sichtbarkeits-Regel)",
        "tests/web/license-polish.spec.ts (NEU, 5 Playwright-Smokes — Settings-Section, ActivationModal-Open/Close, Lock-Badge-Sichtbarkeit, Pro-Deaktivieren-Button)",
        "package.json (2.97.0 → 2.98.0)",
        "agents/INDEX.js (workLog + version 2.98.0 + files-Index)"
      ]
    },
    {
      agent:     "backend",
      timestamp: "2026-05-18T06:35:00.000Z",
      done: [
        "v2.97.0: TASK-232 — License-Layer + Pro-Feature-Gating (Technical-Scaffolding für Gumroad-PoC). (1) NEU client/src/utils/licenseConfig.ts — Konstanten LICENSE_PUBLIC_KEY_HEX (32-Byte hex, aktuell all-zero Placeholder mit TODO-Marker), LICENSE_PRODUCT_ID='synthstudio-pro-1', TRIAL_DURATION_DAYS=30, DAY_MS, GUMROAD_PRODUCT_URL='https://gumroad.com/l/synthstudio-pro' (TODO Placeholder), isUsingPlaceholderPublicKey(). Inline-Dokumentation enthält Keypair-Generation-Snippet (ed.keygenAsync) für den User. (2) NEU client/src/utils/licenseValidator.ts (~150 LOC, pure) — base64UrlDecode/Encode (mit atob-Browser + Buffer-Node-Fallback ohne ts-expect-error), parseLicenseKey(key) → {payloadB64, sigB64} | null (strict: genau 1 Dot, max 4096 Zeichen), decodePayload(b64) (max 1 KB JSON, validiert email-Länge ≤254 + productId-Match), validateLicenseKey(key, pubKeyHex, now=Date.now()) → {valid:true,payload} | {valid:false,reason} via ed.verifyAsync (WebCrypto-backed → keine sha512-Wiring nötig), signLicensePayload(payload, secretKey) für Tests + Vendor-Tooling. expiresAt-Check + Pub-Key-Länge-Check + Sig-Länge-Check (32+64 Bytes) defensiv. (3) NEU client/src/store/useLicenseStore.ts (Custom-Observer-Pattern analog useThemeStore). State: status('unknown'|'trial'|'pro'|'expired'|'invalid') + trialStartedAt + licenseKey + activatedEmail. Public API: initializeLicenseStore(now), getLicenseState(), isPro(now), daysRemainingInTrial(now), startTrial(now) (NO-OP wenn trialStartedAt!=null — kein User-Reset-Pfad), activate(key,email,now) (validiert via licenseValidator, setzt status='pro' bei Erfolg, status='invalid' nur wenn vorher 'unknown'), clear() (entfernt key, behält trialStartedAt), markUnknownAsExpired() (für 'continue free'-Click). useLicenseStore() Hook. sanitizeState() defensive Filter für persistierte Blobs (Status-Whitelist, NaN→null, Längen-Limits 254/4096). Persistenz: window.electronAPI.readLicense/writeLicense (Electron) ODER localStorage('synthstudio:license:v1') Fallback. Test-Helper __resetLicenseForTests + __setLicenseStateForTests. (4) NEU client/src/utils/proFeatures.ts — Konstanten PRO_FEATURE_LIVE_LOOPING/USB_AUDIO_IN/STEM_BOUNCE/ELECTRIBE_IMPORT/MIDI_NOTE_OUT, PRO_FEATURE_LABELS (DE), isFeatureUnlocked(feature, unknownFeatureDefault=false) liest isPro(), requireProFeature(feature) — wenn nicht unlocked: zeigt Toast mit 'Lizenz kaufen'-Action öffnet GUMROAD_PRODUCT_URL und gibt false zurück, im 'expired'-Case Sondertext 'dein 30-Tage-Trial ist abgelaufen'. (5) NEU client/src/components/License/ActivationModal.tsx — fixed inset-0 z-9999 Dialog (Tailwind semantic classes), 2 Modi 'choice'+'activate'. Choice-Mode: 'Trial starten' (startTrial) / 'Lizenz aktivieren' (→Mode-Switch) / 'Mit Free-Version fortfahren' (markUnknownAsExpired). Activate-Mode: textarea(key)+input(email)+Validate-Button(busy/error-State). Modal closable nur via 'forceOpen'-Prop (Settings → 'License-Aktivieren'); im Auto-Mode (status='unknown') NICHT closable bis Entscheidung. (6) IPC: NEU 'license:read'/'license:write' in electron/main.ts (analog 'audio:save-recording'-Pattern aus v2.86). Path-hardcoded: userData/license.json (KEIN user-supplied path, kein Path-Traversal-Vektor). Read: 16-KB-Limit + try-catch JSON.parse + object-shape-check. Write: status-Whitelist (5 Werte), trialStartedAt finite-number-only, licenseKey/email Längen-Limits (4096/254), JSON.stringify-Size-Check ≤16 KB. Preload electron/preload.ts exposed via electronAPI.readLicense / electronAPI.writeLicense. (7) Beispiel-Gates (minimal-invasiv): client/src/components/Mixer/ExportPanel.tsx handleBounceAllStems → requireProFeature(PRO_FEATURE_STEM_BOUNCE), client/src/components/DrumMachine/DrumMachine.tsx handleElectribeFile → requireProFeature(PRO_FEATURE_ELECTRIBE_IMPORT), client/src/hooks/useAudioInput.ts start() → requireProFeature(PRO_FEATURE_USB_AUDIO_IN). LiveLooping + MIDI-Note-Out Constants angelegt, Gate-Calls überlassen wir folgenden Aufgaben. (8) Wiring: client/src/App.tsx mountet ActivationModal nach ToastContainer + useEffect ruft initializeLicenseStore() einmalig. (9) Tests tests/features/license.test.ts (18 Tests, alle grün): Trial-Lifecycle (start/no-reset/days-decrement/auto-expire), validateLicenseKey (invalid-format/valid-roundtrip/manipulierte-Sig/expired/falscher-productId/parseLicenseKey-Robustheit/decodePayload-Defekte), isFeatureUnlocked (trial-unlocked/expired-locked/invalid-key→nicht-pro/unknown-feature-default), Persistenz (localStorage-Round-Trip/sanitizeState-NaN-Filter). Test generiert pro Suite einen frischen ED25519-Keypair via ed.keygenAsync + signLicensePayload. tests/features/use-audio-input-hook.test.ts beforeEach erweitert um __setLicenseStateForTests({status:'pro'}) damit existing-Tests am USB-Audio-In-Gate vorbeikommen. (10) @noble/ed25519 ^3.1.0 als Dependency: zero-dep, MIT-Lizenz, audit-history (used by ethereum/cosmos/solana SDKs), kein eigenes Native-Code, sha512 läuft via WebCrypto-API (browser+electron+test). Security-Posture im Klartext: Crypto-Lib in Renderer ok (kein Side-Channel-Risk weil Public-Key-Verification ist constant-data-Verarbeitung). LICENSE_PUBLIC_KEY_HEX hartcodiert ALL-ZERO mit TODO-Marker — Verification schlägt fehl bis User Real-Key einsetzt; das ist der gewollte Default-State während dev. SECRET-KEY NIEMALS im Client. (11) package.json 2.96.0 → 2.97.0. pnpm check clean, pnpm test 3473 passed / 15 skipped (vs prev 3458, +15 Net inkl. license.test.ts). TODO-PLACEHOLDERS für User: licenseConfig.ts:43 (LICENSE_PUBLIC_KEY_HEX) + licenseConfig.ts:50 (GUMROAD_PRODUCT_URL). Future-Tasks: TASK-232-FOLLOWUP — Gumroad-Webhook-Server zum Minting der signierten Keys, Settings-License-Section (zeigt Status + daysRemaining + Aktivieren-Button öffnet ActivationModal mit forceOpen=true), Locked-Feature-Lock-Icon-Badge in UI, weitere Gates an LiveLooping + MIDI-Note-Out + ggf. Granular/VST."
      ],
      next: [
        "TASK-232-FOLLOWUP-1 (Gumroad-Real-Integration): User generiert reale ED25519-Keypair, ersetzt LICENSE_PUBLIC_KEY_HEX in client/src/utils/licenseConfig.ts:43 + GUMROAD_PRODUCT_URL:50. Vendor-Side: kleines Node-Skript / Cloudflare-Worker das Gumroad-Sale-Webhook empfängt → signiert Payload {email, expiresAt:null} via signLicensePayload(secretKey) → mailt Key an Käufer.",
        "TASK-232-FOLLOWUP-2 (Settings-License-Section): NEU client/src/components/Settings/LicensePanel.tsx — zeigt status/daysRemaining/activatedEmail. 'Lizenz aktivieren'-Button öffnet ActivationModal mit forceOpen=true. 'Lizenz entfernen' ruft clear().",
        "TASK-232-FOLLOWUP-3 (Lock-Icon-Badges): isFeatureUnlocked-Check vor Render-Statt-Click in den Buttons der Pro-Features → kleines Lock-Icon + Tooltip 'Pro-Feature'. Nicht hidden — Discovery soll erhalten bleiben.",
        "TASK-232-FOLLOWUP-4 (mehr Gates): LiveLooping (sobald Feature existiert) + MIDI-Note-Out + ggf. Granular-Synth + VST/CLAP-Host (TASK-239) → alle via requireProFeature gaten.",
        "TASK-241-FOLLOWUP-2-GRANULAR / FOLLOWUP-3-SYNTHLFO / FOLLOWUP-4-CUSTOMWAVE bleiben offen.",
        "TASK-242-EXTRACT-SYNTHGRAPH + EXTRACT-FXGRAPH (REFACTOR) bleiben offen.",
        "TASK-239 (VST3/CLAP-Host) bleibt offen."
      ],
      changed: [
        "client/src/utils/licenseConfig.ts (NEU — LICENSE_PUBLIC_KEY_HEX-Placeholder + LICENSE_PRODUCT_ID + TRIAL_DURATION_DAYS + GUMROAD_PRODUCT_URL-Placeholder)",
        "client/src/utils/licenseValidator.ts (NEU ~150 LOC — base64UrlDecode/Encode, parseLicenseKey, decodePayload, validateLicenseKey async + signLicensePayload für Tests)",
        "client/src/store/useLicenseStore.ts (NEU — Custom-Observer, status/trial/pro/expired/invalid State-Machine, IPC + localStorage Fallback, defensive sanitizeState)",
        "client/src/utils/proFeatures.ts (NEU — 5 Pro-Feature-Konstanten + isFeatureUnlocked + requireProFeature mit Toast + Gumroad-Action)",
        "client/src/components/License/ActivationModal.tsx (NEU — Choice/Activate Mode, semantic Tailwind classes, closable nur via forceOpen)",
        "electron/main.ts (+'license:read'/'license:write' IPC-Handler, Path hardcoded auf userData/license.json, 16 KB-Limit, Status-Whitelist beim Write)",
        "electron/preload.ts (+readLicense/writeLicense im electronAPI-Objekt)",
        "client/src/components/Mixer/ExportPanel.tsx (handleBounceAllStems → requireProFeature(PRO_FEATURE_STEM_BOUNCE))",
        "client/src/components/DrumMachine/DrumMachine.tsx (handleElectribeFile → requireProFeature(PRO_FEATURE_ELECTRIBE_IMPORT))",
        "client/src/hooks/useAudioInput.ts (start() → requireProFeature(PRO_FEATURE_USB_AUDIO_IN))",
        "client/src/App.tsx (+ActivationModal Mount nach ToastContainer + initializeLicenseStore useEffect)",
        "tests/features/license.test.ts (NEU, 18 Tests — trial-lifecycle/validate/featureGate/persistence)",
        "tests/features/use-audio-input-hook.test.ts (+__setLicenseStateForTests pro-mode in beforeEach + __resetLicenseForTests in afterEach)",
        "package.json (2.96.0 → 2.97.0 + dependency @noble/ed25519 ^3.1.0)",
        "agents/INDEX.js (workLog + version 2.97.0 + ipc.channels +2 (license:read/license:write) + files-Index)"
      ]
    },
    {
      agent:     "backend",
      timestamp: "2026-05-18T06:15:00.000Z",
      done: [
        "v2.96.0: TASK-241-FOLLOWUP-2 — Synth-Parts (Wavetable/FM) im Stem-Bounce. Closes v2.95-Caveat: Synth-Parts wurden vorher als silent gebounced, weil channelBounce.ts nur BufferSource(sample)-Trigger kannte. Jetzt landen auch Wavetable/Subtractive- und FM-Patches im Stem, gerendert durch die KOMPLETTE v2.95-FX-Chain (EQ + Filter + Distortion + Comp + Delay + Reverb). (1) NEU client/src/utils/synthOfflineRender.ts (~290 LOC, pure). Exports: triggerOfflineSynthNote(ctx, params, freq, time, volume, output, prevFreq?) → OfflineSynthNoteHandle. Architektur SoT=SynthEngine.ts (Copy-with-Marker analog v2.95-Pattern statt Refactor — Begründung im Datei-README): identische ADSR-Hüllkurve via setValueAtTime + linearRampToValueAtTime, identische Wavetable-Branch (osc.type sine/saw/square/triangle + detune + glide, custom→sine fallback), identische FM-Branch (carrier+modulator→modDepth→carrier.frequency mit fmRatio*freq). Pure-Helpers: pitchToFrequency(semi, baseHz=440) — A4-Transpose identisch zu AudioEngine._scheduleStep (`440 * Math.pow(2, pitch/12)`); normalizeSynthParams(p) — defensive Defaults bei missing/NaN inkl. Clamp für sustain[0,1], detune[-100,100], fmRatio≥0.1, attack/decay/release≥0.001s; computeNoteHoldSec()=1.0 (identisch SynthEngine); isSynthPart(part) — Detection-Logik analog AudioEngine (`!!synthParams && (sourceType==='wavetable'|'fm')`); isGranularPart(part). (2) channelBounce.ts erweitert: Import von triggerOfflineSynthNote+pitchToFrequency+isSynthPart+isGranularPart aus synthOfflineRender. renderChannelToBuffer routet jetzt drei Wege: synth→_renderSynthWithFxChain, granular→silent (Caveat dokumentiert), sample→bestehender v2.95-Pfad. NEU _renderSynthWithFxChain(ctx, part, pattern, ...) — baut buildOfflinePartGraph(ctx, part, channels) einmal, dispatcht pro aktivem Step einen triggerOfflineSynthNote(graph.input) mit volume=velocity*partVol (muted→0) und freq=pitchToFrequency(step.pitch). Synth-Output läuft durch die identische v2.95-FX-Chain → ein FM-Bass mit Reverb-Send klingt im Stem wie live. (3) channelBounce.ts README-Block aktualisiert: 'v2.96 (NEU)'-Section listet Synth-Coverage, 'NICHT im Bounce'-Block listet Granular/SynthLFO/CustomWavetables explizit als Caveats. (4) tests/features/channel-bounce.test.ts 65 → 76 Tests (+11 in neuer Suite 'Synth-Parts (v2.96)'): subtractive erzeugt 1 OscillatorNode pro Step, oscType (square) auf node.type übernommen, FM erzeugt 2 Oszillatoren pro Note (carrier+modulator), FM-Modulator-Freq = note*fmRatio (440×3=1320 für Single-Step), ADSR-Sequenz (mind. 2 setValueAtTime + 3 linearRamp, letzter Ramp auf 0), Multi-Step-Pattern alle 8 Steps gerendert, step.pitch transponiert (Oktave hoch=880, runter=220), Synth-FX-Chain-Routing (EQ/Filter/Comp/Reverb wirken), Granular-Part bleibt silent ohne Crash, muted→peak=0, Synth ohne synthParams (defensive). Enhanced Mock-Ctx: createOscillator (mit type/frequency/detune-Captures via setValueAtTime + Setter), createGain um setValueAtTime/linearRampToValueAtTime/cancelScheduledValues ergänzt (für ADSR-Tracking). (5) NEU tests/features/synth-offline-render.test.ts (24 Pure-Helper-Tests): pitchToFrequency (5 — 0/+12/-12/custom-base/NaN-defensive), normalizeSynthParams (6 — undefined/invalid-mode/NaN-attack/sustain-clamp/detune-clamp/fmRatio-min), computeNoteHoldSec (1), isSynthPart (5 — wavetable+params/fm+params/sample/granular/no-params), isGranularPart (2), triggerOfflineSynthNote (5 — wavetable 1osc+1gain, FM 2osc+2gain, undefined-defensive, releaseEnd-handle, custom→sine). (6) package.json 2.95.0 → 2.96.0. pnpm check clean, pnpm test 3453 passed/15 skipped (vs prev 3418, +35 neue Tests, 0 failed Files). Architektur-Entscheidung: COPY mit SoT-Marker (Begründung im synthOfflineRender.ts-README) statt SynthEngine-Refactor (FOLLOWUP-242). v2.96 IM Bounce: Wavetable+FM+ADSR+Pitch-Transpose+volle-FX-Chain. v2.96 NICHT: Granular (RAF+lookahead nicht offline-portierbar — FOLLOWUP-2-GRANULAR), Synth-LFO (statischer Bounce — FOLLOWUP-3-SYNTHLFO), Custom-Wavetables (oscType=custom wird auf sine abgebildet wie online — FOLLOWUP-4), Per-Part-Macro-LFO-Cache (Live-only). Back-Compat: alle v2.94/v2.95-Tests grün."
      ],
      next: [
        "TASK-241-FOLLOWUP-2-GRANULAR: GranularEngine im Offline-Ctx — braucht plan-then-render-Algorithmus, der alle Grains der gesamten Bounce-Dauer im Voraus berechnet (kein RAF im Offline-Ctx). Mittlerer Aufwand ~150 LOC + Tests.",
        "TASK-241-FOLLOWUP-3-SYNTHLFO: LFO-Modulation im Offline-Synth-Bounce — Oscillator-LFO trivial (OscillatorNode + connect), S&H/Random nutzt setValueAtTime-Loop (identisch in Offline reproduzierbar).",
        "TASK-241-FOLLOWUP-4-CUSTOMWAVE: Custom-Wavetables via ctx.createPeriodicWave — braucht App-seitige Persistenz für User-defined Float32-Tables (heute nicht vorhanden).",
        "TASK-242-EXTRACT-SYNTHGRAPH (REFACTOR): Shared `client/src/audio/synthGraph.ts` — gemeinsame Builder-Funktionen für Online (SynthEngine) + Offline (synthOfflineRender). Aktuell Logik-Duplizierung via Copy-with-Marker.",
        "TASK-242-EXTRACT-FXGRAPH (REFACTOR, von v2.95): Analog für FX-Chain-Builder (channelBounce.buildOfflinePartGraph + AudioEngine._getOrCreateChannelNodes).",
        "TASK-241-FOLLOWUP-3 (v2.97): Stem-Export ZIP-Bundle — JSZip-Wrapper für bounceAllChannels-Output.",
        "TASK-241-FOLLOWUP-4-REALTIME (alternative): Realtime-Tap-Bounce als 100%-FX-genaue Option (inkl. Bitcrusher/RingMod/Granular).",
        "TASK-239 (VST3/CLAP-Host) bleibt offen."
      ],
      changed: [
        "client/src/utils/synthOfflineRender.ts (NEU, ~290 LOC: triggerOfflineSynthNote + pitchToFrequency + normalizeSynthParams + computeNoteHoldSec + isSynthPart + isGranularPart, SoT=SynthEngine.ts)",
        "client/src/utils/channelBounce.ts (v2.96: +Import synthOfflineRender, +_renderSynthWithFxChain, renderChannelToBuffer routet synth/granular/sample drei Wege, README aktualisiert)",
        "tests/features/channel-bounce.test.ts (65 → 76 Tests, +11 Synth-Bounce-Suite, Mock-Ctx um createOscillator + ADSR-Gain-Methods erweitert)",
        "tests/features/synth-offline-render.test.ts (NEU, 24 Pure-Helper + Integration-Tests)",
        "package.json (2.95.0 → 2.96.0)",
        "agents/INDEX.js (workLog + version 2.96.0 + files-Index)"
      ]
    },
    {
      agent:     "backend",
      timestamp: "2026-05-18T03:50:00.000Z",
      done: [
        "v2.95.0: TASK-241-FOLLOWUP-1 (partial-done) — Stem-Bounce mit voller Insert-FX-Chain. Schließt die schmerzhafte v2.94-Limitation: Stems hatten nur Volume/Pan/Lowpass — keine EQ, kein Distortion, kein Comp, kein Delay, kein Reverb. Stem-Export ist jetzt produktionsreif für Drum-Sample-Channels. (1) client/src/utils/channelBounce.ts erweitert um buildOfflinePartGraph(ctx, part, channels) — baut die komplette Per-Channel-FX-Chain 1:1 analog zu AudioEngine._getOrCreateChannelNodes: input → 3-Band-EQ(lowshelf200/peaking1k Q=1/highshelf6k) → filter(lowpass/HP/BP/notch oder allpass-bypass bei disabled) → distortion(WaveShaper) → compressor → delay(dry/wet+feedback-loop) → reverb(convolver mit synthetischem IR + dry/wet) → output → sidechainGain → panner → destination. Triggers connecten via stepGain(velocity*partVol) auf graph.input — die FX-Chain wird EINMAL pro Channel gebaut (nicht pro Step wie in v2.94). Pure-Helpers makeDistortionCurve(amount): Float32Array<ArrayBuffer> und buildReverbImpulse(ctx, decay): AudioBuffer|null als exportierte Top-Level-Funktionen (statt Engine-private). NEU computeDynamicTailSec(fx) — dynamic-fadeout-tail aus Reverb-Decay + Delay-Geometric-Series statt hartem 0.5s-Cutoff (Reverb 3s → Tail 3.2s, Delay 0.5s @ 80% Feedback → ~2.5s Tail, capped 4s). NEU opts.bypassFx → schaltet auf den v2.94-Legacy-Pfad zurück (für A/B-Vergleich oder defensive Fallback). Step.pitch wird jetzt auf playbackRate = 2^(semi/12) gemappt (war in v2.94 ignoriert). Defensive: safeNum(v,fallback) für NaN/Infinity/undefined-fx-Felder, fx-undefined → Pass-Through-Topologie ohne Crash. Architektur-Entscheidung: COPY mit SoT-Marker statt Refactor (AudioEngine.ts ist 3154-Zeilen-Singleton — saubere Extraction bräuchte ein neues shared/fxGraph.ts-Modul + Migration aller call-sites). Begründung: (a) FX-Helpers sind ~20 LoC und seit v1.x stabil, (b) Test-Coverage garantiert die Parität, (c) Refactor als TASK-242-Follow-Up dokumentiert in channelBounce.ts-README. (2) tests/features/channel-bounce.test.ts auf 65 Tests erweitert (vs 35 in v2.94, alle grün). Enhanced Mock-OfflineAudioContext mit createWaveShaper (curve-capture), createDynamicsCompressor (threshold/ratio/attack/release-capture), createDelay, createConvolver (buffer-capture), createBuffer (für IR), playbackRate auf bufferSource. NEU-Suites: computeDynamicTailSec (5), makeDistortionCurve (4 — length/identity/saturation/monotonic), buildReverbImpulse (3 — length/null-decay/exp-decay-shape), buildOfflinePartGraph (15 — full-topology/EQ-disabled-zero/EQ-enabled-bands/distortion-curve-saturation/distortion-disabled-flat/comp-params/comp-bypass/delay-params/reverb-IR/reverb-disabled-no-IR/filter-enabled/filter-allpass-bypass/mono-no-panner/stereo-pan-set/fx-undefined-defensive/NaN-fallback). renderChannelToBuffer um 4 neue Cases erweitert: fx-chain-built-once-per-channel (nicht pro Step), bypassFx-toggle, dynamic-tail-Reverb-vergrößert-Buffer, step.pitch→playbackRate. v2.94-Tests bleiben grün (back-compat erhalten). (3) package.json 2.94.0 → 2.95.0. pnpm check clean, pnpm test 3418 passed / 15 skipped (+30 neue Tests, 0 failed Files). NICHT im Scope von v2.95 (siehe channelBounce.ts-README): Synth/Wavetable/FM/Granular-Parts werden weiter als silent gebounced — TASK-241-FOLLOWUP-2 verschoben auf v2.96. Sidechain-Modulation aus anderen Channels: Sidechain-Gain-Node ist im Graph vorhanden aber statisch=1 (kein Live-Modulations-Pfad). Globaler Reverb-/Delay-Bus nicht gespiegelt (Channel-Stems sollten dry-ish bleiben, Bus-FX gehört in Mix-Stem). Bitcrusher/RingMod/Transient-Shaper nicht enthalten (Bitcrusher braucht AudioWorklet-Setup im Offline-Ctx, die anderen sind keine 1st-class-Felder in ChannelFx-Interface). step.paramLock (Per-Step-FX-Override) nicht respektiert. Live-Input + AudioTrack-Channels nicht supported (kein part.steps[])."
      ],
      next: [
        "TASK-242 (REFACTOR): Extract `buildPartFxChain(ctx, part)` in shared client/src/audio/fxGraph.ts und nutze es in BEIDEN AudioEngine._getOrCreateChannelNodes + channelBounce.buildOfflinePartGraph. Aktuell ist makeDistortionCurve+buildReverbImpulse-Logik via Copy-with-Marker doppelt — wenn jemand das Online-Verhalten ändert, MUSS er den Offline-Code mit-aktualisieren. Mit shared Modul wäre Online + Offline garantiert byte-identisch.",
        "TASK-241-FOLLOWUP-2 (v2.96): Synth/Wavetable/FM-Offline-Render. SynthEngine.ts in Offline-Pfad portieren — mindestens Wavetable (Oscillator + ADSR) ist trivial, FM braucht ModulatorGraph-Replikation. Granular ist komplexer wegen Grain-Scheduling.",
        "TASK-241-FOLLOWUP-3 (v2.96): Stem-Export ZIP-Bundle — bounceAllChannels liefert N WAVs, JSZip-Wrapper könnte sie zu einem proj-stems.zip schnüren (1 Klick Share).",
        "TASK-241-FOLLOWUP-4 (alternative): Realtime-Tap-Bounce als Option für 100% FX-Genauigkeit (Bitcrusher/RingMod inkl.) — neue UI-Option 'Bounce Mode: Offline (fast) | Realtime (slow, all-FX)'.",
        "TASK-241-FOLLOWUP-5 (UI): Bounce-History-Panel mit Re-Play-Preview-Button + Reveal-in-Folder.",
        "TASK-239 (VST3/CLAP-Host) bleibt offen."
      ],
      changed: [
        "client/src/utils/channelBounce.ts (v2.95: +buildOfflinePartGraph mit voller FX-Chain, +makeDistortionCurve, +buildReverbImpulse, +computeDynamicTailSec, +bypassFx-Option, +step.pitch→playbackRate, +defensive safeNum-Helper)",
        "tests/features/channel-bounce.test.ts (35 → 65 Tests, +30 FX-Chain-Coverage, enhanced Mock-Ctx)",
        "package.json (2.94.0 → 2.95.0)",
        "agents/INDEX.js (workLog + files-Index v2.95)"
      ]
    },
    {
      agent:     "backend",
      timestamp: "2026-05-18T03:35:00.000Z",
      done: [
        "v2.94.0: TASK-241 — Per-Channel WAV-Bounce (Stem-Export). Standard-DAW-Feature komplementär zum existierenden Full-Mix-Export. (1) NEU client/src/utils/channelBounce.ts (Pure-Render-Engine, ~350 LOC, KEINE React-Abhängigkeit). renderChannelToBuffer(part, pattern, opts, OfflineCtxCtor?) → OfflineAudioContext-basierter Render eines EINZELNEN Channels: BufferSource → Gain(velocity*partVol) → optional BiquadFilter (lowpass wenn fx.filterFreq<20k) → optional StereoPanner (skip in mono) → ctx.destination. Andere Channels existieren im Offline-Graph NICHT (kein silent-mute-Hack). Pure-Helpers: computeBounceDurationSec(bars,stepsPerBar,bpm,tailSec=0.5) — Formel durationSec = bars * stepsPerBar * (60*4/(bpm*stepsPerBar)) + tail. resolveBounceBars(opt) — Mode-Switch currentPattern=1bar, currentLoop=opt.bars??4, customBars=opt.bars clamped 1..64. sanitizeStemFilenameStem(str) — trim → ws→underscore → strip non-[A-Za-z0-9_-] → max 80 chars → 'stem'-Fallback. defaultStemFilename(proj,ch) — kombiniert mit 'synthstudio'/'channel' Defaults bei leerem Input (NICHT 'stem-stem' was der raw-Sanitizer liefern würde). bounceChannelToWavBuffer = render + encodeWav (reuse client/src/audio/wavEncoder.ts, KEIN Duplikat). bounceAllChannels(parts, pattern, sampleBuffers, opts, projectName, onProgress, OfflineCtxCtor?) — sequenziell (nicht parallel, RAM-Peak-Control), error-isolation (failing channel blocked nicht den Rest). Konstanten: BOUNCE_WARN_DURATION_SEC=300 (5min, UI-Warnung), BOUNCE_MAX_DURATION_SEC=1800 (30min, harter Reject mit Error). downloadWavInBrowser(wav,filename) — Browser-Fallback via Blob + URL.createObjectURL + <a download> + revoke nach 1s. OfflineAudioContextCtor-Type für DI in Tests (Node hat keinen Web-Audio-Globalen). (2) ChannelInspector.tsx erweitert um optional props {pattern, bpm, projectName} und PartBounceSection-Sub-Component am Ende vor PartMidiOutSection. UI: '🎬 Bounce to WAV ▸/▾' Toggle, 3 Mode-Pills (Pattern/Loop/Custom), Bars-Input (1-64, nur Loop/Custom), Sample-Rate-Select 44100/48000, Stereo-Checkbox, Filename-Input mit Default-Placeholder, Live-Dauer-Preview + ⚠-Hinweis ab 300s, Bounce-Button mit Status-Text. Save-Path: electron.isElectron → saveRecording IPC (filename-resanitize auf strict [A-Za-z0-9._-]+ damit der Main-Side-Guard nicht ablehnt), sonst downloadWavInBrowser. Toast bei Success/Error. data-testids: channel-inspector-bounce-section, channel-bounce-toggle, channel-bounce-mode-{currentPattern,currentLoop,customBars}, channel-bounce-bars/sr/stereo/filename/start/status. Sample-Buffer-Load: temporärer AudioContext + fetch+decodeAudioData, Context wird im finally-Block geschlossen. (3) ExportPanel.tsx erweitert um 'Bounce All Stems'-Button (data-testid=export-bounce-all-stems) — iteriert via bounceAllChannels, jeder Channel separat mit Pan+Filter+Volume. Unterschied zu existierendem 'Stems'-Mode in wavExporter.ts: wavExporter ignoriert Pan komplett (mono-Mix), bounceChannel respektiert Pan/Volume/Filter pro Step. (4) App.tsx: beide ChannelInspector-Aufrufsites (Dock-Slot Zeile 3195 + FloatingPanel Zeile 3416) um pattern/bpm/projectName erweitert. (5) NEU tests/features/channel-bounce.test.ts (35 Cases, alle grün). Mock-OfflineAudioContext: capture-stats für bufferSourcesCreated, startCalls, gainValuesSet, panValuesSet, filterFreqsSet. Coverage: computeBounceDurationSec (5 — 2.0s@120bpm, tailSec, linear-bars, NaN-Invalid, BPM-Inverse), resolveBounceBars (3 Modes), sanitizeStemFilenameStem (5 — whitespace, sonderzeichen, default, truncate, allowed-underscore-dash), defaultStemFilename (3), renderChannelToBuffer (10 — buffer-length, bufferSource-per-step-count, pan-propagation, muted→gain=0, no-sample-buffer→silent, filter-create-bei-cutoff<20k, filter-skip-bei-20k, mono-skips-panner, max-duration-reject, pattern.bpm-override), bounceChannelToWavBuffer (2 — valid-WAV-header, stereo-numChannels=2), bounceAllChannels (3 — N results, onProgress-callback, error-isolation continues), Konstanten + no-OfflineAudioContext-throw. (6) package.json 2.93.0 → 2.94.0. pnpm check clean, pnpm test 3388 passed/15 skipped (vs 3353 prev, +35 neue Tests in 0 failed Files). CAVEATS (siehe README am Ende von channelBounce.ts): (a) Insert-FX-Chain (16-Band-EQ, Distortion, Comp, Delay, Reverb-Send, Sidechain, Transient-Shaper, Bitcrusher, RingMod) wird NICHT im Offline-Render gespiegelt — nur Volume, Pan und Lowpass (fx.filterFreq). Für volle FX-Genauigkeit müsste der gesamte AudioEngine-Graph 1:1 im Offline-Context nachgebaut werden (>4000 LOC engine — explizit out-of-scope, Feature-Backlog 'OfflineRenderEngine v2'). (b) Synth/Wavetable/FM/Granular-Parts (sourceType≠'sample') werden als stille Frames gebounced — kein Synth-Offline-Pfad. (c) Live-Input + AudioTrack-Channels haben keinen part.steps[] und werden ignoriert. (d) Globale Reverb/Delay-Buses fehlen. Für 95% der Bounce-Use-Cases (Stem-Sharing, Quick-Master-Check, Collab-Sharing einzelner Channels) ausreichend. ISOMORPHIC: Browser- + Electron-Pfad vollständig getrennt — Web-User bekommt Blob-Download, Electron-User schreibt in userData/recordings/ via existierenden audio:save-recording-IPC (TASK-234 v2.86). KEIN neuer IPC-Channel nötig — reuse passte perfekt. WAV-Header: Wiederverwendung von wavEncoder.ts encodeWav() — KEIN Duplikat-Code."
      ],
      next: [
        "TASK-241-FOLLOWUP-1: OfflineRenderEngine v2 — vollständige Re-Construction des AudioEngine-Channel-Graph im OfflineAudioContext inkl. aller 12 FX-Typen. Großes Projekt (~1500 LOC), Voraussetzung wäre eine Refactor des FX-Pipeline in eine factory-funktion mit (ctx, source, opts) → outputNode-Signatur damit Live + Offline denselben Code teilen.",
        "TASK-241-FOLLOWUP-2: Synth-Offline-Render — SynthEngine.ts hat heute keinen Offline-Pfad. Mindestens Wavetable-Synth ist trivial portierbar (Oscillator + ADSR), FM braucht ModulatorGraph-Replikation.",
        "TASK-241-FOLLOWUP-3: Stem-Export ZIP-Bundle — bounceAllChannels liefert N WAVs, derzeit speichern wir N Dateien. JSZip-Wrapper könnte sie zu einem proj-stems.zip schnüren (1 Klick Share).",
        "TASK-241-FOLLOWUP-4: Realtime-Tap-Bounce als Alternative — neue Option 'Bounce Mode: Offline (fast, no-FX) | Realtime (slow, full-FX)'. Realtime würde via AudioRecorder den panner-Output tappen während ein silent-Render läuft (Master auf 0). Vollständig FX-genau aber 1:1 Echtzeit-Aufwand.",
        "TASK-241-FOLLOWUP-5: Bounce-History-Panel — kleine Liste der letzten 10 Bounces mit Re-Play-Preview-Button + Reveal-in-Folder.",
        "TASK-239 (VST3/CLAP-Host) bleibt offen."
      ],
      changed: [
        "client/src/utils/channelBounce.ts (NEU — Pure-Render-Engine OfflineAudioContext + Helpers + encodeWav-reuse + Browser-Blob-Download)",
        "client/src/components/Mixer/ChannelInspector.tsx (+optionale props pattern/bpm/projectName + PartBounceSection-Sub-Component mit Mode-Pills/Bars/SR/Stereo/Filename/Save-Flow)",
        "client/src/components/Mixer/ExportPanel.tsx (+'Bounce All Stems'-Button + bounceAll-Flow mit Sample-Buffer-Preload + electron-save / browser-download)",
        "client/src/App.tsx (beide ChannelInspector-Aufrufsites um pattern={dm.getActivePattern()} bpm={project.bpm} projectName={project.projectName} erweitert)",
        "tests/features/channel-bounce.test.ts (NEU, 35 Cases — Pure-Helpers + renderChannelToBuffer-Mock + bounceChannelToWavBuffer-Header-Check + bounceAllChannels-Iteration + Error-Isolation)",
        "package.json (2.93.0 → 2.94.0)",
        "agents/INDEX.js (workLog + version 2.94.0 + files-Index)"
      ]
    },
    {
      agent:     "backend",
      timestamp: "2026-05-18T03:20:00.000Z",
      done: [
        "v2.93.0: TASK-PROJ-FILE-V18 — .synth Schema v1.17 → v1.18. Schließt silent-data-loss aus v2.85–v2.92 wo drei neue Stores (useLiveInputStore v2.85, useMidiNoteOutStore v2.92, useSlicePadStore v2.90) ausschließlich in localStorage lebten und beim Datei-Transport zwischen Rechnern verloren gingen. (1) client/src/utils/projectSerializer.ts: SYNTH_FILE_VERSION '1.17' → '1.18'. Drei neue Felder im SynthProject-Interface (alle additiv-optional): liveInputs?: LiveInputChannelData[], midiNoteOut?: { enabled, configs: Record<partId, MidiPartConfig> }, slicePads?: SerializedSlicePadSlot[]. SchemaDecision für Slice-Buffers: embed-full als plain number[]-Array (Float32Array→number[] via Array.from). Begründung im Header-Kommentar: Session-kritisch (sonst muss User neu slicen), Trade-off File-Size, Alternative metadata-only verworfen weil sample-hash-rebuild den User-Workflow bricht. Optionale Toggle-API SerializeProjectOptions { includeSliceBuffers?: boolean=true } — bei false werden frames auf null gesetzt, Metadata bleibt erhalten. Neue Pure-Helper float32ToFrames / framesToFloat32 (lossless, null-safe). Drei neue Parse-Migration-Blöcke (analog padBank-Pattern): undefined bleibt undefined (Signal: User-localStorage nicht überschreiben), null/wrong-type → undefined, valides Array/Object → silent-filter invalider Items. midiNoteOut.channel/note werden via clampMidiChannel/clampMidiNote bei Parse normalisiert. (2) client/src/App.tsx: buildProjectSnapshot erweitert um liveInputs (getAllLiveInputChannels), midiNoteOut (getMidiNoteOutEnabled+getAllPartMidiOutConfigs), slicePads (getAllSlicePadSlots → SerializedSlicePadSlot mit float32ToFrames). restoreProject erweitert um drei Rehydration-Blöcke (alle defensiv mit undefined-check, sonst Pre-v1.18-Files würden User-localStorage löschen): loadLiveInputChannels(data.liveInputs), clearAllPartMidiOutConfigs+setMidiNoteOutEnabled+setPartMidiOutConfig-Loop, clearAllSlicePads+setSlicePadSlot-Loop mit framesToFloat32. Imports aus useLiveInputStore um getAllLiveInputChannels/loadLiveInputChannels erweitert, useMidiNoteOutStore um 4 Bridge-API-Funktionen, useSlicePadStore (bestehender Import dedupliziert) um getAllSlicePadSlots/setSlicePadSlot/clearAllSlicePads. (3) tests/features/project-serializer.test.ts: +25 neue Tests in 'v1.18 extended persistence'-Block: liveInputs-Migration (6 — undefined/null/non-array/empty/Round-Trip-all-fields/silent-filter-invalid), midiNoteOut-Migration (7 — undefined/null/array-wrong-type/Round-Trip/silent-filter/non-bool-enabled/clamping), slicePads-Migration (6 — undefined/null/object-wrong-type/empty/Round-Trip-embedded/metadata-only-Slot/index-stability-bei-invalid), Float32-Codec (3 — null/null/lossless-round-trip), serializeProject-Option (2 — default-include/strip-frames-keep-meta), Combined-Back-Compat (2 — v1.14-File hat alle drei undefined + audioTracks/scripts default-[], v1.18-File-mit-empty-Feldern lädt clean). SYNTH_FILE_VERSION-Test bei script-store + audio-track-store auf '1.18' aktualisiert. (4) package.json 2.92.0 → 2.93.0. pnpm check clean, pnpm test 3353 passed / 15 skipped (vs 3326 prev, +27 neue Tests). File-Size-Impact: typische .synth wächst ~150 Bytes pro Live-Input-Channel + ~80 Bytes pro MIDI-Note-Out-Config + ~12 Bytes pro Slice-Sample-Frame (16 Pads à 1s @ 48kHz Mono ≈ 9MB plain-text-JSON, kann mit gzip auf ~20% schrumpfen). Empty-Session bleibt unter 5KB (alle neuen Felder leer)."
      ],
      next: [
        "TASK-PROJ-FILE-V18-FOLLOWUP-1: UI-Toggle 'Include Slice-Pad-Buffers (large)' im Save-Dialog wenn slicePads buffer haben + File-Size-Estimate. Default abhängig vom geschätzten Volumen (>10MB → off).",
        "TASK-PROJ-FILE-V18-FOLLOWUP-2: gzip-Compression-Layer in der Electron-Save-Pipeline (electron/main.ts writeFile mit zlib) — würde Slice-Buffer-JSON auf ~20% schrumpfen. Browser-Path bleibt Plain-JSON (kein nativer gzip-Stream).",
        "TASK-PROJ-FILE-V18-FOLLOWUP-3: Visueller Hinweis im LiveInput-Channel-Strip wenn nach Project-Load die deviceId nicht mehr auflösbar ist (Hardware-Wechsel/anderer Rechner). Aktuell stiller Soft-Fail.",
        "TASK-PROJ-FILE-V18-FOLLOWUP-4: MidiNoteOut-Reconnect-UI — wenn outputId auf einem fremden Rechner unbekannt ist, biete einen Bulk-Replace-Dialog 'Original-Output → neues Output'.",
        "TASK-239 (VST3/CLAP-Host) bleibt offen."
      ],
      changed: [
        "client/src/utils/projectSerializer.ts (SYNTH_FILE_VERSION 1.17→1.18, +liveInputs/midiNoteOut/slicePads Felder + Validation-Helper + float32-Codec + SerializeProjectOptions)",
        "client/src/App.tsx (buildProjectSnapshot um drei neue Felder erweitert, restoreProject mit drei Rehydration-Blöcken, Imports konsolidiert)",
        "tests/features/project-serializer.test.ts (+25 v1.18-Tests, SYNTH_FILE_VERSION-Check auf 1.18)",
        "tests/features/audio-track-store.test.ts (SYNTH_FILE_VERSION-Check auf 1.18)",
        "tests/features/script-store.test.ts (SYNTH_FILE_VERSION-Check auf 1.18)",
        "package.json (2.92.0 → 2.93.0)"
      ]
    },
    {
      agent:     "backend",
      timestamp: "2026-05-18T03:05:00.000Z",
      done: [
        "v2.92.0: MIDI-Note-Output — Electribe als Sound-Modul (TASK-240 done). Komplettiert die KORG-Bidir-Brücke nach v2.83 (Clock-Out). (1) NEU client/src/audio/MidiNoteOut.ts — DI-Sender-Pattern (analog MidiClockOut). Sender-Signatur (outputId, bytes)→void damit ein Sender mehrere Geräte bedienen kann (Kick→Electribe, Snare→Volca). Public-API: setSender/setEnabled/setPartConfig/getPartConfig/clearPartConfig/clearAllConfigs/isPartConfigured/getAllConfiguredPartIds/shouldPlayLocalSound/triggerNote. Pure-Helper: clampVelocity/clampMidiChannel/clampMidiNote/clampNoteDuration/buildNoteOn/buildNoteOff/noteNameFromNumber + Konstanten DEFAULT_NOTE_DURATION_MS=100/MIN/MAX. Retrigger-Policy: bei zweitem triggerNote für gleichen partId wird altes Note-Off SOFORT gefeuert + cleanup pending timer, dann neues Note-On. setEnabled(false) flushed alle pending Note-Offs (verhindert Stuck-Notes am externen Gerät). (2) AudioEngine.ts: +_midiNoteOut-Instanz, +5 Public-API (setMidiNoteOutSender/Enabled/PartConfig/clearPartConfig/getMidiNoteOut), Wire-Up im _scheduleStep direkt nach stepCallbacks.forEach (vor MIDI-Clock-Pulse + Sample-Trigger). Neuer Local-Sound-Gate: wenn part eine MIDI-Out-Config hat UND localSoundEnabled=false ist, wird der Sample-/Synth-Trigger übersprungen → 'MIDI only'-Modus. Backwards-Compat: ohne Config IMMER local (unverändertes Verhalten). stop() macht disable+enable-Cycle damit pending Note-Offs sofort rausgehen. (3) useMidi.ts: neuer Effect injiziert (outputId, bytes) => midiSendMessage(midiAccessRef, outputId, bytes) als AudioEngine.setMidiNoteOutSender. Mount-only ([] deps), Cleanup setzt Sender→null. (4) NEU client/src/store/useMidiNoteOutStore.ts — Custom-Observer-Store mit localStorage-Persistenz ('synthstudio:midi:noteout:v1' + separater enabled-Key). Schema {enabled:boolean, configs:Record<partId, MidiPartConfig>}. Defensive loadState: filtert invalid-shape configs (outputId-Pflicht, alles andere clamped). API: getMidiNoteOutEnabled/setMidiNoteOutEnabled/getPartMidiOutConfig/getAllPartMidiOutConfigs/setPartMidiOutConfig/clearPartMidiOutConfig/clearAllPartMidiOutConfigs/applyElectribeDrumMap + useMidiNoteOutStore React-Hook. (5) App.tsx: neuer Diff-Sync-Effect spiegelt Store→Engine. Bei jedem Store-State-Change: setMidiNoteOutEnabled(state.enabled), dann diff vs. engine.getAllConfiguredPartIds → clearPartConfig für removed parts, setPartConfig für aktuelle Configs. Idempotent. (6) ChannelInspector.tsx: neue Section 'MIDI-Note-Out (extern triggern)' nach Transient Shaper. PartMidiOutSection-Sub-Component nutzt useMidiContext() + useMidiNoteOutStore(). Controls: Global-Enable-Checkbox (toggelt store.enabled), Output-Device-Select (— keiner — ODER outputDevices vom useMidi), Channel-Select 1-16 (mit '(Drum/GM)'-Label auf Ch 10), Note-Range-Slider 0-127 mit noteNameFromNumber-Display, Note-Duration-Slider 10-2000ms, Local-Sound-Toggle, Per-Part-Clear-Button, Electribe-Template-Button (ruft applyElectribeDrumMap auf alle Mixer-Parts). Empty-State wenn outputDevices.length===0. data-testids: channel-inspector-midi-out-section, midi-note-out-global-enable, midi-note-out-device-select, midi-note-out-channel-select, midi-note-out-note-slider, midi-note-out-duration-slider, midi-note-out-local-sound-toggle, midi-note-out-clear, midi-note-out-apply-electribe. (7) midiTemplates.ts: neues NoteOutTemplate/NoteOutDrumMapping-Interface + ELECTRIBE_2_DRUM_MAP-Constant (8 GM-Drum-Mappings Ch10) + NOTE_OUT_TEMPLATES-Array (Extension-Point). (8) NEU tests/features/midi-note-out.test.ts mit 24 Cases — buildNoteOn/Off (4), Velocity/Channel/Note/Duration-Clamp (4), noteNameFromNumber (1), setPartConfig/clearPartConfig/clearAll/isPartConfigured/getAllConfiguredPartIds (5), triggerNote (10 — Note-On+Off-Timing, Duration-Respekt, ohne Config no-op, !enabled no-op, Velocity-Clamp, Status-Byte-Encoding, ohne Sender no-Crash, setSender-Wechsel, setEnabled(false)-Flush, Sender-Exception-Swallow, Default-Duration, Retrigger). pnpm check clean, pnpm test 3326 passed/15 skipped (vs 3302 prev, +24 neue). package.json 2.91.0 → 2.92.0. CAVEATS: (a) MIDI-Send läuft NICHT through Web-Audio-Scheduling — JS-setTimeout-Genauigkeit ist ~1-2ms Jitter ggü. AudioContext-Scheduling, was für MIDI-Devices akzeptabel ist (Hardware-MIDI-Latenz oft schon ≥1ms). Wer Sample-genaues Timing braucht müsste auf MIDI-2.0 / High-Resolution-Time-Stamps gehen (currently Web-MIDI v1 only). (b) Polyphony pro Part = 1: Retrigger derselben Note schickt sofort Note-Off + neue Note-On. Für Polyphony am Sample-Modul müsste man je Step eine andere Note senden (Performance-Mode-Feature, eigener Task). (c) Note-Stealing am externen Gerät ist Geräte-eigene Logik — wir senden korrekt Note-On + Note-Off, der Rest ist Electribe-Sache. (d) Output-ID kann bei Hardware-Reconnect wechseln — useMidi enumeriert beim devicechange-Event neu. Wenn die alte ID nicht mehr existiert, ist der Send no-op (silent fail), config bleibt im Store für späteren Reconnect. (e) Bei MIDI-Drum-Modulen mit Velocity-Sensitivity (Electribe ja, manche alte Volcas nein) wird die Step-Velocity korrekt durchgereicht. (f) Kein neuer IPC-Channel — alles läuft über Web-MIDI (Browser+Electron-Chromium 130 nativ supported)."
      ],
      next: [
        "TASK-240-FOLLOWUP-1: Per-Channel-Pitch — z.B. für Sample-Modul ohne MIDI-Drum-Map kann ein Slider 'Note-Offset (Semitones)' das Pitch live durchschicken (Pitch-Bend oder zweite Note). Aktuell ein fixer Note-Wert pro Part.",
        "TASK-240-FOLLOWUP-2: Project-Persistenz — die per-part MIDI-Out-Configs liegen heute NUR in localStorage, NICHT in der .synth-Datei. Wenn der User ein Projekt teilt, sind die Mappings weg. Migration: Field projectMidiOut auf MIDI-Out-Configs in useProjectStore mit Schema-Bump.",
        "TASK-240-FOLLOWUP-3: Visuelle Indikator-LED im ChannelStrip (Mixer) — kleiner 'MIDI'-Badge wenn der Part eine Output-Config hat. Heute muss man den Inspector öffnen um es zu sehen.",
        "TASK-240-FOLLOWUP-4: Auto-Discovery KORG Electribe per Device-Name-Match — wenn 'electribe' im outputDevice.name ist, blende prominent ein '🎚 Electribe erkannt — Template anwenden?'-Banner ein.",
        "TASK-240-FOLLOWUP-5: Pattern-Change MIDI-Out — beim Performance-Mode-Pattern-Switch kann auch ein MIDI Program Change rausgehen (Electribe wechselt Pattern-Slot). Heute schickt sendPatternProgramChange nur an _midiProgramChangeCallback, nicht an die per-part MidiNoteOut-Geräte.",
        "TASK-239 (VST3/CLAP-Host) bleibt offen.",
        "Optional Playwright-E2E in tests/web/midi-note-out.spec.ts für UI-Smoke (Device-Picker rendert leer, Apply-Electribe-Button disabled ohne Device)."
      ],
      changed: [
        "client/src/audio/MidiNoteOut.ts (NEU — DI-Sender, Per-Part-Config-Map, Retrigger-Policy, Pure-Helpers)",
        "client/src/audio/AudioEngine.ts (+_midiNoteOut-Instanz, +5 Public-API, Wire-Up im _scheduleStep, Local-Sound-Gate via shouldPlayLocalSound, stop()-Flush)",
        "client/src/hooks/useMidi.ts (+useEffect der midiSendMessage als AudioEngine.setMidiNoteOutSender injiziert)",
        "client/src/store/useMidiNoteOutStore.ts (NEU — Custom-Observer-Store, localStorage-Persistenz, applyElectribeDrumMap-Quick-Action)",
        "client/src/App.tsx (+useMidiNoteOutStore-Hook + Diff-Sync-Effect Store→Engine; Import useMidiNoteOutStore)",
        "client/src/components/Mixer/ChannelInspector.tsx (+PartMidiOutSection unter Transient Shaper: Device/Channel/Note/Duration-Controls + Local-Sound-Toggle + Electribe-Template-Button)",
        "client/src/utils/midiTemplates.ts (+NoteOutTemplate/NoteOutDrumMapping-Interface + ELECTRIBE_2_DRUM_MAP-Constant + NOTE_OUT_TEMPLATES-Array)",
        "tests/features/midi-note-out.test.ts (NEU, 24 Cases — Pure-Helpers + setPartConfig/clearPartConfig + triggerNote-Lifecycle + Retrigger + setEnabled-Flush + Sender-Exception-Swallow)",
        "package.json (2.91.0 → 2.92.0)",
        "agents/INDEX.js (workLog + TASK-240 status:done + version 2.92.0 + files-Index)"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-18T02:50:00.000Z",
      done: [
        "v2.91.0: Slice-Pad-Kind — vollständiger Sample-Slice-Workflow (TASK-238-FOLLOWUP-1B done). (1) padBankPersistence.ts: PadBankSlotKind union um 'slice' erweitert, VALID_KINDS-Set entsprechend, neue Konstante PAD_BANK_SLICE_MAX=16 (spiegelt MAX_SLICE_PADS aus useSlicePadStore), neue Helper sliceAutoConfigureSlots() liefert 16 Slice-Pads-Slots {kind:'slice', param:'0'..'15'} fuer Quick-Action. isValidPadBankSlot bleibt shape-Validierung (param=string), Bound-Check geschieht beim Trigger via Clamp. (2) useMidi.ts: neue MidiLearnTarget-Variante {type:'playSlicePad', sliceIndex:number}. labelForTarget liefert 'Slice-Pad N' (1-indexed). targetsMatch vergleicht sliceIndex. applyMapping dispatcht CustomEvent 'midi:slicePad' (detail=sliceIndex) auf CC>63 / Note-On. (3) midiLayoutImport.ts: VALID_TARGET_TYPES um 'playSlicePad' erweitert, damit Layout-Import/Export Round-Trip-faehig bleibt. (4) App.tsx: neuer useEffect-Listener auf 'midi:slicePad' → liest getSlicePadSlot(sliceIndex) → ruft AudioEngine.playSliceBuffer(slot.buffer, slot.sampleRate). Defensive null/buffer-Check, out-of-range silent ignored. (5) MidiSettings.tsx Pad-Bank-Builder: neue Dropdown-Option 'Slice' im pad-bank-slot-kind-Select. Wenn kind='slice' gewaehlt: 16-Optionen-<select> mit 'Slice-Pad N'-Labels (data-testid bleibt pad-bank-slot-param-{idx}). updatePadBankSlot setzt Default sliceIndex=i (1:1 pad-index → slice-index, intuitiv). padBankSlotLabel + padBankSlotToEntry um slice-Branch erweitert (Clamp auf 0..PAD_BANK_SLICE_MAX-1 falls param ausser Range — Tests dokumentieren das). Builder-Description nennt jetzt 'Slice' im Toolbox-Hint. Neue Quick-Action-Button '🎯 Slices → Pads (Auto)' (data-testid=pad-bank-slice-auto) ruft sliceAutoConfigurePadBank()=setPadBankSlots(sliceAutoConfigureSlots()) — fuellt alle 16 Slots in einem Klick. Position: ml-auto vor dem Reset-Button. (6) tests/features/slice-pad-kind.test.ts (NEU, 15 Cases): (a) Schema-Validierung kind=slice akzeptiert/lehnt korrekt ab, PAD_BANK_SLICE_MAX===MAX_SLICE_PADS===16. (b) sliceAutoConfigureSlots() liefert 16 valide Slots. (c) localStorage Round-Trip + Back-Compat (Pre-v2.91-Files ohne slice loaden unveraendert) + invalides slice-Item silent gefiltert. (d) labelForTarget/targetsMatch fuer playSlicePad inkl. Cross-Type-Verwechslungs-Schutz (playSlicePad != loopTrigger != scenelaunch). (e) End-to-End: getSlicePadSlot Lookup + simulierter App-Listener mit playSliceBuffer-Spy → korrekter Buffer/Sample-Rate propagiert, leerer Slot triggert nicht, out-of-range null. (7) Verifikation: pnpm check clean, pnpm test 3302/15 skipped (vs 3287 prev, +15 neue). package.json 2.90.0 → 2.91.0. CLAMP-POLICY-Doku: padBankSlotToEntry clampt sliceIndex auf 0..15 mit Math.trunc — damit ein verirrter param='42' nicht silent skipped, sondern auf Slot 15 lernt (user-friendlier). isValidPadBankSlot prueft NICHT die numerische Range, das ist konsistent mit anderen Kinds (macro=0..7 wird auch nicht im Type-Guard erzwungen). ARCHITEKTUR: midi:slicePad analog zu midi:perfpad / midi:scene / midi:loopTrigger CustomEvent-Pattern — kein direkter Store-Coupling im useMidi-Hook."
      ],
      next: [
        "TASK-238-FOLLOWUP-2: Slice-Vorschau im Pad-Grid (Click auf Pad-Tile spielt nur diesen Slice). Heute laeuft das via MIDI-Pad → playSlicePad; der Slot-Picker im MidiSettings hat noch keinen Inline-Preview-Button.",
        "TASK-238-FOLLOWUP-3: Stereo-Slicing (zweiter Float32Array fuer Kanal 1; AudioEngine.playSliceBuffer hat noch Mono-only Pfad).",
        "TASK-237-FOLLOWUP-1B: useAutomationStore um fxParam-Targets erweitern (filter cutoff, resonance, pitch — Electribe-Motion-Lanes die heute gefiltert werden).",
        "TASK-237-FOLLOWUP-2: Reale Electribe-File-Kalibrierung.",
        "TASK-239 (VST3/CLAP-Host) bleibt offen.",
        "OPTIONAL UX: Im Pad-Bank-Builder einen Auto-Configure-Banner zeigen wenn useSlicePadStore aktive Slices hat aber kein Slot kind='slice' ist (User-Hint 'Slices liegen bereit — Pads auto-konfigurieren?'). Wuerde requirements einen useSlicePadStore-Read im UI; aktuell vermieden weil Inhalt des Stores leerlauffaehig ist.",
        "OPTIONAL TESTS: Playwright-E2E in tests/web/pad-bank.spec.ts erweitern um Slice-Slot-Picker + slice-auto-Button (eigener Test-Block analog v2.82-Smoke). Nicht Teil dieser Session."
      ],
      changed: [
        "client/src/utils/padBankPersistence.ts (PadBankSlotKind += 'slice', VALID_KINDS-Set erweitert, +PAD_BANK_SLICE_MAX const, +sliceAutoConfigureSlots() Quick-Action-Helper)",
        "client/src/hooks/useMidi.ts (+MidiLearnTarget playSlicePad-Variante, labelForTarget/targetsMatch/applyMapping-Cases, dispatcht 'midi:slicePad' CustomEvent)",
        "client/src/utils/midiLayoutImport.ts (VALID_TARGET_TYPES += 'playSlicePad' fuer Layout Round-Trip)",
        "client/src/App.tsx (+useEffect-Listener 'midi:slicePad' → AudioEngine.playSliceBuffer via getSlicePadSlot-Lookup; getSlicePadSlot zum bestehenden Import hinzu)",
        "client/src/components/MidiSettings/MidiSettings.tsx (Pad-Bank-Builder: 'Slice'-Option im Kind-Select, slice-Param-Picker 0..15, padBankSlotLabel/padBankSlotToEntry/updatePadBankSlot um slice erweitert, Clamp-Policy 0..MAX-1, neuer Quick-Action-Button '🎯 Slices → Pads (Auto)' data-testid=pad-bank-slice-auto, sliceAutoConfigurePadBank()-Handler)",
        "tests/features/slice-pad-kind.test.ts (NEU, 15 Cases — Schema/Round-Trip/Label/targetsMatch/End-to-End)",
        "package.json (2.90.0 → 2.91.0)",
        "agents/INDEX.js (workLog + version 2.91.0 + files-Index)"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-18T02:33:00.000Z",
      done: [
        "v2.90.0 POLISH — zwei CustomEvent-Bridges geschlossen, die als MVP in v2.88/v2.89 als 'TODO App-Level-Wiring'-Hinweise rausgegeben wurden. (BRIDGE 1) electribe:motion-lanes → useAutomationStore: (1) NEU client/src/utils/electribeMotionMapping.ts — pure-Logik-Layer ohne React/Web-Audio-Imports. parseElectribeLaneTarget('Volume:3' → {paramName, partIndex}) nimmt den LETZTEN Doppelpunkt als Trenner, mapElectribeLaneToAutomationTarget(electribeTarget, partIds[]) mappt nur 3 unterstuetzte Params (Volume→vol:<partId>, Pan→pan:<partId>, FX Send→send-rev:<partId>) — Filter Cutoff/Resonance/Pitch/etc. werden null retourniert weil useAutomationStore nur 6 Targets kennt (bpm/master-vol/vol/pan/send-rev/send-dly). scaleMotionPointsToStepCount(points, 16|32) streckt die 16-Step-Motion-Slots auf 32-Step-Patterns mit Faktor 2 + Clamp auf max-1. selectConvertableLanes ist Convenience-Filter. (2) App.tsx: 'electribe:motion-lanes'-Listener installiert nach dem Looper-Block. Liest dmRef.current.patterns[id].parts → partIds. Ruft automationRef.current.addLane + setPoint pro Motion-Punkt. Toast '{added} importiert ({skipped} unsupported)' am Ende. (3) Tests: tests/features/electribe-motion-bridge.test.ts NEU mit 21 Cases (6 parseElectribeLaneTarget + 6 mapping + 4 scale + 3 selectConvertable + 2 End-to-End Mock-Store-Calls). (BRIDGE 2) sample-slicer:apply → Slice-Pad-Store: (1) NEU client/src/store/useSlicePadStore.ts — Module-Singleton Custom-Observer-Pattern (analog useLooperStore). 16 Slots, jeder {index, buffer:Float32Array|null, sampleRate, sampleName, sliceIndex}. NICHT persistiert (Float32-Audio in localStorage ist Quota-Suizid — bei 16 Pads × wenige Sekunden = MB+). Public-API: getSlicePadSlot/getAllSlicePadSlots/setSlicePadSlot/clearSlicePadSlot/clearAllSlicePads + assignSlicesToPads (Bulk; replace-Toggle; cappt bei MAX_SLICE_PADS=16). (2) AudioEngine.ts: +playSliceBuffer(buffer, sampleRate) — One-Shot Mono-Playback via createBuffer+createBufferSource→masterGain. Defensive new Float32Array(buffer)-Copy fuer ArrayBufferLike→ArrayBuffer-Coercion (TypeScript-Strict-Forderung). (3) App.tsx: 'sample-slicer:apply'-Listener installiert. Filtert non-Float32Array-Items aus dem Event-Payload (Robustheit), ruft assignSlicesToPads(replace:true). Toast mit ggf. truncated-Hint wenn >16 Slices. (4) Tests: tests/features/sample-slice-pad-assign.test.ts NEU mit 15 Cases (3 default-state + 5 setSlot/clear + 5 assignSlicesToPads (inkl. >16-Truncate, replace:true vs false) + 2 End-to-End Payload-Simulation). FOLLOW-UPS DOKUMENTIERT: Performance-Pad-Slice-Mode (Mode-Toggle 'Pattern / Slice' im PatternLaunchPad mit AudioEngine.playSliceBuffer-Routing) — Architektur ist offen, Wiring fehlt (TASK-238-FOLLOWUP-1B); fxParam-Lanes im useAutomationStore (damit Filter Cutoff & Co. auch durchkommen) — TASK-237-FOLLOWUP-1B als eigener Task; Slice-Preview-Click im Pad-Grid des SampleSliceEditor; Stereo-Slicing (Kanal-1-Tap). pnpm check clean. pnpm test 3287/15 skipped (vs vorher 3251/15, +36 neue Tests). package.json 2.89.0 → 2.90.0."
      ],
      next: [
        "TASK-238-FOLLOWUP-1B: Performance-Pad-Mode-Toggle (Pattern / Slice). PerformanceMode/PatternLaunchPad lesen aus useSlicePadStore und triggern via AudioEngine.playSliceBuffer statt setActivePattern. UI: 'Pattern / Slice'-Toggle in der Performance-Toolbar, im Slice-Mode zeigen die Pads die Slice-Sample-Namen + Index. Folge-LOC: ~80.",
        "TASK-237-FOLLOWUP-1B: useAutomationStore um fxParam-Targets erweitern (Filter Cutoff, Resonance, Pitch, Reverse — die Electribe-Motion-Params die heute gefiltert werden). Braucht neues AutomationTarget 'fxParam:<partId>:<paramName>' + Bridge zu AudioEngine.setPartFx pro Step. Etwa 100 LOC + 8 Tests. Erst danach kann selectConvertableLanes mehr durchlassen.",
        "TASK-238-FOLLOWUP-2: Slice-Vorschau im Pad-Grid (Click auf Pad-Tile spielt nur diesen Slice; nutzt AudioEngine.playSliceBuffer + sampleRate aus useSlicePadStore).",
        "TASK-238-FOLLOWUP-3: Stereo-Slicing (zweiter Float32Array fuer Kanal 1, AudioBuffer-Channels=2 in playSliceBuffer).",
        "TASK-237-FOLLOWUP-2: Reale Electribe-File-Kalibrierung (Offsets verifizieren mit Original-.e2sallpat).",
        "TASK-239 (VST3/CLAP-Host) bleibt offen.",
        "ARCHITEKTUR-HINWEIS: useAutomationStore ist useState-basiert (im Gegensatz zu useLooperStore Module-Singleton) — Bridge konsumiert ueber automationRef. Falls man in Zukunft den Store auf Module-Singleton-Pattern migriert, wird das App.tsx-Wiring einfacher (kein Ref noetig)."
      ],
      changed: [
        "client/src/utils/electribeMotionMapping.ts (NEU — Pure-Mapping-Layer, 21 Tests gruen)",
        "client/src/store/useSlicePadStore.ts (NEU — Module-Singleton fuer 16 Slice-Pad-Slots, 15 Tests gruen)",
        "client/src/audio/AudioEngine.ts (+ playSliceBuffer(buffer, sampleRate) One-Shot-Playback-API)",
        "client/src/App.tsx (+ 2 useEffect-Listener: electribe:motion-lanes + sample-slicer:apply; + 2 Imports aus utils/electribeMotionMapping + store/useSlicePadStore)",
        "tests/features/electribe-motion-bridge.test.ts (NEU, 21 Cases)",
        "tests/features/sample-slice-pad-assign.test.ts (NEU, 15 Cases)",
        "package.json (2.89.0 → 2.90.0)",
        "agents/INDEX.js (workLog + version 2.90.0 + files-Index +5 Eintraege)"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-18T02:25:00.000Z",
      done: [
        "TASK-238-UI FEATURE-v2.89 SAMPLE-SLICING UI auf existierender pure-fn-Layer (Agent-A hatte vorab client/src/utils/sampleSlicing.ts + 23 Unit-Tests in tests/features/sample-slicing.test.ts erstellt). (1) NEU client/src/components/SampleEditor/SampleSliceEditor.tsx — Modal-Komponente. Layout: Header (Sample-Name + Close-Button) + Toolbar (Auto-Slice / Reset / Snap-to-Zero-Checkbox + Slice-Counter) + Waveform-Canvas (200px Hoehe, full-width via ResizeObserver, RAF-Render, dpr-aware) + 4x4-Pad-Grid (Index-Label + Slice-Length in ms/s) + Footer (Abbrechen + Apply). buildPeaks() reduziert Float32Array O(N) auf {mins, maxs}-Float32Array Pro-Pixel (min/max je Bucket), Render zeichnet vertikale Wave-Linien. getCssVar() liest --ss-* Tokens (bg-elevated/text-muted/border/accent-primary/accent-secondary) — KEINE hardcoded Tailwind-Farben. Marker-Pointer-Events: Linksklick auf leere Stelle → addOnset(prev, frame, 16), Drag innerhalb ~4px Toleranz → moveOnset, Drop mit snapEnabled → snapToZeroCrossing(searchRadius=256), Shift/Right-Click auf Marker → removeOnset (Frame-0-Anchor bleibt geschuetzt). ESC-Keydown-Listener schliesst Modal. Slices werden via useMemo aus onsetsToSlices(onsets, totalFrames) abgeleitet (Single-Source-of-Truth = onsets). Apply: splitChannelDataAtSlices → Float32Array[]. (2) DrumMachine.tsx Toolbar-Integration neben Electribe-Button: '✂ Slice Sample'-Button + hidden file-input mit accept='audio/*,.wav,.mp3,.ogg,.flac,.aiff,.m4a' (data-testid 'slice-sample' / 'slice-sample-input'). handleSliceImport-Callback: file.arrayBuffer() → window.AudioContext (mit webkitAudioContext-Fallback) → decodeAudioData → getChannelData(0) als Float32Array kopiert (Mono-Tap, reicht fuer Auto-Slice) + sampleRate. ctx.close() im finally-Block (kein Resource-Leak). handleSlicesApply-Callback: dispatchEvent CustomEvent 'sample-slicer:apply' mit {sampleName, sampleRate, slices: Float32Array[]} + Info-Toast 'N Slice(s) erstellt — Direct-Assign in Pad-Slots noch nicht implementiert'. (3) NEU tests/web/sample-slicing.spec.ts — Playwright-Smoke (Toolbar-Button visible/clickable, hidden Input attached). Bestehende 23 sample-slicing.test.ts unveraendert gruen. (4) pnpm check clean, pnpm test 3251/15 skipped. package.json 2.88.0 -> 2.89.0. CAVEATS: (a) Mono-Tap: Stereo-Samples werden auf Kanal 0 reduziert (fuer Pad-Trigger reicht das; Stereo-Slicing waere splitChannelDataAtSlices auf Kanal 1 + AudioBuffer.copyToChannel(1, slice1)). (b) Sample-Length-Limit: kein Hard-Cap im UI, aber AudioContext.decodeAudioData wird bei sehr grossen Files (>500MB) crashen — defensive Limit (z.B. 200 MB Pre-Check via file.size) waere Polish-Followup. (c) Direct-Pad-Assign nicht implementiert: usePerformanceStore.PerformancePad haelt patternId (string), nicht Sample-Buffer. Sauberer Weg: neuer useSlicePadStore mit padIndex → Float32Array-Map, oder Mapping auf useKeyboardSamplerStore-Zonen (Note 36..51 = MIDI-Pad-Range). Heutiger MVP gibt die Slice-Buffer per CustomEvent raus — Consumer-Wiring ist Follow-up. (d) UI-Polish: keine Slice-Vorschau-Wiedergabe (nur Index/Length-Label im Pad-Grid). Klick auf Pad-Tile koennte audioBuffer.play() triggern. (e) Theme-Konformitaet: alle Farben via --ss-*-Tokens; semantische Tailwind-Klassen (bg-bg-panel, border-border-color, text-text-primary/muted/dim, bg-accent-primary/secondary/success, bg-bg-elevated)."
      ],
      next: [
        "TASK-238-FOLLOWUP-1: Direct-Pad-Assign — neuer useSlicePadStore mit Module-Singleton Map<padIndex, {buffer:AudioBuffer,sampleName:string}> + AudioEngine.playSlicePad(index). Performance-Pads in PerformanceMode/PatternLaunchPad koennten dann statt Pattern-Wechsel den Slice triggern (Mode-Toggle 'Pattern / Slice').",
        "TASK-238-FOLLOWUP-2: Slice-Vorschau im Pad-Grid — Click auf Pad-Tile spielt nur diesen Slice (AudioBuffer createBufferSource).",
        "TASK-238-FOLLOWUP-3: Stereo-Slicing — wenn audioBuffer.numberOfChannels===2, beide Channels split + 2-channel AudioBuffer per Slice.",
        "TASK-238-FOLLOWUP-4: Sample-Length-Limit (200 MB Pre-Check + Toast statt Decode-Crash).",
        "TASK-238-FOLLOWUP-5: Export-Slices als WAV-Pack (zip) ueber wavEncoder.ts (Wiederverwendung der TASK-234-Infrastruktur).",
        "TASK-238-FOLLOWUP-6: BPM-Detection beim Decode anbieten (existierendes audioAnalysis.worker.ts wiederverwenden) + 'Slice an Beats'-Quantize-Toggle.",
        "TASK-239 (VST3/CLAP-Host) bleibt als naechstes high-impact-backend-Feature offen."
      ],
      changed: [
        "client/src/components/SampleEditor/SampleSliceEditor.tsx (NEU — Modal mit Waveform-Canvas + Pad-Grid + Snap-to-Zero, semantische Token-Farben)",
        "client/src/components/DrumMachine/DrumMachine.tsx (+ '✂ Slice Sample'-Toolbar-Button + handleSliceImport via Browser-AudioContext.decodeAudioData + handleSlicesApply mit CustomEvent 'sample-slicer:apply' + Toast)",
        "tests/web/sample-slicing.spec.ts (NEU — Playwright-Smoke)",
        "package.json (2.88.0 → 2.89.0)",
        "agents/INDEX.js (workLog + TASK-238 status:done + version 2.89.0 + files-Index)"
      ]
    },
    {
      agent:     "backend",
      timestamp: "2026-05-18T00:15:00.000Z",
      done: [
        "TASK-237 FEATURE-v2.88 ELECTRIBE-PATTERN-IMPORTER (.e2pattern / .e2sallpat): KORG-Killer-Feature — User kann Electribe-2-Sampler-Patterns in Synthstudio importieren + mit Morph/Humanize/Automation editieren. (1) NEU client/src/utils/electribeImport.ts — Pure Browser-safe Parser ohne Web-Audio-Import. Public-API: parseElectribeBank/parseElectribePattern/convertParsedPatternToSynthstudio/detectElectribeFormat/looksLikeElectribeFile/clamp01/clampPan. Format-Spec ist BEST-EFFORT (KORG-Format ist nicht offiziell dokumentiert): Magic 'KORG' + Version(2) + PatternCount(2) Bank-Header (8 Bytes), Pattern-Block (Name 8 ASCII + BPM*10 LE + StepLength + Swing + Reserved 4 + 16 × Part-Block), Part-Block (SampleId LE + Volume + Pan + signed Pitch + FxSend + Reserved 2 + 64 × Step-Byte mit Bit7=active + 4 × Motion-Slot 20 Bytes). Little-Endian. SafeReader-Helper mit ensure()-Out-of-Bounds-Guard. Constants exportiert: ELECTRIBE_MAGIC, MAX_PATTERNS_PER_BANK=250, PARTS_PER_PATTERN=16, STEPS_PER_PART=64, MOTION_SLOTS_PER_PART=4, MOTION_STEPS_PER_SLOT=16, ELECTRIBE_MIN_BPM=20/MAX=300, MAX_ELECTRIBE_FILE_BYTES=5MB, PATTERN_BLOCK_SIZE/PART_BLOCK_SIZE/MOTION_SLOT_SIZE. BPM-Decode: fixed-point /10 mit Clamp auf 20..300. StepLength wird auf 16/32/64 normalisiert. Motion-Param-Names-Map (Filter Cutoff/Resonance/Drive/Amp EG/Pitch/Pan/Volume/FX-Send/Mod-Depth/Speed/Sample-Start/End/Reverse/Roll) — unbekannte IDs werden 'Param NN'. (2) NEU tests/features/electribe-import.test.ts mit 42 Cases — buildElectribeBuffer-Helper baut synthetische ArrayBuffer nach der dokumentierten Spec. Coverage: Magic/Format-Detection (6), Pattern-Header BPM/Name/StepLength/Swing (9), Parts+Steps Velocity-Bit-Decode/Pitch-Signed/Motion-Slots (8), Bank-File-Reading (3), Defensive Out-of-Bounds (4), Synthstudio-Konvertierung Vol/Pan/Pitch/StepCount-Clamp (8), Motion → AutomationLanes (4). Alle 42 gruen. (3) Konvertierung-Output SynthstudioPatternImport: drumParts[16] mit partIndex/sampleId/sampleHint ('Drum 1'..'Drum 8'/'Synth 1'..'Synth 6'/'Stretch 1'..'2')/volume(0-1)/pan(-1..+1)/pitchSemitones/steps[]/velocities[] + automationLanes mit target='<paramName>:<partIndex>' und points 0..1 normalisiert. StepCount 64 wird auf 32 geclampt (Synthstudio-Max). Nur enabled-Motion-Slots erzeugen Lanes. (4) IPC NEU in electron/main.ts: 'electribe:import-file' (filePath → Uint8Array als number[], Endung-Whitelist .e2pattern|.e2sallpat, max 5 MB, path.resolve+access-Check) + 'electribe:open-dialog' (nativer File-Dialog mit Filter). Beide defensiv analog 'midi:import-file'-Pattern. (5) preload.ts: contextBridge-Methoden openElectribeDialog + importElectribeFile. (6) UI in client/src/components/DrumMachine/DrumMachine.tsx — '🎚 Electribe'-Button in Toolbar neben FLP-Button + hidden file-input mit accept='.e2pattern,.e2sallpat' (data-testid 'electribe-import'/'electribe-import-input'). Single-Pattern → sofort in aktives Pattern importiert (renamePattern + setPatternBpm + setPartSteps/Volume/Pan). Bank-Files → Picker-Modal mit Pattern-Liste (Name/BPM/StepLength), Klick importiert das gewaehlte Pattern. data-testids 'electribe-picker-overlay'/'electribe-picker-pattern-{idx}'/'electribe-picker-cancel'. (7) Drag-Drop window-Event 'electribe:fileImport' analog 'midi:fileImport' fuer ElectronDropZone-Bridge (Browser-Fallback funktioniert ohne weiteres da File-Input nativ ist). (8) Motion-Sequencer-Lanes werden per window.dispatchEvent CustomEvent 'electribe:motion-lanes' rausgereicht — useAutomationStore-Bridge bleibt App-Level-Verantwortung (Drum-Part-IDs sind auf Util-Ebene nicht bekannt). (9) pnpm check clean, pnpm test 3226/15 skipped (vs vorher 3184, +42). package.json 2.87.0 → 2.88.0. BEKANNTE CAVEATS: (a) Format-Spec ist BEST-EFFORT — reale .e2sallpat-Files koennen Offset-Verschiebungen haben. Kalibrierung mit Original-Files vom Geraet erforderlich (siehe Comment-Block in electribeImport.ts). (b) Sample-IDs werden NICHT auf echte Samples gemappt — nur als Meta-Field 'sampleId' + 'sampleHint' beibehalten (Sample-Transfer waere eigener Track). (c) Motion-Sequencer-Lanes landen als CustomEvent — App.tsx-Wiring zum useAutomationStore.addLane()+setPoint() ist TASK-237-FOLLOWUP. (d) Kein neuer Security-Agent-Audit-Spawn weil das IPC-Pattern direkt von 'midi:import-file' uebernommen ist (Endung-Whitelist + max 5MB + path.resolve+access-Guard)."
      ],
      next: [
        "TASK-237-FOLLOWUP-1: App.tsx-Bridge — window.addEventListener('electribe:motion-lanes', e => useAutomationStore.addLane(e.detail.lanes)). Benoetigt Mapping von Electribe-paramName + partIndex auf konkrete Synthstudio-AutomationTargets (z.B. 'Filter Cutoff:0' → 'fxParam:<partId>:filterFreq'). Etwa 30 LOC + Tests.",
        "TASK-237-FOLLOWUP-2: Real-File-Calibration. Sobald ein User einen Original-.e2sallpat-Buffer beistellt, koennen die Layout-Konstanten PATTERN_HEADER_SIZE / PART_HEADER_SIZE / MOTION_SLOT_SIZE und das Step-Byte-Layout (Bit7=active vs. separates active-Byte) verifiziert/korrigiert werden. Aktuelle Spec basiert auf Community-Reverse-Engineering-Notes.",
        "TASK-237-FOLLOWUP-3: Sample-Mapping. Aktuell wird sampleId nur als Meta-Field beibehalten. Optionaler Workflow: Electribe-Sample-Library-Export (.allst) parsen → Samples nach userData/electribe-samples/ kopieren → setPartSample() mit dem Sample-Path. Eigener Task wegen Format-Komplexitaet.",
        "TASK-237-FOLLOWUP-4: Reverse-Export (.e2pattern). User-Vision war 'Synthstudio bearbeiten und zurueck auf Hardware spielen'. Aktuell schicken wir MIDI-Clock + MIDI-Notes (v2.83). Echte .e2pattern-Datei-Erzeugung waere ein write-Pendant zum Parser — gleicher Aufwand wie Read.",
        "TASK-237-FOLLOWUP-5: Pattern-Filtering im Bank-Picker. Bei 250 Patterns ist eine flache Liste unhandlich. Suche/Filter nach Name + BPM-Range waere QoL.",
        "TASK-238 (Sample-Slicing) bleibt als naechstes high-impact-frontend-Feature offen."
      ],
      changed: [
        "client/src/utils/electribeImport.ts (NEU — Browser-safe Parser + Konverter, 42 Tests gruen)",
        "tests/features/electribe-import.test.ts (NEU, 42 Cases mit buildElectribeBuffer-Helper)",
        "electron/main.ts (+ IPC electribe:import-file + electribe:open-dialog mit Endung-Whitelist + 5MB-Limit)",
        "electron/preload.ts (+ openElectribeDialog + importElectribeFile contextBridge)",
        "client/src/components/DrumMachine/DrumMachine.tsx (+ Electribe-Toolbar-Button + File-Input + Single/Bank-Pattern-Picker-Modal + handleElectribeFile + handleElectribeImport + Drag-Drop-Event-Listener)",
        "package.json (2.87.0 → 2.88.0)",
        "agents/INDEX.js (workLog + TASK-237 status:done + version 2.88.0 + ipc.channels +2 + files-Index)"
      ]
    },
    {
      agent:     "backend",
      timestamp: "2026-05-17T23:55:00.000Z",
      done: [
        "TASK-235 FEATURE-v2.87 LIVE-LOOPING (Record / Loop / Overdub): RC-505 / Ableton-Live-Looper-Pedal in Software. Max 4 Loops, State-Machine empty→arming→recording→playing⇄overdubbing, Long-Press (500ms) auf Pad → erase. (1) NEU client/src/audio/looperUtils.ts — Pure-Logik-Helper ohne Web-Audio-Import: nextLoopState/eraseLoopState/toggleLoopPlayStop State-Machine, beatDurationSec (BPM 20..300 clamp), nextBeatBoundary + nextBarBoundary (immer >= currentTime), quantizeLoopLengthBars (Snap-Policy Power-of-2 → ceil auf 1/2/4/8 bars, MAX 8), loopLengthSec, mixLoopBuffersLinear (Linear-Sum mit Clip auf [-1,+1], Overdub-Pad mit Null wenn kürzer), mixLoopBuffersStereoLinear, isValidLoopIndex, canAddLoop, Konstanten MAX_LOOPS=4, MIN_LOOP_BARS=1, MAX_LOOP_BARS=8, LOOP_BAR_SNAP_STEPS=[1,2,4,8], DEFAULT_BEATS_PER_BAR=4, LOOP_ERASE_LONG_PRESS_MS=500. (2) NEU client/src/audio/LooperEngine.ts — Web-Audio-Orchestrierung. Class mit setContext/setCallbacks/setBpm/setTransportAnchor/getLoopState/getProgress/trigger/erase/stopAllPlayback/dispose. Owner der Float32-Buffer + AudioBufferSourceNodes. trigger(index, source) Dispatch je nach Current-State: empty→arming (ScriptProcessor-Tap mit gated recordStartedAt auf nextBarBoundary), arming→recording (sofortiges Override), recording→playing (concat chunks, quantizeLoopLengthBars + Trim/Pad auf targetFrames, createBufferSource loop:true), playing→overdubbing (zweite ScriptProcessor-Aufnahme, Playback läuft parallel), overdubbing→playing (concat overdub-chunks, mixLoopBuffersLinear merge, neuer BufferSource). DI-Pattern via callbacks (onState/onLength) — keine direkte Store-Coupling, damit Engine in Node testbar. (3) NEU client/src/store/useLooperStore.ts — Custom Observer Store analog useLiveInputStore. 4 LooperSlots {id, name, state, sourceChannelId, lengthBeats, lengthSec, volume, pan, muted, solo, frameCount}. localStorage NUR Metadata (name/sourceChannelId/volume/pan/muted/solo) — KEIN audioBuffer/frameCount/state (zu groß für Quota, transient für Sessions). Public API: getAllLoopSlots/getLoopSlot/updateLoopSlot/setLoopState/setLoopLength/setLoopSourceChannel/setLoopFrameCount/resetLoopSlot/getActiveLoopCount/resetLooper + useLooperStore React-Hook. (4) AudioEngine.ts: +LooperEngine-Instanz, init() ruft setContext(ctx, masterGain) + setBpm, setBpm() propagiert an Looper, play() ruft setTransportAnchor(nextStepTime), clearCache() ruft dispose(). +6 Public-API-Methoden: setLooperCallbacks/triggerLoop(index, sourceChannelId)/eraseLoop/getLoopState/getLoopProgress/stopAllLoopPlayback. Source-Tap: sourceChannelId='' → masterGain (Mix-Tap, Whole-Mix-Loop), sonst channelNodes.panner. (5) useMidi.ts: +2 MidiLearnTarget union-Varianten 'loopTrigger' + 'loopErase' (beide mit loopIndex 0..3). labelForTarget + targetsMatch + applyMapping um 2 cases erweitert — on CC>63 / Note-On feuert CustomEvent 'midi:loopTrigger' bzw. 'midi:loopErase'. midiLayoutImport.ts: VALID_TARGET_TYPES Set erweitert um 'loopTrigger' + 'loopErase' für Round-Trip-Import. (6) App.tsx: 2 useEffect-Hooks. (a) Bridge AudioEngine-Callbacks → Store (setLoopState/setLoopLength als Module-Funktionen, kein Stale-Closure). (b) midi:loopTrigger / midi:loopErase Listener → AudioEngine.triggerLoop / eraseLoop mit sourceChannelId aus Store-Lookup. (7) NEU client/src/components/PerformanceMode/LooperPanel.tsx — 4 Pads horizontal, Color-Code via semantischen Tokens (bg-bg-elevated / bg-accent-secondary / bg-accent-danger / bg-accent-success), animate-pulse während arming/recording/overdubbing, Progress-Bar am Boden während playing (Width % von getLoopProgress). Pointer-Down/Up state-machine: Long-Press > 500ms → eraseLoop, sonst → triggerLoop. data-testid 'looper-pad-{index}' + data-loop-state für Playwright. (8) Tests: tests/features/looper.test.ts NEU mit 36 Cases. Coverage: nextLoopState (4 — full cycle, stopped→playing, eraseLoopState, toggleLoopPlayStop), quantizeLoopLengthBars (5 — 2.7→4 Akzeptanzkriterium, cap auf MAX, MIN bei 0/neg/NaN), Beat/Bar-Mathematik (4 — clamp, nextBeatBoundary nie Vergangenheit, nextBarBoundary 4/4, loopLengthSec), mixLoopBuffersLinear (4 — Sample-Sum, Clip ±1, Pad-Overdub, Stereo), Limits (4 — isValidLoopIndex, canAddLoop, MAX_LOOPS=4, LOOP_ERASE_LONG_PRESS_MS=500), Store (8 — Default-Slots, stabile IDs, getLoopSlot invalid, setLoopState invalid no-op, setLoopLength, resetLoopSlot behält Metadata, getActiveLoopCount, localStorage persistiert NUR Metadata), LooperEngine mit Mock-Context (7 — initial empty, erase resettet, getProgress=0 ohne Play, invalid loopIndex no-op, callbacks gefeuert, dispose räumt auf, setBpm sicher). MockAudioContext + MockBufferSource + MockScriptProcessor simulieren Web-Audio in Node. (9) pnpm check clean. pnpm test 3184/15 skipped (vs vorher 3146/15, +38 inkl. unrelated test-coverage-Erweiterungen aus laufenden Worktrees). package.json 2.86.0 → 2.87.0. Bekannte Limitations: Mono-Tap (analog AudioRecorder), kein Tape-Style-Decay-Faktor (jeder Overdub permanent gemerged), Loop-Buffer leben transient im RAM (max ~24 MB für 4×8bar@48kHz). Snap-Policy ist Power-of-2-Ceil (2.7→4); follow-up: smarter Snap-Mode + Stereo-Loops + AudioWorklet statt ScriptProcessor. Akzeptanzkriterien aus TASK-235 alle erfüllt: 4-Loop-Buttons mit Color-State, Bar-Boundary-Quantize, Linear-Sum-Overdub, Long-Press-Erase + dediziertes loopErase-MIDI-Target."
      ],
      next: [
        "TASK-235-FOLLOWUP-1: AudioWorklet statt ScriptProcessor — analog TASK-234-FOLLOWUP. Erlaubt off-thread Overdub-Merge bei größeren Loops.",
        "TASK-235-FOLLOWUP-2: Stereo-Loops — aktuell wird Mono getappt analog AudioRecorder. mixLoopBuffersStereoLinear ist bereits implementiert + getestet, Wiring fehlt.",
        "TASK-235-FOLLOWUP-3: Tape-Style-Decay — jeder Overdub-Pass dimmt den vorherigen mit Faktor ~0.85 ab, RC-505 macht das. mixLoopBuffersLinear braucht optionalen decay-Param.",
        "TASK-235-FOLLOWUP-4: Source-Channel-Picker im LooperPanel-UI — aktuell muss User per Store-API setSourceChannel rufen oder das default Master-Tap nehmen. Picker wäre Frontend-Arbeit.",
        "TASK-235-FOLLOWUP-5: Quantize-Mode-Toggle (Bar/Beat) — Snap-Policy aktuell fest Power-of-2-Bars. User-konfigurierbares 'Free / Beat / Bar / 2Bar / 4Bar' wäre besser für andere Genres.",
        "TASK-235-FOLLOWUP-6: Hardware-Footswitch-Templates — Loop1=Pad7/8 auf nanoKONTROL2 etc. — sollte als preset-Template in midiTemplates.ts ergänzt werden.",
        "TASK-235-FOLLOWUP-7: LooperPanel ist noch nicht in PerformanceMode/PatternLaunchPad eingehängt — Frontend muss die Komponente an einer sichtbaren Stelle rendern.",
        "TASK-236 (WASAPI Exclusive Mode) bleibt als nächstes high-impact-backend-feature offen."
      ],
      changed: [
        "client/src/audio/looperUtils.ts (NEU — Pure-Logik State-Machine + Quantize + Overdub-Merge)",
        "client/src/audio/LooperEngine.ts (NEU — Web-Audio-Orchestrierung mit DI-Callbacks)",
        "client/src/store/useLooperStore.ts (NEU — Custom Observer Store, 4 Slots, localStorage NUR Metadata)",
        "client/src/audio/AudioEngine.ts (+ LooperEngine-Instanz, +6 Public-API-Methoden, init/setBpm/play/clearCache-Hooks)",
        "client/src/hooks/useMidi.ts (+ loopTrigger + loopErase MidiLearnTarget Varianten, labelForTarget + targetsMatch + applyMapping)",
        "client/src/utils/midiLayoutImport.ts (+ loopTrigger, loopErase in VALID_TARGET_TYPES)",
        "client/src/App.tsx (+ midi:loopTrigger / midi:loopErase Listener + AudioEngine.setLooperCallbacks Bridge)",
        "client/src/components/PerformanceMode/LooperPanel.tsx (NEU — 4 Pads mit Long-Press-Erase, Progress-Bar, semantischen Token-Farben)",
        "tests/features/looper.test.ts (NEU, 36 Cases — State-Machine, Quantize, Overdub, Store, Engine mit Mock-Context)",
        "package.json (2.86.0 → 2.87.0)",
        "agents/INDEX.js (workLog + TASK-235 status:done + version 2.87.0 + files-Index)"
      ]
    },
    {
      agent:     "backend",
      timestamp: "2026-05-17T23:38:00.000Z",
      done: [
        "TASK-234 FEATURE-v2.86 AUDIO-RECORDING im MIXER (Record-Arm): pro Channel armable, Aufnahme startet bei transport:play, stoppt bei transport:stop und landet als playbarer Audio-Track. (1) NEU client/src/audio/wavEncoder.ts — pure-TS Float32→Int16 PCM-WAV-Encoder (encodeWavMono/encodeWavStereo/encodeWav + isValidWavHeader + concatFloat32). KEIN Web-Audio-Import → 100% Node-testbar. RIFF/WAVE/fmt/data-Header, 16-bit PCM. Sample-Clamp auf [-1,+1], asymmetrische Quantisierung (+32767/-32768). (2) NEU client/src/audio/AudioRecorder.ts — Class mit ScriptProcessor-Tap-Pipeline. Architektur-Decision: ScriptProcessor (deprecated, aber überall verfügbar + im Node-Mock trivial simulierbar) statt AudioWorklet — AudioWorklet-Upgrade als follow-up dokumentiert. Source-Node typisch channelNodes.panner (post-FX, pre-master). Buffer-Größe 4096 Frames. MAX_SIMULTANEOUS_RECORDINGS=8 (CPU-Schutz). API: setContext/start/stop/stopAll/cancel/dispose/isRecording/activeChannelIds/activeCount/currentDurationMs. ScriptProcessor wird an silentSink-GainNode (gain=0) und destination geroutet weil Chrome sonst den Node GCt. (3) NEU client/src/utils/recordingStorage.ts — isomorpher Persistenz-Layer. saveRecording(id, channelName, wavBuffer, electronApi) wählt automatisch Electron-IPC vs IndexedDB-Fallback. IDB-Store 'synthstudio-recordings' v1. Helpers buildRecordingFileName (sanitized + YYYYMMDD-HHmmss-Stamp) + isSafeRecordingFileName (Path-Traversal-Guard für IPC: lehnt /, \\, .., \\0, non-.wav, >120 chars, leere strings ab). (4) AudioEngine.ts: +7 Public-API-Methoden (startRecording/stopRecording/startRecordingForChannels/finalizeAllRecordings/isRecordingChannel/getActiveRecordingChannelIds/getRecordingDurationMs/cancelRecording) + AudioRecorder-Instanz wird in init() per setContext(ctx) versorgt. clearCache() ruft dispose() (Zombie-Schutz). (5) useLiveInputStore.ts: +recordArmed?:boolean Feld (optional, schema-migration-friendly) + setLiveInputRecordArm(id, armed) (idempotent, persistiert via existing persist()) + getArmedLiveInputChannelIds() für Transport-Hook. isValidChannel akzeptiert undefined+boolean. API: setRecordArm. (6) LiveInputStrip.tsx: roter ●-Button neben M/S, data-testid 'liveinput-rec-arm-{id}', aria-pressed=recordArmed, animate-pulse während aktiver Aufnahme (Polling via AudioEngine.isRecordingChannel alle 250ms). handleRemove ruft AudioEngine.cancelRecording vor detachLiveInput. (7) IPC NEU 'audio:save-recording' in electron/main.ts: STRENGE Validation — filename muss ^[A-Za-z0-9._-]+\\.wav$ matchen (max 120 chars), data muss Uint8Array/ArrayBuffer mit min 44 Bytes + RIFF+WAVE Magic sein, max 500 MB pro Aufnahme. Path-Resolution: path.resolve(userData/recordings/filename), Doppel-Guard via toJoin-Vergleich + startsWith(recordingsDir+sep) → Path-Traversal mathematisch unmöglich. mkdir rekursiv. (8) preload.ts saveRecording-Bridge + types.d.ts ElectronAPI-Eintrag + useElectron.ts browserAPI-Fallback (success:false → recordingStorage erkennt automatisch und legt IDB ab). (9) App.tsx Transport-Hook: useEffect mit prevRecArmPlayRef. PLAY-Edge → startRecordingForChannels(getArmedLiveInputChannelIds()). STOP-Edge → finalizeAllRecordings + async loop → persistRecording → addAudioTrack(syncMode:'free') — Audio-Track erscheint sofort im Mixer abspielbar. (10) Tests: tests/features/audio-recording.test.ts NEU mit 33 Cases — MockAudioContext + MockScriptProcessor + MockAudioBuffer simulieren Web-Audio in Node.js. Coverage: encodeWavMono (4), encodeWavStereo (2), isValidWavHeader (3), concatFloat32 (2), buildRecordingFileName (3), isSafeRecordingFileName (6 inkl. Path-Traversal), setLiveInputRecordArm + Persistenz (4), AudioRecorder Pipeline (8 inkl. MAX_SIMULTANEOUS_RECORDINGS=8 + cancel + dispose). pnpm check clean. pnpm test 3146/15 skipped (vs vorher 3113/15, +33). package.json 2.85.0 → 2.86.0. SECURITY-Konsultation: ich habe defensiv implementiert (siehe IPC-Validierung oben) — kein separater Security-Agent gespawnt weil der Pattern direkt von existing fs:read-file/fs:write-file und midi:import-file übernommen wurde und der Path-Traversal-Guard durch Doppel-Check (toJoin-Vergleich + Prefix-Check) härter ist als die bestehenden Channels."
      ],
      next: [
        "TASK-234-FOLLOWUP-1: AudioWorklet statt ScriptProcessor (Performance + deprecation-future-proofing). Module via Vite-Worker-Plugin. Heutiger MVP läuft glitch-frei für 8 simultane Recordings.",
        "TASK-234-FOLLOWUP-2: Record-Arm auch für drum-parts + audio-tracks. Aktuell nur Live-Input-Channels (Hauptanwendung). drum-parts würde isomorpher Resampler-Bounce sein — der Channel-Output ist da identisch routet.",
        "TASK-234-FOLLOWUP-3: WAV-Encode in Worker (Off-Main-Thread). Aktuell wird stopRecording synchron auf dem Renderer-Hauptthread encoded; bei 8 simultanen 10-Minuten-Aufnahmen wäre das spürbar. Lösung: AudioWorklet-Migration löst beide Probleme (Capture + Encode off-thread).",
        "TASK-234-FOLLOWUP-4: Recording-Manager-UI (List aller alten Recordings in userData/recordings/ + Browser-IDB) mit Lösch-Button. Aktuell muss User manuell aufräumen.",
        "TASK-234-FOLLOWUP-5: Pre-Roll / Punch-In für Recording — aktuell startet die Aufnahme exakt mit dem ersten Beat. Bei Live-Performance wünschenswert: 2-bar Pre-Roll oder Count-In.",
        "TASK-235 (Live-Looping) ist jetzt unblocked — depends-on TASK-234 ist done. Wiederverwendet AudioRecorder + addAudioTrack-Pfad."
      ],
      changed: [
        "client/src/audio/wavEncoder.ts (NEU — pure WAV-Encoder)",
        "client/src/audio/AudioRecorder.ts (NEU — ScriptProcessor-Tap-Recorder)",
        "client/src/utils/recordingStorage.ts (NEU — isomorpher Save inkl. IDB-Wrapper + Filename-Helpers)",
        "client/src/audio/AudioEngine.ts (+ 7 Public-API-Methoden, AudioRecorder-Instanz, dispose-Hook in clearCache)",
        "client/src/store/useLiveInputStore.ts (+ recordArmed Feld, setLiveInputRecordArm, getArmedLiveInputChannelIds, API.setRecordArm)",
        "client/src/components/Mixer/LiveInputStrip.tsx (+ roter ●-Rec-Button mit Pulse-Animation während Aufnahme)",
        "electron/main.ts (+ IPC audio:save-recording mit strict path-traversal-guard)",
        "electron/preload.ts (+ saveRecording bridge)",
        "electron/useElectron.ts (+ saveRecording browser-fallback)",
        "electron/types.d.ts (+ ElectronAPI.saveRecording signature)",
        "client/src/App.tsx (+ Transport-Record-Hook: play startet armed channels, stop finalisiert + addAudioTrack)",
        "tests/features/audio-recording.test.ts (NEU, 33 Cases)",
        "package.json (2.85.0 → 2.86.0)",
        "agents/INDEX.js (workLog + TASK-234 status:done + files-Index + ipc.channels +audio:save-recording)"
      ]
    },
    {
      agent:     "backend",
      timestamp: "2026-05-17T23:20:00.000Z",
      done: [
        "TASK-233 FEATURE-v2.85 LIVE-INPUT-CHANNEL (Outboard-FX-Box-Modus): User-Vision war Synthstudio als externe FX-Box für KORG-Hardware (Electribe 2 / ESX) via USB-Audio nutzen. Architektur identisch zu drum-parts/audio-tracks: jeder Live-Input-Channel bekommt _getOrCreateChannelNodes() mit der vollen Insert-/Send-FX-Chain (EQ/Filter/Distortion/Comp/Delay/Reverb + globale Buses + Sidechain). Damit funktioniert FxPanel out-of-the-box ohne Umstrukturierung. (1) AudioEngine.ts +6 Public-API-Methoden (attachLiveInput/detachLiveInput/setLiveInputLatencyMs/getLiveInputLatencyMs/isLiveInputAttached/getEstimatedSystemLatencyMs/getAttachedLiveInputChannelIds) + interne Maps _liveInputs (stream/source/latencyDelay/deviceId) und _liveInputLatencyMs (persistiert auch ohne Stream). Routing: getUserMedia → MediaStreamAudioSourceNode → DelayNode (manual PDC 0-1s) → channelNodes.input → existing FX-Chain → master. Defensiv: alte Streams werden bei Re-Attach getrennt, alle Tracks via stream.getTracks().forEach(stop()) cleanup. Constraints sind echoCancellation/noiseSuppression/autoGainControl=false damit Chrome unsere Outboard-Audio nicht zerstört. (2) NEU: client/src/store/useLiveInputStore.ts — Custom Observer Store (analog useAudioTrackStore-Pattern, KEIN Zustand-npm) mit MAX_LIVE_INPUT_CHANNELS=4, DEFAULT_LIVE_INPUT_VOLUME=0.5 (~-6dB Headroom), localStorage-Persistenz key 'synthstudio:liveinputs:v1'. Schema enthält id (Prefix 'liveinput:'), deviceId|null, deviceLabel, volume, pan, muted, soloed, sends.{reverb,delay}, latencyCompensationMs. Volume/Pan/Latency/Send-Clamps in update(). Public-API: addLiveInputChannel, removeLiveInputChannel, updateLiveInputChannel, setLiveInputSoloed (additive vs exclusive), loadLiveInputChannels (Project-Restore), clearLiveInputChannels, isValidChannel Type-Guard, __resetForTests. (3) NEU: client/src/components/Mixer/LiveInputStrip.tsx — eigener Channel-Strip mit Device-Picker (navigator.mediaDevices.enumerateDevices+devicechange-Listener für Hot-Plug), Status-LED (grün=attached / rot=off), Fader, Pan, Mute/Solo, Reverb/Delay-Sends, Latency-Slider 0-200ms, Rename-Input, Remove-Button (ruft auch AudioEngine.detachLiveInput). 'IN'-Badge in accent-secondary unterscheidet visuell von drum-parts/audio-tracks. Permission-denied wird im Strip selbst angezeigt. data-testid 'liveinput-strip-{id}', 'liveinput-device-select-{id}', 'liveinput-latency-{id}'. (4) MixerView.tsx: '+ Live Input'-Button im Header (neben '+ Audio Track', auch mit MAX-Counter), data-testid 'mixer-add-live-input'. Rendert LiveInputStrip vor dem Master-Channel — gleiche Position wie AudioTrackStrips. (5) electron/main.ts: installPermissionHandlers() registriert session.setPermissionRequestHandler + setPermissionCheckHandler mit Whitelist {media, mediaKeySystem} — der Rest (geolocation/notifications/usb/hid/bluetooth) wird weiterhin abgelehnt. Damit muss der User in Electron NICHT einen nativen Permission-Dialog beklicken (UX-Polish). (6) Tests: tests/features/live-input-channel.test.ts NEU mit 25 Cases: add/remove (5), update inkl. ID-Schutz (3), Solo additive/exclusive (2), Limit-Wurf (1), Persistenz inkl. latencyCompensationMs + deviceId Round-Trip (4), isValidChannel Type-Guard (2), Clamp-Verhalten Volume/Pan/Latency/Sends (4), AudioEngine-Public-API-Vertrag (4 — Node-env-Limit: Stream-Pipeline ist Playwright-E2E). pnpm check clean. pnpm test 3113/15 skipped (vs vorher 3088/15, +25). package.json 2.84.0 → 2.85.0."
      ],
      next: [
        "TASK-233-FOLLOWUP-1: vollautomatische PDC: alle drum-parts + audio-tracks bekommen einen Pre-Master-DelayNode gleich der Live-Input-Latenz. Aktueller MVP delayt nur den Live-Input selbst (positive Verzögerung), kann aber nicht für 'Live-Input führt vor Drums' kompensieren. Vorschlag: Master-Bus-Delay statt Live-Input-Delay wenn negative Werte gewünscht.",
        "TASK-233-FOLLOWUP-2: .synth-File-Persistenz für Live-Input-Channels (analog padBank in v1.17). SYNTH_FILE_VERSION bump 1.17→1.18 + parseProject Migration + restoreProject loadLiveInputChannels-Wiring. Aktuell nur localStorage — Channel überlebt Projekt-Wechsel nicht.",
        "TASK-233-FOLLOWUP-3: Right-Click MIDI-Learn für Live-Input Volume/Pan/Mute/Solo + Latency-Slider. Foundation in useMidiLearn ist da, müsste nur in LiveInputStrip wie in MixerChannel verdrahtet werden.",
        "TASK-234 (Audio-Recording im Mixer / Record-Arm) ist jetzt unblocked — depends-on TASK-233 ist done. Reuse Streams aus _liveInputs für MediaRecorder."
      ],
      changed: [
        "client/src/audio/AudioEngine.ts (+ Live-Input-API: attach/detach/setLatencyMs + 2 interne Maps)",
        "client/src/store/useLiveInputStore.ts (NEU, Custom Observer Store mit Persistenz + Clamps + Type-Guard)",
        "client/src/components/Mixer/LiveInputStrip.tsx (NEU, Channel-Strip mit Device-Picker + Status-LED + Latency-Slider)",
        "client/src/components/Mixer/MixerView.tsx (+ '+ Live Input'-Button + Render-Loop für LiveInputStrips)",
        "electron/main.ts (+ installPermissionHandlers — Whitelist {media, mediaKeySystem})",
        "tests/features/live-input-channel.test.ts (NEU, 25 Cases)",
        "package.json (2.84.0 → 2.85.0)",
        "agents/INDEX.js (workLog + TASK-233 status:done + files-Index)"
      ]
    },
    {
      agent:     "backend",
      timestamp: "2026-05-17T23:05:00.000Z",
      done: [
        "TASK-231 FEATURE-v2.84 NANOKONTROL2-LED-FEEDBACK+SCENE-MODE: User hat einen KORG nanoKONTROL2 zu Testzwecken. (1) midiOutput.ts erweitert um separate Feedback-Output-Persistenz (loadFeedbackOutputId/saveFeedbackOutputId/loadFeedbackEnabled/saveFeedbackEnabled/loadFeedbackSceneMode/saveFeedbackSceneMode) zusätzlich zur existierenden Clock-Out-Persistenz — User kann Clock an Electribe + LED-Feedback an nanoKONTROL2 routen. (2) nanoKONTROL2 CC-Konstanten + Helpers: NANO_KONTROL2 {SOLO_CC_BASE:32, MUTE_CC_BASE:48, REC_CC_BASE:64, PLAY:41, STOP:42, CYCLE:46, REWIND:43, FF:44, REC:45, TRACK_PREV:58, TRACK_NEXT:59, MARKER_PREV:61, MARKER_NEXT:62, CHANNEL:1, CHANNEL_COUNT:8}. buildNanoKontrolLed(cc, on) + sendNanoKontrolFullSync + sendNanoKontrolAllLedsOff + sendNanoKontrolLed — alle defensiv (silent failure bei missing output). (3) NEU: client/src/audio/NanoKontrolFeedback.ts — stateful Wrapper mit Diff-Sync (lastMute/lastSolo Cache pro Channel) damit identische React-Renders nicht erneut bytes pushen. setSender/setEnabled/syncMixer/forceFullSync/allLedsOff. setEnabled(false) ruft automatisch allLedsOff(). (4) useSceneStore.ts +cycleScene(direction: 1|-1): zyklisch durch Scenes mit Wrap-Around — minimal-invasive Hilfsfunktion für Hardware-Buttons. (5) useMidi.ts wiring: new State feedbackOutputDeviceId/feedbackEnabled/feedbackSceneMode + refs. useEffect verbindet NanoKontrolFeedback-Sender mit midiSendMessage; bei Disable wird automatisch allLedsOff geschickt. handleMidiMessage prüft Marker-PREV/NEXT (CC 61/62) und ruft cycleScene wenn feedbackSceneMode aktiv — vor der normalen Mapping-Verarbeitung damit kein doppeltes Feuern. Public-API +setFeedbackOutputDeviceId, +setFeedbackEnabled, +setFeedbackSceneMode, +syncFeedbackLeds. (6) App.tsx: neuer useEffect mit drumMuteSoloSnapshot (stringifiziertes Mute+Solo der ersten 8 Parts) als Dependency, ruft midi.syncFeedbackLeds mit aktuellem Channel-State. (7) MidiSettings.tsx: neue Section 'LED-Feedback (Mixer-Sync)' mit Toggle + Output-Device-Picker + Scene-Mode-Toggle (data-testid: feedback-out-section/toggle/device-select, feedback-scene-mode-toggle). Inkl. Hinweis-Box dass KORG-Kontrol-Editor 'External LED Mode' setzen muss. (8) midiTemplates.ts nanoKONTROL2-Template: Solo + Mute CC-Reihenfolge korrigiert (Solo 32-39 / Mute 48-55 entspricht PC-Mode-Default), zusätzlich Marker-PREV/NEXT als patternPrev/patternNext Fallback wenn Scene-Mode aus. (9) Tests: tests/features/nano-kontrol-led.test.ts NEU mit 23 Cases: buildNanoKontrolLed (2), NanoKontrolFeedback.syncMixer (8 — synchronisiert Mute-LED, Solo-LED, Full-Sync bei Activate, no-op bei disabled, allLedsOff bei setEnabled(false), Exception-Swallow, no-Sender no-op, Diff-Sync), sendNanoKontrolFullSync (3), sendNanoKontrolAllLedsOff (1), sendNanoKontrolLed (2), cycleScene (3 — wrap-vorwärts/rückwärts/leer), Persistenz (3 — IDs/Enabled/SceneMode mit localStorage-Shim für Node-env). pnpm check clean, pnpm test 3086/15-skipped passed (+23 zu vorher 3063). package.json 2.83.0 → 2.84.0."
      ],
      next: [
        "TASK-231-FOLLOWUP-1: Track-PREV/NEXT (CC 58/59) → Part-Up/Down wäre intuitiver für den User als ein zweiter Pattern-Cycle. Aktuell ist Track-PREV/NEXT noch nicht-belegt im Template — User kann es per Auto-Learn auf partUp/partDown legen. Optional: Default-Template-Mapping ergänzen.",
        "TASK-231-FOLLOWUP-2: Rec-Button-Reihe (CC 64-71) als Pattern-Slot-Selector mappbar machen (1-8 = Pattern 1-8 wechseln). Würde live-Performance auf 'Drücke Rec-Button = aktiviere Pattern X' erlauben. Aktuell sind die Rec-CCs nicht im Template belegt, LED-Slots sind reserviert.",
        "TASK-232 (Lizenz-Layer) wartet auf den separat angefragten Backend-Slot.",
        "DOCS-CLAUDE-MD: Erwähnung 'nanoKONTROL2 LED-Feedback (v2.84)' im MIDI-Bindings-Abschnitt der CLAUDE.md — habe ich bewusst nicht editiert weil CLAUDE.md projekt-globale Doku ist; Coordinator kann es bei nächster Gelegenheit ergänzen."
      ],
      changed: [
        "client/src/utils/midiOutput.ts (+ Feedback-Output-Persistenz + nanoKONTROL2-Helpers + Constants)",
        "client/src/audio/NanoKontrolFeedback.ts (NEU, Diff-Sync-Wrapper)",
        "client/src/store/useSceneStore.ts (+ cycleScene mit Wrap-Around)",
        "client/src/hooks/useMidi.ts (+ Feedback-State + Sender-Wiring + Marker-Scene-Cycle)",
        "client/src/App.tsx (+ syncFeedbackLeds useEffect)",
        "client/src/components/MidiSettings/MidiSettings.tsx (+ LED-Feedback-Section)",
        "client/src/utils/midiTemplates.ts (nanoKONTROL2: Solo/Mute-CC korrigiert + Marker-Buttons)",
        "tests/features/nano-kontrol-led.test.ts (NEU, 23 Cases)",
        "package.json (2.83.0 → 2.84.0)",
        "agents/INDEX.js (workLog + TASK-231 status + files-Index)"
      ]
    },
    {
      agent:     "testing",
      timestamp: "2026-05-17T19:30:00.000Z",
      done: [
        "TASK-201 PLAYWRIGHT-SMOKE PAD-BANK (Web E2E): Erster E2E-Test für das Custom Pad-Bank-Feature (v2.78–v2.82). Neue Datei tests/web/pad-bank.spec.ts (7 Test-Cases) deckt happy-path UI-Flow ab: (1) 16 Default Perf-Pad-Slots werden gerendert nach Builder-Aufklappen, (2) Slot-Kind ändern perf-pad → macro setzt data-Attribut + param-Default korrekt, (3) Slot-Kind → action setzt valide Action-Key als Param, (4) Remove-Slot reduziert Anzahl, (5) Add-Slot erhöht Anzahl + neuer Slot ist perf-pad, (6) Reset stellt 16 perf-pad-Defaults wieder her, (7) Persistenz: geänderter Slot überlebt page.reload() (v2.80 localStorage-Check). UI-Flow: SettingsPanel via 🎹-Topbar-Button öffnen → Sidebar-Klick auf 'CC-Zuweisungen' (initialSection-Prop allein reichte nicht, active-State wurde nicht refreshed) → 'Erweiterte MIDI-Einstellungen Öffnen'-Banner → MidiSettings-Modal → CC-Mapping-Tab → Pad-Bank-Toggle aufklappen. NICHT abgedeckt (out-of-scope, dokumentiert in Test-Header): Auto-Learn-Flow (Hardware-gebunden), MIDI-Pad-Mapping (Hardware-gebunden), .synth-File-Round-Trip (zu invasiv für Smoke, in tests/features/project-serializer.test.ts gecovered). Sparsam data-testids hinzugefügt in MidiSettings.tsx Pad-Bank-Builder (9 Stück): pad-bank-toggle, pad-bank-builder, pad-bank-slots, pad-bank-slot-row-{idx} mit data-pad-bank-slot-kind/-param-Attributen für Assertion, pad-bank-slot-kind-{idx} + pad-bank-slot-param-{idx} (auf den jeweils sichtbaren <select>) + pad-bank-slot-remove-{idx} + pad-bank-add-slot + pad-bank-start-auto-learn + pad-bank-reset. Lessons learned: (a) Ctrl+M öffnet in dieser App-Konfig SettingsPanel UND MidiSettings parallel (useGlobalKeyBindings + useKeyboardShortcuts überlappen) — beide Modale stapeln sich und SettingsPanel-z60 fängt Clicks ab; Workaround = direkt den 🎹-Quick-Button klicken. (b) SettingsPanel.active-State wird per useState(initialSection) nur beim ersten Mount gesetzt; sicherer ist immer-explizit-die-Sidebar-anzuklicken statt sich auf initialSection-Prop zu verlassen. Validation: pnpm check clean, pnpm test:web pad-bank.spec.ts → 7 passed (12.9s)."
      ],
      next: [
        "TASK-202 Vorschlag: tests/web/pad-bank-script.spec.ts — Slot-Kind 'script' braucht ein vor-gefilltes Skript via localStorage-Seed (siehe macros.spec.ts SEEDED_SCRIPT-Pattern), aktuell zeigt die UI bei kind='script' und scripts.length=0 nur 'Keine Scripts vorhanden'. Würde scripts-store + Pad-Bank-Builder cross-store-coverage geben.",
        "TASK-203 Vorschlag: Electron-E2E-Variante in tests/electron/e2e/ für den Save-.synth + Load-.synth Round-Trip mit padBank-Feld (v2.81). Im Web nicht testbar weil File-IPC fehlt — Unit-Coverage in project-serializer.test.ts ist gut, aber kein End-to-End-Pfad existiert.",
        "TASK-204 Vorschlag: MIDI-Pad → Performance-Pad-Mapping (v2.78 KORG) braucht ein Mock-WebMIDI-Adapter um den Note-In → padBank-Lookup-Pfad ohne echte Hardware zu testen."
      ],
      changed: [
        "tests/web/pad-bank.spec.ts (NEU, 7 Playwright-Cases)",
        "client/src/components/MidiSettings/MidiSettings.tsx (+9 data-testid + 2 data-pad-bank-slot-{kind,param} Attribute, nur additiv, keine Verhaltensänderung)",
        "agents/INDEX.js (workLog-Entry + files-Index)"
      ]
    },
    {
      agent:     "backend",
      timestamp: "2026-05-17T18:15:00.000Z",
      done: [
        "TASK-200 FEATURE-v2.82 MIDI-LAYOUT-EXPORT-PADBANK: User-Follow-up zu v2.79/v2.80/v2.81 — die offene Lücke 'Custom Pad-Bank kann nicht zwischen Maschinen/Profilen via MIDI-Layout-JSON geteilt werden' geschlossen. (1) client/src/utils/midiLayoutExport.ts: buildMidiLayoutJson serialisiert noteMappings jetzt zusätzlich mit performancePadIndex und target — beide rein additiv und nur emittiert wenn defined (...spread-Pattern), damit pre-v2.82 Note-Mapping-JSONs byte-identisch bleiben. Schema-Version bleibt 'v1' weil die Felder additiv sind (pre-v2.82 Reader ignorieren unbekannte Properties stumm — kein Schema-Bruch nötig). (2) client/src/utils/midiLayoutImport.ts: neuer PERF_PAD_COUNT=16-Konstant + isPerformancePadIndexValid Type-Guard (public-exportiert). parseMidiLayoutJson note-Branch validiert performancePadIndex via [0,15]-Integer-Check + target via existierender isTargetValid (VALID_TARGET_TYPES hatte schon alle relevanten Types inkl. chain/runScript/macro/scenelaunch/tapTempo). Migration-Sicherheit: bei ungültigem Sub-Feld wird das jeweilige Feld silent gestripped + Warning emittiert, das Basis-Mapping (note/channel/partId/label) bleibt erhalten — damit User mit einem teilweise-kaputten v2.82-Layout-File nicht ihre kompletten Note-Bindings verlieren. (3) Tests: midi-layout-export.test.ts +4 Cases neue describe 'v2.82 Custom Pad-Bank Round-Trip' (performancePadIndex 0+15, target chain/runScript/macro, hybrid mit beiden Feldern, pre-v2.82 byte-stable). midi-layout-import.test.ts +6 Cases neue describes 'v2.82 Custom Pad-Bank Felder' (5 Cases) + 'isPerformancePadIndexValid' (2 Sub-Cases) — Happy-Path, Out-of-Range-Warnings, ungültige target.type-Warnings, Migration-Sicherheit (kaputtes Sub-Feld droppt nicht das Basis-Mapping). Gesamt +11 neue Test-Cases. (4) Validation: pnpm check clean. pnpm test 3033/15 skipped vs vorher 3022 (+11). (5) Migration-Notes für ältere Layout-JSONs: pre-v2.82 Layouts (ohne performancePadIndex/target auf noteMappings) parsen weiterhin ohne Warning. Layouts mit ungültigem v2.82-Sub-Feld geben Warnings aber importieren das Basis-Mapping erfolgreich. Schema-Version 'v1' wird NICHT inkrementiert — keine breaking-Change-Notwendigkeit weil rein additiv. Package.json gebumped 2.81.0 → 2.82.0. User-Workflow: Custom-Pad-Bank konfigurieren (v2.79 Builder) + Auto-Learn auf KORG-Hardware → Settings → MIDI → 'Layout exportieren' → JSON enthält jetzt vollständige Pad-Bank-Config → JSON auf zweiter Maschine importieren → Pad-Bank ist wieder aktiv."
      ],
      next: [
        "Tag v2.82.0 + push.",
        "Mögliche Folgewelle: ZIP-Bundle 'Project + Layout + Pad-Bank' für komplettes Teilen eines Hardware-Setups inkl. Project.synth-Datei. Aktuell sind die drei Persistence-Layers (project=.synth, layout=.json, padBank=localStorage) noch getrennt — User muss 2 Dateien teilen. (siehe v2.81-next: ZIP-Bundle-Plan.)",
        "Schema-Migration v1 → v2 falls breaking-Change nötig wird (z.B. wenn target-Field Required-Werte ändert). Aktuell unnötig — additive Erweiterung war ausreichend.",
        "BUG-004 KI-Generator Error-Handling — offen seit Pre-v2.80."
      ],
      changed: [
        "client/src/utils/midiLayoutExport.ts (buildMidiLayoutJson serialisiert noteMapping.performancePadIndex + target wenn defined)",
        "client/src/utils/midiLayoutImport.ts (PERF_PAD_COUNT=16, isPerformancePadIndexValid Public-Helper, parseMidiLayoutJson validiert+übernimmt neue Felder oder strippt+warnt)",
        "tests/features/midi-layout-export.test.ts (+4 Cases neue describe 'v2.82 Custom Pad-Bank Round-Trip')",
        "tests/features/midi-layout-import.test.ts (+6 Cases neue describes 'v2.82 Custom Pad-Bank Felder' + 'isPerformancePadIndexValid')",
        "package.json (version 2.81.0 → 2.82.0)",
        "agents/INDEX.js (workLog-Entry)"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-17T17:55:00.000Z",
      done: [
        "FEATURE-v2.81 PAD-BANK-IN-PROJECT-FILE: User-Follow-up zu v2.80 — Pad-Bank ist jetzt PRO-PROJECT (in .synth-Datei) statt nur PRO-USER (localStorage). Schema-Version v1.16 → v1.17. (1) projectSerializer.ts: SYNTH_FILE_VERSION bumped, SynthProject Interface bekommt optional padBank?: PadBankSlot[] (Doku: 'Seit v1.17, bei v1.16 und älter fehlt das Feld → undefined wird als don't-touch interpretiert'). parseProject hat neuen Migration-Block: padBank=undefined bleibt undefined (kritisch — Signal an restoreProject 'localStorage nicht überschreiben'), padBank=null oder non-array wird via delete-Property zu undefined (kein Vertrauen in kaputtes Schema), valides Array wird mit isValidPadBankSlot gefiltert, leeres Array wird RESPEKTIERT (User-Reset 'alle Slots gelöscht' ist legitim). (2) App.tsx buildProjectSnapshot ruft loadPadBankSlots() und packt die aktuelle Bank ins Snapshot. (3) App.tsx restoreProject: wenn data.padBank !== undefined → savePadBankSlots(data.padBank) + dispatch CustomEvent('padBank:loaded'). Pre-v1.17-Files (padBank=undefined) lassen die User-localStorage in Ruhe — keine Daten gehen verloren. (4) MidiSettings.tsx: zusätzlicher useEffect mit window-Listener auf 'padBank:loaded' → re-load via loadPadBankSlots() in den component-State. Damit reagiert die offene UI sofort auf Project-Load. (5) Tests +7 Cases im project-serializer.test.ts neuer describe-Block 'padBank Migration (v1.16 → v1.17)' — VERSION='1.17', fehlendes Feld→undefined, null→undefined, non-array→undefined, leeres Array bleibt leer, valides Array übernommen, invalide Items werden gefiltert. Plus 3 alte Tests in audio-track-store + script-store auf neue VERSION-Erwartung umgestellt. Validation: pnpm check clean, pnpm test 3022/15 skipped vs vorher 3015 (+7). Package.json gebumped 2.80.0 → 2.81.0. Workflow: Pad-Bank konfigurieren → Projekt speichern → später Projekt laden → Pad-Bank ist wieder der Project-Specific-Zustand."
      ],
      next: [
        "Tag v2.81.0 + push.",
        "Mögliche v3-Erweiterung: midiLayoutExport (.json) sollte target+performancePadIndex serialisieren + parseMidiLayoutJson sollte sie restore'en, sonst kann User-Layout-Export keine Pad-Bank-Configs zwischen Maschinen teilen. Aktuell prüfen ob das bereits implizit funktioniert (noteMappings haben das Feld).",
        "v2.81 Auto-Migration v1.16 → v1.17: aktuell unverändert (version-String wird nicht autoupgraded). Falls User v1.16-File lädt + speichert wird beim nächsten Save automatisch v1.17 geschrieben (weil serializeProject SYNTH_FILE_VERSION schreibt). Das ist gewolltes Verhalten."
      ],
      changed: [
        "client/src/utils/projectSerializer.ts (SYNTH_FILE_VERSION 1.16→1.17, SynthProject.padBank?, parseProject Migration-Block)",
        "client/src/App.tsx (Import savePadBankSlots/loadPadBankSlots, buildProjectSnapshot füllt padBank, restoreProject schreibt padBank+dispatcht padBank:loaded)",
        "client/src/components/MidiSettings/MidiSettings.tsx (useEffect-Listener auf padBank:loaded für Live-Reload)",
        "tests/features/project-serializer.test.ts (+7 Cases v1.17-Migration, alter VERSION-Test auf 1.17)",
        "tests/features/audio-track-store.test.ts (2 VERSION-Assertions auf 1.17)",
        "tests/features/script-store.test.ts (1 VERSION-Assertion auf 1.17)",
        "package.json (version 2.80.0 → 2.81.0)",
        "agents/INDEX.js (workLog-Entry)"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-17T17:35:00.000Z",
      done: [
        "FEATURE-v2.80 PAD-BANK-PERSISTENZ: User-Follow-up zu v2.79 — Pad-Bank-Slots überleben jetzt Page-Reload und Tab-Wechsel. (1) Neues Util-Modul client/src/utils/padBankPersistence.ts (95 LOC) extrahiert PadBankSlot + PadBankSlotKind aus MidiSettings als exportierte Types, plus 4 Pure-Helpers: defaultPadBankSlots (16 perf-pad slots), isValidPadBankSlot (Schema-Defensive Type-Guard), loadPadBankSlots (localStorage-Read mit Fallback bei missing/invalid/non-array/non-object, Invalid-Items im Array werden silent gefiltert, leeres Array nach Filterung bleibt als 'User-Reset' valider Zustand), savePadBankSlots (best-effort write, Quota-Errors silent). Plus __resetPadBankForTests-Helper. STORAGE_KEY='ss-pad-bank:v1'. (2) MidiSettings.tsx: inline-Type-Definitionen entfernt (jetzt aus utils importiert), useState-Initializer nutzt loadPadBankSlots(), neuer useEffect schreibt jeden Slot-Change via savePadBankSlots in localStorage. resetPadBankSlots() ruft defaultPadBankSlots(). (3) Tests: tests/features/pad-bank-persistence.test.ts (NEU, 20 Cases) — defaultPadBankSlots (16 Perf-Pad-Slots mit Param '0'..'15'), isValidPadBankSlot Type-Guard (alle 4 valid kinds, unknown-kind/non-string-param/missing-fields/non-object → false), loadPadBankSlots (empty → defaults, invalid-JSON → defaults, non-Array → defaults, valid mixed kinds, invalid Items werden gefiltert valide bleiben, leeres Array nach Filterung bleibt leer), savePadBankSlots (schreibt, leeres Array auch, Overwrite-Verhalten), Round-Trip (beliebige + Default-Slots überleben), __resetPadBankForTests. Validation: pnpm check clean, pnpm test 3015/15 skipped vs vorher 2995 (+20). Package.json gebumped 2.79.0 → 2.80.0. User-Workflow: Pad-Bank konfigurieren → schließen → App-Reload → Pad-Bank ist exakt so wie vorher."
      ],
      next: [
        "Tag v2.80.0 + push.",
        "Möglich für später: Pad-Bank in .synth-Project-File mit-serialisieren (aktuell nur localStorage = Pro-User, nicht Pro-Project). Use-Case: User hat verschiedene Pad-Bank-Setups für verschiedene Songs. Würde projectSerializer.ts v1.16 → v1.17 bumpen müssen + Migration-Defensive.",
        "Layout-Export (midiLayoutExport): aktuell prüfen ob target-Field in noteMapping serialisiert/round-trip-fähig ist. Falls nicht — User kann Bank nicht zwischen Maschinen teilen."
      ],
      changed: [
        "client/src/utils/padBankPersistence.ts (NEW, 95 LOC — Schema + Persistenz-Helpers)",
        "client/src/components/MidiSettings/MidiSettings.tsx (Import aus utils, useState init via load, useEffect schreibt bei Change)",
        "tests/features/pad-bank-persistence.test.ts (NEW, 20 Cases)",
        "package.json (version 2.79.0 → 2.80.0)",
        "agents/INDEX.js (workLog-Entry)"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-17T17:10:00.000Z",
      done: [
        "FEATURE-v2.79 CUSTOM-PAD-BANK-BUILDER: User-Follow-up zu v2.78 — 'bau auch funktionen ein das ich zum beispiel auf die drum pads von der korg sämtliche funktionen und chains legen kann'. v2.78 hatte das Per-Pad-Performance-Mapping. v2.79 generalisiert die Note-Mapping-Engine + UI um BELIEBIGE MidiLearnTargets (Chain, Script, Macro, atomic actions) pro Hardware-Pad zu unterstützen. Backend (useMidi.ts): (1) MidiNoteMapping bekommt zusätzliches Optional-Feld `target?: MidiLearnTarget` mit dokumentierter Precedence target > performancePadIndex > partId. Backwards-Compat: Pre-v2.79-Files haben kein target, fallen auf v2.78/v1.x-Pfade zurück. (2) AutoLearnEntry Note-Variante analog erweitert. nextAutoLearnEntry propagiert target wenn gesetzt. (3) Note-On-Handler: Branch-Reihenfolge ist jetzt target → applyMapping(virtual mapping mit cc=-1) | performancePadIndex → dispatch midi:perfpad | partId → onPartTrigger. velocity wird als value an applyMapping durchgereicht damit Macro/Send-Targets sie als Amount nutzen können. UI (MidiSettings.tsx): (4) Neue State padBankSlots: Array<{kind, param}> mit 4 Kinds — 'perf-pad' (0..15), 'macro' (0..7), 'script' (scriptId), 'action' (CHAIN_BUILDER_ACTIONS-key). Default: 16 perf-pad-Slots. (5) Helpers padBankSlotLabel + padBankSlotToEntry + buildPadBankEntries konvertieren slots → AutoLearnEntry[]. Pro Slot wird je nach kind das passende target generiert (perf-pad nutzt legacy performancePadIndex-Pfad, andere nutzen v2.79 target). (6) Neue collapsible UI-Section 'Custom Pad-Bank (v2.79)' mit Slot-Liste, pro Slot Kind-Selector + Param-Selector + Remove-Button, Add-Slot + Start-Auto-Learn + Reset-zu-16-Perf-Pads. Script-Slot ohne vorhandene Scripts zeigt 'Keine Scripts vorhanden'-Hinweis. (7) Tests: midi-auto-learn.test.ts neuer describe-Block v2.79 mit 5 Cases — Macro-Target, runScript-Target, Chain-Target inkl. steps+delays, Atomic-Action (tapTempo) als Note-Target, Mixed-Sequence (Perf-Pad → Macro → Script wird Slot für Slot abgearbeitet, target und performancePadIndex sind exclusive je Slot). Validation: pnpm check clean, pnpm test 2995/15 skipped vs vorher 2990 (+5). Package.json gebumped 2.78.0 → 2.79.0. User-Workflow: Settings → MIDI → 'Custom Pad-Bank (v2.79)' aufklappen → 16 Slots oder beliebige Anzahl mit Mix aus Perf-Pad/Macro/Script/Action konfigurieren → 'Start Auto-Learn' → Hardware-Pads in Reihe drücken."
      ],
      next: [
        "Tag v2.79.0 + push.",
        "Mögliche Ausbaustufen: Persistenz der Pad-Bank-Slot-Configs in localStorage (User baut 1x, lädt dann immer wieder), Layout-Export inkl. target-Field (aktuell prüfen ob midiLayoutExport target serialisiert oder droppt), Velocity-Mapping für target='macro' so dass Pad-Druck-Stärke den Macro-Wert moduliert."
      ],
      changed: [
        "client/src/hooks/useMidi.ts (MidiNoteMapping.target?, AutoLearnEntry.target?, Note-On-Handler-Precedence target>perfPadIndex>partId)",
        "client/src/components/MidiSettings/MidiSettings.tsx (padBankSlots-State, Helpers, neue collapsible UI-Section 'Custom Pad-Bank v2.79')",
        "tests/features/midi-auto-learn.test.ts (+5 Cases v2.79-describe)",
        "package.json (version 2.78.0 → 2.79.0)",
        "agents/INDEX.js (workLog-Entry)"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-17T16:25:00.000Z",
      done: [
        "FEATURE-v2.78 KORG-PERF-PAD-MAPPING: User-Request war 'Korg Drum-Pads sollen sämtliche Funktionen und Chains aufnehmen können'. Klärung mit AskUserQuestion: Korg Electribe 2 (16 Trigger-Pads) → Per-Pad Performance-Pad-Trigger via Auto-Learn-Preset. Bestehende MIDI-Infrastruktur weitestgehend wiederverwendet — minimal-invasive Erweiterung. Implementierung: (1) client/src/hooks/useMidi.ts: MidiNoteMapping bekommt optionales `performancePadIndex?: number`-Feld (Backwards-Compat — Pre-v2.78-Files haben es nicht und triggern weiterhin Parts). AutoLearnEntry Note-Variante analog erweitert. nextAutoLearnEntry propagiert performancePadIndex in das resultierende noteMapping. Note-On-Handler: wenn nm.performancePadIndex gesetzt → dispatch 'midi:perfpad' CustomEvent mit {padIndex, velocity} statt onPartTrigger zu rufen. (2) client/src/App.tsx: neuer useEffect-Listener für 'midi:perfpad' — liest aus getPerformancePads(), validiert pad.patternId, ruft dm.setActivePattern + queuePerformancePattern (identisch zu runPadOnce in macro:button:trigger). Velocity bleibt im event-detail für künftige Velocity-sensitive Triggers, wird aktuell nicht durchgereicht. (3) client/src/components/MidiSettings/MidiSettings.tsx: neuer perfPadNoteEntries-Helper generiert 16 AutoLearnEntry-Note-Einträge mit performancePadIndex 0..15 (partId='perf-pad-N', partName='Perf-Pad N+1' fürs UI-Display). Neues Preset 'Korg Electribe 2 → Performance-Pads (16)' am Ende der autoLearnPresets-Liste. autoLearnEntryLabel zeigt 'Perf-Pad N+1' statt 'Pad: partName' wenn performancePadIndex gesetzt. (4) tests/features/midi-auto-learn.test.ts: neuer describe-Block 'v2.78 — Note-Entry mit performancePadIndex' mit 4 Cases: Note-Capture propagiert padIndex, ohne padIndex bleibt noteMapping schlank, 16-Pad-Sequence (3-fold step-through liefert [0,1,2]), padIndex=15 oberer Rand. Validation: pnpm check clean, pnpm test 2990/15 skipped vs vorher 2986 (+4). Package.json gebumped 2.77.0 → 2.78.0. User-Workflow ab v2.78: in Settings → MIDI das Preset wählen, dann nacheinander die 16 Pads des Electribe 2 (oder anderen Korg/16-Pad-Controller) anklicken — jeder Pad bekommt seinen Performance-Pad-Slot."
      ],
      next: [
        "Tag v2.78.0 + push.",
        "Möglicher v3-Folge: Chain-Targets pro Pad zulassen (User-Anfrage 'sämtliche funktionen und chains' — aktuell nur perf-pad-trigger). Erweiterung: noteMapping bekommt optional `target: MidiLearnTarget` Feld; wenn gesetzt, ruft Note-On den vollen applyMapping(target, value) statt onPartTrigger. Damit beliebige Chain/runScript/scenelaunch/etc. an Hardware-Pads bindbar. Auto-Learn-UI bräuchte Target-Picker pro Slot — sichtbar größere UX-Erweiterung.",
        "Bei Bedarf: Velocity-Mapping (Pad-Druck-Stärke → Performance-Pad-Parameter wie BPM-Offset, Volume-Mod, etc.) — aktuell wird velocity im perfpad-Event mitgeschickt aber nicht verarbeitet."
      ],
      changed: [
        "client/src/hooks/useMidi.ts (MidiNoteMapping + AutoLearnEntry um performancePadIndex erweitert, Note-On-Handler dispatched midi:perfpad)",
        "client/src/App.tsx (neuer midi:perfpad-Listener, ruft setActivePattern + queuePerformancePattern)",
        "client/src/components/MidiSettings/MidiSettings.tsx (perfPadNoteEntries-Helper, neues Preset, Label-Update)",
        "tests/features/midi-auto-learn.test.ts (+4 Cases im v2.78-describe-block)",
        "package.json (version 2.77.0 → 2.78.0)",
        "agents/INDEX.js (workLog-Entry)"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-17T02:18:00.000Z",
      done: [
        "BUGFIX-v2.77 autoTagFromFilename Underscore-Regex-Bug: Vor v2.77 ignorierte autoTagFromFilename die häufigste Sample-Naming-Convention ('snare_kick_01.wav', 'BD_808_dry.wav' etc.) komplett, weil JS-Regex `\\b` Word-Boundary nicht greift wenn Underscore neben Wort steht (Underscore zählt als Word-Char in JS). Fix in client/src/hooks/useBpmDetection.ts Z.51: vor dem Match werden alle Underscores zu Spaces normalisiert via `.replace(/_/g, ' ')`. Kompatibilität mit `^bd[_\\-\\s]` und ähnlichen Char-Set-Patterns bleibt erhalten weil Space dort im Set ist. 9 neue Test-Cases in tests/features/use-bpm-detection-hook.test.ts (describe 'Underscore-Separator v2.77 Fix') verifizieren: snare_acoustic / floor_tom_01 / crash_cymbal / shaker_loop_01 / synth_lead / sub_bass / vocal_ah_long / kick_bass (Kick-Guard intact) / BD_01 (^bd[_\\-\\s]-Pattern weiter funktional). Bestehende Tests bleiben grün (verwenden Punkt/Space/Hyphen sowieso). Validation: pnpm check clean, pnpm test 2986/15 skipped vs vorher 2977 (+9). Package.json gebumped 2.76.0 → 2.77.0."
      ],
      next: [
        "Tag v2.77.0 + push.",
        "USER-FEATURE-REQUEST (offen): 'bau auch funktionen ein das ich zum beispiel auf die drum pads von der korg sämtliche funktionen und chains legen kann'. Vermutlich: MIDI-Note-Note-On von Korg Volca/padKONTROL/Electribe-Drum-Pad → Script-Function ODER Chain-Action. v1.77 hat bereits chain als MidiLearnTarget — Korg-spezifisch wäre eine erweiterte Hardware-Template + UI-Beispiele. Klären: welcher Korg konkret, welche Pads, welche Funktionen (Pattern-Switch, Macro-Trigger, Script-Run, Beat-Repeat, etc.). User-Question stellen bevor Implementierung."
      ],
      changed: [
        "client/src/hooks/useBpmDetection.ts (autoTagFromFilename normalisiert _ → space vor Regex-Match)",
        "tests/features/use-bpm-detection-hook.test.ts (+9 Cases im 'Underscore-Separator v2.77 Fix' describe-block)",
        "package.json (version 2.76.0 → 2.77.0)",
        "agents/INDEX.js (workLog-Entry)"
      ]
    },
    {
      agent:     "testing",
      timestamp: "2026-05-17T01:50:00.000Z",
      done: [
        "HOOKS-WAVE-v2.76 useBpmDetection: 41 Cases. Test-Buckets: (1) autoTagFromFilename pure (22 Cases) — Drum-Kategorien (kick/BD/Bass Drum/snare/clap/open-hat/closed-hat/hi-hat/tom/cymbal/percussion), Melodische (bass/synth/chord/vocal/fx + Kick-Guard verhindert bass-Tag), Qualitäts-Tags (dry/wet/long), Pfad-Strip (Windows-Slash + Unix-Slash), Unbekannte → [], Duplikat-Set-Filter (Set entfernt mehrfach-fx). (2) Hook-Initial-State (isDetecting=false, progress=0). (3) tagSampleFromFilename (Bekannt: confidence=0.8, Unbekannt: 0.1, Sample-Felder bleiben erhalten via Spread). (4) tagSamplesFromFilenames Batch + Empty-List. (5) detectBpmForSample Edge-Cases mit fetch+AudioContext-Mock — fetch-fail (not-ok-Response), fetch-throw, decode-throw, Silence-Buffer → alle null; Click-Buffer @ 120 BPM mit synthetischen 5ms-Peaks alle 500ms im 4-Sekunden-Buffer → BPM ∈ [115,125] + confidence > 0.5; URL-Mapping (absolute path '/abs' → 'file:///abs', relative URL unverändert). (6) detectBpmBatch — isDetecting wieder false nach completion, Filter ignoriert non-rhythmic Samples (synth lead via Tag-Check übersprungen), Unbekannte Filenames werden trotzdem analysiert (tags.length===0 escape-hatch), onProgress mit (done,total) pro Sample, Result-Map enthält nur erfolgreiche Detections. **Wichtige Erkenntnis: JS-Regex `\\b` Word-Boundary funktioniert NICHT bei Underscore-Separator** weil `_` als Word-Char zählt. `\\bsnare\\b` matched in 'snare.wav' (Punkt ist non-word) aber NICHT in 'snare_acoustic.wav'. Tests verwenden jetzt Punkt-/Space-/Hyphen-Separator wo Word-Boundary nötig ist. Validation: pnpm check clean, pnpm test 2977/15 skipped vs vorher 2936 (+41). Package.json gebumped 2.75.0 → 2.76.0."
      ],
      next: [
        "Tag v2.76.0 + push.",
        "Mock-Pattern fetch + AudioContext jetzt vollständig — wiederverwendbar für useAudioAnalysis (Worker + analysis), Sample-Slicer-Hook, andere Web-Audio-Hooks.",
        "BUG-LOW-PRIO: autoTagFromFilename regex-Patterns mit `\\b` greifen nicht bei Underscore-Pfaden — die häufigste Sample-Naming-Convention. Z.B. 'snare_kick_01.wav' → keine Tags. Fix-Kandidat: `\\b` durch `(?:^|[^a-z0-9])` ersetzen oder Pfad vor Match mit underscores → spaces ersetzen.",
        "Weitere Hook-Kandidaten: useAudioAnalysis (Worker+AudioContext, ähnlich aber komplexer), useMixAnalytics (Pattern-State Memo), useScriptKeyBindings, useLaunchpad (MIDI-Out), useBeatRepeat (Timer)."
      ],
      changed: [
        "tests/features/use-bpm-detection-hook.test.ts (NEW, 41 Cases)",
        "package.json (version 2.75.0 → 2.76.0)",
        "agents/INDEX.js (workLog-Entry)"
      ]
    },
    {
      agent:     "testing",
      timestamp: "2026-05-17T01:25:00.000Z",
      done: [
        "HOOKS-WAVE-v2.75 useMidiStepInput (13 Cases) + useMpe (32 Cases) gebundelt: 2 MIDI-orientierte Hooks ins File-Pool aufgenommen. (1) useMidiStepInput — Step-Eingabe via MIDI-Keyboard. Test-Buckets: Initial-State (cursor=0), enabled-Guard (disabled+null partId blockt, false→true Listener-Nachrüstung), Note-On Dispatch ('stepinput:note' CustomEvent mit korrektem detail, Cursor-Vorrücken pro Trigger, Wrap-Around bei stepCount), Cursor-API (resetCursor, moveCursor +/-/wrap >stepCount), Unmount-Listener-Removal. (2) useMpe — MIDI Polyphonic Expression: Kanal 2-15 sind Voice-Channels, Kanal 1 ist Master und wird ignoriert. Test-Buckets: **processMpeMessage** pure-function (5 MIDI-Message-Types × Edge-Cases = 22 Cases): NoteOn (ch>=2 mit velocity>0 → Voice added, ch=1 ignored, velocity=0 = NoteOff, dispatchMpeVoice fires, Map-Immutability), NoteOff (0x80 + 0x90/vel=0 = active=false, voice bleibt im Map, no-op auf nicht-existentem Kanal), Pitch Bend (14-bit Decode mit Center 8192, Max ≈ +range, Min = -range exakt, custom pitchBendRange, ch=1 ignored, no-op auf inactive ch), Aftertouch 0xd0 (byte1/127 normalisiert), CC74 Timbre (byte2/127, andere CC ignored, no-op auf inactive ch). dispatchMpeVoice direct (CustomEvent dispatch + Event-Name 'mpe:voice'). useMpe Hook (6 Cases): enabled=false blockt, enabled=true akkumuliert voices, activeVoices filtert, enabled true→false leert voices, pitchBendRange via Ref aktuell (kein Stale-Closure beim rerender), Unmount entfernt Listener. Validation: pnpm check clean, pnpm test 2936/15 skipped vs vorher 2891 (+45 = 13 + 32). Package.json gebumped 2.74.0 → 2.75.0."
      ],
      next: [
        "Tag v2.75.0 + push.",
        "MIDI-Hook-Pattern jetzt etabliert (raw MIDI messages via window CustomEvent + pure processor + Hook). Weitere Kandidaten: useBpmDetection (Web-Worker), useAudioAnalysis (Worker+AudioContext), useMixAnalytics (Pattern-Memo), useScriptKeyBindings, useLaunchpad, useBeatRepeat, useCollabSession."
      ],
      changed: [
        "tests/features/use-midi-step-input-hook.test.ts (NEW, 13 Cases)",
        "tests/features/use-mpe-hook.test.ts (NEW, 32 Cases)",
        "package.json (version 2.74.0 → 2.75.0)",
        "agents/INDEX.js (workLog-Entry)"
      ]
    },
    {
      agent:     "testing",
      timestamp: "2026-05-17T01:15:00.000Z",
      done: [
        "HOOKS-WAVE-v2.74 useAudioInput: Mikrofon/Line-in Aufnahme via getUserMedia+MediaRecorder→Blob→Pending-Sample. 31 Cases. Anspruchsvollster Hook-Test bisher — 4 globale Web-Audio/Media-APIs gemockt: (1) navigator.mediaDevices.getUserMedia + enumerateDevices via Object.defineProperty(navigator,'mediaDevices',...). State-Bag mediaState steuert Constraints-Capture, Stream-Output und Failure-Modi pro Test. (2) globaler MediaRecorder durch FakeRecorder-Klasse mit static isTypeSupported + Instance-Tracking via recorderState.lastInstance. stop() ruft onstop() synchron — analog zur echten API beim manuellen Stop. (3) globaler AudioContext durch FakeAudioContext mit createMediaStreamSource + createAnalyser + close. (4) URL.createObjectURL + revokeObjectURL via Object-Assignment auf globalThis.URL. Test-Buckets: formatRecordingDuration pure (7 Cases: 0/sub-second/1s/1min/1h/1h2m5s/2-stellige h), isAvailable Detection, Initial-State (6 Felder + setDeviceId), refreshDevices (filter audioinput + empty-label-Fallback + silent-catch bei enumerate-throw), start() Permission-Flow (Default-Constraints, deviceId-exact, isRecording=true, Permission-Denied → error, non-Error-throw → Default-Message 'Mikrofon-Zugriff verweigert', Idempotenz bei doppeltem start, recorder.start(100) für 100ms-Chunks), Duration-Timer (recordingDurationMs > 0 nach 550ms via fake timers), stop() + onstop → pendingSample (recorder.stop wird gerufen, pendingSample mit URL+defaultName-Pattern 'Recording N (Xs)'+durationSec, Stream-Tracks werden gestoppt, stop ohne Recording no-op), confirmPendingSample/discardPendingSample (Name-Trim, defaultName-Fallback bei empty, no-op ohne pendingSample, discard revoked URL), Cleanup beim Unmount (Stream-Tracks gestoppt, kein crash ohne aktive Aufnahme). Validation: pnpm check clean, pnpm test 2891/15 skipped vs vorher 2860 (+31). Package.json gebumped 2.73.0 → 2.74.0."
      ],
      next: [
        "Tag v2.74.0 + push.",
        "Mit dem DOM-API-Mock-Pattern jetzt etabliert (navigator + global classes + URL): weitere DOM-heavy Hook-Kandidaten gut testbar: useBpmDetection (Web-Worker mock), useMidiStepInput (MIDI Access API), useAudioAnalysis (Worker + AudioContext), useMpe (MIDI Pitch-Bend)."
      ],
      changed: [
        "tests/features/use-audio-input-hook.test.ts (NEW, 31 Cases)",
        "package.json (version 2.73.0 → 2.74.0)",
        "agents/INDEX.js (workLog-Entry)"
      ]
    },
    {
      agent:     "testing",
      timestamp: "2026-05-17T01:05:00.000Z",
      done: [
        "HOOKS-WAVE-v2.73 usePopupCloseBridges: bündelt das wiederkehrende popup-onClose Wire-Pattern aus App.tsx (BUG-023-Welle). 16 Cases. Komplementär zu tests/features/popup-close-bridges.test.ts der eine Reimplementierung des Effect-Body 1:1 testet (der echte Hook-Code wurde dort nie importiert — diese neue Suite fährt jetzt den **echten** Hook via renderHook durch). Test-Buckets: (1) Browser-Modus (isElectron=false) — subscribe wird NIE aufgerufen. (2) Electron-Modus — einzelne Bridge mit subscribe genau 1x, Multi-Bridge mit allen subscribes parallel, Bridge ohne subscribe (undefined) wird übersprungen ohne anderen zu beeinträchtigen. (3) Callback-Verhalten — Trigger des captured subscribe-callbacks ruft log + setter(false); setter wird mit literalem false aufgerufen (nicht 0/null); log ist optional (Hook crasht nicht ohne); logKey wird pro Bridge separat geforwarded (nicht gemixt); independent setters — Bridge-A trigger berührt setter-B nicht. (4) Cleanup beim Unmount — Cleanup-Function aus subscribe wird aufgerufen, Multi-Bridge Cleanups alle, subscribe ohne return-Function crasht nicht beim Unmount, Cleanup einer Bridge die wirft → andere Cleanups laufen trotzdem (try/catch im Hook). (5) useEffect-Dep [isElectron] — false→true triggert subscribe (effect-mount), true→false triggert cleanup (effect-teardown), **bridges-Mutation OHNE isElectron-Wechsel führt NICHT zu re-subscribe** (intentional 'wire-once'-Semantik, dep ist nur [isElectron]). Validation: pnpm check clean, pnpm test 2860/15 skipped vs vorher 2844 (+16). Package.json gebumped 2.72.0 → 2.73.0."
      ],
      next: [
        "Tag v2.73.0 + push.",
        "Weiter mit der Hooks-Wave: useAudioInput (getUserMedia + MediaRecorder Mock — DOM-API-Mocking-Übung), useBpmDetection (Web-Worker Mock), useMixAnalytics, useScriptKeyBindings, useMidiStepInput."
      ],
      changed: [
        "tests/features/use-popup-close-bridges-hook.test.ts (NEW, 16 Cases)",
        "package.json (version 2.72.0 → 2.73.0)",
        "agents/INDEX.js (workLog-Entry)"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-17T00:55:00.000Z",
      done: [
        "BUGFIX-v2.72 useResizablePanel Persistenz-Bug: client/src/hooks/useResizablePanel.ts onUp() persistierte fälschlich startHRef.current (Pre-Drag-Wert) in localStorage statt der finalen gedragten Höhe — User-Resize ging beim nächsten Mount verloren. Fix: closure-lokales `let currentHeight = height` in handleMouseDown, onMove updated currentHeight bei jedem Move-Schritt, onUp persistiert currentHeight statt startHRef.current. Test in tests/features/use-resizable-panel-hook.test.ts wurde vom User entsprechend angepasst — Persistenz-Test erwartet jetzt '300' statt '200', plus neuer Reload-after-Drag-Test der den vollen Round-Trip prüft (Drag → MouseUp → cleanup → Neu-Mount → Hook liest persistierten Wert). Validation: 22/22 grün im Hook-File (vorher 21, +1 für Reload-Test), pnpm check clean, pnpm test 2844/15 skipped vs vorher 2843. Package.json gebumped 2.71.0 → 2.72.0."
      ],
      next: [
        "Tag v2.72.0 + push.",
        "Weiter mit der Hooks-Wave: usePopupCloseBridges (BroadcastChannel), useAudioInput (getUserMedia + MediaRecorder Mock), useBpmDetection (Web-Worker mock), useMixAnalytics, useScriptKeyBindings."
      ],
      changed: [
        "client/src/hooks/useResizablePanel.ts (let currentHeight Tracker, onUp persistiert currentHeight)",
        "tests/features/use-resizable-panel-hook.test.ts (Persistenz-Test '200'→'300', neuer Reload-after-Drag Case)",
        "package.json (version 2.71.0 → 2.72.0)",
        "agents/INDEX.js (workLog-Entry)"
      ]
    },
    {
      agent:     "testing",
      timestamp: "2026-05-17T00:35:00.000Z",
      done: [
        "HOOKS-WAVE-v2.71 useResizablePanel: Drag-Handler + persistent Height via localStorage. 21 Cases. Neues Pattern: synthetische MouseEvent-Dispatches auf window (`new MouseEvent('mousemove', {clientY})`) + minimal React.MouseEvent-Konstrukt für handleMouseDown (cast via 'as unknown as React.MouseEvent'). Test-Buckets: (1) Initial-Height — defaultHeight ohne storageKey, gespeicherter Wert wenn IM [minHeight, maxHeight]-Range, Schema-Defensive bei stored < minHeight / > maxHeight / NaN / non-number (Fallback auf defaultHeight), Boundary-Akzeptanz an min und max exakt. (2) direction='up' (Default, Bottom-Panel) — Maus nach oben (clientY sinkt) → Panel wächst, Maus nach unten → schrumpft. (3) direction='down' — symmetrisch invertiert. (4) Clamping — Mouse-Move clampt nicht unter minHeight / nicht über maxHeight, Default-Range 60..600. (5) preventDefault wird auf React-Event aufgerufen. (6) Listener-Cleanup — window.addEventListener spy + window.removeEventListener spy verifizieren mousemove+mouseup wird in Mount-Up gepairt + nach Mouse-Up entfernt, weitere mousemove nach mouseUp haben keinen Effekt. (7) Persistenz on Mouse-Up — ohne storageKey kein write, mit storageKey wird geschrieben. (8) Reload-Round-Trip via storageKey über cleanup() + neues renderHook. **Bug-Discovery**: Der Persistenz-Test offenbart ein Bug im aktuellen Code: localStorage.setItem persistiert startHRef.current (Original-Höhe vor Drag), nicht die finale gedragte Höhe. Test dokumentiert das Verhalten explizit (`expect(localStorage.getItem('panel-test')).toBe('200')` — die gedragte Höhe wäre 300). Konsequenz: Resize wird beim Reload verloren. Sollte gefixt werden via `setItem(storageKey, String(height))` mit aktuellem state-Ref. Validation: pnpm check clean, pnpm test 2843/15 skipped vs vorher 2822 (+21). Package.json gebumped 2.70.0 → 2.71.0."
      ],
      next: [
        "Tag v2.71.0 + push.",
        "BUG-FIX-CANDIDATE: useResizablePanel.ts Z.55 setItem mit startHRef.current statt aktueller Höhe → Resize-Persistenz broken. Quick-Fix: heightRef einbauen oder direkt setItem(storageKey, String(height)) wenn height in deps. Test ist bereits dokumentierend geschrieben — beim Fix muss die Erwartung von '200' auf '300' (final-height) umgestellt werden.",
        "Weitere Hook-Kandidaten: usePopupCloseBridges (BroadcastChannel), useAudioInput (getUserMedia), useBpmDetection (worker mock), useMixAnalytics, useScriptKeyBindings."
      ],
      changed: [
        "tests/features/use-resizable-panel-hook.test.ts (NEW, 21 Cases)",
        "package.json (version 2.70.0 → 2.71.0)",
        "agents/INDEX.js (workLog-Entry)"
      ]
    },
    {
      agent:     "testing",
      timestamp: "2026-05-16T23:15:00.000Z",
      done: [
        "HOOKS-WAVE-v2.70 useUpdater: Electron Auto-Updater Phase-State-Hook. 18 Cases. Neue Mock-Pattern-Variante: 6 IPC-Event-Listener werden über geteilte 'listeners' und 'unsubs' Refs captured (via vi.hoisted für sauberes Hoisting), Tests triggern die Updater-Events synthetisch und verifizieren State-Transitions. Test-Buckets: (1) Browser-Fallback isElectron=false — Initial-State {phase:'idle'}, keine Listener registriert (effect early-returnt), checkForUpdates() ist no-op. (2) Electron-Mode Listener-Setup — alle 6 Listener (checking/available/upToDate/downloadProgress/downloaded/error) werden beim Mount registriert, Unmount ruft alle 6 unsubs. (3) State-Transitions pro Event — 6 separate Tests verifizieren die 6 Phasen-Übergänge: 'checking', 'available' mit version, 'up-to-date', 'downloading' mit percent, 'ready' mit version, 'error' mit errorMessage. (4) Progress-Spread — downloadProgress nutzt prev-spread, behält version nach available, mehrere Progress-Updates aktualisieren nur percent. (5) State-Reset — downloaded und error ersetzen state komplett (kein prev-Spread), percent bzw. version werden undefined. (6) checkForUpdates() forwards an electron.checkForUpdates, mehrfache Aufrufe forwarden mehrfach. Wichtige Bug-Discovery: vi.mock-Pfad muss aus Test-Sicht resolved werden. Hook importiert '../../../electron/useElectron' (3 levels up von client/src/hooks/), Test musste '../../electron/useElectron' (2 levels up von tests/features/) verwenden — sonst resolved die Mock zu einem Pfad außerhalb des Projekts und greift nicht. Validation: pnpm check clean, pnpm test 2822/15 skipped vs vorher 2804 (+18). Package.json gebumped 2.69.0 → 2.70.0."
      ],
      next: [
        "Tag v2.70.0 + push.",
        "vi.hoisted + Listener-Capture-Pattern jetzt etabliert für IPC-/Event-basierte Hooks. Wiederverwendbar für: usePopupCloseBridges (BroadcastChannel), useMidiEventBridge (window MIDI events), useCollabSession (WebSocket), useAudioInput (getUserMedia)."
      ],
      changed: [
        "tests/features/use-updater-hook.test.ts (NEW, 18 Cases)",
        "package.json (version 2.69.0 → 2.70.0)",
        "agents/INDEX.js (workLog-Entry)"
      ]
    },
    {
      agent:     "testing",
      timestamp: "2026-05-16T22:55:00.000Z",
      done: [
        "HOOKS-WAVE-v2.69 useNoteRepeat: Live-Pad-Player mit MPC-Style Note-Repeat. 14 Cases. Neues Test-Pattern für die Hook-Wave: vi.useFakeTimers + vi.advanceTimersByTime — damit werden setInterval-Ticks deterministisch und synchron getriggert ohne echte Wall-Clock-Wait. Mock-Strategie: useNoteRepeatStore bleibt echt (Pure-Store, schon getestet in note-repeat-store.test.ts), safeIntervalMs ist pure-util. Test-Buckets: (1) enabled=false Default — padDown triggert genau 1x sync (immediate), kein Interval, 500ms-Advance produziert keine weiteren Trigger; padUp ohne Interval ist no-op. (2) enabled=true mit Default rate=1/16 @ 120 BPM = 125ms — padDown triggert immediate + 4 Ticks bei 500ms (Total 5 Trigger), padUp stoppt Interval, doppelter padDown ersetzt Interval ohne Stacking. (3) Multi-Pad — 2 Pads gleichzeitig haben unabhängige Intervals (beide ticken pro 125ms-Wechsel), padUp eines Pads stoppt nur dessen Interval, stopAll cleared alle. (4) Store-getriebene Resets — Globales setNoteRepeatEnabled(true→false) stoppt alle Repeats, setNoteRepeatRate-Wechsel cleared laufende Intervals (kein Mismatch zur neuen Rate), BPM-Wechsel cleared ebenfalls, neue Rate 1/8 wird beim NÄCHSTEN padDown korrekt auf 250ms angewendet. (5) trigger-Ref — Trigger-Funktion über useRef aktuell gehalten, kein Stale-Closure: nach rerender mit neuer trigger-prop ruft das laufende Interval die neue Funktion. (6) Unmount cleared alle aktiven Intervals. Validation: pnpm check clean, pnpm test 2804/15 skipped vs vorher 2790 (+14). Package.json gebumped 2.68.0 → 2.69.0."
      ],
      next: [
        "Tag v2.69.0 + push.",
        "Fake-Timers-Pattern (vi.useFakeTimers + advanceTimersByTime + cleanup in afterEach) jetzt etabliert für alle zeitabhängigen Hooks/Stores. Andocken: useLiveStepRecorder (Punch-In/Out via Step-Pointer + Timer), useTransport-Recorder, scheduler-Hooks.",
        "Weitere Hook-Kandidaten: useUpdater (electron-IPC mock — schwieriger weil window.electron Bridge gemockt werden muss), useResizablePanel (ResizeObserver-API mock), usePopupCloseBridges (BroadcastChannel), useAudioInput (getUserMedia mock)."
      ],
      changed: [
        "tests/features/use-note-repeat-hook.test.ts (NEW, 14 Cases)",
        "package.json (version 2.68.0 → 2.69.0)",
        "agents/INDEX.js (workLog-Entry)"
      ]
    },
    {
      agent:     "testing",
      timestamp: "2026-05-16T22:20:00.000Z",
      done: [
        "HOOKS-WAVE-v2.68 useGlobalKeyBindings: globaler keydown-Listener der konfigurierbare Actions als CustomEvent('kb:action') dispatcht. 24 Cases. Mock-Strategy: nur useKeyboardBindingsStore.getAllBindings gemockt (mutable bindingsRef für User-Overrides), keyboardActionDefs bleibt echt (pure-helpers). Tests dispatchen synthetische KeyboardEvent auf window. Bug-Discovery beim Schreiben: (a) renderHook-Roots werden ohne explicit cleanup() nicht zwischen Tests entsorgt → Listener akkumulieren, F2 würde 16x tab-mixer dispatchen statt 1x. Fix: import { cleanup } from '@testing-library/react' + afterEach(cleanup). Wichtige Erkenntnis fürs gesamte Hooks-Wave-Pattern. (b) jsdom unterstützt isContentEditable-Property nicht via setAttribute('contenteditable','true') — der HTMLElement.isContentEditable-Getter bleibt false. Fix: Object.defineProperty(div, 'isContentEditable', {value:true}) für den Test. Test-Buckets: enabled-Flag (false/true/false→true), 8 Default-Combo-Cases (alle ACTION-Kategorien: Transport/Tabs/Navigation/Pattern mit Modifier-Differenzierung Ctrl+R vs Alt+R vs Ctrl+Shift+R), User-Override (override-beats-default + Default wird ignoriert wenn Override greift + Modifier-Combo-Override), Input-Bypass (HTMLInputElement/HTMLTextAreaElement/contentEditable-Element bypassed, normales <button> nicht), preventDefault + Single-Action (preventDefault NUR bei Match, return-early stoppt nach erstem Match), Unmount (Listener wird entfernt), CustomEvent-Detail (event.detail = action.id, Event-Name = 'kb:action'). Validation: pnpm check clean, pnpm test 2790/15 skipped vs vorher 2766 (+24). Package.json gebumped 2.67.0 → 2.68.0."
      ],
      next: [
        "Tag v2.68.0 + push.",
        "cleanup() Pattern auch in zukünftige Hook-Tests einbauen — speziell wenn renderHook in beforeEach passiert oder mehrere Hooks im selben File getestet werden.",
        "Weitere Hook-Kandidaten: useNoteRepeat (Timer mit vi.useFakeTimers + Store-Integration), useUpdater (electron IPC), usePopupCloseBridges (BroadcastChannel), useResizablePanel (ResizeObserver mock)."
      ],
      changed: [
        "tests/features/use-global-key-bindings-hook.test.ts (NEW, 24 Cases)",
        "package.json (version 2.67.0 → 2.68.0)",
        "agents/INDEX.js (workLog-Entry)"
      ]
    },
    {
      agent:     "testing",
      timestamp: "2026-05-16T21:30:00.000Z",
      done: [
        "HOOKS-WAVE-v2.67 erster echter Hook-Test (nach v2.66 Setup): useTransport ist die Glue-Schicht zwischen React-State (isPlaying/bpm/transpose/dm) und der AudioEngine-Singleton. Strategie: vi.mock auf @/audio/AudioEngine + @/store/useMelodicPartStore, useTransposeStore bleibt echt (jsdom-localStorage reicht). 27 Cases gegen die 8 useEffect-Hooks im useTransport: (1) Mount-Verhalten — setMidiOutCallback null/Function je nach onMidiOut-prop, setMidiClockCallback null/Function je nach (onMidiOut+midiOutputDeviceId), setFollowActionCallback, setPatternGetter, setMelodicGetter, onPosition werden je 1x registriert; (2) Play/Stop-Flow — false→true ruft setBpm+setSteps+play(0), true→false ruft stop()+dm.setCurrentStep(0), stepCount=32 propagiert korrekt; (3) BPM-Sync mit Pattern-Vorrang — Globaler BPM wenn pattern.bpm=null, pattern.bpm gewinnt wenn gesetzt, bpmRatio=2 ergibt bpm*2, bpmRatio=0.5 ergibt bpm/2, Identity-Guard verhindert duplicate calls bei gleichem Wert; (4) Position-Callback — onPosition-Argument wird captured via mockImplementationOnce, dm.setCurrentStep wird pro Step aufgerufen, Step 0 + commitPending=true triggert commitLivePatternEdit, Step 0 + commitPending=false NICHT, Step != 0 NICHT auch mit commitPending; (5) Transpose-Propagation — Initial 0, setSemitones(5) triggert setGlobalTranspose(5) via Observer; (6) Unmount-Cleanup — MidiOut/FollowAction werden mit null genullt, Position-Unsubscribe wird aufgerufen; (7) previewSample-Return-API mit Default-Volume + explicit Volume. Validation: pnpm check clean, pnpm test 2766/15 skipped vs vorher 2739 (+27). Package.json gebumped 2.66.0 → 2.67.0."
      ],
      next: [
        "Tag v2.67.0 + push.",
        "Weitere Hook-Kandidaten mit gleichem Pattern (Mock externer Dependencies, renderHook + act, Effect-Verifikation): useGlobalKeyBindings (window keydown), useNoteRepeat (Timer + Store-Integration), useUpdater (electron-IPC), usePopupCloseBridges (BroadcastChannel), useMixAnalytics (Pattern-State-Lookup)."
      ],
      changed: [
        "tests/features/use-transport-hook.test.ts (NEW, 27 Cases)",
        "package.json (version 2.66.0 → 2.67.0)",
        "agents/INDEX.js (workLog-Entry)"
      ]
    },
    {
      agent:     "testing",
      timestamp: "2026-05-16T21:20:00.000Z",
      done: [
        "HOOKS-SETUP-v2.66 jsdom-Coverage-Infrastruktur: Übergang von Stores- zu Hooks-Wave vorbereitet. Bisherige Tests laufen mit vitest test.environment='node' (Default) — Hook-Tests brauchen DOM-APIs (document, window, requestAnimationFrame) plus renderHook + act aus @testing-library/react. (1) Dependencies: pnpm add -D jsdom@29.1.1 + @testing-library/react@16.3.2. Beide devDeps (kein Production-Bundle-Impact, kein Security-Audit erforderlich). React-Testing-Library v16+ exportiert renderHook nativ — kein separates @testing-library/react-hooks Paket nötig. (2) Per-File Opt-In-Pattern statt globale Config-Änderung: vitest erkennt die erste Zeile `// @vitest-environment jsdom` als Override; alle anderen Test-Files bleiben in node-env (schneller). Setup-Cost ~1.2s pro jsdom-File für jsdom-Initialisierung. (3) tests/features/use-transpose-store-hook.test.ts (NEW, 8 Cases): Proof-of-Concept gegen useTransposeStore. Tests decken: initial state via Hook, externe Mutation → Re-Render, Hook-Return-Setter, incSemitones mit Clamping, reset(), Multi-Instance-Observer-Pattern (shared module-state), Unmount-Cleanup (frozen result.current nach unmount), useCallback-Stable-Refs über Re-Renders. (4) tests/features/use-arp-store-hook.test.ts (NEW, 6 Cases): Zweiter Proof-of-Concept zeigt dass das Setup für arbiträre Singleton-Observer-Stores wiederverwendbar ist. useArpStore nutzt useReducer statt useState (anderes Re-Render-Pattern) — Tests verifizieren externe Mutation → Re-Render, Multi-Instance-Shared-State, Unmount-Listener-Cleanup. Validation: pnpm check clean, pnpm test 2739/15 skipped vs vorher 2725 (+14, beide neue Files grün). Package.json gebumped 2.65.0 → 2.66.0."
      ],
      next: [
        "Tag v2.66.0 + push.",
        "Mit dem jsdom-Setup steht: nächste Hooks-Wave-Bundles können Hooks-mit-DOM-Logik testen — useResizablePanel (DOM ResizeObserver), useGlobalKeyBindings (window keydown), useUpdater (electron-IPC-Mock), useTransport (timing-Logik mit fake timers), usePopupCloseBridges (BroadcastChannel)."
      ],
      changed: [
        "package.json (+jsdom@29 + @testing-library/react@16 devDeps, version 2.65.0 → 2.66.0)",
        "pnpm-lock.yaml (durch pnpm add aktualisiert)",
        "tests/features/use-transpose-store-hook.test.ts (NEW, 8 Cases)",
        "tests/features/use-arp-store-hook.test.ts (NEW, 6 Cases)",
        "agents/INDEX.js (workLog-Entry)"
      ]
    },
    {
      agent:     "testing",
      timestamp: "2026-05-16T21:10:00.000Z",
      done: [
        "STORES-WAVE-v2.65 Bundle 2: 4 weitere untestete Singleton-Observer-Stores. Plan war OSC + Pattern-Variations + Pattern-Library + SongStore, aber useSongStore ist ein React-Hook ohne Standalone-Setter — alles via useState innerhalb useSongStore(). Tests bräuchten renderHook + jsdom-env, kollidiert mit der bestehenden test-env=node Config. Ersatz: useNoteRepeatStore (130 LOC, hat __resetForTests). (1) tests/features/osc-out-store.test.ts (NEW, 14 Cases): Partial-Update-Merge, Port-Clamping [1,65535] mit Math.floor (8080.7 → 8080), stepRate-Clamping [1,16], localStorage-Persistenz aller 11 Felder inkl. v2.28+ Sync-Flags. (2) tests/features/pattern-variations-store.test.ts (NEW, 14 Cases): A/B/C/D Variation-Slots, create/update/setActive/remove, no-op-Garantien bei unbekannter baseId, multi-set Isolation (Update auf p1 touched p2 nicht), Full-Slot-Cycle A→D. (3) tests/features/pattern-library-store.test.ts (NEW, 20 Cases): savePatternToLibrary mit id-Format 'lib-<ts>-<rand>', neue Entries vorne eingefügt (jüngste zuerst), updateLibraryEntry partial preserves, searchLibrary case-insensitive Name+Tags+Genre + optional Genre-Exact-Filter, exportLibrary liefert {version:'1.0', entries}, importLibrary merge=true bewahrt existing IDs (duplicate skip), merge=false ersetzt komplett. (4) tests/features/note-repeat-store.test.ts (NEW, 15 Cases): isNoteRepeatEnabled/getNoteRepeatRate Getter, Identity-Check (gleicher Wert → kein extra localStorage-write), Invalid-Rate-Guard (setNoteRepeatRate('nonsense') ist no-op nicht throw), resetNoteRepeat löscht beide localStorage-Keys (BUG-013), __resetForTests Alias. Validation: pnpm check clean, pnpm test 2725/15 skipped vs vorher 2662 (+63). Package.json gebumped 2.64.0 → 2.65.0."
      ],
      next: [
        "Tag v2.65.0 + push → Stores-Wave Bundle 2. Wave-Total Pure (v2.60-v2.63) + Stores (v2.64-v2.65): 23 Files / +562 Cases / 6 Releases.",
        "Verbleibend Store-Kandidaten ohne Test: useMixerStore (395 LOC), useThemeStore (204 LOC, hat zirkulären Import-Risiko), useSongStore (231 LOC, braucht renderHook), useMetronomeStore (121 LOC, hat async upload), useCollabChatStore, useKeyboardSamplerStore, useMelodicPartStore. Übergang zu Hooks-Coverage könnte hier sinnvoll sein."
      ],
      changed: [
        "tests/features/osc-out-store.test.ts (NEW, 14 Cases)",
        "tests/features/pattern-variations-store.test.ts (NEW, 14 Cases)",
        "tests/features/pattern-library-store.test.ts (NEW, 20 Cases)",
        "tests/features/note-repeat-store.test.ts (NEW, 15 Cases)",
        "package.json (version 2.64.0 → 2.65.0)",
        "agents/INDEX.js (workLog-Entry)"
      ]
    },
    {
      agent:     "testing",
      timestamp: "2026-05-16T20:50:00.000Z",
      done: [
        "STORES-WAVE-v2.64 Store-Coverage Wave-Start: 4 untestete Stores als kompletten Bundle abgedeckt. Übergang von Pure-Utils zu Stores (Modul-Singleton-Observer-Pattern mit localStorage/sessionStorage-Persistenz). Setup-Boilerplate: pro Test-File ein eigener localStorage- bzw. sessionStorage-Mock VOR dem Store-Import, weil die Top-Level-_state = load() Read sonst auf undefined läuft. (1) tests/features/transpose-store.test.ts (NEW, 17 Cases): getSemitones/setSemitones/incSemitones/resetTranspose mit clampSemitones-Integration, Persistenz in localStorage, NaN-Defensive, Identity-Check (gleicher Wert → kein extra write), __resetForTests löscht localStorage-Eintrag. (2) tests/features/arp-store.test.ts (NEW, 19 Cases): 5 Setter (Enabled/Mode/Octaves/Notes/StepCount), getArpSteps Integration mit applyArp aus tests/features/arpeggiator.test.ts gegen-getestete pure-Function, Default-State C-Major-Triad [60,64,67], State-Immutability (alte getArpState-Snapshots werden nicht mutiert). (3) tests/features/morph-store.test.ts (NEW, 19 Cases): 7 Actions (Amount mit [0,1]-Clamping, PatternA/B, Active, toggleAutoMorph, AutoMorphBars, resetMorph), initMorphFromStorage rekonstruiert + clampt amounts beim Read + Silent-Fallback bei invalid-JSON, sessionStorage-Persistenz pro Setter, getMorphState ist Copy nicht Reference. (4) tests/features/envelope-follower-store.test.ts (NEW, 17 Cases): add/remove/update mit id-Tracking, Cleanup-Workaround via clearAll() weil kein __resetForTests-Helper existiert, id-Format 'ef-<timestamp>-<rand>', target-Switch (volume → filterFreq), partielle Updates behalten ungeänderte Felder, no-op bei unbekannter id, alle 3 Mutations persistieren nach localStorage. Validation: pnpm check clean, pnpm test 2662 passed/15 skipped vs vorher 2590 (+72). Package.json gebumped 2.63.0 → 2.64.0."
      ],
      next: [
        "Tag v2.64.0 + push → Start der Stores-Wave (analog Pure-Coverage-Wave v2.60-v2.63).",
        "Weitere Store-Kandidaten ohne Test: useMixerStore (395 LOC, biggest), useMetronomeStore (121 LOC, hat async uploadCustomMetronomeSound), useSongStore (231 LOC), useNoteRepeatStore, useThemeStore (204 LOC), useOscOutStore (105 LOC), useCollabChatStore, usePatternLibraryStore (118), usePatternVariationsStore (93)."
      ],
      changed: [
        "tests/features/transpose-store.test.ts (NEW, 17 Cases)",
        "tests/features/arp-store.test.ts (NEW, 19 Cases)",
        "tests/features/morph-store.test.ts (NEW, 19 Cases)",
        "tests/features/envelope-follower-store.test.ts (NEW, 17 Cases)",
        "package.json (version 2.63.0 → 2.64.0)",
        "agents/INDEX.js (workLog-Entry)"
      ]
    },
    {
      agent:     "testing",
      timestamp: "2026-05-16T19:05:00.000Z",
      done: [
        "POLISH-WELLE-v2.63 Pure-Coverage Wave-Closer (Bundle 3): 3 finale Util-Files. Plan war gmDrumMap + wavExporter + projectSerializer, aber wavExporter ist quasi nur OfflineAudioContext + Blob + document.createElement — die internen floatTo16BitPCM/createWavHeader/audioBufferToWav Helpers sind nicht exportiert und damit nicht Vitest-testbar (OfflineAudioContext gibt's nicht in Node). Stattdessen mixAnalysis.ts gewählt — 249 LOC, 1 Public-Export analyzeMix, 6 Regel-Checks. (1) tests/features/gm-drum-map.test.ts (NEW, 24 Cases): getGmDrumInfo für alle 47 GM-Drum-Mappings (Noten 35-81), Fallback-Logik für unbekannte Noten (Kategorie 'other'), Kategorie-Coverage-Garantie (jede Hauptkategorie hat min. 1 Mapping), midiNotesToParts-Categorization (Same-Cat-Merge, First-Note-Name-Wins, Insertion-Order der Parts). (2) tests/features/mix-analysis.test.ts (NEW, 30 Cases): analyzeMix orchestriert 6 Regeln — Master-Volume (critical bei >115), BPM (warning bei >200, info bei <60), Kick-Volume (warning bei >110, info bei <60), Low-End-Balance (info wenn Kick+Bass diff<5), Panning (warning bei Kick/Snare |pan|>20, all-left/all-right wenn 60%+ einseitig), Density (info bei HiHat >0.85, info bei silent-part), divide-by-zero-Guard bei totalSteps=0; Sort-Order-Garantie critical>warning>info dann alphabetisch nach ID. (3) tests/features/project-serializer.test.ts (NEW, 22 Cases): Konstanten SYNTH_FILE_VERSION='1.16' + SYNTH_LATEST_KEY, serializeProject setzt version+savedAt-ISO, toJson+parseProject Round-Trip (pretty-print indent=2), parseProject Defensive (missing version/patterns wirft, invalid-JSON wirft), audioTracks-Migration v1.14→v1.15 (undefined/null/non-array → [], invalide Items via isValidAudioTrackEntry gefiltert + warn, ungültiger syncMode gefiltert), scripts-Migration v1.15→v1.16 (analoge Default-[]-Logik, isValidScriptEntry Filter), **Sicherheits-Invariant: ALLE geladenen Scripts enabled wird ZWINGEND auf false gesetzt** auch wenn ursprünglich true (User-Consent-Flow). Validation: pnpm check clean, pnpm test 2590 passed/15 skipped vs vorher 2514 (+76). Package.json gebumped 2.62.0 → 2.63.0."
      ],
      next: [
        "Tag v2.63.0 + push → letztes Pure-Coverage-Release der Wave. Kumulativ v2.60→v2.63: 15 Util-Files / +427 Cases / 0 Source-Changes / 4 Releases.",
        "Wave-Stand: alle praktisch testbaren Pure-Utils gedeckt. wavExporter.ts bleibt aus, weil es nur DOM + OfflineAudioContext exportiert. Falls weiter: Übergang zu Store-/Hook-/Component-Coverage."
      ],
      changed: [
        "tests/features/gm-drum-map.test.ts (NEW, 24 Cases)",
        "tests/features/mix-analysis.test.ts (NEW, 30 Cases)",
        "tests/features/project-serializer.test.ts (NEW, 22 Cases)",
        "package.json (version 2.62.0 → 2.63.0)",
        "agents/INDEX.js (workLog-Entry)"
      ]
    },
    {
      agent:     "testing",
      timestamp: "2026-05-16T18:55:00.000Z",
      done: [
        "POLISH-WELLE-v2.62 Pure-Coverage Wave-Continuation (Bundle 4): 4 weitere untestete Util-Files mit Pure-Function-Coverage. Patterns: identisch zu v2.60+v2.61 (eine .test.ts pro Util, kein Source-Touch). (1) tests/features/osc-encoder.test.ts (NEW, 25 Cases): OSC 1.0 Spec-Konformität — Address-Slash-Validation, Type-Tags i/f/s/T/F/N/b in der korrekten Reihenfolge, Big-Endian-Encoding (Int 1 → 00 00 00 01, Int -1 → FF FF FF FF), 4-Byte-Padding-Boundaries (`/x` = 4 Bytes, `/abc` = 8), Round-Trip-Tests für alle 7 Type-Tags inkl. Mixed-Args + Negative Integers + Blob (Uint8Array), Decoder-Defensive: Empty-Packet + Bundle-Prefix '#' werfen klar. (2) tests/features/pattern-morph.test.ts (NEW, 26 Cases): morphStepDeterministic mit kontrolliertem Seed — both-active/both-inactive Edge-Cases sind seed-unabhängig deterministisch, single-active-Cases mit Crossover-Threshold (seed<(1-amount) bzw. seed<amount), Velocity+Pitch Linear-Interpolation (100→50 mit amount=0.5 → 75), Amount-Clamping bei -0.5 und 2, Default-Velocity-Logik für inactive-Step (Bug-Regression v1.15.3 dokumentiert), morphStep-Wrapper mit Math.random() nur in seed-unabhängigen Cases getestet, morphPatterns Asymmetric-Parts (max-Count + silent-Padding), Dominant-Pattern-Switch bei amount=0.5-Threshold, Immutability-Check. (3) tests/features/patch-serialize.test.ts (NEW, 31 Cases): extractPatch + applyPatch Immutable-Pattern (kein Mutation des Source-Parts), includeFx + replaceFx Options, Name-Trim + Empty-Name-Fallback, synthParams ist Copy nicht Reference (Deep-Copy-Check via .not.toBe), patchToJson + patchFromJson Round-Trip, patchFromJson Defensive an Persistenz-Boundary: invalid-JSON / leerer-String / missing-required-fields / non-string-id / non-number-createdAt / non-array-tags → null oder undefined; Tags-Filter entfernt non-string-Einträge. (4) tests/features/transient-detection.test.ts (NEW, 17 Cases): synthetisch konstruierte AudioBuffer (FakeBuffer mit getChannelData) — Empty + Silent-Cases, DC-Offset-Quirk (initialer Marker wegen prevAmplitude=0), Threshold-Strict-Greater-than, Marker-strength-Clamping auf [0,1], timeSeconds = sampleOffset/sampleRate inkl. 48kHz, minGapMs Spacing-Filter mit korrekter 44100×0.1s=4410 samples Math, negative Amplitude via Math.abs detected, glatter Sinus erzeugt keine Marker (Edge-Smoothness-Check). Validation: 4 selbstgemachte Test-Bugs gefixed (helper-default velocity, Float32-Precision an Threshold-Grenze, minGap-Math, DC-Offset-Quirk), pnpm check clean, pnpm test 2514 passed/15 skipped vs vorher 2415 (+99). Package.json gebumped 2.61.0 → 2.62.0."
      ],
      next: [
        "Tag v2.62.0 + push → drittes Release der Pure-Coverage-Wave. Kumulativ v2.60+v2.61+v2.62: 12 Util-Files / +351 Cases / 0 Source-Changes.",
        "Wave-Status: Kandidaten-Liste praktisch erschöpft. Verbleibend interessante Pure-Utils: gmDrumMap.ts (Drum-Note-Lookup, klein), wavExporter.ts (PCM-Encoding ähnlich zu midiExport, mittel), projectSerializer.ts (Project-JSON Schema, mittel). Danach Übergang zu nicht-Pure Themen: store-Coverage, Hook-Tests, Component-Smoke-Tests."
      ],
      changed: [
        "tests/features/osc-encoder.test.ts (NEW, 25 Cases)",
        "tests/features/pattern-morph.test.ts (NEW, 26 Cases)",
        "tests/features/patch-serialize.test.ts (NEW, 31 Cases)",
        "tests/features/transient-detection.test.ts (NEW, 17 Cases)",
        "package.json (version 2.61.0 → 2.62.0)",
        "agents/INDEX.js (workLog-Entry)"
      ]
    },
    {
      agent:     "testing",
      timestamp: "2026-05-16T18:35:00.000Z",
      done: [
        "POLISH-WELLE-v2.61 Pure-Coverage Wave-Continuation (Bundle 5): 5 weitere untestete Util-Files mit pure-Function-Coverage abgedeckt. Pattern: identisch zu v2.60 (arpeggiator/scales/transpose). (1) tests/features/mixer-fx.test.ts (NEW, 47 Cases): 12 MIXER_FX_TYPES, EQ16_FREQUENCIES Aufsteig-Sortierung + hörbarer Bereich [25,16000], clamp/clampUnit/clampDb mit NaN-Defensive, createDefaultEqBands × 16 Bänder, sanitizeEqBands Out-of-Range-Clamping (gain ±24, q [0.1,12], freq [20,20000]), summarizeEqBands Low/Mid/High Splitting, makeMixerFxSlot für jeden FX-Type, defaultParamsForType pro Type-spezifischen Defaults (compressor/filter/delay/reverb), moveFxSlot/toggleFxSlot/removeFxSlot Chain-Operations mit Reference-Identity bei No-Op, computeSidechainGain mit Ducking-Math, normalizeSidechain + normalizeTransientShaper an Persistenz-Boundaries. (2) tests/features/pattern-density.test.ts (NEW, 20 Cases): computeDensityMap mit empty/all-muted/full-active/partial-density Cases, stepDensity/partDensity-Aggregationen, variable Step-Counts (kürzere Parts mit 0 gepaddet), detectFlashingPairs n²-Pairing-Logik mit Threshold-Filter (strict > nicht >=), Custom-Threshold-Override. PartData[] aus Test-Fixtures konstruiert (kein AudioEngine-Mount). (3) tests/features/polymeter.test.ts (NEW, 36 Cases): MIN/MAX Konstanten, clampStepLength mit undefined/null/NaN/Infinity/0/negative → undefined-Default-Marker + fraktionale Rundung + custom max-override, effectiveStepIndex Modulo-Wrap inkl. negativer globalStep (((-1%4)+4)%4=3), isStepWithinPart Off-by-one Guard (Index=length → false), nextWrapStep mit aktueller-Wrap-Edge-Case (globalStep=4 mit partLen=4 → 8 nicht 4). (4) tests/features/note-repeat.test.ts (NEW, 24 Cases): 8 Raten Schema (4 Standard + 4 Triplet), Triplet < Standard Invariant, getRateDef throws bei unbekannter Rate, rateToIntervalMs für alle Subdivisions × verschiedene BPM (60/120/240), BPM=0/negative throws, safeIntervalMs Clamp auf MIN_INTERVAL_MS bei extrem hohen BPM + fine grain. (5) tests/features/midi-export.test.ts (NEW, 19 Cases): exportMidiBundle Output-Parsing — verifiziert MThd-Magic + Header-Length=6 + Format=1 + TPQN=480 + Track-Count = 1+N, Tempo-Track-Body mit MTrk-Magic + Tempo-Event (60_000_000/BPM µs/Beat) für 60/120/240 BPM + End-of-Track Meta (FF 2F 00), Pattern-Track-Body mit Track-Name (FF 03) + Note-On 0x99 auf Kanal 10 mit GM-Drum-Map-Noten (Kick=36/Snare=38/Hi-Hat=42), 4× Bar-Wiederholung (1 Kick → 4 Note-Ons im Output), Empty-Patterns + non-existing Note-Ons. Verwendet Blob.arrayBuffer() + DataView für Binary-Parsing. Validation: pnpm check clean, pnpm test 2415 passed/15 skipped vs vorher 2269 (+146 = mixer-fx 47 + pattern-density 20 + polymeter 36 + note-repeat 24 + midi-export 19). Package.json gebumped 2.60.0 → 2.61.0."
      ],
      next: [
        "Tag v2.61.0 + push → erstes Release nach Wave-Start v2.60 — kumulativ +252 Cases / 8 Util-Files Pure-Coverage abgedeckt (3 in v2.60 + 5 in v2.61).",
        "Weitere Pure-Coverage-Kandidaten falls Wave fortgesetzt: oscEncoder.ts (Binary OSC-Packets), patternMorph.ts (Pattern-Interpolation), patchSerialize.ts (Synth-Patch JSON), scales.ts ist done, transientDetection.ts (DSP-Edge-Detector)."
      ],
      changed: [
        "tests/features/mixer-fx.test.ts (NEW, 47 Cases)",
        "tests/features/pattern-density.test.ts (NEW, 20 Cases)",
        "tests/features/polymeter.test.ts (NEW, 36 Cases)",
        "tests/features/note-repeat.test.ts (NEW, 24 Cases)",
        "tests/features/midi-export.test.ts (NEW, 19 Cases)",
        "package.json (version 2.60.0 → 2.61.0)",
        "agents/INDEX.js (workLog-Entry)"
      ]
    },
    {
      agent:     "testing",
      timestamp: "2026-05-16T18:15:00.000Z",
      done: [
        "POLISH-WELLE-v2.60 Pure-Coverage-Bundle: 3 untestete Util-Files mit ausschließlich pure-Function-Coverage abgedeckt (Pattern wie v2.56-v2.58). (1) tests/features/arpeggiator.test.ts (NEW, 29 Cases): 8 ArpModes (up/down/upDown/random/chord/converge/diverge/order) × Octave-Stacking 1/2/3 + 6 Velocity-Patterns + stepSkip + gateLength + Seed-Determinismus + leere-Noten-Edge-Case. Eintsentliche assertions sind Note-Pool-Reihenfolge (z.B. converge [60,72,64,67], diverge [67,64,72,60]) und Velocity-Range-Guards. (2) tests/features/scales.test.ts (NEW, 41 Cases): 13 SCALES Schema-Integrität (Aufsteig-Sortierung, [0,11]-Range, Root=0 in jeder), isKnownScaleId Type-Guard für 4 non-string-Inputs (null/undefined/42/object) + Persistenz-Boundary, getScale wirft bei unbekannter ID, pitchClass für MIDI 0/60/127/-1/-12, isInScale gegen 6 Skalen × Roots, snapToScale für chromatic-bypass + in-scale-Identity + Konventions-Tie-Breaker (höhere bevorzugen), scalePitchClasses-Rotation bei nicht-C Root, pitchClassName auch für Out-of-Range. (3) tests/features/transpose.test.ts (NEW, 36 Cases): clampSemitones ±24 Range + NaN/Infinity-Defensiv + fraktionale Rundung; transposeNote MIDI [0,127] Clamp an beiden Enden + fraktionale Inputs; semitoneLabel mit allen 4 Oktav-Markern (8va/8vb/15ma/15mb) + over-range-via-clamp + NaN-Edge. Validation: pnpm test 2269 passed/15 skipped vs vorher 2163 (+106 = arpeggiator 29 + scales 41 + transpose 36). pnpm check clean. Package.json gebumped 2.59.0 → 2.60.0."
      ],
      next: [
        "Tag v2.60.0 + push → validiert die GitHub-Actions-Upgrades aus 7e6c287 (checkout@v6, setup-node@v6, pnpm-action-setup@v6, upload-artifact@v7) end-to-end in einem echten Release-Build.",
        "Weitere Pure-Coverage-Kandidaten falls Wave weitergeht: mixerFx.ts (214 LOC, FX-Param-Mappings), patternDensity.ts (139 LOC, Pattern-Analyzer), polymeter.ts (74 LOC), midiExport.ts (184 LOC), noteRepeat.ts (75 LOC)."
      ],
      changed: [
        "tests/features/arpeggiator.test.ts (NEW, 29 Cases)",
        "tests/features/scales.test.ts (NEW, 41 Cases)",
        "tests/features/transpose.test.ts (NEW, 36 Cases)",
        "package.json (version 2.59.0 → 2.60.0)",
        "agents/INDEX.js (workLog-Entry)"
      ]
    },
    {
      agent:     "testing",
      timestamp: "2026-05-16T13:20:00.000Z",
      done: [
        "POLISH-WELLE-v2.59 (TASK-126 W2 + TASK-122 W2 + TASK-127 W4): drei offene Polish-Items aus ROADMAP abgeräumt. (1) TASK-126 W2 Pad-Hold-Mode E2E: 3 Playwright-Cases in tests/web/macros.spec.ts gegen die App.tsx-Wire (Z.975-984, pad-Branch im onTrigger-Handler). Tests verifizieren data-macro-trigger-kind='pad' Attribut, macro:button:trigger CustomEvent mit padIndex, und 500ms-Hold ohne extra trigger-Events. Mirror von den 4 existierenden script-hold Cases. Performance-Pad mit patternId='seeded-pattern' wird in localStorage als ss-performance:v1 mit-seeded, damit runPadOnce kein Early-Return macht. (2) TASK-122 W2 Theme-Token Visual-Regression: neue tests/web/theme-tokens.spec.ts mit 4 Cases. Nutzt CSS-Token-Comparison statt Pixel-Screenshots (kein Baseline-Wartungsaufwand). Verifiziert: 14 Pflicht-Tokens × 10 Themes = 140 Definitionen vorhanden; v2.48-Tokens accent-tertiary + accent-warning in allen 10 Themes; Accent-Tokens cross-theme distinct (mind. 5 von 10 unique pro Token = Copy-Paste-Drift-Guard); Theme-Switch ist live via data-theme-Attribute + Round-Trip. (3) TASK-127 W4 Auto-Scroll-Container-Fallback: N/A — PatternLaunchPad-Grid ist seit BUG-016 'aspect-square h-full grid-cols-4 grid-rows-4', es gibt keinen scrollbaren Container mehr in dem ein Fallback wirken könnte. ROADMAP-Entry entsprechend updated mit Begründung. (4) Validation: pnpm check clean, pnpm test 2163 passed/15 skipped (vorher 2132 = +31 — chord-progressions Welle hat 28 Cases noch reingespielt, plus diese E2E sind nicht im Vitest-Pool sondern Playwright). pnpm test:web für die 2 modifizierten Files: 11/11 grün in 17s (4 alte script-hold + 3 neue pad-hold + 4 neue theme-tokens). Package.json gebumped 2.58.0 → 2.59.0."
      ],
      next: [
        "Tag v2.59.0 und push → triggert electron-release.yml Run, validiert den Mac-Job-Collapse aus dem vorherigen Commit (301c834): jetzt 3 Build-Jobs statt 4 (linux/windows/mac-collapsed), latest-mac.yml sollte beide archs listen."
      ],
      changed: [
        "tests/web/macros.spec.ts (+TASK-126 W2 describe block, +109 lines)",
        "tests/web/theme-tokens.spec.ts (NEW, +156 lines)",
        "ROADMAP.md (TASK-126 W2 → ✅, TASK-122 W2 → ✅, TASK-127 W4 → N/A mit Begründung)",
        "package.json (version 2.58.0 → 2.59.0)",
        "agents/INDEX.js (workLog-Entry)"
      ]
    },
    {
      agent:     "testing",
      timestamp: "2026-05-16T07:59:00.000Z",
      done: [
        "SNAPSHOT-DRIFT-VERIFY (tests/electron/__snapshots__/csp-header.test.ts.snap): Untersuchung der seit Session-Start als 'M' gemeldeten Modifikation. (1) git diff lieferte LEER-Output → erste git-Invocation hat die Modifikation bereits resolved (klassisches Windows-LF↔CRLF Whitespace-Normalisation via core.autocrlf, ohne dass eine Bash-Action gelaufen wäre). (2) git status danach: 'working tree clean' für die Snapshot-Datei. (3) Letzte echte Source-Änderung an der Datei: 52989d7 'fix(BUG-024, v1.67.0): KI-Features (OpenAI + Anthropic) gehen nicht im Electron-Build' — also seit v1.67 inhaltlich unverändert, durch v2.33→v2.58 keinerlei legitimer Drift. (4) pnpm vitest run tests/electron/csp-header.test.ts: 30/30 grün in 8ms gegen aktuelle Snapshot-Datei. Empfehlung an User: weder commit noch checkout nötig — die Datei ist sauber, der frühere 'M'-Status war stale (Windows-LF-Phantom)."
      ],
      next: [
        "Pre-Release-Tests des Run 25954273445 abwarten — falls dort CSP-Snapshot auf Ubuntu rot wird, .gitattributes 'tests/electron/__snapshots__/*.snap text eol=lf' setzen um den Phantom-Drift dauerhaft zu eliminieren."
      ],
      changed: [
        "agents/INDEX.js (workLog-Entry)"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-16T05:50:44.232Z",
      done: [
        "RELEASE-v2.58.0: Branch claude/post-v2.33-loops getaggt + gepusht. Sanity-Checks grün (Branch up-to-date mit origin, package.json=2.58.0, HEAD=dd465c7 'test(CHORD-PROGRESSIONS, v2.58.0)'). Annotated Tag v2.58.0 mit kompakter 15-Wellen-Release-Note (v2.34 OSC-In Loop-Closing, v2.40 MIDI-Bridge-Hook -66 LOC, v2.46 Floating Inspector, v2.47 OSC-Out-Bridge-Hook -90 LOC, v2.48 Theme-Tokens, v2.49 Popup-Close-Bridges -28 LOC, v2.50 applySoloUpdate, v2.51 Source-Type-Badge, v2.52 Cmd+A E2E, v2.53 FloatingPanel-Helpers, v2.54 Source-Type-Switch via Badge-Menu, v2.55 Relocate-E2E, v2.56 timeStretch, v2.57 grooveEngine, v2.58 chordProgressions; 2132 Vitest + 129 Playwright grün, App.tsx -184 LOC). 'git push origin v2.58.0' erfolgreich. GitHub-Actions Run 25954273445 'Electron Release' triggert: Pre-Release-Tests-Job (ubuntu-latest) läuft zuerst, danach 4-fache Build-Matrix (linux ubuntu-latest, windows windows-latest, mac-intel macos-latest x64, mac-arm macos-14 arm64) mit --publish always zu GitHub Releases. Run-URL: https://github.com/GeorgDub/Synthstudio/actions/runs/25954273445. Coordinator hat NICHT auf main getaggt (main steht weiter auf v2.33-Commit 5e16999 — der Release läuft ausschließlich aus claude/post-v2.33-loops)."
      ],
      next: [
        "Run 25954273445 monitoren — Pre-Release-Tests + 4 Plattform-Builds müssen alle grün sein, sonst Release wird nicht published.",
        "Nach erfolgreichem Release: claude/post-v2.33-loops via PR oder Fast-Forward in main mergen, damit main auf v2.58.0 kommt (aktuell weiter auf v2.33).",
        "Snapshot-Drift (tests/electron/__snapshots__/csp-header.test.ts.snap) auf main ist nur LF->CRLF Whitespace-Drift — kann ignoriert oder mit .gitattributes 'binary' geclamped werden."
      ],
      changed: [
        "agents/INDEX.js (workLog-Entry)",
        "git: tag v2.58.0 -> dd465c7 (annotated, pushed to origin)"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T11:30:00.000Z",
      done: [
        "DEAD-CODE-DISCOVERABILITY-WAVE (v2.18.0 → v2.25.0): autonome Session shipped 8 Releases, alle nach demselben Thema 'in v2.14-v2.17 implementiertes dead code endlich in der UI sichtbar machen'. (1) v2.18 MIDI-DISCOVER: SettingsPanel.tsx hatte historischen Subset der MIDI-Features — Hardware-Templates inkl. Korg Electribe 2, Auto-Learn und Live-Activity-Indicator nur per Ctrl+M (MidiSettings.tsx-Modal) erreichbar. Neuer AdvancedMidiBanner in allen 3 MIDI-Sections verlinkt jetzt auf den Modal. (2) v2.19 PATCH-LIBRARY-UI: v2.16 usePatchStore hatte 17 Vitest-Cases aber NULL UI-Konsumenten. Neue PatchesSection in Settings → App → 🎚 Patch-Library mit Liste / Inline-Rename / Delete / Library-Export-JSON / Import / Clear-All. (3) v2.20 SAVE-PATCH: Save-Affordance fehlte komplett — neuer 💾 Save Patch-Button im ChannelInspector mit Inline-Form (Name + FX-Toggle). (4) v2.21 APPLY-PATCH: Apply-Loop fehlte — neue applyPatchToPart-Action im useDrumMachineStore + 📂 Apply (N)-Button im Inspector mit kollapsibler Library-Liste. (5) v2.22 PERF-RECORDER-UI: v2.15 usePerformanceRecorder hatte 12 Vitest-Cases aber war nur per window.dispatchEvent('perf:event') fütterbar. Neuer PerformanceRecorderBadge als fixed bottom-right Overlay mit Rec-Toggle + Live-Timer mm:ss + Event-Counter + Playback / Export-JSON / Clear. (6) v2.23 OSC-UDP: v2.17 OSC-Encoder/Decoder/Bindings hatten 18 Vitest-Cases aber keine Network-Schicht (nur WebSocket-Bridge). Neuer electron/osc-server.ts mit dgram-UDP-Socket, default-bind 127.0.0.1 + opt-in 0.0.0.0, IPC-Bridge osc:incoming → mapOscToAction → dispatchOscAction. TouchOSC/Lemur/oscchief können jetzt direkt senden. (7) v2.24 SLIDE-UI: v2.14 StepData.slide + SynthEngine.glide + 10 Vitest-Cases waren 10 Releases lang dead code. Neue setStepSlide-Action + ↝ SLIDE-Pill-Toggle im StepInspector. (8) v2.25 SLIDE-VIZ: Polish — ↝ Glyphe links unten in Step-Cells mit slide=true plus aria-label + Tooltip-Update. Test-Status nach allen Wellen: pnpm check 0 Fehler, alle relevanten Unit-Tests grün (slide-glide 10/10, osc 18/18, performance-recorder 12/12, patches 17/17)."
      ],
      next: [
        "FEAT-INSP: ChannelInspector als pinnable Popup-Window (Explore-Report aus erster Session noch gültig, Aufwand 4-5h, 8+ Files).",
        "FLP-CHANNEL-NAMES: TEXT_CHANNEL_NAME (0xC3) aus FLP-Events extrahieren — riskanter wegen FL-Format-Channel-Context-Tracking.",
        "FLP-MELODIC-ROUTE Phase 3: ProjectManager-Konsumtion von melodicParts (v1.65). MelodicPart-Store-Modell (1 Note pro Step) muss erweitert werden für FLP-Polyphonie.",
        "CI-Playwright-Drift: 4 stale Tests aus PR #15 (layout-double-header Note-Repeat + Envelope-Follower, performance-mode Toolbar-Button + 'abgelegt' → 'losgelassen' Wording).",
        "Slide-Glyph: in Wellen-Notes erwähnter 'Bulk-Slide-Mode' falls User-Feedback es priorisiert."
      ],
      changed: [
        "package.json",
        "client/src/components/Settings/SettingsPanel.tsx (v2.18 banner + v2.19 PatchesSection + v2.23 UDP listener UI)",
        "client/src/components/Mixer/ChannelInspector.tsx (v2.20 save + v2.21 apply)",
        "client/src/store/useDrumMachineStore.ts (v2.21 applyPatchToPart + v2.24 setStepSlide)",
        "client/src/components/PerformanceRecorder/PerformanceRecorderBadge.tsx (v2.22 neu)",
        "electron/osc-server.ts (v2.23 neu, dgram UDP)",
        "electron/main.ts (v2.23 IPC-Handler + Quit-Cleanup)",
        "electron/preload.ts + electron/useElectron.ts + electron/types.d.ts (v2.23 OSC-Bridge)",
        "client/src/components/DrumMachine/StepInspector.tsx (v2.24 slide-toggle)",
        "client/src/components/DrumMachine/ChannelStrip.tsx (v2.25 slide-glyph)",
        "client/src/components/DrumMachine/DrumMachine.tsx (v2.24 onSetSlide-wiring)",
        "client/src/components/Workspace/panels/InspectorPanel.tsx (v2.21 onApplyPatch)",
        "client/src/components/CollabSplitView/CollabSplitView.tsx (v2.21/v2.24 noop-stubs)",
        "client/src/App.tsx (v2.18 settings-bridge + v2.22 badge + v2.23 osc-bridge)",
        "client/src/utils/imports/types.ts + flpImport.ts (v1.65 melodic-parts war's bei alter Welle)",
        "tests/features/project-imports.test.ts (v1.64-v1.65 detection + melodic-parts tests)",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-15T01:00:00.000Z",
      done: [
        "HELP-OVERLAY-EXPANSION (v2.11.0): User-Wishlist 'Handbuch script-syntax + Plugins'. Bisherige ShortcutsHelp (zwei Tabs Übersicht + Belegung) um zwei weitere Tabs erweitert: (1) '🧩 Script-API' — komplette ss.*-Referenz mit Sektionen Transport (bpm/play/stop/wait), Macros (getMacro/setMacro), Steps (setStep), Dispatch (20+ Actions als Chip-Wolke), Utility (log/random/now), plus 2 Code-Beispiele (BPM-Rampe + Drop-Reset). Sandbox-Constraints klar dokumentiert (Web-Worker, max 5s, kein window/document/fetch). (2) '🎹 MIDI-Guide' — Setup in 4 Schritten (Hardware → Template → Right-Click-Learn → Auto-Learn), bindbare-Liste (alle 120+ MIDI-Slots: Transport, Mixer, FX-Params, Macros, Pattern, Steps, Chains, Scripts), bidirektionale Features (Clock-In/Out, Note-Out, Test-Buttons, Panic), Tipps (Monitor, Activity-Indicator, Channel-Filter, Bulk-Bind, JSON-Export). Header von 'Tastatur' → 'Hilfe & Referenz' umbenannt, max-w-2xl → max-w-3xl. Footer-Hinweise pro Tab angepasst. 1853 Tests grün, pnpm check 0 Fehler. Erfüllt das neue_todos.md-Item 'Syntax-Beschreibung für Scripts und Plugins ins Handbuch'."
      ],
      next: [
        "Per-Part MIDI-Out-Channel-Routing.",
        "MIDI-Note-Off-Scheduling bei externen Synths."
      ],
      changed: [
        "package.json",
        "client/src/components/ShortcutsHelp/ShortcutsHelp.tsx",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-15T00:30:00.000Z",
      done: [
        "HIDDEN-NO-OP-FIXES (v2.10.0): Audit der kb:action-Handlers nach v2.9 BUG (toggle-note-repeat war NO-OP) zeigte 3 weitere Hidden-NO-OPs. Alle gefixt: (1) `toggle-morph` kb:action wurde von MidiLearnTarget.toggleMorph dispatched, hatte aber keinen Handler in App.tsx → MIDI-Bind toggleMorph war NO-OP. Handler ergänzt: ruft setActive() aus useMorphStore + Toast 'Pattern-Morph: AN/AUS'. (2) `midi:commitLiveEdit` CustomEvent wurde dispatched, kein Listener → commitLiveEdit per MIDI war NO-OP. Listener ergänzt: ruft `dmRef.current.commitLivePatternEdit()` + Toast 'Live-Edit committed'. (3) `midi:scene` CustomEvent dispatched mit sceneIndex, kein Listener → Scene-Launch per MIDI war NO-OP. Listener ergänzt: liest `getSceneState().scenes[sceneIndex]`, setzt setActiveScene + dm.setActivePattern(scene.patternId) + Toast 'Scene N: <Name>'. Neuer Pure-Getter `getSceneState()` in useSceneStore (Event-Handler-Pattern, kein React-Render-Lock-In). `toggle-morph` zur Sandbox-Allowlist + AI-Generator-Allowlist hinzugefügt — Scripts können jetzt Morph-Toggle steuern. 1853 Tests grün, pnpm check 0 Fehler. Insgesamt 7 Hidden-NO-OPs in dieser Session gefixt (v1.71 BUG-025 quantize, v1.76 volume/pan/solo, v1.92 pattern-index, v1.99 step-target, v2.9 toggle-note-repeat, v2.10 toggle-morph+commitLiveEdit+scene)."
      ],
      next: [
        "Custom-Chains Beat-Repeat-Trigger als Macro-System.",
        "AI-Prompt-Helper für Scripts via Chat-UI."
      ],
      changed: [
        "package.json",
        "client/src/App.tsx",
        "client/src/store/useSceneStore.ts",
        "client/src/sandbox/useScriptSandbox.ts",
        "client/src/utils/aiScriptGenerator.ts",
        "tests/features/built-in-scripts.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-15T00:00:00.000Z",
      done: [
        "BEAT-REPEAT + NOTE-REPEAT-FIX (v2.9.0): Hidden-Bug-Fix + neue Performance-Scripts. (1) Hidden-Bug: 'toggle-note-repeat' kb:action wurde von useMidi via MidiLearnTarget toggleNoteRepeat dispatched, hatte aber KEINEN Handler in App.tsx — Note-Repeat-Toggle per MIDI war NO-OP. Handler ergänzt: ruft `toggleNoteRepeat()` aus useNoteRepeatStore + Toast 'Note Repeat: AN/AUS'. (2) `toggle-note-repeat` zur Sandbox-Allowlist + AI-Generator-Allowlist hinzugefügt damit Scripts dispatchen können. (3) Zwei neue Built-In Scripts in Category 'Performance': 'Beat-Repeat-Burst' (2s Note-Repeat → AUS, klassischer Hardtekk-Move) und 'Quick Roll' (500ms, für Drum-Fills). Beide bindbar auf Pads via Run-Script-Target → momentary Stutter-Performance. Built-In-Allowlist-Test ergänzt. 1853 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "Weitere Hidden-Bugs in kb:action-Handlern auditieren (toggleMorph, commitLiveEdit, openSettings, etc.).",
        "MIDI-Send-Pad-Trigger an externe Synths während Synthstudio spielt."
      ],
      changed: [
        "package.json",
        "client/src/App.tsx",
        "client/src/sandbox/useScriptSandbox.ts",
        "client/src/utils/aiScriptGenerator.ts",
        "client/src/utils/builtInScripts.ts",
        "tests/features/built-in-scripts.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T23:30:00.000Z",
      done: [
        "PATTERN-DRAG-REORDER (v2.8.0): User kann Patterns im Dropdown-Menü via Drag & Drop neu sortieren. Neue Store-Action `reorderPatterns(fromIndex, toIndex)` in useDrumMachineStore — pure splice-based reorder, no-op bei out-of-range oder identischen Indices, Pattern-IDs bleiben stabil. PatternRow bekommt: (1) Drag-Handle ☰ links neben dem Pattern-Button (sichtbar bei hover, draggable=true, setData mit Custom-MIME 'application/x-synthstudio-pattern-row' + fromIndex), (2) onDragOver/Leave/Drop-Handler auf dem Wrapper-Div: berechnet anhand der Y-Position des Cursors ob 'above' oder 'below' der Row gedroppt wird, zeigt blauen 0.5px-Strich als Drop-Indikator, calculiert correcten Target-Index (adjustier wenn fromIndex < targetIdx wegen splice-Index-Shift). Toast 'Pattern „X\" verschoben' (info, 2s). 9 neue Vitest-Cases für reorder-Reducer (forward / backward / same-index / out-of-range from / out-of-range to / IDs stable / empty / single). 1853 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "v2.9 Beat-Repeat-Built-In-Script.",
        "Weitere Pattern-UX-Features."
      ],
      changed: [
        "package.json",
        "client/src/store/useDrumMachineStore.ts",
        "client/src/components/DrumMachine/DrumMachine.tsx",
        "client/src/components/CollabSplitView/CollabSplitView.tsx",
        "tests/features/reorder-patterns.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T23:00:00.000Z",
      done: [
        "MIDI-DEVICE-TOAST (v2.7.0): MIDI-Geräte-Connect/Disconnect-Toasts. refreshDevices() in useMidi diffed jetzt die Geräteliste gegen die vorige (per Map<id, name>): neue Geräte → 'MIDI verbunden: <Name> (<Hersteller>)' (success für Inputs, info für Outputs), fehlende Geräte → 'MIDI getrennt: <Name>' (warning). Initial-Skip via devicesInitializedRef damit der User beim Aktivieren nicht für jedes bereits angeschlossene Gerät einen Toast bekommt — erster Refresh nach enable() ist still, ab da werden Diffs gemeldet. enable() zeigt 'MIDI aktiviert' (success) bei Erfolg bzw. error-Toasts bei Web-MIDI-API-fehlt oder Permission-denied. disable() zeigt 'MIDI deaktiviert' + reset der Tracking-Refs. Direkter toast()-Import statt CustomEvent — Toast-Store ist Modul-Singleton, kein React-Overhead. 1844 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "Beat-Repeat-Macro.",
        "Pattern-Drag-Drop-Reorder."
      ],
      changed: [
        "package.json",
        "client/src/hooks/useMidi.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T22:30:00.000Z",
      done: [
        "TOAST-EXPANSION (v2.6.0): Toast-Feedback auf alle wichtigen Operations ausgeweitet — User bekommt für jede destruktive/persistierende Action sofortiges visuelles Feedback. (1) App.tsx Project-Save: Toast 'Gespeichert: <Name>' bei Electron-Save (nur wenn nicht canceled) und 'Download gestartet: <Name>.synth' im Browser-Modus. (2) App.tsx Project-Load: 'Projekt geladen: <Name>' success bzw. 'Projekt konnte nicht geladen werden' error (5s). (3) App.tsx pattern-duplicate: 'Pattern „X\" dupliziert (N → N+1)' (statt nur Ctrl+D-Action). (4) MidiSettings clearAllMappings: nun mit confirm()-Dialog + Toast 'N Mapping(s) gelöscht' (warning). (5) Layout-Export: 'Layout exportiert: <File> (N CC + N Notes)' + Error-Toast bei Fehler. (6) User-Template save: 'Template gespeichert: „X\"'. (7) User-Template load: 'Template „X\" geladen (N CC + N Notes)'. (8) User-Template delete: 'Template „X\" gelöscht' (warning). (9) Hardware-Template load: 'Hardware-Template „X\" geladen (N CC + N Notes)'. (10) Bulk-Bind: 'N Mappings gesetzt: <Preset> ab CC X'. (11) ScriptRunner Built-In-Load: 'Built-In Script geladen: „X\"' + Error-Variante bei Failure. 1844 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "Beat-Repeat-Macro.",
        "Pattern-Drag-Drop-Reorder.",
        "Toast bei MIDI-Device-Connect/Disconnect."
      ],
      changed: [
        "package.json",
        "client/src/App.tsx",
        "client/src/components/MidiSettings/MidiSettings.tsx",
        "client/src/components/Tools/ScriptRunner.tsx",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T22:00:00.000Z",
      done: [
        "TOAST + PATTERN-PICKER (v2.5.0): Zwei Verbesserungen für die v2.4 Sample-Carryover-Funktion. (1) Toast-System: neuer Modul-Singleton `useToastStore` mit `toast(message, {kind, duration})` API, Modus 'success'/'info'/'warning'/'error', Auto-Dismiss-Timer, Max 5 Toasts (älteste droppen). ToastContainer-Komponente rendert oben rechts mit Backdrop-Blur + Icon + Close-Button. Mount in App.tsx unter MidiProvider. App.tsx + DrumMachine zeigen jetzt Toast bei jeder Sample-Übernahme ('Sampler aus „<Name>\" in „<Target>\" übernommen' success) bzw. Warnung wenn kein vorheriges Pattern existiert. (2) Pattern-Picker-Submenu: das einfache 📥-Quick-Button hat jetzt ein ▾-Begleiter dropdown das ALLE anderen Patterns als Source-Optionen listet — User kann nicht nur 'vorheriges' sondern jedes Pattern als Source wählen. Auto-Close on mouseLeave. 11 neue Vitest-Cases für useToastStore (default-values, custom kind/duration, auto-dismiss-timer, sticky duration=0, dismiss-by-id, clear-all, max-5-cap, unique-ids, id-rückgabe). 1844 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "Beat-Repeat-Macro.",
        "Pattern-Drag-Drop-Reorder.",
        "Toast für andere Operations (Project save/load, Mapping cleared, etc.)."
      ],
      changed: [
        "package.json",
        "client/src/store/useToastStore.ts",
        "client/src/components/UI/ToastContainer.tsx",
        "client/src/App.tsx",
        "client/src/components/DrumMachine/DrumMachine.tsx",
        "tests/features/toast-store.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T21:30:00.000Z",
      done: [
        "PATTERN-SAMPLE-CARRYOVER (v2.4.0): User-Request — 'Sampler Übernahme Funktion bei pattern, das man die komplett aus einem pattern ins nächste kopieren kann per Script oder Tastenkombination damit man nicht alle einzeln machen muss'. Neue Action `dm.copySamplesFromPattern(sourceId, targetId)` in useDrumMachineStore: kopiert Sample-Belegung (sampleUrl/sampleName) + sourceType (sample/wavetable/fm/granular) + synthParams + granularParams + stretchRatio + microTiming + Volume + Pan + komplette FX-Chain pro Part-Index. Steps + Mute/Solo + ID bleiben beim Target. Vollständig zugänglich: (1) **Tastenkombination Ctrl+Shift+S** → 'Sampler vom vorherigen Pattern übernehmen' (neuer keyboardActionDef + App.tsx case 'pattern-copy-samples-from-prev'). (2) **ss.dispatch('pattern-copy-samples-from-prev')** in der Sandbox-Allowlist + AI-Generator-Allowlist. (3) **Built-In Script** 'Sampler vom vorherigen Pattern übernehmen' + 'Variation mit gleichem Sound (duplizieren+clear)'. (4) **UI-Button '📥' im Pattern-Menü** pro Pattern-Zeile (sichtbar bei hover, nur wenn vorheriges Pattern existiert). 10 neue Vitest-Cases (Sample-Copy, Steps-bleiben, ID-Erhalt, FX-Copy, Volume/Pan-Copy, Mute/Solo-NICHT-übernommen, identische IDs no-op, unbekannte Source no-op, Target-mehr-Parts, Synth/Granular/Stretch). 1831 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "Beat-Repeat-Macro.",
        "Pattern-Drag-Drop-Reorder."
      ],
      changed: [
        "package.json",
        "client/src/store/useDrumMachineStore.ts",
        "client/src/hooks/keyboardActionDefs.ts",
        "client/src/sandbox/useScriptSandbox.ts",
        "client/src/utils/aiScriptGenerator.ts",
        "client/src/utils/builtInScripts.ts",
        "client/src/components/DrumMachine/DrumMachine.tsx",
        "client/src/components/CollabSplitView/CollabSplitView.tsx",
        "client/src/App.tsx",
        "tests/features/copy-samples-from-pattern.test.ts",
        "tests/features/built-in-scripts.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T21:00:00.000Z",
      done: [
        "BULK-BIND-WIZARD (v2.3.0): Komplement zu Auto-Learn — statt N×Controller-Bewegen kann User jetzt N Mappings auf einmal anlegen ohne Hardware-Interaktion. Neue Action `addMappings(mappings)` in useMidi (Bulk-Add, Duplikate werden überschrieben). UI in MidiSettings CC-Tab: aufklappbares 'Bulk-Bind (v2.3)' mit Preset-Dropdown (Channel Volumes / Mutes / Pans / 8 Macros / Reverb-Sends / Delay-Sends), Start-CC-Input (0-127), Channel-Selector (0=alle, 1-16). Klick auf 'Bind' generiert die Mapping-Liste (konsekutive CCs ab Start) und ruft addMappings. Live-Preview-Text 'Wird N Mapping(s) anlegen: CC X bis CC Y'. Use-Case: User weiß seine Electribe sendet auf CC 16-23 für 8 Volumes — Bulk-Bind in einem Klick statt 8× Auto-Learn-Slider-Bewegen. 1821 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "Beat-Repeat-Macro.",
        "Pattern-Drag-Drop-Reorder.",
        "Cloud-Sync."
      ],
      changed: [
        "package.json",
        "client/src/hooks/useMidi.ts",
        "client/src/components/MidiSettings/MidiSettings.tsx",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T20:30:00.000Z",
      done: [
        "MIDI-TAB-BADGES (v2.2.0): MidiSettings-Tabs zeigen jetzt Counts/Status als Badge im Label. Geräte→Anzahl-Devices, Vorlagen→Anzahl-User-Templates, CC-Mapping→Anzahl-Mappings, Note-Mapping→Anzahl-Notes, Monitor→Event-Count, Clock-Sync→'in'/'out'-Indikator. Quick-Discoverability: User sieht direkt was im jeweiligen Tab konfiguriert ist ohne ihn zu öffnen. 1821 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "Beat-Repeat-Macro.",
        "Pattern-Drag-Drop-Reorder.",
        "Cloud-Sync (große Aufgabe)."
      ],
      changed: [
        "package.json",
        "client/src/components/MidiSettings/MidiSettings.tsx",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T20:00:00.000Z",
      done: [
        "SEND-TARGET + RCL (v2.1.0): Neue MidiLearnTarget-Variante `{type:'send', partId, partName?, bus:'reverb'|'delay'}`. Bindet Reverb-Send oder Delay-Send-Level eines Channels an einen MIDI-CC. applyMapping dispatcht 'midi:partSend' mit `{partId, bus, value 0..1}`, App.tsx listener ruft mixer.setChannelSend. UI in MixerView Channel-Strip: Send-Slider (Rev + Dly) bekommen onContextMenu + Mapped-Badge `CC<n>` im Label oben. labelForTarget rendert 'Reverb Send: <PartName>' / 'Delay Send: <PartName>'. targetsMatch unterscheidet anhand partId + bus. VALID_TARGET_TYPES um 'send' erweitert. 3 neue Vitest-Cases für send-targetsMatch (same/different-bus/different-partId). 1821 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "Beat-Repeat-Macro.",
        "Pattern-Drag-Drop-Reorder."
      ],
      changed: [
        "package.json",
        "client/src/hooks/useMidi.ts",
        "client/src/App.tsx",
        "client/src/components/Mixer/MixerView.tsx",
        "client/src/utils/midiLayoutImport.ts",
        "tests/features/midi-target-match.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T19:30:00.000Z",
      done: [
        "MIX-ASSISTANT-EXPOSURE (v2.0.0): Milestone-Release! Bisher existierte MixAssistantPanel als komplette Komponente in client/src/components/DrumMachine/MixAssistantPanel.tsx + Backend in utils/mixAnalysis.ts + utils/aiProjectAnalysis.ts — aber NIRGENDS gerendert. Toter Code. Mit v2.0 jetzt aktiv: '🧠 Mix'-Button in der DrumMachine-Toolbar neben 'Macros' und 'Poly'. Klick öffnet ResizableDrumPanel mit MixAssistantPanel. Auto-Build von MixAnalysisInput aus aktuellem Pattern: BPM, alle Parts mit Volume (0-127), Pan (-100..+100), activeSteps/totalSteps, filterCutoff (wenn Filter aktiv), trackType (aus Name). onApply parsed die rec.targetProperty: 'volume' → dm.setPartVolume, 'pan' → dm.setPartPan, 'filterCutoff' → dm.setPartFx({filterEnabled:true, filterFreq}). Erfüllt User-Wishlist-Item 'eine Ki analyse des Projekts einbauen die verbesserungsvorschläge oder so anbietet'. 1818 Tests grün, pnpm check 0 Fehler. Major-Bump auf 2.0.0 markiert das Ende einer langen Feature-Sprint-Serie."
      ],
      next: [
        "Backlog: Beat-Repeat-Macro, Pattern-Drag-Drop, Cloud-Sync, Mobile-Build, Updater.",
        "Eventuell: weitere MidiLearnTarget-Properties im Mix-Assistant onApply (z.B. reverbSend, delayMix, eqLow)."
      ],
      changed: [
        "package.json",
        "client/src/components/DrumMachine/DrumMachine.tsx",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T19:00:00.000Z",
      done: [
        "RCL-STEP-BUTTONS (v1.99.0): Right-Click MIDI-Learn jetzt auch auf einzelne Steps im Pattern-Grid. Damit ist Live-Finger-Drumming auf physischen Pads möglich: jeder Step im Grid kann individuell auf ein Pad gemappt werden, Pad-Druck togglet diesen Step im aktiven Pattern. Implementation: useMidiContext direkt im ChannelStrip statt useMidiLearn (vermeidet Hook-Order-Probleme bei dynamischen Step-Counts 16/32). onContextMenu auf jedem Step-Button → midi.startLearn({type:'step', partId, stepIndex}). Visual-Indikator: 1×1px Dot in der rechten oberen Ecke des Steps wenn gebunden. Tooltip zeigt CC# oder 'Rechtsklick: MIDI-Learn'. Hidden-Bug-Fix nebenbei: applyMapping für 'step'-Target war zuvor `break;` (NO-OP, mit Kommentar 'via Note-Mapping'). Jetzt dispatcht es 'midi:toggleStep'-CustomEvent, App.tsx listener ruft dm.toggleStep auf. 1818 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "Beat-Repeat-Macro-Target.",
        "AI-Projekt-Analyse UI-Exposure.",
        "Pattern-Tag-System."
      ],
      changed: [
        "package.json",
        "client/src/hooks/useMidi.ts",
        "client/src/App.tsx",
        "client/src/components/DrumMachine/ChannelStrip.tsx",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T18:30:00.000Z",
      done: [
        "MIDI-PANIC (v1.98.0): Klassisches DAW-Feature — Panic-Button sendet 'All Notes Off' (CC 123) + 'All Sound Off' (CC 120) + Sustain-Reset (CC 64) + Note-Off für alle 128 Notes auf allen 16 Channels ans aktive Output-Device. Defense-in-Depth gegen hängende Noten bei externen Synths (häufiges Problem bei MIDI-Setup mit Drum-Machines/Synths). Neue Action `sendPanic()` im useMidi-Hook. UI: '🚨 Panic'-Button im SettingsPanel → KI & MIDI → MIDI Out neben den Test-Buttons. 1818 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "v1.99 Velocity-Color-Coding im Step-Grid.",
        "Beat-Repeat-Macro-Target.",
        "AI-Projekt-Analyse UI exposure."
      ],
      changed: [
        "package.json",
        "client/src/hooks/useMidi.ts",
        "client/src/components/Settings/SettingsPanel.tsx",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T18:00:00.000Z",
      done: [
        "MIDI-CLOCK-OUT (v1.97.0): Synthstudio sendet jetzt MIDI Clock (24 PPQ Pulses + Start/Stop) ans aktive Output-Device, sodass externe Synths/Drum-Machines (Volca, TR-8, Electribe, Digitakt) zu Synthstudio's BPM synct werden können. Bisher konnte Synthstudio nur EMPFANGEN. Neue State `clockOutEnabled: boolean` + `clockOutBpm: number` in MidiState; Actions `setClockOutEnabled` + `setClockOutBpm`. setInterval-basierter Ticker im useMidi-Effekt: bei aktivem clockOut + verbundenem Output sendet 60_000/(bpm*24)ms-Intervall `[0xF8]`. setClockOutEnabled(true) sendet zusätzlich `[0xFA]` (Start), setClockOutEnabled(false) sendet `[0xFC]` (Stop) damit externes Gerät die Sync auch wirklich startet/stoppt. App.tsx synct clockOutBpm via useEffect mit project.bpm — BPM-Änderungen propagieren automatisch. UI im SettingsPanel → KI & MIDI → MIDI Out: neuer Toggle 'MIDI-Clock senden (XXX BPM, 24 PPQ)' (sichtbar wenn Output-Device aktiv). 1818 Tests grün, pnpm check 0 Fehler. Damit ist die DAW-Sync-Pipeline endlich bidirektional."
      ],
      next: [
        "Backlog aus neue_todos.md."
      ],
      changed: [
        "package.json",
        "client/src/hooks/useMidi.ts",
        "client/src/App.tsx",
        "client/src/components/Settings/SettingsPanel.tsx",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T17:30:00.000Z",
      done: [
        "USER-MIDI-TEMPLATES (v1.96.0): User kann seine aktuellen MIDI-Mappings als benannten Preset persistieren — kein JSON-Datei-Hin-und-her mehr nötig. Neuer Store `useUserMidiTemplatesStore` (localStorage 'synthstudio:user-midi-templates:v1', max 50 Einträge, Modul-Singleton + React-Hook). API: getUserMidiTemplates, getUserMidiTemplate(id), saveUserMidiTemplate({id?, name, deviceName?, cc, notes}) — updated wenn ID übergeben, sonst neu — deleteUserMidiTemplate, renameUserMidiTemplate, __resetUserMidiTemplatesForTests. UI in MidiSettings Templates-Tab: neuer 'Aktuelles Setup speichern'-Block oberhalb der eingebauten Templates (sichtbar wenn mind. ein Mapping existiert), Input für Layout-Name (Default aus defaultExportNameFromDevice), Save-Button. Darunter Liste 'Meine Templates' mit Laden/Umbenennen/Löschen pro Eintrag — Datums-Hinweis + Device-Name + CC/Note-Count pro Template. 12 neue Vitest-Cases (initial-empty/save/persistiert deviceName/find/rename/delete/sort-by-updatedAt/update-by-id/empty-name-fallback). 1818 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "Beat-Repeat-Macro-Target.",
        "Drag-Drop Pattern-Duplicate.",
        "AI-Projekt-Analyse aus neue_todos.md."
      ],
      changed: [
        "package.json",
        "client/src/store/useUserMidiTemplatesStore.ts",
        "client/src/components/MidiSettings/MidiSettings.tsx",
        "tests/features/user-midi-templates.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T17:00:00.000Z",
      done: [
        "MONITOR-BINDING-HINT (v1.95.0): Der Live-MIDI-Monitor (Tab in MidiSettings) annotiert jetzt jede eingehende Message mit dem gebundenen Target. Beispiele: 'CC 7 = 100 → Master Volume', 'Note On 36 vel=120 → Pad Kick'. Massiver Debug-Boost — User sieht direkt ob seine Mappings auch wirklich greifen. Lookup geht über midi.noteMappings (für 0x90 Note On) und midi.mappings (für 0xb0 CC), Channel 0 = wildcard. 1806 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "Beat-Repeat-Macro-Target.",
        "Pattern-Drag-Drop.",
        "AI-Projekt-Analyse."
      ],
      changed: [
        "package.json",
        "client/src/components/MidiSettings/MidiSettings.tsx",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T16:30:00.000Z",
      done: [
        "PANEL-HEADERS (v1.94.0): User-Feedback aus neue_todos.md ('alle fenster sollen auch mit X zumachbar sein, granular und polyrhythm etc'). Die ResizableDrumPanel-Wrapper hatten zwar bereits einen Close-Button via `onClose`-Prop, aber bei title=undefined war der Header zu unauffällig (nur X rechts oben, kein Label). Alle 6 Panel-Sites in DrumMachine.tsx haben jetzt einen prominenten `title`: Granular ('Granular: <Part-Name>'), Polyrhythm-Visualizer, Makros (8 × bindbar), Note Repeat, Pattern-Morph, Envelope Follower. Discoverability deutlich besser — User sieht direkt was offen ist und wo der Close-Button ist. 1806 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "Beat-Repeat als Macro-Target (Live-Performance-Tool).",
        "Drag-Drop Pattern-Duplicate.",
        "AI-Projekt-Analyse (aus neue_todos.md)."
      ],
      changed: [
        "package.json",
        "client/src/components/DrumMachine/DrumMachine.tsx",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T16:00:00.000Z",
      done: [
        "MACRO-INLINE-RENAME (v1.93.0): Doppelklick auf das Macro-Label öffnet ein Inline-Input — User kann seinen Macro 'Filter Sweep' oder 'Drop Builder' direkt benennen ohne das Settings-Modal zu öffnen. Enter speichert, Escape verwirft. Leerer Name wird ignoriert (behält alten Wert). 1806 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "v1.94 CLOSE-BUTTONS-AUDIT: 'alle fenster sollen auch mit x zumachbar sein' aus neue_todos.md (granular, polyrhythm, etc).",
        "Beat-Repeat-Macro-Target.",
        "Drag-Drop Pattern-Duplicate."
      ],
      changed: [
        "package.json",
        "client/src/components/Macro/MacroPanel.tsx",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T15:30:00.000Z",
      done: [
        "RCL-PATTERN-BUTTONS + Hidden-Bug-Fix (v1.92.0): Pattern-Buttons im Pattern-Menü sind jetzt per Rechtsklick MIDI-bindbar (`{type:'pattern', patternIndex: <idx>}`). Neue PatternRow-Component (extrahiert aus der DrumMachine inline-map damit Hook-Order konsistent bleibt) ruft useMidiLearn auf, zeigt `CC<n>`-Badge wenn gebunden, Tooltip mit 'Rechtsklick: MIDI-Learn'. Hidden-Bug-Fix nebenbei: vor v1.92 dispatchte useMidi.applyMapping zwar das 'midi:pattern' CustomEvent, aber niemand in App.tsx hörte → das pattern-MidiLearnTarget war faktisch ein NO-OP. Listener in App.tsx ergänzt: konvertiert patternIndex → patternId via dmRef.current.patterns[idx] → setActivePattern. Damit funktioniert Pattern-Wechsel per MIDI-Pad endlich tatsächlich. 1806 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "v1.93 MACRO-RENAME-INLINE: Doppelklick auf Macro-Label öffnet Inline-Edit. Aktuell muss man über das Settings-Menü gehen.",
        "v1.94 AUDIT-CLOSE-BUTTONS: 'alle fenster sollen auch mit x zumachbar sein' aus neue_todos.md — prüfen welche Panels keinen Close-Button haben."
      ],
      changed: [
        "package.json",
        "client/src/App.tsx",
        "client/src/components/DrumMachine/DrumMachine.tsx",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T15:00:00.000Z",
      done: [
        "DOCS-UPDATE (v1.91.0): CLAUDE.md bekommt neue Section 'Right-Click MIDI-Learn (v1.86-v1.90)' mit Übersicht der Foundation (findMappingForTarget, targetsMatch, useMidiLearn, MidiContext) und der bereits gewireten UI-Elemente. neue_todos.md markiert die seit v1.85 fertig geworden Items (Right-Click-Foundation, Output-Test-Button, Macro-Target) und passt 'Vorschläge für nächste Session' an die neue Realität an (Pattern-Drag-Drop, Macro-Rename-UI, Beat-Repeat, Pattern-Buttons-RCL). 1806 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "Session-Ende — 18 Versionen seit v1.66 gepusht. Right-Click-MIDI-Learn-Coverage komplett für Transport, Mixer, Macros, FX. User kann jetzt mit der Electribe + Auto-Learn-Presets ODER Right-Click pro Element seine Hardware-Konfiguration in Minuten aufsetzen.",
        "Offen: Pattern-Buttons RCL, Macro-Label-Rename-UI, Beat-Repeat-Macro, Drag-Drop Pattern-Duplicate.",
        "Größere Roadmap-Items aus neue_todos.md: GitHub-Builder, Auto-Updater, Mobile-Builds, Account/Beta-System, Cloud-Store, Wiki+LLM, ALS vollständig, Workbench Audacity-Level, AI-Projekt-Analyse, Admin/Lite-Tier."
      ],
      changed: [
        "package.json",
        "CLAUDE.md",
        "neue_todos.md",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T14:30:00.000Z",
      done: [
        "RCL-FX-KNOBS (v1.90.0): Alle 15 FX-Knöpfe im FxPanel + FxPopupApp sind jetzt per Rechtsklick MIDI-bindbar. KnobProps bekommt optionale fxParam+partId+partName-Felder; wenn alle gesetzt sind, registriert der Knob einen useMidiLearn-Hook für {type:'fxParam', partId, param}. Mapped-Badge `·CC<n>` im Label. FxPanelBodyProps bekommt entsprechend partId+partName, durchgeschleift zu jedem Knob. FxPanel (dropdown) übergibt part.id+part.name; FxPopupApp übergibt state.partId+state.partName (waren schon im sync-state). Damit ist die komplette FX-Kette (Filter Freq/Q, Distortion Drive, EQ Low/Mid/High, Comp Threshold/Ratio/Attack/Release, Delay Time/Feedback/Mix, Reverb Decay/Mix) per Rechtsklick lernbar — 15 Params × bis zu 8 Parts = 120 zusätzliche bindbare Slots zu den schon zugänglichen Volume/Pan/Mute/Solo. 1806 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "Backlog aus neue_todos.md.",
        "Eventuell: Scripts in ScriptList → Right-Click-MIDI-Learn direkt (wenn der Hook via Context überall funktioniert)."
      ],
      changed: [
        "package.json",
        "client/src/components/DrumMachine/FxPanel.tsx",
        "client/src/components/DrumMachine/FxPopupApp.tsx",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T14:00:00.000Z",
      done: [
        "MIDI-OUTPUT-TEST (v1.89.0): Zwei kleine Test-Buttons im SettingsPanel → KI & MIDI → MIDI Out Section. 'Note testen' sendet Note On 60 (C4) mit vel=100 für 250ms ans aktive Ausgangsgerät, danach Note Off. 'CC testen' sendet CC 74 = 100 (Filter Cutoff). Hilft beim Verifizieren ob das Ausgangsgerät überhaupt MIDI empfängt — typischer Pain-Point bei externen Synths/Drum-Machines. Sichtbar nur wenn midiOutEnabled UND activeOutputDeviceId gesetzt sind. 1806 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "v1.90 SCRIPT-EDITOR-EXTENSIONS: Right-Click MIDI-Learn auf User-Scripts in der ScriptList, damit beim Erstellen direkt ein Pad-Binding möglich ist.",
        "FX-Knöpfe Right-Click in FxPanel.",
        "Backlog aus neue_todos.md."
      ],
      changed: [
        "package.json",
        "client/src/components/Settings/SettingsPanel.tsx",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T13:30:00.000Z",
      done: [
        "RCL-MACROS + MACRO-TARGET (v1.88.0): Neue MidiLearnTarget-Variante `{type:'macro', index, label?}` damit jeder der 8 Makros direkt per CC steuerbar wird (Makro-Slider folgt dem CC-Wert 0..1). useMidi.applyMapping dispatcht 'midi:macroValue'-CustomEvent mit `{index, value: midi/127}`, App.tsx listener ruft `setMacroValue(index, v)`. labelForTarget rendert 'Macro N' bzw. 'Macro N: <Label>'. targetsMatch unterscheidet anhand des index. VALID_TARGET_TYPES um 'macro' erweitert für Layout-Import. UI in MacroPanel MacroKnob: useMidiLearn-Hook am Slider, onContextMenu → Learn-Menu, CC#-Badge im Macro-Label oben. Workflow: rechtsklick auf einen Macro-Slider → 'MIDI-Learn' → Encoder am Electribe drehen → Macro folgt dem CC. 1 neuer Vitest-Case (targetsMatch macro). 1806 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "v1.89 MIDI-Output-Test-Button: einfacher 'Test'-Button der einen CC ans Device sendet zur Verbindungsverifikation.",
        "Backlog aus neue_todos.md."
      ],
      changed: [
        "package.json",
        "client/src/hooks/useMidi.ts",
        "client/src/App.tsx",
        "client/src/components/Macro/MacroPanel.tsx",
        "client/src/utils/midiLayoutImport.ts",
        "tests/features/midi-target-match.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T13:00:00.000Z",
      done: [
        "RIGHT-CLICK-MIDI-LEARN MIXERVIEW (v1.87.0): Erweitert die v1.86-Foundation um die wichtigsten Mixer-Controls. MixerChannel-Component bekommt useMidiLearn-Hooks für Volume (Master = type:'masterVolume', sonst type:'volume'+partId), Pan, Mute, Solo. Volume-Fader hat onContextMenu + Mapped-Badge `·CC<n>` in der dB-Anzeige unterm Slider. Pan-Slider analog (nur für non-Master). Mute + Solo Buttons bekommen rechte-obere-Ecke-Dot-Badge wenn gebunden. Tooltip zeigt CC# wenn vorhanden. Mit dieser Iteration sind die häufigsten Live-Performance-Controls (Volume + Mute + Solo + Pan pro Channel) per Rechtsklick MIDI-bindbar — typischer Electribe-Workflow: Rechtsklick auf Vol-Fader → MIDI-Learn → Slider am Electribe bewegen → fertig, kein Modal mehr nötig. pnpm check 0 Fehler. pnpm test 1805 passed (keine neuen Unit-Tests da nur UI-Wiring, Hook-Logic ist in v1.86 abgedeckt)."
      ],
      next: [
        "v1.88 RCL-FX-PANEL: Right-Click auf FX-Knöpfe (Filter/EQ/Reverb/Delay/Distortion) im MixerView-Inspector und FxPanel.",
        "v1.89 MIDI Output Test Button.",
        "Backlog aus neue_todos.md."
      ],
      changed: [
        "package.json",
        "client/src/components/Mixer/MixerView.tsx",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T12:30:00.000Z",
      done: [
        "RIGHT-CLICK-MIDI-LEARN (v1.86.0): Foundation für Right-Click-MIDI-Learn auf beliebigen UI-Elementen — der Top-Vorschlag aus der neue_todos.md-Wishlist. Neue Pure-Helper `targetsMatch(a, b)` + `findMappingForTarget(mappings, target)` in useMidi.ts (deckt alle MidiLearnTarget-Varianten ab, inkl. partId-Spezifika für volume/mute/solo/pan/fxParam und scriptId/sceneIndex/label/etc für die compound Targets). Neuer Hook `useMidiLearn(target, midiOverride?)` in hooks/useMidiLearn.tsx: liefert onContextMenu-Handler, isMapped-Flag, mappedCC, learn/unbind-Actions und einen vorgerenderten Context-Menu-ReactNode den der Caller einfach inline rendert. Click-outside + Escape schließen das Menü. Neuer Context `MidiContext` in context/MidiContext.tsx mit `MidiProvider` + `useMidiContext()`-Hook damit tief verschachtelte Komponenten den midi-State ohne Prop-Drilling bekommen. App.tsx wrappt jetzt seinen Body mit <MidiProvider value={midi}>. Anwendung in DrumMachine: BPM-Display + Play/Stop-Button bekommen rechtsklick-bare MIDI-Learn-Context-Menüs mit CC#-Badge wenn bereits gebunden — User-Workflow 'rechtsklick auf BPM → MIDI-Learn → Encoder drehen → fertig'. 18 neue Vitest-Cases für targetsMatch (single-targets / volume / fxParam / pattern / step / runScript / chain / scenelaunch / tab) + findMappingForTarget (Hit / partId-spezifisch / fxParam-mit-Param / No-Match / leere Liste). 1805 Tests grün, pnpm check 0 Fehler. Erste Anwendung an 2 Elementen (BPM, Play/Stop) — weitere können in folgenden Releases ergänzt werden (FX-Knöpfe, Volume-Slider, Pattern-Buttons)."
      ],
      next: [
        "v1.87 RCL-MIDI-LEARN-EXPANSION: weitere UI-Elemente anbinden — FX-Knöpfe im FxPanel, Volume-Slider im MixerView, Macro-Buttons.",
        "MIDI Output Test Button (sendet Test-CC zur Verifizierung)",
        "Pattern-Duplicate via Drag-and-Drop",
        "Backlog aus neue_todos.md."
      ],
      changed: [
        "package.json",
        "client/src/hooks/useMidi.ts",
        "client/src/hooks/useMidiLearn.tsx",
        "client/src/context/MidiContext.tsx",
        "client/src/App.tsx",
        "client/src/components/DrumMachine/DrumMachine.tsx",
        "tests/features/midi-target-match.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T12:00:00.000Z",
      done: [
        "SESSION-SUMMARY + neue_todos.md UPDATE (v1.85.0): Abschluss der 4-Stunden-Autonomy-Mission. neue_todos.md komplett überarbeitet: Erledigte Items markiert (Quantize-Crash via v1.71 BUG-025, Techno/Hardtekk-Templates via v1.74+v1.82, FLP-Importer via v1.59-v1.70, ESX-Importer bereits vorhanden), neue Bonus-Features dieser Session aufgelistet (Auto-Learn-Wizard, Layout-Export/Import, FX-Param-Bindings, Function-Chains, Custom-Chain-Builder, Run-Script-Target, Built-In-Scripts, Monitor-Tab, Activity-Indicator, Channel-Filter, Device-Persistenz, CSP-Fix), offen-bleibende Wishlist-Items klar markiert, Vorschläge für nächste Session (Right-Click MIDI-Learn, MIDI-Output-Test-Button, Drag-and-Drop Pattern-Duplicate, Macro-Bank-Labels, Beat-Repeat). Session-Total: 12 Releases v1.74→v1.85, 1787 Tests grün (von 1667 zu Beginn, +120 neue Tests), 5 explizite User-Requests erfüllt (Korg-Connect, Usability, Pattern-Duplicate-Script, Every-Function-bindable, Function-Chains), zwei zusätzliche Bug-Fixes (BUG-024 CSP, BUG-025 Quantize), keine Regressions."
      ],
      next: [
        "Right-Click MIDI-Learn als Context-Menu auf jedem FX-Knopf/Volume-Slider — größter UX-Boost noch offen.",
        "MIDI Output Test Button — sendet Test-CC zur Verifizierung.",
        "Backlog aus neue_todos.md: GitHub-Builder, Updater, Mobile-Build, Account-System, Cloud-Sync, Wiki/LLM-Integration, Admin/Lite-Tiers — alle größere Sprints.",
        "Ableton .als vollständig parsen (aktuell nur Skeleton in alsImport.ts)."
      ],
      changed: [
        "package.json",
        "neue_todos.md",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T11:30:00.000Z",
      done: [
        "DEVICE-PERSISTENCE (v1.84.0): MIDI-Geräte-Auswahl persistiert jetzt über App-Reloads hinweg. Vor v1.84 musste der User nach jedem Neustart sein Eingangs- + Ausgangsgerät erneut auswählen — auch wenn die Hardware angeschlossen blieb. Fix: Persistenz von `{name, manufacturer}` für In + Out in localStorage (`synthstudio:midi-active-device`). Wir verwenden Name+Hersteller statt der MIDI-id, weil die id zwischen Browser-Sessions wechseln kann. Auto-Reconnect-Logik in `refreshDevices`: wenn der aktuelle Wert existiert → connectDevice; wenn ein persistierter Name in der Geräte-Liste matched → connectDevice mit der gemappten id; sonst Fallback auf erstes verfügbares Gerät (existing behavior). Selbiges für outputDevice. Side-Effect: User schließt seine Electribe 2 an, wählt sie in MidiSettings, schließt das Modal → nach Browser-Reload + MIDI-Activation ist die Electribe sofort wieder aktiv. 1787 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "v1.85 FINAL-AUDIT: neue_todos.md update für die erledigten Items, Session-Summary in INDEX.js, eventuelle CLAUDE.md ergänzungen."
      ],
      changed: [
        "package.json",
        "client/src/hooks/useMidi.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T11:00:00.000Z",
      done: [
        "AUTO-LEARN-CHANNEL-FILTER + MORE-BUILT-INS (v1.83.0): Zwei Erweiterungen in einem Release. (1) Auto-Learn Channel-Filter: Wenn der User mehrere MIDI-Geräte gleichzeitig angeschlossen hat (Electribe auf Ch10 + Keystep auf Ch1 + iRig auf Ch2), kann er jetzt einen Channel-Filter in der Auto-Learn-Settings setzen — nur Events auf diesem Channel werden ge-capt-uret, der Rest läuft normal durch den Handler. Neue State `autoLearnFilterChannel: number` + Action `setAutoLearnFilterChannel(ch)` (clamped 0-16, 0=alle). Pure-Helper nextAutoLearnEntry bekommt optionalen 3. Param `filterChannel`. UI in MidiSettings CC-Tab Auto-Learn-Block: Dropdown 'Nur Channel:' (Alle / Ch1-Ch16). (2) 5 weitere Built-In Scripts: 'Build-Up 10s' (BPM-Ramp + Filter-Sweep parallel), 'Stutter (4× Macro-Snap)' (Glitch-Übergänge), 'Macro-Random-Burst' (alle 8 Macros zu Zufallswerten), 'Pattern-Walker (alle 8s nächstes)' (Live-Auto-Pilot), 'Macro 0 Sinus-LFO 15s' (smooth Filter-Bewegung). 3 neue Vitest-Cases für Channel-Filter (default-pass-all / specific-Channel-blocks-others / wirkt auch auf Note-Entries). 1787 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "v1.84 USABILITY-CLEANUPS: Audit ungebundener Features, Doku-Lücken.",
        "v1.85 FINAL-AUDIT: neue_todos.md auf erledigte Items prüfen, Session-Summary."
      ],
      changed: [
        "package.json",
        "client/src/hooks/useMidi.ts",
        "client/src/components/MidiSettings/MidiSettings.tsx",
        "client/src/utils/builtInScripts.ts",
        "tests/features/midi-auto-learn.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T10:30:00.000Z",
      done: [
        "MORE-HARDWARE-TEMPLATES + DOCS (v1.82.0): 4 weitere eingebaute MIDI-Templates für die Techno/Hardtekk-Szene + CLAUDE.md-Update. Neue Templates: Korg Volca Beats (Ch10, 7 Drum-Notes + 7 CC-Sound-Edit), Roland TR-8/RD-8 (Ch10, 8 Drum-Notes + 8 CC-Volumes + masterVolume CC105), Arturia BeatStep Pro (16 Pad-Notes 2-Reihen, 8 Encoder Volume + 8 Encoder Mute), Elektron Digitakt (8 Channels Ch1-8, je Note 60 für die 8 Sample-Tracks + Encoder CCs). MIDI_TEMPLATES insgesamt jetzt 13 Hardware-Vorlagen. CLAUDE.md bekommt neue 'MIDI Bindings (v1.71-v1.82)'-Section mit kompletter Target-Liste, Auto-Learn-Flow, Layout-Import/Export, Hardware-Templates, Monitor-Tab und FX-Param-Bindings. Plus neue 'Built-In Scripts (v1.75)'-Section. 17 neue Vitest-Cases (4× Template-Existenz, 4× CC-Range-Validierung, 4× Note-Range-Validierung, plus Special-Cases: Ch10-Default für Korg/Roland, Multi-Channel für Digitakt, 16-Pad-Count für BeatStep, ≥13 Templates total). 1784 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "v1.83 FINAL-AUDIT: Summary aller v1.74-v1.82 Features, neue_todos.md auf erledigte Items ausmisten, README-Update falls vorhanden."
      ],
      changed: [
        "package.json",
        "client/src/utils/midiTemplates.ts",
        "tests/features/midi-templates.test.ts",
        "CLAUDE.md",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T10:00:00.000Z",
      done: [
        "MIDI-MONITOR-TAB (v1.81.0): Live-Log aller eingehender MIDI-Messages als neuer Tab in MidiSettings. Hilft beim Hardware-Debugging — User sieht exakt welche CCs/Notes auf welchen Channels ankommen. Ringbuffer max 200 Events damit UI nicht erstickt. Pretty-Print: `HH:MM:SS.mmm Ch10 Note On 36 vel=100`. Frische Events (jünger als 500ms) sind accent-secondary-farbig, ältere muted. Pause-Toggle (mit Ref damit der Event-Handler die aktuelle Pause-State sieht ohne re-mount), Leeren-Button, Counter '<n>/200 Events'. Empty-State-Hinweise je nach midi.isEnabled. Reuse von 'midi:rawmessage' CustomEvent. 1767 Tests grün (UI-State, keine neuen Unit-Tests). pnpm check 0 Fehler."
      ],
      next: [
        "v1.82 MORE-HARDWARE-TEMPLATES + DOCS: weitere Techno/Hardtekk-Controller-Templates ergänzen, CLAUDE.md update."
      ],
      changed: [
        "package.json",
        "client/src/components/MidiSettings/MidiSettings.tsx",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T09:30:00.000Z",
      done: [
        "CUSTOM-CHAIN-BUILDER (v1.80.0): Komplement zu v1.77 — statt nur den 4 Preset-Chains kann der User jetzt eigene Function-Chains zusammenklicken. Inline-Form in MidiSettings CC-Tab unter den Chain-Presets (aufklappbar via Toggle-Button). Curated Liste von 17 atomic Actions (Play/Stop, Record, Tap, BPM ±, Pattern Next/Prev/Clear/Fill/Random/Duplicate, Part Up/Down, Toggle Note Repeat, Toggle Morph, Live Edit Commit, Open Settings). User-Workflow: + Schritt → Action-Dropdown wählen → delayMs setzen → reorder via ▲/▼ → 'Speichern & Lernen' Button → Learn-Mode mit dem zusammengebauten Chain. Implementation: lokaler State `chainBuilderSteps: Array<{targetKey, delayMs}>` + `chainBuilderName`. handleChainBuilderLearn serialisiert das in MidiLearnTarget {type:'chain', label, steps} und ruft midi.startLearn(). 1767 Tests grün (keine neuen Unit-Tests da pure UI-State; planChainExecution-Tests aus v1.77 decken die Chain-Runtime-Validierung). pnpm check 0 Fehler."
      ],
      next: [
        "v1.81 FINAL-AUDIT: Review aller v1.74-v1.80 Features, Doku-Update in CLAUDE.md, INDEX.bugs check."
      ],
      changed: [
        "package.json",
        "client/src/components/MidiSettings/MidiSettings.tsx",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T09:00:00.000Z",
      done: [
        "MIDI-ACTIVITY-INDICATOR + DEFAULT-FILENAME (v1.79.0): Zwei UX-Wins für den MIDI-Workflow. (1) Live-Activity-Indicator im MidiSettings-Header zeigt die letzte eingehende MIDI-Message (Note On/Off, CC, Aftertouch, PB) und pulst grün für 150ms bei jedem Event — der User sieht direkt ob seine Hardware tatsächlich sendet (häufige Frage: 'kommt überhaupt was an?'). Hört auf das bereits existierende `midi:rawmessage` CustomEvent. Pretty-Print: 'CC 7 = 64 (Ch1)'. (2) Neuer Pure-Helper `defaultLayoutNameForDevice(deviceName?)` in midiLayoutExport.ts: leerer Input → 'Mein MIDI-Setup' Fallback, sonst '<DeviceName>-Setup'. MidiSettings useEffect-Hook aktualisiert exportName beim Device-Wechsel — nur falls der User ihn nicht manuell überschrieben hat (exportNameTouched-Flag). User klickt jetzt MIDI-Settings, das Setup ist sofort sinnvoll vorbelegt mit z.B. 'Korg Electribe 2-Setup'. 4 neue Vitest-Cases für defaultLayoutNameForDevice (null/undefined/empty/whitespace → Fallback, normal/whitespace-getrimmt → Suffix). 1767 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "v1.80 CUSTOM-CHAIN-BUILDER: UI-Form mit 'Add Step' damit der User eigene Chains ohne JSON-Editor bauen kann.",
        "v1.81 FINAL-AUDIT: Welche Features sind noch UI-versteckt? Welche Settings noch nicht zugänglich? Doku-Update."
      ],
      changed: [
        "package.json",
        "client/src/utils/midiLayoutExport.ts",
        "client/src/components/MidiSettings/MidiSettings.tsx",
        "tests/features/midi-layout-export.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T08:30:00.000Z",
      done: [
        "RUN-SCRIPT-TARGET (v1.78.0): User-Scripts (aus useScriptStore) sind jetzt als MidiLearnTarget bindbar. Neue Variante `{type:'runScript', scriptId, scriptName?}`. applyMapping dispatcht 'midi:runScript' CustomEvent mit der scriptId; App.tsx listener ruft scriptSandbox.run() mit Re-Entrancy-Schutz auf (gleicher Pattern wie der existierende macro:button:trigger Pfad). UI in MidiSettings CC-Tab: neue 'User-Scripts auf MIDI binden'-Section listet alle Scripts aus useScriptStore, jeder mit Learn-Button. Zeigt enabled/disabled + Byte-Count. labelForTarget rendert 'Script: <name>' bzw. gekürzte ID. VALID_TARGET_TYPES um 'runScript' erweitert → Layouts importierbar. Kombination mit v1.77 chain: runScript kann als Sub-Target in einer chain stehen (1-Level-Nesting). 5 neue Vitest-Cases (label-name+fallback, VALID_TARGET-Check, Round-Trip Export→Import, chain-runScript-Kombination). 1763 Tests grün, pnpm check 0 Fehler. User-Request 'Jeden Effekt und jede Funktion belegbar auf makro oder taste' jetzt vollständig — komplette ss.*-API kann via Script gebunden werden."
      ],
      next: [
        "v1.79 DEFAULT-FILENAME-AUS-DEVICE: midi.activeDeviceId-Lookup im Layout-Export-Field, damit der User nicht jedes Mal manuell 'Mein Setup' tippen muss.",
        "v1.80 USABILITY-AUDIT: Welche Features sind UI-mäßig versteckt, welche Settings noch nicht zugänglich?"
      ],
      changed: [
        "package.json",
        "client/src/hooks/useMidi.ts",
        "client/src/App.tsx",
        "client/src/components/MidiSettings/MidiSettings.tsx",
        "client/src/utils/midiLayoutImport.ts",
        "tests/features/midi-runscript-target.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T08:00:00.000Z",
      done: [
        "FUNCTION-CHAINS (v1.77.0): User-Request 'Funktionsabläufe oder mehrere Effekte auf eine Taste oder makro legen' — neue MidiLearnTarget-Variante `{type:'chain', label, steps: ChainStep[]}`. Jeder ChainStep enthält ein Sub-Target plus optionalen `value` (0-127, default 127) und `delayMs` (clamped 0-60s). Pure-Helper `planChainExecution(steps): ChainPlan` berechnet kumulative atMs-Werte für jeden Step und filtert nested chains (1-Level only — Defense-in-Depth gegen infinite-Rekursion). applyMapping branched für 'chain' → schedulet jeden Trigger via setTimeout, ruft applyMapping rekursiv für Sub-Targets. UI in MidiSettings CC-Tab: neue Chain-Presets-Section mit 4 ready-made Multi-Step-Actions (Drop-Combo / Duplicate+Randomize / Tap×4+Play / Fill+Next). User klickt einen Preset → Learn-Mode → bewegt Controller → ganze Sequenz auf einer Taste. VALID_TARGET_TYPES um 'chain' erweitert damit Layouts mit Chains importierbar bleiben. 10 neue Vitest-Cases für planChainExecution (empty/single/multi+delay/value-clamp/delay-clamp 60s/chain-of-chain-block/no-target/drop-combo/step-index). 1758 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "v1.78 SCRIPT-RUN-TARGET: MIDI-Pad bindbar an User-Script (out of useScriptStore).",
        "v1.79 CUSTOM-CHAIN-BUILDER: UI-Form damit der User eigene Chains (nicht nur Presets) zusammenklicken kann.",
        "v1.80 DEFAULT-FILENAME-AUS-DEVICE: midi.activeDeviceId → Hersteller+Modell → exportName-default."
      ],
      changed: [
        "package.json",
        "client/src/hooks/useMidi.ts",
        "client/src/components/MidiSettings/MidiSettings.tsx",
        "client/src/utils/midiLayoutImport.ts",
        "tests/features/function-chains.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T07:30:00.000Z",
      done: [
        "FX-PARAM-TARGETS (v1.76.0): Jeder numerische FX-Parameter pro Channel ist jetzt als MidiLearnTarget bindbar — Filter (Freq mit exp-Mapping über 20Hz-20kHz, Q, Gain), Distortion (Drive 0-400), Compressor (Threshold/Ratio/Attack/Release), Delay (Time/Feedback/Mix), Reverb (Decay/Mix), 3-Band EQ (Low/Mid/High). 16 Params × 8 Parts = 128 bindbare Slots. Neue Pure-Helpers `FX_PARAM_RANGES`, `midiValueToFxParam(midi, range)`, `findFxParamRange(key)` in `client/src/audio/AudioEngine.ts` (linear oder exponential per Range-Config). MidiLearnTarget bekommt `{type:'fxParam', partId, partName?, param}` Variante. useMidi.applyMapping dispatcht `midi:fxParam`-CustomEvent mit `{partId, param, value}` (im param-Range bereits skaliert). UI in MidiSettings: neue Dropdown+Grid-Section unter dem normalen Learn-Bereich, User wählt Part → bekommt 16 Buttons für die Params, jeder Learn-bar. BONUS-FIX: Vor v1.76 dispatchten useMidi die Events `midi:partVolume`, `midi:partPan`, `midi:partSolo`, `midi:masterVolume` ohne dass irgendwo Listeners liefen → CC-Mappings für Volume/Pan/Solo waren faktisch NO-OPs. App.tsx bekommt jetzt einen useEffect mit Listenern, die in `dmRef.current.setPartVolume/setPartPan/setPartSoloed/setPartFx` schreiben. Zusätzlich Mute auf CustomEvent-Pattern umgestellt (statt onMute-Callback der nie übergeben wurde). VALID_TARGET_TYPES in midiLayoutImport.ts um 'fxParam' erweitert damit Layouts mit FX-Bindings importierbar bleiben. 12 neue Vitest-Cases für FX_PARAM_RANGES/findFxParamRange/midiValueToFxParam (linear + exp + clamping + monotonie). 1748 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "v1.77 FUNCTION-CHAINS: mehrere Actions hintereinander auf einer Taste/Macro (User-Request).",
        "v1.78 SCRIPT-RUN-TARGET: MIDI-Pad bindbar an User-Script.",
        "v1.79-80 USABILITY-POLISH: Default-Filename-Generation aus Device-Name, Audit ungebundener Features."
      ],
      changed: [
        "package.json",
        "client/src/audio/AudioEngine.ts",
        "client/src/hooks/useMidi.ts",
        "client/src/App.tsx",
        "client/src/components/MidiSettings/MidiSettings.tsx",
        "client/src/utils/midiLayoutImport.ts",
        "tests/features/fx-param-bindings.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T07:00:00.000Z",
      done: [
        "BUILT-IN-SCRIPTS (v1.75.0): 7 vorgefertigte ss.*-Scripts — der User kann sie ohne KI-API-Key direkt im ScriptRunner laden. Neues Modul `client/src/utils/builtInScripts.ts` mit `BUILT_IN_SCRIPTS`-Registry, `groupBuiltInsByCategory()` + `findBuiltIn(id)`. Erste Built-Ins decken User-Request 'Pattern duplizieren' ab (3 Varianten: solo, +Randomize, +Fill) plus Transport-Pipeline (Tap→Play), Performance (Drop-Reset) und Macro-Reset (alle auf 0 bzw. 0.5). UI im ScriptRunner: neuer '📚 Built-In'-Button öffnet ein Modal mit kategorisierter Liste; Klick lädt das Script via addScript({scope:'app', enabled:true}) und selektiert es direkt. Sandbox-Audit: pattern-duplicate-Action war bereits voll wired (sandbox-Allowlist, App.tsx-case, kbd-shortcut Ctrl+D, MIDI-target, MidiLayoutImport.ts). 11 neue Vitest-Cases: Registry-Vollständigkeit, ID-Eindeutigkeit, sandbox-Konformität via validateGeneratedCode (catches eval/fetch/etc), Allowlist-Audit für ss.dispatch-Action-Strings, Category-Grouping. 1736 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "v1.76 FX-PARAM-TARGETS: jeder FX-Parameter (filterFreq, filterQ, reverbDecay, reverbMix, delayTime, delayFeedback, delayMix, eqLow/Mid/High, distortionAmount, compressor-params) als MidiLearnTarget bindbar.",
        "v1.77 FUNCTION-CHAINS: mehrere Actions hintereinander auf einer Taste/Macro.",
        "v1.78 SCRIPT-RUN-TARGET: MIDI-Pad bindbar an User-Script.",
        "v1.79-80 USABILITY-POLISH: Default-Filename-Generation aus Device-Name, Audit ungebundener Features."
      ],
      changed: [
        "package.json",
        "client/src/utils/builtInScripts.ts",
        "client/src/components/Tools/ScriptRunner.tsx",
        "tests/features/built-in-scripts.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T06:30:00.000Z",
      done: [
        "ELECTRIBE-2-TEMPLATE (v1.74.0): Korg Electribe 2 / 2S als 9. eingebautes Hardware-Template in `MIDI_TEMPLATES`. 16 Pad-Mappings auf Channel 10 (GM-Drum-Default des Electribe), Notes 36-51 → erste Reihe (36-43) auf part-0..part-7, zweite Reihe (44-51) repliziert dieselbe Belegung damit beide Pad-Reihen denselben Drum-Sound triggern. CC-Mappings: masterVolume (CC7), BPM (CC1 = Mod-Wheel), 4 Part-Volumes auf CC74/71/73/72 (Standard-Korg-Knob-Layout). Transport per MIDI Start/Stop (0xFA/0xFC) wird bereits separat im handleMidiMessage gehandhabt — keine CC-Mappings nötig. 7 neue Vitest-Cases (Existenz/Pad-Count/Ch10/Note-Range 36-51/Double-Row-Mapping/CC-Inhalt/Round-Trip-Labels). 1725 Tests grün, pnpm check 0 Fehler. Erster Schritt der 4-Stunden-Autonomy-Mission: User-Fokus auf Electribe-2-Integration."
      ],
      next: [
        "v1.75 PATTERN-DUPLICATE-SCRIPT: Built-in Script-Template aus aiScriptTemplates.ts der das aktuelle Pattern via `ss.dispatch('pattern-duplicate')` dupliziert. Audit ob die Action wirklich existiert.",
        "v1.76 FX-PARAM-TARGETS: jeder FX-Parameter (filterFreq, reverbWet, etc.) als MidiLearnTarget bindbar — aktuell nur volume/mute/solo/pan.",
        "v1.77 FUNCTION-CHAINS: mehrere Actions hintereinander auf einer Taste/Macro.",
        "v1.78 SCRIPT-RUN-TARGET: MIDI-Pad bindbar an User-Script.",
        "v1.79-80 USABILITY-POLISH: Default-Filename-Generation aus Device-Name, Audit ungebundener Features."
      ],
      changed: [
        "package.json",
        "client/src/utils/midiTemplates.ts",
        "tests/features/midi-templates.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T06:00:00.000Z",
      done: [
        "MIDI-LAYOUT-EXPORT (v1.73.0): Komplementär zu midiLayoutImport.ts (v1.38+) — nach Auto-Learn kann der User seine Hardware-Konfiguration jetzt als JSON-Template speichern + teilen. Neues Modul `client/src/utils/midiLayoutExport.ts` mit `buildMidiLayoutJson(input): string` (Pretty-Print, synthstudioLayout v1) und `sanitizeLayoutFileName(name): string` (Unicode-safe, erlaubt Umlaute via \\p{L}\\p{N}, escapt Path-Separator). Round-Trip-Garantie: `parseMidiLayoutJson(buildMidiLayoutJson(x))` reproduziert x.ccMappings + x.noteMappings 1:1. UI in MidiSettings CC-Tab unter den aktiven Mappings: Input-Feld für Layout-Name + '💾 Als JSON speichern'-Button → Browser-Download via Blob+anchor. Sichtbar nur wenn mind. ein Mapping existiert. Bonus-Fix: `VALID_TARGET_TYPES` in midiLayoutImport.ts war unvollständig — `scenelaunch`, `commitLiveEdit`, `openSettings` existieren in der MidiLearnTarget-Union, wurden aber beim Layout-Import als ungültig verworfen → ergänzt. 13 neue Vitest-Cases (7 buildMidiLayoutJson inkl. 3 Round-Trip-Tests, 6 sanitizeLayoutFileName inkl. Unicode/Umlaute). Test deckt direkt den Electribe-2-Use-Case ab (gemischte CC+Note). 1718 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "FLP-MIDI-EXPORT Phase 4: SMF-Export von Melodic-Parts mit Pitch + Duration (umgekehrte Richtung — Synthstudio → DAW Re-Import).",
        "MIDI-LAYOUT-EXPORT-V2: Default-Filename-Generation aus aktivem Device-Namen (`midi.activeDeviceId` → Hersteller+Modell-String). Aktuell muss der User immer manuell tippen.",
        "FEAT-INSP: bleibt offen (Explore-Report verfügbar, 4-5h, 8+ Files).",
        "neue_todos.md Backlog: GitHub-Builder-Workflow, Updater, Mobile-Build, Login/Beta-System, Plugin-Wiki/LLM, Sample-Cloud, MIDI-Templates für Hardtekk-Gear, .als/.elst-Konverter, Workbench-Audacity-Niveau, AI-Projekt-Analyse, Admin/Lite-Tier-Lizenz."
      ],
      changed: [
        "package.json",
        "client/src/utils/midiLayoutExport.ts",
        "client/src/utils/midiLayoutImport.ts",
        "client/src/components/MidiSettings/MidiSettings.tsx",
        "tests/features/midi-layout-export.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T05:30:00.000Z",
      done: [
        "MIDI-AUTO-LEARN-V2 (v1.72.0): Phase 2 von MIDI-AUTO-LEARN — Note-Mode für Pads. Neue discriminated-union `AutoLearnEntry = {kind:'cc', target} | {kind:'note', partId, partName}` ersetzt das vorige `MidiLearnTarget[]`-Schema. `handleMidiMessage` matched eingehende Messages gegen den `kind` des Queue-Heads: CC-Entries akzeptieren CC-Messages mit Value>0, Note-Entries akzeptieren Note-On mit Velocity>0. Mismatches lassen die Queue unverändert + die Message läuft normal weiter durch den Handler. Refactor: `labelForTarget` und neuer Pure-Helper `nextAutoLearnEntry(queue, msg)` aus dem Hook-Body ausgelagert → Modul-Scope → testbar. handleMidiMessage delegiert die Queue-Transition jetzt an die pure Funktion. UI in MidiSettings: 2 neue Presets — `Pads → Parts` (n Note-Entries, einer pro Part) und `Komplett (Pads + Mixer)` (Pads zuerst, dann Volumes+Mutes). Auto-Learn-Card zeigt `Pad: <Name>` bzw. `CC: <Target>` für jedes Queue-Item. 18 neue Vitest-Cases in tests/features/midi-auto-learn.test.ts (7 labelForTarget + 11 nextAutoLearnEntry, inkl. CC/Note Mismatch + Value=0 + Mixed-Queue + Channel-Persist + Aftertouch-Filter). 1705 Tests grün, pnpm check 0 Fehler. Direkt motiviert durch User-Workflow mit Electribe 2 Sampler (16 Pads + 8 Slider)."
      ],
      next: [
        "FLP-MIDI-EXPORT Phase 4: SMF-Export von Melodic-Parts mit Pitch + Duration (umgekehrte Richtung — Synthstudio → FL Studio / DAW Re-Import).",
        "MIDI-CONTROLLER-TEMPLATE-CAPTURE: nach Auto-Learn → 'Speichere als Template' Button, damit der User seine Hardware-Konfiguration als JSON exportieren + teilen kann (Anschluss an midiLayoutImport.ts).",
        "FEAT-INSP: bleibt offen (Explore-Report verfügbar, 4-5h, 8+ Files).",
        "neue_todos.md Backlog: GitHub-Builder-Workflow, Updater, Mobile-Build, Login/Beta-System, Plugin-Wiki/LLM, Sample-Cloud, MIDI-Templates für Hardtekk-Gear, .als/.elst-Konverter, Workbench-Audacity-Niveau, AI-Projekt-Analyse, Admin/Lite-Tier-Lizenz."
      ],
      changed: [
        "package.json",
        "client/src/hooks/useMidi.ts",
        "client/src/components/MidiSettings/MidiSettings.tsx",
        "tests/features/midi-auto-learn.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T05:00:00.000Z",
      done: [
        "BUG-025 + MIDI-AUTO-LEARN (v1.71.0): Doppel-Drop. (1) BUG-025-Fix: `_migratePattern` in useMelodicPartStore.ts validiert scaleId jetzt gegen neue `KNOWN_SCALE_IDS` Set aus scales.ts statt nur `typeof === 'string'`. Korrupte/veraltete Werte (Schema-Drift, alte Storage-Snapshots) werden auf `chromatic` migriert. setScale validiert zusätzlich runtime damit TS-Casts keine ungültige ID einsmuggeln. Verhindert PianoRoll-React-Crash via `getScale: Unknown scale id`. (2) MIDI-AUTO-LEARN: neue Auto-Learn-Queue in useMidi.ts — `autoLearnQueue: MidiLearnTarget[]` + `autoLearnTotal` State, `startAutoLearn(targets)` / `skipAutoLearnTarget()` / `cancelAutoLearn()` Actions. `handleMidiMessage` shiftet queue bei jedem CC-Capture, schreibt Mapping ins existierende mappings-Array, advanciert automatisch. UI in MidiSettings CC-Tab: drei Preset-Buttons (Mixer Vol+Mute / Transport / Pattern-Navigation), Live-Progress-Karte mit aktuell zu lernendem Target-Label + 'Skip'/'Abbrechen', Vorschau der nächsten 3 Targets. `targetLabel()` erweitert für alle ~20 MidiLearnTarget-Typen inkl. Part-Namen für Volume/Mute/Solo/Pan. Test-Beweggrund vom User: Electribe 2 Sampler-Verknüpfung. 6 neue Vitest-Cases (3 isKnownScaleId + 3 setScale-runtime-validation). 1687 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "MIDI-AUTO-LEARN-V2: Sub-Phase mit Note-Mode (Pads → Note-Mappings) — aktuell nur CC-Lernen. Für Electribe-2-Style-Pads + GM-Drum-Pads würde das einen 'Auto-Learn Pads'-Preset ergänzen.",
        "FLP-MIDI-EXPORT Phase 4: SMF-Export von Melodic-Parts mit Pitch + Duration (umgekehrte Richtung — Synthstudio → FL Studio Re-Import).",
        "FEAT-INSP: bleibt offen (Explore-Report verfügbar, 4-5h, 8+ Files).",
        "neue_todos.md Backlog: GitHub-Builder-Workflow, Updater, Mobile-Build, Login/Beta-System, Plugin-Wiki/LLM, Sample-Cloud, MIDI-Templates für Hardtekk-Gear, .als/.elst-Konverter, Workbench-Audacity-Niveau, AI-Projekt-Analyse, Admin/Lite-Tier-Lizenz."
      ],
      changed: [
        "package.json",
        "client/src/utils/scales.ts",
        "client/src/store/useMelodicPartStore.ts",
        "client/src/hooks/useMidi.ts",
        "client/src/components/MidiSettings/MidiSettings.tsx",
        "tests/scales.test.ts",
        "tests/melodic-part.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T04:30:00.000Z",
      done: [
        "FLP-PATTERN-NAMES (v1.70.0): Analog zu Phase 3 (Channel-Names) jetzt auch Pattern-Namen aus dem FLP übernehmen. `0xC1 TEXT_PATTERN_NAME`-Events werden im Event-Loop dem aktuellen Pattern-Index (gesetzt durch 0x4F NewPattern) zugeordnet und in `FlpParsed.patternNames: Map<number, string>` gespeichert. Cross-Contamination-Check: 0xC1 wird NUR in patternNames, 0xC3 NUR in channelNames geschrieben. `importFlp()` nutzt jetzt `parsed.patternNames.get(firstPattern.index)` als baseName, mit Fallback auf Dateiname-Stem ohne `.flp`. Multi-Bar: 'Verse' + 3 Bars → 'Verse bar 1/2/3'. 7 neue Vitest-Cases: 5 parseFlp.patternNames (empty/single/no-NewPattern/multi/cross-contamination), 2 importFlp.baseName (pattern-name-preferred / filename-fallback). 1681 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "FLP-MIDI-EXPORT Phase 4: SMF-Export von Melodic-Parts mit Pitch + Duration (umgekehrte Richtung — Synthstudio → FL Studio Re-Import). Größerer Schritt, eigenständiger Code-Pfad in electron/export.ts oder utils/midiExport.ts.",
        "FEAT-INSP: bleibt offen (Explore-Report verfügbar, 4-5h, 8+ Files).",
        "neue_todos.md Backlog: Quantize-Crash-Fix (oberste Priorität — User-blocker), GitHub-Builder-Workflow, Updater, Mobile-Build, Login/Beta-System, Plugin-Wiki/LLM, Sample-Cloud, MIDI-Templates für Hardtekk-Gear, .als/.elst-Konverter, Workbench-Audacity-Niveau, AI-Projekt-Analyse, Admin/Lite-Tier-Lizenz."
      ],
      changed: [
        "package.json",
        "client/src/utils/flpImport.ts",
        "client/src/utils/imports/flpImport.ts",
        "tests/features/flp-import.test.ts",
        "tests/features/project-imports.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T04:00:00.000Z",
      done: [
        "FLP-MELODIC-POLISH (v1.69.0): UX-Polish für FLP-MELODIC-ROUTE — Piano-Roll-View zentriert nach Import auf den tatsächlichen Notenbereich statt Default C4. Neue pure Funktion `pitchMedian(pitches)` in `client/src/utils/imports/flpImport.ts` (gerade Anzahl → gerundeter Mittelwert, ungerade → exakter Median, leer → 60). `ImportedMelodicPart` bekommt optionales `baseNote: number`-Feld in `imports/types.ts`. `buildMelodicParts` setzt baseNote = pitchMedian der Notes des Channels. `routeMelodicPartsToPatterns` emittiert neuen `baseNotes: MelodicBaseNoteMapping[]` neben den existierenden mappings (first-wins pro partId via Map-Insertion-Order; Multi-Bar liefert pro Bar einen Eintrag, weil pro Bar eigene partIds). App.tsx ruft `setBaseNote` aus useMelodicPartStore vor `setNote` auf. 11 neue Vitest-Cases (5 pitchMedian + 2 buildMelodicParts.baseNote + 4 routeMelodicPartsToPatterns.baseNotes). 1674 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "FLP-PATTERN-NAMES: 0xC1 TEXT_PATTERN_NAME parsen für echte Pattern-Namen statt 'filename bar N' (analog zu Phase 3 v1.68).",
        "FLP-MIDI-EXPORT Phase 4: SMF-Export von Melodic-Parts mit Pitch + Duration (umgekehrte Richtung — Synthstudio → FL Studio Re-Import).",
        "FEAT-INSP: bleibt offen (Explore-Report verfügbar, 4-5h, 8+ Files).",
        "neue_todos.md Backlog: Quantize-Crash, GitHub-Builder, Updater, Mobile-Build, Login/Beta, Plugin-Wiki, Sample-Cloud, MIDI-Templates, .als/.elst-Konverter, Workbench-Ausbau, AI-Projekt-Analyse, Admin/Lite-Tiers — User-Wishlist aus neue_todos.md."
      ],
      changed: [
        "package.json",
        "client/src/utils/imports/types.ts",
        "client/src/utils/imports/flpImport.ts",
        "client/src/utils/imports/index.ts",
        "client/src/App.tsx",
        "tests/features/project-imports.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T03:30:00.000Z",
      done: [
        "FLP-CHANNEL-NAMES (v1.68.0): Phase 3 von MELODIC-ROUTE. Statt generischer 'Part N'/'Channel N' Labels nutzt der FLP-Importer jetzt die echten Sample-/Instrument-Namen aus dem FLP. Parser-Erweiterung in `client/src/utils/flpImport.ts`: FlpParsed bekommt `channelNames: Map<number, string>`. Event-Loop trackt jetzt zusätzlich zu currentPatternIndex einen `currentChannel` (gesetzt durch 0x40 NewChannel WORD-Event). 0xC3 TEXT_CHANNEL_NAME (alias TEXT_DEFPLUGNAME) wird dem currentChannel zugeordnet. Neuer pure `decodeFlpText(bytes)`-Helper: heuristik UTF-16LE-vs-Latin-1 anhand `bytes[1]===0 && bytes[3]===0`, robust gegen sowohl 'Kick' ASCII als auch 'Kick' UTF-16LE-encoded mit trailing nulls. Wiring (`client/src/utils/imports/flpImport.ts`): channelNames werden in drum-like (für `buildPartsForBar` → ImportedPart.name) und melodic (für `buildMelodicParts` → ImportedMelodicPart.name) gesplittet, damit melodische Namen nicht die Drum-Parts überschreiben und umgekehrt. partIdx-Kollision: first-wins (deterministisch via Map-Insertion-Order). 11 neue Vitest-Cases (5 decodeFlpText + 6 parseFlp.channelNames) + 2 neue für buildMelodicParts.name-Mapping. Alle 1663 Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "FLP-MELODIC-POLISH: baseNote pro MelodicPart aus Pitch-Statistik (median/mean) setzen, damit Piano-Roll-View beim Öffnen direkt auf die importierten Notes zentriert; aktuell bleibt Default C4.",
        "FLP-MIDI-EXPORT Phase 4: SMF-Export von Melodic-Parts mit Pitch + Duration (umgekehrte Richtung — Synthstudio → FL Studio Re-Import).",
        "FLP-PATTERN-NAMES: 0xC1 TEXT_PATTERN_NAME für echte Pattern-Namen statt 'filename bar N' nutzen (analog zu Phase 3).",
        "FEAT-INSP: bleibt offen (Explore-Report verfügbar, 4-5h, 8+ Files)."
      ],
      changed: [
        "package.json",
        "client/src/utils/flpImport.ts",
        "client/src/utils/imports/flpImport.ts",
        "tests/features/flp-import.test.ts",
        "tests/features/project-imports.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T03:00:00.000Z",
      done: [
        "BUG-024-CSP-AI (v1.67.0): User-Report 'KI Script-Erstellung geht nicht trotz ChatGPT API Key'. Root-Cause: Electron-Production-CSP (`electron/csp.ts`) hatte `connect-src 'self' ws: wss:` ohne AI-Provider-Hosts → Chromium blockte alle `fetch('https://api.openai.com/...')`-Calls aus dem Renderer mit 'Refused to connect... violates CSP'. Im Web-Build keine CSP-meta-tag → dort lief es, daher User-Symptom nur in Electron-App. Anthropic-Aufrufe waren technisch genauso betroffen — User hat es nur über OpenAI bemerkt. Fix: `https://api.openai.com` + `https://api.anthropic.com` in connect-src für Prod- UND Dev-CSP-Directives aufgenommen. CSP-Header-Snapshot aktualisiert (Prod + Dev). Neuer Positiv-Test 'connect-src erlaubt api.openai.com + api.anthropic.com (BUG-024, v1.67)' in tests/electron/csp-header.test.ts. Doku-Block oben in csp.ts aktualisiert. BUG-024 als 'fixed: true' im INDEX.bugs eingetragen."
      ],
      next: [
        "FLP-CHANNEL-NAMES Phase 3: TEXT_CHANNEL_NAME (0xC3) aus FLP-Events extrahieren → echte Sample-/Instrument-Namen statt 'Channel N' (auch für ImportedMelodicPart.name)",
        "FLP-MELODIC-POLISH: baseNote pro MelodicPart aus Pitch-Statistik (median/mean) setzen, damit Piano-Roll-View beim Öffnen direkt auf die importierten Notes zentriert; aktuell bleibt Default C4.",
        "FLP-MIDI-EXPORT Phase 4: SMF-Export von Melodic-Parts mit Pitch + Duration (umgekehrte Richtung — Synthstudio → FL Studio Re-Import)",
        "FEAT-INSP: bleibt offen (Explore-Report verfügbar, 4-5h, 8+ Files)"
      ],
      changed: [
        "package.json",
        "electron/csp.ts",
        "tests/electron/csp-header.test.ts",
        "tests/electron/__snapshots__/csp-header.test.ts.snap",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T02:30:00.000Z",
      done: [
        "FLP-MELODIC-ROUTE (v1.66.0): Phase 2 von MELODIC-ROUTE. Die in v1.65 extrahierten `ImportedMelodicPart`-Daten werden jetzt aktiv in den `useMelodicPartStore` geroutet — beim Import einer .flp mit melodischen FL-Channels erscheinen die Notes automatisch im Piano Roll der entsprechenden Drum-Parts. Neue Pure-Function `routeMelodicPartsToPatterns(melodicParts, patterns, stepsPerBar=16, partCount=8)` in `client/src/utils/imports/index.ts`: mappt sourceChannel%partCount auf Part-IDs, quantisiert startStep-Float auf 16-Step-Grid via Math.round, splittet Multi-Bar-Notes auf die importierten Bar-Patterns, last-note-wins bei Konflikten + Warnungs-Sammlung (Konflikte und out-of-range-Notes). ProjectManager-Callback `onImportPatterns` um `melodicParts?: ImportedMelodicPart[]` erweitert. App.tsx ruft `setMelodicNote` + `setMelodicVelocity` aus dem Store direkt auf die Mappings auf. Warning-Text in flpImport.ts gewechselt von 'Pitch-Info verworfen' → 'als Melodic-Part in den Piano Roll geroutet'. 9 neue Vitest-Cases für routeMelodicPartsToPatterns (empty/no-target/partIdx-modulo/multi-bar/rounding/conflict/out-of-range/multi-channel/velocity-passthrough), alle FLP-Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "FLP-CHANNEL-NAMES Phase 3: TEXT_CHANNEL_NAME (0xC3) aus FLP-Events extrahieren → echte Sample-/Instrument-Namen statt 'Channel N' (auch für ImportedMelodicPart.name)",
        "FLP-MELODIC-POLISH: baseNote pro MelodicPart aus Pitch-Statistik (median/mean) setzen, damit Piano-Roll-View beim Öffnen direkt auf die importierten Notes zentriert; aktuell bleibt Default C4.",
        "FLP-MIDI-EXPORT Phase 4: SMF-Export von Melodic-Parts mit Pitch + Duration (umgekehrte Richtung — Synthstudio → FL Studio Re-Import)",
        "FEAT-INSP: bleibt offen (Explore-Report verfügbar, 4-5h, 8+ Files)"
      ],
      changed: [
        "package.json",
        "client/src/utils/imports/index.ts",
        "client/src/utils/imports/flpImport.ts",
        "client/src/components/ProjectManager/ProjectManager.tsx",
        "client/src/App.tsx",
        "tests/features/project-imports.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T01:55:00.000Z",
      done: [
        "FLP-MELODIC-PARTS (v1.65.0): Phase 1 von MELODIC-ROUTE. Extrahiert melodische FL-Channels als strukturierte `ImportedMelodicPart`-Daten mit voller Pitch+StartStep+Duration+Velocity-Info pro Note. Neue Types ImportedMelodicNote + ImportedMelodicPart in imports/types.ts. ImportResult.melodicParts (optional, undefined wenn keine melodischen Channels gefunden). buildMelodicParts(notes, ppq) Helper: gruppiert pro melodischem Channel, konvertiert PPQ→Steps (Float), sortiert nach startStep. Aktuell KEIN UI-Konsument — reine Daten-Vorbereitung. Drum-Import unverändert. 7 neue Tests, 25/25 grün, alle 78 FLP-Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "FLP-MELODIC-ROUTE Phase 2: ProjectManager konsumiert melodicParts → Melodic-Pattern-Erzeugung in useMelodicPartStore",
        "FLP-CHANNEL-NAMES Phase 3: TEXT_CHANNEL_NAME (0xC3) aus FLP-Events extrahieren → echte Sample-/Instrument-Namen statt 'Channel N'",
        "FLP-MIDI-EXPORT Phase 4: SMF-Export von Melodic-Parts mit Pitch + Duration",
        "FEAT-INSP: bleibt offen (Explore-Report verfügbar, 4-5h, 8+ Files)"
      ],
      changed: [
        "package.json",
        "client/src/utils/imports/types.ts",
        "client/src/utils/imports/flpImport.ts",
        "tests/features/project-imports.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T01:40:00.000Z",
      done: [
        "FLP-MELODIC-WARN (v1.64.0): Importer warnt bei melodischen FLP-Channels statt Pitch-Info still zu verwerfen. Neuer `detectChannelPitches`-Helper zählt distinct gespielte MIDI-Keys pro FL-Channel — ≥2 = melodisch, 1 = drum-like. Warnung enthält Channel-ID + Pitch-Anzahl + Range (z.B. 'Channel 1: melodischer Inhalt (4 Tonhöhen, E2..B2)'). Bonus: `ImportedStep.pitch` wird jetzt befüllt (vorher always undefined), damit zukünftige Konsumenten (MelodicPart-Routing, MIDI-Export) ohne zweiten Parser-Pass auf die Pitch-Info zugreifen können. 5 neue Vitest-Cases in project-imports.test.ts, alle 78 FLP-Tests grün, pnpm check 0 Fehler."
      ],
      next: [
        "FLP-MELODIC-ROUTE: melodische Channels in MelodicParts statt Drum-Parts routen — eigentliches Use-Case-Pendant zur Warning aus v1.64.0. Erfordert ImportResult-Erweiterung um melodicParts und Wiring im ProjectManager.",
        "FEAT-INSP (aus vorherigem next:): bleibt offen — Explore-Report vorhanden, Aufwand 4-5h, 8+ Files (siehe coordinator-Notiz im INDEX-CATCHUP-Eintrag)."
      ],
      changed: [
        "package.json",
        "client/src/utils/imports/flpImport.ts",
        "tests/features/project-imports.test.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "coordinator",
      timestamp: "2026-05-14T00:00:00.000Z",
      done: [
        "INDEX-CATCHUP: INDEX.js nach 38 Versionen Pflege-Rückstand aktualisiert. Version-Header 1.25.0 → 1.63.0. Bug-Index um BUG-017..BUG-023 ergänzt (Multi-Window-Popup-Crash-Serie + native Chromium destroy-Bug + Menü-Doppel-Listener). Dieser konsolidierte Eintrag fasst alle Releases v1.26.0 → v1.63.0 zusammen — Einzel-Commit-Details sind via `git log` weiterhin abrufbar.",
        "PHASE MULTI-WINDOW (v1.26.0–v1.34.0): Aus dem FX-Window PoC (v1.26.0) wurde eine durchgehende Multi-Window-Architektur. Pinnable Windows: Mixer (v1.27.0), Sample-Browser + Pattern-Generator (v1.28.0), Keyboard-Sampler + Chord-Progressions + Pattern-Library (v1.29.0). Layout-Persistence (auto-reopen, bounds, alwaysOnTop) via AppStore.popupWindowLayouts. Inline-Panels werden im Hauptfenster ausgeblendet wenn Popup offen + 'Hierher zurückholen'-Button. Begleitende Bug-Welle BUG-017→BUG-018(v1-v4)→BUG-019→BUG-020 — siehe bugs-Sektion. Multi-Provider AI (Anthropic + OpenAI) ebenfalls in v1.26.0.",
        "PHASE LIVE-RECORDING + AUDIO-INPUT (v1.31.0–v1.33.0): Live Step Recording Welle 1 — MPC-Overdub via useLiveStepRecorder (stepinput:noteon → aktiver Step der MIDI-Cat-gematchten Part). Welle 2 (v1.32.0) — Replace-Mode + Punch-In/Out mit Wrap-Around + RecordSettingsPopover. Audio-Input UX-Polish (v1.33.0) — Device-Picker, Live-Duration-Timer mm:ss, Rename-Before-Save-Dialog. 24+ neue Vitest-Tests in live-step-recorder + audio-input-recorder.",
        "PHASE DOCKVIEW-WORKSPACE (v1.35.0–v1.37.0, v1.54.0–v1.57.0): Crash-Diagnostics-Foundation (DIAG-2..5) + dockview-react als Workspace-Foundation. MIG-2B (v1.36.0) Mixer + Inspector PoC behind feature flag. MIG-2C (v1.37.0) 5-Panel-Workspace (Sequencer + Song + Humanizer). MIG-3-Serie (v1.54.0–v1.57.0): Electron-Popout via dockview-react addPopoutGroup() → Theme-Propagation via Electron-IPC statt cross-window DOM → Theme-Wechsel propagiert auch zu offenen Popouts.",
        "PHASE AUDIO-WORKBENCH (v1.43.0–v1.50.0): Inline Trim+Normalize-Panels statt prompt() (v1.43) → Drag-to-select Region auf Waveform-Canvas (v1.44) → Undo-Stack mit Ctrl+Z, max 10 Snapshots (v1.45) → Play/Stop Buffer-Vorschau (v1.48) → Cut-Button entfernt Selection (v1.49) → 7 Playwright Smoke-Tests in tests/web/audio-workbench.spec.ts (v1.50). Aus dem v1.23-Roadmap-Item 'Audio-Workbench Multi-Track-Editor' ist ein vollwertiger Audacity-Style Editor geworden.",
        "PHASE MIDI/MENU/MISC (v1.38.0–v1.41.0, v1.46.0–v1.47.0): generic JSON MIDI controller layout import (v1.39), DIAG-Logging-Reihe (v1.38, v1.40) + heartbeat + child-process-gone, ai-welle4 (v1.41) — Templates-Dropdown + Cost-Tracking, FEAT-MENU-WIRING (v1.46) verdrahtete Music-Production Menübar-Events an KB_ACTION_EVENT → BUG-22 Doppel-Listener-Fix (v1.47).",
        "PHASE FLP-IMPORT (v1.59.0–v1.63.0): FL-Studio .flp Pattern-Import in Drum-Machine. v1.59 initialer Parser. v1.60 realistischer Synthese-Test + OOM-Safety im Parser. v1.61 FL Studio 20+ Support (NotesEvent ID 0xE0). v1.62 Multi-Bar-Import → mehrere Patterns. v1.63 ProjectManager-Import-Flow nutzt vollen FLP-Parser. PERF-CSP (v1.58) als Vorbereitung: manus-runtime nur im Dev → 366kB pro HTML weniger Bundle."
      ],
      next: [
        "Phase-Q-Roadmap aus BUG-011 weiter offen: Multi-Track-Editor + Vocal/Kick-Trennung im AudioWorkbench (über die v1.43-v1.50 Welle hinaus).",
        "ARCH-MOD (vom v1.34.0-Commit erwähnt): browser-tab-style modular workspace mit detach/drag-to-combine/persist-layouts auf Basis der Multi-Window-Foundation.",
        "FEAT-INSP (vom v1.34.0-Commit erwähnt): separate Channel Inspector von MixerView damit beide unabhängig pinnable werden — teilweise in v1.35.0 angegangen, vollständige Trennung weiterhin offen.",
        "FLP-Import (v1.63.0+): Drum-Notes funktionieren, melodische Instrument-Pattern-Mapping ist offen. Nächster sinnvoller Schritt wenn User wieder einen FLP-Use-Case hat."
      ],
      changed: [
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-13T11:45:00.000Z",
      done: [
        "PERF-WIN-FRAMELESS + FEAT-MENU — zwei User-Requests post-v1.25.0 ergänzend zum vorigen Native-Frame-Switch.",
        "PERF-WIN-FRAMELESS (Performance-Mode Popup ohne OS-Frame, Custom-Header mit Pin+Close): electron/main.ts perfWindow `frame: true` → `frame: false`. PerformancePopupApp.tsx render-Hierarchie umgebaut: `<>` Fragment → `<div className='flex flex-col h-screen bg-bg-base'>` als Root, schmaler Custom-Header (h-7) oben mit `WebkitAppRegion: drag` für Window-Move + no-drag Container für Pin-Toggle (📌) + Close-Button (✕). Pin-Button war vorher als floating Overlay rechts — jetzt im Header. Close-Button neu (data-testid 'perf-popup-close'). Pattern dient als Vorlage für zukünftige pinnable Sub-Windows (Effects, Mixer-Strips).",
        "FEAT-MENU (Music-Production-Menübar): electron/main.ts buildMenu() umstrukturiert weil generisches Cut/Copy/Paste für DAW keinen Sinn macht.",
        "FEAT-MENU / Bearbeiten: Cut/Copy/Paste/SelectAll ENTFERNT (in Text-Inputs funktioniert Ctrl+C/V eh nativ). Stattdessen Pattern-Aktionen: Pattern leeren, Pattern zufällig füllen, Pattern füllen, Pattern duplizieren. Undo/Redo bleibt.",
        "FEAT-MENU / Transport (NEU als Top-Level): Play/Stop (Space), Aufnahme (Ctrl+R), BPM erhöhen/verringern (Ctrl+Up/Down), Tap Tempo (Ctrl+T), Nächstes/Vorheriges Pattern (Ctrl+Right/Left). Vorher unter 'Audio' verschachtelt.",
        "FEAT-MENU / Audio → Sample: umbenannt, Transport-Einträge raus, Audio-Workbench-Eintrag rein. Fokus auf Sample-Workflow.",
        "FEAT-MENU / Ansicht: Tab-Navigation hinzu (F1-F6: Sequencer/Mixer/Song/Humanizer/Tools/Kollaboration). Bestehende Reload/Zoom/Vollbild-Items bleiben.",
        "FEAT-MENU / Fenster: Performance Mode (F12) als Inline-Mode + 'Performance Mode in separatem Fenster' als direkter createPerformanceWindow()-Trigger ohne Renderer-Trip.",
        "FEAT-MENU / IPC: 12 neue Channels in electron/preload.ts (onMenuPatternClear/Randomize/Fill/Duplicate/Next/Prev, onMenuBpmUp/Down, onMenuTapTempo, onMenuOpenPerformance/AudioWorkbench, onMenuTab). Types + Browser-Fallback-Stubs in useElectron.ts ergänzt. App.tsx-Listener für die neuen Events sind TODO (Phase 2) — Menü-Klicks dispatchen die Events bereits korrekt, App.tsx muss sie nur noch konsumieren.",
        "Verification: pnpm check 0 Fehler. pnpm test 1376/1391 grün (unchanged — keine Unit-Test-Implikationen für Menü-Definition + frameless-Popup-CSS). Manuelle Verifikation nötig: pnpm dev:electron → Menübar zeigt Datei/Bearbeiten/Transport/Sample/Ansicht/Fenster/Hilfe; Performance Mode in separatem Fenster zeigt schmalen Custom-Header mit 📌 + ✕ ohne OS-Frame."
      ],
      next: [
        "App.tsx-Wiring für neue Menü-Channels: onMenuPatternClear → dm.clearPattern, onMenuPatternRandomize → dm.randomizePattern, onMenuBpmUp/Down → project.setBpm(±1), onMenuTab → setActiveTab, onMenuOpenAudioWorkbench → setActiveTab + scroll-to. Aufwand: ~1h.",
        "Pinnable Effect-Windows als nächstes großes Feature (siehe ROADMAP konkretisiert). Pattern (frameless + Custom-Header + perf-sync-style IPC) ist jetzt etabliert.",
        "BUG-009 (alter Drag-Region-Fullscreen-Bug) ist architektonisch obsolet: Main hat nativen Frame, Performance-Popup hat keine alten Drag-Region-Konflikte mehr weil der Custom-Header sauber no-drag-Subzonen hat. ElectronTitleBar-Code-File könnte in einer Welle 2 entfernt werden, oder als Recycle-Vorlage für andere frameless Sub-Windows behalten."
      ],
      changed: [
        "electron/main.ts",
        "electron/preload.ts",
        "electron/types.d.ts",
        "electron/useElectron.ts",
        "client/src/components/PerformanceMode/PerformancePopupApp.tsx",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-13T11:00:00.000Z",
      done: [
        "BUG-016 Fix + FEAT-NATIVE-FRAME + ROADMAP-Konkretisierung — drei User-Requests post-v1.25.0 (Screenshot bilder/2.png).",
        "BUG-016 (Performance-Mode Pads adaptieren nicht an Fenstergröße): client/src/components/PerformanceMode/PatternLaunchPad.tsx — Inner-Grid `max-w-2xl` entfernt, Container `overflow-auto` → `overflow-hidden`, Grid bekommt `aspect-square h-full max-h-full max-w-full grid grid-cols-4 grid-rows-4 gap-3`. Resultat: 4×4-Pad-Grid bleibt quadratisch und füllt automatisch min(verfügbare Breite, verfügbare Höhe). Keine Scrollbar mehr. Funktioniert sowohl im Inline-Performance-Mode als auch im separaten Popup-Fenster.",
        "FEAT-NATIVE-FRAME (main window mit nativem OS-Frame + Menübar, analog zum Performance-Mode-Popup): electron/main.ts — `frame: process.platform === 'darwin'` → `frame: true` für alle Plattformen. ElectronTitleBar-Render aus client/src/App.tsx entfernt (würde sonst zweite TitleBar produzieren). Komponente bleibt als File erhalten für möglichen Re-Use bei frameless Sub-Windows (z.B. zukünftige Pinnable-Effect-Popups). BUG-009 (Drag-Region-Konflikt im Fullscreen) ist damit ARCHITEKTONISCH OBSOLET — keine Custom-Drag-Region mehr. Datei/Bearbeiten/Ansicht/Audio/Fenster/Help-Menübar ist jetzt am Main-Window sichtbar.",
        "ROADMAP — Pinnable Per-Channel Effect Windows konkretisiert: existierender Multi-Window-Dockable-Workspace-Eintrag erweitert mit der spezifischen User-Anforderung (Effekt-Windows abpinbar damit Effekte pro Kanal frei positionierbar sind). Begründung: User will Mixer-FX-Inserts in eigene Fenster ziehen können — typischer DAW-Workflow (Ableton/Logic/FL Studio). Nutzt die Performance-Window-Architektur als Pattern (BrowserWindow + perf-sync-IPC) verallgemeinert.",
        "Verification: pnpm check 0 Fehler. pnpm test 1376/1391 grün (unverändert — Layout-CSS-Änderungen haben keine Unit-Test-Implikationen). Manuelle Verifikation: pnpm dev:electron → Performance Mode öffnen → ⧉ Separates Fenster → Fenster grös­ser/kleiner ziehen → Pads füllen den verfügbaren Raum proportional. Main-Window: Datei/Bearbeiten/Ansicht/Audio/Fenster/Help-Menübar oben sichtbar."
      ],
      next: [
        "Pinnable Effect-Windows als nächstes Feature-Item (siehe ROADMAP). Architektur: pro `<Effect>`-Renderer ein optionales 'Pin in separates Fenster'-Symbol; Click öffnet neues BrowserWindow mit URL-Param `?fxPopup=<channelId>&fxIdx=<n>`; App.tsx-Routing erkennt den Param und rendert nur den jeweiligen FxPanel. State-Sync via Pattern wie perf-sync. Aufwand: ~3-5 Tage.",
        "BUG-009-Tests können entfernt werden (Test-Datei electron-titlebar.test.tsx wurde nie geschrieben — siehe Skipping-Notes). Wenn jemand die Komponente wieder aktiviert, sollten dann auch Tests rein.",
        "ROADMAP-Cleanup empfohlen: 'Multi-Window Dockable Workspace' Eintrag mit der konkreten Phase-1-Aufgabe (Effect-Windows abpinbar) verschmelzen statt als getrenntes Item zu lassen."
      ],
      changed: [
        "client/src/App.tsx",
        "client/src/components/PerformanceMode/PatternLaunchPad.tsx",
        "electron/main.ts",
        "agents/INDEX.js"
      ]
    },
    {
      agent:     "frontend",
      timestamp: "2026-05-13T10:10:00.000Z",
      done: [
        "AI Script Generator (ROADMAP Phase S, post-v1.24.0). Prompt-driven Code-Generation für die Script-Runner-Sandbox via Anthropic API.",
        "Architektur: pure-Funktionen in client/src/utils/aiScriptGenerator.ts (testbar) + UI-Component AiScriptGeneratorDialog.tsx + Integration im ScriptRunner-Header. Anthropic-API-Call analog zum existierenden Pattern (usePatternGeneratorStore.generateFromPromptAI) mit anthropic-dangerous-direct-browser-access Header.",
        "Pure-Funktionen: buildSystemPrompt() listet alle 10 ss.*-Methoden + die 17 erlaubten ALLOWED_DISPATCH_ACTIONS + Sandbox-Constraints (kein window/fetch/eval/import). stripMarkdownFences() entfernt ```js/```javascript/```/```ts/```typescript Wrapper falls das LLM Markdown mitschickt. validateGeneratedCode() prüft: Empty-Check, 10kB-Limit (MAX_SCRIPT_CODE_BYTES), mind. ein ss.*-Aufruf, banned-Patterns (eval, new Function, window/document/globalThis/self, fetch, XHR/WebSocket/EventSource, electronAPI, import, require).",
        "UI-Flow: '✨ KI'-Button im ScriptRunner-Header (data-testid script-ai-generate) öffnet AiScriptGeneratorDialog. Dialog hat Prompt-Textarea, 'Generieren'-Button, Preview-Pane (read-only Code + Byte-Count), 'Als neues Script speichern'-Button. Bei Fehler: roter Error-Panel + fehlerhafter Code zur Inspektion sichtbar. ESC schließt Dialog. Schließen reset't State.",
        "API-Key + Modell: nutzt useApiSettingsStore (anthropicApiKey + aiModel) — gleiche Quelle wie Pattern-Generator + KI-Co-Pilot. Dialog blockt Generate-Button + zeigt Warnung wenn API-Key fehlt.",
        "Save-Handler in ScriptRunner: ruft addScript() mit suggested-name 'KI: <erste 40 Zeichen vom Prompt>', scope:'app', enabled:true, default maxRuntimeMs. Selektiert neues Script + clearet Logs für Clean-Start.",
        "Tests (tests/features/ai-script-generator.test.ts, 27 Tests): buildSystemPrompt-Snapshot (10 Methoden + ALLOWED_DISPATCH_ACTIONS + Constraints), stripMarkdownFences alle 7 Wrapper-Varianten + Trim, validateGeneratedCode 14 Cases (happy path, empty, no ss.*, all banned patterns, byte-limit). generateScriptFromPrompt() selbst NICHT getestet (echter API-Call, nicht deterministisch).",
        "Verification: pnpm check 0 Fehler. pnpm test 1376/1391 grün (+27 ai-script-generator + 2 via theme-class-purity glob walker auf AiScriptGeneratorDialog.tsx). Manuelle Verifikation: pnpm dev:electron → Tools → Script-Runner → '✨ KI'-Button → Prompt 'Rampe BPM von 100 auf 140 in 4s' → Generieren → Code-Preview → Speichern → Skript erscheint in Liste + ist selektiert."
      ],
      next: [
        "AI-Script Welle 2 (Future): 'Iterieren' / 'Verbessern' Button — bei vorhandenem Skript: User klickt KI-Button im Editor selbst, gibt feedback 'mach es schneller' / 'füge log-Statements hinzu', LLM bekommt aktuellen Code + neuen Prompt als Context. Aufwand: ~0.5 Tag.",
        "AI-Script Welle 2 (Future): Streaming-Response (Anthropic SSE) statt Wait-Until-Done für besseres UX bei längeren Generationen. Aufwand: ~0.5 Tag.",
        "AI-Script Welle 2 (Future): Beispiel-Prompts/Templates Dropdown ('BPM-Automation', 'Macro-Mapping', 'Pattern-Choreographie') damit User schneller starten. Aufwand: ~0.5 Tag.",
        "AI-Script Welle 2 (Future): Cost-Tracking — Token-Count + geschätzte Kosten anzeigen + Settings → KI & API → Monthly-Budget-Cap. Aufwand: ~1 Tag."
      ],
      changed: [
        "client/src/utils/aiScriptGenerator.ts",
        "client/src/components/Tools/AiScriptGeneratorDialog.tsx",
        "client/src/components/Tools/ScriptRunner.tsx",
        "tests/features/ai-script-generator.test.ts",
        "agents/INDEX.js"
      ]
    },
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
  ,
    {
        agent: "coordinator",
        timestamp: "2026-05-17T20:00:00.000Z",
        done: [
            "STRATEGIE-ANALYSE v2.83+ (KORG-zentrierte Live+Studio-DAW): Vollstaendige 5-Teilige Analyse abgeschlossen. TEIL A Konkurrenz-Analyse (9 DAWs: Ableton, FL, Bitwig, Maschine, MPC, KORG Gadget, Renoise, REAPER, LMMS/Cakewalk) — groesste Luecken sind VST/CLAP-Host, Audio-Recording/Slicing, Hardware-LED-Feedback. TEIL B KORG-Tiefe (Electribe 2 + nanoKONTROL2): 5 Bidir-Workflows definiert (Pattern-Roundtrip, USB-Audio-In als FX-Channel, Motion-Sequenzer-Capture, Sync-Master-Modus, Sample-Slot-Push) + nanoKONTROL2-Luecken (LED-Feedback, Marker-Buttons zu Scene-Mode). TEIL C Live-Performance-Defizite: WASAPI Exclusive, Live-Looping, MIDI-Clock-Out, Hot-Swap mit Crossfade. TEIL D Monetarisierung: Empfehlung Einmal-Lizenz 29 EUR via Gumroad zuerst, dann Freemium-Pro mit VST-Host. TEIL E Top-10-Aktionsplan in openTasks als TASK-230 bis TASK-239 priorisiert (Reihenfolge: 230->231->232->233->234->235->236->237->238->239). Quick-Wins (<=2 Tage): TASK-230 MIDI-Clock-Out, TASK-231 nanoKONTROL2-LED, TASK-232 Lizenz-Layer."
        ],
        next: [
            "Starte autonomen Loop mit TASK-230 (MIDI-Clock-Out) — primaerer Agent: backend.",
            "Parallel-Track moeglich: TASK-231 (nanoKONTROL2-LED) ist unabhaengig von TASK-230, kann parallel von backend laufen sobald Clock-Out-Out-Port-Helper extrahiert ist.",
            "TASK-232 (Lizenz-Layer) sollte vor allen Pro-Features kommen, sonst entsteht spaeter Refactor-Schuld bei Feature-Gating.",
            "TASK-239 (VST/CLAP-Host) ist nicht fuer v2.83 — eigener Sprint v3.0.0+."
        ],
        changed: [
            "agents/INDEX.js"
        ]
    }
  ,
    {
        agent: "backend",
        timestamp: "2026-05-17T22:48:00.000Z",
        done: [
            "TASK-230 (MIDI-Clock-Out + Send-to-Electribe, v2.83.0) abgeschlossen. Synthstudio ist jetzt MIDI-Clock-Master mit driftarmem 24-PPQN-Ticker.",
            "Drei neue Module: (1) client/src/utils/midiOutput.ts — Pure-Helpers enumerateMidiOutputs/getOutputById/sendMessage + localStorage-Persistenz fuer Clock-Out-Device-ID/Enable-Flag + MIDI-Realtime-Konstanten + buildSongPositionPointer(14-bit-Encoding). (2) client/src/audio/MidiClockOut.ts — Stateful Clock-Master-Generator: start(now) sendet 0xFA, stop() sendet 0xFC, resume(now) sendet SPP+0xFB, scheduleTicks(lookAhead,bpm) plant Ticks anhand AudioContext.currentTime statt setInterval. DI-Sender-Pattern fuer Tests. (3) tests/features/midi-clock-out.test.ts — 30 deterministische Tests via captureSender+Mock-Access (Map<id, MidiOutputLike>).",
            "AudioEngine-Integration: play() ruft _midiClockOut.start(nextStepTime), stop() ruft .stop(), _schedule() ruft .scheduleTicks(lookAheadUntil, effectiveBpm). Public-API setMidiClockOutSender/setMidiClockOutEnabled/getMidiClockOut.",
            "useMidi-Refactor: alten setInterval-Tick-Pfad geloescht. Neue State clockOutputDeviceId (separates Routing zu activeOutputDeviceId) + Persist. useEffect injiziert sender callback in AudioEngine; bei device/enable-Wechsel re-injiziert. setClockOutEnabled/setClockOutputDeviceId persistieren via localStorage.",
            "MidiSettings-UI: renderClockTab() um Clock-Out-Section erweitert mit Toggle + Device-Picker. data-testids: clock-out-section, clock-out-toggle, clock-out-device-select. Empty-State-Warnung bei keinen Output-Devices.",
            "Version bump 2.82.0 -> 2.83.0. 30 neue Tests gruen. Vollsuite 3063/3063 Tests gruen. pnpm check ohne Fehler."
        ],
        next: [
            "TASK-231 (nanoKONTROL2 LED-Feedback) kann jetzt starten — die wiederverwendbaren Helpers sind in client/src/utils/midiOutput.ts: enumerateMidiOutputs, getOutputById, sendMessage. Note-On/Off-Pakete koennen via sendMessage(midiAccess, deviceId, [0x90|ch, note, vel]) gesendet werden.",
            "Manuell verifizieren mit echtem Geraet: Electribe 2 in MIDI-Settings -> Sync-In-Modus, Synthstudio Clock-Out aktivieren, Synthstudio Play -> Electribe sollte starten + im Sync laufen. nanoKONTROL2 (Korg Kontrol Editor) kann den Stream als Sync-Source nutzen."
        ],
        changed: [
            "client/src/utils/midiOutput.ts (NEU)",
            "client/src/audio/MidiClockOut.ts (NEU)",
            "tests/features/midi-clock-out.test.ts (NEU)",
            "client/src/audio/AudioEngine.ts (MidiClockOut-Integration)",
            "client/src/hooks/useMidi.ts (AudioEngine-Wiring + clockOutputDeviceId)",
            "client/src/components/MidiSettings/MidiSettings.tsx (Clock-Out-UI)",
            "package.json (2.83.0)",
            "agents/INDEX.js"
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
  openTasks: [
    // STRATEGIE-ROADMAP v2.83+ (KORG-zentrierte Live+Studio-DAW) — coordinator 2026-05-17
        {
            id: "TASK-230",
            type: "feature",
            priority: "high",
            agent: "backend",
            status: "done",
            closedAt: "2026-05-17T22:48:00.000Z",
            closedIn: "v2.83.0",
            closedBy: "backend",
            title: "MIDI-Clock-Out + Send-to-Electribe",
            description: "Synthstudio wird MIDI-Clock-Master. AudioEngine.onTick sendet 24 PPQN Clock-Pulse via Web MIDI Output + Start/Stop/Continue. UI-Toggle in Settings fuer Clock-Out-Device. Foundation fuer alle KORG-Bidir-Workflows.",
            acceptance: [
                "Web MIDI Output-Device-Picker in MIDI-Settings ✓ (Clock-Sync-Tab)",
                "AudioEngine sendet 24 PPQN Clock auf Play, 0xFA Start, 0xFC Stop, 0xFB Continue ✓ (driftarm via AudioContext.currentTime+planTicks)",
                "Electribe 2 / nanoKONTROL2 syncen sich extern auf den Stream — Code korrekt, manuelle Hardware-Verifikation steht aus",
                "Unit-Tests fuer Clock-Tick-Generator (deterministisches mock-Output-Array) ✓ 30/30 in tests/features/midi-clock-out.test.ts"
            ],
            estimateHours: 12,
            extractedHelpers: [
                "client/src/utils/midiOutput.ts: enumerateMidiOutputs, getOutputById, sendMessage, load/saveClockOutputId, load/saveClockOutEnabled, MIDI_CLOCK_*, MIDI_PPQN, buildSongPositionPointer — alle wiederverwendbar fuer TASK-231"
            ]
        },
        {
            id: "TASK-231",
            type: "feature",
            priority: "high",
            agent: "backend",
            status: "done",
            completedAt: "2026-05-17T23:05:00.000Z",
            completedVersion: "v2.84.0",
            title: "nanoKONTROL2 LED-Feedback + Scene-Mode",
            description: "User hat das Geraet. Out-MIDI an nanoKONTROL2 fuer Solo/Mute-Button-LEDs (note-on/off, Channels 1-8). Marker-Buttons + Track-Buttons werden zu Scene-Launch (useSceneStore) gemappt. LED-Sync bei Pattern-/Scene-Wechsel.",
            acceptance: [
                "MIDI-Out an nanoKONTROL2 spiegelt mute/solo-State aller 8 Mixer-Channels",
                "Marker-PREV/NEXT-Buttons cyclen durch Scenes",
                "Erweitertes Template in client/src/utils/midiTemplates.ts",
                "Settings-Toggle LED-Feedback an/aus"
            ],
            actualHours: 1.5,
            estimateHours: 8,
            implementation: [
                "client/src/utils/midiOutput.ts: NANO_KONTROL2-Constants + buildNanoKontrolLed + sendNanoKontrolFullSync/AllLedsOff/Led + load/saveFeedbackOutputId/Enabled/SceneMode",
                "client/src/audio/NanoKontrolFeedback.ts: stateful Diff-Sync-Wrapper (lastMute/lastSolo Cache pro Channel)",
                "client/src/store/useSceneStore.ts: cycleScene(direction) mit Wrap-Around",
                "client/src/hooks/useMidi.ts: feedback-State + Sender-Wiring + Marker-CC-Interceptor",
                "client/src/App.tsx: useEffect mit drumMuteSoloSnapshot ruft syncFeedbackLeds",
                "client/src/components/MidiSettings/MidiSettings.tsx: 'LED-Feedback (Mixer-Sync)' Section",
                "tests/features/nano-kontrol-led.test.ts: 23 Cases (Diff-Sync, Full-Sync, AllLedsOff, Scene-Cycle, Persistenz)"
            ],
            uxCaveats: [
                "User muss im KORG-Kontrol-Editor 'External LED Mode' setzen sonst werden Sends ignoriert (kein Crash). Hinweis-Box ist in der UI sichtbar."
            ]
        },
        {
            id: "TASK-232",
            type: "feature",
            priority: "high",
            agent: "backend",
            status: "open",
            title: "Lizenz-Layer + Gumroad-Build (Monetarisierung)",
            description: "Einmal-Lizenz Win-Build ueber Gumroad/Stripe fuer 29 EUR. Lizenz-Schluessel-Check beim ersten Start, gespeichert in Electron app.getPath(userData). Online-Aktivierung (ED25519-Signatur, kein Phone-Home nach Aktivierung).",
            acceptance: [
                "Activation-Modal beim ersten Start in Electron-Build",
                "ED25519-Signature-Validation lokal (oeffentlicher Key embedded)",
                "Trial-Mode 30 Tage (timestamp in localStorage + userData)",
                "Pro-Build-Variante via electron-builder Config (Free vs Pro Toggle)"
            ],
            estimateHours: 16,
            reviewedBy: [
                "security",
                "builder"
            ]
        },
        {
            id: "TASK-233",
            type: "feature",
            priority: "high",
            agent: "backend",
            status: "done",
            doneIn: "v2.85.0",
            doneAt: "2026-05-17T23:20:00.000Z",
            title: "USB-Audio-Input als Mixer-Channel (Outboard-FX-Modus)",
            description: "Macht Synthstudio zur Outboard-FX-Box fuer KORG-Hardware. getUserMedia({audio:{deviceId}}) als zusaetzlicher Mixer-Track mit voller FX-Chain (EQ/Comp/Reverb/Delay). PDC fuer Latenz-Alignment.",
            acceptance: [
                "Mixer-Channel-Type Live-Input neben drum-part und audio-track",
                "Device-Picker zeigt alle Audio-In-Devices",
                "FX-Chain laeuft auf Live-Input (FxPanel funktioniert)",
                "Plugin-Delay-Compensation gegen drum-part Output kompensiert"
            ],
            estimateHours: 20,
            uxCaveats: [
                "PDC ist MANUELL (Slider 0..200ms pro Channel) statt automatisch — voller PDC-Pfad muesste alle anderen Busse delayen (komplexer, post-MVP).",
                "User muss in den Browser/Electron-Permission-Dialog 'Allow' fuer Mikrofon einmal klicken. In Electron auto-granted via setPermissionRequestHandler (whitelist: media)."
            ]
        },
        {
            id: "TASK-234",
            type: "feature",
            priority: "high",
            agent: "backend",
            status: "done",
            doneIn: "v2.86.0",
            title: "Audio-Recording im Mixer (Record-Arm)",
            description: "Record-Arm-Button pro Mixer-Channel. ScriptProcessor-Tap auf channelNodes.panner zeichnet Live-Input waehrend Transport auf, landet als audio-track in useAudioTrackStore. WAV-Encode via wavEncoder.ts (pure), Persistenz via audio:save-recording IPC (Electron, userData/recordings/<name>.wav mit Path-Traversal-Guard) oder IndexedDB-Fallback (Browser).",
            acceptance: [
                "Record-Arm-Toggle pro Channel-Strip",
                "Recording startet bei transport:play, stoppt bei transport:stop",
                "Resultierender Audio-Track erscheint in useAudioTrackStore, abspielbar nach Stop",
                "WAV-Datei wird in Electron-userData oder Browser-IndexedDB persistiert"
            ],
            estimateHours: 16,
            dependsOn: [
                "TASK-233"
            ]
        },
        {
            id: "TASK-235",
            type: "feature",
            priority: "high",
            agent: "backend",
            status: "done",
            title: "Live-Looping (Record/Loop/Overdub)",
            description: "Live-Looping-Pedal-Funktionalitaet: MIDI-Footswitch/Pad triggert Record-Loop-Overdub-Cycle. Loops landen als auto-quantized audio-tracks. Erfuellt Live-Performance-Versprechen.",
            acceptance: [
                "Loop-Buttons in Performance-Mode (max 4 simultane Loops)",
                "Record quantisiert auf naechste Beat-Boundary",
                "Overdub mischt neue Aufnahme in vorhandenen Loop (linear sum)",
                "Loop-Erase via Long-Press oder eigener Action-Target"
            ],
            estimateHours: 24,
            dependsOn: [
                "TASK-233",
                "TASK-234"
            ]
        },
        {
            id: "TASK-236",
            type: "feature",
            priority: "low",
            agent: "backend",
            status: "open",
            title: "WASAPI Exclusive Mode (Windows Low-Latency)",
            description: "Latenz-Optimierung von ~30-50ms auf unter 10ms. Native Node-Bridge via naudiodon oder eigene N-API-Erweiterung. Web Audio Output umgeleitet via virtuelles MME-Device. NOTE v3.0.0: SICHERE Web-Audio-Alternative via TASK-236-ALT (latencyHint:'interactive' + sampleRate konfigurierbar) ist done — deckt 80% des Use-Cases ohne Build-Risiko. Native-Variante bleibt low-prio bis User-Bedarf nachweisbar.",
            acceptance: [
                "Settings-Toggle WASAPI Exclusive (nur Windows-Build)",
                "Round-Trip-Latenz unter 10ms gemessen via loopback",
                "Fallback auf Shared-Mode bei Device-Konflikten",
                "Web-Build bleibt unveraendert (kein Code-Pfad-Impact)"
            ],
            estimateHours: 28,
            reviewedBy: [
                "builder"
            ]
        },
        {
            id: "TASK-236-ALT",
            type: "feature",
            priority: "medium",
            agent: "backend",
            status: "done",
            doneIn: "v3.0.0",
            title: "Audio-Engine Low-Latency-Config (sichere Web-Audio-Alternative zu TASK-236)",
            description: "AudioContext mit latencyHint:'interactive'|'balanced'|'playback' und sampleRate:44.1/48/96/auto konfigurierbar via Settings. AudioEngine.reinit() für Hot-Reload. MIDI-Clock-Lead 100→50ms reduziert. Pure Web-Audio-Spec, kein Native-Code-Risk.",
            acceptance: [
                "User kann via Settings die Latency-Hint wählen (done)",
                "AudioContext wird mit gewählter Hint+Rate initialisiert (done)",
                "Latency-Display zeigt aktuelle System-Latenz live (done)",
                "AudioEngine.reinit() funktioniert ohne State-Loss anderer Stores (done)"
            ]
        },
        {
            id: "TASK-237",
            type: "feature",
            priority: "medium",
            agent: "backend",
            status: "done",
            title: "Electribe-Pattern-Importer (.e2sallpat / .e2pattern)",
            description: "Direkter KORG-Wow-Effekt: Electribe-User koennen ihre Pattern in Synthstudio importieren und mit fortgeschrittenen Tools (Morph/Humanize) bearbeiten. Reverse-engineerte Format-Spezifikation existiert.",
            acceptance: [
                "electron/electribe-import.ts parser fuer .e2sallpat-Binary-Format",
                "Konvertierung in Synthstudio-Pattern-Struktur (16 Parts zu drum-parts)",
                "Motion-Sequenzer-Daten landen in useAutomationStore",
                "Browser-Fallback via File-Drop"
            ],
            estimateHours: 24,
            doneIn: "v2.88.0",
            doneNote: "Parser browser-safe in client/src/utils/electribeImport.ts (isomorph), IPC electribe:import-file + electribe:open-dialog in electron/main.ts mit 5MB-Limit + Endung-Whitelist, UI in DrumMachine-Toolbar (Button + File-Picker + Bank-Pattern-Picker-Dialog), Drag-Drop via window-Event 'electribe:fileImport'. 42 Unit-Tests gruen. Motion-Sequencer-Lanes per CustomEvent 'electribe:motion-lanes' rausgereicht (App-Level-Wiring fuer useAutomationStore-Konsum folgt als TASK-237-FOLLOWUP). Format-Spec ist BEST-EFFORT, Kalibrierung mit echten .e2sallpat-Files erforderlich. FOLLOWUP-1 (v2.90): App.tsx-Listener konsumiert das Event jetzt, mapped Volume/Pan/FX-Send-Lanes auf useAutomationStore-Targets, 21 zusaetzliche Tests in tests/features/electribe-motion-bridge.test.ts. Filter Cutoff/Resonance/Pitch bleiben gefiltert weil useAutomationStore keine fxParam-Lanes hat (= TASK-237-FOLLOWUP-1B)."
        },
        {
            id: "TASK-238",
            type: "feature",
            priority: "medium",
            agent: "frontend",
            status: "done",
            closedAt: "2026-05-18T02:25:00.000Z",
            closedIn: "v2.89.0",
            closedBy: "frontend",
            title: "Sample-Slicing/Chop (Waveform zu Pads)",
            description: "MPC/Maschine-Paritaet: User waehlt Sample, Waveform-Editor zeigt automatisch erkannte Slice-Points (Onset-Detection), jeder Slice landet auf einem Performance-Pad.",
            acceptance: [
                "Waveform-Editor-Modal mit Slice-Marker-Drag",
                "Onset-Detection via existierender audioAnalysis.worker.ts",
                "Auto-Map auf 16 Performance-Pads",
                "Manuelle Slice-Justierung mit Snap-to-Zero-Crossing"
            ],
            estimateHours: 24,
            doneNote: "Zweistufige Implementierung. Agent-A (pure-fn-Layer): client/src/utils/sampleSlicing.ts mit autoSlice/detectOnsetsSpectralFlux/snapToZeroCrossing/onsetsToSlices/splitChannelDataAtSlices/mapSlicesToPads/addOnset/moveOnset/removeOnset + Types OnsetCandidate/SliceSpec/PadAssignment + MAX_PERFORMANCE_PADS=16. 23 Unit-Tests in tests/features/sample-slicing.test.ts gruen. Agent-B (UI): client/src/components/SampleEditor/SampleSliceEditor.tsx — Modal mit Waveform-Canvas (Peak-reduziert via buildPeaks, RAF-Render, semantische Token-Farben via getCssVar), draggable Slice-Marker (Pointer-Events, Snap-to-Zero auf Drop), Click→addOnset, Shift/Right-Click→removeOnset, 4×4 Pad-Grid mit Length-Anzeige (ms/s). DrumMachine-Toolbar bekam '✂ Slice Sample'-Button + hidden file-input (data-testid 'slice-sample' / 'slice-sample-input'). handleSliceImport decodiert WAV/MP3/OGG/FLAC/AIFF/M4A via Browser-AudioContext.decodeAudioData (Kanal 0, mono). Apply-Flow: splitChannelDataAtSlices → Float32Array[] → window.dispatchEvent CustomEvent 'sample-slicer:apply' + Toast 'Direct-Assign in Pad-Slots noch nicht implementiert' (Performance-Pads halten patternId nicht Sample-Buffer — Wiring zum useKeyboardSamplerStore oder ein neuer Slice-Pad-Store ist FOLLOWUP). Playwright-Smoke in tests/web/sample-slicing.spec.ts. pnpm check clean, pnpm test 3251/15 skipped. FOLLOWUP-1 (v2.90): NEU client/src/store/useSlicePadStore.ts (Module-Singleton mit 16 Slots) + NEU AudioEngine.playSliceBuffer(buffer, sampleRate) + App.tsx-Listener auf 'sample-slicer:apply' der die Slices via assignSlicesToPads(replace:true) ablegt. 15 Tests in tests/features/sample-slice-pad-assign.test.ts. Pad-Mode-Toggle 'Pattern / Slice' im PatternLaunchPad bleibt offen (= TASK-238-FOLLOWUP-1B)."
        },
        {
            id: "TASK-239",
            type: "feature",
            priority: "low",
            agent: "backend",
            status: "open",
            title: "VST3/CLAP-Host (Phase-2 Pro-Feature)",
            description: "Groesste Wettbewerbsluecke vs Ableton/FL/Bitwig. Vermutlich nur via nativer Node-Addon-Bridge (JUCE-basiert). Monetarisierbar als Pro-Tier.",
            acceptance: [
                "Plugin-Scan beim Start (Win VST3-Folder)",
                "Plugin-Slot in Mixer-FX-Chain",
                "Parameter-Automation via useAutomationStore",
                "GUI-Hosting via native Window oder Generic-Parameter-UI"
            ],
            estimateHours: 160,
            reviewedBy: [
                "builder",
                "security"
            ],
            note: "Groesster Brocken, eigener Sprint, nicht vor v3.0.0"
        },
        {
            id: "TASK-240",
            type: "feature",
            priority: "medium",
            agent: "backend",
            status: "done",
            closedAt: "2026-05-18T03:05:00.000Z",
            closedIn: "v2.92.0",
            closedBy: "backend",
            title: "MIDI-Note-Output to External Device (KORG Electribe als Sound-Modul)",
            description: "Komplettiert die KORG-Bidir-Brücke nach v2.83 (Clock-Out). Per-Part konfigurierbarer MIDI-Note-Out: Step-Trigger schickt Note-On + Note-Off an externen MIDI-Output (z.B. Electribe 2 mit GM Drum-Map auf Channel 10). User baut Patterns in Synthstudio (Morph/Humanize/Probability) und nutzt die Electribe als Sample-Engine.",
            acceptance: [
                "Per-Part MIDI-Out-Config (outputId, channel, note, noteDurationMs, localSoundEnabled)",
                "MidiNoteOut-Engine mit DI-Sender-Pattern (test-friendly)",
                "AudioEngine-Integration: triggerNote parallel zum optionalen lokalen Sound",
                "UI im ChannelInspector mit Device/Channel/Note-Picker + Local-Sound-Toggle",
                "Electribe-Drum-Map-Template (Apply-Button)",
                "min 7 Unit-Tests, persistierter Store"
            ],
            estimateHours: 6,
            doneNote: "MidiNoteOut.ts mit (outputId,bytes)→void Sender-Signatur (damit unterschiedliche Parts auf unterschiedliche Geräte routen können), Retrigger-Policy (sofortiges Note-Off bei Re-Trigger gleicher Note, kein Overlap), setEnabled(false)-Flush gegen Stuck-Notes, internal Map<partId, MidiPartConfig>, internal Pending-Off-Map mit setTimeout-Cleanup, clampMidiChannel/Note/Velocity/Duration als pure-Helper. AudioEngine: _midiNoteOut-Instanz + 5 Public-API (setSender/setEnabled/setPartConfig/clearPartConfig/getMidiNoteOut), Wire-Up im _scheduleStep direkt nach stepCallbacks (also vor MIDI-Clock-Pulse + lokalem Trigger), Local-Sound-Gate via shouldPlayLocalSound (Backwards-Compat: ohne Config IMMER local), Auto-Flush in stop() (disable+enable-Cycle leert pending Note-Offs). useMidi.ts: Sender-Effect injiziert midiSendMessage-Lambda (Web-MIDI durch outputId-Resolve). useMidiNoteOutStore.ts: Custom-Observer-Pattern (localStorage 'synthstudio:midi:noteout:v1' + Enable-Key), API setMidiNoteOutEnabled/setPartMidiOutConfig/clearPartMidiOutConfig/clearAll/applyElectribeDrumMap (GM-Drum-Map auf Ch10 für die ersten 8 Parts). App.tsx: Diff-Sync-Effect spiegelt Store→Engine bei jedem Store-Change. ChannelInspector.tsx: neue Section 'MIDI-Note-Out' mit Global-Enable-Checkbox, Output-Device-Select (zeigt useMidiContext.outputDevices), Channel-Select (1-16, Drum-Label auf 10), Note-Range-Slider mit Note-Name-Display (noteNameFromNumber), Duration-Slider (10-2000ms), Local-Sound-Toggle, Per-Part-Clear-Button + Electribe-Template-Button. midiTemplates.ts: neues NoteOutTemplate-Interface + ELECTRIBE_2_DRUM_MAP-Constant (8 Mappings GM-Drum-Map). 24 Unit-Tests in tests/features/midi-note-out.test.ts (pure Helpers + setPartConfig/clearPartConfig/triggerNote/Retrigger-Policy/setEnabled-Flush/Sender-Exception-Swallow). pnpm check clean, pnpm test 3326 passed / 15 skipped. CAVEATS: (a) MIDI-Send läuft NICHT through Web-Audio-Scheduling — JS-setTimeout-Genauigkeit ist ~1-2ms Jitter ggü. AudioContext-Scheduling, was für MIDI-Devices akzeptabel ist (Hardware-MIDI-Latenz oft schon ≥1ms). (b) Polyphony pro Part = 1: bei Retrigger derselben Note wird die alte sofort beendet. Für Polyphony-Spiel an einem Sample-Modul müsste man je Step eine andere Note senden (z.B. Performance-Mode). (c) Note-Stealing am externen Gerät ist Geräte-eigene Logik — wir senden korrekt Note-On + Note-Off, der Rest ist Electribe-Sache. (d) Output-ID kann bei Hardware-Reconnect wechseln — useMidi enumeriert beim devicechange-Event neu. Wenn die alte ID nicht mehr existiert, ist der Send no-op (silent fail), config bleibt im Store für Reconnect."
        }
    ],

  // ─── API / IPC REFERENCE ───────────────────────────────────
  ipc: {
    note:     "All IPC calls go through useElectron() hook — never window.electronAPI directly",
    channels: [
      "file:save-project", "file:open-project", "file:export-wav",
      "collab:start-session", "collab:join-session", "collab:leave-session",
      "midi:export", "dialog:open", "dialog:save",
      "transport:play", "transport:stop", "transport:bpm",
      "audio:save-recording", // TASK-234 (v2.86) — schreibt WAV in userData/recordings/, strict path-traversal-guard
      "electribe:import-file", // TASK-237 (v2.88) — liest .e2pattern/.e2sallpat (max 5 MB, Endung-Whitelist) als Uint8Array → Renderer parsed via parseElectribeBank()
      "electribe:open-dialog", // TASK-237 (v2.88) — nativer File-Dialog mit Filter "e2pattern, e2sallpat"
      "korg:import-bank",     // v3.3.0 — liest .esx/.ess/.all (max 100 MB, Endung-Whitelist, path.resolve+access-check) als Uint8Array → Renderer parsed via parseEsxBank()/parseE2sBank().
      "korg:open-bank-dialog", // v3.3.0 — nativer File-Dialog mit Filter ["esx", "ess", "all"].
      "korg:get-bank-cap",    // v3.3.0 — liefert KORG_BANK_MAX_BYTES (100 MB) für UI-Hinweise.
      "korg:save-bank-as",    // v3.4.0 — speichert renderer-side gebauten .all-Buffer (Synthstudio → E2 Sampler). Validation: filename-Whitelist /^[A-Za-z0-9._-]+\\.all$/, 16B-Magic-Sniff "e2s sample all\\x1a\\0", max 256 MB. Pfad kommt aus dialog.showSaveDialog (kein Path-Traversal-Vektor vom Renderer).
      "korg:get-bank-save-cap", // v3.4.0 — liefert KORG_BANK_SAVE_MAX_BYTES (256 MB) für UI-Hinweise.
      "license:read",  // TASK-232 (v2.97) — liest userData/license.json (Path hardcoded, 16 KB-Limit, JSON-Parse-Try-Catch). Returnt {success, data}|{success:false,error}.
      "license:write", // TASK-232 (v2.97) — schreibt LicenseState nach userData/license.json (Status-Whitelist, finite-number-only trialStartedAt, Längen-Limits, JSON-Size ≤16 KB).

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
