#!/usr/bin/env bash
#
# 02-toolchains.sh — Alle Toolchains für Synthstudio, omnitribe und den
# Korg-ESX/E2S-Editor. Als $DEV_USER ausführen (nicht als root).
#
# Versionen sind bewusst an eure CI-Workflows angeglichen:
#   Node 22      → Synthstudio ci.yml + omnitribe (--experimental-strip-types)
#   Python 3.13  → omnitribe ci.yml + Korg ci.yml
#   arm-none-eabi → omnitribe ci.yml ("Install system dependencies")
set -euo pipefail

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
[[ $EUID -ne 0 ]] || { echo "Als normaler Benutzer ausführen, nicht als root." >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq

# ─── Build-Basis + Komfort ───────────────────────────────────────────────────
log "Build-Basis"
sudo apt-get install -y -qq \
  build-essential pkg-config git curl wget unzip jq \
  ripgrep fd-find tmux htop ncdu

# ─── omnitribe: ARM-Cross-Toolchain + C-Tooling ──────────────────────────────
# Die Electribe-2-Master-CPU ist eine TI Sitara AM1802 (ARM926EJ-S).
# bfin-elf-gcc wird NICHT gebraucht (nur optionaler DSP-Stretch, siehe
# docs/toolchain_setup.md §6 und 99-blackfin-optional.md).
log "ARM-Cross-Toolchain + C-Tooling (omnitribe)"
sudo apt-get install -y -qq \
  gcc-arm-none-eabi binutils-arm-none-eabi \
  clang clang-tidy clang-format cppcheck \
  libasound2-dev

# ─── Qt-Runtime für PyQt6 (Korg-Editor, auch headless nötig) ─────────────────
log "Qt-Runtime-Bibliotheken (Korg-Editor)"
sudo apt-get install -y -qq \
  libgl1 libegl1 libdbus-1-3 libfontconfig1 libfreetype6 \
  libxkbcommon-x11-0 libxcb-icccm4 libxcb-image0 libxcb-keysyms1 \
  libxcb-randr0 libxcb-render-util0 libxcb-shape0 libxcb-xinerama0 \
  libxcb-xkb1 libxcb-cursor0 \
  ffmpeg          # audio_processor: MP3-Fallback via pydub

# ─── Electron-E2E headless ───────────────────────────────────────────────────
log "Xvfb (für pnpm test:e2e in Electron)"
sudo apt-get install -y -qq xvfb

# ─── Node 22 + pnpm ──────────────────────────────────────────────────────────
log "Node.js 22"
if ! node --version 2>/dev/null | grep -q '^v22\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs
fi
# corepack liest packageManager aus package.json → pnpm@10.4.1 exakt wie in CI
sudo corepack enable
log "Node $(node --version), npm $(npm --version)"

# ─── Python 3.13 via uv ──────────────────────────────────────────────────────
# uv statt deadsnakes-PPA: ein Binary, liefert 3.13 auf Ubuntu 24.04 (Systempython
# ist 3.12) und erzwingt venvs — passt zur Vorgabe "nie globales pip".
log "uv + Python 3.13"
if ! command -v uv &>/dev/null; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
export PATH="$HOME/.local/bin:$PATH"
grep -q '.local/bin' "$HOME/.bashrc" || \
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
uv python install 3.13

# ─── tmux: mobiltauglich ─────────────────────────────────────────────────────
log "tmux-Konfiguration"
if [[ ! -f "$HOME/.tmux.conf" ]]; then
  cat > "$HOME/.tmux.conf" <<'EOF'
# Maus an — auf dem Handy der einzige brauchbare Weg, Panes zu wechseln
set -g mouse on
set -g history-limit 50000
set -g base-index 1
setw -g pane-base-index 1
set -sg escape-time 10
set -g status-style 'bg=colour236 fg=colour250'
set -g status-right '#[fg=colour245]#H  %H:%M'
# Panes teilen mit | und -
bind | split-window -h
bind - split-window -v
EOF
fi

# ─── Smoke-Tests ─────────────────────────────────────────────────────────────
log "Smoke-Tests"
printf 'int main(void){return 0;}\n' > /tmp/hello.c
arm-none-eabi-gcc -mcpu=arm926ej-s -marm -nostdlib -ffreestanding \
  -Wl,--no-warn-rwx-segments /tmp/hello.c -o /tmp/hello.elf
arm-none-eabi-size /tmp/hello.elf
rm -f /tmp/hello.c /tmp/hello.elf

echo
printf '  node    %s\n' "$(node --version)"
printf '  pnpm    %s\n' "$(corepack pnpm --version 2>/dev/null || echo '(pro Repo via corepack)')"
printf '  python  %s\n' "$(uv python find 3.13)"
printf '  arm-gcc %s\n' "$(arm-none-eabi-gcc -dumpversion)"
printf '  clang   %s\n' "$(clang --version | head -1 | awk '{print $NF}')"

cat <<'EOF'

────────────────────────────────────────────────────────────────
 Toolchains fertig.  Weiter mit:  bash 03-code-server.sh
────────────────────────────────────────────────────────────────
EOF
