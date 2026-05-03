# Tyres Source

## Purpose

Tire strategy timeline panel — shows each driver's stint history as colored horizontal bars (SOFT/MEDIUM/HARD/WET/INTERMEDIATE), current tire age, and projected stop window. Pure HTML/CSS rendering. Runs as a standalone OBS Browser Source.

**Current status: Stub.** Data scaffolding is implemented. Rendering is `// TODO`. See the full tire panel spec in `archive/src-panels-SPEC.md` (TirePanel section).

---

## Files to Create

```
sources/tyres/
├── index.html
└── main.js
```

---

## Data Sources

| Data | Endpoint | Fetch function |
|---|---|---|
| Tire stints | `/stints` | `fetchStints(sessionKey)` |
| Pit stop history | `/pit` | `fetchPit(sessionKey)` |
| Driver names + colors | `/drivers` | `fetchDrivers(sessionKey)` |
| Laps (for timeline scale) | `/laps` | `fetchLaps(sessionKey)` |

---

## Playback Synchronization

Stints data is not timestamped per-record the same way position data is — it covers entire lap ranges. Synchronize to `playback.getCurrentSessionTime()` by cross-referencing against `lapsData`:

```js
// Current lap ≈ laps where date_start < currentSessionTime <= date_start + lap_duration
function getCurrentLap(lapsData, currentTime) {
  // Find the most recent lap whose date_start <= currentTime
}
```

Use `currentLap` as the timeline cursor: show stints and pit stops up to `currentLap`.

---

## Tire Compound Colors

```js
const COMPOUND_COLORS = {
  SOFT:         '#e8002d',  // red
  MEDIUM:       '#ffd600',  // yellow
  HARD:         '#ffffff',  // white
  INTERMEDIATE: '#43b02a',  // green
  WET:          '#0067ff',  // blue
};
```

---

## main.js (Stub Implementation)

```js
import { MIAMI_SESSION_KEY } from '../../shared/constants.js';
import { fetchStints, fetchPit, fetchDrivers, fetchLaps } from '../../shared/api.js';
import * as playback from '../../shared/playback.js';
import * as driverData from '../../shared/drivers.js';

async function main() {
  const params = new URLSearchParams(window.location.search);
  const speed  = parseFloat(params.get('speed') ?? '1.0');

  const [stintsData, pitData, driversArray, lapsData] = await Promise.all([
    fetchStints(MIAMI_SESSION_KEY),
    fetchPit(MIAMI_SESSION_KEY),
    fetchDrivers(MIAMI_SESSION_KEY),
    fetchLaps(MIAMI_SESSION_KEY),
  ]);

  // Use lapsData as the playback timeline (sorted by date_start)
  const sortedLaps = [...lapsData].sort((a, b) => (a.date_start < b.date_start ? -1 : 1));
  playback.init(sortedLaps, { speed });
  driverData.init(driversArray);

  document.getElementById('status').textContent =
    `Loaded ${stintsData.length} stints, ${pitData.length} pit stops`;

  // TODO: build tire timeline rows per driver
  // Reference: archive/src-panels-SPEC.md — TirePanel section
  //
  // Layout: one row per driver (sorted by position)
  // Each row: [DRV] [SOFT 5]  [MEDIUM 18]  [HARD ▌▌▌   ] (current)
  // Bar widths proportional to stint length / totalRaceLaps
  // Current stint has a pulsing cursor at its right edge

  requestAnimationFrame(function tick() {
    const t = playback.getCurrentSessionTime();
    // TODO: compute current lap from session time + lapsData
    // TODO: render stints up to current lap
    requestAnimationFrame(tick);
  });
}

main().catch(console.error);
```

---

## Rendering Requirements (Future)

When implementing full rendering:

- Container: `320px wide`, right side of OBS scene, full height
- One row per driver (sorted by current race position): `50px tall`
- Stint bar: `width = (stintLength / totalLaps) * containerWidth`, colored by compound
- Current stint: bar extends to current lap position with pulsing right-edge indicator
- Tire age: number shown at current position marker
- Pit lap indicator: vertical tick mark between stints
- Total race laps: derive from `MAX(lap_number)` across all drivers in `lapsData`
- All bar widths via `transform: scaleX()` not `width:`
