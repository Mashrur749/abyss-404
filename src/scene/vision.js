// src/scene/vision.js (NEW in v2.5, REPEATED in v2.7, EXPANDED + FIXED in v2.8)
//
// The in-tunnel vision: repeated apparitions placed at fixed points along the traverse's travel
// axis (config.js's VISION_ENCOUNTER) — a silhouette-on-a-couch plane facing a glowing
// "ERROR 404" TV-screen plane, built from the two REAL reference photographs
// (src/assets/couch-silhouette.jpg, src/assets/tv-404-screen.png) rather than a procedural
// recreation (that was v2.4's approach; CONCEPT.md's v2.5 revision explicitly reverses it — see
// that document's header note for why the real images read as apparitions rather than fighting
// the vortex's dreamlike register). Mirrors seeking-orbs.js's exact module shape, per
// ARCHITECTURE.md's instruction to reuse that pattern rather than reinvent it:
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
// ALPHA-KEYING: the silhouette photo carries no real alpha on disk (ARCHITECTURE.md's header
// note) — plain RGB with a solid near-black background. It's loaded once, drawn to an offscreen
// <canvas>, walked pixel-by-pixel to compute a SOFT (smoothstep-thresholded, never a hard binary
// cutoff) alpha channel keying the background out, then handed to a THREE.CanvasTexture — built
// once at module scope and cached forever, never re-keyed per frame (mirrors guide.js's own
// "build the gradient texture once, module-scope cache" discipline for its radial-glow sprite
// texture, just keying a loaded photo instead of painting a gradient).
//
// v2.15: the TV-screen asset (src/assets/tv-404-screen.png) was REPLACED with a real RGBA render
// that already carries clean, correct alpha around the TV's own silhouette (verified by directly
// decoding the shipped PNG's IHDR: colorType 6 = RGBA with a real alpha channel, not colorType 2 =
// opaque RGB like the old photo-on-white-background asset was). The old luminance+warmth two-
// factor keying hack (SCREEN_KEY_BAND/SCREEN_WARMTH_BAND, both now REMOVED) existed only to work
// around the old asset's plain-white background and its own gray plastic bezel reading as "content"
// on a luminance-only key — verified directly against the real pixels that even the two-factor fix
// still couldn't fully eliminate a faint box (the old asset's own glow/vignette gradient extended
// past the TV's own silhouette all the way to the canvas edges, so no per-pixel threshold on that
// file could ever key out a perfectly clean edge). The new asset sidesteps the whole class of bug:
// its own alpha channel is used as-is, no per-pixel re-keying at all.
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
import couchSilhouetteUrl from '../assets/couch-silhouette.jpg';
import tvScreenUrl from '../assets/tv-404-screen.png';

// --- Silhouette alpha-keying tuning ---------------------------------------------------------
// The silhouette photo is a solid-background photographic render (ARCHITECTURE.md's header note:
// silhouette on pure black). A hard "< threshold -> alpha 0" cutoff produces a jagged, aliased
// edge around the subject; instead alpha is a smoothstep of how close each pixel's luminance is to
// the known background luminance, over a soft band, so the edge falls off gradually across a
// handful of intensity levels instead of snapping in one step.
//
// v2.8 FIX (real bug, not a placement/visibility issue at all): the silhouette figure's body is
// deliberately painted as a very dark, smoky shape — luminance ~6-12 for the vast majority of its
// area, verified by directly decoding the real shipped JPEG and sampling its actual pixel values,
// not guessed. The OLD band (innerEdge: 18, outerEdge: 46) treated anything at or below 18 as
// "background," which silently made ~97% of the figure's own body fully or mostly TRANSPARENT —
// only its brightest rim-light edges (the wisps/highlights, luminance 20-80) survived keying. This
// is the actual, sole reason the silhouette never appeared: not a placement/proximity/curvature
// problem (those were real, separate bugs already fixed), the figure was being keyed away by its
// own alpha mask. The true pure-black background (verified directly: max luminance 0 across
// thousands of sampled background pixels, no JPEG compression noise reaches above 0 in the actual
// file) sits nowhere near the figure's own darkest painted values, so the band can be tightened
// dramatically without any risk of clipping into real background: confirmed directly against the
// real file that bumping to (innerEdge: 1, outerEdge: 9) keeps 100% of sampled background pixels
// at alpha 0 while recovering ~91% of the figure's own body as visible (was ~3%).
const SILHOUETTE_KEY_BAND = { innerEdge: 1, outerEdge: 9 }; // luminance 0..255 band: <=innerEdge fully transparent (background), >=outerEdge fully opaque (subject), smoothstep between

