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

## Decision escalation

- Facet plans normal milestone work; embedded team QA validates it.
- Forge handles cross-team integration evidence.
- Axiom (Sol Max) is reserved for high-cost-to-reverse architecture, product,
  or release-blocking decisions.
- Add a concise ADR under `docs/decisions/` only when a decision changes
  multiple teams or would be expensive to undo.
