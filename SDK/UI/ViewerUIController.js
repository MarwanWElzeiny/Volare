import { getHdriBasePath } from '../Managers/LightingController.js';

const _hdr = (name) => `${getHdriBasePath()}${name}`;
const _hdrImg = (name) => `${getHdriBasePath()}images/${name}`;

export const DOM_IDS = {
  TOGGLE_MATERIAL_INSPECTOR: 'toggle-material-inspector',
  TOGGLE_TURNTABLE_PLUS: 'toggle-turntable-plus',
  TOGGLE_BOUNDING_VOLUMES: 'toggle-bounding-volumes',
  TOGGLE_CROSS_SECTION: 'toggle-cross-section',
  TOGGLE_DIRECTOR_MODE: 'toggle-director-mode',
  TOGGLE_NORMALS: 'toggle-normals',
  TOGGLE_UV_PREVIEW: 'toggle-uv-preview',
  TOGGLE_MESH_ANALYSIS: 'toggle-mesh-analysis',
  SELECT_MESH: 'vlr-select-mesh',
  ROTATE_AROUND: 'vlr-rotate-around',
  LIGHTING_PRESETS: 'lighting-presets',
  TOGGLE_PERFORMANCE: 'toggle-performance'
};

export const DOM_CLASSES = {
  TOOL_TOGGLE: 'tool-toggle',
  ACTIVE: 'active',
  MESH_ANALYSIS_MAIN: 'vlr-mesh-analysis-main',
  MESH_ANALYSIS_BACK: 'vlr-mesh-analysis-back'
};

class ButtonManager {
  constructor() {
    this.buttons = new Map();
    this.cooldowns = new Map();
    this.themes = new Map();
    this.defaultCooldown = 1000;

    this.initializeThemes();
  }

  /**
   * Initialize predefined button themes
   */
  initializeThemes() {
    this.themes.set('primary', {
      baseClass: 'btn-primary',
      activeClass: 'btn-primary-active',
      disabledClass: 'btn-primary-disabled',
      hoverClass: 'btn-primary-hover'
    });

    this.themes.set('secondary', {
      baseClass: 'btn-secondary',
      activeClass: 'btn-secondary-active',
      disabledClass: 'btn-secondary-disabled',
      hoverClass: 'btn-secondary-hover'
    });

    this.themes.set('danger', {
      baseClass: 'btn-danger',
      activeClass: 'btn-danger-active',
      disabledClass: 'btn-danger-disabled',
      hoverClass: 'btn-danger-hover'
    });

    this.themes.set('success', {
      baseClass: 'btn-success',
      activeClass: 'btn-success-active',
      disabledClass: 'btn-success-disabled',
      hoverClass: 'btn-success-hover'
    });
  }

  /**
   * Register a button with customizable options
   * @param {string} id - Button ID
   * @param {Object} options - Configuration options
   */
  registerButton(id, options = {}) {
    const defaultOptions = {
      theme: 'primary',
      cooldown: this.defaultCooldown,
      toggle: false,
      group: null,
      states: {
        default: { classes: [], text: null, icon: null },
        active: { classes: ['active'], text: null, icon: null },
        disabled: { classes: ['disabled'], text: null, icon: null },
        loading: { classes: ['loading'], text: 'Loading...', icon: 'fa-spinner fa-spin' }
      },
      animations: {
        click: 'btn-click-animation',
        hover: 'btn-hover-animation',
        focus: 'btn-focus-animation'
      },
      callbacks: {
        onClick: null,
        onStateChange: null,
        beforeClick: null,
        afterClick: null
      }
    };

    const config = { ...defaultOptions, ...options };
    const element = document.getElementById(id);

    if (!element) {
      if (!config.optional) {
        console.warn(`Button with ID "${id}" not found`);
      }
      return this;
    }

    // Apply theme
    if (this.themes.has(config.theme)) {
      const theme = this.themes.get(config.theme);
      element.classList.add(theme.baseClass);
    }

    // Store button configuration
    this.buttons.set(id, {
      element,
      config,
      currentState: 'default',
      isActive: false,
      lastClicked: 0
    });

    // Set up event listeners
    this.setupButtonEvents(id);

    return this;
  }

  /**
   * Set up event listeners for a button
   */
  setupButtonEvents(id) {
    const buttonData = this.buttons.get(id);
    if (!buttonData) return;

    const { element, config } = buttonData;

    // Click handler
    element.addEventListener('click', (e) => {
      e.preventDefault();
      this.handleButtonClick(id);
    });

    // Hover effects
    if (config.animations.hover) {
      element.addEventListener('mouseenter', () => {
        if (!this.isDisabled(id)) {
          element.classList.add(config.animations.hover);
        }
      });

      element.addEventListener('mouseleave', () => {
        element.classList.remove(config.animations.hover);
      });
    }

    // Focus effects
    if (config.animations.focus) {
      element.addEventListener('focus', () => {
        element.classList.add(config.animations.focus);
      });

      element.addEventListener('blur', () => {
        element.classList.remove(config.animations.focus);
      });
    }
  }

