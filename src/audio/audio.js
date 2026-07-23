// src/audio/audio.js
//
// Tone.js audio layer for the 404 experience. Builds three synthesized layers —
// a sub-bass riser/freefall whoosh (Act I), a decelerating pulse tone tracking
// state.pulse.bpm (Act II labyrinth), and a warm swell (Act III approach/overflow) —
// and tempo-locks all of them against `state.clockTime` every frame rather than an
// independent Tone.Transport clock, so audio can never drift from the GSAP-driven
// visual timeline (per ARCHITECTURE.md).
//
// initAudio() is safe to call before a user gesture: it only constructs the Tone
// graph and starts buffering/priming; it defers the actual `Tone.start()` (which
// resumes the underlying AudioContext) until it is invoked, but the browser only
// requires that resume call to happen inside a user-gesture handler — this module
// still expects to be *called* from that handler per the contract, and starts
// silently (master volume at -Infinity dB) so nothing is audible until the
// director/timeline actually asks for it via updateAudio().

import * as Tone from 'tone';
import { BEATS, PULSE } from '../config.js';

let masterVolume = null; // Tone.Volume — exported access point for a future mute toggle
let started = false;
let built = false;

// --- Layer 1: sub-bass riser / freefall whoosh -----------------------------
let riserOsc = null; // Tone.Oscillator, sine, falling pitch-bend
let riserGain = null; // Tone.Gain, envelopes riser in/out
let riserFilter = null; // Tone.Filter, low-pass to keep it sub-bass/warm
let riserNoise = null; // Tone.Noise, adds "whoosh" texture to the riser
let riserNoiseGain = null;

// --- Layer 2: decelerating pulse tone (labyrinth heartbeat) ----------------
let pulseOsc = null; // Tone.Oscillator, soft sine "heartbeat" tone
let pulseGain = null; // Tone.Gain, retriggered on each beat of state.pulse.bpm
let pulseFilter = null;
let lastPulseBeatIndex = -1; // tracks which bpm-beat we've already triggered
let pulseBeatPhaseAccumSeconds = 0; // integrates bpm over time since labyrinth start
let lastPulseIntegrationTime = null;

// --- Layer 3: warm swell (approach / overflow) -----------------------------
let swellOsc1 = null; // Tone.Oscillator, warm detuned pair
let swellOsc2 = null;
let swellGain = null;
let swellFilter = null;

const RISER_BASE_FREQ = 220; // Hz, starting pitch of the falling pitch-bend
const RISER_END_FREQ = 30; // Hz, sub-bass floor by end of freefall
const PULSE_TONE_FREQ = 110; // Hz, base pitch of the decelerating pulse
const SWELL_FREQ_1 = 130.81; // C3 — warm swell root
const SWELL_FREQ_2 = 196.0; // G3 — perfect fifth, keeps it consonant/warm

function buildGraph() {
  if (built) return;
  built = true;

  masterVolume = new Tone.Volume(-Infinity).toDestination();

  // --- Riser / freefall whoosh chain ---
  riserFilter = new Tone.Filter({ type: 'lowpass', frequency: 400, Q: 0.7 }).connect(
    masterVolume
  );
  riserGain = new Tone.Gain(0).connect(riserFilter);
  riserOsc = new Tone.Oscillator({ type: 'sine', frequency: RISER_BASE_FREQ }).connect(riserGain);
  riserOsc.start();

  riserNoiseGain = new Tone.Gain(0).connect(riserFilter);
  riserNoise = new Tone.Noise({ type: 'brown' }).connect(riserNoiseGain);
  riserNoise.start();

  // --- Decelerating pulse chain ---
  pulseFilter = new Tone.Filter({ type: 'lowpass', frequency: 900, Q: 0.5 }).connect(
    masterVolume
  );
  pulseGain = new Tone.Gain(0).connect(pulseFilter);
  pulseOsc = new Tone.Oscillator({ type: 'sine', frequency: PULSE_TONE_FREQ }).connect(pulseGain);
  pulseOsc.start();

  // --- Warm swell chain ---
  swellFilter = new Tone.Filter({ type: 'lowpass', frequency: 1200, Q: 0.4 }).connect(
    masterVolume
  );
  swellGain = new Tone.Gain(0).connect(swellFilter);
  swellOsc1 = new Tone.Oscillator({ type: 'sine', frequency: SWELL_FREQ_1 }).connect(swellGain);
  swellOsc2 = new Tone.Oscillator({ type: 'sine', frequency: SWELL_FREQ_2 * 0.999 }).connect(
    swellGain
  ); // slight detune for warmth/beating
  swellOsc1.start();
  swellOsc2.start();
}

