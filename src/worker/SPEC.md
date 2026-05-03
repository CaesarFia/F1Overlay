# Polling Worker

## Purpose

`poller.worker.js` is a Web Worker that owns all network I/O for the F1 overlay. It polls every OpenF1 endpoint on a staggered schedule, runs derived calculations on the raw data, and posts state patches to the main thread. The main thread never fetches data directly.

---

## Files to Create

- `src/worker/poller.worker.js`

---

## Why a Web Worker

Fetching and data processing happen off the main thread. If the OpenF1 API is slow (which it can be), the poll does not block the RAF loop or cause jank in the 3D scene. The worker is completely isolated — it cannot touch the DOM, Three.js, or PixiJS.

---

## Worker Initialization

Spawn the worker from `main.js`:

```js
const worker = new Worker(
  new URL('./worker/poller.worker.js', import.meta.url),
  { type: 'module' }
);

worker.addEventListener('message', (event) => {
  const { type, patch } = event.data;
  if (type === 'STATE_PATCH') {
    applyPatch(patch);
  }
  if (type === 'SESSION_READY') {
    // Circuit key is now available; trigger GLB load
    onSessionReady(event.data.circuitShortName);
  }
});
```

---

## Message Protocol

### Worker → Main Thread

#### `STATE_PATCH`
Posted whenever new data arrives and produces a changed field.
```js
postMessage({
  type: 'STATE_PATCH',
  patch: {
    // Same shape as masterState, only changed fields
    drivers: {
      "1": { speed: 312, throttle: 98 }
    }
  }
});
```

#### `SESSION_READY`
Posted once after startup endpoints (`/sessions`, `/meetings`, `/drivers`) have all loaded.
```js
postMessage({
  type: 'SESSION_READY',
  circuitShortName: 'miami',  // lowercase, matches circuits/ folder name
  sessionType: 'Race',
  driverCount: 20,
});
```

#### `ERROR`
Posted if a critical startup endpoint fails after 3 retries.
```js
postMessage({ type: 'ERROR', message: 'Failed to load session data' });
```

### Main Thread → Worker

#### `START`
Sent by main.js to begin polling after the scene is ready.
```js
worker.postMessage({ type: 'START' });
```

#### `STOP`
Sent to pause all polling (e.g., when OBS hides the source).
```js
worker.postMessage({ type: 'STOP' });
```

The worker must listen for these via `self.addEventListener('message', ...)`.

---

## Poll Schedule

| Endpoint | Interval | Stagger Offset | Notes |
|---|---|---|---|
| `/location` | 1500ms | 0ms | Driver track positions for 3D tracker |
| `/position` | 2000ms | 150ms | Race order, gaps, intervals |
| `/car_data` | 2000ms | 300ms | Speed, throttle, brake, DRS, gear, RPM |
| `/race_control` | 3000ms | 450ms | Flags, SC messages |
| `/pit` | 10000ms | 600ms | Pit stop records |
| `/laps` | 15000ms | 800ms | Lap times, sectors, mini sectors |
| `/stints` | 15000ms | 1000ms | Tire compound and age |
| `/weather` | 60000ms | 1200ms | Track/air temp, wind, rain |

Startup (one-time, no interval):
- `/sessions` — on worker start, before `START` message
- `/meetings` — on worker start, before `START` message
- `/drivers` — on worker start, before `START` message

All one-time fetches run in parallel (`Promise.all`). Post `SESSION_READY` after all three complete.

---

## Stagger Implementation

Do not use a naive `setInterval` for every endpoint simultaneously. Use `setTimeout` to offset when each interval first fires:

```js
function startPolling() {
  Object.entries(POLL_INTERVALS).forEach(([key, interval]) => {
    const offset = POLL_STAGGER[key] ?? 0;
    setTimeout(() => {
      pollOnce(key);  // fire immediately at offset
      setInterval(() => pollOnce(key), interval);
    }, offset);
  });
}
```

This ensures at most 1–2 requests overlap at any point in time, well under the 3 req/sec limit.

---

## State Tracking Inside the Worker

The worker maintains its own internal state to support deduplication and derived calculations. This is NOT the master state — it is private to the worker:

```js
// Worker-internal state
const workerState = {
  lastPollTimestamp: {
    location: null,
    position: null,
    carData: null,
    laps: null,
    stints: null,
    pit: null,
    raceControl: null,
    weather: null,
  },

  // Per-driver lap history for tire degradation
  lapHistory: {},       // { [driverNumber]: [{ lap, lapTime, stintAge }] }

  // Per-driver gap history for gap trend
  gapHistory: {},       // { [driverNumber]: number[] } last 10 numeric gaps

  // Session best lap time per lap (for track evolution)
  sessionBestPerLap: [],  // [lapNumber]: bestLapTimeInSeconds

  // Latest state snapshot per driver (for diffing)
  driverSnapshot: {},   // { [driverNumber]: {...latestFieldValues} }
};
```

---

## Data Processing Per Endpoint

### `/location` → driver location fields

