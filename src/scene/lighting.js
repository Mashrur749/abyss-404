// src/scene/lighting.js (v2 — void/particle-vortex pivot, REWRITE)
//
// Owns: the ambient/hemisphere base-visibility fill (keeps the void from going
// unreadable-black, CONCEPT.md v2 Act I: "total but not blind"), the single Act III
// `overflowLight` PointLight the return phase pours toward the camera, and the centralized
// `setAccentBoost(id, amount)` resonance registry that seeking-orbs.js's orb-cluster
// proximity glow and interaction.js's ripple trail feed into.
//
// THE V1 BUG THIS MODULE MUST NOT REPEAT (see ARCHITECTURE.md's dedicated section): v1 shipped
// PointLights illuminating nearby wall geometry at ~0.4m range, and Three.js's mandatory
// physically-correct lighting (inverse-square falloff) amplified that ~6x right at the wall
// surface — a real, hard-to-diagnose "blinding overexposed" bug. v2 has no walls and, more to the
// point, no reason to light the vortex particle field with scene PointLights at all: the vortex's
// own glow is vortex.js's material/emissive responsibility (unlit or emissive-only particle
// materials authored directly from state.color.mixT/state.pulse.bpm/proximity boosts), not
// something this module illuminates from outside. This file therefore creates exactly ONE
// PointLight (`overflowLight`, Act III only) and reuses the already-solved near-field-distance
// discipline for it (a floor-distance gap from the camera's terminal position, imported from
// vortex.js's exported OVERFLOW_LIGHT_DISTANCE constant — same "keep a floor gap" pattern
// corridor.js's CAMERA_APPROACH_DISTANCE already proved out). Seeking-orb proximity glow and
// the ripple trail are NOT given their own lights either — they're pure resonance-value math
// (setAccentBoost), consumed by whichever module owns the actual glowing geometry (seeking-orbs.js,
// vortex.js) through state.lighting.boosts, exactly like v1's interface.

import * as THREE from 'three';
import { COLOR, PULSE, SEEKING_ORBS, RIPPLE, SCROLL } from '../config.js';
import { OVERFLOW_LIGHT_DISTANCE } from './vortex.js';

// Internal module state — not exported, per the architecture's "no module holds a direct
// reference to another module's internals" rule. Other modules only ever touch this file through
// createLighting/updateLighting/setAccentBoost.
let ambientLight = null;
let hemiLight = null;
let overflowLight = null; // Act III's single light source, the return phase pours toward the camera

// Boost registry: id -> { amount }. Boosts decay linearly to 0 over BOOST_DECAY_SECONDS once set;
// callers (seeking-orbs.js proximity, interaction.js's ripple via state.ripple below) can keep
// re-calling setAccentBoost() every frame while the effect is active, which simply refreshes the
// value — once they stop calling it, the boost decays back to baseline on its own. Resonance, not
// response.
const boosts = new Map();
const BOOST_DECAY_SECONDS = 1.5; // mirrors RIPPLE.fadeDurationSeconds-scale decay, kept local since
                                  // this file owns the light/resonance math, not the ripple/orb
                                  // trigger logic itself

// One-shot "discovery" kick for the Act III overflow light — see igniteOverflow() below. Decays
// back to 0 like every other boost in this module (resonance, not response), it just targets the
// single overflowLight object instead of the boosts registry.
let overflowIgnite = 0;
const OVERFLOW_IGNITE_DECAY_SECONDS = 2.5;

const _colorVoid = new THREE.Color(COLOR.voidBase);
const _colorTraverseBase = new THREE.Color(COLOR.traverseBase);
const _colorOverflowStart = new THREE.Color(COLOR.overflowStart);
const _colorOverflowEnd = new THREE.Color(COLOR.overflowEnd);
const _colorWhiteout = new THREE.Color(COLOR.whiteout);
const _colorAmbientWorking = new THREE.Color(); // scratch, void<->traverseBase blend

