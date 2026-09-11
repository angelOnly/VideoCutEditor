#!/bin/sh
set -eu
: "${DATA_ROOT:=/home/ops/jiangzb/video-worker-data}"
mkdir -p "$DATA_ROOT"
# All supervisors on this execution host must share this local directory/inode.
# flock remains inherited while Node runs; SIGKILL automatically releases it.
export VIDEOCUT_SUPERVISOR_LOCKED=1
exec flock -n "$DATA_ROOT/supervisor.lock" node /opt/video-worker/dist/entrypoints/worker.js
