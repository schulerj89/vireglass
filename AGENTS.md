# Vireglass Agent Guide

## Purpose and sources of truth

- Build Vireglass as a browser-first, high-angle 3D action roguelite.
- `docs/vireglass-brief.md` defines player-facing intent and scope.
- Loomwright owns live tasks, workers, sessions, token observations, QA status,
  and blockers. This repository owns source, stable decisions, and durable
  technical guidance.
- Read the closest applicable `AGENTS.md` before changing files. Add nested
  guidance only when a subsystem develops genuinely different rules.

## Delivery rules

- Work in thin vertical slices. Prefer a small playable behavior over a broad
  subsystem with no visible proof.
- A task must have one owner, bounded scope, an acceptance condition, and
  self-proof before it enters review.
- Do not turn planning, test notes, or task updates into large Markdown files.
  Record only durable game intent, architecture decisions, and asset rules here.
- Do not push, open pull requests, change remotes, or make external releases
  unless explicitly asked.
- Preserve unrelated user changes. Avoid drive-by formatting and refactors.

## Target platform: iPhone and iPad

- Vireglass is a touch-first web game for current iPhone and iPad Safari.
  Desktop is a local development preview only, not a supported player target or
  acceptance environment.
- Design the playable surface for landscape. Portrait or an unusably narrow
  viewport must present a clear rotate-to-play state rather than a broken HUD.
- Do not make gameplay depend on a keyboard, mouse, hover state, or a fixed
  desktop resolution. The canvas and HUD must react to the visual viewport,
  orientation changes, and Safari safe-area insets.
- The gameplay surface owns its touch gestures: prevent accidental page scroll,
  text selection, zoom affordances, and browser gestures from interrupting play
  where standards and Safari allow. Keep ordinary navigation and accessibility
  behavior outside the play surface intact.
- Use `WebGLRenderer` as the baseline renderer. Start from an iOS-safe quality
  path: an explicit pixel-ratio cap, opaque materials where practical, no
  Spark-era post-processing, reusable geometry/materials, and instancing for
  repeated props. Tune numerical budgets from physical-device observations;
  desktop numbers never prove iPhone or iPad performance.

## 60 FPS delivery contract

- The mobile performance goal is 60 FPS, expressed as a 16.7 ms frame-time
  target. A visual feature is not complete merely because it looks correct in
  a desktop preview.
- Follow `docs/mobile-performance-contract.md`. It separates a lightweight
  worker self-proof from the physical-device QA gate so workers can continue on
  safe, independent work while QA validates the integrated scenario.
- Instrument gameplay once the renderer exists: frame times, quality tier,
  viewport/effective pixel ratio, renderer calls, triangles, geometries,
  textures, active entities, and reset leaks. Record deltas for visual work.
- Do not allocate render resources, compile materials, load textures, or build
  unbounded object graphs in the frame loop. Pool transient effects and reuse
  geometry/materials. Treat a new full-screen pass or broad transparent effect
  as an explicit performance decision, not incidental polish.

## Three.js and assets

- Prefer TypeScript plus code-first Three.js factories (`THREE.Group`) over
  opaque one-off meshes.
- Procedural output must be deterministic when a seed is supplied.
- Repeated environment objects must reuse geometry/materials and use instancing
  where practical. Use proxy collision rather than render-mesh collision.
- Follow `docs/asset-workflow.md` for reference provenance, quality gates,
  visual review, and runtime acceptance.
- Do not add unlicensed or untracked web assets. A reference image is a study,
  not permission to copy a recognizable design or texture.

## Verification

- Every player-visible change needs one suitable proof: a browser capture,
  deterministic scenario, or focused automated check.
- Run the narrowest relevant validation after a change. Report commands that
  were actually run and failures that remain; never claim a pass without
  evidence.
- Once tooling exists, keep this section current with exact `dev`, `build`,
  `lint`, `test`, and browser-smoke commands.
- Performance is measured in the browser. Track renderer calls, triangles,
  geometries, textures, asset-load errors, and reset leaks when the renderer
  exists.
- A desktop viewport emulation is useful for early functional checks, but a
  mobile gameplay claim requires iPhone or iPad Safari evidence. Report which
  kind of evidence was obtained.

### Current shell commands

- `npm install`
- `npm run dev`
- `npm run build`

## Decision escalation

- Facet plans normal milestone work; embedded team QA validates it.
- Forge handles cross-team integration evidence.
- Axiom (Sol Max) is reserved for high-cost-to-reverse architecture, product,
  or release-blocking decisions.
- Add a concise ADR under `docs/decisions/` only when a decision changes
  multiple teams or would be expensive to undo.
