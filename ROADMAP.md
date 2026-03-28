# Synthstudio – Funktionsübersicht & Entwicklungs-Roadmap

**Synthstudio** ist ein professioneller Sample-Manager, Synthesizer und Drum Machine, der als plattformübergreifende Desktop-Anwendung (Electron) und Web-App (React) entwickelt wird.

---

## 1. Aktueller Funktionsumfang (v1.11)

### 1.1 Kern-Architektur & UI
- **Isomorphe Architektur:** Browser + Electron mit einheitlichem Codebase (Goldenes Gesetz).
- **Custom Electron Titlebar** mit Projektname + isDirty-Indikator.
- **Drag & Drop:** Audio-Dateien, Ordner, Projekt-Dateien.
- **Auto-Updater:** GitHub Releases via `electron-updater` (Update-Badge in der Toolbar).
- **Design-Themes:** 6 Themes wählbar (DarkStudio, NeonCircuit, AnalogHardware, Nacht, Sonnenuntergang, OLED-Schwarz) mit CSS-Variablen-System.

### 1.2 Projekt-Management
- Speichern / Laden als `.synth` / `.json`
- Undo/Redo-Stack mit Ctrl+Z / Ctrl+Y
- Zuletzt geöffnete Projekte (Datei-Menü)
- Projekt-Templates (Techno, House, Hip-Hop, Trap, Minimal, Experimental)

### 1.3 Audio & Sampling
- Sample-Browser mit Kategorisierung und Tag-basierter Filterung
- Ordner-Import mit auto-Kategorisierung und Fortschrittsanzeige
- ZIP-Import für Sample-Packs
- AudioEngine: Web Audio API, per-Channel FX (Reverb, Delay, Chorus, Distortion, EQ)
- Wavetable- und FM-Synthesizer-Kanäle

### 1.4 Sequencer
- Drum Machine: 16/32-Step-Grid mit Velocity, Pitch, Probability, Condition
- Euclidean Rhythm Generator
- Pattern Generator (AI-gestützt)
- Arpeggiator
- Humanizer mit globalen Swing-Parameter
- Song-Timeline-Modus

### 1.5 Kollaboration (v1.11)
- **LAN-Session:** Host-Discovery via WebSocket-Server im Electron-Main-Prozess
- **Vollständige Bidirektionale Sync:** step:toggle, bpm:change, pattern:switch, transport
- **Snapshot-Protokoll:** snapshot:full beim Session-Start für vollständige State-Synchronisation
- **Splitscreen-Kollaboration:** Beide DrumMachines nebeneinander in einem Vollbild-View
- **Ausgabe-Modus-Selector:** Ich / Partner / Beide – steuert welche Audioquelle lokal läuft
- **Interaktiver Partner-Sequencer:** Steps im Partner-DrumMachine klicken → Direct broadcast

### 1.6 Export & MIDI
- WAV-Export (Mono/Stereo + Multi-Track Stems)
- MIDI-Export
- MIDI-Controller + MIDI-Learn
- MIDI-Clock-Sync (Master/Slave)

---

## 2. Feature-Roadmap (inspiriert von FL Studio, Ableton, MPC)

Analysierte DAW-Vorbilder: **FL Studio**, **Ableton Live**, **Maschine**, **MPC One**, **Bitwig Studio**, **Renoise**.

---

### 🟥 Phase A: Sequencer-Evolution (v1.12 – v1.14)

| Feature | Beschreibung | Inspiration |
|:---|:---|:---|
| **Piano Roll** | Melodische Noten-Programmierung mit Länge, Velocity und Pitch-Kurven | FL Studio Channel Rack → Piano Roll |
| **Pattern-Chaining** | Automatisches Abspielen von Patterns in einer definierten Reihenfolge | FL Studio Playlist |
| **Polyrhythmische Steps** | Verschiedene Step-Längen pro Kanal (z.B. Kick 16 Steps, Perc 12 Steps) | Ableton Live, Bitwig |
| **Step-Arpeggiator** | Eingebauter Arpeggiator pro Kanal mit Scale-Lock | MPC One, Elektron |
| **Note-Repeat** | Live-Wiederholung von Steps mit einstellbarer Rate (1/8, 1/16, 1/32) | MPC One |
| **Global Transpose** | Alle Pitch-Steps gleichzeitig transponieren | Allgemein |
| **Pattern-Morphing** | Graduelle Überblendung zwischen zwei Patterns | Elektron-Stil |

