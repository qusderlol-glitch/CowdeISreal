// Edge Function: краткоживущие TURN-учётки (coturn REST API, use-auth-secret).
// Секрет TURN_SECRET хранится только в Supabase Secrets и никогда не попадает в браузер.
//   supabase secrets set TURN_SECRET=... TURN_URLS='["turn:turn.example.com:3478?transport=udp","turns:turn.example.com:5349"]'
//   supabase functions deploy turn-credentials
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const TTL = 3600;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const secret = Deno.env.get('TURN_SECRET');
  const urls = JSON.parse(Deno.env.get('TURN_URLS') ?? '[]') as string[];
  if (!secret || !urls.length) return Response.json({ error: 'turn_not_configured' }, { status: 501, headers: cors });

  // только для вошедших пользователей
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return Response.json({ error: 'not_authenticated' }, { status: 401, headers: cors });

  const username = `${Math.floor(Date.now() / 1000) + TTL}:${user.id}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(username));
  const credential = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return Response.json({ iceServers: [{ urls, username, credential }], ttl: TTL }, { headers: cors });
});
