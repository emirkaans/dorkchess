import { describe, expect, it } from 'vitest';
import { serviceWorkerSource, versionOf } from '../src/pwa/service-worker.ts';
import { readFileSync } from 'node:fs';

describe('PWA', () => {
  const files = ['./', './assets/index-abc.js', './assets/worker-def.js', './icons/icon-192.png'];

  it('service worker bütün dosyaları sürümlü bir önbelleğe alır', () => {
    const src = serviceWorkerSource(files, versionOf(files));
    expect(src).toContain(`const CACHE = "dorkchess-${versionOf(files)}"`);
    expect(src).toContain(`const FILES = ${JSON.stringify(files)}`);
    // Yeni sürüm kendiliğinden devralmaz; sayfa "skip-waiting" ile ister.
    expect(src).toContain("event.data === 'skip-waiting'");
    expect(src).not.toMatch(/install[\s\S]*skipWaiting\(\)[\s\S]*activate/);
    // crossorigin script/style requests must still hit the cache offline.
    expect(src.match(/ignoreVary: true/g)).toHaveLength(2);
  });

  it('dosya adları değişince önbellek sürümü değişir', () => {
    expect(versionOf(files)).toBe(versionOf([...files]));
    expect(versionOf(['./', './assets/index-xyz.js'])).not.toBe(versionOf(files));
  });

  it('manifest kurulum için gerekli alanları ve ikonları içerir', () => {
    const m = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBeTruthy();
    const sizes = m.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}:${i.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']));
    for (const i of m.icons) expect(() => readFileSync(`public/${i.src}`)).not.toThrow();
  });
});
