#!/usr/bin/env bash
#
# 01-bootstrap-root.sh — Grundabsicherung des frischen Hetzner CX33.
# Ausführen als root, direkt nach der Server-Erstellung:
#
#   ssh root@<server-ip>
#   bash 01-bootstrap-root.sh
#
# Danach NUR noch als $DEV_USER über Tailscale einloggen.
set -euo pipefail

DEV_USER="${DEV_USER:-dev}"
SWAP_GB="${SWAP_GB:-4}"
TS_AUTHKEY="${TS_AUTHKEY:-}"   # optional: tskey-auth-... für nicht-interaktives Join

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mFEHLER: %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Muss als root laufen."
[[ -s /root/.ssh/authorized_keys ]] || die \
  "/root/.ssh/authorized_keys ist leer. Server ohne SSH-Key erstellt? Abbruch, sonst sperrst du dich aus."

log "System aktualisieren"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq

log "Basis-Pakete"
apt-get install -y -qq \
  sudo curl wget git ca-certificates gnupg jq unzip \
  ufw fail2ban unattended-upgrades tmux htop

# ─── Benutzer ────────────────────────────────────────────────────────────────
log "Benutzer '$DEV_USER' anlegen"
if ! id -u "$DEV_USER" &>/dev/null; then
  adduser --disabled-password --gecos "" "$DEV_USER"
fi
usermod -aG sudo "$DEV_USER"

install -d -m 700 -o "$DEV_USER" -g "$DEV_USER" "/home/$DEV_USER/.ssh"
cp /root/.ssh/authorized_keys "/home/$DEV_USER/.ssh/authorized_keys"
chown "$DEV_USER:$DEV_USER" "/home/$DEV_USER/.ssh/authorized_keys"
chmod 600 "/home/$DEV_USER/.ssh/authorized_keys"

# Passwortloses sudo — nötig, damit die Folge-Skripte durchlaufen.
echo "$DEV_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-$DEV_USER"
chmod 440 "/etc/sudoers.d/90-$DEV_USER"
visudo -c >/dev/null || die "sudoers-Datei kaputt"

# ─── Swap ────────────────────────────────────────────────────────────────────
log "${SWAP_GB} GB Swap anlegen"
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l "${SWAP_GB}G" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=$((SWAP_GB*1024))
  chmod 600 /swapfile
  mkswap -q /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
cat > /etc/sysctl.d/99-swap.conf <<'EOF'
# Erst swappen, wenn es wirklich eng wird — tsc/pnpm-Spitzen abfedern,
# nicht den laufenden Dev-Server auslagern.
vm.swappiness=10
vm.vfs_cache_pressure=50
EOF
sysctl -q --system

# ─── Tailscale ───────────────────────────────────────────────────────────────
log "Tailscale installieren"
if ! command -v tailscale &>/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi

if [[ -n "$TS_AUTHKEY" ]]; then
  tailscale up --ssh --authkey "$TS_AUTHKEY"
else
  echo
  echo "  Gleich erscheint ein Login-Link. Im Browser öffnen und den Server"
  echo "  deinem Tailnet hinzufügen. Das Skript wartet solange."
  echo
  tailscale up --ssh
fi
tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//' > /root/.tailscale-hostname
TS_NAME="$(cat /root/.tailscale-hostname)"
log "Tailscale-Hostname: $TS_NAME"

# ─── Firewall ────────────────────────────────────────────────────────────────
# Reihenfolge ist kritisch: SSH IMMER erlauben, bevor ufw aktiviert wird.
log "Firewall (ufw)"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH                 # öffentliches SSH als Notfall-Zugang
ufw allow in on tailscale0        # alles Weitere nur im Tailnet
ufw allow 41641/udp comment 'tailscale direct'
ufw --force enable
ufw status verbose

# ─── SSH härten ──────────────────────────────────────────────────────────────
log "SSH härten (kein root-Login, keine Passwörter)"
cat > /etc/ssh/sshd_config.d/99-hardening.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
X11Forwarding no
MaxAuthTries 3
EOF
sshd -t || die "sshd-Konfig fehlerhaft — NICHT neu starten, /etc/ssh/sshd_config.d/99-hardening.conf prüfen."
systemctl restart ssh

# ─── Automatische Sicherheitsupdates ─────────────────────────────────────────
log "Unattended-Upgrades aktivieren"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
systemctl enable --now unattended-upgrades &>/dev/null || true
systemctl enable --now fail2ban        &>/dev/null || true

cat <<EOF

────────────────────────────────────────────────────────────────
 Bootstrap fertig.

 Ab jetzt einloggen mit:
     ssh $DEV_USER@$TS_NAME

 WICHTIG: Diese Session offen lassen und in einem ZWEITEN Terminal
 testen, dass der Login klappt. Erst dann hier schließen — root-Login
 und Passwort-Auth sind jetzt deaktiviert.

 Weiter mit:  bash 02-toolchains.sh
────────────────────────────────────────────────────────────────
EOF
