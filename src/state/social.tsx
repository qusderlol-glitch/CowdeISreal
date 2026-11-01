import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { rpc, supabase } from '../lib/supabase';
import type { DirectMessage, FriendRequest } from '../lib/types';
import { useSession } from './session';
import { useToast } from './toast';
import { inQuietHours, playSound } from '../lib/sound';

interface Ctx { incoming: number; unreadDms: number; version: number; refresh: () => void; setActiveThread: (id: string | null) => void }
const SocialCtx = createContext<Ctx>({ incoming: 0, unreadDms: 0, version: 0, refresh: () => {}, setActiveThread: () => {} });

// Счётчики «Друзей»: входящие заявки и непрочитанные ЛС; обновляются через Realtime (с RLS) и при фокусе вкладки.
export function SocialProvider({ children }: { children: ReactNode }) {
  const { uid, settings } = useSession();
  const toast = useToast();
  const [counts, setCounts] = useState({ incoming: 0, unreadDms: 0 });
  const [version, setVersion] = useState(0);
  const timer = useRef(0);
  const active = useRef<string | null>(null);
  const settingsRef = useRef(settings); settingsRef.current = settings;

  const refresh = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      rpc<{ incoming: number; unread_dms: number }>('social_counts')
        .then((c) => setCounts({ incoming: Number(c.incoming), unreadDms: Number(c.unread_dms) })).catch(() => {});
      setVersion((v) => v + 1);
    }, 300);
  }, []);

  useEffect(() => {
    if (!uid) return;
    refresh();
    const notify = (title: string, body: string) => {
      const s = settingsRef.current;
      if (inQuietHours(s) || (!document.hidden && !s.notifyWhenFocused)) return;
      playSound(s);
      if (s.notifyDesktop && 'Notification' in window && Notification.permission === 'granted') new Notification(title, { body: s.notificationPreview ? body : 'Откройте приложение' });
    };
    const ch = supabase.channel(`social:${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friend_requests' }, ({ new: n, eventType }) => {
        refresh();
        const r = n as FriendRequest;
        if (eventType === 'INSERT' && r.to_id === uid && settingsRef.current.notifyFriendRequests) {
          toast.push('Новая заявка в друзья', 'info'); notify('Заявка в друзья', 'Откройте «Друзья», чтобы принять или отклонить');
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, refresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, ({ new: n }) => {
        const m = n as DirectMessage;
        if (m.author_id === uid) return;
        refresh();
        if (active.current !== m.thread_id && settingsRef.current.notifyDms) notify('Личное сообщение', m.content.slice(0, 140));
      })
      .subscribe();
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => { void supabase.removeChannel(ch); window.removeEventListener('focus', onFocus); };
  }, [uid, refresh, toast]);

  const setActiveThread = useCallback((id: string | null) => { active.current = id; }, []);
  return <SocialCtx.Provider value={{ ...counts, version, refresh, setActiveThread }}>{children}</SocialCtx.Provider>;
}
export const useSocial = () => useContext(SocialCtx);
