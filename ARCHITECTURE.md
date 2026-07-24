# ARCHITECTURE.md v2.15 — Build Contract Addendum (TV Screen Asset Swap, Glow-Halo Fix, Size)

This is an ADDENDUM on top of v2.14's contract below (still fully in effect). Applied via direct
hand-edits, verified by decoding both the old and new `src/assets/tv-404-screen.png` via a hand-
rolled PNG/zlib parser (confirming real IHDR colorType/alpha differences, not assumed) and by
directly executing the real `createVision()`/`updateVision()` per-frame logic end-to-end against
the new asset in headless Node. Read `CONCEPT.md`'s "REVISION (v2.15)" section first.

## What changed

1. **`src/assets/tv-404-screen.png` was REPLACED** with a real RGBA render of the TV prop that
   already carries clean, correct alpha transparency around its own silhouette — verified by
   decoding both files' PNG IHDR chunks directly: the OLD file was colorType 2 (opaque RGB, no
   alpha channel at all — the "border" was the photo's own gray plastic bezel plus its own
   background glow/vignette extending to the canvas edges, which is why even the v2.12 two-factor
   luminance+warmth keying hack could reduce but never fully eliminate a faint box); the NEW file
   is colorType 6 (genuine RGBA) and was additionally cropped (via a hand-rolled PNG
   decode/re-encode script) to trim ~26% of empty transparent margin around the TV's own bounding
   box, then downsampled to 512x363 (from 1408x768) to keep the shipped asset's weight comparable
   to the codebase's other real-photo assets (verified: 252KB after resize, down from 1.16MB at
   full resolution — `sips` was the only image tool available in this environment, no
   pngquant/optipng; further lossless compression wasn't attempted).
