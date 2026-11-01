import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { rpc, supabase } from '../lib/supabase';
import type { Message } from '../lib/types';
import { useSession } from './session';
import { inQuietHours, playSound } from '../lib/sound';

interface Row { channel_id: string; community_id: string; unread: number; mentions: number }
interface Ctx { byChannel: Map<string, Row>; byCommunity: Map<string, { unread: number; mentions: number }>; refresh: () => void; setActive: (ch: string | null) => void }
const UnreadCtx = createContext<Ctx>(null as unknown as Ctx);

export function UnreadProvider({ children }: { children: ReactNode }) {
  const { uid, settings } = useSession();
  const [rows, setRows] = useState<Row[]>([]);
  const active = useRef<string | null>(null);
  const timer = useRef(0);
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const flash = useRef(0);

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
      const viewing = !document.hidden && active.current === msg.channel_id;
      if (viewing) return;
      if (!document.hidden && !s.notifyWhenFocused) { if (mentioned) playSound(s); return; }
      if (s.notifyMentionsOnly && !mentioned) return;
      if (inQuietHours(s)) return;
      playSound(s);
      if (mentioned && s.flashTitle && document.hidden) flash.current = 6;
      if (s.notifyDesktop && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(mentioned ? 'Вас упомянули' : 'Новое сообщение', { body: s.notificationPreview ? msg.content.slice(0, 140) || 'Вложение' : 'Откройте приложение, чтобы прочитать', tag: String(msg.channel_id) });
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
  // счётчик непрочитанного во вкладке браузера и мигание при упоминании
  const totalUnread = rows.reduce((n, r) => n + (r.channel_id === active.current ? 0 : r.unread), 0);
  useEffect(() => {
    const base = 'CowdeISreal';
    const iv = window.setInterval(() => {
      const st = settingsRef.current;
      if (flash.current > 0 && document.hidden) { flash.current--; document.title = flash.current % 2 ? '🔔 Вас упомянули' : base; return; }
      flash.current = 0;
      document.title = st.titleBadge && totalUnread > 0 ? `(${totalUnread > 99 ? '99+' : totalUnread}) ${base}` : base;
    }, 1000);
    return () => window.clearInterval(iv);
  }, [totalUnread]);
  return <UnreadCtx.Provider value={{ byChannel, byCommunity, refresh, setActive }}>{children}</UnreadCtx.Provider>;
}
export const useUnread = () => useContext(UnreadCtx);
