import { useEffect, useRef, useState } from 'react';
import { q, rpc, supabase } from '../lib/supabase';
import { humanError } from '../lib/errors';
import type { ProfilePrivate, UserSettings as US, Visibility } from '../lib/types';
import { useSession } from '../state/session';
import { useToast } from '../state/toast';
import { getMic, levelMeter } from '../lib/rtc/devices';
import { Avatar, Field, Modal, Toggle } from './ui';
import { DevicePicker } from './VoiceView';

type Tab = 'profile' | 'privacy' | 'appearance' | 'a11y' | 'notify' | 'devices' | 'account';
const TABS: [Tab, string][] = [['profile', 'Профиль'], ['privacy', 'Приватность'], ['appearance', 'Внешний вид'], ['a11y', 'Доступность'], ['notify', 'Уведомления'], ['devices', 'Устройства'], ['account', 'Аккаунт']];
const ZONES = (() => { try { return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['UTC']; } catch { return ['UTC']; } })();

export default function UserSettings({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('profile');
  return (
    <Modal title="Настройки" onClose={onClose} wide>
      <div className="settings-layout">
        <nav className="settings-nav">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
        <div className="settings-pane">
          {tab === 'profile' && <ProfileTab />}
          {tab === 'privacy' && <PrivacyTab />}
          {tab === 'appearance' && <AppearanceTab />}
          {tab === 'a11y' && <A11yTab />}
          {tab === 'notify' && <NotifyTab />}
          {tab === 'devices' && <DevicesTab />}
          {tab === 'account' && <AccountTab />}
        </div>
      </div>
    </Modal>
  );
}

async function savePriv(uid: string, patch: Partial<ProfilePrivate>) {
  await q(supabase.from('profile_private').update(patch).eq('user_id', uid));
}

function ProfileTab() {
  const { profile, priv, uid, reloadProfile } = useSession(); const toast = useToast();
  const [f, setF] = useState({ display_name: profile?.display_name ?? '', handle: profile?.handle ?? '', bio: priv?.bio ?? '', status_text: priv?.status_text ?? '',
    presence: priv?.presence ?? 'online', timezone: priv?.timezone ?? 'UTC' });
  if (!profile || !uid) return null;
  const save = async () => {
    try {
      await rpc('update_profile', { p: { display_name: f.display_name, handle: f.handle } });
      await savePriv(uid, { bio: f.bio, status_text: f.status_text, presence: f.presence as ProfilePrivate['presence'], timezone: f.timezone });
      await reloadProfile(); toast.push('Профиль сохранён', 'ok');
    } catch (e) { toast.fail(e); }
  };
  const upload = async (file?: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024 || !/^image\/(png|jpeg|gif|webp)$/.test(file.type)) { toast.push('Аватар: PNG/JPEG/GIF/WebP до 2 МБ', 'error'); return; }
    const path = `avatars/${uid}/a-${Date.now()}.${file.type.split('/')[1]}`;
    const { error } = await supabase.storage.from('public-media').upload(path, file, { contentType: file.type });
    if (error) { toast.fail(error); return; }
    try {
      await rpc('update_profile', { p: { avatar_path: path } });
      if (profile.avatar_path) await supabase.storage.from('public-media').remove([profile.avatar_path]);
      await reloadProfile(); toast.push('Аватар обновлён', 'ok');
    } catch (e) { toast.fail(e); }
  };
  return (
    <div className="stack">
      <div className="row"><Avatar name={profile.display_name} path={profile.avatar_path} size={72} />
        <label className="btn">Загрузить аватар<input type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => upload(e.target.files?.[0])} /></label>
        <span className="muted small">Аватары публичны по ссылке.</span></div>
      <Field label="Отображаемое имя"><input value={f.display_name} maxLength={40} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></Field>
      <Field label="Handle" hint="Уникален; менять можно до 5 раз в сутки"><input value={f.handle} maxLength={32} onChange={(e) => setF({ ...f, handle: e.target.value.toLowerCase() })} /></Field>
      <Field label="О себе"><textarea value={f.bio} maxLength={300} onChange={(e) => setF({ ...f, bio: e.target.value })} /></Field>
      <div className="row wrap">
        <Field label="Статус"><select value={f.presence} onChange={(e) => setF({ ...f, presence: e.target.value as ProfilePrivate['presence'] })}>
          <option value="online">В сети</option><option value="idle">Отошёл</option><option value="dnd">Не беспокоить</option><option value="invisible">Невидимка</option></select></Field>
        <Field label="Текст статуса"><input value={f.status_text} maxLength={80} onChange={(e) => setF({ ...f, status_text: e.target.value })} /></Field>
      </div>
      <Field label="Часовой пояс"><select value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>{ZONES.map((z) => <option key={z}>{z}</option>)}</select></Field>
      <p className="muted small">Аккаунт создан {new Date(profile.created_at).toLocaleDateString('ru-RU')}.</p>
      <button className="btn primary" onClick={save}>Сохранить</button>
    </div>
  );
}

