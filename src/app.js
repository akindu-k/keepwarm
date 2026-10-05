import express from 'express';
import { monitorsRouter } from './routes/monitors.js';

export function createApp({ store, scheduler, config }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  app.use('/api/monitors', monitorsRouter({ store, scheduler, config }));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON body' });
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}
