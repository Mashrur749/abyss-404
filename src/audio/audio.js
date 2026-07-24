// src/audio/audio.js
//
// v2.2 MAJOR ADAPT — ONE continuous ambient drone/texture layer, active from t=0 through the
// Act III swell, rather than three independently-switched-on layers (v2.1's riser / pulse /
// swell). Feedback this responds to: "audio shouldn't be just at the end... start from the start
// in the slightest possible way, then create audible interest as it moves forward (no music
// anywhere)." Per ARCHITECTURE.md/CONCEPT.md's v2.2 REVISION item 6, this is explicit user
// feedback, not a style preference to balance against anything else: NO melodic or harmonic
// content, ever. Every sound source in this file is either filtered noise, a sub-bass drone
// (deliberately kept below/at the edge of pitch discrimination, never a tuned note or interval),
// or gated/granular noise texture — nothing here plays a scale, a chord, or an interval.
//
// The old riser/pulse/swell are not gone conceptually — they're now three STAGES of a single
// continuous gain/texture curve (see `ambientGain()` below), keyed off config.js's new AUDIO
// constants (`ambientStartGain` at t=0 -> `ambientPeakGain` at the Act III overflow swell):
//   - Stage "drop/freefall/catch" (fall-in): the curve's front-loaded intensity spike — sub-bass
//     rumble + noise whoosh, front-loaded then decaying, same "highest at the very start" feel v1
//     had, just no longer a separate switched-on layer — it's this curve's opening few seconds.
//   - Stage "traverse": the curve's slow middle build. `AUDIO.traverseGrainDensity` ramps a
//     granular noise-gate rate across `state.traverse.elapsedSeconds` (real wall-clock time
//     in-phase, consistent with every other elapsed-time-driven cosmetic in this codebase, e.g.
//     PULSE/rackFocus/turnCue) — "create audible interest as it moves forward."
//   - Stage "turn/approach/overflow/iris" (return): the curve's peak — sub-bass + filtered-noise
//     swell reaching `AUDIO.ambientPeakGain`, mirroring EASE.overflow's power2.out deceleration
//     visually and audibly at once.
//
// Bidirectional-scroll handling: state.traverse.progress can now move backward (scroll.js,
// v2.2). This module derives its own smoothed direction signal locally (a frame-to-frame delta
// of state.traverse.progress, exponentially smoothed) rather than assuming scroll.js exposes a
// velocity/direction field on shared state (it doesn't — see state.js's traverse block) or
// depending on scroll.js's internal implementation. The smoothed signal only ever nudges the
// grain texture's brightness/density subtly — it never yanks the master ambient gain curve up or
// down on a direction change, so backward scroll never whiplashes the overall loudness.
//
// initAudio() is safe to call before a user gesture: it only constructs the Tone graph and starts
// buffering/priming; it defers the actual `Tone.start()` (which resumes the underlying
// AudioContext) until invoked, but the browser only requires that resume call to happen inside a
// user-gesture handler — this module still expects to be *called* from that handler per the
// contract, and starts silently (master volume at -Infinity dB) so nothing is audible until the
// director/timeline actually asks for it via updateAudio().

import * as Tone from 'tone';
import { BEATS, RETURN_TOTAL_DURATION, AUDIO, SCROLL } from '../config.js';

let masterVolume = null; // Tone.Volume — exported access point for a future mute toggle
let started = false;
let built = false;

// --- Sub-bass drone (front-loaded fall-in rumble -> low idle presence -> Act III swell) --------
// Deliberately kept as a single very-low-frequency sine "rumble," swept only within a sub-bass
// range where it reads as pressure/weight rather than a discernible pitch — never a melodic
// figure, never combined with a second, harmonically-related oscillator (no intervals, no chords).
let subOsc = null; // Tone.Oscillator, sine, sub-bass only
let subGain = null; // Tone.Gain
let subFilter = null; // Tone.Filter, low-pass, keeps it sub/warm, never lets harmonics brighten into "tone"

