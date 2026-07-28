import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

let passed = 0;
let failed = 0;

async function test(label, fn) {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
    passed++;
  } catch (error) {
    console.error(`  FAIL  ${label}`);
    console.error(`        ${error?.stack || error}`);
    failed++;
  }
}

class MockElement {
  constructor(id = '') {
    this.id = id;
    this.nodeType = 1;
    this.style = {
      values: new Map(),
      setProperty(name, value) {
        this.values.set(name, value);
      }
    };
    this.dataset = {};
    this.hidden = false;
    this.children = [];
    this.classList = {
      add() {},
      remove() {},
      contains() { return false; }
    };
  }

  appendChild(child) {
    this.children.push(child);
  }

  contains(child) {
    return this.children.includes(child);
  }

  removeChild(child) {
    this.children = this.children.filter(item => item !== child);
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }
}

// Records what the factory forwards from environment.presets. The real
// implementation lives in LightingController and is covered separately; here we
// only care that the factory calls it, and that it never throws into init.
const registeredHdriPresets = [];
function MockRegisterHdriPresets(presets) {
  registeredHdriPresets.push(presets);
  return presets;
}

class MockPluginManager {
  constructor() {
    this.plugins = [];
    this.viewer = null;
    this.destroyed = false;
  }

  register(plugin) {
    this.plugins.push(plugin);
    return plugin;
  }

  setViewer(viewer) {
    this.viewer = viewer;
  }

  async run() {}

  getDiagnostics(diagnostics) {
    return diagnostics;
  }

  destroy() {
    this.destroyed = true;
  }
}

class MockVolareViewerInit {
  static loadModelImpl = async (source) => ({ name: `model:${source}` });
  static instances = [];

  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    this.isInitialized = true;
    this.currentModel = null;
    this.modelStats = null;
    this.disposed = false;
    this.handlers = new Map();
    MockVolareViewerInit.instances.push(this);
  }

  on(event, callback) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(callback);
  }

  emit(event, payload) {
    for (const callback of this.handlers.get(event) || []) callback(payload);
  }

  async loadModel(source) {
    const model = await MockVolareViewerInit.loadModelImpl(source);
    this.currentModel = model;
    this.modelStats = { meshCount: 1, triangleCount: 2 };
    return model;
  }

  async setEnvironment(environment) {
    return { environment };
  }

  getRendererDiagnostics() {
    return { backend: 'webgl' };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.emit('disposed');
  }
}

function installDom() {
  const elements = new Map();
  const documentElement = new MockElement('html');
  globalThis.HTMLElement = MockElement;
  globalThis.Element = MockElement;
  globalThis.location = { protocol: 'http:', hostname: 'localhost' };
  globalThis.document = {
    documentElement,
    body: new MockElement('body'),
    querySelector(selector) {
      if (selector?.startsWith('#')) return elements.get(selector.slice(1)) || null;
      return null;
    },
    querySelectorAll() {
      return [];
    },
    getElementById(id) {
      return elements.get(id) || null;
    },
    createElement(tagName) {
      return new MockElement(tagName);
    },
    _add(element) {
      elements.set(element.id, element);
      return element;
    }
  };
  globalThis.window = {
    CSS: { escape: value => value },
    setTimeout
  };
  globalThis.CSS = globalThis.window.CSS;
  return { elements, add: id => document._add(new MockElement(id)) };
}

