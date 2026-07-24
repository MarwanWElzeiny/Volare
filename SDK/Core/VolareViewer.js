import '../Utils/ssrGlobalsShim.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { WebGPURenderer } from 'three/webgpu';

import { AnalysisManager } from "../Managers/AnalysisController.js";
import { AnimationManager } from "../Managers/AnimationController.js";
import { LightingManager } from '../Managers/LightingController.js';
import { VolareManager } from '../Managers/ModelLoaderManager.js';
import { MaterialManager } from "../Managers/MaterialController.js";
import { UIManager } from "../UI/ViewerUIController.js";
import { ButtonManager } from "../UI/ViewerUIController.js";
import { getToolkitPanelsHTML, VolareDOMManager, VolareCanvas } from "../UI/ViewerUIController.js";
import Debouncer from "../Utils/Debouncer.js";

import * as THREE from 'three';

function detectWebGLSupport() {
  try {
    const canvas = document.createElement('canvas');
    const webgl2 = canvas.getContext('webgl2');
    const context = webgl2 || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    const version = webgl2 ? 'webgl2' : (context ? 'webgl1' : null);
    context?.getExtension?.('WEBGL_lose_context')?.loseContext?.();
    return {
      supported: !!context,
      version
    };
  } catch (error) {
    return {
      supported: false,
      version: null,
      error: error?.message || String(error)
    };
  }
}

function detectWebGPUSupport() {
  const gpu = globalThis.navigator?.gpu;
  return {
    supported: !!gpu,
    experimental: true,
    rendererAvailable: !!gpu,
    reason: gpu
      ? 'navigator.gpu detected; Volare will use the WebGPU backend if the adapter request succeeds.'
      : 'navigator.gpu is not available in this browser.'
  };
}

function normalizeRendererBackend(backend) {
  return String(backend || 'auto').toLowerCase();
}

class VolareViewerInit {
  constructor(containerElement, options = {}) {
    this.container = typeof containerElement === 'string' ? document.getElementById(containerElement) : containerElement;
    this.options = this.mergeDefaultOptions(options);
    this.uiEnabled = this.options.ui !== false;
    this.pluginManager = this.options.pluginManager || null;
    this.rendererBackend = {
      requested: normalizeRendererBackend(this.options.renderer?.preferredBackend),
      selected: null,
      available: {
        webgl: detectWebGLSupport(),
        webgpu: detectWebGPUSupport()
      },
      fallback: null,
      error: null
    };

    // Core Three.js components
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.clock = new THREE.Clock();
    this.debounce = Debouncer;

    // State management
    this.isInitialized = false;
    this.currentModel = null;
    this.animationFrameId = null;
    this.selectedModelPath = null;
    this.disposed = false;
    this.renderLoopActive = false;
    this.listenerCleanups = [];
    this.currentIndex = 0;
    this.initialized = false;
    this.modelLoaded = false;
    this.hdriLoaded = false;
    this.hdriEnabled = true;

    this.manager = new THREE.LoadingManager();
    this.hdrLoader = new RGBELoader();
    // Plugin managers
    this.lightingManager = null;
    this.volareManager = null;
    this.materialManager = null;
    this.analysisManager = null;
    this.animationManager = null;
    this.uiManager = null;
    this.buttonManager = null;
    this.eventHandlers = new Map();
    this.modelStats = null;
    this.modelSizeClass = null;
    this.hugeModelMode = false;
    this.followingModel = false;
    this._followTarget = new THREE.Vector3();
    this._cachedRootBone = null;
    this._cachedRootBoneModelId = null;
    this._firstRenderDone = false;
    this.defaultEnvironmentPath = this.options.defaultHdri || 'lonely-road-afternoon';

    this.init();

  }

  init() {
    if (this.isInitialized) return;

    this.ensureToolkitMarkup();
    this.initializeThreeJS();
    this.initializeManagers();
    this.setupEventListeners();
    this.startRenderLoop();
    this.setEnvironment({ preset: this.defaultEnvironmentPath });

    this.isInitialized = true;
    this.emit('initialized');
  }

  // Generates the toolkit HTML (buttons, panels, HDRI switcher) inside
  // whatever container the consumer gave createVolareViewer(), scoped via
  // .vlr-embed-container (see viewer.css) instead of the demo's full-viewport
  // #VolareCanvas overlay. No-op if the container already has toolkit markup
  // (the legacy VolareCanvas/DemoUIAdapter flow pre-builds it before
  // VolareViewerInit is ever constructed) or if ui:false was requested.
  ensureToolkitMarkup() {
    if (!this.uiEnabled) return;
    if (this.container.querySelector('.vlr-visual-toolkit')) return;

    this.container.classList.add('vlr-embed-container');
    const wrapper = document.createElement('div');
    wrapper.className = 'vlr-toolkit-generated';
    wrapper.innerHTML = getToolkitPanelsHTML();
    this.container.appendChild(wrapper);
    this._generatedToolkitWrapper = wrapper;

    // VolareDOMManager's lookups are global (getElementById/querySelector),
    // not container-scoped -- refreshing them here lets them find the
    // elements we just generated. bindEvents() wires the toolkit's open/close
    // toggle, tab switching, and HDRI swiper drag; autoInit:false skips the
    // rest of VolareCanvas's own init (which would try to (re)generate HTML
    // into the demo's #VolareCanvas, not our container).
    VolareDOMManager.refresh();
    this._toolkitBinder = new VolareCanvas({ autoInit: false });
    this._toolkitBinder.bindEvents();
  }

