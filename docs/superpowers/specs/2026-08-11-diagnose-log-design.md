# Diagnose-Log — Entwurf (2026-08-11)

## Warum

Drei offene Befunde am Gerät, und bei jedem einzelnen steht Vermutung gegen
Messung:

| Befund | Was wir wissen | Was fehlt |
|---|---|---|
| FX Live Control tut nichts | Gerät antwortet mit `cmd 0x54`, Parser erwartet `0x52` | der Rohrahmen — die Deutung ist geraten |
| IFX/Groove-Lesen läuft in den Timeout | `@0xC003EFDC`, 3000 ms, keine Antwort | ob überhaupt gesendet wurde, und was |
| Sample-Zuweisung beim Korg-Pull falsch | UI zeigt „kein Sample", zu hören ist für alle Parts dasselbe | welcher Slot zu welchem Namen aufgelöst wurde, Part für Part |

Am 2026-08-10 hat ein Fix nicht gegriffen, weil der Bedienende einen **anderen
Knopf** drückte als der, den ich repariert hatte. Das kostete eine Sitzung und
war im Nachhinein nicht rekonstruierbar — es gab keine Aufzeichnung davon, was
tatsächlich passiert ist.

**Ziel:** aus „bei mir passiert nichts" wird eine Datei, aus der die Kette
Klick → Funktion → gesendetes Frame → Antwort → Ergebnis ablesbar ist.

**Nicht-Ziel:** Die Bugs behebt dieses Werkzeug nicht. Es sorgt dafür, dass sie
gemessen statt geraten werden.

## Architektur

Ein Ereignisstrom, zwei Senken. Panel und Datei lesen **denselben** Puffer —
zwei Quellen wären genau die Fehlerklasse, die uns am 2026-08-10 die Sitzung
gekostet hat (zwei Knöpfe für denselben Vorgang, derselbe Bug zweimal zu fixen).

```
navigator.requestMIDIAccess ─┐
document (Capture-Klicks) ───┼─→ traceLog (Ringpuffer 5000) ─┬─→ fileSink → JSONL
trace.step() in 6 Ketten ────┘                               └─→ DiagPanel (live)
```

### Ereignis-Schema

Eine JSONL-Zeile je Ereignis:

```json
{"seq":412,"t":18342,"kind":"midi-out","corr":"c17",
 "src":"HacktribeRamTransfer.readRam",
 "msg":"cmd 0x52 read @0xC003EFDC len 524",
 "hex":"F0 42 30 00 01 24 52 …"}
```

- `seq` — lückenlos aufsteigend. **Die Wahrheit über die Reihenfolge.**
  Zeitstempel allein reichen nicht: zwei Ereignisse in derselben Millisekunde
  sind sonst nicht unterscheidbar, und genau bei Sende/Antwort-Paaren kommt es
  darauf an.
- `t` — ms seit Sitzungsbeginn. Die Wanduhr steht einmal im Kopfsatz der Datei.
- `corr` — klammert eine Kette. Wird vom Klick-Tap geöffnet und von der
  instrumentierten Kette explizit weitergereicht, **nicht** aus einer globalen
  Variablen gelesen: über `await` hinweg wäre eine globale „aktuelle Kette"
  falsch, sobald zwei Vorgänge überlappen.
- `kind` — `click` | `midi-out` | `midi-in` | `step` | `error`.
- `hex` — nur bei MIDI. Roh, ungedeutet, vollständig.

`msg` ist die Deutung, `hex` der Beleg. **Beide stehen nebeneinander**, damit
eine falsche Deutung auffliegen kann. Stünde nur `msg` da, wäre der `0x54`-Fall
unsichtbar geblieben.

### Die drei Haken

**1. `midiTap.ts` — `navigator.requestMIDIAccess` einmal umhüllen**

In `main.tsx` vor allem anderen. Danach bekommen alle 10 Aufrufer
(`HacktribeRamTransfer`, `E2SysexBridge`, `useOmniTribe`, `useMidi`,
`useTransport`, `useLaunchpad`, `E2NativeSysexTransfer`,
`E2sPatternSyncSender`, `useE2sDeviceStore`, `useMidiBackendStore`) getappte
Ports — ohne dass eine dieser Dateien angefasst wird.

Das ist der Kern des Entwurfs: es gibt keinen anderen Engpass, durch den beide
konkurrierenden RAM-Pfade laufen.

