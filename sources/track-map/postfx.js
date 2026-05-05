import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import * as THREE from 'three';
import { BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD } from '../../shared/constants.js';

export class PostProcessing {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1920, 1080), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    this.composer.addPass(this.bloomPass);
    this.enabled = true;
  }
  setEnabled(v) { this.enabled = v; }
  render() { if (this.enabled) this.composer.render(); else this.renderer.render(this.composer.passes[0].scene, this.composer.passes[0].camera); }
}
