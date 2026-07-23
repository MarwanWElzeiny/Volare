const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const DEFAULT_NONCE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TOKEN_TTL_SECONDS = 5 * 60;
const DEV_ONLY_SECRET = crypto.randomBytes(32).toString('hex');
const nonceStore = new Map();

function isProduction(env = process.env) {
  return env.NODE_ENV === 'production';
}

function getSecurityConfig(env = process.env) {
  const mode = isProduction(env) ? 'production' : 'development';
  const devFallback = mode !== 'production' && !env.VOLARE_SECURITY_SECRET;
  const secret = env.VOLARE_SECURITY_SECRET || (devFallback ? DEV_ONLY_SECRET : null);
  const licenseSecret = env.VOLARE_LICENSE_SECRET || secret;
  const allowedOrigins = (env.VOLARE_ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  if (mode === 'development') {
    allowedOrigins.push(
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:5173',
      'http://127.0.0.1:5173'
    );
  }

  return {
    mode,
    secret,
    licenseSecret,
    allowedOrigins: Array.from(new Set(allowedOrigins)),
    securityConfigured: !!secret && !!licenseSecret,
    devFallback,
    tokenTtlSeconds: Number(env.VOLARE_TOKEN_TTL_SECONDS || DEFAULT_TOKEN_TTL_SECONDS)
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        if (typeof value[key] !== 'undefined') result[key] = canonicalize(value[key]);
        return result;
      }, {});
  }
  return value;
}

function serializeForSignature(value) {
  return JSON.stringify(canonicalize(value));
}

function signPayload(payload, secret) {
  if (!secret) throw new Error('Security secret is required.');
  return crypto
    .createHmac('sha256', secret)
    .update(serializeForSignature(payload))
    .digest('base64url');
}

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function stripSignature(manifest) {
  const { signature, ...unsigned } = manifest || {};
  return unsigned;
}

function verifySignedManifest(manifest, secret, now = Date.now()) {
  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, reason: 'manifest_missing' };
  }
  if (!manifest.signature) {
    return { ok: false, reason: 'manifest_signature_missing' };
  }
  if (manifest.expiresAt && Date.parse(manifest.expiresAt) <= now) {
    return { ok: false, reason: 'manifest_expired' };
  }

  const expected = signPayload(stripSignature(manifest), secret);
  if (!constantTimeEqual(expected, manifest.signature)) {
    return { ok: false, reason: 'manifest_signature_invalid' };
  }

  return { ok: true, manifest: stripSignature(manifest) };
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function hashFile(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function resolveAssetPath(publicRoot, assetPath) {
  const normalized = assetPath.replace(/^[/\\]+/, '');
  const fullPath = path.resolve(publicRoot, normalized);
  const root = path.resolve(publicRoot);
  if (fullPath !== root && !fullPath.startsWith(root + path.sep)) {
    throw new Error('Asset path escapes public root.');
  }
  return fullPath;
}

function verifyAssetHashes(manifest, publicRoot) {
  const assets = Array.isArray(manifest?.assets) ? manifest.assets : [];
  for (const asset of assets) {
    if (!asset?.path || !asset?.sha256) {
      return { ok: false, reason: 'asset_hash_entry_invalid', asset };
    }
    const fullPath = resolveAssetPath(publicRoot, asset.path);
    if (!fs.existsSync(fullPath)) {
      return { ok: false, reason: 'asset_missing', asset: asset.path };
    }
    const actual = hashFile(fullPath);
    if (!constantTimeEqual(actual, asset.sha256)) {
      return { ok: false, reason: 'asset_hash_invalid', asset: asset.path };
    }
  }
  return { ok: true, checked: assets.length };
}

function resolveProtectedAssetPath(protectedRoot, assetPath) {
  const normalized = String(assetPath || '').replace(/^[/\\]+/, '');
  const fullPath = path.resolve(protectedRoot, normalized);
  const root = path.resolve(protectedRoot);
  if (fullPath !== root && !fullPath.startsWith(root + path.sep)) {
    throw new Error('Protected asset path escapes protected root.');
  }
  return fullPath;
}

function loadProtectedAssetRecord(protectedRoot, assetId) {
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(String(assetId || ''))) {
    return { ok: false, status: 400, reason: 'asset_id_invalid' };
  }

  const manifestPath = resolveProtectedAssetPath(protectedRoot, path.join('volare', assetId, 'manifest.json'));
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, status: 404, reason: 'asset_not_found' };
  }

  let metadata;
  try {
    metadata = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return { ok: false, status: 500, reason: 'asset_manifest_invalid' };
  }

  if (metadata.assetId !== assetId) {
    return { ok: false, status: 500, reason: 'asset_manifest_invalid' };
  }

  if (metadata.delivery === 'chunked') {
    return loadChunkedAssetRecord(protectedRoot, assetId, metadata);
  }

  if (!metadata.file) {
    return { ok: false, status: 500, reason: 'asset_manifest_invalid' };
  }

  const filePath = resolveProtectedAssetPath(protectedRoot, path.join('volare', assetId, metadata.file));
  const assetDir = path.resolve(protectedRoot, 'volare', assetId);
  if (filePath !== assetDir && !filePath.startsWith(assetDir + path.sep)) {
    return { ok: false, status: 500, reason: 'asset_manifest_invalid' };
  }
  if (!fs.existsSync(filePath)) {
    return { ok: false, status: 404, reason: 'asset_not_found' };
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    return { ok: false, status: 404, reason: 'asset_not_found' };
  }

  return {
    ok: true,
    record: {
      assetId,
      filePath,
      file: path.basename(metadata.file),
      contentType: metadata.contentType || 'application/octet-stream',
      sha256: metadata.sha256 || null,
      size: stat.size
    }
  };
}

