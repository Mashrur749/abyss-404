// src/scene/postfx.js
//
// Post-processing pipeline (pmndrs `postprocessing`, NOT three/examples/jsm/postprocessing).
// Builds the EffectComposer that carries Act III's light-overflow (Bloom + God Rays), a subtle
// permanent Vignette + Film Grain for cinematic texture, and a Chromatic Aberration pass gated
// to only render during Act I (`drop` / `freefall`) to reinforce the vertigo (CONCEPT.md
// Sections 2 & 4, ARCHITECTURE.md's postfx.js contract).
//
// This module owns no narrative light sources — the small emissive mesh created below exists
// purely as the God Rays effect's required occlusion anchor (a technical parameter of the
// GodRaysEffect constructor), not a scene light; `lighting.js` remains the sole owner of actual
// illumination per the architecture contract.

import * as THREE from 'three';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  VignetteEffect,
  VignetteTechnique,
  NoiseEffect,
  GodRaysEffect,
  ChromaticAberrationEffect,
  LensDistortionEffect,
  DepthOfFieldEffect,
  BlendFunction,
  KernelSize,
} from 'postprocessing';
import { COLOR } from '../config.js';

// ---------------------------------------------------------------------------------------------
// Fisheye / lens-distortion (CONCEPT.md Section 2, Act I: "Wide/fisheye FOV (~90-100deg) -
// distorts peripheral geometry, standard vertigo-inducing lens choice (cf. the falling shots in
// Fight Club, Panic Room)"). A wide THREE.PerspectiveCamera FOV alone only shows more of the
// scene under normal rectilinear projection — it never bows straight lines near the frame edges,
// which is the actual visual payload CONCEPT.md is asking for. `postprocessing`'s own
// LensDistortionEffect (a mainUv radial-warp pass, negative coefficients = barrel/fisheye bow)
// is used here rather than a hand-rolled shader, gated to Act I only via updatePostFX() below —
// director.js/camera.js never touch this; it's a pure post pass layered on top of the ordinary
// rectilinear projection.
// ---------------------------------------------------------------------------------------------

// Internal handle stashed on the composer so updatePostFX() can reach every tunable effect
// without main.js or any other module needing to know postprocessing's internal object graph.
function attachHandles(composer, handles) {
  composer.__postfx = handles;
}

/**
 * Creates the light-source proxy mesh that GodRaysEffect uses to compute its radial occlusion.
 * Positioned far down the corridor's spline direction (+Z-forward-ish placeholder); main.js /
 * corridor.js may reposition it via the returned composer's `__postfx.lightSource` handle once
 * the Act III light-source world position is known, without this module needing a reference to
 * corridor.js internals.
 */
function createLightSourceProxy() {
  const geometry = new THREE.SphereGeometry(1.5, 16, 16);
  const material = new THREE.MeshBasicMaterial({
    color: COLOR.overflowEnd,
    transparent: true,
    fog: false,
  });
  // GodRaysEffect requires its light source to never write depth (per its own docs) so it
  // never occludes real geometry, only contributes to the radial-blur occlusion pass.
  material.depthWrite = false;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  // Placeholder far down the corridor; the Act III beat lives at the end of the fixed path.
  mesh.position.set(0, CameraEyeHeightFallback(), -400);
  return mesh;
}

// Small local fallback so this module never has to import CAMERA just for a placeholder Y —
// keeps this file's only shared-constant dependency to COLOR, which is what it actually needs.
function CameraEyeHeightFallback() {
  return 1.6;
}

/**
 * Exports `createPostFX(renderer, scene, camera)` → returns an EffectComposer configured with
 * Bloom, a subtle Vignette, Film Grain, God Rays, and a beat-gated Chromatic Aberration pass.
 */
