import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

const seeded = await run(['backend/scripts/seed-demo.js']);
if (seeded !== 0) process.exitCode = seeded;
else {
  console.log('DEMO LOCAL: selecciona explícitamente una cuenta en Mi biblioteca. Se desactiva al cerrar este comando.');
  process.exitCode = await run([npmCli, 'run', 'dev'], { ...process.env, STORAGE_DEMO_ENABLED: 'true' });
}
