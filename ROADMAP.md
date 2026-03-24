# Synthstudio – Funktionsübersicht & Entwicklungs-Roadmap

**Synthstudio** ist ein professioneller Sample-Manager, Synthesizer und Drum Machine, der als plattformübergreifende Desktop-Anwendung (Electron) und Web-Applikation (React) entwickelt wird. Dieses Dokument bietet einen Überblick über den aktuellen Entwicklungsstand und skizziert die strategischen nächsten Schritte.

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
