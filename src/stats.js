export const WINDOWS = {
  '1h': 60 * 60_000,
  '24h': 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000,
};

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

const round = (n, digits = 2) => (n == null ? null : Number(n.toFixed(digits)));

// Groups consecutive failed pings into incidents. `pings` must be oldest-first.
export function findIncidents(pings) {
  const incidents = [];
  let current = null;
  for (const p of pings) {
    if (!p.ok) {
      if (!current) current = { startedAt: p.startedAt, endedAt: null, failures: 0, lastError: null };
      current.failures += 1;
      current.lastError = p.error;
    } else if (current) {
      current.endedAt = p.startedAt;
      incidents.push(current);
      current = null;
    }
  }
  if (current) incidents.push(current);
  return incidents.map((i) => ({ ...i, ongoing: i.endedAt === null }));
}

// Summarises pings (oldest-first) over [from, to].
export function computeStats(pings, { from, to, coldStartThresholdMs, buckets = 48 }) {
  const total = pings.length;
  const successes = pings.filter((p) => p.ok);
  const latencies = successes.map((p) => p.latencyMs).filter((n) => n != null).sort((a, b) => a - b);
  const coldStarts = successes.filter((p) => p.latencyMs >= coldStartThresholdMs);

  const bucketMs = Math.max(1, Math.ceil((to - from) / buckets));
  const series = Array.from({ length: buckets }, (_, i) => ({
    start: from + i * bucketMs, count: 0, failures: 0, coldStarts: 0, avgLatencyMs: null, maxLatencyMs: null, _sum: 0,
  }));
  for (const p of pings) {
    const b = series[Math.min(buckets - 1, Math.floor((p.startedAt - from) / bucketMs))];
    if (!b) continue;
    b.count += 1;
    if (!p.ok) { b.failures += 1; continue; }
    if (p.latencyMs >= coldStartThresholdMs) b.coldStarts += 1;
    b._sum += p.latencyMs;
    b.maxLatencyMs = Math.max(b.maxLatencyMs ?? 0, p.latencyMs);
  }
  for (const b of series) {
    const ok = b.count - b.failures;
    b.avgLatencyMs = ok ? Math.round(b._sum / ok) : null;
    delete b._sum;
  }

  return {
    from,
    to,
    total,
    successes: successes.length,
    failures: total - successes.length,
    uptimePct: total ? round((successes.length / total) * 100) : null,
    latency: {
      avg: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
      min: latencies[0] ?? null,
      max: latencies.at(-1) ?? null,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
    },
    coldStarts: {
      count: coldStarts.length,
      thresholdMs: coldStartThresholdMs,
      last: coldStarts.at(-1)?.startedAt ?? null,
    },
    incidents: findIncidents(pings).reverse(),
    series,
  };
}
