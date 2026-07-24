// Tracks raw human input (pointer / device-orientation / click-tap) and turns it into soft
// signals — `state.pointer` and `state.ripple` — per CONCEPT.md Section 5 ("Resonance, not
// response").
//
// This module is intentionally inert with respect to navigation: it NEVER writes state.beat,
// never touches camera position/FOV/scroll state, and never gates itself off based on the
// current beat — it always tracks input safely, so whoever reads state.pointer/state.ripple
// (camera.js's parallax sway, lighting.js's ripple-trail brightening, director.js's
// idle-mirroring pulse) can decide for themselves whether/when it's visually allowed to matter
// (traverse beat only, per the contract). Interaction here is a texture on a fixed path, never a
// fork in it.
//
// v2.2, new: a click/tap-triggered ripple BURST (`state.ripple.clickBurst`) — the explicit
// "something to fiddle with" feedback (CONCEPT.md REVISION item 5). This is a second, independent
// signal living alongside the pre-existing passive gaze-driven `state.ripple.strength` — the
// two are written and decayed completely separately so neither ever clobbers the other (see
// ARCHITECTURE.md's module-boundary bug-class warning: `state.ripple.clickBurst` is a shared
// field other modules read from — lighting.js folds it into its own dedicated 'click-burst' boost
// slot (kept separate from the 'ripple' slot fed by `.strength`), and vortex.js reads it directly
// to give the streak field its actual visible burst payoff (a radius-biased brightness spike,
// distinct in shape from the speed/living-cycle/pulse terms already driving that field) — any
// future consumer must keep treating the two ripple fields as additive/independent, not either-or.

import { RIPPLE } from '../config.js';

// Module-local raw-input accumulator. Not exported — everything else goes through state.
const raw = {
  x: 0, // normalized -1..1, latest known pointer/tilt position
  y: 0,
  hasMoved: false, // becomes true after the first real input event, so ripple has something to seed from
};

// Module-local click/tap-burst accumulator — deliberately separate from `raw` above so the
// passive gaze trail and the deliberate click burst never share bookkeeping. `pending` queues a
// freshly-fired burst for the very next updateInteraction() frame to apply at its own
// (x, y) location; `updateInteraction` clears it once consumed.
const clickRaw = {
  pending: false,
  x: 0, // normalized -1..1, screen position of the click/tap that fired the burst
  y: 0,
};

// Threshold below which a frame's movement doesn't count as "activity" (keeps floating point
// jitter / OS-level micro-events from resetting the idle timer forever).
const IDLE_MOVEMENT_EPSILON = 0.0015;

// How much of a fresh pointer displacement converts into ripple strength this frame. Kept soft
// (not 1:1) so the ripple reads as a "disturbance" rather than a 1:1 cursor-follow.
const RIPPLE_EXCITATION_GAIN = 1.4;

let lastX = 0;
let lastY = 0;
let listenersAttached = false;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function handlePointerMove(event) {
  const w = window.innerWidth || 1;
  const h = window.innerHeight || 1;
  // Normalize to -1..1, origin at viewport center, matching typical parallax conventions.
  raw.x = clamp((event.clientX / w) * 2 - 1, -1, 1);
  raw.y = clamp((event.clientY / h) * 2 - 1, -1, 1);
  raw.hasMoved = true;
}

function handleTouchMove(event) {
  if (!event.touches || event.touches.length === 0) return;
  const touch = event.touches[0];
  const w = window.innerWidth || 1;
  const h = window.innerHeight || 1;
  raw.x = clamp((touch.clientX / w) * 2 - 1, -1, 1);
  raw.y = clamp((touch.clientY / h) * 2 - 1, -1, 1);
  raw.hasMoved = true;
}

function handlePointerDownOrTap(event) {
  // Only the primary button/first touch point counts as "the fiddle" — a stray secondary-button
  // context-menu click, for example, shouldn't fire a burst.
  if (typeof event.button === 'number' && event.button !== 0) return;

  const w = window.innerWidth || 1;
  const h = window.innerHeight || 1;
  let clientX;
  let clientY;
  if (event.touches && event.touches.length > 0) {
    clientX = event.touches[0].clientX;
    clientY = event.touches[0].clientY;
  } else {
    clientX = event.clientX;
    clientY = event.clientY;
  }
  if (typeof clientX !== 'number' || typeof clientY !== 'number') return;

  clickRaw.x = clamp((clientX / w) * 2 - 1, -1, 1);
  clickRaw.y = clamp((clientY / h) * 2 - 1, -1, 1);
  clickRaw.pending = true;
}

function handleDeviceOrientation(event) {
  // gamma: left-right tilt in degrees, range roughly -90..90
  // beta: front-back tilt in degrees, range roughly -180..180 (we only care about a small band
  // around resting/upright phone posture, so we clamp hard rather than map the full range).
  if (event.gamma === null || event.beta === null) return;
  const x = clamp(event.gamma / 45, -1, 1);
  const y = clamp((event.beta - 45) / 45, -1, 1); // ~45deg = phone held upright/comfortable
  raw.x = x;
  raw.y = y;
  raw.hasMoved = true;
}

/**
 * Attaches pointermove/touchmove/deviceorientation listeners once. Safe to call multiple times —
 * only the first call actually wires anything up.
 */
