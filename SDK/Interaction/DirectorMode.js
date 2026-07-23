import { showTopToast, hideTopToast } from '../UI/TopToast.js';
import * as THREE from 'three';

export class DirectorMode {
  constructor(scene, camera, controls, model) {
    this.model = model;
    this.scene = scene;
    this.camera = camera;
    this.controls = controls;
    this.isActive = false;
    this.currentSequence = null;
    this.sequences = [];
    this.animationId = null;
    this.transitionDuration = 1500; // Faster transitions for more dynamic feel
    this.originalPosition = new THREE.Vector3();
    this.originalTarget = new THREE.Vector3();
    this.originalControlsEnabled = true;
    // Camera shake parameters
    this.shakeIntensity = 0;
    this.shakeDuration = 0;
    this.shakeStartTime = 0;
  }

  activate() {
    this.isActive = true;
    this.originalPosition.copy(this.camera.position);
    if (this.controls.target) {
      this.originalTarget.copy(this.controls.target);
    }
    this.originalControlsEnabled = this.controls.enabled;
    this.controls.enabled = false;

    this.generateCinematicSequences();

    if (this.sequences.length > 0) {
      const firstSequence = this.sequences[0];
      showTopToast("Director Mode", `Now showing: ${firstSequence.name}`, firstSequence.duration);
    }
  }

  deactivate() {
    this.isActive = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    hideTopToast();
    // Re-enable controls
    this.controls.enabled = this.originalControlsEnabled;

    // Restore original camera position with smooth transition.
    // Signature: (targetPos, targetLookAt, targetRoll, dynamicMovement, onComplete)
    this.animateToPosition(this.originalPosition, this.originalTarget, 0, false);
  }
  setModel(model) {
    this.currentModel = model;
  }
  generateCinematicSequences() {
    const model = this.currentModel || this.model;
    if (!model) return;

    const bbox = new THREE.Box3().setFromObject(model);
    if (bbox.isEmpty()) return;
    const center = bbox.getCenter(new THREE.Vector3());
    const sphere = bbox.getBoundingSphere(new THREE.Sphere());
    const safeRadius = sphere.radius * 1.8;

    // Update near/far to avoid clipping
    this.camera.near = Math.max(0.01, safeRadius * 0.01);
    this.camera.far = safeRadius * 20;
    this.camera.updateProjectionMatrix();

    this.sequences = [
      {
        name: "Hero Entrance",
        position: new THREE.Vector3(
          center.x + safeRadius * 1.4,
          center.y - safeRadius * 0.5,
          center.z + safeRadius * 1.1
        ),
        target: center.clone().add(new THREE.Vector3(0, safeRadius * 0.2, 0)),
        duration: 4000,
        cameraRoll: -0.1,
        shake: { intensity: 0.02, duration: 500 }
      },

      {
        name: "Arc Sweep",
        position: new THREE.Vector3(
          center.x + safeRadius * 1.0 * Math.cos(Math.PI / 4),
          center.y + safeRadius * 0.4,
          center.z + safeRadius * 1.0 * Math.sin(Math.PI / 4)
        ),
        target: center,
        duration: 3500,
        cameraRoll: 0.05,
        dynamicMovement: true
      },

      {
        name: "Intimate Detail",
        position: new THREE.Vector3(
          center.x + safeRadius * 0.7,
          center.y + safeRadius * 0.15,
          center.z + safeRadius * 0.8
        ),
        target: center.clone().add(new THREE.Vector3(
          safeRadius * 0.05,
          safeRadius * 0.03,
          0
        )),
        duration: 3000,
        cameraRoll: -0.03
      },

      {
        name: "Aerial View",
        position: new THREE.Vector3(
          center.x - safeRadius * 0.2,
          center.y + safeRadius * 1.6,
          center.z + safeRadius * 0.3
        ),
        target: center,
        duration: 4500,
        cameraRoll: 0.08
      },

      {
        name: "Power Profile",
        position: new THREE.Vector3(
          center.x + safeRadius * 1.8,
          center.y + safeRadius * 0.2,
          center.z - safeRadius * 0.15
        ),
        target: center.clone().add(new THREE.Vector3(0, safeRadius * 0.06, 0)),
        duration: 3200,
        cameraRoll: -0.05
      },

      {
        name: "Power Angle",
        position: new THREE.Vector3(
          center.x - safeRadius * 0.8,
          center.y - safeRadius * 0.6,
          center.z + safeRadius * 1.0
        ),
        target: center.clone().add(new THREE.Vector3(0, safeRadius * 0.25, 0)),
        duration: 3800,
        cameraRoll: 0.12,
        shake: { intensity: 0.015, duration: 300 }
      },

      {
        name: "Dolly Reveal",
        position: new THREE.Vector3(
          center.x - safeRadius * 1.5,
          center.y + safeRadius * 0.5,
          center.z + safeRadius * 1.3
        ),
        target: center.clone().add(new THREE.Vector3(safeRadius * 0.1, 0, 0)),
        duration: 4200,
        cameraRoll: -0.07,
        dynamicMovement: true
      },

      {
        name: "Grand Finale",
        position: new THREE.Vector3(
          center.x + safeRadius * 2.0,
          center.y + safeRadius * 0.9,
          center.z + safeRadius * 1.8
        ),
        target: center,
        duration: 5000,
        cameraRoll: 0,
        shake: { intensity: 0.01, duration: 200 }
      }
    ];

    this.startSequence();
  }

