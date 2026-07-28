import { VolarePluginManager } from './PluginHost.js';
import { VolareViewerInit } from './VolareViewer.js';
import { registerHdriPresets } from '../Managers/LightingController.js';

const viewerRegistry = new Set();
const LIFECYCLE_CALLBACKS = ['onReady', 'onModelLoad', 'onModelError', 'onClose', 'onDispose'];
const KNOWN_CONFIG_KEYS = new Set([
  'container', 'model', 'protectedAsset', 'ui', 'theme', 'layout', 'renderer',
  'environment', 'assets', 'tools', 'plugins', 'security', 'loaders', 'customLoaders',
  'viewer', 'pluginUI', 'features', 'diagnostics', 'development', 'DeveloperMode',
  'performance',
  ...LIFECYCLE_CALLBACKS
]);

function isHTMLElementLike(value) {
  const ElementCtor = globalThis.HTMLElement || globalThis.Element;
  return !!(
    value &&
    typeof value === 'object' &&
    (ElementCtor ? value instanceof ElementCtor : value.nodeType === 1)
  );
}

function resolveContainer(container) {
  if (typeof container === 'string') return document.querySelector(container);
  if (isHTMLElementLike(container)) return container;
  return null;
}

const TOOL_FEATURE_MAP = {
  materialInspector: 'toggle-material-inspector',
  turntablePlus: 'toggle-turntable-plus',
  boundingVolumes: 'toggle-bounding-volumes',
  crossSection: 'toggle-cross-section',
  directorMode: 'toggle-director-mode',
  normals: 'toggle-normals',
  uvPreview: 'toggle-uv-preview',
  meshAnalysis: 'toggle-mesh-analysis',
  meshInspector: 'toggle-mesh-analysis',
  vertexFocus: 'toggle-mesh-analysis',
  performance: 'toggle-performance'
};

function isDevelopmentMode(config = {}) {
  if (config.development === true) return true;
  if (config.development === false) return false;
  const location = globalThis.location;
  if (!location) return false;
  return (
    location.protocol === 'file:' ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1' ||
    location.hostname === '::1'
  );
}

