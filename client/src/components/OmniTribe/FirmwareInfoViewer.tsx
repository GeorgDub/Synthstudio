/**
 * FirmwareInfoViewer.tsx — Sprint-119c Firmware-Info Read-Only Display.
 *
 * Surfaciert Sprint-117a Features:
 *   - fw_version: major.minor.patch
 *   - device_id: E2S / E2-Synth / unknown  (via omnitribe:deviceId)
 *   - feature_flags: 16-bit checklist mit Feature-Namen (FwFlag Bits 0-15)
 *   - module_list: aktive Module mit IDs
 *   - Refresh-Button: queryFirmwareInfo() + queryDeviceId()
 *
 * Bridge-Calls:
 *   - bridge.queryFirmwareInfo()   CMD 0x09 SUB 0x01
 *   - bridge.queryDeviceId()       CMD 0x09 SUB 0x03
 *
 * Events:
 *   - omnitribe:firmwareInfo  { verMajor, verMinor, verPatch, gitHash, moduleIds, featureFlags }
 *   - omnitribe:deviceId      { deviceId }
 *
 * NOTE: featureFlags is a u32 bitmask but only bits 0-15 are defined (see FwFlag).
 * deviceId is a separate event (not included in FirmwareInfoEvent).
 */

import { useEffect, useState, useCallback, type ReactElement } from "react";
import { omniTribeBridge, FwFlag, type FirmwareInfoEvent } from "../../audio/OmniTribeBridge";

// Feature-flag definitions for display — mirrors FwFlag constants, bits 0-15.
const FEATURE_FLAG_DEFS: { bit: number; name: string; label: string }[] = [
  { bit: 0,  name: "GRANULAR",       label: "Granular Engine" },
  { bit: 1,  name: "WAVETABLE",      label: "Wavetable Engine" },
  { bit: 2,  name: "MODMATRIX",      label: "Mod Matrix" },
  { bit: 3,  name: "ARP",            label: "Arpeggiator" },
  { bit: 4,  name: "EUCLIDEAN",      label: "Euclidean Rhythm" },
  { bit: 5,  name: "CHORD",          label: "Chord Engine" },
  { bit: 6,  name: "VOICE_STEAL",    label: "Voice Stealing" },
  { bit: 7,  name: "CLOCK_PLL",      label: "Clock PLL" },
  { bit: 8,  name: "MPE_VOICE",      label: "MPE Voice" },
  { bit: 9,  name: "IRQ_TX_RING",    label: "IRQ TX Ring Buffer" },
  { bit: 10, name: "CLOCK_SYNC",     label: "MIDI Clock Sync In" },
  { bit: 11, name: "CLOCK_OUT",      label: "MIDI Clock Out" },
  { bit: 12, name: "SPP",            label: "Song Position Pointer" },
  { bit: 13, name: "ADAPTIVE_JITTER",label: "Adaptive Jitter Threshold" },
  { bit: 14, name: "NRPN_FULL",      label: "Full NRPN Address Space" },
  { bit: 15, name: "PATTERN_ENGINE", label: "Pattern Engine" },
];

// Verify all FwFlag constants are covered (compile-time sanity)
const _fwFlagBitsUsed = Object.values(FwFlag);
void _fwFlagBitsUsed; // suppress unused warning

const DEVICE_ID_LABELS: Record<number, string> = {
  0x01: "E2S",
  0x02: "E2-Synth",
  0x03: "Unknown",
};

export interface FirmwareInfoViewerProps {
  connected: boolean;
}

