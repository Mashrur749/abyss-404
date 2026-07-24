// src/scene/glow-sprite.js (NEW — v2.9)
//
// Shared "soft glowing orb" rendering primitive — factored out of guide.js's own radial-gradient
// CanvasTexture (which the Guiding Orb has used since v2.4) so companion-orbs and seeking-orbs.js
// can build genuinely soft, additively-blended glow sprites too, instead of solid
// SphereGeometry+MeshBasicMaterial spheres (which is what they were — literal lit-looking balls
// with a hard silhouette edge, not glows, the direct cause of feedback "the portal orbs doesn't
// have the glow effect, they need to represent soft glowing orbs of soul").
//
// ONE shared texture (module-scope cache, built once, reused by every sprite this module or any
// caller creates) — the same "one texture, many tinted/scaled sprites" discipline guide.js already
// established, now genuinely shared across files instead of each module quietly reinventing its
// own copy of the same ~20-line canvas-gradient function (the sort of duplication this codebase's
// own ARCHITECTURE.md explicitly warns against elsewhere as a single-source-of-truth risk).
//
// Deliberately a SIMPLER stack than the Guiding Orb's own 5-layer (core + rings + outer halo)
// treatment: two layers (a small bright core + one larger soft outer halo) is enough to read as
// "a soft glowing presence" without matching the Guide's visual complexity — companion/seeking
// orbs must stay visually subordinate to the Guide (CONCEPT.md's "the orb is deliberately the
// brightest, warmest thing in frame" non-negotiable), and a population of 14-100+ of these needs
// to stay cheap to render.

import * as THREE from 'three';

let _sharedTexture = null;

/**
 * Builds the one soft radial-gradient CanvasTexture every glow sprite in this codebase shares:
 * fully opaque white at the center, easing smoothly (multiple stops, not a linear ramp — a linear
 * alpha ramp on a radial gradient still reads as a faint visible edge) out to fully transparent at
 * the rim. Identical shape to guide.js's own buildGlowTexture(), extracted here as the shared
 * source of truth.
 */
function buildGlowTexture() {
  const size = 128; // smaller than guide.js's own 256 — this texture is reused across a much larger
                     // population of much smaller on-screen sprites, no benefit to the extra resolution
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2;

  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  gradient.addColorStop(0.0, 'rgba(255,255,255,1.0)');
  gradient.addColorStop(0.2, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.22)');
  gradient.addColorStop(0.8, 'rgba(255,255,255,0.06)');
  gradient.addColorStop(1.0, 'rgba(255,255,255,0.0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Lazily builds + caches the one shared glow texture — safe to call from any module, any number
 * of times; the actual canvas work only ever happens once per page load. */
export function getSharedGlowTexture() {
  if (!_sharedTexture) _sharedTexture = buildGlowTexture();
  return _sharedTexture;
}

let _sharedStreakTexture = null;

/**
 * v2.18, NEW — the soft ELONGATED sibling of the round glow texture above: a luminous thread
 * with a bright centerline, soft edges across its width, and both ends tapering to nothing.
 *
 * Why this exists: until v2.18 the vortex field was 2400 opaque `BoxGeometry` sticks. A box has
 * a hard silhouette, and this renderer runs `antialias: false` permanently (see main.js — canvas
 * MSAA resurrects a documented depth-blit crash), so every one of those edges was also aliased.
 * That is the single reason the abyss read as debris/straw rather than light, and it's why two
 * rounds of palette and intensity tuning couldn't fix the feel: no color makes a hard-edged box
 * look like atmosphere. An additively-blended quad carrying this texture has no silhouette at
 * all — it dissolves into the void at its own edges, which is what "premium calm" actually
 * requires and what the reference image's flowing field lines always were.
 *
 * Authored as a direct pixel loop rather than stacked canvas gradients so the across-width and
 * along-length falloffs can be shaped independently: the width falloff is tight (a bright core
 * that reads as a thread, not a smear), the length falloff is gentle (so a streak fades out at
 * its tips instead of ending in two visible chopped-off caps).
 */
function buildStreakTexture() {
  const width = 64;
  const height = 256; // elongated along the geometry's own length axis (local +Y)
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  const data = image.data;

  for (let y = 0; y < height; y++) {
    // 0 at the streak's midpoint, 1 at either tip.
    const v = Math.abs((y + 0.5) / height - 0.5) * 2;
    // Gentle taper: full strength through the middle, easing to zero at the tips.
    const alongLength = Math.max(0, 1 - v * v);
    const lengthFalloff = alongLength * alongLength * (3 - 2 * alongLength);

    for (let x = 0; x < width; x++) {
      // 0 at the centerline, 1 at either long edge.
      const u = Math.abs((x + 0.5) / width - 0.5) * 2;
      // Tight gaussian-style core so the thread keeps a luminous centerline while its edges
      // dissolve completely — the property a BoxGeometry silhouette can never have.
      const widthFalloff = Math.exp(-(u * u) * 5.5);

      const alpha = Math.max(0, Math.min(1, widthFalloff * lengthFalloff));
      const idx = (y * width + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = Math.round(alpha * 255);
    }
  }

  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Lazily builds + caches the one shared elongated streak texture. Same one-texture-many-instances
 * discipline as getSharedGlowTexture() above — the vortex field is a single InstancedMesh, so this
 * texture is built once and shared by every streak in the piece. */
export function getSharedStreakTexture() {
  if (!_sharedStreakTexture) _sharedStreakTexture = buildStreakTexture();
  return _sharedStreakTexture;
}

/**
 * Builds a single glow-sprite "orb": a small bright core sprite plus a larger, dimmer, additively-
 * blended halo sprite, both sharing getSharedGlowTexture(), both tinted the same `color`. Returns
 * `{ group, core, halo }` — `group` is what callers add to the scene/parent group and position
 * every frame; `core`/`halo` are exposed directly so callers can drive opacity/color/scale
 * independently per frame without walking `group.children`.
 *
 * `coreDiameter`/`haloDiameter` are in meters (world units) — callers size these to match whatever
 * this orb population's previous solid-sphere radius/visual scale was, so swapping to this
 * rendering technique doesn't also silently change how large orbs read on screen.
 */
export function buildGlowOrb(color, coreDiameter, haloDiameter) {
  const texture = getSharedGlowTexture();
  const group = new THREE.Group();

  const makeMaterial = () =>
    new THREE.SpriteMaterial({
      map: texture,
      color,
      transparent: true,
      opacity: 1,
      depthWrite: false, // soft additive glow sprites must never occlude each other via the depth
                         // buffer, or overlapping orbs would show hard inter-sprite seams
      toneMapped: false,
      fog: false,
      blending: THREE.AdditiveBlending, // accumulates light rather than alpha-composites, so the
                                          // core+halo pair reads as one continuous falloff, not two
                                          // visibly separate discs
    });

  const core = new THREE.Sprite(makeMaterial());
  core.scale.set(coreDiameter, coreDiameter, 1);
  group.add(core);

  const halo = new THREE.Sprite(makeMaterial());
  halo.scale.set(haloDiameter, haloDiameter, 1);
  group.add(halo);

  return { group, core, halo };
}
