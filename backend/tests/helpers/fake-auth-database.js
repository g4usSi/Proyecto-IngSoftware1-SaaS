import { once } from 'node:events';
import { createApp } from '../../src/app.js';

export const TEST_SECRET = 'secreto-de-pruebas-con-mas-de-32-caracteres!';

// BD falsa en memoria: solo entiende las consultas que usa el repository de auth.
export function createFakeDatabase({ failInsertWith, freePlanActive = true } = {}) {
  const users = new Map(); // por correo
  const revoked = new Map(); // por jti
  const passwordResets = new Map(); // por id
  const emailVerifications = new Map(); // por id
  const calls = [];
  const subscriptions = new Map();
  let nextId = 1;
  let nextResetId = 1;
  let nextVerificationId = 1;

  return {
    users,
    revoked,
    passwordResets,
    emailVerifications,
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
      if (/^\s*INSERT INTO password_reset_tokens/i.test(sql)) {
        const [user_id, token_hash, expires_at] = params;
        const id = `reset-${nextResetId++}`;
        passwordResets.set(id, { id, user_id, token_hash, expires_at: new Date(expires_at), used_at: null });
        return { rows: [] };
      }
      // Todo ocurre sin `await` intermedio, igual que la sentencia única de PostgreSQL.
      if (/WITH consumed_reset AS/i.test(sql)) {
        const [token_hash, password_hash] = params;
        const record = [...passwordResets.values()].find(
          (candidate) => candidate.token_hash === token_hash && !candidate.used_at && candidate.expires_at > new Date(),
        );
        if (!record) return { rows: [] };
        for (const candidate of passwordResets.values()) {
          if (candidate.user_id === record.user_id && !candidate.used_at) candidate.used_at = new Date();
        }
        const user = [...users.values()].find((candidate) => candidate.id === record.user_id);
        user.password_hash = password_hash;
        return { rows: [{ id: user.id }] };
      }
      if (/^\s*UPDATE password_reset_tokens SET used_at = now\(\) WHERE user_id/i.test(sql)) {
        for (const record of passwordResets.values()) {
          if (record.user_id === params[0] && !record.used_at) record.used_at = new Date();
        }
        return { rows: [] };
      }
      // Cambio de contraseña: solo si el hash sigue siendo el esperado (sin `await` intermedio).
      if (/WITH changed AS/i.test(sql)) {
        const [user_id, expected_hash, new_hash] = params;
        const user = [...users.values()].find((candidate) => candidate.id === user_id);
        if (!user || user.password_hash !== expected_hash) return { rows: [] };
        user.password_hash = new_hash;
        for (const record of passwordResets.values()) {
          if (record.user_id === user_id && !record.used_at) record.used_at = new Date();
        }
        return { rows: [{ id: user.id }] };
      }
      if (/^\s*INSERT INTO email_verification_tokens/i.test(sql)) {
        const [user_id, token_hash, expires_at] = params;
        const id = `verify-${nextVerificationId++}`;
        emailVerifications.set(id, { id, user_id, token_hash, expires_at: new Date(expires_at), used_at: null });
        return { rows: [] };
      }
      if (/^\s*UPDATE email_verification_tokens SET used_at = now\(\) WHERE user_id/i.test(sql)) {
        for (const record of emailVerifications.values()) {
          if (record.user_id === params[0] && !record.used_at) record.used_at = new Date();
        }
        return { rows: [] };
      }
      if (/WITH consumed AS/i.test(sql)) {
        const record = [...emailVerifications.values()].find(
          (candidate) => candidate.token_hash === params[0] && !candidate.used_at && candidate.expires_at > new Date(),
        );
        if (!record) return { rows: [] };
        record.used_at = new Date();
        const user = [...users.values()].find((candidate) => candidate.id === record.user_id);
        user.email_verified = true;
        return { rows: [{ id: user.id }] };
      }
      throw new Error(`Consulta inesperada: ${sql}`);
    },
  };
}

// Guarda los correos en memoria en vez de enviarlos.
export function createFakeMailer() {
  const resets = [];
  const verifications = [];
  return {
    resets,
    verifications,
    async sendPasswordReset(message) { resets.push(message); },
    async sendEmailVerification(message) { verifications.push(message); },
  };
}

export function tokenFromLink(link) {
  return new URL(link).searchParams.get('token');
}

// Levanta la API en un puerto libre y devuelve una función `request(ruta, opciones)`.
// Siempre usa un mailer falso: backend/.env puede tener credenciales SMTP reales.
export async function withApi(t, database, options = {}) {
  const server = createApp({
    database, jwtSecret: TEST_SECRET, mailer: createFakeMailer(), frontendUrl: 'http://localhost:5173', ...options,
  }).listen(0, '127.0.0.1');
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