2. **`vision.js`'s screen-texture loading path is now two DIFFERENT strategies for two DIFFERENT
   asset types**, not one shared keying function forced onto both: `loadAndKeyTexture()` (the
   canvas-based luminance smoothstep keying) is now used ONLY for the silhouette photo (which still
   has no real alpha on disk); a NEW `loadAlphaTexture(url)` (a plain `THREE.TextureLoader` load,
   trusting the file's own alpha channel as-is, no per-pixel processing) is used for the TV-screen
   asset. Both resolve the same `{ texture, aspect }` shape, so `getKeyedAssets()`'s caller-facing
   contract and `updateVision()` are otherwise unchanged. `SCREEN_KEY_BAND`/`SCREEN_WARMTH_BAND`
   and `screenAlphaForPixel()` (the entire v2.12 two-factor keying hack) are REMOVED — no longer
   needed now that the source file's own alpha is correct.
3. **`vision.js`'s `screenGlow` changed from a flat `PlaneGeometry` + `MeshBasicMaterial` (`map:
   null`) to a `THREE.Sprite` sharing `glow-sprite.js`'s shared soft radial-gradient texture** (the
   same primitive every other glow effect in this codebase already uses via `buildGlowOrb`/
   `getSharedGlowTexture`). Root cause this fixes: a flat, untextured, additively-blended plane
   renders as a literal hard-edged rectangle — that flat rectangle, 1.7x the screen's own size, WAS
   a second, independent "box" bug, unrelated to the screen-texture border. Consequences of the
   Sprite conversion (Sprites are always camera-facing by construction): `placeEncounter()` no
   longer copies a quaternion onto `screenGlow` (removed both at initial placement and in the
   jitter-application block in `updateVision()`); the texture-resolve callback now sets
   `screenGlow.scale` instead of disposing/rebuilding a `PlaneGeometry`.
4. **`config.js`'s `VISION_ENCOUNTER.screenWidth` widened 2.0 -> 5.5** — re-verified against the
   real chase-cam distance at the moment an encounter reaches full opacity (~23.2m, per the
   plateau/approachRadius geometry): the old 2.0m width occupied only ~7% of the vertical frame at
   that distance and `CAMERA.fov.traverse` (60deg); 5.5m occupies ~19.5% at that same distance,
   ~32% by the plateau's own inner edge (14m), and remains within reasonable frame-filling bounds
   even at the closest possible pass-by.

## Do not touch / do not regress (carried forward from v2.14, still load-bearing)

Everything in v2.14's "do not touch" list below still applies. Additionally:
- If `src/assets/tv-404-screen.png` is ever replaced again, verify its real alpha channel first
  (decode its PNG IHDR colorType, or just check for visible background artifacts) before assuming
  `loadAlphaTexture()` is still the correct loader for it — a future asset without real alpha would
  need to go back through `loadAndKeyTexture()` with a fresh, verified keying function, not silently
  render with a solid background.
- Any future glow-halo/light-emitting plane added to this codebase should default to
  `glow-sprite.js`'s shared texture (`buildGlowOrb`/`getSharedGlowTexture`), never a flat
  untextured `PlaneGeometry`+`MeshBasicMaterial` — this exact mistake produced a real, user-visible
  "box" bug once already in this same file.
- `screenGlow` is now a `THREE.Sprite`, not a `Mesh` — do not reintroduce quaternion-copying logic
  onto it (it doesn't have a meaningful facing direction to sync; the whole point of a Sprite is
  that it's always camera-facing already).

---

# ARCHITECTURE.md v2.14 — Build Contract Addendum (Return-Phase FOV Velocity-Continuity Fix)

This is an ADDENDUM on top of v2.13's contract below (still fully in effect). Applied via direct
hand-edits, verified by directly executing `director.js`'s real `createDirector()` output and
measuring `state.camera.fov`'s own velocity (central-difference, not assumed) at every return-phase
beat boundary, both before and after the fix. Read `CONCEPT.md`'s "REVISION (v2.14)" section first.

## What changed

1. **`director.js` gained a `zeroVelocityRamp(baseEaseName, rampFraction = 0.15)` helper**
   (module-scope, alongside `fallInBeatDuration`): wraps any named GSAP ease so the returned
   function's own velocity starts at exactly 0 and ramps into the base ease's shape over the
   tween's first `rampFraction` (default 15%) — implemented as `base(t) * rampIn * rampIn`, the
   identical technique `vortex.js`'s `getCameraRigPosition()` return-phase tail already uses for
   its own analogous position-velocity fix (see that function's own `rampIn`/`rampIn * rampIn`
   comment) — this file's fix is the same pattern applied to a different field (FOV) at the same
   two beat boundaries.
2. **Both of `returnTimeline`'s `state.camera.fov` tweens** (the 'approach' beat's widen to
   `CAMERA.fov.approach`, and the 'overflow' beat's settle to `CAMERA.fov.traverse + 2`) now use
   `ease: zeroVelocityRamp('power2.out')` instead of `ease: EASE.overflow` (which is itself
   `'power2.out'` — only these two FOV tweens changed; every other `EASE.overflow`-eased tween in
   this timeline, and `EASE.overflow`'s own definition, are untouched).
3. **Root cause, verified by direct measurement**: a plain `power2.out` restarted at `t=0` for a
   tween has a non-zero derivative at its own start — so a tween chain of two `power2.out` legs
   glued end-to-end at a beat boundary (both legs individually well-behaved) produces a genuine
   instantaneous FOV-velocity discontinuity at the seam: measured at 0 -> +13.6 deg/s at
   `approachStart` and 0 -> -17.1 deg/s at `overflowStart`, both in a single frame-step. Camera
   position/lookAt were checked separately at all three return-phase beat boundaries
   (`approachStart`/`overflowStart`/`irisStart`) via the same central-difference velocity technique
   and confirmed already smooth (largest measured speed delta ~0.007 m/s across a boundary) — this
   was purely an FOV bug, not a position bug, despite reading to the user as "the frame jumps."

## Do not touch / do not regress (carried forward from v2.13, still load-bearing)

Everything in v2.13's "do not touch" list below still applies. Additionally:
- Any FUTURE tween added to `returnTimeline` that starts a beat's motion from a dead stop (i.e. the
  previous beat ended with that field's velocity at or near zero) should be checked for this same
  class of bug — measure the field's own velocity via central difference just before/after the beat
  boundary, don't assume a named ease "already includes" a smooth start just because its curve looks
  gentle over its own full span.
- `zeroVelocityRamp`'s `rampFraction` (0.15) was chosen to match `vortex.js`'s own existing
  `rampIn` fraction for the analogous position fix, for consistency of feel — if retuned, re-verify
  via the same before/after velocity measurement this round used, not by eye.

---

# ARCHITECTURE.md v2.13 — Build Contract Addendum (Typewriter Dialogue Reveal)

This is an ADDENDUM on top of v2.12's contract below (still fully in effect). Applied via direct
hand-edits, verified via GSAP's own measured timeline duration for each typing pace against the
hand-derived `totalRevealSeconds()` formula (exact match confirmed for all five voices, not
assumed). Read `CONCEPT.md`'s "REVISION (v2.13)" section first.

## What changed

1. **`overlay-text.js`'s `MOTION_CHARACTERS` changed shape entirely**: each named voice
   (`settling`/`inviting`/`reassuring`/`wistful`/`anticipatory`) is now
   `{ charIntervalSeconds, charFadeSeconds, ease }` — a typing pace, not a motion profile. The old
   `yPercent`/`rotateX`/`blur`/`duration`/`stagger: { amount }` fields are gone; every reveal tween
   that used to animate those now animates `opacity` alone, staggered via `{ each:
   charIntervalSeconds, from: 'start' }` (strictly left-to-right, one character at a time — a real
   typewriter never reveals characters out of order or several at once).
2. **`totalRevealSeconds(character, charCount)` gained a required `charCount` parameter** and is
   now genuinely LENGTH-DEPENDENT (`(charCount - 1) * charIntervalSeconds + charFadeSeconds`) —
   deliberately reversing the v2.6 fix that made total reveal time length-independent, because a
   real typewriter SHOULD take longer to type a longer line. `resolveTraverseLineHoldSeconds()`
   passes the line's real character count (`TRAVERSE_GUIDE_LINES[index].length`), not an estimate.
   Retuned the pacing constants specifically so this new, longer-for-long-lines floor still stays
   close to (verified: within ~0.3s of) the worst-case remaining-dwell-time ceiling
   `resolveTraverseLineHoldSeconds()` already computes — a naive pace choice measured as exceeding
   that ceiling by 1.6-1.7s for the longest lines, which would have reopened the v2.9 "missing text
   at fast scroll speeds" bug this same function exists to prevent.
3. **`seedCharsForCharacter(chars)` dropped its `character` parameter** — chars now seed to a plain
   `opacity: 0` (no positional/blur offset; a typewriter's characters don't fly in from anywhere).
4. **`buildGuideDialogueLine()` no longer creates the `.guide-dialogue-marker` voice-marker dot.**
   `applyGuideDialogueStyles()`'s corresponding marker-styling block is removed, and the
   `.guide-dialogue-blob` flex row lost its `alignItems: 'baseline'`/`gap` (no longer needed with
   only one child) and gained `justifyContent: 'center'` directly (previously only the
   traverse-line-specific block set this).
5. **`applyGuideDialogueStyles()`'s container gained `textAlign: 'center'`**, and the traverse-line-
   specific block's `textAlign: 'left'` override was changed to `'center'` to match (relevant once
   a line wraps to 2+ lines).

## Do not touch / do not regress (carried forward from v2.12, still load-bearing)

Everything in v2.12's "do not touch" list below still applies. Additionally:
- `resolveTraverseLineHoldSeconds()`'s reveal-floor calculation MUST use the line's REAL character
  count (`TRAVERSE_GUIDE_LINES[index].length`), never an estimate — this floor is now genuinely
  length-dependent, unlike the old `{ amount }`-stagger-based floor, and an estimate could
  silently under- or over-count.
- If `MOTION_CHARACTERS`' `charIntervalSeconds`/`charFadeSeconds` values are retuned again,
  re-verify (via `totalRevealSeconds()` against the real per-line character counts and
  `resolveTraverseLineHoldSeconds()`'s own remaining-dwell-time ceiling) that the reveal floor
  doesn't drift back to exceeding worst-case dwell time by more than roughly the existing ~0.3s
  margin — a wider gap reopens the v2.9 "missing text at fast scroll speeds" bug.
- The `.guide-dialogue-marker` element and its styling are gone; do not reintroduce a marker/bullet
  element in front of dialogue text without revisiting this round's rationale (it read as a stray
  bullet point once the text was centered).

---

# ARCHITECTURE.md v2.12 — Build Contract Addendum (Screen Keying, Jitter, Size, Radius, Chase Distance)

This is an ADDENDUM on top of v2.11's contract below (still fully in effect). Applied via direct
hand-edits, verified against the real shipped `tv-404-screen.png` asset (direct pixel decode via
`sips -s format bmp` + a hand-rolled BMP parser) and via direct headless-Node execution of the real
`createVision()`/`updateVision()` per-frame logic (not just a successful `npm run build` — this
codebase's established discipline, see v2.9's entry below for why build success alone is
insufficient). Read `CONCEPT.md`'s "REVISION (v2.12)" section first.

## What changed

1. **`vision.js`'s screen alpha-key gains a second factor: warmth.** `loadAndKeyTexture()`'s
   callback signature widened from `alphaForLuminance(luminance)` to `alphaForPixel(r, g, b)` so a
   keying function can see full RGB, not just luminance. `screenAlphaForPixel()` now multiplies the
   existing luminance-based factor (`SCREEN_KEY_BAND`, unchanged) by a new warmth-based factor
   (`SCREEN_WARMTH_BAND = { innerEdge: 5, outerEdge: 25 }`, on `r - b`). Root cause this fixes: the
   photo's own gray plastic CRT bezel is achromatic (`r ≈ b`) but dark enough to pass the old
   luminance-only key as "content" — verified directly against the real file that the old key left
   the bezel at ~96% opacity. The two-factor key drops real bezel-like pixels to ~1-5% opacity while
   leaving real warm screen content at ~94-97% and background at exactly 0%, verified against the
   actual decoded pixel data, not assumed. `silhouetteAlphaForPixel()` is unchanged in behavior
   (still luminance-only internally) — only the call signature widened for symmetry.
2. **`config.js`'s `VISION_ENCOUNTER` gains `screenWidth: 2.0`** (was a hardcoded `1.4` literal
   duplicated in two places in `vision.js` — the placeholder geometry at construction and the real
   geometry once the image decodes). Both call sites in `vision.js` now read this one config value.
3. **`config.js`'s `VISION_ENCOUNTER` gains a `screenJitter*` contract**
   (`screenJitterAmplitude: 0.012` meters, `screenJitterRotationDeg: 0.6` degrees,
   `screenJitterSpeedHz: 9`) and **`vision.js` applies a CRT-static jitter to the screen (+ its glow
   halo) every frame**, sampled off `state.traverse.elapsedSeconds` (never `state.clockTime` —
   frozen during the entire traverse per this codebase's established rule) via three independent
   `simplex-noise` `createNoise2D()` channels (x-offset, y-offset, rotation — mirrors `camera.js`'s
   own `noiseA`/`noiseB`/`noiseC` bank/roll pattern: several independent noise channels, not one
   value reused three ways). Applied ON TOP OF a stored per-frame base transform
   (`encounter.screenBasePosition`/`screenBaseQuaternion`/`screenGlowBaseOffset`, set fresh by
   `placeEncounter()` every frame) rather than accumulated onto the mesh's own previous-frame
   transform — critical, since `placeEncounter()` re-asserts placement every frame defensively
   (existing behavior); jittering the mesh's live transform directly would compound/drift across
   frames. Each encounter gets its own `jitterSeed` (random offset into the noise field) so multiple
   screens don't jitter in lockstep.
4. **`config.js`'s `VISION_ENCOUNTER.plateauRadius`/`approachRadius` widened** (10→14, 26→27) —
   verified against the real encounter spacing (`count: 4`, `margin: 0.08`,
   `VORTEX.travelSpan: 260` → ~54.6m between adjacent encounters) that 27m is the safe ceiling
   before two encounters' fade zones start to overlap; do not widen `approachRadius` further without
   either reducing `VISION_ENCOUNTER.count`, tightening `margin`, or re-verifying spacing headroom.
5. **`config.js`'s `CAMERA.chase.distanceBehind` tightened 5 → 3.5.** Every consumer
   (`vortex.js`'s `getCameraRigPosition`, `vision.js`'s look-ahead proximity point) reads this value
   live from config, not a hardcoded literal, so no other file needed a code change. Verified via
   the same camera-local tangent/up-frame geometry `overlay-text.js`'s own v2.3 fix already
   established: at 3.5m the orb sits ~9.1° below the optical axis (was ~5.4° at 5m) — closer and
   more present in frame, still well clear of the dialogue's reserved bottom ~14% of the viewport
   (the v2.3 orb/text overlap bug this same geometry check originally fixed), so this does not
   reopen that bug.

## Do not touch / do not regress (carried forward from v2.11, still load-bearing)

Everything in v2.11's "do not touch" list below still applies. Additionally:
- The screen/glow jitter MUST be applied on top of `encounter.screenBasePosition`/
  `screenBaseQuaternion`/`screenGlowBaseOffset`, never accumulated onto the mesh's own live
  transform from the previous frame — `placeEncounter()` runs every frame and does not distinguish
  "freshly placed" from "already placed," so a jitter applied directly to the live transform would
  compound without bound.
- `SCREEN_WARMTH_BAND` and `SCREEN_KEY_BAND` are AND'd (multiplied) together, not substitutes for
  each other — removing either factor reopens either the bezel-border bug (warmth factor) or the
  white-background-not-keyed-out bug (luminance factor).
- If `VISION_ENCOUNTER.count`, `margin`, or `VORTEX.travelSpan` ever change, re-verify
  `approachRadius` against the real resulting encounter spacing (do not assume the current 27m
  ceiling still holds).
- `CAMERA.chase.distanceBehind` is shared, load-bearing state read by multiple modules (`vortex.js`,
  `vision.js`) and referenced in `overlay-text.js`'s own clearance-fix reasoning — if it changes
  again, re-verify the orb's on-screen angle stays clear of the dialogue's reserved bottom band.

---

# ARCHITECTURE.md v2.11 — Build Contract Addendum (Vision Encounter Energy Orbs)

This is an ADDENDUM on top of v2.10's contract below (still fully in effect). Applied via direct
hand-edits, verified by directly re-executing the real orbit math against the shipped code (motion
smoothness, radius bounds, desynchronization). Read `CONCEPT.md`'s "REVISION (v2.11)" section
first.

## What changed

1. **`config.js`'s `VISION_ENCOUNTER` gains an energy-orb contract**: `energyOrbCount` (4),
   `energyOrbRadius` (1.4m — deliberately inside `surroundRadius`'s 2.6m, so these dedicated orbs
   sit closer than any ambient companion orbs that happen to be surrounding the same encounter),
   `energyOrbHeightSpread`, `energyOrbSpeedHz` (a min/max range for slow, deliberate circling),
   `energyOrbColor`, `energyOrbCoreDiameter`/`energyOrbHaloDiameter`, `energyOrbPeakOpacity`.
   Deliberately a SEPARATE contract from `surroundRadius`/`surroundClusterFraction` (vortex.js's
   ambient companion-orb "surround" behavior) — these are always-present, purpose-built orbs owned
   directly by vision.js, not a population subset that happens to be nearby.
2. **`vision.js`'s `createVision()` builds `VISION_ENCOUNTER.energyOrbCount` glow-sprite orbs per
   encounter** (via `glow-sprite.js`'s `buildGlowOrb()` — the same core+halo additive technique
   every other orb in this codebase uses), stored as `encounter.energyOrbs`. Each orb's starting
   angle is evenly spaced around the orbit; speed, radius scale, orbit direction, and vertical
   offset are each independently randomized once at construction so the small cluster reads as
   several independent orbits, never one rigid ring.
3. **`vision.js`'s `placeEncounter()` now persists `encounter.right`/`encounter.up`** (the local
   frame derived from the real travel-axis tangent at this encounter's position) so the energy-orb
   orbit can be built in the encounter's own actual orientation, not a raw world-axis assumption —
   same discipline vortex.js's companion-orb placement and streak cross-sections already follow
   for the curved travel axis.
4. **`vision.js`'s `updateVision()` advances each energy orb's orbit every frame**, sampled off
   `state.traverse.elapsedSeconds` (real, never-frozen wall-clock time within the traverse phase —
   NOT `state.clockTime`, which this codebase's established discipline warns is frozen for the
   entire traverse). Visibility/opacity ride the SAME `eased` proximity term (the v2.10 plateau
   curve) the silhouette/screen/glow already use, so the energy orbs fade in and out in exact
   lockstep with the rest of the encounter — one held moment, not a separately-timed effect.

## Do not touch / do not regress (carried forward from v2.10, still load-bearing)

Everything in v2.10's "do not touch" list below still applies. Additionally:
- Energy orbs must keep riding the same `eased` term the rest of the encounter's opacity uses — do
  not give them an independent fade timer, or the encounter will stop reading as one coherent
  apparition.
- `encounter.right`/`encounter.up` are now load-bearing for the energy-orb orbit — if
  `placeEncounter()`'s local-frame derivation changes, re-verify the orbit still tracks the
  encounter's actual orientation rather than drifting into a stale or world-axis-relative frame.

---

# ARCHITECTURE.md v2.10 — Build Contract Addendum (Vision Encounter Plateau Fade)

This is an ADDENDUM on top of v2.9's contract below (still fully in effect). Applied via direct
hand-edits, verified by directly simulating the real chase-cam/proximity geometry against the
shipped code and measuring actual seconds-of-legibility at real scroll speeds. Read `CONCEPT.md`'s
"REVISION (v2.10)" section first.

## What changed

1. **`config.js`'s `VISION_ENCOUNTER` gains `plateauRadius` (10m); `approachRadius` widened
   20->26m.** Feedback: "the image fades in/out too fast, the user won't even understand what
   they're seeing." Root cause verified directly: the old opacity curve was a pure inverse-square
   falloff (`(1 - distance/approachRadius)^2 * peakOpacity`) — mathematically, this only reaches
   its own peak for a single instant at distance=0, then falls away immediately. Measured: even at
   `SCROLL.idleDriftDuration` pace, the encounter held above a legible 0.3-0.5 opacity threshold
   for well under 2 seconds.
2. **`vision.js`'s `updateVision()` opacity math rewritten as a plateau curve.** Full peak opacity
   (`eased = 1`) for any distance at or inside `plateauRadius` — a genuine held zone, not a point —
   then smoothstepped down to 0 between `plateauRadius` and `approachRadius` (the outer fade edge,
   meaning unchanged). Still a pure function of the same look-ahead-point-to-anchor distance this
   file already computed (the v2.5/v2.7 proximity-reference-point fix is untouched), so symmetry
   for both scroll directions and per-instance independence are both preserved by construction —
   only the shape of `eased` changed, not what it's a function of. Verified directly: all 4
   encounters now hold at >=0.5 opacity for 1.3-2s at max scroll speed, 3.5-5.3s at idle pace, with
   the widened `approachRadius` (26m) still well inside half the spacing between adjacent
   encounters (27.3m) — confirmed two encounters are never simultaneously visible/fading.

## Do not touch / do not regress (carried forward from v2.9, still load-bearing)

Everything in v2.9's "do not touch" list below still applies. Additionally:
- The plateau shape (item 2) is the fix for "fades too fast" — if `VISION_ENCOUNTER.count` is ever
  increased again, re-verify `approachRadius` still fits inside half the new spacing before
  widening it further, the same way this round's fix was checked against the current count=4
  spacing.

---

# ARCHITECTURE.md v2.9 — Build Contract Addendum (Glow-Sprite Orbs, Wrap-Teleport Fix, Dialogue Reading-Room Fix)

This is an ADDENDUM on top of v2.8's contract below (still fully in effect). v2.9's changes were
applied via direct hand-edits, same as v2.6-v2.8, and independently verified by directly executing
the real per-frame update loops (companion-orb wrap/surround math, dialogue trigger/queue/flush
math) against the shipped code, in a headless Node harness with a minimal canvas shim — not
estimated or eyeballed. Read `CONCEPT.md`'s "REVISION (v2.9)" section first.

## What changed

1. **NEW `src/scene/glow-sprite.js`** — a shared "soft glowing orb" rendering primitive, factored
   out of guide.js's own radial-gradient CanvasTexture technique (core sprite + halo sprite,
   additively blended, sharing one texture). `buildGlowOrb(color, coreDiameter, haloDiameter)` ->
   `{ group, core, halo }`. Deliberately a SIMPLER two-layer stack than the Guide's own 5-layer
   version — companion/seeking orbs must stay visually subordinate to the Guide (non-negotiable:
   "the orb is deliberately the brightest, warmest thing in frame"), and a population this large
   needs to stay cheap.
2. **`vortex.js`'s `makeCompanionOrbs()`/`updateCompanionOrbs()` and `seeking-orbs.js`'s orb
   construction/update rewritten to use `buildGlowOrb()`** instead of solid
   `SphereGeometry`+`MeshBasicMaterial` meshes (feedback: "the portal orbs doesn't have the glow
   effect, they need to represent soft glowing orbs of soul"). `orb.mesh` is now the glow-sprite
   GROUP (position/visibility target, unchanged call sites), with new `orb.core`/`orb.halo` fields
   for opacity/color — companion orbs track a plain `orb.opacity` scalar (not
   `orb.mesh.material.opacity`, which no longer exists) written onto both sprites at the end of the
   per-frame loop, halo scaled by `HALO_OPACITY_SCALE`. Do not reintroduce a single
   `mesh.material` reference for either orb population — always the core/halo pair.
3. **Real bug fix: companion-orb wrap-around recycling had no visibility fade.** Companion orbs
   recycle behind the camera via a modular-wrap technique (`COMPANION_WRAP_SPAN`, identical in
   principle to the streak field's own `STREAK_WRAP_SPAN` wrap) — this ALWAYS produces exactly one
   position discontinuity per orbit by construction, which is fine only if the orb is invisible at
   that exact moment. It never was: opacity was purely a function of `state.beat === 'traverse'`,
   independent of wrap proximity. Verified directly executing the real update loop against a live
   camera sweep: orbs teleported 200-290m at FULL opacity. Fixed with `WRAP_FADE_ZONE` (25m) —
   opacity now smoothsteps to 0 as `|wrappedDist - cameraAxialDistance|` approaches
   `COMPANION_WRAP_SPAN/2`. This fade is gated OFF (via `THREE.MathUtils.lerp(wrapFadeVisibility,
   1, orb.surroundT)`) once an orb has committed to surrounding a vision encounter, since that
   orb's rendered position is then dominated by the encounter's own always-visible anchor, not its
   ambient wrapped position — do not remove this gate, or a correctly-visible surrounding orb will
   incorrectly flicker whenever its own independent ambient tracker happens to wrap.
4. **Real bug fix: the vision-encounter "surround" position blend could still leak a wrap-corrupted
   position even with the anchor-lock from v2.8 in place.** A small lerp weight times an enormous
   (wrap-induced) position jump is still a large absolute jump — verified directly, up to 293m at
   partial blend weights. Fixed by flooring the position-blend weight at `1 - wrapFadeVisibility`
   (`effectiveSurroundEased = Math.max(surroundEased, 1 - wrapFadeVisibility)`) — the blend commits
   fully to the always-safe surround position the instant the ambient side becomes untrustworthy,
   rather than partially trusting a value that just discontinuously jumped.
5. **Real bug fix: dialogue queue could be dropped by continued forward scrolling, not just
   reversal.** `overlay-text.js`'s pending-line-drop-on-rearm (added two rounds ago) triggered on
   `distance >= DIALOGUE_REARM_HYSTERESIS` in EITHER direction — but that hysteresis (0.035 of the
   traverse) clears in ~0.2s at max scroll speed, far faster than the up-to-2.4s window
   `GUIDE_DIALOGUE_MIN_INTERVAL_SECONDS` gives a queued line to survive. Verified directly
   simulating the real trigger/queue/flush logic: ordinary fast-forward scrolling was itself
   clearing the queue before a line could fire — exactly the scenario the queue exists to help.
   Fixed to only drop a pending entry on genuine backward travel
   (`state.vortex?.travelSpeed < -1e-3`), not continued forward progress past the hysteresis
   margin. The crossing-check loop already overwrites a stale pending entry with a fresher one, so
   this can't create an unbounded backlog — at most one line is ever queued.
6. **`config.js`'s `SCROLL.minDuration` raised 6 -> 10.** Separate from item 5's bug: even with the
   drop bug fixed, verified directly that at the OLD 6s floor, the fastest possible traversal was
   physically shorter than the `GUIDE_DIALOGUE_MIN_INTERVAL_SECONDS x 4-lines` minimum reading
   budget (9.6s) — an arithmetic ceiling, not a pacing bug, that no per-line fix could work around.
   10s clears that floor with margin (verified: all 4 lines fire at the new max speed). Every
   consumer of `SCROLL.minDuration` (dwell-time fitting, streak brightness, camera FOV cues)
   derives from this one constant, so this change propagates automatically.
7. **`config.js`'s `VISION_ENCOUNTER.count` reduced 24 -> 4**, and the "ending-only" placement
   question was explicitly considered and declined (see CONCEPT.md's own reasoning) — the
   encounter stays inside the traverse, just far less frequent. Same placement geometry, verified
   to hold up cleanly at this count too (min peak opacity unchanged from the 24-count verification).

## Do not touch / do not regress (carried forward from v2.8, still load-bearing)

Everything in v2.8's "do not touch" list below still applies, MODIFIED as follows:
- Both orb populations' rendering is now `glow-sprite.js`-based — do not reintroduce
  `SphereGeometry`+`MeshBasicMaterial` for either.
- The wrap-fade discipline (item 3) is now load-bearing for BOTH orb populations' recycling
  systems (seeking-orbs.js doesn't wrap, so this is companion-orbs-only, but if any future system
  adds axial wrap-recycling, it needs this same opacity-fade-at-the-seam guarantee — "generous wrap
  span" alone does NOT guarantee invisibility, verified the hard way this round).
- The dialogue min-interval/pending-queue system's drop condition is now direction-gated
  (backward-only) — do not revert to a distance-only drop condition.

---

# ARCHITECTURE.md v2.8 — Build Contract Addendum (Silhouette Alpha-Key Fix, 24-Encounter Repetition, Diverse Orb Colors)

This is an ADDENDUM on top of v2.7's contract below (still fully in effect). v2.8's changes were
applied via direct hand-edits, same as v2.6/v2.7, and independently verified by directly decoding
and sampling the real shipped image files and executing the real curve/chase-cam/companion-orb
math against the shipped code. Read `CONCEPT.md`'s "REVISION (v2.8)" section first.

## What changed

1. **The actual root-cause bug behind "still don't see the silhouette": `vision.js`'s
   `SILHOUETTE_KEY_BAND` was wrong.** v2.7's placement/visibility fix was real and necessary, but
   not sufficient — verified by directly decoding `src/assets/couch-silhouette.jpg` and sampling
   its actual pixel luminance values (not guessed): the figure's own painted body sits at
   luminance ~6-12, but the old band (`innerEdge: 18`) treated anything at or below 18 as
   background, silently keying away ~97% of the figure — only bright rim-light edges survived. The
   band is retuned to `{ innerEdge: 1, outerEdge: 9 }`, verified against the real file to recover
   ~91-98% of the figure's body as visible while the true pure-black background (confirmed: max
   luminance 0 across thousands of sampled background pixels in the real file) stays at exactly
   alpha 0. **Lesson for future image assets in this codebase**: never author an alpha-key band
   from an assumed/typical luminance split — decode the real file and sample it first, the same
   way this fix and the v2.5 band-widening fix before it both had to be corrected after initial
   guesses.
2. **`config.js`'s `VISION_ENCOUNTER` restructured again for much higher repetition.** Feedback:
   "come into the portal repeatedly, clearly, floating, 20-30 times maybe." v2.7's hand-picked
   `axisFractions: [...]` (3 entries) is replaced by `count` (24) + `margin` (0.05), generated the
   same evenly-spaced way seeking-orbs.js's own `encounterParamPositions()` already works — verified
   directly against the real curve/chase-cam geometry that this even-spacing approach generalizes
   cleanly across ALL 24 generated positions (minimum peak opacity 0.78 of the 0.92 ceiling, zero
   weak spots), not just a few hand-picked "easy" spots. `axisOffset`/`approachRadius` retuned
   further (2.2->1.4m / 18->20m) for stronger visibility headroom at this higher density.
3. **`vision.js`'s `encounterFractions()` rewritten** to generate positions from `count`/`margin`
   instead of reading a fixed array — same function name/role, new generation shape (mirrors
   seeking-orbs.js's `encounterParamPositions()` almost exactly). `createVision`/`updateVision`'s
   per-instance placement/fade loop is UNCHANGED in shape, it now just iterates more instances.
4. **`vortex.js`'s companion-orb "surround" behavior redesigned from fixed-anchor-assignment to
   nearest-anchor-lookup**, because the old v2.7 approach (permanently assign each orb to ONE of a
   small, fixed number of encounters) breaks down once `VISION_ENCOUNTER.count` is large enough
   (20+) that several encounters' influence windows can be active at once, and adjacent encounters
   sit closer together (~9.75m apart) than a single influence window's approach distance. Replaced
   with `nearestVisionSurround(progress)` — same "find the nearest of many anchors every frame"
   shape `camera.js`'s own `nearestRegionStrength()` already established for its own many-anchor
   regional-framing system (re-derive from shared config, don't import across files — same
   convention). A single new per-orb `surroundsVisions` boolean (stable subset,
   `COMPANION_ORBS.visionSurroundFraction`) replaces the old per-orb `surroundGroup` index-into-a-
   fixed-array field entirely — do not reintroduce a fixed anchor-count assignment scheme here if
   this is touched again, it does not scale with `VISION_ENCOUNTER.count`.
5. **`config.js`'s `COMPANION_ORBS` gains diverse per-orb hues** (feedback: "give them similar
   glow, vary it out, give them diverse range of colors to feel mesmerizing... their own journey of
   exploration"). `COMPANION_ORBS.color` stops being every orb's literal color and becomes
   documentary/historical only — `vortex.js`'s `makeCompanionOrbs()` now assigns each orb its own
   HSL hue via golden-angle spacing (137.50776°, chosen over random hues specifically to avoid two
   adjacent orbs landing on near-identical colors by chance), with shared
   `colorSaturation`/`colorLightness` so every orb still reads as one consistent "glow" family. Each
   orb stores this as `orb.baseColor` — `updateCompanionOrbs()`'s per-frame color blend
   (convergence/ambient-flare warming toward the overflow palette) now blends FROM `orb.baseColor`,
   not a shared flat color constant. Do not reintroduce a single shared `_companionColor` instance
   if touched again — every orb needs its own distinct `THREE.Color`.

## Do not touch / do not regress (carried forward from v2.7, still load-bearing)

Everything in v2.7's "do not touch" list below still applies, MODIFIED as follows:
- The `PATH.waypointOffsets` curvature-verification discipline still applies exactly as written.
- `vision.js`'s shared keyed-texture cache still applies — still one decode/key per source image
  regardless of instance count (now 24, was 3).
- The v2.7 note about `orb.surroundGroup`/disjoint-index-range assignment is SUPERSEDED — that
  field no longer exists (see item 4 above). The new invariant to preserve: `nearestVisionSurround`
  must stay a per-frame, stateless lookup (no caching a "current" anchor across frames) so it
  naturally handles the user scrolling backward/forward past many closely-spaced encounters.
- New: any alpha-keyed image asset added to this codebase must have its key band tuned against
  values sampled from the REAL decoded file (see item 1's lesson), not assumed from how the image
  "should" look.

---

# ARCHITECTURE.md v2.7 — Build Contract Addendum (Vision Visibility + Repetition, Curve Retune, Companion-Orb Surround)

This is an ADDENDUM on top of v2.6's contract below (still fully in effect). v2.7's changes were
applied via direct hand-edits, same as v2.6, and independently verified by directly executing the
real chase-cam/curve/companion-orb math against the shipped code. Read `CONCEPT.md`'s "REVISION
(v2.7)" section first.

## What changed

1. **`config.js`'s `PATH.waypointOffsets`'s `atFraction: 0.5` entry retuned** from
   `{ lateralX: 2.0, verticalY: -2.5 }` to `{ lateralX: -3.75, verticalY: 1.5 }` — a real curvature
   spike (verified directly against the built `CatmullRomCurve3`, ~7x sharper than comparable
   stretches) sat almost exactly here, and was the mechanical cause of the Guiding Orb's jitter
   report (guide.js's `lastTangent` damping can't fully absorb a turn this sharp). This is a pure
   SHAPE change — still one continuous unicursal curve, no branches, guaranteed resolution
   untouched. Do not revert this waypoint back toward its old values without re-verifying curvature
   in that stretch first.
2. **`config.js`'s `VISION_ENCOUNTER` restructured for repetition + visibility.** `axisFraction`
   (singular) is now `axisFractions: [0.14, 0.58, 0.72]` (plural) — three repeated instances,
   each independently chosen to sit in a low-curvature stretch of the (now-retuned) path AND clear
   of every other traverse moment's own trigger fractions. `axisOffset` tightened 4.5→2.2m,
   `approachRadius` widened 16→18m — verified by direct simulation of the real chase-cam geometry
   to roughly double peak achievable opacity (measuring proximity from the camera's forward
   look-ahead point, exactly as v2.5 already established — that reference-point fix is unchanged,
   only the placement geometry around it moved). New `surroundRadius`/`surroundClusterFraction`
   fields feed the companion-orb behavior in item 3.
3. **`src/scene/vision.js` rewritten for multiple encounters.** `createVision`/`updateVision`'s
   public signature is UNCHANGED (main.js's call sites need no edits) — internally, the module now
   builds `VISION_ENCOUNTER.axisFractions.length` independent silhouette+screen+glow triplets
   (alternating side per instance, mirroring seeking-orbs.js/glyphs.js's own alternate-side
   convention), sharing the ONE keyed-texture-pair cache across all instances (same two source
   photographs, decoded/keyed once regardless of instance count — do not re-introduce a per-
   instance decode). Each instance's proximity/opacity math is per-instance and independent; the
   alpha-keying bands and reference-point-projection logic from v2.5/v2.6 are otherwise untouched.
4. **`src/scene/vortex.js`'s companion orbs gain a "surround" behavior** (feedback: "make the other
   orbs lively as well, and make them surround the silhouette"), mirroring the existing sighting-
   cluster mechanism exactly in shape: a THIRD deterministic per-orb group assignment
   (`orb.surroundGroup`, drawn from a distinct middle slice of the population index range so it
   doesn't reuse the same orbs already doing sighting/ambient-flare duty), a `surroundStrengthAt()`
   continuous cosine-falloff function keyed to `VISION_ENCOUNTER.axisFractions` (same shape as
   `sightingStrengthAt`), and a per-orb smoothed `orb.surroundT` readout (same damping shape as
   `convergeT`) that blends the orb's position from its normal travel-axis-relative spot toward a
   slow, continuous orbit around the nearest active vision encounter's own world anchor
   (`getVisionAnchors()`, re-deriving vision.js's own placement math from shared config rather than
   importing vision.js directly — same "no cross-module import, re-derive from shared config"
   convention `camera.js`'s `REGION_AXIAL_DISTANCES` already established for seeking-orbs.js's
   placement). Surrounding orbs also get a brightness lift (`orb.surroundT * 0.6`, same shape as
   the existing `sightingPull * 0.5` lift) so they read as visibly drawn to the moment, not just
   incidentally repositioned. Fully continuous/reversible — verify this if touched again, the same
   way convergeT/sightingPull already are.
5. **`overlay-text.js`'s `TRAVERSE_LINE_HOLD_SECONDS`** raised 3.4→4.2 (feedback: "increase the
   time a little bit for how long the texts stays") — the leisurely ceiling only;
   `resolveTraverseLineHoldSeconds()`'s speed-aware compression for fast scrollers is untouched.

## Do not touch / do not regress (carried forward from v2.6, still load-bearing)

Everything in v2.6's "do not touch" list below still applies. Additionally, as of v2.7:
- `PATH.waypointOffsets`'s curvature profile — if any waypoint is retuned again, re-verify max
  curvature (tangent rotation per unit t) in the affected stretch directly against the built curve,
  the same way this round's fix was verified. A curvature spike anywhere on this path can
  independently break both the chase-cam's tangent-following (jitter) and any lateral-offset
  scenery placed near it (visibility), as this round's investigation found.
- `vision.js`'s shared keyed-texture cache — do not decode/key the same two source images more
  than once regardless of how many `axisFractions` entries exist.
- `vortex.js`'s `orb.surroundGroup`/`orb.surroundT` disjoint-index-range assignment — if
  `VISION_ENCOUNTER.surroundClusterFraction` or the sighting/ambient-event cluster fractions change
  enough to risk overlapping index ranges, re-verify the three assignment pools stay
  non-conflicting (same risk class the sighting/ambient-event split already manages).

---

# ARCHITECTURE.md v2.6 — Build Contract Addendum (Restrained Kinetic Type, Reveal-Completion Pause Floor, Seeking Orbs)

This is an ADDENDUM on top of v2.5's contract below (still fully in effect for everything it
covers — the vision encounter, the fall-in rollback, the dialogue min-interval floor). v2.6's
changes were applied via direct hand-edits (not the usual agent-swarm build process — the v2.5
swarm's second advisor-review pass hit a hard account budget cap mid-run) and independently
verified by directly executing the relevant math against the real shipped code, not merely
reading it. Read `CONCEPT.md`'s "REVISION (v2.6)" section first.

## What changed

1. **`src/ui/overlay-text.js`'s `MOTION_CHARACTERS`** — every character's `yPercent`/`rotateX`
   amplitude cut ~4-6x (feedback: "make the text appearance cinematic kinetic typography art,
   make the motions subtle"). A `blur` field was added to each character and threaded through
   every reveal tween in the file (title card, both opening lines, all four traverse lines) as an
   additional `filter: 'blur(Npx)' -> 'blur(0px)'` animation, extending a technique `#return-copy`
   already used in isolation to the whole file for one consistent kinetic-type register.
   `BREATHE_AMPLITUDE_Y_PERCENT`/`BREATHE_AMPLITUDE_ROTATE` were scaled down alongside the reveal
   amplitudes so the idle "still alive" breathing sway stays proportionally subtle relative to the
   now-much-smaller settled pose, not proportionally louder than it used to be.
2. **Stagger shape switched from `{ each }` to `{ amount }`** — a real, measured bug, not just a
   tuning pass: `{ each }` is a PER-CHARACTER time increment, so a line's true total reveal time
   (verified by directly constructing the exact GSAP timeline and reading its own `.duration()`,
   not assumed from the `duration` field alone) scaled with character COUNT. The longest lines
   were measured taking ~5.5s to finish revealing against a declared `duration` of 1.3s.
   `{ amount }` fixes this at the root — total reveal time becomes `duration + stagger.amount`, a
   constant independent of copy length. A new helper, `totalRevealSeconds(character)`, computes
   this exactly; it was verified against GSAP's own real timeline duration for every line's real
   character count and matched exactly (see the verification math in this round's session — not
   re-derived from scratch, computed and confirmed once, correctly, here).
3. **`config.js`'s new `GUIDE_DIALOGUE_MIN_PAUSE_AFTER_REVEAL_SECONDS` (0.6)** —
   `resolveTraverseLineHoldSeconds()`'s floor changed from `character.duration` (an
   underestimate, per point 2) to `totalRevealSeconds(character) +
   GUIDE_DIALOGUE_MIN_PAUSE_AFTER_REVEAL_SECONDS`. This is what actually delivers "fully render,
   pause for a tiny amount, then start disappearing" as a guarantee rather than an accident of
   scroll speed — verified via direct computation that every traverse line's worst-case
   (fastest-possible) hold still reserves the full 0.6s pause after its own real reveal completes,
   for all four lines' real character/stagger values.
