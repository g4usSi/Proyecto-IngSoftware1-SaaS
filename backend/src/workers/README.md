# Worker de imágenes

`npm run worker:images` consume BullMQ, convierte con Sharp y publica referencias privadas usando cuotas reales en la misma transacción. `npm run worker:recover` realiza un barrido de entrega, publicación, expiración y limpieza.

API, consumidor y recuperador usan createManagedImageJobs y comparten PostgreSQL, Redis y STORAGE_ROOT. Aplicar migraciones con esos procesos detenidos. POST /api/jobs devuelve 202; POST /api/files conserva la ruta síncrona con cuotas compartidas.

Operación, bloqueos y pruebas: [worker-cuotas.md](../../../docs/worker-cuotas.md). Contratos pendientes de frontend: [guía de Alegría](../../../docs/frontend-auth-jobs-handoff.md).
