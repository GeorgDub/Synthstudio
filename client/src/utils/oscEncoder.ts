/**
 * Synthstudio – OSC 1.0 Encoder/Decoder (v2.17)
 *
 * Reine TypedArray-Implementierung der OSC 1.0 Spezifikation.
 * Keine Browser-/Node-Abhängigkeiten — testbar in Vitest.
 *
 * Unterstützte Type-Tags: i (int32), f (float32), s (string), b (blob),
 * T (true), F (false), N (nil). Bundles werden NICHT unterstützt
 * (genügt für Hardware-Steuerung, keine Zeitstempel).
 *
 * Spec-Referenz: http://opensoundcontrol.org/spec-1_0.html
 */

export type OscArg = number | string | boolean | null | Uint8Array;

export interface OscMessage {
  /** Address-Pattern, z.B. "/synth/volume". Muss mit "/" beginnen. */
  address: string;
  /** Argumente in deklarierter Reihenfolge. */
  args: OscArg[];
}

// ─── Encoder ─────────────────────────────────────────────────────────────────

/**
 * Encodet eine OSC-Message in ein Uint8Array.
 * Wirft ein Error wenn die Address kein "/" am Anfang hat oder ein
 * Argument keinen unterstützten Typ besitzt.
 */
export function encodeOscMessage(msg: OscMessage): Uint8Array {
  if (!msg.address.startsWith("/")) {
    throw new Error("OSC address must start with '/'");
  }

  const addressBytes = paddedString(msg.address);
  const tagString = "," + msg.args.map(typeTagFor).join("");
  const tagBytes = paddedString(tagString);

  // Berechnung der Argument-Länge (vorab) damit wir das Buffer-Total kennen
  const argChunks: Uint8Array[] = [];
  for (const arg of msg.args) {
    argChunks.push(encodeArg(arg));
  }
  const argsLen = argChunks.reduce((sum, c) => sum + c.byteLength, 0);

  const total = addressBytes.byteLength + tagBytes.byteLength + argsLen;
  const out = new Uint8Array(total);
  let offset = 0;
  out.set(addressBytes, offset); offset += addressBytes.byteLength;
  out.set(tagBytes, offset);     offset += tagBytes.byteLength;
  for (const c of argChunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function typeTagFor(arg: OscArg): string {
  if (arg === true) return "T";
  if (arg === false) return "F";
  if (arg === null) return "N";
  if (typeof arg === "number") {
    return Number.isInteger(arg) ? "i" : "f";
  }
  if (typeof arg === "string") return "s";
  if (arg instanceof Uint8Array) return "b";
  throw new Error(`Unsupported OSC arg type: ${typeof arg}`);
}

function encodeArg(arg: OscArg): Uint8Array {
  if (arg === true || arg === false || arg === null) return new Uint8Array(0);
  if (typeof arg === "number") {
    const buf = new ArrayBuffer(4);
    const dv = new DataView(buf);
    if (Number.isInteger(arg)) dv.setInt32(0, arg, false);
    else dv.setFloat32(0, arg, false);
    return new Uint8Array(buf);
  }
  if (typeof arg === "string") return paddedString(arg);
  if (arg instanceof Uint8Array) {
    const padded = padTo4(arg.byteLength);
    const out = new Uint8Array(4 + padded);
    new DataView(out.buffer).setInt32(0, arg.byteLength, false);
    out.set(arg, 4);
    return out;
  }
  throw new Error("Unreachable");
}

function paddedString(s: string): Uint8Array {
  const enc = new TextEncoder().encode(s);
  // OSC-Strings sind null-terminiert + auf 4-Byte-Grenze gepaddet.
  const total = padTo4(enc.byteLength + 1); // +1 für null
  const out = new Uint8Array(total);
  out.set(enc, 0);
  // Restliche Bytes sind bereits 0
  return out;
}

function padTo4(n: number): number {
  return Math.ceil(n / 4) * 4;
}

// ─── Decoder ─────────────────────────────────────────────────────────────────

/**
 * Decodet ein Uint8Array in eine OSC-Message.
 * Wirft Error wenn das Format ungültig ist.
 * Bundles (führende ",#bundle") werden NICHT unterstützt — das müsste
 * der Caller vorher detecten.
 */
export function decodeOscMessage(data: Uint8Array): OscMessage {
  if (data.byteLength === 0) throw new Error("Empty OSC packet");
  if (data[0] === 0x23) {
    throw new Error("OSC bundles are not supported");
  }

  let offset = 0;
  const { value: address, end: addrEnd } = readPaddedString(data, offset);
  offset = addrEnd;
  if (!address.startsWith("/")) {
    throw new Error("OSC address must start with '/'");
  }

  const { value: tagString, end: tagEnd } = readPaddedString(data, offset);
  offset = tagEnd;
  if (!tagString.startsWith(",")) {
    throw new Error("OSC type tag string must start with ','");
  }

  const args: OscArg[] = [];
  for (let i = 1; i < tagString.length; i++) {
    const tag = tagString[i];
    if (tag === "T") { args.push(true); continue; }
    if (tag === "F") { args.push(false); continue; }
    if (tag === "N") { args.push(null); continue; }

    if (tag === "i") {
      args.push(readI32(data, offset));
      offset += 4;
    } else if (tag === "f") {
      args.push(readF32(data, offset));
      offset += 4;
    } else if (tag === "s") {
      const r = readPaddedString(data, offset);
      args.push(r.value);
      offset = r.end;
    } else if (tag === "b") {
      const size = readI32(data, offset);
      offset += 4;
      const blob = data.slice(offset, offset + size);
      offset += padTo4(size);
      args.push(blob);
    } else {
      throw new Error(`Unsupported OSC type tag: ${tag}`);
    }
  }

  return { address, args };
}

function readPaddedString(data: Uint8Array, offset: number): { value: string; end: number } {
  let end = offset;
  while (end < data.byteLength && data[end] !== 0) end++;
  if (end >= data.byteLength) throw new Error("OSC string not null-terminated");
  const value = new TextDecoder().decode(data.slice(offset, end));
  // Zur 4-Byte-Grenze inkl. Null padden
  const consumed = padTo4(end - offset + 1);
  return { value, end: offset + consumed };
}

function readI32(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset + offset, 4).getInt32(0, false);
}

function readF32(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset + offset, 4).getFloat32(0, false);
}
