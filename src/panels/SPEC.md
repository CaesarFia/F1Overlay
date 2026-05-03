# Panel System

## Purpose

The F1 overlay consists of multiple data panels that can be swapped during a stream. The 3D circuit tracker is the persistent background. Data panels overlay on top and are switched via hand gestures. Each panel is a self-contained module that reads from `masterState` and updates its DOM during the RAF loop.

---

## Files to Create

```
src/panels/PanelManager.js
src/panels/TimingTower/TimingTower.js
src/panels/TimingTower/TimingTower.css
src/panels/TelemetryPanel/TelemetryPanel.js
src/panels/TelemetryPanel/TelemetryPanel.css
src/panels/TirePanel/TirePanel.js
src/panels/TirePanel/TirePanel.css
src/panels/WeatherPanel/WeatherPanel.js
src/panels/WeatherPanel/WeatherPanel.css
src/panels/GapChart/GapChart.js
src/panels/GapChart/GapChart.css
src/panels/StrategyPanel/StrategyPanel.js
src/panels/StrategyPanel/StrategyPanel.css
src/panels/RaceControlPanel/RaceControlPanel.js
src/panels/RaceControlPanel/RaceControlPanel.css
```

---

## Panel Interface

Every panel must implement this interface:

```js
class BasePanel {
  constructor(container) {
    // container: the #panels div or a child div within it
    // Build DOM structure here (do NOT use innerHTML from external data — XSS risk)
    this.element = null;  // root DOM element for this panel
  }

  // Called once at setup
  mount(parentElement) { parentElement.appendChild(this.element); }

  // Called every RAF frame; update DOM here
  update(masterState) { ... }

  // Show panel with GSAP transition
  show() { ... }

  // Hide panel with GSAP transition
  hide() { ... }

  // Remove from DOM (called on dispose)
  destroy() { this.element?.remove(); }
}
```

**Critical rule:** All DOM reads/writes inside `update()` must only set CSS `transform` properties or text content. Never read `offsetWidth`, `getBoundingClientRect`, or any layout-triggering property inside the RAF loop.

---

## PanelManager.js

Maintains the panel registry and controls which panel is active.

```js
export class PanelManager {
  constructor(panelsContainer) {
    this.panels = {};        // { [name]: BasePanel instance }
    this.activePanel = null; // name string
    this.container = panelsContainer;
  }

  register(name, panel) { ... }
  // Call once at startup for each panel

  showPanel(name) { ... }
  // Hides the current panel (GSAP fade out), shows the new one (GSAP fade in)
  // Calls .show() on new panel and .hide() on old panel

  nextPanel() { ... }
  // Cycle to next panel in registration order

  prevPanel() { ... }
  // Cycle to previous panel

  updateAll(masterState) { ... }
  // Called every RAF frame — calls .update(masterState) on all registered panels
  // (even hidden ones update their internal state, but skip heavy DOM work if !visible)

  hideAll() { ... }
  // Hide all panels (overlay off)

  showAll() { ... }
  // Show the active panel again
}
```

### Panel Transitions

Use GSAP for all panel show/hide transitions. Do not use CSS animations for this.

```js
// Hide:
gsap.to(panel.element, { opacity: 0, duration: 0.25, onComplete: () => panel.element.style.display = 'none' });

// Show:
panel.element.style.display = 'block';
panel.element.style.opacity = '0';
gsap.to(panel.element, { opacity: 1, duration: 0.3 });
```

---

## Panel Definitions

### 1. Timing Tower

**File:** `TimingTower.js`
**Position:** Left side of screen, full height, ~280px wide
**Description:** Classic F1 timing tower showing all 20 drivers sorted by race position.

**Data Sources:** `masterState.drivers` (all fields), `masterState.session`

