# Synthstudio – Konkreter Testplan v1.0
**Erstellt:** 2026-05-12  
**Tester:** Claude (Cowork-Modus, Computer-Use)  
**Ziel:** Systematische Live-Überprüfung aller dokumentierten Features auf dem installierten Electron-Build.  
**Ergebnis-Dokument:** `TESTERGEBNISSE.md` (wird während/nach den Tests befüllt)

---

## Voraussetzungen
- Synthstudio Electron-App gestartet (G:\Programs\Synthstudio\Synthstudio.exe)
- Leeres Projekt geladen
- Kein MIDI-Gerät notwendig (MIDI-Tests ohne Hardware)
- Screenshots werden für jeden Test-Abschnitt gespeichert

---

## Teststruktur & Bewertungsskala

| Symbol | Bedeutung |
|--------|-----------|
| ✅ | Funktioniert wie erwartet |
| ⚠️ | Funktioniert, aber mit Problem / Abweichung |
| ❌ | Funktioniert nicht / Crash / leer |
| 🔲 | Nicht getestet |

---

## BLOCK 1 — Fenster & Layout (Priorität: KRITISCH)

### T01 – Fenstergröße & Responsivität
**Schritte:**
1. App im Normalzustand: Fensterbreite messen (Pixel-Breite des Hauptbereichs rechts der Sidebar)
2. Fenster auf 1920×1080 maximieren → prüfen ob alle Inhalte sichtbar sind
3. Fenster auf 1280×720 verkleinern → prüfen ob Layout bricht
4. Fenster auf 800×600 verkleinern → prüfen ob Scrollbars erscheinen

**Erfolgskriterium:** Haupt-Content-Bereich (Step-Grid, Mixer-Strips, etc.) füllt die volle verfügbare Breite rechts der Sidebar aus. Kein schwarzer Leerbereich.

**Was ich prüfe:** `overflow`, `flex`, `width`-Werte des Hauptcontainers in der React-DOM-Struktur.

### T02 – Doppelter Titelbar
**Schritte:**
1. Screenshot der Titelleiste
2. Zählen: wie viele Titelbars sind sichtbar? (Windows-Standard + Custom Electron)
3. Prüfen ob Custom Titelbar den Windows-Standard-Titelbar überlappt oder dupliziert

**Erfolgskriterium:** Nur **eine** Titelbar sichtbar (die Custom Electron-Titelbar), kein Windows-Standard-Rahmen.

### T03 – Tab-Navigation sichtbar
**Schritte:**
1. Screenshot Tab-Leiste: sind alle 6 Tabs sichtbar? (Sequencer, Mixer, Song, Humanizer, Tools, Kollaboration)
2. Jede Tab per Klick anklicken und prüfen ob Inhalt wechselt

**Erfolgskriterium:** Alle 6 Tabs sind in der Tab-Leiste sichtbar und anklickbar.

---

## BLOCK 2 — Transport & BPM (Priorität: HOCH)

### T04 – Play/Stop per Leertaste
**Schritte:**
1. Leertaste drücken → visuelles Feedback prüfen (Beat-Indikator leuchtet/pulsiert)
2. Leertaste erneut → Stop prüfen
3. ▶-Button in Toolbar klicken → gleicher Effekt

**Erfolgskriterium:** Beat-Indikator animiert sich während Wiedergabe. Taste togglet korrekt.

### T05 – BPM-Steuerung
**Schritte:**
1. Aktuellen BPM-Wert ablesen (Toolbar)
2. `+`-Taste: BPM steigt um 1
3. `−`-Taste: BPM sinkt um 1
4. `Shift++`: BPM steigt um 10
5. `Shift+−`: BPM sinkt um 10
6. `T` (Tap Tempo): 4× im Takt tippen → BPM übernommen?
7. BPM-Feld direkt klicken und Wert eintippen

**Erfolgskriterium:** Alle 7 Varianten ändern BPM korrekt; Wert wird in Toolbar angezeigt.

