import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { humanError } from './errors';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && key && !url.includes('YOUR-PROJECT'));

export const supabase: SupabaseClient = createClient(url || 'http://localhost:54321', key || 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 20 } },
});

export class ApiError extends Error {}

export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args ?? {});
  if (error) throw new ApiError(humanError(error));
  return data as T;
}

export async function q<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new ApiError(humanError(error));
  return data as T;
}

export function publicMediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from('public-media').getPublicUrl(path).data.publicUrl;
}

const signedCache = new Map<string, { url: string; exp: number }>();
export async function signedAttachmentUrl(path: string): Promise<string> {
  const hit = signedCache.get(path);
  if (hit && hit.exp > Date.now() + 60_000) return hit.url;
  const { data, error } = await supabase.storage.from('attachments').createSignedUrl(path, 3600);
  if (error || !data) throw new ApiError(humanError(error ?? 'not_found'));
  signedCache.set(path, { url: data.signedUrl, exp: Date.now() + 3600_000 });
  return data.signedUrl;
}
