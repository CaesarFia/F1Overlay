# Polling Worker

## Purpose

`poller.worker.js` is a Web Worker that owns all network I/O for the F1 overlay. It supports two modes controlled by a single constant. In historical mode it polls REST endpoints against a past session. In live mode it authenticates via OAuth2, opens an MQTT WebSocket connection for push-based location data, and uses authenticated REST for all other endpoints. Both modes post identical `STATE_PATCH` messages to the main thread — the rest of the codebase never knows which mode is active.

---

## Files to Create

- `src/worker/poller.worker.js`

---

## The Mode Switch

**This is the only thing that changes between development and production:**

```js
// src/worker/poller.worker.js — line 1
const LIVE_MODE = false;
// Set to true when streaming live with an active OpenF1 paid subscription.
// Set to false for development and testing against historical data.
```

All branching based on this constant must be contained within `poller.worker.js` and the `src/api/` modules. No other file in the codebase may import or check `LIVE_MODE`.

---

## Worker Initialization

Spawn from `main.js`:

```js
const worker = new Worker(
  new URL('./worker/poller.worker.js', import.meta.url),
  { type: 'module' }
);

worker.addEventListener('message', (event) => {
  const { type, patch, circuitShortName } = event.data;
  if (type === 'STATE_PATCH') applyPatch(patch);
  if (type === 'SESSION_READY') onSessionReady(circuitShortName);
  if (type === 'ERROR') console.error('[Worker]', event.data.message);
});
```

---

## Message Protocol

### Worker → Main Thread

#### `STATE_PATCH`
Posted whenever new data produces a changed field.
```js
postMessage({
  type: 'STATE_PATCH',
  patch: {
    drivers: { "1": { speed: 312, throttle: 98 } },
  }
});
```

#### `SESSION_READY`
Posted once after startup endpoints load.
```js
postMessage({
  type: 'SESSION_READY',
  circuitShortName: 'miami',
  sessionType: 'Race',
  driverCount: 20,
});
```

#### `ERROR`
Posted for unrecoverable startup failures.
```js
postMessage({ type: 'ERROR', message: 'string' });
```

### Main Thread → Worker

#### `START`
Sent after the scene is ready. Includes `circuitData` because the worker needs the circuit bounds to compute `targetT` values from raw OpenF1 coordinates.
```js
worker.postMessage({ type: 'START', circuitData: circuitJson });
```

#### `STOP`
Sent to pause all activity (OBS source hidden).
```js
worker.postMessage({ type: 'STOP' });
```

The worker listens via `self.addEventListener('message', ...)`.

---

## Worker-Internal State

Private to the worker — never sent to the main thread directly:

```js
const workerState = {
  circuitData: null,        // set from START message; needed for coordinate transform
  accessToken: null,        // OAuth2 token (live mode only)
  tokenExpiresAt: 0,

  lastPollTimestamp: {      // ISO string per endpoint — for REST deduplication
    location: null,
    position: null,
    carData: null,
    laps: null,
    stints: null,
    pit: null,
    raceControl: null,
    weather: null,
  },

  lapHistory: {},           // { [driverNumber]: [{ lap, lapTime, stintLap }] }
  gapHistory: {},           // { [driverNumber]: number[] }  last 10 numeric gaps
  sessionBestPerLap: [],    // [lapNumber]: bestLapTimeSeconds

  mqttLatestById: {},       // { [_key]: { _id } } — for WebSocket deduplication
  driverSnapshot: {},       // { [driverNumber]: fieldValues } — for REST diff
};
```

---

## Startup Sequence (Worker Side)

