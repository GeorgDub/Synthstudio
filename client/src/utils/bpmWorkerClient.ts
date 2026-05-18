/**
 * Synthstudio – BPM-Worker Client (v3.54.0)
 *
 * Schickt einen AudioBuffer an den audioAnalysis.worker.ts und liefert
 * { bpm, confidence } zurück.  Bei Worker-Fail (Worker nicht verfügbar,
 * Timeout, Error-Message) wird `null` returniert — der Caller kann dann
 * silent auf den Main-Thread-Pfad fallen.
 *
 * Closes v3.53 Caveat (Auto-BPM-Detection läuft Main-Thread).
 *
 * Design:
 *  - factory `createBpmWorker()` instanziert genau einen Worker, der für die
 *    Lifetime der App-Instanz lebt (Singleton via Module-State).  Tests
 *    können via `__resetBpmWorkerClientForTests()` neu initialisieren.
 *  - `analyzeBpmInWorker(buf, timeoutMs=10000)` baut aus dem AudioBuffer
 *    einen WAV-PCM-ArrayBuffer (transferable) und schickt ihn als
 *    'analyzeBpm'-Message.
 *  - Bei Timeout wird die Pending-Promise mit null aufgelöst — Worker
 *    bleibt am Leben für den nächsten Call.
 *
 * Hinweis: Wir bauen WAV-PCM auf dem Main-Thread, damit der Worker das
 * Buffer-Decoding selbst übernehmen kann (er hat keinen Zugriff auf das
 * dekodierte AudioBuffer-Objekt — das ist Hauptthread-only).  Für sehr
 * lange Files (>10 Min) trimmen wir auf die ersten 30 Sekunden, um die
 * Message-Größe zu begrenzen.
 */

// ─── Konstanten ──────────────────────────────────────────────────────────────

/** Maximale Buffer-Dauer für die Worker-Message (Sekunden). */
export const BPM_WORKER_MAX_DURATION_SEC = 30;

/** Default-Timeout für die Worker-Antwort. */
export const BPM_WORKER_DEFAULT_TIMEOUT_MS = 10000;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BpmWorkerResult {
  bpm: number;
  confidence: number;
}

interface WorkerMessage {
  type: "bpmResult" | "error" | "progress";
  id: string;
  bpm?: number;
  confidence?: number;
  message?: string;
}

interface WorkerRef {
  worker: Worker | null;
  pending: Map<string, (r: BpmWorkerResult | null) => void>;
}

// ─── Module-Singleton ────────────────────────────────────────────────────────

let _workerRef: WorkerRef = { worker: null, pending: new Map() };
let _workerInitFailed = false;
let _idCounter = 0;

/**
 * Liefert den Worker, falls verfügbar.  Gibt null zurück, wenn der Worker
 * nicht initialisiert werden konnte (z.B. Test-Env ohne `Worker`-Global,
 * Vite-Build-Fehler).  Nach einem Init-Fail wird NICHT erneut versucht
 * (vermeidet endlose Worker-Konstruktor-Calls).
 */