---

### 🟧 Phase B: Mixer & FX-Chain (v1.13 – v1.15)

| Feature | Beschreibung | Inspiration |
|:---|:---|:---|
| **Mixer-View** | Dedizierter Mixer mit Kanal-Strips, Pre/Post-Fader, Gruppen | FL Studio Mixer |
| **Insert FX Chain** | Drag & Drop FX-Kette pro Kanal (nicht nur Preset-Optionen) | Ableton Chain View |
| **Send/Return Tracks** | Globale Effekt-Buses (z.B. Reverb Room, Delay Mix) | Ableton / FL |
| **Sidechain-Kompressor** | Klassischer Pumping-Effekt (Kick → Sidechain → Bass) | FL Studio Gross Beat |
| **Parametric EQ (16-Band)** | Vollständiger grafischer EQ mit Kurven-Vorschau | Pro Q, FabFilter |
| **Transient Shaper** | Attack/Sustain-Kontrolle für perkussive Klänge | Neutron, SPL Transient |
| **Spektrum-Analyzer** | Echtzeit-FFT-Spektrum im Mixer und in der Channel-Strip | FL Studio |
| **Compressor mit Visualizer** | Kompressor mit Gain-Reduction-Meter | Ableton / Maschine |

---

### 🟨 Phase C: Arrangement & Automation (v1.14 – v1.16)

| Feature | Beschreibung | Inspiration |
|:---|:---|:---|
| **Automation Clips** | Aufzeichnung von Parameterverläufen als editierbare Kurven | FL Studio Auto-Clip |
| **Song Arrangement View** | Vollständiger Timeline-View mit Clip-basiertem Arrangement | Ableton Session → Arrangement |
| **Scene Launch** | Pattern-Sets gleichzeitig starten (Szenen-basiertes Arrangement) | Ableton Session View |
| **Marker & Loop-Punkte** | Setzen von Markern für Arrangement-Navigation | OG DAW-Feature |
| **Swing per Pattern** | Individueller Swing-Parameter pro Pattern (nicht nur global) | Maschine |
| **Groove Templates** | Bibliotheek von Groove-Vorlagen aus echten Drum-Aufnahmen | Ableton Groove Pool |
| **BPM-Automation** | Tempo-Änderungen innerhalb eines Arrangements | FL Studio / Ableton |

---

### 🟩 Phase D: Synthese-Erweiterung (v1.15 – v1.17)

| Feature | Beschreibung | Inspiration |
|:---|:---|:---|
| **Granular-Synthesizer** | Sample-Granulation mit Density, Grain-Size, Spread | Steinberg Padshop, Bitwig |
| **Sampler-Mode** | Slicing, Looping und Pitching importierter Samples | MPC Sampler, Battery |
| **Beat-Slicer** | Automatisches Zerschneiden eines Audio-Loops in einzelne Hits | FL Slicex, Ableton Simpler |
| **Multi-Sample Mode** | Tonhöhen-mapping mehrerer Samples über eine Klaviatur | Native Instruments |
| **LFO-Matrix** | Flexible Modulations-Matrix (LFO/Envelope → Pitch/Volume/FX) | Waldorf, Bitwig |
| **Envelope-Follower** | Audio-Signal als Modulations-Quelle verwenden | Bitwig, Max for Live |
| **Chord-Generator** | Akkord-Erkennung + automatische Harmonisierung | FL Harmor |
| **Scale Lock** | Alle eingegebenen Noten werden auf eine festgelegte Tonart eingeschränkt | Maschine |

---

### 🟦 Phase E: Kollaboration 2.0 (v1.16 – v1.18)

