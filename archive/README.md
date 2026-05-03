# Archive — Future Live-Mode Architecture

These spec files describe the **planned live-mode architecture** for a future version of this project. They are not the current active design.

## Current Architecture

The active implementation uses **historical playback only** (Miami 2024 session data via OpenF1 REST, no authentication). Each panel is a standalone OBS browser source that independently batch-fetches and plays back the full session dataset. See `ARCHITECTURE.md` and the spec files in `sources/` and `shared/` for the active design.

## What These Files Describe

The archived specs describe a more complex future architecture featuring:

- A **Web Worker** that polls or receives WebSocket data in real time
- **OAuth2 authentication** for the OpenF1 paid tier (€9.90/month)
- **MQTT-over-WebSocket** (`wss://mqtt.openf1.org:8084/mqtt`) for low-latency location push
- A **single `LIVE_MODE` constant** that switches the entire data source
- A **global `masterState` object** shared via `applyPatch()` across all panels in one browser context
- **MediaPipe Tasks Vision** gesture control (see `src-gestures-SPEC.md`)
- **PixiJS v8** GPU-accelerated gap charts and telemetry bars
- **GSAP** animated timing tower row reordering and race control messages
- **Derived calculations** (tire degradation, undercut windows, crossover laps) running in the worker

## File Index

| File | Was | Describes |
|---|---|---|
| `src-api-SPEC.md` | `src/api/SPEC.md` | REST wrappers, OAuth2 auth module, MQTT client |
| `src-worker-SPEC.md` | `src/worker/SPEC.md` | Dual-mode polling worker with LIVE_MODE constant |
| `src-state-SPEC.md` | `src/state/SPEC.md` | Global masterState schema and applyPatch() |
| `src-derived-SPEC.md` | `src/derived/SPEC.md` | Tire deg, fuel correction, undercut, crossover lap formulas |
| `src-scene-SPEC.md` | `src/scene/SPEC.md` | Three.js scene (largely still applicable to track-map source) |
| `src-panels-SPEC.md` | `src/panels/SPEC.md` | PanelManager + all 7 panel definitions |
| `src-gestures-SPEC.md` | `src/gestures/SPEC.md` | MediaPipe Hands setup + gesture vocabulary |
| `src-animation-SPEC.md` | `src/animation/SPEC.md` | RafScheduler with GSAP integration |
| `src-pixi-SPEC.md` | `src/pixi/SPEC.md` | Shared PixiJS application instance |
| `circuits-SPEC.md` | `circuits/SPEC.md` | Old circuit JSON schema (included openF1Bounds, modelBounds, calibrationPoints) |

## When to Revisit These

When the project advances to live streaming:
1. Start with `src-worker-SPEC.md` — the `LIVE_MODE` constant and MQTT connection architecture
2. `src-api-SPEC.md` — OAuth2 token flow and authenticated REST calls
3. `src-gestures-SPEC.md` — the gesture vocabulary is fully specified and ready to implement
4. `src-panels-SPEC.md` — the timing tower GSAP animation patterns
5. `src-derived-SPEC.md` — all derived analytics (tire deg, undercut windows, etc.)
