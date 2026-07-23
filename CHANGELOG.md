# Changelog

## Unreleased (2026-07-10)

### Restructure for Public Release
- Reorganized project: `SDK/` (CSS + JS), `DEMO/`
- Removed Node.js dependency for basic viewer usage
- Configurable HDRI base path via `setHdriBasePath()`
- XSS fix in notification toast (innerHTML → DOM API)
- Removed dead code, duplicate methods, typo fixes
- Removed: CDN copy, module-library wrappers, compat shims, Volare Link packages
- Server optional — only needed for protected asset delivery

### SDK
- Lifecycle callbacks (`onReady`, `onModelLoad`, `onModelError`, `onClose`,
  `onDispose`) on `createVolareViewer`
- `DeveloperMode` config gate; `meshInspector` tool key
- Real WebGPU rendering via `THREE.WebGPURenderer` (`renderer.preferredBackend:
  'auto'` by default) — automatically uses the WebGPU backend when the
  device/browser support it, transparently falls back to WebGL2 otherwise.
  Force classic WebGL with `preferredBackend: 'webgl'`.
- `examples/minimal/` — a from-scratch integration example with none of the
  demo gallery's branding, alongside a new `docs/INTEGRATION_GUIDE.md`.

## 0.1.0-beta.0 (2026-06-03)

Initial public beta release.

### SDK & Core
- `createVolareViewer()` facade with full config API
- Plugin architecture with lifecycle hooks
- Protected asset delivery (JWT + HMAC-SHA256 + nonce replay protection)
- Chunked protected asset delivery with per-chunk and total SHA-256 verification
- Model statistics caching and huge-model detection
- Adaptive pixel ratio based on device and model size
- Frustum culling enabled by default

### Format Support
- GLB/glTF via Three.js GLTFLoader (built-in)
- VLB/vmesh via custom VLBLoader (built-in)
- FBX via lazy-loaded Three.js FBXLoader
- OBJ via lazy-loaded Three.js OBJLoader
- Robust format detection from URL, hash fragment, and manifest
- Explicit `{ format }` override for ambiguous URLs

### UI & Visualization
- Glass-morphism UI with CSS custom property tokens
- 9 analysis/visualization tools in Visual Toolkit
- Original, Wireframe, and AO material modes
- Wireframe fidelity modes: triangle, edges, artist
- HDRI environment with 7 presets and custom HDR support
- Background blur mode
- Animation playback controls with speed adjustment
- Mobile-responsive layout with touch controls

### Customization
- Theme API with `cssVariables`, `accent`, `glass` toggle
- Tool toggles via `tools` config
- `vlr-*` class aliases on key DOM elements
- CSS token system (`--vlr-*` namespace) for safe theming
- Feature enable/disable at SDK level

### CSS Architecture
- Modular CSS split: tokens, base, viewer, panels, controls, animation, advanced-tools, hdri, responsive
- Model.css as import hub
- Consistent glass token usage across all panels

### Performance
- Model size classification (small/medium/large/huge)
- Huge-model mode with DPR capping
- Cached model statistics (vertex/triangle/mesh/material/texture counts)
- Dirty-flag optimization for visualization tools
- DOM event listener cleanup tracking

### Fixes
- HDRI toggle state sync with LightingController
- HDRI Swiper initialization after DOM injection
- ButtonManager null-safety for missing state classes
- CrossSection duplicate-activation guard
- UVPreviewTool DOM listener leak (13 listeners tracked and cleaned)
- VertexFocusTool reflow reduction and RAF cancellation
- Toolkit tab state on mobile (breakpoint alignment + orientation change)

### Documentation
- CUSTOMIZATION.md — Full config reference and theming guide
- PERFORMANCE.md — Adaptive quality and optimization checklist
- LARGE_MODELS.md — Car model guide, compression tools, texture recommendations
- FORMATS.md — Format comparison, usage examples, manual testing instructions
- INTEGRATION_GUIDE.md — Minimal from-scratch integration walkthrough
