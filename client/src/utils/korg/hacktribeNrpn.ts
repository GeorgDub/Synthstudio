/**
 * Synthstudio — Hacktribe-NRPN (v3.270.0)
 *
 * Reine Byte-Logik für die **NRPN-Schicht der Hacktribe-Firmware**. Das ist die
 * schreibende Erweiterung gegenüber `e2ControlChange.ts`: Stock-CC erreicht nur
 * eine Handvoll Klangparameter, NRPN erreicht FX-Parameter einzeln, das
 * Bedienfeld und sogar Motion-Sequence-Steps.
 *
 * ⚠️ **Nur mit Hacktribe-Firmware.** Das Stock-Gerät hat keine NRPN-Schicht und
 * ignoriert diese Nachrichten stillschweigend — es passiert nichts Schlimmes,
 * aber eben auch nichts. Wer nicht weiß, was auf seinem Gerät läuft, merkt es
 * genau daran.
 *
 * Rahmenformat (`hacktribe-editor/utils/ht_nrpn_format.py`):
 *
 * ```
 *   CC 0x63 (NRPN MSB) = Kategorie
 *   CC 0x62 (NRPN LSB) = Pad-Modus / FX-Slot / Step-Index / Param-Index-MSB
 *   CC 0x06 (DATA MSB) = Sub-Index
 *   CC 0x26 (DATA LSB) = Wert
 * ```
 *
 * Alle vier CCs gehören zu **einer** logischen Nachricht und müssen in dieser
 * Reihenfolge und ohne Zwischenverkehr gesendet werden.
 *
 * Bewusst NICHT hier: die Sysex-Kommandos `0x52`–`0x58` (RAM/Flash-Peek/Poke,
 * Execute, Freetribe-Loader). Die schreiben in den Adressraum eines laufenden
 * Geräts und können es unbrauchbar machen — insbesondere während das Gerät
 * spielt. NRPN dagegen ist gewöhnlicher MIDI-Verkehr: das Gerät entscheidet
 * selbst, was es damit tut, ein Fehlgriff kostet höchstens einen Power-Cycle.
 */

/** Kategorie-Byte (CC 0x63). */
export const NRPN_CATEGORY = {
  panelControl: 0,
  setFxParam: 1,
  mapFxParam: 2,
  globalParam: 3,
  sequenceParam: 9,
} as const;

export type NrpnCategory = keyof typeof NRPN_CATEGORY;

/** Die vier CC-Nummern, aus denen eine NRPN-Nachricht besteht. */
export const NRPN_CC = {
  msb: 0x63,
  lsb: 0x62,
  dataMsb: 0x06,
  dataLsb: 0x26,
} as const;

/**
 * Pad-Modi für `panelControl` (CC 0x62).
 *
 * Damit lässt sich das Bedienfeld des Geräts fernsteuern: Parts stumm schalten,
 * solo setzen, Steps löschen oder Pads triggern — von außen, ohne das Gerät
 * anzufassen. Der Sub-Index ist die Pad-/Part-Nummer, der Wert der Zustand.
 */
export const PANEL_MODE = {
  mute: 0,
  solo: 1,
  erase: 2,
  trigger: 3,
  sequencer: 4,
  keyboard: 5,
  chord: 6,
  stepJump: 7,
  patternAssign: 8,
  patternSet: 9,
} as const;

export type PanelMode = keyof typeof PANEL_MODE;

/** Anzeigenamen der Pad-Modi. */
export function labelForPanelMode(mode: PanelMode): string {
  switch (mode) {
    case "mute": return "Mute";
    case "solo": return "Solo";
    case "erase": return "Erase";
    case "trigger": return "Trigger";
    case "sequencer": return "Sequencer";
    case "keyboard": return "Keyboard";
    case "chord": return "Chord";
    case "stepJump": return "Step-Jump";
    case "patternAssign": return "Pattern-Assign";
    case "patternSet": return "Pattern-Set";
  }
}

/** Der FX-Slot-Wert für das Master-FX (statt eines Part-Slots). */
export const MFX_SLOT = 0x20;

/** Auf 0..127 begrenzen und runden — jedes NRPN-Byte ist 7-bittig. */
function b7(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(127, Math.round(v)));
}

function ch4(channel0: number): number {
  if (!Number.isFinite(channel0)) return 0;
  return Math.max(0, Math.min(15, Math.round(channel0)));
}

/** Eine einzelne 3-Byte-CC-Nachricht. */
export type MidiTriple = [number, number, number];

