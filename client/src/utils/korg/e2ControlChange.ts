/**
 * Synthstudio — Electribe 2 Control-Change-Fernsteuerung (v3.269.0)
 *
 * Reine Byte-Logik, um **Parts einer echten Korg Electribe 2 per CC** zu
 * steuern. Anwendungsfall: ein Fader-Controller (AKAI MIDImix o. ä.) geht in
 * Synthstudio, Synthstudio übersetzt und schickt an die Korg weiter — der
 * Controller muss also nichts von der Korg wissen, und dieselben Fader können
 * je nach Regel mal Synthstudio, mal das Gerät bedienen.
 *
 * Adressierung auf dem Gerät: **Part = MIDI-Kanal.** Part 1 spricht auf Kanal 1,
 * Part 16 auf Kanal 16. Master-FX hängt dagegen am Global-Channel — deshalb
 * trägt jeder Parameter unten seine `scope`.
 *
 * Quelle der CC-Nummern: Korg „electribe sampler MIDI Implementation" Rev 1.00,
 * gegengelesen mit bangcorrupt/hacktribe. Zusammengefasst in
 * `omnitribe/docs/reverse/electribe2_native_sysex.md` §8.
 *
 * Abgrenzung: das hier ist **CC**, nicht Sysex und nicht NRPN. CC funktioniert
 * auf Stock-Firmware genauso wie auf Hacktribe und ist gefahrlos — es schreibt
 * nur flüchtige Klangparameter, nie Flash und nie RAM-Adressen.
 */

/** Wohin ein Parameter adressiert wird. */
export type E2ParamScope = "part" | "global";

export interface E2ParamDef {
  /** Stabiler Schlüssel für Persistenz — nie umbenennen. */
  key: string;
  /** Control-Change-Nummer auf dem Gerät. */
  cc: number;
  /** Anzeigename. */
  label: string;
  /** `part` → Part-Kanal, `global` → Global-Channel. */
  scope: E2ParamScope;
}

/**
 * Alle per CC erreichbaren Parameter.
 *
 * Reihenfolge = Anzeigereihenfolge: erst was man live anfasst (Pegel, Filter),
 * dann Hüllkurve/Modulation, dann FX.
 */
export const E2_CC_PARAMS: readonly E2ParamDef[] = [
  { key: "ampLevel",    cc: 7,   label: "Level",        scope: "part" },
  { key: "pan",         cc: 10,  label: "Pan",          scope: "part" },
  { key: "cutoff",      cc: 74,  label: "Cutoff",       scope: "part" },
  { key: "resonance",   cc: 71,  label: "Resonance",    scope: "part" },
  { key: "egAttack",    cc: 73,  label: "EG Attack",    scope: "part" },
  { key: "egDecay",     cc: 72,  label: "EG Decay",     scope: "part" },
  { key: "filterEgInt", cc: 83,  label: "Filter EG Int", scope: "part" },
  { key: "oscPitch",    cc: 80,  label: "Osc Pitch",    scope: "part" },
  { key: "oscEdit",     cc: 82,  label: "Osc Edit",     scope: "part" },
  { key: "glide",       cc: 81,  label: "Glide",        scope: "part" },
  { key: "modDepth",    cc: 85,  label: "Mod Depth",    scope: "part" },
  { key: "modSpeed",    cc: 86,  label: "Mod Speed",    scope: "part" },
  { key: "ifxEdit",     cc: 87,  label: "IFX Edit",     scope: "part" },
  { key: "ifxOnOff",    cc: 104, label: "IFX On/Off",   scope: "part" },
  { key: "mfxSend",     cc: 105, label: "MFX Send",     scope: "part" },
  { key: "mfxX",        cc: 102, label: "MFX X",        scope: "global" },
  { key: "mfxY",        cc: 103, label: "MFX Y",        scope: "global" },
  { key: "mfxOnOff",    cc: 106, label: "MFX On/Off",   scope: "global" },
] as const;

/** Anzahl adressierbarer Parts auf dem Gerät. */
export const E2_PART_COUNT = 16;

/** Parameter-Definition zu einem Schlüssel, oder `undefined`. */
export function findE2CcParam(key: string): E2ParamDef | undefined {
  return E2_CC_PARAMS.find((p) => p.key === key);
}

/** Auf gültigen 7-Bit-MIDI-Wert begrenzen (und auf Ganzzahl runden). */
export function clampMidi7(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(127, Math.round(value)));
}

/** Part-Nummer (1..16) auf gültigen Bereich begrenzen. */
export function clampPart(part: number): number {
  if (!Number.isFinite(part)) return 1;
  return Math.max(1, Math.min(E2_PART_COUNT, Math.round(part)));
}

/** MIDI-Kanal (0..15) auf gültigen Bereich begrenzen. */
export function clampChannel0(channel: number): number {
  if (!Number.isFinite(channel)) return 0;
  return Math.max(0, Math.min(15, Math.round(channel)));
}

/**
 * Der Kanal, auf dem ein Parameter gesendet wird.
 *
 * Part-Parameter gehen auf `part - 1` (Part 1 → Kanal 0). Globale Parameter
 * (Master-FX) gehen auf den Global-Channel des Geräts.
 */
export function channelForE2Param(
  param: E2ParamDef,
  part: number,
  globalChannel: number,
): number {
  return param.scope === "global"
    ? clampChannel0(globalChannel)
    : clampPart(part) - 1;
}

/**
 * Baut die fertige 3-Byte-Control-Change-Nachricht.
 *
 * @param part          1..16 (bei `scope: "global"` ignoriert)
 * @param globalChannel 0..15, für Master-FX-Parameter
 */
export function buildE2CcMessage(
  param: E2ParamDef,
  part: number,
  value: number,
  globalChannel = 0,
): [number, number, number] {
  const ch = channelForE2Param(param, part, globalChannel);
  return [0xb0 | ch, clampMidi7(param.cc), clampMidi7(value)];
}

/**
 * Skaliert einen eingehenden 0..127-Wert linear in ein Teilintervall.
 *
 * Damit lässt sich ein Fader z. B. auf „Level 40..100" begrenzen, statt immer
 * den vollen Weg bis 0 (= stumm) oder 127 (= übersteuert) zu fahren.
 * `min > max` ist zulässig und **invertiert** die Richtung — praktisch, um
 * einen Fader „falsch herum" laufen zu lassen, ohne die Hardware umzubauen.
 */
export function scaleMidiToRange(midiValue: number, min: number, max: number): number {
  const v = clampMidi7(midiValue);
  const lo = clampMidi7(min);
  const hi = clampMidi7(max);
  return clampMidi7(lo + ((hi - lo) * v) / 127);
}

/** Menschenlesbare Beschreibung, z. B. „Part 3 · Cutoff (CC 74)". */
export function describeE2Target(param: E2ParamDef, part: number): string {
  return param.scope === "global"
    ? `Global · ${param.label} (CC ${param.cc})`
    : `Part ${clampPart(part)} · ${param.label} (CC ${param.cc})`;
}
