// src/scene/seeking-orbs.js (v2.6 — REPLACES src/scene/glyphs.js)
//
// Places SEEKING_ORBS.count small clusters of orbs along vortex.js's travel axis. Each cluster is
// a one-off in-tunnel encounter (CONCEPT.md v2.6): while distant, the orbs visibly wander/flicker
// uncertainly — small, individually-varied jitter and irregular brightness — as if still looking
// for their place; as the camera approaches, the wander smooths out and the orbs settle into a
// calmer, brighter, steadier glow, peaking exactly at closest approach. This is a one-shot "found,
// once" moment (never re-triggers once settled, mirroring "resonance not response" and the
// retired glyphs.js's own one-shot resolve discipline) — a small, specific echo of the whole
// piece's own "lost -> found" arc, replacing the old "404" glyph-formations (feedback: "I noticed
// we have random numbers showing up in our portal... we should show hanging orbs that are trying
// to find themselves, properly choreograph this").
//
// ARCHITECTURE UNCHANGED FROM glyphs.js (deliberately reused, not reinvented — same placement/
// dwell-fitting/proximity-resonance discipline, only the visual content and the settle choreography
// are new):
//   - createSeekingOrbs(scene, travelAxisAccessor) -> handle, called once at integration time.
//     `travelAxisAccessor` is a zero-arg function returning a THREE.Curve-like object exposing
//     getPointAt(t)/getTangentAt(t) over the traverse's own [0,1] — called on demand, never
//     captured once, so this module tolerates vortex.js not having built its curve yet (a null
//     axis is a safe no-op) and avoids the vortex.js<->seeking-orbs.js circular-import hazard
//     ARCHITECTURE.md warns about (main.js passes vortex.js's getVortexAxis in by reference).
//   - updateSeekingOrbs(handle, state, camera, dt) -> called every frame. Owns no path logic and
//     creates no light sources of its own (lighting.js is the sole owner of light/emissive math;
//     this module calls its setAccentBoost(id, amount) helper for localized brightening, unchanged
//     interface from glyphs.js).
//   - Worst-case dwell-time fitting at max scroll speed (WORST_CASE_DWELL_SECONDS below) — the
//     exact same derivation glyphs.js used, so a fast scroller is still guaranteed enough on-screen
//     time to register the settle, per CONCEPT.md's velocity-ceiling promise.

import * as THREE from 'three';
import { SEEKING_ORBS, COLOR, PULSE, SCROLL, VORTEX } from '../config.js';
import { setAccentBoost, igniteOverflow } from './lighting.js';
import { buildGlowOrb } from './glow-sprite.js';

// Small radial/vertical offset off the travel axis so a cluster reads as coalescing out of the
// surrounding particle flow rather than floating dead-center in the camera's flight path — same
// role/value AXIS_OFFSET played in glyphs.js.
const AXIS_OFFSET = 1.6; // meters, alternating left/right of the travel axis
const CLUSTER_HEIGHT_OFFSET = 0.15; // meters, relative to eye height — roughly face-height
const CLUSTER_SPREAD = 0.9; // meters — how far individual orbs within one cluster sit from the cluster's own anchor point

// Worst-case on-screen dwell time inside the proximity-resonance sphere, computed from the scroll
// velocity ceiling — identical derivation to glyphs.js's own WORST_CASE_DWELL_SECONDS (CONCEPT.md:
// "a velocity ceiling still gives every encounter enough on-screen time to register").
const MAX_TRAVEL_SPEED = VORTEX.travelSpan / SCROLL.minDuration; // meters/sec at the velocity ceiling
const RESONANCE_HALF_CHORD = Math.sqrt(
  Math.max(0, SEEKING_ORBS.proximityResonanceRadius ** 2 - AXIS_OFFSET ** 2)
);
const WORST_CASE_DWELL_SECONDS = (RESONANCE_HALF_CHORD * 2) / MAX_TRAVEL_SPEED;

