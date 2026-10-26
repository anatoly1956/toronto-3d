# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Interactive, stylized 3D model of downtown Toronto (Three.js + Vite, plain JavaScript, no UI framework). Buildings, shoreline, roads, rails, parks and trees come from OpenStreetMap; the CN Tower and Rogers Centre are hand-modelled.

## Commands

```bash
npm run dev         # Vite dev server on :5173
npm run build       # static site -> dist/ (relative base './', works from any sub-path)
npm run preview     # serve dist/
npm run fetch-osm   # (re)build public/data/city.json from OpenStreetMap
```

There are no tests or linters.

Deployment: pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and publishes to GitHub Pages (https://anatoly1956.github.io/toronto-3d/).

## Data pipeline (`scripts/`)

- `fetch-osm.mjs` runs the Overpass queries (`QUERIES`) and caches each raw response in `scripts/cache/<name>.json` (gitignored). Cached queries are not refetched: delete a cache file to refetch that layer. Public Overpass servers are often overloaded (502/504), so the script rotates through `ENDPOINTS` with exponential backoff. A run can take minutes.
- `process-osm.mjs` turns the raw data into a single compact `public/data/city.json`, which **is committed**. The site never calls OSM at runtime. When you change only processing logic, re-running `npm run fetch-osm` reprocesses from the cache without any network calls.
- `src/geo.js` is shared by the Node script and the browser. Projection: local metres around the CN Tower, `x` = east, `y` = north. In the scene, **north is −z** (`toScene` and `layFlat` handle this). `city.json` stores flat `[x0,y0,x1,y1,…]` arrays in local metres, rounded to 0.1.
- `city.json` fields the front end relies on:
  - **buildings:** `p` outer ring, `h` holes, `t` height, `m` min height, `c` wall colour, `r` roof colour, `k` (0 matte, 1 glass);
  - **roads:** `w` width, `k` (1 = expressway), `o` one-way, `e` per-vertex elevation;
  - **rails:** `k` (0 heavy rail, 1 tram);
  - **trees:** a flat xy array;
  - also `land`, `water`, `parks`, `piers`, `ferries` and `bounds`.
- Non-obvious processing rules:
  - Simple-3D-buildings rule: a building outline that contains `building:part`s is dropped. The parts inherit the parent outline's tags and colour seed (`lookOf`).
  - Footprints near the CN Tower and Rogers Centre are removed via `EXCLUDE` (radius around each centre), because those are hand-modelled. A new hand-modelled landmark needs an entry there.
  - Lake Ontario is a water multipolygon, not `natural=coastline`. Its outer ways are stitched and oriented west to east (land on the left), its inner ways (islands) counter-clockwise. These are then clipped to `LAND_RECT` to produce land polygons. The scene draws one huge lake plane underneath, with land on top.
  - Gardiner Expressway elevation (`GARDINER_DECK`), ramps and bridge humps are computed per vertex in `processRoads`.

## Front end (`src/`)

- `main.js` wires everything together:
  - renderer, `OrbitControls`, camera fly-to tween (`flyTo` / `updateFlight`), loading `city.json`;
  - landmark selection (highlight ring, info card, label decluttering);
  - the render loop, including the fps/calls/tris readout.
  - In dev, `window.__toronto` exposes `{ camera, controls, scene, renderer, flyTo }` for debugging from the browser console.
- `environment.js`: one time-of-day value (0 = midday to 1 = night) drives everything through `KEYS` keyframes: sun/moon light, sky shader, fog, exposure, the colours of land/park/water/road materials, and the shared `nightUniform`. Water and glass reflect the sky through a PMREM environment map re-rendered from a copy of the sky (`addReflective`).
- Procedural detail is done by patching built-in `MeshStandardMaterial`s with `onBeforeCompile`, not with textures:
  - `windows.js`: window grid, night lights and fake ambient occlusion, all keyed off world position and normal;
  - `city.js`, `addLaneMarkings`: road, expressway, rail and tram markings from an `aLane` attribute (across, along, kind);
  - `environment.js`, `addWaves`: water ripples.
  - Patched materials set `customProgramCacheKey` so their variants compile separately.
  - Avoid GLSL ES 3.0 reserved words as identifiers (e.g. `patch`, `sample`): they fail shader compilation only at runtime.
- `city.js` merges extruded buildings into a few chunked meshes per material, so per-building changes happen at build time (vertex colours), not per object. Trees, rooftop units and pillars are `InstancedMesh`es.
- `traffic.js` stitches road, rail and ferry polylines into `Path`s (`stitch` is direction-aware for one-way roads) and animates instanced cars, GO trains, ferries and sailboats.
- Landmarks:
  - `landmarks/info.js` is the data for all clickable labels and cards: lat/lon, stats, text, camera distance `view`, an optional fixed label `height`, and an optional `action`. `action: 'roof'` adds the Rogers Centre roof toggle in `main.js`.
  - Label heights without a fixed `height` are measured by raycasting the building meshes.
  - `CSS2DRenderer` only adds a label element to the DOM once it has been on screen, so off-screen labels may be missing from the DOM.
- `ui.js` + `style.css` + `index.html`: dark glass UI.
  - The bottom `.dock` holds the key hints and Reset view; `.time` is the time-of-day pill; `.corner` holds the stats readout and the OSM credit.
  - Breakpoints at 980px and 640px rearrange these. Under 640px the landmark card becomes a bottom sheet.
