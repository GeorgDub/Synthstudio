/**
 * Synthstudio – Crash Logger (post-v1.34.0 MIG-1A)
 *
 * Schreibt jeden uncaughtException / unhandledRejection / Renderer-Error in
 * eine append-only Datei in `userData/crash.log`. Wird beim App-Start gerotated
 * wenn größer als 2 MB.
 *
 * Use case: User-Reports wie "es crasht" sind ohne Logs nicht actionable.
 * Mit dieser Datei kann der User die letzten Crash-Traces einfach reichen,
 * statt sie verbal beschreiben zu müssen.
 *
 * Datei-Speicherort:
 *   - Windows: %APPDATA%\synthstudio\crash.log
 *   - macOS:   ~/Library/Application Support/synthstudio/crash.log
 *   - Linux:   ~/.config/synthstudio/crash.log
 */
import * as fs from "fs";
import * as path from "path";
import type { App } from "electron";

const MAX_LOG_SIZE = 2 * 1024 * 1024; // 2 MB

let logPath: string | null = null;
let writeStream: fs.WriteStream | null = null;

/** Initialisiert den Crash-Logger. Muss VOR den Event-Handlern aufgerufen werden. */
export function initCrashLog(app: App): void {
  try {
    const userDataDir = app.getPath("userData");
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }
    logPath = path.join(userDataDir, "crash.log");

    // Rotation: wenn Log > 2MB → umbenennen zu .old + leer starten
    if (fs.existsSync(logPath)) {
      try {
        const stats = fs.statSync(logPath);
        if (stats.size > MAX_LOG_SIZE) {
          const oldPath = `${logPath}.old`;
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
          fs.renameSync(logPath, oldPath);
        }
      } catch {
        // ignore rotation errors
      }
    }

    writeStream = fs.createWriteStream(logPath, { flags: "a" });
    writeSync(`\n========== SYNTHSTUDIO START ${new Date().toISOString()} (v${app.getVersion()}) ==========\n`);
  } catch (err) {
    console.error("[CrashLog] init failed:", err);
  }
}

/** Synchron in die Log-Datei schreiben (sync damit auch bei process.exit erhalten). */
function writeSync(line: string): void {
  try {
    if (logPath) fs.appendFileSync(logPath, line);
  } catch {
    // last-resort: ignore. Crashing on the crash logger would be... unhelpful.
  }
}

/** Loggt ein beliebiges Event (z.B. Window-Lifecycle). */
export function logEvent(label: string, payload?: Record<string, unknown>): void {
  const stamp = new Date().toISOString();
  const data = payload ? ` ${JSON.stringify(payload)}` : "";
  const line = `[${stamp}] [event] ${label}${data}\n`;
  writeSync(line);
}

/** Loggt einen unerwarteten Fehler. */
export function logCrash(source: string, err: unknown): void {
  const stamp = new Date().toISOString();
  let detail: string;
  if (err instanceof Error) {
    detail = `${err.name}: ${err.message}\n${err.stack ?? "<no stack>"}`;
  } else {
    try {
      detail = JSON.stringify(err);
    } catch {
      detail = String(err);
    }
  }
  const line = `[${stamp}] [CRASH:${source}]\n${detail}\n`;
  writeSync(line);
}

/** Pfad zur Log-Datei (für IPC/Settings-Display). */
export function getCrashLogPath(): string | null {
  return logPath;
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/** Setzt globale Handler in main process. */
export function installMainProcessCrashHandlers(): void {
  process.on("uncaughtException", (err) => {
    logCrash("main:uncaughtException", err);
    console.error("[CRASH:main:uncaughtException]", err);
  });
  process.on("unhandledRejection", (reason) => {
    logCrash("main:unhandledRejection", reason);
    console.error("[CRASH:main:unhandledRejection]", reason);
  });

  // DIAG-4: SIGTERM/SIGINT — wenn der OS oder Task-Manager den Process killt,
  // sehen wir das (sofern wir noch zum Logging kommen).
  process.on("SIGTERM", () => { logEvent("process:SIGTERM"); });
  process.on("SIGINT", () => { logEvent("process:SIGINT"); });

  process.on("exit", (code) => {
    logEvent("process:exit", { code });
  });
}

/**
 * DIAG-4: Heartbeat — loggt alle 10 Sekunden ein "tick"-Event.
 * Zweck: wenn die Logs abrupt stoppen, sehen wir an dem letzten tick + dem
 * nächsten verpassten tick OB die App hing (kein neuer tick ab Zeitpunkt X)
 * oder ob es einen externen Kill gab.
 */
export function startHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    logEvent("heartbeat", { uptime: process.uptime() });
  }, 10_000);
}

export function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * Registriert Chromium-native-crash-Detection auf einem BrowserWindow.
 * Diese Events feuern wenn das Renderer-Process nativ stirbt — z.B. bei einem
 * Segfault während window destruction, OOM, oder Chromium-internem Crash.
 *
 * Wichtig: passt zu der "popup:close → silence" Pattern aus User-Logs, wo die
 * App nach win.on('close') stirbt OHNE win.on('closed') zu erreichen.
 */
export function installWebContentsCrashHandlers(
  webContents: Electron.WebContents,
  label: string,
): void {
  webContents.on("render-process-gone", (_event, details) => {
    logCrash(`render-process-gone:${label}`, {
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
  webContents.on("unresponsive", () => {
    logEvent(`webContents:unresponsive`, { window: label });
  });
  webContents.on("responsive", () => {
    logEvent(`webContents:responsive`, { window: label });
  });
}

/** Sauberes Schließen beim App-Beenden. */
export function shutdownCrashLog(): void {
  try {
    writeSync(`========== SYNTHSTUDIO STOP ${new Date().toISOString()} ==========\n\n`);
    writeStream?.end();
    writeStream = null;
  } catch {
    // ignore
  }
}
