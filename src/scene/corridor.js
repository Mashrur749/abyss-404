// src/scene/corridor.js
//
// Builds the fixed unicursal labyrinth path: a single CatmullRomCurve3 spline (one route,
// zero branches — the labyrinth-not-maze non-negotiable from CONCEPT.md Section 0) and the
// modular wall/floor/ceiling geometry that repeats along it via THREE.InstancedMesh.
//
// This module owns:
//   - the corridor spline (the only source of path-following truth; camera.js/glyphs.js
//     consume it but never redefine it)
//   - the instanced wall/floor/ceiling segments that dress the spline
//   - THREE.Fog, interpolated by state.color.mixT
//   - getCameraRigPosition(t): maps *global timeline* progress (t = clockTime / TOTAL_DURATION)
//     to a { position, lookAt } for the camera rig — including the open-void free-fall portion
//     that happens before the corridor is entered, per the ARCHITECTURE.md contract.

import * as THREE from 'three';
import { CORRIDOR, COLOR, BEATS, TOTAL_DURATION } from '../config.js';

// ---------------------------------------------------------------------------------------------
// Fixed unicursal waypoint layout.
//
// A labyrinth reads as a maze (lots of turns, sense of enclosure) while structurally being a
// single line with no junctions. We express that as one ordered list of waypoints — turns are
// baked into the sequence itself, so there is no data structure here that *could* branch (no
// graph, no adjacency list, just an array walked start-to-end).
//
// Segment length (CORRIDOR.segmentLength) is the unit the waypoint plan is authored in below,
// keeping the route's proportions legible and easy to re-tune. The instanced wall/floor/ceiling
// segments are placed independently by arc-length along the resulting curve (not snapped to
// these waypoints 1:1), so they tile continuously regardless of each leg's exact length.
// ---------------------------------------------------------------------------------------------

const SEG = CORRIDOR.segmentLength;

// Turn sequence (unitless, in segment-lengths) describing a winding classical-labyrinth-esque
// route: alternating left/right turns of varying run-length so it never reads as a mechanical
// grid, but is still just one continuous line. Values are [dx, dz] deltas in segment counts.
//
// Run-lengths are deliberately short (fractions of CORRIDOR.segmentLength) — the corridor is a
// *perceptual* infinite, built from a small pool of modular segments re-encountered under fog
// (CONCEPT.md Section 3), not a physically long structure. Act II's ~19.5s duration at a slow,
// dreamlike walking pace (well under natural gait, per CAMERA.walkStepsPerSecond) covers this
// whole plan; camera.js layers the footstep-bob cadence on top independently of how far the rig
// physically travels here.
const TURN_PLAN = [
  [0, 0.6], // enter, walk forward
  [0.5, 0], // turn right
  [0, 0.7], // walk forward
  [-0.6, 0], // turn left (crosses back toward center line, but at a different z — no intersection)
  [0, 0.5], // walk forward
  [0.6, 0], // turn right
  [0, 0.8], // long forward run (heart of the trance beat)
  [-0.5, 0], // turn left
  [0, 0.6], // walk forward
  [0.5, 0], // turn right
  [0, 0.5], // walk forward
  [0, 0.6], // final approach straightens out toward the light
];

function buildWaypoints() {
  const points = [new THREE.Vector3(0, CORRIDOR_EYE_Y, 0)];
  let x = 0;
  let z = 0;
  for (const [dxSeg, dzSeg] of TURN_PLAN) {
    x += dxSeg * SEG;
    z += dzSeg * SEG;
    points.push(new THREE.Vector3(x, CORRIDOR_EYE_Y, z));
  }
  return points;
}

// Eye-level height the spline itself is authored at; camera rig sits at this height while
// walking the corridor (Act II/III). Act I (the fall) happens above/before this in open void.
const CORRIDOR_EYE_Y = 1.6;

