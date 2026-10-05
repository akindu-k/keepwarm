const LATENCY_BUCKETS_MS = [100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000];

const escapeLabel = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
const labels = (obj) => `{${Object.entries(obj).map(([k, v]) => `${k}="${escapeLabel(v)}"`).join(',')}}`;

// In-process Prometheus metrics, fed by the scheduler's 'ping' events.
// Counters reset on restart, as Prometheus expects.
export class Metrics {
  constructor({ coldStartThresholdMs }) {
    this.coldStartThresholdMs = coldStartThresholdMs;
    this.byMonitor = new Map();
  }

  observe(monitor, ping) {
    let m = this.byMonitor.get(monitor.id);
    if (!m) {
      m = { ok: 0, failed: 0, coldStarts: 0, buckets: LATENCY_BUCKETS_MS.map(() => 0), sum: 0, count: 0 };
      this.byMonitor.set(monitor.id, m);
    }
    if (ping.ok) {
      m.ok += 1;
      m.count += 1;
      m.sum += ping.latencyMs;
      LATENCY_BUCKETS_MS.forEach((le, i) => { if (ping.latencyMs <= le) m.buckets[i] += 1; });
      if (ping.latencyMs >= this.coldStartThresholdMs) m.coldStarts += 1;
    } else {
      m.failed += 1;
    }
  }

  render(store) {
    const out = [];
    const monitors = store.listMonitors();
    const lbl = (m, extra = {}) => labels({ monitor: m.name, url: m.url, ...extra });

    out.push('# HELP keepwarm_monitor_up 1 if the last ping succeeded, 0 if it failed, -1 if never pinged.');
    out.push('# TYPE keepwarm_monitor_up gauge');
    for (const m of monitors) {
      const last = store.lastPing(m.id);
      out.push(`keepwarm_monitor_up${lbl(m)} ${last ? (last.ok ? 1 : 0) : -1}`);
    }

    out.push('# HELP keepwarm_monitor_enabled 1 if the monitor is actively pinging.');
    out.push('# TYPE keepwarm_monitor_enabled gauge');
    for (const m of monitors) out.push(`keepwarm_monitor_enabled${lbl(m)} ${m.enabled ? 1 : 0}`);

    out.push('# HELP keepwarm_monitor_interval_seconds Configured ping interval.');
    out.push('# TYPE keepwarm_monitor_interval_seconds gauge');
    for (const m of monitors) out.push(`keepwarm_monitor_interval_seconds${lbl(m)} ${m.intervalMinutes * 60}`);

    out.push('# HELP keepwarm_last_ping_latency_ms Latency of the most recent ping.');
    out.push('# TYPE keepwarm_last_ping_latency_ms gauge');
    for (const m of monitors) {
      const last = store.lastPing(m.id);
      if (last?.latencyMs != null) out.push(`keepwarm_last_ping_latency_ms${lbl(m)} ${last.latencyMs}`);
    }

    out.push('# HELP keepwarm_pings_total Pings performed since process start.');
    out.push('# TYPE keepwarm_pings_total counter');
    for (const m of monitors) {
      const s = this.byMonitor.get(m.id);
      out.push(`keepwarm_pings_total${lbl(m, { result: 'ok' })} ${s?.ok ?? 0}`);
      out.push(`keepwarm_pings_total${lbl(m, { result: 'failed' })} ${s?.failed ?? 0}`);
    }

    out.push('# HELP keepwarm_cold_starts_total Successful pings slower than the cold-start threshold.');
    out.push('# TYPE keepwarm_cold_starts_total counter');
    for (const m of monitors) out.push(`keepwarm_cold_starts_total${lbl(m)} ${this.byMonitor.get(m.id)?.coldStarts ?? 0}`);

    out.push('# HELP keepwarm_ping_latency_ms Latency of successful pings.');
    out.push('# TYPE keepwarm_ping_latency_ms histogram');
    for (const m of monitors) {
      const s = this.byMonitor.get(m.id);
      LATENCY_BUCKETS_MS.forEach((le, i) => out.push(`keepwarm_ping_latency_ms_bucket${lbl(m, { le })} ${s?.buckets[i] ?? 0}`));
      out.push(`keepwarm_ping_latency_ms_bucket${lbl(m, { le: '+Inf' })} ${s?.count ?? 0}`);
      out.push(`keepwarm_ping_latency_ms_sum${lbl(m)} ${s?.sum ?? 0}`);
      out.push(`keepwarm_ping_latency_ms_count${lbl(m)} ${s?.count ?? 0}`);
    }

    return out.join('\n') + '\n';
  }
}
