// Single shared mutable state object (v2.2 — void/particle-vortex pivot, Follow-the-Orb
// revision). This is the ONLY channel modules use to talk to each other. Nobody holds
// references to other modules' Three.js objects — director.js (GSAP, for the fixed-duration
// fall-in/return phases), scroll.js (for the scroll-paced traverse phase, now bidirectional),
// and guide.js (for the orb's own position, which now drives the camera) write discrete values
// into this object; every other module's update(state, dt) reads what it needs.
//
// v2 timing model (see config.js's header comment for the full rationale): three independently
// clocked phases now exist instead of one global clockTime driving everything —
//   1. Fall-in:   state.clockTime (absolute seconds since load) — unchanged from v1.
//   2. Traverse:  state.traverse.progress (0..1, scroll-driven, BIDIRECTIONAL as of v2.2) — NOT clockTime.
//   3. Return:    state.actIII.clockTime (seconds since traverse completed) — a fresh sub-clock.
// updateBeat() below is the ONLY place that reads across all three and derives the single
// state.beat/state.beatProgress pair every other module already knows how to consume.
// state.traverse.progress can now DECREASE (v2.2: bidirectional scroll) — updateBeat()'s clamp
// (Math.min(1, Math.max(0, ...))) already tolerates this correctly; no logic change was needed
// there, only in scroll.js's velocity model (see that file).

import { CAMERA, BEATS, COLOR, PULSE, SCROLL } from './config.js';

export const state = {
  clockTime: 0, // fall-in phase's clock only; frozen once traverse begins (see main.js)
  dt: 0,
  beat: 'drop', // no silhouette beat in v2.1 — motion starts immediately at t=0
  beatProgress: 0, // 0-1 through the current beat

  // Owned by scroll.js. progress is the traverse phase's actual completion fraction (0..1),
  // driven by accumulated scroll/touch input with velocity clamping and idle-drift decay per
  // config.js's SCROLL bounds — never by clockTime. elapsedSeconds is real wall-clock time spent
  // in this phase (used only for cosmetic time-based curves like PULSE's deceleration, which must
  // not stall or rush just because the user scrolled unusually slow/fast — see config.js).
  // complete flips true exactly once, the moment progress reaches 1; main.js watches this to
  // start advancing state.actIII.clockTime.
  traverse: {
    progress: 0,
    elapsedSeconds: 0,
    complete: false,
  },

  // Owned by director.js's return-phase timeline. Starts advancing only once
  // state.traverse.complete is true; represents seconds elapsed since the return phase (turn ->
  // approach -> overflow -> iris) began, independent of both clockTime and traverse.progress.
  actIII: {
    clockTime: 0,
  },

  camera: {
    fov: CAMERA.fov.fall,
    rollDeg: 0,
    bankDeg: 0, // replaces v1's dutchTiltDeg — same function (occasional roll as the path curves), renamed for the walls-less vortex context
  },

  color: {
    mixT: 0, // 0 = cool teal (traverseBase), 1 = warm gold/white (overflowEnd)
  },

  bloom: {
    intensity: 0.3,
    godRays: 0, // still authored by director.js for parity/back-compat even though postfx.js's GodRaysEffect isn't in any pass (see postfx.js's DEFINITIVE FIX comment) — lighting.js's overflowLight consumes this value instead
  },

  pulse: {
    bpm: PULSE.bpmStart,
  },

  overlay: {
    skipOpacity: 0,
    titleOpacity: 0,
    returnCopyOpacity: 0,
  },

  iris: {
    radius: 1, // 1 = fully open onto the scene (mask clipped away/invisible), 0 = closed (mask fully covers) — see overlay-text.js's clip-path mapping
  },

  pointer: {
    x: 0, // normalized -1..1
    y: 0,
    idleSeconds: 0,
  },

  ripple: {
    x: 0,
    y: 0,
    strength: 0, // decays to 0 at rest; interaction.js owns writing this (passive, gaze-driven), others may read it
    // v2.2, new — a deliberate click/tap-triggered burst, distinct from the passive gaze trail
    // above so it can get its own, more dramatic one-shot visual treatment (the explicit
    // "something to fiddle with" feedback). Decays independently via RIPPLE.clickFadeDurationSeconds.
    clickBurst: 0,
  },

  // v2.6: renamed from `glyphs` alongside the retired "404" glyph-formation system's replacement
  // (seeking-orbs.js) — same two fields, same meaning, new owner module.
  seekingOrbs: {
    nearestProximity: 1, // 0 = camera is at a seeking-orb encounter, 1 = far from all; seeking-orbs.js owns writing this
    allResolved: false, // true once every seeking-orb encounter has settled/"found itself"; seeking-orbs.js owns this
  },

  rackFocus: {
    amount: 0, // 0 = fully sharp/inert, 1 = full sharp-band strength; director.js's traverse-cosmetic tweens author this off state.traverse.elapsedSeconds, not a fixed clock
    focusDistance: 0.9, // WORLD UNITS (meters) — near-field streak distance; see postfx.js's TiltShiftEffect remap for how this is consumed
  },

  turnCue: {
    amount: 0, // 0..1 — telegraphs an upcoming vortex flow-field curve a beat ahead, so
               // lighting.js can brighten a cue in the direction the field is about to bank toward
  },

  guide: {
    position: null, // THREE.Vector3, owned/written by guide.js each frame — the orb's actual world position, which now DRIVES the camera (v2.2 chase-cam), not the other way around
    tangent: null, // THREE.Vector3, owned/written by guide.js each frame — the orb's direction of travel, used by vortex.js's camera-follow math for orientation
    dissolving: false, // true once the return phase's 'turn' beat begins — guide.js ramps itself out as it hands off to the overflow light
  },

  // v2.2, new — which of config.js's GUIDE_DIALOGUE_AXIS_FRACTIONS beats is currently on
  // screen, if any (-1 = none). Owned by overlay-text.js; exposed so other modules (e.g.
  // lighting.js/vortex.js) MAY sync a subtle visual cue to a dialogue beat without needing to
  // duplicate the trigger logic themselves — reading this is optional, not a hard requirement.
  dialogue: {
    activeIndex: -1,
  },

  // v2.2, new — true while a companion-orb "sighting" cluster (config.js's
  // COMPANION_ORBS.sightingAxisFractions) is nearby and visible, owned by vortex.js. Exposed for
  // the same optional cross-module-sync reason as state.dialogue above.
  companions: {
    sightingActive: false,
  },

  skipRequested: false, // set true by overlay-text.js's skip control; main.js checks this to fast-forward
};

