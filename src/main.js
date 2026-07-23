// src/main.js
//
// Entry point / integration layer. Creates the THREE.WebGLRenderer attached to
// #scene, instantiates every module exactly once, then runs a single
// requestAnimationFrame loop that:
//   1. advances state.clockTime by dt
//   2. calls updateBeat() so every module sees a consistent state.beat this frame
//   3. syncs director's GSAP timeline to state.clockTime (scrub-driven, per
//      director.js's own contract/comments)
//   4. calls each module's update*(state, dt) in the fixed order:
//      interaction -> camera -> corridor -> lighting -> glyphs -> postfx ->
//      audio -> overlay-text
//   5. watches state.skipRequested and fast-forwards via director.skipToEnd()
//   6. renders via the postfx composer
//
// This file stays thin — orchestration only. No beat-specific logic lives here;
// that all belongs in director.js/config.js per ARCHITECTURE.md.

import * as THREE from 'three';
import { state, updateBeat } from './state.js';
import { TOTAL_DURATION, BEATS } from './config.js';

import { createCamera, updateCamera } from './scene/camera.js';
import { createCorridor, getCameraRigPosition, getCorridorCurve } from './scene/corridor.js';
import { createLighting, updateLighting } from './scene/lighting.js';
import { createGlyphs, updateGlyphs } from './scene/glyphs.js';
import { initInteraction, updateInteraction } from './scene/interaction.js';
import { createPostFX, updatePostFX } from './scene/postfx.js';
import { initAudio, updateAudio } from './audio/audio.js';
import { initOverlayText, updateOverlayText } from './ui/overlay-text.js';
import { createDirector } from './director.js';

// ---------------------------------------------------------------------------
// Renderer / scene bootstrap
// ---------------------------------------------------------------------------

const canvas = document.getElementById('scene');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();

// ---------------------------------------------------------------------------
// Module instantiation (each module's create*/init* runs exactly once)
// ---------------------------------------------------------------------------

const camera = createCamera();
camera.aspect = window.innerWidth / window.innerHeight;
camera.updateProjectionMatrix();

const corridorHandle = createCorridor(scene);
const corridorCurve = getCorridorCurve() ?? corridorHandle.curve;

const lightingHandle = createLighting(scene);
const glyphsHandle = createGlyphs(scene, corridorCurve);

initInteraction();

const composer = createPostFX(renderer, scene, camera);

// Reposition postfx's God Rays occlusion proxy to the corridor's actual spline
// endpoint (plus a little further along the final tangent) rather than the
// placeholder (0, 1.6, -400) it ships with — this is the interface mismatch
// postfx.js's own handoff notes explicitly flagged as needing the integration
// pass to resolve, and corridor.js exports exactly what's needed to do it.
if (composer.__postfx?.lightSource && corridorHandle?.curve) {
  const endPoint = corridorHandle.curve.getPointAt(1);
  const endTangent = corridorHandle.curve.getTangentAt(1).normalize();
  const lightPos = endPoint.clone().addScaledVector(endTangent, 14);
  composer.__postfx.lightSource.position.copy(lightPos);
}

// Same repositioning courtesy for lighting.js's Act III overflow point light —
// it shipped with a config-derived approximation per its own handoff notes;
// corridor.js's real spline endpoint is now available here at integration time.
if (lightingHandle?.overflowLight && corridorHandle?.curve) {
  const endPoint = corridorHandle.curve.getPointAt(1);
  const endTangent = corridorHandle.curve.getTangentAt(1).normalize();
  lightingHandle.overflowLight.position.copy(endPoint.addScaledVector(endTangent, 14));
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

function tick(now) {
  requestAnimationFrame(tick);

  const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000)); // clamp dt to avoid huge jumps (tab backgrounding, etc.)
  lastTime = now;

  // 1. Advance the shared clock (the single authoritative timeline source of
  // truth every module derives its beat/eased values from).
  state.clockTime = Math.min(TOTAL_DURATION, state.clockTime + dt);
  state.dt = dt;

  // 2. Derive state.beat / state.beatProgress before any module reads them.
  updateBeat();

  // 3. Sync director's GSAP timeline to the authoritative clock (scrub-driven,
  // per director.js's own contract) so state.camera.fov / state.color.mixT /
  // state.bloom.* / state.pulse.bpm / state.overlay.* / state.iris.radius are
  // all freshly written before the rest of this frame's modules read them.
  director.timeline.time(state.clockTime);

  // Watch state.skipRequested and fast-forward exactly once. director.skipToEnd()
  // only seeks the GSAP timeline's own playhead (per its contract/comments) —
  // it does not touch state.clockTime, so main.js is responsible for jumping
  // the authoritative clock itself, matching overlay-text.js's contract note
  // ("it is NOT this module's job to manipulate state.clockTime directly").
  if (state.skipRequested && !skipHandled) {
    skipHandled = true;
    state.clockTime = BEATS.iris.start;
    updateBeat();
    director.skipToEnd();
    director.timeline.time(state.clockTime);
  }

  // 4. Fixed update order: interaction -> camera -> corridor -> lighting ->
  // glyphs -> postfx -> audio -> overlay-text.
  updateInteraction(state, dt);

  // corridor.js owns the camera rig's position/lookAt (path-following);
  // camera.js only layers orientation/FOV perturbation on top afterward, so
  // its added rotation isn't immediately overwritten by camera.lookAt() —
  // resolves the ordering hazard camera.js's own handoff notes flagged.
  const rig = getCameraRigPosition(state.clockTime / TOTAL_DURATION);
  camera.position.copy(rig.position);
  camera.lookAt(rig.lookAt);
  updateCamera(camera, state, dt);

  corridorHandle.updateFog(state);
  corridorHandle.updateVoidStreaks(state, camera.position.y);
  updateLighting(state, dt);
  updateGlyphs(glyphsHandle, state, camera, dt);
  updatePostFX(composer, state, dt);
  updateAudio(state, dt);
  updateOverlayText(state, dt);

  // 5. Render via the postfx composer instead of renderer.render().
  composer.render(dt);
}

requestAnimationFrame(tick);
