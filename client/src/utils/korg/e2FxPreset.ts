/**
 * Synthstudio — Electribe-2-FX-Preset dekodieren (v3.286.0)
 *
 * Reine Byte-Logik für den 524-Byte-FX-Preset der Electribe 2. Gegenstück zum
 * RAM-Werkzeug (`hacktribeRam.ts`): das liest die Bytes, das hier deutet sie.
 *
 * Wozu: ohne Dekodierung liefert ein Preset-Slot einen Hex-Dump, und
 * `map_fx_param` (Geräte-Regler fest verdrahten) ist **schreibend, aber nicht
 * nachprüfbar** — man verdrahtet einen Regler und sieht nirgends, ob es ankam.
 * Mit diesem Modul lässt sich der geschriebene Slot zurücklesen und vorzeigen.
 *
 * Quelle des Layouts: `omnitribe/docs/reverse/hacktribe_ram_and_formats.md` §2,
 * verifiziert gegen `hacktribe-editor/utils/ht_fx_preset_format.py`.
 *
 * ⚠️ **Zwei Kodierungen für `source_control`.** Das Preset-*Datei*-Format
 * benutzt `0x41`–`0x4A`, das **RAM**-Format `0x01`–`0x0A` für dieselben
 * Bedienelemente. Wir lesen aus RAM, also ist RAM die Vorgabe — bewiesen ist es
 * nicht (siehe {@link FxSourceEncoding}). Deshalb ist die Kodierung ein
 * Parameter und keine Annahme, und beide Tabellen sind exportiert.
 *
 * Was hier **nicht** dekodiert wird: die device-abhängigen Parameter-Structs
 * (`ifx_1_params` @ `0x135` usw.). Deren Feldnamen stehen ausschließlich in
 * `ht_fx_preset_format.py` (21 IFX- + 25 MFX-Structs) und liegen uns nicht vor.
 * Die Rohbytes werden mitgeliefert, damit sie sichtbar sind statt zu fehlen.
 */
import {
  FX_SOURCE_CONTROL,
  labelForFxSourceControl,
  type FxSourceControl,
} from "./hacktribeNrpn";

/** Größe eines FX-Presets in Bytes. */
export const FX_PRESET_SIZE = 0x20c;

/** Länge eines einzelnen `fx_control`-Eintrags. */
export const FX_CONTROL_SIZE = 28;

/** Anzahl der Zuweisungs-Slots pro Preset. */
export const FX_CONTROL_SLOTS = 10;

// ─── Offsets (hacktribe_ram_and_formats.md §2) ──────────────────────────────

const OFF = {
  name: 0x01,
  nameLen: 15,
  controlMap: 0x12,
  ifx1Device: 0x12a,
  ifx1PostLevel: 0x12b,
  ifx1SlotIndex: 0x12e,
  ifx1PreLevel: 0x12f,
  ifx1Params: 0x135,
  ifx2Device: 0x174,
  ifx2PostLevel: 0x175,
  ifx2SlotIndex: 0x178,
  ifx2PreLevel: 0x179,
  ifx2Params: 0x17f,
  mfxDevice: 0x1be,
  mfxPostLevel: 0x1bf,
  mfxSlotIndex: 0x1c2,
  mfxPreLevel: 0x1c3,
  mfxParams: 0x1c9,
  unkLevels: 0x209,
} as const;

// ─── Device-Tabellen ────────────────────────────────────────────────────────

/**
 * Insert-FX-Devices.
 *
 * Die Lücken in der Numerierung (`0x0B`–`0x0E`, `0x17`, `0x19`–`0x26`) sind echt
 * — Hacktribes Enum ist nicht dicht. Unbekannte IDs werden deshalb als solche
 * angezeigt und nicht auf den nächsten Nachbarn geraten.
 */
export const IFX_DEVICES: Readonly<Record<number, string>> = {
  0x00: "No FX (Thru)",
  0x01: "MKP2 Compressor",
  0x02: "SR1 Compressor",
  0x03: "Cheap Compressor",
  0x04: "Punch",
  0x05: "Limiter",
  0x06: "EQ 2-Band",
  0x07: "EQ 4-Band",
  0x08: "Exciter",
  0x09: "Decimator",
  0x0a: "Filter",
  0x0f: "Distortion",
  0x10: "Acid Driver",
  0x11: "Chorus",
  0x12: "Flanger",
  0x13: "Phaser",
  0x14: "Tremolo",
  0x15: "Level Mod",
  0x16: "Ring Mod",
  0x18: "Short Delay",
  0x27: "No FX (Mute)",
};

