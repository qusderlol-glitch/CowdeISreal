import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { humanError } from '../lib/errors';

type Kind = 'info' | 'error' | 'ok';
interface Toast { id: number; text: string; kind: Kind }
const Ctx = createContext<{ push: (text: string, kind?: Kind) => void; fail: (e: unknown) => void }>({ push: () => {}, fail: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Kind = 'info') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  const fail = useCallback((e: unknown) => push(e instanceof Error ? e.message : humanError(e), 'error'), [push]);
  return (
    <Ctx.Provider value={{ push, fail }}>
      {children}
      <div className="toasts" aria-live="polite">{items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}</div>
    </Ctx.Provider>
  );
}
export const useToast = () => useContext(Ctx);
