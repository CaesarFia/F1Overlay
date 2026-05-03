# Derived Calculations

## Purpose

These modules compute engineer-level analytics from raw OpenF1 data. All calculations run inside the Web Worker. Results are posted to the main thread as part of `STATE_PATCH` messages and stored as fields on each driver entry in `masterState`.

---

## Files to Create

```
src/derived/tireDegradation.js
src/derived/fuelCorrection.js
src/derived/gapTrend.js
src/derived/undercutWindow.js
src/derived/scPitWindow.js
src/derived/trackEvolution.js
src/derived/crossoverLap.js
src/derived/cornerSpeeds.js
```

Each file exports a single pure function. They receive data slices and return computed values — no side effects, no global state.

---

## 1. Tire Degradation Rate

**File:** `src/derived/tireDegradation.js`

**Purpose:** Estimate how much a driver's lap time degrades per lap of tire age in the current stint.

**Input:**
```js
// Array of lap objects for the current stint only
// [ { lapTime: number, stintLap: number }, ... ]
// stintLap is the lap number within the stint (1 = first lap of stint)
// Requires at least 3 data points for a meaningful result
```

**Output:** `number | null` — seconds of degradation per stint lap (positive = getting slower)

**Algorithm:**
1. If fewer than 3 data points, return `null`
2. Filter out pit-out laps (`isPitOutLap === true`) — they are anomalously slow
3. Use linear regression (least squares) on `[stintLap, lapTime]` pairs
4. The slope of the regression line is the degradation rate
5. Clamp to a reasonable range: `[-0.5, 2.0]` seconds/lap (negative = improving, possibly track evolution)

**Linear regression (simple):**
```
n = number of points
sumX = Σ stintLap
sumY = Σ lapTime
sumXY = Σ (stintLap × lapTime)
sumX2 = Σ (stintLap²)
slope = (n × sumXY - sumX × sumY) / (n × sumX2 - sumX²)
```

**Export:**
```js
export function computeTireDegradation(lapHistory) { ... }
// Returns: number | null
```

---

## 2. Fuel-Corrected Lap Time

**File:** `src/derived/fuelCorrection.js`

**Purpose:** Normalize lap times to an equivalent full-fuel-load baseline so that early-race laps can be fairly compared to late-race laps.

**Input:**
```js
lapTime: number      // raw lap time in seconds
lapNumber: number    // current lap number (1-indexed)
```

**Output:** `number` — fuel-corrected lap time in seconds

**Formula:**
```
FUEL_CORRECTION_PER_LAP = 0.08  // seconds per lap (car gets lighter, faster)
fuelCorrectedLapTime = lapTime + (FUEL_CORRECTION_PER_LAP × lapNumber)
```

Explanation: Lap 1 is at full fuel weight. By lap 30, the car is ~2.4 seconds faster due to fuel burn. Adding `0.08 × lapNumber` normalizes all laps as if they were done on a full tank. Lower corrected time = faster underlying pace.

**Export:**
```js
export function computeFuelCorrectedLapTime(lapTime, lapNumber) { ... }
// Returns: number
```

---

## 3. Gap Trend

**File:** `src/derived/gapTrend.js`

**Purpose:** Determine whether a driver is closing on, stable relative to, or falling away from the car ahead.

**Input:**
```js
gapHistory: number[]  // array of numeric gap-to-leader values (most recent last)
                      // at least 3 entries needed for stability analysis
```

**Output:** `"CLOSING" | "STABLE" | "FALLING"`

**Algorithm:**
1. Convert `gapToLeader` strings to numbers: strip `+`, handle `LAP` as null/skip
2. Use the last 5 gap values (or fewer if not enough data)
3. Compute the average delta between consecutive readings
4. `averageDelta = (gapHistory[n-1] - gapHistory[n-5]) / 4`
5. If `averageDelta < -0.15`, return `"CLOSING"` (gap is shrinking)
6. If `averageDelta > +0.15`, return `"FALLING"` (gap is growing)
7. Otherwise return `"STABLE"`

