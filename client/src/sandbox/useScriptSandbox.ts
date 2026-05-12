/**
 * Synthstudio – useScriptSandbox.ts
 *
 * Main-Thread API für das sichere Ausführen von User-Skripten in einem
 * Web Worker. Stellt die `ScriptSandbox`-Klasse bereit, die einen frischen
 * Worker pro Run anlegt, ihm den User-Code per postMessage übergibt und
 * eine Allowlist-Bridge für `ss.*`-Calls bedient.
 *
 * Sicherheits-Garantien (siehe TASK-103 / B Bedrohungsmodell):
 *   1. Worker kommuniziert NICHT mit electronAPI / Node — komplett isoliert
 *   2. fetch, XHR, WebSocket usw. werden im Worker neutralisiert
 *   3. Wall-Clock-Timeout via setTimeout → worker.terminate()
 *   4. Bridge ist Default-Deny: nur explizit gewhitelistete Methoden sind erlaubt
 *   5. Parameter werden vor der Weitergabe ans System geclamped/validiert
 *   6. Dispatch-Actions sind zusätzlich gegen eine Whitelist geprüft
 *
 * Dependency-Injection: Der `bridge`-Setter-Bag erlaubt es App.tsx, die
 * realen AudioEngine-/Store-Setter zu injizieren, während Tests stubbed
 * Setter mitgeben können. So bleibt die Sandbox-Logik pur testbar.
 */

// ─── Public Types ────────────────────────────────────────────────────────────

export type SandboxLogEntry = {
  type: "info" | "error" | "system";
  message: string;
  timestamp: number;
};

export interface SandboxRunResult {
  status: "success" | "error" | "timeout" | "aborted";
  message?: string;
  durationMs: number;
  logs: SandboxLogEntry[];
}

/**
 * Setter-Bag für die Sandbox-Bridge. Jeder Setter ist optional — fehlende
 * Setter führen dazu, dass die zugehörige ss.*-Methode einen Fehler im
 * Worker wirft (Allowlist + Capability).
 *
 * Beispiel (App.tsx-Wiring):
 *   const sandbox = new ScriptSandbox({
 *     setBpm:           (v) => { AudioEngine.setBpm(v); project.setBpm(v); },
 *     play:             () => transport.start(),
 *     stop:             () => transport.stop(),
 *     setStep:          (pId, idx, on) => dm.setStepExplicit(pId, idx, on),
 *     dispatchAction:   (a) => window.dispatchEvent(new CustomEvent("kb:action", { detail: a })),
 *     getMacroValue:    (i) => getMacros()[i]?.value ?? 0,
 *     setMacroValue:    (i, v) => setMacroValue(i, v),
 *   });
 */
export interface SandboxBridge {
  setBpm?:          (value: number) => void;
  play?:            () => void;
  stop?:            () => void;
  setStep?:         (partId: string, stepIdx: number, on: boolean) => void;
  dispatchAction?:  (action: string) => void;
  getMacroValue?:   (idx: number) => number;
  setMacroValue?:   (idx: number, value: number) => void;
}

export interface SandboxRunOptions {
  /** Wall-clock-Timeout in ms. Default: 5_000. */
  maxRuntimeMs?: number;
  /** Callback pro Log-Eintrag (für Live-Output im UI). */
  onLog?: (entry: SandboxLogEntry) => void;
}

// ─── Whitelists (Default-Deny) ───────────────────────────────────────────────

/**
 * Erlaubte ss.dispatch()-Actions. Alles andere wird abgewiesen.
 * Diese Liste deckt nur idempotente Pattern-/Transport-Aktionen ab.
 * KEINE destruktiven Actions wie "delete-pattern", "save", "load" usw.
 */
const ALLOWED_DISPATCH_ACTIONS: ReadonlySet<string> = new Set([
  "play-stop", "record", "tap-tempo",
  "bpm-up", "bpm-down", "bpm-up-10", "bpm-down-10",
  "pattern-next", "pattern-prev", "pattern-duplicate",
  "pattern-clear", "pattern-fill", "pattern-randomize",
  "part-up", "part-down", "velocity-mode", "pitch-mode",
]);

