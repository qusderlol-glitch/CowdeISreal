// Тестовый эмулятор Supabase Realtime (протокол Phoenix, vsn 2.0.0) для Playwright routeWebSocket.
// Поддерживает: join/leave приватных каналов с проверкой НАСТОЯЩЕЙ политики public.realtime_topic_allowed,
// broadcast (двоичный формат realtime-js: push kind 3 -> рассылка kind 4), presence (track/untrack, state/diff),
// heartbeat. postgres_changes подтверждаются (чтобы клиент не падал), но изменения БД не транслируются.
// Только для e2e: позволяет проверить реальный звонок WebRTC между двумя браузерами.

const enc = new TextEncoder();
const dec = new TextDecoder();

export class RealtimeHub {
  constructor(stand) {
    this.stand = stand;
    this.topics = new Map(); // topic -> Map(ws -> { joinRef, key, self })
    this.presence = new Map(); // topic -> Map(key -> { ws, meta })
    this.ref = 1;
    this.log = [];
  }

  attach(route) {
    const ws = { route, claims: null, joined: new Set() };
    route.onMessage((m) => { this.onMessage(ws, m).catch((e) => this.log.push(`rt error ${e.message}`)); });
    route.onClose(() => this.drop(ws));
  }

  sendJson(ws, msg) { try { ws.route.send(JSON.stringify(msg)); } catch { /* закрыт */ } }

  reply(ws, joinRef, ref, topic, status, response = {}) {
    this.sendJson(ws, [joinRef, ref, topic, 'phx_reply', { status, response }]);
  }

  async allowed(ws, topic, write) {
    const name = topic.replace(/^realtime:/, '');
    if (!ws.claims) return false;
    const r = await this.stand.asUser(ws.claims, (c) => c.query('select public.realtime_topic_allowed($1, $2) ok', [name, write]));
    return r.rows[0].ok === true;
  }

  async onMessage(ws, raw) {
    if (typeof raw !== 'string') return this.onBinary(ws, raw);
    const [joinRef, ref, topic, event, payload] = JSON.parse(raw);
    if (topic === 'phoenix' && event === 'heartbeat') return this.reply(ws, null, ref, 'phoenix', 'ok');
    if (event === 'access_token') { if (payload?.access_token) ws.claims = this.claims(payload.access_token); return; }
    if (event === 'phx_join') {
      if (payload?.access_token) ws.claims = this.claims(payload.access_token);
      const cfg = payload?.config ?? {};
      if (cfg.private && !(await this.allowed(ws, topic, false))) {
        return this.reply(ws, joinRef, ref, topic, 'error', { reason: 'Unauthorized: You do not have permissions to read from this Channel topic' });
      }
      if (!this.topics.has(topic)) this.topics.set(topic, new Map());
      this.topics.get(topic).set(ws, { joinRef, key: cfg.presence?.key || `k${this.ref++}`, self: !!cfg.broadcast?.self, private: !!cfg.private });
      ws.joined.add(topic);
      const pg = (cfg.postgres_changes ?? []).map((b, i) => ({ ...b, id: 1000 + i }));
      this.reply(ws, joinRef, ref, topic, 'ok', { postgres_changes: pg });
      const state = Object.fromEntries([...(this.presence.get(topic) ?? new Map())].map(([k, v]) => [k, { metas: [v.meta] }]));
      this.sendJson(ws, [joinRef, null, topic, 'presence_state', state]);
      return;
    }
    if (event === 'phx_leave') { this.leave(ws, topic); return this.reply(ws, joinRef, ref, topic, 'ok'); }
    const sub = this.topics.get(topic)?.get(ws);
    if (!sub) return this.reply(ws, joinRef, ref, topic, 'error', { reason: 'not joined' });
    if (event === 'presence') {
      if (payload.event === 'track') {
        if (sub.private && !(await this.allowed(ws, topic, true))) return this.reply(ws, joinRef, ref, topic, 'error', { reason: 'Unauthorized' });
        const meta = { ...(payload.payload ?? {}), phx_ref: `p${this.ref++}` };
        if (!this.presence.has(topic)) this.presence.set(topic, new Map());
        this.presence.get(topic).set(sub.key, { ws, meta });
        this.diff(topic, { [sub.key]: { metas: [meta] } }, {});
      } else if (payload.event === 'untrack') {
        this.untrack(ws, topic);
      }
      return this.reply(ws, joinRef, ref, topic, 'ok');
    }
    if (event === 'broadcast') { // JSON-рассылка (на случай старого формата)
      if (sub.private && !(await this.allowed(ws, topic, true))) return this.reply(ws, joinRef, ref, topic, 'error', { reason: 'Unauthorized' });
      for (const [other, s] of this.topics.get(topic)) if (other !== ws || s.self) this.sendJson(other, [null, null, topic, 'broadcast', payload]);
      return this.reply(ws, joinRef, ref, topic, 'ok');
    }
    this.reply(ws, joinRef, ref, topic, 'ok');
  }

  async onBinary(ws, buf) {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (b[0] !== 3) return;
    const [jl, rl, tl, el, ml, encoding] = [b[1], b[2], b[3], b[4], b[5], b[6]];
    let o = 7;
    const joinRef = dec.decode(b.slice(o, o += jl)); const ref = dec.decode(b.slice(o, o += rl));
    const topic = dec.decode(b.slice(o, o += tl)); const userEvent = dec.decode(b.slice(o, o += el));
    const meta = b.slice(o, o += ml); const payload = b.slice(o);
    const subs = this.topics.get(topic); const sub = subs?.get(ws);
    if (!sub) return;
    if (sub.private && !(await this.allowed(ws, topic, true))) return this.reply(ws, joinRef, ref, topic, 'error', { reason: 'Unauthorized' });
    const t = enc.encode(topic); const e = enc.encode(userEvent);
    const out = new Uint8Array(5 + t.length + e.length + meta.length + payload.length);
    out.set([4, t.length, e.length, meta.length, encoding], 0);
    let p = 5; out.set(t, p); p += t.length; out.set(e, p); p += e.length; out.set(meta, p); p += meta.length; out.set(payload, p);
    for (const [other, s] of subs) if (other !== ws || s.self) { try { other.route.send(Buffer.from(out)); } catch { /* закрыт */ } }
    if (ref) this.reply(ws, joinRef, ref, topic, 'ok');
  }

  diff(topic, joins, leaves) {
    for (const [ws, s] of this.topics.get(topic) ?? []) this.sendJson(ws, [s.joinRef, null, topic, 'presence_diff', { joins, leaves }]);
  }

  untrack(ws, topic) {
    const pres = this.presence.get(topic); if (!pres) return;
    for (const [key, v] of pres) if (v.ws === ws) { pres.delete(key); this.diff(topic, {}, { [key]: { metas: [v.meta] } }); }
  }

  leave(ws, topic) {
    this.untrack(ws, topic);
    this.topics.get(topic)?.delete(ws);
    ws.joined.delete(topic);
  }

  drop(ws) { for (const t of [...ws.joined]) this.leave(ws, t); }

  claims(token) {
    try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); } catch { return null; }
  }
}
