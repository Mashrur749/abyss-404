// src/scene/guide.js (v2.4 ADAPT — light-based radial-falloff rendering, re-verified against the
// curved travel path; v2.2's "orb DRIVES the axial position, camera chases IT" structure is
// UNCHANGED, v2.3's bob/weave/pulse-glow motion logic is UNCHANGED. v2.5 REVERTS the v2.4
// ignition-from-the-dying-screen mechanic — see the v2.5 REVERT note below.)
//
// Owns: the Guiding Orb, present in the scene from the very first frame (t=0) through the end of
// the traverse. v2.1 had this module position the orb as a soft-target lead distance ahead of
// wherever the camera already was — playtest feedback ("the orb isn't in a position where it's
// guiding the user") identified this as the root cause: the orb was a passenger, not a driver.
// v2.2 inverted the relationship (ARCHITECTURE.md's dedicated section): this module computes the
// orb's own axial position directly from the fall-in clock / the traverse progress, and
// vortex.js's getCameraRigPosition derives the camera's position FROM the orb's resolved
// state.guide.position/tangent (chase-cam: behind + above, looking at/past it), not the reverse.
//
// v2.4 CHANGES (CONCEPT.md's "REVISION (v2.4)" items 2/5, ARCHITECTURE.md's guide.js section):
// 1. RENDERING: replaced the single sphere-with-emissive-MeshBasicMaterial look with genuine
//    concentric radial light-falloff per config.js's GUIDE_LIGHT_FALLOFF (the user's own verbatim
//    design spec, kept as the reference — see that constant's comment in config.js). Realized as
//    a small stack of alpha-blended, camera-facing THREE.Sprite layers (core + N rings + a large
//    soft outer halo) sharing one radially-gradiented CanvasTexture, per ARCHITECTURE.md's
//    "cheapest, most robust in this all-unlit-material codebase" recommendation — THREE.Sprite is
//    always camera-facing by construction, so this needs no explicit billboard math of its own.
//    This is a RENDERING CHANGE ONLY — every existing bob/weave/pulse-glow/damping/dissolve
//    motion computation below is unchanged; it now drives a `group.position` and a
//    `setGlowAppearance()` helper across the sprite stack instead of a single mesh's
//    position/material directly.
//
// v2.5 REVERT: the v2.4 "ignition-from-the-dying-screen" mechanic (ignitePoint(), the igniteT/
// rawT blend, IGNITE_MIN_SCALE/IGNITE_MIN_OPACITY_MULT, and the ROOM_SCENE/getRoomScreenPosition
// imports) has been removed — see CONCEPT.md's "REVISION (v2.5)" and ARCHITECTURE.md's guide.js
// section. The room/TV cold-open no longer exists at the start of `drop`, so there is nothing left
// for the orb to ignite FROM. The orb is back to simply being fully present, at its own resting
// scale/opacity/color (GUIDE.color, scale 1, full opacity), from the very first frame — its
// v2.1-era original character. This is a narrow, surgical removal of one mechanic only — the
// GUIDE_LIGHT_FALLOFF sprite-stack rendering (still v2.4) and every other motion/dissolve system
// below are unchanged.
//
// LIGHTING LESSON (ARCHITECTURE.md, carried over from vortex.js/lighting.js): this module creates
// ZERO THREE.Light objects. The orb's glow is entirely its own unlit/emissive sprite-texture
// stack — never a PointLight illuminating itself or anything around it. lighting.js remains the
// sole owner of actual scene lights (ambient/hemisphere fill, the Act III overflowLight).
//
// CIRCULAR-IMPORT AVOIDANCE (ARCHITECTURE.md, mirrors seeking-orbs.js's existing pattern exactly):
// this module never imports vortex.js's orb/camera-coupled exports. createGuide()/updateGuide()
// still accept a `travelAxisAccessor` function parameter (main.js passes vortex.js's exported
// getVortexAxis by reference) for the TRAVERSE phase's axis lookups, re-invoked on demand rather
// than captured once — tolerating vortex.js not being ready yet at construction time, and any
// future axis rebuild (e.g. on resize). The FALL-IN phase imports vortex.js's
// getFallInAxialPosition/getFallInAxialTangent directly — a one-way, side-effect-free dependency,
// not the circular one this section warns about (the circularity to avoid is specifically
// vortex.js needing the orb's *resolved* per-frame position, solved by main.js passing it into
// getCameraRigPosition as a parameter, not by this module importing vortex.js at all).
//
// FROZEN-CLOCK BUG CLASS (ARCHITECTURE.md's "do not touch" section — the exact bug already found
// once in camera.js): the orb's independent bob/weave/glow must sample state.traverse.elapsedSeconds
// during `traverse` and state.clockTime during fall-in, never the other way around —
// state.clockTime is frozen for the entire traverse phase (main.js's tick loop), so sampling it
// there would silently freeze that motion/glow for the act's full duration. state.pulse.bpm itself
// is not a clock (lighting.js already derives it off elapsedSeconds, never a frozen one), so the
// glow term only needs a correctly-phased LOCAL accumulator — see PULSE_GLOW_* below.
//
// MODULE-BOUNDARY CONTRACT (ARCHITECTURE.md's bug-class warning — state.guide.position/tangent is
// a shared field): this module is the sole WRITER of state.guide.position/state.guide.tangent,
// every frame, for every beat (including the return phase, where it holds the last resolved
// position rather than going stale/null, in case any reader still checks it after dissolve).
// vortex.js/camera.js/main.js are READERS ONLY of these two fields — they must never write them.
//
// CHASE-CAM FOLLOW-DAMPING (ARCHITECTURE.md's guide.js section, CAMERA.chase.followDampingSeconds):
// deliberately NOT implemented in this module — confirmed by checking where chaseCamFromOrb-
// equivalent logic actually lives (per ARCHITECTURE.md's own instruction to check before assuming)
// before writing anything here. It is already implemented in vortex.js's chaseCamFromOrb, layered
// ON TOP OF that same function's existing distanceBehind/heightAbove/lookAheadBeyond offset math
// (an exponential smoothing step, time-constant CAMERA.chase.followDampingSeconds, applied to the
// raw chase-cam target before returning it to main.js) — see that function's own header comment
// for the full implementation and its traced composition with main.js's pre-existing
// traverse->turn crossfade (turnTransitionBlend). This module (guide.js) is the wrong owner for
// that logic even though ARCHITECTURE.md's guide.js section discusses it: guide.js only resolves
// the ORB's own position/tangent (state.guide.position/tangent) — it has no camera object to
// smooth, and vortex.js's chaseCamFromOrb is precisely "whichever module actually applies the
// [chase-cam] transform" ARCHITECTURE.md instructs the damping to live in. Adding a second,
// independent exponential-smoothing step HERE (on this module's own state.guide.position/tangent
// output) would smooth the ORB's apparent motion a second time — not the camera's — which would
// (a) fight this module's own existing POSITION_DAMPING/tangent-damping (already-smoothed values
// re-smoothed again) and (b) do nothing to address "the camera copies the orb 1:1," since the
// rigidity that feedback describes is specifically in the CAMERA's own read-and-apply step
// (main.js's `camera.position.copy(rig.position)`), not in how the orb itself moves. Keeping
// state.guide.position/tangent's existing meaning ("the orb's own resolved position/tangent,
// un-smoothed by any camera-following concern") intact also matters for this field's other reader
// (overlay-text.js), per this file's own module-boundary contract above.

