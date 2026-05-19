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

import { useState } from "react";
import {
  useOmniTribe, DEFAULT_SIM_WS_URL,
} from "../../hooks/useOmniTribe";

export function DeviceConnectionPanel() {
  const {
    connected,
    webMidiSupported,
    connect,
    disconnect,
    enableMonitoring,
    identity,
    simConnection,
    connectSim,
  } = useOmniTribe();

  const [simUrl, setSimUrl] = useState<string>(DEFAULT_SIM_WS_URL);
  const [showSim, setShowSim] = useState<boolean>(false);

  const simConnecting = simConnection.state === "connecting";
  const simConnected = simConnection.state === "connected";
  const simError = simConnection.state === "error" ? simConnection.message : null;

  const handleConnectSim = async () => {
    await connectSim(simUrl);
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
              <p
                className="text-[11px] text-accent-success"
                data-testid="sim-status-connected"
              >
                ✓ Sim connected — {simConnection.url}
                {identity && ` (v${identity.major}.${identity.minor}.${identity.patch})`}
              </p>
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
