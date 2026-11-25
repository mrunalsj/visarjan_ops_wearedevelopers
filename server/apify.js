const API_ROOT = 'https://api.apify.com/v2';

export function getApifyStatus() {
  const tokenConfigured = Boolean(process.env.APIFY_API_TOKEN?.trim());
  const actorId = process.env.APIFY_ACTOR_ID?.trim() || '';
  return {
    connected: tokenConfigured && Boolean(actorId),
    tokenConfigured,
    actorConfigured: Boolean(actorId),
    actorId: actorId || null,
    maxItems: getMaxItems(),
    maxTotalChargeUsd: getMaxTotalChargeUsd(),
  };
}

function getMaxItems() {
  const parsed = Number.parseInt(process.env.APIFY_MAX_ITEMS || '25', 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 100)) : 25;
}

function getMaxTotalChargeUsd() {
  const parsed = Number.parseFloat(process.env.APIFY_MAX_TOTAL_CHARGE_USD || '1');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function getActorInput() {
  const raw = process.env.APIFY_ACTOR_INPUT_JSON || '{}';
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    const error = new Error('APIFY_ACTOR_INPUT_JSON must contain valid JSON.');
    error.statusCode = 503;
    throw error;
  }
  if (!input || Array.isArray(input) || typeof input !== 'object') {
    const error = new Error('APIFY_ACTOR_INPUT_JSON must be a JSON object.');
    error.statusCode = 503;
    throw error;
  }
  return input;
}

export async function runConfiguredApifyActor() {
  const status = getApifyStatus();
  if (!status.connected) {
    const error = new Error('Configure APIFY_API_TOKEN and APIFY_ACTOR_ID on the server first.');
    error.statusCode = 503;
    throw error;
  }

  const input = getActorInput();
  const params = new URLSearchParams({
    clean: 'true',
    limit: String(status.maxItems),
    maxItems: String(status.maxItems),
    maxTotalChargeUsd: String(status.maxTotalChargeUsd),
  });
  const url = `${API_ROOT}/actors/${encodeURIComponent(status.actorId)}/run-sync-get-dataset-items?${params}`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.APIFY_API_TOKEN.trim()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(300_000),
    });
  } catch (cause) {
    const timedOut = cause?.name === 'TimeoutError' || cause?.name === 'AbortError';
    const error = new Error(timedOut
      ? 'The Apify Actor did not finish within five minutes. Use a shorter run or a scheduled Actor task.'
      : 'Could not reach Apify. Check the server network connection and try again.');
    error.statusCode = 502;
    throw error;
  }

  const raw = await response.text();
  if (raw.length > 2_000_000) {
    const error = new Error('Apify returned more than 2 MB. Lower APIFY_MAX_ITEMS or narrow the Actor input.');
    error.statusCode = 413;
    throw error;
  }
  if (!response.ok) {
    let detail = {};
    try { detail = JSON.parse(raw); } catch { /* Keep provider errors out of the public response. */ }
    let message = 'Apify could not complete the Actor run.';
    if (response.status === 401 || response.status === 403) message = 'Apify rejected the API token or it does not have permission to run this Actor.';
    else if (response.status === 402) message = 'Apify requires available account credits or billing for this Actor.';
    else if (response.status === 400) message = 'Apify rejected the configured Actor input. Check APIFY_ACTOR_INPUT_JSON against the Actor input fields.';
    else if (response.status === 408) message = 'The Apify Actor exceeded its five-minute synchronous run limit.';
    else if (response.status === 404) message = 'Apify could not find this Actor. Check APIFY_ACTOR_ID.';
    const error = new Error(message);
    error.statusCode = response.status === 402 ? 402 : response.status === 408 ? 408 : 502;
    error.providerCode = detail?.error?.type || detail?.error?.message || null;
    throw error;
  }

  let items;
  try {
    items = JSON.parse(raw);
  } catch {
    const error = new Error('Apify returned an unreadable dataset response.');
    error.statusCode = 502;
    throw error;
  }
  if (!Array.isArray(items)) {
    const error = new Error('Apify returned an unexpected dataset format; expected a list of items.');
    error.statusCode = 502;
    throw error;
  }
  return items.slice(0, status.maxItems);
}
