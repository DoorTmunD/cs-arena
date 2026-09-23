export class ApiError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const validText = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 60;
const integer = value => Number.isInteger(value) && value >= 0 && value <= 999;
const maps = ['Mirage', 'Inferno', 'Dust II', 'Nuke', 'Ancient', 'Anubis', 'Vertigo', 'Train'];
export function validateMatch(m, s) {
  if (!m || !['scheduled', 'finished'].includes(m.status) || !maps.includes(m.map) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(m.date) || !Number.isFinite(Date.parse(m.date)) || new Date(m.date + 'Z').toISOString().slice(0, 16) !== m.date) throw new ApiError('Confira a data, o mapa e o status.');
  if (m.teamA === m.teamB || ![m.teamA, m.teamB].every(id => s.teams.some(t => t.id === id))) throw new ApiError('Escolha dois times diferentes.');
  if (!integer(m.scoreA) || !integer(m.scoreB)) throw new ApiError('Placar inválido.');
  if (!Array.isArray(m.stats) || m.stats.length > 100) throw new ApiError('Estatísticas inválidas.');
  const ids = new Set();
  for (const row of m.stats) {
    if (!row || ids.has(row.playerId) || !s.players.some(p => p.id === row.playerId) || ![m.teamA, m.teamB].includes(row.teamId) || ![row.kills, row.deaths, row.assists].every(integer)) throw new ApiError('Confira as estatísticas dos jogadores.');
    ids.add(row.playerId);
  }
}
export function mutateState(s, route, input, newId) {
  if (input.id !== undefined && (typeof input.id !== 'string' || input.id.length > 64)) throw new ApiError('Identificador inválido.');
  const upsert = (list, item) => {
    if (input.id) {
      const old = list.find(row => row.id === input.id);
      if (!old) throw new ApiError('Registro não encontrado. Atualize a página.', 404);
      Object.assign(old, item);
    } else list.push(item);
  };
  if (route === '/api/team') {
    if (!validText(input.name) || !validText(input.tag) || input.tag.length > 5 || !/^#[0-9a-f]{6}$/i.test(input.color)) throw new ApiError('Preencha nome, sigla (até 5 letras) e cor.');
    upsert(s.teams, { id: input.id || newId, name: input.name.trim(), tag: input.tag.trim(), color: input.color });
  } else if (route === '/api/player') {
    if (!validText(input.name) || !s.teams.some(t => t.id === input.teamId)) throw new ApiError('Preencha o apelido e escolha o time.');
    upsert(s.players, { id: input.id || newId, name: input.name.trim(), teamId: input.teamId });
  } else if (route === '/api/match') {
    validateMatch(input, s);
    upsert(s.matches, { id: input.id || newId, date: input.date, map: input.map, teamA: input.teamA, teamB: input.teamB, scoreA: input.scoreA, scoreB: input.scoreB, status: input.status, stats: input.status === 'finished' ? input.stats.map(({ playerId, teamId, kills, deaths, assists }) => ({ playerId, teamId, kills, deaths, assists })) : [] });
  } else if (route === '/api/delete-match') {
    if (!input.id || !s.matches.some(m => m.id === input.id)) throw new ApiError('Partida não encontrada.', 404);
    s.matches = s.matches.filter(m => m.id !== input.id);
  } else throw new ApiError('Rota não encontrada.', 404);
  return s;
}
