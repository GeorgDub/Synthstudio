/**
 * client/src/sandbox/sandbox-runtime.generated.ts
 *
 * AUTO-GENERATED — DO NOT EDIT.
 *
 * Quelle: client/src/sandbox/sandbox-runtime.ts
 * Generator: scripts/generate-sandbox-source.mjs
 *
 * Dieses File wird beim Pre-Build (predev/prebuild/precheck/pretest) automatisch
 * neu erzeugt. Manuelle Änderungen werden überschrieben — bearbeite stattdessen
 * sandbox-runtime.ts und führe `pnpm gen:sandbox` aus.
 *
 * Der String SANDBOX_WORKER_SOURCE ist die ES2020-transpilierte Variante von
 * sandbox-runtime.ts und wird zur Runtime via Blob-URL in einen Web Worker
 * geladen.
 */

/* eslint-disable */

/** SHA-256 des Source-Files (sandbox-runtime.ts) zum Zeitpunkt der Generierung. */
export const SANDBOX_RUNTIME_SOURCE_SHA256 = "d1c3cd64073df7aef5c1cc19f530c70c7d4b56d93ed3889a2d0ca8358f919fa5";

/** SHA-256 des transpilierten Outputs (deterministisch bei gleicher esbuild-Version). */
export const SANDBOX_WORKER_SOURCE_SHA256 = "6ca8a15d22f4a997d0699fb9ec74f71e1194ad6a8b1871168295b4afabc781ae";

/**
 * Transpilierter Sandbox-Worker-Quelltext. Wird zur Runtime via Blob-URL in
 * einen Web Worker geladen.
 */
export const SANDBOX_WORKER_SOURCE = String.raw`var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
(() => {
  const __bridgePost = self.postMessage.bind(self);
  try {
    let proto = Object.getPrototypeOf(self);
    while (proto) {
      const descriptors = Object.getOwnPropertyDescriptors(proto);
      for (const key of Object.keys(descriptors)) {
        if (key === "postMessage" || key === "importScripts") {
          try {
            Object.defineProperty(proto, key, {
              value: /* @__PURE__ */ __name(function() {
                throw new Error(key + " is not available in sandbox");
              }, "value"),
              writable: false,
              configurable: false
            });
          } catch {
          }
        }
      }
      proto = Object.getPrototypeOf(proto);
    }
  } catch {
  }
  self.fetch = void 0;
  self.XMLHttpRequest = void 0;
  self.WebSocket = void 0;
  self.EventSource = void 0;
  self.indexedDB = void 0;
  self.caches = void 0;
  self.importScripts = void 0;
  self.Worker = void 0;
  self.SharedWorker = void 0;
  self.BroadcastChannel = void 0;
  self.Notification = void 0;
  self.WebSocketStream = void 0;
  self.RTCPeerConnection = void 0;
  self.RTCDataChannel = void 0;
  self.navigator = void 0;
  self.clients = void 0;
  self.postMessage = void 0;
  let __nextMsgId = 1;
  const __pendingReplies = /* @__PURE__ */ new Map();
  self.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg?.type === "ss-reply" && typeof msg.id === "number") {
      const pending = __pendingReplies.get(msg.id);
      if (pending) {
        __pendingReplies.delete(msg.id);
        if (msg.error) pending.reject(new Error(msg.error));
        else pending.resolve(msg.value);
      }
    }
  });
  function ssCall(method, args) {
    return new Promise((resolve, reject) => {
      const id = __nextMsgId++;
      __pendingReplies.set(id, { resolve, reject });
      __bridgePost({ type: "ss-call", id, method, args });
    });
  }
  __name(ssCall, "ssCall");
  const LOG_RATE_WINDOW_MS = 200;
  const LOG_RATE_MAX = 100;
  let __logWindowStart = 0;
  let __logsInWindow = 0;
  let __logsDropped = 0;
  let __flushTimer = null;
  function __maybeFlushDropped() {
    if (__logsDropped > 0) {
      __bridgePost({
        type: "ss-call",
        id: -1,
        method: "log",
        args: ["[sandbox] log rate-limit: dropped " + __logsDropped + " entries"]
      });
      __logsDropped = 0;
    }
  }
  __name(__maybeFlushDropped, "__maybeFlushDropped");
  const ss = {
    bpm: /* @__PURE__ */ __name((v) => ssCall("bpm", [v]), "bpm"),
    play: /* @__PURE__ */ __name(() => ssCall("play", []), "play"),
    stop: /* @__PURE__ */ __name(() => ssCall("stop", []), "stop"),
    setStep: /* @__PURE__ */ __name((partId, stepIdx, on) => ssCall("setStep", [partId, stepIdx, on]), "setStep"),
    dispatch: /* @__PURE__ */ __name((action) => ssCall("dispatch", [action]), "dispatch"),
    log: /* @__PURE__ */ __name((msg) => {
      const now = Date.now();
      if (now - __logWindowStart > LOG_RATE_WINDOW_MS) {
        __logWindowStart = now;
        __logsInWindow = 0;
      }
      if (__logsInWindow >= LOG_RATE_MAX) {
        __logsDropped++;
        if (__flushTimer === null) {
          __flushTimer = setTimeout(() => {
            __flushTimer = null;
            __maybeFlushDropped();
          }, LOG_RATE_WINDOW_MS);
        }
        return Promise.resolve(void 0);
      }
      __logsInWindow++;
      return ssCall("log", [msg]);
    }, "log"),
    getMacro: /* @__PURE__ */ __name((idx) => ssCall("getMacro", [idx]), "getMacro"),
    setMacro: /* @__PURE__ */ __name((idx, v) => ssCall("setMacro", [idx, v]), "setMacro"),
    /** Bewusst NICHT über die Bridge — local setTimeout, geclamped auf 60s. */
    wait: /* @__PURE__ */ __name((ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(6e4, ms)))), "wait"),
    random: /* @__PURE__ */ __name(() => Math.random(), "random"),
    now: /* @__PURE__ */ __name(() => Date.now(), "now")
  };
  try {
    Object.freeze(ss);
    Object.freeze(Object.getPrototypeOf(ss));
  } catch {
  }
  (async () => {
    try {
      const __userScriptResult = await (async () => {
        "use strict";
        const __ssMarker = "__SYNTHSTUDIO_USER_CODE_INSERTION_POINT_v1__";
        return __ssMarker;
      })();
      void __userScriptResult;
      __bridgePost({ type: "done" });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      __bridgePost({ type: "error", message });
    }
  })();
})();
`;
