import * as THREE from 'three';
import { VertexNormalsHelper } from 'three/addons/helpers/VertexNormalsHelper.js';

const NORMAL_LENGTH = 0.1;
const NORMAL_COLOR = 0x00ff00;
// Cap sampled arrows per SkinnedMesh to keep CPU skinning bounded
const MAX_SKINNED_ARROWS = 4000;

export class NormalVectorVisualizer {
    constructor(scene) {
        this.scene = scene;
        this.normalHelpers = [];
        this._skinnedEntries = [];
        this.isActive = false;
    }

    _notifyVisualToolkit(type) {
        document.dispatchEvent(new CustomEvent('volare:visual-toolkit-state', { detail: { type } }));
    }

    activate() {
        if (this.isActive) return;
        this.isActive = true;
        this._notifyVisualToolkit('visualizer-open');
        this.showNormals();
    }

    deactivate() {
        if (!this.isActive) return;
        this.isActive = false;
        this._notifyVisualToolkit('visualizer-close');
        this.hideNormals();
    }

    showNormals() {
        this.hideNormals();

        this.scene.traverse(child => {
            if (!child.isMesh || !child.geometry) return;
            if (child.isSkinnedMesh) {
                this._addSkinnedHelper(child);
            } else {
                const helper = new VertexNormalsHelper(child, NORMAL_LENGTH, NORMAL_COLOR);
                this.scene.add(helper);
                this.normalHelpers.push(helper);
            }
        });
    }

    _addSkinnedHelper(mesh) {
        const geo = mesh.geometry;
        const posAttr = geo.attributes.position;
        const normalAttr = geo.attributes.normal;
        if (!posAttr || !normalAttr) return;

        const vertexCount = posAttr.count;
        const stride = Math.max(1, Math.ceil(vertexCount / MAX_SKINNED_ARROWS));
        const indices = [];
        for (let i = 0; i < vertexCount; i += stride) indices.push(i);

        const linePositions = new Float32Array(indices.length * 2 * 3);
        const lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));

        const lineMat = new THREE.LineBasicMaterial({ color: NORMAL_COLOR });
        const lineHelper = new THREE.LineSegments(lineGeo, lineMat);
        lineHelper.frustumCulled = false;
        lineHelper.userData.volareHelper = true;
        this.scene.add(lineHelper);

        this._skinnedEntries.push({
            mesh,
            helper: lineHelper,
            indices,
            posAttr,
            normalAttr,
            linePositions
        });

        this._updateSkinnedEntry(this._skinnedEntries[this._skinnedEntries.length - 1]);
    }

    _updateSkinnedEntry(entry) {
        const { mesh, indices, posAttr, normalAttr, linePositions } = entry;
        const geo = mesh.geometry;
        const morphPositions = geo.morphAttributes?.position;
        const morphInfluences = mesh.morphTargetInfluences;
        const applyBone = mesh.applyBoneTransform?.bind(mesh) || mesh.boneTransform?.bind(mesh);
        const matrixWorld = mesh.matrixWorld;

        const _pos = new THREE.Vector3();
        const _end = new THREE.Vector3();
        const _delta = new THREE.Vector3();

        let offset = 0;
        for (const idx of indices) {
            _pos.fromBufferAttribute(posAttr, idx);
            _end.set(
                _pos.x + normalAttr.getX(idx) * NORMAL_LENGTH,
                _pos.y + normalAttr.getY(idx) * NORMAL_LENGTH,
                _pos.z + normalAttr.getZ(idx) * NORMAL_LENGTH
            );

            if (morphPositions && morphInfluences) {
                for (let m = 0; m < morphPositions.length; m++) {
                    const w = morphInfluences[m];
                    if (!w) continue;
                    _delta.fromBufferAttribute(morphPositions[m], idx);
                    _pos.addScaledVector(_delta, w);
                    _end.addScaledVector(_delta, w);
                }
            }

            if (applyBone) {
                applyBone(idx, _pos);
                applyBone(idx, _end);
            }

            _pos.applyMatrix4(matrixWorld);
            _end.applyMatrix4(matrixWorld);

            linePositions[offset]     = _pos.x;
            linePositions[offset + 1] = _pos.y;
            linePositions[offset + 2] = _pos.z;
            linePositions[offset + 3] = _end.x;
            linePositions[offset + 4] = _end.y;
            linePositions[offset + 5] = _end.z;
            offset += 6;
        }

        entry.helper.geometry.attributes.position.needsUpdate = true;
    }

    hideNormals() {
        this.normalHelpers.forEach(helper => {
            if (helper) {
                this.scene.remove(helper);
                helper.dispose?.();
            }
        });
        this.normalHelpers = [];

        this._skinnedEntries.forEach(entry => {
            this.scene.remove(entry.helper);
            entry.helper.geometry.dispose();
            entry.helper.material.dispose();
        });
        this._skinnedEntries = [];
    }

    markDirty() { /* kept for API compat — updates are now continuous */ }

    updateRealtime() {
        if (!this.isActive) return;

        this.normalHelpers.forEach(helper => helper.update());

        for (const entry of this._skinnedEntries) {
            this._updateSkinnedEntry(entry);
        }
    }

    dispose() {
        this.deactivate(); // deactivate() already calls hideNormals()
        this.scene = null;
    }
}

export { NormalVectorVisualizer as NormalVectorTool };
