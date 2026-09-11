#!/bin/zsh
cd "${0:A:h}" || exit 1
runtime_root="/Users/jiang/.cache/codex-runtimes/codex-primary-runtime/dependencies"
export NODE_PATH="$runtime_root/node/node_modules${NODE_PATH:+:$NODE_PATH}"
exec "$runtime_root/node/bin/node" server.cjs --login
