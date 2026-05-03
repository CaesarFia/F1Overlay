# Gesture Control

## Purpose

The overlay is controlled entirely via hand gestures using the user's webcam. No keyboard or mouse is needed during a stream. Gestures switch between panels, toggle visibility, and select focused drivers. The MediaPipe Tasks Vision API handles hand detection and landmark tracking.

---

## Files to Create

```
src/gestures/GestureController.js
src/gestures/GestureMap.js
```

---

## Technology

Use **MediaPipe Tasks Vision** (`@mediapipe/tasks-vision`), NOT the older legacy MediaPipe Hands package. The Tasks Vision API is WebAssembly-based, runs in the browser, and requires no server.

```js
import { GestureRecognizer, FilesetResolver } from '@mediapipe/tasks-vision';
```

The WASM assets are served from jsDelivr CDN — do not bundle them locally:
```js
const vision = await FilesetResolver.forVisionTasks(
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm'
);
```

---

## GestureController.js

### Setup

```js
export class GestureController {
  constructor(videoElement, onGesture) {
    // videoElement: the hidden #gesture-video element
    // onGesture: callback(gestureName, handedness) called when a gesture is confirmed
    this.video = videoElement;
    this.onGesture = onGesture;
    this.recognizer = null;
    this.lastGesture = null;
    this.gestureHoldFrames = 0;
    this.isRunning = false;
  }

  async init() {
    // 1. Initialize MediaPipe GestureRecognizer
    // 2. Start webcam stream on this.video
    // 3. Begin detection loop
  }

  async startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' }
    });
    this.video.srcObject = stream;
    await new Promise(resolve => (this.video.onloadeddata = resolve));
  }

  detectLoop() {
    // Run every animation frame or on a setInterval(50ms)
    // MediaPipe Tasks Vision can run in LIVE_STREAM mode
  }

  stop() {
    this.isRunning = false;
    this.video.srcObject?.getTracks().forEach(t => t.stop());
  }
}
```

### Detection Mode

Use `RunningMode.LIVE_STREAM` with a result callback. This is non-blocking — MediaPipe processes frames asynchronously and calls back with results.

```js
const recognizer = await GestureRecognizer.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
    delegate: 'GPU',
  },
  runningMode: 'LIVE_STREAM',
  numHands: 2,
  minHandDetectionConfidence: 0.7,
  minHandPresenceConfidence: 0.7,
  minTrackingConfidence: 0.5,
  resultCallback: (result, image, timestamp) => {
    this.processResult(result);
  },
});
```

Feed frames to the recognizer on a `requestAnimationFrame` loop:
```js
const nowInMs = performance.now();
recognizer.recognizeForVideo(this.video, nowInMs);
```

### Gesture Confirmation (Debouncing)

Raw gesture frames are noisy. A gesture should only fire once after being held for **8 consecutive frames** (~133ms at 60fps). After firing, require a "rest" (no recognized gesture) for **15 frames** before the same gesture can fire again.

```js
processResult(result) {
  const gestures = result.gestures;  // array of gesture arrays per hand
  const topGesture = gestures[0]?.[0]?.categoryName ?? null;  // most confident gesture, first hand

  if (topGesture === this.lastGesture) {
    this.gestureHoldFrames++;
    if (this.gestureHoldFrames === 8) {
      this.fireGesture(topGesture, result.handedness[0]?.[0]?.categoryName);
    }
  } else {
    this.lastGesture = topGesture;
    this.gestureHoldFrames = 0;
  }
}
```

### Camera Access Error Handling

If `getUserMedia` is denied or the camera is unavailable:
- Log a warning: `console.warn('[GestureController] Camera not available. Gesture control disabled.')`
- Do not throw — the overlay functions without gesture control
- The `#gesture-video` element stays hidden

---

## GestureMap.js

Maps recognized MediaPipe gesture names to overlay actions.

### Built-in MediaPipe Gestures

MediaPipe's built-in gesture model recognizes these gestures by name:
- `"None"` — no recognized gesture / open hand flat
- `"Closed_Fist"` — closed fist
- `"Open_Palm"` — open hand, all fingers extended
- `"Pointing_Up"` — index finger pointing up
- `"Thumb_Down"` — thumbs down
- `"Thumb_Up"` — thumbs up
- `"Victory"` — V sign (index + middle finger)
- `"ILoveYou"` — rock/ILY sign