/**
 * Must be called from a user-gesture handler (pointerdown/keydown/touchstart).
 * Builds the Tone graph on first call (safe to call earlier too — construction
 * alone produces no sound), then resumes the AudioContext and un-mutes the
 * master bus so updateAudio() can start driving audible levels.
 */
export async function initAudio() {
  buildGraph();
  if (started) return;
  started = true;
  await Tone.start();
  // Bring the master bus up from silence; per-layer gains still start at 0 and
  // are driven up/down by updateAudio() based on the current beat.
  masterVolume.volume.rampTo(-6, 0.5);
}

/** Exposes the master volume node so main.js can wire a mute toggle later. */
export function getMasterVolume() {
  return masterVolume;
}

function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

// Smoothly ramp a Tone Param/Signal toward a target without throwing if the
// audio graph hasn't been built/started yet.
function rampTo(param, value, time = 0.08) {
  if (!param) return;
  param.rampTo(value, time);
}

function updateRiser(state) {
  const t = state.clockTime;
  const dropStart = BEATS.drop.start;
  const freefallEnd = BEATS.freefall.end; // riser fully resolved by "catch"
  const catchEnd = BEATS.catch.end;

  let amp = 0;
  let noiseAmp = 0;
  let freq = RISER_BASE_FREQ;

  if (t >= dropStart && t < freefallEnd) {
    // Act I: drop + freefall — pitch bends down, amplitude front-loaded then
    // sustained (matches CONCEPT.md's "highest at the very start, decaying").
    const span = freefallEnd - dropStart;
    const progress = clamp01((t - dropStart) / span);
    freq = RISER_BASE_FREQ + (RISER_END_FREQ - RISER_BASE_FREQ) * progress;
    // sharp attack, then a gentle decay across freefall
    const attack = clamp01(t / 0.15);
    const decay = 1 - 0.35 * progress;
    amp = attack * decay;
    noiseAmp = attack * (1 - progress) * 0.5;
  } else if (t >= freefallEnd && t < catchEnd) {
    // "The Catch" — riser tail resolves to silence as walking begins.
    const span = catchEnd - freefallEnd;
    const progress = clamp01((t - freefallEnd) / span);
    freq = RISER_END_FREQ;
    amp = (1 - progress) * 0.65;
    noiseAmp = (1 - progress) * 0.15;
  } else {
    amp = 0;
    noiseAmp = 0;
  }

  rampTo(riserOsc.frequency, freq, 0.12);
  rampTo(riserGain.gain, amp * 0.9, 0.1);
  rampTo(riserNoiseGain.gain, noiseAmp * 0.5, 0.1);
}