// Ambient/hemisphere kept deliberately low — CONCEPT.md v2 Act I/II: "almost no light sources
// yet," "just enough ambient falloff." The vortex particle field itself carries the primary
// visible glow via its own emissive material, per the lighting lesson above; this fill exists only
// so the void reads as "total but not blind" rather than literally unrenderable.
const BASE_AMBIENT_INTENSITY = 0.1;
const BASE_HEMI_INTENSITY = 0.3;
const RIPPLE_BOOST_GAIN = 0.8; // scales state.ripple.strength (0-1) into an additive resonance boost
// v2.2, new — scales state.ripple.clickBurst (0-1, RIPPLE.clickBoostGain-authored ceiling) into
// its own additive resonance boost, kept independent of RIPPLE_BOOST_GAIN/the 'ripple' slot above
// so a simultaneous gaze-move and a click both register fully (see interaction.js's own header
// comment on why the two fields are never allowed to clobber each other). Higher gain than the
// passive ripple's so the deliberate "fiddle" reads as a distinctly bigger, more deliberate
// payoff than ambient gaze drift — the concrete fix for the click burst previously having zero
// visible effect anywhere in the render pipeline.
const CLICK_BURST_BOOST_GAIN = 1.6;

// Act III overflowLight tuning. Range widened well past OVERFLOW_LIGHT_DISTANCE so its falloff
// still reaches the camera's whole approach, but intensity itself stays governed by
// mixT/bloom/ignite below rather than by proximity — the floor-distance gap (see
// createLighting()) is what protects against the v1 near-field singularity, not a lowered range.
const OVERFLOW_LIGHT_RANGE = OVERFLOW_LIGHT_DISTANCE * 2.2;
const OVERFLOW_LIGHT_DECAY = 1.5;

// Continuously-integrated pulse phase (radians). Using an accumulator driven by the *current*
// effective Hz each frame — rather than deriving straight from an absolute clock — means the
// idle-mirroring bpm slowdown below never causes a visible phase jump/stutter when it changes the
// instantaneous frequency; the wave stays smooth even as its speed changes.
let pulsePhaseAccum = 0;

/**
 * Builds and adds every light this scene will ever use, then returns a handle object in case the
 * caller wants direct access for debugging/repositioning at integration time (main.js may still
 * want to nudge overflowLight to vortex.js's actual travel-axis endpoint once that's resolved,
 * same courtesy v1's main.js gave lighting.js's handle). Safe to call once.
 */
export function createLighting(scene) {
  // Ambient: soft, near-zero fill so the void never goes fully unreadable-black. Color starts at
  // the Act I void base and is retargeted every frame in updateLighting as mixT moves.
  ambientLight = new THREE.AmbientLight(_colorVoid.getHex(), BASE_AMBIENT_INTENSITY);
  scene.add(ambientLight);

  // Hemisphere light: cool "sky" (deep teal) vs. a darker "ground" tone, giving whatever geometry
  // exists (seeking-orb encounters, the camera rig's immediate surroundings) gentle directional falloff
  // without a harsh single directional source competing with the vortex's own emissive glow.
  hemiLight = new THREE.HemisphereLight(COLOR.traverseBase, COLOR.voidBase, BASE_HEMI_INTENSITY);
  scene.add(hemiLight);

  // v2.6: registers accent boost slots for the seeking-orb encounters (seeking-orbs.js calls
  // setAccentBoost with ids like `seeking-orb-0`, `seeking-orb-1`, one per SEEKING_ORBS.count
  // encounter cluster — same registry, same id-prefix-per-index convention the retired glyphs.js
  // module used, just renamed alongside the module) so proximity resonance has something concrete
  // to ramp even before seeking-orbs.js has positioned its meshes, plus a shared 'ripple' slot fed
  // from state.ripple below, and (v2.2) a separate 'click-burst' slot fed from state.ripple.clickBurst.
  for (let i = 0; i < SEEKING_ORBS.count; i++) {
    boosts.set(`seeking-orb-${i}`, { amount: 0 });
  }
  boosts.set('ripple', { amount: 0 });
  boosts.set('click-burst', { amount: 0 });

  // The Act III overflow light: a single distant point that grows into a warm, volumetric-feeling
  // source as mixT -> 1 (CONCEPT.md v2 Section 2: "a light source appears distant and small ...
  // scarcity first"). Positioned along the travel axis past OVERFLOW_LIGHT_DISTANCE by default;
  // main.js may reposition it to vortex.js's actual resolved endpoint once that's available at
  // integration time, same handoff pattern v1 used. Kept at intensity 0 until mixT starts moving —
  // "almost no light sources yet" applies until the return phase actually begins the pivot.
  overflowLight = new THREE.PointLight(
    COLOR.overflowEnd,
    0,
    OVERFLOW_LIGHT_RANGE,
    OVERFLOW_LIGHT_DECAY
  );
  overflowLight.position.set(0, 0, -OVERFLOW_LIGHT_DISTANCE);
  scene.add(overflowLight);

  return { ambientLight, hemiLight, overflowLight };
}