```
self.onmessage = async ({ data }) => {
  if (data.type !== 'START') return;
  workerState.circuitData = data.circuitData;
  await init();
};

async function init() {
  // 1. Authenticate if LIVE_MODE
  if (LIVE_MODE) {
    const email    = import.meta.env.VITE_OPENF1_EMAIL;
    const password = import.meta.env.VITE_OPENF1_PASSWORD;
    if (!email || !password) {
      self.postMessage({ type: 'ERROR', message: 'Missing credentials in .env' });
      return;
    }
    workerState.accessToken = await fetchAccessTokenWithRetry(email, password);
    if (!workerState.accessToken) {
      self.postMessage({ type: 'ERROR', message: 'Authentication failed' });
      return;
    }
  }

  // 2. Fetch startup endpoints (parallel)
  const opts = { liveMode: LIVE_MODE, accessToken: workerState.accessToken };
  const [sessions, meetings, drivers] = await Promise.all([
    fetchSessions(opts),
    fetchMeetings(opts),
    fetchDrivers(opts),
  ]);

  if (!sessions || !meetings || !drivers) {
    self.postMessage({ type: 'ERROR', message: 'Failed to load session data' });
    return;
  }

  // 3. Build initial patch
  const patch = buildStartupPatch(sessions, meetings, drivers);
  self.postMessage({ type: 'STATE_PATCH', patch });

  // 4. Notify main thread
  const circuitShortName = normalizeCircuitKey(sessions[0]?.circuit_short_name);
  self.postMessage({ type: 'SESSION_READY', circuitShortName, sessionType: sessions[0]?.session_type });

  // 5. Start data stream
  if (LIVE_MODE) {
    startLiveMode();
  } else {
    startHistoricalMode();
  }
}
```

---

## Historical Mode (`LIVE_MODE = false`)

Uses staggered REST polling. Every endpoint including `/location` is polled at the intervals defined in `endpoints.js`. Uses the `VITE_OPENF1_DEV_SESSION_KEY` value as the `session_key` parameter on all requests — no auth headers.

```js
function startHistoricalMode() {
  Object.entries(POLL_INTERVALS).forEach(([key, interval]) => {
    const offset = POLL_STAGGER[key] ?? 0;
    setTimeout(() => {
      pollOnce(key);
      setInterval(() => pollOnce(key), interval);
    }, offset);
  });
}

async function pollOnce(endpointKey) {
  const opts = { liveMode: false, accessToken: null };
  let data;
  switch (endpointKey) {
    case 'location':    data = await fetchLocation(opts);    break;
    case 'position':    data = await fetchPosition(opts);    break;
    case 'carData':     data = await fetchCarData(opts);     break;
    case 'raceControl': data = await fetchRaceControl(opts); break;
    case 'pit':         data = await fetchPit(opts);         break;
    case 'laps':        data = await fetchLaps(opts);        break;
    case 'stints':      data = await fetchStints(opts);      break;
    case 'weather':     data = await fetchWeather(opts);     break;
  }
  if (data) processEndpointData(endpointKey, data);
}
```

---

## Live Mode (`LIVE_MODE = true`)

Location data arrives via MQTT push. All other endpoints use authenticated REST polling on the same schedule as historical mode (minus `/location`).

```js
function startLiveMode() {
  // 1. Open MQTT WebSocket for location push
  const mqttClient = new MqttClient((topic, data) => {
    if (topic === TOPICS.location) processLocationMessage(data);
    // Add handlers for other topics here as they are confirmed
  });
  mqttClient.connect(workerState.accessToken);

  // 2. REST polling for all other endpoints (no location)
  Object.entries(POLL_INTERVALS)
    .filter(([key]) => key !== 'location')
    .forEach(([key, interval]) => {
      const offset = POLL_STAGGER[key] ?? 0;
      setTimeout(() => {
        pollOnce(key);
        setInterval(() => pollOnce(key), interval);
      }, offset);
    });

  // 3. Schedule token refresh (check every 5 minutes)
  setInterval(async () => {
    const email    = import.meta.env.VITE_OPENF1_EMAIL;
    const password = import.meta.env.VITE_OPENF1_PASSWORD;
    const newToken = await getAccessToken(email, password);
    if (newToken !== workerState.accessToken) {
      workerState.accessToken = newToken;
      mqttClient.reconnectWithToken(newToken);
    }
  }, 5 * 60 * 1000);
}
```

---

## Location Message Processing

Both modes ultimately call `processLocationMessage` — the logic is identical.

For REST mode (historical), the polling function calls it after fetching. For live mode, the MQTT callback calls it directly.

