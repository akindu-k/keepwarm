import { openDb, createStore } from '../src/db.js';
import { Scheduler } from '../src/scheduler.js';
import { createApp } from '../src/app.js';

export const testConfig = {
  allowAnyHost: false,
  minIntervalMinutes: 1,
  maxIntervalMinutes: 60,
  requestTimeoutMs: 1000,
  maxMonitors: 5,
};

export async function startTestServer({ pingFn, config = {} } = {}) {
  const store = createStore(openDb(':memory:'));
  const pings = [];
  const scheduler = new Scheduler(store, {
    timeoutMs: 1000,
    pingFn: pingFn ?? (async (url) => {
      pings.push(url);
      return { startedAt: Date.now(), latencyMs: 42, statusCode: 200, ok: true, error: null };
    }),
  });
  const app = createApp({ store, scheduler, config: { ...testConfig, ...config } });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const close = () => {
    scheduler.stop();
    server.closeAllConnections?.();
    return new Promise((r) => server.close(r));
  };
  return { store, scheduler, api, base, pings, close };
}