/**
 * Advances all light/resonance math for this frame. Must run every frame regardless of beat.
 *
 * Pulse-deceleration contract (CONCEPT.md v2 Section 4 / ARCHITECTURE.md's lighting.js section):
 * the bpm 70->50 curve is driven off `state.traverse.elapsedSeconds` (real wall-clock time spent
 * in the traverse phase) clamped against `SCROLL.pulseReferenceDuration`, NOT off
 * `state.traverse.progress` (how far scrolled) or any clockTime — a slow scroller and a fast
 * scroller both experience the same felt calming-down curve over comparable elapsed real time,
 * rather than having it tied to how far they've scrolled. Once the traverse phase completes, the
 * decelerated end value (PULSE.bpmEnd) is held rather than re-accelerating, since the "calming
 * down" story beat has already resolved by the time Act III begins.
 */
export function updateLighting(state, dt) {
  const mixT = state.color?.mixT ?? 0;

  // --- Pulse bpm deceleration: elapsedSeconds-driven, never progress/clockTime-driven ----------
  let scriptedBpm;
  if (state.traverse.complete) {
    scriptedBpm = PULSE.bpmEnd;
  } else if (state.beat === 'traverse') {
    const elapsedT = THREE.MathUtils.clamp(
      state.traverse.elapsedSeconds / SCROLL.pulseReferenceDuration,
      0,
      1
    );
    // sine.inOut-shaped deceleration (matches EASE.traverse's authored curve), not a plain linear
    // lerp — CONCEPT.md v2 Section 4 explicitly wants the pulse to feel like "a slow, irregular
    // rhythm (like breathing)... same decelerating-heartbeat device as v1," and a constant-rate
    // ramp is exactly the mechanical, metronomic quality that language is written to avoid.
    const elapsedEased = -(Math.cos(Math.PI * elapsedT) - 1) / 2;
    scriptedBpm = THREE.MathUtils.lerp(PULSE.bpmStart, PULSE.bpmEnd, elapsedEased);
  } else {
    // Fall-in phase, before the traverse begins: hold at the opening bpm.
    scriptedBpm = PULSE.bpmStart;
  }
  // Shared state write — vortex.js/audio.js/seeking-orbs.js already read state.pulse.bpm directly per
  // ARCHITECTURE.md ("already shared via state directly"); this module is the one explicitly
  // tasked with deriving it off elapsedSeconds, so it's the authoritative writer of the value.
  state.pulse.bpm = scriptedBpm;

  // Idle-mirroring (CONCEPT.md v2 Section 5 "bonus layer": "if the user is idle ... for a few
  // seconds, the glow can slow further, as if the scene itself relaxes when the user does").
  // state.pointer.idleSeconds is tracked unconditionally by interaction.js; this is the reactive
  // consumer CONCEPT.md points to. Only ever slows the pulse further (never speeds it up past the
  // scripted baseline), and only takes effect once idle exceeds RIPPLE.idleMirrorDelaySeconds,
  // ramping in gradually rather than snapping so it reads as the scene gently settling.
  const idleSeconds = state.pointer?.idleSeconds ?? 0;
  const idleOverage = Math.max(0, idleSeconds - RIPPLE.idleMirrorDelaySeconds);
  const idleMirrorT = 1 - Math.exp(-idleOverage / 4); // smooth 0..1 ramp, ~63% in ~4s of overage
  const IDLE_BPM_FLOOR_RATIO = 0.65; // deepest the idle mirror is allowed to slow the pulse to
  const effectiveBpm = scriptedBpm * (1 - idleMirrorT * (1 - IDLE_BPM_FLOOR_RATIO));

  const pulseHz = effectiveBpm / 60;
  pulsePhaseAccum += dt * pulseHz * Math.PI * 2;
  const pulsePhase = pulsePhaseAccum;

  // Decay stale boosts toward 0 so anything not being actively refreshed by seeking-orbs.js/
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
  // keeping all resonance math centralized in this module. Ripple strength already decays to 0 in
  // interaction.js (RIPPLE.fadeDurationSeconds), so this stays a pure reflection of that value.
  if (state.ripple) {
    setAccentBoost('ripple', (state.ripple.strength || 0) * RIPPLE_BOOST_GAIN);
    // v2.2: the click/tap burst is a second, independent signal (see interaction.js's header
    // comment) — its own boost slot so it never gets folded into/clobbered by the passive
    // gaze-driven 'ripple' slot above. This is the concrete visual payoff the click/tap "something
    // to fiddle with" feature was missing entirely: seeking-orbs.js/vortex.js can read
    // state.lighting.boosts['click-burst'] the same way they already read the 'ripple' slot to
    // brighten their own unlit/emissive materials (see this module's header comment on the
    // lighting lesson — never a scene PointLight).
    setAccentBoost('click-burst', (state.ripple.clickBurst || 0) * CLICK_BURST_BOOST_GAIN);
  }

  // Ambient + hemisphere: fade from the cool void/traverse tones into the warm overflow tone. This
  // is a smooth, continuous interpolation — the single hard palette pivot lives in mixT's own
  // easing curve (owned by director.js), not in how this module blends colors.
  _colorAmbientWorking.copy(_colorVoid).lerp(_colorTraverseBase, Math.min(1, mixT * 4));
  ambientLight.color.lerpColors(_colorAmbientWorking, _colorOverflowEnd, mixT);
  ambientLight.intensity = BASE_AMBIENT_INTENSITY + mixT * 0.5;

  hemiLight.color.lerpColors(_colorTraverseBase, _colorOverflowEnd, mixT);
  hemiLight.groundColor.lerpColors(_colorVoid, _colorOverflowStart, mixT);
  hemiLight.intensity = BASE_HEMI_INTENSITY + mixT * 0.9;

  // Seeking-orb and ripple boosts don't own a dedicated THREE light object at fixed world
  // coordinates known to this module (seeking-orbs.js positions its own meshes/materials along
  // vortex.js's travel axis). We still centralize the *math* here per the architecture contract: expose the resolved
  // boost amounts, pulse phase/Hz, and the current accent color back onto state so seeking-orbs.js/
  // vortex.js can read the authoritative pulsed value when driving their own emissive materials,
  // without instantiating a light of their own.
  state.lighting = state.lighting || {};
  state.lighting.pulseHz = pulseHz;
  state.lighting.pulsePhase = pulsePhase;
  state.lighting.pulse = 1 + 0.4 * Math.sin(pulsePhase); // shared pulse multiplier, ~0.6..1.4
  state.lighting.accentColorHex = `#${new THREE.Color(COLOR.traverseAccent)
    .lerp(_colorOverflowEnd, mixT)
    .getHexString()}`;
  state.lighting.boosts = state.lighting.boosts || {};
  for (const [id, entry] of boosts.entries()) {
    state.lighting.boosts[id] = entry.amount;
  }

  // Act III overflow light: stays dark/off until color starts pivoting, then grows on an
  // accelerating curve as bloom intensity ramps (director.js drives state.bloom.intensity on the
  // same schedule) — "light overflowing" per CONCEPT.md v2 Section 1/4. The overflowIgnite term is
  // the one-shot "discovery" kick fired by seeking-orbs.js's igniteOverflow() when the last orb
  // resolves — a real, perceptible response to that specific event, decaying back to baseline like
  // every other resonance effect, layered on top of (never replacing) the fixed return-phase
  // schedule that remains authoritative for when Act III actually happens. Reused near-field
  // discipline from v1/corridor.js: overflowLight's own position already sits OVERFLOW_LIGHT_DISTANCE
  // out, and vortex.js is contractually required to keep the camera's terminal approach position
  // short of that (its own CAMERA_APPROACH_DISTANCE-equivalent) — this module doesn't need to
  // additionally clamp intensity by proximity because that floor gap is guaranteed elsewhere.
  overflowLight.color.lerpColors(_colorOverflowStart, _colorOverflowEnd, mixT);
  const overflowT = Math.max(0, mixT);
  overflowLight.intensity =
    Math.pow(overflowT, 2) * 10 + (state.bloom?.godRays || 0) * 4 + overflowIgnite * 3;

  // Final whiteout push (CONCEPT.md v2 Section 2/4: "final frame before the iris-transition: pure
  // warm whiteout, slightly overexposed"). mixT alone only ever reaches COLOR.overflowEnd (a
  // cream/gold, not a true whiteout) — during the `overflow`/`iris` beats, blend the ambient/
  // hemisphere/overflow-light color the rest of the way to COLOR.whiteout as beatProgress advances,
  // so the literal overexposed-white frame CONCEPT.md calls for actually exists, layered on top of
  // (not replacing) the gradual teal->gold pivot mixT already drives.
  if (state.beat === 'overflow' || state.beat === 'iris') {
    const whiteoutT =
      state.beat === 'iris' ? 1 : THREE.MathUtils.clamp(state.beatProgress ?? 0, 0, 1);
    ambientLight.color.lerp(_colorWhiteout, whiteoutT);
    hemiLight.color.lerp(_colorWhiteout, whiteoutT);
    hemiLight.groundColor.lerp(_colorWhiteout, whiteoutT);
    overflowLight.color.lerp(_colorWhiteout, whiteoutT);
  }
}

