# Hetzner CX33 — Dev-Server Runbook

Mobiler Zugriff auf **Synthstudio**, **omnitribe** und den **Korg-ESX/E2S-Editor**
über einen Hetzner-Cloud-Server, abgesichert per Tailscale.

---

## 1. Was du bei Hetzner buchst

Konsole: <https://console.hetzner.cloud> → Projekt anlegen → **Add Server**

| Feld | Auswahl | Warum |
|---|---|---|
| **Location** | Falkenstein *oder* Nürnberg *oder* Helsinki | CX ist nicht überall verfügbar — alle drei durchprobieren. Helsinki liegt bei ~30–40 ms, für SSH und Dev-Server irrelevant. |
| **Image** | **Ubuntu 24.04 LTS** | Die Skripte sind darauf abgestimmt (apt-Paketnamen, NodeSource, Qt-Libs). |
| **Type** | Shared vCPU → **x86** → **CX33** | 4 vCPU, 8 GB RAM, 80 GB NVMe, 20 TB Traffic — **€8,49/Monat** netto. |
| **Networking** | IPv4 **+** IPv6 | IPv4 nicht abwählen: GitHub, npm-Registry und PyPI sind über IPv6 allein nicht zuverlässig erreichbar. |
| **SSH Keys** | **Eigenen Public Key hinterlegen** | Kritisch. Ohne Key verschickt Hetzner ein root-Passwort per Mail, und `01-bootstrap-root.sh` bricht bewusst ab. |
| **Volumes / Firewall / Placement** | leer lassen | Firewall macht `ufw` auf dem Host. |
| **Backups** | **aktivieren** (+20 % ≈ €1,70) | Billigste Versicherung für eine Maschine mit drei Projekten und allen Toolchains. |
| **Name** | z. B. `dev-01` | — |

**Monatlich ≈ €10,19 netto / ≈ €12,13 brutto.**

Nicht buchen: CPX (seit 15.06.2026 bei €62,49 für dieselben 4 vCPU / 8 GB),
CCX (dedizierte vCPU, hier unnötig), zusätzliche Volumes (80 GB reichen — siehe §6).

> Disk-Größe lässt sich bei Hetzner **nur vergrößern, nie verkleinern**.
> CPU und RAM dagegen jederzeit in beide Richtungen.

### Vor dem ersten Login: Tailscale
Konto auf <https://tailscale.com> anlegen (kostenloser Personal-Plan reicht),
App auf Handy und PC installieren. Dann in der Admin-Konsole
**Settings → Feature previews → HTTPS Certificates** aktivieren — sonst
scheitert Skript 03.

---

## 2. Setup ausführen

Die vier Skripte bauen aufeinander auf, in dieser Reihenfolge:

Die Skripte liegen unter `infra/hetzner/` in diesem Repo. Auf den frischen
Server kommen sie am einfachsten per `scp` — ein `git clone` geht dort noch
nicht, weil GitHub-Zugang erst in Schritt 04 eingerichtet wird.

```bash
# Skripte auf den Server kopieren (vom PC aus, aus dem Repo-Wurzelverzeichnis)
scp -r infra/hetzner root@<server-ip>:/root/

# 1) Grundabsicherung — als root
ssh root@<server-ip>
cd hetzner
DEV_USER=dev bash 01-bootstrap-root.sh
```

> **Nach Skript 01 die root-Session offen lassen.** In einem zweiten Terminal
> `ssh dev@<tailscale-hostname>` testen. Erst wenn das klappt, die erste
> schließen — root-Login und Passwort-Auth sind ab dann deaktiviert.

```bash
# 2–4) als dev, über Tailscale
ssh dev@<tailscale-hostname>
sudo cp -r /root/hetzner ~/ && sudo chown -R dev:dev ~/hetzner
cd ~/hetzner

bash 02-toolchains.sh     # Node 22, Python 3.13 (uv), arm-none-eabi, Qt, Xvfb
bash 03-code-server.sh    # VS Code im Browser über HTTPS im Tailnet
# GitHub-SSH-Key einrichten (siehe Kopf von 04-projects.sh), dann:
bash 04-projects.sh       # Repos klonen, Deps installieren, CI-Checks fahren
```

Laufzeit insgesamt ~20–30 Minuten, davon der Großteil `pnpm install` und
der Synthstudio-Clone.

### Was die Skripte einrichten

| Skript | Inhalt |
|---|---|
| `01-bootstrap-root.sh` | Benutzer + sudo, SSH-Härtung (kein root, keine Passwörter), ufw (öffentlich nur SSH, alles Weitere im Tailnet), 4 GB Swap mit `swappiness=10`, Tailscale, unattended-upgrades, fail2ban |
| `02-toolchains.sh` | Node 22 + corepack, Python 3.13 via `uv`, `gcc-arm-none-eabi`, clang/cppcheck, `libasound2-dev`, Qt-Runtime für PyQt6, ffmpeg, Xvfb, tmux-Config mit Maus-Support |
| `03-code-server.sh` | code-server auf `127.0.0.1:8080`, per `tailscale serve` als HTTPS auf `https://<host>.<tailnet>.ts.net` |
| `04-projects.sh` | Alle drei Repos, Abhängigkeiten, plus die CI-Checks als Verifikation |

