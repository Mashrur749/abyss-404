// src/scene/vortex.js
//
// v2's primary visual: replaces src/scene/corridor.js's walled-labyrinth geometry entirely with
// an open particle-vortex flow field the camera flies through across all three phases (fall-in
// void, scroll-paced traverse, return-toward-light). CONCEPT.md v2 Section 0: "there is nothing
// to bump into" — no walls, so this module owns zero collision geometry, only:
//   - the single fixed travel axis every phase's camera position is derived from (a straight
//     line, per the "guaranteed resolution" non-negotiable — one path, no branches, no lateral
//     choice ever offered to the camera)
//   - the InstancedMesh particle-streak flow field dressing that axis, spiraling around it
//     (VORTEX.vortexTwistRate) between VORTEX.tunnelRadiusMin/Max, unlit/emissive-only per the
//     lighting lesson below
//   - getCameraRigPosition(state, orb), which branches on state.beat to pick the right clock
//
// v2.2 CHANGE (ARCHITECTURE.md's "the camera now follows the orb" section): during
// drop/freefall/catch/traverse, the camera's position/lookAt are now DERIVED FROM the Guiding
// Orb's own resolved { position, tangent } (a proper chase-cam — behind and above it, looking
// at/past it, per CAMERA.chase), rather than this module computing camera position independently
// and guide.js chasing a lead-distance offset from wherever the camera ends up.
// getCameraRigPosition therefore now takes the orb's resolved position/tangent as an optional
// second parameter (per ARCHITECTURE.md's exact contract: main.js calls updateGuide() first each
// frame, then passes the orb's resolved { position, tangent } in as a parameter) — but this module
// does NOT import guide.js (that would recreate the exact circular import ARCHITECTURE.md calls
// out: guide.js needs this module's fall-in axial-position math, this module would need guide.js's
// resolved orb position). If the `orb` parameter isn't supplied, getCameraRigPosition falls back to
// reading state.guide.position/state.guide.tangent directly instead — guide.js is documented as the
// sole WRITER of those two fields every frame regardless of which beat is active, so reading them
// off `state` is exactly as current as an explicit parameter would be, and this keeps the module
// correct even before/without main.js's own call-site being updated to pass `orb` explicitly. The
// turn/approach/overflow/iris branches are UNCHANGED — there is no orb left to follow once it has
// dissolved (GUIDE.dissolveStartBeat === 'turn'), so those branches keep computing camera position
// directly against the fixed travel axis, exactly as in v2.1.
//
// LIGHTING LESSON (ARCHITECTURE.md): v1 shipped PointLights illuminating nearby wall geometry at
// ~0.4m range, which under Three.js's mandatory physically-correct lighting produced a real 6x
// near-field overexposure bug. v2 has no walls, so there is no excuse to repeat it — this module
// creates ZERO THREE.Light objects. Every particle's brightness comes from its own unlit
// MeshBasicMaterial color (vertex-colored per-instance so pulse/proximity can vary streak-to-
// streak without per-instance material instances), authored directly from state.color.mixT /
// state.pulse.bpm / state.turnCue.amount. lighting.js remains the sole owner of actual scene
// lights (ambient/hemisphere fill, the Act III overflowLight, glyph proximity glow).

import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import { VORTEX, CAMERA, COLOR, BEATS, PULSE, GUIDE, SEEKING_ORBS, COMPANION_ORBS, AMBIENT_EVENTS, VISION_ENCOUNTER, SCROLL, SCROLL_FEEL, PATH, STREAK_BRIGHTNESS_CEILING } from '../config.js';
import { buildGlowOrb, getSharedStreakTexture } from './glow-sprite.js';

// ---------------------------------------------------------------------------------------------
// v2.3 CHANGE — the travel axis is now a real THREE.CatmullRomCurve3, not a straight line.
//
// Playtest feedback (CONCEPT.md v2.3 item 1): "the camera feels too static, maybe due to
// straight path... we want it to feel like a journey, rather than a straight boring path." The
// v2/v2.2 axis was a literal (0,0,-dist) line — the spiral particle motion and camera bank were
// cosmetic overlays on top of a dead-straight camera trajectory. This is the root-cause fix:
// build ONE CatmullRomCurve3 from config.js's PATH.waypointOffsets, spanning fall-in's own axial
// descent + the traverse (VORTEX.travelSpan) + the return phase's distance budget
// (OVERFLOW_LIGHT_DISTANCE + a small margin past it), and sample it via arc-length everywhere
// axisPointAt/axisTangentAt used to compute (0,0,-dist)/(0,0,-1) directly. This is also the
// direct fix for "the ending needs to flow with the movement" (CONCEPT.md v2.3 item 2): fall-in,
// traverse, and return all sample the same curve now, so the return phase is a continuation of
// the same path rather than a different straight-line system taking over.
//
// GUARANTEED RESOLUTION IS UNTOUCHED: one continuous curve with no branches is exactly as
// unicursal as a straight line was — curvature changes shape, never adds choice (non-negotiable
// #1, CONCEPT.md v2.3's closing note).
//
// CONTRACT PRESERVED: axisPointAt(dist)/axisTangentAt(dist) keep their exact v2.2 meaning — `dist`
// is meters measured from the TRAVERSE'S ENTRY POINT (dist=0, matching guide.js's own local
// axisPointAt(0) exactly, which vortex.js does NOT own/import — see guide.js's header comment on
// why it keeps a self-contained straight-line copy for the fall's own descent lerp). dist=0 is
// still "where the traverse begins," dist=VORTEX.travelSpan is still "where the traverse ends,"
// and dist=VORTEX.travelSpan+OVERFLOW_LIGHT_DISTANCE is still "where the overflow light sits" —
// every existing caller (getFallInAxialPosition, getCameraRigPosition, getVortexAxis,
// getAxisPositionAtDistance/getAxisTangentAtDistance, lighting.js's overflowLight, main.js's
// integration pass) keeps calling these with the same distance values as before; only the
// internal math changed from "(0,0,-dist)" to "sample the curve at the arc-length corresponding
// to dist, offset by how far along the WHOLE curve the fall-in itself already consumed."
// ---------------------------------------------------------------------------------------------

const AXIS_EYE_Y = 0; // the vortex has no floor to be "at eye height" above; the axis runs through
                       // the flow field's own centerline, camera drift/eyeHeight math lives in
                       // camera.js's perturbation layer, not in this module's base position.
const FORWARD = new THREE.Vector3(0, 0, -1); // the ORIGINAL fixed travel direction — kept as the
                                              // straight-axis seed geometry PATH.waypointOffsets'
                                              // lateralX/verticalY offsets are authored relative
                                              // to (per config.js's own comment: "waypoints are
                                              // authored as lateral/vertical OFFSETS FROM THE
                                              // STRAIGHT AXIS"), and as the safe fallback tangent
                                              // before the curve has been built.
const UP = new THREE.Vector3(0, 1, 0);

// Fall-in's open-void starting height above the traverse's entry point (z=0), and how far back
// along +Z it starts so the fall reads as dropping down-and-forward into the vortex's mouth.
// v2.1: no more held silhouette vantage — the camera starts already in motion at t=0 (state.js's
// `beat: 'drop'` initial value, no more 'silhouette' beat at all), so this is now the fall's own
// t=0 starting position, not a hand-off point from a prior static shot. Moved above
// FALL_DESCENT_DISTANCE (which needs these values) rather than duplicated as raw numbers, so the
// curve-construction math below can never silently drift out of sync with getFallInAxialPosition's
// own descent geometry.
const VOID_DROP_START_Y = 34;
const VOID_DROP_START_Z_OFFSET = 6;

// Fall-in's own straight-line descent distance (meters) — the same VOID_DROP_START_Y/Z_OFFSET
// hypotenuse guide.js's computeFallAxialPosition (and this file's own getFallInAxialPosition
// below) lerp across. This is how far along the WHOLE authored curve the fall-in phase consumes
// before handing off to dist=0 (the traverse's entry point) — i.e. the fixed offset between
// axisPointAt's own "dist" parameter (traverse-entry-relative) and the curve's own arc-length
// parametrization (fall-in-start-relative). Computed once from the same constants
// getFallInAxialPosition already uses, so it can never drift out of sync with the actual fall
// geometry those functions author.
const FALL_DESCENT_DISTANCE = Math.hypot(VOID_DROP_START_Y, VOID_DROP_START_Z_OFFSET);

// How far past OVERFLOW_LIGHT_DISTANCE the curve's own authored length should reach — matches
// PATH.waypointOffsets' atFraction:1.0 waypoint ("return's far end (past the overflow light)"),
// giving getPointAt/getTangentAt a little headroom past CAMERA_APPROACH_DISTANCE so the curve
// never has to extrapolate past its own u=1 end for any dist this module actually queries.
const RETURN_CURVE_MARGIN = 4;

/**
 * The straight-axis SEED point at arc-length `s` (meters from the very start of the fall, i.e.
 * curve-relative, NOT axisPointAt's own traverse-entry-relative `dist`) — this is the geometry
 * PATH.waypointOffsets' lateralX/verticalY are authored as offsets from (config.js's own comment:
 * "converted... by applying lateralX/verticalY as offsets from the existing straight-axis
 * positions at that fraction of the total authored length"). Used ONLY at curve-construction time
 * below, never per-frame — once the CatmullRomCurve3 is built, axisPointAt/axisTangentAt sample
 * IT, not this straight-line helper, which is precisely what replaces the old dead-straight path.
 */
function straightAxisSeedPointAt(s, out = new THREE.Vector3()) {
  return out.set(0, AXIS_EYE_Y, -(s - FALL_DESCENT_DISTANCE));
}

// ---------------------------------------------------------------------------------------------
// Lazily-built, cached CatmullRomCurve3 + its measured length. Built once on first use (not at
// module-load time, so config.js's PATH is guaranteed fully initialized first) and never rebuilt
// per-frame — ARCHITECTURE.md's explicit instruction ("cache the curve/its length once, don't
// rebuild it every frame").
// ---------------------------------------------------------------------------------------------

let _travelCurve = null;
let _travelCurveLength = 0;

const _seedBase = new THREE.Vector3();
const _lateralOffset = new THREE.Vector3();
const _verticalOffset = new THREE.Vector3();

function buildTravelCurve() {
  // NOTE: OVERFLOW_LIGHT_DISTANCE is declared further down this module (as an export, alongside
  // CAMERA_APPROACH_DISTANCE) — safe to reference here because this function only ever RUNS
  // lazily, on first ensureTravelCurve() call (well after the whole module has finished
  // evaluating), never at module-load time itself.
  const totalAuthoredLength = FALL_DESCENT_DISTANCE + VORTEX.travelSpan + OVERFLOW_LIGHT_DISTANCE + RETURN_CURVE_MARGIN;

  // MODULE-BOUNDARY CONTINUITY FIX (found while integrating this change, per ARCHITECTURE.md's
  // explicit "check every caller" instruction): axisPointAt's own `dist` parameter is
  // TRAVERSE-ENTRY-RELATIVE (dist=0 == the traverse's entry point), which corresponds to
  // arc-length `FALL_DESCENT_DISTANCE` on this curve, i.e. u = FALL_DESCENT_DISTANCE /
  // totalAuthoredLength — NOT exactly u=0 (the fall's own absolute start) and NOT exactly the
  // authored atFraction:0.12 waypoint either (that waypoint is merely "near" the traverse start,
  // per its own comment "early traverse"). Two things this module does NOT own still assume
  // axisPointAt(0)/getFallInAxialPosition's own lerp TARGET is exactly world-origin-on-the-
  // straight-axis (0, 0, 0): guide.js's independent, self-contained fall-in math (its own local
  // axisPointAt(0), which this module deliberately does not import — see this module's header
  // comment on why) lerps from the void-drop start down to a literal (0,0,0), and this module's
  // OWN getFallInAxialPosition below does the same via axisPointAt(0). If the curve's own u for
  // dist=0 landed on an already-offset stretch of the spline (which it would, using only the
  // hand-authored waypoints above — that u sits between the 0.0 and 0.12 waypoints, and the 0.12
  // waypoint already carries a +3.5m lateral offset), the fall would visibly land somewhere other
  // than where it's constructed to end, producing a real position pop at the exact fall->traverse
  // handoff. Fixed by inserting one synthetic, zero-offset waypoint at EXACTLY this fraction, so
  // the curve is guaranteed to pass through the true straight-axis point (0,0,0) right at dist=0,
  // regardless of how the neighboring hand-authored waypoints shape the curve on either side of it.
  const traverseEntryFraction = THREE.MathUtils.clamp(FALL_DESCENT_DISTANCE / totalAuthoredLength, 0, 1);

  const authoredWaypoints = [...(PATH.waypointOffsets ?? [])];
  const hasExactEntryWaypoint = authoredWaypoints.some(
    (wp) => Math.abs(wp.atFraction - traverseEntryFraction) < 1e-6
  );
  if (!hasExactEntryWaypoint) {
    authoredWaypoints.push({ atFraction: traverseEntryFraction, lateralX: 0, verticalY: 0 });
  }
  authoredWaypoints.sort((a, b) => a.atFraction - b.atFraction);

  const waypoints = authoredWaypoints.map((wp) => {
    const s = THREE.MathUtils.clamp(wp.atFraction, 0, 1) * totalAuthoredLength;
    straightAxisSeedPointAt(s, _seedBase);
    // Offsets are authored relative to the STRAIGHT axis (config.js's own comment) — world X for
    // lateral, world Y for vertical, matching the straight axis's own fixed orientation. This is
    // seed geometry only (curve-construction time); runtime lateral placement for scenery that
    // needs to stay correct AS THE TANGENT VARIES (companion orbs, below) uses a proper
    // tangent-derived local frame instead, never this world-X/Y assumption.
    _lateralOffset.set(wp.lateralX ?? 0, 0, 0);
    _verticalOffset.set(0, wp.verticalY ?? 0, 0);
    return new THREE.Vector3().copy(_seedBase).add(_lateralOffset).add(_verticalOffset);
  });

  // Fallback: if PATH.waypointOffsets is ever empty/malformed, degrade to a two-point straight
  // line spanning the same authored length rather than throwing — CatmullRomCurve3 needs at least
  // 2 points, and this keeps the "guaranteed resolution, never a failure state" contract even in
  // that defensive edge case.
  if (waypoints.length < 2) {
    waypoints.length = 0;
    waypoints.push(straightAxisSeedPointAt(0, new THREE.Vector3()));
    waypoints.push(straightAxisSeedPointAt(totalAuthoredLength, new THREE.Vector3()));
  }

  const curve = new THREE.CatmullRomCurve3(
    waypoints,
    false, // not closed — one unicursal path, matching the "guaranteed resolution" non-negotiable
    'catmullrom',
    PATH.curveTension ?? 0.35
  );
  return curve;
}

function ensureTravelCurve() {
  if (_travelCurve) return _travelCurve;
  _travelCurve = buildTravelCurve();
  // getLength() internally caches its own arc-length lookup table on the curve instance, but the
  // TOTAL length itself is still worth caching at this module's level too (ARCHITECTURE.md's
  // explicit instruction) so hot per-frame callers (axisPointAt/axisTangentAt, called many times a
  // frame across streaks/companions/seeking-orbs) never re-trigger that internal recompute check.
  _travelCurveLength = _travelCurve.getLength();
  return _travelCurve;
}

const _curvePointScratch = new THREE.Vector3();
const _curveTangentScratch = new THREE.Vector3();

/**
 * World-space point at arc-length distance `dist` (meters) along the travel axis, where dist=0 is
 * the TRAVERSE'S ENTRY POINT (unchanged v2.2 contract — see this section's header comment) —
 * internally converts to the curve's own fall-in-start-relative arc-length and samples via
 * getPointAt's normalized-u interface (u = arcLength / curve.getLength()), per ARCHITECTURE.md's
 * explicit guidance to use getPointAt/getTangentAt + a cached getLength() rather than raw
 * (0,0,-dist) math.
 */
function axisPointAt(dist, out = new THREE.Vector3()) {
  const curve = ensureTravelCurve();
  const arcLength = FALL_DESCENT_DISTANCE + dist;
  const u = THREE.MathUtils.clamp(arcLength / Math.max(_travelCurveLength, 1e-6), 0, 1);
  const point = curve.getPointAt(u, _curvePointScratch);
  return out.copy(point);
}

/** Tangent (unit vector) at the same arc-length distance `dist` axisPointAt uses — now genuinely
 * varies along the curve instead of always returning the constant FORWARD. */
function axisTangentAt(dist, out = new THREE.Vector3()) {
  const curve = ensureTravelCurve();
  const arcLength = FALL_DESCENT_DISTANCE + dist;
  const u = THREE.MathUtils.clamp(arcLength / Math.max(_travelCurveLength, 1e-6), 0, 1);
  const tangent = curve.getTangentAt(u, _curveTangentScratch);
  if (tangent.lengthSq() < 1e-8) return out.copy(FORWARD);
  return out.copy(tangent).normalize();
}

// The Act III overflow light sits this far PAST the traverse's end point (z = -VORTEX.travelSpan),
// along the travel axis — i.e. this is a relative distance, matching the exact convention v1's
// corridor.js used for its own OVERFLOW_LIGHT_DISTANCE ("meters the overflow light source sits
// past the spline's end"), not an absolute distance from the origin. "keep a floor gap" lesson
// (ARCHITECTURE.md / old corridor.js's CAMERA_APPROACH_DISTANCE comment): the camera's own
// terminal position must NOT converge to the exact same point as the light, or camera-to-light
// distance hits literal 0 at the end of the timeline, which under Three.js's physically-correct
// inverse-square PointLight falloff produces an actual Infinity/NaN illuminance rather than a
// controlled "slightly overexposed whiteout". lighting.js imports OVERFLOW_LIGHT_DISTANCE (and
// adds it to the traverse-end point it already knows, e.g. via getAxisPositionAtDistance) to
// place its overflowLight; CAMERA_APPROACH_DISTANCE is the camera's own terminal distance past
// the same traverse-end point, permanently short of it by the same 1.5m floor gap corridor.js used.
export const OVERFLOW_LIGHT_DISTANCE = 14; // meters past traverse-end, same value corridor.js used
export const CAMERA_APPROACH_DISTANCE = OVERFLOW_LIGHT_DISTANCE - 1.5;

