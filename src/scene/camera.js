// src/scene/camera.js
//
// Owns camera FOV / roll / dutch-tilt application, the Act II walk-bob, and the
// simplex-noise-driven micro-drift/sway described in CONCEPT.md Section 3.
//
// IMPORTANT — ownership boundary (per ARCHITECTURE.md): this module does NOT set
// camera.position along the corridor path; that is corridor.js's job (it drives the
// rig position/lookAt from the spline). Because main.js's fixed update order runs
// `camera` BEFORE `corridor` each frame, any positional offset this module wrote onto
// camera.position would simply be overwritten a moment later by corridor.js's
// position/lookAt assignment anyway. So every perturbation this module owns —
// including the "walk-bob" — is realized purely as *orientation* (rotation) and *FOV*
// perturbation layered on top of whatever position corridor.js sets afterward, never
// as a translation. This keeps the two modules' responsibilities non-overlapping
// regardless of call order, and is the one deviation worth flagging explicitly: the
// walk-bob is a felt cadence in pitch/roll + a tiny synchronized FOV "breath" rather
// than a literal vertical position bob, since position is off-limits here.

import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { CAMERA } from '../config.js';

const DEG2RAD = THREE.MathUtils.degToRad;

// Amplitude tuning for the subliminal drift/sway (CONCEPT.md: "very slow,
// almost-subliminal camera drift/sway (like breathing)"). Kept intentionally small —
// this must read as texture, never as a competing motion against corridor.js's path.
const DRIFT_YAW_AMPLITUDE_DEG = 0.35;
const DRIFT_PITCH_AMPLITUDE_DEG = 0.22;
const DRIFT_ROLL_AMPLITUDE_DEG = 0.18;
const DRIFT_FREQUENCY = 0.06; // Hz-ish rate the noise field is sampled at — slow, breath-like

// Walk-bob tuning. Expressed as pitch (vertical "footfall" nod) and a faint roll sway
// (weight shifting step to step), plus a paired FOV micro-breath so the sense of a
// footstep isn't purely rotational. All amplitudes stay small per the "never surprise
// the inner ear" guidance in CONCEPT.md Section 3.
const WALK_BOB_PITCH_DEG = 0.5;
const WALK_BOB_ROLL_DEG = 0.35;
const WALK_BOB_FOV_AMPLITUDE = 0.6; // degrees added/subtracted from state.camera.fov

// Mouse-parallax / gyro-tilt camera sway (CONCEPT.md Section 3, Act II bullet 4: "Optional
// light interactivity here (mouse-parallax or gyroscope tilt on mobile) — small-magnitude,
// heavily damped — gives the user agency"; Section 5's beat-sheet row 4 names "parallax/gyro
// tilt" as one of the three Act II interaction outputs, alongside the ripple trail and glyph
// resonance already wired elsewhere). state.pointer.x/y (normalized -1..1, already smoothed by
// interaction.js) is read here and mapped to a small yaw/pitch offset — heavily damped again on
// top of that smoothing so the camera visibly-but-gently leans toward wherever the user is
// looking, never enough to compete with or override corridor.js's path-following orientation.
const PARALLAX_YAW_MAX_DEG = 1.6;
const PARALLAX_PITCH_MAX_DEG = 1.0;
const PARALLAX_DAMPING = 2.2; // exponential smoothing rate (Hz-ish) toward the target lean

// A footfall completes a full up-down-up cycle every two steps, so the bob frequency
// is half the step rate for the roll (side to side alternates per step) and a full
// step rate for the pitch nod (down on every footfall).
export function createCamera() {
  const camera = new THREE.PerspectiveCamera(
    CAMERA.fov.fall,
    window.innerWidth / window.innerHeight,
    0.05,
    200
  );
  camera.position.set(0, CAMERA.eyeHeight, 0);
  camera.rotation.order = 'YXZ'; // yaw (drift) - pitch (bob/drift) - roll (tilt/sway), stable composition

  return camera;
}

// Two independent noise fields so yaw/pitch/roll drift don't visibly correlate with
// each other (would read as mechanical circular motion instead of organic sway).
const noiseA = createNoise2D();
const noiseB = createNoise2D();
const noiseC = createNoise2D();

let lastFov = null;

// Current damped parallax lean, smoothed independently of interaction.js's own pointer
// smoothing so the camera's response reads as its own soft, heavily-damped agency layer.
let parallaxYawRad = 0;
let parallaxPitchRad = 0;