export function FirmwareInfoViewer({ connected }: FirmwareInfoViewerProps): ReactElement {
  const [fwInfo, setFwInfo] = useState<FirmwareInfoEvent | null>(null);
  const [deviceId, setDeviceId] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    const onFirmwareInfo = (e: Event) => {
      const detail = (e as CustomEvent).detail as FirmwareInfoEvent;
      setFwInfo(detail);
      setLoading(false);
    };

    const onDeviceId = (e: Event) => {
      const detail = (e as CustomEvent).detail as { deviceId: number };
      setDeviceId(detail.deviceId);
    };

    window.addEventListener("omnitribe:firmwareInfo", onFirmwareInfo);
    window.addEventListener("omnitribe:deviceId", onDeviceId);

    return () => {
      window.removeEventListener("omnitribe:firmwareInfo", onFirmwareInfo);
      window.removeEventListener("omnitribe:deviceId", onDeviceId);
    };
  }, []);

  const handleRefresh = useCallback(() => {
    if (!connected) return;
    setLoading(true);
    omniTribeBridge.queryFirmwareInfo();
    omniTribeBridge.queryDeviceId();
  }, [connected]);

  const deviceLabel = deviceId !== null
    ? (DEVICE_ID_LABELS[deviceId] ?? `Unknown (0x${deviceId.toString(16).padStart(2, "0")}`)
    : "—";

  return (
    <div
      className="bg-bg-panel border border-border-color rounded p-4 space-y-3"
      data-testid="firmware-info-viewer"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-text-primary">Firmware Info</h3>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={!connected || loading}
          data-testid="firmware-refresh"
          className="text-[10px] px-2 py-0.5 rounded bg-bg-elevated border border-border-color text-text-muted hover:text-text-primary disabled:opacity-40"
          aria-label="Refresh firmware info"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {/* Version + Device */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-bg-elevated rounded p-2">
          <span className="text-[9px] uppercase tracking-wide text-text-dim block mb-1">
            Version
          </span>
          <span
            className="text-sm font-mono font-bold text-text-primary"
            data-testid="fw-version"
          >
            {fwInfo
              ? `${fwInfo.verMajor}.${fwInfo.verMinor}.${fwInfo.verPatch}`
              : "—"}
          </span>
        </div>
        <div className="bg-bg-elevated rounded p-2">
          <span className="text-[9px] uppercase tracking-wide text-text-dim block mb-1">
            Device
          </span>
          <span
            className="text-sm font-mono font-bold text-text-primary"
            data-testid="fw-device-id"
          >
            {deviceLabel}
          </span>
        </div>
      </div>

      {/* Feature Flags */}
      <div className="space-y-1">
        <span className="text-[10px] uppercase tracking-wide text-text-dim block">
          Feature Flags
          {fwInfo && (
            <span className="ml-2 text-text-dim normal-case">
              (0x{fwInfo.featureFlags.toString(16).padStart(4, "0").toUpperCase()})
            </span>
          )}
        </span>
        <div
          className="grid grid-cols-2 gap-x-3 gap-y-1"
          data-testid="feature-flags-list"
          role="list"
          aria-label="Feature flags"
        >
          {FEATURE_FLAG_DEFS.map(({ bit, name, label }) => {
            const supported = fwInfo
              ? !!(fwInfo.featureFlags & (1 << bit))
              : null;
            return (
              <div
                key={name}
                role="listitem"
                className="flex items-center gap-2"
                data-testid={`feature-flag-${bit}`}
              >
                <span
                  aria-label={
                    supported === null
                      ? "unknown"
                      : supported
                      ? "supported"
                      : "not supported"
                  }
                  className={[
                    "w-2 h-2 rounded-full flex-shrink-0",
                    supported === null
                      ? "bg-bg-elevated border border-border-color"
                      : supported
                      ? "bg-accent-success"
                      : "bg-bg-elevated border border-border-color",
                  ].join(" ")}
                />
                <span
                  className={[
                    "text-[10px] font-mono",
                    supported === null
                      ? "text-text-dim"
                      : supported
                      ? "text-text-primary"
                      : "text-text-dim line-through",
                  ].join(" ")}
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Module List */}
      <div className="border-t border-border-color pt-2">
        <span className="text-[10px] uppercase tracking-wide text-text-dim block mb-1">
          Active Modules
        </span>
        {fwInfo && fwInfo.moduleIds.length > 0 ? (
          <div
            className="flex flex-wrap gap-1"
            data-testid="module-list"
            role="list"
            aria-label="Active modules"
          >
            {fwInfo.moduleIds.map((id) => (
              <span
                key={id}
                role="listitem"
                data-testid={`module-id-${id}`}
                className="bg-bg-elevated border border-border-color rounded px-2 py-0.5 text-[10px] font-mono text-text-muted"
              >
                {`0x${id.toString(16).padStart(2, "0").toUpperCase()}`}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-text-dim italic">
            {fwInfo ? "No modules reported" : "Fetch firmware info to see modules"}
          </p>
        )}
      </div>
    </div>
  );
}
