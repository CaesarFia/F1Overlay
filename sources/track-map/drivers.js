import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { openF1ToModelXZ, findClosestT } from './transform.js';
import { LERP_RATE, DOT_RADIUS, DOT_EMISSIVE_INTENSITY } from '../../shared/constants.js';

export class DriverDotManager {
  constructor(scene, css2dContainer, camera, renderer, spline, allDrivers) {
    this.scene = scene;
    this.spline = spline;
    this.dots = {};
    this.labelsVisible = true;
    this.css2dRenderer = new CSS2DRenderer({ element: css2dContainer });
    this.css2dRenderer.setSize(1920, 1080);
    this._camera = camera;
    this._renderer = renderer;
    for (const driver of allDrivers) this._createDot(driver);
  }

  _createDot(driver) {
    const teamColor = `#${driver.team_colour || 'ffffff'}`;
    const color = new THREE.Color(teamColor);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(DOT_RADIUS, 16, 16), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: DOT_EMISSIVE_INTENSITY, roughness: 0.2 }));
    const labelDiv = document.createElement('div');
    labelDiv.className = 'driver-label';
    labelDiv.textContent = driver.name_acronym || String(driver.driver_number);
    labelDiv.style.color = teamColor;
    const label = new CSS2DObject(labelDiv);
    label.position.set(0, 0.25, 0);
    mesh.add(label);
    this.scene.add(mesh);
    this.dots[String(driver.driver_number)] = { mesh, currentT: 0, targetT: 0, label };
  }

  updateTarget(driverNumber, record, openF1Bounds, modelBounds) {
    const dot = this.dots[String(driverNumber)];
    if (!dot || !record) return;
    const mapped = openF1ToModelXZ(record.x, record.y, openF1Bounds, modelBounds);
    dot.targetT = findClosestT(mapped.x, mapped.z, this.spline);
  }

  lerpAll() {
    for (const dot of Object.values(this.dots)) {
      let { currentT, targetT } = dot;
      const diff = targetT - currentT;
      if (diff > 0.5) targetT -= 1;
      if (diff < -0.5) targetT += 1;
      currentT += (targetT - currentT) * LERP_RATE;
      currentT = ((currentT % 1) + 1) % 1;
      dot.currentT = currentT;
      dot.mesh.position.copy(this.spline.getPoint(currentT));
      dot.label.visible = this.labelsVisible;
    }
    this.css2dRenderer.render(this.scene, this._camera);
  }

  setLabelsVisible(v) { this.labelsVisible = v; }
}
