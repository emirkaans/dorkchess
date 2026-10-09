/// <reference types="vitest/config" />
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { serviceWorkerSource, versionOf } from './src/pwa/service-worker.ts';

/** Every file under `dir`, as paths relative to it with forward slashes. */
function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesIn(p).map((f) => `${name}/${f}`) : [relative(dir, p).split('\\').join('/')];
  });
}

/** Emits sw.js listing every file of the build (bundle + public/) for offline use. */
function serviceWorker(): Plugin {
  return {
    name: 'dorkchess-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const files = ['./', ...[...built, ...filesIn('public')].sort().map((f) => `./${f}`)];
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorkerSource(files, versionOf(files)) });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    // Shared CI machines are slower: the bot-vs-bot robustness games get more time there.
    testTimeout: process.env.CI ? 300_000 : 60_000,
  },
});
