import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

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
