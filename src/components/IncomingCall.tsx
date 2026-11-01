import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocial } from '../state/social';
import { useCall } from '../state/call';
import { useSession } from '../state/session';
import { playSound, inQuietHours } from '../lib/sound';
import { Avatar, Icon } from './ui';

// Входящий звонок от друга: всплывает на любом экране приложения.
export default function IncomingCall() {
  const { threads } = useSocial();
  const call = useCall();
  const { settings } = useSession();
  const nav = useNavigate();
  const [declined, setDeclined] = useState<Set<string>>(new Set());
  const ringing = useMemo(() => (threads ?? []).find((t) => t.call_active && t.is_friend && !declined.has(t.thread_id)
    && !(call.kind === 'dm' && call.channelId === t.thread_id)), [threads, declined, call.kind, call.channelId]);

  // звонок закончился — забываем отказ, чтобы следующий звонок снова зазвонил
  useEffect(() => {
    const active = new Set((threads ?? []).filter((t) => t.call_active).map((t) => t.thread_id));
    setDeclined((d) => { const n = new Set([...d].filter((id) => active.has(id))); return n.size === d.size ? d : n; });
  }, [threads]);
  useEffect(() => {
    if (!ringing || inQuietHours(settings)) return;
    playSound(settings);
    const iv = window.setInterval(() => playSound(settings), 2500);
    return () => window.clearInterval(iv);
  }, [ringing, settings]);

  if (!ringing) return null;
  return (
    <div className="incoming-call" role="alertdialog" aria-label={`Входящий звонок от ${ringing.display_name}`}>
      <Avatar name={ringing.display_name} path={ringing.avatar_path} size={56} frame={ringing.avatar_frame} />
      <div className="grow"><b>{ringing.display_name}</b><small>Входящий звонок</small></div>
      <button className="round-icon danger" title="Отклонить" aria-label="Отклонить" onClick={() => setDeclined((d) => new Set(d).add(ringing.thread_id))}><Icon name="phoneOff" size={20} /></button>
      <button className="round-icon call big" title="Принять" aria-label="Принять" onClick={() => {
        nav(`/app/friends/${ringing.thread_id}`);
        void call.join({ target: 'dm', id: ringing.thread_id, name: ringing.display_name, otherId: ringing.other_id });
      }}><Icon name="phone" size={20} /></button>
    </div>
  );
}
