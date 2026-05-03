# Track Map Source

## Purpose

The `track-map` source is the visual centerpiece of the overlay. It renders a 3D model of the Miami circuit with 20 glowing driver dots traveling along the track in near real-time. Data comes from historical batch-fetched OpenF1 location records played back via `shared/playback.js`. The source runs standalone as an OBS Browser Source.

---

## Files to Create

```
sources/track-map/
├── index.html      ← OBS browser source entry point (1920×1080, transparent)
├── main.js         ← startup sequence + RAF loop (see detailed spec below)
├── scene.js        ← Three.js renderer, camera, lighting → exports SceneManager
├── circuit.js      ← GLB load, spline build, raycast correction → exports CircuitLoader
├── drivers.js      ← 20 dot meshes + CSS2D labels + lerp → exports DriverDotManager
├── transform.js    ← coordinate math → exports openF1ToModelXZ, findClosestT
└── postfx.js       ← UnrealBloomPass setup → exports PostProcessing
```

`dev-panel.js` is also in this directory but is **never imported statically** — see the Dev Panel section.

---

## index.html

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=1920, height=1080, initial-scale=1.0" />
  <title>F1 Overlay — Track Map</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 1920px; height: 1080px;
      overflow: hidden;
      background: transparent !important;
    }
    canvas { position: absolute; top: 0; left: 0; }
    #css2d-layer { position: absolute; top: 0; left: 0;
                   width: 1920px; height: 1080px; pointer-events: none; }
    .driver-label {
      font-family: 'Formula1', 'Orbitron', monospace;
      font-size: 11px; font-weight: 700; color: inherit;
      text-shadow: 0 0 6px currentColor;
      pointer-events: none; user-select: none;
    }
  </style>
</head>
<body>
  <canvas id="three-canvas"></canvas>
  <div id="css2d-layer"></div>
  <script type="module" src="./main.js"></script>
</body>
</html>
```

---

## main.js — Startup Sequence

```js
import { MIAMI_SESSION_KEY } from '../../shared/constants.js';
import { fetchAllLocationData, fetchDrivers, fetchLaps, calculateBounds } from '../../shared/api.js';
import * as playback from '../../shared/playback.js';
import * as driverData from '../../shared/drivers.js';
import { SceneManager } from './scene.js';
import { CircuitLoader } from './circuit.js';
import { DriverDotManager } from './drivers.js';
import { PostProcessing } from './postfx.js';

