# Korg ESX-1 - Alle 6 Erweiterungen

## 1. Keyboard-Mapping System
- [x] Keyboard-Mapping State und Persistence (localStorage)
- [x] Settings Modal mit Keyboard-Mapping Editor
- [x] Default Shortcuts definieren (Space=Play/Pause, R=Record, etc.)
- [x] Shortcut-Listener in Home.tsx integrieren
- [x] Visual Feedback für aktive Shortcuts
- [x] Konflikte mit Piano-Keyboard vermeiden

## 2. MIDI-Controller-Support
- [x] Web MIDI API Integration
- [x] MIDI-Device-Auswahl im Settings Modal
- [x] MIDI-Learn Funktion (Parameter anklicken → MIDI-Controller bewegen)
- [x] MIDI-Mapping speichern/laden
- [x] MIDI-Input für Transport, Steps, Knobs
- [ ] MIDI-Clock-Sync (optional)

## 3. Song-Modus / Pattern-Chaining
- [x] Song-Datenstruktur (Array von Pattern-IDs)
- [x] Song-Editor UI-Komponente
- [x] Song-Playback-Engine
- [x] Song speichern/laden (localStorage + DB)
- [x] Song-Position-Anzeige
- [x] Loop-Modus für Songs

## 4. Motion Sequencing / Parameter-Automation
- [x] Motion-Daten-Struktur (Parameter + Werte pro Step)
- [x] Motion-Recording aktivieren/deaktivieren
- [x] Parameter-Bewegungen aufnehmen
- [x] Motion-Playback in Sequencer integrieren
- [x] Motion-Daten visualisieren
- [x] Motion-Daten löschen/editieren

## 5. Multi-Track Audio-Export
- [x] Einzelne Drum-Parts als separate Tracks aufnehmen
- [x] Stems als separate Dateien exportieren
- [x] Export-Format (WebM/Opus)
- [x] Export-Progress-Anzeige
- [x] Master + Stems Export-Modi

## 6. Undo/Redo System
- [x] History-Stack für Pattern-Edits
- [x] History-Stack für Parameter-Änderungen
- [x] Undo/Redo Shortcuts (Ctrl+Z / Ctrl+Y)
- [x] History-Limit (50 Steps)
- [x] Undo/Redo Buttons in UI
- [x] State-Snapshot-Funktion

## Bugfixes (Critical)
- [x] Fix Maximum update depth in Motion Playback useEffect
- [x] Fix duplicate keys in Settings Modal (redo, toggle_play)
- [x] Fix setState in dragOver event (DrumSampleUploader)

## Bugfixes Round 2 (Critical - Maximum Update Depth)
- [x] useAudioEngine: Wrap alle Funktionen mit useCallback (bereits vorhanden)
- [x] useUndoRedo: saveState debounce (max 1x pro 500ms)
- [x] SettingsModal: Duplicate keys bei Shortcuts fixen (eindeutige key prop)

## Phase 2: Killer-Features (Markt-Differenzierung)

### 7. AI Pattern Generator
- [x] tRPC-Prozedur für LLM-basierte Pattern-Generierung
- [x] Prompt-basierte Beat-Erzeugung ("Techno im Stil von Jeff Mills")
- [x] Genre-Erkennung und Style-Parameter
- [x] AI Pattern Generator UI-Modal
- [x] Pattern-Vorschau vor Übernahme
- [x] Variation-Generator (basierend auf bestehendem Pattern)

### 8. Cloud Pattern Save/Load
- [x] DB-Schema für Patterns (patterns Tabelle)
- [x] tRPC-Prozeduren: savePattern, loadPattern, listPatterns, deletePattern
- [x] Pattern-Browser UI mit Suche/Filter
- [x] Pattern-Metadaten (Name, Genre, Tags, BPM)
- [x] Pattern veröffentlichen (public/private)

### 9. Pattern Community & Sharing
- [x] DB-Schema für Community (patternLikes, patternComments)
- [x] Community-Browser mit Genre-Filter
- [x] Like/Favorite System
- [x] Kommentare
- [x] Pattern forken (Remix)
- [x] Sortierung (Newest, Popular, Trending)

### 10. Genre Templates & Music Theory Helper
- [x] 10+ Genre-Templates (Techno, House, DnB, Hip-Hop, Trap, etc.)
- [x] Skalen-Referenz (12+ Skalen mit Keyboard-Visualisierung)
- [x] Akkord-Referenz (10 Akkordtypen)
- [x] Genre-spezifische BPM/Effekt-Empfehlungen

### 11. Mix Analytics & Visual Feedback
- [x] Echtzeit-Spektrum-Analyzer
- [x] Waveform-Visualisierung
- [x] Pattern-Dichte-Analyse (Heatmap)
- [x] Groove-Analyse (Swing, Synkopation)

