import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { q, rpc, supabase } from '../lib/supabase';
import type { DirectMessage, DmThread, FriendRequest } from '../lib/types';
import { fmtClock } from '../lib/timefmt';
import { useSession } from '../state/session';
import { useSocial } from '../state/social';
import { useCall } from '../state/call';
import { useToast } from '../state/toast';
import { Avatar, Empty, ErrorBox, Icon, Spinner } from './ui';
import UserSearch from './UserSearch';
import UserCard from './UserCard';
import RichText from './RichText';
import { CallStatusBanner, CallVideo } from './CallParts';

type Tab = 'all' | 'requests' | 'add' | 'blocked';
interface Friend { user_id: string; handle: string; display_name: string; avatar_path: string | null; avatar_frame: string; profile_emoji: string; since: string }
const REQ_SELECT = 'id, from_id, to_id, status, source, created_at, from:profiles!friend_requests_from_id_fkey(id, handle, display_name, avatar_path, avatar_frame), to:profiles!friend_requests_to_id_fkey(id, handle, display_name, avatar_path, avatar_frame)';

// «Друзья»: слева — диалоги, справа — друзья с вкладками (как привычно в мессенджерах), или открытый диалог.
export default function FriendsView({ threadId }: { threadId?: string }) {
  const { uid, settings: s } = useSession();
  const { incoming, version, refresh, threads: liveThreads } = useSocial();
  const call = useCall();
  const toast = useToast();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('all');
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [reqs, setReqs] = useState<FriendRequest[] | null>(null);
  const [blocks, setBlocks] = useState<Friend[] | null>(null);
  const [threads, setThreads] = useState<DmThread[] | null>(null);
  const [card, setCard] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [menu, setMenu] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [f, r, b, t] = await Promise.all([
        rpc<Friend[]>('my_friends'),
        q<FriendRequest[]>(supabase.from('friend_requests').select(REQ_SELECT).eq('status', 'pending').order('created_at', { ascending: false })),
        rpc<Friend[]>('my_blocks'),
        rpc<DmThread[]>('dm_threads'),
      ]);
      setFriends(f); setReqs(r); setBlocks(b); setThreads(t); setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load, version]);
  useEffect(() => { if (liveThreads) setThreads(liveThreads); }, [liveThreads]);

  const openDm = async (userId: string) => {
    try { const id = await rpc<string>('open_dm', { p_user: userId }); setCard(null); nav(`/app/friends/${id}`); return id; } catch (e) { toast.fail(e); return null; }
  };
  const callFriend = async (f: { user_id: string; display_name: string }) => {
    const id = await openDm(f.user_id);
    if (id) void call.join({ target: 'dm', id, name: f.display_name, otherId: f.user_id });
  };
  const act = async (fn: string, args: Record<string, unknown>, ok: string) => {
    try { await rpc(fn, args); toast.push(ok, 'ok'); refresh(); await load(); } catch (e) { toast.fail(e); }
  };

  const fl = filter.trim().toLowerCase();
  const match = (name: string, handle: string) => !fl || name.toLowerCase().includes(fl) || handle.toLowerCase().includes(fl);
  const incomingReqs = reqs?.filter((r) => r.to_id === uid) ?? [];
  const outgoingReqs = reqs?.filter((r) => r.from_id === uid) ?? [];
  const active = threads?.find((t) => t.thread_id === threadId);
  const inCall = useMemo(() => new Set((threads ?? []).filter((t) => t.call_active).map((t) => t.other_id)), [threads]);
  const sortedFriends = [...(friends ?? [])].sort((a, b) => s.friendsSort === 'recent' ? b.since.localeCompare(a.since) : a.display_name.localeCompare(b.display_name, 'ru'));

  return (
    <>
      <aside className="rooms friends-side" aria-label="Личные сообщения">
        <label className="search-box"><Icon name="search" size={16} />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Найти разговор или друга" aria-label="Найти разговор" /></label>
        <nav className="side-nav">
          <Link to="/app/friends" className={`room ${!threadId ? 'active' : ''}`}><span className="room-icon"><Icon name="users" size={16} /></span>
            <span className="room-text"><span className="room-name">Друзья</span></span>{incoming > 0 && <b className="badge">{incoming}</b>}</Link>
          <Link to="/app/discover" className="room"><span className="room-icon"><Icon name="compass" size={16} /></span>
            <span className="room-text"><span className="room-name">Знакомства</span></span></Link>
        </nav>
        <div className="rooms-scroll">
          <h3 className="group">Личные сообщения</h3>
          {!threads ? <Spinner /> : !threads.filter((t) => match(t.display_name, t.handle)).length
            ? <p className="muted small pad-s">{fl ? 'Ничего не нашлось.' : 'Диалогов нет. Нажмите «Написать» у друга.'}</p> : (
            <ul className="people-list threads">{threads.filter((t) => match(t.display_name, t.handle)).map((t) => (
              <li key={t.thread_id} className={t.thread_id === threadId ? 'active' : ''}>
                <button className="hit-main" onClick={() => nav(`/app/friends/${t.thread_id}`)}>
                  <Avatar name={t.display_name} path={t.avatar_path} size={34} frame={t.avatar_frame} />
                  <span><b>{t.display_name}</b>{t.call_active ? <small className="in-call"><Icon name="phone" size={12} /> в звонке</small> : <small>{t.last_content ?? 'Начните разговор'}</small>}</span>
                </button>
                {t.unread > 0 && <b className="badge">{t.unread}</b>}
              </li>
            ))}</ul>
          )}
        </div>
      </aside>
      <main className="main">
        <button className="back-to-rooms" onClick={() => nav('/app/friends')}><Icon name="arrowUp" size={14} /> Друзья</button>
        {threadId ? (active ? <DmView key={threadId} thread={active} onProfile={setCard} onChanged={load} />
          : threads ? <Empty icon="chat" title="Диалог недоступен">Возможно, вы больше не друзья или человек вас заблокировал.</Empty> : <Spinner />)
        : (
          <section className="friends-home">
            <header className="chat-head friends-tabs" role="tablist">
              <Icon name="users" /><h2>Друзья</h2>
              {([['all', 'Все'], ['requests', 'Заявки'], ['blocked', 'Заблокированные']] as [Tab, string][]).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={`tab-btn ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
                  {l}{k === 'requests' && incoming > 0 && <b className="badge">{incoming}</b>}</button>
              ))}
              <button role="tab" aria-selected={tab === 'add'} className={`tab-btn add-friend ${tab === 'add' ? 'active' : ''}`} onClick={() => setTab('add')}>Добавить друга</button>
            </header>
            <div className="friends-body">
              {err && <ErrorBox error={err} onRetry={load} />}
              {tab === 'all' && (!friends ? <Spinner /> : !friends.length ? (
                <Empty icon="users" title="Пока нет друзей">Откройте «Добавить друга» и найдите человека по @handle — даже с опечаткой подскажем. <button className="btn small primary" onClick={() => setTab('add')}>Добавить друга</button></Empty>
              ) : <>
                <p className="list-title">Все друзья — {friends.length}</p>
                <ul className="friend-rows">{sortedFriends.filter((f) => match(f.display_name, f.handle)).map((f) => (
                  <li key={f.user_id}>
                    <button className="hit-main" onClick={() => setCard(f.user_id)}>
                      <Avatar name={f.display_name} path={f.avatar_path} size={38} frame={f.avatar_frame} />
                      <span><b>{f.display_name} {s.profileEmoji && f.profile_emoji}</b>
                        {inCall.has(f.user_id) ? <small className="in-call"><Icon name="phone" size={12} /> в звонке</small> : <small>@{f.handle}</small>}</span>
                    </button>
                    <span className="row-btns">
                      <button className="round-icon" title="Написать" aria-label={`Написать ${f.display_name}`} onClick={() => openDm(f.user_id)}><Icon name="chat" size={18} /></button>
                      <button className="round-icon call" title="Позвонить" aria-label={`Позвонить ${f.display_name}`} onClick={() => callFriend(f)}><Icon name="phone" size={18} /></button>
                      <span className="menu-wrap">
                        <button className="round-icon" title="Ещё" aria-label={`Ещё: ${f.display_name}`} aria-expanded={menu === f.user_id} onClick={() => setMenu(menu === f.user_id ? null : f.user_id)}><Icon name="more" size={18} /></button>
                        {menu === f.user_id && <Menu onClose={() => setMenu(null)}>
                          <button onClick={() => { setMenu(null); setCard(f.user_id); }}>Профиль</button>
                          <button onClick={() => { setMenu(null); if (confirm(`Убрать @${f.handle} из друзей?`)) void act('remove_friend', { p_user: f.user_id }, 'Удалён из друзей'); }}>Убрать из друзей</button>
                          <button className="danger" onClick={() => { setMenu(null); if (confirm(`Заблокировать @${f.handle}?`)) void act('block_user', { p_user: f.user_id }, 'Заблокирован'); }}>Заблокировать</button>
                        </Menu>}
                      </span>
                    </span>
                  </li>
                ))}</ul>
              </>)}
              {tab === 'requests' && (!reqs ? <Spinner /> : <>
                <p className="list-title">Входящие — {incomingReqs.length}</p>
                {!incomingReqs.length ? <p className="muted small pad-s">Нет входящих заявок.</p> : <ul className="friend-rows">{incomingReqs.map((r) => (
                  <li key={r.id}>
                    <button className="hit-main" onClick={() => setCard(r.from_id)}><Avatar name={r.from?.display_name ?? '?'} path={r.from?.avatar_path} size={38} frame={r.from?.avatar_frame} />
                      <span><b>{r.from?.display_name}</b><small>@{r.from?.handle}{r.source === 'discovery' ? ' · из знакомств' : ''}</small></span></button>
                    <span className="row-btns">
                      <button className="round-icon call" title="Принять" aria-label="Принять" onClick={() => act('respond_friend_request', { p_id: r.id, p_accept: true }, 'Теперь вы друзья')}><Icon name="check" size={18} /></button>
                      <button className="round-icon danger" title="Отклонить" aria-label="Отклонить" onClick={() => act('respond_friend_request', { p_id: r.id, p_accept: false }, 'Заявка отклонена')}><Icon name="x" size={18} /></button>
                    </span>
                  </li>
                ))}</ul>}
                <p className="list-title">Исходящие — {outgoingReqs.length}</p>
                {!outgoingReqs.length ? <p className="muted small pad-s">Нет отправленных заявок.</p> : <ul className="friend-rows">{outgoingReqs.map((r) => (
                  <li key={r.id}>
                    <button className="hit-main" onClick={() => setCard(r.to_id)}><Avatar name={r.to?.display_name ?? '?'} path={r.to?.avatar_path} size={38} frame={r.to?.avatar_frame} />
                      <span><b>{r.to?.display_name}</b><small>@{r.to?.handle} · ждёт ответа</small></span></button>
                    <span className="row-btns"><button className="btn small" onClick={() => act('cancel_friend_request', { p_id: r.id }, 'Заявка отменена')}>Отменить</button></span>
                  </li>
                ))}</ul>}
              </>)}
              {tab === 'add' && (
                <div className="add-friend-pane">
                  <h3>Добавить друга</h3>
                  <p className="muted">Введите @handle или имя. Если ошибётесь в паре букв — подскажем, кого вы имели в виду. Дружба начнётся, когда человек примет заявку.</p>
                  <UserSearch onOpenProfile={setCard} onWrite={openDm} />
                </div>
              )}
              {tab === 'blocked' && (!blocks ? <Spinner /> : !blocks.length ? <p className="muted small pad-s">Вы никого не блокировали. Заблокированный не найдёт вас, не пришлёт заявку и не напишет.</p> : (
                <ul className="friend-rows">{blocks.map((b) => (
                  <li key={b.user_id}><span className="hit-main"><Avatar name={b.display_name} path={b.avatar_path} size={38} /><span><b>{b.display_name}</b><small>@{b.handle}</small></span></span>
                    <span className="row-btns"><button className="btn small" onClick={() => act('unblock_user', { p_user: b.user_id }, 'Разблокирован')}>Разблокировать</button></span></li>
                ))}</ul>
              ))}
            </div>
          </section>
        )}
      </main>
      {card && <UserCard userId={card} onClose={() => setCard(null)} onWrite={(id) => void openDm(id)} onChanged={() => { refresh(); void load(); }} />}
    </>
  );
}

function Menu({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const k = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    setTimeout(() => document.addEventListener('mousedown', h)); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [onClose]);
  return <div className="pop-menu" role="menu" ref={ref}>{children}</div>;
}

// Панель звонка в диалоге: «Звоним…», «Идёт звонок», входящий звонок, причина сбоя связи.
function DmCallBar({ thread }: { thread: DmThread }) {
  const call = useCall();
  const { profile } = useSession();
  const here = call.kind === 'dm' && call.channelId === thread.thread_id;
  const other = here ? call.participants.find((p) => p.userId === thread.other_id) : undefined;
  const [waited, setWaited] = useState(0);
  useEffect(() => {
    if (!here || other) { setWaited(0); return; }
    const iv = window.setInterval(() => setWaited((w) => w + 1), 1000);
    return () => window.clearInterval(iv);
  }, [here, other]);
  useEffect(() => { if (here && !other && waited >= 60) void call.leave(`${thread.display_name} не ответил(а)`); }, [waited, here, other, call, thread.display_name]);

  if (!here && !thread.call_active) return null;
  if (!here) {
    return (
      <div className="dm-callbar ringing">
        <Avatar name={thread.display_name} path={thread.avatar_path} size={44} />
        <span className="grow"><b>{thread.display_name} звонит</b><small>Нажмите, чтобы присоединиться</small></span>
        <button className="btn primary" onClick={() => call.join({ target: 'dm', id: thread.thread_id, name: thread.display_name, otherId: thread.other_id })}><Icon name="phone" size={16} /> Присоединиться</button>
      </div>
    );
  }
  const status = call.status === 'joining' ? 'Подключение…' : !other ? `Звоним… ${waited > 0 ? `${waited} с` : ''}`
    : other.state === 'connected' ? 'Идёт звонок' : other.state === 'failed' ? 'Нет связи' : 'Соединение…';
  return (
    <div className="dm-callbar">
      <div className="callbar-people">
        <span className={call.speaking.has(profile?.id ?? '') ? 'speaking' : ''}><Avatar name={profile?.display_name ?? 'Вы'} path={profile?.avatar_path} size={56} ring={call.speaking.has(profile?.id ?? '') ? 'speaking' : null} /></span>
        <span className={`${call.speaking.has(thread.other_id) ? 'speaking' : ''} ${other ? '' : 'waiting'}`}><Avatar name={thread.display_name} path={thread.avatar_path} size={56} ring={call.speaking.has(thread.other_id) ? 'speaking' : null} /></span>
      </div>
      <b className={`callbar-status ${other?.state === 'failed' ? 'err-text' : ''}`} aria-live="polite">{status}</b>
      {other && <CallStatusBanner p={other} turn={call.turn} />}
      {(other?.camera || other?.screen || call.camera) && <div className="callbar-video">
        {other?.screen && <CallVideo stream={other.screen} label={`Экран ${thread.display_name}`} />}
        {other?.camera && <CallVideo stream={other.camera} label={`Камера ${thread.display_name}`} />}
        {call.camera && <CallVideo stream={call.camera} label="Ваша камера" mirror />}
      </div>}
      <button className="btn danger small" onClick={() => call.leave()}><Icon name="phoneOff" size={16} /> Завершить</button>
    </div>
  );
}

function DmView({ thread, onProfile, onChanged }: { thread: DmThread; onProfile: (id: string) => void; onChanged: () => void }) {
  const { uid, settings } = useSession();
  const { setActiveThread, refresh } = useSocial();
  const call = useCall();
  const toast = useToast();
  const [msgs, setMsgs] = useState<DirectMessage[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  const markRead = useCallback((list: DirectMessage[]) => {
    const last = list.filter((m) => !m._tmp).at(-1);
    if (last && !document.hidden) void rpc('mark_dm_read', { p_thread: thread.thread_id, p_message: last.id }).then(refresh).catch(() => {});
  }, [thread.thread_id, refresh]);

  const loadMsgs = useCallback(() => q<DirectMessage[]>(supabase.from('direct_messages').select('*').eq('thread_id', thread.thread_id).order('id', { ascending: false }).limit(50))
    .then((r) => { const l = r.reverse(); setMsgs((cur) => [...l, ...(cur ?? []).filter((m) => m._tmp)]); setHasMore(r.length === 50); markRead(l); }).catch((e) => toast.fail(e)), [thread.thread_id, markRead, toast]);

  useEffect(() => {
    setActiveThread(thread.thread_id);
    void loadMsgs();
    const ch = supabase.channel(`dm:${thread.thread_id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `thread_id=eq.${thread.thread_id}` }, ({ new: n }) => {
        const m = n as DirectMessage;
        setMsgs((l) => { if (!l || l.some((x) => x.id === m.id)) return l; const next = [...l, m]; if (atBottom.current) markRead(next); return next; });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'direct_messages', filter: `thread_id=eq.${thread.thread_id}` }, ({ new: n }) => {
        const m = n as DirectMessage; setMsgs((l) => l?.map((x) => (x.id === m.id ? m : x)) ?? l);
      }).subscribe();
    return () => { setActiveThread(null); void supabase.removeChannel(ch); };
  }, [thread.thread_id, setActiveThread, markRead, loadMsgs]);
  // появилась запись о звонке — подтянуть историю (на случай, если Realtime недоступен)
  useEffect(() => { void loadMsgs(); }, [thread.call_active, loadMsgs]);

  useLayoutEffect(() => { const el = listRef.current; if (el && atBottom.current) el.scrollTop = el.scrollHeight; }, [msgs]);

  const older = async () => {
    const first = msgs?.find((m) => !m._tmp)?.id; if (!first) return;
    const r = await q<DirectMessage[]>(supabase.from('direct_messages').select('*').eq('thread_id', thread.thread_id).lt('id', first).order('id', { ascending: false }).limit(50)).catch(() => []);
    setMsgs((l) => [...r.reverse(), ...(l ?? [])]); setHasMore(r.length === 50);
  };
  const send = async () => {
    const t = text.trim(); if (!t || !uid) return;
    const tmp = `tmp-${Date.now()}`;
    atBottom.current = true;
    setMsgs((l) => [...(l ?? []), { id: Number.MAX_SAFE_INTEGER - (Date.now() % 1e9), thread_id: thread.thread_id, author_id: uid, content: t, created_at: new Date().toISOString(), edited_at: null, deleted_at: null, kind: 'user', _pending: true, _tmp: tmp }]);
    setText('');
    try {
      const id = await rpc<number>('send_dm', { p_thread: thread.thread_id, p_content: t });
      setMsgs((l) => (l ?? []).some((m) => m.id === id) ? (l ?? []).filter((m) => m._tmp !== tmp) : (l ?? []).map((m) => (m._tmp === tmp ? { ...m, id, _pending: false, _tmp: undefined } : m)));
      onChanged();
    } catch (e) { setMsgs((l) => (l ?? []).map((m) => (m._tmp === tmp ? { ...m, _pending: false, _failed: (e as Error).message } : m))); }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const enterSends = settings.enterToSend !== false;
    if (e.key === 'Enter' && !e.nativeEvent.isComposing && (enterSends ? !e.shiftKey : e.ctrlKey)) { e.preventDefault(); void send(); }
  };
  const inThisCall = call.kind === 'dm' && call.channelId === thread.thread_id;

  return (
    <section className="chat">
      <header className="chat-head">
        <button className="dm-head" onClick={() => onProfile(thread.other_id)}><Avatar name={thread.display_name} path={thread.avatar_path} size={32} frame={thread.avatar_frame} />
          <h2>{thread.display_name}</h2><span className="topic">@{thread.handle}</span></button>
        {!thread.is_friend && <span className="pill">не в друзьях — писать и звонить нельзя</span>}
        <div className="head-actions">
          {thread.is_friend && !inThisCall && <button className="icon-btn" title="Позвонить" aria-label="Позвонить"
            onClick={() => call.join({ target: 'dm', id: thread.thread_id, name: thread.display_name, otherId: thread.other_id })}><Icon name="phone" /></button>}
          <button className="icon-btn" title="Профиль" aria-label="Профиль" onClick={() => onProfile(thread.other_id)}><Icon name="users" /></button>
        </div>
      </header>
      <DmCallBar thread={thread} />
      <div className="chat-body">
        <div className="messages" ref={listRef} role="log" aria-label={`Диалог с ${thread.display_name}`}
          onScroll={() => { const el = listRef.current; if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
          {!msgs ? <Spinner /> : <>
            {hasMore && <button className="btn small ghost load-older" onClick={older}>Загрузить более ранние</button>}
            {!msgs.length && <Empty icon="chat" title={`Начало разговора с ${thread.display_name}`}>Личные сообщения видите только вы двое.</Empty>}
            {msgs.map((m, i) => {
              if (m.kind === 'call') {
                return <div key={m.id} className="call-event"><Icon name="phone" size={14} /> <b>{m.author_id === uid ? 'Вы' : thread.display_name}</b> {m.content} <time>{fmtClock(m.created_at, settings)}</time></div>;
              }
              const mine = m.author_id === uid; const prev = msgs[i - 1];
              const grouped = !!prev && prev.kind !== 'call' && prev.author_id === m.author_id && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000;
              return (
                <article key={m._tmp ?? m.id} tabIndex={0} className={`msg ${mine ? 'mine' : 'theirs'} ${grouped ? 'grouped' : ''} ${m._pending ? 'pending' : ''} ${m._failed ? 'failed' : ''}`}>
                  {!mine && (!grouped ? <span className="msg-avatar"><Avatar name={thread.display_name} path={thread.avatar_path} size={34} /></span> : <span className="msg-spacer" />)}
                  <div className="bubble-col">
                    <div className="bubble">
                      {editing === m.id ? (
                        <div className="edit-box"><textarea value={draft} autoFocus maxLength={4000} onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={async (e) => { if (e.key === 'Escape') setEditing(null); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); try { await rpc('edit_dm', { p_id: m.id, p_content: draft }); setEditing(null); } catch (er) { toast.fail(er); } } }} /></div>
                      ) : m.deleted_at ? <p className="msg-text deleted">Сообщение удалено</p> : (
                        <p className="msg-text"><RichText text={m.content} s={settings} /></p>
                      )}
                      <span className="bubble-time">{m.edited_at && 'изм. · '}{fmtClock(m.created_at, settings)}{m._pending && ' · отправка…'}</span>
                    </div>
                    {m._failed && <div className="send-failed">Не отправлено: {m._failed}</div>}
                  </div>
                  {mine && !m.deleted_at && !m._tmp && (
                    <div className="msg-actions">
                      <button className="icon-btn" title="Изменить" onClick={() => { setDraft(m.content); setEditing(m.id); }}><Icon name="edit" size={16} /></button>
                      <button className="icon-btn danger" title="Удалить" onClick={async () => { if (settings.confirmDelete === false || confirm('Удалить сообщение?')) { try { await rpc('delete_dm', { p_id: m.id }); } catch (e) { toast.fail(e); } } }}><Icon name="trash" size={16} /></button>
                    </div>
                  )}
                </article>
              );
            })}
          </>}
        </div>
      </div>
      {thread.is_friend ? (
        <div className="composer"><div className="composer-row">
          <textarea value={text} rows={1} maxLength={4000} placeholder={`Сообщение для ${thread.display_name}`} aria-label="Текст личного сообщения"
            onChange={(e) => setText(e.target.value)} onKeyDown={onKey} spellCheck={settings.spellcheck !== false} />
          <button className="btn primary" onClick={send} disabled={!text.trim()}>Отправить</button>
        </div></div>
      ) : <div className="composer disabled">Вы больше не друзья — отправка недоступна. История сохранена.</div>}
    </section>
  );
}
