# DEMO/models — Asset Provenance

This file documents verified provenance for all assets in the public demo corpus.
Each entry was verified against its official source before public GitHub release.

---

## Volare.png

**Status:** VERIFIED — project-owned
**Type:** Project brand asset, created for the Volare project.
**Added:** Initial commit (`0386d5b`).
**License:** Project license (MIT).

---

## Duck/

**Status:** VERIFIED against official Khronos source
**Source:** Khronos glTF Sample Assets — "Duck"
**Repository:** https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Duck
**Creator:** Sony Computer Entertainment Inc.
**Copyright:** © 2006 Sony Computer Entertainment Inc.
**License:** SCEA Shared Source License, Version 1.0
**Textures:** Same license as model (single creator for all assets).
**Redistribution:** Permitted under SCEA Shared Source License 1.0.
**Note:** The root-level `Duck.gltf` duplicate was removed 2026-07-01; canonical
copies live under `Duck/glTF*/`.
**License file:** `Duck/LICENSE.md`

---

## Avocado/

**Status:** VERIFIED against official Khronos source
**Source:** Khronos glTF Sample Assets — "Avocado"
**Repository:** https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Avocado
**Creator:** Microsoft
**Copyright:** © 2017 Microsoft
**License:** CC0 1.0 Universal (Public Domain Dedication)
**Textures:** Same license (CC0 — single creator for all assets).
**Redistribution:** Unrestricted (public domain). No attribution required.
**License file:** `Avocado/LICENSE.md`

---

## BrainStem/

**Status:** VERIFIED against official Khronos source
**Source:** Khronos glTF Sample Assets — "BrainStem"
**Repository:** https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/BrainStem
**Creator:** Keith Hunter
**Copyright:** © 2017 Smith Micro Software, Inc.
**License:** Poser Pro 2014 End User License Agreement, clause (g) — "Legitimate Uses"
**Textures:** Same license (single creator for all assets).
**Redistribution:** Permitted for legitimate demonstration and educational purposes per Poser EULA clause (g).
**License file:** `BrainStem/LICENSE.md`

---

## MultiUVTest/

**Status:** VERIFIED against official Khronos source
**Source:** Khronos glTF Sample Assets — "MultiUVTest"
**Repository:** https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/MultiUVTest
**Creator:** Hilo3d (https://github.com/hiloteam/Hilo3d)
**Copyright:** © 2017 Hilo3d
**License:** Creative Commons Attribution 4.0 International (CC-BY 4.0)
**Textures:** Same license (single creator for all assets).
**Redistribution:** Permitted with attribution to Hilo3d.
**Attribution required:** Yes — credit Hilo3d as original creator.
**License file:** `MultiUVTest/LICENSE.md`

---

## Removed demo models (2026-07-01)

- `Demo.glb` — project-owned internal demo model. Removed from working tree.
- `Demo_1749996801160.vmesh` — Volare runtime generated. Removed from working tree.
- `Duck.gltf` (root duplicate) — byte-identical copy of `Duck/glTF/Duck.gltf`. Removed.

## Removed demo models (2026-07-02 — release hardening asset audit)

- `FlyingKneeCombo.fbx` — added 2026-07-01 as the "Custom Mesh" demo entry
  (replacing Demo.glb/vmesh above), but its license could not be verified
  against any source. Removed from the working tree rather than ship an
  unverified asset. The "Custom Mesh" gallery slot was removed from
  `Demo.html` (both copies) and the `demo` profile removed from
  `volare-init.js`; no other verified FBX asset was available locally to
  substitute. Still in git history — a squashed initial commit (see
  `RELEASE_CHECKLIST.md`) purges it before the public push.

---

## HDR/ environment maps

**Status:** VERIFIED — all 9 files confirmed against official Poly Haven pages
**Source:** Poly Haven (https://polyhaven.com)
**License:** CC0 1.0 Universal (Public Domain Dedication)
**Redistribution:** Unrestricted (public domain). No attribution required.
**License file:** `HDR/LICENSE.md`

| File | Poly Haven Title | Author(s) | Verified |
|------|-----------------|-----------|----------|
| cobblestone_street_night_4k.hdr | Cobblestone Street Night | Greg Zaal, Jenelle van Heerden | Yes |
| kloofendal_48d_partly_cloudy_4k.hdr | Kloofendal 48d Partly Cloudy | Greg Zaal | Yes |
| little_paris_eiffel_tower_4k.hdr | Little Paris Eiffel Tower | Dimitrios Savva, Jarod Guest | Yes |
| lonely_road_afternoon_puresky_4k.hdr | Lonely Road Afternoon (Pure Sky) | Dimitrios Savva, Jarod Guest | Yes |
| meadow_4k.hdr | Meadow | Sergej Majboroda | Yes |
| photo_studio_01_4k.hdr | Photo Studio 01 | Sergej Majboroda | Yes |
| studio_small_03_4k.hdr | Studio Small 03 | Greg Zaal | Yes |
| studio_small_09_4k.hdr | Studio Small 09 | Sergej Majboroda | Yes |
| venice_sunset_4k.hdr | Venice Sunset | Greg Zaal | Yes |

### Removed HDR files (no longer in working tree)

These were removed in prior phases. Listed for completeness:
autumn_field_puresky_4k.hdr, meadow_2_4k.hdr, rosendal_park_sunset_puresky_4k.hdr,
tief_etz_4k.hdr, victoria_sunset_4k.hdr, wide_street_01_4k.hdr.

---

## Removed assets (working tree only — still in Git history)

These were removed from the working tree in prior phases due to high-risk or unknown provenance.
They remain in Git history. A fresh public repo export is required before
public GitHub to ensure they are not accessible via git history.

| Asset | Reason removed | Status |
|---|---|---|
| AudiR8.glb (82 MB) | GLB contains Audi-branded material names | BLOCKED — needs debranding |
| Helicopter/ (106 MB bin) | Exceeds GitHub 100 MB per-file limit | BLOCKED — needs compression |
| Models/Elephant.glb (1.5 MB) | Unknown origin, no license | REJECTED |
| Model/electric_box_43.glb (3 MB) | Marketplace naming, unknown license | REJECTED |
| Models/Background/heaven/ | Skybox origin unknown | REJECTED |
| assets/fontawesome-png/ | Unreferenced, license unclear | REJECTED |
| ~85 unreferenced Khronos model folders | Unverified locally | On hold |
| 6 unreferenced HDR files (~163 MB) | Unreferenced by runtime | On hold |
