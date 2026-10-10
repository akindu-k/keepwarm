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
  budget: null,
  settings: null,
};

const toClock = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const fromClock = (text) => {
  const [h, m] = text.split(':').map(Number);
  return h * 60 + m;
};
const fmtHours = (h) => `${Number(h.toFixed(h % 1 ? 1 : 0)).toLocaleString()} h`;
const SERIES = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'];

// ---------- helpers ----------

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    location.assign(`/login?${new URLSearchParams({ next: location.pathname + location.search })}`);
    throw new Error('Signed out');
  }
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
  if (monitor.pinging) return { cls: 'pill-busy', label: 'Pinging…' };
  if (monitor.sleeping) return { cls: 'pill-sleep', label: 'Asleep' };
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

const icon = (name) => `<svg class="ico" aria-hidden="true"><use href="#i-${name}"/></svg>`;

// Daily windows are evaluated in the budget time zone, not the viewer's.
const scheduleZone = () => state.settings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
function minuteNowIn(timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date());
    const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return get('hour') * 60 + get('minute');
  } catch {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }
}

function fmtUntil(ts) {
  const m = Math.max(0, Math.round((ts - Date.now()) / 60_000));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

// ---------- toasts ----------

function toast(message, { error = false } = {}) {
  const el = document.createElement('div');
  el.className = `toast ${error ? 'err' : ''}`;
  el.innerHTML = `${icon(error ? 'alert' : 'check')}<span>${esc(message)}</span>`;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), error ? 6000 : 3000);
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
    tile(`Cold starts · ${w}`, totals.cold, totals.cold ? (active.some((m) => m.activeStart != null) ? 'normal at window start' : 'try a shorter interval') : 'none detected'),
    tile(`Pings · ${w}`, totals.total.toLocaleString(), `${(totals.total - totals.ok).toLocaleString()} failed`),
  ].join('');
  renderHero();
}

