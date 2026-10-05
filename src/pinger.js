// Performs a single keep-alive request and reports what happened.
export async function ping(url, { timeoutMs, fetchImpl = fetch } = {}) {
  const startedAt = Date.now();
  const t0 = performance.now();
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'user-agent': 'keepwarm/0.1 (+keep-alive ping)' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Drain the body so the full response time is measured and the socket is released.
    await res.arrayBuffer().catch(() => {});
    const latencyMs = Math.round(performance.now() - t0);
    return {
      startedAt,
      latencyMs,
      statusCode: res.status,
      ok: res.status < 500,
      error: res.status < 500 ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - t0);
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return {
      startedAt,
      latencyMs,
      statusCode: null,
      ok: false,
      error: timedOut ? `Timed out after ${timeoutMs} ms` : (err?.cause?.code ?? err?.message ?? 'Request failed'),
    };
  }
}
