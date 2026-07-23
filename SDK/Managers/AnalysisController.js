import { LightingPreset } from "../Interaction/LightingPreset.js";
import { CrossSection } from "../Visualization/CrossSectionTool.js";
import { MeshAnalysis } from "../Visualization/MeshAnalysisTool.js";
import { BoundingVolumeVisualizer } from "../Visualization/BoundingVolumeTool.js";
import { NormalVectorVisualizer } from "../Visualization/NormalVectorTool.js";
import { UVViewer } from "../Analysis/UVPreviewTool.js";
import { PerformanceMonitor } from "../Analysis/PerformanceTool.js";
import { DirectorMode } from "../Interaction/DirectorMode.js";
import { TurntablePlus } from "../Interaction/TurntablePlus.js";
import { PolygonCounter } from "../Analysis/PolygonCounter.js";
import { TextureAnalyzer } from "../Analysis/TextureAnalyzerTool.js";
import { MaterialInspector } from "../Analysis/MaterialInspectorTool.js";
import { DOM_IDS, DOM_CLASSES } from '../UI/ViewerUIController.js';

export class AnalysisManager {
  static DOM_IDS = DOM_IDS;
  static DOM_CLASSES = DOM_CLASSES;

  constructor(scene, camera, renderer, controls, domElement, model, materialManager, options = {}) {
    if (!renderer) {
      console.warn('[AnalysisManager] Renderer is null, performance monitoring disabled');
    }
    if (!scene) {
      console.warn('[AnalysisManager] Scene is null');
    }
    let mixer = null;
    let animations = [];
    let activeActions = [];
    this.scene = scene;
    this.model = model;
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;
    this.domElement = domElement;
    this.materialManager = materialManager;
    // Initialize all analysis systems
    this.LightingPreset = new LightingPreset(scene, renderer);
    this.polygonCounter = new PolygonCounter();
    this.textureAnalyzer = new TextureAnalyzer();
    this.crossSection = new CrossSection(scene, renderer);
    this.meshAnalysis = new MeshAnalysis(scene, camera, controls, renderer?.domElement || domElement);
    this.meshInspector = this.meshAnalysis;
    this.vertexSelector = this.meshAnalysis;
    this.boundingVolumeVisualizer = new BoundingVolumeVisualizer(scene);
    this.normalVectorVisualizer = new NormalVectorVisualizer(scene);
    this.materialInspector = new MaterialInspector(scene);

    this.uvViewer = new UVViewer({
      resolution: 2048,
      showChecker: false,
      showSeams: true,
      antiAlias: true,
      checkerResolution: '1K',
      uvWorker: options?.performance?.uvWorker !== false,
    });
    // this.touchGestureHandler = new TouchGestureHandler(domElement, camera, controls);
    this.performanceMonitor = new PerformanceMonitor(domElement);

    this.directorMode = new DirectorMode(scene, camera, controls, model);
    this.turntablePlus = new TurntablePlus(scene, camera, renderer, controls, model);

    this.activeTools = new Set();
    this.eventCleanups = [];
    this.realtimeSyncFrame = null;
    this.disposed = false;
    this.uiEventsInitialized = false;
    this.lastToolSync = 0;
    this.pendingToolTimers = new Set();

    this._uvButton = null;
    this._perfButton = null;
    this._normalsButton = null;
    this._meshAnalysisElements = [];
    this._animationManager = null;
    this._savedAnimState = null;
  }

  setAnimationManager(mgr) {
    this._animationManager = mgr;
  }

  _saveAndPlayAnimation() {
    const mgr = this._animationManager;
    if (!mgr || !mgr.animations?.length) return;
    this._savedAnimState = { wasPlaying: mgr.isPlaying, wasPaused: mgr.isPaused };
    if (!mgr.isPlaying && !mgr.isPaused) {
      mgr.playAnimation(mgr.currentAnimationIndex || 0);
    } else if (mgr.isPaused) {
      mgr.resumeAnimations();
    }
  }

  _restoreAnimationState() {
    const mgr = this._animationManager;
    const saved = this._savedAnimState;
    if (!mgr || !saved) { this._savedAnimState = null; return; }
    if (!saved.wasPlaying && !saved.wasPaused) {
      mgr.stopAllAnimations();
    } else if (saved.wasPaused) {
      mgr.pauseAnimations();
    }
    this._savedAnimState = null;
  }

  addTrackedEventListener(element, event, handler, options) {
    if (!element || typeof element.addEventListener !== 'function') return;
    element.addEventListener(event, handler, options);
    this.eventCleanups.push(() => element.removeEventListener(event, handler, options));
  }

