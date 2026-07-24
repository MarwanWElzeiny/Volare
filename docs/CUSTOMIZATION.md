# Volare Customization Guide

## Quick Start

```js
const viewer = await createVolareViewer({
  container: '#viewer',
  model: './Model/Duck/glTF-Binary/Duck.glb'
});
```

## Full Config Reference

```js
const viewer = await createVolareViewer({
  container: '#viewer',       // CSS selector or HTMLElement
  model: './Model/car.glb',   // Model URL (optional)

  ui: true,                   // Enable/disable built-in UI (default: true)

  theme: {
    mode: 'dark',             // Theme mode (default: 'dark')
    accent: '#7aa2ff',        // Accent color → maps to --vlr-accent
    glass: true,              // Glass morphism enabled (default: true)
    density: 'comfortable',   // UI density (default: 'comfortable')
    classPrefix: 'vlr',       // Alias class prefix (default: 'vlr')
    cssVariables: {           // Custom CSS variable overrides
      '--vlr-accent': '#ff6b6b',
      '--vlr-glass-bg': 'linear-gradient(185deg, rgba(20,20,40,0.5), rgba(10,10,30,0.3))',
      '--vlr-text-primary': 'rgba(240, 240, 255, 0.95)'
    }
  },

  layout: {
    mode: 'overlay',          // Layout mode (default: 'overlay')
    width: '90vw',            // Viewer width
    mobileFullscreen: true    // Fullscreen on mobile (default: true)
  },

  environment: {
    enabled: true,
    hdri: null,               // Custom HDR file URL
    preset: null,             // Built-in preset ID
    intensity: 1,
    background: 'current',    // 'current', 'transparent', 'solid', 'blurred'
    backgroundColor: '#000000',
    backgroundBlur: 0.35
  },

  tools: {
    materialInspector: true,
    turntablePlus: true,
    boundingVolumes: true,
    crossSection: true,
    directorMode: true,
    normals: true,
    uvPreview: true,
    vertexFocus: true,
    performance: true
  },

  renderer: {
    preferredBackend: 'webgl', // 'webgl' (default), 'webgpu', or 'auto'
    pixelRatio: 'auto',        // 'auto' or number
    adaptiveQuality: true
  },

  security: {},
  plugins: [],
  diagnostics: false          // Expose extra config in getDiagnostics()
});
```

## Theme & CSS Variables

### Accent Color

```js
await createVolareViewer({
  container: '#viewer',
  theme: { accent: '#ff6b6b' }
});
```

This sets `--vlr-accent` on the viewer container.

### Custom CSS Variables

Pass any `--vlr-*` variable override:

```js
theme: {
  cssVariables: {
    '--vlr-accent': '#00ff88',
    '--vlr-glass-blur': 'blur(20px) saturate(180%)',
    '--vlr-text-primary': '#eee',
    '--vlr-radius': '12px'
  }
}
```

Variables are applied to the viewer container element. They cascade into all child components.

### Disabling Glass

```js
theme: { glass: false }
```

This sets `--vlr-glass-blur: none` and uses opaque backgrounds instead of glass morphism. Useful for low-end devices.

### Available CSS Variables

| Variable | Purpose |
|----------|---------|
| `--vlr-accent` | Accent color |
| `--vlr-bg` | Background color |
| `--vlr-panel-bg` | Panel background |
| `--vlr-glass-bg` | Glass background gradient |
| `--vlr-glass-bg-strong` | Stronger glass background |
| `--vlr-glass-border` | Glass border |
| `--vlr-glass-blur` | Backdrop blur + saturate |
| `--vlr-radius` | Default border radius |
| `--vlr-control-size` | Control button size |
| `--vlr-font-family` | Font family |
| `--vlr-text-primary` | Primary text color |
| `--vlr-text-secondary` | Secondary text color |
| `--vlr-shadow-soft` | Soft shadow |
| `--vlr-shadow-panel` | Panel shadow |
| `--vlr-motion-fast` | Fast transition timing |
| `--vlr-motion-normal` | Normal transition timing |

### Base color channels (retint everything)

Every glass surface, shadow, and dark panel across all components resolves
through a small set of **RGB-triple** tokens. Override one to retint the whole
UI at once — e.g. set `--vlr-surface-rgb` and every glass surface, border, and
highlight retints together. Value is a bare `R, G, B` triple (no `rgb()`).