  initializeThreeJS() {
    // Scene setup
    this.scene = new THREE.Scene();

    // Camera setup
    this.camera = new THREE.PerspectiveCamera(
      this.options.fov,
      this.container.clientWidth / this.container.clientHeight,
      0.1,
      1000
    );
    this.camera.position.set(
      this.options.initialCameraPosition.x,
      this.options.initialCameraPosition.y,
      this.options.initialCameraPosition.z
    );

    this.renderer = this.createRenderer();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(this.options.pixelRatio);
    // WebGPURenderer sizes its backing canvas asynchronously: the synchronous
    // setSize above runs before the GPU backend is initialized and is lost,
    // leaving the canvas at 0x0 (nothing renders). Re-apply once the backend
    // is ready. No-op on the classic WebGLRenderer (no .init()).
    if (this.renderer.isWebGPURenderer && typeof this.renderer.init === 'function') {
      this.renderer.init().then(() => {
        if (this.disposed || !this.renderer) return;
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(this.options.pixelRatio);
      }).catch(() => {});
    }
    // Keep the renderer locked to the container's real size. `window.resize`
    // alone is not enough: the container can change size without the window
    // doing so -- shown after being display:none, a parent flex/grid reflow,
    // a CSS transition, or a host layout panel resizing. Most importantly it
    // fixes the init race where the viewer is created in the same tick the
    // container becomes visible, so clientHeight is still 0 and the canvas
    // would stay 0-height (nothing renders) until the next window resize.
    if (typeof ResizeObserver === 'function') {
      this._containerResizeObserver = new ResizeObserver(() => {
        if (this.disposed || !this.renderer || !this.container) return;
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        if (!w || !h) return;
        const canvas = this.renderer.domElement;
        // Compare against CSS pixels; the drawing buffer is DPR-scaled.
        if (canvas.clientWidth === w && canvas.clientHeight === h) return;
        this.handleWindowResize();
      });
      this._containerResizeObserver.observe(this.container);
    }

    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.options.toneMappingExposure;
    this.renderer.shadowMap.enabled = this.options.enableShadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;

    this._hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x8d8d8d, 2);
    this.scene.add(this._hemisphereLight);

    this._directionalLight = new THREE.DirectionalLight(0xffffff, 2);
    this._directionalLight.position.set(1, 1.5, 1).normalize();
    this.scene.add(this._directionalLight);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    this._interactionDPR = null;
    this._dprRestoreTimer = null;
    const onControlStart = () => {
      if (this._dprRestoreTimer) { clearTimeout(this._dprRestoreTimer); this._dprRestoreTimer = null; }
      if (!this._interactionDPR) {
        this._interactionDPR = this.renderer.getPixelRatio();
        this.renderer.setPixelRatio(Math.min(this._interactionDPR, 1.0));
      }
    };
    const onControlEnd = () => {
      this._dprRestoreTimer = setTimeout(() => {
        if (this._interactionDPR) {
          this.renderer.setPixelRatio(this._interactionDPR);
          this._interactionDPR = null;
        }
      }, 150);
    };
    this.controls.addEventListener('start', onControlStart);
    this.controls.addEventListener('end', onControlEnd);
    this.listenerCleanups.push(
      () => this.controls.removeEventListener('start', onControlStart),
      () => this.controls.removeEventListener('end', onControlEnd)
    );

    this.animationManager = new AnimationManager();
    this.analysisManager = new AnalysisManager(this.scene, this.camera, this.renderer, this.controls, this.container, this.currentModel, this.materialManager, { performance: this.options.performance });
    this.analysisManager.initialize();
    // Force Original mode when Material Inspector activates so textures are always visible
    this.analysisManager.materialInspector.onBeforeActivate = () => {
      if (this.currentModel) this.materialManager.applyOriginalMaterials(this.currentModel);
      this.resetDisplayModeButtons();
    };

    // Pause render loop while UV viewer is open — no 3D rendering needed under the overlay
    const origUvOpen = this.analysisManager.uvViewer.open.bind(this.analysisManager.uvViewer);
    this.analysisManager.uvViewer.open = async (scene) => {
      this.pauseRenderLoop();
      return origUvOpen(scene);
    };
    const prevUvOnClose = this.analysisManager.uvViewer.onClose;
    this.analysisManager.uvViewer.onClose = () => {
      prevUvOnClose?.();
      this.resumeRenderLoop();
    };

