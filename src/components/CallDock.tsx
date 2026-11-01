import { useState } from 'react';
import { Link } from 'react-router-dom';
import { canShareScreen } from '../lib/rtc/devices';
import { useCall } from '../state/call';
import { useSession } from '../state/session';
import { Icon } from './ui';
import { DevicePicker } from './VoiceView';

// Плавающий док звонка: единое место управления, виден на любом экране, пока вы в комнате.
export default function CallDock() {
  const call = useCall();
  const { settings } = useSession();
  const canVideo = call.canVideo;
  const [devices, setDevices] = useState(false);
  if (!call.channelId || call.status === 'failed') return null;
  return (
    <div className={`call-dock ${call.status}`} role="toolbar" aria-label="Управление звонком">
      <Link className="dock-room" to={call.kind === 'dm' ? `/app/friends/${call.channelId}` : `/app/${call.communityId}/${call.channelId}`}>
        <i className="dock-led" /><span><b>{call.status === 'joining' ? 'Подключение…' : call.kind === 'dm' ? `Звонок: ${call.channelName}` : call.channelName}</b>
          <small>{call.screen ? 'вы показываете экран' : !call.mic ? 'микрофон выключен' : settings.pushToTalk ? 'рация: держите клавишу' : 'микрофон включён'}</small></span>
      </Link>
      <button className={`dock-btn ${call.mic ? 'on' : ''}`} onClick={call.toggleMic} aria-pressed={!!call.mic} title={call.mic ? 'Выключить микрофон' : 'Включить микрофон'}>
        <Icon name={call.mic ? 'mic' : 'micOff'} /><span>Микрофон</span></button>
      <button className={`dock-btn ${call.camera ? 'on' : ''}`} onClick={call.toggleCamera} disabled={!canVideo} aria-pressed={!!call.camera} title={canVideo ? 'Камера' : 'Нет права на видео'}>
        <Icon name={call.camera ? 'camera' : 'cameraOff'} /><span>Камера</span></button>
      <button className={`dock-btn ${call.screen ? 'on live' : ''}`} onClick={call.toggleScreen} disabled={!canVideo || !canShareScreen} aria-pressed={!!call.screen}
        title={!canShareScreen ? 'Демонстрация экрана не поддерживается этим браузером/устройством' : !canVideo ? 'Нет права на видео' : call.screen ? 'Остановить показ' : 'Показать экран'}>
        <Icon name="screen" /><span>{call.screen ? 'Стоп' : 'Экран'}</span></button>
      <button className={`dock-btn ${call.deafened ? 'warn' : ''}`} onClick={call.toggleDeafen} aria-pressed={call.deafened} title={call.deafened ? 'Включить звук' : 'Выключить звук'}>
        <Icon name={call.deafened ? 'headphonesOff' : 'headphones'} /><span>Звук</span></button>
      <button className="dock-btn" onClick={() => setDevices(true)} title="Устройства"><Icon name="settings" /><span>Устройства</span></button>
      <button className="dock-btn hang" onClick={() => { if (!settings.confirmLeaveVoice || confirm('Выйти из голосовой комнаты?')) void call.leave(); }} title="Выйти из комнаты"><Icon name="phoneOff" /><span>Выйти</span></button>
      {devices && <DevicePicker onClose={() => setDevices(false)} />}
    </div>
  );
}