4. **`src/scene/glyphs.js` deleted, replaced by NEW `src/scene/seeking-orbs.js`** (feedback:
   "random numbers showing up... hanging orbs that are trying to find themselves, properly
   choreograph this"). `config.js`'s `GLYPHS` constant is replaced by `SEEKING_ORBS`
   (`count`/`proximityResonanceRadius` carried over unchanged in meaning; new fields:
   `clusterSize`, `color`, `wanderRadius`, `wanderSpeedHz`, `settledScaleBoost`,
   `settledBrightnessBoost`). `state.glyphs` is renamed to `state.seekingOrbs` (same two fields,
   `nearestProximity`/`allResolved`, same meaning). The module's PLACEMENT/DWELL-FITTING
   architecture is deliberately unchanged from `glyphs.js` — same `travelAxisAccessor` contract,
   same `encounterParamPositions()` spacing (renamed from `glyphParamPositions()`, identical
   shape), same worst-case-dwell-time derivation, same one-shot `resolved` guard and Act III
   `igniteOverflow()` kick on the last cluster's resolve. Only the VISUAL content changed: instead
   of a troika-text mesh scrambling into "404", each encounter is now `SEEKING_ORBS.clusterSize`
   small `MeshBasicMaterial` sphere sprites with individually-randomized wander phase/rate: a
   continuous per-orb sine/cosine wander (amplitude tied to `1 - settleEased`) and an irregular
   two-frequency flicker while distant, smoothstep-easing into a calm, synced pulse-breathe and a
   brightness/scale boost as the camera approaches, holding at fully-settled permanently once the
   one-shot resolve fires (verified: the settle curve is a genuine smoothstep, monotonic
   non-decreasing, correctly clamped at 1.0 past its own fitted duration — computed and confirmed
   directly, not assumed). Zero `THREE.Light` objects, same lighting discipline as every other
   module. `lighting.js`'s boost-registry slots were renamed `glyph-N` → `seeking-orb-N`;
   `camera.js`'s regional-framing anchor system and `vortex.js`'s regional density/warmth system
   both re-derive their own anchor positions from `SEEKING_ORBS.count`/`encounterParamPositions`'s
   spacing shape (renamed from the `GLYPHS`-keyed versions, identical values/behavior) — grepped
   the whole `src/` tree to confirm no dangling `GLYPHS`/`glyphs.js` reference remains outside of
   accurate historical/rename comments.

## Do not touch / do not regress (carried forward from v2.5, still load-bearing)

Everything in v2.5's "do not touch" list below still applies. Additionally, as of v2.6:
- `totalRevealSeconds()`'s role as the single source of truth for a motion character's true total
  reveal time — do not reintroduce a per-file re-derivation of this from `character.duration`
  alone (the exact bug this round fixed).
- `SEEKING_ORBS`'s placement/dwell-fitting math (`encounterParamPositions`, worst-case dwell
  derivation) — reused verbatim from the retired `GLYPHS`/`glyphs.js` system on purpose; if this
  needs to change again, verify `camera.js`/`vortex.js`'s independent re-derivations of the same
  anchor positions are updated in lockstep (same module-boundary risk `GLYPHS` always carried).

