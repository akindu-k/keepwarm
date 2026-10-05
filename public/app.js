const $ = (sel, root = document) => root.querySelector(sel);

const state = {
  window: '24h',
  overview: null,
  selectedId: null,
  detail: null,
  log: [],
  logNextBefore: null,
  failedOnly: false,
  editingId: null,
};

// ---------- helpers ----------

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data;
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fmtMs = (ms) => {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
};

const fmtAxisMs = (ms) => (ms < 1000 ? `${ms} ms` : `${Number((ms / 1000).toFixed(1))} s`);

const fmtPct = (p) => (p == null ? '—' : `${p >= 99.995 ? '100' : p.toFixed(2)}%`);

const fmtAgo = (ts) => {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const fmtIn = (ts) => {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((ts - Date.now()) / 1000));
  if (s === 0) return 'now';
  const m = Math.floor(s / 60);
  return m ? `in ${m}m ${String(s % 60).padStart(2, '0')}s` : `in ${s}s`;
};

const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtDateTime = (ts) => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtDuration = (ms) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function statusOf(monitor, thresholdMs) {
  if (!monitor.enabled) return { cls: '', label: 'Paused' };
  const last = monitor.lastPing;
  if (!last) return { cls: '', label: 'Pending' };
  if (!last.ok) return { cls: 'pill-down', label: 'Down' };
  if (last.latencyMs >= thresholdMs) return { cls: 'pill-cold', label: 'Cold start' };
  return { cls: 'pill-up', label: 'Up' };
}

function resultPill(ping, thresholdMs) {
  if (!ping.ok) return '<span class="pill pill-down">Failed</span>';
  if (ping.latencyMs >= thresholdMs) return '<span class="pill pill-cold">Cold</span>';
  return '<span class="pill pill-up">OK</span>';
}

// ---------- tooltip ----------

const tooltip = $('#tooltip');
function showTooltip(html, evt) {
  tooltip.innerHTML = html;
  tooltip.hidden = false;
  const pad = 12;
  const { width, height } = tooltip.getBoundingClientRect();
  let x = evt.clientX + pad;
  let y = evt.clientY - height - pad;
  if (x + width > window.innerWidth - 8) x = evt.clientX - width - pad;
  if (y < 8) y = evt.clientY + pad;
  tooltip.style.left = `${Math.max(8, x)}px`;
  tooltip.style.top = `${y}px`;
}
const hideTooltip = () => { tooltip.hidden = true; };

function bucketTooltip(b, bucketMs) {
  const ok = b.count - b.failures;
  return [
    `<div>${esc(fmtDateTime(b.start))} – ${esc(fmtTime(b.start + bucketMs))}</div>`,
    b.count ? `<div>Avg response <b>${esc(fmtMs(b.avgLatencyMs))}</b></div>` : '<div>No pings</div>',
    b.maxLatencyMs != null ? `<div>Slowest <b>${esc(fmtMs(b.maxLatencyMs))}</b></div>` : '',
    b.count ? `<div>Pings <b>${b.count}</b> · ok <b>${ok}</b> · failed <b>${b.failures}</b></div>` : '',
    b.coldStarts ? `<div>Cold starts <b>${b.coldStarts}</b></div>` : '',
  ].join('');
}

// ---------- summary ----------

function renderSummary() {
  const monitors = state.overview?.monitors ?? [];
  const active = monitors.filter((m) => m.enabled);
  const up = active.filter((m) => m.lastPing?.ok).length;
  const totals = monitors.reduce((acc, m) => {
    acc.total += m.stats.total;
    acc.ok += m.stats.successes;
    acc.cold += m.stats.coldStarts.count;
    return acc;
  }, { total: 0, ok: 0, cold: 0 });
  const uptime = totals.total ? (totals.ok / totals.total) * 100 : null;
  const w = state.window;

  const tile = (label, value, sub = '') =>
    `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${value}</div><div class="tile-sub">${sub}</div></div>`;

  $('#summary').innerHTML = [
    tile('Services', monitors.length, `${monitors.length - active.length} paused`),
    tile('Up now', active.length ? `${up}/${active.length}` : '—', 'based on the last ping'),
    tile(`Uptime · ${w}`, fmtPct(uptime), 'across all services'),
    tile(`Cold starts · ${w}`, totals.cold, totals.cold ? 'try a shorter interval' : 'none detected'),
    tile(`Pings · ${w}`, totals.total.toLocaleString(), `${(totals.total - totals.ok).toLocaleString()} failed`),
  ].join('');
}

