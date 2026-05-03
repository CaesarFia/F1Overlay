# Project Setup

## Goal

Scaffold the Vite + vanilla JavaScript project. Each `sources/*/index.html` is a separate Vite entry point — one per OBS Browser Source. Shared modules live in `shared/`. No TypeScript, no framework, no backend server.

---

## Prerequisites

- Node.js ≥ 18
- npm ≥ 9

---

## Project Scaffold

```bash
npm create vite@latest . -- --template vanilla
```

Run in the repo root. Confirm overwriting when prompted. Then immediately replace `package.json` and `vite.config.js` as described below before running `npm install`.

---

## package.json

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
    "three": "^0.165.0"
  },
  "devDependencies": {
    "vite": "^5.0.0"
  }
}
```

Only `three` is needed for the historical playback phase. The following packages are deferred to later phases:
- `mqtt` — live WebSocket data (see `archive/src-worker-SPEC.md`)
- `pixi.js` — GPU-accelerated charts (see `archive/src-pixi-SPEC.md`)
- `gsap` — panel transition animations
- `@mediapipe/tasks-vision` — gesture control (see `archive/src-gestures-SPEC.md`)

Run `npm install` after writing this file.

---

## vite.config.js

```js
import { defineConfig } from 'vite';
import { resolve } from 'path';

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
      input: {
        'track-map': resolve(__dirname, 'sources/track-map/index.html'),
        'standings':  resolve(__dirname, 'sources/standings/index.html'),
        'gaps':       resolve(__dirname, 'sources/gaps/index.html'),
        'tyres':      resolve(__dirname, 'sources/tyres/index.html'),
      },
    },
  },
});
```

**Key points:**
- `assetsInclude: ['**/*.glb']` — Vite treats `.glb` files as static assets and returns a URL string when imported: `import miamiUrl from '../../circuits/miami.glb'` → `miamiUrl` is the resolved asset path, ready for `GLTFLoader.load()`.
- `rollupOptions.input` — each entry builds independently. No `manualChunks` needed; Vite automatically splits shared modules.
- No `worker: { format: 'es' }` — there are no Web Workers in this architecture.

---

## Dev Server URLs

| Source | URL |
|---|---|
| Track map | `http://localhost:5173/sources/track-map/` |
| Standings | `http://localhost:5173/sources/standings/` |
| Gaps | `http://localhost:5173/sources/gaps/` |
| Tyres | `http://localhost:5173/sources/tyres/` |

---

## Directory Structure to Create

Create these directories with a `.gitkeep` file in each:

```
shared/
sources/track-map/
sources/standings/
sources/gaps/
sources/tyres/
circuits/
public/fonts/
```

The `src/` directory from the Vite scaffold can be deleted — it is not used in this architecture.

---

## index.html Template

Every `sources/*/index.html` follows this pattern (no shared base HTML — each source is fully self-contained):

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=1920, height=1080, initial-scale=1.0" />
  <title>F1 Overlay — [Source Name]</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 1920px;
      height: 1080px;
      overflow: hidden;
      background: transparent !important;
      font-family: 'Formula1', 'Orbitron', monospace;
    }
  </style>
</head>
<body>
  <!-- Source-specific DOM goes here -->
  <script type="module" src="./main.js"></script>
</body>
</html>
```

**OBS requirement:** `background: transparent !important` is mandatory. OBS Browser Sources composite the page over the stream using the page's alpha channel.

The `track-map` source adds canvas elements for Three.js. The panel sources (`standings`, `gaps`, `tyres`) add `<div>` containers for HTML/CSS rendering.

---

## OBS Browser Source Setup

For each source in OBS:
1. Add a new Browser Source
2. URL: `http://localhost:5173/sources/{name}/` (dev) or `file:///path/to/dist/sources/{name}/index.html` (production build)
3. Width: 1920, Height: 1080
4. Custom CSS: `body { background: transparent !important; }`
5. Enable "Shutdown source when not visible" to pause the page when the scene is inactive

URL parameters are appended directly: `http://localhost:5173/sources/track-map/?speed=3&start=25`

---

## Font

Place font files in `public/fonts/`. The Formula1 Display font (official F1 font from the F1 asset pack) is preferred. Register in each source's `<style>` block or a shared imported CSS file:

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
```

Fallback: `Orbitron` from Google Fonts.

---

## Build for Production

```bash
npm run build
```

Outputs to `dist/`. The built structure mirrors the source layout:
```
dist/
├── assets/           ← bundled JS, CSS, GLB files (content-hashed)
├── sources/
│   ├── track-map/index.html
│   ├── standings/index.html
│   ├── gaps/index.html
│   └── tyres/index.html
```

Point OBS to the built `index.html` files using the `file://` protocol for a production setup with no running dev server.

---

## No .env File Needed

Historical playback requires no API authentication. The session key is a plain constant in `shared/constants.js` — change it there to use a different session. When live mode is implemented in a future phase, a `.env` file will be added for OAuth2 credentials (see `archive/src-worker-SPEC.md`).
