# Cierre por módulo e integración posterior

Acuerdo del usuario del 03/10/2026 para el plan de SmartStorage.

Cada integrante termina su módulo de forma independiente. Una tarjeta de módulo
se marca Hecha cuando su parte está implementada, sus pruebas comprueban el
comportamiento y su contrato permite acoplarla al resto. No se espera a las
pantallas, al trabajo de otro integrante, al acoplamiento de Alegría ni a main.
La revisión conjunta se registra en las tareas de integración, sin convertirla
en requisito previo para cerrar el trabajo individual. Conservar la evidencia
y sus límites; cerrar un módulo no acredita el recorrido completo del producto.

Las dependencias indican contratos o insumos técnicos necesarios. No son una
exigencia de trabajar todos al mismo tiempo. Los consumidores pueden prepararse
con el contrato y dobles de prueba. Un defecto del módulo que incumple su propio
criterio sigue impidiendo su cierre; no se elimina por separar la integración.

Alegría acopla frontend y módulos en S3-09/S3-10; el equipo verifica el recorrido
y la regresión en S3-11. Cada autor corrige los defectos de su módulo que se
detecten allí. Si afectan una tarjeta cerrada, registrar y corregir el defecto
sin atribuir al autor las tareas de interfaz de Alegría.

Se conservan las fechas acordadas: corte del 06/10 para S3-04/S3-08/S3-09,
revisión y pruebas del 08/10 y entrega del 09/10. No modificar pendientes del
30% ni tarjetas EX en esta revisión.

## Aplicación a Andy

- S3-01, verificación de correo: Hecha como módulo backend en
  feature/usuarios-login, a8dd16be8432e2bc664685dccef378eeb44c3770. Emisión y hash
  del token, expiración, consumo atómico, reenvío, bloqueo de login y mailer SMTP
  implementados; 8 pruebas nuevas aprobadas el 03/10 con BD/correo simulados.
  Andy reportó uso de Brevo. El asistente no comprobó entrega SMTP real ni
  PostgreSQL en esa auditoría. Pantallas y comprobación conjunta: S3-09/S3-11.
- S3-02, recuperación de contraseña: Parcial. Dos defectos reproducidos el
  03/10 impiden el cierre propio: dos peticiones simultáneas consumen el mismo
  token y reciben 200; un fallo SMTP responde 500 para correo existente y 200
  para desconocido. Andy debe hacer consumo/cambio atómicos y mantener respuesta
  neutral, con pruebas de esos casos. Las pantallas no bloquean su cierre.

La implementación posterior de Andy debe evaluarse en su rama publicada,
conservando SHA y resultados. No presentar pruebas con servicios simulados
como entrega de correo real, prueba de PostgreSQL o revisión de compañero.