// Derives `beat` and `beatProgress` every frame, before any module's update() runs, so every
// module sees a consistent beat this frame. Handles all three v2 phases — see this file's header
// comment for what drives each one.
export function updateBeat() {
  // --- Phase 1: fall-in, driven by absolute clockTime, unchanged mechanism from v1 -----------
  if (!state.traverse.complete && state.clockTime < BEATS.traverse.start) {
    for (const key of ['drop', 'freefall', 'catch']) {
      const range = BEATS[key];
      if (state.clockTime >= range.start && state.clockTime < range.end) {
        state.beat = key;
        state.beatProgress = (state.clockTime - range.start) / (range.end - range.start);
        return;
      }
    }
  }

  // --- Phase 2: traverse, driven by state.traverse.progress (scroll.js), not clockTime --------
  if (!state.traverse.complete) {
    state.beat = 'traverse';
    state.beatProgress = Math.min(1, Math.max(0, state.traverse.progress));
    return;
  }

  // --- Phase 3: return, driven by state.actIII.clockTime (seconds since traverse completed) --
  const t = state.actIII.clockTime;
  let acc = 0;
  for (const key of ['turn', 'approach', 'overflow', 'iris']) {
    const dur = BEATS[key].duration;
    if (t < acc + dur) {
      state.beat = key;
      state.beatProgress = (t - acc) / dur;
      return;
    }
    acc += dur;
  }
  state.beat = 'iris';
  state.beatProgress = 1;
}
