// Тестовый стенд: подмножество PostgREST + Supabase Auth поверх НАСТОЯЩЕГО Postgres.
// Каждый запрос выполняется под ролью authenticated/anon с request.jwt.claims — значит, RLS и RPC те же, что в Supabase.
// Используется только в e2e-тестах (Playwright page.route). В продакшене не нужен.
import pg from 'pg';
import { randomUUID } from 'node:crypto';

const b64url = (s) => Buffer.from(s).toString('base64url');

export class Stand {
  constructor(connectionString) {
    this.pool = new pg.Pool({ connectionString, max: 4 });
    this.passwords = new Map();
    this.confirmed = new Set();
    this.codes = new Map(); // email -> { code, type } — вместо реальной почты
    this.sent = [];
    this.rels = null;
    this.funcs = null;
  }

  async init() {
    const fk = await this.pool.query(`
      select c.conname, tc.relname child, pc.relname parent, a.attname child_col, pa.attname parent_col
        from pg_constraint c
        join pg_class tc on tc.oid = c.conrelid join pg_namespace n on n.oid = tc.relnamespace and n.nspname = 'public'
        join pg_class pc on pc.oid = c.confrelid
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
       where c.contype = 'f' and array_length(c.conkey, 1) = 1`);
    this.rels = fk.rows;
    const f = await this.pool.query(`select p.proname, p.proretset, p.prorettype = 'void'::regtype as void from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`);
    this.funcs = new Map(f.rows.map((r) => [r.proname, r]));
  }

  token(user) {
    const now = Math.floor(Date.now() / 1000);
    const payload = { sub: user.id, role: 'authenticated', aud: 'authenticated', email: user.email, exp: now + 3600, iat: now };
    return `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}.stand`;
  }

