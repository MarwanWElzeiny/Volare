import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const errors = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

// Directories git reports as fully ignored. They cannot reach the published
// package, so scanning them only produces false positives from local tooling
// (editor caches, agent/daemon logs, build output). Loose ignored *files* are
// still walked, so a stray .env is still caught. A force-added file is tracked,
// so it is not in this set and is still scanned.
function getIgnoredDirs() {
  try {
    const out = execFileSync(
      'git',
      ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    return new Set(
      out.split('\n')
        .map(line => line.trim().replace(/\/$/, ''))
        .filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

const ignoredDirs = getIgnoredDirs();

function listFiles(dir = root) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(root, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (['.git', 'node_modules'].includes(entry.name)) continue;
      if (ignoredDirs.has(relativePath)) continue;
      files.push(...listFiles(fullPath));
    } else {
      files.push(relativePath);
    }
  }
  return files;
}

function isTextFile(relativePath) {
  return /\.(cjs|css|html|js|json|md|mjs|txt|ya?ml)$/i.test(relativePath)
    || ['.gitignore', '.npmrc', 'LICENSE'].includes(path.basename(relativePath));
}

function getPackFiles() {
  try {
    const npmExecPath = process.env.npm_execpath;
    const command = npmExecPath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
    const args = npmExecPath
      ? [npmExecPath, 'pack', '--dry-run', '--json']
      : ['pack', '--dry-run', '--json'];
    const output = execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const pack = JSON.parse(output);
    return pack.flatMap((entry) => entry.files?.map((file) => file.path) || []);
  } catch (error) {
    errors.push(`npm pack dry-run failed during security audit: ${error.stderr || error.message}`);
    return [];
  }
}

function isForbiddenEnvFile(file) {
  if (!/(?:^|\/)\.env(?:\.|$)/.test(file)) return false;
  if (file === '.env.example') return false;
  if (/^packages\/[^/]+\/\.env\.example$/.test(file)) return false;
  return true;
}

const protectedAssetsPresent = exists('protected-assets');

const required = [
  'security/volareSecurity.cjs',
  'tests/security.test.cjs',
  'server/app.js'
];

const privateRequired = [
  'protected-assets/volare/demo-duck/asset.gltf',
  'protected-assets/volare/demo-duck/manifest.json',
  'protected-assets/volare/demo-chunked/manifest.json',
  'scripts/chunk-asset.mjs'
];

for (const file of required) {
  if (!exists(file)) errors.push(`Missing required security file: ${file}`);
}

if (protectedAssetsPresent) {
  for (const file of privateRequired) {
    if (!exists(file)) errors.push(`Missing required security file: ${file}`);
  }
} else {
  console.log('Public export mode: protected-assets not present; private fixture checks skipped.');
}

const server = read('server/app.js');
const security = exists('security/volareSecurity.cjs') ? read('security/volareSecurity.cjs') : '';
const pkg = JSON.parse(read('package.json'));
const allFiles = listFiles();

const forbiddenServerPatterns = [
  /TURNSTILE_SECRET_KEY\s*=\s*["']/,
  /Access-Control-Allow-Origin['"]\s*,\s*['"]\*/,
  /app\.use\(cors\(\)\)/,
  /express\.static\(path\.join\(__dirname,\s*['"]public['"]\)\)/
];

for (const pattern of forbiddenServerPatterns) {
  if (pattern.test(server)) errors.push(`Unsafe server pattern remains: ${pattern}`);
}

const requiredServerSnippets = [
  'helmet(',
  'createCorsOptions',
  '/api/security/validate',
  '/api/volare/license',
  '/api/volare/manifest/:assetId',
  '/api/volare/asset/:assetId',
  '/api/volare/chunk/:assetId/:index',
  "app.use('/node_modules'",
  "'/protected-assets'",
  'safeErrorResponse',
  'validateSecurityEnvelope',
  'validateProtectedAssetRequest',
  'validateChunkIndex',
  'verifySignedManifest',
  'verifyAssetHash',
  'sendFile(record.record.filePath',
  'X-Volare-Manifest-Signature',
  'X-Volare-Manifest-Expiry'
];

for (const snippet of requiredServerSnippets) {
  if (!server.includes(snippet)) errors.push(`Server is missing security wiring: ${snippet}`);
}

const requiredSecuritySnippets = [
  'verifySignedManifest',
  'verifyAssetHashes',
  'validateLicenseToken',
  'validateNonce',
  'validateOrigin',
  'validateExpiry',
  'loadProtectedAssetRecord',
  'loadChunkedAssetRecord',
  'validateChunkIndex',
  'resolveChunkFilePath',
  'createSignedManifest',
  'createSignedChunkedManifest',
  'verifyAssetHash',
  'VOLARE_SECURITY_CLASSIFICATION'
];

for (const snippet of requiredSecuritySnippets) {
  if (!security.includes(snippet)) errors.push(`Security utility is missing: ${snippet}`);
}

if (security.includes('production-secret') || security.includes('changeme')) {
  errors.push('Security module appears to include a default production secret.');
}

if (!pkg.scripts?.['security:audit']) {
  errors.push('package.json is missing security:audit script.');
}

if (!pkg.scripts?.['test:security']) {
  errors.push('package.json is missing test:security script.');
}

if (!/connect-src[^;]+blob:/.test(server) || !/img-src[^;]+blob:/.test(server)) {
  errors.push('CSP must allow blob URLs for protected glTF/object texture loading without disabling CSP.');
}

if (!server.includes('VOLARE_SECURITY_SECRET') && !security.includes('VOLARE_SECURITY_SECRET')) {
  errors.push('Production security secret requirement is not documented in runtime code.');
}

if (!security.includes('devFallback') || !server.includes('Development fallback signing key is active')) {
  errors.push('Development fallback signing key is not clearly marked.');
}

if (/express\.static\([^)]*protected-assets/.test(server) || /express\.static\([^)]*server-assets/.test(server)) {
  errors.push('Protected asset storage appears to be statically served.');
}

const securityDoc = exists('SECURITY.md') ? read('SECURITY.md') : '';

if (securityDoc.includes('encrypted') && securityDoc.includes('ACTIVE') && /encrypted.*active/i.test(securityDoc)) {
  errors.push('SECURITY.md must not claim encrypted delivery is active unless implemented.');
}

const requiredDocSnippets = [
  'Raw public model URLs are downloadable',
  'Public demo mode is not protected',
  'Protected delivery mode',
  'Chunked delivery mode',
  'Do not claim Volare makes assets unstealable',
  'Missing license nonce',
  'How To Test The Security Path'
];

for (const snippet of requiredDocSnippets) {
  if (!securityDoc.includes(snippet)) errors.push(`SECURITY.md is missing required reality statement: ${snippet}`);
}

const packagePrivatePatterns = [
  /^protected-assets(?:\/|$)/,
  /^public\/Model(?:\/|$)/,
  /^public\/Models(?:\/|$)/,
  /(?:^|\/)AudiR8\.glb$/i,
  /(?:^|\/)Helicopter4\.(?:gltf|bin)$/i,
  /(?:^|\/)Elephant\.glb$/i,
  /(?:^|\/)electric_box_43\.glb$/i,
  /(?:^|\/)fontawesome-png(?:\/|$)/i
];

for (const file of getPackFiles()) {
  if (isForbiddenEnvFile(file) || packagePrivatePatterns.some((pattern) => pattern.test(file))) {
    errors.push(`npm pack includes forbidden public-release file: ${file}`);
  }
}

if (!protectedAssetsPresent) {
  const forbiddenPublicPaths = [
    /^node_modules(?:\/|$)/,
    /^protected-assets(?:\/|$)/,
    /^coverage(?:\/|$)/,
    /^dist(?:\/|$)/,
    /^link-storage(?:\/|$)/,
    /^link-db\/.*\.db$/i,
    /(?:^|\/).*\.tgz$/i,
    /(?:^|\/).*\.log$/i,
    /(?:^|\/)VOLARE_MASTER_PLAN\.md$/i,
    /(?:^|\/)VOLARE_FINAL_EXECUTION_PACKAGE\.md$/i,
    /(?:^|\/)VOLARE_ADVANCED_ARCHITECTURE_AND_BACKEND_PLAN\.md$/i,
    /(?:^|\/)scratch-notes\.txt$/i,
    /(?:^|\/)AudiR8\.glb$/i,
    /(?:^|\/)Helicopter4\.(?:gltf|bin)$/i,
    /(?:^|\/)Elephant\.glb$/i,
    /(?:^|\/)electric_box_43\.glb$/i,
    /(?:^|\/)Models\/Background\/heaven(?:\/|$)/i,
    /(?:^|\/)fontawesome-png(?:\/|$)/i
  ];

  for (const file of allFiles) {
    if (isForbiddenEnvFile(file) || forbiddenPublicPaths.some((pattern) => pattern.test(file))) {
      errors.push(`Public export contains forbidden file: ${file}`);
    }
  }

  const securityGuidanceExists = exists('SECURITY.md')
    || exists('docs/SECURITY.md')
    || exists('docs/SECURITY_TESTING.md')
    || exists('docs/PROTECTED_ASSETS.md');
  if (!securityGuidanceExists) {
    errors.push('Public export is missing SECURITY.md or documented security guidance.');
  }

  const riskyTextPatterns = [
    { pattern: /impossible to download/i, label: 'impossible to download' },
    { pattern: /perfect DRM/i, label: 'perfect DRM' },
    { pattern: /unstealable/i, label: 'unstealable' }
  ];

  for (const file of allFiles.filter((file) => isTextFile(file) && file !== 'tools/security-audit.mjs')) {
    const content = read(file);
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const { pattern, label } of riskyTextPatterns) {
        if (!pattern.test(line)) continue;
        const warningContext = /\b(do not|does not|not|no|never|must not|should not|cannot|can not)\b/i.test(line);
        if (label === 'unstealable' && warningContext) continue;
        errors.push(`Public export overclaim wording in ${file}:${index + 1}: ${label}`);
      }
    });
  }
}

if (errors.length) {
  console.error('Volare security audit failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Volare security audit passed.');
