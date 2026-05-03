# Three.js Scene

## Purpose

The 3D circuit tracker is the visual centerpiece of the overlay. It renders a 3D model of the current circuit with 20 glowing driver dots traveling around the track in real time. The scene runs at 60fps via the RAF loop. It reads from `masterState` each frame but never writes to it except for `currentT`/`targetT` fields on each driver.

---

## Files to Create

```
src/scene/SceneManager.js
src/scene/CircuitLoader.js
src/scene/DriverDotManager.js
src/scene/CoordinateTransform.js
src/scene/PostProcessing.js
```

---

## Coordinate System

Three.js uses a **right-handed Y-up coordinate system**:
- **Y axis** = up (elevation)
- **X axis** = right
- **Z axis** = toward viewer (out of the screen)

The circuit GLB is exported from Blender with "Y-Up" enabled, so the track surface lies roughly in the **XZ plane** with Y representing track elevation. All circuit JSON data (centerline points, model bounds) uses this Three.js space.

The OpenF1 `/location` endpoint returns (X, Y) in a 2D overhead coordinate system where:
- OpenF1 **X** maps to model **X**
- OpenF1 **Y** maps to model **Z** (because in Y-up space, the horizontal plane is XZ, not XY)

---

## 1. SceneManager.js

**Purpose:** Initialize and own the Three.js renderer, camera, scene, and lighting. Provide an `update(deltaTime)` method called each RAF frame.

### Renderer Setup

```js
const renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById('three-canvas'),
  alpha: true,           // transparent background for OBS overlay
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setSize(1920, 1080);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);  // fully transparent
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
```

### Camera Setup

Use a `PerspectiveCamera` with a slight downward tilt to show circuit elevation while keeping the layout readable:

```js
const camera = new THREE.PerspectiveCamera(50, 1920 / 1080, 0.01, 1000);
// Position: above the circuit center, tilted 15 degrees off straight-down
// Computed after circuit loads based on circuit bounding box
```

Camera positioning after circuit load:
1. Get the circuit mesh bounding box (via `mesh.geometry.boundingBox` or `new THREE.Box3().setFromObject(mesh)`)
2. Compute center: `center = box.getCenter(new THREE.Vector3())`
3. Compute size: `size = box.getSize(new THREE.Vector3())`
4. Camera height: `Y = center.y + max(size.x, size.z) * 0.9`
5. Camera position: `(center.x, Y, center.z + size.z * 0.15)` — the Z offset provides the 15° tilt
6. `camera.lookAt(center)`

This ensures the circuit fills the frame regardless of its actual scale. Adjust the multiplier (0.9) up or down to zoom in or out.

### Lighting

```js
// Ambient: low intensity to prevent total darkness on the track surface
const ambient = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambient);

// Directional: subtle overhead light for surface normals
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(0, 10, 5);
scene.add(dirLight);
```

No shadows — they add cost and aren't needed for an overlay.

### Circuit Material

Apply this material to the loaded circuit mesh for a dark cinematic look:

```js
const circuitMaterial = new THREE.MeshStandardMaterial({
  color: 0x1a1a2e,        // very dark blue-grey
  roughness: 0.85,
  metalness: 0.0,
  emissive: 0x000000,      // no emissive (only dots should bloom)
});
```

### Exports

```js
export class SceneManager {
  constructor(canvas) { ... }
  async loadCircuit(circuitKey) { ... }  // loads GLB + initializes DriverDotManager
  update(deltaTime, masterState) { ... }  // called every RAF frame
  dispose() { ... }
}
```

---

## 2. CircuitLoader.js

**Purpose:** Load a circuit GLB file, build the centerline spline, run the one-time raycast correction pass, and expose the resulting spline for use by `DriverDotManager`.

### Loading the GLB

Use Three.js `GLTFLoader` from `three/addons`:

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Dynamic import of the GLB by circuit key:
// The circuit GLB is Vite-imported at build time as a URL
// All circuit GLBs must be registered in a lookup:

const circuitModules = {
  miami: () => import('../../circuits/miami/miami.glb'),
  // add more circuits here
};

const module = await circuitModules[circuitKey]();
const glbUrl = module.default;
const gltf = await loader.loadAsync(glbUrl);
const mesh = gltf.scene.children[0]; // The single mesh export from Blender
```

Apply the circuit material to the mesh. Traverse all child meshes and replace their material.

### Building the Centerline Spline

```js
import { circuitData } from '../../circuits/miami/miami.json';

