/**
 * Synthstudio – useToastStore (v2.5)
 *
 * Leichtgewichtiger Toast-Notification-Store. Modul-Singleton, kein
 * React-Context nötig. Auto-Dismiss nach 3s, max 5 gleichzeitige Toasts.
 *
 * Verwendung:
 *
 *   import { toast } from "@/store/useToastStore";
 *   toast("Sampler übernommen", { kind: "success", duration: 3000 });
 *
 * UI: `<ToastContainer />` einmal in App.tsx mounten — renderet alle
 * aktiven Toasts portal-frei oben rechts.
 */
import { useEffect, useReducer } from "react";

export type ToastKind = "success" | "info" | "warning" | "error";

export interface Toast {
  id: string;
  message: string;
  kind: ToastKind;
  /** Auto-dismiss ms (default 3000). 0 = sticky bis manuell entfernt. */
  duration: number;
  /** Wann wurde der Toast erstellt? (für Animations). */
  createdAt: number;
}

const MAX_TOASTS = 5;

let _toasts: Toast[] = [];
const _listeners = new Set<() => void>();

function notify(): void {
  _listeners.forEach((fn) => fn());
}

function nextId(): string {
  return `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Erstellt einen neuen Toast und gibt seine ID zurück.
 * Auto-Dismiss läuft via setTimeout — bei duration=0 bleibt der Toast.
 */
export function toast(message: string, opts: { kind?: ToastKind; duration?: number } = {}): string {
  const t: Toast = {
    id: nextId(),
    message,
    kind: opts.kind ?? "info",
    duration: opts.duration ?? 3000,
    createdAt: Date.now(),
  };
  _toasts = [..._toasts, t];
  if (_toasts.length > MAX_TOASTS) {
    _toasts = _toasts.slice(-MAX_TOASTS);
  }
  notify();
  if (t.duration > 0) {
    setTimeout(() => dismissToast(t.id), t.duration);
  }
  return t.id;
}

export function dismissToast(id: string): void {
  const before = _toasts.length;
  _toasts = _toasts.filter((t) => t.id !== id);
  if (_toasts.length !== before) notify();
}

export function clearAllToasts(): void {
  if (_toasts.length === 0) return;
  _toasts = [];
  notify();
}

export function getToasts(): Toast[] {
  return _toasts;
}

/** React-Hook der die aktuelle Toast-Liste returniert + rerendered bei Änderung. */
export function useToasts(): Toast[] {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return _toasts;
}

/** Reset für Tests. */
export function __resetToastsForTests(): void {
  _toasts = [];
  notify();
}
