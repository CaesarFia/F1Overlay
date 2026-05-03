import { API_BASE, SESSION_KEY } from './constants.js';

async function fetchEndpoint(endpoint) {
  const url = `${API_BASE}/${endpoint}?session_key=${SESSION_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OpenF1 ${endpoint} failed: ${res.status}`);
  return res.json();
}

export const fetchAllLocationData = () => fetchEndpoint('location');
export const fetchDrivers = () => fetchEndpoint('drivers');
export const fetchLaps = () => fetchEndpoint('laps');

export function calculateBounds(points) {
  const seed = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  return points.reduce((acc, p) => ({
    minX: Math.min(acc.minX, p.x), maxX: Math.max(acc.maxX, p.x),
    minY: Math.min(acc.minY, p.y), maxY: Math.max(acc.maxY, p.y)
  }), seed);
}
