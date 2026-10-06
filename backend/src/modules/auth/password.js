import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

// `promisify` convierte una función con callback (estilo antiguo de Node) en una
// que devuelve una Promesa, para poder usarla con `await`.
const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

// scrypt es un hash lento y "memoria-dura", pensado para contraseñas (RNF01).
// Se guarda como "sal:hash" en hexadecimal; cada contraseña usa una sal aleatoria propia.
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  // Buffer.from(valor, 'hex') acepta texto inválido y puede devolver un buffer vacío.
  // Un hash vacío haría que cualquier contraseña pareciera válida.
  const match = /^([0-9a-f]{32}):([0-9a-f]{128})$/i.exec(stored);
  if (!match) return false;
  const expected = Buffer.from(match[2], 'hex');
  const actual = await scryptAsync(password, Buffer.from(match[1], 'hex'), KEY_LENGTH);
  // timingSafeEqual compara en tiempo constante para no filtrar información por la duración.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
