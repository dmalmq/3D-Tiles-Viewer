
---
title: 3D Gaussian Splatting - Fundamentals and Indoor Navigation
date: 2026-07-07
contributor: Daniel Malmqvist
type: reference-note
tags: [gaussian-splatting, 3dgs, nerf, sfm, colmap, indoor-navigation, slam, navmesh, cesium]
---

# 3D Gaussian Splatting: Fundamentals and Indoor Navigation

3D Gaussian Splatting (3DGS) is a powerful scene representation technique that sits between traditional point clouds/meshes and neural radiance fields (NeRFs). It was popularized by the 2023 paper "3D Gaussian Splatting for Real-Time Radiance Field Rendering."

## How 3D Gaussian Splatting Works (Especially with 3D Point Data)

A scene is represented as a large collection of 3D Gaussians — soft, oriented, semi-transparent ellipsoids (blobs) rather than hard points or triangles.

Each individual Gaussian stores:

- **Position** (3D mean/center)
- **Covariance** — defined by a 3D scale (size along 3 axes) + rotation (quaternion). This makes the Gaussian an anisotropic ellipsoid that can stretch and orient in any direction.
- **Opacity** (how transparent or solid it is)
- **Color** — represented with spherical harmonics (SH). This allows the color to change depending on the viewing angle (view-dependent effects like specular highlights, reflections, or subtle lighting changes).

## The Typical Pipeline (and Role of Point Data)

1. **Input**: A set of photos of the scene taken from many different viewpoints, plus the camera poses (position + orientation) for each photo. These poses and an initial 3D structure usually come from Structure-from-Motion (SfM) software like COLMAP. SfM produces a sparse point cloud as a byproduct.
2. **Initialization from point data**:
   - The sparse SfM point cloud provides the starting 3D positions for the Gaussians.
   - Each point can seed one (or more) initial Gaussian(s).
   - The point cloud acts as geometric "anchors" that give the optimization a good starting structure and rough scale of the scene.
3. **Optimization** (the magic step):
   - The system renders images from the current set of Gaussians and compares them to the real input photos.
   - It uses gradient descent to adjust all parameters of every Gaussian (position, scale, rotation, opacity, SH color coefficients) to minimize the difference.
   - **Adaptive densification**: In areas where the rendering error is high, Gaussians are cloned or split to add more detail.
   - **Pruning**: Gaussians that are almost transparent or contribute very little are removed.
   - Result: The final set of Gaussians is usually much denser and better distributed than the original sparse point cloud. It is optimized primarily for photorealistic appearance, not just geometry.
4. **Rendering** (very fast):
   - For a new viewpoint, each 3D Gaussian is projected onto the 2D image plane → becomes a 2D ellipse.
   - The ellipses are sorted by depth (approximate, tile-based sorting for speed).
   - They are alpha-blended front-to-back (or back-to-front).
   - This "splatting" process is rasterization-based and extremely fast — often 100+ FPS on modern GPUs, much faster than NeRF-style ray marching.

### Key point about point data

- Pure arbitrary point clouds (e.g., raw LiDAR without images) are not the ideal input. 3DGS is primarily an image-driven technique. The point cloud mainly serves as initialization and geometric guidance.
- There are methods to convert back from a trained Gaussian splat to a dense point cloud (by probabilistically sampling points from each Gaussian's distribution).
- Hybrids exist: you can use a dense point cloud or depth maps to help initialize or regularize the Gaussians, especially in textureless areas.

**In short**: The input point cloud gives structure and starting locations. The optimization then "inflates" and refines these into a set of smart, view-dependent ellipsoids that excel at reproducing what the scene looks like from any angle.

## Using Gaussian Splatting for 3D Indoor Navigation

An active and promising research area (2024–2026), with several dedicated papers and tools. GS is excellent for visual fidelity and novel view synthesis, which helps with immersive visualization and visual localization. However, it is not a complete drop-in replacement for traditional navigation representations yet.

### Strengths for Indoor Navigation

- Photorealistic real-time rendering (great for AR overlays, virtual walkthroughs, or training embodied AI agents).
- Good handling of complex geometry, thin structures, and view-dependent effects.
- Compact yet high-detail representation.
- Research systems show strong results for visual localization and image-goal navigation (e.g., "go to the object that looks like this photo").

### Notable Research Examples

- **GaussNav (2024/2025)**: Builds a semantic-augmented Gaussian map. The agent can render novel views of candidate objects, match them to a goal image using keypoint matching, then plan a path. It turns image-goal navigation into a more solvable point-goal task and achieved strong results on datasets like HM3D.
- **Habitat-GS (ECCV 2026)**: An extension of the popular Habitat simulator for embodied AI. It replaces (or augments) mesh rendering with 3D Gaussian Splatting for photorealistic RGB-D observations while keeping full compatibility with NavMesh-based pathfinding and agent control. It also supports dynamic Gaussian avatars. Excellent for training and testing navigation policies in high-fidelity environments.
- **3DGS-SLAM systems** (monocular, RGB-D, etc.): Use Gaussians for simultaneous mapping + localization, with improving indoor performance. Some use planar priors for walls/floors to handle textureless indoor surfaces better — e.g., **PlanarGS**.

### Practical Considerations & Challenges for Real Indoor Navigation Apps

Pure Gaussian Splatting is great for seeing the environment but weaker for interacting with it geometrically:

- **Collision detection & pathfinding**: Gaussians are soft volumetric primitives. Extracting clean, watertight meshes or reliable collision geometry is improving (there are "3DGS-to-mesh" tools), but not yet perfect for production navigation. Many systems use a hybrid approach.
- **Semantics & topology**: No built-in room labels, doors, or navigable graph. You usually add these separately or via semantic extensions.
- **Indoor-specific issues**: Textureless walls, repetitive patterns, specular surfaces, and lighting changes can reduce quality. Good capture (plenty of overlap, varied angles, decent lighting) helps a lot. Planar priors in newer methods mitigate some problems.
- **Scalability**: Large buildings benefit from hierarchical/tiled representations (similar to how Cesium is doing outdoor GS with 3D Tiles).

### Recommended Practical Approach Today (Hybrid Pipeline)

1. Capture the indoor space (phone apps like Scaniverse, or structured workflows) → produce both a point cloud/mesh and a Gaussian splat.
2. Use the point cloud or extracted mesh for accurate metric geometry, collision, and NavMesh generation (pathfinding).
3. Use the Gaussian splat for high-quality visual rendering and novel views.
4. In the app (CesiumJS, Unity, custom engine): Render the GS layer for beauty/immersion + overlay navigation UI or AR elements. Run pathfinding on the lighter geometric layer.
5. For web/streaming: Convert the GS to 3D Tiles for efficient delivery (see [[point-cloud-vs-gaussian-splatting-3d-tiles]]).

This gives the best of both worlds: accurate navigation from the point cloud side + photorealistic visuals from GS.

## Bottom Line

Gaussian Splatting is already very usable for the visual and localization parts of indoor navigation, and research tools like Habitat-GS make it straightforward for simulation and embodied AI. For full production navigation apps (robust collision + pathfinding + semantics), the hybrid approach (GS visuals + explicit geometry/NavMesh) is currently the most reliable and practical path — and it aligns nicely with converting both point clouds and splats into 3D Tiles.
