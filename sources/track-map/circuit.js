import * as THREE from 'three';
import { CatmullRomCurve3 } from 'three';
import miami from '../../circuits/miami.json';
let splineLine;
export const CircuitLoader={
  async load(_, scene){
    const pts=miami.centerlinePoints.map((p)=>new THREE.Vector3(p.x,p.y??0,p.z));
    const spline=new CatmullRomCurve3(pts,true,'catmullrom',0.5);
    const geo=new THREE.BufferGeometry().setFromPoints(spline.getPoints(1000));
    splineLine=new THREE.LineLoop(geo,new THREE.LineBasicMaterial({color:0x444444}));scene.add(splineLine);
    return {spline,modelBounds:miami.modelBounds??{minX:-1,maxX:1,minZ:-1,maxZ:1}};
  },
  setSplineVisible(v){ if(splineLine) splineLine.visible=v; }
};
