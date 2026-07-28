import * as THREE from 'three';
import { showTopToast, hideTopToast } from '../UI/TopToast.js';

export class MeshAnalysis {
  constructor(scene, camera, controls, domElement) {
    this.scene = scene;
    this.camera = camera;
    this.controls = controls;
    this.domElement = domElement;
    this.raycaster = new THREE.Raycaster();

    this.isActive = false;
    this.selectedMesh = null;
    this.highlightMesh = null;
    this.infoPanel = null;
    this.onClose = null;
    this._toastHandle = null;
    this._targetBorders = new Map();
    this._hoveredMesh = null;

    this._onClick = this._onClick.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
  }

  _notifyVisualToolkit(type, detail = {}) {
    document.dispatchEvent(new CustomEvent('volare:visual-toolkit-state', {
      detail: { type, ...detail }
    }));
  }

  activate() {
    if (this.isActive) return;
    this.isActive = true;
    this.domElement.addEventListener('click', this._onClick);
    this.domElement.addEventListener('mousemove', this._onMouseMove);
    this._createTargetBorders();
    this._notifyVisualToolkit('mesh-inspector-open');
    this._toastHandle = showTopToast(
      'Mesh Inspector',
      'Visual Toolkit is temporarily disabled. Select a mesh to inspect its details, then the toolkit will be available again.',
      5000
    );
  }

  deactivate() {
    if (!this.isActive) return;
    this.isActive = false;
    this.domElement.removeEventListener('click', this._onClick);
    this.domElement.removeEventListener('mousemove', this._onMouseMove);
    this.domElement.style.cursor = '';
    this._hoveredMesh = null;
    this._removeTargetBorders();
    hideTopToast(this._toastHandle);
    this._toastHandle = null;
    this._clearHighlight();
    this._removeInfoPanel();
    this._notifyVisualToolkit('mesh-inspector-close');
    this.onClose?.();
  }

  // Same eligibility filter used by both the click-to-select raycast and the
  // persistent per-mesh borders, so they never disagree on what's clickable.
  _getEligibleTargets() {
    const targets = [];
    this.scene.traverse((child) => {
      if (
        child.isMesh &&
        child.visible &&
        !child.userData.volareHelper &&
        !child.userData.isWireframeMesh &&
        !(child instanceof THREE.LineSegments) &&
        !(child instanceof THREE.Line)
      ) {
        targets.push(child);
      }
    });
    return targets;
  }

  // Thin, dim outline around every clickable mesh -- small or thin parts are
  // otherwise easy to miss entirely, since there's no visual cue for where
  // the actual click target is until you find it by trial and error.
  _createTargetBorders() {
    this._removeTargetBorders();
    for (const mesh of this._getEligibleTargets()) {
      try {
        const border = new THREE.BoxHelper(mesh, 0x888888);
        border.material.transparent = true;
        border.material.opacity = 0.35;
        border.userData.volareHelper = true;
        this.scene.add(border);
        this._targetBorders.set(mesh, border);
      } catch (_) {}
    }
  }

  _removeTargetBorders() {
    for (const border of this._targetBorders.values()) {
      border.parent?.remove(border);
      border.geometry?.dispose();
      border.material?.dispose();
    }
    this._targetBorders.clear();
  }

  _raycastFromEvent(e) {
    const rect = this.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(mouse, this.camera);
    return this.raycaster.intersectObjects(this._getEligibleTargets(), false);
  }

  // Brightens the border of whichever mesh the cursor is over/near (a hit
  // against its own bounding box counts, not just its actual triangles --
  // the border itself is the generous hit target).
  _onMouseMove(e) {
    if (!this.isActive) return;
    const nextHovered = this._boxHitTargets(e)[0] || null;

    if (nextHovered === this._hoveredMesh) return;

    if (this._hoveredMesh) {
      const prevBorder = this._targetBorders.get(this._hoveredMesh);
      if (prevBorder) { prevBorder.material.color.set(0x888888); prevBorder.material.opacity = 0.35; }
    }
    this._hoveredMesh = nextHovered;
    if (nextHovered) {
      const border = this._targetBorders.get(nextHovered);
      if (border) { border.material.color.set(0x00ccff); border.material.opacity = 0.9; }
    }
    this.domElement.style.cursor = nextHovered ? 'pointer' : '';
  }

