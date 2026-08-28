#!/usr/bin/env bash
#
# 03-code-server.sh — VS Code im Browser, erreichbar NUR über dein Tailnet.
# Als $DEV_USER ausführen.
#
# Aufbau:
#   code-server lauscht auf 127.0.0.1:8080  (nie öffentlich)
#   tailscale serve terminiert HTTPS auf 443 und proxyt dorthin
#   → https://<host>.<tailnet>.ts.net  mit echtem Zertifikat
#
# Echtes HTTPS ist kein Luxus: ohne gültiges Zertifikat verweigern mobile
# Browser Clipboard-API und Service-Worker, und code-server wird zäh.
set -euo pipefail

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
[[ $EUID -ne 0 ]] || { echo "Als normaler Benutzer ausführen, nicht als root." >&2; exit 1; }

log "code-server installieren"
if ! command -v code-server &>/dev/null; then
  curl -fsSL https://code-server.dev/install.sh | sh
fi

CONFIG_DIR="$HOME/.config/code-server"
mkdir -p "$CONFIG_DIR"

if [[ -f "$CONFIG_DIR/config.yaml" ]] && grep -q '^password:' "$CONFIG_DIR/config.yaml"; then
  PASSWORD="$(awk '/^password:/{print $2}' "$CONFIG_DIR/config.yaml")"
  log "Bestehendes Passwort beibehalten"
else
  PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)"
  log "Neues Passwort erzeugt"
fi

cat > "$CONFIG_DIR/config.yaml" <<EOF
bind-addr: 127.0.0.1:8080
auth: password
password: $PASSWORD
cert: false
EOF
chmod 600 "$CONFIG_DIR/config.yaml"

log "systemd-Service aktivieren"
sudo systemctl enable --now "code-server@$USER"
sleep 2
systemctl is-active --quiet "code-server@$USER" \
  || { echo "code-server startet nicht. Logs: journalctl -u code-server@$USER -n 50"; exit 1; }

log "Über Tailscale veröffentlichen"
# Setzt voraus: HTTPS-Zertifikate im Tailnet aktiviert
# (Admin-Konsole → Settings → Feature previews → HTTPS Certificates).
if ! sudo tailscale serve --bg --https=443 127.0.0.1:8080; then
  cat <<'EOF'

  'tailscale serve' fehlgeschlagen — fast immer, weil HTTPS-Zertifikate im
  Tailnet noch nicht aktiviert sind:

      Admin-Konsole → Settings → Feature previews → HTTPS Certificates

  Danach dieses Skript erneut ausführen.

  Notlösung ohne HTTPS: code-server an die Tailscale-IP binden
  (bind-addr in config.yaml auf <tailscale-ip>:8080) und per http:// öffnen.
EOF
  exit 1
fi

TS_NAME="$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"

cat <<EOF

────────────────────────────────────────────────────────────────
 code-server läuft.

   URL       https://$TS_NAME
   Passwort  $PASSWORD

 (Passwort steht in $CONFIG_DIR/config.yaml)

 Auf dem Handy: Tailscale-App installieren, in dasselbe Tailnet
 einloggen, URL im Browser öffnen. In iOS-Safari / Android-Chrome
 lässt sich die Seite als App zum Homescreen hinzufügen.

 Weiter mit:  bash 04-projects.sh
────────────────────────────────────────────────────────────────
EOF
