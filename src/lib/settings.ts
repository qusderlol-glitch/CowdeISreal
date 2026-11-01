import type { UserSettings } from './types';
import { applyRegistry, REGISTRY_DEFAULTS, type SettingValue } from './customize';

// Значения по умолчанию берутся из реестра кастомизации + выбор устройств (не входят в реестр, выбираются списком устройств).
export const DEFAULT_SETTINGS: UserSettings = { ...REGISTRY_DEFAULTS, micId: '', camId: '', speakerId: '' } as UserSettings;
const LS = 'cowdeisreal.settings';

export function loadLocalSettings(): UserSettings {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(LS) || '{}') }; } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveLocalSettings(s: UserSettings) {
  localStorage.setItem(LS, JSON.stringify(s));
}
export function applySettings(s: UserSettings) {
  applyRegistry(s as Record<string, SettingValue>);
}