// ---------------------------------------------------------------------------------------------
// Module-level cache so getCameraRigPosition(t) — a pure function of t per the contract — can
// still reuse the (expensive-ish) curve + arc-length table built once in createCorridor().
// If createCorridor() hasn't run yet (e.g. called before scene setup), we lazily build a
// standalone curve so getCameraRigPosition still works deterministically.
// ---------------------------------------------------------------------------------------------
let cachedCurve = null;
let cachedCurveLength = null;

function getCurve() {
  if (!cachedCurve) {
    cachedCurve = new THREE.CatmullRomCurve3(buildWaypoints(), false, 'catmullrom', 0.35);
    cachedCurveLength = cachedCurve.getLength();
  }
  return cachedCurve;
}

/** Exposed so other modules (glyphs.js) can place things along the same single path. */
export function getCorridorCurve() {
  return getCurve();
}

// ---------------------------------------------------------------------------------------------
// Turn-cue schedule (CONCEPT.md Section 3: "Turns are telegraphed before they happen ... so the
// camera can begin easing rotation early — no motion should surprise the inner ear once Act II
// begins"). TURN_PLAN's waypoints are the only authoritative record of where the path actually
// turns, so this derives each turn's spline-local arc-length parameter directly from that same
// data — anything that wants to telegraph a turn (camera.js's dutch-tilt, lighting.js's seam
// brightening) reads real turn positions instead of an unrelated fixed time schedule.
// ---------------------------------------------------------------------------------------------

// A "turn" in TURN_PLAN is any waypoint whose delta axis (x vs z) differs from the previous
// segment's delta axis — i.e. every [dx,0]/[0,dz] alternation. Waypoint index 0 is the entrance
// (never a turn); we compare consecutive plan entries starting from index 1.
function computeTurnWaypointIndices() {
  const indices = [];
  for (let i = 1; i < TURN_PLAN.length; i++) {
    const [pdx] = TURN_PLAN[i - 1];
    const [dx] = TURN_PLAN[i];
    const prevAxisIsX = pdx !== 0;
    const axisIsX = dx !== 0;
    if (axisIsX !== prevAxisIsX) indices.push(i);
  }
  return indices;
}

let cachedTurnParams = null;

/**
 * Returns the spline-local arc-length parameters (t in [0,1], same parametrization as
 * getCorridorCurve()/getPointAt) at which the path actually turns, derived from TURN_PLAN.
 */
export function getTurnCurveParams() {
  if (cachedTurnParams) return cachedTurnParams;

  const curve = getCurve();
  const curveLength = cachedCurveLength;
  const waypoints = buildWaypoints();
  const turnIndices = computeTurnWaypointIndices();

  // Waypoint i's arc-length position along the curve, approximated by summing straight-line
  // distances between waypoints (the CatmullRom spline stays close to its control points, so
  // this is an accurate-enough proxy for "how far along the path is this turn").
  const cumulative = [0];
  for (let i = 1; i < waypoints.length; i++) {
    cumulative.push(cumulative[i - 1] + waypoints[i].distanceTo(waypoints[i - 1]));
  }
  const totalApprox = cumulative[cumulative.length - 1] || curveLength;

  cachedTurnParams = turnIndices.map((i) =>
    THREE.MathUtils.clamp(cumulative[i] / totalApprox, 0, 1)
  );
  return cachedTurnParams;
}

// ---------------------------------------------------------------------------------------------
// Modular segment geometry (wall / floor / ceiling), instanced and repeated along the spline.
// CORRIDOR.segmentPoolSize instances of each are allocated and distributed evenly along the
// curve's arc length (wrapping via modulo if segmentPoolSize * segmentLength exceeds the curve's
// actual length, or spacing out more sparsely if it's shorter). Segments are modular (same
// geometry re-used) but are placed using the curve's actual position/tangent, so the geometry
// follows the winding path rather than sitting on a straight line — this is the "modular repeat
// + fog occlusion" trick from CONCEPT.md Section 3.
// ---------------------------------------------------------------------------------------------

