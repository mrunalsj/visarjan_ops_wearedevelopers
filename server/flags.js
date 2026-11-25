// Feature flags via the official Flagsmith Node.js SDK, using local evaluation:
// the SDK downloads the environment once and refreshes it in the background (every 60 s by default),
// so checking a flag never makes a network call per request or page render.
// Flags control rollout only. Login/authorisation is always checked separately, and live site data
// (status, capacity, closures) stays in the app's own data and API, never in flags.
import { Flagsmith, DefaultFlag } from '@flagsmith/nodejs';

// Used when Flagsmith is not configured, unreachable, or a flag has not been created yet.
// Existing behaviour stays on; new or cost-incurring features stay off.
export const FLAG_DEFAULTS = Object.freeze({
  nearby_discovery: true,
  map_view: true,
  apify_import: true,
  voice_assistance: false,
  ops_status_updates: false
});

let client = null;
const state = { mode: 'defaults', lastLoadedAt: null, lastError: null };
let defaults = { ...FLAG_DEFAULTS };

// FEATURE_FLAG_DEFAULTS="voice_assistance=on,ops_status_updates=on" changes fallback values only
// (when Flagsmith is not configured, unreachable, or a flag is missing). Flagsmith values always win.
function parseDefaultOverrides(raw = '') {
  const next = { ...FLAG_DEFAULTS };
  for (const pair of raw.split(',').map(p => p.trim()).filter(Boolean)) {
    const [name, value] = pair.split('=').map(v => v.trim());
    if (name in next && ['on', 'off', 'true', 'false'].includes(value)) next[name] = value === 'on' || value === 'true';
  }
  return next;
}

export function initFlags(env = process.env) {
  defaults = parseDefaultOverrides(env.FEATURE_FLAG_DEFAULTS);
  const key = env.FLAGSMITH_SERVER_KEY?.trim();
  if (!key) { state.mode = 'defaults'; return; }
  if (!key.startsWith('ser.')) {
    state.mode = 'defaults';
    state.lastError = 'FLAGSMITH_SERVER_KEY must be a server-side environment key (it starts with "ser.").';
    return;
  }
  const refresh = Number.parseInt(env.FLAGSMITH_REFRESH_SECONDS || '60', 10);
  client = new Flagsmith({
    environmentKey: key,
    apiUrl: env.FLAGSMITH_API_URL?.trim() || undefined,
    enableLocalEvaluation: true,
    environmentRefreshIntervalSeconds: Number.isFinite(refresh) && refresh >= 15 ? refresh : 60,
    requestTimeoutSeconds: 5,
    defaultFlagHandler: name => new DefaultFlag(undefined, defaults[name] ?? false),
    onEnvironmentChange: error => {
      if (error) state.lastError = 'Could not refresh flags from Flagsmith; using the last known or default values.';
      else { state.lastLoadedAt = new Date().toISOString(); state.lastError = null; }
    }
  });
  state.mode = 'flagsmith';
}

export async function getFlags() {
  if (!client) return { ...defaults };
  try {
    const flags = await client.getEnvironmentFlags();
    state.lastLoadedAt ||= new Date().toISOString();
    return Object.fromEntries(Object.keys(FLAG_DEFAULTS).map(name => [name, flags.isFeatureEnabled(name)]));
  } catch {
    state.lastError = 'Flagsmith is unavailable; using default flag values.';
    return { ...defaults };
  }
}

export const isEnabled = async name => (await getFlags())[name] === true;
export const flagStatus = () => ({ ...state, configured: Boolean(client) });
export async function closeFlags() { await client?.close(); }
