# OpenF1 API Layer

## Purpose

Provide typed fetch wrappers for every OpenF1 endpoint used by the polling worker. All network I/O in this project flows through these functions. The main thread never calls these directly — only `poller.worker.js` does.

---

## Files to Create

- `src/api/openf1.js` — one exported async function per endpoint
- `src/api/endpoints.js` — URL constants and poll interval constants

---

## Base URL and Auth

```
Base URL: https://api.openf1.org/v1
Auth: none (no API key required)
```

All requests are unauthenticated GET requests returning JSON arrays.

---

## Rate Limits

- **3 requests per second**
- **30 requests per minute**

The polling schedule in `src/worker/SPEC.md` is designed to stay well under these limits. Never add a new poll call without updating that schedule.

---

## Session Key Pattern

All live-session endpoints accept `?session_key=latest`, which automatically resolves to the current active session. Use this everywhere — no manual session ID management.

```
https://api.openf1.org/v1/position?session_key=latest
```

---

## Endpoints

### Startup (fetch once, on session init)

#### `/sessions`
Returns metadata about the current session.

**Key fields:**
```
session_key      — unique session ID (number)
session_name     — "Race", "Qualifying", "Practice 1", etc.
session_type     — "Race", "Qualifying", "Practice", "Sprint", etc.
date_start       — ISO datetime string
date_end         — ISO datetime string (null if session is live)
year             — number
circuit_key      — number (OpenF1 internal circuit ID)
circuit_short_name — short name e.g. "Miami"
country_name     — e.g. "United States"
location         — e.g. "Miami"
```

#### `/meetings`
Returns metadata about the race weekend (meeting).

**Key fields:**
```
meeting_key      — unique meeting ID (number)
meeting_name     — "Miami Grand Prix"
meeting_official_name — full official name
circuit_key      — matches sessions.circuit_key
circuit_short_name
location
country_name
year
```

#### `/drivers`
Returns the full driver roster for the session.

**Key fields:**
```
driver_number    — integer (1, 4, 11, 14, etc.) — the primary key used everywhere
full_name        — "Max Verstappen"
name_acronym     — "VER" (3-letter abbreviation)
team_name        — "Red Bull Racing"
team_colour      — hex string WITHOUT # e.g. "3671C6"
country_code     — "NED"
headshot_url     — URL string (optional, may be null)
```

Map `team_colour` to `#${team_colour}` when storing in state.

---

### Live (polled on schedule)

#### `/location`
Real-time X/Y/Z car position on track. This is the source for the 3D circuit tracker.

**Poll interval:** 1500ms (every 1.5 seconds)
**Key fields:**
```
driver_number
date             — ISO datetime of the sample
x                — meters, track coordinate system
y                — meters, track coordinate system
z                — meters (elevation)
```

Returns one entry per driver per sample. When polling for all drivers at once, use `?session_key=latest` only — the response contains all drivers' most recent positions. To get only the latest sample per driver, add a timestamp filter: `?session_key=latest&date>={lastPollTimestamp}` or rely on the fact that OpenF1 returns data in chronological order and take the last entry per `driver_number`.

#### `/position`
Race position order, gaps, and intervals.

**Poll interval:** 2000ms
**Key fields:**
```
driver_number
date
position         — integer 1–20
gap_to_leader    — string e.g. "+1.234" or "+1 LAP" or "0.000" (leader)
interval         — string e.g. "+0.456" (gap to car directly ahead)
```

#### `/car_data`
Real-time car telemetry at ~3.7Hz.

**Poll interval:** 2000ms
**Key fields:**
```
driver_number
date
speed            — km/h (integer)
throttle         — 0–100 (integer)
brake            — 0 or 1 (binary in OpenF1, not 0–100)
drs              — integer 0–14
                   Values 10, 12, 14 indicate DRS is open/active
                   Values 0, 1, 2 indicate DRS closed/available/not available
gear             — integer 0–8 (0 = neutral)
rpm              — integer
```

Note: `brake` is binary (0 or 1), not a percentage. Display it as a boolean indicator.

#### `/laps`
Per-lap timing data. Returns a new entry each time a driver completes a lap.

**Poll interval:** 15000ms
**Key fields:**
```
driver_number
lap_number       — integer
lap_duration     — seconds (float) or null if in-progress
duration_sector_1 — seconds or null
duration_sector_2 — seconds or null
duration_sector_3 — seconds or null
segments_sector_1 — array of integers (mini sector codes)
segments_sector_2 — array of integers
segments_sector_3 — array of integers
i1_speed         — speed trap at Intermediate 1 (km/h)
i2_speed         — speed trap at Intermediate 2
st_speed         — speed trap at Speed Trap
is_pit_out_lap   — boolean
date_start       — ISO datetime when lap started
```

Mini sector integer codes:
```
2048 — grey (no time recorded)
2049 — green (personal best)
2051 — yellow (slower than personal best)
2064 — purple (session best)
```

#### `/stints`
Tire stint data. Updates when a driver pits or when stint info is confirmed.

