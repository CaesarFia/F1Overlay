import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CatmullRomCurve3 } from 'three';
import { SPLINE_TENSION } from '../../shared/constants.js';

const jsonModules = import.meta.glob('../../circuits/*.json');
const glbUrls = import.meta.glob('../../circuits/*.glb', { query: '?url', import: 'default' });

const params = new URLSearchParams(window.location.search);
const circuitKey = params.get('circuit') ?? 'miami';
const offset = { x: 0, z: 0 };

const canvas = document.getElementById('c');
const labelsCanvas = document.getElementById('labels');
const ctx = labelsCanvas.getContext('2d');
labelsCanvas.width = 1920;
labelsCanvas.height = 1080;

const circuitEl = document.getElementById('circuit');
const offsetEl = document.getElementById('offset');
const copyBtn = document.getElementById('copy');
circuitEl.textContent = `circuit=${circuitKey}`;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(1920, 1080);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

const camera = new THREE.OrthographicCamera(-25, 25, 14, -14, 0.1, 500);
camera.position.set(0, 120, 0);
camera.lookAt(0, 0, 0);
scene.add(new THREE.AmbientLight(0xffffff, 0.8));

let splineLine = null;
let centeredPtsBase = null;

function looksLikePointArray(v) {
  return Array.isArray(v) && v.length > 0 && v.every(p => p && typeof p === 'object' && 'x' in p && 'y' in p && 'z' in p);
}

function findCenterlinePoints(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return null;
  const direct = obj.centerlinePoints ?? obj.centerline_points ?? obj.centerline?.points ?? obj.points;
  if (looksLikePointArray(direct)) return direct;
  for (const value of Object.values(obj)) {
    if (looksLikePointArray(value)) return value;
    const nested = findCenterlinePoints(value, depth + 1);
    if (nested) return nested;
  }
  return null;
}

function currentPts() {
  if (!centeredPtsBase) return [];
  const off = new THREE.Vector3(offset.x, 0, offset.z);
  return centeredPtsBase.map(p => p.clone().add(off));
}

function toScreen(pt) {
  const v = pt.clone().project(camera);
  return { x: (v.x + 1) / 2 * 1920, y: (1 - v.y) / 2 * 1080 };
}

function drawLabels() {
  ctx.clearRect(0, 0, 1920, 1080);
  const pts = currentPts();
  for (let i = 0; i < pts.length; i++) {
    const { x, y } = toScreen(pts[i]);
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = i === 0 ? '#ff4444' : '#00ff88';
    ctx.fill();

    const label = String(i);
    ctx.font = 'bold 12px monospace';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000';
    ctx.strokeText(label, x + 7, y + 4);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + 7, y + 4);
  }
}

function renderSpline() {
  if (!centeredPtsBase) return;
  const pts = currentPts();
  const spline = new CatmullRomCurve3(pts, true, 'catmullrom', SPLINE_TENSION);
  const geo = new THREE.BufferGeometry().setFromPoints(spline.getPoints(1000));
  if (splineLine) { scene.remove(splineLine); splineLine.geometry.dispose(); }
  splineLine = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color: 0xffff00 }));
  scene.add(splineLine);
  offsetEl.textContent = `offset.x=${offset.x.toFixed(2)} offset.z=${offset.z.toFixed(2)}`;
}

async function boot() {
  const jsonLoader = jsonModules[`../../circuits/${circuitKey}.json`];
  const glbLoader = glbUrls[`../../circuits/${circuitKey}.glb`];
  if (!jsonLoader || !glbLoader) throw new Error(`Missing assets for circuit=${circuitKey}`);

  const [jsonModule, glbModule] = await Promise.all([jsonLoader(), glbLoader()]);
  const data = jsonModule?.default ?? jsonModule;
  const glbUrl = typeof glbModule === 'string' ? glbModule : (glbModule?.default ?? glbModule);

  const gltf = await new GLTFLoader().loadAsync(glbUrl);
  gltf.scene.traverse(n => {
    if (n.isMesh) n.material = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 1, metalness: 0 });
  });
  scene.add(gltf.scene);

  const box = new THREE.Box3().setFromObject(gltf.scene);
  const bboxCenter = new THREE.Vector3((box.min.x + box.max.x) / 2, 0, (box.min.z + box.max.z) / 2);
  const half = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.6;

  camera.left = -half; camera.right = half;
  camera.top = half * 1080 / 1920; camera.bottom = -half * 1080 / 1920;
  camera.position.set(bboxCenter.x, 120, bboxCenter.z);
  camera.lookAt(bboxCenter.x, 0, bboxCenter.z);
  camera.updateProjectionMatrix();

  const points = findCenterlinePoints(data);
  if (!points) throw new Error(`[align] ${circuitKey}.json is missing centerline points array`);

  const pts = points.map(p => new THREE.Vector3(Number(p.x), Number(p.z ?? 0), -Number(p.y)));
  const centroid = new THREE.Vector3();
  pts.forEach(p => centroid.add(p));
  centroid.divideScalar(pts.length);
  centeredPtsBase = pts.map(p => p.clone().sub(centroid).add(bboxCenter));

  renderSpline();

  requestAnimationFrame(function frame() {
    renderer.render(scene, camera);
    drawLabels();
    requestAnimationFrame(frame);
  });
}

window.addEventListener('keydown', e => {
  const step = e.shiftKey ? 0.1 : 1;
  if (e.key === 'ArrowLeft') offset.x -= step;
  else if (e.key === 'ArrowRight') offset.x += step;
  else if (e.key === 'ArrowUp') offset.z -= step;
  else if (e.key === 'ArrowDown') offset.z += step;
  else return;
  e.preventDefault();
  renderSpline();
});

copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(JSON.stringify({ splineOffset: offset }, null, 2));
});

boot().catch(err => {
  console.error(err);
  offsetEl.textContent = String(err?.message ?? err);
});
