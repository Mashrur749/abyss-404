// src/scene/camera.js (v2.2 — Follow-the-Orb retune)
//
// Owns camera FOV / roll / bank perturbation, the simplex-noise-driven
// micro-drift/sway described in CONCEPT.md v2 Section 3, and (new in v2.2)
// fall-in mouse-look parallax. Walk-bob is gone entirely — there is no
// footstep cadence to simulate when flying/falling through an open void
// instead of walking a corridor.
//
// IMPORTANT — ownership boundary (per ARCHITECTURE.md): this module does NOT
// set camera.position, ever, in any beat. That is exclusively vortex.js's job:
// during drop/freefall/catch/traverse, vortex.js's getCameraRigPosition now
// derives the rig position/lookAt FROM the Guiding Orb's own resolved
// position/tangent (guide.js's chase-cam handoff, CAMERA.chase — "the orb
// drives, the camera follows"); during turn/approach/overflow/iris (no orb
// left to follow) it positions itself directly against the travel axis, same
// mechanism as v2.1. Because main.js's fixed update order runs `camera` AFTER
// `vortex`/main.js's own `camera.lookAt()` call sets position/orientation each
// frame (same ordering v1 used for corridor.js), every perturbation this
// module owns is realized purely as *orientation* (rotation) and *FOV*
// perturbation layered on top of whatever base position/lookAt was already
// established, never as a translation. This holds just as true for the new
// fall-in parallax below as it did for the pre-existing traverse drift/bank/
// parallax layers — mouse-look here is gaze only, never pace or position.

import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { CAMERA, SEEKING_ORBS, VORTEX } from '../config.js';

const DEG2RAD = THREE.MathUtils.degToRad;

// Amplitude tuning for the subliminal drift/sway (CONCEPT.md: "very slow,
// almost-subliminal camera drift/sway (like breathing)"). Kept intentionally small —
// this must read as texture, never as a competing motion against vortex.js's path.
const DRIFT_YAW_AMPLITUDE_DEG = 0.35;
const DRIFT_PITCH_AMPLITUDE_DEG = 0.22;
const DRIFT_ROLL_AMPLITUDE_DEG = 0.18;
const DRIFT_FREQUENCY = 0.06; // Hz-ish rate the noise field is sampled at — slow, breath-like

// Mouse-parallax / gyro-tilt camera sway (CONCEPT.md v2 Section 3: "Mouse-parallax/
// gyroscope tilt ... still applies as a secondary, small-magnitude layer on top of
// scroll-driven forward travel — scroll controls how fast you go, parallax still
// controls where you're looking"). state.pointer.x/y (normalized -1..1, already
// smoothed by interaction.js) is read here and mapped to a small yaw/pitch offset —
// heavily damped again on top of that smoothing so the camera visibly-but-gently
// leans toward wherever the user is looking, never enough to compete with or
// override vortex.js's path-following orientation. Gated to the traverse beat only
// (renamed from v1's 'labyrinth'), same as before.
const PARALLAX_YAW_MAX_DEG = 1.6;
const PARALLAX_PITCH_MAX_DEG = 1.0;
const PARALLAX_DAMPING = 2.2; // exponential smoothing rate (Hz-ish) toward the target lean

// --- Fall-in mouse-look parallax (v2.2, new — CAMERA.fallInParallax) ------------------------
// Direct fix for "the initial camera movement needs to hook the user, and be interactive."
// Non-negotiable #3 ("control as instrument"): fall-in still strips *pace* control entirely —
// the drop/freefall/catch sequence plays on its fixed autoplay curve no matter what the user
// does — but as of v2.2 it no longer strips *gaze* control too. This is a separate, gated-to-
// fall-in-only sibling of the traverse parallax layer above (kept as its own damped state/target
// rather than reusing PARALLAX_* so the two beats' magnitudes/damping can be tuned independently
// per CAMERA.fallInParallax vs. the hand-authored PARALLAX_* constants, and so toggling one never
// perturbs the other's damped state). Reads state.pointer.x/y exactly like the traverse layer —
// interaction.js already tracks/smooths pointer input unconditionally regardless of beat, so no
// new input plumbing is needed here, only a new consumer. Position/pace are untouched — this
// only ever adds rotation on top of vortex.js's fall-in chase-cam base orientation, same
// compose-not-assign contract as every other layer in this file.
const FALL_IN_PARALLAX_DAMPING = 1 / Math.max(CAMERA.fallInParallax.dampingSeconds, 0.001); // Hz-ish