  /**
   * Handle button click with cooldown and callbacks
   */
  handleButtonClick(id) {
    const buttonData = this.buttons.get(id);
    if (!buttonData) return;

    const { config } = buttonData;
    const now = Date.now();

    // Check cooldown
    if (this.cooldowns.has(id)) {
      const cooldownEnd = this.cooldowns.get(id);
      if (now < cooldownEnd) {
        return;
      }
    }

    // Check if disabled
    if (this.isDisabled(id)) return;

    // Before click callback
    if (config.callbacks.beforeClick) {
      const shouldContinue = config.callbacks.beforeClick(id, buttonData);
      if (shouldContinue === false) return;
    }

    // Set cooldown
    this.cooldowns.set(id, now + config.cooldown);

    // Handle group behavior
    if (config.group) {
      this.handleGroupBehavior(id, config.group);
    }

    // Handle toggle behavior
    if (config.toggle) {
      this.toggleButton(id);
    }

    // Add click animation
    if (config.animations.click) {
      this.addClickAnimation(id);
    }

    // Execute callback
    if (config.callbacks.onClick) {
      config.callbacks.onClick(id, buttonData);
    }

    // After click callback
    if (config.callbacks.afterClick) {
      config.callbacks.afterClick(id, buttonData);
    }

    // Update last clicked time
    buttonData.lastClicked = now;
  }

  /**
   * Handle group behavior (radio button style)
   */
  handleGroupBehavior(clickedId, groupName) {
    this.buttons.forEach((buttonData, id) => {
      if (buttonData.config.group === groupName && id !== clickedId) {
        this.setButtonState(id, 'default');
        buttonData.isActive = false;
      }
    });
  }

  /**
   * Toggle button state
   */
  toggleButton(id) {
    const buttonData = this.buttons.get(id);
    if (!buttonData) return;

    const newState = buttonData.isActive ? 'default' : 'active';
    this.setButtonState(id, newState);
    buttonData.isActive = !buttonData.isActive;
  }

  /**
   * Set button state with visual feedback
   */
  setButtonState(id, state) {
    const buttonData = this.buttons.get(id);
    if (!buttonData) return;

    const { element, config } = buttonData;
    const oldState = buttonData.currentState;

    // Remove old state classes
    if (config.states[oldState]?.classes) {
      config.states[oldState].classes.forEach(cls => {
        element.classList.remove(cls);
      });
    }

    // Add new state classes
    if (config.states[state]) {
      const stateConfig = config.states[state];

      (stateConfig.classes || []).forEach(cls => {
        element.classList.add(cls);
      });

      // Update text if specified
      if (stateConfig.text) {
        const textElement = element.querySelector('.btn-text') || element;
        textElement.textContent = stateConfig.text;
      }

      // Update icon if specified
      if (stateConfig.icon) {
        const iconElement = element.querySelector('i');
        if (iconElement) {
          iconElement.className = `fa-solid ${stateConfig.icon}`;
        }
      }
    }

    buttonData.currentState = state;

    // State change callback
    if (config.callbacks.onStateChange) {
      config.callbacks.onStateChange(id, oldState, state, buttonData);
    }
  }

  /**
   * Add click animation
   */
  addClickAnimation(id) {
    const buttonData = this.buttons.get(id);
    if (!buttonData) return;

    const { element, config } = buttonData;
    element.classList.add(config.animations.click);

    setTimeout(() => {
      element.classList.remove(config.animations.click);
    }, 300);
  }

  /**
   * Check if button is disabled
   */
  isDisabled(id) {
    const buttonData = this.buttons.get(id);
    return buttonData && buttonData.currentState === 'disabled';
  }

  /**
   * Enable/disable button
   */
  setEnabled(id, enabled = true) {
    const state = enabled ? 'default' : 'disabled';
    this.setButtonState(id, state);
  }

  /**
   * Batch register buttons with similar configuration
   */
  registerButtonGroup(ids, baseConfig = {}) {
    ids.forEach(id => {
      this.registerButton(id, baseConfig);
    });
    return this;
  }

  /**
   * Create a custom theme
   */
  createTheme(name, themeConfig) {
    this.themes.set(name, themeConfig);
    return this;
  }

  /**
   * Apply cooldown to multiple buttons
   */
  applyCooldownToGroup(ids, duration = this.defaultCooldown) {
    const now = Date.now();
    ids.forEach(id => {
      this.cooldowns.set(id, now + duration);
      this.setButtonState(id, 'loading');

      setTimeout(() => {
        this.setButtonState(id, 'default');
      }, duration);
    });
  }
}

/**
 * Enhanced UI Manager with integrated button management
 */
class UIManager {
  constructor(container) {
    this.container = container;
    this.loadingOverlay = null;
    this.controlPanels = new Map();
    this.isInitialized = false;
    this.buttonManager = new ButtonManager();
    this.eventListeners = new Map();

    this.init();
  }

  init() {
    this.setupDefaultButtons();
    this.isInitialized = true;
  }

