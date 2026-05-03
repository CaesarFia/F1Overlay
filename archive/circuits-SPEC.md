# Circuit Data Format

## Purpose

Each F1 circuit in the system has exactly two files in its directory: a `.glb` 3D model file and a `.json` data file. The JSON file provides everything the code needs to map OpenF1 API coordinates to the 3D model: track bounds, the centerline spline point array, and calibration reference points.

---

## Directory Structure

```
circuits/
├── miami/
│   ├── miami.glb      ← 3D model (processed in Blender)
│   └── miami.json     ← coordinate data (this spec)
├── bahrain/
│   ├── bahrain.glb
│   └── bahrain.json
└── [one folder per circuit, lowercase name]
```

The folder name and JSON `circuitKey` must match the value returned by normalizing `session.circuitShortName` to lowercase with spaces replaced by hyphens. Examples:
- "Miami" → `miami`
- "Bahrain" → `bahrain`
- "Abu Dhabi" → `abu-dhabi`
- "São Paulo" → `sao-paulo`

---

## JSON Schema

```json
{
  "circuitKey": "miami",
  "circuitName": "Miami International Autodrome",
  "country": "United States",
  "lapLengthMeters": 5412,
  "defaultPitTimeLoss": 22.5,
  "scPitTimeLoss": 0.5,
  "vscPitTimeLoss": 10.0,

  "openF1Bounds": {
    "minX": -3000,
    "maxX": 3000,
    "minY": -2000,
    "maxY": 2000
  },

  "modelBounds": {
    "minX": -8.5,
    "maxX": 8.5,
    "minZ": -5.2,
    "maxZ": 5.2
  },

  "centerlinePoints": [
    { "x": 3.21, "y": 0.12, "z": -1.84 },
    { "x": 3.15, "y": 0.13, "z": -1.62 },
    ...
  ],

  "calibrationPoints": [
    {
      "label": "Start/Finish Line",
      "openF1": { "x": 1240, "y": 320 },
      "model": { "x": 3.21, "z": -1.84 }
    },
    {
      "label": "Turn 1 Entry",
      "openF1": { "x": 1420, "y": 180 },
      "model": { "x": 4.10, "z": -2.30 }
    }
  ]
}
```

---

## Field Definitions

### `openF1Bounds`

The minimum and maximum X and Y coordinate values that appear in `/location` endpoint responses for this circuit during a real session. These are used as the normalization bounds for the coordinate transform.

**How to obtain:** Run a session on this circuit, collect all `/location` responses, and find `Math.min`/`Math.max` of all X and Y values. Add 5–10% margin on each side to handle edge cases (e.g., drivers slightly off the recorded limits due to track limits).

### `modelBounds`

The bounding box of the loaded circuit GLB mesh in Three.js coordinate space. Computed once after loading with:
```js
const box = new THREE.Box3().setFromObject(mesh);
// modelBounds.minX = box.min.x, maxX = box.max.x
// modelBounds.minZ = box.min.z, maxZ = box.max.z
```

**Why store this in JSON:** The bounds are needed by the worker to compute `targetT` — but the worker doesn't load the GLB. Storing them in JSON makes the bounds accessible to both worker and main thread.

### `centerlinePoints`

An ordered array of 3D points in Three.js model space (Y-up, same coordinate system as the exported GLB) that trace the racing line around the circuit. Points go in the **racing direction** (counterclockwise or clockwise — whichever direction the drivers actually race).

**Coordinate system:** `x` = horizontal, `y` = elevation (height above datum), `z` = depth. These are the same coordinates as the GLB mesh.

**Point count:** 80–120 points per circuit. Miami uses 112 points and is the reference implementation.

**Density guidelines:**
- Long straights: 1 point every ~500m of track length in model units
- Medium corners: 3–5 points
- Tight hairpins and chicanes: 8–12 points
- The goal is smooth interpolation via CatmullRomCurve3 with no visible kinks

**How to record in Blender:**
1. Load the circuit GLB in Blender
2. Create an Empty object with Display Type = "Plain Axes"
3. Enable snapping: Snap to "Face" with "Align Rotation to Target" checked
4. Walk the Empty along the centerline of the track in the correct racing direction, placing a vertex/point at each position
5. Record the X, Y, Z of each placement (Blender Z = Three.js Y since GLB export converts)
6. Export the array to JSON

**Start/finish line:** The first point (index 0) should be at or near the start/finish line, which is where OpenF1 lap timing begins.

### `calibrationPoints`

At least 3 known reference points that appear in both OpenF1 coordinate space and model space. Used to verify the coordinate transform is working correctly and to refine the `openF1Bounds` if needed.

Required calibration points:
1. Start/finish line
2. A distinctive corner (e.g., Turn 1)
3. A point midway through the circuit

**How to obtain OpenF1 coordinates for a point:** Look up the `/location` data during a session for a specific moment when a driver is at that known location (e.g., the moment a driver crosses the start/finish line in the timing data, find the corresponding location record).

