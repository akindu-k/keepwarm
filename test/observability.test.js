import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';
import { Alerter } from '../src/alerts.js';

let t;
afterEach(() => t?.close());

// Returns scripted results in order, then repeats the last one.
const scripted = (...results) => {
  let i = 0;
  return async () => ({ startedAt: Date.now(), ...results[Math.min(i++, results.length - 1)] });
};
const up = (latencyMs = 100) => ({ latencyMs, statusCode: 200, ok: true, error: null });
const down = { latencyMs: 5, statusCode: 502, ok: false, error: 'HTTP 502' };

async function seed() {
  const { body } = await t.api('POST', '/api/monitors', { url: 'https://a.onrender.com', intervalMinutes: 5, enabled: false });
  for (let i = 0; i < 4; i++) await t.api('POST', `/api/monitors/${body.id}/ping`);
  return body.id;
}

test('stats, overview and history reflect recorded pings', async () => {
  t = await startTestServer({ pingFn: scripted(up(200), up(12_000), down, up(300)) });
  const id = await seed();

  const stats = await t.api('GET', `/api/monitors/${id}/stats?window=1h`);
  assert.equal(stats.status, 200);
  assert.equal(stats.body.total, 4);
  assert.equal(stats.body.uptimePct, 75);
  assert.equal(stats.body.coldStarts.count, 1);
  assert.equal(stats.body.incidents.length, 1);
  assert.equal(stats.body.incidents[0].ongoing, false);

  const overview = await t.api('GET', '/api/overview');
  assert.equal(overview.body.monitors[0].stats.total, 4);
  assert.equal(overview.body.monitors[0].stats.openIncident, null);
  assert.equal(overview.body.monitors[0].sparkline.length, 48);

  const history = await t.api('GET', `/api/monitors/${id}/pings?limit=3`);
  assert.equal(history.body.pings.length, 3);
  assert.equal(history.body.pings[0].latencyMs, 300);
  assert.ok(history.body.nextBefore);

  const failed = await t.api('GET', `/api/monitors/${id}/pings?status=failed`);
  assert.deepEqual(failed.body.pings.map((x) => x.error), ['HTTP 502']);

  assert.equal((await t.api('GET', `/api/monitors/${id}/stats?window=1y`)).status, 400);
});

test('/metrics exposes Prometheus metrics and /healthz reports status', async () => {
  t = await startTestServer({ pingFn: scripted(up(200), up(12_000), down, up(300)) });
  await seed();
  const text = await (await fetch(`${t.base}/metrics`)).text();
  assert.match(text, /keepwarm_monitor_up\{monitor="a.onrender.com",url="https:\/\/a.onrender.com\/"\} 1/);
  assert.match(text, /keepwarm_pings_total\{[^}]*result="ok"\} 3/);
  assert.match(text, /keepwarm_pings_total\{[^}]*result="failed"\} 1/);
  assert.match(text, /keepwarm_cold_starts_total\{[^}]*\} 1/);
  assert.match(text, /keepwarm_ping_latency_ms_count\{[^}]*\} 3/);

  const health = await t.api('GET', '/healthz');
  assert.equal(health.body.status, 'ok');
  assert.equal(health.body.monitors, 1);
});

test('/api/events streams ping results', async () => {
  t = await startTestServer();
  const { body } = await t.api('POST', '/api/monitors', { url: 'https://a.onrender.com', intervalMinutes: 5, enabled: false });
  const controller = new AbortController();
  const res = await fetch(`${t.base}/api/events`, { signal: controller.signal });
  assert.match(res.headers.get('content-type'), /^text\/event-stream/);
  const reader = res.body.getReader();
  await t.api('POST', `/api/monitors/${body.id}/ping`);
  let text = '';
  while (!text.includes('event: ping')) text += new TextDecoder().decode((await reader.read()).value);
  controller.abort();
  assert.match(text, /event: ping-start\ndata: \{"monitorId":\d+\}/);
  while (!/event: ping\ndata: .*\n/.test(text)) text += new TextDecoder().decode((await reader.read()).value);
  const data = JSON.parse(/event: ping\ndata: (.*)\n/.exec(text)[1]);
  assert.equal(data.monitorId, body.id);
  assert.equal(data.ping.statusCode, 200);
});

test('alerter posts only on up/down transitions', async () => {
  t = await startTestServer({ pingFn: scripted(up(), down, down, up()) });
  const sent = [];
  const alerter = new Alerter(t.store, {
    webhookUrl: 'https://hooks.example/x',
    fetchImpl: async (_url, opts) => { sent.push(JSON.parse(opts.body).text); return new Response(); },
  });
  t.scheduler.on('ping', (e) => alerter.onPing(e));
  await seed();
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.length, 2);
  assert.match(sent[0], /is down/);
  assert.match(sent[1], /recovered/);
});