  session(user) {
    const access_token = this.token(user);
    return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `r-${user.id}`, user };
  }

  sendCode(email, type) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    this.codes.set(email, { code, type });
    this.sent.push({ email, type, code });
    return code;
  }

  userObj(row) {
    return { identities: [{ id: row.id, provider: 'email' }], id: row.id, aud: 'authenticated', role: 'authenticated', email: row.email, email_confirmed_at: new Date().toISOString(),
      user_metadata: row.raw_user_meta_data ?? {}, app_metadata: { provider: 'email' }, created_at: new Date().toISOString() };
  }

  claimsFrom(headers) {
    const auth = headers['authorization'] || '';
    const tok = auth.replace(/^Bearer\s+/i, '');
    try {
      const p = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString());
      if (p.sub) return p;
    } catch { /* anon */ }
    return null;
  }

  async asUser(claims, fn) {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      await c.query(`set local role ${claims ? 'authenticated' : 'anon'}`);
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [claims ? JSON.stringify(claims) : '']);
      const r = await fn(c);
      await c.query('commit');
      return r;
    } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
    } finally { c.release(); }
  }

  // ── Auth
  async auth(method, path, query, body) {
    if (path === '/signup') {
      const exists = await this.pool.query('select 1 from auth.users where email = $1', [body.email]);
      if (exists.rowCount) return [422, { code: 'user_already_exists', msg: 'User already registered', message: 'User already registered' }];
      const id = randomUUID();
      const r = await this.pool.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3) returning *', [id, body.email, body.data ?? {}]);
      this.passwords.set(body.email, body.password);
      this.sendCode(body.email, 'signup');
      // как GoTrue с включённым подтверждением: пользователь без сессии
      return [200, { ...this.userObj(r.rows[0]), email_confirmed_at: null, confirmation_sent_at: new Date().toISOString() }];
    }
    if (path === '/token') {
      if (query.get('grant_type') === 'password') {
        const r = await this.pool.query('select * from auth.users where email = $1', [body.email]);
        if (!r.rowCount || this.passwords.get(body.email) !== body.password) return [400, { error: 'invalid_grant', error_description: 'Invalid login credentials', message: 'Invalid login credentials', code: 'invalid_credentials' }];
        if (!this.confirmed.has(body.email)) return [400, { error: 'invalid_grant', message: 'Email not confirmed', code: 'email_not_confirmed' }];
        const user = this.userObj(r.rows[0]);
        return [200, this.session(user)];
      }
      if (query.get('grant_type') === 'refresh_token') {
        const id = String(body.refresh_token).slice(2);
        const r = await this.pool.query('select * from auth.users where id = $1', [id]);
        if (!r.rowCount) return [400, { message: 'Invalid Refresh Token' }];
        return [200, this.session(this.userObj(r.rows[0]))];
      }
    }
    if (path === '/user' && method === 'GET') return null; // обрабатывается в handle() по токену
    if (path === '/logout') return [204, null];
    if (path === '/resend') { this.sendCode(body.email, 'signup'); return [200, {}]; }
    if (path === '/recover') {
      const r = await this.pool.query('select 1 from auth.users where email = $1', [body.email]);
      if (r.rowCount) this.sendCode(body.email, 'recovery');
      return [200, {}];
    }
    if (path === '/verify' && method === 'POST') {
      const want = this.codes.get(body.email);
      const okType = want && (body.type === 'email' ? want.type === 'signup' : body.type === want.type);
      if (!okType || want.code !== body.token) return [403, { code: 'otp_expired', message: 'Token has expired or is invalid' }];
      this.codes.delete(body.email);
      this.confirmed.add(body.email);
      const r = await this.pool.query('select * from auth.users where email = $1', [body.email]);
      const user = this.userObj(r.rows[0]);
      return [200, { ...this.session(user), user }];
    }
    return [404, { message: `stand: auth ${method} ${path} not implemented` }];
  }

  // ── PostgREST subset
  parseSelect(sel, table, alias, depth = 0) {
    const parts = []; let depthP = 0; let cur = '';
    for (const ch of sel) {
      if (ch === '(') depthP++; if (ch === ')') depthP--;
      if (ch === ',' && depthP === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());
    const cols = [];
    for (const p of parts) {
      const m = /^(?:(\w+):)?(\w+)(?:!(\w+))?\((.*)\)$/s.exec(p);
      if (!m) { cols.push(p === '*' ? `${alias}.*` : `${alias}.${p.replace(/[^\w]/g, '')}`); continue; }
      const [, as, rel, hint, inner] = m;
      const sub = `t${depth + 1}`;
      const many = this.rels.find((r) => r.child === rel && r.parent === table && (!hint || r.conname === hint));
      const one = this.rels.find((r) => r.child === table && r.parent === rel && (!hint || r.conname === hint));
      const innerCols = this.parseSelect(inner, rel, sub, depth + 1).join(', ');
      if (one && (!many || hint)) {
        cols.push(`(select to_jsonb(x) from (select ${innerCols} from public.${rel} ${sub} where ${sub}.${one.parent_col} = ${alias}.${one.child_col}) x) as "${as ?? rel}"`);
      } else if (many) {
        cols.push(`(select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (select ${innerCols} from public.${rel} ${sub} where ${sub}.${many.child_col} = ${alias}.${many.parent_col}) x) as "${as ?? rel}"`);
      } else throw new Error(`stand: no relationship ${table} -> ${rel}`);
    }
    return cols;
  }

  where(query, alias, params) {
    const conds = [];
    for (const [k, v] of query) {
      if (['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(k)) continue;
      const col = `${alias}.${k.replace(/[^\w]/g, '')}`;
      const m = /^(not\.)?(eq|neq|lt|lte|gt|gte|is|in|ilike|like)\.(.*)$/s.exec(v);
      if (!m) throw new Error(`stand: filter ${k}=${v}`);
      const [, not, op, val] = m;
      let c;
      if (op === 'is') c = `${col} is ${val === 'null' ? 'null' : val === 'true' ? 'true' : 'false'}`;
      else if (op === 'in') { const list = val.replace(/^\(|\)$/g, '').split(','); c = `${col}::text = any($${params.push(list)})`; }
      else { const sqlop = { eq: '=', neq: '<>', lt: '<', lte: '<=', gt: '>', gte: '>=', ilike: 'ilike', like: 'like' }[op]; c = `${col} ${sqlop} $${params.push(val)}`; }
      conds.push(not ? `not (${c})` : c);
    }
    return conds.length ? `where ${conds.join(' and ')}` : '';
  }

  async rest(method, table, query, body, headers, claims) {
    return this.asUser(claims, async (c) => {
      if (table.startsWith('rpc/')) {
        const fn = table.slice(4).replace(/[^\w]/g, '');
        const meta = this.funcs.get(fn);
        if (!meta) return [404, { message: `function ${fn} not found` }];
        const params = []; const args = [];
        for (const [k, v] of Object.entries(body ?? {})) {
          args.push(`${k.replace(/[^\w]/g, '')} => $${params.push(v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v))}`);
        }
        const call = `public.${fn}(${args.join(', ')})`;
        const sql = meta.proretset ? `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) v from ${call} t`
          : meta.void ? `select ${call}, null::jsonb v` : `select to_jsonb(${call}) v`;
        const r = await c.query(sql, params);
        return [200, r.rows[0].v];
      }
      const t = table.replace(/[^\w]/g, '');
      const params = [];
      const where = this.where(query, 't0', params);
      if (method === 'GET' || method === 'HEAD') {
        const cols = this.parseSelect(query.get('select') || '*', t, 't0').join(', ');
        const order = (query.get('order') || '').split(',').filter(Boolean).map((o) => {
          const [col, dir, nulls] = o.split('.');
          return `t0.${col.replace(/[^\w]/g, '')} ${dir === 'desc' ? 'desc' : 'asc'}${nulls === 'nullslast' ? ' nulls last' : nulls === 'nullsfirst' ? ' nulls first' : ''}`;
        });
        const limit = query.get('limit') ? `limit ${Number(query.get('limit'))}` : '';
        const r = await c.query(`select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) v from (select ${cols} from public.${t} t0 ${where} ${order.length ? `order by ${order.join(', ')}` : ''} ${limit}) x`, params);
        const rows = r.rows[0].v;
        if ((headers['accept'] || '').includes('vnd.pgrst.object')) {
          if (rows.length !== 1) return [406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }];
          return [200, rows[0]];
        }
        return [200, rows];
      }
      if (method === 'POST') {
        const list = Array.isArray(body) ? body : [body];
        for (const row of list) {
          const keys = Object.keys(row).map((k) => k.replace(/[^\w]/g, ''));
          const p = keys.map((k) => (row[k] !== null && typeof row[k] === 'object' && !Array.isArray(row[k]) ? JSON.stringify(row[k]) : row[k]));
          await c.query(`insert into public.${t} (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, p);
        }
        return [201, null];
      }
      if (method === 'PATCH') {
        const keys = Object.keys(body).map((k) => k.replace(/[^\w]/g, ''));
        const sets = keys.map((k) => `${k} = $${params.push(body[k] !== null && typeof body[k] === 'object' && !Array.isArray(body[k]) ? JSON.stringify(body[k]) : body[k])}`);
        const ret = (headers['prefer'] || '').includes('return=representation');
        const r = await c.query(`update public.${t} t0 set ${sets.join(', ')} ${where}${ret ? ' returning to_jsonb(t0) v' : ''}`, params);
        return ret ? [200, r.rows.map((x) => x.v)] : [204, null];
      }
      if (method === 'DELETE') { await c.query(`delete from public.${t} t0 ${where}`, params); return [204, null]; }
      return [405, { message: 'stand: method not allowed' }];
    });
  }

  async handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = null; }
    const headers = req.headers();
    const claims = this.claimsFrom(headers);
    let status = 200; let out = null;
    try {
      if (url.pathname.startsWith('/auth/v1')) {
        const path = url.pathname.slice('/auth/v1'.length);
        if (path === '/user' && method === 'PUT') {
          if (!claims) [status, out] = [401, { message: 'not authenticated' }];
          else {
            const r = await this.pool.query('select * from auth.users where id = $1', [claims.sub]);
            if (body?.password) this.passwords.set(r.rows[0].email, body.password);
            [status, out] = [200, this.userObj(r.rows[0])];
          }
        } else if (path === '/user') {
          if (!claims) [status, out] = [401, { message: 'not authenticated' }];
          else { const r = await this.pool.query('select * from auth.users where id = $1', [claims.sub]); [status, out] = [200, this.userObj(r.rows[0])]; }
        } else [status, out] = await this.auth(method, path, url.searchParams, body);
      } else if (url.pathname.startsWith('/rest/v1/')) {
        [status, out] = await this.rest(method, url.pathname.slice('/rest/v1/'.length), url.searchParams, body, headers, claims);
      } else if (url.pathname.startsWith('/functions/v1/')) {
        [status, out] = [501, { error: 'not_configured_in_stand' }];
      } else if (url.pathname.startsWith('/storage/v1/')) {
        [status, out] = [501, { message: 'Storage не эмулируется стендом' }];
      } else [status, out] = [404, { message: 'stand: unknown path' }];
    } catch (e) {
      status = e.code === '42501' ? 403 : 400;
      out = { code: e.code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null };
    }
    this.log?.(`${method} ${url.pathname}${url.search} -> ${status}${status >= 400 ? ` ${out?.message ?? ''}` : ''}`);
    return route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: out === null ? '' : JSON.stringify(out) });
  }
}