### `defaultPitTimeLoss`

Average total pit stop time (seconds) for this circuit under green flag conditions. Includes pit lane entry, stationary stop, and exit time. Typical range: 18–28 seconds depending on pit lane length. Miami is approximately 22.5s.

### `scPitTimeLoss` / `vscPitTimeLoss`

The effective pit time loss *reduction* in seconds when pitting under Safety Car vs Virtual Safety Car versus a normal green flag pit stop. These are fed into the SC/VSC pit window calculation.

Typical values:
- SC: saves 20–25 seconds (car doesn't have to blast through the pit lane delta relative to SC pace)
- VSC: saves 10–15 seconds

These are approximate — refine based on observed pit deltas from actual race data for each circuit.

---

## GLB Processing Checklist

Each circuit GLB must be processed in Blender before adding to the project. Follow these steps:

1. **Source:** STL files from Printables.com, creator "sabin" (consistent set of all F1 circuits at same scale with elevation data)

2. **Scale:** Resize in Blender so the circuit is **10–20 Three.js units wide** (the longest axis of the bounding box should be 10–20 units). Miami at ~14,000 triangles is the benchmark.

3. **Origin:** Set origin to geometry center (Object → Set Origin → Origin to Geometry)

4. **Normals:** Recalculate normals outward (Edit Mode → Mesh → Normals → Recalculate Outside)

5. **Cleanup:**
   - Remove loose geometry (Mesh → Clean Up → Delete Loose)
   - Merge by distance (Mesh → Clean Up → Merge by Distance, threshold 0.001)
   - Decimate if needed to stay under **20,000 triangles** (Miami = 14k, this is the target ceiling)

6. **Export as GLB:**
   - File → Export → glTF 2.0 (.glb)
   - Format: Binary (`.glb`)
   - Include: Selected Objects only
   - Transform: ✅ Y Up
   - Geometry: ✅ Apply Modifiers
   - Geometry: ✅ UVs, ✅ Normals
   - Compression: None (small files anyway)

7. **Verify in Three.js:** Load the GLB and confirm:
   - Mesh loads without errors
   - Bounding box is reasonable (within the expected model unit range)
   - Normals point outward (lighting on the surface looks correct)
   - Raycasts from above hit the mesh surface reliably

---

## Circuit Priority List

Implement circuits in this order, starting with circuits that are earliest in the current F1 season calendar and have the most complex geometry (better validation):

| Priority | Circuit Key | Name | Notes |
|---|---|---|---|
| ✅ DONE | `miami` | Miami International Autodrome | Reference — 14k tris, 112 centerline points |
| 1 | `bahrain` | Bahrain International Circuit | Good test case: simple layout |
| 2 | `monaco` | Circuit de Monaco | Complex: tight corners, elevation |
| 3 | `silverstone` | Silverstone Circuit | High-speed, important event |
| 4 | `monza` | Autodromo Nazionale Monza | Simple layout, historic |
| 5 | `spa` | Circuit de Spa-Francorchamps | Complex elevation |
| 6 | `abu-dhabi` | Yas Marina Circuit | Season finale |
| 7 | `australia` | Albert Park Circuit | Street circuit feel |
| 8 | `japan` | Suzuka International Racing Course | Figure-8, complex |
| 9 | `singapore` | Marina Bay Street Circuit | Night race, street |
| 10 | `cota` | Circuit of the Americas | Large, complex |
| 11 | `mexico` | Autodromo Hermanos Rodriguez | High altitude |
| 12 | `brazil` | Autodromo Jose Carlos Pace | Classic |
| 13 | `hungary` | Hungaroring | Tight, technical |
| 14 | `spain` | Circuit de Barcelona-Catalunya | Reference circuit |
| 15 | `canada` | Circuit Gilles Villeneuve | Street-style, chicanes |
| 16 | `austria` | Red Bull Ring | Short, fast |
| 17 | `britain` | Silverstone Circuit | Covered above |
| 18 | `netherlands` | Circuit Zandvoort | Banked corners |
| 19 | `azerbaijan` | Baku City Circuit | Long straight |
| 20 | `saudi-arabia` | Jeddah Corniche Circuit | Fast, narrow |
| 21 | `las-vegas` | Las Vegas Strip Circuit | Night, long straight |
| 22 | `qatar` | Losail International Circuit | New addition |
| 23 | `china` | Shanghai International Circuit | Long straight |
| 24 | `imola` | Autodromo Enzo e Dino Ferrari | Tight, old-school |

---

## openF1Bounds Per Circuit (Initial Estimates)

These are starting estimates. Refine by observing actual API data for each circuit.

These bounds will be populated as each circuit is added to the system. For now, each circuit's JSON file should have a `"openF1BoundsNote"` field explaining that bounds need to be confirmed with live data:

```json
"openF1BoundsNote": "PLACEHOLDER — must be confirmed with real /location data from a live session at this circuit"
```
