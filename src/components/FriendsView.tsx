import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { q, rpc, supabase } from '../lib/supabase';
import { linkify } from '../lib/format';
import type { DirectMessage, DmThread, FriendRequest } from '../lib/types';
import { useSession } from '../state/session';
import { useSocial } from '../state/social';
import { useToast } from '../state/toast';
import { Avatar, Empty, ErrorBox, Icon, Spinner } from './ui';
import UserSearch from './UserSearch';
import UserCard from './UserCard';

type Tab = 'friends' | 'requests' | 'blocked';
interface Friend { user_id: string; handle: string; display_name: string; avatar_path: string | null; avatar_frame: string; profile_emoji: string; since: string }
const REQ_SELECT = 'id, from_id, to_id, status, source, created_at, from:profiles!friend_requests_from_id_fkey(id, handle, display_name, avatar_path, avatar_frame), to:profiles!friend_requests_to_id_fkey(id, handle, display_name, avatar_path, avatar_frame)';

// Экран «Друзья»: поиск людей, заявки, список друзей, блокировки и личные сообщения.
export default function FriendsView({ threadId }: { threadId?: string }) {
  const { uid, settings: s } = useSession();
  const { incoming, version, refresh } = useSocial();
  const toast = useToast();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('friends');
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [reqs, setReqs] = useState<FriendRequest[] | null>(null);
  const [blocks, setBlocks] = useState<Friend[] | null>(null);
  const [threads, setThreads] = useState<DmThread[] | null>(null);
  const [card, setCard] = useState<string | null>(null);
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

  const write = async (userId: string) => {
    try { const id = await rpc<string>('open_dm', { p_user: userId }); setCard(null); nav(`/app/friends/${id}`); } catch (e) { toast.fail(e); }
  };
  const act = async (fn: string, args: Record<string, unknown>, ok: string) => {
    try { await rpc(fn, args); toast.push(ok, 'ok'); refresh(); await load(); } catch (e) { toast.fail(e); }
  };

  const incomingReqs = reqs?.filter((r) => r.to_id === uid) ?? [];
  const outgoingReqs = reqs?.filter((r) => r.from_id === uid) ?? [];
  const active = threads?.find((t) => t.thread_id === threadId);

  return (
    <>
      <aside className="rooms friends-side" aria-label="Друзья">
        <section className="community-card friends-card">
          <h2>Друзья</h2>
          <UserSearch onOpenProfile={setCard} onWrite={write} />
        </section>
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={tab === 'friends'} className={tab === 'friends' ? 'active' : ''} onClick={() => setTab('friends')}>Друзья {friends ? `· ${friends.length}` : ''}</button>
          <button role="tab" aria-selected={tab === 'requests'} className={tab === 'requests' ? 'active' : ''} onClick={() => setTab('requests')}>
            Заявки {incoming > 0 && <b className="badge">{incoming}</b>}</button>
          <button role="tab" aria-selected={tab === 'blocked'} className={tab === 'blocked' ? 'active' : ''} onClick={() => setTab('blocked')}>Блок</button>
        </div>
        <div className="rooms-scroll">
          {err && <ErrorBox error={err} onRetry={load} />}
          {tab === 'friends' && (!friends ? <Spinner /> : !friends.length ? <p className="muted small pad-s">Пока нет друзей. Найдите человека по handle выше или загляните в «Знакомства».</p> : (
            <ul className="people-list">{[...friends].sort((a, b) => s.friendsSort === 'recent' ? b.since.localeCompare(a.since) : a.display_name.localeCompare(b.display_name, 'ru')).map((f) => (
              <li key={f.user_id}>
                <button className="hit-main" onClick={() => setCard(f.user_id)}><Avatar name={f.display_name} path={f.avatar_path} size={34} frame={f.avatar_frame} />
                  <span><b>{f.display_name} {s.profileEmoji && f.profile_emoji}</b><small>@{f.handle}</small></span></button>
                <button className="icon-btn" title="Написать" aria-label={`Написать ${f.display_name}`} onClick={() => write(f.user_id)}><Icon name="chat" size={16} /></button>
              </li>
            ))}</ul>
          ))}
          {tab === 'requests' && (!reqs ? <Spinner /> : <>
            <h3 className="group">Входящие</h3>
            {!incomingReqs.length ? <p className="muted small pad-s">Нет входящих заявок.</p> : <ul className="people-list">{incomingReqs.map((r) => (
              <li key={r.id}>
                <button className="hit-main" onClick={() => setCard(r.from_id)}><Avatar name={r.from?.display_name ?? '?'} path={r.from?.avatar_path} size={34} frame={r.from?.avatar_frame} />
                  <span><b>{r.from?.display_name}</b><small>@{r.from?.handle}{r.source === 'discovery' ? ' · из знакомств' : ''}</small></span></button>
                <button className="btn small primary" onClick={() => act('respond_friend_request', { p_id: r.id, p_accept: true }, 'Теперь вы друзья')}><Icon name="check" size={14} /> Принять</button>
                <button className="icon-btn" title="Отклонить" aria-label="Отклонить" onClick={() => act('respond_friend_request', { p_id: r.id, p_accept: false }, 'Заявка отклонена')}><Icon name="x" size={16} /></button>
              </li>
            ))}</ul>}
            <h3 className="group">Исходящие</h3>
            {!outgoingReqs.length ? <p className="muted small pad-s">Нет отправленных заявок.</p> : <ul className="people-list">{outgoingReqs.map((r) => (
              <li key={r.id}>
                <button className="hit-main" onClick={() => setCard(r.to_id)}><Avatar name={r.to?.display_name ?? '?'} path={r.to?.avatar_path} size={34} frame={r.to?.avatar_frame} />
                  <span><b>{r.to?.display_name}</b><small>@{r.to?.handle} · ждёт ответа</small></span></button>
                <button className="btn small" onClick={() => act('cancel_friend_request', { p_id: r.id }, 'Заявка отменена')}>Отменить</button>
              </li>
            ))}</ul>}
          </>)}
          {tab === 'blocked' && (!blocks ? <Spinner /> : !blocks.length ? <p className="muted small pad-s">Вы никого не блокировали. Заблокированный не найдёт вас, не пришлёт заявку и не напишет.</p> : (
            <ul className="people-list">{blocks.map((b) => (
              <li key={b.user_id}><span className="hit-main"><Avatar name={b.display_name} path={b.avatar_path} size={34} /><span><b>{b.display_name}</b><small>@{b.handle}</small></span></span>
                <button className="btn small" onClick={() => act('unblock_user', { p_user: b.user_id }, 'Разблокирован')}>Разблокировать</button></li>
            ))}</ul>
          ))}
          <h3 className="group">Личные сообщения</h3>
          {!threads ? <Spinner /> : !threads.length ? <p className="muted small pad-s">Диалогов нет. Нажмите «Написать» у друга.</p> : (
            <ul className="people-list threads">{threads.map((t) => (
              <li key={t.thread_id} className={t.thread_id === threadId ? 'active' : ''}>
                <button className="hit-main" onClick={() => nav(`/app/friends/${t.thread_id}`)}>
                  <Avatar name={t.display_name} path={t.avatar_path} size={34} frame={t.avatar_frame} />
                  <span><b>{t.display_name}</b><small>{t.last_content ?? 'Начните разговор'}</small></span>
                </button>
                {t.unread > 0 && <b className="badge">{t.unread}</b>}
              </li>
            ))}</ul>
          )}
        </div>
      </aside>
      <main className="main">
        <button className="back-to-rooms" onClick={() => nav('/app/friends')}><Icon name="arrowUp" size={14} /> Друзья</button>
        {threadId && active ? <DmView key={threadId} thread={active} onProfile={setCard} onChanged={load} />
          : threadId && threads ? <Empty icon="chat" title="Диалог недоступен">Возможно, вы больше не друзья или человек вас заблокировал.</Empty>
          : threadId ? <Spinner />
          : <Empty icon="users" title="Ваши люди здесь">Найдите друга по @handle — даже с опечаткой подскажем, кого вы имели в виду. Заявку нужно принять, прежде чем вы станете друзьями.</Empty>}
      </main>
      {card && <UserCard userId={card} onClose={() => setCard(null)} onWrite={write} onChanged={() => { refresh(); void load(); }} />}
    </>
  );
}

