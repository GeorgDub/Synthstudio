import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// MIG-1A + DIAG-2: globale Renderer-Crash-Handler.
// Läuft in JEDEM Renderer (Main + Popup-Apps). Crashes werden:
//   1. in die Devtools-Konsole geloggt
//   2. via IPC ans Main weitergereicht damit sie in userData/crash.log persistiert werden
function reportRendererCrash(source: string, err: unknown): void {
  let message: string;
  let stack: string | undefined;
  if (err instanceof Error) {
    message = `${err.name}: ${err.message}`;
    stack = err.stack;
  } else {
    try { message = JSON.stringify(err); } catch { message = String(err); }
  }
  console.error(`[CRASH:renderer:${source}]`, err);
  if (stack) console.error("[CRASH:renderer:stack]", stack);
  // Best-effort IPC: window.electronAPI ist nur in Electron-Renderer verfügbar.
  try {
    type CrashBridge = { logRendererCrash?: (source: string, message: string, stack?: string) => void };
    const api = (window as unknown as { electronAPI?: CrashBridge }).electronAPI;
    api?.logRendererCrash?.(source, message, stack);
  } catch {
    // Wenn IPC nicht verfügbar (z.B. Web-Modus oder vor preload-load), nur Konsole.
  }
}

window.addEventListener("error", (event) => {
  reportRendererCrash("error", event.error ?? new Error(String(event.message)));
});
window.addEventListener("unhandledrejection", (event) => {
  reportRendererCrash("unhandledRejection", event.reason);
});

// MIG-3: Dockview-Popout-Page. window.open(popout.html) öffnet eine same-origin
// Seite, in die dockview die Panel-DOM-Nodes via externalDocument.body.appendChild
// schreibt. Wir wollen hier KEINE React-App mounten — die Panel-DOM kommt aus
// dem Hauptfenster, kein #root erforderlich.
const isDockviewPopout =
  window.opener !== null && /popout\.html/i.test(window.location.pathname);

if (!isDockviewPopout) {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

// PWA Service Worker registrieren (nur in Production + Browser, nicht in Electron)
if ("serviceWorker" in navigator && !window.location.protocol.startsWith("file")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js", { scope: "./" })
      .then(reg => console.log("[PWA] Service Worker registriert:", reg.scope))
      .catch(err => console.warn("[PWA] Service Worker Fehler:", err));
  });
}