### T06 – Undo/Redo
**Schritte:**
1. BPM ändern (z.B. +10)
2. `Ctrl+Z` → BPM zurück?
3. `Ctrl+Y` → BPM wieder vorwärts?
4. Step aktivieren → Ctrl+Z → Step deaktiviert?

**Erfolgskriterium:** Undo/Redo wirkt auf BPM-Änderungen und Step-Toggles.

---

## BLOCK 3 — Sequencer / Drum Machine (Priorität: KRITISCH)

### T07 – Step-Grid Sichtbarkeit
**Schritte:**
1. Screenshot: Sind die 16 Step-Buttons pro Kanal rechts der Channel-Strips sichtbar?
2. Inspektion: Fensterbreite vs. tatsächlich gerenderter Content-Bereich
3. Klick in den Bereich wo Steps sein sollten → reagiert das System?

**Erfolgskriterium:** 16 (oder 32) Step-Buttons sind als Kacheln sichtbar für alle 9 Kanäle.

### T08 – Step ein/ausschalten
**Schritte:**
1. Klick auf Step 1 des Kick-Kanals → Step aktiviert (Farbe wechselt)
2. Klick erneut → Step deaktiviert
3. 4 Steps aktivieren in klassischem 4/4-Muster
4. Wiedergabe starten → läuft der Rhythmus durch?

**Erfolgskriterium:** Steps togglen visuell + Audio folgt beim Abspielen.

### T09 – Kanal-Controls (Mute, Solo, Volume, Pan)
**Schritte:**
1. `M`-Button Kick → Kanal stumm (visuelles Feedback?)
2. `M` erneut → Kanal wieder aktiv
3. `S`-Button Snare → Solo aktiv (andere gedämpft?)
4. Volume-Slider ziehen → Wert ändert sich
5. Pan-Slider ziehen → Wert ändert sich

**Erfolgskriterium:** M/S-Buttons haben sichtbaren aktiven Zustand; Slider reagieren.

### T10 – Velocity-Modus
**Schritte:**
1. VEL-Button in Toolbar klicken → Modus aktiv?
2. Steps zeigen Velocity-Balken?
3. Velocity-Preset-Buttons testen: ↑ (Crescendo), ↓ (Decrescendo), ∩ (Bogen), ∿ (Welle), R (Random)
4. Einzelnen Step-Balken per Drag verändern

**Erfolgskriterium:** Velocity-Balken sichtbar; Presets ändern Verlauf; Drag funktioniert.

### T11 – Pattern-Operationen (Dropdown)
**Schritte:**
1. Pattern-Dropdown öffnen → Liste zeigt Patterns
2. `Ctrl+D` → Pattern dupliziert?
3. `Ctrl+→` → nächstes Pattern gewählt?
4. `Ctrl+←` → vorheriges Pattern?
5. `Ctrl+Del` → Pattern gelöscht (mit Bestätigung)?
6. `Ctrl+F` → Pattern gefüllt?
7. `Ctrl+Shift+R` → Pattern randomisiert?

**Erfolgskriterium:** Alle 6 Operationen laufen durch ohne Fehler.

### T12 – Auflösung wechseln
**Schritte:**
1. Auflösung-Dropdown finden (in Toolbar oder Kanalstrip)
2. Zwischen 1/8, 1/16, 1/32 wechseln
3. Statusleiste zeigt neue Auflösung?

**Erfolgskriterium:** Auflösung wechselt, Statusleiste aktualisiert.

### T13 – Step Inspector
**Schritte:**
1. Auf aktiven Step klicken → Inspector öffnet sich unten
2. Velocity-Wert ändern (Slider + Schnellwerte 32/64/96/127)
3. Pitch-Wert ändern (± Halbtöne, Notenname sichtbar?)
4. Wahrscheinlichkeit setzen (75%, 50%, 25%)
5. Bedingung setzen (1:2, 2:2)
6. Reverse-Toggle
7. Param-Lock hinzufügen (+ Button) und entfernen (✕)

**Erfolgskriterium:** Alle 7 Parameter im Inspector sind interaktiv und speichern.