The ±0.15 threshold accounts for lap-to-lap variation. Adjust if needed for sensitivity.

**Export:**
```js
export function computeGapTrend(gapHistory) { ... }
// Returns: "CLOSING" | "STABLE" | "FALLING"
```

---

## 4. Undercut Window

**File:** `src/derived/undercutWindow.js`

**Purpose:** Estimate whether the driver can undercut the car directly ahead by pitting first and gaining time on fresh tires.

**Input:**
```js
{
  gapToCarAhead: number,      // seconds (numeric interval)
  tireDegRate: number,        // seconds/lap degradation for current driver
  tireDegRateAhead: number,   // seconds/lap degradation for car ahead
  currentStintLap: number,    // how many laps into current stint
  pitTimeLoss: number,        // estimated time lost in pit stop (from circuit JSON, default 22)
}
```

**Output:**
```js
{
  viable: boolean,
  windowSeconds: number | null,  // positive = undercut advantage in seconds
  breakEvenLaps: number | null,  // laps until break-even on track
}
```

**Algorithm:**

The undercut works if, after pitting, the fresh tire pace gain over the remaining stint overcomes the pit time loss:

```
freshenedPaceGain = tireDegRate × currentStintLap
                    (estimate: new tires reset degradation to zero)

// Laps to recoup pit stop time at the pace advantage
// If ahead driver is also degrading, the relative gain is larger
relativePaceGain = freshenedPaceGain + (tireDegRateAhead × currentStintLap * 0.3)
                   (the 0.3 factor accounts for uncertainty in the ahead driver's strategy)

breakEvenLaps = pitTimeLoss / max(relativePaceGain / currentStintLap, 0.01)

viable = gapToCarAhead < pitTimeLoss * 0.8  // within striking range
windowSeconds = (pitTimeLoss / (relativePaceGain / currentStintLap)) - gapToCarAhead
```

If `freshenedPaceGain < 0.3` (tire deg is minimal), undercut is never viable regardless of gap — return `{ viable: false, windowSeconds: null, breakEvenLaps: null }`.

**Export:**
```js
export function computeUndercutWindow(params) { ... }
// Returns: { viable, windowSeconds, breakEvenLaps }
```

---

## 5. SC/VSC Pit Window

**File:** `src/derived/scPitWindow.js`

**Purpose:** Calculate the time value gained (or lost) by pitting during a Safety Car or Virtual Safety Car period compared to pitting under green flag conditions.

**Input:**
```js
{
  isScActive: boolean,
  isVscActive: boolean,
  gapToCarAhead: number,          // seconds
  normalPitTimeLoss: number,       // seconds (from circuit JSON)
  scPitTimeLoss: number,           // seconds — typically normalPitTimeLoss - 22
  vscPitTimeLoss: number,          // seconds — typically normalPitTimeLoss - 12
}
```

**Output:**
```js
{
  scWindowValue: number | null,    // seconds saved vs. pitting under green
  vscWindowValue: number | null,   // seconds saved vs. pitting under green
  recommendation: "PIT" | "STAY" | "NEUTRAL" | null,
}
```

**Algorithm:**
```
SC savings = normalPitTimeLoss - scPitTimeLoss
VSC savings = normalPitTimeLoss - vscPitTimeLoss

// Default values if not in circuit JSON:
// SC: saves approximately 22-25 seconds vs green flag pit
// VSC: saves approximately 10-15 seconds vs green flag pit

recommendation = "PIT" if:
  - SC is active AND scWindowValue > gapToCarAhead (driver doesn't lose position)
  - VSC is active AND vscWindowValue > 0 (any saving is beneficial)
```

**Export:**
```js
export function computeScPitWindow(params) { ... }
// Returns: { scWindowValue, vscWindowValue, recommendation }
```

---

## 6. Track Evolution

**File:** `src/derived/trackEvolution.js`

