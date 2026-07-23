export class TurntablePlus {
  constructor(scene, camera, renderer, controls, model) {
    this.model = model;
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;
    this.isActive = false;
    this.rotationSpeed = 0.01;
    this.animationId = null;
  }

  activate() {
    this.isActive = true;
    this.startRotation();
  }

  deactivate() {
    this.isActive = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }
  setModel(model) {
    this.currentModel = model;
  }

  startRotation() {
    const animate = () => {
      if (!this.isActive) return;

      if (this.currentModel) {
        this.currentModel.rotation.y += this.rotationSpeed;
      }

      this.animationId = requestAnimationFrame(animate);
    };

    animate();
  }
}