// Reused scratch color objects for the per-frame teal->gold lerp (avoids allocating new
// THREE.Color instances every frame per orb) — same pattern glyphs.js used for its own text color.
const _baseOrbColor = new THREE.Color(SEEKING_ORBS.color);
const _overflowColor = new THREE.Color(COLOR.overflowEnd);
const _orbColor = new THREE.Color();

// v2.9, NEW — the halo sprite of each orb's glow-sprite pair (see glow-sprite.js) is dimmer than
// its core, same "bright center, soft dissolving falloff" read vortex.js's companion orbs and the
// Guiding Orb's own multi-layer stack both use.
const HALO_OPACITY_SCALE = 0.3;

/**
 * Distributes SEEKING_ORBS.count evenly-spaced parametric positions along (0,1), avoiding the very
 * start/end of the traverse span so encounters never land exactly at phase boundaries (entry/exit)
 * — identical shape to glyphs.js's glyphParamPositions (camera.js/vortex.js's regional-variety
 * systems re-derive this same spacing independently from SEEKING_ORBS.count, so changing this
 * function's shape would desync them — see ARCHITECTURE.md's module-boundary warning).
 */
function encounterParamPositions(count) {
  const positions = [];
  const margin = 0.12;
  const span = 1 - margin * 2;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : margin + (span * (i + 0.5)) / count;
    positions.push(t);
  }
  return positions;
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

/**
 * Resolves the travel-axis curve from the accessor function, tolerating it not being ready yet
 * (e.g. called before vortex.js has built its curve) by returning null rather than throwing —
 * callers treat a null curve as "nothing to place/update yet." Identical contract to glyphs.js's
 * resolveAxis()/guide.js's/vision.js's own copies of the same defensive shape.
 */
function resolveAxis(travelAxisAccessor) {
  if (typeof travelAxisAccessor !== 'function') return null;
  const axis = travelAxisAccessor();
  if (!axis || typeof axis.getPointAt !== 'function' || typeof axis.getTangentAt !== 'function') {
    return null;
  }
  return axis;
}

/**
 * Places SEEKING_ORBS.count clusters of SEEKING_ORBS.clusterSize small orb sprites along the
 * travel axis vortex.js exposes. `travelAxisAccessor` is a zero-arg function returning a
 * THREE.Curve-like object (see this file's header comment for the exact contract) — called here
 * once to seed initial placement, and again every frame from updateSeekingOrbs() so clusters stay
 * correctly positioned even if vortex.js's underlying curve is rebuilt later (e.g. on resize).
 * Returns a handle consumed by updateSeekingOrbs().
 */