/** Erlaubte Bridge-Methoden. Alles außerhalb dieser Liste → Error. */
const ALLOWED_BRIDGE_METHODS: ReadonlySet<string> = new Set([
  "bpm", "play", "stop", "setStep", "dispatch", "log", "getMacro", "setMacro",
]);

// ─── Worker-Source als String-Konstante ──────────────────────────────────────
//
// Build-Time Codegen (TASK-108, v1.18): SANDBOX_WORKER_SOURCE wird aus
// `sandbox-runtime.ts` via esbuild-Transpilation generiert und ist in
// `sandbox-runtime.generated.ts` als String-Konstante exportiert.
//
// Single Source of Truth ist `sandbox-runtime.ts`. Das `.generated.ts`-File ist
// committet (auto-erzeugt durch `scripts/generate-sandbox-source.mjs`, das via
// predev/prebuild/precheck/pretest in package.json verdrahtet ist).
//
// Bei lokaler Entwicklung wird das File bei jedem dev/build/test/check-Lauf
// regeneriert — manuelle Edits gehen verloren.
//
// Wenn dieser Import fehlschlägt: `pnpm gen:sandbox` ausführen.
import { SANDBOX_WORKER_SOURCE } from "./sandbox-runtime.generated";

// ─── Param-Validation Helpers ────────────────────────────────────────────────

function clampInt(n: unknown, min: number, max: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new Error("Expected number, got " + typeof n);
  }
  return Math.max(min, Math.min(max, Math.round(n)));
}

function clampFloat(n: unknown, min: number, max: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new Error("Expected number, got " + typeof n);
  }
  return Math.max(min, Math.min(max, n));
}

function expectString(v: unknown, label: string): string {
  if (typeof v !== "string") {
    throw new Error(label + " must be a string");
  }
  return v;
}

function expectBoolean(v: unknown, label: string): boolean {
  if (typeof v !== "boolean") {
    throw new Error(label + " must be a boolean");
  }
  return v;
}

// ─── Worker-Construction Helper (Test-Hook) ─────────────────────────────────
//
// In Node-Vitest gibt es keinen DOM-Worker. Tests können einen Mock-Worker
// per `__setWorkerFactoryForTesting` injizieren — der Standardpfad nutzt
// dagegen Blob-URL + `new Worker(url)`.

type WorkerLike = {
  postMessage: (data: unknown) => void;
  terminate: () => void;
  addEventListener: (
    type: "message" | "error" | "messageerror",
    listener: (ev: { data: unknown } | unknown) => void,
  ) => void;
  removeEventListener?: (
    type: "message" | "error" | "messageerror",
    listener: (ev: { data: unknown } | unknown) => void,
  ) => void;
};

type WorkerFactory = (source: string) => WorkerLike;

const defaultWorkerFactory: WorkerFactory = (source: string) => {
  if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined") {
    throw new Error("Web Worker not available in this environment");
  }
  const blob = new Blob([source], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const w = new Worker(url);
  // Free the blob reference once the worker has loaded.
  // (Worker keeps its own internal reference.)
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return w as unknown as WorkerLike;
};

let _workerFactory: WorkerFactory = defaultWorkerFactory;

/** Test-only: replace the Worker constructor (e.g. to use a worker_threads shim). */
export function __setWorkerFactoryForTesting(factory: WorkerFactory | null): void {
  _workerFactory = factory ?? defaultWorkerFactory;
}

/** Test-only: get the worker source string (for snapshot/integrity tests). */
export function __getSandboxWorkerSource(): string {
  return SANDBOX_WORKER_SOURCE;
}

// ─── ScriptSandbox-Klasse ────────────────────────────────────────────────────

export class ScriptSandbox {
  private worker: WorkerLike | null = null;
  private logs: SandboxLogEntry[] = [];
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private startTime = 0;
  private currentResolve: ((r: SandboxRunResult) => void) | null = null;

  constructor(private readonly bridge: SandboxBridge = {}) {}

  isRunning(): boolean {
    return this.worker !== null;
  }

