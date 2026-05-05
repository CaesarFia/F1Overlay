import { BOUNDS_MARGIN, OPENF1_BASE_URL } from './constants.js';

async function get(endpoint, params = {}) {
  const url = new URL(`${OPENF1_BASE_URL}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      console.warn(`[api] ${endpoint} -> ${res.status}`);
      return [];
    }
    return await res.json();
  } catch (err) {
    console.warn(`[api] ${endpoint} failed:`, err.message);
    return [];
  }
}

const sortByDate = (rows, key = 'date') => [...rows].sort((a, b) => (a[key] < b[key] ? -1 : 1));

export async function fetchAllLocationData(sessionKey, driverNumbers) {
  const results = [];
  for (const num of driverNumbers) {
    const records = await get('/location', { session_key: sessionKey, driver_number: num });
    results.push(...records);
    await new Promise(r => setTimeout(r, 400)); // stay under 3 req/sec rate limit
  }
  return sortByDate(results.filter(r => r.x !== 0 || r.y !== 0));
}
export const fetchDrivers = (sessionKey) => get('/drivers', { session_key: sessionKey });
export const fetchLaps = (sessionKey) => get('/laps', { session_key: sessionKey }).then((r) => sortByDate(r, 'date_start'));
export const fetchStints = (sessionKey) => get('/stints', { session_key: sessionKey });
export const fetchPit = (sessionKey) => get('/pit', { session_key: sessionKey }).then((r) => sortByDate(r));
export const fetchPosition = (sessionKey) => get('/position', { session_key: sessionKey }).then((r) => sortByDate(r));

export function calculateBounds(records) {
  let minX = Infinity; let maxX = -Infinity;
  let minY = Infinity; let maxY = -Infinity;

  for (const r of records) {
    if (typeof r.x !== 'number' || typeof r.y !== 'number') continue;
    if (r.x < minX) minX = r.x;
    if (r.x > maxX) maxX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.y > maxY) maxY = r.y;
  }

  const rangeX = maxX - minX;
  const rangeY = maxY - minY;
  const bounds = {
    minX: minX - rangeX * BOUNDS_MARGIN,
    maxX: maxX + rangeX * BOUNDS_MARGIN,
    minY: minY - rangeY * BOUNDS_MARGIN,
    maxY: maxY + rangeY * BOUNDS_MARGIN
  };
  console.log('[bounds]', bounds);
  return bounds;
}
