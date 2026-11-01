import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SETTINGS, countByKind } from './customize';

const root = new URL('..', import.meta.url).pathname;
const css = readFileSync(join(root, 'styles/app.css'), 'utf8');
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
}
const code = walk(root).filter((f) => /\.(ts|tsx)$/.test(f) && !/customize\.ts$|settings\.ts$|\.test\.ts$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');

describe('кастомизация: каждая настройка реально подключена', () => {
  it('ключи уникальны', () => {
    expect(new Set(SETTINGS.map((s) => s.key)).size).toBe(SETTINGS.length);
  });
  for (const s of SETTINGS) {
    if (s.kind === 'attr') {
      const values = s.type === 'toggle' ? ['true', 'false'] : (s.options ?? []).map(([v]) => v);
      for (const v of values.filter((v) => v !== String(s.default))) {
        it(`${s.key}: есть CSS для [data-${s.name}='${v}']`, () => { expect(css).toContain(`[data-${s.name}='${v}']`); });
      }
    } else if (s.kind === 'var') {
      it(`${s.key}: CSS использует var(--${s.name})`, () => { expect(css).toContain(`var(--${s.name}`); });
    } else {
      it(`${s.key}: код читает настройку`, () => { expect(code).toMatch(new RegExp(`\\.${s.key}\\b`)); });
    }
  }
  it('итог', () => {
    const c = countByKind();
    console.log(`Настроек: ${c.total} (стилевых: ${c.attr}, переменных: ${c.var}, логических: ${c.logic})`);
    expect(c.total).toBeGreaterThanOrEqual(150);
  });
});