  /**
   * Set up default Volare buttons with enhanced functionality
   */
  setupDefaultButtons() {
    // Visualization mode buttons
    this.buttonManager
      .registerButton('vlr-original-wire', {
        theme: 'primary',
        group: 'visualization',
        toggle: true,
        callbacks: {
          onClick: (id) => this.handleVisualizationMode('original')
        }
      })
      .registerButton('vlr-ao-wire', {
        theme: 'primary',
        group: 'visualization',
        toggle: true,
        callbacks: {
          onClick: (id) => this.handleVisualizationMode('ao')
        }
      })
      .registerButton('Wireframe', {
        theme: 'primary',
        group: 'visualization',
        toggle: true,
        callbacks: {
          onClick: (id) => this.handleVisualizationMode('wireframe')
        }
      });

    // Control buttons
    this.buttonManager
      .registerButton('vlr-center-camera', {
        theme: 'secondary',
        cooldown: 500,
        callbacks: {
          onClick: (id) => this.handleCameraReset()
        }
      })

  }

  handleResetAll() {
    const allButtonIds = Array.from(this.buttonManager.buttons.keys());
    this.buttonManager.applyCooldownToGroup(allButtonIds, 2000);
  }

  /**
   * Loading management
   */
  showLoading(text = 'Loading...', progress = 0) {
    const overlay = document.getElementById('loadingScreen');
    const loadingText = document.querySelector('.loading-text');
    const loadingBar = document.querySelector('.loading-bar');

    if (overlay) {
      overlay.style.display = 'flex';
      overlay.classList.add('loading-active');
    }
    if (loadingText) loadingText.textContent = text;
    if (loadingBar) loadingBar.style.transform = `scaleX(${Math.min(1, Math.max(0, progress / 100))})`;
  }

  hideLoading() {
    const overlay = document.getElementById('loadingScreen');
    if (overlay) {
      overlay.classList.add('loading-fade-out');
      setTimeout(() => {
        overlay.style.display = 'none';
        overlay.classList.remove('loading-active', 'loading-fade-out');
      }, 300);
    }
  }

  updateLoadingProgress(progress, text = null) {
    const loadingBar = document.querySelector('.loading-bar');
    const loadingText = document.querySelector('.loading-text');

    if (loadingBar) {
      loadingBar.style.transform = `scaleX(${Math.min(1, Math.max(0, progress / 100))})`;
    }
    if (text && loadingText) {
      loadingText.textContent = text;
    }
  }

  /**
   * Create notification system
   */
  showNotification(message, type = 'info', duration = 3000) {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    const content = document.createElement('div');
    content.className = 'notification-content';
    const icon = document.createElement('i');
    icon.className = `fa-solid ${this.getNotificationIcon(type)}`;
    const span = document.createElement('span');
    span.textContent = message;
    content.appendChild(icon);
    content.appendChild(span);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'notification-close';
    const closeIcon = document.createElement('i');
    closeIcon.className = 'fa-solid fa-times';
    closeBtn.appendChild(closeIcon);
    notification.appendChild(content);
    notification.appendChild(closeBtn);

    // Add to container
    const container = this.getNotificationContainer();
    container.appendChild(notification);

    // Auto-remove
    const autoRemove = setTimeout(() => {
      this.removeNotification(notification);
    }, duration);

    // Manual close
    notification.querySelector('.notification-close').addEventListener('click', () => {
      clearTimeout(autoRemove);
      this.removeNotification(notification);
    });

    return notification;
  }

  getNotificationIcon(type) {
    const icons = {
      info: 'fa-info-circle',
      success: 'fa-check-circle',
      warning: 'fa-exclamation-triangle',
      error: 'fa-times-circle'
    };
    return icons[type] || icons.info;
  }

  getNotificationContainer() {
    let container = document.getElementById('notification-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'notification-container';
      container.className = 'notification-container';
      document.body.appendChild(container);
    }
    return container;
  }

  removeNotification(notification) {
    notification.classList.add('notification-fade-out');
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }

  /**
   * Enhanced dispose method
   */
  dispose() {
    // Remove all button listeners
    this.buttonManager.buttons.clear();
    this.buttonManager.cooldowns.clear();

    // Remove event listeners
    this.eventListeners.forEach((listeners, element) => {
      listeners.forEach(({ event, handler }) => {
        element.removeEventListener(event, handler);
      });
    });
    this.eventListeners.clear();

    // Remove DOM elements
    const overlay = document.getElementById('loadingScreen');
    if (overlay && overlay.parentNode === this.container) {
      this.container.removeChild(overlay);
    }

    this.controlPanels.forEach(panel => {
      if (panel.parentNode) {
        panel.parentNode.removeChild(panel);
      }
    });

    this.controlPanels.clear();
  }
}

/**
 * DOM element cache for performance
 */
const VolareDOMManager = {
  visualToolkit: null,
  toolkitToggle: null,
  advancedThree: null,
  volareCanvas: null,
  loadingElement: null,

  init() {
    this.visualToolkit = document.getElementById("vlr-visual-toolkit");
    this.toolkitToggle = document.querySelector(".vlr-toolkit-toggle");
    this.advancedThree = document.getElementById("vlr-advanced-three");
    this.volareCanvas = document.getElementById('VolareCanvas');
    this.loadingElement = document.querySelector(".loading");
  },

  refresh() {
    this.init();
  }
};

