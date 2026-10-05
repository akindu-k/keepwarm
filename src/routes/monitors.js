import { Router } from 'express';
import { parseMonitorInput, ValidationError } from '../validate.js';

export function monitorsRouter({ store, scheduler, config }) {
  const router = Router();

  const withSchedule = (monitor) => ({
    ...monitor,
    nextPingAt: scheduler.getNextRunAt(monitor.id),
    sleeping: scheduler.isSleeping(monitor),
    pinging: scheduler.isPinging(monitor.id),
    lastPing: store.lastPing(monitor.id) ?? null,
  });

  const findMonitor = (req, res) => {
    const id = Number(req.params.id);
    const monitor = Number.isInteger(id) ? store.getMonitor(id) : null;
    if (!monitor) res.status(404).json({ error: 'monitor not found' });
    return monitor;
  };

  const isDuplicate = (url, exceptId) =>
    store.listMonitors().some((m) => m.url === url && m.id !== exceptId);

  router.get('/', (_req, res) => {
    res.json(store.listMonitors().map(withSchedule));
  });

  router.post('/', (req, res) => {
    if (store.countMonitors() >= config.maxMonitors) {
      return res.status(409).json({ error: `monitor limit (${config.maxMonitors}) reached` });
    }
    const input = parseMonitorInput(req.body, config);
    if (isDuplicate(input.url)) return res.status(409).json({ error: 'this URL is already being monitored' });
    const monitor = store.createMonitor(input);
    scheduler.schedule(monitor);
    res.status(201).json(withSchedule(monitor));
  });

  router.get('/:id', (req, res) => {
    const monitor = findMonitor(req, res);
    if (monitor) res.json(withSchedule(monitor));
  });

  router.patch('/:id', (req, res) => {
    const existing = findMonitor(req, res);
    if (!existing) return;
    const input = parseMonitorInput(req.body, config, existing);
    if (isDuplicate(input.url, existing.id)) {
      return res.status(409).json({ error: 'this URL is already being monitored' });
    }
    const monitor = store.updateMonitor(existing.id, input);
    scheduler.schedule(monitor);
    res.json(withSchedule(monitor));
  });

  router.delete('/:id', (req, res) => {
    const monitor = findMonitor(req, res);
    if (!monitor) return;
    scheduler.unschedule(monitor.id);
    store.deleteMonitor(monitor.id);
    res.status(204).end();
  });

  router.post('/:id/ping', async (req, res) => {
    const monitor = findMonitor(req, res);
    if (!monitor) return;
    const ping = await scheduler.runNow(monitor.id);
    if (!ping) return res.status(409).json({ error: 'a ping for this monitor is already in progress' });
    res.json(ping);
  });

  router.use((err, _req, res, next) => {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    next(err);
  });

  return router;
}