---

# ARCHITECTURE.md v2.5 — Build Contract (Real-Image Vision Encounter, Fall-In Rollback, Dialogue Pacing Floor)

This supersedes v2.4's module contracts wherever they conflict. Read `CONCEPT.md`'s "REVISION
(v2.5)" section first (near the top) — it's the authoritative creative summary. Read
`src/config.js` and `src/state.js` in full before writing anything: `config.js` already has
`VISION_ENCOUNTER` and `GUIDE_DIALOGUE_MIN_INTERVAL_SECONDS` added, `ROOM_SCENE` removed, and
`BEATS.drop`/`freefall`/`catch`/`traverse.start` reverted to their pre-v2.4 values. Do not modify
`config.js`/`state.js`.

Two real reference images now ship in the repo, already alpha-appropriate:
- `src/assets/couch-silhouette.jpg` — a figure slumped on a couch, painterly/smoke-edged, pure
  black (`rgb(0,0,0)`) background, 1408×768, no alpha channel (plain JPEG).
- `src/assets/tv-404-screen.png` — a glowing amber CRT reading "ERROR 404 / PAGE NOT FOUND / YOU
  ARE LOST", pure white (`rgb(255,255,255)`) background, 269×256, no alpha channel (plain RGB PNG).

Both need alpha keyed out at runtime (silhouette: near-black → transparent; screen: near-white →
transparent) before use as a THREE.js sprite/plane texture — neither file carries real alpha on
disk. This is a one-time canvas operation per image (draw to an offscreen `<canvas>`, walk
`ImageData`, write computed alpha, read back as a texture) — the same "generate a texture via
canvas at runtime" pattern `guide.js` already uses for the orb's own radial-gradient glow texture,
just keying a loaded photo instead of painting a gradient. Do this once per image at module-load
time, cache the resulting `THREE.CanvasTexture`, never re-key per frame.

