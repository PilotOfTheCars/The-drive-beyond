# The Drive Beyond

Browser-first driving / road-trip prototype from the Giblings franchise.

## Run on iPad with no extra apps

1. Enable **GitHub Pages** for this repository: **Settings → Pages → Deploy from a branch → `main` / root**.
2. Open the Pages URL in Safari.
3. On first launch, tap **IMPORT PRIVATE CAR ASSETS** and choose `the-drive-beyond-assets.zip` from the Files app.
4. Safari stores the models locally in IndexedDB, so later launches normally do not need the ZIP again.

The public repository intentionally does **not** contain the paid/private car model files. The game code loads them locally from the player's device. This avoids publishing raw third-party assets in a public repository.

## Current technology

- Three.js — 3D/WebGL rendering
- Rapier — ray-cast vehicle physics with kinematic fallback
- fflate — one-time local ZIP import
- IndexedDB — private local asset cache and game persistence
- Procedural terrain / road / scenery generated client-side
- IDM-inspired traffic following plus driver personality/error simulation

## Controls

Desktop: WASD/arrows drive, C camera, E interact, J journal, R recover, Esc pause.

Touch controls appear automatically on iPad/tablet.

## Project status

This repository is a playable vertical-slice alpha. It is not the final game. Multiplayer, richer AI travellers, full Giblings interactions, weather, detailed interiors, content streaming and further physics work remain in development.