/**
 * Baut die vier CC-Nachrichten einer NRPN-Nachricht.
 *
 * Alle typisierten Helfer unten laufen hierüber; direkt aufrufen sollte man das
 * nur, wenn man eine Kategorie ansprechen will, für die es noch keinen Helfer
 * gibt.
 */
export function buildNrpn(
  channel0: number,
  category: number,
  lsb: number,
  dataMsb: number,
  dataLsb: number,
): MidiTriple[] {
  const status = 0xb0 | ch4(channel0);
  return [
    [status, NRPN_CC.msb, b7(category)],
    [status, NRPN_CC.lsb, b7(lsb)],
    [status, NRPN_CC.dataMsb, b7(dataMsb)],
    [status, NRPN_CC.dataLsb, b7(dataLsb)],
  ];
}

/**
 * Der FX-Slot-Index für einen Part.
 *
 * Jeder Part hat **zwei** Insert-FX-Slots; das Gerät adressiert sie flach als
 * `part * 2 + slot`. Part-Nummern kommen hier 1-basiert herein (wie überall im
 * UI), das Gerät rechnet 0-basiert.
 *
 * @param part 1..16
 * @param slot 0 oder 1 (IFX 1 / IFX 2)
 */
export function fxSlotForPart(part: number, slot: 0 | 1): number {
  const p = Math.max(1, Math.min(16, Math.round(part))) - 1;
  return p * 2 + (slot === 1 ? 1 : 0);
}

/**
 * Setzt einen einzelnen FX-Parameter.
 *
 * Der `paramIndex` zählt in den Parameter-Struct des **gerade geladenen**
 * FX-Device — er bedeutet also je nach eingestelltem Effekt etwas anderes
 * (bei einem Tape-Echo z. B. dry_wet, time_ratio, feedback …). Es gibt keine
 * geräteübergreifende Nummerierung; die Zuordnung steht in
 * `hacktribe-editor/utils/ht_fx_preset_format.py` bzw. lässt sich am Gerät
 * durch Probieren finden.
 *
 * @param fxSlot Aus {@link fxSlotForPart}, oder {@link MFX_SLOT} für Master-FX.
 */
export function buildSetFxParam(
  channel0: number,
  fxSlot: number,
  paramIndex: number,
  value: number,
): MidiTriple[] {
  return buildNrpn(channel0, NRPN_CATEGORY.setFxParam, fxSlot, paramIndex, value);
}

/**
 * Bedient das Panel des Geräts (Mute/Solo/Trigger/… pro Pad).
 *
 * @param padIndex Pad- bzw. Part-Nummer, wie das Gerät sie zählt (0-basiert).
 * @param value    Zustand — bei Schaltern 0 = aus, 1 = an.
 */
export function buildPanelControl(
  channel0: number,
  mode: PanelMode,
  padIndex: number,
  value: number,
): MidiTriple[] {
  return buildNrpn(channel0, NRPN_CATEGORY.panelControl, PANEL_MODE[mode], padIndex, value);
}

/**
 * Setzt einen Global-Parameter.
 *
 * Der Parameter-Index ist 14-bittig und wird auf LSB (high) und DATA-MSB (low)
 * aufgeteilt — anders als bei den übrigen Kategorien trägt das LSB-Byte hier
 * keinen Slot, sondern die obere Hälfte des Index.
 */
export function buildGlobalParam(
  channel0: number,
  paramIndex: number,
  value: number,
): MidiTriple[] {
  const idx = Math.max(0, Math.min(0x3fff, Math.round(paramIndex)));
  return buildNrpn(channel0, NRPN_CATEGORY.globalParam, idx >> 7, idx & 0x7f, value);
}

/**
 * Setzt einen Parameter eines einzelnen Sequencer-Steps.
 *
 * Das ist der **einzige** Weg, Motion-Sequence-Steps per MIDI zu schreiben —
 * über Stock-CC ist das nicht erreichbar. Damit lassen sich Motion-Lanes von
 * außen bespielen, statt sie am Gerät einzuknöpfeln.
 *
 * @param stepIndex 0-basierter Step im aktiven Pattern.
 */
export function buildSequenceParam(
  channel0: number,
  stepIndex: number,
  paramIndex: number,
  value: number,
): MidiTriple[] {
  return buildNrpn(channel0, NRPN_CATEGORY.sequenceParam, stepIndex, paramIndex, value);
}

