/**
 * Demo UI Adapter — page-level demo orchestration.
 *
 * Provides gallery wiring, close handlers, model-access form,
 * guide panel, vlr-collection-d overlay, and navbar/shadow transitions.
 *
 * This file is DEMO-ONLY. SDK does not import it.
 */

import { VolareCanvas, UIManager, ButtonManager, VolareHelpers, VolareQuickSetup } from '../../SDK/UI/ViewerUIController.js';
import { setHdriBasePath } from '../../SDK/Managers/LightingController.js';

setHdriBasePath('./models/HDR/');

const watermarkUrl = './models/Volare.png';

// Demo-only DOM cache
const DemoDOMCache = {
  collectionD: null,
  gallery: null,
  quicknav: null,

  init() {
    this.collectionD = document.getElementById('vlr-collection-d');
    this.gallery = document.querySelectorAll('.image');
    this.quicknav = document.getElementById('navbar');
  },

  refresh() {
    this.init();
  }
};

let demoVolareInstance = null;

function getModelNoticeHTML() {
  return `
    <div class="vlr-model-notice">
      <form id="model-access-form" class="notice-card">
        <div class="vlr-watermark-parent">
          <img class="vlr-watermark" src="${watermarkUrl}" alt="Volare Watermark">
        </div>

        <div class="ModelWarning">
          <h3 class="vlr-model-warning-title">
            <i class="fa-solid fa-bolt fa-bounce" style="--fa-animation-iteration-count:1"></i>
            Performance Notice
          </h3>
          <p class="vlr-model-warning-paragraph">
            <i class="fa-solid fa-triangle-exclamation"></i> Heavy GPU Usage: Complex models may reduce device performance<br />
            <i class="fa-solid fa-ban"></i> Avoid on: Phones, Integrated graphics laptops<br />
            <i class="fa-solid fa-circle-check"></i> Recommended: Chrome/Firefox with hardware acceleration enabled
          </p>
        </div>

        <div class="ModelWarning">
          <h3 class="vlr-model-warning-title">
            <i class="fa-solid fa-file-shield fa-fade" style="--fa-animation-iteration-count:1"></i>
            Security Protocol
          </h3>
          <p class="vlr-model-warning-paragraph">
            <i class="fa-solid fa-eye-slash"></i> Protected View Features:
            <p class="vlr-model-warning-paragraph-info">
              - Auto-wireframe after 2min inactivity<br />
              - Texture watermarking<br />
              - Disabled right-click saving<br />
              - Session-limited access
            </p>
          </p>
        </div>

        <p class="more-info">
          Use Guide Instructions <i class="fa-solid fa-book fa-beat" style="--fa-animation-iteration-count:1"></i>
          to open the quick guide
        </p>
        <button type="submit" id="ViewModel" class="submit-btn">Submit</button>
      </form>
    </div>
  `;
}

function getDetailsHTML() {
  return `
    <div class="details" id="vlr-collection-d">
      <div class="vlr-details-icon">
        <span class="vlr-close-preview-icon fa-solid fa-xmark closepreview"></span>
      </div>
    </div>
  `;
}

function getGuideHTML(instance) {
  return `
    <div id="guide-book" class="guide-overlay">
      <div class="guide-container">
        <div class="guide-header">
          <h2><i class="fa-solid fa-cube"></i> Volare Quick Guide</h2>
          <span class="fa-solid fa-xmark closeGuide"></span>
        </div>
        <div class="guide-body">
          ${getGuideContent(instance)}
        </div>
      </div>
    </div>
  `;
}

function getGuideSection(items) {
  return items.map(item => `
    <div class="guide-row">
      <i class="fa-solid ${item.icon}"></i>
      <div class="guide-info">
        <h4>${item.title}</h4>
        <p>${item.desc}</p>
      </div>
      <div class="shortcut">${item.shortcut}</div>
    </div>
  `).join('');
}