async function main() {
  // 1. Parse URL params
  const params   = new URLSearchParams(window.location.search);
  const speed    = parseFloat(params.get('speed') ?? '1.0');
  const startLap = params.has('start') ? parseInt(params.get('start'), 10) : null;
  const devMode  = params.has('dev');

  // 2. Batch fetch — all three in parallel
  const [locationRecords, driversArray, lapsData] = await Promise.all([
    fetchAllLocationData(MIAMI_SESSION_KEY),
    fetchDrivers(MIAMI_SESSION_KEY),
    fetchLaps(MIAMI_SESSION_KEY),
  ]);

  // 3. Compute openF1Bounds from actual data
  const openF1Bounds = calculateBounds(locationRecords);

  // 4. Build per-driver record index
  const recordsByDriver = {};
  for (const record of locationRecords) {
    const key = String(record.driver_number);
    (recordsByDriver[key] ??= []).push(record);
    // Records are globally sorted by date, so per-driver arrays are also in order
  }
  const driverPlaybackIndex = Object.fromEntries(
    Object.keys(recordsByDriver).map(k => [k, 0])
  );

  // 5. Compute startOffsetMs from laps data
  let startOffsetMs = 0;
  if (startLap !== null) {
    const lapEntries = lapsData.filter(l => l.lap_number === startLap && l.date_start);
    if (lapEntries.length > 0) {
      const lapStartEpoch = Math.min(...lapEntries.map(l => new Date(l.date_start).getTime()));
      startOffsetMs = lapStartEpoch - new Date(locationRecords[0].date).getTime();
    } else {
      console.warn(`[main] Lap ${startLap} not found in laps data — starting from beginning`);
    }
  }

  // 6. Initialize shared modules
  playback.init(locationRecords, { speed, startOffsetMs });
  driverData.init(driversArray);

  // 7. Set up Three.js scene
  const scene = new SceneManager(document.getElementById('three-canvas'));

  // 8. Load circuit — computes modelBounds internally from GLB mesh
  const { spline, modelBounds } = await CircuitLoader.load('miami', scene.scene);
  scene.positionCamera(modelBounds);

  // 9. Set up driver dots
  const dots = new DriverDotManager(
    scene.scene,
    document.getElementById('css2d-layer'),
    scene.camera,
    scene.renderer,
    spline,
    driverData.getAllDrivers()
  );

  // 10. Set up bloom
  const postfx = new PostProcessing(scene.renderer, scene.scene, scene.camera);

  // 11. Pre-seek all driver indices to startLap position
  if (startLap !== null) {
    const startTime = playback.getCurrentSessionTime();
    for (const [key, records] of Object.entries(recordsByDriver)) {
      let idx = 0;
      while (idx + 1 < records.length &&
             new Date(records[idx + 1].date).getTime() <= startTime) idx++;
      driverPlaybackIndex[key] = idx;
    }
  }

  // 12. Conditionally load dev panel (DYNAMIC IMPORT — never loaded unless ?dev)
  let devPanel = null;
  if (devMode) {
    const { DevPanel } = await import('./dev-panel.js');
    devPanel = new DevPanel({
      onSpeedChange:  (v) => playback.setSpeed(v),
      onJumpToLap:    (n) => { playback.jumpToLap(n, lapsData); preseeekAfterJump(); },
      onBloomToggle:  (en) => postfx.setEnabled(en),
      onLabelsToggle: (v) => dots.setLabelsVisible(v),
      onSplineToggle: (v) => CircuitLoader.setSplineVisible(v),
      onCameraReset:  () => scene.positionCamera(modelBounds),
      getPlayback:    () => playback,
      getTotalRecords: () => locationRecords.length,
    });
    devPanel.mount();
  }

  // 13. Start RAF loop
  requestAnimationFrame(tick);

  function preseeekAfterJump() {
    const t = playback.getCurrentSessionTime();
    for (const [key, records] of Object.entries(recordsByDriver)) {
      let idx = driverPlaybackIndex[key];
      // Allow seeking backward too (jump can go backward)
      idx = 0;
      while (idx + 1 < records.length &&
             new Date(records[idx + 1].date).getTime() <= t) idx++;
      driverPlaybackIndex[key] = idx;
    }
  }

  function getTotalProcessedCount() {
    return Object.values(driverPlaybackIndex).reduce((s, i) => s + i, 0);
  }

  function tick() {
    const sessionTime = playback.getCurrentSessionTime();

    // Advance each driver's index to the current session time
    for (const [driverNum, records] of Object.entries(recordsByDriver)) {
      let idx = driverPlaybackIndex[driverNum];
      while (idx + 1 < records.length &&
             new Date(records[idx + 1].date).getTime() <= sessionTime) idx++;
      driverPlaybackIndex[driverNum] = idx;
      dots.updateTarget(driverNum, records[idx], openF1Bounds, modelBounds);
    }

    dots.lerpAll();
    postfx.render();
    devPanel?.tick(sessionTime, getTotalProcessedCount());

    requestAnimationFrame(tick);
  }
}

main().catch(err => {
  console.error('[track-map] Startup failed:', err);
  document.body.innerHTML = `<pre style="color:red;padding:20px">${err.stack}</pre>`;
});
```

---

## scene.js — SceneManager

**Exports:** `SceneManager` class

```js
export class SceneManager {
  constructor(canvas) {
    // Create WebGLRenderer with alpha: true, antialias: true
    // Set size 1920×1080, pixelRatio min(devicePixelRatio, 2)
    // setClearColor(0x000000, 0) — fully transparent
    // toneMapping: ACESFilmic, toneMappingExposure: 1.2
    this.renderer = ...;
    this.scene    = new THREE.Scene();
    this.camera   = new THREE.PerspectiveCamera(CAMERA_FOV, 1920/1080, 0.01, 1000);

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(0, 10, 5);
    scene.add(dir);
  }

