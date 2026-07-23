# ARCHITECTURE.md — Build Contract

This is the interface contract for building `CONCEPT.md` end to end. It exists so multiple
agents can build separate modules in parallel without colliding. Every module reads shared
timing/color/motion constants from `src/config.js` and communicates through the single mutable
`state` object in `src/state.js` — no module holds a direct reference to another module's
internal Three.js objects. `src/director.js` (GSAP master timeline) is the only thing that
writes high-level eased values into `state`; every other module reads `state` and applies it
to the objects it owns.

Stack: vanilla JS ES modules, Vite as a dev-server/bundler only (no app framework). Three.js,
GSAP (+SplitText, +ScrambleTextPlugin), troika-three-text, postprocessing (pmndrs), simplex-noise,
Tone.js. All already declared in `package.json`.

## Files already in place (do not redefine these values elsewhere)
- `src/config.js` — BEATS, CAMERA, CORRIDOR, COLOR, PULSE, RIPPLE, GLYPHS, EASE, NON_NEGOTIABLES
- `src/state.js` — the shared `state` object + `updateBeat()`
- `index.html` — canvas `#scene`, overlay DOM (`#title-card`, `#skip-button`, `#return-copy`), `#iris-mask`
- `package.json` — dependencies

## Modules to build (one per file, own your file only)

### `src/scene/camera.js`
Exports `createCamera()` → returns a `THREE.PerspectiveCamera`, and `updateCamera(camera, state, dt)`.
Applies `state.camera.fov`, `state.camera.rollDeg`, `state.camera.dutchTiltDeg` to the camera each
frame (fov directly; roll/tilt as camera.rotation.z in radians). Also owns the Act II walk-bob
(sine wave driven by `CAMERA.walkStepsPerSecond`) and the simplex-noise-driven micro-drift/sway
described in CONCEPT.md Section 3 — use `simplex-noise` here, sampled by `state.clockTime`, small
amplitude, only active during the `labyrinth` beat (check `state.beat`). Does NOT set camera
position along the path — that's `corridor.js`'s job (it owns the path spline and moves the
camera rig along it). camera.js only owns *orientation/FOV perturbation* on top of that position.