const CORRIDOR_WIDTH = 4; // meters — "cathedral aisle", not coffin-close (CONCEPT.md Section 2)
const WALL_HEIGHT = 1.6 * CORRIDOR.wallHeightMultiplier;

function makeWallGeometry() {
  return new THREE.BoxGeometry(SEG, WALL_HEIGHT, 0.4);
}

function makeFloorGeometry() {
  return new THREE.BoxGeometry(SEG, 0.2, CORRIDOR_WIDTH);
}

function makeCeilingGeometry() {
  return new THREE.BoxGeometry(SEG, 0.2, CORRIDOR_WIDTH);
}

function makeSegmentMaterial() {
  // Emissive-capable so lighting.js's bloom pass has something to react to on the wall seams;
  // actual light *sources* are owned exclusively by lighting.js (per ARCHITECTURE.md contract) —
  // this material just needs to be lit and to carry a faint self-emissive seam tint.
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(COLOR.labyrinthBase),
    emissive: new THREE.Color(COLOR.labyrinthAccent),
    emissiveIntensity: 0.05,
    roughness: 0.85,
    metalness: 0.1,
    fog: true,
  });
}

const UP = new THREE.Vector3(0, 1, 0);
const _pos = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _matrix = new THREE.Matrix4();
const _scale = new THREE.Vector3(1, 1, 1);

// ---------------------------------------------------------------------------------------------
// Act I void light-streaks (CONCEPT.md Section 2: "Depth cue: thin vertical light-streaks (like
// Rothko-esque bands of dim color) rush past and elongate with motion blur, giving speed without
// needing detailed geometry to render"). The void the camera falls through (getCameraRigPosition's
// Act I branch, above) has zero geometry, so without this there is nothing to convey velocity
// during the fall except camera roll/bloom. This is deliberately cheap: a handful of thin,
// vertically-elongated emissive bars scattered around the fall axis, scrolled past the camera as
// clockTime advances. They live entirely inside corridor.js (the module that already owns the
// void-fall's spatial logic) and use MeshBasicMaterial (unlit, so they don't need lighting.js's
// involvement) — this is scenery, not a light source, so it doesn't violate lighting.js's
// exclusive-light-ownership contract.
// ---------------------------------------------------------------------------------------------

const STREAK_COUNT = 22;
const STREAK_RADIUS_MIN = 3.5;
const STREAK_RADIUS_MAX = 11;
const STREAK_LENGTH = 14; // meters, elongated to read as motion-blurred even before any blur pass
const STREAK_WIDTH = 0.06;
const STREAK_SPAN_Y = 90; // vertical span the pool of streaks is distributed/wrapped across

function makeVoidStreaks(scene) {
  const geometry = new THREE.BoxGeometry(STREAK_WIDTH, STREAK_LENGTH, STREAK_WIDTH);
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(COLOR.labyrinthAccent),
    transparent: true,
    opacity: 0,
    toneMapped: false,
    fog: false,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, STREAK_COUNT);
  mesh.name = 'void-light-streaks';
  mesh.frustumCulled = false;

  const streaks = [];
  for (let i = 0; i < STREAK_COUNT; i++) {
    const angle = (i / STREAK_COUNT) * Math.PI * 2 + Math.random() * 0.3;
    const radius = THREE.MathUtils.lerp(STREAK_RADIUS_MIN, STREAK_RADIUS_MAX, Math.random());
    streaks.push({
      angle,
      radius,
      // Base Y offset within the wrap span, re-randomized so streaks don't all "reset" in
      // lockstep once they wrap back above the camera.
      yOffset: Math.random() * STREAK_SPAN_Y,
    });
  }

  scene.add(mesh);
  return { mesh, streaks };
}

