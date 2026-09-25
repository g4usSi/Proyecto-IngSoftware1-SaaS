import { once } from 'node:events';
import { createApp } from '../../src/app.js';

export const TEST_SECRET = 'secreto-de-pruebas-con-mas-de-32-caracteres!';

// BD falsa en memoria: solo entiende las consultas que usa el repository de auth.
export function createFakeDatabase({ failInsertWith, freePlanActive = true } = {}) {
  const users = new Map(); // por correo
  const revoked = new Map(); // por jti
  const calls = [];
  const subscriptions = new Map();
  let nextId = 1;

  return {
    users,
    revoked,
    subscriptions,
    calls,
    // Crea un usuario directamente (sin pasar por el registro).
    addUser(fields) {
      const user = {
        id: `3f1c1c1e-0000-4000-8000-${String(nextId++).padStart(12, '0')}`,
        role: 'client', active: true, email_verified: false, created_at: new Date('2026-09-24T12:00:00Z'),
        ...fields,
      };
      users.set(user.email, user);
      return user;
    },
    async query(sql, params) {
      calls.push({ sql, params });
      if (/FROM users WHERE email/i.test(sql)) {
        const user = users.get(params[0]);
        return { rows: user ? [user] : [] };
      }
      if (/FROM users WHERE id/i.test(sql)) {
        const user = [...users.values()].find((candidate) => candidate.id === params[0]);
        return { rows: user ? [{ ...user, password_hash: undefined }] : [] };
      }
      if (/^\s*INSERT INTO users/i.test(sql) || /WITH free_plan AS/i.test(sql)) {
        if (failInsertWith) throw Object.assign(new Error('duplicate key value'), { code: failInsertWith });
        if (!freePlanActive) return { rows: [] };
        const [name, email, password_hash] = params;
        const user = this.addUser({ name, email, password_hash });
        subscriptions.set(user.id, 'free');
        return { rows: [user] };
      }
      if (/FROM revoked_tokens WHERE jti/i.test(sql)) {
        return { rows: revoked.has(params[0]) ? [{ '?column?': 1 }] : [] };
      }
      if (/^\s*INSERT INTO revoked_tokens/i.test(sql)) {
        const [jti, user_id, expires_at] = params;
        if (!revoked.has(jti)) revoked.set(jti, { jti, user_id, expires_at });
        return { rows: [] };
      }
      if (/^\s*DELETE FROM revoked_tokens/i.test(sql)) {
        return { rows: [] };
      }
      throw new Error(`Consulta inesperada: ${sql}`);
    },
  };
}

// Levanta la API en un puerto libre y devuelve una función `request(ruta, opciones)`.
export async function withApi(t, database, options = {}) {
  const server = createApp({ database, jwtSecret: TEST_SECRET, ...options }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return (pathname, init) => fetch(`${base}${pathname}`, init);
}

export function postJson(request, pathname, body, headers = {}) {
  return request(pathname, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
}
