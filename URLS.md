# F1 Overlay — URL Reference

## Starting the Dev Server

```
npm run dev
```
Vite starts at `http://localhost:5173`. Keep this terminal open while working.

---

## OBS Browser Sources

These are the URLs you add as Browser Sources in OBS. Set each to **1920 × 1080**.
OBS: check **"Allow transparency"** in the browser source settings — the background is already transparent in code.

| Source | URL |
|--------|-----|
| Track Map | `http://localhost:5173/sources/track-map/` |
| Standings | `http://localhost:5173/sources/standings/` |
| Gaps | `http://localhost:5173/sources/gaps/` |
| Tyres | `http://localhost:5173/sources/tyres/` |

**Transparency note:** The bloom post-processing (UnrealBloomPass) destroys canvas alpha, so OBS "Allow transparency" does nothing. Instead: right-click the source in the Sources panel → **Blending Mode → Screen**. This makes the black background invisible while bright glowing elements composite naturally over the game feed.

---

## Track Map URL Parameters

Append to `http://localhost:5173/sources/track-map/`:

| Param | Example | Effect |
|-------|---------|--------|
| `speed` | `?speed=5` | Playback speed multiplier (default 1.0, max 20) |
| `start` | `?start=25` | Jump playback to lap 25 before starting |
| `dev` | `?dev` | Show dev panel (speed slider, lap jump controls) |

Combine: `?speed=2&start=10&dev`

---

## Developer Tools

| Tool | URL | Purpose |
|------|-----|---------|
| Align tool | `http://localhost:5173/tools/align/?circuit=miami` | Top-down view of track mesh + numbered centerline points. Arrow keys offset the spline; Shift+Arrow = 0.1-unit steps. Copy button outputs `splineOffset` JSON. |

Change `?circuit=miami` to any circuit key that has a matching `.glb` and `.json` in `circuits/`.

---

## Adding a New Circuit

1. Export `<name>.glb` from Blender → `circuits/<name>.glb`
2. Create `circuits/<name>.json` with at minimum:
   ```json
   {
     "circuitKey": "<name>",
     "centerlinePoints": [ { "x": 0, "y": 0, "z": 1 }, ... ]
   }
   ```
   Point 0 = start/finish line (sets T=0). All others must be in lap order.
3. Add the OpenF1 session key to `shared/constants.js`:
   ```js
   export const SESSION_CIRCUIT_MAP = { 9078: 'miami', <sessionKey>: '<name>' };
   ```
4. Verify alignment at `http://localhost:5173/tools/align/?circuit=<name>`

---

## Tuning the 3D View

All camera/visual constants are in `shared/constants.js`:

| Constant | Default | Effect |
|----------|---------|--------|
| `ORBIT_TILT_DEG` | `15` | Camera angle above horizontal — higher = more top-down |
| `ORBIT_SPEED` | `0.000021` | Rotation speed in rad/ms — one revolution ≈ 5 min |
| `ORBIT_RADIUS_MULT` | `1.3` | How far the camera orbits from the circuit center |
| `CAMERA_FOV` | `50` | Field of view in degrees |

---

## External APIs

| API | Base URL | Notes |
|-----|----------|-------|
| OpenF1 | `https://api.openf1.org/v1` | Free, historical data only. Rate limit: 3 req/sec. Location data requires `driver_number` param per request. |

Find session keys at: `https://api.openf1.org/v1/sessions?country_name=Canada&year=2025`
