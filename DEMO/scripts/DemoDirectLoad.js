// DemoDirectLoad.js — Direct viewer init, no gallery, no form.
// Reads config from /demo/volare-init.js and opens viewer on page load.

import { VolareViewer } from '../../SDK/Core/VolareViewer.js';
import { setHdriBasePath } from '../../SDK/Managers/LightingController.js';
import showToast from '../../SDK/UI/NotificationToast.js';
import { getModelConfig, toolOrder, tools, defaultHdri, theme, environment, viewer as viewerConfig } from '../volare-init.js';

let viewerPlugin = null;
let viewer = null;

function applyTheme() {
  if (!theme) return;
  const root = document.documentElement;
  if (theme.accent) root.style.setProperty('--vlr-accent', theme.accent);
  if (theme.glass === false) {
    root.style.setProperty('--vlr-glass-blur', 'none');
    root.style.setProperty('--vlr-glass-bg', 'rgba(0,0,0,0.8)');
  }
  if (theme.cssVariables) {
    for (const [k, v] of Object.entries(theme.cssVariables)) {
      if (k.startsWith('--')) root.style.setProperty(k, v);
    }
  }
}

function applyToolVisibility() {
  for (const [id, visible] of Object.entries(tools)) {
    const btn = document.getElementById(id);
    if (btn && !visible) {
      btn.style.display = 'none';
      btn.dataset.volareFeatureDisabled = 'true';
    }
  }
}

function applyToolOrder() {
  if (!toolOrder || !toolOrder.length) return;
  const panel = document.getElementById('feature-panel');
  if (!panel) return;

  // Collect all feature buttons from grids
  const grids = panel.querySelectorAll('.vlr-advanced-right-grid');
  const allBtns = new Map();
  grids.forEach(grid => {
    grid.querySelectorAll('.vlr-advanced-btn').forEach(btn => {
      allBtns.set(btn.id, btn);
    });
  });

  // Remove old grids
  grids.forEach(g => g.remove());

  // Build ordered list (configured order first, then any remaining)
  const ordered = [];
  for (const id of toolOrder) {
    const btn = allBtns.get(id);
    if (btn) {
      ordered.push(btn);
      allBtns.delete(id);
    }
  }
  allBtns.forEach(btn => ordered.push(btn));

  // Re-insert in groups of 3
  for (let i = 0; i < ordered.length; i += 3) {
    const grid = document.createElement('div');
    grid.className = 'vlr-advanced-right-grid';
    for (let j = i; j < i + 3 && j < ordered.length; j++) {
      grid.appendChild(ordered[j]);
    }
    panel.appendChild(grid);
  }
}

function applyHdriSelection(hdriPath) {
  if (!hdriPath) return;
  const options = document.querySelectorAll('.hdri-option');
  options.forEach(opt => {
    const isMatch = opt.dataset.hdri === hdriPath ||
      hdriPath.includes(opt.dataset.hdri?.split('/').pop()?.replace('_4k.hdr', ''));
    opt.classList.toggle('active', isMatch);
  });
}

function initDirect() {
  setHdriBasePath('./models/HDR/');
  const config = getModelConfig();
  const modelPath = config.model;
  const hdriPath = config.hdri || defaultHdri;

  document.body.classList.add('volare-direct-mode');
  applyTheme();

  const volareCanvas = document.getElementById('VolareCanvas');
  if (volareCanvas) {
    volareCanvas.classList.add('show', 'is-viewer-ready');
    volareCanvas.classList.remove('is-warning');
  }
  document.body.classList.add('volare-viewer-open');

  const container = document.getElementById('model');
  if (container) container.style.display = 'block';

  // Hide the model-access-form if injected
  const form = document.getElementById('model-access-form');
  if (form) form.style.display = 'none';

  // Apply tool config after VolareCanvas generates HTML
  applyToolVisibility();
  applyToolOrder();

  // Create viewer
  if (!viewerPlugin) viewerPlugin = new VolareViewer();
  if (!viewer || viewer.isInitialized !== true) {
    viewer = viewerPlugin.createViewer('model', {
      antialias: viewerConfig.antialias ?? true,
      enableShadows: viewerConfig.enableShadows ?? true,
      fov: viewerConfig.fov ?? 30
    });
  }

  // Set HDRI
  viewer.setEnvironment(hdriPath);
  applyHdriSelection(hdriPath);

  // Load model
  if (modelPath) {
    viewer.loadModel(modelPath).then(() => {
      viewer.centerCameraOnModel();
      viewer.materialManager?.applyOriginalMaterials(viewer.currentModel);
    }).catch(error => {
      console.error('Failed to load model:', error);
      showToast("<i class='fa-solid fa-circle-exclamation'></i> Error", "Model load failed.<br>" + error.message);
    });
  }
}

// Import DemoUIAdapter to get VolareCanvas HTML generation
import './DemoUIAdapter.js';

// Wait for VolareCanvas to init, then open viewer directly.
// Module scripts can finish evaluating after DOMContentLoaded already fired
// (e.g. a slow top-level await deep in an import), so check readyState
// instead of assuming the event hasn't happened yet.
function onDomReady(callback) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', callback, { once: true });
  } else {
    callback();
  }
}

onDomReady(() => {
  // DemoUIAdapter auto-creates VolareCanvas on DOMContentLoaded.
  // We use a microtask to run after it.
  queueMicrotask(() => {
    // Hide gallery if present
    const gallery = document.querySelector('.wrapper-gallery');
    if (gallery) gallery.style.display = 'none';

    // Hide navbar for clean direct view (optional — keep if you want nav)
    const navbar = document.getElementById('navbar');
    if (navbar) navbar.classList.add('fade');

    initDirect();
  });
});