// How far the "Turn" hold beat is allowed to creep forward before Approach's own ease-out takes
// over — a small fraction of the full return distance so Turn genuinely reads as "slows almost
// to stop" rather than covering meaningful ground (same ratio corridor.js used).
const TURN_HOLD_DISTANCE = CAMERA_APPROACH_DISTANCE * 0.12;

// ---------------------------------------------------------------------------------------------
// getFallInAxialPosition(clockTime)
//
// v2.2: the SINGLE source of truth for "where is the thing moving through the fall-in void at
// this clockTime" — this used to be vortex.js's own camera math directly; now it's the orb's
// position (guide.js drives the orb from this), and the camera derives its own position FROM the
// orb via the chase-cam formula below. Exported as a pure function (no orb/camera coupling) so
// guide.js can import it directly (guide.js -> vortex.js is a one-way dependency, NOT the
// circular one ARCHITECTURE.md warns about — the circularity that must be avoided is specifically
// vortex.js needing the orb's *resolved* per-frame position, which is solved by main.js passing it
// in as a parameter to getCameraRigPosition below, not by this module importing guide.js).
// ---------------------------------------------------------------------------------------------

const _fallPosEntry = new THREE.Vector3();
const _fallPosStart = new THREE.Vector3();

// v2.4 FIX (cinematographer review): the widened `drop` beat (0.6s -> 1.1s, to hold the new
// room/TV cold-open long enough to read) exposed a bug that pre-dates this round but was
// previously too small to notice — `fallInEasedProgress` below eases the ENTIRE fall-in span
// (drop+freefall+catch) with a single curve, and the old `Math.pow(fallT, 4)` (matching
// EASE.drop's power4.in *quality*, never actually driven through GSAP's own easing function here)
// is so extreme that `drop`'s own then-widened window sat on the dead-flat opening of the curve —
// the camera barely moved at all for the whole time the room/TV cold-open was on screen, which
// read as a held shot / fade, not "the camera is already pushing forward... one continuous push
// into the fall" (CONCEPT.md v2.4 item 1, ARCHITECTURE.md item 1 verbatim). Fixed by softening the
// exponent from 4 to 2: still a genuine, clearly front-loaded ease-in, but with real, visible
// motion during the room-scene's own beat instead of a near-frozen frame.
//
// v2.5 STALE-COMMENT NOTE (kinetic/motion review): the paragraph above described v2.4's own
// widened timings (drop 0.6s->1.1s, fall span "0..3.7s", fallT~0.297/~8.8% distance covered by
// drop's end, ~53% by freefall's end) — those numbers are now stale prose, since v2.5 reverted
// `BEATS.drop`/`freefall`/`catch` back to their pre-v2.4 values (config.js; the room/TV cold-open
// itself is gone, replaced by VISION_ENCOUNTER inside the traverse). The function's own math below
// (`fallSpan = BEATS.catch.end - BEATS.drop.start`) reads live from config.js and self-corrects —
// it was never actually broken by the revert — but for anyone reading this comment against the
// CURRENT authored values: fall span is 3.2s, fallT reaches ~0.1875 by drop's end (~3.5% of the
// fall's distance covered), ~47% by freefall's end. Deliberately NOT touching config.js's
// BEATS/EASE (do not modify) — this is a change to how this module's OWN internal easing curve is
// shaped, not to the authored beat durations or the GSAP-driven EASE.drop string used elsewhere
// (director.js's screen-shake/title tweens), which stay exactly as authored.
//
// Factored into one shared helper (was previously duplicated verbatim, with the same exponent, at
// resolveTravelArcLength's own fall-in branch further down this file) so the two can never drift
// out of sync again — exactly the "single source of truth" discipline ARCHITECTURE.md's "do not
// touch" section already demands for this exact quantity (state.vortex.travelSpeed's underlying
// arc-length derivation).
// v2.20 — second half of the "shaky opening" fix, and a genuine fidelity bug against CONCEPT.md.
//
// This was `Math.pow(fallT, 2)`, whose derivative at t=0 is exactly ZERO — the camera does not
// move at all for the first fraction of a second. Meanwhile director.js is already ramping
// `state.camera.rollDeg` in from frame one. A stationary frame with a rotation applied to it does
// not read as "falling"; it reads as wobbling in place, which is the other half of what was
// reported as shakiness (the 317ms asset hitch, fixed in vision.js, was the first half).
//
// It also contradicted the spec this beat is built on. CONCEPT.md Section 3 is explicit: "motion
// is continuous from t=0. The felt goal is 'immediate,' not 'eventually gets going'." A pure
// square curve is precisely "eventually gets going."
//
// Now a blend: a real non-zero initial velocity (the 0.25 linear term) that still accelerates hard
// into the fall (the 0.75 quadratic term), reaching exactly 1.0 at the end of `catch` as before.
// The drop still "takes over" — it just no longer begins from a dead stop while the camera rolls.
// NOTE this is the single source of truth for fall-in motion: getFallInAxialPosition AND
// resolveTravelArcLength's fall-in branch both derive from it, so both stay consistent by
// construction (see this file's own note on why that consolidation exists).
function fallInEasedProgress(clockTime) {
  const fallSpan = BEATS.catch.end - BEATS.drop.start;
  const fallT = THREE.MathUtils.clamp((clockTime - BEATS.drop.start) / fallSpan, 0, 1);
  return 0.25 * fallT + 0.75 * fallT * fallT;
}

export function getFallInAxialPosition(clockTime, out = new THREE.Vector3()) {
  const eased = fallInEasedProgress(clockTime);

  // v2.3 FIX (cinematographer review): `entry` must be a scratch vector distinct from `out` —
  // axisPointAt(0, out) previously aliased entry to the same object as out, so the subsequent
  // out.copy(startPos) (before the lerp) silently overwrote `entry` too, making
  // startPos.lerp(entry, eased) a no-op (lerping a vector toward itself). Using a dedicated
  // scratch vector (mirroring getFallInAxialTangent's own _fallTangentEntry/_fallTangentStart
  // pattern below) restores the intended eased descent from startPos toward entry.
  const entry = axisPointAt(0, _fallPosEntry);
  const startPos = _fallPosStart.set(
    entry.x,
    entry.y + VOID_DROP_START_Y,
    entry.z + VOID_DROP_START_Z_OFFSET
  );
  return out.copy(startPos).lerp(entry, eased);
}

// v2.3 FIX (cinematographer review): guide.js used to keep its OWN self-contained copy of this
// fall-in math (a literal `out.set(0, AXIS_EYE_Y, -dist)` straight line), reasoning that
// PATH.waypointOffsets' zero-offset atFraction:0.0 entry meant the fall's own trajectory couldn't
// possibly need the curve. That's wrong: axisPointAt(0) — the fall's own ENTRY target above — now
// samples the real CatmullRomCurve3, which (per this curve's own construction) is shaped not just
// by its two immediately-neighboring waypoints but by the wider spline's tangent continuity, so
// the fall's dead-straight lerp toward `entry` was silently discarding the small but genuine
// curvature the curve already puts into this span (the entry point itself sits a few tens of
// centimeters off the old straight axis once the 0.12 waypoint's pull is felt). Exporting a real
// tangent function alongside the position one above lets guide.js delete its own straight-line
// port entirely and consume this module's curve-derived fall math directly — restoring exactly
// one source of truth for "where/which way is the fall going," per ARCHITECTURE.md's explicit
// "the curve must span fall-in's descent" instruction. Derived analytically from the same lerp
// getFallInAxialPosition uses (start -> entry, both fixed per-frame endpoints, only `eased`
// varies) rather than a numeric finite-difference, so it's exact and cheap: the instantaneous
// direction of travel is simply (entry - startPos) at this frame's clockTime, since eased is
// monotonically increasing and the two endpoints don't move within a single frame.
const _fallTangentEntry = new THREE.Vector3();
const _fallTangentStart = new THREE.Vector3();

export function getFallInAxialTangent(clockTime, out = new THREE.Vector3()) {
  void clockTime; // kept in the signature for symmetry with getFallInAxialPosition/future callers;
                   // the direction itself only depends on the (per-frame-fixed) entry/start points,
                   // not on how far along the lerp `eased` currently is.
  const entry = axisPointAt(0, _fallTangentEntry);
  _fallTangentStart.set(entry.x, entry.y + VOID_DROP_START_Y, entry.z + VOID_DROP_START_Z_OFFSET);
  const delta = out.copy(entry).sub(_fallTangentStart);
  if (delta.lengthSq() < 1e-8) return out.copy(FORWARD);
  return out.copy(delta).normalize();
}
// guide.js now imports getFallInAxialPosition/getFallInAxialTangent directly (a one-way
// dependency, NOT the circular one ARCHITECTURE.md warns about — the circularity that must be
// avoided is specifically vortex.js needing the orb's *resolved* per-frame position, which is
// solved by main.js passing it in as a parameter to getCameraRigPosition below, not by this
// module importing guide.js) rather than keeping its own straight-line port. This export is also
// kept as this module's own fallback path in getCameraRigPosition below for the rare frame where
// the orb hasn't resolved yet.

// ---------------------------------------------------------------------------------------------
// getCameraRigPosition(state, orb, dt)
//
// v2.2 signature change (ARCHITECTURE.md): for the drop/freefall/catch/traverse branches, camera
// position/lookAt are now DERIVED FROM the orb's resolved { position, tangent } (passed in by
// main.js as `orb`, having already called updateGuide() this frame) via CAMERA.chase's formula —
// cameraPos = orbPos - chase.distanceBehind * orbTangent + chase.heightAbove * UP, cameraLookAt =
// orbPos + chase.lookAheadBeyond * orbTangent. This module does NOT import guide.js — `orb` is
// just a plain { position: THREE.Vector3, tangent: THREE.Vector3 } data object, kept fully
// decoupled from however guide.js internally computes it. If `orb` isn't available yet (e.g. the
// very first frame before guide.js has run once), these branches fall back to the old
// axis-only camera path so there's never a null-reference crash — a harmless one-frame-or-less
// discrepancy, not a behavior any user could perceive.
//
// v2.4, NEW third parameter `dt` (seconds since last frame): threaded through to chaseCamFromOrb
// below so its own CAMERA.chase.followDampingSeconds exponential smoothing (the chase-cam
// follow-damping fix — see chaseCamFromOrb's header comment) is frame-rate independent, exactly
// like every other per-frame damping elsewhere in this codebase (guide.js's POSITION_DAMPING,
// camera.js's drift/bank easing). `dt` is only consumed by the drop/freefall/catch/traverse
// branches below (the ones that call chaseCamFromOrb) — the return-phase branch has no orb to
// follow and ignores this parameter entirely, exactly as it already ignored `orb`. Optional and
// defaulted defensively (see chaseCamFromOrb's own safeDt guard) so an old call site that hasn't
// been updated to pass `dt` yet degrades to "snap to raw target" rather than throwing/NaN-ing.
//
// The turn/approach/overflow/iris branches are UNCHANGED from v2.1 — there is no orb left once it
// has dissolved into the Act III overflow light (GUIDE.dissolveStartBeat === 'turn'), so camera
// position keeps deriving directly from the fixed travel axis + state.actIII.clockTime, exactly as
// before. This is deliberate: CAMERA.chase.followDampingSeconds is documented (config.js) as a
// chase-cam-only concept, and the existing Turn->Approach zero-derivative ramp-in already owns
// motion continuity for this span — layering a second, independent damping system onto a branch
// that has no orb/chase-cam relationship at all would be scope creep, not a fix, and risks
// fighting that ramp-in's own carefully-derived zero-velocity start. The two systems instead
// compose at the SEAM: main.js's traverse->turn crossfade (TURN_TRANSITION_BLEND_SECONDS) already
// captures whatever camera.position/lookAt this module's damped chase-cam output left the camera
// at the instant 'turn' begins, and blends FROM that smoothed value TOWARD this branch's own
// curve-derived 'turn' position/lookAt — so the follow-damping's smoothed exit state feeds
// directly into the existing crossfade's `from`, and the crossfade's own smoothstep handles the
// rest. No changes needed here for that composition to hold; verified by tracing main.js's
// `turnTransitionBlend` capture, which reads `camera.position.clone()` (the already-damped value)
// at the exact frame state.beat first becomes 'turn'.
// ---------------------------------------------------------------------------------------------

const _tmpAxisPos = new THREE.Vector3();
const _tmpAxisTangent = new THREE.Vector3();
const _chaseTangent = new THREE.Vector3();
const _chasePos = new THREE.Vector3();
const _chaseLookAt = new THREE.Vector3();

// v2.4, NEW — CAMERA.chase.followDampingSeconds (ARCHITECTURE.md's dedicated "chase-cam
// follow-damping" section, the mechanical fix for "it feels like the orb is guiding me, it feels
// like the orb is 'me'"). Before this, chaseCamFromOrb's raw output (the orb's resolved position
// +/- the fixed distanceBehind/heightAbove/lookAheadBeyond offset) was copied onto camera.position/
// lookAt VERBATIM every frame by main.js — zero smoothing of its own, so any bob/weave already
// damped into the orb's OWN motion (guide.js's POSITION_DAMPING) was nonetheless mirrored
// instantly and identically by the camera, which is mechanically indistinguishable from "the
// camera IS the orb wearing a costume." A camera that is genuinely FOLLOWING something always
// lags slightly behind its subject's exact motion — that lag is what "following" kinematically
// means. Fixed by adding a SECOND, independent exponential-smoothing step here, layered ON TOP OF
// the existing offset math (not replacing it): chaseCamFromOrb still computes the same raw target
// position/lookAt from the orb's position/tangent per CAMERA.chase's formula, exactly as before;
// this module-level smoothed state then eases toward that raw target every frame at its own
// time-constant, and IT is what gets returned/rendered.
//
// Persisted at module scope (not per-call scratch) because it must carry real inertia across
// frames — a fresh Vector3 every call would have nothing to ease FROM. `_chaseSmoothedReady`
// tracks whether it's holding a real previous-frame value yet, mirroring guide.js's own
// `tangentInitialized` "skip damping on the very first resolved frame, snap instead" discipline
// for the identical reason: don't ease in from an arbitrary/zero seed.
const _chaseSmoothedPos = new THREE.Vector3();
const _chaseSmoothedLookAt = new THREE.Vector3();
let _chaseSmoothedReady = false;

/** Derives the chase-cam position/lookAt from the orb's resolved position/tangent, per
 * CAMERA.chase's formula — shared by every fall-in/traverse branch below. `dt` (seconds) drives
 * this module's own exponential follow-damping (CAMERA.chase.followDampingSeconds), applied ON
 * TOP OF the raw distanceBehind/heightAbove/lookAheadBeyond offset below, per ARCHITECTURE.md's
 * chase-cam follow-damping contract — this is an additional smoothing layer, not a replacement
 * for the offset math. */
function chaseCamFromOrb(orbPosition, orbTangent, dt) {
  const tangent = _chaseTangent.copy(orbTangent).normalize();
  const rawPosition = _chasePos
    .copy(orbPosition)
    .addScaledVector(tangent, -CAMERA.chase.distanceBehind)
    .addScaledVector(UP, CAMERA.chase.heightAbove);
  const rawLookAt = _chaseLookAt.copy(orbPosition).addScaledVector(tangent, CAMERA.chase.lookAheadBeyond);

  if (!_chaseSmoothedReady) {
    // First resolved frame — snap directly onto the raw target rather than easing in from a
    // zero/stale seed, same rule guide.js's own tangentInitialized branch follows.
    _chaseSmoothedPos.copy(rawPosition);
    _chaseSmoothedLookAt.copy(rawLookAt);
    _chaseSmoothedReady = true;
  } else {
    // Exponential smoothing toward the raw target, time-constant CAMERA.chase.followDampingSeconds
    // — frame-rate independent (1 - e^(-dt/tau)) rather than a fixed per-frame lerp factor, the
    // same shape guide.js's own POSITION_DAMPING uses (there expressed as a rate; here as a
    // time-constant, per config.js's own "seconds" comment on followDampingSeconds). A non-finite
    // or non-positive dt (e.g. a stalled first frame) simply leaves the smoothed value unchanged
    // rather than dividing/NaN-ing.
    const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
    const followT = 1 - Math.exp(-safeDt / CAMERA.chase.followDampingSeconds);
    _chaseSmoothedPos.lerp(rawPosition, followT);
    _chaseSmoothedLookAt.lerp(rawLookAt, followT);
  }

  return { position: _chaseSmoothedPos.clone(), lookAt: _chaseSmoothedLookAt.clone() };
}

function hasResolvedOrb(orb) {
  return !!(orb && orb.position && orb.tangent);
}

/** Resolves the orb's { position, tangent } for this frame — prefers the explicit `orb` parameter
 * (ARCHITECTURE.md's contract: main.js calls updateGuide() first, then passes the orb's resolved
 * position/tangent in here as parameters), falling back to reading state.guide.position/tangent
 * directly (the same two fields guide.js is the sole WRITER of every frame, per its own
 * module-boundary contract) if the caller hasn't been updated to pass `orb` explicitly yet. Either
 * path reads plain data off `state`/a parameter — never imports guide.js itself, so this can never
 * reintroduce the vortex.js<->guide.js circular-import hazard ARCHITECTURE.md warns about. */
function resolveOrb(state, orb) {
  if (hasResolvedOrb(orb)) return orb;
  if (hasResolvedOrb(state.guide)) return state.guide;
  return null;
}