function getGuideContent() {
  return `
    <div class="guide-section">
      <h3><i class="fa-solid fa-compass"></i> Navigation & Camera</h3>
      ${getGuideSection([
        { icon: 'fa-rotate', title: 'Rotate Model', desc: 'Hold <b>Left Click</b> + Drag', shortcut: '–' },
        { icon: 'fa-hand', title: 'Pan View', desc: 'Hold <b>Shift + Left Click</b> + Drag', shortcut: '–' },
        { icon: 'fa-magnifying-glass-plus', title: 'Zoom In/Out', desc: 'Use <b>Mouse Scroll</b>', shortcut: '–' },
        { icon: 'fa-bullseye', title: 'Focus Model', desc: 'Auto-center the camera', shortcut: 'F' },
        { icon: 'fa-rotate-left', title: 'Reset Camera', desc: 'Return to default view', shortcut: 'Shift + C' }
      ])}
    </div>

    <div class="guide-section">
      <h3><i class="fa-solid fa-eye"></i> Visualization Modes</h3>
      ${getGuideSection([
        { icon: 'fa-image', title: 'Original Materials', desc: 'Full textures, reflections, and lighting', shortcut: '1' },
        { icon: 'fa-border-all', title: 'Wireframe View', desc: 'See model structure & topology', shortcut: '2' },
        { icon: 'fa-circle-half-stroke', title: 'Ambient Occlusion', desc: 'View shadows and surface depth', shortcut: '3' },
        { icon: 'fa-flask', title: 'Material Inspector', desc: 'View Diffuse, Roughness, Normals', shortcut: 'M' },
        { icon: 'fa-vector-square', title: 'UV Map Preview', desc: 'See how textures are mapped', shortcut: 'U' },
        { icon: 'fa-arrows-up-down-left-right', title: 'Normal Vectors', desc: 'Visualize surface normals', shortcut: 'N' }
      ])}
    </div>

    <div class="guide-section">
      <h3><i class="fa-solid fa-toolbox"></i> Tools & Analysis</h3>
      ${getGuideSection([
        { icon: 'fa-chart-simple', title: 'Performance Monitor', desc: 'Show FPS & GPU usage', shortcut: 'Shift + S' },
        { icon: 'fa-cube', title: 'Bounding Box', desc: 'Visualize the model bounds', shortcut: 'B' },
        { icon: 'fa-crosshairs', title: 'Mesh Inspector', desc: 'Click a mesh part to inspect it', shortcut: 'V' },
        { icon: 'fa-scissors', title: 'Cross Section', desc: 'Slice the model to inspect interior', shortcut: 'X' }
      ])}
    </div>

    <div class="guide-section">
      <h3><i class="fa-solid fa-clapperboard"></i> Animation & Presentation</h3>
      ${getGuideSection([
        { icon: 'fa-play', title: 'Play/Pause Animation', desc: 'Start or stop animation playback', shortcut: 'Space' },
        { icon: 'fa-forward-step', title: 'Next Animation Clip', desc: 'Switch to next animation', shortcut: 'K' },
        { icon: 'fa-backward-step', title: 'Previous Animation Clip', desc: 'Switch to previous animation', shortcut: 'Shift + K' },
        { icon: 'fa-group-arrows-rotate', title: 'Turntable Mode', desc: 'Auto-rotate the model', shortcut: 'T' },
        { icon: 'fa-camera-retro', title: 'Director Mode', desc: 'Cinematic camera path', shortcut: 'D' }
      ])}
    </div>

    <div class="guide-section">
      <h3><i class="fa-solid fa-lightbulb"></i> Lighting & Rendering</h3>
      ${getGuideSection([
        { icon: 'fa-sun', title: 'Toggle Environment Light', desc: 'Switch HDRI background lighting', shortcut: 'Shift + L' },
        { icon: 'fa-gauge', title: 'Performance Mode', desc: 'Optimize for lower-end hardware', shortcut: 'P' }
      ])}
    </div>

    <div class="guide-section">
      <h3><i class="fa-solid fa-keyboard"></i> General</h3>
      ${getGuideSection([
        { icon: 'fa-xmark', title: 'Close All Tools', desc: 'Deactivate all visualizers and tools', shortcut: 'Escape' }
      ])}
    </div>
  `;
}

function initializeDemoPage(instance) {
  DemoDOMCache.init();

  injectModelNotice(instance);
  injectGuide(instance);
  initializeGallery(instance);
  initializeDetailsHTML();
  initializeCloseHandler(instance);
  bindGuideEvents(instance);
}

function injectModelNotice(instance) {
  const model = document.getElementById('model');
  if (!model) return;
  const notice = document.getElementById('model-access-form');
  if (notice) return;
  model.insertAdjacentHTML('afterbegin', getModelNoticeHTML());
}

