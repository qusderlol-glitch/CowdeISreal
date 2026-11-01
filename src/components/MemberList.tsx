import { useState } from 'react';
import { useCommunity, type MemberView } from '../state/community';
import { levelFromXp } from '../lib/xp';
import { Avatar, Icon } from './ui';
import ProfileModal from './ProfileModal';

export default function MemberList({ onClose }: { onClose: () => void }) {
  const { data, online } = useCommunity();
  const [open, setOpen] = useState<string | null>(null);
  if (!data) return null;
  const groups = new Map<string, { title: string; color?: string; items: MemberView[] }>();
  const sorted = [...data.members].sort((a, b) => (b.top?.position ?? 0) - (a.top?.position ?? 0) || (a.nickname || a.profile.display_name).localeCompare(b.nickname || b.profile.display_name));
  for (const m of sorted) {
    const isOnline = online.has(m.user_id);
    const key = !isOnline ? 'offline' : m.top?.id ?? 'online';
    if (!groups.has(key)) groups.set(key, { title: !isOnline ? 'Не в сети' : m.top?.name ?? 'В сети', color: isOnline ? m.top?.color : undefined, items: [] });
    groups.get(key)!.items.push(m);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => (a === 'offline' ? 1 : 0) - (b === 'offline' ? 1 : 0));
  return (
    <>
    <div className="scrim" onClick={onClose} />
    <aside className="people-drawer" aria-label="Люди">
      <header className="drawer-head"><h3>Люди · {data.members.length}</h3><button className="icon-btn" onClick={onClose} aria-label="Закрыть"><Icon name="x" /></button></header>
      {ordered.map(([k, g]) => (
        <section key={k}>
          <h4 className="group">{g.title} — {g.items.length}</h4>
          <ul>{g.items.map((m) => (
            <li key={m.user_id}>
              <button className={`member ${online.has(m.user_id) ? '' : 'offline'}`} onClick={() => setOpen(m.user_id)}>
                <Avatar name={m.profile.display_name} path={m.profile.avatar_path} size={32} ring={online.has(m.user_id) ? 'online' : null} />
                <span className="member-name" style={{ color: m.top?.color }}>{m.nickname || m.profile.display_name}</span>
                {data.community.owner_id === m.user_id && <Icon name="crown" size={14} title="Владелец" />}
                {data.community.xp_enabled && <small className="lvl" title={`${m.xp} XP`}>ур. {levelFromXp(m.xp)}</small>}
                {m.tagIds.slice(0, 2).map((t) => { const tag = data.tags.find((x) => x.id === t); return tag && <span key={t} className="tag-dot" style={{ background: tag.color }} title={tag.name} />; })}
              </button>
            </li>
          ))}</ul>
        </section>
      ))}
      {open && <ProfileModal userId={open} onClose={() => setOpen(null)} />}
    </aside>
    </>
  );
}
