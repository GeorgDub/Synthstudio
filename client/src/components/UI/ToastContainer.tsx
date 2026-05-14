/**
 * Synthstudio – ToastContainer (v2.5)
 *
 * Rendert alle aktiven Toasts oben rechts. Stack-Layout, auto-positioned.
 * Wird einmal in App.tsx gemountet.
 */
import { useToasts, dismissToast, type Toast } from "@/store/useToastStore";

const KIND_STYLES: Record<Toast["kind"], { bg: string; text: string; icon: string }> = {
  success: { bg: "bg-accent-success/30 border-accent-success",     text: "text-accent-success",   icon: "✓" },
  info:    { bg: "bg-accent-secondary/30 border-accent-secondary", text: "text-accent-secondary", icon: "ℹ" },
  warning: { bg: "bg-accent-primary/30 border-accent-primary",     text: "text-accent-primary",   icon: "⚠" },
  error:   { bg: "bg-accent-danger/30 border-accent-danger",       text: "text-accent-danger",    icon: "✕" },
};

export function ToastContainer() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;
  return (
    <div
      className="fixed top-3 right-3 z-[300] flex flex-col gap-1.5 pointer-events-none"
      style={{ maxWidth: "min(420px, calc(100vw - 24px))" }}
      data-testid="toast-container"
    >
      {toasts.map((t) => {
        const s = KIND_STYLES[t.kind];
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2 px-3 py-2 rounded shadow-lg border ${s.bg} backdrop-blur-sm`}
            data-testid={`toast-${t.kind}`}
          >
            <span className={`font-bold text-sm leading-tight ${s.text}`}>{s.icon}</span>
            <div className={`flex-1 text-xs leading-tight ${s.text}`}>{t.message}</div>
            <button
              onClick={() => dismissToast(t.id)}
              className={`text-xs leading-none ${s.text} hover:opacity-70 -mt-0.5`}
              aria-label="Toast schließen"
              title="Schließen"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