function ensureWorker(): Worker | null {
  if (_workerRef.worker !== null) return _workerRef.worker;
  if (_workerInitFailed) return null;
  if (typeof Worker === "undefined") {
    _workerInitFailed = true;
    return null;
  }
  try {
    const worker = new Worker(
      new URL("../workers/audioAnalysis.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const { type, id } = event.data;
      const resolve = _workerRef.pending.get(id);
      if (!resolve) return;
      if (type === "bpmResult") {
        const bpm = event.data.bpm;
        const confidence = event.data.confidence;
        if (typeof bpm === "number" && typeof confidence === "number") {
          resolve({ bpm, confidence });
        } else {
          resolve(null);
        }
        _workerRef.pending.delete(id);
      } else if (type === "error") {
        resolve(null);
        _workerRef.pending.delete(id);
      }
      // 'progress' wird ignoriert.
    };
    worker.onerror = () => {
      // Worker-Fehler: alle Pendings auflösen, Worker reset
      for (const resolve of _workerRef.pending.values()) resolve(null);
      _workerRef.pending.clear();
    };
    _workerRef.worker = worker;
    return worker;
  } catch {
    _workerInitFailed = true;
    return null;
  }
}

// ─── WAV-Encoder (für Worker-Transfer) ───────────────────────────────────────

/**
 * Erzeugt einen RIFF/WAVE 16-bit-PCM ArrayBuffer aus einem AudioBuffer.
 * Pure-fn, ohne Side-Effects.  Wir nutzen nur Kanal 0 (Mono) — der Worker
 * verwendet ebenfalls nur Kanal 0 für die BPM-Detection.
 *
 * Trimmt auf max BPM_WORKER_MAX_DURATION_SEC Sekunden.
 */
export function encodeBufferToMonoWav(buf: AudioBuffer): ArrayBuffer {
  const sampleRate = buf.sampleRate;
  const maxSamples = Math.min(
    buf.length,
    Math.floor(sampleRate * BPM_WORKER_MAX_DURATION_SEC),
  );
  const channelData = buf.getChannelData(0);
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = maxSamples * blockAlign;
  const totalSize = 44 + dataSize;

  const out = new ArrayBuffer(totalSize);
  const view = new DataView(out);

  // RIFF-Header
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, totalSize - 8, true);
  writeAscii(view, 8, "WAVE");
  // fmt-Chunk
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  // data-Chunk
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // 16-bit PCM Samples
  let offset = 44;
  for (let i = 0; i < maxSamples; i++) {
    const s = Math.max(-1, Math.min(1, channelData[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return out;
}

function writeAscii(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Analysiert BPM in einem Web-Worker.  Bei Worker-Fail (kein Worker im
 * Browser, Timeout, Error-Message) wird `null` returniert.
 *
 * Test-Helper: Wenn `globalThis.__bpmWorkerTestOverride` gesetzt ist, wird
 * dieser statt des echten Worker-Setups verwendet (für unit-Tests).
 */
export async function analyzeBpmInWorker(
  buf: AudioBuffer,
  timeoutMs: number = BPM_WORKER_DEFAULT_TIMEOUT_MS,
): Promise<BpmWorkerResult | null> {
  // Test-Override für deterministische Unit-Tests
  const override = (globalThis as { __bpmWorkerTestOverride?: (b: AudioBuffer) => Promise<BpmWorkerResult | null> })
    .__bpmWorkerTestOverride;
  if (typeof override === "function") {
    return override(buf);
  }

  const worker = ensureWorker();
  if (worker === null) return null;

  let arrayBuf: ArrayBuffer;
  try {
    arrayBuf = encodeBufferToMonoWav(buf);
  } catch {
    return null;
  }

  const id = `bpm_${++_idCounter}_${Date.now()}`;

  return new Promise<BpmWorkerResult | null>((resolve) => {
    _workerRef.pending.set(id, resolve);

    const timer = setTimeout(() => {
      if (_workerRef.pending.has(id)) {
        _workerRef.pending.delete(id);
        resolve(null);
      }
    }, timeoutMs);

    // Resolve-Wrapper, der den Timer cancelt
    const originalResolve = _workerRef.pending.get(id)!;
    _workerRef.pending.set(id, (r) => {
      clearTimeout(timer);
      originalResolve(r);
    });

    try {
      worker.postMessage({ type: "analyzeBpm", id, audioData: arrayBuf }, [arrayBuf]);
    } catch {
      _workerRef.pending.delete(id);
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/**
 * Reset für Tests (oder Hot-Reload).  Terminiert den aktuellen Worker und
 * setzt den Init-State zurück, damit `ensureWorker()` beim nächsten Call
 * neu versucht.
 */
export function __resetBpmWorkerClientForTests(): void {
  try {
    _workerRef.worker?.terminate();
  } catch {
    // ignore
  }
  _workerRef = { worker: null, pending: new Map() };
  _workerInitFailed = false;
  _idCounter = 0;
  delete (globalThis as { __bpmWorkerTestOverride?: unknown }).__bpmWorkerTestOverride;
}

/** Test-Helper: liefert die Anzahl der Pending-Requests (für Leak-Checks). */
export function __getBpmWorkerPendingCount(): number {
  return _workerRef.pending.size;
}