**Poll interval:** 15000ms
**Key fields:**
```
driver_number
stint_number     — integer (1 = first stint)
lap_start        — lap number when stint began
lap_end          — lap number when stint ended (null if current)
compound         — "SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"
tyre_age_at_start — laps of previous use on this set (0 = new)
```

Compute current tire age as: `currentTireAge = currentLap - lap_start + tyre_age_at_start`

#### `/pit`
Pit stop timing data. Updates when a pit stop is recorded.

**Poll interval:** 10000ms
**Key fields:**
```
driver_number
lap_number       — lap on which the stop occurred
pit_duration     — total pit time in seconds (float)
date             — ISO datetime
```

Note: OpenF1 does not always split lane vs stationary duration. Use `pit_duration` as the total.

#### `/weather`
Track and atmospheric conditions.

**Poll interval:** 60000ms
**Key fields:**
```
date
air_temperature    — °C
track_temperature  — °C
humidity           — %
wind_speed         — m/s
wind_direction     — degrees (0–359, 0 = North)
rainfall           — boolean (0 or 1)
```

Take the single most recent entry from the response array.

#### `/race_control`
Flags, safety car status, and steward messages.

**Poll interval:** 3000ms
**Key fields:**
```
date
lap_number
category         — "Flag", "SafetyCar", "Drs", "Other"
flag             — "GREEN", "YELLOW", "DOUBLE YELLOW", "RED", "CHEQUERED", null
scope            — "Track", "Sector", "Driver", null
sector           — 1, 2, 3, or null
driver_number    — relevant driver (null for track-wide)
message          — human-readable message string
```

Safety car status is identified by `category == "SafetyCar"` and `message` containing "SAFETY CAR DEPLOYED", "VIRTUAL SAFETY CAR DEPLOYED", "SAFETY CAR IN THIS LAP", or "VIRTUAL SAFETY CAR ENDING".

---

## src/api/endpoints.js

```js
export const BASE_URL = 'https://api.openf1.org/v1';

export const ENDPOINTS = {
  sessions:    '/sessions',
  meetings:    '/meetings',
  drivers:     '/drivers',
  location:    '/location',
  position:    '/position',
  carData:     '/car_data',
  laps:        '/laps',
  stints:      '/stints',
  pit:         '/pit',
  weather:     '/weather',
  raceControl: '/race_control',
};

// Polling intervals in milliseconds
export const POLL_INTERVALS = {
  location:    1500,
  position:    2000,
  carData:     2000,
  raceControl: 3000,
  pit:         10000,
  laps:        15000,
  stints:      15000,
  weather:     60000,
};

// Startup offset for staggering (ms delay before first poll of each endpoint)
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

## src/api/openf1.js

Create one exported async function per endpoint. Each function:
1. Builds the URL with `?session_key=latest` and any additional filters
2. Uses `fetch()` (available in Workers and modern browsers)
3. Returns the parsed JSON array, or `null` on error (do not throw — the worker should handle failures gracefully)
4. Logs failures to `console.warn` with the endpoint name and status code

Example signature pattern:

```js
export async function fetchLocation() {
  return fetchEndpoint(ENDPOINTS.location, { session_key: 'latest' });
}

export async function fetchPosition() {
  return fetchEndpoint(ENDPOINTS.position, { session_key: 'latest' });
}

export async function fetchCarData() {
  return fetchEndpoint(ENDPOINTS.carData, { session_key: 'latest' });
}

export async function fetchLaps() {
  return fetchEndpoint(ENDPOINTS.laps, { session_key: 'latest' });
}

export async function fetchStints() {
  return fetchEndpoint(ENDPOINTS.stints, { session_key: 'latest' });
}

export async function fetchPit() {
  return fetchEndpoint(ENDPOINTS.pit, { session_key: 'latest' });
}

export async function fetchWeather() {
  return fetchEndpoint(ENDPOINTS.weather, { session_key: 'latest' });
}

export async function fetchRaceControl() {
  return fetchEndpoint(ENDPOINTS.raceControl, { session_key: 'latest' });
}

export async function fetchDrivers() {
  return fetchEndpoint(ENDPOINTS.drivers, { session_key: 'latest' });
}

export async function fetchSessions() {
  return fetchEndpoint(ENDPOINTS.sessions, { session_key: 'latest' });
}

export async function fetchMeetings() {
  return fetchEndpoint(ENDPOINTS.meetings, { session_key: 'latest' });
}

// Internal helper
async function fetchEndpoint(path, params) {
  const url = new URL(BASE_URL + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      console.warn(`[OpenF1] ${path} returned ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`[OpenF1] ${path} fetch failed:`, err.message);
    return null;
  }
}
```

---

## Deduplication Strategy

The OpenF1 API returns full arrays on every poll. For `/laps`, `/stints`, `/pit`, and `/race_control`, the response includes all historical entries, not just new ones. The worker must deduplicate by tracking the timestamp of the last processed entry per endpoint.

Each poll function should accept an optional `since` ISO timestamp parameter and filter results client-side:

```js
// Filter to only entries newer than the last poll
const newEntries = data.filter(entry => entry.date > lastPollTimestamp);
```

Store `lastPollTimestamp` per endpoint in the worker's local scope.
