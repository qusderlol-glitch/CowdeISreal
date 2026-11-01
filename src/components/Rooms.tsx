import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { publicMediaUrl, q, rpc, supabase } from '../lib/supabase';
import { has, PERM } from '../lib/permissions';
import type { Channel } from '../lib/types';
import { useCommunity } from '../state/community';
import { useSession } from '../state/session';
import { useUnread } from '../state/unread';
import { useCall } from '../state/call';
import { useToast } from '../state/toast';
import { Avatar, Icon, Modal } from './ui';
import InviteCreator from './InviteCreator';

const KIND_ICON = { text: 'hash', voice: 'speaker', announcement: 'megaphone' } as const;
const KIND_LABEL = { text: 'беседа', voice: 'голос', announcement: 'объявления' } as const;
const MANAGE_ANY = PERM.MANAGE_CHANNELS | PERM.MANAGE_ROLES | PERM.MANAGE_MEMBERS | PERM.MODERATE | PERM.MANAGE_TAGS | PERM.MANAGE_COMMUNITY;

// Колонка «Комнаты»: карточка сообщества с действиями и список комнат-карточек.
export default function Rooms({ activeChannel, onOpenSettings, onOpenRanks, onOpenPeople, onPick }:
  { activeChannel?: string; onOpenSettings: () => void; onOpenRanks: () => void; onOpenPeople: () => void; onPick: () => void }) {
  const { data, displayName, memberById, online } = useCommunity();
  const { uid } = useSession();
  const { byChannel } = useUnread();
  const call = useCall();
  const toast = useToast();
  const nav = useNavigate();
  const [invite, setInvite] = useState(false);
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    q<{ channel_id: string }[]>(supabase.from('channel_favorites').select('channel_id')).then((r) => setFavs(new Set(r.map((x) => x.channel_id)))).catch(() => {});
  }, []);
  if (!data) return null;
  const { community, categories, channels, perms, voice } = data;
  const icon = publicMediaUrl(community.icon_path);

  const leave = async () => {
    if (!confirm(`Выйти из сообщества «${community.name}»?`)) return;
    try { if (call.communityId === community.id) await call.leave(); await rpc('leave_community', { p_id: community.id }); nav('/app'); }
    catch (e) { toast.fail(e); }
  };

  const room = (c: Channel) => {
    const u = byChannel.get(c.id);
    const inRoom = voice.filter((v) => v.channel_id === c.id);
    const onClick = () => { onPick(); if (c.kind === 'voice' && call.channelId !== c.id && has(data.channelPerms.get(c.id), PERM.CONNECT_VOICE)) void call.join(c); };
    return (
      <li key={c.id}>
        <Link to={`/app/${community.id}/${c.id}`} onClick={onClick}
          className={`room kind-${c.kind} ${activeChannel === c.id ? 'active' : ''} ${u?.unread && activeChannel !== c.id ? 'unread' : ''}`}
          aria-current={activeChannel === c.id ? 'page' : undefined}>
          <span className="room-icon"><Icon name={KIND_ICON[c.kind]} size={16} /></span>
          <span className="room-text"><span className="room-name">{c.name}</span>
            <small>{c.kind === 'voice' && inRoom.length ? `${inRoom.length} в комнате` : c.topic || KIND_LABEL[c.kind]}</small></span>
          {favs.has(c.id) && <Icon name="star" size={12} title="В избранном" />}
          {!!u?.mentions && activeChannel !== c.id ? <b className="badge">{u.mentions}</b> : u?.unread && activeChannel !== c.id ? <i className="unread-dot" aria-label="Есть новое" /> : null}
        </Link>
        {inRoom.length > 0 && (
          <div className="room-people">
            {inRoom.map((v) => (
              <span key={v.user_id} className={`person ${call.speaking.has(v.user_id) ? 'speaking' : ''}`} title={displayName(v.user_id)}>
                <Avatar name={displayName(v.user_id)} path={memberById(v.user_id)?.profile.avatar_path} size={24} ring={call.speaking.has(v.user_id) ? 'speaking' : null} />
                {v.screen && <Icon name="screen" size={11} title="Показывает экран" />}
                {v.muted && <Icon name="micOff" size={11} title="Микрофон выключен" />}
              </span>
            ))}
          </div>
        )}
      </li>
    );
  };

  const favChannels = channels.filter((c) => favs.has(c.id));
  const uncategorized = channels.filter((c) => !c.category_id);

  return (
    <aside className="rooms" aria-label="Комнаты">
      <section className="community-card" style={{ ['--c' as string]: community.accent_color }}>
        <div className="community-id">
          <span className="community-icon">{icon ? <img src={icon} alt="" /> : community.name.slice(0, 1).toUpperCase()}</span>
          <div><h2>{community.name}</h2><small>{data.members.length} участн. · {online.size} в сети</small></div>
        </div>
        {community.description && <p className="community-desc">{community.description}</p>}
        <div className="community-actions">
          {has(perms, PERM.CREATE_INVITES) && <button className="chip-btn" onClick={() => setInvite(true)}><Icon name="link" size={14} /> Пригласить</button>}
          <button className="chip-btn" onClick={onOpenPeople}><Icon name="users" size={14} /> Люди</button>
          <button className="chip-btn" onClick={onOpenRanks}><Icon name="trophy" size={14} /> Ранги</button>
          {(perms & MANAGE_ANY) !== 0 && <button className="chip-btn" onClick={onOpenSettings}><Icon name="settings" size={14} /> Настройки сообщества</button>}
          {community.owner_id !== uid && <button className="chip-btn danger" onClick={leave}><Icon name="logout" size={14} /> Покинуть</button>}
        </div>
      </section>
      <div className="rooms-scroll">
        {favChannels.length > 0 && <section><h3 className="group">★ Избранное</h3><ul>{favChannels.map(room)}</ul></section>}
        {uncategorized.length > 0 && <ul>{uncategorized.map(room)}</ul>}
        {categories.map((cat) => {
          const list = channels.filter((c) => c.category_id === cat.id);
          if (!list.length && !has(perms, PERM.MANAGE_CHANNELS)) return null;
          const closed = collapsed.has(cat.id);
          return (
            <section key={cat.id}>
              <button className="group" aria-expanded={!closed} onClick={() => setCollapsed((s) => { const n = new Set(s); if (closed) n.delete(cat.id); else n.add(cat.id); return n; })}>
                {cat.name} <Icon name="chevron" size={12} />
              </button>
              {!closed && <ul>{list.map(room)}</ul>}
            </section>
          );
        })}
      </div>
      {invite && <Modal title={`Пригласить в «${community.name}»`} onClose={() => setInvite(false)}><InviteCreator cid={community.id} /></Modal>}
    </aside>
  );
}
