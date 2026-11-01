import type { UserSettings } from './types';

// Время и дата по настройкам: 24/12 ч, секунды, относительное время, формат даты.
export function fmtClock(iso: string, s: UserSettings, now = Date.now()): string {
  const d = new Date(iso);
  if (s.relativeTime) {
    const diff = Math.round((now - d.getTime()) / 1000);
    if (diff >= 0 && diff < 60) return 'только что';
    if (diff >= 60 && diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
    if (diff >= 3600 && diff < 6 * 3600) return `${Math.floor(diff / 3600)} ч назад`;
  }
  return d.toLocaleTimeString(s.timeFormat === '12' ? 'en-US' : 'ru-RU',
    { hour: '2-digit', minute: '2-digit', second: s.showSeconds ? '2-digit' : undefined, hour12: s.timeFormat === '12' });
}

export function fmtDay(iso: string, s: UserSettings, now = new Date()): string {
  const d = new Date(iso); const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Сегодня';
  if (d.toDateString() === y.toDateString()) return 'Вчера';
  return fmtDate(iso, s);
}

export function fmtDate(iso: string, s: UserSettings): string {
  const d = new Date(iso);
  if (s.dateFormat === 'iso') return d.toISOString().slice(0, 10);
  if (s.dateFormat === 'short') return d.toLocaleDateString('ru-RU');
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}
