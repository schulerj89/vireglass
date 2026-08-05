# ADR-0001: Build Vireglass through thin browser-playable vertical slices

**Status:** Accepted

## Context

Vireglass is being developed with multiple focused workers and an external
Loomwright control plane. Broad subsystem work, a large design document, or
unbounded asset creation would make parallel work difficult to validate and
would bury whether the game is actually fun.

## Decision

Development proceeds through small, player-facing milestones. Every milestone
must end in a runnable browser proof, a compact visual capture, and the
narrowest appropriate build or smoke result.

The first milestones are Spark, Fracture, Anchor, and First Light. The game
uses active high-angle action-roguelite pacing: focused combat encounters,
meaningful Refraction choices, escalating pressure, and an Anchor payoff.

Vireglass assets follow a code-first, procedural/reusable workflow. The live
task board, session state, and QA evidence remain in Loomwright; the repository
contains only code, stable game intent, durable asset rules, and consequential
decision records.

## Consequences

- Teams can work in parallel only on file-safe, dependency-safe task packets.
- Documentation is limited to durable intent and decisions; Loomwright owns
  changing planning state.
- Browser gameplay evidence is required before a milestone can be accepted.
- Open-world scope, multiplayer, and large content systems are deferred until
  the first vertical slice demonstrates a strong core loop.
