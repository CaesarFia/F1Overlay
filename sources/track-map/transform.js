import * as THREE from 'three';
import { SPLINE_SAMPLE_COUNT } from '../../shared/constants.js';

export function openF1ToModelXZ(x, y, openF1Bounds, modelBounds) {
  const nx = (x - openF1Bounds.minX) / (openF1Bounds.maxX - openF1Bounds.minX || 1);
  const ny = 1 - (y - openF1Bounds.minY) / (openF1Bounds.maxY - openF1Bounds.minY || 1);
  return {
    x: modelBounds.minX + nx * (modelBounds.maxX - modelBounds.minX),
    z: modelBounds.minZ + ny * (modelBounds.maxZ - modelBounds.minZ)
  };
}

export function findClosestT(modelX, modelZ, spline, currentT = 0) {
  const target = new THREE.Vector3(modelX, 0, modelZ);
  let bestT = currentT;
  let bestD = Infinity;
  const WINDOW = 0.3;
  const STEPS = Math.round(SPLINE_SAMPLE_COUNT * WINDOW * 2);
  for (let i = 0; i <= STEPS; i++) {
    const t = ((currentT - WINDOW + (2 * WINDOW * i / STEPS)) % 1 + 1) % 1;
    const p = spline.getPointAt(t);
    const d = p.distanceToSquared(target);
    if (d < bestD) { bestD = d; bestT = t; }
  }
  return bestT;
}