export function createSeekingOrbs(scene, travelAxisAccessor) {
  const group = new THREE.Group();
  group.name = 'seeking-orbs';
  scene.add(group);

  const count = Math.max(1, SEEKING_ORBS.count | 0);
  const params = encounterParamPositions(count);

  const clusters = params.map((t, i) => {
    const orbs = Array.from({ length: Math.max(1, SEEKING_ORBS.clusterSize | 0) }, (_, orbIndex) => {
      // v2.9, NEW — feedback: "the portal orbs doesn't have the glow effect, they need to
      // represent soft glowing orbs of soul." Replaced the old solid SphereGeometry+
      // MeshBasicMaterial sphere with glow-sprite.js's shared core+halo additive-sprite technique
      // (same rendering family the Guiding Orb uses). Diameters chosen to roughly match the old
      // sphere's 0.16m radius (0.32m diameter) at rest, with SEEKING_ORBS' own settledScaleBoost
      // still driving the group's overall scale exactly as it drove the old mesh's scale.
      const { group: orbGroup, core, halo } = buildGlowOrb(0xffffff, 0.24, 0.85); // color set per-frame below (this orb's resolved teal->gold blend), 0xffffff here is just a safe non-black seed before the first update
      orbGroup.visible = false; // stays hidden until first placement resolves a real axis
      group.add(orbGroup);

      // Each orb within a cluster gets its own randomized wander phase/rate/local offset so a
      // cluster of SEEKING_ORBS.clusterSize orbs reads as several individually-searching
      // presences, not one animation repeated N times — same "individually varied, not N clones"
      // discipline vortex.js's own companion orbs already follow.
      return {
        mesh: orbGroup, // kept as `mesh` for this file's existing position/visibility call sites — now a glow-sprite group, not a solid mesh
        core,
        halo,
        localOffset: new THREE.Vector3(
          (Math.random() - 0.5) * 2 * CLUSTER_SPREAD,
          (Math.random() - 0.5) * 2 * CLUSTER_SPREAD * 0.6,
          (Math.random() - 0.5) * 2 * CLUSTER_SPREAD
        ),
        wanderSeed: Math.random() * 1000,
        wanderHz: THREE.MathUtils.lerp(SEEKING_ORBS.wanderSpeedHz.min, SEEKING_ORBS.wanderSpeedHz.max, Math.random()),
        flickerSeed: Math.random() * 1000,
        flickerHz: 2.2 + Math.random() * 3.1, // fast, irregular — reads as uncertain, not a calm breathing pulse
        baseOpacity: 0.35 + Math.random() * 0.25,
        pulsePhase: Math.random() * Math.PI * 2, // desynced starting phase, syncs on approach (same role glyphs.js's per-glyph pulsePhase played)
        currentBpm: PULSE.bpmStart,
      };
    });

    return {
      id: `seeking-orb-${i}`,
      orbs,
      t,
      side: i % 2 === 0 ? 1 : -1,
      placed: false,
      resolved: false, // one-shot "found, settled" flag — never re-triggers once true, same discipline glyphs.js's triggerResolve() used
      currentBoost: 0,
      anchor: new THREE.Vector3(),
      right: new THREE.Vector3(),
    };
  });

  const handle = {
    group,
    clusters,
    travelAxisAccessor,
  };

  // Best-effort initial placement in case the axis is already available (createVortex may well
  // have run before createSeekingOrbs in main.js's integration order) — harmless no-op otherwise,
  // updateSeekingOrbs() retries every frame until an axis resolves.
  placeClustersAlongAxis(handle);

  return handle;
}

/**
 * (Re)positions every cluster's anchor/right-vector along the current travel axis. Safe to call
 * every frame — cheap, and self-guards against the axis not being ready yet by leaving meshes
 * hidden/where they were until it resolves. Individual orb WORLD positions (anchor + localOffset +
 * wander) are computed per-frame in updateSeekingOrbs(), since wander needs to animate continuously
 * — this function only refreshes the shared anchor/right-vector each cluster's orbs are built from.
 */
function placeClustersAlongAxis(handle) {
  const axis = resolveAxis(handle.travelAxisAccessor);
  if (!axis) return false;

  const up = new THREE.Vector3(0, 1, 0);

  for (const cluster of handle.clusters) {
    const point = axis.getPointAt(clamp01(cluster.t));
    const tangent = axis.getTangentAt(clamp01(cluster.t)).normalize();

    // Axis-normal: perpendicular to travel direction, alternating sides per cluster so repeated
    // encounters don't feel identically staged (mirrors glyphs.js's wall-alternation pattern).
    cluster.right.crossVectors(tangent, up).normalize();
    cluster.anchor.copy(point)
      .addScaledVector(cluster.right, cluster.side * AXIS_OFFSET)
      .add(new THREE.Vector3(0, CLUSTER_HEIGHT_OFFSET, 0));

    for (const orb of cluster.orbs) {
      orb.mesh.visible = true;
    }
    cluster.placed = true;
  }

  return true;
}

/**
 * One-shot "found, settled" trigger for a single cluster (mirrors glyphs.js's triggerResolve() —
 * same one-shot guard, same dwell-time-fitted duration so a fast scroller still gets a legible
 * settle, same final Act III overflow-light kick on the LAST cluster's resolve). Rather than a
 * text scramble resolving into "404", this plays as the cluster's wander amplitude/flicker easing
 * down to zero and its brightness/scale easing up to SEEKING_ORBS.settledBrightnessBoost/
 * settledScaleBoost over `fittedDuration` — the choreographed "arriving" moment.
 */