### Gesture-to-Action Mapping

```js
export const GESTURE_ACTIONS = {
  // Swipe isn't a built-in — detect via landmark velocity
  // Use hand landmark X velocity instead:
  'SWIPE_LEFT':  'panel.prev',     // custom (velocity-based)
  'SWIPE_RIGHT': 'panel.next',     // custom (velocity-based)

  // Built-in gesture mappings:
  'Open_Palm':    'overlay.toggle',     // show/hide all panels
  'Closed_Fist':  'overlay.hide',       // hide overlay
  'Thumb_Up':     'overlay.show',       // show overlay
  'Victory':      'telemetry.nextDriver', // cycle telemetry focus driver
  'Pointing_Up':  'panel.timing',       // jump to timing tower
  'Thumb_Down':   'panel.strategy',     // jump to strategy panel
  'ILoveYou':     'panel.raceControl',  // jump to race control panel
};
```

### Swipe Detection (Custom)

MediaPipe returns hand landmarks as 21 3D points. Track the X position of landmark 9 (middle finger MCP joint) across frames. If it moves > 0.15 normalized units in < 10 frames, it's a swipe:

```js
// In GestureController.processResult():
const wristX = result.landmarks[0]?.[9]?.x ?? null;
if (wristX !== null && this.prevWristX !== null) {
  const delta = wristX - this.prevWristX;
  if (Math.abs(delta) > 0.015) {  // per-frame threshold
    this.swipeAccum += delta;
  }
  if (Math.abs(this.swipeAccum) > 0.15) {
    this.fireGesture(this.swipeAccum > 0 ? 'SWIPE_LEFT' : 'SWIPE_RIGHT', null);
    this.swipeAccum = 0;
  }
}
this.prevWristX = wristX;
```

Note: MediaPipe X coordinates are mirrored (0 = right side of video). `wristX` increasing = hand moving left in the mirrored view = physical swipe to the right. Verify swipe direction by testing and reverse if needed.

### Action Dispatcher

In `GestureController`, the `onGesture` callback receives an action string. In `main.js`, wire it to `PanelManager`:

```js
const gestureController = new GestureController(
  document.getElementById('gesture-video'),
  (action) => {
    switch (action) {
      case 'panel.next':    panelManager.nextPanel(); break;
      case 'panel.prev':    panelManager.prevPanel(); break;
      case 'overlay.toggle': panelManager.toggleAll(); break;
      case 'overlay.hide':  panelManager.hideAll(); break;
      case 'overlay.show':  panelManager.showAll(); break;
      case 'panel.timing':  panelManager.showPanel('timing'); break;
      case 'panel.strategy': panelManager.showPanel('strategy'); break;
      case 'panel.raceControl': panelManager.showPanel('raceControl'); break;
      case 'telemetry.nextDriver':
        telemetryPanel.cycleFocusedDriver(); break;
    }
  }
);
```

---

## Debug Overlay (Dev Mode Only)

In development, draw skeleton landmarks on `#gesture-debug` canvas to verify detection:

```js
// In production, gesture-debug has display:none
// In dev mode, enable it:
if (import.meta.env.DEV) {
  document.getElementById('gesture-debug').style.display = 'block';
  // Draw landmarks using canvas 2D context
}
```

Draw a dot at each of the 21 hand landmarks and lines connecting them. This helps verify gesture recognition is working correctly without looking at console logs.

---

## Performance Notes

- MediaPipe WASM runs on a separate thread internally. `recognizeForVideo` is non-blocking.
- Use `delegate: 'GPU'` for WebGL acceleration. Fall back to `'CPU'` if GPU fails.
- The gesture detection loop runs on `requestAnimationFrame`, but MediaPipe processes asynchronously — do not block the RAF loop waiting for results.
- Camera resolution of 640×480 is sufficient. Higher resolution wastes compute.
- The gesture camera is separate from and invisible to the OBS capture — OBS captures the `#three-canvas` / `#pixi-canvas` / `#panels` layers, which do not include the camera feed.