## The three things this round changes

1. **The room/TV cold-open moves out of the fall-in entirely and becomes a real-image encounter
   inside the traverse.** `VISION_ENCOUNTER` (config.js) is the placement contract: a fixed point
   along the traverse's travel axis (`axisFraction`, `axisOffset`, `side`, `heightOffset` — same
   shape as `glyphs.js`'s own `AXIS_OFFSET`/`GLYPH_HEIGHT_OFFSET` placement, reuse that pattern,
   don't reinvent it), visible only within `approachRadius` of the camera and faded in/out by
   proximity (mirrors `glyphs.js`'s `updateGlyphs()` distance-to-proximity curve — reuse the shape
   of that math, not the same object). This is a ONE-OFF encounter (unlike `glyphs.js`'s
   `GLYPHS.count` repeated placements) — a single silhouette-on-couch plane and a single TV-screen
   plane, both using the two real image files above, both keyed to real alpha per this file's
   header note. The TV plane additionally gets a soft, unlit, additive glow plane behind it in
   `VISION_ENCOUNTER.screenGlowColor` (same "glow is unlit material color, never a `THREE.Light`"
   discipline every other module in this codebase already follows — do not add a light source
   here either). Never fully opaque even at closest approach (`VISION_ENCOUNTER.peakOpacity`) — an
   apparition glimpsed in passing, not solid set-dressing the camera could clip through.
