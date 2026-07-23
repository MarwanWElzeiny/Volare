import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';
import VLBLoader from '../Utils/VLBLoader.js';

const SUPPORTED_FORMATS = {
  glb: 'gltf', gltf: 'gltf',
  vlb: 'vlb', vmesh: 'vlb',
  fbx: 'fbx',
  obj: 'obj'
};

const lazyLoaderCache = new Map();

function resolveFormat(modelPath, options) {
  if (options?.format) return options.format.toLowerCase();
  let pathname = modelPath || '';
  const hashIndex = pathname.indexOf('#');
  if (hashIndex !== -1) {
    const fragment = decodeURIComponent(pathname.slice(hashIndex + 1));
    const fragExt = fragment.split('.').pop()?.toLowerCase();
    if (fragExt && SUPPORTED_FORMATS[fragExt]) return SUPPORTED_FORMATS[fragExt];
  }
  try {
    const url = new URL(pathname, globalThis.location?.href || 'http://localhost');
    pathname = url.pathname;
  } catch { /* use raw string */ }
  const ext = pathname.split('.').pop()?.toLowerCase();
  return SUPPORTED_FORMATS[ext] || ext || null;
}

export class VolareManager {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.currentModel = null;
    this.loadingManager = new THREE.LoadingManager();
    this.materialManager = null;
    this.eventHandlers = new Map();
    this.customLoaders = options.loaders || {};
    this._performance = options.performance || {};
    this._renderer = options.renderer || null;
    this._dracoLoader = null;
    this._ktx2Loader = null;
    this._meshoptDecoder = null;
    this._decodersReady = this._initDecoders();

    this.emit = function(event, data) {
      if (this.eventHandlers.has(event)) {
        this.eventHandlers.get(event).forEach(cb => cb(data));
      }
    };

