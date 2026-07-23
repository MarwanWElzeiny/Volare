# Volare Model Format Guide

## Supported Formats

| Format | Extensions | Loading | Notes |
|--------|-----------|---------|-------|
| glTF 2.0 | `.glb`, `.gltf` | Built-in (GLTFLoader) | Recommended for web |
| VLB | `.vlb`, `.vmesh` | Built-in (VLBLoader) | Volare protected pipeline |
| FBX | `.fbx` | Lazy-loaded (dynamic import) | Import format — convert to GLB for best results |
| OBJ | `.obj` | Lazy-loaded (dynamic import) | Import format — no PBR, no animation |

## Recommended: GLB

GLB (binary glTF 2.0) is the recommended format for all Volare deployments:
- Single binary file (geometry + textures + animations)
- Supports Draco/Meshopt geometry compression
- Supports KTX2/Basis texture compression
- Smallest download and fastest parse time
- Full PBR material support

## VLB (Volare Binary)

VLB is Volare's protected asset format used with the protected delivery pipeline (JWT license tokens, HMAC-SHA256 manifests, nonce replay protection). VLB files are loaded through the protected asset endpoint and verified before rendering.

## FBX

FBX is Autodesk's proprietary format. Volare supports FBX loading for convenience, but FBX files are typically larger and slower to parse than GLB. The FBXLoader is loaded lazily on first use (not bundled until needed).

Limitations:
- Larger file size than equivalent GLB
- Parser is heavier than GLTFLoader
- Some FBX material features may not translate to Three.js PBR
- No geometry compression support

Recommendation: Convert FBX to GLB using Blender or gltfpack before deploying to production.

## OBJ

OBJ is a legacy ASCII mesh format. Volare supports OBJ loading for basic mesh import. The OBJLoader is loaded lazily on first use.

Limitations:
- No PBR material support (only basic Phong/Lambert via MTL)
- No animation support
- No compression
- ASCII format means large file sizes
- No embedded textures

Recommendation: Convert OBJ to GLB for any production use.

## Usage Examples

### Basic loading (auto-detect by extension)

```javascript
// GLB
await viewer.loadModel('./models/car.glb');

// GLTF
await viewer.loadModel('./models/scene.gltf');

// FBX (loader fetched on first use)
await viewer.loadModel('./models/character.fbx');

// OBJ
await viewer.loadModel('./models/mesh.obj');
```

### Explicit format override

Use when the URL doesn't have a recognizable extension (e.g., API endpoints, blob URLs):

```javascript
await viewer.loadModel('https://api.example.com/asset/12345', { format: 'glb' });
await viewer.loadModel(blobUrl, { format: 'fbx' });
```

### With createVolareViewer

```javascript
const viewer = await createVolareViewer({
  container: '#viewer',
  model: './models/car.glb'
});

// Load a different model later
await viewer.loadModel('./models/building.fbx');
```

### Custom loaders

You can register custom loaders for any extension:

```javascript
const viewer = await createVolareViewer({
  container: '#viewer',
  loaders: {
    usdz: (loadingManager) => new MyUSDZLoader(loadingManager)
  }
});
```

Custom loaders take priority over built-in format detection.

## Protected Asset Format Detection

When loading protected assets via `loadProtectedAsset()`, Volare infers the model format from:

1. `manifest.format` field (if the server provides it)
2. File extension in `manifest.file` (e.g., `"model.glb"`)
3. URL hash fragment (e.g., `blob:...#model.glb`)
4. Explicit `{ format }` option

If none of these resolve a format, Volare defaults to glTF. For non-GLB protected assets, ensure the manifest includes a `format` or `file` field.

## Unsupported Formats

Loading an unrecognized format produces a clear error:

```
[Volare] Unsupported model format: "abc". Supported: glb, gltf, vlb, fbx, obj.
```

If the format cannot be determined from the URL at all:

```
[Volare] Cannot determine model format for "...". Pass { format: "glb" } explicitly.
```

## Why Convert to GLB?

| Metric | GLB | FBX | OBJ |
|--------|-----|-----|-----|
| File size (typical) | Smallest | 2-5x larger | 3-10x larger |
| Parse time | Fast | Slow | Medium |
| PBR materials | Full | Partial | None |
| Animation | Full | Full | None |
| Compression | Draco/Meshopt/KTX2 | None | None |
| Texture embedding | Yes | Yes | No (separate files) |

## Manual FBX/OBJ Testing

No FBX or OBJ sample models are bundled with Volare. To test:

1. Place an FBX file in `DEMO/models/` (e.g., `test.fbx`)
2. Open DEMO/index.html or a custom page
3. Call: `window.viewerPlugin?.getViewer('model')?.loadModel('./models/test.fbx')`
4. Check console for `[Volare] FBX model loaded successfully`
5. Repeat with an OBJ file

If the dynamic import fails (e.g., import map missing `three/addons/`), the console will show the import error with a clear module path.
