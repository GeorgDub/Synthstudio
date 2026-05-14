# Neue Todos / User-Wishlist

Stand: 2026-05-14 nach v1.85 (Session-Update).

## ✅ Erledigt in dieser Session (v1.66 – v1.85)

- ✅ **bei quentize crasht die seite** → v1.71 BUG-025 fixed via `KNOWN_SCALE_IDS` Validation in `useMelodicPartStore._migratePattern` + `setScale`. Tests in `tests/scales.test.ts` + `tests/melodic-part.test.ts`.
- ✅ **Midi Vorlagen für die Gängigsten Midi Geräte (Techno/Hardtekk/Hardcore)** → v1.74 + v1.82 fügen Korg Electribe 2 / 2S, Korg Volca Beats, Roland TR-8/RD-8, Arturia BeatStep Pro, Elektron Digitakt zu den bestehenden Templates hinzu. MIDI_TEMPLATES enthält jetzt 13 Hardware-Vorlagen.
- ✅ **FL Studio Projekte laden** → v1.59-v1.70 FLP-Importer (Header/Notes/Multi-Bar/melodische Channels/Pattern-Namen/Channel-Namen). Test-Coverage in `tests/features/flp-import*.test.ts` + `tests/features/project-imports.test.ts`.
- ✅ **esx-Dateien von Korg ESX/Electribe** → bereits vor dieser Session implementiert in `client/src/utils/imports/electribeImport.ts` mit Tests.

## ⚠️ Teilweise / verwandt erledigt

- **Ableton-Projekte laden** → `client/src/utils/imports/alsImport.ts` existiert als Skeleton, FLP ist deutlich vollständiger. Real-World ALS-Files brauchen XML+ZIP-Parsing — TODO als eigener Sprint.

## 🟡 Offen — Bonus-Features die in dieser Session ergänzt wurden statt obenstehender Items

Diese Features sind **nicht** explizit in der ursprünglichen `neue_todos.md` gelistet, aber durch die User-Anweisung "fokussier dich auf den Midi connect mit der korg, mach die Anwendung benutzbar, Script Vorlage zum duplizieren des aktuellen pattern, Jeden Effekt und jede Funktion belegbar auf makro oder taste, Funktionsabläufe oder mehrere Effekte auf eine Taste oder makro legen" abgedeckt:

- ✅ **MIDI Auto-Learn-Wizard** (v1.71/v1.72) — sequenzielles Lernen mehrerer Mappings hintereinander, Presets für Mixer/Pads/Komplett/Transport/Pattern-Navigation
- ✅ **MIDI-Layout JSON Export/Import** (v1.73) — Mappings als Template teilen + wiederverwenden, Round-Trip-getestet
- ✅ **FX-Parameter-Bindings** (v1.76) — alle 16 Channel-FX-Params pro Part bindbar (Filter Freq/Q/Gain, EQ, Reverb, Delay, Distortion, Compressor)
- ✅ **Function-Chains** (v1.77) — mehrere Actions hintereinander auf einer Taste mit Delays
- ✅ **Custom-Chain-Builder UI** (v1.80) — Inline-Form für eigene Chains ohne JSON-Editor
- ✅ **MIDI-Run-Script-Target** (v1.78) — User-Scripts (Built-In + selbst) auf MIDI-Pads bindbar
- ✅ **Built-In Scripts Library** (v1.75 + v1.83) — 12 vorgefertigte ss.*-Scripts inkl. "Pattern duplizieren" (User-Request), Build-Up, Drop-Reset, Stutter, LFO, Pattern-Walker
- ✅ **MIDI-Monitor-Tab** (v1.81) — Live-Log aller eingehender Events für Hardware-Debug
- ✅ **MIDI-Activity-Indicator** (v1.79) — pulst grün bei jedem Event im Settings-Header
- ✅ **Auto-Learn Channel-Filter** (v1.83) — bei mehreren angeschlossenen Geräten Channel-spezifisches Lernen
- ✅ **Device-Persistenz** (v1.84) — MIDI-Device-Auswahl überlebt App-Reloads, kein Re-Klick nach Neustart
- ✅ **CSP-Fix für AI-Provider** (v1.67 BUG-024) — `api.openai.com` + `api.anthropic.com` zur connect-src ergänzt, AI-Script-Generator und Project-Analysis funktionieren im Electron-Build

## ⏳ Offen — User-Wishlist die NICHT in dieser Session adressiert wurde

- alle fenster sollen auch mit x zumachbar sein (granular, polyrhythm etc)
- git builder workflow für Windows/Linux/macOS/Android/iOS
- Auto-Updater für Desktop-Build
- Android/iOS-Builder + Konzept (große Aufgabe — eigener Sprint)
- Login-System mit Beta-Accounts (Account-Server + Auth)
- Handbuch um ss.* / Plugin-Syntax erweitern
- Cloud-Store für Plugins/Scripts
- Wiki mit LLM-Q&A für Hardtekk/Musikproduktion
- Cloud-Samples (Account-Sync für Sample-Library)
- Ableton .als vollständig (über das Skeleton hinaus)
- Workbench-Erweiterung Richtung Audacity-Funktionsumfang
- KI-Projekt-Analyse (Verbesserungsvorschläge automatisch)
- Admin/Lite/Free-Account-Tier mit Feature-Gating

## 🔮 Vorschläge für nächste Session

- **Right-Click MIDI-Learn** auf jedem FX-Knopf und jedem Volume-Slider (statt nur via MidiSettings-Modal) — größter UX-Boost, aber touched viele Komponenten
- **MIDI Output Test Button** — sendet einen Test-CC ans Device zur Verifizierung der Verbindung
- **Pattern-Duplicate via Drag-and-Drop** — Pattern-Tab nach links/rechts ziehen → kopiert
- **Macro-Bank-Persistenz** mit Name-Labels pro Macro (statt nur 0-7)
- **Beat-Repeat-Effekt** als Macro-Target (kurzes Sample-Loop bei Macro-Druck)
