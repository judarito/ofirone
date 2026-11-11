import { getEnv } from './config/env.js';
import { runWorkerLoop, runWorkerOnce } from './workers/asyncJobWorker.js';

const env = getEnv();
const once = process.argv.includes('--once');

if (once) {
  const summary = await runWorkerOnce({ env, logger: console });
  console.log(JSON.stringify(summary));
} else {
  await runWorkerLoop({ env, logger: console });
}

