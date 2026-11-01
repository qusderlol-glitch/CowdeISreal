import { supabase } from '../supabase';

// Серверы ICE для WebRTC.
//  * STUN бесплатен и не передаёт медиа: помогает, когда хотя бы одна сеть «простая».
//  * TURN ретранслирует звук/видео, когда прямой путь закрыт (мобильный интернет, CGNAT, строгий роутер).
//    Без TURN звонки между разными сетями часто не соединяются («нет связи»).
// Способы задать TURN:
//  1) VITE_ICE_SERVERS — JSON-массив RTCIceServer целиком (вставляется из панели TURN-провайдера).
//     Учётки при этом видны в коде сайта: любой может их прочитать и тратить вашу квоту. Для небольшого
//     проекта это обычная практика, но ставьте лимит трафика у провайдера и меняйте ключ при злоупотреблении.
//  2) VITE_TURN_ENABLED=true + Edge Function turn-credentials — краткоживущие учётки, секрет только на сервере.
const DEFAULT_STUN: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];

export function parseIceServers(raw: string | undefined): RTCIceServer[] | null {
  if (!raw || !raw.trim()) return null;
  try {
    const v = JSON.parse(raw);
    const list = Array.isArray(v) ? v : Array.isArray(v?.iceServers) ? v.iceServers : [v];
    const ok = list.filter((s: RTCIceServer) => s && (typeof s.urls === 'string' || Array.isArray(s.urls)));
    return ok.length ? ok : null;
  } catch { return null; }
}

export function hasTurn(servers: RTCIceServer[]): boolean {
  return servers.some((s) => ([] as string[]).concat(s.urls).some((u) => /^turns?:/i.test(u)));
}

export async function getIceServers(): Promise<{ servers: RTCIceServer[]; turn: 'none' | 'ok' | 'error' }> {
  const fromEnv = parseIceServers(import.meta.env.VITE_ICE_SERVERS as string | undefined);
  const stunOnly = parseIceServers(import.meta.env.VITE_STUN_SERVERS ? JSON.stringify((JSON.parse(import.meta.env.VITE_STUN_SERVERS) as string[]).map((u) => ({ urls: u }))) : undefined);
  const servers: RTCIceServer[] = fromEnv ?? stunOnly ?? DEFAULT_STUN;
  if (import.meta.env.VITE_TURN_ENABLED === 'true') {
    try {
      const { data, error } = await supabase.functions.invoke('turn-credentials');
      if (error || !data?.iceServers) throw error ?? new Error('no iceServers');
      return { servers: [...servers, ...(data.iceServers as RTCIceServer[])], turn: 'ok' };
    } catch {
      return { servers, turn: hasTurn(servers) ? 'ok' : 'error' };
    }
  }
  return { servers, turn: hasTurn(servers) ? 'ok' : 'none' };
}
