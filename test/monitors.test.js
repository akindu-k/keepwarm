import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

let t;
beforeEach(async () => { t = await startTestServer(); });
afterEach(() => t.close());

const waitFor = async (fn) => {
  for (let i = 0; i < 50; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('condition not met');
};

test('creating a monitor pings it immediately and schedules the next ping', async () => {
  const res = await t.api('POST', '/api/monitors', { url: 'https://md-to-pdf-zckb.onrender.com/', intervalMinutes: 5 });
  assert.equal(res.status, 201);
  assert.equal(res.body.intervalMinutes, 5);
  await waitFor(() => t.pings.length === 1);
  assert.deepEqual(t.pings, ['https://md-to-pdf-zckb.onrender.com/']);

  const after = await t.api('GET', `/api/monitors/${res.body.id}`);
  assert.equal(after.body.lastPing.statusCode, 200);
  const expected = after.body.lastPing.startedAt + 5 * 60_000;
  assert.ok(Math.abs(after.body.nextPingAt - expected) < 1000);
});

test('rejects invalid input and duplicates', async () => {
  assert.equal((await t.api('POST', '/api/monitors', { url: 'https://google.com', intervalMinutes: 5 })).status, 400);
  assert.equal((await t.api('POST', '/api/monitors', { url: 'https://a.onrender.com', intervalMinutes: 999 })).status, 400);
  assert.equal((await t.api('POST', '/api/monitors', { url: 'https://a.onrender.com', intervalMinutes: 5 })).status, 201);
  assert.equal((await t.api('POST', '/api/monitors', { url: 'https://a.onrender.com/', intervalMinutes: 10 })).status, 409);
});

test('enforces the monitor limit', async () => {
  for (let i = 0; i < 5; i++) {
    assert.equal((await t.api('POST', '/api/monitors', { url: `https://s${i}.onrender.com`, intervalMinutes: 5 })).status, 201);
  }
  assert.equal((await t.api('POST', '/api/monitors', { url: 'https://s9.onrender.com', intervalMinutes: 5 })).status, 409);
});

test('pausing unschedules and deleting removes the monitor', async () => {
  const { body } = await t.api('POST', '/api/monitors', { url: 'https://a.onrender.com', intervalMinutes: 5 });
  const paused = await t.api('PATCH', `/api/monitors/${body.id}`, { enabled: false });
  assert.equal(paused.body.enabled, false);
  assert.equal(paused.body.nextPingAt, null);

  const resumed = await t.api('PATCH', `/api/monitors/${body.id}`, { enabled: true, intervalMinutes: 10 });
  assert.equal(resumed.body.intervalMinutes, 10);
  assert.ok(resumed.body.nextPingAt);

  assert.equal((await t.api('DELETE', `/api/monitors/${body.id}`)).status, 204);
  assert.equal((await t.api('GET', `/api/monitors/${body.id}`)).status, 404);
});

test('manual ping records a result', async () => {
  const { body } = await t.api('POST', '/api/monitors', { url: 'https://a.onrender.com', intervalMinutes: 5, enabled: false });
  const res = await t.api('POST', `/api/monitors/${body.id}/ping`);
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.latencyMs, 42);
});

test('returns 400 for malformed JSON', async () => {
  const res = await fetch(`${t.base}/api/monitors`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope',
  });
  assert.equal(res.status, 400);
});