/** Master-FX-Devices. */
export const MFX_DEVICES: Readonly<Record<number, string>> = {
  0x00: "No FX (Thru)",
  0x27: "No FX (Mute)",
  0x28: "MKP2 Compressor",
  0x29: "SR1 Compressor",
  0x2a: "Limiter",
  0x2b: "EQ 4-Band",
  0x2c: "Wah",
  0x2d: "Multimode Filter",
  0x2e: "Distortion",
  0x2f: "Tube Pre",
  0x31: "Chorus",
  0x32: "Flanger",
  0x33: "Phaser",
  0x34: "Tremolo",
  0x35: "Level Mod",
  0x36: "Hall Reverb",
  0x37: "Smooth Hall",
  0x38: "Wet Plate Reverb",
  0x39: "Dry Plate Reverb",
  0x3a: "Room Reverb",
  0x3b: "Mod Delay",
  0x3c: "Tape Echo",
  0x3d: "Grain Shifter",
  0x3e: "Decimator",
  0x3f: "KPQ Looper",
  0x40: "Vinyl Break",
};

/**
 * Devices, die im **zweiten** Insert-Slot erlaubt sind.
 *
 * Das Gerät lässt IFX 2 nur zu, wenn IFX 1 „leicht" ist. Steht in IFX 2 etwas
 * außerhalb dieser Liste, ist entweder die Interpretation falsch oder der Slot
 * ungenutzt — beides ist eine Anzeige wert.
 */
export const IFX2_WHITELIST: ReadonlySet<number> = new Set([
  0x00, 0x03, 0x04, 0x06, 0x0a, 0x10, 0x27,
]);

/** Kette, auf die sich ein `chain_index` bezieht. */
export const CHAIN_INDEX: Readonly<Record<number, string>> = {
  0x00: "IFX 1",
  0x01: "IFX 2",
  0x02: "MFX",
  0x07: "Input Level",
  0x0a: "Output Level",
};

/**
 * `source_control` im **RAM**-Format (`ht_fx_ram_format.py`).
 *
 * Dieselben Bedienelemente wie {@link FX_SOURCE_CONTROL}, aber mit den Werten
 * `0x01`–`0x0A` statt `0x41`–`0x4A`.
 */
export const FX_SOURCE_CONTROL_RAM: Readonly<Record<FxSourceControl, number>> = {
  none: 0x00,
  fxOn: 0x01,
  fxEditX: 0x02,
  fxEditY: 0x03,
  fxEditXHi: 0x04,
  fxEditXLo: 0x05,
  fxEditYHi: 0x06,
  fxEditYLo: 0x07,
  keyPart: 0x08,
  keyGlobal: 0x09,
  pressPlay: 0x0a,
};

/**
 * Welche der beiden Kodierungen gilt.
 *
 * `"ram"` ist die Vorgabe, weil wir aus dem RAM lesen — **belegt ist das
 * nicht.** Die Gegenprobe am Gerät: eine Zuweisung mit `fxEditX` senden, den
 * Slot zurücklesen und nachsehen, ob `0x42` (Preset) oder `0x02` (RAM) im Byte
 * steht.
 */
export type FxSourceEncoding = "ram" | "preset";

// ─── Hilfsfunktionen ────────────────────────────────────────────────────────

function u8(bytes: Uint8Array, offset: number): number {
  return bytes[offset] ?? 0;
}

/** Anzeigename eines Devices, oder eine ehrliche Fehlanzeige. */
export function labelForIfxDevice(id: number): string {
  return IFX_DEVICES[id] ?? `unbekannt (0x${id.toString(16).toUpperCase().padStart(2, "0")})`;
}

/** Anzeigename eines Master-FX-Devices, oder eine ehrliche Fehlanzeige. */
export function labelForMfxDevice(id: number): string {
  return MFX_DEVICES[id] ?? `unbekannt (0x${id.toString(16).toUpperCase().padStart(2, "0")})`;
}

/** Anzeigename einer Ketten-Position. */
export function labelForChainIndex(id: number): string {
  return CHAIN_INDEX[id] ?? `unbekannt (0x${id.toString(16).toUpperCase().padStart(2, "0")})`;
}

