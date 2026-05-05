import { MIAMI_SESSION_KEY } from '../../shared/constants.js';
import { fetchStints, fetchPit, fetchDrivers, fetchLaps } from '../../shared/api.js';
import * as playback from '../../shared/playback.js';
import * as driverData from '../../shared/drivers.js';

async function main() {
  const status = document.getElementById('status');
  const params = new URLSearchParams(window.location.search);
  const speed = parseFloat(params.get('speed') ?? '1.0');

  const [stintsData, pitData, driversArray, lapsData] = await Promise.all([
    fetchStints(MIAMI_SESSION_KEY),
    fetchPit(MIAMI_SESSION_KEY),
    fetchDrivers(MIAMI_SESSION_KEY),
    fetchLaps(MIAMI_SESSION_KEY)
  ]);

  playback.init(lapsData, { speed });
  driverData.init(driversArray);

  status.textContent = `Loaded ${stintsData.length} stints | ${pitData.length} pit stops | ${driversArray.length} drivers | ${lapsData.length} laps`;

  requestAnimationFrame(function tick() {
    playback.getCurrentSessionTime();
    requestAnimationFrame(tick);
  });
}

main().catch((err) => {
  document.getElementById('status').textContent = `Tyres startup failed: ${err.message}`;
});