| Variable | Value form | Purpose |
|----------|-----------|---------|
| `--vlr-surface-rgb` | `255, 255, 255` | All light/glass surfaces, borders, highlights |
| `--vlr-shadow-rgb` | `0, 0, 0` | All shadows and dark scrims |
| `--vlr-surface-dark-rgb` | `10, 10, 10` | Dark glass (advanced tools) |
| `--vlr-surface-panel-rgb` | `30, 30, 30` | Toast / solid panel backgrounds |
| `--vlr-surface-overlay-rgb` | `20, 20, 20` | Overlay panel backgrounds |
| `--vlr-surface-deep-rgb` | `15, 15, 15` | Deep panel backgrounds |
| `--vlr-surface-inspector-rgb` | `30, 30, 40` | Material inspector background |
| `--vlr-surface-mobile-rgb` | `27, 27, 27` | Mobile toolkit surfaces |
| `--vlr-scrollbar-rgb` | `92, 92, 92` | Scrollbar thumb |

### Semantic colors

| Variable | Purpose |
|----------|---------|
| `--vlr-danger` / `--vlr-danger-rgb` | Error text / states |
| `--vlr-text-muted` | Muted secondary text |
| `--vlr-border-solid` | Solid (non-glass) borders |
| `--vlr-track-bg` | Slider / scrubber track |
| `--vlr-control-track` | Control track fill |
| `--vlr-ambient-glow` | Decorative radial glow behind the viewer |

Example — a light theme in one override:

```js
cssVariables: {
  '--vlr-surface-rgb': '20, 20, 30',   // dark ink on light glass
  '--vlr-shadow-rgb': '120, 130, 160',
  '--vlr-bg': '#f4f5f8'
}
```

## Disabling UI

```js
await createVolareViewer({
  container: '#viewer',
  model: './Model/car.glb',
  ui: false
});
```

The 3D viewer renders without any UI overlay. You control it entirely via the SDK.

## Granular UI Control

Disable individual UI components instead of the entire UI:

```js
await createVolareViewer({
  container: '#viewer',
  model: './Model/car.glb',
  ui: {
    enabled: true,
    toolbar: true,
    animationPanel: true,
    topBar: true,
    closeButton: false,
    resetCameraButton: true,
    loadingScreen: true,
    toast: true,
    tools: {
      materialInspector: true,
      crossSection: true,
      normals: true,
      boundingVolumes: false,
      performance: false
    }
  }
});
```

| UIConfig Key | Type | Default | Description |
|--------------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Master switch for all UI |
| `toolbar` | `boolean` | `true` | Bottom tool bar |
| `animationPanel` | `boolean` | `true` | Animation playback controls |
| `topBar` | `boolean` | `true` | Top bar with close/reset buttons |
| `closeButton` | `boolean` | `true` | Close button in top bar |
| `resetCameraButton` | `boolean` | `true` | Reset camera button |
| `loadingScreen` | `boolean` | `true` | Loading overlay |
| `toast` | `boolean` | `true` | Toast notifications |
| `tools` | `Record<ToolId, boolean>` | all `true` | Per-tool toggles |
| `panels` | `Record<string, Record<string, boolean>>` | — | Panel section toggles |

## Tool Toggles

Disable specific tool buttons:

```js
await createVolareViewer({
  container: '#viewer',
  tools: {
    boundingVolumes: false,
    performance: false
  }
});
```

This hides the corresponding feature buttons. All other tools remain visible.

### Tool Name → Feature Button Mapping

| Config Key | Feature Button |
|------------|---------------|
| `materialInspector` | Material Inspector |
| `turntablePlus` | Turntable Plus |
| `boundingVolumes` | Bounding Volumes |
| `crossSection` | Cross Section |
| `directorMode` | Director Mode |
| `normals` | Normal Vectors |
| `uvPreview` | UV Preview |
| `vertexFocus` | Mesh Inspector |
| `performance` | Performance Monitor |

You can also use the legacy `features.disabled` array with DOM IDs:

```js
features: { disabled: ['toggle-bounding-volumes'] }
```

Runtime toggle:

```js
viewer.setFeatureEnabled('toggle-bounding-volumes', false);
viewer.setFeatureEnabled('toggle-bounding-volumes', true);
```

## Environment

```js
await viewer.setEnvironment({
  hdri: './Model/HDR/photo_studio_01_4k.hdr',
  background: 'blurred',
  intensity: 1.2
});
```

Options:
- `hdri` — Custom HDR file URL
- `preset` — Built-in preset ID (e.g., 'studio-small-03')
- `enabled: false` — Disable environment
- `background` — 'current', 'transparent', 'solid', 'blurred', 'hdri'
- `backgroundColor` — Solid background color
- `backgroundBlur` — Blur amount for blurred backgrounds
- `intensity` — Environment/background intensity

## Class Aliases (vlr-* Namespace)

Volare adds `vlr-*` alias classes to key DOM elements after initialization:

