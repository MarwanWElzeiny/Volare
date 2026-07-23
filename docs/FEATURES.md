# Volare Feature List

## Core SDK
- `createVolareViewer()` — single-function initialization
- `getVolareViewers()` — registry of active viewer instances
- Plugin architecture with lifecycle hooks
- Event system (initialized, modelLoading, modelLoaded, modelError)
- Protected asset delivery with JWT + HMAC-SHA256

## Model Formats
- GLB (binary glTF 2.0) — recommended
- glTF 2.0
- VLB / vmesh (Volare binary format)
- FBX (lazy-loaded via dynamic import)
- OBJ (lazy-loaded via dynamic import)
- Custom loader registration by extension
- Explicit format override for ambiguous URLs

## Viewer
- WebGL rendering via Three.js r167
- Orbit controls with damping
- Camera auto-centering on model load
- Frustum culling
- Post-processing pipeline (EffectComposer)
- Tone mapping (ACES Filmic)
- Shadow mapping (PCF Soft)

## UI
- Glass-morphism design with CSS token system
- Visual Toolkit panel with 9 analysis tools
- Loading screen with progress bar
- Model gallery with thumbnail selection
- Close/reopen viewer
- Mobile-responsive layout
- Touch controls

## Material Modes
- Original — restore model's original materials
- Wireframe — gray surface with wireframe overlay
- AO — ambient occlusion with wireframe overlay
- Wireframe modes: triangle (default), edges (hard edges only), artist (topology-based, future)

## HDRI Environment
- 7 built-in HDRI presets
- Custom HDR file loading
- Background modes: current, transparent, solid, blurred
- Background blur control
- Environment intensity control
- HDRI toggle (on/off)
- Swiper carousel for preset selection (with pointer drag fallback)

## Animation
- Playback controls (play, pause, stop, step forward/back)
- Frame-by-frame stepping
- Animation clip selection
- Speed adjustment slider
- Progress bar with seek
- Playback options panel

## Analysis Tools
- **Material Inspector** — inspect material properties per mesh
- **Bounding Volumes** — bounding box and sphere visualization
- **Normal Vectors** — vertex normal helper display
- **Cross Section** — clipping plane with interactive positioning
- **UV Preview** — UV layout visualization with zoom/pan
- **Mesh Inspector** — click-to-inspect mesh parts (name, material, vertex/triangle count, bounding box, textures)
- **Director Mode** — camera path animation
- **Turntable Plus** — automated turntable rotation
- **Performance Monitor** — FPS, frame time, memory, draw calls

## Customization
- CSS custom properties (`--vlr-*` namespace)
- Theme API: accent color, glass toggle, custom CSS variables
- Tool toggles: enable/disable individual features
- `ui: false` for headless operation
- Feature enable/disable at runtime
- `vlr-*` class aliases for CSS targeting
- Plugin system for custom behavior

## Performance
- Model size classification (small/medium/large/huge)
- Huge-model mode with automatic DPR capping
- Cached model statistics
- Dirty-flag optimization for static visualization tools
- DOM listener tracking and cleanup
- Frustum culling (native Three.js)

## Security (Protected Mode)
- JWT license tokens with expiry
- HMAC-SHA256 signed asset manifests
- SHA-256 asset hash verification
- Chunked protected delivery with per-chunk and total SHA-256 verification
- Nonce replay protection
- Server-side origin validation
- Helmet CSP headers
- Rate limiting
- CORS configuration

## Mobile Support
- Responsive layout at 390px, 430px, 768px, 800px, 1200px, 1400px
- Touch drag for HDRI carousel
- Touch controls for 3D viewport
- Reduced glass blur on mobile for performance
- Compact animation controls
- Tab-based toolkit on small screens
