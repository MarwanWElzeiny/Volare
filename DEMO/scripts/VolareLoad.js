import Volare from "./DemoBootstrap.js";
import * as THREE from 'three';
// Simple one-liner
Volare.createGallery('.gallery .thumbnail');

// Custom configuration
// const volare = await Volare.init({
//   viewer: {
//     fov: 200,
//     antialias: true,
//     toneMappingExposure: 0.0,
//     enableShadows: false,
//     toneMapping: THREE.LinearToneMapping
//   }
// });
// volare.createGallery('.gallery img');
// Manual control
// volare.showCanvas('/model.glb');
// volare.showWithForm('/model.glb');
