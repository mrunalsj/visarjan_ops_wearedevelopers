import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initFlags, getFlags, flagStatus, FLAG_DEFAULTS } from '../server/flags.js';

test('without Flagsmith, existing features stay on and new features stay off', async () => {
  initFlags({});
  assert.deepEqual(await getFlags(), { ...FLAG_DEFAULTS });
  assert.equal((await getFlags()).voice_assistance, false);
  assert.equal((await getFlags()).ops_status_updates, false);
  assert.equal((await getFlags()).map_view, true);
  assert.equal(flagStatus().mode, 'defaults');
});

test('FEATURE_FLAG_DEFAULTS changes fallback values only for known flags', async () => {
  initFlags({ FEATURE_FLAG_DEFAULTS: 'voice_assistance=on, map_view=off, unknown_flag=on, apify_import=maybe' });
  const flags = await getFlags();
  assert.equal(flags.voice_assistance, true);
  assert.equal(flags.map_view, false);
  assert.equal(flags.apify_import, true);
  assert.equal('unknown_flag' in flags, false);
  initFlags({});
});

test('a non-server key is refused instead of being used in the SDK', async () => {
  initFlags({ FLAGSMITH_SERVER_KEY: 'client-side-key-123' });
  assert.equal(flagStatus().configured, false);
  assert.match(flagStatus().lastError, /server-side environment key/);
  assert.deepEqual(await getFlags(), { ...FLAG_DEFAULTS });
  initFlags({});
});