/**
 * Enhanced Volare Canvas with integrated UI management
 */
class VolareCanvas {
  constructor(options = {}) {
    this.options = {
      tabletBreakpoint: 1200,
      autoInit: true,
      ...options
    };

    this.observers = new Map();
    this.eventListeners = new Map();
    this.uiManager = null;
    this.visualToolkitIdleTimer = null;
    this.visualToolkitHovered = false;
    this.visualToolkitStatsReady = false;
    this.visualToolkitMeshPending = false;
    this.visualToolkitMeshSelected = false;

    if (this.options.autoInit) {
      this.init();
    }
  }

  init() {
    VolareDOMManager.init();
    this.initializeVolareCanvas();
    this.initializeUIManager();
    this.bindEvents();
  }

  /**
   * Initialize UI Manager
   */
  initializeUIManager() {
    this.uiManager = new UIManager(document.body);

    // Example of adding custom buttons
    this.uiManager.buttonManager
      .registerButton('toggle-performance', {
        theme: 'success',
        toggle: true,
        callbacks: {
          onClick: (id, buttonData) => {
            this.uiManager.showNotification(
              `Performance mode ${buttonData.isActive ? 'enabled' : 'disabled'}`,
              'success'
            );
          }
        }
      })
  }

  syncAdvancedOpenState() {
    const visualToolkit = document.getElementById('vlr-visual-toolkit');
    const advancedThree = document.getElementById('vlr-advanced-three');
    const isOpen = visualToolkit?.classList.contains('active') || advancedThree?.classList.contains('active');
    document.body.classList.toggle('volare-advanced-open', Boolean(isOpen));

    if (visualToolkit?.classList.contains('active')) {
      this.showVisualToolkit();
      this.scheduleVisualToolkitIdleDim(5000);
    } else {
      this.clearVisualToolkitIdleTimer();
      this.resetVisualToolkitTransientState();
    }
  }

  closeAdvancedSurfaces() {
    document.getElementById('vlr-visual-toolkit')?.classList.remove('active');
    document.getElementById('vlr-advanced-three')?.classList.remove('active');
    document.body.classList.remove('volare-advanced-open');
    this.clearVisualToolkitIdleTimer();
    this.resetVisualToolkitTransientState();
  }

  clearVisualToolkitIdleTimer() {
    if (!this.visualToolkitIdleTimer) return;
    clearTimeout(this.visualToolkitIdleTimer);
    this.visualToolkitIdleTimer = null;
  }

  getVisualToolkitElement() {
    return document.getElementById('vlr-visual-toolkit');
  }

  showVisualToolkit() {
    this.getVisualToolkitElement()?.classList.remove('vlr-toolkit-idle-dim');
  }

  dimVisualToolkitForIdle() {
    const visualToolkit = this.getVisualToolkitElement();
    if (!visualToolkit?.classList.contains('active')) return;
    if (this.visualToolkitHovered || this.visualToolkitMeshPending) return;
    visualToolkit.classList.add('vlr-toolkit-idle-dim');
  }

  scheduleVisualToolkitIdleDim(delay = 3000) {
    this.clearVisualToolkitIdleTimer();
    const visualToolkit = this.getVisualToolkitElement();
    if (!visualToolkit?.classList.contains('active')) return;
    this.visualToolkitIdleTimer = setTimeout(() => {
      this.visualToolkitIdleTimer = null;
      this.dimVisualToolkitForIdle();
    }, delay);
  }

  setVisualToolkitInspectorDim(isDimmed) {
    this.getVisualToolkitElement()?.classList.toggle('vlr-toolkit-inspector-dim', Boolean(isDimmed));
  }

  setVisualToolkitMeshPending(isPending) {
    this.visualToolkitMeshPending = Boolean(isPending);
    const visualToolkit = this.getVisualToolkitElement();
    visualToolkit?.classList.toggle('vlr-toolkit-mesh-pending', this.visualToolkitMeshPending);
    visualToolkit?.classList.toggle('vlr-toolkit-disabled', this.visualToolkitMeshPending);

    if (this.visualToolkitMeshPending) {
      this.clearVisualToolkitIdleTimer();
      return;
    }

    this.showVisualToolkit();
    this.scheduleVisualToolkitIdleDim(3000);
  }

  resetVisualToolkitTransientState() {
    const visualToolkit = this.getVisualToolkitElement();
    if (!visualToolkit) return;
    visualToolkit.classList.remove(
      'vlr-toolkit-idle-dim',
      'vlr-toolkit-inspector-dim',
      'vlr-toolkit-mesh-pending',
      'vlr-toolkit-disabled'
    );
    this.visualToolkitHovered = false;
    this.visualToolkitMeshPending = false;
    this.visualToolkitMeshSelected = false;
  }