import * as THREE from 'three';
import { GUIDE, GUIDE_LIGHT_FALLOFF, BEATS, COLOR, PULSE } from '../config.js';
import { getFallInAxialPosition, getFallInAxialTangent } from './vortex.js';

const FORWARD = new THREE.Vector3(0, 0, -1); // matches vortex.js's fixed travel direction

// Reused scratch objects — avoid per-frame allocation in the hot update path.
const _axisPoint = new THREE.Vector3();
const _axisTangent = new THREE.Vector3();
const _fallStart = new THREE.Vector3();
const _dissolveColor = new THREE.Color();
const _overflowStart = new THREE.Color(COLOR.overflowStart);
const _overflowEnd = new THREE.Color(COLOR.overflowEnd);
const _guideColor = new THREE.Color(GUIDE.color);
const _frameColor = new THREE.Color();
const _weaveRight = new THREE.Vector3();
const _weaveOffset = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

// How quickly the orb's realized position eases toward its freshly-computed axial target — a
// spring-like damping constant (Hz-ish), not an instantaneous snap. The orb IS the thing driving
// position now (v2.2), but a small amount of damping keeps its own motion reading as a living body
// with a touch of inertia rather than teleporting exactly onto the raw axial math every frame —
// fast enough that it never visibly lags behind where the math says it should be.
const POSITION_DAMPING = 6;

// Independent vertical-bob rate (Hz) — deliberately not tied to the pulse/bpm system, so the orb's
// motion reads as its own creature rather than synced to the field's breathing (CONCEPT.md v2.1
// Section 1: "gentle bob rather than a rigid locked-on-axis hover").
// v2.2: slowed further (was 0.18Hz) alongside config.js's reduced GUIDE.bobAmplitude (0.3 -> 0.12)
// — direct fix for "I can see the orb going up and down" (an obvious mechanical animation).
// Together, small amplitude + slow frequency reads as barely-perceptible living quality.
const BOB_FREQUENCY_HZ = 0.07;

// Brightness ceiling headroom over the vortex streak field's own realistic peak (CONCEPT.md v2.1
// Section 4: the orb is "deliberately the brightest, warmest thing in frame from the very first
// moment" — an ONGOING quality through the act it leads, not just true at t=0). vortex.js's
// per-streak brightness formula (pulse * jitter * turnCue * regional-brightness-boost, occasional
// amber-accent streaks, plus the v2.1 regional warmth lerp) can stack to roughly 1.3x the orb's own
// flat, un-boosted color at its worst case — enough to occasionally out-shine/out-bloom a
// perfectly flat GUIDE.color. A small, constant multiplier (not a pulse, not tied to proximity or
// any other reactive signal — this must never read as a piercing beacon per Section 1's "warm-but-
// soft color rather than a piercing beacon" character constraint) keeps the orb's realized
// brightness above that ceiling at all times, while GUIDE.color itself stays the authored, softer
// hue — this only affects luminance, never the hue balance that makes it read as "a presence."
// v2.3 FIX (light-artist review): the "~1.3x" streak-stacking estimate above was stale — vortex.js's
// per-streak brightness formula has grown several more multiplicative terms since (turnCue,
// catchLight, regional warmth, livingCycle, speedBrightness, clickBurst) and its realistic stacked
// worst case is well over 10x, versus this orb's own realized ceiling of
// GUIDE_BRIGHTNESS * pulseGlow-peak ≈ 1.35 * 1.22 ≈ 1.647 (exported as config.js's
// GUIDE.brightnessCeiling). Rather than keep chasing that estimate here, vortex.js now clamps its
// own stacked streak brightness directly against GUIDE.brightnessCeiling (via
// STREAK_BRIGHTNESS_CEILING, also in config.js) — the two files stay in sync against one shared,
// live constant instead of this comment's own periodically-stale guess.
const GUIDE_BRIGHTNESS = 1.35;