    // Append to DOM
    this.container.appendChild(this.renderer.domElement);
  }

  createRenderer() {
    const requested = this.rendererBackend.requested;

    if (!this.rendererBackend.available.webgl.supported) {
      this.rendererBackend.selected = null;
      this.rendererBackend.error = this.rendererBackend.available.webgl.error || 'WebGL is not supported in this browser.';
      throw new Error(`Volare requires WebGL rendering. ${this.rendererBackend.error}`);
    }

    const rendererOptions = {
      antialias: this.options.antialias,
      powerPreference: this.options.powerPreference,
      alpha: this.options.alpha || this.options.renderer?.alpha || false
    };

    if (requested !== 'webgl') {
      // WebGPURenderer auto-selects the WebGPU backend when navigator.gpu / an
      // adapter is actually available, and transparently runs on a WebGL2
      // backend otherwise -- no separate detect-then-branch logic needed.
      try {
        const renderer = new WebGPURenderer(rendererOptions);
        this.rendererBackend.selected = renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl';
        if (requested === 'webgpu' && this.rendererBackend.selected !== 'webgpu') {
          this.rendererBackend.fallback = {
            from: 'webgpu',
            to: 'webgl',
            reason: 'WebGPU adapter unavailable; running on the WebGL2 backend instead.'
          };
        }
        return renderer;
      } catch (error) {
        this.rendererBackend.fallback = {
          from: requested,
          to: 'webgl',
          reason: error?.message || String(error)
        };
      }
    }

    try {
      const renderer = new THREE.WebGLRenderer(rendererOptions);
      this.rendererBackend.selected = 'webgl';
      return renderer;
    } catch (error) {
      this.rendererBackend.selected = null;
      this.rendererBackend.error = error?.message || String(error);
      throw new Error(`Volare failed to create the WebGL renderer. ${this.rendererBackend.error}`);
    }
  }

  async _compileScene() {
    if (!this.renderer || !this.scene || !this.camera) return;
    if (typeof this.renderer.compileAsync === 'function') {
      await this.renderer.compileAsync(this.scene, this.camera);
    } else {
      this.renderer.compile(this.scene, this.camera);
    }
  }

  initializeManagers() {
    this.lightingManager = new LightingManager(this.scene, this.renderer);
    this.volareManager = new VolareManager(this.scene, {
      loaders: this.options.loaders,
      renderer: this.renderer,
      performance: this.options.performance
    });
    this.materialManager = new MaterialManager();
    // Link so material modes can deactivate the active material inspector without a hardcoded id.
    this.materialManager._analysisManager = this.analysisManager;
    this.uiManager = this.uiEnabled ? new UIManager(this.container) : null;
    this.buttonManager = this.uiEnabled ? new ButtonManager(this.container) : null;

    this.syncAnalysisToolReferences();
    this.boundHandleWindowResize = this.handleWindowResize.bind(this);
    this.boundHandleKeyPress = this.handleKeyPress.bind(this);

    // Setup manager cross-references
    this.volareManager.setMaterialManager(this.materialManager);
    this.buttonManager?.applyCooldownToGroup(['vlr-original-wire', 'vlr-ao-wire', 'Wireframe', 'vlr-reset-toggle', 'vlr-center-camera'], 1000);
    this.setupMeshRotation();
    this.volareManager.setAnimationManager(this.animationManager);
    this.analysisManager?.setAnimationManager?.(this.animationManager);
  }

  syncAnalysisToolReferences() {
    const tools = this.analysisManager;
    this.directorMode = tools?.directorMode || null;
    this.turntable = tools?.turntablePlus || null;
    this.meshAnalysis = tools?.meshAnalysis || tools?.meshInspector || tools?.vertexSelector || null;
    this.meshInspector = this.meshAnalysis;
    this.vertexSelector = this.meshAnalysis;
    this.textureAnalyzer = tools?.textureAnalyzer || null;
    this.normalVisualizer = tools?.normalVectorVisualizer || null;
    this.uvViewer = tools?.uvViewer || null;
    this.crossSection = tools?.crossSection || null;
    this.boundingVisualizer = tools?.boundingVolumeVisualizer || null;
    this.performanceMonitor = tools?.performanceMonitor || null;
    this.lightingPreset = tools?.LightingPreset || null;
  }

  computeModelStats(model) {
    if (!model) return null;
    let vertexCount = 0, triangleCount = 0, meshCount = 0;
    const materials = new Set();
    const textures = new Set();
    const box = new THREE.Box3();

    model.traverse(child => {
      if (!child.isMesh) return;
      // Skip wireframe/helper meshes added by Volare tools
      if (child.userData?.volareHelper || child.userData?.isWireframeHelper) return;
      meshCount++;
      const geo = child.geometry;
      const pos = geo?.attributes?.position;
      if (pos) vertexCount += pos.count;
      if (geo?.index) {
        triangleCount += geo.index.count / 3;
      } else if (pos) {
        triangleCount += pos.count / 3;
      }
      if (child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => {
          materials.add(m);
          Object.keys(m).forEach(k => {
            if (m[k]?.isTexture) textures.add(m[k]);
          });
        });
      }
    });

    // Compute bounding box from model meshes only, excluding Volare helpers
    box.makeEmpty();
    model.traverse(child => {
      if (!child.isMesh) return;
      if (child.userData?.volareHelper || child.userData?.isWireframeHelper) return;
      if (!child.geometry) return;
      child.updateMatrixWorld(true);
      const childBox = new THREE.Box3().setFromObject(child);
      box.union(childBox);
    });
    if (box.isEmpty()) box.setFromObject(model);
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);

    return {
      vertexCount: Math.round(vertexCount),
      triangleCount: Math.round(triangleCount),
      meshCount,
      materialCount: materials.size,
      textureCount: textures.size,
      boundingBox: { min: box.min.toArray(), max: box.max.toArray() },
      boundingSphere: { center: sphere.center.toArray(), radius: sphere.radius }
    };
  }

  classifyModelSize(stats) {
    if (!stats) return 'unknown';
    const count = Math.max(stats.vertexCount, stats.triangleCount);
    if (count >= 1_000_000) return 'huge';
    if (count >= 500_000) return 'large';
    if (count >= 100_000) return 'medium';
    return 'small';
  }

  applyAdaptiveDPR() {
    if (!this.renderer) return;
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    const isNarrow = window.innerWidth <= 1400;
    const baseDPR = window.devicePixelRatio || 1;
    let cap;

    if (this.hugeModelMode || isMobile) {
      cap = 1.0;
    } else if (isNarrow) {
      cap = 1.25;
    } else {
      cap = 1.5;
    }

    this.renderer.setPixelRatio(Math.min(baseDPR, cap));
  }

  onModelStatsReady(model) {
    this.modelStats = this.computeModelStats(model);
    this.modelSizeClass = this.classifyModelSize(this.modelStats);
    this.hugeModelMode = this.modelSizeClass === 'huge';

    if (this.hugeModelMode) {
      console.warn(`[Volare] Huge model detected (${this.modelStats.vertexCount.toLocaleString()} vertices, ${this.modelStats.triangleCount.toLocaleString()} triangles). Adaptive DPR applied.`);
    }

    this.applyAdaptiveDPR();
  }

  addTrackedEventListener(target, event, handler, options) {
    if (!target || typeof target.addEventListener !== 'function' || typeof handler !== 'function') return;
    target.addEventListener(event, handler, options);
    this.listenerCleanups.push(() => target.removeEventListener(event, handler, options));
  }

  cleanupTrackedEventListeners() {
    this.listenerCleanups.splice(0).forEach(cleanup => {
      try { cleanup(); } catch (error) { console.warn('Error removing Volare listener:', error); }
    });
  }

  disposeMaterial(material, disposedResources = new Set()) {
    if (!material || disposedResources.has(material)) return;
    disposedResources.add(material);

    Object.keys(material).forEach(key => {
      const value = material[key];
      if (value?.isTexture && !disposedResources.has(value)) {
        disposedResources.add(value);
        value.dispose?.();
      }
    });
    material.dispose?.();
  }

  disposeObject3D(root, disposedResources = new Set()) {
    if (!root) return;
    root.traverse?.(child => {
      if (!child.isMesh) return;
      if (child.geometry && !disposedResources.has(child.geometry)) {
        disposedResources.add(child.geometry);
        child.geometry.dispose?.();
      }
      if (Array.isArray(child.material)) {
        child.material.forEach(material => this.disposeMaterial(material, disposedResources));
      } else {
        this.disposeMaterial(child.material, disposedResources);
      }
    });
  }

  mergeDefaultOptions(userOptions = {}) {
    const defaults = {
      antialias: true,
      powerPreference: "high-performance",
      pixelRatio: Math.min(window.devicePixelRatio, 1.5),
      fov: 30,
      near: 0.1,
      far: 1000,
      initialCameraPosition: { x: 0, y: 0, z: 5 },
      enableShadows: true,
      shadowMapType: THREE.PCFSoftShadowMap,
      toneMapping: THREE.ACESFilmicToneMapping,
      toneMappingExposure: 1.0,
      outputColorSpace: THREE.SRGBColorSpace,
      enableDamping: true,
      dampingFactor: 0.05,
      enableZoom: true,
      enableRotate: true,
      enablePan: true,
      localClippingEnabled: true,
      logarithmicDepthBuffer: false,
      performance: {
        meshopt: true,
        dracoDecoderPath: null,
        ktx2TranscoderPath: null,
        uvWorker: true,
      },
      renderer: {
        preferredBackend: 'webgl'
      },
      // External selectors
      selectors: {
        closePreview: '.closepreview',
        hdriSelector: '.hdri-selector',
        tabButton: '.tab-button',
        thumbnail: '.thumbnail',
        materialButtons: ['vlr-original-wire', 'vlr-ao-wire', 'Wireframe'],
        hdriOff: 'vlr-hdri-off',
        resetToggle: 'vlr-reset-toggle',
        centerCamera: 'vlr-center-camera',
        meshRotationSlider: 'meshRotationSlider',
        animationPanel: 'animation-panel',
        animationBtn: 'animation-btn',
        visualToolkit: 'vlr-visual-toolkit',
        modelContainer: 'model'
      }
    };
    return { ...defaults, ...userOptions };
  }

  setupEventListeners() {
    document.querySelectorAll(this.options.selectors.closePreview).forEach(element => {
      this.addTrackedEventListener(element, 'click', () => {
        window.viewerPlugin?.disposeCompletely?.();
      });
    });
    this.addTrackedEventListener(document.querySelector(this.options.selectors.hdriSelector), 'click', async (e) => {
      const hdriOption = e.target.closest('.hdri-option');
      if (hdriOption) {
        const hdriPath = hdriOption.dataset.hdri;
        if (hdriPath) {
          this.uiManager?.showLoading("Loading HDRI...");

          this.volareManager.setupLoadingManager?.();

          try {
            await this.setEnvironment(hdriPath);
          } catch (err) {
            console.error("HDRI loading failed:", err);
          }

          this.uiManager?.hideLoading();

          this.setActiveHdriOption(hdriPath);
        }
      }
    });
    document.querySelectorAll(this.options.selectors.tabButton).forEach(button => {
      this.addTrackedEventListener(button, 'click', (e) => {
        document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
        const targetId = button.dataset.tab;
        const target = document.getElementById(targetId);
        if (target) target.style.display = 'block';
      });
    });

    document.querySelectorAll(this.options.selectors.thumbnail).forEach((thumbnail, index) => {
      this.addTrackedEventListener(thumbnail, 'click', () => {
        this.selectedModelPath = thumbnail.getAttribute('data-model');
        this.currentIndex = index;
        if (this.selectedModelPath) {
          this.loadModel(this.selectedModelPath);
        }
      });
    });

    // Material switches
    const materialButtons = this.options.selectors.materialButtons;
    materialButtons.forEach(id => {
      const button = document.getElementById(id);
      this.addTrackedEventListener(button, 'click', () => {
        // Remove 'active' from all buttons
        materialButtons.forEach(btnId => {
          document.getElementById(btnId)?.classList.remove('active');
        });

        // Add 'active' to the clicked button
        button.classList.add('active');
        if (this.analysisManager.materialInspector && this.analysisManager.materialInspector.isActive) {
            console.warn('Analyzer: MaterialInspector is active, deactivating it first');
            this.analysisManager.materialInspector.deactivate();
        }
        // Apply corresponding material
        switch (id) {
          case 'vlr-original-wire':
            this.materialManager.applyOriginalMaterials(this.currentModel);
            break;
          case 'vlr-ao-wire':
            this.materialManager.applyAOMaterials(this.currentModel);
            break;
          case 'Wireframe':
            this.materialManager.applyWireframeMaterials(this.currentModel);
            break;
        }

        // Apply cooldowns
        this.buttonManager?.applyCooldownToGroup(['vlr-original-wire', 'vlr-ao-wire', 'Wireframe', 'vlr-reset-toggle', 'vlr-center-camera'], 1000);
      });
    });

    // Other controls
    this.addTrackedEventListener(document.getElementById(this.options.selectors.hdriOff), 'change', () => {
      this.lightingManager.toggleEnvironment();
      this.syncHdriToggleState();
      this.buttonManager?.applyCooldownToGroup(['vlr-original-wire', 'vlr-ao-wire', 'Wireframe', 'vlr-reset-toggle', 'vlr-center-camera'], 1000);
    });

    this.addTrackedEventListener(document.getElementById(this.options.selectors.resetToggle), 'click', async () => {
      try {
        await this.resetView();
      } catch (error) {
        console.warn('[Volare] Reset all settings failed:', error);
      }
      this.buttonManager?.applyCooldownToGroup(['vlr-original-wire', 'vlr-ao-wire', 'Wireframe', 'vlr-reset-toggle', 'vlr-center-camera'], 1000);
    });

    this.addTrackedEventListener(document.getElementById(this.options.selectors.centerCamera), 'click', () => {
      this.toggleFollowModel();
      this.buttonManager?.applyCooldownToGroup(['vlr-original-wire', 'vlr-ao-wire', 'Wireframe', 'vlr-reset-toggle', 'vlr-center-camera'], 1000);
    });
    // Resize + Keyboard
    this.addTrackedEventListener(window, 'resize', this.boundHandleWindowResize);
    this.addTrackedEventListener(document, 'keydown', this.boundHandleKeyPress);
  }
  resetDisplayModeButtons() {
    const ids = this.options?.selectors?.materialButtons || ['vlr-original-wire', 'vlr-ao-wire', 'Wireframe'];
    ids.forEach(id => document.getElementById(id)?.classList.remove('active'));
    document.getElementById('vlr-original-wire')?.classList.add('active');
  }

  updateCurrentModel(model) {
    this.currentModel = model;
    this.resetDisplayModeButtons();
    this.onModelStatsReady(model);
    if (this.analysisManager) {
      // Check if setModel method exists
      if (typeof this.analysisManager.setModel === 'function') {
        this.analysisManager.setModel(model);
      } else {
        console.warn('AnalysisManager.setModel is not a function');
      }

      // Check if analyzeModel method exists
      if (typeof this.analysisManager.analyzeModel === 'function') {
        const analysis = this.analysisManager.analyzeModel(model);

        // Check if updateAnalysisResults method exists
        if (typeof this.analysisManager.updateAnalysisResults === 'function') {
          this.analysisManager.updateAnalysisResults(analysis);
        }

      } else {
        console.warn('AnalysisManager.analyzeModel is not a function');
      }
    } else {
      console.warn('AnalysisManager not initialized');
    }
  }
  startRenderLoop() {
    if (!this.renderer || this.renderLoopActive) return;
    this.renderLoopActive = true;
    this.renderer.setAnimationLoop(() => {
      if (this.disposed || !this.scene || !this.camera) return;

      const deltaTime = this.clock.getDelta();
      this.pluginManager?.runSync?.('beforeRender', this, { deltaTime });

      // Update animation manager
      if (this.animationManager && typeof this.animationManager.update === 'function') {
        this.animationManager.update(deltaTime);
      }

      this.updateFollowModelTarget();

      // Update controls
      this.controls?.update?.();
      this.renderer.render(this.scene, this.camera);
      // Update analysis tools
      if (this.analysisManager && typeof this.analysisManager.update === 'function') {
        this.analysisManager.update();
      }
      this.pluginManager?.runSync?.('afterRender', this, { deltaTime });
    });
  }

  pauseRenderLoop() {
    if (!this.renderer || !this.renderLoopActive) return;
    this.renderer.setAnimationLoop(null);
    this.renderLoopActive = false;
    this._renderLoopPaused = true;
  }

  resumeRenderLoop() {
    if (!this._renderLoopPaused || this.disposed) return;
    this._renderLoopPaused = false;
    this.startRenderLoop();
  }

  // Public API methods
  async loadModel(modelPath, options) {
    try {
      if (this.disposed) throw new Error('Cannot load a model after the viewer has been disposed.');
      this.emit('modelLoading', { path: modelPath });
      this._showLoadingOverlay('Loading model...');
      this._cachedRootBone = null;
      this._cachedRootBoneModelId = null;
      this.modelLoaded = false;
      this._firstRenderDone = false;
      const model = await this.volareManager.loadModel(modelPath, options);
      if (this.disposed) throw new Error('Viewer was disposed during model load.');
      this._setLoadingText('Building scene...');
      this.currentModel = model;
      this.modelLoaded = true;
      this.updateCurrentModel(model);
      this._setLoadingText('Compiling shaders...');
      if (this.renderer && this.scene && this.camera) {
        await this._compileScene();
        this._setLoadingText('Finalizing...');
        this.renderer.render(this.scene, this.camera);
      }
      this._firstRenderDone = true;
      this._hideLoadingOverlay();
      this.emit('modelLoaded', { path: modelPath, model });
      return model;
    } catch (error) {
      this._setLoadingText(error?.message || 'Failed to load model.');
      this.emit('modelError', { path: modelPath, error });
      throw error;
    }
  }

  _showLoadingOverlay(text) {
    const overlay = document.getElementById('loadingScreen');
    if (!overlay) return;
    const textEl = overlay.querySelector('.loading-text');
    const barEl = overlay.querySelector('.loading-bar');
    const details = overlay.querySelector('.vlr-loading-details');
    overlay.style.display = 'flex';
    overlay.classList.remove('loading-fade-out');
    if (details) details.style.display = 'flex';
    if (textEl) textEl.textContent = text || 'Loading...';
    if (barEl) barEl.style.transform = 'scaleX(0)';
  }

  _setLoadingText(text) {
    const overlay = document.getElementById('loadingScreen');
    const textEl = overlay?.querySelector('.loading-text');
    if (textEl) textEl.textContent = text;
    this.emit('loadingPhase', { message: text });
  }

  _hideLoadingOverlay() {
    const overlay = document.getElementById('loadingScreen');
    if (!overlay) return;
    overlay.classList.add('loading-fade-out');
    setTimeout(() => {
      overlay.style.display = 'none';
      overlay.classList.remove('loading-fade-out');
    }, 300);
  }

  setWireframeMode(mode) {
    this.materialManager.setWireframeMode(mode);
    if (this.materialManager.activeMaterialMode === 'wireframe' && this.currentModel) {
      this.materialManager.applyWireframeMaterials(this.currentModel);
    } else if (this.materialManager.activeMaterialMode === 'ao' && this.currentModel) {
      this.materialManager.applyAOMaterials(this.currentModel);
    }
  }

  syncHdriToggleState() {
    const checkbox = document.getElementById(this.options.selectors.hdriOff);
    if (checkbox) {
      checkbox.checked = !!this.lightingManager?.isEnvironmentEnabled;
    }
  }

  setActiveHdriOption(hdriPath) {
    document.querySelectorAll('.hdri-option').forEach(option => {
      option.classList.toggle('active', option.dataset.hdri === hdriPath);
    });
    this.syncHdriToggleState();
  }

  setEnvironment(environmentConfig) {
    const result = this.lightingManager.setEnvironment(environmentConfig);
    this.syncHdriToggleState();
    return result;
  }

  getDiagnostics() {
    const info = this.renderer?.info;
    const mem = info?.memory;
    const render = info?.render;

    let helperCount = 0;
    if (this.scene) {
      this.scene.traverse(child => {
        if (child.isHelper || child.type?.includes('Helper')) helperCount++;
      });
    }

    const recommendations = [];
    if (this.hugeModelMode) {
      recommendations.push('Huge model detected — DPR capped for performance.');
      recommendations.push('Consider using gltfpack/Meshopt/Draco to reduce geometry.');
      recommendations.push('Use KTX2/Basis compressed textures for large texture sets.');
    }

    const diagnostics = {
      ready: this.isInitialized,
      disposed: this.disposed,
      hasModel: !!this.currentModel,
      renderer: this.getRendererDiagnostics(),
      environment: this.lightingManager?.getDiagnostics?.() || null,
      runtime: {
        renderLoopActive: this.renderLoopActive,
        renderLoopMode: 'direct',
        trackedListeners: this.listenerCleanups.length,
        sceneChildren: this.scene?.children?.length ?? 0,
        rendererInfo: info ? {
          geometries: mem?.geometries ?? null,
          textures: mem?.textures ?? null,
          programs: info.programs?.length ?? null
        } : null
      },
      modelStats: this.modelStats,
      modelSizeClass: this.modelSizeClass,
      hugeModelMode: this.hugeModelMode,
      scene: {
        helperCount,
        drawCalls: render?.calls ?? null
      },
      tools: {
        active: this.analysisManager?.getActiveToolNames?.() ?? []
      },
      materials: {
        activeMode: this.materialManager?.activeMaterialMode ?? null,
        wireframeMode: this.materialManager?.wireframeMode ?? null,
        wireframeHelperCount: this.materialManager?.getWireframeHelperCount?.(this.currentModel) ?? 0
      },
      performance: {
        meshopt: !!this.volareManager?._meshoptDecoder,
        draco: !!this.volareManager?._dracoLoader,
        ktx2: !!this.volareManager?._ktx2Loader,
        renderLoopPaused: !!this._renderLoopPaused
      },
      recommendations: recommendations.length > 0 ? recommendations : null
    };
    return this.pluginManager?.getDiagnostics?.(diagnostics) || diagnostics;
  }

  getRendererDiagnostics() {
    return {
      requestedBackend: this.rendererBackend.requested,
      selectedBackend: this.rendererBackend.selected,
      activeBackend: this.rendererBackend.selected,
      backend: this.rendererBackend.selected,
      webgl: !!this.renderer && this.rendererBackend.selected === 'webgl',
      webgpu: !!this.renderer && this.rendererBackend.selected === 'webgpu',
      pixelRatio: this.renderer?.getPixelRatio?.() ?? null,
      available: {
        webgl: this.rendererBackend.available.webgl,
        webgpu: this.rendererBackend.available.webgpu
      },
      fallback: this.rendererBackend.fallback,
      error: this.rendererBackend.error
    };
  }
  handleThumbnailClick(thumbnail, index) {
    const modelPath = thumbnail.getAttribute('data-model');
    if (modelPath) {
      this.loadModel(modelPath);
    }
  }

  async resetView() {
    this.setFollowModel(false);
    this.resetCamera();
    if (this.currentModel) {
      this.currentModel.rotation.set(0, 0, 0);
    }
    const rotationSlider = document.getElementById(this.options.selectors.meshRotationSlider);
    if (rotationSlider) {
      rotationSlider.value = '0';
      rotationSlider.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (this.currentModel) {
      this.materialManager.applyOriginalMaterials(this.currentModel);
    }
    this.analysisManager.deactivateAllTools();
    this.resetDisplayModeButtons();
    await this.setEnvironment({ preset: this.defaultEnvironmentPath });
    this.setActiveHdriOption(null);
  }

  // Add mesh rotation slider support
  setupMeshRotation() {
    const meshRotationSlider = document.getElementById(this.options.selectors.meshRotationSlider);
    if (meshRotationSlider) {
      this.addTrackedEventListener(meshRotationSlider, 'input', (event) => {
        const rotationAngle = THREE.MathUtils.degToRad(event.target.value);
        if (this.currentModel) {
          this.currentModel.rotation.y = rotationAngle;
        }
      });
    }
  }
  normalizeModelScale(model) {
    if (!model || this.options.autoNormalize === false) return;

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z);

    if (maxDimension <= 0) return;

    const targetSize = this.options.normalizeTargetSize || 2;
    if (maxDimension > targetSize * 50 || maxDimension < targetSize * 0.02) {
      const scale = targetSize / maxDimension;
      model.scale.multiplyScalar(scale);
      model.updateMatrixWorld(true);
    }
  }

  centerCameraOnModel() {
    if (!this.camera || !this.camera.fov || !this.currentModel) return;

    this.normalizeModelScale(this.currentModel);

    const box = new THREE.Box3().setFromObject(this.currentModel);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    const maxDimension = Math.max(size.x, size.y, size.z);
    const fov = this.camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDimension / 2 / Math.tan(fov / 2));
    cameraZ *= 1.5;

    this.camera.position.set(center.x, center.y, cameraZ);

    const modelRadius = maxDimension / 2;
    this.camera.near = Math.max(0.001, modelRadius * 0.01);
    this.camera.far = Math.max(1000, cameraZ * 10);
    this.camera.updateProjectionMatrix();

    this.controls.minDistance = modelRadius * 0.3;
    this.controls.maxDistance = cameraZ * 5;
    this.controls.target.copy(center);
    this.controls.update();
    this._followTarget.copy(center);
  }

  getCurrentModelCenter() {
    if (!this.currentModel) return null;
    const box = new THREE.Box3().setFromObject(this.currentModel);
    if (box.isEmpty()) return null;
    return box.getCenter(new THREE.Vector3());
  }

  _getFollowPoint(out) {
    if (!this.currentModel) return null;
    if (!out) out = new THREE.Vector3();
    this.currentModel.updateWorldMatrix(true, false);
    this.currentModel.getWorldPosition(out);
    const modelId = this.currentModel.uuid;
    if (this._cachedRootBoneModelId !== modelId) {
      this._cachedRootBone = null;
      this.currentModel.traverse(child => {
        if (!this._cachedRootBone && child.isBone && child.parent && !child.parent.isBone) {
          this._cachedRootBone = child;
        }
      });
      this._cachedRootBoneModelId = modelId;
    }
    if (this._cachedRootBone) {
      this._cachedRootBone.updateWorldMatrix(true, false);
      this._cachedRootBone.getWorldPosition(out);
    }
    return out;
  }

  updateFollowModelTarget() {
    if (!this.followingModel || !this.currentModel || !this.controls || !this.camera) return;
    const point = this._getFollowPoint(VolareViewerInit._v3A);
    if (!point) return;
    const delta = VolareViewerInit._v3B.copy(point).sub(this._followTarget);
    if (delta.lengthSq() < 1e-10) return;
    this.camera.position.add(delta);
    this.controls.target.add(delta);
    this._followTarget.copy(point);
  }

  setFollowModel(enabled = true) {
    this.followingModel = Boolean(enabled && this.currentModel);
    const button = document.getElementById(this.options.selectors.centerCamera);
    button?.classList.toggle('active', this.followingModel);
    button?.setAttribute('aria-pressed', this.followingModel ? 'true' : 'false');

    if (this.followingModel) {
      const point = this._getFollowPoint() || this.getCurrentModelCenter();
      if (point) {
        this._followTarget.copy(point);
        this.controls.target.copy(point);
        this.controls.update();
      }
    }
  }

  toggleFollowModel() {
    this.setFollowModel(!this.followingModel);
  }

  resetCamera() {
    this.camera.position.set(
      this.options.initialCameraPosition.x,
      this.options.initialCameraPosition.y,
      this.options.initialCameraPosition.z
    );
    this.controls.reset();
    this.centerCameraOnModel();
  }

  // Event system
  on(event, callback) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(callback);
  }

  emit(event, data) {
    if (this.eventHandlers.has(event)) {
      this.eventHandlers.get(event).forEach(callback => callback(data));
    }
  }

  // Event handlers
  handleWindowResize() {
    if (!this.camera || !this.container) return;

    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer?.setSize(width, height);
    this.applyAdaptiveDPR();
  }

  isFeatureDisabled(featureId) {
    if (!featureId) return false;
    const el = this.container?.querySelector?.(`#${featureId}`) || document.getElementById(featureId);
    return el?.dataset?.volareFeatureDisabled === 'true' || el?.hidden === true;
  }

  handleKeyPress(event) {
    // Don't hijack keys while the user is typing in a field or editing content.
    const target = event.target;
    if (target && (target.isContentEditable ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || ''))) {
      return;
    }
    const key = event.key.toLowerCase();
    const shift = event.shiftKey;
    const ctrl = event.ctrlKey;

    const toggleTool = (tool, featureId) => {
      if (!tool) return;
      if (featureId && this.isFeatureDisabled(featureId)) return;

      if (typeof tool.isActive !== 'undefined') {
        if (tool.isActive) {
          if (typeof tool.deactivate === 'function') tool.deactivate();
        } else {
          if (typeof tool.activate === 'function') tool.activate();
        }
      } else if (typeof tool.toggle === 'function') {
        tool.toggle();
      } else {
        console.warn('Tool does not support toggle:', tool);
      }
    };

    switch (key) {
        case 'f':
          this.centerCameraOnModel();
          break;

        case 'd':
          toggleTool(this.analysisManager.directorMode, 'toggle-director-mode');
          break;

        case 't':
          toggleTool(this.analysisManager.turntablePlus, 'toggle-turntable-plus');
          break;

        case '1':
          document.getElementById('vlr-original-wire')?.click();
          break;

        case '2':
          document.getElementById('Wireframe')?.click();
          break;

        case '3':
          document.getElementById('vlr-ao-wire')?.click();
          break;

        case 'm':
          toggleTool(this.analysisManager.materialInspector, 'toggle-material-inspector');
          break;

        case 'n':
          toggleTool(this.analysisManager.normalVectorVisualizer, 'toggle-normals');
          break;

        case 's':
          if (shift) toggleTool(this.analysisManager.performanceMonitor, 'toggle-performance');
          break;

        case 'b':
          toggleTool(this.analysisManager.boundingVolumeVisualizer, 'toggle-bounding-volumes');
          break;

        case 'x':
          toggleTool(this.analysisManager.crossSection, 'toggle-cross-section');
          break;

        case 'u':
        if (this.isFeatureDisabled('toggle-uv-preview')) break;
        if (this.analysisManager.uvViewer.isActive) {
          this.analysisManager.uvViewer.close();
        } else {
          this.analysisManager.uvViewer.open(this.analysisManager.scene);
        }
        break;

        case 'v':
          toggleTool(this.analysisManager.meshAnalysis, 'toggle-mesh-analysis');
          break;

        case ' ':
          if (this.animationManager?.togglePlayPause) {
            this.animationManager.togglePlayPause();
          }
          break;

        case 'k':
          if (this.animationManager) {
            if (shift && this.animationManager.previousClip) {
              this.animationManager.previousClip();
            } else if (this.animationManager.nextClip) {
              this.animationManager.nextClip();
            }
          }
          break;

        case 'l':
          if (shift && this.lightingManager?.toggleEnvironment) {
            this.lightingManager.toggleEnvironment();
            this.syncHdriToggleState();
          }
          break;

        case 'p':
          if (this.performanceMonitor?.togglePerformanceMode) {
            this.performanceMonitor.togglePerformanceMode();
          }
          break;

        case 'c':
          if (shift) this.resetView();
          break;

        case 'escape':
          this.closeTopmostOverlay();
          break;

        default:
          break;
    }
  }

  closeTopmostOverlay() {
    if (this.analysisManager?.uvViewer?.isActive) {
      this.analysisManager.uvViewer.close();
      this.analysisManager.refreshToolButtonStates?.();
      return true;
    }
    if (this.analysisManager?.meshAnalysis?.isActive) {
      this.analysisManager.meshAnalysis.deactivate();
      this.analysisManager.refreshToolButtonStates?.();
      return true;
    }
    if (this.analysisManager?.materialInspector?.isActive) {
      this.analysisManager.materialInspector.deactivate();
      this.analysisManager.refreshToolButtonStates?.();
      return true;
    }
    const toolkit = document.getElementById('vlr-visual-toolkit');
    if (toolkit?.classList.contains('active')) {
      toolkit.classList.remove('active');
      document.body.classList.remove('volare-advanced-open');
      return true;
    }
    const advanced = document.getElementById('vlr-advanced-three');
    if (advanced?.classList.contains('active')) {
      advanced.classList.remove('active');
      document.body.classList.remove('volare-advanced-open');
      return true;
    }
    const animPanel = document.getElementById('animation-panel');
    if (animPanel?.classList.contains('vlr-anim-active')) {
      animPanel.classList.remove('vlr-anim-active');
      return true;
    }
    return false;
  }

  // Cleanup
  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    // 1. Stop all animation frames
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.rotateRequestId) {
      cancelAnimationFrame(this.rotateRequestId);
      this.rotateRequestId = null;
    }
    if (this.renderer) {
      this.renderer.setAnimationLoop(null);
    }
    this.renderLoopActive = false;
    this.cleanupTrackedEventListeners();
    try { this._containerResizeObserver?.disconnect(); } catch (e) {}
    this._containerResizeObserver = null;

    // 2. Dispose internal managers
    // lightingManager.dispose() handles HDRI env map and PMREMGenerator cleanup.
    try { this.controls?.dispose?.(); } catch (e) {}
    try { this.animationManager?.dispose(); } catch (e) {}
    try { this.lightingManager?.dispose(); } catch (e) {}
    try { this.volareManager?.dispose(); } catch (e) {}
    try { this.materialManager?.dispose(); } catch (e) {}
    try { this.uiManager?.dispose(); } catch (e) {}
    try { this.analysisManager?.dispose(); this.analysisManager = null; } catch (e) {}
    document.getElementById(this.options.selectors.animationPanel)?.classList.remove('vlr-anim-active');
    document.getElementById(this.options.selectors.animationBtn)?.classList.remove('vlr-anim-active');

    // 3. Dispose scene geometry / materials / textures
    if (this.scene) {
      try { this.disposeObject3D(this.scene); } catch (e) {}
    }

    // 4. Dispose renderer and remove canvas from DOM
    try {
      if (this.renderer) {
        if (this.renderer.domElement && this.container?.contains(this.renderer.domElement)) {
          this.container.removeChild(this.renderer.domElement);
        }
        this.renderer.dispose();
        this.renderer = null;
      }
    } catch (e) {
      this.renderer = null;
    }

    // 6. Hide model container DOM element
    try {
      const modelContainer = document.getElementById(this.options.selectors.modelContainer);
      if (modelContainer) modelContainer.style.display = 'none';
    } catch (e) {}

    // 6b. Remove toolkit markup ensureToolkitMarkup() generated (leaves any
    // pre-existing legacy VolareCanvas markup untouched -- we never built it).
    try { this._toolkitBinder?.destroy(); } catch (e) {}
    this._toolkitBinder = null;
    try {
      if (this._generatedToolkitWrapper) {
        this._generatedToolkitWrapper.remove();
        this._generatedToolkitWrapper = null;
        this.container?.classList.remove('vlr-embed-container');
      }
    } catch (e) {}

    // 7. Reset core references
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.isInitialized = false;
    this.currentModel = null;

    this.emit('disposed');
    this.eventHandlers.clear();
  }
}