  positionCamera(modelBounds) {
    // Compute circuit center and size from modelBounds
    const cx = (modelBounds.minX + modelBounds.maxX) / 2;
    const cz = (modelBounds.minZ + modelBounds.maxZ) / 2;
    const sizeX = modelBounds.maxX - modelBounds.minX;
    const sizeZ = modelBounds.maxZ - modelBounds.minZ;
    const height = Math.max(sizeX, sizeZ) * CAMERA_HEIGHT_MULTIPLIER;
    this.camera.position.set(cx, height, cz + sizeZ * CAMERA_TILT_Z_MULTIPLIER);
    this.camera.lookAt(cx, 0, cz);
    this._defaultCameraPosition = this.camera.position.clone();
    this._defaultCameraTarget   = new THREE.Vector3(cx, 0, cz);
  }

  resetCamera() {
    this.camera.position.copy(this._defaultCameraPosition);
    this.camera.lookAt(this._defaultCameraTarget);
  }
}
```

---

## circuit.js — CircuitLoader

**Exports:** `CircuitLoader` (static methods)

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

export class CircuitLoader {
  static _splineLine = null;  // THREE.Line for dev panel spline visibility toggle

  /**
   * Load miami.glb + miami.json, build spline, run raycast correction.
   * @param {string} circuitKey  e.g. 'miami'
   * @param {THREE.Scene} scene
   * @returns {{ spline: THREE.CatmullRomCurve3, modelBounds: object }}
   */
  static async load(circuitKey, scene) {
    // 1. Dynamic import of GLB URL (Vite asset pipeline)
    const glbModule = await import(`../../circuits/${circuitKey}.glb`);
    const glbUrl = glbModule.default;

    // 2. Load GLB
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(glbUrl);
    const mesh = gltf.scene.children[0];

    // 3. Apply dark circuit material
    mesh.material = new THREE.MeshStandardMaterial({
      color:     0x1a1a2e,
      roughness: 0.85,
      metalness: 0.0,
      emissive:  0x000000,  // zero emissive — track must not bloom
    });
    scene.add(mesh);

    // 4. Compute modelBounds from loaded geometry
    const box = new THREE.Box3().setFromObject(mesh);
    const modelBounds = {
      minX: box.min.x, maxX: box.max.x,
      minZ: box.min.z, maxZ: box.max.z,
    };

    // 5. Load circuit JSON (centerlinePoints)
    const jsonModule = await import(`../../circuits/${circuitKey}.json`);
    const circuitData = jsonModule.default;
    const rawPoints = circuitData.centerlinePoints.map(
      p => new THREE.Vector3(p.x, p.y, p.z)
    );

    // 6. Raycast-correct each point to mesh surface (one-time startup cost)
    const raycaster = new THREE.Raycaster();
    const correctedPoints = rawPoints.map(p => {
      raycaster.set(
        new THREE.Vector3(p.x, p.y + 5, p.z),
        new THREE.Vector3(0, -1, 0)
      );
      const hits = raycaster.intersectObject(mesh, true);
      if (hits.length > 0) {
        return hits[0].point.clone().add(new THREE.Vector3(0, CENTERLINE_RAYCAST_OFFSET, 0));
      }
      return p;
    });

    // 7. Build closed spline
    const spline = new THREE.CatmullRomCurve3(correctedPoints, true, 'catmullrom', SPLINE_TENSION);

    // 8. Build debug spline line (visible only in dev mode when toggled)
    const points = spline.getPoints(500);
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    CircuitLoader._splineLine = new THREE.Line(
      lineGeo,
      new THREE.LineBasicMaterial({ color: 0x00ff88, opacity: 0.4, transparent: true })
    );
    CircuitLoader._splineLine.visible = false;
    scene.add(CircuitLoader._splineLine);

    return { spline, modelBounds };
  }

  static setSplineVisible(visible) {
    if (CircuitLoader._splineLine) CircuitLoader._splineLine.visible = visible;
  }
}
```