// --- v2.3: the pulsing GLOW (playtest: "the orb needs to glow, animated, living") -------------
// Brightness oscillation independent of the position bob, tied to state.pulse.bpm — the same
// rhythm PULSE/lighting.js/vortex.js already use for the field's own breathing (CONCEPT.md v2
// Section 4: "the streak field's overall brightness/pulse should have a slow, irregular rhythm...
// like breathing"). The orb entraining to that SAME rhythm (rather than inventing its own,
// unrelated pulse rate) is what makes it read as part of the same living field rather than a
// separate lit prop — mirrors the exact bpm->Hz->phase-accumulator shape vortex.js's own
// per-streak pulsePhase already uses, kept as this module's own local accumulator (not a shared
// state.lighting.pulsePhase read) so the orb can carry its own desynced phase offset, same
// rationale as vortex.js's per-streak `pulsePhase = Math.random() * Math.PI * 2` seeding.
const PULSE_GLOW_DEPTH = 0.22; // fraction of brightness the glow oscillates by (+/-22%) — a clear,
                                // legible "breathing" quality without turning into a strobe or
                                // reading as a piercing beacon (Section 1's character constraint)
const PULSE_GLOW_MIN = 1 - PULSE_GLOW_DEPTH;
const PULSE_GLOW_RANGE = PULSE_GLOW_DEPTH * 2;

// --- v2.3: lateral weave/drift (playtest: "follow some more movement") -------------------------
// A small amount of the orb's OWN side-to-side + vertical character, layered on top of whatever
// the curved travel path (config.js's PATH, sampled via the travel-axis accessor below) already
// supplies "for free" as its axial target swings through the authored waypoints. Two
// incommensurate (non-integer-ratio) sine rates summed together, exactly like vortex.js's own
// livingCycleMultiplier technique, so the weave doesn't read as a single obviously-looping
// oscillation over a long traverse. Kept small — this is texture on top of the path's own shape,
// never competing with it or reading as erratic.
const WEAVE_LATERAL_AMPLITUDE = 0.35; // meters, side-to-side (local "right" = tangent x world-up)
const WEAVE_VERTICAL_AMPLITUDE = 0.16; // meters, a smaller secondary vertical wobble, separate from
                                        // (additive to) the existing BOB_FREQUENCY_HZ bob
const WEAVE_PRIMARY_HZ = 0.045;
const WEAVE_SECONDARY_HZ = 0.045 * 1.6180339887; // golden-ratio-scaled, shares no small-integer
                                                   // relationship with the primary rate
const WEAVE_VERTICAL_HZ = 0.031;

// How long, in beat-progress terms, the dissolve ramp takes — the whole 'turn' beat's duration,
// per GUIDE.dissolveStartBeat.
function dissolveDurationSeconds() {
  return BEATS[GUIDE.dissolveStartBeat]?.duration ?? 3;
}

// ---------------------------------------------------------------------------------------------
// v2.4: genuine concentric radial light-falloff, per config.js's GUIDE_LIGHT_FALLOFF (the user's
// own verbatim design spec — see that constant's own comment). Replaces the previous single
// sphere-with-emissive-MeshBasicMaterial look. Realized as a small stack of alpha-blended,
// always-camera-facing THREE.Sprite layers (core + ringCount rings + one large soft outer halo),
// all sharing ONE shared radially-gradiented CanvasTexture (a single soft white-to-transparent
// disc) so no layer boundary/hard edge is ever introduced by the texture itself — only each
// layer's own authored SCALE and OPACITY differ, which is exactly what "concentric rings of glow
// that fade outward... built from radial gradients with multiple stops" describes when stacked.
// Built once at module scope (not per-orb) since every guide orb instance (there's only ever one)
// can safely share the same texture.
// ---------------------------------------------------------------------------------------------

let _sharedGlowTexture = null;

/**
 * Builds a single soft radial-gradient CanvasTexture: fully opaque white at the center, easing
 * out to fully transparent at the edge, via multiple gradient stops so the falloff itself reads
 * as smooth/analytic rather than a visible banded ring — this is the ONE texture every sprite
 * layer below reuses (scaled/tinted/opacity-multiplied differently per layer), so there is
 * exactly one place a hard edge could ever be introduced, and it is deliberately soft.
 */
function buildGlowTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2;

  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  // Multiple stops, easing the alpha down smoothly (not linearly) — a linear alpha ramp on a
  // radial gradient still reads as a faint visible edge near the outer stop; these intermediate
  // stops (0.35/0.6/0.8) round that off into a genuinely analytic-feeling falloff, per the
  // "no visible ring edges/banding, no hard silhouette" bar in config.js's own comment.
  gradient.addColorStop(0.0, 'rgba(255,255,255,1.0)');
  gradient.addColorStop(0.2, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.22)');
  gradient.addColorStop(0.8, 'rgba(255,255,255,0.06)');
  gradient.addColorStop(1.0, 'rgba(255,255,255,0.0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function getSharedGlowTexture() {
  if (!_sharedGlowTexture) _sharedGlowTexture = buildGlowTexture();
  return _sharedGlowTexture;
}

/**
 * Builds the layer stack: one core sprite, GUIDE_LIGHT_FALLOFF.ringCount ring sprites at
 * increasing radius/decreasing opacity, and one large soft outer-glow sprite — per-layer world
 * diameter and BASE (un-multiplied) opacity are precomputed once here and stored alongside each
 * sprite so updateGuide()'s per-frame authoring (brightness/pulse/dissolve) only ever needs to
 * scale/tint those authored base values, never re-derive the falloff shape itself.
 */
function buildGlowLayers() {
  const texture = getSharedGlowTexture();
  const layers = [];

  const material = () =>
    new THREE.SpriteMaterial({
      map: texture,
      color: 0xffffff, // tinted per-frame via sprite.material.color, same as the old mesh approach
      transparent: true,
      opacity: 1,
      depthWrite: false, // soft alpha-blended glow layers must never occlude each other/streaks
                          // via the depth buffer, or the stack would show hard inter-layer seams
      toneMapped: false, // stays a crisp, bright presence rather than washed out by ACES tone mapping
      fog: false,
      blending: THREE.AdditiveBlending, // layers accumulate light rather than alpha-composite over
                                          // each other, so overlapping rings read as brighter core
                                          // falloff, not a stack of visibly separate discs
    });

  // Core: the "solid-feeling" bright center. GUIDE.radius is the CORE radius per config.js's own
  // comment on GUIDE.radius; coreRadiusScale further scales it per GUIDE_LIGHT_FALLOFF's own
  // fraction-of-GUIDE.radius convention.
  const coreDiameter = 2 * GUIDE.radius * GUIDE_LIGHT_FALLOFF.coreRadiusScale;
  const core = new THREE.Sprite(material());
  core.scale.set(coreDiameter, coreDiameter, 1);
  layers.push({ sprite: core, baseOpacity: GUIDE_LIGHT_FALLOFF.coreOpacity, kind: 'core' });

  // Rings: ringCount concentric layers between the core and the outer glow, each successive one
  // larger and dimmer (ringOpacityFalloff fraction of the previous ring's own opacity) — radii
  // interpolated evenly between the core's own edge and the outer glow's inner reach so the whole
  // stack reads as one continuous gradient rather than a gap-then-halo.
  const ringCount = Math.max(0, GUIDE_LIGHT_FALLOFF.ringCount | 0);
  const outerDiameter = 2 * GUIDE.radius * GUIDE_LIGHT_FALLOFF.outerGlowRadiusScale;
  let ringOpacity = GUIDE_LIGHT_FALLOFF.coreOpacity;
  for (let i = 0; i < ringCount; i++) {
    ringOpacity *= GUIDE_LIGHT_FALLOFF.ringOpacityFalloff;
    const t = (i + 1) / (ringCount + 1); // spaced strictly between core and outer-glow diameters
    const diameter = THREE.MathUtils.lerp(coreDiameter, outerDiameter, t);
    const ring = new THREE.Sprite(material());
    ring.scale.set(diameter, diameter, 1);
    layers.push({ sprite: ring, baseOpacity: ringOpacity, kind: 'ring' });
  }

  // Outer glow: the large, soft halo that dissolves into the background via opacity alone — the
  // single biggest, dimmest layer, per config.js's own outerGlowOpacity/outerGlowRadiusScale.
  const outer = new THREE.Sprite(material());
  outer.scale.set(outerDiameter, outerDiameter, 1);
  layers.push({ sprite: outer, baseOpacity: GUIDE_LIGHT_FALLOFF.outerGlowOpacity, kind: 'outer' });

  return layers;
}

/**
 * Authors every sprite layer's color/opacity for this frame from a single shared
 * (color, brightnessMultiplier, opacityMultiplier) triple — the same three inputs the old
 * single-mesh version used to set directly on `mesh.material.color`/`mesh.material.opacity`.
 * `opacityMultiplier` scales each layer's own authored baseOpacity (preserving the relative
 * core->ring->outer falloff shape at every brightness/dissolve state); `brightnessColor`
 * (already color.multiplyScalar'd by the caller, exactly as the old mesh code did) is applied
 * identically to every layer so the whole stack reads as one coherent light rather than
 * independently-lit discs.
 */
function setGlowAppearance(handle, brightnessColor, opacityMultiplier) {
  for (const layer of handle.glowLayers) {
    layer.sprite.material.color.copy(brightnessColor);
    layer.sprite.material.opacity = THREE.MathUtils.clamp(layer.baseOpacity * opacityMultiplier, 0, 1);
  }
}

