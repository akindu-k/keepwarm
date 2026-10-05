const int = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  port: int(process.env.PORT, 3000),
  dbPath: process.env.DB_PATH ?? 'data/keepwarm.db',
  // Only *.onrender.com URLs are accepted unless this is set, so a public
  // instance can't be used to make requests to arbitrary hosts.
  allowAnyHost: process.env.ALLOW_ANY_HOST === 'true',
  minIntervalMinutes: int(process.env.MIN_INTERVAL_MINUTES, 1),
  maxIntervalMinutes: int(process.env.MAX_INTERVAL_MINUTES, 60),
  // Cold starts on Render's free tier can take close to a minute.
  requestTimeoutMs: int(process.env.REQUEST_TIMEOUT_MS, 90_000),
  maxMonitors: int(process.env.MAX_MONITORS, 50),
};
