import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { q, rpc, signedAttachmentUrl, supabase } from '../lib/supabase';
import { has, PERM } from '../lib/permissions';
import { fmtBytes, fmtTime } from '../lib/format';
import { fmtClock, fmtDay } from '../lib/timefmt';
import { playSound } from '../lib/sound';
import RichText, { isJumbo } from './RichText';
import { suggestCommands } from '../lib/commands';
import type { Attachment, Channel, Message, Reaction } from '../lib/types';
import { useCommunity } from '../state/community';
import { useSession } from '../state/session';
import { useToast } from '../state/toast';
import { useUnread } from '../state/unread';
import { Avatar, Empty, ErrorBox, Icon, Spinner } from './ui';
import ProfileModal from './ProfileModal';

const SELECT = '*, message_attachments(*), message_reactions(message_id, user_id, emoji)';
const PAGE = 50;
const MAX_FILE = 10 * 1024 * 1024;
const ALLOWED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'application/zip', 'audio/mpeg', 'audio/ogg', 'video/mp4', 'video/webm'];

export default function ChatView({ channel, onOpenPeople }: { channel: Channel; onOpenPeople: () => void }) {
  const { data, displayName, memberById } = useCommunity();
  const { uid, settings: s } = useSession();
  const toast = useToast();
  const { refresh: refreshUnread } = useUnread();
  const firstPaint = useRef(true);
  const loadingOlder = useRef(false);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [reply, setReply] = useState<Message | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [drawer, setDrawer] = useState<null | 'pins' | 'search'>(null);
  const [profile, setProfile] = useState<string | null>(null);
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [fav, setFav] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const typingCh = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const perms = data?.channelPerms.get(channel.id) ?? 0;
  const canSend = has(perms, PERM.SEND_MESSAGES);
  const canManage = has(perms, PERM.MANAGE_MESSAGES);
  const enabledModules = useMemo(() => new Set(data?.bots.filter((b) => b.enabled).map((b) => b.bot_key)), [data?.bots]);

  const markRead = useCallback((list: Message[]) => {
    const last = list.filter((m) => !m._tmp).at(-1);
    if (!s.autoMarkRead) return;
    if (last && !document.hidden) void rpc('mark_read', { p_channel: channel.id, p_message: last.id }).then(refreshUnread).catch(() => {});
  }, [channel.id, refreshUnread, s.autoMarkRead]);

  const loadInitial = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const rows = await q<Message[]>(supabase.from('messages').select(SELECT).eq('channel_id', channel.id).order('id', { ascending: false }).limit(PAGE));
      const list = rows.reverse();
      setMsgs(list); setHasMore(rows.length === PAGE); markRead(list);
    } catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  }, [channel.id, markRead]);

  useEffect(() => { void loadInitial(); }, [loadInitial]);
  useEffect(() => { q<unknown[]>(supabase.from('channel_favorites').select('channel_id').eq('channel_id', channel.id)).then((r) => setFav(r.length > 0)).catch(() => {}); }, [channel.id]);

  const loadOlder = async () => {
    const oldest = msgs.find((m) => !m._tmp)?.id; if (!oldest || loadingOlder.current) return;
    const el = listRef.current; const prevH = el?.scrollHeight ?? 0;
    loadingOlder.current = true;
    try {
      const rows = await q<Message[]>(supabase.from('messages').select(SELECT).eq('channel_id', channel.id).lt('id', oldest).order('id', { ascending: false }).limit(PAGE));
      setMsgs((m) => [...rows.reverse(), ...m]); setHasMore(rows.length === PAGE);
      requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - prevH; });
    } catch (e) { toast.fail(e); } finally { loadingOlder.current = false; }
  };

  // realtime: новые/изменённые сообщения и реакции
  useEffect(() => {
    const f = `channel_id=eq.${channel.id}`;
    const ch = supabase.channel(`chat:${channel.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: f }, async ({ new: n }) => {
        const id = (n as Message).id;
        const full = await q<Message>(supabase.from('messages').select(SELECT).eq('id', id).single()).catch(() => n as Message);
        setMsgs((list) => {
          if (list.some((m) => m.id === id)) return list.map((m) => (m.id === id ? full : m));
          const next = [...list, full].sort((a, b) => (a._tmp ? 1 : 0) - (b._tmp ? 1 : 0) || a.id - b.id);
          if (atBottom.current) markRead(next);
          return next;
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: f }, ({ new: n }) => {
        const u = n as Message;
        setMsgs((list) => list.map((m) => (m.id === u.id ? { ...m, ...u, message_attachments: u.deleted_at ? [] : m.message_attachments, message_reactions: u.deleted_at ? [] : m.message_reactions } : m)));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions', filter: f }, ({ new: n }) => {
        const r = n as Reaction;
        setMsgs((list) => list.map((m) => (m.id === r.message_id && !m.message_reactions?.some((x) => x.user_id === r.user_id && x.emoji === r.emoji)
          ? { ...m, message_reactions: [...(m.message_reactions ?? []), r] } : m)));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_reactions' }, ({ old: o }) => {
        const r = o as Reaction;
        setMsgs((list) => list.map((m) => (m.id === r.message_id ? { ...m, message_reactions: (m.message_reactions ?? []).filter((x) => !(x.user_id === r.user_id && x.emoji === r.emoji)) } : m)));
      })
      .subscribe((status) => { if (status === 'CHANNEL_ERROR') setErr('Обновления в реальном времени недоступны. Новые сообщения появятся после перезагрузки.'); });
    return () => { void supabase.removeChannel(ch); };
  }, [channel.id, markRead]);

  // кто печатает: приватный broadcast typing:<channel>
  useEffect(() => {
    let ch: ReturnType<typeof supabase.channel> | null = null; let dead = false;
    (async () => {
      await supabase.realtime.setAuth(); if (dead) return;
      ch = supabase.channel(`typing:${channel.id}`, { config: { private: true, broadcast: { self: false } } });
      ch.on('broadcast', { event: 'typing' }, ({ payload }) => setTyping((t) => ({ ...t, [payload.uid as string]: Date.now() })));
      ch.subscribe(); typingCh.current = ch;
    })();
    const iv = window.setInterval(() => setTyping((t) => Object.fromEntries(Object.entries(t).filter(([, at]) => Date.now() - at < 5000))), 1500);
    return () => { dead = true; window.clearInterval(iv); if (ch) void supabase.removeChannel(ch); typingCh.current = null; };
  }, [channel.id]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && atBottom.current && (s.autoScroll || firstPaint.current)) el.scrollTop = el.scrollHeight;
    if (msgs.length) firstPaint.current = false;
  }, [msgs, s.autoScroll]);
  const onScroll = () => {
    const el = listRef.current; if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom.current) markRead(msgs);
    if (s.autoLoadOlder && hasMore && el.scrollTop < 60) void loadOlder();
  };

  const send = async (text: string, files: File[]) => {
    if (!uid || !data) return;
    const tmp = `tmp-${Date.now()}`;
    const optimistic: Message = { id: Number.MAX_SAFE_INTEGER - Date.now() % 1e9, channel_id: channel.id, community_id: channel.community_id, author_id: uid, kind: 'user',
      bot_key: null, content: text, reply_to_id: reply?.id ?? null, mentions: [], created_at: new Date().toISOString(), edited_at: null, deleted_at: null,
      pinned_at: null, message_attachments: [], message_reactions: [], _pending: true, _tmp: tmp };
    atBottom.current = true;
    if (s.sendSound) playSound(s, 'send');
    setMsgs((m) => [...m, optimistic]);
    const replyId = reply?.id ?? null; setReply(null);
    try {
      const attachments = [];
      for (const f of files) {
        const safe = f.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80) || 'file';
        const path = `${channel.community_id}/${channel.id}/${uid}/${crypto.randomUUID()}-${safe}`;
        const { error } = await supabase.storage.from('attachments').upload(path, f, { contentType: f.type, upsert: false });
        if (error) throw new Error(`Не удалось загрузить «${f.name}»: ${error.message}`);
        attachments.push({ path, name: f.name });
      }
      const id = await rpc<number>('send_message', { p_channel: channel.id, p_content: text, p_reply_to: replyId, p_attachments: attachments });
      setMsgs((list) => list.some((m) => m.id === id) ? list.filter((m) => m._tmp !== tmp) : list.map((m) => (m._tmp === tmp ? { ...m, id, _pending: false, _tmp: undefined } : m)));
      if (attachments.length) {
        const full = await q<Message>(supabase.from('messages').select(SELECT).eq('id', id).single()).catch(() => null);
        if (full) setMsgs((list) => list.map((m) => (m.id === id ? full : m)));
      }
    } catch (e) {
      setMsgs((list) => list.map((m) => (m._tmp === tmp ? { ...m, _pending: false, _failed: (e as Error).message } : m)));
    }
  };

  const typingNames = Object.keys(typing).filter((id) => id !== uid).map((id) => displayName(id));
  const byId = useMemo(() => new Map(msgs.map((m) => [m.id, m])), [msgs]);

  return (
    <section className="chat">
      <header className="chat-head">
        <Icon name={channel.kind === 'announcement' ? 'megaphone' : 'hash'} />
        <h2>{channel.name}</h2>
        {channel.topic && <span className="topic" title={channel.topic}>{channel.topic}</span>}
        {channel.slowmode_seconds > 0 && <span className="pill" title="Медленный режим">⏱ {channel.slowmode_seconds} с</span>}
        <div className="head-actions">
          <button className={`icon-btn ${fav ? 'live' : ''}`} aria-pressed={fav} title={fav ? 'Убрать из избранного' : 'В избранное'} onClick={async () => {
            const r = fav ? await supabase.from('channel_favorites').delete().eq('channel_id', channel.id) : await supabase.from('channel_favorites').insert({ channel_id: channel.id });
            if (r.error) toast.fail(r.error); else setFav(!fav);
          }}><Icon name="star" /></button>
          <button className={`icon-btn ${drawer === 'pins' ? 'live' : ''}`} title="Закреплённые" onClick={() => setDrawer(drawer === 'pins' ? null : 'pins')}><Icon name="pin" /></button>
          <button className={`icon-btn ${drawer === 'search' ? 'live' : ''}`} title="Поиск" onClick={() => setDrawer(drawer === 'search' ? null : 'search')}><Icon name="search" /></button>
          <button className="icon-btn" title="Люди" aria-label="Люди" onClick={onOpenPeople}><Icon name="users" /></button>
        </div>
      </header>
      <div className="chat-body">
        <div className="messages" ref={listRef} onScroll={onScroll} role="log" aria-live="polite" aria-label={`Сообщения в #${channel.name}`}>
          {loading ? <Spinner /> : err && !msgs.length ? <ErrorBox error={err} onRetry={loadInitial} /> : <>
            {hasMore ? <button className="btn small ghost load-older" onClick={loadOlder}>Загрузить более ранние</button>
              : <Empty icon={channel.kind === 'announcement' ? 'megaphone' : 'hash'} title={`Начало #${channel.name}`}>{channel.topic || 'Здесь начинается история канала.'}</Empty>}
            {err && <ErrorBox error={err} />}
            {msgs.map((m, i) => {
              const prev = msgs[i - 1];
              if (s.hideDeleted && m.deleted_at) return null;
              const grouped = !!prev && prev.author_id === m.author_id && prev.kind === m.kind && !m.reply_to_id && !(s.hideDeleted && prev.deleted_at)
                && new Date(m.created_at).toDateString() === new Date(prev.created_at).toDateString()
                && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < Number(s.groupWindow) * 60_000;
              const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
              return <Fragment key={m._tmp ?? m.id}>{newDay && s.dayDividers && <div className="day-divider"><span>{fmtDay(m.created_at, s)}</span></div>}<MessageRow m={m} grouped={grouped} replyTo={m.reply_to_id ? byId.get(m.reply_to_id) : undefined}
                replyName={(() => { const r = m.reply_to_id ? byId.get(m.reply_to_id) : undefined; return r ? (r.kind === 'bot' ? botName(r.bot_key) : displayName(r.author_id)) : ''; })()}
                mine={m.author_id === uid} canManage={canManage} canReact={has(perms, PERM.ADD_REACTIONS)} editing={editing === m.id}
                onEdit={() => setEditing(m.id)} onStopEdit={() => setEditing(null)} onReply={() => setReply(m)} onProfile={setProfile}
                onRetry={() => { setMsgs((l) => l.filter((x) => x._tmp !== m._tmp)); void send(m.content, []); }}
                onDiscard={() => setMsgs((l) => l.filter((x) => x._tmp !== m._tmp))}
                name={m.kind === 'bot' ? botName(m.bot_key) : displayName(m.author_id)}
                avatar={memberById(m.author_id)?.profile.avatar_path ?? null}
                color={memberById(m.author_id)?.top?.color} me={uid} /></Fragment>;
            })}
          </>}
        </div>
        {drawer && <Drawer kind={drawer} channel={channel} onClose={() => setDrawer(null)} />}
      </div>
      <div className="typing" aria-live="polite">{s.showTyping && typingNames.length > 0 && `${typingNames.slice(0, 3).join(', ')} ${typingNames.length > 1 ? 'печатают' : 'печатает'}…`}</div>
      <Composer channel={channel} canSend={canSend} canAttach={has(perms, PERM.ATTACH_FILES)} enabledModules={enabledModules}
        reply={reply} replyName={reply ? displayName(reply.author_id) : ''} onCancelReply={() => setReply(null)} onSend={send}
        onTyping={() => { if (s.sendTyping) void typingCh.current?.send({ type: 'broadcast', event: 'typing', payload: { uid } }); }} />
      {profile && <ProfileModal userId={profile} onClose={() => setProfile(null)} />}
    </section>
  );
}

function botName(key: string | null) { return key === 'examples' ? 'Помощник (пример)' : key === 'system' ? 'Система' : `Бот ${key ?? ''}`; }

function MessageRow(props: {
  m: Message; grouped: boolean; replyTo?: Message; replyName: string; mine: boolean; canManage: boolean; canReact: boolean; editing: boolean;
  onEdit: () => void; onStopEdit: () => void; onReply: () => void; onProfile: (id: string) => void; onRetry: () => void; onDiscard: () => void;
  name: string; avatar: string | null; color?: string; me: string | null;
}) {
  const { m, grouped, mine, canManage } = props;
  const toast = useToast();
  const { settings: s } = useSession();
  const [picker, setPicker] = useState(false);
  const [draft, setDraft] = useState(m.content);
  const [expanded, setExpanded] = useState(false);
  const [unmuted, setUnmuted] = useState(false);
  const deleted = !!m.deleted_at;
  const words = (v: unknown) => String(v ?? '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
  const lower = m.content.toLowerCase();
  const muted = !mine && !unmuted && words(s.mutedWords).some((w) => lower.includes(w));
  const keyword = !mine && words(s.highlightWords).some((w) => lower.includes(w));
  const lines = m.content.split('\n').length;
  const long = s.collapseLong && (lines > Number(s.collapseLines) || m.content.length > Number(s.collapseLines) * 90);
  const quick = String(s.quickReactions).split(/\s+/).filter(Boolean).slice(0, 12);
  const avatarSize = Number(s.chatAvatarSize) || 34;

  const del = async () => {
    if (s.confirmDelete && !confirm('Удалить сообщение?')) return;
    try {
      const paths = await rpc<string[]>('delete_message', { p_id: m.id });
      if (paths?.length) await supabase.storage.from('attachments').remove(paths);
    } catch (e) { toast.fail(e); }
  };
  const saveEdit = async () => {
    try { await rpc('edit_message', { p_id: m.id, p_content: draft }); props.onStopEdit(); } catch (e) { toast.fail(e); }
  };
  const react = async (emoji: string) => { setPicker(false); try { await rpc('toggle_reaction', { p_message: m.id, p_emoji: emoji }); } catch (e) { toast.fail(e); } };
  const pin = async () => { try { await rpc('set_pinned', { p_message: m.id, p_pinned: !m.pinned_at }); toast.push(m.pinned_at ? 'Откреплено' : 'Закреплено', 'ok'); } catch (e) { toast.fail(e); } };

  const mentioned = s.highlightMentions && props.me && m.mentions?.includes(props.me);
  const onDouble = () => {
    if (deleted || m._tmp) return;
    if (s.doubleClick === 'react' && props.canReact) void react(String(s.doubleClickEmoji || '👍'));
    else if (s.doubleClick === 'reply') props.onReply();
  };
  const groups = new Map<string, string[]>();
  for (const r of m.message_reactions ?? []) groups.set(r.emoji, [...(groups.get(r.emoji) ?? []), r.user_id]);

  const time = fmtClock(m.created_at, s);
  const isBot = m.kind === 'bot';
  return (
    <article tabIndex={0} aria-label={`${props.name}: ${deleted ? 'сообщение удалено' : m.content.slice(0, 80)}`}
      onDoubleClick={onDouble}
      className={`msg ${mine && !isBot ? 'mine' : 'theirs'} ${grouped ? 'grouped' : ''} ${mentioned ? 'mentioned' : ''} ${keyword ? 'keyword' : ''} ${muted ? 'msg-muted' : ''} ${long && !expanded ? 'msg-collapsed' : ''} ${m._pending ? 'pending' : ''} ${m._failed ? 'failed' : ''} ${m.kind}`}>
      {!mine && !isBot && s.showChatAvatars && (!grouped ? (
        <button className="msg-avatar" onClick={() => m.author_id && props.onProfile(m.author_id)} aria-label={`Профиль ${props.name}`} disabled={!m.author_id}>
          <Avatar name={props.name} path={props.avatar} size={avatarSize} />
        </button>
      ) : <span className="msg-spacer" style={{ width: avatarSize }} />)}
      <div className="bubble-col">
        {!grouped && !mine && !isBot && s.showAuthorNames && (
          <button className="author" style={{ color: s.roleColors ? props.color : undefined }} onClick={() => m.author_id && props.onProfile(m.author_id)}>{props.name}</button>
        )}
        <div className="bubble">
          {isBot && <div className="note-head"><Icon name="bot" size={15} /> <b>{props.name}</b> <span className="pill">{m.bot_key === 'examples' ? 'пример' : 'бот'}</span></div>}
          {props.replyTo && s.showReplyQuotes && <div className="reply-ref"><Icon name="reply" size={12} /> <b>{props.replyName}</b> {props.replyTo.deleted_at ? <i>сообщение удалено</i> : props.replyTo.content.slice(0, 90)}</div>}
          {props.editing ? (
            <div className="edit-box">
              <textarea value={draft} maxLength={4000} autoFocus onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void saveEdit(); } if (e.key === 'Escape') props.onStopEdit(); }} />
              <small>Enter — сохранить · Esc — отмена</small>
            </div>
          ) : deleted ? <p className="msg-text deleted">Сообщение удалено</p> : muted ? (
            <p className="msg-text">Скрыто фильтром слов. <button className="link-btn" onClick={() => setUnmuted(true)}>Показать</button></p>
          ) : m.content ? (
            <p className={`msg-text ${s.jumboEmoji && isJumbo(m.content) ? 'jumbo' : ''}`} style={long && !expanded ? { ['--clamp' as string]: Number(s.collapseLines) } : undefined}>
              <RichText text={m.content} s={s} /></p>
          ) : null}
          {long && !muted && !deleted && <button className="link-btn small" onClick={() => setExpanded((v) => !v)}>{expanded ? 'Свернуть' : 'Показать полностью'}</button>}
          {!deleted && (m.message_attachments ?? []).map((a) => <AttachmentView key={a.id} a={a} />)}
          <span className="bubble-time" title={new Date(m.created_at).toLocaleString('ru-RU')}>
            {m.pinned_at && <Icon name="pin" size={11} title="Закреплено" />}{s.showEdited && m.edited_at && 'изм. · '}{time}
            {m._pending && ' · отправка…'}
          </span>
        </div>
        {s.showReactions && groups.size > 0 && <div className="reactions">{[...groups].map(([e, users]) => (
          <button key={e} className={`reaction ${props.me && users.includes(props.me) ? 'mine' : ''}`} onClick={() => react(e)} disabled={!props.canReact}
            aria-label={`${e}: ${users.length}`}>{e} {users.length}</button>
        ))}</div>}
        {m._failed && <div className="send-failed"><span>Не отправлено: {m._failed}</span><button className="link-btn" onClick={props.onRetry}>Повторить</button><button className="link-btn" onClick={props.onDiscard}>Убрать</button></div>}
      </div>
      {!deleted && !m._tmp && (
        <div className="msg-actions">
          {props.canReact && <button className="icon-btn" title="Реакция" onClick={() => setPicker((v) => !v)}><Icon name="smile" size={16} /></button>}
          <button className="icon-btn" title="Ответить" onClick={props.onReply}><Icon name="reply" size={16} /></button>
          {mine && m.kind === 'user' && <button className="icon-btn" title="Изменить" onClick={() => { setDraft(m.content); props.onEdit(); }}><Icon name="edit" size={16} /></button>}
          {canManage && <button className="icon-btn" title={m.pinned_at ? 'Открепить' : 'Закрепить'} onClick={pin}><Icon name="pin" size={16} /></button>}
          {(mine || canManage) && <button className="icon-btn danger" title="Удалить" onClick={del}><Icon name="trash" size={16} /></button>}
          {picker && <div className="emoji-picker">{quick.map((e) => <button key={e} onClick={() => react(e)}>{e}</button>)}</div>}
        </div>
      )}
    </article>
  );
}

