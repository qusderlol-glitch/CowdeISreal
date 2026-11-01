// Edge Function: токен доступа к SFU (пример для LiveKit, self-hosted или облако).
// Проверяет право CONNECT_VOICE через БД от имени пользователя, затем подписывает JWT секретом провайдера.
//   supabase secrets set SFU_API_KEY=... SFU_API_SECRET=... SFU_URL=wss://sfu.example.com
//   supabase functions deploy sfu-token
// Клиентский адаптер SFU (src/lib/rtc/provider.ts → CallEngine) в этой версии НЕ подключён — см. README.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const b64url = (b: Uint8Array | string) =>
  btoa(typeof b === 'string' ? b : String.fromCharCode(...b)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const apiKey = Deno.env.get('SFU_API_KEY'); const apiSecret = Deno.env.get('SFU_API_SECRET'); const url = Deno.env.get('SFU_URL');
  if (!apiKey || !apiSecret || !url) return Response.json({ error: 'sfu_not_configured' }, { status: 501, headers: cors });

  const { channel_id } = await req.json().catch(() => ({}));
  if (typeof channel_id !== 'string') return Response.json({ error: 'bad_request' }, { status: 400, headers: cors });

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return Response.json({ error: 'not_authenticated' }, { status: 401, headers: cors });
  const { data: allowed } = await sb.rpc('has_channel_perm', { p_channel: channel_id, p_perm: 1 | 512 });
  if (!allowed) return Response.json({ error: 'forbidden' }, { status: 403, headers: cors });
  const { data: canVideo } = await sb.rpc('has_channel_perm', { p_channel: channel_id, p_perm: 1024 });

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: apiKey, sub: user.id, nbf: now, exp: now + 600,
    video: { room: `voice:${channel_id}`, roomJoin: true, canPublish: true, canSubscribe: true,
      canPublishSources: canVideo ? ['microphone', 'camera', 'screen_share', 'screen_share_audio'] : ['microphone'] },
  }));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(apiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${payload}`)));
  return Response.json({ url, token: `${header}.${payload}.${b64url(sig)}` }, { headers: cors });
});