/**
 * Anzeigename eines Quell-Bedienelements in der gewählten Kodierung.
 *
 * Die Beschriftung selbst kommt aus `hacktribeNrpn.ts` — die Tabelle dort ist
 * die Quelle, hier wird nur der Zahlenwert aufgelöst.
 */
export function labelForSourceControl(value: number, encoding: FxSourceEncoding): string {
  const key = sourceKeyFor(value, encoding);
  if (!key) return `unbekannt (0x${value.toString(16).toUpperCase().padStart(2, "0")})`;
  return labelForFxSourceControl(key);
}

/** Der Schlüssel zu einem Rohwert, oder `null` bei unbekanntem Code. */
function sourceKeyFor(value: number, encoding: FxSourceEncoding): FxSourceControl | null {
  const table = encoding === "ram" ? FX_SOURCE_CONTROL_RAM : FX_SOURCE_CONTROL;
  return (Object.keys(table) as FxSourceControl[]).find((k) => table[k] === value) ?? null;
}

// ─── fx_control ─────────────────────────────────────────────────────────────

export interface FxControlSlot {
  /** Slot-Nummer 0..9 innerhalb des Presets. */
  index: number;
  /** Rohwert des Quell-Bedienelements. */
  sourceControl: number;
  /** Schlüssel des Bedienelements, oder `null` bei unbekanntem Code. */
  sourceKey: FxSourceControl | null;
  /** Rohwert der Ketten-Position. */
  chainIndex: number;
  /** Ziel-Parameter im FX-Device (Index, kein Name — siehe Modul-Doku). */
  targetParam: number;
  minValue: number;
  maxValue: number;
  /** Slot belegt? `source_control == 0` heißt frei. */
  assigned: boolean;
}

/**
 * Dekodiert einen einzelnen 28-Byte-`fx_control`.
 *
 * Feldlage: `source_control`(1), `chain_index`(1), `target_param`(1), pad,
 * `min_value`(1), pad, `max_value`(1), Padding(21).
 */
export function parseFxControl(
  bytes: Uint8Array,
  encoding: FxSourceEncoding = "ram",
  index = 0,
): FxControlSlot {
  if (bytes.length < 7) {
    throw new RangeError(`fx_control braucht mindestens 7 Bytes, bekam ${bytes.length}`);
  }
  const sourceControl = u8(bytes, 0);

  return {
    index,
    sourceControl,
    sourceKey: sourceKeyFor(sourceControl, encoding),
    chainIndex: u8(bytes, 1),
    targetParam: u8(bytes, 2),
    minValue: u8(bytes, 4),
    maxValue: u8(bytes, 6),
    assigned: sourceControl !== 0,
  };
}

// ─── Preset ─────────────────────────────────────────────────────────────────

export interface FxSlotInfo {
  /** Rohwert des Device-Bytes. */
  device: number;
  /** Anzeigename. */
  deviceName: string;
  preLevel: number;
  postLevel: number;
  slotIndex: number;
  /**
   * Die Parameter-Bytes des Devices, unausgewertet.
   *
   * Muster laut Doku: 1 Byte Wert + 1 Byte Padding. Ohne die Struct-Definition
   * pro Device (`ht_fx_preset_format.py`) lassen sich die Felder nicht
   * benennen — die Rohbytes sind trotzdem nützlich, um Änderungen zu sehen.
   */
  rawParams: Uint8Array;
}

export interface E2FxPreset {
  /** Preset-Name, auf druckbare ASCII-Zeichen beschränkt. */
  name: string;
  ifx1: FxSlotInfo;
  ifx2: FxSlotInfo;
  mfx: FxSlotInfo;
  /** Alle zehn Zuweisungs-Slots, auch die freien. */
  controlMap: FxControlSlot[];
  /** Welche Kodierung beim Dekodieren angenommen wurde. */
  encoding: FxSourceEncoding;
}

function readName(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < OFF.nameLen; i++) {
    const c = u8(bytes, OFF.name + i);
    if (c === 0) break;
    // Nicht-druckbares wird verworfen statt als Kästchen angezeigt: der Name
    // ist ein Anhaltspunkt, kein Datenfeld, an dem etwas hängt.
    if (c >= 0x20 && c < 0x7f) out += String.fromCharCode(c);
  }
  return out.trimEnd();
}