function validateChunkFileName(name) {
  if (!name || typeof name !== 'string') return false;
  if (!/^chunk-\d{4}\.bin$/.test(name)) return false;
  return true;
}

function loadChunkedAssetRecord(protectedRoot, assetId, metadata) {
  if (!Array.isArray(metadata.chunks) || metadata.chunks.length === 0) {
    return { ok: false, status: 500, reason: 'chunk_manifest_invalid' };
  }
  if (!metadata.totalSha256 || !metadata.totalSize) {
    return { ok: false, status: 500, reason: 'chunk_manifest_invalid' };
  }

  const assetDir = path.resolve(protectedRoot, 'volare', assetId);
  const seen = new Set();

  for (let i = 0; i < metadata.chunks.length; i++) {
    const chunk = metadata.chunks[i];
    if (chunk.index !== i) {
      return { ok: false, status: 500, reason: 'chunk_index_not_sequential' };
    }
    if (seen.has(chunk.index)) {
      return { ok: false, status: 500, reason: 'chunk_index_duplicate' };
    }
    seen.add(chunk.index);
    if (!validateChunkFileName(chunk.file)) {
      return { ok: false, status: 500, reason: 'chunk_file_name_invalid' };
    }
    if (!chunk.sha256 || !chunk.size) {
      return { ok: false, status: 500, reason: 'chunk_manifest_invalid' };
    }
    const chunkPath = resolveProtectedAssetPath(protectedRoot, path.join('volare', assetId, chunk.file));
    if (!chunkPath.startsWith(assetDir + path.sep)) {
      return { ok: false, status: 500, reason: 'chunk_path_traversal' };
    }
    if (!fs.existsSync(chunkPath)) {
      return { ok: false, status: 404, reason: 'chunk_missing', chunkIndex: i };
    }
  }

  return {
    ok: true,
    chunked: true,
    record: {
      assetId,
      delivery: 'chunked',
      format: metadata.format || null,
      contentType: metadata.contentType || 'application/octet-stream',
      chunks: metadata.chunks,
      totalSize: metadata.totalSize,
      totalSha256: metadata.totalSha256,
      version: metadata.version || 1
    }
  };
}

function validateChunkIndex(record, index) {
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0) {
    return { ok: false, status: 400, reason: 'chunk_index_invalid' };
  }
  if (!record.chunked || !record.record?.chunks) {
    return { ok: false, status: 400, reason: 'asset_not_chunked' };
  }
  const chunk = record.record.chunks[idx];
  if (!chunk || chunk.index !== idx) {
    return { ok: false, status: 404, reason: 'chunk_not_found' };
  }
  return { ok: true, chunk };
}

