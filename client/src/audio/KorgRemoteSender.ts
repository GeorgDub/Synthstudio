/**
 * Synthstudio — Korg-Remote-Sender (v3.269.0)
 *
 * Seiteneffekt-Schicht der CC-Fernsteuerung: nimmt ein eingehendes
 * Controller-CC entgegen, lässt `utils/korg/korgRemote.ts` daraus
 * Electribe-Nachrichten bauen und schickt sie an den Electribe-Ausgang.
 *
 * Wird pro eingehender CC-Nachricht aus dem MIDI-Handler aufgerufen, also
 * potenziell hunderte Male pro Sekunde. Entsprechend die zwei Regeln hier:
 *
 *   1. **Früh und billig aussteigen.** Ist die Fernsteuerung aus oder gibt es
 *      keine passende Regel, wird nichts angefasst — kein `await`, kein
 *      MIDIAccess, keine Allokation über das Nötigste hinaus.
 *   2. **Nie werfen.** Ein Fehler beim Senden darf die MIDI-Verarbeitung von
 *      Synthstudio nicht abreißen lassen.
 *
 * Der MIDIAccess wird beim ersten wirklich zu sendenden Wert asynchron geholt
 * und danach gecacht; der allererste Fader-Zucker kann dadurch verloren gehen.
 * Das ist bei einem kontinuierlichen Regler folgenlos — der nächste Wert (nur
 * Millisekunden später) kommt an.
 */
import { getE2MidiAccess, resolveE2Output } from "./E2NativeSysexTransfer";
import { getKorgRemoteState } from "../store/useKorgRemoteStore";
import { buildKorgRemoteMessages, type IncomingCc } from "../utils/korg/korgRemote";

let _cachedOutput: MIDIOutput | null = null;
let _resolving = false;

/** Der zuletzt gesendete Wert je Ziel — treibt Anzeige und Tests. */
export interface KorgRemoteActivity {
  /** Beschreibung des Ziels, z. B. „Part 3 · Cutoff (CC 74)". */
  label: string;
  value: number;
}

let _lastActivity: KorgRemoteActivity | null = null;

/** Zuletzt an das Gerät gesendeter Wert, oder `null`. */
export function getKorgRemoteLastActivity(): KorgRemoteActivity | null {
  return _lastActivity;
}

/**
 * Holt (und cacht) den Electribe-Ausgang. Läuft absichtlich „fire and forget":
 * der Aufrufer wartet nicht, damit der MIDI-Handler synchron bleibt.
 */
function ensureOutputAsync(): void {
  if (_cachedOutput || _resolving) return;
  _resolving = true;
  void getE2MidiAccess()
    .then((access) => {
      _cachedOutput = access ? resolveE2Output(access) : null;
    })
    .catch(() => {
      _cachedOutput = null;
    })
    .finally(() => {
      _resolving = false;
    });
}

/**
 * Übersetzt ein eingehendes Controller-CC und schickt das Ergebnis an die Korg.
 *
 * Konsumiert die Nachricht **nicht** — dasselbe CC darf zusätzlich ein
 * Synthstudio-internes Mapping bedienen. Wer das nicht will, legt für den
 * betreffenden Regler schlicht kein internes Mapping an.
 *
 * @param channel MIDI-Kanal 1..16 (wie von `useMidi` geliefert).
 * @returns Anzahl der tatsächlich gesendeten Nachrichten.
 */
export function relayCcToKorg(channel: number, cc: number, value: number): number {
  const state = getKorgRemoteState();
  if (!state.enabled || state.rules.length === 0) return 0;

  const msg: IncomingCc = { cc, channel, value };
  const outgoing = buildKorgRemoteMessages(state.rules, msg, state.globalChannel);
  if (outgoing.length === 0) return 0;

  if (!_cachedOutput) {
    ensureOutputAsync();
    return 0;
  }

  let sent = 0;
  for (const m of outgoing) {
    try {
      _cachedOutput.send(m.bytes);
      sent += 1;
      _lastActivity = {
        label:
          m.param.scope === "global"
            ? `Global · ${m.param.label}`
            : `Part ${m.rule.part} · ${m.param.label}`,
        value: m.value,
      };
    } catch {
      // Port im laufenden Betrieb abgezogen: Cache verwerfen, beim nächsten
      // Wert wird neu aufgelöst. Kein Toast — bei 100 Werten/s wäre das eine
      // Lawine.
      _cachedOutput = null;
      break;
    }
  }
  return sent;
}

/**
 * Verwirft den gecachten Ausgang. Nach einem Port-Wechsel in den Einstellungen
 * aufrufen, damit die nächste Bewegung neu auflöst.
 */
export function invalidateKorgRemoteOutput(): void {
  _cachedOutput = null;
}

/** Test-only: Cache und Aktivität zurücksetzen, optional Output injizieren. */
export function __setKorgRemoteOutputForTests(out: MIDIOutput | null): void {
  _cachedOutput = out;
  _resolving = false;
  _lastActivity = null;
}