```js
function processLocationMessage(rawData) {
  // rawData may be a single object (WebSocket) or an array entry (REST)
  // Normalize to single object:
  const entry = Array.isArray(rawData) ? rawData[0] : rawData;

  // WebSocket deduplication via _id / _key
  if (entry._key !== undefined) {
    const existing = workerState.mqttLatestById[entry._key];
    if (existing && existing._id >= entry._id) return;  // stale, skip
    workerState.mqttLatestById[entry._key] = { _id: entry._id };
  }

  const driverNumber = String(entry.driver_number);
  const { x: openF1X, y: openF1Y } = entry;

  // Compute targetT from OpenF1 coordinates
  // CoordinateTransform logic is duplicated here (worker can't import from scene/)
  const targetT = computeTargetT(openF1X, openF1Y, workerState.circuitData);
  if (targetT === null) return;

  const patch = {
    drivers: {
      [driverNumber]: {
        locationX: openF1X,
        locationY: openF1Y,
        locationZ: entry.z ?? null,
        locationDate: entry.date ?? new Date().toISOString(),
        targetT,
      }
    }
  };
  self.postMessage({ type: 'STATE_PATCH', patch });
}
```

### Coordinate Transform in the Worker

The worker needs `computeTargetT`. This logic is also in `src/scene/CoordinateTransform.js` for main-thread use. To avoid a cross-module dependency between worker and scene, **duplicate the two pure math functions** in the worker file:

```js
function computeTargetT(openF1X, openF1Y, circuitData) {
  if (!circuitData) return null;
  const { openF1Bounds, modelBounds, centerlinePoints } = circuitData;

  const normX = (openF1X - openF1Bounds.minX) / (openF1Bounds.maxX - openF1Bounds.minX);
  const normY = (openF1Y - openF1Bounds.minY) / (openF1Bounds.maxY - openF1Bounds.minY);
  const modelX = modelBounds.minX + normX * (modelBounds.maxX - modelBounds.minX);
  const modelZ = modelBounds.minZ + normY * (modelBounds.maxZ - modelBounds.minZ);

  // Sample the centerline to find closest point
  // No Three.js in the worker — use raw point array from JSON
  let closestT = 0;
  let closestDist = Infinity;
  const count = centerlinePoints.length;

  for (let i = 0; i < count; i++) {
    const p = centerlinePoints[i];
    const dist = Math.sqrt((p.x - modelX) ** 2 + (p.z - modelZ) ** 2);
    if (dist < closestDist) {
      closestDist = dist;
      closestT = i / count;
    }
  }
  return closestT;
}
```

This is a linear scan over the ~100 centerline points from the JSON — not the full 600-sample CatmullRomCurve3 sampled by the main thread. It is less precise but fast and Three.js-free. The main thread's DriverDotManager will re-snap to the spline surface anyway via its own coordinate transform. This gives a good enough `targetT` for the lerp — the dot won't be perfectly on the curve until the main thread takes over, but it will be close.

---

## Data Processing Per Endpoint

### `/position`
1. Take the most recent entry per `driver_number` (sort by `date` desc, dedupe)
2. Parse `gap_to_leader` to a number: strip `+`, skip if contains "LAP"
3. Update `workerState.gapHistory[driverNumber]` (push numeric gap, keep last 10)
4. Compute `gapTrend` via `computeGapTrend(workerState.gapHistory[driverNumber])`
5. Patch: `position`, `gapToLeader`, `interval`, `gapTrend`, `gapHistory`

### `/car_data`
1. Take the most recent entry per `driver_number`
2. Patch: `speed`, `throttle`, `brake`, `gear`, `rpm`, `drs`, `drsActive`
3. `drsActive = entry.drs >= 10`

### `/laps`
1. Filter to entries newer than `lastPollTimestamp.laps`
2. For each completed lap (`lap_duration != null`):
   - Update `bestLapTime` if this lap is faster
   - Append to `workerState.lapHistory[driverNumber]`
   - Update `workerState.sessionBestPerLap`
   - Run `computeTireDegradation`, `computeFuelCorrectedLapTime`, `computeCrossoverLap`, `computeUndercutWindow`
