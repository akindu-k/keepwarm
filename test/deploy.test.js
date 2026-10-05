import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, testConfig } from './helpers.js';
import { openDb, createStore } from '../src/db.js';
import { seedMonitors } from '../src/seed.js';

let t;
afterEach(() => t?.close());

const auth = (pw) => ({ authorization: `Basic ${Buffer.from(`admin:${pw}`).toString('base64')}` });

test('DASHBOARD_PASSWORD protects the UI and API but not /healthz', async () => {
  t = await startTestServer({ config: { dashboardPassword: 's3cret:with-colon' } });
  assert.equal((await fetch(`${t.base}/healthz`)).status, 200);
  const denied = await fetch(`${t.base}/api/monitors`);
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get('www-authenticate'), /Basic/);
  assert.equal((await fetch(`${t.base}/`, { headers: auth('wrong') })).status, 401);
  assert.equal((await fetch(`${t.base}/api/monitors`, { headers: auth('s3cret:with-colon') })).status, 200);
  assert.equal((await fetch(`${t.base}/metrics`, { headers: auth('s3cret:with-colon') })).status, 200);
});

test('serves the dashboard without a password by default', async () => {
  t = await startTestServer();
  const res = await fetch(`${t.base}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<title>keepwarm<\/title>/);
});

test('seedMonitors creates missing monitors and is idempotent', () => {
  const store = createStore(openDb(':memory:'));
  const spec = 'https://md-to-pdf-zckb.onrender.com/=5, https://things-to-do-xdmm.onrender.com';
  const first = seedMonitors(store, spec, testConfig);
  assert.deepEqual(first.map((m) => [m.url, m.intervalMinutes]), [
    ['https://md-to-pdf-zckb.onrender.com/', 5],
    ['https://things-to-do-xdmm.onrender.com/', 10],
  ]);
  assert.equal(seedMonitors(store, spec, testConfig).length, 0);
  assert.throws(() => seedMonitors(store, 'https://example.com=5', testConfig), /Render URL/);
});