**Purpose:** Plot how the track is "rubbering in" over the course of a session by tracking the improvement in session-best lap time over laps.

**Input:**
```js
sessionBestPerLap: number[]  // indexed by lap number, value is session best lap time for that lap
                             // null for laps not yet completed
```

**Output:**
```js
{
  improvementRate: number | null,  // seconds per lap improvement (negative = track getting faster)
  totalImprovement: number | null, // total time gain from lap 1 to latest lap
  dataPoints: { lap: number, bestTime: number }[],  // for chart rendering
}
```

**Algorithm:**
1. Filter out null values, require at least 5 data points
2. Linear regression on `[lapNumber, sessionBestLapTime]`
3. `improvementRate` = regression slope (negative = track getting faster per lap)
4. `totalImprovement` = first data point time − latest data point time

**Export:**
```js
export function computeTrackEvolution(sessionBestPerLap) { ... }
```

---

## 7. Crossover Lap

**File:** `src/derived/crossoverLap.js`

**Purpose:** Estimate the lap number at which it becomes a net positive for the driver to pit (based on current tire degradation and pit time cost).

**Input:**
```js
{
  currentLap: number,
  lapStart: number,           // lap when current stint started
  tireDegRate: number,        // seconds/lap
  pitTimeLoss: number,        // seconds
  freshTireBaseGain: number,  // estimated pace gain on new tires vs worn tires at crossover
                              // derived from tireDegRate × currentStintAge
}
```

**Output:** `number | null` — predicted lap number to pit (null if calculation not possible)

**Formula:**
```
currentStintAge = currentLap - lapStart
cumulativeDegradation = tireDegRate × currentStintAge

// At what future stint age does cumulative deg equal pit time loss?
crossoverStintAge = pitTimeLoss / tireDegRate

crossoverLap = currentLap + (crossoverStintAge - currentStintAge)
```

Return `null` if `tireDegRate <= 0` (no meaningful degradation detected).
Clamp to a maximum of `currentLap + 40` (don't predict more than 40 laps out).

**Export:**
```js
export function computeCrossoverLap(params) { ... }
// Returns: number | null
```

---

## 8. Corner Entry and Exit Speeds

**File:** `src/derived/cornerSpeeds.js`

**Purpose:** Extract corner entry (braking point) and exit (acceleration point) speeds from `/car_data` speed readings correlated with `/location` coordinates.

**Input:**
```js
{
  speedSamples: { x: number, y: number, speed: number, date: string }[],
  // Array of speed samples with track coordinates, in chronological order
  // Derived by joining /location and /car_data on matching timestamps
}
```

**Output:**
```js
{
  corners: {
    entrySpeed: number,   // km/h at the braking point
    exitSpeed: number,    // km/h at the acceleration point
    location: { x: number, y: number },  // OpenF1 coords of the corner apex
  }[]
}
```

**Algorithm:**
1. Identify braking events: sequences where speed decreases by more than 40 km/h over < 300 meters
2. The entry speed is the speed at the start of the braking zone
3. The exit speed is the minimum speed in the sequence (apex)
4. Filter out pit lane events by cross-referencing with known pit lane coordinate ranges

**Note:** This calculation is lower priority and computationally heavier. It runs on `/laps` updates (every 15 seconds), not on every `/car_data` update. It requires the worker to buffer recent `/location` and `/car_data` samples together, matching by timestamp proximity (< 200ms difference).

**Export:**
```js
export function computeCornerSpeeds(speedSamples) { ... }
// Returns: { corners: [...] }
```

---

## Shared Utilities

The derived modules may need these utilities. Place them in `src/utils/mathUtils.js`:

```js
// Linear regression: returns { slope, intercept }
export function linearRegression(points) { ... }
// points: [{ x, y }]

// Parse gap string to number: "+1.234" → 1.234, "0.000" → 0, "+1 LAP" → null
export function parseGapString(gapString) { ... }

// Clamp a value between min and max
export function clamp(value, min, max) { ... }
```
