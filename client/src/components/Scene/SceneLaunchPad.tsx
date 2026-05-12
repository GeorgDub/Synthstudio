/**
 * Synthstudio – SceneLaunchPad
 *
 * Live-Performance: Schnelles Wechseln zwischen gespeicherten Pattern-Szenen.
 * Jede Scene = ein Pattern aus der DrumMachine.
 * Klick → sofortiger Pattern-Wechsel (auch während Wiedergabe).
 *
 * Keyboard-Shortcut: Shift+1 bis Shift+8 starten Scene 1-8.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  useSceneStore,
  addScene,
  updateScene,
  removeScene,
  setActiveScene,
  SCENE_COLORS,
  type Scene,
} from "@/store/useSceneStore";
import type { PatternData } from "@/audio/AudioEngine";

interface SceneLaunchPadProps {
  patterns: PatternData[];
  activePatternId: string;
  isPlaying: boolean;
  onLaunchScene: (patternId: string, sceneId: string) => void;
}

function ScenePad({ scene, isActive, isPlaying, onLaunch, onEdit, onDelete }: {
  scene: Scene;
  isActive: boolean;
  isPlaying: boolean;
  onLaunch: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [holding, setHolding] = useState(false);
  let holdTimer: ReturnType<typeof setTimeout>;

  const onMouseDown = () => {
    setHolding(false);
    holdTimer = setTimeout(() => { setHolding(true); onEdit(); }, 600);
  };
  const onMouseUp = () => {
    clearTimeout(holdTimer);
    if (!holding) onLaunch();
    setHolding(false);
  };

  return (
    <div
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onContextMenu={e => { e.preventDefault(); onDelete(); }}
      className={[
        "relative rounded-lg cursor-pointer select-none transition-all duration-75 flex flex-col items-center justify-center gap-1 p-2",
        isActive
          ? "ring-2 ring-white/60 scale-95"
          : "hover:scale-95 hover:brightness-110",
        isPlaying && isActive ? "animate-pulse" : "",
      ].join(" ")}
      style={{
        background: scene.color,
        aspectRatio: "1",
        minHeight: 72,
        boxShadow: isActive ? `0 0 16px ${scene.color}80` : `0 2px 8px ${scene.color}40`,
      }}
      title={`${scene.name} (Gedrückt halten = Bearbeiten, Rechtsklick = Löschen)`}
    >
      <span className="text-white font-bold text-sm leading-tight text-center line-clamp-2 drop-shadow">
        {scene.name}
      </span>
      {isActive && (
        <span className="w-2 h-2 rounded-full bg-white/80 animate-pulse" />
      )}
    </div>
  );
}

function EditModal({ scene, patterns, onSave, onClose }: {
  scene: Scene;
  patterns: PatternData[];
  onSave: (changes: Partial<Scene>) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(scene.name);
  const [patternId, setPatternId] = useState(scene.patternId);
  const [color, setColor] = useState(scene.color);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-bg-panel border border-border-color rounded-xl shadow-2xl p-5 w-80">
        <h3 className="text-sm font-bold text-text-primary mb-4">Scene bearbeiten</h3>

        <label className="block text-xs text-text-muted mb-1">Name</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full mb-3 px-3 py-1.5 rounded bg-bg-elevated border border-border-color text-text-primary text-sm"
          maxLength={20}
        />

        <label className="block text-xs text-text-muted mb-1">Pattern</label>
        <select
          value={patternId}
          onChange={e => setPatternId(e.target.value)}
          className="w-full mb-3 px-3 py-1.5 rounded bg-bg-elevated border border-border-color text-text-primary text-sm"
        >
          {patterns.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <label className="block text-xs text-text-muted mb-1">Farbe</label>
        <div className="flex gap-2 mb-4 flex-wrap">
          {SCENE_COLORS.map(c => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className="w-8 h-8 rounded-lg transition-transform hover:scale-110"
              style={{ background: c, outline: c === color ? "2px solid white" : "none" }}
            />
          ))}
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded bg-bg-elevated text-text-muted hover:text-text-primary">Abbrechen</button>
          <button
            onClick={() => { onSave({ name, patternId, color }); onClose(); }}
            className="px-3 py-1.5 text-xs rounded bg-accent-primary text-white hover:opacity-80"
          >
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}

export function SceneLaunchPad({ patterns, activePatternId, isPlaying, onLaunchScene }: SceneLaunchPadProps) {
  const { scenes, activeSceneId } = useSceneStore();
  const [editScene, setEditScene] = useState<Scene | null>(null);

  // Shift+1-8 Shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.shiftKey) return;
      const idx = parseInt(e.key, 10) - 1;
      if (idx >= 0 && idx < scenes.length) {
        e.preventDefault();
        const s = scenes[idx];
        setActiveScene(s.id);
        onLaunchScene(s.patternId, s.id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [scenes, onLaunchScene]);

  const handleLaunch = useCallback((scene: Scene) => {
    setActiveScene(scene.id);
    onLaunchScene(scene.patternId, scene.id);
  }, [onLaunchScene]);

  const handleAddScene = () => {
    const pattern = patterns.find(p => p.id === activePatternId) ?? patterns[0];
    if (!pattern) return;
    addScene(pattern.name, pattern.id);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-bold text-text-dim uppercase tracking-widest">Scene Launch</span>
        <span className="text-[10px] text-text-dim">Shift+1–8 starten Scenes</span>
        <div className="flex-1" />
        <button
          onClick={handleAddScene}
          className="px-3 py-1 text-[10px] rounded bg-accent-primary text-white hover:opacity-80"
          title="Aktives Pattern als neue Scene speichern"
        >
          + Scene
        </button>
      </div>

      {/* Pad-Grid */}
      {scenes.length === 0 ? (
        <div className="text-xs text-text-dim text-center py-6 border border-dashed border-border-color rounded-lg">
          Keine Scenes. Klicke "+ Scene" um das aktuelle Pattern zu speichern.
        </div>
      ) : (
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))" }}>
          {scenes.map((scene, idx) => (
            <div key={scene.id} className="relative">
              <div className="absolute top-1 left-1 z-10 text-[9px] font-bold text-white/60 leading-none">
                {idx < 8 ? `⇧${idx + 1}` : ""}
              </div>
              <ScenePad
                scene={scene}
                isActive={activeSceneId === scene.id || scene.patternId === activePatternId}
                isPlaying={isPlaying}
                onLaunch={() => handleLaunch(scene)}
                onEdit={() => setEditScene(scene)}
                onDelete={() => removeScene(scene.id)}
              />
            </div>
          ))}
        </div>
      )}

      {/* Edit-Modal */}
      {editScene && (
        <EditModal
          scene={editScene}
          patterns={patterns}
          onSave={changes => updateScene(editScene.id, changes)}
          onClose={() => setEditScene(null)}
        />
      )}
    </div>
  );
}