  minimizeVisualToolkit() {
    const visualToolkit = this.getVisualToolkitElement();
    visualToolkit?.classList.remove('active');
    document.getElementById('vlr-advanced-three')?.classList.remove('active');
    document.body.classList.remove('volare-advanced-open');
    this.clearVisualToolkitIdleTimer();
    this.resetVisualToolkitTransientState();
  }

  handleVisualToolkitEvent(event) {
    const detail = event?.detail || {};
    switch (detail.type) {
      case 'visualizer-open':
        // Bounding box / cross-section / normals selected → collapse the toolkit
        this.minimizeVisualToolkit();
        break;
      case 'visualizer-close':
        break;
      case 'material-inspector-open':
        this.setVisualToolkitInspectorDim(true);
        break;
      case 'material-inspector-close':
        this.setVisualToolkitInspectorDim(false);
        this.scheduleVisualToolkitIdleDim(3000);
        break;
      case 'mesh-inspector-open':
        this.visualToolkitMeshSelected = false;
        this.setVisualToolkitMeshPending(true);
        break;
      case 'mesh-inspector-close':
        this.setVisualToolkitMeshPending(false);
        break;
      case 'mesh-selected':
        this.visualToolkitMeshSelected = true;
        if (this.visualToolkitStatsReady) {
          this.setVisualToolkitMeshPending(false);
        }
        break;
      case 'model-stats-ready':
        this.visualToolkitStatsReady = true;
        if (this.visualToolkitMeshPending && this.visualToolkitMeshSelected) {
          this.setVisualToolkitMeshPending(false);
        }
        break;
      default:
        break;
    }
  }

  toggleAdvancedPanel() {
    const { advancedThree } = VolareDOMManager;
    if (!advancedThree) return;

    if (advancedThree.classList.contains('active')) {
      advancedThree.classList.remove('active');
    } else {
      advancedThree.classList.add('active');
    }
    this.syncAdvancedOpenState();
  }

  initResponsiveTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    if (window.innerWidth > this.options.tabletBreakpoint) {
      tabContents.forEach(content => content.classList.add('active'));
      return;
    }

    if (!tabButtons.length || !tabContents.length) return;

