# Project Setup

## Goal

Scaffold the Vite + vanilla JavaScript project that serves as the shell for the F1 overlay. This is an OBS Browser Source delivered as a static HTML page. No framework, no TypeScript — plain ES modules with Vite as the build/dev server.

> **Note:** Vite was chosen for its native GLB asset handling and fast HMR. If you have a strong reason to prefer a different build tool, discuss before changing — the GLB import pattern depends on Vite's asset pipeline.

---

## Prerequisites

- Node.js ≥ 18
- npm ≥ 9

---

## Project Scaffold

```bash
npm create vite@latest . -- --template vanilla
```

Run this in the repo root (the `.` means current directory). When prompted, confirm overwriting.

---

## package.json

Replace the scaffolded `package.json` with the following. Pin versions at or above these minimums:

```json
{
  "name": "f1-overlay",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "three": "^0.165.0",
    "gsap": "^3.12.0",
    "pixi.js": "^8.0.0",
    "@mediapipe/tasks-vision": "^0.10.0"
  },
  "devDependencies": {
    "vite": "^5.0.0"
  }
}
```

Run `npm install` after writing this file.

---

## vite.config.js

```js
import { defineConfig } from 'vite';

export default defineConfig({
  assetsInclude: ['**/*.glb'],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: 'esnext',
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          pixi: ['pixi.js'],
          gsap: ['gsap'],
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
});
```

The `assetsInclude: ['**/*.glb']` line tells Vite to treat `.glb` files as static assets and return a URL string when imported. This is required for the Three.js GLTFLoader pattern:

```js
import miamiUrl from '../circuits/miami/miami.glb';
// miamiUrl is now a string like '/assets/miami-abc123.glb'
new GLTFLoader().load(miamiUrl, (gltf) => { ... });
```

---

## index.html

This is the OBS Browser Source entry point. It must be 1920×1080 with a transparent background and no scrolling.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=1920, height=1080, initial-scale=1.0" />
  <title>F1 Overlay</title>
  <link rel="stylesheet" href="/src/styles/base.css" />
</head>
<body>
  <!-- Layer 1: Three.js 3D circuit (background) -->
  <canvas id="three-canvas"></canvas>

  <!-- Layer 2: PixiJS GPU canvas (fast-updating graphics) -->
  <canvas id="pixi-canvas"></canvas>

  <!-- Layer 3: HTML/CSS panels (text, timing data) -->
  <div id="panels"></div>

  <!-- Hidden video feed for MediaPipe gesture detection -->
  <video id="gesture-video" autoplay playsinline muted></video>

  <!-- Dev only: gesture skeleton overlay (remove in production) -->
  <canvas id="gesture-debug" style="display:none;"></canvas>

  <script type="module" src="/src/main.js"></script>
</body>
</html>
```

---

## src/styles/base.css

Create `src/styles/base.css` with this content:

```css
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body {
  width: 1920px;
  height: 1080px;
  overflow: hidden;
  background: transparent !important;
  font-family: 'Formula1', 'Orbitron', monospace;
}

canvas,
#panels,
#gesture-debug {
  position: absolute;
  top: 0;
  left: 0;
  width: 1920px;
  height: 1080px;
  pointer-events: none;
}

#three-canvas  { z-index: 1; }
#pixi-canvas   { z-index: 2; }
#panels        { z-index: 10; }
#gesture-debug { z-index: 99; }

#gesture-video {
  position: absolute;
  top: -9999px;
  left: -9999px;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
```

---

## src/main.js (shell)

Create `src/main.js` as an empty shell that will be filled in once other modules are ready. It must execute the startup sequence defined in `ARCHITECTURE.md`. For now, export a placeholder:

```js
// Entry point — see ARCHITECTURE.md for startup sequence
// Implement after: worker, state, scene, animation, panels, gestures are all ready
console.log('[F1 Overlay] main.js loaded');
```

---

## Directory Structure to Create Now

Create these empty directories (create a `.gitkeep` file inside each so git tracks them):

```
src/api/
src/worker/
src/state/
src/derived/
src/scene/
src/panels/
src/pixi/
src/gestures/
src/animation/
src/utils/
src/styles/
circuits/
public/fonts/
```

---

## Dev Server Usage

```bash
npm run dev
```

Open `http://localhost:5173` in a browser. In OBS, add a Browser Source pointing to `http://localhost:5173` with width 1920, height 1080, and "Custom CSS" set to `body { background: transparent !important; }`.

For production, run `npm run build` and serve the `dist/` folder as a static site, or point OBS directly to the built `dist/index.html` as a local file.

---

## Font

The overlay targets an F1-style aesthetic. The recommended font is **Formula1 Display** (the official F1 font, available on the F1 website's asset pack or via community redistribution). Place font files in `public/fonts/` and register them in `base.css`:

```css
@font-face {
  font-family: 'Formula1';
  src: url('/fonts/Formula1-Display-Regular.woff2') format('woff2');
  font-weight: 400;
}
@font-face {
  font-family: 'Formula1';
  src: url('/fonts/Formula1-Display-Bold.woff2') format('woff2');
  font-weight: 700;
}
@font-face {
  font-family: 'Formula1';
  src: url('/fonts/Formula1-Display-Wide.woff2') format('woff2');
  font-weight: 900;
}
```

If the official font is unavailable, fall back to `Orbitron` from Google Fonts.