### T14 – Live Edit Modus
**Schritte:**
1. `● Live Edit` Button klicken → Draft wird erstellt?
2. Pattern bearbeiten während Original läuft
3. `✓ Commit` → Draft wird aktiv?
4. Neues Live Edit → `✕ Verwerfen` → Original bleibt?
5. `⏱ Nächste Bar` → Wechsel am Bar-Anfang?

**Erfolgskriterium:** Draft-System funktioniert ohne Audio-Unterbrechung.

### T15 – A/B Pattern Compare
**Schritte:**
1. `A`-Button → Pattern als Slot A gespeichert
2. Pattern ändern
3. `B`-Button → aktuelles Pattern als Slot B gespeichert
4. `A` erneut → springt zu Slot A

**Erfolgskriterium:** Schneller A/B Wechsel ohne Datenverlust.

---

## BLOCK 4 — Mixer (Priorität: HOCH)

### T16 – Mixer Layout
**Schritte:**
1. Mixer-Tab öffnen (Klick oder F2)
2. Alle 9 Channel-Strips + Master sichtbar?
3. VU-Meter zeigen Pegel während Wiedergabe?

**Erfolgskriterium:** Alle 10 Strips nebeneinander sichtbar, kein Clipping des Layouts.

### T17 – Fader & Pan
**Schritte:**
1. Fader eines Kanals ziehen → Pegelwert unter Fader aktualisiert?
2. Pan-Slider links/rechts → Wert angezeigt?
3. Doppelklick auf Fader → Reset auf 0 dB?

**Erfolgskriterium:** Fader und Pan reagieren, Wertanzeige korrekt.

### T18 – Kanal-Effekte (FX-Chain)
**Schritte:**
1. Kanal-Strip klicken → Channel Inspector öffnet rechts?
2. FX-Chain sichtbar? (Filter, EQ, Compressor, etc.)
3. Effekt hinzufügen (+ Button)
4. Effekt-Parameter ändern (ein Slider)
5. Effekt entfernen (✕)
6. Reihenfolge ändern (Drag)

**Erfolgskriterium:** Inspector öffnet, FX-Chain ist editierbar.

### T19 – Spectrum Analyzer
**Schritte:**
1. `📊 Spectrum`-Button klicken → Canvas erscheint oben?
2. Wiedergabe starten → FFT-Balken bewegen sich?
3. Button erneut → Analyzer schließt?

**Erfolgskriterium:** Echtzeit-FFT-Visualisierung aktiv während Wiedergabe.

### T20 – Bus-Kompressor
**Schritte:**
1. `🗜 Bus Comp`-Button → Panel öffnet?
2. 5 Slider sichtbar (Threshold, Ratio, Attack, Release, Makeup)?
3. Slider verstellbar?

**Erfolgskriterium:** Bus-Comp-Panel öffnet mit allen Parametern.

### T21 – WAV-Export
**Schritte:**
1. Export-Bereich im Mixer sichtbar?
2. `Master Mix` wählen → Export-Button klicken
3. Fortschrittsbalken erscheint?
4. Datei landet im erwarteten Ordner?
5. `Stems` wählen → Export → mehrere Dateien?

**Erfolgskriterium:** Export läuft durch, Dateien werden erstellt.

---

## BLOCK 5 — Piano Roll (Priorität: HOCH)

### T22 – Piano Roll öffnen
**Schritte:**
1. `PR`-Button am Kick-Kanal klicken
2. Piano Roll öffnet sich als Panel?
3. 24 Noten-Reihen (B4–C3) sichtbar?
4. 16 Step-Spalten sichtbar?

**Erfolgskriterium:** Piano Roll rendert korrekt mit Noten-Grid.

### T23 – Noten editieren
**Schritte:**
1. Klick auf eine Gitterzelle → Note erscheint
2. Rechtsklick → Note entfernt
3. Note ziehen (Drag) → verschiebt sich
4. Rechten Rand der Note ziehen → Länge ändert sich

