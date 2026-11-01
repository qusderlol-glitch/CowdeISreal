import { useEffect, useState } from 'react';
import { q, rpc, supabase } from '../lib/supabase';
import type { ProfileStyle, Relation } from '../lib/types';
import { useToast } from '../state/toast';
import { ErrorBox, Field, Icon, Modal, Spinner } from './ui';
import ProfileBanner from './ProfileBanner';

interface Card extends Partial<ProfileStyle> { id: string; handle: string; display_name: string; avatar_path: string | null; bio?: string; status_text?: string; presence?: string; relation: Relation; created_at?: string }
const REASONS: [string, string][] = [['spam', 'Спам'], ['harassment', 'Оскорбления, травля'], ['inappropriate', 'Неприемлемый контент'], ['underage', 'Похоже, ребёнку грозит опасность'], ['impersonation', 'Выдаёт себя за другого'], ['other', 'Другое']];

// Карточка человека вне сообществ: друзья, поиск, знакомства.
export default function UserCard({ userId, onClose, onWrite, onChanged }: { userId: string; onClose: () => void; onWrite: (id: string) => void; onChanged: () => void }) {
  const toast = useToast();
  const [card, setCard] = useState<Card | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [report, setReport] = useState(false);
  const [reason, setReason] = useState('spam');
  const [details, setDetails] = useState('');
  const load = () => rpc<Card | null>('get_profile_card', { p_user: userId }).then((c) => (c ? setCard(c) : setErr('Профиль недоступен.'))).catch((e) => setErr(e.message));
  useEffect(() => { void load(); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: string, args: Record<string, unknown>, ok: string) => {
    try { const r = await rpc<string>(fn, args); toast.push(r === 'accepted' ? 'Теперь вы друзья' : ok, 'ok'); onChanged(); await load(); } catch (e) { toast.fail(e); }
  };
  const respond = async (accept: boolean) => {
    const r = await q<{ id: number }[]>(supabase.from('friend_requests').select('id').eq('from_id', userId).eq('status', 'pending')).catch(() => []);
    if (r[0]) await act('respond_friend_request', { p_id: r[0].id, p_accept: accept }, accept ? 'Теперь вы друзья' : 'Заявка отклонена');
  };
  const cancel = async () => {
    const r = await q<{ id: number }[]>(supabase.from('friend_requests').select('id').eq('to_id', userId).eq('status', 'pending')).catch(() => []);
    if (r[0]) await act('cancel_friend_request', { p_id: r[0].id }, 'Заявка отменена');
  };

  return (
    <Modal title="Профиль" onClose={onClose}>
      {err ? <ErrorBox error={err} /> : !card ? <Spinner /> : report ? (
        <div className="stack">
          <p>Жалоба на <b>@{card.handle}</b> уйдёт администратору этого сервиса. Человек о ней не узнает.</p>
          <Field label="Причина"><select value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Подробности (необязательно)"><textarea maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} /></Field>
          <div className="row"><button className="btn danger" onClick={async () => { await act('report_user', { p_user: card.id, p_reason: reason, p_details: details, p_context: 'profile' }, 'Жалоба отправлена'); setReport(false); }}>Отправить жалобу</button>
            <button className="btn ghost" onClick={() => setReport(false)}>Отмена</button></div>
          <p className="muted small">Если есть угроза жизни или здоровью — сразу обращайтесь в экстренные службы.</p>
        </div>
      ) : (
        <div className="stack">
          <ProfileBanner p={card} />
          {card.status_text && <p className="muted">{card.status_text}</p>}
          {card.bio && <p className="bio">{card.bio}</p>}
          <div className="row wrap">
            {card.relation === 'none' && <button className="btn primary" onClick={() => act('send_friend_request', { p_user: card.id, p_source: 'profile' }, 'Заявка отправлена')}><Icon name="userPlus" size={16} /> Добавить в друзья</button>}
            {card.relation === 'outgoing' && <button className="btn" onClick={cancel}>Отменить заявку</button>}
            {card.relation === 'incoming' && <><button className="btn primary" onClick={() => respond(true)}><Icon name="check" size={16} /> Принять заявку</button><button className="btn" onClick={() => respond(false)}>Отклонить</button></>}
            {card.relation === 'friend' && <><button className="btn primary" onClick={() => onWrite(card.id)}><Icon name="chat" size={16} /> Написать</button>
              <button className="btn" onClick={() => confirm(`Убрать @${card.handle} из друзей?`) && act('remove_friend', { p_user: card.id }, 'Удалён из друзей')}>Убрать из друзей</button></>}
          </div>
          {card.relation !== 'self' && <div className="row wrap">
            <button className="btn small ghost" onClick={() => confirm(`Заблокировать @${card.handle}? Он не сможет найти вас, написать или прислать заявку.`) && act('block_user', { p_user: card.id }, 'Заблокирован').then(onClose)}><Icon name="ban" size={14} /> Заблокировать</button>
            <button className="btn small ghost" onClick={() => setReport(true)}><Icon name="flag" size={14} /> Пожаловаться</button>
          </div>}
        </div>
      )}
    </Modal>
  );
}