  // Hit-tests each mesh's *bounding box* (not its exact triangles) so hovering
  // near the border -- not just squarely on filled surface -- still counts,
  // matching the generous outline drawn around it.
  _boxHitTargets(e) {
    const rect = this.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(mouse, this.camera);
    const box = new THREE.Box3();
    const hits = [];
    for (const mesh of this._targetBorders.keys()) {
      box.setFromObject(mesh);
      if (this.raycaster.ray.intersectsBox(box)) hits.push(mesh);
    }
    if (hits.length <= 1) return hits;
    // Multiple overlapping boxes: prefer the one the ray actually hits closer to.
    const point = new THREE.Vector3();
    hits.sort((a, b) => {
      const boxA = new THREE.Box3().setFromObject(a);
      const boxB = new THREE.Box3().setFromObject(b);
      const da = this.raycaster.ray.intersectBox(boxA, point) ? point.distanceTo(this.raycaster.ray.origin) : Infinity;
      const db = this.raycaster.ray.intersectBox(boxB, point) ? point.distanceTo(this.raycaster.ray.origin) : Infinity;
      return da - db;
    });
    return hits;
  }

  _onClick(e) {
    if (!this.isActive) return;
    const hits = this._raycastFromEvent(e);
    const target = hits[0]?.object || this._boxHitTargets(e)[0];
    if (!target) return;
    this._inspectMesh(target);
  }

  _inspectMesh(mesh) {
    this._clearHighlight();
    this.selectedMesh = mesh;

    // Bounding box — clearer than dense edge wireframe, no backface X-ray
    try {
      const box = new THREE.BoxHelper(mesh, 0x00ccff);
      box.userData.volareHelper = true;
      this.scene.add(box);
      this.highlightMesh = box;
    } catch (_) {}

    this._showInfoPanel(this._getMeshInfo(mesh));
  }

  _getMeshInfo(mesh) {
    const geo = mesh.geometry;
    const name = mesh.name || 'Unnamed';

    const mat = mesh.material;
    let matName = 'None';
    if (mat) {
      if (Array.isArray(mat)) {
        matName = mat.map(m => m.name || 'Unnamed').join(', ') || 'Unnamed';
      } else {
        matName = mat.name || 'Unnamed';
      }
    }

    const posAttr = geo.attributes?.position;
    const vertexCount = posAttr ? posAttr.count : 0;
    const triangleCount = geo.index
      ? Math.round(geo.index.count / 3)
      : (posAttr ? Math.round(posAttr.count / 3) : 0);

    let bboxStr = 'N/A';
    try {
      geo.computeBoundingBox();
      const bbox = geo.boundingBox;
      if (bbox) {
        const sx = (bbox.max.x - bbox.min.x).toFixed(2);
        const sy = (bbox.max.y - bbox.min.y).toFixed(2);
        const sz = (bbox.max.z - bbox.min.z).toFixed(2);
        bboxStr = `${sx} × ${sy} × ${sz}`;
      }
    } catch (_) {}

    let texCount = 0;
    const texKeys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'envMap'];
    const mats = Array.isArray(mat) ? mat : (mat ? [mat] : []);
    mats.forEach(m => texKeys.forEach(k => { if (m[k]) texCount++; }));