2. **The Guiding Orb's ignition-from-the-screen mechanic (v2.4) is reverted.** Since there's no
   screen at the fall-in's start anymore, `guide.js`'s `ignitePoint()`/`igniteT` blend-from-
   `ROOM_SCENE.screenColor` logic has nothing left to reference — remove it, restoring the orb to
   simply being fully present, at its own resting color/scale/opacity, from the very first frame of
   `drop` (this is a real revert to the orb's v2.1-era introduction, not a new design). The
   light-based radial-falloff rendering (`GUIDE_LIGHT_FALLOFF`, v2.4) and the chase-cam
   follow-damping (`CAMERA.chase.followDampingSeconds`, v2.4) are UNRELATED to ignition and must be
   preserved exactly as-is — this is a narrow, surgical removal of one specific mechanic, not a
   broader rollback of guide.js's other v2.4 work.
3. **A wall-clock floor between traverse dialogue line reveals** (`GUIDE_DIALOGUE_MIN_INTERVAL_
   SECONDS`, config.js) — fixes "the texts move too fast... give them room to appear when a user
   is scrolling through fast." This is layered on top of (not a replacement for) v2.3's existing
   `resolveTraverseLineHoldSeconds()` hold-fitting — that function still governs how long an
   already-showing line stays up; this new floor governs the MINIMUM real time between one line
   *starting* to reveal and the next one starting, regardless of how many `GUIDE_DIALOGUE_AXIS_
   FRACTIONS` triggers get crossed in that window at high scroll speed. A trigger crossed before
   the floor elapses is not dropped and not fired immediately — it becomes the one pending line,
   fired the instant the floor is satisfied; a still-newer trigger crossed while one is already
   pending simply replaces it (never stack/queue more than one).

## Non-negotiables (unchanged, still binding)

Guaranteed resolution, single hard color pivot, control as instrument, scroll paces
bidirectionally never redirects, symmetric easing, delayed skip affordance, resonance not
response, guide hands off to light once.

## Do not touch / do not regress (carried forward, still load-bearing)

- `src/scene/postfx.js`'s `EffectPass` grouping — `GodRaysEffect`/`DepthOfFieldEffect` excluded
  from every pass.
- `main.js`'s `antialias: false`, `postfx.js`'s `stencilBuffer: true`.
- `overlay-text.js`'s iris-mask `clip-path` mapping.
- The camera-to-light floor-distance gap (arc-length, since v2.3's curve migration).
- The traverse→turn position-AND-lookAt crossfade in `main.js`, and the Turn→Approach
  zero-derivative ramp-in in `vortex.js`.
- `getFallInAxialPosition`'s fixed output-vector-aliasing bug — if you touch this function or
  anything like it (a shared `out` parameter pattern), use DISTINCT scratch vectors for
  intermediate reads vs. the final written-to output.
- `state.vortex.travelSpeed`'s single-source-of-truth status (`vortex.js`'s
  `resolveTravelArcLength`, consumed identically by `postfx.js`/`glyphs.js`/`overlay-text.js`) —
  do not reintroduce a local per-module recomputation of travel speed.
- `CAMERA.chase.followDampingSeconds`'s exponential smoothing in `vortex.js`'s
  `chaseCamFromOrb()` — untouched by this round, must keep composing correctly with the
  traverse→turn crossfade.
- `GUIDE_LIGHT_FALLOFF`'s sprite-stack rendering in `guide.js` — untouched by this round (only the
  ignition-from-screen BLEND is being removed, not the light-falloff visual itself).