function warnDevelopment(config, message) {
  if (!isDevelopmentMode(config)) return;
  console.warn(`[Volare] ${message}`);
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateBoolean(config, key) {
  if (key in config && typeof config[key] !== 'boolean') {
    warnDevelopment(config, `Option "${key}" should be a boolean.`);
  }
}

function validateNumber(config, group, key) {
  const value = config[group]?.[key];
  if (value !== undefined && typeof value !== 'number') {
    warnDevelopment(config, `Option "${group}.${key}" should be a number.`);
  }
}

function validateStringEnum(config, group, key, allowed) {
  const value = config[group]?.[key];
  if (value !== undefined && value !== null && !allowed.includes(value)) {
    warnDevelopment(config, `Option "${group}.${key}" has an unsupported value.`);
  }
}

function validateCallbacks(config) {
  for (const name of LIFECYCLE_CALLBACKS) {
    if (name in config && typeof config[name] !== 'function') {
      warnDevelopment(config, `Option "${name}" should be a function.`);
    }
  }
}

function validateConfig(config = {}) {
  if (!isPlainObject(config)) {
    throw new Error('createVolareViewer requires a configuration object.');
  }

  for (const key of Object.keys(config)) {
    if (!KNOWN_CONFIG_KEYS.has(key)) {
      warnDevelopment(config, `Unknown option "${key}" was ignored.`);
    }
  }

  if (!('container' in config)) {
    throw new Error('createVolareViewer requires a container option.');
  }
  if (typeof config.container !== 'string' && !isHTMLElementLike(config.container)) {
    throw new Error('createVolareViewer requires container to be a selector string or HTMLElement.');
  }

  if ('model' in config && config.model !== null && typeof config.model !== 'string') {
    throw new Error('createVolareViewer requires model to be a URL string when provided.');
  }
  if ('protectedAsset' in config && config.protectedAsset !== null && !isPlainObject(config.protectedAsset)) {
    throw new Error('createVolareViewer requires protectedAsset to be an object when provided.');
  }
  if (config.protectedAsset) {
    ['assetId', 'licenseEndpoint', 'manifestEndpoint', 'assetEndpoint', 'chunkEndpoint', 'clientId'].forEach(key => {
      if (config.protectedAsset[key] !== undefined && typeof config.protectedAsset[key] !== 'string') {
        warnDevelopment(config, `Option "protectedAsset.${key}" should be a string.`);
      }
    });
  }

  validateCallbacks(config);
  if ('ui' in config && typeof config.ui !== 'boolean' && !isPlainObject(config.ui)) {
    warnDevelopment(config, 'Option "ui" should be a boolean or object.');
  }
  validateBoolean(config, 'pluginUI');
  validateBoolean(config, 'diagnostics');

  if ('tools' in config && config.tools !== null && !isPlainObject(config.tools)) {
    warnDevelopment(config, 'Option "tools" should be an object.');
  } else if (config.tools) {
    for (const [key, value] of Object.entries(config.tools)) {
      if (TOOL_FEATURE_MAP[key] && typeof value !== 'boolean') {
        warnDevelopment(config, `Option "tools.${key}" should be a boolean.`);
      }
    }
  }

  if ('features' in config && config.features !== null && !isPlainObject(config.features)) {
    warnDevelopment(config, 'Option "features" should be an object.');
  } else if (config.features?.disabled !== undefined && !Array.isArray(config.features.disabled)) {
    warnDevelopment(config, 'Option "features.disabled" should be an array.');
  }

  if ('theme' in config && config.theme !== null && typeof config.theme !== 'string' && !isPlainObject(config.theme)) {
    warnDevelopment(config, 'Option "theme" should be a string or object.');
  }
  validateStringEnum(config, 'theme', 'mode', ['dark', 'light', 'default', 'opaque']);
  validateStringEnum(config, 'theme', 'density', ['comfortable', 'compact']);

  if ('layout' in config && config.layout !== null && !isPlainObject(config.layout)) {
    warnDevelopment(config, 'Option "layout" should be an object.');
  }
  if ('renderer' in config && config.renderer !== null && !isPlainObject(config.renderer)) {
    warnDevelopment(config, 'Option "renderer" should be an object.');
  }
  validateStringEnum(config, 'renderer', 'preferredBackend', ['webgl', 'webgpu', 'auto']);

  if ('environment' in config && config.environment !== null && typeof config.environment !== 'string' && typeof config.environment !== 'boolean' && !isPlainObject(config.environment)) {
    warnDevelopment(config, 'Option "environment" should be a string, boolean, or object.');
  }
  if (isPlainObject(config.environment)) {
    validateNumber(config, 'environment', 'intensity');
    validateNumber(config, 'environment', 'backgroundBlur');
    validateStringEnum(config, 'environment', 'background', ['current', 'blurred', 'color', 'transparent']);
  }

  if ('assets' in config && config.assets !== null && !isPlainObject(config.assets)) {
    warnDevelopment(config, 'Option "assets" should be an object.');
  }
}

function createLifecycleCallbacks(config) {
  return LIFECYCLE_CALLBACKS.reduce((callbacks, name) => {
    if (typeof config[name] === 'function') callbacks[name] = config[name];
    return callbacks;
  }, {});
}

function invokeLifecycleCallback(callbacks, name, payload, config) {
  const callback = callbacks[name];
  if (typeof callback !== 'function') return;
  try {
    const result = callback(payload);
    if (result && typeof result.then === 'function') {
      result.catch(error => {
        warnDevelopment(config, `${name} callback rejected: ${error?.message || 'unknown error'}.`);
      });
    }
  } catch (error) {
    warnDevelopment(config, `${name} callback failed: ${error?.message || 'unknown error'}.`);
  }
}

function normalizeTheme(theme) {
  if (!theme || typeof theme === 'string') {
    return { mode: theme || 'dark', accent: null, glass: true, density: 'comfortable', classPrefix: 'vlr', cssVariables: {} };
  }
  return {
    mode: theme.mode || 'dark',
    accent: theme.accent || null,
    glass: theme.glass !== false,
    density: theme.density || 'comfortable',
    classPrefix: theme.classPrefix || 'vlr',
    cssVariables: theme.cssVariables || {},
    ...theme
  };
}

function normalizeUIConfig(ui) {
  if (ui === false) return { enabled: false, toolbar: false, animationPanel: false, topBar: false, closeButton: false, resetCameraButton: false, loadingScreen: false, toast: false, panels: {} };
  if (ui === true || ui === undefined || ui === null) return { enabled: true, toolbar: true, animationPanel: true, topBar: true, closeButton: true, resetCameraButton: true, loadingScreen: true, toast: true, panels: {} };
  return {
    enabled: ui.enabled !== false,
    toolbar: ui.toolbar !== false,
    animationPanel: ui.animationPanel !== false,
    topBar: ui.topBar !== false,
    closeButton: ui.closeButton !== false,
    resetCameraButton: ui.resetCameraButton !== false,
    loadingScreen: ui.loadingScreen !== false,
    toast: ui.toast !== false,
    panels: isPlainObject(ui.panels) ? ui.panels : {}
  };
}

function applyUIConfig(container, uiConfig) {
  if (!container || !uiConfig || uiConfig.enabled === false) return;

  const hide = (selector) => {
    const el = container.querySelector(selector) || document.querySelector(selector);
    if (el) el.hidden = true;
  };

  if (!uiConfig.toolbar) {
    hide('.vlr-toolkit-toggle');
    hide('#vlr-visual-toolkit');
  }
  if (!uiConfig.animationPanel) hide('#animation-panel');
  if (!uiConfig.topBar) hide('.vlr-model-attr-main');
  if (!uiConfig.closeButton) {
    container.querySelectorAll('.vlr-close-preview-icon').forEach(el => { el.hidden = true; });
  }
  if (!uiConfig.resetCameraButton) {
    hide('#vlr-center-camera');
    hide('#vlr-reset-camera');
    hide('#vlr-reset-toggle');
  }
  if (!uiConfig.loadingScreen) hide('.loading');
}

function resolveToolsDisabled(tools, existingDisabled) {
  const disabled = new Set(existingDisabled || []);
  if (!tools || typeof tools !== 'object') return [...disabled];
  for (const [key, enabled] of Object.entries(tools)) {
    const featureId = TOOL_FEATURE_MAP[key];
    if (!featureId) continue;
    if (enabled === false) disabled.add(featureId);
    else disabled.delete(featureId);
  }
  return [...disabled];
}

function normalizeConfig(config = {}) {
  const theme = normalizeTheme(config.theme);
  const uiConfig = normalizeUIConfig(config.ui);
  const toolsFromUI = isPlainObject(config.ui) && isPlainObject(config.ui.tools) ? config.ui.tools : null;
  const mergedTools = toolsFromUI ? { ...toolsFromUI, ...(config.tools || {}) } : (config.tools || {});
  const featuresDisabled = resolveToolsDisabled(mergedTools, config.features?.disabled);
  return {
    container: config.container || '#viewer',
    model: config.model || null,
    protectedAsset: config.protectedAsset || null,
    ui: uiConfig.enabled,
    uiConfig,
    theme,
    layout: {
      mode: 'overlay',
      width: '90vw',
      mobileFullscreen: true,
      ...(config.layout || {})
    },
    renderer: {
      // Default to the proven WebGL backend. WebGPU (r185) initializes but
      // renders blank on some GPUs/drivers, so it's opt-in via
      // preferredBackend: 'webgpu' (or 'auto') rather than the default.
      preferredBackend: 'webgl',
      pixelRatio: 'auto',
      adaptiveQuality: true,
      ...(config.renderer || {})
    },
    environment: {
      enabled: true,
      hdri: null,
      preset: null,
      intensity: 1,
      background: 'current',
      backgroundColor: '#000000',
      backgroundBlur: 0.35,
      ...(config.environment || {})
    },
    tools: mergedTools,
    plugins: Array.isArray(config.plugins) ? config.plugins : [],
    security: config.security || {},
    performance: {
      meshopt: true,
      dracoDecoderPath: null,
      ktx2TranscoderPath: null,
      uvWorker: true,
      ...(config.performance || {})
    },
    loaders: config.loaders || config.customLoaders || {},
    viewer: config.viewer || {},
    pluginUI: config.pluginUI === true,
    features: {
      disabled: featuresDisabled
    },
    assets: {
      hdriBaseUrl: null,
      logoUrl: null,
      ...(isPlainObject(config.assets) ? config.assets : {})
    },
    diagnostics: config.diagnostics === true
  };
}

function applyCssVariables(container, theme) {
  if (!container || !theme) return;
  const target = container.style ? container : document.documentElement;
  if (theme.accent) {
    target.style.setProperty('--vlr-accent', theme.accent);
  }
  if (theme.glass === false) {
    target.style.setProperty('--vlr-glass-blur', 'none');
    target.style.setProperty('--vlr-glass-bg', 'rgba(0,0,0,0.8)');
    target.style.setProperty('--vlr-glass-bg-strong', 'rgba(0,0,0,0.9)');
  }
  if (theme.cssVariables && typeof theme.cssVariables === 'object') {
    for (const [prop, value] of Object.entries(theme.cssVariables)) {
      if (prop.startsWith('--')) {
        target.style.setProperty(prop, value);
      }
    }
  }
}

const VLR_ALIAS_MAP = [
  { selector: '#VolareCanvas', alias: 'vlr-viewer' },
  { selector: '#model', alias: 'vlr-canvas', role: 'canvas' },
  { selector: '#vlr-visual-toolkit', alias: 'vlr-visual-toolkit' },
  { selector: '#vlr-advanced-three', alias: 'vlr-advanced-panel' },
  { selector: '#animation-panel', alias: 'vlr-animation-panel' },
  { selector: '#loadingScreen', alias: 'vlr-loading', role: 'loading' },
  { selector: '.vlr-advanced-btn', alias: 'vlr-feature-button', all: true },
  { selector: '.vlr-advanced-right', alias: 'vlr-feature-grid', role: 'feature-grid', all: true },
  { selector: '.vlr-modes-wireframe', alias: 'vlr-wireframe-bar', role: 'wireframe-bar', all: true },
  { selector: '.vlr-op-wireframe', alias: 'vlr-mode-button', all: true },
  { selector: '.vlr-model-attr-back', alias: 'vlr-model-attributes', all: true },
  { selector: '.vlr-advanced-anim-button', alias: 'vlr-animation-control', all: true },
  { selector: '.vlr-close-toolkit-icon', alias: 'vlr-close-button', role: 'toolkit-close', all: true },
  { selector: '.closepreview', alias: 'vlr-close-button', all: true },
  { selector: '.vlr-hdri-container', alias: 'vlr-hdri-panel', role: 'hdri-panel', all: true }
];

function applyClassAliases(root) {
  const scope = root || document;
  const applyAlias = (el, alias, role) => {
    el.classList.add(alias);
    if (role && !el.hasAttribute('data-vlr-role')) {
      el.setAttribute('data-vlr-role', role);
    }
  };
  for (const { selector, alias, role, all } of VLR_ALIAS_MAP) {
    if (all) {
      scope.querySelectorAll(selector).forEach(el => applyAlias(el, alias, role));
    } else {
      const el = scope.querySelector(selector) || document.querySelector(selector);
      if (el) applyAlias(el, alias, role);
    }
  }
}

function createRequestNonce() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const random = new Uint32Array(4);
  globalThis.crypto?.getRandomValues?.(random);
  return Array.from(random).map(value => value.toString(16).padStart(8, '0')).join('-') || `${Date.now()}-${Math.random()}`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok || body?.success === false) {
    throw new Error(body?.error || `Protected asset request failed (${response.status}).`);
  }
  return body;
}

