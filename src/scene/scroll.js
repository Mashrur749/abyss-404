// Normalizes wheel/touch/pointer input into state.traverse.progress (0..1) for Act II ("the
// traverse") per ARCHITECTURE.md's src/scene/scroll.js contract and CONCEPT.md v2 Section 3/5's
// "scroll paces, never directs" non-negotiable.
//
// This is a full-viewport canvas experience with nothing to actually scroll, so we use GSAP's
// Observer plugin (gsap/Observer) rather than ScrollTrigger — Observer normalizes raw input
// deltas without needing real scroll-height/position, which is exactly this problem shape. See
// ARCHITECTURE.md's scroll.js section and CONCEPT.md v2 Section 6's library table for why.
//
// v2.2: BIDIRECTIONAL. Velocity is now SIGNED — the sign of the raw scroll delta is tracked
// (previously discarded, magnitude-only) and steers velocity toward +MAX_VELOCITY (forward) or
// -MAX_VELOCITY * SCROLL.backwardVelocityScale (backward, deliberately slower than forward). The
// idle-drift floor velocity relaxes toward when there's no fresh input is ALWAYS +IDLE_VELOCITY —
// never 0, never negative — regardless of which direction the user was just scrolling. This is
// what keeps "guaranteed resolution" true in a bidirectional world: a user who only ever scrolls
// backward, or stops entirely, still eventually drifts forward and completes the traverse
// (CONCEPT.md REVISION item 4, ARCHITECTURE.md non-negotiable #1). Direction still never changes
// *which* path is taken (non-negotiable #4/#5) — only where along the fixed path the user
// currently is, so state.traverse.progress can now legitimately decrease frame-to-frame.
//
// Ownership: this module owns state.traverse.progress, state.traverse.elapsedSeconds, and flips
// state.traverse.complete = true exactly once, the moment progress reaches 1 (progress can dip
// back below 1 after that were it not for `complete` latching — see below for why we still leave
// `complete` as a one-way latch). It NEVER touches state.beat, state.clockTime, or
// state.actIII.clockTime — pace only, per the non-negotiable. It is only effectful while
// state.beat === 'traverse'; outside that beat it still safely tracks raw input (so there's no
// dead/laggy re-acquisition moment when traverse begins) but never writes to state.

import gsap from 'gsap';
import { Observer } from 'gsap/Observer';
import { SCROLL } from '../config.js';

gsap.registerPlugin(Observer);

// Progress-per-second velocity bounds derived from config.js's authored duration bounds:
//   - Fastest possible FORWARD completion (continuous max-velocity forward scrolling) must take
//     SCROLL.minDuration seconds -> that's the forward velocity ceiling.
//   - Backward maximum speed is deliberately slower than forward (SCROLL.backwardVelocityScale)
//     so reversing is real and useful for revisiting without the piece losing its forward lean.
//   - Slowest possible completion (zero input, idle-drift alone) must take
//     SCROLL.idleDriftDuration seconds -> that's the velocity floor we always decay toward. This
//     floor is always POSITIVE (forward) — v2.2's bidirectional scroll never decays toward zero
//     or negative, which is precisely what keeps guaranteed-resolution true (see header comment).
const MAX_VELOCITY = 1 / SCROLL.minDuration; // progress/sec at the forward velocity ceiling
const MIN_VELOCITY = -MAX_VELOCITY * SCROLL.backwardVelocityScale; // progress/sec at the backward velocity floor (negative)
const IDLE_VELOCITY = 1 / SCROLL.idleDriftDuration; // progress/sec — the ALWAYS-POSITIVE idle-drift target/floor

// How much of a single wheel/touch/pointer delta "tick" converts into added velocity. Kept soft
// (not 1:1 with raw pixel delta) so a single flick doesn't instantly slam the ceiling — the input
// *excites* velocity rather than setting it directly, matching the resonance-not-response feel
// used elsewhere (interaction.js's ripple, etc.) even though pace is structurally load-bearing.
// v2.2: this gain is now applied signed (see onChange below), symmetrically for both directions.
const DELTA_TO_VELOCITY_GAIN = 0.00028;

// Exponential decay rate (per second) velocity relaxes toward its current target at, derived from
// config.js's SCROLL.inputResponseSeconds (the authored time-constant for how quickly velocity
// catches up to fresh input — v2.1, tightened from the v2 build's hardcoded 0.6/sec, which read as
// "too much lag/delay" per playtest feedback). A time-constant of `inputResponseSeconds` means
// velocity closes ~63% of the gap to its target in that many seconds, so the low 0.12s default
// makes both directions — excitation rising toward a forward or backward burst, and decay falling
// back toward the idle-drift floor — visibly register within a couple of frames rather than a
// noticeable ramp. v2.2: the same rate/time-constant is used symmetrically for both directions,
// per ARCHITECTURE.md's explicit instruction ("apply it symmetrically for both directions").
const VELOCITY_DECAY_RATE = 1 / SCROLL.inputResponseSeconds;

