import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStatus, createStatusSource } from '../server/status-source.js';

const now = Date.parse('2026-11-25T12:00:00Z');
const site = statusSource => ({ status: 'Available', waiting: 10, wait: '~6 min', statusSource });
const minutesAgo = m => new Date(now - m * 60_000).toISOString();

test('status without a source or timestamp is unavailable and hides queue values', () => {
  for (const s of [site(undefined), site({ kind: 'demo', observedAt: minutesAgo(1) }), site({ kind: 'demo', source: 'Sim' })]) {
    const result = classifyStatus(s, now);
    assert.equal(result.freshness, 'unavailable');
    assert.equal(result.waiting, null);
    assert.equal(result.wait, null);
  }
});

test('demo data is always labeled demo, never live', () => {
  assert.equal(classifyStatus(site({ kind: 'demo', source: 'Sim', observedAt: minutesAgo(0) }), now).freshness, 'demo');
});

test('authorised feed is live when fresh, delayed when aging and unavailable when stale', () => {
  const feed = m => classifyStatus(site({ kind: 'authorised-feed', source: 'Municipal feed', observedAt: minutesAgo(m) }), now).freshness;
  assert.equal(feed(2), 'live');
  assert.equal(feed(15), 'delayed');
  assert.equal(feed(45), 'unavailable');
});

test('authenticated staff updates are live only while fresh', () => {
  const staff = m => classifyStatus(site({ kind: 'staff-update', source: 'Site staff', observedAt: minutesAgo(m) }), now);
  assert.equal(staff(1).freshness, 'live');
  assert.equal(staff(1).label, 'Live · staff update');
  assert.equal(staff(15).freshness, 'delayed');
  assert.equal(staff(45).freshness, 'unavailable');
});

test('future timestamps and unknown source kinds are rejected', () => {
  assert.equal(classifyStatus(site({ kind: 'authorised-feed', source: 'Feed', observedAt: new Date(now + 10 * 60_000).toISOString() }), now).freshness, 'unavailable');
  assert.equal(classifyStatus(site({ kind: 'scraped', source: 'Web page', observedAt: minutesAgo(1) }), now).freshness, 'unavailable');
});

test('no live status feed is reported as connected', async () => {
  const source = createStatusSource({ SITE_STATUS_FEED_URL: 'https://example.test/feed' });
  assert.equal(source.connected, false);
  await assert.rejects(source.fetchSnapshots(), /No authorised live status feed/);
});
