# Step-Record: Synthstudios Layout ist um einen Platz verschoben

**Stand:** 2026-08-14 · **Betrifft:** `client/src/utils/korg/e2Layout.ts`,
`e2Sysex.ts`, `e2PatternEdit.ts`, `e2PatternToSynthstudio.ts`,
`synthstudioToE2Pattern.ts`

**Beleg:** Gerätemessung an der Electribe 2 Sampler, siehe Omnitribe
`docs/hwtest/sitzung_2026-08-14.md` und `docs/formats/e2spat_step_record.md`.
TekkForge hat die Korrektur in `main` (Commits `60f2bca` … `349f80f`).

Dieses Dokument beschreibt **nur den Befund**. Der Code ist absichtlich noch
nicht angefasst: die Konstanten haben viele Nutzer, und die Umstellung gehört in
einen eigenen, getesteten Durchgang statt nebenbei auf einen fremden
Feature-Branch.

---

## Der Unterschied

| Offset | Synthstudio heute | tatsächlich (am Gerät gemessen) |
|---|---|---|
| `+0` | Trigger | Trigger ✔ |
| `+1` | **Note** | **Gate-Zeit** (0..96, 127 = Tie) |
| `+2` | Velocity | Velocity ✔ |
| `+3` | Gate-Flag | Flag, **Bedeutung unbekannt** |
| `+4` | Gate-Länge | **Note 1** |
| `+5..+7` | Akkordtöne 2..4 | **Noten 2..4** |

Alles ab `+1` ist um einen Platz verschoben. Die Akkordtöne sind erkannt worden,
sitzen aber einen Slot zu hoch — `+4` wird für Gate-Länge gehalten und dabei als
Note verworfen.

## Warum `+1` keine Note sein kann

In der Werksbank `e2s-2016.e2sallpat` (250 Patterns, 43 099 aktive Steps):

```
Byte +1, häufigste Werte:   72 ×18130    255 ×14448    63 ×385    65 ×300
Byte +1 > 128:              14448 Vorkommen, Maximum 255
```

**14 448 aktive Steps tragen an `+1` den Wert 255.** Als Notennummer ist das
unmöglich — MIDI endet bei 127, und selbst mit der tatsächlichen
MIDI+1-Kodierung wäre 128 das Maximum. Der häufigste Wert 72 ist die
Gate-Vorgabe, 255 der Tie-Sentinel der Werksdateien.

Das allein widerlegt das aktuelle Layout, ganz ohne Gerät.

## Zwei Folgefehler, die daran hängen

**Noten sind um einen Halbton verschoben.** Das Gerät speichert `Byte = MIDI + 1`,
die 0 bleibt als „kein Ton" frei. Beleg: eine am Gerät gesetzte G9 (MIDI 127)
liegt als **128** im Speicher — roh unmöglich. Deshalb ist C4 die **61**, nicht
die 60; in der Werksbank ist 61 mit 35 872 Vorkommen der häufigste Notenwert.

`E2_DEFAULT_NOTE = 0x48` in `e2PatternToSynthstudio.ts` stammt ebenfalls aus dem
alten Layout: 0x48 = 72 ist der Gate-Vorgabewert, keine Note.

**Motion-Tabellen vertauscht.** `0x100` ist das **Ziel** (Part 1..16, 17 =
global), `0x118` die **Parameter-Kennung** — nicht umgekehrt. Am Gerät ergab
derselbe Parameter auf zwei Parts in `0x100` verschiedene Werte und in `0x118`
denselben. Zusätzlich: `0x118` nimmt in 250 Werkspatterns nie den Wert 1 an —
als Ziel-Part hieße das, Part 1 hätte nirgends eine Motion.

## Was beim Portieren zu beachten ist

- **Lese- und Schreibpfad benutzen dieselben Konstanten.** Solange beide
  konsistent falsch sind, fällt nichts auf: Dateien round-trippen sauber und
  klingen trotzdem falsch. Ein grüner Test beweist hier nichts.
- **Golden-Fixtures prüfen, bevor man ihnen glaubt.** In TekkForge enthielten
  sie dieselbe Annahme wie der Code und haben den Fehler jahrelang gedeckt.
- **Voice Assign nicht vergessen** (Part-Offset `0x02`, Poly 2 = 3). Ohne Poly
  spielt das Gerät von einem gespeicherten Vierklang nur eine Note — der
  Speicher sieht dabei korrekt aus, der Fehler ist ausschließlich hörbar.
- **Tie:** schreiben mit 127, lesen sowohl 127 als auch 255 akzeptieren. Über
  SysEx übernimmt das Gerät keinen Tie (es begrenzt auf 96), über SD-Karte
  schon.

Referenzimplementierung: TekkForge `src/core/e2StepNote.ts` (Kodierung mit
Messtabelle) und `src/core/e2sExport.ts` (Schreibpfad inkl. der vier
Notenplätze).