// --- Integration note (resolved during the main.js integration pass) ---------------
// corridor.js supplies a base facing direction via `{ position, lookAt }`; main.js
// applies `camera.position.copy(position)` + `camera.lookAt(lookAt)` BEFORE calling
// updateCamera() each frame (order: corridor -> camera, the reverse of the
// originally-drafted "camera -> corridor" order, precisely to avoid the lookAt-
// overwrite hazard flagged in this module's original handoff notes). `camera.lookAt()`
// establishes a base rotation.x/rotation.y (with rotation.z == 0, since lookAt never
// rolls the camera). This function therefore ADDS its roll/pitch/yaw perturbations to
// whatever base rotation is already on the camera when it runs, rather than assigning
// absolute rotation values — preserving corridor.js's path-following orientation while
// still layering camera.js's own orientation/FOV texture on top, per the "orientation/
// FOV perturbation on top of" ownership boundary in ARCHITECTURE.md.
export function updateCamera(camera, state, dt) {
  // --- FOV -------------------------------------------------------------
  // Director.js writes the eased target into state.camera.fov; this module is the
  // only one that actually touches the THREE camera object for it. A small walk-bob
  // "breath" is layered on top during the labyrinth beat only.
  let fov = state.camera.fov;

  const inLabyrinth = state.beat === 'labyrinth';
  const t = state.clockTime;

  if (inLabyrinth) {
    const stepHz = CAMERA.walkStepsPerSecond;
    const walkPhase = t * stepHz * Math.PI * 2;
    fov += Math.sin(walkPhase) * WALK_BOB_FOV_AMPLITUDE;
  }

  if (fov !== lastFov) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
    lastFov = fov;
  }

  // --- Orientation: roll + dutch-tilt (uncommanded, director-driven) ---------------
  // state.camera.rollDeg (Act I tumble) and state.camera.dutchTiltDeg (Act II turn
  // beats) are both authored by director.js; this module just realizes them as
  // rotation.z, in the same "roll" channel since they never occur in the same beat
  // (roll belongs to drop/freefall, dutch-tilt belongs to labyrinth turns).
  let rollRad = DEG2RAD(state.camera.rollDeg + state.camera.dutchTiltDeg);
  let pitchRad = 0;
  let yawRad = 0;

  // --- Act II walk-bob (orientation-only, see file header for why) ----------------
  if (inLabyrinth) {
    const stepHz = CAMERA.walkStepsPerSecond;
    const pitchPhase = t * stepHz * Math.PI * 2;
    // Roll sways at half the pitch frequency — one full weight-shift left/right per
    // two footfalls, the natural asymmetry of a walk cycle rather than a symmetric nod.
    const rollPhase = t * stepHz * Math.PI;

    pitchRad += DEG2RAD(Math.sin(pitchPhase) * WALK_BOB_PITCH_DEG);
    rollRad += DEG2RAD(Math.sin(rollPhase) * WALK_BOB_ROLL_DEG);
  }

  // --- Simplex-noise-driven micro-drift/sway (labyrinth only) ---------------------
  // "a very slow, almost-subliminal camera drift/sway (like breathing)" — CONCEPT.md
  // Section 3. Sampled by state.clockTime per the architecture contract, at a slow
  // rate so it never reads as jitter, only as a living, breathing stillness.
  if (inLabyrinth) {
    const n = t * DRIFT_FREQUENCY;
    const driftYaw = noiseA(n, 0);
    const driftPitch = noiseB(n, 0);
    const driftRoll = noiseC(n, 0);

    yawRad += DEG2RAD(driftYaw * DRIFT_YAW_AMPLITUDE_DEG);
    pitchRad += DEG2RAD(driftPitch * DRIFT_PITCH_AMPLITUDE_DEG);
    rollRad += DEG2RAD(driftRoll * DRIFT_ROLL_AMPLITUDE_DEG);
  }

  // --- Mouse-parallax / gyro-tilt sway (labyrinth only) ---------------------------
  // CONCEPT.md Section 3: "Optional light interactivity here (mouse-parallax or
  // gyroscope tilt on mobile) — small-magnitude, heavily damped — gives the user
  // agency". interaction.js already tracks + smooths state.pointer.x/y (normalized
  // -1..1) but never writes camera orientation itself (that would cross the module
  // ownership boundary) — this is the read side that was missing. Damped again here
  // (on top of interaction.js's own smoothing) so the lean arrives softly rather than
  // snapping to the raw pointer signal, matching "heavily damped" in the concept doc.
  const target = inLabyrinth ? state.pointer : { x: 0, y: 0 };
  const parallaxLerp = 1 - Math.exp(-PARALLAX_DAMPING * dt);
  const targetYaw = DEG2RAD(-target.x * PARALLAX_YAW_MAX_DEG);
  const targetPitch = DEG2RAD(target.y * PARALLAX_PITCH_MAX_DEG);
  parallaxYawRad += (targetYaw - parallaxYawRad) * parallaxLerp;
  parallaxPitchRad += (targetPitch - parallaxPitchRad) * parallaxLerp;
  yawRad += parallaxYawRad;
  pitchRad += parallaxPitchRad;

  // Compose onto whatever base orientation corridor.js's camera.lookAt() already
  // established this frame (see integration note above) rather than assigning
  // absolute values, so the path-following facing direction survives.
  camera.rotation.z += rollRad;
  camera.rotation.x += pitchRad;
  camera.rotation.y += yawRad;
}
