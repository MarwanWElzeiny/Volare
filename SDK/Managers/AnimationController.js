import * as THREE from 'three';

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export class AnimationManager {
  constructor() {
    this.mixer = null;
    this.animations = [];
    this.activeActions = [];
    this.isPlaying = false;
    this.isPaused = false;
    this.currentAnimationIndex = 0;
    this.currentLoopMode = 'loop';
    this.currentFrame = 0;
    this.totalFrames = 0;
    this.frameRate = 60;
    this.holdInterval = null;
    this.holdTimeout = null;
    this.isHolding = false;
    this.eventCleanups = [];
    this.disposed = false;
  }

  addTrackedEventListener(element, event, handler, options) {
    if (!element || typeof element.addEventListener !== 'function') return;
    element.addEventListener(event, handler, options);
    this.eventCleanups.push(() => element.removeEventListener(event, handler, options));
  }

  cleanupAnimationEvents() {
    this.eventCleanups.splice(0).forEach(cleanup => {
      try { cleanup(); } catch (error) { console.warn('[AnimationManager] listener cleanup failed:', error); }
    });
  }

  closeVisualToolkitPanels() {
    document.getElementById('vlr-visual-toolkit')?.classList.remove('active');
    document.getElementById('vlr-advanced-three')?.classList.remove('active');
    document.body.classList.remove('volare-advanced-open');
  }

  loadAnimations(modelData, model) {
    this.dispose();
    this.disposed = false;
    this.refreshAnimationPanelVisibility();
    const animations = modelData?.animations ?? [];
    if (animations && animations.length > 0) {
      this.mixer = new THREE.AnimationMixer(model.scene || model);
      this.animations = animations;
      this.activeActions = animations.map(animation => {
        const action = this.mixer.clipAction(animation);
        action.setLoop(THREE.LoopRepeat);
        action.paused = false;
        return action;
      });
      this.totalFrames = Math.ceil(this.getTotalDuration() * this.frameRate);
      const panel = document.getElementById('animation-panel');
      const btn = document.getElementById('animation-btn');
      if (panel) {
        panel.classList.add('vlr-anim-active');
        panel.style.display = "block";
      }
      if (btn) {
        btn.classList.add('vlr-anim-active');
        btn.style.display = "block";
      }
      try {
        this.createAnimationUI();
        this.syncPlaybackStateFromActions();
      } catch (error) {
        console.warn('[AnimationManager] Animation UI setup failed:', error);
        this.dispose();
        return false;
      }
      return true;
    }
    this.refreshAnimationPanelVisibility();
    return false;
  }

  playAnimation(index = 0) {
    if (!this.activeActions[index]) return;

    if (this.isPlaying && this.currentAnimationIndex === index) {
      this.stopAllAnimations();
    } else {
      this.stopAllAnimations();
      this.activeActions[index].paused = false;
      this.activeActions[index].reset().play();
      this.isPlaying = true;
      this.isPaused = false;
      this.currentAnimationIndex = index;
      this.currentFrame = 1;
      this.updateAnimationStatus('Playing');
    }
    this.syncPlaybackStateFromActions();
  }

  togglePlayPause() {
    if (!this.activeActions.length) return;
    if (!this.isPlaying && !this.isPaused) {
      this.playAnimation(this.currentAnimationIndex || 0);
    } else if (this.isPlaying) {
      this.pauseAnimations();
    } else if (this.isPaused) {
      this.resumeAnimations();
    }
  }

  pauseAnimations() {
    if (!this.isPlaying) return;
    this.activeActions.forEach(action => {
      action.paused = true;
    });
    this.isPlaying = false;
    this.isPaused = true;
    this.syncPlaybackStateFromActions();
  }

  resumeAnimations() {
    if (!this.isPaused) return;
    this.activeActions.forEach(action => {
      if (action.paused) {
        action.paused = false;
      }
    });
    this.isPaused = false;
    this.isPlaying = true;
    this.syncPlaybackStateFromActions();
  }

  nextClip() {
    if (!this.animations.length) return;
    const nextIndex = (this.currentAnimationIndex + 1) % this.animations.length;
    this.playAnimation(nextIndex);
  }

  previousClip() {
    if (!this.animations.length) return;
    const previousIndex = (this.currentAnimationIndex - 1 + this.animations.length) % this.animations.length;
    this.playAnimation(previousIndex);
  }

  playAllAnimations() {
    this.activeActions.forEach(action => {
      action.paused = false;
      action.reset().play();
    });
    this.isPlaying = true;
    this.isPaused = false;
    this.currentFrame = 1;
    this.updateAnimationStatus('Playing');
    this.syncPlaybackStateFromActions();
  }

  stopAllAnimations() {
    this.activeActions.forEach(action => {
      action.paused = false;
      action.stop();
    });
    this.isPlaying = false;
    this.isPaused = false;
    this.currentFrame = 0;
    this.updateAnimationStatus('Stopped');
    this.updateProgressBar(0);
    this.updateCurrentFrame(1);
    this.syncPlaybackStateFromActions('Stopped');
  }

  setAnimationSpeed(speed = 1.0) {
    this.activeActions.forEach(action => {
      action.setEffectiveTimeScale(speed);
    });
    this.updateSpeedPresetButtons(speed);
    const speedValue = document.getElementById('speed-value');
    if (speedValue) speedValue.textContent = speed.toFixed(1) + 'x';
  }

  syncAnimationToCurrentFrame() {
    if (!this.mixer || !this.activeActions.length) return;
    const currentFrame = this.getCurrentFrame();
    const targetTime = (currentFrame - 1) / this.frameRate;
    this.activeActions.forEach(action => {
      if (action.getClip().duration > 0) {
        const normalizedTime = Math.min(targetTime / action.getClip().duration, 1);
        action.time = normalizedTime * action.getClip().duration;
      }
    });
  }

  forceRenderCurrentPose() {
    if (this.mixer && !this.isPlaying) {
      this.mixer.update(0);
    }
  }

  navigateFrame(direction) {
    if (!this.mixer || this.isPlaying) return;

    const currentFrame = this.getCurrentFrame();
    let newFrame = currentFrame + direction;
    newFrame = Math.max(1, Math.min(newFrame, this.totalFrames));

    if (newFrame !== currentFrame) {
      this.seekToFrame(newFrame);
      this.updateCurrentFrame(newFrame);
      this.currentFrame = newFrame;
    }
  }

  startHoldNavigation(direction) {
    if (this.isHolding || this.isPlaying) return;

    this.isHolding = true;
    this.navigateFrame(direction);

    this.holdTimeout = setTimeout(() => {
      if (this.isHolding) {
        this.holdInterval = setInterval(() => {
          if (this.isHolding) {
            this.navigateFrame(direction);
          }
        }, 100);
      }
    }, 300);
  }

  stopHoldNavigation() {
    this.isHolding = false;
    if (this.holdTimeout) {
      clearTimeout(this.holdTimeout);
      this.holdTimeout = null;
    }
    if (this.holdInterval) {
      clearInterval(this.holdInterval);
      this.holdInterval = null;
    }
  }

  seekToFrame(frameNumber) {
    if (!this.mixer || !this.activeActions.length) return;

    const totalDuration = this.getTotalDuration();
    const targetTime = (frameNumber - 1) / this.frameRate;

    this.activeActions.forEach(action => {
      if (action.getClip().duration > 0) {
        const normalizedTime = Math.min(targetTime / action.getClip().duration, 1);
        action.time = normalizedTime * action.getClip().duration;
      }
    });

    this.currentFrame = frameNumber;
    this.updateProgressBar(targetTime / totalDuration);
    this.forceRenderCurrentPose();
  }

  seekToPercentage(percentage) {
    if (!this.totalFrames) return;
    const clamped = Math.max(0, Math.min(100, percentage));
    const frame = Math.max(1, Math.round((clamped / 100) * this.totalFrames));
    this.seekToFrame(frame);
    this.updateCurrentFrame(frame);
  }

  setLoopMode(mode) {
    this.currentLoopMode = mode;
    this.activeActions.forEach(action => {
      switch(mode) {
        case 'loop':
          action.setLoop(THREE.LoopRepeat);
          break;
        case 'once':
          action.setLoop(THREE.LoopOnce);
          action.clampWhenFinished = true;
          break;
        case 'pingpong':
          action.setLoop(THREE.LoopPingPong);
          break;
      }
    });
  }

  getCurrentTime() {
    if (!this.mixer || !this.activeActions.length) return 0;
    const activeAction = this.activeActions.find(action => action.isRunning());
    if (activeAction) return activeAction.time;
    return (this.currentFrame - 1) / this.frameRate;
  }

  getCurrentFrame() {
    if (!this.mixer || !this.activeActions.length) return this.currentFrame || 1;

    if (this.isPaused || !this.isPlaying) {
      return this.currentFrame || 1;
    }

    const activeAction = this.activeActions.find(action => action.isRunning());
    if (activeAction) {
      const progress = activeAction.time / activeAction.getClip().duration;
      const calculatedFrame = Math.ceil(progress * this.totalFrames) || 1;
      this.currentFrame = calculatedFrame;
      return calculatedFrame;
    }

    return this.currentFrame || 1;
  }

  getCurrentAnimationProgress() {
    if (!this.mixer || !this.activeActions.length) return 0;
    const activeAction = this.activeActions.find(action => action.isRunning());
    if (activeAction) return activeAction.time / activeAction.getClip().duration;
    if (this.isPaused && this.totalFrames > 0) {
      return (this.currentFrame - 1) / this.totalFrames;
    }
    return 0;
  }

  getTotalDuration() {
    if (!this.animations.length) return 0;
    return this.animations.reduce((total, anim) => Math.max(total, anim.duration), 0);
  }

  getTotalFrames() {
    return this.totalFrames;
  }

  updateAnimationStatus(status) {
    const statusElement = document.getElementById('anim-status');
    if (statusElement) statusElement.textContent = status;
  }

  updateCurrentFrame(frame) {
    const frameElement = document.getElementById('current-frame');
    if (frameElement) frameElement.textContent = `${frame} / ${this.getTotalFrames()}`;
  }

  updateSpeedPresetButtons(speed) {
    document.querySelectorAll('.speed-preset-btn').forEach(btn => {
      btn.classList.remove('active');
      if (Math.abs(parseFloat(btn.dataset.speed) - speed) < 0.05) btn.classList.add('active');
    });
  }

  updateAnimationProgress() {
    if (!this.isPlaying) return;
    const progress = this.getCurrentAnimationProgress();
    const currentFrame = this.getCurrentFrame();
    this.updateProgressBar(progress);
    this.updateCurrentFrame(currentFrame);
    if (progress >= 1 && this.currentLoopMode === 'once') {
      this.updateAnimationStatus('Completed');
      this.isPlaying = false;
      this.isPaused = false;
      this.syncPlaybackStateFromActions('Stopped');
    }
  }

  update(deltaTime) {
    if (!this.mixer || this.disposed) return;
    if (!this.isPlaying) return;

    this.mixer.update(deltaTime);

    const hasRunningAnimations = this.activeActions.some(action => action.isRunning() && !action.paused);
    if (this.isPlaying && !hasRunningAnimations) {
      this.isPlaying = false;
      this.isPaused = false;
      this.syncPlaybackStateFromActions('Stopped');
    }

    if (this.isPlaying) {
      this.updateAnimationProgress();
    }
  }

  getRealPlaybackState() {
    return this.activeActions.some(action => action.isRunning() && !action.paused);
  }

  syncPlaybackStateFromActions(statusOverride = null) {
    const realPlaying = this.getRealPlaybackState();
    if (!statusOverride) {
      this.isPlaying = realPlaying;
      if (!realPlaying && !this.isPaused) {
        this.isPaused = this.activeActions.some(action => action.paused);
      }
    }

    if (statusOverride) {
      this.updateAnimationStatus(statusOverride);
    } else {
      this.updateAnimationStatus(this.isPlaying ? 'Playing' : (this.isPaused ? 'Paused' : 'Stopped'));
    }

    this.updatePauseButton();
    this.updateFrameButtonState();
    return this.isPlaying;
  }

  updatePauseButton() {
    const pauseBtn = document.getElementById('pause-anims');
    if (!pauseBtn) return;
    const icon = pauseBtn.querySelector('i');
    const label = pauseBtn.querySelector('h4');
    if (!icon) return;

    if (this.isPlaying) {
      icon.classList.add('fa-pause');
      icon.classList.remove('fa-play');
      if (label) label.textContent = 'Pause';
    } else {
      icon.classList.add('fa-play');
      icon.classList.remove('fa-pause');
      if (label) label.textContent = 'Play';
    }
    pauseBtn.style.pointerEvents = 'all';
    pauseBtn.style.opacity = '1';
  }

  updateFrameButtonState() {
    const prevBtn = document.getElementById('prev-frame');
    const nextBtn = document.getElementById('next-frame');
    const enabled = !this.isPlaying;

    [prevBtn, nextBtn].forEach(btn => {
      if (!btn) return;
      btn.setAttribute('aria-disabled', enabled ? 'false' : 'true');
      btn.style.pointerEvents = enabled ? 'all' : 'none';
      btn.style.opacity = enabled ? '1' : '0.35';
    });
  }

  createAnimationUI() {
    const animationPanel = document.getElementById('animation-panel');
    const animationBtn = document.getElementById('animation-btn');
    if (!animationPanel) return;
    animationPanel.classList.add('vlr-anim-active');
    animationBtn?.classList.add('vlr-anim-active');

    const totalDuration = this.getTotalDuration();

    let animationHTML = `
      <div class="vlr-animation-grid">
        <div class="vlr-animation-grid-left">
          <div class="frame-controls">
            <div class="animation-controls">
              <div class="vlr-main-anim-controls">
                <div class="vlr-advanced-anim-button" id="pause-anims">
                  <i class="fa-solid fa-play"></i>
                  <h4>Play</h4>
                </div>
                <div class="vlr-advanced-anim-button" id="prev-frame" aria-disabled="false">
                  <i class="fa-solid fa-backward"></i>
                  <h4>Prev Frame</h4>
                </div>
                <div class="vlr-advanced-anim-button" id="next-frame" aria-disabled="false">
                  <i class="fa-solid fa-forward"></i>
                  <h4>Next Frame</h4>
                </div>
              </div>
            </div>
          </div>

          <div class="animation-selector-container">
            <button class="animation-selector-btn" id="animation-selector-btn" aria-label="Select Animation">
              <span id="selected-animation-name">Playback Options</span>
              <i class="fa-solid fa-chevron-down"></i>
            </button>

            <div class="vlr-playback-options" id="playback-dropdown">
              <div class="speed-control">
                <div class="display-mode-container">
                  <label for="display-mode">Display Mode</label>
                  <select class="vlr-advanced-anim-preset" id="display-mode">
                    <option value="time">Time (mm:ss)</option>
                    <option value="frames">Frames</option>
                  </select>
                </div>

                <div class="speed-select-container">
                  <label for="speed-select">Speed</label>
                  <select class="vlr-advanced-anim-preset" id="speed-select">
                    <option value="0.5">0.5x</option>
                    <option value="1" selected>1x</option>
                    <option value="1.5">1.5x</option>
                    <option value="2">2x</option>
                    <option value="4">4x</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>

                <div class="speed-slider-container" id="custom-speed-slider" style="display: none;">
                  <label for="speed-slider">Custom:</label>
                  <input type="range" id="speed-slider" min="0.1" max="5" step="0.1" value="1">
                  <span id="speed-value">1.0x</span>
                </div>

                <div class="playback-mode-container">
                  <label for="vlr-playback-speed">Playback Mode</label>
                  <select class="vlr-advanced-anim-preset" id="vlr-playback-speed">
                    <option value="loop">Loop</option>
                    <option value="once">Play Once</option>
                    <option value="pingpong">Ping Pong</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="vlr-animation-grid-right">
          <div class="animation-info">
            <div class="info-row">
              <span class="info-value" id="current-time">${this.formatTime(0)}</span>
            </div>
            <div class="animation-progress" id="animation-progress">
              <div class="progress-fill" id="progress-bar"></div>
            </div>
            <div class="info-row info-row-duration">
              <span class="info-value" id="total-duration">${this.formatTime(totalDuration)}</span>
            </div>
          </div>
        </div>

        <div class="animation-list">
          ${this.animations.map((animation, index) => `
            <button class="play-single-anim" data-index="${index}">
              ${escapeHTML(animation.name || `Clip ${index + 1}`)}
            </button>
          `).join('')}
        </div>
      </div>
    `;

    animationPanel.innerHTML = animationHTML;
    this.setupAnimationEvents();
    this.initializeAnimationControls();
    this.syncPlaybackStateFromActions();
  }

  initializeAnimationControls() {
    const animationSelectorBtn = document.getElementById('animation-selector-btn');
    const playbackDropdown = document.getElementById('playback-dropdown');
    const displayModeSelect = document.getElementById('display-mode');
    const speedSelect = document.getElementById('speed-select');
    const customSpeedSlider = document.getElementById('custom-speed-slider');
    const speedSlider = document.getElementById('speed-slider');
    const speedValue = document.getElementById('speed-value');
    const progressBar = document.getElementById('animation-progress');

    let currentDisplayMode = 'time';

    if (!animationSelectorBtn || !playbackDropdown || !displayModeSelect || !speedSelect || !customSpeedSlider || !speedSlider || !speedValue || !progressBar) return;

    this.addTrackedEventListener(animationSelectorBtn, 'click', (e) => {
      e.stopPropagation();
      this.closeVisualToolkitPanels();
      playbackDropdown.classList.toggle('active');
    });

    this.addTrackedEventListener(document, 'click', (e) => {
      if (!playbackDropdown.contains(e.target) && !animationSelectorBtn.contains(e.target)) {
        playbackDropdown.classList.remove('active');
      }
    });

    this.addTrackedEventListener(playbackDropdown, 'click', (e) => {
      e.stopPropagation();
    });

    this.addTrackedEventListener(displayModeSelect, 'change', (e) => {
      currentDisplayMode = e.target.value;
      this.updateDisplayMode(currentDisplayMode);
    });

    this.addTrackedEventListener(speedSelect, 'change', (e) => {
      const value = e.target.value;
      if (value === 'custom') {
        customSpeedSlider.style.display = 'flex';
        const customSpeed = parseFloat(speedSlider.value);
        this.setAnimationSpeed(customSpeed);
      } else {
        customSpeedSlider.style.display = 'none';
        const speed = parseFloat(value);
        this.setAnimationSpeed(speed);
      }
    });

    this.addTrackedEventListener(speedSlider, 'input', (e) => {
      const speed = parseFloat(e.target.value);
      speedValue.textContent = speed.toFixed(1) + 'x';
      this.setAnimationSpeed(speed);
    });

    this.addTrackedEventListener(progressBar, 'click', (e) => {
      const rect = progressBar.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const percentage = Math.max(0, Math.min(100, (clickX / rect.width) * 100));
      this.seekToPercentage(percentage);
    });

    this.currentDisplayMode = currentDisplayMode;
  }

  updateDisplayMode(mode) {
    this.currentDisplayMode = mode;
    const currentTimeEl = document.getElementById('current-time');
    const totalDurationEl = document.getElementById('total-duration');
    if (!currentTimeEl || !totalDurationEl) return;

    if (mode === 'frames') {
      currentTimeEl.textContent = this.getCurrentFrame();
      totalDurationEl.textContent = this.getTotalFrames();
    } else {
      currentTimeEl.textContent = this.formatTime(this.getCurrentTime());
      totalDurationEl.textContent = this.formatTime(this.getTotalDuration());
    }
  }

  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  updateProgressBar(progress) {
    const progressFill = document.getElementById('progress-bar');
    if (progressFill) {
      progressFill.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
    }

    const mode = this.currentDisplayMode || 'time';
    const currentTimeEl = document.getElementById('current-time');

    if (mode === 'frames') {
      if (currentTimeEl) currentTimeEl.textContent = `${this.getCurrentFrame()}`;
    } else {
      if (currentTimeEl) currentTimeEl.textContent = this.formatTime(this.getCurrentTime());
    }
  }

  setupAnimationEvents() {
    const animPanelEl = document.getElementById('animation-panel');
    if (animPanelEl) {
      this.addTrackedEventListener(animPanelEl, 'click', (e) => e.stopPropagation());
    }

    const pauseBtn = document.getElementById('pause-anims');
    const prevButton = document.getElementById('prev-frame');
    const nextButton = document.getElementById('next-frame');

    // Speed presets (.speed-preset-btn) and the #anim-speed slider are handled in
    // initializeAnimationControls via #speed-select / #speed-slider — no duplicate wiring here.

    this.addTrackedEventListener(prevButton, 'mousedown', () => this.startHoldNavigation(-1));
    this.addTrackedEventListener(prevButton, 'mouseup', () => this.stopHoldNavigation());
    this.addTrackedEventListener(prevButton, 'mouseleave', () => this.stopHoldNavigation());

    this.addTrackedEventListener(nextButton, 'mousedown', () => this.startHoldNavigation(1));
    this.addTrackedEventListener(nextButton, 'mouseup', () => this.stopHoldNavigation());
    this.addTrackedEventListener(nextButton, 'mouseleave', () => this.stopHoldNavigation());

    this.addTrackedEventListener(prevButton, 'touchstart', (e) => { e.preventDefault(); this.startHoldNavigation(-1); });
    this.addTrackedEventListener(prevButton, 'touchend', (e) => { e.preventDefault(); this.stopHoldNavigation(); });
    this.addTrackedEventListener(nextButton, 'touchstart', (e) => { e.preventDefault(); this.startHoldNavigation(1); });
    this.addTrackedEventListener(nextButton, 'touchend', (e) => { e.preventDefault(); this.stopHoldNavigation(); });

    this.addTrackedEventListener(document.getElementById('vlr-playback-speed'), 'change', (event) => {
      this.setLoopMode(event.target.value);
    });

    this.addTrackedEventListener(pauseBtn, 'click', () => {
      this.togglePlayPause();
    });

    document.querySelectorAll('.play-single-anim').forEach(button => {
      this.addTrackedEventListener(button, 'click', (e) => {
        const index = parseInt(e.target.dataset.index);
        this.playAnimation(index);
      });
    });
  }

  dispose() {
    this.disposed = true;
    this.cleanupAnimationEvents();
    const animationPanel = document.getElementById('animation-panel');
    const animationBtn = document.getElementById('animation-btn');
    animationPanel?.classList.remove('vlr-anim-active');
    animationBtn?.classList.remove('vlr-anim-active');
    this.stopHoldNavigation();

    if (this.holdInterval) {
      clearInterval(this.holdInterval);
      this.holdInterval = null;
    }
    if (this.holdTimeout) {
      clearTimeout(this.holdTimeout);
      this.holdTimeout = null;
    }

    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.mixer.getRoot());
      this.mixer = null;
    }

    this.activeActions.forEach(action => { action.paused = false; });
    this.animations = [];
    this.activeActions = [];
    this.isPlaying = false;
    this.isPaused = false;
    this.currentAnimationIndex = 0;
    this.currentFrame = 0;
    this.totalFrames = 0;
    this.currentLoopMode = 'loop';
    this.isHolding = false;

    const panel = document.getElementById('animation-panel');
    const btn = document.getElementById('animation-btn');
    if (panel) {
      panel.classList.remove('vlr-anim-active');
      panel.style.display = "none";
      panel.innerHTML = '';
    }
    if (btn) {
      btn.classList.remove('vlr-anim-active');
      btn.style.display = "none";
    }
    this.refreshAnimationPanelVisibility();
  }

  refreshAnimationPanelVisibility() {
    const hasAnimations = this.animations && this.animations.length > 0;
    const panel = document.getElementById('animation-panel');
    const btn = document.getElementById('animation-btn');
    if (panel) {
      if (hasAnimations) {
        panel.classList.add('vlr-anim-active');
        panel.style.display = "block";
        if (btn) {
          btn.classList.add('vlr-anim-active');
          btn.style.display = "block";
        }
      } else {
        panel.classList.remove('vlr-anim-active');
        panel.style.display = "none";
        if (btn) {
          btn.classList.remove('vlr-anim-active');
          btn.style.display = "none";
        }
      }
    }
  }
}

export { AnimationManager as AnimationController };
