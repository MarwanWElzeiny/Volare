# Large Model Guide for Volare

## Overview

Volare handles models from simple product shots to 1M+ vertex automotive assets. This guide covers how to prepare and optimize large models for the best web viewing experience.

## Recommended Format: GLB

GLB (binary glTF 2.0) is the recommended format for all Volare models:
- Single binary file (geometry + textures + animations in one download)
- Widely supported by 3D tools and engines
- Supports Draco and Meshopt geometry compression
- Supports KTX2/Basis Universal texture compression
- Smaller file size than equivalent FBX/OBJ

### Why Not FBX or OBJ?

- FBX is a proprietary Autodesk format; web parsers are large and fragile
- OBJ lacks PBR material support, animation, and compression
- Both produce larger file sizes for the same content
- FBX/OBJ support is planned for a future Volare phase but GLB remains the primary target

## Car/Vehicle Model Checklist

Automotive models are among the heaviest assets in web 3D. Follow this checklist:

1. **Target polygon count**: 200K-500K triangles for smooth web performance. 1M+ is possible but triggers huge-model mode with reduced DPR.
2. **Merge meshes**: Combine parts that share the same material. A car body with 200 separate mesh objects creates 200 draw calls; merged, it can be 1.
3. **Remove interior geometry**: If the camera never enters the cabin, delete interior faces.
4. **Bake details**: Normal maps are far cheaper than geometric detail. Bake panel gaps, screws, and surface detail into normal maps.
5. **Texture atlas**: Combine small textures into atlases to reduce texture binds.
6. **Texture resolution**: 2K for body paint and large surfaces, 1K for wheels/trim/glass, 512 for small parts.
7. **Single-sided materials**: Use single-sided rendering unless the mesh is visible from both sides (glass).

## Geometry Compression

### gltfpack (Meshopt)

```bash
gltfpack -i input.glb -o output.glb -cc -tc
```

- `-cc` — compress geometry with Meshopt
- `-tc` — compress textures to KTX2/Basis
- Typical size reduction: 50-80%
- Decoder is ~20KB, loaded automatically by Three.js

### Draco

```bash
gltf-pipeline -i input.glb -o output.glb -d
```

- Google's geometry compression
- Typical size reduction: 40-70%
- Three.js includes DRACOLoader for automatic decompression
- Slightly higher decode time than Meshopt on mobile

## Texture Compression

### KTX2 / Basis Universal

GPU-compressed textures that stay compressed in VRAM:

```bash
# Using gltfpack
gltfpack -i input.glb -o output.glb -tc

# Using toktx directly
toktx --bcmp --clevel 2 output.ktx2 input.png
```

Benefits:
- 4-8x smaller in GPU memory vs PNG/JPEG textures
- Faster upload to GPU
- Reduced VRAM pressure on mobile

### Texture Size Recommendations

| Surface | Max Resolution |
|---------|---------------|
| Hero/body paint | 2048x2048 |
| Secondary surfaces | 1024x1024 |
| Small parts/trim | 512x512 |
| AO/lightmaps | 1024x1024 |

## Blender Export Settings

For Blender users exporting to GLB:

1. File > Export > glTF 2.0 (.glb)
2. Format: glTF Binary (.glb)
3. Include: Selected Objects (or Scene)
4. Transform: +Y Up
5. Geometry:
   - Apply Modifiers: checked
   - UVs: checked
   - Normals: checked
   - Tangents: unchecked (unless using normal maps)
   - Vertex Colors: if used
   - Materials: Export
6. Compression: Draco (if not using gltfpack post-process)
7. Animation: check only if model is animated

Post-export, run gltfpack for optimal compression.

## LOD Strategy

Level of Detail reduces polygon count based on camera distance:

1. **LOD 0** (close): Full detail, original mesh
2. **LOD 1** (medium): 50% triangles, simplified with Blender Decimate or Simplygon
3. **LOD 2** (far): 25% triangles

Volare does not auto-generate LODs. Prepare them in your 3D tool and use Three.js LOD objects in custom loaders if needed.

## 1M+ Vertex Models: What to Expect

Models with 1M+ vertices or triangles will:
- Trigger Volare's huge-model mode automatically
- Have pixel ratio capped (1.5 desktop, 1.0 mobile) to reduce GPU fill rate
- Log a console warning with exact counts
- Show optimization recommendations in `getDiagnostics()`
- Still render and interact correctly, but at reduced visual quality on constrained devices

Volare does not guarantee 60fps on all devices for 1M+ models. Performance depends on the user's GPU, browser, texture count, and material complexity. The huge-model mode improves the chance of a smooth experience but is not a substitute for proper asset optimization.

## Quick Reference

| Goal | Tool | Command |
|------|------|---------|
| Compress geometry | gltfpack | `gltfpack -i in.glb -o out.glb -cc` |
| Compress textures | gltfpack | `gltfpack -i in.glb -o out.glb -tc` |
| Both | gltfpack | `gltfpack -i in.glb -o out.glb -cc -tc` |
| Draco compression | gltf-pipeline | `gltf-pipeline -i in.glb -o out.glb -d` |
| KTX2 textures | toktx | `toktx --bcmp output.ktx2 input.png` |
| Inspect model | gltf-transform | `gltf-transform inspect input.glb` |
| Reduce triangles | Blender | Decimate modifier, ratio 0.5 |
