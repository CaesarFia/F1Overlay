# Animation & RAF Loop

## Purpose

`RafScheduler.js` owns the single `requestAnimationFrame` loop that drives all rendering. Every frame, it reads from `masterState`, updates the Three.js scene, updates PixiJS, and updates HTML panels. Nothing renders outside of this loop.

---

## Files to Create

- `src/animation/RafScheduler.js`

---

## Design Rules

1. **One RAF loop.** Never call `requestAnimationFrame` anywhere else in the codebase. All rendering goes through `RafScheduler`.

2. **No DOM updates from poll callbacks.** The worker's `postMessage` handler calls `applyPatch(patch)`. That's it — it does not touch the DOM. The RAF loop reads the patch's effects from `masterState` on the next frame.

3. **Delta time is capped.** If the tab is hidden and then restored, the first frame after restore has a huge deltaTime. Cap at 100ms to prevent position jumps.

4. **GSAP and RAF coexist.** GSAP by default uses its own `requestAnimationFrame`. To avoid double-RAF overhead, register GSAP as a Three.js update step by calling `gsap.ticker.tick()` manually inside the RAF loop and disabling GSAP's own ticker:
   ```js
   gsap.ticker.remove(gsap.updateRoot);
   // Then inside each RAF frame:
   gsap.updateRoot(timestamp / 1000);
   ```
   This is optional — test if it measurably improves performance before implementing.

---

## RafScheduler.js

### Initialization

```js
export class RafScheduler {
  constructor({ sceneManager, pixiRenderer, panelManager }) {
    this.sceneManager = sceneManager;
    this.pixiRenderer = pixiRenderer;
    this.panelManager = panelManager;
    this.lastTimestamp = null;
    this.isRunning = false;
    this.rafId = null;
  }

  start() {
    this.isRunning = true;
    this.rafId = requestAnimationFrame(this.tick.bind(this));
  }

  stop() {
    this.isRunning = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }
}
```

### The Tick Function

```js
tick(timestamp) {
  if (!this.isRunning) return;

  // Calculate delta time (seconds)
  const rawDelta = this.lastTimestamp ? (timestamp - this.lastTimestamp) / 1000 : 0.016;
  const delta = Math.min(rawDelta, 0.1);  // cap at 100ms
  this.lastTimestamp = timestamp;

  // 1. Update Three.js scene (driver dot lerp, camera, etc.)
  this.sceneManager.update(delta, masterState);

  // 2. Render Three.js via PostProcessing composer
  this.sceneManager.render();

  // 3. Update HTML panels
  this.panelManager.updateAll(masterState);

  // 4. Render PixiJS
  this.pixiRenderer.render();

  // 5. Tick GSAP manually (if not using auto-mode)
  // gsap.updateRoot(timestamp / 1000);

  // Schedule next frame
  this.rafId = requestAnimationFrame(this.tick.bind(this));
}
```

### Update Order

The order matters:
1. **Scene first** — driver positions update, so CSS2D labels move to correct screen positions
2. **Three.js render** — commits the frame to the canvas
3. **Panels** — read masterState and set `transform` / `textContent` on DOM elements
4. **PixiJS** — redraws GPU canvas (gap charts, telemetry bars)
5. **GSAP** — fires any in-progress tweens

This order ensures the DOM is modified once per frame at the end of the update cycle, not interleaved with reads.

---

## Performance Budget

Target: 60fps = 16.67ms per frame

| Task | Budget |
|---|---|
| Three.js scene update (lerp, etc.) | ~1ms |
| Three.js render (GPU, usually async) | ~5ms |
| Panel DOM updates (20 rows) | ~2ms |
| PixiJS render (GPU, usually async) | ~2ms |
| GSAP tween updates | ~0.5ms |
| **Total** | ~10.5ms (headroom: ~6ms) |

If the frame budget is exceeded, investigate Three.js draw calls first (bloom pass is expensive — tune `UnrealBloomPass` strength/radius down). PixiJS is GPU-accelerated and usually not the bottleneck.

---

## Visibility Change Handling

When the OBS source is hidden, `requestAnimationFrame` may stop firing or fire at a very slow rate. Handle the Page Visibility API:

```js
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    this.stop();     // pause RAF and PixiJS
    worker.postMessage({ type: 'STOP' });   // pause polling
  } else {
    this.start();    // resume RAF
    worker.postMessage({ type: 'START', circuitData });  // resume polling
  }
});
```

This respects OBS's "Shutdown source when not visible" setting and avoids wasted CPU/network when the scene is hidden.

---

## GSAP Configuration

Configure GSAP once at startup in `main.js` before creating any panels:

```js
import { gsap } from 'gsap';

gsap.defaults({
  ease: 'power2.out',
  duration: 0.3,
});

// Optional: install GSAP plugins if needed (e.g., MotionPath for advanced animations)
// gsap.registerPlugin(MotionPathPlugin);
```

GSAP is used for:
- Panel show/hide transitions (opacity, scale)
- Timing tower row reordering (translateY)
- Numeric counter animations on lap time displays
- Race control message slide-in animations
- Battery indicator pulsing during SC/VSC

GSAP is **not** used for:
- Driver dot movement (handled by Three.js lerp + CatmullRomCurve3)
- Telemetry bar updates (CSS transform in RAF loop, no animation needed)
- Gap chart bars (PixiJS handles its own smooth drawing)
