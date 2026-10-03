import nodemailer from 'nodemailer';

// Con credenciales SMTP se envían correos reales; sin ellas (solo en desarrollo) se usa la consola.
export function createMailer(smtp) {
  return smtp ? createSmtpMailer(smtp) : createConsoleMailer();
}

export function createSmtpMailer({ host, port, user, pass, from }) {
  // El puerto 465 usa TLS desde el inicio; los demás (587) lo activan con STARTTLS.
  const transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  return {
    async sendPasswordReset({ to, name, resetLink }) {
      await transport.sendMail({ from, to, ...passwordResetMessage(name, resetLink) });
    },
    async sendEmailVerification({ to, name, verifyLink }) {
      await transport.sendMail({ from, to, ...emailVerificationMessage(name, verifyLink) });
    },
  };
}

// Mailer de desarrollo: no envía correo real, solo deja el enlace en el log del servidor.
export function createConsoleMailer() {
  return {
    async sendPasswordReset({ to, name, resetLink }) {
      console.log(`[mailer] Recuperación de contraseña para ${name} <${to}>\nEnlace (vence en 1 hora): ${resetLink}`);
    },
    async sendEmailVerification({ to, name, verifyLink }) {
      console.log(`[mailer] Verificación de correo para ${name} <${to}>\nEnlace (vence en 24 horas): ${verifyLink}`);
    },
  };
}

function passwordResetMessage(name, link) {
  return message({
    subject: 'Restablece tu contraseña de SmartStorage',
    name,
    intro: 'Recibimos una solicitud para restablecer la contraseña de tu cuenta.',
    action: 'Restablecer contraseña',
    link,
    outro: 'El enlace vence en 1 hora y solo se puede usar una vez. Si no lo solicitaste, ignora este correo: tu contraseña no cambiará.',
  });
}

export function emailVerificationMessage(name, link) {
  return message({
    subject: 'Verifica tu correo de SmartStorage',
    name,
    intro: 'Gracias por registrarte. Confirma tu correo electrónico para poder iniciar sesión.',
    action: 'Verificar correo',
    link,
    outro: 'El enlace vence en 24 horas. Si no creaste esta cuenta, ignora este correo.',
  });
}

function message({ subject, name, intro, action, link, outro }) {
  const text = `Hola, ${name}:\n\n${intro}\n\n${action}: ${link}\n\n${outro}`;
  const html = `<p>Hola, ${escapeHtml(name)}:</p>
<p>${intro}</p>
<p><a href="${escapeHtml(link)}">${action}</a></p>
<p>Si el botón no funciona, copia este enlace en tu navegador:<br>${escapeHtml(link)}</p>
<p>${outro}</p>`;
  return { subject, text, html };
}

// El nombre lo escribe el usuario: sin escapar podría inyectar HTML en el correo.
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ));
}
