#!/bin/sh
set -eu
entrypoint=${1:-worker}
case "$entrypoint" in worker|host-check) ;; *) echo 'Expected worker or host-check'; exit 1;; esac
service_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
# Resolve .env via Node's dotenv parser, never source it as executable shell code.
DATA_ROOT=$(cd "$service_dir" && node --input-type=module -e 'import {loadConfig} from "./dist/config.js"; process.stdout.write(loadConfig().dataRoot)')
export DATA_ROOT VIDEOCUT_SUPERVISOR_LOCKED=1
mkdir -p "$DATA_ROOT"
chmod 700 "$DATA_ROOT"
exec flock -n "$DATA_ROOT/supervisor.lock" node "$service_dir/dist/entrypoints/$entrypoint.js"
