import type { UserSettings } from './types';

// Короткие звуки на WebAudio (без файлов). Тип и громкость — из настроек «Звуки».
const SHAPES: Record<string, { f: number[]; d: number; w: OscillatorType }> = {
  soft: { f: [660], d: 0.12, w: 'sine' }, bell: { f: [880, 1320], d: 0.35, w: 'sine' }, pop: { f: [420], d: 0.05, w: 'square' },
  chirp: { f: [900, 1400], d: 0.1, w: 'triangle' }, drop: { f: [1200, 500], d: 0.18, w: 'sine' },
};

export function inQuietHours(s: UserSettings, now = new Date()): boolean {
  if (!s.quietHours) return false;
  const h = now.getHours(); const from = Number(s.quietFrom); const to = Number(s.quietTo);
  return from <= to ? h >= from && h < to : h >= from || h < to;
}

export function playSound(s: UserSettings, kind: 'notify' | 'send' | 'join' | 'leave' = 'notify') {
  if (kind === 'notify' && (!s.notifySound || inQuietHours(s))) return;
  const vol = Math.max(0, Math.min(1, Number(s.soundVolume ?? 0.5)));
  if (!vol) return;
  try {
    const shape = kind === 'join' ? SHAPES.chirp : kind === 'leave' ? SHAPES.drop : kind === 'send' ? SHAPES.pop : SHAPES[String(s.soundType)] ?? SHAPES.soft;
    const ac = new AudioContext(); const g = ac.createGain(); g.gain.value = 0.08 * vol; g.connect(ac.destination);
    shape.f.forEach((f, i) => {
      const o = ac.createOscillator(); o.type = shape.w; o.frequency.value = f; o.connect(g);
      const t0 = ac.currentTime + i * shape.d * 0.6; o.start(t0); o.stop(t0 + shape.d);
      if (i === shape.f.length - 1) o.onended = () => void ac.close();
    });
  } catch { /* звук недоступен */ }
}
