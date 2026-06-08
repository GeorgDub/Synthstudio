/**
 * useOmniTribe.ts — React-Hook für die OmniTribe-Hardware-Bridge.
 *
 * SoT: G:/IdeaProjects/Synthstudio/SYNTHSTUDIO_INTEGRATION.md §6
 * Bridge: client/src/audio/OmniTribeBridge.ts
 *
 * Public-API:
 *   - connected: boolean
 *   - connect(): Promise<boolean>   — fragt Web-MIDI mit sysex:true an
 *   - setParam(part, ph, pl, value)
 *   - enableMonitoring()            — VU + Spectrum + ParamNotify-Streams
 *   - identity: { major, minor, patch } | null
 *
 * Isomorph: läuft in Browser + Electron-Renderer.
 *   - Browser ohne Web-MIDI (Firefox/Safari) → connect() returnt false
 *   - Electron mit Web-MIDI → funktioniert via Chromium-Backend
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  omniTribeBridge, OtpCmd, StreamFlag,
  adaptBrowserWebSocket,
} from "../audio/OmniTribeBridge";
import {
  describeOmniTribeConnect,
  type OmniTribeConnectStatus,
} from "../utils/omnitribeConnect";

export const DEFAULT_SIM_WS_URL = "ws://localhost:8744";

export interface OmniTribeIdentity {
  major: number;
  minor: number;
  patch: number;
}

export type SimConnectionState =
  | { state: "idle" }
  | { state: "connecting"; url: string }
  | { state: "connected"; url: string }
  | { state: "error"; url: string; message: string };

export interface UseOmniTribeReturn {
  connected: boolean;
  webMidiSupported: boolean;
  connect: () => Promise<boolean>;
  disconnect: () => void;
  setParam: (part: number, ph: number, pl: number, value: number) => void;
  enableMonitoring: () => void;
  identity: OmniTribeIdentity | null;
  /** Sichtbares Connect-Feedback (null = noch kein Versuch). */
  connectStatus: OmniTribeConnectStatus | null;
  /** Sprint-97: Sim-Loopback via WebSocket statt Web-MIDI. */
  simConnection: SimConnectionState;
  connectSim: (url?: string) => Promise<boolean>;
}

