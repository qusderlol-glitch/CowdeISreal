import { describe, expect, it } from 'vitest';
import { levelFromXp, xpForLevel, levelProgress } from './xp';
import { PERM, PERM_ALL, PERM_DEFAULT, has, toggleBit } from './permissions';
import { parseCommand, suggestCommands } from './commands';
import { humanError } from './errors';
import { linkify } from './format';
import { readFileSync } from 'node:fs';

describe('xp', () => {
  it('thresholds', () => {
    expect([1, 2, 3, 4].map(xpForLevel)).toEqual([50, 150, 300, 500]);
    expect(levelFromXp(0)).toBe(0);
    expect(levelFromXp(49)).toBe(0);
    expect(levelFromXp(50)).toBe(1);
    expect(levelFromXp(149)).toBe(1);
    expect(levelFromXp(150)).toBe(2);
    for (let l = 0; l < 200; l++) {
      expect(levelFromXp(xpForLevel(l))).toBe(l);
      if (l > 0) expect(levelFromXp(xpForLevel(l) - 1)).toBe(l - 1);
    }
  });
  it('progress', () => {
    expect(levelProgress(100)).toEqual({ level: 1, into: 50, span: 100, ratio: 0.5 });
  });
});

describe('permissions', () => {
  it('bits are unique powers of two covering PERM_ALL', () => {
    const vals = Object.values(PERM);
    expect(new Set(vals).size).toBe(vals.length);
    expect(vals.reduce((a, b) => a | b, 0)).toBe(PERM_ALL);
    vals.forEach((v) => expect(v & (v - 1)).toBe(0));
  });
  it('match SQL migration', () => {
    const sql = readFileSync(new URL('../../supabase/migrations/20261101000000_init.sql', import.meta.url), 'utf8');
    expect(sql).toContain(`select ${PERM_ALL}::bigint`);
    expect(sql).toContain("select (1|2|8|512|1024|2048|4096|32768)::bigint");
    expect(PERM_DEFAULT).toBe(1 | 2 | 8 | 512 | 1024 | 2048 | 4096 | 32768);
    for (const [k, v] of Object.entries(PERM)) expect(sql, k).toMatch(new RegExp(`\\b${v} ${k}\\b`));
  });
  it('has/toggle', () => {
    expect(has(3, PERM.VIEW_CHANNELS, PERM.SEND_MESSAGES)).toBe(true);
    expect(has(1, PERM.SEND_MESSAGES)).toBe(false);
    expect(toggleBit(3, 2, false)).toBe(1);
  });
});

describe('commands', () => {
  it('parse', () => {
    expect(parseCommand('/roll 2d6')).toEqual({ name: 'roll', args: '2d6' });
    expect(parseCommand('hello')).toBeNull();
    expect(parseCommand('/')).toBeNull();
  });
  it('suggest only enabled modules', () => {
    expect(suggestCommands('/r', new Set(['examples'])).map((c) => c.name)).toEqual(['rank', 'roll']);
    expect(suggestCommands('/r', new Set())).toEqual([]);
  });
  it('every command module has a SQL branch', () => {
    const sql = readFileSync(new URL('../../supabase/migrations/20261101000000_init.sql', import.meta.url), 'utf8');
    for (const c of ['help', 'rank', 'top', 'roll', 'coin']) expect(sql).toContain(`when '${c}' then 'examples'`);
  });
});

describe('errors & format', () => {
  it('maps codes', () => {
    expect(humanError({ message: 'rate_limited:7' })).toBe('Слишком часто. Подождите 7 с.');
    expect(humanError({ message: 'hierarchy' })).toMatch(/иерарх/);
    expect(humanError('weird')).toBe('weird');
  });
  it('linkify', () => {
    expect(linkify('hi @bob see https://x.y/z ok')).toEqual([
      { type: 'text', value: 'hi ' }, { type: 'mention', value: '@bob' }, { type: 'text', value: ' see ' },
      { type: 'link', value: 'https://x.y/z' }, { type: 'text', value: ' ok' },
    ]);
  });
});
