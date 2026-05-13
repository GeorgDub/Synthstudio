# Synthstudio — Roadmap

**Stand:** v1.23.0 (2026-05-13) — siehe `agents/INDEX.js` (`workLog`) für volle Release-Historie.

Synthstudio ist eine professionelle Drum Machine, Synthesizer und DAW als isomorphe App (React 19 + Electron 40 + Vite 7 + Tailwind v4 + pnpm). Diese Roadmap listet **nur die noch offenen Themen** — der Großteil der ursprünglich geplanten Phasen A-N ist in v1.12 bis v1.23 ausgeliefert.

---

## ✅ Was bereits drin ist

Siehe `docs/NEUE_SESSION_ANWEISUNG.md` für die vollständige Feature-Matrix. Kurzfassung:

- **Sequencer:** 16/32-Step Grid, Velocity/Pitch/Probability/Condition/Reverse pro Step, Step Inspector, Param Lock, Note Length, Quantize-Grid, Live Pattern Edit, Follow Actions, Pattern Stacking, Polyrhythm, Pattern Morph
- **Synthese:** Wavetable + FM mit ADSR, Granular (Density/Grain-Size/Spread), Custom Wavetable Editor, LFO (6 Wellenformen + BPM-Sync + S&H + Glide), Macro-LFO-Routing (v1.23.0), Insert-FX-Chain für Synth-Parts (v1.23.0)
- **Mixer:** Insert FX Chain (12 Typen), 16-Band EQ, Sidechain, Bus Compressor, Spectrum Analyzer, Transient Shaper
- **Performance:** 16-Pad Performance Mode mit Multi-Select + Box-Drag + Cmd+A + Auto-Scroll (v1.23.0), 8 Macro-Knöpfe mit Edge+Hold-Trigger, Scene Launch, Note Repeat, Global Transpose
- **Arrangement:** Song Timeline, Automation Lanes, BPM-Automation, Scene-Pattern-Mapping
- **Audio-Tracks:** Vocals/Songs als Kanäle (v1.16), pitch-preserving Time-Stretch (v1.19), Round-Trip Save/Reopen/Relocate (v1.23.0)
- **MIDI:** In (CC + Note-Map + Chord Memory + MPE), Out, Clock (Master/Slave), GM-Drum-Map Import, MIDI-Bundle Export
- **Kollaboration:** LAN-Session mit mDNS-Discovery, Chat, Roles, Session Recording, Cross-Sample-Transfer, Splitscreen
- **KI:** AI Beat Co-Pilot (Anthropic API), Pattern Generator (Template + Prompt)
- **Plugins:** ESM Plugin API, Persistent Scripts mit Web-Worker-Sandbox (v1.17.0), Macro-Bindings für Scripts + Pads
- **Distribution:** GitHub-Actions Multi-Platform Build (Win NSIS / Mac DMG Intel+ARM / Linux AppImage+DEB), Auto-Updater via `electron-updater`, Code-Signing-Hooks vorbereitet
- **A11y + Theming:** 10+ Themes inkl. 2 Colorblind, OLED-Schwarz, Daylight/Paper, ARIA-Labels, Touch-optimiert, PWA-Offline
- **Test-Coverage:** 1345 Vitest-Unit-Tests + ~30 Playwright-E2E-Tests, glob-basierte Theme-Class-Purity-Check für alle *.tsx Components

---

## 🔴 Kritische Bugs (sofort)

