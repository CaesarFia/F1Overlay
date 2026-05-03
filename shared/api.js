import { OPENF1_BASE_URL } from './constants.js';

async function get(endpoint, params = {}) {
  const query = new URLSearchParams(params).toString();
  const url = `${OPENF1_BASE_URL}/${endpoint}?${query}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

function sortByDate(arr, field = 'date') {
  return [...arr].sort((a, b) => (a[field] < b[field] ? -1 : 1));
}

export const fetchAllLocationData = (sessionKey) => get('location', { session_key: sessionKey }).then(sortByDate);
export const fetchDrivers = (sessionKey) => get('drivers', { session_key: sessionKey });
export const fetchLaps = (sessionKey) => get('laps', { session_key: sessionKey }).then((d) => sortByDate(d, 'date_start'));
export const fetchPosition = (sessionKey) => get('position', { session_key: sessionKey }).then(sortByDate);
export const fetchStints = (sessionKey) => get('stints', { session_key: sessionKey });
export const fetchPit = (sessionKey) => get('pit', { session_key: sessionKey });

export function calculateBounds(records) {
  const seed = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const bounds = records.reduce((acc, r) => ({
    minX: Math.min(acc.minX, r.x),
    maxX: Math.max(acc.maxX, r.x),
    minY: Math.min(acc.minY, r.y),
    maxY: Math.max(acc.maxY, r.y),
  }), seed);
  return Number.isFinite(bounds.minX) ? bounds : { minX: 0, maxX: 1, minY: 0, maxY: 1 };
}
