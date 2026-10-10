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
  assert.equal(denied.headers.get('www-authenticate'), null, 'no native browser prompt');
  assert.equal((await fetch(`${t.base}/api/monitors`, { headers: auth('wrong') })).status, 401);
  assert.equal((await fetch(`${t.base}/api/monitors`, { headers: auth('s3cret:with-colon') })).status, 200);
  assert.equal((await fetch(`${t.base}/metrics`, { headers: auth('s3cret:with-colon') })).status, 200);
});

test('browsers are sent to the login page, which works before signing in', async () => {
  t = await startTestServer({ config: { dashboardPassword: 'pw' } });
  const html = { accept: 'text/html' };
  const home = await fetch(`${t.base}/`, { headers: html, redirect: 'manual' });
  assert.equal(home.status, 303);
  assert.equal(home.headers.get('location'), '/login');
  const deep = await fetch(`${t.base}/index.html?x=1`, { headers: html, redirect: 'manual' });
  assert.equal(deep.headers.get('location'), `/login?next=${encodeURIComponent('/index.html?x=1')}`);
  const login = await fetch(`${t.base}/login`);
  assert.equal(login.status, 200);
  assert.match(await login.text(), /Sign in to keepwarm/);
  assert.equal((await fetch(`${t.base}/styles.css`)).status, 200);
});

const login = (base, body) => fetch(`${base}/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(body),
  redirect: 'manual',
});

test('signing in sets a session cookie that unlocks the dashboard and API', async () => {
  t = await startTestServer({ config: { dashboardPassword: 'pw' } });
  const ok = await login(t.base, { password: 'pw', next: '/?window=7d' });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/?window=7d');
  const setCookie = ok.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  const cookie = setCookie.split(';')[0];
  assert.equal((await fetch(`${t.base}/api/monitors`, { headers: { cookie } })).status, 200);
  assert.equal((await fetch(`${t.base}/`, { headers: { cookie } })).status, 200);
  assert.deepEqual(await (await fetch(`${t.base}/api/session`, { headers: { cookie } })).json(), { passwordProtected: true });

  // Already signed in: the login page forwards to the dashboard.
  const again = await fetch(`${t.base}/login`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(again.headers.get('location'), '/');

  // A tampered or expired cookie is rejected.
  const [, sig] = cookie.split('.');
  const forged = `keepwarm_session=${Date.now() + 1e12}.${sig}`;
  assert.equal((await fetch(`${t.base}/api/monitors`, { headers: { cookie: forged } })).status, 401);

  const out = await fetch(`${t.base}/logout`, { method: 'POST', headers: { cookie }, redirect: 'manual' });
  assert.equal(out.headers.get('location'), '/login');
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
});

test('a wrong password returns to the login page with an error and no cookie', async () => {
  t = await startTestServer({ config: { dashboardPassword: 'pw' } });
  const bad = await login(t.base, { password: 'nope', next: '/index.html' });
  assert.equal(bad.status, 303);
  assert.equal(bad.headers.get('location'), `/login?error=1&next=${encodeURIComponent('/index.html')}`);
  assert.equal(bad.headers.get('set-cookie'), null);
});

test('the login redirect only goes to same-site paths', async () => {
  t = await startTestServer({ config: { dashboardPassword: 'pw' } });
  for (const next of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)']) {
    const res = await login(t.base, { password: 'pw', next });
    assert.equal(res.headers.get('location'), '/', next);
  }
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

test('seedMonitors accepts an optional daily window', () => {
  const store = createStore(openDb(':memory:'));
  const [m] = seedMonitors(store, 'https://a.onrender.com=10@08:00-20:30', testConfig);
  assert.equal(m.activeStart, 480);
  assert.equal(m.activeEnd, 1230);
});
