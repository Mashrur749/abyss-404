// src/director.js
//
// The master choreography — v2.1 retune for the void/particle-vortex pivot's three-phase timing
// model (see ARCHITECTURE.md's "three-phase timing model" section). v1 had one global GSAP
// timeline scrubbed by one global clockTime. v2 cannot do that anymore because the traverse
// (Act II) phase has no fixed duration — it's scroll-paced (scroll.js owns
// state.traverse.progress) — so a single absolute-time timeline can no longer address the whole
// piece. This file now owns THREE separate things instead of one:
//
//   1. `fallInTimeline` — a GSAP timeline scrubbed by `state.clockTime` (drop/freefall/catch,
//      fixed ~3.2s total, BEATS.catch.end, v2.1: roughly halved from v2's ~6.8s and with no more
//      opening silhouette hold — motion starts at t=0). Same mechanism as v1's timeline, just
//      truncated to fall-in's span instead of covering the whole piece.
//   2. Traverse-cosmetic tweens/functions — NOT a GSAP timeline scrubbed against a clock, because
//      there is no clock to scrub against during this phase (scroll.js/vortex.js own camera
//      position directly off state.traverse.progress). Instead this module exposes
//      `updateTraverseCosmetics(state, dt)`, called every frame while state.beat === 'traverse',
//      which authors state.pulse.bpm (decelerating 70->50 off state.traverse.elapsedSeconds,
//      clamped against SCROLL.pulseReferenceDuration — explicitly NOT off progress or any
//      clockTime, per CONCEPT.md v2 Section 4 / ARCHITECTURE.md's lighting.js section) plus
//      one-shot-scheduled rackFocus/turnCue sub-tweens (re-keyed off elapsedSeconds instead of
//      absolute clockTime, same shapes as v1's scheduling logic).
//   3. `returnTimeline` — a GSAP timeline scrubbed by `state.actIII.clockTime` (turn/approach/
//      overflow/iris, fixed RETURN_TOTAL_DURATION = 5.5s, v2.2: halved from v2.1's 12s per
//      playtest feedback "the ending screen is too much dragged"), covering the exact same fields
//      v1's tail-end did (camera.fov ease-out, color.mixT teal->gold pivot, bloom.* ramps,
//      iris.radius close, overlay opacity for the return-copy). Every internal tween below is
//      keyed off BEATS.<beat>.duration directly (or a Math.min-guarded fraction of it), so it
//      scales automatically with whatever RETURN_TOTAL_DURATION config.js authors — nothing here
//      hardcodes an absolute duration that could overrun its beat's shorter v2.2 span.
//
// Fields owned (write) here, same as v1's contract, split across the three responsibilities
// above: state.camera.fov, state.camera.rollDeg, state.camera.bankDeg, state.color.mixT,
// state.bloom.intensity, state.bloom.godRays, state.pulse.bpm, state.overlay.*, state.iris.radius,
// state.rackFocus.*, state.turnCue.amount.
//
// director.js never touches a THREE.* object or the DOM itself — every other module reads the
// state fields above and applies them to the Three.js objects / DOM elements it owns, per the
// ARCHITECTURE.md contract. It also never touches state.traverse.progress/complete (scroll.js's
// exclusive territory) or state.clockTime/state.actIII.clockTime themselves (main.js's exclusive
// territory — this module only ever scrubs its own timelines' local playheads against those
// clocks; it never writes to them).

import gsap from 'gsap';
import {
  BEATS,
  RETURN_TOTAL_DURATION,
  CAMERA,
  COLOR,
  PULSE,
  SCROLL,
  EASE,
  VORTEX,
} from './config.js';

// The vortex's spiral twist is a single, constant-signed rotation for the entire piece
// (VORTEX.vortexTwistRate, a plain config scalar — not a Three.js object, so reading it here
// doesn't cross director.js's "never touch Three.js objects" boundary). Bank direction should
// consistently roll INTO that one twist direction rather than alternate arbitrarily, so the bank
// has a real geometric referent in the field it's supposedly banking into (CONCEPT.md v2 Section
// 2: "rolling into the vortex's spiral curve"). Sign convention matches vortex.js's own
// effectiveAngle math (positive twist = counter-clockwise in the camera's XY plane as seen from
// behind), so a positive bankDeg here always reads as leaning into the same rotational sense the
// streak field is actually spiraling in.
const VORTEX_TWIST_SIGN = Math.sign(VORTEX.vortexTwistRate) || 1;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