export function getCameraRigPosition(state, orb, dt) {
  const beat = state.beat;
  const resolvedOrb = resolveOrb(state, orb);

  // --- Fall-in phase: drop / freefall / catch, chase-cam behind the orb -----------------------
  // v2.2: the orb's position (guide.js owns the fall-in axial math now — see this module's
  // header comment) drives where the camera goes — this branch no longer computes the fall
  // trajectory itself, it only derives the chase-cam offset from wherever guide.js has already
  // placed the orb this frame.
  if (beat === 'drop' || beat === 'freefall' || beat === 'catch') {
    if (resolvedOrb) {
      return chaseCamFromOrb(resolvedOrb.position, resolvedOrb.tangent, dt);
    }
    // Fallback (orb not resolved yet, e.g. the very first frame) — old axis-only fall math, kept
    // so this never throws/produces NaN while guide.js spins up.
    const position = getFallInAxialPosition(state.clockTime, _tmpAxisPos.clone());
    const tangent = axisTangentAt(0, _tmpAxisTangent);
    const lookAt = position.clone().add(tangent);
    return { position, lookAt };
  }

  // --- Traverse phase: chase-cam behind the orb, orb driven by state.traverse.progress ---------
  if (beat === 'traverse') {
    if (resolvedOrb) {
      return chaseCamFromOrb(resolvedOrb.position, resolvedOrb.tangent, dt);
    }
    // Fallback — same axis-only math v2.1 used, in case the orb hasn't resolved yet this frame.
    const progress = THREE.MathUtils.clamp(state.traverse?.progress ?? 0, 0, 1);
    const dist = progress * VORTEX.travelSpan;
    const position = axisPointAt(dist, _tmpAxisPos.clone());
    const tangent = axisTangentAt(dist, _tmpAxisTangent);
    const lookAt = position.clone().add(tangent);
    return { position, lookAt };
  }

  // --- Return phase: turn / approach / overflow / iris, driven by state.actIII.clockTime ------
  // v2.3 FIX (kinetic/motion review): this branch used to be commented "UNCHANGED from v2.1" and
  // computed camera position via straight-line tangent extrapolation from a single fixed point
  // (traverseEnd + eased*distance*tangent), never resampling the new CatmullRomCurve3 — even
  // though PATH.waypointOffsets authors genuine curvature in exactly this span (the atFraction:0.94
  // waypoint carries a non-zero verticalY distinct from its neighbors) and the streak field /
  // companion orbs already correctly resample the curve here via resolveTravelArcLength. That left
  // the camera flying a straight line through a visibly bending tunnel during the return phase —
  // directly contradicting CONCEPT.md v2.3 item 2's "the return phase is a continuation of the
  // same path, not a different path starting." Fixed by computing the SAME eased arc-length
  // distance past VORTEX.travelSpan as before (the easing curves themselves are untouched — this
  // is purely a straight-line-vs-curve fix, not a re-tune of the return's timing/feel), then
  // sampling axisPointAt/axisTangentAt at that arc-length every frame, exactly like every other
  // per-frame consumer of this module's curve. No orb to follow anymore (it has dissolved into the
  // overflow light by the time 'turn' begins), so the camera still positions itself against the
  // axis directly — just the curved axis now, not a straight-line extrapolation from one fixed
  // sample. Accumulate BEATS[key].duration exactly the way state.js's updateBeat() does, so this
  // stays in lockstep with whichever sub-beat state.beat/state.beatProgress already resolved to
  // this frame, rather than re-deriving it from a slightly different accumulation.
  const t = state.actIII?.clockTime ?? 0;
  let acc = 0;
  for (const key of ['turn', 'approach', 'overflow', 'iris']) {
    acc += BEATS[key].duration;
    if (key === beat) break;
  }
  // acc now equals the elapsed-duration total up to and including the current sub-beat; back out
  // how far into the *whole return phase* we are by combining it with the fraction already
  // consumed of the current sub-beat (state.beatProgress), so position stays continuous across
  // sub-beat boundaries instead of snapping.
  const currentDuration = BEATS[beat]?.duration ?? 1;
  const elapsedIntoReturn = acc - currentDuration + (state.beatProgress ?? 0) * currentDuration;
  const returnSpan =
    BEATS.turn.duration + BEATS.approach.duration + BEATS.overflow.duration + BEATS.iris.duration;
  const returnT = THREE.MathUtils.clamp(elapsedIntoReturn / returnSpan, 0, 1);
  void returnT; // kept for parity with v2.1 (not currently consumed further in this branch)

  if (beat === 'turn') {
    // A held beat: camera slows almost to a stop, creeping forward only a small fraction of the
    // remaining approach distance (TURN_HOLD_DISTANCE) — mirrors corridor.js's original Turn
    // branch, same "held, not the fastest-moving moment of Act III" rationale. v2.3: the resulting
    // arc-length is now sampled against the curve (axisPointAt/axisTangentAt), not extrapolated in
    // a straight line from a single fixed traverseEnd/tangent pair.
    const turnT = THREE.MathUtils.clamp(state.beatProgress ?? 0, 0, 1);
    const eased = 1 - Math.pow(1 - turnT, 2); // fast-decaying velocity, essentially stopped by end
    const dist = VORTEX.travelSpan + eased * TURN_HOLD_DISTANCE;
    const position = axisPointAt(dist, new THREE.Vector3());
    const tangent = axisTangentAt(dist, new THREE.Vector3());
    const lookAt = position.clone().addScaledVector(tangent, 1);
    return { position, lookAt };
  }

  // approach / overflow / iris: continue past TURN_HOLD_DISTANCE with a fresh power2.out
  // deceleration curve (EASE.overflow) spanning the remainder of the return phase, toward
  // CAMERA_APPROACH_DISTANCE — never all the way to OVERFLOW_LIGHT_DISTANCE, preserving the
  // floor-gap lesson above.
  //
  // VELOCITY-CONTINUITY FIX: `Turn`'s own curve (1-(1-t)^2) correctly decelerates to ~zero
  // velocity by its end (a real "held" stop) — but a raw 1-(1-t)^2 restarted at t=0 for this tail
  // has a NON-zero derivative at its own start (d/dt[1-(1-t)^2] at t=0 is 2, not 0), so even in
  // the idealized case of Turn ending in a perfect stop, this tail used to kick off with an
  // instant jerk rather than picking up smoothly from rest — a real, provable discontinuity in
  // the authored easing composition itself (found via a direct derivative check), not a
  // scroll-speed edge case. Fixed by multiplying the existing power2.out shape by a fast
  // zero-derivative-at-0 ramp (`rampIn^2`) over the tail's first 15% — this forces the combined
  // curve's velocity to start genuinely at zero and rise smoothly into the same power2.out shape
  // CONCEPT.md's "ease-out deceleration begins" calls for, without changing the overall
  // distance/duration or the curve's character for the other 85% of the tail. (This easing math is
  // untouched by the v2.3 curve fix above — only the arc-length it produces is now sampled against
  // the curve instead of extrapolated in a straight line.)
  const tailSpan =
    (BEATS.turn.duration + BEATS.approach.duration + BEATS.overflow.duration + BEATS.iris.duration) -
    BEATS.turn.duration;
  const tailElapsed = Math.max(0, elapsedIntoReturn - BEATS.turn.duration);
  const tailT = THREE.MathUtils.clamp(tailElapsed / tailSpan, 0, 1);
  const easedBase = 1 - Math.pow(1 - tailT, 2);
  const rampIn = Math.min(1, tailT / 0.15);
  const eased = easedBase * rampIn * rampIn;

  const remainingDistance = CAMERA_APPROACH_DISTANCE - TURN_HOLD_DISTANCE;
  const dist = VORTEX.travelSpan + TURN_HOLD_DISTANCE + eased * remainingDistance;
  const position = axisPointAt(dist, new THREE.Vector3());
  const tangent = axisTangentAt(dist, new THREE.Vector3());
  const lookAt = position.clone().addScaledVector(tangent, 1);
  return { position, lookAt };
}

// ---------------------------------------------------------------------------------------------
// Travel-axis accessor for seeking-orbs.js/guide.js/vision.js (and anything else that wants to
// place scenery along the same fixed path) — mirrors v1 corridor.js's getCorridorCurve() export
// pattern (a curve-like object exposing getPointAt(t)/getTangentAt(t) over its own local [0,1]
// parametrization), so each consumer's placement pattern (point/tangent lookups, axis-normal
// offsets) needs only a data-source swap, not a rewrite. `t` here is normalized 0..1 across the
// traverse span only (VORTEX.travelSpan meters) — the same span seeking-orb encounters are
// placed within per SEEKING_ORBS.count. guide.js uses this same accessor for its own
// traverse-phase axial positioning (state.traverse.progress -> getPointAt/getTangentAt), per
// ARCHITECTURE.md.
// ---------------------------------------------------------------------------------------------

export function getVortexAxis() {
  return {
    getPointAt(t, out = new THREE.Vector3()) {
      const dist = THREE.MathUtils.clamp(t, 0, 1) * VORTEX.travelSpan;
      return axisPointAt(dist, out);
    },
    getTangentAt(t, out = new THREE.Vector3()) {
      const dist = THREE.MathUtils.clamp(t, 0, 1) * VORTEX.travelSpan;
      return axisTangentAt(dist, out);
    },
  };
}

/** Raw arc-length (meters) -> {position, tangent} accessor, for callers that want real distances
 * along the axis (e.g. lighting.js positioning the overflow light at OVERFLOW_LIGHT_DISTANCE)
 * rather than the [0,1]-normalized traverse-span parametrization getVortexAxis() exposes. */
export function getAxisPositionAtDistance(dist, out = new THREE.Vector3()) {
  return axisPointAt(dist, out);
}

export function getAxisTangentAtDistance(dist, out = new THREE.Vector3()) {
  return axisTangentAt(dist, out);
}

// ---------------------------------------------------------------------------------------------
// resolveTravelArcLength(state) — v2.3, new.
//
// Every per-frame consumer below (streak recycling/twist, companion-orb recycling/regional
// lookups, the travelSpeed cue) used to back-solve "how far along the axis has the camera
// travelled" from `-camera.position.z` alone — a proxy that only worked because the OLD axis was
// literally the world Z line, so raw camera Z was numerically identical to arc-length distance.
// Now that the axis is a curved path (this module's own v2.3 change), camera.position.z is just
// one component of a 3D point that also moves in X/Y as the curve banks/dips — using it as an
// arc-length proxy would silently desync streak recycling/regional-profile lookups/companion
// placement from where the camera has actually travelled along the curve (a real module-boundary
// bug this file would be introducing against ITSELF, not just another module, if left as-is).
// Fixed by deriving arc-length the same authoritative way getCameraRigPosition already does per
// beat (state.beat / state.traverse.progress / state.actIII.clockTime), never from the rendered
// camera.position — this is the single source of truth every other per-frame lookup in this file
// now goes through.
// ---------------------------------------------------------------------------------------------

function resolveTravelArcLength(state) {
  const beat = state.beat;

  if (beat === 'drop' || beat === 'freefall' || beat === 'catch') {
    // Fall-in hasn't reached the traverse's entry point (dist=0) yet — express its progress as a
    // negative arc-length (still meaningful to axisPointAt/axisTangentAt, which simply add
    // FALL_DESCENT_DISTANCE before normalizing), consistent with getFallInAxialPosition's own
    // eased 0..1 fall fraction.
    // v2.4 FIX: was a second, independently-hand-copied `Math.pow(fallT, 4)` — now calls the same
    // fallInEasedProgress() helper getFallInAxialPosition uses, so these two can never drift back
    // out of sync (see that helper's own header comment for the full fix rationale).
    const eased = fallInEasedProgress(state.clockTime ?? 0);
    return THREE.MathUtils.lerp(-FALL_DESCENT_DISTANCE, 0, eased);
  }

  if (beat === 'traverse') {
    const progress = THREE.MathUtils.clamp(state.traverse?.progress ?? 0, 0, 1);
    return progress * VORTEX.travelSpan;
  }

  // Return phase (turn/approach/overflow/iris): mirror getCameraRigPosition's own accumulation of
  // BEATS[key].duration so this stays in lockstep with whichever sub-beat is current, rather than
  // re-deriving it from a slightly different accumulation.
  const t = state.actIII?.clockTime ?? 0;
  let acc = 0;
  for (const key of ['turn', 'approach', 'overflow', 'iris']) {
    acc += BEATS[key].duration;
    if (key === beat) break;
  }
  const currentDuration = BEATS[beat]?.duration ?? 1;
  const elapsedIntoReturn = acc - currentDuration + (state.beatProgress ?? 0) * currentDuration;

  if (beat === 'turn') {
    const turnT = THREE.MathUtils.clamp(state.beatProgress ?? 0, 0, 1);
    const eased = 1 - Math.pow(1 - turnT, 2);
    return VORTEX.travelSpan + eased * TURN_HOLD_DISTANCE;
  }

  const tailSpan =
    (BEATS.turn.duration + BEATS.approach.duration + BEATS.overflow.duration + BEATS.iris.duration) -
    BEATS.turn.duration;
  const tailElapsed = Math.max(0, elapsedIntoReturn - BEATS.turn.duration);
  const tailT = THREE.MathUtils.clamp(tailElapsed / tailSpan, 0, 1);
  const easedBase = 1 - Math.pow(1 - tailT, 2);
  const rampIn = Math.min(1, tailT / 0.15);
  const eased = easedBase * rampIn * rampIn;
  const remainingDistance = CAMERA_APPROACH_DISTANCE - TURN_HOLD_DISTANCE;
  return VORTEX.travelSpan + TURN_HOLD_DISTANCE + eased * remainingDistance;
}

// ---------------------------------------------------------------------------------------------
// Local-frame helper for anything that needs to place scenery OFF the curve (companion orbs,
// the streak field's radial cross-section) — v2.3, new. Prior versions assumed world-X was always
// "sideways" and world-Y was always "up" because the axis was a fixed (0,0,-1) line; now that the
// tangent varies continuously along the curve, lateral/vertical placement must be derived from the
// CURRENT tangent at the point in question, not a fixed world axis. `right = tangent x WORLD_UP`
// (falls back to world X if the tangent is ever exactly parallel to WORLD_UP, an edge case this
// curve's own gentle authored waypoints never actually reach, but guarded defensively so this can
// never divide-by-zero/produce NaN), `up = right x tangent` completes an orthonormal frame that
// rotates smoothly with the curve instead of a world-locked assumption.
// ---------------------------------------------------------------------------------------------

const _frameRight = new THREE.Vector3();
const _frameUp = new THREE.Vector3();
const WORLD_UP_FALLBACK = new THREE.Vector3(1, 0, 0);

/** Fills `rightOut`/`upOut` with an orthonormal local frame perpendicular to `tangent` — the
 * "which way is sideways/up" answer at this specific point on the curve, per this section's
 * header comment. Returns `rightOut` for convenient chaining. */
function localFrameFromTangent(tangent, rightOut, upOut) {
  rightOut.crossVectors(tangent, UP);
  if (rightOut.lengthSq() < 1e-8) {
    // Tangent momentarily parallel to world-up (never happens with this curve's gentle authored
    // waypoints, but guarded so a future, more extreme PATH can't silently NaN this module) — fall
    // back to a fixed world-X-ish right vector instead of leaving a zero-length vector to normalize.
    rightOut.crossVectors(tangent, WORLD_UP_FALLBACK);
  }
  rightOut.normalize();
  upOut.crossVectors(rightOut, tangent).normalize();
  return rightOut;
}

// ---------------------------------------------------------------------------------------------
// Regional visual variety (v2.1, new — CONCEPT.md v2.1 Section 2/4, "the journey needs to be more
// interesting"). Gentle density/brightness/hue-temperature variation tied to REAL travel-axis
// position, not per-frame randomness, so the same stretch of the traverse always reads the same
// way on a repeat visit — "regions" of the void rather than one undifferentiated tunnel.
//
// Anchored on the same SEEKING_ORBS.count parametric positions seeking-orbs.js itself places its
// orb-cluster encounters at (evenly spaced within a margin, see seeking-orbs.js's
// encounterParamPositions) plus the midpoints between them, which double as loose "companion orb
// cluster" markers — CONCEPT.md's "denser/warmer-leaning near a seeking-orb or companion-orb
// encounter, sparser/cooler in the stretches between" is expressed as a smooth (never
// sharp-edged) falloff around each of those anchor points along the axis, summed together.
// Purely a function of `axialDistance`, so calling this twice with the same input always
// returns the same result — no randomness, no time input.
// ---------------------------------------------------------------------------------------------

const REGION_ANCHOR_COUNT = Math.max(1, SEEKING_ORBS.count | 0);
const REGION_ANCHORS_T = (() => {
  // Same margin/spacing convention as seeking-orbs.js's encounterParamPositions, plus one extra
  // anchor dropped exactly between each consecutive pair (the "companion orb cluster" waypoints)
  // so regional density has more than just encounter-adjacent bright spots.
  const margin = 0.12;
  const span = 1 - margin * 2;
  const primary = [];
  for (let i = 0; i < REGION_ANCHOR_COUNT; i++) {
    const t = REGION_ANCHOR_COUNT === 1 ? 0.5 : margin + (span * (i + 0.5)) / REGION_ANCHOR_COUNT;
    primary.push(t);
  }
  const anchors = [...primary];
  for (let i = 0; i + 1 < primary.length; i++) {
    anchors.push((primary[i] + primary[i + 1]) / 2);
  }
  return anchors;
})();

// How far (in normalized [0,1] travel-span units) a region's influence reaches from its anchor —
// wide enough that regions blend into each other rather than snapping, per the "gentle" contract.
const REGION_INFLUENCE_WIDTH = 0.16;