**Erfolgskriterium:** Alle 4 Editier-Operationen funktionieren.

---

## BLOCK 6 — Song-Modus & Automation (Priorität: MITTEL)

### T24 – Arrangement-Timeline
**Schritte:**
1. `F3` drücken oder Song-Tab klicken
2. Arrangement-Sub-Tab: Slots sichtbar?
3. `+ Slot` hinzufügen
4. Slot-Parameter setzen: Bank (A/B/C/D), Repeats, Label
5. Song-Modus AN-Toggle → Playback folgt Timeline?

**Erfolgskriterium:** Song-Timeline editierbar, Playback läuft Slots durch.

### T25 – Automation
**Schritte:**
1. Automation-Sub-Tab anklicken
2. `+ Lane` → neue Lane hinzufügen
3. BPM-Lane auswählen → Punkte setzen per Klick
4. Wiedergabe → BPM folgt der Kurve?
5. Punkt entfernen (Rechtsklick)

**Erfolgskriterium:** Automation-Lanes editierbar, Playback liest Werte.

### T26 – Scene Launch
**Schritte:**
1. Scene-Sub-Tab öffnen (oder Shift+1 testen)
2. Scene-Pad sichtbar?
3. Shift+1 → Scene 1 auslösen
4. Langes Halten → Edit-Modal öffnet?
5. Rechtsklick → Löschen-Option?

**Erfolgskriterium:** Scenes auslösbar per Taste und Klick.

---

## BLOCK 7 — Performance Features (Priorität: MITTEL)

### T27 – Pattern Morph
**Schritte:**
1. `⟷ Morph`-Button oder `Alt+M`
2. Panel öffnet mit Pattern A/B Auswahl?
3. Slider bewegen → Preview zeigt Mischung?
4. `Apply Morph` → neues gemorphtes Pattern erstellt?

**Erfolgskriterium:** Morph-Slider interpoliert zwischen A und B.

### T28 – Note Repeat
**Schritte:**
1. `🔁 NR` oder `Alt+R` → Panel öffnet?
2. Rate 1/16 wählen
3. Pad gedrückt halten → feuert es mit Rate?
4. Rate wechseln zu 1/32 → schnelleres Feuern?

**Erfolgskriterium:** Note Repeat feuert mit korrekter Rate.

### T29 – Humanizer
**Schritte:**
1. `F4` oder Humanizer-Tab
2. Swing-Slider sichtbar?
3. Swing auf 50% → Wiedergabe klingt "swingend"?
4. Velocity-Variation Slider?
5. Groove-Template auswählen?

**Erfolgskriterium:** Humanizer-Parameter beeinflussen Timing/Velocity.

### T30 – Global Transpose
**Schritte:**
1. TransposeControl neben BPM finden
2. `+1` Klick → alle Noten +1 Halbton?
3. `−1` Klick → zurück
4. ↺ Reset → auf 0?

**Erfolgskriterium:** Transpose wirkt auf Piano-Roll-Noten global.

---

## BLOCK 8 — Synthesizer & Granular (Priorität: MITTEL)

### T31 – Synthesizer-Modus
**Schritte:**
1. Kanal → Synthesizer-Modus aktivieren (statt Sample)
2. Wavetable-Tab: Wellenformen wählbar (Sine, Saw, Square)?
3. FM-Tab: FM Ratio + Depth Slider?
4. ADSR: 4 Slider (A/D/S/R) vorhanden?
5. LFO: Wellenform + Rate + Depth + Target?
6. Portamento-Slider?

**Erfolgskriterium:** Alle Synthesizer-Parameter sichtbar und editierbar.

### T32 – Custom Wavetable Editor
**Schritte:**
1. `custom ✏` im Osc-Menü → Editor öffnet?
2. Canvas zum Zeichnen sichtbar?
3. Per Drag zeichnen → Wellenform ändert sich?
4. Preset-Buttons (Sine/Square/Saw/Tri)?
5. `Übernehmen` → wird in Audio-Engine übertragen?

**Erfolgskriterium:** Editor öffnet, Zeichnen funktioniert, Übernahme wirkt.

