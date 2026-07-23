// src/scene/glyphs.js
//
// Places GLYPHS.count embedded "404" troika-three-text meshes along the corridor spline.
// Each glyph is scenery timed to the fixed path (CONCEPT.md Section 1 — the "404" itself
// becomes a character) but is implemented purely as a reactive read of `state` + the
// corridor curve passed in — this module owns no path logic and creates no light sources
// of its own (per ARCHITECTURE.md, lighting.js is the sole owner of light/emissive math;
// this module calls its `setAccentBoost(id, amount)` helper for localized brightening).

import * as THREE from 'three';
import { Text } from 'troika-three-text';
import gsap from 'gsap';
import ScrambleTextPlugin from 'gsap/ScrambleTextPlugin';
import { GLYPHS, COLOR, PULSE, CAMERA } from '../config.js';
import { setAccentBoost, igniteOverflow } from './lighting.js';

gsap.registerPlugin(ScrambleTextPlugin);

const RESOLVED_TEXT = '404';
const SCRAMBLE_CHARS = '0123456789#%$&*+=?/\\<>';

// Small lateral/vertical offset so glyphs read as embedded in a wall rather than floating
// dead-center in the walking path.
const WALL_OFFSET = 1.35; // meters, alternating left/right of the spline
const GLYPH_HEIGHT_OFFSET = 0.15; // meters, relative to eye height — roughly face-height

// Reused scratch color objects for the per-frame violet->gold lerp (avoids allocating new
// THREE.Color instances every frame per glyph).
const _baseAccentColor = new THREE.Color(COLOR.labyrinthAccent);
const _overflowColor = new THREE.Color(COLOR.overflowEnd);
const _accentColor = new THREE.Color();

/**
 * Distributes GLYPHS.count evenly-spaced parametric positions along (0,1), avoiding the
 * very start/end of the corridor so glyphs never land exactly at Act boundaries.
 */
function glyphParamPositions(count) {
  const positions = [];
  const margin = 0.12;
  const span = 1 - margin * 2;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : margin + (span * (i + 0.5)) / count;
    positions.push(t);
  }
  return positions;
}

/**
 * Places GLYPHS.count embedded "404" text meshes along `corridorCurve` (a THREE.Curve-like
 * object exposing getPointAt(t)/getTangentAt(t) over its own local [0,1] parametrization of
 * the labyrinth spline). Returns a handle object consumed by updateGlyphs().
 */
export function createGlyphs(scene, corridorCurve) {
  const group = new THREE.Group();
  group.name = 'glyphs';

  const count = Math.max(1, GLYPHS.count | 0);
  const params = glyphParamPositions(count);

  const glyphs = params.map((t, i) => {
    const point = corridorCurve.getPointAt(clamp01(t));
    const tangent = corridorCurve.getTangentAt(clamp01(t)).normalize();

    // Wall-normal: perpendicular to travel direction, alternating sides per glyph so
    // repeated encounters don't feel identically staged.
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(tangent, up).normalize();
    const side = i % 2 === 0 ? 1 : -1;

    const position = point.clone()
      .addScaledVector(right, side * WALL_OFFSET)
      .add(new THREE.Vector3(0, CAMERA.eyeHeight + GLYPH_HEIGHT_OFFSET, 0));

    const mesh = new Text();
    mesh.text = SCRAMBLE_CHARS.slice(0, 3);
    mesh.font = undefined; // troika default SDF font — crisp at any distance/angle
    mesh.fontSize = 0.9;
    mesh.letterSpacing = 0.04;
    mesh.anchorX = 'center';
    mesh.anchorY = 'middle';
    mesh.curveRadius = 0;
    mesh.depthOffset = 0;
    // Base material stays a plain, additive-glow-friendly MeshBasicMaterial; troika wraps it
    // internally into an SDF-aware derived material on read. Color/opacity going forward are
    // driven exclusively through the `mesh.color`/`mesh.material.opacity` troika-level shortcuts
    // (never by mutating the derived material's `.color` directly) because troika's own sync()
    // re-applies `mesh.color` onto the derived material every frame and would otherwise stomp
    // any direct `material.color` writes made from outside.
    mesh.material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.85,
      toneMapped: false,
    });
    mesh.color = COLOR.labyrinthAccent;
    mesh.outlineWidth = 0;
    mesh.position.copy(position);

    // Face back along the corridor toward oncoming camera travel, so the glyph reads
    // face-on as the camera approaches from lower t.
    mesh.lookAt(point.clone().addScaledVector(tangent, -4));

    mesh.sync();

    group.add(mesh);

    return {
      id: `glyph-${i}`,
      mesh,
      t,
      worldPosition: position,
      resolved: false,
      scrambleEl: makeScrambleProxyElement(SCRAMBLE_CHARS.slice(0, 3)),
      pulsePhase: Math.random() * Math.PI * 2, // desynced starting phase, syncs on approach
      currentBpm: PULSE.bpmStart,
      baseOpacity: 0.85,
      currentBoost: 0,
    };
  });

  scene.add(group);

  return {
    group,
    glyphs,
    corridorCurve,
  };
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