function PrivacyTab() {
  const { priv, uid, reloadProfile } = useSession(); const toast = useToast();
  if (!priv || !uid) return null;
  const sel = (k: keyof ProfilePrivate, label: string) => (
    <Field label={label}><select value={priv[k] as Visibility} onChange={async (e) => {
      try { await savePriv(uid, { [k]: e.target.value } as Partial<ProfilePrivate>); await reloadProfile(); } catch (err) { toast.fail(err); }
    }}><option value="everyone">Все</option><option value="members">Участники общих сообществ</option><option value="nobody">Никто</option></select></Field>
  );
  return (
    <div className="stack">
      <p className="muted small">Имя, handle и аватар видны всем, кто встречает вас в сообществах. Остальное — по вашему выбору. Проверка выполняется на сервере.</p>
      {sel('bio_visibility', 'Кто видит «О себе»')}
      {sel('status_visibility', 'Кто видит статус')}
      {sel('timezone_visibility', 'Кто видит часовой пояс')}
      {sel('created_visibility', 'Кто видит дату регистрации')}
      <p className="muted small">Режим «Невидимка» (Профиль → Статус) скрывает вас из списка «в сети».</p>
    </div>
  );
}

function AppearanceTab() {
  const { settings: s, setSettings } = useSession();
  const themes: [US['theme'], string][] = [['meadow', 'Луг (светлая)'], ['moss', 'Мох (тёмная)'], ['clay', 'Глина (тёплая тёмная)'], ['night', 'Ночь (OLED)']];
  return (
    <div className="stack">
      <div className="theme-grid">{themes.map(([k, l]) => <button key={k} data-preview={k} className={`theme-card ${s.theme === k ? 'active' : ''}`} onClick={() => setSettings({ theme: k })}>{l}</button>)}</div>
      <Field label="Акцентный цвет"><input type="color" value={s.accent} onChange={(e) => setSettings({ accent: e.target.value })} /></Field>
      <Field label="Плотность"><select value={s.density} onChange={(e) => setSettings({ density: e.target.value as US['density'] })}><option value="cozy">Просторно</option><option value="compact">Компактно</option></select></Field>
      <Field label={`Размер шрифта: ${s.fontSize}px`}><input type="range" min={12} max={20} value={s.fontSize} onChange={(e) => setSettings({ fontSize: Number(e.target.value) })} /></Field>
            <p className="muted small">Настройки синхронизируются между устройствами через ваш аккаунт.</p>
    </div>
  );
}

function A11yTab() {
  const { settings: s, setSettings } = useSession();
  return (
    <div className="stack">
      <Toggle label="Уменьшить анимации" hint="Также учитывается системная настройка" checked={s.reducedMotion} onChange={(v) => setSettings({ reducedMotion: v })} />
      <Toggle label="Высокий контраст" checked={s.highContrast} onChange={(v) => setSettings({ highContrast: v })} />
      <p className="muted small">Все действия доступны с клавиатуры: Tab — переход, Enter — отправить, Shift+Enter — новая строка, Esc — закрыть окно или отменить ответ.</p>
    </div>
  );
}

