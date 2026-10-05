import { config } from './config.js';
import { openDb, createStore } from './db.js';
import { Scheduler } from './scheduler.js';
import { createApp } from './app.js';

const store = createStore(openDb(config.dbPath));
const scheduler = new Scheduler(store, { timeoutMs: config.requestTimeoutMs });
const app = createApp({ store, scheduler, config });

scheduler.on('ping', ({ monitor, ping }) => {
  const status = ping.statusCode ?? ping.error;
  console.log(`[ping] ${monitor.url} -> ${status} in ${ping.latencyMs} ms`);
});

scheduler.start();
const server = app.listen(config.port, () => {
  console.log(`keepwarm listening on http://localhost:${config.port}`);
});

const shutdown = () => {
  scheduler.stop();
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
