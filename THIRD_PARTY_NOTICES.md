# Third-party notices

The Drive Beyond is built open-source-first. The production browser bundle includes or adapts the following permissively licensed projects. Exact dependency versions are pinned in `package.json` / `package-lock.json`.

## Runtime and build software

- **three.js** — MIT License — https://github.com/mrdoob/three.js
  - 3D renderer, scene graph, loaders, cameras, lighting and asset runtime.
- **Rapier JavaScript (`@dimforge/rapier3d-compat`)** — Apache-2.0 — https://github.com/dimforge/rapier.js
  - Rigid-body physics, heightfield collision and ray-cast vehicle controller.
- **three-terrain-lod (`@interverse/three-terrain-lod`)** — MIT License — https://github.com/aiira-co/three-terrain-lod
  - Quadtree terrain LOD, instanced terrain chunks, skirts and terrain material system.
- **Dexie** — Apache-2.0 — https://github.com/dexie/Dexie.js
  - IndexedDB persistence for saves and the Journey Journal.
- **simplex-noise** — MIT License — https://github.com/jwagner/simplex-noise.js
  - Deterministic procedural terrain and route noise.
- **XState** — MIT License — https://github.com/statelyai/xstate
  - Interaction/player state machines.
- **Yuka** — MIT License — https://github.com/Mugen87/yuka
  - Autonomous traveller/agent AI primitives.
- **three-mesh-bvh** — MIT License — https://github.com/gkjohnson/three-mesh-bvh
  - Spatial acceleration / fast mesh ray queries.
- **Trystero** — MIT License — https://github.com/dmotz/trystero
  - Optional browser-to-browser private friend-session transport.
- **esbuild** — MIT License — https://github.com/evanw/esbuild
  - Build tooling used to produce the self-contained browser bundle.

## Traffic simulation reference / adapted code

- **traffic-microsim** by SaintPepsi — MIT License — https://github.com/SaintPepsi/traffic-microsim
  - The Drive Beyond adapts the MIT-licensed Intelligent Driver Model (IDM) formula and driver-profile approach, then adds its own route integration, perception error, frustration, risky overtaking, crash handling, traffic assets and game-state integration.

## Environment assets

### Quaternius nature assets

- Creator: **Quaternius**
- License: **CC0 1.0 Universal / Public Domain Dedication**
- Source mirror used by the reproducible build: https://github.com/agentkaerf/FreeModels
- Source revision pinned by the build: `db3df04d1e4714298a09510b26fb6de6645138a2`
- Current bundled assets include selected tree and rock models/textures from the Quaternius nature packs.

## Vehicle assets

The Drive Beyond redistributes the following user-selected Creative Commons vehicle assets with attribution, as permitted by their licenses.

### Generic passenger car pack

- Creator: **Comrade1280**
- Source: Sketchfab — “Generic passenger car pack”
- Model page: https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5
- License: **Creative Commons Attribution (CC BY)**
- Use in this project: AI traffic vehicles

### HatchBackLowPoly

- Creator: **YunxDestro-3d-Models**
- Source: CGTrader
- Asset: **HatchBackLowPoly**
- License: Creative Commons attribution-style license permitting redistribution/use with creator credit, as supplied with the asset by the user
- Use in this project: player vehicle

## Slow Roads reference boundary

The unofficial/outdated Slow Roads repositories previously supplied by the project owner are used only as behavioral/architectural reference material. No Slow Roads code, assets, shaders, identifiers, constants or unique implementation details are intentionally copied into The Drive Beyond. See `CLEAN_ROOM_NOTES.md`.

The original creators retain all rights granted and reserved by their respective licenses. Inclusion in The Drive Beyond does not imply endorsement by any creator or project.
