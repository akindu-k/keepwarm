// Helpers for daily "keep warm between HH:MM and HH:MM" windows, evaluated in an IANA time zone.

const MINUTES_PER_DAY = 1440;
const formatters = new Map();

function partsIn(timeZone, now) {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    formatters.set(timeZone, fmt);
  }
  const parts = {};
  for (const { type, value } of fmt.formatToParts(now)) parts[type] = Number(value);
  return parts;
}

export function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return typeof tz === 'string' && tz.length > 0;
  } catch {
    return false;
  }
}

// Minutes since local midnight, with fractional seconds.
export function minuteOfDay(now, timeZone) {
  const p = partsIn(timeZone, now);
  return p.hour * 60 + p.minute + p.second / 60;
}

export function daysInMonth(now, timeZone) {
  const p = partsIn(timeZone, now);
  return new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
}

export function monthLabel(now, timeZone) {
  return new Intl.DateTimeFormat('en-US', { timeZone, month: 'long', year: 'numeric' }).format(now);
}

export const hasWindow = (m) => m.activeStart != null && m.activeEnd != null;

export function windowMinutes(m) {
  if (!hasWindow(m)) return MINUTES_PER_DAY;
  return (m.activeEnd - m.activeStart + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

export function isInWindow(m, now, timeZone) {
  if (!hasWindow(m)) return true;
  const t = minuteOfDay(now, timeZone);
  return m.activeStart < m.activeEnd
    ? t >= m.activeStart && t < m.activeEnd
    : t >= m.activeStart || t < m.activeEnd; // window wraps past midnight
}

// Milliseconds until the window next opens (0 if it is open now).
export function msUntilWindowOpens(m, now, timeZone) {
  if (isInWindow(m, now, timeZone)) return 0;
  const t = minuteOfDay(now, timeZone);
  const minutes = (m.activeStart - t + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return Math.ceil(minutes * 60_000);
}

export const formatMinute = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
