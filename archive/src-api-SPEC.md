# OpenF1 API Layer

## Purpose

Provide the authentication module, REST fetch wrappers, and MQTT WebSocket client used by `poller.worker.js`. All network I/O flows through these modules. The main thread never calls any of these directly.

---

## Files to Create

```
src/api/auth.js          ← OAuth2 token fetch and refresh
src/api/mqttClient.js    ← MQTT-over-WebSocket connection and subscription manager
src/api/openf1.js        ← REST fetch wrappers (authenticated and unauthenticated)
src/api/endpoints.js     ← URL constants, topic constants, poll interval constants
```

---

## API Access Tiers

| Mode | Auth Required | Data Access | How Used |
|---|---|---|---|
| Historical (`LIVE_MODE = false`) | None | Past sessions via `?session_key={key}` | Development and testing |
| Live (`LIVE_MODE = true`) | OAuth2 Bearer token | Current session via `?session_key=latest` | Production streaming |

Both modes use the same REST endpoint paths. The difference is:
1. Whether an `Authorization: Bearer {token}` header is included
2. Whether `session_key=latest` or a pinned historical key is used
3. Whether `/location` data arrives via WebSocket push or REST poll

---

## src/api/endpoints.js

```js
export const BASE_URL    = 'https://api.openf1.org/v1';
export const TOKEN_URL   = 'https://api.openf1.org/token';
export const MQTT_URL    = 'wss://mqtt.openf1.org:8084/mqtt';

// MQTT topic subscriptions (live mode only)
export const TOPICS = {
  location: 'v1/location',
  // Additional topics likely follow the same pattern (v1/position, v1/car_data, etc.)
  // but only v1/location has been confirmed — add others as verified
};

export const ENDPOINTS = {
  sessions:    '/sessions',
  meetings:    '/meetings',
  drivers:     '/drivers',
  location:    '/location',   // REST fallback (historical mode)
  position:    '/position',
  carData:     '/car_data',
  laps:        '/laps',
  stints:      '/stints',
  pit:         '/pit',
  weather:     '/weather',
  raceControl: '/race_control',
};

// Polling intervals (ms) — used in historical mode for all endpoints,
// and in live mode for all endpoints EXCEPT /location (which is WebSocket)
export const POLL_INTERVALS = {
  location:    1500,    // historical mode only; live mode uses WebSocket
  position:    2000,
  carData:     2000,
  raceControl: 3000,
  pit:         10000,
  laps:        15000,
  stints:      15000,
  weather:     60000,
};

// Startup delay offset per endpoint to prevent simultaneous requests
export const POLL_STAGGER = {
  location:    0,
  position:    150,
  carData:     300,
  raceControl: 450,
  pit:         600,
  laps:        800,
  stints:      1000,
  weather:     1200,
};
```

---

## src/api/auth.js

Handles OAuth2 token acquisition and automatic refresh. Runs inside the worker.

### Token Request

```js
export async function fetchAccessToken(email, password) {
  // OpenF1 token endpoint uses OAuth2 Resource Owner Password Credentials grant.
  // If this format fails, verify the exact format at https://openf1.org/docs/authentication
  const body = new URLSearchParams({
    grant_type: 'password',
    username: email,
    password: password,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`[Auth] Token request failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  // Expected response shape:
  // { access_token: string, token_type: "Bearer", expires_in: number (seconds) }
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    // Subtract 60s from expiry so we refresh slightly before it expires
  };
}
```

### Token Manager

```js
let tokenCache = null;

export async function getAccessToken(email, password) {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }
  tokenCache = await fetchAccessToken(email, password);
  return tokenCache.accessToken;
}

export function clearTokenCache() {
  tokenCache = null;
}
```

The worker calls `getAccessToken()` before every authenticated REST request and before opening the MQTT connection. The cache prevents re-fetching on every call; the `expiresAt` check auto-refreshes when the token is near expiry.

---

## src/api/mqttClient.js

Manages the MQTT-over-WebSocket connection for live mode. Runs inside the worker.

### Overview

OpenF1's live WebSocket endpoint uses the MQTT protocol over WebSocket transport on port 8084. The `mqtt` npm package handles the protocol details. The worker imports this module and calls `connect()` once at startup in live mode.

### Implementation

```js
import mqtt from 'mqtt';
import { MQTT_URL, TOPICS } from './endpoints.js';

