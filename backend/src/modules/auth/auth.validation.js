import { AppError } from '../../lib/app-error.js';

const NAME_MAX = 120;
const EMAIL_MAX = 254;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
// Estructura básica usuario@dominio.tld, sin espacios.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

// Devuelve la lista de problemas de una contraseña (vacía si cumple la política).
export function passwordProblems(password) {
  const problems = [];
  if (password.length < PASSWORD_MIN) problems.push(`La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`);
  if (password.length > PASSWORD_MAX) problems.push(`La contraseña no puede superar ${PASSWORD_MAX} caracteres.`);
  if (!/\p{Ll}/u.test(password)) problems.push('La contraseña debe incluir una letra minúscula.');
  if (!/\p{Lu}/u.test(password)) problems.push('La contraseña debe incluir una letra mayúscula.');
  if (!/\d/.test(password)) problems.push('La contraseña debe incluir un número.');
  if (!/[^\p{L}\d\s]/u.test(password)) problems.push('La contraseña debe incluir un símbolo.');
  return problems;
}

// Valida y limpia los datos de registro (RF11). Lanza 400 con el primer problema encontrado.
export function validateRegistration(input) {
  const { name, email, password } = input ?? {};

  if (typeof name !== 'string' || name.trim() === '') fail('El nombre es obligatorio.');
  if (typeof email !== 'string' || email.trim() === '') fail('El correo electrónico es obligatorio.');
  if (typeof password !== 'string' || password === '') fail('La contraseña es obligatoria.');

  const cleanName = name.trim();
  const cleanEmail = normalizeEmail(email);
  if (cleanName.length > NAME_MAX) fail(`El nombre no puede superar ${NAME_MAX} caracteres.`);
  if (cleanEmail.length > EMAIL_MAX || !EMAIL_PATTERN.test(cleanEmail)) {
    fail('El formato del correo electrónico no es válido.');
  }
  const problems = passwordProblems(password);
  if (problems.length > 0) fail(problems[0]);

  return { name: cleanName, email: cleanEmail, password };
}

function fail(message) {
  throw new AppError(400, 'VALIDATION_ERROR', message);
}
