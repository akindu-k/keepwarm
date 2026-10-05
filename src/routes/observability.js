import { Router } from 'express';
import { computeStats, WINDOWS } from '../stats.js';

export function observabilityRouter({ store, scheduler, config }) {
  const router = Router();

  const findMonitor = (req, res) => {
    const id = Number(req.params.id);
    const monitor = Number.isInteger(id) ? store.getMonitor(id) : null;
    if (!monitor) res.status(404).json({ error: 'monitor not found' });
    return monitor;
  };

  const statsFor = (monitor, windowKey) => {
    const to = Date.now();
    const from = to - WINDOWS[windowKey];
    return computeStats(store.pingsSince(monitor.id, from), {
      from, to, coldStartThresholdMs: config.coldStartThresholdMs,
    });
  };

  const parseWindow = (req, res) => {
    const key = req.query.window ?? '24h';
    if (!WINDOWS[key]) {
      res.status(400).json({ error: `window must be one of ${Object.keys(WINDOWS).join(', ')}` });
      return null;
    }
    return key;
  };

  // Every monitor with a compact summary, for dashboards.
  router.get('/overview', (req, res) => {
    const windowKey = parseWindow(req, res);
    if (!windowKey) return;
    const monitors = store.listMonitors().map((m) => {
      const { series, incidents, ...stats } = statsFor(m, windowKey);
      return {
        ...m,
        nextPingAt: scheduler.getNextRunAt(m.id),
        lastPing: store.lastPing(m.id) ?? null,
        stats: { ...stats, openIncident: incidents.find((i) => i.ongoing) ?? null },
        sparkline: series.map((b) => ({ start: b.start, avgLatencyMs: b.avgLatencyMs, failures: b.failures })),
      };
    });
    res.json({ window: windowKey, generatedAt: Date.now(), monitors });
  });

  router.get('/monitors/:id/stats', (req, res) => {
    const monitor = findMonitor(req, res);
    if (!monitor) return;
    const windowKey = parseWindow(req, res);
    if (!windowKey) return;
    res.json({ window: windowKey, ...statsFor(monitor, windowKey) });
  });

  // Paginated request log, newest first. Pass ?before=<nextBefore> to fetch older entries.
  router.get('/monitors/:id/pings', (req, res) => {
    const monitor = findMonitor(req, res);
    if (!monitor) return;
    const limit = Math.min(500, Math.max(1, Number.parseInt(req.query.limit ?? '50', 10) || 50));
    const before = Number.parseInt(req.query.before ?? '', 10) || undefined;
    const failedOnly = req.query.status === 'failed';
    const pings = store.pingHistory(monitor.id, { before, limit, failedOnly });
    res.json({
      pings,
      nextBefore: pings.length === limit ? pings.at(-1).id : null,
    });
  });

  // Live stream of ping results (Server-Sent Events).
  router.get('/events', (req, res) => {
    res.set({
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 5000\n\n');

    const onPing = ({ monitor, ping }) => {
      res.write(`event: ping\ndata: ${JSON.stringify({ monitorId: monitor.id, ping })}\n\n`);
    };
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25_000);
    scheduler.on('ping', onPing);
    req.on('close', () => {
      clearInterval(heartbeat);
      scheduler.off('ping', onPing);
    });
  });

  return router;
}