/**
 * Returns a [0,1] "regional intensity" for a given normalized travel-axis position `t`, summing
 * a smooth cosine falloff around every anchor (clamped to 1). 1 = deep inside a
 * glyph/companion-orb region (denser, warmer-leaning); 0 = the sparser/cooler stretch between
 * regions. Deterministic in `t` alone.
 */
function regionalIntensityAtT(t) {
  let intensity = 0;
  for (const anchorT of REGION_ANCHORS_T) {
    const delta = Math.abs(t - anchorT);
    if (delta >= REGION_INFLUENCE_WIDTH) continue;
    const falloff = 0.5 + 0.5 * Math.cos((delta / REGION_INFLUENCE_WIDTH) * Math.PI); // 1 at center, 0 at edge
    intensity = Math.max(intensity, falloff);
  }
  return THREE.MathUtils.clamp(intensity, 0, 1);
}

/**
 * Regional profile at a raw axial distance (meters) along the travel axis, normalized internally
 * against VORTEX.travelSpan. Returns { density, brightness, warmth } — all subtle multipliers/
 * offsets, kept gentle enough to never approach the single hard teal->gold pivot (non-negotiable
 * #2): warmth here only ever nudges the *existing* accent-lerp fraction, it never substitutes for
 * state.color.mixT.
 */
function regionalProfileAt(axialDistance) {
  const t = THREE.MathUtils.clamp(axialDistance / VORTEX.travelSpan, 0, 1);
  const intensity = regionalIntensityAtT(t);
  return {
    density: intensity, // 1 near a glyph/companion-orb region, 0 in the sparser stretches between
    brightness: 1 + intensity * 0.35, // gentle brighten near regions, never more than +35%
    warmth: intensity * 0.22, // gentle warm-lean near regions — a fraction, blended in ON TOP of
                               // the existing teal-accent lerp below, well short of a second pivot
  };
}

// ---------------------------------------------------------------------------------------------
// Living cycle (v2.2, new — CONCEPT.md v2.2 Section 5: "the vortex field itself now has a slow,
// continuous evolution over real elapsed time... so lingering in one place (including via
// backward scroll) never reads as a frozen loop"). A slow sine modulation of brightness/density,
// driven by state.traverse.elapsedSeconds (real wall-clock time in the traverse phase — NOT
// state.traverse.progress, which can move backward under v2.2's bidirectional scroll, and NOT a
// frozen/global clock — see this module's own frozen-clock discipline elsewhere and
// ARCHITECTURE.md's bug-class warning). Kept subtle (VORTEX.livingCycle.intensityAmplitude, 0.12
// by default) so it stays a modulation, never a second hard color pivot (non-negotiable #2).
// ---------------------------------------------------------------------------------------------

function livingCycleMultiplier(elapsedSeconds) {
  const periodSeconds = VORTEX.livingCycle?.periodSeconds ?? 22;
  const amplitude = VORTEX.livingCycle?.intensityAmplitude ?? 0.12;

  // Light-artist review (v2.2 retune): a single fixed-period/fixed-amplitude sin() is itself a
  // loop — just a longer, smaller one layered on top of the field's existing per-second pulse —
  // so a user who genuinely lingers past ~periodSeconds still sees the exact same brightness
  // cycle repeat exactly, which is definitionally the "frozen loop" this mechanic exists to cure.
  // Fix: sum the authored primary wave with two secondary sines at frequencies that share no
  // common period with it or each other (irrational-ish ratios below, not simple small-integer
  // multiples) — the combined signal's true period is the LCM of all three, which for
  // incommensurate frequencies is effectively infinite (never exactly repeats within any
  // realistic dwell time), while each individual term stays a slow, gentle, bounded sine so the
  // sum never approaches a second hard color pivot (non-negotiable #2) and never reads as noisy/
  // jittery — still smooth and continuous, just genuinely non-repeating in practice. The primary
  // term keeps VORTEX.livingCycle's authored period/amplitude as the dominant, tunable signal;
  // the secondary terms are deliberately smaller and only ever add texture on top, never
  // overwhelm it.
  const phase = (elapsedSeconds / periodSeconds) * Math.PI * 2;
  const secondaryPhase = (elapsedSeconds / (periodSeconds * 1.6180339887)) * Math.PI * 2; // golden-ratio-scaled period, shares no small-integer relationship with the primary
  const tertiaryPhase = (elapsedSeconds / (periodSeconds * 0.36787944117)) * Math.PI * 2; // 1/e-scaled period, a third, faster, mutually-incommensurate rate

  const wave =
    Math.sin(phase) * 0.7 +
    Math.sin(secondaryPhase * 1.0 + 1.1) * 0.2 +
    Math.sin(tertiaryPhase * 1.0 + 2.7) * 0.1;

  return 1 + amplitude * wave;
}

// ---------------------------------------------------------------------------------------------
// The particle-vortex flow field itself: VORTEX.streakCount elongated, unlit/emissive instances
// distributed in a spiral around the travel axis between tunnelRadiusMin/Max, recycling (wrap
// back to the far end) as the camera travels past them — the same recycling trick v1's
// makeVoidStreaks used, scaled up from decoration to the primary environment per the contract.
// ---------------------------------------------------------------------------------------------

const _instPos = new THREE.Vector3();
const _instQuat = new THREE.Quaternion();
const _instScale = new THREE.Vector3(1, 1, 1);
const _instMatrix = new THREE.Matrix4();
const _instColor = new THREE.Color();
const _flowTangent = new THREE.Vector3();
// v2.18 — scratch for the per-instance billboard basis (see updateVortex's orientation block).
// The old `_boxLocalZ` single-axis mapping is gone with the BoxGeometry it existed for.
const _streakNormal = new THREE.Vector3();
const _streakRight = new THREE.Vector3();
const _toCamera = new THREE.Vector3();
const _streakBasis = new THREE.Matrix4();
const _instAxisPoint = new THREE.Vector3(); // v2.3: curve sample point at each streak's wrappedDist
const _instAxisTangent = new THREE.Vector3(); // v2.3: curve tangent at the same point
const _streakColor = new THREE.Color(); // per-instance scratch, reused across the update loop
// v2.16 FIX: streaks color from COLOR.streakBase (a luminous teal authored for particles), NOT
// COLOR.traverseBase — the environment base is near-black, and using it here rendered the teal
// majority of the field essentially invisible, leaving only the amber accent minority legible
// (the tunnel read as brown straw instead of the reference's cyan vortex). See config.js's
// streakBase comment for the full rationale.
const _colorBase = new THREE.Color(COLOR.streakBase);
const _colorAccent = new THREE.Color(COLOR.traverseAccent);
const _colorGuide = new THREE.Color(GUIDE.color); // v2.18 — the orb's own light, cast onto nearby threads
const _colorEnd = new THREE.Color(COLOR.overflowEnd);

// Recycling wrap span (meters) along the axis, centered on wherever the camera currently is.
// Generous enough that particles never visibly pop in/out at the frustum edge, matching v1's
// STREAK_SPAN_Y pattern but along the travel axis (Z) instead of the fall's vertical (Y) axis.
const STREAK_WRAP_SPAN = VORTEX.streakLength * 40;

// v2.18 — atmospheric depth range (meters from camera). Threads begin dimming at
// STREAK_FAR_FADE_START and are fully dissolved by STREAK_FAR_FADE_END, so the field recedes into
// darkness instead of terminating at a visible population edge.
//
// Deliberately AUTHORED VALUES, decoupled from STREAK_WRAP_SPAN rather than derived from it. The
// two distances answer different questions: the wrap span is how far apart streaks recycle (a
// correctness concern — it must be large enough that recycling is never visible), while this is
// how deep the visible world looks (a composition concern). Deriving the depth window from the
// wrap span tied them together, so lengthening a streak would silently thin the whole field by
// spreading the same instance count across a proportionally larger visible volume. The one
// invariant that MUST hold: FADE_END stays comfortably inside STREAK_WRAP_SPAN / 2, so every
// recycle happens in already-fully-invisible space (the same "be invisible at the seam"
// guarantee the companion orbs' wrap fade has to satisfy — see WRAP_FADE_ZONE).
const STREAK_FAR_FADE_START = 22;
const STREAK_FAR_FADE_END = 46; // vs. STREAK_WRAP_SPAN/2 = 80m — ample margin

// --- v2.20: LIGHT WAVES — "you push light into the dark" ---------------------------------------
// Every deliberate scroll push (scroll.js's impulseCount) releases a soft band of brightness that
// travels FORWARD down the tunnel from wherever the camera was, and dissipates. See config.js's
// SCROLL_FEEL block for the interaction rationale.
//
// Why this shape: the user's input previously vanished into a velocity integrator — you could feel
// the camera speed up, but nothing in the world acknowledged the push itself. A travelling wave
// makes the input a visible, physical event with a direction and a lifetime: light you sent ahead
// of you into the dark. It's also honest to the piece's own rules — it decays fully to baseline on
// its own, never gates progress, and rides the same per-instance brightness channel (and the same
// ceiling clamp) everything else in the streak field already uses.
//
// Stored as a fixed-size pool written in place: no allocation per push, and the "recycle the
// oldest" policy means a user scrolling furiously gets a steady overlapping shimmer rather than an
// unbounded list of live waves.
const _lightWaves = [];
for (let i = 0; i < SCROLL_FEEL.waveMaxActive; i++) {
  _lightWaves.push({ originDist: 0, age: Infinity });
}
let _lastImpulseCount = 0;

/** Spawns a wave at `originDist`, reusing whichever pool slot is furthest through its own life. */
function spawnLightWave(originDist) {
  let oldest = _lightWaves[0];
  for (let i = 1; i < _lightWaves.length; i++) {
    if (_lightWaves[i].age > oldest.age) oldest = _lightWaves[i];
  }
  oldest.originDist = originDist;
  oldest.age = 0;
}

/** Total wave brightness contribution at an absolute arc-length position along the travel axis. */
function lightWaveBoostAt(absoluteDist) {
  let boost = 0;
  for (let i = 0; i < _lightWaves.length; i++) {
    const wave = _lightWaves[i];
    if (wave.age >= SCROLL_FEEL.waveLifetimeSeconds) continue;
    const front = wave.originDist + wave.age * SCROLL_FEEL.waveSpeed;
    const offset = (absoluteDist - front) / SCROLL_FEEL.waveWidth;
    const band = Math.exp(-offset * offset);
    if (band < 0.01) continue;
    const fade = 1 - wave.age / SCROLL_FEEL.waveLifetimeSeconds;
    boost += SCROLL_FEEL.waveGain * band * fade * fade;
  }
  return boost;
}

/**
 * Builds VORTEX.streakCount instances, each anchored to a random (angle, radius, axial offset)
 * within the tunnel's spiral cross-section. Per-instance data is kept in a plain array (not
 * re-derived from the instance matrix each frame) so update can cheaply read/mutate it.
 */
function makeStreaks() {
  // v2.18 — THE STRUCTURAL FIX for "the environment doesn't feel premium/calming."
  //
  // This was a `BoxGeometry`: an opaque, hard-silhouetted stick. 2400 of them, rendered in a
  // pipeline that can never enable canvas antialiasing (main.js documents the depth-blit crash
  // that forbids it), is why the abyss read as floating debris/straw no matter how the palette
  // was tuned across v2.16 and v2.17. Hard edges are not light, and no color value changes that.
  //
  // Now: a flat quad carrying glow-sprite.js's soft elongated streak texture, additively blended
  // and depth-write disabled — so each streak has NO silhouette, dissolves into the void at its
  // own edges, and accumulates with its neighbours into something that reads as luminous
  // atmosphere rather than a crowd of objects. Deliberately still ONE InstancedMesh (a single
  // draw call): 2400 individual THREE.Sprites would be 2400 draw calls and would tank the frame.
  //
  // Geometry axes matter downstream: PlaneGeometry lies in its own local XY plane, WIDTH along
  // local +X and LENGTH along local +Y, with its normal on local +Z. updateVortex's per-instance
  // orientation billboards local +Z toward the camera while pinning local +Y to the flow tangent
  // — see that code for why a plane cannot reuse the old box's single setFromUnitVectors call.
  const geometry = new THREE.PlaneGeometry(VORTEX.streakWidth, VORTEX.streakLength);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff, // per-instance color carries the real hue via setColorAt; base stays white
    map: getSharedStreakTexture(),
    transparent: true,
    opacity: 1,
    depthWrite: false, // soft additive light must never occlude what's behind it via the depth
                       // buffer — that would reintroduce a hard edge by another route
    blending: THREE.AdditiveBlending, // light accumulates; overlapping threads read as one
                                      // brighter volume of glow, not as stacked opaque cards
    side: THREE.DoubleSide, // billboarding keeps quads camera-facing, but this is free insurance
                            // against a degenerate frame flipping one edge-on
    toneMapped: false, // stay crisp/bright, not washed out by ACES tone mapping (v1 precedent)
    fog: false, // no THREE.Fog in v2 — depth is an explicit per-instance distance fade (see updateVortex)
  });

  const mesh = new THREE.InstancedMesh(geometry, material, VORTEX.streakCount);
  mesh.name = 'vortex-streak-field';
  mesh.frustumCulled = false;
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(VORTEX.streakCount * 3), 3);

  const streaks = [];
  for (let i = 0; i < VORTEX.streakCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    // Bias radius distribution slightly toward the outer band so density reads as thickest near
    // tunnelRadiusMax and thins toward the throat, matching the reference image's composition
    // (streaks flowing along field lines into a dark central aperture, not a solid inner core).
    const radiusMix = Math.pow(Math.random(), 0.6);
    const radius = THREE.MathUtils.lerp(VORTEX.tunnelRadiusMin, VORTEX.tunnelRadiusMax, radiusMix);
    streaks.push({
      angle,
      radius,
      axialOffset: Math.random() * STREAK_WRAP_SPAN,
      pulsePhase: Math.random() * Math.PI * 2,
      brightnessJitter: 0.75 + Math.random() * 0.5, // v2.17: tightened from 0.6+0.7 (calm pass) — per-streak variation so the field doesn't
                                                     // pulse in perfect unison (organic, not
                                                     // metronomic, same rationale as v1's lighting)
      // Seeded once (not re-rolled per frame) so a given streak consistently drops out of the
      // sparser between-region stretches rather than flickering — regionalIntensityAtT's output
      // for the region this streak currently sits in is compared against this fixed threshold,
      // see updateVortex's densityVisibility. Spread across [0,1] so roughly a uniform fraction
      // of streaks fade out at any given in-between-regions density level.
      densityThreshold: Math.random(),
    });
  }

  return { mesh, geometry, material, streaks };
}

// ---------------------------------------------------------------------------------------------
// Companion orbs (v2.1 base population; v2.2 adds "sightings" + end-of-journey convergence —
// CONCEPT.md v2.2 Section 2/ARCHITECTURE.md's vortex.js section). A small population of distant,
// dim, cool-toned, unlit orbs drifting slowly around the travel axis, well outside the streak
// tunnel's own radius band (COMPANION_ORBS.minDistance..maxDistance, deliberately farther out than
// VORTEX.tunnelRadiusMax so they never crowd the primary flow field or read as close enough to be
// obstacles). Pure environmental storytelling — no proximity resonance, no interaction, no
// THREE.Light of their own (same lighting lesson as the streak field above: glow is this
// material's own emissive-style unlit color, nothing illuminates them from outside).
//
// v2.2 additions:
//   - Sightings (COMPANION_ORBS.sightingAxisFractions): at two specific travel-axis positions, a
//     small cluster (roughly a third of the population, deterministically chosen so the same orbs
//     always form the cluster on repeat visits) drifts from its ambient radius band down to
//     COMPANION_ORBS.sightingMinDistance..sightingMaxDistance — noticeably closer, still never
//     inside the tunnel's own radius — then back out, a deliberate "moment" rather than pure
//     ambience. state.companions.sightingActive is set true while any orb is within its own
//     sighting-influence window.
//   - Convergence (COMPANION_ORBS.convergeAtEnd): v2.4 FIX — no longer timed to a discrete beat
//     boundary. Continuous and monotonic in state.traverse.progress via resolveConvergeBlend()
//     below (see that function's own header comment for the full "why" — CONCEPT.md v2.4 item 6),
//     starting well before the Guiding Orb's own 'turn'-beat dissolve begins so the two read as
//     converging on the same unified "everyone finds their way, together" moment rather than a
//     synchronized discrete cutscene.
// ---------------------------------------------------------------------------------------------

const COMPANION_WRAP_SPAN = VORTEX.travelSpan * 1.15; // generous enough that recycling never pops
                                                        // visibly at the frustum's far edge
// v2.9 FIX — this comment's own claim ("never pops visibly") was never actually true: the wrap
// span being "generous" only controls how FAR AWAY the recycling discontinuity sits, not whether
// the orb is invisible when it happens — those are different guarantees, and only the fade below
// (new in v2.9) actually delivers the second one. Meters of margin, before the exact wrap
// boundary (COMPANION_WRAP_SPAN/2 from the camera), over which an orb smoothly fades to fully
// invisible — see the wrap-fade fix in updateCompanionOrbs for the full "why" (a real, measured
// 200-290m single-frame position teleport at FULL opacity, found via direct execution of the real
// per-frame update loop, not a subtle theoretical edge case).
const WRAP_FADE_ZONE = 25;
// v2.9, NEW — the halo sprite of each companion orb's glow-sprite pair (see glow-sprite.js) is
// dimmer than its core, same "bright center, soft dissolving falloff" read as the Guiding Orb's
// own multi-layer stack, just collapsed to two layers for a population this large.
const HALO_OPACITY_SCALE = 0.28;
const _companionOrbColor = new THREE.Color(); // scratch — this frame's resolved color before being written onto both the core and halo sprites

// How wide (in normalized [0,1] traverse-progress units) a sighting's influence window is around
// each COMPANION_ORBS.sightingAxisFractions entry — a cluster drifts closer approaching the
// anchor, holds near-peak briefly, then drifts back out, all within this window.
const SIGHTING_INFLUENCE_WIDTH = 0.07;

