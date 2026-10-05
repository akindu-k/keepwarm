import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ping } from '../src/pinger.js';

const serve = (handler) => new Promise((resolve) => {
  const server = createServer(handler).listen(0, () => resolve(server));
});

test('treats any non-5xx response as the service being up', async () => {
  const server = await serve((req, res) => { res.statusCode = req.url === '/missing' ? 404 : 200; res.end('ok'); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const okResult = await ping(`${base}/`, { timeoutMs: 1000 });
  assert.equal(okResult.ok, true);
  assert.equal(okResult.statusCode, 200);
  assert.equal((await ping(`${base}/missing`, { timeoutMs: 1000 })).ok, true);
  server.close();
});

test('reports 5xx and timeouts as failures', async () => {
  const server = await serve((req, res) => {
    if (req.url === '/slow') return setTimeout(() => res.end(), 500);
    res.statusCode = 503;
    res.end();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const err = await ping(`${base}/`, { timeoutMs: 1000 });
  assert.equal(err.ok, false);
  assert.equal(err.error, 'HTTP 503');
  const slow = await ping(`${base}/slow`, { timeoutMs: 50 });
  assert.equal(slow.ok, false);
  assert.match(slow.error, /Timed out/);
  server.closeAllConnections();
  server.close();
});
