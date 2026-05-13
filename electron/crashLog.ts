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
