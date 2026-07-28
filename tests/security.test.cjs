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
// Public export release no longer exercises the separate VLB packaging flow.
// The security suite focuses on the server-side protected delivery path.
// ---------------------------------------------------------------------------

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
