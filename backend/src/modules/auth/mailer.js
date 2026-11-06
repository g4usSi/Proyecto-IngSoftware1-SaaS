import { readFileSync } from 'node:fs';
import nodemailer from 'nodemailer';

// Con credenciales SMTP se envían correos reales; sin ellas (solo en desarrollo) se usa la consola.
export function createMailer(smtp) {
  return smtp ? createSmtpMailer(smtp) : createConsoleMailer();
}

export function createSmtpMailer({ host, port, user, pass, from }) {
  // El puerto 465 usa TLS desde el inicio; los demás (587) lo activan con STARTTLS.
  const transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  // Sin nombre visible, Gmail muestra la parte local del correo (p. ej. «andyml2639»).
  const sender = /<.+>/.test(from) ? from : { name: 'SmartStorage', address: from };
  return {
    async sendPasswordReset({ to, name, resetLink }) {
      await transport.sendMail({ from: sender, to, ...passwordResetMessage(name, resetLink) });
    },
    async sendEmailVerification({ to, name, verifyLink }) {
      await transport.sendMail({ from: sender, to, ...emailVerificationMessage(name, verifyLink) });
    },
    // message: { subject, text, html, attachments }, armado por el módulo de pagos.
    async sendInvoice({ to, message }) {
      await transport.sendMail({ from: sender, to, ...message });
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
    async sendInvoice({ to, message }) {
      console.log(`[mailer] Sin SMTP: no se envió "${message.subject}" a <${to}>`);
    },
  };
}

function passwordResetMessage(name, link) {
  return message({
    subject: 'Restablece tu contraseña de SmartStorage',
    title: 'Restablece tu contraseña',
    name,
    intro: 'Recibimos una solicitud para restablecer la contraseña de tu cuenta. Elige una nueva con el botón:',
    action: 'Restablecer contraseña',
    link,
    note: 'El enlace vence en 1 hora y solo se puede usar una vez.',
    outro: 'Si no lo solicitaste, ignora este correo: tu contraseña no cambiará.',
  });
}

export function emailVerificationMessage(name, link) {
  return message({
    subject: 'Verifica tu correo de SmartStorage',
    title: 'Confirma tu correo',
    name,
    intro: 'Gracias por registrarte en SmartStorage. Confirma tu correo electrónico para activar tu cuenta e iniciar sesión.',
    action: 'Verificar correo',
    link,
    note: 'El enlace vence en 24 horas.',
    outro: 'Si no creaste esta cuenta, ignora este correo.',
  });
}

// Mismo diseño que el correo de factura (subscriptions/invoice-email.js): logo incrustado, borde naranja y botón.
function message({ subject, title, name, intro, action, link, note, outro }) {
  const text = `Hola, ${name}:\n\n${intro}\n\n${action}: ${link}\n\n${note}\n${outro}`;
  const href = escapeHtml(link);
  const html = `<!doctype html>
<html lang="es"><body style="margin:0;padding:0;background:#F6F7F8;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F7F8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E7EAED;border-top:6px solid #FB7A3C;border-radius:8px">
<tr><td style="padding:24px 28px 8px"><img src="cid:${LOGO_CID}" width="170" alt="SmartStorage" style="display:block;border:0;width:170px;height:auto"></td></tr>
<tr><td style="padding:8px 28px 0">
<h1 style="margin:0 0 8px;color:#1B304A;font-size:22px;line-height:1.3">${title}</h1>
<p style="margin:0 0 6px;color:#171325;font-size:15px;line-height:1.5">Hola, ${escapeHtml(name)}:</p>
<p style="margin:0 0 22px;color:#5F6B7A;font-size:15px;line-height:1.5">${intro}</p>
<p style="margin:0 0 22px"><a href="${href}" style="display:inline-block;padding:12px 22px;background:#FB7A3C;color:#16273D;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none">${action}</a></p>
<p style="margin:0 0 6px;color:#5F6B7A;font-size:13px;line-height:1.5">${note} Si el botón no funciona, copia este enlace en tu navegador:</p>
<p style="margin:0 0 22px;font-size:12px;line-height:1.5;word-break:break-all"><a href="${href}" style="color:#A45333">${href}</a></p>
</td></tr>
<tr><td style="padding:14px 28px 22px;border-top:1px solid #E7EAED;color:#5F6B7A;font-size:12px;line-height:1.5">${outro}</td></tr>
</table>
</td></tr></table>
</body></html>`;
  return { subject, text, html, attachments: [logoAttachment()] };
}

// PNG porque los clientes de correo no muestran SVG. Mismo logo que el correo de factura.
const LOGO_CID = 'smartstorage-logo';
let logoPng;
function logoAttachment() {
  logoPng ??= readFileSync(new URL('../../../assets/smartstorage-logo.png', import.meta.url));
  return { filename: 'smartstorage-logo.png', content: logoPng, contentType: 'image/png', cid: LOGO_CID };
}

// El nombre lo escribe el usuario: sin escapar podría inyectar HTML en el correo.
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ));
}
