/**
 * Synthstudio – useOsc
 *
 * Open Sound Control (OSC) via WebSocket-Bridge.
 * Verbindet sich mit einem lokalen OSC-zu-WebSocket-Bridge
 * (z.B. TouchOSC Bridge, Protokol, oder ein lokaler Node.js-Bridge).
 *
 * Standard-Port: ws://localhost:8080 (konfigurierbar)
 *
 * OSC-Adress-Mapping (Beispiele):
 *   /synthstudio/bpm          → BPM setzen (float 20–300)
 *   /synthstudio/play         → Play/Stop toggling
 *   /synthstudio/volume/{n}   → Kanal n Volume setzen (float 0–1)
 *   /synthstudio/macro/{n}    → Makro n setzen (float 0–1)
 *   /synthstudio/scene/{n}    → Scene n starten (int 1–8)
 *
 * Ausgehende OSC-Nachrichten:
 *   /synthstudio/step         → Aktueller Step (int)
 *   /synthstudio/bpm/current  → Aktueller BPM (float)
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface OscMessage {
  address: string;
  args: Array<{ type: "f" | "i" | "s"; value: number | string }>;
}

export interface OscState {
  connected: boolean;
  url: string;
  lastMessage: OscMessage | null;
  error: string | null;
}

export interface OscActions {
  connect: (url: string) => void;
  disconnect: () => void;
  send: (address: string, ...args: (number | string)[]) => void;
}

/** Parst eine einfache OSC-ähnliche JSON-Nachricht vom WebSocket-Bridge. */
function parseOscJson(raw: string): OscMessage | null {
  try {
    const data = JSON.parse(raw);
    if (typeof data.address === "string") {
      return {
        address: data.address,
        args: Array.isArray(data.args) ? data.args : [],
      };
    }
  } catch { /* ignore */ }
  return null;
}

export function useOsc(): OscState & OscActions {
  const [state, setState] = useState<OscState>({
    connected: false,
    url: "ws://localhost:8080",
    lastMessage: null,
    error: null,
  });
  const wsRef = useRef<WebSocket | null>(null);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setState(prev => ({ ...prev, connected: false }));
  }, []);

  const connect = useCallback((url: string) => {
    disconnect();
    setState(prev => ({ ...prev, url, error: null }));

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setState(prev => ({ ...prev, connected: true, error: null }));
        console.log("[OSC] Verbunden mit:", url);
      };

      ws.onmessage = (e) => {
        const msg = parseOscJson(e.data);
        if (!msg) return;
        setState(prev => ({ ...prev, lastMessage: msg }));

        // OSC-Nachrichten an Actions weiterleiten
        routeOscMessage(msg);
      };

      ws.onclose = () => {
        setState(prev => ({ ...prev, connected: false }));
        wsRef.current = null;
      };

      ws.onerror = () => {
        setState(prev => ({ ...prev, error: `Verbindung zu ${url} fehlgeschlagen`, connected: false }));
        wsRef.current = null;
      };
    } catch (err) {
      setState(prev => ({ ...prev, error: String(err) }));
    }
  }, [disconnect]);

  const send = useCallback((address: string, ...args: (number | string)[]) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const msg: OscMessage = {
      address,
      args: args.map(v => ({
        type: typeof v === "number" ? "f" : "s",
        value: v,
      })),
    };
    wsRef.current.send(JSON.stringify(msg));
  }, []);

  useEffect(() => () => disconnect(), [disconnect]);

  return { ...state, connect, disconnect, send };
}

/** Routet OSC-Nachrichten zu Synthstudio-Actions via CustomEvents. */
function routeOscMessage(msg: OscMessage) {
  const addr = msg.address;
  const val  = msg.args[0]?.value;

  if (addr === "/synthstudio/play")   { window.dispatchEvent(new CustomEvent("kb:action", { detail: "play-stop" })); return; }
  if (addr === "/synthstudio/record") { window.dispatchEvent(new CustomEvent("kb:action", { detail: "record" }));    return; }

  if (addr === "/synthstudio/bpm" && typeof val === "number") {
    window.dispatchEvent(new CustomEvent("osc:bpm", { detail: Math.round(val) }));
    return;
  }

  // /synthstudio/volume/{0-8}
  const volMatch = addr.match(/^\/synthstudio\/volume\/(\d+)$/);
  if (volMatch && typeof val === "number") {
    window.dispatchEvent(new CustomEvent("osc:volume", { detail: { index: Number(volMatch[1]), value: val } }));
    return;
  }

  // /synthstudio/macro/{0-7}
  const macroMatch = addr.match(/^\/synthstudio\/macro\/(\d+)$/);
  if (macroMatch && typeof val === "number") {
    const { setMacroValue } = require("@/store/useMacroStore");
    setMacroValue(Number(macroMatch[1]), val);
    return;
  }

  // /synthstudio/scene/{1-8}
  const sceneMatch = addr.match(/^\/synthstudio\/scene\/(\d+)$/);
  if (sceneMatch) {
    window.dispatchEvent(new CustomEvent("kb:action", { detail: `tab-sequencer` }));
    window.dispatchEvent(new CustomEvent("midi:scene", { detail: Number(sceneMatch[1]) - 1 }));
    return;
  }
}
