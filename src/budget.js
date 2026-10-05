import { daysInMonth, monthLabel, windowMinutes, hasWindow } from './timewindow.js';

// Render spins a free service down after 15 idle minutes, so each awake period
// lasts until 15 minutes after the last request.
export const IDLE_TAIL_HOURS = 0.25;
const FIT_STEP_MINUTES = 15;

export const DEFAULT_SETTINGS = {
  monthlyHourLimit: 750,
  reservedHours: 0,
  timezone: null,
  countSelf: false,
};

// Estimated hours per day a monitored service stays awake.
export function awakeHoursPerDay(monitor) {
  if (!monitor.enabled) return 0;
  const windowHours = windowMinutes(monitor) / 60;
  const allDay = !hasWindow(monitor);
  if (monitor.intervalMinutes < 15) {
    return allDay ? 24 : Math.min(24, windowHours + IDLE_TAIL_HOURS);
  }
  // With long intervals the service sleeps between pings; each ping buys ~15 minutes.
  const pingsPerDay = Math.ceil((windowHours * 60) / monitor.intervalMinutes);
  return Math.min(allDay ? 24 : windowHours + IDLE_TAIL_HOURS, pingsPerDay * IDLE_TAIL_HOURS);
}

const round2 = (n) => Math.round(n * 100) / 100;

export function computeBudget(monitors, settings, now = new Date()) {
  const tz = settings.timezone ?? 'UTC';
  const days = daysInMonth(now, tz);
  const selfHours = settings.countSelf ? 24 * days : 0;
  const perMonitor = monitors.map((m) => {
    const perDay = awakeHoursPerDay(m);
    return { id: m.id, name: m.name, hoursPerDay: round2(perDay), monthlyHours: round2(perDay * days) };
  });
  const monitorHours = perMonitor.reduce((sum, m) => sum + m.monthlyHours, 0);
  const projectedHours = round2(monitorHours + selfHours + settings.reservedHours);
  return {
    month: monthLabel(now, tz),
    timezone: tz,
    days,
    monthlyHourLimit: settings.monthlyHourLimit,
    reservedHours: settings.reservedHours,
    selfHours,
    monitors: perMonitor,
    projectedHours,
    remainingHours: round2(settings.monthlyHourLimit - projectedHours),
    withinLimit: projectedHours <= settings.monthlyHourLimit,
  };
}

// Splits the available hours evenly between the enabled monitors and returns a
// daily window per monitor, starting at `startMinute`, that keeps the projected
// total at or under the monthly limit.
export function fitToLimit(monitors, settings, { startMinute = 8 * 60, now = new Date() } = {}) {
  const enabled = monitors.filter((m) => m.enabled);
  if (!enabled.length) throw new RangeError('there are no active monitors to fit');
  const tz = settings.timezone ?? 'UTC';
  const days = daysInMonth(now, tz);
  const available = settings.monthlyHourLimit - settings.reservedHours - (settings.countSelf ? 24 * days : 0);
  const perMonitorDaily = available / days / enabled.length;
  const longIntervals = enabled.filter((m) => m.intervalMinutes >= 15);
  if (longIntervals.length) {
    throw new RangeError('fitting assumes intervals under 15 minutes; shorten the interval of ' +
      longIntervals.map((m) => m.name).join(', '));
  }

  if (perMonitorDaily >= 24) {
    return { days, perMonitorDaily: round2(perMonitorDaily), windows: enabled.map((m) => ({ id: m.id, activeStart: null, activeEnd: null })) };
  }
  const windowMin = Math.floor(((perMonitorDaily - IDLE_TAIL_HOURS) * 60) / FIT_STEP_MINUTES) * FIT_STEP_MINUTES;
  if (windowMin < FIT_STEP_MINUTES) {
    throw new RangeError(`only ${round2(Math.max(0, available))} h are available this month — not enough to keep ` +
      `${enabled.length} service${enabled.length === 1 ? '' : 's'} warm for even 15 minutes a day`);
  }
  const activeEnd = (startMinute + windowMin) % 1440;
  return {
    days,
    perMonitorDaily: round2(perMonitorDaily),
    windows: enabled.map((m) => ({ id: m.id, activeStart: startMinute, activeEnd })),
  };
}
