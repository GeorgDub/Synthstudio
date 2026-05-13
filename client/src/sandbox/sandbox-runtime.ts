/**
 * Synthstudio – Sandbox Worker Runtime
 *
 * Diese Datei ist der EXKLUSIVE Entry-Point für den Web Worker, in dem
 * User-Skripte (Script Runner) ausgeführt werden. Sie wird zur Runtime als
 * String an `useScriptSandbox.ts` weitergereicht und dort über eine Blob-URL
 * in einen frischen Worker geladen (`new Worker(URL.createObjectURL(blob))`).
 *
 * Architektur-Invarianten (siehe TASK-103 / B):
 *  - Vor Ausführung des User-Codes werden ALLE gefährlichen Globals des
 *    Worker-Scopes neutralisiert (fetch, XMLHttpRequest, WebSocket, …).
 *  - Auch `self.postMessage` wird dem User-Code entzogen — der einzige
 *    Kommunikationspfad ist die `ss.*`-Bridge, die intern eine private
 *    `__bridgePost`-Referenz nutzt.
 *  - User-Code läuft in einer Async-IIFE innerhalb eines `new Function`,
 *    bekommt aber nur das gehärtete `ss`-Objekt als Argument.
 *  - Alle ss.* Aufrufe sind asynchrone Promises, die per `{ type: "ss-call" }`
 *    an den Main-Thread gehen und dort gegen eine Allowlist geprüft werden.
 *
 * WICHTIG: Diese Datei wird NICHT direkt importiert. Sie ist die SINGLE SOURCE
 * OF TRUTH und wird via `scripts/generate-sandbox-source.mjs` (esbuild-Trans-
 * pilation, target=ES2020) zu `sandbox-runtime.generated.ts` kompiliert. Dort
 * exportiert sie die Konstante `SANDBOX_WORKER_SOURCE`, die wiederum aus
 * `useScriptSandbox.ts` importiert wird.
 *
 * Die Generierung läuft automatisch als pre-hook bei `pnpm dev`, `pnpm build`,
 * `pnpm check`, `pnpm test` (siehe package.json scripts). Für manuelles Re-Gen:
 *   pnpm gen:sandbox
 *
 * Drift-Detection: `tests/features/script-sandbox-pentest.test.ts` Tests 14-17
 * verifizieren, dass alle Hardening-Patterns in der generierten Source landen.
 */

// Damit TypeScript dies als Worker-Code akzeptiert (kein WebWorker-Lib in scope).
// Wir definieren ein minimales Strukturtyp-Alias für `self` — die echten APIs
// liefert die Worker-Runtime, nicht der Compiler.
interface SandboxWorkerScope {
  postMessage: (data: unknown) => void;
  addEventListener: (
    type: string,
    listener: (event: { data: unknown }) => void,
  ) => void;
}
declare const self: SandboxWorkerScope;

