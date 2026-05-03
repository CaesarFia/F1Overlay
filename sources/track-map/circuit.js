import * as THREE from 'three';
import { CatmullRomCurve3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import miami from '../../circuits/miami.json';
import miamiGlbUrl from '../../circuits/miami.glb';
let splineLine;
let circuitMesh;
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

    const pts=miami.centerlinePoints.map((p)=>new THREE.Vector3(p.x,p.z ?? 0,p.y));
    const spline=new CatmullRomCurve3(pts,true,'catmullrom',0.5);
    const geo=new THREE.BufferGeometry().setFromPoints(spline.getPoints(1000));
    splineLine=new THREE.LineLoop(geo,new THREE.LineBasicMaterial({color:0x444444}));scene.add(splineLine);
    return {spline,modelBounds};
  },
  setSplineVisible(v){ if(splineLine) splineLine.visible=v; }
};
