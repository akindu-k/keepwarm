import { Router } from 'express';
import { computeBudget, fitToLimit } from '../budget.js';
import { loadSettings, parseSettingsInput } from '../settings.js';
import { parseClock, ValidationError } from '../validate.js';

export function budgetRouter({ store, scheduler, config }) {
  const router = Router();
  const settings = () => loadSettings(store, config);

  router.get('/settings', (_req, res) => res.json(settings()));

  router.put('/settings', (req, res) => {
    const before = settings();
    const changes = parseSettingsInput(req.body);
    store.saveSettings(changes);
    if (changes.timezone && changes.timezone !== before.timezone) scheduler.rescheduleAll();
    res.json(settings());
  });

  router.get('/budget', (_req, res) => {
    res.json(computeBudget(store.listMonitors(), settings()));
  });

  // Sets every active monitor to a daily window sized so the projected monthly
  // usage fits the configured free-hour limit.
  router.post('/budget/fit', (req, res) => {
    const startMinute = parseClock(req.body?.start ?? '08:00');
    let plan;
    try {
      plan = fitToLimit(store.listMonitors(), settings(), { startMinute });
    } catch (err) {
      if (err instanceof RangeError) throw new ValidationError(err.message);
      throw err;
    }
    for (const w of plan.windows) {
      const monitor = store.getMonitor(w.id);
      scheduler.schedule(store.updateMonitor(w.id, { ...monitor, activeStart: w.activeStart, activeEnd: w.activeEnd }));
    }
    res.json({ ...plan, budget: computeBudget(store.listMonitors(), settings()) });
  });

  router.use((err, _req, res, next) => {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    next(err);
  });

  return router;
}