export class MqttClient {
  constructor(onMessage) {
    // onMessage: (topic, data) => void
    // Called whenever a message arrives on any subscribed topic
    this.onMessage = onMessage;
    this.client = null;
    this.isConnected = false;
  }

  connect(accessToken) {
    this.client = mqtt.connect(MQTT_URL, {
      username: 'openf1',    // any non-empty string is valid
      password: accessToken, // OAuth2 bearer token as MQTT password
      clean: true,
      reconnectPeriod: 5000, // auto-reconnect every 5s if disconnected
      connectTimeout: 10000,
      protocolVersion: 4,    // MQTT 3.1.1
    });

    this.client.on('connect', () => {
      this.isConnected = true;
      console.log('[MQTT] Connected to OpenF1');
      this.subscribeAll();
    });

    this.client.on('message', (topic, payload) => {
      try {
        const data = JSON.parse(payload.toString());
        this.onMessage(topic, data);
      } catch (err) {
        console.warn('[MQTT] Failed to parse message on topic', topic, err.message);
      }
    });

    this.client.on('error', (err) => {
      console.warn('[MQTT] Connection error:', err.message);
    });

    this.client.on('reconnect', () => {
      console.log('[MQTT] Reconnecting...');
    });

    this.client.on('disconnect', () => {
      this.isConnected = false;
    });
  }

  subscribeAll() {
    Object.values(TOPICS).forEach(topic => {
      this.client.subscribe(topic, { qos: 0 }, (err) => {
        if (err) console.warn('[MQTT] Subscribe failed for', topic, err.message);
        else console.log('[MQTT] Subscribed to', topic);
      });
    });
  }

  reconnectWithToken(newToken) {
    // Called when the OAuth token is refreshed — update MQTT password
    // mqtt.js doesn't support in-flight credential updates, so we reconnect
    if (this.client) {
      this.client.end(true, () => {
        this.connect(newToken);
      });
    }
  }

  disconnect() {
    this.client?.end();
    this.isConnected = false;
  }
}
```

### MQTT Message Format

Messages arriving on `v1/location` are JSON objects with these fields:

```js
{
  driver_number: 1,           // integer — primary key
  x: 1240.5,                  // float — OpenF1 coordinate (meters)
  y: 320.8,                   // float — OpenF1 coordinate (meters)
  z: 12.3,                    // float — elevation (meters)
  session_key: 9185,          // integer — current session

  // Extra fields present only in WebSocket messages (not in REST responses):
  _id: 8473921,               // integer — monotonically increasing, use for chronological ordering
  _key: "loc_1_1714832000",   // string — identifies which data object this updates
                               // Messages with the same _key are updates to the same object;
                               // keep only the one with the highest _id
}
```

### Deduplication Using `_id` and `_key`

Unlike REST responses (deduplicated by timestamp), WebSocket messages use `_id` and `_key`:

```js
// Worker-internal dedup store (per topic):
const latestById = {};  // { [_key]: { _id, data } }

function deduplicateMessage(data) {
  const { _key, _id, ...payload } = data;
  if (!_key) return payload;  // no key = always process
  const existing = latestById[_key];
  if (existing && existing._id >= _id) return null;  // older or duplicate, skip
  latestById[_key] = { _id, data: payload };
  return payload;
}
```

---

## src/api/openf1.js

REST fetch wrappers. Supports both unauthenticated (historical) and authenticated (live) modes.

### Core Fetch Helper

```js
import { BASE_URL, ENDPOINTS } from './endpoints.js';

