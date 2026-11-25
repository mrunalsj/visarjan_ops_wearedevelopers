# Architecture

## Implemented local demo

```text
Browser (HTML/CSS/vanilla JavaScript)
   ├── GET /api/v1/public/sites
   ├── POST /api/v1/public/bookings  ── serialized capacity check
   ├── GET /api/v1/public/bookings/{ref}?key=…
   ├── POST /api/v1/public/assistance-requests
   └── GET /api/v1/public/live       ── simulated SSE snapshot
                       │
              Node.js HTTP API
                 ├── data/demo.json
                 └── Apify API (optional; staff-triggered)
```

The storage layer is intentionally small for zero-setup demos. A process-local reservation queue prevents overlapping booking requests in a single server process. It does not provide multi-process locking or database transactions. Booking references are random; a separate random recovery key is returned once and only its SHA-256 hash is saved. Public retrieval requires the reference and key.

Operations access is separated from public site discovery. Configure `OPS_USERNAME` and a unique `OPS_PASSWORD` (minimum 12 characters) before server startup. Login sets a random HttpOnly, SameSite=Strict cookie; the server stores only its SHA-256 digest with an eight-hour expiry. The `/api/v1/operations/sites` data route checks the active session. Failed login attempts are rate-limited per local connection address. Sessions are process-memory only and disappear when the server restarts. Use an established identity provider and durable session/security controls before real deployment.

Apify is an optional server-side connector configured with `APIFY_API_TOKEN`, `APIFY_ACTOR_ID`, and `APIFY_ACTOR_INPUT_JSON`. Staff can explicitly start the configured Actor from Operations. The connector caps output at 1–100 items (25 by default), sets a $1 maximum charge per run by default (configurable), keeps the API token server-side, and stages the latest three results in `data/demo.json` with `pending-review` status. Staged output is not published to site listings or used by booking logic.

## Production target

Use a Node.js modular monolith; do not add a Java/Spring Boot backend. Package domains for sites, discovery, availability, bookings, passes/check-in, queue/visits, assistance, facilities/waste, feedback, notifications and audit. Keep HTTP handlers thin, validate requests at the API boundary, and put business rules in services with a repository layer. Use PostgreSQL transactions and a slot-row lock or atomic conditional update for competing reservations. Persist hashed recovery credentials, expiring/revocable signed pass payloads, unique idempotency keys, and append-only check-in/audit events. Authenticate staff roles and expose operations endpoints separately from the public API. Add rate limiting and contact verification for recovery.

PostGIS supports nearby-site discovery and spatial indexes. Redis should be added only for a defined cache or ephemeral workload. SSE can publish queue snapshots with timestamp, source and clear stale-data state. Keep map/routing integrations behind configuration and interfaces. Treat any simulated queue or facility detail as demo data until integrated with an authorised source.

## Nearby discovery and site status (implemented)