// Roughly this fraction of the ambient population participates in any single sighting cluster —
// a "small cluster," not the whole field suddenly rushing the camera.
const SIGHTING_CLUSTER_FRACTION = 0.35;

/**
 * Builds COMPANION_ORBS.count small unlit sphere meshes, each with a fixed (seeded once, not
 * randomized per frame) angle/radius/axial-offset and its own simplex-noise drift seed so they
 * wander independently and slowly rather than looking locked in place or synchronized.
 *
 * v2.3 addition (CONCEPT.md v2.3 item 7 / ARCHITECTURE.md item 4: "the whole environment needs to
 * feel alive... others moving around... not 14 copies of one animation"): beyond the existing
 * per-orb driftSeed/bobSeed (which already desync PHASE), each orb now also gets its own drift
 * SPEED and RADIAL-PATTERN multipliers, seeded from its own index — so orbs read as individuals
 * with genuinely different characters (some wander faster/wider, some barely drift at all) rather
 * than 14 instances of the exact same motion curve merely offset in time.
 */
function makeCompanionOrbs() {
  const group = new THREE.Group();
  group.name = 'companion-orbs';

  const orbs = [];

  for (let i = 0; i < COMPANION_ORBS.count; i++) {
    // v2.8, NEW — "diverse range of colors to feel mesmerizing... their own journey of
    // exploration": each orb's OWN color (not a single shared instance every orb used to alias)
    // is set via HSL, hue spread evenly across the wheel via golden-angle spacing (137.50776
    // degrees — the same even-angular-spread constant used across many procedural-scatter
    // techniques, chosen over fully random per-orb hues specifically because random hues risk two
    // adjacent orbs landing on near-identical colors purely by chance). Saturation/lightness fixed
    // from COMPANION_ORBS.colorSaturation/colorLightness so every orb still reads as one
    // consistent "glow" family regardless of its individual hue — this is color variety, not a
    // second visual language.
    const hue = ((i * 137.50776) % 360) / 360 * (COMPANION_ORBS.hueVariety ?? 1);
    const baseColor = new THREE.Color().setHSL(hue, COMPANION_ORBS.colorSaturation ?? 0.55, COMPANION_ORBS.colorLightness ?? 0.64);

    // v2.9, NEW — feedback: "the portal orbs doesn't have the glow effect, they need to represent
    // soft glowing orbs of soul." These used to be literal solid SphereGeometry+MeshBasicMaterial
    // spheres — a lit-looking ball with a hard silhouette edge, not a glow. Replaced with
    // glow-sprite.js's shared core+halo additive-sprite technique (the same rendering family the
    // Guiding Orb already uses, just a simpler two-layer version — companion orbs must stay
    // visually subordinate to the Guide, CONCEPT.md's "the orb is deliberately the brightest,
    // warmest thing in frame" non-negotiable). Diameters chosen to read at roughly the same
    // on-screen scale the old sphere's 0.5-1.1m scale range did, with a soft halo extending
    // further than a solid sphere's silhouette ever could.
    const sizeVariety = 0.5 + Math.random() * 0.6; // same "subtle size variety, still distant/small" range the old mesh.scale used
    const { group: orbGroup, core, halo } = buildGlowOrb(baseColor, 0.55 * sizeVariety, 1.9 * sizeVariety);
    group.add(orbGroup);

    const radiusMix = Math.random();
    orbs.push({
      mesh: orbGroup, // kept as `mesh` for this file's existing position/visibility call sites (updateCompanionOrbs) — now a glow-sprite group, not a solid mesh
      core,
      halo,
      baseColor, // this orb's own resting hue — updateCompanionOrbs blends FROM this, not the old shared _companionColor
      angle: Math.random() * Math.PI * 2,
      radius: THREE.MathUtils.lerp(COMPANION_ORBS.minDistance, COMPANION_ORBS.maxDistance, radiusMix),
      axialOffset: Math.random() * COMPANION_WRAP_SPAN,
      driftSeed: Math.random() * 1000,
      bobSeed: Math.random() * 1000,
      // v2.3, new — individually-varied motion character, seeded once per orb (index-based, so
      // repeat visits see the same individuals behave the same way, per the deterministic
      // "companion orbs are pure environmental storytelling" contract elsewhere in this file).
      // driftSpeedScale: how fast this orb's own angular/radial noise phase advances relative to
      // the shared base rate — some orbs drift noticeably more restlessly than others.
      // driftRadiusScale: how far this orb's radial noise excursion reaches — some wander close to
      // their base radius, some swing wider.
      // bobSpeedScale/bobAmplitudeScale: same idea for the vertical bob, independent of drift, so
      // an orb that drifts fast doesn't necessarily also bob fast.
      driftSpeedScale: 0.7 + Math.random() * 0.7,     // ~0.7x .. 1.4x
      driftRadiusScale: 0.5 + Math.random() * 1.0,    // ~0.5x .. 1.5x
      bobSpeedScale: 0.6 + Math.random() * 0.9,       // ~0.6x .. 1.5x
      bobAmplitudeScale: 0.5 + Math.random() * 1.0,   // ~0.5x .. 1.5x
      baseOpacity: 0.25 + Math.random() * 0.25, // dim — "distant, dim" per the concept, never
                                                  // competing with the Guiding Orb's brightness
      // v2.2: which sighting cluster (index into COMPANION_ORBS.sightingAxisFractions) this orb
      // belongs to, if any — deterministic assignment (index-based, not random-per-frame) so the
      // same orbs form the same sighting cluster every time, per anchor. -1 = never participates
      // in a sighting, stays purely ambient.
      sightingGroup: -1,
      // v2.3, new (CONCEPT.md item 7 — ambient events distinct from the two scripted sightings):
      // which AMBIENT_EVENTS.axisFractions anchor this orb belongs to, if any. Deliberately a
      // SEPARATE assignment from sightingGroup (below) so an ambient flare never doubles up on the
      // exact same orbs already doing sighting duty — the two systems should read as unrelated,
      // independent things happening, not two labels on one event. -1 = never flares.
      ambientEventGroup: -1,
      // v2.7, NEW, REDESIGNED v2.8 — feedback: "make the other orbs lively as well, and make them
      // surround the silhouette," then "20-30 times maybe" for the vision encounters themselves.
      // v2.7's version assigned each orb PERMANENTLY to one of a small, fixed number of vision
      // encounters (mirroring sightingGroup/ambientEventGroup's fixed-anchor-count assignment) —
      // that breaks down once VISION_ENCOUNTER.count grows to 20+ closely-spaced encounters
      // (their spacing, ~0.0375 of the traverse, is narrower than a single influence window, so
      // several would legitimately be active at once and a fixed permanent assignment can't
      // express "surround whichever one is actually nearest right now"). Replaced with a
      // per-frame NEAREST-ACTIVE-ENCOUNTER lookup (same shape as camera.js's own
      // nearestRegionStrength(), which already solves exactly this "many anchors, find the
      // closest one every frame" problem for its own regional-framing system) — see
      // updateCompanionOrbs' surround block for where this is actually resolved; only a stable
      // per-orb PARTICIPATION flag (whether this orb is one of the ones that ever surrounds
      // anything at all) is still decided once, at construction, below.
      surroundsVisions: false,
      // Per-orb angle/height around whichever vision anchor this orb is currently nearest to —
      // seeded once so each participating orb takes its own stable orbit character rather than
      // all converging identically or re-randomizing every frame.
      surroundAngle: Math.random() * Math.PI * 2,
      surroundHeight: (Math.random() - 0.5) * 2.4,
      surroundSpeedScale: 0.6 + Math.random() * 0.8,
      // v2.4 FIX (was: incremented one-way once state.beat === GUIDE.dissolveStartBeat, a discrete
      // beat-boundary flip — see updateCompanionOrbs' header comment for the full rationale).
      // convergeT is now a per-orb SMOOTHED readout of the shared, continuous
      // resolveConvergeBlend(state) signal (0 = fully ambient, 1 = fully converged/dissolved),
      // damped independently per orb purely so the population doesn't all move in perfect
      // lockstep (same "organic, not metronomic" rationale as brightnessJitter elsewhere in this
      // file) — never a one-way ratchet, so it rises AND falls smoothly as the shared blend does.
      convergeT: 0,
      // v2.7, NEW — per-orb smoothed readout of this orb's own surround-strength (see
      // updateCompanionOrbs' surround block), same damping shape as convergeT above so the
      // approach/retreat into a surround position reads as a drift, never a snap.
      surroundT: 0,
      // v2.9, NEW — real bug fix, not tuning: this orb's LOCKED target anchor while surroundT > 0.
      // nearestVisionSurround() picks whichever encounter is nearest EVERY frame; at v2.8's
      // encounter density (24, ~9.75m apart) an orb can pass through a brief gap between two
      // encounters' influence windows without surroundT fully decaying to 0 first (verified
      // directly: the exponential decay's own time-constant, ~0.25s, is comparable to or longer
      // than the ~0.3-0.4s gap between encounters at ordinary scroll speeds) — the OLD code re-read
      // nearestVisionSurround's anchor fresh every frame regardless, so at that moment it would
      // start blending toward the NEW anchor from whatever position it was still holding near the
      // old one, at 25-35% strength already — a real, measured multi-meter single-frame position
      // jump, the direct mechanical cause of feedback "the movement of the orbs are very awkward."
      // Fixed by only ever adopting a new lockedAnchor once surroundT has fully released (see the
      // update loop below) — the orb finishes leaving one encounter's orbit before ever
      // considering entering another's, exactly the discipline every other proximity system in
      // this file already follows (e.g. resolveConvergeBlend's own smoothstep never reconsiders
      // its target mid-blend).
      lockedVisionAnchor: null,
    });
  }

  // v2.8, NEW — a subset of the population participates in the "surround a vision encounter"
  // behavior (COMPANION_ORBS.visionSurroundFraction) — a stable, deterministic subset (not
  // re-chosen per frame), drawn from the same "distinct slice of the index range" trick the
  // sighting/ambient-event assignments below use, so it doesn't systematically overlap either.
  const surroundParticipantCount = Math.max(1, Math.round(orbs.length * (COMPANION_ORBS.visionSurroundFraction ?? 0.4)));
  for (let i = 0; i < surroundParticipantCount; i++) {
    orbs[(Math.floor(orbs.length / 3) + i) % orbs.length].surroundsVisions = true;
  }

  // Deterministically assign a rotating subset of orbs to each sighting anchor so every sighting
  // draws from roughly SIGHTING_CLUSTER_FRACTION of the population, and different anchors don't
  // necessarily reuse the exact same orbs (spreads `i % anchorCount` across the population).
  const anchorCount = Math.max(1, COMPANION_ORBS.sightingAxisFractions?.length ?? 0);
  const clusterSize = Math.max(1, Math.round(orbs.length * SIGHTING_CLUSTER_FRACTION));
  for (let a = 0; a < anchorCount; a++) {
    for (let c = 0; c < clusterSize; c++) {
      const idx = (a * clusterSize + c) % orbs.length;
      // Only assign if not already claimed by an earlier anchor, so a single orb never has to
      // serve two simultaneous sighting targets — later anchors simply draw from whatever's left
      // first, falling through to already-used orbs only once every orb has one assignment.
      if (orbs[idx].sightingGroup === -1) {
        orbs[idx].sightingGroup = a;
      }
    }
  }

  // v2.3: same rotating-subset assignment for ambient-event clusters, drawn from the OPPOSITE end
  // of the population (reverse index order) so an ambient-flare cluster and a sighting cluster are
  // unlikely to be the exact same orbs, without needing an explicit exclusion pass.
  const ambientAnchorCount = Math.max(1, AMBIENT_EVENTS.axisFractions?.length ?? 0);
  const ambientClusterSize = Math.max(1, Math.round(orbs.length * AMBIENT_EVENTS.clusterFraction));
  for (let a = 0; a < ambientAnchorCount; a++) {
    for (let c = 0; c < ambientClusterSize; c++) {
      const idx = orbs.length - 1 - ((a * ambientClusterSize + c) % orbs.length);
      if (orbs[idx].ambientEventGroup === -1) {
        orbs[idx].ambientEventGroup = a;
      }
    }
  }

  return { group, orbs };
}

/**
 * createVortex(scene)
 * Builds the particle-streak flow field and the companion-orb population. Adds all of it to the
 * scene. Returns a handle consumed by updateVortex() every frame.
 */
export function createVortex(scene) {
  const { mesh, geometry, material, streaks } = makeStreaks();
  scene.add(mesh);

  const { group: companionGroup, orbs: companionOrbs } = makeCompanionOrbs();
  scene.add(companionGroup);

  return {
    mesh,
    geometry,
    material,
    streaks,
    companionGroup,
    companionOrbs,
    axis: getVortexAxis(),
  };
}

const _companionNoise = createNoise3D();
const _companionPos = new THREE.Vector3();
const _companionAxisPoint = new THREE.Vector3();
const _companionAxisTangent = new THREE.Vector3();
const _overflowLightPos = new THREE.Vector3();
const _surroundOffset = new THREE.Vector3();
const _surroundPos = new THREE.Vector3();

/** 0..1 strength of the given sighting anchor's influence at traverse-progress `progress`, peaking
 * at the anchor itself and smoothly falling off over SIGHTING_INFLUENCE_WIDTH on either side —
 * "drifts closer, then back out" rather than a discrete on/off toggle. */
function sightingStrengthAt(progress, anchorFraction) {
  const delta = Math.abs(progress - anchorFraction);
  if (delta >= SIGHTING_INFLUENCE_WIDTH) return 0;
  return 0.5 + 0.5 * Math.cos((delta / SIGHTING_INFLUENCE_WIDTH) * Math.PI); // 1 at center, 0 at edge
}

/** 0..1 strength of the given ambient-event anchor at traverse-progress `progress` — same
 * cosine-falloff shape as sightingStrengthAt, over AMBIENT_EVENTS' own (narrower) influence width,
 * so a flare reads as a brief, self-contained bloom rather than a sustained approach. Kept as its
 * own function (not a reuse of sightingStrengthAt with a different width parameter) so the two
 * event systems can keep independently-tunable shapes if the two ever need to diverge further. */
function ambientEventStrengthAt(progress, anchorFraction) {
  const delta = Math.abs(progress - anchorFraction);
  if (delta >= AMBIENT_EVENTS.influenceWidth) return 0;
  return 0.5 + 0.5 * Math.cos((delta / AMBIENT_EVENTS.influenceWidth) * Math.PI);
}

// v2.7, NEW, REDESIGNED v2.8 — vision.js's own encounter anchor world positions, re-derived here
// from the SAME axisPointAt/axisTangentAt + right-vector math vision.js's placeEncounter() uses,
// rather than importing vision.js directly (this file never imports vision.js/seeking-orbs.js —
// main.js wires modules together, per ARCHITECTURE.md's circular-import-avoidance convention;
// camera.js's own REGION_AXIAL_DISTANCES already re-derives seeking-orbs.js's placement positions
// the same way). Lazily built once and cached (the curve itself is static once built, so these
// anchors never change frame-to-frame) — mirrors ROOM_LOCAL_FRAME's old "compute once via IIFE"
// discipline for the same reason. Also generates the matching axis-fraction for each anchor (same
// even-spacing formula vision.js's own encounterFractions() uses) so callers can find the nearest
// one by traverse-progress distance, exactly like camera.js's nearestRegionStrength() already does
// for its own many-anchor regional system — the v2.7 version of this file assigned each orb
// PERMANENTLY to one of a small, fixed number of encounters, which breaks down once
// VISION_ENCOUNTER.count grows large enough (20-30) that several encounters' influence windows
// are simultaneously active — see updateCompanionOrbs' surround block for where this replacement
// lookup is actually used.
let _visionAnchorsCache = null;
function getVisionAnchorsWithFractions() {
  if (_visionAnchorsCache) return _visionAnchorsCache;
  const count = Math.max(1, VISION_ENCOUNTER.count | 0);
  const margin = VISION_ENCOUNTER.margin ?? 0.05;
  const span = 1 - margin * 2;
  _visionAnchorsCache = [];
  for (let i = 0; i < count; i++) {
    const fraction = count === 1 ? 0.5 : margin + (span * (i + 0.5)) / count;
    const dist = fraction * VORTEX.travelSpan;
    const point = axisPointAt(dist, new THREE.Vector3());
    const tangent = axisTangentAt(dist, new THREE.Vector3()).normalize();
    const right = new THREE.Vector3().crossVectors(tangent, UP).normalize();
    const side = i % 2 === 0 ? VISION_ENCOUNTER.side : -VISION_ENCOUNTER.side; // matches vision.js's own alternate-side-per-instance assignment exactly
    const anchor = point.clone()
      .addScaledVector(right, side * VISION_ENCOUNTER.axisOffset)
      .add(new THREE.Vector3(0, VISION_ENCOUNTER.heightOffset, 0));
    _visionAnchorsCache.push({ fraction, anchor });
  }
  return _visionAnchorsCache;
}

// How wide (in normalized [0,1] traverse-progress units) a vision-encounter "surround" influence
// window is around its own nearest anchor, same cosine-falloff shape as sightingStrengthAt/
// ambientEventStrengthAt above (continuous approach/retreat, never a snap). Deliberately narrower
// than SIGHTING_INFLUENCE_WIDTH now that encounters sit much closer together (v2.8's 20-30 count)
// — a window this narrow still comfortably covers the ~2-3m VISION_ENCOUNTER.surroundRadius
// approach distance without two adjacent encounters' windows fighting over the same orbs at once.
const SURROUND_INFLUENCE_WIDTH = 0.018;

/** Finds the vision anchor nearest to traverse-progress `progress`, returning both its 0..1
 * influence strength (cosine falloff, matching every other proximity system in this file) and the
 * anchor itself — same "many anchors, find the closest one every frame" shape camera.js's own
 * nearestRegionStrength() already solves for its regional-framing system. */