// --- Filtered noise bed (the continuous texture/drone, present start to finish) -----------------
let noiseBed = null; // Tone.Noise ('brown'), the void's constant "air"
let noiseBedGain = null;
let noiseBedFilter = null; // Tone.Filter, low-pass, brightness ramps as the piece builds

// --- Granular texture (traverse-phase "audible interest builds as it moves forward") ------------
// Synthesized granular effect (no sample asset / GrainPlayer buffer needed): a second, brighter
// noise source is amplitude-gated by an LFO whose rate IS the grain density, so "grain density"
// audibly means "how often short noise grains fire," a texture technique, not a melodic one.
let grainNoise = null; // Tone.Noise ('pink'), brighter/grittier than the sub-bed
let grainGateGain = null; // Tone.Gain, driven by grainLFO's output (0..1) times an envelope amount
let grainFilter = null; // Tone.Filter, band-ish coloration, brightens slightly with direction cue
let grainLFO = null; // Tone.LFO, its frequency IS the grain rate (Hz "grains per second")

const SUB_BASE_FREQ = 42; // Hz — sub-bass floor, always inaudible-as-pitch, felt more than heard
const SUB_DROP_PEAK_FREQ = 85; // Hz — brief upward sweep at the very start of the drop (the "whoosh" cue), still sub-range
const GRAIN_MIN_RATE_HZ = 2.2; // slow, sparse grains at the traverse's start
const GRAIN_MAX_RATE_HZ = 11; // busier, denser grain texture by traverseGrainDensity.end

function buildGraph() {
  if (built) return;
  built = true;

  masterVolume = new Tone.Volume(-Infinity).toDestination();

  // --- Sub-bass drone chain ---
  subFilter = new Tone.Filter({ type: 'lowpass', frequency: 180, Q: 0.5 }).connect(masterVolume);
  subGain = new Tone.Gain(0).connect(subFilter);
  subOsc = new Tone.Oscillator({ type: 'sine', frequency: SUB_BASE_FREQ }).connect(subGain);
  subOsc.start();

  // --- Filtered noise bed chain ---
  noiseBedFilter = new Tone.Filter({ type: 'lowpass', frequency: 500, Q: 0.6 }).connect(
    masterVolume
  );
  noiseBedGain = new Tone.Gain(0).connect(noiseBedFilter);
  noiseBed = new Tone.Noise({ type: 'brown' }).connect(noiseBedGain);
  noiseBed.start();

  // --- Granular texture chain ---
  grainFilter = new Tone.Filter({ type: 'bandpass', frequency: 1400, Q: 0.9 }).connect(
    masterVolume
  );
  grainGateGain = new Tone.Gain(0).connect(grainFilter);
  grainNoise = new Tone.Noise({ type: 'pink' }).connect(grainGateGain);
  grainNoise.start();

  // LFO drives the gate gain's amplitude between 0 and 1 at `frequency` Hz — that rate is the
  // audible "grain density." Sine shape keeps each grain a soft swell rather than a hard
  // click/pulse, so it still reads as granular texture, not a rhythmic/melodic pulse.
  grainLFO = new Tone.LFO({ type: 'sine', frequency: GRAIN_MIN_RATE_HZ, min: 0, max: 1 });
  grainLFO.connect(grainGateGain.gain);
  grainLFO.start();
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
  // are driven up/down by updateAudio() based on the continuous ambient curve.
  masterVolume.volume.rampTo(-6, 0.5);
}

/** Exposes the master volume node so main.js can wire a mute toggle later. */
export function getMasterVolume() {
  return masterVolume;
}

function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

function lerp(a, b, t) {
  return a + (b - a) * clamp01(t);
}

// Smoothly ramp a Tone Param/Signal toward a target without throwing if the
// audio graph hasn't been built/started yet.
function rampTo(param, value, time = 0.08) {
  if (!param) return;
  param.rampTo(value, time);
}

