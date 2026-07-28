import test from 'node:test';
import assert from 'node:assert/strict';
import { LightingManager } from '../SDK/Managers/LightingController.js';

function makeScene() {
  return {
    environment: null,
    background: null,
    backgroundIntensity: 0,
    environmentIntensity: 0,
    backgroundBlurriness: 0
  };
}

function makeRenderer() {
  return {
    setClearAlpha() {},
    isWebGPURenderer: false
  };
}

function makeManager() {
  const manager = Object.create(LightingManager.prototype);
  manager.scene = makeScene();
  manager.renderer = makeRenderer();
  manager.pmremGenerator = { dispose() {} };
  manager.hdrLoader = {};
  manager.currentEnvironmentMap = null;
  manager.currentEnvironmentUrl = null;
  manager.currentEnvironmentEntry = null;
  manager.isEnvironmentEnabled = true;
  manager.config = {
    enabled: true,
    hdri: null,
    preset: null,
    intensity: 1,
    background: 'current',
    backgroundColor: '#000000',
    backgroundBlur: 0.35,
    cacheSize: 2,
    fallback: null
  };
  manager.lastError = null;
  manager.disposedEnvironmentCount = 0;
  manager.environmentCache = new Map();
  manager.pendingEnvironmentLoads = new Map();
  manager.cacheSize = 2;
  manager._environmentLoadQueue = Promise.resolve();
  manager._environmentLoadSequence = 0;
  manager._disposed = false;
  manager._nextTextureId = 0;
  manager._testState = { loadCalls: new Map(), disposedRenderTargets: [] };
  manager.loadHDRI = async (url) => {
    manager._testState.loadCalls.set(url, (manager._testState.loadCalls.get(url) || 0) + 1);
    const texture = {
      id: `texture-${++manager._nextTextureId}`,
      disposeCalled: 0,
      dispose() { this.disposeCalled += 1; }
    };
    const renderTarget = {
      texture,
      disposeCalled: 0,
      dispose() {
        this.disposeCalled += 1;
        manager._testState.disposedRenderTargets.push(url);
      }
    };
    return { url, texture, renderTarget, lastUsedAt: Date.now() };
  };
  return manager;
}

test('reuses cached PMREM textures for repeated HDRI selections', async () => {
  const manager = makeManager();

  await manager.setEnvironment({ hdri: '/hdr/a.hdr' });
  await manager.setEnvironment({ hdri: '/hdr/b.hdr' });
  await manager.setEnvironment({ hdri: '/hdr/a.hdr' });

  assert.equal(manager._testState.loadCalls.get('/hdr/a.hdr'), 1);
  assert.equal(manager.currentEnvironmentUrl, '/hdr/a.hdr');
});

test('superseded HDRI loads never replace the latest requested environment', async () => {
  const manager = makeManager();
  let releaseFirst;
  let releaseSecond;
  manager.loadHDRI = (url) => new Promise(resolve => {
    const finish = () => resolve({
      url,
      texture: { dispose() {} },
      renderTarget: { texture: { dispose() {} }, dispose() {} },
      lastUsedAt: Date.now()
    });
    if (url.endsWith('slow.hdr')) releaseFirst = finish;
    if (url.endsWith('fast.hdr')) releaseSecond = finish;
  });

  const first = manager.setEnvironment({ hdri: '/hdr/slow.hdr' });
  const second = manager.setEnvironment({ hdri: '/hdr/fast.hdr' });

  await Promise.resolve();
  releaseFirst();
  await first;
  await Promise.resolve();
  releaseSecond();
  await second;

  assert.equal(manager.currentEnvironmentUrl, '/hdr/fast.hdr');
});

test('backgroundBlurStrength aliases backgroundBlur without changing environment lighting', async () => {
  const manager = makeManager();

  await manager.setEnvironment({
    hdri: '/hdr/blurred.hdr',
    background: 'blurred',
    backgroundBlurStrength: 0.6
  });

  assert.equal(manager.scene.backgroundBlurriness, 0.6);
  assert.equal(manager.scene.environment, manager.currentEnvironmentMap);
  assert.equal(manager.scene.background, manager.currentEnvironmentMap);
});

test('cache eviction disposes PMREM render targets instead of only textures', async () => {
  const manager = makeManager();

  await manager.setEnvironment({ hdri: '/hdr/a.hdr' });
  await manager.setEnvironment({ hdri: '/hdr/b.hdr' });
  await manager.setEnvironment({ hdri: '/hdr/c.hdr' });

  assert.deepEqual(manager._testState.disposedRenderTargets, ['/hdr/a.hdr']);
});

test('repeated HDRI switching keeps cache bounded and disposes evicted maps', async () => {
  const manager = makeManager();
  const urls = ['/hdr/a.hdr', '/hdr/b.hdr', '/hdr/c.hdr', '/hdr/d.hdr'];

  for (let i = 0; i < 20; i += 1) {
    await manager.setEnvironment({ hdri: urls[i % urls.length] });
  }

  assert.equal(manager.environmentCache.size <= manager.config.cacheSize, true);
  assert.equal(manager.disposedEnvironmentCount > 0, true);
});
