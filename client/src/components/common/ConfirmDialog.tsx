/**
 * Synthstudio – ConfirmDialog.tsx + useConfirm() (v3.144.0)
 *
 * Radix AlertDialog-basierter Replacement für native window.confirm().
 * Verhindert visual mismatch und ermöglicht semantische Theme-Tokens.
 *
 * Verwendung:
 *
 *   const confirm = useConfirm();
 *   const ok = await confirm({
 *     title: "Group löschen?",
 *     message: "Die Channels bleiben unverändert.",
 *     confirmLabel: "Löschen",
 *     destructive: true,
 *   });
 *   if (ok) doDelete();
 *
 * Provider: ConfirmDialogProvider muss in der App-Root gemountet sein.  Wenn
 * der Provider fehlt, fällt useConfirm() auf window.confirm() zurück
 * (defensive — verhindert Crash bei Migration-in-progress).
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";

// ─── Public API ──────────────────────────────────────────────────────────────

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Wenn true: Confirm-Button rot (accent-danger). */
  destructive?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Hook für promise-based Confirm-Dialogs.  Fall-back auf window.confirm()
 * wenn kein Provider gemounted ist.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  return useMemo<ConfirmFn>(() => {
    if (ctx) return ctx;
    return async (options) => {
      if (typeof window === "undefined") return false;
      const msg = options.message
        ? `${options.title}\n\n${options.message}`
        : options.title;
      return window.confirm(msg);
    };
  }, [ctx]);
}

// ─── Provider ────────────────────────────────────────────────────────────────

interface PendingState extends ConfirmOptions {
  resolve: (v: boolean) => void;
}

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [pending, setPending] = useState<PendingState | null>(null);
  const pendingRef = useRef<PendingState | null>(null);
  pendingRef.current = pending;

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  const handleClose = useCallback((result: boolean) => {
    const cur = pendingRef.current;
    if (cur) cur.resolve(result);
    setPending(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog.Root open={pending !== null} onOpenChange={(open) => {
        if (!open) handleClose(false);
      }}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay
            className="fixed inset-0 z-[60] bg-bg-base/80 backdrop-blur-sm"
          />
          <AlertDialog.Content
            data-testid="confirm-dialog"
            className="fixed left-1/2 top-1/2 z-[60] w-[420px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-color bg-bg-panel shadow-2xl"
          >
            <div className="px-4 py-3 border-b border-border-color">
              <AlertDialog.Title className="text-sm font-semibold text-text-primary">
                {pending?.title ?? ""}
              </AlertDialog.Title>
            </div>
            {pending?.message && (
              <div className="px-4 py-3">
                <AlertDialog.Description className="text-xs text-text-muted whitespace-pre-wrap">
                  {pending.message}
                </AlertDialog.Description>
              </div>
            )}
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-color bg-bg-base/40">
              <AlertDialog.Cancel asChild>
                <button
                  type="button"
                  onClick={() => handleClose(false)}
                  data-testid="confirm-dialog-cancel"
                  className="px-3 py-1.5 rounded text-xs border border-border-color text-text-muted hover:text-text-primary transition-colors"
                >
                  {pending?.cancelLabel ?? "Abbrechen"}
                </button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button
                  type="button"
                  onClick={() => handleClose(true)}
                  data-testid="confirm-dialog-confirm"
                  className={[
                    "px-3 py-1.5 rounded text-xs font-semibold transition-colors",
                    pending?.destructive
                      ? "bg-accent-danger text-white hover:bg-accent-danger/80"
                      : "bg-accent-primary text-bg-base hover:bg-accent-primary/80",
                  ].join(" ")}
                >
                  {pending?.confirmLabel ?? "OK"}
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </ConfirmContext.Provider>
  );
}
