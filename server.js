import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const dir = process.env.DATA_DIR || path.join(root, 'data');
mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(path.join(dir, 'arena.sqlite'));
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, json TEXT NOT NULL)');
const credentialFile = path.join(dir, 'admin.json');
let credentials;
if (existsSync(credentialFile)) credentials = JSON.parse(readFileSync(credentialFile));
else {
  if (process.env.NODE_ENV === 'production' && (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12)) throw Error('Defina ADMIN_PASSWORD com pelo menos 12 caracteres antes da primeira execução em produção.');
  const password = process.env.ADMIN_PASSWORD || randomBytes(9).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  credentials = { salt, hash: scryptSync(password, salt, 64).toString('hex') };
  writeFileSync(credentialFile, JSON.stringify(credentials));
  if (!process.env.ADMIN_PASSWORD) console.log(`Senha inicial do administrador: ${password}\nGuarde esta senha. Ela não será exibida novamente.`);
  else console.log('Credenciais do administrador configuradas a partir de ADMIN_PASSWORD.');
}
const initialState = { teams: [], players: [], matches: [] };
if (!db.prepare('SELECT id FROM state WHERE id=1').get()) db.prepare('INSERT INTO state VALUES (1, ?)').run(JSON.stringify(initialState));
const getState=()=>JSON.parse(db.prepare('SELECT json FROM state WHERE id=1').get().json);
const save=s=>db.prepare('UPDATE state SET json=? WHERE id=1').run(JSON.stringify(s));
const sessions = new Map(), attempts = new Map();
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const validText=v=>typeof v==='string'&&v.trim().length>0&&v.length<=60;
const integer=v=>Number.isInteger(v)&&v>=0&&v<=999;
export function validateMatch(m,s) {
  if (!m || !['scheduled','finished'].includes(m.status) || !['Mirage','Inferno','Dust II','Nuke','Ancient','Anubis','Vertigo','Train'].includes(m.map) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(m.date) || !Number.isFinite(Date.parse(m.date))) throw Error('Confira a data, o mapa e o status.');
  if(m.teamA===m.teamB||![m.teamA,m.teamB].every(id=>s.teams.some(t=>t.id===id))) throw Error('Escolha dois times diferentes.');
  if(!integer(m.scoreA)||!integer(m.scoreB)) throw Error('Placar inválido.');
  if(!Array.isArray(m.stats)||m.stats.length>100) throw Error('Estatísticas inválidas.');
  const ids=new Set();
  for(const row of m.stats){if(ids.has(row.playerId)||!s.players.some(p=>p.id===row.playerId)||![m.teamA,m.teamB].includes(row.teamId)||![row.kills,row.deaths,row.assists].every(integer)) throw Error('Confira as estatísticas dos jogadores.');ids.add(row.playerId);}
}
const server=http.createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/healthz'&&req.method==='GET'){
   try { db.prepare('SELECT id FROM state WHERE id=1').get(); return json(res,200,{status:'ok'}); }
   catch { return json(res,503,{status:'unavailable'}); }
  }
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
  const sid=/arena_session=([a-f0-9]+)/.exec(req.headers.cookie||'')?.[1];
  const authenticated=sessions.has(sid)&&sessions.get(sid)>Date.now();
  if(url.pathname==='/api/state'&&req.method==='GET') return json(res,200,{...getState(),authenticated});
  if(url.pathname.startsWith('/api/')){
   if(req.method!=='POST') return json(res,405,{error:'Método não permitido.'});
   if(req.headers.origin && req.headers.origin!==`http://${req.headers.host}` && req.headers.origin!==`https://${req.headers.host}`) return json(res,403,{error:'Origem inválida.'});
   let body='';for await(const chunk of req){body+=chunk;if(body.length>500000)return json(res,413,{error:'Arquivo muito grande.'});}
   const input=JSON.parse(body||'{}');
   if(url.pathname==='/api/login'){
    const ip=req.socket.remoteAddress;const record=attempts.get(ip)||{count:0,until:Date.now()+600000};if(record.until<Date.now()){record.count=0;record.until=Date.now()+600000;}attempts.set(ip,record);
    if(record.count>=10)return json(res,429,{error:'Muitas tentativas. Aguarde 10 minutos.'});
    record.count++;
    if(typeof input.password!=='string'||input.password.length>200||!timingSafeEqual(scryptSync(input.password,credentials.salt,64),Buffer.from(credentials.hash,'hex'))) return json(res,401,{error:'Senha incorreta.'});
    attempts.delete(ip);const token=randomBytes(32).toString('hex');sessions.set(token,Date.now()+86400000);
    res.setHeader('Set-Cookie',`arena_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${process.env.COOKIE_SECURE==='1'?'; Secure':''}`);return json(res,200,{ok:true});
   }
   if(!authenticated)return json(res,401,{error:'Entre como administrador para fazer alterações.'});
   const s=getState();
   if(url.pathname==='/api/logout'){sessions.delete(sid);res.setHeader('Set-Cookie','arena_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,200,{ok:true});}
   if(url.pathname==='/api/team'){
    if(!validText(input.name)||!validText(input.tag)||input.tag.length>5||!/^#[0-9a-f]{6}$/i.test(input.color))throw Error('Preencha nome, sigla (até 5 letras) e cor.');
    const old=s.teams.find(t=>t.id===input.id);const team={id:old?.id||randomBytes(8).toString('hex'),name:input.name.trim(),tag:input.tag.trim(),color:input.color};if(old)Object.assign(old,team);else s.teams.push(team);
   } else if(url.pathname==='/api/player'){
    if(!validText(input.name)||!s.teams.some(t=>t.id===input.teamId))throw Error('Preencha o apelido e escolha o time.');
    const old=s.players.find(p=>p.id===input.id);const player={id:old?.id||randomBytes(8).toString('hex'),name:input.name.trim(),teamId:input.teamId};if(old)Object.assign(old,player);else s.players.push(player);
   } else if(url.pathname==='/api/match'){
    validateMatch(input,s);const old=s.matches.find(m=>m.id===input.id);const match={id:old?.id||randomBytes(8).toString('hex'),date:input.date,map:input.map,teamA:input.teamA,teamB:input.teamB,scoreA:input.scoreA,scoreB:input.scoreB,status:input.status,stats:input.status==='finished'?input.stats:[]};if(old)Object.assign(old,match);else s.matches.push(match);
   } else if(url.pathname==='/api/delete-match') s.matches=s.matches.filter(m=>m.id!==input.id);
   else return json(res,404,{error:'Rota não encontrada.'});
   save(s);return json(res,200,{ok:true});
  }
  if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Método não permitido.'});
  const file=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1);
  const resolved=path.resolve(root,'public',file);
  if(!resolved.startsWith(path.join(root,'public')+path.sep))return json(res,403,{error:'Acesso negado.'});
  if(!existsSync(resolved))return json(res,404,{error:'Arquivo não encontrado.'});
  const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml'};
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(req.method==='HEAD'?undefined:readFileSync(resolved));
 } catch(e){json(res,400,{error:e instanceof SyntaxError?'JSON inválido.':e.message});}
});
if(process.env.NODE_ENV!=='test')server.listen(Number(process.env.PORT)||3000,process.env.HOST||'0.0.0.0',()=>console.log('CS ARENA disponível em http://localhost:'+(process.env.PORT||3000)));
