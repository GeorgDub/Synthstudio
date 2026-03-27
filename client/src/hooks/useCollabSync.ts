/**
 * useCollabSync – bidirektionale Echtzeit-Synchronisierung für Kollaborations-Sessions.
 *
 * Was dieser Hook macht:
 * 1. EMPFANGEN: Registriert einen globalen Event-Handler über addCollabEventHandler.
 *    Alle Events die per WebSocket vom Server eintreffen (step:toggle, bpm:change, …)
 *    werden direkt auf die lokalen Stores angewendet.
 *    snapshot:full → Remote-Peer-Store aktualisieren.
 *
 * 2. SENDEN: Gibt collab-fähige Wrapper-Callbacks zurück.
 *    Diese rufen zuerst die Store-Aktion aus und senden danach das Event an alle Partner.
 *
 * 3. SNAPSHOTS: Beim Sitzungsstart wird ein vollständiger Snapshot gesendet.
 *    Beim Empfang eines snapshot:full wird der Remote-Peer-Store aktualisiert.
 *
 * 4. OUTPUT-MODUS: "me" | "partner" | "both" – steuert ob Partner-Transport-Events
 *    lokal angewendet werden.
 *
 * 5. MUSTER-WECHSEL: Da setActivePattern() direkt in DrumMachine.tsx aufgerufen wird
 *    (kein Prop-Callback), beobachtet ein useEffect dm.activePatternId und sendet
 *    "pattern:switch" wenn sich der Wert ändert (außer wenn die Änderung von remote kam).
 *
 * Verwendung in App.tsx:
 *   const { collabToggleStep, collabBpmChange, collabPlayStop, outputMode, setOutputMode }
 *     = useCollabSync({ broadcast, dm, setBpm, isPlaying, togglePlayStop, samples });
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CollabEvent } from "../../../electron/collab-server";
import { addCollabEventHandler } from "./useCollabSession";
import { addParticipantJoinedHandler } from "./useCollabSession";
import { getSessionState, useSessionStore } from "../store/useSessionStore";
import type { DrumMachineState, DrumMachineActions } from "@/store/useDrumMachineStore";
import type { Sample } from "@/store/useProjectStore";
import {
  setRemotePeer,
  toggleRemoteStep,
  setRemoteActivePattern,
  setRemoteBpmPeer,
  setRemoteIsPlaying,
  setRemotePartMuted,
  setRemotePartVolume,
  resetRemotePeer,
} from "@/store/useRemotePeerStore";

// ─── Typen ────────────────────────────────────────────────────────────────────

/** Steuert welche Audioquelle lokal abgespielt wird. */
export type OutputMode = "me" | "partner" | "both";