/**
 * createGuide(scene, travelAxisAccessor)
 *
 * Builds the orb's light-falloff sprite stack (v2.4 — see this file's header comment) and adds it
 * to the scene immediately — present from the very first frame, per the non-negotiable that the
 * orb "ignites alongside the camera in the very first frame." `travelAxisAccessor` mirrors
 * seeking-orbs.js's contract exactly: a zero-arg function returning a THREE.Curve-like object exposing
 * `getPointAt(t)`/`getTangentAt(t)` over vortex.js's traverse-span [0,1] parametrization — called
 * on demand, never captured once, so this module tolerates vortex.js not being ready yet.
 */
export function createGuide(scene, travelAxisAccessor) {
  const group = new THREE.Group();
  group.name = 'guiding-orb';
  group.frustumCulled = false;

  const glowLayers = buildGlowLayers();
  for (const layer of glowLayers) {
    layer.sprite.frustumCulled = false;
    group.add(layer.sprite);
  }

  // Seed at the fall's own t=0 axial position (see getFallInAxialPosition, imported from
  // vortex.js) so it isn't at the scene origin for a stray frame before the first updateGuide()
  // call resolves the real fall-in math — v2.2: the orb owns this position outright now, it is no
  // longer derived from wherever the camera happens to be.
  getFallInAxialPosition(0, _fallStart);
  group.position.copy(_fallStart);
  scene.add(group);

  return {
    group,
    glowLayers,
    travelAxisAccessor,
    bobPhase: Math.random() * Math.PI * 2, // desynced start phase, same rationale as vortex.js's streaks
    // v2.3: the pulsing glow's own local phase accumulator (see PULSE_GLOW_* above) — advanced
    // every frame by dt * (state.pulse.bpm/60) * 2*PI, mirroring vortex.js's per-streak
    // pulsePhase accumulation exactly, just owned here instead so the orb can carry its own
    // desynced offset rather than reading a shared state.lighting.pulsePhase.
    pulseGlowPhase: Math.random() * Math.PI * 2,
    dissolveElapsed: 0,
    dissolved: false,
    // Last resolved tangent, held across the dissolve/return phase so state.guide.tangent never
    // goes stale/null for any reader that checks it after the orb has dissolved. Seeded with the
    // fall's own real starting tangent (not FORWARD) so a stray frame before the first
    // updateGuide() call resolves the real fall-in tangent still gets a correct chase-cam offset.
    lastTangent: getFallInAxialTangent(0, new THREE.Vector3()),
    // v2.2 retune: whether lastTangent has been through at least one real (non-seed) resolution
    // yet — see updateGuide's tangent-damping block. False until the first frame that actually
    // resolves an axialTangent, so that first resolution snaps directly rather than easing in
    // from this constructor-time seed (which is itself the fall's real constant tangent, so in
    // practice this is a no-op distinction during `drop`, but keeps the intent explicit for any
    // future caller that changes the seed value).
    tangentInitialized: false,
  };
}

/**
 * Resolves the travel-axis curve, tolerating the accessor not being ready yet — mirrors seeking-orbs.js's
 * resolveAxis() exactly (same contract, same defensive shape).
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
 * updateGuide(handle, state, dt)
 *
 * v2.2: the orb OWNS its own axial position now — it is no longer derived from wherever the
 * camera happens to be (that relationship is inverted this round; see this file's header comment
 * and ARCHITECTURE.md). Every frame: resolves the orb's raw axial position/tangent directly from
 * the fall-in clock (drop/freefall/catch) or state.traverse.progress (traverse) via the injected
 * travel-axis accessor, eases the realized group position toward that target (a small amount of
 * damping so it reads as a living body, not a teleporting marker), layers a gentle independent
 * vertical bob on top, writes BOTH state.guide.position and state.guide.tangent every frame (the
 * two fields vortex.js's camera-follow chase-cam math needs), and — starting at state.beat ===
 * GUIDE.dissolveStartBeat ('turn') — ramps the orb out while blending its color toward the Act III
 * overflow light's own color, so it reads as merging into the growing light rather than just
 * vanishing. Non-negotiable #8: the orb must be fully invisible for the remainder of the return
 * phase (approach/overflow/iris).
 *
 * v2.5: the orb renders at its full resting scale/opacity/color (GUIDE.color, scale 1, full
 * opacity) from the very first frame of `drop` — the v2.4 ignition-from-the-screen blend that used
 * to gate this has been removed (see this file's header comment); there is no more room/TV cold-
 * open for the orb to ignite from.
 *
 * Note this module no longer takes a `camera` parameter — it has nothing to read from the camera
 * anymore (v2.1's version read camera.position to compute its own lead-target; v2.2's orb drives
 * position independently of wherever the camera is). Kept as a 3-arg call
 * (handle, state, dt) rather than accepting-and-ignoring a camera argument, so a stale caller
 * passing the old 4-arg shape is a loud, obvious break (wrong dt math) rather than a silent no-op.
 */
