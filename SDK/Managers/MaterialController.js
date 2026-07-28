import * as THREE from 'three';

const WIREFRAME_MODES = ['triangle', 'edges', 'artist'];
const DEFAULT_EDGE_THRESHOLD = 15;

export class MaterialManager {
  constructor() {
    // Set by the owning viewer so material modes can deactivate the material inspector
    // without hardcoding a container id or reaching through global singletons.
    this._analysisManager = null;
    this.originalMaterials = new Map();
    this.wireframeMode = 'triangle';
    this.activeMaterialMode = 'original';
    this.materialCache = {
      wireframe: new THREE.MeshBasicMaterial({ wireframe: true, color: 0x000000 }),
      ao: new THREE.MeshStandardMaterial({
        color: 0x808080,
        roughness: 1,
        metalness: 0,
      })
    };
  }

  setWireframeMode(mode) {
    const normalized = (mode || '').toLowerCase();
    if (!WIREFRAME_MODES.includes(normalized)) {
      throw new Error(`[Volare] Invalid wireframe mode: "${mode}". Supported: ${WIREFRAME_MODES.join(', ')}.`);
    }
    this.wireframeMode = normalized;
  }

  getWireframeMode() {
    return this.wireframeMode;
  }

  clearWireframeHelpers(model) {
    if (!model) return;
    const toRemove = [];
    model.traverse(child => {
      if (child.userData?.isWireframeMesh) toRemove.push(child);
    });
    toRemove.forEach(obj => {
      obj.parent?.remove(obj);
      if (obj.userData?.ownsGeometry) obj.geometry?.dispose();
      obj.material?.dispose();
    });
  }

  storeOriginalMaterials(model) {
    this.originalMaterials.clear();
    model.traverse(child => {
      if (child.isMesh && child.material) {
        this.originalMaterials.set(child.uuid, {
          material: child.material.clone(),
          children: []
        });
      }
    });
  }

  applyOriginalMaterials(model) {
    const materialInspector = this._analysisManager?.materialInspector;
    if (materialInspector?.isActive) {
      materialInspector.deactivate();
    }
    this.clearWireframeHelpers(model);
    model.traverse(child => {
      if (child.isMesh) {
        const originalMaterialData = this.originalMaterials.get(child.uuid);
        if (originalMaterialData) {
          child.material?.dispose();
          child.material = originalMaterialData.material.clone();
          child.material.needsUpdate = true;
        }
      }
    });
    this.activeMaterialMode = 'original';
  }

  applyAOMaterials(model) {
    const materialInspector = this._analysisManager?.materialInspector;
    if (materialInspector?.isActive) {
      materialInspector.deactivate();
    }
    this.clearWireframeHelpers(model);
    model.traverse(child => {
      if (!child.isMesh || child.userData?.isWireframeMesh) return;
      child.material = this.materialCache.ao.clone();
      child.material.aoMap = child.material.aoMap ||
        this.originalMaterials.get(child.uuid)?.material.aoMap;
      child.material.needsUpdate = true;
      // AO mode: no wireframe helper — smooth gray surface, visually distinct from Wireframe
    });
    this.activeMaterialMode = 'ao';
  }

  applyWireframeMaterials(model) {
    const materialInspector = this._analysisManager?.materialInspector;
    if (materialInspector?.isActive) {
      materialInspector.deactivate();
    }
    this.clearWireframeHelpers(model);
    model.traverse(child => {
      if (!child.isMesh || child.userData?.isWireframeMesh) return;
      child.material?.dispose();
      child.material = new THREE.MeshStandardMaterial({
        color: 0x808080,
        roughness: 1,
        metalness: 0
      });
      child.material.needsUpdate = true;
      this.addWireframeHelper(child);
    });
    this.activeMaterialMode = 'wireframe';
  }

  addWireframeHelper(mesh) {
    let mode = this.wireframeMode;

    if (mode === 'artist') {
      const hasArtistEdges = mesh.geometry?.userData?.artistEdges;
      if (!hasArtistEdges) {
        console.warn('[Volare] No artist edge data found — falling back to edges mode.');
        mode = 'edges';
      }
    }

    // EdgesGeometry/LineSegments produce static bind-pose geometry — cannot follow skinning
    if (mesh.isSkinnedMesh && mode === 'edges') {
      mode = 'triangle';
    }

    let helper;
    if (mode === 'edges') {
      const edgesGeo = new THREE.EdgesGeometry(mesh.geometry, DEFAULT_EDGE_THRESHOLD);
      const lineMat = new THREE.LineBasicMaterial({ color: 0x000000 });
      helper = new THREE.LineSegments(edgesGeo, lineMat);
      helper.userData.ownsGeometry = true;
    } else if (mesh.isSkinnedMesh) {
      const mat = new THREE.MeshBasicMaterial({ wireframe: true, color: 0x000000 });
      helper = new THREE.SkinnedMesh(mesh.geometry, mat);
      helper.skeleton = mesh.skeleton;
      helper.bindMatrix.copy(mesh.bindMatrix);
      helper.bindMatrixInverse.copy(mesh.bindMatrixInverse);
      if (mesh.morphTargetInfluences) {
        helper.morphTargetInfluences = mesh.morphTargetInfluences;
      }
      if (mesh.morphTargetDictionary) {
        helper.morphTargetDictionary = mesh.morphTargetDictionary;
      }
    } else {
      helper = new THREE.Mesh(
        mesh.geometry,
        new THREE.MeshBasicMaterial({ wireframe: true, color: 0x000000 })
      );
    }
    helper.userData.isWireframeMesh = true;
    helper.renderOrder = 1;
    // Match the source mesh: animated bounds are stale, so culling drops limbs.
    if (mesh.frustumCulled === false) helper.frustumCulled = false;
    mesh.add(helper);
  }

  getWireframeHelperCount(model) {
    if (!model) return 0;
    let count = 0;
    model.traverse(child => {
      if (child.userData?.isWireframeMesh) count++;
    });
    return count;
  }

  dispose() {
    for (const mat of this.originalMaterials.values()) {
      if (mat && typeof mat.dispose === 'function') mat.dispose();
    }
    this.originalMaterials.clear();
    Object.values(this.materialCache).forEach(material => material.dispose());
  }
}

export { MaterialManager as MaterialController };