☠ **Der Tap darf fremde Handler nicht verschlucken.** `HacktribeRamTransfer`
umschifft genau diesen Fehler bereits von Hand (`prev?.call(input, event)`).
Ein Tap, der `onmidimessage` überschreibt, würde den MIDI-Monitor und den
RAM-Pfad gegenseitig taubstellen. Test dafür ist Pflicht.

**2. `clickTap.ts` — Capture-Phase auf `document`**

Beschriftung, `data-testid`, nächstgelegene Komponente. Öffnet eine neue
`corr`-Kette. Fängt damit auch „welchen der beiden Knöpfe hat er gedrückt".

**3. `trace.step()` in sechs Ketten**

RAM-Lesen, RAM-Schreiben, Pattern-Pull, Pattern-Push, Sample-Resolver,
Bank-Laden. Der Resolver protokolliert **je Part eine Zeile**:

```
Part 3: ref 586 → Slot 587 → "Jumpkick" ✓
Part 4: ref 588 → Slot 589 → kein Treffer in der Bank
```

Ohne diese Auflösung ist der Sample-Bug nicht zu unterscheiden von „Bank nicht
geladen", „Versatz falsch" und „Resolver gar nicht aufgerufen".

### Rauschen

MIDI-Clock läuft mit 24 Ticks je Viertel; bei 185 BPM sind das ~74 Ereignisse
pro Sekunde. Clock und Note-On/Off werden deshalb zu Zählern verdichtet
(`142 Clock-Ticks in 1.9 s`), Sysex/CC/NRPN immer vollständig. Umschaltbar im
Panel, Standard ist verdichtet.

### Datei-Senke

Gepuffert alle 500 ms über einen neuen IPC-Kanal `diag:append` nach
`userData/diagnose/session-<ISO>.jsonl`. Letzte 20 Sitzungen, Deckel 50 MB.
Ohne Electron (Browser) fällt sie auf einen Download-Knopf zurück.

Der IPC-Kanal validiert den Pfad wie die bestehenden Schreib-Kanäle: Ziel wird
gegen `userData/diagnose` aufgelöst, kein vom Renderer gewählter Pfad.

### Panel

`Ansicht → Diagnose-Log`, `Strg+Umschalt+L`. Liste mit Filter-Chips
(Klick / MIDI-Out / MIDI-In / Schritt / Fehler), Ketten per `corr` einklappbar,
Knöpfe „Ordner öffnen" und „Letzte Sitzung kopieren". Bewusst schlicht — ein
Werkzeug, kein Feature.

## Fehlerbehandlung

Das Log darf die App **nie** zum Absturz bringen: jeder Tap läuft in
`try/catch`, ein Fehler im Log wird als `kind:"error"` in den Puffer geschrieben
und sonst geschluckt. Schlägt die Datei-Senke fehl, läuft das Panel weiter.

Der Ringpuffer verwirft die ältesten Einträge; die Datei nicht — sie ist die
vollständige Aufzeichnung.

## Tests

Vitest, in `tests/features/`:

- Schema und Ringpuffer-Überlauf (`seq` bleibt lückenlos, auch nach Verdrängung)
- Clock-Verdichtung (Zähler stimmt, Sysex dazwischen bleibt einzeln)
- Sysex-Deutung gegen Fixtures, **darunter ein echter `0x54`-Antwortrahmen** —
  der Fall, der heute als „unbekannt" durchfällt
- Klick-Tap gegen ein DOM-Fragment (Beschriftung, `data-testid`)
- MIDI-Tap gegen eine gefälschte `MIDIAccess`
- ★ **Der Tap verschluckt fremde `onmidimessage`-Handler nicht** — Regression
  gegen den Fehler, den `HacktribeRamTransfer` von Hand umschifft
- Datei-Senke: Pfad landet unter `userData/diagnose`, Traversal wird abgewiesen

## Abgrenzung

Bewusst **nicht** enthalten:

- Automatische Instrumentierung jeder Funktion (Vite-Plugin). Wörtlich das
  Gewünschte, aber zehntausende Einträge pro Sekunde machen die entscheidende
  Zeile unauffindbar. Verworfen wegen des Ergebnisses, nicht wegen des Aufwands.
- Senden des Logs irgendwohin. Die Datei bleibt lokal; der Bedienende reicht sie
  weiter, wenn er will.

## Voraussetzung für die Bug-Jagd

Die Messungen vom 2026-08-11 liefen auf **v3.320**. Der `+1`-Fix ist v3.321.
Jede Sample-Messung auf 3.320 misst einen bereits behobenen Fehler mit — vor der
nächsten Sitzung wird gebaut, nicht die alte `.exe` gestartet.