function resolveChunkFilePath(protectedRoot, assetId, chunkFile) {
  if (!validateChunkFileName(chunkFile)) {
    throw new Error('Invalid chunk file name.');
  }
  const chunkPath = resolveProtectedAssetPath(protectedRoot, path.join('volare', assetId, chunkFile));
  const assetDir = path.resolve(protectedRoot, 'volare', assetId);
  if (!chunkPath.startsWith(assetDir + path.sep)) {
    throw new Error('Chunk path escapes asset directory.');
  }
  return chunkPath;
}

function createSignedManifest(record, secret, expiresAt) {
  if (record.delivery === 'chunked') {
    return createSignedChunkedManifest(record, secret, expiresAt);
  }
  const manifest = {
    assetId: record.assetId,
    assetPath: `/api/volare/asset/${record.assetId}`,
    file: record.file,
    hash: record.sha256,
    size: record.size,
    contentType: record.contentType,
    expiresAt
  };
  manifest.signature = signPayload(manifest, secret);
  return manifest;
}

function createSignedChunkedManifest(record, secret, expiresAt) {
  const manifest = {
    assetId: record.assetId,
    delivery: 'chunked',
    format: record.format || null,
    contentType: record.contentType,
    version: record.version || 1,
    chunks: record.chunks.map(c => ({
      index: c.index,
      size: c.size,
      sha256: c.sha256
    })),
    totalSize: record.totalSize,
    totalSha256: record.totalSha256,
    expiresAt
  };
  manifest.signature = signPayload(manifest, secret);
  return manifest;
}

function verifyAssetHash(filePath, expectedHash) {
  if (!expectedHash) return { ok: false, reason: 'asset_hash_missing' };
  if (!fs.existsSync(filePath)) return { ok: false, reason: 'asset_missing' };
  const actual = hashFile(filePath);
  if (!constantTimeEqual(actual, expectedHash)) {
    return { ok: false, reason: 'asset_hash_invalid' };
  }
  return { ok: true, hash: actual };
}

function validateExpiry(expiresAt, now = Date.now()) {
  const time = typeof expiresAt === 'number' ? expiresAt : Date.parse(expiresAt);
  if (!Number.isFinite(time)) return { ok: false, reason: 'expiry_invalid' };
  if (time <= now) return { ok: false, reason: 'expired' };
  return { ok: true };
}

function extractBearerToken(req) {
  const authorization = req.get?.('Authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function validateProtectedAssetRequest({ req, assetId, config, now = Date.now() }) {
  if (!config?.securityConfigured) {
    return { ok: false, status: 503, reason: 'security_not_configured' };
  }

  const origin = req.get('Origin') || (req.protocol && req.get('host') ? `${req.protocol}://${req.get('host')}` : null);
  if (!validateOrigin(origin, config.allowedOrigins, config.mode)) {
    return { ok: false, status: 403, reason: 'origin_not_allowed' };
  }

  const nonce = req.get('X-Volare-Nonce') || req.query?.nonce;
  const nonceResult = validateNonce(nonce, now);
  if (!nonceResult.ok) {
    return { ok: false, status: 401, reason: nonceResult.reason };
  }

  const token = extractBearerToken(req) || req.query?.token;
  const license = validateLicenseToken(token, config.licenseSecret);
  if (!license.ok) {
    return { ok: false, status: 401, reason: license.reason };
  }

  if (license.payload.assetId !== assetId) {
    return { ok: false, status: 403, reason: 'asset_scope_mismatch' };
  }

  if (license.payload.origin && origin && license.payload.origin !== origin) {
    return { ok: false, status: 403, reason: 'origin_scope_mismatch' };
  }

  const expiry = validateExpiry(license.payload.exp ? license.payload.exp * 1000 : license.payload.expiresAt, now);
  if (!expiry.ok) {
    return { ok: false, status: 401, reason: expiry.reason };
  }

  return { ok: true, license: license.payload, token };
}

function validateOrigin(origin, allowedOrigins, mode = 'development') {
  if (!origin) return mode !== 'production';
  if (allowedOrigins.includes(origin)) return true;
  try {
    const url = new URL(origin);
    return mode !== 'production' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function pruneNonceStore(now = Date.now()) {
  for (const [nonce, expiresAt] of nonceStore.entries()) {
    if (expiresAt <= now) nonceStore.delete(nonce);
  }
}

function validateNonce(nonce, now = Date.now(), ttlMs = DEFAULT_NONCE_TTL_MS) {
  pruneNonceStore(now);
  if (!nonce || typeof nonce !== 'string') {
    return { ok: false, reason: 'nonce_missing' };
  }
  if (nonceStore.has(nonce)) {
    return { ok: false, reason: 'nonce_replay' };
  }
  nonceStore.set(nonce, now + ttlMs);
  return { ok: true };
}

function resetNonceStore() {
  nonceStore.clear();
}

function createLicenseToken(payload, secret, options = {}) {
  if (!secret) throw new Error('License secret is required.');
  return jwt.sign(payload, secret, {
    algorithm: 'HS256',
    expiresIn: options.expiresIn || '5m',
    issuer: options.issuer || 'volare'
  });
}

function validateLicenseToken(token, secret, options = {}) {
  if (!token) return { ok: false, reason: 'license_missing' };
  if (!secret) return { ok: false, reason: 'license_secret_missing' };

  try {
    const payload = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: options.issuer || 'volare'
    });
    return { ok: true, payload };
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return { ok: false, reason: 'license_expired' };
    }
    return { ok: false, reason: 'license_invalid' };
  }
}

