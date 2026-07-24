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
