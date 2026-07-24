import { VolareViewer } from "../../SDK/Core/VolareViewer.js";
import { createVolareViewer, getVolareViewers } from "../../SDK/Core/createVolareViewer.js";
import { VOLARE_HDRI_PRESETS, setHdriBasePath } from "../../SDK/Managers/LightingController.js";
import showToast from '../../SDK/UI/NotificationToast.js';
import './DemoUIAdapter.js';

// Global state
let viewerPlugin = null;
let viewer = null;
let selectedModelPath = null;
let warningShownThisSession = false;
let developerModeAllowedSnapshot = null;

window.resetVolareDemoState = function resetVolareDemoState() {
  viewerPlugin = null;
  viewer = null;
  selectedModelPath = null;
};

// Core initialization function
function initVolare(path = null) {
  setHdriBasePath('./models/HDR/');
  if (developerModeAllowedSnapshot === null) {
    const DeveloperMode = true;
    developerModeAllowedSnapshot = DeveloperMode === true;
  }

  if (!developerModeAllowedSnapshot) {
    document.getElementById('VolareCanvas')?.classList.remove('is-viewer-ready');
    const container = document.getElementById('model');
    if (container) container.style.display = 'none';
    console.warn('[Volare] DeveloperMode is disabled. Reload with DeveloperMode enabled to initialize Volare.');
    return null;
  }

  selectedModelPath = path || selectedModelPath;

  const volareCanvas = document.getElementById('VolareCanvas');
  volareCanvas?.classList.remove('is-warning');
  volareCanvas?.classList.add('is-viewer-ready');
  document.body.classList.add('volare-viewer-open');

  const container = document.getElementById('model');
  if (container) container.style.display = 'block';

  if (!viewerPlugin) {
    viewerPlugin = new VolareViewer();
  }

  if (!viewer || viewer.isInitialized !== true) {
    viewer = viewerPlugin.createViewer('model', {
      antialias: true,
      enableShadows: true,
      fov: 30
    });
    viewer.setEnvironment({ preset: 'lonely-road-afternoon' });
  }

  if (selectedModelPath) {
    viewer.loadModel(selectedModelPath).then(() => {
      viewer.centerCameraOnModel();
      viewer.materialManager?.applyOriginalMaterials(viewer.currentModel);
    }).catch(error => {
      console.error('Failed to load model:', error);
      showToast("<i class='fa-solid fa-circle-exclamation'></i> Error", "Model load failed.<br>" + error.message);
    });
  } else {
    console.warn('No model path selected.');
  }
}

// Form handling
function setupSubmitButton(formId = 'model-access-form') {
  const form = document.getElementById(formId);
  if (!form) {
    console.error('Form not found.');
    return;
  }

  const handler = async (e) => {
    e.preventDefault();

    const submitButton = e.target.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Loading...';
    }

    try {
      form.style.display = 'none';
      initVolare(selectedModelPath);
    } catch (error) {
      console.error('[FORM] Error:', error);
      showToast("<i class='fa-solid fa-circle-exclamation'></i> Error", "Failed to initialize.<br>" + error.message);
      form.style.display = 'block';
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = 'Submit';
      }
    }
  };

  form.onsubmit = handler;
}

function hideForm(formId = 'model-access-form') {
  const form = document.getElementById(formId);
  if (form) {
    form.style.display = 'none';
  }
}

// Canvas display functions
function showPopup(modelPath, quicknav, shadow, volareCanvas, uiManager = null) {
  if (warningShownThisSession || window.volareWarningShownThisSession) {
    showCanvas(modelPath, quicknav, shadow, volareCanvas, uiManager);
    return;
  }

  warningShownThisSession = true;
  window.volareWarningShownThisSession = true;
  setModelPath(modelPath);

  if (quicknav) quicknav.classList.add("fade");
  document.body.style.overflow = "hidden";
  document.body.classList.remove("volare-viewer-open");

  if (shadow) {
    shadow.style.display = "block";
    setTimeout(() => shadow.classList.add("show"), 10);
  }

  if (volareCanvas) {
    volareCanvas.classList.add("show", "is-warning");
    volareCanvas.classList.remove("is-viewer-ready");
  }

  const form = document.getElementById('model-access-form');
  if (form) form.style.display = 'block';
}

function showCanvas(modelPath, quicknav, shadow, volareCanvas, uiManager = null) {
  if (!modelPath) {
    console.error('No model path provided');
    return;
  }

  if (uiManager?.showLoading) {
    uiManager.showLoading('Loading 3D model...', 0);
  }

  try {
    if (quicknav) quicknav.classList.add("fade");
    document.body.style.overflow = "hidden";
    document.body.classList.add("volare-viewer-open");

    if (shadow) {
      shadow.style.display = "block";
      setTimeout(() => shadow.classList.add("show"), 10);
    }

    if (volareCanvas) {
      volareCanvas.classList.add("show", "is-viewer-ready");
      volareCanvas.classList.remove("is-warning");
    }

    initVolare(modelPath);

    setTimeout(() => {
      if (uiManager?.hideLoading) {
        uiManager.hideLoading();
      }
    }, 1000);

  } catch (error) {
    console.error('Failed to show canvas:', error);
    if (uiManager) {
      uiManager.hideLoading();
      uiManager.showNotification?.('Failed to load model', 'error');
    }
  }
}

// Utility functions
function setModelPath(path) {
  selectedModelPath = path;
}

function getModelPath() {
  return selectedModelPath;
}

function isViewerReady() {
  return viewer && viewer.isInitialized === true;
}

function getViewer() {
  return viewer;
}

