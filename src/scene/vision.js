// src/scene/vision.js (NEW in v2.5, REPEATED in v2.7, EXPANDED + FIXED in v2.8, RE-STAGED in v2.21)
//
// The in-tunnel vision: repeated apparitions placed at fixed points along the traverse's travel
// axis (config.js's VISION_ENCOUNTER) — a man on a couch, transfixed by a glowing "ERROR 404" CRT,
// built from a REAL photographic render (src/assets/vision-apparition.png) rather than a procedural
// recreation (that was v2.4's approach; CONCEPT.md's v2.5 revision explicitly reverses it — see
// that document's header note for why the real images read as apparitions rather than fighting
// the vortex's dreamlike register).
//
// v2.21 RE-STAGING — the encounter used to be TWO photo cards: a silhouette card at the anchor and
// a TV card 1.6m further along the travel axis, facing back at it. The camera passes at a lateral
// offset, so parallax read that T-arrangement for exactly what it was — two flat pictures at
// different depths, not a scene. And because the two assets were photographed separately, the
// figure was lit from the left and faced near-left while the TV it was supposedly transfixed by sat
// behind and beside it, which meant the piece's single strongest image — a man who cannot look away
// from the 404 — was the one thing this staging could not actually show. Both cards are now ONE
// composite plane: gaze, light direction and depth are baked into the pixels, where parallax cannot
// take them apart. See the asset comment below for what that buys on the rendering side.
//
// Mirrors seeking-orbs.js's exact module shape, per ARCHITECTURE.md's instruction to reuse that
// pattern rather than reinvent it:
//   - createVision(scene, travelAxisAccessor) -> handle, called once at integration time
//   - updateVision(handle, state, camera, dt) -> called every frame
//
// v2.7 CHANGES — feedback: "I don't see the 404 screen and the silhouette? we should repeatedly
// show the 404 screen in the portal + the silhouette looking at it." Two real, verified problems
// this round fixed: (1) VISIBILITY — the single old encounter was placed far enough off-axis
// (4.5m) that, combined with how the chase-cam's lookAt target leads its own position, it only
// ever reached ~0.47 of its own authored peak opacity in a narrow, largely off-boresight window;
// (2) REPEATED, not one-off — a hand-picked array of 3 fractions replaced the single encounter.
//
// v2.8 CHANGES — feedback: "still don't see the silhouette?" (with a reference screenshot showing
// the actual source image). The v2.7 placement/visibility fix turned out to be necessary but NOT
// sufficient — a SEPARATE, more fundamental bug: the silhouette's own alpha-keying threshold
// (SILHOUETTE_KEY_BAND below) was tuned against an assumed background/subject luminance split that
// didn't match the real file. The figure is painted at luminance ~6-12 (a deliberately dark, smoky
// shape); the old band (innerEdge: 18) treated anything at or below 18 as "background," silently
// keying away ~97% of the figure's own body — only its brightest rim-light highlights survived.
// Fixed by tightening the band to match the real file's actual pure-black background (verified:
// max luminance 0 across thousands of sampled background pixels) vs. the figure's real luminance
// floor — see SILHOUETTE_KEY_BAND's own comment for the full verification. Separately, feedback
// "come into the portal repeatedly, clearly, floating, 20-30 times maybe" replaced the v2.7 hand-
// picked 3-fraction array with `VISION_ENCOUNTER.count`/`margin` (generated the same evenly-spaced
// way seeking-orbs.js's encounterParamPositions() already works), plus a further visibility
// retune (axisOffset 2.2->1.4, approachRadius 18->20) — verified directly against the real curve/
// chase-cam geometry that this placement geometry generalizes cleanly across all 24+ generated
// positions with zero weak spots, not just the 3 hand-picked "easy" spots from v2.7.
//
// ACCESSOR CONTRACT (identical to seeking-orbs.js/guide.js — see either file's own header comment
// for the full rationale): `travelAxisAccessor` is a zero-arg function returning a THREE.Curve-like
// object exposing getPointAt(t)/getTangentAt(t) over the traverse's own local [0,1]
// parametrization. It is called on demand (never captured once), so this module tolerates
// vortex.js not having built its curve yet at construction time — a null/not-ready axis is a safe
// no-op, not a throw, exactly like seeking-orbs.js's resolveAxis(). This is also what avoids the
// vortex.js<->vision.js circular-import hazard ARCHITECTURE.md warns about elsewhere: this module
// never imports vortex.js directly, main.js passes vortex.js's exported getVortexAxis in by
// reference instead.
//
// PLACEMENT: each encounter is placed once, at creation, not re-derived every frame the way
// curve-relative *moving* scenery would need to be (the axis itself is static once built, so a
// single placement per encounter is safe — mirrors how seeking-orbs.js still re-asserts placement
// every frame defensively in case the axis is rebuilt on resize; this module does the same, for
// each of its now-multiple locations).
//
// ALPHA-KEYING: gone entirely as of v2.21 — see the asset comment below. Every earlier revision of
// this module carried some per-pixel keying hack (v2.8's SILHOUETTE_KEY_BAND, v2.15's removed
// SCREEN_KEY_BAND/SCREEN_WARMTH_BAND) because the source assets shipped without real alpha, and
// every one of them produced at least one shipped bug: an invisible figure, then a visible box.
//
// LIGHTING LESSON (carried over from every other module in this codebase): ZERO THREE.Light
// objects here. Each encounter's TV glow-halo is an unlit, additive-blended, camera-facing glow
// sprite in VISION_ENCOUNTER.screenGlowColor (v2.15: converted from a flat, hard-edged
// MeshBasicMaterial+PlaneGeometry rectangle — glow-sprite.js's shared soft radial-gradient texture
// now used instead, same "glow is the material's own unlit color, never illumination from an
// external light source" discipline seeking-orbs.js/guide.js/the removed room-scene subsystem all
// already followed, just with a texture that actually fades to transparent at its own edge instead
// of ending in a hard rectangular silhouette).