### 12. Smart Humanizer & AI Chord Suggestions
- [x] Humanizer-Algorithmus (Pattern-Variation)
- [x] Fill-Generator
- [x] Buildup-Generator
- [x] Pattern-Reverse
- [x] Pattern-Shift
- [x] AI Chord Progression Vorschläge

## 13. Tempo-Synchronisation (MIDI Clock Sync)
- [x] useMIDIClock Hook (Send & Receive MIDI Clock)
- [x] MIDI Clock Receive: Tempo von externer DAW empfangen (Slave)
- [x] MIDI Clock Send: Tempo an externe DAW senden (Master)
- [x] MIDI Start/Stop/Continue Messages
- [x] Transport-Sync (Play/Stop synchron mit DAW)
- [x] Sync-Status-Anzeige im Transport-Bereich (BPM + EXT Indicator)
- [x] MIDIClockPanel UI mit Device-Auswahl
- [x] Latenz-Kompensation (±50ms Slider)
- [x] Jitter-Filtering für stabiles Tempo (12-Sample Buffer)
- [x] PPQN-Visualisierung (24 Pulses per Quarter Note)
- [x] BPM-Buttons deaktiviert im Receive-Modus

## Bugfix: Maximum Update Depth (Round 3)
- [x] Fix infinite loop in Home.tsx (recordMotionIfActive + getPatternMotions aus useEffect deps entfernt)
- [x] useEffect Dependencies optimiert (nur primitive Werte)

## 14. Velocity-Sensitive Steps
- [x] Velocity-Datenstruktur (0-127 pro Step, 3 Stufen: Soft/Medium/Hard)
- [x] Velocity-Array State in Home.tsx (9 Parts x 16 Steps)
- [x] UI: Velocity-Anzeige in Step-Buttons (Opacity + S/M/H Labels)
- [x] UI: Velocity-Editor (Click-Cycle: Off → Soft → Medium → Hard → Off)
- [x] Audio Engine: Velocity in triggerDrum() anwenden (0-127 → 0.0-1.0)
- [x] Pattern Save/Load: Velocity persistieren (localStorage)
- [x] Undo/Redo: Velocity-Änderungen in History
- [x] Tests für Velocity-Feature (5 Tests, alle bestanden)

## 15. Per-Part Velocity-Offset
- [x] Velocity-Offset State (9 Parts, -50 bis +50)
- [x] UI-Controls: Range-Slider pro Drum-Part in Drum Machine Grid
- [x] Velocity-Offset in Audio Engine anwenden (Clamp 0-127)
- [x] Pattern Save/Load mit Velocity-Offset
- [x] Undo/Redo mit Velocity-Offset
- [x] Tests für Velocity-Offset (10 Tests, alle bestanden)

## 16. Pattern Copy/Paste zwischen Banks
- [x] Copy/Paste State (copiedPattern mit sourceName)
- [x] copyPattern() Funktion (Pattern in Zwischenablage kopieren)
- [x] pastePattern() Funktion (Pattern aus Zwischenablage einfügen)
- [x] UI: COPY/PASTE Buttons mit Icons
- [x] Visuelles Feedback (Tooltip, disabled state, sourceName-Anzeige)
- [x] Keyboard-Shortcuts (Ctrl+C / Ctrl+V)
- [x] Bank-übergreifendes Kopieren (A-D)
- [x] Vollständige Pattern-Daten (drumPattern, velocityPattern, velocityOffset, accentPattern, BPM, Effects, Filter, etc.)
- [x] Tests für Copy/Paste Feature (10 Tests, alle bestanden)

## 17. Mobile-Responsive Layout
- [x] Responsive Design für Tablets (768px - 1024px)
- [x] Responsive Design für Smartphones (< 768px)
- [x] Touch-optimierte Button-Größen (min 44x44px)
- [x] Vertikales Layout für Mobile (Stack-Modus)
- [x] Horizontales Scrolling für Sequencer auf Mobile
- [x] Collapsible Sections für Drum Machine Grid
- [x] Mobile-optimierte Knobs (größer, Touch-freundlich)
- [x] Hamburger-Menü für Settings/Modes (MobileDrawer Komponente)
- [x] Responsive Typography (Font-Größen anpassen)
- [x] Touch-Gesten (Swipe für Bank-Navigation mit useSwipeGestures Hook)
- [x] Mobile-UI Integration in Home.tsx (Hamburger-Button, Drawer-Content, Swipe-Handler)
- [x] Mobile-Tests durchführen (16 Tests, alle bestanden - Gesten, Breakpoints, UI-States)


