/**
 * OtaUpdatePanel.tsx — Sprint-101 OTA-Update-Check UI.
 *
 * Liest eine konfigurierbare Manifest-URL + Channel + HMAC-Secret aus
 * localStorage, prueft beim Klick (oder Auto-Check beim Mount) ob ein
 * neueres Release vorhanden ist und zeigt Status-Banner.
 *
 * KEINE Hardware noetig — der Check laeuft komplett im Browser. Download/
 * Install passiert manuell ueber die existierenden Python-Tools
 * (tools/ota/client.py pull).
 *
 * Settings persistieren in localStorage unter "synthstudio:ota.config.v1".
 * Last-seen-Version unter "synthstudio:ota.lastSeen.v1".
 */

import { useEffect, useState, useCallback } from "react";

import {
  checkForUpdate, secretFromString, type CheckResult,
} from "../../utils/otaClient";
import type { Channel, Release } from "../../utils/otaManifest";

const CONFIG_KEY = "synthstudio:ota.config.v1";
const LAST_SEEN_KEY = "synthstudio:ota.lastSeen.v1";

interface OtaConfig {
  manifestUrl: string;
  channel: Channel;
  secret: string;
  currentVersion: string;
}

const DEFAULTS: OtaConfig = {
  manifestUrl: "",
  channel: "stable",
  secret: "",
  currentVersion: "0.1.0",
};

function loadConfig(): OtaConfig {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<OtaConfig>;
    return {
      manifestUrl: parsed.manifestUrl ?? DEFAULTS.manifestUrl,
      channel: (parsed.channel as Channel) ?? DEFAULTS.channel,
      secret: parsed.secret ?? DEFAULTS.secret,
      currentVersion: parsed.currentVersion ?? DEFAULTS.currentVersion,
    };
  } catch {
    return DEFAULTS;
  }
}

function saveConfig(cfg: OtaConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  } catch { /* swallow */ }
}

function saveLastSeen(version: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_SEEN_KEY, version);
  } catch { /* swallow */ }
}

export function OtaUpdatePanel() {
  const [config, setConfig] = useState<OtaConfig>(() => loadConfig());
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  useEffect(() => { saveConfig(config); }, [config]);

  const onCheck = useCallback(async () => {
    if (!config.manifestUrl || !config.secret) {
      setResult({
        available: false, release: null,
        reason: "URL + Secret muessen konfiguriert sein",
      });
      return;
    }
    setChecking(true);
    try {
      const res = await checkForUpdate({
        manifestUrl: config.manifestUrl,
        secret: secretFromString(config.secret),
        channel: config.channel,
        currentVersion: config.currentVersion,
      });
      setResult(res);
      if (res.available && res.release) {
        saveLastSeen(res.release.version);
      }
    } finally {
      setChecking(false);
    }
  }, [config]);

  const onDismiss = useCallback(() => setResult(null), []);

  return (
    <div
      className="bg-bg-panel border border-border-color rounded p-4 space-y-3"
      data-testid="ota-update-panel"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-text-primary">OmniTribe Firmware-Updates</h3>
        <button
          type="button"
          onClick={() => setShowConfig((v) => !v)}
          className="text-[11px] text-text-dim hover:text-text-muted"
          data-testid="ota-toggle-config"
        >
          {showConfig ? "Schliessen" : "Konfigurieren"}
        </button>
      </div>

      {/* Result-Banner */}
      {result && result.available && result.release && (
        <UpdateAvailableBanner release={result.release} onDismiss={onDismiss} />
      )}
      {result && !result.available && (
        <p
          className="text-[11px] text-text-muted"
          data-testid="ota-no-update"
        >
          {result.reason === "no-newer-release"
            ? "✓ Du bist auf der aktuellsten Version."
            : `⚠ ${result.reason}`}
        </p>
      )}

      <div className="flex gap-2 items-center">
        <button
          type="button"
          onClick={onCheck}
          disabled={checking}
          data-testid="ota-check-now"
          className={[
            "text-xs px-3 py-1.5 rounded transition-opacity",
            checking
              ? "bg-accent-primary/50 text-text-primary/70 cursor-wait"
              : "bg-accent-primary text-text-primary hover:opacity-90",
          ].join(" ")}
        >
          {checking ? "Checking…" : "Check for Updates"}
        </button>
        <span className="text-[10px] text-text-dim font-mono">
          current: v{config.currentVersion} · {config.channel}
        </span>
      </div>

      {showConfig && (
        <ConfigForm config={config} onChange={setConfig} />
      )}
    </div>
  );
}

