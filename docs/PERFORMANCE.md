# Volare Performance Guide

## Render Pipeline

Volare uses Three.js WebGL with continuous rendering via `renderer.setAnimationLoop()`. Every frame updates controls, animations, and active analysis tools.

### Adaptive Pixel Ratio

Volare automatically caps the device pixel ratio based on model size and device type:

| Scenario | DPR Cap |
|----------|---------|
| Desktop, normal model | min(devicePixelRatio, 2) |
| Mobile, normal model | min(devicePixelRatio, 2) |
| Desktop, huge model | 1.5 |
| Mobile, huge model | 1.0 |

This prevents GPU overload on large scenes without making normal models blurry.

### Model Size Classification

After loading, Volare computes and caches model statistics (vertex count, triangle count, mesh count, material count, texture count, bounding box/sphere). Based on the highest of vertex or triangle count:

| Class | Threshold |
|-------|-----------|
| small | < 100,000 |
| medium | 100,000 - 499,999 |
| large | 500,000 - 999,999 |
| huge | >= 1,000,000 |

When a model is classified as **huge**, Volare enters huge-model mode:
- Pixel ratio is capped (see table above)
- A console warning is logged with exact counts
- Diagnostics include optimization recommendations

### Frustum Culling

Three.js frustum culling is enabled by default on all loaded meshes. Meshes outside the camera frustum are skipped by the GPU. Previous versions disabled this globally; current versions let Three.js manage culling naturally.

### Render Loop

The render loop runs continuously. Demand rendering (render only when needed) is planned for a future phase. Current continuous mode ensures animations, damping, and tool updates work reliably.

### Diagnostics

Call `getDiagnostics()` on the viewer instance to inspect:
- `modelStats` — cached vertex/triangle/mesh/material/texture counts and bounding volumes
- `modelSizeClass` — small/medium/large/huge
- `hugeModelMode` — boolean
- `runtime.renderLoopMode` — currently "continuous"
- `recommendations` — optimization suggestions when huge model detected
- `scene.drawCalls` — current draw call count from renderer.info

## Optimization Checklist

1. Use GLB format (binary glTF) for web delivery
2. Run gltfpack or Meshopt compression on geometry
3. Use Draco compression for high-poly meshes
4. Use KTX2/Basis Universal for texture compression
5. Keep textures at 2K or below when possible (4K only for hero surfaces)
6. Reduce draw calls by merging meshes with shared materials
7. Remove invisible/internal geometry
8. Use LOD (Level of Detail) where supported
9. Test on target mobile devices

## What Volare Does NOT Do (Yet)

- On-demand rendering (deferred to future phase)
- Automatic LOD generation
- Automatic texture downscaling
- FBX/OBJ loading is syntax-verified but not runtime-tested with all model variants