function AttachmentView({ a }: { a: Attachment }) {
  const { settings: s } = useSession();
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { signedAttachmentUrl(a.storage_path).then(setUrl).catch(() => setErr(true)); }, [a.storage_path]);
  if (err) return <div className="attachment muted">Файл недоступен</div>;
  const caption = s.altTextReminder ? <span className="att-caption">{a.file_name} · {fmtBytes(a.size_bytes)}</span> : null;
  if (a.mime_type.startsWith('image/') && s.inlineMedia) return url ? <a href={url} target="_blank" rel="noopener noreferrer"><img className="att-img" src={url} alt={a.file_name} loading="lazy" />{caption}</a> : <div className="att-img placeholder" />;
  if (a.mime_type.startsWith('video/') && url && s.inlineMedia) return <video className="att-img" src={url} controls preload="metadata" />;
  if (a.mime_type.startsWith('audio/') && url) return <audio src={url} controls preload="none" />;
  return <a className="attachment" href={url ?? undefined} target="_blank" rel="noopener noreferrer" download={a.file_name}><Icon name="clip" /> {a.file_name} <span className="muted">{fmtBytes(a.size_bytes)}</span></a>;
}

function Composer({ channel, canSend, canAttach, enabledModules, reply, replyName, onCancelReply, onSend, onTyping }: {
  channel: Channel; canSend: boolean; canAttach: boolean; enabledModules: Set<string>; reply: Message | null; replyName: string;
  onCancelReply: () => void; onSend: (text: string, files: File[]) => Promise<void>; onTyping: () => void;
}) {
  const toast = useToast();
  const { settings: s } = useSession();
  const draftKey = `cowdeisreal.draft:${channel.id}`;
  const [text, setTextRaw] = useState(() => (s.keepDrafts ? localStorage.getItem(draftKey) ?? '' : ''));
  const setText = (v: string) => { setTextRaw(v); if (s.keepDrafts) { if (v) localStorage.setItem(draftKey, v); else localStorage.removeItem(draftKey); } };
  const [files, setFiles] = useState<File[]>([]);
  const lastTyping = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const suggestions = s.commandHints ? suggestCommands(text, enabledModules) : [];

  if (!canSend) return <div className="composer disabled">{channel.kind === 'announcement' ? 'В канал объявлений пишут только модераторы.' : 'У вас нет права писать в этом канале.'}</div>;

  const submit = () => {
    const t = text.trim();
    if (!t && !files.length) return;
    if (t.length > 4000) { toast.push('Сообщение длиннее 4000 символов.', 'error'); return; }
    void onSend(t, files); setText(''); setFiles([]);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const enterSends = s.enterToSend ? !e.shiftKey && !e.ctrlKey : e.ctrlKey || e.metaKey;
    if (e.key === 'Enter' && enterSends && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
    if (e.key === 'Tab' && suggestions.length) { e.preventDefault(); setText(`/${suggestions[0].name} `); }
    if (e.key === 'Escape' && reply) onCancelReply();
  };
  const addFiles = (list: FileList | null) => {
    const ok: File[] = [];
    for (const f of Array.from(list ?? [])) {
      if (f.size > MAX_FILE) toast.push(`«${f.name}» больше 10 МБ`, 'error');
      else if (!ALLOWED.includes(f.type)) toast.push(`Тип файла «${f.name}» не разрешён`, 'error');
      else ok.push(f);
    }
    setFiles((cur) => [...cur, ...ok].slice(0, 5));
  };

  return (
    <div className="composer" onDragOver={(e) => canAttach && e.preventDefault()} onDrop={(e) => { if (canAttach) { e.preventDefault(); addFiles(e.dataTransfer.files); } }}>
      {suggestions.length > 0 && (
        <ul className="suggest" role="listbox" aria-label="Команды">
          {suggestions.map((c) => (
            <li key={c.name}><button onClick={() => setText(`/${c.name} `)}><b>{c.usage}</b> <span className="muted">{c.description}</span>{c.example && <span className="pill">пример</span>}</button></li>
          ))}
        </ul>
      )}
      {reply && <div className="reply-bar"><Icon name="reply" size={14} /> Ответ для <b>{replyName}</b><button className="icon-btn" onClick={onCancelReply} aria-label="Отменить ответ"><Icon name="x" size={14} /></button></div>}
      {files.length > 0 && <div className="file-chips">{files.map((f, i) => (
        <span key={i} className="chip">{f.name} <small>{fmtBytes(f.size)}</small><button onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} aria-label="Убрать файл"><Icon name="x" size={12} /></button></span>
      ))}</div>}
      <div className="composer-row">
        {canAttach && s.showAttachButton && <>
          <button className="icon-btn" onClick={() => fileRef.current?.click()} title="Прикрепить файл (до 10 МБ)" aria-label="Прикрепить файл"><Icon name="clip" /></button>
          <input ref={fileRef} type="file" multiple hidden accept={ALLOWED.join(',')} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        </>}
        <textarea value={text} rows={1} maxLength={4000} placeholder={String(s.composerPlaceholder || `Сообщение в #${channel.name}`)} aria-label="Текст сообщения"
          spellCheck={Boolean(s.spellcheck)} autoFocus={Boolean(s.autoFocusComposer)}
          onChange={(e) => {
            setText(e.target.value);
            if (Date.now() - lastTyping.current > 3000) { lastTyping.current = Date.now(); onTyping(); }
          }} onKeyDown={onKey} onPaste={(e) => { if (canAttach && e.clipboardData.files.length) addFiles(e.clipboardData.files); }} />
        {s.showSendButton && <button className="btn primary" onClick={submit} disabled={!text.trim() && !files.length}>Отправить</button>}
      </div>
      {(s.charCounter === 'always' ? text.length > 0 : s.charCounter === 'near' && text.length > 3500) && <small className={text.length > 4000 ? 'err-text' : 'muted'}>{text.length}/4000</small>}
    </div>
  );
}

