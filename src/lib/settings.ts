import type { UserSettings } from './types';

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'meadow', accent: '#2f8a5f', density: 'cozy', fontSize: 15, showMemberList: true, reducedMotion: false, highContrast: false,
  notifyDesktop: false, notifyMentionsOnly: true, notifySound: true, micId: '', camId: '', speakerId: '',
  noiseSuppression: true, echoCancellation: true,
};
const LS = 'cowdeisreal.settings';

export function loadLocalSettings(): UserSettings {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(LS) || '{}') }; } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveLocalSettings(s: UserSettings) {
  localStorage.setItem(LS, JSON.stringify(s));
}
export function applySettings(s: UserSettings) {
  const r = document.documentElement;
  r.dataset.theme = s.theme;
  r.dataset.density = s.density;
  r.dataset.contrast = s.highContrast ? 'high' : 'normal';
  r.dataset.motion = s.reducedMotion ? 'reduced' : 'full';
  r.style.setProperty('--accent', /^#[0-9a-f]{6}$/i.test(s.accent) ? s.accent : DEFAULT_SETTINGS.accent);
  r.style.setProperty('--font-size', `${Math.min(20, Math.max(12, s.fontSize))}px`);
}
