# Vireglass

Vireglass is an iPhone-and-iPad Safari-first, high-angle 3D action roguelite about entering
living crystal fracture-sites, recovering lost tones, and deciding whether to
restore or silence the world-machine that created them.

The playable target is landscape touch input on iPhone and iPad. Desktop is
only a local development preview and is not a supported player experience.

## Current target: Spark

Spark is the first intentional playable proof: a short combat sandbox where
movement, camera, aiming, dash, one weapon, and one enemy can be judged from a
player's point of view. It is not a content demo or a full game loop yet.

## Where to look

- [Agent guidance](AGENTS.md): durable engineering and verification rules.
- [Vireglass brief](docs/vireglass-brief.md): the compact game design source of truth.
- [Asset workflow](docs/asset-workflow.md): Glimmer's code-first reference-to-asset pipeline.
- [Mobile performance contract](docs/mobile-performance-contract.md): how the
  60 FPS target, worker proof, and iPhone/iPad QA gate work.
- [Decisions](docs/decisions): short records for high-cost-to-reverse choices.

The live task board, worker/session state, QA evidence, and token ledger live
in the separate Loomwright control plane. Do not duplicate that changing work
state in this repository.

## Status

## Development

```text
npm install
npm run dev
npm run build
```

The dev server exposes a minimal landscape-first shell. In development only,
`window.__vireglassMetrics()` returns the rolling frame-time summary and
renderer counters. Desktop viewport emulation is preflight evidence only; the
mobile acceptance gate requires physical iPhone or iPad Safari.
