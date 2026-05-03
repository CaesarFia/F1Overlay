# Standings Source

## Purpose

Timing tower panel — shows all 20 drivers sorted by race position with gap to leader, last lap time, and tire compound. Pure HTML/CSS rendering, no Three.js or PixiJS. Runs as a standalone OBS Browser Source at 1920×1080 with a transparent background.

**Current status: Stub.** The data scaffolding is implemented. Rendering is `// TODO`. See the full timing tower layout spec in `archive/src-panels-SPEC.md` (TimingTower section).

---

## Files to Create

```
sources/standings/
├── index.html
└── main.js
```

---

## Data Sources

| Data | Endpoint | Fetch function |
|---|---|---|
| Race positions + gaps | `/position` | `fetchPosition(sessionKey)` |
| Driver names + colors | `/drivers` | `fetchDrivers(sessionKey)` |
| Lap times + tire data | `/laps` | `fetchLaps(sessionKey)` |
| Tire compound + age | `/stints` | `fetchStints(sessionKey)` |

---

## Playback Synchronization

This source runs its own independent instance of `shared/playback.js`. Synchronization with other sources (e.g., track-map) happens naturally via matching URL parameters.

The position data is stored as a flat sorted array. Each RAF frame, advance the per-entry playback index to find the most recent position record at or before `playback.getCurrentSessionTime()`.

```js
// Pattern (same as track-map's per-driver indexing):
const recordsByDriver = {};  // { [driverNumber]: positionRecord[] }
const playbackIndex   = {};  // { [driverNumber]: currentIndex }
```

The rendering loop reads the current record for each driver and updates the DOM once per frame.

---

## main.js (Stub Implementation)

```js
import { MIAMI_SESSION_KEY } from '../../shared/constants.js';
import { fetchPosition, fetchDrivers, fetchLaps, fetchStints } from '../../shared/api.js';
import * as playback from '../../shared/playback.js';
import * as driverData from '../../shared/drivers.js';

async function main() {
  const params = new URLSearchParams(window.location.search);
  const speed  = parseFloat(params.get('speed') ?? '1.0');

  const [positionRecords, driversArray, lapsData, stintsData] = await Promise.all([
    fetchPosition(MIAMI_SESSION_KEY),
    fetchDrivers(MIAMI_SESSION_KEY),
    fetchLaps(MIAMI_SESSION_KEY),
    fetchStints(MIAMI_SESSION_KEY),
  ]);

  positionRecords.sort((a, b) => (a.date < b.date ? -1 : 1));
  playback.init(positionRecords, { speed });
  driverData.init(driversArray);

  document.getElementById('status').textContent =
    `Loaded ${positionRecords.length} position records`;

  // TODO: build timing tower DOM rows (one per driver, sorted by position)
  // Reference: archive/src-panels-SPEC.md — TimingTower section
  // Each row: position number | team color bar | abbreviation | gap | last lap | tire

  requestAnimationFrame(function tick() {
    const t = playback.getCurrentSessionTime();
    // TODO: find current position record per driver at time t
    // TODO: update DOM rows with current data
    requestAnimationFrame(tick);
  });
}

main().catch(console.error);
```

---

## Rendering Requirements (Future)

When implementing the full rendering:

- One `<div>` row per driver, 50px tall, positioned absolutely with `transform: translateY()`
- Use GSAP to animate row reordering when positions change
- Team color bar: 4px left border in driver's `teamColor`
- Gap display: toggle between gap-to-leader and interval-to-car-ahead on click
- Tire compound: colored circle (SOFT=red, MEDIUM=yellow, HARD=white, INT=green, WET=blue) + age in laps
- Mini sector colors for the latest lap (2048=grey, 2049=green, 2051=yellow, 2064=purple)
- All numeric values update via `textContent =` never `innerHTML =`
- CSS `transform: scaleX()` for any bar elements, never `width:`

See `archive/src-panels-SPEC.md` for the complete layout specification and GSAP row reordering pattern.