// ScrambleTextPlugin is authored for DOM nodes — it duck-types its target via
// `"textContent" in target` and reads content through `Node.nodeType`/`textContent`. A
// troika-three-text `Text` mesh is a THREE.Mesh, not a DOM node, so the plugin can't drive
// it directly. Rather than reimplementing the scramble/reveal algorithm by hand, we give
// GSAP a real (detached, never-appended-to-document) <span> to tween as its source of truth,
// and mirror its resolved `textContent` onto the troika mesh's `.text` + `.sync()` every
// update tick. This keeps the *effect* exactly what CONCEPT.md/ARCHITECTURE.md ask for
// (GSAP ScrambleTextPlugin driving the resolve-into-"404" beat) while working around the
// plugin's DOM-only target assumption — the one deviation from a literal reading of the
// contract, kept as small and load-bearing as possible.
function makeScrambleProxyElement(initialText) {
  const el = document.createElement('span');
  el.textContent = initialText;
  return el;
}

/**
 * Triggers a one-shot ScrambleTextPlugin resolve-into-"404" tween for a single glyph. Guarded
 * by `glyph.resolved` so it only ever plays once per glyph (CONCEPT.md Section 5 — "resonance
 * not response": the effect fires once as a discovery beat, it does not loop or re-trigger).
 *
 * When this is the *last* unresolved glyph, this is also the concrete realization of CONCEPT.md
 * Section 1's micro-story motif: "Finding/passing a glowing '404' is what triggers the overflow."
 * The fixed 37s timeline (BEATS.turn/approach/overflow) remains the authoritative schedule — per
 * ARCHITECTURE.md's non-negotiable, progress/timing must never depend on interaction, and glyph
 * placement is already tuned so the last glyph is always passed well before the Turn beat — but
 * that causal link was previously only a coincidence of timing with no actual wiring. Calling
 * lighting.js's igniteOverflow() here gives the Act III light source a genuine, perceptible kick
 * at the exact moment of discovery, so "the glyph causes the overflow" is a real effect the user
 * can feel (the light responds to this specific event), not just a beat-sheet coincidence.
 */
function triggerResolve(glyph, handle, state) {
  if (glyph.resolved) return;
  glyph.resolved = true;

  gsap.to(glyph.scrambleEl, {
    duration: 1.6,
    scrambleText: {
      text: RESOLVED_TEXT,
      chars: SCRAMBLE_CHARS,
      revealDelay: 0.25,
      speed: 0.35,
      tweenLength: false,
    },
    ease: 'sine.inOut',
    onUpdate: () => {
      glyph.mesh.text = glyph.scrambleEl.textContent;
      glyph.mesh.sync();
    },
    onComplete: () => playWink(glyph),
  });

  const allResolved = handle.glyphs.every((g) => g.resolved);
  if (allResolved) {
    state.glyphs.allResolved = true;
    igniteOverflow();
  }
}

