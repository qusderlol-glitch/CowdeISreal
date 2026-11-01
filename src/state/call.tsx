import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { rpc, supabase } from '../lib/supabase';
import { MeshCall } from '../lib/rtc/mesh';
import { configuredProvider, type CallEngine, type RemoteParticipant } from '../lib/rtc/provider';
import { getIceServers } from '../lib/rtc/ice';
import { canPickSpeaker, getCamera, getMic, getScreen, levelMeter } from '../lib/rtc/devices';
import { useSession } from './session';
import { useToast } from './toast';
import { playSound } from '../lib/sound';

export interface CallState {
  channelId: string | null; communityId: string | null; channelName: string;
  status: 'idle' | 'joining' | 'connected' | 'failed';
  error: string | null; turn: 'none' | 'ok' | 'error';
  mic: MediaStream | null; camera: MediaStream | null; screen: MediaStream | null;
  deafened: boolean;
  canVideo: boolean;
  participants: RemoteParticipant[];
  speaking: Set<string>;
  volumes: Record<string, number>;
}
interface Ctx extends CallState {
  join: (channel: { id: string; community_id: string; name: string }) => Promise<void>;
  leave: (reason?: string) => Promise<void>;
  toggleMic: () => Promise<void>; toggleCamera: () => Promise<void>; toggleScreen: () => Promise<void>; toggleDeafen: () => Promise<void>;
  setVolume: (uid: string, v: number) => void;
  applyDevices: () => Promise<void>;
}
const CallCtx = createContext<Ctx>(null as unknown as Ctx);

const initial: CallState = { channelId: null, communityId: null, channelName: '', status: 'idle', error: null, turn: 'none',
  mic: null, camera: null, screen: null, deafened: false, canVideo: false, participants: [], speaking: new Set(), volumes: {} };

