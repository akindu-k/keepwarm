import express from 'express';
import { fileURLToPath } from 'node:url';
import { monitorsRouter } from './routes/monitors.js';
import { observabilityRouter } from './routes/observability.js';

export function createApp({ store, scheduler, config, metrics }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()), monitors: store.countMonitors() });
  });

  if (metrics) {
    app.get('/metrics', (_req, res) => {
      res.type('text/plain; version=0.0.4').send(metrics.render(store));
    });
  }

  app.use('/api/monitors', monitorsRouter({ store, scheduler, config }));
  app.use('/api', observabilityRouter({ store, scheduler, config }));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON body' });
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}
