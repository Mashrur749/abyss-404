// src/director.js
//
// The master choreography. This is the ONLY module that turns the authored
// BEATS/EASE/COLOR/PULSE constants (config.js) and the beat-sheet in CONCEPT.md
// Section 7 into concrete tweened values written onto `state`. Every other
// module reads those state fields and applies them to the Three.js objects /
// DOM elements it owns — director.js never touches a THREE.* object or the
// DOM itself, per the ARCHITECTURE.md contract.
//
// Fields owned (write) here: state.camera.fov, state.camera.rollDeg,
// state.camera.dutchTiltDeg, state.color.mixT, state.bloom.intensity,
// state.bloom.godRays, state.pulse.bpm, state.overlay.*, state.iris.radius.
//
// (camera.rollDeg/dutchTiltDeg aren't named in the file's "owns" list in the
// prose of ARCHITECTURE.md's director.js section, but they are BEATS/EASE-
// driven camera values exactly like fov, they live under state.camera, and
// camera.js's own docs explicitly say it only *reads* state.camera.rollDeg/
// dutchTiltDeg and applies it to camera.rotation.z — something has to author
// them on the beat timeline, and director.js is the only module chartered to
// turn beat-sheet timing into eased state values. See "Deviations" in the
// handoff notes for the reasoning.)

import gsap from 'gsap';
import {
  BEATS,
  TOTAL_DURATION,
  CAMERA,
  COLOR,
  PULSE,
  EASE,
} from './config.js';
import { getTurnCurveParams, labTToClockTime } from './scene/corridor.js';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

// THREE.Color isn't imported here (director.js must not touch Three.js
// objects), so color mixing for anything other than state.color.mixT itself
// is left to the modules that own the renderable objects (lighting.js,
// corridor.js fog, postfx.js). Director only ever writes the single scalar
// mixT — the 0..1 knob CONCEPT.md Section 4 calls "the only hard color pivot."

function beatDuration(name) {
  const b = BEATS[name];
  return b.end - b.start;
}

// ---------------------------------------------------------------------------
// createDirector(state)
// ---------------------------------------------------------------------------

