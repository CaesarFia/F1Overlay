# Circuit Data Format

## Purpose

Each F1 circuit has exactly two files in the `circuits/` directory: a `.glb` 3D model and a `.json` data file. The JSON contains the centerline point array used to build the driver-position spline. Everything else (coordinate bounds, model bounding box) is computed at runtime.

---

## File Structure

```
circuits/
├── miami.glb      ← processed 3D model
├── miami.json     ← metadata + centerline points
├── bahrain.glb
├── bahrain.json
└── ...            ← one pair of files per circuit (flat, no subfolders)
```

Circuit keys are lowercase, spaces replaced with hyphens, accent marks stripped. They match the `circuit_short_name` returned by OpenF1 `/sessions`, normalized the same way as in the display layer.

---

## JSON Schema

```json
{
  "circuitKey":        "miami",
  "circuitName":       "Miami International Autodrome",
  "country":           "United States",
  "lapLengthMeters":   5412,
  "defaultPitTimeLoss": 22.5,
  "centerlinePoints": [
    { "x": 3.21, "y": 0.12, "z": -1.84 },
    { "x": 3.15, "y": 0.13, "z": -1.62 },
    ...
  ]
}
```

### What Is Not in the JSON

| Field | Old location | Now computed by |
|---|---|---|
| `openF1Bounds` | circuit JSON | `calculateBounds(locationRecords)` in `shared/api.js` — called after batch fetch |
| `modelBounds` | circuit JSON | `new THREE.Box3().setFromObject(mesh)` in `sources/track-map/circuit.js` — called after GLB loads |
| `calibrationPoints` | circuit JSON | Removed — no longer needed since bounds are data-driven |

### Field Definitions

**`centerlinePoints`** — ordered array of 80–120 points in Three.js model space (Y-up, same coordinate system as the exported GLB). Points trace the racing line around the circuit in the **racing direction**. More points in tight corners, fewer on long straights.

- `x` = horizontal (left/right)
- `y` = elevation (height above datum)
- `z` = depth (forward/backward in model space)

The first point (index 0) should be at or near the **start/finish line** — this is where OpenF1 lap timing begins, so aligning it here minimizes `targetT` discontinuities when drivers cross the line.

**`defaultPitTimeLoss`** — estimated total time lost during a pit stop (seconds) under green flag conditions. Used by future strategy panel calculations. Typical range: 18–28 seconds.

---

## GLB Processing Checklist

Source: STL files from Printables.com, creator "sabin" — consistent set of all F1 circuits at the same scale with real elevation data.

Process each circuit in Blender before adding to the project:

1. **Import STL** into a new Blender file

2. **Scale** so the circuit is **10–20 Three.js units wide** (longest bounding box axis = 10–20 units). Miami at ~14,000 triangles and ~17 units wide is the reference.

3. **Set origin** to geometry center: `Object → Set Origin → Origin to Geometry`

4. **Recalculate normals outward**: Edit Mode → `Mesh → Normals → Recalculate Outside`

5. **Clean up geometry**:
   - `Mesh → Clean Up → Delete Loose`
   - `Mesh → Clean Up → Merge by Distance` (threshold: 0.001)

6. **Decimate** if polygon count exceeds **20,000 triangles**. Miami = 14,000 triangles (benchmark).

7. **Export as GLB**:
   - `File → Export → glTF 2.0 (.glb)`
   - Format: Binary (`.glb`)
   - Include: Selected Objects only
   - Transform: ✅ **Y Up**
   - Geometry: ✅ Apply Modifiers, ✅ UVs, ✅ Normals
   - Compression: None

8. **Verify in Three.js**:
   - Mesh loads without errors
   - `new THREE.Box3().setFromObject(mesh)` returns a reasonable bounding box (verify X and Z dimensions match expected track width)
   - Raycasts fired in `-Y` direction from above the mesh hit the surface reliably at the centerline positions

---

## Centerline Point Recording (Blender)

1. Load the circuit GLB in Blender (the processed, Y-up version)
2. Create an Empty: `Add → Empty → Plain Axes`
3. Enable snapping: `Snap to: Face`, check `Align Rotation to Target`
4. Walk the Empty along the track centerline in the **racing direction**, dropping a recorded point at each position
5. Use more points through tight corners and chicanes, fewer on long straights
6. Export the X, Y, Z positions of each Empty placement to JSON

**Point count target:** 80–120 points. Miami uses 112 points and is the reference implementation.

**Blender → Three.js coordinate mapping:** Blender's GLB export with Y-Up converts Blender's Z-up system to Y-up. The centerline points in the JSON should be recorded from the exported GLB's coordinate space (i.e., load the GLB in Three.js and verify the points visually), not from Blender's native viewport coordinates.

**Practical approach:** After exporting the GLB, load it in the dev server at `localhost:5173/sources/track-map/?dev` and verify the spline line (toggled in the dev panel) follows the actual track surface. Adjust points in the JSON if it deviates.

---

## Circuit Priority List

Miami is the reference implementation. Add circuits in this order:

| Priority | Key | Name |
|---|---|---|
| ✅ Reference | `miami` | Miami International Autodrome |
| 1 | `bahrain` | Bahrain International Circuit |
| 2 | `monaco` | Circuit de Monaco |
| 3 | `silverstone` | Silverstone Circuit |
| 4 | `monza` | Autodromo Nazionale Monza |
| 5 | `spa` | Circuit de Spa-Francorchamps |
| 6 | `abu-dhabi` | Yas Marina Circuit |
| 7 | `australia` | Albert Park Circuit |
| 8 | `japan` | Suzuka International Racing Course |
| 9 | `singapore` | Marina Bay Street Circuit |
| 10 | `cota` | Circuit of the Americas |

Remaining 14 circuits follow in calendar order.
