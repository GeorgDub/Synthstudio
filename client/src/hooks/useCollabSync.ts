/**
 * useCollabSync – bidirektionale Echtzeit-Synchronisierung für Kollaborations-Sessions.
 *
 * Was dieser Hook macht:
 * 1. EMPFANGEN: Registriert einen globalen Event-Handler über addCollabEventHandler.
 *    Alle Events die per WebSocket vom Server eintreffen (step:toggle, bpm:change, …)
 *    werden direkt auf die lokalen Stores angewendet.
 *
 * 2. SENDEN: Gibt collab-fähige Wrapper-Callbacks zurück.
 *    Diese rufen zuerst die Store-Aktion aus und senden danach das Event an alle Partner.
 *
 * 3. MUSTER-WECHSEL: Da setActivePattern() direkt in DrumMachine.tsx aufgerufen wird
 *    (kein Prop-Callback), beobachtet ein useEffect dm.activePatternId und sendet
 *    "pattern:switch" wenn sich der Wert ändert (außer wenn die Änderung von remote kam).
 *
 * Verwendung in App.tsx:
 *   const { collabToggleStep, collabBpmChange, collabPlayStop } = useCollabSync({
 *     broadcast: collab.broadcast,
 *     dm, setBpm: project.setBpm, isPlaying: project.isPlaying,
 *     togglePlayStop: project.togglePlayStop,
 *   });
 */

import { useCallback, useEffect, useRef } from "react";
import type { CollabEvent } from "../../../electron/collab-server";
import { addCollabEventHandler } from "./useCollabSession";
import { getSessionState, useSessionStore } from "../store/useSessionStore";
import type { DrumMachineState, DrumMachineActions } from "@/store/useDrumMachineStore";

// ─── Typen ────────────────────────────────────────────────────────────────────

interface CollabSyncOptions {
  broadcast: (event: CollabEvent) => void;
  dm: DrumMachineState & DrumMachineActions;
  setBpm: (bpm: number) => void;
  isPlaying: boolean;
  togglePlayStop: () => void;
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
  togglePlayStop,
}: CollabSyncOptions) {
  // Refs damit Callbacks in Closures immer aktuelle Werte haben
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  const broadcastRef = useRef(broadcast);
  useEffect(() => { broadcastRef.current = broadcast; }, [broadcast]);

  const setBpmRef = useRef(setBpm);
  useEffect(() => { setBpmRef.current = setBpm; }, [setBpm]);

  const togglePlayStopRef = useRef(togglePlayStop);
  useEffect(() => { togglePlayStopRef.current = togglePlayStop; }, [togglePlayStop]);

  const dmRef = useRef(dm);
  useEffect(() => { dmRef.current = dm; }, [dm]);

  // Flag: verhindert Echo-Loop (remote-Event → lokale Store-Änderung → erneutes Senden)
  const applyingRemote = useRef(false);
  // Flag: pattern:switch kam von remote → useEffect soll nicht broadcasten
  const remotePatternChange = useRef(false);
  // Letzter bekannter activePatternId (für Diff in useEffect)
  const prevPatternId = useRef<string | undefined>(undefined);

  // ── Snapshot-BPM beim Beitreten einer Session anwenden ───────────────────
  const session = useSessionStore();
  useEffect(() => {
    if (session.remoteBpm !== null && session.status === "joined") {
      setBpmRef.current(session.remoteBpm);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.remoteBpm, session.status]);

  // ── Eingehende Events (remote → lokal) ───────────────────────────────────

  useEffect(() => {
    const unsub = addCollabEventHandler((event: CollabEvent) => {
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
            if (!isPlayingRef.current) {
              togglePlayStopRef.current();
            }
            break;
          }

          case "transport:stop": {
            if (isPlayingRef.current) {
              togglePlayStopRef.current();
            }
            break;
          }

          // part:mute / part:solo / part:volume – für spätere Erweiterung
        }
      } finally {
        applyingRemote.current = false;
      }
    });

    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentionally no deps – handler ist stable via Refs

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
      }
    },
    []
  );

  const collabPlayStop = useCallback(
    () => {
      const wasPlaying = isPlayingRef.current;
      togglePlayStopRef.current();
      if (!applyingRemote.current && isInSession()) {
        broadcastRef.current({ type: wasPlaying ? "transport:stop" : "transport:play" });
      }
    },
    []
  );

  return { collabToggleStep, collabBpmChange, collabPlayStop };
}