---

## drivers.js — DriverDotManager

**Exports:** `DriverDotManager` class

This file is source-local (not `shared/drivers.js`). It manages the Three.js meshes for the 20 driver dots.

```js
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { openF1ToModelXZ, findClosestT } from './transform.js';
import { LERP_RATE, DOT_RADIUS, DOT_EMISSIVE_INTENSITY } from '../../shared/constants.js';

export class DriverDotManager {
  constructor(scene, css2dContainer, camera, renderer, spline, allDrivers) {
    this.scene    = scene;
    this.spline   = spline;
    this.dots     = {};  // { [driverNumber]: { mesh, currentT, targetT } }
    this.labelsVisible = true;

    // Set up CSS2DRenderer for billboard labels
    this.css2dRenderer = new CSS2DRenderer({ element: css2dContainer });
    this.css2dRenderer.setSize(1920, 1080);
    this._camera   = camera;
    this._renderer = renderer;

    // Create one dot mesh per driver
    for (const driver of allDrivers) {
      this._createDot(driver);
    }
  }

  _createDot(driver) {
    const color = new THREE.Color(driver.teamColor);
    const geo   = new THREE.SphereGeometry(DOT_RADIUS, 16, 16);
    const mat   = new THREE.MeshStandardMaterial({
      color:             color,
      emissive:          color,
      emissiveIntensity: DOT_EMISSIVE_INTENSITY,
      roughness:         0.2,
    });
    const mesh = new THREE.Mesh(geo, mat);

    // Billboard label
    const labelDiv = document.createElement('div');
    labelDiv.className = 'driver-label';
    labelDiv.textContent = driver.abbreviation;
    labelDiv.style.color = driver.teamColor;
    const label = new CSS2DObject(labelDiv);
    label.position.set(0, 0.25, 0);
    mesh.add(label);

    this.scene.add(mesh);
    this.dots[driver.driverNumber] = { mesh, currentT: 0, targetT: 0, label };
  }

  updateTarget(driverNumber, record, openF1Bounds, modelBounds) {
    const dot = this.dots[String(driverNumber)];
    if (!dot || !record) return;
    const { x: modelX, z: modelZ } = openF1ToModelXZ(record.x, record.y, openF1Bounds, modelBounds);
    dot.targetT = findClosestT(modelX, modelZ, this.spline);
  }

  lerpAll() {
    for (const dot of Object.values(this.dots)) {
      let { currentT, targetT } = dot;

      // Circular T wrap-around — always take the shorter path
      const diff = targetT - currentT;
      if (diff >  0.5) targetT -= 1.0;
      if (diff < -0.5) targetT += 1.0;

      currentT += (targetT - currentT) * LERP_RATE;
      currentT = ((currentT % 1) + 1) % 1;  // keep in [0, 1]
      dot.currentT = currentT;

      const pos     = this.spline.getPoint(currentT);
      const tangent = this.spline.getTangent(currentT);
      dot.mesh.position.copy(pos);

      // Orient along track direction
      const up = new THREE.Vector3(0, 1, 0);
      dot.mesh.quaternion.setFromUnitVectors(up, tangent.normalize());
    }

    // CSS2DRenderer must render after mesh positions update
    this.css2dRenderer.render(this.scene, this._camera);
  }

  setLabelsVisible(visible) {
    this.labelsVisible = visible;
    for (const { label } of Object.values(this.dots)) {
      label.element.style.display = visible ? '' : 'none';
    }
  }
}
```

---

## transform.js — Coordinate Transform

**Exports:** `openF1ToModelXZ`, `findClosestT`

Takes bounds as parameters — does not read from JSON or any module-level state.

