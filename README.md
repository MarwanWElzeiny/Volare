<p align="center">
  <img src="./media/Volare.png" alt="Volare" width="500">
</p>

<p align="center">
  A buildless 3D model viewer for the web. Load a model, inspect it, theme it — no bundler, no server.
</p>

<p align="center">
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT">
  </a>
  <a href="https://threejs.org/">
    <img src="https://img.shields.io/badge/three.js-r185-black.svg" alt="three.js">
  </a>
  <a href="https://github.com/MarwanWElzeiny/Volare/actions">
    <img src="https://github.com/MarwanWElzeiny/Volare/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
</p>

<p align="center">
  <img src="./media/Demo.gif" alt="Volare Demo" width="100%">
</p>

## Live Demo

**Try Volare in your browser:**

**https://marwanwelzeiny.github.io/Volare/DEMO/**

No installation required.

## Install

Not on npm yet. Clone the repo, or copy `SDK/` into your project:

```bash
git clone https://github.com/MarwanWElzeiny/Volare.git
```

Three.js is a peer dependency (`^0.185.1`) — load it from a CDN via import map,
or install it if you use a bundler.

### Run locally

```bash
npm install
npm start
```

```bash
npm install && npm start
```

<!-- TODO: add a hosted demo link (GitHub Pages / StackBlitz) once deployed. -->

## Quickstart

Use the working demo page in [Demo/index.html](Demo/index.html) as a reference. A minimal page can look like this:

```html
<div id="viewer" style="width: 100%; height: 100vh;"></div>

<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/",
    "three/webgpu": "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.webgpu.js"
  }
}
</script>

<script type="module">
  import { createVolareViewer } from './SDK/Core/createVolareViewer.js';

  await createVolareViewer({
    container: '#viewer',
    model: './your-model.glb'
  });
</script>
```

Serve over HTTP — ES modules do not load from `file://`.

## Features

- **Formats** — GLB, glTF, and VLB built in; FBX and OBJ lazy-loaded on first use
- **Inspection toolkit** — wireframe, ambient occlusion, cross-section, UV layout, bounding volumes, normals, mesh inspector, performance monitor, director mode, turntable
- **HDRI lighting** — 7 presets, extensible with your own
- **Animation playback** — clip controls for rigged models
- **Theming** — ~90 CSS custom properties; no stylesheet forking
- **Plugins** — lifecycle hooks around init, model load, and environment changes
- **Renderer** — WebGL by default, WebGPU opt-in
- **Adaptive quality** — pixel ratio scales to device and model size
- **Optional protected delivery** — signed, chunked asset serving (requires the included Node server)

## Why Volare

Most viewers make you choose between a black-box `<model-viewer>` element and
building on raw Three.js yourself. Volare sits in between: a working inspection
UI you can actually restyle, driven entirely by CSS custom properties rather
than forked stylesheets.

It has no build step — raw ES modules that load straight in the browser — and
the toolkit mounts into any container, so it embeds in a panel as readily as it
fills a page.

## Security & Protected Asset Delivery

> [!NOTE]
> **Status: Stable (`v1.0.0`)**
> Volare includes a built-in Security and Protected Delivery suite for server-controlled asset access. It provides layered protection to reduce casual direct linking and hotlinking of proprietary 3D models.

### Key Security Features
- **Signed Manifests & Nonces**: Short-lived JWT license tokens and single-use anti-replay request nonces (`X-Volare-Nonce`).
- **Chunked Asset Streaming**: Splitting models into individually signed binary chunks (`chunk-0000.bin`) reassembled in client memory using Blob URLs.
- **Integrity Validation**: Strict SHA-256 hash checks on both individual chunks and total assembled models before scene parsing.
- **Protected delivery manifest flow**: Signed manifests and chunked delivery for server-controlled asset access.
- **API Rate Limiting & Origin Security**: Configured CORS origins, strict static route blocking, and IP rate-limiting (`express-rate-limit`).

### How to Run & Test Security Features

1. **Run Automated Security Tests**:
   ```bash
   npm run test:security
   ```
2. **Run Security Audit**:
   ```bash
   npm run security:audit
   ```
3. **Run Full Test Suite**:
   ```bash
   npm test
   ```

### Running the Protected Delivery Server

Start the included Node.js server:
```bash
npm start
```
Environment variables (optional for local dev, recommended for production):
```bash
VOLARE_SECURITY_SECRET="your-production-secret" \
VOLARE_LICENSE_SECRET="your-license-secret" \
VOLARE_ALLOWED_ORIGINS="https://yourdomain.com" \
npm start
```

### Protected Mode Setup

Protected assets are prepared on the server side and served through the protected delivery routes. The public release focuses on the server-backed flow documented in [SECURITY.md](SECURITY.md).

### Client SDK Usage (Protected Mode)

```javascript
import { createVolareViewer } from './SDK/Core/createVolareViewer.js';

const viewer = await createVolareViewer({
  container: '#viewer',
  protectedAsset: {
    assetId: 'demo-duck',
    licenseEndpoint: '/api/volare/license',
    manifestEndpoint: '/api/volare/manifest/demo-duck',
    assetEndpoint: '/api/volare/asset/demo-duck' // or chunkEndpoint for chunked mode
  }
});
```

For full threat model details and architecture, see [`SECURITY.md`](SECURITY.md).

## Documentation

- [Demo entrypoint](Demo/index.html) — local demo page
- [SECURITY.md](SECURITY.md) — threat model and protected delivery
- [CONTRIBUTING.md](CONTRIBUTING.md) — contribution workflow
- [CHANGELOG.md](CHANGELOG.md) — release notes

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Open an issue before large changes.

## License

[MIT](LICENSE) © Marwan W. Elzeiny
