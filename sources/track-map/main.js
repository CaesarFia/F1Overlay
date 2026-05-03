import { fetchAllLocationData, fetchDrivers, fetchLaps, calculateBounds } from '../../shared/api.js';
import * as playback from '../../shared/playback.js';
import * as driversStore from '../../shared/drivers.js';

const app = document.getElementById('app');
const params = new URLSearchParams(window.location.search);
const speed = Number(params.get('speed') || 1);

(async () => {
  try {
    const [locations, drivers, laps] = await Promise.all([fetchAllLocationData(), fetchDrivers(), fetchLaps()]);
    driversStore.init(drivers);
    const bounds = calculateBounds(locations);
    playback.init(locations, { speed });
    app.textContent = `Track Map ready | drivers: ${drivers.length} | laps: ${laps.length} | bounds: ${JSON.stringify(bounds)}`;
  } catch (err) {
    app.textContent = `Failed to load OpenF1 data: ${err.message}`;
  }
})();