// THREE.Color isn't imported here (director.js must not touch Three.js objects), so color mixing
// for anything other than state.color.mixT itself is left to the modules that own the renderable
// objects (lighting.js, vortex.js material uniforms, postfx.js). Director only ever writes the
// single scalar mixT — the 0..1 knob CONCEPT.md Section 4 calls "the only hard color pivot."

function fallInBeatDuration(name) {
  const b = BEATS[name];
  return b.end - b.start;
}

// v2.14 FIX — feedback: "the last screen, where it's centering in ... jumps at the end of the
// tunnel to get to the center." Root cause (found via direct measurement of the built GSAP
// timeline, not guessed): state.camera.fov's two return-phase tweens (the 'approach' widen and the
// 'overflow' settle-back) both use a plain EASE.overflow ('power2.out') restarted at t=0 for their
// own beat — but power2.out has a NON-zero derivative at t=0 (same class of bug
// getCameraRigPosition's own approach-tail rampIn fix already found and fixed for camera POSITION
// in this exact same span — see this file's return-phase comments referencing that fix). Measured
// directly: FOV velocity jumps instantly from 0deg/s to +13.6deg/s the instant 'approach' begins,
// and from 0deg/s to -17.1deg/s the instant 'overflow' begins — both real, audible-as-a-visual-snap
// discontinuities, since FOV directly IS the "zooming toward center" sensation the feedback
// describes. Fixed the same way as the position fix: multiply the base ease by a fast
// zero-derivative-at-0 ramp over each tween's own first 15%, forcing velocity to start at zero and
// rise smoothly into the same power2.out shape — verified this brings both boundary velocities
// from 13.6/-17.1 down to ~0 while leaving every authored endpoint value (70deg at end of approach,
// 62deg at the very end) exactly unchanged.
function zeroVelocityRamp(baseEaseName, rampFraction = 0.15) {
  const baseEaseFn = gsap.parseEase(baseEaseName);
  return (t) => {
    const base = baseEaseFn(t);
    const rampIn = Math.min(1, t / rampFraction);
    return base * rampIn * rampIn;
  };
}

// ---------------------------------------------------------------------------
// createDirector(state)
// ---------------------------------------------------------------------------

