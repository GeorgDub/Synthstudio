/**
 * Synthstudio – recordingStorage.ts (TASK-234 / v2.86)
 *
 * Isomorpher Speicher für Recordings:
 *  - Electron: schreibt WAV via IPC `audio:save-recording` in
 *    `userData/recordings/<id>.wav` und liefert den Pfad zurück.
 *  - Browser:  speichert als Blob in IndexedDB (Store `recordings`, Key=id)
 *    und liefert einen `indexeddb://<id>` URI als "filePath"-Surrogat.
 *
 * Aufrufer (App.tsx Transport-Hook) ruft `saveRecording(id, wavArrayBuffer)`
 * direkt nach `transport:stop` und übergibt das Result an `addAudioTrack`.
 *
 * Diese Schicht ist bewusst klein gehalten — die WAV-Encode-Logik selbst lebt
 * in `wavEncoder.ts` und das Recording-Pipeline in `AudioRecorder.ts`.
 */

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface SaveRecordingResult {
  /** "filePath" für AudioTrack: echter FS-Pfad (Electron) oder `indexeddb://<id>` (Browser). */
  filePath: string;
  /** Anzeigename (Dateiname ohne Pfad). */
  fileName: string;
  /** WAV-Größe in Bytes. */
  fileSize: number;
  /** Wahr für IndexedDB-Surrogate-URIs (UI zeigt evtl. Hinweis). */
  isVirtual: boolean;
}

// ─── IndexedDB-Wrapper (Browser-Fallback) ────────────────────────────────────

const DB_NAME = "synthstudio-recordings";
const DB_VERSION = 1;
const STORE_NAME = "recordings";

let _dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB nicht verfügbar"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
  return _dbPromise;
}

/** Speichert einen WAV-Blob unter dem gegebenen Key. */
export async function idbPutRecording(
  id: string,
  blob: Blob,
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(blob, id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("IDB put failed"));
  });
}

/** Liest einen Blob zurück. Null wenn unbekannt. */
export async function idbGetRecording(id: string): Promise<Blob | null> {
  const db = await openDb();
  return new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error("IDB get failed"));
  });
}

/** Entfernt einen Eintrag. No-op wenn unbekannt. */
export async function idbDeleteRecording(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("IDB delete failed"));
  });
}

// ─── Filename-Helpers ─────────────────────────────────────────────────────────

/**
 * Generiert einen "menschlichen" Dateinamen für ein Recording aus Channel-Name
 * + Timestamp. Sanitized: nur a-zA-Z0-9_- erlaubt.
 *
 * @example buildRecordingFileName("Bassdrum", new Date("2026-05-17T22:30:15"))
 *   → "Rec-Bassdrum-20260517-223015.wav"
 */
export function buildRecordingFileName(channelName: string, when: Date = new Date()): string {
  const safeName = (channelName || "channel")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "channel";
  const pad = (n: number) => n.toString().padStart(2, "0");
  const stamp = `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}-${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}`;
  return `Rec-${safeName}-${stamp}.wav`;
}

/**
 * Validiert dass ein Dateiname keine Path-Traversal-Sequenzen enthält und nur
 * unbedenkliche Zeichen + .wav-Extension trägt. Aufrufer im Electron-IPC-Handler.
 *
 * Wirft KEINE — caller-side hat reine Boolean-Logik (Security-First).
 */
export function isSafeRecordingFileName(name: string): boolean {
  if (typeof name !== "string" || name.length === 0 || name.length > 120) return false;
  if (name.includes("\0")) return false;
  if (name.includes("/") || name.includes("\\")) return false;
  if (name.includes("..")) return false;
  // Nur alphanum + _ . - erlaubt, plus muss mit .wav enden
  if (!/^[A-Za-z0-9._-]+\.wav$/.test(name)) return false;
  return true;
}

// ─── Public Save-API ──────────────────────────────────────────────────────────

/**
 * Top-Level-Speicher-Funktion. Wählt automatisch Electron vs Browser-Pfad.
 *
 * @param id           Eindeutige ID (wird Teil des virtuellen URIs im Browser).
 * @param channelName  Anzeigename (für File-Name-Generation).
 * @param wavBuffer    Vollständige WAV-Datei (Header + PCM).
 * @param electronApi  `window.electronAPI` bzw. typkompatibles Objekt; null → Browser.
 */
export async function saveRecording(
  id: string,
  channelName: string,
  wavBuffer: ArrayBuffer,
  electronApi: {
    saveRecording?: (
      filename: string,
      data: ArrayBuffer,
    ) => Promise<{ success: boolean; filePath?: string; error?: string }>;
  } | null,
): Promise<SaveRecordingResult> {
  const fileName = buildRecordingFileName(channelName);
  const fileSize = wavBuffer.byteLength;

  // Electron-Pfad
  if (electronApi?.saveRecording) {
    const result = await electronApi.saveRecording(fileName, wavBuffer);
    if (result?.success && result.filePath) {
      return { filePath: result.filePath, fileName, fileSize, isVirtual: false };
    }
    // Fallthrough zu IDB falls Electron-Save fehlschlägt.
    console.warn("[recordingStorage] Electron save failed, falling back to IDB:", result?.error);
  }

  // Browser-Pfad / Electron-Fallback
  const blob = new Blob([wavBuffer], { type: "audio/wav" });
  await idbPutRecording(id, blob);
  return {
    filePath: `indexeddb://${id}`,
    fileName,
    fileSize,
    isVirtual: true,
  };
}