// ---------- monitor list ----------

function sparkline(points, thresholdMs) {
  const w = 150, h = 30, n = points.length;
  const max = Math.max(1, ...points.map((p) => p.avgLatencyMs ?? 0));
  const bw = w / n;
  const bars = points.map((p, i) => {
    const x = (i * bw).toFixed(2);
    const width = Math.max(1, bw - 1).toFixed(2);
    if (p.avgLatencyMs == null) {
      return p.failures ? `<rect x="${x}" y="${h - 3}" width="${width}" height="3" fill="var(--critical)"/>` : '';
    }
    const bh = Math.max(2, (p.avgLatencyMs / max) * (h - 2));
    const fill = p.failures ? 'var(--critical)' : p.coldStarts ? 'var(--warning)' : 'var(--series-1)';
    return `<rect x="${x}" y="${(h - bh).toFixed(2)}" width="${width}" height="${bh.toFixed(2)}" rx="1" fill="${fill}"/>`;
  }).join('');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${bars}</svg>`;
}

function renderMonitors() {
  const root = $('#monitors');
  const monitors = state.overview?.monitors ?? [];
  // Keep in-progress edits across background re-renders.
  const openEdit = root.querySelector('.edit-form');
  const draft = openEdit && { name: openEdit.name.value, intervalMinutes: openEdit.intervalMinutes.value };
  if (!monitors.length) {
    root.innerHTML = '<div class="empty">No services yet. Add a Render URL above and keepwarm will start pinging it right away.</div>';
    return;
  }
  root.innerHTML = monitors.map((m) => {
    const threshold = m.stats.coldStarts.thresholdMs;
    const st = statusOf(m, threshold);
    const last = m.lastPing;
    const editing = state.editingId === m.id;
    return `
      <div class="monitor ${m.enabled ? '' : 'paused'} ${state.selectedId === m.id ? 'selected' : ''}" data-id="${m.id}">
        <div class="monitor-main">
          <div class="monitor-name"><span class="pill ${st.cls}">${st.label}</span><span>${esc(m.name)}</span></div>
          <a class="monitor-url" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer" data-stop>${esc(m.url)}</a>
          ${editing ? '<div data-edit-slot></div>' : ''}
        </div>
        <div><div class="metric-label">Every</div><div class="metric-value">${m.intervalMinutes} min</div></div>
        <div>
          <div class="metric-label">Last ping</div>
          <div class="metric-value" data-ago="${last?.startedAt ?? ''}">${fmtAgo(last?.startedAt)}</div>
          <div class="small muted">${last ? `${last.statusCode ?? 'error'} · ${fmtMs(last.latencyMs)}` : '&nbsp;'}</div>
        </div>
        <div>
          <div class="metric-label">Next ping</div>
          <div class="metric-value" data-next="${m.nextPingAt ?? ''}">${m.enabled ? fmtIn(m.nextPingAt) : 'paused'}</div>
        </div>
        <div>
          <div class="metric-label">Uptime · p95</div>
          <div class="metric-value">${fmtPct(m.stats.uptimePct)}</div>
          <div class="small muted">p95 ${fmtMs(m.stats.latency.p95)} · ${m.stats.coldStarts.count} cold</div>
        </div>
        <div class="spark-cell" data-spark="${m.id}">${sparkline(m.sparkline, threshold)}</div>
        <div class="actions" data-stop>
          <button class="btn btn-sm" data-action="ping" title="Ping now">Ping</button>
          <button class="btn btn-sm" data-action="toggle">${m.enabled ? 'Pause' : 'Resume'}</button>
          <button class="btn btn-sm" data-action="edit">Edit</button>
          <button class="btn btn-sm btn-danger" data-action="delete" aria-label="Delete ${esc(m.name)}">✕</button>
        </div>
      </div>`;
  }).join('');

  if (state.editingId) {
    const m = monitors.find((x) => x.id === state.editingId);
    const slot = root.querySelector('[data-edit-slot]');
    if (m && slot) {
      const form = $('#edit-template').content.firstElementChild.cloneNode(true);
      form.name.value = draft?.name ?? m.name;
      form.intervalMinutes.value = draft?.intervalMinutes ?? m.intervalMinutes;
      form.setAttribute('data-stop', '');
      slot.replaceWith(form);
    }
  }
}

$('#monitors').addEventListener('click', async (e) => {
  const row = e.target.closest('.monitor');
  if (!row) return;
  const id = Number(row.dataset.id);
  const button = e.target.closest('[data-action]');
  if (button) {
    const action = button.dataset.action;
    const monitor = state.overview.monitors.find((m) => m.id === id);
    button.disabled = true;
    try {
      if (action === 'ping') await api('POST', `/api/monitors/${id}/ping`);
      if (action === 'toggle') await api('PATCH', `/api/monitors/${id}`, { enabled: !monitor.enabled });
      if (action === 'edit') { state.editingId = state.editingId === id ? null : id; renderMonitors(); return; }
      if (action === 'delete') {
        if (!confirm(`Stop pinging ${monitor.name} and delete its history?`)) return;
        await api('DELETE', `/api/monitors/${id}`);
        if (state.selectedId === id) closeDetail();
      }
      await refresh();
    } catch (err) {
      alert(err.message);
    } finally {
      button.disabled = false;
    }
    return;
  }
  if (e.target.closest('[data-cancel]')) { state.editingId = null; renderMonitors(); return; }
  if (e.target.closest('[data-stop]')) return;
  selectMonitor(id);
});

$('#monitors').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const id = Number(form.closest('.monitor').dataset.id);
  try {
    await api('PATCH', `/api/monitors/${id}`, {
      name: form.name.value,
      intervalMinutes: Number(form.intervalMinutes.value),
    });
    state.editingId = null;
    await refresh();
  } catch (err) {
    alert(err.message);
  }
});

$('#monitors').addEventListener('mousemove', (e) => {
  const cell = e.target.closest('[data-spark]');
  if (!cell) return hideTooltip();
  const m = state.overview.monitors.find((x) => x.id === Number(cell.dataset.spark));
  const rect = cell.getBoundingClientRect();
  const i = Math.min(m.sparkline.length - 1, Math.floor(((e.clientX - rect.left) / rect.width) * m.sparkline.length));
  const p = m.sparkline[i];
  const bucketMs = m.sparkline[1] ? m.sparkline[1].start - m.sparkline[0].start : 0;
  showTooltip(
    `<div>${esc(fmtDateTime(p.start))} – ${esc(fmtTime(p.start + bucketMs))}</div>` +
    `<div>Avg response <b>${esc(fmtMs(p.avgLatencyMs))}</b></div>` +
    (p.failures ? `<div>Failed pings <b>${p.failures}</b></div>` : ''),
    e,
  );
});
$('#monitors').addEventListener('mouseleave', hideTooltip);

// ---------- add form ----------

const addForm = $('#add-form');
const customField = $('.field-custom');
const hint = $('#interval-hint');
const defaultHint = hint.textContent;

function currentInterval() {
  const v = addForm.intervalMinutes.value;
  return v === 'custom' ? Number(addForm.customMinutes.value) : Number(v);
}

function updateHint() {
  customField.hidden = addForm.intervalMinutes.value !== 'custom';
  const minutes = currentInterval();
  const tooLong = minutes >= 15;
  hint.classList.toggle('warn', tooLong);
  hint.textContent = tooLong
    ? `Render spins free services down after 15 idle minutes — a ${minutes}-minute interval will still let it sleep between pings.`
    : defaultHint;
}
addForm.intervalMinutes.addEventListener('change', updateHint);
addForm.customMinutes.addEventListener('input', updateHint);

addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const error = $('#form-error');
  error.hidden = true;
  const submit = addForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const monitor = await api('POST', '/api/monitors', {
      url: addForm.url.value,
      name: addForm.name.value || undefined,
      intervalMinutes: currentInterval(),
    });
    addForm.reset();
    updateHint();
    await refresh();
    selectMonitor(monitor.id);
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    submit.disabled = false;
  }
});

// ---------- window picker ----------

$('#window-picker').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-window]');
  if (!btn) return;
  state.window = btn.dataset.window;
  for (const b of $('#window-picker').children) b.classList.toggle('active', b === btn);
  refresh();
});

// ---------- detail ----------

function closeDetail() {
  state.selectedId = null;
  state.detail = null;
  $('#detail').hidden = true;
  renderMonitors();
}
$('#detail-close').addEventListener('click', closeDetail);

async function selectMonitor(id) {
  state.selectedId = id;
  state.log = [];
  state.logNextBefore = null;
  renderMonitors();
  $('#detail').hidden = false;
  await Promise.all([loadDetail(), loadLog(true)]);
  $('#detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadDetail() {
  const id = state.selectedId;
  if (!id) return;
  const stats = await api('GET', `/api/monitors/${id}/stats?window=${state.window}`);
  if (state.selectedId !== id) return;
  state.detail = stats;
  renderDetail();
}

function renderDetail() {
  const m = state.overview?.monitors.find((x) => x.id === state.selectedId);
  const s = state.detail;
  if (!m || !s) return;
  $('#detail-title').textContent = m.name;
  const link = $('#detail-url');
  link.textContent = m.url;
  link.href = m.url;

  const tile = (label, value, sub = '') =>
    `<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${value}</div><div class="tile-sub">${sub}</div></div>`;
  $('#detail-tiles').innerHTML = [
    tile(`Uptime · ${s.window}`, fmtPct(s.uptimePct), `${s.failures} of ${s.total} failed`),
    tile('Avg response', fmtMs(s.latency.avg), `min ${fmtMs(s.latency.min)}`),
    tile('p50', fmtMs(s.latency.p50)),
    tile('p95', fmtMs(s.latency.p95), `p99 ${fmtMs(s.latency.p99)}`),
    tile('Cold starts', s.coldStarts.count, s.coldStarts.last ? `last ${fmtAgo(s.coldStarts.last)}` : `≥ ${fmtMs(s.coldStarts.thresholdMs)}`),
    tile('Incidents', s.incidents.length, s.incidents.some((i) => i.ongoing) ? 'one ongoing' : 'none ongoing'),
  ].join('');

  $('#chart-caption').textContent = `· ${s.window}, ${s.series.length} buckets`;
  renderChart(s);
  renderStrip(s);
  renderIncidents(s.incidents);
}

function niceStep(max, ticks = 4) {
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw) ?? 10 * mag;
}

function renderChart(s) {
  const el = $('#latency-chart');
  const width = el.clientWidth || 600;
  const height = el.clientHeight || 220;
  const padL = 52, padR = 4, padT = 8, padB = 22;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const n = s.series.length;
  const bucketMs = n > 1 ? s.series[1].start - s.series[0].start : 0;
  const dataMax = Math.max(0, ...s.series.map((b) => b.avgLatencyMs ?? 0));
  const step = niceStep(Math.max(dataMax, 100));
  const yMax = Math.ceil(Math.max(dataMax, 100) / step) * step;
  const y = (v) => padT + innerH - (v / yMax) * innerH;
  const slot = innerW / n;
  const gap = 2;
  const bw = Math.max(1, slot - gap);
  const threshold = s.coldStarts.thresholdMs;

  const grid = [];
  for (let v = 0; v <= yMax + 1e-9; v += step) {
    const yy = y(v).toFixed(1);
    grid.push(`<line class="${v === 0 ? 'baseline' : 'gridline'}" x1="${padL}" x2="${width - padR}" y1="${yy}" y2="${yy}"/>`);
    grid.push(`<text class="axis-label" x="${padL - 8}" y="${yy}" text-anchor="end" dominant-baseline="middle">${esc(fmtAxisMs(v))}</text>`);
  }

  const labelEvery = Math.ceil(n / Math.max(2, Math.floor(innerW / 90)));
  const xLabels = [];
  const longRange = s.to - s.from > 36 * 3600_000;
  for (let i = 0; i < n; i += labelEvery) {
    const t = s.series[i].start;
    const label = longRange
      ? new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' })
      : new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    xLabels.push(`<text class="axis-label" x="${(padL + i * slot).toFixed(1)}" y="${height - 4}">${esc(label)}</text>`);
  }

  const bars = s.series.map((b, i) => {
    const x = padL + i * slot + gap / 2;
    const hit = `<rect class="hit" data-i="${i}" x="${(padL + i * slot).toFixed(2)}" y="${padT}" width="${slot.toFixed(2)}" height="${innerH}"/>`;
    if (b.avgLatencyMs == null) return hit;
    const top = y(b.avgLatencyMs);
    const base = y(0);
    const r = Math.min(4, bw / 2, base - top);
    const fill = b.coldStarts ? 'var(--warning)' : 'var(--series-1)';
    const d = `M${x.toFixed(2)},${base} V${(top + r).toFixed(2)} Q${x.toFixed(2)},${top.toFixed(2)} ${(x + r).toFixed(2)},${top.toFixed(2)} H${(x + bw - r).toFixed(2)} Q${(x + bw).toFixed(2)},${top.toFixed(2)} ${(x + bw).toFixed(2)},${(top + r).toFixed(2)} V${base} Z`;
    return `${hit}<path class="bar" data-i="${i}" d="${d}" fill="${fill}" pointer-events="none"/>`;
  }).join('');

  const threshLine = threshold <= yMax
    ? `<line x1="${padL}" x2="${width - padR}" y1="${y(threshold).toFixed(1)}" y2="${y(threshold).toFixed(1)}" stroke="var(--warning)" stroke-dasharray="4 4" stroke-width="1"/>
       <text class="axis-label" x="${width - padR}" y="${(y(threshold) - 4).toFixed(1)}" text-anchor="end">cold-start threshold</text>`
    : '';

  el.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${grid.join('')}${threshLine}${bars}${xLabels.join('')}</svg>`;
  el.onmousemove = (e) => {
    const target = e.target.closest('[data-i]');
    el.querySelectorAll('.bar.hover').forEach((b) => b.classList.remove('hover'));
    if (!target) return hideTooltip();
    const i = Number(target.dataset.i);
    el.querySelector(`.bar[data-i="${i}"]`)?.classList.add('hover');
    showTooltip(bucketTooltip(s.series[i], bucketMs), e);
  };
  el.onmouseleave = () => {
    hideTooltip();
    el.querySelectorAll('.bar.hover').forEach((b) => b.classList.remove('hover'));
  };
}