// Legacy event system support
function connectToGallery() {
  document.addEventListener('volareGalleryClick', (e) => {
    const { modelPath, quicknav, shadow, volareCanvas, uiManager } = e.detail;
    showPopup(modelPath, quicknav, shadow, volareCanvas, uiManager);
    setupSubmitButton('model-access-form');
  });
}

// Main Volare class - Public API
class Volare {
  static async init(config = {}) {
    const mergedConfig = this.mergeConfig(config);
    const instance = new VolareInstance(mergedConfig);
    await instance.initialize();
    return instance;
  }

  static async createGallery(selector, config = {}) {
    const galleryConfig = {
      ...config,
      gallery: { selector, autoSetup: true, ...config.gallery }
    };
    return this.init(galleryConfig);
  }

  static mergeConfig(userConfig = {}) {
    const defaults = {
      ui: { theme: 'dark', showToolkit: true, notifications: true },
      viewer: { antialias: true, fov: 30, enableShadows: true },
      gallery: { showForm: true, autoLoad: false }
    };

    // Deep merge function
    const deepMerge = (target, source) => {
      const result = { ...target };
      for (const key in source) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          result[key] = deepMerge(target[key] || {}, source[key]);
        } else {
          result[key] = source[key];
        }
      }
      return result;
    };

    return deepMerge(defaults, userConfig);
  }
}

// Instance wrapper
class VolareInstance {
  constructor(config) {
    this.config = config;
    this.viewer = null;
    this.uiManager = null;
    this._initialized = false;
  }

  async initialize() {
    if (this._initialized) return;

    try {
      // Wait for DOM if needed
      if (document.readyState === 'loading') {
        await new Promise(resolve => {
          document.addEventListener('DOMContentLoaded', resolve, { once: true });
        });
      }

      // NOTE: do NOT create the viewer here. In the gallery flow the viewer
      // (and its HDRI) must not initialize until the user submits the access
      // form -- initVolare() handles that lazily on submit. Creating it at
      // gallery-setup time spun up the viewer + HDRI on page load (and a second
      // time on submit). Only wire the thumbnails now.

      // Setup gallery if configured
      if (this.config.gallery?.autoSetup) {
        this.setupGallery();
      }

      this._initialized = true;
    } catch (error) {
      console.error('Failed to initialize Volare:', error);
      throw error;
    }
  }

  setupGallery() {
    const selector = this.config.gallery.selector || '.gallery img';

    // Use more defensive query selection
    const images = document.querySelectorAll(selector);

    if (images.length === 0) {
      console.warn(`No images found with selector: ${selector}`);
      return;
    }

    images.forEach(img => {
      if (!img.hasAttribute('data-volare-bound')) {
        img.addEventListener('click', (e) => {
          if (img.dataset.volareLegacyGallery === 'true') return;
          e.preventDefault();
          const modelPath = img.dataset.model || img.closest('[data-model]')?.dataset.model;

          if (!modelPath) {
            console.warn('No data-model attribute found on clicked image');
            return;
          }

          if (this.config.gallery.showForm) {
            this.showWithForm(modelPath);
          } else {
            this.showCanvas(modelPath);
          }
        });
        img.setAttribute('data-volare-bound', 'true');
      }
    });
  }

  // Public API methods
  async showCanvas(modelPath) {
    const elements = this.getDOMElements();
    showCanvas(modelPath, elements.quicknav, elements.shadow, elements.volareCanvas, this.uiManager);
  }

  async showWithForm(modelPath) {
    const elements = this.getDOMElements();
    showPopup(modelPath, elements.quicknav, elements.shadow, elements.volareCanvas, this.uiManager);
    setupSubmitButton('model-access-form');
  }

  async loadModel(path) {
    if (!this.viewer) {
      throw new Error('Viewer not initialized');
    }
    return this.viewer.loadModel(path);
  }

  configure(newConfig) {
    this.config = { ...this.config, ...newConfig };
    return this;
  }

  destroy() {
    this.viewer?.dispose();
    this._initialized = false;
  }

  // Helper method to safely get DOM elements
  getDOMElements() {
    return {
      quicknav: document.getElementById("navbar"),
      shadow: document.querySelector(".shadow"),
      volareCanvas: document.getElementById('VolareCanvas')
    };
  }
}

// Auto-setup function (moved after class definitions)
function setupAutoGallery() {
  const run = async () => {
    const autoGalleries = document.querySelectorAll('[data-volare-auto]');

    for (const gallery of autoGalleries) {
      try {
        const selector = gallery.dataset.volareAuto || 'img[data-model]';
        const showForm = gallery.dataset.volareForm !== 'false';

        await Volare.createGallery(selector, {
          gallery: { showForm }
        });
      } catch (error) {
        console.error('Failed to setup auto gallery:', error);
      }
    }
  };

  // Module evaluation can finish after DOMContentLoaded already fired, so
  // check readyState instead of assuming the event is still pending.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
}

// Initialize everything
connectToGallery();
setupAutoGallery();

// Global setup for script tag usage
if (typeof window !== 'undefined') {
  window.Volare = Volare;
  window.createVolareViewer = createVolareViewer;
  window.getVolareViewers = getVolareViewers;
  window.VolareHDRIPresets = VOLARE_HDRI_PRESETS;

  // Also expose legacy functions for backward compatibility
  window.initVolare = initVolare;
  window.showCanvas = showCanvas;
  window.showPopup = showPopup;
}

// Exports
export {
  Volare as default,
  VolareInstance,
  createVolareViewer,
  getVolareViewers,
  VOLARE_HDRI_PRESETS,
  initVolare,
  setupSubmitButton,
  showCanvas,
  showPopup,
  hideForm,
  setModelPath,
  getModelPath,
  isViewerReady,
  getViewer,
  connectToGallery
};
