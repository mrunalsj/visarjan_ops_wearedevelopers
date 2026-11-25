// Classifies site status so the public app never presents simulated or stale values as live.
// Queue, wait and availability are only published together with a named source and an observation time.

export const FRESHNESS = Object.freeze({ LIVE: 'live', DELAYED: 'delayed', DEMO: 'demo', UNAVAILABLE: 'unavailable' });

const LIVE_MAX_AGE_MS = 5 * 60 * 1000;
const DELAYED_MAX_AGE_MS = 30 * 60 * 1000;
const LABELS = {
  live: 'Live · authorised feed',
  delayed: 'Delayed · authorised feed',
  demo: 'Simulated · not a live reading',
  unavailable: 'Status unavailable'
};

const unavailable = reason => ({ freshness: FRESHNESS.UNAVAILABLE, label: LABELS.unavailable, reason, source: null, observedAt: null, status: null, waiting: null, wait: null });

export function classifyStatus(site, now = Date.now()) {
  const source = site?.statusSource;
  if (!source?.source || !source?.observedAt) return unavailable('No source or timestamp for this site.');
  const observed = Date.parse(source.observedAt);
  if (!Number.isFinite(observed) || observed > now + 60_000) return unavailable('The status timestamp is invalid.');
  const values = { source: source.source, observedAt: source.observedAt, status: site.status ?? null, waiting: site.waiting ?? null, wait: site.wait ?? null };
  if (source.kind === 'demo') return { freshness: FRESHNESS.DEMO, label: LABELS.demo, reason: null, ...values };
  if (source.kind !== 'authorised-feed' && source.kind !== 'staff-update') return unavailable('Unrecognised status source.');
  const age = now - observed;
  if (age <= LIVE_MAX_AGE_MS) return { freshness: FRESHNESS.LIVE, label: source.kind === 'staff-update' ? 'Live · staff update' : LABELS.live, reason: null, ...values };
  if (age <= DELAYED_MAX_AGE_MS) return { freshness: FRESHNESS.DELAYED, label: source.kind === 'staff-update' ? 'Delayed · staff update' : LABELS.delayed, reason: null, ...values };
  return unavailable('The last update is too old to rely on.');
}

// Interface for a future authorised municipal or site-operator feed.
// Implementations must return [{ siteId, status, waiting, wait, observedAt }] from a source the operator is authorised to use.
// Nothing is connected today: SITE_STATUS_FEED_URL is only reported, never fetched, until an adapter is reviewed and enabled.
export function createStatusSource(env = process.env) {
  const feedUrl = env.SITE_STATUS_FEED_URL?.trim() || null;
  return {
    name: feedUrl ? 'authorised-feed (configured, adapter not implemented)' : 'none',
    connected: false,
    async fetchSnapshots() {
      const error = new Error('No authorised live status feed is connected.');
      error.statusCode = 503;
      throw error;
    }
  };
}