async function fetchEndpoint(path, params, accessToken = null) {
  const url = new URL(BASE_URL + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const headers = {};
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  try {
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      console.warn(`[OpenF1 REST] ${path} returned ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`[OpenF1 REST] ${path} failed:`, err.message);
    return null;
  }
}
```

### Session Key Helper

```js
// Returns the session_key param based on mode
// In live mode: 'latest'
// In historical mode: the value from VITE_OPENF1_DEV_SESSION_KEY
export function getSessionKeyParam(liveMode) {
  return liveMode ? 'latest' : (import.meta.env.VITE_OPENF1_DEV_SESSION_KEY ?? '9158');
}
```

### Per-Endpoint Exports

Each function accepts `{ liveMode, accessToken }` options:

```js
export async function fetchSessions(opts)    { ... }
export async function fetchMeetings(opts)    { ... }
export async function fetchDrivers(opts)     { ... }
export async function fetchLocation(opts)    { ... }  // REST only — historical mode
export async function fetchPosition(opts)    { ... }
export async function fetchCarData(opts)     { ... }
export async function fetchLaps(opts)        { ... }
export async function fetchStints(opts)      { ... }
export async function fetchPit(opts)         { ... }
export async function fetchWeather(opts)     { ... }
export async function fetchRaceControl(opts) { ... }
```

Example implementation of one endpoint:
```js
export async function fetchPosition({ liveMode, accessToken }) {
  return fetchEndpoint(
    ENDPOINTS.position,
    { session_key: getSessionKeyParam(liveMode) },
    liveMode ? accessToken : null
  );
}
```

The `/location` REST endpoint is only called in historical mode. In live mode, location data arrives via MQTT push, so `fetchLocation` is never called.

---

## Endpoint Reference

All endpoints are `GET https://api.openf1.org/v1/{path}?session_key={key}`.

### Startup (one-time)

#### `/sessions`
```
session_key, session_name, session_type, date_start, date_end,
circuit_key, circuit_short_name, country_name, location, year
```

#### `/meetings`
```
meeting_key, meeting_name, meeting_official_name,
circuit_key, circuit_short_name, location, country_name, year
```

#### `/drivers`
```
driver_number, full_name, name_acronym,
team_name, team_colour (hex WITHOUT #),
country_code, headshot_url
```
Normalize: store `team_colour` as `#${team_colour}` in state.

---

### Live Polling / WebSocket

#### `/location` (REST poll in historical mode; WebSocket `v1/location` in live mode)
```
driver_number, date, x, y, z
WebSocket extras: _id, _key
```
OpenF1 X and Y are horizontal coordinates in meters. Z is elevation. In the coordinate transform, OpenF1 Y maps to Three.js Z (horizontal plane is XZ in Y-up space).

#### `/position` (REST, every 2000ms)
```
driver_number, date, position (1–20),
gap_to_leader (string, e.g. "+1.234" or "+1 LAP"),
interval (string, gap to car directly ahead)
```

#### `/car_data` (REST, every 2000ms)
```
driver_number, date,
speed (km/h), throttle (0–100), brake (0 or 1 — binary),
drs (0–14; 10/12/14 = active), gear (0–8), rpm
```

#### `/race_control` (REST, every 3000ms)
```
date, lap_number, category ("Flag"|"SafetyCar"|"Drs"|"Other"),
flag ("GREEN"|"YELLOW"|"DOUBLE YELLOW"|"RED"|"CHEQUERED"|null),
scope, sector, driver_number, message
```

#### `/pit` (REST, every 10000ms)
```
driver_number, lap_number, pit_duration (total seconds), date
```

#### `/laps` (REST, every 15000ms)
```
driver_number, lap_number, lap_duration,
duration_sector_1/2/3, segments_sector_1/2/3 (mini sector int arrays),
i1_speed, i2_speed, st_speed, is_pit_out_lap, date_start
```
Mini sector codes: `2048`=grey, `2049`=green, `2051`=yellow, `2064`=purple

#### `/stints` (REST, every 15000ms)
```
driver_number, stint_number, lap_start, lap_end,
compound ("SOFT"|"MEDIUM"|"HARD"|"INTERMEDIATE"|"WET"),
tyre_age_at_start
```
Tire age: `currentTireAge = currentLap - lap_start + tyre_age_at_start`

#### `/weather` (REST, every 60000ms)
```
date, air_temperature, track_temperature,
humidity, wind_speed, wind_direction (0–359°), rainfall (0 or 1)
```

---

## Deduplication Strategy (REST)

For endpoints that return full historical arrays on every poll (`/laps`, `/stints`, `/pit`, `/race_control`), filter to only entries newer than the last poll timestamp:

```js
const newEntries = data.filter(entry => entry.date > lastPollTimestamp[endpoint]);
```

Store `lastPollTimestamp` per endpoint in the worker's private state. Update it at the end of each successful poll.

For `/position`, `/car_data`, and `/location` (REST), the response is already the latest sample — take the most recent entry per `driver_number` (sort by `date` descending, then dedupe by `driver_number`).
