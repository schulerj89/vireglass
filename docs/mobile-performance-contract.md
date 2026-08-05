# Mobile 60 FPS Contract

## Promise and scope

Vireglass targets **60 FPS** on supported iPhone and iPad Safari hardware in
landscape. That is a 16.7 ms frame-time goal during representative gameplay,
not an average reported from an empty scene. If a device cannot hold the target,
the game must use a reduced quality tier before it is allowed to fall below a
**30 FPS / 33.3 ms sustained-play floor**.

Loomwright records the exact supported baseline device(s). Until an observation
names the device model, iOS/iPadOS version, Safari, viewport, effective pixel
ratio, quality tier, build revision, and scenario seed, it is only a mobile
preflight, not a 60 FPS approval.

## Evidence levels

| Level | Owner | Required proof | What it allows |
| --- | --- | --- | --- |
| Preflight | Implementing worker | Build result, representative mobile-viewport capture, 20-second in-game metric sample, renderer counters, and the change's expected cost | Move the card to review and begin one independent next task. |
| Device gate | Embedded team QA | Three fresh 60-second runs on physical iPhone or iPad Safari after a short warm-up, with the complete metric record | Mark the integrated feature or milestone mobile-performance approved. |
| Release gate | Forge | Device-gate evidence for the assembled gameplay path, including reset/restart and the selected quality tier | Accept the milestone's player-facing mobile claim. |

Emulation is valuable for layout and regressions but can never replace the
physical-device gate. A worker does not wait idle for QA: after submitting a
complete preflight, they may take one dependency-safe task while their review is
pending.

## Pass criteria for the device gate

After a five-second warm-up, each 60-second representative combat run must
record frame time in milliseconds. The worst of the three runs must meet all of
these conditions on the claimed quality tier:

- median frame time is at or below **16.7 ms**;
- 95th-percentile frame time is at or below **20 ms**;
- there is no run of three consecutive frames slower than **33.3 ms** that is
  attributable to normal gameplay; and
- renderer counters and live object counts stabilize over repeated reset/restart
  cycles: no material, geometry, texture, or entity leak.

A failed 60 FPS result is not hidden by averaging. The card remains in review
or returns to working with the captured metrics, the suspected cost source, and
the next reduction action. A reduced tier may protect the 30 FPS floor, but it
does not let the default tier claim 60 FPS without proof.

## Quality and implementation rules

- Start Spark on a conservative default: WebGL, capped effective pixel ratio,
  no post-processing, simple opaque effects, shared materials/geometries, and
  instanced repeated props.
- Make quality choices explicit and observable. A reduced tier may lower pixel
  ratio and optional particle/detail density before it compromises combat
  readability; it must not silently change game simulation or hit timing.
- Capture a rolling frame-time buffer plus `renderer.info` calls, triangles,
  geometries, and textures; also capture viewport, effective pixel ratio,
  quality tier, active entities, and scene-reset count.
- Avoid per-frame resource creation, shader/material churn, texture loading,
  scene-wide traversal, per-entity allocation, and uncontrolled transparent
  layers. Pool effects and reuse render resources.
- Treat post-processing, new render targets, large alpha fields, dynamic
  shadows, and high-frequency raycasts as performance-budget changes. They need
  a stated visual benefit and before/after evidence.

## Task rule

Every task that can change what is drawn or simulated states its likely frame
cost and sends a self-proof with the handoff. Team QA validates the integrated
physical-device scenario; Loomwright shows both evidence level and the exact
device record. This keeps parallel work moving without turning every small
change into a blocking full-device test.
