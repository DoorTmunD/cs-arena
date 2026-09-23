import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const file = path.join(root, 'data', 'cloudflare-admin-password.txt');
mkdirSync(path.dirname(file), { recursive: true });
if (!existsSync(file)) writeFileSync(file, randomBytes(24).toString('base64url') + '\n', { mode: 0o600, flag: 'wx' });
const password = readFileSync(file, 'utf8').trim();
if (password.length < 16 || password.length > 200) throw Error('A senha precisa ter entre 16 e 200 caracteres.');
const result = spawnSync(process.execPath, [path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'secret', 'put', 'ADMIN_PASSWORD'], {
  cwd: root, input: password + '\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
});
if (result.error) throw result.error;
if (result.stdout) process.stdout.write(result.stdout.replaceAll(password, '[redacted]'));
if (result.stderr) process.stderr.write(result.stderr.replaceAll(password, '[redacted]'));
if (result.status !== 0) process.exit(result.status || 1);
console.log('Senha do organizador salva localmente em: ' + file);
console.log('Esse arquivo está ignorado pelo Git. Abra-o para consultar sua senha.');
