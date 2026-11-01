import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { q, supabase } from '../lib/supabase';
import type { Profile, ProfilePrivate, UserSettings } from '../lib/types';
import { applySettings, DEFAULT_SETTINGS, loadLocalSettings, saveLocalSettings } from '../lib/settings';

interface Ctx {
  session: Session | null; loading: boolean; uid: string | null;
  profile: Profile | null; priv: ProfilePrivate | null;
  settings: UserSettings; setSettings: (patch: Partial<UserSettings>) => void;
  reloadProfile: () => Promise<void>;
  online: boolean;
}
const SessionCtx = createContext<Ctx>(null as unknown as Ctx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [priv, setPriv] = useState<ProfilePrivate | null>(null);
  const [settings, setLocal] = useState<UserSettings>(loadLocalSettings);
  const [online, setOnline] = useState(navigator.onLine);
  const saveTimer = useRef<number>(0);
  const uid = session?.user.id ?? null;

  useEffect(() => { applySettings(settings); }, [settings]);
  useEffect(() => {
    const on = () => setOnline(true); const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); });
    return () => data.subscription.unsubscribe();
  }, []);

  const reloadProfile = useCallback(async () => {
    if (!uid) { setProfile(null); setPriv(null); return; }
    const [p, pp] = await Promise.all([
      q<Profile>(supabase.from('profiles').select('*').eq('id', uid).single()),
      q<ProfilePrivate>(supabase.from('profile_private').select('*').eq('user_id', uid).single()),
    ]);
    setProfile(p); setPriv(pp);
    if (pp.settings && Object.keys(pp.settings).length) {
      const merged = { ...DEFAULT_SETTINGS, ...pp.settings } as UserSettings;
      setLocal(merged); saveLocalSettings(merged);
    }
  }, [uid]);

  useEffect(() => { reloadProfile().catch(() => {}); }, [reloadProfile]);

  const setSettings = useCallback((patch: Partial<UserSettings>) => {
    setLocal((cur) => {
      const next = { ...cur, ...patch } as UserSettings;
      saveLocalSettings(next);
      window.clearTimeout(saveTimer.current);
      if (uid) saveTimer.current = window.setTimeout(() => {
        void supabase.from('profile_private').update({ settings: next }).eq('user_id', uid);
      }, 800);
      return next;
    });
  }, [uid]);

  return (
    <SessionCtx.Provider value={{ session, loading, uid, profile, priv, settings, setSettings, reloadProfile, online }}>
      {children}
    </SessionCtx.Provider>
  );
}
export const useSession = () => useContext(SessionCtx);
