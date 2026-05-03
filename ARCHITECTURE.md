# F1 Overlay — System Architecture

## Purpose

A real-time Formula 1 data overlay built as an OBS Browser Source. It displays live race telemetry, timing data, and engineer-level analytics sourced exclusively from the OpenF1 API. The centerpiece is a 3D circuit tracker showing all 20 drivers moving around the track in near real-time. The entire overlay is controlled via MediaPipe hand gestures — no keyboard or mouse during a stream.

---

## Data Flow

```
OpenF1 API (https://api.openf1.org/v1/)
        │
        │  fetch (poll)
        ▼
[ Web Worker — src/worker/poller.worker.js ]
  - Owns all network I/O
  - Runs derived calculations
  - Posts STATE_PATCH messages to main thread
        │
        │  postMessage({ type: 'STATE_PATCH', patch })
        ▼
[ Master State — src/state/masterState.js ]
  - Single flat JS object
  - Merge-in patches (never replace wholesale)
  - Keyed by driver_number for O(1) reads
        │
        │  read-only
        ├──────────────────────────────────────┐
        ▼                                      ▼
[ RAF Loop — src/animation/RafScheduler.js ]  [ Three.js Scene ]
  - requestAnimationFrame loop               - src/scene/SceneManager.js
  - Dispatches state reads to renderers      - Circuit GLB + centerline spline
  - GSAP tick integration                    - Driver dots lerp per frame
        │
        ├─────────────────┬────────────────────┐
        ▼                 ▼                    ▼
[ PixiJS Layer ]   [ HTML/CSS Panels ]   [ MediaPipe ]
  src/pixi/          src/panels/          src/gestures/
  GPU canvas         DOM text/timing      Camera → gestures → panel control
```

---

## Directory Map

```
F1-Overlay/
├── ARCHITECTURE.md           ← this file
├── SETUP.md                  ← project bootstrap instructions
├── index.html                ← OBS browser source entry point
├── vite.config.js            ← build config, GLB asset handling
├── package.json
│
├── src/
│   ├── main.js               ← entry: instantiates worker, RAF, scene, panels
│   │
│   ├── api/
│   │   ├── SPEC.md           ← OpenF1 endpoint reference
│   │   ├── openf1.js         ← typed fetch wrappers per endpoint
│   │   └── endpoints.js      ← URL constants + poll interval constants
│   │
│   ├── worker/
│   │   ├── SPEC.md           ← polling worker spec
│   │   └── poller.worker.js  ← Web Worker: all fetching, deriving, posting
│   │
│   ├── state/
│   │   ├── SPEC.md           ← master state schema
│   │   └── masterState.js    ← state object + merge function
│   │
│   ├── derived/
│   │   ├── SPEC.md           ← formulas for all derived stats
│   │   ├── tireDegradation.js
│   │   ├── fuelCorrection.js
│   │   ├── gapTrend.js
│   │   ├── undercutWindow.js
│   │   ├── scPitWindow.js
│   │   ├── trackEvolution.js
│   │   ├── crossoverLap.js
│   │   └── cornerSpeeds.js
│   │
│   ├── scene/
│   │   ├── SPEC.md           ← Three.js scene spec
│   │   ├── SceneManager.js   ← renderer, camera, lighting, postprocessing
│   │   ├── CircuitLoader.js  ← GLB load + spline build + raycast correction
│   │   ├── DriverDotManager.js ← 20 driver spheres, labels, lerp per frame
│   │   ├── CoordinateTransform.js ← OpenF1 XY → model XZ → spline T
│   │   └── PostProcessing.js ← UnrealBloomPass setup
│   │
│   ├── panels/
│   │   ├── SPEC.md           ← panel system + each panel definition
│   │   ├── PanelManager.js   ← panel registry, active panel, transitions
│   │   ├── TimingTower/
│   │   ├── TelemetryPanel/
│   │   ├── TirePanel/
│   │   ├── WeatherPanel/
│   │   ├── GapChart/
│   │   ├── StrategyPanel/
│   │   └── RaceControlPanel/
│   │
│   ├── pixi/
│   │   ├── SPEC.md           ← PixiJS renderer spec
│   │   └── PixiRenderer.js   ← shared PIXI.Application instance
│   │
│   ├── gestures/
│   │   ├── SPEC.md           ← MediaPipe gesture spec
│   │   ├── GestureController.js ← MediaPipe Hands setup + detection loop
│   │   └── GestureMap.js     ← gesture → panel action mapping
│   │
│   ├── animation/
│   │   ├── SPEC.md           ← RAF loop spec
│   │   └── RafScheduler.js   ← master requestAnimationFrame loop
│   │
│   └── utils/
│       ├── colorUtils.js     ← team color helpers, hex to THREE.Color
│       ├── timeFormat.js     ← lap time formatting (s → mm:ss.xxx)
│       └── mathUtils.js      ← lerp, clamp, modular lerp for circular T
│
├── circuits/
│   ├── SPEC.md               ← circuit data format spec
│   ├── miami/
│   │   ├── miami.glb         ← processed 3D model
│   │   └── miami.json        ← centerline, bounds, calibration
│   └── [one folder per circuit]
│
└── public/
    └── fonts/                ← F1-style monospace font (e.g. Formula1 Display)
```

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| 3D rendering | Three.js (plain, no React Three Fiber) | Best AI codegen reliability; most training data; full control |
| Fast canvas | PixiJS | GPU-accelerated 2D for telemetry bars, gap charts |
| Build tool | Vite | Native GLB asset handling; fast HMR; simple config |
| Animations | GSAP | Panel transitions; smooth numeric counters |
| Gestures | MediaPipe Tasks Vision API | Browser-native hand tracking; no server needed |
| CSS animations | CSS transforms only | Avoids layout reflow; GPU composited |
| State | Plain JS object | Fastest possible reads; no framework overhead |
| Polling | Web Worker | Off main thread; never blocks rendering |
| Delivery | OBS Browser Source | 1920×1080 transparent background HTML page |