function loadFactory() {
  // Every static import in the factory must be stripped here and supplied as an
  // injected argument below -- the source is evaluated via new Function(), which
  // cannot parse import statements.
  const source = readFileSync(resolve(root, 'SDK/Core/createVolareViewer.js'), 'utf8')
    .replace(/import \{ VolarePluginManager \} from '\.\/PluginHost\.js';\r?\n/, '')
    .replace(/import \{ VolareViewerInit \} from '\.\/VolareViewer\.js';\r?\n/, '')
    .replace(/import \{ registerHdriPresets \} from '\.\.\/Managers\/LightingController\.js';\r?\n/, '')
    .replace("export async function createVolareViewer", 'async function createVolareViewer')
    .replace("export function getVolareViewers", 'function getVolareViewers');

  const leftoverImport = source.match(/^\s*import\s.+$/m);
  if (leftoverImport) {
    throw new Error(
      `loadFactory: unstripped import in createVolareViewer.js -> ${leftoverImport[0].trim()}\n` +
      'Add a .replace() for it above and inject a mock argument.'
    );
  }

  return new Function(
    'VolarePluginManager',
    'VolareViewerInit',
    'registerHdriPresets',
    `${source}\nreturn { createVolareViewer, getVolareViewers };`
  )(MockPluginManager, MockVolareViewerInit, MockRegisterHdriPresets);
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

console.log('\n[Lifecycle callbacks]');

await test('existing initialization without callbacks still resolves', async () => {
  const dom = installDom();
  dom.add('viewer');
  const { createVolareViewer } = loadFactory();
  const sdk = await createVolareViewer({ container: '#viewer' });
  assert.equal(sdk.container.id, 'viewer');
  assert.equal(typeof sdk.loadModel, 'function');
});

await test('DeveloperMode false disables Volare from the startup snapshot only', async () => {
  const dom = installDom();
  const container = dom.add('viewer');
  const beforeInstances = MockVolareViewerInit.instances.length;
  let loadCalls = 0;
  MockVolareViewerInit.loadModelImpl = async (source) => {
    loadCalls++;
    return { name: `model:${source}` };
  };
  const { createVolareViewer } = loadFactory();
  const sdk = await createVolareViewer({
    container: '#viewer',
    model: '/blocked.glb',
    DeveloperMode: false
  });

  assert.equal(sdk.disabled, true);
  assert.equal(sdk.developerModeAllowed, false);
  assert.equal(sdk.viewer, null);
  assert.equal(container.style.display, 'none');
  assert.equal(MockVolareViewerInit.instances.length, beforeInstances);
  assert.equal(loadCalls, 0);

  sdk.config.DeveloperMode = true;
  sdk.config.developerMode.allowed = true;
  await assert.rejects(() => sdk.loadModel('/still-blocked.glb'), /DeveloperMode was false/);
  assert.equal(loadCalls, 0);

  MockVolareViewerInit.loadModelImpl = async (source) => ({ name: `model:${source}` });
});

await test('onReady fires exactly once before initial model load', async () => {
  const dom = installDom();
  dom.add('viewer');
  const order = [];
  const { createVolareViewer } = loadFactory();
  await createVolareViewer({
    container: '#viewer',
    model: '/model.glb',
    onReady({ viewer, container }) {
      assert.equal(viewer.container, container);
      order.push('ready');
    },
    onModelLoad() {
      order.push('load');
    }
  });
  assert.deepEqual(order, ['ready', 'load']);
});

await test('onModelLoad fires after successful load with safe payload', async () => {
  const dom = installDom();
  dom.add('viewer');
  let payload;
  const { createVolareViewer } = loadFactory();
  const sdk = await createVolareViewer({
    container: '#viewer',
    onModelLoad(event) {
      payload = event;
    }
  });
  const model = await sdk.loadModel('/ok.glb');
  assert.equal(payload.viewer, sdk);
  assert.equal(payload.model, model);
  assert.equal(payload.source, '/ok.glb');
  assert.deepEqual(payload.statistics, { meshCount: 1, triangleCount: 2 });
});

await test('onModelError fires and original error still propagates', async () => {
  const dom = installDom();
  dom.add('viewer');
  const original = new Error('load failed');
  MockVolareViewerInit.loadModelImpl = async () => { throw original; };
  const seen = [];
  const { createVolareViewer } = loadFactory();
  const sdk = await createVolareViewer({
    container: '#viewer',
    onModelError({ source, error }) {
      seen.push([source, error]);
      throw new Error('callback failed');
    }
  });
  await assert.rejects(() => sdk.loadModel('/bad.glb'), error => error === original);
  assert.equal(seen[0][0], '/bad.glb');
  assert.equal(seen[0][1], original);
  MockVolareViewerInit.loadModelImpl = async (source) => ({ name: `model:${source}` });
});

await test('onClose fires for SDK close only', async () => {
  const dom = installDom();
  dom.add('viewer');
  let count = 0;
  const { createVolareViewer } = loadFactory();
  const sdk = await createVolareViewer({
    container: '#viewer',
    onClose({ reason }) {
      count++;
      assert.equal(reason, 'api');
    }
  });
  sdk.viewer.closeTopmostOverlay?.();
  sdk.close();
  assert.equal(count, 1);
});

await test('tool-panel close does not trigger onClose', async () => {
  const dom = installDom();
  dom.add('viewer');
  let count = 0;
  const { createVolareViewer } = loadFactory();
  const sdk = await createVolareViewer({ container: '#viewer', onClose() { count++; } });
  sdk.viewer.emit('internalPanelClosed');
  assert.equal(count, 0);
});

await test('onDispose fires once after repeated disposal calls', async () => {
  const dom = installDom();
  dom.add('viewer');
  let count = 0;
  const { createVolareViewer } = loadFactory();
  const sdk = await createVolareViewer({ container: '#viewer', onDispose() { count++; } });
  sdk.dispose();
  sdk.dispose();
  sdk.destroy();
  assert.equal(count, 1);
});

await test('callback exceptions do not interrupt cleanup', async () => {
  const dom = installDom();
  dom.add('viewer');
  const { createVolareViewer } = loadFactory();
  const sdk = await createVolareViewer({
    container: '#viewer',
    onDispose() {
      throw new Error('cleanup observer failed');
    }
  });
  assert.doesNotThrow(() => sdk.dispose());
  assert.equal(sdk._disposed, true);
});

await test('async callback rejection is handled without unhandled rejection', async () => {
  const dom = installDom();
  dom.add('viewer');
  let unhandled = false;
  const onUnhandled = () => { unhandled = true; };
  process.once('unhandledRejection', onUnhandled);
  const { createVolareViewer } = loadFactory();
  await createVolareViewer({
    container: '#viewer',
    onReady: async () => { throw new Error('async failed'); }
  });
  await flushMicrotasks();
  process.removeListener('unhandledRejection', onUnhandled);
  assert.equal(unhandled, false);
});

await test('two viewer instances keep callbacks isolated', async () => {
  const dom = installDom();
  dom.add('one');
  dom.add('two');
  const seen = [];
  const { createVolareViewer } = loadFactory();
  const one = await createVolareViewer({ container: '#one', onClose: () => seen.push('one') });
  const two = await createVolareViewer({ container: '#two', onClose: () => seen.push('two') });
  one.close();
  two.close('user');
  assert.deepEqual(seen, ['one', 'two']);
});

await test('missing or invalid container gives clear errors', async () => {
  installDom();
  const { createVolareViewer } = loadFactory();
  await assert.rejects(() => createVolareViewer({}), /container option/);
  await assert.rejects(() => createVolareViewer({ container: '#missing' }), /selector did not resolve/);
  await assert.rejects(() => createVolareViewer({ container: 42 }), /selector string or HTMLElement/);
});

await test('non-function callback warns but does not crash', async () => {
  const dom = installDom();
  dom.add('viewer');
  const warnings = [];
  const warn = console.warn;
  console.warn = message => warnings.push(message);
  try {
    const { createVolareViewer } = loadFactory();
    await createVolareViewer({ container: '#viewer', onReady: true });
  } finally {
    console.warn = warn;
  }
  assert.match(warnings.join('\n'), /onReady/);
});

await test('unknown top-level option warns and is ignored', async () => {
  const dom = installDom();
  dom.add('viewer');
  const warnings = [];
  const warn = console.warn;
  console.warn = message => warnings.push(message);
  try {
    const { createVolareViewer } = loadFactory();
    const sdk = await createVolareViewer({ container: '#viewer', futureFeature: true });
    assert.equal(sdk.container.id, 'viewer');
  } finally {
    console.warn = warn;
  }
  assert.match(warnings.join('\n'), /futureFeature/);
});

await test('warnings do not contain protected-delivery secrets', async () => {
  const dom = installDom();
  dom.add('viewer');
  const warnings = [];
  const warn = console.warn;
  console.warn = message => warnings.push(message);
  try {
    const { createVolareViewer } = loadFactory();
    await createVolareViewer({
      container: '#viewer',
      model: '/ok.glb',
      unknown: 'secret-token-123',
      protectedAsset: {
        assetId: 'asset',
        clientId: 'client',
        licenseEndpoint: '/license?token=secret-token-123'
      }
    });
  } finally {
    console.warn = warn;
  }
  assert.doesNotMatch(warnings.join('\n'), /secret-token-123/);
});

await test('existing demo config objects remain accepted', async () => {
  const dom = installDom();
  dom.add('viewer');
  const { createVolareViewer } = loadFactory();
  await createVolareViewer({
    container: '#viewer',
    model: './Model/car.glb',
    ui: false,
    renderer: { preferredBackend: 'webgl', alpha: true },
    environment: {
      preset: 'studio-small-03',
      background: 'blurred',
      backgroundBlur: 0.4,
      intensity: 1.2
    },
    theme: {
      accent: '#ffffff',
      glass: true,
      cssVariables: { '--vlr-accent': '#fff' }
    },
    tools: {
      boundingVolumes: false,
      performance: false
    },
    features: { disabled: ['toggle-cross-section'] },
    diagnostics: true
  });
});

await test('SDK entry point exports createVolareViewer', async () => {
  const sdkEntry = readFileSync(resolve(root, 'SDK/Core/createVolareViewer.js'), 'utf8');
  assert.match(sdkEntry, /createVolareViewer/);
});

await test('environment.presets are registered before the viewer is built', async () => {
  const dom = installDom();
  dom.add('viewer');
  registeredHdriPresets.length = 0;
  const { createVolareViewer } = loadFactory();
  const presets = [{ id: 'custom-studio', label: 'Custom Studio', file: '/hdr/custom_4k.hdr' }];

  await createVolareViewer({ container: '#viewer', environment: { presets } });

  assert.equal(registeredHdriPresets.length, 1, 'registerHdriPresets should be called once');
  assert.deepEqual(registeredHdriPresets[0], presets);
});

await test('omitting environment.presets does not call the HDRI registry', async () => {
  const dom = installDom();
  dom.add('viewer');
  registeredHdriPresets.length = 0;
  const { createVolareViewer } = loadFactory();

  await createVolareViewer({ container: '#viewer' });

  assert.equal(registeredHdriPresets.length, 0);
});

console.log(`\n${'-'.repeat(50)}`);
console.log(`Lifecycle callback results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
