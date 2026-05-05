import { MIAMI_SESSION_KEY } from '../../shared/constants.js';
import { fetchAllLocationData, fetchDrivers, fetchLaps, calculateBounds } from '../../shared/api.js';
import * as playback from '../../shared/playback.js';
import * as driverData from '../../shared/drivers.js';
import { SceneManager } from './scene.js';
import { CircuitLoader } from './circuit.js';
import { DriverDotManager } from './drivers.js';
import { PostProcessing } from './postfx.js';

function createLoadingController() {
  const el = document.getElementById('startup-status');
  const phaseEl = el?.querySelector('[data-loading-phase]');
  const detailEl = el?.querySelector('[data-loading-detail]');
  const barEl = el?.querySelector('[data-loading-bar]');
  const countEl = el?.querySelector('[data-loading-count]');

  return {
    update({ phase, detail, progress, count } = {}) {
      if (!el) return;
      if (phase) phaseEl.textContent = phase;
      if (detail) detailEl.textContent = detail;
      if (typeof progress === 'number') {
        barEl.style.transform = `scaleX(${Math.max(0, Math.min(1, progress))})`;
      }
      if (count) countEl.textContent = count;
    },
    complete() {
      if (!el) return;
      el.classList.add('is-complete');
      window.setTimeout(() => el.remove(), 650);
    }
  };
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

async function main() {
  const params = new URLSearchParams(window.location.search);
  const speed = parseFloat(params.get('speed') ?? '1.0');
  const startLap = params.has('start') ? parseInt(params.get('start'), 10) : null;
  const devMode = params.has('dev');

  const loading = createLoadingController();
  loading.update({
    phase: 'Preparing circuit',
    detail: 'Bringing the Miami track model online.',
    progress: 0.08,
    count: 'Track map'
  });

  const scene = new SceneManager(document.getElementById('three-canvas'));
  const postfx = new PostProcessing(scene.renderer, scene.scene, scene.camera);
  let dots = null;
  let devPanel = null;
  let playbackReady = false;
  let runtimeState = null;

  requestAnimationFrame(function tick() {
    if (playbackReady && runtimeState) {
      const { recordsByDriver, driverPlaybackIndex, openF1Bounds, modelBounds, locationRecords } = runtimeState;
      const sessionTime = playback.getCurrentSessionTime();
      for (const [driverNum, records] of Object.entries(recordsByDriver)) {
        let idx = driverPlaybackIndex[driverNum];
        while (idx + 1 < records.length && new Date(records[idx + 1].date).getTime() <= sessionTime) idx += 1;
        driverPlaybackIndex[driverNum] = idx;
        dots.updateTarget(driverNum, records[idx], openF1Bounds, modelBounds);
      }

      const processed = Object.values(driverPlaybackIndex).reduce((s, i) => s + i, 0);
      if (locationRecords.length > 0) {
        const elapsed = Math.floor((sessionTime - new Date(locationRecords[0].date).getTime()) / 1000);
        const mm = Math.floor(elapsed / 60);
        const ss = String(Math.max(0, elapsed % 60)).padStart(2, '0');
        devPanel?.tick(`${mm}:${ss}`, processed);
      } else {
        devPanel?.tick('no data', processed);
      }
    }

    scene.tick();
    dots?.lerpAll();
    postfx.render();
    requestAnimationFrame(tick);
  });

  const circuitPromise = (async () => {
    const circuit = await CircuitLoader.load('miami', scene.scene);
    scene.positionCamera(circuit.centerlineBounds);
    loading.update({
      phase: 'Circuit ready',
      detail: 'Track locked on screen while driver telemetry loads.',
      progress: 0.24,
      count: 'Model loaded'
    });
    return circuit;
  })();

  const dataPromise = (async () => {
    loading.update({
      phase: 'Loading session roster',
      detail: 'Fetching driver and lap metadata from OpenF1.',
      progress: 0.14,
      count: 'Session data'
    });
    const [driversArray, lapsData] = await Promise.all([
      fetchDrivers(MIAMI_SESSION_KEY),
      fetchLaps(MIAMI_SESSION_KEY),
    ]);
    return { driversArray, lapsData };
  })();

  const [{ spline, modelBounds, centerlineBounds }, { driversArray, lapsData }] = await Promise.all([circuitPromise, dataPromise]);
  const driverNumbers = driversArray.map(d => d.driver_number);

  loading.update({
    phase: 'Loading driver telemetry',
    detail: `Collecting position history for ${driverNumbers.length} drivers.`,
    progress: 0.3,
    count: `0 / ${driverNumbers.length} drivers`
  });

  const locationRecords = await fetchAllLocationData(MIAMI_SESSION_KEY, driverNumbers, ({ current, total, driverNumber, records, totalRecords }) => {
    const progress = 0.3 + (current / Math.max(total, 1)) * 0.62;
    loading.update({
      phase: 'Loading driver telemetry',
      detail: `Driver ${driverNumber} synchronized · ${formatNumber(records)} samples added.`,
      progress,
      count: `${current} / ${total} drivers · ${formatNumber(totalRecords)} samples`
    });
  });

  loading.update({
    phase: 'Finalizing overlay',
    detail: 'Calibrating live dots to the track model.',
    progress: 0.96,
    count: `${formatNumber(locationRecords.length)} samples ready`
  });

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
  scene.positionCamera(centerlineBounds);

  dots = new DriverDotManager(scene.scene, document.getElementById('css2d-layer'), scene.camera, scene.renderer, spline, driverData.getAllDrivers());

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

  runtimeState = { recordsByDriver, driverPlaybackIndex, openF1Bounds, modelBounds, locationRecords };
  playbackReady = true;
  loading.complete();
}

main().catch((err) => {
  console.error('[track-map] Startup failed:', err);
  document.getElementById('error').textContent = String(err.message || err);
});
