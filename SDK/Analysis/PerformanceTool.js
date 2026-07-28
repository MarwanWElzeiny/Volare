export class PerformanceMonitor {
  constructor(container) {
    this.container = container || null;
    this.stats = {
      fps: 0,
      frameTime: 0,
      memory: 0,
      drawCalls: 0
    };
    this.frameCount = 0;
    this.lastTime = performance.now();
    this.isActive = false;
    this.displayElement = null;
  }

  activate() {
    if (this.isActive) return;
    this.isActive = true;
    this.createDisplay();
  }

  deactivate() {
    this.isActive = false;
    if (this.displayElement) {
      if (this.displayElement.parentNode) {
        this.displayElement.parentNode.removeChild(this.displayElement);
      }
      this.displayElement = null;
    }
  }

  createDisplay() {
    // Reuse existing element if present (avoid duplicates on rapid toggle)
    let DetailedData = document.getElementById('vlr-model-attr-data');
    if (!DetailedData) {
      DetailedData = document.createElement('div');
      DetailedData.id = 'vlr-model-attr-data';
    }
    // Always re-apply style so toggle off/on doesn't lose panel appearance
    Object.assign(DetailedData.style, {
      position: 'absolute',
      top: '10px',
      left: '10px',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      color: '#fff',
      padding: '12px 16px',
      fontFamily: 'monospace',
      fontSize: '14px',
      borderRadius: '10px',
      zIndex: '1000',
      lineHeight: '1.5',
      pointerEvents: 'none',
    });
    if (!DetailedData.parentNode) {
      // Scope inside viewer container — not document.body
      const parent = this.container || document.getElementById('model') || document.body;
      if (parent !== document.body && getComputedStyle(parent).position === 'static') {
        parent.style.position = 'relative';
      }
      parent.appendChild(DetailedData);
    }
    this.displayElement = DetailedData;
    DetailedData.style.display = "block";
  }

  update() {
    if (!this.isActive) return;

    const currentTime = performance.now();
    const delta = currentTime - this.lastTime;

    this.frameCount++;

    if (delta >= 1000) {
      this.stats.fps = Math.round((this.frameCount * 1000) / delta);
      this.stats.frameTime = Math.round(delta / this.frameCount * 100) / 100;

      if (performance.memory) {
        this.stats.memory = Math.round(performance.memory.usedJSHeapSize / 1048576);
      }

      this.updateDisplay();

      this.frameCount = 0;
      this.lastTime = currentTime;
    }

  }

  updateDisplay() {
    if (this.displayElement) {
      this.displayElement.innerHTML = `
        FPS: ${this.stats.fps}<br>
        Frame Time: ${this.stats.frameTime}ms<br>
        Memory: ${this.stats.memory}MB<br>
        Draw Calls: ${this.stats.drawCalls}<br>
      `;
    }
  }

  updateRenderStats(renderer, scene) {
    if (renderer.info) {
      this.stats.drawCalls = renderer.info.render.calls;
    }
  }

  dispose() {
    this.deactivate();
  }
}

export { PerformanceMonitor as PerformanceTool };