| Feature | Beschreibung | Inspiration |
|:---|:---|:---|
| **Cross-Session Sample-Transfer** | Partner-Samples direkt in eigene Library dragg… | Originell |
| **Collab-Chat** | Text-Chat während der Session | Soundtrap |
| **Session-Recording** | Aufzeichnung aller Events einer Kollab-Session zur Nachbearbeitung | Originell |
| **Public Relay-Server** | Kollaboration ohne LAN (WAN über sicheren Relay) | Soundtrap, Bandlab |
| **Versions-Snapshots** | Automatische Checkpoint-Snapshots alle N Minuten | Google Docs |
| **Rollen-System** | Host kann Schreibrechte pro Partner einschränken | Originell |
| **Collab-Splitscreen: Drag Samples** | Partner-Samples per Drag & Drop in eigene Channels verschieben | Originell |

---

### 🔘 Phase F: Mobile & Accessibility (v1.18+)

| Feature | Beschreibung | Inspiration |
|:---|:---|:---|
| **Touch-optimierter Sequencer** | Step-Grid für Tablet/Smartphone-Touch optimiert | GarageBand iOS |
| **Custom Layout-Editor** | Kanäle, Grid-Größe und Panel-Anordnung individuell anpassbar | Ableton Customization |
| **Colorblind-Mode** | WCAG-konforme Farbmodi für alle Theme-Varianten | Accessibility |
| **Screen-Reader Support** | ARIA-Labels für alle interaktiven Elemente | Accessibility |
| **Offline-Modus für PWA** | Progressive Web App mit Service Worker für Offline-Nutzung | Browser-Standard |

---

### ⚫ Phase G: Pro-Features & Ecosystem (v2.0+)

| Feature | Beschreibung | Inspiration |
|:---|:---|:---|
| **VST/AU Plugin Host** | Einbindung von Third-Party-Plugins (Electron only) | FL Studio, Ableton |
| **DAW-Integration (ReWire)** | Synthstudio als Slave in FL Studio / Ableton | Classic DAW-Feature |
| **CLAP Plugin Support** | Nächste Generation Plugin-Format (Open Source) | Bitwig, Reaper |
| **Marketplace** | In-App-Store für Premium Sample Packs und Preset-Bibliotheken | Splice, Native Access |
| **AI Beat Co-Pilot** | LLM-basierter Assistent der Patterns vorschlägt und erklärt | Originell |
| **Cloud Sync** | Projekte in der Cloud speichern + auf mehreren Geräten weiterarbeiten | Soundtrap, Bandlab |

---

## 3. FL Studio / Ableton Feature-Analyse

Nach Analyse von FL Studio, Ableton Live, Maschine und MPC sind diese Kernprinzipien besonders wertvoll für Synthstudio:

### Von FL Studio
- **Mixer-Channel-Strip:** Jeder Drum-Kanal hat seinen eigenen EQ, Compressor und Send-Level
- **Playlist mit Pattern-Blöcken:** Patterns in einer Timeline arrangieren statt nur Song-Mode
- **Gross Beat:** Rhythmische Manipulation des Audiosignals in Echtzeit (Stutter, Reverse, Scratch)
- **Word Recording:** Direkte Live-Recording ohne Vorkonfiguration

### Von Ableton Live
- **Session View + Arrangement View:** Zwei komplettäre Arbeitsweisen (Jamming vs. Komposition)
- **Clip Launching:** Einzelne Clips/Patterns live starten/stoppen
- **Follow Actions:** Clips können automatisch den nächsten Clip auslösen
- **Max for Live:** Erweiterbarkeit durch MIDI/Audio-Processing-Devices

### Von Maschine / MPC
- **Hardware-First Feeling:** Alle Funktionen auch per Pad + Encoder bedienbar
- **Scene Mode:** 16 Szenen = 16 Pattern-Sets gleichzeitig verwaltbar
- **Step-Sequencer + Piano Roll:** Beide Editing-Modi nahtlos kombinierbar
- **Performance-Modus:** Chords, Arp, Note-Repeat kontextabhängig live aktivierbar

### Von Renoise
- **Tracker-Interface:** Patterns als vertikale Noten-Tabellle (Alternative zum Grid)
- **LFO-Typen:** Viele Modulations-Kurvenformen (Sine, Square, Random, Custom)
- **Redux Effect:** Sample-Rate-Reduction und Bitcrusher als Standard-Effekt

---

## 4. Empfehlungen für den nächsten Sprint