## 18. Portrait-Modus Optimierung (Chrome Browser)
- [x] Horizontales Scrolling für ESX-Body aktivieren
- [x] Zone 1 (Master/Valve/Modulation) in Tabs/Collapsible aufteilen
- [x] Zone 2 (Display/Effect/Filter) vertikal stapeln
- [x] Zone 3 (Transport/Arpeggiator/Drum Parts) komprimieren
- [x] Sequencer horizontal scrollbar optimieren
- [x] Drum Machine Grid Höhe reduzieren
- [x] Keyboard-Sektion optional ausblendbar machen
- [x] Viewport Meta-Tags für Mobile prüfen und optimieren
- [x] Touch-Scrolling Performance testen
- [x] Portrait-spezifische CSS Media Queries (< 480px)
- [x] Landscape-Modus Optimierung (< 768px)
- [x] Knobs und Buttons in Portrait kleiner
- [x] Viewport Meta-Tag mit viewport-fit=cover und user-scalable=yes


## 19. Auto-Scaling Responsive Layout (alle Telefongrößen)
- [x] CSS Container Queries für dynamisches Scaling
- [x] Viewport-basierte Schriftgrößen (clamp() für responsive Typography)
- [x] Collapsible Sections für alle Zonen (CollapsibleZone Komponente)
- [x] Tab-Navigation für Mobile (MobileTabs Komponente)
- [x] Auto-Scaling für Knobs basierend auf verfügbarem Platz (useResponsiveKnobSize Hook)
- [x] Responsive Grid mit minmax() für flexible Layouts (responsive-grid CSS Klassen)
- [x] Sticky Header mit Pattern/BPM/Step Info (StickyHeader Komponente)
- [x] Bottom Navigation Bar für Mobile (BottomNav Komponente mit Play/Stop/Rec/Settings)
- [x] Fullscreen-Modus für einzelne Sections (fullscreen-section CSS)
- [x] useResponsive Hook (deviceType, orientation, scaleFactor)
- [x] useMediaQuery Hook für Breakpoint-Queries
- [x] Responsive Breakpoints getestet (320px, 375px, 414px, 768px, 1024px, 1920px)
- [x] 51 Tests bestanden (Auto-Scaling + Mobile Responsive)


## 20. BUG FIX: Horizontales Scrollen auf Mobile eliminiert
- [x] Alle overflow-x Quellen identifiziert (ESX-Body, Grids, Sequencer, Buttons)
- [x] ESX-Body max-width auf 100vw begrenzt, overflow-x: hidden
- [x] Alle Grid-Layouts auf Mobile in vertikale Stacks umgewandelt (Zone 1-3)
- [x] 16-Step Sequencer in 2x8 Grid auf Mobile umgewandelt
- [x] Drum Machine Grid auf Mobile komprimiert (kein horizontaler Overflow)
- [x] Effect-Buttons Grid auf Mobile angepasst (2 Spalten statt 4)
- [x] Keyboard-Sektion als CollapsibleZone mit 1 Oktave auf Mobile
- [x] Synth Controls als CollapsibleZone auf Mobile
- [x] Custom Drum Samples als CollapsibleZone auf Mobile
- [x] Alle festen Pixel-Breiten durch relative Einheiten ersetzt
- [x] html/body overflow-x: hidden als Fallback
- [x] KeyboardSection als separate Komponente extrahiert
- [x] Playwright-Tests auf 5 Geräten: iPhone SE (320px), Galaxy S21 (360px), iPhone 12 (390px), Pixel 7 (412px), iPhone 14 Pro Max (430px)
- [x] ALLE GERÄTE BESTEHEN - Kein horizontaler Overflow


## 22. BUG: Import-Funktion funktioniert nicht
- [ ] Import-Fehler analysieren und debuggen
- [ ] Pattern-Import-Dialog testen
- [ ] Fehlerbehandlung verbessern

## 59. BUG: Prev/Next Navigation Crash
- [x] Audio-Daten aus IndexedDB laden bevor onSampleLoaded aufgerufen wird
- [x] getSampleWithAudioAsync() Funktion erstellen (sampleLibraryStore.ts)
- [x] DrumSampleUploader.tsx handlePrev/handleNext aktualisieren (async, try/catch)

## 60. BUG: AI Pattern Generation funktioniert nicht
- [x] Router von 'musicTheory' zu 'ai' umbenannt
- [x] Frontend-Code (trpc.ai.generatePattern) funktioniert jetzt
- [x] generateVariation und suggestChords auch verfügbar
- [x] Tests bestätigen alle Funktionen

## 62. IMPROVEMENT: Mobile Menu Touch Experience
- [x] onTouchEnd Handler zur CollapsibleZone hinzugefügt
- [x] WebKit Touch-Callout disabled
- [x] Touch-Action manipulation für bessere Performance
- [x] Alle 133 Tests bestanden

## 23. FEATURE: Bulk Sample Import (wie FL Studio)
- [ ] Zip-Datei Import implementieren
- [ ] Ordner-Struktur Parsing (Drums/Kicks/Samples/etc.)
- [ ] Mehrere Dateien gleichzeitig hochladen
- [ ] Sample-Kategorisierung und Verwaltung
- [ ] Drag & Drop für Ordner/Zip-Dateien
- [ ] Import-Progress-Anzeige
- [ ] Sample-Browser mit Kategorien


