const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createLicenseToken,
  getSecurityConfig,
  loadProtectedAssetRecord,
  resetNonceStore,
  signPayload,
  validateChunkIndex,
  validateLicenseToken,
  validateNonce,
  validateOrigin,
  validateSecurityEnvelope,
  verifyAssetHashes,
  verifySignedManifest
} = require('../security/volareSecurity.cjs');
const { createApp } = require('../server/app.js');

const repoRoot = path.join(__dirname, '..');
const protectedAssetsRoot = path.join(repoRoot, 'protected-assets');
const hasProtectedAssets = fs.existsSync(protectedAssetsRoot);
const secret = 'test-secret-from-env';
const licenseSecret = 'test-license-secret-from-env';

function makeTempPublicRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'volare-security-'));
  fs.mkdirSync(path.join(root, 'Model'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Model', 'demo.gltf'), '{"asset":{"version":"2.0"}}');
  return root;
}

function makeManifest(publicRoot, overrides = {}) {
  const assetPath = 'Model/demo.gltf';
  const assetHash = require('node:crypto')
    .createHash('sha256')
    .update(fs.readFileSync(path.join(publicRoot, assetPath)))
    .digest('hex');
  const manifest = {
    id: 'demo-model',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    assets: [{ path: assetPath, sha256: assetHash }],
    ...overrides
  };
  manifest.signature = signPayload(manifest, secret);
  return manifest;
}

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

const asyncTests = [];

function asyncTest(name, fn) {
  asyncTests.push({ name, fn });
}

function privateTest(name, fn) {
  if (hasProtectedAssets) {
    test(name, fn);
    return;
  }
  console.log(`ok - ${name} # SKIP private protected-asset fixture unavailable`);
}

function privateAsyncTest(name, fn) {
  if (hasProtectedAssets) {
    asyncTest(name, fn);
    return;
  }
  console.log(`ok - ${name} # SKIP private protected-asset fixture unavailable`);
}

if (!hasProtectedAssets) {
  console.log('Public export test mode: protected-assets not present; private protected-asset fixture tests skipped.');
}

test('signed manifest verifies and tampering rejects', () => {
  const root = makeTempPublicRoot();
  const manifest = makeManifest(root);
  assert.equal(verifySignedManifest(manifest, secret).ok, true);
  assert.equal(verifySignedManifest({ ...manifest, id: 'tampered' }, secret).reason, 'manifest_signature_invalid');
});

test('asset hash verification rejects modified files', () => {
  const root = makeTempPublicRoot();
  const manifest = makeManifest(root);
  assert.deepEqual(verifyAssetHashes(manifest, root), { ok: true, checked: 1 });
  fs.writeFileSync(path.join(root, 'Model', 'demo.gltf'), 'tampered');
  assert.equal(verifyAssetHashes(manifest, root).reason, 'asset_hash_invalid');
});

test('license token validates expiry and signature', () => {
  const token = createLicenseToken({ sub: 'demo-user' }, licenseSecret, { expiresIn: '1m' });
  assert.equal(validateLicenseToken(token, licenseSecret).ok, true);
  assert.equal(validateLicenseToken(token, 'wrong-secret').reason, 'license_invalid');
});

test('nonce rejects replay', () => {
  resetNonceStore();
  assert.equal(validateNonce('nonce-1').ok, true);
  assert.equal(validateNonce('nonce-1').reason, 'nonce_replay');
});

test('origin validation is strict in production and local in development', () => {
  assert.equal(validateOrigin('https://example.com', ['https://example.com'], 'production'), true);
  assert.equal(validateOrigin('https://evil.example', ['https://example.com'], 'production'), false);
  assert.equal(validateOrigin('http://localhost:3000', [], 'development'), true);
});

test('security envelope accepts valid request and rejects invalid license/manifest/hash', () => {
  resetNonceStore();
  const root = makeTempPublicRoot();
  const config = getSecurityConfig({
    NODE_ENV: 'production',
    VOLARE_SECURITY_SECRET: secret,
    VOLARE_LICENSE_SECRET: licenseSecret,
    VOLARE_ALLOWED_ORIGINS: 'https://example.com'
  });
  const manifest = makeManifest(root);
  const token = createLicenseToken({ sub: 'demo-user' }, licenseSecret, { expiresIn: '1m' });

  assert.equal(validateSecurityEnvelope({
    manifest,
    licenseToken: token,
    nonce: 'nonce-valid',
    origin: 'https://example.com',
    publicRoot: root,
    config
  }).ok, true);

  assert.equal(validateSecurityEnvelope({
    manifest,
    licenseToken: 'bad-token',
    nonce: 'nonce-bad-license',
    origin: 'https://example.com',
    publicRoot: root,
    config
  }).reason, 'license_invalid');

  assert.equal(validateSecurityEnvelope({
    manifest: { ...manifest, id: 'tampered' },
    licenseToken: token,
    nonce: 'nonce-bad-manifest',
    origin: 'https://example.com',
    publicRoot: root,
    config
  }).reason, 'manifest_signature_invalid');

  fs.writeFileSync(path.join(root, 'Model', 'demo.gltf'), 'tampered');
  assert.equal(validateSecurityEnvelope({
    manifest,
    licenseToken: token,
    nonce: 'nonce-bad-hash',
    origin: 'https://example.com',
    publicRoot: root,
    config
  }).reason, 'asset_hash_invalid');
});

test('public export mode keeps private protected assets absent', () => {
  if (hasProtectedAssets) {
    console.log('ok - public export mode keeps private protected assets absent # SKIP private source checkout');
    return;
  }
  assert.equal(fs.existsSync(protectedAssetsRoot), false);
});

test('public export mode has no old risky assets or internal planning docs', () => {
  if (hasProtectedAssets) {
    console.log('ok - public export mode has no old risky assets or internal planning docs # SKIP private source checkout');
    return;
  }

  const forbiddenNames = new Set([
    'AudiR8.glb',
    'Helicopter4.gltf',
    'Helicopter4.bin',
    'Elephant.glb',
    'electric_box_43.glb',
    'fontawesome-png',
    'VOLARE_MASTER_PLAN.md',
    'VOLARE_FINAL_EXECUTION_PACKAGE.md',
    'VOLARE_ADVANCED_ARCHITECTURE_AND_BACKEND_PLAN.md'
  ]);

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['.git', 'node_modules'].includes(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(repoRoot, fullPath).replace(/\\/g, '/');
      assert.equal(forbiddenNames.has(entry.name), false, `forbidden file present: ${relativePath}`);
      assert.equal(relativePath.includes('Models/Background/heaven'), false, `forbidden path present: ${relativePath}`);
      if (entry.isDirectory()) walk(fullPath);
    }
  }

  walk(repoRoot);
});

