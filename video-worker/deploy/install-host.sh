#!/usr/bin/env bash
# Run as the Ubuntu user who ran `codex login`, e.g. ops. Do not sudo this script.
set -euo pipefail
[[ $(uname -s) == Linux ]] || { echo 'This installer requires Ubuntu/Linux'; exit 1; }
[[ $(id -u) != 0 ]] || { echo 'Run as your codex login user, not root; sudo is used only for OS packages.'; exit 1; }
service_dir=$(cd -- "$(dirname -- "$0")/.." && pwd)
project_dir=$(dirname "$service_dir")
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
# Stop before replacing any source/dependency used by current native tasks.
if [[ -f "$HOME/.config/systemd/user/videocut-worker.service" ]]; then
  worker_state=$(systemctl --user show --property=ActiveState --value videocut-worker.service)
  case "$worker_state" in
    active|activating|deactivating|reloading) systemctl --user stop videocut-worker.service ;;
    inactive|failed) ;; # An invalid inactive unit from an interrupted install can be replaced.
    *) echo "Unexpected Worker state: $worker_state"; exit 1 ;;
  esac
fi
# Avoid silently installing Node into an interactive-only nvm directory.
sudo apt-get update
sudo apt-get install -y curl ca-certificates xz-utils python3 python3-venv ffmpeg fonts-noto-cjk bubblewrap apparmor util-linux dbus-user-session ripgrep
node_supported() {
  "$1" -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 13)) process.exit(1)'
}
# Prefer the runtime installed here on previous attempts, even when PATH still selects Node 18.
if [[ -x /usr/local/bin/node ]] && node_supported /usr/local/bin/node; then
  node_dir=/usr/local/bin
elif command -v node >/dev/null && node_supported "$(command -v node)"; then
  node_dir=$(dirname "$(command -v node)")
else
  case $(uname -m) in x86_64) arch=x64;; aarch64) arch=arm64;; *) echo 'Unsupported Node architecture'; exit 1;; esac
  node_version=v22.20.0
  download_dir=$(mktemp -d)
  trap 'rm -rf "$download_dir"' EXIT
  archive="node-${node_version}-linux-${arch}.tar.xz"
  curl -fsSL "https://nodejs.org/dist/${node_version}/${archive}" -o "$download_dir/$archive"
  curl -fsSL "https://nodejs.org/dist/${node_version}/SHASUMS256.txt" -o "$download_dir/SHASUMS256.txt"
  (cd "$download_dir" && awk -v file="$archive" '$2 == file' SHASUMS256.txt > selected.sha256 && test -s selected.sha256 && sha256sum -c selected.sha256)
  sudo tar -xJf "$download_dir/$archive" -C /usr/local --strip-components=1
  node_dir=/usr/local/bin
fi
export PATH="$node_dir:/usr/local/bin:/usr/bin:/bin:$PATH"
# Bash may have cached /usr/bin/node before installation. Refresh it after choosing PATH.
hash -r
node_supported "$node_dir/node" || { echo 'Node.js >=22.13 is required'; exit 1; }
[[ -x "$node_dir/npm" ]] || { echo "npm is missing from $node_dir"; exit 1; }
printf 'Using Node %s (%s) and npm %s\n' "$(node --version)" "$(command -v node)" "$(npm --version)"
# Project-local package manager; never require copying another .env.
cd "$service_dir"
npm exec --yes --package=pnpm@11.19.0 -- pnpm install --frozen-lockfile --ignore-scripts
python3 -m venv .venv
.venv/bin/pip install requests==2.32.5 python-dotenv==1.2.1 jsonschema==4.26.0
(cd "$project_dir/claude-code-video-toolkit/templates/ifeng-scenes" && npm exec --yes --package=pnpm@11.19.0 -- pnpm install --frozen-lockfile --ignore-scripts)
# Ubuntu's chromium package may be a Snap wrapper, which cannot run inside the task namespace.
# Remotion downloads its pinned headless browser into the admitted template dependency tree.
node scripts/install-browser.mjs
sudo apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64 || sudo apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2
npm exec --yes --package=pnpm@11.19.0 -- pnpm runtime-manifest
npm exec --yes --package=pnpm@11.19.0 -- pnpm build
sudo loginctl enable-linger "$(id -un)"
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
mkdir -p "$HOME/.config/systemd/user"
# systemd unit quoting. These are installation paths, never credential values.
export VIDEOCUT_INSTALL_SERVICE_DIR="$service_dir" VIDEOCUT_INSTALL_NODE_DIR="$node_dir"
python3 - <<'PY'
import os,pathlib
service=pathlib.Path(os.environ['VIDEOCUT_INSTALL_SERVICE_DIR'])
# WorkingDirectory is a single literal path; systemd does not strip shell quotes there.
if any(c in str(service) for c in '\r\n') or str(service) != str(service).strip():
    raise SystemExit('Installation path must not contain line breaks or surrounding whitespace')
def quote(value): return '"'+str(value).replace('\\','\\\\').replace('"','\\"').replace('%','%%')+'"'
unit='''[Unit]
Description=VideoCutEditor Ubuntu Worker (ChatGPT login)
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=10

[Service]
Type=simple
WorkingDirectory=%s
ExecStart=%s
Environment=%s
Restart=on-failure
RestartSec=10
KillMode=control-group
TimeoutStopSec=90
UMask=0022
LimitNOFILE=65536

[Install]
WantedBy=default.target
''' % (str(service).replace('%','%%'),quote(service/'deploy/start-worker.sh'),quote('PATH='+os.environ['VIDEOCUT_INSTALL_NODE_DIR']+':/usr/local/bin:/usr/bin:/bin'))
(pathlib.Path.home()/'.config/systemd/user/videocut-worker.service').write_text(unit)
PY
systemd-analyze --user verify "$HOME/.config/systemd/user/videocut-worker.service"
systemctl --user daemon-reload
# The check uses fake local files for isolation and account/read for login. No model/TTS charges.
# Stop the existing native Worker before opening another app-server with the same login.
if systemctl --user is-active --quiet videocut-worker.service; then systemctl --user stop videocut-worker.service; fi
# Transition from the old Docker executor: refuse a live supervisor, then reap its task containers.
if command -v docker >/dev/null; then
  old_supervisor=$(docker ps -q --filter label=com.docker.compose.project=videocut --filter label=com.docker.compose.service=worker)
  if [[ -n "$old_supervisor" ]]; then
    echo 'Stop the old Docker Worker first: docker compose up -d --build --remove-orphans'; exit 1
  fi
  old_jobs=$(docker ps -aq --filter label=videocut.run)
  while IFS= read -r container_id; do [[ -z "$container_id" ]] || docker rm -f "$container_id"; done <<< "$old_jobs"
fi
bash "$service_dir/deploy/install-bwrap-policy.sh"
./deploy/start-worker.sh host-check
systemctl --user enable --now videocut-worker.service
printf '%s\n' 'Worker installed. Logs: journalctl --user -u videocut-worker -f'
