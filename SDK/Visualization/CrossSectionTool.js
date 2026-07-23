import * as THREE from 'three';

export class CrossSection {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer || null;
    this.clippingPlanes = [];
    this.planeHelpers = [];
    this.isActive = false;
  }

  _notifyVisualToolkit(type) {
    document.dispatchEvent(new CustomEvent('volare:visual-toolkit-state', { detail: { type } }));
  }

  activate() {
    if (this.isActive) return;
    this.isActive = true;
    this._notifyVisualToolkit('visualizer-open');
    if (this.renderer) this.renderer.localClippingEnabled = true;
    this.createClippingPlane(new THREE.Vector3(1, 0, 0), 0);
  }

  deactivate() {
    if (!this.isActive) return;
    this.isActive = false;
    this._notifyVisualToolkit('visualizer-close');
    this.clearClippingPlanes();
    if (this.renderer) this.renderer.localClippingEnabled = false;
  }

  createClippingPlane(normal, constant) {
    const plane = new THREE.Plane(normal.clone().normalize(), constant);
    this.clippingPlanes.push(plane);

    // Size helper to model bounds using space diagonal — covers any cut angle
    let helperSize = 5;
    const modelCenter = new THREE.Vector3();
    if (this.scene) {
      const box = new THREE.Box3();
      this.scene.traverse(c => {
        if (c.isMesh && !c.userData?.volareHelper && !c.userData?.isWireframeHelper) {
          box.expandByObject(c);
        }
      });
      if (!box.isEmpty()) {
        const sz = box.getSize(new THREE.Vector3());
        helperSize = Math.sqrt(sz.x * sz.x + sz.y * sz.y + sz.z * sz.z) * 1.2;
        box.getCenter(modelCenter);
      }
    }
    this._modelCenter = modelCenter;

    // Subtle translucent plane — no noisy PlaneHelper grid
    const group = new THREE.Group();
    group.userData.volareHelper = true;
    group.userData.csPlane = plane;

    const fillGeo = new THREE.PlaneGeometry(helperSize, helperSize);
    const fillMat = new THREE.MeshBasicMaterial({
      color: 0x88ccff,
      transparent: true,
      opacity: 0.02,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.userData.volareHelper = true;
    group.add(fill);

    const edgeGeo = new THREE.EdgesGeometry(fillGeo);
    const edgeMat = new THREE.LineBasicMaterial({
      color: 0x88ccff,
      transparent: true,
      opacity: 0.55,
    });
    const outline = new THREE.LineSegments(edgeGeo, edgeMat);
    outline.userData.volareHelper = true;
    group.add(outline);

    // Interior grid lines — 6×6 divisions, subtle but readable over model
    const gridDivisions = 6;
    const half = helperSize / 2;
    const step = helperSize / gridDivisions;
    const gridVerts = [];
    for (let i = 1; i < gridDivisions; i++) {
      const t = -half + i * step;
      gridVerts.push(-half, t, 0,  half, t, 0);  // horizontal
      gridVerts.push(t, -half, 0,  t,  half, 0); // vertical
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridVerts, 3));
    const gridMat = new THREE.LineBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.12 });
    const gridLines = new THREE.LineSegments(gridGeo, gridMat);
    gridLines.userData.volareHelper = true;
    group.add(gridLines);

    this.scene.add(group);
    this.planeHelpers.push(group);
    this.updateHelperTransform(group, plane);

    this.scene.traverse(child => {
      if (!child.isMesh || !child.material) return;
      if (child.userData?.volareHelper || child.userData?.isWireframeHelper) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach(mat => {
        mat.clippingPlanes = this.clippingPlanes;
        mat.needsUpdate = true;
      });
    });
  }

  updateHelperTransform(helper, plane) {
    // Center helper on model center projected onto the cut plane
    const center = this._modelCenter || new THREE.Vector3();
    const onPlane = plane.projectPoint(center, new THREE.Vector3());
    helper.position.copy(onPlane);
    helper.lookAt(onPlane.clone().add(plane.normal));
  }

  updatePlanePosition(index, constant) {
    if (this.clippingPlanes[index]) {
      this.clippingPlanes[index].constant = constant;
      const group = this.planeHelpers[index];
      if (group) this.updateHelperTransform(group, this.clippingPlanes[index]);
    }
  }

  clearClippingPlanes() {
    this.clippingPlanes = [];
    this.planeHelpers.forEach(helper => {
      helper.traverse(c => {
        c.geometry?.dispose();
        if (c.material) {
          if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
          else c.material.dispose();
        }
      });
      this.scene?.remove(helper);
    });
    this.planeHelpers = [];

    this.scene?.traverse(child => {
      if (!child.isMesh || !child.material) return;
      if (child.userData?.volareHelper || child.userData?.isWireframeHelper) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach(mat => {
        mat.clippingPlanes = [];
        mat.needsUpdate = true;
      });
    });
  }

  updateRealtime() { /* plane is static — no per-frame repositioning needed */ }

  dispose() {
    this.deactivate();
    this.scene = null;
  }
}

export { CrossSection as CrossSectionTool };