function renderStrip(s) {
  const el = $('#uptime-strip');
  const bucketMs = s.series.length > 1 ? s.series[1].start - s.series[0].start : 0;
  el.innerHTML = s.series.map((b, i) => `<i data-i="${i}" class="${b.count ? (b.failures ? 'bad' : 'ok') : ''}"></i>`).join('');
  el.onmousemove = (e) => {
    const cell = e.target.closest('[data-i]');
    if (!cell) return hideTooltip();
    showTooltip(bucketTooltip(s.series[Number(cell.dataset.i)], bucketMs), e);
  };
  el.onmouseleave = hideTooltip;
}

function renderIncidents(incidents) {
  const el = $('#incidents');
  if (!incidents.length) {
    el.innerHTML = '<li class="muted">No failed pings in this window.</li>';
    return;
  }
  el.innerHTML = incidents.slice(0, 20).map((i) => `
    <li>
      <div><span class="pill ${i.ongoing ? 'pill-down' : ''}">${i.ongoing ? 'Ongoing' : 'Resolved'}</span>
        ${esc(fmtDateTime(i.startedAt))}</div>
      <div class="small muted">${i.failures} failed ping${i.failures === 1 ? '' : 's'} · ${i.ongoing ? `${fmtDuration(Date.now() - i.startedAt)} so far` : `lasted ${fmtDuration(i.endedAt - i.startedAt)}`}</div>
      <div class="err">${esc(i.lastError)}</div>
    </li>`).join('');
}