function renderHero() {
  const monitors = state.overview?.monitors ?? [];
  const active = monitors.filter((m) => m.enabled);
  const awake = active.filter((m) => !m.sleeping);
  const down = awake.filter((m) => m.lastPing && !m.lastPing.ok);
  const cold = awake.filter((m) => m.lastPing?.ok && m.lastPing.latencyMs >= m.stats.coldStarts.thresholdMs);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const b = state.budget;
  const budgetLine = b
    ? ` · <b>${esc(fmtHours(b.projectedHours))}</b> of ${esc(fmtHours(b.monthlyHourLimit))} free hours projected this month`
    : '';

  let tone, title, sub;
  if (!monitors.length) {
    tone = 'neutral';
    title = 'No services yet';
    sub = 'Add a Render URL and keepwarm will start keeping it awake.';
  } else if (!active.length) {
    tone = 'neutral';
    title = 'All services are paused';
    sub = 'Resume a service to start pinging it again.';
  } else if (down.length) {
    tone = 'bad';
    title = `${plural(down.length, 'service')} not responding`;
    sub = down.map((m) => esc(m.name)).join(', ') + ` returned an error on the last ping${budgetLine}`;
  } else if (!awake.length) {
    tone = 'sleep';
    const next = Math.min(...active.map((m) => m.nextPingAt ?? Infinity));
    title = active.length === 1 ? 'Asleep for the night' : `All ${active.length} services are asleep`;
    sub = Number.isFinite(next)
      ? `Outside keep-warm hours. Pinging resumes at <b>${esc(new Date(next).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</b> (in <b data-until="${next}">${fmtUntil(next)}</b>)${budgetLine}`
      : `Outside keep-warm hours${budgetLine}`;
  } else {
    tone = cold.length ? 'warn' : 'good';
    const next = Math.min(...awake.map((m) => m.nextPingAt ?? Infinity));
    title = awake.length === active.length
      ? (active.length === 1 ? 'Your service is warm' : `All ${active.length} services are warm`)
      : `${awake.length} of ${active.length} services warm`;
    sub = (cold.length ? `${plural(cold.length, 'cold start')} on the last ping. ` : '') +
      (Number.isFinite(next) ? `Next ping <b data-next="${next}">${fmtIn(next)}</b>` : '') + budgetLine;
  }
  if (b && !b.withinLimit && tone !== 'bad') {
    tone = 'warn';
    sub = `Projected <b>${esc(fmtHours(b.projectedHours))}</b> is over the ${esc(fmtHours(b.monthlyHourLimit))} free limit. Use <b>Fit services to limit</b> below or shorten the keep-warm windows.`;
  }
  const hero = $('#hero');
  hero.dataset.tone = tone;
  hero.querySelector('use').setAttribute('href', `#i-${{ bad: 'alert', warn: 'alert', sleep: 'moon', good: 'check' }[tone] ?? 'flame'}`);
  $('#hero-title').textContent = title;
  $('#hero-sub').innerHTML = sub;

  const zone = scheduleZone();
  $('#services-sub').textContent = monitors.length
    ? `${plural(monitors.length, 'service')} · schedules in ${zone.replace(/_/g, ' ')} · click a card for charts and the request log`
    : '';
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

// A 24h bar with the keep-warm window shaded and a marker at the current time.
function timeline(m, nowMin) {
  const pct = (min) => `${((min / 1440) * 100).toFixed(2)}%`;
  const seg = (a, b) => `<i class="win" style="left:${pct(a)};width:${pct(b - a)}"></i>`;
  let wins;
  if (m.activeStart == null) wins = seg(0, 1440);
  else if (m.activeStart < m.activeEnd) wins = seg(m.activeStart, m.activeEnd);
  else wins = seg(m.activeStart, 1440) + seg(0, m.activeEnd);
  const perDay = state.budget?.monitors.find((x) => x.id === m.id)?.hoursPerDay;
  const label = m.activeStart == null ? 'all day' : `${toClock(m.activeStart)}–${toClock(m.activeEnd)}`;
  return `
    <div class="timeline-wrap">
      <div class="timeline-head">
        <span>Warm <b>${label}</b> · every <b>${m.intervalMinutes} min</b></span>
        ${perDay != null && m.enabled ? `<span>≈ ${perDay} h/day</span>` : ''}
      </div>
      <div class="timeline" role="img" aria-label="Kept warm ${label}">${wins}<span class="now" style="left:${pct(nowMin)}" title="Now"></span></div>
      <div class="timeline-ticks"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
    </div>`;
}

function renderMonitors() {
  const root = $('#monitors');
  const monitors = state.overview?.monitors ?? [];
  // Keep in-progress edits across background re-renders.
  const openEdit = root.querySelector('.edit-form');
  const draft = openEdit && {
    name: openEdit.name.value,
    intervalMinutes: openEdit.intervalMinutes.value,
    schedule: openEdit.schedule.value,
    activeFrom: openEdit.activeFrom.value,
    activeTo: openEdit.activeTo.value,
  };
  if (!monitors.length) {
    root.innerHTML = `<div class="empty"><strong>Nothing to keep warm yet</strong>
      Add a Render URL and keepwarm will ping it right away, then on your schedule.
      <div><button class="btn btn-primary" type="button" data-open-add>${icon('plus')}Add your first service</button></div></div>`;
    return;
  }
  const nowMin = minuteNowIn(scheduleZone());
  root.innerHTML = monitors.map((m) => {
    const threshold = m.stats.coldStarts.thresholdMs;
    const st = statusOf(m, threshold);
    const last = m.lastPing;
    const editing = state.editingId === m.id;
    let nextValue, nextSub;
    if (!m.enabled) { nextValue = 'paused'; nextSub = 'resume to ping'; }
    else if (m.sleeping) { nextValue = `at ${toClock(m.activeStart)}`; nextSub = `<span data-until="${m.nextPingAt ?? ''}">in ${m.nextPingAt ? fmtUntil(m.nextPingAt) : '—'}</span>`; }
    else { nextValue = `<span data-next="${m.nextPingAt ?? ''}">${fmtIn(m.nextPingAt)}</span>`; nextSub = `every ${m.intervalMinutes} min`; }
    return `
      <article class="monitor ${m.enabled ? '' : 'paused'} ${state.selectedId === m.id ? 'selected' : ''}" data-id="${m.id}">
        <div class="monitor-top">
          <div class="monitor-main">
            <div class="monitor-name" title="${esc(m.name)}">${esc(m.name)}</div>
            <a class="monitor-url" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer" data-stop>${esc(m.url)}</a>
          </div>
          <span class="pill ${st.cls}">${st.label}</span>
        </div>

        ${timeline(m, nowMin)}

        <div class="monitor-metrics">
          <div>
            <div class="metric-label">Next ping</div>
            <div class="metric-value">${nextValue}</div>
            <div class="metric-sub">${nextSub}</div>
          </div>
          <div>
            <div class="metric-label">Last ping</div>
            <div class="metric-value" data-ago="${last?.startedAt ?? ''}">${fmtAgo(last?.startedAt)}</div>
            <div class="metric-sub">${last ? `${last.statusCode ?? 'error'} · ${fmtMs(last.latencyMs)}` : 'no pings yet'}</div>
          </div>
          <div>
            <div class="metric-label">Uptime · ${state.window}</div>
            <div class="metric-value">${fmtPct(m.stats.uptimePct)}</div>
            <div class="metric-sub">p95 ${fmtMs(m.stats.latency.p95)} · ${m.stats.coldStarts.count} cold</div>
          </div>
        </div>

        ${editing ? '<div data-edit-slot></div>' : ''}

        ${m.sparkline.some((p) => p.avgLatencyMs != null || p.failures)
          ? `<div><div class="metric-label spark-label">Response time · ${state.window}</div><div class="spark-cell" data-spark="${m.id}">${sparkline(m.sparkline, threshold)}</div></div>`
          : ''}

        <div class="monitor-foot" data-stop>
          <div class="actions">
            <button class="btn btn-sm" data-action="ping" title="Send a ping now">${icon('bolt')}Ping now</button>
            <button class="btn btn-sm" data-action="toggle">${icon(m.enabled ? 'pause' : 'play')}${m.enabled ? 'Pause' : 'Resume'}</button>
            <button class="btn btn-sm" data-action="edit">${icon('edit')}Edit</button>
          </div>
          <button class="btn btn-sm btn-ghost btn-danger" data-action="delete" title="Delete" aria-label="Delete ${esc(m.name)}">${icon('trash')}</button>
        </div>
      </article>`;
  }).join('');

  if (state.editingId) {
    const m = monitors.find((x) => x.id === state.editingId);
    const slot = root.querySelector('[data-edit-slot]');
    if (m && slot) {
      const form = $('#edit-template').content.firstElementChild.cloneNode(true);
      form.name.value = draft?.name ?? m.name;
      form.intervalMinutes.value = draft?.intervalMinutes ?? m.intervalMinutes;
      form.schedule.value = draft?.schedule ?? (m.activeStart == null ? 'allday' : 'window');
      form.activeFrom.value = draft?.activeFrom ?? toClock(m.activeStart ?? 480);
      form.activeTo.value = draft?.activeTo ?? toClock(m.activeEnd ?? 1200);
      syncWindowInputs(form);
      form.setAttribute('data-stop', '');
      slot.replaceWith(form);
    }
  }
}

$('#monitors').addEventListener('click', async (e) => {
  if (e.target.closest('[data-open-add]')) return openAdd(true);
  const row = e.target.closest('.monitor');
  if (!row) return;
  const id = Number(row.dataset.id);
  const button = e.target.closest('[data-action]');
  if (button) {
    const action = button.dataset.action;
    const monitor = state.overview.monitors.find((m) => m.id === id);
    button.disabled = true;
    try {
      if (action === 'ping') {
        if (monitor.sleeping && !confirm(`${monitor.name} is outside its keep-warm hours. Pinging now wakes it and uses about 15 minutes of free instance hours. Ping anyway?`)) return;
        const ping = await api('POST', `/api/monitors/${id}/ping`);
        if (ping) toast(ping.ok ? `${monitor.name}: ${ping.statusCode} in ${fmtMs(ping.latencyMs)}` : `${monitor.name}: ${ping.error ?? 'ping failed'}`, { error: !ping.ok });
      }
      if (action === 'toggle') await api('PATCH', `/api/monitors/${id}`, { enabled: !monitor.enabled });
      if (action === 'edit') { state.editingId = state.editingId === id ? null : id; renderMonitors(); return; }
      if (action === 'delete') {
        if (!confirm(`Stop pinging ${monitor.name} and delete its history?`)) return;
        await api('DELETE', `/api/monitors/${id}`);
        if (state.selectedId === id) closeDetail();
        toast(`Deleted ${monitor.name}`);
      }
      await refresh();
    } catch (err) {
      toast(err.message, { error: true });
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
      ...windowFromForm(form),
    });
    state.editingId = null;
    toast('Saved');
    await refresh();
  } catch (err) {
    toast(err.message, { error: true });
  }
});

