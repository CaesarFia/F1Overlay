import { DEFAULT_PLAYBACK_SPEED, MAX_PLAYBACK_SPEED, MIN_PLAYBACK_SPEED } from './constants.js';

let firstSessionEpochMs = 0;
let wallClockAnchorMs = 0;
let sessionClockAnchorMs = 0;
let speed = DEFAULT_PLAYBACK_SPEED;

export function init(records, { speed: startSpeed = DEFAULT_PLAYBACK_SPEED, startOffsetMs = 0 } = {}) {
  firstSessionEpochMs = records.length ? new Date(records[0].date ?? records[0].date_start).getTime() : Date.now();
  wallClockAnchorMs = performance.now();
  sessionClockAnchorMs = firstSessionEpochMs + startOffsetMs;
  speed = Math.max(MIN_PLAYBACK_SPEED, Math.min(MAX_PLAYBACK_SPEED, startSpeed));
}

export function getCurrentSessionTime() {
  return sessionClockAnchorMs + (performance.now() - wallClockAnchorMs) * speed;
}

export function setSpeed(nextSpeed) {
  const snapped = Math.max(MIN_PLAYBACK_SPEED, Math.min(MAX_PLAYBACK_SPEED, nextSpeed));
  const current = getCurrentSessionTime();
  speed = snapped;
  wallClockAnchorMs = performance.now();
  sessionClockAnchorMs = current;
}

export function jumpToLap(lapNumber, lapsData) {
  const candidates = lapsData.filter((l) => l.lap_number === lapNumber && l.date_start);
  if (candidates.length === 0) return false;
  const lapStartEpoch = Math.min(...candidates.map((l) => new Date(l.date_start).getTime()));
  wallClockAnchorMs = performance.now();
  sessionClockAnchorMs = lapStartEpoch;
  return true;
}

export function getState() {
  return { firstSessionEpochMs, wallClockAnchorMs, sessionClockAnchorMs, speed };
}
