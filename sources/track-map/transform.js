import * as THREE from 'three';
import { BOUNDS_MARGIN, SPLINE_SAMPLE_COUNT } from '../../shared/constants.js';
export function openF1ToModelXZ(record, openF1Bounds, modelBounds){
  const dx=openF1Bounds.maxX-openF1Bounds.minX; const dy=openF1Bounds.maxY-openF1Bounds.minY;
  const nx=(record.x-openF1Bounds.minX)/dx; const ny=(record.y-openF1Bounds.minY)/dy;
  const px=THREE.MathUtils.lerp(modelBounds.minX,modelBounds.maxX,nx*(1-2*BOUNDS_MARGIN)+BOUNDS_MARGIN);
  const pz=THREE.MathUtils.lerp(modelBounds.minZ,modelBounds.maxZ,ny*(1-2*BOUNDS_MARGIN)+BOUNDS_MARGIN);
  return {x:px,z:pz};
}
export function findClosestT(spline, x, z){let bestT=0,best=Infinity;for(let i=0;i<=SPLINE_SAMPLE_COUNT;i++){const t=i/SPLINE_SAMPLE_COUNT;const p=spline.getPointAt(t);const d=(p.x-x)**2+(p.z-z)**2;if(d<best){best=d;bestT=t}}return bestT}
