import { useEffect, useRef } from 'react';
import type { RemoteParticipant } from '../lib/rtc/provider';
import { Icon } from './ui';

export function CallVideo({ stream, label, mirror }: { stream: MediaStream; label: string; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className={mirror ? 'mirror' : ''} aria-label={label} />;
}

// Понятное объяснение, почему нет связи (вместо голого «failed»)
export function CallStatusBanner({ p, turn }: { p: RemoteParticipant; turn: 'none' | 'ok' | 'error' }) {
  if (p.state !== 'failed' && p.state !== 'disconnected') return null;
  if (p.state === 'disconnected') return <p className="call-diag warn"><Icon name="wifiOff" size={14} /> Связь прервалась, переподключаемся…</p>;
  const text = p.diag === 'relay_failed'
    ? 'Не удалось соединиться даже через TURN-сервер. Проверьте его настройки (адрес, логин, пароль) — README → «Звонки через разные сети».'
    : turn === 'none'
      ? 'Нет связи: ваши сети не пускают прямое соединение (так бывает с мобильным интернетом и многими роутерами). Нужен TURN-сервер — владелец сайта подключает его один раз: README → «Звонки через разные сети».'
      : 'Нет связи: TURN-сервер не ответил. Проверьте его настройки или лимит трафика у провайдера.';
  return <p className="call-diag" role="alert"><Icon name="wifiOff" size={14} /> {text}</p>;
}
