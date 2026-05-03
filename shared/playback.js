let startWallClock = 0;
let startSessionMs = 0;
let speed = 1;

export function init(records, { speed: startSpeed = 1, startOffsetMs = 0 } = {}) {
  speed = startSpeed;
  startWallClock = performance.now();
  const minDate = records.length ? Math.min(...records.map(r => new Date(r.date).getTime())) : Date.now();
  startSessionMs = minDate + startOffsetMs;
}

export function getCurrentSessionTime() {
  return startSessionMs + (performance.now() - startWallClock) * speed;
}

export function setSpeed(next) {
  const now = getCurrentSessionTime();
  speed = next;
  startWallClock = performance.now();
  startSessionMs = now;
}
