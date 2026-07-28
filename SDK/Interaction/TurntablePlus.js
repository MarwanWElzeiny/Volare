const TWO_PI = Math.PI * 2;

export class TurntablePlus {
  constructor(scene, camera, renderer, controls, model) {
    this.model = model;
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;
    this.isActive = false;
    // Radians per second, not per frame -- constant angular velocity
    // regardless of the display's refresh rate.
    this.angularVelocity = 0.6;
    this._angle = 0;
    this._baseRotationY = 0;
  }

  activate() {
    this.isActive = true;
    this._angle = 0;
    // Preserve whatever orientation the model is already in (e.g. from a
    // manual reset) instead of snapping it back to zero -- the sweep starts
    // fresh from the current pose rather than from an absolute rotation of 0.
    const model = this.currentModel || this.model;
    this._baseRotationY = model ? model.rotation.y : 0;
  }

  deactivate() {
    this.isActive = false;
  }

  setModel(model) {
    this.currentModel = model;
  }

  // Driven by the main render loop's per-frame tick (see AnalysisController.update()),
  // not by its own requestAnimationFrame loop. A second, independent rAF loop
  // racing the renderer's own frame scheduling (renderer.setAnimationLoop, which
  // on the WebGPU backend has different internal timing than plain rAF) is what
  // caused the visible stutter -- the two loops could fire in either order, or
  // skip a beat relative to each other, on any given frame.
  update(deltaTime) {
    if (!this.isActive) return;
    const model = this.currentModel || this.model;
    if (!model || !deltaTime) return;

    // Each step adds angularVelocity*deltaTime and wraps modulo 2*PI, so the
    // stored angle never grows unbounded -- per-step float error doesn't
    // compound across a long-running session the way an ever-growing
    // unwrapped accumulator would.
    this._angle = (this._angle + this.angularVelocity * deltaTime) % TWO_PI;
    model.rotation.y = this._baseRotationY + this._angle;
  }
}