function Drawer({ kind, channel, onClose }: { kind: 'pins' | 'search'; channel: Channel; onClose: () => void }) {
  const { data, displayName } = useCommunity();
  const [items, setItems] = useState<Message[] | null>(kind === 'pins' ? null : []);
  const [query, setQuery] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (kind !== 'pins') return;
    q<Message[]>(supabase.from('messages').select('*').eq('channel_id', channel.id).not('pinned_at', 'is', null).order('pinned_at', { ascending: false }))
      .then(setItems).catch((e) => setErr(e.message));
  }, [kind, channel.id]);
  const search = async () => {
    if (!query.trim()) return; setErr(null); setItems(null);
    try { setItems(await rpc<Message[]>('search_messages', { p_community: channel.community_id, p_query: query })); } catch (e) { setErr((e as Error).message); setItems([]); }
  };
  const chName = (id: string) => data?.channels.find((c) => c.id === id)?.name ?? '?';
  return (
    <aside className="drawer" aria-label={kind === 'pins' ? 'Закреплённые' : 'Поиск'}>
      <header><h3>{kind === 'pins' ? 'Закреплённые' : 'Поиск по сообществу'}</h3><button className="icon-btn" onClick={onClose} aria-label="Закрыть"><Icon name="x" /></button></header>
      {kind === 'search' && <form className="row" onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Слова или начало слов" autoFocus aria-label="Запрос" />
        <button className="btn">Найти</button>
      </form>}
      {err && <ErrorBox error={err} />}
      {!items ? <Spinner /> : !items.length ? <p className="muted pad">{kind === 'pins' ? 'Закреплённых сообщений нет.' : query ? 'Ничего не найдено в доступных вам каналах.' : 'Ищем только в каналах, которые вы можете читать.'}</p> : (
        <ul className="drawer-list">{items.map((m) => (
          <li key={m.id}><div className="muted small">{displayName(m.author_id)} · #{chName(m.channel_id)} · {fmtTime(m.created_at)}</div><div>{m.content.slice(0, 300)}</div></li>
        ))}</ul>
      )}
    </aside>
  );
}
