# Vireglass

Vireglass is a browser-first, high-angle 3D action roguelite about entering
living crystal fracture-sites, recovering lost tones, and deciding whether to
restore or silence the world-machine that created them.

## Current target: Spark

Spark is the first intentional playable proof: a short combat sandbox where
movement, camera, aiming, dash, one weapon, and one enemy can be judged from a
player's point of view. It is not a content demo or a full game loop yet.

## Where to look

- [Agent guidance](AGENTS.md): durable engineering and verification rules.
- [Vireglass brief](docs/vireglass-brief.md): the compact game design source of truth.
- [Asset workflow](docs/asset-workflow.md): Glimmer's code-first reference-to-asset pipeline.
- [Decisions](docs/decisions): short records for high-cost-to-reverse choices.

The live task board, worker/session state, QA evidence, and token ledger live
in the separate Loomwright control plane. Do not duplicate that changing work
state in this repository.

## Status

The repository is intentionally at the documentation/bootstrap stage. When
the game scaffold is introduced, add the exact development, build, lint, test,
and browser-smoke commands to `AGENTS.md` and this README.
