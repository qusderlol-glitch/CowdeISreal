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
import CreateJoinModal from '../components/CreateJoinModal';
import UserSettings from '../components/UserSettings';
import CommunitySettings from '../components/CommunitySettings';
import Leaderboard from '../components/Leaderboard';
import { BRAND } from '../lib/brand';

export type Panel = 'nav' | 'main';

export default function AppShell() {
  return <UnreadProvider><Shell /></UnreadProvider>;
}

function Shell() {
  const { cid, chid } = useParams();
  const { uid, online } = useSession();
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
  useEffect(() => { if (chid) setPanel('main'); }, [chid]);

  return (
    <div className="app" data-panel={panel}>
      {!online && <div className="offline-bar"><Icon name="wifiOff" size={16} /> Нет сети. Сообщения не отправятся, пока соединение не восстановится.</div>}
      <TopBar communities={communities ?? []} active={cid} onAdd={() => setModal('create')} onUser={() => setModal('user')} />
      <div className="workspace">
        {err && !communities ? <main className="main"><ErrorBox error={err} onRetry={load} /></main>
          : !communities ? <main className="main"><Spinner /></main>
          : cid ? (
            <CommunityProvider key={cid} cid={cid}>
              <CommunityLayout chid={chid} setPanel={setPanel} />
            </CommunityProvider>
          ) : <Home count={communities.length} onCreate={() => setModal('create')} />}
      </div>
      <CallDock />
      {modal === 'create' && <CreateJoinModal onClose={() => setModal(null)} onDone={load} />}
      {modal === 'user' && <UserSettings onClose={() => setModal(null)} />}
    </div>
  );
}

function Home({ count, onCreate }: { count: number; onCreate: () => void }) {
  return (
    <main className="main home">
      <div className="home-card">
        <Icon name="sprout" size={48} />
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
  const nav = useNavigate();
  const [modal, setModal] = useState<null | 'settings' | 'ranks'>(null);
  const [people, setPeople] = useState(false);

  const channel = data?.channels.find((c) => c.id === chid) ?? null;
  useEffect(() => {
    if (data && !chid) {
      const first = data.channels.find((c) => c.kind !== 'voice');
      if (first) nav(`/app/${data.community.id}/${first.id}`, { replace: true });
    }
  }, [data, chid, nav]);
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