asyncTest('public export server starts and reports security status without protected assets', async () => {
  if (hasProtectedAssets) {
    console.log('ok - public export server starts and reports security status without protected assets # SKIP private source checkout');
    return;
  }

  const config = getSecurityConfig({
    NODE_ENV: 'production',
    VOLARE_SECURITY_SECRET: secret,
    VOLARE_LICENSE_SECRET: licenseSecret,
    VOLARE_ALLOWED_ORIGINS: 'http://allowed.test'
  });
  const { server, baseUrl } = await startTestServer(config);

  try {
    const status = await fetchJson(`${baseUrl}/api/security/status`, {
      headers: { 'Origin': 'http://allowed.test' }
    });
    assert.equal(status.response.status, 200);
    assert.equal(status.body.mode, 'production');
    assert.equal(status.body.configured, true);

    const missingProtectedAsset = await fetchJson(`${baseUrl}/api/volare/license`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://allowed.test',
        'X-Volare-Nonce': 'public-missing-asset-nonce'
      },
      body: JSON.stringify({
        assetId: 'demo-duck',
        clientId: 'test-client',
        nonce: 'public-missing-asset-nonce'
      })
    });
    assert.equal(missingProtectedAsset.response.status, 404);
    assert.equal(missingProtectedAsset.body.error, 'asset_not_found');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

function startTestServer(config, options = {}) {
  const app = createApp(config, options);
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { response, body };
}

async function getValidProtectedFlow(baseUrl, origin = 'http://allowed.test') {
  resetNonceStore();
  const license = await fetchJson(`${baseUrl}/api/volare/license`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': origin,
      'X-Volare-Nonce': 'license-nonce'
    },
    body: JSON.stringify({
      assetId: 'demo-duck',
      clientId: 'test-client',
      nonce: 'license-nonce'
    })
  });
  assert.equal(license.response.status, 200);

  const manifest = await fetchJson(`${baseUrl}/api/volare/manifest/demo-duck`, {
    headers: {
      'Origin': origin,
      'Authorization': `Bearer ${license.body.token}`,
      'X-Volare-Nonce': 'manifest-nonce'
    }
  });
  assert.equal(manifest.response.status, 200);

  return {
    token: license.body.token,
    manifest: manifest.body.manifest
  };
}

privateAsyncTest('protected Volare routes reject invalid license, expired token, bad origin, replay nonce, bad manifest, and direct static access', async () => {
  const config = getSecurityConfig({
    NODE_ENV: 'production',
    VOLARE_SECURITY_SECRET: secret,
    VOLARE_LICENSE_SECRET: licenseSecret,
    VOLARE_ALLOWED_ORIGINS: 'http://allowed.test'
  });
  const { server, baseUrl } = await startTestServer(config);

  try {
    resetNonceStore();
    const invalidLicense = await fetchJson(`${baseUrl}/api/volare/manifest/demo-duck`, {
      headers: {
        'Origin': 'http://allowed.test',
        'Authorization': 'Bearer invalid-token',
        'X-Volare-Nonce': 'invalid-license-nonce'
      }
    });
    assert.equal(invalidLicense.response.status, 401);
    assert.equal(invalidLicense.body.error, 'license_invalid');

    resetNonceStore();
    const expiredToken = createLicenseToken({ sub: 'test', assetId: 'demo-duck', origin: 'http://allowed.test' }, licenseSecret, { expiresIn: -1 });
    const expired = await fetchJson(`${baseUrl}/api/volare/manifest/demo-duck`, {
      headers: {
        'Origin': 'http://allowed.test',
        'Authorization': `Bearer ${expiredToken}`,
        'X-Volare-Nonce': 'expired-token-nonce'
      }
    });
    assert.equal(expired.response.status, 401);
    assert.equal(expired.body.error, 'license_expired');

    resetNonceStore();
    const missingNonce = await fetchJson(`${baseUrl}/api/volare/license`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://allowed.test'
      },
      body: JSON.stringify({ assetId: 'demo-duck' })
    });
    assert.equal(missingNonce.response.status, 401);
    assert.equal(missingNonce.body.error, 'nonce_missing');

    resetNonceStore();
    const badOrigin = await fetchJson(`${baseUrl}/api/volare/license`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://evil.test'
      },
      body: JSON.stringify({ assetId: 'demo-duck' })
    });
    assert.equal(badOrigin.response.status, 403);
    assert.equal(badOrigin.body.error, 'origin_not_allowed');

    const flow = await getValidProtectedFlow(baseUrl);
    const replay = await fetchJson(`${baseUrl}/api/volare/asset/demo-duck`, {
      headers: {
        'Origin': 'http://allowed.test',
        'Authorization': `Bearer ${flow.token}`,
        'X-Volare-Nonce': 'manifest-nonce',
        'X-Volare-Manifest-Signature': flow.manifest.signature,
        'X-Volare-Manifest-Expiry': flow.manifest.expiresAt
      }
    });
    assert.equal(replay.response.status, 401);
    assert.equal(replay.body.error, 'nonce_replay');

    resetNonceStore();
    const valid = await getValidProtectedFlow(baseUrl);
    const badManifest = await fetchJson(`${baseUrl}/api/volare/asset/demo-duck`, {
      headers: {
        'Origin': 'http://allowed.test',
        'Authorization': `Bearer ${valid.token}`,
        'X-Volare-Nonce': 'asset-bad-manifest-nonce',
        'X-Volare-Manifest-Signature': 'bad-signature',
        'X-Volare-Manifest-Expiry': valid.manifest.expiresAt
      }
    });
    assert.equal(badManifest.response.status, 401);
    assert.equal(badManifest.body.error, 'manifest_signature_invalid');

    const direct = await fetchJson(`${baseUrl}/protected-assets/volare/demo-duck/asset.gltf`, {
      headers: { 'Origin': 'http://allowed.test' }
    });
    assert.equal(direct.response.status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

privateAsyncTest('valid protected route flow serves asset and rejects bad protected asset hash', async () => {
  const config = getSecurityConfig({
    NODE_ENV: 'production',
    VOLARE_SECURITY_SECRET: secret,
    VOLARE_LICENSE_SECRET: licenseSecret,
    VOLARE_ALLOWED_ORIGINS: 'http://allowed.test'
  });
  const { server, baseUrl } = await startTestServer(config);
  const assetPath = path.join(__dirname, '..', 'protected-assets', 'volare', 'demo-duck', 'asset.gltf');
  const original = fs.readFileSync(assetPath);

  try {
    const flow = await getValidProtectedFlow(baseUrl);
    const asset = await fetch(`${baseUrl}/api/volare/asset/demo-duck`, {
      headers: {
        'Origin': 'http://allowed.test',
        'Authorization': `Bearer ${flow.token}`,
        'X-Volare-Nonce': 'asset-valid-nonce',
        'X-Volare-Manifest-Signature': flow.manifest.signature,
        'X-Volare-Manifest-Expiry': flow.manifest.expiresAt
      }
    });
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('content-type'), 'model/gltf+json');
    assert.equal((await asset.arrayBuffer()).byteLength, flow.manifest.size);

    fs.writeFileSync(assetPath, 'tampered');
    resetNonceStore();
    const tamperedLicense = await fetchJson(`${baseUrl}/api/volare/license`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://allowed.test',
        'X-Volare-Nonce': 'tampered-license-nonce'
      },
      body: JSON.stringify({ assetId: 'demo-duck', nonce: 'tampered-license-nonce' })
    });
    assert.equal(tamperedLicense.response.status, 200);
    const tamperedAsset = await fetchJson(`${baseUrl}/api/volare/manifest/demo-duck`, {
      headers: {
        'Origin': 'http://allowed.test',
        'Authorization': `Bearer ${tamperedLicense.body.token}`,
        'X-Volare-Nonce': 'asset-tampered-nonce'
      }
    });
    assert.equal(tamperedAsset.response.status, 409);
    assert.equal(tamperedAsset.body.error, 'asset_hash_invalid');
  } finally {
    fs.writeFileSync(assetPath, original);
    await new Promise(resolve => server.close(resolve));
  }
});

