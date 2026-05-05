import * as THREE from 'three';
import { SPLINE_SAMPLE_COUNT } from '../../shared/constants.js';

export function openF1ToModelXZ(x, y, openF1Bounds, modelBounds) {
  const nx = (x - openF1Bounds.minX) / (openF1Bounds.maxX - openF1Bounds.minX || 1);
  const ny = (y - openF1Bounds.minY) / (openF1Bounds.maxY - openF1Bounds.minY || 1);
  return {
    x: modelBounds.minX + nx * (modelBounds.maxX - modelBounds.minX),
    z: modelBounds.minZ + ny * (modelBounds.maxZ - modelBounds.minZ)
  };
}

export function findClosestT(modelX, modelZ, spline) {
  const target = new THREE.Vector3(modelX, 0, modelZ);
  let bestT = 0;
  let bestD = Infinity;
  for (let i = 0; i <= SPLINE_SAMPLE_COUNT; i += 1) {
    const t = i / SPLINE_SAMPLE_COUNT;
    const p = spline.getPoint(t);
    const d = p.distanceToSquared(target);
    if (d < bestD) {
      bestD = d;
      bestT = t;
    }
  }
  return bestT;
}
