import { parseMonitorInput, parseClock } from './validate.js';

// Parses "url=minutes[@HH:MM-HH:MM],..." and creates any monitors that don't exist yet.
// The optional @window limits pings to that time of day.
export function seedMonitors(store, spec, config) {
  const created = [];
  for (const raw of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const at = raw.lastIndexOf('@');
    const entry = at > 0 ? raw.slice(0, at) : raw;
    const window = at > 0 ? raw.slice(at + 1).split('-').map(parseClock) : [null, null];
    const eq = entry.lastIndexOf('=');
    const url = eq > 0 ? entry.slice(0, eq) : entry;
    const intervalMinutes = eq > 0 ? Number(entry.slice(eq + 1)) : 10;
    const input = parseMonitorInput({ url, intervalMinutes, activeStart: window[0], activeEnd: window[1] }, config);
    if (store.listMonitors().some((m) => m.url === input.url)) continue;
    created.push(store.createMonitor(input));
  }
  return created;
}