// Bank smoothing — state.camera.bankDeg arrives as a discrete authored target
// (telegraphed by state.turnCue.amount, magnitude from CAMERA.bankDegrees, per
// ARCHITECTURE.md's camera.js section); this module still eases its *own*
// realized roll toward that target rather than snapping straight to it, so the
// bank reads as the camera rolling INTO the vortex's spiral curve rather than a
// discrete tilt-and-correct (the explicit replacement for v1's Dutch-tilt).
const BANK_DAMPING = 1.4; // exponential smoothing rate (Hz-ish), slower than parallax on purpose

// --- Regional framing variety (v2.1 addition, kept in v2.2 — see reconciliation note below) ------
// Playtest feedback: "the journey needs to be more interesting" — the bank/drift textures above
// were previously the *only* camera variety across the whole traverse, making every stretch of
// the flow field feel identical. This section adds a second, independent texture keyed to the
// SAME travel-axis positions seeking-orbs.js places its orb-cluster encounters at, PLUS the same
// midpoint-between-encounters anchors vortex.js's own regionalProfileAt() adds as its "companion
// orb cluster" waypoints (vortex.js's REGION_ANCHORS_T: the SEEKING_ORBS.count encounter positions, plus one
// extra anchor dropped exactly between each consecutive pair) — so camera framing, particle
// density, and color temperature all agree on where "a region" is, rather than being three
// unrelated systems that happen to overlap by coincidence. Without the midpoint anchors here, the
// one stretch of the traverse explicitly reserved for a "companion-orb encounter" camera beat
// (CONCEPT.md v2.1 Section 2: "a glyph-formation or companion-orb encounter", now a seeking-orb
// encounter per v2.6) would get vortex.js's denser/warmer treatment with zero matching camera
// texture. This module does not import seeking-orbs.js/vortex.js (would cross the ownership
// boundary); it re-derives the same anchor-building logic from the same
// SEEKING_ORBS.count/VORTEX.travelSpan config values both modules already share, so
// the two stay in lockstep without a direct dependency. REGION_INFLUENCE_RADIUS is likewise kept
// equal (in meters) to vortex.js's REGION_INFLUENCE_WIDTH (a normalized-t fraction there,
// converted to meters here via VORTEX.travelSpan) so the camera's frame-tightening pull relaxes
// back to neutral at the same rate the particle field's density/warmth falloff does, rather than
// desyncing at the edges of a region.
//
// v2.2 chase-cam reconciliation: kept as-is, deliberately not simplified away. The chase-cam base
// motion (vortex.js deriving camera position/lookAt from the orb's own axial position/tangent)
// only changes WHERE the camera sits relative to the orb — it says nothing about how the frame
// itself varies stretch-to-stretch along the journey. This region system is pure additive
// rotation/FOV on top of that base, keyed to axial travel-axis distance (still sampled below via
// state.traverse.progress * VORTEX.travelSpan during traverse, which is exactly the orb's own
// current axial position per the v2.2 contract — guide.js positions the orb AT that distance along
// the axis every frame, so this remains the correct, still-synchronized read even though the
// camera itself now trails a few meters behind the orb along the same axis; at
// REGION_INFLUENCE_RADIUS's scale, that fixed trailing offset is immaterial to which region reads
// as "nearest"). Nothing here fights the orb-following motion — it never touches position, only
// adds a still-distinct "this stretch feels different" texture the chase-cam's own path-following
// alone doesn't provide (the chase-cam keeps the frame locked on the orb everywhere; it doesn't by
// itself vary per region).
const REGION_MARGIN = 0.12; // matches seeking-orbs.js's encounterParamPositions() margin exactly
const REGION_INFLUENCE_WIDTH_T = 0.16; // matches vortex.js's REGION_INFLUENCE_WIDTH exactly (normalized t)
const REGION_INFLUENCE_RADIUS = REGION_INFLUENCE_WIDTH_T * VORTEX.travelSpan; // meters, same falloff distance as vortex.js's regional density/warmth