const splinePoints = circuitData.centerlinePoints.map(
  p => new THREE.Vector3(p.x, p.y, p.z)
);
const spline = new THREE.CatmullRomCurve3(splinePoints, true, 'catmullrom', 0.5);
// true = closed loop
// 'catmullrom' = curve type
// 0.5 = tension (adjust for smoothness vs. fidelity)
```

### Raycast Correction Pass (One-Time Startup Cost)

After the GLB mesh is loaded and added to the scene, snap each spline point to the actual mesh surface:

```js
const raycaster = new THREE.Raycaster();
const correctedPoints = splinePoints.map(point => {
  raycaster.set(
    new THREE.Vector3(point.x, point.y + 5, point.z),  // start above
    new THREE.Vector3(0, -1, 0)                          // fire downward
  );
  const hits = raycaster.intersectObject(mesh, true);
  if (hits.length > 0) {
    return hits[0].point.clone().add(new THREE.Vector3(0, 0.05, 0));
    // 0.05 offset lifts the dot slightly above the surface
  }
  return point;  // fallback: use original point if no hit
});

// Rebuild the spline with elevation-corrected points
const correctedSpline = new THREE.CatmullRomCurve3(correctedPoints, true, 'catmullrom', 0.5);
```

This pass runs **once** at startup. It is acceptable to take 50–200ms since it runs before the RAF loop starts.

### Exports

```js
export class CircuitLoader {
  async load(circuitKey, circuitData, scene) {
    // Returns { mesh, spline, circuitData }
  }
}
```

---

## 3. CoordinateTransform.js

**Purpose:** Convert OpenF1 (X, Y) coordinates to a spline `t` parameter [0, 1] representing the driver's progress around the track.

### Concept

OpenF1 `/location` returns X/Y coordinates in a 2D top-down coordinate system measured in meters. The circuit JSON contains `openF1Bounds` (the min/max X/Y values that appear in real data for that circuit) and `modelBounds` (the Three.js bounding box of the loaded mesh).

The transform:
1. Normalize OpenF1 X/Y to [0, 1] using `openF1Bounds`
2. Map to model XZ range using `modelBounds`
3. This gives approximate (X, Z) in Three.js model space
4. Find the closest `t` on the spline to this (X, Z) point
5. Return `t`

### Implementation

```js
export function openF1ToModelXZ(openF1X, openF1Y, circuitData) {
  const { openF1Bounds, modelBounds } = circuitData;

  // Normalize to [0, 1]
  const normX = (openF1X - openF1Bounds.minX) / (openF1Bounds.maxX - openF1Bounds.minX);
  const normY = (openF1Y - openF1Bounds.minY) / (openF1Bounds.maxY - openF1Bounds.minY);

  // Map to model space (openF1 Y → Three.js Z)
  const modelX = modelBounds.minX + normX * (modelBounds.maxX - modelBounds.minX);
  const modelZ = modelBounds.minZ + normY * (modelBounds.maxZ - modelBounds.minZ);

  return { x: modelX, z: modelZ };
}

