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
 * FX-Slot-Adressierung (0x00..0x20). hacktribe MIDI.md: "2 per part, one for
 * MFX". Annahme: Slot = part*2 + which (which 0/1 = IFX-A/-B), MFX = 0x20.
 * ⚠️ Gegen hacktribe-editor gegenprüfen, bevor als final behandelt.
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

/** FX-Control-Map (Kategorie 0x02): Map-Parameter in FX-Slot setzen. */
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