/**
 * Advances the void light-streaks each frame: scrolls them past the camera along Y (proportional
 * to fall progress, matching the sharp ease-in of the drop) and fades their opacity in during
 * drop/freefall, out during catch — invisible outside Act I.
 */
function updateVoidStreaks(handle, state, cameraY) {
  const { mesh, streaks } = handle;
  const beat = state.beat;
  const isFallBeat = beat === 'drop' || beat === 'freefall' || beat === 'catch';

  let targetOpacity = 0;
  if (beat === 'drop' || beat === 'freefall') targetOpacity = 0.85;
  else if (beat === 'catch') targetOpacity = 0.85 * (1 - (state.beatProgress ?? 0));

  mesh.material.opacity = THREE.MathUtils.damp(
    mesh.material.opacity,
    targetOpacity,
    8,
    state.dt || 0.016
  );

  if (!isFallBeat && mesh.material.opacity < 0.01) {
    mesh.visible = false;
    return;
  }
  mesh.visible = true;

  // Streaks scroll relative to the camera's fall so they always appear to rush upward past it
  // (falling reads as the world moving up relative to the camera). Wrapping keeps a fixed pool
  // of instances covering an effectively endless rush, per the "speed without detailed geometry"
  // intent — identical trick to the corridor's own modular-repeat approach in Act II.
  for (let i = 0; i < streaks.length; i++) {
    const s = streaks[i];
    const wrappedY =
      cameraY + (((s.yOffset - cameraY) % STREAK_SPAN_Y) + STREAK_SPAN_Y) % STREAK_SPAN_Y - STREAK_SPAN_Y / 2;

    _pos.set(Math.cos(s.angle) * s.radius, wrappedY, Math.sin(s.angle) * s.radius);
    _quat.identity();
    _matrix.compose(_pos, _quat, _scale);
    mesh.setMatrixAt(i, _matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

/**
 * Places `count` modular instances of a given InstancedMesh evenly along the curve, oriented to
 * the curve's tangent at that point, offset sideways/vertically by `lateral`/`vertical` (so the
 * same wall geometry can be reused for the left wall, right wall, floor, ceiling).
 */
function placeInstancesAlongCurve(mesh, curve, curveLength, count, lateral, vertical, yawOffset) {
  for (let i = 0; i < count; i++) {
    // Distribute across the whole path length, one modular chunk per SEG of arc length.
    // getPointAt/getTangentAt take a uniform arc-length parameter (u), which is exactly what
    // we want here so segments space out evenly regardless of how the underlying spline's
    // internal t-parametrization bunches up around turns.
    const distance = (i * SEG + SEG * 0.5) % curveLength;
    const t = THREE.MathUtils.clamp(distance / curveLength, 0, 1);

    curve.getPointAt(t, _pos);
    curve.getTangentAt(t, _tangent).normalize();

    // Build an orientation whose local +X axis follows the tangent (segments are authored
    // lying along X), keeping "up" world-aligned so walls stay vertical through turns.
    const yaw = Math.atan2(_tangent.x, _tangent.z);
    _quat.setFromAxisAngle(UP, yaw + Math.PI / 2 + yawOffset);

    // Lateral offset (perpendicular to tangent, on the ground plane) and vertical offset.
    const side = new THREE.Vector3(-_tangent.z, 0, _tangent.x).normalize();
    const placed = _pos.clone()
      .addScaledVector(side, lateral)
      .add(new THREE.Vector3(0, vertical, 0));

    _matrix.compose(placed, _quat, _scale);
    mesh.setMatrixAt(i, _matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
}

/**
 * createCorridor(scene)
 * Builds the spline, the instanced wall/floor/ceiling meshes, and applies THREE.Fog to the
 * scene. Returns a handle object modules can use to update fog color / read the curve, though
 * per the contract the canonical path accessor is getCorridorCurve()/getCameraRigPosition(t).
 */
export function createCorridor(scene) {
  const curve = getCurve();
  const curveLength = cachedCurveLength;
  const poolSize = CORRIDOR.segmentPoolSize;

  const wallGeo = makeWallGeometry();
  const floorGeo = makeFloorGeometry();
  const ceilingGeo = makeCeilingGeometry();
  const material = makeSegmentMaterial();

  const leftWalls = new THREE.InstancedMesh(wallGeo, material, poolSize);
  const rightWalls = new THREE.InstancedMesh(wallGeo, material, poolSize);
  const floors = new THREE.InstancedMesh(floorGeo, material, poolSize);
  const ceilings = new THREE.InstancedMesh(ceilingGeo, material, poolSize);

  leftWalls.name = 'corridor-left-walls';
  rightWalls.name = 'corridor-right-walls';
  floors.name = 'corridor-floors';
  ceilings.name = 'corridor-ceilings';

  const halfWidth = CORRIDOR_WIDTH / 2;

  placeInstancesAlongCurve(leftWalls, curve, curveLength, poolSize, -halfWidth, WALL_HEIGHT / 2, 0);
  placeInstancesAlongCurve(rightWalls, curve, curveLength, poolSize, halfWidth, WALL_HEIGHT / 2, 0);
  placeInstancesAlongCurve(floors, curve, curveLength, poolSize, 0, 0, 0);
  placeInstancesAlongCurve(ceilings, curve, curveLength, poolSize, 0, WALL_HEIGHT, 0);

  scene.add(leftWalls, rightWalls, floors, ceilings);

  // Fog: interpolated by state.color.mixT each frame via updateCorridorFog(). Seed with the
  // Act II base color; CORRIDOR.fogNear/fogFar are fixed per the contract (only color animates).
  const fog = new THREE.Fog(new THREE.Color(COLOR.labyrinthBase), CORRIDOR.fogNear, CORRIDOR.fogFar);
  scene.fog = fog;

  const colorA = new THREE.Color(COLOR.labyrinthBase);
  const colorB = new THREE.Color(COLOR.overflowEnd);

  const streakHandle = makeVoidStreaks(scene);

  return {
    curve,
    curveLength,
    meshes: { leftWalls, rightWalls, floors, ceilings },
    fog,

    /** Called once per frame (e.g. from main.js's update order) to keep fog in sync with state. */
    updateFog(state) {
      const mixT = THREE.MathUtils.clamp(state?.color?.mixT ?? 0, 0, 1);
      fog.color.copy(colorA).lerp(colorB, mixT);
    },

    /**
     * Called once per frame with the current state and the camera rig's world-space Y position
     * (Act I's fall happens purely along Y above the corridor entrance) to advance the void
     * light-streaks — CONCEPT.md Section 2's Act I depth cue.
     */
    updateVoidStreaks(state, cameraY) {
      updateVoidStreaks(streakHandle, state, cameraY);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// getCameraRigPosition(t)
//
// t in [0,1] maps to progress along the *entire* authored timeline (t = clockTime / TOTAL_DURATION,
// per the contract). Act I (drop/freefall/catch) happens in open void above/before the corridor
// starts; Act II (labyrinth) walks the spline start-to-end; Act III (turn/approach/overflow/iris)
// continues past the spline's end toward the light, with the camera easing to a near-stop while
// the light (placed just beyond the curve's final point, along its final tangent) grows in the
// frame per CONCEPT.md's "world stretches toward the light" beat.
// ---------------------------------------------------------------------------------------------

const VOID_DROP_START_Y = 40; // meters above the corridor entrance — the open void of Act I
const OVERFLOW_LIGHT_DISTANCE = 14; // meters the camera continues past the spline's end in Act III
// How far the "Turn" hold beat (25-28s) is allowed to creep forward before Approach's own
// ease-out takes over — a small fraction of the full Act III distance, so Turn genuinely reads
// as "slows almost to stop" rather than covering meaningful ground.
const TURN_HOLD_DISTANCE = OVERFLOW_LIGHT_DISTANCE * 0.12;

// Fraction of Act II's own span given over to bleeding walking-pace down into the Turn beat's
// starting velocity (see LABYRINTH_TAIL_BLEND_FRACTION usage below) — keeps the vast majority
// of the labyrinth walk at the "dream-logic constant pace" CONCEPT.md Section 3 describes, while
// removing the velocity discontinuity at the labyrinth->turn boundary.
const LABYRINTH_TAIL_BLEND_FRACTION = 0.12;

const _tmpPos = new THREE.Vector3();
const _tmpTangent = new THREE.Vector3();
const _tmpLook = new THREE.Vector3();

// ---------------------------------------------------------------------------------------------
// Act II labT<->clockTime mapping, shared so nothing else in the codebase re-derives (and risks
// diverging from) this module's actual walking-pace curve. Act II is constant-pace for most of
// its span, then bleeds velocity down over the final LABYRINTH_TAIL_BLEND_FRACTION to exactly
// match the Turn beat's own starting velocity (see labXToLabT below for the full rationale) —
// so anything that wants to convert a spline-local turn position (labT, arc-length fraction,
// e.g. from getTurnCurveParams()) into a clockTime for scheduling (director.js's dutch-tilt/
// turn-cue telegraphing) must use labTToClockTime() rather than assuming a linear mapping, or its
// cues will drift out of sync with the camera during the tail-blend window.
// ---------------------------------------------------------------------------------------------

function getLabyrinthPaceParams(curveLength) {
  const labSpan = BEATS.turn.start - BEATS.catch.end;
  const turnSpan = BEATS.approach.start - BEATS.turn.start;
  const turnStartVelocityWorld = (2 * TURN_HOLD_DISTANCE) / turnSpan;
  const endRate = (turnStartVelocityWorld * labSpan) / curveLength;
  const blendFraction = LABYRINTH_TAIL_BLEND_FRACTION;
  // Closed-form constant rate r0 such that a trapezoidal profile (constant r0 for the first
  // (1 - blendFraction) of the span, then power2-out decay from r0 to endRate over the last
  // blendFraction) integrates to exactly 1 across the whole span. Derived from:
  //   (1-b)*r0 + b*r1 + b*(r0-r1)/3 = 1  =>  r0 = (1 - (2b/3)*r1) / ((1-b) + b/3)
  const constRate = (1 - ((2 * blendFraction) / 3) * endRate) / (1 - blendFraction + blendFraction / 3);
  return { labSpan, blendFraction, endRate, constRate };
}

/** Clock-time fraction through Act II (labX, 0..1) -> spline-local arc-length position (labT). */
function labXToLabT(labX, pace) {
  const { blendFraction, endRate, constRate } = pace;
  const blendStartX = 1 - blendFraction;
  if (labX < blendStartX) return constRate * labX;
  const distanceAtBlendStart = constRate * blendStartX;
  const s = THREE.MathUtils.clamp((labX - blendStartX) / blendFraction, 0, 1);
  // Integral of rate(u) = endRate + (constRate-endRate)*(1-u)^2 du from 0 to s:
  //   endRate*s + (constRate-endRate) * (1 - (1-s)^3) / 3
  const decayDistance = endRate * s + ((constRate - endRate) * (1 - Math.pow(1 - s, 3))) / 3;
  return distanceAtBlendStart + blendFraction * decayDistance;
}

/** Inverse of labXToLabT: spline-local arc-length position (labT, 0..1) -> clock-time fraction (labX). */
function labTToLabX(labT, pace) {
  const { blendFraction, constRate } = pace;
  const blendStartX = 1 - blendFraction;
  const distanceAtBlendStart = constRate * blendStartX;
  if (labT <= distanceAtBlendStart) return labT / constRate;
  // Invert the decay branch numerically (monotonic, well-behaved cubic) — bisection is cheap and
  // this only ever runs for a handful of turn cues scheduled once at director.js build time, not
  // per-frame.
  let lo = blendStartX;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (labXToLabT(mid, pace) < labT) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Converts a spline-local arc-length parameter (labT, in [0,1], the same parametrization
 * getTurnCurveParams()/getCorridorCurve() use) into a global clockTime — the inverse of Act II's
 * labX->labT pace curve above. Used by director.js so turn-telegraph scheduling always matches
 * the camera's actual walking pace, including the tail-blend deceleration into the Turn beat.
 */
export function labTToClockTime(labT) {
  getCurve(); // ensure cachedCurveLength is populated even if createCorridor() hasn't run yet
  const pace = getLabyrinthPaceParams(cachedCurveLength);
  const labX = labTToLabX(THREE.MathUtils.clamp(labT, 0, 1), pace);
  return BEATS.catch.end + labX * pace.labSpan;
}

/**
 * getCameraRigPosition(t)
 * @param {number} t - normalized global timeline progress, 0..1 (clockTime / TOTAL_DURATION)
 * @returns {{ position: THREE.Vector3, lookAt: THREE.Vector3 }}
 */
export function getCameraRigPosition(t) {
  const clockTime = THREE.MathUtils.clamp(t, 0, 1) * TOTAL_DURATION;
  const curve = getCurve();
  const curveLength = cachedCurveLength;

  const entrance = curve.getPointAt(0, _tmpPos.clone());
  const entranceTangent = curve.getTangentAt(0, new THREE.Vector3()).normalize();

  // --- Act I: The Fall (trigger -> drop -> freefall -> catch) --------------------------------
  // Open void above/before the corridor entrance. The rig falls straight down onto the
  // labyrinth's starting point, arriving exactly at the corridor entrance as `catch` ends.
  if (clockTime < BEATS.catch.end) {
    // Overall fall progress 0..1 across trigger/drop/freefall/catch combined.
    const fallSpan = BEATS.catch.end - BEATS.trigger.start;
    const fallT = THREE.MathUtils.clamp((clockTime - BEATS.trigger.start) / fallSpan, 0, 1);
    // Sharp ease-in (matches EASE.drop's power4.in quality) so the drop *accelerates* into the
    // catch rather than arriving linearly — position math only; actual FOV/roll/shake live in
    // camera.js, this module only supplies the rig's position/lookAt.
    const eased = Math.pow(fallT, 4);

    const startPos = entrance.clone().add(new THREE.Vector3(0, VOID_DROP_START_Y, -entranceTangent.z * 6));
    const position = startPos.lerp(entrance, eased);

    const lookAt = position.clone().add(entranceTangent);
    return { position, lookAt };
  }

  // --- Beat 5, The Turn: a held beat, camera slows almost to a stop -------------------------
  // CONCEPT.md Section 7 (beat sheet, Beat 5 "The Turn"): "a held beat — camera slows almost
  // to stop, then a corridor ahead reveals a single point of light" — deceleration to the
  // overflow light explicitly does NOT begin until Beat 6 "The Approach" ("Ease-out
  // deceleration begins"). So this creeps forward only a small fraction of
  // OVERFLOW_LIGHT_DISTANCE (TURN_HOLD_DISTANCE), decelerating from roughly Act II's walking
  // pace down to a near-stop over the beat's own short span — a self-contained decay-to-rest,
  // not a continuation of Approach's (much larger, freshly-accelerating-again) ease-out curve.
  // This is what makes Turn read as "held" rather than being the fastest-moving moment of the
  // whole Act III approach.
  if (clockTime >= BEATS.turn.start && clockTime < BEATS.approach.start) {
    const end = curve.getPointAt(1, new THREE.Vector3());
    const endTangent = curve.getTangentAt(1, _tmpTangent.clone()).normalize();

    const turnSpan = BEATS.approach.start - BEATS.turn.start;
    const turnT = THREE.MathUtils.clamp((clockTime - BEATS.turn.start) / turnSpan, 0, 1);
    // Ease-out-to-a-crawl: fast-decaying velocity (power2.out shape) so the beat *starts* at
    // walking pace and is essentially stopped well before Approach begins — "held," not just
    // "still moving but slower."
    const eased = 1 - Math.pow(1 - turnT, 2);

    const position = end.clone().addScaledVector(endTangent, eased * TURN_HOLD_DISTANCE);
    const lookAt = position.clone().addScaledVector(endTangent, 1);
    return { position, lookAt };
  }

  // --- Act III tail: Approach -> Overflow -> Iris, continue past the spline's end toward the
  // light -----------------------------------------------------------------------------------
  // Beat 6 "The Approach" is where "ease-out deceleration begins" per the beat sheet — so this
  // branch owns its own fresh power2.out curve starting at zero velocity from Approach's start
  // (continuous in position with the Turn hold above, but intentionally a new velocity curve
  // rather than a continuation of one long ease spanning all of Turn+Approach+Overflow+Iris,
  // which would put peak velocity at the start of Turn instead of the start of Approach).
  if (clockTime >= BEATS.approach.start) {
    const end = curve.getPointAt(1, new THREE.Vector3());
    const endTangent = curve.getTangentAt(1, _tmpTangent.clone()).normalize();

    const actIIISpan = TOTAL_DURATION - BEATS.approach.start;
    const actIIIT = THREE.MathUtils.clamp((clockTime - BEATS.approach.start) / actIIISpan, 0, 1);
    // Ease-out deceleration (mirrors EASE.overflow's power2.out) — fast initial approach that
    // settles to a near-stop as the light overtakes the frame.
    const eased = 1 - Math.pow(1 - actIIIT, 2);

    const remainingDistance = OVERFLOW_LIGHT_DISTANCE - TURN_HOLD_DISTANCE;
    const position = end
      .clone()
      .addScaledVector(endTangent, TURN_HOLD_DISTANCE + eased * remainingDistance);
    const lookAt = position.clone().addScaledVector(endTangent, 1);
    return { position, lookAt };
  }

  // --- Act II: The Labyrinth — walk the spline start-to-end -----------------------------------
  // Cinematographer's-lens fix: a plain linear labT (constant walking pace for the *entire* span)
  // arrives at the Turn beat's boundary still moving at full walking speed, then the Turn branch
  // above immediately eases from a much slower analytic start velocity — a hard velocity
  // discontinuity right at the labyrinth->turn cut (CONCEPT.md Section 3: "no motion should
  // surprise the inner ear once Act II begins" — a snap at the *end* of Act II is exactly that
  // kind of surprise). So the last LABYRINTH_TAIL_BLEND_FRACTION of Act II's own span bleeds
  // walking pace down to exactly the Turn beat's t=0 velocity using a closed-form trapezoidal
  // velocity profile (constant rate, then a power2-out decay to the matching end-rate). The
  // labX->labT mapping itself lives in labXToLabT()/getLabyrinthPaceParams() above (shared with
  // labTToClockTime(), which director.js uses to keep turn-telegraph scheduling in sync with this
  // same curve) rather than being reimplemented inline here.
  const labSpan = BEATS.turn.start - BEATS.catch.end;
  const labX = THREE.MathUtils.clamp((clockTime - BEATS.catch.end) / labSpan, 0, 1);
  const pace = getLabyrinthPaceParams(curveLength);
  const labT = THREE.MathUtils.clamp(labXToLabT(labX, pace), 0, 1);

  curve.getPointAt(labT, _tmpPos);
  curve.getTangentAt(labT, _tmpTangent).normalize();

  const position = _tmpPos.clone();
  const lookAt = _tmpLook.copy(position).add(_tmpTangent);

  return { position, lookAt };
}
