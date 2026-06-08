/**
 * omnitribeConnect.ts — Pure-Helper für aussagekräftiges Connect-Feedback.
 *
 * Synth.md-Bug: "Wenn man auf Connect mit Omnitribe drückt passiert nichts."
 * Ursache: der Connect-Handler loggte Fehler nur per console.warn/error — der
 * User bekam KEINE sichtbare Rückmeldung. Dieser Helper übersetzt das rohe
 * Connect-Ergebnis (Web-MIDI da? Permission? gefundene Geräte?) in eine
 * verständliche, handlungsleitende deutsche Statusmeldung fürs UI.
 */

export interface OmniTribeConnectInput {
  /** navigator.requestMIDIAccess verfügbar (Chrome/Edge/Opera, nicht Firefox/Safari). */
  webMidiSupported: boolean;
  /** Sysex-Permission wurde vom Browser/User verweigert (oder Exception). */
  permissionDenied?: boolean;
  /** Ergebnis von omniTribeBridge.connect() — true wenn In+Out-Port gematcht. */
  connected: boolean;
  /** Namen aller verfügbaren MIDI-Input-Ports. */
  inputNames: string[];
  /** Namen aller verfügbaren MIDI-Output-Ports. */
  outputNames: string[];
}

export interface OmniTribeConnectStatus {
  ok: boolean;
  message: string;
}

/** Eindeutige, sortierte Geräteliste (In + Out gemerged) für die Anzeige. */
export function listMidiDevices(input: {
  inputNames: string[];
  outputNames: string[];
}): string[] {
  const all = [...input.inputNames, ...input.outputNames]
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  return Array.from(new Set(all)).sort((a, b) => a.localeCompare(b));
}

/**
 * Übersetzt das Connect-Ergebnis in eine UI-taugliche Statusmeldung.
 * Reihenfolge der Checks = Spezifität (kein Web-MIDI → Permission → Erfolg →
 * keine Geräte → Geräte da aber kein Match).
 */
export function describeOmniTribeConnect(
  input: OmniTribeConnectInput,
): OmniTribeConnectStatus {
  if (!input.webMidiSupported) {
    return {
      ok: false,
      message:
        "Web-MIDI in diesem Browser nicht verfügbar. Bitte Chrome / Edge / " +
        "Opera nutzen — oder die Sim-Loopback-Sektion unten.",
    };
  }

  if (input.permissionDenied) {
    return {
      ok: false,
      message:
        "Sysex-Zugriff wurde verweigert. Beim Connect erscheint eine " +
        "Browser-Abfrage — diese muss erlaubt werden.",
    };
  }

  if (input.connected) {
    return { ok: true, message: "✓ Verbunden — Identity-Handshake läuft…" };
  }

  const devices = listMidiDevices(input);
  if (devices.length === 0) {
    return {
      ok: false,
      message:
        "Keine MIDI-Geräte gefunden. Ist das OmniTribe-/KORG-Gerät per USB " +
        "verbunden und eingeschaltet?",
    };
  }

  return {
    ok: false,
    message:
      "Kein OmniTribe-/KORG-Gerät erkannt. Gefundene MIDI-Geräte: " +
      devices.join(", ") +
      ". Ist dein Gerät dabei, aber wird nicht erkannt? Dann meldet die " +
      "Firmware einen abweichenden USB-Namen.",
  };
}
