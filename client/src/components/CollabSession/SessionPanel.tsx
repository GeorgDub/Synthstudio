import { useState } from "react";
import {
  useSessionStore,
  setMyUserName,
  type SessionParticipant,
} from "../../store/useSessionStore";
import { useCollabSession } from "../../hooks/useCollabSession";

// ─── Shared styles ────────────────────────────────────────────────────────────

const inputSt: React.CSSProperties = {
  background: "var(--ss-bg-elevated)",
  border: "1px solid var(--ss-border)",
  borderRadius: 6,
  padding: "6px 10px",
  color: "var(--ss-text-primary)",
  fontSize: 13,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const primaryBtn = (disabled = false): React.CSSProperties => ({
  background: "var(--ss-accent-primary)",
  border: "none",
  borderRadius: 6,
  padding: "9px 0",
  width: "100%",
  color: "#fff",
  fontWeight: 700,
  cursor: disabled ? "not-allowed" : "pointer",
  fontSize: 13,
  opacity: disabled ? 0.55 : 1,
});

// ─── Participant Item ─────────────────────────────────────────────────────────

function ParticipantItem({ p, isMe }: { p: SessionParticipant; isMe: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: p.color, flexShrink: 0 }} />
      <span style={{ color: "var(--ss-text-primary)", fontSize: 13 }}>
        {p.userName}{isMe ? " (Du)" : ""}
      </span>
    </div>
  );
}

// ─── Session Panel ────────────────────────────────────────────────────────────

export function SessionPanel() {
  const session = useSessionStore();
  const collab = useCollabSession();
  const [tab, setTab] = useState<"create" | "join">("create");
  const [joinCode, setJoinCode] = useState("");
  const [joinIp, setJoinIp] = useState("");
  const [joinPort, setJoinPort] = useState("4242");

  const isConnecting = session.status === "connecting";
  const panelSt: React.CSSProperties = {
    background: "var(--ss-bg-panel)",
    border: "1px solid var(--ss-border)",
    borderRadius: 8,
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  };

  const handleCopy = () => {
    if (!session.sessionCode || !session.wsUrl) return;
    const host = session.wsUrl.replace(/^wss?:\/\//, "").split("/")[0];
    void navigator.clipboard.writeText(host + ":" + session.sessionCode);
  };

  // ── Hosting / Joined ──────────────────────────────────────────────────────
  if (session.status === "hosting" || session.status === "joined") {
    const isHost = session.status === "hosting";
    return (
      <div style={panelSt}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ padding: "2px 9px", borderRadius: 12, background: "var(--ss-accent-success)", color: "#fff", fontSize: 11, fontWeight: 700 }}>
            {isHost ? "Session aktiv" : "Verbunden"}
          </span>
        </div>
        {session.sessionCode && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 11, color: "var(--ss-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Code</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, letterSpacing: "0.15em", color: "var(--ss-accent-primary)" }}>
                {session.sessionCode}
              </span>
              {isHost && (
                <button onClick={handleCopy} style={{ background: "var(--ss-bg-elevated)", border: "1px solid var(--ss-border)", borderRadius: 4, padding: "2px 9px", color: "var(--ss-text-primary)", cursor: "pointer", fontSize: 11 }}>
                  Kopieren
                </button>
              )}
            </div>
            {isHost && (
              <span style={{ fontSize: 11, color: "var(--ss-text-dim)" }}>
                Teile diesen Code mit deinen Kollaboratoren im selben Netzwerk
              </span>
            )}
          </div>
        )}
        <div style={{ borderTop: "1px solid var(--ss-border-subtle)", paddingTop: 8 }}>
          <span style={{ fontSize: 11, color: "var(--ss-text-muted)", display: "block", marginBottom: 6 }}>
            Teilnehmer ({session.participants.length})
          </span>
          {session.participants.map((p) => (
            <ParticipantItem key={p.userId} p={p} isMe={p.userId === session.myUserId} />
          ))}
        </div>
        <button
          onClick={() => collab.leaveSession()}
          style={{ background: "var(--ss-accent-danger)", border: "none", borderRadius: 6, padding: "8px 0", width: "100%", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 }}
        >
          {isHost ? "Session beenden" : "Verlassen"}
        </button>
      </div>
    );
  }

  // ── Idle / Error ──────────────────────────────────────────────────────────
  return (
    <div style={panelSt}>
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--ss-border-subtle)", paddingBottom: 8 }}>
        {(["create", "join"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ background: tab === t ? "var(--ss-accent-primary)" : "var(--ss-bg-elevated)", border: "1px solid " + (tab === t ? "var(--ss-accent-primary)" : "var(--ss-border)"), borderRadius: 6, padding: "5px 14px", color: tab === t ? "#fff" : "var(--ss-text-muted)", fontWeight: 600, cursor: "pointer", fontSize: 12 }}>
            {t === "create" ? "Session erstellen" : "Session beitreten"}
          </button>
        ))}
      </div>

      {tab === "create" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, color: "var(--ss-text-muted)" }}>Dein Name</span>
            <input value={session.myUserName} onChange={(e) => setMyUserName((e.target as HTMLInputElement).value)} maxLength={32} style={inputSt} />
          </label>
          <button onClick={() => void collab.createSession(session.myUserName)} disabled={isConnecting} style={primaryBtn(isConnecting)}>
            {isConnecting ? "Verbinde…" : "Session starten"}
          </button>
        </div>
      )}

      {tab === "join" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, color: "var(--ss-text-muted)" }}>Dein Name</span>
            <input value={session.myUserName} onChange={(e) => setMyUserName((e.target as HTMLInputElement).value)} maxLength={32} style={inputSt} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, color: "var(--ss-text-muted)" }}>Session-Code</span>
            <input value={joinCode} onChange={(e) => setJoinCode((e.target as HTMLInputElement).value.toUpperCase().slice(0, 6))} placeholder="A3F7KL" style={{ ...inputSt, fontFamily: "monospace", letterSpacing: "0.1em" }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, color: "var(--ss-text-muted)" }}>Host-IP</span>
            <input value={joinIp} onChange={(e) => setJoinIp((e.target as HTMLInputElement).value)} placeholder="192.168.1.x" style={inputSt} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, color: "var(--ss-text-muted)" }}>Port</span>
            <input value={joinPort} onChange={(e) => setJoinPort((e.target as HTMLInputElement).value)} placeholder="4242" style={inputSt} />
          </label>
          <button onClick={() => collab.joinSession(joinCode, joinIp, parseInt(joinPort, 10) || 4242, session.myUserName)} disabled={isConnecting || !joinCode || !joinIp} style={primaryBtn(isConnecting || !joinCode || !joinIp)}>
            {isConnecting ? "Verbinde…" : "Beitreten"}
          </button>
        </div>
      )}

      {session.errorMessage && (
        <div style={{ color: "var(--ss-accent-danger)", fontSize: 12 }}>{session.errorMessage}</div>
      )}
    </div>
  );
}
