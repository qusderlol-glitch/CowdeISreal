import { useEffect, useState } from 'react';
import { rpc } from '../lib/supabase';
import { has, PERM } from '../lib/permissions';
import { levelProgress } from '../lib/xp';
import { useCommunity } from '../state/community';
import { useSession } from '../state/session';
import { useToast } from '../state/toast';
import { Avatar, ErrorBox, Field, Icon, Modal, Spinner } from './ui';

interface Card { id: string; handle: string; display_name: string; avatar_path: string | null; bio?: string; status_text?: string; presence?: string; timezone?: string; created_at?: string }
const PRESENCE: Record<string, string> = { online: 'В сети', idle: 'Отошёл', dnd: 'Не беспокоить', invisible: 'Невидимка', offline: 'Не в сети' };

export default function ProfileModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { data, memberById, reload } = useCommunity();
  const { uid } = useSession();
  const toast = useToast();
  const [card, setCard] = useState<Card | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [xpDelta, setXpDelta] = useState(0);
  const [nick, setNick] = useState('');
  useEffect(() => { rpc<Card>('get_profile_card', { p_user: userId }).then(setCard).catch((e) => setErr(e.message)); }, [userId]);
  const m = memberById(userId);
  useEffect(() => { setNick(m?.nickname ?? ''); }, [m?.nickname]);
  if (!data) return null;
  const { perms, myTop, community } = data;
  const isOwner = community.owner_id === userId;
  const targetTop = isOwner ? 1e6 : m?.top?.position ?? 0;
  const canAct = !!m && userId !== uid && !isOwner && myTop > targetTop;
  const act = async (fn: string, args: Record<string, unknown>, ok: string) => {
    try { await rpc(fn, args); toast.push(ok, 'ok'); await reload(); } catch (e) { toast.fail(e); }
  };
  const p = m ? levelProgress(m.xp) : null;
  const localTime = card?.timezone ? (() => { try { return new Date().toLocaleTimeString('ru-RU', { timeZone: card.timezone, hour: '2-digit', minute: '2-digit' }); } catch { return null; } })() : null;

  return (
    <Modal title="Профиль" onClose={onClose} wide>
      {err ? <ErrorBox error={err} /> : !card ? <Spinner /> : (
        <div className="profile">
          <div className="profile-head">
            <Avatar name={card.display_name} path={card.avatar_path} size={80} />
            <div>
              <h3>{m?.nickname || card.display_name} {isOwner && <Icon name="crown" size={16} title="Владелец" />}</h3>
              <div className="muted">@{card.handle}{m?.nickname ? ` · ${card.display_name}` : ''}</div>
              {card.presence && <div className={`presence p-${card.presence}`}>● {PRESENCE[card.presence] ?? card.presence}{card.status_text ? ` — ${card.status_text}` : ''}</div>}
            </div>
          </div>
          {card.bio && <p className="bio">{card.bio}</p>}
          <dl className="facts">
            {card.timezone && <><dt>Часовой пояс</dt><dd>{card.timezone}{localTime ? ` (сейчас ${localTime})` : ''}</dd></>}
            {card.created_at && <><dt>В {`RootApp`} с</dt><dd>{new Date(card.created_at).toLocaleDateString('ru-RU')}</dd></>}
            {m && <><dt>В сообществе с</dt><dd>{new Date(m.joined_at).toLocaleDateString('ru-RU')}</dd></>}
            {m && p && community.xp_enabled && <><dt>Ранг</dt><dd>Уровень {p.level} · {m.xp} XP <span className="bar"><span style={{ width: `${Math.round(p.ratio * 100)}%` }} /></span></dd></>}
            {m?.timeout_until && new Date(m.timeout_until) > new Date() && <><dt>Заглушён до</dt><dd>{new Date(m.timeout_until).toLocaleString('ru-RU')}</dd></>}
          </dl>
          {m && <div className="chips">
            {m.roleIds.map((id) => { const r = data.roles.find((x) => x.id === id); return r && <span key={id} className="chip" style={{ borderColor: r.color }}><i style={{ background: r.color }} />{r.name}</span>; })}
            {m.tagIds.map((id) => { const t = data.tags.find((x) => x.id === id); return t && <span key={id} className="chip tag" title={t.description} style={{ background: t.color + '33', borderColor: t.color }}>{t.name}</span>; })}
          </div>}

          {m && has(perms, PERM.MANAGE_ROLES) && (
            <details className="admin-block"><summary>Роли</summary>
              <div className="check-grid">{data.roles.filter((r) => !r.is_default).map((r) => {
                const on = m.roleIds.includes(r.id);
                const blocked = r.position >= myTop || (r.permissions & ~perms) !== 0 || (userId !== uid && targetTop >= myTop);
                return <label key={r.id} className={blocked ? 'disabled' : ''} title={blocked ? 'Роль выше вашей, содержит права, которых у вас нет, или участник выше вас' : ''}>
                  <input type="checkbox" checked={on} disabled={blocked} onChange={(e) => act('set_member_role', { p_community: community.id, p_user: userId, p_role: r.id, p_assign: e.target.checked }, 'Роли обновлены')} />
                  <span style={{ color: r.color }}>{r.name}</span></label>;
              })}</div>
            </details>
          )}
          {m && has(perms, PERM.MANAGE_TAGS) && data.tags.length > 0 && (
            <details className="admin-block"><summary>Метки</summary>
              <div className="check-grid">{data.tags.map((t) => (
                <label key={t.id}><input type="checkbox" checked={m.tagIds.includes(t.id)} onChange={(e) => act('set_member_tag', { p_user: userId, p_tag: t.id, p_assign: e.target.checked }, 'Метки обновлены')} />
                  <span style={{ color: t.color }}>{t.name}</span></label>
              ))}</div>
            </details>
          )}
          {m && (userId === uid || (canAct && has(perms, PERM.MANAGE_MEMBERS))) && (
            <details className="admin-block"><summary>Ник в сообществе</summary>
              <div className="row"><input value={nick} maxLength={32} onChange={(e) => setNick(e.target.value)} placeholder="Без ника" />
                <button className="btn" onClick={() => act('set_nickname', { p_community: community.id, p_user: userId, p_nickname: nick }, 'Ник сохранён')}>Сохранить</button></div>
            </details>
          )}
          {canAct && (has(perms, PERM.MANAGE_MEMBERS) || has(perms, PERM.MODERATE)) && (
            <details className="admin-block"><summary><Icon name="shield" size={14} /> Модерация</summary>
              <div className="stack">
                <Field label="Причина (попадёт в журнал аудита)"><input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></Field>
                {has(perms, PERM.MANAGE_MEMBERS) && <div className="row wrap">
                  {[[600, '10 мин'], [3600, '1 час'], [86400, '1 день'], [604800, '7 дней']].map(([s, l]) => (
                    <button key={s} className="btn small" onClick={() => act('timeout_member', { p_community: community.id, p_user: userId, p_seconds: s, p_reason: reason }, `Заглушён на ${l}`)}>Заглушить {l}</button>
                  ))}
                  {m.timeout_until && <button className="btn small" onClick={() => act('timeout_member', { p_community: community.id, p_user: userId, p_seconds: 0, p_reason: reason }, 'Заглушение снято')}>Снять</button>}
                  {data.voice.some((v) => v.user_id === userId) && <button className="btn small" onClick={() => act('voice_disconnect', { p_channel: data.voice.find((v) => v.user_id === userId)!.channel_id, p_user: userId }, 'Отключён от голоса')}>Отключить от голоса</button>}
                  <button className="btn small danger" onClick={() => confirm('Исключить участника? Он сможет вернуться по приглашению.') && act('kick_member', { p_community: community.id, p_user: userId, p_reason: reason }, 'Исключён').then(onClose)}>Исключить</button>
                </div>}
                {has(perms, PERM.MODERATE) && <>
                  <button className="btn small danger" onClick={() => confirm('Заблокировать участника? Он не сможет вернуться по приглашениям.') && act('ban_member', { p_community: community.id, p_user: userId, p_reason: reason }, 'Заблокирован').then(onClose)}>Заблокировать</button>
                  {community.xp_enabled && <div className="row"><input type="number" value={xpDelta} onChange={(e) => setXpDelta(Number(e.target.value))} aria-label="Изменение опыта" />
                    <button className="btn small" disabled={!xpDelta || reason.trim().length < 3} onClick={() => act('adjust_xp', { p_community: community.id, p_user: userId, p_delta: xpDelta, p_reason: reason }, 'Опыт скорректирован')}>Изменить XP</button></div>}
                </>}
              </div>
            </details>
          )}
          {m && community.owner_id === uid && userId !== uid && (
            <details className="admin-block danger-zone"><summary>Передать владение</summary>
              <p className="muted small">Вы станете обычным участником без особых прав. Действие необратимо без согласия нового владельца.</p>
              <button className="btn danger" onClick={async () => {
                const name = prompt(`Введите название сообщества «${community.name}» для подтверждения`);
                if (name !== null) await act('transfer_ownership', { p_community: community.id, p_new_owner: userId, p_confirm_name: name }, 'Владение передано');
              }}>Передать владение</button>
            </details>
          )}
        </div>
      )}
    </Modal>
  );
}
