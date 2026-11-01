import { useCallback, useEffect, useState } from 'react';
import { q, rpc, supabase, publicMediaUrl } from '../lib/supabase';
import { has, PERM, PERM_INFO, toggleBit } from '../lib/permissions';
import { COMMANDS } from '../lib/commands';
import type { Channel, ChannelKind, Invite, Role } from '../lib/types';
import { useCommunity } from '../state/community';
import { useSession } from '../state/session';
import { useToast } from '../state/toast';
import { Empty, ErrorBox, Field, Icon, Modal, Spinner, Toggle } from './ui';
import InviteCreator, { inviteUrl } from './InviteCreator';

type Tab = 'overview' | 'channels' | 'roles' | 'tags' | 'bans' | 'invites' | 'ranks' | 'bots' | 'audit' | 'resources';

export default function CommunitySettings({ onClose }: { onClose: () => void }) {
  const { data } = useCommunity();
  const [tab, setTab] = useState<Tab>('overview');
  if (!data) return null;
  const p = data.perms;
  const tabs: [Tab, string, boolean][] = [
    ['overview', 'Обзор', has(p, PERM.MANAGE_COMMUNITY)],
    ['channels', 'Каналы', has(p, PERM.MANAGE_CHANNELS)],
    ['roles', 'Роли', has(p, PERM.MANAGE_ROLES)],
    ['tags', 'Метки', has(p, PERM.MANAGE_TAGS)],
    ['invites', 'Приглашения', has(p, PERM.CREATE_INVITES)],
    ['bans', 'Баны', has(p, PERM.MODERATE)],
    ['ranks', 'Ранги', has(p, PERM.MANAGE_COMMUNITY)],
    ['bots', 'Боты', has(p, PERM.MANAGE_COMMUNITY) || has(p, PERM.MODERATE)],
    ['audit', 'Журнал', has(p, PERM.MODERATE)],
    ['resources', 'Ресурсы и расходы', true],
  ];
  const visible = tabs.filter((t) => t[2]);
  const current = visible.some((t) => t[0] === tab) ? tab : visible[0][0];
  return (
    <Modal title={`Настройки: ${data.community.name}`} onClose={onClose} wide>
      <div className="settings-layout">
        <nav className="settings-nav">{visible.map(([k, l]) => <button key={k} className={current === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
        <div className="settings-pane">
          {current === 'overview' && <Overview onClose={onClose} />}
          {current === 'channels' && <Channels />}
          {current === 'roles' && <Roles />}
          {current === 'tags' && <Tags />}
          {current === 'invites' && <Invites />}
          {current === 'bans' && <Bans />}
          {current === 'ranks' && <Ranks />}
          {current === 'bots' && <Bots />}
          {current === 'audit' && <Audit />}
          {current === 'resources' && <Resources />}
        </div>
      </div>
    </Modal>
  );
}

function useAct() {
  const toast = useToast(); const { reload } = useCommunity();
  return useCallback(async (fn: string, args: Record<string, unknown>, ok?: string) => {
    try { const r = await rpc(fn, args); if (ok) toast.push(ok, 'ok'); await reload(); return r; } catch (e) { toast.fail(e); return undefined; }
  }, [toast, reload]);
}

function Overview({ onClose }: { onClose: () => void }) {
  const { data } = useCommunity(); const { uid } = useSession(); const act = useAct(); const toast = useToast();
  const c = data!.community;
  const [f, setF] = useState({ name: c.name, description: c.description, rules: c.rules, accent_color: c.accent_color, voice_mesh_limit: c.voice_mesh_limit });
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024 || !/^image\/(png|jpeg|gif|webp)$/.test(file.type)) { toast.push('Иконка: PNG/JPEG/GIF/WebP до 2 МБ', 'error'); return; }
    const path = `communities/${c.id}/icon-${Date.now()}.${file.type.split('/')[1]}`;
    const { error } = await supabase.storage.from('public-media').upload(path, file, { contentType: file.type });
    if (error) { toast.fail(error); return; }
    await act('update_community', { p_id: c.id, p: { icon_path: path } }, 'Иконка обновлена');
  };
  return (
    <div className="stack">
      <div className="row">
        <div className="icon-preview">{c.icon_path ? <img src={publicMediaUrl(c.icon_path)!} alt="" /> : <Icon name="sprout" size={32} />}</div>
        <label className="btn">Загрузить иконку<input type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => upload(e.target.files?.[0])} /></label>
        {c.icon_path && <button className="btn ghost" onClick={() => act('update_community', { p_id: c.id, p: { icon_path: null } }, 'Иконка убрана')}>Убрать</button>}
      </div>
      <Field label="Название"><input value={f.name} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Описание"><textarea value={f.description} maxLength={500} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Правила" hint="Показываются участникам; до 4000 символов"><textarea rows={6} value={f.rules} maxLength={4000} onChange={(e) => setF({ ...f, rules: e.target.value })} /></Field>
      <Field label="Цвет сообщества"><input type="color" value={f.accent_color} onChange={(e) => setF({ ...f, accent_color: e.target.value })} /></Field>
      <Field label="Лимит участников голосовой комнаты (mesh)" hint="2–8. В mesh каждый отправляет поток каждому: больше 6 обычно тяжело для слабых сетей. Для больших звонков нужен SFU (README).">
        <input type="number" min={2} max={8} value={f.voice_mesh_limit} onChange={(e) => setF({ ...f, voice_mesh_limit: Number(e.target.value) })} /></Field>
      <button className="btn primary" onClick={() => act('update_community', { p_id: c.id, p: f }, 'Сохранено')}>Сохранить</button>
      {c.owner_id === uid && (
        <details className="admin-block danger-zone"><summary>Удалить сообщество</summary>
          <p className="muted small">Удалятся все каналы, сообщения и роли. Файлы вложений в Storage нужно будет очистить отдельно (см. README).</p>
          <button className="btn danger" onClick={async () => {
            const n = prompt(`Введите «${c.name}» для подтверждения`);
            if (n !== null && (await act('delete_community', { p_id: c.id, p_confirm_name: n }, 'Сообщество удалено')) !== undefined) { onClose(); location.assign('/app'); }
          }}>Удалить навсегда</button>
        </details>
      )}
    </div>
  );
}