- `SPEECH_BLOB`'s dialogue framing in `overlay-text.js` — untouched by this round; the new
  min-interval floor governs WHEN a line fires, not how it's visually framed once it does.
- `resolveConvergeBlend()`'s continuous, reversible companion-orb convergence in `vortex.js` —
  untouched by this round.
- `resolveTraverseLineHoldSeconds()`'s speed/distance-fitted hold duration in `overlay-text.js` —
  untouched by this round; the new min-interval floor is an ADDITIONAL gate before a line is ever
  allowed to fire, not a replacement for how long it stays up once it does.
- **The module-boundary bug class**: this round removes a subsystem (`ROOM_SCENE`/room-scene) that
  three other files (`guide.js`, `vortex.js`, and nothing else — confirmed by grep) referenced.
  When removing it, grep every consumer across the whole `src/` tree, don't assume the removal is
  contained to the file that originally introduced it.

## Modules to change

### `src/scene/vortex.js` (remove room-scene subsystem)

Delete `makeRoomScene()`, `updateRoomScene()`, `getRoomScreenPosition()`, `ROOM_LOCAL_FRAME`,
`resolveRoomLocalOffset()`, `ROOM_SCREEN_LOCAL_OFFSET`/`ROOM_COUCH_LOCAL_OFFSET`/
`ROOM_FIGURE_LOCAL_OFFSET`, the `_roomFallEntry`/`_roomFallStart`/`_roomScreenLookTarget` scratch
vectors, and every reference to them — including the `ROOM_SCENE` import, the `roomScene` field on
`createVortex()`'s returned handle, and the `updateRoomScene(handle.roomScene, state)` call inside
`updateVortex()`. Nothing else in this file changes — the streak field, companion orbs (including
their convergence fix), and the travel-axis/chase-cam machinery are all unrelated and must be left
exactly as they are. `getFallInAxialPosition`/`getFallInAxialTangent`/`localFrameFromTangent`
(used by the room-scene code for its local-frame offsets) are used elsewhere in this file too — do
NOT delete those, only the room-scene-specific consumers of them.

