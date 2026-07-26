import '../Utils/ssrGlobalsShim.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import * as THREE from 'three';
import { PMREMGenerator as NodePMREMGenerator } from 'three/webgpu';

let _hdriBasePath = './HDR/';

export function setHdriBasePath(basePath) {
  _hdriBasePath = basePath.endsWith('/') ? basePath : basePath + '/';
}

export function getHdriBasePath() { return _hdriBasePath; }

const hdr = (name) => `${_hdriBasePath}${name}`;

// Single source of truth for the HDRI list. The toolkit's HDRI panel renders
// straight from here, so anything registered shows up in the UI automatically.
// `file` and `image` resolve against setHdriBasePath(); pass an absolute path
// or full URL in either field to load from somewhere else entirely.
export const VOLARE_HDRI_PRESETS = [
  { id: 'lonely-road-afternoon', label: 'Lonely Road Afternoon', file: 'lonely_road_afternoon_puresky_4k.hdr', image: 'lonely_road_afternoon_puresky.jpeg' },
  { id: 'little-paris-eiffel-tower', label: 'Little Paris Eiffel Tower', file: 'little_paris_eiffel_tower_4k.hdr', image: 'little_paris_eiffel_tower.jpeg' },
  { id: 'photo-studio-01', label: 'Photo Studio 01', file: 'photo_studio_01_4k.hdr', image: 'photo_studio_01.jpeg' },
  { id: 'venice-sunset', label: 'Venice Sunset', file: 'venice_sunset_4k.hdr', image: 'venice_sunset.jpeg' },
  { id: 'studio-small-03', label: 'Studio Small 03', file: 'studio_small_03_4k.hdr', image: 'studio_small_03.jpeg' },
  { id: 'studio-small-09', label: 'Studio Small 09', file: 'studio_small_09_4k.hdr', image: 'studio_small_09.jpeg' },
  { id: 'kloofendal-partly-cloudy', label: 'Kloofendal 48d Partly Cloudy', file: 'kloofendal_48d_partly_cloudy_4k.hdr', image: 'kloofendal_48d_partly_cloudy.jpeg' }
];

// Presets added at runtime by the integrator. Kept separate from the built-in
// array so removeHdriPreset() can never delete a shipped preset by accident.
const customHdriPresets = [];

const isAbsolute = value => /^(https?:)?\/\//.test(value) || value.startsWith('/') || value.startsWith('.');

/** Resolve a preset's HDR file to a loadable URL. */
export function resolveHdriFile(preset) {
  const file = preset?.file || '';
  return isAbsolute(file) ? file : hdr(file);
}

/** Resolve a preset's thumbnail to a loadable URL. Returns null when unset. */
export function resolveHdriImage(preset) {
  const image = preset?.image;
  if (!image) return null;
  return isAbsolute(image) ? image : `${_hdriBasePath}images/${image}`;
}

/**
 * Register one or more HDRI presets. They appear in the toolkit's HDRI panel
 * in registration order, after the built-ins. Registering an existing `id`
 * replaces it, which is how you override a built-in.
 *
 * Call before creating the viewer -- the toolkit markup is built during init.
 *
 *   registerHdriPresets([
 *     { id: 'my-studio', label: 'My Studio', file: '/hdr/my_studio_4k.hdr', image: '/hdr/my_studio.jpg' }
 *   ]);
 */
export function registerHdriPresets(presets) {
  const list = Array.isArray(presets) ? presets : [presets];
  for (const preset of list) {
    if (!preset || typeof preset !== 'object') continue;
    if (!preset.id || !preset.file) {
      console.warn('[Volare] HDRI preset needs both "id" and "file"; skipped:', preset);
      continue;
    }
    const entry = {
      id: preset.id,
      label: preset.label || preset.id,
      file: preset.file,
      image: preset.image || null
    };
    const builtInIndex = VOLARE_HDRI_PRESETS.findIndex(p => p.id === entry.id);
    if (builtInIndex !== -1) {
      VOLARE_HDRI_PRESETS[builtInIndex] = entry;
      continue;
    }
    const customIndex = customHdriPresets.findIndex(p => p.id === entry.id);
    if (customIndex !== -1) customHdriPresets[customIndex] = entry;
    else customHdriPresets.push(entry);
  }
  return getHdriPresets();
}