    tabButtons.forEach(btn => btn.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));

    const firstButton = tabButtons[0];
    if (firstButton) {
      const firstTarget = firstButton.dataset.target;
      firstButton.classList.add('active');
      const targetElement = document.getElementById(firstTarget);
      if (targetElement) {
        targetElement.classList.add('active');
      }
    }
  }

  initHdriSwiper() {
    const container = document.querySelector('#vlr-visual-toolkit .swiper-container');
    if (!container) return;

    if (typeof window.Swiper === 'function') {
      if (this.hdriSwiper) {
        this.hdriSwiper.update();
        return;
      }
      this.hdriSwiper = new window.Swiper(container, {
        freeMode: true,
        slidesPerView: 'auto',
        grabCursor: true,
        navigation: false,
        pagination: false
      });
      return;
    }

    if (container.dataset.dragInit) return;
    container.dataset.dragInit = 'true';
    container.style.overflowX = 'auto';
    container.style.cursor = 'grab';
    container.style.webkitOverflowScrolling = 'touch';

    let isDragging = false, startX = 0, scrollStart = 0, moved = false;
    const DRAG_THRESHOLD = 5;

    container.addEventListener('pointerdown', (e) => {
      isDragging = true;
      moved = false;
      startX = e.clientX;
      scrollStart = container.scrollLeft;
      container.style.cursor = 'grabbing';
      container.setPointerCapture(e.pointerId);
    });
    container.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > DRAG_THRESHOLD) moved = true;
      container.scrollLeft = scrollStart - dx;
    });
    const endDrag = () => {
      isDragging = false;
      container.style.cursor = 'grab';
    };
    container.addEventListener('pointerup', endDrag);
    container.addEventListener('pointercancel', endDrag);
    container.addEventListener('click', (e) => {
      if (moved) { e.stopPropagation(); e.preventDefault(); }
    }, true);
  }


  bindEvents() {
    const { toolkitToggle, visualToolkit } = VolareDOMManager;

    if (toolkitToggle) {
      this.addEventListener(toolkitToggle, 'click', () => {
        if (visualToolkit) {
          visualToolkit.classList.toggle('active');
          if (visualToolkit.classList.contains('active')) {
            this.initResponsiveTabs();
            this.initHdriSwiper();
          } else {
            document.getElementById('vlr-advanced-three')?.classList.remove('active');
          }
        }
        this.syncAdvancedOpenState();
      });
    }

    if (visualToolkit) {
      this.addEventListener(visualToolkit, 'mouseenter', () => {
        this.visualToolkitHovered = true;
        this.clearVisualToolkitIdleTimer();
        if (!this.visualToolkitMeshPending) this.showVisualToolkit();
      });

      this.addEventListener(visualToolkit, 'mouseleave', () => {
        this.visualToolkitHovered = false;
        this.scheduleVisualToolkitIdleDim(3000);
      });

      this.addEventListener(visualToolkit, 'pointerdown', () => {
        this.visualToolkitHovered = true;
        this.clearVisualToolkitIdleTimer();
        if (!this.visualToolkitMeshPending) this.showVisualToolkit();
        this.scheduleVisualToolkitIdleDim(5000);
      });
    }

    const modelSurface = document.getElementById('model');
    if (modelSurface) {
      const startViewerIdleCountdown = (event) => {
        if (event.target?.closest?.('#vlr-visual-toolkit')) return;
        this.visualToolkitHovered = false;
        if (!this.visualToolkitIdleTimer) {
          this.scheduleVisualToolkitIdleDim(3000);
        }
      };
      this.addEventListener(modelSurface, 'pointerdown', startViewerIdleCountdown);
      this.addEventListener(modelSurface, 'pointermove', startViewerIdleCountdown);
      this.addEventListener(modelSurface, 'wheel', startViewerIdleCountdown, { passive: true });
    }

    this.addEventListener(document, 'volare:visual-toolkit-state', (event) => {
      this.handleVisualToolkitEvent(event);
    });

    document.querySelectorAll('.vlr-close-toolkit-icon')?.forEach(element => {
      this.addEventListener(element, 'click', (e) => {
        e.stopPropagation();
        if (visualToolkit) {
          visualToolkit.classList.remove('active');
          document.getElementById('vlr-advanced-three')?.classList.remove('active');
        }
        this.syncAdvancedOpenState();
      });
    });

    const advancedOp = document.getElementById("vlr-advanced-op");
    if (advancedOp) {
      this.addEventListener(advancedOp, 'click', () => this.toggleAdvancedPanel());
    }

    document.querySelectorAll('.tab-button').forEach(btn => {
      this.addEventListener(btn, 'click', () => {
        const target = btn.dataset.target;

        document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        const targetElement = document.getElementById(target);
        if (targetElement) {
          targetElement.classList.add('active');
        }
      });
    });

    this.addEventListener(window, 'resize', () => {
      this.initResponsiveTabs();
    });

    this.addEventListener(window, 'orientationchange', () => {
      setTimeout(() => this.initResponsiveTabs(), 100);
    });

    this.addEventListener(window, 'DOMContentLoaded', () => this.initResponsiveTabs());

    this.initializeRangeSlider();
  }

  addEventListener(element, event, handler) {
    if (!element || typeof element.addEventListener !== 'function' || typeof handler !== 'function') return;
    element.addEventListener(event, handler);

    if (!this.eventListeners.has(element)) {
      this.eventListeners.set(element, []);
    }
    this.eventListeners.get(element).push({ event, handler });
  }

  initializeRangeSlider() {
    const rangeSlide = document.querySelector(".range-slide");
    const tooltip = document.querySelector(".tooltip");

    if (!rangeSlide || !tooltip) return;

    const maxVal = parseInt(rangeSlide.max);

    const slidecalculate = () => {
      let progress = (rangeSlide.value / maxVal) * 100;
      tooltip.innerHTML = rangeSlide.value;
      tooltip.style.left = progress + "%";
      rangeSlide.style.background = `linear-gradient(to right, #ffffff ${progress}%, #2121215a ${progress}%)`;
      rangeSlide.style.borderRadius = "30px";
    };

    this.addEventListener(rangeSlide, 'input', slidecalculate);
    this.addEventListener(window, 'load', slidecalculate);

    slidecalculate();
  }

  initializeVolareCanvas() {
    const { volareCanvas } = VolareDOMManager;
    if (!volareCanvas) return;

    volareCanvas.innerHTML = this.getCanvasHTML();
    VolareDOMManager.refresh();
  }

  getCanvasHTML() {
    return `
      <div id="vlr-model-container" class="vlr-model-container">
        <div id="model" class="Model vlr-canvas" data-vlr-role="canvas">
          <div id="vlr-model-attr-data"></div>
          ${this.getModelAttributesHTML()}
          ${this.getMeshAnalysisHTML()}
          ${this.getVisualToolkitHTML()}
          ${this.getAnimationsPanelHTML()}
        </div>
      </div>
    `;
  }


  getModelAttributesHTML() {
    return `
      <div class="vlr-model-attr-main">
        <div class="vlr-model-attr-back-tab">
          <div class="vlr-model-attr-container">
            <span class="vlr-model-attr-back vlr-model-attributes vlr-reset-toggle" id="vlr-reset-toggle">
              <i class="fa-solid fa-arrow-rotate-right vlr-model-attr Lighting"></i>
              <h4 class="vlr-model-attr-text">Reset All Settings</h4>
            </span>
            <span class="vlr-model-attr-back vlr-model-attributes vlr-guide-toggle" id="vlr-guide-toggle">
              <i class="fa-solid fa-book vlr-model-attr"></i>
              <h4 class="vlr-model-attr-text">Guide Instructions</h4>
            </span>
            <span class="vlr-model-attr-back vlr-model-attributes vlr-toolkit-toggle">
              <i class="fa-solid fa-toolbox vlr-model-attr"></i>
              <h4 class="vlr-model-attr-text">Visual Toolkit</h4>
            </span>
          </div>
        </div>
      </div>
    `;
  }

  getMeshAnalysisHTML() {
    return `
      <div class="vlr-mesh-analysis-main">
        <div class="vlr-mesh-analysis-back-tab">
          <div class="vlr-mesh-analysis-container">
            <span class="vlr-mesh-analysis-back vlr-select-mesh" id="vlr-select-mesh">
              <i class="fa-solid fa-crosshairs MeshAnalysis"></i>
              <h4 class="vlr-mesh-analysis-text">Select Mesh</h4>
            </span>
            <span class="vlr-mesh-analysis-back vlr-rotate-around" id="vlr-rotate-around">
              <i class="fa-solid fa-hand MeshAnalysis"></i>
              <h4 class="vlr-mesh-analysis-text">Hand Tool</h4>
            </span>
          </div>
        </div>
      </div>
    `;
  }

  getVisualToolkitHTML() {
    return `
      <div class="vlr-visual-toolkit" id="vlr-visual-toolkit">
        <div class="vlr-details-toolkit-icon">
          <button class="vlr-close-toolkit-icon vlr-close-button" data-vlr-role="toolkit-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
        </div>

        ${this.getModesHTML()}
        ${this.getAdvancedThreeHTML()}
        ${this.getHdriContainerHTML()}
      </div>
    `;
  }

  getAnimationsPanelHTML(){
    return `
      <div id="animation-panel">
      </div>
    `
  }

  getModesHTML() {
    return `
      <div class="vlr-modes-three">
        <div class="vlr-modes-wireframe vlr-wireframe-bar" data-vlr-role="wireframe-bar">
          <div class="Wireframe vlr-op-wireframe vlr-mode-button" id="Wireframe">
            <i class='fa-solid fa-network-wired'></i>
            <H4>Wireframe</H4>
          </div>
          <div class="Original vlr-op-wireframe vlr-mode-button active" id="vlr-original-wire">
            <i class='fa-solid fa-eye'></i>
            <h4>Original</h4>
          </div>
          <div class="AO vlr-op-wireframe vlr-mode-button" id="vlr-ao-wire">
            <i class="fa-solid fa-circle-half-stroke"></i>
            <h4>Ambient Occlusion</h4>
          </div>
        </div>

        <div class="vlr-op-modes-container">
          <div class="vlr-center-camera vlr-op-modes" id="vlr-center-camera">
            <i class="fa-solid fa-crosshairs"></i>
            <h4>Follow Model</h4>
          </div>
          <div class="vlr-advanced-op vlr-op-modes" id="vlr-advanced-op">
            <i class="bx bxs-chevron-down"></i>
            <h4>Advanced Options</h4>
          </div>
        </div>
      </div>
    `;
  }

  getAdvancedThreeHTML() {
    return `
      <div class="vlr-advanced-three" id="vlr-advanced-three">
        <div class="vlr-analysis-anim-tab">
          <div class="vlr-advanced-btn tab-button active" data-target="analysis-results">
            <i class="fa-solid fa-chart-simple"></i>
            <h4>Model Statistics</h4>
          </div>
          <div class="vlr-advanced-btn tab-button" data-target="feature-panel">
            <i class="fa-solid fa-layer-group"></i>
            <h4>Features Tab</h4>
          </div>
        </div>

        <div id="ui-panel">
          <div class="vlr-advanced-left">
            <div class="vlr-model-options-info tab-content active" id="analysis-results">
              <h4>Model Statistics</h4>
            </div>
          </div>

          <div class="vlr-advanced-right vlr-feature-grid tab-content" id="feature-panel" data-vlr-role="feature-grid">
            ${this.getFeaturePanelHTML()}
          </div>
        </div>

        <div class="input-wrapper">
          <h5>Mesh Rotation</h5>
          <input type="range" id="meshRotationSlider" name="min_val" class="range-slide"
                 min="0" max="360" value="0">
          <div class="tooltip"></div>
        </div>
      </div>
    `;
  }

  getFeaturePanelHTML() {
    const features = [
      { id: 'toggle-bounding-volumes', icon: 'fa-cube', title: 'Bounding Box' },
      { id: 'toggle-normals', icon: 'fa-arrows-up-down-left-right', title: 'Show Normals' },
      { id: 'toggle-uv-preview', icon: 'fa-border-all', title: 'UV Layout' },
      { id: 'toggle-cross-section', icon: 'fa-slash', title: 'Cross Section' },
      { id: 'toggle-mesh-analysis', icon: 'fa-layer-group', title: 'Mesh Inspector' },
      { id: 'toggle-performance', icon: 'fa-gauge-high', title: 'Performance Monitor' },
      { id: 'toggle-director-mode', icon: 'fa-video', title: 'Director Mode' },
      { id: 'toggle-turntable-plus', icon: 'fa-rotate', title: 'Turntable Mode' },
      { id: 'toggle-material-inspector', icon: 'fa-fill-drip', title: 'Material Inspector' }
    ];

    let html = '';
    for (let i = 0; i < features.length; i += 3) {
      html += '<div class="vlr-advanced-right-grid">';
      for (let j = i; j < i + 3 && j < features.length; j++) {
        const feature = features[j];
        html += `
          <div class="vlr-advanced-btn" id="${feature.id}">
            <i class="fa-solid ${feature.icon}"></i>
            <h4>${feature.title}</h4>
          </div>
        `;
      }
      html += '</div>';
    }
    return html;
  }

  getHdriContainerHTML() {
    return `
      <div class="vlr-hdri-container vlr-hdri-panel" data-vlr-role="hdri-panel">
        <div class="vlr-hdri-title">
          <div class="vlr-hdri-switch-container">
            <div class="vlr-hdri-info-parent">
              <p class="vlr-hdri-info">Turn HDRI On and Off</p>
            </div>
            <label class="vlr-hdri-switch">
              <input type="checkbox" id="vlr-hdri-off" class="vlr-hdri-off" checked>
              <span class="vlr-hdri-slider"></span>
            </label>
          </div>
          <h2>HDRI Options</h2>
        </div>

        <div class="swiper-container">
          <div class="swiper-wrapper hdri-selector">
            ${this.getHDRIOptionsHTML()}
          </div>
        </div>
      </div>
    `;
  }

  getHDRIOptionsHTML() {
    const hdriOptions = [
      { path: _hdr('lonely_road_afternoon_puresky_4k.hdr'), image: _hdrImg('lonely_road_afternoon_puresky.jpeg'), title: 'Lonely Road Afternoon', active: true },
      { path: _hdr('little_paris_eiffel_tower_4k.hdr'), image: _hdrImg('little_paris_eiffel_tower.jpeg'), title: 'Little Paris Eiffel Tower' },
      { path: _hdr('photo_studio_01_4k.hdr'), image: _hdrImg('photo_studio_01.jpeg'), title: 'Photo Studio 01' },
      { path: _hdr('venice_sunset_4k.hdr'), image: _hdrImg('venice_sunset.jpeg'), title: 'Venice Sunset' },
      { path: _hdr('studio_small_03_4k.hdr'), image: _hdrImg('studio_small_03.jpeg'), title: 'Studio Small 03' },
      { path: _hdr('studio_small_09_4k.hdr'), image: _hdrImg('studio_small_09.jpeg'), title: 'Studio Small 09' },
      { path: _hdr('kloofendal_48d_partly_cloudy_4k.hdr'), image: _hdrImg('kloofendal_48d_partly_cloudy.jpeg'), title: 'Kloofendal 48d Partly Cloudy' }
    ];

    return hdriOptions.map(option => `
      <div class="swiper-slide hdri-option ${option.active ? 'active' : ''}" data-hdri="${option.path}">
        <img src="${option.image}" alt="${option.title}">
        <p>${option.title}</p>
      </div>
    `).join('');
  }








  destroy() {
    this.clearVisualToolkitIdleTimer();
    if (this.uiManager) {
      this.uiManager.dispose();
    }

    this.eventListeners.forEach((events, element) => {
      events.forEach(({ event, handler }) => {
        element.removeEventListener(event, handler);
      });
    });
    this.eventListeners.clear();

    this.observers.forEach(observer => observer.disconnect());
    this.observers.clear();
  }
}