## 24. Electron Desktop-Anwendung
- [x] Electron Dependencies installieren (electron, electron-builder)
- [x] Main Process (electron/main.ts) erstellen
- [x] Preload Script für sichere IPC-Kommunikation
- [x] Window-Management (BrowserWindow, Menu, Tray)
- [x] Build-Scripts für Windows/Mac/Linux
- [x] Auto-Updater Grundstruktur (electron/updater.ts, bereit für electron-updater)

## 25. Lokale Sample-Verwaltung
- [x] Dateisystem-API für Ordner-Browser
- [x] Sample-Library-Verwaltung (Scan, Index, Cache)
- [x] useElectron Hook für React-Integration
- [x] SampleManager Komponente
- [x] Drag & Drop für Ordner und Dateien (electron/dragdrop.ts)
- [ ] Bulk-Import mit Progress-Anzeige
- [x] Sample-Kategorisierung und Tags
- [x] Waveform-Preview für lokale Samples (electron/waveform.ts, WAV-Header-Parser)

## 26. Projekt-System (.esx1 Format)
- [x] Projekt-Dateiformat definieren (JSON)
- [x] Speichern/Laden von Projekten
- [x] Auto-Save Funktion (localStorage fallback)
- [x] useProjectSystem Hook
- [x] Projekt-History/Undo-Redo Grundstruktur (WindowManager.updateState)
- [x] Export-Optionen: WAV-Bounce + MIDI-Export (electron/export.ts)
- [ ] Projekt-Templates

## 27. Desktop-spezifische Features
- [x] Native Menüs (File, Edit, View, Help)
- [x] Keyboard-Shortcuts (Ctrl+S, Ctrl+O, Ctrl+Z, Ctrl+Y, F11, etc.)
- [x] System-Tray-Integration
- [x] Vollbild-Modus (F11, Menü, IPC)
- [x] Multi-Window-Support (electron/windows.ts, WindowManager)
- [x] Native Dialoge (Open, Save, Confirm)


## 28. FL Studio-ähnlicher Sample-Browser
- [x] 3-Spalten-Layout (Ordner | Sample-Liste | Preview)
- [x] Ordner-Hierarchie mit Kategorien (Kicks, Snares, Hi-Hats, etc.)
- [x] Sample-Liste mit Thumbnails und Metadaten
- [x] Waveform-Visualisierung für ausgewähltes Sample (echte Audio-Dekodierung)
- [x] Audio-Preview mit Play/Stop Button
- [x] Drag & Drop von Samples auf Drum-Pads
- [x] Favoriten/Tags System
- [x] Such-Funktion über alle Samples
- [x] Sample-Upload mit File-Input und Electron-Folder-Import
- [x] Bulk-Import (mehrere Dateien gleichzeitig)
- [x] LocalStorage-Persistenz für Sample-Library
- [x] Doppelklick zum Laden auf aktuellen Pad
- [x] Drag & Drop Highlight auf Drum Part Labels
- [x] Integration in Home.tsx mit "BROWSE SAMPLES" Button


## 29. Electron Folder-Import Backend
- [x] Electron Main Process: Folder-Scan Funktion implementieren
- [x] IPC-Handler für 'samples:import-folder' Event
- [x] Rekursive Ordner-Durchsuchung (fs.readdir recursive)
- [x] Audio-Dateien filtern (.wav, .mp3, .ogg, .flac, .aiff)
- [x] Ordnerstruktur-basierte Kategorisierung (Kicks/, Snares/, etc.)
- [x] Base64-Encoding für Audio-Dateien
- [x] Relative Pfade für Ordner-Hierarchie
- [x] Progress-Events an Frontend senden (alle 5 Dateien)
- [x] Error-Handling für fehlende Berechtigungen
- [x] Integration mit SampleBrowser testen

## 30. Intelligente Sample-Kategorisierung
- [x] Pattern-Matching für Dateinamen (kick, snare, hihat, clap, tom, perc, fx, loop, vocal)
- [x] Pattern-Matching für Ordnernamen
- [x] Priorität: Ordnername > Dateiname > Default (other)
- [x] Fuzzy-Matching ("bd" → "kicks", "hh" → "hihats", "sn" → "snares")
- [x] Kategorisierungs-Funktion in Electron Main Process (detectCategory)
- [x] 9 Kategorien mit 40+ Keywords (kicks, snares, hihats, claps, toms, percussion, fx, loops, vocals)
- [ ] Tests für verschiedene Sample-Bibliotheken


## 31. Sample-Import Progress-Anzeige
- [x] IPC-Events für Progress-Updates (samples:import-progress)
- [x] Progress-State in SampleBrowser (current, total, percentage)
- [x] Progress-Bar UI-Komponente (Header mit Fortschrittsbalken)
- [x] Event-Listener in useElectron Hook (onSamplesImportProgress)
- [x] Preload Script erweitert (onSamplesImportProgress)
- [x] Electron Main Process: countFiles() + Progress-Callback
- [x] Progress-Updates alle 10 Dateien + Final-Update
- [x] Toast-Benachrichtigung bei Abschluss
- [x] Cancel-Button für laufende Imports (importCancelFlags Map)
- [x] Error-Handling bei Import-Fehlern (pro Datei + Gesamt)


