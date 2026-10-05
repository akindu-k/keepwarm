import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { awakeHoursPerDay, computeBudget, fitToLimit, DEFAULT_SETTINGS } from '../src/budget.js';
import { isInWindow, msUntilWindowOpens, daysInMonth, minuteOfDay } from '../src/timewindow.js';
import { startTestServer } from './helpers.js';

const OCT = new Date('2026-10-05T12:00:00Z'); // 31 days
const FEB = new Date('2027-02-10T12:00:00Z'); // 28 days
const settings = { ...DEFAULT_SETTINGS, timezone: 'UTC' };
const mon = (id, extra = {}) => ({ id, name: `m${id}`, intervalMinutes: 10, enabled: true, activeStart: null, activeEnd: null, ...extra });

test('time windows, including ones that wrap past midnight', () => {
  const day = { activeStart: 8 * 60, activeEnd: 20 * 60 };
  const night = { activeStart: 22 * 60, activeEnd: 6 * 60 };
  assert.equal(isInWindow(day, new Date('2026-10-05T12:00:00Z'), 'UTC'), true);
  assert.equal(isInWindow(day, new Date('2026-10-05T21:00:00Z'), 'UTC'), false);
  assert.equal(isInWindow(night, new Date('2026-10-05T23:00:00Z'), 'UTC'), true);
  assert.equal(isInWindow(night, new Date('2026-10-05T05:59:00Z'), 'UTC'), true);
  assert.equal(isInWindow(night, new Date('2026-10-05T12:00:00Z'), 'UTC'), false);
  assert.equal(msUntilWindowOpens(day, new Date('2026-10-05T21:00:00Z'), 'UTC'), 11 * 3600_000);
  assert.equal(msUntilWindowOpens(day, new Date('2026-10-05T12:00:00Z'), 'UTC'), 0);
  // 06:30 UTC is 12:00 in Colombo (UTC+5:30)
  assert.equal(minuteOfDay(new Date('2026-10-05T06:30:00Z'), 'Asia/Colombo'), 720);
});

test('daysInMonth follows the configured time zone', () => {
  assert.equal(daysInMonth(OCT, 'UTC'), 31);
  assert.equal(daysInMonth(FEB, 'UTC'), 28);
  // 2026-09-30T20:00Z is already October 1st in Colombo
  assert.equal(daysInMonth(new Date('2026-09-30T20:00:00Z'), 'Asia/Colombo'), 31);
  assert.equal(daysInMonth(new Date('2026-09-30T20:00:00Z'), 'UTC'), 30);
});

test('awake hours per day', () => {
  assert.equal(awakeHoursPerDay(mon(1)), 24);
  assert.equal(awakeHoursPerDay(mon(1, { enabled: false })), 0);
  assert.equal(awakeHoursPerDay(mon(1, { activeStart: 480, activeEnd: 1200 })), 12.25);
  // 30-minute interval all day: 48 pings x 15 min each = 12 h
  assert.equal(awakeHoursPerDay(mon(1, { intervalMinutes: 30 })), 12);
});

test('computeBudget totals monitors, self and reserved hours', () => {
  const b = computeBudget([mon(1), mon(2, { activeStart: 480, activeEnd: 1200 })], { ...settings, reservedHours: 10 }, OCT);
  assert.equal(b.days, 31);
  assert.deepEqual(b.monitors.map((m) => m.monthlyHours), [744, 379.75]);
  assert.equal(b.projectedHours, 1133.75);
  assert.equal(b.withinLimit, false);
  assert.equal(computeBudget([], { ...settings, countSelf: true }, OCT).selfHours, 744);
});

test('fitToLimit splits 750 h exactly and stays within the limit', () => {
  const plan = fitToLimit([mon(1), mon(2), mon(3, { enabled: false })], settings, { startMinute: 480, now: OCT });
  // 750 / 31 / 2 = 12.10 h per service; minus the 15 min idle tail, rounded down to 15 min = 11h45m
  assert.deepEqual(plan.windows, [
    { id: 1, activeStart: 480, activeEnd: 480 + 705 },
    { id: 2, activeStart: 480, activeEnd: 480 + 705 },
  ]);
  const fitted = [1, 2].map((id) => mon(id, { activeStart: 480, activeEnd: 1185 }));
  const b = computeBudget(fitted, settings, OCT);
  assert.ok(b.withinLimit);
  assert.equal(b.projectedHours, 744);
});

test('fitToLimit uses more hours in shorter months and gives all-day when there is room', () => {
  const feb = fitToLimit([mon(1), mon(2)], settings, { now: FEB });
  assert.equal(feb.windows[0].activeEnd - feb.windows[0].activeStart, 780); // 13h00m
  const solo = fitToLimit([mon(1)], { ...settings, monthlyHourLimit: 800 }, { now: OCT });
  assert.equal(solo.windows[0].activeStart, null);
});

test('fitToLimit refuses impossible budgets', () => {
  assert.throws(() => fitToLimit([mon(1)], { ...settings, countSelf: true }, { now: OCT }), /not enough/);
  assert.throws(() => fitToLimit([], settings, { now: OCT }), /no active monitors/);
  assert.throws(() => fitToLimit([mon(1, { intervalMinutes: 20 })], settings, { now: OCT }), /under 15 minutes/);
});

let t;
afterEach(() => t?.close());

test('settings and budget API', async () => {
  t = await startTestServer();
  assert.equal((await t.api('GET', '/api/settings')).body.monthlyHourLimit, 750);
  assert.equal((await t.api('PUT', '/api/settings', { timezone: 'Mars/Base' })).status, 400);
  const saved = await t.api('PUT', '/api/settings', { timezone: 'Asia/Colombo', reservedHours: 20 });
  assert.equal(saved.body.timezone, 'Asia/Colombo');
  assert.equal(saved.body.reservedHours, 20);

  for (const u of ['a', 'b']) await t.api('POST', '/api/monitors', { url: `https://${u}.onrender.com`, intervalMinutes: 10 });
  assert.equal((await t.api('GET', '/api/budget')).body.withinLimit, false);

  const fit = await t.api('POST', '/api/budget/fit', { start: '07:00' });
  assert.equal(fit.status, 200);
  assert.equal(fit.body.budget.withinLimit, true);
  const monitors = (await t.api('GET', '/api/monitors')).body;
  assert.ok(monitors.every((m) => m.activeStart === 420 && m.activeEnd > 420));

  assert.equal((await t.api('POST', '/api/budget/fit', { start: '7am' })).status, 400);
});
