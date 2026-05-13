# 3D Tiles Viewer

A single-page web application for viewing 3D Tiles datasets, built with [Vite](https://vitejs.dev/) and [CesiumJS](https://cesium.com/platform/cesiumjs/).

## Features

- Load remote or local 3D Tiles tilesets
- Switch between multiple imagery and terrain providers (OSM, Bing, GSI, etc.)
- Floor-level clipping for building interiors
- Shapefile (.zip) overlay support via GeoJSON
- LOD filtering for PLATEAU CityGML tilesets

## Getting Started

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Tech Stack

- Vite
- CesiumJS
- shpjs (shapefile parsing)

## License

Private — all rights reserved.
