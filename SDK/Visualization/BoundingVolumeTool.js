import * as THREE from 'three';

export class BoundingVolumeVisualizer {
    constructor(scene) {
        this.scene = scene;
        this.boundingBoxHelpers = new Map();
        this.boundingSphereHelpers = new Map();
        this.isActive = false;
        this._reusableSphere = new THREE.Sphere();
        this._reusableBox = new THREE.Box3();
    }

    _notifyVisualToolkit(type) {
        document.dispatchEvent(new CustomEvent('volare:visual-toolkit-state', { detail: { type } }));
    }

    activate() {
        if (this.isActive) return;
        this.isActive = true;
        this._notifyVisualToolkit('visualizer-open');
        this.showBoundingVolumes();
    }

    deactivate() {
        if (!this.isActive) return;
        this.isActive = false;
        this._notifyVisualToolkit('visualizer-close');
        this.hideBoundingVolumes();
    }

    _invalidateSkinnedBounds(mesh) {
        if (!mesh.isSkinnedMesh) return;
        if (mesh.boundingBox !== undefined) mesh.boundingBox = null;
        if (mesh.boundingSphere !== undefined) mesh.boundingSphere = null;
    }

    showBoundingVolumes() {
        this.hideBoundingVolumes();
        this.scene.traverse(child => {
            if (child.isMesh) {
                this._invalidateSkinnedBounds(child);

                const boxHelper = new THREE.BoxHelper(child, 0x00ff00);
                this.scene.add(boxHelper);
                this.boundingBoxHelpers.set(child, boxHelper);

                const box = this._reusableBox.setFromObject(child);
                const sphere = box.getBoundingSphere(this._reusableSphere);
                const sphereGeometry = new THREE.SphereGeometry(1, 16, 16);
                const sphereMaterial = new THREE.MeshBasicMaterial({
                    color: 0xff0000,
                    wireframe: true,
                    transparent: true,
                    opacity: 0.5
                });
                const sphereMesh = new THREE.Mesh(sphereGeometry, sphereMaterial);
                sphereMesh.position.copy(sphere.center);
                const r = sphere.radius || 1;
                sphereMesh.scale.set(r, r, r);
                this.scene.add(sphereMesh);
                this.boundingSphereHelpers.set(child, sphereMesh);
            }
        });
    }

    hideBoundingVolumes() {
        this.boundingBoxHelpers.forEach((helper) => {
            this.scene.remove(helper);
            helper.dispose?.();
        });

        this.boundingSphereHelpers.forEach((helper) => {
            this.scene.remove(helper);
            helper.geometry.dispose();
            helper.material.dispose();
        });

        this.boundingBoxHelpers.clear();
        this.boundingSphereHelpers.clear();
    }

    markDirty() { /* kept for API compat — updates are now continuous */ }

    updateRealtime() {
        if (!this.isActive) return;

        this.boundingBoxHelpers.forEach((helper, mesh) => {
            this._invalidateSkinnedBounds(mesh);
            helper.update();
        });

        this.boundingSphereHelpers.forEach((helper, mesh) => {
            this._invalidateSkinnedBounds(mesh);
            const box = this._reusableBox.setFromObject(mesh);
            const sphere = box.getBoundingSphere(this._reusableSphere);
            helper.position.copy(sphere.center);
            const r = sphere.radius || 1;
            helper.scale.set(r, r, r);
        });
    }

    dispose() {
        this.deactivate(); // deactivate() already calls hideBoundingVolumes()
        this.scene = null;
  }
}

export { BoundingVolumeVisualizer as BoundingVolumeTool };