import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { VISION_ENCOUNTER, CAMERA } from '../config.js';
import { buildGlowOrb, getSharedGlowTexture } from './glow-sprite.js';
import apparitionUrl from '../assets/vision-apparition.png';

// --- The composite apparition asset ---------------------------------------------------------
//
// v2.21: the two source photographs (couch-silhouette.jpg + tv-404-screen.png) and the entire
// luminance-keying pipeline that went with them are GONE, replaced by one composite RGBA render
// (src/assets/vision-apparition.png) drawn with ADDITIVE blending. Three separate wins, each of
// which was a real bug or a real cost in the old design:
//
//   1. NO KEYING AT ALL. The old silhouette asset shipped as an opaque JPG, so its alpha had to be
//      computed at runtime from luminance (SILHOUETTE_KEY_BAND, removed). That was never robust —
//      v2.8's "I can't see the silhouette" was exactly this key eating the figure — and it can't be
//      made robust for a composite: measured directly on the new render, the man's body and the
//      surrounding void share the same median luminance (5 vs 5), so NO threshold separates
//      subject from background. Under additive blending none is needed: the asset is preprocessed
//      so its void is crushed to pure black, and adding black is a no-op. Its alpha channel now
//      carries only a soft edge feather (the couch runs off the canvas's left/bottom edges in the
//      source render, so without the feather the plane would end in a hard photographic cut).
//   2. NO MAIN-THREAD PIXEL WALK. v2.20 had to slice the keying loop across idle callbacks because
//      a 1.08-megapixel synchronous getImageData/putImageData pass landed a 317ms frame gap inside
//      the fall-in ("the initial camera movement feels very shaky"). With real alpha there is no
//      pass to slice — a plain TextureLoader decode, and the whole class of hazard is retired.
//   3. NO BOX. Every "I can still see the box around the TV" report (v2.15) traced back to some
//      near-black-but-not-black rectangle rendering additively. The preprocessing floor-crush is
//      the direct fix: any pixel below the noise floor is exactly (0,0,0), which under additive
//      blending contributes literally nothing.
//
// The cost, accepted deliberately: the figure's darkest areas are see-through, so tunnel streaks
// pass behind/through him. That is what VISION_ENCOUNTER.peakOpacity's own comment already
// authorizes — "an apparition, not solid scenery."

/**
 * v2.15, NEW / v2.21, now the ONLY loader in this module — loads `url` as a plain
 * THREE.TextureLoader texture, trusting its own real alpha channel as-is (no per-pixel re-keying,
 * no canvas round-trip, nothing on the main thread beyond the browser's own decode). See this
 * file's header comment for why the composite apparition asset needs nothing more than this.
 */
function loadAlphaTexture(url) {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.premultiplyAlpha = false;
        const aspect = texture.image.width / texture.image.height;
        resolve({ texture, aspect });
      },
      undefined,
      reject
    );
  });
}

// Module-scope cache: the texture is decoded exactly once (shared across every encounter instance —
// same source asset regardless of how many places it's displayed), the first time createVision()
// needs it, and reused by every subsequent call — never re-decoded per frame, per ARCHITECTURE.md's
// explicit instruction. Stored as a shared promise so concurrent/rapid calls (e.g. a hot module
// reload) never kick off the loading work twice.
let _apparitionAssetPromise = null;