## 32. Waveform-Cache mit IndexedDB
- [x] IndexedDB Utility-Modul erstellen (lib/waveformCache.ts)
- [x] openDatabase() Funktion mit Object Store für Waveforms
- [x] saveWaveform() Funktion (sampleId → Float32Array)
- [x] getWaveform() Funktion mit Cache-Lookup
- [x] clearCache() Funktion für Cleanup
- [x] deleteWaveform() Funktion für einzelne Samples
- [x] cleanupOldWaveforms() Funktion (löscht Waveforms älter als 30 Tage)
- [x] getCacheSize() Funktion für Statistiken
- [x] Integration in SampleBrowser (Cache-Check vor Audio-Dekodierung)
- [x] Cache-Invalidierung bei Sample-Löschung (deleteSample)
- [x] Automatisches Cleanup beim Mount
- [x] Performance-Optimierung: Cache-Hit = keine Audio-Dekodierung


## 33. BPM-Detection & Auto-Tagging
- [x] Audio-Analyse-Modul erstellen (lib/audioAnalysis.ts)
- [x] BPM-Detection Algorithmus (Peak-Detection + Autocorrelation)
- [x] Tonhöhen-Analyse (Autocorrelation + Frequency-to-Note)
- [x] Lautheits-Analyse (RMS + Peak-Level in dB)
- [x] Auto-Tagging beim Sample-Import (File + Folder)
- [x] Tag-Anzeige in Sample-Liste (BPM, Key, Loudness, Duration)
- [x] generateAutoTags() Funktion (BPM-Kategorien, Key, Loudness, One-Shot/Loop)
- [x] Integration in File-Upload (analyzeAudio + generateAutoTags)
- [x] Integration in Electron Folder-Import
- [x] Tag-Pills in Sample-Liste (max 3 sichtbar + Counter)
- [ ] Tag-basierte Filterung im Sample-Browser
- [ ] Performance-Optimierung (Web Worker für Analyse)


## 34. Browser Folder-Import (File System Access API)
- [x] File System Access API Feature-Detection ('showDirectoryPicker' in window)
- [x] showDirectoryPicker() Integration
- [x] Rekursive Ordner-Scan-Funktion für Browser (scanBrowserDirectory)
- [x] Audio-Dateien-Filter (.wav, .mp3, .ogg, .flac, .m4a, .aiff, .webm)
- [x] FileReader für Browser-basierte Audio-Dekodierung
- [x] Progress-Anzeige während des Scans (alle 10 Dateien)
- [x] Auto-Kategorisierung wie in Electron (detectCategoryFromPath)
- [x] Auto-Tagging Integration (analyzeAudio + generateAutoTags)
- [x] Fallback-Nachricht für nicht-unterstützte Browser
- [x] Import Folder Button immer sichtbar (nicht nur in Electron)
- [x] Hybrid-Ansatz: Electron API wenn verfügbar, sonst File System Access API


## 35. Multi-Select & Batch-Operations
- [x] Checkbox-Selection für Samples
- [x] selectedSamples State (Set<string>)
- [x] isMultiSelectMode Toggle
- [x] "Select All" / "Deselect All" Buttons
- [x] Batch-Delete Funktion (mit Waveform-Cache Cleanup)
- [x] Batch-Favorisieren Funktion
- [x] Batch-Unfavorisieren Funktion
- [x] Batch-Re-Kategorisieren Funktion
- [x] Selection-Counter ("X selected")
- [x] Batch-Actions Toolbar (Favorite, Unfavorite, Move To, Delete)
- [x] "Select" / "Cancel" Button im Header
- [x] Checkbox nur im Multi-Select-Modus sichtbar
- [x] Drag & Drop deaktiviert im Multi-Select-Modus

## 36. Tag-basierte Filterung
- [x] BPM-Range Filter (60-90, 90-120, 120-140, 140+)
- [x] Key-Filter (C, D, E, F, G, A, B + Sharps)
- [x] Loudness-Filter (quiet, medium, loud)
- [x] Duration-Filter (one-shot, loop)
- [x] Dropdown-Selects für alle Filter
- [x] "Clear Filters" Button (erscheint wenn Filter aktiv)
- [x] Filter-Logik in filteredSamples (BPM-Parsing, Key-Matching, Tag-Matching)
- [x] Kombinierte Filter (alle gleichzeitig anwendbar)