export function useOmniTribe(): UseOmniTribeReturn {
  const [connected, setConnected] = useState(false);
  const [identity, setIdentity] = useState<OmniTribeIdentity | null>(null);
  const [connectStatus, setConnectStatus] =
    useState<OmniTribeConnectStatus | null>(null);
  const [simConnection, setSimConnection] = useState<SimConnectionState>(
    { state: "idle" },
  );

  const webMidiSupported = useMemo(() => {
    return typeof navigator !== "undefined"
      && typeof (navigator as Navigator).requestMIDIAccess === "function";
  }, []);

  // Auto-listen für Identity-Response (CMD 0x01 SUB 0x01).
  // Bridge ist ein Singleton — der Hook kann unmounten und remounten ohne
  // dass die Verbindung verloren geht, der Listener muss aber neu gebunden
  // werden (oder zumindest in Sync mit dem Component-State sein).
  useEffect(() => {
    const unbind = omniTribeBridge.on(OtpCmd.IDENTITY, (_cmd, sub, payload) => {
      if (sub === 0x01 && payload.length >= 3) {
        const id: OmniTribeIdentity = {
          major: payload[0],
          minor: payload[1],
          patch: payload[2],
        };
        setIdentity(id);
        // v3.19: DoD §16 — Identity-Handshake im Console-Log nach Connect.
        // eslint-disable-next-line no-console
        console.log(
          `[OmniTribe] Connected to Firmware v${id.major}.${id.minor}.${id.patch}`,
        );
      }
    });
    return unbind;
  }, []);

  // Sync initial connected-State falls die Bridge schon connected ist.
  useEffect(() => {
    if (omniTribeBridge.isConnected && !connected) {
      setConnected(true);
    }
  }, [connected]);

  const connect = useCallback(async (): Promise<boolean> => {
    if (!webMidiSupported) {
      const status = describeOmniTribeConnect({
        webMidiSupported: false, connected: false,
        inputNames: [], outputNames: [],
      });
      console.warn("[useOmniTribe]", status.message);
      setConnectStatus(status);
      return false;
    }
    try {
      const access = await navigator.requestMIDIAccess({ sysex: true });
      const ok = await omniTribeBridge.connect(access);
      setConnected(ok);
      const inputNames = Array.from(access.inputs.values()).map(p => p.name ?? "");
      const outputNames = Array.from(access.outputs.values()).map(p => p.name ?? "");
      const status = describeOmniTribeConnect({
        webMidiSupported: true, connected: ok, inputNames, outputNames,
      });
      setConnectStatus(status);
      if (!ok) console.warn("[useOmniTribe]", status.message);
      return ok;
    } catch (err) {
      console.error("[useOmniTribe] connect failed:", err);
      setConnected(false);
      // requestMIDIAccess wirft v.a. bei verweigerter Sysex-Permission.
      const status = describeOmniTribeConnect({
        webMidiSupported: true, permissionDenied: true, connected: false,
        inputNames: [], outputNames: [],
      });
      setConnectStatus(status);
      return false;
    }
  }, [webMidiSupported]);

  const disconnect = useCallback(() => {
    omniTribeBridge.disconnect();
    setConnected(false);
    setIdentity(null);
    setConnectStatus(null);
    setSimConnection({ state: "idle" });
  }, []);

  /**
   * Sprint-97: verbindet zur Sim-WS-Bridge (sim_ws_server.py).
   *
   * Identisches Wire-Protokoll wie Web-MIDI, anderer Transport — funktioniert
   * auch in Firefox/Safari (kein Web-MIDI noetig). Default-URL ist die des
   * lokalen sim_ws_server.py (Port 8744).
   *
   * Async aber promise-based — Status zusaetzlich via simConnection state
   * gespiegelt fuer UI-Live-Updates.
   */
  const connectSim = useCallback(
    async (url: string = DEFAULT_SIM_WS_URL): Promise<boolean> => {
      // Erst eventuelle frische Verbindung wegklappen (Bridge ist Singleton).
      if (omniTribeBridge.isConnected) {
        omniTribeBridge.disconnect();
        setConnected(false);
        setIdentity(null);
      }
      setSimConnection({ state: "connecting", url });
      return await new Promise<boolean>((resolve) => {
        let settled = false;
        try {
          const ws = new WebSocket(url);
          ws.binaryType = "arraybuffer";
          ws.onopen = async () => {
            try {
              const ok = await omniTribeBridge.connectWebSocket(
                adaptBrowserWebSocket(ws),
              );
              setConnected(ok);
              if (ok) {
                setSimConnection({ state: "connected", url });
              } else {
                setSimConnection({
                  state: "error", url,
                  message: "Bridge connectWebSocket returned false",
                });
              }
              if (!settled) { settled = true; resolve(ok); }
            } catch (err) {
              setSimConnection({
                state: "error", url,
                message: err instanceof Error ? err.message : String(err),
              });
              if (!settled) { settled = true; resolve(false); }
            }
          };
          ws.onerror = () => {
            setSimConnection({
              state: "error", url,
              message: `WebSocket connection to ${url} failed`,
            });
            if (!settled) { settled = true; resolve(false); }
          };
        } catch (err) {
          setSimConnection({
            state: "error", url,
            message: err instanceof Error ? err.message : String(err),
          });
          if (!settled) { settled = true; resolve(false); }
        }
      });
    },
    [],
  );

  const enableMonitoring = useCallback(() => {
    if (!omniTribeBridge.isConnected) return;
    omniTribeBridge.enableStreams(
      StreamFlag.VU_METER | StreamFlag.SPECTRUM | StreamFlag.PARAM_NOTIFY
    );
    omniTribeBridge.requestFullDump();
  }, []);

  const setParam = useCallback(
    (part: number, ph: number, pl: number, value: number) => {
      omniTribeBridge.setParam(part, ph, pl, value);
    },
    [],
  );

  return {
    connected,
    webMidiSupported,
    connect,
    disconnect,
    setParam,
    enableMonitoring,
    identity,
    connectStatus,
    simConnection,
    connectSim,
  };
}
