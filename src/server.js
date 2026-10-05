import { config } from './config.js';
import { openDb, createStore } from './db.js';
import { Scheduler } from './scheduler.js';
import { Metrics } from './metrics.js';
import { Alerter } from './alerts.js';
import { createApp } from './app.js';

const store = createStore(openDb(config.dbPath));
const scheduler = new Scheduler(store, { timeoutMs: config.requestTimeoutMs });
const metrics = new Metrics({ coldStartThresholdMs: config.coldStartThresholdMs });
const alerter = new Alerter(store, { webhookUrl: config.alertWebhookUrl });
const app = createApp({ store, scheduler, config, metrics });

scheduler.on('ping', ({ monitor, ping }) => {
  const status = ping.statusCode ?? ping.error;
  const cold = ping.ok && ping.latencyMs >= config.coldStartThresholdMs ? ' (cold start)' : '';
  console.log(`[ping] ${monitor.url} -> ${status} in ${ping.latencyMs} ms${cold}`);
  metrics.observe(monitor, ping);
  alerter.onPing({ monitor, ping });
});

// Drop ping history older than the retention window.
const prune = () => {
  const removed = store.prunePings(Date.now() - config.retentionDays * 24 * 60 * 60_000);
  if (removed) console.log(`[retention] removed ${removed} pings older than ${config.retentionDays} days`);
};
prune();
const pruneTimer = setInterval(prune, 60 * 60_000);
pruneTimer.unref();

scheduler.start();
const server = app.listen(config.port, () => {
  console.log(`keepwarm listening on http://localhost:${config.port}`);
});

const shutdown = () => {
  scheduler.stop();
  server.closeAllConnections();
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
