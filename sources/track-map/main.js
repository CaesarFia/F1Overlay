import { MIAMI_SESSION_KEY } from '../../shared/constants.js';
import { fetchAllLocationData, fetchDrivers, fetchLaps, calculateBounds } from '../../shared/api.js';
import * as playback from '../../shared/playback.js';
import * as driverData from '../../shared/drivers.js';
import { SceneManager } from './scene.js';
import { CircuitLoader } from './circuit.js';
import { DriverDotManager } from './drivers.js';
import { PostProcessing } from './postfx.js';

async function main() {
  const params = new URLSearchParams(window.location.search);
  const speed = parseFloat(params.get('speed') ?? '1.0');
  const startLap = params.has('start') ? parseInt(params.get('start'), 10) : null;
  const devMode = params.has('dev');

  const [locationRecords, driversArray, lapsData] = await Promise.all([
    fetchAllLocationData(MIAMI_SESSION_KEY),
    fetchDrivers(MIAMI_SESSION_KEY),
    fetchLaps(MIAMI_SESSION_KEY)
  ]);

  const openF1Bounds = calculateBounds(locationRecords);
  const recordsByDriver = {};
  for (const record of locationRecords) {
    const key = String(record.driver_number);
    (recordsByDriver[key] ??= []).push(record);
  }
  const driverPlaybackIndex = Object.fromEntries(Object.keys(recordsByDriver).map((k) => [k, 0]));
  console.log('[location]', locationRecords.length, 'records');
  console.log('[drivers in location]', Object.keys(recordsByDriver).length, 'drivers:', Object.keys(recordsByDriver));
  console.log('[bounds]', openF1Bounds);

  let startOffsetMs = 0;
  if (startLap !== null && locationRecords[0]) {
    const lapEntries = lapsData.filter((l) => Number(l.lap_number) === startLap && l.date_start);
    if (lapEntries.length > 0) {
      const lapStartEpoch = Math.min(...lapEntries.map((l) => new Date(l.date_start).getTime()));
      startOffsetMs = lapStartEpoch - new Date(locationRecords[0].date).getTime();
    }
  }

  playback.init(locationRecords, { speed, startOffsetMs });
  driverData.init(driversArray);

  const scene = new SceneManager(document.getElementById('three-canvas'));
  const { spline, modelBounds } = await CircuitLoader.load('miami', scene.scene);
  scene.positionCamera(modelBounds);

  const dots = new DriverDotManager(scene.scene, document.getElementById('css2d-layer'), scene.camera, scene.renderer, spline, driverData.getAllDrivers());
  const postfx = new PostProcessing(scene.renderer, scene.scene, scene.camera);

  let devPanel = null;
  if (devMode) {
    const { DevPanel } = await import('./dev-panel.js');
    devPanel = new DevPanel({
      onSpeedChange: (v) => playback.setSpeed(v),
      onJumpToLap: (n) => {
        const ok = playback.jumpToLap(n, lapsData);
        console.log('[jump] lap', n, ok ? 'ok' : 'FAILED — lap not found in lapsData');
        if (!ok) return;
        const newTime = playback.getCurrentSessionTime();
        for (const [num, records] of Object.entries(recordsByDriver)) {
          let idx = 0;
          while (idx + 1 < records.length && new Date(records[idx + 1].date).getTime() <= newTime) idx++;
          driverPlaybackIndex[num] = idx;
        }
      },
      getPlayback: () => playback
    });
    devPanel.mount();
  }

  requestAnimationFrame(function tick() {
    const sessionTime = playback.getCurrentSessionTime();
    for (const [driverNum, records] of Object.entries(recordsByDriver)) {
      let idx = driverPlaybackIndex[driverNum];
      while (idx + 1 < records.length && new Date(records[idx + 1].date).getTime() <= sessionTime) idx += 1;
      driverPlaybackIndex[driverNum] = idx;
      dots.updateTarget(driverNum, records[idx], openF1Bounds, modelBounds);
    }
    dots.lerpAll();
    postfx.render();
    const processed = Object.values(driverPlaybackIndex).reduce((s, i) => s + i, 0);
    const elapsed = Math.floor((sessionTime - new Date(locationRecords[0].date).getTime()) / 1000);
    const mm = Math.floor(elapsed / 60);
    const ss = String(Math.max(0, elapsed % 60)).padStart(2, '0');
    devPanel?.tick(`${mm}:${ss}`, processed);
    requestAnimationFrame(tick);
  });
}

main().catch((err) => {
  console.error('[track-map] Startup failed:', err);
  document.getElementById('error').textContent = String(err.message || err);
});
