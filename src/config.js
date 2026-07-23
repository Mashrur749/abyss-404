// Authoritative constants derived from CONCEPT.md. Every module reads timing/color/motion
// values from here — nothing should be hand-copied or re-derived in individual modules,
// so the experience stays a single source of truth as it's built by multiple contributors.

export const BEATS = {
  trigger:   { start: 0,    end: 0 },
  drop:      { start: 0,    end: 1 },
  freefall:  { start: 1,    end: 4 },
  catch:     { start: 4,    end: 5.5 },
  labyrinth: { start: 5.5,  end: 25 },
  turn:      { start: 25,   end: 28 },
  approach:  { start: 28,   end: 33 },
  overflow:  { start: 33,   end: 36 },
  iris:      { start: 36,   end: 37 },
};

export const TOTAL_DURATION = BEATS.iris.end; // 37s authored timeline; skip affordance can cut it short

export const SKIP_AFFORDANCE_DELAY = 2; // seconds before the skip control is allowed to appear

export const CAMERA = {
  fov: {
    fall: 100,       // Act I wide/fisheye
    catchStart: 100,
    catchEnd: 60,    // narrows as fall becomes walk
    corridor: 60,    // Act II resting FOV
    approach: 70,    // cheats wider as light is neared, Act III
  },
  rollDegrees: { min: 2, max: 4 },       // uncommanded roll during the fall
  dutchTiltDegrees: { min: 1, max: 2 },  // occasional Act II turn tilt
  eyeHeight: 1.6,                        // meters, human eye-level for Act II
  walkStepsPerSecond: 0.9,               // slow, dream-logic cadence (0.8-1 range)
};

export const CORRIDOR = {
  wallHeightMultiplier: 2.75, // relative to eye height: cathedral-aisle tall, not coffin-close
  segmentLength: 12,          // meters, single modular corridor piece
  segmentPoolSize: 10,        // 8-12 recombined segments for the "infinite" illusion
  fogNear: 4,
  fogFar: 40,
};

// Single accent color chosen per CONCEPT.md guidance ("pick one accent, not both, for coherence").
// Amber wins over cyan: warmer accent contrasts more clearly against the cool violet-blue base,
// and gives Act III's violet->gold pivot a color it's already been introducing in miniature.
export const COLOR = {
  voidBase: 0x0a0a14,        // Act I: near-black indigo, never pure black
  labyrinthBase: 0x1a1a3a,   // Act II: cool violet-blue base ~6500K-cold
  labyrinthAccent: 0xffb347, // warm amber glow seams + particulates + 404 glyphs
  overflowStart: 0x2a2050,   // pivot begins here (foreshadow, end of "Turn" beat)
  overflowEnd: 0xfff4d6,     // warm gold/white bloom
  whiteout: 0xffffff,        // final overexposed frame before iris
};

export const PULSE = {
  bpmStart: 70, // Act II opening glow-pulse rate
  bpmEnd: 50,   // decelerates across Act II — biofeedback "you are calming down" illusion
};

export const RIPPLE = {
  fadeDurationSeconds: 1.5, // wake/ripple trail decay-to-baseline (1-2s range)
  idleMirrorDelaySeconds: 3, // no pointer/gyro movement for this long before pulse slows further
};

export const GLYPHS = {
  count: 2, // 1-2 "404" glyph encounters along the fixed path in Act II
  proximityResonanceRadius: 6, // meters, distance at which pulse-sync/brightening begins
};

export const EASE = {
  drop: 'power4.in',       // Act I: sharp ease-in, motion "taking over"
  labyrinth: 'sine.inOut', // Act II: long, gentle, breathing quality
  overflow: 'power2.out',  // Act III: decelerating, symmetric opposite of the drop
};

// Non-negotiables (CONCEPT.md Section on Beat Sheet) encoded as assertions any module can
// import and check against during development — not enforced at runtime in production.
export const NON_NEGOTIABLES = [
  'unicursal-path-only',      // one path, no branching, no failure state
  'single-hard-color-pivot',  // only Act II -> III is a hard palette pivot
  'control-as-instrument',    // Act I strips control, Act II returns a little, Act III strips again
  'symmetric-easing',         // ease-in (drop) mirrors ease-out (overflow)
  'delayed-skip-affordance',  // invisible for first SKIP_AFFORDANCE_DELAY seconds
  'resonance-not-response',   // interaction always decays to baseline, never required to progress
];
