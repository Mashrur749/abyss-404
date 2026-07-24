// src/main.js
//
// Entry point / integration layer (v2 — void/particle-vortex pivot). Creates the
// THREE.WebGLRenderer attached to #scene, instantiates every module exactly once, then runs a
// single requestAnimationFrame loop that:
//   1. advances whichever clock is authoritative for the current beat (state.clockTime during
//      fall-in, state.traverse.elapsedSeconds + updateScroll() during traverse,
//      state.actIII.clockTime once the traverse phase has completed) — see ARCHITECTURE.md's
//      "three-phase timing model" and this file's own contract section.
//   2. calls updateBeat() every frame so every module sees a consistent state.beat this frame.
//   3. scrubs director's fallInTimeline/returnTimeline against their respective clocks and drives
//      the traverse-phase's cosmetic tweens via updateTraverseCosmetics().
//   4. calls each module's update*(state, dt) in the fixed order ARCHITECTURE.md specifies:
//      updateScroll -> updateInteraction -> guide (resolves the orb's position FIRST, v2.2) ->
//      camera/vortex position (derived FROM the orb) -> lighting -> seeking-orbs (v2.6, renamed
//      from glyphs) -> vision (v2.5, alongside seeking-orbs — both travel-axis-relative traverse
//      scenery, no ordering dependency on each other) -> postfx -> audio -> overlay-text.
//   5. watches state.skipRequested and fast-forwards straight into the return phase.
//   6. renders via the postfx composer.
//
// This file stays thin — orchestration only. No beat-specific logic lives here; that all belongs
// in director.js/config.js per ARCHITECTURE.md.

import * as THREE from 'three';
import { state, updateBeat } from './state.js';
import { BEATS, VORTEX, COLOR } from './config.js';

import { createCamera, updateCamera } from './scene/camera.js';
import {
  createVortex,
  updateVortex,
  getCameraRigPosition,
  getVortexAxis,
  getAxisPositionAtDistance,
  OVERFLOW_LIGHT_DISTANCE,
} from './scene/vortex.js';

import { initScroll, updateScroll } from './scene/scroll.js';
import { createLighting, updateLighting } from './scene/lighting.js';
import { createSeekingOrbs, updateSeekingOrbs } from './scene/seeking-orbs.js';
import { createStarfield, updateStarfield } from './scene/starfield.js';
import { createVision, updateVision } from './scene/vision.js';
import { createGuide, updateGuide } from './scene/guide.js';
import { initInteraction, updateInteraction } from './scene/interaction.js';
import { createPostFX, updatePostFX } from './scene/postfx.js';
import { initAudio, updateAudio } from './audio/audio.js';
import { initOverlayText, updateOverlayText } from './ui/overlay-text.js';
import { createDirector } from './director.js';

// ---------------------------------------------------------------------------
// Renderer / scene bootstrap
// ---------------------------------------------------------------------------

const canvas = document.getElementById('scene');

// antialias MUST be false here even though neither GodRaysEffect nor DepthOfFieldEffect is
// currently added to any EffectPass (see postfx.js's DEFINITIVE FIX comment) — both are still
// constructed there and declare EffectAttribute.DEPTH, and the guarantee this codebase relies on
// is "no pass declares needsDepthTexture," not "these constructors are never called." A canvas
// context created with antialias:true implicitly multisamples its own depth-stencil buffer; if
// either effect were ever re-added to a pass, that would resurrect the exact
// "glBlitFramebuffer: Read and write depth stencil attachments cannot be the same image" crash
// this setting was already tuned to avoid. Left false defensively — cheap insurance against a
// future regression, since the composer's own passes (bloom/vignette/grain) already soften edges
// and canvas-level AA was never load-bearing for this pipeline's visual quality.
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
// v2.18: the renderer previously cleared to true black (#000), which is the single most reliable
// tell of cheap-looking dark rendering — premium dark work is essentially never pure black. This
// is COLOR.voidBase, the near-black-but-cold value config.js has always authored for exactly this
// purpose ("Act I: near-black, cold, never pure black") but which nothing was actually applying.
// It also gives the additive streak field something to sit in rather than float on.
scene.background = new THREE.Color(COLOR.voidBase);

// ---------------------------------------------------------------------------
// Module instantiation (each module's create*/init* runs exactly once)
// ---------------------------------------------------------------------------

const camera = createCamera();
camera.aspect = window.innerWidth / window.innerHeight;
camera.updateProjectionMatrix();

// getVortexAxis is passed by reference (not called here) — seeking-orbs.js's contract calls it
// lazily, on demand, every frame, precisely to avoid a circular-import/build-order hazard between
// vortex.js and seeking-orbs.js (see seeking-orbs.js's header comment).
const vortexHandle = createVortex(scene);

