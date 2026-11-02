// Se carga antes de cada prueba (--import en npm test). backend/.env puede tener credenciales reales de
// Brevo y dotenv no reemplaza variables ya definidas: así ninguna prueba envía correo de verdad.
for (const name of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM']) {
  process.env[name] = '';
}