// Pooled math objects to avoid per-frame allocations in hot paths
VolareViewerInit._v3A = new THREE.Vector3();
VolareViewerInit._v3B = new THREE.Vector3();

class VolareViewer {
  constructor() {
    this.instances = new Map();
    window.viewerPlugin = this;
  }

  init(config = {}) {
    const {
      containerId = 'viewer-container',
      canvasId,
      theme = 'light',
      ...options
    } = config;

    // Apply theme if provided
    if (theme && this.applyTheme) {
      this.applyTheme(theme);
    }

    // Create viewer with config
    const viewer = this.createViewer(containerId, {
      ...options,
      canvasId,
      selectors: {
        ...options.selectors,
        // Override any canvas-specific selectors
        ...(canvasId && { canvas: canvasId })
      }
    });

    return viewer;
  }

  applyTheme(theme) {
    // This would apply CSS classes or styles based on theme
    const container = document.body;
    container.classList.remove('theme-light', 'theme-dark');
    container.classList.add(`theme-${theme}`);
  }

  configure(containerId, newConfig) {
    const viewer = this.getViewer(containerId);
    if (viewer) {
      viewer.options = { ...viewer.options, ...newConfig };
      return viewer;
    }
    return null;
  }

  createViewer(containerId, options = {}) {
    const container = typeof containerId === 'string'
      ? document.getElementById(containerId) || document.querySelector(containerId)
      : containerId;
    if (!container) {
      throw new Error(`Container "${containerId}" not found`);
    }
    const viewer = new VolareViewerInit(container, options);
    viewer.isInitialized = true;
    this.instances.set(container.id || containerId, viewer);
    return viewer;
  }