  cleanupTrackedEventListeners() {
    this.eventCleanups.splice(0).forEach(cleanup => {
      try { cleanup(); } catch (error) { console.warn('[AnalysisManager] listener cleanup failed:', error); }
    });
  }

  safeToolCall(tool, method, label = 'tool') {
    try {
      return tool?.[method]?.();
    } catch (error) {
      console.warn(`[AnalysisManager] ${label}.${method} failed:`, error);
      return undefined;
    }
  }

  notifyVisualToolkit(type, detail = {}) {
    document.dispatchEvent(new CustomEvent('volare:visual-toolkit-state', {
      detail: { type, ...detail }
    }));
  }

  clearPendingToolActivations() {
    this.pendingToolTimers.forEach(timer => clearTimeout(timer));
    this.pendingToolTimers.clear();
  }

  disposeTool(tool, label) {
    if (!tool) return;
    if (typeof tool.dispose === 'function') {
      this.safeToolCall(tool, 'dispose', label);
      return;
    }
    if (typeof tool.deactivate === 'function') {
      this.safeToolCall(tool, 'deactivate', label);
      return;
    }
    if (typeof tool.close === 'function') {
      this.safeToolCall(tool, 'close', label);
    }
  }

  // Initialize all systems
  async initialize() {
    try {
      this.setupAdvancedUIEvents();
      // this.performanceMonitor.activate();
    } catch (e) {
      console.error("[AnalysisManager] Initialization failed:", e);
    }
  }

  setModel(model) {
    this.deactivateAllTools();
    this.markDirtyAll();
    this.currentModel = model;
    this.model = model;

    if (this.directorMode?.setModel) this.directorMode.setModel(model);
    if (this.turntablePlus?.setModel) this.turntablePlus.setModel(model);
    if (this.polygonCounter?.setModel) this.polygonCounter.setModel(model);
    if (this.textureAnalyzer?.setModel) this.textureAnalyzer.setModel(model);
    if (this.materialInspector?.setModel) this.materialInspector.setModel(model);
    if (this.vertexSelector?.invalidateCache) this.vertexSelector.invalidateCache();
  }

  debounce(func, wait) {
      let timeout;
      return function executedFunction(...args) {
          const later = () => {
              clearTimeout(timeout);
              func(...args);
          };
          clearTimeout(timeout);
          timeout = setTimeout(later, wait);
      };
  }
  // Analyze current model
  analyzeModel(model) {
    if (!model) return null;

    const analysis = {
      polygons: this.polygonCounter.analyze(model),
      textures: this.textureAnalyzer.analyzeModel(model),
      timestamp: new Date().toISOString()
    };

    return analysis;
  }

  // Update systems that need frame updates
  update() {
    if (this.disposed) return;

    if (this.renderer && this.scene && this.performanceMonitor?.isActive) {
      this.performanceMonitor.updateRenderStats(this.renderer, this.scene);
      this.performanceMonitor.update();
    }
    if (this.boundingVolumeVisualizer?.isActive) this.safeToolCall(this.boundingVolumeVisualizer, 'updateRealtime', 'boundingVolumeVisualizer');
    if (this.normalVectorVisualizer?.isActive) this.safeToolCall(this.normalVectorVisualizer, 'updateRealtime', 'normalVectorVisualizer');
    if (this.crossSection?.isActive) this.safeToolCall(this.crossSection, 'updateRealtime', 'crossSection');
    if (this.vertexSelector?.isActive) this.safeToolCall(this.vertexSelector, 'updateRealtime', 'vertexSelector');
  }

  // Clean up all systems
  dispose() {
    this.disposed = true;
    this.clearPendingToolActivations();
    if (this.realtimeSyncFrame) {
      cancelAnimationFrame(this.realtimeSyncFrame);
      this.realtimeSyncFrame = null;
    }
    this.cleanupTrackedEventListeners();
    // this.touchGestureHandler.deactivate();
    this.disposeTool(this.crossSection, 'crossSection');
    this.disposeTool(this.vertexSelector, 'vertexSelector');
    this.disposeTool(this.boundingVolumeVisualizer, 'boundingVolumeVisualizer');
    this.disposeTool(this.normalVectorVisualizer, 'normalVectorVisualizer');
    this.disposeTool(this.uvViewer, 'uvViewer');
    this.disposeTool(this.directorMode, 'directorMode');
    this.disposeTool(this.turntablePlus, 'turntablePlus');
    this.disposeTool(this.materialInspector, 'materialInspector');
    this.disposeTool(this.performanceMonitor, 'performanceMonitor');
    this.clearToolButtonStates();
  }
  getActiveToolNames() {
    const names = [];
    if (this.crossSection?.isActive) names.push('crossSection');
    if (this.vertexSelector?.isActive) names.push('vertexSelector');
    if (this.boundingVolumeVisualizer?.isActive) names.push('boundingVolume');
    if (this.normalVectorVisualizer?.isActive) names.push('normalVector');
    if (this.uvViewer?.isActive) names.push('uvPreview');
    if (this.directorMode?.isActive) names.push('directorMode');
    if (this.turntablePlus?.isActive) names.push('turntablePlus');
    if (this.materialInspector?.isActive) names.push('materialInspector');
    if (this.performanceMonitor?.isActive) names.push('performanceMonitor');
    return names;
  }

