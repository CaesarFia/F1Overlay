import * as THREE from 'three';
import { CAMERA_FOV, CAMERA_HEIGHT_MULTIPLIER, CAMERA_TILT_Z_MULTIPLIER } from '../../shared/constants.js';
export class SceneManager {
  constructor(canvas){this.renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true});this.renderer.setSize(1920,1080);this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));this.renderer.setClearColor(0x000000,0);this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.2;this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(CAMERA_FOV,1920/1080,0.01,1000);this.scene.add(new THREE.AmbientLight(0xffffff,0.4));const d=new THREE.DirectionalLight(0xffffff,0.8);d.position.set(0,10,5);this.scene.add(d)}
  positionCamera(b){const cx=(b.minX+b.maxX)/2,cz=(b.minZ+b.maxZ)/2,sx=b.maxX-b.minX,sz=b.maxZ-b.minZ,h=Math.max(sx,sz)*CAMERA_HEIGHT_MULTIPLIER;this.camera.position.set(cx,h,cz+sz*CAMERA_TILT_Z_MULTIPLIER);this.camera.lookAt(cx,0,cz)}
}