function validateSecurityEnvelope({ manifest, licenseToken, nonce, origin, publicRoot, config, now = Date.now() }) {
  if (!config?.securityConfigured) {
    return { ok: false, status: 503, reason: 'security_not_configured' };
  }

  if (!validateOrigin(origin, config.allowedOrigins, config.mode)) {
    return { ok: false, status: 403, reason: 'origin_not_allowed' };
  }

  const nonceResult = validateNonce(nonce, now);
  if (!nonceResult.ok) {
    return { ok: false, status: 401, reason: nonceResult.reason };
  }

  const license = validateLicenseToken(licenseToken, config.licenseSecret);
  if (!license.ok) {
    return { ok: false, status: 401, reason: license.reason };
  }

  const signedManifest = verifySignedManifest(manifest, config.secret, now);
  if (!signedManifest.ok) {
    return { ok: false, status: 401, reason: signedManifest.reason };
  }

  const hashes = verifyAssetHashes(signedManifest.manifest, publicRoot);
  if (!hashes.ok) {
    return { ok: false, status: 409, reason: hashes.reason, asset: hashes.asset };
  }

  return {
    ok: true,
    status: 200,
    manifest: signedManifest.manifest,
    license: license.payload,
    checkedAssets: hashes.checked
  };
}

module.exports = {
  DEFAULT_NONCE_TTL_MS,
  VOLARE_SECURITY_CLASSIFICATION: {
    ACTIVE: [
      'env-based server security configuration',
      'origin validation',
      'nonce/replay validation',
      'JWT license token validation',
      'signed manifest verification',
      'asset SHA-256 verification',
      'private protected asset route streaming',
      'chunked protected asset delivery',
      'per-chunk SHA-256 verification',
      'client-side chunk reassembly with hash validation',
      'safer CORS',
      'Helmet/CSP configuration',
      'secure static serving',
      'safe error responses',
      'security audit and utility tests'
    ],
    UTILITY_ONLY: [
      'validateSecurityEnvelope helper for compatibility tests and trusted tooling'
    ],
    NOT_IMPLEMENTED: [
      'encrypted chunk delivery (AES-GCM)',
      'watermarking',
      'hardware-backed DRM'
    ]
  },
  canonicalize,
  serializeForSignature,
  signPayload,
  stripSignature,
  verifySignedManifest,
  sha256Buffer,
  hashFile,
  resolveAssetPath,
  resolveProtectedAssetPath,
  loadProtectedAssetRecord,
  verifyAssetHashes,
  verifyAssetHash,
  validateExpiry,
  createSignedManifest,
  createSignedChunkedManifest,
  loadChunkedAssetRecord,
  validateChunkIndex,
  validateChunkFileName,
  resolveChunkFilePath,
  validateOrigin,
  validateNonce,
  resetNonceStore,
  createLicenseToken,
  validateLicenseToken,
  validateProtectedAssetRequest,
  validateSecurityEnvelope,
  getSecurityConfig
};
