// src/scene/lighting.js
//
// Owns every light source in the scene: the ambient/hemisphere base-visibility light, the
// sparse bioluminescent wall-seam glow points (CONCEPT.md Section 4), and the single Act III
// "overflow" light the corridor's end pours toward the camera. Colors are driven entirely by
// `state.color.mixT` (interpolating COLOR.labyrinthBase/labyrinthAccent -> COLOR.overflowEnd)
// and intensity is pulsed by `state.pulse.bpm` converted to a sine-wave frequency in Hz.
//
// This is the ONLY module allowed to instantiate THREE lights. Other modules (glyphs.js,
// interaction.js) that want localized brightening call `setAccentBoost(id, amount)` instead of
// creating their own light — boosts are transient and always decay back to baseline, per the
// "resonance, not response" non-negotiable in CONCEPT.md Section 5.

import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { COLOR, PULSE, CORRIDOR, GLYPHS, BEATS, RIPPLE } from '../config.js';
import { getCorridorCurve } from './corridor.js';

// Internal module state — not exported, per the architecture's "no module holds a direct
// reference to another module's internals" rule. Other modules only ever touch this file
// through createLighting/updateLighting/setAccentBoost.
let ambientLight = null;
let hemiLight = null;
let accentLights = []; // sparse bioluminescent wall-seam glow points, spread along the corridor
let overflowLight = null; // Act III light source the corridor pours toward the camera
let particleField = null; // drifting bioluminescent dust-mote/firefly Points system (Act II only)

// Boost registry: id -> { amount, appliedAt }. Boosts decay linearly to 0 over BOOST_DECAY_SECONDS
// once set; callers (glyphs.js proximity, interaction.js ripple) can keep re-calling
// setAccentBoost() every frame while the effect is active, which simply refreshes the value —
// once they stop calling it, the boost decays back to baseline on its own.
const boosts = new Map();
const BOOST_DECAY_SECONDS = 1.5; // mirrors RIPPLE.fadeDurationSeconds-scale decay, kept local since
                                  // this file owns the light math, not the ripple/glyph logic itself

// One-shot "discovery" kick for the Act III overflow light — see igniteOverflow() below. Decays
// back to 0 like every other boost in this module (resonance, not response), it just targets the
// single overflowLight object instead of the boosts registry's per-id accent lights.
let overflowIgnite = 0;
const OVERFLOW_IGNITE_DECAY_SECONDS = 2.5;

const _colorA = new THREE.Color(); // labyrinthBase <-> overflowEnd working color
const _colorAccent = new THREE.Color(COLOR.labyrinthAccent);
const _colorOverflow = new THREE.Color(COLOR.overflowEnd);
const _colorVoid = new THREE.Color(COLOR.voidBase);
const _colorWhiteout = new THREE.Color(COLOR.whiteout);

const BASE_ACCENT_INTENSITY = 1.1;
const BASE_AMBIENT_INTENSITY = 0.12;
const BASE_HEMI_INTENSITY = 0.35;
const PULSE_DEPTH = 0.4; // how much the sine pulse swings intensity above/below base, as a fraction
const RIPPLE_BOOST_GAIN = 0.8; // scales state.ripple.strength (0-1) into an additive light boost

// ---------------------------------------------------------------------------------------------
// Drifting bioluminescent particulates (CONCEPT.md Section 4: "a scatter of slow-drifting
// particulate light (dust-mote / firefly quality) at low density" — a distinct visual element
// from the wall-seam glow above, called out in the same sentence but not the same thing, whose
// purpose is explicitly "emotional pacing markers, so 25 seconds of walking doesn't feel
// monotonous"). Realized as a single low-density THREE.Points cloud distributed along the
// corridor curve, each mote drifting on its own simplex-noise path (CONCEPT.md Section 6
// earmarks simplex-noise specifically for "the drifting bioluminescent particulates") rather than
// a mechanical sine loop — same "organic, not metronomic" rationale camera.js's micro-drift uses.
// Owned here (not corridor.js) because it's light, not geometry: unlit-but-additive motes that
// exist purely to read as glowing, matching this module's exclusive light-ownership role.
// ---------------------------------------------------------------------------------------------

