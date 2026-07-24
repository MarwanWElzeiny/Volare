# Volare

A premium 3D model viewer SDK built on Three.js. Supports GLB/glTF/FBX/OBJ, plugin architecture, customizable UI. No server required.

## Quick Start

```html
<!-- 1. Three.js import map -->
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/",
    "three/webgpu": "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.webgpu.js"
  }
}
</script>

<!-- 2. Container -->
<div id="viewer" style="width: 100%; height: 100vh;"></div>

<!-- 3. Init -->
<script type="module">
  import { createVolareViewer } from './SDK/Core/createVolareViewer.js';

  await createVolareViewer({
    container: '#viewer',
    model: './your-model.glb'
  });
</script>
```

See [`docs/INTEGRATION_GUIDE.md`](docs/INTEGRATION_GUIDE.md) and
[`examples/minimal/index.html`](examples/minimal/index.html) for a complete,
dependency-free working copy — no gallery, no navbar, no demo branding.

## Project Structure

```
SDK/             CSS + JS source — copy this into your website
DEMO/            Full working demo (gallery, direct viewer, portfolio)
server/          Optional Node.js server (for protected asset delivery)
security/        Server-side security module
tools/           VLB encryption tools, validation, security audit
tests/           Security + lifecycle tests
docs/            Feature docs, customization, formats, plugins
```

## How to Use in Your Website

1. Copy `SDK/` into your project
2. Copy HDR files from `DEMO/models/HDR/` (or use your own)
3. Add to your HTML:
   - `<link rel="stylesheet" href="path/to/SDK/css/volare.css">`
   - Icon libraries (Font Awesome, Boxicons — see `DEMO/direct.html` for links)
   - Three.js import map
4. In your JS:
   ```js
   import { setHdriBasePath } from './SDK/Managers/LightingController.js';
   setHdriBasePath('./path/to/your/HDR/');
   ```
5. Init viewer (see Quick Start above)

**Requirements**: Any web server (even `python -m http.server`). No Node.js needed. ES modules require serving over HTTP, not `file://`.

## Headless (No UI)

```js
import { createVolareViewer } from './SDK/Core/createVolareViewer.js';
import { setHdriBasePath } from './SDK/Managers/LightingController.js';

setHdriBasePath('./HDR/');

const viewer = await createVolareViewer({
  container: '#viewer',
  model: './models/car.glb',
  ui: false
});
```

## Supported Formats

| Format | Extensions | Notes |
|--------|-----------|-------|
| glTF 2.0 | `.glb`, `.gltf` | Recommended |
| VLB | `.vlb`, `.vmesh` | Volare encrypted container |
| FBX | `.fbx` | Lazy-loaded |
| OBJ | `.obj` | Lazy-loaded |

## Features

- 9 analysis tools (Material Inspector, Bounding Volumes, Normals, Cross Section, UV Preview, Mesh Inspector, Director Mode, Turntable, Performance Monitor)
- 7 HDRI environment presets + custom HDR support
- Animation playback controls
- Glass-morphism UI with CSS token theming
- Plugin architecture
- Large model auto-detection
- Mobile-responsive with touch controls
- Protected asset delivery (optional, requires Node.js server)

## Running the Demo

```bash
# Option A: Any static server
cd volare-public-release
python -m http.server 8000
# Open http://localhost:8000/DEMO/index.html

# Option B: Node.js server (enables protected asset features)
npm install
npm start
# Open http://localhost:3000
```

## Testing

```bash
npm test               # Security envelope tests + SDK lifecycle tests
npm run security:audit # Static security audit (config, secrets, exposure)
npm run validate       # Structural validation (paths, legacy cleanup)
```

`npm test` covers signed-manifest verification, SHA-256 asset hashing, JWT
license validation and expiry, nonce replay prevention, origin checks,
protected/chunked delivery routes, and rate limiting. Full breakdown +
manual `curl` checks: [docs/SECURITY_TESTING.md](docs/SECURITY_TESTING.md).

Security model (what runs where, trust boundaries):
[docs/SECURITY_BOUNDARY.md](docs/SECURITY_BOUNDARY.md).

## Customization

See [docs/CUSTOMIZATION.md](docs/CUSTOMIZATION.md) for theme variables, tool toggles, and config reference.

## Docs

- [Integration Guide](docs/INTEGRATION_GUIDE.md) — Mount Volare from scratch, no demo baggage
- [Customization](docs/CUSTOMIZATION.md) — Config reference (theme, tools, renderer, plugins)
- [Features](docs/FEATURES.md) — Full feature list
- [Formats](docs/FORMATS.md) — Model format details
- [Plugins](docs/PLUGINS.md) — Plugin API
- [Performance](docs/PERFORMANCE.md) — Performance tuning
- [Large Models](docs/LARGE_MODELS.md) — Huge model handling
- [Protected Assets](docs/PROTECTED_ASSETS.md) — Server-side asset protection
- [Security Boundary](docs/SECURITY_BOUNDARY.md) — What runs where
- [Security Testing](docs/SECURITY_TESTING.md) — Test suite + manual checks
- [Security Policy](SECURITY.md) — Threat model, modes, vuln reporting
- [VLB Format](docs/VLB_FORMAT.md) — Encrypted container spec

## Browser Support

Chrome 90+, Firefox 90+, Safari 15+, Edge 90+, Mobile Chrome, Mobile Safari. Requires WebGL 1.0+ (2.0 recommended).

## License

[MIT](LICENSE)

### Demo Assets

Demo models in `DEMO/models/` are from the Khronos glTF Sample Assets repository (individual licenses). HDR maps are from Poly Haven (CC0).
