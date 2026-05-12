# Synthstudio – Funktionshandbuch

**Version 1.14 | Vollständige Dokumentation aller Features**

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

*Letzte Aktualisierung: Sprint 15 — v1.14*
