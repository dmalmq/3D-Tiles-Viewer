---
title: Point Cloud vs Gaussian Splatting to 3D Tiles - Conversion Workflows
date: 2026-07-07
contributor: Daniel Malmqvist
type: reference-note
tags: [3d-tiles, point-cloud, gaussian-splatting, cesium, photogrammetry, geospatial]
---

# Converting Point Clouds and Gaussian Splats to 3D Tiles

## 1. Point Cloud → 3D Tiles (Traditional pnts format)

**Difficulty: Low** (minutes to a few hours for most datasets). This is a well-solved problem with stable, production-ready tools.

### Recommended tools

- **Cesium ion** (easiest): Upload LAS/LAZ/PLY (or multiple files). It handles tiling, reprojection (usually to EPSG:4326), and hosting. Supports georeferencing and merging multiple clouds. Great if you want it in the Cesium ecosystem immediately.
- **py3dtiles** (free, local, excellent): Python CLI tool. One-liner example:
  `py3dtiles convert your_cloud.laz --out ./tiles/ --overwrite`
  Supports LAS, LAZ, XYZ, PLY, etc. Generates tileset.json + pnts tiles. Very scriptable.
- **Other options**: gocesiumtiler (Go), various community scripts.

### Typical steps

1. Ensure good georeferencing / coordinate system info.
2. (Optional) Classify or filter points if needed.
3. Run the converter/tiler.
4. Load in CesiumJS as `Cesium3DTileset`.

**When it's harder**: Very large/unstructured clouds, custom attributes you want to preserve, or strict offline/air-gapped requirements.

## 2. Gaussian Splatting → 3D Tiles (glTF + KHR_gaussian_splatting extensions)

**Difficulty: Low–Medium** if you already have a solid PLY file. **Medium–High** if you need to generate the splat from images or a point cloud.

This is newer but has moved quickly into production use. 3D Gaussian Splats are now supported natively in CesiumJS, Cesium for Unreal, and Cesium ion, using glTF as the payload inside 3D Tiles (with hierarchical LOD). It's heading into the proposed 3D Tiles 2.0 standard.

### Key advantages over traditional point clouds

- Much higher photorealism (view-dependent color via spherical harmonics, soft edges, better handling of thin structures like wires/vegetation, reflections, transparency).
- Excellent for drone/phone photogrammetry captures.

### Main workflows (2026)

**A. Easiest (cloud) — Cesium ion**

- Upload photos directly → iTwin Capture pipeline can output a georeferenced Gaussian splat 3D Tileset with LOD.
- Or upload an existing PLY → it tiles it into 3D Tiles 1.1 (some users have reported occasional crashes with certain PLY structures; support can help).

**B. Local / open source (recommended for control)**

- Use **3DGS-PLY-3DTiles-Converter** (Node.js CLI/library by WilliamLiu-1997):
  `npx 3dgs-ply-3dtiles-converter input.ply output_dir --coordinate "[lat, lon, height]"`
- Takes standard GraphDECO/COLMAP-style or KHR-native Gaussian PLYs.
- Outputs hierarchical 3D Tiles with adaptive LOD (splat simplification on coarser levels) + SPZ-compressed GLB tiles (big size reduction).
- Good geospatial support (`--coordinate` or `--transform`).
- Includes an inspector for QA/cropping.
- Other community tools exist (some voxel/octree-based), but the above is one of the more complete open options right now.

**C. From raw images (full pipeline)**

1. Capture photos or video with good overlap.
2. Run SfM (COLMAP, RealityCapture, Scaniverse, etc.) for poses + initial point cloud.
3. Train Gaussian Splatting (gsplat, SuperSplat, or commercial tools).
4. Export PLY → convert to 3D Tiles as above.

This step is the real time/compute sink (GPU hours, parameter tuning for quality).

### From a pure point cloud (no images)?

Not direct. 3DGS is primarily image-driven. You can:

- Use the point cloud for traditional 3D Tiles (simpler + measurable).
- Use the point cloud as initialization/reference while training splats from images (common hybrid in photogrammetry).
- Load both a point cloud tileset and a splat tileset in the same Cesium scene.

## Practical Difficulty Summary

| Task | Difficulty | Time (typical dataset) | Best Tool | Notes |
|------|-----------|------------------------|-----------|-------|
| Point cloud → 3D Tiles | Low | Minutes–hours | Cesium ion or py3dtiles | Mature, reliable |
| GS PLY (ready) → 3D Tiles | Low–Medium | Minutes–hours | Cesium ion or Node.js converter | LOD + compression handled |
| Full images → GS PLY → 3D Tiles | Medium–High | Days (compute + tuning) | Various + converter | Quality depends on capture |
| Large/city-scale with good LOD | Medium | Hours–days | Ion or good converter | Essential for performance |
| Custom integration (CesiumJS/Three.js) | Medium | Days–weeks | CesiumJS or 3D-Tiles-RendererJS plugin | Extension support is solid now |

## Key Considerations

- **Scale & LOD**: Critical for anything beyond small objects. Both paths now support proper hierarchical LOD.
- **Georeferencing**: Very important in AEC/3D navigation use cases. Provide coordinates or use capture tools that geo-reference automatically. Japan-specific CRS handling may need care.
- **File sizes**: Raw PLYs are huge. Tiling + SPZ compression makes streaming feasible.
- **Rendering**: Best experience in CesiumJS right now (specialized shaders + sorting). Three.js has community plugins.
- **Use case fit**: Traditional point clouds win for measurement/analysis. Gaussian splats win for visual fidelity and "as-built" realism from photos.
- **Stack integration**: Works well with Revit/ACC, geopackages, and Cesium/Unity navigation apps. Both the Python (py3dtiles) and Node.js paths are easily scriptable.

## Bottom line

- Point cloud path → easy today.
- Gaussian splatting path → surprisingly approachable in 2026 if you have (or can generate) a PLY; the tiling/LOD/compression part is no longer a major research project.