/**
 * Localized, transient brightening hook for other modules (seeking-orbs.js's orb-cluster
 * proximity resonance, interaction.js's ripple trail via state.ripple above). `id` should be a
 * stable string the caller reuses each frame while the effect is active (e.g. `seeking-orb-0`,
 * `seeking-orb-1`, `ripple`); `amount` is a resonance contribution, typically in the ~0-3 range. Call
 * every frame while active — stop calling (or call with 0) to let it decay back to baseline via
 * updateLighting's own decay. Deliberately does NOT create or touch any THREE light object — per
 * this module's central lesson, orb/ripple glow is read back by seeking-orbs.js/vortex.js
 * (state.lighting.boosts) and applied to their own unlit/emissive materials, never to a
 * near-field PointLight.
 */
export function setAccentBoost(id, amount) {
  const clamped = Math.max(0, amount);
  const existing = boosts.get(id);
  if (existing) {
    // Never let an explicit boost jump backward-decay in the same frame it was set — take the
    // caller's value directly; updateLighting handles decay on subsequent frames where no call (or
    // a lower call) refreshes it.
    existing.amount = clamped;
  } else {
    boosts.set(id, { amount: clamped });
  }
}

/**
 * One-shot "discovery" kick for the Act III overflow light, fired by seeking-orbs.js when the final
 * seeking-orb cluster settles/"finds itself" (CONCEPT.md v2.6: the seeking-orb encounters are
 * waypoints in the trance). Sets the internal ignite value to full strength; updateLighting()
 * decays it back to 0 over OVERFLOW_IGNITE_DECAY_SECONDS every frame after, same "resonance, not
 * response" shape as setAccentBoost(). Safe to call multiple times — later calls simply refresh
 * the peak, they never accumulate past 1.
 */
export function igniteOverflow() {
  overflowIgnite = 1;
}
