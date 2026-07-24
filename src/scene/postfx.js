// src/scene/postfx.js
//
// Post-processing pipeline (pmndrs `postprocessing`, NOT three/examples/jsm/postprocessing).
// Builds the EffectComposer that carries Act III's light-overflow (Bloom; see the DEFINITIVE FIX
// note below for why GodRaysEffect is constructed but never added to a pass), a subtle permanent
// Vignette + Film Grain for cinematic texture, a Chromatic Aberration + fisheye pass gated to only
// render during Act I (`drop` / `freefall`) to reinforce the vertigo, and a TiltShiftEffect that
// stands in for Act II's rack-focus beat (CONCEPT.md Sections 2 & 4, ARCHITECTURE.md's postfx.js
// contract).
//
// This module owns no narrative light sources — the small emissive mesh created below exists
// purely as the (now-unused) God Rays effect's required occlusion anchor (a technical parameter
// of the GodRaysEffect constructor), not a scene light; `lighting.js` remains the sole owner of
// actual illumination per the architecture contract.

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
  TiltShiftEffect,
  BlendFunction,
  KernelSize,
} from 'postprocessing';
import { COLOR, VORTEX, SCROLL } from '../config.js';

// v2.2 item 7 ("feels fast" perception cue) tuning — see updatePostFX's chromatic-aberration
// block below. Kept as named constants rather than inline magic numbers so the "existing effect
// parameters only" constraint (ARCHITECTURE.md's postfx.js section) is easy to audit: nothing
// here adds a pass or touches EffectPass grouping, it only scales opacity/offset uniforms that
// already exist on chromaticAberrationEffect.
const VELOCITY_ABERRATION_MAX = 0.5; // ceiling opacity contribution from scroll speed alone (traverse)
const VELOCITY_ABERRATION_OFFSET_BOOST = 0.6; // fractional growth of the offset magnitude at max speed
// The chromatic-aberration effect's own authored base offset (must match the literal passed to
// its constructor below) — kept as a shared constant so updatePostFX's velocity-linked offset
// scaling has a stable, known "1x" baseline to scale from rather than reading back a possibly
// already-scaled runtime value.
const BASE_ABERRATION_OFFSET = new THREE.Vector2(0.0015, 0.001);

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
  // stencilBuffer: true is deliberate, not decorative. GodRaysEffect and DepthOfFieldEffect both
  // declare EffectAttribute.DEPTH, so the composer allocates a shared "stable depth texture" and
  // blits the main RenderPass's depth into it every frame (see postprocessing's
  // EffectComposer#blitDepthBuffer). With the default stencilBuffer:false, Three.js requests a
  // depth-only renderbuffer, but ANGLE (Chrome's macOS GL backend) is known to silently promote
  // that into a combined depth24-stencil8 renderbuffer regardless — and once two independently
  // "depth-only-requested" render targets both get silently promoted like that, their
  // depth-stencil attachments can alias, which is exactly the
  // "glBlitFramebuffer: Read and write depth stencil attachments cannot be the same image" error.
  // Requesting a real stencil buffer explicitly avoids that silent, ambiguous promotion.
  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
    stencilBuffer: true,
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
    // v2.18: threshold 0.55 -> 0.3, smoothing 0.2 -> 0.4. lighting.js is effectively inert for
    // this piece (ambient/hemi do nothing to MeshBasicMaterial or sprites; the one real light is
    // Act III's), which makes bloom the ONLY genuine lighting lever the environment has. At 0.55
    // — against a field deliberately dimmed in v2.17 — almost nothing ever crossed the threshold,
    // so the abyss had no light bleed at all: the exact quality that separates premium rendering
    // from flat-looking geometry. The generous smoothing keeps it a soft haze around the brighter
    // threads rather than a hard on/off halo.
    luminanceThreshold: 0.3,
    luminanceSmoothing: 0.4,
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
  grainEffect.blendMode.opacity.value = 0.05; // v2.17: 0.08 -> 0.05 — finer, quieter grain (calm/premium pass)

  const chromaticAberrationEffect = new ChromaticAberrationEffect({
    offset: BASE_ABERRATION_OFFSET.clone(),
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

  // Rack-focus (Act II, CONCEPT.md Section 2: "foreground wall detail sharp, corridor-ahead
  // soft, then reverse"). Originally realized with DepthOfFieldEffect (a real depth-buffer CoC
  // blur), which had to be dropped — see the DEFINITIVE FIX note below — because it declares
  // EffectAttribute.DEPTH. TiltShiftEffect is the mechanically closest substitute: a screen-space
  // "sharp band / blurred outside" pass with its own private renderTarget/blur pass, verified via
  // `effect.getAttributes()` to report EffectAttribute.NONE (it never touches the composer's
  // shared depth texture), so it cannot resurrect the glBlitFramebuffer conflict. It has no real
  // depth notion, so it can't do "foreground sharp, corridor-ahead soft" as an actual focal-plane
  // sweep — instead its sharp band is swept across the screen-space Y axis via `offset`
  // (see updatePostFX below), which approximates the same "eye drawn from near to far" beat.
  // Silent (opacity 0) outside the moments director.js schedules, gated entirely by
  // state.rackFocus.amount so this module stays a pure reader of state, per the architecture
  // contract.
  const tiltShiftEffect = new TiltShiftEffect({
    blendFunction: BlendFunction.NORMAL,
    focusArea: 0.4,
    feather: 0.3,
  });
  tiltShiftEffect.blendMode.opacity.value = 0;

  // DEFINITIVE FIX (not a diagnostic guess): every effect that declares EffectAttribute.DEPTH
  // was verified exhaustively via `effect.getAttributes()` against every effect actually in use
  // here — only GodRaysEffect and (the now-removed-from-any-pass) DepthOfFieldEffect carried it.
  // EffectComposer only ever creates its shared "stable depth texture" and calls the one
  // gl.blitFramebuffer site in this entire pipeline (EffectComposer#blitDepthBuffer) when
  // `pass.needsDepthTexture` is true for at least one added pass (see EffectComposer#addPass).
  // With DepthOfFieldEffect replaced by TiltShiftEffect (verified EffectAttribute.NONE) and
  // GodRaysEffect excluded here too, no remaining pass declares needsDepthTexture, so that blit
  // never executes — mechanically eliminating the "glBlitFramebuffer: Read and write depth
  // stencil attachments cannot be the same image" error's only possible trigger, rather than
  // guessing at buffer-format parameters within it (antialias:false and stencilBuffer:true were
  // tried first and did not resolve it). Trade-off: no volumetric light-shaft rays for Act III.
  // Acceptable per the Light Artist advisor's round-3 review, which independently verified that
  // state.bloom.intensity + state.color.mixT alone already deliver a real, scene-driven warm
  // whiteout for the "light overflowing" beat — GodRaysEffect was an enhancement on top of that,
  // not its sole carrier. godRaysEffect/lightSource stay constructed and in the handles object
  // (main.js still repositions `lightSource`; updatePostFX still safely no-ops on godRaysEffect)
  // so nothing downstream has to change — it's just never added to a pass.
  const opticsPass = new EffectPass(
    camera,
    bloomEffect,
    lensDistortionEffect,
    tiltShiftEffect
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
    tiltShiftEffect,
    opticsPass,
    finishingPass,
  });

  return composer;
}