(() => {
  // ─── HÄRTUNG: gefährliche Globals neutralisieren ────────────────────────────
  // Vor dem User-Code löschen wir alles, was Daten-Exfiltration ermöglicht.
  const __bridgePost = self.postMessage.bind(self);

  // PROTOTYPE-CHAIN HARDENING (Audit-Patch v1.17):
  // Ohne diesen Schritt könnte User-Code via
  //   WorkerGlobalScope.prototype.postMessage.call(self, …)
  // die Original-postMessage rekonstruieren und damit beliebige Nachrichten
  // an den Main-Thread senden (z.B. eine gefälschte ss-reply, um einen
  // pending Bridge-Call zu manipulieren). Wir überschreiben deshalb die
  // postMessage-Slots auf jedem Prototype in der Kette mit einem Stub.
  try {
    let proto: object | null = Object.getPrototypeOf(self);
    while (proto) {
      const descriptors = Object.getOwnPropertyDescriptors(proto);
      for (const key of Object.keys(descriptors)) {
        if (key === "postMessage" || key === "importScripts") {
          try {
            Object.defineProperty(proto, key, {
              value: function () { throw new Error(key + " is not available in sandbox"); },
              writable: false,
              configurable: false,
            });
          } catch { /* property non-configurable in some engines — already locked */ }
        }
      }
      proto = Object.getPrototypeOf(proto);
    }
  } catch { /* prototype-chain hardening best-effort */ }

  (self as unknown as Record<string, unknown>).fetch = undefined;
  (self as unknown as Record<string, unknown>).XMLHttpRequest = undefined;
  (self as unknown as Record<string, unknown>).WebSocket = undefined;
  (self as unknown as Record<string, unknown>).EventSource = undefined;
  (self as unknown as Record<string, unknown>).indexedDB = undefined;
  (self as unknown as Record<string, unknown>).caches = undefined;
  (self as unknown as Record<string, unknown>).importScripts = undefined;
  (self as unknown as Record<string, unknown>).Worker = undefined;
  (self as unknown as Record<string, unknown>).SharedWorker = undefined;
  (self as unknown as Record<string, unknown>).BroadcastChannel = undefined;
  (self as unknown as Record<string, unknown>).Notification = undefined;
  (self as unknown as Record<string, unknown>).WebSocketStream = undefined;
  (self as unknown as Record<string, unknown>).RTCPeerConnection = undefined;
  (self as unknown as Record<string, unknown>).RTCDataChannel = undefined;
  (self as unknown as Record<string, unknown>).navigator = undefined;
  (self as unknown as Record<string, unknown>).clients = undefined;
  (self as unknown as Record<string, unknown>).postMessage = undefined;

  // ─── Reply-Tracking für ss.*-Calls ──────────────────────────────────────────
  let __nextMsgId = 1;
  const __pendingReplies = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  // ─── Message-Listener für REPLIES (separater Listener vom exec-Listener) ────
  self.addEventListener("message", (event: { data: unknown }) => {
    const msg = event.data as { type?: string; id?: number; error?: string; value?: unknown };
    if (msg?.type === "ss-reply" && typeof msg.id === "number") {
      const pending = __pendingReplies.get(msg.id);
      if (pending) {
        __pendingReplies.delete(msg.id);
        if (msg.error) pending.reject(new Error(msg.error));
        else pending.resolve(msg.value);
      }
    }
  });

  function ssCall(method: string, args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = __nextMsgId++;
      __pendingReplies.set(id, { resolve, reject });
      __bridgePost({ type: "ss-call", id, method, args });
    });
  }

  // ─── LOG-RATE-LIMIT (Audit-Patch v1.17) ─────────────────────────────────────
  // Schutz gegen ss.log-Spam (z.B. `for(let i=0;i<99999;i++) ss.log(i)`):
  // wir cappen Logs auf 100 pro 200ms-Sekundenfenster (= 500 logs/s). Über-
  // zählige werden serverseitig (Worker) verworfen und am Ende des Fensters
  // mit einer Sammel-Meldung quittiert. Dadurch wird der Main-Thread NICHT
  // mit 99999 postMessage events pro Skript-Ausführung geflutet.
  const LOG_RATE_WINDOW_MS = 200;
  const LOG_RATE_MAX = 100;
  let __logWindowStart = 0;
  let __logsInWindow = 0;
  let __logsDropped = 0;
  let __flushTimer: ReturnType<typeof setTimeout> | null = null;
  function __maybeFlushDropped(): void {
    if (__logsDropped > 0) {
      // Bridge-Call abfeuern für Sammelmeldung — zählt selbst NICHT ins Limit
      __bridgePost({
        type: "ss-call",
        id: -1,
        method: "log",
        args: ["[sandbox] log rate-limit: dropped " + __logsDropped + " entries"],
      });
      __logsDropped = 0;
    }
  }

  // ─── ss.*-Bridge (User-API) ─────────────────────────────────────────────────
  const ss = {
    bpm:      (v: number)                      => ssCall("bpm",      [v]),
    play:     ()                                => ssCall("play",     []),
    stop:     ()                                => ssCall("stop",     []),
    setStep:  (partId: string, stepIdx: number, on: boolean) =>
                                                  ssCall("setStep",  [partId, stepIdx, on]),
    dispatch: (action: string)                  => ssCall("dispatch", [action]),
    log:      (msg: string)                     => {
      const now = Date.now();
      if (now - __logWindowStart > LOG_RATE_WINDOW_MS) {
        __logWindowStart = now;
        __logsInWindow = 0;
      }
      if (__logsInWindow >= LOG_RATE_MAX) {
        __logsDropped++;
        // Schedule a final flush at end of window
        if (__flushTimer === null) {
          __flushTimer = setTimeout(() => { __flushTimer = null; __maybeFlushDropped(); }, LOG_RATE_WINDOW_MS);
        }
        // Resolved immediately (no-op promise) so user-code doesn't await forever
        return Promise.resolve(undefined);
      }
      __logsInWindow++;
      return ssCall("log", [msg]);
    },
    getMacro: (idx: number)                     => ssCall("getMacro", [idx]),
    setMacro: (idx: number, v: number)          => ssCall("setMacro", [idx, v]),
    /** Bewusst NICHT über die Bridge — local setTimeout, geclamped auf 60s. */
    wait:     (ms: number): Promise<void>      =>
                new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(60_000, ms)))),
    random:   ()                                => Math.random(),
    now:      ()                                => Date.now(),
  };

  // PROTOTYPE-FREEZE (Audit-Patch v1.17): verhindert dass User-Code via
  //   ss.constructor = …  oder  ss.__proto__.bpm = malicious
  // das Bridge-Objekt umschreibt. freeze(ss) macht Properties read-only,
  // freeze(Object.getPrototypeOf(ss)) härtet die Prototype-Chain.
  try {
    Object.freeze(ss);
    Object.freeze(Object.getPrototypeOf(ss));
  } catch { /* best-effort */ }

  // ─── Inline User-Code Execution (BUG-010 fix, post-v1.23.0) ─────────────────
  //
  // Vorher: `new Function('ss', code)` im Exec-Listener — funktional sauber
  //   isoliert, aber CSP-Block: `new Function` ist für Chromium äquivalent zu
  //   `eval` und erfordert `'unsafe-eval'` in `script-src`. Da wir die strikte
  //   CSP für die gesamte App bewahren wollen, vermeiden wir Function/eval
  //   komplett.
  //
  // Jetzt: Der User-Code wird VOR dem Worker-Bau in den Worker-Source-String
  //   eingebettet (siehe useScriptSandbox.ts → buildWorkerSource()). Hier
  //   sehen wir nur den Insertion-Point-Marker. Zur Run-Time existiert kein
  //   String-→-Function-Pfad mehr.
  //
  // Sicherheits-Modell-Auswirkung: der User-Code teilt sich nun das Closure
  //   mit `__bridgePost`, `__pendingReplies` etc. — d.h. er kann diese per
  //   Namen referenzieren. Das ist akzeptabel weil:
  //     1. Die echte Trust-Boundary liegt auf dem Main-Thread (Allowlist-
  //        Validation der `ss.*`-Methoden + Param-Clamping)
  //     2. Der Worst-Case (fake postMessages senden) kann nicht über die
  //        existierende `ss.*`-Allowlist eskalieren — höchstens das eigene
  //        Script verwirren
  //     3. Andere Hardening-Maßnahmen (fetch/XHR/WebSocket = undefined,
  //        Prototype-postMessage gefreezed) bleiben aktiv
  //
  // Der Marker wird DURCH NUR DIESE Datei und useScriptSandbox.ts referenziert.
  // Bitte beim Refactor synchron halten.
  (async () => {
    try {
      // The user-supplied code is concatenated into the source HERE by
      // useScriptSandbox.buildWorkerSource(). The marker is replaced with
      // the user code as raw JavaScript. The wrapping async-IIFE provides
      // top-level `await` + a single try-catch boundary.
      const __userScriptResult = await (async () => {
        "use strict";
        // Marker als Variable-Declaration mit unique String — überlebt esbuild
        // (im non-minify-Modus werden auch unused `const`-Bindings nicht weg-
        // optimiert). Wird in useScriptSandbox.buildWorkerSource durch den
        // User-Code-Block ersetzt.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const __ssMarker: string = "__SYNTHSTUDIO_USER_CODE_INSERTION_POINT_v1__";
        return __ssMarker;
      })();
      void __userScriptResult;
      __bridgePost({ type: "done" });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      __bridgePost({ type: "error", message });
    }
  })();
})();

export {};