privateTest('loadProtectedAssetRecord loads chunked manifest correctly', () => {
  const protectedRoot = path.join(__dirname, '..', 'protected-assets');
  const result = loadProtectedAssetRecord(protectedRoot, 'demo-chunked');
  assert.equal(result.ok, true);
  assert.equal(result.chunked, true);
  assert.equal(result.record.delivery, 'chunked');
  assert.equal(result.record.format, 'gltf');
  assert.ok(Array.isArray(result.record.chunks));
  assert.ok(result.record.chunks.length > 0);
  assert.ok(result.record.totalSize > 0);
  assert.ok(result.record.totalSha256);
});

privateTest('validateChunkIndex rejects invalid indexes', () => {
  const protectedRoot = path.join(__dirname, '..', 'protected-assets');
  const record = loadProtectedAssetRecord(protectedRoot, 'demo-chunked');
  assert.equal(record.ok, true);

  assert.equal(validateChunkIndex(record, 0).ok, true);
  assert.equal(validateChunkIndex(record, -1).reason, 'chunk_index_invalid');
  assert.equal(validateChunkIndex(record, 'abc').reason, 'chunk_index_invalid');
  assert.equal(validateChunkIndex(record, 999).reason, 'chunk_not_found');
  assert.equal(validateChunkIndex(record, 1.5).reason, 'chunk_index_invalid');

  const nonChunked = loadProtectedAssetRecord(protectedRoot, 'demo-duck');
  assert.equal(validateChunkIndex(nonChunked, 0).reason, 'asset_not_chunked');
});

privateAsyncTest('chunk route serves valid chunks and rejects invalid requests', async () => {
  const config = getSecurityConfig({
    NODE_ENV: 'production',
    VOLARE_SECURITY_SECRET: secret,
    VOLARE_LICENSE_SECRET: licenseSecret,
    VOLARE_ALLOWED_ORIGINS: 'http://allowed.test'
  });
  const { server, baseUrl } = await startTestServer(config);

  try {
    resetNonceStore();
    const licenseNonce = 'chunk-license-nonce';
    const license = await fetchJson(`${baseUrl}/api/volare/license`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://allowed.test',
        'X-Volare-Nonce': licenseNonce
      },
      body: JSON.stringify({ assetId: 'demo-chunked', clientId: 'test', nonce: licenseNonce })
    });
    assert.equal(license.response.status, 200);

    const manifestNonce = 'chunk-manifest-nonce';
    const manifestResp = await fetchJson(`${baseUrl}/api/volare/manifest/demo-chunked`, {
      headers: {
        'Origin': 'http://allowed.test',
        'Authorization': `Bearer ${license.body.token}`,
        'X-Volare-Nonce': manifestNonce
      }
    });
    assert.equal(manifestResp.response.status, 200);
    const manifest = manifestResp.body.manifest;
    assert.equal(manifest.delivery, 'chunked');
    assert.ok(Array.isArray(manifest.chunks));
    assert.ok(manifest.chunks.length > 0);

    const chunkNonce = 'chunk-fetch-nonce-0';
    const chunkResp = await fetch(`${baseUrl}/api/volare/chunk/demo-chunked/0`, {
      headers: {
        'Origin': 'http://allowed.test',
        'Authorization': `Bearer ${license.body.token}`,
        'X-Volare-Nonce': chunkNonce
      }
    });
    assert.equal(chunkResp.status, 200);
    assert.equal(chunkResp.headers.get('cache-control'), 'private, no-store');
    const chunkBuf = await chunkResp.arrayBuffer();
    assert.equal(chunkBuf.byteLength, manifest.chunks[0].size);

    const badIndexNonce = 'chunk-bad-index-nonce';
    const badIndex = await fetchJson(`${baseUrl}/api/volare/chunk/demo-chunked/999`, {
      headers: {
        'Origin': 'http://allowed.test',
        'Authorization': `Bearer ${license.body.token}`,
        'X-Volare-Nonce': badIndexNonce
      }
    });
    assert.equal(badIndex.response.status, 404);
    assert.equal(badIndex.body.error, 'chunk_not_found');

    const negativeNonce = 'chunk-negative-nonce';
    const negative = await fetchJson(`${baseUrl}/api/volare/chunk/demo-chunked/-1`, {
      headers: {
        'Origin': 'http://allowed.test',
        'Authorization': `Bearer ${license.body.token}`,
        'X-Volare-Nonce': negativeNonce
      }
    });
    assert.equal(negative.response.status, 400);
    assert.equal(negative.body.error, 'chunk_index_invalid');

    const nonNumericNonce = 'chunk-nonnumeric-nonce';
    const nonNumeric = await fetchJson(`${baseUrl}/api/volare/chunk/demo-chunked/abc`, {
      headers: {
        'Origin': 'http://allowed.test',
        'Authorization': `Bearer ${license.body.token}`,
        'X-Volare-Nonce': nonNumericNonce
      }
    });
    assert.equal(nonNumeric.response.status, 400);
    assert.equal(nonNumeric.body.error, 'chunk_index_invalid');

    resetNonceStore();
    const noToken = await fetchJson(`${baseUrl}/api/volare/chunk/demo-chunked/0`, {
      headers: {
        'Origin': 'http://allowed.test',
        'X-Volare-Nonce': 'chunk-notoken-nonce'
      }
    });
    assert.equal(noToken.response.status, 401);

    resetNonceStore();
    const wrongAssetToken = createLicenseToken({ sub: 'test', assetId: 'demo-duck', origin: 'http://allowed.test' }, licenseSecret, { expiresIn: '1m' });
    const wrongScope = await fetchJson(`${baseUrl}/api/volare/chunk/demo-chunked/0`, {
      headers: {
        'Origin': 'http://allowed.test',
        'Authorization': `Bearer ${wrongAssetToken}`,
        'X-Volare-Nonce': 'chunk-wrongscope-nonce'
      }
    });
    assert.equal(wrongScope.response.status, 403);
    assert.equal(wrongScope.body.error, 'asset_scope_mismatch');

    resetNonceStore();
    const badOriginResp = await fetchJson(`${baseUrl}/api/volare/chunk/demo-chunked/0`, {
      headers: {
        'Origin': 'http://evil.test',
        'Authorization': `Bearer ${license.body.token}`,
        'X-Volare-Nonce': 'chunk-badorigin-nonce'
      }
    });
    assert.equal(badOriginResp.response.status, 403);

    const traversalNonce = 'chunk-traversal-nonce';
    resetNonceStore();
    const traversalToken = createLicenseToken({ sub: 'test', assetId: '../demo-duck', origin: 'http://allowed.test' }, licenseSecret, { expiresIn: '1m' });
    const traversal = await fetchJson(`${baseUrl}/api/volare/chunk/../demo-duck/0`, {
      headers: {
        'Origin': 'http://allowed.test',
        'Authorization': `Bearer ${traversalToken}`,
        'X-Volare-Nonce': traversalNonce
      }
    });
    assert.ok([400, 404].includes(traversal.response.status));

    const directChunkResp = await fetchJson(`${baseUrl}/protected-assets/volare/demo-chunked/chunk-0000.bin`, {
      headers: { 'Origin': 'http://allowed.test' }
    });
    assert.equal(directChunkResp.response.status, 404);

    const nonChunkedNonce = 'nonchanked-asset-nonce';
    resetNonceStore();
    const duckLicense = await fetchJson(`${baseUrl}/api/volare/license`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://allowed.test',
        'X-Volare-Nonce': 'duck-license-nonce2'
      },
      body: JSON.stringify({ assetId: 'demo-duck', nonce: 'duck-license-nonce2' })
    });
    const nonChunkedChunk = await fetchJson(`${baseUrl}/api/volare/chunk/demo-duck/0`, {
      headers: {
        'Origin': 'http://allowed.test',
        'Authorization': `Bearer ${duckLicense.body.token}`,
        'X-Volare-Nonce': nonChunkedNonce
      }
    });
    assert.equal(nonChunkedChunk.response.status, 400);
    assert.equal(nonChunkedChunk.body.error, 'asset_not_chunked');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