    return { name, matName, vertexCount, triangleCount, bboxStr, texCount };
  }

  _showInfoPanel(info) {
    this._removeInfoPanel();

    const panel = document.createElement('div');
    panel.className = 'vlr-mesh-info-panel';

    // Static structure — no user data in innerHTML
    panel.innerHTML = `
      <div class="vlr-mesh-info-header">
        <span class="vlr-mesh-info-title"><i class="fa-solid fa-layer-group"></i> Mesh Inspector</span>
        <button class="vlr-mesh-info-close" aria-label="Close"><i class="fas fa-times"></i></button>
      </div>
      <div class="vlr-mesh-info-body">
        <div class="vlr-mesh-info-row"><span class="vlr-mesh-info-label">Name</span><span class="vlr-mesh-info-value" data-field="name"></span></div>
        <div class="vlr-mesh-info-row"><span class="vlr-mesh-info-label">Material</span><span class="vlr-mesh-info-value" data-field="mat"></span></div>
        <div class="vlr-mesh-info-row"><span class="vlr-mesh-info-label">Vertices</span><span class="vlr-mesh-info-value" data-field="verts"></span></div>
        <div class="vlr-mesh-info-row"><span class="vlr-mesh-info-label">Triangles</span><span class="vlr-mesh-info-value" data-field="tris"></span></div>
        <div class="vlr-mesh-info-row"><span class="vlr-mesh-info-label">Bbox</span><span class="vlr-mesh-info-value" data-field="bbox"></span></div>
        <div class="vlr-mesh-info-row"><span class="vlr-mesh-info-label">Texture Slots</span><span class="vlr-mesh-info-value" data-field="tex"></span></div>
      </div>
    `;

    // Set dynamic values via textContent — no XSS risk
    panel.querySelector('[data-field="name"]').textContent = info.name;
    panel.querySelector('[data-field="mat"]').textContent = info.matName;
    panel.querySelector('[data-field="verts"]').textContent = info.vertexCount.toLocaleString();
    panel.querySelector('[data-field="tris"]').textContent = info.triangleCount.toLocaleString();
    panel.querySelector('[data-field="bbox"]').textContent = info.bboxStr;
    panel.querySelector('[data-field="tex"]').textContent = info.texCount;

    panel.querySelector('.vlr-mesh-info-close').addEventListener('click', () => {
      this.deactivate();
    });

    // Scope inside viewer container — same pattern as PerformanceMonitor
    const parent = document.getElementById('model') || document.body;
    if (parent !== document.body && getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }
    parent.appendChild(panel);
    this.infoPanel = panel;
    this._notifyVisualToolkit('mesh-selected');

    // Trigger entrance animation after layout flush
    void panel.offsetWidth;
    panel.classList.add('show');
  }

  _removeInfoPanel() {
    if (this.infoPanel) {
      const panel = this.infoPanel;
      this.infoPanel = null;
      panel.classList.remove('show');
      panel.classList.add('hide');
      setTimeout(() => panel.remove(), 280);
    }
  }

  _clearHighlight() {
    if (this.highlightMesh) {
      this.highlightMesh.parent?.remove(this.highlightMesh);
      this.highlightMesh.geometry?.dispose();
      this.highlightMesh.material?.dispose();
      this.highlightMesh = null;
    }
    this.selectedMesh = null;
  }

  updateRealtime() {
    for (const [mesh, border] of this._targetBorders) {
      if (mesh.isSkinnedMesh) {
        if (mesh.boundingBox !== undefined) mesh.boundingBox = null;
        if (mesh.boundingSphere !== undefined) mesh.boundingSphere = null;
      }
      border.update?.();
    }
    if (!this.highlightMesh) return;
    if (this.selectedMesh?.isSkinnedMesh) {
      if (this.selectedMesh.boundingBox !== undefined) this.selectedMesh.boundingBox = null;
      if (this.selectedMesh.boundingSphere !== undefined) this.selectedMesh.boundingSphere = null;
    }
    this.highlightMesh.update?.();
  }
  invalidateCache() { /* mesh data re-read on each click */ }

  dispose() {
    this.deactivate();
  }
}

export {
  MeshAnalysis as MeshInspector,
  MeshAnalysis as VertexSelector,
  MeshAnalysis as VertexFocusTool
};
