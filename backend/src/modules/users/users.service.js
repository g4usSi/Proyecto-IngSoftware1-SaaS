import { AppError } from '../../lib/app-error.js';
import { toPublicUser } from '../auth/public-user.js';
import { UUID_PATTERN } from '../storage/storage.validation.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const SEARCH_MAX = 254;
const STATUS_FILTERS = { active: true, inactive: false };

// RF09: gestión de cuentas por el administrador. Las rutas ya exigen rol admin.
export function createUsersService({ repository }) {
  return {
    async listUsers(query) {
      const { search, active, page, pageSize } = parseListQuery(query ?? {});
      const { users, total } = await repository.listUsers({
        search, active, limit: pageSize, offset: (page - 1) * pageSize,
      });
      return { items: users.map(toPublicUser), total, page, pageSize };
    },

    async getUser(id) {
      return toPublicUser(await findOrFail(repository, id));
    },

    // identity = req.user (el admin que hace la petición).
    async setUserActive(identity, id, input) {
      const active = input?.active;
      if (typeof active !== 'boolean') fail('VALIDATION_ERROR', 'El campo active debe ser true o false.');
      assertUuid(id);
      // Evita que un administrador se bloquee a sí mismo por error.
      if (!active && id.toLowerCase() === identity.id.toLowerCase()) {
        fail('CANNOT_DEACTIVATE_SELF', 'No puedes desactivar tu propia cuenta.');
      }
      const user = await repository.setUserActive(id, active);
      if (!user) throw userNotFound();
      return toPublicUser(user);
    },
  };
}

async function findOrFail(repository, id) {
  assertUuid(id);
  const user = await repository.findUserById(id);
  if (!user) throw userNotFound();
  return user;
}

function parseListQuery(query) {
  let search = null;
  if (query.q !== undefined) {
    if (typeof query.q !== 'string') fail('VALIDATION_ERROR', 'El parámetro q debe ser texto.');
    const clean = query.q.trim();
    if (clean.length > SEARCH_MAX) fail('VALIDATION_ERROR', `La búsqueda no puede superar ${SEARCH_MAX} caracteres.`);
    if (clean !== '') search = clean;
  }

  let active = null;
  if (query.status !== undefined && query.status !== 'all') {
    if (!Object.hasOwn(STATUS_FILTERS, query.status)) {
      fail('VALIDATION_ERROR', 'El parámetro status debe ser active, inactive o all.');
    }
    active = STATUS_FILTERS[query.status];
  }

  const page = parsePositiveInt(query.page, 1, 'page');
  const pageSize = parsePositiveInt(query.pageSize, DEFAULT_PAGE_SIZE, 'pageSize');
  if (pageSize > MAX_PAGE_SIZE) fail('VALIDATION_ERROR', `El parámetro pageSize no puede superar ${MAX_PAGE_SIZE}.`);
  return { search, active, page, pageSize };
}

function parsePositiveInt(value, fallback, name) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d{1,9}$/.test(value) || Number(value) < 1) {
    fail('VALIDATION_ERROR', `El parámetro ${name} debe ser un número entero mayor que 0.`);
  }
  return Number(value);
}

function assertUuid(id) {
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) fail('INVALID_USER_ID', 'El ID de usuario no es válido.');
}

function userNotFound() {
  return new AppError(404, 'USER_NOT_FOUND', 'El usuario no existe.');
}

function fail(code, message) {
  throw new AppError(400, code, message);
}