  /** Startet einen frischen Worker, führt das Skript aus, liefert ein Run-Result. */
  run(code: string, opts: SandboxRunOptions = {}): Promise<SandboxRunResult> {
    if (this.isRunning()) {
      return Promise.resolve({
        status: "error",
        message: "Sandbox is already running — call abort() first",
        durationMs: 0,
        logs: [],
      });
    }

    this.logs = [];
    this.startTime = Date.now();
    const maxRuntimeMs = Math.max(50, Math.min(600_000, opts.maxRuntimeMs ?? 5_000));
    const onLog = opts.onLog;

    return new Promise<SandboxRunResult>((resolve) => {
      this.currentResolve = resolve;

      let worker: WorkerLike;
      try {
        worker = _workerFactory(SANDBOX_WORKER_SOURCE);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.appendLog("system", "Worker construction failed: " + msg, onLog);
        resolve({
          status: "error",
          message: msg,
          durationMs: Date.now() - this.startTime,
          logs: this.logs.slice(),
        });
        this.currentResolve = null;
        return;
      }
      this.worker = worker;

      const cleanup = (status: SandboxRunResult["status"], message?: string): void => {
        if (this.timeoutHandle !== null) {
          clearTimeout(this.timeoutHandle);
          this.timeoutHandle = null;
        }
        try {
          worker.terminate();
        } catch {
          /* ignore */
        }
        const r: SandboxRunResult = {
          status,
          message,
          durationMs: Date.now() - this.startTime,
          logs: this.logs.slice(),
        };
        this.worker = null;
        const rr = this.currentResolve;
        this.currentResolve = null;
        if (rr) rr(r);
      };

      const handleMessage = (ev: unknown): void => {
        const data = (ev as { data?: unknown })?.data ?? ev;
        const msg = data as { type?: string; id?: number; method?: string; args?: unknown[]; message?: string };

        if (msg?.type === "ss-call") {
          this.handleSandboxCall(msg, worker, onLog);
          return;
        }
        if (msg?.type === "done") {
          cleanup("success");
          return;
        }
        if (msg?.type === "error") {
          this.appendLog("error", "Script error: " + (msg.message ?? "unknown"), onLog);
          cleanup("error", msg.message);
          return;
        }
      };

      worker.addEventListener("message", handleMessage);
      worker.addEventListener("error", (ev: unknown) => {
        const err = ev as { message?: string };
        const message = err?.message ?? "Worker error";
        this.appendLog("error", message, onLog);
        cleanup("error", message);
      });
      worker.addEventListener("messageerror", () => {
        this.appendLog("error", "Worker messageerror (uncloneable message)", onLog);
        cleanup("error", "messageerror");
      });

      // Wall-Clock-Timeout → terminate
      this.timeoutHandle = setTimeout(() => {
        this.appendLog("system", `Timeout after ${maxRuntimeMs}ms — terminating worker`, onLog);
        cleanup("timeout", `Script exceeded ${maxRuntimeMs}ms`);
      }, maxRuntimeMs);

      // Code anstoßen
      worker.postMessage({ type: "exec", code });
    });
  }

  /** Hard-terminate. Liefert das aktuell laufende run()-Promise mit status="aborted". */
  abort(): void {
    if (!this.worker) return;
    this.appendLog("system", "Aborted by user", undefined);
    try {
      this.worker.terminate();
    } catch {
      /* ignore */
    }
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    const r: SandboxRunResult = {
      status: "aborted",
      durationMs: Date.now() - this.startTime,
      logs: this.logs.slice(),
    };
    this.worker = null;
    const rr = this.currentResolve;
    this.currentResolve = null;
    if (rr) rr(r);
  }

  // ─── Bridge (Allowlist) ────────────────────────────────────────────────────

