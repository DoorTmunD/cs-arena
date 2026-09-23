import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('Workers + D1: CRUD, concurrency, authentication, persistence and invalid input', { timeout: 120000 }, async () => {
  const persist = mkdtempSync(path.join(tmpdir(), 'cs-arena-d1-'));
  const password = 'local-test-password-only-123456';
  const options = {
    modules: [
      { type: 'ESModule', path: path.resolve('worker/index.js') },
      { type: 'ESModule', path: path.resolve('worker/model.js') },
    ],
    compatibilityDate: '2026-09-23', cf: false,
    bindings: { ADMIN_PASSWORD: password },
    d1Databases: { DB: 'arena-test' }, resourcePersistencePath: persist,
  };
  let mf = new Miniflare(convertV4MiniflareOptions(options));
  let cookie;
  const request = (route, body, headers = {}) => mf.dispatchFetch('https://arena.test' + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const state = async () => (await request('/api/state')).json();
  try {
    const db = await mf.getD1Database('DB');
    const statements = readFileSync('migrations/0001_initial.sql', 'utf8').split(';').map(s => s.trim()).filter(Boolean);
    await db.batch(statements.map(sql => db.prepare(sql)));
    assert.equal((await request('/healthz')).status, 200);
    assert.deepEqual(await state(), { teams: [], players: [], matches: [], authenticated: false });
    assert.equal((await request('/api/team', { name: 'no access' })).status, 401);
    assert.equal((await request('/api/login', { password }, { Origin: 'https://other.test' })).status, 403);
    assert.equal((await request('/api/login', { password: 'wrong' })).status, 401);
    const login = await request('/api/login', { password });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    assert.match(login.headers.get('set-cookie'), /Secure/);
    cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await state()).authenticated, true);
    const concurrent = await Promise.all(['Alpha', 'Bravo', 'Charlie'].map(name => request('/api/team', { name, tag: name.slice(0, 3), color: '#abcdef' })));
    assert.ok(concurrent.every(res => res.status === 200));
    let s = await state(); assert.equal(s.teams.length, 3);
    const [a, b] = s.teams;
    assert.equal((await request('/api/player', { name: 'Player One', teamId: a.id })).status, 200);
    s = await state(); const player = s.players[0];
    const match = { date: '2026-09-23T21:00', map: 'Mirage', status: 'finished', teamA: a.id, teamB: b.id, scoreA: 13, scoreB: 9, stats: [{ playerId: player.id, teamId: a.id, kills: 23, deaths: 11, assists: 4 }] };
    assert.equal((await request('/api/match', { ...match, date: '2026-02-30T21:00' })).status, 400);
    assert.equal((await request('/api/match', { ...match, teamB: a.id })).status, 400);
    assert.equal((await request('/api/match', { ...match, stats: [null] })).status, 400);
    assert.equal((await request('/api/match', { ...match, stats: [match.stats[0], match.stats[0]] })).status, 400);
    assert.equal((await request('/api/match', match)).status, 200);
    s = await state(); assert.equal(s.matches[0].stats[0].kills, 23);
    const saved = s.matches[0];
    assert.equal((await request('/api/match', { ...saved, scoreB: 11 })).status, 200);
    assert.equal((await request('/api/team', { id: 'missing', name: 'Missing', tag: 'MIS', color: '#abcdef' })).status, 404);
    await mf.dispose(); mf = new Miniflare(convertV4MiniflareOptions(options));
    s = await state(); assert.equal(s.matches[0].scoreB, 11); assert.equal(s.authenticated, true);
    assert.equal((await request('/api/delete-match', { id: saved.id })).status, 200);
    assert.equal((await state()).matches.length, 0);
    assert.equal((await request('/api/logout', {})).status, 200);
    assert.equal((await state()).authenticated, false);
    assert.equal((await request('/api/team', { name: 'Old session' })).status, 401);
    for (let i = 0; i < 10; i++) assert.equal((await request('/api/login', { password: 'wrong' }, { 'CF-Connecting-IP': '192.0.2.4' })).status, 401);
    assert.equal((await request('/api/login', { password }, { 'CF-Connecting-IP': '192.0.2.4' })).status, 429);
    const again = await request('/api/login', { password });
    cookie = again.headers.get('set-cookie').split(';')[0];
    await mf.setOptions(convertV4MiniflareOptions({ ...options, bindings: { ADMIN_PASSWORD: password + '-rotated' } }));
    assert.equal((await state()).authenticated, false);
    assert.equal((await request('/api/login', { password })).status, 401);
  } finally { await mf.dispose(); }
});