### T33 – Granular Synthesizer
**Schritte:**
1. `GR`-Button am Kanal → Panel öffnet?
2. Sample auf Panel ziehen → wird geladen?
3. Grain-Cloud-Visualizer erscheint?
4. Position-Slider → verschiebt Position im Sample?
5. Grain-Größe, Dichte, Pitch-Spray: alle reagieren?
6. Presets (Cloud, Shimmer, Texture, Stutter, Freeze)?

**Erfolgskriterium:** Granular-Engine reagiert auf alle 8 Parameter.

---

## BLOCK 9 — Tools-Tab (Priorität: MITTEL)

### T34 – KI-Generator
**Schritte:**
1. F5 oder Tools-Tab → KI-Generator Sub-Tab
2. Genre-Buttons sichtbar?
3. Complexity-Slider vorhanden?
4. `Pattern generieren` ohne API-Key → prozedurales Pattern?
5. Vorschau-Mini-Grid zeigt generiertes Pattern?
6. `→ Anwenden` → in DrumMachine übertragen?

**Erfolgskriterium:** Generator erzeugt Pattern und überträgt es.

### T35 – Akkord-Generator
**Schritte:**
1. Akkorde-Sub-Tab
2. Grundton-Auswahl (12 Halbtöne) funktioniert?
3. Modus-Dropdown (Dur, Moll, Dorisch...)?
4. Progression auswählen → Akkord-Blöcke erscheinen?
5. Klick auf Akkord-Block → Ton-Vorschau?
6. `→ In Piano Roll übertragen`?

**Erfolgskriterium:** Akkorde werden angezeigt und können übertragen werden.

### T36 – Script Runner
**Schritte:**
1. Script-Runner Sub-Tab
2. Code-Editor sichtbar?
3. Beispiel-Code bereits drin?
4. `▶ Ausführen` → Script läuft?
5. Konsole zeigt Output?
6. `ss.bpm(140)` eintippen → BPM ändert sich?

**Erfolgskriterium:** Script läuft und `ss.*`-API ist funktional.

---

## BLOCK 10 — Sample Browser (Priorität: HOCH)

### T37 – Sample importieren
**Schritte:**
1. `+ Dateien`-Button → Dateidialog öffnet?
2. WAV/MP3 auswählen → erscheint in Liste?
3. `+ Ordner`-Button → rekursiver Import mit Fortschritt?
4. `+ ZIP` → ZIP-Pack importieren?

**Erfolgskriterium:** Alle 3 Import-Wege funktionieren.