  private handleSandboxCall(
    msg: { id?: number; method?: string; args?: unknown[] },
    worker: WorkerLike,
    onLog?: (entry: SandboxLogEntry) => void,
  ): void {
    const id = msg.id;
    const method = msg.method ?? "";
    const args = Array.isArray(msg.args) ? msg.args : [];

    if (typeof id !== "number") {
      // Ohne ID können wir nicht antworten — droppen.
      return;
    }

    if (!ALLOWED_BRIDGE_METHODS.has(method)) {
      worker.postMessage({ type: "ss-reply", id, error: "Unauthorized method: " + method });
      return;
    }

    let value: unknown = undefined;
    try {
      value = this.dispatchBridgeMethod(method, args, onLog);
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      worker.postMessage({ type: "ss-reply", id, error: errMsg });
      return;
    }
    worker.postMessage({ type: "ss-reply", id, value });
  }

  private dispatchBridgeMethod(
    method: string,
    args: unknown[],
    onLog?: (entry: SandboxLogEntry) => void,
  ): unknown {
    switch (method) {
      case "bpm": {
        const v = clampInt(args[0], 20, 300);
        if (!this.bridge.setBpm) throw new Error("setBpm not available");
        this.bridge.setBpm(v);
        return v;
      }
      case "play": {
        if (!this.bridge.play) throw new Error("play not available");
        this.bridge.play();
        return undefined;
      }
      case "stop": {
        if (!this.bridge.stop) throw new Error("stop not available");
        this.bridge.stop();
        return undefined;
      }
      case "setStep": {
        const partId = expectString(args[0], "partId");
        const stepIdx = clampInt(args[1], 0, 63);
        const on = expectBoolean(args[2], "on");
        if (!this.bridge.setStep) throw new Error("setStep not available");
        this.bridge.setStep(partId, stepIdx, on);
        return undefined;
      }
      case "dispatch": {
        const action = expectString(args[0], "action");
        if (!ALLOWED_DISPATCH_ACTIONS.has(action)) {
          throw new Error("Unauthorized dispatch action: " + action);
        }
        if (!this.bridge.dispatchAction) throw new Error("dispatchAction not available");
        this.bridge.dispatchAction(action);
        return undefined;
      }
      case "log": {
        // Truncate, ohne den User-Code crashen zu lassen.
        const raw = args[0];
        const msg = (typeof raw === "string" ? raw : String(raw)).slice(0, 500);
        this.appendLog("info", msg, onLog);
        return undefined;
      }
      case "getMacro": {
        const idx = clampInt(args[0], 0, 7);
        if (!this.bridge.getMacroValue) throw new Error("getMacroValue not available");
        return this.bridge.getMacroValue(idx);
      }
      case "setMacro": {
        // idx STRICT validiert — kein silent-clamp, weil 99 in 0..7 ein Bug ist.
        const rawIdx = args[0];
        if (typeof rawIdx !== "number" || !Number.isFinite(rawIdx) || rawIdx < 0 || rawIdx > 7 || rawIdx !== Math.floor(rawIdx)) {
          throw new Error("Macro index out of range (0..7): " + String(rawIdx));
        }
        const v = clampFloat(args[1], 0, 1);
        if (!this.bridge.setMacroValue) throw new Error("setMacroValue not available");
        this.bridge.setMacroValue(rawIdx, v);
        return undefined;
      }
      default:
        // Sollte durch ALLOWED_BRIDGE_METHODS-Check oben unmöglich sein.
        throw new Error("Unauthorized method: " + method);
    }
  }

  private appendLog(
    type: SandboxLogEntry["type"],
    message: string,
    onLog?: (entry: SandboxLogEntry) => void,
  ): void {
    const entry: SandboxLogEntry = { type, message, timestamp: Date.now() };
    this.logs.push(entry);
    // Cap at 1000 entries — drop oldest.
    if (this.logs.length > 1000) {
      this.logs.splice(0, this.logs.length - 1000);
    }
    if (onLog) {
      try {
        onLog(entry);
      } catch {
        /* swallow — onLog must not break the sandbox */
      }
    }
  }
}

// ─── Test-only exports for whitelist introspection ──────────────────────────

export const __ALLOWED_DISPATCH_ACTIONS = ALLOWED_DISPATCH_ACTIONS;
export const __ALLOWED_BRIDGE_METHODS = ALLOWED_BRIDGE_METHODS;
