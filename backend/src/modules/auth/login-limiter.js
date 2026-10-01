// Límite de intentos fallidos de inicio de sesión (RNF11), en memoria y por correo.
// Se pierde al reiniciar la API. `now` se inyecta para poder simular el paso del tiempo en las pruebas.
export function createLoginLimiter({ maxAttempts = 5, lockMs = 15 * 60 * 1000, now = Date.now } = {}) {
  // clave -> { count, expiresAt }. La ventana de conteo dura lockMs desde el primer fallo;
  // al llegar a maxAttempts, el bloqueo dura lockMs desde ese último fallo.
  const entries = new Map();

  function active(key) {
    const entry = entries.get(key);
    if (entry && entry.expiresAt <= now()) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  }

  return {
    // Segundos que faltan para poder reintentar; 0 si no está bloqueado.
    lockedFor(key) {
      const entry = active(key);
      return entry && entry.count >= maxAttempts ? Math.ceil((entry.expiresAt - now()) / 1000) : 0;
    },

    recordFailure(key) {
      let entry = active(key);
      if (!entry) {
        entry = { count: 0, expiresAt: now() + lockMs };
        entries.set(key, entry);
      }
      entry.count += 1;
      if (entry.count === maxAttempts) entry.expiresAt = now() + lockMs;
      // Evita que el mapa crezca sin límite con correos inventados.
      if (entries.size > 1000) for (const k of entries.keys()) active(k);
    },

    reset(key) {
      entries.delete(key);
    },
  };
}
