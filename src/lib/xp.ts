// Уровень L достигается при xp >= 25*L*(L+1): 50, 150, 300, 500… (то же в SQL public.xp_level)
export function xpForLevel(level: number): number {
  return 25 * level * (level + 1);
}
export function levelFromXp(xp: number): number {
  const x = Math.max(0, Math.floor(xp));
  let l = Math.floor((Math.sqrt(1 + (4 * x) / 25) - 1) / 2);
  while (xpForLevel(l + 1) <= x) l++;
  while (l > 0 && xpForLevel(l) > x) l--;
  return l;
}
export function levelProgress(xp: number): { level: number; into: number; span: number; ratio: number } {
  const level = levelFromXp(xp);
  const base = xpForLevel(level);
  const span = xpForLevel(level + 1) - base;
  const into = xp - base;
  return { level, into, span, ratio: span ? into / span : 0 };
}