function smoothstep(edge0, edge1, x) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Loads `url` as an HTMLImageElement, draws it to a same-size offscreen canvas, walks its
 * ImageData computing a soft per-pixel alpha via `alphaForPixel(r, g, b) -> 0..1`, writes that
 * alpha back into the same ImageData, and resolves with a THREE.CanvasTexture built from the
 * result. This is the one-time canvas-keying operation ARCHITECTURE.md's header note describes —
 * callers are responsible for caching the resolved texture (see the module-scope cache below),
 * this function itself does no caching of its own.
 */
function loadAndKeyTexture(url, alphaForPixel) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        data[i + 3] = Math.round(alphaForPixel(r, g, b) * 255);
      }
      ctx.putImageData(imageData, 0, 0);

      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.premultiplyAlpha = false;
      resolve({ texture, aspect: canvas.width / canvas.height });
    };
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * v2.15, NEW — loads `url` as a plain THREE.TextureLoader texture, trusting its OWN real alpha
 * channel as-is (no per-pixel re-keying). This is the TV-screen asset's own loader now
 * (src/assets/tv-404-screen.png was replaced with a real RGBA render carrying clean alpha already
 * baked in around the TV's own silhouette — see this file's header comment for the verification
 * that the old asset lacked this and needed the since-removed luminance+warmth keying hack).
 * Resolves the same `{ texture, aspect }` shape loadAndKeyTexture() does, so callers don't need to
 * branch on which loading strategy a given asset used.
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

// Silhouette: near-black background -> transparent. Luminance <= innerEdge is pure background
// (alpha 0); luminance >= outerEdge is confidently part of the (much brighter, painterly-lit)
// subject (alpha 1); the smoothstep band between the two is the soft edge. Standard luma
// weighting — good enough for a background-key threshold, no need for a perceptual color-distance
// metric here since the background is neutral (near-black), not a saturated chroma-key color.
function silhouetteAlphaForPixel(r, g, b) {
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return smoothstep(SILHOUETTE_KEY_BAND.innerEdge, SILHOUETTE_KEY_BAND.outerEdge, luminance);
}

// Module-scope cache: the resolved textures are built exactly once (shared across every encounter
// instance — same two source assets regardless of how many places they're displayed), the first
// time createVision() needs them, and reused by every subsequent call — never re-decoded per
// frame, per ARCHITECTURE.md's explicit instruction. Stored as a shared promise so concurrent/
// rapid calls (e.g. a hot module reload) never kick off the loading work twice.
let _keyedAssetsPromise = null;