$('#monitors').addEventListener('change', (e) => {
  if (e.target.name === 'schedule') syncWindowInputs(e.target.form);
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

// Shows the from/to inputs only when "Between…" is selected.
function syncWindowInputs(form) {
  const on = form.schedule.value === 'window';
  const wrapper = form.querySelector('.field-window');
  if (wrapper) wrapper.hidden = !on;
  else for (const input of [form.activeFrom, form.activeTo]) (input.closest('.field') ?? input).hidden = !on;
}

function windowFromForm(form) {
  if (form.schedule.value !== 'window') return { activeStart: null, activeEnd: null };
  return { activeStart: fromClock(form.activeFrom.value), activeEnd: fromClock(form.activeTo.value) };
}

addForm.schedule.addEventListener('change', () => syncWindowInputs(addForm));

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
      ...windowFromForm(addForm),
    });
    addForm.reset();
    updateHint();
    syncWindowInputs(addForm);
    openAdd(false);
    toast(`Now keeping ${monitor.name} warm`);
    await refresh();
    selectMonitor(monitor.id);
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    submit.disabled = false;
  }
});

function openAdd(open) {
  $('#add-card').hidden = !open;
  $('#add-toggle').setAttribute('aria-expanded', String(open));
  if (open) {
    $('#add-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    addForm.url.focus({ preventScroll: true });
  }
}
$('#add-toggle').addEventListener('click', () => openAdd($('#add-card').hidden));
$('#add-close').addEventListener('click', () => openAdd(false));

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
  feed.querySelector('li.feed-empty')?.remove();
  const li = document.createElement('li');
  li.innerHTML = `
    <span class="feed-time">${esc(fmtTime(ping.startedAt))}</span>
    ${resultPill(ping, m.stats.coldStarts.thresholdMs)}
    <span class="feed-url" title="${esc(m.url)}">${esc(m.name)}</span>
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
  es.addEventListener('ping-start', (e) => {
    const { monitorId } = JSON.parse(e.data);
    const m = state.overview?.monitors.find((x) => x.id === monitorId);
    if (m) { m.pinging = true; renderMonitors(); }
  });
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
    [state.overview, state.budget] = await Promise.all([
      api('GET', `/api/overview?window=${state.window}`),
      api('GET', '/api/budget'),
    ]);
    renderSummary();
    renderMonitors();
    renderBudget();
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
  document.querySelectorAll('[data-until]').forEach((el) => {
    if (el.dataset.until) el.textContent = `${el.tagName === 'B' ? '' : 'in '}${fmtUntil(Number(el.dataset.until))}`;
  });
  document.querySelectorAll('[data-ago]').forEach((el) => {
    if (el.dataset.ago) el.textContent = fmtAgo(Number(el.dataset.ago));
  });
}, 1000);
setInterval(refresh, 30_000);
window.addEventListener('resize', debounce(() => state.detail && renderChart(state.detail), 150));

// ---------- free-hour budget ----------

const budgetForm = $('#budget-form');

function fillTimezones(selected) {
  const select = budgetForm.timezone;
  if (select.options.length) return;
  const zones = Intl.supportedValuesOf?.('timeZone') ?? [selected];
  if (!zones.includes('UTC')) zones.unshift('UTC');
  if (!zones.includes(selected)) zones.unshift(selected);
  select.innerHTML = zones.map((z) => `<option value="${esc(z)}">${esc(z.replace(/_/g, ' '))}</option>`).join('');
}

function renderSettings() {
  const st = state.settings;
  fillTimezones(st.timezone);
  const preset = st.monthlyHourLimit === 750 ? '750' : 'custom';
  budgetForm.limitPreset.value = preset;
  $('.field-limit-custom').hidden = preset !== 'custom';
  budgetForm.monthlyHourLimit.value = st.monthlyHourLimit;
  budgetForm.reservedHours.value = st.reservedHours;
  budgetForm.timezone.value = st.timezone;
  budgetForm.countSelf.checked = st.countSelf;
}

async function saveSettings(changes) {
  try {
    state.settings = await api('PUT', '/api/settings', changes);
    renderSettings();
    await refresh();
  } catch (err) {
    toast(err.message, { error: true });
    renderSettings();
  }
}

budgetForm.addEventListener('change', (e) => {
  const f = budgetForm;
  if (e.target.name === 'limitPreset') {
    const custom = f.limitPreset.value === 'custom';
    $('.field-limit-custom').hidden = !custom;
    if (!custom) saveSettings({ monthlyHourLimit: 750 });
    else f.monthlyHourLimit.focus();
    return;
  }
  if (e.target.name === 'monthlyHourLimit') return saveSettings({ monthlyHourLimit: Number(f.monthlyHourLimit.value) });
  if (e.target.name === 'reservedHours') return saveSettings({ reservedHours: Number(f.reservedHours.value) });
  if (e.target.name === 'timezone') return saveSettings({ timezone: f.timezone.value });
  if (e.target.name === 'countSelf') return saveSettings({ countSelf: f.countSelf.checked });
});
budgetForm.addEventListener('submit', (e) => e.preventDefault());

function renderBudget() {
  const b = state.budget;
  if (!b) return;
  const limit = b.monthlyHourLimit;
  $('#budget-period').textContent = `${b.month} · ${b.days} days · ${b.timezone}`;
  $('#budget-used').textContent = fmtHours(b.projectedHours);
  $('#budget-of').textContent = `projected of ${fmtHours(limit)}`;
  const status = $('#budget-status');
  status.className = `pill ${b.withinLimit ? 'pill-up' : 'pill-down'}`;
  status.textContent = b.withinLimit ? `${fmtHours(b.remainingHours)} to spare` : `Over by ${fmtHours(-b.remainingHours)}`;

  // Segments: one per monitor (fixed colour order by id), then keepwarm itself, then reserved.
  const segments = b.monitors
    .filter((m) => m.monthlyHours > 0)
    .map((m) => {
      const slot = state.overview?.monitors.findIndex((x) => x.id === m.id) ?? 0;
      return { label: m.name, hours: m.monthlyHours, color: `var(${SERIES[slot % SERIES.length]})`, detail: `${m.hoursPerDay} h/day` };
    });
  if (b.selfHours) segments.push({ label: 'keepwarm itself', hours: b.selfHours, color: 'var(--text-3)', detail: '24 h/day' });
  if (b.reservedHours) segments.push({ label: 'Reserved', hours: b.reservedHours, color: 'var(--empty)', detail: 'other use' });

  const scale = Math.max(limit, b.projectedHours);
  let used = 0;
  const parts = [];
  for (const seg of segments) {
    const within = Math.max(0, Math.min(seg.hours, limit - used));
    const over = seg.hours - within;
    if (within > 0) parts.push(`<i style="flex:${within / scale};background:${seg.color}" data-tip="${esc(seg.label)}|${seg.hours}|${esc(seg.detail)}"></i>`);
    if (over > 0) parts.push(`<i class="over" style="flex:${over / scale}" data-tip="${esc(seg.label)} (over the limit)|${seg.hours}|${esc(seg.detail)}"></i>`);
    used += seg.hours;
  }
  if (b.projectedHours < limit) parts.push(`<i style="flex:${(limit - b.projectedHours) / scale};background:transparent"></i>`);
  parts.push(`<span class="limit-mark" style="left:calc(${(limit / scale) * 100}% - 1px)" title="Limit"></span>`);
  const meter = $('#budget-meter');
  meter.innerHTML = parts.join('');
  meter.setAttribute('aria-label', `${b.projectedHours} of ${limit} hours projected this month`);

  $('#budget-legend').innerHTML = segments.length
    ? segments.map((s) => `<span><i class="sw" style="background:${s.color}"></i>${esc(s.label)} · ${fmtHours(s.hours)}</span>`).join('')
    : '<span>No active services.</span>';

  const active = b.monitors.filter((m) => m.monthlyHours > 0).length || 1;
  const perDay = (limit - b.reservedHours - b.selfHours) / b.days;
  $('#budget-explain').textContent =
    `${fmtHours(limit)} over ${b.days} days is ${(limit / b.days).toFixed(2)} h of awake time per day for the whole workspace. ` +
    `Fitting splits what's left evenly (${Math.max(0, perDay / active).toFixed(2)} h/day each for ${active} service${active === 1 ? '' : 's'}) ` +
    `and allows 15 minutes after the last ping before Render spins the service down.`;
}

$('#budget-meter').addEventListener('mousemove', (e) => {
  const seg = e.target.closest('[data-tip]');
  if (!seg) return hideTooltip();
  const [label, hours, detail] = seg.dataset.tip.split('|');
  showTooltip(`<div>${label}</div><div><b>${esc(fmtHours(Number(hours)))}</b> this month · ${detail}</div>`, e);
});
$('#budget-meter').addEventListener('mouseleave', hideTooltip);

$('#fit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const error = $('#fit-error');
  error.hidden = true;
  const button = e.target.querySelector('button');
  button.disabled = true;
  try {
    await api('POST', '/api/budget/fit', { start: e.target.start.value });
    await refresh();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
});

async function loadSettings() {
  state.settings = await api('GET', '/api/settings');
  // First run: default to the viewer's time zone.
  if (!state.settings.timezone) {
    state.settings = await api('PUT', '/api/settings', {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    });
  }
  renderSettings();
}

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

api('GET', '/api/session')
  .then(({ passwordProtected }) => { $('#logout').hidden = !passwordProtected; })
  .catch(console.error);

loadSettings().catch(console.error).finally(refresh);
connectEvents();
