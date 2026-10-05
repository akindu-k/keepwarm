# keepwarm

Render's free web services spin down after **15 minutes without inbound traffic**, and the next visitor waits about a minute for a cold start. **keepwarm** pings your Render URLs on a schedule you choose (every 5 minutes, 10 minutes, …) so they stay warm, and shows you every request it makes so you can see that it's working.

## Features

- **Scheduled pings** for any number of `*.onrender.com` URLs, each with its own interval (1–60 min)
- **Dashboard** with live status, countdown to the next ping, uptime, p95 latency and cold-start counts
- **Per-service detail**: response-time chart, availability strip, incidents, and a searchable request log
- **Live activity feed** streamed over Server-Sent Events
- **Cold-start detection**: a successful ping slower than 10s (configurable) is flagged as a cold start
- **Alerts** to Slack or Discord when a service goes down or recovers
- **Prometheus metrics** at `/metrics`, health check at `/healthz`
- Optional **password protection**
- One runtime dependency (Express); storage is SQLite via Node's built-in `node:sqlite`

## Quick start

Requires Node.js 22.13+ (24 recommended).

```bash
npm install
npm start            # http://localhost:3000
```

Open the dashboard, paste a Render URL such as `https://md-to-pdf-zckb.onrender.com/`, choose an interval and click **Start pinging**. The first ping happens immediately.

Copy `.env.example` to `.env` to configure it; `npm start` loads it automatically.

## Choosing an interval

| Interval | Effect |
|---|---|
| 1–14 min | Service stays awake. 10 min is a good default; 14 min uses the fewest requests. |
| 15+ min | Render will put the service to sleep between pings, so you'll still get cold starts. The dashboard warns you. |

> ⚠️ **Free instance hours.** Render gives each workspace **750 free instance hours per month**, and an awake service uses them around the clock (~730 h/month). Keeping **one** free service awake all month uses nearly the whole allowance. If you keep several services warm at once, you'll run out before the month ends and Render will suspend your free services until the next month. Keep warm only what needs it, or pause monitors when you don't.

## Deploying keepwarm

keepwarm has to run somewhere that's always on, otherwise it can't ping anything.

### Docker (recommended: any VPS or always-on host)

```bash
docker compose up -d --build
```

Ping history is stored in the `keepwarm-data` volume.

### On Render's free tier

It works, with two caveats:

1. **It must keep itself awake.** On Render, keepwarm automatically pings its own `/healthz` every 10 minutes (using `RENDER_EXTERNAL_URL`). That counts against the same 750 hours.
2. **No persistent disk.** The SQLite database is wiped whenever the instance restarts or redeploys. Set `SEED_MONITORS` so your services are re-created on boot. Ping history will still reset.

Deploy with the included `render.yaml` blueprint (**New → Blueprint** in the Render dashboard) and set:

```
DASHBOARD_PASSWORD=<something long>
SEED_MONITORS=https://md-to-pdf-zckb.onrender.com/=10,https://things-to-do-xdmm.onrender.com/=10
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `data/keepwarm.db` | SQLite database file |
| `DASHBOARD_PASSWORD` | – | If set, the UI, API and `/metrics` require HTTP Basic auth (any username). `/healthz` stays public. |
| `SEED_MONITORS` | – | `url=minutes` pairs, comma-separated, created on startup if missing |
| `ALERT_WEBHOOK_URL` | – | Slack/Discord incoming webhook for down/recovered alerts |
| `COLD_START_THRESHOLD_MS` | `10000` | Successful pings slower than this count as cold starts |
| `RETENTION_DAYS` | `7` | Ping history older than this is deleted hourly |
| `REQUEST_TIMEOUT_MS` | `90000` | Ping timeout (cold starts can take ~60s) |
| `MIN_INTERVAL_MINUTES` / `MAX_INTERVAL_MINUTES` | `1` / `60` | Allowed interval range |
| `MAX_MONITORS` | `50` | Maximum number of monitors |
| `ALLOW_ANY_HOST` | `false` | Allow URLs outside `*.onrender.com`. Leave off on public instances so keepwarm can't be used to send requests to arbitrary hosts. |
| `SELF_PING_URL` | `$RENDER_EXTERNAL_URL/healthz` | URL keepwarm pings every 10 min to keep itself awake |

## How a ping is judged

- **OK**: any response below 500. A 404 still means the instance is awake.
- **Cold start**: OK, but slower than `COLD_START_THRESHOLD_MS`. Seeing these regularly means the interval is too long, or Render restarted the instance.
- **Failed**: a 5xx response, network error or timeout. Consecutive failures are grouped into an **incident**.

## API

| Method & path | Description |
|---|---|
| `GET /api/monitors` | List monitors with last ping and next scheduled ping |
| `POST /api/monitors` | Create `{ "url": "...", "intervalMinutes": 10, "name": "optional" }` |
| `GET /api/monitors/:id` | One monitor |
| `PATCH /api/monitors/:id` | Update any of `name`, `url`, `intervalMinutes`, `enabled` |
| `DELETE /api/monitors/:id` | Delete a monitor and its history |
| `POST /api/monitors/:id/ping` | Ping now |
| `GET /api/overview?window=1h\|24h\|7d` | All monitors with summary stats and sparkline data |
| `GET /api/monitors/:id/stats?window=…` | Uptime, latency percentiles, cold starts, incidents, time series |
| `GET /api/monitors/:id/pings?limit=50&before=<cursor>&status=failed` | Request log, newest first |
| `GET /api/events` | Server-Sent Events stream of ping results |
| `GET /metrics` | Prometheus metrics |
| `GET /healthz` | Health check |

### Prometheus metrics

`keepwarm_monitor_up`, `keepwarm_monitor_enabled`, `keepwarm_monitor_interval_seconds`, `keepwarm_last_ping_latency_ms`, `keepwarm_pings_total{result}`, `keepwarm_cold_starts_total`, `keepwarm_ping_latency_ms` (histogram). Every series is labelled with `monitor` and `url`.

## Development

```bash
npm run dev   # restarts on file changes
npm test
```
