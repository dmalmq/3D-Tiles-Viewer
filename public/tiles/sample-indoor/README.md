# Synthetic indoor sample

Tiny made-up indoor 3D Tiles dataset for the static read-only viewer.

- **Not** a real building, workplace, or station
- Geometry is generated in-repo by `scripts/generate-sample-tileset.js`
- License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain dedication)

## Static paths (same-origin, no Express)

| File | URL |
|---|---|
| Tileset | `/tiles/sample-indoor/tileset.json` |
| Session | `/tiles/sample-indoor/session.json` |
| glTF content | `/tiles/sample-indoor/content.glb` |

Open in the read-only viewer: `/viewer.html` (this sample is the default) or `/viewer.html?session=/tiles/sample-indoor/session.json`.
