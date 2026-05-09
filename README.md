# Synthstudio

**Professioneller Sample-Manager, Synthesizer & Drum Machine** – als plattformübergreifende Desktop-App (Electron) und Web-App (React).

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Version](https://img.shields.io/badge/version-1.13.0-cyan)

---

## Features

### Audio & Sequencer
- **Drum Machine** – 16/32-Step-Grid mit 9+ Kanälen, Velocity, Pitch, Probability & Conditional Triggers
- **Piano Roll** – Melodische Noten-Programmierung mit Pitch-Kurven
- **Wavetable- & FM-Synthesizer** – Verschiedene Oszillator-Typen pro Kanal
- **Arpeggiator** – Automatische Arpeggio-Muster mit Scale-Lock
- **Euclidean Rhythms** – Algorithmische Pattern-Generierung
- **Motion Sequencing** – Parameter-Automationsaufnahme pro Step
- **Note-Repeat** – Live-Wiederholung mit einstellbarer Rate (1/8, 1/16, 1/32)
- **Swing per Pattern** – Individueller Swing-Parameter pro Pattern (0–100%)
- **Global Transpose** – Alle Pitch-Steps gleichzeitig transponieren (±24 Halbtöne)

### Mixer & Effekte
- **Mixer-View** – Channel-Strips mit Fader, Pan, Mute/Solo
- **16 Effekttypen** – Reverb, Delay, Chorus, Distortion, Filter (LP/HP/BP/Notch), EQ, Compressor
- **Separate Drum- & Synth-Effektketten**
- **Echtzeit-Spektrum-Analyzer & Waveform-Visualisierung**

### Sample-Management
- **FL-Studio-Style Sample-Browser** – 3-Spalten-Layout mit Waveform-Preview
- **ZIP-Import** – Sample-Packs als ZIP-Dateien importieren mit Auto-Kategorisierung
- **Ordner-Import** – Rekursiver Scan mit intelligenter Kategorisierung (Kicks, Snares, Hi-Hats, etc.)
- **BPM-Detection & Auto-Tagging** – Automatische Analyse von Tempo, Tonhöhe & Lautheit
- **Sample-Similarity-Search** – Ähnliche Samples finden (BPM, Key, Tags)
- **Playlists** – Eigene Sample-Sammlungen erstellen
- **Cloud-Backup** – Sample-Library in der Cloud sichern und wiederherstellen (S3)

### AI-Features
- **AI Pattern Generator** – LLM-basierte Beat-Erzeugung ("Techno im Stil von Jeff Mills")
- **AI Chord Suggestions** – Automatische Akkordvorschläge
- **Smart Humanizer** – Algorithmen für natürlicheren Groove (Swing, Velocity-Jitter, Timing-Jitter)

### Kollaboration
- **LAN-Session** – WebSocket-basierter Multiplayer (Host-Discovery)
- **Splitscreen-Modus** – Beide DrumMachines nebeneinander
- **Bidirektionale Sync** – Steps, BPM, Pattern, Transport

### Export & MIDI
- **WAV-Export** – Mono/Stereo + Multi-Track Stems
- **MIDI-Export** – Pattern als MIDI-Dateien
- **MIDI-Controller & MIDI-Learn** – Externe Hardware einbinden
- **MIDI Clock Sync** – Master/Slave-Modus mit Latenz-Kompensation

### Projekt-Management
- **Speichern/Laden** – .synth/.json Projektdateien
- **Undo/Redo** – Vollständiger History-Stack (50 Steps)
- **Projekt-Templates** – Techno, House, Hip-Hop, Trap, Minimal, Experimental
- **6 Design-Themes** – DarkStudio, NeonCircuit, AnalogHardware, Nacht, Sonnenuntergang, OLED

### Plattform
- **Isomorphe Architektur** – Läuft im Browser und als Desktop-App (Electron)
- **Responsive Design** – Optimiert für Desktop, Tablet & Smartphone
- **Auto-Updater** – GitHub Releases via electron-updater

---

## Installation

### Voraussetzungen
- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9+

### Setup

```bash
# Repository klonen
git clone https://github.com/GeorgDub/Synthstudio.git
cd Synthstudio

# Dependencies installieren
pnpm install

# Entwicklungsserver starten (Browser)
pnpm dev

# Entwicklungsserver starten (Electron)
pnpm dev:electron
```

### Build

```bash
# Web-App bauen
pnpm build

# Electron-App bauen (alle Plattformen)
pnpm build:electron

# Electron-App für Windows
pnpm build:electron:win

# Electron-App für macOS
pnpm build:electron:mac

# Electron-App für Linux
pnpm build:electron:linux
```

### Tests

```bash
# Unit-Tests
pnpm test

# E2E-Tests (Playwright)
pnpm test:e2e
```

---

## Tech-Stack

| Kategorie | Technologie |
|:---|:---|
| Frontend | React 19, TypeScript, Tailwind CSS 4, Vite |
| Audio | Web Audio API, Tone.js |
| Desktop | Electron 40, electron-builder, electron-updater |
| Backend | Express, tRPC, Drizzle ORM |
| Datenbank | MySQL (Cloud), IndexedDB + localStorage (lokal) |
| Cloud | AWS S3 (Sample-Backup) |
| Testing | Vitest, Playwright |
| UI-Bibliothek | Radix UI, Lucide Icons, Framer Motion |

---

## Architektur-Prinzipien

1. **Goldenes Gesetz:** Alle Electron-Aufrufe gehen ausschließlich über den `useElectron()`-Hook. Kein direktes `window.electronAPI`. Browser-Kompatibilität nie brechen.
2. **Isomorph:** Jedes Feature muss sowohl im Browser als auch in Electron funktionieren.
3. **IndexedDB für große Daten:** Audio-Daten in IndexedDB, nur Metadaten in localStorage.
4. **Web Worker für CPU-intensive Tasks:** Audio-Analyse im Worker-Pool.

---

## Lizenz

MIT – siehe [LICENSE](LICENSE)