/**
 * Exports `updatePostFX(composer, state, dt)` — drives bloom intensity from
 * `state.bloom.intensity`, god-rays weight from `state.bloom.godRays` (both written by
 * director.js across Acts II→III; note godRaysEffect is constructed but not in any pass — see
 * the DEFINITIVE FIX comment above — so this is now inert bookkeeping kept for parity/debugging,
 * not a visual driver), and gates chromatic aberration to only be present during
 * `state.beat === 'drop' | 'freefall'` (Act I vertigo reinforcement).
 */
export function updatePostFX(composer, state, dt) {
  const handles = composer.__postfx;
  if (!handles) return;

  const { bloomEffect, godRaysEffect, chromaticAberrationEffect, fisheyeEffect, tiltShiftEffect } = handles;

  // --- Bloom: state.bloom.intensity drives both the composite opacity and the underlying
  // bloom intensity uniform, so low values genuinely recede rather than just fading a
  // constant-strength bloom in/out.
  const bloomIntensity = state.bloom.intensity;
  bloomEffect.intensity = bloomIntensity;
  bloomEffect.blendMode.opacity.value = THREE.MathUtils.clamp(bloomIntensity, 0, 1.5);

  // --- God Rays: kept updated for parity even though godRaysEffect isn't in any pass (see the
  // DEFINITIVE FIX comment in createPostFX) — harmless, since nothing reads its output, and
  // keeps the handle in a sane state if it's ever wired back into a pass. The narrative "spilling
  // like liquid" budget this used to carry now lives in lighting.js's overflowLight intensity
  // instead (state.bloom.godRays is consumed there).
  const godRaysAmount = THREE.MathUtils.clamp(state.bloom.godRays, 0, 1);
  godRaysEffect.blendMode.opacity.value = godRaysAmount;
  const godRaysMaterial = godRaysEffect.godRaysMaterial;
  godRaysMaterial.weight = 0.15 + godRaysAmount * 0.65;
  godRaysMaterial.exposure = 0.2 + godRaysAmount * 0.8;

  // --- Chromatic aberration: Act I ('drop' | 'freefall') vertigo-beat gating (unchanged), PLUS
  // (v2.2 item 7, ARCHITECTURE.md's explicitly-permitted narrow addition) a velocity-linked term
  // during `traverse` so "feels fast" scales with how the user is actually moving, not only with
  // the Act I beat. Uses only existing effect parameters (blendMode.opacity, offset magnitude) —
  // no EffectPass restructuring, no new pass, no GodRays/DepthOfField involvement.
  const isVertigoBeat = state.beat === 'drop' || state.beat === 'freefall';
  const lerpSpeed = 1 - Math.exp(-dt * 6);

  // state.vortex.travelSpeed is signed meters/second (vortex.js), written every frame once the
  // rig starts moving; undefined/absent (e.g. before the first vortex update) safely reads as 0.
  // Normalized against SCROLL's own forward ceiling (1/minDuration * travelSpan) so the cue scales
  // 0..~1 across the real achievable speed range rather than against an arbitrary constant.
  const travelSpeed = Math.abs(state.vortex?.travelSpeed ?? 0);
  const maxForwardSpeed = VORTEX.travelSpan / SCROLL.minDuration;
  const speedT = THREE.MathUtils.clamp(travelSpeed / Math.max(maxForwardSpeed, 0.001), 0, 1);
  const velocityAberration = state.beat === 'traverse' ? speedT * VELOCITY_ABERRATION_MAX : 0;

  const targetAberration = isVertigoBeat ? 1 : velocityAberration;
  const currentAberration = chromaticAberrationEffect.blendMode.opacity.value;
  // Smoothly tracks whichever target applies (full vertigo ramp in Act I, speed-scaled term
  // during traverse, 0 during turn/approach/overflow/iris) — no more hard-zero-outside-Act-I
  // special case now that traverse can legitimately want a nonzero value.
  const nextAberration = currentAberration + (targetAberration - currentAberration) * lerpSpeed;
  chromaticAberrationEffect.blendMode.opacity.value = nextAberration;

  // Radial-offset magnitude also grows slightly with speed (on top of the fixed base offset
  // authored in createPostFX) — the same "streak/smear" cue reads a little more pronounced the
  // faster the user is actually scrolling, still fully decaying back to the base offset at rest.
  const baseOffsetMag = BASE_ABERRATION_OFFSET.length();
  const targetOffsetScale = 1 + (state.beat === 'traverse' ? speedT * VELOCITY_ABERRATION_OFFSET_BOOST : 0);
  const currentOffsetScale = baseOffsetMag > 0 ? chromaticAberrationEffect.offset.length() / baseOffsetMag : 1;
  const nextOffsetScale = currentOffsetScale + (targetOffsetScale - currentOffsetScale) * lerpSpeed;
  chromaticAberrationEffect.offset.copy(BASE_ABERRATION_OFFSET).multiplyScalar(nextOffsetScale);

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

  // --- Rack-focus, via TiltShiftEffect (see createPostFX's header comment for why this replaced
  // DepthOfFieldEffect): state.rackFocus.amount (0..1, authored by director.js during scheduled
  // Act II moments) drives the sharp band's opacity directly. At 0 the effect is fully
  // transparent/inert, so it stays invisible outside those moments rather than a permanently-on
  // pass. state.rackFocus.focusDistance is authored by director.js in WORLD-UNIT meters (0.9m
  // near foreground wall -> 9m corridor-ahead, per state.js's original DepthOfFieldEffect
  // contract) and is remapped here into TiltShiftEffect.offset, a screen-space vertical fraction
  // of where the sharp band sits (~-1 top of frame .. +1 bottom of frame per the effect's own
  // vUv2 convention). Near focusDistance -> band low in frame (as if focused on the near
  // foreground wall low in view), far focusDistance -> band recentered toward screen-middle (as
  // if focused on the corridor stretching away) — approximating "foreground sharp -> corridor
  // sharp, then reverse" without a real depth buffer. The exact mapping is a tuning choice, not a
  // hard contract; director.js's tween shapes/timings are unchanged.
  if (tiltShiftEffect) {
    const rackFocus = state.rackFocus || { amount: 0, focusDistance: 0.9 };
    tiltShiftEffect.blendMode.opacity.value = THREE.MathUtils.clamp(rackFocus.amount, 0, 1);
    const NEAR_DISTANCE = 0.9;
    const FAR_DISTANCE = 9;
    const NEAR_OFFSET = 0.55; // sharp band low-in-frame, reading as "near foreground wall"
    const FAR_OFFSET = 0.05; // sharp band near-centered, reading as "corridor stretching ahead"
    const distanceT = THREE.MathUtils.clamp(
      (rackFocus.focusDistance - NEAR_DISTANCE) / (FAR_DISTANCE - NEAR_DISTANCE),
      0,
      1
    );
    tiltShiftEffect.offset = THREE.MathUtils.lerp(NEAR_OFFSET, FAR_OFFSET, distanceT);
  }
}
