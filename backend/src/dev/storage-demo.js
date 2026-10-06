import express from 'express';
import { AppError } from '../lib/app-error.js';
import { requireAuth } from '../middleware/require-auth.js';

// Identidades reservadas para la demostración. Nunca se aceptan UUID arbitrarios.
export const DEMO_ACCOUNTS = Object.freeze([
  Object.freeze({ id: 'd0000000-0000-4000-8000-000000000001', name: 'Demo Storage A', email: 'storage-a@demo.invalid' }),
  Object.freeze({ id: 'd0000000-0000-4000-8000-000000000002', name: 'Demo Storage B', email: 'storage-b@demo.invalid' }),
]);

function requireLocalRequest(req) {
  const remote = req.socket.remoteAddress;
  let hostname;
  try { hostname = new URL(`http://${req.headers.host}`).hostname; } catch { /* Rechazar abajo. */ }
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
    throw new AppError(403, 'DEMO_LOCAL_ONLY', 'La demostración solo está disponible en este equipo.');
  }
}

async function readAccounts(database) {
  const result = await database.query(
    `SELECT id, name, email, role FROM users
     WHERE id = ANY($1::uuid[]) AND active = TRUE ORDER BY id`,
    [DEMO_ACCOUNTS.map((account) => account.id)],
  );
  if (result.rows.length !== DEMO_ACCOUNTS.length || result.rows.some((row, index) =>
    row.email !== DEMO_ACCOUNTS[index].email || row.role !== 'client')) {
    throw new AppError(503, 'DEMO_NOT_SEEDED', 'Prepara las dos cuentas locales con npm run db:seed:demo.');
  }
  return result.rows;
}

export function createStorageDemo({ database, enabled = false }) {
  const router = express.Router();
  router.get('/storage-demo', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!enabled) return res.json({ data: { enabled: false, accounts: [] } });
    requireLocalRequest(req);
    const accounts = await readAccounts(database);
    res.json({ data: { enabled: true, accounts: accounts.map(({ id, name, email }) => ({ id, name, email })) } });
  });

  async function authenticate(req, res, next) {
    const id = req.get('X-Storage-Demo-User');
    if (!enabled || !id) return requireAuth(req, res, next);
    try {
      requireLocalRequest(req);
      if (req.get('Authorization') || !DEMO_ACCOUNTS.some((account) => account.id === id)) {
        throw new AppError(401, 'INVALID_DEMO_IDENTITY', 'Selecciona una de las dos cuentas de demostración.');
      }
      const accounts = await readAccounts(database);
      const account = accounts.find((candidate) => candidate.id === id);
      req.user = { id: account.id, email: account.email, role: account.role };
      return next();
    } catch (error) { return next(error); }
  }

  return { router, authenticate };
}