// Small overshoot object animated by GSAP, mapped onto the resolved mesh's scale each tick — a
// quick, single squash-and-stretch "wink" right as the glyph settles into "404" (CONCEPT.md
// Section 1's tone guardrail: "a wink of playfulness in the 404 glyphs themselves," distinct
// from the ambient bioluminescence). Kept small/one-shot/non-looping so it reads as a charming
// tic, not a gimmick or a persistent animation loop — "resonance, not response" still applies:
// it fires once per glyph and settles right back to the resting scale.
function playWink(glyph) {
  const scaleProxy = { s: 1 };
  gsap.to(scaleProxy, {
    s: 1.22,
    duration: 0.16,
    ease: 'back.out(3)',
    yoyo: true,
    repeat: 1,
    onUpdate: () => {
      // Squash horizontally while stretching vertically (and vice versa on the way back) so it
      // reads as a wink/blink of the glyph itself rather than a uniform pulse-scale.
      glyph.mesh.scale.set(1 / Math.sqrt(scaleProxy.s), scaleProxy.s, 1);
    },
    onComplete: () => glyph.mesh.scale.set(1, 1, 1),
  });
}

/**
 * Each frame: measures camera distance to every glyph, drives proximity brightening (via
 * lighting.js's centralized setAccentBoost), syncs each glyph's pulse rate toward the
 * camera's own decelerating heartbeat-glow (state.pulse.bpm) as it's approached, triggers the
 * one-shot scramble-resolve effect once within range, and writes the nearest normalized
 * proximity (0 near, 1 far) into state.glyphs.nearestProximity for other modules (e.g. audio).
 */
export function updateGlyphs(handle, state, camera, dt) {
  if (!handle || !handle.glyphs.length) return;

  const radius = GLYPHS.proximityResonanceRadius;
  let nearestNormalized = 1;

  for (const glyph of handle.glyphs) {
    const distance = camera.position.distanceTo(glyph.mesh.position);
    const normalized = clamp01(distance / radius);

    if (normalized < nearestNormalized) {
      nearestNormalized = normalized;
    }

    if (distance <= radius) {
      // Proximity resonance: brighten as camera nears, peak at the glyph, relax back to
      // ambient as it's passed — a continuous function of distance, never a discrete toggle.
      const proximityStrength = 1 - normalized; // 0 far edge of radius .. 1 at the glyph
      const boost = proximityStrength * proximityStrength; // ease the ramp, punchier near the core

      setAccentBoost(glyph.id, boost);
      glyph.currentBoost = boost;

      // Entrainment: pulse rate glides toward the camera's own decelerating bpm the closer
      // the camera gets, rather than snapping — two rhythms falling into sync.
      const targetBpm = state.pulse.bpm;
      glyph.currentBpm += (targetBpm - glyph.currentBpm) * Math.min(1, dt * proximityStrength * 2);

      if (proximityStrength > 0.02) {
        triggerResolve(glyph, handle, state);
      }
    } else if (glyph.currentBoost > 0) {
      // Outside the radius but still relaxing back to baseline (decay curve, per the
      // "resonance, not response" non-negotiable — nothing stays lit).
      glyph.currentBoost = Math.max(0, glyph.currentBoost - dt * 0.6);
      setAccentBoost(glyph.id, glyph.currentBoost);
      glyph.currentBpm += (PULSE.bpmStart - glyph.currentBpm) * Math.min(1, dt * 0.3);
    }

    // Visual pulse: glyph's own emissive-ish opacity breathes at its (possibly synced) bpm,
    // brightened by proximity boost on top of the shared breathing baseline.
    const hz = glyph.currentBpm / 60;
    glyph.pulsePhase += dt * hz * Math.PI * 2;
    const breathe = 0.5 + 0.5 * Math.sin(glyph.pulsePhase);
    const opacity = glyph.baseOpacity + (0.15 * breathe) + glyph.currentBoost * 0.15;
    glyph.mesh.material.opacity = Math.min(1, opacity);
    glyph.mesh.fontSize = 0.9 + glyph.currentBoost * 0.12;

    // Color rides the same violet->gold pivot as the rest of the scene (single hard color
    // pivot non-negotiable) so glyphs never independently shift palette. Written through the
    // troika-level `mesh.color` shortcut (not `material.color` directly) — see the note above
    // on why direct derived-material writes get stomped by troika's own per-frame sync.
    const mixT = state.color && typeof state.color.mixT === 'number' ? state.color.mixT : 0;
    _accentColor.copy(_baseAccentColor).lerp(_overflowColor, mixT);
    glyph.mesh.color = _accentColor.getHex();
  }

  state.glyphs.nearestProximity = nearestNormalized;
}
