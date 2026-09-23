import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const dataDir=mkdtempSync(path.join(tmpdir(),'cs-arena-test-'));
let processHandle,base,cookie;
async function start(){
 processHandle=spawn(process.execPath,['server.js'],{env:{...process.env,NODE_ENV:'development',PORT:'31987',HOST:'127.0.0.1',DATA_DIR:dataDir,ADMIN_PASSWORD:'test-arena-password'},stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server startup timeout')),10000);processHandle.stdout.on('data',chunk=>{if(chunk.toString().includes('disponível')){clearTimeout(timer);resolve();}});processHandle.once('error',reject);processHandle.once('exit',code=>{clearTimeout(timer);if(code)reject(Error('Server exit '+code));});});
 base='http://127.0.0.1:31987';
}
async function stop(){if(processHandle&&!processHandle.killed){const exited=new Promise(r=>processHandle.once('exit',r));processHandle.kill();await exited;}}
async function post(route,body,auth=true){return fetch(base+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json',...(auth&&cookie?{cookie}:{})},body:JSON.stringify(body)});}
const state=()=>fetch(base+'/api/state').then(r=>r.json());
before(start);after(stop);
test('public assets and read-only data are available',async()=>{
 const health=await fetch(base+'/healthz');assert.equal(health.status,200);assert.deepEqual(await health.json(),{status:'ok'});
 for(const file of ['/','/app.js','/style.css','/hero.png'])assert.equal((await fetch(base+file)).status,200,file);
 const s=await state();assert.equal(s.authenticated,false);assert.deepEqual(s.teams,[]);assert.deepEqual(s.players,[]);assert.deepEqual(s.matches,[]);
 assert.equal((await post('team',{name:'Unauthorized'},false)).status,401);
 assert.equal((await fetch(base+'/../server.js')).status,404);
});
test('login, validation, CRUD and persistence',async()=>{
 assert.equal((await post('login',{password:'wrong'},false)).status,401);
 const login=await post('login',{password:'test-arena-password'},false);assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];assert.match(login.headers.get('set-cookie'),/HttpOnly/);
 assert.equal((await post('team',{name:'Test Squad',tag:'TST',color:'#abcdef'})).status,200);
 let s=await state();const t=s.teams.find(t=>t.tag==='TST');assert.ok(t);
 assert.equal((await post('player',{name:'Test player',teamId:t.id})).status,200);
 s=await state();const p=s.players.find(p=>p.name==='Test player');
 assert.equal((await post('team',{name:'Opponent',tag:'OPP',color:'#aabbcc'})).status,200);
 const opponent=(await state()).teams.find(t=>t.tag==='OPP');
 const match={teamA:t.id,teamB:opponent.id,date:'2026-09-26T20:00',map:'Mirage',scoreA:13,scoreB:9,status:'finished',stats:[{playerId:p.id,teamId:t.id,kills:27,deaths:12,assists:5}]};
 assert.equal((await post('match',{...match,teamB:t.id})).status,400);
 assert.equal((await post('match',{...match,stats:[{...match.stats[0],kills:-1}]})).status,400);
 assert.equal((await post('match',{...match,stats:[match.stats[0],match.stats[0]]})).status,400);
 assert.equal((await post('match',match)).status,200);
 s=await state();const saved=s.matches.find(m=>m.teamA===t.id);assert.equal(saved.stats[0].kills,27);
 assert.equal((await post('match',{...saved,scoreB:11})).status,200);
 await stop();await start();s=await state();assert.equal(s.matches.find(m=>m.id===saved.id).scoreB,11);
 assert.equal((await post('delete-match',{id:saved.id})).status,401);
 const again=await post('login',{password:'test-arena-password'},false);cookie=again.headers.get('set-cookie').split(';')[0];
 assert.equal((await post('delete-match',{id:saved.id})).status,200);assert.ok(!(await state()).matches.some(m=>m.id===saved.id));
 assert.equal((await post('reset-demo',{})).status,404);s=await state();assert.equal(s.teams.length,2);assert.equal(s.players.length,1);assert.equal(s.matches.length,0);
});
test('rankings exclude scheduled games and aggregate match statistics',()=>{
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').split("document.addEventListener('click'")[0];
 const context=vm.createContext({document:{querySelector:()=>null},console,Date,location:{hash:''}});
 vm.runInContext(source,context);
 const fixture={teams:[{id:'a',name:'Alpha'},{id:'b',name:'Beta'}],players:[{id:'p1',name:'One',teamId:'a'}],matches:[{status:'finished',teamA:'a',teamB:'b',scoreA:13,scoreB:8,stats:[{playerId:'p1',kills:20,deaths:10,assists:4}]},{status:'finished',teamA:'a',teamB:'b',scoreA:12,scoreB:12,stats:[{playerId:'p1',kills:10,deaths:5,assists:2}]},{status:'scheduled',teamA:'b',teamB:'a',scoreA:99,scoreB:0,stats:[]}]};
 vm.runInContext('state='+JSON.stringify(fixture),context);const result=vm.runInContext('rankings()',context);
 assert.equal(result.teams[0].id,'a');assert.equal(result.teams[0].points,4);assert.equal(result.teams[0].games,2);assert.equal(result.teams[0].rounds,5);assert.equal(result.players[0].kills,30);assert.equal(result.players[0].deaths,15);assert.equal(result.players[0].assists,6);
});
