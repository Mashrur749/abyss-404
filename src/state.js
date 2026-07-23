// Single shared mutable state object. This is the ONLY channel modules use to talk to each
// other. Nobody holds references to other modules' Three.js objects — director.js (GSAP)
// writes discrete eased values into this object on the master timeline, every other module's
// update(state, dt) reads what it needs and applies it to its own scene objects. This keeps
// modules independently buildable/testable without shared object-graph coupling.

import { CAMERA, BEATS, COLOR, PULSE } from './config.js';

export const state = {
  clockTime: 0,
  dt: 0,
  beat: 'trigger',
  beatProgress: 0, // 0-1 through the current beat

  camera: {
    fov: CAMERA.fov.fall,
    rollDeg: 0,
    dutchTiltDeg: 0,
  },

  color: {
    mixT: 0, // 0 = cool violet-blue (labyrinthBase), 1 = warm gold/white (overflowEnd)
  },

  bloom: {
    intensity: 0.3,
    godRays: 0,
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
    radius: 1, // 1 = fully open onto the scene, 0 = closed (homepage reveal point)
  },

  pointer: {
    x: 0, // normalized -1..1
    y: 0,
    idleSeconds: 0,
  },

  ripple: {
    x: 0,
    y: 0,
    strength: 0, // decays to 0 at rest; interaction.js owns writing this, others may read it
  },

  glyphs: {
    nearestProximity: 1, // 0 = camera is at a glyph, 1 = far from all glyphs; glyphs.js owns writing this
    allResolved: false, // true once every glyph has resolved out of scramble into "404"; glyphs.js owns this
  },

  rackFocus: {
    amount: 0, // 0 = fully sharp/inert DoF, 1 = full rack-focus blur; director.js authors this
    focusDistance: 0.9, // WORLD UNITS (meters) — matches postprocessing's DepthOfFieldEffect
                        // contract (focusDistance is a world-space distance from the camera,
                        // default 3.0, paired with a ~2m focusRange), NOT a normalized 0..1
                        // camera-space fraction. Near foreground wall detail (~0.9m) up to
                        // corridor-ahead (~9m), within the CORRIDOR fogNear/fogFar (4/40) band.
  },

  turnCue: {
    amount: 0, // 0..1, director.js ramps this up a couple seconds before each real corridor
               // turn (per corridor.js's TURN_PLAN) so lighting.js can brighten a "telegraph"
               // cue ahead of the turn — CONCEPT.md Section 3's "light cue ... a few meters
               // ahead" requirement, distinct from the dutch-tilt texture.
  },

  skipRequested: false, // set true by overlay-text.js's skip control; main.js checks this to fast-forward
};

// Derives `beat` and `beatProgress` from clockTime. Called once per frame from main.js,
// before any module's update() runs, so every module sees a consistent beat for this frame.
export function updateBeat() {
  const t = state.clockTime;
  for (const [name, range] of Object.entries(BEATS)) {
    if (t >= range.start && (t < range.end || range.end === BEATS.iris.end)) {
      state.beat = name;
      const span = range.end - range.start;
      state.beatProgress = span > 0 ? Math.min(1, (t - range.start) / span) : 1;
      return;
    }
  }
  state.beat = 'iris';
  state.beatProgress = 1;
}
