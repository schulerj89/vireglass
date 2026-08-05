# Glimmer Asset Workflow

## Intent

Glimmer creates reusable Vireglass assets through a code-first, quality-gated
pipeline. The preferred result is a deterministic TypeScript `THREE.Group`
factory with named parts, pivots/sockets where useful, proxy collision, and a
clear instancing/reuse plan. It is not a one-click mesh download workflow.

This approach is informed by the open-source
[img2threejs](https://github.com/img2threejs/img2threejs) project: reference
image to specification, staged procedural construction, render comparison, and
runtime-ready output. The local skill is a workflow aid; Vireglass does not
need to vendor it as a runtime dependency.

## Asset card before work starts

Every asset task in Loomwright records:

- purpose and gameplay use;
- owning team and target scene;
- reference image or reference brief, plus source/provenance;
- intended stylization and identity-defining features;
- expected reuse/instancing and deterministic seed behavior;
- collision/interaction needs;
- visual proof and runtime-budget proof required for acceptance.

References may be user supplied, generated as a visual brief, or obtained from
an appropriately licensed source. They are visual studies, not permission to
copy an existing game's recognizable model, texture, or brand identity.

## Pipeline

1. **Intake**: verify that the reference is suitable, record what one view does
   not show, and request more views when hidden structure matters.
2. **Quality contract**: write the object's purpose, silhouette, materials,
   action anchors, reuse plan, and accepted stylization level.
3. **Factory build**: create a deterministic TypeScript `THREE.Group` from
   primitives, generated geometry, shaders, and generated textures where useful.
4. **Visual review**: compare a stable gameplay-camera screenshot against the
   reference/brief. State what matches, what is approximate, and the next
   correction action.
5. **Runtime acceptance**: test placement, scale, readability, collision proxy,
   reset behavior, reuse/instancing, and asset-load behavior in the browser.

## Runtime rules

- Mobile Safari is the runtime budget authority. A desktop preview or a static
  file-size estimate cannot establish that an asset is acceptable on iPhone or
  iPad hardware.
- Spark starts on a conservative WebGL path: capped effective pixel ratio,
  opaque/simple materials where possible, no post-processing, and no large
  transparent particle field. Add a visual cost only with measured value.
- Repeated props share geometry and materials; use cloning or instancing rather
  than generating a new asset for every placement.
- Static layout and primitive fallbacks load before optional visual detail.
- Collision is authored as simple proxy geometry, never copied from render meshes.
- Track loaded IDs, draw calls, triangles, geometries, textures, load failures,
  and scene-reset leaks once renderer instrumentation exists.
- Set per-scene numerical budgets from a measured browser baseline. Do not claim
  performance from static file size or a headless smoke test alone.
- Record whether a runtime observation came from a simulated mobile viewport or
  physical iPhone/iPad Safari. Physical-device evidence is required before a
  player-facing mobile performance claim is accepted.
- Follow the shared [mobile performance contract](mobile-performance-contract.md)
  for the 60 FPS gate and the light-weight self-proof expected on each asset
  change.

## First asset kit

The first Glimmer deliverables should be small and reusable: a crystal cluster
family, a tuned signal node, a corruption/decal language, impact fragments, and
one enemy silhouette. The kit must make Tessera's first arena legible from the
gameplay camera before more decorative assets are approved.