3. Patch: lap time fields, mini sectors, speed traps, all derived fields

### `/stints`
1. Group by `driver_number`, find highest `stint_number` = current stint
2. Compute `tireAge = currentLap - lap_start + tyre_age_at_start`
3. Run `computeScPitWindow` if SC/VSC flags are set in state
4. Patch: `currentStint`, append to `stintHistory` for completed stints

### `/pit`
1. Filter to new entries
2. Patch: append to `pitHistory`, increment `pitCount`

### `/race_control`
1. Filter to new entries
2. Scan for SC/VSC keywords in `message`:
   - "SAFETY CAR DEPLOYED" → `session.safetyCar = true`
   - "SAFETY CAR IN THIS LAP" or "SAFETY CAR ENDING" → `session.safetyCar = false`
   - "VIRTUAL SAFETY CAR DEPLOYED" → `session.vsc = true`
   - "VIRTUAL SAFETY CAR ENDING" → `session.vsc = false`
   - `flag == "RED"` → `session.redFlag = true`
   - `flag == "GREEN"` (after red) → `session.redFlag = false`
3. Patch: append to `raceControl.messages`, update `session` SC/VSC/redFlag flags

### `/weather`
1. Take the single most recent entry
2. Patch: entire `weather` block

---

## Diff Before Posting

Before calling `postMessage`, diff the outgoing driver fields against `workerState.driverSnapshot`:

```js
function buildDriverPatch(driverNumber, newValues) {
  const key = String(driverNumber);
  const snap = workerState.driverSnapshot[key] ??= {};
  const diff = {};
  for (const [k, v] of Object.entries(newValues)) {
    if (snap[k] !== v) diff[k] = v;
  }
  Object.assign(snap, newValues);
  return Object.keys(diff).length > 0 ? diff : null;
}
```

Only include a driver in the patch if `buildDriverPatch` returns non-null.
Only `postMessage` if the patch has at least one changed driver.

---

## Poll Schedule Summary

| Endpoint | Historical Mode | Live Mode | Interval |
|---|---|---|---|
| `/location` | REST poll | MQTT push | 1500ms / instant push |
| `/position` | REST poll | REST poll (authed) | 2000ms |
| `/car_data` | REST poll | REST poll (authed) | 2000ms |
| `/race_control` | REST poll | REST poll (authed) | 3000ms |
| `/pit` | REST poll | REST poll (authed) | 10000ms |
| `/laps` | REST poll | REST poll (authed) | 15000ms |
| `/stints` | REST poll | REST poll (authed) | 15000ms |
| `/weather` | REST poll | REST poll (authed) | 60000ms |
| `/sessions` | Once at startup | Once at startup | — |
| `/meetings` | Once at startup | Once at startup | — |
| `/drivers` | Once at startup | Once at startup | — |

---

## Error Handling

- Failed REST fetches return `null` — log a warning, skip the poll cycle
- Failed authentication: post `ERROR` message, stop the worker
- MQTT disconnection: `mqtt.js` auto-reconnects via `reconnectPeriod: 5000`
- Missing `circuitData` on startup: `computeTargetT` returns `null`, skip location patches until `START` message arrives
- If `VITE_OPENF1_EMAIL` is missing in live mode: post `ERROR` and abort immediately — do not spin up REST polling

---

## `circuitShortName` Normalization

OpenF1 returns `circuit_short_name` values like `"Miami"`, `"Abu Dhabi"`, `"São Paulo"`. These must be normalized to match the `circuits/` folder names:

```js
function normalizeCircuitKey(name) {
  if (!name) return 'unknown';
  return name
    .toLowerCase()
    .normalize('NFD')                 // decompose accented characters
    .replace(/[̀-ͯ]/g, '') // strip accent marks → "sao paulo"
    .replace(/\s+/g, '-')            // spaces to hyphens → "sao-paulo"
    .replace(/[^a-z0-9-]/g, '');     // remove any remaining special chars
}
```
