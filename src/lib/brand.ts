export const BRAND = {
  name: 'CowdeISreal',
  short: 'CowdeISreal',
  tagline: 'Сообщества, разговоры и звонки — бесплатно для участников',
} as const;

// Абсолютная ссылка с учётом базового пути (например, /CowdeISreal/ на GitHub Pages)
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
export function appUrl(path: string): string {
  return `${location.origin}${BASE}${path}`;
}