function Channels() {
  const { data } = useCommunity(); const act = useAct();
  const { categories, channels, community } = data!;
  const [newCh, setNewCh] = useState({ name: '', kind: 'text' as ChannelKind, category: '' });
  const [newCat, setNewCat] = useState('');
  const [editing, setEditing] = useState<Channel | null>(null);
  const move = async (list: Channel[], i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= list.length) return;
    const arr = [...list]; [arr[i], arr[j]] = [arr[j], arr[i]];
    await act('reorder_layout', { p_community: community.id, p_items: arr.map((c, k) => ({ type: 'channel', id: c.id, position: k, category_id: c.category_id })) });
  };
  const moveCat = async (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= categories.length) return;
    const arr = [...categories]; [arr[i], arr[j]] = [arr[j], arr[i]];
    await act('reorder_layout', { p_community: community.id, p_items: arr.map((c, k) => ({ type: 'category', id: c.id, position: k })) });
  };
  const groups: [string | null, string][] = [[null, 'Без категории'], ...categories.map((c) => [c.id, c.name] as [string, string])];
  return (
    <div className="stack">
      <form className="row wrap" onSubmit={(e) => { e.preventDefault(); void act('create_channel', { p_community: community.id, p_name: newCh.name, p_kind: newCh.kind, p_category: newCh.category || null }, 'Канал создан'); setNewCh({ ...newCh, name: '' }); }}>
        <input required placeholder="Новый канал" maxLength={40} value={newCh.name} onChange={(e) => setNewCh({ ...newCh, name: e.target.value })} />
        <select value={newCh.kind} onChange={(e) => setNewCh({ ...newCh, kind: e.target.value as ChannelKind })}>
          <option value="text">Текстовый</option><option value="announcement">Объявления</option><option value="voice">Голосовой</option></select>
        <select value={newCh.category} onChange={(e) => setNewCh({ ...newCh, category: e.target.value })}>
          <option value="">Без категории</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <button className="btn primary">Создать</button>
      </form>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void act('create_category', { p_community: community.id, p_name: newCat }, 'Категория создана'); setNewCat(''); }}>
        <input required placeholder="Новая категория" maxLength={40} value={newCat} onChange={(e) => setNewCat(e.target.value)} /><button className="btn">Добавить категорию</button>
      </form>
      {groups.map(([catId, title]) => {
        const list = channels.filter((c) => c.category_id === catId);
        const ci = categories.findIndex((c) => c.id === catId);
        if (catId === null && !list.length) return null;
        return (
          <section key={catId ?? 'none'} className="admin-list">
            <h4 className="row">{title}
              {catId && <span className="row-actions">
                <button className="icon-btn" onClick={() => moveCat(ci, -1)} aria-label="Выше"><Icon name="arrowUp" size={14} /></button>
                <button className="icon-btn" onClick={() => moveCat(ci, 1)} aria-label="Ниже"><Icon name="arrowDown" size={14} /></button>
                <button className="icon-btn" onClick={() => { const n = prompt('Новое название категории', title); if (n) void act('update_category', { p_id: catId, p_name: n }); }} aria-label="Переименовать"><Icon name="edit" size={14} /></button>
                <button className="icon-btn danger" onClick={() => confirm('Удалить категорию? Каналы останутся без категории.') && act('delete_category', { p_id: catId })} aria-label="Удалить"><Icon name="trash" size={14} /></button>
              </span>}
            </h4>
            <ul>{list.map((c, i) => (
              <li key={c.id} className="row">
                <Icon name={c.kind === 'voice' ? 'speaker' : c.kind === 'announcement' ? 'megaphone' : 'hash'} size={15} />
                <span className="grow">{c.name}</span>
                <span className="row-actions">
                  <button className="icon-btn" onClick={() => move(list, i, -1)} aria-label="Выше"><Icon name="arrowUp" size={14} /></button>
                  <button className="icon-btn" onClick={() => move(list, i, 1)} aria-label="Ниже"><Icon name="arrowDown" size={14} /></button>
                  <button className="icon-btn" onClick={() => setEditing(c)} aria-label="Настроить"><Icon name="settings" size={14} /></button>
                  <button className="icon-btn danger" onClick={() => confirm(`Удалить канал «${c.name}» вместе с историей?`) && act('delete_channel', { p_id: c.id }, 'Канал удалён')} aria-label="Удалить"><Icon name="trash" size={14} /></button>
                </span>
              </li>
            ))}</ul>
          </section>
        );
      })}
      {editing && <ChannelEditor channel={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

const OVERWRITE_PERMS = ['VIEW_CHANNELS', 'SEND_MESSAGES', 'ATTACH_FILES', 'ADD_REACTIONS', 'MANAGE_MESSAGES', 'CONNECT_VOICE', 'STREAM_VIDEO', 'USE_COMMANDS'] as const;

function ChannelEditor({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const { data } = useCommunity(); const act = useAct();
  const [f, setF] = useState({ name: channel.name, topic: channel.topic, slowmode_seconds: channel.slowmode_seconds, category_id: channel.category_id });
  const [ow, setOw] = useState<{ role_id: string; allow: number; deny: number }[] | null>(null);
  const [roleId, setRoleId] = useState(data!.roles.find((r) => r.is_default)!.id);
  const loadOw = useCallback(() => {
    q<{ role_id: string; allow: number; deny: number }[]>(supabase.from('channel_overwrites').select('role_id, allow, deny').eq('channel_id', channel.id)).then(setOw).catch(() => setOw([]));
  }, [channel.id]);
  useEffect(loadOw, [loadOw]);
  const cur = ow?.find((o) => o.role_id === roleId) ?? { role_id: roleId, allow: 0, deny: 0 };
  const setState = async (bit: number, state: 'allow' | 'deny' | 'inherit') => {
    const allow = toggleBit(cur.allow, bit, state === 'allow'); const deny = toggleBit(cur.deny, bit, state === 'deny');
    await act('set_channel_overwrite', { p_channel: channel.id, p_role: roleId, p_allow: allow, p_deny: deny }); loadOw();
  };
  const assignable = data!.roles.filter((r) => r.is_default || r.position < data!.myTop);
  return (
    <Modal title={`Канал: ${channel.name}`} onClose={onClose} wide>
      <div className="stack">
        <Field label="Название"><input value={f.name} maxLength={40} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        {channel.kind !== 'voice' && <>
          <Field label="Тема"><input value={f.topic} maxLength={300} onChange={(e) => setF({ ...f, topic: e.target.value })} /></Field>
          <Field label="Медленный режим" hint="Пауза между сообщениями одного участника (модераторы не ограничены)">
            <select value={f.slowmode_seconds} onChange={(e) => setF({ ...f, slowmode_seconds: Number(e.target.value) })}>
              {[0, 5, 10, 30, 60, 300, 900, 3600].map((s) => <option key={s} value={s}>{s ? `${s} с` : 'Выключен'}</option>)}</select></Field>
        </>}
        <Field label="Категория"><select value={f.category_id ?? ''} onChange={(e) => setF({ ...f, category_id: e.target.value || null })}>
          <option value="">Без категории</option>{data!.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <button className="btn primary" onClick={() => act('update_channel', { p_id: channel.id, p: f }, 'Канал сохранён')}>Сохранить</button>
        <h4>Права в канале</h4>
        <p className="muted small">Переопределения применяются поверх прав роли. Запрет «Просмотра» для роли «Участники» делает канал приватным.</p>
        <Field label="Роль"><select value={roleId} onChange={(e) => setRoleId(e.target.value)}>{assignable.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        {!ow ? <Spinner /> : <table className="perm-table"><tbody>{OVERWRITE_PERMS.map((k) => {
          const bit = PERM[k]; const st = cur.allow & bit ? 'allow' : cur.deny & bit ? 'deny' : 'inherit';
          const info = PERM_INFO.find((x) => x.key === k)!;
          return <tr key={k}><td>{info.label}</td><td className="tri">
            {(['deny', 'inherit', 'allow'] as const).map((s) => (
              <button key={s} className={`tri-${s} ${st === s ? 'on' : ''}`} onClick={() => setState(bit, s)} aria-pressed={st === s}>{s === 'deny' ? '✕' : s === 'allow' ? '✓' : '/'}</button>
            ))}</td></tr>;
        })}</tbody></table>}
      </div>
    </Modal>
  );
}

function Roles() {
  const { data } = useCommunity(); const act = useAct();
  const { roles, community, myTop, perms } = data!;
  const [edit, setEdit] = useState<Role | null>(null);
  const editable = (r: Role) => r.is_default || r.position < myTop;
  const swap = async (i: number, dir: -1 | 1) => {
    const a = roles[i]; const b = roles[i + dir];
    if (!a || !b || a.is_default || b.is_default || !editable(a) || !editable(b)) return;
    await act('update_role', { p_id: a.id, p: { position: b.position } });
    await act('update_role', { p_id: b.id, p: { position: a.position } });
  };
  return (
    <div className="stack">
      <button className="btn primary" onClick={() => act('create_role', { p_community: community.id, p_name: 'Новая роль', p_color: '#9aa7b2', p_permissions: 0 }, 'Роль создана')}><Icon name="plus" /> Создать роль</button>
      <p className="muted small">Выше в списке — выше по иерархии. Вы можете менять только роли ниже своей ({myTop >= 1e6 ? 'вы владелец' : `ваша позиция ${myTop}`}) и выдавать только права, которые есть у вас.</p>
      <ul className="admin-list">{roles.map((r, i) => (
        <li key={r.id} className="row">
          <i className="role-dot" style={{ background: r.color }} />
          <span className="grow">{r.name}{r.is_default && <small className="muted"> — базовая роль всех участников</small>}</span>
          <small className="muted">{data!.members.filter((m) => m.roleIds.includes(r.id)).length || ''}</small>
          {editable(r) && <span className="row-actions">
            {!r.is_default && <><button className="icon-btn" onClick={() => swap(i, -1)} aria-label="Выше"><Icon name="arrowUp" size={14} /></button>
              <button className="icon-btn" onClick={() => swap(i, 1)} aria-label="Ниже"><Icon name="arrowDown" size={14} /></button></>}
            <button className="icon-btn" onClick={() => setEdit(r)} aria-label="Изменить"><Icon name="edit" size={14} /></button>
            {!r.is_default && <button className="icon-btn danger" onClick={() => confirm(`Удалить роль «${r.name}»?`) && act('delete_role', { p_id: r.id }, 'Роль удалена')} aria-label="Удалить"><Icon name="trash" size={14} /></button>}
          </span>}
        </li>
      ))}</ul>
      {edit && <RoleEditor role={edit} myPerms={perms} onClose={() => setEdit(null)} />}
    </div>
  );
}

function RoleEditor({ role, myPerms, onClose }: { role: Role; myPerms: number; onClose: () => void }) {
  const act = useAct();
  const [f, setF] = useState({ name: role.name, color: role.color, permissions: Number(role.permissions) });
  const groups = [...new Set(PERM_INFO.map((p) => p.group))];
  return (
    <Modal title={`Роль: ${role.name}`} onClose={onClose} wide footer={<button className="btn primary" onClick={async () => { await act('update_role', { p_id: role.id, p: f }, 'Роль сохранена'); onClose(); }}>Сохранить</button>}>
      <div className="stack">
        <div className="row"><Field label="Название"><input value={f.name} maxLength={32} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Цвет"><input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} /></Field></div>
        {groups.map((g) => (
          <section key={g}><h4>{g}</h4>
            {PERM_INFO.filter((p) => p.group === g).map((p) => {
              const bit = PERM[p.key]; const mine = has(myPerms, bit);
              const blocked = !mine || (role.is_default && p.key === 'ADMINISTRATOR');
              return <Toggle key={p.key} label={p.label + (blocked ? ' 🔒' : '')} hint={blocked ? 'У вас нет этого права — выдать его нельзя' : p.hint}
                checked={has(f.permissions, bit)} onChange={(v) => !blocked && setF({ ...f, permissions: toggleBit(f.permissions, bit, v) })} />;
            })}
          </section>
        ))}
      </div>
    </Modal>
  );
}

function Tags() {
  const { data } = useCommunity(); const act = useAct();
  const [f, setF] = useState({ id: null as string | null, name: '', color: '#c9a227', description: '' });
  return (
    <div className="stack">
      <p className="muted small">Метки — подписи для участников (например «Художник», «Новичок»). Они видны в профиле и списке участников, но прав не дают.</p>
      <form className="row wrap" onSubmit={(e) => { e.preventDefault(); void act('upsert_tag', { p_community: data!.community.id, p_id: f.id, p_name: f.name, p_color: f.color, p_description: f.description }, 'Метка сохранена'); setF({ id: null, name: '', color: '#c9a227', description: '' }); }}>
        <input required maxLength={24} placeholder="Название" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} aria-label="Цвет" />
        <input maxLength={120} placeholder="Описание" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <button className="btn primary">{f.id ? 'Сохранить' : 'Создать'}</button>
      </form>
      {!data!.tags.length ? <Empty icon="star" title="Меток пока нет" /> : <ul className="admin-list">{data!.tags.map((t) => (
        <li key={t.id} className="row"><span className="chip tag" style={{ background: t.color + '33', borderColor: t.color }}>{t.name}</span><span className="grow muted">{t.description}</span>
          <small className="muted">{data!.members.filter((m) => m.tagIds.includes(t.id)).length}</small>
          <button className="icon-btn" onClick={() => setF({ id: t.id, name: t.name, color: t.color, description: t.description })} aria-label="Изменить"><Icon name="edit" size={14} /></button>
          <button className="icon-btn danger" onClick={() => act('delete_tag', { p_id: t.id }, 'Метка удалена')} aria-label="Удалить"><Icon name="trash" size={14} /></button></li>
      ))}</ul>}
    </div>
  );
}

function Invites() {
  const { data, displayName } = useCommunity(); const act = useAct();
  const [list, setList] = useState<Invite[] | null>(null);
  const load = useCallback(() => {
    q<Invite[]>(supabase.from('invites').select('*').eq('community_id', data!.community.id).is('revoked_at', null).order('created_at', { ascending: false })).then(setList).catch(() => setList([]));
  }, [data]);
  useEffect(load, [load]);
  const active = (i: Invite) => (!i.expires_at || new Date(i.expires_at) > new Date()) && (!i.max_uses || i.uses < i.max_uses);
  return (
    <div className="stack">
      <InviteCreator cid={data!.community.id} onCreated={load} />
      <h4>Действующие приглашения</h4>
      {!list ? <Spinner /> : !list.length ? <p className="muted">Нет приглашений, которые вы можете видеть.</p> : (
        <ul className="admin-list">{list.map((i) => (
          <li key={i.code} className={`row ${active(i) ? '' : 'muted'}`}>
            <code className="grow" title={inviteUrl(i.code)}>{i.code}</code>
            <small>{displayName(i.created_by)}</small>
            <small>{i.uses}{i.max_uses ? `/${i.max_uses}` : ''} исп.</small>
            <small>{i.expires_at ? (active(i) ? `до ${new Date(i.expires_at).toLocaleString('ru-RU')}` : 'истекло') : 'бессрочно'}</small>
            <button className="btn small danger" onClick={async () => { await act('revoke_invite', { p_code: i.code }, 'Отозвано'); load(); }}>Отозвать</button>
          </li>
        ))}</ul>
      )}
    </div>
  );
}

function Bans() {
  const { data } = useCommunity(); const act = useAct();
  const [list, setList] = useState<{ user_id: string; reason: string; created_at: string; profiles: { handle: string; display_name: string } }[] | null>(null);
  const load = useCallback(() => {
    q<typeof list>(supabase.from('community_bans').select('user_id, reason, created_at, profiles!community_bans_user_id_fkey(handle, display_name)').eq('community_id', data!.community.id)).then(setList).catch(() => setList([]));
  }, [data]);
  useEffect(load, [load]);
  if (!list) return <Spinner />;
  if (!list.length) return <Empty icon="shield" title="Заблокированных нет" />;
  return <ul className="admin-list">{list.map((b) => (
    <li key={b.user_id} className="row"><span className="grow">{b.profiles?.display_name} <small className="muted">@{b.profiles?.handle}</small></span>
      <small className="muted">{b.reason || 'без причины'} · {new Date(b.created_at).toLocaleDateString('ru-RU')}</small>
      <button className="btn small" onClick={async () => { await act('unban_member', { p_community: data!.community.id, p_user: b.user_id }, 'Разблокирован'); load(); }}>Разблокировать</button></li>
  ))}</ul>;
}

function Ranks() {
  const { data } = useCommunity(); const act = useAct();
  const c = data!.community;
  const [f, setF] = useState({ xp_enabled: c.xp_enabled, xp_per_message: c.xp_per_message, xp_cooldown_seconds: c.xp_cooldown_seconds, xp_daily_cap: c.xp_daily_cap, xp_min_length: c.xp_min_length });
  const num = (k: keyof typeof f, label: string, min: number, max: number, hint?: string) => (
    <Field label={label} hint={hint ?? `${min}–${max}`}><input type="number" min={min} max={max} value={f[k] as number} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} /></Field>
  );
  return (
    <div className="stack">
      <Toggle label="Система опыта и рангов" hint="Опыт начисляется только сервером. Отключение не стирает накопленное." checked={f.xp_enabled} onChange={(v) => setF({ ...f, xp_enabled: v })} />
      {num('xp_per_message', 'XP за сообщение', 1, 100)}
      {num('xp_cooldown_seconds', 'Пауза между начислениями, с', 10, 3600, 'Сообщения чаще не дают опыта — защита от флуда')}
      {num('xp_daily_cap', 'Дневной лимит XP на участника', 10, 5000)}
      {num('xp_min_length', 'Минимальная длина сообщения', 1, 200, 'Короткие «ок», «+» не награждаются')}
      <button className="btn primary" onClick={() => act('update_community', { p_id: c.id, p: f }, 'Сохранено')}>Сохранить</button>
      <p className="muted small">Ручные корректировки (модерация → «Изменить XP») требуют причины и пишутся в журнал. Достижения и роли за уровни — следующий этап (см. README).</p>
    </div>
  );
}

function Bots() {
  const { data, displayName } = useCommunity(); const act = useAct();
  const [modules, setModules] = useState<{ bot_key: string; name: string; description: string; is_example: boolean }[] | null>(null);
  const [log, setLog] = useState<{ id: number; user_id: string; command: string; ok: boolean; error: string | null; created_at: string }[] | null>(null);
  useEffect(() => {
    q<typeof modules>(supabase.from('bot_modules').select('*')).then(setModules).catch(() => setModules([]));
    if (has(data!.perms, PERM.MODERATE)) q<typeof log>(supabase.from('bot_command_log').select('*').eq('community_id', data!.community.id).order('id', { ascending: false }).limit(50)).then(setLog).catch(() => setLog([]));
  }, [data]);
  if (!modules) return <Spinner />;
  return (
    <div className="stack">
      <div className="note">Боты DiggersBtwModes в исходных материалах не найдены и не перенесены — см. <code>docs/DIGGERS_BOTS_TODO.md</code>. Здесь только модули, реально существующие в этой базе.</div>
      {modules.map((m) => {
        const en = data!.bots.find((b) => b.bot_key === m.bot_key)?.enabled ?? false;
        return (
          <div key={m.bot_key} className="bot-card">
            <Toggle label={`${m.name}${m.is_example ? ' · пример' : ''}`} hint={m.description} checked={en}
              onChange={(v) => has(data!.perms, PERM.MANAGE_COMMUNITY) && act('set_bot_enabled', { p_community: data!.community.id, p_bot_key: m.bot_key, p_enabled: v }, v ? 'Модуль включён' : 'Модуль выключен')} />
            <ul className="muted small">{COMMANDS.filter((c) => c.module === m.bot_key).map((c) => <li key={c.name}><code>{c.usage}</code> — {c.description}</li>)}</ul>
          </div>
        );
      })}
      {log && <><h4>Журнал команд</h4>{!log.length ? <p className="muted">Пусто.</p> : <ul className="admin-list">{log.map((l) => (
        <li key={l.id} className="row"><code>/{l.command}</code><span className="grow">{displayName(l.user_id)}</span>
          <small className={l.ok ? 'muted' : 'err-text'}>{l.ok ? 'ok' : l.error}</small><small className="muted">{new Date(l.created_at).toLocaleString('ru-RU')}</small></li>
      ))}</ul>}</>}
    </div>
  );
}

const ACTIONS: Record<string, string> = {
  'community.create': 'создал(а) сообщество', 'community.update': 'изменил(а) настройки', 'community.transfer': 'передал(а) владение',
  'invite.create': 'создал(а) приглашение', 'invite.revoke': 'отозвал(а) приглашение', 'member.join': 'вступил(а)', 'member.kick': 'исключил(а) участника',
  'member.ban': 'заблокировал(а)', 'member.unban': 'разблокировал(а)', 'member.timeout': 'заглушил(а)', 'role.create': 'создал(а) роль', 'role.update': 'изменил(а) роль',
  'role.delete': 'удалил(а) роль', 'role.assign': 'выдал(а) роль', 'role.remove': 'снял(а) роль', 'channel.create': 'создал(а) канал', 'channel.update': 'изменил(а) канал',
  'channel.delete': 'удалил(а) канал', 'channel.overwrite': 'изменил(а) права канала', 'category.create': 'создал(а) категорию', 'category.update': 'переименовал(а) категорию',
  'category.delete': 'удалил(а) категорию', 'layout.reorder': 'изменил(а) порядок каналов', 'message.delete': 'удалил(а) чужое сообщение', 'message.pin': 'закрепил(а) сообщение',
  'message.unpin': 'открепил(а) сообщение', 'tag.upsert': 'сохранил(а) метку', 'tag.delete': 'удалил(а) метку', 'tag.assign': 'выдал(а) метку', 'tag.remove': 'снял(а) метку',
  'xp.adjust': 'скорректировал(а) опыт', 'bot.toggle': 'переключил(а) модуль бота', 'voice.disconnect': 'отключил(а) от голоса',
};

function Audit() {
  const { data, displayName } = useCommunity();
  const [rows, setRows] = useState<{ id: number; actor_id: string; action: string; target_type: string; target_id: string; details: Record<string, unknown>; created_at: string }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { q<typeof rows>(supabase.from('audit_log').select('*').eq('community_id', data!.community.id).order('id', { ascending: false }).limit(100)).then(setRows).catch((e) => setErr(e.message)); }, [data]);
  if (err) return <ErrorBox error={err} />;
  if (!rows) return <Spinner />;
  return <ul className="admin-list audit">{rows.map((r) => (
    <li key={r.id}><b>{displayName(r.actor_id)}</b> {ACTIONS[r.action] ?? r.action}
      {r.target_type === 'user' && <> → <b>{displayName(r.target_id)}</b></>}
      {typeof r.details?.reason === 'string' && r.details.reason && <span className="muted"> — «{r.details.reason}»</span>}
      <small className="muted"> · {new Date(r.created_at).toLocaleString('ru-RU')}</small></li>
  ))}</ul>;
}

function Resources() {
  return (
    <div className="stack prose">
      <p><b>Для участников всё бесплатно</b>: сообщества, каналы, роли, звонки, оформление, метки и ранги не продаются и не блокируются подпиской.</p>
      <p>Платит (если вообще платит) <b>владелец инстанса</b> — тот, кто развернул приложение и подключил Supabase. Расходы зависят от тарифов провайдеров:</p>
      <ul>
        <li><b>База данных и Storage</b> (Supabase): вложения до 10 МБ, иконки и аватары до 2 МБ. Квоты бесплатного тарифа меняются — проверяйте Usage в панели Supabase.</li>
        <li><b>Realtime</b>: сообщения и сигнализация звонков; лимиты одновременных подключений и сообщений зависят от тарифа.</li>
        <li><b>Звонки</b>: в режиме mesh медиа идут напрямую между участниками и не стоят инстансу денег, пока не нужен TURN-ретранслятор. TURN тарифицируется по трафику. Лимит mesh-комнаты — {`2–8`} участников.</li>
        <li><b>Исходящий трафик</b> (скачивание вложений) тарифицируется Storage-провайдером.</li>
      </ul>
      <p className="muted small">Мониторинг, квоты и переход на платный тариф описаны в README → «Расходы и лимиты». Платные внешние API не подключаются без явной настройки владельцем инстанса.</p>
    </div>
  );
}
