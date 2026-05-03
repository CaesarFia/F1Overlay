# Master State

## Purpose

`masterState.js` defines the single source of truth for all data in the F1 overlay. It is a plain JavaScript object with a merge function. The main thread reads from it; the worker posts patches to it. No framework, no reactivity, no Proxy — just a flat object that is fast to read from inside the RAF loop.

---

## Files to Create

- `src/state/masterState.js`

---

## Design Rules

1. **One object, never replaced.** The `masterState` export is always the same object reference. Renderers may cache `masterState.drivers[1]` as a reference; wholesale replacement would break those references.

2. **Keyed by `driver_number` as a string.** Example: `masterState.drivers["1"]`, `masterState.drivers["44"]`. Use strings consistently (JSON keys are strings; OpenF1 returns `driver_number` as an integer, so normalize to string on write).

3. **Never throw on missing data.** Every field has a safe default. Code reading the state may do `masterState.drivers["1"]?.speed ?? 0` but should not need to.

4. **3D scene fields are write-only from SceneManager.** The `currentT` and `targetT` fields on each driver exist in state for convenience but are written by `DriverDotManager.js`, not by the worker.

---

## Complete Schema

```js
const masterState = {

  // ─────────────────────────────────────────────────────────
  // SESSION BLOCK
  // Written once at startup from /sessions and /meetings
  // ─────────────────────────────────────────────────────────
  session: {
    sessionKey:    null,     // number — OpenF1 session_key
    sessionName:   null,     // string — "Race", "Qualifying", "Sprint", etc.
    sessionType:   null,     // string — "Race", "Qualifying", "Practice", "Sprint"
    meetingKey:    null,     // number
    meetingName:   null,     // string — "Miami Grand Prix"
    circuitKey:    null,     // number — OpenF1 internal circuit ID
    circuitShortName: null,  // string — "Miami" (used to load circuit JSON/GLB)
    country:       null,     // string — "United States"
    location:      null,     // string — "Miami"
    isActive:      false,    // boolean — is session currently live?
    safetyCar:     false,    // boolean — SC deployed
    vsc:           false,    // boolean — VSC deployed
    redFlag:       false,    // boolean — red flag out
    currentLap:    null,     // number — current race lap (null in quali/practice)
    totalLaps:     null,     // number — total scheduled race laps (null if unknown)
  },

  // ─────────────────────────────────────────────────────────
  // WEATHER BLOCK
  // Written from /weather every 60 seconds
  // ─────────────────────────────────────────────────────────
  weather: {
    trackTemp:     null,     // number — °C
    airTemp:       null,     // number — °C
    humidity:      null,     // number — %
    windSpeed:     null,     // number — m/s
    windDirection: null,     // number — degrees (0 = North)
    rainfall:      false,    // boolean
    updatedAt:     null,     // ISO string — timestamp of last weather sample
  },

  // ─────────────────────────────────────────────────────────
  // RACE CONTROL BLOCK
  // Written from /race_control every 3 seconds
  // ─────────────────────────────────────────────────────────
  raceControl: {
    messages:      [],       // array of message objects (see below)
    lastUpdatedAt: null,     // ISO string
  },
  // Each message object:
  // {
  //   date:         ISO string,
  //   lapNumber:    number | null,
  //   category:     "Flag" | "SafetyCar" | "Drs" | "Other",
  //   flag:         "GREEN" | "YELLOW" | "DOUBLE YELLOW" | "RED" | "CHEQUERED" | null,
  //   scope:        "Track" | "Sector" | "Driver" | null,
  //   sector:       1 | 2 | 3 | null,
  //   driverNumber: string | null,
  //   message:      string,
  // }

  // ─────────────────────────────────────────────────────────
  // DRIVERS BLOCK
  // Keyed by driver_number (string)
  // ─────────────────────────────────────────────────────────
  drivers: {
    // Each key is a driver_number string, e.g. "1", "44", "16"
    // Value shape is the driverEntry object (see below)
  },
};
```

### Driver Entry Schema

Each `masterState.drivers[driverNumber]` must match this shape:

```js
{
  // ── Static (from /drivers, written once at startup) ──────
  driverNumber:    null,     // string — "1"
  fullName:        null,     // string — "Max Verstappen"
  abbreviation:    null,     // string — "VER"
  teamName:        null,     // string — "Red Bull Racing"
  teamColor:       null,     // string — "#3671C6" (# prefix included)
  countryCode:     null,     // string — "NED"

  // ── Race position (from /position) ───────────────────────
  position:        null,     // number — 1–20
  gapToLeader:     null,     // string — "+1.234" or "+1 LAP" or "0.000"
  interval:        null,     // string — gap to car directly ahead

  // ── Track location (from /location) ──────────────────────
  locationX:       null,     // number — OpenF1 X coordinate (meters)
  locationY:       null,     // number — OpenF1 Y coordinate (meters)
  locationZ:       null,     // number — OpenF1 Z coordinate (elevation)
  locationDate:    null,     // ISO string — timestamp of last location sample

  // ── Live telemetry (from /car_data) ──────────────────────
  speed:           null,     // number — km/h
  throttle:        null,     // number — 0–100
  brake:           null,     // number — 0 or 1 (binary)
  drs:             null,     // number — raw DRS code (10/12/14 = active)
  drsActive:       false,    // boolean — derived: drs >= 10
  gear:            null,     // number — 0 (neutral) to 8
  rpm:             null,     // number

  // ── Lap data (from /laps) ─────────────────────────────────
  currentLap:      null,     // number — current lap number
  lastLapTime:     null,     // number — seconds (null if no completed lap)
  bestLapTime:     null,     // number — session personal best in seconds
  sector1:         null,     // number — seconds
  sector2:         null,     // number — seconds
  sector3:         null,     // number — seconds
  miniSectors1:    [],       // array of integers
  miniSectors2:    [],       // array of integers
  miniSectors3:    [],       // array of integers
  speedTrapI1:     null,     // number — km/h
  speedTrapI2:     null,     // number — km/h
  speedTrapST:     null,     // number — km/h
  isPitOutLap:     false,    // boolean

  // ── Stint data (from /stints) ─────────────────────────────
  currentStint: {
    stintNumber:   null,     // number
    compound:      null,     // "SOFT" | "MEDIUM" | "HARD" | "INTERMEDIATE" | "WET"
    tireAge:       null,     // number — laps on current set
    lapStart:      null,     // number — lap stint began
  },
  stintHistory:    [],       // array of completed stint objects (same shape as currentStint)

  // ── Pit data (from /pit) ──────────────────────────────────
  pitCount:        0,        // number
  pitHistory:      [],       // array of { lapNumber, pitDuration, date }

  // ── Derived calculations (computed in worker) ─────────────
  tireDegradationRate:   null,   // number — seconds per lap (positive = slower)
  fuelCorrectedLapTime:  null,   // number — seconds
  gapTrend:              'STABLE', // "CLOSING" | "STABLE" | "FALLING"
  gapHistory:            [],       // array of numbers — last 10 gapToLeader values (numeric)
  undercutViable:        false,    // boolean
  undercutWindowSeconds: null,     // number — estimated time advantage from undercutting
  crossoverLap:          null,     // number — estimated lap number to pit
  scPitWindowValue:      null,     // number — seconds gained by pitting under SC
  vscPitWindowValue:     null,     // number — seconds gained by pitting under VSC

  // ── 3D scene state (written by DriverDotManager, not the worker) ──
  currentT:        0,        // number — current spline parameter [0.0–1.0]
  targetT:         0,        // number — target spline parameter [0.0–1.0]
  isOnPitLane:     false,    // boolean — driver is in pit lane (hide from track spline)
}
```

---

## masterState.js Implementation

### Exports Required

```js
export const masterState = { session: {...}, weather: {...}, raceControl: {...}, drivers: {} };

export function applyPatch(patch) { ... }

export function ensureDriver(driverNumber) { ... }

export function resetState() { ... }
```

### `applyPatch(patch)`

Merges a patch object into `masterState`. The patch has the same shape as `masterState` but only includes fields that changed.

Rules:
- Top-level blocks (`session`, `weather`, `raceControl`) merge shallowly: `Object.assign(masterState.session, patch.session)`
- `drivers` merges per-driver: for each `driverNumber` in `patch.drivers`, do `Object.assign(masterState.drivers[driverNumber], patch.drivers[driverNumber])`
- `raceControl.messages` is **appended**, not replaced: `masterState.raceControl.messages.push(...patch.raceControl.messages)`
- `stintHistory` and `pitHistory` are **appended** when new entries are detected
- Never replace `currentT` or `targetT` via applyPatch — those are scene-managed

Example patch from the worker:
```js
{
  drivers: {
    "1": { speed: 312, throttle: 98, brake: 0, gear: 7, rpm: 12400 },
    "44": { speed: 308, throttle: 95, brake: 0, gear: 7, rpm: 12200 },
  }
}
```

### `ensureDriver(driverNumber)`

Called before writing to a driver that may not yet exist in `masterState.drivers`. Creates the entry with all default values if it doesn't exist.

```js
export function ensureDriver(driverNumber) {
  const key = String(driverNumber);
  if (!masterState.drivers[key]) {
    masterState.drivers[key] = createDefaultDriverEntry(key);
  }
  return masterState.drivers[key];
}
```

### `resetState()`

Resets the entire masterState to defaults (called when a new session starts). Does not reset `currentT`/`targetT` — the scene manager resets those separately.

---

## Reading State

Any module on the main thread reads state directly:

```js
import { masterState } from '../state/masterState.js';

// In the RAF loop:
const driver = masterState.drivers["1"];
if (driver) {
  speedBar.style.transform = `scaleX(${driver.speed / 350})`;
}
```

No event system, no subscription, no Proxy. State reads are synchronous and direct.