### `src/scene/corridor.js`
Exports `createCorridor(scene)` → builds the labyrinth as a single fixed unicursal path (a
`THREE.CatmullRomCurve3` or similar spline with turns) using `CORRIDOR.segmentPoolSize` modular
wall/floor/ceiling segments (`CORRIDOR.segmentLength` each) instanced via `THREE.InstancedMesh`
and recombined/repeated along the spline so it reads as endless (CONCEPT.md Section 2/3). Also
exports `getCameraRigPosition(t)` where `t` in `[0,1]` maps to progress along the *entire*
37-second timeline (Act I fall happens in open void above/before the corridor starts, Act II
walks the spline, Act III approaches the light at the spline's end) — main.js calls this each
frame with `state.clockTime / TOTAL_DURATION` and applies the returned `{position, lookAt}` to
the camera rig. Must guarantee zero branching — one continuous path, per the labyrinth-not-maze
non-negotiable in config.js. Apply `THREE.Fog` using `CORRIDOR.fogNear`/`fogFar` and `COLOR`
values (interpolate fog color using `state.color.mixT`).

### `src/scene/lighting.js`
Exports `createLighting(scene)` and `updateLighting(state, dt)`. Owns all light sources: sparse
wall-seam emissive glow points (bioluminescent accents, CONCEPT.md Section 4), ambient/hemisphere
light for base visibility. Colors interpolate between `COLOR.labyrinthBase`/`labyrinthAccent` and
`COLOR.overflowEnd` using `state.color.mixT` (THREE.Color.lerpColors). Pulse the glow intensity
using `state.pulse.bpm` (convert bpm to a sine wave frequency: `bpm/60` Hz). This is the *only*
module that owns glow/emissive light objects — glyphs.js and interaction.js read `state` to
influence brightness but must not create their own separate light sources; they call an exported
`setAccentBoost(id, amount)` helper from this module if they need localized brightening (glyph
proximity, ripple trail), so all light math stays centralized and bloom-consistent.

### `src/scene/glyphs.js`
Exports `createGlyphs(scene, corridorCurve)` → places `GLYPHS.count` embedded "404" text meshes
using `troika-three-text` along the corridor spline (call into corridor.js's exported curve, do
not duplicate path logic), and `updateGlyphs(state, camera, dt)`. Each frame, compute distance
from camera to each glyph; when within `GLYPHS.proximityResonanceRadius`, brighten the glyph and
call `lighting.js`'s `setAccentBoost()`, syncing pulse rate toward `state.pulse.bpm` per CONCEPT.md
Section 5 ("Proximity resonance"). Write the closest glyph's normalized proximity (0 near, 1 far)
into `state.glyphs.nearestProximity` so other modules (e.g. audio) can react. Also use GSAP's
`ScrambleTextPlugin` so each glyph's text visibly resolves from scrambled characters into "404"
as the camera approaches (CONCEPT.md Section 6) — trigger this tween once per glyph, not looping.

### `src/scene/interaction.js`
Exports `initInteraction()` (attaches pointermove/deviceorientation listeners) and
`updateInteraction(state, dt)`. Owns `state.pointer` (normalized x/y, idleSeconds) and
`state.ripple` (x, y, strength — decays toward 0 using `RIPPLE.fadeDurationSeconds`, per the
"resonance not response" mechanic in CONCEPT.md Section 5). Only active/read during the
`labyrinth` beat — main.js/director.js gates when this visibly affects anything, but this module
should always safely track input regardless of beat. If idle (`state.pointer.idleSeconds >
RIPPLE.idleMirrorDelaySeconds`), do NOT force pulse changes directly — instead expose
`state.pointer.idleSeconds` for `lighting.js`/`director.js` to read and slow the pulse further
(idle-mirroring, Section 5). This module must never alter `state.beat`, camera position, or FOV —
input here drives ripple/idle signals only, never navigation, per the labyrinth non-negotiable.

### `src/scene/postfx.js`
Exports `createPostFX(renderer, scene, camera)` → returns an `EffectComposer` (from
`postprocessing`, NOT Three's example composer) configured with Bloom, a subtle Vignette, Film
Grain, and God Rays (light-shaft volumetric pass anchored to the Act III light source — CONCEPT.md
Section 4/6). Exports `updatePostFX(composer, state, dt)` to drive bloom intensity from
`state.bloom.intensity` and god-rays weight from `state.bloom.godRays` (both written by
director.js across Acts II→III). Chromatic aberration should be very subtle and only present
during Act I (`state.beat === 'drop' | 'freefall'`) to reinforce the vertigo, not present later —
read `state.beat` to gate it. main.js calls `composer.render()` instead of `renderer.render()`
once this exists.

### `src/audio/audio.js`
Exports `initAudio()` (must be called from a user-gesture handler — browsers block autoplay
audio; wire this to the first pointerdown/keydown/touchstart after page load, buffering silently
until then) and `updateAudio(state, dt)`. Uses Tone.js to build: (1) a sub-bass riser with falling
pitch-bend during `drop`/`freefall` beats, (2) a decelerating pulse tone tracking
`state.pulse.bpm` during `labyrinth`, (3) a warm swell during `approach`/`overflow`. Tempo-lock
using Tone.Transport scheduled against `state.clockTime`, not a separate independent clock, so
audio can never drift from the visual timeline. Keep a master volume node so main.js can expose
a mute toggle later if needed — do not hard-code volume changes elsewhere.

### `src/ui/overlay-text.js`
Exports `initOverlayText()` and `updateOverlayText(state, dt)`. Owns the DOM elements
`#title-card`, `#skip-button`, `#return-copy`, `#iris-mask` (already in `index.html`). Uses GSAP
`SplitText` to stagger-reveal the title card at beat `trigger`/`drop` and the return copy at
`iris`. The skip button fades in only after `SKIP_AFFORDANCE_DELAY` seconds
(`state.clockTime`), styled unobtrusively (see `src/overlay.css`, to be authored alongside). On
click, sets `state.skipRequested = true` — main.js/director.js is responsible for reading that
flag and fast-forwarding the GSAP timeline to the `iris` beat's start, it is NOT this module's job
to manipulate `state.clockTime` directly. `#iris-mask` is a full-viewport radial-gradient div;
animate its `clip-path` circle radius using `state.iris.radius` (1 = fully open, 0 = closed) to
realize the iris-transition beat.

### `src/overlay.css`
Plain CSS for `#overlay`, `#title-card`, `#skip-button`, `#return-copy`, `#iris-mask`,
`#scene` (fixed fullscreen canvas, z-index below overlay). Typography should feel cinematic
(generous letter-spacing, low-opacity-by-default, serif or refined geometric sans — pick one and
stay consistent with the "calm trance" tone from CONCEPT.md, avoid anything that reads as
default-system-UI). No animation logic here — all motion comes from GSAP in overlay-text.js;
this file is static presentation only.

### `src/director.js`
Exports `createDirector(state)` → builds and returns a single GSAP timeline (or timeline
sequence) that is the *only* place `BEATS`/`EASE`/`COLOR`/`PULSE` constants get turned into
tweened values written onto `state` (`state.camera.fov`, `state.color.mixT`, `state.bloom.*`,
`state.pulse.bpm`, `state.overlay.*`, `state.iris.radius`). This module owns pacing/easing
choices from CONCEPT.md Sections 2-4 and the beat-sheet table — it does not touch Three.js
objects or DOM directly, only `state`. Must expose `director.skipToEnd()` so main.js can call it
when `state.skipRequested` becomes true (fast-forwards the GSAP timeline to the `iris` beat).

### `src/main.js`
Entry point. Creates `THREE.WebGLRenderer` attached to `#scene`, calls each module's `create*`/
`init*` once, then runs a single `requestAnimationFrame` loop that: advances `state.clockTime`
by `dt`, calls `updateBeat()`, calls `director` timeline tick (GSAP runs its own RAF internally —
main.js just needs `gsap.ticker` wired or a manual `timeline.time(state.clockTime)` sync,
whichever director.js's exports call for), then calls every module's `update*(state, dt)` in a
fixed order: interaction → director-driven state already set → camera → corridor → lighting →
glyphs → postfx → audio → overlay-text, then `composer.render()`. Watches `state.skipRequested`
and calls `director.skipToEnd()` once. This file should stay thin — orchestration only, no
beat-specific logic of its own (that all belongs in director.js and config.js).

## Non-negotiables every module must respect (from CONCEPT.md, encoded in `config.js`)
1. Unicursal path only — corridor.js must never branch.
2. Single hard color pivot (labyrinth → overflow) — no other module should independently shift `COLOR`.
3. Control is an instrument — interaction.js must stay inert (no navigation influence) at all times.
4. Symmetric easing — director.js uses `EASE.drop` / `EASE.labyrinth` / `EASE.overflow` exactly as named, not ad hoc curves.
5. Skip affordance invisible until `SKIP_AFFORDANCE_DELAY` — overlay-text.js enforces this, no earlier.
6. Resonance, not response — interaction.js and glyphs.js effects must always decay back to baseline and must never be required to progress.

## Build order / dependency notes for agents
`config.js` and `state.js` exist already — read them first. `corridor.js` should be built before
`camera.js`/`glyphs.js` conceptually (they consume its curve), but since real Three.js objects
aren't shared until `main.js` wires everything together, each module can be authored independently
against this contract and only integrated at the end. The **integration pass** (wiring `main.js`,
resolving any interface mismatches) should happen as its own step after all modules exist.
