import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS monitors (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      name              TEXT    NOT NULL,
      url               TEXT    NOT NULL UNIQUE,
      interval_minutes  INTEGER NOT NULL,
      enabled           INTEGER NOT NULL DEFAULT 1,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pings (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_id   INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
      started_at   INTEGER NOT NULL,
      latency_ms   INTEGER,
      status_code  INTEGER,
      ok           INTEGER NOT NULL,
      error        TEXT
    );

    CREATE INDEX IF NOT EXISTS pings_monitor_time ON pings (monitor_id, started_at DESC);
  `);
  return db;
}

const toMonitor = (row) =>
  row && {
    id: row.id,
    name: row.name,
    url: row.url,
    intervalMinutes: row.interval_minutes,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

const toPing = (row) =>
  row && {
    id: row.id,
    monitorId: row.monitor_id,
    startedAt: row.started_at,
    latencyMs: row.latency_ms,
    statusCode: row.status_code,
    ok: row.ok === 1,
    error: row.error,
  };

export function createStore(db) {
  const q = {
    list: db.prepare('SELECT * FROM monitors ORDER BY id'),
    get: db.prepare('SELECT * FROM monitors WHERE id = ?'),
    count: db.prepare('SELECT COUNT(*) AS n FROM monitors'),
    insert: db.prepare(`
      INSERT INTO monitors (name, url, interval_minutes, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`),
    update: db.prepare(`
      UPDATE monitors SET name = ?, url = ?, interval_minutes = ?, enabled = ?, updated_at = ?
      WHERE id = ?`),
    remove: db.prepare('DELETE FROM monitors WHERE id = ?'),
    insertPing: db.prepare(`
      INSERT INTO pings (monitor_id, started_at, latency_ms, status_code, ok, error)
      VALUES (?, ?, ?, ?, ?, ?)`),
    lastPing: db.prepare('SELECT * FROM pings WHERE monitor_id = ? ORDER BY started_at DESC, id DESC LIMIT 1'),
    pingsSince: db.prepare('SELECT * FROM pings WHERE monitor_id = ? AND started_at >= ? ORDER BY started_at, id'),
    history: db.prepare(`
      SELECT * FROM pings
      WHERE monitor_id = ? AND id < ? AND (? = 0 OR ok = 0)
      ORDER BY id DESC LIMIT ?`),
    prune: db.prepare('DELETE FROM pings WHERE started_at < ?'),
  };

  return {
    db,
    listMonitors: () => q.list.all().map(toMonitor),
    getMonitor: (id) => toMonitor(q.get.get(id)),
    countMonitors: () => q.count.get().n,
    createMonitor({ name, url, intervalMinutes, enabled = true }) {
      const now = Date.now();
      const { lastInsertRowid } = q.insert.run(name, url, intervalMinutes, enabled ? 1 : 0, now, now);
      return toMonitor(q.get.get(lastInsertRowid));
    },
    updateMonitor(id, { name, url, intervalMinutes, enabled }) {
      q.update.run(name, url, intervalMinutes, enabled ? 1 : 0, Date.now(), id);
      return toMonitor(q.get.get(id));
    },
    deleteMonitor: (id) => q.remove.run(id).changes > 0,
    recordPing({ monitorId, startedAt, latencyMs, statusCode, ok, error }) {
      const { lastInsertRowid } = q.insertPing.run(
        monitorId, startedAt, latencyMs ?? null, statusCode ?? null, ok ? 1 : 0, error ?? null,
      );
      return { id: Number(lastInsertRowid), monitorId, startedAt, latencyMs, statusCode, ok, error: error ?? null };
    },
    lastPing: (monitorId) => toPing(q.lastPing.get(monitorId)),
    pingsSince: (monitorId, since) => q.pingsSince.all(monitorId, since).map(toPing),
    pingHistory: (monitorId, { before = Number.MAX_SAFE_INTEGER, limit = 50, failedOnly = false } = {}) =>
      q.history.all(monitorId, before, failedOnly ? 1 : 0, limit).map(toPing),
    prunePings: (olderThan) => Number(q.prune.run(olderThan).changes),
  };
}
