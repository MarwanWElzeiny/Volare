export class MaterialInspector {
    constructor(scene) {
        this.scene = scene;
        this.isActive = false;
        this.materials = new Map(); // Store original material states
        this.panel = null;
        this.currentModel = null;
        // Persists which map types the user has disabled; survives close/reopen
        this.textureVisibilityState = {};

        this.mapTypes = [
            { key: 'map', label: 'Diffuse', icon: 'fa-image' },
            { key: 'metalnessMap', label: 'Metalness', icon: 'fa-ring' },
            { key: 'roughnessMap', label: 'Roughness', icon: 'fa-water' },
            { key: 'normalMap', label: 'Normal', icon: 'fa-wave-square' },
            { key: 'emissiveMap', label: 'Emissive', icon: 'fa-lightbulb' },
            { key: 'aoMap', label: 'AO', icon: 'fa-circle-half-stroke' },
            { key: 'displacementMap', label: 'Displacement', icon: 'fa-layer-group' },
            { key: 'bumpMap', label: 'Bump', icon: 'fa-braille' }
        ];
    }

    activate() {
        if (this.isActive) return;
        this.onBeforeActivate?.(); // switches display mode to Original (not texture reset)
        this.isActive = true;
        this._notifyVisualToolkit('material-inspector-open');
        this.collectMaterials();
        this._applyStoredVisibility(); // restore user's texture toggle state
        if (!this.panel) this.createPanel();
        this.showPanel();
    }

    deactivate() {
        if (!this.isActive) return;
        this.isActive = false;
        this.onClose?.();
        this._notifyVisualToolkit('material-inspector-close');

        this.hidePanel();
        if (this._hideTimeout) clearTimeout(this._hideTimeout);

        this._hideTimeout = setTimeout(() => {
            this.destroyPanel();
        }, 400);
    }

    _notifyVisualToolkit(type) {
        document.dispatchEvent(new CustomEvent('volare:visual-toolkit-state', {
            detail: { type }
        }));
    }

    setModel(model) {
        this.currentModel = model;
        this.textureVisibilityState = {}; // new model — fresh toggle state
        if (this.isActive) {
            this.collectMaterials();
            this.refreshPanel();
        }
    }

    // Re-apply which map types the user had disabled before close.
    _applyStoredVisibility() {
        for (const [mapType, enabled] of Object.entries(this.textureVisibilityState)) {
            if (enabled) continue;
            this.materials.forEach(data => {
                if (data.originalMaps[mapType] !== null) {
                    data.material[mapType] = null;
                    data.material.needsUpdate = true;
                }
            });
        }
    }

    collectMaterials() {
        this.materials.clear();

        if (!this.currentModel) return;

        let materialIndex = 0;
        this.currentModel.traverse(child => {
            if (child.isMesh && child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];

                materials.forEach(material => {
                    if (material && !this.materials.has(material.uuid)) {
                        // Store original state - make sure to store the actual texture, not clone
                        const originalMaps = {};
                        this.mapTypes.forEach(({ key }) => {
                            originalMaps[key] = material[key] || null;
                        });

                        this.materials.set(material.uuid, {
                            material,
                            originalMaps,
                            name: material.name || `Material ${materialIndex++}`,
                            meshes: []
                        });
                    }

                    // Track which meshes use this material
                    const matData = this.materials.get(material.uuid);
                    if (matData && !matData.meshes.includes(child)) {
                        matData.meshes.push(child);
                    }
                });
            }
        });
    }

    createPanel() {
        this.panel = document.createElement('div');
        this.panel.className = 'material-inspector-panel';
        this.panel.innerHTML = `
            <div class="panel-header">
                <i class="fa-solid fa-palette"></i>
                <span>Material Inspector (${this.materials.size} Materials)</span>
                 <div class="close-material" data-action="close-material-panel"><i class="fas fa-times"></i></div>
            </div>
            <div class="panel-content">
                <div class="combined-controls">
                    <div class="global-map-controls"></div>
                </div>
                <div class="panel-actions">
                    <button class="reset-materials-btn" data-action="reset-materials">
                        <i class="fa-solid fa-rotate-left"></i>
                        Reset All
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(this.panel);

        this.setupEventListeners();
    }

    setupEventListeners() {
        if (!this.panel) return;

        this.panel.addEventListener('click', (e) => {
            const action = e.target.closest('[data-action]')?.dataset.action;
            const materialId = e.target.closest('[data-material-id]')?.dataset.materialId;
            const mapType = e.target.closest('[data-map-type]')?.dataset.mapType;

            if (action === 'close-material-panel') {
                this.deactivate();
            } else if (action === 'reset-materials') {
                this.resetAllMaterials();
            } else if (action === 'toggle-global-map' && mapType) {
                this.toggleGlobalMap(mapType);
            }
        });
    }

    refreshPanel() {
        if (!this.panel) return;

        // Update global controls
        this.updateGlobalControls();
    }

    updateGlobalControls() {
        const globalControls = this.panel.querySelector('.global-map-controls');

        const globalMapControls = this.mapTypes.map(({ key, label, icon }) => {
            const stats = this.getGlobalMapStats(key);
            const hasAnyMap = stats.total > 0;
            const allActive = stats.active === stats.total && stats.total > 0;
            const someActive = stats.active > 0 && stats.active < stats.total;

            let statusClass = '';
            if (allActive) statusClass = 'active';
            else if (!hasAnyMap) statusClass = 'disabled';

            return `
                <div class="global-map-toggle ${statusClass}"
                        data-action="toggle-global-map"
                        data-map-type="${key}"
                        ${!hasAnyMap ? 'disabled' : ''}>
                    <i class="fa-solid ${icon}"></i>
                    <span>${label}</span>
                    <div class="global-status">${stats.active}/${stats.total}</div>
                </div>
            `;
        }).join('');

        globalControls.innerHTML = globalMapControls;
    }

    getGlobalMapStats(mapType) {
        let total = 0;
        let active = 0;

        this.materials.forEach(data => {
            if (data.originalMaps[mapType] !== null) {
                total++;
                if (data.material[mapType] !== null) {
                    active++;
                }
            }
        });

        return { total, active };
    }

    toggleGlobalMap(mapType) {
        const stats = this.getGlobalMapStats(mapType);
        const shouldEnable = stats.active < stats.total;

        this.materials.forEach(data => {
            if (data.originalMaps[mapType] !== null) {
                data.material[mapType] = shouldEnable ? data.originalMaps[mapType] : null;
                data.material.needsUpdate = true;
            }
        });

        this.textureVisibilityState[mapType] = shouldEnable; // persist across close/reopen
        this.refreshPanel();
    }

    toggleMap(materialId, mapType) {
        const data = this.materials.get(materialId);
        if (!data || !data.originalMaps[mapType]) return;

        const material = data.material;
        const isCurrentlyActive = material[mapType] !== null;

        if (isCurrentlyActive) {
            // Disable map
            material[mapType] = null;
        } else {
            // Enable map
            material[mapType] = data.originalMaps[mapType];
        }

        material.needsUpdate = true;
        this.refreshPanel();
    }

    resetAllMaterials() {
        this.materials.forEach((data) => {
            const material = data.material;
            this.mapTypes.forEach(({ key }) => {
                material[key] = data.originalMaps[key];
            });
            material.needsUpdate = true;
        });
        this.textureVisibilityState = {}; // reset saved toggle state
        this.refreshPanel();
    }

    showPanel() {
        this.panel.classList.remove('hide');
        void this.panel.offsetWidth;
        this.panel.classList.add('show');
        this.refreshPanel();
    }

    hidePanel() {
        this.panel.classList.remove('show');
        this.panel.classList.add('hide');
    }

    destroyPanel() {
        if (this.panel) {
            this.panel.remove();
            this.panel = null;
        }
    }

    dispose() {
        this.deactivate();
        this.materials.clear();
        this.textureVisibilityState = {};
        this.currentModel = null;
    }
}

export { MaterialInspector as MaterialInspectorTool };