export function initInteraction() {
  if (listenersAttached) return;
  listenersAttached = true;

  window.addEventListener('pointermove', handlePointerMove, { passive: true });
  window.addEventListener('touchmove', handleTouchMove, { passive: true });

  // v2.2, new — the click/tap-triggered ripple burst ("something to fiddle with"). `pointerdown`
  // unifies mouse click and touch tap in a single event on every modern browser/device, so one
  // listener covers both without double-firing the way a separate `click` + `touchstart` pair
  // could. Passive is safe here — this handler never calls preventDefault()/stopPropagation(),
  // so it can't interfere with scroll.js's own input handling (this module never touches scroll
  // state, per its single-responsibility contract).
  window.addEventListener('pointerdown', handlePointerDownOrTap, { passive: true });

  // deviceorientation requires a permission prompt on iOS 13+; request it lazily on first
  // user gesture if the API demands it, otherwise just attach directly. Failure is silent and
  // non-fatal — desktop/denied-permission users simply fall back to pointer input only, per
  // CONCEPT.md's requirement that the journey never depends on any interaction happening.
  const attachOrientation = () => {
    window.addEventListener('deviceorientation', handleDeviceOrientation, { passive: true });
  };

  const DeviceOrientationEventCtor = window.DeviceOrientationEvent;
  if (
    DeviceOrientationEventCtor &&
    typeof DeviceOrientationEventCtor.requestPermission === 'function'
  ) {
    const requestOnGesture = () => {
      DeviceOrientationEventCtor.requestPermission()
        .then((permissionState) => {
          if (permissionState === 'granted') attachOrientation();
        })
        .catch(() => {
          /* permission denied or unsupported — safe no-op, pointer input still works */
        });
      window.removeEventListener('pointerdown', requestOnGesture);
      window.removeEventListener('touchstart', requestOnGesture);
    };
    window.addEventListener('pointerdown', requestOnGesture, { passive: true, once: true });
    window.addEventListener('touchstart', requestOnGesture, { passive: true, once: true });
  } else {
    attachOrientation();
  }
}

/**
 * Per-frame update. Owns state.pointer (x, y, idleSeconds) and state.ripple (x, y, strength,
 * clickBurst). Always safe to call regardless of state.beat — this module tracks input
 * unconditionally; it is up to consumers (camera.js, lighting.js, director.js) to decide when the
 * signal should visibly matter (contract reserves visible effect to the `traverse` beat).
 *
 * Never writes state.beat, camera position/FOV, or scroll/traverse state.
 */
export function updateInteraction(state, dt) {
  const pointer = state.pointer;
  const ripple = state.ripple;

  const dx = raw.x - lastX;
  const dy = raw.y - lastY;
  const movementMagnitude = Math.sqrt(dx * dx + dy * dy);

  // Smoothly settle the reported pointer position toward the raw input rather than snapping —
  // keeps consumers (parallax sway, ripple trail) from jittering on noisy input, and reads as
  // "soft/delayed causality" per the resonance mechanic rather than a 1:1 response.
  const smoothing = 1 - Math.pow(0.001, dt); // frame-rate independent exponential smoothing
  pointer.x += (raw.x - pointer.x) * smoothing;
  pointer.y += (raw.y - pointer.y) * smoothing;

  if (raw.hasMoved && movementMagnitude > IDLE_MOVEMENT_EPSILON) {
    pointer.idleSeconds = 0;
    // Fresh disturbance excites the ripple — a fingertip dragged through still water. We add
    // to existing strength (re-disturbing an already-rippling surface builds on it slightly)
    // but always clamp to 1 so it can never accumulate/persist beyond a single "full" ripple.
    ripple.strength = clamp(ripple.strength + movementMagnitude * RIPPLE_EXCITATION_GAIN, 0, 1);
    ripple.x = pointer.x;
    ripple.y = pointer.y;
  } else {
    pointer.idleSeconds += dt;
  }

  // Ripple always decays back toward 0 — resonance, not response: nothing stays "on".
  // Exponential decay tuned so strength falls to ~0 over RIPPLE.fadeDurationSeconds.
  if (ripple.strength > 0) {
    const decayRate = 4 / Math.max(RIPPLE.fadeDurationSeconds, 0.001); // ~98% decayed after fadeDuration
    ripple.strength = Math.max(0, ripple.strength * Math.exp(-decayRate * dt));
    if (ripple.strength < 0.001) ripple.strength = 0;
  }

  // v2.2, new — the click/tap burst. Deliberately independent of the passive-ripple block above:
  // its own trigger condition (a queued click/tap, not continuous movement), its own gain
  // (RIPPLE.clickBoostGain, stronger than the passive trail so it reads as a deliberate "fiddle"),
  // its own decay constant (RIPPLE.clickFadeDurationSeconds, longer than the passive fade), and
  // its own screen position — never read/write `ripple.strength`/`ripple.x`/`ripple.y` here, and
  // never let the passive-ripple block above touch `ripple.clickBurst`, so a simultaneous gaze
  // move and a click both register fully rather than one clobbering the other.
  if (clickRaw.pending) {
    ripple.clickBurst = RIPPLE.clickBoostGain;
    ripple.clickX = clickRaw.x;
    ripple.clickY = clickRaw.y;
    clickRaw.pending = false;
  }

  if (ripple.clickBurst > 0) {
    const clickDecayRate = 4 / Math.max(RIPPLE.clickFadeDurationSeconds, 0.001); // ~98% decayed after clickFadeDuration
    ripple.clickBurst = Math.max(0, ripple.clickBurst * Math.exp(-clickDecayRate * dt));
    if (ripple.clickBurst < 0.001) ripple.clickBurst = 0;
  }

  lastX = raw.x;
  lastY = raw.y;
}
