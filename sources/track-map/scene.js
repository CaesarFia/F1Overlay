import * as THREE from 'three';
import { CAMERA_FOV, CAMERA_HEIGHT_MULTIPLIER, CAMERA_TILT_Z_MULTIPLIER } from '../../shared/constants.js';

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
  }

  positionCamera(modelBounds) {
    const cx = (modelBounds.minX + modelBounds.maxX) / 2;
    const cz = (modelBounds.minZ + modelBounds.maxZ) / 2;
    const sizeX = modelBounds.maxX - modelBounds.minX;
    const sizeZ = modelBounds.maxZ - modelBounds.minZ;
    const height = Math.max(sizeX, sizeZ) * CAMERA_HEIGHT_MULTIPLIER;

    this.camera.position.set(cx, height, cz + sizeZ * CAMERA_TILT_Z_MULTIPLIER);
    this.camera.lookAt(cx, 0, cz);
    this._defaultCameraPosition = this.camera.position.clone();
    this._defaultCameraTarget = new THREE.Vector3(cx, 0, cz);
  }

  resetCamera() {
    this.camera.position.copy(this._defaultCameraPosition);
    this.camera.lookAt(this._defaultCameraTarget);
  }
}
