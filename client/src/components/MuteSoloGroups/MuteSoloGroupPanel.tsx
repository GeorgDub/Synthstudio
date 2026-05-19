/**
 * Synthstudio – MuteSoloGroupPanel.tsx (v3.125.0)
 *
 * UI für Mute-Solo-Bus-Groups (Performance Live-UX).
 * - Group-Liste: Color-Chip + Name + Member-Count
 * - Big Mute + Big Solo Buttons pro Group (one-click)
 * - Add-Group-Modal: Name, Color (8-Palette), Channel-Multi-Select
 * - Edit (Rename + Color), Delete pro Group
 * - Quick-add: Channel-Multi-Select-Modal beim Edit
 * - MIDI-Learn via Rechtsklick auf Mute/Solo-Buttons
 *
 * Komplett semantische --ss-* Tailwind-Tokens (kein hardcoded slate/gray).
 */
import React, { useState } from "react";
import {
  useMuteSoloGroupStore,
  DEFAULT_GROUP_COLOR,
  type MuteSoloGroup,
} from "@/store/useMuteSoloGroupStore";
import { DEFAULT_CHANNEL_COLOR_PALETTE } from "@/utils/channelColors";
import { useMidiLearn } from "@/hooks/useMidiLearn";

export interface MuteSoloGroupPanelProps {
  /** Verfügbare Channels (für Multi-Select). id + name. */
  availableChannels: Array<{ id: string; name: string; color?: string }>;
  /** Aktuelle Mute-States aller Channels (für soloGroup-Snapshot). */
  channelMutes: Record<string, boolean>;
  /** Optional: User triggert ein UI-Close. */
  onClose?: () => void;
}

