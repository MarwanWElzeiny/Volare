import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAssetUrl, getDeploymentBaseUrl } from '../SDK/Utils/assetPath.js';

test('resolves GitHub Pages project-site assets from the repository base', () => {
  const result = resolveAssetUrl('/SDK/css/volare.css', 'https://example.github.io/volare-public-release/DEMO/index.html');
  assert.equal(result, 'https://example.github.io/volare-public-release/SDK/css/volare.css');
});

test('resolves relative assets from the current page directory', () => {
  const result = resolveAssetUrl('./models/HDRI/', 'https://example.github.io/volare-public-release/DEMO/index.html');
  assert.equal(result, 'https://example.github.io/volare-public-release/DEMO/models/HDRI/');
});

test('computes the deployment base for local and GitHub Pages routes', () => {
  assert.equal(getDeploymentBaseUrl('https://example.github.io/volare-public-release/DEMO/index.html'), 'https://example.github.io/volare-public-release/');
  assert.equal(getDeploymentBaseUrl('http://localhost:3000/DEMO/index.html'), 'http://localhost:3000/');
});
