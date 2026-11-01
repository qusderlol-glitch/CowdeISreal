import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { CallEngine, ConnState, RemoteParticipant } from './provider';

// Mesh: каждый участник соединён с каждым напрямую (N*(N-1)/2 соединений, исходящий трафик растёт линейно).
// Подходит для 2–6 человек. Supabase Realtime здесь только сигнализация (SDP/ICE), медиа идут peer-to-peer или через TURN.

type Signal =
  | { kind: 'sdp'; from: string; to: string; description: RTCSessionDescriptionInit }
  | { kind: 'ice'; from: string; to: string; candidate: RTCIceCandidateInit }
  | { kind: 'media'; from: string; camera: string | null; screen: string | null }
  | { kind: 'hello'; from: string };

interface Peer {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  senders: { mic: RTCRtpSender[]; camera: RTCRtpSender[]; screen: RTCRtpSender[] };
  streams: Map<string, MediaStream>;
  meta: { camera: string | null; screen: string | null };
  pendingIce: RTCIceCandidateInit[];
}

export class MeshCall implements CallEngine {
  readonly kind = 'mesh' as const;
  readonly participants = new Map<string, RemoteParticipant>();
  state: ConnState = 'idle';
  error: string | null = null;
  private peers = new Map<string, Peer>();
  private ch: RealtimeChannel | null = null;
  private listeners = new Set<() => void>();
  private local: { mic: MediaStream | null; camera: MediaStream | null; screen: MediaStream | null } = { mic: null, camera: null, screen: null };

  constructor(private sb: SupabaseClient, private channelId: string, private selfId: string, private ice: RTCIceServer[]) {}

