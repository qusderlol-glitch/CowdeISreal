import { useEffect, useRef, useState } from 'react';
import { has, PERM } from '../lib/permissions';
import type { Channel } from '../lib/types';
import { canPickSpeaker, canShareScreen, listDevices } from '../lib/rtc/devices';
import { configuredProvider } from '../lib/rtc/provider';
import { useCall } from '../state/call';
import { useCommunity } from '../state/community';
import { useSession } from '../state/session';
import { Avatar, ErrorBox, Icon, Modal, Field, Spinner } from './ui';

function Video({ stream, mirror, label }: { stream: MediaStream; mirror?: boolean; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className={mirror ? 'mirror' : ''} aria-label={label} />;
}

export default function VoiceView({ channel }: { channel: Channel }) {
  const { data, displayName, memberById } = useCommunity();
  const { uid, profile } = useSession();
  const call = useCall();
  const [devices, setDevices] = useState(false);
  const perms = data?.channelPerms.get(channel.id) ?? 0;
  const here = call.channelId === channel.id && call.status !== 'failed';
  const failedHere = call.channelId === channel.id && call.status === 'failed';
  const states = (data?.voice ?? []).filter((v) => v.channel_id === channel.id);
  const limit = data?.community.voice_mesh_limit ?? 6;
  const canVideo = has(perms, PERM.STREAM_VIDEO);

  if (!here) {
    return (
      <section className="voice-lobby">
        <Icon name="speaker" size={44} />
        <h2>{channel.name}</h2>
        <p className="muted">{states.length ? `В комнате: ${states.map((s) => displayName(s.user_id)).join(', ')}` : 'В комнате пока никого.'}</p>
        <p className="muted small">Звонок {configuredProvider() === 'mesh' ? `peer-to-peer (mesh), до ${limit} участников` : 'через SFU'}. Микрофон и камера выключены, пока вы их не включите.</p>
        {!has(perms, PERM.CONNECT_VOICE) ? <ErrorBox error="Нет права подключаться к голосовым комнатам." />
          : <button className="btn primary" onClick={() => call.join(channel)} disabled={call.status === 'joining'}><Icon name="headphones" /> Подключиться</button>}
        {failedHere && call.error && <ErrorBox error={call.error} onRetry={() => call.join(channel)} />}
      </section>
    );
  }

  const remote = call.participants;
  const stateOf = (id: string) => states.find((s) => s.user_id === id);
  const screens = [
    ...(call.screen ? [{ id: uid!, stream: call.screen, name: 'Ваш экран' }] : []),
    ...remote.filter((p) => p.screen).map((p) => ({ id: p.userId, stream: p.screen!, name: `Экран: ${displayName(p.userId)}` })),
  ];

  return (
    <section className="voice">
      <header className="chat-head">
        <Icon name="speaker" /><h2>{channel.name}</h2>
        <span className={`pill status-${call.status}`}>{call.status === 'joining' ? 'Подключение…' : call.status === 'connected' ? 'Подключено' : 'Ошибка'}</span>
        {call.turn === 'none' && <span className="pill" title="Без TURN часть сетей (строгий NAT, корпоративные) не соединится напрямую">без TURN</span>}
        {call.screen && <span className="pill live-pill">● Вы показываете экран</span>}
      </header>
      {call.status === 'joining' && <Spinner label="Подключаемся к комнате…" />}
      {call.error && <ErrorBox error={call.error} onRetry={() => call.join(channel)} />}
      {screens.length > 0 && <div className="screens">{screens.map((s) => (
        <figure key={s.id + s.stream.id} className="tile screen-tile"><Video stream={s.stream} label={s.name} /><figcaption><Icon name="screen" size={14} /> {s.name}</figcaption></figure>
      ))}</div>}
      <div className="tiles">
        <figure className={`tile ${call.speaking.has(uid!) ? 'speaking' : ''}`}>
          {call.camera ? <Video stream={call.camera} mirror label="Ваша камера" /> : <Avatar name={profile?.display_name ?? 'Вы'} path={profile?.avatar_path} size={72} />}
          <figcaption>{profile?.display_name} (вы) {!call.mic && <Icon name="micOff" size={14} title="Микрофон выключен" />}</figcaption>
        </figure>
        {remote.map((p) => {
          const st = stateOf(p.userId);
          return (
            <figure key={p.userId} className={`tile ${call.speaking.has(p.userId) ? 'speaking' : ''}`}>
              {p.camera ? <Video stream={p.camera} label={`Камера ${displayName(p.userId)}`} /> : <Avatar name={displayName(p.userId)} path={memberById(p.userId)?.profile.avatar_path} size={72} />}
              <figcaption>
                {displayName(p.userId)}
                {st?.muted && <Icon name="micOff" size={14} title="Микрофон выключен" />}
                {st?.deafened && <Icon name="headphonesOff" size={14} title="Звук выключен" />}
                {p.state !== 'connected' && <span className="pill">{p.state === 'new' || p.state === 'connecting' ? 'соединение…' : p.state === 'failed' ? 'нет связи' : p.state}</span>}
              </figcaption>
              <label className="vol" title="Громкость участника">
                <Icon name="speaker" size={14} />
                <input type="range" min={0} max={1} step={0.05} value={call.volumes[p.userId] ?? 1} onChange={(e) => call.setVolume(p.userId, Number(e.target.value))} aria-label={`Громкость ${displayName(p.userId)}`} />
              </label>
            </figure>
          );
        })}
      </div>
      {remote.length === 0 && call.status === 'connected' && <p className="muted center pad">Вы одни в комнате. Пригласите кого-нибудь — звук начнёт передаваться, когда вы включите микрофон.</p>}
      <div className="call-controls" role="toolbar" aria-label="Управление звонком">
        <button className={`ctrl ${call.mic ? 'on' : ''}`} onClick={call.toggleMic} aria-pressed={!!call.mic}><Icon name={call.mic ? 'mic' : 'micOff'} /> <span>{call.mic ? 'Микрофон вкл.' : 'Микрофон'}</span></button>
        <button className={`ctrl ${call.camera ? 'on' : ''}`} onClick={call.toggleCamera} disabled={!canVideo} aria-pressed={!!call.camera} title={canVideo ? '' : 'Нет права на видео'}>
          <Icon name={call.camera ? 'camera' : 'cameraOff'} /> <span>Камера</span></button>
        <button className={`ctrl ${call.screen ? 'on' : ''}`} onClick={call.toggleScreen} disabled={!canVideo || !canShareScreen} aria-pressed={!!call.screen}
          title={!canShareScreen ? 'Демонстрация экрана не поддерживается этим браузером/устройством' : !canVideo ? 'Нет права на видео' : ''}>
          <Icon name="screen" /> <span>{call.screen ? 'Остановить показ' : 'Экран'}</span></button>
        <button className={`ctrl ${call.deafened ? 'warn' : ''}`} onClick={call.toggleDeafen} aria-pressed={call.deafened}><Icon name={call.deafened ? 'headphonesOff' : 'headphones'} /> <span>Звук</span></button>
        <button className="ctrl" onClick={() => setDevices(true)}><Icon name="settings" /> <span>Устройства</span></button>
        <button className="ctrl danger" onClick={() => call.leave()}><Icon name="phoneOff" /> <span>Выйти</span></button>
      </div>
      {devices && <DevicePicker onClose={() => setDevices(false)} />}
    </section>
  );
}

export function DevicePicker({ onClose }: { onClose: () => void }) {
  const { settings, setSettings } = useSession();
  const call = useCall();
  const [list, setList] = useState<Awaited<ReturnType<typeof listDevices>> | null>(null);
  useEffect(() => { listDevices().then(setList).catch(() => setList({ mics: [], cams: [], speakers: [] })); }, []);
  const apply = async () => { await call.applyDevices(); onClose(); };
  const label = (d: MediaDeviceInfo, i: number) => d.label || `Устройство ${i + 1} (название скрыто до выдачи разрешения)`;
  return (
    <Modal title="Устройства" onClose={onClose} footer={<button className="btn primary" onClick={apply}>Применить</button>}>
      {!list ? <Spinner /> : <div className="stack">
        <Field label="Микрофон"><select value={settings.micId} onChange={(e) => setSettings({ micId: e.target.value })}>
          <option value="">По умолчанию</option>{list.mics.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{label(d, i)}</option>)}</select></Field>
        <Field label="Камера"><select value={settings.camId} onChange={(e) => setSettings({ camId: e.target.value })}>
          <option value="">По умолчанию</option>{list.cams.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{label(d, i)}</option>)}</select></Field>
        <Field label="Динамики" hint={canPickSpeaker ? undefined : 'Этот браузер не позволяет выбирать устройство вывода.'}>
          <select value={settings.speakerId} disabled={!canPickSpeaker} onChange={(e) => setSettings({ speakerId: e.target.value })}>
            <option value="">По умолчанию</option>{list.speakers.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{label(d, i)}</option>)}</select></Field>
      </div>}
    </Modal>
  );
}
