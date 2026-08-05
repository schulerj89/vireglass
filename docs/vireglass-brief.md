# Vireglass Brief

## Player promise

Vireglass is a high-angle 3D action roguelite in which the player fights
through living crystal fracture-sites that react to combat. Every run should
feel readable, kinetic, and visibly transformed by the player's chosen build.

## Platform: iPhone and iPad Safari

Vireglass is made for Safari on current iPhone and iPad hardware, not for a
desktop player. The game is landscape-first: portrait and too-narrow viewports
should ask the player to rotate instead of trying to compress combat and the
HUD into an unusable shape.

All combat input must work through touch. The eventual controller needs clear
movement, aiming/attacking, and dash affordances without relying on keyboard,
mouse, or hover. Canvas and HUD layout must respect the live visual viewport
and device safe areas. A desktop preview can help a worker build a feature, but
only iPhone/iPad Safari evidence can validate player-facing mobile quality.

## World and end goal

A damaged world-machine is turning its surroundings into Vireglass and
creating hostile manifestations around its fracture-sites. The player recovers
five lost tones, reaches the central fracture, and ultimately decides whether
to restore the machine or silence it.

## Core run grammar

```text
Enter a fracture-site
-> tune a signal node
-> survive a focused encounter
-> choose a Refraction
-> respond to a changed arena and stronger enemies
-> defeat the Anchor
-> extract a tone
```

Vireglass takes pacing inspiration from active action-roguelites: combat has a
clear beginning and end, upgrades change the next encounter, and a run has a
boss payoff. It must not copy another game's characters, art, maps, or content.

## Signature system: Refractions

Refractions are build choices that change the relationship between attack,
movement, enemies, and crystal terrain. Candidate families include ricochet
shards, fracture trails, tuned-node turrets, shockwaves, orbiting fragments,
and beam lattices. The first playable needs only a few clear choices.

## Current production target: Spark

Spark proves the minute-to-minute feel before a full run is built:

- high-angle camera with a readable play-space;
- landscape touch movement, aim, dash, and one selected attack shape;
- one enemy with an understandable chase/attack state;
- one small procedural arena and a visible impact response;
- a 60-second iPhone/iPad Safari-playable loop with a captured proof.

## Selected Spark combat decision

The initial attack is an **aimed shard-cast**. It must be readable from the
high-angle camera, aimed through the touch control model, and leave a clear
crystal impact response. The continuous beam and close-range fracture dash are
deferred Refraction/weapon candidates, not first-Spark requirements.

## Milestone spine

1. **Spark**: the combat sandbox feels good.
2. **Fracture**: tune, fight, choose a Refraction, and extract in a 3-5 minute loop.
3. **Anchor**: three enemy types, several upgrades, and one readable boss.
4. **First Light**: one polished browser-playable fracture-site with reset/restart and acceptance smoke.
5. **The Chime**: multiple sites, persistent progression, and the five-tone ending path.

Only the current milestone is fully task-planned in Loomwright. The next
milestone may be sketched; later milestones remain intent until evidence shows
the current loop works.

## Explicit non-goals for the first playable

- An open world or seamless exploration map.
- Multiplayer or networked play.
- A large narrative system, voice acting, or many biomes.
- A broad imported 3D asset library.
- A giant automated test suite before core movement and combat are proven.

## Open decisions

- The exact visual language for the first fracture-site and the player silhouette.