async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join('');
}

function normalizeProtectedAssetConfig(config) {
  if (!config?.assetId) return null;
  const assetId = config.assetId;
  return {
    assetId,
    licenseEndpoint: config.licenseEndpoint || '/api/volare/license',
    manifestEndpoint: config.manifestEndpoint || `/api/volare/manifest/${encodeURIComponent(assetId)}`,
    assetEndpoint: config.assetEndpoint || `/api/volare/asset/${encodeURIComponent(assetId)}`,
    chunkEndpoint: config.chunkEndpoint || `/api/volare/chunk/${encodeURIComponent(assetId)}`,
    clientId: config.clientId || 'volare-browser-client'
  };
}

async function runSecurityHook(security, name, ...args) {
  const hook = security?.[name];
  if (typeof hook !== 'function') return true;
  return hook(...args);
}

function setContainerVisible(container, visible) {
  if (container) container.style.display = visible ? '' : 'none';
}

function snapshotDeveloperMode(config = {}) {
  return config.DeveloperMode !== false;
}

function createDeveloperModeDisabledError() {
  return new Error('Volare is disabled because DeveloperMode was false when the viewer initialized. Reload with DeveloperMode enabled to use Volare.');
}

function createDiagnostics(viewer, config, pluginManager) {
  const rendererDiagnostics = viewer?.getRendererDiagnostics?.() || {
    requestedBackend: config.renderer.preferredBackend,
    selectedBackend: null,
    activeBackend: null,
    backend: null,
    webgl: false,
    webgpu: false,
    pixelRatio: null,
    available: null,
    fallback: null,
    error: viewer ? null : 'Viewer is not initialized.'
  };
  const environment = viewer?.lightingManager?.getDiagnostics?.() || null;
  const diagnostics = {
    ready: !!viewer?.isInitialized,
    hasModel: !!viewer?.currentModel,
    modelName: viewer?.currentModel?.name || null,
    ui: config.ui,
    theme: { mode: config.theme.mode, accent: config.theme.accent, glass: config.theme.glass },
    renderer: rendererDiagnostics,
    environment,
    layout: config.layout,
    features: {
      disabled: [...config.features.disabled]
    },
    tools: config.tools,
    container: viewer?.container?.id || null
  };
  if (config.diagnostics) {
    diagnostics.cssVariablesApplied = { ...config.theme.cssVariables };
    if (config.theme.accent) diagnostics.cssVariablesApplied['--vlr-accent'] = config.theme.accent;
    if (config._timing) diagnostics.timing = { ...config._timing };
  }
  return pluginManager?.getDiagnostics(diagnostics) || diagnostics;
}