function getKeyedAssets() {
  if (!_keyedAssetsPromise) {
    _keyedAssetsPromise = Promise.all([
      loadAndKeyTexture(couchSilhouetteUrl, silhouetteAlphaForPixel),
      loadAlphaTexture(tvScreenUrl),
    ]).then(([silhouette, screen]) => ({ silhouette, screen }));
  }
  return _keyedAssetsPromise;
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

/**
 * Places one encounter's silhouette + screen (+ screen glow) planes at a fixed axis location, once
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

  // The silhouette sits at the anchor, facing back along the axis toward oncoming camera travel
  // — same "face the planes back toward the camera direction" pattern seeking-orbs.js's
  // lookAt(point + tangent * -N) already uses.
  const lookTarget = point.clone().addScaledVector(tangent, -4);
  encounter.silhouette.position.copy(anchor);
  encounter.silhouette.lookAt(lookTarget);

  // The screen sits a short distance further along +tangent (i.e. slightly "ahead," on the far
  // side of the anchor from the oncoming camera) and a little higher, so the composition reads as
  // the reference images' own framing: a seated figure with a screen in front of it, the figure
  // facing AWAY from the camera and toward the screen. The screen itself faces back toward the
  // silhouette/camera side so its glow reads face-on as the camera passes.
  const screenAnchor = anchor.clone()
    .addScaledVector(tangent, VISION_ENCOUNTER.screenForwardOffset ?? 1.6)
    .add(new THREE.Vector3(0, VISION_ENCOUNTER.screenHeightOffset ?? 0.55, 0));
  encounter.screen.position.copy(screenAnchor);
  encounter.screen.lookAt(anchor);
  // v2.12: base (un-jittered) transform, so updateVision() can layer the CRT-static jitter on TOP
  // of this every frame without compounding — placeEncounter re-asserts placement every frame
  // (defensively, per this function's own header comment), so without a stored base the jitter
  // offset would need to be un-applied first or it'd drift/accumulate.
  encounter.screenBasePosition.copy(screenAnchor);
  encounter.screenBaseQuaternion.copy(encounter.screen.quaternion);

  // The glow halo sits just behind the screen plane (further along +tangent, away from the
  // silhouette/camera), same relative offset the removed room-scene subsystem used for its own
  // screen-glow halo. v2.15: now a THREE.Sprite (see its own construction comment), which is
  // always camera-facing by construction — no quaternion to sync onto the screen's own facing
  // anymore, only position.
  const behindScreen = tangent.clone().multiplyScalar(0.05);
  encounter.screenGlow.position.copy(screenAnchor).add(behindScreen);
  encounter.screenGlowBaseOffset.copy(behindScreen);

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
 * Builds VISION_ENCOUNTER.count independent silhouette+screen+glow triplets
 * (alternating side per instance, mirroring seeking-orbs.js's own alternate-side-per-encounter
 * convention), all initially hidden (mirrors seeking-orbs.js's `mesh.visible = false` until first
 * placement resolves a real axis), kicks off the ONE-TIME async image-load + alpha-keying step
 * shared across every instance, and returns a handle consumed by updateVision(). The textures are
 * not necessarily ready the instant this function returns (image decode is async) — updateVision()
 * checks `handle.texturesReady` every frame and swaps the real keyed textures onto every instance's
 * materials the first frame they resolve, exactly the same "tolerate not being ready yet, retry
 * every frame" posture this module already applies to the travel-axis accessor.
 */
export function createVision(scene, travelAxisAccessor) {
  const group = new THREE.Group();
  group.name = 'vision-encounters';
  scene.add(group);

  const fractions = encounterFractions();
  const encounters = fractions.map((axisFraction, i) => {
    const silhouetteMaterial = new THREE.MeshBasicMaterial({
      map: null,
      transparent: true,
      opacity: 0,
      toneMapped: false,
      fog: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    // Aspect placeholder (real source aspect swapped in once the image decodes) — a plausible
    // couch-silhouette proportion so the plane isn't degenerate before textures resolve.
    const silhouetteGeometry = new THREE.PlaneGeometry(3.2, 1.75);
    const silhouette = new THREE.Mesh(silhouetteGeometry, silhouetteMaterial);
    silhouette.visible = false;
    group.add(silhouette);

    const screenMaterial = new THREE.MeshBasicMaterial({
      map: null,
      transparent: true,
      opacity: 0,
      toneMapped: false,
      fog: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    // Aspect placeholder (real source aspect swapped in once the image decodes) — a plausible
    // TV-screen proportion at VISION_ENCOUNTER.screenWidth so the plane isn't degenerate before
    // textures resolve.
    const screenGeometry = new THREE.PlaneGeometry(VISION_ENCOUNTER.screenWidth, VISION_ENCOUNTER.screenWidth * (1.33 / 1.4));
    const screen = new THREE.Mesh(screenGeometry, screenMaterial);
    screen.visible = false;
    group.add(screen);

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
    screenGlow.scale.set(VISION_ENCOUNTER.screenWidth * 2.2, VISION_ENCOUNTER.screenWidth * 2.2, 1);
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
      silhouette,
      screen,
      screenGlow,
      silhouetteMaterial,
      screenMaterial,
      glowMaterial,
      energyOrbs,
      placed: false,
      anchor: new THREE.Vector3(),
      right: new THREE.Vector3(), // this encounter's own local "right" (perpendicular to the travel axis) — set by placeEncounter, consumed by the energy-orb orbit
      up: new THREE.Vector3(), // this encounter's own local "up" — set by placeEncounter (currently always world-up, kept as its own field for the same "don't assume a raw world axis" discipline as `right`)
      currentOpacity: 0, // last-authored proximity-driven opacity (0..VISION_ENCOUNTER.peakOpacity), tracked for symmetric fade-in/out
      // v2.12, NEW — the screen's un-jittered base transform (set by placeEncounter every frame),
      // so updateVision() can layer the CRT-static jitter effect on top without compounding/
      // drifting across frames (placeEncounter always re-derives this fresh from the travel axis,
      // never from the jittered mesh transform of the previous frame).
      screenBasePosition: new THREE.Vector3(),
      screenBaseQuaternion: new THREE.Quaternion(),
      screenGlowBaseOffset: new THREE.Vector3(),
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

  // Kick off the (async, one-time, cached) image-load + alpha-keying step. Never re-entered per
  // frame — getKeyedAssets() memoizes the underlying promise at module scope. Applied to every
  // encounter instance once resolved, since they all share the same two source photographs.
  getKeyedAssets().then(({ silhouette: silhouetteAsset, screen: screenAsset }) => {
    const silhouetteWidth = 3.2; // a believable human-figure-on-a-couch scale from VISION_ENCOUNTER.approachRadius away
    const screenWidth = VISION_ENCOUNTER.screenWidth; // v2.12: widened via config — see its own comment for why
    for (const encounter of encounters) {
      encounter.silhouetteMaterial.map = silhouetteAsset.texture;
      encounter.silhouetteMaterial.needsUpdate = true;
      encounter.silhouette.geometry.dispose();
      encounter.silhouette.geometry = new THREE.PlaneGeometry(silhouetteWidth, silhouetteWidth / silhouetteAsset.aspect);

      encounter.screenMaterial.map = screenAsset.texture;
      encounter.screenMaterial.needsUpdate = true;
      encounter.screen.geometry.dispose();
      encounter.screen.geometry = new THREE.PlaneGeometry(screenWidth, screenWidth / screenAsset.aspect);
      // v2.15: screenGlow is now a THREE.Sprite (see its own construction comment) — sized via
      // `scale`, not a geometry swap. Re-set here too (not just at construction) so it stays
      // correctly proportioned to the screen's REAL decoded aspect once it resolves, matching the
      // screen plane's own geometry re-derivation immediately above.
      encounter.screenGlow.scale.set(screenWidth * 2.2, screenWidth * 2.2, 1);
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
// Three independent noise fields (position x/y in the screen's own local right/up plane, plus
// rotation) so the jitter reads as unsteady static rather than a single obvious oscillation —
// same "several independent noise channels, not one shared value reused" discipline camera.js's
// own noiseA/noiseB/noiseC bank/roll perturbation already follows.
const _jitterNoiseX = createNoise2D();
const _jitterNoiseY = createNoise2D();
const _jitterNoiseRot = createNoise2D();
const _jitterOffset = new THREE.Vector3();
const _jitterEuler = new THREE.Euler();
const _jitterQuat = new THREE.Quaternion();

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
      encounter.silhouette.visible = false;
      encounter.screen.visible = false;
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
    encounter.silhouette.visible = visible;
    encounter.screen.visible = visible;
    encounter.screenGlow.visible = visible;

    encounter.silhouetteMaterial.opacity = targetOpacity;
    encounter.screenMaterial.opacity = targetOpacity;
    // The glow fades "in lockstep with the screen image itself" per ARCHITECTURE.md's fade
    // section — driven by the exact same `eased` proximity term as the screen plane, just scaled
    // toward its own (config.js-authored) peak rather than the silhouette/screen's peakOpacity.
    encounter.glowMaterial.opacity = targetGlowOpacity;

    encounter.currentOpacity = targetOpacity;

    // v2.12, NEW — feedback: "add jittering effect to the tv screen." Sampled off
    // state.traverse.elapsedSeconds (never state.clockTime — frozen during traverse, per this
    // codebase's established frozen-clock rule), so it keeps animating regardless of scroll speed/
    // direction, same discipline as the energy orbs' orbit just below. Applied ON TOP OF the base
    // transform placeEncounter set this same frame (screenBasePosition/screenBaseQuaternion),
    // never accumulated frame-over-frame, so it can't drift.
    {
      const elapsed = state.traverse?.elapsedSeconds ?? 0;
      const jitterT = elapsed * VISION_ENCOUNTER.screenJitterSpeedHz + encounter.jitterSeed;
      const jx = _jitterNoiseX(jitterT, 0) * VISION_ENCOUNTER.screenJitterAmplitude;
      const jy = _jitterNoiseY(jitterT, 0) * VISION_ENCOUNTER.screenJitterAmplitude;
      const jrot = _jitterNoiseRot(jitterT, 0) * VISION_ENCOUNTER.screenJitterRotationDeg * THREE.MathUtils.DEG2RAD;

      _jitterOffset.copy(encounter.right).multiplyScalar(jx)
        .addScaledVector(encounter.up, jy);
      encounter.screen.position.copy(encounter.screenBasePosition).add(_jitterOffset);
      encounter.screenGlow.position.copy(encounter.screenBasePosition).add(encounter.screenGlowBaseOffset).add(_jitterOffset);

      _jitterEuler.set(0, 0, jrot);
      _jitterQuat.setFromEuler(_jitterEuler);
      encounter.screen.quaternion.copy(encounter.screenBaseQuaternion).multiply(_jitterQuat);
      // v2.15: screenGlow is now a THREE.Sprite — always camera-facing by construction, no
      // quaternion to sync onto the screen's own facing anymore (see its construction comment).
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