```js
import { SPLINE_SAMPLE_COUNT } from '../../shared/constants.js';

/**
 * Convert OpenF1 (x, y) to Three.js model (x, z).
 * OpenF1 Y maps to Three.js Z because the ground plane in Y-up is XZ.
 *
 * @param {number} openF1X
 * @param {number} openF1Y
 * @param {{ minX, maxX, minY, maxY }} openF1Bounds — from calculateBounds()
 * @param {{ minX, maxX, minZ, maxZ }} modelBounds  — from THREE.Box3 on mesh
 * @returns {{ x: number, z: number }}
 */
export function openF1ToModelXZ(openF1X, openF1Y, openF1Bounds, modelBounds) {
  const normX = (openF1X - openF1Bounds.minX) / (openF1Bounds.maxX - openF1Bounds.minX);
  const normY = (openF1Y - openF1Bounds.minY) / (openF1Bounds.maxY - openF1Bounds.minY);
  return {
    x: modelBounds.minX + normX * (modelBounds.maxX - modelBounds.minX),
    z: modelBounds.minZ + normY * (modelBounds.maxZ - modelBounds.minZ),
  };
}

/**
 * Find the closest t parameter [0,1] on a closed spline to a model-space (x, z) point.
 * Linear scan over SPLINE_SAMPLE_COUNT samples.
 * Returns t in [0, 1].
 */
export function findClosestT(modelX, modelZ, spline) {
  let closestT = 0;
  let closestDist = Infinity;
  for (let i = 0; i <= SPLINE_SAMPLE_COUNT; i++) {
    const t = i / SPLINE_SAMPLE_COUNT;
    const p = spline.getPoint(t);
    const d = (p.x - modelX) ** 2 + (p.z - modelZ) ** 2;
    if (d < closestDist) {
      closestDist = d;
      closestT = t;
    }
  }
  return closestT;
}
```

---

## postfx.js — PostProcessing

**Exports:** `PostProcessing` class

```js
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD } from '../../shared/constants.js';

export class PostProcessing {
  constructor(renderer, scene, camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(1920, 1080),
      BLOOM_STRENGTH,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD
    );
    this.composer.addPass(this.bloomPass);
    this._enabled = true;
  }

  render() {
    this.composer.render();
  }

  setEnabled(enabled) {
    this._enabled = enabled;
    this.bloomPass.enabled = enabled;
  }
}
```

**Call `postfx.render()` instead of `renderer.render()` in the RAF loop.** Never call both.

---

## dev-panel.js — Dev Panel

**Dynamically imported** — never statically imported. When `?dev` is absent from the URL, this file is never fetched.

