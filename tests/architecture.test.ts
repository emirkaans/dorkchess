import { readdirSync, readFileSync, statSync } from 'node:fs';
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
  it("engine React'e veya DOM'a bağımlı değil", () => {
    for (const file of sources('src/engine')) {
      const code = readFileSync(file, 'utf8');
      expect(code, file).not.toMatch(/from ['"](react|react-dom)/);
      expect(code, file).not.toMatch(/\b(document|window|navigator|HTMLElement)\b/);
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
