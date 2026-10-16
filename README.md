# The Drive Beyond

Browser-first driving / road-trip prototype from the Giblings franchise.

## Run on iPad with no extra apps

1. Enable **GitHub Pages** for this repository: **Settings → Pages → Deploy from a branch → `main` / root**.
2. Open the Pages URL in Safari.
3. On first launch, the game automatically downloads the two bundled Creative Commons vehicle packs from this repository and caches them in IndexedDB.
4. Later launches normally reuse the cached assets automatically.

No local web-server app or Files Preview workaround is required once GitHub Pages is enabled.

## Bundled vehicles

The player hatchback and generic passenger traffic pack are redistribution-permitted Creative Commons assets selected by the project owner. Required creator credits and source information are in `THIRD_PARTY_NOTICES.md`.

The repository expects these two files at its root:

- `tdb-player-assets.zip`
- `tdb-traffic-assets.zip`

Each ZIP retains the internal `assets/player/...` or `assets/traffic/...` folder structure used by the game.

## Current technology

- Three.js — 3D/WebGL rendering
- Rapier — ray-cast vehicle physics with kinematic fallback
- fflate — first-launch vehicle asset installation
- IndexedDB — local vehicle cache and game persistence
- Procedural terrain / road / scenery generated client-side
- IDM-inspired traffic following plus driver personality/error simulation

## Controls

Desktop: WASD/arrows drive, C camera, E interact, J journal, R recover, Esc pause.

Touch controls appear automatically on iPad/tablet.

## Project status

This repository is a playable vertical-slice alpha. It is not the final game. Multiplayer, richer AI travellers, full Giblings interactions, weather, detailed interiors, content streaming and further physics work remain in development.
