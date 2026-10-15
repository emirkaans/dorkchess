/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
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
      // Jacket pictures stay out: each page needs one of them at most, fetched when shown.
      // Stockfish (7 MB) loads only when analysis is opened.
      const offline = filesIn('public').filter((f) => !f.startsWith('jackets/') && !f.startsWith('stockfish/'));
      const files = ['./', ...[...built, ...offline].sort().map((f) => `./${f}`)];
      // Bundle files carry a content hash in their names; files of public/ do not, so their
      // contents count too (a changed font or icon must make a new cache version).
      const publicHashes = filesIn('public').map(
        (f) =>
          `${f}:${createHash('sha256')
            .update(readFileSync(join('public', f)))
            .digest('hex')
            .slice(0, 12)}`,
      );
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: serviceWorkerSource(files, versionOf([...files, ...publicHashes])),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  server: {
    // The online game API runs in `npm run dev:server` (wrangler dev).
    proxy: { '/api': { target: 'http://localhost:8787', ws: true }, '/auth': { target: 'http://localhost:8787' } },
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    // Shared CI machines are slower: the bot-vs-bot robustness games get more time there.
    testTimeout: process.env.CI ? 300_000 : 60_000,
  },
});
