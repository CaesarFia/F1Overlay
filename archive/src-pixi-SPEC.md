# PixiJS Renderer

## Purpose

`PixiRenderer.js` creates and manages a shared PixiJS application instance for GPU-accelerated 2D rendering of fast-updating graphics. Panels that update more often than once per second and need smooth animated visuals (gap charts, telemetry bars, track evolution curves) render into PixiJS containers rather than HTML/CSS.

---

## Files to Create

- `src/pixi/PixiRenderer.js`

---

## Why PixiJS

HTML/CSS DOM updates are cheap for text and slow-changing data. But drawing 20 smooth animated bars or a real-time line chart in CSS every frame causes layout thrashing. PixiJS renders to a `<canvas>` via WebGL (or Canvas 2D fallback) and is purpose-built for this use case.

---

## PixiRenderer.js

### Application Setup

```js
import * as PIXI from 'pixi.js';

export class PixiRenderer {
  constructor() {
    this.app = new PIXI.Application();
    this.containers = {};  // named containers per panel
  }

  async init() {
    await this.app.init({
      canvas: document.getElementById('pixi-canvas'),
      width: 1920,
      height: 1080,
      backgroundAlpha: 0,          // transparent background
      antialias: true,
      resolution: Math.min(window.devicePixelRatio, 2),
      autoDensity: true,
      hello: false,                // suppress PixiJS console banner
    });

    // Disable PixiJS's own ticker — rendering is driven by RafScheduler
    this.app.ticker.stop();
  }

  // Create a named container for a panel
  createContainer(name, x = 0, y = 0) {
    const container = new PIXI.Container();
    container.x = x;
    container.y = y;
    this.app.stage.addChild(container);
    this.containers[name] = container;
    return container;
  }

  getContainer(name) {
    return this.containers[name];
  }

  // Called every RAF frame by RafScheduler
  render() {
    this.app.renderer.render(this.app.stage);
  }

  destroy() {
    this.app.destroy(false);  // false = don't destroy the canvas element
  }
}
```

### Ticker Disabled

PixiJS auto-starts its own RAF ticker by default. Disable it (`ticker.stop()`) and call `app.renderer.render(app.stage)` manually inside `RafScheduler.tick()`. This ensures exactly one render per RAF frame — no double rendering.

---

## How Panels Use PixiJS

Each panel that needs GPU rendering calls:
```js
const container = pixiRenderer.createContainer('gapChart', 20, 820);
```

Then draws into the container using PixiJS Graphics, Text, or Sprite objects. The container persists between frames; panels only redraw when values change.

### Pattern: Cached Graphics

For bar charts, create `PIXI.Graphics` objects once and call `.clear()` + redraw on update — not `destroy()` + recreate. Recreating graphics every frame is expensive.

```js
// Setup (once):
this.bar = new PIXI.Graphics();
container.addChild(this.bar);

// Update (every frame):
this.bar.clear();
this.bar.rect(0, 0, barWidth, 20).fill({ color: teamColorInt });
```

### Team Colors in PixiJS

PixiJS colors are integers. Convert from hex string:
```js
// in colorUtils.js:
export function hexToInt(hex) {
  return parseInt(hex.replace('#', ''), 16);
}
```

---

## Panels That Use PixiJS

### Gap Chart (`src/panels/GapChart/GapChart.js`)

Container position: approximately `x: 20, y: 820` (bottom-left)
Container size: 480×220

One `PIXI.Graphics` bar per driver (20 total), created at init.

Per-frame update:
1. Sort drivers by race position
2. For each driver, compute bar width: `width = (numericGap / 60) * 440` (60 seconds = full width)
3. Smoothly lerp each bar's current width toward target width:
   `bar.currentWidth += (bar.targetWidth - bar.currentWidth) * 0.1`
4. Clear and redraw the bar at its lerped width
5. Update driver abbreviation text (only if position changed)

### Strategy Panel — Track Evolution Chart (`src/panels/StrategyPanel/StrategyPanel.js`)

Container position: approximately `x: 1430, y: 700`
Container size: 450×180

Draw a line chart using `PIXI.Graphics`:
- X axis = lap number
- Y axis = session best lap time (inverted: faster times higher up)
- One `lineTo` segment per lap data point
- Redraw the full line on each `/laps` update (every 15 seconds — not every frame)

### Telemetry Bars (optional PixiJS upgrade)

The telemetry bars can be HTML/CSS (as described in the Panels spec) OR PixiJS bars. If CSS approach causes jank, migrate them to PixiJS. Start with CSS; only migrate if needed.

---

## PixiJS Version Note

This project uses PixiJS v8. The API changed significantly from v7:
- `PIXI.Graphics` now uses a method-chaining fluent API: `.rect(x,y,w,h).fill(color)` instead of `.beginFill(color).drawRect(...).endFill()`
- `PIXI.Application.init()` is now async
- Background color uses `backgroundAlpha` for transparency, not `backgroundColor: 0x000000` with transparent flag

Use the v8 API throughout. Do not follow v7 examples from older tutorials.