function nearestVisionSurround(progress) {
  const anchors = getVisionAnchorsWithFractions();
  let best = 0;
  let bestAnchor = null;
  for (const entry of anchors) {
    const delta = Math.abs(progress - entry.fraction);
    if (delta >= SURROUND_INFLUENCE_WIDTH) continue;
    const x = 1 - delta / SURROUND_INFLUENCE_WIDTH;
    const strength = 0.5 + 0.5 * Math.cos((delta / SURROUND_INFLUENCE_WIDTH) * Math.PI);
    if (strength > best) {
      best = strength;
      bestAnchor = entry.anchor;
    }
  }
  return { strength: best, anchor: bestAnchor };
}

// ---------------------------------------------------------------------------------------------
// v2.4 FIX — continuous, scroll-driven convergence (CONCEPT.md v2.4 item 6 / ARCHITECTURE.md's
// dedicated "continuous convergence fix" instruction). Feedback: "the ending feels off, all the
// orbs suddenly jump into the bigger orb, it needs to flow with the scroll."
//
// WHAT WAS WRONG: convergence used to be gated by `state.beat === GUIDE.dissolveStartBeat`
// ('turn') — a discrete BEAT-BOUNDARY check. Two problems with that, per ARCHITECTURE.md: (1) it
// is a one-time flip, not a continuous function of anything, so every companion orb necessarily
// starts its convergence motion from a dead stop at the exact instant 'turn' begins, reading as a
// snap/cutscene rather than something that "flows with the scroll"; (2) 'turn' belongs to the
// RETURN phase, which is driven by state.actIII.clockTime (autoplay, per state.js's three-phase
// timing model) — NOT by scrolling at all. A trigger keyed to a beat the user's scroll input has
// zero influence over can definitionally never "flow with the scroll."
//
// THE FIX: resolveConvergeBlend(state) below is a continuous, monotonic function of
// state.traverse.progress (the actual scroll-driven value everything else in the traverse reads)
// — 0 below COMPANION_ORBS.convergeRampStartFraction, ramping smoothly to 1 as progress continues
// to 1.0. This means the ramp is already well underway by the time 'turn' is ever reached (per
// ARCHITECTURE.md: "by the time the beat boundary is reached, companions should already be
// smoothly mid-drift toward the light"). Once state.traverse.complete flips true (progress pinned
// at 1, the return phase begins), this function continues to report 1 — i.e. holds at the fully-
// converged end of the ramp — for whatever tail motion still belongs in 'turn'/beyond (the
// bloom-and-fade visual below), rather than needing a second, separate driver for that tail.
//
// REVERSIBILITY: because this is a pure function of state.traverse.progress (never an
// accumulated/incremented value), scrolling backward across convergeRampStartFraction during the
// traverse makes this value decrease smoothly right back down — exactly the same bidirectional-
// continuity contract scroll.js/seeking-orbs.js/dialogue re-arm logic already honor elsewhere in this
// codebase. There is deliberately no one-way latch anywhere in this function.
// ---------------------------------------------------------------------------------------------

/**
 * Continuous 0..1 convergence-blend factor, per this section's header comment. Smooth-step shaped
 * (not linear) so the ramp itself has no velocity discontinuity at either end — eases in as
 * progress crosses convergeRampStartFraction, eases out as it approaches/holds at 1.
 */
function resolveConvergeBlend(state) {
  if (!COMPANION_ORBS.convergeAtEnd) return 0;

  // Once the traverse is complete, state.traverse.progress stays pinned at 1 (state.js/scroll.js's
  // own contract) — reading it directly here still correctly reports "fully ramped" without this
  // function needing a separate beat-based branch for the return phase.
  const progress = THREE.MathUtils.clamp(state.traverse?.progress ?? 0, 0, 1);
  const rampStart = THREE.MathUtils.clamp(COMPANION_ORBS.convergeRampStartFraction ?? 0.85, 0, 0.999);
  const rampSpan = Math.max(1e-4, 1 - rampStart);

  const t = THREE.MathUtils.clamp((progress - rampStart) / rampSpan, 0, 1);
  return t * t * (3 - 2 * t); // smoothstep — zero derivative at both t=0 and t=1
}

/**
 * Advances the companion-orb population: slow simplex-noise-driven angular/radial drift (never
 * locked in place, never interactive), axial recycling identical in spirit to the streak field's
 * wrap, a fade in/out gated to the `traverse` beat, v2.4's CONTINUOUS, scroll-driven convergence
 * into the overflow light (see resolveConvergeBlend's header comment directly above for the full
 * fix rationale — this replaces v2.2's discrete beat-boundary trigger), and (v2.3) a small number
 * of one-off ambient brightness flares (AMBIENT_EVENTS) distinct from the scripted sightings —
 * CONCEPT.md item 7's "things happening... not only ever in reaction to the user's presence" half
 * that individually-varied per-orb motion alone didn't cover.
 *
 * v2.3 CHANGE: `cameraAxialDistance` used to be read straight off `-camera.position.z`, which was
 * a valid arc-length proxy ONLY because the old axis was literally the world Z line — now that the
 * travel axis is a curved path (this module's own v2.3 change), the camera's rendered Z coordinate
 * is no longer numerically equal to how far it has actually travelled along the curve (the curve
 * banks through X/Y too). Fixed by reading `resolveTravelArcLength(state)` instead — the same
 * beat-authoritative arc-length getCameraRigPosition itself derives, rather than back-solving from
 * the rendered position (a real module-boundary bug this file would otherwise be introducing
 * against its own recycling/regional-lookup math, per ARCHITECTURE.md's bug-class warning).
 */
function updateCompanionOrbs(handle, state, camera, dt) {
  const { companionOrbs } = handle;
  if (!companionOrbs || companionOrbs.length === 0) return;

  const inTraverse = state.beat === 'traverse';
  const frameDt = dt || 0.016;
  const cameraAxialDistance = resolveTravelArcLength(state);
  // v2.20 — stillness gathering only applies during the traverse: it's the one act where the user
  // has pace control, so it's the only act where "the user chose to rest" is a meaningful thing to
  // answer. During the autoplay fall-in and return, no input is expected and none is rewarded.
  const orbStillness = inTraverse ? THREE.MathUtils.clamp(state.scroll?.stillness ?? 0, 0, 1) : 0;
  const elapsed = state.traverse?.elapsedSeconds ?? 0; // real wall-clock time in-phase, NOT a
                                                          // frozen/global clock — same rule as the
                                                          // guide orb's bob and lighting.js's pulse
                                                          // curve (see ARCHITECTURE.md's frozen-
                                                          // clock bug-class warning)
  const progress = THREE.MathUtils.clamp(state.traverse?.progress ?? 0, 0, 1);

  // --- Sightings (v2.2): is any cluster currently within its influence window? -----------------
  // Computed once per frame (not per-orb) since state.companions.sightingActive is a single shared
  // flag other modules (overlay-text.js/lighting.js) may optionally read.
  let anySightingActive = false;
  const sightingFractions = COMPANION_ORBS.sightingAxisFractions ?? [];
  const sightingStrengths = sightingFractions.map((f) => sightingStrengthAt(progress, f));
  if (inTraverse) {
    for (const s of sightingStrengths) {
      if (s > 0.02) {
        anySightingActive = true;
        break;
      }
    }
  }
  state.companions = state.companions || { sightingActive: false };
  state.companions.sightingActive = anySightingActive;

  // --- Ambient events (v2.3, CONCEPT.md item 7): brief, one-off brightness flares on a small
  // cluster of the ambient population, distinct from the two scripted sightings above — same
  // shape (fires at fixed axis fractions every run), deliberately NOT exposed as a shared
  // state flag other modules react to, and NOT gated on any interaction signal, so it reads as
  // the environment doing something on its own terms rather than another response to the user.
  const ambientFractions = AMBIENT_EVENTS.axisFractions ?? [];
  const ambientStrengths = ambientFractions.map((f) => ambientEventStrengthAt(progress, f));

  // --- v2.7, NEW, REDESIGNED v2.8 — vision-encounter "surround": which vision anchor (if any) is
  // currently nearest, and how strongly active is its influence window? Computed ONCE per frame
  // (not per-orb) via nearestVisionSurround() — same "many anchors, find the closest one" shape
  // camera.js's own nearestRegionStrength() already uses for its regional-framing system, chosen
  // specifically because VISION_ENCOUNTER.count can now be 20-30 (v2.8), too many for a fixed
  // per-orb permanent-anchor assignment (v2.7's approach) to remain correct. Feedback: "make the
  // other orbs lively as well, and make them surround the silhouette" — a subset of the ambient
  // population (orb.surroundsVisions) drifts from its normal travel-axis-relative position toward
  // orbiting whichever vision encounter is currently nearest, continuous and reversible exactly
  // like the sighting mechanism this mirrors.
  const nearestSurround = nearestVisionSurround(progress);

  // --- Convergence blend (v2.4 FIX — see resolveConvergeBlend's header comment for the full
  // rationale): a CONTINUOUS 0..1 function of state.traverse.progress, never a discrete beat-
  // boundary flip. Computed once per frame (not per-orb, not accumulated/stateful) so it rises AND
  // falls smoothly with scroll direction — reversible by construction, since it is a pure function
  // of the current progress value, not an incremented accumulator.
  const convergeBlend = resolveConvergeBlend(state);

  // Convergence target: the same overflow-light endpoint lighting.js positions its own
  // overflowLight at (VORTEX.travelSpan + OVERFLOW_LIGHT_DISTANCE past the axis origin) — computed
  // directly from this module's own axis math rather than importing lighting.js, so there's no
  // new cross-module dependency for this one shared coordinate. Only worth resolving once the
  // blend is actually non-zero for anything to lerp toward.
  if (COMPANION_ORBS.convergeAtEnd && convergeBlend > 0) {
    axisPointAt(VORTEX.travelSpan + OVERFLOW_LIGHT_DISTANCE, _overflowLightPos);
  }

  for (const orb of companionOrbs) {
    // Per-orb smoothed readout of the shared convergeBlend signal (see the field's own comment in
    // makeCompanionOrbs) — a small exponential damp, NOT a one-way ratchet, so it tracks the shared
    // signal both up and down, just with a touch of independent per-orb lag so the population
    // doesn't all move in perfect lockstep with each other or with the raw scroll input.
    const convergeLerp = 1 - Math.exp(-4 * frameDt);
    orb.convergeT += (convergeBlend - orb.convergeT) * convergeLerp;
    const eased = orb.convergeT * orb.convergeT * (3 - 2 * orb.convergeT); // smoothstep, matches
                                                                             // resolveConvergeBlend's
                                                                             // own shape

    // --- Ambient drift target: computed EVERY frame regardless of convergence state, so there is
    // always a valid "un-converged" position to blend back toward the instant the user scrolls
    // backward — this is what makes un-convergence possible at all (v2.2's old implementation
    // stopped computing this once `converging` latched true, which is precisely why it could only
    // ever move toward the light, never back). ------------------------------------------------
    const driftT = elapsed * 0.06 * orb.driftSpeedScale + orb.driftSeed;
    const angleDrift = _companionNoise(driftT, orb.driftSeed, 0) * 0.5;
    const radiusDrift = _companionNoise(orb.driftSeed, driftT, 1) * 2.5 * orb.driftRadiusScale;
    const bob = Math.sin(elapsed * 0.15 * orb.bobSpeedScale + orb.bobSeed) * 1.5 * orb.bobAmplitudeScale;

    // v2.2 sighting pull: if this orb belongs to a currently-active sighting cluster, its
    // effective radius eases toward the closer sighting band instead of the ambient band — a
    // continuous function of that anchor's strength (0..1), so the approach/retreat itself reads
    // as a drift, never a snap.
    let sightingPull = 0;
    if (orb.sightingGroup >= 0 && sightingStrengths[orb.sightingGroup] > 0) {
      sightingPull = sightingStrengths[orb.sightingGroup];
    }
    const sightingRadius = THREE.MathUtils.lerp(
      COMPANION_ORBS.sightingMinDistance,
      COMPANION_ORBS.sightingMaxDistance,
      (orb.radius - COMPANION_ORBS.minDistance) / Math.max(0.001, COMPANION_ORBS.maxDistance - COMPANION_ORBS.minDistance)
    );
    let effectiveRadiusBase = THREE.MathUtils.lerp(orb.radius, sightingRadius, sightingPull);

    // v2.20 — STILLNESS GATHERING. When the user stops scrolling, the other travellers drift a
    // little closer rather than continuing past. Almost every scroll-driven piece punishes
    // stopping (nothing happens, or you're simply stuck); answering it is the calmest move
    // available here, and it's the literal content of the orb's own line: "However long this takes
    // you, it's exactly enough." See config.js's SCROLL_FEEL block.
    //
    // Rides the same continuous, fully-reversible shape as sightingPull above (scroll again and
    // they ease straight back out), so it stays resonance-not-response: it decays to baseline on
    // its own and gates nothing.
    const stillnessGather = orbStillness * (SCROLL_FEEL.stillnessGatherFraction ?? 0);
    if (stillnessGather > 0) {
      effectiveRadiusBase = THREE.MathUtils.lerp(
        effectiveRadiusBase,
        Math.max(COMPANION_ORBS.sightingMinDistance, effectiveRadiusBase * 0.55),
        stillnessGather
      );
    }

    const wrappedDist =
      cameraAxialDistance +
      (((orb.axialOffset - cameraAxialDistance) % COMPANION_WRAP_SPAN) + COMPANION_WRAP_SPAN) %
        COMPANION_WRAP_SPAN -
      COMPANION_WRAP_SPAN / 2;

    // v2.9 FIX — real, serious bug, not tuning: this modular wrap (the SAME recycling technique
    // the particle-streak field also uses) has an unavoidable, exact-once-per-period discontinuity
    // in `wrappedDist` at +-COMPANION_WRAP_SPAN/2 from the camera — every orb crosses it once per
    // lap by construction, teleporting up to COMPANION_WRAP_SPAN meters (~299m) along the axis in
    // a single frame. This is fine IF (and only if) the orb is fully faded out at that exact
    // moment — which the streak field's own OWN wrap already guarantees via its `densityVisibility`
    // curve, but companion orbs never did: opacity here was purely a function of
    // state.beat === 'traverse' (fully in or fully out), completely independent of how close an
    // orb sat to its own wrap seam. Verified directly by executing the real per-frame update loop
    // against a live camera position sweep: orbs were measured teleporting 200-290m while still at
    // FULL opacity (1.0) — a real, visible "awkward" jump, not a subtle artifact. This is the
    // actual mechanical cause of feedback "the movement of the orbs are very awkward" (a separate,
    // more fundamental bug than the vision-encounter surround-anchor snap fixed above, and one that
    // predates this session's own changes — it simply wasn't obviously visible with the old small,
    // dim, non-glowing sphere orbs).
    //
    // Fixed by fading opacity toward 0 as |wrappedDist relative to camera| approaches the wrap
    // boundary (COMPANION_WRAP_SPAN/2), smoothstepped over WRAP_FADE_ZONE meters of margin, so
    // every orb is provably invisible (opacity 0) at the exact instant its own wrappedDist recycles
    // — the discontinuity in POSITION still exists (it always will, by construction of this
    // recycling technique) but it can no longer be SEEN, which is the actual guarantee "generous
    // enough that recycling never pops visibly" was always supposed to provide and never verified.
    const distanceFromCamera = Math.abs(wrappedDist - cameraAxialDistance);
    const wrapEdge = COMPANION_WRAP_SPAN / 2;
    // THREE.MathUtils.smoothstep(x, min, max) returns 0 at/below min, 1 at/above max — so this
    // rises from 0 to 1 as distanceFromCamera approaches the wrap edge; visibility is its inverse.
    const wrapFadeVisibility = 1 - THREE.MathUtils.smoothstep(distanceFromCamera, wrapEdge - WRAP_FADE_ZONE, wrapEdge);

    // v2.3 FIX (ARCHITECTURE.md's explicit instruction): lateral/vertical placement used to assume
    // world-X/world-Y were always "sideways"/"up" from the axis (Math.cos(angle)*radius on X,
    // Math.sin(angle)*radius+bob on Y) — valid only because the old axis was a fixed (0,0,-1)
    // line. Now that the tangent varies continuously along the curved path, that assumption breaks
    // (an orb "to the right of the axis" at one point on the curve would end up somewhere entirely
    // different once the curve has banked). Fixed by sampling the curve's own center point +
    // tangent at this orb's wrappedDist, deriving a proper local frame (right = tangent x WORLD_UP,
    // up = right x tangent, per localFrameFromTangent), and placing the orb's radial
    // angle/radius/bob offset IN THAT FRAME instead of raw world X/Y.
    const effectiveAngle = orb.angle + angleDrift;
    // v2.3 FIX (storyteller review): effectiveRadiusBase (seeded up to COMPANION_ORBS.maxDistance)
    // plus radiusDrift (up to +-2.5 * driftRadiusScale, itself seeded up to 1.5x — see
    // makeCompanionOrbs) was summed with no clamp back into the tunnel's own bounds. An orb seeded
    // near maxDistance (12m) with a high driftRadiusScale could reach an effective radius past
    // VORTEX.tunnelRadiusMax (14m) — a periodic, smaller-scale recurrence of the exact "settle
    // within the bound of the portal pathway" bug item 4 was supposed to fix outright, this time
    // introduced by item 7's own per-orb radial variation rather than left over from the original
    // bug. Fixed by clamping the final effective radius back into
    // [tunnelRadiusMin, tunnelRadiusMax] (with the same small inward margin config.js's own
    // COMPANION_ORBS comment already calls for) every frame, after the drift/sighting terms are
    // summed, so no combination of seeded scale + noise excursion can ever place an orb outside the
    // visible tunnel regardless of how the individually-varied motion happens to combine this frame.
    const COMPANION_RADIUS_MARGIN = 0.5; // meters of inward margin from tunnelRadiusMax, matching
                                          // config.js's own "so they never clip through the outer
                                          // edge" intent for the base seeded distances
    const effectiveRadius = THREE.MathUtils.clamp(
      effectiveRadiusBase + radiusDrift,
      VORTEX.tunnelRadiusMin,
      VORTEX.tunnelRadiusMax - COMPANION_RADIUS_MARGIN
    );

    axisPointAt(wrappedDist, _companionAxisPoint);
    axisTangentAt(wrappedDist, _companionAxisTangent);
    localFrameFromTangent(_companionAxisTangent, _frameRight, _frameUp);

    _companionPos
      .copy(_companionAxisPoint)
      .addScaledVector(_frameRight, Math.cos(effectiveAngle) * effectiveRadius)
      .addScaledVector(_frameUp, Math.sin(effectiveAngle) * effectiveRadius + bob);

    // --- v2.7, NEW, REDESIGNED v2.8, FIXED v2.9 — vision-encounter "surround": if this orb
    // PARTICIPATES in this behavior at all (orb.surroundsVisions, a stable subset of the
    // population, per COMPANION_ORBS.visionSurroundFraction), blend its position from the ambient
    // travel-axis-relative spot above toward orbiting a LOCKED target anchor's own world position
    // — continuous, reversible, exactly the same "smoothed per-orb readout of a shared strength
    // signal" shape convergeT already uses (never a snap, tracks up AND down as the user scrolls
    // back and forth past an encounter).
    //
    // v2.9 FIX: the target anchor is now only ever (re)adopted once this orb has fully released
    // its PREVIOUS lock (orb.surroundT decayed near 0) — see orb.lockedVisionAnchor's own
    // construction-time comment for the full "why" (a real, measured position-snap bug at v2.8's
    // encounter density, not a tuning tweak). `nearestSurround` is still resolved fresh every
    // frame (cheap, shared across all orbs), but each orb decides independently whether it's free
    // to adopt whatever that lookup currently reports as nearest.
    if (orb.surroundT < 0.01) {
      orb.lockedVisionAnchor = orb.surroundsVisions ? nearestSurround.anchor : null;
    }
    // Strength target is 0 unless the CURRENTLY nearest anchor is the one this orb has locked onto
    // — if the nearest one has moved on to a different encounter while this orb is still easing
    // out of its old lock, that's exactly the release-to-zero this fix depends on, not a reason to
    // re-target early.
    const targetSurroundStrength =
      orb.surroundsVisions && nearestSurround.anchor === orb.lockedVisionAnchor ? nearestSurround.strength : 0;
    const surroundLerpRate = 1 - Math.exp(-4 * frameDt);
    orb.surroundT += (targetSurroundStrength - orb.surroundT) * surroundLerpRate;
    if (orb.surroundT > 0.001 && orb.lockedVisionAnchor) {
      const surroundEased = orb.surroundT * orb.surroundT * (3 - 2 * orb.surroundT); // smoothstep, same shape as convergeT's own eased readout
      const angle = orb.surroundAngle + elapsed * 0.12 * orb.surroundSpeedScale; // slow, continuous orbit around the anchor — "lively," not static sentries
      _surroundOffset.set(
        Math.cos(angle) * VISION_ENCOUNTER.surroundRadius,
        orb.surroundHeight,
        Math.sin(angle) * VISION_ENCOUNTER.surroundRadius
      );
      _surroundPos.copy(orb.lockedVisionAnchor).add(_surroundOffset);
      // v2.9 FIX: `_companionPos` (the ambient "from" side of this blend) can be mid-wrap right
      // now — verified directly: even a SMALL lerp weight toward surroundPos still leaves a large
      // ABSOLUTE position jump when the ambient side itself just teleported ~289m (a small weight
      // times an enormous jump is still a visible jump). `wrapFadeVisibility` (computed above,
      // 0 = ambient position is untrustworthy right at its own wrap seam) is used here as a floor
      // on the blend weight toward the always-safe surroundPos — the blend commits fully to
      // surroundPos the instant the ambient reference becomes unreliable, rather than partially
      // trusting a value that just discontinuously jumped. This composes correctly with the
      // opacity side of this same fix: the identical wrap event that forces this position commit
      // also drives `visibilityFade` (below) toward wrapFadeVisibility, so if surroundT is still
      // low when a wrap coincidentally happens, the orb is ALSO dim at that exact moment — no
      // visible "pop" to the surround position at meaningful opacity.
      const effectiveSurroundEased = Math.max(surroundEased, 1 - wrapFadeVisibility);
      _companionPos.lerp(_surroundPos, effectiveSurroundEased);
    }

    // --- Ambient fade in/out (unaffected by convergence — this is the same `traverse`-gated
    // opacity damp v2.1/v2.2 always used), then blend toward the converged look on top ------------
    // v2.9: opacity is now tracked as a plain per-orb scalar (orb.opacity) rather than written
    // directly to a single mesh.material.opacity — since v2.9's glow-sprite rendering (see
    // makeCompanionOrbs) gives each orb a core+halo SPRITE PAIR, not one material, the two are
    // driven from this one shared scalar at the end of the loop (halo dimmer than core, so the
    // pair reads as one soft falloff rather than two equally-bright discs).
    const targetAmbientOpacity = inTraverse ? orb.baseOpacity : 0;
    orb.opacity = THREE.MathUtils.damp(orb.opacity ?? 0, targetAmbientOpacity, 3, frameDt);
    // v2.9 FIX: the wrap-fade computed above must only suppress the AMBIENT contribution — once an
    // orb has committed to surrounding a vision encounter (surroundEased above), its rendered
    // position is dominated by that encounter's own (always camera-visible) anchor, not its
    // ambient wrappedDist, so gating final visibility on the ambient wrap-fade unconditionally
    // would make an orb that's clearly, correctly visible next to a vision encounter incorrectly
    // flicker invisible whenever its OWN independent ambient tracker happened to be mid-wrap at
    // that moment — a new, avoidable bug this fix must not introduce. Blended by the same
    // surroundEased term position/opacity already compose by elsewhere in this loop.
    const visibilityFade = THREE.MathUtils.lerp(wrapFadeVisibility, 1, orb.surroundT);
    // v2.7: surrounding orbs get the same brightness lift sighting-pull already gives its own
    // cluster ("make the other orbs lively as well") — additive with sightingPull rather than
    // exclusive, though in practice an orb only ever belongs to one of the two groups at once
    // (makeCompanionOrbs' disjoint index-range assignment).
    // v2.20: gathered companions also brighten slightly, so resting reads as being ANSWERED
    // rather than merely as the world going quiet.
    const ambientOpacity = Math.min(
      1,
      orb.opacity *
        visibilityFade *
        (1 + sightingPull * 0.5 + orb.surroundT * 0.6 + orbStillness * (SCROLL_FEEL.stillnessGatherLift ?? 0))
    );

    // --- Blend position/opacity/color continuously between "ambient drift" and "converged into
    // the overflow light" by `eased`, rather than switching wholesale between two code paths —
    // this is what makes the motion reversible: at eased=0 this is pixel-identical to the old pure
    // ambient behavior, at eased=1 it's pixel-identical to the old fully-converged behavior, and
    // every value in between is a genuine, continuous interpolation the user's own scroll drives
    // directly (CONCEPT.md v2.4 item 6: "it needs to flow with the scroll").
    if (COMPANION_ORBS.convergeAtEnd && eased > 0) {
      orb.mesh.position.copy(_companionPos).lerp(_overflowLightPos, eased);
      orb.opacity = THREE.MathUtils.lerp(ambientOpacity, orb.baseOpacity * (1 - eased), eased);
    } else {
      orb.mesh.position.copy(_companionPos);
      orb.opacity = ambientOpacity;
    }
    orb.mesh.visible = orb.opacity > 0.005;

    if (!orb.mesh.visible) continue;

    // v2.3 (CONCEPT.md item 7): a brief ambient-event flare — brightens (not just opacity, an
    // actual warm-white color lift so it reads as a momentary bloom rather than just "less dim")
    // this orb's cluster if it belongs to a currently-active AMBIENT_EVENTS anchor. Deliberately a
    // separate, additive effect from the sighting pull above (never the same orbs at the same
    // time, per makeCompanionOrbs' disjoint group assignment) and capped low enough to stay well
    // under the Guiding Orb's own brightness ceiling — this is texture, not a second guide.
    let ambientFlare = 0;
    if (orb.ambientEventGroup >= 0 && ambientStrengths[orb.ambientEventGroup] > 0) {
      ambientFlare = ambientStrengths[orb.ambientEventGroup];
    }
    // Color: this orb's OWN diverse hue (v2.8 — orb.baseColor, not the old shared flat
    // COMPANION_ORBS.color), warming toward the overflow palette both from the convergence blend
    // (echoing the guide orb's own dissolve-color blend, capped well short of the single hard
    // color pivot — non-negotiable #2) AND, additively, from any active ambient-event flare. Every
    // orb still converges toward the exact same overflow color at the end (eased -> 1 washes out
    // individual hue toward _colorEnd) — diversity lives in the ambient/mid-journey look, not the
    // finale, so "everyone finds their way, together" still reads as one unified arrival.
    _companionOrbColor.copy(orb.baseColor).lerp(_colorEnd, eased * 0.6);
    if (ambientFlare > 0) {
      _companionOrbColor.lerp(_colorEnd, ambientFlare * 0.35);
      orb.opacity = Math.min(1, orb.opacity * (1 + ambientFlare * (AMBIENT_EVENTS.brightnessBoost - 1)));
    }

    // v2.9: write the final resolved opacity/color onto BOTH the core and halo sprites — halo
    // scaled dimmer (HALO_OPACITY_SCALE) so the pair reads as one soft glow with a brighter center,
    // not two equally-bright overlapping discs.
    orb.core.material.opacity = orb.opacity;
    orb.core.material.color.copy(_companionOrbColor);
    orb.halo.material.opacity = orb.opacity * HALO_OPACITY_SCALE;
    orb.halo.material.color.copy(_companionOrbColor);
  }
}