  getViewer(containerId) {
    return this.instances.get(containerId);
  }
  getPublicAPI() {
    return {
      loadModel: (path) => this.loadModel(path),
      centerCamera: () => this.centerCameraOnModel(),
      setEnvironment: (hdriPath) => this.setEnvironment(hdriPath),
      resetView: () => this.resetView(),
      getCurrentModel: () => this.currentModel,
      dispose: () => this.dispose()
    };
  }

  disposeViewer(containerId) {
    const viewer = this.instances.get(containerId);
    if (viewer) {
      viewer.dispose();
      this.instances.delete(containerId);
    }
  }

  disposeAll() {
    this.instances.forEach((viewer, id) => {
      viewer.dispose();
    });
    this.instances.clear();
  }

  closeTopmostOverlay() {
    const viewer = this.instances.values().next().value;
    return viewer?.closeTopmostOverlay?.() ?? false;
  }

  closeOverlay() {
    document.body.style.overflow = 'auto';
    document.body.classList.remove('volare-viewer-open');

    const volareCanvas = document.getElementById('VolareCanvas');
    volareCanvas?.classList.remove('show');
    volareCanvas?.classList.remove('is-warning', 'is-viewer-ready');

    const shadow = document.querySelector('.shadow');
    if (shadow) {
      shadow.classList.remove('show');
      window.setTimeout(() => {
        if (!shadow.classList.contains('show')) shadow.style.display = 'none';
      }, 300);
    }

    const viewer = this.instances.values().next().value;
    const containerId = viewer?.options?.selectors?.modelContainer || 'model';
    const container = document.getElementById(containerId);
    if (container) container.style.display = 'none';
  }