export function CallProvider({ children }: { children: ReactNode }) {
  const { uid, settings } = useSession();
  const toast = useToast();
  const [st, setSt] = useState<CallState>(initial);
  const engine = useRef<CallEngine | null>(null);
  const hb = useRef<number>(0);
  const meters = useRef(new Map<string, () => void>());
  const stRef = useRef(st); stRef.current = st;
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const pttDown = useRef(false);

  const sync = useCallback(() => {
    const e = engine.current; if (!e) return;
    setSt((s) => ({ ...s, participants: [...e.participants.values()] }));
  }, []);

  const pushState = useCallback(async (patch: Partial<CallState>) => {
    const s = { ...stRef.current, ...patch };
    if (!s.channelId) return;
    await rpc('voice_update', { p_channel: s.channelId, p_muted: !s.mic, p_deafened: s.deafened, p_video: !!s.camera, p_screen: !!s.screen }).catch(toast.fail);
  }, [toast]);

  const stopAll = useCallback(() => {
    const s = stRef.current;
    [s.mic, s.camera, s.screen].forEach((m) => m?.getTracks().forEach((t) => t.stop()));
    meters.current.forEach((stop) => stop()); meters.current.clear();
    window.clearInterval(hb.current);
  }, []);

  const leave = useCallback(async (reason?: string) => {
    const s = stRef.current;
    stopAll();
    const e = engine.current; engine.current = null;
    await e?.leave().catch(() => {});
    if (s.channelId) await rpc('voice_leave', { p_channel: s.channelId }).catch(() => {});
    setSt(initial);
    if (reason) toast.push(reason, 'info');
  }, [stopAll, toast]);

  const join = useCallback(async (channel: { id: string; community_id: string; name: string }) => {
    if (!uid) return;
    if (stRef.current.channelId === channel.id && stRef.current.status !== 'failed') return;
    if (stRef.current.channelId) await leave();
    if (typeof RTCPeerConnection === 'undefined') { toast.push('Браузер не поддерживает WebRTC.', 'error'); return; }
    setSt({ ...initial, channelId: channel.id, communityId: channel.community_id, channelName: channel.name, status: 'joining' });
    try {
      if (configuredProvider() === 'sfu') throw new Error('SFU-провайдер выбран (VITE_CALL_PROVIDER=sfu), но клиентский адаптер не подключён. См. README → «Голос и видео».');
      await rpc('voice_join', { p_channel: channel.id });
      const canVideo = await rpc<boolean>('has_channel_perm', { p_channel: channel.id, p_perm: 1024 }).catch(() => false);
      setSt((s) => ({ ...s, canVideo }));
      const ice = await getIceServers();
      const e = new MeshCall(supabase, channel.id, uid, ice.servers);
      engine.current = e;
      e.onChange(sync);
      await e.join();
      setSt((s) => ({ ...s, status: 'connected', turn: ice.turn }));
      if (ice.turn === 'error') toast.push('TURN недоступен: звонки через строгий NAT могут не соединиться.', 'error');
      hb.current = window.setInterval(async () => {
        const ok = await rpc<boolean>('voice_heartbeat', { p_channel: channel.id }).catch(() => true);
        if (!ok) void leave('Вы отключены от голосовой комнаты.');
      }, 15_000);
    } catch (err) {
      engine.current?.leave().catch(() => {}); engine.current = null;
      await rpc('voice_leave', { p_channel: channel.id }).catch(() => {});
      setSt((s) => ({ ...s, status: 'failed', error: err instanceof Error ? err.message : String(err) }));
    }
  }, [uid, leave, sync, toast]);

  const watchSpeaking = useCallback((id: string, stream: MediaStream | null) => {
    meters.current.get(id)?.(); meters.current.delete(id);
    if (!stream) { setSt((s) => { const n = new Set(s.speaking); n.delete(id); return { ...s, speaking: n }; }); return; }
    meters.current.set(id, levelMeter(stream, (lvl) => {
      const on = lvl > (Number(settingsRef.current.speakingThreshold) || 0.12);
      setSt((s) => { if (s.speaking.has(id) === on) return s; const n = new Set(s.speaking); if (on) n.add(id); else n.delete(id); return { ...s, speaking: n }; });
    }));
  }, []);

  useEffect(() => { for (const p of st.participants) if (!meters.current.has(p.userId) && p.audio) watchSpeaking(p.userId, p.audio); }, [st.participants, watchSpeaking]);

  const toggleMic = useCallback(async () => {
    const e = engine.current; if (!e) return;
    try {
      if (stRef.current.mic) {
        await e.setMic(null); watchSpeaking(uid!, null);
        setSt((s) => ({ ...s, mic: null })); await pushState({ mic: null });
      } else {
        const m = await getMic(settings.micId, settings);
        // режим рации: микрофон захвачен, но звук идёт только пока зажата клавиша
        if (settings.pushToTalk) m.getAudioTracks().forEach((t) => { t.enabled = pttDown.current; });
        await e.setMic(m); watchSpeaking(uid!, m);
        setSt((s) => ({ ...s, mic: m, deafened: false })); await pushState({ mic: m, deafened: false });
      }
    } catch (err) { toast.fail(err); }
  }, [settings, pushState, toast, uid, watchSpeaking]);

  const toggleCamera = useCallback(async () => {
    const e = engine.current; if (!e) return;
    if (!stRef.current.canVideo && !stRef.current.camera) { toast.push('Нет права включать камеру в этой комнате.', 'error'); return; }
    try {
      if (stRef.current.camera) { await e.setCamera(null); setSt((s) => ({ ...s, camera: null })); await pushState({ camera: null }); }
      else { const c = await getCamera(settings.camId, settings); await e.setCamera(c); setSt((s) => ({ ...s, camera: c })); await pushState({ camera: c }); }
    } catch (err) { toast.fail(err); }
  }, [settings, pushState, toast]);

  const toggleScreen = useCallback(async () => {
    const e = engine.current; if (!e) return;
    if (!stRef.current.canVideo && !stRef.current.screen) { toast.push('Нет права показывать экран в этой комнате.', 'error'); return; }
    try {
      if (stRef.current.screen) { await e.setScreen(null); setSt((s) => ({ ...s, screen: null })); await pushState({ screen: null }); }
      else {
        const sc = await getScreen(settings);
        sc.getVideoTracks()[0]?.addEventListener('ended', () => {
          if (stRef.current.screen === sc) { void e.setScreen(null); setSt((s) => ({ ...s, screen: null })); void pushState({ screen: null }); }
        });
        await e.setScreen(sc); setSt((s) => ({ ...s, screen: sc })); await pushState({ screen: sc });
      }
    } catch (err) { toast.fail(err); }
  }, [pushState, toast, settings]);

  const toggleDeafen = useCallback(async () => {
    const e = engine.current; if (!e) return;
    const next = !stRef.current.deafened;
    if (next && stRef.current.mic) { await e.setMic(null); watchSpeaking(uid!, null); }
    setSt((s) => ({ ...s, deafened: next, mic: next ? null : s.mic }));
    await pushState({ deafened: next, mic: next ? null : stRef.current.mic });
  }, [pushState, uid, watchSpeaking]);

  const applyDevices = useCallback(async () => {
    const e = engine.current; const s = stRef.current; if (!e) return;
    try {
      if (s.mic) { const m = await getMic(settings.micId, settings); await e.setMic(m); watchSpeaking(uid!, m); setSt((x) => ({ ...x, mic: m })); }
      if (s.camera) { const c = await getCamera(settings.camId, settings); await e.setCamera(c); setSt((x) => ({ ...x, camera: c })); }
    } catch (err) { toast.fail(err); }
  }, [settings, toast, uid, watchSpeaking]);

  const setVolume = useCallback((id: string, v: number) => setSt((s) => ({ ...s, volumes: { ...s.volumes, [id]: v } })), []);

  useEffect(() => { if (!uid && stRef.current.channelId) void leave(); }, [uid, leave]);

  // звук входа/выхода участников
  const prevCount = useRef(0);
  useEffect(() => {
    const n = st.participants.length;
    if (st.status === 'connected' && settingsRef.current.voiceJoinSound && n !== prevCount.current) playSound(settingsRef.current, n > prevCount.current ? 'join' : 'leave');
    prevCount.current = n;
  }, [st.participants.length, st.status]);

  // рация: удерживайте выбранную клавишу, чтобы говорить
  useEffect(() => {
    const isKey = (e: KeyboardEvent) => settingsRef.current.pushToTalk && e.code === settingsRef.current.pttKey && !(e.target as HTMLElement)?.closest?.('input,textarea,[contenteditable]');
    const set = (on: boolean) => { pttDown.current = on; stRef.current.mic?.getAudioTracks().forEach((t) => { t.enabled = on; }); };
    const down = (e: KeyboardEvent) => { if (isKey(e) && !e.repeat) { e.preventDefault(); set(true); } };
    const up = (e: KeyboardEvent) => { if (isKey(e)) set(false); };
    const blur = () => { if (settingsRef.current.pushToTalk) set(false); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);
  useEffect(() => { // при выключении рации микрофон снова передаёт звук постоянно
    if (!settings.pushToTalk) st.mic?.getAudioTracks().forEach((t) => { t.enabled = true; });
  }, [settings.pushToTalk, st.mic]);

  // предупреждение при закрытии вкладки во время звонка
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (stRef.current.channelId && settingsRef.current.warnCloseInCall) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h);
  }, []);
  useEffect(() => () => { stopAll(); }, [stopAll]);

  return (
    <CallCtx.Provider value={{ ...st, join, leave, toggleMic, toggleCamera, toggleScreen, toggleDeafen, setVolume, applyDevices }}>
      {children}
      {/* удалённый звук живёт здесь, чтобы не прерываться при переходах между каналами */}
      <div hidden>{st.participants.map((p) => p.audio && (
        <RemoteAudio key={p.userId} stream={p.audio} volume={st.deafened ? 0 : st.volumes[p.userId] ?? Number(settings.defaultVolume ?? 1)} sinkId={settings.speakerId} />
      ))}</div>
    </CallCtx.Provider>
  );
}

function RemoteAudio({ stream, volume, sinkId }: { stream: MediaStream; volume: number; sinkId: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => { if (ref.current) { ref.current.srcObject = stream; void ref.current.play().catch(() => {}); } }, [stream]);
  useEffect(() => { if (ref.current) ref.current.volume = Math.max(0, Math.min(1, volume)); }, [volume]);
  useEffect(() => {
    const el = ref.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (el && canPickSpeaker && sinkId) void el.setSinkId?.(sinkId).catch(() => {});
  }, [sinkId]);
  return <audio ref={ref} autoPlay />;
}

export const useCall = () => useContext(CallCtx);