function NotifyTab() {
  const { settings: s, setSettings } = useSession();
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  return (
    <div className="stack">
      <Toggle label="Уведомления на рабочем столе" hint={perm === 'unsupported' ? 'Браузер не поддерживает уведомления' : perm === 'denied' ? 'Запрещены в настройках браузера' : 'Пока вкладка открыта'}
        checked={s.notifyDesktop && perm === 'granted'} onChange={async (v) => {
          if (v && perm !== 'granted' && typeof Notification !== 'undefined') { const p = await Notification.requestPermission(); setPerm(p); if (p !== 'granted') return; }
          setSettings({ notifyDesktop: v });
        }} />
      <Toggle label="Только упоминания" hint="Иначе — о любом новом сообщении в доступных каналах" checked={s.notifyMentionsOnly} onChange={(v) => setSettings({ notifyMentionsOnly: v })} />
      <Toggle label="Звук" checked={s.notifySound} onChange={(v) => setSettings({ notifySound: v })} />
      <p className="muted small">Push-уведомления при закрытой вкладке требуют Web Push и сервис-воркера — это следующий этап (README → «Дорожная карта»).</p>
    </div>
  );
}

function DevicesTab() {
  const { settings: s, setSettings } = useSession(); const toast = useToast();
  const [picker, setPicker] = useState(false);
  const [level, setLevel] = useState<number | null>(null);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  const test = async () => {
    if (stop.current) { stop.current(); stop.current = null; setLevel(null); return; }
    try {
      const m = await getMic(s.micId, s);
      const off = levelMeter(m, setLevel);
      stop.current = () => { off(); m.getTracks().forEach((t) => t.stop()); };
    } catch (e) { toast.fail(e); }
  };
  return (
    <div className="stack">
      <button className="btn" onClick={() => setPicker(true)}>Выбрать микрофон, камеру и динамики</button>
      <button className="btn" onClick={test}>{level === null ? 'Проверить микрофон' : 'Остановить проверку'}</button>
      {level !== null && <span className="bar big" aria-label="Уровень микрофона"><span style={{ width: `${Math.round(level * 100)}%` }} /></span>}
      <Toggle label="Шумоподавление" checked={s.noiseSuppression} onChange={(v) => setSettings({ noiseSuppression: v })} />
      <Toggle label="Эхоподавление" checked={s.echoCancellation} onChange={(v) => setSettings({ echoCancellation: v })} />
      <p className="muted small">Звук и видео не записываются. Микрофон, камера и экран включаются только по вашему нажатию; индикатор показывает, что передаётся.</p>
      {picker && <DevicePicker onClose={() => setPicker(false)} />}
    </div>
  );
}

function AccountTab() {
  const { session } = useSession(); const toast = useToast();
  const [email, setEmail] = useState(''); const [pw, setPw] = useState('');
  return (
    <div className="stack">
      <p>Почта: <b>{session?.user.email}</b></p>
      <form className="row" onSubmit={async (e) => { e.preventDefault(); const { error } = await supabase.auth.updateUser({ email }); if (error) toast.push(humanError(error), 'error'); else toast.push('Подтвердите смену по ссылке в письме', 'ok'); }}>
        <input type="email" required placeholder="Новая почта" value={email} onChange={(e) => setEmail(e.target.value)} /><button className="btn">Сменить почту</button></form>
      <form className="row" onSubmit={async (e) => { e.preventDefault(); const { error } = await supabase.auth.updateUser({ password: pw }); if (error) toast.push(humanError(error), 'error'); else { toast.push('Пароль изменён', 'ok'); setPw(''); } }}>
        <input type="password" minLength={8} required placeholder="Новый пароль" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /><button className="btn">Сменить пароль</button></form>
      <button className="btn" onClick={() => supabase.auth.signOut({ scope: 'local' })}>Выйти</button>
      <button className="btn ghost" onClick={() => supabase.auth.signOut({ scope: 'global' })}>Выйти на всех устройствах</button>
    </div>
  );
}
