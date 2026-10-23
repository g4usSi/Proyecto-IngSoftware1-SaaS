export class AppError extends Error {
  // details: datos estructurados opcionales para el cliente (por ejemplo, cuánto espacio liberar).
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function notImplemented(code, message) {
  throw new AppError(501, code, message);
}
