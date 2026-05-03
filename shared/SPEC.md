# Shared Modules

## Purpose

The `shared/` folder contains modules imported by every source. They handle data fetching, session-time playback, driver roster management, and (in a future phase) gesture control. No rendering code lives here — each source handles its own rendering.

---

## Module Dependency Order

```
constants.js    ← no dependencies
    ↓
api.js          ← imports constants
    ↓
playback.js     ← imports constants
    ↓
drivers.js      ← imports nothing from shared (pure data store)
    ↓
gestures.js     ← stub, future MediaPipe
```

Each source imports what it needs:
```js
import { MIAMI_SESSION_KEY, LERP_RATE } from '../../shared/constants.js';
import { fetchAllLocationData, calculateBounds } from '../../shared/api.js';
import * as playback from '../../shared/playback.js';
import * as drivers from '../../shared/drivers.js';
```

---

## shared/constants.js

Every configurable value in the project lives here. No other file contains magic numbers.

```js
// ── Session ──────────────────────────────────────────────────────
// Change this to test a different session. Find keys at:
// https://api.openf1.org/v1/sessions
export const MIAMI_SESSION_KEY = 9580;

// ── API ──────────────────────────────────────────────────────────
export const OPENF1_BASE_URL = 'https://api.openf1.org/v1';

// ── Playback ─────────────────────────────────────────────────────
export const DEFAULT_PLAYBACK_SPEED = 1.0;
export const MAX_PLAYBACK_SPEED     = 20.0;
export const MIN_PLAYBACK_SPEED     = 0.1;

// ── Coordinate Transform ─────────────────────────────────────────
export const BOUNDS_MARGIN = 0.05;  // 5% padding added to auto-computed openF1 bounds

// ── Spline ────────────────────────────────────────────────────────
export const SPLINE_TENSION      = 0.5;   // CatmullRomCurve3 tension parameter
export const SPLINE_SAMPLE_COUNT = 600;   // points sampled when finding closest T

// ── Driver Dot Rendering ─────────────────────────────────────────
export const LERP_RATE              = 0.05;  // fraction of T gap closed per frame at 60fps
export const DOT_RADIUS             = 0.12;  // SphereGeometry radius in model units
export const DOT_EMISSIVE_INTENSITY = 2.5;   // high intensity → bloom glow

// ── Raycast Elevation Snap ────────────────────────────────────────
export const CENTERLINE_RAYCAST_OFFSET = 0.05;  // Y lift above surface after snap

// ── Camera ────────────────────────────────────────────────────────
export const CAMERA_FOV               = 50;
export const CAMERA_HEIGHT_MULTIPLIER = 0.9;   // multiply max(size.x, size.z) for camera Y
export const CAMERA_TILT_Z_MULTIPLIER = 0.15;  // multiply size.z for camera Z offset (tilt)

// ── Post-Processing ───────────────────────────────────────────────
export const BLOOM_STRENGTH  = 1.2;
export const BLOOM_RADIUS    = 0.4;
export const BLOOM_THRESHOLD = 0.75;  // only emissive-bright dots bloom, not the dark track

// ── Dev Panel ─────────────────────────────────────────────────────
export const FPS_UPDATE_INTERVAL = 500;  // ms between FPS display refreshes
```

---

## shared/api.js

Batch fetch functions and the bounds calculator. No polling, no auth, no side effects beyond the HTTP request. All functions return sorted arrays or `[]` on failure.

### Internal Helper

```js
async function get(endpoint, params = {}) {
  const url = new URL(OPENF1_BASE_URL + endpoint);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      console.warn(`[api] ${endpoint} → ${res.status}`);
      return [];
    }
    return await res.json();
  } catch (err) {
    console.warn(`[api] ${endpoint} failed:`, err.message);
    return [];
  }
}
```

### Exported Functions

```js
/**
 * Fetch ALL location records for a session in one request.
 * Returns records sorted ascending by `date` (ISO 8601 string sort is correct
 * since OpenF1 dates have millisecond precision and a fixed timezone offset).
 * This is the largest payload — a 57-lap race produces ~300k–500k records.
 */
export async function fetchAllLocationData(sessionKey)
// GET /location?session_key={sessionKey}
// Returns: { driver_number, date, x, y, z }[]

/**
 * Fetch driver roster. Call once at startup.
 */
export async function fetchDrivers(sessionKey)
// GET /drivers?session_key={sessionKey}
// Returns: { driver_number, full_name, name_acronym, team_name, team_colour }[]

/**
 * Fetch all completed laps. Needed for:
 *   - ?start=N (find lap N's start timestamp)
 *   - Dev panel "Jump to lap" button
 *   - Future: standings and sector time panels
 */
export async function fetchLaps(sessionKey)
// GET /laps?session_key={sessionKey}
// Returns: { driver_number, lap_number, date_start, lap_duration, ... }[]

/**
 * Fetch tire stint records. Used by the tyres source.
 */
export async function fetchStints(sessionKey)
// GET /stints?session_key={sessionKey}
// Returns: { driver_number, stint_number, lap_start, lap_end, compound, tyre_age_at_start }[]

/**
 * Fetch pit stop records. Used by the tyres source.
 */
export async function fetchPit(sessionKey)
// GET /pit?session_key={sessionKey}
// Returns: { driver_number, lap_number, pit_duration, date }[]

/**
 * Fetch race position records. Used by standings and gaps sources.
 */
export async function fetchPosition(sessionKey)
// GET /position?session_key={sessionKey}
// Returns: { driver_number, date, position, gap_to_leader, interval }[]
```

### calculateBounds

