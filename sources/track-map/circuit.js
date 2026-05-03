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
    const centroid = new THREE.Vector3();
    pts.forEach((p) => centroid.add(p));
    centroid.divideScalar(pts.length);
    const bboxCenter = new THREE.Vector3(
      (box.min.x + box.max.x) / 2,
      0,
      (box.min.z + box.max.z) / 2
    );
    const centeredPts = pts.map((p) => p.clone().sub(centroid).add(bboxCenter));
    const spline=new CatmullRomCurve3(centeredPts,true,'catmullrom',SPLINE_TENSION);
    const geo=new THREE.BufferGeometry().setFromPoints(spline.getPoints(1000));
    splineLine=new THREE.LineLoop(geo,new THREE.LineBasicMaterial({color:0x444444}));scene.add(splineLine);

    // DEBUG — remove once aligned
    const meshCenter = new THREE.Vector3(
      (box.min.x + box.max.x) / 2,
      (box.min.y + box.max.y) / 2,
      (box.min.z + box.max.z) / 2
    );
    console.log('[debug] mesh bbox center:', meshCenter);
    console.log('[debug] spline centroid (pre-sub):', centroid);
    console.log('[debug] spline pt[0] — start/finish (post-sub):', centeredPts[0]);

    // Red sphere = mesh bbox center
    const red = new THREE.Mesh(new THREE.SphereGeometry(0.5), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
    red.position.copy(meshCenter);
    scene.add(red);

    // Green sphere = spline pt[0] = start/finish line
    const green = new THREE.Mesh(new THREE.SphereGeometry(0.5), new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
    green.position.copy(centeredPts[0]);
    scene.add(green);

    // Blue sphere = world origin (0,0,0)
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(0.5), new THREE.MeshBasicMaterial({ color: 0x0000ff })));
    return {spline,modelBounds};
  },
  setSplineVisible(v){ if(splineLine) splineLine.visible=v; }
};