// Module-local raw-input accumulator. Not exported — everything else goes through state. Kept
// separate from state so this module can track input unconditionally (per its contract) without
// ever writing to the shared object outside the traverse beat.
// v2.2: velocity is now SIGNED — it ranges [MIN_VELOCITY, MAX_VELOCITY] rather than
// [IDLE_VELOCITY, MAX_VELOCITY]. It only ever equals exactly IDLE_VELOCITY at rest (no input for
// long enough), never clamped there — it decays TOWARD IDLE_VELOCITY as its resting target, from
// either above (forward burst relaxing back down) or below (backward input relaxing back up).
let velocity = IDLE_VELOCITY; // progress/sec, signed, clamped to [MIN_VELOCITY, MAX_VELOCITY]
let pendingExcitation = 0; // signed, accumulated from Observer's onChange since the last update() tick
let observerInstance = null;

// --- v2.20: the INTENT signal ------------------------------------------------------------------
// Everything about how the piece responds to scrolling reads from here (guide.js's orb response,
// vortex.js's light waves and stillness-gathering). This module already knew `velocity`, but
// velocity alone can't answer the question the interaction design actually asks: *is the user
// pushing right now, or is the piece carrying them?* Idle-drift means the camera is ALWAYS moving,
// so "velocity > 0" is not intent. These fields separate the two.
//
// rawInputEnergy accumulates the magnitude of genuine input deltas and decays continuously, so it
// reads as "how hard is the user pushing, recently" rather than "is there an event this frame"
// (which would strobe at the mercy of wheel-event granularity, which differs wildly between a
// trackpad, a free-spinning mouse wheel, and a touch drag).
let rawInputEnergy = 0;
const INPUT_ENERGY_DECAY_SECONDS = 0.4;
// Energy level treated as "fully engaged." Deliberately low: a gentle, unhurried scroll should
// already read as full intent — this piece must never reward scrolling HARDER.
//
// Sized against BOTH input devices rather than whichever one happened to be on the desk. A mouse
// wheel delivers few, huge deltas (|deltaY| ~100-240 per click -> ~0.03-0.07 energy in one event);
// a trackpad delivers a continuous stream of tiny ones (~1-10 -> ~0.0003-0.003 each, accumulating
// against the decay above toward a steady state while the user keeps moving). At the first value
// tried (0.055) a SINGLE wheel click pinned intent to 1.0 instantly, so wheel users would have got
// a hard on/off flash while trackpad users got a smooth ramp — the same gesture reading as two
// different interactions. This value puts one wheel click around half intent and sustained
// trackpad scrolling in a similar band, so the orb answers the two devices comparably.
const INPUT_ENERGY_REFERENCE = 0.12;

let idleSeconds = 0;
// Stillness ramps in only after a real pause, then over a slow window, so it reads as the piece
// noticing you've settled rather than reacting to the gap between two wheel ticks.
const STILLNESS_BEGIN_SECONDS = 0.7;
const STILLNESS_FULL_SECONDS = 3.2;

// Monotonic counter incremented once per distinct "push." Consumers (vortex.js's light waves) spawn
// an event when it changes, so they never need their own edge-detection on a noisy analog signal.
let impulseCount = 0;
let sinceLastImpulse = Infinity;
const MIN_IMPULSE_INTERVAL_SECONDS = 0.28; // one wave per deliberate push, not one per wheel tick
// Must sit BELOW a single trackpad frame's worth of accumulated delta, or trackpad users would
// essentially never release a light wave while mouse-wheel users got one per click — the same
// cross-device inconsistency INPUT_ENERGY_REFERENCE above exists to avoid. The real spam guard is
// MIN_IMPULSE_INTERVAL_SECONDS, not this threshold; this only rejects accidental micro-jitter.
const IMPULSE_ENERGY_THRESHOLD = 0.004;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Wires up the GSAP Observer once. Safe to call multiple times — only the first call actually
 * creates the Observer instance. Listens to wheel/touch/pointer so trackpad, mouse wheel, and
 * touch-drag all feed the same velocity accumulator; Observer normalizes the differences between
 * these input types for us.
 */
