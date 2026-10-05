import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, parseMonitorInput, parseClock, ValidationError } from '../src/validate.js';
import { testConfig } from './helpers.js';

test('accepts Render URLs and strips the fragment', () => {
  assert.equal(normalizeUrl(' https://md-to-pdf-zckb.onrender.com/#x '), 'https://md-to-pdf-zckb.onrender.com/');
  assert.equal(normalizeUrl('https://things-to-do-xdmm.onrender.com/health'), 'https://things-to-do-xdmm.onrender.com/health');
});

test('rejects non-Render hosts unless allowAnyHost is set', () => {
  assert.throws(() => normalizeUrl('https://example.com'), ValidationError);
  assert.throws(() => normalizeUrl('https://evil.com/?x=.onrender.com'), ValidationError);
  assert.throws(() => normalizeUrl('https://onrender.com.evil.com'), ValidationError);
  assert.equal(normalizeUrl('https://example.com', { allowAnyHost: true }), 'https://example.com/');
});

test('rejects bad schemes, credentials, and garbage', () => {
  assert.throws(() => normalizeUrl('ftp://a.onrender.com'), ValidationError);
  assert.throws(() => normalizeUrl('https://u:p@a.onrender.com'), ValidationError);
  assert.throws(() => normalizeUrl('not a url'), ValidationError);
  assert.throws(() => normalizeUrl(''), ValidationError);
});

test('parseMonitorInput validates the interval and defaults the name', () => {
  const input = parseMonitorInput({ url: 'https://a.onrender.com', intervalMinutes: 10 }, testConfig);
  assert.deepEqual(input, { name: 'a.onrender.com', url: 'https://a.onrender.com/', intervalMinutes: 10, enabled: true, activeStart: null, activeEnd: null });
  assert.throws(() => parseMonitorInput({ url: 'https://a.onrender.com', intervalMinutes: 0 }, testConfig), /between/);
  assert.throws(() => parseMonitorInput({ url: 'https://a.onrender.com', intervalMinutes: 2.5 }, testConfig), /integer/);
  assert.throws(() => parseMonitorInput({ url: 'https://a.onrender.com' }, testConfig), /integer/);
});

test('parseMonitorInput keeps existing values on partial updates', () => {
  const existing = { name: 'mine', url: 'https://a.onrender.com/', intervalMinutes: 10, enabled: true, activeStart: 480, activeEnd: 1200 };
  assert.deepEqual(parseMonitorInput({ enabled: false }, testConfig, existing), { ...existing, enabled: false });
  assert.throws(() => parseMonitorInput({ enabled: 'no' }, testConfig, existing), /boolean/);
});

test('parseMonitorInput validates daily windows', () => {
  const base = { url: 'https://a.onrender.com', intervalMinutes: 10 };
  assert.equal(parseMonitorInput({ ...base, activeStart: 1320, activeEnd: 360 }, testConfig).activeStart, 1320);
  assert.throws(() => parseMonitorInput({ ...base, activeStart: 60 }, testConfig), /both/);
  assert.throws(() => parseMonitorInput({ ...base, activeStart: 60, activeEnd: 60 }, testConfig), /differ/);
  assert.throws(() => parseMonitorInput({ ...base, activeStart: 60, activeEnd: 1440 }, testConfig), /0-1439/);
  const existing = { name: 'x', url: 'https://a.onrender.com/', intervalMinutes: 10, enabled: true, activeStart: 60, activeEnd: 120 };
  const cleared = parseMonitorInput({ activeStart: null, activeEnd: null }, testConfig, existing);
  assert.equal(cleared.activeStart, null);
});

test('parseClock reads HH:MM', () => {
  assert.equal(parseClock('08:30'), 510);
  assert.equal(parseClock('0:05'), 5);
  assert.throws(() => parseClock('24:00'), ValidationError);
  assert.throws(() => parseClock('8.30'), ValidationError);
});
