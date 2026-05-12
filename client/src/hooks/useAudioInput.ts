/**
 * Synthstudio – useAudioInput
 *
 * Mikrofon/Line-in Aufnahme direkt in neue Samples.
 * Verwendet getUserMedia + MediaRecorder → Blob → ArrayBuffer → Sample.
 *
 * Gibt zurück:
 *  - start()      Aufnahme beginnen
 *  - stop()       Aufnahme beenden → onSample Callback
 *  - isRecording  Aktueller Status
 *  - level        VU-Meter-Pegel 0–1 (Peak)
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface AudioInputOptions {
  /** Wird mit der fertigen Blob-URL und dem Namen aufgerufen */
  onSample: (url: string, name: string, durationSec: number) => void;
}

export function useAudioInput({ onSample }: AudioInputOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef        = useRef<MediaStream | null>(null);
  const chunksRef        = useRef<Blob[]>([]);
  const analyserRef      = useRef<AnalyserNode | null>(null);
  const rafRef           = useRef<number | null>(null);
  const startTimeRef     = useRef<number>(0);
  const recordCountRef   = useRef(0);

  useEffect(() => {
    setIsAvailable(!!navigator.mediaDevices?.getUserMedia);
  }, []);

  // VU-Meter-Loop
  const startLevelMeter = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext();
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
    setLevel(0);
  }, []);

  const start = useCallback(async () => {
    if (isRecording) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 44100 },
      });
      streamRef.current = stream;
      chunksRef.current = [];
      startTimeRef.current = Date.now();

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
        const name = `Recording ${recordCountRef.current} (${durationSec.toFixed(1)}s)`;
        onSample(url, name, durationSec);
        stream.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      };

      recorder.start(100); // 100ms Chunks
      mediaRecorderRef.current = recorder;
      startLevelMeter(stream);
      setIsRecording(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Mikrofon-Zugriff verweigert";
      setError(msg);
    }
  }, [isRecording, onSample, startLevelMeter]);

  const stop = useCallback(() => {
    if (!isRecording) return;
    mediaRecorderRef.current?.stop();
    stopLevelMeter();
    setIsRecording(false);
  }, [isRecording, stopLevelMeter]);

  // Cleanup
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      stopLevelMeter();
    };
  }, [stopLevelMeter]);

  return { start, stop, isRecording, isAvailable, level, error };
}
