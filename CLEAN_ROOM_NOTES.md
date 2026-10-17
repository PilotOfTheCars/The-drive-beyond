# Clean-room development notes

The Drive Beyond is an original implementation.

## Slow Roads references

Historical Slow Roads mirrors may be inspected only to understand high-level behavior and engineering ideas such as:

- endless chunk streaming
- smooth procedural roads
- terrain following the road corridor
- floating-origin world management
- vegetation placement
- camera smoothing
- browser performance strategies

No Slow Roads source code, assets, identifiers, constants, shaders, data files, or unique implementation details are copied into The Drive Beyond.

The archived RobertTBS mirror explicitly states that the historical Slow Roads build it mirrors was under CC BY-NC-ND 4.0, so it is not used as a code dependency or source of modified snippets. The ViratTomar mirror is likewise treated as reference material only.

## Independent implementation

The Drive Beyond's road, terrain, traffic, interaction and streaming systems are independently written around general techniques such as deterministic noise, route-relative terrain strips, chunk streaming, instancing and floating-origin rendering.

## Permissive dependencies and assets

Third-party libraries and assets actually distributed with the project must be separately listed in THIRD_PARTY_NOTICES.md and used according to their licenses.
