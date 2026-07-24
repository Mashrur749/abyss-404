// src/scene/starfield.js (NEW — v2.19)
//
// A far, static field of dim stars/dust surrounding the whole journey path.
//
// WHY THIS EXISTS, AND WHY IT IS THE *ONLY* THING ADDED (the reasoning matters more than the
// code — see CONCEPT.md's "REVISION (v2.19)"): the ask was "should we add a lot of granular
// details to make the outer space lively?" The answer was no — a lot of granular detail is
// precisely what v2.18 removed. The 2400-box field WAS granular detail, and it read as busy
// debris, not as life. Under additive blending the cost is worse than neutral: every element
// added brightens the frame, and the darkness is what makes an abyss feel like an abyss.
//
// But the instinct behind the question was right about something real: the frame's outer thirds
// were pure empty black, so the piece read as "a tunnel in a void" rather than "a tunnel in a
// space." The fix for that is NOT more objects at the same depth — it's one more depth LAYER.
// The piece had exactly one populated distance band (the streak tunnel, 2.5-14m). Adding a far
// band at 26-95m gives the eye genuine parallax: near threads sweep past fast, far stars barely
// move, and that difference is what the brain reads as real three-dimensional space. One layer,
// enormous depth gain, almost no added visual agitation.
//
// Three deliberate discipline choices, each avoiding a bug or regression this codebase already
// learned the hard way:
//
// 1. STATIC, NEVER RECYCLED. Stars are placed once across the entire authored journey span and
//    never wrap. Distant stars genuinely shouldn't recycle (that's what makes them read as far
//    away rather than as passing debris), and it also sidesteps the wrap-seam class of bug that
//    bit the companion orbs twice (v2.9: orbs teleporting hundreds of meters at full opacity).
//    No wrap, no seam, nothing to fade at a seam.
// 2. THREE.Points, not instanced quads. Points are camera-facing by construction, so there is no
//    per-frame billboard matrix work for ~1100 elements — only a color-attribute write for the
//    twinkle. One draw call, and cheaper than the streak field it sits behind.
// 3. FADES OUT ACROSS THE ACT III PIVOT. Stars scale down by (1 - mixT), so as the overflow light
//    takes the frame the surrounding space dissolves into it rather than persisting as cool specks
//    over a warm whiteout — the single-hard-color-pivot non-negotiable stays intact.

import * as THREE from 'three';
import { STARFIELD, VORTEX } from '../config.js';
import { getSharedGlowTexture } from './glow-sprite.js';

const _starColor = new THREE.Color();
const _colorCool = new THREE.Color(STARFIELD.colorCool);
const _colorWarm = new THREE.Color(STARFIELD.colorWarm);

/**
 * Builds the static star population around the travel path.
 *
 * `getAxisPositionAt(distanceMeters, out)` is passed in by reference (never called at module
 * scope) — the same circular-import-avoidance contract seeking-orbs.js/vision.js/guide.js all
 * follow for vortex.js's axis accessors. See main.js's wiring.
 */
export function createStarfield(scene, getAxisPositionAt) {
  const count = STARFIELD.count;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const stars = [];

  // Span the WHOLE authored journey — from behind the fall-in entry to past the overflow light —
  // so the surrounding space exists for every beat, not only the traverse. Static placement makes
  // this a one-time cost.
  const startDistance = -STARFIELD.spanMarginBehind;
  const endDistance = VORTEX.travelSpan + STARFIELD.spanMarginAhead;

  const _axisPoint = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    const t = Math.random();
    const distance = THREE.MathUtils.lerp(startDistance, endDistance, t);
    getAxisPositionAt(distance, _axisPoint);

    // Placed in world-axis-relative polar coordinates rather than the curve's own local frame:
    // at 26-95m out, these sit far outside the tunnel the local frame exists to describe, and a
    // star's exact lateral orientation relative to a curve tangent is meaningless at that range.
    // (Contrast the streak field, where the local frame is load-bearing — see vortex.js.)
    const angle = Math.random() * Math.PI * 2;
    const radius = THREE.MathUtils.lerp(
      STARFIELD.minRadius,
      STARFIELD.maxRadius,
      Math.sqrt(Math.random()) // sqrt keeps areal density even rather than crowding the inner edge
    );

    positions[i * 3] = _axisPoint.x + Math.cos(angle) * radius;
    positions[i * 3 + 1] = _axisPoint.y + Math.sin(angle) * radius;
    positions[i * 3 + 2] = _axisPoint.z;

    // Mostly cool, a warm minority — the same two-temperature discipline the streak field uses
    // for its own accent minority, so the far layer belongs to the piece's palette rather than
    // introducing a third color family.
    const isWarm = Math.random() < STARFIELD.warmFraction;
    const baseColor = new THREE.Color().copy(isWarm ? _colorWarm : _colorCool);

    stars.push({
      baseColor,
      baseOpacity: THREE.MathUtils.lerp(
        STARFIELD.baseOpacityMin,
        STARFIELD.baseOpacityMax,
        Math.random()
      ),
      twinklePhase: Math.random() * Math.PI * 2,
      twinkleRate: THREE.MathUtils.lerp(
        STARFIELD.twinkleHzMin,
        STARFIELD.twinkleHzMax,
        Math.random()
      ),
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    map: getSharedGlowTexture(), // the round soft falloff — a star is a point of light, not a thread
    size: STARFIELD.size,
    sizeAttenuation: true, // real perspective shrink, so the 26m band reads nearer than the 95m band
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
  });

  const points = new THREE.Points(geometry, material);
  points.name = 'starfield';
  points.frustumCulled = false;
  points.renderOrder = -1; // drawn before the streak field, so it reads as behind it
  scene.add(points);

  return { points, geometry, material, stars };
}

/**
 * Per-frame update: twinkle only. Positions never change (see this file's header on why the
 * field is deliberately static), so this writes the color attribute and nothing else.
 *
 * Driven off `state.traverse.elapsedSeconds` during the traverse and `state.clockTime` otherwise
 * — the codebase's established rule, since clockTime is frozen for the whole traverse and a
 * twinkle keyed to it would visibly stall there (see vision.js's screen-jitter comment for the
 * same trap).
 */
export function updateStarfield(handle, state) {
  if (!handle) return;
  const { geometry, stars } = handle;
  const colorAttr = geometry.getAttribute('color');

  const inTraverse = state.beat === 'traverse';
  const elapsed = inTraverse
    ? (state.traverse?.elapsedSeconds ?? 0)
    : (state.clockTime ?? 0) + (state.actIII?.clockTime ?? 0);

  // Dissolve into the Act III overflow rather than persisting as cool specks over a warm frame.
  const mixT = THREE.MathUtils.clamp(state.color?.mixT ?? 0, 0, 1);
  const pivotFade = 1 - mixT;

  for (let i = 0; i < stars.length; i++) {
    const star = stars[i];
    const twinkle =
      1 + STARFIELD.twinkleAmount * Math.sin(star.twinklePhase + elapsed * star.twinkleRate * Math.PI * 2);
    const intensity = star.baseOpacity * twinkle * pivotFade;

    _starColor.copy(star.baseColor).multiplyScalar(Math.max(0, intensity));
    colorAttr.setXYZ(i, _starColor.r, _starColor.g, _starColor.b);
  }

  colorAttr.needsUpdate = true;
}
