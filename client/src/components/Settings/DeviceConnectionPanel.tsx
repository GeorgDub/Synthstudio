/**
 * DeviceConnectionPanel.tsx — Settings-Section "OmniTribe Device".
 *
 * SoT: G:/IdeaProjects/Synthstudio/SYNTHSTUDIO_INTEGRATION.md §7
 *
 * Zeigt:
 *  - Connect-Button (wenn Web-MIDI verfügbar + nicht connected)
 *  - "✓ Connected — Firmware vX.Y.Z" + Enable-Monitoring-Button (wenn connected)
 *  - Hinweis "Firefox/Safari nicht unterstützt" (wenn Web-MIDI fehlt)
 *
 * Nur semantische Tailwind-Tokens (bg-bg-panel / text-accent-* / etc.).
 */

import { useOmniTribe } from "../../hooks/useOmniTribe";

export function DeviceConnectionPanel() {
  const {
    connected,
    webMidiSupported,
    connect,
    disconnect,
    enableMonitoring,
    identity,
  } = useOmniTribe();

  return (
    <div className="bg-bg-panel border border-border-color rounded p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-text-primary">OmniTribe Device</h3>
        <span className="text-[10px] text-text-dim">Custom KORG-Firmware</span>
      </div>

      {!webMidiSupported && (
        <p className="text-xs text-accent-danger">
          ⚠ Web-MIDI in diesem Browser nicht verfügbar. Bitte Chrome / Edge /
          Opera verwenden (Firefox &amp; Safari unterstützen Web-MIDI nicht).
        </p>
      )}

      {webMidiSupported && connected && (
        <div className="space-y-2">
          <p className="text-xs text-accent-success">
            ✓ Connected
            {identity
              ? ` — Firmware v${identity.major}.${identity.minor}.${identity.patch}`
              : " — Identity-Response ausstehend…"}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={enableMonitoring}
              className="bg-accent-primary text-text-primary text-xs px-3 py-1.5 rounded hover:opacity-90 transition-opacity"
            >
              Enable Live Monitoring
            </button>
            <button
              type="button"
              onClick={disconnect}
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
            className="bg-accent-primary text-text-primary text-xs px-3 py-1.5 rounded hover:opacity-90 transition-opacity"
          >
            Connect to OmniTribe
          </button>
        </div>
      )}
    </div>
  );
}