```js
import {
  MIN_PLAYBACK_SPEED, MAX_PLAYBACK_SPEED, FPS_UPDATE_INTERVAL
} from '../../shared/constants.js';

export class DevPanel {
  /**
   * All scene/playback access is via callbacks — this file has no direct
   * references to Three.js, the scene, or other modules. This ensures
   * Vite's code-splitting keeps dev-panel.js in a separate chunk.
   */
  constructor({
    onSpeedChange,    // (number) → void
    onJumpToLap,      // (number) → void
    onBloomToggle,    // (boolean) → void
    onLabelsToggle,   // (boolean) → void
    onSplineToggle,   // (boolean) → void
    onCameraReset,    // () → void
    getPlayback,      // () → playback module ref
    getTotalRecords,  // () → number
  }) {
    this._cb = { onSpeedChange, onJumpToLap, onBloomToggle, onLabelsToggle,
                 onSplineToggle, onCameraReset, getPlayback, getTotalRecords };
    this._element = null;
    this._fpsFrames = 0;
    this._fpsLastUpdate = 0;
    this._fpsEl = null;
    this._timeEl = null;
    this._countEl = null;
    this._build();
  }

  _build() {
    const el = document.createElement('div');
    el.id = 'dev-panel';
    Object.assign(el.style, {
      position: 'fixed', top: '10px', left: '10px',
      width: '280px', padding: '12px', zIndex: '999',
      background: 'rgba(10,10,20,0.9)',
      color: '#fff', fontFamily: 'monospace', fontSize: '12px',
      borderRadius: '6px', lineHeight: '1.6',
    });

    const h = (tag, text, style = {}) => {
      const node = document.createElement(tag);
      node.textContent = text;
      Object.assign(node.style, style);
      return node;
    };
    const row = (label, control) => {
      const d = document.createElement('div');
      d.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin:4px 0;';
      d.append(h('span', label), control);
      return d;
    };

    // Title
    el.append(h('div', 'DEV', { fontWeight: 'bold', marginBottom: '8px', color: '#ff6b35' }));

    // Read-only displays
    this._fpsEl   = h('div', 'FPS: --');
    this._timeEl  = h('div', 'Time: --', { fontSize: '10px', opacity: '0.7' });
    this._countEl = h('div', 'Records: -- / --', { fontSize: '10px', opacity: '0.7' });
    el.append(this._fpsEl, this._timeEl, this._countEl);

    // Speed slider
    const speedSlider = document.createElement('input');
    speedSlider.type = 'range';
    speedSlider.min = MIN_PLAYBACK_SPEED; speedSlider.max = MAX_PLAYBACK_SPEED;
    speedSlider.step = '0.1'; speedSlider.value = '1.0';
    speedSlider.style.width = '120px';
    speedSlider.addEventListener('input', () => {
      this._cb.onSpeedChange(parseFloat(speedSlider.value));
    });
    el.append(row('Speed', speedSlider));

    // Lap jump
    const lapInput = document.createElement('input');
    lapInput.type = 'number'; lapInput.min = '1'; lapInput.value = '1';
    lapInput.style.cssText = 'width:50px;background:#222;color:#fff;border:1px solid #555;padding:2px;';
    const lapBtn = document.createElement('button');
    lapBtn.textContent = 'Jump';
    lapBtn.style.cssText = 'margin-left:4px;background:#333;color:#fff;border:1px solid #555;padding:2px 6px;cursor:pointer;';
    lapBtn.addEventListener('click', () => this._cb.onJumpToLap(parseInt(lapInput.value, 10)));
    const lapRow = document.createElement('div');
    lapRow.style.margin = '4px 0';
    lapRow.append(document.createTextNode('Lap: '), lapInput, lapBtn);
    el.append(lapRow);

    // Checkboxes
    const check = (label, defaultOn, onChange) => {
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = defaultOn;
      cb.addEventListener('change', () => onChange(cb.checked));
      return row(label, cb);
    };
    el.append(
      check('Bloom',    true,  (v) => this._cb.onBloomToggle(v)),
      check('Labels',   true,  (v) => this._cb.onLabelsToggle(v)),
      check('Spline',   false, (v) => this._cb.onSplineToggle(v)),
    );

    // Reset camera
    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset Camera';
    resetBtn.style.cssText = 'width:100%;margin-top:6px;background:#333;color:#fff;border:1px solid #555;padding:4px;cursor:pointer;';
    resetBtn.addEventListener('click', () => this._cb.onCameraReset());
    el.append(resetBtn);

    this._element = el;
  }

  mount() {
    document.body.appendChild(this._element);
    this._fpsLastUpdate = performance.now();
  }

  tick(sessionTimeMs, processedCount) {
    this._fpsFrames++;
    const now = performance.now();
    if (now - this._fpsLastUpdate >= FPS_UPDATE_INTERVAL) {
      const elapsed = (now - this._fpsLastUpdate) / 1000;
      this._fpsEl.textContent   = `FPS: ${Math.round(this._fpsFrames / elapsed)}`;
      this._timeEl.textContent  = `Time: ${new Date(sessionTimeMs).toISOString()}`;
      this._countEl.textContent = `Records: ${processedCount} / ${this._cb.getTotalRecords()}`;
      this._fpsFrames = 0;
      this._fpsLastUpdate = now;
    }
  }
}
```

---

## Coordinate System Reference

```
Three.js Y-up:
  Y = elevation (up)
  X = right
  Z = toward viewer

Track surface ≈ XZ plane (Y = elevation variation)
Camera: above the track, looking slightly downward + angled

OpenF1 /location:
  x → model X  (east/west)
  y → model Z  (north/south — maps to Z because ground plane is XZ in Y-up)
  z → elevation (used only during Blender centerline recording, not in transform)
```
