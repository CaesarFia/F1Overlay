import { MIAMI_SESSION_KEY } from '../../shared/constants.js';
import { fetchPosition, fetchDrivers } from '../../shared/api.js';
import * as playback from '../../shared/playback.js';
import * as driverData from '../../shared/drivers.js';

async function main() {
  const status = document.getElementById('status');
  const params = new URLSearchParams(window.location.search);
  const speed = parseFloat(params.get('speed') ?? '1.0');

  const [positionRecords, driversArray] = await Promise.all([
    fetchPosition(MIAMI_SESSION_KEY),
    fetchDrivers(MIAMI_SESSION_KEY)
  ]);

  playback.init(positionRecords, { speed });
  driverData.init(driversArray);

  status.textContent = `Loaded ${positionRecords.length} position records | ${driversArray.length} drivers`;

  requestAnimationFrame(function tick() {
    playback.getCurrentSessionTime();
    requestAnimationFrame(tick);
  });
}

main().catch((err) => {
  document.getElementById('status').textContent = `Gaps startup failed: ${err.message}`;
});
