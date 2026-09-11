import { readJson } from '../infrastructure/files.js';
import { runCodex } from '../runner/codex.js';
import { assertInternalTask } from '../contracts/internal.js';
const task = await readJson('/workspace/job/task.json');
assertInternalTask('/opt/toolkit', task);
await runCodex('/workspace/job', task);
