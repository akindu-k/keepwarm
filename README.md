# keepwarm

Render's free web services spin down after **15 minutes without inbound traffic**, and the next visitor waits about a minute for a cold start. **keepwarm** pings your Render URLs on a schedule you choose (every 5 minutes, 10 minutes, …) so they stay warm, and shows you every request it makes so you can see that it's working.

## Features

- **Scheduled pings** for any number of `*.onrender.com` URLs, each with its own interval (1–60 min)
- **Dashboard** with live status, countdown to the next ping, uptime, p95 latency and cold-start counts
- **Per-service detail**: response-time chart, availability strip, incidents, and a searchable request log
- **Live activity feed** streamed over Server-Sent Events
- **Free-hour budget**: pick your monthly instance-hour limit (Render free = 750 h), see projected usage, and fit every service into it with one click
- **Daily schedules**: keep a service warm only between set hours (e.g. 08:00–19:45)
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

## Staying within the free instance hours

Render gives each workspace **750 free instance hours per month**, and a service uses them whenever it's awake. One service kept awake 24/7 uses 744 h in a 31-day month, so keeping two or more awake all day runs out before the month ends, and Render then suspends the workspace's free services until the next month.

The **Free instance hours** card on the dashboard handles this:

- **Monthly limit**: *Render free tier: 750 h*, or a custom number.
- **Reserve for other use**: hours to set aside for real traffic outside keepwarm's windows.
- **Time zone**: the zone daily windows and the month boundaries are evaluated in.
- **keepwarm runs in this workspace**: tick this if keepwarm itself is a free service in the same workspace (it then counts 24 h/day).
- A meter shows projected usage for the current month against the limit.
- **Fit services to limit** splits the available hours evenly between the active services and gives each one a daily window starting at the time you pick. For example, two services in a 31-day month get **08:00–19:45** each (2 × 12 h × 31 = 744 h ≤ 750). Shorter months get longer windows.

Usage is estimated as *window length + 15 minutes* per day (Render spins a service down 15 minutes after its last request). Outside its window a service shows **Off hours** and isn't pinged. You can also set a window per service when adding or editing it.

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
SEED_MONITORS=https://md-to-pdf-zckb.onrender.com/=10@08:00-19:45,https://things-to-do-xdmm.onrender.com/=10@08:00-19:45
TIMEZONE=Asia/Colombo
```

Deploy keepwarm in a **separate Render workspace** from the services it keeps warm. Every workspace has its own 750 h, and keepwarm uses about 744 h of its workspace just by staying awake.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `data/keepwarm.db` | SQLite database file |
| `DASHBOARD_PASSWORD` | – | If set, the UI, API and `/metrics` require HTTP Basic auth (any username). `/healthz` stays public. |
| `SEED_MONITORS` | – | `url=minutes[@HH:MM-HH:MM]`, comma-separated, created on startup if missing |
| `MONTHLY_HOUR_LIMIT` | `750` | Default monthly instance-hour limit for the budget card |
| `TIMEZONE` | viewer's zone | Default IANA time zone for daily windows, e.g. `Asia/Colombo` |
| `COUNT_SELF` | `false` | Default for "keepwarm runs in this workspace" |
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
| `POST /api/monitors` | Create `{ "url": "...", "intervalMinutes": 10, "name": "optional", "activeStart": 480, "activeEnd": 1185 }` (window in minutes after midnight; omit or `null` for all day) |
| `GET /api/monitors/:id` | One monitor |
| `PATCH /api/monitors/:id` | Update any of `name`, `url`, `intervalMinutes`, `enabled`, `activeStart`, `activeEnd` |
| `DELETE /api/monitors/:id` | Delete a monitor and its history |
| `POST /api/monitors/:id/ping` | Ping now |
| `GET /api/overview?window=1h\|24h\|7d` | All monitors with summary stats and sparkline data |
| `GET /api/monitors/:id/stats?window=…` | Uptime, latency percentiles, cold starts, incidents, time series |
| `GET /api/monitors/:id/pings?limit=50&before=<cursor>&status=failed` | Request log, newest first |
| `GET /api/events` | Server-Sent Events stream of ping results |
| `GET /metrics` | Prometheus metrics |
| `GET /api/settings` / `PUT /api/settings` | Budget settings: `monthlyHourLimit`, `reservedHours`, `timezone`, `countSelf` |
| `GET /api/budget` | Projected instance hours for the current month, per service and in total |
| `POST /api/budget/fit` | `{ "start": "08:00" }` gives every active service a daily window that fits the limit |
| `GET /healthz` | Health check |

### Prometheus metrics

`keepwarm_monitor_up`, `keepwarm_monitor_enabled`, `keepwarm_monitor_interval_seconds`, `keepwarm_last_ping_latency_ms`, `keepwarm_pings_total{result}`, `keepwarm_cold_starts_total`, `keepwarm_ping_latency_ms` (histogram). Every series is labelled with `monitor` and `url`.

## Development

```bash
npm run dev   # restarts on file changes
npm test
```