const lightingHandle = createLighting(scene);
const seekingOrbsHandle = createSeekingOrbs(scene, getVortexAxis);

// v2.19 — the far depth layer. Takes vortex.js's raw arc-length accessor by reference (never
// called here), the same circular-import-avoidance contract every other scenery module follows.
// Placement is one-time and static, so this never appears in the per-frame position pipeline
// below — only its twinkle updates each frame.
const starfieldHandle = createStarfield(scene, getAxisPositionAtDistance);

// vision.js mirrors seeking-orbs.js's exact contract: getVortexAxis is passed by reference (never
// called here), re-invoked on demand every frame inside updateVision(), for the same
// circular-import/build-order reasons documented on seekingOrbsHandle above.
const visionHandle = createVision(scene, getVortexAxis);

// guide.js mirrors seeking-orbs.js's exact contract: getVortexAxis is passed by reference (never
// called here), re-invoked on demand every frame inside updateGuide(), for the same
// circular-import/build-order reasons documented on seekingOrbsHandle above.
const guideHandle = createGuide(scene, getVortexAxis);

initInteraction();
initScroll();

const composer = createPostFX(renderer, scene, camera);

// Reposition postfx's God Rays occlusion proxy (unused in any pass, but kept updated for parity —
// see postfx.js's own DEFINITIVE FIX comment) and lighting.js's Act III overflowLight to
// vortex.js's real travel-axis endpoint (VORTEX.travelSpan + OVERFLOW_LIGHT_DISTANCE past the
// origin) rather than the placeholder positions each module ships with independently — same
// integration courtesy v1's main.js performed for corridor.js's spline endpoint, now expressed via
// vortex.js's exported arc-length accessor (getAxisPositionAtDistance).
const overflowLightDistance = VORTEX.travelSpan + OVERFLOW_LIGHT_DISTANCE;
const overflowLightPos = getAxisPositionAtDistance(overflowLightDistance);
if (composer.__postfx?.lightSource) {
  composer.__postfx.lightSource.position.copy(overflowLightPos);
}
if (lightingHandle?.overflowLight) {
  lightingHandle.overflowLight.position.copy(overflowLightPos);
}

initOverlayText();

const director = createDirector(state);

// initAudio() must run from a user-gesture handler (browsers block autoplay
// audio) — wire it to the first pointerdown/keydown/touchstart, per
// audio.js's contract. updateAudio() itself is a safe no-op until this
// resolves, so the render loop can call it unconditionally every frame.
function beginAudioOnGesture() {
  initAudio();
  window.removeEventListener('pointerdown', beginAudioOnGesture);
  window.removeEventListener('keydown', beginAudioOnGesture);
  window.removeEventListener('touchstart', beginAudioOnGesture);
}
window.addEventListener('pointerdown', beginAudioOnGesture, { passive: true });
window.addEventListener('keydown', beginAudioOnGesture, { passive: true });
window.addEventListener('touchstart', beginAudioOnGesture, { passive: true });

// ---------------------------------------------------------------------------
// Resize handling
// ---------------------------------------------------------------------------

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
}
window.addEventListener('resize', onResize);

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let skipHandled = false;
let lastTime = performance.now();

// See the camera-position crossfade at the 'turn' beat entry below (the "beat-transition
// position crossfade" comment) — absorbs the traverse-exit-speed-vs-return-curve position snap
// found via direct math this round, without adding any lag to normal, continuous motion.
let lastBeatSeen = null;
// v2.3 FIX (kinetic review): `from` now also carries a lookAt target, not just position — see the
// crossfade block below for why. `lastRigLookAt` mirrors the previous frame's `rig.lookAt` so it's
// available the instant a beat transition is detected (this frame's `rig` already belongs to the
// NEW beat by the time we notice `state.beat` changed).
let turnTransitionBlend = null; // { from: THREE.Vector3, fromLookAt: THREE.Vector3, elapsed: number } | null
let lastRigLookAt = null;
const _blendedLookAt = new THREE.Vector3();
const TURN_TRANSITION_BLEND_SECONDS = 0.35; // short enough to read as instantaneous-but-smooth, not a lag

// Beat-name sets for the clock-branching step below — mirrors state.js's own updateBeat()
// groupings exactly (see state.js's header comment on the three independently-clocked phases).
// v2.1: no more 'silhouette' beat (removed entirely, see config.js/state.js/ARCHITECTURE.md).
const FALL_IN_BEATS = new Set(['drop', 'freefall', 'catch']);

