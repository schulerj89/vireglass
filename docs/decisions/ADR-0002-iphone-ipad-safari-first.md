# ADR-0002: Target iPhone and iPad Safari first

**Status:** Accepted

## Context

Vireglass is a high-angle, real-time Three.js game. Its controls, screen
composition, render budget, and validation path would all drift if a desktop
preview were treated as an equal product target. The intended players use
iPhone and iPad, where touch input, landscape layout, safe areas, viewport
changes, and GPU limits are part of the game design rather than late polish.

## Decision

The supported player environment is current Safari on iPhone and iPad.
Vireglass is landscape-first and touch-first. The game must not require
keyboard, mouse, hover, or a fixed desktop resolution; it must handle visual
viewport changes and safe areas. Portrait and unusably narrow layouts present a
rotate-to-play state.

The renderer baseline is WebGL with a conservative mobile quality path. Spark
does not use post-processing and favors reusable geometry/materials, instancing,
and simple opaque effects. Desktop previews and emulated viewports may support
development, but they are not mobile-player acceptance evidence. Later
milestone acceptance requires an iPhone or iPad Safari observation. The shared
60 FPS measurement and evidence rules live in `docs/mobile-performance-contract.md`.

## Consequences

- Every player-facing task includes a touch and mobile-layout consideration.
- Mobile Safari performance instrumentation and physical-device proof become
  part of the delivery path; numerical budgets are calibrated from observations.
- The team deliberately does not spend time on desktop controls, layouts, or
  desktop-specific optimization unless they directly help the mobile target.
- A separate Android or native-app target would require a future explicit
  decision rather than quietly expanding this scope.