### `src/scene/guide.js` (revert ignition, keep light-falloff + follow-damping)

Remove `ignitePoint()`, `_ignitePointCached`, `_igniteColor`, `_screenColor`, `IGNITE_MIN_SCALE`,
`IGNITE_MIN_OPACITY_MULT`, the `igniteT`/`rawT` computation block, and the `ROOM_SCENE`/
`getRoomScreenPosition` imports. The orb should render at its full resting scale/opacity/color
(per `GUIDE_LIGHT_FALLOFF`'s existing sprite-stack rendering, unchanged) from the very first frame
of `drop` — i.e. wherever `igniteT` used to gate scale/opacity/color blending, simply use the
resting values outright (scale 1, `GUIDE.color`, full opacity) with no blend. Do not touch the
bob/weave/pulse-glow motion logic, the chase-cam follow-damping (which isn't owned by this file
anyway — confirm it's still solely in `vortex.js`), or any of the beat-'turn'-triggered
dissolve-to-overflow-light logic near the end of the traverse — none of that is related to
ignition.

### `src/scene/vision.js` (NEW — the in-tunnel vision encounter)

Build this as a new file mirroring `glyphs.js`'s exact shape: `createVision(scene,
travelAxisAccessor)` returns a handle; `updateVision(handle, state, camera, dt)` runs every frame.
Same accessor contract as `glyphs.js` (a zero-arg function returning a `THREE.Curve`-like object
over the traverse's own `[0,1]`), same avoid-circular-import reasoning, same "call the accessor
every frame, tolerate it returning null before vortex.js is ready" pattern.

- **Image loading + alpha-keying**: load `src/assets/couch-silhouette.jpg` and
  `src/assets/tv-404-screen.png` (standard Vite `import url from '...'` + `THREE.TextureLoader`,
  or draw the loaded `HTMLImageElement` to an offscreen canvas directly — either works, canvas is
  needed regardless for the keying step). Key the silhouette's near-black background to alpha 0
  (something like: alpha = smoothstep of luminance across a small threshold band near 0, so the
  dark background clears while the image's own very-dark interior shading is preserved — avoid a
  hard binary cutoff, it will look jagged) and the screen's near-white background to alpha 0 the
  same way (alpha = smoothstep of DISTANCE FROM WHITE, or equivalently `1 - luminance` thresholded
  near white — same softness requirement). Build a `THREE.CanvasTexture` from each keyed canvas
  once at module scope or on first `createVision()` call; do not re-key every frame.
- **Placement**: once, at creation (this is a single fixed encounter, not per-frame-repositioned
  scenery) — resolve the axis point at `VISION_ENCOUNTER.axisFraction`, offset laterally by
  `axisOffset * side` and vertically by `heightOffset` (same `right = tangent × up` construction
  `glyphs.js`'s `placeGlyphsAlongAxis()` already uses), face the planes back toward the oncoming
  camera direction (mirrors `glyphs.js`'s `lookAt(point + tangent * -N)` pattern). Silhouette plane
  and screen plane both sit at this one location, screen positioned so it reads as something the
  silhouette is facing/watching (matches the reference images' own composition — the figure faces
  away from camera, toward the screen).
- **Fade**: proximity-driven exactly like `glyphs.js`'s brightening curve, but driving OPACITY
  (toward `VISION_ENCOUNTER.peakOpacity`, never 1.0 — see CONCEPT.md's "apparition, not solid
  scenery" framing) rather than a brightness boost — continuous function of distance, never a
  discrete toggle, fully symmetric for both scroll directions (a user scrolling backward past this
  point should see the exact same fade curve in reverse, no direction-dependent asymmetry — same
  bidirectional-continuity discipline every other traverse system in this codebase already
  follows). The TV's glow plane (`VISION_ENCOUNTER.screenGlowColor`/`screenGlowPeakOpacity`) fades
  in lockstep with the screen image itself, using the same additive/unlit-material approach the
  removed room-scene used for its own glow halo (a plane roughly matching the screen's aspect,
  positioned just behind it, `depthWrite: false`).
- Zero `THREE.Light` objects anywhere in this file — same lighting lesson every other module in
  this codebase already follows (glow is the material's own unlit color, never illumination from
  an external light source).

### `src/main.js` (wiring only)

Add `createVision`/`updateVision` imports and call sites, mirroring `createGlyphs`/`updateGlyphs`'s
exact existing wiring exactly (same `getVortexAxis` accessor passed by reference, same place in
the fixed update order — alongside `updateGlyphs()`, since both are travel-axis-relative traverse
scenery with no ordering dependency on each other). No other structural change.

### `src/ui/overlay-text.js` (dialogue min-interval floor)

Add a module-local `secondsSinceLastReveal` accumulator (incremented by `dt` every call to
`updateOverlayText()`, reset to `0` inside `fireTraverseLine()` whenever a line actually fires) and
a `pendingTraverseLineIndex` slot (`null` when nothing is queued). In the existing crossing-check
loop (the `GUIDE_DIALOGUE_AXIS_FRACTIONS.forEach(...)` block that currently calls `fireTraverseLine(i)`
directly once a trigger condition is met): if `secondsSinceLastReveal >=
GUIDE_DIALOGUE_MIN_INTERVAL_SECONDS`, fire immediately as today; otherwise set
`pendingTraverseLineIndex = i` instead of firing (overwriting whatever was previously pending, per
CONCEPT.md's "only the most recent moment is ever queued" rule) and do NOT call `fireTraverseLine`
this frame. Separately, once per frame (outside that loop), if `pendingTraverseLineIndex !== null`
and the floor has now elapsed, fire it and clear the pending slot. Do not touch
`resolveTraverseLineHoldSeconds()`, the motion-character reveal tweens, the breathing loop, the
re-arm/hysteresis logic, or the opening two lines' (non-traverse) reveal logic — this is additive
gating in front of the existing trigger path only. Verify by direct trace (not just reading the
code) that a rapid sequence of simulated crossings at various `dt` steps produces reveals no closer
together than `GUIDE_DIALOGUE_MIN_INTERVAL_SECONDS` apart, and that the LAST trigger crossed before
each gap always wins (not the first).

## Build order note for agents

`config.js`'s new constants already exist (hand-authored, do not modify) — read `VISION_ENCOUNTER`
and `GUIDE_DIALOGUE_MIN_INTERVAL_SECONDS` in full before touching the files above. The
`vortex.js`/`guide.js` removals, the new `vision.js` file, and the `overlay-text.js` pacing fix are
all independent of each other and can be built in parallel — none of them share a data dependency
this round (unlike v2.4's camera-rig handoff, which touched two files' shared contract at once).
Integration is its own step after all modules are adapted, exactly like every previous round —
integration's specific job this round is confirming the room-scene removal left no dangling
references anywhere in `src/` (grep the whole tree, not just the files listed above) and that
`vision.js` is wired into `main.js` correctly.