function getApparitionAsset() {
  if (!_apparitionAssetPromise) {
    _apparitionAssetPromise = loadAlphaTexture(apparitionUrl);
  }
  return _apparitionAssetPromise;
}

/**
 * Resolves the travel-axis curve from the accessor, tolerating it not being ready yet — mirrors
 * seeking-orbs.js's resolveAxis()/guide.js's resolveAxis() exactly (same contract, same defensive shape).
 */
function resolveAxis(travelAxisAccessor) {
  if (typeof travelAxisAccessor !== 'function') return null;
  const axis = travelAxisAccessor();
  if (!axis || typeof axis.getPointAt !== 'function' || typeof axis.getTangentAt !== 'function') {
    return null;
  }
  return axis;
}

/**
 * Generates VISION_ENCOUNTER.count evenly-spaced placement fractions across the traverse, avoiding
 * the very start/end (VISION_ENCOUNTER.margin) — identical shape to seeking-orbs.js's own
 * encounterParamPositions(), reused here rather than reinvented (v2.8: replaces the v2.7 hand-
 * picked `axisFractions` array — verified directly against the real curve/chase-cam geometry that
 * this even-spacing approach generalizes cleanly across all 24+ generated positions, not just a
 * few hand-selected "easy" spots, so hand-picking individual fractions is no longer necessary).
 */
function encounterFractions() {
  const count = Math.max(1, VISION_ENCOUNTER.count | 0);
  const margin = VISION_ENCOUNTER.margin ?? 0.05;
  const span = 1 - margin * 2;
  const positions = [];
  for (let i = 0; i < count; i++) {
    positions.push(count === 1 ? 0.5 : margin + (span * (i + 0.5)) / count);
  }
  return positions;
}

// The cropped composite's real aspect (1060x640) — a placeholder only, so the plane isn't
// degenerate in the frames before the texture decodes; the decoded aspect replaces it.
const PLACEHOLDER_ASPECT = 1060 / 640;

// Scratch vectors for the plane's own local frame (derived fresh from its post-lookAt quaternion
// every placement) — module-scope to avoid allocating per encounter per frame, same discipline as
// the per-frame scratch vectors updateVision() already uses.
const _planeForward = new THREE.Vector3();
const _planeRight = new THREE.Vector3();
const _planeUp = new THREE.Vector3();
const _behindPlane = new THREE.Vector3();

/**
 * Places one encounter's composite plane (+ its screen glow) at a fixed axis location, once
 * the travel axis resolves. Safe to call repeatedly (e.g. every frame, defensively, exactly like
 * seeking-orbs.js's placeClustersAlongAxis) — cheap, and a no-op once already placed unless the
 * axis is rebuilt (this module doesn't currently distinguish "rebuilt" from "already placed,"
 * matching seeking-orbs.js's own "cheap enough not to bother caching" reasoning).
 */
function placeEncounter(encounter, axis) {
  const up = new THREE.Vector3(0, 1, 0);
  const t = THREE.MathUtils.clamp(encounter.axisFraction, 0, 1);

  const point = axis.getPointAt(t);
  const tangent = axis.getTangentAt(t).normalize();
  const right = new THREE.Vector3().crossVectors(tangent, up).normalize();

  const anchor = point.clone()
    .addScaledVector(right, encounter.side * VISION_ENCOUNTER.axisOffset)
    .add(new THREE.Vector3(0, VISION_ENCOUNTER.heightOffset, 0));
  encounter.anchor.copy(anchor);
  // v2.11: persisted so the energy-orb orbit (updateVision) can build its own local frame from
  // this encounter's actual orientation rather than a raw world-axis assumption — same "derive
  // lateral/vertical placement from the real local frame" discipline vortex.js's companion-orb
  // placement already follows for the curved travel axis.
  encounter.right.copy(right);
  encounter.up.copy(up);

  // The composite plane sits at the anchor, facing back along the axis toward oncoming camera
  // travel — same "face the planes back toward the camera direction" pattern seeking-orbs.js's
  // lookAt(point + tangent * -N) already uses. v2.21: ONE plane now; the figure/screen relationship
  // that used to be staged in 3D (two cards 1.6m apart) lives inside the picture instead.
  const lookTarget = point.clone().addScaledVector(tangent, -4);
  encounter.plane.position.copy(anchor);
  encounter.plane.lookAt(lookTarget);

  // The glow halo is parked on the TV WITHIN the composite, not at the plane's center — derived
  // from the plane's OWN local axes (post-lookAt), never from the axis-perpendicular `right`/world
  // `up`, since the plane's facing is what the picture's own left/right/up is measured against.
  // VISION_ENCOUNTER.screenCenterOffset is authored in fractions of the plane's width/height (two
  // different scalars) — see its config comment for the measurements.
  // All three axes derived from the plane's own LOCAL quaternion, never getWorldDirection() —
  // matrixWorld is only refreshed by the renderer's updateMatrixWorld() pass, which runs AFTER this
  // update loop, so reading it here would see last frame's orientation (identity on the very first
  // placement). Exactly the hazard updateVision()'s _cameraForward comment already documents. Note
  // that for a non-camera Object3D, lookAt() points local +Z AT the target — i.e. +Z faces the
  // camera side — so the plane's "back" is -Z.
  _planeForward.set(0, 0, -1).applyQuaternion(encounter.plane.quaternion);
  _planeRight.set(1, 0, 0).applyQuaternion(encounter.plane.quaternion);
  _planeUp.set(0, 1, 0).applyQuaternion(encounter.plane.quaternion);

  const halfW = encounter.planeWidth * 0.5;
  const halfH = encounter.planeHeight * 0.5;
  const screenAnchor = anchor.clone()
    .addScaledVector(_planeRight, VISION_ENCOUNTER.screenCenterOffset.right * 2 * halfW)
    .addScaledVector(_planeUp, VISION_ENCOUNTER.screenCenterOffset.up * 2 * halfH);

  // ...and just behind the plane (away from the camera side) so the halo reads as light spilling
  // out from the CRT rather than a disc pasted over it. v2.15: a THREE.Sprite, always camera-facing
  // by construction — position only, no quaternion to sync.
  _behindPlane.copy(_planeForward).multiplyScalar(0.05);
  encounter.screenGlowBasePosition.copy(screenAnchor).add(_behindPlane);
  encounter.screenGlow.position.copy(encounter.screenGlowBasePosition);

  encounter.placed = true;
}

