import * as THREE from 'three';
import { CatmullRomCurve3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import miami from '../../circuits/miami.json';
import miamiGlbUrl from '../../circuits/miami.glb';
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
  async load(_, scene){
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(miamiGlbUrl);
    circuitMesh = gltf.scene;
    scene.add(circuitMesh);

    const box = new THREE.Box3().setFromObject(circuitMesh);
    const modelBounds = {
      minX: box.min.x,
      maxX: box.max.x,
      minZ: box.min.z,
      maxZ: box.max.z,
    };

    const rawPoints = findCenterlinePoints(miami);
    if (!rawPoints) {
      throw new Error('[CircuitLoader] miami.json is missing centerline points array');
    }
    const pts=rawPoints.map((p)=>new THREE.Vector3(Number(p.x),Number(p.z ?? 0),Number(p.y)));
    const spline=new CatmullRomCurve3(pts,true,'catmullrom',0.5);
    const geo=new THREE.BufferGeometry().setFromPoints(spline.getPoints(1000));
    splineLine=new THREE.LineLoop(geo,new THREE.LineBasicMaterial({color:0x444444}));scene.add(splineLine);
    return {spline,modelBounds};
  },
  setSplineVisible(v){ if(splineLine) splineLine.visible=v; }
};