// ---------- request log ----------

function logRow(p, threshold, isNew = false) {
  return `<tr class="${isNew ? 'new' : ''}">
    <td title="${esc(new Date(p.startedAt).toISOString())}">${esc(fmtDateTime(p.startedAt))}</td>
    <td>${resultPill(p, threshold)}</td>
    <td class="num">${p.statusCode ?? '—'}</td>
    <td class="num">${esc(fmtMs(p.latencyMs))}</td>
    <td class="detail">${esc(p.error ?? '')}</td>
  </tr>`;
}

const threshold = () => state.detail?.coldStarts.thresholdMs ?? 10_000;

function renderLog() {
  const body = $('#log-body');
  body.innerHTML = state.log.length
    ? state.log.map((p) => logRow(p, threshold())).join('')
    : `<tr><td colspan="5" class="muted">${state.failedOnly ? 'No failed requests.' : 'No requests yet.'}</td></tr>`;
  $('#log-more').hidden = !state.logNextBefore;
}

async function loadLog(reset) {
  const id = state.selectedId;
  if (!id) return;
  const params = new URLSearchParams({ limit: '25' });
  if (!reset && state.logNextBefore) params.set('before', state.logNextBefore);
  if (state.failedOnly) params.set('status', 'failed');
  const { pings, nextBefore } = await api('GET', `/api/monitors/${id}/pings?${params}`);
  if (state.selectedId !== id) return;
  state.log = reset ? pings : state.log.concat(pings);
  state.logNextBefore = nextBefore;
  renderLog();
}

