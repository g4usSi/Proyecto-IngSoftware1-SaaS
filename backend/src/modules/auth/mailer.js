// Mailer de desarrollo: no envía correo real, solo deja constancia en el log del servidor.
// Se reemplaza por un transporte SMTP real (Brevo) en cuanto el equipo tenga las credenciales.
export function createConsoleMailer() {
  return {
    async sendPasswordReset({ to, name, resetLink }) {
      console.log(
        `[mailer] Recuperación de contraseña para ${name} <${to}>\n` +
        `Enlace (vence en 1 hora): ${resetLink}`,
      );
    },
  };
}