Do **not** use React, Vue, React Three Fiber, Babylon.js, or any virtual DOM framework.

---

## Key Design Rules

These rules must be respected by every module:

1. **The UI thread never fetches.** All network requests happen inside `poller.worker.js`. The main thread only reads from `masterState`.

2. **All DOM updates go through `requestAnimationFrame`.** Never mutate the DOM from inside a poll callback or a `postMessage` handler directly. Queue state, render in the RAF loop.

3. **Diff and merge, never replace.** When new API data arrives, merge fields into existing driver objects. Do not swap out entire objects — this would break object references held by renderers.

4. **CSS transforms over layout properties.** Use `transform: translateX()` not `left:`. Use `transform: scaleX()` not `width:`. This keeps all updates off the layout thread.

5. **PixiJS for anything updating faster than once per second.** Telemetry bars, position dots, gap charts → PixiJS canvas. Driver names, lap times, flags → HTML/CSS.

6. **Driver dots never teleport.** The 3D tracker lerps `currentT` toward `targetT` every frame. A dot that hasn't received an API update in 2 seconds still glides along its last trajectory.

7. **State is keyed by `driver_number` (string).** All lookups are O(1). Never iterate over all drivers unless explicitly rendering a sorted list.

8. **session_key=latest.** All API calls use `?session_key=latest`. This resolves automatically to the active session. No manual session management.

9. **Derived calculations run in the worker.** Results are posted to the main thread as part of the state patch. The main thread only reads already-computed derived fields.

10. **Rate limit awareness.** Max 3 requests/second, 30 per minute. The staggered poll schedule ensures this is never approached. Never add a new poll endpoint without updating the schedule table in `src/worker/SPEC.md`.

---

## OBS Browser Source Integration

- Target resolution: **1920×1080**
- Background: **fully transparent** (`body { background: transparent !important; }`)
- All canvas elements must be initialized with `alpha: true`
- Three.js: `renderer.setClearColor(0x000000, 0)` and `{ alpha: true }` in WebGLRenderer options
- PixiJS: `backgroundAlpha: 0` in Application options
- OBS setting: enable "Shutdown source when not visible" to pause polling when off-screen
- The overlay is designed to sit on top of a standard broadcast feed; avoid solid white or bright backgrounds in any panel

---

## Canvas Layer Stack (z-index order)

```
z-index 1  — Three.js canvas  (#three-canvas)   — 3D circuit background
z-index 2  — PixiJS canvas    (#pixi-canvas)    — fast-updating graphics
z-index 10 — Panels container (#panels)         — HTML/CSS timing/data panels
z-index 99 — Gesture debug    (#gesture-debug)  — optional: skeleton overlay (dev only)
```

All `canvas` and panel `div` elements use `position: absolute; top: 0; left: 0; width: 1920px; height: 1080px; pointer-events: none;` so they overlay without blocking each other.

---

## Startup Sequence

`main.js` must execute this sequence in order:

1. Load circuit JSON for the current circuit (determined after step 3)
2. Spawn the Web Worker (`poller.worker.js`)
3. Worker fetches `/sessions`, `/meetings`, `/drivers` once (startup endpoints)
4. Worker posts initial state patch including `session.circuitKey`
5. Main thread receives circuitKey → loads correct GLB via `CircuitLoader`
6. CircuitLoader builds spline, runs raycast correction pass (one-time)
7. DriverDotManager initializes 20 driver dot meshes (using team colors from state)
8. RAF loop starts
9. MediaPipe gesture detection loop starts
10. Worker begins staggered polling of live endpoints

Steps 1–6 must complete before the RAF loop starts. If the circuit GLB is not yet loaded, show a loading state rather than an empty scene.

---

## Implementation Order for AIs

If implementing this system from scratch, build in this order to minimize blockers:

1. `SETUP.md` → scaffold the Vite project
2. `src/api/SPEC.md` → OpenF1 wrappers (testable in isolation)
3. `src/state/SPEC.md` → master state schema and merge logic
4. `src/worker/SPEC.md` → polling worker (depends on api + state)
5. `src/derived/SPEC.md` → derived calculations (depends on state schema)
6. `circuits/SPEC.md` → circuit data format (needed by scene)
7. `src/scene/SPEC.md` → Three.js scene (depends on circuits + state)
8. `src/animation/SPEC.md` → RAF loop (depends on scene + state)
9. `src/pixi/SPEC.md` → PixiJS renderer (depends on animation)
10. `src/panels/SPEC.md` → panel UIs (depends on all of the above)
11. `src/gestures/SPEC.md` → gesture control (depends on panel manager)
12. Wire everything together in `main.js`