/** Same parametrization seeking-orbs.js's encounterParamPositions() uses, kept in lockstep via shared config
 * values rather than a cross-module import (see comment above). Returns normalized t in (0,1). */
function regionParamPositions(count) {
  const positions = [];
  const span = 1 - REGION_MARGIN * 2;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : REGION_MARGIN + (span * (i + 0.5)) / count;
    positions.push(t);
  }
  return positions;
}

/** Same anchor set vortex.js's REGION_ANCHORS_T builds: the primary glyph-position anchors plus
 * one midpoint anchor between each consecutive pair (the companion-orb cluster waypoints) — see
 * the comment above for why camera.js must include these too, not just the primary anchors. */
function regionAnchorPositions(count) {
  const primary = regionParamPositions(count);
  const anchors = [...primary];
  for (let i = 0; i + 1 < primary.length; i++) {
    anchors.push((primary[i] + primary[i + 1]) / 2);
  }
  return anchors;
}

const REGION_AXIAL_DISTANCES = regionAnchorPositions(Math.max(1, SEEKING_ORBS.count | 0)).map(
  (t) => t * VORTEX.travelSpan
);

// How much closer/wider the framing pulls in near a region vs. the open stretches between them.
// Realized as a small FOV perturbation layered on top of director.js's own authored
// state.camera.fov target (never replacing it) — a few degrees reads as "the frame tightened,"
// nowhere near enough to compete with the FOV recalibration between acts.
const REGION_FOV_PULL_DEG = 4;
// Brief, independent orientation texture: a slower, wider-swinging secondary sway that only
// gains meaningful amplitude near a region, so each region gets a distinguishable "the camera
// is doing something a little different here" moment rather than pure uniform drift everywhere.
// Purely additive rotation, same as the breathing-drift/bank/parallax layers above — never a
// position change, so it can never conflict with scroll-driven pace.
const REGION_YAW_AMPLITUDE_DEG = 1.1;
const REGION_PITCH_AMPLITUDE_DEG = 0.6;
const REGION_TEXTURE_FREQUENCY = 0.18; // faster than the ambient breathing drift, reads as a
                                        // distinct texture rather than the same sway intensifying
const REGION_DAMPING = 1.6; // exponential smoothing rate so the pull fades in/out, never snaps

let regionYawRad = 0;
let regionPitchRad = 0;
let regionFovOffset = 0;

/** 0..1 strength of the nearest region's influence at axial distance `dist` (meters), falling off
 * smoothly (smoothstep-like) over REGION_INFLUENCE_RADIUS so regions blend into open stretches
 * rather than having a hard edge, plus which region anchor (index into REGION_AXIAL_DISTANCES) is
 * the nearest one — used below so each region can be seeded with its own distinct noise offset
 * rather than every region reading as the identical camera "event" replayed (CONCEPT.md v2.1
 * Section 2: "different stretches of the traverse are visually distinguishable from EACH OTHER",
 * not just distinguishable from the ambient baseline in between). */
function nearestRegionStrength(dist) {
  let best = 0;
  let bestIndex = 0;
  for (let i = 0; i < REGION_AXIAL_DISTANCES.length; i++) {
    const d = Math.abs(dist - REGION_AXIAL_DISTANCES[i]);
    if (d >= REGION_INFLUENCE_RADIUS) continue;
    const x = 1 - d / REGION_INFLUENCE_RADIUS;
    const smooth = x * x * (3 - 2 * x); // smoothstep
    if (smooth > best) {
      best = smooth;
      bestIndex = i;
    }
  }
  return { strength: best, index: bestIndex };
}

export function createCamera() {
  const camera = new THREE.PerspectiveCamera(
    CAMERA.fov.fall,
    window.innerWidth / window.innerHeight,
    0.05,
    200
  );
  camera.position.set(0, CAMERA.eyeHeight, 0);
  camera.rotation.order = 'YXZ'; // yaw (drift) - pitch (bob/drift) - roll (bank/sway), stable composition

  return camera;
}

// Independent noise fields so yaw/pitch/roll drift don't visibly correlate with
// each other (would read as mechanical circular motion instead of organic sway).
const noiseA = createNoise2D();
const noiseB = createNoise2D();
const noiseC = createNoise2D();