| ID | Titel | Severity | Beschreibung |
|---|---|---|---|
| **BUG-009** | ✅ Performance Mode: Mode-Buttons im Fullscreen nicht klickbar | high (UX) | Fixed post-v1.23.0 — ElectronTitleBar hides in fullscreen + Performance-Mode no-drag. |
| **BUG-010** | Script-Runner: CSP-Error 'unsafe-eval' — Scripts laufen gar nicht | **critical** | Tools → Script-Runner → Run schlägt mit `Evaluating a string as JavaScript violates...script-src 'self'` fehl. v1.18.0 CSP-Hardening blockiert die Web-Worker-Sandbox. Fix-Optionen: dedicated worker-src CSP, iframe-sandbox, oder Architektur-Wechsel auf vorgenerierten Code. Details in `agents/INDEX.js` → `bugs.BUG-010`. |
| **BUG-011** | Audio-Workbench: Tonspur wird nicht visualisiert | high (UX) | Geladene Tonspur wird nicht als Waveform gerendert. User-Wünsche: Vocal/Kick/Snare-Trennung + Bereich-Selektion zum Ausschneiden (Audacity-Style — siehe Phase Q). |
| **BUG-012** | Sample-Browser: Waveform + BPM-Detection greifen nicht | high (UX) | Sample wird analysiert (Status sichtbar) aber Waveform-UI bleibt leer. BPM-Detection liefert kein Ergebnis. Möglicherweise zwei Bugs (Renderer + Worker). |
| **BUG-013** | "Neues Projekt" resettet bestehenden Content nicht | high (data) | Klick auf "Neues Projekt" lässt Patterns/Steps/Parts aus vorheriger Session bestehen. Ursache vermutlich: useProjectStore.newProject() ruft nicht alle Sub-Store-Resets auf (DrumMachine, Song, Mixer, Automation, Macros, Performance, Scripts, Audio-Tracks). |
| **BUG-014** | Pattern-Generator BPM-Input springt auf 40 beim Clearen | medium (UX) | Vorlage-Tab BPM-Input. Komplettes Löschen springt sofort auf 40, verhindert flüssiges Tippen (Zwischenwerte 1, 12 etc. werden geclamped). Fix: separater String-State für controlled Input, Clamp erst beim Blur. |

---

## 🟠 Architektur-Features (User-Wünsche, mittlerer Aufwand)

| Feature | Beschreibung | Status / Aufwand |
|---|---|---|
| **Performance Mode in eigenem Fenster — Phase 1** | Separates Electron `BrowserWindow` lädt Renderer-Entry mit `?perfPopup=1` → App.tsx erkennt + rendert `PerformancePopupApp`. Bidirektionaler State-Sync via 6 IPC-Channels (window:open/close/is-open, perf-sync:state, perf-sync:action, perf-window:closed). Pad-Click im Popup triggert Pattern-Switch im Haupt-Fenster (live). Live-State-Sync für Pattern + Playhead. Inline-Performance-Mode bekommt "⧉ Separates Fenster" Button im Header. Electron-only (Web-Fallback = Phase 2). | ✅ erledigt (post-v1.23.0) |
| **Performance Mode in eigenem Fenster — Phase 2** | (a) ✅ Edit-Mode + Reorder-Mode-Operationen ins Main syncen — PatternLaunchPad mit injectable PerformanceStoreActions, 6 neue Action-Types. (c) ✅ Always-on-top Toggle (📌-Button im Popup). Phase 3 noch offen: (b) Web-Fallback via `window.open()` + BroadcastChannel, (d) Sync-Performance-Optimierung (separater currentStep-Channel), (e) Playwright E2E mit zwei Electron-Windows. | ✅ erledigt (post-Phase-1) |
| **Multi-Window Dockable Workspace** | Generalisierung: ALLE Menüs und Tabs (Sequencer, Mixer, Sample Browser, Pattern Generator, Audio Workbench, Settings, Tools, etc.) können in separate Electron-`BrowserWindow`s entkoppelt werden, sodass der User sich die App auf mehreren Monitoren beliebig verteilen kann. Voraussetzungen: (a) generische Window-Registry mit shared State-Sync-Pattern (analog zum Performance-Popup, aber als wiederverwendbares System); (b) ein "Detach"-Button pro Tab/Panel; (c) Window-Layout-Persistenz (welcher Tab war wo, beim Restart wiederherstellen); (d) Web-Fallback via `window.open` (mit Hinweis dass weniger praktikabel); (e) Keyboard-Shortcuts zum Detach/Reattach. Inspiration: Ableton Live Multi-Window, Logic Pro Detached Editors, FL Studio Multi-Mixer. Sehr hoher User-Mehrwert für Multi-Monitor-Producer. | 2–3 Wochen |

---

## 🟧 Distribution + Business (Phase P — Wochen)

Für Beta-Test und kommerzielle Distribution erforderlich.

| Feature | Beschreibung | Aufwand |
|---|---|---|
| **Login + Beta-Account-System** | Auth-Backend (Supabase / Firebase / eigene API) + Login-Dialog. Beta-Codes mit Ablaufdatum für gesteuerten Tester-Zugang. | 2–3 Wochen |
| **Lizenz-Stufen** | Account-Rolle steuert sichtbare Features (Admin = volle App für Dev, Free = Kern, Lite = Subset). Feature-Gating via React Context. | 1–2 Wochen |
| **Code-Signing (Win/Mac)** | EV-Code-Signing-Zertifikat für Windows (SmartScreen) + Apple Developer Account für macOS Notarization. Build-Workflow erweitern. | 1 Woche + Zertifikat-Kosten |