/**
 * Utility functions and helpers
 */
const VolareHelpers = {
  isMobile(breakpoint = 1400) {
    return window.innerWidth <= breakpoint;
  },

  isTablet(breakpoint = 1150) {
    return window.innerWidth <= breakpoint;
  },

  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  throttle(func, limit) {
    let inThrottle;
    return function(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }
};

/**
 * Quick Setup API - Easy one-liner setup
 */
const VolareQuickSetup = {
  /**
   * Initialize Volare with custom button configurations
   * @param {Object} options - Configuration options
   */
  init(options = {}) {
    const volareInstance = new VolareCanvas(options);

    // Setup additional custom buttons if provided
    if (options.customButtons) {
      options.customButtons.forEach(buttonConfig => {
        volareInstance.uiManager.buttonManager.registerButton(
          buttonConfig.id,
          buttonConfig.options
        );
      });
    }

    // Setup custom themes if provided
    if (options.customThemes) {
      Object.entries(options.customThemes).forEach(([name, theme]) => {
        volareInstance.uiManager.buttonManager.createTheme(name, theme);
      });
    }

    return volareInstance;
  },

  /**
   * Create a simple button with minimal configuration
   * @param {string} id - Button ID
   * @param {Function} onClick - Click handler
   * @param {Object} options - Additional options
   */
  createButton(id, onClick, options = {}) {
    const buttonManager = new ButtonManager();
    return buttonManager.registerButton(id, {
      callbacks: { onClick },
      ...options
    });
  },

  /**
   * Create a button group with shared behavior
   * @param {Array} buttonIds - Array of button IDs
   * @param {Object} sharedConfig - Shared configuration
   */
  createButtonGroup(buttonIds, sharedConfig = {}) {
    const buttonManager = new ButtonManager();
    return buttonManager.registerButtonGroup(buttonIds, sharedConfig);
  }
};

// Export for module use
export {
  VolareCanvas,
  UIManager,
  UIManager as ViewerUIController,
  ButtonManager,
  VolareHelpers,
  VolareDOMManager,
  VolareQuickSetup
};
