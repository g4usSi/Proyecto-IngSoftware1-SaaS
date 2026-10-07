import { createImageQueue, enqueueImageJob, readWorkerConfig } from './image-queue.js';

let queue;
export async function enqueueDefaultImageJob(id) {
  // Sólo POST necesita Redis; health, Auth y consultas no abren esta conexión.
  queue ??= createImageQueue(readWorkerConfig());
  let timer;
  try {
    await Promise.race([
      enqueueImageJob(queue, id),
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('QUEUE_UNAVAILABLE')), 2000); }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function closeImageAdmission() {
  const pending = queue;
  queue = undefined;
  await pending?.close();
}