function injectGuide(instance) {
  const model = document.getElementById('model');
  if (!model) return;
  if (document.getElementById('guide-book')) return;
  model.insertAdjacentHTML('beforeend', getGuideHTML(instance));
}

function initializeGallery(instance) {
  const { gallery } = DemoDOMCache;
  const volareCanvas = document.getElementById('VolareCanvas');

  if (!gallery || !volareCanvas) return;

  const shadow = document.querySelector('.shadow');

  gallery.forEach((img) => {
    img.dataset.volareLegacyGallery = 'true';
    img.onclick = (event) => {
      event?.preventDefault?.();
      event?.stopImmediatePropagation?.();
      const modelPath = img.dataset?.model;

      if (!modelPath) {
        console.warn('No data-model found on clicked image.');
        return;
      }

      const galleryEvent = new CustomEvent('volareGalleryClick', {
        detail: {
          modelPath,
          quicknav: DemoDOMCache.quicknav,
          shadow,
          volareCanvas,
          uiManager: instance?.uiManager || null
        }
      });
      document.dispatchEvent(galleryEvent);
    };
  });
}

function initializeDetailsHTML() {
  const volareCanvas = document.getElementById('VolareCanvas');
  if (!volareCanvas) return;

  let detailsElement = document.getElementById('vlr-collection-d');
  if (!detailsElement) {
    document.body.insertAdjacentHTML('beforeend', getDetailsHTML());
  } else if (detailsElement.parentElement !== document.body) {
    document.body.appendChild(detailsElement);
  }

  DemoDOMCache.refresh();
}

function initializeCloseHandler(instance) {
  const volareCanvas = document.getElementById('VolareCanvas');
  if (!volareCanvas) return;

  const quicknav = DemoDOMCache.quicknav;
  const shadow = document.querySelector('.shadow');

  volareCanvas.addEventListener('click', (e) => {
    if (e.target.classList.contains('vlr-close-preview-icon')) {
      if (window.viewerPlugin?.disposeCompletely) {
        instance?.closeAdvancedSurfaces?.();
        window.viewerPlugin.disposeCompletely();
        instance?.closeAdvancedSurfaces?.();
      }
      hideCanvas(instance, volareCanvas, quicknav, shadow);
    }
  });

  if (!document.__volareClosePreviewHandlerBound) {
    document.__volareClosePreviewHandlerBound = true;
    document.addEventListener('click', (e) => {
      if (!e.target.closest?.('.vlr-close-preview-icon')) return;

      const activeCanvas = document.getElementById('VolareCanvas');
      if (window.viewerPlugin?.disposeCompletely) {
        instance?.closeAdvancedSurfaces?.();
        window.viewerPlugin.disposeCompletely();
        instance?.closeAdvancedSurfaces?.();
      }
      if (activeCanvas) {
        hideCanvas(instance, activeCanvas, document.getElementById('navbar'), document.querySelector('.shadow'));
      }
    });
  }

  if (shadow) {
    shadow.addEventListener('click', () => {
      hideCanvas(instance, volareCanvas, quicknav, shadow);
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && volareCanvas.classList.contains('show')) {
      if (window.viewerPlugin?.closeTopmostOverlay?.()) return;
      hideCanvas(instance, volareCanvas, quicknav, shadow);
    }
  });
}

function hideCanvas(instance, volareCanvas, quicknav, shadow) {
  volareCanvas.classList.remove('show');
  volareCanvas.classList.remove('is-warning', 'is-viewer-ready');
  instance?.closeAdvancedSurfaces?.();
  document.body.style.overflow = 'auto';
  document.body.classList.remove('volare-viewer-open', 'volare-advanced-open');

  if (quicknav) {
    quicknav.classList.remove('fade');
  }

  if (shadow) {
    shadow.classList.remove('show');
    setTimeout(() => {
      shadow.style.display = 'none';
    }, 300);
  }
}