  startSequence() {
    if (this.sequences.length === 0) return;

    let currentIndex = 0;
    const playNext = () => {
      if (!this.isActive) return;

      const sequence = this.sequences[currentIndex];
      this.currentSequence = sequence;

      showTopToast("Director Mode", `Now showing: ${sequence.name}`, sequence.duration);
      // Apply camera shake if specified
      if (sequence.shake) {
        this.shakeIntensity = sequence.shake.intensity;
        this.shakeDuration = sequence.shake.duration;
        this.shakeStartTime = performance.now();
      }

      this.animateToPosition(sequence.position, sequence.target, sequence.cameraRoll, sequence.dynamicMovement, () => {
        currentIndex = (currentIndex + 1) % this.sequences.length;
        // Variable pause between shots for more natural feel
        const pauseDuration = sequence.duration + (Math.random() * 1000 - 500);
        setTimeout(playNext, Math.max(pauseDuration, 1000));
      });
    };

    playNext();
  }

  animateToPosition(targetPos, targetLookAt, targetRoll = 0, dynamicMovement = false, onComplete) {
    // Cancel any in-flight animation before starting a new one
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    const startPos = this.camera.position.clone();
    const startLookAt = this.controls.target ? this.controls.target.clone() : new THREE.Vector3();
    const startRoll = this.camera.rotation.z;
    const startTime = performance.now();

    const animateDirector = () => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / this.transitionDuration, 1);

      // easeOutCubic starts with immediate velocity — no zero-velocity stutter at segment start
      let eased;
      if (dynamicMovement) {
        eased = this.easeInOutQuart(progress);
      } else {
        eased = this.easeOutCubic(progress);
      }

      // Apply dynamic movement variations
      let finalEased = eased;
      if (dynamicMovement && progress > 0.1 && progress < 0.9) {
        // Add subtle oscillation for more organic movement
        const oscillation = Math.sin(progress * Math.PI * 3) * 0.02;
        finalEased = Math.max(0, Math.min(1, eased + oscillation));
      }

      // Interpolate position
      this.camera.position.lerpVectors(startPos, targetPos, finalEased);

      // Interpolate look-at target
      if (this.controls.target && targetLookAt) {
        this.controls.target.lerpVectors(startLookAt, targetLookAt, finalEased);
      }

      // Apply camera roll for cinematic effect
      this.camera.rotation.z = THREE.MathUtils.lerp(startRoll, targetRoll, finalEased);

      // Apply camera shake
      this.applyCameraShake();

      this.controls.update();

      if (progress < 1 && this.isActive) {
        this.animationId = requestAnimationFrame(animateDirector);
      } else if (onComplete) {
        onComplete();
      }
    };

    animateDirector();
  }

  applyCameraShake() {
    if (this.shakeIntensity <= 0) return;

    const elapsed = performance.now() - this.shakeStartTime;
    if (elapsed > this.shakeDuration) {
      this.shakeIntensity = 0;
      return;
    }

    const shakeProgress = elapsed / this.shakeDuration;
    const intensity = this.shakeIntensity * (1 - shakeProgress); // Fade out shake

    const shakeX = (Math.random() - 0.5) * intensity;
    const shakeY = (Math.random() - 0.5) * intensity;
    const shakeZ = (Math.random() - 0.5) * intensity;

    this.camera.position.add(new THREE.Vector3(shakeX, shakeY, shakeZ));
  }

  // Easing functions
  easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
  }

  easeInOutQuart(t) {
    return t < 0.5 ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t;
  }

  easeInOutQuint(t) {
    return t < 0.5 ? 16 * t * t * t * t * t : 1 + 16 * (--t) * t * t * t * t;
  }

  // Method to manually skip to next sequence
  skipToNext() {
    if (!this.isActive || this.sequences.length === 0) return;

    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }

    // Find current sequence index and move to next
    const currentIndex = this.sequences.findIndex(seq => seq === this.currentSequence);
    const nextIndex = (currentIndex + 1) % this.sequences.length;
    const nextSequence = this.sequences[nextIndex];

    this.currentSequence = nextSequence;
    this.animateToPosition(nextSequence.position, nextSequence.target, nextSequence.cameraRoll);
  }

  // Method to get current sequence info
  getCurrentSequenceInfo() {
    return this.currentSequence ? {
      name: this.currentSequence.name,
      isActive: this.isActive,
      totalSequences: this.sequences.length
    } : null;
  }
}