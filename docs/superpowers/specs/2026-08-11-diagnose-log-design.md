# Diagnose-Log — Entwurf (2026-08-11)

## Warum

Drei offene Befunde am Gerät, und bei jedem einzelnen steht Vermutung gegen
Messung:

| Befund | Was wir wissen | Was fehlt |
|---|---|---|
| FX Live Control tut nichts | Das Banner meldete ein unerwartetes Kommando-Byte (`0x54`) | **der Rohrahmen ist nie festgehalten worden.** Gedruckt wurde nur das gedeutete Byte — ob das Gerät wirklich so geantwortet hat, ist offen |
| IFX/Groove-Lesen läuft in den Timeout | `@0xC003EFDC`, 3000 ms, keine Antwort | ob überhaupt gesendet wurde, und was |
| Sample-Zuweisung beim Korg-Pull falsch | UI zeigt „kein Sample", zu hören ist für alle Parts dasselbe | welcher Slot zu welchem Namen aufgelöst wurde, Part für Part |

☠ **Keine dieser Deutungen wird in einen Test gegossen, bevor ein echter Rahmen
vorliegt.** Ein Test, der eine falsche Überzeugung festschreibt, ist schlimmer
als keiner — die Überzeugung sieht ab dann bewiesen aus. Das Fixture für die
Sysex-Deutung wartet auf die erste Aufzeichnung; das ist die erste Aufgabe des
Logs, nicht seine Voraussetzung.

### Nebenbefund aus dem Entwurf — statisch prüfbar, kein Gerät nötig

Beim Nachlesen der beiden Parser fiel auf: sie sind sich über den Datenbeginn im
Antwortrahmen **nicht einig**.

| Quelle | Datenbeginn |
|---|---|
| `parseRamResponse` (RAM-Panel) | `b.subarray(7, end)` |
| `parseSysex` (Bridge), selbe Codebasis | `b.subarray(9, end)` |
| Protokoll-Kommentar **in `hacktribeRam.ts` selbst**, Z. 32 | „Daten in resp[9..-1]" |
| `memory_peek.py`, am Gerät bewiesen | `resp[9:-1]` |

Drei Quellen sagen 9, der Panel-Pfad nimmt 7 — gegen seinen eigenen
Kopfkommentar. Wieder zwei Implementierungen desselben Vorgangs. Das wird
**getrennt** behandelt, nicht im Zuge des Logs mitgefixt: erst das Log, dann
eine Messung, dann der Fix. Sonst steht am Ende wieder eine Korrektur ohne
Beleg.

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

In dieser Reihenfolge, riskantestes Stück zuerst:

1. **Ringpuffer**: `seq` bleibt lückenlos, auch nachdem die ältesten Einträge
   verdrängt wurden.
2. ★ **Der MIDI-Tap verschluckt fremde `onmidimessage`-Handler nicht.** Die
   Produktionsänderung, die diesen Test rot machen würde, ist benannt:
   `onmidimessage` überschreiben, ohne `prev` aufzurufen. `HacktribeRamTransfer`
   umschifft das schon von Hand — ein Tap, der es falsch macht, stellt beide
   RAM-Pfade *und* den Monitor gegenseitig taub.
3. ★ **Ein Aufrufer, der Zugriff NACH dem Umhüllen holt, bekommt getappte
   Ports.** Ein einen Tick zu spät installierter Tap verpasst still, welcher
   Pfad zuerst lief — und das läse sich als „dieser Pfad sendet nichts".
4. Klick-Tap gegen ein DOM-Fragment (Beschriftung, `data-testid`).
5. Clock-Verdichtung: Zähler stimmt, Sysex dazwischen bleibt einzeln.
6. Roh-Hex wird **immer** festgehalten, auch wenn die Deutung `unbekannt`
   ergibt. Das ist der Test, der den `0x54`-Fall überhaupt erst messbar macht.
7. Datei-Senke: Pfad landet unter `userData/diagnose`, Traversal wird
   abgewiesen.

Die inhaltliche Sysex-Deutung bekommt Fixtures, **sobald echte Rahmen
aufgezeichnet sind** — nicht vorher.

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