const PARTICLE_COUNT = 90; // low density per CONCEPT.md, spread thin across the whole corridor
const PARTICLE_DRIFT_RADIUS = 1.1; // meters a mote wanders from its anchor point
const PARTICLE_DRIFT_FREQUENCY = 0.05; // slow, breath-like — mirrors camera.js's DRIFT_FREQUENCY
const PARTICLE_BASE_SIZE = 0.09;

// Continuously-integrated pulse phase (radians). Using an accumulator driven by the *current*
// effective Hz each frame — rather than `clockTime * hz` — means the idle-mirroring bpm slowdown
// (see updateLighting()) never causes a visible phase jump/stutter when it changes the
// instantaneous frequency; the wave stays smooth even as its speed changes.
let pulsePhaseAccum = 0;

/**
 * Builds the drifting bioluminescent particulate field: PARTICLE_COUNT motes scattered along the
 * corridor curve (anchored by arc-length position + a random lateral/vertical/depth-jitter offset
 * within the corridor's cross-section), each with its own simplex-noise generators so every mote
 * wanders independently rather than in lockstep. Returns a handle consumed by updateParticleField.
 */
function makeParticleField(scene) {
  const curve = getCorridorCurve();
  const geometry = new THREE.BufferGeometry();
  const anchors = new Float32Array(PARTICLE_COUNT * 3);
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const noiseGens = [];

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    // Spread evenly along the whole corridor (arc-length u), with a small random offset so motes
    // don't line up in a visible grid, then jitter within the corridor's cross-section (roughly
    // its 4m width / eye-level-relative height) so they read as floating in the aisle, not stuck
    // to the spline's centerline.
    const u = THREE.MathUtils.clamp((i + Math.random() * 0.6) / PARTICLE_COUNT, 0, 1);
    const point = curve.getPointAt(u);
    const tangent = curve.getTangentAt(u).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    const lateral = (Math.random() * 2 - 1) * 1.5; // within the ~4m aisle width
    const vertical = Math.random() * 2.2 - 0.4; // low density spans floor-to-head-height
    const anchor = point.clone().addScaledVector(side, lateral).add(new THREE.Vector3(0, vertical, 0));

    anchors[i * 3] = anchor.x;
    anchors[i * 3 + 1] = anchor.y;
    anchors[i * 3 + 2] = anchor.z;
    positions[i * 3] = anchor.x;
    positions[i * 3 + 1] = anchor.y;
    positions[i * 3 + 2] = anchor.z;

    noiseGens.push({
      x: createNoise2D(),
      y: createNoise2D(),
      z: createNoise2D(),
      phase: Math.random() * Math.PI * 2,
    });
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: new THREE.Color(COLOR.labyrinthAccent),
    size: PARTICLE_BASE_SIZE,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false, // stay crisp/bright like the glyphs, not washed out by ACES tone mapping
    fog: true,
  });

  const points = new THREE.Points(geometry, material);
  points.name = 'labyrinth-particulates';
  points.frustumCulled = false;
  scene.add(points);

  return { points, geometry, material, anchors, noiseGens };
}

/**
 * Advances each mote's simplex-noise drift and the field's overall opacity (gated to the
 * labyrinth beat, fading in/out at its edges so it never pops, and fading toward 0 as mixT
 * approaches the Act III pivot since the piece has moved past the "25s of walking" pacing
 * problem these motes exist to solve).
 */