interface CollabSyncOptions {
  broadcast: (event: CollabEvent) => void;
  dm: DrumMachineState & DrumMachineActions;
  setBpm: (bpm: number) => void;
  isPlaying: boolean;
  bpm: number;
  togglePlayStop: () => void;
  /** Aktuelle Sample-Bibliothek für snapshot:full */
  samples?: Sample[];
}

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function isInSession(): boolean {
  const s = getSessionState().status;
  return s === "hosting" || s === "joined";
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCollabSync({
  broadcast,
  dm,
  setBpm,
  isPlaying,
  bpm,
  togglePlayStop,
  samples = [],
}: CollabSyncOptions) {
  // Refs damit Callbacks in Closures immer aktuelle Werte haben
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  const bpmRef = useRef(bpm);
  useEffect(() => { bpmRef.current = bpm; }, [bpm]);

  const broadcastRef = useRef(broadcast);
  useEffect(() => { broadcastRef.current = broadcast; }, [broadcast]);

  const setBpmRef = useRef(setBpm);
  useEffect(() => { setBpmRef.current = setBpm; }, [setBpm]);

  const togglePlayStopRef = useRef(togglePlayStop);
  useEffect(() => { togglePlayStopRef.current = togglePlayStop; }, [togglePlayStop]);

  const dmRef = useRef(dm);
  useEffect(() => { dmRef.current = dm; }, [dm]);

  const samplesRef = useRef(samples);
  useEffect(() => { samplesRef.current = samples; }, [samples]);

  // Flag: verhindert Echo-Loop (remote-Event → lokale Store-Änderung → erneutes Senden)
  const applyingRemote = useRef(false);
  // Flag: pattern:switch kam von remote → useEffect soll nicht broadcasten
  const remotePatternChange = useRef(false);
  // Letzter bekannter activePatternId (für Diff in useEffect)
  const prevPatternId = useRef<string | undefined>(undefined);

  // ── Output-Modus (welche Audioquelle wird lokal abgespielt) ──────────────
  const [outputMode, setOutputMode] = useState<OutputMode>("both");
  const outputModeRef = useRef<OutputMode>("both");
  useEffect(() => { outputModeRef.current = outputMode; }, [outputMode]);

  // ── Snapshot-BPM beim Beitreten einer Session anwenden ───────────────────
  const session = useSessionStore();
  useEffect(() => {
    if (session.remoteBpm !== null && session.status === "joined") {
      setBpmRef.current(session.remoteBpm);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.remoteBpm, session.status]);

  // ── Vollständigen Snapshot senden wenn Session aktiv wird ────────────────
  useEffect(() => {
    if (session.status !== "hosting" && session.status !== "joined") {
      // Session beendet → Remote-Peer-Store zurücksetzen
      if (session.status === "idle" || session.status === "error") {
        resetRemotePeer();
      }
      return;
    }

    // Snapshot nach kurzem Delay senden (WebSocket muss stabil sein)
    const timer = setTimeout(() => {
      const dm = dmRef.current;
      broadcastRef.current({
        type: "snapshot:full",
        patterns: dm.patterns,
        activePatternId: dm.activePatternId,
        bpm: bpmRef.current,
        isPlaying: isPlayingRef.current,
        samples: samplesRef.current.map(s => ({
          id: s.id,
          name: s.name,
          path: s.path,
          category: s.category,
        })),
      });
    }, 500);

    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.status]);

  // ── Eingehende Events (remote → lokal) ───────────────────────────────────

  useEffect(() => {
    const unsub = addCollabEventHandler((event: CollabEvent, fromUserId: string) => {
      const mode = outputModeRef.current;

      // snapshot:full: Remote-Peer-Store aktualisieren (kein Echo-Schutz nötig)
      if (event.type === "snapshot:full") {
        const p = event as CollabEvent & {
          patterns?: unknown;
          activePatternId?: string;
          bpm?: number;
          isPlaying?: boolean;
          samples?: Array<{ id: string; name: string; path: string; category: string }>;
        };

        // Teilnehmer-Farbe aus Session holen
        const sessionState = getSessionState();
        const participant = sessionState.participants.find(p => p.userId === fromUserId);

        setRemotePeer({
          userId: fromUserId,
          userName: participant?.userName ?? null,
          color: participant?.color ?? null,
          patterns: Array.isArray(p.patterns) ? p.patterns as import("@/audio/AudioEngine").PatternData[] : [],
          activePatternId: typeof p.activePatternId === "string" ? p.activePatternId : null,
          bpm: typeof p.bpm === "number" ? p.bpm : 120,
          isPlaying: typeof p.isPlaying === "boolean" ? p.isPlaying : false,
          samples: Array.isArray(p.samples) ? p.samples : [],
        });
        return;
      }

      // Remote step:toggle → auch Remote-Peer-Store aktualisieren (für UI)
      if (event.type === "step:toggle") {
        const partId = event.partId as string;
        const stepIndex = event.stepIndex as number;
        if (typeof partId === "string" && typeof stepIndex === "number") {
          toggleRemoteStep(partId, stepIndex);
        }
      }

      // Remote pattern:switch → Remote-Peer-Store aktualisieren
      if (event.type === "pattern:switch") {
        const patternId = event.patternId as string;
        if (typeof patternId === "string") {
          setRemoteActivePattern(patternId);
        }
      }

      // Remote bpm:change → Remote-Peer-Store aktualisieren
      if (event.type === "bpm:change") {
        const bpm = event.bpm as number;
        if (typeof bpm === "number") {
          setRemoteBpmPeer(bpm);
        }
      }

      // Remote transport → Remote-Peer-Store aktualisieren
      if (event.type === "transport:play") setRemoteIsPlaying(true);
      if (event.type === "transport:stop") setRemoteIsPlaying(false);

      // Remote part:mute / part:volume → Remote-Peer-Store aktualisieren
      if (event.type === "part:mute") {
        const partId = event.partId as string;
        const muted = event.muted as boolean;
        if (typeof partId === "string" && typeof muted === "boolean") {
          setRemotePartMuted(partId, muted);
        }
      }
      if (event.type === "part:volume") {
        const partId = event.partId as string;
        const volume = event.volume as number;
        if (typeof partId === "string" && typeof volume === "number") {
          setRemotePartVolume(partId, volume);
        }
      }

      // ─── Lokale Stores aktualisieren (Kollaboration = gemeinsame Patterns) ──
      applyingRemote.current = true;
      try {
        const dm = dmRef.current;
        switch (event.type) {
          case "step:toggle": {
            const partId = event.partId as string;
            const stepIndex = event.stepIndex as number;
            if (typeof partId === "string" && typeof stepIndex === "number") {
              dm.toggleStep(partId, stepIndex);
            }
            break;
          }

          case "bpm:change": {
            const bpm = event.bpm as number;
            if (typeof bpm === "number" && bpm >= 20 && bpm <= 300) {
              setBpmRef.current(bpm);
            }
            break;
          }

          case "pattern:switch": {
            const patternId = event.patternId as string;
            if (typeof patternId === "string") {
              remotePatternChange.current = true;
              dm.setActivePattern(patternId);
            }
            break;
          }

          case "transport:play": {
            // Im "me"-Modus keine fremden Transport-Events anwenden
            if (mode !== "me" && !isPlayingRef.current) {
              togglePlayStopRef.current();
            }
            break;
          }

          case "transport:stop": {
            if (mode !== "me" && isPlayingRef.current) {
              togglePlayStopRef.current();
            }
            break;
          }

          case "part:mute": {
            const partId = event.partId as string;
            const muted = event.muted as boolean;
            if (typeof partId === "string" && typeof muted === "boolean") {
              dm.setPartMuted(partId, muted);
            }
            break;
          }

          case "part:volume": {
            const partId = event.partId as string;
            const volume = event.volume as number;
            if (typeof partId === "string" && typeof volume === "number") {
              dm.setPartVolume(partId, volume);
            }
            break;
          }
        }
      } finally {
        applyingRemote.current = false;
      }
    });

    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentionally no deps – handler ist stable via Refs

  // ── Snapshot an neue Teilnehmer senden (Host sendet sofort snapshot:full) ─
  useEffect(() => {
    const unsub = addParticipantJoinedHandler(() => {
      // Kurze Verzögerung damit der neue Teilnehmer die WS-Verbindung aufgebaut hat
      setTimeout(() => {
        const dm = dmRef.current;
        if (!isInSession()) return;
        broadcastRef.current({
          type: "snapshot:full",
          patterns: dm.patterns,
          activePatternId: dm.activePatternId,
          bpm: bpmRef.current,
          isPlaying: isPlayingRef.current,
          samples: samplesRef.current.map(s => ({
            id: s.id,
            name: s.name,
            path: s.path,
            category: s.category,
          })),
        });
      }, 300);
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Pattern-Wechsel beobachten und senden (kein Prop-Callback vorhanden) ──

  useEffect(() => {
    const currentId = dm.activePatternId;

    if (prevPatternId.current === undefined) {
      // Erstes Render – nur initialisieren
      prevPatternId.current = currentId;
      return;
    }

    if (currentId === prevPatternId.current) return;
    prevPatternId.current = currentId;

    if (remotePatternChange.current) {
      // War eine remote-Änderung – nicht zurücksenden
      remotePatternChange.current = false;
      return;
    }

    if (isInSession() && currentId) {
      broadcastRef.current({ type: "pattern:switch", patternId: currentId });
    }
  }, [dm.activePatternId]);

  // ── Ausgehende Wrapper-Callbacks (lokal → remote) ─────────────────────────

  const collabToggleStep = useCallback(
    (partId: string, stepIndex: number) => {
      dmRef.current.toggleStep(partId, stepIndex);
      if (!applyingRemote.current && isInSession()) {
        broadcastRef.current({ type: "step:toggle", partId, stepIndex });
      }
    },
    [] // stable – nutzt Refs
  );

  const collabBpmChange = useCallback(
    (bpm: number) => {
      setBpmRef.current(bpm);
      if (!applyingRemote.current && isInSession()) {
        broadcastRef.current({ type: "bpm:change", bpm });
        setRemoteBpmPeer(bpm); // auch Remote-Store aktualisieren
      }
    },
    []
  );

  const collabPlayStop = useCallback(
    () => {
      // Im "partner"-Modus lokale Wiedergabe nicht togglen
      if (outputModeRef.current !== "partner") {
        const wasPlaying = isPlayingRef.current;
        togglePlayStopRef.current();
        if (!applyingRemote.current && isInSession()) {
          broadcastRef.current({ type: wasPlaying ? "transport:stop" : "transport:play" });
        }
      } else {
        // "partner"-Modus: nur broadcasten, lokal nicht spielen
        if (isInSession()) {
          broadcastRef.current({ type: isPlayingRef.current ? "transport:stop" : "transport:play" });
        }
      }
    },
    []
  );

  /**
   * Wird aus CollabSplitView aufgerufen wenn der Nutzer auf dem Partner-DrumMachine
   * einen Step umschaltet. Aktualisiert Remote-Store + broadcastet zum Partner.
   */
  const remoteToggleStep = useCallback(
    (partId: string, stepIndex: number) => {
      toggleRemoteStep(partId, stepIndex);
      if (isInSession()) {
        broadcastRef.current({ type: "step:toggle", partId, stepIndex });
      }
    },
    []
  );

  /**
   * Wird aus CollabSplitView aufgerufen wenn der Nutzer ein Pattern im Partner-
   * DrumMachine wechselt. Aktualisiert Remote-Store + broadcastet.
   */
  const remoteSetActivePattern = useCallback(
    (patternId: string) => {
      setRemoteActivePattern(patternId);
      if (isInSession()) {
        broadcastRef.current({ type: "pattern:switch", patternId });
      }
    },
    []
  );

  /**
   * Manuellen Snapshot senden (z.B. wenn neue Patterns hinzugefügt werden).
   */
  const sendSnapshot = useCallback(() => {
    if (!isInSession()) return;
    const dm = dmRef.current;
    broadcastRef.current({
      type: "snapshot:full",
      patterns: dm.patterns,
      activePatternId: dm.activePatternId,
      bpm: bpmRef.current,
      isPlaying: isPlayingRef.current,
      samples: samplesRef.current.map(s => ({
        id: s.id,
        name: s.name,
        path: s.path,
        category: s.category,
      })),
    });
  }, []);

  return {
    collabToggleStep,
    collabBpmChange,
    collabPlayStop,
    remoteToggleStep,
    remoteSetActivePattern,
    sendSnapshot,
    outputMode,
    setOutputMode,
  };
}
