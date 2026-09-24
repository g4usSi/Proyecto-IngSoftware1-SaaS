import { database } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { DEMO_ACCOUNTS } from '../src/dev/storage-demo.js';

let client;
try {
  const databaseHost = env.databaseUrl && new URL(env.databaseUrl).hostname;
  if (env.nodeEnv === 'production' || !['localhost', '127.0.0.1', '[::1]'].includes(databaseHost)) {
    throw new Error('Las cuentas demo solo se preparan en una base PostgreSQL local, fuera de producción.');
  }
  client = await database.connect();
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('smartstorage:demo-seed'))");
  const plan = await client.query("SELECT id FROM plans WHERE code = 'free' AND active = TRUE");
  if (plan.rows.length !== 1) throw new Error('Ejecuta npm run db:migrate para preparar el plan Free.');
  for (const account of DEMO_ACCOUNTS) {
    // No existe una contraseña de acceso: estas cuentas solo se usan con el modo local explícito.
    await client.query(`INSERT INTO users (id, name, email, password_hash, role)
      VALUES ($1, $2, $3, '!disabled:storage-demo', 'client') ON CONFLICT (id) DO NOTHING`,
    [account.id, account.name, account.email]);
    const existing = await client.query('SELECT email, role, active, password_hash FROM users WHERE id = $1 FOR UPDATE', [account.id]);
    const row = existing.rows[0];
    if (row.email !== account.email || row.role !== 'client' || !row.active || row.password_hash !== '!disabled:storage-demo') {
      throw new Error('Un identificador reservado demo ya está ocupado por una cuenta diferente; no se modificó.');
    }
    const subscription = await client.query("SELECT plan_id FROM subscriptions WHERE user_id = $1 AND status = 'active'", [account.id]);
    if (subscription.rows.length === 0) {
      await client.query("INSERT INTO subscriptions (user_id, plan_id, status) VALUES ($1, $2, 'active')", [account.id, plan.rows[0].id]);
    }
  }
  await client.query('COMMIT');
  console.log('Dos cuentas locales de Storage listas con suscripción Free. No se habilitó el modo demo en .env.');
} catch (error) {
  if (client) await client.query('ROLLBACK').catch(() => {});
  console.error('No se preparó la demostración:', error.code ? `error ${error.code}; revisa la conexión y las migraciones.` : error.message);
  process.exitCode = 1;
} finally {
  client?.release();
  await database.close();
}