Versionen sind an eure CI-Workflows angeglichen: Node 22 (Synthstudio `ci.yml`,
omnitribe braucht `--experimental-strip-types`), Python 3.13 (omnitribe + Korg),
pnpm über corepack aus `packageManager` (10.4.1).

---

## 3. Synthstudio vom Handy

Der eigentliche Gewinn: Web-Audio unterwegs testen, weil die Web-App laut
eurem Isomorphie-Invariant ohne Electron voll funktionsfähig sein muss.

```bash
tmux new -s synth
cd ~/projects/Synthstudio && pnpm dev      # Vite bindet dank host:true auf 0.0.0.0
# Ctrl-b d  → abhängen, läuft weiter
sudo tailscale serve --bg --set-path /synth 127.0.0.1:5173
```

Dann `https://<host>.<tailnet>.ts.net/synth` am Handy öffnen.

### Tailnet-Hostname in Vite freigegeben

`vite.config.ts` beschränkt `server.allowedHosts`. Ohne einen passenden Eintrag
antwortet Vite über einen Tailnet-Hostnamen mit *"Blocked request. This host is
not allowed."*. `.ts.net` ist dort inzwischen eingetragen — nichts weiter zu tun.

### tmux ist hier nicht optional
Mobile Browser räumen Hintergrund-Tabs weg, und in der Bahn reißt die
Verbindung. Alles, was länger als ein paar Sekunden läuft — Dev-Server,
`pnpm test`, Builds — gehört in eine tmux-Session, sonst stirbt es mit dem SSH-Socket.

---

## 4. Was auf dem Server **nicht** geht

| | Grund |
|---|---|
| Electribe per USB-MIDI ansprechen, Firmware flashen, HIL-Tests | Kein physischer USB-Zugriff |
| Audio-Interfaces, echte Audio-Ausgabe auf dem Server | Kein Audio-Device — Web-Audio läuft im *Handy*-Browser, nicht auf dem Server |
| Windows-/macOS-Installer bauen | Läuft ohnehin in `electron-release.yml` in der CI |
| Korg-Editor: volle pytest-Suite auf dem CI-Pfad | Eure `ci.yml` fährt sie auf `windows-2025-vs2026` als einziges unterstütztes Runtime-Ziel |
| PyQt6-GUI bedienen | Nur über noVNC/X11-Streaming, als Alltagslösung zäh. Headless-Tests mit `QT_QPA_PLATFORM=offscreen` gehen. |

Deine CI ist damit das Sicherheitsnetz: Wenn du mobil arbeitest, ersetzt
„Push → CI grün" die lokale Verifikation.

---

## 5. Betrieb

```bash
# Status
systemctl status code-server@dev
tailscale status
free -h && df -h /

# code-server neu starten
sudo systemctl restart code-server@dev

# Was frisst den Platz?
ncdu ~

# Claude Code direkt auf dem Server
npm install -g @anthropic-ai/claude-code && claude
```

**Wenn `tailscale serve` nach einem Reboot weg ist:** `--bg`-Regeln überleben
Neustarts normalerweise; sonst `sudo tailscale serve --bg --https=443 127.0.0.1:8080`
erneut absetzen.

**Wenn du dich aussperrst:** Hetzner-Konsole → Server → **Rescue** aktivieren,
Server neu starten, per SSH ins Rescue-System, Root-Filesystem mounten und
`/etc/ssh/sshd_config.d/99-hardening.conf` reparieren.

---

## 6. Plattenplatz-Prognose

| Posten | ca. |
|---|---|
| Synthstudio (Partial Clone + node_modules + Electron + Chromium) | 4–5 GB |
| omnitribe (venv, ARM-Toolchain, Build-Artefakte) | 1–2 GB |
| Korg-Editor (venv mit PyQt6, numpy, scipy) | ~1 GB |
| OS, code-server, pnpm-Store, apt-Caches, 4 GB Swap | 8–10 GB |
| **Summe** | **~18 GB von 80 GB** |

Reichlich Luft. Der `--filter=blob:none`-Clone in Skript 04 spart dabei rund
1 GB, weil Synthstudios History ~1,6 GB Sample-Dateien unter `Korg ESX files/`
trägt. Die dauerhafte Lösung wäre Git LFS oder ein Auslagern aus der Historie —
das würde auch CI-Läufe und Claude-Code-Sessions spürbar beschleunigen.

---

## 7. Blackfin-Toolchain (optional, brauchst du vorerst nicht)

`docs/toolchain_setup.md` stellt klar: Die Electribe 2 ist ein 3-Chip-System.
Der **TI Sitara AM1802 (ARM926EJ-S)** führt `SYSTEM.VSB` aus und ist das Ziel von
99 % aller OmniTribe-Patches — dafür genügt `arm-none-eabi-gcc` aus Skript 02,
genau wie in eurer CI. Der **ADSP-BF523 Blackfin** ist Slave-DSP; `bfin-elf-gcc`
brauchst du erst, wenn du die Audio-Engine selbst ersetzt (Sprint 3+ Stretch).

Falls es soweit kommt: Analog Devices liefert die Toolchain als x86_64-Linux-Binary —
auf dem CX33 also nativ installierbar, ohne Emulation. Die in `agents/SECURITY.md`
gepinnte Version `bfin-elf-gcc 12.3.0` muss dabei exakt getroffen werden, sonst
bricht die Hash-Chain in `manifest.json`.
