// Demostración del SDK: cuota, subida con espera, listado, descarga y ahorro.
//   $env:SMARTSTORAGE_API_KEY = 'ss_...'
//   node sdk/examples/demo.mjs ruta\a\imagen.jpg
import path from 'node:path';
import { SmartStorageClient, SmartStorageError } from '../src/index.js';

const apiKey = process.env.SMARTSTORAGE_API_KEY;
const baseUrl = process.env.SMARTSTORAGE_URL ?? 'http://127.0.0.1:3000/api';
const image = process.argv[2];
if (!apiKey || !image) {
  console.error('Uso: definir SMARTSTORAGE_API_KEY y ejecutar: node sdk/examples/demo.mjs <imagen>');
  process.exit(1);
}

const mb = (bytes) => `${(Number(bytes) / 1e6).toFixed(2)} MB`;
const client = new SmartStorageClient({ apiKey, baseUrl });

try {
  const quota = await client.quota();
  console.log(`Plan ${quota.plan.name}: ${mb(quota.usedBytes)} usados de ${mb(quota.capacityBytes)}`);

  console.log(`Subiendo ${path.basename(image)}...`);
  const job = await client.uploadImage(image);
  console.log(`Publicada: imagen ${job.imageId}`);

  const { items } = await client.listImages({ limit: 5 });
  const uploaded = items.find((item) => item.id === job.imageId);
  if (uploaded) {
    console.log(`Original ${mb(uploaded.originalSizeBytes)} (${uploaded.originalFormat ?? 'formato no registrado'}) → WebP ${mb(uploaded.optimizedSizeBytes)}`);
  }

  const target = path.resolve(`${path.parse(image).name}-smartstorage.webp`);
  await client.downloadImageTo(job.imageId, target);
  console.log(`Descargada en ${target}`);

  const summary = await client.summary();
  console.log(`Ahorro acumulado de la cuenta: ${summary.savedPercent ?? 'no disponible'} %`);
} catch (error) {
  if (error instanceof SmartStorageError) console.error(`Error ${error.status} ${error.code}: ${error.message}`);
  else console.error(error);
  process.exitCode = 1;
}