function updateParticleField(handle, state) {
  const { geometry, anchors, noiseGens, material } = handle;
  const t = state.clockTime;
  const positionAttr = geometry.getAttribute('position');

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const gen = noiseGens[i];
    const n = t * PARTICLE_DRIFT_FREQUENCY + gen.phase;
    const dx = gen.x(n, 0) * PARTICLE_DRIFT_RADIUS;
    const dy = gen.y(n, 0) * PARTICLE_DRIFT_RADIUS * 0.6; // gentler vertical wander
    const dz = gen.z(n, 0) * PARTICLE_DRIFT_RADIUS;

    positionAttr.array[i * 3] = anchors[i * 3] + dx;
    positionAttr.array[i * 3 + 1] = anchors[i * 3 + 1] + dy;
    positionAttr.array[i * 3 + 2] = anchors[i * 3 + 2] + dz;
  }
  positionAttr.needsUpdate = true;

  // Fade the whole field in/out at Act II's edges (never pops on/off) and gently down as mixT
  // approaches the Act III pivot, since the piece has moved past the "25s of walking" pacing
  // problem these motes exist to solve. Individual per-mote brightness variation isn't needed
  // here — THREE.Points shares one material across all points, and the organic quality CONCEPT.md
  // asks for ("dust-mote / firefly quality") is carried by the per-particle simplex drift above,
  // not by a flicker layered on top of it.
  const mixT = state.color.mixT ?? 0;
  const inLabyrinth = state.beat === 'labyrinth';
  const FADE_SECONDS = 1.5;
  const fadeIn = THREE.MathUtils.clamp((t - BEATS.catch.end) / FADE_SECONDS, 0, 1);
  const fadeOutStart = BEATS.turn.start - FADE_SECONDS;
  const fadeOut = THREE.MathUtils.clamp((fadeOutStart - t) / FADE_SECONDS + 1, 0, 1);
  const beatGate = inLabyrinth ? Math.min(fadeIn, fadeOut) : 0;

  material.color.lerpColors(_colorAccent, _colorOverflow, mixT);
  material.opacity = beatGate * (1 - mixT * 0.5) * 0.85;
}

/**
 * Builds and adds every light this scene will ever use, then returns a handle object in case
 * the caller wants direct access for debugging. Safe to call once.
 */
export function createLighting(scene) {
  // Ambient: soft, near-zero fill so geometry never goes fully unreadable-black (CONCEPT.md
  // Act I: "total but not blind"). Color starts at the void base and is retargeted every frame
  // in updateLighting as mixT moves.
  ambientLight = new THREE.AmbientLight(_colorVoid.getHex(), BASE_AMBIENT_INTENSITY);
  scene.add(ambientLight);

  // Hemisphere light: cool sky (violet-blue) vs. a darker ground tone, giving the corridor
  // walls/floor gentle directional falloff without a harsh single directional light source.
  hemiLight = new THREE.HemisphereLight(
    COLOR.labyrinthBase,
    COLOR.voidBase,
    BASE_HEMI_INTENSITY
  );
  scene.add(hemiLight);

  // Sparse bioluminescent wall-seam accents. Spread along the corridor's modular segment run
  // so they read as scattered "breadcrumb" pacing markers per CONCEPT.md Section 4, not a
  // uniform strip. One accent light approximately every ~1.5 segment-lengths, alternating
  // left/right wall seams for visual variety.
  const accentCount = Math.max(4, CORRIDOR.segmentPoolSize);
  accentLights = [];
  for (let i = 0; i < accentCount; i++) {
    const light = new THREE.PointLight(COLOR.labyrinthAccent, BASE_ACCENT_INTENSITY, CORRIDOR.segmentLength * 2.2, 2);
    const side = i % 2 === 0 ? -1 : 1;
    const along = i * CORRIDOR.segmentLength * 1.5;
    light.position.set(side * 1.4, 1.2, -along);
    light.userData.basePosition = light.position.clone();
    light.userData.phase = Math.random() * Math.PI * 2; // desync each seam's pulse slightly
    light.userData.id = `seam-${i}`;
    scene.add(light);
    accentLights.push(light);
  }

  // Also register glyph-slot accent lights up front (glyphs.js calls setAccentBoost with
  // ids like `glyph-0`, `glyph-1`) so proximity resonance has something concrete to brighten
  // even before glyphs.js has positioned its meshes. These follow the same seam pool visually
  // but are addressable by a stable id independent of index into accentLights.
  for (let i = 0; i < GLYPHS.count; i++) {
    boosts.set(`glyph-${i}`, { amount: 0 });
  }
  boosts.set('ripple', { amount: 0 });

  // The Act III overflow light: a single distant point that grows into a warm volumetric-feeling
  // source as mixT -> 1. Positioned far down the corridor's forward axis; corridor.js/main.js may
  // reposition it later via state if needed, but a sane default keeps this module self-contained.
  overflowLight = new THREE.PointLight(COLOR.overflowEnd, 0, 200, 1.5);
  overflowLight.position.set(0, 1.6, -(CORRIDOR.segmentLength * CORRIDOR.segmentPoolSize * 1.5 + 20));
  scene.add(overflowLight);

  // Drifting bioluminescent particulates (CONCEPT.md Section 4) — see makeParticleField() header
  // comment. Built from the corridor's actual spline so motes are distributed along the real
  // path rather than a placeholder volume.
  particleField = makeParticleField(scene);

  return { ambientLight, hemiLight, accentLights, overflowLight, particleField };
}

