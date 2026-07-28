// volare-init.js — Edit this to configure your demo viewer.

export const defaultModel = 'avocado';

export const modelProfiles = {
  avocado: {
    label: 'Avocado',
    model: './models/Avocado/glTF/Avocado.gltf',
    hdri: './models/HDRI/studio_small_03_4k.hdr'
  },
  brainstem: {
    label: 'BrainStem',
    model: './models/BrainStem/glTF/BrainStem.gltf',
    hdri: './models/HDRI/lonely_road_afternoon_puresky_4k.hdr'
  },
  flyingknee: {
    label: 'Flying Knee Combo (FBX)',
    model: './models/Mannequin/Model/Flying Knee Punch Combo.fbx',
    hdri: './models/HDRI/photo_studio_01_4k.hdr'
  }
};

export const defaultHdri = './models/HDRI/studio_small_03_4k.hdr';

export const viewer = {
  antialias: true,
  enableShadows: true,
  fov: 30
};

export const tools = {
  'toggle-bounding-volumes': true,
  'toggle-normals': true,
  'toggle-uv-preview': true,
  'toggle-cross-section': true,
  'toggle-mesh-analysis': true,
  'toggle-performance': true,
  'toggle-director-mode': true,
  'toggle-turntable-plus': true,
  'toggle-material-inspector': true
};

// Reorders feature-panel buttons in direct.html; empty = keep default order.
export const toolOrder = [];

// Passed to DemoBootstrap's applyTheme(); null = use the default theme.
export const theme = null;

// Reserved for direct.html's environment override; unused today.
export const environment = null;

export function getModelConfig(profileKey) {
  const profile = modelProfiles[profileKey || defaultModel];
  if (!profile) return modelProfiles[defaultModel];
  return { ...profile, hdri: profile.hdri || defaultHdri };
}