export function initScroll() {
  if (observerInstance) return;

  observerInstance = Observer.create({
    target: window,
    type: 'wheel,touch,pointer',
    // v2.2: the SIGN of the delta now matters (previously discarded — magnitude-only). Positive
    // deltaY (scrolling down / dragging up, Observer's own convention) excites velocity toward
    // +MAX_VELOCITY (forward, deeper into the traverse); negative deltaY excites it toward
    // MIN_VELOCITY (backward, revisiting). deltaX folds in with the same sign convention so
    // trackpad horizontal swipes behave consistently with vertical wheel/touch input. Direction
    // still never picks a different path (non-negotiable #4/#5) — it only moves progress along
    // the one fixed path, forward or backward.
    onChange: (self) => {
      const signedDelta = self.deltaY + self.deltaX;
      if (signedDelta !== 0) {
        pendingExcitation += signedDelta * DELTA_TO_VELOCITY_GAIN;
        // v2.20: intent is magnitude-only and direction-agnostic on purpose — scrolling BACK to
        // revisit something is every bit as much "the user is engaged" as pushing forward, and the
        // orb should answer it the same way.
        rawInputEnergy += Math.abs(signedDelta) * DELTA_TO_VELOCITY_GAIN;
      }
    },
    // Prevent the Observer's default touch-scroll/gesture behavior on the canvas so touch input
    // paces the traverse instead of trying to scroll a page that doesn't exist.
    preventDefault: true,
  });
}

/**
 * Per-frame update. Only effectful while state.beat === 'traverse' — outside that beat this is a
 * safe no-op with respect to shared state (raw input continues to accumulate into
 * `pendingExcitation` harmlessly via the Observer callback above, but is drained/applied to
 * `velocity` only here, and `velocity`/`pendingExcitation` are module-local, never state).
 *
 * Never writes state.beat, state.clockTime, or state.actIII.clockTime.
 */
export function updateScroll(state, dt) {
  // Fold any input received since the last tick into velocity as an instantaneous excitation,
  // then always relax exponentially toward the idle-drift floor — this is what guarantees
  // "decays to idle-drift, never a hard stop" regardless of whether we're currently gated to
  // apply progress: velocity itself keeps evolving so it never feels laggy right as traverse
  // begins or resumes after a pause.
  //
  // v2.2: excitation is now signed and can push velocity toward either bound —
  // positive pendingExcitation (forward scroll) pushes toward +MAX_VELOCITY, negative
  // (backward scroll) pushes toward MIN_VELOCITY (a negative floor, itself scaled down from
  // MAX_VELOCITY by SCROLL.backwardVelocityScale so backward is real but deliberately slower).
  // --- v2.20: resolve the intent signal BEFORE the early-returns below ------------------------
  // Deliberately computed unconditionally, exactly like `velocity` already is (see this function's
  // own header on why): the orb must not go momentarily unresponsive at a beat boundary, and
  // `state.scroll` must be a valid object for every consumer from the very first frame.
  sinceLastImpulse += dt;
  const freshEnergy = Math.abs(pendingExcitation);
  if (freshEnergy > 0) {
    idleSeconds = 0;
    if (freshEnergy >= IMPULSE_ENERGY_THRESHOLD && sinceLastImpulse >= MIN_IMPULSE_INTERVAL_SECONDS) {
      impulseCount += 1;
      sinceLastImpulse = 0;
    }
  } else {
    idleSeconds += dt;
  }

  rawInputEnergy *= Math.exp(-dt / INPUT_ENERGY_DECAY_SECONDS);

  state.scroll = state.scroll || {};
  state.scroll.intent = clamp(rawInputEnergy / INPUT_ENERGY_REFERENCE, 0, 1);
  state.scroll.idleSeconds = idleSeconds;
  state.scroll.stillness = smoothstep(STILLNESS_BEGIN_SECONDS, STILLNESS_FULL_SECONDS, idleSeconds);
  state.scroll.impulseCount = impulseCount;
  state.scroll.velocity = velocity;

  if (pendingExcitation !== 0) {
    velocity = clamp(velocity + pendingExcitation, MIN_VELOCITY, MAX_VELOCITY);
    pendingExcitation = 0;
  }
  // Regardless of which direction fresh input just pushed velocity, it always relaxes back
  // toward IDLE_VELOCITY (never toward 0, never toward a negative rest state) — this is the
  // guaranteed-resolution guardrail: even a user who only ever scrolls backward eventually has
  // their velocity decay up to a small positive drift and keep completing the traverse. The decay
  // is symmetric: whether velocity is currently above IDLE_VELOCITY (a forward burst relaxing
  // down) or below it (a backward excursion relaxing back up), the same time-constant applies.
  if (velocity !== IDLE_VELOCITY) {
    const decayed = IDLE_VELOCITY + (velocity - IDLE_VELOCITY) * Math.exp(-VELOCITY_DECAY_RATE * dt);
    velocity = clamp(decayed, MIN_VELOCITY, MAX_VELOCITY);
  }

  if (state.beat !== 'traverse') return;
  if (state.traverse.complete) return;

  state.traverse.elapsedSeconds += dt;

  const nextProgress = clamp(state.traverse.progress + velocity * dt, 0, 1);
  state.traverse.progress = nextProgress;

  if (nextProgress >= 1 && !state.traverse.complete) {
    state.traverse.complete = true;
  }
}
