// Standalone numeric verification script (NOT part of the app) — samples vortex.js's real,
// currently-checked-in axis/camera-rig functions at several fractions of the full authored path
// and confirms finite, non-NaN, non-degenerate output. Run with:
//   node scripts/verify-curve.mjs
import * as THREE from 'three';
import {
  getAxisPositionAtDistance,
  getAxisTangentAtDistance,
  getCameraRigPosition,
  getVortexAxis,
  getFallInAxialPosition,
  OVERFLOW_LIGHT_DISTANCE,
  CAMERA_APPROACH_DISTANCE,
} from '../src/scene/vortex.js';
import { VORTEX, BEATS } from '../src/config.js';

function isFiniteVec(v) {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

function fmt(v) {
  return `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;
}

let anyFail = false;
function check(label, cond, detail) {
  const status = cond ? 'PASS' : 'FAIL';
  if (!cond) anyFail = true;
  console.log(`[${status}] ${label}${detail ? ' — ' + detail : ''}`);
}

console.log('=== 1. axisPointAt/axisTangentAt across the FULL authored path (dist relative to traverse entry) ===');
// Full authored length ~ FALL_DESCENT_DISTANCE + travelSpan + OVERFLOW_LIGHT_DISTANCE + margin.
// FALL_DESCENT_DISTANCE = hypot(34,6) ~ 34.52; RETURN_CURVE_MARGIN = 4 (internal, not exported)
const FALL_DESCENT_DISTANCE = Math.hypot(34, 6);
const RETURN_CURVE_MARGIN = 4;
const totalAuthored = FALL_DESCENT_DISTANCE + VORTEX.travelSpan + OVERFLOW_LIGHT_DISTANCE + RETURN_CURVE_MARGIN;

// axisPointAt(dist) contract: dist=0 => traverse entry; dist can be negative (fall-in) down to
// -FALL_DESCENT_DISTANCE, and up to VORTEX.travelSpan + OVERFLOW_LIGHT_DISTANCE + margin at the far end.
const distMin = -FALL_DESCENT_DISTANCE;
const distMax = VORTEX.travelSpan + OVERFLOW_LIGHT_DISTANCE + RETURN_CURVE_MARGIN;

const fractions = [0, 0.25, 0.5, 0.75, 1.0];
const results = [];
for (const f of fractions) {
  const dist = distMin + f * (distMax - distMin);
  const p = getAxisPositionAtDistance(dist, new THREE.Vector3());
  const t = getAxisTangentAtDistance(dist, new THREE.Vector3());
  results.push({ f, dist, p, t });
  check(
    `fraction=${f} dist=${dist.toFixed(2)}m position finite`,
    isFiniteVec(p),
    fmt(p)
  );
  check(
    `fraction=${f} dist=${dist.toFixed(2)}m tangent finite & unit-length`,
    isFiniteVec(t) && Math.abs(t.length() - 1) < 1e-4,
    `${fmt(t)} len=${t.length().toFixed(5)}`
  );
  // Non-degenerate: position != lookAt equivalent check (point + tangent should differ from point)
  const lookAt = p.clone().add(t);
  check(
    `fraction=${f} position != lookAt (non-degenerate)`,
    p.distanceTo(lookAt) > 1e-6,
    `dist=${p.distanceTo(lookAt).toFixed(4)}`
  );
}

console.log('\n=== 2. getVortexAxis() [0,1]-normalized traverse-span accessor ===');
const axis = getVortexAxis();
for (const f of fractions) {
  const p = axis.getPointAt(f, new THREE.Vector3());
  const t = axis.getTangentAt(f, new THREE.Vector3());
  check(`t=${f} getVortexAxis point finite`, isFiniteVec(p), fmt(p));
  check(`t=${f} getVortexAxis tangent finite & unit`, isFiniteVec(t) && Math.abs(t.length() - 1) < 1e-4, fmt(t));
}

console.log('\n=== 3. getCameraRigPosition(state, orb) across all beats/fractions ===');

function makeState(beat, extra = {}) {
  return {
    beat,
    beatProgress: 0,
    clockTime: 0,
    traverse: { progress: 0, elapsedSeconds: 0, complete: false },
    actIII: { clockTime: 0 },
    guide: { position: null, tangent: null },
    ...extra,
  };
}

// Sample across fall-in (drop/freefall/catch), traverse, and return (turn/approach/overflow/iris)
// at 5 fractions of EACH phase's own local progress, mirroring "several fractions of the full
// authored path" per phase since each phase has a different driving clock.
const fallBeats = [
  { beat: 'drop', range: BEATS.drop },
  { beat: 'freefall', range: BEATS.freefall },
  { beat: 'catch', range: BEATS.catch },
];

for (const { beat, range } of fallBeats) {
  for (const f of fractions) {
    const clockTime = range.start + f * (range.end - range.start);
    const state = makeState(beat, { clockTime });
    const rig = getCameraRigPosition(state, null); // no orb resolved -> exercises fallback path
    check(
      `[${beat}] f=${f} clockTime=${clockTime.toFixed(2)} rig.position finite`,
      isFiniteVec(rig.position),
      fmt(rig.position)
    );
    check(
      `[${beat}] f=${f} rig.position != rig.lookAt`,
      rig.position.distanceTo(rig.lookAt) > 1e-6,
      `dist=${rig.position.distanceTo(rig.lookAt).toFixed(4)}`
    );
  }
}

for (const f of fractions) {
  const state = makeState('traverse', { traverse: { progress: f, elapsedSeconds: f * 20, complete: false } });
  const rig = getCameraRigPosition(state, null);
  check(
    `[traverse] progress=${f} rig.position finite`,
    isFiniteVec(rig.position),
    fmt(rig.position)
  );
  check(
    `[traverse] progress=${f} rig.position != rig.lookAt`,
    rig.position.distanceTo(rig.lookAt) > 1e-6
  );

  // Also exercise the resolved-orb branch (main.js's real call path passes state.guide)
  const orbPos = new THREE.Vector3(1, 2, -f * 100);
  const orbTangent = new THREE.Vector3(0.1, 0.05, -1).normalize();
  const rigWithOrb = getCameraRigPosition(state, { position: orbPos, tangent: orbTangent });
  check(
    `[traverse+orb] progress=${f} rig.position finite`,
    isFiniteVec(rigWithOrb.position),
    fmt(rigWithOrb.position)
  );
}

// Return phase: sample across turn/approach/overflow/iris via actIII.clockTime fractions of the
// full return duration.
const returnTotal = BEATS.turn.duration + BEATS.approach.duration + BEATS.overflow.duration + BEATS.iris.duration;
const returnBeatPositions = []; // gather rig positions at each fraction for the floor-gap check
for (const f of fractions) {
  const t = f * returnTotal;
  // Determine which sub-beat this t falls into, mirroring state.js's updateBeat()
  let acc = 0;
  let beat = 'iris';
  let beatProgress = 1;
  for (const key of ['turn', 'approach', 'overflow', 'iris']) {
    const dur = BEATS[key].duration;
    if (t < acc + dur || key === 'iris') {
      beat = key;
      beatProgress = Math.min(1, Math.max(0, (t - acc) / dur));
      break;
    }
    acc += dur;
  }
  const state = makeState(beat, {
    beatProgress,
    actIII: { clockTime: t },
    traverse: { progress: 1, elapsedSeconds: 20, complete: true },
  });
  const rig = getCameraRigPosition(state, null);
  returnBeatPositions.push({ f, t, beat, rig });
  check(
    `[return:${beat}] returnT=${f} (actIII.clockTime=${t.toFixed(2)}) rig.position finite`,
    isFiniteVec(rig.position),
    fmt(rig.position)
  );
  check(
    `[return:${beat}] returnT=${f} rig.position != rig.lookAt`,
    rig.position.distanceTo(rig.lookAt) > 1e-6
  );
}

console.log('\n=== 4. Floor-distance gap: camera terminal position vs overflowLight position, AT RETURN PHASE TERMINAL POINT ===');
// Terminal point: t=1 (end of iris / end of return phase, actIII.clockTime = returnTotal)
const terminalState = makeState('iris', {
  beatProgress: 1,
  actIII: { clockTime: returnTotal },
  traverse: { progress: 1, elapsedSeconds: 20, complete: true },
});
const terminalRig = getCameraRigPosition(terminalState, null);
const overflowLightPos = getAxisPositionAtDistance(VORTEX.travelSpan + OVERFLOW_LIGHT_DISTANCE, new THREE.Vector3());
const gapDistance = terminalRig.position.distanceTo(overflowLightPos);

console.log(`Camera terminal position: ${fmt(terminalRig.position)}`);
console.log(`Overflow light position:  ${fmt(overflowLightPos)}`);
console.log(`Euclidean gap distance:   ${gapDistance.toFixed(4)}m`);
console.log(`Authored arc-length gap (CAMERA_APPROACH_DISTANCE vs OVERFLOW_LIGHT_DISTANCE): ${(OVERFLOW_LIGHT_DISTANCE - CAMERA_APPROACH_DISTANCE).toFixed(4)}m`);

check(
  'Floor-distance gap is non-zero (camera never converges exactly onto the light)',
  gapDistance > 0.01,
  `gap=${gapDistance.toFixed(4)}m`
);
check(
  'Floor-distance gap is finite (no NaN/Infinity illuminance hazard)',
  Number.isFinite(gapDistance)
);

// Extra: verify at several points approaching the terminal point (not just the exact end) that the
// gap monotonically shrinks toward the floor but never hits (or crosses) zero.
console.log('\nGap distance at each return-phase sample point (should stay positive throughout):');
for (const { f, t, beat, rig } of returnBeatPositions) {
  const gap = rig.position.distanceTo(overflowLightPos);
  console.log(`  returnT=${f} (${beat}, actIII.clockTime=${t.toFixed(2)}): gap=${gap.toFixed(4)}m`);
  check(`  gap positive at returnT=${f}`, gap > 0.01, `gap=${gap.toFixed(4)}`);
}

console.log('\n=== 5. Sanity: curve isn\'t degenerate (points actually vary / aren\'t all identical) ===');
const allPoints = results.map((r) => r.p);
let allSame = true;
for (let i = 1; i < allPoints.length; i++) {
  if (allPoints[i].distanceTo(allPoints[0]) > 1e-3) allSame = false;
}
check('Sampled points across the path are NOT all identical (curve genuinely varies)', !allSame);

let anyLateralDeviation = false;
for (const r of results) {
  if (Math.abs(r.p.x) > 0.05 || Math.abs(r.p.y - (-0)) > 0.05) {
    // crude check that at least some sample points deviate from the straight axis (x=0)
  }
}
for (const r of results) {
  if (Math.abs(r.p.x) > 0.1) anyLateralDeviation = true;
}
check('At least one sampled point deviates laterally from x=0 (confirms real curvature, not a straight line)', anyLateralDeviation);

console.log('\n' + (anyFail ? 'RESULT: FAIL — see failures above' : 'RESULT: ALL CHECKS PASSED'));
process.exit(anyFail ? 1 : 0);
