export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function normalizeUrl(raw, { allowAnyHost = false } = {}) {
  if (typeof raw !== 'string' || !raw.trim()) throw new ValidationError('url is required');
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ValidationError('url is not a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ValidationError('url must use http or https');
  }
  if (url.username || url.password) throw new ValidationError('url must not contain credentials');
  const host = url.hostname.toLowerCase();
  if (!allowAnyHost && !(host.endsWith('.onrender.com') && host !== '.onrender.com')) {
    throw new ValidationError('url must be a Render URL (*.onrender.com)');
  }
  url.hash = '';
  return url.toString();
}

export function parseMonitorInput(body, config, existing) {
  if (!body || typeof body !== 'object') throw new ValidationError('request body must be a JSON object');

  const url = body.url !== undefined || !existing
    ? normalizeUrl(body.url, config)
    : existing.url;

  let intervalMinutes = existing?.intervalMinutes;
  if (body.intervalMinutes !== undefined || !existing) {
    intervalMinutes = Number(body.intervalMinutes);
    if (!Number.isInteger(intervalMinutes)) throw new ValidationError('intervalMinutes must be an integer');
    if (intervalMinutes < config.minIntervalMinutes || intervalMinutes > config.maxIntervalMinutes) {
      throw new ValidationError(
        `intervalMinutes must be between ${config.minIntervalMinutes} and ${config.maxIntervalMinutes}`,
      );
    }
  }

  let name = existing?.name;
  if (body.name !== undefined || !existing) {
    name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : new URL(url).hostname;
    if (name.length > 100) throw new ValidationError('name must be at most 100 characters');
  }

  let enabled = existing?.enabled ?? true;
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw new ValidationError('enabled must be a boolean');
    enabled = body.enabled;
  }

  let activeStart = existing?.activeStart ?? null;
  let activeEnd = existing?.activeEnd ?? null;
  if (body.activeStart !== undefined || body.activeEnd !== undefined) {
    activeStart = body.activeStart ?? null;
    activeEnd = body.activeEnd ?? null;
    if ((activeStart === null) !== (activeEnd === null)) {
      throw new ValidationError('activeStart and activeEnd must both be set, or both be null for all day');
    }
    if (activeStart !== null) {
      for (const v of [activeStart, activeEnd]) {
        if (!Number.isInteger(v) || v < 0 || v >= 1440) {
          throw new ValidationError('activeStart and activeEnd must be minutes after midnight (0-1439)');
        }
      }
      if (activeStart === activeEnd) throw new ValidationError('activeStart and activeEnd must differ');
    }
  }

  return { name, url, intervalMinutes, enabled, activeStart, activeEnd };
}

// Parses "HH:MM" into minutes after midnight.
export function parseClock(text) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(text).trim());
  if (!match) throw new ValidationError(`"${text}" is not a valid HH:MM time`);
  return Number(match[1]) * 60 + Number(match[2]);
}