export function updateGuide(handle, state, dt) {
  if (!handle) return;
  const { group } = handle;
  const beat = state.beat;
  const frameDt = dt || 0.016;

  // --- Terminal state: once fully dissolved, stay invisible for the rest of the return phase ---
  // (approach/overflow/iris) — non-negotiable #8, the orb never reappears or lingers past its
  // handoff to the overflow light. state.guide.position/tangent are left holding their last
  // resolved values (never nulled out here) so any reader that still checks them post-dissolve
  // (e.g. vortex.js's own return-phase branch, which per ARCHITECTURE.md positions the camera
  // against the axis directly once there's no orb to follow) sees a stable, non-null value rather
  // than a field that suddenly reverts to null mid-experience.
  if (handle.dissolved) {
    group.visible = false;
    return;
  }

  // --- v2.3: advance the pulsing glow's own local phase accumulator ----------------------------
  // state.pulse.bpm is always a live, non-frozen value regardless of beat (lighting.js holds it at
  // PULSE.bpmStart through fall-in and decelerates it across the traverse off elapsedSeconds, per
  // its own header comment — never a frozen clock itself), so this can simply accumulate every
  // frame off dt without needing a beat-specific clock-selection branch the way the bob/weave above
  // do. Mirrors vortex.js's own per-streak `pulsePhase += dt * pulseHz * Math.PI * 2` shape exactly.
  const glowBpm = state.pulse?.bpm || PULSE.bpmStart;
  const glowHz = glowBpm / 60;
  handle.pulseGlowPhase += frameDt * glowHz * Math.PI * 2;
  const pulseGlow = PULSE_GLOW_MIN + PULSE_GLOW_RANGE * (0.5 + 0.5 * Math.sin(handle.pulseGlowPhase));

  // --- Resolve the orb's raw axial position/tangent for THIS beat -----------------------------
  // drop/freefall/catch: vortex.js's getFallInAxialPosition/getFallInAxialTangent (imported above
  // — v2.3 fix, see this module's header comment point 3) — driven by state.clockTime, still
  // advancing during fall-in, and now genuinely curve-derived rather than a second straight-line
  // copy of this same math.
  // traverse: axisPositionAt(state.traverse.progress) via the injected travel-axis accessor,
  // exactly per ARCHITECTURE.md's contract ("position = axisPositionAt(state.traverse.progress)
  // from the travel-axis accessor").
  // 'turn' (the one beat this module still runs during, for the dissolve ramp below): the orb
  // holds its last traverse-end position/tangent rather than trying to resolve a fresh one, since
  // the traverse's own [0,1] axis accessor has nothing meaningful to say once progress has already
  // reached 1 and the return phase's own (orb-independent) camera math has taken over.
  let axialPosition = null;
  let axialTangent = null;

  if (beat === 'drop' || beat === 'freefall' || beat === 'catch') {
    axialPosition = getFallInAxialPosition(state.clockTime ?? 0, _axisPoint);
    // Real fall tangent (see getFallInAxialTangent's own header comment in vortex.js) — was
    // hardcoded to FORWARD in an earlier round, which fed vortex.js's chase-cam a ~98.5%-wrong
    // direction for the whole fall (the fall's actual path is dominated by -Y, not -Z). Fixed per
    // the cinematographer's review, and now sourced from the same curve-aware function the
    // position above uses rather than a second local copy.
    axialTangent = getFallInAxialTangent(state.clockTime ?? 0, _axisTangent);
  } else if (beat === 'traverse') {
    const axis = resolveAxis(handle.travelAxisAccessor);
    if (axis) {
      const progress = THREE.MathUtils.clamp(state.traverse?.progress ?? 0, 0, 1);
      axialPosition = axis.getPointAt(progress, _axisPoint);
      axialTangent = axis.getTangentAt(progress, _axisTangent).normalize();
    }
  }

  if (axialPosition) {
    const positionLerp = 1 - Math.exp(-POSITION_DAMPING * frameDt);
    group.position.lerp(axialPosition, positionLerp);

    // Cinematographer review (v2.2 retune): the orb's POSITION is damped above (so it never
    // teleports across a beat boundary), but the TANGENT handed off to vortex.js's chase-cam was
    // being copied raw/undamped every frame — and the tangent can shift abruptly at the exact
    // catch->traverse instant, from the fall's real descent direction (getFallInAxialTangent,
    // near-constant throughout the fall) to the traverse's own curve-derived tangent
    // (axis.getTangentAt, v2.3: genuinely varies along the curve now, not a fixed (0,0,-1)).
    // Since chaseCamFromOrb derives the camera's POSITION as
    // `orbPos - distanceBehind*tangent + heightAbove*UP` using this tangent raw, an undamped
    // tangent flip pops the camera's position several meters in a single frame even though the
    // orb it's supposedly following barely moved — a following camera shouldn't teleport when
    // its subject's position didn't. Fix: damp the tangent with the same time-constant as
    // position (lerp + renormalize, since a lerp between two unit vectors isn't itself unit
    // length), so the chase-cam offset direction eases across the boundary exactly as smoothly as
    // the orb's own position already does. Skipped on the very first resolved frame (lastTangent
    // still at its construction-time seed) so the orb's initial facing snaps directly to the real
    // fall tangent rather than easing in from an arbitrary seed value.
    if (handle.tangentInitialized) {
      handle.lastTangent.lerp(axialTangent ?? FORWARD, positionLerp);
      if (handle.lastTangent.lengthSq() > 1e-8) handle.lastTangent.normalize();
      else handle.lastTangent.copy(axialTangent ?? FORWARD);
    } else {
      handle.lastTangent.copy(axialTangent ?? FORWARD);
      handle.tangentInitialized = true;
    }
  }
  // If axialPosition never resolved this frame (e.g. 'turn' beat, or the accessor briefly not
  // ready yet), group.position/handle.lastTangent simply hold their last resolved values — a safe
  // no-op, matching seeking-orbs.js's "null axis is a safe no-op, not a throw" contract.

  // --- Independent gentle vertical bob ------------------------------------------------------------
  // Sampled from the correct non-frozen clock per phase — state.clockTime during fall-in (still
  // advancing then), state.traverse.elapsedSeconds during traverse (state.clockTime is frozen for
  // the whole phase, per main.js's tick loop / ARCHITECTURE.md's exact bug-class warning), and
  // state.actIII.clockTime during 'turn' (the one return-phase beat this module still runs during,
  // for the dissolve ramp below — state.clockTime is ALSO frozen here, same as throughout the
  // traverse, since main.js never resumes incrementing it once the traverse completes; the live
  // clock for this beat is state.actIII.clockTime instead, per state.js's three-phase timing
  // model). Never the reverse.
  //
  // v2.3 FIX (kinetic/motion review): this used to fall back to `state.clockTime` for every beat
  // other than 'traverse', including 'turn' — but state.clockTime is frozen for 'turn' too (it
  // only ever advances during drop/freefall/catch), so bobClock/weaveClock silently became a
  // CONSTANT for the whole 'turn' beat. Since the bob/weave below are applied as unconditional
  // per-frame `+=`/`.add()` mutations directly on group.position (not a re-anchored offset from a
  // resolved axial target — 'turn' is exactly the beat where axialPosition never resolves, see the
  // block above), a constant Math.sin(...) added to group.position EVERY FRAME for the whole 1.2s
  // 'turn' beat produced unbounded, frame-rate-dependent drift instead of the intended "small
  // amount of lateral weave" — and broke the dissolve's own promised "holds its last traverse-end
  // position" character. Fixed by keying off state.actIII.clockTime (the beat's own live,
  // advancing clock) during 'turn', so the bob/weave stay bounded, gently oscillating offsets
  // exactly like every other beat, rather than a frozen instant replayed as a runaway increment.
  const bobClock =
    beat === 'traverse'
      ? (state.traverse?.elapsedSeconds ?? 0)
      : beat === 'turn'
        ? (state.actIII?.clockTime ?? 0)
        : (state.clockTime ?? 0);
  handle.bobPhase = bobClock * BOB_FREQUENCY_HZ * Math.PI * 2;
  group.position.y += Math.sin(handle.bobPhase) * GUIDE.bobAmplitude;

  // --- v2.3: lateral weave/drift, on top of whatever the curved path itself already supplies ------
  // CONCEPT.md v2.3 item 3 / ARCHITECTURE.md's guide.js section: "add a small amount of lateral
  // drift/weave as it travels the new curved path... the orb's own local motion on top of that
  // should also feel less mechanical/single-axis." The curve (config.js's PATH) already bends the
  // orb's raw axial TARGET left/right/up/down as a function of travel position — this is a
  // deliberately separate, smaller layer of the orb's own character on top of that, sampled off
  // the same non-frozen per-phase clock as the bob above (never state.clockTime during traverse).
  // Offset is expressed in the orb's actual LOCAL frame (tangent x world-up = "right," per
  // ARCHITECTURE.md's module-boundary warning that a fixed world-X "sideways" assumption breaks
  // once the tangent varies along a curve instead of running fixed along -Z) rather than a raw
  // world-X nudge, so the weave always reads as side-to-side relative to the direction the orb is
  // actually currently traveling, whichever way the path is banking at that point.
  const weaveClock = bobClock; // same clock-selection rule as the bob above
  _weaveRight.crossVectors(handle.lastTangent, WORLD_UP);
  if (_weaveRight.lengthSq() < 1e-8) {
    // Tangent briefly parallel to world-up (e.g. a near-vertical instant early in the fall) — fall
    // back to world-X so the cross product never degenerates to a zero vector.
    _weaveRight.set(1, 0, 0);
  } else {
    _weaveRight.normalize();
  }
  const lateralWeave =
    Math.sin(weaveClock * WEAVE_PRIMARY_HZ * Math.PI * 2 + handle.bobPhase) * 0.7 +
    Math.sin(weaveClock * WEAVE_SECONDARY_HZ * Math.PI * 2 + 1.7) * 0.3;
  const verticalWeave = Math.sin(weaveClock * WEAVE_VERTICAL_HZ * Math.PI * 2 + 0.9);
  _weaveOffset
    .copy(_weaveRight)
    .multiplyScalar(lateralWeave * WEAVE_LATERAL_AMPLITUDE)
    .addScaledVector(WORLD_UP, verticalWeave * WEAVE_VERTICAL_AMPLITUDE);
  group.position.add(_weaveOffset);

  // --- The handoff: dissolve into the Act III overflowLight starting at 'turn' -------------------
  // Non-negotiable #8 / GUIDE.dissolveStartBeat: the orb appears once, at the start, and hands off
  // to the return phase's own light rather than persisting to the end. Ramp opacity/scale to 0 and
  // blend color toward the overflow palette across the 'turn' beat's full duration, then go fully
  // invisible and stay that way (handled by the `handle.dissolved` early-return above) for
  // approach/overflow/iris.
  if (beat === GUIDE.dissolveStartBeat) {
    if (!state.guide) state.guide = { position: null, tangent: null, dissolving: false };
    state.guide.dissolving = true;

    const duration = dissolveDurationSeconds();
    handle.dissolveElapsed += dt || 0;
    const dissolveT = THREE.MathUtils.clamp(handle.dissolveElapsed / duration, 0, 1);
    // Ease so the orb reads as blooming outward and merging (CONCEPT.md v2.1 Section 3: "a brief,
    // deliberate visual event... not an abrupt disappearance") rather than a linear fade.
    const eased = 1 - Math.pow(1 - dissolveT, 3);

    // Color blends from the guide's own warm presence toward the overflow light's own color at
    // this moment (COLOR.overflowStart -> overflowEnd, the same range lighting.js's overflowLight
    // itself lerps across via mixT) so the hue the orb dissolves into visually matches the light
    // it's merging with, not an arbitrary target color authored independently in this module.
    const mixT = THREE.MathUtils.clamp(state.color?.mixT ?? 0, 0, 1);
    _dissolveColor.copy(_overflowStart).lerp(_overflowEnd, mixT);
    // Start the blend from the SAME boosted brightness the orb held throughout the traverse (not
    // the flat, un-boosted _guideColor) so 'turn' doesn't open with a visible brightness pop-down
    // the instant the dissolve begins — the GUIDE_BRIGHTNESS headroom fades out across the ramp
    // (1 -> 0 as eased goes 0 -> 1) since by the time it's fully merged into the overflow light,
    // the light's own brightness (lighting.js's territory) is what should be read as brightest.
    // v2.3: the pulsing glow term fades out the same way (pulseGlow -> 1) across the ramp, for the
    // same reason — a separate, independently-breathing brightness signal has no business
    // persisting once the orb has fully become the (lighting.js-owned) overflow light.
    const brightnessFade = THREE.MathUtils.lerp(GUIDE_BRIGHTNESS, 1, eased);
    const glowFade = THREE.MathUtils.lerp(pulseGlow, 1, eased);
    _frameColor.copy(_guideColor).multiplyScalar(brightnessFade * glowFade).lerp(_dissolveColor, eased);

    // Bloom outward (scale up slightly) while fading opacity down — "glow blooming outward and
    // merging with the growing light source," not a plain shrink-to-nothing.
    const scale = THREE.MathUtils.lerp(1, 1.6, eased);
    group.scale.setScalar(scale);
    setGlowAppearance(handle, _frameColor, 1 - eased);
    group.visible = 1 - eased > 0.001;

    if (dissolveT >= 1) {
      handle.dissolved = true;
      group.visible = false;
    }
  } else if (beat === 'drop' || beat === 'freefall' || beat === 'catch' || beat === 'traverse') {
    // Present through fall-in and the entire traverse (non-negotiable: the orb "appears once, at
    // the start" and leads throughout) — guards against any stale opacity/scale left over from a
    // skipped/rewound state, though under normal playback these are already at their resting
    // values every frame before 'turn' begins.
    // GUIDE_BRIGHTNESS keeps the orb's realized luminance above the vortex streak field's own
    // realistic peak (see that constant's comment) so it stays "the brightest, warmest thing in
    // frame" for the whole stretch it's meant to lead, not just at t=0. v2.3: pulseGlow layers a
    // genuine, independent brightness oscillation on top of that same headroom (never replacing
    // it) so the orb reads as breathing/alive rather than a flat, solidly-lit ball that merely
    // moves — see PULSE_GLOW_* above for why this is tied to state.pulse.bpm specifically.
    // v2.5: the orb is fully present at its own resting scale/opacity/color from the very first
    // frame of `drop` — the v2.4 ignition-from-the-screen blend that used to gate this has been
    // removed (see this file's header comment).
    group.visible = true;
    _frameColor.copy(_guideColor);
    _frameColor.multiplyScalar(GUIDE_BRIGHTNESS * pulseGlow);
    group.scale.setScalar(1);
    setGlowAppearance(handle, _frameColor, 1);
  } else {
    // approach / overflow / iris, reached without ever having passed through the dissolve branch
    // above (e.g. a skip-to-end that jumps straight past 'turn') — non-negotiable #8 still applies:
    // the orb must be fully invisible here regardless of how this beat was reached.
    group.visible = false;
    handle.dissolved = true;
  }

  // --- Write the shared handoff fields every frame ---------------------------------------------
  // state.guide.position/tangent are the two fields vortex.js's chase-cam math needs (v2.2's
  // structural change — the camera derives its position FROM these, this module is their sole
  // writer). Also read by overlay-text.js (optional, on-screen dialogue-timing purposes) and any
  // other module per ARCHITECTURE.md's module-boundary contract (READERS ONLY elsewhere).
  if (!state.guide) state.guide = { position: null, tangent: null, dissolving: false };
  if (!state.guide.position) state.guide.position = new THREE.Vector3();
  if (!state.guide.tangent) state.guide.tangent = new THREE.Vector3().copy(FORWARD);
  state.guide.position.copy(group.position);
  state.guide.tangent.copy(handle.lastTangent);
}
