import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { q, rpc, supabase } from '../lib/supabase';
import type { Category, Channel, Community, Member, Profile, Role, Tag, VoiceState } from '../lib/types';
import { useSession } from './session';

export interface MemberView extends Member { profile: Profile; roleIds: string[]; tagIds: string[]; top: Role | null }

interface Data {
  community: Community; categories: Category[]; channels: Channel[]; roles: Role[]; tags: Tag[];
  members: MemberView[]; perms: number; channelPerms: Map<string, number>; myTop: number;
  bots: { bot_key: string; enabled: boolean }[]; voice: VoiceState[];
}
interface Ctx {
  data: Data | null; error: string | null; loading: boolean;
  reload: () => Promise<void>; online: Set<string>;
  memberById: (id: string | null) => MemberView | undefined;
  displayName: (id: string | null) => string;
}
const CommunityCtx = createContext<Ctx>(null as unknown as Ctx);
const VOICE_STALE_MS = 45_000;

export function CommunityProvider({ cid, children }: { cid: string; children: ReactNode }) {
  const { uid, priv } = useSession();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const timer = useRef<number>(0);

  const load = useCallback(async () => {
    try {
      const [community, categories, channels, roles, tags, members, memberRoles, tagAs, perms, chPerms, myTop, bots, voice] = await Promise.all([
        q<Community>(supabase.from('communities').select('*').eq('id', cid).single()),
        q<Category[]>(supabase.from('channel_categories').select('*').eq('community_id', cid).order('position')),
        q<Channel[]>(supabase.from('channels').select('*').eq('community_id', cid).order('position')),
        q<Role[]>(supabase.from('roles').select('*').eq('community_id', cid).order('position', { ascending: false })),
        q<Tag[]>(supabase.from('member_tags').select('*').eq('community_id', cid).order('name')),
        q<(Member & { profiles: Profile })[]>(supabase.from('community_members').select('*, profiles(*)').eq('community_id', cid).limit(2000)),
        q<{ user_id: string; role_id: string }[]>(supabase.from('member_roles').select('user_id, role_id').eq('community_id', cid)),
        q<{ user_id: string; tag_id: string }[]>(supabase.from('member_tag_assignments').select('user_id, tag_id').eq('community_id', cid)),
        rpc<number>('my_permissions', { p_community: cid }),
        rpc<{ channel_id: string; permissions: number }[]>('my_channel_permissions', { p_community: cid }),
        rpc<number>('my_top_position', { p_community: cid }),
        q<{ bot_key: string; enabled: boolean }[]>(supabase.from('community_bots').select('bot_key, enabled').eq('community_id', cid)),
        q<VoiceState[]>(supabase.from('voice_states').select('*').eq('community_id', cid)),
      ]);
      const roleById = new Map(roles.map((r) => [r.id, r]));
      const mv: MemberView[] = members.map(({ profiles, ...m }) => {
        const roleIds = memberRoles.filter((x) => x.user_id === m.user_id).map((x) => x.role_id);
        const top = roleIds.map((id) => roleById.get(id)!).filter(Boolean).sort((a, b) => b.position - a.position)[0] ?? null;
        return { ...m, profile: profiles, roleIds, tagIds: tagAs.filter((x) => x.user_id === m.user_id).map((x) => x.tag_id), top };
      });
      setData({ community, categories, channels, roles, tags, members: mv, perms, myTop,
        channelPerms: new Map(chPerms.map((c) => [c.channel_id, Number(c.permissions)])), bots,
        voice: voice.filter((v) => Date.now() - new Date(v.last_seen).getTime() < VOICE_STALE_MS) });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, [cid]);

  const schedule = useCallback(() => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => { void load(); }, 250); }, [load]);

  useEffect(() => { setLoading(true); setData(null); void load(); }, [load]);

  // структура и голос — postgres_changes (RLS учитывается сервером Realtime)
  useEffect(() => {
    const f = `community_id=eq.${cid}`;
    const ch = supabase.channel(`struct:${cid}`);
    for (const table of ['channels', 'channel_categories', 'roles', 'member_roles', 'community_members', 'voice_states'])
      ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: f }, schedule);
    ch.subscribe();
    const iv = window.setInterval(schedule, 30_000); // страховка: убрать «зависшие» голосовые состояния
    return () => { void supabase.removeChannel(ch); window.clearInterval(iv); };
  }, [cid, schedule]);

  // онлайн-присутствие (приватный топик, только участники). Режим «невидимка» — не отмечаемся.
  useEffect(() => {
    if (!uid) return;
    let ch: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    (async () => {
      await supabase.realtime.setAuth();
      if (cancelled) return;
      ch = supabase.channel(`community:${cid}`, { config: { private: true, presence: { key: uid } } });
      ch.on('presence', { event: 'sync' }, () => setOnline(new Set(Object.keys(ch!.presenceState()))));
      ch.subscribe((s) => { if (s === 'SUBSCRIBED' && priv?.presence !== 'invisible') void ch!.track({ presence: priv?.presence ?? 'online' }); });
    })();
    return () => { cancelled = true; if (ch) void supabase.removeChannel(ch); };
  }, [cid, uid, priv?.presence]);

  const memberById = useCallback((id: string | null) => data?.members.find((m) => m.user_id === id), [data]);
  const displayName = useCallback((id: string | null) => {
    const m = id ? data?.members.find((x) => x.user_id === id) : undefined;
    return m ? (m.nickname || m.profile.display_name) : 'Бывший участник';
  }, [data]);

  // себя считаем «в сети» сразу (кроме режима невидимки), не дожидаясь синхронизации presence
  const onlineWithSelf = useMemo(() => {
    if (!uid || priv?.presence === 'invisible' || online.has(uid)) return online;
    return new Set([...online, uid]);
  }, [online, uid, priv?.presence]);
  const value = useMemo(() => ({ data, error, loading, reload: load, online: onlineWithSelf, memberById, displayName }), [data, error, loading, load, onlineWithSelf, memberById, displayName]);
  return <CommunityCtx.Provider value={value}>{children}</CommunityCtx.Provider>;
}
export const useCommunity = () => useContext(CommunityCtx);
