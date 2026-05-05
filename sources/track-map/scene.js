import * as THREE from 'three';
import { CAMERA_FOV, ORBIT_TILT_DEG, ORBIT_SPEED, ORBIT_RADIUS_MULT } from '../../shared/constants.js';

export class SceneManager {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setSize(1920, 1080);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1920 / 1080, 0.01, 1000);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(0, 10, 5);
    this.scene.add(dir);

    this._orbitCenter = new THREE.Vector3();
    this._orbitRadius = 100;
    this._orbitHeight = 30;
    this._startTime = Date.now();
  }

  positionCamera(modelBounds) {
    const cx = (modelBounds.minX + modelBounds.maxX) / 2;
    const cz = (modelBounds.minZ + modelBounds.maxZ) / 2;
    const maxSize = Math.max(
      modelBounds.maxX - modelBounds.minX,
      modelBounds.maxZ - modelBounds.minZ
    );

    this._orbitCenter.set(cx, 0, cz);
    this._orbitRadius = maxSize * ORBIT_RADIUS_MULT;
    this._orbitHeight = this._orbitRadius * Math.tan(ORBIT_TILT_DEG * Math.PI / 180);
    this._startTime = Date.now();

    this._updateCamera(0);
  }

  tick() {
    this._updateCamera(Date.now() - this._startTime);
  }

  resetCamera() {
    this._startTime = Date.now();
    this._updateCamera(0);
  }

  _updateCamera(elapsed) {
    const angle = elapsed * ORBIT_SPEED;
    this.camera.position.set(
      this._orbitCenter.x + this._orbitRadius * Math.cos(angle),
      this._orbitHeight,
      this._orbitCenter.z + this._orbitRadius * Math.sin(angle)
    );
    this.camera.lookAt(this._orbitCenter);
  }
}