1. **Piano Roll (v1.12 – höchste Priorität):** Das meistgewünschte Feature bei Drum-Machine-Nutzern. Ermöglicht melodische Programmierung neben dem reinen Drum-Grid.
2. **Mixer-View (v1.13):** Zentrales Feature-Differential zu kostenlosen Alternativen. Visualisierung aller Kanäle mit Fader, EQ, Send.
3. **Beat-Slicer (v1.14):** Ermöglicht das Arbeiten mit Audio-Loops ohne externe Tools. Sehr beliebtes Feature in MPC/Ableton.
4. **Kollaboration 2.0 – Cross-Session Samples (v1.16):** Natürliche Erweiterung des bestehenden Collab-Systems.
5. **VST-Plugin-Host (v2.0):** Langfristiger Wettbewerbsvorteil im Desktop-Markt.


## 1. Aktueller Funktionsumfang (Status Quo)

Die Anwendung verfügt bereits über eine solide Basis-Architektur und zahlreiche Kernfunktionen, die sowohl im Browser als auch in der Desktop-Version (Electron) nutzbar sind.

### 1.1 Kern-Architektur & UI
- **Isomorphe Architektur:** Die Anwendung läuft nativ im Browser (mit Fallbacks) und als Desktop-App (Electron) mit erweiterten Systemrechten.
- **Responsive Design:** Die Benutzeroberfläche ist für Desktop, Tablets und Smartphones optimiert (Stack-Modus, Collapsible Sections).
- **Custom Titlebar:** Eigene Electron-Titelleiste mit Projektname und "isDirty"-Indikator (ungespeicherte Änderungen).
- **Drag & Drop System:** Umfassende Unterstützung für das Hereinziehen von Audio-Dateien, Ordnern und Projekt-Dateien.

### 1.2 Projekt-Management
- **Speichern & Laden:** Projekte können als `.synth` oder `.json` Dateien gespeichert und geladen werden.
- **Undo/Redo-System:** Vollständiger History-Stack für Pattern-Edits und Parameter-Änderungen (mit Shortcuts Ctrl+Z / Ctrl+Y).
- **Zuletzt geöffnete Projekte:** Dynamisches Menü für den schnellen Zugriff auf kürzlich bearbeitete Projekte.

### 1.3 Audio & Sampling
- **Sample Browser:** Verwaltung importierter Samples mit Kategorisierung (Kicks, Snares, Hats, etc.).
- **Ordner-Import:** Import ganzer Sample-Ordner mit automatischer Kategorisierung und Fortschrittsanzeige.
- **Audio-Engine:** Wiedergabe von Samples über die Web Audio API (Tone.js).
- **Effekt-Ketten:** Separate Effekt-Ketten für Synthesizer und Drums (Reverb, Delay, Chorus, Distortion).

### 1.4 Sequencer & Pattern
- **Drum Machine Grid:** 16-Step Sequencer für bis zu 9 Drum-Parts.
- **Velocity-Sensitive Steps:** Unterstützung für unterschiedliche Anschlagstärken (Soft, Medium, Hard) pro Step.
- **Per-Part Velocity-Offset:** Globale Anpassung der Lautstärke pro Drum-Part.
- **Pattern Copy/Paste:** Kopieren und Einfügen von Patterns zwischen verschiedenen Bänken (A-D).
- **Motion Sequencing:** Aufnahme und Wiedergabe von Parameter-Automationen (Knob-Bewegungen).

### 1.5 Export & Integration
- **Audio-Export:** Export von Projekten als WAV-Dateien (Mono/Stereo) und Multi-Track Stems.
- **MIDI-Export:** Export von Patterns als MIDI-Dateien.
- **MIDI-Controller-Support:** Web MIDI API Integration mit MIDI-Learn Funktion für externe Hardware-Controller.
- **MIDI Clock Sync:** Tempo-Synchronisation mit externen DAWs (Master/Slave Modus).

---

## 2. Strategische Roadmap (Nächste Schritte)

Basierend auf der Analyse des Codebases und der offenen Aufgaben (`todo.md`) ergeben sich folgende strategische Prioritäten für die Weiterentwicklung von Synthstudio.

