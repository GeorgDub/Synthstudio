/**
 * Synthstudio – useAudioInput (post-v1.32.0 UX-Polish)
 *
 * Mikrofon/Line-in Aufnahme direkt in neue Samples.
 * Verwendet getUserMedia + MediaRecorder → Blob → ArrayBuffer → Sample.
 *
 * Post-v1.32.0 additions:
 *  - `deviceId` option to pick which input device (USB mic / line-in / loopback)
 *  - `availableDevices` list returned for UI picker
 *  - `recordingDurationMs` live timer while recording
 *  - `pendingSample` snapshot of the just-finished recording so the UI can
 *    show a rename-before-save dialog instead of auto-adding with default name.
 *    User confirms via `confirmPendingSample(name)` or discards via `discardPendingSample()`.
 *
 * Returns:
 *  - start()                     Aufnahme beginnen
 *  - stop()                      Aufnahme beenden → pendingSample wird gesetzt
 *  - isRecording                 Aktueller Status
 *  - isAvailable                 getUserMedia verfügbar?
 *  - level                       VU-Meter-Pegel 0–1 (Peak)
 *  - error                       Fehler-Nachricht (z.B. Permission denied)
 *  - recordingDurationMs         Aktuelle Aufnahme-Dauer in ms (0 wenn nicht recording)
 *  - availableDevices            Liste verfügbarer Audio-Inputs
 *  - deviceId / setDeviceId      Ausgewähltes Input-Device (default: undefined = System-Default)
 *  - pendingSample               Letzter aufgenommener Take (vor User-Bestätigung)
 *  - confirmPendingSample(name)  Mit Custom-Name speichern
 *  - discardPendingSample()      Take verwerfen (z.B. Versprecher)
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { requireProFeature, PRO_FEATURE_USB_AUDIO_IN } from "@/utils/proFeatures";

export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

export interface PendingSample {
  url: string;
  defaultName: string;
  durationSec: number;
}

export interface AudioInputOptions {
  /**
   * Wird mit der finalen Blob-URL und dem User-bestätigten Namen aufgerufen.
   * Wird NICHT mehr automatisch beim Stop-Click gefeuert — der User muss zuerst
   * `confirmPendingSample(name)` aufrufen.
   */
  onSample: (url: string, name: string, durationSec: number) => void;
}

export function useAudioInput({ onSample }: AudioInputOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recordingDurationMs, setRecordingDurationMs] = useState(0);
  const [availableDevices, setAvailableDevices] = useState<AudioInputDevice[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  const [pendingSample, setPendingSample] = useState<PendingSample | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef        = useRef<MediaStream | null>(null);
  const audioCtxRef      = useRef<AudioContext | null>(null);
  const chunksRef        = useRef<Blob[]>([]);
  const analyserRef      = useRef<AnalyserNode | null>(null);
  const rafRef           = useRef<number | null>(null);
  const durationTimerRef = useRef<number | null>(null);
  const startTimeRef     = useRef<number>(0);
  const recordCountRef   = useRef(0);

  useEffect(() => {
    setIsAvailable(!!navigator.mediaDevices?.getUserMedia);
  }, []);

  /** Aktualisiert die Liste verfügbarer Audio-Inputs. Wird beim ersten Recording-Start
   *  + on demand getriggert (manche Devices erscheinen erst nach getUserMedia-Grant). */
  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const inputs = all
        .filter((d) => d.kind === "audioinput")
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `Eingang ${d.deviceId.slice(0, 6)}`,
        }));
      setAvailableDevices(inputs);
    } catch {
      // ignore — devices array bleibt was es war
    }
  }, []);

  // Beim Mount versuchen Devices zu laden (Labels sind oft erst nach Permission-Grant gefüllt)
  useEffect(() => { void refreshDevices(); }, [refreshDevices]);

  // VU-Meter-Loop
  const startLevelMeter = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    analyserRef.current = analyser;

    const buf = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let max = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = Math.abs(buf[i] - 128) / 128;
        if (v > max) max = v;
      }
      setLevel(max);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopLevelMeter = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    setLevel(0);
  }, []);

  const stopDurationTimer = useCallback(() => {
    if (durationTimerRef.current !== null) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    if (isRecording) return;
    // TASK-232 (v2.97): USB-Audio-In (Mic/Line-In Recording) ist ein Pro-Feature.
    if (!requireProFeature(PRO_FEATURE_USB_AUDIO_IN)) return;
    setError(null);
    try {
      // Constraints: optional deviceId für Picker
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 44100,
      };
      if (deviceId) {
        (audioConstraints as MediaTrackConstraints & { deviceId?: { exact: string } }).deviceId = { exact: deviceId };
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      streamRef.current = stream;
      chunksRef.current = [];
      startTimeRef.current = Date.now();
      setRecordingDurationMs(0);

      // Devices-Liste nach Permission-Grant aktualisieren (Labels sind dann gefüllt)
      void refreshDevices();

      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });

      recorder.ondataavailable = e => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const durationSec = (Date.now() - startTimeRef.current) / 1000;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        const url  = URL.createObjectURL(blob);
        recordCountRef.current++;
        const defaultName = `Recording ${recordCountRef.current} (${durationSec.toFixed(1)}s)`;
        // Pending-Sample setzen damit UI Rename-Dialog zeigen kann.
        // Wenn der UI-Layer das nicht handhabt, müsste sie `confirmPendingSample`
        // mit defaultName aufrufen — entspricht dem alten Auto-Add-Verhalten.
        setPendingSample({ url, defaultName, durationSec });
        stream.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      };

      recorder.start(100); // 100ms Chunks
      mediaRecorderRef.current = recorder;
      startLevelMeter(stream);
      setIsRecording(true);

      // Live duration timer (100ms tick — flüssig genug für mm:ss-Anzeige)
      durationTimerRef.current = window.setInterval(() => {
        setRecordingDurationMs(Date.now() - startTimeRef.current);
      }, 100);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Mikrofon-Zugriff verweigert";
      setError(msg);
    }
  }, [isRecording, deviceId, startLevelMeter, refreshDevices]);

  const stop = useCallback(() => {
    if (!isRecording) return;
    mediaRecorderRef.current?.stop();
    stopLevelMeter();
    stopDurationTimer();
    setIsRecording(false);
  }, [isRecording, stopLevelMeter, stopDurationTimer]);

  /** Pending-Sample mit User-bestätigtem Namen als Sample registrieren. */
  const confirmPendingSample = useCallback((name: string) => {
    const p = pendingSample;
    if (!p) return;
    const trimmed = name.trim() || p.defaultName;
    onSample(p.url, trimmed, p.durationSec);
    setPendingSample(null);
  }, [pendingSample, onSample]);

  /** Pending-Sample verwerfen (z.B. nach Versprecher). Blob-URL wird revoked. */
  const discardPendingSample = useCallback(() => {
    if (pendingSample) URL.revokeObjectURL(pendingSample.url);
    setPendingSample(null);
  }, [pendingSample]);

  // Cleanup
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      stopLevelMeter();
      stopDurationTimer();
    };
  }, [stopLevelMeter, stopDurationTimer]);

  return {
    start,
    stop,
    isRecording,
    isAvailable,
    level,
    error,
    recordingDurationMs,
    availableDevices,
    deviceId,
    setDeviceId,
    pendingSample,
    confirmPendingSample,
    discardPendingSample,
    refreshDevices,
  };
}

/** Helper: ms → "mm:ss" / "h:mm:ss" Format für UI. */
export function formatRecordingDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