// --- Direction smoothing (bidirectional-scroll safety) ------------------------------------------
// Tracks state.traverse.progress frame-to-frame to derive a smoothed -1..1 direction signal,
// entirely locally — never assumes scroll.js exposes a velocity/direction field on shared state.
// Exponentially smoothed so a user rapidly reversing scroll direction (e.g. jittering right at a
// dialogue trigger's hysteresis point, or just flicking back and forth) never yanks the texture
// layer around; it eases toward the new direction over roughly a third of a second.
let lastTraverseProgress = null;
let smoothedDirection = 0; // -1 (backward) .. +1 (forward)
const DIRECTION_SMOOTHING_TIME_CONSTANT = 0.35; // seconds

function updateDirectionSignal(state, dt) {
  const p = state.traverse.progress;
  if (lastTraverseProgress === null) {
    lastTraverseProgress = p;
    return;
  }
  const rawDelta = p - lastTraverseProgress;
  lastTraverseProgress = p;

  // Normalize: any nonzero forward delta -> +1 target, any nonzero backward delta -> -1 target,
  // no movement this frame -> relax toward 0 (neither cue). This keeps the *rate* of movement
  // out of it deliberately (rate is already the ambient build's job via elapsedSeconds/grain
  // density) — this signal is purely "which way, smoothed," a gentle textural coloration only.
  let target = 0;
  if (rawDelta > 1e-6) target = 1;
  else if (rawDelta < -1e-6) target = -1;

  const alpha = dt > 0 ? 1 - Math.exp(-dt / DIRECTION_SMOOTHING_TIME_CONSTANT) : 0;
  smoothedDirection += (target - smoothedDirection) * alpha;
}

// --- The one continuous ambient curve -----------------------------------------------------------
// Returns { gain, stage, stageProgress } — a single 0..1-mapped position through the WHOLE piece
// (fall-in -> traverse -> return), monotonic by construction along the piece's own beat sequence
// (each stage's local progress is itself monotonic even though state.traverse.progress can
// wobble backward within the traverse stage — see the traverse branch below for how that's kept
// smooth rather than see-sawing the master gain).
const FALL_IN_TOTAL = BEATS.catch.end; // seconds, drop+freefall+catch combined

