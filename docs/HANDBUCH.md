# Synthstudio – Funktionshandbuch

**Version 1.22.0 | Vollständige Dokumentation aller Features**

---

## Inhaltsverzeichnis

1. [Übersicht & Interface](#1-übersicht--interface)
2. [Transport & BPM](#2-transport--bpm)
3. [Sample Browser](#3-sample-browser)
4. [Drum Machine / Sequencer](#4-drum-machine--sequencer)
5. [Step Inspector](#5-step-inspector)
6. [Live Pattern Editing](#6-live-pattern-editing)
7. [Performance Features](#7-performance-features)
8. [Mixer](#8-mixer)
9. [Song-Modus & Arrangement](#9-song-modus--arrangement)
10. [Automation](#10-automation)
11. [Scene Launch](#11-scene-launch)
12. [Tools-Tab](#12-tools-tab)
13. [Synthese-Engine](#13-synthese-engine)
14. [Granular Synthesizer](#14-granular-synthesizer)
15. [Beat Slicer](#15-beat-slicer)
16. [Kollaboration](#16-kollaboration)
17. [Einstellungen](#17-einstellungen)
18. [MIDI Integration](#18-midi-integration)
19. [Tastatur-Shortcuts](#19-tastatur-shortcuts)
20. [Script Runner & Plugin API](#20-script-runner--plugin-api)

### Sprint 13–16
21. [Note Length per Step](#21-note-length-per-step-sprint-13)
22. [Scale Quantizer](#22-scale-quantizer-sprint-13)
23. [Groove Engine](#23-groove-engine-sprint-13)
24. [MIDI Program Change](#24-midi-program-change-sprint-13)
25. [Custom Metronome Sounds](#25-custom-metronome-sounds-sprint-13)
26. [BPM-Erkennung bei Sample-Import](#26-bpm-erkennung-bei-sample-import-sprint-14)
27. [Pattern Variations A/B/C/D](#27-pattern-variations-abcd-sprint-14)
28. [Arpeggiator-Erweiterungen](#28-arpeggiator-erweiterungen-sprint-14)
29. [Step Probability Chains](#29-step-probability-chains-sprint-14)
30. [Groove Engine Templates](#30-groove-engine-templates-sprint-14--erweiterung)
31. [Auto-Save Ein-/Ausschalten](#31-auto-save-ein-ausschalten-sprint-15)
32. [Micro-Timing pro Kanal](#32-micro-timing-pro-kanal-sprint-15)
33. [MIDI-Bundle-Export](#33-midi-bundle-export-sprint-15)

### Sprint 17+ (v1.15.x)
34. [Multi-Sample Mode (Keyboard Sampler)](#34-multi-sample-mode-keyboard-sampler-v1150)
35. [Envelope Follower](#35-envelope-follower-v1150)
36. [Time-Stretch (Pitch-erhaltend)](#36-time-stretch-pitch-erhaltend-v1150)
37. [Public Relay Server (WAN-Kollaboration)](#37-public-relay-server-wan-kollaboration-v1150)
38. [Audio Workbench (Audacity-like)](#38-audio-workbench-audacity-like-v1150)
39. [Performance Mode Button](#39-performance-mode-button-v1154)
40. [MIDI-Hardware-Templates](#40-midi-hardware-templates-v1150)
41. [Projekt-Import (FL Studio / Ableton / KORG Electribe)](#41-projekt-import-v1150)
42. [KI-Projekt-Analyse](#42-ki-projekt-analyse-v1150)

### v1.16.0
43. [Audio Tracks (Vocals / Songs / Remix-Channel)](#43-audio-tracks-v1160) — *erweitert v1.19.0*

### v1.17.0
44. [Persistente Scripts + Web-Worker-Sandbox](#44-persistente-scripts--web-worker-sandbox-v1170)

### v1.20.0
45. [Performance Mode — überarbeitet](#45-performance-mode-überarbeitet-v1200)

---

## 1. Übersicht & Interface

```
┌─────────────────────────────────────────────────────────────────────┐
│ ● BPM    Synthstudio  Projekt.synth ●    [▶][●][↩][↪] [🎹][⌨][⚙]  │
├──────────┬──────────────────────────────────────────────────────────┤
│ SAMPLE   │  [Sequencer][Mixer][Song][Humanizer][Tools][Kollaboration]│
│ BROWSER  ├──────────────────────────────────────────────────────────┤
│          │                                                          │
│ ● Aufn.  │           HAUPT-INHALT (Tab-abhängig)                   │
│          │                                                          │
│ Samples  │                                                          │
│ Liste    │                                                          │
└──────────┴──────────────────────────────────────────────────────────┘
```

**Komponenten der Oberfläche:**

| Element | Beschreibung |
|---------|-------------|
| **● Beat-Indikator** | Goldener Punkt links neben "Synthstudio" — blinkt auf jedem Beat |
| **Toolbar** | Play/Stop ▶, Record ●, Undo ↩, Redo ↪, MIDI 🎹, Keyboard ⌨, Einstellungen ⚙ |
| **Tab-Leiste** | Wechselt zwischen Sequencer, Mixer, Song, Humanizer, Tools, Kollaboration |
| **Sidebar** | Sample Browser — Breite mit Drag am rechten Rand anpassbar (160–480px) |
| **Hauptbereich** | Tab-abhängiger Inhalt |

### Resizable Sidebar
Die Sidebar-Breite ist durch Ziehen am **6px breiten Handle** am rechten Rand anpassbar.
Die Breite wird in `localStorage` gespeichert und beim nächsten Start wiederhergestellt.

---

## 2. Transport & BPM

```
[▶ Play]  [● Rec]  [↩ Undo]  [↪ Redo]  BPM: [120] [−][+]
```

| Funktion | Tastatur | Beschreibung |
|---------|---------|-------------|
| Play/Stop | `Space` | Wiedergabe starten/stoppen |
| Record | `Ctrl+R` | MIDI-Aufnahme aktivieren |
| Tap Tempo | `T` | BPM durch Klopfen setzen |
| BPM +1 | `+` | BPM um 1 erhöhen |
| BPM −1 | `-` | BPM um 1 verringern |
| BPM +10 | `Shift++` | BPM um 10 erhöhen |
| BPM −10 | `Shift+-` | BPM um 10 verringern |

### Live MIDI-Aufnahme (Overdub)
Wenn Record aktiviert: eingehende MIDI-Noten werden als Steps im aktiven Pattern aufgezeichnet.
- Velocity wird aus dem MIDI-Signal übernommen
- Bereits aktive Steps werden nicht überschrieben (Overdub-Modus)

---

## 3. Sample Browser

```
┌─────────────────────────────┐
│ ● Mikrofon aufnehmen        │  ← Audio-Input-Recorder
├─────────────────────────────┤
│ [Alle][Kicks][Snares]...    │  ← Kategorie-Filter
│ ┌───────────────────────┐   │
│ │ 🔍 Suchen...          │   │
│ └───────────────────────┘   │
│                             │
│ Kick_Deep_01.wav       ⋮   │
│ Snare_Rimshot.wav      ⋮   │
│ HiHat_Closed.wav       ⋮   │
│                             │
│ [Playlists] [Ähnliche]      │
└─────────────────────────────┘
```

### Sample-Import
- **Einzelne Dateien**: Drag & Drop auf den Browser oder Schaltfläche
- **Ordner-Import**: Komplette Ordner werden rekursiv importiert (mit Fortschrittsanzeige)
- **ZIP-Import**: Sample Packs direkt als .zip importieren
- **Auto-Kategorisierung**: Dateinamen werden analysiert (kick, snare, hat, etc.)

### Audio Input Recording
Der **● Aufnahme**-Button oben im Sample Browser öffnet den Mikrofon-Rekorder:
- VU-Meter zeigt Eingangs-Pegel in Echtzeit (12 Segmente, grün/gelb/rot)
- Aufnahme wird sofort als neues Sample in der Kategorie "Recording" gespeichert
- Unterstützt Mikrofon und Line-In (Geräteauswahl über Systemaudio-Einstellungen)

### Waveform Preview
Beim Selektieren eines Samples wird eine **Canvas-Waveform** angezeigt:
- Min/Max-Rendering für genaue Pegelvisualisierung
- Theme-aware Farben (folgt dem aktiven Design-Theme)

---

## 4. Drum Machine / Sequencer

```
┌──────────────────────────────────────────────────────────────────┐
│ [Pattern ▾] [1/16▾] [VEL][↑][↓][∩][∿][R] PITCH [M1-8][⬡Poly]  │
│ [♪MIDI][⟷Morph][🔁NR][● Live Edit][A][B] [+Kanal] [●Live Edit] │
├──────────────────────────────────────────────────────────────────┤
│ Kick    [M][S] [Vol] [Pan] [1/16▾] [FX] [PR] [GR]              │
│ ░░░█░░░█░░░█░░░█  ← 16 Steps (dunkel=aus, hell=an)             │
│ Snare   [M][S] ...                                               │
│ Hi-Hat  [M][S] ...                                               │
│ ...                                                              │
├──────────────────────────────────────────────────────────────────┤
│ Step Inspector (bei ausgewähltem Step)                           │
├──────────────────────────────────────────────────────────────────┤
│ 9 Kanäle · 16 Steps · 1/16 · 120 BPM · Stretch: 1× ×           │
└──────────────────────────────────────────────────────────────────┘
```

### Kanal-Controls (pro Part)
| Button | Funktion |
|--------|---------|
| **M** | Mute — Kanal stummschalten |
| **S** | Solo — Nur diesen Kanal hören |
| **Vol** | Lautstärke-Slider (0–100%) |
| **Pan** | Panorama-Slider (L–R) |
| **Auflösung** | Step-Auflösung: Auto/1/8/1/16/1/32 |
| **FX** | Kanal-Effekte (Filter, EQ, Compressor, Delay, Reverb) |
| **PR** | Piano Roll — melodische Noten eingeben |
| **GR** | Granular Synthesizer für diesen Kanal |

### Velocity-Modus (VEL)
Im Velocity-Modus zeigt jeder aktive Step einen Balken der seine Lautstärke visualisiert.
- **Drag**: Velocity durch vertikales Ziehen auf Step setzen
- **Kurven-Presets** (erscheinen im VEL-Modus):
  - `↑` Crescendo (40→127)
  - `↓` Decrescendo (127→40)
  - `∩` Bogen / Sinus-Kurve
  - `∿` Welle (oszillierend)
  - `R` Zufällig

### Pattern-Dropdown-Optionen
```
[Pattern-Name ▾]
  ● Pattern 1 (aktuell)    [⧉] [✕]
  ▶ Pattern 2 [gesperrt]       ← Live Edit: Original
  ✏ Pattern 2 [DRAFT]          ← Live Edit: Draft
  ──────────────────
  Stacking: [P1 ✓] [P2]        ← Mehrere Patterns gleichzeitig
  Follow Action: [none/next/prev/random] nach [4] Bars
  BPM-Sync: [½×][¾×][1×][1½×][2×]  Transition: [0] Bars
  + Neues Pattern
```

### Time-Stretch
In der Status-Leiste unten: Slider für den aktiven Kanal.
- Bereich: **0.25× bis 4.0×**
- 2.0× = doppelte Dauer ohne Pitch-Änderung (via playbackRate + Detune-Kompensation)
- Klick auf Wert = Reset auf 1×

---

## 5. Step Inspector

Wird durch **Klick oder Rechtsklick** auf einen Step geöffnet (Panel unterhalb der Kanäle).

```
┌───────────────────────────────────────────────────────────────┐
│ Step Inspector  Kick  Step 5                    [AN/AUS]  [✕] │
├────────────┬───────────┬──────────────┬───────────────────────┤
│ VELOCITY   │ PITCH     │ WAHRSCHL.    │ BEDINGUNG + LOCK      │
│ ████░░░ 96 │ F#4 (+6)  │ 75%          │ [Immer] 1:2 2:2 ...   │
│ [32][64]   │ [-12][-7] │ [100%][75%]  │ Filter Hz ──── +  ✕   │
│ [96][127]  │ [0][+7]   │ [50%][25%]   │ Volume    ──── +  ✕   │
│            │ [+12]     │              │ [↩ REV AN/AUS]        │
└────────────┴───────────┴──────────────┴───────────────────────┘
```

| Parameter | Bereich | Beschreibung |
|----------|---------|-------------|
| **Velocity** | 1–127 | Anschlagsstärke; Schnellwerte: 32, 64, 96, 127 |
| **Pitch** | −24..+24 Halbtöne | Transposition; Notenname wird angezeigt |
| **Wahrscheinlichkeit** | 0–100% | Chance dass Step spielt; Presets: 100/75/50/25% |
| **Bedingung** | Immer/1:2/2:2/…/Fill | Step spielt nur unter Bedingung (Elektron-Stil) |
| **Reverse** | AN/AUS | Sample rückwärts abspielen |
| **Param Lock** | Mehrere | Per-Step FX-Override (Elektronstil) |

### Parameter Lock (Trig Locks)
Jeder Step kann FX-Parameter temporär überschreiben, die nur für diesen einen Step gelten:
- **Filter Hz**: Tiefpassfilter-Frequenz
- **Volume**: Kanallautstärke
- **Pan**: Panorama
- **Reverb Send**: Hallanteil
- **Delay Send**: Echoanteil

`+` aktiviert den Lock mit Mittelwert, `✕` deaktiviert ihn wieder.
Nach dem Step-Ende werden alle Parameter automatisch restauriert.

---

## 6. Live Pattern Editing

```
╔══════════════════════════════════════════════════════════════╗
║ ● LIVE EDIT  ▶ spielt: Pattern 1  ✏ bearbeite: Pattern 1 [DRAFT]║
║              [✓ Commit] [⏱ nächste Bar…] [✕ Verwerfen]     ║
╚══════════════════════════════════════════════════════════════╝
```

**Ablauf:**
1. Klick auf `● Live Edit` — erstellt einen **[DRAFT]**-Klon des aktiven Patterns
2. Das Original spielt weiter (eingefroren), der Draft wird zum Bearbeitungsziel
3. Schritte im Grid bearbeiten (Draft wird geändert, Original klingt unverändert)
4. **`✓ Commit`** — sofortiger Wechsel zum Draft; Original wird entfernt; Draft erhält Original-Namen
5. **`⏱ nächste Bar`** — wartet auf den nächsten Bar-Anfang (quantisierter Wechsel, kein Rhythmus-Bruch)
6. **`✕ Verwerfen`** — Draft wird gelöscht, Original bleibt

**Pattern-Dropdown-Verhalten im Live Edit:**
- Original erscheint als `▶ [gesperrt]` — nicht anklickbar
- Draft erscheint als `✏ [DRAFT]` — goldfarben hervorgehoben

---

## 7. Performance Features

### Note Repeat (MPC-Stil)
Aktivierung: `🔁 NR`-Button in der DrumMachine-Toolbar (oder `Alt+R`).

```
[🔁 ON]  Note Repeat  120 BPM  [✕]
[1/4] [1/8] [1/16] [1/32] [1/8T] [1/16T]
[Pad 1] [Pad 2] ... [Pad 9]   ← Live-Pads
```

- Rate wählen → Step wird mit der gewählten Rate wiederholt solange Pad gedrückt
- Langer Tipp (500ms) auf Step-Button = Step Inspector öffnen

### Global Transpose
**TransposeControl** neben BPM-Display:
- `−1 Okt` bis `+1 Okt` in Halbtonschritten
- Betrifft alle melodischen Noten im Piano Roll
- Aktiver Wert wird goldfarben hervorgehoben; Reset auf 0 via ↺

### Pattern Morph
`⟷ Morph`-Button öffnet das Morph-Panel:
```
Pattern A: [Pattern 1 ▾]    Pattern B: [Pattern 2 ▾]
Amount: ─────────────● 0.65
[Apply Morph] [Reset]
```
Slider interpoliert graduell zwischen zwei Patterns → neues gemorphtes Pattern wird erstellt.

### A/B Pattern Compare
`[A][B]`-Buttons in der Toolbar:
- Erstes Klick auf `A`: Speichert aktuelles Pattern als Slot A
- Zweites Klick auf `A`: Wechselt zu Slot A
- Gleich für `B` — schneller A/B-Vergleich ohne Pattern-Dropdown

### Beat Repeat / Stutter
```
[⟳ Beat Repeat]  Rate: [1/32][1/16][1/8][1/4]  Wet: ───── 70%
```
Echtzeit-Stutter-Effekt: moduliert den Master-Gain rhythmisch mit der gewählten Rate.

---

## 8. Mixer

```
┌────────────────────────────────────────────────────────────────┐
│ Mixer  8 Kanäle  [🗜 Bus Comp]  [▶▶ Spectrum]                 │
├──────────────────────────────────────────────────────────────┬─┤
│ [Spectrum FFT Visualizer 0–14 kHz]                           │ │
├─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┬─────┬──────┤C│
│Kick │Snare│ Hat │Clap │TomH │TomL │Perc │ FX  │ FX2 │MASTER│h│
│ VU  │  VU │  VU │  VU │  VU │  VU │  VU │  VU │  VU │  VU  │a│
│ ─── │  ─── │  ─── │  ─── │  ─── │  ─── │  ─── │  ─── │  ─── │  ─── │n│
│[M][S]│    │     │     │     │     │     │     │     │      │n│
│ Pan │ Pan │ Pan │ Pan │ Pan │ Pan │ Pan │ Pan │ Pan │      │e│
│ Rev │ Del │ Rev │ Del │ Rev │ Del │ Rev │ Del │ Rev │Ret.  │l│
└─────┴─────┴─────┴─────┴─────┴─────┴─────┴─────┴─────┴──────┴─┘
│ Export: [Master Mix][Stems] Bars:[4▾] Hz:[44100▾] [⬇ WAV Export]│
└────────────────────────────────────────────────────────────────┘
```

### Spectrum Analyzer
- Echtzeit FFT-Visualisierung (Canvas, 512 Bins)
- Farbkodierung: Bass = accent-secondary, Mids/Highs = accent-primary, Clip = Rot
- Ein-/ausblendbar via `▶▶ Spectrum`-Button

### Bus Kompressor
`🗜 Bus Comp`-Button öffnet 5 Slider:
| Parameter | Bereich | Default |
|----------|---------|---------|
| Threshold | −60..0 dB | −18 dB |
| Ratio | 1:1..20:1 | 4:1 |
| Attack | 0.001..0.1s | 5ms |
| Release | 0.01..1s | 100ms |
| Makeup | −6..+12 dB | 0 dB |

### Channel Inspector (rechte Sidebar)
Klick auf Kanal-Strip → öffnet Inspector mit:
- **Insert FX Chain**: Reihenfolge-unabhängige Effekte (Drag & Drop zum sortieren)
  - `eq16` · `compressor` · `sidechain` · `transient` · `filter` · `distortion` · `bitcrusher` · `ringmod` · `chorus` · `flanger` · `delay` · `reverb`
- **16-Band EQ**: Grafischer Equalizer mit 16 Frequenzbändern (25 Hz–16 kHz)
- **Sidechain Compressor**: Pumping-Effekt (z.B. Kick → Sidechain → Bass)
  - Source-Auswahl, Amount, Attack, Release
- **Transient Shaper**: Attack/Sustain-Kontrolle

### WAV-Export
```
Export: [Master Mix ●] [Stems ○]  Bars: [4 ▾]  Hz: [44100 ▾]
[⬇ WAV Export]  ████████████ 75%  Step 45/64 gerendert
```
- **Master Mix**: Alle Kanäle gemischt → eine Stereo-WAV
- **Stems**: Jeder Kanal einzeln → `Pattern_Kanalname.wav`
- Rendering via `OfflineAudioContext` (schneller als Echtzeit)
- Fortschrittsbalken mit Step-Anzeige

---

## 9. Song-Modus & Arrangement

**Tab:** Song → Sub-Tab: Arrangement

```
┌────────────────────────────────────────────────────────────────┐
│ [♪ Song-Modus AN]  [↺ Loop]                                    │
│                                                                │
│ Intro   [A][2×] [M]  ────────                                 │
│ Verse   [B][4×] [M]  ────────────────────                     │
│ Chorus  [C][2×] [M]  ────────                                 │
│ Outro   [B][4×] [M]  ────────────────────                     │
│                                                                │
│ [+Slot]  Templates: [Techno][House][Hip-Hop]                   │
└────────────────────────────────────────────────────────────────┘
```

### Slot-Eigenschaften
- **Bank**: A–D (welche Pattern-Gruppe)
- **Repeats**: 1–16 Wiederholungen
- **Label**: Frei editierbar (max. 10 Zeichen)
- **Mute**: Slot überspringen

### Follow Actions (Pattern-Automation)
Im Pattern-Dropdown jedes Patterns:
```
Follow Action: [Immer ●] [next] [prev] [random]  nach [4] Bars
BPM-Sync: [½×] [¾×] [1×●] [1½×] [2×]  Transition: [2] Bars
```
- **none**: Kein automatischer Wechsel
- **next/prev**: Nächstes/vorheriges Pattern
- **random**: Zufälliges Pattern
- **BPM-Ratio**: Pattern skaliert das globale BPM (2× = doppeltes Tempo)
- **Transition**: Sanfter BPM-Übergang über N Bars

---

## 10. Automation

**Tab:** Song → Sub-Tab: Automation

```
┌────────────────────────────────────────────────────────────────┐
│ Automation  [● REC]            [BPM ▾] [+ Lane]               │
├────────────────────────────────────────────────────────────────┤
│ BPM                                            [✕✕][🗑]       │
│ █ ░░ ██ ░░░ ███ ░░ ██ ░░░ (Balkendiagramm = Werte)            │
├────────────────────────────────────────────────────────────────┤
│ Master Vol                                     [✕✕][🗑]       │
│ ████████████████████████████████████          (Pegelkurve)     │
└────────────────────────────────────────────────────────────────┘
  Linksklick: Wert setzen · Rechtsklick: Punkt löschen · Ziehen: Verlauf
```

### Automation-Targets
| Kategorie | Targets |
|----------|---------|
| Global | BPM, Master Volume |
| Kanäle | Volume, Pan, Reverb-Send, Delay-Send (pro Kanal) |

### Interpolation
Zwischen gesetzten Punkten wird linear interpoliert (gestrichelter Verlauf).
Playback: `AudioEngine.onPosition()` liest Werte bei jedem Step und setzt Parameter.

---

## 11. Scene Launch

**Tab:** Song → Sub-Tab: Scene Launch

```
┌──────────────────────────────────┐
│ Scene Launch  Shift+1–8   [+Scene]│
├───────────┬───────────┬──────────┤
│ ⇧1        │ ⇧2        │ ⇧3      │
│ INTRO     │ VERSE     │ CHORUS  │
│ (goldfarben aktiv, pulsierend)   │
├───────────┼───────────┼──────────┤
│ ⇧4        │ ⇧5        │ ...     │
│ BRIDGE    │ OUTRO     │         │
└───────────┴───────────┴──────────┘
```

- Klick auf Scene-Pad → sofortiger Pattern-Wechsel (auch während Wiedergabe)
- `Shift+1`–`Shift+8` = Scene 1–8 per Tastatur
- Langes Halten (600ms) = Edit-Modal (Name, Pattern, Farbe)
- Rechtsklick = Scene löschen
- Glow-Effekt bei aktiver Scene

---

## 12. Tools-Tab

### KI-Generator (AI Beat Co-Pilot)
```
Genre: [Techno●][House][Hip-Hop][Trap][DnB][Reggaeton]
Complexity: ─────────────────────● 65%
Beschreibung: "Minimal Techno mit UK-Bassline..."

[✨ KI-Pattern generieren]  ← Bei gesetztem API-Key in Türkis
[Pattern generieren]        ← Ohne API-Key, prozedural
```

**API-Key konfigurieren:** Einstellungen → KI & API → Anthropic API Key

Das generierte Pattern kann in einer Mini-Vorschau überprüft und dann via `→ Anwenden` in die DrumMachine übertragen werden.

### 🎼 Akkorde (Chord Progression Generator)
```
Grundton: [C●][C#][D]...[B]    Modus: [Dur (Ionian) ▾]
Progression: [I-V-vi-IV ▾]     Oktave: [4 ▾]

[Am] [F] [C] [G]    ← Klick = Vorschau-Ton
  ii   IV  I  V

C─D─E─F─G─A─B─C─D─E─F─G  ← Skalen-Visualisierung (Gold=Tonarttöne)

[→ In Piano Roll / Arpeggiator übertragen]
```

| Parameter | Optionen |
|----------|---------|
| Grundton | C..H (alle 12 Halbtöne) |
| Modus | Dur, Dorisch, Phrygisch, Lydisch, Mixolydisch, Moll, Lokrisch |
| Progression | I-IV-V-I · I-V-vi-IV · ii-V-I · I-vi-IV-V · vi-IV-I-V · Zufällig |
| Erweiterungen | 7th-Akkorde (Maj7, Min7, Dom7) |

### 🎹 Keyboard Sampler (Multi-Sample)
```
[Keyboard Sampler ☑ Aktiv]  3 Zonen
┌─────────────────────────────────────────────────────┐
│ [weiß][schwarz][weiß][..] ← Piano-Tastatur C3–C7   │
│  Grün=Zone A  Blau=Zone B  Orange=Zone C            │
└─────────────────────────────────────────────────────┘
Zone manuell: Lo[C3▾] Hi[B4▾] Root[C4▾] [Sample ▾] [+Zone]

● HiHat_Closed.wav  C2–B2  Root:C2  ✕
● Snare_Hard.wav    C3–B3  Root:C3  ✕
● Kick_Deep.wav     C4–B5  Root:C4  ✕
```

- **Drag & Drop** vom Sample Browser auf Piano-Taste → Zone auto-erstellt (±6 Halbtöne)
- `findZones(note, velocity)` für Audio-Engine-Integration
- `zonePlaybackRate(zone, note)` berechnet pitch-korrekte Abspielrate

### 📚 Pattern Library
```
[+ Speichern]  [Export]  [Import]       Pattern-Bibliothek  47 Patterns
───────────────────────────────────────────────────────────────────────
Name: ____________  Genre: [Techno▾]  Tags: kick,minimal,130bpm
[Speichern]

🔍 Suchen...                           Alle Genres ▾
───────────────────────────────────────────────────
Minimal Loop     Techno · 130 BPM · ★★★★☆     [Laden] ✕
Dark Room        Techno · 138 BPM · ★★★☆☆     [Laden] ✕
4x4 House        House  · 124 BPM · ★★★★★     [Laden] ✕
```

- Bis zu **200 Patterns** in `localStorage`
- **Sternbewertung** 1–5 direkt in der Liste
- **Export/Import** als `.json` Datei (Merge oder Ersetzen)

### ⚡ Script Runner
```javascript
// Beispiel: BPM-Ramp
for (let i = 0; i < 8; i++) {
  ss.bpm(100 + i * 5);
  await ss.wait(500);
}
ss.log("Fertig!");
```

**API:** `ss.bpm()` · `ss.play()` · `ss.stop()` · `ss.dispatch(action)` · `ss.log()` · `await ss.wait(ms)`

---

## 13. Synthese-Engine

### Wavetable / FM Synthesizer
Pro Drum-Kanal kann der Klangerzeuger auf **Synthesizer** umgestellt werden (statt Sample).

```
┌─────────────────────────────────┐
│ Synthesizer                     │
│ Mode: [Wavetable ●] [FM]        │
│ Osc: [sine][sawtooth●][square]  │
│       [triangle][custom ✏]      │
│ Detune: ─────────● +12 ¢        │
│ ─── ADSR ─────────              │
│ Attack:  ─── 10ms               │
│ Decay:   ─── 100ms              │
│ Sustain: ─── 80%                │
│ Release: ─── 300ms              │
│ ─── Glide ────────              │
│ Portamento: ─── 0s              │
│ ─── LFO ──────────              │
│ [●] aktiv                       │
│ Waveform: [Sine][Square][Saw]   │
│           [Tri][Random][S&H]    │
│ BPM-Sync: [free●][1/4][1/8]... │
│ Rate: ─── 4.0 Hz  Depth: 10 ¢  │
│ Target: [Pitch●][Volume][Filter]│
└─────────────────────────────────┘
```

| Parameter | Beschreibung |
|----------|-------------|
| **Wavetable** | Klassische Oszillator-Wellenformen (Sine, Sawtooth, Square, Triangle) |
| **FM** | 2-Operator Frequenzmodulation (Carrier + Modulator) |
| **FM Ratio** | Verhältnis Modulator/Carrier (0.1–10) |
| **FM Depth** | Modulationstiefe in Hz (0–1000) |
| **Glide** | Portamento-Zeit für Pitch-Übergänge (0–2s) |
| **LFO Waveform** | Sine · Square · Sawtooth · Triangle · Random · S&H |
| **LFO BPM-Sync** | Rate als Taktbruch: 1/1 · 1/2 · 1/4 · 1/8 · 1/16 · 1/32 · 1/64 |

### Custom Wavetable Editor
Klick auf `custom ✏` im Osc-Menü:
```
┌─────────────────────────────────────────────┐
│ Wavetable Editor         [Übernehmen]  [✕]  │
│                                             │
│ █████████████████  ← Klick/Drag zum Zeichnen│
│                                             │
│ Presets: [Sine][Square][Sawtooth][Triangle] │
└─────────────────────────────────────────────┘
```
- 256-Sample-Auflösung
- Drag zum Zeichnen der Amplitudenwerte
- Presets als Ausgangspunkt

---

## 14. Granular Synthesizer

```
┌─────────────────────────────────┐
│ Granular                [▶ Play]│
│ ┌───────────────────────────┐   │
│ │ [Grain-Cloud Visualizer]  │   │ ← Canvas Echtzeit
│ │  ░░░│░░░  ← Spray-Bereich │   │
│ └───────────────────────────┘   │
│ ⚠ Kein Sample (Sample ziehen)   │
│ Position   ─────● 0%            │
│ Streuung   ─────● 20%           │
│ Grain-Größe ────● 80ms          │
│ Dichte     ─────● 12/s          │
│ Pitch      ─────● 0 st          │
│ Pitch-Spray ────● 0 ¢           │
│ Lautstärke ─────● 70%           │
│ Panorama   ─────● 40%           │
│                                 │
│ Presets: [Cloud][Shimmer][Texture][Stutter][Freeze] │
└─────────────────────────────────┘
```

| Parameter | Beschreibung |
|----------|-------------|
| **Position** | Startpunkt im Sample-Buffer (0–100%) |
| **Streuung** | Zufällige Abweichung um Position (0=deterministisch, 100=voller Buffer) |
| **Grain-Größe** | Länge jedes Korns (10–500ms) |
| **Dichte** | Körner pro Sekunde (1–50) |
| **Pitch** | Pitch-Versatz aller Körner (±24 Halbtöne) |
| **Pitch-Spray** | Zufällige Pitch-Streuung pro Korn (0–200 Cents) |

**Presets:**
- `Cloud`: Weiche Atmo, 200ms Körner, 8/s
- `Shimmer`: Pitch +12, schnelle Rate
- `Texture`: Breite Streuung, Pitch-Spray 50 ¢
- `Stutter`: Sehr kurze Körner (15ms), hohe Dichte
- `Freeze`: Lange Körner, minimale Streuung (statischer Klang)

---

## 15. Beat Slicer

```
┌──────────────────────────────────────────────────────────────┐
│ Beat Slicer  HiHat_Loop.wav  12 Slices  2.34s            [✕] │
├──────────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────────────┐   │
│ │ 1   2   3   4   5   6   7   8  ← Slice-Nummern        │   │
│ │ ▐███░░░░░░█████░░░░░░██░░░░░░░██  ← Waveform Canvas   │   │
│ │ │   │   │   │   │   │   │   │  ← Slice-Marker         │   │
│ └────────────────────────────────────────────────────────┘   │
│ Klick: Marker setzen · Ziehen: Marker verschieben · RC: löschen│
├──────────────────────────────────────────────────────────────┤
│ [16▾] [÷ Gleichmäßig] | Sens: ── 15% [⚡ Transients]        │
│ Warp BPM: [130___] [⊞ Snap]   [→ DrumMachine exportieren]   │
├──────────────────────────────────────────────────────────────┤
│ ▶1 Slice 1  0.195s  [One Shot▾] Rev □   ×                   │
│ ▶2 Slice 2  0.195s  [One Shot▾] Rev □   ×                   │
└──────────────────────────────────────────────────────────────┘
```

### Warp Markers
- **BPM eingeben** → Grid-Linien erscheinen auf der Waveform (Bars + Beats)
- **⊞ Snap** → Neue Marker rasten auf nächsten Beat ein

### Transient Detection
Automatische Marker-Setzung an Einschwingpunkten:
- **Sensitivität** steuert wie sensibel der Algorithmus reagiert (5–50%)
- `⚡ Transients` analysiert den Buffer und setzt Marker

---

## 16. Kollaboration

### LAN-Session erstellen/beitreten
**Tab:** Kollaboration

```
[Session erstellen]     [Session beitreten]
────────────────────────────────────────────
Name: Klaus                    Raum-Code: XKCD
[Session starten]              [Beitreten]
────────────────────────────────────────────
● HOSTING  Raum: ABCD  IP: 192.168.1.5:9001
Teilnehmer (1):
● Klaus (Ich) — Host
● Maria       [Editor ▾] → kann auf Viewer gesetzt werden
[Session beenden]
```

### Splitscreen-Ansicht
Während einer Session erscheint ein Vollbild-Overlay:
```
┌─────────────────────┬────────────────────┐
│  [Ich][Partner][Beide] | Raum: ABCD | ✕  │
├─────────────────────┬────────────────────┤
│   MEIN SEQUENCER    │ PARTNER-SEQUENCER  │
│   (interaktiv)      │ (live-aktualisiert)│
└─────────────────────┴────────────────────┘
│  MEIN SAMPLE BROWSER │ PARTNER-SAMPLES   │
│                      │ Sample.wav  +→ 📥 │
└──────────────────────┴────────────────────┘
```

**`+→` Cross-Session Sample Transfer:** Klick übernimmt Partner-Sample in eigene Library.

### Rollen-System
| Rolle | Rechte |
|------|-------|
| **Host** | Alle Rechte; kann Partner-Rollen setzen |
| **Editor** | Kann Steps togglen, BPM ändern, Pattern wechseln |
| **Viewer** | Nur Lesen (Sequencer ist read-only) |

### Chat
`💬 Chat`-Button in der Toolbar (nur bei aktiver Session):
- Unread-Counter als roter Badge
- Esc = schließen, Enter = senden

### Session Recording
Im Kollaborations-Tab:
```
[● Aufnahme]  [▶ Wiedergabe]  [Löschen]
Events: 247  Dauer: 3:42
```
Alle Collab-Events werden mit Zeitstempel aufgezeichnet und können wiederholt werden.

---

## 17. Einstellungen

Einstellungen-Panel öffnen: **⚙-Button** in der Toolbar (oder `Ctrl+,`).

### Design
10 eingebaute Themes:
| Theme | Beschreibung |
|-------|-------------|
| DarkStudio | Standard — Bernstein + Cyan |
| NeonCircuit | Techno — Cyan + Magenta |
| AnalogHardware | Warm — Orange + Cyan |
| Nacht | Dunkles Lila |
| Sonnenuntergang | Bernstein / Terracotta |
| OLED-Schwarz | Reines Schwarz, maximaler Kontrast |
| Daylight | Helles, neutrales Theme |
| Paper | Warmes, cremefarbenes Hell-Theme |
| Deuteranopia | Barrierefreiheit: Okabe-Ito (dunkel) |
| Protanopia | Barrierefreiheit: Okabe-Ito (hell) |

**Custom Themes:** `+ Eigenes Design erstellen` → 12 CSS-Variablen via Farbwähler definieren.

### KI & API
```
Anthropic API Key: [sk-ant-••••••••••••••]  [Speichern]
✓ API Key aktiv — KI-Generierung verfügbar

Claude Modell: [Claude Haiku 4.5 — schnell & günstig ▾]
```

### Tastatur (Key Bindings)
```
Transport    ──────────────────────────────
Play / Stop         [Space        ] [↺]
Record              [Ctrl+R       ] [↺]
Tap Tempo           [T            ] [↺]
BPM +1              [+            ] [↺]
...
```
Klick auf Taste → Aufnahme-Modus → neue Taste drücken → gespeichert.
`↺` stellt Standard wieder her.

### OSC (Open Sound Control)
```
WebSocket URL: [ws://localhost:8080  ] [Verbinden]
✓ Verbunden

Adress-Mapping:
/synthstudio/play     → Play/Stop
/synthstudio/bpm      float → BPM
/synthstudio/volume/N float → Kanal N Volume
/synthstudio/macro/N  float → Makro N Wert
/synthstudio/scene/N  → Scene N starten
```

### Plugins (ESM)
```
URL: [https://example.com/myplugin.js ] [Laden]

Aktive Plugins:
● MyPlugin v1.0  by Author               ✕
```

---

## 18. MIDI Integration

### MIDI-Eingang
```
Eingabegerät: [Launchpad MK2 ▾]
☑ MIDI Clock Sync (empfange BPM vom Controller)
Externer BPM: 130.0
```

### MIDI-Ausgang (MIDI Out)
```
☑ MIDI Out aktiv (Steps an Hardware-Synth senden)
Ausgangsgerät: [Moog Sub37 ▾]
MIDI-Kanal: [10] ← (10 = GM Drums)
```
Steps werden als MIDI-NoteOn-Nachrichten gesendet (GM Drum Map, Note 36+).
MIDI Clock Output: 24 Pulse/Viertelnote werden an das Output-Gerät gesendet.

### CC-Zuweisungen
30+ bindbare Funktionen:

| Kategorie | Beispiele |
|----------|---------|
| Transport | BPM, Play/Stop, Record, Tap Tempo, BPM±1/±10, Master Volume |
| Parts | Volume/Pan/Mute/Solo pro Kanal |
| Pattern | Next/Prev/Clear/Fill/Randomize/Duplicate |
| Navigation | Tab-Wechsel (alle 6 Tabs) |
| Performance | Note Repeat, Pattern Morph, Live Edit Commit |
| Scenes | Scene 1–8 starten |

**MIDI-Learn:** Klick auf Funktion → MIDI-Signal drücken → automatisch gespeichert.

### Note-Zuweisungen (GM Drum Map)
Note 36 = Kick, 38 = Snare, 42 = Hi-Hat closed, 46 = Hi-Hat open, etc.

### Chord Memory
```
☑ Chord Memory aktiv
Akkord-Typ: [Dur●][Moll][Dim][Aug][Maj7][Min7][Dom7][Dim7][Sus2][Sus4][Add9][Power][Okt]
Lage: [Grundst.●][1. Umk.][2. Umk.]  Spread: [+0][+12][+24]
```
Einzelne MIDI-Note → gesamter Akkord wird gespielt (inkl. MIDI-Out und Audio).

### Launchpad/Grid Controller
Automatisch erkannte Geräte mit 8×8-Grid (Launchpad, Push, APC):
- Erste Reihe (Noten 0–7): Steps 1–8
- Zweite Reihe (Noten 16–23): Steps 9–16
- LED-Feedback: Grün=aktiv, Weiß=Playhead, Aus=inaktiv

### MPE (MIDI Polyphonic Expression)
```
☑ MPE-Modus aktivieren
Pitch-Bend-Bereich: ──────────────────● ±48 Halbtöne
● MIDI Kanal 1 = Global Zone
● Kanäle 2–15 = individuelle Noten-Kanäle
● CC#74 = Timbre/Slide
● Aftertouch = Pressure
```

---

## 19. Tastatur-Shortcuts

### Transport
| Aktion | Taste |
|--------|-------|
| Play / Stop | `Space` |
| Record | `Ctrl+R` |
| Tap Tempo | `T` |
| BPM +1 | `+` |
| BPM −1 | `-` |
| BPM +10 | `Shift++` |
| BPM −10 | `Shift+-` |

### Navigation
| Aktion | Taste |
|--------|-------|
| Tab: Sequencer | `F1` |
| Tab: Mixer | `F2` |
| Tab: Song | `F3` |
| Tab: Humanizer | `F4` |
| Tab: Tools | `F5` |
| Tab: Kollaboration | `F6` |
| Einstellungen öffnen | `Ctrl+,` |
| MIDI-Einstellungen | `Ctrl+M` |
| Shortcuts-Hilfe | `?` |

### Drum Machine Pad-Eingabe
| Reihe | Tasten | Steps |
|-------|--------|-------|
| 1 | `Q W E R T Y U I` | 1–8 |
| 2 | `A S D F G H J K` | 9–16 |
| 3 (32-Step) | `Z X C V B N M ,` | 17–24 |
| 4 (32-Step) | `1 2 3 4 5 6 7 8` | 25–32 |

### Part-Navigation
| Aktion | Taste |
|--------|-------|
| Part hoch | `↑` |
| Part runter | `↓` |
| Part 1–8 direkt | `Ctrl+1` bis `Ctrl+8` |

### Pattern
| Aktion | Taste |
|--------|-------|
| Pattern → | `Ctrl+→` |
| Pattern ← | `Ctrl+←` |
| Duplizieren | `Ctrl+D` |
| Leeren | `Ctrl+Del` |
| Füllen | `Ctrl+F` |
| Randomisieren | `Ctrl+Shift+R` |

### Bearbeiten
| Aktion | Taste |
|--------|-------|
| Rückgängig | `Ctrl+Z` |
| Wiederholen | `Ctrl+Y` |
| Speichern | `Ctrl+S` |

### Performance
| Aktion | Taste |
|--------|-------|
| Note Repeat | `Alt+R` |
| Pattern Morph | `Alt+M` |
| Spectrum Analyzer | `Alt+S` |
| Scene 1–8 | `Shift+1` bis `Shift+8` |

---

## 20. Script Runner & Plugin API

### Script Runner
JavaScript-Automation mit vollem asynchronem Support.

```javascript
// Verfügbare API-Objekte:
ss.bpm(130)              // BPM setzen
ss.play()                // Wiedergabe starten
ss.stop()                // Wiedergabe stoppen
ss.dispatch("play-stop") // kb:action Event dispatchen
ss.log("Nachricht")      // Konsolen-Ausgabe
await ss.wait(500)       // 500ms warten (async)

// Verfügbar: ss.bpmValue, ss.isPlaying
```

**Beispiele:**
```javascript
// BPM Ramp Up (100→140 in 8 Schritten)
for (let i = 0; i < 8; i++) {
  ss.bpm(100 + i * 5);
  await ss.wait(500);
}

// Pattern randomisieren
ss.dispatch("pattern-randomize");

// Euklidischer Rhythmus berechnen
function euclidean(hits, steps) {
  return Array.from({length: steps}, (_,i) =>
    Math.round(i * hits / steps) !== Math.round((i-1) * hits / steps)
  );
}
```

### Plugin API (ESM Module)
```javascript
// plugin.js (ESM Format)
export const meta = {
  name: "BPM Animator",
  version: "1.0",
  author: "Your Name"
};

export function onLoad(api) {
  api.log("Plugin geladen!");

  // Auf jeden Step reagieren
  const unsub = api.onStep((step) => {
    if (step === 0) api.setBpm(130);
    if (step === 8) api.setBpm(140);
  });

  // Cleanup (wird bei Unload aufgerufen)
  return unsub;
}
```

Plugins laden: **Einstellungen → 🧩 Plugins → URL eingeben → Laden**

---

## Polyrhythm Visualizer

```
Polyrhythm — Pattern 1
Kick    ████░░█░░░░░░░░░  16 Steps
Snare   ░░░░█░░░░░░░░█░░  16 Steps
Hi-Hat  █░█░█░█░█░█░█░█░  16 Steps
Perc    ████░░░░████░░░░   8 Steps ← kürzer
FX      ████              4 Steps ← noch kürzer (grau=nicht genutzt)
```

Öffnen: `⬡ Poly`-Button in der DrumMachine-Toolbar.
- Zeigt alle Parts gleichzeitig mit korrekten Längenverhältnissen
- Playhead-Position wird pro Part korrekt berechnet (Modulo-Wrap)

---

---

## 21. Note Length per Step (Sprint 13)

Im **Step Inspector** (Klick auf Step):

```
Note Länge: [1/4] [1/2] [1●] [2] [4]    1× Step
```

| Wert | Beschreibung |
|------|-------------|
| **1/4** | Viertellänge — kurzes Staccato |
| **1/2** | Halbe Step-Länge |
| **1** | Standard (voller Step) |
| **2** | Zwei Steps lang — Legato-Übergang |
| **4** | Vier Steps — lang gehaltene Note |

Für Sample-Parts: kürzere Noten (< 1) werden nach `stepDur × multiplikator` abgeschnitten.
Für Synthesizer-Parts: beeinflusst die ADSR-Release-Phase.

---

## 22. Scale Quantizer (Sprint 13)

Im **Piano Roll** — erscheint wenn Scale Lock aktiv ist:

```
[⚡ Quantize]  ← Alle Noten zur Tonart quantisieren
```

Klick auf `⚡ Quantize`:
- Analysiert alle aktiven Noten im Pattern
- Verschiebt jede Note zur nächsten Tonartnote (kleinste Halbton-Distanz)
- Oktave bleibt erhalten
- Funktioniert mit allen 7 verfügbaren Kirchentonarten

---

## 23. Groove Engine (Sprint 13)

**Humanizer-Tab** → Bereich "Groove Engine (Swing-Vorlagen)":

| Template | Beschreibung | Swing |
|----------|-------------|-------|
| Straight | Maschinell exakt | 50% |
| MPC Classic | Warmer MPC-Swing | 68% |
| TR-909 | Straffer Techno-Swing | 58% |
| Hip-Hop Heavy | Starker Off-Beat Swing | 78% |
| Shuffle | Blues-Feeling (Triolen) | 83% |
| Funk Ghost | Ghost-Notes, Funk-Dynamik | 60% |
| Jazz Ride | Leicht hinter dem Beat | 65% |
| DnB Amen | Drum & Bass Amen-Feel | 52% |

Klick auf Template: setzt **Swing-Wert** entsprechend dem Template.
Timing-Variationen pro Step werden in zukünftigen Versionen als `paramLock.timingOffset` gespeichert.

---

## 24. MIDI Program Change (Sprint 13)

Beim Pattern-Wechsel (Follow Action, manuell, Scene Launch) kann ein **MIDI Program Change (0xC0)** an externe Geräte gesendet werden.

- `AudioEngine.sendPatternProgramChange(patternIndex, channel)` API
- Nützlich um externe Hardware-Synths synchron zu schalten
- Konfiguration über MIDI-Ausgang (Settings → MIDI Geräte)

---

## 25. Custom Metronome Sounds (Sprint 13)

**Einstellungen → 🥁 Metronom:**

```
Lautstärke: ─────────────● 50%

Downbeat-Sound (Erster Schlag):
[WAV laden…]  ← click_high.wav  ✕

Beat-Sound (alle anderen Schläge):
[WAV laden…]  ← click_low.wav   ✕
```

- Eigene WAV/MP3/OGG-Datei als Metronom-Klick
- Separater Sound für Downbeat (1. Schlag) und normale Beats
- Fallback: synthetischer Sinus-Click wenn kein Custom-Sound geladen

---

---

## 26. BPM-Erkennung bei Sample-Import (Sprint 14)

Beim Import von Audio-Dateien (Drag & Drop oder Datei-Dialog) werden automatisch:
1. **Dateinamen analysiert** — erkennt Kick, Snare, Hi-Hat, Loop, etc. und setzt Kategorie
2. **BPM erkannt** — für die ersten 5 Samples (asynchron, kein Blockieren der UI)
3. **Auto-Tags gesetzt** — `kick`, `snare`, `techno`, `house` etc. basierend auf Dateiname + BPM

Die erkannten Tags erscheinen im Sample Browser als Filter-Chips.

---

## 27. Pattern Variations A/B/C/D (Sprint 14)

In der DrumMachine-Toolbar vier Variation-Slots:

```
[A●] [B ] [C ] [D ]   ← A = aktiv/gespeichert (goldfarben)
                         B/C/D = leer (grau, Klick = erstellen)
```

**Workflow:**
1. Pattern bearbeiten → Klick auf `B` → Klon erstellt, in `B` gespeichert
2. Weiter editieren → Klick auf `C` → weiterer Klon in `C`
3. `A` / `B` / `C` klicken = sofortiger Wechsel zwischen Variationen
4. Ideal für: Intro-Variation, Fill, Breakdown, Outro

---

## 28. Arpeggiator-Erweiterungen (Sprint 14)

**5 neue Modi:**

| Modus | Beschreibung |
|-------|-------------|
| Konvergieren | Noten von außen nach innen (Spiegelform) |
| Divergieren | Noten von innen nach außen |
| Eingabe-Reihenfolge | Spielt Noten in der Reihenfolge wie sie gedrückt wurden |

**Velocity-Muster:**
| Muster | Beschreibung |
|--------|-------------|
| Gleichmäßig | Alle Noten gleich laut (90 vel) |
| Betonung 2+4 | Off-Beat-Akzente (Snare-Feeling) |
| Betonung 1+3 | Down-Beat-Akzente |
| Anschwellend | Crescendo (40→127) |
| Abschwellend | Decrescendo (127→40) |
| Zufällig | Pseudo-zufällige Velocity |

---

## 29. Step Probability Chains (Sprint 14)

Im **Step Inspector** → unterer Bereich "Prob Chain (Nächster)":

```
Prob Chain (Nächster): [—●] [+25%] [−25%]
```

- **`—`** (keine Kette): Standard, kein Einfluss auf nächsten Step
- **`+25%`**: Wenn dieser Step spielt → nächster Step +25% Wahrscheinlichkeit
- **`−25%`**: Wenn dieser Step spielt → nächster Step −25% Wahrscheinlichkeit

**Anwendung:**
- Kick spielt → Hi-Hat wahrscheinlicher (+25%): offene Rhythmen
- Snare spielt → Ghost-Note unwahrscheinlicher (−25%): sauberere Patterns
- Ermöglicht organische, voneinander abhängige Step-Sequenzen

---

## 30. Groove Engine Templates (Sprint 14 — Erweiterung)

8 neue Groove-Vorlagen im Humanizer (Bereich "Groove Engine"):

| Template | BPM-Ref | Swing | Beschreibung |
|----------|---------|-------|-------------|
| Straight | 120 | 50% | Maschinell exakt |
| MPC Classic | 90 | 68% | Warmer MPC-Groove |
| TR-909 | 130 | 58% | Techno-Swing |
| Hip-Hop Heavy | 90 | 78% | Starker Offbeat |
| Shuffle | 100 | 83% | Blues-Triolen |
| Funk Ghost | 100 | 60% | Ghost-Notes |
| Jazz Ride | 120 | 65% | Hinter dem Beat |
| DnB Amen | 174 | 52% | Break-Feel |

---

*Dieses Handbuch wird bei jeder neuen Phase automatisch erweitert.*
*Letzte Aktualisierung: Sprint 14 — v1.14*

---

## 31. Auto-Save Ein-/Ausschalten (Sprint 15)

**Einstellungen → 💾 Speichern:**

- **Auto-Save AN/AUS**: Browser-Cache-Speicherung de-/aktivieren
- **Intervall**: 1 / 3 / 5 / 10 / 15 Minuten wählbar (Standard: 3 Min)
- **Version-Snapshots AN/AUS**: 5-Minuten-Checkpoints de-/aktivieren

**Hinweis:** Auto-Save speichert im localStorage, kein echter Datei-Export. Ctrl+S für .synth-Datei.

---

## 32. Micro-Timing pro Kanal (Sprint 15)

Status-Leiste der DrumMachine (bei aktivem Kanal): `μT: ─────● +12ms x`

- Bereich: -50ms (vor dem Beat) bis +50ms (hinter dem Beat)
- Ermöglicht organisches Groove-Feeling pro Kanal
- Beispiel: Kick -5ms + Hi-Hat +8ms = natürlicher Swing

---

## 33. MIDI-Bundle-Export (Sprint 15)

Mixer-Tab → Export: `[🎵 MIDI Export]`

- Alle Patterns als Standard MIDI Format 1 (.mid)
- Jedes Pattern = eigener Track, Parts auf Kanal 10 (GM Drums)
- GM-Note-Mapping: Kick=36, Snare=38, Hi-Hat=42, etc.
- Kompatibel mit Ableton, FL Studio, Logic, Cubase

---

## 34. Multi-Sample Mode (Keyboard Sampler) (v1.15.0)

**Tools-Tab → 🎹 Sampler**

Erlaubt das Mappen mehrerer Samples auf MIDI-Noten mit Velocity-Zonen – ideal für Multi-Sample-Instrumente (Piano, Strings, Drum-Layers).

**Workflow:**
1. Sample aus dem Sample-Browser auf eine Klaviatur-Taste ziehen → erstellt automatisch eine Zone (loNote = Note − 6, hiNote = Note + 6, rootNote = gedrückte Note)
2. Oder: Sample im Dropdown auswählen + Lo/Hi/Root manuell setzen + "+ Zone"-Button
3. "Aktiv"-Checkbox einschalten → MIDI-Note-On-Events werden an die Sampler-Engine geroutet
4. Maustaste auf Klaviatur-Tasten klicken → Sample-Preview

**Zone-Parameter:**
- **loNote / hiNote**: MIDI-Note-Bereich (0–127) in dem die Zone aktiv ist
- **rootNote**: Originaltonhöhe → für andere Noten wird `playbackRate = 2^((note - root) / 12)` berechnet
- **loVelocity / hiVelocity**: Velocity-Layer (z.B. soft 0–63 / hard 64–127 für Velocity-Layered Drums)
- **volume / pan**: Mix-Parameter

**Audio-Engine-API**:
`AudioEngine.triggerKeyboardSamplerNote(note, velocity)` wird automatisch vom MIDI-Hook aufgerufen wenn der Sampler aktiv ist.

---

## 35. Envelope Follower (v1.15.0)

**Sequencer-Tab → ∿ EF Button** (Toolbar)

Verwendet den Audio-Level eines Kanals als Modulations-Quelle für andere Kanal-Parameter – klassischer Sidechain-Effekt + kreative Routing-Möglichkeiten.

**Beispiel-Routings:**
- Kick → Bass-Volume = klassisches Pumping ohne Sidechain-Kompressor
- Snare → FX-Filter-Cutoff = "Schnaufen" auf Snare
- Hi-Hat → Reverb-Send = mehr Hall auf jeden Hi-Hat-Hit

**Konfiguration:**
| Parameter | Beschreibung |
|---|---|
| **Quelle** | Part dessen Audio-Level analysiert wird |
| **Ziel** | Part der moduliert wird |
| **Parameter** | Volume / Pan / Filter-Freq / Reverb-Mix / Delay-Mix |
| **Menge** | 0–1 (Stärke der Modulation) |
| **Attack** | 1–500 ms (wie schnell Follower auf Level-Anstieg reagiert) |
| **Release** | 10–2000 ms (wie schnell Follower abfällt) |

**Live-Level-Meter** zeigt aktuellen RMS-Pegel der Quelle.

---

## 36. Time-Stretch (Pitch-erhaltend) (v1.15.0)

**Sequencer → Part auswählen → Footer-Toolbar → Stretch-Slider**

Echtes pitch-preserving Time-Stretch via OLA-Algorithmus (Overlap-Add). Sample-Länge wird gestreckt ohne die Tonhöhe zu ändern.

- **Range**: 0.25× (4× schneller) bis 4.0× (4× langsamer)
- **Default**: 1.0× (Original)
- Klick auf den Slider-Wert → Reset auf 1.0
- Stretch-Buffer werden gecached (kein Re-Computing bei jedem Step)

**Implementierung**: Per-Buffer offline OLA mit 2048-Sample Grains + 512-Sample Hop + Hann-Window. AudioWorklet-Variante (`TimeStretchProcessor.js`) für Realtime-Streaming verfügbar.

**Hinweis**: Sample muss zugewiesen sein – funktioniert nicht mit Synth-Sources.

---

## 37. Public Relay Server (WAN-Kollaboration) (v1.15.0)

**Kollaboration-Tab → WAN Relay Panel**

Ermöglicht Kollaboration über das Internet ohne LAN/VPN – nutzt einen WebSocket-Relay-Server zwischen den Clients.

**Setup:**
1. **Eigenen Relay-Server starten** (auf einem öffentlich erreichbaren Host):
   ```bash
   PORT=8080 npx ts-node server/relay.ts
   ```
2. **In der App**: Kollaboration-Tab → WAN Relay → Server-URL (z.B. `ws://relay.example.com:8080`) + Name → "Verbinden"
3. Nach Verbindung: "+ Neuen Room erstellen" oder "Beitreten" mit Room-Code

**Protokoll** (identisch mit LAN-Collab):
- `create`, `join`, `event`, `ping`
- Server broadcasted Events an alle Room-Teilnehmer außer Sender
- Room expiriert nach 1 Stunde Inaktivität

**Sicherheit**: Aktuell keine Auth – Room-Codes sind 6 Zeichen (32^6 ≈ 1 Mrd. Kombinationen). Für sensible Projekte selbst-gehostet betreiben.

---

## 38. Audio Workbench (Audacity-like) (v1.15.0)

**Tools-Tab → 🎚 Workbench**

Audio-Bearbeitungs-Werkzeug für Songs, Samples und Aufnahmen – ähnlich Audacity, inkl. **Frequenz-Band-Stem-Separator**.

### 38.1 Import + Aufnahme
- **Drag & Drop**: Audio-Datei (WAV/MP3/OGG/FLAC) auf den Drop-Zone ziehen
- **Datei-Picker**: Klick auf die Drop-Zone öffnet den nativen Datei-Dialog
- **Mikrofon-Aufnahme**: `● Aufnehmen` Button → Live-VU-Meter → `■ Stop`

### 38.2 Edit-Tools (Audacity-Style)
| Tool | Funktion |
|---|---|
| **✂ Trim** | Ausschnitt zwischen Start- und End-Sekunde behalten |
| **↩ Reverse** | Audio rückwärts |
| **📈 Normalize** | Auf Peak = 1.0 normalisieren |
| **↗ Fade In** | 500ms Einblenden am Anfang |
| **↘ Fade Out** | 500ms Ausblenden am Ende |
| **−6 dB / +6 dB** | Halbe / doppelte Lautstärke |

Peak + Dauer + Sample-Rate werden live unter der Waveform angezeigt.

### 38.3 Frequenz-Stem-Separator
"🎚 Frequenz-Stems trennen" teilt das Audio in 4 Bänder via OfflineAudioContext:

| Band | Frequenzbereich | Typischer Inhalt |
|---|---|---|
| **Sub-Bass** | < 80 Hz | Kick-Fundament |
| **Bass** | 80–250 Hz | Bass-Lines |
| **Mid** | 250 Hz – 4 kHz | Vocals, Synths |
| **High** | > 4 kHz | Hi-Hats, Luft, Cymbals |

Jeder Stem hat einen Preview-Player + "+ Sample"-Button zum Hinzufügen ins Projekt.

**Bearbeitetes Audio exportieren**: `💾 Als Sample exportieren` → konvertiert den aktuellen Buffer zu WAV und fügt ihn dem Sample-Browser hinzu.

---

## 39. Performance Mode Button (v1.15.4)

**Tab-Bar oben rechts → ⚡ Performance Mode**

Öffnet ein **Vollbild-Pattern-Launchpad** mit großen Pads für jedes Pattern – ideal für Live-Performance mit Touchscreen oder MIDI-Controller.

**Features:**
- 4×4 oder 8×8 Pad-Grid (abhängig von der Anzahl Patterns)
- **Quantisierte Pattern-Wechsel**: Wechsel passiert erst auf Bar/Beat/Step-Grenze (umschaltbar)
- **Queued Pattern Indikator**: Nächster Pattern wird optisch hervorgehoben bis der Wechsel triggert
- **ESC** schließt den Performance Mode

**Tastatur-Shortcut**: `F12` (über useKeyboardShortcuts-Mapping)

---

## 40. MIDI-Hardware-Templates (v1.15.0)

**Settings → MIDI → Vorlagen**

Vordefinierte CC- und Note-Mappings für **8 gängige Hardware-Controller**:

| Controller | Layout |
|---|---|
| **Novation Launchpad MK2/MK3** | 8×8 Pad-Grid + Transport (CC 104–111) |
| **Ableton Push 2** | 8 Encoder (Volume) + Top-Row Transport |
| **Akai MPC One / Live** | 4×4 Pads + 4 Q-Link Knobs |
| **NI Maschine Mikro MK3** | 16 Pads + Footer-Transport |
| **Korg nanoKONTROL2** | 8 Slider/Knob/Mute/Solo (Mixer-Kontrolle) |
| **Akai MPK Mini MK3** | 25-Key Keyboard + 8 Pads + 8 Knobs |
| **Behringer X-Touch Mini** | 8 Encoder + Slider + 16 Buttons |
| **Korg padKONTROL** | 16 Pads + 2 Encoder |

**Workflow:**
1. Settings → MIDI → "Vorlagen"-Tab
2. Karte für das eigene Gerät auswählen → "Laden"
3. Bestätigungs-Dialog → alle bestehenden Mappings werden **überschrieben**
4. Part-IDs werden automatisch auf die ersten N Drum-Parts des aktuellen Patterns gemappt

---

## 41. Projekt-Import (v1.15.0)

**Toolbar → Import…** (neben Speichern/Öffnen)

Importiert Projekte aus anderen DAWs:

| Format | Endung | Was wird extrahiert |
|---|---|---|
| **FL Studio** | `.flp` | BPM, Pattern-Namen, Master-Tempo |
| **Ableton Live** | `.als` | BPM, MIDI-Clips, Drum-Notes (Velocity), Track-Namen |
| **KORG Electribe** | `.esx`, `.elst`, `.e2spat`, `.e2sallpat` | BPM (heuristisch), Pattern-Namen, Drum-Slot-Templates |

**Funktionsweise:**
- Datei via Datei-Picker auswählen
- Parser extrahiert verfügbare Daten (Format-spezifisch unterschiedlich)
- Bestätigungs-Dialog zeigt Anzahl Patterns + Warnungen
- Patterns werden zur aktiven Drum Machine hinzugefügt; BPM aus dem ersten Pattern übernommen

**Einschränkungen:**
- FL Studio: Step-Daten werden noch nicht extrahiert (nur Metadata)
- Ableton: Audio-Clips, Plugins, Automation werden nicht importiert
- Electribe: Step-Daten ohne offizielle Spec nur heuristisch – Pattern-Templates müssen manuell befüllt werden

---

## 42. KI-Projekt-Analyse (v1.15.0)

**Sequencer → Mix-Assistant-Panel → 🤖 KI-Analyse**

Sendet einen strukturierten Snapshot des aktuellen Patterns (BPM, Parts, Volumes, aktive Steps) an die **Anthropic API** und liefert natürlich-sprachliche Verbesserungs-Vorschläge zurück – auf Deutsch.

**Voraussetzung**: Anthropic API-Key in Settings → KI & API hinterlegen.

**Output-Format:**
- **Summary**: 1–2 Sätze Gesamtbewertung
- **Bis zu 5 Recommendations** mit:
  - Severity (Critical / Warning / Info)
  - Titel
  - Konkreter Detail-Text
  - Optional: Betroffener Part

**System-Prompt fokussiert auf** Frequenz-Balance, Mix-Lautstärken, Pattern-Dichte, FX-Übernutzung, Genre-spezifische Tipps (BPM-basiert: 140+ = Hardtekk-Tendenz, etc.).

**Kosten**: Ein Aufruf nutzt ~500–1000 Tokens (etwa 0.005–0.01 USD bei Claude Sonnet).

---

## 43. Audio Tracks (v1.16.0)

**Mixer → Header → `[+ Audio Track]`** (alternativ: Drag&Drop einer Audio-Datei auf die Mixer-Channel-Area)

Lädt externe Audio-Dateien (Vocals, fertige Songs zum Remixen, Loops) als vollwertige Mixer-Channels mit kompletter FX-Kette. Audio-Tracks laufen synchron zum Master-Transport (Play/Stop) und werden mit den gleichen FX-Slots wie Drum-Parts gerendert: EQ, Filter, EQ16, Inserts, Sends auf den globalen Reverb- und Delay-Bus.

### Unterstützte Formate
`.wav`, `.mp3`, `.ogg`, `.flac`, `.aif`, `.aiff`, `.m4a`

### Channel-Strip Layout
```
┌─────────────────┐
│  ✎ Vocal Take 3 │  ← editierbar (Doppelklick), [×] zum Entfernen
├─────────────────┤
│ ▁▃▅▂▄▆▃▁▄▅ ▶  │  ← Mini-Waveform mit Playhead (Klick = Seek)
├─────────────────┤
│ [⚠ Relocate…]  │  ← nur sichtbar wenn Datei nicht gefunden
├─────────────────┤
│ Fader │ Pan    │
│  M │ S        │
├─────────────────┤
│ Sync: Free  ▾  │  ← Free | Stretch (Pitch+Tempo)
│ Reverb ◯ Delay │
└─────────────────┘
```

### Limits
- **Maximal 8 Audio-Tracks pro Projekt** (Memory-Schutz: eine 5-Minuten-Stereo-WAV ≈ 50 MB im RAM dekodiert). Der `[+ Audio Track]`-Button wird grau, sobald das Limit erreicht ist.

### BPM-Sync-Modus
| Modus | Verhalten | Wann verwenden |
|---|---|---|
| **Free** *(default)* | Track läuft im Original-Tempo. BPM-Änderung im Projekt hat **keinen** Einfluss. | Vocals, gesprochenes Audio, alles wo natürliches Timing wichtig ist |
| **Stretch (Pitch+Tempo)** | `playbackRate = currentBpm / originalBpm`. Track passt sich Master-BPM an, **ändert aber gekoppelt auch die Tonhöhe**. | Loops, Drumbreaks, klassischer DJ-Pitch-Effekt, wenn Original-BPM bekannt ist |
| **Time-Stretch (Pitch erhalten)** *(v1.19.0)* | OLA-AudioWorklet `time-stretch-processor` setzt `stretchRatio = currentBpm / originalBpm`. Tempo folgt Master-BPM, **Pitch bleibt erhalten**. Stereo-fähig mit synchroner Phase. | Vocals, fertige Songs zum Remixen, melodisches Material |

**Time-Stretch Limits (v1.19.0):**
- Max **4 gleichzeitige Time-Stretch-Tracks** pro Projekt (CPU-Schutz — OLA ist ~3-5× teurer als `playbackRate`). Bei Limit: Dropdown-Option `disabled` mit Tooltip.
- Quality-Badge `⚠ Extreme Ratio — Artefakte möglich` erscheint bei `|currentBpm/originalBpm − 1| > 0.5` (also <0.5× oder >1.5× Original-Tempo).
- Browser-Compat: Feature-Detection auf `ctx.audioWorklet` — auf nicht-unterstützten Browsern (Safari < 14.5) wird die Option `disabled`.

### Solo-Verhalten *(v1.19.0)*
Solo wirkt jetzt **Mixer-übergreifend** — sobald min. ein Channel (Drum-Part **oder** Audio-Track) soloed ist, sind alle nicht-soloed Channels (beider Typen) stumm. Vorher (v1.16-v1.18): Drum-Solo mutete nur andere Drums, Audio-Solo nur andere Audios. Jetzt einheitlich. *Implementation: Cross-Subscription via `AudioEngine.setDrumSoloFlagGetter()` + `notifyDrumSoloChanged()` — kein neuer Store, keine `.synth`-Schema-Änderung.*

### Persistenz im `.synth`-Format
Audio-Tracks werden als **Pfad-Referenzen** im Projekt gespeichert (kein Embed der Audio-Datei). Eine `.synth`-Datei bleibt klein, auch wenn ein 10-Minuten-Song als Audio-Track verwendet wird.

**Bei Projekt-Laden:**
- **Desktop (Electron)**: Synthstudio prüft jeden Pfad. Fehlende Dateien markieren den Channel als *broken* mit rotem Banner und `[Relocate…]`-Button → File-Picker → Pfad wird aktualisiert.
- **Browser**: Browser können gespeicherte Pfade nicht prüfen. Alle Audio-Tracks werden beim Öffnen als *broken* markiert; der User wählt sie pro Channel über `[Relocate…]` neu.

Der Relocate-Flow ist **non-blocking**: das Projekt öffnet sofort, broken Channels bleiben stumm bis der User reagiert. Andere Teile des Projekts sind sofort spielbar.

### Browser-Warnung beim Speichern
Beim ersten Speichern eines Projekts mit Audio-Tracks im Web-Mode erscheint ein einmaliger Hinweis-Dialog:
> *„Audio-Tracks werden als Datei-Referenzen gespeichert. Beim erneuten Öffnen im Browser musst du die Audiodatei neu wählen. In der Desktop-Version werden absolute Pfade gespeichert."*

Mit *„OK, nicht mehr zeigen"* dauerhaft ausblendbar (`localStorage`).

### Solo-Verhalten
Audio-Track-Solo wirkt **nur innerhalb der Audio-Tracks** — Drum-Parts laufen weiter, wenn ein Audio-Track auf Solo geschaltet wird. Cross-Store-Solo (Drum + Audio gemeinsam mute/solo) ist als Follow-up für v1.16.x geplant.

### Drag & Drop
Audio-Dateien können direkt auf die Mixer-Channel-Area gezogen werden — jede Datei wird zu einem neuen Audio-Track (statt zum Sample-Slot wie beim Sample-Browser-Drop).

---

## 44. Persistente Scripts + Web-Worker-Sandbox (v1.17.0)

**Tools-Tab (F5) → Script Runner**

Scripts werden jetzt **dauerhaft gespeichert**, lassen sich an Tastatur-Shortcuts oder Macro-Knöpfe binden und laufen in einer **isolierten Web-Worker-Sandbox** — fremder Skript-Code kann nicht mehr auf Dateisystem, Netzwerk oder Electron-APIs zugreifen.

### Layout
```
┌──────────────┬──────────────────────────────────────────┐
│ Scripts (5)  │ ▶ Ausführen   ⏹ Abbrechen               │
│ ────────────│ Name: [Drop Hit Trigger    ] [Save]       │
│ • BPM Ramp🔑│ ☑ Aktiviert   Scope: ◉ App  ○ Projekt   │
│ • Drop Hit🔑│ Keyboard: [Ctrl+Shift+B] ✏ ✖              │
│ • Random M3 │ Macro-Slot: [Slot 3 ▾]                   │
│              │ ┌────────────────────────────────────┐   │
│ Beispiele ▾  │ │ // Code (max 10 KB)                 │   │
│              │ └────────────────────────────────────┘   │
│              │ Konsole:                                  │
│              │  → BPM: 100                               │
│              │  ✓ erfolgreich (1.2s)                     │
└──────────────┴──────────────────────────────────────────┘
```

### Persistierung — Scope-Wahl pro Script
| Scope | Speicherort | Wann verwenden |
|---|---|---|
| **App** *(default)* | `localStorage` — gilt für alle Projekte | Dein Werkzeugkasten: BPM-Ramps, Pattern-Randomizer, Live-Tools |
| **Projekt** | im `.synth`-File eingebettet | Live-Performance-Setups, Track-spezifische Drop-Hits |

- **Maximal 64 Scripts** insgesamt, **maximal 10 KB Code** pro Script
- Fremde `.synth`-Dateien laden alle Scripts **deaktiviert** — du musst sie pro Script explizit aktivieren (Schutz vor bösartigen Snippets aus dem Internet)

### Eingebaute Beispiele (Beispiele-Dropdown)
- **BPM Ramp Up** — fährt BPM von 100 auf 140 in 5er-Schritten hoch
- **Random Pattern Fill** — triggert `pattern-randomize` Action
- **Drop Hit** — stoppt Transport, wartet 500ms, startet wieder

### Script-API (`ss.*`)
**Breaking Change v1.17.0:** Die API ist jetzt **asynchron**. Jeder Call braucht `await`:

| Methode | Wirkung |
|---|---|
| `await ss.bpm(value)` | BPM setzen (geclamped 20–300) |
| `await ss.play()` / `await ss.stop()` | Transport-Steuerung |
| `await ss.setStep(partId, stepIdx, on)` | Einzelnen Step toggeln |
| `await ss.dispatch(action)` | Action triggern (Whitelist: nur Transport- und Pattern-Actions) |
| `await ss.log(msg)` | In Script-Konsole loggen (max 500 Zeichen pro Eintrag) |
| `await ss.wait(ms)` | Pause (0–60000ms) |
| `await ss.getMacro(idx)` / `await ss.setMacro(idx, v)` | Macro-Werte lesen/setzen (idx 0–7, v 0–1) |
| `ss.random()` / `ss.now()` | Worker-lokal, kein await nötig |

**Erlaubte Dispatch-Actions:** `play-stop`, `record`, `tap-tempo`, `bpm-up/down/up-10/down-10`, `pattern-next/prev/duplicate/clear/fill/randomize`, `part-up/down`, `velocity-mode`, `pitch-mode`. Alles andere (insb. `save`, `load`, `open-*`) wird vom Sandbox-Bridge abgelehnt.

### Bindings
| Trigger | Konfiguration |
|---|---|
| **Tastatur-Shortcut** | Recording-Modal im Script-Editor. Konflikte mit System-Actions werden angezeigt; bei Doppel-Belegung gewinnt die System-Action |
| **Macro-Button** | `MacroPanel → ⚙ → Mode: Button → Script-Dropdown`. Der Macro-Slot zeigt dann einen klickbaren Trigger-Button mit Script-Name + Macro-Farbe |

Ein Script kann gleichzeitig an Tastatur *und* Macro-Slot gebunden sein. `enabled: false` deaktiviert beides ohne das Script zu löschen.

### Sicherheits-Architektur
Die Sandbox basiert auf **10 Hardening-Layern** (siehe `docs/SECURITY-SCRIPT-SANDBOX.md` für Details):

1. **Web Worker via Blob-URL** — eigener Thread, kein DOM, kein `window`, kein `electronAPI`
2. **16 gefährliche Globals neutralisiert** im Worker (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `indexedDB`, `caches`, `importScripts`, `Worker`, `SharedWorker`, `BroadcastChannel`, `Notification`, `RTCPeerConnection`, `RTCDataChannel`, `navigator`, `clients`, `postMessage`)
3. **Allowlist-Bridge** (default deny) — nur die `ss.*`-Methoden sind erreichbar
4. **Dispatch-Whitelist** — keine UI-Hijack-Actions, kein File-Save aus Script
5. **Param-Clamping** — BPM 20–300, Macro 0–1, etc.
6. **Wall-Clock-Timeout** — `while(true){}` wird nach `maxRuntimeMs` (default 5000ms) hart terminiert; UI bleibt responsive
7. **Prototype-Chain-Hardening** — verhindert `WorkerGlobalScope.prototype.postMessage`-Bypass
8. **`Object.freeze(ss)`** — Script kann Bridge-Methoden nicht ersetzen
9. **Log-Rate-Limit** — max 100 logs / 200ms; Overflow wird gedroppt + summarisiert
10. **Foreign-Project-Consent** — alle Scripts aus geladenen `.synth`-Files sind initial `enabled: false`

**Caveat:** Electron-Production hat aktuell keinen expliziten CSP-Header. Für v1.18 dokumentiert.

### Read-Only-Übersicht der Script-Bindings
`Settings → Keyboard Bindings → Scripts-Sektion` listet alle Script-Tastaturbindings (egal welcher Scope). Klick → springt zum Tools-Tab und selektiert das Script.

---

## v1.18.3: Theme-Refactor (FOLLOWUP-110) + Daylight/Paper Token-Fix

`MixerView.tsx` und `ElectronTitleBar.tsx` hatten **22 hardcoded Tailwind-Farben** (`bg-cyan-950`, `bg-yellow-500`, `bg-orange-600`, `text-slate-900`, `bg-[#0d0d0d]`, `hover:bg-slate-700`, `hover:bg-red-600` u.a.) die in den 10 Themes nicht auf `--ss-*`-Variablen reagierten — z.B. blieb der Mute-Button auch in Sonnenuntergang/OLED-Schwarz orange.

**Fix:** alle 22 Klassen auf semantische Tokens ersetzt (`bg-accent-secondary`, `bg-accent-danger`, `text-text-muted` usw.). Mute/Solo-Konvention zwischen `MixerView` und `ChannelStrip` vereinheitlicht.

**Bonus-Fix:** `daylight` und `paper` Themes hatten die Tokens `--ss-accent-success` und `--ss-accent-danger` **nicht definiert** (pre-existing Bug, wurde durch den Refactor sichtbar). Beide Themes ergänzt mit theme-passenden Grün- und Rot-Werten:
- `daylight`: `--ss-accent-success: #16a34a; --ss-accent-danger: #dc2626;`
- `paper`: `--ss-accent-success: #15803d; --ss-accent-danger: #b91c1c;`

7 neue Tests in `tests/features/theme-class-purity.test.ts` verifizieren via Regex über Source-Files dass keine hardcoded Tailwind-Color-Klassen mehr in MixerView/ElectronTitleBar drin sind.

**Sonderfall:** Ein `<rect fill="#0d0d0d">` in der `ElectronTitleBar` SVG-Restore-Icon-Maske bleibt erhalten — SVG `fill`-Attribute resolven keine CSS-Variablen. Im Code kommentiert.

---

## v1.18.2: BUG-002 BPM-Button-Feedback

**BPM +/- Buttons im DrumMachine-Header gaben kein sichtbares Klick-Feedback.** Die `onClick`-Handler funktionieren seit v1.6.0 — der Bug war subtiler: `hover:bg-bg-elevated` war die **gleiche Farbe** wie der default `bg-bg-elevated` Background. User klickten, sahen keinerlei visuelle Reaktion und nahmen an die Buttons seien nur dekorative Indikatoren für die `+`/`−`-Tastatur-Shortcuts.

**Fix:** Hover wechselt jetzt zu `bg-base` (dunkler) + Text zu `text-primary` (heller). `active:scale-95` macht den Click spürbar. Zusätzlich `title="BPM ±1 (Taste: ±)"` + `aria-label` für Accessibility. 5 Playwright-Regressions-Tests in `tests/web/bpm-buttons.spec.ts` verifizieren Hover-BG-Change, onClick-Funktionalität und Tooltip-Text.

---

## v1.18.1: TASK-101 Layout-Fix (BUG-008)

**Doppelte Header + doppelte Close-Buttons auf DrumMachine Floating-Panels** (Pattern Morph, Note Repeat, Envelope Follower, Macros, Granular, Polyrhythm). Der `ResizableDrumPanel`-Wrapper renderte einen Header mit Close-Button, gleichzeitig hatten die inneren Panels (z.B. `NoteRepeatPanel`, `PatternMorphPanel`) ihren eigenen Header + Close-Button → zwei "PATTERN MORPH"-Texte und zwei `×`-Buttons übereinander.

**Fix:** `title`-Prop wird auf `ResizableDrumPanel` nicht mehr gesetzt, `onClose` der inneren Panels wird entfernt. Der äußere Wrapper-Close übernimmt. Multi-Viewport-Sweep (1920×1080, 1366×768, 1280×720) bestätigt: 0 horizontale Overflows, alle Tabs/Panels sauber.

7 neue Playwright-Regressions-Tests in `tests/web/layout-double-header.spec.ts` + 21 Multi-Viewport-Sweep-Tests in `tests/web/layout-sweep.spec.ts`.

---

## v1.22.0: LFO-Macros + Hold-Mode + Pad-Theme + Polish-Welle

Sechs parallele Verbesserungen in drei Wellen:

**TASK-117 — LFO-Macros wiring (backend).** `SynthEngine.setPartLfoRate(partId, hz)` und `setPartLfoDepth(partId, depth)` Setter mit Cache-Variant (`_partLfoCache` Map). Beim nächsten `triggerNote` werden cached values applied (Sub-Step-Latenz). Range-Clamping: Rate 0.01–30 Hz, Depth 0–1. App.tsx Macro-Setter-Bag erweitert um `setLfoRate` / `setLfoDepth`. Die `lfo-rate` / `lfo-depth` Macro-Bindings warnten seit v1.15.5 nur `console.warn` — jetzt voll funktional. 26 SynthEngine-Tests + 5 Macro-Tests.

**TASK-118 — Macro-Button Hold-Mode (frontend).** Schema-Erweiterung `triggerMode: "edge" | "hold"`. Im Hold-Mode läuft das Script in einer 200ms-Loop solange Button gedrückt (100ms für Pad-Trigger). `client/src/utils/macroHoldLoop.ts` neue Pure-Logik mit Module-Scope-State + Stacking-Schutz (pro Macro nur eine Loop). `triggerMacroButtonRelease` Event stoppt die Loop. `🔁`-Icon-Overlay im Hold-Macro-Button. 24 neue Macro-Tests (99 total).

**TASK-119 — Theme-aware Pad-Color-Palette (frontend).** 16 hardcoded Hex-Werte in `PAD_COLORS` ersetzt durch 8 CSS-Variablen `--ss-pad-1..8` definiert pro Theme. `getPadDefaultColor(index)` Helper liest live aus `getComputedStyle(document.documentElement).getPropertyValue("--ss-pad-N")`. Pad-Index mod-loop 0..15 → Slot 0..7. User-defined `pad.color` bleibt absoluter Vorrang. Pro Theme passende Farb-Identität: dark/neon hochgesättigt, daylight/paper pastel-soft, deuteranopia/protanopia Okabe-Ito a11y-Palette.

**TASK-120 — Mouse-Box Rubber-Band-Select (frontend).** In Reorder-Mode startet `mousedown` auf Grid-Background eine Selection-Box. `mousemove` zeichnet semi-transparent Box. `mouseup` selektiert alle Pads mit non-empty `patternId` deren Bounding-Box intersected. Shift+Drag additiv zur existing selection. 3px-Hysterese gegen accidental clicks.

**TASK-123 — Multi-Drag-Image Counter-Badge (frontend).** Bei `multiSelect.size > 1` während Drag: programmatisch erzeugtes 60×60 `<canvas>` mit Pad-Color + Border (live aus `--ss-accent-secondary`) + zentriertem `+N`-Text als Drag-Image via `dataTransfer.setDragImage(canvas, 30, 30)`. 24 Unit-Tests (DOM-frei) für `normalizeBox`/`boxIntersects`/`collectPadsInBox` Helpers.

**TASK-121 — MAX_TIMESTRETCH_TRACKS UX-Warnung (frontend).** Counter im MixerView-Header `Time-Stretch: N/4` mit drei-Stufen-Farblogik: neutral / gelb (3 = bald limit) / rot (4 = limit). Info-Banner im AudioTrackStrip wenn Limit erreicht + current Track NICHT bereits timestretch + AudioWorklet supported: `⚠ Max 4 Time-Stretch-Tracks (CPU). Frei für diesen Track: Free/Stretch.` `isTimestretchLimitReached()` Helper exportiert. 5 Unit + 4 Playwright Tests.

**TASK-122 — Final Theme-Class-Purity Sweep (refactor).** 85 hardcoded Tailwind palette-Klassen in 15 Komponenten ersetzt (`UpdateBadge`, `Humanizer`, `MidiSettings`, `SongTimeline`, `ElectronDropZone`, `MixAssistantPanel`, `CollabSplitView`, `ThemeSettings`, `DrumMachine`, `ProjectManager`, `NewProjectDialog`, `CollabStatus`, `ModMatrix`, `EuclideanControls`, `StepContextMenu`). Categorical Palettes (SongTimeline Bank A-D, ElectronDropZone Drop-Types, MixAssistantPanel Severities) auf die 4 verfügbaren Akzente gemappt mit Doku-Kommentar. `Humanizer.HumanizerSlider`-API refactored von dynamic `text-${color}-400` (Tailwind-JIT-incompatible) auf typed `accent` Prop mit static lookup table. Test-Helper `expectNoHardcodedTailwindColors(path)` registriert 2 Tests pro Datei (palette + arbitrary-hex). **Zero hardcoded Tailwind palette classes** in `client/src/components/**/*.tsx` + `electron/components/**/*.tsx` jetzt CI-enforced.

**Test-Wachstum diese Welle:** 1106 → 1220 (+114 Vitest-Tests, dazu Playwright). Insgesamt 63 Test-Files.

---

## v1.21.0: Macro→Pad + Performance a11y + Theme + CI-Drift-Check

Vier parallele Verbesserungen:

**TASK-112 — Macro-Buttons können jetzt Performance-Pads triggern.** Im `MacroPanel` BindingEditor im Button-Mode gibt es einen Toggle "Trigger: [Script] [Pad]". Bei `Pad` wählst du einen der 16 Slots aus dem Performance-Mode. Klick auf den Macro-Button macht einen sofortigen `setActivePattern` + `queuePerformancePattern` (identisches Verhalten wie Performance-Pad-Click). Trigger-Schema-Migration für v1.17-Daten ist tolerant — alte `scriptId`-only Macros funktionieren weiter (default `triggerKind: "script"`). 70 Macro-Tests (+22 neu).

**TASK-114 — Performance-Pads sind jetzt a11y-tauglich + multi-select-fähig.** WAI-ARIA Pattern: `role="grid"` + 16 `gridcell`-Pads mit Roving-Tabindex. Pfeiltasten navigieren. Im Reorder-Mode: `Space`/`Enter` "greift" das fokussierte Pad, Pfeile verschieben, `Space` dropt, `Escape` bricht ab. `aria-live="polite"` Region kommuniziert Aktionen an Screen-Reader. Multi-Select via `Shift`/`Ctrl`/`Cmd+Click` markiert Pads visuell (`ring-accent-secondary`); Drag eines selected-Pads zieht alle in der Auswahl mit (Insert-Semantik via `moveMultiplePads`). 49 Store-Tests (+11) + 22 Playwright-Tests (+13).

**TASK-113 — SampleBrowser Theme-Refactor.** 37 hardcoded Tailwind-Farben in `SampleBrowser.tsx` + `AudioInputRecorder.tsx` ersetzt durch semantische `--ss-*` Tokens. Drum-Kategorien mappen 9 Original-Farben auf 4 verfügbare semantische Akzente — primäre Differenzierung bleibt via 3-Buchstaben-Labels + Emojis. `placeholder-slate-600` (Tailwind-v2-Syntax, war seit v4-Migration kaputt) auf `placeholder:text-text-dim` korrigiert.

**TASK-115 — CI enforced sandbox-runtime drift.** `.github/workflows/ci.yml` bekommt einen Step vor `pnpm check`: `pnpm gen:sandbox && git diff --exit-code client/src/sandbox/sandbox-runtime.generated.ts`. Vergessenes `gen:sandbox` lokal wird jetzt im CI gefangen statt erst Audio-Sandbox-Verhalten zu brechen. Drei-Schichten-Schutz: pre-hooks (auto-regen) + CI (drift-fail) + 17 Runtime-Pen-Tests.

**Test-Wachstum diese Welle:** 1069 → 1106 (+37 Tests). Insgesamt 62 Test-Files, 1106 passing.

---

## 45. Performance Mode — überarbeitet (v1.20.0)

**Toolbar → Performance Mode** (oder Shortcut)

Der Performance Mode ist jetzt vollständig funktional — vorher (v1.4–v1.19) war er ein Skelett mit unbedienten Quantize-Buttons und nicht-editierbaren Pads.

### Drei Action-Modi (Toggle oben)

| Modus | Icon | Click auf Pad mit Pattern | Click auf leeres Pad |
|---|---|---|---|
| **▶ Play** *(default)* | Play | Pattern triggern (Quantize berücksichtigt) | nichts (disabled) |
| **✎ Edit** | Pencil | Editor-Popover öffnen: Pattern wählen, Label, Color | Pattern-Picker zum Hinzufügen |
| **⇆ Reorder** | ArrowLeftRight | Drag-Source (HTML5 native) | Drop-Target |

Modus-Toggle ist eine ARIA-Radiogroup mit `aria-checked`.

### Pad-Editor (Edit-Mode)

```
┌──────────────────────────────────────────┐
│ Pad bearbeiten                       [✕] │
├──────────────────────────────────────────┤
│ Pattern:  [Verse Pattern        ▾]      │
│ Label:    [Verse                 ]      │
│ Farbe:    ◯ ◯ ◯ ◯ ◯ ◯ ◯ ◯              │
│           ◯ ◯ ◯ ◯ ◯ ◯ ◯ ◯              │
│           [Custom: #_____________]      │
│                                          │
│ [Speichern]  [Entfernen]  [Abbrechen]   │
└──────────────────────────────────────────┘
```

16 vordefinierte Color-Swatches + Custom-Hex-Input. ESC schließt zuerst Editor, dann Overlay (kaskadierend).

### Drag & Drop (Reorder-Mode)

HTML5 native Drag-and-Drop. Drag-Source wird `opacity-50`, Drop-Target bekommt `outline-dashed`. Swap-Semantik: A→B vertauscht beide Pads.

### Persistenz

`pads` (16 Slots inkl. Color + Label) und `quantizeMode` werden in `localStorage` (`ss-performance:v1`) gespeichert. `queuedPatternId` ist runtime-only.

### Bug-Fixes nebenbei

- Quantize-Buttons (bar/beat/step) gaben **kein Hover-Feedback** (gleiches Pattern wie BUG-002 v1.18.2). Jetzt `hover:bg-bg-base` + `active:scale-95`
- Hardcoded `bg-slate-950`, `hover:text-white`, `text-white` ersetzt durch semantische Tokens

### Tests

38 Store-Unit-Tests + 9 Playwright-Smoke-Tests (Mode-Toggle, Edit-Popover, Reorder-DnD).

---

## v1.18.0: Hardening (CSP + Sandbox-Codegen + Refactor)

Reines Sicherheits- und Aufräum-Release ohne User-facing Features. Drei parallele Streams:

**TASK-107 — Electron Content-Security-Policy**
- Production-Header per `session.defaultSession.webRequest.onHeadersReceived`: `default-src 'self'`, `script-src 'self'` (kein `unsafe-eval`, kein Inline-JS — Vite bundlet alles), `worker-src 'self' blob:` (Pflicht für v1.17 Sandbox), `object-src 'none'`, `frame-ancestors 'none'`
- Dev-Mode lockert `script-src` + `connect-src` + `img-src` um `http://localhost:*` + `ws://localhost:*` für Vite-HMR
- Zusätzlich: `X-Content-Type-Options: nosniff`
- 29 Snapshot-geschützte Tests in `tests/electron/csp-header.test.ts`

**TASK-108 — Build-time Codegen für Worker-Source**
- `sandbox-runtime.ts` ist jetzt **Single Source of Truth**. Vorher gab es eine 146-LOC Duplikat-Konstante `SANDBOX_WORKER_SOURCE` in `useScriptSandbox.ts` — bei jeder Änderung musste beides synchron gehalten werden
- Neues `scripts/generate-sandbox-source.mjs` bundelt via esbuild zu `sandbox-runtime.generated.ts`
- pnpm Pre-Hooks (`predev`, `prebuild`, `precheck`, `pretest`) rufen automatisch `gen:sandbox` auf
- 8 neue Codegen-Tests (Determinismus, SHA-256-Stability, Idempotenz)

**TASK-109 — Refactor: Color-Tokens + Type-Dedup**
- `WaveformDisplay` Hover-Tooltip: `text-cyan-300` → `text-accent-secondary`, `bg-black/X` → `bg-bg-base/X`
- `AudioTrackChannelData` Type lebt jetzt nur noch in `AudioEngine.ts`; `useAudioTrackStore.ts` re-exportiert
- `MacroPanel` ungenutzte Imports (`MACRO_COLORS`, `React`) entfernt
- Keine Verhaltens-Änderung, alle 93 betroffenen Tests grün

---

## v1.15.1 – v1.15.5: Stabilitäts-Fixes

Diese Releases enthalten keine neuen Features, sondern **kritische Bug-Fixes**:

### v1.15.1 – v1.15.2: Window-Bugs
- **Fenster erscheint zuverlässig** (Windows): doppelte IPC-Handler-Registrierung blockierte Initialisierung silent
- **Off-Screen Bounds Validation**: gespeicherte Fenster-Position wird gegen `screen.getAllDisplays()` geprüft
- **`show: false` + `ready-to-show`**: Window erscheint erst wenn Renderer fertig + 5s-Fallback
- **`--reset-window` CLI-Flag** als Notfall-Lösung
- Globale `unhandledRejection` Handler für zukünftige Diagnose

### v1.15.3: Double-Titlebar-Fix
- Native OS-Titlebar auf Windows/Linux ausgeblendet (App rendert eigene `ElectronTitleBar`)
- macOS: `titleBarStyle: "hiddenInset"` behält Traffic-Light-Buttons

### v1.15.4: 8 User-Reported Bugs
- **Space-Taste startet Playback**: Duplikat-Handler-Konflikt aufgelöst
- **Performance-Mode-Button** erreichbar in Tab-Bar
- **Humanizer hörbar**: AudioEngine wendet Swing + Velocity/Timing-Jitter beim Scheduling an
- **Pattern-Morph hat Ton**: Velocity-Default 1 → 100 für aktive Steps
- **Metronom Custom-Sounds persistent**: Base64 in localStorage statt Blob-URLs
- **BPM-Input editierbar**: aggressives min/max-Clamp entfernt
- **Neues Projekt resetet**: `dm.resetAll()` Action löscht Patterns vor Template-Apply
- **Pattern-Generator lädt nicht endlos**: `require()` in ES-Modul ersetzt durch statischen Import
- **Sample-Visualisierung Empty-State**: "Analysiere Waveform…" Hint + fetch-Fallback für Blob/HTTP-URLs in Electron

### v1.15.5: 4 Critical Bugs aus v1.15.4 User-Feedback
- **Quantize-Crash behoben**: `quantizeGrid.ts` warf `TypeError` (white-screen) wenn `pt.steps.length < pattern.stepCount` nach MIDI-Import, Pattern-Morph oder Projekt-Load — bounds-check via `Math.min(steps.length, stepCount)`
- **Macro-Knobs wirken auf Audio**: `useMacroStore` hatte keine Subscription zur `AudioEngine`. Master-Vol, BPM, Channel-Vol/Pan/Sends sind jetzt live verbunden. *(LFO-rate/depth in Vorbereitung)*
- **Universal × Close-Buttons**: ~20 Floating/Modal-Panels (Granular, Polyrhythm, FxPanel, StepInspector, WavetableEditor, ShortcutsHelp, NewProjectDialog, MidiSettings, CollabChat, Settings, ThemeSettings, CustomThemeCreator, PianoRollModal, MacroPanel, Scene-Editor, MixAssistantPanel, PatternMorphPanel, NoteRepeatPanel u.a.) bekommen einheitlichen `<X />`-Button mit `aria-label="Close"`
- **Agent-Index synchronisiert**: `agents/INDEX.js` auf v1.15.5, BUG-001/003/004 als gefixt markiert, BUG-005/006/007 für die v1.15.5-Welle dokumentiert

---

*Letzte Aktualisierung: Sprint 23 — v1.22.0 (LFO + Hold + Pad-Theme + Polish-Welle)*
