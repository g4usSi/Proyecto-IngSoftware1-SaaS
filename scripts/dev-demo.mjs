import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { env } from '../backend/src/config/env.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Ejecuta este comando mediante npm run dev:demo.');

function run(args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
    const stop = () => child.kill('SIGTERM');
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    child.once('error', reject);
    child.once('exit', (code) => {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      resolve(code ?? 1);
    });
  });
}

async function requireFreePort(port, host, service) {
  try {
    await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once('error', reject);
      probe.listen(port, host, () => probe.close(resolve));
    });
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      throw new Error(`${service} ya está ocupando ${host}:${port}. Detén la ejecución anterior de npm run dev con Ctrl+C y vuelve a iniciar npm run dev:demo.`);
    }
    throw error;
  }
}

try {
  await requireFreePort(env.port, env.host, 'La API');
  await requireFreePort(5173, '127.0.0.1', 'El frontend');
  const seeded = await run(['backend/scripts/seed-demo.js']);
  if (seeded !== 0) process.exitCode = seeded;
  else {
    console.log('DEMO LOCAL: abre http://127.0.0.1:5173/ y elige Probar demo local; selecciona una cuenta en Mi biblioteca. Se desactiva al cerrar este comando.');
    process.exitCode = await run([npmCli, 'run', 'dev'], { ...process.env, STORAGE_DEMO_ENABLED: 'true' });
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
