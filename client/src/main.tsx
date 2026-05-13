import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// MIG-1A: globale Renderer-Crash-Handler.
// Wichtig: läuft in JEDEM Renderer-Prozess (Main + alle Popup-Apps).
// Logs landen in der Devtools-Konsole + werden via console.error gespiegelt;
// für persistente Datei-Logs bräuchten wir IPC zum Main-Prozess (Phase 2).
window.addEventListener("error", (event) => {
  const err = event.error ?? new Error(String(event.message));
  console.error("[CRASH:renderer:error]", err);
  // Mehr Detail in eine separate Konsole-Zeile damit die Stack-Trace
  // beim Copy-Paste vollständig kopiert wird.
  console.error("[CRASH:renderer:stack]", err instanceof Error ? err.stack : "<no stack>");
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  console.error("[CRASH:renderer:unhandledRejection]", reason);
  if (reason instanceof Error) {
    console.error("[CRASH:renderer:stack]", reason.stack ?? "<no stack>");
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// PWA Service Worker registrieren (nur in Production + Browser, nicht in Electron)
if ("serviceWorker" in navigator && !window.location.protocol.startsWith("file")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js", { scope: "./" })
      .then(reg => console.log("[PWA] Service Worker registriert:", reg.scope))
      .catch(err => console.warn("[PWA] Service Worker Fehler:", err));
  });
}
