import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CENTERLINE_RAYCAST_OFFSET, SPLINE_TENSION } from '../../shared/constants.js';

export class CircuitLoader {
  static _splineLine = null;

  static async load(circuitKey, scene) {
    const loader = new GLTFLoader();
    let mesh;
    let rawPoints;

    try {
      const glbModule = await import(`../../circuits/${circuitKey}.glb`);
      const gltf = await loader.loadAsync(glbModule.default);
      mesh = gltf.scene.children[0];
      mesh.material = new THREE.MeshStandardMaterial({ color: 0x334466, roughness: 0.8, metalness: 0.1, emissive: 0x112244, emissiveIntensity: 2.0 });
      scene.add(mesh);
      const jsonModule = await import(`../../circuits/${circuitKey}.json`);
      rawPoints = jsonModule.default.centerlinePoints.map((p) => new THREE.Vector3(p.x, p.z ?? 0, -p.y));
    } catch {
      const ring = new THREE.RingGeometry(8, 10, 64);
      ring.rotateX(-Math.PI / 2);
      mesh = new THREE.Mesh(ring, new THREE.MeshStandardMaterial({ color: 0x1a1a2e, side: THREE.DoubleSide }));
      scene.add(mesh);
      rawPoints = Array.from({ length: 120 }, (_, i) => {
        const t = (i / 120) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(t) * 9, 0, Math.sin(t) * 9);
      });
    }

    const box = new THREE.Box3().setFromObject(mesh);
    const modelBounds = { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z };

    const raycaster = new THREE.Raycaster();
    const correctedPoints = rawPoints.map((p) => {
      raycaster.set(new THREE.Vector3(p.x, p.y + 5, p.z), new THREE.Vector3(0, -1, 0));
      const hits = raycaster.intersectObject(mesh, true);
      if (hits.length > 0) return hits[0].point.clone().add(new THREE.Vector3(0, CENTERLINE_RAYCAST_OFFSET, 0));
      return p;
    });

    const spline = new THREE.CatmullRomCurve3(correctedPoints, true, 'catmullrom', SPLINE_TENSION);
    const splinePoints = spline.getPoints(500);
    const lineGeo = new THREE.BufferGeometry().setFromPoints(splinePoints);
    this._splineLine = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x00ff88, opacity: 0.4, transparent: true }));
    this._splineLine.visible = false;
    scene.add(this._splineLine);

    const clBox = new THREE.Box3().setFromPoints(splinePoints);
    const centerlineBounds = { minX: clBox.min.x, maxX: clBox.max.x, minZ: clBox.min.z, maxZ: clBox.max.z };

    return { spline, modelBounds, centerlineBounds };
  }

  static setSplineVisible(visible) {
    if (this._splineLine) this._splineLine.visible = visible;
  }
}
