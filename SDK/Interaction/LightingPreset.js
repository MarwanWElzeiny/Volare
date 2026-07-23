import * as THREE from 'three';
import { getHdriBasePath } from '../Managers/LightingController.js';

const hdr = (name) => `${getHdriBasePath()}${name}`;

export class LightingPreset {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    // Track only the lights this preset system created, so clearLights() never
    // removes the viewer's own base lights (hemisphere/directional).
    this._presetLights = [];
    this.presets = {
      studio: {
        hdri: hdr('studio_small_09_4k.hdr'),
        exposure: 1.0,
        lights: [
          { type: 'DirectionalLight', color: 0xffffff, intensity: 1, position: [5, 5, 5] },
          { type: 'DirectionalLight', color: 0x4444ff, intensity: 0.3, position: [-5, 2, -2] }
        ]
      },
      outdoor: {
        hdri: hdr('meadow_4k.hdr'),
        exposure: 0.8,
        lights: [
          { type: 'DirectionalLight', color: 0xfff4e6, intensity: 1.2, position: [10, 10, 5] }
        ]
      },
      dramatic: {
        hdri: hdr('cobblestone_street_night_4k.hdr'),
        exposure: 1.5,
        lights: [
          { type: 'SpotLight', color: 0xff4444, intensity: 2, position: [3, 6, 3], angle: 0.3 },
          { type: 'SpotLight', color: 0x4444ff, intensity: 1.5, position: [-3, 4, -2], angle: 0.4 }
        ]
      }
    };
  }

  applyPreset(presetName) {
    const preset = this.presets[presetName];
    if (!preset) return;

    this.clearLights();
    this.renderer.toneMappingExposure = preset.exposure;

    preset.lights.forEach(lightData => {
      const light = this.createLight(lightData);
      this._presetLights.push(light);
      this.scene.add(light);
    });
  }

  createLight(data) {
    let light;
    switch(data.type) {
      case 'DirectionalLight':
        light = new THREE.DirectionalLight(data.color, data.intensity);
        break;
      case 'SpotLight':
        light = new THREE.SpotLight(data.color, data.intensity, 100, data.angle);
        break;
      default:
        light = new THREE.DirectionalLight(data.color, data.intensity);
    }
    light.position.set(...data.position);
    return light;
  }

  clearLights() {
    // Only remove preset-created lights — never the viewer's base scene lights.
    this._presetLights.forEach(light => this.scene.remove(light));
    this._presetLights = [];
  }
}