    this.on = function(event, callback) {
      if (!this.eventHandlers.has(event)) {
        this.eventHandlers.set(event, []);
      }
      this.eventHandlers.get(event).push(callback);
    };
    this.setupLoadingManager();
  }

  setMaterialManager(materialManager) {
    this.materialManager = materialManager;
  }

  setAnimationManager(animationManager) {
    this.animationManager = animationManager;
  }

  setupLoadingManager() {
    const loadingScreen = document.getElementById('loadingScreen');
    const loadingText = loadingScreen?.querySelector('.loading-text');
    const loadingBar = loadingScreen?.querySelector('.loading-bar');

    this.loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
      const percent = Math.round((itemsLoaded / itemsTotal) * 100);
      if (loadingBar) loadingBar.style.transform = `scaleX(${Math.min(percent, 70) / 100})`;
      if (loadingText) loadingText.textContent = 'Loading model...';
      this.emit('loadingProgress', { percent, url });
    };

    this.loadingManager.onLoad = () => {
      this.emit('loadingComplete');
      if (loadingText) loadingText.textContent = 'Loading textures...';
      if (loadingBar) loadingBar.style.transform = 'scaleX(0.75)';
    };

    this.loadingManager.onError = (error) => {
      this.emit('loadingError', error);
      if (loadingText) loadingText.textContent = 'Failed to load resources.';
    };
  }

  _setOverlayText(text) {
    const el = document.getElementById('loadingScreen')?.querySelector('.loading-text');
    if (el) el.textContent = text;
  }

  async _initDecoders() {
    if (this._performance.meshopt !== false) {
      try {
        const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
        await MeshoptDecoder.ready;
        this._meshoptDecoder = MeshoptDecoder;
      } catch (e) {
        console.warn('[Volare] Meshopt decoder unavailable:', e.message);
      }
    }
    if (this._performance.dracoDecoderPath) {
      try {
        const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
        this._dracoLoader = new DRACOLoader();
        this._dracoLoader.setDecoderPath(this._performance.dracoDecoderPath);
      } catch (e) {
        console.warn('[Volare] Draco decoder unavailable:', e.message);
      }
    }
    if (this._performance.ktx2TranscoderPath && this._renderer) {
      try {
        const { KTX2Loader } = await import('three/addons/loaders/KTX2Loader.js');
        this._ktx2Loader = new KTX2Loader();
        this._ktx2Loader.setTranscoderPath(this._performance.ktx2TranscoderPath);
        this._ktx2Loader.detectSupport(this._renderer);
      } catch (e) {
        console.warn('[Volare] KTX2 loader unavailable:', e.message);
      }
    }
  }

  async getLoader(format) {
    const ext = Object.keys(SUPPORTED_FORMATS).find(k => SUPPORTED_FORMATS[k] === format) || format;
    const customLoader = this.customLoaders[ext] || this.customLoaders[`.${ext}`] || this.customLoaders[format];
    if (customLoader) {
      return typeof customLoader === 'function' ? customLoader(this.loadingManager) : customLoader;
    }
    switch (format) {
      case 'gltf': {
        await this._decodersReady;
        const gltfLoader = new GLTFLoader(this.loadingManager);
        if (this._dracoLoader) gltfLoader.setDRACOLoader(this._dracoLoader);
        if (this._meshoptDecoder) gltfLoader.setMeshoptDecoder(this._meshoptDecoder);
        if (this._ktx2Loader) gltfLoader.setKTX2Loader(this._ktx2Loader);
        return gltfLoader;
      }
      case 'vlb': {
        // VLBLoader is promise-based; adapt to the GLTFLoader-style callback API loadModel expects.
        const vlb = new VLBLoader();
        return {
          load: (url, onLoad, onProgress, onError) => {
            vlb.load(url)
              .then(data => onLoad(vlb.toThreeJS(data, { applyTransform: true })))
              .catch(err => onError?.(err));
          }
        };
      }
      case 'fbx': {
        if (!lazyLoaderCache.has('fbx')) {
          const mod = await import('three/addons/loaders/FBXLoader.js');
          lazyLoaderCache.set('fbx', mod.FBXLoader);
        }
        return new (lazyLoaderCache.get('fbx'))(this.loadingManager);
      }
      case 'obj': {
        if (!lazyLoaderCache.has('obj')) {
          const mod = await import('three/addons/loaders/OBJLoader.js');
          lazyLoaderCache.set('obj', mod.OBJLoader);
        }
        return new (lazyLoaderCache.get('obj'))(this.loadingManager);
      }
      default:
        throw new Error(`[Volare] Unsupported model format: "${format}". Supported: glb, gltf, vlb, fbx, obj.`);
    }
  }

  async loadModel(modelPath, options) {
    this.disposeCurrentModel();
    this.setupLoadingManager?.();

    const format = resolveFormat(modelPath, options);
    if (!format) {
      throw new Error(`[Volare] Cannot determine model format for "${modelPath}". Pass { format: "glb" } explicitly.`);
    }
    const loader = await this.getLoader(format);
    const formatLabel = format.toUpperCase();
    const _bar = document.getElementById('loadingScreen')?.querySelector('.loading-bar');
    const _text = document.getElementById('loadingScreen')?.querySelector('.loading-text');

    return new Promise((resolve, reject) => {
      loader.load(
        modelPath,
        (modelData) => {
          this.loadedAsset = modelData;
          this.currentModel = this.loadedAsset.scene || this.loadedAsset;

          this._setOverlayText('Creating materials...');
          if (format === 'fbx') {
            this.fixFBXTextureColorSpace(this.currentModel);
          }

          // Model processing (updateCurrentModel) is driven by VolareViewer.loadModel
          // after this promise resolves — do NOT call it here or the model is processed twice.
          if (!this.scene.children.includes(this.currentModel)) {
            this.scene.add(this.currentModel);
          }

          this.materialManager?.storeOriginalMaterials(this.currentModel);
          let hasAnimations = false;
          try {
            const animations = modelData?.animations ?? [];
            if (animations.length > 0) this._setOverlayText('Preparing animations...');
            hasAnimations = !!this.animationManager?.loadAnimations(modelData, this.currentModel);
            if (hasAnimations) {
              setTimeout(() => {
                this.animationManager?.playAnimation?.(0);
              }, 500);
            }
          } catch (animationError) {
            console.warn('[Volare] Animation setup failed; continuing without animation controls:', animationError);
            this.animationManager?.dispose?.();
          }

          // Camera framing + environment are owned by VolareViewer / LightingManager.
          this.modelLoaded = true;
          this.emit?.('modelLoaded', { model: this.currentModel, hasAnimations });

          resolve(this.currentModel);
        },
        (xhr) => {
          if (xhr.lengthComputable) {
            const pct = Math.round((xhr.loaded / xhr.total) * 100);
            if (_bar) _bar.style.transform = `scaleX(${Math.min(pct, 70) / 100})`;
            if (_text) _text.textContent = `Loading ${formatLabel}... ${pct}%`;
            this.emit('loadingProgress', { percent: pct });
          }
        },
        (error) => {
          console.error(`[Volare] ${formatLabel} loading error:`, error);
          const message = error?.message || "Something went wrong, please try again later.";
          this.showToast?.("<i class='fa-solid fa-circle-exclamation'></i> Error", message);
          reject(error);
        }
      );
    });
  }

  fixFBXTextureColorSpace(model) {
    const dataMapKeys = new Set(['normalMap', 'bumpMap', 'displacementMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap']);
    model.traverse(child => {
      if (!child.isMesh || !child.material) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        for (const key of Object.keys(mat)) {
          const tex = mat[key];
          if (!tex?.isTexture) continue;
          if (dataMapKeys.has(key)) {
            tex.colorSpace = THREE.LinearSRGBColorSpace;
          } else if (key === 'map' || key === 'emissiveMap' || key === 'specularMap') {
            tex.colorSpace = THREE.SRGBColorSpace;
          }
        }
        mat.needsUpdate = true;
      }
    });
  }

  disposeCurrentModel() {
    if (this.currentModel) {
      this.scene.remove(this.currentModel);
      this.disposeObject3D(this.currentModel);
      this.currentModel = null;
    }
    this.loadedAsset = null;
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

  disposeObject3D(root) {
    const disposedResources = new Set();
    root?.traverse?.(child => {
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

  getCurrentModel() {
    return this.currentModel;
  }

  dispose() {
    this.disposeCurrentModel();
    this._dracoLoader?.dispose?.();
    this._ktx2Loader?.dispose?.();
    this._dracoLoader = null;
    this._ktx2Loader = null;
    this._meshoptDecoder = null;
    this.eventHandlers.clear();
    this.animationManager = null;
    this.materialManager = null;
    this.scene = null;
  }
}

export { VolareManager as ModelLoaderManager, VolareManager as ModelLoader, VolareManager as AssetManager };
