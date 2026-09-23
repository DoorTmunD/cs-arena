import { ApiError, mutateState } from './model.js';

const encoder = new TextEncoder();
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
  'Cache-Control': 'no-store',
};
const json = (status, body, headers = {}) => Response.json(body, { status, headers: { ...securityHeaders, ...headers } });
const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
const digest = async value => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const equal = (a, b) => { let diff = a.length ^ b.length; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; };
const cookie = (request, token, age) => `arena_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;

async function body(request) {
  if (Number(request.headers.get('content-length')) > 500000) throw new ApiError('Arquivo muito grande.', 413);
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ApiError('Envie os dados em JSON.', 415);
  const reader = request.body?.getReader();
  const decoder = new TextDecoder(); let text = '', size = 0;
  if (reader) for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 500000) { await reader.cancel(); throw new ApiError('Arquivo muito grande.', 413); }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  let result;
  try { result = JSON.parse(text || '{}'); } catch { throw new ApiError('JSON inválido.'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new ApiError('JSON inválido.');
  return result;
}
async function authenticated(request, env) {
  const token = /(?:^|;\s*)arena_session=([a-f0-9]{64})(?:;|$)/.exec(request.headers.get('cookie') || '')?.[1];
  if (!token || !env.ADMIN_PASSWORD) return null;
  const tokenHash = await digest(token);
  const row = await env.DB.prepare('SELECT credential_hash FROM sessions WHERE token_hash = ? AND expires_at > ?').bind(tokenHash, Date.now()).first();
  return row && equal(row.credential_hash, await digest(env.ADMIN_PASSWORD)) ? tokenHash : null;
}
async function login(request, env, input) {
  if (typeof env.ADMIN_PASSWORD !== 'string' || env.ADMIN_PASSWORD.length < 16) throw new ApiError('A senha do organizador ainda não foi configurada no servidor.', 503);
  const now = Date.now();
  // Cloudflare supplies this header; users cannot override it at the edge.
  const key = await digest(request.headers.get('CF-Connecting-IP') || 'local');
  const row = await env.DB.prepare(`INSERT INTO login_attempts (key, count, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN expires_at <= ? THEN 1 ELSE count + 1 END,
    expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
    RETURNING count`).bind(key, now + 600000, now, now).first();
  if (row.count > 10) return json(429, { error: 'Muitas tentativas. Aguarde 10 minutos.' }, { 'Retry-After': '600' });
  if (typeof input.password !== 'string' || input.password.length > 200 || !equal(await digest(input.password), await digest(env.ADMIN_PASSWORD))) throw new ApiError('Senha incorreta.', 401);
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_attempts WHERE key = ? OR expires_at <= ?').bind(key, now),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
    env.DB.prepare('INSERT INTO sessions (token_hash, credential_hash, expires_at) VALUES (?, ?, ?)').bind(await digest(token), await digest(env.ADMIN_PASSWORD), now + 86400000),
  ]);
  return json(200, { ok: true }, { 'Set-Cookie': cookie(request, token, 86400) });
}
async function mutate(env, route, input) {
  const id = crypto.randomUUID();
  // Compare-and-swap protects simultaneous edits from overwriting other records.
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await env.DB.prepare('SELECT json, revision FROM arena_state WHERE id = 1').first();
    if (!row) throw new ApiError('Banco não inicializado.', 503);
    const next = JSON.stringify(mutateState(JSON.parse(row.json), route, input, id));
    if (encoder.encode(next).byteLength > 1500000) throw new ApiError('O histórico atingiu o limite desta versão. Exporte os dados e contate o organizador.', 413);
    const result = await env.DB.prepare('UPDATE arena_state SET json = ?, revision = revision + 1 WHERE id = 1 AND revision = ?').bind(next, row.revision).run();
    if (result.meta.changes === 1) return json(200, { ok: true });
  }
  throw new ApiError('Outra alteração está em andamento. Tente salvar novamente.', 409);
}
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/healthz') {
        if (request.method !== 'GET') throw new ApiError('Método não permitido.', 405);
        const ready = await env.DB.prepare('SELECT id FROM arena_state WHERE id = 1').first();
        return json(ready ? 200 : 503, { status: ready ? 'ok' : 'unavailable' });
      }
      if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
      if (url.pathname === '/api/state' && request.method === 'GET') {
        const row = await env.DB.prepare('SELECT json FROM arena_state WHERE id = 1').first();
        if (!row) throw new ApiError('Banco não inicializado.', 503);
        return json(200, { ...JSON.parse(row.json), authenticated: Boolean(await authenticated(request, env)) });
      }
      if (request.method !== 'POST') throw new ApiError('Método não permitido.', 405);
      const origin = request.headers.get('origin');
      if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new ApiError('Origem inválida.', 403);
      const input = await body(request);
      if (url.pathname === '/api/login') return await login(request, env, input);
      const session = await authenticated(request, env);
      if (!session) throw new ApiError('Entre como administrador para fazer alterações.', 401);
      if (url.pathname === '/api/logout') {
        await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(session).run();
        return json(200, { ok: true }, { 'Set-Cookie': cookie(request, '', 0) });
      }
      return await mutate(env, url.pathname, input);
    } catch (error) {
      if (error instanceof ApiError) return json(error.status, { error: error.message });
      console.error('Worker request failed', error.name);
      return json(503, { error: 'Serviço temporariamente indisponível. Tente novamente.' });
    }
  },
};