- **Location stays in the browser.** Explore requests geolocation once, only after the visitor taps **Use my location**. The client computes haversine distance against the public site list. Coordinates are never sent to the API, logged or persisted. The manual area picker sorts from a demo area centre instead.
- **Site catalogue and provenance.** Public sites come from generated source files in `server/sources/` (today the MCGM Ganeshotsav 2025 list, built by `scripts/import-mcgm.mjs`). Each record has `coordinates {lat, lng, kind: 'official-link', method}` or `null`, and `provenance {authority, sourceUrl, sourceDocument, publishedAt, festivalYear, seasonStatus, verificationStatus: 'PENDING_REVIEW'}`. Store schema v3 re-syncs the catalogue when a source file changes, keeping bookings, staff status posts and any operator-verified or rejected record. Fictional demo site and slot seed definitions live in `server/seeds/*.json`; mutable demo bookings and updates persist in `data/demo.json`. Demo sites (`coordinates.kind: 'synthetic'`) load by default and can be hidden with `DEMO_SITES=false`. Bookings are refused for non-demo sites.
- **Status classification (`server/status-source.js`).** `classifyStatus` returns `live | delayed | demo | unavailable` and releases status, waiting and wait values only with a named source and observation time. Live requires a staff update or `authorised-feed` snapshot ≤5 minutes old; anything without a source/timestamp, from an unknown source kind, future-dated or older than 30 minutes is Unavailable. Public endpoints and the SSE stream send only the classified `statusInfo`, not raw demo fields.
- **Future live source.** `createStatusSource()` is the adapter boundary for an authorised municipal or site-operator feed. No feed is connected; `connected` is always false and `fetchSnapshots()` refuses until a reviewed adapter is implemented. Scraped or imported data (for example Apify output) must never be classified as live.
- **Staff status.** `POST /api/v1/operations/sites/{id}/status` (session required; status Open/Busy/Near capacity/Closed, optional waiting 0–5000 and waitMinutes 0–600) records `statusSource {kind: 'staff-update', observedAt}`. The SSE stream pushes the classified result to visitors.
- **Feature flags (`server/flags.js`).** Official `@flagsmith/nodejs` SDK in local-evaluation mode with a server-side key; fallback values keep existing features on and new ones off. Routes check the session before any flag.
- **Voice (`server/sarvam.js`).** Saaras v4 (translate) and Bulbul v4 Flash over REST, with a daily call budget, per-visitor limits and same-origin checks. Spoken text comes from fixed templates and our own data only.
- **Map.** MapLibre GL JS is vendored under `public/vendor/` and imported dynamically on Explore. The map element is created once and moved between renders; markers are re-synced to the current filters. Tiles come from OpenFreeMap; no API key or billing.

## API in the demo

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/v1/public/sites` | Demo site list with coordinates, provenance and classified `statusInfo`; optional `q` search (name, area, city) |
| GET | `/api/v1/public/sites/{siteId}` | One demo site (same public shape) |
| POST | `/api/v1/public/bookings` | Validated capacity reservation |
| GET | `/api/v1/public/bookings/{reference}?key=…` | Recover a booking with its secret key |
| GET | `/api/v1/public/bookings/{reference}/pass?key=…` | Pass metadata with the booking recovery key (demo payload only) |
| POST | `/api/v1/public/assistance-requests` | Save a request against a booking reference |
| GET | `/api/v1/public/assistance-requests/{reference}` | Request status |
| POST | `/api/v1/public/feedback` | Persist feedback payload |
| GET | `/api/v1/public/live` | Simulated event stream snapshots |
| POST | `/api/v1/public/demo/reset` | Reset local data in demo mode |
| GET | `/api/v1/operations/auth/session` | Report whether the current browser has an operations session |
| POST | `/api/v1/operations/auth/login` | Sign into operations with configured server credentials |
| POST | `/api/v1/operations/auth/logout` | End the current operations session |
| GET | `/api/v1/operations/sites` | Session-protected site list with classified status and source summaries |
| POST | `/api/v1/operations/sites/{siteId}/status` | Session-protected staff status update; requires the `ops_status_updates` flag |
| POST | `/api/v1/operations/checkin` | Session-protected gate scan (QR payload or reference + code); entry → exit → refused; requires `ops_status_updates` |
| GET | `/api/v1/public/features` | Public flag values (nearby discovery, map, voice) |
| POST | `/api/v1/public/voice/search` | Audio → Sarvam speech-to-text → matched area/locality/site; flag, budget, rate and origin limited |
| POST | `/api/v1/public/voice/speak` | Spoken summary of up to 3 listed sites (Sarvam text-to-speech) |
| GET | `/api/v1/health` | Monitoring status for NudgeBee; bearer `OPS_MONITOR_TOKEN` or staff session |
| GET | `/api/v1/operations/apify/status` | Session-protected Apify configuration and latest staged import |
| POST | `/api/v1/operations/apify/run` | Session-protected manual Actor run; stage capped results for review |

This API is a development/demo surface. It does not implement staff authentication or production-ready abuse controls.
