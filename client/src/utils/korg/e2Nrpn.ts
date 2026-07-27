/**
 * e2Nrpn.ts — NRPN-Nachrichten für die Korg-E2/hacktribe-FX-Steuerung.
 *
 * NRPN ist Standard-MIDI (Control-Change), NICHT SysEx. hacktribe empfängt FX-
 * Edits über NRPN (siehe hacktribe MIDI.md):
 *   CC 0x63 (99)  NRPN-MSB  = Kategorie
 *   CC 0x62 (98)  NRPN-LSB  = FX-Slot (bei FX-Edit)
 *   CC 0x06 (6)   DATA-MSB  = Parameter-Index (bei FX-Edit)
 *   CC 0x26 (38)  DATA-LSB  = Wert (0..127)
 *
 * Kategorien (NRPN-MSB):
 *   0x00 Panel-Control (nur Device→Host, TX — senden wir nicht)
 *   0x01 FX-Edit            (Host→Device: FX-Slot / Param-Index / Wert)
 *   0x02 FX-Control-Map     (Host→Device: Map-Slot/Source/Target/Min/Max)
 *
 * Reine Byte-Bauer (kein Web-MIDI). Ein Aufruf liefert die konkatenierten CC-
 * Bytes für eine NRPN-Transaktion — in einem MIDIOutput.send() sendbar.
 */

// ─── CC-Nummern ───────────────────────────────────────────────────────────────
export const NRPN_CC = {
  MSB: 0x63, // 99
  LSB: 0x62, // 98
  DATA_MSB: 0x06, // 6
  DATA_LSB: 0x26, // 38
  DATA_INC: 0x60, // 96
  DATA_DEC: 0x61, // 97
} as const;

export const E2NrpnCategory = {
  PANEL_CONTROL: 0x00,
  FX_EDIT: 0x01,
  FX_CONTROL_MAP: 0x02,
} as const;

/**
 * FX-Slot-Adressierung (0x00..0x20 = 33 Slots). Verifiziert: hacktribe MIDI.md
 * ("FX Slot 0x00-0x20, 2 per part, one for MFX") + ht_fx_ram_format.py
 * (33 Edit-Buffer, 0..0x1F IFX + 0x20 MFX). Also 16 Parts × 2 = 32 IFX-Slots
 * (0..31) + MFX = 0x20. Slot = part*2 + which; which 0/1 = die zwei IFX pro Part
 * (hier als IFX-A/-B benannt).
 */
export const MFX_FX_SLOT = 0x20;
export function ifxFxSlot(part: number, which: 0 | 1 = 0): number {
  return (part & 0x0f) * 2 + (which & 0x01);
}

const clamp7 = (n: number) => Math.max(0, Math.min(127, Math.floor(n) || 0));
const status = (cmd: number, channel: number) =>
  (cmd | (channel & 0x0f)) & 0xff;

/** Eine CC-Nachricht (3 Bytes) auf `channel`. */
export function cc(
  channel: number,
  controller: number,
  value: number
): number[] {
  return [status(0xb0, channel), controller & 0x7f, clamp7(value)];
}

/**
 * Generische NRPN-Transaktion: NRPN-MSB/LSB + Data-Entry (MSB, optional LSB).
 * Liefert die konkatenierten CC-Bytes (12–15 Bytes).
 */
export function buildNrpn(
  channel: number,
  nrpnMsb: number,
  nrpnLsb: number,
  dataMsb: number,
  dataLsb?: number
): Uint8Array {
  const out = [
    ...cc(channel, NRPN_CC.MSB, nrpnMsb),
    ...cc(channel, NRPN_CC.LSB, nrpnLsb),
    ...cc(channel, NRPN_CC.DATA_MSB, dataMsb),
  ];
  if (dataLsb !== undefined)
    out.push(...cc(channel, NRPN_CC.DATA_LSB, dataLsb));
  return Uint8Array.from(out);
}

/**
 * FX-Edit (Kategorie 0x01): setzt in FX-Slot `fxSlot` den Parameter
 * `paramIndex` auf `value` (0..127).
 *   NRPN-MSB=0x01, NRPN-LSB=fxSlot, DATA-MSB=paramIndex, DATA-LSB=value.
 */
export function buildFxEdit(
  channel: number,
  fxSlot: number,
  paramIndex: number,
  value: number
): Uint8Array {
  return buildNrpn(
    channel,
    E2NrpnCategory.FX_EDIT,
    fxSlot & 0x7f,
    paramIndex & 0x7f,
    clamp7(value)
  );
}

/** FX-Control-Map (Kategorie 0x02): einzelnen Map-Parameter in FX-Slot setzen. */
export function buildFxControlMap(
  channel: number,
  fxSlot: number,
  mapParamIndex: number,
  value: number
): Uint8Array {
  return buildNrpn(
    channel,
    E2NrpnCategory.FX_CONTROL_MAP,
    fxSlot & 0x7f,
    mapParamIndex & 0x7f,
    clamp7(value)
  );
}

/**
 * FX-Control-Map Parameter-Indizes (DATA-MSB in Kategorie 0x02).
 * Quelle: hacktribe MIDI.md „FX Control Map parameters".
 */
export const FX_MAP_PARAM = {
  MAP_SLOT: 0,
  SOURCE_CONTROL: 1,
  TARGET_PARAM: 2,
  MIN_VALUE: 3,
  MAX_VALUE: 4,
} as const;

export interface FxControlMapSlotSpec {
  mapSlot: number; // 0..9 (10 Slots pro Preset)
  sourceControl: number; // source_control-Enum
  targetParam: number; // Index eines FX-Preset-Params
  minValue: number; // Wert bei Source-Minimum
  maxValue: number; // Wert bei Source-Maximum
}

/**
 * Konfiguriert einen kompletten FX-Control-Map-Slot: sendet die fünf NRPN-
 * Transaktionen (map_slot → source → target → min → max) als eine Byte-Sequenz.
 * hacktribe wählt per map_slot (Index 0) den aktiven Slot, danach adressieren die
 * übrigen Parameter genau diesen Slot (MIDI.md, „FX Control Map").
 */
export function buildFxControlMapSlot(
  channel: number,
  fxSlot: number,
  spec: FxControlMapSlotSpec
): Uint8Array {
  const out: number[] = [];
  const push = (paramIndex: number, value: number) =>
    out.push(...buildFxControlMap(channel, fxSlot, paramIndex, value));
  push(FX_MAP_PARAM.MAP_SLOT, spec.mapSlot);
  push(FX_MAP_PARAM.SOURCE_CONTROL, spec.sourceControl);
  push(FX_MAP_PARAM.TARGET_PARAM, spec.targetParam);
  push(FX_MAP_PARAM.MIN_VALUE, spec.minValue);
  push(FX_MAP_PARAM.MAX_VALUE, spec.maxValue);
  return Uint8Array.from(out);
}