function triggerResolve(cluster, handle, state, remainingDwellSeconds) {
  if (cluster.resolved) return;
  cluster.resolved = true;

  const HOLD_MARGIN_SECONDS = 0.15;
  const LEISURELY_DURATION = 1.6;
  const fittedDuration = Math.max(
    0.35,
    Math.min(LEISURELY_DURATION, (remainingDwellSeconds ?? WORST_CASE_DWELL_SECONDS) - HOLD_MARGIN_SECONDS)
  );
  cluster.settleDuration = fittedDuration;
  cluster.settleElapsed = 0;
  cluster.settling = true;

  const allResolved = handle.clusters.every((c) => c.resolved);
  if (allResolved) {
    state.seekingOrbs.allResolved = true;
    igniteOverflow();
  }
}

/**
 * Each frame: keeps clusters positioned on the current travel axis (retrying placement until the
 * accessor resolves), measures camera distance to each cluster's anchor, drives proximity
 * brightening (via lighting.js's centralized setAccentBoost), advances the one-shot settle
 * choreography once triggered, and animates every orb's continuous wander/flicker (while still
 * searching) or settled glow (once resolved). Writes the nearest normalized proximity (0 near, 1
 * far) into state.seekingOrbs.nearestProximity for other modules — same role glyphs.js's
 * state.glyphs.nearestProximity played.
 */