let lastFov = null;

// Current damped parallax lean, smoothed independently of interaction.js's own pointer
// smoothing so the camera's response reads as its own soft, heavily-damped agency layer.
let parallaxYawRad = 0;
let parallaxPitchRad = 0;

// Current damped bank roll, eased toward state.camera.bankDeg (see BANK_DAMPING above).
let bankRollRad = 0;

// Current damped fall-in mouse-look lean (CAMERA.fallInParallax) — kept as its own state
// separate from parallaxYawRad/parallaxPitchRad above so the fall-in and traverse layers never
// share (and therefore never fight over) the same damped value across the beat boundary between
// them; each starts fresh/settles independently within its own gated beat range.
let fallInParallaxYawRad = 0;
let fallInParallaxPitchRad = 0;

// --- Integration note (resolved during the main.js integration pass) ---------------
// vortex.js supplies a base facing direction via `{ position, lookAt }` — as of v2.2, during
// drop/freefall/catch/traverse that base position/lookAt is itself derived FROM the Guiding
// Orb's resolved position/tangent (the chase-cam handoff: guide.js resolves the orb's position
// first each frame, main.js passes it into vortex.js's getCameraRigPosition, see
// ARCHITECTURE.md) rather than computed independently as in v2.1; during turn/approach/overflow/
// iris there is no orb left to follow and vortex.js positions the rig directly against the axis,
// unchanged from v2.1. Either way, main.js applies `camera.position.copy(position)` +
// `camera.lookAt(lookAt)` BEFORE calling updateCamera() each frame (order: vortex -> camera),
// exactly matching v1's corridor -> camera ordering, precisely to avoid the lookAt-overwrite
// hazard. `camera.lookAt()` establishes a base rotation.x/rotation.y (with rotation.z == 0,
// since lookAt never rolls the camera). This function therefore ADDS its roll/pitch/yaw
// perturbations to whatever base rotation is already on the camera when it runs, rather than
// assigning absolute rotation values — preserving the chase-cam's orb-following orientation
// while still layering camera.js's own orientation/FOV texture (including the new fall-in
// mouse-look below) on top. This module never reads state.guide directly and never needs to —
// it only ever composes onto the base rotation vortex.js/main.js already established, exactly
// like every other perturbation layer here.
export function updateCamera(camera, state, dt) {
  // --- FOV -------------------------------------------------------------
  // Director.js writes the eased target into state.camera.fov (from
  // CAMERA.fov.fall/.traverse/.approach — renamed from v1's .corridor); this
  // module is the only one that actually touches the THREE camera object for it.
  // No walk-bob "breath" layered on top anymore — there is no footstep cadence
  // in a void.
  const inTraverse = state.beat === 'traverse';
  const inFallIn = state.beat === 'drop' || state.beat === 'freefall' || state.beat === 'catch';

  // Regional framing variety (see the block above): pull the frame in slightly near a
  // glyph-formation/companion-orb region, ease back open in the stretches between — tied to the
  // camera's real axial position on the fixed travel axis (state.traverse.progress *
  // VORTEX.travelSpan), not per-frame randomness, so a user re-experiencing the page sees the
  // same regions pull the frame in the same place, matching vortex.js's own regional variation.
  let regionStrength = 0;
  let regionIndex = 0;
  if (inTraverse) {
    const axialDistance = THREE.MathUtils.clamp(state.traverse?.progress ?? 0, 0, 1) * VORTEX.travelSpan;
    const nearest = nearestRegionStrength(axialDistance);
    regionStrength = nearest.strength;
    regionIndex = nearest.index;
  }
  const regionLerp = 1 - Math.exp(-REGION_DAMPING * dt);
  // Each region anchor pulls the FOV in by a slightly different amount (still centered on
  // REGION_FOV_PULL_DEG, +/-1deg spread keyed by anchor index) so regions read as having their
  // own character rather than being the identical "tighten by exactly 4deg" event repeated —
  // CONCEPT.md v2.1 Section 2's ask is for stretches to be distinguishable from EACH OTHER, not
  // just from the open stretches between them.
  const regionFovPull = REGION_FOV_PULL_DEG + ((regionIndex * 37) % 5) - 2;
  regionFovOffset += (regionStrength * -regionFovPull - regionFovOffset) * regionLerp;

  const fov = state.camera.fov + (inTraverse ? regionFovOffset : 0);

  if (fov !== lastFov) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
    lastFov = fov;
  }
  // state.clockTime is main.js's fall-in-phase clock only and is explicitly frozen for the
  // entire traverse phase (see main.js's phase-clock comment) — sampling it here during
  // traverse would make the noise input a fixed constant for the whole act, silently freezing
  // the "breathing" micro-drift CONCEPT.md v2 Section 3 calls the trance's core motion signal.
  // state.traverse.elapsedSeconds is the real wall-clock time actually advancing during this
  // phase (owned by scroll.js), so use that as the noise-sampling clock while in traverse;
  // fall-in's own drift usage (none currently, but kept correct for any future consumer) still
  // reads state.clockTime.
  const t = inTraverse ? state.traverse.elapsedSeconds : state.clockTime;

  // --- Orientation: uncommanded roll (fall-in) + gentle bank (traverse) -----------
  // state.camera.rollDeg (Act I tumble, unchanged from v1) and state.camera.bankDeg
  // (Act II — replaces v1's dutchTiltDeg, same telegraphed-by-state.turnCue.amount
  // mechanism, magnitude from CAMERA.bankDegrees) are both authored by director.js;
  // this module realizes them as rotation.z. Unlike v1's discrete tilt-and-correct
  // dutch-tilt, the bank is eased through its own damped smoothing (BANK_DAMPING)
  // so it reads as the camera rolling INTO the vortex's spiral curve rather than a
  // snap-tilt-then-snap-back.
  const bankLerp = 1 - Math.exp(-BANK_DAMPING * dt);
  bankRollRad += (DEG2RAD(state.camera.bankDeg) - bankRollRad) * bankLerp;

  let rollRad = DEG2RAD(state.camera.rollDeg) + bankRollRad;
  let pitchRad = 0;
  let yawRad = 0;

  // --- Simplex-noise-driven micro-drift/sway (traverse only) ---------------------
  // "a very slow, almost-subliminal camera drift/sway (like breathing)" — CONCEPT.md
  // v2 Section 3, unchanged from v1. Sampled by state.clockTime per the architecture
  // contract, at a slow rate so it never reads as jitter, only as a living, breathing
  // stillness.
  if (inTraverse) {
    const n = t * DRIFT_FREQUENCY;
    const driftYaw = noiseA(n, 0);
    const driftPitch = noiseB(n, 0);
    const driftRoll = noiseC(n, 0);

    yawRad += DEG2RAD(driftYaw * DRIFT_YAW_AMPLITUDE_DEG);
    pitchRad += DEG2RAD(driftPitch * DRIFT_PITCH_AMPLITUDE_DEG);
    rollRad += DEG2RAD(driftRoll * DRIFT_ROLL_AMPLITUDE_DEG);
  }

  // --- Regional independent orientation texture (traverse only, v2.1 addition) ---------------
  // A second, faster noise field whose amplitude is gated by regionStrength (computed above from
  // the same travel-axis positions seeking-orbs.js/vortex.js key their own regional variety to), so it
  // only contributes a noticeable texture near a region and fades to ~nothing in the open
  // stretches between — giving each region a brief, distinguishable "something's a little
  // different here" camera moment rather than the ambient breathing drift being the only texture
  // for the entire 6-26s act. Purely additive rotation on top of the breathing drift above, never
  // a position change, so it can never compete with or fight scroll-driven pace.
  // Each region samples the noise field at its own fixed offset (regionIndex-derived, not the
  // shared constant `5` every region previously used) so different anchors produce genuinely
  // different sway shapes/phases rather than the same texture merely re-triggering — CONCEPT.md
  // v2.1 Section 2 asks for stretches distinguishable from EACH OTHER, not just from the ambient
  // baseline between them.
  if (inTraverse && regionStrength > 0.001) {
    const regionSeed = 5 + regionIndex * 11.7;
    const rn = t * REGION_TEXTURE_FREQUENCY;
    const targetRegionYaw = noiseB(rn, regionSeed) * REGION_YAW_AMPLITUDE_DEG * regionStrength;
    const targetRegionPitch = noiseA(rn, regionSeed) * REGION_PITCH_AMPLITUDE_DEG * regionStrength;
    regionYawRad += (DEG2RAD(targetRegionYaw) - regionYawRad) * regionLerp;
    regionPitchRad += (DEG2RAD(targetRegionPitch) - regionPitchRad) * regionLerp;
  } else {
    regionYawRad += (0 - regionYawRad) * regionLerp;
    regionPitchRad += (0 - regionPitchRad) * regionLerp;
  }
  yawRad += regionYawRad;
  pitchRad += regionPitchRad;

  // --- Mouse-parallax / gyro-tilt sway (traverse only) ----------------------------
  // CONCEPT.md v2 Section 3: parallax/gyro tilt still applies as a secondary,
  // small-magnitude layer on top of scroll-driven forward travel, gated to the
  // traverse beat (renamed from v1's 'labyrinth') exactly as before. interaction.js
  // already tracks + smooths state.pointer.x/y (normalized -1..1) but never writes
  // camera orientation itself (that would cross the module ownership boundary) —
  // this is the read side. Damped again here (on top of interaction.js's own
  // smoothing) so the lean arrives softly rather than snapping to the raw pointer
  // signal, matching "heavily damped" in the concept doc.
  const target = inTraverse ? state.pointer : { x: 0, y: 0 };
  const parallaxLerp = 1 - Math.exp(-PARALLAX_DAMPING * dt);
  const targetYaw = DEG2RAD(-target.x * PARALLAX_YAW_MAX_DEG);
  const targetPitch = DEG2RAD(target.y * PARALLAX_PITCH_MAX_DEG);
  parallaxYawRad += (targetYaw - parallaxYawRad) * parallaxLerp;
  parallaxPitchRad += (targetPitch - parallaxPitchRad) * parallaxLerp;
  yawRad += parallaxYawRad;
  pitchRad += parallaxPitchRad;

  // --- Fall-in mouse-look parallax (drop/freefall/catch only, v2.2 new) ----------------------
  // CAMERA.fallInParallax: direct fix for "the initial camera movement needs to hook the user,
  // and be interactive." Same read side as the traverse parallax above (state.pointer.x/y,
  // already tracked/smoothed unconditionally by interaction.js regardless of beat) but with its
  // own damped state/target and its own config-authored magnitude, gated to fall-in only so it
  // never doubles up with (or has to be reconciled against) the traverse layer above — the two
  // are mutually exclusive by beat, never summed. Gaze only: gated to rotation exactly like every
  // other layer in this file, never position/pace — the fall itself still plays on its fixed
  // autoplay curve (EASE.drop/director.js's fallInTimeline) no matter where the user is looking,
  // satisfying non-negotiable #3 ("control as instrument": fall-in strips pace, not gaze, in
  // v2.2). Composed on top of vortex.js's fall-in chase-cam base orientation (the camera looking
  // at/past the orb as it falls) rather than replacing it.
  const fallInTarget = inFallIn ? state.pointer : { x: 0, y: 0 };
  const fallInParallaxLerp = 1 - Math.exp(-FALL_IN_PARALLAX_DAMPING * dt);
  const fallInTargetYaw = DEG2RAD(-fallInTarget.x * CAMERA.fallInParallax.maxYawDeg);
  const fallInTargetPitch = DEG2RAD(fallInTarget.y * CAMERA.fallInParallax.maxPitchDeg);
  fallInParallaxYawRad += (fallInTargetYaw - fallInParallaxYawRad) * fallInParallaxLerp;
  fallInParallaxPitchRad += (fallInTargetPitch - fallInParallaxPitchRad) * fallInParallaxLerp;
  yawRad += fallInParallaxYawRad;
  pitchRad += fallInParallaxPitchRad;

  // Compose onto whatever base orientation the chase-cam's camera.lookAt() already
  // established this frame (see integration note above) rather than assigning
  // absolute values, so the orb-following facing direction survives.
  camera.rotation.z += rollRad;
  camera.rotation.x += pitchRad;
  camera.rotation.y += yawRad;
}
