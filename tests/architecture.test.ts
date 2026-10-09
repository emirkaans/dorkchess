import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listVariants } from '../src/engine/variants/index.ts';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

describe('mimari', () => {
  it("engine, ai, clock, rules ve storage React'e veya DOM'a bağımlı değil", () => {
    const dirs = ['src/engine', 'src/ai', 'src/clock', 'src/rules', 'src/storage'].filter((d) => existsSync(d));
    for (const file of dirs.flatMap(sources)) {
      const code = readFileSync(file, 'utf8');
      expect(code, file).not.toMatch(/from ['"](react|react-dom)/);
      // DOM globals used in code (words like "aspiration window" in comments are fine).
      expect(code, file).not.toMatch(/\b(document|window|navigator)\s*[.[]|\bHTMLElement\b/);
    }
  });

  it("oyun durumu (session, reducer) React'siz: Node'da test edilebilir", () => {
    for (const file of ['src/ui/game/session.ts', 'src/ui/game/reducer.ts']) {
      const code = readFileSync(file, 'utf8');
      expect(code, file).not.toMatch(/from ['"](react|react-dom)/);
      expect(code, file).not.toMatch(/\b(document|window|navigator)\s*[.[]/);
    }
  });

  it('UI kodunda varyanta veya taşa özel dal yok', () => {
    const ids = listVariants().map((v) => v.id);
    for (const file of sources('src/ui')) {
      const code = readFileSync(file, 'utf8');
      for (const id of ids) expect(code, `${file}: '${id}'`).not.toContain(`'${id}'`);
      expect(code, file).not.toMatch(/type === ['"][a-z]['"]/);
    }
  });
});