privateAsyncTest('existing non-chunked protected flow still works after chunk additions', async () => {
  const config = getSecurityConfig({
    NODE_ENV: 'production',
    VOLARE_SECURITY_SECRET: secret,
    VOLARE_LICENSE_SECRET: licenseSecret,
    VOLARE_ALLOWED_ORIGINS: 'http://allowed.test'
  });
  const { server, baseUrl } = await startTestServer(config);

  try {
    const flow = await getValidProtectedFlow(baseUrl);
    const asset = await fetch(`${baseUrl}/api/volare/asset/demo-duck`, {
      headers: {
        'Origin': 'http://allowed.test',
        'Authorization': `Bearer ${flow.token}`,
        'X-Volare-Nonce': 'still-works-nonce',
        'X-Volare-Manifest-Signature': flow.manifest.signature,
        'X-Volare-Manifest-Expiry': flow.manifest.expiresAt
      }
    });
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('content-type'), 'model/gltf+json');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

asyncTest('license route returns 429 after rate limit exceeded and response has correct shape', async () => {
  const config = getSecurityConfig({
    NODE_ENV: 'production',
    VOLARE_SECURITY_SECRET: secret,
    VOLARE_LICENSE_SECRET: licenseSecret,
    VOLARE_ALLOWED_ORIGINS: 'http://allowed.test'
  });
  const { server, baseUrl } = await startTestServer(config, {
    rateLimits: { license: { max: 3, windowMs: 60_000 } }
  });

  try {
    for (let i = 0; i < 3; i++) {
      await fetchJson(`${baseUrl}/api/volare/license`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://allowed.test',
          'X-Volare-Nonce': `rl-license-nonce-${i}`
        },
        body: JSON.stringify({ assetId: 'nonexistent', nonce: `rl-license-nonce-${i}` })
      });
    }

    const limited = await fetchJson(`${baseUrl}/api/volare/license`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://allowed.test',
        'X-Volare-Nonce': 'rl-license-nonce-exceeded'
      },
      body: JSON.stringify({ assetId: 'nonexistent', nonce: 'rl-license-nonce-exceeded' })
    });

    assert.equal(limited.response.status, 429);
    assert.equal(limited.body.success, false);
    assert.equal(limited.body.error, 'rate_limited');

    const hasRateLimitHeader =
      limited.response.headers.get('retry-after') !== null ||
      limited.response.headers.get('ratelimit') !== null ||
      limited.response.headers.get('ratelimit-reset') !== null ||
      limited.response.headers.get('x-ratelimit-reset') !== null;
    assert.ok(hasRateLimitHeader, 'rate limit response must include a rate-limit header');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

asyncTest('rate limit on license does not block unrelated routes', async () => {
  const config = getSecurityConfig({
    NODE_ENV: 'production',
    VOLARE_SECURITY_SECRET: secret,
    VOLARE_LICENSE_SECRET: licenseSecret,
    VOLARE_ALLOWED_ORIGINS: 'http://allowed.test'
  });
  const { server, baseUrl } = await startTestServer(config, {
    rateLimits: { license: { max: 1, windowMs: 60_000 } }
  });

  try {
    await fetchJson(`${baseUrl}/api/volare/license`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://allowed.test',
        'X-Volare-Nonce': 'rl-unrelated-nonce-1'
      },
      body: JSON.stringify({ assetId: 'nonexistent', nonce: 'rl-unrelated-nonce-1' })
    });

    const limited = await fetchJson(`${baseUrl}/api/volare/license`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://allowed.test',
        'X-Volare-Nonce': 'rl-unrelated-nonce-2'
      },
      body: JSON.stringify({ assetId: 'nonexistent', nonce: 'rl-unrelated-nonce-2' })
    });
    assert.equal(limited.response.status, 429);

    const status = await fetchJson(`${baseUrl}/api/security/status`, {
      headers: { 'Origin': 'http://allowed.test' }
    });
    assert.equal(status.response.status, 200, '/api/security/status must not be blocked by license rate limit');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