**Each row displays:**
- Position number (colored based on change: green = gained, red = lost)
- Team color bar (vertical left edge, 4px wide, driver's `teamColor`)
- Driver abbreviation (bold, white)
- Driver number (small, secondary text)
- Gap to leader or interval to car ahead (toggle between the two)
- Last lap time
- Best lap time (purple = session best, green = personal best)
- Tire compound icon + tire age in laps
- DRS active indicator (green DRS text when `drsActive === true`)
- Mini sector colors for the 3 sectors (small colored dots)

**Tire compound icons:**
Use colored circles as CSS elements (no images needed):
- SOFT → red circle
- MEDIUM → yellow circle
- HARD → white circle
- INTERMEDIATE → green circle
- WET → blue circle

**Layout:** Each driver row is a `<div>` with a fixed height of ~50px. Sort drivers by `position` on each `update()` call. Use CSS `transform: translateY()` for position animation when rows reorder — do not change the DOM order directly. Each row div has a fixed data-driver-number attribute; only translateY changes.

**GSAP position transitions:** When race positions change, GSAP the `translateY` of each row div to its new Y position. Calculate target Y = `(position - 1) × 50` pixels.

```js
// On each update, compute new Y positions and GSAP-transition rows
Object.entries(masterState.drivers).forEach(([num, driver]) => {
  const row = this.rows[num];
  const targetY = (driver.position - 1) * 50;
  if (row.currentY !== targetY) {
    gsap.to(row.element, { y: targetY, duration: 0.4, ease: 'power2.out' });
    row.currentY = targetY;
  }
  // Update text content directly (no transitions needed for text)
  row.gapEl.textContent = driver.gapToLeader;
  row.lastLapEl.textContent = formatLapTime(driver.lastLapTime);
  // etc.
});
```

---

### 2. Telemetry Panel

**File:** `TelemetryPanel.js`
**Position:** Bottom-center of screen, ~900px wide × 180px tall
**Description:** Live car telemetry for a selected driver (default: current race leader).

**Data Sources:** `masterState.drivers[focusedDriverNumber]`

**Displays:**
- Speed: large numeric readout + horizontal bar (0–360 km/h)
- Throttle: horizontal bar (0–100%), green fill
- Brake: horizontal bar (0 or 1), red fill
- Gear: large centered number (N for 0, R for -1)
- RPM: bar fill mapped to 0–15000 RPM range
- DRS status: pill badge labeled "DRS" in green when active

**Bar implementation:** Use CSS `transform: scaleX(value)` on a colored inner div. The outer div has `overflow: hidden`. This avoids layout reflow.

```html
<div class="bar-outer">
  <div class="bar-inner" data-bar="speed" style="transform: scaleX(0); transform-origin: left;"></div>
</div>
```

Update in RAF:
```js
this.speedBar.style.transform = `scaleX(${driver.speed / 360})`;
```

**Focused driver selection:** The telemetry panel tracks a `focusedDriverNumber`. Default to the race leader. The gesture system can change the focused driver (e.g., pointing gesture → cycle through top 5 drivers).

---

### 3. Tire Panel

**File:** `TirePanel.js`
**Position:** Right side of screen, ~320px wide, full height
**Description:** Tire strategy overview for all drivers — stint history timeline.

**Data Sources:** `masterState.drivers` (stints, currentStint, pitHistory)

**Layout:** One row per driver (sorted by position). Each row shows:
- Driver abbreviation + position
- Stint timeline: horizontal bars representing each stint, colored by compound
  - SOFT = red, MEDIUM = yellow, HARD = white, INTERMEDIATE = green, WET = blue
  - Bar width proportional to stint length in laps
  - Current stint has a pulsing indicator at its right edge
- Current tire age in laps (number at end of current stint bar)
- Degradation indicator: tiny arrow up/down based on `tireDegradationRate`
- `crossoverLap` shown as a vertical line marker on the timeline if available

**Timeline scale:** Based on `masterState.session.totalLaps`. If totalLaps is null (practice/qualifying), use 60 as the scale denominator.

---

### 4. Weather Panel

**File:** `WeatherPanel.js`
**Position:** Top-right corner, ~220px × 160px
**Description:** Current atmospheric conditions.

**Data Sources:** `masterState.weather`

**Displays:**
- Track temperature (°C) — large text
- Air temperature (°C)
- Humidity (%)
- Wind: speed (m/s) + direction (compass rose or arrow)
- Rain indicator: blue background when `rainfall === true`

This panel is small and can always be visible alongside other panels. It does not need to be swapped out.

---

### 5. Gap Chart

**File:** `GapChart.js`
**Position:** Bottom-left, ~480px × 220px
**Description:** Live bar chart showing gap to leader for all drivers. Rendered with PixiJS for performance.

**Data Sources:** `masterState.drivers` (position, gapToLeader, teamColor)

**Rendering:** This panel uses PixiJS (not HTML/CSS) because it redraws every frame. See `src/pixi/SPEC.md` for how to get the shared PixiJS application instance.

**Display:**
- Horizontal bars sorted by position
- Each bar length = gap to leader (scale: 0s–60s maps to full bar width)
- Bar color = driver's team color
- Driver abbreviation label on the left
- Gap value label on the right
- Bars animate smoothly as gaps change (lerp bar width, do not snap)

---

### 6. Strategy Panel

**File:** `StrategyPanel.js`
**Position:** Center-right, ~480px × 400px
**Description:** Engineer-level analytics view showing undercut windows, pit stop recommendations, and track evolution.

**Data Sources:** All derived fields in `masterState.drivers` + `masterState.session`

**Layout — three sections:**

**Section A: Undercut Radar** (top third)
- For the top 10 drivers, show undercut viability indicators
- Green dot = undercut viable, grey dot = not viable
- Display `undercutWindowSeconds` value next to viable cars

**Section B: Pit Stop Windows** (middle third)
- Active only when SC or VSC is deployed
- Show `scPitWindowValue` or `vscPitWindowValue` for all drivers
- Sorted by highest value (who gains most from pitting)
- Color code: green = pit recommended, grey = stay out

**Section C: Track Evolution** (bottom third)
- Line chart: X = lap number, Y = session best lap time
- Plotted from `masterState.raceControl` + `masterState.drivers` best lap history
- Drawn on a PixiJS canvas

---

### 7. Race Control Panel

**File:** `RaceControlPanel.js`
**Position:** Top-center, ~800px × 120px
**Description:** Shows the most recent race control messages (flags, SC, penalties).

**Data Sources:** `masterState.raceControl`, `masterState.session`

**Displays:**
- Last 3 race control messages, newest on top
- Flag indicator badge: colored pill matching the flag status
  - GREEN → solid green pill
  - YELLOW / DOUBLE YELLOW → yellow pill
  - RED → red pill
  - SC DEPLOYED → orange pill labeled "SC"
  - VSC DEPLOYED → orange pill labeled "VSC"
- Message text (white, small)
- Lap number when the message was issued

**Behavior:**
- New messages slide in from the top with a GSAP animation
- Messages older than 3 shown are hidden (not deleted, in case the user scrolls back — but for now, just show the latest 3)
- When SC or VSC status changes on `masterState.session`, pulse the badge

---

## Visual Design Constraints

- All panels use `position: absolute` within `#panels`
- Dark semi-transparent backgrounds: `background: rgba(10, 10, 20, 0.85)` with `backdrop-filter: blur(4px)`
- No pure white backgrounds — OBS chroma key may interact with white
- Text: white or team colors only
- Border accents: 1px solid `rgba(255, 255, 255, 0.1)` or team color
- Font: Formula1 Display (see `SETUP.md`) or Orbitron fallback
- All numeric values that update frequently (gap, speed) must update via `textContent =`, never via `innerHTML =`
- Never concatenate user-controlled data into `innerHTML` — use `textContent` exclusively for data values

---

## Panel Layout Map (1920×1080)

```
┌─────────────────────────────────────────────────────────┐ 1920×1080
│  [Race Control — top center, full width strip]           │
│                                                          │
│ [Timing] │                                   │ [Weather]│
│ [Tower  ] │    Three.js Circuit (background)  │ [Panel ] │
│ [Left   ] │                                   │ [Tire  ] │
│ [side   ] │                                   │ [Panel ] │
│           │                                   │ [right ] │
│           │                                   │         │
│           └──────────────────────────────────┘         │
│  [Gap Chart — bottom left]   [Telemetry — bottom center]│
└─────────────────────────────────────────────────────────┘
```

The Strategy Panel overlays on the right side, replacing the Tire Panel when active. All panel positions must be specified with exact pixel coordinates in their CSS files.
