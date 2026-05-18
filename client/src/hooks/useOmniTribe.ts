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
import { omniTribeBridge, OtpCmd, StreamFlag } from "../audio/OmniTribeBridge";

export interface OmniTribeIdentity {
  major: number;
  minor: number;
  patch: number;
}

export interface UseOmniTribeReturn {
  connected: boolean;
  webMidiSupported: boolean;
  connect: () => Promise<boolean>;
  disconnect: () => void;
  setParam: (part: number, ph: number, pl: number, value: number) => void;
  enableMonitoring: () => void;
  identity: OmniTribeIdentity | null;
}

export function useOmniTribe(): UseOmniTribeReturn {
  const [connected, setConnected] = useState(false);
  const [identity, setIdentity] = useState<OmniTribeIdentity | null>(null);

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
      console.warn("[useOmniTribe] Web-MIDI nicht verfügbar (Firefox/Safari?)");
      return false;
    }
    try {
      const access = await navigator.requestMIDIAccess({ sysex: true });
      const ok = await omniTribeBridge.connect(access);
      setConnected(ok);
      if (!ok) {
        console.warn("[useOmniTribe] Kein OmniTribe-Gerät im MIDIAccess gefunden.");
      }
      return ok;
    } catch (err) {
      console.error("[useOmniTribe] connect failed:", err);
      setConnected(false);
      return false;
    }
  }, [webMidiSupported]);

  const disconnect = useCallback(() => {
    omniTribeBridge.disconnect();
    setConnected(false);
    setIdentity(null);
  }, []);

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
  };
}