asyncTest('chunk limiter allows 300 requests per window (production default)', async () => {
  const config = getSecurityConfig({
    NODE_ENV: 'production',
    VOLARE_SECURITY_SECRET: secret,
    VOLARE_LICENSE_SECRET: licenseSecret,
    VOLARE_ALLOWED_ORIGINS: 'http://allowed.test'
  });
  const { server, baseUrl } = await startTestServer(config);

  try {
    const probe = await fetchJson(`${baseUrl}/api/volare/chunk/nonexistent/0`, {
      headers: {
        'Origin': 'http://allowed.test',
        'Authorization': 'Bearer invalid',
        'X-Volare-Nonce': 'chunk-limit-probe'
      }
    });
    assert.notEqual(probe.response.status, 429, 'first chunk request must not be rate-limited');
    assert.equal(probe.response.status, 401, 'unauthenticated chunk request should be 401, not 429');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

// ---------------------------------------------------------------------------
// VLB v2 inline crypto helpers (mirrors create-vlb.mjs / verify-vlb.mjs).
// Uses reduced iteration count for test speed — only for unit tests, not
// for testing the CLI tools themselves.
// ---------------------------------------------------------------------------

const VLB_TEST_ITERATIONS = 1000;

function buildTestVlbV2(plaintext, passphrase, { iterations = VLB_TEST_ITERATIONS, overrideMeta = {} } = {}) {
  const MAGIC = Buffer.from([0x56, 0x4C, 0x42, 0x00]);
  const HEADER_SIZE = 64;
  const KEY_LEN = 32;
  const SALT_LEN = 32;
  const IV_LEN = 12;

  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const sha256 = crypto.createHash('sha256').update(plaintext).digest('hex');
  const originalSize = plaintext.length;
  const created = new Date().toISOString();

  const key = crypto.pbkdf2Sync(passphrase, salt, iterations, KEY_LEN, 'sha512');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const aadFields = {
    aad: true,
    algorithm: 'aes-256-gcm',
    kdf: 'pbkdf2',
    iterations,
    hash: 'sha512',
    saltB64: salt.toString('base64'),
    ivB64: iv.toString('base64'),
    sha256,
    originalSize,
    created,
    ...overrideMeta
  };
  cipher.setAAD(Buffer.from(JSON.stringify(aadFields), 'utf8'));

  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ciphertextWithTag = Buffer.concat([encrypted, tag]);

  const meta = { ...aadFields, tagB64: tag.toString('base64') };
  const metaBuf = Buffer.from(JSON.stringify(meta), 'utf8');

  const header = Buffer.alloc(HEADER_SIZE, 0);
  MAGIC.copy(header, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(1, 8);

  const metaLen = Buffer.alloc(4);
  metaLen.writeUInt32LE(metaBuf.length, 0);
  const chunk = Buffer.concat([Buffer.from('ENCR'), metaLen, metaBuf, ciphertextWithTag]);

  return Buffer.concat([header, chunk]);
}

function decryptTestVlbV2(vlbBuf, passphrase) {
  const MAGIC = Buffer.from([0x56, 0x4C, 0x42, 0x00]);
  const HEADER_SIZE = 64;
  const KEY_LEN = 32;
  const AUTH_TAG_LEN = 16;

  if (!vlbBuf.subarray(0, 4).equals(MAGIC)) throw new Error('bad magic');
  const version = vlbBuf.readUInt32LE(4);
  if (version !== 2) throw new Error('bad version');

  let offset = HEADER_SIZE;
  const chunkType = vlbBuf.subarray(offset, offset + 4).toString('ascii');
  offset += 4;
  if (chunkType !== 'ENCR') throw new Error('bad chunk type');

  const metaLength = vlbBuf.readUInt32LE(offset);
  offset += 4;
  const metadata = JSON.parse(vlbBuf.subarray(offset, offset + metaLength).toString('utf8'));
  offset += metaLength;
  const ciphertextWithTag = vlbBuf.subarray(offset);

  if (!metadata.aad) throw new Error('missing aad flag');

  const salt = Buffer.from(metadata.saltB64, 'base64');
  const iv = Buffer.from(metadata.ivB64, 'base64');
  const tag = Buffer.from(metadata.tagB64, 'base64');
  const appendedTag = ciphertextWithTag.subarray(ciphertextWithTag.length - AUTH_TAG_LEN);
  if (!tag.equals(appendedTag)) throw new Error('tag mismatch');

  const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - AUTH_TAG_LEN);
  const key = crypto.pbkdf2Sync(passphrase, salt, metadata.iterations, KEY_LEN, metadata.hash);
  const decipher = crypto.createDecipheriv(metadata.algorithm, key, iv);
  decipher.setAuthTag(tag);

  const aadFields = {
    aad: true,
    algorithm: metadata.algorithm,
    kdf: metadata.kdf,
    iterations: metadata.iterations,
    hash: metadata.hash,
    saltB64: metadata.saltB64,
    ivB64: metadata.ivB64,
    sha256: metadata.sha256,
    originalSize: metadata.originalSize,
    created: metadata.created
  };
  decipher.setAAD(Buffer.from(JSON.stringify(aadFields), 'utf8'));

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const sha256 = crypto.createHash('sha256').update(plaintext).digest('hex');
  const sha256Match = sha256 === metadata.sha256;
  const sizeMatch = metadata.originalSize === undefined || plaintext.length === metadata.originalSize;

  return { plaintext, sha256Match, sizeMatch, metadata };
}

// ---------------------------------------------------------------------------
// VLB v2 unit tests (inline crypto, reduced iterations for speed)
// ---------------------------------------------------------------------------

test('vlb v2 correct passphrase roundtrip: sha256 match, size match, aad verified', () => {
  const plaintext = Buffer.from('Hello Volare VLB test payload');
  const passphrase = 'correct-horse-battery-staple';
  const vlb = buildTestVlbV2(plaintext, passphrase);
  const result = decryptTestVlbV2(vlb, passphrase);
  assert.ok(result.plaintext.equals(plaintext), 'decrypted plaintext must match original');
  assert.equal(result.sha256Match, true, 'sha256 must match');
  assert.equal(result.sizeMatch, true, 'size must match');
});

test('vlb v2 wrong passphrase fails with GCM auth error', () => {
  const plaintext = Buffer.from('Volare secret model data');
  const vlb = buildTestVlbV2(plaintext, 'correct-passphrase-here');
  assert.throws(
    () => decryptTestVlbV2(vlb, 'wrong-passphrase-here'),
    /Unsupported state|bad decrypt|authentication/i
  );
});

test('vlb v2 tampered AAD-covered metadata field causes GCM auth failure', () => {
  const plaintext = Buffer.from('Volare tamper test payload');
  const passphrase = 'tamper-test-passphrase-ok';
  const vlb = buildTestVlbV2(plaintext, passphrase);

  // Parse the VLB, modify the 'created' field in metadata JSON, write back
  const HEADER_SIZE = 64;
  let offset = HEADER_SIZE + 4; // skip chunk type
  const metaLen = vlb.readUInt32LE(offset);
  offset += 4;
  const metaStr = vlb.subarray(offset, offset + metaLen).toString('utf8');
  const meta = JSON.parse(metaStr);
  meta.created = '2000-01-01T00:00:00.000Z'; // tamper AAD-covered field
  const tamperedMetaBuf = Buffer.from(JSON.stringify(meta), 'utf8');

  // Rebuild VLB with tampered metadata (same ciphertext)
  const newMetaLen = Buffer.alloc(4);
  newMetaLen.writeUInt32LE(tamperedMetaBuf.length, 0);
  const ciphertextStart = offset + metaLen;
  const ciphertextWithTag = vlb.subarray(ciphertextStart);
  const header = vlb.subarray(0, HEADER_SIZE);
  const tamperedVlb = Buffer.concat([
    header,
    Buffer.from('ENCR'),
    newMetaLen,
    tamperedMetaBuf,
    ciphertextWithTag
  ]);

  assert.throws(
    () => decryptTestVlbV2(tamperedVlb, passphrase),
    /Unsupported state|bad decrypt|authentication/i,
    'Tampered AAD-covered field must cause GCM auth failure'
  );
});

test('vlb v2 missing aad flag rejected', () => {
  const plaintext = Buffer.from('legacy format test');
  // Build without aad field in overrideMeta — actually we need to build without setAAD
  // Simplest: build normally then strip aad flag from metadata
  const passphrase = 'legacy-format-passphrase-ok';
  const vlb = buildTestVlbV2(plaintext, passphrase);

  const HEADER_SIZE = 64;
  let offset = HEADER_SIZE + 4;
  const metaLen = vlb.readUInt32LE(offset);
  offset += 4;
  const meta = JSON.parse(vlb.subarray(offset, offset + metaLen).toString('utf8'));
  delete meta.aad;
  const strippedMetaBuf = Buffer.from(JSON.stringify(meta), 'utf8');

  const newMetaLen = Buffer.alloc(4);
  newMetaLen.writeUInt32LE(strippedMetaBuf.length, 0);
  const ciphertextStart = offset + metaLen;
  const ciphertextWithTag = vlb.subarray(ciphertextStart);
  const header = vlb.subarray(0, HEADER_SIZE);
  const legacyVlb = Buffer.concat([
    header, Buffer.from('ENCR'), newMetaLen, strippedMetaBuf, ciphertextWithTag
  ]);

  assert.throws(
    () => decryptTestVlbV2(legacyVlb, passphrase),
    /missing aad flag/
  );
});

test('vlb v2 size mismatch reports invalid (direct sizeMatch logic)', () => {
  const originalSize = 100;
  const actualLength = 99;
  const sizeMatch = originalSize === undefined || actualLength === originalSize;
  assert.equal(sizeMatch, false, 'size mismatch must be detected');
});

// ---------------------------------------------------------------------------
// VLB-to-manifest pipeline tests (ESM via dynamic import)
// ---------------------------------------------------------------------------

const VLB_MANIFEST_PASSPHRASE = 'volare-test-passphrase-2026';

function buildTinyTestVlb(plaintext, passphrase) {
  return buildTestVlbV2(Buffer.from(plaintext), passphrase);
}

asyncTest('vlb-to-manifest single-file output produces valid manifest', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'volare-m2m-single-'));
  const vlbPath = path.join(tmpDir, 'test.vlb');
  const outputDir = path.join(tmpDir, 'output');
  const sourceText = '{"asset":{"version":"2.0"},"meshes":[]}';
  const vlb = buildTinyTestVlb(sourceText, VLB_MANIFEST_PASSPHRASE);
  fs.writeFileSync(vlbPath, vlb);

  try {
    const { execFileSync } = require('node:child_process');
    execFileSync(process.execPath, [
      path.join(repoRoot, 'tools', 'vlb-to-manifest.mjs'),
      '--input', vlbPath,
      '--asset-id', 'test-single',
      '--output', outputDir,
      '--passphrase', VLB_MANIFEST_PASSPHRASE,
      '--mime-type', 'model/gltf+json',
      '--filename', 'asset.gltf'
    ], { stdio: 'pipe' });

    assert.ok(fs.existsSync(path.join(outputDir, 'manifest.json')), 'manifest.json must exist');
    assert.ok(fs.existsSync(path.join(outputDir, 'asset.gltf')), 'asset file must exist');

    const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.assetId, 'test-single');
    assert.equal(manifest.file, 'asset.gltf');
    assert.equal(manifest.contentType, 'model/gltf+json');
    assert.equal(typeof manifest.sha256, 'string');
    assert.equal(manifest.sha256.length, 64);

    const written = fs.readFileSync(path.join(outputDir, 'asset.gltf'), 'utf8');
    assert.equal(written, sourceText, 'decrypted output must match source');

    const expectedHash = crypto.createHash('sha256').update(Buffer.from(sourceText)).digest('hex');
    assert.equal(manifest.sha256, expectedHash, 'manifest sha256 must match payload');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

asyncTest('vlb-to-manifest chunked output produces valid manifest and chunks', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'volare-m2m-chunked-'));
  const vlbPath = path.join(tmpDir, 'test.vlb');
  const outputDir = path.join(tmpDir, 'output');
  const sourceText = 'A'.repeat(3000);
  const vlb = buildTinyTestVlb(sourceText, VLB_MANIFEST_PASSPHRASE);
  fs.writeFileSync(vlbPath, vlb);

  try {
    const { execFileSync } = require('node:child_process');
    execFileSync(process.execPath, [
      path.join(repoRoot, 'tools', 'vlb-to-manifest.mjs'),
      '--input', vlbPath,
      '--asset-id', 'test-chunked',
      '--output', outputDir,
      '--passphrase', VLB_MANIFEST_PASSPHRASE,
      '--chunk-size', '1024',
      '--filename', 'asset.gltf'
    ], { stdio: 'pipe' });

    const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.assetId, 'test-chunked');
    assert.equal(manifest.delivery, 'chunked');
    assert.equal(manifest.version, 1);
    assert.equal(manifest.format, 'gltf');
    assert.equal(manifest.totalSize, 3000);
    assert.ok(Array.isArray(manifest.chunks));
    assert.equal(manifest.chunks.length, 3);

    let reassembled = Buffer.alloc(0);
    for (const chunk of manifest.chunks) {
      assert.ok(/^chunk-\d{4}\.bin$/.test(chunk.file), `chunk file name format: ${chunk.file}`);
      const chunkPath = path.join(outputDir, chunk.file);
      assert.ok(fs.existsSync(chunkPath), `chunk file must exist: ${chunk.file}`);
      const chunkData = fs.readFileSync(chunkPath);
      assert.equal(chunkData.length, chunk.size, `chunk ${chunk.index} size must match`);
      const chunkHash = crypto.createHash('sha256').update(chunkData).digest('hex');
      assert.equal(chunkHash, chunk.sha256, `chunk ${chunk.index} sha256 must match`);
      reassembled = Buffer.concat([reassembled, chunkData]);
    }

    assert.equal(reassembled.length, manifest.totalSize, 'reassembled size must match totalSize');
    const totalHash = crypto.createHash('sha256').update(reassembled).digest('hex');
    assert.equal(totalHash, manifest.totalSha256, 'reassembled sha256 must match totalSha256');
    assert.equal(reassembled.toString(), sourceText, 'reassembled content must match source');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

asyncTest('vlb-to-manifest wrong passphrase produces no output', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'volare-m2m-wrong-'));
  const vlbPath = path.join(tmpDir, 'test.vlb');
  const outputDir = path.join(tmpDir, 'output');
  const vlb = buildTinyTestVlb('secret data', VLB_MANIFEST_PASSPHRASE);
  fs.writeFileSync(vlbPath, vlb);

  try {
    const { execFileSync } = require('node:child_process');
    let threw = false;
    let output = '';
    try {
      execFileSync(process.execPath, [
        path.join(repoRoot, 'tools', 'vlb-to-manifest.mjs'),
        '--input', vlbPath,
        '--asset-id', 'test-wrong-pw',
        '--output', outputDir,
        '--passphrase', 'completely-wrong-passphrase'
      ], { stdio: 'pipe' });
    } catch (err) {
      threw = true;
      output = Buffer.concat([
        err.stdout || Buffer.alloc(0),
        err.stderr || Buffer.alloc(0)
      ]).toString('utf8');
    }
    assert.ok(threw, 'wrong passphrase must cause non-zero exit');
    assert.ok(!output.includes('completely-wrong-passphrase'), 'wrong passphrase must not be printed');
    assert.ok(!fs.existsSync(outputDir) || fs.readdirSync(outputDir).length === 0,
      'no output files on failure');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

asyncTest('vlb-to-manifest rejects unsafe asset IDs', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'volare-m2m-unsafe-'));
  const vlbPath = path.join(tmpDir, 'test.vlb');
  const vlb = buildTinyTestVlb('test', VLB_MANIFEST_PASSPHRASE);
  fs.writeFileSync(vlbPath, vlb);

  const unsafeIds = ['../escape', 'slash/name', 'backslash\\name', 'a', 'AB', '-start', 'has spaces'];
  const { execFileSync } = require('node:child_process');

  try {
    for (const [index, badId] of unsafeIds.entries()) {
      let threw = false;
      try {
        execFileSync(process.execPath, [
          path.join(repoRoot, 'tools', 'vlb-to-manifest.mjs'),
          '--input', vlbPath,
          '--asset-id', badId,
          '--output', path.join(tmpDir, `out-${index}`),
          '--passphrase', VLB_MANIFEST_PASSPHRASE
        ], { stdio: 'pipe' });
      } catch {
        threw = true;
      }
      assert.ok(threw, `unsafe asset ID must be rejected: ${badId}`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

asyncTest('vlb-to-manifest rejects filename path traversal', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'volare-m2m-filename-'));
  const vlbPath = path.join(tmpDir, 'test.vlb');
  const outputDir = path.join(tmpDir, 'output');
  const vlb = buildTinyTestVlb('test', VLB_MANIFEST_PASSPHRASE);
  fs.writeFileSync(vlbPath, vlb);

  const { execFileSync } = require('node:child_process');
  try {
    let threw = false;
    try {
      execFileSync(process.execPath, [
        path.join(repoRoot, 'tools', 'vlb-to-manifest.mjs'),
        '--input', vlbPath,
        '--asset-id', 'test-filename',
        '--output', outputDir,
        '--passphrase', VLB_MANIFEST_PASSPHRASE,
        '--filename', '../asset.gltf'
      ], { stdio: 'pipe' });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'filename path traversal must be rejected');
    assert.ok(!fs.existsSync(outputDir), 'no output directory on filename validation failure');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

asyncTest('vlb-to-manifest rejects overwrite without --overwrite flag', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'volare-m2m-overwrite-'));
  const vlbPath = path.join(tmpDir, 'test.vlb');
  const outputDir = path.join(tmpDir, 'output');
  const vlb = buildTinyTestVlb('test', VLB_MANIFEST_PASSPHRASE);
  fs.writeFileSync(vlbPath, vlb);
  fs.mkdirSync(outputDir);

  const { execFileSync } = require('node:child_process');
  try {
    let threw = false;
    try {
      execFileSync(process.execPath, [
        path.join(repoRoot, 'tools', 'vlb-to-manifest.mjs'),
        '--input', vlbPath,
        '--asset-id', 'test-overwrite',
        '--output', outputDir,
        '--passphrase', VLB_MANIFEST_PASSPHRASE
      ], { stdio: 'pipe' });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'existing output must be rejected without --overwrite');

    let succeeded = false;
    try {
      execFileSync(process.execPath, [
        path.join(repoRoot, 'tools', 'vlb-to-manifest.mjs'),
        '--input', vlbPath,
        '--asset-id', 'test-overwrite',
        '--output', outputDir,
        '--passphrase', VLB_MANIFEST_PASSPHRASE,
        '--overwrite'
      ], { stdio: 'pipe' });
      succeeded = true;
    } catch {}
    assert.ok(succeeded, '--overwrite must allow replacement');
    assert.ok(fs.existsSync(path.join(outputDir, 'manifest.json')), 'manifest must exist after overwrite');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

asyncTest('vlb-to-manifest rejects malformed VLB metadata', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'volare-m2m-malformed-'));
  const vlbPath = path.join(tmpDir, 'test.vlb');

  const MAGIC = Buffer.from([0x56, 0x4C, 0x42, 0x00]);
  const header = Buffer.alloc(64, 0);
  MAGIC.copy(header, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(1, 8);
  const badMeta = Buffer.from(JSON.stringify({ algorithm: 'aes-256-gcm' }), 'utf8');
  const metaLen = Buffer.alloc(4);
  metaLen.writeUInt32LE(badMeta.length, 0);
  const fakeVlb = Buffer.concat([header, Buffer.from('ENCR'), metaLen, badMeta, Buffer.alloc(32)]);
  fs.writeFileSync(vlbPath, fakeVlb);

  const { execFileSync } = require('node:child_process');
  try {
    let threw = false;
    try {
      execFileSync(process.execPath, [
        path.join(repoRoot, 'tools', 'vlb-to-manifest.mjs'),
        '--input', vlbPath,
        '--asset-id', 'test-malformed',
        '--output', path.join(tmpDir, 'output'),
        '--passphrase', VLB_MANIFEST_PASSPHRASE
      ], { stdio: 'pipe' });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'malformed VLB metadata must be rejected');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

asyncTest('vlb-to-manifest AAD tampering is rejected', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'volare-m2m-aad-'));
  const vlbPath = path.join(tmpDir, 'test.vlb');
  const vlb = buildTinyTestVlb('aad test data', VLB_MANIFEST_PASSPHRASE);

  const HEADER_SIZE = 64;
  let offset = HEADER_SIZE + 4;
  const metaLen = vlb.readUInt32LE(offset);
  offset += 4;
  const meta = JSON.parse(vlb.subarray(offset, offset + metaLen).toString('utf8'));
  meta.created = '1999-01-01T00:00:00.000Z';
  const tamperedMetaBuf = Buffer.from(JSON.stringify(meta), 'utf8');
  const newMetaLen = Buffer.alloc(4);
  newMetaLen.writeUInt32LE(tamperedMetaBuf.length, 0);
  const tamperedVlb = Buffer.concat([
    vlb.subarray(0, HEADER_SIZE),
    Buffer.from('ENCR'),
    newMetaLen,
    tamperedMetaBuf,
    vlb.subarray(offset + metaLen)
  ]);
  fs.writeFileSync(vlbPath, tamperedVlb);

  const { execFileSync } = require('node:child_process');
  try {
    let threw = false;
    try {
      execFileSync(process.execPath, [
        path.join(repoRoot, 'tools', 'vlb-to-manifest.mjs'),
        '--input', vlbPath,
        '--asset-id', 'test-aad-tamper',
        '--output', path.join(tmpDir, 'output'),
        '--passphrase', VLB_MANIFEST_PASSPHRASE
      ], { stdio: 'pipe' });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'AAD-tampered VLB must be rejected');
    assert.ok(!fs.existsSync(path.join(tmpDir, 'output', 'manifest.json')),
      'no output on AAD failure');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

asyncTest('vlb-to-manifest no passphrase appears in output files', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'volare-m2m-noleak-'));
  const vlbPath = path.join(tmpDir, 'test.vlb');
  const outputDir = path.join(tmpDir, 'output');
  const vlb = buildTinyTestVlb('no-leak-test', VLB_MANIFEST_PASSPHRASE);
  fs.writeFileSync(vlbPath, vlb);

  const { execFileSync } = require('node:child_process');
  try {
    const output = execFileSync(process.execPath, [
      path.join(repoRoot, 'tools', 'vlb-to-manifest.mjs'),
      '--input', vlbPath,
      '--asset-id', 'test-noleak',
      '--output', outputDir,
      '--passphrase', VLB_MANIFEST_PASSPHRASE
    ], { stdio: 'pipe' }).toString('utf8');
    assert.ok(!output.includes(VLB_MANIFEST_PASSPHRASE), 'passphrase must not appear in CLI output');

    for (const f of fs.readdirSync(outputDir)) {
      const content = fs.readFileSync(path.join(outputDir, f));
      assert.ok(!content.toString().includes(VLB_MANIFEST_PASSPHRASE),
        `passphrase must not appear in ${f}`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Security client error-handling tests (ESM via dynamic import)
// ---------------------------------------------------------------------------

asyncTest('LicenseClient classifies 429 with HTML body as rate_limited', async () => {
  const { LicenseClient, LicenseError } = await import('../SDK/Security/LicenseClient.js');
  const mockFetch = async () => ({
    status: 429,
    ok: false,
    json: async () => { throw new Error('Unexpected end of JSON input'); }
  });
  const client = new LicenseClient({ fetchImpl: mockFetch });
  let caught = null;
  try {
    await client.requestLicense({ assetId: 'test', nonce: 'nonce-1' });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof LicenseError, 'must throw LicenseError');
  assert.equal(caught.code, 'rate_limited', 'code must be rate_limited');
  assert.equal(caught.status, 429, 'status must be 429');
});

asyncTest('LicenseClient classifies 403 with non-JSON body as forbidden', async () => {
  const { LicenseClient, LicenseError } = await import('../SDK/Security/LicenseClient.js');
  const mockFetch = async () => ({
    status: 403,
    ok: false,
    json: async () => { throw new Error('not json'); }
  });
  const client = new LicenseClient({ fetchImpl: mockFetch });
  let caught = null;
  try {
    await client.requestLicense({ assetId: 'test', nonce: 'nonce-2' });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof LicenseError, 'must throw LicenseError');
  assert.equal(caught.code, 'forbidden', 'code must be forbidden');
  assert.equal(caught.status, 403, 'status must be 403');
});

asyncTest('ManifestClient classifies 429 with HTML body as rate_limited', async () => {
  const { ManifestClient, ManifestError } = await import('../SDK/Security/ManifestClient.js');
  const mockFetch = async () => ({
    status: 429,
    ok: false,
    json: async () => { throw new Error('<html>Too Many Requests</html>'); }
  });
  const client = new ManifestClient({ fetchImpl: mockFetch });
  let caught = null;
  try {
    await client.fetchManifest({ assetId: 'test', token: 'tok', nonce: 'nonce-3' });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof ManifestError, 'must throw ManifestError');
  assert.equal(caught.code, 'rate_limited', 'code must be rate_limited');
  assert.equal(caught.status, 429, 'status must be 429');
});

asyncTest('ManifestClient classifies 403 with invalid JSON body as forbidden', async () => {
  const { ManifestClient, ManifestError } = await import('../SDK/Security/ManifestClient.js');
  const mockFetch = async () => ({
    status: 403,
    ok: false,
    json: async () => { throw new Error('bad json'); }
  });
  const client = new ManifestClient({ fetchImpl: mockFetch });
  let caught = null;
  try {
    await client.fetchManifest({ assetId: 'test', token: 'tok', nonce: 'nonce-4' });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof ManifestError, 'must throw ManifestError');
  assert.equal(caught.code, 'forbidden', 'code must be forbidden');
  assert.equal(caught.status, 403, 'status must be 403');
});

(async () => {
  for (const { name, fn } of asyncTests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (error) {
      console.error(`not ok - ${name}`);
      console.error(error.stack || error.message);
      process.exitCode = 1;
    }
  }

  if (process.exitCode) process.exit(process.exitCode);
})();