export function findClosestSplineT(modelX, modelZ, spline, sampleCount = 600) {
  let closestT = 0;
  let closestDist = Infinity;

  for (let i = 0; i <= sampleCount; i++) {
    const t = i / sampleCount;
    const point = spline.getPoint(t);
    const dist = Math.sqrt(
      (point.x - modelX) ** 2 + (point.z - modelZ) ** 2
    );
    if (dist < closestDist) {
      closestDist = dist;
      closestT = t;
    }
  }
  return closestT;
}
```

`findClosestSplineT` samples the spline at 600 points. For 20 drivers updated every 1.5 seconds, this is `20 × 600 = 12,000` distance checks per poll cycle — negligible cost.

This function runs in the **worker** (the worker computes `targetT` and sends it in the patch). However, it requires the spline — which lives on the main thread. Two options:
- **Option A (recommended):** The worker sends raw `locationX/Y` in the patch; the main thread's `DriverDotManager` calls `findClosestSplineT` on the main thread after receiving the patch. The spline is already built on the main thread, so this is natural.
- **Option B:** Build the spline in the worker too (duplicate logic). More complex, not recommended.

Use **Option A**: `CoordinateTransform.js` runs on the main thread, called by `DriverDotManager` when new location data is received.

---

## 4. DriverDotManager.js

**Purpose:** Create and manage 20 driver dot meshes. Each frame, lerp each dot toward its target position along the spline. Handle wrap-around at the start/finish line. Update billboard labels.

### Driver Dot Mesh

Each driver gets:
```js
// Glowing sphere
const geometry = new THREE.SphereGeometry(0.12, 16, 16);
const material = new THREE.MeshStandardMaterial({
  color: teamColorHex,
  emissive: teamColorHex,
  emissiveIntensity: 2.5,
  roughness: 0.2,
  metalness: 0.0,
});
const dot = new THREE.Mesh(geometry, material);
scene.add(dot);
```

The high `emissiveIntensity` makes dots appear luminous and allows the bloom pass to produce a glow effect.

### Billboard Labels

Use `CSS2DRenderer` from `three/addons` for driver labels. CSS2DRenderer positions HTML elements in 3D space with correct perspective projection:

```js
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const labelDiv = document.createElement('div');
labelDiv.className = 'driver-label';
labelDiv.textContent = driver.abbreviation;  // "VER", "HAM", etc.
labelDiv.style.color = `#${teamColor}`;
const label = new CSS2DObject(labelDiv);
label.position.set(0, 0.25, 0);  // offset above the dot
dot.add(label);
```

CSS2DRenderer uses a separate DOM element that overlaps the Three.js canvas. Its z-index must sit between the Three.js canvas and the HTML panels layer (z-index 5).

Style `.driver-label` in CSS:
```css
.driver-label {
  font-family: 'Formula1', monospace;
  font-size: 11px;
  font-weight: 700;
  text-shadow: 0 0 6px currentColor;
  pointer-events: none;
  user-select: none;
}
```

### Per-Frame Update

Called from `SceneManager.update()` every RAF frame:

```js
update(deltaTime, masterState) {
  for (const [driverNumber, driver] of Object.entries(masterState.drivers)) {
    const dot = this.dots[driverNumber];
    if (!dot || driver.isOnPitLane) {
      if (dot) dot.visible = false;
      continue;
    }
    dot.visible = true;

    // Handle circular T wrap-around (start/finish line crossing)
    let targetT = driver.targetT;
    let currentT = driver.currentT;
    const diff = targetT - currentT;
    if (diff > 0.5) targetT -= 1.0;      // shorter path backward
    if (diff < -0.5) targetT += 1.0;     // shorter path forward

    // Lerp
    const LERP_RATE = 0.05;
    currentT += (targetT - currentT) * LERP_RATE;
    currentT = ((currentT % 1) + 1) % 1;  // keep in [0, 1]
    driver.currentT = currentT;

    // Get position from spline
    const position = this.spline.getPoint(currentT);
    const tangent = this.spline.getTangent(currentT);
    dot.position.copy(position);

    // Orient dot along track direction
    const up = new THREE.Vector3(0, 1, 0);
    dot.quaternion.setFromUnitVectors(up, tangent.normalize());
  }
}
```

The `LERP_RATE` of 0.05 means the dot closes 5% of the gap to `targetT` each frame. At 60fps this gives smooth 1–2 second glide between API updates. Increase to 0.08–0.10 if dots feel too sluggish.

### Receiving New Location Data

When `masterState.drivers[driverNumber].locationX` changes (detected in the RAF loop by comparing against last-rendered value):

```js
const modelXZ = openF1ToModelXZ(driver.locationX, driver.locationY, circuitData);
const newTargetT = findClosestSplineT(modelXZ.x, modelXZ.z, spline);
driver.targetT = newTargetT;
```

Cache the last rendered `locationDate` per driver to know when new location data has arrived.

---

## 5. PostProcessing.js

**Purpose:** Apply a bloom glow effect to the scene so driver dots appear luminous and cinematic.

Use `EffectComposer` + `UnrealBloomPass` from `three/addons`:

```js
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(1920, 1080),
  1.2,   // strength — how bright/large the bloom is
  0.4,   // radius — how far bloom spreads
  0.75   // threshold — minimum luminance to bloom
         // The circuit mesh has emissiveIntensity 0, so its luminance stays below threshold
         // Driver dots have emissiveIntensity 2.5, which exceeds threshold → bloom
);
composer.addPass(bloomPass);
```

**Important:** Replace `renderer.render(scene, camera)` in the RAF loop with `composer.render()`. Do not call both.

**Selective bloom consideration:** With the threshold at 0.75, only very bright emissive objects (the driver dots) bloom significantly. The dark circuit mesh does not. If the circuit blooms excessively, lower `emissiveIntensity` on the circuit material or increase the bloom threshold.

### Exports

```js
export class PostProcessing {
  constructor(renderer, scene, camera) { ... }
  render() { ... }  // called instead of renderer.render() in RAF loop
  setBloomStrength(value) { ... }  // for tuning
}
```

---

## Scene Init Checklist

Before the RAF loop starts, verify:
- [ ] Renderer is attached to `#three-canvas`, size 1920×1080, alpha transparent
- [ ] CSS2DRenderer is attached to a `<div>` with z-index 5 (between canvas layers)
- [ ] Circuit mesh is loaded and added to scene
- [ ] Circuit material is dark (emissive = 0)
- [ ] Spline is built from circuit JSON centerline points
- [ ] Raycast correction pass has run
- [ ] Camera is positioned and pointed at circuit center
- [ ] All 20 driver dot meshes are created with correct team colors
- [ ] EffectComposer and bloom pass are set up
- [ ] All driver initial `currentT` values set to 0 (or their last known position)
