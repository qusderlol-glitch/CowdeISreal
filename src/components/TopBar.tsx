import { Link } from 'react-router-dom';
import type { Community } from '../lib/types';
import { publicMediaUrl } from '../lib/supabase';
import { BRAND } from '../lib/brand';
import { useSession } from '../state/session';
import { useUnread } from '../state/unread';
import { Avatar, Icon } from './ui';

// Верхняя панель: бренд, вкладки сообществ по названию, профиль.
export default function TopBar({ communities, active, onAdd, onUser }: { communities: Community[]; active?: string; onAdd: () => void; onUser: () => void }) {
  const { profile } = useSession();
  const { byCommunity } = useUnread();
  return (
    <header className="topbar">
      <Link to="/app" className="brand" aria-label="Главная"><Icon name="sprout" size={24} /><span>{BRAND.short}</span></Link>
      <nav className="community-tabs" aria-label="Сообщества">
        {communities.map((c) => {
          const u = byCommunity.get(c.id);
          const icon = publicMediaUrl(c.icon_path);
          return (
            <Link key={c.id} to={`/app/${c.id}`} className={`ctab ${active === c.id ? 'active' : ''} ${u?.unread ? 'unread' : ''}`}
              style={{ ['--c' as string]: c.accent_color }} aria-current={active === c.id ? 'page' : undefined}
              aria-label={`${c.name}${u?.unread ? `, непрочитанных: ${u.unread}` : ''}`}>
              {icon ? <img src={icon} alt="" /> : <i className="ctab-dot" />}
              <span>{c.name}</span>
              {!!u?.mentions && <b className="badge">{u.mentions > 99 ? '99+' : u.mentions}</b>}
            </Link>
          );
        })}
        <button className="ctab add" onClick={onAdd} aria-label="Создать или вступить"><Icon name="plus" size={16} /><span>Сообщество</span></button>
      </nav>
      <button className="me-chip" onClick={onUser} aria-label="Настройки пользователя">
        <span className="me-name">{profile?.display_name}</span>
        <Avatar name={profile?.display_name ?? '?'} path={profile?.avatar_path} size={34} />
      </button>
    </header>
  );
}
