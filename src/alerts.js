// Posts to a Slack/Discord-compatible webhook when a monitor changes between up and down.
export class Alerter {
  constructor(store, { webhookUrl, fetchImpl = fetch } = {}) {
    this.store = store;
    this.webhookUrl = webhookUrl;
    this.fetchImpl = fetchImpl;
    this.lastState = new Map();
  }

  async onPing({ monitor, ping }) {
    const previous = this.lastState.has(monitor.id)
      ? this.lastState.get(monitor.id)
      : this.#previousFromStore(monitor.id, ping.id);
    this.lastState.set(monitor.id, ping.ok);
    if (previous === null || previous === ping.ok || !this.webhookUrl) return;

    const text = ping.ok
      ? `✅ ${monitor.name} recovered — ${monitor.url} responded ${ping.statusCode} in ${ping.latencyMs} ms`
      : `🔴 ${monitor.name} is down — ${monitor.url}: ${ping.error}`;
    try {
      await this.fetchImpl(this.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, content: text }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      console.error('[alerts] webhook failed:', err.message);
    }
  }

  #previousFromStore(monitorId, currentPingId) {
    const [, prev] = this.store.pingHistory(monitorId, { limit: 2 }).filter((p) => p.id <= currentPingId);
    return prev ? prev.ok : null;
  }
}