export function createDirector(state) {
  // A paused root timeline driven by absolute time (seconds) so it can be
  // scrubbed directly against state.clockTime (main.js's authoritative
  // clock) as well as played normally. We never let this timeline run its
  // own independent RAF-driven playback that could drift from state.clockTime;
  // main.js ticks it by calling timeline.time(state.clockTime) or by letting
  // gsap.ticker drive it while clockTime is derived from the same wall clock —
  // either way, .seek()/.time() below keeps it authoritative and scrubbable
  // (required for skipToEnd() and for scrub-perfect sync with updateBeat()).
  const timeline = gsap.timeline({
    paused: true,
    defaults: { overwrite: 'auto' },
  });

  // Initial state at t=0 ("0. Trigger" — cut straight to void, no control,
  // near-black, minimal falloff). Setting these explicitly (rather than
  // relying on state.js's own initial values) means the timeline is the
  // single source of truth for every value it owns, even at rest.
  timeline.set(state.camera, { fov: CAMERA.fov.fall, rollDeg: 0, dutchTiltDeg: 0 }, 0);
  timeline.set(state.color, { mixT: 0 }, 0);
  timeline.set(state.bloom, { intensity: 0.3, godRays: 0 }, 0);
  timeline.set(state.pulse, { bpm: PULSE.bpmStart }, 0);
  timeline.set(state.overlay, { skipOpacity: 0, titleOpacity: 0, returnCopyOpacity: 0 }, 0);
  timeline.set(state.iris, { radius: 1 }, 0);
  timeline.set(state.rackFocus, { amount: 0, focusDistance: 0.9 }, 0);
  timeline.set(state.turnCue, { amount: 0 }, 0);

  // -------------------------------------------------------------------------
  // Beat 1 — The Drop (0 -> 1s)
  // Sharp ease-in fall, fisheye FOV already maxed (holds at fall FOV — the
  // "taking over" feeling is the roll/shake, not a FOV ramp, per Concept
  // Section 2/3: FOV stays wide/fisheye through the whole fall until "catch").
  // 2-4 deg uncommanded roll kicks in immediately and hard (EASE.drop =
  // power4.in), front-loaded intensity per the kinetic lens.
  // -------------------------------------------------------------------------
  timeline.to(
    state.camera,
    {
      rollDeg: CAMERA.rollDegrees.max,
      duration: beatDuration('drop'),
      ease: EASE.drop,
    },
    BEATS.drop.start
  );
  // Title card / skip affordance fade targets: overlay-text.js owns the
  // actual DOM tween, but per the contract director.js writes the canonical
  // opacity value into state so any module can read a single source of truth
  // for "is the title supposed to be visible yet."
  timeline.to(
    state.overlay,
    { titleOpacity: 1, duration: beatDuration('drop'), ease: EASE.drop },
    BEATS.drop.start
  );

  // -------------------------------------------------------------------------
  // Beat 2 — Freefall (1 -> 4s)
  // Sustained fall, decaying shake — roll oscillates back down toward the
  // "min" band rather than growing further (decaying intensity, not decaying
  // to zero, so the tumble still reads as "real" per Section 2's imperfection
  // note). First faint bioluminescent hint appears far below: a whisper of
  // bloom.intensity above its resting 0.3 floor.
  // -------------------------------------------------------------------------
  timeline.to(
    state.camera,
    {
      rollDeg: CAMERA.rollDegrees.min,
      duration: beatDuration('freefall'),
      ease: EASE.labyrinth, // sine.inOut: gentle decay of the shake, not another sharp curve
    },
    BEATS.freefall.start
  );
  timeline.to(
    state.bloom,
    {
      intensity: 0.45,
      duration: beatDuration('freefall'),
      ease: 'sine.inOut',
    },
    BEATS.freefall.start
  );

  // -------------------------------------------------------------------------
  // Beat 3 — The Catch (4 -> 5.5s)
  // FOV narrows 100 -> 60 as fall becomes walk; this recalibration is itself
  // the "exhale" (Section 2). Roll/tilt settle fully to 0 (control returns).
  // First proper wall-glow ignites: bloom steps up to its Act II resting
  // level and the pulse begins at its Act II starting bpm.
  // -------------------------------------------------------------------------
  timeline.to(
    state.camera,
    {
      fov: CAMERA.fov.catchEnd,
      rollDeg: 0,
      dutchTiltDeg: 0,
      duration: beatDuration('catch'),
      ease: EASE.overflow, // power2.out: a decelerating settle, the "exhale"
    },
    BEATS.catch.start
  );
  timeline.to(
    state.bloom,
    {
      intensity: 0.55,
      duration: beatDuration('catch'),
      ease: 'sine.out',
    },
    BEATS.catch.start
  );
  timeline.set(state.pulse, { bpm: PULSE.bpmStart }, BEATS.catch.start);

  // -------------------------------------------------------------------------
  // Beat 4 — The Labyrinth (5.5 -> 25s)
  // The trance, and the longest beat by design. FOV rests at CAMERA.fov.corridor
  // for the whole act (camera.js layers walk-bob/micro-drift on top of this
  // resting value — director.js only sets the resting target). The pulse
  // decelerates 70bpm -> 50bpm across the *entire* act on EASE.labyrinth
  // (long, gentle, sine.inOut) — this is the literal biofeedback illusion
  // from Concept Section 4. Occasional Dutch-tilt beats (1-2 deg, held then
  // corrected) are layered as a handful of short sub-tweens scattered through
  // the act, per "texture, not a repeated gimmick." Bloom/color hold steady —
  // no color pivot happens until "turn", per the single-hard-pivot rule.
  // -------------------------------------------------------------------------
  timeline.to(
    state.camera,
    {
      fov: CAMERA.fov.corridor,
      duration: beatDuration('catch') > 0 ? 0.01 : 0, // resting target is already ~reached by catch's tween; this just guarantees exact value at labyrinth start
    },
    BEATS.labyrinth.start
  );

  timeline.to(
    state.pulse,
    {
      bpm: PULSE.bpmEnd,
      duration: beatDuration('labyrinth'),
      ease: EASE.labyrinth,
    },
    BEATS.labyrinth.start
  );

  // Title card recedes shortly after the trance begins (CONCEPT.md's beat sheet only stages the
  // title card at beat 0-1 "Trigger"/"Drop" — the Act I "loss of ground" message shouldn't
  // linger through the surrender/trance of Act II or the wordless generosity of Act III).
  // overlay-text.js drives the actual DOM fade on this same beat/threshold; this keeps state's
  // canonical titleOpacity value in lockstep with it per the module's own contract.
  timeline.to(
    state.overlay,
    { titleOpacity: 0, duration: beatDuration('labyrinth') * 0.06, ease: 'power1.out' },
    BEATS.labyrinth.start + beatDuration('labyrinth') * 0.08
  );

  // Scattered Dutch-tilt "held beats" through Act II — telegraphed, brief, corrected. Rather
  // than arbitrary fixed-time fractions (which would land at moments unrelated to where the path
  // actually turns), these are derived from corridor.js's real TURN_PLAN geometry via
  // getTurnCurveParams(), so the tilt begins a beat *before* the camera reaches each turn and
  // corrects just after — CONCEPT.md Section 3's "turns are telegraphed before they happen ...
  // no motion should surprise the inner ear" requirement, applied to the one motion cue
  // (dutch-tilt) that already existed but wasn't synced to the path. Not every turn gets a tilt
  // (Section 2: "as texture, not a repeated gimmick") — every third turn is picked, spaced enough
  // to read as occasional rather than constant.
  const labSpan = beatDuration('labyrinth'); // used below for rack-focus's plain clock-fraction placement
  const turnParams = getTurnCurveParams(); // spline-local t in [0,1] for each real turn
  const TELEGRAPH_LEAD_SECONDS = 1.6; // tilt begins this long before the camera reaches the turn
  const turnCueMoments = turnParams.filter((_, i) => i % 3 === 0);
  turnCueMoments.forEach((turnT, i) => {
    // Map the turn's spline-local position to a global clockTime using corridor.js's own
    // labTToClockTime() — Act II is constant-pace for most of its span but bleeds velocity down
    // near the Turn boundary (so the camera doesn't snap-decelerate at the labyrinth->turn cut),
    // so this must match that same curve exactly rather than assuming linearity, or cues near the
    // tail would fire out of sync with where the camera actually is.
    const turnClockTime = labTToClockTime(turnT);
    const tiltStart = Math.max(
      BEATS.labyrinth.start,
      turnClockTime - TELEGRAPH_LEAD_SECONDS
    );
    const tiltSign = i % 2 === 0 ? 1 : -1;
    const tiltHoldDuration = 2.4; // "held for a few seconds" per Concept Section 2
    const tiltAmount = tiltSign * CAMERA.dutchTiltDegrees.max;

    timeline.to(
      state.camera,
      { dutchTiltDeg: tiltAmount, duration: TELEGRAPH_LEAD_SECONDS, ease: EASE.labyrinth },
      tiltStart
    );
    timeline.to(
      state.camera,
      { dutchTiltDeg: 0, duration: 1.4, ease: EASE.labyrinth },
      tiltStart + TELEGRAPH_LEAD_SECONDS + tiltHoldDuration
    );
  });

  // Turn-cue "light telegraph": a light/glyph cue a few meters ahead of a turn, per Concept
  // Section 3's explicit mechanism ("a light cue or wall-glyph a few meters ahead"). Authored
  // here as state.turnCue.amount (0..1) so lighting.js can brighten the nearest wall-seam accent
  // ahead of every real turn — not just the ones that also get a dutch-tilt — giving *every*
  // turn an anticipatory cue even though only some also get the tilt texture.
  turnParams.forEach((turnT) => {
    // Same shared labTToClockTime() mapping used for the dutch-tilt cues above, so every turn's
    // light-telegraph fires in sync with the camera regardless of where it falls in Act II's
    // constant-pace-then-decelerate curve.
    const turnClockTime = labTToClockTime(turnT);
    const cueStart = Math.max(BEATS.labyrinth.start, turnClockTime - TELEGRAPH_LEAD_SECONDS);
    timeline.to(
      state.turnCue,
      { amount: 1, duration: TELEGRAPH_LEAD_SECONDS * 0.7, ease: EASE.labyrinth },
      cueStart
    );
    timeline.to(
      state.turnCue,
      { amount: 0, duration: 1.0, ease: EASE.labyrinth },
      turnClockTime
    );
  });

  // Rack-focus moments (Concept Section 2: "foreground wall detail sharp, corridor-ahead soft,
  // then reverse — draws the eye forward without forcing camera motion"). Two moments through
  // the trance, placed away from the turn-cue/dutch-tilt beats so the eye isn't given two
  // simultaneous cues to parse. state.rackFocus.amount drives postfx.js's DepthOfFieldEffect
  // bokeh scale; focusDistance sweeps from a near plane (foreground sharp) to a far plane
  // (corridor-ahead sharp) and back, so the blur itself is the thing that "reverses," not just
  // the on/off amount. Values are WORLD UNITS (meters), matching postprocessing's
  // DepthOfFieldEffect contract (focusDistance defaults to 3.0 world units, not a normalized
  // 0..1 camera-space fraction) — 0.9m sits just past the corridor's near wall detail, 9m sits
  // well down the corridor-ahead within the fog band (fogNear/fogFar = 4/40).
  const rackFocusMoments = [0.3, 0.6]; // fractions through Act II, offset from turnCueMoments, each
                                        // fully resolves (~6.8s) before BEATS.turn.start
  rackFocusMoments.forEach((frac) => {
    const startTime = BEATS.labyrinth.start + labSpan * frac;
    const holdEach = 1.6;

    timeline.fromTo(
      state.rackFocus,
      { amount: 0, focusDistance: 0.9 },
      { amount: 1, focusDistance: 0.9, duration: 1.1, ease: EASE.labyrinth },
      startTime
    );
    // Hold sharp-foreground/soft-corridor, then rack across to the far plane (reverse).
    timeline.to(
      state.rackFocus,
      { focusDistance: 9, duration: 1.3, ease: EASE.labyrinth },
      startTime + 1.1 + holdEach
    );
    timeline.to(
      state.rackFocus,
      { amount: 0, duration: 1.2, ease: EASE.labyrinth },
      startTime + 1.1 + holdEach + 1.3 + holdEach
    );
  });

  // -------------------------------------------------------------------------
  // Beat 5 — The Turn (25 -> 28s)
  // A held beat: camera slows almost to stop (camera/corridor modules own the
  // actual deceleration of motion along the spline — director.js's job here
  // is only the color foreshadow). "Warmest color shift begins subtly" ->
  // mixT eases from 0 toward a small non-zero value, the first hint of the
  // single hard pivot to come. Bloom ticks up almost imperceptibly.
  // -------------------------------------------------------------------------
  timeline.to(
    state.color,
    {
      mixT: 0.12,
      duration: beatDuration('turn'),
      ease: EASE.labyrinth,
    },
    BEATS.turn.start
  );
  timeline.to(
    state.bloom,
    {
      intensity: 0.65,
      duration: beatDuration('turn'),
      ease: 'sine.in',
    },
    BEATS.turn.start
  );

  // -------------------------------------------------------------------------
  // Beat 6 — The Approach (28 -> 33s)
  // Ease-out deceleration begins (EASE.overflow = power2.out) on FOV, which
  // cheats wider (60 -> 70) so the light's growth feels accelerating even as
  // camera movement decelerates — the "mismatch" Concept Section 3 explicitly
  // calls out. Color finishes its pivot in full swing (mixT 0.12 -> ~0.75).
  // Bloom/godRays grow on an *accelerating* curve (power3.in) deliberately
  // opposed to the camera's decelerating ease — same mismatch, applied to
  // light instead of geometry.
  // -------------------------------------------------------------------------
  timeline.to(
    state.camera,
    {
      fov: CAMERA.fov.approach,
      duration: beatDuration('approach'),
      ease: EASE.overflow,
    },
    BEATS.approach.start
  );
  timeline.to(
    state.color,
    {
      mixT: 0.75,
      duration: beatDuration('approach'),
      ease: EASE.overflow,
    },
    BEATS.approach.start
  );
  timeline.to(
    state.bloom,
    {
      intensity: 1.1,
      godRays: 0.6,
      duration: beatDuration('approach'),
      ease: 'power3.in', // accelerating growth of light, opposing the camera's decelerating ease
    },
    BEATS.approach.start
  );

  // -------------------------------------------------------------------------
  // Beat 7 — The Overflow (33 -> 36s)
  // Near-stop, light fills frame, volumetric spill. Full warm whiteout,
  // deliberate overexposure. mixT completes the pivot to 1 (labyrinthBase/
  // Accent -> overflowEnd, the single hard color turn of the whole piece).
  // Bloom/godRays peak past "comfortable" (bloom > 1) for the overexposed
  // feeling Concept Section 4 explicitly wants ("too bright," walking out of
  // a cinema into daylight). FOV settles back down slightly from its
  // "approach" cheat as the camera comes to rest.
  // -------------------------------------------------------------------------
  timeline.to(
    state.color,
    {
      mixT: 1,
      duration: beatDuration('overflow') * 0.6,
      ease: 'power1.in',
    },
    BEATS.overflow.start
  );
  timeline.to(
    state.bloom,
    {
      intensity: 1.6,
      godRays: 1,
      duration: beatDuration('overflow'),
      ease: EASE.overflow,
    },
    BEATS.overflow.start
  );
  timeline.to(
    state.camera,
    {
      fov: CAMERA.fov.corridor + 2, // settles near-resting, not all the way back — a near-stop, not a full reset
      duration: beatDuration('overflow'),
      ease: EASE.overflow,
    },
    BEATS.overflow.start
  );

  // -------------------------------------------------------------------------
  // Beat 8 — The Iris (36 -> 37s)
  // Soft iris-style reveal. Cross-dissolve hold ~500ms before the radius
  // actually starts closing, so the vestibular system gets a moment to
  // "land" (Concept Section 3) before the iris wipes to the homepage. Return
  // copy fades in as the iris opens onto the "world," title card recedes
  // (overlay-text.js's own beat==='iris' branch already handles the DOM
  // cross-fade of the title; director.js keeps the canonical opacity values
  // in state in lockstep so both sources of truth agree).
  // -------------------------------------------------------------------------
  const irisSpan = beatDuration('iris');
  const holdDuration = Math.min(0.5, irisSpan * 0.5); // ~500ms cross-dissolve hold per Concept Section 3
  timeline.set(state.overlay, { titleOpacity: 0 }, BEATS.iris.start);
  timeline.to(
    state.overlay,
    { returnCopyOpacity: 1, duration: irisSpan - holdDuration, ease: 'sine.out' },
    BEATS.iris.start
  );
  timeline.to(
    state.overlay,
    { skipOpacity: 0, duration: 0.3, ease: 'sine.out' },
    BEATS.iris.start
  );
  timeline.to(
    state.iris,
    {
      radius: 0,
      duration: irisSpan - holdDuration,
      ease: EASE.overflow,
    },
    BEATS.iris.start + holdDuration
  );

  // Total timeline length matches the authored 37s runtime exactly.
  timeline.totalDuration(TOTAL_DURATION);

  // ---------------------------------------------------------------------------
  // skipToEnd(): fast-forwards to the "iris" beat's start per the contract
  // ("fast-forwards the GSAP timeline to the iris beat"), then lets the
  // existing iris tweens (already scheduled above) play out normally rather
  // than snapping straight to the fully-closed/finished frame — this
  // preserves the ~500ms cross-dissolve hold and iris-close animation for
  // returning/impatient visitors instead of hard-cutting them to a blank
  // page, which would read as a bug, not a transition.
  //
  // The timeline stays paused/scrub-driven (main.js syncs it every frame via
  // timeline.time(state.clockTime), matching state.clockTime — the single
  // authoritative clock per ARCHITECTURE.md) rather than switching into
  // autonomous GSAP playback here, so a post-skip frame tick from main.js
  // can't fight this call by re-seeking the timeline back to the real
  // elapsed time. Jumping state.clockTime itself is explicitly main.js's
  // job, not this module's (director.js only owns tweened `state` values,
  // never the clock) — so this seeks the timeline's own playhead and trusts
  // main.js to advance state.clockTime forward from BEATS.iris.start on
  // subsequent frames.
  // -------------------------------------------------------------------------
  function skipToEnd() {
    timeline.time(BEATS.iris.start);
  }

  return {
    timeline,
    skipToEnd,
  };
}