function tick(now) {
  requestAnimationFrame(tick);

  const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000)); // clamp dt to avoid huge jumps (tab backgrounding, etc.)
  lastTime = now;
  state.dt = dt;

  // -------------------------------------------------------------------------
  // 1. Advance whichever clock is authoritative for the CURRENT beat, per
  // ARCHITECTURE.md's three-phase timing model. state.beat itself is derived from last frame's
  // clock values until updateBeat() runs again below, which is fine — the phase a clock belongs to
  // only ever changes at a beat boundary, and each branch below is a safe no-op once that phase is
  // behind us (fall-in's clockTime is simply left frozen once traverse begins; traverse's
  // elapsedSeconds/scroll only advance while beat === 'traverse'; actIII's clock only starts once
  // traverse.complete flips true).
  // -------------------------------------------------------------------------
  if (!state.traverse.complete && FALL_IN_BEATS.has(state.beat)) {
    // Fall-in: drop / freefall / catch — driven by state.clockTime, unchanged mechanism from v1
    // (v2.1: no more 'silhouette' beat preceding these — see config.js/state.js).
    state.clockTime += dt;
  } else if (!state.traverse.complete) {
    // Traverse: NOT clockTime-driven. state.clockTime is frozen (nothing further advances it —
    // nothing should still be reading it as authoritative once this phase begins).
    // updateScroll() is the sole owner of state.traverse.progress/.complete/.elapsedSeconds (see
    // scroll.js's header contract) — it advances elapsedSeconds by dt itself, so main.js must not
    // also increment it here. A prior version double-incremented this field (main.js + scroll.js
    // both adding dt every frame), running the "elapsed real time in Act II" clock at 2x wall-clock
    // speed and desyncing the pulse-deceleration curve/rack-focus/turn-cue cadence (all keyed off
    // this field via SCROLL.pulseReferenceDuration) from the real elapsed time CONCEPT.md v2
    // Section 4 requires them to be paced by.
    updateScroll(state, dt);
  } else {
    // Return: turn / approach / overflow / iris — driven by state.actIII.clockTime, a fresh
    // sub-clock that starts advancing the frame state.traverse.complete first flips true.
    state.actIII.clockTime += dt;
  }

  // 2. Derive state.beat / state.beatProgress before any module reads them.
  updateBeat();

  // -------------------------------------------------------------------------
  // 3. Scrub director's timelines / drive the traverse-cosmetic tweens, per whichever phase is
  // now current, so every state field director.js owns is freshly written before the rest of this
  // frame's modules read them.
  // -------------------------------------------------------------------------
  if (!state.traverse.complete) {
    director.fallInTimeline.time(Math.min(state.clockTime, BEATS.catch.end));
  }
  if (state.beat === 'traverse') {
    director.updateTraverseCosmetics(state);
  }
  if (state.traverse.complete) {
    director.returnTimeline.time(state.actIII.clockTime);
  }

  // state.skipRequested handling: if triggered during fall-in or traverse, jump straight to the
  // start of the return phase — director.skipToEnd()'s contract only guarantees returnTimeline is
  // ready to scrub from 0 and kills any in-flight traverse-cosmetic tweens; main.js owns the
  // actual clock/flag resets this implies.
  if (state.skipRequested && !skipHandled) {
    skipHandled = true;
    state.traverse.progress = 1;
    state.traverse.complete = true;
    state.actIII.clockTime = 0;
    director.skipToEnd();
    updateBeat();
    director.returnTimeline.time(state.actIII.clockTime);
  }

  // -------------------------------------------------------------------------
  // 4. Fixed update order: updateScroll (already run above, ahead of updateBeat, per its own
  // contract of owning state.traverse.progress before anything else reads it this frame) ->
  // updateInteraction -> updateGuide (v2.2: resolves the orb's own axial position FIRST, since
  // the camera now derives its position FROM the orb rather than the other way around, per
  // ARCHITECTURE.md's "build order note") -> camera/vortex position -> lighting -> seeking-orbs ->
  // postfx -> audio -> overlay-text.
  // -------------------------------------------------------------------------
  updateInteraction(state, dt);

  // v2.2 chase-cam handoff: guide.js now owns the orb's actual world position/tangent (fall-in
  // axial math during drop/freefall/catch, state.traverse.progress along the travel axis during
  // traverse) and writes it into state.guide.position/tangent every frame. It must run BEFORE
  // getCameraRigPosition below so vortex.js can derive the camera's chase-cam position/lookAt
  // FROM the orb's freshly-resolved position this same frame, not last frame's stale value.
  // updateGuide() no longer takes a `camera` argument (v2.2: the orb doesn't chase the camera
  // anymore, so it has nothing to read from it) — see guide.js's header comment.
  updateGuide(guideHandle, state, dt);

  // vortex.js owns the camera rig's position/lookAt: during drop/freefall/catch/traverse this is
  // now derived FROM the Guiding Orb's resolved { position, tangent } (the chase-cam handoff,
  // passed explicitly here per ARCHITECTURE.md's contract so this frame's fresh orb data is used
  // rather than falling back to reading state.guide off `state` again); during turn/approach/
  // overflow/iris there is no orb left to follow and this argument is simply ignored by that
  // branch. camera.js only layers orientation/FOV perturbation on top afterward, so its added
  // rotation isn't immediately overwritten by camera.lookAt().
  // v2.4: `dt` is now passed as a third argument too — vortex.js's chase-cam formula applies its
  // own CAMERA.chase.followDampingSeconds exponential smoothing on top of the existing offset math
  // (the "camera follows a beat behind the orb" fix), which needs a real per-frame dt to stay
  // frame-rate independent, same as every other damped value already computed this frame (dt is
  // already resolved above, before updateInteraction/updateGuide ran, so this is simply reusing it).
  const rig = getCameraRigPosition(state, state.guide, dt);

  // Beat-transition position+lookAt crossfade: the traverse's own exit speed (idle-drift alone
  // already ~10 m/s, up to ~43 m/s at max scroll velocity) doesn't match the return phase's fixed
  // 'turn'-beat curve, which starts from wherever CAMERA_APPROACH_DISTANCE-based math says it
  // should — this produced a real, measurable position snap right at the exact moment control is
  // taken away from the user (found via direct derivative/distance math, not guessed). Rather
  // than re-deriving the return curve's physics from live entry speed (tried first — the safety
  // math showed that approach risks overshooting the floor-gap distance that protects against a
  // real prior NaN-illuminance bug), this crossfades the RENDERED position (and, v2.3, the lookAt
  // target — see below) only, over a short, fixed window right at the transition into 'turn' —
  // general enough to absorb this discontinuity (or any other beat-boundary snap) without adding
  // perceptible lag anywhere else, since it's inert outside this one specific transition.
  if (state.beat === 'turn' && lastBeatSeen !== 'turn') {
    // v2.3 FIX (kinetic review): capture the outgoing lookAt target too, not just position. Under
    // the old straight axis the tangent was a constant (0,0,-1) everywhere, so position was the
    // only thing that could snap at this boundary; under the v2.3 curved path the orb's damped
    // chase-cam tangent and the turn-branch's raw curve tangent at beatProgress=0 are genuinely
    // different vectors, so leaving lookAt un-blended reintroduces the exact class of
    // beat-boundary snap this crossfade exists to absorb — just in orientation instead of position.
    // Fall back to the current rig.lookAt if this is the very first frame (no prior sample yet).
    turnTransitionBlend = {
      from: camera.position.clone(),
      fromLookAt: (lastRigLookAt || rig.lookAt).clone(),
      elapsed: 0,
    };
  }
  lastBeatSeen = state.beat;

  if (turnTransitionBlend) {
    turnTransitionBlend.elapsed += dt;
    const blendT = Math.min(1, turnTransitionBlend.elapsed / TURN_TRANSITION_BLEND_SECONDS);
    // Smoothstep rather than linear, so the blend itself has no velocity discontinuity at its own
    // start/end (ease in AND out) — the same "don't just move the jerk somewhere else" care as
    // vortex.js's own approach-tail rampIn fix.
    const smooth = blendT * blendT * (3 - 2 * blendT);
    camera.position.lerpVectors(turnTransitionBlend.from, rig.position, smooth);
    _blendedLookAt.lerpVectors(turnTransitionBlend.fromLookAt, rig.lookAt, smooth);
    camera.lookAt(_blendedLookAt);
    if (blendT >= 1) turnTransitionBlend = null;
  } else {
    camera.position.copy(rig.position);
    camera.lookAt(rig.lookAt);
  }
  lastRigLookAt = rig.lookAt.clone();
  updateCamera(camera, state, dt);

  updateStarfield(starfieldHandle, state);
  updateVortex(vortexHandle, state, camera, dt);
  updateLighting(state, dt);
  updateSeekingOrbs(seekingOrbsHandle, state, camera, dt);
  updateVision(visionHandle, state, camera, dt);
  updatePostFX(composer, state, dt);
  updateAudio(state, dt);
  updateOverlayText(state, dt);

  // 5. Render via the postfx composer instead of renderer.render().
  composer.render(dt);
}

requestAnimationFrame(tick);