function readSlot(
  bytes: Uint8Array,
  deviceOff: number,
  postOff: number,
  slotOff: number,
  preOff: number,
  paramsOff: number,
  paramsEnd: number,
  isMfx: boolean,
): FxSlotInfo {
  const device = u8(bytes, deviceOff);
  return {
    device,
    deviceName: isMfx ? labelForMfxDevice(device) : labelForIfxDevice(device),
    postLevel: u8(bytes, postOff),
    slotIndex: u8(bytes, slotOff),
    preLevel: u8(bytes, preOff),
    rawParams: bytes.slice(paramsOff, Math.min(paramsEnd, bytes.length)),
  };
}

/**
 * Dekodiert einen kompletten 524-Byte-FX-Preset.
 *
 * @throws RangeError wenn der Puffer zu kurz ist — lieber ein klarer Fehler als
 *         stillschweigend über die Grenze gelesene Nullen, die wie echte Daten
 *         aussehen.
 */
export function parseFxPreset(
  bytes: Uint8Array,
  opts: { encoding?: FxSourceEncoding } = {},
): E2FxPreset {
  if (bytes.length < FX_PRESET_SIZE) {
    throw new RangeError(
      `FX-Preset braucht ${FX_PRESET_SIZE} Bytes, bekam ${bytes.length}`,
    );
  }
  const encoding = opts.encoding ?? "ram";

  const controlMap: FxControlSlot[] = [];
  for (let i = 0; i < FX_CONTROL_SLOTS; i++) {
    const start = OFF.controlMap + i * FX_CONTROL_SIZE;
    controlMap.push(
      parseFxControl(bytes.subarray(start, start + FX_CONTROL_SIZE), encoding, i),
    );
  }

  return {
    name: readName(bytes),
    ifx1: readSlot(bytes, OFF.ifx1Device, OFF.ifx1PostLevel, OFF.ifx1SlotIndex,
      OFF.ifx1PreLevel, OFF.ifx1Params, OFF.ifx2Device, false),
    ifx2: readSlot(bytes, OFF.ifx2Device, OFF.ifx2PostLevel, OFF.ifx2SlotIndex,
      OFF.ifx2PreLevel, OFF.ifx2Params, OFF.mfxDevice, false),
    mfx: readSlot(bytes, OFF.mfxDevice, OFF.mfxPostLevel, OFF.mfxSlotIndex,
      OFF.mfxPreLevel, OFF.mfxParams, OFF.unkLevels, true),
    controlMap,
    encoding,
  };
}

/** Ist der IFX-2-Slot mit einem dort erlaubten Device belegt? */
export function isIfx2Allowed(device: number): boolean {
  return IFX2_WHITELIST.has(device);
}

/** Nur die belegten Zuweisungs-Slots. */
export function assignedControls(preset: E2FxPreset): FxControlSlot[] {
  return preset.controlMap.filter((c) => c.assigned);
}

/**
 * Mehrzeilige Zusammenfassung für die Anzeige.
 *
 * Bewusst Text und kein JSX: so ist sie ohne Renderer testbar und lässt sich
 * auch in eine Fehlermeldung oder die Zwischenablage stecken.
 */
export function formatFxPresetSummary(preset: E2FxPreset): string {
  const lines: string[] = [];
  lines.push(`Name: ${preset.name || "(leer)"}`);
  lines.push(`IFX 1: ${preset.ifx1.deviceName}  pre ${preset.ifx1.preLevel} / post ${preset.ifx1.postLevel}`);
  lines.push(
    `IFX 2: ${preset.ifx2.deviceName}  pre ${preset.ifx2.preLevel} / post ${preset.ifx2.postLevel}` +
      (isIfx2Allowed(preset.ifx2.device) ? "" : "  ⚠ nicht in der IFX-2-Whitelist"),
  );
  lines.push(`MFX:   ${preset.mfx.deviceName}  pre ${preset.mfx.preLevel} / post ${preset.mfx.postLevel}`);

  const assigned = assignedControls(preset);
  if (assigned.length === 0) {
    lines.push("Zuweisungen: keine");
  } else {
    lines.push(`Zuweisungen (${assigned.length}/${FX_CONTROL_SLOTS}):`);
    for (const c of assigned) {
      const src = c.sourceKey ?? `0x${c.sourceControl.toString(16).toUpperCase()}`;
      lines.push(
        `  [${c.index}] ${src} → ${labelForChainIndex(c.chainIndex)} Param ${c.targetParam}` +
          `  (${c.minValue}..${c.maxValue})`,
      );
    }
  }
  return lines.join("\n");
}
