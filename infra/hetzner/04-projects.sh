#!/usr/bin/env bash
#
# 04-projects.sh — Repos klonen und Abhängigkeiten installieren.
# Als $DEV_USER ausführen. Voraussetzung: 02-toolchains.sh gelaufen.
#
# SSH-Zugang zu GitHub vorher einrichten:
#   ssh-keygen -t ed25519 -C "dubrowskijgeorg@gmail.com"
#   cat ~/.ssh/id_ed25519.pub     → github.com/settings/keys
#   ssh -T git@github.com
set -euo pipefail

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m    %s\033[0m\n' "$*"; }

export PATH="$HOME/.local/bin:$PATH"
PROJECTS="$HOME/projects"
GH="${GH_BASE:-git@github.com:GeorgDub}"
mkdir -p "$PROJECTS"

clone() {  # clone <repo-name> [extra git args...]
  local name="$1"; shift
  if [[ -d "$PROJECTS/$name/.git" ]]; then
    log "$name — bereits geklont, überspringe"
  else
    log "$name klonen"
    git clone "$@" "$GH/$name.git" "$PROJECTS/$name"
  fi
}

# ─── Synthstudio ─────────────────────────────────────────────────────────────
# --filter=blob:none: die History enthält ~1,6 GB Sample-Dateien unter
# "Korg ESX files/", wodurch .git auf ~1,2 GB angewachsen ist. Der Partial
# Clone holt alte Blobs erst bei Bedarf — spart Zeit und Plattenplatz, das
# Arbeitsverzeichnis ist vollständig.
clone Synthstudio --filter=blob:none

log "Synthstudio — pnpm install"
cd "$PROJECTS/Synthstudio"
corepack pnpm install --frozen-lockfile || corepack pnpm install --no-frozen-lockfile

log "Synthstudio — Playwright-Chromium"
corepack pnpm exec playwright install --with-deps chromium

log "Synthstudio — Verifikation (wie CI)"
corepack pnpm gen:sandbox
corepack pnpm check
corepack pnpm test

# ─── omnitribe ───────────────────────────────────────────────────────────────
clone omnitribe

log "omnitribe — venv (Python 3.13) + Abhängigkeiten"
cd "$PROJECTS/omnitribe"
uv venv --python 3.13 .venv
# Paketliste 1:1 aus .github/workflows/ci.yml
uv pip install --python .venv/bin/python -r requirements.txt
uv pip install --python .venv/bin/python pytest pytest-cov ruff mypy hypothesis

log "omnitribe — ARM-Module bauen"
./.venv/bin/python tools/build/build_modules.py

warn "Hinweis: Tests, die die Korg-Stock-Firmware brauchen, werden ohne"
warn "vendor/firmware/stock_e2s_v202.vsb übersprungen (@requires_stock_fw)."
warn "Die Datei ist bewusst nicht im Repo — siehe docs/toolchain_setup.md §3."

# ─── Korg ESX/E2S Editor ─────────────────────────────────────────────────────
clone Korg_ESX_E2S_Editor

log "Korg-Editor — venv (Python 3.13) + Abhängigkeiten"
cd "$PROJECTS/Korg_ESX_E2S_Editor"
uv venv --python 3.13 .venv
uv pip install --python .venv/bin/python -e '.[dev,docs]'

log "Korg-Editor — Lint + Typecheck (wie CI)"
./.venv/bin/python -m ruff check esx_e2s_editor tests
./.venv/bin/python -m mypy .

warn "Hinweis: die volle pytest-Suite läuft in eurer CI auf Windows"
warn "('the only supported runtime target'). Auf dem Server per"
warn "QT_QPA_PLATFORM=offscreen möglich, ist aber nicht der CI-Pfad."

cat <<'EOF'

────────────────────────────────────────────────────────────────
 Alle drei Projekte eingerichtet unter ~/projects.

 Nächster Schritt: README.md, Abschnitt "Synthstudio vom Handy".
────────────────────────────────────────────────────────────────
EOF