export function updateSeekingOrbs(handle, state, camera, dt) {
  if (!handle || !handle.clusters.length) return;

  placeClustersAlongAxis(handle);
  if (!handle.clusters[0].placed) {
    state.seekingOrbs.nearestProximity = 1;
    return;
  }

  // Live travel speed (meters/sec along the axis) — reads the single-source-of-truth
  // state.vortex.travelSpeed (written every frame by vortex.js), same discipline glyphs.js's own
  // v2.3 fix established (a curved axis makes a raw camera.position.z delta an unreliable arc-
  // length proxy). Falls back to the worst-case (velocity-ceiling) speed before vortex.js has
  // written a first value.
  const travelSpeed = Math.max(0.01, Math.abs(state.vortex?.travelSpeed ?? MAX_TRAVEL_SPEED));

  const radius = SEEKING_ORBS.proximityResonanceRadius;
  let nearestNormalized = 1;

  const mixT = state.color && typeof state.color.mixT === 'number' ? state.color.mixT : 0;
  _orbColor.copy(_baseOrbColor).lerp(_overflowColor, mixT);

  for (const cluster of handle.clusters) {
    const distance = camera.position.distanceTo(cluster.anchor);
    const normalized = clamp01(distance / radius);

    if (normalized < nearestNormalized) {
      nearestNormalized = normalized;
    }

    if (distance <= radius) {
      const proximityStrength = 1 - normalized; // 0 far edge of radius .. 1 at the cluster
      const boost = proximityStrength * proximityStrength;

      setAccentBoost(cluster.id, boost);
      cluster.currentBoost = boost;

      for (const orb of cluster.orbs) {
        const targetBpm = state.pulse.bpm;
        orb.currentBpm += (targetBpm - orb.currentBpm) * Math.min(1, dt * proximityStrength * 2);
      }

      if (proximityStrength > 0.02) {
        const remainingDwellSeconds = distance / travelSpeed;
        triggerResolve(cluster, handle, state, remainingDwellSeconds);
      }
    } else if (cluster.currentBoost > 0) {
      cluster.currentBoost = Math.max(0, cluster.currentBoost - dt * 0.6);
      setAccentBoost(cluster.id, cluster.currentBoost);
      for (const orb of cluster.orbs) {
        orb.currentBpm += (PULSE.bpmStart - orb.currentBpm) * Math.min(1, dt * 0.3);
      }
    }

    // Advance the one-shot settle choreography (if triggered) — a normalized 0..1 "how settled"
    // value, eased, that drives wander/flicker amplitude down and brightness/scale up. Holds at 1
    // forever once the settle duration elapses (never re-triggers, never reverses — "found, once").
    let settleT = 0;
    if (cluster.settling) {
      cluster.settleElapsed += dt;
      settleT = clamp01(cluster.settleElapsed / Math.max(cluster.settleDuration, 0.001));
    } else if (cluster.resolved) {
      settleT = 1;
    }
    const settleEased = settleT * settleT * (3 - 2 * settleT); // smoothstep

    // Wander/flicker amplitude relaxes toward 0 as settleEased -> 1 — "trying to find themselves"
    // (restless while distant) easing into "found" (calm, steady) rather than an instant cut.
    const wanderAmplitude = SEEKING_ORBS.wanderRadius * (1 - settleEased);
    const flickerAmplitude = (1 - settleEased); // 1 = full irregular flicker, 0 = fully steady

    for (const orb of cluster.orbs) {
      // Continuous wander: each orb's own randomized frequency/phase, amplitude tied to
      // (1 - settleEased) above, so the wander itself is what visibly calms as the cluster settles
      // — not a separate, disconnected animation that just gets hidden.
      orb.wanderSeed += dt * orb.wanderHz;
      const wx = Math.sin(orb.wanderSeed * 1.3) * wanderAmplitude;
      const wy = Math.sin(orb.wanderSeed * 0.9 + 1.7) * wanderAmplitude * 0.6;
      const wz = Math.cos(orb.wanderSeed * 1.1 + 0.5) * wanderAmplitude;

      orb.mesh.position.copy(cluster.anchor)
        .add(orb.localOffset)
        .add(new THREE.Vector3(wx, wy, wz));

      // Irregular flicker while searching (fast, non-sinusoidal-reading via a sum of two
      // mismatched frequencies) eases into the calm, synced pulse-breathe every other orb in this
      // piece uses once settled — "uncertain" becoming "steady," not just "dim" becoming "bright."
      orb.flickerSeed += dt * orb.flickerHz;
      const flicker = 0.5 + 0.5 * Math.sin(orb.flickerSeed) * 0.6 + 0.5 * Math.sin(orb.flickerSeed * 2.7 + 2.1) * 0.4;
      const hz = orb.currentBpm / 60;
      orb.pulsePhase += dt * hz * Math.PI * 2;
      const settledBreathe = 0.5 + 0.5 * Math.sin(orb.pulsePhase);
      const brightnessMotion = THREE.MathUtils.lerp(flicker, settledBreathe, settleEased);

      const settledBoost = THREE.MathUtils.lerp(1, SEEKING_ORBS.settledBrightnessBoost, settleEased);
      const opacity = Math.min(1, (orb.baseOpacity + 0.2 * brightnessMotion + cluster.currentBoost * 0.15) * settledBoost);
      // v2.9: write opacity/color onto both sprites of this orb's glow-sprite pair (halo dimmer,
      // per HALO_OPACITY_SCALE, same "bright center + soft falloff" read the Guiding Orb's own
      // multi-layer stack and vortex.js's companion orbs both use) rather than a single
      // mesh.material — see glow-sprite.js's buildGlowOrb() for the core/halo pair this creates.
      orb.core.material.opacity = opacity;
      orb.core.material.color.copy(_orbColor);
      orb.halo.material.opacity = opacity * HALO_OPACITY_SCALE;
      orb.halo.material.color.copy(_orbColor);

      const scale = THREE.MathUtils.lerp(1, SEEKING_ORBS.settledScaleBoost, settleEased) * (1 + cluster.currentBoost * 0.2);
      orb.mesh.scale.setScalar(scale);
    }
  }

  state.seekingOrbs.nearestProximity = nearestNormalized;
}