  disposeCompletely() {
    this.closeOverlay();

    if (window.viewerPlugin) {
      window.viewerPlugin.disposeAll();
    }
    window.resetVolareDemoState?.();

    let viewer = null;
    let viewerPlugin = null;

    // Reset ALL UI states to prevent stale active classes on re-open
    document.querySelectorAll('.vlr-advanced-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tool-toggle').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.hdri-option').forEach(opt => opt.classList.remove('active'));
    document.querySelectorAll('.vlr-op-wireframe').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.vlr-mesh-analysis-main').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.vlr-mesh-analysis-back').forEach(el => el.classList.remove('active'));

    const hdriCheckbox = document.getElementById('vlr-hdri-off');
    if (hdriCheckbox) hdriCheckbox.checked = true;

    document.getElementById('vlr-visual-toolkit')?.classList.remove('active');
    document.getElementById('vlr-advanced-three')?.classList.remove('active');
    document.getElementById('animation-panel')?.classList.remove('vlr-anim-active');
    document.getElementById('animation-btn')?.classList.remove('vlr-anim-active');

    const containerId = this.instances.size > 0 ?
      Array.from(this.instances.values())[0].options.selectors.modelContainer || 'model' :
      'model';
    const container = document.getElementById(containerId);
    if (container) container.style.display = 'none';
  }
}

export { VolareViewerInit, VolareViewer };