$('#log-more').addEventListener('click', () => loadLog(false));
$('#failed-only').addEventListener('change', (e) => {
  state.failedOnly = e.target.checked;
  loadLog(true);
});

// ---------- live updates ----------

const feed = $('#feed');
function addToFeed(monitorId, ping) {
  const m = state.overview?.monitors.find((x) => x.id === monitorId);
  if (!m) return;
  feed.querySelector('li.muted')?.remove();
  const li = document.createElement('li');
  li.innerHTML = `
    <span class="muted small">${esc(fmtTime(ping.startedAt))}</span>
    ${resultPill(ping, m.stats.coldStarts.thresholdMs)}
    <span class="feed-url">${esc(m.name)} — ${esc(m.url)}</span>
    <span class="num small feed-latency">${ping.statusCode ?? esc(ping.error)} · ${esc(fmtMs(ping.latencyMs))}</span>`;
  feed.prepend(li);
  while (feed.children.length > 50) feed.lastElementChild.remove();
}

const refreshSoon = debounce(() => refresh(), 800);

function connectEvents() {
  const live = $('#live');
  const label = live.querySelector('.live-label');
  const es = new EventSource('/api/events');
  es.onopen = () => { live.dataset.state = 'open'; label.textContent = 'Live'; };
  es.onerror = () => { live.dataset.state = 'error'; label.textContent = 'Reconnecting…'; };
  es.addEventListener('ping', (e) => {
    const { monitorId, ping } = JSON.parse(e.data);
    addToFeed(monitorId, ping);
    if (monitorId === state.selectedId && (!state.failedOnly || !ping.ok)) {
      state.log.unshift(ping);
      $('#log-body').querySelector('td[colspan]')?.parentElement.remove();
      $('#log-body').insertAdjacentHTML('afterbegin', logRow(ping, threshold(), true));
    }
    refreshSoon();
  });
}