/**
 * Advances all light color/intensity math for this frame. Must run every frame regardless of
 * beat. Accent (bioluminescent) intensity is explicitly gated to near-zero during Act I via an
 * `entryFade` ramp keyed to state.clockTime vs. BEATS.catch — CONCEPT.md Act I: "Almost no light
 * sources yet ... darkness should feel total but not blind" — so the fall genuinely reads as
 * near-dark rather than the corridor's Act II glow already being visible while still 40m above
 * the entrance. Ambient/hemisphere fill intensities are unaffected (they're what keeps geometry
 * from going unreadable-black, per the same Act I note) — only the amber accent seams ignite as
 * the corridor is actually entered.
 */
export function updateLighting(state, dt) {
  const mixT = state.color.mixT ?? 0;
  const scriptedBpm = state.pulse.bpm || PULSE.bpmStart;

  // Idle-mirroring (CONCEPT.md Section 5, "bonus layer": "if the user is idle ... for a few
  // seconds, the glow can slow further, as if the scene itself relaxes when the user does").
  // state.pointer.idleSeconds is tracked unconditionally by interaction.js; this is the reactive
  // consumer CONCEPT.md and interaction.js's own header comment both point to. Only ever slows
  // the pulse further (never speeds it up past the scripted baseline), and only takes effect once
  // idle exceeds RIPPLE.idleMirrorDelaySeconds, ramping in gradually rather than snapping so it
  // reads as the scene gently settling, not a mode switch.
  const idleSeconds = state.pointer?.idleSeconds ?? 0;
  const idleOverage = Math.max(0, idleSeconds - RIPPLE.idleMirrorDelaySeconds);
  const idleMirrorT = 1 - Math.exp(-idleOverage / 4); // smooth 0..1 ramp, ~63% in ~4s of overage
  const IDLE_BPM_FLOOR_RATIO = 0.65; // deepest the idle mirror is allowed to slow the pulse to
  const effectiveBpm = scriptedBpm * (1 - idleMirrorT * (1 - IDLE_BPM_FLOOR_RATIO));

  const pulseHz = effectiveBpm / 60;
  pulsePhaseAccum += dt * pulseHz * Math.PI * 2;
  const pulsePhaseBase = pulsePhaseAccum;

  // Accent lights ignite as the fall resolves into "the catch" (first proper wall-glow per the
  // beat sheet) rather than being lit at near-full intensity from t=0. A short overlap into
  // freefall lets the "first faint bioluminescent hint appears far below" beat-sheet cue read as
  // a genuine hint (near-zero, not near-full) rather than a floor.
  const entryFadeStart = BEATS.freefall.end; // "first faint hint" beat
  const entryFadeEnd = BEATS.catch.end; // "first proper wall-glow ignites" beat
  const entryFadeSpan = Math.max(0.0001, entryFadeEnd - entryFadeStart);
  const entryFade = THREE.MathUtils.clamp(
    (state.clockTime - entryFadeStart) / entryFadeSpan,
    0,
    1
  );
  // Smoothstep for a gentler ignition than a linear ramp.
  const accentEntryFactor = entryFade * entryFade * (3 - 2 * entryFade);

  // Decay stale boosts toward 0 so anything not being actively refreshed by glyphs.js/
  // interaction.js this frame fades back to baseline — resonance, not response.
  const decayFactor = Math.max(0, 1 - dt / BOOST_DECAY_SECONDS);
  for (const entry of boosts.values()) {
    entry.amount *= decayFactor;
    if (entry.amount < 0.0005) entry.amount = 0;
  }

  // Decay the one-shot overflow-ignite kick (see igniteOverflow()) the same way.
  const igniteDecayFactor = Math.max(0, 1 - dt / OVERFLOW_IGNITE_DECAY_SECONDS);
  overflowIgnite *= igniteDecayFactor;
  if (overflowIgnite < 0.0005) overflowIgnite = 0;

  // interaction.js owns state.ripple (x, y, strength) directly rather than calling
  // setAccentBoost itself — it only ever tracks input, per its own single-responsibility
  // contract. lighting.js reads that signal here and folds it into the 'ripple' boost slot,
  // keeping all light math centralized in this module as the architecture requires. Ripple
  // strength already decays to 0 in interaction.js (RIPPLE.fadeDurationSeconds), so this stays
  // a pure reflection of that value rather than an independent decay.
  if (state.ripple) {
    setAccentBoost('ripple', (state.ripple.strength || 0) * RIPPLE_BOOST_GAIN);
  }

  // Ambient + hemisphere: fade from the cool void/labyrinth tones into the warm overflow tone.
  // This is a smooth, continuous interpolation — the single hard palette pivot lives in mixT's
  // own easing curve (owned by director.js), not in how this module blends colors.
  _colorA.copy(_colorVoid).lerp(new THREE.Color(COLOR.labyrinthBase), Math.min(1, mixT * 4));
  ambientLight.color.lerpColors(_colorA, _colorOverflow, mixT);
  ambientLight.intensity = BASE_AMBIENT_INTENSITY + mixT * 0.5;

  hemiLight.color.lerpColors(new THREE.Color(COLOR.labyrinthBase), _colorOverflow, mixT);
  hemiLight.groundColor.lerpColors(_colorVoid, new THREE.Color(COLOR.overflowStart), mixT);
  hemiLight.intensity = BASE_HEMI_INTENSITY + mixT * 0.9;

  // Wall-seam accent lights: interpolate hue from the amber labyrinth accent to the overflow
  // gold/white, pulse intensity on a bpm-driven sine wave (each seam phase-offset so the wall
  // doesn't pulse in unison like a strobe), and layer in any active accent boost for that seam
  // plus a gentle shared wash from the ripple boost (interaction.js has no fixed world-space
  // anchor for lighting.js to target individually, so the ripple reads as an ambient shimmer
  // across the nearby seams rather than a single spotlight — still fully decays with it).
  const rippleBoost = boosts.get('ripple')?.amount || 0;
  const turnCueBoost = state.turnCue?.amount || 0;
  for (const light of accentLights) {
    light.color.lerpColors(_colorAccent, _colorOverflow, mixT);
    const pulse = 1 + PULSE_DEPTH * Math.sin(pulsePhaseBase + light.userData.phase);
    const boostEntry = boosts.get(light.userData.id);
    const boost = boostEntry ? boostEntry.amount : 0;
    light.intensity =
      BASE_ACCENT_INTENSITY *
        pulse *
        (1 + mixT * 0.6) *
        accentEntryFactor +
      boost + rippleBoost * 0.5 + turnCueBoost * 0.9;
  }

  // Glyph and ripple boosts don't necessarily own a dedicated THREE light object at fixed world
  // coordinates known to this module (glyphs.js positions its own meshes along the corridor
  // curve). We still centralize the *math* here per the architecture contract: expose the
  // resolved boost amounts back onto state so glyphs.js/interaction.js can read the authoritative
  // pulsed value when driving their own emissive materials, without instantiating a light.
  state.lighting = state.lighting || {};
  state.lighting.pulseHz = pulseHz;
  state.lighting.accentColorHex = `#${_colorAccent.clone().lerp(_colorOverflow, mixT).getHexString()}`;
  state.lighting.boosts = state.lighting.boosts || {};
  for (const [id, entry] of boosts.entries()) {
    state.lighting.boosts[id] = entry.amount;
  }

  // Act III overflow light: stays dark/off until color starts pivoting, then grows on an
  // accelerating curve as bloom intensity ramps (director.js drives state.bloom.intensity on
  // the same schedule) — "light overflowing" per CONCEPT.md Section 1/4. The overflowIgnite term
  // is the one-shot "discovery" kick fired by glyphs.js's igniteOverflow() when the last "404"
  // glyph resolves (CONCEPT.md Section 1: "Finding/passing a glowing '404' is what triggers the
  // overflow") — a real, perceptible response to that specific event, decaying back to baseline
  // like every other resonance effect, layered on top of (never replacing) the fixed-timeline
  // schedule that remains authoritative for when Act III actually happens.
  overflowLight.color.lerpColors(new THREE.Color(COLOR.overflowStart), _colorOverflow, mixT);
  const overflowT = Math.max(0, mixT);
  overflowLight.intensity =
    Math.pow(overflowT, 2) * 6 + (state.bloom?.godRays || 0) * 2 + overflowIgnite * 3;

  // Final whiteout push (CONCEPT.md Section 2/4: "final frame before the iris-transition: pure
  // warm whiteout, slightly overexposed"). mixT alone only ever reaches COLOR.overflowEnd (a
  // cream/gold, not a true whiteout) — during the `overflow` beat itself, blend the ambient/
  // hemisphere/overflow-light color the rest of the way to COLOR.whiteout as beatProgress
  // advances, so the literal overexposed-white frame CONCEPT.md calls for actually exists,
  // layered on top of (not replacing) the gradual violet->gold pivot mixT already drives.
  if (state.beat === 'overflow' || state.beat === 'iris') {
    const whiteoutT =
      state.beat === 'iris' ? 1 : THREE.MathUtils.clamp(state.beatProgress ?? 0, 0, 1);
    ambientLight.color.lerp(_colorWhiteout, whiteoutT);
    hemiLight.color.lerp(_colorWhiteout, whiteoutT);
    hemiLight.groundColor.lerp(_colorWhiteout, whiteoutT);
    overflowLight.color.lerp(_colorWhiteout, whiteoutT);
  }

  if (particleField) {
    updateParticleField(particleField, state);
  }
}

