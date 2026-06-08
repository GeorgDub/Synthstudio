/**
 * DeviceConnectionPanel.tsx — Settings-Section "OmniTribe Device".
 *
 * SoT: G:/IdeaProjects/Synthstudio/SYNTHSTUDIO_INTEGRATION.md §7
 *
 * Zeigt:
 *  - Connect-Button (wenn Web-MIDI verfügbar + nicht connected)
 *  - "✓ Connected — Firmware vX.Y.Z" + Enable-Monitoring-Button (wenn connected)
 *  - Hinweis "Firefox/Safari nicht unterstützt" (wenn Web-MIDI fehlt)
 *  - Sprint-97: Dev-Sim-Loopback-Section mit WS-URL + Connect/Disconnect
 *    (funktioniert in jedem Browser, kein Web-MIDI noetig)
 *
 * Nur semantische Tailwind-Tokens (bg-bg-panel / text-accent-* / etc.).
 */

import { useEffect, useRef, useState } from "react";
import {
  useOmniTribe, DEFAULT_SIM_WS_URL,
} from "../../hooks/useOmniTribe";
import { omniTribeBridge } from "../../audio/OmniTribeBridge";
import { simAudioEngine } from "../../audio/SimAudioEngine";

/**
 * Sprint-99: Live-Stream-Activity-Indicator.
 *
 * Zaehlt VU- + Spectrum-CustomEvents in einem rolling-1s-Fenster und
 * liefert die Rate zurueck. UI rendert "VU 60 fps · Spec 30 fps" damit
 * der User sieht dass der Stream tatsaechlich flowed.
 */
function useStreamActivity(): { vuFps: number; specFps: number } {
  const [stats, setStats] = useState({ vuFps: 0, specFps: 0 });
  const vuCount = useRef(0);
  const specCount = useRef(0);

  useEffect(() => {
    const onVu = () => { vuCount.current += 1; };
    const onSpec = () => { specCount.current += 1; };
    window.addEventListener("omnitribe:vuMeter", onVu);
    window.addEventListener("omnitribe:spectrum", onSpec);
    const interval = window.setInterval(() => {
      setStats({ vuFps: vuCount.current, specFps: specCount.current });
      vuCount.current = 0;
      specCount.current = 0;
    }, 1000);
    return () => {
      window.removeEventListener("omnitribe:vuMeter", onVu);
      window.removeEventListener("omnitribe:spectrum", onSpec);
      window.clearInterval(interval);
    };
  }, []);

  return stats;
}

