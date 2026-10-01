// Copia de las reglas de backend/src/modules/auth/auth.validation.js.
// El backend responde solo el primer problema; aquí se calculan todos para mostrarlos a la vez.
// Si cambian las reglas del servidor, actualizar también este archivo.
const NAME_MAX = 120;
const EMAIL_MAX = 254;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Requisitos de contraseña, en el orden en que se muestran. */
export const passwordRules = [
  { id: 'min', label: `Al menos ${PASSWORD_MIN} caracteres`, test: (value) => value.length >= PASSWORD_MIN },
  { id: 'lower', label: 'Una letra minúscula', test: (value) => /\p{Ll}/u.test(value) },
  { id: 'upper', label: 'Una letra mayúscula', test: (value) => /\p{Lu}/u.test(value) },
  { id: 'number', label: 'Un número', test: (value) => /\d/.test(value) },
  { id: 'symbol', label: 'Un símbolo (por ejemplo # ! ?)', test: (value) => /[^\p{L}\d\s]/u.test(value) },
];

function emailErrors(email) {
  const clean = email.trim();
  if (!clean) return ['Escribe tu correo electrónico.'];
  if (clean.length > EMAIL_MAX || !EMAIL_PATTERN.test(clean.toLowerCase())) return ['Revisa el formato del correo, por ejemplo: nombre@correo.com.'];
  return [];
}

/** Devuelve { campo: [mensajes] } solo con los campos que tienen problemas. */
export function validateRegistration({ name, email, password }) {
  const errors = {};
  if (!name.trim()) errors.name = ['Escribe tu nombre.'];
  else if (name.trim().length > NAME_MAX) errors.name = [`El nombre no puede superar ${NAME_MAX} caracteres.`];

  const email_ = emailErrors(email);
  if (email_.length) errors.email = email_;

  if (!password) errors.password = ['Escribe una contraseña.'];
  else if (password.length > PASSWORD_MAX) errors.password = [`La contraseña no puede superar ${PASSWORD_MAX} caracteres.`];
  else {
    const missing = passwordRules.filter((rule) => !rule.test(password)).map((rule) => rule.id);
    if (missing.length) errors.password = missing;
  }
  return errors;
}

export function validateLogin({ email, password }) {
  const errors = {};
  const email_ = emailErrors(email);
  if (email_.length) errors.email = email_;
  if (!password) errors.password = ['Escribe tu contraseña.'];
  return errors;
}

/** Ubica un error del servidor en el campo que lo causó. */
export function fieldForServerError(error) {
  if (error?.code === 'EMAIL_ALREADY_REGISTERED') return 'email';
  if (error?.code === 'INVALID_CREDENTIALS') return 'password';
  const message = String(error?.message ?? '').toLowerCase();
  if (error?.code === 'VALIDATION_ERROR') {
    if (message.includes('nombre')) return 'name';
    if (message.includes('correo')) return 'email';
    if (message.includes('contraseña')) return 'password';
  }
  return null;
}