## 37. Sample-Preview-Queue
- [x] Queue State (Sample[], queueIndex, isLoopMode)
- [x] Add to Queue Button (Plus-Icon bei jedem Sample)
- [x] Queue Panel UI (unter Preview, nur sichtbar wenn Queue > 0)
- [x] Auto-Advance zum nächsten Sample (useEffect mit audio.ended Event)
- [x] Loop-Modus Toggle (🔁 / ➡️ Button)
- [x] Clear Queue Button
- [x] Remove from Queue (X-Button bei jedem Queue-Item)
- [x] Previous / Next Buttons
- [x] Queue-Index Highlighting (aktueller Track blau)
- [x] Queue-Counter im Header
- [ ] Drag & Drop Reordering

## 38. Web Worker für Audio-Analyse
- [x] audioAnalysis.worker.ts erstellen
- [x] BPM-Detection in Worker auslagern (detectBPM, detectPitch, detectLoudness)
- [x] Message-Passing zwischen Main Thread und Worker (analyze, result, error, progress)
- [x] Progress-Updates vom Worker (0.2, 0.4, 0.6, 0.8)
- [x] analyzeAudioWithWorker() Funktion in audioAnalysis.ts
- [x] Lazy Worker Initialization (getAudioWorker)
- [x] Worker Integration in SampleBrowser (alle analyzeAudio Calls ersetzt)
- [x] Promise-basierte API für Worker-Communication
- [ ] Worker-Pool für parallele Analyse (aktuell: 1 Worker)
- [x] Fallback: analyzeAudio() (Main Thread) bleibt verfügbar

## 39. Sample-Similarity-Search
- [x] "Find Similar" Button bei jedem Sample (Search-Icon)
- [x] Similarity-Score Berechnung (BPM, Key, Tags, Category)
- [x] Ähnlichkeits-Algorithmus (Weighted Score: BPM 40%, Key 30%, Tags 20%, Category 10%)
- [x] sampleSimilarity.ts Modul (calculateSimilarity, findSimilarSamples)
- [x] BPM Similarity (2 BPM diff = 1% penalty)
- [x] Key Similarity (Circle of Fifths - musikalische Verwandtschaft)
- [x] Tag Similarity (Common Tags / Total Tags)
- [x] Similarity-Results Modal mit ScrollArea
- [x] Sort by Similarity (descending)
- [x] Threshold-Slider für Genauigkeit (0-100%)
- [x] Reasons-Anzeige (Similar BPM, Same Key, Common Tags)
- [x] Click to Preview (handleSelectSample)


## 40. Bug-Fixes: Sample-Import & Upload
- [x] Fehler bei vielen gleichzeitigen Sample-Imports beheben
  - [x] Parallele Audio-Analyse limitieren (max 3 gleichzeitig)
  - [x] Queue-System für Worker-Analysen implementieren (audioAnalysisQueue.ts)
  - [x] AudioAnalysisQueue Klasse (queue, activeCount, maxConcurrent)
  - [x] processQueue() Funktion (automatische Verarbeitung)
  - [x] SampleBrowser auf Queue umgestellt (alle 3 Import-Methoden)
  - [ ] Progress-Anzeige für Queue
  - [x] Error-Handling verbessern
- [x] DrumSampleUploader Upload Sample Button reparieren
  - [x] Buffer.from() durch Uint8Array ersetzt (Browser-kompatibel)
  - [x] Server Schema erweitert (Buffer | Uint8Array)
  - [x] Upload-Button Event-Handler überprüft (korrekt)
  - [x] Audio-Engine Integration getestet (loadCustomSample funktioniert)
  - [x] Sample-Loading in useAudioEngine überprüft (korrekt)


## 41. Sample-Library Cloud-Backup (Hybrid-Ansatz)
- [x] Datenbank-Schema für Sample-Library erstellen (sampleLibrary Tabelle)
- [x] Felder: id, userId, name, category, filePath, fileKey, audioDataUrl, favorite, tags, createdAt
- [x] tRPC-Procedures implementieren:
  - [x] sampleLibrary.list (alle Samples des Users)
  - [x] sampleLibrary.create (neues Sample speichern mit S3 Upload)
  - [x] sampleLibrary.update (Sample aktualisieren - favorite, tags, category)
  - [x] sampleLibrary.delete (Sample löschen)
  - [x] sampleLibrary.bulkCreate (mehrere Samples gleichzeitig mit S3 Upload)
- [x] Hybrid-Ansatz: LocalStorage primär + optionales Cloud-Backup
  - [x] "Backup to Cloud" Button (speichert alle LocalStorage Samples in DB)
  - [x] "Restore from Cloud" Button (lädt alle DB Samples in LocalStorage)
  - [x] Backup-Status Anzeige (localStorage: last-cloud-backup)
  - [x] Conflict-Resolution (User-Dialog: Replace vs. Merge)
  - [x] bulkCreate Mutation für Batch-Upload
  - [x] S3-Upload für alle Samples
- [x] Loading States und Error-Handling


## 42. Bug-Fixes: Sample-Browser & Upload
- [ ] Import-Buttons im Sample-Browser fehlen (Import Files, Import Folder)
  - [ ] UI-Elemente überprüfen (sind sie versteckt oder gelöscht?)
  - [ ] Event-Handler überprüfen
