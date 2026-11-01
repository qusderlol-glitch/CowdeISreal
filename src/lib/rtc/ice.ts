import { supabase } from '../supabase';

// STUN бесплатен и не передаёт медиа. TURN ретранслирует трафик и стоит денег — учётки выдаёт только сервер.
export async function getIceServers(): Promise<{ servers: RTCIceServer[]; turn: 'none' | 'ok' | 'error' }> {
  let stun: string[] = ['stun:stun.l.google.com:19302'];
  try {
    const raw = import.meta.env.VITE_STUN_SERVERS as string | undefined;
    if (raw) stun = JSON.parse(raw);
  } catch { /* оставляем значение по умолчанию */ }
  const servers: RTCIceServer[] = stun.length ? [{ urls: stun }] : [];
  if (import.meta.env.VITE_TURN_ENABLED !== 'true') return { servers, turn: 'none' };
  try {
    const { data, error } = await supabase.functions.invoke('turn-credentials');
    if (error || !data?.iceServers) throw error ?? new Error('no iceServers');
    return { servers: [...servers, ...(data.iceServers as RTCIceServer[])], turn: 'ok' };
  } catch {
    return { servers, turn: 'error' };
  }
}