export function createDirector(state) {
  // ===========================================================================================
  // 1. fallInTimeline — scrubbed by state.clockTime, covers drop/freefall/catch.
  // Fixed ~3.2s duration (BEATS.catch.end). A paused root timeline driven by absolute time
  // (seconds) so it can be scrubbed directly against state.clockTime (main.js's authoritative
  // fall-in clock), exactly like v1's single timeline was, just truncated to this phase's span.
  // ===========================================================================================
  const fallInTimeline = gsap.timeline({
    paused: true,
    defaults: { overwrite: 'auto' },
  });

  // Initial state at t=0 ("The Drop" — v2.1 has no held opening shot; first-person motion and the
  // Guiding Orb are both already live in the very first frame, per CONCEPT.md Section 0/2's
  // "no held establishing shot" revision). Setting these explicitly (rather than relying on
  // state.js's own initial values) means the timeline is the single source of truth for every
  // value it owns, even at rest — includes fields the returnTimeline will later take over
  // (bloom/color/iris/overlay), seeded here to fall-in's resting values so there's no undefined
  // gap before returnTimeline starts writing them much later.
  // fov seeds at CAMERA.fov.fall (not traverse's narrower resting value) since BEATS.drop.start
  // is now 0 — there is no pre-drop hold for a narrower composed shot to occupy; the fisheye/
  // vertigo lens is live from the very first frame the drop tween below ramps toward it anyway.
  fallInTimeline.set(state.camera, { fov: CAMERA.fov.fall, rollDeg: 0, bankDeg: 0 }, 0);
  fallInTimeline.set(state.color, { mixT: 0 }, 0);
  fallInTimeline.set(state.bloom, { intensity: 0.3, godRays: 0 }, 0);
  fallInTimeline.set(state.pulse, { bpm: PULSE.bpmStart }, 0);
  fallInTimeline.set(state.overlay, { skipOpacity: 0, titleOpacity: 0, returnCopyOpacity: 0 }, 0);
  fallInTimeline.set(state.iris, { radius: 1 }, 0);
  fallInTimeline.set(state.rackFocus, { amount: 0, focusDistance: 0.9 }, 0);
  fallInTimeline.set(state.turnCue, { amount: 0 }, 0);

  // -------------------------------------------------------------------------
  // Beat 1 — The Drop (0 -> 0.6s per BEATS.drop)
  // Sharp ease-in fall, fisheye FOV already maxed (holds at fall FOV — the "taking over" feeling
  // is the roll/shake, not a FOV ramp, per Concept Section 2/3: FOV stays wide/fisheye through the
  // whole fall until "catch"). 2-4 deg uncommanded roll kicks in immediately and hard
  // (EASE.drop = power4.in), front-loaded intensity per the kinetic lens. Motion begins at t=0 —
  // no held opening shot precedes this (v2.1: the silhouette beat is removed entirely).
  // -------------------------------------------------------------------------
  fallInTimeline.to(
    state.camera,
    {
      fov: CAMERA.fov.fall,
      rollDeg: CAMERA.rollDegrees.max,
      duration: fallInBeatDuration('drop'),
      ease: EASE.drop,
    },
    BEATS.drop.start
  );
  // Title card / skip affordance fade targets: overlay-text.js owns the actual DOM tween, but per
  // the contract director.js writes the canonical opacity value into state so any module can read
  // a single source of truth for "is the title supposed to be visible yet."
  fallInTimeline.to(
    state.overlay,
    { titleOpacity: 1, duration: fallInBeatDuration('drop'), ease: EASE.drop },
    BEATS.drop.start
  );

  // -------------------------------------------------------------------------
  // Beat 2 — Freefall (0.6 -> 2.2s)
  // Sustained fall, decaying shake — roll oscillates back down toward the "min" band rather than
  // growing further (decaying intensity, not decaying to zero, so the tumble still reads as "real"
  // per Section 2's imperfection note). First faint bioluminescent hint appears far below: a
  // whisper of bloom.intensity above its resting 0.3 floor.
  // -------------------------------------------------------------------------
  fallInTimeline.to(
    state.camera,
    {
      rollDeg: CAMERA.rollDegrees.min,
      duration: fallInBeatDuration('freefall'),
      ease: EASE.traverse, // sine.inOut: gentle decay of the shake, not another sharp curve
    },
    BEATS.freefall.start
  );
  fallInTimeline.to(
    state.bloom,
    {
      intensity: 0.45,
      duration: fallInBeatDuration('freefall'),
      ease: 'sine.inOut',
    },
    BEATS.freefall.start
  );

  // -------------------------------------------------------------------------
  // Beat 3 — The Catch (2.2 -> 3.2s)
  // FOV narrows 100 -> 60 as fall becomes flight; this recalibration is itself the "exhale"
  // (Section 2). Roll/bank settle fully to 0 (control returns as this beat ends — scroll +
  // parallax both activate). First proper streak-field glow ignites: bloom steps up to its Act II
  // resting level and the pulse begins at its Act II starting bpm.
  // -------------------------------------------------------------------------
  fallInTimeline.to(
    state.camera,
    {
      rollDeg: 0,
      bankDeg: 0,
      duration: fallInBeatDuration('catch'),
      ease: EASE.overflow, // power2.out: a decelerating settle, the "exhale"
    },
    BEATS.catch.start
  );
  // v2.23 — FOV split into its own tween so it can carry a zero-velocity ramp. This is the SAME
  // bug v2.14 already found and fixed at the two return-phase beat boundaries, present here too
  // and never caught: FOV holds constant at 100 through `drop` and `freefall`, then at `catch` a
  // plain `power2.out` starts moving it at that curve's own (non-zero) initial speed. A field that
  // was motionless for 2.2s beginning a 40-degree change at full speed in a single frame is an
  // instantaneous velocity discontinuity — it reads as a lurch or a zoom-snap right as the fall is
  // supposed to be exhaling into flight, and it was part of what made the opening feel jumpy.
  // zeroVelocityRamp accelerates the FOV into that same curve from a standstill instead.
  fallInTimeline.to(
    state.camera,
    {
      fov: CAMERA.fov.catchEnd,
      duration: fallInBeatDuration('catch'),
      ease: zeroVelocityRamp('power2.out'),
    },
    BEATS.catch.start
  );
  fallInTimeline.to(
    state.bloom,
    {
      intensity: 0.55,
      duration: fallInBeatDuration('catch'),
      ease: 'sine.out',
    },
    BEATS.catch.start
  );
  fallInTimeline.set(state.pulse, { bpm: PULSE.bpmStart }, BEATS.catch.start);

  // Lock the resting traverse FOV in at the very end of fall-in so there's an exact, guaranteed
  // value the instant state.beat flips to 'traverse' — camera.js layers micro-drift/bank on top of
  // this resting target during that phase, it never needs to re-derive it itself.
  fallInTimeline.set(state.camera, { fov: CAMERA.fov.traverse }, BEATS.catch.end);

  fallInTimeline.totalDuration(BEATS.catch.end); // fixed ~3.2s fall-in duration (v2.1: halved from v2's ~6.8s)

  // ===========================================================================================
  // 2. Traverse-cosmetic tweens/functions — driven by state.traverse.elapsedSeconds, NOT by any
  // clock or by state.traverse.progress. There is no GSAP-scrubbed camera timeline for this phase
  // (scroll.js/vortex.js own camera position directly off progress) — what's scheduled here is
  // purely cosmetic (pulse bpm, rack-focus, turn-cue), and it's scheduled via one-shot plain GSAP
  // tweens fired at the right elapsed-time thresholds rather than a scrubbable timeline, because
  // elapsedSeconds only ever increases (real wall-clock time in-phase, per state.js) — nothing
  // here needs to be scrubbed backward the way clockTime-driven timelines do.
  // ===========================================================================================

  // Internal "already fired" flags so each one-shot moment below triggers exactly once even
  // though updateTraverseCosmetics runs every frame. Reset by resetTraverseCosmetics() so a fresh
  // traverse pass (e.g. after some future replay/restart) starts clean — not required by the
  // current single-pass piece, but cheap and keeps this module correct under skipToEnd() replay
  // scenarios without leaking state across calls.
  // NOTE: state.pulse.bpm is deliberately NOT driven by a GSAP tween — see updateTraverseCosmetics
  // below, which sets it directly from a closed-form eased curve every frame. A tween target would
  // need constant restarting as elapsed time (and therefore its computed target) changes every
  // frame, which either thrashes easing (killing/restarting every frame) or requires the exact same
  // "evaluate the curve at elapsed time" math a plain tween is trying to avoid — so it's simpler and
  // equally correct to evaluate the curve directly.
  let rackFocusMomentsFired = [];
  let turnCueMomentsFired = [];

  // Rack-focus moments (Concept Section 2: "near-field streaks sharp, the deep convergence point
  // soft, then reverse — draws the eye forward," applied to particle depth-of-field). Two moments
  // through the trance, expressed as *fractions of SCROLL.pulseReferenceDuration* (the same
  // elapsed-time reference the pulse curve uses) rather than fractions of total traverse duration,
  // since traverse has no fixed total duration to take a fraction of — this is the elapsed-time
  // re-keying ARCHITECTURE.md's director.js section calls for explicitly. A user who lingers past
  // pulseReferenceDuration simply doesn't get additional rack-focus moments manufactured for them
  // (two is the authored count per the beat sheet); a fast scroller who finishes before these
  // fire just doesn't see them, same as v1's "some turns don't get a tilt" texture philosophy.
  const RACK_FOCUS_FRACTIONS = [0.3, 0.6]; // fractions of SCROLL.pulseReferenceDuration
  const RACK_FOCUS_NEAR = 0.9; // world-unit meters, near-field streak distance (matches postfx.js's TiltShiftEffect remap)
  const RACK_FOCUS_FAR = 9; // world-unit meters, deep convergence point

  // Turn-cue telegraph moments: a light/glyph cue a beat ahead of an upcoming vortex flow-field
  // curve (v2's walls-less equivalent of v1's corridor-turn telegraphing). Since vortex.js's
  // actual flow-field curve geometry isn't this module's concern (director.js authors cosmetic
  // state values only, never reads Three.js curve objects, per the file's own contract above),
  // these are scheduled on a repeating elapsed-time cadence rather than keyed to real turn
  // geometry — CONCEPT.md's "occasional slow roll/bank...held briefly, then correcting" is
  // explicitly a texture, not tied to one-true-turn positions the way v1's wall-seam corridor was.
  const TURN_CUE_INTERVAL = 6; // seconds of elapsedSeconds between telegraphed bank/glow cues
  const TURN_CUE_LEAD = 1.6; // seconds the cue anticipates the bank it's telegraphing
  const TURN_CUE_HOLD = 2.4;
  let nextTurnCueAt = TURN_CUE_INTERVAL * 0.5; // first cue arrives a bit earlier than a full interval, so it isn't a dead beat right as traverse opens

  /**
   * Resets the one-shot scheduling flags for the traverse-cosmetic tweens. Call this alongside
   * any reset of state.traverse.elapsedSeconds (main.js's territory) if the experience is ever
   * replayed from the top; harmless to leave unused for a single-pass piece.
   */
  function resetTraverseCosmetics() {
    rackFocusMomentsFired = [];
    turnCueMomentsFired = [];
    nextTurnCueAt = TURN_CUE_INTERVAL * 0.5;
  }

  /**
   * Per-frame traverse-cosmetic update. Only meaningful while state.beat === 'traverse' — main.js
   * should call this every frame during that beat (mirroring how fallInTimeline/returnTimeline
   * are scrubbed during their own phases). Safe to call defensively outside that beat too (it
   * no-ops without state.traverse.elapsedSeconds advancing, since main.js only advances that
   * field during the traverse phase per its own contract) but the primary contract is "call this
   * while beat === 'traverse'".
   */
  function updateTraverseCosmetics(state) {
    const elapsed = state.traverse.elapsedSeconds;

    // NOTE: state.pulse.bpm is NOT written here. lighting.js's updateLighting() is the
    // contractually authoritative writer of this field (ARCHITECTURE.md's lighting.js section:
    // "drive the pulse-deceleration curve... off state.traverse.elapsedSeconds"), and main.js's
    // fixed update order runs updateLighting() after updateTraverseCosmetics() every frame, so a
    // second writer here would always be silently overwritten anyway — a prior version of this
    // file wrote a competing eased curve here that was dead code for exactly that reason. See
    // lighting.js's updateLighting() for the one real implementation of this curve.

    // --- Rack-focus one-shot moments ------------------------------------------------------------
    RACK_FOCUS_FRACTIONS.forEach((frac, i) => {
      const fireAt = SCROLL.pulseReferenceDuration * frac;
      if (!rackFocusMomentsFired[i] && elapsed >= fireAt) {
        rackFocusMomentsFired[i] = true;
        const holdEach = 1.6;
        gsap.timeline({ defaults: { overwrite: 'auto' } })
          .fromTo(
            state.rackFocus,
            { amount: 0, focusDistance: RACK_FOCUS_NEAR },
            { amount: 1, focusDistance: RACK_FOCUS_NEAR, duration: 1.1, ease: EASE.traverse }
          )
          .to(state.rackFocus, { focusDistance: RACK_FOCUS_FAR, duration: 1.3, ease: EASE.traverse }, `+=${holdEach}`)
          .to(state.rackFocus, { amount: 0, duration: 1.2, ease: EASE.traverse }, `+=${holdEach}`);
      }
    });

    // --- Turn-cue telegraph moments (bank/glow cue a beat ahead, repeating cadence) --------------
    if (elapsed >= nextTurnCueAt) {
      const cueIndex = turnCueMomentsFired.length;
      turnCueMomentsFired[cueIndex] = true;
      // Bank direction consistently follows the vortex field's one real, constant-signed twist
      // (VORTEX_TWIST_SIGN, derived from VORTEX.vortexTwistRate) rather than alternating
      // arbitrarily — CONCEPT.md v2 Section 2 describes the bank as "rolling into the vortex's
      // spiral curve," which only reads as true if the roll's direction actually corresponds to
      // the direction the field is spiraling in, not a coin-flip alternation with no geometric
      // referent. Magnitude still varies per-cue (CAMERA.bankDegrees.min/max) so it doesn't feel
      // metronomic, just the sign is now anchored to something real in the scene.
      const bankAmount = VORTEX_TWIST_SIGN * gsap.utils.random(CAMERA.bankDegrees.min, CAMERA.bankDegrees.max);

      // Lead time: the brightness/density telegraph cue (state.turnCue.amount) must visibly
      // precede the camera's actual bank motion — CONCEPT.md v2 Section 3: turn moments are
      // "gently telegraphed a beat ahead via brightness/density cues... same function as v1's
      // turn-telegraphing." Starting both ramps at timeline position 0 (as before) made the cue
      // and the motion simultaneous, defeating the anticipatory function entirely. The bank tween
      // now starts only once the cue ramp has had TURN_CUE_LEAD seconds to read on its own.
      gsap.timeline({ defaults: { overwrite: 'auto' } })
        .to(state.turnCue, { amount: 1, duration: TURN_CUE_LEAD * 0.7, ease: EASE.traverse }, 0)
        .to(state.camera, { bankDeg: bankAmount, duration: TURN_CUE_LEAD * 0.6, ease: EASE.traverse }, TURN_CUE_LEAD)
        .to(state.turnCue, { amount: 0, duration: 1.0, ease: EASE.traverse }, `+=${TURN_CUE_HOLD}`)
        .to(state.camera, { bankDeg: 0, duration: 1.4, ease: EASE.traverse }, '<');

      nextTurnCueAt = elapsed + TURN_CUE_INTERVAL;
    }
  }

  // ===========================================================================================
  // 3. returnTimeline — scrubbed by state.actIII.clockTime, covers turn/approach/overflow/iris.
  // Fixed RETURN_TOTAL_DURATION (5.5s, v2.2 — halved from v2.1's 12s, see config.js) duration,
  // same easing philosophy as v1 (EASE.overflow throughout, symmetric with fallInTimeline's
  // ease-in per the "symmetric easing" non-negotiable). Timecodes below are relative to the
  // return phase's own start (state.actIII.clockTime === 0), using BEATS.turn/.approach/.overflow/
  // .iris's {duration} fields directly (accumulated), mirroring state.js's updateBeat()
  // accumulation pattern for the same four keys. v2.2: turnStart/approachStart/overflowStart/
  // irisStart below are computed from BEATS.*.duration, not hardcoded — so this file didn't need
  // any offset changes when config.js's durations were halved, only this re-verification pass.
  // ===========================================================================================
  const returnTimeline = gsap.timeline({
    paused: true,
    defaults: { overwrite: 'auto' },
  });

  const turnStart = 0;
  const approachStart = turnStart + BEATS.turn.duration;
  const overflowStart = approachStart + BEATS.approach.duration;
  const irisStart = overflowStart + BEATS.overflow.duration;

  // Seed the return phase's own t=0 explicitly — the moment traverse completes and this timeline
  // starts scrubbing from 0, these are the values it should already be holding (continuity with
  // wherever fallInTimeline/traverse cosmetics left things: FOV at the traverse resting value,
  // color still fully cool, bloom at its traverse resting level, pulse wherever it decelerated to).
  returnTimeline.set(state.camera, { fov: CAMERA.fov.traverse }, turnStart);
  returnTimeline.set(state.color, { mixT: 0 }, turnStart);

  // -------------------------------------------------------------------------
  // Beat 5 — The Turn (0 -> BEATS.turn.duration = 1.2s relative, v2.2: was 0->3s in v2.1)
  // A held beat: camera slows almost to stop (vortex.js/camera.js own the actual deceleration of
  // motion along the travel axis — director.js's job here is only the color foreshadow).
  // "Warmest color shift begins subtly" -> mixT eases from 0 toward a small non-zero value, the
  // first hint of the single hard pivot to come. Bloom ticks up almost imperceptibly. Both tweens
  // below use `duration: BEATS.turn.duration` directly, so they already fit exactly within the
  // beat's new, shorter span with no separate offset fix needed.
  // -------------------------------------------------------------------------
  returnTimeline.to(
    state.color,
    {
      mixT: 0.12,
      duration: BEATS.turn.duration,
      ease: EASE.traverse,
    },
    turnStart
  );
  returnTimeline.to(
    state.bloom,
    {
      intensity: 0.65,
      duration: BEATS.turn.duration,
      ease: 'sine.in',
    },
    turnStart
  );

  // -------------------------------------------------------------------------
  // Beat 6 — The Approach (BEATS.turn.duration -> +BEATS.approach.duration relative, i.e.
  // 1.2 -> 3.4s, v2.2: was 3->8s in v2.1)
  // Ease-out deceleration begins (EASE.overflow = power2.out) on FOV, which cheats wider
  // (60 -> 70, CAMERA.fov.traverse -> CAMERA.fov.approach) so the light's growth feels
  // accelerating even as camera movement decelerates — the "mismatch" Concept Section 3
  // explicitly calls out. Color finishes its pivot in full swing (mixT 0.12 -> ~0.75). Bloom/
  // godRays grow on an *accelerating* curve (power3.in) deliberately opposed to the camera's
  // decelerating ease — same mismatch, applied to light instead of geometry. All three tweens use
  // `duration: BEATS.approach.duration` directly, fitting exactly within the beat's new span.
  // v2.14 FIX: FOV's ease is wrapped in zeroVelocityRamp (see that function's own comment) —
  // color/bloom below are untouched, their own velocity discontinuities at this boundary were
  // measured as much smaller (a max accel spike of ~0.86 for mixT vs. FOV's 13.6) and not what the
  // "jumps at the end" feedback was describing (a felt zoom/FOV snap, not a color/bloom snap).
  // -------------------------------------------------------------------------
  returnTimeline.to(
    state.camera,
    {
      fov: CAMERA.fov.approach,
      duration: BEATS.approach.duration,
      ease: zeroVelocityRamp('power2.out'),
    },
    approachStart
  );
  returnTimeline.to(
    state.color,
    {
      mixT: 0.75,
      duration: BEATS.approach.duration,
      ease: EASE.overflow,
    },
    approachStart
  );
  returnTimeline.to(
    state.bloom,
    {
      intensity: 1.1,
      godRays: 0.6,
      duration: BEATS.approach.duration,
      ease: 'power3.in', // accelerating growth of light, opposing the camera's decelerating ease
    },
    approachStart
  );

  // -------------------------------------------------------------------------
  // Beat 7 — The Overflow (overflowStart -> +BEATS.overflow.duration relative, i.e. 3.4 -> 4.8s,
  // v2.2: was 8->11s in v2.1)
  // Near-stop, light fills frame, volumetric spill. Full warm whiteout, deliberate overexposure.
  // mixT completes the pivot to 1 (traverseBase/Accent -> overflowEnd, the single hard color turn
  // of the whole piece). Bloom/godRays peak past "comfortable" (bloom > 1) for the overexposed
  // feeling Concept Section 4 explicitly wants ("too bright," walking out of a cinema into
  // daylight). FOV settles back down slightly from its "approach" cheat as the camera comes to
  // rest, staying just past the traverse resting FOV rather than a full reset (a near-stop, not a
  // full reset). The color tween below uses 60% of BEATS.overflow.duration (0.84s of the 1.4s
  // beat) so it resolves before the beat ends rather than exactly at its edge; bloom/FOV use the
  // full `BEATS.overflow.duration` — all three fit within the beat's new, shorter span.
  // v2.14 FIX: FOV's ease is wrapped in zeroVelocityRamp, same as the approach beat's own FOV tween
  // above and for the same measured reason (this exact boundary showed the larger of the two
  // spikes, -17.1deg/s instantly) — color/bloom untouched, see that fix's own comment.
  // -------------------------------------------------------------------------
  returnTimeline.to(
    state.color,
    {
      mixT: 1,
      duration: BEATS.overflow.duration * 0.6,
      ease: 'power1.in',
    },
    overflowStart
  );
  returnTimeline.to(
    state.bloom,
    {
      intensity: 1.6,
      godRays: 1,
      duration: BEATS.overflow.duration,
      ease: EASE.overflow,
    },
    overflowStart
  );
  returnTimeline.to(
    state.camera,
    {
      fov: CAMERA.fov.traverse + 2,
      duration: BEATS.overflow.duration,
      ease: zeroVelocityRamp('power2.out'),
    },
    overflowStart
  );

  // -------------------------------------------------------------------------
  // Beat 8 — The Iris (irisStart -> +BEATS.iris.duration relative, i.e. 4.8 -> 5.5s, v2.2: was
  // 11->12s in v2.1)
  // Soft iris-style reveal. Cross-dissolve hold before the radius actually starts closing, so the
  // vestibular system gets a moment to "land" (Concept Section 3) before the iris wipes to the
  // homepage. v2.2: BEATS.iris.duration is now only 0.7s (was 1s in v2.1), so the hold can no
  // longer be a flat ~500ms constant without eating most of the beat — `Math.min(0.5, irisSpan *
  // 0.5)` caps the hold at half the beat's own span (0.35s at the current 0.7s duration) so the
  // subsequent radius-close tween (irisSpan - holdDuration = 0.35s) always has a real amount of
  // time left to run, however short BEATS.iris.duration gets. Return copy fades in as the iris
  // opens onto the "world," title card recedes (overlay-text.js's own beat==='iris' branch already
  // handles the DOM cross-fade of the title; director.js keeps the canonical opacity values in
  // state in lockstep so both sources of truth agree).
  // -------------------------------------------------------------------------
  const irisSpan = BEATS.iris.duration;
  const holdDuration = Math.min(0.5, irisSpan * 0.5); // capped at half the beat's own span so the closing tween always keeps a real remainder, however short irisSpan gets (v2.2: was a safe no-op cap at the old 1s duration, now load-bearing at 0.7s)
  returnTimeline.set(state.overlay, { titleOpacity: 0 }, irisStart);
  returnTimeline.to(
    state.overlay,
    { returnCopyOpacity: 1, duration: irisSpan - holdDuration, ease: 'sine.out' },
    irisStart
  );
  returnTimeline.to(
    state.overlay,
    { skipOpacity: 0, duration: 0.3, ease: 'sine.out' },
    irisStart
  );
  returnTimeline.to(
    state.iris,
    {
      radius: 0,
      duration: irisSpan - holdDuration,
      ease: EASE.overflow,
    },
    irisStart + holdDuration
  );

  // Total timeline length matches RETURN_TOTAL_DURATION (5.5s, v2.2 — was 12s in v2.1) exactly,
  // per config.js's authored sum of BEATS.turn/.approach/.overflow/.iris durations.
  returnTimeline.totalDuration(RETURN_TOTAL_DURATION);

  // ---------------------------------------------------------------------------
  // skipToEnd(): v2's contract change from v1 (per ARCHITECTURE.md's director.js section) — there
  // is no single global timeline left to seek, so this function does NOT try to seek anything to
  // "the end." Its only job is to make sure `returnTimeline` is ready to scrub from 0 the instant
  // main.js flips the phase over. main.js is responsible for the actual phase-transition side
  // effects this implies: setting state.traverse.progress = 1, state.traverse.complete = true, and
  // state.actIII.clockTime = 0, then calling returnTimeline.time(0) (or just letting the next
  // frame's normal scrub call do it) — none of that is this function's job per the new contract.
  //
  // Concretely: kill any in-flight traverse-cosmetic one-shot tweens (rack-focus/turn-cue) so they
  // can't keep animating state.rackFocus/state.turnCue/state.camera.bankDeg into the return phase
  // after control has already moved on, and rewind returnTimeline's own playhead to 0 defensively
  // (idempotent — main.js's next scrub call will set it authoritatively anyway, but this guarantees
  // calling skipToEnd() before any scrub call still leaves the timeline in a valid, seek-from-0
  // state rather than wherever it happened to be paused from a previous partial run).
  // -------------------------------------------------------------------------
  function skipToEnd() {
    gsap.killTweensOf(state.rackFocus);
    gsap.killTweensOf(state.turnCue);
    gsap.killTweensOf(state.camera); // in-flight bank/turn-cue tweens only; fallInTimeline/returnTimeline still own their own scrubbed values and aren't affected by a kill of ad-hoc tweens targeting the same object
    returnTimeline.time(0);
  }

  return {
    fallInTimeline,
    returnTimeline,
    skipToEnd,
    // Exposed alongside the two required timelines so main.js can drive the traverse phase's
    // cosmetic tweens/functions per ARCHITECTURE.md's director.js section 2 — not part of the
    // three-field contract literally named in the task ({ fallInTimeline, returnTimeline,
    // skipToEnd() }), but there is no other way for main.js to invoke this phase's cosmetic
    // scheduling without it, and the contract explicitly describes this responsibility as
    // director.js's to own. See "Deviations" in the handoff notes.
    updateTraverseCosmetics,
    resetTraverseCosmetics,
  };
}