/** Die fünf Felder einer FX-Parameter-Zuweisung. */
export interface FxParamMapping {
  /** Welcher der 10 Map-Slots des FX-Presets beschrieben wird. */
  mapSlot: number;
  /** Quell-Bedienelement am Gerät (`fx_on`, `fx_edit_x`, `key_part` …). */
  sourceControl: number;
  /** Ziel-Parameter im FX-Device. */
  targetParam: number;
  minValue: number;
  maxValue: number;
}

/** Reihenfolge der Sub-Indizes einer `mapFxParam`-Sequenz. */
const MAP_SUB_INDEX = {
  mapSlot: 0,
  sourceControl: 1,
  targetParam: 2,
  minValue: 3,
  maxValue: 4,
} as const;

/**
 * Verdrahtet ein Bedienelement des Geräts fest mit einem FX-Parameter.
 *
 * Anders als {@link buildSetFxParam}, das einen Wert einmalig setzt, ändert das
 * hier die **Zuweisung** im FX-Preset: danach fährt der X/Y-Regler oder ein Pad
 * des Geräts diesen Parameter selbst — auch ohne Synthstudio am Kabel.
 *
 * Besteht aus fünf NRPN-Nachrichten (20 CCs) und muss vollständig in dieser
 * Reihenfolge ankommen; eine halb übertragene Zuweisung hinterlässt einen
 * gemischten Zustand.
 */
export function buildMapFxParam(
  channel0: number,
  fxSlot: number,
  mapping: FxParamMapping,
): MidiTriple[] {
  const cat = NRPN_CATEGORY.mapFxParam;
  return [
    ...buildNrpn(channel0, cat, fxSlot, MAP_SUB_INDEX.mapSlot, mapping.mapSlot),
    ...buildNrpn(channel0, cat, fxSlot, MAP_SUB_INDEX.sourceControl, mapping.sourceControl),
    ...buildNrpn(channel0, cat, fxSlot, MAP_SUB_INDEX.targetParam, mapping.targetParam),
    ...buildNrpn(channel0, cat, fxSlot, MAP_SUB_INDEX.minValue, mapping.minValue),
    ...buildNrpn(channel0, cat, fxSlot, MAP_SUB_INDEX.maxValue, mapping.maxValue),
  ];
}

/**
 * Quell-Bedienelemente für {@link buildMapFxParam}.
 *
 * Werte aus `ht_fx_preset_format.py` (Preset-Format). Achtung: das
 * **RAM**-Format derselben Struktur benutzt die kleinen Werte 0x01–0x0A für
 * dieselben Elemente — beim direkten RAM-Schreiben also nicht diese Tabelle
 * verwenden.
 */
export const FX_SOURCE_CONTROL = {
  none: 0x00,
  fxOn: 0x41,
  fxEditX: 0x42,
  fxEditY: 0x43,
  fxEditXHi: 0x44,
  fxEditXLo: 0x45,
  fxEditYHi: 0x46,
  fxEditYLo: 0x47,
  keyPart: 0x48,
  keyGlobal: 0x49,
  pressPlay: 0x4a,
} as const;

export type FxSourceControl = keyof typeof FX_SOURCE_CONTROL;

/** Stabile Anzeigereihenfolge (X/Y zuerst — die fasst man am Gerät an). */
export const FX_SOURCE_CONTROL_KEYS: readonly FxSourceControl[] = [
  "none",
  "fxEditX",
  "fxEditY",
  "fxOn",
  "fxEditXHi",
  "fxEditXLo",
  "fxEditYHi",
  "fxEditYLo",
  "keyPart",
  "keyGlobal",
  "pressPlay",
] as const;

/** Anzeigename eines Quell-Bedienelements. */
export function labelForFxSourceControl(key: FxSourceControl): string {
  switch (key) {
    case "none": return "— keins —";
    case "fxOn": return "FX On/Off";
    case "fxEditX": return "FX Edit X";
    case "fxEditY": return "FX Edit Y";
    case "fxEditXHi": return "FX Edit X (hoch)";
    case "fxEditXLo": return "FX Edit X (tief)";
    case "fxEditYHi": return "FX Edit Y (hoch)";
    case "fxEditYLo": return "FX Edit Y (tief)";
    case "keyPart": return "Key (Part)";
    case "keyGlobal": return "Key (global)";
    case "pressPlay": return "Play-Taste";
  }
}

/** Anzahl der Map-Slots eines FX-Presets (`control_map`, 10 × 28 B). */
export const FX_MAP_SLOT_COUNT = 10;
