import { build } from 'esbuild';
await build({
  entryPoints: ['src/entrypoints/runner.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/runner.mjs',
  external: ['@openai/codex-sdk'],
  banner: {
    js: "import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);",
  },
});
