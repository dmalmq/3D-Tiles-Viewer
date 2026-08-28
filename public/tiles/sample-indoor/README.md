# Synthetic indoor sample

Tiny made-up indoor 3D Tiles dataset for the static read-only viewer.

- **Not** a real building, workplace, or station
- Geometry is generated in-repo by `scripts/generate-sample-tileset.js`
- License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain dedication)

## Static paths (same-origin, no Express)

Paths are under Vite `base` (default `/`). On GitHub project Pages set `base: "/<repo>/"` so these are not requested from domain root.

| File | URL |
|---|---|
| Tileset | `{base}tiles/sample-indoor/tileset.json` |
| Session | `{base}tiles/sample-indoor/session.json` |
| glTF content | `{base}tiles/sample-indoor/content.glb` |

Open in the read-only viewer: `{base}viewer.html` (this sample is the default) or `{base}viewer.html?session={base}tiles/sample-indoor/session.json`.
