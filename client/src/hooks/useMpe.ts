/**
 * Synthstudio – useMpe
 *
 * MIDI Polyphonic Expression (MPE) Support.
 * In MPE werden MIDI-Kanäle 2–15 als individuelle "Voice-Kanäle" verwendet.
 * Kanal 1 = Global (alle Stimmen), Kanäle 2–15 = einzelne Noten.
 *
 * Jede Voice hat:
 *  - pitch     (Pitch Bend, ±48 Halbtöne)
 *  - pressure  (Aftertouch/Channel Pressure, 0–1)
 *  - timbre    (CC#74, 0–1, z.B. für Filter)
 *
 * Integration: MPE-Nachrichten werden über das bestehende useMidi-System
 * verarbeitet und dispatchen CustomEvents für die AudioEngine.
 */
import { useEffect, useRef, useState } from "react";

export interface MpeVoice {
  channel: number;   // MIDI-Kanal 2–15
  note: number;      // MIDI-Note
  velocity: number;  // 0–127
  pitch: number;     // Pitch Bend normiert -1..+1
  pressure: number;  // Aftertouch 0–1
  timbre: number;    // CC74 0–1
  active: boolean;
}

export interface MpeState {
  enabled: boolean;
  pitchBendRange: number;  // Halbtöne (default 48)
  voices: Map<number, MpeVoice>; // channel → voice
}

export const MPE_EVENT = "mpe:voice";

/** Dispatcht ein MPE-Voice-Update als CustomEvent. */
export function dispatchMpeVoice(voice: MpeVoice) {
  window.dispatchEvent(new CustomEvent(MPE_EVENT, { detail: voice }));
}

/**
 * Verarbeitet rohe MIDI-Nachrichten als MPE-Events.
 * Wird intern von useMidi aufgerufen wenn MPE aktiv ist.
 */
export function processMpeMessage(
  type: number,
  channel: number,
  byte1: number,
  byte2: number,
  voices: Map<number, MpeVoice>,
  pitchBendRange: number,
): Map<number, MpeVoice> {
  const newVoices = new Map(voices);

  // Note On (Kanal 2–15 = Voice-Kanäle)
  if (type === 0x90 && byte2 > 0 && channel >= 2) {
    const voice: MpeVoice = {
      channel, note: byte1, velocity: byte2,
      pitch: 0, pressure: 0, timbre: 0.5, active: true,
    };
    newVoices.set(channel, voice);
    dispatchMpeVoice(voice);
  }

  // Note Off
  else if ((type === 0x80 || (type === 0x90 && byte2 === 0)) && channel >= 2) {
    const voice = newVoices.get(channel);
    if (voice) {
      const updated = { ...voice, active: false };
      newVoices.set(channel, updated);
      dispatchMpeVoice(updated);
    }
  }

  // Pitch Bend (voice-level)
  else if (type === 0xe0 && channel >= 2) {
    const raw = (byte2 << 7) | byte1; // 14-bit
    const normalized = (raw - 8192) / 8192; // -1..+1
    const semitonePitch = normalized * pitchBendRange;
    const voice = newVoices.get(channel);
    if (voice) {
      const updated = { ...voice, pitch: semitonePitch };
      newVoices.set(channel, updated);
      dispatchMpeVoice(updated);
    }
  }

  // Channel Pressure / Aftertouch (voice-level)
  else if (type === 0xd0 && channel >= 2) {
    const pressure = byte1 / 127;
    const voice = newVoices.get(channel);
    if (voice) {
      const updated = { ...voice, pressure };
      newVoices.set(channel, updated);
      dispatchMpeVoice(updated);
    }
  }

  // CC#74 = Timbre (Slide/Brightness in MPE)
  else if (type === 0xb0 && byte1 === 74 && channel >= 2) {
    const timbre = byte2 / 127;
    const voice = newVoices.get(channel);
    if (voice) {
      const updated = { ...voice, timbre };
      newVoices.set(channel, updated);
      dispatchMpeVoice(updated);
    }
  }

  return newVoices;
}

/** Hook für MPE-State (React-Integration). */
export function useMpe(enabled: boolean, pitchBendRange = 48) {
  const [voices, setVoices] = useState<Map<number, MpeVoice>>(new Map());
  const pitchBendRangeRef = useRef(pitchBendRange);
  pitchBendRangeRef.current = pitchBendRange;

  useEffect(() => {
    if (!enabled) { setVoices(new Map()); return; }

    const handler = (e: Event) => {
      // Raw MIDI messages werden von useMidi als CustomEvent weitergeleitet
      const { type, channel, byte1, byte2 } = (e as CustomEvent).detail;
      setVoices(prev => processMpeMessage(type, channel, byte1, byte2, prev, pitchBendRangeRef.current));
    };

    window.addEventListener("midi:rawmessage", handler);
    return () => window.removeEventListener("midi:rawmessage", handler);
  }, [enabled]);

  return { voices, activeVoices: [...voices.values()].filter(v => v.active) };
}
