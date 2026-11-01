import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { q, supabase } from '../lib/supabase';
import type { Community } from '../lib/types';
import { useSession } from '../state/session';
import { CommunityProvider, useCommunity } from '../state/community';
import { UnreadProvider, useUnread } from '../state/unread';
import { Empty, ErrorBox, Icon, Spinner } from '../components/ui';
import TopBar from '../components/TopBar';
import Rooms from '../components/Rooms';
import ChatView from '../components/ChatView';
import VoiceView from '../components/VoiceView';
import MemberList from '../components/MemberList';
import CallDock from '../components/CallDock';
import IncomingCall from '../components/IncomingCall';
import CreateJoinModal from '../components/CreateJoinModal';
import UserSettings from '../components/UserSettings';
import CommunitySettings from '../components/CommunitySettings';
import Leaderboard from '../components/Leaderboard';
import { BRAND } from '../lib/brand';
import FriendsView from '../components/FriendsView';
import DiscoverView from '../components/DiscoverView';

export type Panel = 'nav' | 'main';

export type Mode = 'community' | 'friends' | 'discover';

export default function AppShell({ mode = 'community' }: { mode?: Mode }) {
  return <UnreadProvider><Shell mode={mode} /></UnreadProvider>;
}

function Shell({ mode }: { mode: Mode }) {
  const { cid, chid, threadId } = useParams();
  const { uid, online, settings } = useSession();
  const navTo = useNavigate();
  // стартовая страница: только при заходе на /app без сообщества
  useEffect(() => {
    if (cid || mode !== 'community') return;
    if (settings.startPage === 'friends') navTo('/app/friends', { replace: true });
    else if (settings.startPage === 'last') { const last = localStorage.getItem('cowdeisreal.lastCommunity'); if (last) navTo(`/app/${last}`, { replace: true }); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [communities, setCommunities] = useState<Community[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState<null | 'create' | 'user'>(null);
  const [panel, setPanel] = useState<Panel>(chid ? 'main' : 'nav');

  const load = useCallback(async () => {
    try { setCommunities(await q<Community[]>(supabase.from('communities').select('*').order('created_at'))); setErr(null); }
    catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!uid) return;
    const ch = supabase.channel(`mine:${uid}`).on('postgres_changes', { event: '*', schema: 'public', table: 'community_members', filter: `user_id=eq.${uid}` }, () => void load()).subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [uid, load]);
  useEffect(() => { if (chid || threadId || mode === 'discover') setPanel('main'); else if (mode === 'friends') setPanel('nav'); }, [chid, threadId, mode]);

  return (
    <div className="app" data-panel={panel} data-mode={mode}>
      {!online && <div className="offline-bar"><Icon name="wifiOff" size={16} /> Нет сети. Сообщения не отправятся, пока соединение не восстановится.</div>}
      <TopBar communities={communities ?? []} active={cid} mode={mode} onAdd={() => setModal('create')} onUser={() => setModal('user')} />
      <div className="workspace">
        {mode === 'friends' ? <FriendsView threadId={threadId} />
          : mode === 'discover' ? <DiscoverView />
          : err && !communities ? <main className="main"><ErrorBox error={err} onRetry={load} /></main>
          : !communities ? <main className="main"><Spinner /></main>
          : cid ? (
            <CommunityProvider key={cid} cid={cid}>
              <CommunityLayout chid={chid} setPanel={setPanel} />
            </CommunityProvider>
          ) : <Home count={communities.length} onCreate={() => setModal('create')} />}
      </div>
      <CallDock />
      <IncomingCall />
      {modal === 'create' && <CreateJoinModal onClose={() => setModal(null)} onDone={load} />}
      {modal === 'user' && <UserSettings onClose={() => setModal(null)} />}
    </div>
  );
}

function Home({ count, onCreate }: { count: number; onCreate: () => void }) {
  return (
    <main className="main home">
      <div className="home-card">
        <Icon name="logo" size={48} />
        <h1>{count ? 'Выберите сообщество сверху' : `Добро пожаловать в ${BRAND.name}`}</h1>
        <p className="muted">{count ? 'Или посадите новое — это бесплатно.' : 'Создайте своё сообщество или вступите по ссылке-приглашению.'}</p>
        <button className="btn primary" onClick={onCreate}><Icon name="plus" /> Создать или вступить</button>
      </div>
    </main>
  );
}

function CommunityLayout({ chid, setPanel }: { chid?: string; setPanel: (p: Panel) => void }) {
  const { data, error, loading, reload } = useCommunity();
  const { setActive, refresh } = useUnread();
  const { settings: s } = useSession();
  const nav = useNavigate();
  const [modal, setModal] = useState<null | 'settings' | 'ranks'>(null);
  const [people, setPeople] = useState(false);

  const channel = data?.channels.find((c) => c.id === chid) ?? null;
  useEffect(() => {
    if (data && !chid) {
      const last = s.rememberLastRoom ? localStorage.getItem(`cowdeisreal.lastRoom:${data.community.id}`) : null;
      const target = data.channels.find((c) => c.id === last && c.kind !== 'voice') ?? data.channels.find((c) => c.kind !== 'voice');
      if (target) nav(`/app/${data.community.id}/${target.id}`, { replace: true });
    }
    if (data && chid) localStorage.setItem('cowdeisreal.lastCommunity', data.community.id);
  }, [data, chid, nav, s.rememberLastRoom]);
  // Alt+↑/↓ — соседняя текстовая комната
  useEffect(() => {
    if (!s.keyboardShortcuts || !data) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      const list = data.channels.filter((c) => c.kind !== 'voice');
      const i = list.findIndex((c) => c.id === chid);
      const next = list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length];
      if (next) { e.preventDefault(); nav(`/app/${data.community.id}/${next.id}`); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [s.keyboardShortcuts, data, chid, nav]);
  useEffect(() => { setActive(channel?.id ?? null); refresh(); return () => setActive(null); }, [channel?.id, setActive, refresh]);

  if (loading && !data) return <main className="main"><Spinner /></main>;
  if (error && !data) return <main className="main"><ErrorBox error={`Сообщество недоступно: ${error}`} onRetry={reload} /></main>;
  if (!data) return null;

  return (
    <>
      <Rooms activeChannel={chid} onOpenSettings={() => setModal('settings')} onOpenRanks={() => setModal('ranks')} onOpenPeople={() => setPeople(true)} onPick={() => setPanel('main')} />
      <main className="main">
        <button className="back-to-rooms" onClick={() => setPanel('nav')}><Icon name="arrowUp" size={14} /> Комнаты</button>
        {!channel ? <Empty title="Нет доступных комнат">Попросите администратора открыть вам доступ.</Empty>
          : channel.kind === 'voice' ? <VoiceView key={channel.id} channel={channel} />
          : <ChatView key={channel.id} channel={channel} onOpenPeople={() => setPeople(true)} />}
      </main>
      {people && <MemberList onClose={() => setPeople(false)} />}
      {modal === 'settings' && <CommunitySettings onClose={() => setModal(null)} />}
      {modal === 'ranks' && <Leaderboard onClose={() => setModal(null)} />}
    </>
  );
}
