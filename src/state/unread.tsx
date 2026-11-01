import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { rpc, supabase } from '../lib/supabase';
import type { Message } from '../lib/types';
import { useSession } from './session';

interface Row { channel_id: string; community_id: string; unread: number; mentions: number }
interface Ctx { byChannel: Map<string, Row>; byCommunity: Map<string, { unread: number; mentions: number }>; refresh: () => void; setActive: (ch: string | null) => void }
const UnreadCtx = createContext<Ctx>(null as unknown as Ctx);

function beep() {
  try {
    const ac = new AudioContext(); const o = ac.createOscillator(); const g = ac.createGain();
    o.frequency.value = 660; g.gain.value = 0.04; o.connect(g); g.connect(ac.destination);
    o.start(); o.stop(ac.currentTime + 0.12); o.onended = () => void ac.close();
  } catch { /* звук недоступен */ }
}

export function UnreadProvider({ children }: { children: ReactNode }) {
  const { uid, settings } = useSession();
  const [rows, setRows] = useState<Row[]>([]);
  const active = useRef<string | null>(null);
  const timer = useRef(0);
  const settingsRef = useRef(settings); settingsRef.current = settings;

  const refresh = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { rpc<Row[]>('unread_summary').then(setRows).catch(() => {}); }, 400);
  }, []);

  useEffect(() => {
    if (!uid) return;
    refresh();
    const ch = supabase.channel(`inbox:${uid}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: m }) => {
      const msg = m as Message;
      if (msg.author_id === uid) return;
      refresh();
      const s = settingsRef.current;
      const mentioned = msg.mentions?.includes(uid);
      const visible = !document.hidden && active.current === msg.channel_id;
      if (visible || (s.notifyMentionsOnly && !mentioned)) return;
      if (s.notifySound) beep();
      if (s.notifyDesktop && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(mentioned ? 'Вас упомянули' : 'Новое сообщение', { body: msg.content.slice(0, 140) || 'Вложение', tag: String(msg.channel_id) });
      }
    }).subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [uid, refresh]);

  const byChannel = new Map(rows.map((r) => [r.channel_id, r]));
  const byCommunity = new Map<string, { unread: number; mentions: number }>();
  for (const r of rows) {
    if (r.channel_id === active.current) continue;
    const c = byCommunity.get(r.community_id) ?? { unread: 0, mentions: 0 };
    c.unread += r.unread; c.mentions += r.mentions; byCommunity.set(r.community_id, c);
  }
  const setActive = useCallback((id: string | null) => { active.current = id; }, []);
  return <UnreadCtx.Provider value={{ byChannel, byCommunity, refresh, setActive }}>{children}</UnreadCtx.Provider>;
}
export const useUnread = () => useContext(UnreadCtx);
