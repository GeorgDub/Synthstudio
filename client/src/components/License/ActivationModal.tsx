/**
 * Synthstudio – ActivationModal (TASK-232, v2.97)
 *
 * Shown once on app start when `licenseStore.status === 'unknown'`. The user
 * can:
 *   - Start a 30-day trial      → status becomes 'trial'
 *   - Activate a license key    → status becomes 'pro' (or stays unknown on fail)
 *   - Continue with the free DAW → modal closes, status moves to 'expired'
 *                                  (= the locked subset). User can still
 *                                  activate later from Settings.
 *
 * The modal is intentionally **closable** after the first decision is made —
 * users can always re-open it from the Settings → License panel.
 */
import { useState } from "react";
import { X, Lock, KeyRound, Sparkles } from "lucide-react";
import {
  useLicenseStore,
  startTrial,
  activate,
  markUnknownAsExpired,
} from "@/store/useLicenseStore";
import { toast } from "@/store/useToastStore";
import {
  GUMROAD_PRODUCT_URL,
  TRIAL_DURATION_DAYS,
  isUsingPlaceholderPublicKey,
} from "@/utils/licenseConfig";

interface ActivationModalProps {
  /** Override visibility from a parent (e.g. Settings → "License-Aktivieren"). */
  forceOpen?: boolean;
  onClose?: () => void;
}

export function ActivationModal({ forceOpen, onClose }: ActivationModalProps) {
  const state = useLicenseStore();
  const [mode, setMode] = useState<"choice" | "activate">("choice");
  const [keyInput, setKeyInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isVisible = forceOpen ?? (state.status === "unknown");
  if (!isVisible) return null;

  const close = () => {
    setError(null);
    setMode("choice");
    onClose?.();
  };

  const handleStartTrial = () => {
    const started = startTrial();
    if (started) {
      toast(`30-Tage Pro-Trial gestartet — Tag 1 von ${TRIAL_DURATION_DAYS}`, {
        kind: "success",
        duration: 5000,
      });
    }
    close();
  };

  const handleContinueFree = () => {
    markUnknownAsExpired();
    toast("Du nutzt Synthstudio Free. Pro-Features sind gesperrt.", {
      kind: "info",
      duration: 5000,
    });
    close();
  };

  const handleActivate = async () => {
    setBusy(true);
    setError(null);
    try {
      const ok = await activate(keyInput, emailInput || undefined);
      if (ok) {
        toast("Lizenz aktiviert — Pro-Features freigeschaltet.", {
          kind: "success",
          duration: 6000,
        });
        close();
      } else {
        setError("Lizenz-Schlüssel ungültig oder abgelaufen.");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Lizenz-Aktivierung"
    >
      <div className="relative w-full max-w-md mx-4 rounded-lg border border-border-color bg-bg-panel p-6 shadow-2xl">
        {/* Close (only when forced/parent-controlled) */}
        {forceOpen && (
          <button
            type="button"
            onClick={close}
            className="absolute top-3 right-3 text-text-muted hover:text-text-primary"
            aria-label="Schließen"
          >
            <X size={18} />
          </button>
        )}

        <div className="flex items-center gap-3 mb-4">
          <div className="rounded-full bg-accent-primary/20 p-2 text-accent-primary">
            <Sparkles size={22} />
          </div>
          <h2 className="text-xl font-semibold text-text-primary">
            Synthstudio Pro
          </h2>
        </div>

        {mode === "choice" ? (
          <>
            <p className="text-sm text-text-muted mb-5">
              Probiere alle Pro-Features {TRIAL_DURATION_DAYS} Tage lang kostenlos —
              kein Konto, keine Kreditkarte.
            </p>

            <div className="space-y-3">
              <button
                type="button"
                onClick={handleStartTrial}
                className="w-full rounded bg-accent-primary px-4 py-2.5 text-sm font-medium text-bg-base hover:opacity-90"
              >
                {TRIAL_DURATION_DAYS}-Tage-Trial starten
              </button>

              <button
                type="button"
                onClick={() => setMode("activate")}
                className="w-full rounded border border-border-color bg-bg-elevated px-4 py-2.5 text-sm font-medium text-text-primary hover:bg-bg-base"
              >
                <KeyRound size={14} className="inline mr-2" />
                Lizenz aktivieren
              </button>

              <button
                type="button"
                onClick={handleContinueFree}
                className="w-full rounded px-4 py-2.5 text-sm font-medium text-text-muted hover:text-text-primary"
              >
                Mit Free-Version fortfahren
              </button>
            </div>

            <div className="mt-5 pt-4 border-t border-border-subtle text-center">
              <a
                href={GUMROAD_PRODUCT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-accent-primary hover:underline"
              >
                Pro-Lizenz kaufen →
              </a>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-text-muted mb-4">
              Trage deinen Lizenz-Schlüssel ein. Die Aktivierung läuft offline.
            </p>

            <label className="block text-xs text-text-muted mb-1">
              Lizenz-Schlüssel
            </label>
            <textarea
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              className="w-full h-24 rounded border border-border-color bg-bg-elevated p-2 text-xs font-mono text-text-primary focus:border-accent-primary focus:outline-none"
              placeholder="<base64-payload>.<base64-signature>"
              disabled={busy}
            />

            <label className="block text-xs text-text-muted mt-3 mb-1">
              E-Mail (optional)
            </label>
            <input
              type="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              className="w-full rounded border border-border-color bg-bg-elevated px-2 py-1.5 text-sm text-text-primary focus:border-accent-primary focus:outline-none"
              placeholder="you@example.com"
              disabled={busy}
            />

            {error && (
              <div className="mt-3 rounded bg-accent-danger/15 border border-accent-danger/40 px-3 py-2 text-xs text-accent-danger">
                <Lock size={12} className="inline mr-1" />
                {error}
              </div>
            )}

            {isUsingPlaceholderPublicKey() && (
              <div className="mt-3 rounded bg-accent-warning/15 border border-accent-warning/40 px-3 py-2 text-[11px] text-text-muted">
                Hinweis (Dev): Public-Key ist Placeholder — keine echte Lizenz validierbar.
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={handleActivate}
                disabled={busy || keyInput.trim().length === 0}
                className="flex-1 rounded bg-accent-primary px-4 py-2 text-sm font-medium text-bg-base disabled:opacity-50 hover:opacity-90"
              >
                {busy ? "Prüfe…" : "Aktivieren"}
              </button>
              <button
                type="button"
                onClick={() => { setMode("choice"); setError(null); }}
                disabled={busy}
                className="rounded border border-border-color px-4 py-2 text-sm text-text-muted hover:text-text-primary"
              >
                Zurück
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
