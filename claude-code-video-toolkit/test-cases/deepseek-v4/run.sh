#!/usr/bin/env bash
# Single-job Linux test launcher, not a durable production worker.
set -euo pipefail
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_dir"
job_id="${1:-deepseek-v4-test}"
[[ "$job_id" =~ ^[a-zA-Z0-9_-]+$ ]] || { echo 'Invalid job id' >&2; exit 2; }
job_dir="$repo_dir/projects/$job_id"
for tool in codex ffmpeg ffprobe node npm python3 timeout flock; do
  command -v "$tool" >/dev/null || { echo "Missing dependency: $tool" >&2; exit 2; }
done
[[ -s "$job_dir/task.json" && -s "$job_dir/prompt.txt" ]] || { echo 'Run prepare.py first.' >&2; exit 2; }
job_timeout_sec="$(python3 - "$job_dir/task.json" <<'PYLIMIT'
import json, sys
from pathlib import Path
value = json.loads(Path(sys.argv[1]).read_text()).get('limits', {}).get('timeoutSec', 14400)
if type(value) is not int or value <= 0:
    raise SystemExit('limits.timeoutSec must be a positive integer')
print(value)
PYLIMIT
)"
# Load only the TTS settings as data, never source/eval a credential file.
if [[ "${VIDEO_PIPELINE_ENV_LOADED:-}" != 1 ]]; then
  exec python3 - "$repo_dir" "$job_id" <<'PYENV'
import os, sys
from pathlib import Path
from dotenv import dotenv_values
root = Path(sys.argv[1])
config = dotenv_values(root.parent / '.env', interpolate=False)
env = dict(os.environ)
for name in ('DOUBAO_TTS_API_KEY', 'DOUBAO_TTS_RESOURCE_ID'):
    if not env.get(name) and config.get(name):
        env[name] = config[name]
env['VIDEO_PIPELINE_ENV_LOADED'] = '1'
os.execvpe('bash', ['bash', str(root / 'test-cases/deepseek-v4/run.sh'), sys.argv[2]], env)
PYENV
fi
[[ -n "${DOUBAO_TTS_API_KEY:-}" ]] || { echo 'Run python3 test-cases/deepseek-v4/configure_tts.py first.' >&2; exit 2; }

codex login status
exec 9>"$job_dir/run.lock"
flock -n 9 || { echo 'This job is already running.' >&2; exit 2; }
# Do not silently repeat a run that may have made paid TTS calls.
[[ ! -e "$job_dir/run.started" ]] || { echo 'This job has already run. Inspect logs/audio before any paid retry.' >&2; exit 2; }
date -u > "$job_dir/run.started"
printf 'Running. Events: %s\n' "$job_dir/events.jsonl"
set +e
timeout --signal=TERM --kill-after=15s "${job_timeout_sec}s" \
  codex -a never exec --sandbox workspace-write \
  -c sandbox_workspace_write.network_access=true \
  -c shell_environment_policy.ignore_default_excludes=true \
  -c 'shell_environment_policy.include_only=["PATH","HOME","VIRTUAL_ENV","LANG","LC_ALL","TMPDIR","DOUBAO_TTS_API_KEY","DOUBAO_TTS_RESOURCE_ID"]' \
  --json --output-schema .agents/skills/video-pipeline/references/response.schema.json \
  -o "$job_dir/agent-response.json" - \
  < "$job_dir/prompt.txt" > "$job_dir/events.jsonl" 2> "$job_dir/codex.stderr.log"
run_status=$?
set -e
printf '%s\n' "$run_status" > "$job_dir/agent-exit-code.txt"
if [[ "$run_status" -ne 0 ]]; then
  echo "Codex failed or timed out (exit $run_status). See codex.stderr.log and events.jsonl." >&2
  exit "$run_status"
fi
python3 - "$job_dir/agent-response.json" <<'PY'
import json, sys
from pathlib import Path
response = json.loads(Path(sys.argv[1]).read_text())
expected = Path(sys.argv[1]).parent.name
if response.get('jobId') != expected or response.get('status') != 'candidate' or response.get('stage') != 'delivery_check' or response.get('artifact') != 'output/video.mp4' or response.get('error') is not None:
    print('No valid candidate:', json.dumps(response, ensure_ascii=False), file=sys.stderr)
    raise SystemExit(1)
PY
python3 .agents/skills/video-pipeline/scripts/validate_delivery.py --job-dir "$job_dir"
printf 'Local candidate validated: %s\n' "$job_dir/output/video.mp4"