export function createPostFX(renderer, scene, camera) {
  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
  });

  composer.addPass(new RenderPass(scene, camera));

  // The God Rays light-source proxy lives in the scene graph (required so its world matrix is
  // valid for the effect's screen-space projection) but is otherwise invisible bookkeeping —
  // it is not part of the narrative lighting model.
  const lightSource = createLightSourceProxy();
  scene.add(lightSource);

  const bloomEffect = new BloomEffect({
    blendFunction: BlendFunction.SCREEN,
    mipmapBlur: true,
    intensity: 0.3,
    radius: 0.85,
    luminanceThreshold: 0.55,
    luminanceSmoothing: 0.2,
  });

  const godRaysEffect = new GodRaysEffect(camera, lightSource, {
    blendFunction: BlendFunction.SCREEN,
    samples: 60,
    density: 0.96,
    decay: 0.9,
    weight: 0.4,
    exposure: 0.6,
    clampMax: 1,
    kernelSize: KernelSize.SMALL,
    blur: true,
  });
  // Silent until director.js ramps state.bloom.godRays up across Acts II→III.
  godRaysEffect.blendMode.opacity.value = 0;

  const vignetteEffect = new VignetteEffect({
    technique: VignetteTechnique.DEFAULT,
    offset: 0.42,
    darkness: 0.55,
  });
  // Kept subtle and constant per the contract ("a subtle Vignette") — not state-driven.
  vignetteEffect.blendMode.opacity.value = 0.6;

  const grainEffect = new NoiseEffect({
    blendFunction: BlendFunction.OVERLAY,
    premultiply: true,
  });
  // Fine, unobtrusive film-grain texture — present throughout, never overwhelming the frame.
  grainEffect.blendMode.opacity.value = 0.08;

  const chromaticAberrationEffect = new ChromaticAberrationEffect({
    offset: new THREE.Vector2(0.0015, 0.001),
    radialModulation: true,
    modulationOffset: 0.2,
  });
  // Starts silent; updatePostFX() only lets it speak during the drop/freefall beats.
  chromaticAberrationEffect.blendMode.opacity.value = 0;

  // Fisheye/lens-distortion (Act I only, CONCEPT.md Section 2). Starts undistorted (0,0);
  // updatePostFX() ramps negative coefficients in only during drop/freefall — negative values
  // bow/bulge peripheral geometry outward (barrel/fisheye), matching the Fight Club/Panic Room
  // reference CONCEPT.md names explicitly.
  const lensDistortionEffect = new LensDistortionEffect({
    distortion: new THREE.Vector2(0, 0),
  });

  // Rack-focus / depth-of-field (Act II, CONCEPT.md Section 2: "foreground wall detail sharp,
  // corridor-ahead soft, then reverse"). Silent (bokeh scale 0) outside the moments director.js
  // schedules it; gated entirely by state.rackFocus.amount rather than state.beat directly so
  // this module stays a pure reader of state, per the architecture contract.
  // focusDistance/focusRange are WORLD UNITS per this library's real contract (default 3.0/2.0
  // respectively) — state.rackFocus.focusDistance is authored in matching world-unit meters by
  // director.js (see state.js), not a normalized 0..1 camera-space fraction.
  const depthOfFieldEffect = new DepthOfFieldEffect(camera, {
    focusDistance: 0.9,
    focusRange: 1.6,
    bokehScale: 0,
    height: 480,
  });

  // `postprocessing` refuses to merge a UV-transforming effect (LensDistortionEffect bends
  // mainUv for the fisheye bow) into the same EffectPass as an effect carrying
  // EffectAttribute.CONVOLUTION — it throws at construction time if you try. Verified directly
  // against the installed library via `effect.getAttributes()`: ChromaticAberrationEffect
  // (with radialModulation) is the one that actually carries EffectAttribute.CONVOLUTION here —
  // DepthOfFieldEffect and GodRaysEffect only carry EffectAttribute.DEPTH, which does not
  // conflict with LensDistortionEffect. So ChromaticAberrationEffect is the one that must live
  // in a separate pass from LensDistortionEffect; Bloom/God Rays/DoF are all safe alongside it.
  const opticsPass = new EffectPass(
    camera,
    bloomEffect,
    godRaysEffect,
    lensDistortionEffect,
    depthOfFieldEffect
  );
  const finishingPass = new EffectPass(camera, chromaticAberrationEffect, vignetteEffect, grainEffect);

  composer.addPass(opticsPass);
  composer.addPass(finishingPass);

  attachHandles(composer, {
    lightSource,
    bloomEffect,
    godRaysEffect,
    vignetteEffect,
    grainEffect,
    chromaticAberrationEffect,
    fisheyeEffect: lensDistortionEffect,
    depthOfFieldEffect,
    opticsPass,
    finishingPass,
  });

  return composer;
}

