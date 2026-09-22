import { spawn } from 'node:child_process';
export async function command(
  file: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal; timeout?: number } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(file, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let stdout = '',
      stderr = '';
    const kill = () => {
      try {
        process.kill(-p.pid!, 'SIGKILL');
      } catch {
        p.kill('SIGKILL');
      }
    };
    const timer = setTimeout(kill, opts.timeout ?? 600000);
    opts.signal?.addEventListener('abort', kill, { once: true });
    if (opts.signal?.aborted) kill();
    p.stdout.on('data', (b) => {
      stdout += b;
      if (stdout.length > 8_000_000) kill();
    });
    p.stderr.on('data', (b) => {
      stderr = (stderr + b).slice(-32000);
    });
    p.on('error', reject);
    p.on('close', (code, exitSignal) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', kill);
      if (code === 0 && !opts.signal?.aborted) resolve(stdout);
      else
        reject(
          Object.assign(
            new Error(`${file} exited ${code ?? exitSignal}: ${(stderr || stdout).slice(-4000)}`),
            {
              stdout,
              stderr,
              exitCode: code,
              exitSignal,
            },
          ),
        );
    });
  });
}
