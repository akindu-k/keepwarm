import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, findIncidents, percentile } from '../src/stats.js';

const p = (startedAt, ok, latencyMs, error = null) => ({ startedAt, ok, latencyMs, error });

test('percentile uses nearest-rank', () => {
  const xs = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.equal(percentile(xs, 50), 50);
  assert.equal(percentile(xs, 95), 100);
  assert.equal(percentile([], 50), null);
});

test('findIncidents groups consecutive failures', () => {
  const incidents = findIncidents([
    p(1, true, 100), p(2, false, null, 'a'), p(3, false, null, 'b'), p(4, true, 100), p(5, false, null, 'c'),
  ]);
  assert.deepEqual(incidents, [
    { startedAt: 2, endedAt: 4, failures: 2, lastError: 'b', ongoing: false },
    { startedAt: 5, endedAt: null, failures: 1, lastError: 'c', ongoing: true },
  ]);
});

test('computeStats summarises uptime, latency, cold starts and buckets', () => {
  const pings = [p(0, true, 200), p(10, true, 400), p(20, true, 15_000), p(30, false, 90_000, 'Timed out'), p(99, true, 300)];
  const s = computeStats(pings, { from: 0, to: 100, coldStartThresholdMs: 10_000, buckets: 4 });
  assert.equal(s.total, 5);
  assert.equal(s.failures, 1);
  assert.equal(s.uptimePct, 80);
  assert.deepEqual(s.latency, { avg: 3975, min: 200, max: 15_000, p50: 300, p95: 15_000, p99: 15_000 });
  assert.equal(s.coldStarts.count, 1);
  assert.equal(s.coldStarts.last, 20);
  assert.equal(s.incidents.length, 1);
  assert.deepEqual(s.series.map((b) => b.count), [3, 1, 0, 1]);
  assert.deepEqual(s.series.map((b) => b.failures), [0, 1, 0, 0]);
  assert.equal(s.series[0].avgLatencyMs, 5200);
  assert.equal(s.series[0].coldStarts, 1);
});

test('computeStats handles no data', () => {
  const s = computeStats([], { from: 0, to: 100, coldStartThresholdMs: 10_000 });
  assert.equal(s.uptimePct, null);
  assert.equal(s.latency.avg, null);
  assert.equal(s.series.length, 48);
});