- [ ] Upload Sample Button wendet Sample nicht an
  - [ ] onSampleLoaded Callback überprüfen
  - [ ] engine.loadCustomSample Integration testen
  - [ ] Console-Errors analysieren


## 42. Bug-Fixes: Sample Mode UI
- [x] Sample Mode Content außerhalb des Viewports
  - [x] Auto-Scroll zu Sample-Bereich beim Mode-Wechsel
  - [x] useEffect mit currentMode === 4 (SAMPLE)
  - [x] scrollIntoView() für Sample-Section
  - [x] Smooth-Scroll Behavior
  - [x] ID "sample-section" zu Mobile und Desktop Section hinzugefügt
- [ ] Upload Sample Button funktioniert nicht
  - [ ] DrumSampleUploader Event-Handler überprüfen
  - [ ] engine.loadCustomSample Integration testen
  - [ ] onSampleLoaded Callback überprüfen
  - [ ] Console-Logs für Debugging hinzufügen


## 43. Bug-Fixes: Sample-Browser & Custom Drums (Kritisch)
- [x] Browse Samples: Import Folder Button existiert bereits im SampleBrowser Dialog
- [x] Browse Samples: "IMPORT" Button oben umbenannt zu "IMPORT PATTERN" (war Pattern-Import, kein Audio-Import)
- [x] Custom Drum Samples werden nicht auf Pads angewendet: loadDrumSample() existierte nicht → durch loadCustomSample() ersetzt
- [x] Sequencer ignorierte Custom Samples: triggerDrum() wird jetzt im Sequencer aufgerufen
- [x] loadCustomSample verbessert: null-check für drumGainRef, Stop vor Start, Fallback-Loading
- [x] triggerDrum verbessert: Stop vor Retrigger, bessere Logs


## 44. Upload → Sample Library Sync
- [x] DrumSampleUploader: Nach Upload automatisch Sample in lokale Sample-Library einfügen
- [x] Kategorie automatisch basierend auf Drum-Part setzen (Kick, Snare, HiHat, etc.)
- [x] Sample erscheint sofort in Browse Samples Übersicht (via CustomEvent dispatch)

## 45. Ordner-Import im Browse Samples
- [x] Sichtbarer "Import Folder" Button im Sample Browser Dialog
- [x] File System Access API (showDirectoryPicker) für Ordner-Auswahl
- [x] Alle Audio-Dateien aus Ordner hochladen und zur Bibliothek hinzufügen
- [x] Progress-Anzeige während des Imports
- [x] Fallback für Browser ohne File System Access API (multi-file input mit webkitdirectory)

## 46. Prev/Next Buttons auf Drum-Pads
- [x] Prev/Next Buttons direkt am Drum-Pad UI (ChevronLeft/ChevronRight)
- [x] Durch Samples der passenden Kategorie blättern (z.B. nur Kicks für Kick-Pad)
- [x] Sample wird sofort geladen und kann angehört werden
- [x] Aktueller Sample-Name wird am Pad angezeigt (Index/Total: Name)

## 47. Custom Playlists im Sample Browser
- [x] Playlist erstellen/umbenennen/löschen
- [x] Samples zu Playlists hinzufügen/entfernen
- [x] Playlist-Ansicht in der Sidebar-Navigation
- [x] Playlists in LocalStorage persistieren (sampleLibraryStore.ts)

## 48. Bug-Fix: Folder/File Import im Browse Samples funktioniert nicht
- [x] Root Cause: AudioContext nicht verfügbar in Web Worker → audioAnalysisQueue.analyze() schlug fehl für jede Datei
- [x] Fix: Audio-Analyse optional gemacht (try/catch) in handleFileUpload, handleFolderInputFallback, scanBrowserDirectory
- [x] Samples werden jetzt auch ohne Auto-Tags hinzugefügt wenn Analyse fehlschlägt
- [x] saveLibrary() wird nach Import aufgerufen für Persistenz in localStorage

## 49. Bug-Fix: Sample Browser Layout nicht scrollbar
- [x] Dialog-Höhe auf 95vh gesetzt (statt 90vh)
- [x] Left Panel: w-48 lg:w-64 mit flex-shrink-0 und overflow-hidden (responsive)
- [x] Middle Panel: min-w-0 und overflow-hidden
- [x] Right Panel: w-72 lg:w-96 mit overflow-y-auto (responsive)
- [x] Alle Panels haben korrekte overflow-Einstellungen für Scrollbarkeit

## 50. Bug-Fix: Ordner-Import stürzt ab bei vielen Dateien
- [x] Root Cause: QuotaExceededError - Audio-Daten als Base64 in localStorage gespeichert
- [x] Fix: IndexedDB für Audio-Daten, localStorage nur für Metadaten (sampleLibraryStore.ts komplett neu)
- [x] Migration von altem localStorage zu IndexedDB implementiert (migrateFromOldStorage)
- [x] Einzelne Speicherung pro Datei statt Batch (addSampleToLibraryAsync)
- [x] UI yielded alle 3 Dateien um Einfrieren zu verhindern
- [x] Fehlertoleranz: Einzelne fehlgeschlagene Dateien werden übersprungen
- [x] Progress-Anzeige pro Datei aktualisiert