/**
 * updateVortex(handle, state, camera, dt)
 * Advances the flow field every frame: recycles streaks past the camera's current axial position
 * (wrap, same trick as v1's void light-streaks), applies the vortex's spiral twist
 * (VORTEX.vortexTwistRate) as a function of axial distance so the field reads as a
 * spiraling/twisting tunnel converging toward a dark point ahead, and colors/brightens each
 * instance from state.color.mixT / state.pulse.bpm / state.turnCue.amount / VORTEX.livingCycle's
 * slow real-elapsed-time modulation (v2.2) — never from a scene PointLight (see this file's header
 * comment on the lighting lesson). Also advances the companion-orb population (v2.1 ambience,
 * v2.2 sightings + end-of-journey convergence, see updateCompanionOrbs), writes
 * state.vortex.travelSpeed (v2.2, signed meters/second) so postfx.js can tie "feels fast"
 * perception cues to real camera speed rather than only the Act I beat, and (v2.2 item 7) consumes
 * that same travelSpeed itself to brighten/stretch the streak field a little at speed during
 * traverse — the concrete "streak intensity tied to scroll speed" half of item 7 this file's own
 * material-authoring territory is responsible for.
 *
 * v2.3 NOTE on the `camera` parameter: kept in the signature (main.js's call site is unchanged)
 * even though this function's own internal math no longer reads camera.position for anything —
 * arc-length-along-the-axis is now sourced exclusively from resolveTravelArcLength(state), the
 * beat-authoritative signal, rather than back-solving it from the rendered camera position (see
 * that function's own header comment for why camera.position.z stopped being a valid proxy once
 * the axis became a curve). `camera` is threaded through only for signature stability and in case
 * a future consumer of this function genuinely needs the rendered position for something this
 * module doesn't already track via `state`.
 */
let _lastAxialDistance = null;