---

## 🟨 User-Workflow & Audio-Editing (Phase Q-Rest — Wochen)

| Feature | Beschreibung | Aufwand |
|---|---|---|
| **Audacity-Level Audio-Workbench** | Bestehende Workbench erweitern: Cut/Copy/Paste-Selection, Trim, Fade In/Out, Normalize, Reverse, Pitch-Shift, Time-Stretch-Vorschau, Multi-Track-Editor. Aktuell nur Basis-Slicing in Granular-Panel. | 2–4 Wochen |
| **Live Step Recording** | MIDI-Noten während Playback als Steps aufnehmen (MPC-Overdub-Stil). Aktuell nur Click-to-Set + MIDI-Step-Input. | 1–2 Wochen |
| **Audio-Eingang Recording** | Mikrofon/Line-in direkt in neue Samples aufnehmen. Vorhanden via Web-Audio-getUserMedia, UI fehlt. | 1 Woche |
| **Ableton Link** | Netzwerk-BPM-Sync mit anderen DAWs/Apps. OSC-Pfad existiert, Link-Protokoll nativ (Electron-only via WebUSB/native-Modul). | 2–3 Wochen |

---

## 🟢 Import-Konverter (Phase R — Wochen)

**Geteilte Anforderung für alle Importer:** beim Import-Start muss ein Dialog gefragt werden — "Bestehendes Projekt erweitern" (Content wird zum aktuellen Projekt hinzugefügt) oder "Neues leeres Projekt erstellen + Import" (alle Stores reset + dann importieren). Default: "Neues leeres Projekt" um Versehentliches-Mischen zu vermeiden. Hängt teilweise von BUG-013-Fix ab (Reset-Logik muss erst sauber funktionieren).

| Feature | Beschreibung | Aufwand |
|---|---|---|
| **FL Studio Projekt-Import** | `.flp`-Parser via `flp.js` Lib → Patterns + Channel-Settings extrahieren. Format dokumentiert. Mit "Empty oder Merge"-Dialog (siehe oben). | 1–2 Wochen Reverse-Engineering |
| **Ableton Live Set Import** | `.als` ist gezipptes XML — Tracks + Clips + Devices parsen, soweit möglich. Mit "Empty oder Merge"-Dialog. | 1–2 Wochen |
| **Korg Electribe Import** | `.esx` / `.elst` (Electribe 2 / 2s / ESX-1) Pattern-Bank-Format → Drum-Steps + BPM + Swing. Mit "Empty oder Merge"-Dialog. | 1–2 Wochen |

---

## 🔵 Plugin-Ökosystem + Wiki (Phase S — Wochen + Backend)

| Feature | Beschreibung | Aufwand |
|---|---|---|
| **AI Script Generator** | Im Script-Runner: Prompt-Feld "Generiere ein Script das..." → Anthropic-API liefert vollständigen `ss.*`-API-konformen Code. Validierung gegen ScriptStore-Limits (10kB), Preview vor Speichern. Voraussetzung: API-Key in Settings vorhanden. Hängt nicht von BUG-010-Fix ab — auch ohne ausführbare Sandbox sinnvoll als Code-Generation-Hilfe. | 3–5 Tage |
| **Plugin-Syntax im Handbuch** | Eigenes Kapitel: ScriptRunner-API, Plugin-Module-Schema (`pluginApi.ts`), Beispiele für eigene Effekte/Generatoren. | 3–5 Tage |
| **Plugin/Script Cloud-Store** | Backend (Postgres + S3) + Frontend-Marketplace: Hochladen, Bewerten, Installieren. Hängt von Auth (Phase P) ab. | 4–6 Wochen |
| **In-App LLM-Assistent** | Chat-Sidebar mit Anthropic/OpenAI-API — Fragen zur App **und** zu Musikproduktion. Token-Cap pro Account. | 1–2 Wochen + API-Kosten |
| **Wiki mit Musik-Tutorials** | Eingebettetes Wiki (Markdown) für Hardtekk, Hardcore, Techno, House-Produktion. | 1 Woche + Content-Schreiben |

---

## 🟣 Cloud-Sync (Phase T — Wochen, hängt von Phase P)

| Feature | Beschreibung | Aufwand |
|---|---|---|
| **Cloud-Account für Projekte** | Optional — nicht zwingend für lokale Nutzung. Sync von `.synth`-Files via S3 + Postgres-Metadaten. | 3–4 Wochen |
| **Cloud-Sample-Library** | Eigene Samples in der Cloud, plattformübergreifender Zugriff. | 2–3 Wochen |