function updatePulse(state, dt) {
  const labyrinthStart = BEATS.labyrinth.start;
  const labyrinthEnd = BEATS.labyrinth.end;
  const t = state.clockTime;
  const active = t >= labyrinthStart && t < labyrinthEnd;

  if (!active) {
    rampTo(pulseGain.gain, 0, 0.3);
    lastPulseBeatIndex = -1;
    pulseBeatPhaseAccumSeconds = 0;
    lastPulseIntegrationTime = null;
    return;
  }

  // Tempo-lock: integrate elapsed labyrinth time using state.clockTime (not an
  // independent Tone.Transport clock) so the pulse can never drift from the
  // director's timeline, even if updateAudio() is called at a variable rate.
  if (lastPulseIntegrationTime === null) {
    lastPulseIntegrationTime = t;
  }
  const elapsedSinceLast = Math.max(0, t - lastPulseIntegrationTime);
  lastPulseIntegrationTime = t;

  const bpm = state.pulse.bpm || PULSE.bpmStart;
  const beatsPerSecond = bpm / 60;
  pulseBeatPhaseAccumSeconds += elapsedSinceLast * beatsPerSecond;

  const currentBeatIndex = Math.floor(pulseBeatPhaseAccumSeconds);
  if (currentBeatIndex !== lastPulseBeatIndex) {
    lastPulseBeatIndex = currentBeatIndex;
    // Retrigger a soft heartbeat-like pulse: quick swell, gentle decay —
    // envelope duration derived from current tempo so it never overlaps oddly
    // as bpm decelerates from 70 -> 50 across the act.
    const beatDuration = 1 / beatsPerSecond;
    const attackTime = Math.min(0.05, beatDuration * 0.15);
    const releaseTime = Math.min(0.6, beatDuration * 0.8);
    const now = Tone.now();
    pulseGain.gain.cancelScheduledValues(now);
    pulseGain.gain.setValueAtTime(pulseGain.gain.value, now);
    pulseGain.gain.linearRampTo(0.5, attackTime, now);
    // targetRampTo gives an exponential-decay-like approach curve, closer to a
    // natural heartbeat release than a linear ramp.
    pulseGain.gain.targetRampTo(0.001, releaseTime, now + attackTime);
  }

  // Gentle proximity boost: glyph resonance (Section 5) nudges the pulse tone's
  // brightness without retriggering — read-only reaction, never overrides tempo.
  const proximity = state.glyphs ? state.glyphs.nearestProximity : 1;
  const brightness = 900 + (1 - clamp01(proximity)) * 900;
  rampTo(pulseFilter.frequency, brightness, 0.3);
}

function updateSwell(state) {
  const t = state.clockTime;
  const approachStart = BEATS.approach.start;
  const overflowEnd = BEATS.overflow.end;
  const irisEnd = BEATS.iris.end;

  let amp = 0;
  let filterFreq = 1200;

  if (t >= BEATS.turn.start && t < approachStart) {
    // "The Turn" — earliest foreshadow, swell barely audible, fading in.
    const span = approachStart - BEATS.turn.start;
    const progress = clamp01((t - BEATS.turn.start) / span);
    amp = progress * 0.12;
    filterFreq = 600 + progress * 400;
  } else if (t >= approachStart && t < overflowEnd) {
    // Act III proper: ease-out growth (mirrors EASE.overflow / power2.out) —
    // amplitude and brightness climb as the light is neared/overflows.
    const span = overflowEnd - approachStart;
    const progress = clamp01((t - approachStart) / span);
    const eased = 1 - Math.pow(1 - progress, 2); // power2.out
    amp = 0.12 + eased * 0.68;
    filterFreq = 1000 + eased * 3000;
  } else if (t >= overflowEnd && t < irisEnd) {
    // Hold through the iris, then let it settle as the homepage resumes.
    const span = irisEnd - overflowEnd;
    const progress = clamp01((t - overflowEnd) / span);
    amp = 0.8 * (1 - progress * 0.5);
    filterFreq = 4000;
  } else if (t >= irisEnd) {
    amp = 0.3;
    filterFreq = 3000;
  } else {
    amp = 0;
  }

  rampTo(swellGain.gain, amp * 0.7, 0.4);
  rampTo(swellFilter.frequency, filterFreq, 0.4);
}

/**
 * Drive all three audio layers from shared state each frame. Safe to call even
 * before initAudio() has resolved a user gesture (it is a no-op until the Tone
 * graph exists and the context has started, so main.js can wire it into the
 * main loop unconditionally).
 */
export function updateAudio(state, dt) {
  if (!started || !built) return;
  updateRiser(state);
  updatePulse(state, dt);
  updateSwell(state);
}
