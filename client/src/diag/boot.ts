/**
 * Diagnose-Log — Zündung.
 *
 * ☠ Der Start passiert hier als Modul-SEITENEFFEKT, nicht als Aufruf in
 * `main.tsx`. Grund: ES-Module werden vollständig ausgewertet, bevor auch nur
 * die erste Anweisung der importierenden Datei läuft. Ein `starteDiagnose()`
 * unter den Importen wäre also NACH `./App` dran — und alles, was dort beim
 * Auswerten schon `requestMIDIAccess` anfasst, liefe am Log vorbei.
 *
 * Deshalb: dieses Modul als ERSTEN Import in `main.tsx`, dann greift der Tap
 * vor jedem anderen Modul.
 */
import { starteDiagnose } from "./index";

starteDiagnose();