function ambientCurve(state) {
  const beat = state.beat;

  if (beat === 'drop' || beat === 'freefall' || beat === 'catch') {
    const stageProgress = clamp01(state.clockTime / FALL_IN_TOTAL);
    // Fall-in occupies roughly the first slice of the overall build — starts at
    // ambientStartGain, climbs partway (not all the way) by the time traverse begins, since most
    // of the "build" is still ahead in the traverse/return stages.
    const fallInCeiling = lerp(AUDIO.ambientStartGain, AUDIO.ambientPeakGain, 0.28);
    const gain = lerp(AUDIO.ambientStartGain, fallInCeiling, stageProgress);
    return { gain, stage: beat, stageProgress };
  }

  if (beat === 'traverse') {
    // Bidirectional-scroll safety: drive the ambient build off state.traverse.elapsedSeconds
    // (real wall-clock time in-phase, ALWAYS increases regardless of scroll direction — same
    // field PULSE/rackFocus/turnCue already key off, per ARCHITECTURE.md's note on why this
    // specific field is the one safe "how far along, cosmetically" signal in this phase) rather
    // than state.traverse.progress (which can now decrease on backward scroll). This is what
    // guarantees the master ambient gain never dips just because the user scrolled backward for
    // a moment — it only ever eases forward, exactly like the fall-in/return stages, and never
    // whiplashes on a direction change.
    const elapsed = state.traverse.elapsedSeconds;
    const stageProgress = clamp01(elapsed / SCROLL.pulseReferenceDuration);
    const fallInCeiling = lerp(AUDIO.ambientStartGain, AUDIO.ambientPeakGain, 0.28);
    // Traverse climbs from where fall-in left off up to just short of the return's peak, leaving
    // headroom for the Act III swell to still read as the climactic top of the curve.
    const traverseCeiling = lerp(AUDIO.ambientStartGain, AUDIO.ambientPeakGain, 0.72);
    const gain = lerp(fallInCeiling, traverseCeiling, stageProgress);
    return { gain, stage: 'traverse', stageProgress };
  }

  // Return phase: turn -> approach -> overflow -> iris, driven by state.actIII.clockTime via the
  // beat/beatProgress pair state.js's updateBeat() already derives (same interface every other
  // consumer of this phase reads, per ARCHITECTURE.md) — reaches ambientPeakGain during overflow.
  const order = ['turn', 'approach', 'overflow', 'iris'];
  const idx = Math.max(0, order.indexOf(beat));
  let accDuration = 0;
  for (let i = 0; i < idx; i += 1) accDuration += BEATS[order[i]].duration;
  const elapsedInReturn = accDuration + clamp01(state.beatProgress) * BEATS[beat].duration;
  const stageProgress = clamp01(elapsedInReturn / RETURN_TOTAL_DURATION);
  const traverseCeiling = lerp(AUDIO.ambientStartGain, AUDIO.ambientPeakGain, 0.72);

  // power2.out — mirrors EASE.overflow, so the audible swell and the visual bloom accelerate
  // together (CONCEPT.md Section 3: "sound and motion synced").
  const eased = 1 - Math.pow(1 - stageProgress, 2);
  let gain = lerp(traverseCeiling, AUDIO.ambientPeakGain, eased);
  // Iris: let the peak hold, then ease down slightly as the homepage resumes authority — a soft
  // landing rather than a hard cut, echoing the visual cross-dissolve.
  if (beat === 'iris') {
    gain = AUDIO.ambientPeakGain * (1 - clamp01(state.beatProgress) * 0.45);
  }
  return { gain, stage: beat, stageProgress };
}

// --- Stage-specific texture shaping (sub-bass drone + noise bed + grain) ------------------------

function updateSubDrone(state, curve) {
  const beat = state.beat;
  let freq = SUB_BASE_FREQ;
  let ampMul = 1;

  if (beat === 'drop' || beat === 'freefall') {
    // Front-loaded rumble: brief upward pressure-sweep at the very start (the "drop" cue), then
    // settle back down — CONCEPT.md's "front-loaded intensity, not sustained," expressed as a
    // sub-bass sweep rather than a falling melodic pitch-bend (no melody, ever).
    const span = BEATS.freefall.end - BEATS.drop.start;
    const p = clamp01(state.clockTime / span);
    freq = lerp(SUB_DROP_PEAK_FREQ, SUB_BASE_FREQ, p);
    ampMul = lerp(1.3, 0.85, p);
  } else if (beat === 'catch') {
    ampMul = 0.7;
  } else if (beat === 'traverse') {
    ampMul = 0.55; // a felt, low presence under the traverse — never dominant, never a "note"
  } else {
    // Return phase: sub weight grows again as part of the overflow swell.
    ampMul = 0.6 + clamp01(curve.stageProgress) * 0.8;
  }

  rampTo(subOsc.frequency, freq, 0.15);
  rampTo(subGain.gain, curve.gain * ampMul, 0.15);
}

function updateNoiseBed(state, curve) {
  const beat = state.beat;
  // Brightness (low-pass cutoff) climbs gently across the whole piece — one continuous curve,
  // not a per-stage switch — reinforcing "create audible interest as it moves forward" purely
  // through timbral evolution of the SAME noise source, never a new melodic element.
  let brightness = 450;
  if (beat === 'drop' || beat === 'freefall' || beat === 'catch') {
    brightness = 350 + curve.stageProgress * 250;
  } else if (beat === 'traverse') {
    brightness = 600 + curve.stageProgress * 900;
  } else {
    brightness = 1500 + curve.stageProgress * 2500;
  }
  rampTo(noiseBedFilter.frequency, brightness, 0.4);
  rampTo(noiseBedGain.gain, curve.gain * 0.8, 0.15);
}