  onChange(cb: () => void) { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
  private emit() { this.listeners.forEach((l) => l()); }

  async join() {
    this.state = 'connecting'; this.emit();
    await this.sb.realtime.setAuth();
    const ch = this.sb.channel(`voice:${this.channelId}`, {
      config: { private: true, broadcast: { self: false, ack: false }, presence: { key: this.selfId } },
    });
    this.ch = ch;
    ch.on('broadcast', { event: 'signal' }, ({ payload }) => { void this.handle(payload as Signal); });
    ch.on('presence', { event: 'sync' }, () => this.syncPresence());
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Сигнальный канал не ответил (Realtime недоступен или нет прав).')), 12000);
      ch.subscribe(async (status, err) => {
        if (status === 'SUBSCRIBED') { clearTimeout(t); await ch.track({ at: Date.now() }); resolve(); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(t);
          reject(new Error(`Сигнальный канал Realtime недоступен${status === 'TIMED_OUT' ? ' (таймаут)' : ''}. Проверьте сеть и что Realtime включён в проекте Supabase.${err?.message ? ` Подробности: ${err.message}` : ''}`));
        }
      });
    }).catch((e) => { this.state = 'failed'; this.error = String(e.message ?? e); this.emit(); throw e; });
    this.state = 'connected'; this.emit();
    this.send({ kind: 'hello', from: this.selfId });
  }

  async leave() {
    for (const id of [...this.peers.keys()]) this.dropPeer(id);
    if (this.ch) { await this.ch.untrack().catch(() => {}); await this.sb.removeChannel(this.ch); }
    this.ch = null; this.state = 'closed'; this.emit();
  }

  private send(s: Signal) { void this.ch?.send({ type: 'broadcast', event: 'signal', payload: s }); }

  private syncPresence() {
    if (!this.ch) return;
    const present = new Set(Object.keys(this.ch.presenceState()));
    for (const id of present) if (id !== this.selfId && !this.peers.has(id)) this.ensurePeer(id);
    for (const id of [...this.peers.keys()]) if (!present.has(id)) this.dropPeer(id);
  }

  private ensurePeer(id: string): Peer {
    const existing = this.peers.get(id);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const peer: Peer = { pc, polite: this.selfId > id, makingOffer: false, ignoreOffer: false,
      senders: { mic: [], camera: [], screen: [] }, streams: new Map(), meta: { camera: null, screen: null }, pendingIce: [] };
    this.peers.set(id, peer);
    this.participants.set(id, { userId: id, audio: null, camera: null, screen: null, state: 'new' });

    pc.onicecandidate = ({ candidate }) => { if (candidate) this.send({ kind: 'ice', from: this.selfId, to: id, candidate: candidate.toJSON() }); };
    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) this.send({ kind: 'sdp', from: this.selfId, to: id, description: pc.localDescription.toJSON() });
      } catch (e) { console.warn('negotiation', e); } finally { peer.makingOffer = false; }
    };
    pc.ontrack = ({ track, streams }) => {
      const s = streams[0] ?? new MediaStream([track]);
      peer.streams.set(s.id, s);
      track.onended = () => this.refresh(id);
      s.onremovetrack = () => this.refresh(id);
      this.refresh(id);
    };
    pc.onconnectionstatechange = () => {
      const p = this.participants.get(id); if (p) p.state = pc.connectionState;
      if (pc.connectionState === 'failed') pc.restartIce();
      this.emit();
    };
    // Нечувствительная сторона открывает канал данных, чтобы соединение установилось даже без медиа
    if (!peer.polite) pc.createDataChannel('meta');
    for (const kind of ['mic', 'camera', 'screen'] as const) {
      const s = this.local[kind];
      if (s) s.getTracks().forEach((t) => peer.senders[kind].push(pc.addTrack(t, s)));
    }
    this.sendMeta();
    return peer;
  }

  private dropPeer(id: string) {
    const p = this.peers.get(id);
    if (p) { p.pc.close(); this.peers.delete(id); }
    this.participants.delete(id); this.emit();
  }

  private refresh(id: string) {
    const peer = this.peers.get(id); const part = this.participants.get(id);
    if (!peer || !part) return;
    const live = (s: MediaStream | undefined) => (s && s.getTracks().some((t) => t.readyState === 'live') ? s : null);
    part.camera = peer.meta.camera ? live(peer.streams.get(peer.meta.camera)) : null;
    part.screen = peer.meta.screen ? live(peer.streams.get(peer.meta.screen)) : null;
    const audioStream = [...peer.streams.values()].find((s) => s.id !== peer.meta.screen && s.getAudioTracks().some((t) => t.readyState === 'live'));
    part.audio = audioStream ?? null;
    this.emit();
  }

  private sendMeta() {
    this.send({ kind: 'media', from: this.selfId, camera: this.local.camera?.id ?? null, screen: this.local.screen?.id ?? null });
  }

  private async handle(s: Signal) {
    if (s.from === this.selfId) return;
    if (s.kind === 'hello') { this.ensurePeer(s.from); return; }
    if (s.kind === 'media') {
      const p = this.ensurePeer(s.from); p.meta = { camera: s.camera, screen: s.screen }; this.refresh(s.from); return;
    }
    if (s.to !== this.selfId) return;
    const peer = this.ensurePeer(s.from);
    const pc = peer.pc;
    try {
      if (s.kind === 'sdp') {
        const d = s.description;
        const collision = d.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(d);
        for (const c of peer.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {});
        if (d.type === 'offer') {
          await pc.setLocalDescription();
          if (pc.localDescription) this.send({ kind: 'sdp', from: this.selfId, to: s.from, description: pc.localDescription.toJSON() });
        }
      } else if (s.kind === 'ice') {
        if (!pc.remoteDescription) { peer.pendingIce.push(s.candidate); return; }
        try { await pc.addIceCandidate(s.candidate); } catch (e) { if (!peer.ignoreOffer) console.warn('ice', e); }
      }
    } catch (e) { console.warn('signal', e); }
  }

  private async setKind(kind: 'mic' | 'camera' | 'screen', stream: MediaStream | null) {
    const old = this.local[kind];
    this.local[kind] = stream;
    for (const peer of this.peers.values()) {
      const senders = peer.senders[kind];
      const tracks = stream?.getTracks() ?? [];
      // для микрофона заменяем трек без перезапуска переговоров, если возможно
      if (kind === 'mic' && senders.length === 1 && tracks.length === 1) { await senders[0].replaceTrack(tracks[0]); continue; }
      senders.forEach((sn) => { try { peer.pc.removeTrack(sn); } catch { /* уже закрыт */ } });
      peer.senders[kind] = stream ? tracks.map((t) => peer.pc.addTrack(t, stream)) : [];
    }
    if (old && old !== stream) old.getTracks().forEach((t) => t.stop());
    this.sendMeta();
    this.emit();
  }

  setMic(s: MediaStream | null) { return this.setKind('mic', s); }
  setCamera(s: MediaStream | null) { return this.setKind('camera', s); }
  setScreen(s: MediaStream | null) { return this.setKind('screen', s); }
}