/**
 * Localized, transient brightening hook for other modules (glyphs.js proximity resonance,
 * interaction.js ripple trail). `id` should be a stable string the caller reuses each frame
 * while the effect is active (e.g. `glyph-0`, `glyph-1`, `ripple`); `amount` is an additive
 * intensity contribution, typically in the ~0-3 range. Call every frame while active — stop
 * calling (or call with 0) to let it decay back to baseline via updateLighting's own decay.
 */
export function setAccentBoost(id, amount) {
  const clamped = Math.max(0, amount);
  const existing = boosts.get(id);
  if (existing) {
    // Never let an explicit boost jump backward-decay in the same frame it was set — take the
    // caller's value directly; updateLighting handles decay on subsequent frames where no call
    // (or a lower call) refreshes it.
    existing.amount = clamped;
  } else {
    boosts.set(id, { amount: clamped });
  }
}

/**
 * One-shot "discovery" kick for the Act III overflow light, fired by glyphs.js when the final
 * "404" glyph resolves out of its scramble (CONCEPT.md Section 1: "Finding/passing a glowing
 * '404' is what triggers the overflow"). Sets the internal ignite value to full strength;
 * updateLighting() decays it back to 0 over OVERFLOW_IGNITE_DECAY_SECONDS every frame after,
 * same "resonance, not response" shape as setAccentBoost(). Safe to call multiple times — later
 * calls simply refresh the peak, they never accumulate past 1.
 */
export function igniteOverflow() {
  overflowIgnite = 1;
}
