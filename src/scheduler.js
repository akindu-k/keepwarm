import { EventEmitter } from 'node:events';
import { ping as defaultPing } from './pinger.js';
import { isInWindow, msUntilWindowOpens } from './timewindow.js';

// Keeps one timer per enabled monitor and records each ping result.
// Emits 'ping' with { monitor, ping } after every request.
export class Scheduler extends EventEmitter {
  constructor(store, { timeoutMs, pingFn = defaultPing, now = Date.now, timezone = () => 'UTC' } = {}) {
    super();
    this.timezone = timezone;
    this.store = store;
    this.timeoutMs = timeoutMs;
    this.pingFn = pingFn;
    this.now = now;
    this.timers = new Map();
    this.nextRunAt = new Map();
    this.inFlight = new Set();
  }

  start() {
    for (const monitor of this.store.listMonitors()) this.schedule(monitor);
  }

  stop() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.nextRunAt.clear();
  }

  // (Re)schedule a monitor. The first run is due one interval after the last
  // recorded ping, or immediately if it has never been pinged. Outside the
  // monitor's daily window, the next run is when the window opens.
  schedule(monitor) {
    this.unschedule(monitor.id);
    if (!monitor.enabled) return;
    const now = new Date(this.now());
    const tz = this.timezone();
    if (!isInWindow(monitor, now, tz)) return this.#arm(monitor.id, msUntilWindowOpens(monitor, now, tz));
    const last = this.store.lastPing(monitor.id);
    const intervalMs = monitor.intervalMinutes * 60_000;
    const delay = last ? Math.max(0, last.startedAt + intervalMs - this.now()) : 0;
    this.#arm(monitor.id, delay);
  }

  rescheduleAll() {
    this.stop();
    this.start();
  }

  isPinging(id) {
    return this.inFlight.has(id);
  }

  isSleeping(monitor) {
    return monitor.enabled && !isInWindow(monitor, new Date(this.now()), this.timezone());
  }

  unschedule(id) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.nextRunAt.delete(id);
  }

  getNextRunAt(id) {
    return this.nextRunAt.get(id) ?? null;
  }

  // Ping a monitor right now, outside of its regular schedule.
  async runNow(id) {
    const monitor = this.store.getMonitor(id);
    if (!monitor) return null;
    return this.#run(monitor);
  }

  #arm(id, delay) {
    const timer = setTimeout(() => this.#tick(id), delay);
    timer.unref?.();
    this.timers.set(id, timer);
    this.nextRunAt.set(id, this.now() + delay);
  }

  async #tick(id) {
    const monitor = this.store.getMonitor(id);
    if (!monitor || !monitor.enabled) return this.unschedule(id);
    const now = new Date(this.now());
    const tz = this.timezone();
    if (!isInWindow(monitor, now, tz)) return this.#arm(id, msUntilWindowOpens(monitor, now, tz));
    // Arm the next run first so a slow request doesn't drift the schedule.
    this.#arm(id, monitor.intervalMinutes * 60_000);
    await this.#run(monitor);
  }

  async #run(monitor) {
    if (this.inFlight.has(monitor.id)) return null;
    this.inFlight.add(monitor.id);
    this.emit('ping-start', { monitor });
    try {
      const result = await this.pingFn(monitor.url, { timeoutMs: this.timeoutMs });
      // The monitor may have been deleted while the request was in flight.
      if (!this.store.getMonitor(monitor.id)) return null;
      const recorded = this.store.recordPing({ monitorId: monitor.id, ...result });
      this.emit('ping', { monitor, ping: recorded });
      return recorded;
    } catch (err) {
      console.error(`[scheduler] ping for monitor ${monitor.id} failed:`, err);
      return null;
    } finally {
      this.inFlight.delete(monitor.id);
    }
  }
}
