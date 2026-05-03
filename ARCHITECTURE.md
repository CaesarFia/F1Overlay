# F1 Overlay — System Architecture

## Purpose

A real-time Formula 1 data overlay built as a set of independent OBS Browser Sources. Each panel is a standalone HTML page that fetches its own data and renders independently. The centerpiece is `sources/track-map` — a Three.js 3D circuit tracker showing all 20 drivers moving around the circuit in near real-time. All sources share common modules from `shared/`.

**Current phase:** Historical playback only. All sources load a complete past session dataset upfront and play it back in real time using actual timestamp deltas. Live mode (WebSocket + OAuth2) is deferred — see `archive/README.md`.

---

## API Access

**Free tier, no authentication required.** Historical sessions are available via:
```
GET https://api.openf1.org/v1/{endpoint}?session_key={key}
```

The session key for Miami 2024 is a named constant in `shared/constants.js`. To test a different session, change that one constant.

---

## Data Flow

```
OpenF1 REST API (https://api.openf1.org/v1/)
  No auth — historical session_key from shared/constants.js
        │
        │  Batch fetch at page load (one-time, all records)
        ▼
[ sources/{name}/main.js ]
  - Promise.all([fetchAllLocationData, fetchDrivers, fetchLaps, ...])
  - calculateBounds(locationRecords) → openF1Bounds
  - Build per-driver record index
  - Compute startOffsetMs from ?start=N URL param
        │
        ▼
[ shared/playback.js ]
  - init(records, { speed, startOffsetMs })
  - getCurrentSessionTime() → epoch ms, called every frame
  - setSpeed() with clock recalibration (no position jump)
  - jumpToLap() recalibrates to a specific lap's start timestamp
        │
        │  getCurrentSessionTime() read each RAF frame
        ▼
[ RAF Loop — sources/{name}/main.js tick() ]
  - Advance per-driver record index up to current session time
  - Update driver targetT from current record's x/y
  - Lerp currentT toward targetT (smooth 60fps movement)
        │
        ├──────────────────────────────────┐
        ▼                                  ▼
[ Three.js Scene ]              [ Dev Panel (track-map only) ]
  scene.js, circuit.js            Conditionally loaded via
  drivers.js, transform.js        dynamic import when ?dev
  postfx.js                       in URL. Never in DOM otherwise.
```

---

## Directory Structure

```
f1-overlay/
├── vite.config.js            ← multi-entry build (one entry per source)
├── package.json              ← dependencies: three + vite only
├── ARCHITECTURE.md           ← this file
├── SETUP.md                  ← project bootstrap
├── README.md                 ← spec file index
│
├── shared/                   ← imported by all sources
│   ├── SPEC.md               ← documents all shared modules
│   ├── constants.js          ← every configurable value (session key, lerp rate, etc.)
│   ├── api.js                ← batch fetch functions + calculateBounds
│   ├── playback.js           ← playback engine + session clock
│   ├── drivers.js            ← driver roster cache + lookup helpers
│   └── gestures.js           ← stub (future MediaPipe gesture control)
│
├── sources/
│   ├── track-map/            ← Three.js 3D circuit tracker
│   │   ├── SPEC.md
│   │   ├── index.html        ← OBS browser source entry point
│   │   ├── main.js           ← startup sequence + RAF loop
│   │   ├── scene.js          ← Three.js renderer, camera, lighting
│   │   ├── circuit.js        ← GLB load, spline, raycast correction, modelBounds
│   │   ├── drivers.js        ← 20 dot meshes, CSS2D labels, lerp update
│   │   ├── transform.js      ← OpenF1 XY → model XZ → spline T
│   │   ├── postfx.js         ← UnrealBloomPass setup
│   │   └── dev-panel.js      ← DevPanel (dynamic import, ?dev only)
│   │
│   ├── standings/            ← Timing tower (HTML/CSS)
│   │   ├── SPEC.md
│   │   ├── index.html
│   │   └── main.js
│   │
│   ├── gaps/                 ← Gap-to-leader chart (HTML/CSS)
│   │   ├── SPEC.md
│   │   ├── index.html
│   │   └── main.js
│   │
│   └── tyres/                ← Tire strategy timeline (HTML/CSS)
│       ├── SPEC.md
│       ├── index.html
│       └── main.js
│
├── circuits/
│   ├── SPEC.md               ← circuit data format + GLB processing checklist
│   ├── miami.glb             ← processed 3D model (from Blender, Y-up, <20k tris)
│   └── miami.json            ← centerlinePoints + circuit metadata (no hardcoded bounds)
│
└── archive/                  ← future live-mode architecture specs
    ├── README.md             ← explains what these describe and when to revisit them
    └── [old src/ specs]
```