export function updateVortex(handle, state, camera, dt) {
  if (!handle) return;
  const { mesh, streaks } = handle;

  updateCompanionOrbs(handle, state, camera, dt);

  // v2.3 FIX: this used to read `-camera.position.z` directly as the "how far along the axis has
  // the camera travelled" signal driving BOTH the velocity cue below AND (further down) the
  // streak-field's own recycling/twist/regional-lookup math. That was only ever a valid arc-length
  // proxy because the old axis was literally the world Z line; the curved path (this module's own
  // v2.3 change) moves through X/Y too, so raw camera.position.z would silently desync every
  // per-frame lookup that used to derive "where are we" from it. Fixed by reading
  // resolveTravelArcLength(state) instead — the same beat-authoritative arc-length
  // getCameraRigPosition/updateCompanionOrbs already use, never the rendered position.
  const axialDistanceNow = resolveTravelArcLength(state);
  let travelSpeed = 0;
  if (_lastAxialDistance !== null && dt > 0) {
    travelSpeed = (axialDistanceNow - _lastAxialDistance) / dt;
  }
  _lastAxialDistance = axialDistanceNow;
  state.vortex = state.vortex || {};
  state.vortex.travelSpeed = travelSpeed;

  const mixT = THREE.MathUtils.clamp(state.color?.mixT ?? 0, 0, 1);
  const bpm = state.pulse?.bpm || PULSE.bpmStart;
  const pulseHz = bpm / 60;
  const turnCueAmount = THREE.MathUtils.clamp(state.turnCue?.amount ?? 0, 0, 1);

  // v2.2 living cycle: a slow sine modulation over REAL ELAPSED TRAVERSE TIME (never progress,
  // never a frozen/global clock — see this module's header comment and ARCHITECTURE.md's
  // frozen-clock bug-class warning), so the field keeps subtly breathing/evolving even if the user
  // lingers on one spot via backward scroll or a long idle-drift. Held at its neutral multiplier
  // (1) outside the traverse phase — fall-in/return already have their own dedicated brightness
  // scripts below and shouldn't additionally wobble.
  const livingMultiplier =
    state.beat === 'traverse' ? livingCycleMultiplier(state.traverse?.elapsedSeconds ?? 0) : 1;

  // v2.2 item 7 ("feels fast" perception cue, ARCHITECTURE.md's vortex.js section: "streak
  // intensity tied to scroll speed"): normalize the just-computed travelSpeed against the
  // fastest achievable FORWARD pace (VORTEX.travelSpan / SCROLL.minDuration) into a 0..1 term,
  // gated to `traverse` only (fall-in/return have their own dedicated brightness scripts and a
  // fixed, autoplay-driven pace that doesn't need this cue). Drives a gentle per-streak
  // brightness boost AND a length stretch (elongating the streak's own long axis a little further
  // at speed, on top of the density-driven shrink already applied below) — a real "motion-blur-
  // adjacent" cue realized entirely through this module's own material/geometry authoring, not
  // through postfx.js's EffectPass grouping.
  const speedT = state.beat === 'traverse'
    ? THREE.MathUtils.clamp(Math.abs(travelSpeed) / Math.max(VORTEX.travelSpan / SCROLL.minDuration, 0.001), 0, 1)
    : 0;
  const speedBrightness = 1 + speedT * 0.25; // v2.17: +40% -> +25% (calm pass) — brighter at max forward pace, without glare
  const speedStretch = 1 + speedT * 0.6; // up to +60% longer streaks at max forward pace

  // v2.2 click/tap ripple burst (CONCEPT.md item 5: "a click/tap-triggered particle-burst
  // ripple... distinct from the existing passive gaze-driven wake trail so it has its own more
  // deliberate payoff"). interaction.js writes state.ripple.clickBurst (0..RIPPLE.clickBoostGain,
  // decaying over RIPPLE.clickFadeDurationSeconds) but — per the interaction-designer's review —
  // nothing downstream ever rendered it, so a click/tap previously had zero visible effect
  // anywhere. This is the concrete payoff: streaks nearer the tunnel's inner radius (the most
  // visually salient, closest-to-camera band) get a brighter, snappier boost than ones further
  // out, reading as a burst radiating from the field's own core rather than a flat global wash —
  // deliberately a different visual shape from both the gentler per-frame livingCycle breathing
  // and the speed-linked brighten above, so a click reads as its own distinct event.
  const clickBurstAmount = Math.max(0, state.ripple?.clickBurst ?? 0);

  // The field's overall opacity: near-invisible at the very start of the fall (Act I is meant to
  // read as "almost no light sources yet", CONCEPT.md v2 Section 4), igniting as `catch` resolves
  // into `traverse`, staying lit through the return phase (streaks keep flowing/carrying the
  // light "spilling like liquid" per Section 4, rather than switching off once Act III begins).
  // v2.1: no more 'silhouette' beat providing an initial dim-but-visible frame before `drop`
  // starts — `drop` itself now begins at that same dim 0.15 floor at t=0, since motion (and the
  // Guiding Orb's ignition alongside it) starts immediately with nothing preceding it.
  const beat = state.beat;
  let fieldOpacity = 1;
  if (beat === 'drop' || beat === 'freefall') fieldOpacity = 0.15 + 0.25 * (state.beatProgress ?? 0);
  else if (beat === 'catch') fieldOpacity = 0.4 + 0.6 * (state.beatProgress ?? 0);
  mesh.material.opacity = THREE.MathUtils.damp(mesh.material.opacity || 0, fieldOpacity, 6, dt || 0.016);

  // Camera's current arc-length travel distance (v2.3: along the curved path, via
  // resolveTravelArcLength — NOT camera.position.z, see this function's header comment above),
  // used both for recycling and for the spiral twist phase — reuses the same axialDistanceNow this
  // function already computed above for the velocity-linked speed cue, keeping this update pass
  // beat-agnostic and avoiding a second redundant lookup.
  const cameraAxialDistance = axialDistanceNow;

  _instColor.copy(_colorBase).lerp(_colorEnd, mixT); // this frame's shared teal->gold base color

  // v2.18 — the Guiding Orb's cast light (see GUIDE.castRadius in config.js for the full
  // rationale). Resolved once per frame here, consumed per-instance in the loop below. Null
  // during any beat where the orb doesn't exist yet or has already dissolved, in which case the
  // whole term is skipped — the field simply goes back to being lit only by itself.
  const guidePos = state.guide?.position ?? null;
  const guideCastRadius = GUIDE.castRadius ?? 0;

  // v2.20 — advance and spawn light waves. Edge-detected off scroll.js's monotonic impulseCount so
  // this module never has to re-derive "was that a distinct push?" from a noisy analog signal
  // (wheel-event granularity differs wildly between trackpad, free-spinning wheel, and touch).
  // Waves are only spawned during the traverse: it's the one act where the user has pace control,
  // so it's the only act where a push means anything.
  for (let i = 0; i < _lightWaves.length; i++) {
    if (_lightWaves[i].age < SCROLL_FEEL.waveLifetimeSeconds) _lightWaves[i].age += dt;
  }
  const impulseCount = state.scroll?.impulseCount ?? 0;
  if (impulseCount !== _lastImpulseCount) {
    if (state.beat === 'traverse') spawnLightWave(axialDistanceNow);
    _lastImpulseCount = impulseCount;
  }
  const intent = THREE.MathUtils.clamp(state.scroll?.intent ?? 0, 0, 1);
  const stillness = THREE.MathUtils.clamp(state.scroll?.stillness ?? 0, 0, 1);

  for (let i = 0; i < streaks.length; i++) {
    const s = streaks[i];

    // Recycle: wrap the streak's axial offset so it always sits within one wrap-span of the
    // camera's current position, appearing to flow past and reset far ahead — identical
    // technique to v1's makeVoidStreaks vertical wrap, applied along the travel axis instead.
    const wrappedDist =
      cameraAxialDistance +
      (((s.axialOffset - cameraAxialDistance) % STREAK_WRAP_SPAN) + STREAK_WRAP_SPAN) % STREAK_WRAP_SPAN -
      STREAK_WRAP_SPAN / 2;

    // Spiral twist: rotate each streak's angular position as a function of how far along the
    // axis it sits, so the whole field reads as a twisting vortex tunnel (VORTEX.vortexTwistRate
    // radians per meter of travel) converging toward the dark point ahead, rather than a static
    // ring of streaks the camera simply flies through.
    const twist = wrappedDist * VORTEX.vortexTwistRate;
    const effectiveAngle = s.angle + twist;

    // v2.3 FIX: this cross-section used to be placed directly in world X/Y (Math.cos/sin(angle)*
    // radius on X/Y, -wrappedDist on Z) — correct only because the old axis was a fixed (0,0,-1)
    // line, so "world X/Y" and "the axis's own local right/up" were the same thing. Now that the
    // travel axis is a curved path (this module's own v2.3 change) whose tangent varies
    // continuously, the cross-section must be built in a LOCAL frame derived from the curve's own
    // tangent at this streak's axial position (axisPointAt/axisTangentAt + localFrameFromTangent,
    // the same fix applied to companion-orb placement above), not a fixed world assumption.
    axisPointAt(wrappedDist, _instAxisPoint);
    axisTangentAt(wrappedDist, _instAxisTangent);
    localFrameFromTangent(_instAxisTangent, _frameRight, _frameUp);

    _instPos
      .copy(_instAxisPoint)
      .addScaledVector(_frameRight, Math.cos(effectiveAngle) * s.radius)
      .addScaledVector(_frameUp, Math.sin(effectiveAngle) * s.radius);

    // v2.16 near-camera fade, SIMPLIFIED in v2.18. A streak passing within a meter or two of the
    // camera projects as an enormous shape slicing across the frame. v2.16 had to fade it through
    // BOTH scale and color, because with the old OPAQUE boxes a color-only fade went to black —
    // and a black plank is still perfectly visible against a bright field. Under v2.18's ADDITIVE
    // blending, black contributes exactly nothing to the frame, so fading the color alone makes a
    // streak genuinely invisible. The scale channel is now free for width/length only.
    //
    // v2.18 also adds the matching FAR fade — the same expression with the opposite sign. This is
    // what gives the abyss real atmospheric depth: instead of the population simply ending at its
    // wrap boundary, distant threads dissolve gradually into the void, so the tunnel reads as
    // receding into darkness rather than as a finite box of particles. (scene.fog can't do this
    // job here — every material in this codebase sets `fog: false`.)
    const camDist = _instPos.distanceTo(camera.position);
    // v2.18: near fade extended 5m -> 9m. Soft additive quads are far more visually dominant up
    // close than the old thin opaque boxes were (a soft thread that big becomes a bright bar
    // sweeping the frame), and holding the foreground back is what buys the composition its
    // negative space — the thing that actually reads as calm.
    const nearFadeT = THREE.MathUtils.clamp((camDist - 1.2) / (9 - 1.2), 0, 1);
    const nearFade = nearFadeT * nearFadeT * (3 - 2 * nearFadeT);
    const farFadeT = THREE.MathUtils.clamp((STREAK_FAR_FADE_END - camDist) / (STREAK_FAR_FADE_END - STREAK_FAR_FADE_START), 0, 1);
    const farFade = farFadeT * farFadeT * (3 - 2 * farFadeT);
    const depthFade = nearFade * farFade;

    // Regional visual variety (v2.1): a gentle, position-locked density/brightness/warmth
    // profile sampled at this streak's own current axial position — NOT random per-frame noise,
    // since the same wrappedDist always maps to the same region regardless of when/how fast the
    // camera got there (CONCEPT.md v2.1 Section 2/4). `s.densityThreshold` (seeded once at
    // creation, see makeStreaks) decides whether this particular streak is one of the ones that
    // "drops out" in the sparser stretches between regions — smoothly scaled toward zero rather
    // than an instant pop, so the density change itself reads as a fade, not a cut.
    const region = regionalProfileAt(Math.abs(wrappedDist));
    const densityVisibility = THREE.MathUtils.clamp(
      1 - (s.densityThreshold - region.density) * 2.2,
      0.08, // never fully vanish — a faint minimum presence keeps the sparser stretches from
            // reading as literal gaps in the tunnel, just thinner
      1
    );

    // Orient each streak so its long axis (local +Z, per the BoxGeometry authored above) points
    // along the flow field's actual local tangent direction — i.e. the direction of travel of a
    // point sliding along this spiral as `wrappedDist` increases, NOT merely spun about its own
    // long axis (a rotation about local +Z can never re-point a square-cross-section box's own
    // +Z axis, so the previous `setFromAxisAngle(FORWARD, effectiveAngle)` had zero visible
    // effect — every streak rendered parallel to world Z regardless of twist). The tangent has an
    // axial component (the curve's own tangent at this point, v2.3 — previously a constant -1
    // along world Z) and a tangential/angular component from the twist rate scaled by radius
    // (d/d(dist) of the angle term, expressed IN THE LOCAL FRAME's right/up, not world X/Y — v2.3),
    // so streaks visibly lean into the spiral — banked more steeply at larger radius/twist-rate,
    // exactly the "flowing along field lines... spiraling" funnel read the reference image calls
    // for, now correctly banked relative to the curve's own local frame rather than world space.
    const angularRate = VORTEX.vortexTwistRate * s.radius; // tangential speed contribution from twist
    _flowTangent
      .copy(_instAxisTangent)
      .addScaledVector(_frameRight, -Math.sin(effectiveAngle) * angularRate)
      .addScaledVector(_frameUp, Math.cos(effectiveAngle) * angularRate)
      .normalize();
    // v2.18 — BILLBOARD AROUND THE FLOW AXIS. The old BoxGeometry only needed its long axis
    // pointed along the flow (one setFromUnitVectors), because a square-section box looks the
    // same from every angle around that axis. A flat quad does not: pointing its NORMAL along the
    // flow would turn every streak edge-on-invisible while flying down the tunnel. So build a full
    // basis instead — length (+Y) pinned to the flow tangent, normal (+Z) rotated about that axis
    // to face the camera as squarely as it can. This is the standard light-streak billboard, and
    // it's what keeps the threads readable from every camera angle on the curved path.
    _toCamera.subVectors(camera.position, _instPos);
    // Component of "toward camera" perpendicular to the flow direction — the only rotation freedom
    // available once +Y is pinned.
    _streakNormal
      .copy(_toCamera)
      .addScaledVector(_flowTangent, -_toCamera.dot(_flowTangent));
    if (_streakNormal.lengthSq() < 1e-8) {
      // Degenerate: camera sits exactly along this streak's own flow axis. Any perpendicular will
      // do — reuse the local frame's right vector rather than leaving an unnormalizable basis.
      _streakNormal.copy(_frameRight);
    }
    _streakNormal.normalize();
    // Right-handed basis: x = y cross z.
    _streakRight.crossVectors(_flowTangent, _streakNormal).normalize();
    _streakBasis.makeBasis(_streakRight, _flowTangent, _streakNormal);
    _instQuat.setFromRotationMatrix(_streakBasis);
    // Scale now maps to the PLANE's axes: X = width, Y = length, Z unused (a plane has no depth).
    // The near-camera fade no longer needs the scale channel at all — see the fade block above for
    // why additive blending makes a color-only fade genuinely invisible.
    _instScale.set(1, densityVisibility * speedStretch, 1); // shrink along the streak's own long
                                              // axis (local Z) in low-density stretches — reads as
                                              // "thinning out," not a discrete instance
                                              // disappearing — and (v2.2 item 7) stretch a little
                                              // further at speed, a motion-blur-adjacent cue tied
                                              // to actual scroll pace rather than a fixed constant
    _instMatrix.compose(_instPos, _instQuat, _instScale);
    mesh.setMatrixAt(i, _instMatrix);

    // Per-instance brightness: breathing pulse (own phase, so the field doesn't strobe in
    // unison), proximity-style boost near an upcoming telegraphed turn (turnCueAmount brightens
    // streaks on the side the field is about to bank toward — approximated here as a uniform
    // brightening across the whole field, since directional-only boosting would need per-streak
    // side-awareness this module doesn't track; a uniform brighten still reads as "something is
    // building" which is the cue's function), the accent-warm tint riding mixT toward the
    // overflow palette, and (v2.2) the slow livingMultiplier breathing over real elapsed time.
    // Streak color/brightness is the ONLY place this field's visibility comes from — no scene
    // light illuminates it (see header comment).
    s.pulsePhase += dt * pulseHz * Math.PI * 2 * (0.85 + 0.3 * (i % 3 === 0 ? 1 : 0.6));
    // v2.17 (calm pass): amplitude 0.45 -> 0.24 — a ±45% brightness swing across thousands of
    // instances read as field-wide strobing, the opposite of the trance this act is for. The
    // pulse survives as a visible breath, no longer a flicker.
    const pulse = 0.72 + 0.24 * Math.sin(s.pulsePhase);

    // Overflow "catching the light" term (Act III only): CONCEPT.md v2 Section 4 asks for
    // streaks to visibly "catch and carry" the overflow light rather than just wash brighter in
    // lockstep with the rest of the field. postfx.js's GodRaysEffect is permanently unavailable
    // (documented depth-buffer crash constraint, do not re-add to any pass), so this is the
    // legitimate in-bounds realization within vortex.js's own material-authoring territory: as
    // mixT pivots warm, streaks nearer the travel axis (small radius — the ones the camera is
    // about to fly past closest, catching the most of the light source ahead on-axis) pick up an
    // extra proximity-to-light brightness term that streaks out near tunnelRadiusMax don't get,
    // so the light reads as something the near-axis particles are individually carrying toward
    // camera rather than a uniform brightness/color wash across the whole field.
    const axisProximity = 1 - THREE.MathUtils.clamp(
      (s.radius - VORTEX.tunnelRadiusMin) / (VORTEX.tunnelRadiusMax - VORTEX.tunnelRadiusMin),
      0,
      1
    );
    const catchLight = mixT * mixT * axisProximity; // only matters once the pivot is underway

    // Click/tap burst (v2.2): reuses axisProximity (already 1 near the inner radius, 0 near the
    // outer) as the same "closest, most salient band" bias, so the burst reads as radiating from
    // the field's near-axis core outward rather than a flat wash — a jitter term keeps it from
    // looking like a perfectly uniform ring snapping on all at once.
    const clickBurstBrightness = 1 + clickBurstAmount * (0.4 + axisProximity * 1.1) * s.brightnessJitter;

    // v2.18 — how strongly the Guiding Orb's own light falls on THIS thread. Squared falloff so
    // the pool has a soft, believable edge rather than a linear ramp reading as a visible disc.
    // v2.20 — this streak's share of any travelling light wave. `wrappedDist` is camera-relative,
    // so it's converted back to an absolute arc-length to compare against the wave's own fixed
    // origin (the camera keeps moving after a wave is released — the wave must not move with it,
    // or it would read as a static glow bolted to the viewer rather than light sent ahead).
    const waveBoost = lightWaveBoostAt(cameraAxialDistance + wrappedDist);

    let guideCast = 0;
    if (guidePos && guideCastRadius > 0) {
      const distToGuide = _instPos.distanceTo(guidePos);
      const reach = THREE.MathUtils.clamp(1 - distToGuide / guideCastRadius, 0, 1);
      guideCast = reach * reach;
    }

    const uncappedBrightness =
      (0.35 + pulse * 0.65) *
      s.brightnessJitter *
      (1 + turnCueAmount * 0.35) * // v2.17: 0.5 -> 0.35 (calm pass) — the turn telegraph stays legible, less shouty
      (1 + catchLight * 1.8) *
      region.brightness * // regional variety (v2.1): gentle +0..35% near a glyph/companion-orb
                           // region, unity in the sparser stretches between — see regionalProfileAt
      livingMultiplier * // v2.2: slow, subtle real-elapsed-time breathing — see livingCycleMultiplier
      speedBrightness * // v2.2 item 7: gentle brighten with actual scroll speed during traverse
      clickBurstBrightness * // v2.2: click/tap "fiddle" payoff — see state.ripple.clickBurst above
      (1 + waveBoost) * // v2.20: light the user pushed into the dark — same ceiling-clamped product
      (1 + guideCast * (GUIDE.castBrightnessGain ?? 0)); // v2.18: the orb's own cast light — deliberately
                           // INSIDE the ceiling-clamped product below, so a thread the orb lights
                           // can approach but never out-shine the orb itself
    // v2.3 FIX (light-artist review): the un-clamped product above can realistically exceed 10x
    // during ordinary interaction (fast scroll + a click near a dense/near-axis region), well past
    // the Guiding Orb's own realized brightness ceiling (GUIDE.brightnessCeiling ≈ 1.647, see
    // guide.js) — letting individual streaks visibly out-bloom the orb, a direct violation of the
    // "orb is deliberately the brightest, warmest thing in frame" non-negotiable (CONCEPT.md v2.1
    // Section 4, restated as an ONGOING quality by v2.3 item 3). Clamped to
    // STREAK_BRIGHTNESS_CEILING (config.js, a fixed headroom fraction under
    // GUIDE.brightnessCeiling) only while the orb is actually present to be out-shone — mixT only
    // starts moving at the 'turn' beat (director.js), the exact frame GUIDE.dissolveStartBeat
    // begins dissolving the orb, so gating the clamp on mixT still under way means it never
    // suppresses the DELIBERATE "streaks catch and carry the overflow light" brightening
    // (catchLight term above) once there's no orb brightness left to protect.
    // v2.20 — the ceiling now BREATHES WITH THE ORB. Without this, the light waves above would be
    // clamped flat out of existence during the traverse (mixT is 0 for the whole act, so the
    // clamp is always live then) and the whole "push light into the dark" mechanic would be
    // invisible — a real trap, caught before shipping.
    //
    // The fix preserves the non-negotiable it exists to protect ("the orb is deliberately the
    // brightest, warmest thing in frame") rather than weakening it: the ceiling is raised by
    // EXACTLY the same intent-driven factor guide.js simultaneously brightens the orb by. Both
    // rise together on a push, so their ratio — which is what "brightest in frame" actually
    // means — is invariant. Do not raise this ceiling by any factor the orb doesn't also receive.
    const intentCeilingScale = 1 + intent * (SCROLL_FEEL.orbResponseGlowGain ?? 0);
    const brightness =
      mixT > 0.01
        ? uncappedBrightness
        : Math.min(STREAK_BRIGHTNESS_CEILING * intentCeilingScale, uncappedBrightness);

    _streakColor.copy(_instColor);
    if (i % 11 === 0) {
      // A small minority of streaks carry the warm amber accent even in the cool traverse
      // palette (CONCEPT.md v2 Section 4: "pick one accent" — teal base + amber accent), giving
      // the field a little chromatic texture rather than reading as a flat single hue.
      _streakColor.lerp(_colorAccent, 0.4 * (1 - mixT));
    }
    if (region.warmth > 0) {
      // Regional hue-temperature variety (v2.1): nudge warmer, gently, only near glyph/companion-
      // orb regions — a fraction of the SAME accent color the field already uses elsewhere, never
      // a new hue, and capped low (regionalProfileAt caps warmth at ~0.22) so it reads as "this
      // stretch feels a little warmer/denser," not a second hard pivot (non-negotiable #2).
      _streakColor.lerp(_colorAccent, region.warmth * (1 - mixT));
    }
    // v2.18: threads inside the orb's pool also take on its HUE, not just its brightness — light
    // that doesn't change the color of what it falls on doesn't read as light. Applied after the
    // accent/warmth tints and before the brightness multiply, so it layers over the field's own
    // palette exactly the way a real warm source would.
    if (guideCast > 0) {
      _streakColor.lerp(_colorGuide, guideCast * (GUIDE.castWarmth ?? 0) * (1 - mixT));
    }
    _streakColor.multiplyScalar(brightness * depthFade);

    mesh.setColorAt(i, _streakColor);
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}