```js
/**
 * Compute the bounding box of all OpenF1 (x, y) coordinate values in the
 * location records, then expand each side by BOUNDS_MARGIN (5%).
 *
 * Called once after fetchAllLocationData resolves. The result is stored as
 * a module-level variable in track-map/main.js and passed as a parameter to
 * transform.js functions — it is NOT stored in the circuit JSON.
 *
 * @param {Array<{x: number, y: number}>} records
 * @returns {{ minX: number, maxX: number, minY: number, maxY: number }}
 */
export function calculateBounds(records) {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const r of records) {
    if (r.x < minX) minX = r.x;
    if (r.x > maxX) maxX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.y > maxY) maxY = r.y;
  }
  const rangeX = maxX - minX;
  const rangeY = maxY - minY;
  return {
    minX: minX - rangeX * BOUNDS_MARGIN,
    maxX: maxX + rangeX * BOUNDS_MARGIN,
    minY: minY - rangeY * BOUNDS_MARGIN,
    maxY: maxY + rangeY * BOUNDS_MARGIN,
  };
}
```

Log the computed bounds to the console on first calculation: `console.log('[bounds]', bounds)`. This lets developers verify the bounds during development without having to dig into the data.

---

## shared/playback.js

The playback engine. Each browser source that imports this module gets its own independent instance (module-level variables are per-page, not shared across OBS browser sources).

### Why Module-Level Variables, Not a Class

Each OBS browser source is a separate page with its own module registry. `import * as playback from '...'` in `sources/track-map/main.js` and the same import in `sources/standings/main.js` are two independent module instances with separate state. A class would add boilerplate with no benefit given this single-instance-per-page constraint.

### The Clock Model

Internally, the engine tracks two anchors:
- `_realAnchor` — `Date.now()` at the last calibration point
- `_sessionAnchor` — the session epoch ms at the last calibration point

```
getCurrentSessionTime() = _sessionAnchor + (Date.now() - _realAnchor) * _speed
```

When speed changes, a new calibration point is recorded:
```
currentTime = getCurrentSessionTime()   ← capture position BEFORE changing speed
_speed = newSpeed
_realAnchor = Date.now()                ← new reference: now
_sessionAnchor = currentTime            ← new reference: current position
```

This ensures the return value of `getCurrentSessionTime()` is continuous across speed changes.

### API

```js
/**
 * Initialize the playback engine with all session records.
 * Must be called once before any other function.
 *
 * @param {Array<{date: string}>} records - sorted by date ascending
 * @param {{ speed?: number, startOffsetMs?: number }} options
 *   startOffsetMs: ms offset from the first record's timestamp.
 *   Computed by main.js from laps data when ?start=N is in the URL.
 */
export function init(records, { speed = DEFAULT_PLAYBACK_SPEED, startOffsetMs = 0 } = {})

/**
 * Returns the current playback position as epoch ms.
 * Called every RAF frame. Has no side effects.
 */
export function getCurrentSessionTime()  // → number (epoch ms)

/**
 * Change playback speed WITHOUT causing a position jump.
 * Recalibrates internal anchors.
 */
export function setSpeed(newSpeed)

/**
 * Jump to the start of a specific lap.
 * Finds the earliest date_start across all drivers for lapNumber.
 * Recalibrates internal anchors to that position.
 *
 * @param {number} lapNumber
 * @param {Array<{lap_number: number, date_start: string}>} lapsData
 */
export function jumpToLap(lapNumber, lapsData)

export function getSpeed()          // → current speed multiplier
export function getTotalDuration()  // → ms from first to last record
export function getRecordCount()    // → total number of records
export function getStartTime()      // → epoch ms of first record
```

### Edge Cases

- If `lapNumber` is not found in `lapsData`, log a warning and make no change.
- `setSpeed` and `jumpToLap` are safe to call before `init` — they will no-op if `_initialized` is false.
- `speed` is clamped to `[MIN_PLAYBACK_SPEED, MAX_PLAYBACK_SPEED]` in both `init` and `setSpeed`.

---

## shared/drivers.js

Driver roster cache. Populated once at startup from `fetchDrivers()`, then queried by any source for team colors and abbreviations.

```js
/**
 * Initialize the driver map from the API response array.
 * @param {Array<{driver_number, full_name, name_acronym, team_name, team_colour}>} driversArray
 */
export function init(driversArray)
// Normalizes team_colour: adds '#' prefix → "#3671C6"
// Keys entries by String(driver_number) for O(1) lookup

/**
 * Look up a single driver by number.
 * @param {number|string} driverNumber
 * @returns {{ driverNumber, fullName, abbreviation, teamName, teamColor, countryCode } | null}
 */
export function getDriver(driverNumber)

/** Returns all drivers as an array. */
export function getAllDrivers()  // → driverEntry[]

/** Convenience shortcut for the team hex color. Returns '#ffffff' if unknown. */
export function getTeamColor(driverNumber)  // → string
```

### Driver Entry Shape

```js
{
  driverNumber: "1",         // string
  fullName:    "Max Verstappen",
  abbreviation: "VER",
  teamName:    "Red Bull Racing",
  teamColor:   "#3671C6",   // '#' prefix always included
  countryCode: "NED",
}
```

---

## shared/gestures.js

**Stub — not yet implemented.**

```js
// shared/gestures.js
// Future: MediaPipe Tasks Vision hand gesture control.
// Full specification: archive/src-gestures-SPEC.md
// This module will export a GestureController class when implemented.

export class GestureController {
  constructor(videoElement, onGesture) {
    console.warn('[gestures] Not yet implemented.');
  }
  async init() {}
  stop() {}
}
```

The stub lets sources `import { GestureController }` without error. When MediaPipe is added, this module is replaced with the full implementation from `archive/src-gestures-SPEC.md`.