export function MuteSoloGroupPanel({
  availableChannels,
  channelMutes,
  onClose,
}: MuteSoloGroupPanelProps): React.ReactElement {
  const store = useMuteSoloGroupStore();
  const [addOpen, setAddOpen] = useState(false);
  const [editGroupId, setEditGroupId] = useState<string | null>(null);

  const handleMute = (id: string): void => {
    store.muteGroup(id);
  };
  const handleSolo = (id: string): void => {
    if (store.isGroupSoloed(id)) {
      store.clearSoloGroup(id);
      return;
    }
    const allIds = availableChannels.map((c) => c.id);
    store.soloGroup(id, allIds, channelMutes);
  };

  return (
    <div
      className="bg-bg-panel border border-border-color rounded-lg p-3 flex flex-col gap-2"
      data-testid="mute-solo-group-panel"
    >
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-text-primary">
          Bus-Groups
          <span className="ml-2 text-xs text-text-muted">
            ({store.groups.length})
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="px-2 py-1 rounded text-xs bg-accent-primary text-white hover:bg-accent-secondary transition-colors"
            data-testid="mute-solo-group-add-btn"
          >
            + Add Group
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-2 py-1 rounded text-xs bg-bg-elevated text-text-muted hover:text-text-primary transition-colors"
              aria-label="Schließen"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {store.groups.length === 0 && (
        <div
          className="flex flex-col items-center gap-2 py-6 px-3 bg-bg-elevated/50 border border-dashed border-border-color rounded"
          data-testid="mute-solo-group-empty"
        >
          <div className="flex gap-1.5" aria-hidden="true">
            <span
              className="w-4 h-4 rounded-full"
              style={{ backgroundColor: DEFAULT_GROUP_COLOR }}
            />
            <span
              className="w-4 h-4 rounded-full opacity-60"
              style={{ backgroundColor: DEFAULT_CHANNEL_COLOR_PALETTE[2]?.hex ?? "#94a3b8" }}
            />
            <span
              className="w-4 h-4 rounded-full opacity-30"
              style={{ backgroundColor: DEFAULT_CHANNEL_COLOR_PALETTE[4]?.hex ?? "#475569" }}
            />
          </div>
          <div className="text-xs text-text-primary font-medium text-center">
            Noch keine Bus-Groups
          </div>
          <p className="text-[11px] text-text-muted text-center leading-snug max-w-[26ch]">
            Fasse mehrere Channels zu einer Group zusammen und mute oder soloe sie
            live mit nur einem Klick — perfekt für Drums, Bass-Stems oder
            Lead-Sections.
          </p>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="mt-1 px-3 py-1.5 rounded text-xs bg-accent-primary text-white hover:bg-accent-secondary transition-colors"
            data-testid="mute-solo-group-empty-cta"
          >
            + Erste Group anlegen
          </button>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {store.groups.map((group) => (
          <GroupRow
            key={group.id}
            group={group}
            isSoloed={store.isGroupSoloed(group.id)}
            onMute={() => handleMute(group.id)}
            onSolo={() => handleSolo(group.id)}
            onEdit={() => setEditGroupId(group.id)}
            onDelete={() => {
              // v3.129.0: Confirm-Dialog vor destructive Delete (closes v3.127 polish-caveat)
              if (
                typeof window !== "undefined" &&
                window.confirm(
                  `Group "${group.name}" löschen?\nChannels bleiben unverändert — nur die Group-Zuordnung wird entfernt.`,
                )
              ) {
                store.removeGroup(group.id);
              }
            }}
          />
        ))}
      </div>

      {addOpen && (
        <GroupModal
          mode="add"
          availableChannels={availableChannels}
          onCancel={() => setAddOpen(false)}
          onSave={(name, color, channelIds) => {
            store.addGroup(name, color, channelIds);
            setAddOpen(false);
          }}
        />
      )}

      {editGroupId && (() => {
        const g = store.groups.find((x) => x.id === editGroupId);
        if (!g) return null;
        return (
          <GroupModal
            mode="edit"
            initial={g}
            availableChannels={availableChannels}
            onCancel={() => setEditGroupId(null)}
            onSave={(name, color, channelIds) => {
              store.renameGroup(g.id, name);
              store.setGroupColor(g.id, color);
              // Sync channelIds: add new, remove old.
              const cur = new Set(g.channelIds);
              const next = new Set(channelIds);
              for (const id of channelIds) {
                if (!cur.has(id)) store.addChannelToGroup(g.id, id);
              }
              for (const id of g.channelIds) {
                if (!next.has(id)) store.removeChannelFromGroup(g.id, id);
              }
              setEditGroupId(null);
            }}
          />
        );
      })()}
    </div>
  );
}

// ─── Single Row ──────────────────────────────────────────────────────────────

interface GroupRowProps {
  group: MuteSoloGroup;
  isSoloed: boolean;
  onMute: () => void;
  onSolo: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function GroupRow({
  group,
  isSoloed,
  onMute,
  onSolo,
  onEdit,
  onDelete,
}: GroupRowProps): React.ReactElement {
  // MIDI-Learn via Rechtsklick. Targets v3.125: muteGroup / soloGroup.
  const muteLearn = useMidiLearn({
    type: "muteGroup",
    groupId: group.id,
    groupName: group.name,
  });
  const soloLearn = useMidiLearn({
    type: "soloGroup",
    groupId: group.id,
    groupName: group.name,
  });

  return (
    <div
      className="flex items-center gap-2 px-2 py-1.5 rounded bg-bg-elevated"
      data-testid={`mute-solo-group-row-${group.id}`}
    >
      <div
        className="w-3 h-3 rounded-full flex-shrink-0"
        style={{ backgroundColor: group.color }}
        aria-label={`Group-Farbe: ${group.color}`}
      />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-text-primary truncate">
          {group.name}
        </div>
        <div className="text-[10px] text-text-muted">
          {group.channelIds.length} channel{group.channelIds.length === 1 ? "" : "s"}
        </div>
      </div>
      <button
        type="button"
        onClick={onMute}
        onContextMenu={muteLearn.onContextMenu}
        className="px-3 py-1.5 rounded text-xs font-bold bg-accent-danger/80 text-white hover:bg-accent-danger transition-colors relative"
        title={`Mute alle ${group.channelIds.length} Channels${muteLearn.isMapped ? ` · CC${muteLearn.mappedCC}` : " · Rechtsklick: MIDI-Learn"}`}
        data-testid={`mute-solo-group-mute-${group.id}`}
      >
        M
        {muteLearn.isMapped && (
          <span className="absolute top-0 right-0 w-1.5 h-1.5 bg-accent-secondary rounded-full" />
        )}
      </button>
      <button
        type="button"
        onClick={onSolo}
        onContextMenu={soloLearn.onContextMenu}
        className={[
          "px-3 py-1.5 rounded text-xs font-bold transition-colors relative",
          isSoloed
            ? "bg-accent-success text-white"
            : "bg-accent-success/30 text-text-primary hover:bg-accent-success/60",
        ].join(" ")}
        title={`Solo Group${isSoloed ? " (aktiv — klick zum Beenden)" : ""}${soloLearn.isMapped ? ` · CC${soloLearn.mappedCC}` : " · Rechtsklick: MIDI-Learn"}`}
        data-testid={`mute-solo-group-solo-${group.id}`}
      >
        S
        {soloLearn.isMapped && (
          <span className="absolute top-0 right-0 w-1.5 h-1.5 bg-accent-secondary rounded-full" />
        )}
      </button>
      <button
        type="button"
        onClick={onEdit}
        className="px-2 py-1 rounded text-[10px] bg-bg-base text-text-muted hover:text-text-primary transition-colors"
        title="Bearbeiten"
        data-testid={`mute-solo-group-edit-${group.id}`}
      >
        Edit
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="px-2 py-1 rounded text-[10px] bg-bg-base text-accent-danger hover:bg-accent-danger/20 transition-colors"
        title="Löschen"
        data-testid={`mute-solo-group-delete-${group.id}`}
      >
        ✕
      </button>
      {muteLearn.menu}
      {soloLearn.menu}
    </div>
  );
}

// ─── Add/Edit Modal ──────────────────────────────────────────────────────────

interface GroupModalProps {
  mode: "add" | "edit";
  initial?: MuteSoloGroup;
  availableChannels: Array<{ id: string; name: string; color?: string }>;
  onCancel: () => void;
  onSave: (name: string, color: string, channelIds: string[]) => void;
}

function GroupModal({
  mode,
  initial,
  availableChannels,
  onCancel,
  onSave,
}: GroupModalProps): React.ReactElement {
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? DEFAULT_GROUP_COLOR);
  const [channelIds, setChannelIds] = useState<string[]>(initial?.channelIds ?? []);

  const toggleChannel = (id: string): void => {
    setChannelIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  };

  const isValid = name.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      data-testid="mute-solo-group-modal"
      onClick={onCancel}
    >
      <div
        className="bg-bg-panel border border-border-color rounded-lg shadow-xl w-full max-w-md max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border-color">
          <div className="text-sm font-semibold text-text-primary">
            {mode === "add" ? "Neue Group" : "Group bearbeiten"}
          </div>
        </div>

        <div className="px-4 py-3 flex flex-col gap-3 overflow-y-auto">
          {/* Name */}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-text-muted">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-bg-elevated border border-border-color rounded px-2 py-1 text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-primary"
              placeholder="z.B. Drums, Bass, Leads"
              data-testid="mute-solo-group-modal-name"
              autoFocus
            />
          </label>

          {/* Color */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-muted">Color</span>
            <div className="flex gap-1.5 flex-wrap">
              {DEFAULT_CHANNEL_COLOR_PALETTE.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setColor(p.hex)}
                  className={[
                    "w-7 h-7 rounded-full border-2 transition-all",
                    color.toLowerCase() === p.hex.toLowerCase()
                      ? "border-text-primary scale-110"
                      : "border-border-color hover:scale-105",
                  ].join(" ")}
                  style={{ backgroundColor: p.hex }}
                  title={p.name}
                  data-testid={`mute-solo-group-modal-color-${p.id}`}
                  aria-label={`Color: ${p.name}`}
                />
              ))}
            </div>
          </div>

          {/* Channel-Multi-Select */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-muted">
              Channels ({channelIds.length} ausgewählt)
            </span>
            <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto bg-bg-elevated rounded p-1">
              {availableChannels.length === 0 ? (
                <div className="text-[11px] text-text-dim p-2">
                  Keine Channels verfügbar.
                </div>
              ) : (
                availableChannels.map((c) => {
                  const sel = channelIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleChannel(c.id)}
                      className={[
                        "flex items-center gap-2 px-2 py-1 rounded text-xs text-left transition-colors",
                        sel
                          ? "bg-accent-primary/30 text-text-primary"
                          : "hover:bg-bg-base text-text-muted",
                      ].join(" ")}
                      data-testid={`mute-solo-group-modal-channel-${c.id}`}
                    >
                      <span
                        className={[
                          "inline-block w-3 h-3 rounded-sm border",
                          sel
                            ? "bg-accent-primary border-accent-primary"
                            : "border-border-color",
                        ].join(" ")}
                      >
                        {sel && (
                          <span className="text-white text-[8px] leading-none flex items-center justify-center h-full">
                            ✓
                          </span>
                        )}
                      </span>
                      {c.color && (
                        <span
                          className="inline-block w-2 h-2 rounded-full"
                          style={{ backgroundColor: c.color }}
                        />
                      )}
                      <span className="flex-1 truncate">{c.name}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-border-color flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded text-xs bg-bg-elevated text-text-muted hover:text-text-primary transition-colors"
            data-testid="mute-solo-group-modal-cancel"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={() => {
              if (!isValid) return;
              onSave(name.trim(), color, channelIds);
            }}
            disabled={!isValid}
            className={[
              "px-3 py-1.5 rounded text-xs font-semibold transition-colors",
              isValid
                ? "bg-accent-primary text-white hover:bg-accent-secondary"
                : "bg-bg-elevated text-text-dim cursor-not-allowed",
            ].join(" ")}
            data-testid="mute-solo-group-modal-save"
          >
            {mode === "add" ? "Erstellen" : "Speichern"}
          </button>
        </div>
      </div>
    </div>
  );
}