  markDirtyAll() {
    if (this.boundingVolumeVisualizer?.markDirty) this.boundingVolumeVisualizer.markDirty();
    if (this.normalVectorVisualizer?.markDirty) this.normalVectorVisualizer.markDirty();
  }

  clearToolButtonStates() {
      this.toolButtonMappings?.forEach(({ button }) => {
        button.classList.remove(DOM_CLASSES.ACTIVE);
      });
      this._uvButton?.classList.remove(DOM_CLASSES.ACTIVE);
      this._normalsButton?.classList.remove(DOM_CLASSES.ACTIVE);
      this._meshAnalysisElements.forEach(el => el.classList.remove(DOM_CLASSES.ACTIVE));
      // Performance monitor is sticky — only clear its button when the tool is actually inactive
      if (this._perfButton) {
        this._perfButton.classList.toggle(DOM_CLASSES.ACTIVE, !!this.performanceMonitor?.isActive);
      }
  }

  refreshToolButtonStates() {
      if (this.disposed) return;
      this.syncToolButtonStates?.();
  }

  deactivateAllTools() {
      this.clearPendingToolActivations();
      this.safeToolCall(this.boundingVolumeVisualizer, 'deactivate', 'boundingVolumeVisualizer');
      this.safeToolCall(this.normalVectorVisualizer, 'deactivate', 'normalVectorVisualizer');
      this.safeToolCall(this.crossSection, 'deactivate', 'crossSection');
      this.safeToolCall(this.vertexSelector, 'deactivate', 'vertexSelector');
      this.safeToolCall(this.uvViewer, 'close', 'uvViewer');
      this.safeToolCall(this.directorMode, 'deactivate', 'directorMode');
      this.safeToolCall(this.turntablePlus, 'deactivate', 'turntablePlus');
      this.safeToolCall(this.materialInspector, 'deactivate', 'materialInspector');
      this.clearToolButtonStates();
  }
  setupAdvancedUIEvents() {
    if (this.uiEventsInitialized) return;
    this.uiEventsInitialized = true;

    // Store button-tool mappings for easy access
    this.toolButtonMappings = new Map();

    // Enhanced toggle button with real-time state sync
    const toggleButton = (id, tool, options = {}) => {
      const btn = document.getElementById(id);
      if (!btn) return;

      // Store the mapping for real-time updates
      this.toolButtonMappings.set(tool, { button: btn, options });

      this.addTrackedEventListener(btn, 'click', this.debounce(() => {
        if (this.disposed) return;
        if (tool.isActive) {
          this.safeToolCall(tool, 'deactivate', id);
          btn.classList.remove(DOM_CLASSES.ACTIVE);
          if (options.onDeactivate) options.onDeactivate();
        } else {
          this.deactivateAllTools();
          document.querySelectorAll(`.${DOM_CLASSES.TOOL_TOGGLE}, .vlr-advanced-btn`).forEach(b => b.classList.remove(DOM_CLASSES.ACTIVE));
          if (this._perfButton && this.performanceMonitor?.isActive) {
            this._perfButton.classList.add(DOM_CLASSES.ACTIVE);
          }
          const timer = setTimeout(() => {
            this.pendingToolTimers.delete(timer);
            if (this.disposed) return;
            this.safeToolCall(tool, 'activate', id);
            btn.classList.add(DOM_CLASSES.ACTIVE);
            if (options.onActivate) options.onActivate();
          }, 50);
          this.pendingToolTimers.add(timer);
        }
      }, 300));
    };

    // Real-time state synchronization method
    this.syncToolButtonStates = () => {
      this.toolButtonMappings.forEach(({ button, options }, tool) => {
        const shouldBeActive = !!tool?.isActive;
        const isCurrentlyActive = button.classList.contains(DOM_CLASSES.ACTIVE);

        if (shouldBeActive && !isCurrentlyActive) {
          button.classList.add(DOM_CLASSES.ACTIVE);
          if (options.onActivate) options.onActivate();
        } else if (!shouldBeActive && isCurrentlyActive) {
          button.classList.remove(DOM_CLASSES.ACTIVE);
          if (options.onDeactivate) options.onDeactivate();
        }
      });

      // Handle special cases that aren't in the mapping
      this.syncSpecialButtons();
    };

    // Handle special buttons that need custom sync logic (uses stored refs)
    this.syncSpecialButtons = () => {
      if (this._uvButton) {
        this._uvButton.classList.toggle(DOM_CLASSES.ACTIVE, !!this.uvViewer.isActive);
      }
      if (this._perfButton) {
        this._perfButton.classList.toggle(DOM_CLASSES.ACTIVE, !!this.performanceMonitor.isActive);
      }
      if (this._normalsButton) {
        this._normalsButton.classList.toggle(DOM_CLASSES.ACTIVE, !!this.normalVectorVisualizer.isActive);
      }
    };

    // Event-driven state sync; avoids a permanent requestAnimationFrame loop while tools are inactive.
    this.startRealtimeSync = () => {
      this.syncToolButtonStates();
    };

    // Tool toggles with active class management
    toggleButton(DOM_IDS.TOGGLE_MATERIAL_INSPECTOR, this.materialInspector, {
      onActivate: () => this.notifyVisualToolkit('material-inspector-open'),
      onDeactivate: () => this.notifyVisualToolkit('material-inspector-close')
    });
    const prevMatOnClose = this.materialInspector.onClose;
    this.materialInspector.onClose = () => {
      prevMatOnClose?.();
      this.notifyVisualToolkit('material-inspector-close');
      this.refreshToolButtonStates();
    };
    toggleButton(DOM_IDS.TOGGLE_TURNTABLE_PLUS, this.turntablePlus, {
      onActivate: () => this._saveAndPlayAnimation(),
      onDeactivate: () => this._restoreAnimationState()
    });
    toggleButton(DOM_IDS.TOGGLE_BOUNDING_VOLUMES, this.boundingVolumeVisualizer);
    toggleButton(DOM_IDS.TOGGLE_CROSS_SECTION, this.crossSection);
    toggleButton(DOM_IDS.TOGGLE_DIRECTOR_MODE, this.directorMode, {
      onActivate: () => this._saveAndPlayAnimation(),
      onDeactivate: () => this._restoreAnimationState()
    });

    // Normals with timeout logic
    const normalsBtn = document.getElementById(DOM_IDS.TOGGLE_NORMALS);
    this._normalsButton = normalsBtn;
    let normalToggleTimeout = null;
    this.addTrackedEventListener(normalsBtn, 'click', this.debounce(() => {
      if (normalToggleTimeout) {
        clearTimeout(normalToggleTimeout);
        normalToggleTimeout = null;
      }

      if (this.normalVectorVisualizer.isActive) {
        this.safeToolCall(this.normalVectorVisualizer, 'deactivate', 'normalVectorVisualizer');
        normalsBtn.classList.remove(DOM_CLASSES.ACTIVE);
      } else {
        this.deactivateAllTools();
        document.querySelectorAll('.tool-toggle, .vlr-advanced-btn').forEach(b => b.classList.remove(DOM_CLASSES.ACTIVE));
        if (this._perfButton && this.performanceMonitor?.isActive) {
          this._perfButton.classList.add(DOM_CLASSES.ACTIVE);
        }
        normalToggleTimeout = setTimeout(() => {
          if (this.disposed) return;
          this.safeToolCall(this.normalVectorVisualizer, 'activate', 'normalVectorVisualizer');
          normalsBtn.classList.add(DOM_CLASSES.ACTIVE);
          normalToggleTimeout = null;
        }, 100);
      }
    }, 300));

    // UV Preview (non-exclusive toggle)
    const uvBtn = document.getElementById(DOM_IDS.TOGGLE_UV_PREVIEW);
    this._uvButton = uvBtn;
    this.addTrackedEventListener(uvBtn, 'click', () => {
      if (this.disposed) return;
      if (this.uvViewer.isActive) {
        this.safeToolCall(this.uvViewer, 'close', 'uvViewer');
        uvBtn?.classList.remove(DOM_CLASSES.ACTIVE);
      } else {
        try {
          this.uvViewer.open(this.scene);
        } catch (error) {
          console.warn('[AnalysisManager] uvViewer.open failed:', error);
        }
        uvBtn?.classList.add(DOM_CLASSES.ACTIVE);
      }
    });

    const prevUvOnClose = this.uvViewer.onClose;
    this.uvViewer.onClose = () => {
      prevUvOnClose?.();
      this.refreshToolButtonStates();
    };

    // Vertex selection with extra UI
    this._meshAnalysisElements = [
      ...document.querySelectorAll(`.${DOM_CLASSES.MESH_ANALYSIS_MAIN}`),
      ...document.querySelectorAll(`.${DOM_CLASSES.MESH_ANALYSIS_BACK}`)
    ];
    toggleButton(DOM_IDS.TOGGLE_MESH_ANALYSIS, this.vertexSelector, {
      onActivate: () => {
        this.notifyVisualToolkit('mesh-inspector-open');
        this._meshAnalysisElements.forEach(el => el.classList.add(DOM_CLASSES.ACTIVE));
      },
      onDeactivate: () => {
        this.notifyVisualToolkit('mesh-inspector-close');
        this._meshAnalysisElements.forEach(el => el.classList.remove(DOM_CLASSES.ACTIVE));
      }
    });

    const prevVsOnClose = this.vertexSelector.onClose;
    this.vertexSelector.onClose = () => {
      prevVsOnClose?.();
      this.notifyVisualToolkit('mesh-inspector-close');
      this.refreshToolButtonStates();
      this._meshAnalysisElements.forEach(el => el.classList.remove(DOM_CLASSES.ACTIVE));
    };

    // Special vertex operations
    this.addTrackedEventListener(document.getElementById(DOM_IDS.SELECT_MESH), 'click', () => {
      if (!this.vertexSelector.isActive) {
        this.safeToolCall(this.vertexSelector, 'activate', 'vertexSelector');
        document.getElementById(DOM_IDS.TOGGLE_MESH_ANALYSIS)?.classList.add(DOM_CLASSES.ACTIVE);
      }
    });

    this.addTrackedEventListener(document.getElementById(DOM_IDS.ROTATE_AROUND), 'click', () => {
      if (this.vertexSelector.isActive) {
        this.safeToolCall(this.vertexSelector, 'deactivate', 'vertexSelector');
        document.getElementById(DOM_IDS.TOGGLE_MESH_ANALYSIS)?.classList.remove(DOM_CLASSES.ACTIVE);
      }
    });

    // Lighting presets
    this.addTrackedEventListener(document.getElementById(DOM_IDS.LIGHTING_PRESETS), 'change', (e) => {
      try {
        this.LightingPreset.applyPreset(e.target.value);
      } catch (error) {
        console.warn('[AnalysisManager] Lighting preset failed:', error);
      }
    });

    // Performance monitor toggle (non-exclusive)
    const perfBtn = document.getElementById(DOM_IDS.TOGGLE_PERFORMANCE);
    this._perfButton = perfBtn;
    this.addTrackedEventListener(perfBtn, 'click', () => {
      if (this.disposed) return;
      if (this.performanceMonitor.isActive) {
        this.safeToolCall(this.performanceMonitor, 'deactivate', 'performanceMonitor');
        perfBtn.classList.remove(DOM_CLASSES.ACTIVE);
      } else {
        this.safeToolCall(this.performanceMonitor, 'activate', 'performanceMonitor');
        perfBtn.classList.add(DOM_CLASSES.ACTIVE);
      }
    });

    this.startRealtimeSync();

    // Optional: Add keyboard event listeners to ensure sync after keyboard shortcuts
    this.addTrackedEventListener(document, 'keydown', () => {
      // Add a small delay to ensure the tool state has been updated
      setTimeout(() => {
        const now = performance.now();
        if (!this.disposed && now - this.lastToolSync > 150) {
          this.syncToolButtonStates();
          this.lastToolSync = now;
        }
      }, 50);
    });
  }


  updateAnalysisResults(analysis) {
    const resultsDiv = document.getElementById('analysis-results');
    if (!resultsDiv || !analysis) return;

    resultsDiv.textContent = '';
    const h4 = document.createElement('h4');
    h4.textContent = 'Model Statistics';
    resultsDiv.appendChild(h4);
    const stats = [
      ['Triangles', analysis.polygons.triangles.toLocaleString()],
      ['Vertices',  analysis.polygons.vertices.toLocaleString()],
      ['Materials', analysis.polygons.materials],
      ['Unique Textures', analysis.polygons.textures],
    ];
    for (const [label, val] of stats) {
      const p = document.createElement('p');
      p.textContent = `${label}: ${val}`;
      resultsDiv.appendChild(p);
    }

    this.notifyVisualToolkit('model-stats-ready');
  }
}

export { AnalysisManager as AnalysisController };