function DmView({ thread, onProfile, onChanged }: { thread: DmThread; onProfile: (id: string) => void; onChanged: () => void }) {
  const { uid, settings } = useSession();
  const { setActiveThread, refresh } = useSocial();
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

  useEffect(() => {
    setActiveThread(thread.thread_id);
    q<DirectMessage[]>(supabase.from('direct_messages').select('*').eq('thread_id', thread.thread_id).order('id', { ascending: false }).limit(50))
      .then((r) => { const l = r.reverse(); setMsgs(l); setHasMore(r.length === 50); markRead(l); }).catch((e) => toast.fail(e));
    const ch = supabase.channel(`dm:${thread.thread_id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `thread_id=eq.${thread.thread_id}` }, ({ new: n }) => {
        const m = n as DirectMessage;
        setMsgs((l) => { if (!l || l.some((x) => x.id === m.id)) return l; const next = [...l, m]; if (atBottom.current) markRead(next); return next; });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'direct_messages', filter: `thread_id=eq.${thread.thread_id}` }, ({ new: n }) => {
        const m = n as DirectMessage; setMsgs((l) => l?.map((x) => (x.id === m.id ? m : x)) ?? l);
      }).subscribe();
    return () => { setActiveThread(null); void supabase.removeChannel(ch); };
  }, [thread.thread_id, setActiveThread, markRead, toast]);

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
    setMsgs((l) => [...(l ?? []), { id: Number.MAX_SAFE_INTEGER - (Date.now() % 1e9), thread_id: thread.thread_id, author_id: uid, content: t, created_at: new Date().toISOString(), edited_at: null, deleted_at: null, _pending: true, _tmp: tmp }]);
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

  return (
    <section className="chat">
      <header className="chat-head">
        <button className="dm-head" onClick={() => onProfile(thread.other_id)}><Avatar name={thread.display_name} path={thread.avatar_path} size={32} frame={thread.avatar_frame} />
          <h2>{thread.display_name}</h2><span className="topic">@{thread.handle}</span></button>
        {!thread.is_friend && <span className="pill">не в друзьях — писать нельзя</span>}
      </header>
      <div className="chat-body">
        <div className="messages" ref={listRef} role="log" aria-label={`Диалог с ${thread.display_name}`}
          onScroll={() => { const el = listRef.current; if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
          {!msgs ? <Spinner /> : <>
            {hasMore && <button className="btn small ghost load-older" onClick={older}>Загрузить более ранние</button>}
            {!msgs.length && <Empty icon="chat" title={`Начало разговора с ${thread.display_name}`}>Личные сообщения видите только вы двое.</Empty>}
            {msgs.map((m, i) => {
              const mine = m.author_id === uid; const prev = msgs[i - 1];
              const grouped = !!prev && prev.author_id === m.author_id && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000;
              return (
                <article key={m._tmp ?? m.id} tabIndex={0} className={`msg ${mine ? 'mine' : 'theirs'} ${grouped ? 'grouped' : ''} ${m._pending ? 'pending' : ''} ${m._failed ? 'failed' : ''}`}>
                  {!mine && (!grouped ? <span className="msg-avatar"><Avatar name={thread.display_name} path={thread.avatar_path} size={34} /></span> : <span className="msg-spacer" />)}
                  <div className="bubble-col">
                    <div className="bubble">
                      {editing === m.id ? (
                        <div className="edit-box"><textarea value={draft} autoFocus maxLength={4000} onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={async (e) => { if (e.key === 'Escape') setEditing(null); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); try { await rpc('edit_dm', { p_id: m.id, p_content: draft }); setEditing(null); } catch (er) { toast.fail(er); } } }} /></div>
                      ) : m.deleted_at ? <p className="msg-text deleted">Сообщение удалено</p> : (
                        <p className="msg-text">{linkify(m.content).map((p, k) => p.type === 'link' ? <a key={k} href={p.value} target="_blank" rel="noopener noreferrer nofollow">{p.value}</a> : <span key={k}>{p.value}</span>)}</p>
                      )}
                      <span className="bubble-time">{m.edited_at && 'изм. · '}{new Date(m.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}{m._pending && ' · отправка…'}</span>
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