export function DeviceConnectionPanel() {
  const {
    connected,
    webMidiSupported,
    connect,
    disconnect,
    enableMonitoring,
    identity,
    connectStatus,
    simConnection,
    connectSim,
  } = useOmniTribe();

  const [simUrl, setSimUrl] = useState<string>(DEFAULT_SIM_WS_URL);
  const [showSim, setShowSim] = useState<boolean>(false);
  const [monitoringOn, setMonitoringOn] = useState<boolean>(false);
  const { vuFps, specFps } = useStreamActivity();
  // Sprint-102: Audio-Engine-Status + Test-Trigger
  const [audioOn, setAudioOn] = useState<boolean>(false);
  const [testNote, setTestNote] = useState<number>(60);   // C4 default

  const simConnecting = simConnection.state === "connecting";
  const simConnected = simConnection.state === "connected";
  const simError = simConnection.state === "error" ? simConnection.message : null;

  const handleConnectSim = async () => {
    const ok = await connectSim(simUrl);
    if (ok) setMonitoringOn(false);
  };

  const handleEnableSimMonitoring = () => {
    enableMonitoring();
    setMonitoringOn(true);
  };

  // Sprint-102: Audio + Test-Trigger
  const handleToggleAudio = async () => {
    if (audioOn) {
      await simAudioEngine.disable();
      setAudioOn(false);
    } else {
      await simAudioEngine.enable();
      setAudioOn(simAudioEngine.isEnabled);
    }
  };

  const handleTriggerChord = () => {
    // Note-On → kurze Pause → Note-Off, damit der Klang nicht haengt.
    omniTribeBridge.sendNoteOn(0, testNote, 100);
    window.setTimeout(() => {
      omniTribeBridge.sendNoteOff(0, testNote);
    }, 600);
  };

  return (
    <div
      className="bg-bg-panel border border-border-color rounded p-4 space-y-3"
      data-testid="device-connection-panel"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-text-primary">OmniTribe Device</h3>
        <span className="text-[10px] text-text-dim">Custom KORG-Firmware</span>
      </div>

      {!webMidiSupported && (
        <p className="text-xs text-accent-danger" data-testid="webmidi-warning">
          ⚠ Web-MIDI in diesem Browser nicht verfügbar. Bitte Chrome / Edge /
          Opera verwenden (Firefox &amp; Safari unterstützen Web-MIDI nicht) —
          oder die Sim-Loopback-Sektion unten nutzen.
        </p>
      )}

      {webMidiSupported && connected && (
        <div className="space-y-2">
          <p className="text-xs text-accent-success" data-testid="connection-status">
            ✓ Connected
            {identity
              ? ` — Firmware v${identity.major}.${identity.minor}.${identity.patch}`
              : " — Identity-Response ausstehend…"}
            {simConnected && " (Sim-Loop)"}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={enableMonitoring}
              data-testid="enable-monitoring-btn"
              className="bg-accent-primary text-text-primary text-xs px-3 py-1.5 rounded hover:opacity-90 transition-opacity"
            >
              Enable Live Monitoring
            </button>
            <button
              type="button"
              onClick={disconnect}
              data-testid="disconnect-btn"
              className="bg-bg-elevated border border-border-color text-text-muted text-xs px-3 py-1.5 rounded hover:text-text-primary transition-colors"
            >
              Disconnect
            </button>
          </div>
          <p className="text-[10px] text-text-dim">
            Live-Monitoring aktiviert VU-Meter, Spectrum-Stream und
            Param-Notify-Events vom Gerät (60 Hz / 30 Hz).
          </p>
        </div>
      )}

      {webMidiSupported && !connected && (
        <div className="space-y-2">
          <p className="text-xs text-text-muted">
            Verbinde Synthstudio mit deinem OmniTribe-Gerät (Sysex-Permission
            wird vom Browser abgefragt).
          </p>
          <button
            type="button"
            onClick={connect}
            data-testid="connect-btn"
            className="bg-accent-primary text-text-primary text-xs px-3 py-1.5 rounded hover:opacity-90 transition-opacity"
          >
            Connect to OmniTribe
          </button>
          {connectStatus && !connectStatus.ok && (
            <p
              className="text-[11px] text-accent-danger leading-snug"
              data-testid="connect-error"
            >
              ⚠ {connectStatus.message}
            </p>
          )}
        </div>
      )}

      {/* ─── Sprint-97: Sim-Loopback ───────────────────────── */}
      <div className="pt-3 border-t border-border-color">
        <button
          type="button"
          onClick={() => setShowSim((v) => !v)}
          data-testid="toggle-sim-section"
          className="flex w-full items-center justify-between text-[11px] uppercase tracking-wide text-text-dim hover:text-text-muted"
        >
          <span>Dev: Sim-Loopback (ohne Hardware)</span>
          <span>{showSim ? "▾" : "▸"}</span>
        </button>

        {showSim && (
          <div className="mt-2 space-y-2" data-testid="sim-loopback-section">
            <p className="text-[11px] text-text-muted leading-snug">
              Verbindet zur lokalen <code>sim_ws_server.py</code>-Bridge.
              Identisches Wire-Protokoll wie Hardware — funktioniert in
              jedem Browser. Start-Befehl:
              <code className="block mt-1 px-2 py-1 bg-bg-elevated rounded text-text-dim">
                python -X utf8 tools/sim/sim_ws_server.py --autoload chord
              </code>
            </p>

            <label className="block">
              <span className="text-[10px] uppercase tracking-wide text-text-dim">
                WebSocket URL
              </span>
              <input
                type="text"
                value={simUrl}
                onChange={(e) => setSimUrl(e.target.value)}
                disabled={simConnecting || simConnected}
                data-testid="sim-url-input"
                spellCheck={false}
                className={[
                  "mt-1 w-full bg-bg-elevated border border-border-color rounded",
                  "px-2 py-1 text-xs text-text-primary font-mono",
                  "disabled:opacity-50 focus:outline-none focus:border-accent-primary",
                ].join(" ")}
              />
            </label>

            {!simConnected && (
              <button
                type="button"
                onClick={handleConnectSim}
                disabled={simConnecting}
                data-testid="connect-sim-btn"
                className={[
                  "w-full text-xs px-3 py-1.5 rounded transition-opacity",
                  simConnecting
                    ? "bg-accent-primary/50 text-text-primary/70 cursor-wait"
                    : "bg-accent-primary text-text-primary hover:opacity-90",
                ].join(" ")}
              >
                {simConnecting ? "Connecting…" : "Connect to Sim-Server"}
              </button>
            )}

            {simConnected && (
              <button
                type="button"
                onClick={disconnect}
                data-testid="disconnect-sim-btn"
                className="w-full bg-bg-elevated border border-border-color text-text-muted text-xs px-3 py-1.5 rounded hover:text-text-primary transition-colors"
              >
                Disconnect Sim
              </button>
            )}

            {simConnected && (
              <>
                <p
                  className="text-[11px] text-accent-success"
                  data-testid="sim-status-connected"
                >
                  ✓ Sim connected — {simConnection.url}
                  {identity && ` (v${identity.major}.${identity.minor}.${identity.patch})`}
                </p>

                {/* Sprint-99: Live-Monitoring + Stream-Activity-Indicator */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleEnableSimMonitoring}
                    disabled={monitoringOn}
                    data-testid="sim-enable-monitoring-btn"
                    className={[
                      "flex-1 text-xs px-3 py-1.5 rounded transition-opacity",
                      monitoringOn
                        ? "bg-accent-success/30 text-accent-success cursor-default"
                        : "bg-accent-primary text-text-primary hover:opacity-90",
                    ].join(" ")}
                  >
                    {monitoringOn
                      ? "✓ Monitoring active"
                      : "Enable Live Monitoring"}
                  </button>
                </div>

                {monitoringOn && (
                  <p
                    className="text-[10px] text-text-dim font-mono"
                    data-testid="sim-stream-activity"
                  >
                    VU {vuFps} fps · Spectrum {specFps} fps
                  </p>
                )}

                {/* Sprint-102: Audio-Output + Trigger-Test */}
                <div className="pt-2 border-t border-border-color/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] uppercase tracking-wide text-text-dim">
                      Audio-Output (Web-Audio)
                    </span>
                    <button
                      type="button"
                      onClick={handleToggleAudio}
                      data-testid="sim-audio-toggle"
                      aria-pressed={audioOn}
                      className={[
                        "text-[11px] px-2 py-0.5 rounded border transition-colors",
                        audioOn
                          ? "bg-accent-success/20 border-accent-success text-accent-success"
                          : "bg-bg-elevated border-border-color text-text-muted hover:text-text-primary",
                      ].join(" ")}
                    >
                      {audioOn ? "On" : "Off"}
                    </button>
                  </div>

                  <div className="flex gap-2 items-center">
                    <label className="flex-1 flex items-center gap-1">
                      <span className="text-[10px] text-text-dim">Note</span>
                      <input
                        type="number"
                        min={0}
                        max={127}
                        value={testNote}
                        onChange={(e) =>
                          setTestNote(Math.max(0, Math.min(127, Number(e.target.value) || 0)))}
                        data-testid="sim-test-note"
                        className="flex-1 bg-bg-elevated border border-border-color rounded px-1 py-0.5 text-[11px] text-text-primary font-mono"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={handleTriggerChord}
                      data-testid="sim-trigger-chord"
                      className="text-[11px] px-3 py-0.5 rounded bg-accent-primary text-text-primary hover:opacity-90"
                    >
                      Trigger
                    </button>
                  </div>
                  <p className="text-[10px] text-text-dim leading-snug">
                    Schickt Note-On → chord-Modul fan-out → Web-Audio.
                    Setup im chord-Modul: NRPN MSB 0x1E pid 0x03=enabled,
                    pid 0x00=chord_type. Default: Pass-Through Single-Note.
                  </p>
                </div>
              </>
            )}

            {simError && (
              <p
                className="text-[11px] text-accent-danger leading-snug"
                data-testid="sim-status-error"
              >
                ⚠ {simError}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