function shouldApplyInitialEnvironment(environment) {
  return !!(
    environment.hdri ||
    environment.preset ||
    environment.hdriPreset ||
    environment.enabled === false ||
    environment.background !== 'current' ||
    environment.intensity !== 1
  );
}

function resolveFeatureElement(container, featureId) {
  const escapedId = window.CSS?.escape ? CSS.escape(featureId) : featureId.replace(/["\\]/g, '\\$&');
  try {
    return document.getElementById(featureId) || container.querySelector(`#${escapedId}`);
  } catch {
    return document.getElementById(featureId);
  }
}

function setFeatureElementEnabled(container, featureId, enabled) {
  const element = resolveFeatureElement(container, featureId);
  if (!element) return false;
  element.hidden = !enabled;
  element.dataset.volareFeatureDisabled = enabled ? 'false' : 'true';
  return true;
}

export async function createVolareViewer(userConfig = {}) {
  const _t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  validateConfig(userConfig);
  const developerModeAllowed = snapshotDeveloperMode(userConfig);
  const config = normalizeConfig(userConfig);
  config.DeveloperMode = developerModeAllowed;
  config.developerMode = {
    allowed: developerModeAllowed,
    checkedOnce: true
  };
  const lifecycleCallbacks = createLifecycleCallbacks(userConfig);
  const container = resolveContainer(config.container);

  if (!container) {
    throw new Error('createVolareViewer container selector did not resolve to an HTMLElement.');
  }

  if (!container.id) {
    container.id = `volare-viewer-${viewerRegistry.size + 1}`;
  }

  if (!developerModeAllowed) {
    setContainerVisible(container, false);
  }

  const pluginManager = new VolarePluginManager({ allowUI: developerModeAllowed && config.pluginUI });
  const sdk = {
    container,
    config,
    developerModeAllowed,
    disabled: !developerModeAllowed,
    viewer: null,
    plugins: pluginManager.plugins,
    pluginManager,
    isOpen: developerModeAllowed,
    _closed: !developerModeAllowed,
    _disposed: false,
    _readyEmitted: false,
    protectedObjectUrls: new Set(),
    async loadModel(url, options) {
      if (!developerModeAllowed) throw createDeveloperModeDisabledError();
      if (!url) throw new Error('loadModel requires a model URL.');
      await pluginManager.run('onSecurityCheck', { type: 'beforeLoadModel', url }, sdk);
      const securityResult = await runSecurityHook(config.security, 'beforeLoadModel', url, sdk);
      if (securityResult === false) throw new Error('Model load blocked by security hook.');

      const nextUrl = typeof securityResult === 'string' ? securityResult : url;
      await pluginManager.run('beforeLoadModel', nextUrl, sdk);
      try {
        const model = await sdk.viewer.loadModel(nextUrl, options);
        await runSecurityHook(config.security, 'afterLoadModel', model, sdk);
        await pluginManager.run('afterLoadModel', model, sdk);
        const statistics = sdk.viewer?.modelStats || null;
        const payload = { viewer: sdk, model, source: nextUrl };
        if (statistics) payload.statistics = statistics;
        invokeLifecycleCallback(lifecycleCallbacks, 'onModelLoad', payload, userConfig);
        return model;
      } catch (error) {
        invokeLifecycleCallback(lifecycleCallbacks, 'onModelError', {
          viewer: sdk,
          source: nextUrl,
          error
        }, userConfig);
        await pluginManager.run('onModelError', error, nextUrl, sdk);
        throw error;
      }
    },
    async loadProtectedAsset(protectedAssetConfig = config.protectedAsset) {
      if (!developerModeAllowed) throw createDeveloperModeDisabledError();
      const protectedAsset = normalizeProtectedAssetConfig(protectedAssetConfig);
      if (!protectedAsset) throw new Error('Protected Volare loading requires protectedAsset.assetId.');

      const licenseNonce = createRequestNonce();
      const license = await fetchJson(protectedAsset.licenseEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Volare-Nonce': licenseNonce
        },
        body: JSON.stringify({
          assetId: protectedAsset.assetId,
          clientId: protectedAsset.clientId,
          nonce: licenseNonce
        })
      });

      const manifestNonce = createRequestNonce();
      const manifestResponse = await fetchJson(protectedAsset.manifestEndpoint, {
        headers: {
          'Authorization': `Bearer ${license.token}`,
          'X-Volare-Nonce': manifestNonce
        }
      });
      const manifest = manifestResponse.manifest;
      if (!manifest?.signature || !manifest?.expiresAt) {
        throw new Error('Protected asset manifest is missing a signature or expiry.');
      }

      if (manifest.delivery === 'chunked') {
        return await sdk._loadChunkedProtectedAsset(protectedAsset, license, manifest);
      }

      const assetNonce = createRequestNonce();
      const assetResponse = await fetch(protectedAsset.assetEndpoint, {
        headers: {
          'Authorization': `Bearer ${license.token}`,
          'X-Volare-Nonce': assetNonce,
          'X-Volare-Manifest-Signature': manifest.signature,
          'X-Volare-Manifest-Expiry': manifest.expiresAt
        }
      });
      if (!assetResponse.ok) {
        let errorCode = `Protected asset request failed (${assetResponse.status}).`;
        try {
          const body = await assetResponse.json();
          errorCode = body?.error || errorCode;
        } catch {}
        throw new Error(errorCode);
      }

      const buffer = await assetResponse.arrayBuffer();
      const actualHash = await sha256Hex(buffer);
      if (actualHash && manifest.hash && actualHash !== manifest.hash) {
        throw new Error('Protected asset hash validation failed.');
      }

      const blob = new Blob([buffer], { type: manifest.contentType || assetResponse.headers.get('Content-Type') || 'model/gltf+json' });
      const objectUrl = URL.createObjectURL(blob);
      const modelUrl = manifest.file
        ? `${objectUrl}#${encodeURIComponent(manifest.file)}`
        : objectUrl;
      sdk.protectedObjectUrls.add(objectUrl);
      const manifestFile = manifest.file || '';
      const manifestExt = manifestFile.split('.').pop()?.toLowerCase();
      const formatHint = manifest.format || (manifestExt && manifestExt !== manifestFile ? manifestExt : null);
      try {
        return await sdk.loadModel(modelUrl, formatHint ? { format: formatHint } : undefined);
      } finally {
        URL.revokeObjectURL(objectUrl);
        sdk.protectedObjectUrls.delete(objectUrl);
      }
    },
    async _loadChunkedProtectedAsset(protectedAsset, license, manifest) {
      if (!Array.isArray(manifest.chunks) || manifest.chunks.length === 0) {
        throw new Error('Chunked manifest contains no chunks.');
      }

      const buffers = [];
      let totalBytes = 0;

      for (const chunk of manifest.chunks) {
        const chunkNonce = createRequestNonce();
        const chunkUrl = `${protectedAsset.chunkEndpoint}/${chunk.index}`;
        const chunkResponse = await fetch(chunkUrl, {
          headers: {
            'Authorization': `Bearer ${license.token}`,
            'X-Volare-Nonce': chunkNonce
          }
        });
        if (!chunkResponse.ok) {
          let errorCode = `Chunk ${chunk.index} fetch failed (${chunkResponse.status}).`;
          try {
            const body = await chunkResponse.json();
            errorCode = body?.error || errorCode;
          } catch {}
          throw new Error(errorCode);
        }

        const chunkBuffer = await chunkResponse.arrayBuffer();
        const chunkHash = await sha256Hex(chunkBuffer);
        if (chunkHash && chunk.sha256 && chunkHash !== chunk.sha256) {
          throw new Error(`Chunk ${chunk.index} hash validation failed.`);
        }

        buffers.push(chunkBuffer);
        totalBytes += chunkBuffer.byteLength;
      }

      const assembled = new Uint8Array(totalBytes);
      let offset = 0;
      for (const buf of buffers) {
        assembled.set(new Uint8Array(buf), offset);
        offset += buf.byteLength;
      }

      const totalHash = await sha256Hex(assembled.buffer);
      if (totalHash && manifest.totalSha256 && totalHash !== manifest.totalSha256) {
        throw new Error('Assembled asset total hash validation failed.');
      }

      const contentType = manifest.contentType || 'application/octet-stream';
      const blob = new Blob([assembled], { type: contentType });
      const objectUrl = URL.createObjectURL(blob);
      sdk.protectedObjectUrls.add(objectUrl);

      const formatHint = manifest.format || null;
      try {
        return await sdk.loadModel(objectUrl, formatHint ? { format: formatHint } : undefined);
      } finally {
        URL.revokeObjectURL(objectUrl);
        sdk.protectedObjectUrls.delete(objectUrl);
      }
    },
    destroy() {
      if (sdk._disposed) return;
      sdk.protectedObjectUrls.forEach(url => URL.revokeObjectURL(url));
      sdk.protectedObjectUrls.clear();
      pluginManager.destroy();
      const viewer = sdk.viewer;
      viewer?.dispose?.();
      if (!sdk._disposed) finishDisposal();
      sdk.viewer = null;
    },
    close(reason = 'api') {
      const closeReason = ['user', 'api', 'unknown'].includes(reason) ? reason : 'unknown';
      setContainerVisible(container, false);
      sdk.isOpen = false;
      if (!sdk._closed) {
        sdk._closed = true;
        invokeLifecycleCallback(lifecycleCallbacks, 'onClose', {
          viewer: sdk,
          reason: closeReason
        }, userConfig);
      }
    },
    open() {
      if (!developerModeAllowed) {
        setContainerVisible(container, false);
        sdk.isOpen = false;
        return;
      }
      setContainerVisible(container, true);
      sdk.isOpen = true;
      sdk._closed = false;
    },
    dispose() {
      sdk.destroy();
    },
    async setEnvironment(environmentConfig = {}) {
      if (!developerModeAllowed) throw createDeveloperModeDisabledError();
      const nextEnvironment = typeof environmentConfig === 'string'
        ? { ...config.environment, enabled: true, hdri: environmentConfig, preset: null }
        : { ...config.environment, ...environmentConfig };
      if (typeof environmentConfig === 'object' && environmentConfig !== null) {
        if ('hdri' in environmentConfig || 'url' in environmentConfig) {
          nextEnvironment.preset = environmentConfig.preset || environmentConfig.hdriPreset || null;
        }
        if ('preset' in environmentConfig || 'hdriPreset' in environmentConfig) {
          nextEnvironment.hdri = environmentConfig.hdri || environmentConfig.url || null;
        }
      }
      config.environment = nextEnvironment;
      const diagnostics = await sdk.viewer.setEnvironment(nextEnvironment);
      await pluginManager.run('onEnvironmentChange', diagnostics, sdk);
      return diagnostics;
    },
    getDiagnostics() {
      return createDiagnostics(sdk.viewer, config, pluginManager);
    },
    registerPlugin(plugin) {
      const registered = pluginManager.register(plugin);
      if (registered && sdk.viewer?.isInitialized) {
        pluginManager.run('afterInit', sdk);
      }
      return sdk;
    },
    setFeatureEnabled(featureId, enabled = true) {
      if (!developerModeAllowed) return false;
      if (!featureId) return false;
      const updated = setFeatureElementEnabled(container, featureId, enabled);
      const disabled = new Set(config.features.disabled);
      if (enabled) disabled.delete(featureId);
      else disabled.add(featureId);
      config.features.disabled = Array.from(disabled);
      return updated;
    }
  };

  function finishDisposal() {
    if (sdk._disposed) return;
    sdk._disposed = true;
    viewerRegistry.delete(sdk);
    invokeLifecycleCallback(lifecycleCallbacks, 'onDispose', { viewer: sdk }, userConfig);
  }

  try {
    if (!developerModeAllowed) {
      viewerRegistry.add(sdk);
      if (!sdk._readyEmitted) {
        sdk._readyEmitted = true;
        const _tReady = typeof performance !== 'undefined' ? performance.now() : 0;
        config._timing = { initMs: Math.round(_tReady - _t0) };
        invokeLifecycleCallback(lifecycleCallbacks, 'onReady', {
          viewer: sdk,
          container
        }, userConfig);
      }
      return sdk;
    }

    config.plugins.forEach(plugin => pluginManager.register(plugin));

    // Register custom HDRIs before the viewer is constructed -- the toolkit's
    // HDRI panel markup is generated during init, so later registration would
    // not appear in the list.
    if (Array.isArray(config.environment?.presets) && config.environment.presets.length) {
      registerHdriPresets(config.environment.presets);
    }

    await pluginManager.run('beforeInit', sdk);
    sdk.viewer = new VolareViewerInit(container, {
      ...config.viewer,
      ui: config.ui,
      theme: config.theme.mode || 'default',
      loaders: config.loaders,
      renderer: config.renderer,
      alpha: config.renderer.alpha || config.environment.background === 'transparent',
      pluginManager,
      performance: config.performance
    });
    sdk.viewer.on?.('disposed', finishDisposal);
    pluginManager.setViewer(sdk.viewer);

    viewerRegistry.add(sdk);
    applyCssVariables(container, config.theme);
    config.features.disabled.forEach(featureId => sdk.setFeatureEnabled(featureId, false));
    applyUIConfig(container, config.uiConfig);

    if (shouldApplyInitialEnvironment(config.environment)) {
      await sdk.setEnvironment(config.environment);
    }

    await pluginManager.run('afterInit', sdk);
    applyClassAliases(container);

    if (!sdk._readyEmitted) {
      sdk._readyEmitted = true;
      const _tReady = typeof performance !== 'undefined' ? performance.now() : 0;
      config._timing = { initMs: Math.round(_tReady - _t0) };
      invokeLifecycleCallback(lifecycleCallbacks, 'onReady', {
        viewer: sdk,
        container
      }, userConfig);
    }

    if (config.model) {
      await sdk.loadModel(config.model);
    } else if (config.protectedAsset) {
      await sdk.loadProtectedAsset(config.protectedAsset);
    }

    return sdk;
  } catch (error) {
    if (sdk.viewer && !sdk._disposed) {
      sdk.protectedObjectUrls.forEach(url => URL.revokeObjectURL(url));
      sdk.protectedObjectUrls.clear();
      try { sdk.viewer.dispose?.(); } catch {}
      sdk.viewer = null;
      viewerRegistry.delete(sdk);
      pluginManager.destroy();
    }
    throw error;
  }
}

export function getVolareViewers() {
  return Array.from(viewerRegistry);
}
