import { DEFAULT_PLAYBACK_SPEED, MAX_PLAYBACK_SPEED, MIN_PLAYBACK_SPEED } from './constants.js';

let _realAnchor = 0;
let _sessionAnchor = 0;
let _speed = DEFAULT_PLAYBACK_SPEED;
let _initialized = false;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export function init(records, { speed = DEFAULT_PLAYBACK_SPEED, startOffsetMs = 0 } = {}) {
  const firstDate = records[0]?.date || records[0]?.date_start;
  const baseMs = firstDate ? new Date(firstDate).getTime() : Date.now();
  _speed = clamp(Number(speed) || DEFAULT_PLAYBACK_SPEED, MIN_PLAYBACK_SPEED, MAX_PLAYBACK_SPEED);
  _realAnchor = Date.now();
  _sessionAnchor = baseMs + startOffsetMs;
  _initialized = true;
}

export function getCurrentSessionTime() {
  if (!_initialized) return Date.now();
  return _sessionAnchor + (Date.now() - _realAnchor) * _speed;
}

export function setSpeed(newSpeed) {
  const currentTime = getCurrentSessionTime();
  _speed = clamp(Number(newSpeed) || DEFAULT_PLAYBACK_SPEED, MIN_PLAYBACK_SPEED, MAX_PLAYBACK_SPEED);
  _realAnchor = Date.now();
  _sessionAnchor = currentTime;
}

export function jumpToLap(lapNumber, lapsData) {
  const candidates = lapsData.filter((l) => Number(l.lap_number) === Number(lapNumber) && l.date_start);
  if (!candidates.length) return false;
  const earliest = Math.min(...candidates.map((l) => new Date(l.date_start).getTime()));
  _realAnchor = Date.now();
  _sessionAnchor = earliest;
  return true;
}

export function getSpeed() { return _speed; }