### T38 – Sample-Suche & Filter
**Schritte:**
1. Suchfeld eintippen ("kick") → Liste filtert?
2. Kategorie-Tag klicken ("Kicks") → nur Kicks?
3. Hashtag klicken (#snare) → Filter aktiv?

**Erfolgskriterium:** Suche und Filter zeigen korrekte Ergebnisse.

### T39 – Sample auf Kanal zuweisen
**Schritte:**
1. Sample in Liste auswählen
2. Doppelklick oder Enter → wird aktivem Kanal zugewiesen?
3. Drag & Drop aus Browser auf Kanal-Label?
4. Waveform-Vorschau erscheint im Browser?

**Erfolgskriterium:** Sample-Zuweisung per 2 verschiedenen Wegen.

### T40 – Mikrofon-Aufnahme
**Schritte:**
1. `● Aufnahme`-Button → Mikrofon-Permission-Dialog?
2. Permission erteilen → VU-Meter sichtbar?
3. Aufnahme starten → aufnehmen → stoppen
4. Neues Sample erscheint in Kategorie "Recording"?

**Erfolgskriterium:** Aufnahme landet als nutzbare Sample-Datei.

---

## BLOCK 11 — Einstellungen (Priorität: MITTEL)

### T41 – Settings-Dialog öffnen
**Schritte:**
1. `Ctrl+M` → Settings öffnet?
2. Alle Menüpunkte sichtbar: Design, KI & API, Tastatur, Metronom, MIDI Geräte, CC-Zuweisungen, Note-Zuweisungen, Chord Memory, MPE, Speichern, OSC, Plugins, Über
3. Jede Kategorie anklicken → Inhalt erscheint rechts?

**Erfolgskriterium:** Alle 13 Einstellungs-Kategorien zeigen Inhalt.

### T42 – Design/Theme wechseln
**Schritte:**
1. Einstellungen → Design
2. 6 Themes sichtbar (DarkStudio, NeonCircuit, AnalogHardware, Nacht, Sonnenuntergang, OLED-Schwarz)?
3. Theme anklicken → App wechselt Farben sofort?
4. `+ Custom Theme` → Creator öffnet?
5. Custom Theme: alle 12 CSS-Variablen editierbar?

**Erfolgskriterium:** Theme-Wechsel sofortig sichtbar, Custom Creator funktional.

### T43 – Tastatur-Belegungen
**Schritte:**
1. Einstellungen → Tastatur
2. Liste aller Aktionen sichtbar?
3. Eine Aktion anklicken → Eingabe-Modus für neue Taste?
4. Neue Taste drücken → zugewiesen?
5. Reset auf Standard?

**Erfolgskriterium:** Keyboard-Bindings editierbar und persistent.

### T44 – MIDI-Geräte
**Schritte:**
1. Einstellungen → MIDI Geräte
2. Geräte-Liste erscheint (auch wenn leer: "kein Gerät" Meldung)?
3. MIDI-Clock Master Toggle vorhanden?
4. MIDI-Clock Slave Toggle vorhanden?

**Erfolgskriterium:** MIDI-Seite rendert korrekt (auch ohne Gerät).

---

## BLOCK 12 — Projekt-Management (Priorität: HOCH)

### T45 – Projekt speichern & laden
**Schritte:**
1. Pattern programmieren (paar Steps)
2. `Ctrl+S` → Speichern-Dialog? Oder sofortiges Speichern?
3. Datei `test_projekt.synth` speichern
4. Neues Projekt erstellen (Datei → Neues Projekt)
5. `Ctrl+O` → test_projekt.synth öffnen → Steps geladen?

**Erfolgskriterium:** Speichern + Laden reproduziert exakt denselben Zustand.

### T46 – Zuletzt geöffnete Projekte
**Schritte:**
1. Datei → Zuletzt geöffnete Projekte → Submenu erscheint?
2. Einträge vorhanden?

**Erfolgskriterium:** Liste zeigt zuletzt geöffnete Projekte.

### T47 – Projekt-Templates
**Schritte:**
1. Datei → Neues Projekt → Template-Auswahl erscheint?
2. "Techno" Template laden → Pattern vorprogrammiert?
3. "House" Template → anderes Pattern?

**Erfolgskriterium:** Templates laden vorprogrammierte Patterns.

---

## BLOCK 13 — Kollaboration (Priorität: NIEDRIG)

### T48 – Session erstellen (LAN)
**Schritte:**
1. F6 → Kollaborations-Tab
2. "Session erstellen" Button → Websocket-Server startet?
3. IP + Port wird angezeigt?
4. Status wechselt zu "Verbunden" / "Warte auf Partner"?

**Erfolgskriterium:** Server startet und zeigt Verbindungs-Info.

### T49 – WAN Relay
**Schritte:**
1. Relay-URL Feld: `ws://localhost:8080` sichtbar?
2. URL ändern → gespeichert?
3. Verbinden-Button → zeigt Verbindungs-Fehler bei falschem Server (nicht Crash)?

**Erfolgskriterium:** Relay-Konfiguration editierbar, Fehler korrekt abgefangen.

---

## BLOCK 14 — Keyboard Shortcuts Volltest (Priorität: MITTEL)

### T50 – Alle Shortcuts systematisch
| Shortcut | Erwartung | Ergebnis |
|----------|-----------|----------|
| `Space` | Play/Stop | 🔲 |
| `Ctrl+R` | Record | 🔲 |
| `T` | Tap Tempo | 🔲 |
| `+` | BPM +1 | 🔲 |
| `-` | BPM -1 | 🔲 |
| `Shift++` | BPM +10 | 🔲 |
| `F1` | Sequencer-Tab | 🔲 |
| `F2` | Mixer-Tab | 🔲 |
| `F3` | Song-Tab | 🔲 |
| `F4` | Humanizer-Tab | 🔲 |
| `F5` | Tools-Tab | 🔲 |
| `F6` | Kollaboration-Tab | 🔲 |
| `Ctrl+M` | MIDI/Settings | 🔲 |
| `Ctrl+S` | Projekt speichern | 🔲 |
| `Ctrl+Z` | Undo | 🔲 |
| `Ctrl+Y` | Redo | 🔲 |
| `Ctrl+D` | Pattern duplizieren | 🔲 |
| `Ctrl+→` | Nächstes Pattern | 🔲 |
| `Ctrl+←` | Vorheriges Pattern | 🔲 |
| `Ctrl+F` | Pattern füllen | 🔲 |
| `Ctrl+Shift+R` | Randomisieren | 🔲 |
| `Alt+R` | Note Repeat | 🔲 |
| `Alt+M` | Pattern Morph | 🔲 |
| `Alt+S` | Spectrum Analyzer | 🔲 |
| `Shift+1` bis `Shift+8` | Scenes | 🔲 |
| `V` | Velocity-Modus | 🔲 |
| `↑` / `↓` | Kanal navigieren | 🔲 |

---

## Dokumentationsformat für Bugs (in TESTERGEBNISSE.md)

```
### BUG-XXX: [Kurztitel]
- **Schwere:** KRITISCH / HOCH / MITTEL / NIEDRIG
- **Test:** T-Nummer
- **Reproduktion:** Schritte 1-2-3
- **Erwartet:** was sollte passieren
- **Tatsächlich:** was passiert wirklich
- **Screenshot:** ja/nein
- **Wahrscheinliche Ursache:** CSS-Bug / State-Bug / Render-Bug / etc.
- **Fix-Vorschlag:** konkreter Hinweis für Code-Agent
```

---

## Bereits bekannte Bugs (aus Vorbeobachtung)

Folgendes wurde beim ersten Blick auf die App identifiziert — wird im Test verifiziert:

| ID | Beobachtung | Block |
|----|-------------|-------|
| BUG-001 | Step-Grid nicht sichtbar (rechter Hauptbereich schwarz) | T07 |
| BUG-002 | Nur 2 statt 6 Tabs in Tab-Leiste sichtbar | T03 |
| BUG-003 | Doppelter Titelbar (Windows-Standard + Custom Electron) | T02 |
| BUG-004 | Einstellungs-Inhaltspanels leer (rechte Seite schwarz) | T41 |
| BUG-005 | Mixer: nur 2 von 9 Kanälen sichtbar | T16 |
| BUG-006 | Transpose zeigt −12 im Leerprojekt | T30 |
| BUG-007 | Pattern-Liste enthält Ghost/Morph-Duplikate | T11 |
| BUG-008 | Velocity-Slider im Step Inspector falsch positioniert | T13 |

---

## Testablauf-Reihenfolge (nach Priorität)

1. T01–T03 (Layout-Grundlage — ohne das macht alles andere keinen Sinn)
2. T07–T09 (Step-Grid: Kern-Feature)
3. T04–T06 (Transport)
4. T16–T18 (Mixer)
5. T10–T15 (Sequencer-Details)
6. T37–T39 (Sample Browser)
7. T22–T23 (Piano Roll)
8. T41–T44 (Einstellungen)
9. T45–T47 (Projekt-Management)
10. T24–T26 (Song-Modus)
11. T27–T33 (Performance + Synth)
12. T34–T36 (Tools)
13. T48–T49 (Kollaboration)
14. T50 (Shortcut-Volltest)

**Geschätzte Testdauer:** 45–60 Minuten

---

*Testplan Version 1.0 — bereit zur Freigabe*
