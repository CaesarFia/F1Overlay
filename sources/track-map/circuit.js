import * as THREE from 'three';
import { CatmullRomCurve3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SPLINE_TENSION } from '../../shared/constants.js';
const jsonModules = import.meta.glob('../../circuits/*.json');
const glbUrls = import.meta.glob('../../circuits/*.glb', { query: '?url', import: 'default' });
let splineLine;
let circuitMesh;

function looksLikePointArray(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every((p) => p && typeof p === 'object' && 'x' in p && 'y' in p && 'z' in p);
}

function findCenterlinePoints(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return null;
  const direct =
    obj.centerlinePoints ??
    obj.centerline_points ??
    obj.centerline?.points ??
    obj.points;
  if (looksLikePointArray(direct)) return direct;

  for (const value of Object.values(obj)) {
    if (looksLikePointArray(value)) return value;
    const nested = findCenterlinePoints(value, depth + 1);
    if (nested) return nested;
  }
  return null;
}

export const CircuitLoader={
  async load(circuitKey, scene){
    const jsonKey = `../../circuits/${circuitKey}.json`;
    const glbKey = `../../circuits/${circuitKey}.glb`;
    const jsonLoader = jsonModules[jsonKey];
    const glbLoader = glbUrls[glbKey];
    if (!jsonLoader || !glbLoader) {
      throw new Error(`[CircuitLoader] Missing circuit assets for key: ${circuitKey}`);
    }
    const [jsonModule, glbModule] = await Promise.all([
      jsonLoader(),
      glbLoader(),
    ]);
    const circuitData = jsonModule?.default ?? jsonModule;
    const glbUrl = typeof glbModule === 'string' ? glbModule : (glbModule?.default ?? glbModule);
    if (typeof glbUrl !== 'string' || glbUrl.length === 0) {
      throw new Error(`[CircuitLoader] Invalid GLB URL for circuit key: ${circuitKey}`);
    }

    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(glbUrl);
    circuitMesh = gltf.scene;
    scene.add(circuitMesh);

    const box = new THREE.Box3().setFromObject(circuitMesh);
    const modelBounds = {
      minX: box.min.x,
      maxX: box.max.x,
      minZ: box.min.z,
      maxZ: box.max.z,
    };

    const rawPoints = findCenterlinePoints(circuitData);
    if (!rawPoints) {
      throw new Error(`[CircuitLoader] ${circuitKey}.json is missing centerline points array`);
    }
    const pts=rawPoints.map((p)=>new THREE.Vector3(Number(p.x),Number(p.z ?? 0),-Number(p.y)));
    const center = pts.reduce((acc, p) => acc.add(p), new THREE.Vector3()).divideScalar(pts.length);
    const centeredPts = pts.map((p) => p.clone().sub(center));
    const spline=new CatmullRomCurve3(centeredPts,true,'catmullrom',SPLINE_TENSION);
    const geo=new THREE.BufferGeometry().setFromPoints(spline.getPoints(1000));
    splineLine=new THREE.LineLoop(geo,new THREE.LineBasicMaterial({color:0x444444}));scene.add(splineLine);
    return {spline,modelBounds};
  },
  setSplineVisible(v){ if(splineLine) splineLine.visible=v; }
};
