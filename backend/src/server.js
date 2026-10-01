import { createApp } from './app.js';
import { env } from './config/env.js';
import { database } from './config/database.js';

const server = createApp().listen(env.port, env.host, () => {
  console.log(`SmartStorage API: http://${env.host}:${env.port}`);
  if (env.nodeEnv === 'development') {
    console.log('SmartStorage web (npm run dev): http://127.0.0.1:5173/');
    console.log('SmartStorage panel: http://127.0.0.1:5173/app');
  }
  if (env.storageDemo) {
    console.log('SmartStorage biblioteca demo: http://127.0.0.1:5173/app/storage');
  }
  if (!env.databaseUrl) {
    console.log('DATABASE_URL sin configurar: /api/health funciona y /api/ready devuelve 503.');
  }
});

server.on('error', (error) => {
  console.error(`No se pudo iniciar el servidor (${error.code || 'ERROR'}).`);
  process.exitCode = 1;
});

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  const timer = setTimeout(() => {
    console.error('Se agotó el tiempo de cierre de la API.');
    process.exit(1);
  }, 10000);
  timer.unref();
  server.close(async () => {
    try {
      await database.close();
    } catch {
      process.exitCode = 1;
    } finally {
      clearTimeout(timer);
    }
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