### Phase 1: Stabilisierung & Workflow-Optimierung (Kurzfristig)

In dieser Phase liegt der Fokus auf der Behebung verbleibender Fehler und der Verbesserung der Benutzererfahrung bei bestehenden Funktionen.

| Funktion / Aufgabe | Beschreibung | Priorität |
| :--- | :--- | :--- |
| **Erweiterter Sample-Import** | Unterstützung für den Import von ZIP-Dateien und verbesserte Ordner-Struktur-Erkennung. | Hoch |
| **Sample-Verwaltung** | Tag-basierte Filterung im Sample-Browser und Drag & Drop Reordering von Samples. | Hoch |
| **Performance-Optimierung** | Implementierung eines Worker-Pools für die parallele Audio-Analyse beim Massen-Import. | Mittel |
| **Projekt-Templates** | Bereitstellung von vorgefertigten Projekt-Vorlagen (z.B. Techno, House, Hip-Hop) für einen schnellen Start. | Mittel |

### Phase 2: "Killer-Features" & Markt-Differenzierung (Mittelfristig)

Diese Phase beinhaltet die Implementierung innovativer Funktionen, die Synthstudio von herkömmlichen Web-Sequencern abheben.

| Funktion / Aufgabe | Beschreibung | Priorität |
| :--- | :--- | :--- |
| **AI Pattern Generator** | LLM-basierte Generierung von Drum-Patterns basierend auf Text-Prompts (z.B. "Techno im Stil von Jeff Mills"). | Hoch |
| **Cloud Pattern Sharing** | Datenbank-Integration zum Speichern, Teilen und Bewerten von Patterns in einer Community. | Hoch |
| **Smart Humanizer** | Algorithmen zur automatischen Variation von Patterns (Swing, Velocity-Jitter) für einen natürlicheren Groove. | Mittel |
| **Mix Analytics** | Visuelles Feedback durch Echtzeit-Spektrum-Analyzer und Pattern-Dichte-Heatmaps. | Mittel |

### Phase 3: Erweiterte Synthese & UI-Evolution (Langfristig)

In der langfristigen Vision wird die Synthese-Engine ausgebaut und die Benutzeroberfläche weiter verfeinert.

| Funktion / Aufgabe | Beschreibung | Priorität |
| :--- | :--- | :--- |
| **Erweiterte Synthese-Engine** | Integration komplexerer Synthese-Formen (Wavetable, FM) neben dem reinen Sample-Playback. | Mittel |
| **UI-Theming** | Implementierung verschiedener UI-Themes (z.B. "Hardware Skeuomorphismus" oder "Neon Circuit Board"). | Niedrig |
| **Plugin-Architektur** | Möglichkeit zur Einbindung von VST/AU-Plugins (nur in der Electron-Desktop-Version). | Niedrig |

---

## 3. Empfehlungen für den Koordinator

Als Koordinator des Projekts empfehle ich folgende Vorgehensweise für die nächsten Sprints:

1. **Fokus auf den Sample-Workflow:** Der Import und die Verwaltung von Samples ist das Herzstück der Anwendung. Die offenen Punkte beim ZIP-Import und der Tag-Filterung sollten als Erstes angegangen werden, da sie den Workflow der Nutzer massiv verbessern.
2. **Parallelisierung der Entwicklung:** Da die Architektur isomorph aufgebaut ist, können UI-Komponenten (React) und Desktop-spezifische Features (Electron IPC) gut parallel von verschiedenen Agenten entwickelt werden.
3. **Einführung des AI Pattern Generators:** Dieses Feature bietet das größte Potenzial für Aufmerksamkeit und sollte als "Flagship-Feature" für das nächste Major-Release (v1.2.0) priorisiert werden. Die tRPC-Infrastruktur dafür ist laut `todo.md` bereits teilweise vorbereitet.
4. **Strikte Trennung von Web und Desktop:** Das "Goldene Gesetz" (alle Electron-Aufrufe nur über den `useElectron`-Hook) muss bei allen neuen Features strikt beibehalten werden, um die Lauffähigkeit im Browser nicht zu gefährden. Dies ist ein massiver Wettbewerbsvorteil.
