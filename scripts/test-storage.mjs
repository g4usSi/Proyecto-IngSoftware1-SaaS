import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from '../backend/src/config/env.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const npmCli = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
if (!env.databaseUrl) throw new Error('Configura DATABASE_URL en backend/.env antes de ejecutar test:storage.');
const currentUrl = new URL(env.databaseUrl);
if (env.nodeEnv === 'production' || !['localhost', '127.0.0.1', '[::1]'].includes(currentUrl.hostname) || currentUrl.port !== '5433') {
  throw new Error('Las pruebas solo usarán PostgreSQL local en el puerto 5433, fuera de producción.');
}

const maintenanceUrl = new URL(currentUrl);
maintenanceUrl.pathname = '/postgres';
const admin = new pg.Client({ connectionString: maintenanceUrl.toString(), connectionTimeoutMillis: 3000 });
const name = `smartstorage_codex_check_${randomBytes(10).toString('hex')}`;
let created = false;
let testExitCode = 1;
let child;
let interrupted = false;
const interrupt = (signal) => {
  interrupted = true;
  child?.kill(signal);
};
const onSigInt = () => interrupt('SIGINT');
const onSigTerm = () => interrupt('SIGTERM');
process.on('SIGINT', onSigInt);
process.on('SIGTERM', onSigTerm);

try {
  await admin.connect();
  const role = await admin.query('SELECT rolcreatedb, rolsuper FROM pg_roles WHERE rolname = current_user');
  if (!role.rows[0]?.rolcreatedb && !role.rows[0]?.rolsuper) {
    throw new Error('El usuario de PostgreSQL no puede crear una base temporal de pruebas.');
  }
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  if (interrupted) throw new Error('Pruebas canceladas antes de iniciar npm test.');
  const testUrl = new URL(currentUrl);
  testUrl.pathname = `/${name}`;
  console.log('Base temporal aislada creada para ejecutar la suite completa.');
  testExitCode = await new Promise((resolve, reject) => {
    child = spawn(process.execPath, [npmCli, 'test'], {
      cwd: root,
      env: { ...process.env, TEST_DATABASE_URL: testUrl.toString() },
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
} finally {
  try {
    if (created) {
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      console.log('Base temporal de pruebas eliminada.');
    }
  } finally {
    process.removeListener('SIGINT', onSigInt);
    process.removeListener('SIGTERM', onSigTerm);
    await admin.end().catch(() => {});
  }
}
process.exitCode = testExitCode;
