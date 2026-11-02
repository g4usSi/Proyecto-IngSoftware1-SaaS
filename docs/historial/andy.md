# Historial de Andy: usuarios, autenticación, perfil, administración y permisos

Registro de entregas pasadas. Para el comportamiento actual, usar [autenticación](../auth-frontend.md) y [permisos](../permisos-api.md).

## Registro y sesiones (S2-02, S2-03, S3-03)

Registro con scrypt, login JWT, protección de rutas, aislamiento entre cuentas, revocación y logout. Comprobado con pruebas de backend e integración real. El vencimiento por tiempo se probó en backend, no en navegador.

## Verificación de correo y recuperación (S3-01, S3-02)

- **S3-01:** Hecha como módulo backend en `feature/usuarios-login` @ `a8dd16b`: token con hash, expiración, consumo atómico, reenvío, bloqueo de login y mailer SMTP. 8 pruebas nuevas el 03/10/2026, con BD y correo simulados. Andy reportó el uso de Brevo; en esa auditoría no se comprobó la entrega SMTP real ni PostgreSQL.
- **S3-02:** quedó Parcial el 03/10 por dos defectos reproducidos: dos peticiones simultáneas consumían el mismo token, y un fallo SMTP respondía distinto según existiera el correo. **Corregido** en `96f743e` y `69c7486`, integrados con el merge `f31d233`; la respuesta es neutral y el consumo, atómico.

## Perfil, usuarios, bitácora y permisos (S4-05)

`PATCH /auth/me`, gestión de usuarios, bitácora `auth_events` (migración 014, commit `a119ffc` de Geovanny) y [matriz de permisos](../permisos-api.md), verificada por `permissions-matrix.integration.test.js`. Decisión: el correo no se edita desde el perfil, porque cambiarlo exigiría volver a verificarlo.

## Mailer y Brevo

`modules/auth/mailer.js` es el transporte común de los correos. Desde `a91b84f` (Geovanny, 30/10/2026) también envía las facturas de pago.