function placeAllEncounters(handle) {
  const axis = resolveAxis(handle.travelAxisAccessor);
  if (!axis) return false;
  for (const encounter of handle.encounters) {
    placeEncounter(encounter, axis);
  }
  return true;
}

/**
 * createVision(scene, travelAxisAccessor)
 *
 * Builds VISION_ENCOUNTER.count independent plane+glow+energy-orb encounters (alternating side per
 * instance, mirroring seeking-orbs.js's own alternate-side-per-encounter convention), all initially
 * hidden (mirrors seeking-orbs.js's `mesh.visible = false` until first placement resolves a real
 * axis), kicks off the ONE-TIME async texture decode shared across every instance, and returns a
 * handle consumed by updateVision(). The texture is not necessarily ready the instant this function
 * returns (image decode is async) — updateVision() checks `handle.texturesReady` every frame and
 * swaps the real texture onto every instance's material the first frame it resolves, exactly the
 * same "tolerate not being ready yet, retry every frame" posture this module already applies to the
 * travel-axis accessor.
 */
export function createVision(scene, travelAxisAccessor) {
  const group = new THREE.Group();
  group.name = 'vision-encounters';
  scene.add(group);

  const fractions = encounterFractions();
  const encounters = fractions.map((axisFraction, i) => {
    // v2.21: ADDITIVE, not normal alpha blending — the composite asset's void is preprocessed to
    // pure black, and adding black is a no-op, so no per-pixel keying is needed to hide it (see
    // this file's header comment for why no luminance key COULD work on this asset: the man's body
    // and the void share the same median luminance). `transparent: true` is still required for the
    // material's own `opacity` to drive the proximity fade.
    const planeMaterial = new THREE.MeshBasicMaterial({
      map: null,
      transparent: true,
      opacity: 0,
      toneMapped: false,
      fog: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    // Aspect placeholder (the real decoded 16:9 aspect is swapped in once the image loads) so the
    // plane isn't degenerate before the texture resolves.
    const planeGeometry = new THREE.PlaneGeometry(VISION_ENCOUNTER.planeWidth, VISION_ENCOUNTER.planeWidth / PLACEHOLDER_ASPECT);
    const plane = new THREE.Mesh(planeGeometry, planeMaterial);
    plane.visible = false;
    group.add(plane);

    // The screen's own glow halo — unlit, additive, camera-facing soft glow sprite positioned just
    // behind it (see placeEncounter). Zero THREE.Light objects anywhere in this module, per this
    // file's header comment.
    //
    // v2.15 FIX — feedback: "I can still see the box around the tv." Root cause (verified: this
    // was a real, separate bug from the screen-texture border, not a duplicate report of it): this
    // halo used to be a PlaneGeometry+MeshBasicMaterial with `map: null` — with no gradient
    // texture, a plain, additively-blended, flat-colored plane renders as a literal hard-edged
    // rectangle. That flat rectangle, 1.7x the screen's own size, WAS the box. Fixed by building it
    // as a THREE.Sprite sharing glow-sprite.js's soft radial-gradient texture (the same "one
    // texture, many tinted/scaled sprites" primitive every other glow effect in this codebase
    // already uses) — a sprite is always camera-facing by construction (no rotation/quaternion
    // tracking needed to keep it facing the viewer, unlike the screen plane itself) and its own
    // texture genuinely fades to zero alpha at its edge, so there is no hard silhouette to read as
    // a box regardless of viewing angle.
    const glowMaterial = new THREE.SpriteMaterial({
      map: getSharedGlowTexture(),
      color: VISION_ENCOUNTER.screenGlowColor,
      transparent: true,
      opacity: 0,
      toneMapped: false,
      fog: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const screenGlow = new THREE.Sprite(glowMaterial);
    // v2.16: halo diameter authored via VISION_ENCOUNTER.screenGlowScale (was a hardcoded 2.2) —
    // at 2.2x the halo spanned ~12m and drowned the whole encounter in a flat brown disc; see
    // config.js's screenGlowScale comment. v2.21: sized off the TV's own width INSIDE the composite
    // (planeWidth * screenWidthFraction), not off the whole plane — the plane is now the entire
    // scene, so scaling the halo to it would put a 15m disc over the couch, the man and the void.
    const glowDiameter = VISION_ENCOUNTER.planeWidth * VISION_ENCOUNTER.screenWidthFraction * VISION_ENCOUNTER.screenGlowScale;
    screenGlow.scale.set(glowDiameter, glowDiameter, 1);
    screenGlow.visible = false;
    group.add(screenGlow);

    // v2.11, NEW — feedback: "let's add circling orbs around the silhouette, like energy
    // spheres." A small, fixed population of glow-sprite orbs (see glow-sprite.js — the same
    // core+halo additive technique every other orb in this codebase uses) in continuous slow
    // orbit around THIS encounter's own anchor point. Distinct from vortex.js's ambient
    // companion-orb "surround" behavior (VISION_ENCOUNTER.surroundRadius/surroundClusterFraction)
    // — these are always present at every encounter, not a population subset that happens to be
    // nearby, so they read as the encounter's own energy rather than passersby.
    const energyOrbCount = Math.max(0, VISION_ENCOUNTER.energyOrbCount | 0);
    const energyOrbs = Array.from({ length: energyOrbCount }, (_, orbIndex) => {
      const { group: orbGroup, core, halo } = buildGlowOrb(
        VISION_ENCOUNTER.energyOrbColor,
        VISION_ENCOUNTER.energyOrbCoreDiameter,
        VISION_ENCOUNTER.energyOrbHaloDiameter
      );
      orbGroup.visible = false; // stays hidden until first placement resolves a real axis, mirrors the silhouette/screen/glow planes above
      group.add(orbGroup);

      // Evenly spaced starting angles around the orbit (golden-angle-free here since a small,
      // fixed count per encounter benefits more from deliberate even spacing than from avoiding
      // large-population hue collisions — a concern that doesn't apply to positions), each with
      // its own randomized speed (within energyOrbSpeedHz's range), orbit radius, and vertical
      // offset so the small cluster reads as several independent orbits, not one ring rotating as
      // a rigid body.
      return {
        mesh: orbGroup,
        core,
        halo,
        angle: (orbIndex / Math.max(1, energyOrbCount)) * Math.PI * 2,
        speedHz: THREE.MathUtils.lerp(VISION_ENCOUNTER.energyOrbSpeedHz.min, VISION_ENCOUNTER.energyOrbSpeedHz.max, Math.random()),
        direction: orbIndex % 2 === 0 ? 1 : -1, // alternate orbit direction so adjacent orbs don't read as one synchronized ring
        radiusScale: 0.75 + Math.random() * 0.5, // per-orb orbit radius variation (~0.75x-1.25x of energyOrbRadius) so the cluster reads as several independent orbits, not one rigid ring
        heightOffset: (Math.random() - 0.5) * VISION_ENCOUNTER.energyOrbHeightSpread,
      };
    });

    return {
      id: `vision-${i}`,
      axisFraction,
      side: i % 2 === 0 ? VISION_ENCOUNTER.side : -VISION_ENCOUNTER.side, // alternate sides per instance, same convention seeking-orbs.js/glyphs.js used
      plane,
      screenGlow,
      planeMaterial,
      glowMaterial,
      // The plane's real world dimensions — placeholder values until the texture's true aspect
      // resolves, then re-derived alongside the geometry swap. placeEncounter reads these to park
      // the glow halo on the TV inside the picture.
      planeWidth: VISION_ENCOUNTER.planeWidth,
      planeHeight: VISION_ENCOUNTER.planeWidth / PLACEHOLDER_ASPECT,
      energyOrbs,
      placed: false,
      anchor: new THREE.Vector3(),
      right: new THREE.Vector3(), // this encounter's own local "right" (perpendicular to the travel axis) — set by placeEncounter, consumed by the energy-orb orbit
      up: new THREE.Vector3(), // this encounter's own local "up" — set by placeEncounter (currently always world-up, kept as its own field for the same "don't assume a raw world axis" discipline as `right`)
      currentOpacity: 0, // last-authored proximity-driven opacity (0..VISION_ENCOUNTER.peakOpacity), tracked for symmetric fade-in/out
      // v2.12 / v2.21 — the glow halo's un-jittered base position (set by placeEncounter every
      // frame), so updateVision() can layer the CRT-static jitter on top without compounding or
      // drifting across frames (placeEncounter always re-derives this fresh from the travel axis,
      // never from the jittered transform of the previous frame). v2.21: the jitter moved OFF the
      // picture plane and onto the halo alone — the plane is now the whole scene, and shaking it
      // would shake the couch and the man, not just a TV. The plane's own "unstable signal" read is
      // an opacity flicker instead (VISION_ENCOUNTER.planeFlickerAmplitude).
      screenGlowBasePosition: new THREE.Vector3(),
      jitterSeed: Math.random() * 1000, // per-encounter offset into the noise field so multiple screens don't jitter in lockstep
    };
  });

  const handle = {
    group,
    encounters,
    travelAxisAccessor,
    texturesReady: false,
  };

  // Best-effort initial placement in case the axis is already available (mirrors seeking-orbs.js's
  // createSeekingOrbs() calling placeClustersAlongAxis() once up front) — harmless no-op otherwise,
  // updateVision() retries every frame until an axis resolves.
  placeAllEncounters(handle);

  // Kick off the (async, one-time, cached) texture decode. Never re-entered per frame —
  // getApparitionAsset() memoizes the underlying promise at module scope. Applied to every
  // encounter instance once resolved, since they all share the same source render.
  getApparitionAsset().then((apparition) => {
    const planeWidth = VISION_ENCOUNTER.planeWidth; // sized for glyph-size parity with the old build — see config.js
    const planeHeight = planeWidth / apparition.aspect;
    for (const encounter of encounters) {
      encounter.planeMaterial.map = apparition.texture;
      encounter.planeMaterial.needsUpdate = true;
      encounter.plane.geometry.dispose();
      encounter.plane.geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
      encounter.planeWidth = planeWidth;
      encounter.planeHeight = planeHeight;
      // v2.15: screenGlow is a THREE.Sprite (see its own construction comment) — sized via `scale`,
      // not a geometry swap. Re-set here too (not just at construction) for symmetry with the
      // geometry re-derivation above; the diameter itself is independent of the decoded aspect
      // since it's measured off the TV's width fraction, which is a width-only measurement.
      const glowDiameter = planeWidth * VISION_ENCOUNTER.screenWidthFraction * VISION_ENCOUNTER.screenGlowScale;
      encounter.screenGlow.scale.set(glowDiameter, glowDiameter, 1);
    }
    handle.texturesReady = true;
  });

  return handle;
}

// Scratch vector for the forward-projected reference point the proximity curve measures from (see
// updateVision()'s own comment below for why raw camera.position is the wrong thing to measure
// distance from here) — module-scope to avoid an allocation every frame, same discipline every
// other per-frame scratch vector in this codebase already follows.
const _lookAheadPoint = new THREE.Vector3();
const _cameraForward = new THREE.Vector3();

// v2.12, NEW — the TV screen's CRT-static jitter (see VISION_ENCOUNTER.screenJitter* comment).
// Three independent noise fields (glow-halo position x/y in the encounter's own right/up plane,
// plus a third driving the picture plane's brightness flicker — v2.21, previously the screen
// card's rotation) so the effect reads as unsteady static rather than one obvious oscillation —
// same "several independent noise channels, not one shared value reused" discipline camera.js's
// own noiseA/noiseB/noiseC bank/roll perturbation already follows.
const _jitterNoiseX = createNoise2D();
const _jitterNoiseY = createNoise2D();
const _jitterNoiseRot = createNoise2D();
const _jitterOffset = new THREE.Vector3();

/**
 * Each frame: keeps every encounter positioned on the current travel axis (retrying placement
 * until the accessor resolves, exactly like seeking-orbs.js's updateSeekingOrbs()), measures
 * proximity to each encounter's own anchor independently, and drives a continuous, distance-based
 * opacity fade per instance — never a discrete toggle, fully symmetric for both scroll directions
 * (the same proximity value produces the same opacity whether the camera is approaching or
 * receding, since this is a pure function of the current camera position/orientation each frame,
 * with no direction-dependent state or hysteresis). v2.10: the opacity curve is now a PLATEAU
 * (full peak opacity for any distance inside VISION_ENCOUNTER.plateauRadius, smoothstepped down to
 * 0 between plateauRadius and approachRadius) rather than seeking-orbs.js's own pure inverse-
 * square falloff shape — that shape only ever touches its own peak for a single instant at
 * distance=0, which measured out to under 2 seconds of real legibility even at idle scroll speed,
 * nowhere near enough to actually read a photographic image (feedback: "the image fades in/out too
 * fast, the user won't even understand what they're seeing"). This apparition is still meant to be
 * glimpsed, never solid scenery (peakOpacity < 1, per config.js's own comment) — the fix is
 * duration at peak, not permanence.
 *
 * PROXIMITY REFERENCE POINT (verified by direct numeric trace of the chase-cam geometry against
 * each encounter's lateral placement): measuring proximity from the camera's raw position produces
 * an opacity curve that peaks exactly at the camera's closest 3D approach — but because each
 * encounter sits laterally off-axis (VISION_ENCOUNTER.axisOffset) while the chase-cam's lookAt
 * target leads the camera's own position by (CAMERA.chase.distanceBehind +
 * CAMERA.chase.lookAheadBeyond) meters, closest 3D approach can land well off the camera's actual
 * boresight. Measuring proximity instead from a point projected the SAME distance ahead of the
 * camera as its own lookAt target (i.e. where the camera is actually looking, not merely where it
 * physically is) re-centers the opacity curve on the window where the encounter is still roughly
 * on-boresight, without touching config.js's authored axisOffset/approachRadius/peakOpacity or
 * changing the curve's shape/continuity/symmetry at all — still a pure function of the camera's
 * current position+orientation each frame.
 */
export function updateVision(handle, state, camera, dt) {
  if (!handle) return;

  const placedOk = placeAllEncounters(handle);
  if (!placedOk || !handle.texturesReady) {
    // Axis and/or keyed textures not ready yet — every instance stays hidden, nothing more to do
    // this frame.
    for (const encounter of handle.encounters) {
      encounter.plane.visible = false;
      encounter.screenGlow.visible = false;
      for (const orb of encounter.energyOrbs) orb.mesh.visible = false;
    }
    return;
  }

  // Forward direction from camera.quaternion directly, NOT camera.getWorldDirection() — the
  // camera has no parent (createCamera() never adds it to the scene graph) but its matrixWorld is
  // still only refreshed by the renderer's own updateMatrixWorld() pass, which runs AFTER this
  // update loop each frame; reading it here would see LAST frame's orientation, one frame stale
  // relative to the camera.lookAt() call main.js already made earlier this same frame.
  // camera.quaternion is a plain local property set synchronously by that lookAt() call, so it's
  // always current. Default THREE camera forward is -Z, per THREE's own camera convention.
  _cameraForward.set(0, 0, -1).applyQuaternion(camera.quaternion);
  const aheadDistance = CAMERA.chase.distanceBehind + CAMERA.chase.lookAheadBeyond;
  _lookAheadPoint.copy(camera.position).addScaledVector(_cameraForward, aheadDistance);

  const plateauRadius = VISION_ENCOUNTER.plateauRadius ?? 0;
  const outerRadius = Math.max(plateauRadius + 0.001, VISION_ENCOUNTER.approachRadius);

  for (const encounter of handle.encounters) {
    const distance = _lookAheadPoint.distanceTo(encounter.anchor);

    // v2.10 FIX (feedback: "the image fades in/out too fast, the user won't even understand what
    // they're seeing") — PLATEAU curve, replacing the old pure inverse-square falloff that only
    // ever touched its own peak for a single instant. Full peak opacity for any distance at or
    // inside `plateauRadius` (a genuine held moment, not a point), smoothstepped down to 0 between
    // `plateauRadius` and `outerRadius` (`approachRadius`) — still continuous in `distance` alone,
    // so it remains automatically symmetric for both scroll directions (passing the point twice,
    // once each way, produces the identical opacity trace, just time-reversed) and still a pure
    // function of camera position/orientation each frame, same as before.
    let eased;
    if (distance <= plateauRadius) {
      eased = 1;
    } else if (distance >= outerRadius) {
      eased = 0;
    } else {
      const t = (distance - plateauRadius) / (outerRadius - plateauRadius);
      eased = 1 - t * t * (3 - 2 * t); // smoothstep, inverted (1 at the plateau's own edge, 0 at the outer edge)
    }

    const targetOpacity = eased * VISION_ENCOUNTER.peakOpacity;
    const targetGlowOpacity = eased * VISION_ENCOUNTER.screenGlowPeakOpacity;

    const visible = targetOpacity > 0.001 || encounter.currentOpacity > 0.001;
    encounter.plane.visible = visible;
    encounter.screenGlow.visible = visible;

    // v2.12 / v2.21 — the CRT-static read. Sampled off state.traverse.elapsedSeconds (never
    // state.clockTime — frozen during traverse, per this codebase's established frozen-clock rule),
    // so it keeps animating regardless of scroll speed/direction, same discipline as the energy
    // orbs' orbit below. v2.21 SPLIT: the positional/rotational jitter now moves the GLOW HALO only
    // (the picture plane carries the couch and the man — translating it would shake the furniture,
    // which reads as a wobbling prop, not an unstable signal), while the plane itself gets a small
    // brightness flutter. Both are applied on top of values re-derived fresh this frame
    // (screenGlowBasePosition / targetOpacity), never accumulated, so neither can drift.
    const elapsedSeconds = state.traverse?.elapsedSeconds ?? 0;
    const jitterT = elapsedSeconds * VISION_ENCOUNTER.screenJitterSpeedHz + encounter.jitterSeed;
    const flicker = 1 + _jitterNoiseRot(jitterT, 0) * VISION_ENCOUNTER.planeFlickerAmplitude;
    encounter.planeMaterial.opacity = Math.max(0, targetOpacity * flicker);
    // The glow fades "in lockstep with the screen image itself" per ARCHITECTURE.md's fade
    // section — driven by the exact same `eased` proximity term as the picture plane, just scaled
    // toward its own (config.js-authored) peak rather than peakOpacity.
    encounter.glowMaterial.opacity = targetGlowOpacity;

    encounter.currentOpacity = targetOpacity;

    {
      const jx = _jitterNoiseX(jitterT, 0) * VISION_ENCOUNTER.screenJitterAmplitude;
      const jy = _jitterNoiseY(jitterT, 0) * VISION_ENCOUNTER.screenJitterAmplitude;
      _jitterOffset.copy(encounter.right).multiplyScalar(jx)
        .addScaledVector(encounter.up, jy);
      encounter.screenGlow.position.copy(encounter.screenGlowBasePosition).add(_jitterOffset);
      // v2.15: screenGlow is a THREE.Sprite — always camera-facing by construction, so there is no
      // quaternion to jitter (see its construction comment); the rotational noise channel now
      // drives the plane's opacity flicker above instead of being discarded.
    }

    // v2.11, NEW — advance this encounter's energy-orb orbits. Sampled off
    // state.traverse.elapsedSeconds (real wall-clock time IN the traverse phase, never frozen) —
    // NOT state.clockTime, which this codebase's own established discipline warns is frozen for
    // the entire traverse (see e.g. guide.js's bob/weave clock-selection comment for the same
    // rule applied elsewhere) — so the orbit keeps moving continuously regardless of scroll speed
    // or direction, exactly like every other continuous ambient motion in this piece. Visibility/
    // opacity rides the SAME `eased` proximity term the silhouette/screen/glow above just used, so
    // the energy orbs fade in and out in lockstep with the rest of the encounter — they're part of
    // the same held moment, not a separately-timed effect.
    const elapsed = state.traverse?.elapsedSeconds ?? 0;
    const energyOpacity = eased * VISION_ENCOUNTER.energyOrbPeakOpacity;
    const energyVisible = energyOpacity > 0.001;
    for (const orb of encounter.energyOrbs) {
      orb.mesh.visible = energyVisible;
      if (!energyVisible) continue;

      // Orbit in the encounter's own local right/up plane (persisted on the encounter by
      // placeEncounter, derived from the real travel-axis tangent) rather than a raw world-axis
      // assumption — same "derive lateral/vertical placement from the actual local frame"
      // discipline vortex.js's companion-orb placement/streak cross-sections already apply for
      // the curved travel axis. Per-orb `radiusScale`/`heightOffset`/`direction` (seeded once at
      // construction) keep the small cluster reading as several independent orbits, not one rigid
      // ring rotating as a single body.
      const angle = orb.angle + elapsed * orb.speedHz * Math.PI * 2 * orb.direction;
      const radius = VISION_ENCOUNTER.energyOrbRadius * orb.radiusScale;
      orb.mesh.position.copy(encounter.anchor)
        .addScaledVector(encounter.right, Math.cos(angle) * radius)
        .addScaledVector(encounter.up, Math.sin(angle) * radius * 0.6 + orb.heightOffset);

      orb.core.material.opacity = energyOpacity;
      orb.halo.material.opacity = energyOpacity * 0.3;
    }
  }
}
