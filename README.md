# Volare

A buildless 3D model viewer for the web. Load a model, inspect it, theme it — no bundler, no server.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/MarwanWElzeiny/Volare/actions/workflows/ci.yml/badge.svg)](https://github.com/MarwanWElzeiny/Volare/actions/workflows/ci.yml)
[![three.js](https://img.shields.io/badge/three.js-r185-black.svg)](https://threejs.org/)

<!--
TODO: record and drop in ./media/hero.gif — a silent, looping clip of the
orbit + cross-section interaction, no text overlay. See media/README.md for
the capture page and settings. Then delete this comment.
-->
<img src="./media/hero.gif" alt="Volare viewer demo">

## Install

Not on npm yet. Clone the repo, or copy `SDK/` into your project:

```bash
git clone https://github.com/MarwanWElzeiny/Volare.git
```

Three.js is a peer dependency (`^0.185.1`) — load it from a CDN via import map,
or install it if you use a bundler.

## Demo

```bash
npm install && npm start
```

<!-- TODO: add a hosted demo link (GitHub Pages / StackBlitz) once deployed. -->

## Quickstart

The complete contents of [`examples/minimal`](examples/minimal/index.html):

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

## Documentation

- [Integration guide](docs/INTEGRATION_GUIDE.md) — mount it from scratch
- [Customization](docs/CUSTOMIZATION.md) — config, theming, HDRI presets, renderer
- [Formats](docs/FORMATS.md) · [Plugins](docs/PLUGINS.md) · [Performance](docs/PERFORMANCE.md)
- [Testing](docs/TESTING.md) — the pre-release procedure
- [Security](SECURITY.md) — threat model and protected delivery

Full index in [`docs/`](docs/).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Open an issue before large changes.

## License

[MIT](LICENSE) © Marwan W. Elzeiny