function updateGrainTexture(state, curve, dt) {
  updateDirectionSignal(state, dt);

  const beat = state.beat;
  let rate = GRAIN_MIN_RATE_HZ;
  let envAmount = 0; // how much the grain layer contributes to overall gain right now

  if (beat === 'traverse') {
    // Ramp AUDIO.traverseGrainDensity across state.traverse.elapsedSeconds (real wall-clock time
    // in-phase — never traverse.progress, so a slow scroller and a fast scroller alike still feel
    // the same grain-density build-up, and a backward-scrolling user never "un-ramps" it, matching
    // the same elapsedSeconds contract PULSE/rackFocus/turnCue already rely on).
    const densityT = clamp01(state.traverse.elapsedSeconds / SCROLL.pulseReferenceDuration);
    const density = lerp(AUDIO.traverseGrainDensity.start, AUDIO.traverseGrainDensity.end, densityT);
    rate = lerp(GRAIN_MIN_RATE_HZ, GRAIN_MAX_RATE_HZ, density);
    envAmount = 0.5 + density * 0.35;
  } else if (beat === 'approach' || beat === 'overflow') {
    // Grain thins out as the return phase's smoother swell takes over — texture yields to the
    // more sustained overflow drone rather than staying busy under a "generosity" beat.
    rate = GRAIN_MAX_RATE_HZ * 0.4;
    envAmount = 0.25 * (1 - curve.stageProgress * 0.6);
  } else if (beat === 'turn' || beat === 'iris') {
    rate = GRAIN_MIN_RATE_HZ;
    envAmount = 0.15;
  } else {
    // Fall-in: a sparse, subtle grain presence from the very first frame — "start from the start
    // in the slightest possible way" applies here too, not just to the master gain.
    rate = GRAIN_MIN_RATE_HZ * 0.6;
    envAmount = 0.12;
  }

  // Bidirectional-scroll coloration: smoothedDirection in [-1, 1] nudges the grain's brightness
  // and rate slightly — moving forward brightens/quickens a touch, moving backward dulls/slows a
  // touch — a tasteful "which way you're drifting" cue, never a loudness jump (envAmount above
  // already excludes direction entirely) and always eased via the smoothing above, so reversing
  // scroll direction repeatedly never produces an audible whiplash.
  const directionBrightnessMul = 1 + smoothedDirection * 0.12;
  const directionRateMul = 1 + smoothedDirection * 0.08;

  rampTo(grainLFO.frequency, Math.max(0.3, rate * directionRateMul), 0.6);
  rampTo(grainFilter.frequency, 1400 * directionBrightnessMul, 0.5);
  // The grain's own gate (0..1, driven by grainLFO directly into grainGateGain.gain) already
  // shapes the moment-to-moment amplitude of each grain; what we control here is its overall
  // envelope ceiling, applied via the noise source's own volume stage so the LFO's 0..1 gate is
  // scaled by (curve.gain * envAmount) rather than fighting the LFO's direct signal connection.
  rampTo(grainNoise.volume, Tone.gainToDb(Math.max(0.0001, curve.gain * envAmount)), 0.25);
}

/**
 * Drive the single continuous ambient layer from shared state each frame. Safe to call even
 * before initAudio() has resolved a user gesture (it is a no-op until the Tone graph exists and
 * the context has started, so main.js can wire it into the main loop unconditionally).
 */
export function updateAudio(state, dt) {
  if (!started || !built) return;

  const curve = ambientCurve(state);
  updateSubDrone(state, curve);
  updateNoiseBed(state, curve);
  updateGrainTexture(state, curve, dt);
}
