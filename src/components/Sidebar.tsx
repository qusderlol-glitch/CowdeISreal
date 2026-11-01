import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { q, rpc, supabase } from '../lib/supabase';
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
const MANAGE_ANY = PERM.MANAGE_CHANNELS | PERM.MANAGE_ROLES | PERM.MANAGE_MEMBERS | PERM.MODERATE | PERM.MANAGE_TAGS | PERM.MANAGE_COMMUNITY | PERM.CREATE_INVITES;

export default function Sidebar({ activeChannel, onOpenSettings, onOpenRanks, onUser, onPick }:
  { activeChannel?: string; onOpenSettings: () => void; onOpenRanks: () => void; onUser: () => void; onPick: () => void }) {
  const { data, displayName, memberById } = useCommunity();
  const { uid } = useSession();
  const { byChannel } = useUnread();
  const call = useCall();
  const toast = useToast();
  const nav = useNavigate();
  const [menu, setMenu] = useState(false);
  const [invite, setInvite] = useState(false);
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    q<{ channel_id: string }[]>(supabase.from('channel_favorites').select('channel_id')).then((r) => setFavs(new Set(r.map((x) => x.channel_id)))).catch(() => {});
  }, []);
  if (!data) return null;
  const { community, categories, channels, perms, voice } = data;

  const leave = async () => {
    if (!confirm(`Выйти из сообщества «${community.name}»?`)) return;
    try { if (call.communityId === community.id) await call.leave(); await rpc('leave_community', { p_id: community.id }); nav('/app'); }
    catch (e) { toast.fail(e); }
  };

  const item = (c: Channel) => {
    const u = byChannel.get(c.id);
    const inRoom = voice.filter((v) => v.channel_id === c.id);
    const onClick = () => { onPick(); if (c.kind === 'voice' && call.channelId !== c.id && has(data.channelPerms.get(c.id), PERM.CONNECT_VOICE)) void call.join(c); };
    return (
      <li key={c.id}>
        <Link to={`/app/${community.id}/${c.id}`} onClick={onClick}
          className={`channel ${activeChannel === c.id ? 'active' : ''} ${u?.unread && activeChannel !== c.id ? 'unread' : ''}`}
          aria-current={activeChannel === c.id ? 'page' : undefined}>
          <Icon name={KIND_ICON[c.kind]} size={17} />
          <span className="ch-name">{c.name}</span>
          {favs.has(c.id) && <Icon name="star" size={12} title="В избранном" />}
          {!!u?.mentions && activeChannel !== c.id && <b className="badge">{u.mentions}</b>}
        </Link>
        {inRoom.length > 0 && (
          <ul className="voice-people">
            {inRoom.map((v) => (
              <li key={v.user_id} className={call.speaking.has(v.user_id) ? 'speaking' : ''}>
                <Avatar name={displayName(v.user_id)} path={memberById(v.user_id)?.profile.avatar_path} size={20} ring={call.speaking.has(v.user_id) ? 'speaking' : null} />
                <span>{displayName(v.user_id)}</span>
                {v.screen && <Icon name="screen" size={13} title="Показывает экран" />}
                {v.video && <Icon name="camera" size={13} title="Камера" />}
                {v.muted && <Icon name="micOff" size={13} title="Микрофон выключен" />}
                {v.deafened && <Icon name="headphonesOff" size={13} title="Звук выключен" />}
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  };

  const favChannels = channels.filter((c) => favs.has(c.id));
  const uncategorized = channels.filter((c) => !c.category_id);

  return (
    <aside className="sidebar">
      <header className="side-head">
        <button className="side-title" onClick={() => setMenu((v) => !v)} aria-expanded={menu}>
          <span>{community.name}</span><Icon name="chevron" />
        </button>
        {menu && (
          <div className="menu" onMouseLeave={() => setMenu(false)}>
            {has(perms, PERM.CREATE_INVITES) && <button onClick={() => { setInvite(true); setMenu(false); }}><Icon name="link" /> Пригласить</button>}
            <button onClick={() => { onOpenRanks(); setMenu(false); }}><Icon name="trophy" /> Ранги и лидеры</button>
            {(perms & MANAGE_ANY) !== 0 && <button onClick={() => { onOpenSettings(); setMenu(false); }}><Icon name="settings" /> Настройки сообщества</button>}
            {community.owner_id !== uid && <button className="danger" onClick={leave}><Icon name="logout" /> Покинуть</button>}
          </div>
        )}
      </header>
      <div className="channel-scroll">
        {favChannels.length > 0 && <section><h4 className="cat">Избранное</h4><ul>{favChannels.map(item)}</ul></section>}
        {uncategorized.length > 0 && <ul>{uncategorized.map(item)}</ul>}
        {categories.map((cat) => {
          const list = channels.filter((c) => c.category_id === cat.id);
          if (!list.length && !has(perms, PERM.MANAGE_CHANNELS)) return null;
          const closed = collapsed.has(cat.id);
          return (
            <section key={cat.id}>
              <button className="cat" aria-expanded={!closed} onClick={() => setCollapsed((s) => { const n = new Set(s); if (closed) n.delete(cat.id); else n.add(cat.id); return n; })}>
                <Icon name="chevron" size={12} /> {cat.name}
              </button>
              {!closed && <ul>{list.map(item)}</ul>}
            </section>
          );
        })}
      </div>
      <CallPanel />
      <UserPanel onUser={onUser} />
      {invite && <Modal title={`Пригласить в «${community.name}»`} onClose={() => setInvite(false)}><InviteCreator cid={community.id} /></Modal>}
    </aside>
  );
}

function CallPanel() {
  const call = useCall();
  if (!call.channelId) return null;
  const label = call.status === 'joining' ? 'Подключение…' : call.status === 'failed' ? 'Ошибка подключения' : 'Голос подключён';
  return (
    <div className={`call-panel ${call.status}`}>
      <div className="call-info">
        <b>{label}</b>
        <span className="muted">{call.channelName}{call.screen ? ' · вы показываете экран' : ''}</span>
        {call.error && <span className="err-text">{call.error}</span>}
      </div>
      <div className="call-actions">
        {call.screen && <button className="icon-btn live" onClick={call.toggleScreen} title="Остановить показ экрана"><Icon name="screen" /></button>}
        <button className="icon-btn danger" onClick={() => call.leave()} title="Отключиться" aria-label="Отключиться"><Icon name="phoneOff" /></button>
      </div>
    </div>
  );
}

function UserPanel({ onUser }: { onUser: () => void }) {
  const { profile } = useSession();
  const call = useCall();
  if (!profile) return null;
  return (
    <div className="user-panel">
      <button className="user-chip" onClick={onUser}>
        <Avatar name={profile.display_name} path={profile.avatar_path} size={32} ring={call.speaking.has(profile.id) ? 'speaking' : null} />
        <span><b>{profile.display_name}</b><small>@{profile.handle}</small></span>
      </button>
      {call.channelId && <>
        <button className={`icon-btn ${call.mic ? 'live' : ''}`} onClick={call.toggleMic} aria-pressed={!!call.mic} title={call.mic ? 'Выключить микрофон' : 'Включить микрофон'}>
          <Icon name={call.mic ? 'mic' : 'micOff'} />
        </button>
        <button className={`icon-btn ${call.deafened ? 'warn' : ''}`} onClick={call.toggleDeafen} aria-pressed={call.deafened} title={call.deafened ? 'Включить звук' : 'Выключить звук'}>
          <Icon name={call.deafened ? 'headphonesOff' : 'headphones'} />
        </button>
      </>}
      <button className="icon-btn" onClick={onUser} title="Настройки" aria-label="Настройки"><Icon name="settings" /></button>
    </div>
  );
}
