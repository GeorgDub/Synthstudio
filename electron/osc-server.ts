/**
 * electron/osc-server.ts — Direkter UDP-OSC-Listener (v2.23).
 *
 * v2.17 hat den OSC-Encoder/Decoder + Bindings in pure utils gebaut, aber
 * keine Network-Schicht — bisher nur via WebSocket-Bridge nutzbar. Dieses
 * Modul öffnet einen `dgram`-UDP-Socket (nur in Electron-Main verfügbar)
 * und reicht jede empfangene OSC-Message via IPC an den Renderer.
 *
 * Sicherheit:
 *  - Default-Bind ist 127.0.0.1 (localhost-only), nicht 0.0.0.0. User kann
 *    explizit "accept from network" toggeln.
 *  - Port wird auf 1024..65535 geclampt (keine privileged ports ohne
 *    Admin-Privilegien — würden eh sofort EACCES werfen).
 *  - decodeOscMessage wirft auf Bundles oder unbekannte Tags — wir
 *    schicken nichts an den Renderer was nicht sauber parsbar war.
 *  - Singleton: nur ein Listener gleichzeitig.
 */
import * as dgram from "dgram";
import type { BrowserWindow } from "electron";

interface OscPayload {
  address: string;
  args: Array<number | string | boolean | null>;
  source: string; // "ip:port" für UI-Diagnose
  at: number;     // Date.now() für UI-Diagnose
}

interface ListenerState {
  socket: dgram.Socket | null;
  port: number | null;
  bindHost: string | null;
  lastMessage: OscPayload | null;
  receivedCount: number;
  errorCount: number;
}

const _state: ListenerState = {
  socket: null,
  port: null,
  bindHost: null,
  lastMessage: null,
  receivedCount: 0,
  errorCount: 0,
};

// Minimaler OSC-Decoder, dupliziert aus client/src/utils/oscEncoder.ts.
// Bewusst nicht imported weil der client-Pfad in Electron-Main nicht via
// tsconfig.electron.json erreichbar ist und ich die Dependency-Surface
// klein halten möchte. Wenn das je auseinanderläuft, fängt der
// utils/oscEncoder.test.ts den client-Pfad ab — die Server-Variante hier
// ist absichtlich ein Subset (kein Bundle, keine Blobs).
function padTo4(n: number): number { return Math.ceil(n / 4) * 4; }

function readPaddedString(data: Buffer, offset: number): { value: string; end: number } {
  let end = offset;
  while (end < data.length && data[end] !== 0) end++;
  if (end >= data.length) throw new Error("OSC string not null-terminated");
  const value = data.slice(offset, end).toString("utf8");
  const consumed = padTo4(end - offset + 1);
  return { value, end: offset + consumed };
}

function decodeOscMessageBuf(data: Buffer): OscPayload {
  if (data.length === 0) throw new Error("Empty OSC packet");
  if (data[0] === 0x23) throw new Error("OSC bundles not supported");
  let offset = 0;
  const { value: address, end: addrEnd } = readPaddedString(data, offset);
  offset = addrEnd;
  if (!address.startsWith("/")) throw new Error("OSC address must start with '/'");
  const { value: tagString, end: tagEnd } = readPaddedString(data, offset);
  offset = tagEnd;
  if (!tagString.startsWith(",")) throw new Error("OSC type tag must start with ','");
  const args: OscPayload["args"] = [];
  for (let i = 1; i < tagString.length; i++) {
    const tag = tagString[i];
    if (tag === "T") { args.push(true); continue; }
    if (tag === "F") { args.push(false); continue; }
    if (tag === "N") { args.push(null); continue; }
    if (tag === "i") { args.push(data.readInt32BE(offset)); offset += 4; }
    else if (tag === "f") { args.push(data.readFloatBE(offset)); offset += 4; }
    else if (tag === "s") {
      const r = readPaddedString(data, offset);
      args.push(r.value);
      offset = r.end;
    } else {
      throw new Error(`Unsupported OSC tag: ${tag}`);
    }
  }
  return { address, args, source: "", at: Date.now() };
}

export interface OscStartOptions {
  port: number;
  acceptFromNetwork?: boolean;
}

export interface OscStatus {
  listening: boolean;
  port: number | null;
  bindHost: string | null;
  receivedCount: number;
  errorCount: number;
  lastMessage: OscPayload | null;
}

export function startOscServer(
  options: OscStartOptions,
  mainWindow: BrowserWindow | null,
): { success: boolean; error?: string; port?: number } {
  if (_state.socket) {
    return { success: false, error: `Already listening on port ${_state.port}` };
  }
  const port = Math.max(1024, Math.min(65535, Math.floor(options.port)));
  const bindHost = options.acceptFromNetwork ? "0.0.0.0" : "127.0.0.1";

  try {
    const socket = dgram.createSocket("udp4");

    socket.on("error", (err) => {
      console.error("[osc] socket error:", err);
      _state.errorCount += 1;
      mainWindow?.webContents.send("osc:error", { message: String(err) });
      try { socket.close(); } catch { /* ignore */ }
      _state.socket = null;
      _state.port = null;
      _state.bindHost = null;
    });

    socket.on("message", (msg, rinfo) => {
      try {
        const parsed = decodeOscMessageBuf(msg);
        parsed.source = `${rinfo.address}:${rinfo.port}`;
        _state.lastMessage = parsed;
        _state.receivedCount += 1;
        mainWindow?.webContents.send("osc:incoming", parsed);
      } catch (err) {
        _state.errorCount += 1;
        // Schlechte Pakete einfach ignorieren — kein Spam an Renderer
        if (process.env.OSC_DEBUG) {
          console.warn("[osc] parse failed:", err, msg);
        }
      }
    });

    socket.bind(port, bindHost, () => {
      _state.socket = socket;
      _state.port = port;
      _state.bindHost = bindHost;
      _state.lastMessage = null;
      _state.receivedCount = 0;
      _state.errorCount = 0;
      console.log(`[osc] listening on ${bindHost}:${port}`);
    });

    return { success: true, port };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export function stopOscServer(): { success: boolean } {
  if (_state.socket) {
    try { _state.socket.close(); } catch { /* ignore */ }
    _state.socket = null;
    _state.port = null;
    _state.bindHost = null;
    console.log("[osc] stopped");
  }
  return { success: true };
}

export function getOscStatus(): OscStatus {
  return {
    listening: _state.socket !== null,
    port: _state.port,
    bindHost: _state.bindHost,
    receivedCount: _state.receivedCount,
    errorCount: _state.errorCount,
    lastMessage: _state.lastMessage,
  };
}