/**
 * Exports `updatePostFX(composer, state, dt)` — drives bloom intensity from
 * `state.bloom.intensity`, god-rays weight from `state.bloom.godRays` (both written by
 * director.js across Acts II→III), and gates chromatic aberration to only be present during
 * `state.beat === 'drop' | 'freefall'` (Act I vertigo reinforcement).
 */
export function updatePostFX(composer, state, dt) {
  const handles = composer.__postfx;
  if (!handles) return;

  const { bloomEffect, godRaysEffect, chromaticAberrationEffect, fisheyeEffect, depthOfFieldEffect } = handles;

  // --- Bloom: state.bloom.intensity drives both the composite opacity and the underlying
  // bloom intensity uniform, so low values genuinely recede rather than just fading a
  // constant-strength bloom in/out.
  const bloomIntensity = state.bloom.intensity;
  bloomEffect.intensity = bloomIntensity;
  bloomEffect.blendMode.opacity.value = THREE.MathUtils.clamp(bloomIntensity, 0, 1.5);

  // --- God Rays: state.bloom.godRays (0..1 from director.js) shapes both the visible strength
  // (opacity) and the underlying light-shaft weight/exposure so the volumetric shafts actually
  // grow in physical presence, not just fade in at full strength (CONCEPT.md Section 4's
  // "spilling like liquid" beat).
  const godRaysAmount = THREE.MathUtils.clamp(state.bloom.godRays, 0, 1);
  godRaysEffect.blendMode.opacity.value = godRaysAmount;
  const godRaysMaterial = godRaysEffect.godRaysMaterial;
  godRaysMaterial.weight = 0.15 + godRaysAmount * 0.65;
  godRaysMaterial.exposure = 0.2 + godRaysAmount * 0.8;

  // --- Chromatic aberration: only present during Act I ('drop' | 'freefall'), fully absent
  // otherwise, per the postfx.js contract. Fade its opacity in/out smoothly across dt rather
  // than a hard on/off flicker, while still guaranteeing it reads as ~0 outside Act I.
  const isVertigoBeat = state.beat === 'drop' || state.beat === 'freefall';
  const targetAberration = isVertigoBeat ? 1 : 0;
  const currentAberration = chromaticAberrationEffect.blendMode.opacity.value;
  const lerpSpeed = 1 - Math.exp(-dt * 6);
  const nextAberration = isVertigoBeat
    ? currentAberration + (targetAberration - currentAberration) * lerpSpeed
    : 0; // hard-zero the instant we leave Act I so no residual aberration ever appears later
  chromaticAberrationEffect.blendMode.opacity.value = nextAberration;

  // --- Fisheye / lens-distortion: peripheral-geometry bow, present only during Act I
  // (drop/freefall), per CONCEPT.md Section 2's explicit fisheye-lens call-out. Ramps in/out on
  // the same smoothing curve as chromatic aberration so the two vertigo cues arrive/leave
  // together rather than one lagging the other. Negative coefficients bow lines outward
  // (barrel/fisheye) rather than pinching them inward (pincushion).
  const targetDistortion = isVertigoBeat ? -0.35 : 0;
  const currentDistortion = fisheyeEffect.distortion.x;
  const nextDistortion = isVertigoBeat
    ? currentDistortion + (targetDistortion - currentDistortion) * lerpSpeed
    : 0;
  fisheyeEffect.distortion.set(nextDistortion, nextDistortion);

  // --- Rack-focus / depth-of-field: state.rackFocus.amount (0..1, authored by director.js during
  // scheduled Act II moments) drives the bokeh blur scale. At 0 the effect is fully sharp/inert
  // (bokehScale 0 = no blur contribution), so it stays invisible outside those moments rather than
  // a permanently-on DoF pass. focusDistance also animates so "foreground sharp / corridor soft,
  // then reverse" is a real focus-plane sweep, not just a blur amount fade.
  if (depthOfFieldEffect) {
    const rackFocus = state.rackFocus || { amount: 0, focusDistance: 0.9 };
    depthOfFieldEffect.bokehScale = rackFocus.amount * 3.5;
    // World-unit meters, matching this library's real focusDistance contract (see state.js).
    // focusDistance lives on the CoC material, not the effect itself.
    depthOfFieldEffect.circleOfConfusionMaterial.focusDistance = rackFocus.focusDistance ?? 0.9;
  }
}
