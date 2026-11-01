import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { q, supabase } from '../lib/supabase';
import type { Community } from '../lib/types';
import { useSession } from '../state/session';
import { CommunityProvider, useCommunity } from '../state/community';
import { UnreadProvider, useUnread } from '../state/unread';
import { Empty, ErrorBox, Icon, Spinner } from '../components/ui';
import Rail from '../components/Rail';
import Sidebar from '../components/Sidebar';
import ChatView from '../components/ChatView';
import VoiceView from '../components/VoiceView';
import MemberList from '../components/MemberList';
import CreateJoinModal from '../components/CreateJoinModal';
import UserSettings from '../components/UserSettings';
import CommunitySettings from '../components/CommunitySettings';
import Leaderboard from '../components/Leaderboard';
import { BRAND } from '../lib/brand';

export type Panel = 'nav' | 'main' | 'members';

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
    <div className="shell" data-panel={panel}>
      {!online && <div className="offline-bar"><Icon name="wifiOff" size={16} /> Нет сети. Сообщения не отправятся, пока соединение не восстановится.</div>}
      <Rail communities={communities ?? []} active={cid} onAdd={() => setModal('create')} onUser={() => setModal('user')} />
      {err && !communities ? <main className="main"><ErrorBox error={err} onRetry={load} /></main>
        : !communities ? <main className="main"><Spinner /></main>
        : cid ? (
          <CommunityProvider key={cid} cid={cid}>
            <CommunityLayout chid={chid} panel={panel} setPanel={setPanel} onUser={() => setModal('user')} />
          </CommunityProvider>
        ) : <Home count={communities.length} onCreate={() => setModal('create')} />}
      {modal === 'create' && <CreateJoinModal onClose={() => setModal(null)} onDone={load} />}
      {modal === 'user' && <UserSettings onClose={() => setModal(null)} />}
    </div>
  );
}

function Home({ count, onCreate }: { count: number; onCreate: () => void }) {
  return (
    <main className="main home">
      <Empty title={count ? 'Выберите сообщество слева' : `Добро пожаловать в ${BRAND.name}`}>
        <p>{count ? 'Или создайте новое — это бесплатно.' : 'Создайте своё сообщество или вступите по ссылке-приглашению.'}</p>
        <button className="btn primary" onClick={onCreate}><Icon name="plus" /> Создать или вступить</button>
      </Empty>
    </main>
  );
}

function CommunityLayout({ chid, panel, setPanel, onUser }: { chid?: string; panel: Panel; setPanel: (p: Panel) => void; onUser: () => void }) {
  const { data, error, loading, reload } = useCommunity();
  const { settings } = useSession();
  const { setActive, refresh } = useUnread();
  const nav = useNavigate();
  const [modal, setModal] = useState<null | 'settings' | 'ranks'>(null);
  const [showMembers, setShowMembers] = useState(settings.showMemberList);

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
      <Sidebar activeChannel={chid} onOpenSettings={() => setModal('settings')} onOpenRanks={() => setModal('ranks')} onUser={onUser} onPick={() => setPanel('main')} />
      <main className="main">
        <div className="mobile-nav">
          <button className="icon-btn" onClick={() => setPanel('nav')} aria-label="Каналы"><Icon name="menu" /></button>
          <span>{channel ? channel.name : data.community.name}</span>
          <button className="icon-btn" onClick={() => setPanel(panel === 'members' ? 'main' : 'members')} aria-label="Участники"><Icon name="users" /></button>
        </div>
        {!channel ? <Empty title="Нет доступных каналов">Попросите администратора открыть вам доступ.</Empty>
          : channel.kind === 'voice' ? <VoiceView key={channel.id} channel={channel} />
          : <ChatView key={channel.id} channel={channel} showMembers={showMembers} onToggleMembers={() => setShowMembers((v) => !v)} />}
      </main>
      {(showMembers || panel === 'members') && <MemberList />}
      {modal === 'settings' && <CommunitySettings onClose={() => setModal(null)} />}
      {modal === 'ranks' && <Leaderboard onClose={() => setModal(null)} />}
    </>
  );
}