## 51. Bug-Fix: Import Buttons im Sample Browser nicht sichtbar
- [x] Import Buttons als sticky Footer am unteren Rand des linken Panels positioniert
- [x] Linkes Menü (Categories + Playlists) scrollbar gemacht (overflow-y-auto)
- [x] Import Buttons immer sichtbar unabhängig vom Scroll-Status
- [x] Layout bei normalem Zoom vollständig nutzbar

## 52. Bug-Fix: showDirectoryPicker SecurityError in Cross-Origin iFrame
- [x] handleFolderImport: showDirectoryPicker entfernt, nutzt jetzt immer input[webkitdirectory]
- [x] Funktioniert in allen Kontexten (iFrame, direkt, Electron)

## 53. Bug-Fix: Sample-Listen im Browse Sampler nicht scrollbar
- [x] Mittleres Panel: ScrollArea durch overflow-y-auto div ersetzt mit min-h-0
- [x] Linkes Panel: min-h-0 hinzugefügt für korrektes Flex-Scrolling
- [x] Alle Listen sind bei vielen Einträgen scrollbar (178 Kicks getestet)

## 54. Feature: Cloud Backup/Restore Buttons im Browse Sampler
- [x] Cloud Backup Button als sticky Footer im linken Panel (Batch-Upload, 5 pro Batch)
- [x] Cloud Restore Button als sticky Footer im linken Panel (Replace/Merge Option)
- [x] Progress-Anzeige während Cloud-Sync
- [x] Buttons disabled während Sync läuft
- [x] Restored Samples werden in IndexedDB gespeichert

## 55. Bug-Fix: Samples im Browser nach Namen sortieren
- [x] Samples alphabetisch nach Namen sortiert (localeCompare mit numeric: true)
- [x] Samples nach Kategorie gruppiert (Kicks zu Kicks, Snares zu Snares) - war bereits korrekt
- [x] Sortierung in getFilteredSamples() angewendet

## 56. Bug-Fix: Effekte produzieren keinen hörbaren Unterschied
- [x] Root Cause: Effekte waren NUR mit Synth-Kette verbunden, Drums hatten KEINE Effekte
- [x] Fix: Separate Drum-Effekt-Instanzen erstellt (drumReverbRef, drumDelayRef, drumChorusRef, drumDistortionRef)
- [x] Drum-Kette: drumGain → distortion → chorus → delay → reverb → drumChannel
- [x] updateEffectParam aktualisiert jetzt BEIDE Effekt-Ketten (Synth + Drums)
- [x] Alle 16 Effekt-Typen implementiert (vorher nur 4: Reverb, Delay, Chorus, Distortion)
- [x] Effekt-Reset beim Typ-Wechsel: Vorherige Effekte werden auf 0 (dry) gesetzt

## 57. Bug-Fix: "Unable to decode audio data" beim Laden von Custom Samples
- [x] Root Cause: Tone.Player kann Base64-DataURLs nicht direkt laden
- [x] Fix: dataUrlToObjectUrl() Helper erstellt - konvertiert DataURL in Blob + ObjectURL
- [x] loadCustomSample erkennt DataURLs automatisch und konvertiert vor dem Laden
- [x] Alternative Lademethode (fetch + decodeAudioData) nutzt auch ObjectURL
- [x] ObjectURL wird nach 5s Verzögerung revoked (nach Dekodierung)

## 58. Bug-Fix: "Failed to fetch" beim Laden von Custom Samples und Waveform
- [x] loadCustomSample: ObjectURL/fetch komplett entfernt, Base64 direkt zu ArrayBuffer dekodiert
- [x] dataUrlToArrayBuffer() Helper: atob() → Uint8Array → ArrayBuffer → decodeAudioData()
- [x] Kein fetch() mehr nötig für DataURLs - funktioniert in Cross-Origin iFrames
- [x] drawWaveform: Bessere Fehlerbehandlung für fehlende audioData und Blob-URLs

## 61. BUG: Mobile Menu - Bottom Collapsible Menus funktionieren nicht
- [x] Keyboard Menü auf mobil debuggen
- [x] Custom Drum Samples Menü auf mobil debuggen
- [x] Envelopes Menü auf mobil debuggen
- [x] Touch-Event Handling überprüfen (pointer-events: none war das Problem)
- [x] Responsive Layout für Mobile optimieren (CSS Media Query hinzugefügt)
- [x] Touch-Event Handler (onTouchEnd) hinzugefügt
- [x] CSS Touch-Optimierungen (-webkit-touch-callout, touch-action: manipulation)