// ---------- refresh loop ----------

async function refresh() {
  try {
    state.overview = await api('GET', `/api/overview?window=${state.window}`);
    renderSummary();
    renderMonitors();
    if (state.selectedId) {
      if (!state.overview.monitors.some((m) => m.id === state.selectedId)) closeDetail();
      else await loadDetail();
    }
  } catch (err) {
    console.error(err);
  }
}

// Countdowns and "x ago" labels tick every second without refetching.
setInterval(() => {
  document.querySelectorAll('[data-next]').forEach((el) => {
    if (el.dataset.next) el.textContent = fmtIn(Number(el.dataset.next));
  });
  document.querySelectorAll('[data-ago]').forEach((el) => {
    if (el.dataset.ago) el.textContent = fmtAgo(Number(el.dataset.ago));
  });
}, 1000);
setInterval(refresh, 30_000);
window.addEventListener('resize', debounce(() => state.detail && renderChart(state.detail), 150));

// ---------- theme ----------

function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
try { applyTheme(localStorage.getItem('keepwarm-theme')); } catch { /* storage unavailable */ }
$('#theme').addEventListener('click', () => {
  const current = document.documentElement.dataset.theme
    ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem('keepwarm-theme', next); } catch { /* storage unavailable */ }
});

refresh();
connectEvents();