---

## ⚪ Mobile (Phase U — Wochen, Plattform-spezifisch)

| Feature | Beschreibung | Aufwand |
|---|---|---|
| **Android via Capacitor** | React-PWA + Capacitor-Wrapper → APK-Build via GitHub Actions. AudioWorklet-Kompatibilität prüfen. | 2–4 Wochen |
| **iOS via Capacitor** | Apple-Dev-Account erforderlich. Web-Audio-API auf iOS hat Einschränkungen (Latenz, AudioContext-Resume nur via Touch). | 4–8 Wochen + Dev-Account |
| **Touch-Optimierter Mobile-Mode** | Vergrößerte Hit-Targets, Swipe-Gesten für Tabs, vereinfachte Step-Grids für kleine Displays. | 1–2 Wochen |

---

## ⚫ Pro-Features (Phase G/N — Wochen, Electron-only)

| Feature | Beschreibung | Aufwand |
|---|---|---|
| **VST/AU Plugin Host** | Einbindung von Third-Party-Plugins. Native-Modul (z.B. `juce-vst-host` Wrapper) erforderlich. | 4–8 Wochen |
| **CLAP Plugin Support** | Nächste-Generation Open-Source Plugin-Format. Native-Modul ähnlich VST. | 4–6 Wochen |
| **DAW-Integration (ReWire / Link)** | Synthstudio als Slave in FL Studio / Ableton. Ableton Link separat oben. | 2–4 Wochen |
| **CV/Gate Output** | Modularsynthese-Integration via WebUSB (Electron). | 2–3 Wochen |

---

## 🔧 Welle-3-Polish aus aktuellen Tasks (klein, je 0.5–2 Tage)

Aus den `next:[]` Einträgen der letzten workLogs in `agents/INDEX.js` — alles non-blocking:

- **TASK-129 Welle 3** — Drum-Synth `sourceType`-Switch in ChannelStrip/Pad-Settings sichtbar machen. Per-Note Polyphonie-Volumen-Konsistenz (eigener Gain vor `nodes.input` statt shared `input.gain.value`).
- **TASK-127 Welle 3** — Playwright E2E für Cmd+A + Auto-Scroll (aktuell nur Helper-Unit-Tests). Scrollable-Container-Fallback für Performance-Mode-Overlays mit `overflow:hidden`.
- **TASK-126 Welle 2** — Pad-Hold-Mode E2E (analog zu Script-Hold mit 100ms-Interval). Echte Sandbox-Tick-Verifikation mit `ss.bpm()` als observable side-effect.
- **TASK-122 Welle 2** — `--ss-accent-tertiary` + `--ss-accent-warning` Tokens für Categorical Palettes (SongTimeline D-Bank, ElectronDropZone project/zip kollidieren aktuell auf accent-secondary). Playwright Screenshot-Compare für visuelle Theme-Regressionen.
- **FOLLOWUP-102-3 next** — React-Testing-Library Tests für `useDrumMachineStore.setPartSoloed` exclusive/additive Verhalten.
- **FOLLOWUP-102-4 next** — Deterministischer Relocate-E2E via `openProject(.synth-Upload)`-Pfad statt `page.reload`.

---

## Priorisierung (Empfehlung)

1. **BUG-009** zuerst — UX-Show-Stopper für alle Fullscreen-User
2. **Welle-3-Polish** zwischendurch — kleine Verbesserungen, gut für CI-Validierung neuer Patterns
3. **Phase P (Distribution-Business)** — Voraussetzung für Beta-Phase und Cloud-Features
4. **Phase Q-Rest (Audacity-Workbench)** — größter wahrnehmbarer User-Mehrwert für bestehende Nutzer
5. **Phase R (Import-Konverter)** — gut für Akquise (User aus FL/Ableton mitnehmen)
6. **Phase T (Cloud-Sync)** — nur nach Phase P
7. **Phase S (Plugin-Marketplace + LLM-Assistent)** — Ecosystem-Bauteil, hängt von Phase P
8. **Phase U (Mobile)** — Plattform-Expansion, deutlich höhere Aufwände
9. **Phase G/N (VST/CLAP-Host)** — komplex, Electron-only, später

Diese Reihenfolge ist ein Vorschlag — die endgültige Reihenfolge richtet sich nach Business-Zielen und User-Feedback.
