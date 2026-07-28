import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const requiredPaths = [
  'Demo/index.html',
  'Demo/direct.html',
  'Demo/scripts/VolareLoad.js',
  'Demo/scripts/DemoBootstrap.js',
  'SDK/Core/VolareViewer.js',
  'SDK/Core/createVolareViewer.js',
  'SDK/Core/PluginHost.js',
  'SDK/Managers/ModelLoaderManager.js',
  'SDK/Managers/LightingController.js',
  'SDK/UI/ViewerUIController.js',
  'SDK/css/volare.css',
  'SDK/css/core-tokens.css',
  'package.json',
  'security/volareSecurity.cjs',
  'tests/security.test.cjs',
];

const legacyPaths = [
  'public/Script',
  'public/CSS',
  'public/demo',
  'public/Demo.html',
  'public/cdn',
  'public/module-library',
  'module-library',
  'CLAUDE.md',
  '.claude',
  'packages',
];

const activeFilesToScan = [
  'Demo/index.html',
  'Demo/direct.html',
  'Demo/scripts/VolareLoad.js',
  'Demo/scripts/DemoBootstrap.js',
  'Demo/scripts/DemoDirectLoad.js',
  'Demo/scripts/DemoUIAdapter.js',
];

const forbiddenReferences = [
  'Script/Volare-Master',
  'public/CSS',
  'module-library/',
  '../Model/',
];

const errors = [];

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

for (const requiredPath of requiredPaths) {
  if (!exists(requiredPath)) {
    errors.push(`Missing required path: ${requiredPath}`);
  }
}

for (const legacyPath of legacyPaths) {
  if (exists(legacyPath)) {
    errors.push(`Legacy path should not exist: ${legacyPath}`);
  }
}

for (const file of activeFilesToScan) {
  const fullPath = path.join(root, file);
  if (!fs.existsSync(fullPath)) continue;
  const content = fs.readFileSync(fullPath, 'utf8');
  for (const forbidden of forbiddenReferences) {
    if (content.includes(forbidden)) {
      errors.push(`${file} references legacy path: ${forbidden}`);
    }
  }
}

if (errors.length) {
  console.error('Volare validation failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('Volare validation passed.');