function UpdateAvailableBanner({
  release, onDismiss,
}: {
  release: Release;
  onDismiss: () => void;
}) {
  return (
    <div
      className="border border-accent-success/40 bg-accent-success/10 rounded p-2 space-y-1"
      data-testid="ota-update-available"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-accent-success">
          ✓ Update verfuegbar — v{release.version}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          className="text-[10px] text-text-dim hover:text-text-muted"
          aria-label="dismiss"
        >
          ×
        </button>
      </div>
      <p className="text-[11px] text-text-muted">
        Channel: <strong className="text-text-primary">{release.channel}</strong>
        {" · "}Size: {(release.size_bytes / 1024).toFixed(1)} KB
        {" · "}Released: {release.released_at.slice(0, 10)}
      </p>
      <p className="text-[10px] text-text-dim font-mono break-all">
        sha256: {release.sha256.slice(0, 16)}…
      </p>
      <div className="flex gap-2 mt-1">
        <a
          href={release.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-accent-primary hover:underline"
          data-testid="ota-download-link"
        >
          Download VSB →
        </a>
        {release.release_notes_url && (
          <a
            href={release.release_notes_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-text-muted hover:text-text-primary"
          >
            Release Notes
          </a>
        )}
      </div>
      <p className="text-[10px] text-text-dim mt-1">
        Install via{" "}
        <code className="text-text-dim">tools/ota/client.py pull</code>
        {" "}— HMAC + SHA256 wird beim Download client-side verifiziert.
      </p>
    </div>
  );
}

function ConfigForm({
  config, onChange,
}: {
  config: typeof DEFAULTS;
  onChange: (c: typeof DEFAULTS) => void;
}) {
  return (
    <div className="space-y-2 pt-2 border-t border-border-color">
      <label className="block">
        <span className="text-[10px] uppercase tracking-wide text-text-dim">
          Manifest URL
        </span>
        <input
          type="text"
          value={config.manifestUrl}
          onChange={(e) => onChange({ ...config, manifestUrl: e.target.value })}
          placeholder="https://example.org/omnitribe/releases.json"
          spellCheck={false}
          data-testid="ota-config-url"
          className="mt-1 w-full bg-bg-elevated border border-border-color rounded px-2 py-1 text-xs text-text-primary font-mono"
        />
      </label>
      <label className="block">
        <span className="text-[10px] uppercase tracking-wide text-text-dim">
          Channel
        </span>
        <select
          value={config.channel}
          onChange={(e) => onChange({ ...config, channel: e.target.value as Channel })}
          data-testid="ota-config-channel"
          className="mt-1 w-full bg-bg-elevated border border-border-color rounded px-2 py-1 text-xs text-text-primary"
        >
          <option value="stable">stable</option>
          <option value="beta">beta</option>
          <option value="dev">dev</option>
        </select>
      </label>
      <label className="block">
        <span className="text-[10px] uppercase tracking-wide text-text-dim">
          HMAC Secret
        </span>
        <input
          type="password"
          value={config.secret}
          onChange={(e) => onChange({ ...config, secret: e.target.value })}
          placeholder="(shared secret)"
          spellCheck={false}
          data-testid="ota-config-secret"
          className="mt-1 w-full bg-bg-elevated border border-border-color rounded px-2 py-1 text-xs text-text-primary font-mono"
        />
      </label>
      <label className="block">
        <span className="text-[10px] uppercase tracking-wide text-text-dim">
          Aktuelle Firmware-Version
        </span>
        <input
          type="text"
          value={config.currentVersion}
          onChange={(e) => onChange({ ...config, currentVersion: e.target.value })}
          spellCheck={false}
          data-testid="ota-config-version"
          className="mt-1 w-full bg-bg-elevated border border-border-color rounded px-2 py-1 text-xs text-text-primary font-mono"
        />
      </label>
      <p className="text-[10px] text-text-dim leading-snug">
        Secret wird im localStorage gespeichert — nur fuer trusted-Geraete
        verwenden. Die HMAC-Verifikation laeuft via WebCrypto im Browser.
      </p>
    </div>
  );
}
