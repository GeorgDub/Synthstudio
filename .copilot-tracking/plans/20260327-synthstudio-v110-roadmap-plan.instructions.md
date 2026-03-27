---
applyTo: ".copilot-tracking/changes/20260327-synthstudio-v110-roadmap-changes.md"
---

# Task Checklist: Synthstudio v1.10 – "Live Collaboration & Creative AI"

## Overview

v1.10 bringt das wichtigste Feature: **Gemeinsames Musik-Machen über einen Session-Link**.
Mehrere Personen im gleichen Netzwerk (oder via Relay) können denselben Beat bearbeiten –
Steps toggeln sich sofort bei allen, BPM und Pattern wechseln synchron.
Dazu kommen ein algorithmischer Pattern-Generator, ein Arpeggiator und Genre-Templates.

## Ziel-Version

- **v1.10.0** (Minor Release – 4 neue Features)
- Branch: `electron-dev`
- GitHub Actions Build nach Tag-Push

## Features

| Phase | Feature | Agent |
|-------|---------|-------|
| 1 | Kollaborative Live-Sessions (WebSocket, Raum-Code, Teilnehmer) | backend-agent |
| 2 | SessionPanel UI + Teilnehmer-Anzeige | Expert React Frontend Engineer |
| 3 | Algorithmischer Pattern-Generator (6 Genres, Markov-Ketten) | audio-engine-agent |
| 4 | Arpeggiator & Chord-Modus | audio-engine-agent |
| 5 | Projekt-Templates (6 Genres) | Expert React Frontend Engineer |
| 6 | Tests für alle neuen Module | – |

## Implementation Checklist

### [x] Phase 1: Kollaborative Live-Sessions – Backend

- [x] Task 1.1: `electron/collab-server.ts` – WebSocket-Raumserver (ws-Paket)
  - Räume: `Map<string, Room>`, Codes via nanoid(6)
  - Events: step:toggle, bpm:change, pattern:switch, transport:play/stop
  - Snapshot-Sync beim Beitritt: neuer Client erhält aktuellen Zustand

- [x] Task 1.2: IPC-Handler in `electron/main.ts`
  - `collab:start` → Server starten, Port zurückgeben
  - `collab:stop` → Server stoppen
  - `collab:get-address` → { ip, port }

- [x] Task 1.3: Preload-Erweiterung (`electron/preload.ts`)
  - `startCollabServer()`, `stopCollabServer()`, `getCollabAddress()`

- [x] Task 1.4: `client/src/store/useSessionStore.ts`
  - Singleton: isActive, isHost, sessionCode, wsUrl, participants, myUserId

- [x] Task 1.5: `client/src/hooks/useCollabSession.ts`
  - WebSocket-Lifecycle, Events dispatchen → DrumMachineStore

### [x] Phase 2: SessionPanel UI (delegiert an Expert React Frontend Engineer)

- [x] Task 2.1: `client/src/components/CollabSession/SessionPanel.tsx`
  - "Session erstellen" / "Session beitreten" Tabs
  - QR-Code oder kopierbarer Link
  - Teilnehmer-Liste mit farbigen Avataren

### [x] Phase 3: Algorithmischer Pattern-Generator (delegiert an audio-engine-agent)

- [x] Task 3.1: `client/src/utils/patternGenerator.ts`
  - Genre-Presets: Techno, House, Hip-Hop, Trap, D'n'B, Reggaeton
  - Markov-Ketten für realistische Variation
  - `generatePattern(genre, complexity)` → PatternData

- [x] Task 3.2: `client/src/store/usePatternGeneratorStore.ts`
- [x] Task 3.3: `client/src/components/PatternGenerator/PatternGeneratorPanel.tsx`

### [x] Phase 4: Arpeggiator (delegiert an audio-engine-agent)

- [x] Task 4.1: `client/src/utils/arpeggiator.ts`
  - Modi: up, down, upDown, random, chord
  - `applyArp(notes, mode, octaves, stepCount)` → StepData[]

- [x] Task 4.2: `client/src/store/useArpStore.ts`
- [x] Task 4.3: `client/src/components/Arpeggiator/ArpeggiatorPanel.tsx`

### [x] Phase 5: Projekt-Templates (delegiert)

- [x] Task 5.1: `client/src/utils/projectTemplates.ts`
  - 6 Genre-Templates mit vollständigen Patterns + BPM

### [x] Phase 6: Tests

- [x] tests/collab-server.test.ts (10 Tests)
- [x] tests/pattern-generator.test.ts (10 Tests)
- [x] tests/arpeggiator.test.ts (8 Tests)

## Success Criteria

- Zwei Browser-Tabs können denselben Raum joinen und Steps synchron toggeln
- Pattern-Generator erzeugt in < 50ms ein vollständiges Pattern
- Arpeggiator liefert korrekte Notensequenzen für alle Modi
- `pnpm test` grün (alle Suiten)
- Tag v1.10.0 gepusht → CI läuft
