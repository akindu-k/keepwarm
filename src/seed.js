import { parseMonitorInput } from './validate.js';

// Parses "url=minutes,url=minutes" and creates any monitors that don't exist yet.
export function seedMonitors(store, spec, config) {
  const created = [];
  for (const entry of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const eq = entry.lastIndexOf('=');
    const url = eq > 0 ? entry.slice(0, eq) : entry;
    const intervalMinutes = eq > 0 ? Number(entry.slice(eq + 1)) : 10;
    const input = parseMonitorInput({ url, intervalMinutes }, config);
    if (store.listMonitors().some((m) => m.url === input.url)) continue;
    created.push(store.createMonitor(input));
  }
  return created;
}
