import { useEffect, useRef, useState } from 'react';
import { rpc } from '../lib/supabase';
import type { UserHit } from '../lib/types';
import { useToast } from '../state/toast';
import { useSocial } from '../state/social';
import { Avatar, Icon } from './ui';

// Поиск по handle или имени: подсказки появляются по мере ввода и терпят опечатки («Возможно, вы имели в виду…»).
export default function UserSearch({ onOpenProfile, onWrite }: { onOpenProfile: (id: string) => void; onWrite: (id: string) => void }) {
  const toast = useToast();
  const { refresh } = useSocial();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<UserHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const run = async (query: string) => {
    const my = ++seq.current;
    const clean = query.trim().replace(/^@+/, '');
    if (clean.length < 2) { setHits(null); return; }
    setBusy(true);
    try { const r = await rpc<UserHit[]>('search_users', { p_query: clean }); if (my === seq.current) setHits(r); }
    catch (e) { if (my === seq.current) { setHits([]); toast.fail(e); } }
    finally { if (my === seq.current) setBusy(false); }
  };
  useEffect(() => { const t = setTimeout(() => void run(q), 250); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (h: UserHit) => {
    try {
      if (h.relation === 'friend') { onWrite(h.id); return; }
      const res = await rpc<string>('send_friend_request', { p_user: h.id, p_source: 'search' });
      toast.push(res === 'accepted' ? `Вы и @${h.handle} теперь друзья` : res === 'already_friends' ? 'Вы уже друзья' : 'Заявка отправлена. Дружба начнётся, когда её примут.', 'ok');
      refresh(); void run(q);
    } catch (e) { toast.fail(e); }
  };

  const clean = q.trim().replace(/^@+/, '').toLowerCase();
  const exact = hits?.find((h) => h.exact);
  const label = (h: UserHit) => ({ friend: 'Написать', outgoing: 'Заявка отправлена', incoming: 'Принять заявку', none: 'Добавить', self: '' }[h.relation]);

  return (
    <div className="user-search">
      <label className="search-box">
        <Icon name="search" size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти по @handle или имени" aria-label="Поиск людей" autoComplete="off" spellCheck={false} />
        {busy && <span className="spinner" />}
      </label>
      {hits && (
        <div className="search-results" role="listbox" aria-label="Найденные люди">
          {!hits.length ? <p className="muted small pad-s">Никого не нашли. Проверьте handle: возможно, человек скрыл себя из поиска или ещё не зарегистрирован.</p> : <>
            <p className="muted small pad-s">{exact ? 'Найдено:' : clean.length >= 3 ? `Точного совпадения с «${clean}» нет. Возможно, вы имели в виду:` : 'Подсказки:'}</p>
            <ul>{hits.map((h) => (
              <li key={h.id} className={h.exact ? 'exact' : ''}>
                <button className="hit-main" onClick={() => onOpenProfile(h.id)}>
                  <Avatar name={h.display_name} path={h.avatar_path} size={36} frame={h.avatar_frame} />
                  <span><b>{h.display_name} {h.profile_emoji}</b><small>@{h.handle}</small></span>
                </button>
                <button className={`btn small ${h.relation === 'none' || h.relation === 'incoming' ? 'primary' : ''}`} disabled={h.relation === 'outgoing'} onClick={() => act(h)}>
                  <Icon name={h.relation === 'friend' ? 'chat' : h.relation === 'outgoing' ? 'check' : 'userPlus'} size={14} /> {label(h)}
                </button>
              </li>
            ))}</ul>
          </>}
        </div>
      )}
    </div>
  );
}
