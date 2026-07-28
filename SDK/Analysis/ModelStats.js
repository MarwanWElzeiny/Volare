import * as THREE from 'three';

function isVolareHelper(child) {
  // isWireframeMesh is the actual flag MaterialController's wireframe
  // overlay sets (see SDK/Managers/MaterialController.js) -- it shares the
  // source mesh's geometry via mesh.add(helper), so leaving it uncounted
  // silently doubles vertex/triangle/material counts while Wireframe is active.
  return !!(child.userData?.volareHelper || child.userData?.isWireframeMesh);
}

// LOD levels are all real children of the LOD object, so a plain traverse()
// would sum every detail level at once. Only the level three.js picked as
// current (via LOD.update(camera), which the renderer calls every frame)
// should count toward the totals.
function isInactiveLODLevel(child) {
  const parentLOD = child.parent;
  if (!parentLOD?.isLOD || typeof parentLOD.getCurrentLevel !== 'function') return false;
  const active = parentLOD.levels[parentLOD.getCurrentLevel()]?.object;
  return !!active && active !== child;
}

function estimateTextureBytes(texture) {
  const w = texture.image?.width || 0;
  const h = texture.image?.height || 0;
  if (!w || !h) return 0;
  const bytesPerPixel = 4;
  const mipFactor = texture.generateMipmaps === false ? 1 : 4 / 3;
  return w * h * bytesPerPixel * mipFactor;
}

// Single source of truth for model statistics, shared by VolareViewer's
// internal huge-model classification and the AnalysisController UI panel
// (previously two separate, inconsistent implementations).
export function computeModelStats(model, { renderer, animationManager } = {}) {
  if (!model) return null;

  let vertexCount = 0, triangleCount = 0, meshCount = 0, geometryBytes = 0;
  const materials = new Set();
  const textures = new Set();
  const skeletons = new Set();
  const box = new THREE.Box3();
  box.makeEmpty();

  model.traverse(child => {
    if (isVolareHelper(child) || isInactiveLODLevel(child)) return;
    if (!child.isMesh) return;

    const instances = child.isInstancedMesh ? Math.max(1, child.count) : 1;
    meshCount += instances;

    const geo = child.geometry;
    const pos = geo?.attributes?.position;
    if (pos) vertexCount += pos.count * instances;
    if (geo?.index) triangleCount += (geo.index.count / 3) * instances;
    else if (pos) triangleCount += (pos.count / 3) * instances;

    if (child.isSkinnedMesh && child.skeleton) skeletons.add(child.skeleton);

    if (child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach(m => {
        materials.add(m);
        Object.keys(m).forEach(k => { if (m[k]?.isTexture) textures.add(m[k]); });
      });
    }

    if (geo) {
      for (const key in geo.attributes) geometryBytes += geo.attributes[key].array?.byteLength || 0;
      if (geo.index) geometryBytes += geo.index.array?.byteLength || 0;
    }

    child.updateMatrixWorld(true);
    box.union(new THREE.Box3().setFromObject(child, true));
  });

  if (box.isEmpty()) box.setFromObject(model, true);
  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);

  let boneCount = 0;
  skeletons.forEach(sk => { boneCount += sk.bones.length; });

  let textureBytes = 0;
  textures.forEach(tex => { textureBytes += estimateTextureBytes(tex); });

  return {
    vertexCount: Math.round(vertexCount),
    triangleCount: Math.round(triangleCount),
    meshCount,
    materialCount: materials.size,
    textureCount: textures.size,
    animationCount: animationManager?.animations?.length ?? 0,
    boneCount,
    // Renderer-wide count as of the most recent render() call — three.js
    // exposes no per-model draw-call breakdown, only a scene-total counter.
    drawCalls: renderer?.info?.render?.calls ?? null,
    memoryBytes: Math.round(geometryBytes + textureBytes),
    boundingBox: { min: box.min.toArray(), max: box.max.toArray() },
    boundingSphere: { center: sphere.center.toArray(), radius: sphere.radius }
  };
}
