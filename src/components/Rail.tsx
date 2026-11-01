import { Link } from 'react-router-dom';
import type { Community } from '../lib/types';
import { publicMediaUrl } from '../lib/supabase';
import { useSession } from '../state/session';
import { useUnread } from '../state/unread';
import { Avatar, Icon } from './ui';

export default function Rail({ communities, active, onAdd, onUser }: { communities: Community[]; active?: string; onAdd: () => void; onUser: () => void }) {
  const { profile } = useSession();
  const { byCommunity } = useUnread();
  return (
    <nav className="rail" aria-label="Сообщества">
      <Link to="/app" className={`rail-item home ${!active ? 'active' : ''}`} title="Главная"><Icon name="sprout" size={26} /></Link>
      <div className="rail-sep" />
      <div className="rail-list">
        {communities.map((c) => {
          const u = byCommunity.get(c.id);
          const icon = publicMediaUrl(c.icon_path);
          return (
            <Link key={c.id} to={`/app/${c.id}`} className={`rail-item ${active === c.id ? 'active' : ''} ${u?.unread ? 'unread' : ''}`} title={c.name}
              style={{ ['--c' as string]: c.accent_color }} aria-label={`${c.name}${u?.unread ? `, непрочитанных: ${u.unread}` : ''}`}>
              {icon ? <img src={icon} alt="" /> : <span>{c.name.slice(0, 2).toUpperCase()}</span>}
              {!!u?.mentions && <b className="badge">{u.mentions > 99 ? '99+' : u.mentions}</b>}
            </Link>
          );
        })}
      </div>
      <button className="rail-item add" onClick={onAdd} title="Создать или вступить" aria-label="Создать или вступить"><Icon name="plus" size={22} /></button>
      <button className="rail-item me" onClick={onUser} title="Настройки" aria-label="Настройки пользователя">
        <Avatar name={profile?.display_name ?? '?'} path={profile?.avatar_path} size={40} />
      </button>
    </nav>
  );
}