---

## Multi-Source OBS Design

Each source in `sources/` is an independent OBS Browser Source:

| Source | OBS URL | Purpose |
|---|---|---|
| track-map | `localhost:5173/sources/track-map/` | 3D circuit with moving driver dots |
| standings | `localhost:5173/sources/standings/` | Timing tower (position, gaps, lap times) |
| gaps | `localhost:5173/sources/gaps/` | Gap-to-leader bar chart |
| tyres | `localhost:5173/sources/tyres/` | Tire compound and stint timeline |

Each source is `1920×1080` with a transparent background, composited over the broadcast in OBS.

**Sources cannot share memory.** Each source independently connects to the same historical session. They stay synchronized because they all start at page load time with the same URL parameters (`?speed=N`, `?start=N`).

**Future synchronization:** When sources need precise time sync (live mode), add a `BroadcastChannel` coordinator. See `archive/README.md`.

---

## URL Parameters (all sources)

| Parameter | Effect |
|---|---|
| `?speed=5` | Play at 5× real time (default: 1.0, range: 0.1–20) |
| `?start=25` | Begin playback from lap 25 (requires laps data to resolve timestamp) |
| `?dev` | Load dev panel (track-map only; must be dynamic import — not CSS hidden) |

Parameters are parsed once at page load via `new URLSearchParams(window.location.search)`.

---

## Coordinate System

Three.js uses **Y-up**: the track surface lies in the XZ plane with Y = elevation.

The OpenF1 `/location` endpoint returns (X, Y) in a 2D top-down system where:
- OpenF1 **X** → Three.js model **X**
- OpenF1 **Y** → Three.js model **Z** (horizontal plane in Y-up is XZ, not XY)

Both the `openF1Bounds` (from `calculateBounds()`) and `modelBounds` (from `THREE.Box3` on the loaded mesh) are computed at runtime. Neither is stored in the circuit JSON.

---

## Key Design Rules

1. **No Web Worker.** Batch fetch runs on the main thread once at startup. Playback is driven by the RAF loop reading `playback.getCurrentSessionTime()` every frame.

2. **No polling.** All data for a session is fetched upfront in `Promise.all`. Once loaded, no further network requests are made.

3. **All configurable values live in `shared/constants.js`.** No magic numbers in any other file. Session key, lerp rate, dot size, bloom intensity — all constants.

4. **`calculateBounds` is always called, never hardcoded.** The `openF1Bounds` object is derived from the actual data every time, making the system work correctly for any session without manual calibration.

5. **`dev-panel.js` is never loaded unless `?dev` is in the URL.** Use `await import('./dev-panel.js')` inside an `if (devMode)` block. Vite's code splitting ensures it is a separate chunk never fetched in production.

6. **Driver dots never teleport.** `currentT` is lerped toward `targetT` every frame regardless of how much time passed since the last record update.

7. **`playback.setSpeed()` must not cause a position jump.** Capture the current session time before changing speed, then recalibrate both anchors. See `shared/SPEC.md` for the exact implementation.

8. **CSS transforms only.** Panel DOM updates use `transform: scaleX()` / `translateY()`, never `width:` or `left:`, to avoid layout reflow.

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| 3D rendering | Three.js | Plain, no React Three Fiber |
| Build / dev server | Vite | Multi-entry, GLB asset support |
| Animations (future) | GSAP | Deferred to panel implementation phase |
| Gestures (future) | MediaPipe Tasks Vision | See `archive/src-gestures-SPEC.md` |
| Live data (future) | MQTT + OAuth2 | See `archive/src-worker-SPEC.md` |
| GPU charts (future) | PixiJS v8 | See `archive/src-pixi-SPEC.md` |

---

## Startup Sequence (track-map source)

```
1. Parse URL params (speed, startLap, devMode)
2. Promise.all: fetchAllLocationData + fetchDrivers + fetchLaps
3. calculateBounds(locationRecords) → openF1Bounds
4. Build recordsByDriver index + driverPlaybackIndex
5. Compute startOffsetMs from startLap + lapsData (if ?start=N)
6. playback.init(records, { speed, startOffsetMs })
7. drivers.init(driversArray)
8. SceneManager.init(canvas)
9. CircuitLoader.load('miami', scene) → { mesh, spline, modelBounds }
10. DriverDotManager.init(scene, spline, drivers.getAllDrivers())
11. PostProcessing.init(renderer, scene, camera)
12. Pre-seek driverPlaybackIndex to startLap position
13. [if devMode] DevPanel = await import('./dev-panel.js') → mount()
14. requestAnimationFrame(tick)
```

Steps 1–12 complete before the first frame renders. Step 2 (batch fetch) is the only async blocking step.
