# Gaps Source

## Purpose

Gap-to-leader bar chart — horizontal bars for all 20 drivers scaled by their gap to the race leader. Updates in near real-time as the playback advances through position records. Pure HTML/CSS rendering (PixiJS upgrade deferred). Runs as a standalone OBS Browser Source.

**Current status: Stub.** Data scaffolding is implemented. Rendering is `// TODO`. See the full gap chart spec in `archive/src-panels-SPEC.md` (GapChart section) and `archive/src-pixi-SPEC.md` for the future PixiJS implementation.

---

## Files to Create

```
sources/gaps/
├── index.html
└── main.js
```

---

## Data Sources

| Data | Endpoint | Fetch function |
|---|---|---|
| Race positions + gaps | `/position` | `fetchPosition(sessionKey)` |
| Driver names + colors | `/drivers` | `fetchDrivers(sessionKey)` |

---

## Gap Chart Behavior

- **Scale:** 0s to 60s maps to full bar width. Gaps beyond 60s are capped (shown at full width with `+{n} LAP` text).
- **Bar color:** Driver's `teamColor` from `shared/drivers.js`
- **Ordering:** Sorted by race position (1st at top)
- **Smooth animation:** Each bar's rendered width lerps toward its target width each frame (do not snap). Use a lerp rate of ~0.1 (faster than dot movement since gaps change more abruptly).
- **Gap string parsing:** `"+1.234"` → `1.234`. `"+1 LAP"` → capped at max scale.

---

## main.js (Stub Implementation)

```js
import { MIAMI_SESSION_KEY } from '../../shared/constants.js';
import { fetchPosition, fetchDrivers } from '../../shared/api.js';
import * as playback from '../../shared/playback.js';
import * as driverData from '../../shared/drivers.js';

async function main() {
  const params = new URLSearchParams(window.location.search);
  const speed  = parseFloat(params.get('speed') ?? '1.0');

  const [positionRecords, driversArray] = await Promise.all([
    fetchPosition(MIAMI_SESSION_KEY),
    fetchDrivers(MIAMI_SESSION_KEY),
  ]);

  positionRecords.sort((a, b) => (a.date < b.date ? -1 : 1));
  playback.init(positionRecords, { speed });
  driverData.init(driversArray);

  document.getElementById('status').textContent =
    `Loaded ${positionRecords.length} position records`;

  // TODO: build gap chart DOM (one row per driver, bar width = gap / 60 * containerWidth)
  // Reference: archive/src-panels-SPEC.md — GapChart section
  // Future: upgrade to PixiJS for GPU-accelerated smooth bars
  // Reference: archive/src-pixi-SPEC.md

  requestAnimationFrame(function tick() {
    const t = playback.getCurrentSessionTime();
    // TODO: find current position record per driver at time t
    // TODO: update bar widths (lerp toward target width)
    requestAnimationFrame(tick);
  });
}

main().catch(console.error);
```

---

## Rendering Requirements (Future)

When implementing full rendering:

- Container: `480px × 220px`, positioned bottom-left in OBS scene
- One row per driver: `[abbreviation] [████░░░░░░░░] [+1.234s]`
- Bar: CSS `transform: scaleX()` with `transform-origin: left`, never `width:`
- Sort drivers by `position` field each frame using a stable sort (avoid DOM reordering — use `translateY` with driver number as key)
- Lerp bar width smoothly (rate ~0.1 per frame)
- Gap `"+1 LAP"` → display "1 LAP" text, bar at full width with striped CSS pattern