/** Remove a previously registered custom preset. Built-ins are not removable. */
export function removeHdriPreset(id) {
  const index = customHdriPresets.findIndex(p => p.id === id);
  if (index === -1) return false;
  customHdriPresets.splice(index, 1);
  return true;
}

/**
 * Every preset the UI should show: built-ins plus anything registered, each
 * with resolved `url` and `imageUrl`.
 */
export function getHdriPresets() {
  return [...VOLARE_HDRI_PRESETS, ...customHdriPresets].map(preset => ({
    ...preset,
    url: resolveHdriFile(preset),
    imageUrl: resolveHdriImage(preset)
  }));
}

const DEFAULT_ENVIRONMENT_CONFIG = {
  enabled: true,
  hdri: null,
  preset: null,
  intensity: 1,
  background: 'current',
  backgroundColor: '#000000',
  backgroundBlur: 0.35,
  fallback: null
};

export class LightingManager {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    // Classic THREE.PMREMGenerator builds its blur passes with THREE.ShaderMaterial,
    // which the node-based WebGPURenderer can't compile. Use the node-compatible
    // PMREMGenerator from the webgpu build whenever the renderer is that unified
    // Renderer (covers both the WebGPU and WebGPURenderer's own WebGL2 backend).
    this.pmremGenerator = renderer?.isWebGPURenderer
      ? new NodePMREMGenerator(renderer)
      : new THREE.PMREMGenerator(renderer);
    this.currentEnvironmentMap = null;
    this.currentEnvironmentUrl = null;
    this.hdrLoader = new RGBELoader();
    this.isEnvironmentEnabled = true;
    this.config = { ...DEFAULT_ENVIRONMENT_CONFIG };
    this.lastError = null;
    this.disposedEnvironmentCount = 0;
  }

  getPresets() {
    return VOLARE_HDRI_PRESETS.map(preset => ({ ...preset, url: hdr(preset.file) }));
  }

  normalizeEnvironmentConfig(environmentConfig = {}) {
    if (typeof environmentConfig === 'string') {
      return {
        ...this.config,
        enabled: true,
        hdri: environmentConfig,
        preset: null,
        background: this.config.background || DEFAULT_ENVIRONMENT_CONFIG.background
      };
    }

    if (environmentConfig === null || environmentConfig === false) {
      return {
        ...this.config,
        enabled: false,
        hdri: null,
        preset: null
      };
    }

    return {
      ...this.config,
      ...environmentConfig
    };
  }

  resolveHDRI(config) {
    const presetId = config.preset || config.hdriPreset;
    const hdri = config.hdri || config.url || null;
    const preset = VOLARE_HDRI_PRESETS.find(item => item.id === presetId || item.label === presetId);
    return preset ? hdr(preset.file) : hdri;
  }

  async loadHDRI(hdriPath) {
    // WebGPURenderer initializes its GPU backend asynchronously; PMREMGenerator
    // .fromEquirectangular() throws if called before that completes. init() is
    // idempotent and absent on the classic WebGLRenderer, so this is a no-op
    // there. Awaiting it here makes HDRI generation safe on both backends.
    if (this.renderer?.isWebGPURenderer && typeof this.renderer.init === 'function') {
      await this.renderer.init();
    }
    return new Promise((resolve, reject) => {
      this.hdrLoader.load(
        hdriPath,
        texture => {
          try {
            const generated = this.pmremGenerator.fromEquirectangular(texture).texture;
            texture.dispose();
            resolve(generated);
          } catch (error) {
            texture.dispose();
            reject(error);
          }
        },
        undefined,
        reject
      );
    });
  }

  disposeCurrentEnvironmentMap() {
    if (!this.currentEnvironmentMap) return;
    this.currentEnvironmentMap.dispose();
    this.currentEnvironmentMap = null;
    this.currentEnvironmentUrl = null;
    this.disposedEnvironmentCount += 1;
  }

  applyBackground(config) {
    const mode = config.background || 'current';
    if ('environmentIntensity' in this.scene) this.scene.environmentIntensity = config.intensity;
    if ('backgroundIntensity' in this.scene) this.scene.backgroundIntensity = config.intensity;
    if ('backgroundBlurriness' in this.scene) this.scene.backgroundBlurriness = 0;
    this.renderer?.setClearAlpha?.(1);

    if (!config.enabled) {
      this.scene.environment = null;
      this.scene.background = null;
      this.renderer?.setClearAlpha?.(0);
      return;
    }

    this.scene.environment = this.currentEnvironmentMap || null;

    switch (mode) {
      case 'transparent':
        this.scene.background = null;
        this.renderer?.setClearAlpha?.(0);
        break;
      case 'solid':
      case 'solid-color':
      case 'color':
        this.scene.background = new THREE.Color(config.backgroundColor || DEFAULT_ENVIRONMENT_CONFIG.backgroundColor);
        break;
      case 'blurred':
      case 'blurred-canvas':
      case 'blurred-canvas-background':
        this.scene.background = this.currentEnvironmentMap || null;
        if ('backgroundBlurriness' in this.scene) {
          this.scene.backgroundBlurriness = Number.isFinite(config.backgroundBlur) ? config.backgroundBlur : DEFAULT_ENVIRONMENT_CONFIG.backgroundBlur;
        }
        break;
      case 'hdri':
      case 'visible':
      case 'current':
      case 'default':
      default:
        this.scene.background = this.currentEnvironmentMap || null;
        break;
    }
  }

  async setEnvironment(environmentConfig) {
    const nextConfig = this.normalizeEnvironmentConfig(environmentConfig);
    const hdriPath = this.resolveHDRI(nextConfig);
    const shouldLoadHDRI = nextConfig.enabled && hdriPath && hdriPath !== this.currentEnvironmentUrl;
    this.lastError = null;

    if (!nextConfig.enabled) {
      this.config = nextConfig;
      this.isEnvironmentEnabled = false;
      this.scene.environment = null;
      this.scene.background = null;
      this.disposeCurrentEnvironmentMap();
      this.applyBackground(nextConfig);
      return this.getDiagnostics();
    }

    try {
      if (shouldLoadHDRI) {
        const nextMap = await this.loadHDRI(hdriPath);
        this.disposeCurrentEnvironmentMap();
        this.currentEnvironmentMap = nextMap;
        this.currentEnvironmentUrl = hdriPath;
      }

      this.config = { ...nextConfig, hdri: hdriPath };
      this.isEnvironmentEnabled = true;
      this.applyBackground(this.config);
      return this.getDiagnostics();
    } catch (error) {
      const message = error?.message || String(error);
      this.lastError = message;
      if (nextConfig.fallback) {
        await this.setEnvironment({
          ...nextConfig,
          ...nextConfig.fallback
        });
        this.lastError = message;
        return this.getDiagnostics();
      }
      this.applyBackground(this.config);
      throw error;
    }
  }

  toggleEnvironment() {
    this.isEnvironmentEnabled = !this.isEnvironmentEnabled;

    if (this.isEnvironmentEnabled) {
      this.applyBackground({
        ...this.config,
        enabled: true
      });
    } else {
      this.scene.background = null;
    }
  }

  getDiagnostics() {
    return {
      enabled: this.config.enabled,
      hdri: this.currentEnvironmentUrl,
      background: this.config.background,
      backgroundColor: this.config.backgroundColor,
      intensity: this.config.intensity,
      hasEnvironmentMap: !!this.currentEnvironmentMap,
      disposedEnvironmentCount: this.disposedEnvironmentCount,
      lastError: this.lastError,
      availablePresets: this.getPresets()
    };
  }

  dispose() {
    this.scene.environment = null;
    this.scene.background = null;
    this.disposeCurrentEnvironmentMap();
    this.pmremGenerator?.dispose();
  }
}

export { LightingManager as LightingController, LightingManager as EnvironmentController };