| Element | Original Selector | Alias Class |
|---------|------------------|-------------|
| Canvas wrapper | `#VolareCanvas` | `vlr-viewer` |
| Model container | `#model` | `vlr-canvas` |
| Visual Toolkit | `#VisualToolkit` | `vlr-visual-toolkit` |
| Advanced panel | `#AdvancedThree` | `vlr-advanced-panel` |
| Animation panel | `#animation-panel` | `vlr-animation-panel` |
| Loading screen | `#loadingScreen` | `vlr-loading` |
| Feature buttons | `.AdvancedBtn` | `vlr-feature-button` |
| Feature grid | `.AdvancedRight` | `vlr-feature-grid` |
| Wireframe bar | `.ModesWireframe` | `vlr-wireframe-bar` |
| Wireframe mode buttons | `.OpWireframe` | `vlr-mode-button` |
| Model attribute buttons | `.ModelAttrBack` | `vlr-model-attributes` |
| Animation controls | `.AdvancedAnimButton` | `vlr-animation-control` |
| Close buttons | `.CloseToolkitIcon` | `vlr-close-button` |
| HDRI panel | `.HDRIContainer` | `vlr-hdri-panel` |

### K3A Low/Medium-Risk Alias Map

These aliases are additive. Legacy selectors are retained for beta compatibility.

| Legacy selector | `vlr-*` alias | `data-vlr-role` | Status |
| --- | --- | --- | --- |
| `#loadingScreen` | `vlr-loading` | `loading` | Legacy retained |
| `#model` | `vlr-canvas` | `canvas` | Legacy retained |
| `.AdvancedRight` | `vlr-feature-grid` | `feature-grid` | Legacy retained |
| `.CloseToolkitIcon` | `vlr-close-button` | `toolkit-close` | Legacy retained |
| `.HDRIContainer` | `vlr-hdri-panel` | `hdri-panel` | Legacy retained |
| `.ModesWireframe` | `vlr-wireframe-bar` | `wireframe-bar` | Legacy retained |
| `.OpWireframe` | `vlr-mode-button` | None | Legacy retained |
| `.ModelAttrBack` | `vlr-model-attributes` | None | Legacy retained |

Original classes and IDs are preserved. Aliases are additive only. You can target either the original or alias class in your CSS.

## Plugins

```js
viewer.registerPlugin({
  name: 'my-plugin',
  beforeLoadModel(url) { console.log('Loading', url); },
  afterLoadModel(model) { console.log('Loaded', model); },
  onDiagnostics(diagnostics) { diagnostics.myPlugin = true; }
});
```

## Custom Loaders

```js
await createVolareViewer({
  container: '#viewer',
  loaders: {
    usdz: (loadingManager) => new MyUSDZLoader(loadingManager)
  }
});
```

## Diagnostics

```js
const viewer = await createVolareViewer({
  container: '#viewer',
  diagnostics: true
});

console.log(viewer.getDiagnostics());
// Includes: cssVariablesApplied, tools, theme, layout, features
```

## Safe Theming Example

Create a custom theme without editing Volare source:

```html
<style>
  :root {
    --vlr-accent: #e74c3c;
    --vlr-glass-bg: linear-gradient(185deg, rgba(30, 0, 0, 0.5), rgba(15, 0, 0, 0.3));
    --vlr-text-primary: rgba(255, 220, 220, 0.95);
  }
</style>
```

Or via config:

```js
await createVolareViewer({
  container: '#viewer',
  theme: {
    cssVariables: {
      '--vlr-accent': '#e74c3c',
      '--vlr-glass-bg': 'linear-gradient(185deg, rgba(30,0,0,0.5), rgba(15,0,0,0.3))'
    }
  }
});
```

Both approaches override the default tokens without modifying Volare source files.

## Renderer

```js
renderer: {
  preferredBackend: 'webgl',  // 'webgl' (default), 'webgpu', or 'auto'
  pixelRatio: 'auto',         // 'auto' adapts based on device and model size
  adaptiveQuality: true       // Reduce DPR for huge models
}
```

**`'webgl'` (default)** — the classic, broadly-compatible WebGL2 renderer.
This is the default because the three.js r185 WebGPU backend initializes but
renders blank on some GPUs/drivers; WebGL2 is the reliable path.

**`'webgpu'`** — opt into the WebGPU backend (falls back to WebGL2 if
`navigator.gpu`/an adapter is unavailable, recording a `fallback` in the
renderer diagnostics). Volare's lighting pipeline (ACES Filmic tone mapping,
PMREM-based HDRI environments) renders identically on both, but verify WebGPU
on your target devices before shipping it. **`'auto'`** — same behavior as
`'webgpu'`.