For each entry in the response array:
1. Take only the most recent entry per `driver_number` (sort by `date` desc, dedupe)
2. Patch: `drivers[driverNumber].locationX`, `.locationY`, `.locationZ`, `.locationDate`
3. Also compute `targetT` by calling the coordinate transform (see `src/scene/SPEC.md` for the formula). Post `targetT` in the patch.

Note: The coordinate transform requires the circuit bounds from the circuit JSON. The worker must have access to this data. When the main thread sends a `START` message, it should include the circuit data:

```js
worker.postMessage({ type: 'START', circuitData: circuitJson });
```

The worker stores `circuitData` internally and uses it for every `/location` poll.

### `/position` → race position fields

For each entry:
1. Deduplicate: only process entries newer than `lastPollTimestamp.position`
2. Take the most recent per `driver_number`
3. Patch: `position`, `gapToLeader`, `interval`
4. Update `workerState.gapHistory[driverNumber]` (numeric parse of gapToLeader)
5. Compute `gapTrend` (see `src/derived/SPEC.md`) and include in patch

### `/car_data` → telemetry fields

For each entry:
1. Take the most recent per `driver_number`
2. Patch: `speed`, `throttle`, `brake`, `gear`, `rpm`, `drs`, `drsActive`
3. `drsActive = drs >= 10`

### `/race_control` → race control messages + SC/VSC flags

1. Filter to new entries since last poll
2. Append to `raceControl.messages`
3. Scan new messages for SC/VSC status changes:
   - `session.safetyCar = true` when message contains "SAFETY CAR DEPLOYED"
   - `session.safetyCar = false` when message contains "SAFETY CAR IN THIS LAP" or "SAFETY CAR ENDING"
   - `session.vsc = true` when message contains "VIRTUAL SAFETY CAR DEPLOYED"
   - `session.vsc = false` when message contains "VIRTUAL SAFETY CAR ENDING"
   - `session.redFlag = true` when `flag == "RED"`
   - `session.redFlag = false` when `flag == "GREEN"` after a red flag
4. Scan for DRS zone enabled/disabled status if desired

### `/laps` → lap timing fields + derived calculations

1. Filter to new entries
2. For each completed lap (`lap_duration` is not null):
   - Patch: `currentLap`, `lastLapTime`, sector times, mini sectors, speed traps, `isPitOutLap`
   - Update `bestLapTime` if this lap is faster than the current personal best
   - Append to `workerState.lapHistory[driverNumber]`
   - Update `workerState.sessionBestPerLap[lapNumber]`
   - Run `computeTireDegradation(driverNumber)` → patch `tireDegradationRate`
   - Run `computeFuelCorrectedLapTime(driverNumber, lapNumber)` → patch `fuelCorrectedLapTime`
   - Run `computeCrossoverLap(driverNumber)` → patch `crossoverLap`
   - Run `computeUndercutWindow(driverNumber)` → patch `undercutViable`, `undercutWindowSeconds`

### `/stints` → stint data

1. Group entries by `driver_number`, find the latest stint (highest `stint_number`)
2. For each driver: compute `currentStint` object and update `stintHistory`
3. Compute tire age: `currentStint.tireAge = currentLap - lapStart + tyre_age_at_start`
4. Run `computeScPitWindow(driverNumber)` if SC/VSC is active → patch `scPitWindowValue`, `vscPitWindowValue`

### `/pit` → pit history

1. Filter to new entries
2. Append to `pitHistory`, increment `pitCount`

### `/weather` → weather block

1. Take the most recent entry
2. Patch the entire `weather` block

---

## Diff Before Posting

Before calling `postMessage`, diff the new values against `workerState.driverSnapshot[driverNumber]`. Only include fields that have actually changed in the patch. This prevents triggering re-renders when nothing changed.

```js
function diffDriver(driverNumber, newValues) {
  const snapshot = workerState.driverSnapshot[driverNumber] ?? {};
  const diff = {};
  for (const [key, value] of Object.entries(newValues)) {
    if (snapshot[key] !== value) {
      diff[key] = value;
    }
  }
  // Update snapshot
  Object.assign(workerState.driverSnapshot[driverNumber] ??= {}, newValues);
  return diff;
}
```

Only post the patch if `Object.keys(patch.drivers).length > 0` (at least one driver has a change).

---

## Startup Sequence (Worker Side)

```
1. self.addEventListener('message') to wait for { type: 'START', circuitData }
2. In parallel, fetch /sessions, /meetings, /drivers
3. Process startup data:
   - Normalize driver_number keys to strings
   - Build initial drivers patch with all static fields
   - Determine circuitShortName from session.circuit_short_name (lowercase, spaces → hyphens)
4. Post { type: 'SESSION_READY', circuitShortName, ... }
5. Post initial STATE_PATCH with all driver static data
6. On receiving { type: 'START' } confirmation (or immediately proceed):
7. Call startPolling() to begin the staggered interval schedule
```

---

## Error Handling

- Failed fetches return `null` from the API wrapper. Log a warning and skip that poll cycle — do not crash the worker.
- If startup endpoints fail 3 times in a row, post `{ type: 'ERROR', message }`.
- If the session changes mid-stream (different `session_key` returned), post `{ type: 'SESSION_CHANGED' }` and restart the poll cycle.