function showCanvas(instance, modelPath, elements = {}) {
  const { quicknav, shadow, volareCanvas } = getDOMElements(elements);

  instance?.uiManager?.showLoading?.('Loading 3D model...', 0);
  instance?.closeAdvancedSurfaces?.();

  displayCanvas({ quicknav, shadow, volareCanvas });
  volareCanvas?.classList.add('is-viewer-ready');
  volareCanvas?.classList.remove('is-warning');
  document.body.classList.add('volare-viewer-open');

  try {
    if (typeof window.initVolare === 'function') window.initVolare(modelPath);
    setTimeout(() => instance?.uiManager?.hideLoading?.(), 1000);
  } catch (error) {
    instance?.uiManager?.hideLoading?.();
    instance?.uiManager?.showNotification?.('Failed to load model', 'error');
  }
}

function showWithForm(instance, modelPath, elements = {}) {
  const { quicknav, shadow, volareCanvas } = getDOMElements(elements);

  if (window.volareWarningShownThisSession) {
    showCanvas(instance, modelPath, elements);
    return;
  }
  window.volareWarningShownThisSession = true;

  if (typeof window.setModelPath === 'function') window.setModelPath(modelPath);
  instance?.closeAdvancedSurfaces?.();
  displayCanvas({ quicknav, shadow, volareCanvas });
  volareCanvas?.classList.add('is-warning');
  volareCanvas?.classList.remove('is-viewer-ready');
  document.body.classList.remove('volare-viewer-open', 'volare-advanced-open');

  const form = document.getElementById('model-access-form');
  if (form) form.style.display = 'block';
}

function getDOMElements(elements = {}) {
  return {
    quicknav: elements.quicknav || document.getElementById('navbar'),
    shadow: elements.shadow || document.querySelector('.shadow'),
    volareCanvas: elements.volareCanvas || document.getElementById('VolareCanvas')
  };
}

function displayCanvas({ quicknav, shadow, volareCanvas }) {
  if (quicknav) quicknav.classList.add('fade');
  document.body.style.overflow = 'hidden';

  if (shadow) {
    shadow.style.display = 'block';
    setTimeout(() => shadow.classList.add('show'), 10);
  }

  if (volareCanvas) volareCanvas.classList.add('show');
}

function bindGuideEvents(instance) {
  const openGuideBook = () => {
    const guideBook = document.getElementById('guide-book');
    if (!guideBook) return;
    guideBook.classList.add('vlr-guide-transition');
  };
  const closeGuideBook = () => {
    document.getElementById('guide-book')?.classList.remove('vlr-guide-transition');
  };

  const guideToggle = document.getElementById('vlr-guide-toggle');
  const guideBook = document.getElementById('guide-book');
  const closeGuide = document.querySelector('.closeGuide');

  if (guideToggle && guideBook) {
    guideToggle.addEventListener('click', openGuideBook);
  }
  document.querySelectorAll('.more-info').forEach(element => {
    element.addEventListener('click', openGuideBook);
  });
  if (closeGuide && guideBook) {
    closeGuide.addEventListener('click', closeGuideBook);
  }

  document.addEventListener('click', (event) => {
    const openGuide = event.target.closest?.('#vlr-guide-toggle, .more-info');
    if (openGuide) {
      event.preventDefault();
      event.stopPropagation();
      openGuideBook();
    }
    if (event.target.closest?.('.closeGuide')) {
      event.preventDefault();
      closeGuideBook();
    }
  });
}

// Auto-initialize when DOM ready. Module evaluation can finish after
// DOMContentLoaded already fired, so check readyState instead of assuming
// the event is still pending.
function initWhenReady() {
  if (document.getElementById('VolareCanvas')) {
    demoVolareInstance = new VolareCanvas();
    initializeDemoPage(demoVolareInstance);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initWhenReady, { once: true });
} else {
  initWhenReady();
}

// Window globals for legacy demo compat
if (typeof window !== 'undefined') {
  window.VolareCanvas = VolareCanvas;
  window.UIManager = UIManager;
  window.ButtonManager = ButtonManager;
  window.VolareHelpers = VolareHelpers;
  window.VolareQuickSetup = VolareQuickSetup;
  window.volareInstance = null;

  window.demoShowCanvas = (modelPath, elements) => showCanvas(demoVolareInstance, modelPath, elements);
  window.demoShowWithForm = (modelPath, elements) => showWithForm(demoVolareInstance, modelPath, elements);
}

export {
  initializeDemoPage,
  showCanvas,
  showWithForm,
  hideCanvas,
  getDOMElements,
  displayCanvas,
  DemoDOMCache
};
