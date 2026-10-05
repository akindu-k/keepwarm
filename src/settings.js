import { DEFAULT_SETTINGS } from './budget.js';
import { isValidTimeZone } from './timewindow.js';
import { ValidationError } from './validate.js';

export function loadSettings(store, config = {}) {
  return {
    ...DEFAULT_SETTINGS,
    monthlyHourLimit: config.monthlyHourLimit ?? DEFAULT_SETTINGS.monthlyHourLimit,
    timezone: config.timezone ?? DEFAULT_SETTINGS.timezone,
    countSelf: config.countSelf ?? DEFAULT_SETTINGS.countSelf,
    ...store.getSettings(),
  };
}

export function parseSettingsInput(body) {
  if (!body || typeof body !== 'object') throw new ValidationError('request body must be a JSON object');
  const out = {};
  if (body.monthlyHourLimit !== undefined) {
    const v = Number(body.monthlyHourLimit);
    if (!Number.isFinite(v) || v <= 0 || v > 100_000) throw new ValidationError('monthlyHourLimit must be a positive number of hours');
    out.monthlyHourLimit = v;
  }
  if (body.reservedHours !== undefined) {
    const v = Number(body.reservedHours);
    if (!Number.isFinite(v) || v < 0) throw new ValidationError('reservedHours must be zero or more');
    out.reservedHours = v;
  }
  if (body.timezone !== undefined) {
    if (!isValidTimeZone(body.timezone)) throw new ValidationError('timezone must be an IANA time zone such as Asia/Colombo');
    out.timezone = body.timezone;
  }
  if (body.countSelf !== undefined) {
    if (typeof body.countSelf !== 'boolean') throw new ValidationError('countSelf must be a boolean');
    out.countSelf = body.countSelf;
  }
  return out;
}
