import { useEffect, useState } from 'react';
import { rpc } from '../lib/supabase';
import { levelProgress } from '../lib/xp';
import { useCommunity } from '../state/community';
import { useSession } from '../state/session';
import { Avatar, Empty, ErrorBox, Modal, Spinner } from './ui';

export default function Leaderboard({ onClose }: { onClose: () => void }) {
  const { data, displayName, memberById } = useCommunity();
  const { uid } = useSession();
  const [rows, setRows] = useState<{ user_id: string; xp: number; level: number; place: number }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (data) rpc<typeof rows>('get_leaderboard', { p_community: data.community.id, p_limit: 50 }).then(setRows).catch((e) => setErr(e.message)); }, [data]);
  if (!data) return null;
  const c = data.community;
  const me = data.members.find((m) => m.user_id === uid);
  const p = me ? levelProgress(me.xp) : null;
  return (
    <Modal title="Ранги и лидеры" onClose={onClose}>
      {!c.xp_enabled ? <Empty icon="trophy" title="Ранги выключены">Владелец сообщества отключил систему опыта.</Empty> : <>
        {p && <div className="my-rank"><b>Ваш уровень: {p.level}</b> · {me!.xp} XP<span className="bar"><span style={{ width: `${Math.round(p.ratio * 100)}%` }} /></span>
          <small className="muted">До уровня {p.level + 1}: {p.span - p.into} XP</small></div>}
        <p className="muted small">Опыт начисляет сервер: {c.xp_per_message} XP за содержательное сообщение (от {c.xp_min_length} символов), не чаще раза в {c.xp_cooldown_seconds} с,
          максимум {c.xp_daily_cap} XP в сутки. Повторы и команды не учитываются. Ранги не дают прав и не продаются.</p>
        {err ? <ErrorBox error={err} /> : !rows ? <Spinner /> : (
          <ol className="leaderboard">{rows.map((r) => (
            <li key={r.user_id} className={r.user_id === uid ? 'me' : ''}>
              <span className="place">{r.place}</span>
              <Avatar name={displayName(r.user_id)} path={memberById(r.user_id)?.profile.avatar_path} size={28} />
              <span className="grow">{displayName(r.user_id)}</span>
              <span>ур. {r.level}</span><small className="muted">{r.xp} XP</small>
            </li>
          ))}</ol>
        )}
      </>}
    </Modal>
  );
}
