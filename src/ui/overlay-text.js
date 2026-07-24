// src/ui/overlay-text.js
//
// Owns the 2D overlay DOM: #title-card, #skip-button, #return-copy, #iris-mask,
// plus the Guiding Orb dialogue (#guide-dialogue, self-injected — see
// initGuideDialogue() below): the original two opening lines (v2.1) and, new in
// v2.2, four more position-triggered lines spread through the traverse (see
// GUIDE_DIALOGUE_AXIS_FRACTIONS below). This module never touches Three.js
// objects — only `state` (read/write state.dialogue.activeIndex) and the DOM
// elements it owns (write). See ARCHITECTURE.md's contract for this file.
//
// v2.21 — THE SPEECH CONTAINER IS RETIRED (see config.js's DIALOGUE_VOICE). The description
// immediately below is kept as history: it records what the `.guide-dialogue-blob` element WAS
// from v2.4 until v2.21, and why. As of v2.21 that element is a bare layout box with no visual
// styling of its own; the copy is lit directly instead. Do not restore any of the treatment
// described below without reading DIALOGUE_VOICE's rationale first.
//
// (HISTORICAL) v2.4 addition — SPEECH BLOBS (config.js's SPEECH_BLOB): each dialogue line's
// text is now wrapped in a purely visual `.guide-dialogue-blob` layer (a
// soft, glowing, translucent, irregular-soft-edged shape — layered box-shadow +
// large asymmetric border-radius, NOT a hard-edged rounded-rectangle chat
// bubble), so the copy reads unambiguously as the orb SPEAKING. This is framing
// only, added around the already-working reveal/hold/re-arm machinery below —
// it does not touch SplitText targets, motion characters, hold-duration fitting,
// or the re-arm hysteresis logic in any way (the blob wrapper is transparent to
// all of that; only buildGuideDialogueLine()'s DOM shape and
// applyGuideDialogueStyles()'s static styling changed to add it).
//
// v2.13 — TYPEWRITER REVEAL + CENTERED LAYOUT (MOTION_CHARACTERS below has the full rationale):
// feedback "make the text appeat like a typewriter, centered. remove the bullet point like '.'
// the text should feel like the guiding orb is speaking to the user." Three changes: (1) the
// reveal is now a strict left-to-right, one-character-at-a-time typewriter, replacing the v2.6
// coalescing-from-scatter treatment; (2) the dialogue container is centered (`textAlign: 'center'`
// in applyGuideDialogueStyles); (3) the small glowing "voice marker" dot that used to precede
// each line's text is removed (it read as a stray bullet/leading-punctuation mark once the text
// was centered under it).

import { gsap } from 'gsap';
import { SplitText } from 'gsap/SplitText';
import {
  SKIP_AFFORDANCE_DELAY,
  BEATS,
  GUIDE,
  GUIDE_DIALOGUE_AXIS_FRACTIONS,
  GUIDE_DIALOGUE_MIN_INTERVAL_SECONDS,
  GUIDE_DIALOGUE_MIN_PAUSE_AFTER_REVEAL_SECONDS,
  VORTEX,
  SCROLL,
  DIALOGUE_VOICE,
  HOME_URL,
} from '../config.js';
import { state } from '../state.js';

gsap.registerPlugin(SplitText);

let titleCardEl = null;
let skipButtonEl = null;
let returnCopyEl = null;
let irisMaskEl = null;
let guideDialogueEl = null;
let guideLine1El = null;
let guideLine2El = null;

let titleSplit = null;
let returnSplit = null;
let guideLine1Split = null;
let guideLine2Split = null;

// Internal reveal-state flags so each stagger-reveal / fade only ever fires once.
let titleRevealed = false;
let titleReceded = false;
let returnRevealed = false;
let homeLinkEl = null;
let homeLinkRevealed = false;
let skipVisible = false;
let skipListenerAttached = false;
let guideLine1Revealed = false;
let guideLine2Revealed = false;
let guideDialogueReceded = false;

// Guiding Orb dialogue copy (CONCEPT.md Section 1 / ARCHITECTURE.md's overlay-text.js
// contract) — exact copy, do not paraphrase.
// v2.16 COPY FIX: restored to CONCEPT.md Section 1's exact authored line — the shipped copy had
// silently dropped "That happens —" (the clause that does the actual validating) and left a
// mid-sentence lowercase "it's" reading as a typo on screen.
const GUIDE_LINE_1 = "You're lost. That happens — it's a very human thing.";
const GUIDE_LINE_2 = "Follow me. I'll show you the way.";

// --- v2.2: four more Guiding Orb lines, spread through the traverse -------------------------
// Position-triggered (state.traverse.progress against GUIDE_DIALOGUE_AXIS_FRACTIONS in
// config.js), not time-triggered, so each fires at the same *place* along the fixed path
// regardless of how fast/slow or which direction the user is scrolling when they reach it
// (CONCEPT.md item 5 / ARCHITECTURE.md's overlay-text.js section). Copy keeps the established
// register — positive, accepting, unhurried, genuinely on the user's side, plain confident
// statements rather than instructions — and line index 1 (0.45) is the one that ties into the
// COMPANION_ORBS "you're not alone" sighting theme (ARCHITECTURE.md explicitly asks for at
// least one line to acknowledge "others" being nearby).
//
// Storyteller review (v2.2 retune) caught a real decoupling here: GUIDE_DIALOGUE_AXIS_FRACTIONS
// and COMPANION_ORBS.sightingAxisFractions both live in config.js (hand-authored, not to be
// modified per ARCHITECTURE.md's build contract), and this line's fixed 0.45 trigger sits well
// past the first sighting's own influence window (anchor 0.3, width 0.07 -> fully closed by
// 0.37) — the line was landing well after the visual moment had already receded, not "a little
// after" it as the copy implied. Since neither trigger fraction can be retuned here, the
// compliant fix is at the copy layer: phrase the line as the orb recalling/naming something the
// user has already passed through a beat ago, rather than implying live simultaneity with a
// visual that, by the time this fires, is no longer on screen — honest about the actual timing
// gap instead of asserting a closeness that isn't real.
const TRAVERSE_GUIDE_LINES = [
  "No wrong turns here. There's only forward, and back, and both are fine.",
  "Those others you passed a moment ago — still out there, finding their own way too.",
  "However long this takes you, it's exactly enough.",
  "Almost there now. You can feel it.",
];

// --- v2.13: TYPEWRITER reveal, replacing the v2.6 coalescing-from-scatter treatment ------------
// Feedback: "make the text appear like a typewriter, centered. remove the bullet point like '.'
// the text should feel like the guiding orb is speaking to the user." The old treatment (chars
// arriving from a scattered yPercent/rotateX/blur offset, staggered by a fixed total `amount`)
// read as kinetic-typography art directed at the viewer, not as a voice speaking IN REAL TIME —
// a typewriter reveal (characters appearing strictly left-to-right, one at a time, no flying-in
// motion) is what actually reads as "being spoken/typed live" rather than "assembling itself."
// Each named voice below is now just a TYPING PACE + a per-character fade, not a motion profile —
// `yPercent`/`rotateX`/`blur` are gone from the reveal itself (a real typewriter doesn't fly
// characters in from an offset; they simply appear). The five voices are kept (same names, same
// per-line assignments below) since the pacing variety still carries real character: a hurried
// line should visibly type faster than an unhurried one.
//   settling  — a calm, measured typing pace: "you're lost, that happens."
//   inviting  — a touch quicker, confident: "follow me."
//   reassuring — the slowest, most unhurried pace of the set: lines that ask the user to relax
//               into something ("no wrong turns," "exactly enough").
//   wistful   — a medium, slightly softer pace, evoking looking back over a shoulder: the "those
//               others you passed" callback line.
//   anticipatory — the fastest pace of the set, leaning forward with excitement: "almost there."
const MOTION_CHARACTERS = {
  settling: { charIntervalSeconds: 0.022, charFadeSeconds: 0.07, ease: 'power1.out' },
  inviting: { charIntervalSeconds: 0.02, charFadeSeconds: 0.06, ease: 'power1.out' },
  reassuring: { charIntervalSeconds: 0.026, charFadeSeconds: 0.08, ease: 'power1.out' },
  wistful: { charIntervalSeconds: 0.024, charFadeSeconds: 0.075, ease: 'power1.out' },
  anticipatory: { charIntervalSeconds: 0.016, charFadeSeconds: 0.05, ease: 'power1.out' },
};

// Total reveal time for a voice typing `charCount` characters — the actual wall-clock time from
// the moment a line's reveal starts until its LAST character finishes fading in. Exact (not
// estimated): `charIntervalSeconds` is GSAP's own per-character stagger delay, so a `charCount`-
// character line's last char starts at `(charCount - 1) * charIntervalSeconds` and takes another
// `charFadeSeconds` to finish. `resolveTraverseLineHoldSeconds()` below uses this (with the line's
// REAL character count, not an estimate) as its reveal-completion floor, same role the old fixed
// `duration + stagger.amount` sum played before typing pace made total reveal time length-
// dependent again (correctly so, this time — a typewriter SHOULD take longer for a longer line).

function totalRevealSeconds(character, charCount) {
  return Math.max(0, charCount - 1) * character.charIntervalSeconds + character.charFadeSeconds;
}

// Line -> motion-character mapping. Indices for the traverse lines match TRAVERSE_GUIDE_LINES'
// own order/GUIDE_DIALOGUE_AXIS_FRACTIONS; the two opening lines are named directly since they're
// singletons, not array entries.
// v2.22 — the two non-dialogue text elements now type too, so they need their own paces. The
// title card is the SYSTEM's statement, not the orb's: a touch faster and more even, so it reads
// as a machine reporting rather than a voice speaking. The return copy is the slowest thing in the
// piece — the line everything resolves onto.
const TITLE_CHARACTER = { charIntervalSeconds: 0.028, charFadeSeconds: 0.06, ease: 'none' };
const RETURN_CHARACTER = { charIntervalSeconds: 0.042, charFadeSeconds: 0.1, ease: 'power1.out' };

const OPENING_LINE_1_CHARACTER = MOTION_CHARACTERS.settling; // "You're lost. That happens..."
const OPENING_LINE_2_CHARACTER = MOTION_CHARACTERS.inviting; // "Follow me. I'll show you the way."
const TRAVERSE_LINE_CHARACTERS = [
  MOTION_CHARACTERS.reassuring,    // "No wrong turns here..."
  MOTION_CHARACTERS.wistful,       // "Those others you passed a moment ago..."
  MOTION_CHARACTERS.reassuring,    // "However long this takes you, it's exactly enough."
  MOTION_CHARACTERS.anticipatory,  // "Almost there now. You can feel it."
];

// --- v2.3: subtle continuous drift/breathing once a line is fully revealed --------------------
// Feedback: "the text lacks emotion in motion... it needs to be cinematic, flowing" — the v2.2
// treatment went fully static (a fixed resting transform) the instant opacity hit 1, which reads
// as "faded in once" rather than "alive," per ARCHITECTURE.md's explicit ask. A tiny, slow,
// looping y/rotation sway (well under the reveal motion's own travel distance, so it never reads
// as a second reveal) keeps each line perceptibly breathing for as long as it's on screen. Kept as
// one shared helper (not per-character) since the breathing itself is meant to be a near-
// subliminal constant, not another axis of "character" variety — the variety lives in the arrival,
// the breathing is the shared "still alive" signal every line gets once settled.
// v2.6: scaled down alongside MOTION_CHARACTERS' own retuned (much smaller) reveal amplitudes —
// this was already meant to read as "near-subliminal," but at ~2.2/60 (~4%) of the OLD reveal
// amplitude and now ~2.2/14 (~16%) of the new one, it would have become proportionally much more
// prominent relative to the settled pose it's supposed to be a barely-perceptible sway around.
const BREATHE_AMPLITUDE_Y_PERCENT = 0.9;
const BREATHE_AMPLITUDE_ROTATE = 0.25;
const BREATHE_DURATION_SECONDS = 4.2;

/** Starts a slow, looping, decay-free sway on an already-revealed line's chars — killed via the
 * returned tween handle whenever the line is hidden/re-hidden, so it never keeps animating a line
 * nobody can see. Applied on top of the chars' settled reveal transform (yPercent:0, rotateX:0),
 * not instead of it, so it's a gentle breathing offset around rest, not a replacement pose. */
function startBreathing(chars) {
  if (!chars || !chars.length) return null;
  return gsap.to(chars, {
    yPercent: `+=${BREATHE_AMPLITUDE_Y_PERCENT}`,
    rotateX: `+=${BREATHE_AMPLITUDE_ROTATE}`,
    duration: BREATHE_DURATION_SECONDS,
    ease: 'sine.inOut',
    yoyo: true,
    repeat: -1,
    stagger: { each: 0.15, from: 'random' },
  });
}

/** Stops a breathing tween started above and restores the chars to their exact settled resting
 * transform (yPercent:0, rotateX:0) so a line that's mid-sway when it's hidden doesn't leave its
 * chars parked at an off-rest offset for whenever it's next revealed. */
function stopBreathing(tween, chars) {
  if (tween) tween.kill();
  if (chars && chars.length) {
    gsap.set(chars, { yPercent: 0, rotateX: 0 });
  }
}


// Hysteresis margin (as a fraction of traverse progress, same 0..1 units as
// GUIDE_DIALOGUE_AXIS_FRACTIONS/state.traverse.progress) a line's trigger position must be
// vacated by before it's allowed to re-arm. Bidirectional scroll (v2.2) means a user can sit
// right at a trigger fraction and jitter across it on scroll noise alone — without a margin
// that would machine-gun the same line on/off every frame. Re-arm is a deliberate design
// choice (ARCHITECTURE.md: "reinforces the living quality... rather than feeling like a
// one-shot script") — a user who scrolls back well past a line's position and re-approaches it
// forward hears it again, same as if the orb is genuinely remarking on where they are, not
// reciting a script that already played once.
const DIALOGUE_REARM_HYSTERESIS = 0.035;

// Per-line runtime tracking, parallel array to TRAVERSE_GUIDE_LINES/GUIDE_DIALOGUE_AXIS_FRACTIONS.
// armed: true when this line is eligible to fire (progress hasn't yet crossed its trigger this
//   approach); flips false the instant it fires, and back to true once progress has retreated
//   past (trigger - hysteresis) [approaching forward] or past (trigger + hysteresis) [approaching
//   backward] — i.e. the user has demonstrably left the trigger zone before it re-arms.
// el/split: this line's DOM/SplitText handles, built lazily in initGuideDialogue().
// breatheTween: v2.3 — the currently-running continuous drift/breathing tween for this line's
//   chars (see startBreathing/stopBreathing above), null when the line isn't on screen.
const traverseLineState = GUIDE_DIALOGUE_AXIS_FRACTIONS.map(() => ({
  armed: true,
  revealed: false, // has this line's DOM ever been shown at least once (controls initial reveal vs. re-trigger tween)
  el: null,
  split: null,
  breatheTween: null,
}));

// v2.3 — breathing-tween handles for the two singleton opening lines (parallel to
// guideLine1Split/guideLine2Split, tracked separately since they aren't part of the
// traverseLineState array).
let guideLine1BreatheTween = null;
let guideLine2BreatheTween = null;

// Cinematographer/interaction-designer review (v2.2 retune): the original trigger test only
// checked `distance <= 0.004` against the CURRENT frame's progress — a single-sample proximity
// test, not a crossing test. At fast forward-scroll velocities (SCROLL.MAX_VELOCITY) or under a
// frame hitch (main.js clamps dt to 0.05s, which at max velocity is a large per-frame progress
// delta), a single frame's progress step can be wider than this whole +-0.004 window, stepping
// clean over a trigger fraction without either endpoint ever landing inside it — silently
// skipping that line for the entire pass, contradicting item 5's "lands at the same place
// regardless of scroll speed" promise. Fix: track each line's previous-frame progress and treat
// the trigger as fired if the fraction lies within the CLOSED interval between last frame's and
// this frame's progress (in either direction), in addition to the original tight-epsilon
// proximity check (kept as a cheap fast-path / belt-and-suspenders for the very first frame a
// line is armed, before a previous-progress sample exists).
let previousTraverseProgress = null;

// --- v2.5: dialogue min-interval floor (ARCHITECTURE.md's overlay-text.js contract) -----------
// Feedback: "the texts move too fast... give them room to appear when a user is scrolling
// through fast." resolveTraverseLineHoldSeconds() above already fits how long an ALREADY-SHOWING
// line stays up so it never overlaps the next trigger — but at high scroll speed several trigger
// fractions can be crossed in quick succession, so a line could still be fired, held for barely
// more than its own reveal animation, and cut, one after another, with no genuine room to actually
// be read even though nothing technically overlapped. This is a separate, additive gate in front
// of the existing trigger call: a floor on real wall-clock seconds between the START of one line's
// reveal and the next, independent of how many GUIDE_DIALOGUE_AXIS_FRACTIONS triggers get crossed
// in that window.
//
// secondsSinceLastReveal: accumulates dt every updateOverlayText() call WHILE state.beat ===
//   'traverse' (this whole mechanism is scoped to that one beat), reset to 0 inside
//   fireTraverseLine() whenever a line actually fires (i.e. it always measures real time since the
//   most recent reveal, regardless of source — immediate fire or a pending one being flushed).
// pendingTraverseLineIndex: the one most-recently-crossed trigger index that arrived before the
//   floor had elapsed, null when nothing is queued. Only ever holds the single most recent
//   crossing — a still-newer trigger crossed while one is already pending simply overwrites it
//   (CONCEPT.md: "only the most recent moment is ever queued"), never stacks/queues more than one.
//   v2.5 FIX (kinetic/motion review): also cleared the moment state.beat leaves 'traverse' (e.g. a
//   skip-to-end fired while a line was pending) — see the flush block further down for why an
//   unconditional, beat-agnostic flush was a real bug, not just a defensive no-op.
let secondsSinceLastReveal = GUIDE_DIALOGUE_MIN_INTERVAL_SECONDS; // start "elapsed" so the very first traverse trigger can fire immediately
let pendingTraverseLineIndex = null;

// Tracks which traverse-line index (if any) is the most recently fired/showing one, so
// updateOverlayText knows which element to fade when a new line pre-empts an still-visible one,
// and so state.dialogue.activeIndex can be written/cleared correctly. -1 = none showing.
// Indices here are offset by 2 in state.dialogue.activeIndex-space (0/1 are reserved for the
// original two opening lines) — see the WRITE to state.dialogue.activeIndex below for the exact
// mapping and rationale.
let activeTraverseLineIndex = -1;
let activeLineHideTimer = null;

// How long a traverse dialogue line stays fully visible before fading, once revealed (it must
// recede on its own — nothing here waits for the user to "dismiss" it, same resonance-not-
// response, decay-to-baseline spirit as every other reactive effect in the piece).
// v2.3: this is now the LEISURELY ceiling, not a fixed hold — see resolveTraverseLineHoldSeconds()
// below for the speed-aware fit that replaces the flat constant everywhere it's actually used.
// v2.7: bumped 3.4 -> 4.2 per feedback ("increase the time a little bit for how long the texts
// stays") — this is the ceiling a slow/idle scroller reads at; resolveTraverseLineHoldSeconds()
// still compresses it down for a fast scroller exactly as before, this only raises the comfortable
// upper bound.
const TRAVERSE_LINE_HOLD_SECONDS = 4.2;
const TRAVERSE_LINE_FADE_SECONDS = 0.9;

// --- v2.3: "text is rushing" fix — hold duration scales inversely with scroll speed -----------
// Feedback: "if I keep scrolling it feels like the text is rushing." Root cause: traverse dialogue
// lines are position-triggered but were held for the flat TRAVERSE_LINE_HOLD_SECONDS regardless of
// how fast the user is actually scrolling — at high forward velocity the camera can reach the
// NEXT trigger fraction (or simply feel like it's rushing away from the current line) well before
// a leisurely 3.4s hold+0.9s fade has finished reading, so lines visually compress/overlap.
// Mirrors seeking-orbs.js's own WORST_CASE_DWELL_SECONDS/triggerResolve() pattern (same shape, reused
// rather than reinvented per ARCHITECTURE.md's explicit instruction): a worst-case-speed constant
// derived from SCROLL/VORTEX (used as a fallback before any live speed sample OR next-trigger
// distance exists), a live per-frame speed reading (state.vortex.travelSpeed, already written
// every frame by vortex.js — see postfx.js for the same normalization convention), and a fitted
// duration that only ever SHORTENS the leisurely default as speed rises, never lengthens it for a
// slow/idle scroller (a line that's easy to read at a comfortable pace shouldn't linger
// artificially long just because the user briefly stopped scrolling).
//
// v2.3 FIX (interaction-designer review): the first pass of this fit only normalized against the
// single global MAX_TRAVEL_SPEED constant, interpolating between the leisurely default and the
// hard floor — it never looked at the REAL remaining distance to whichever trigger fraction comes
// next, which is the part of seeking-orbs.js's own dwell-fitting pattern that actually makes its fit
// correct (seeking-orbs.js's triggerResolve() fits against remainingDwellSeconds, a live per-encounter
// estimate of actual remaining distance / current speed). Since
// GUIDE_DIALOGUE_AXIS_FRACTIONS' inter-line gaps aren't uniform (0.23, 0.23, 0.20 of the traverse),
// a hold sized correctly for the two wider gaps at a given speed was provably too long for the
// narrower 0.68->0.88 gap at that same speed — the line could still be fully on-screen (mid-reveal,
// for lines using a slow motion character like `reassuring`) when the pre-empt/cutout branch in
// fireTraverseLine() below fires for the next line, exactly the "rushed/overlapping text" symptom
// this fix exists to eliminate. Fixed by computing the actual distance-in-progress-fraction to the
// NEXT trigger (or the traverse's end, if this is the last line) and fitting the hold against that
// real remaining distance / current speed, falling back to the worst-case constant only when no
// live speed sample exists yet (matching seeking-orbs.js's own fallback contract exactly).
const MAX_TRAVEL_SPEED = VORTEX.travelSpan / SCROLL.minDuration; // meters/sec at the velocity ceiling, same formula seeking-orbs.js/postfx.js use
const TRAVERSE_LINE_HOLD_FLOOR_SECONDS = 1.1; // never compress below this — a hard legibility floor even at max scroll speed
const TRAVERSE_LINE_HOLD_MARGIN_SECONDS = 0.2; // leaves a little headroom below the raw speed-derived fit, same spirit as seeking-orbs.js's HOLD_MARGIN_SECONDS

/**
 * Fits the traverse dialogue's on-screen hold duration to the CURRENT scroll speed
 * (state.vortex.travelSpeed, signed meters/second) AND the real remaining distance (in traverse
 * meters) to whichever trigger fraction the camera is actually approaching NEXT, in the direction
 * of live travel — mirroring seeking-orbs.js's triggerResolve()/remainingDwellSeconds pattern rather
 * than only normalizing against the global velocity ceiling. Direction-aware since scroll is
 * bidirectional: scrolling forward measures the gap to index+1, scrolling backward measures the
 * gap to index-1. At/under a comfortable pace this returns TRAVERSE_LINE_HOLD_SECONDS unchanged
 * (a slow or idle scroller reads every line at its full, intended pace); as speed climbs, or as the
 * gap to the next line narrows, the hold compresses down toward TRAVERSE_LINE_HOLD_FLOOR_SECONDS so
 * a line that's already fading by the time the next one would trigger doesn't visually overlap it.
 */
function resolveTraverseLineHoldSeconds(index) {
  const signedSpeed = state.vortex?.travelSpeed ?? 0;
  const rawSpeed = Math.abs(signedSpeed);
  const speedForFit = rawSpeed > 1e-3 ? rawSpeed : MAX_TRAVEL_SPEED; // no live sample yet -> assume worst case, same fallback contract as seeking-orbs.js

  // v2.3 FIX (interaction-designer review, part 3): "next trigger" must be resolved in the
  // direction of actual travel, not always the numerically-next (higher-fraction) line. Scroll is
  // explicitly bidirectional (a load-bearing non-negotiable, per CONCEPT.md/ARCHITECTURE.md), and
  // when the user is scrolling backward the line the camera is actually approaching is the
  // LOWER-fraction neighbor. Using the higher-fraction gap unconditionally measured a distance/gap
  // with no relationship to the direction of travel at all, undermining the "fits against the REAL
  // remaining distance" guarantee this fix claims for itself. `rawSpeed <= 1e-3` (idle/no sample
  // yet) falls back to the forward-neighbor gap, matching the pre-existing worst-case-speed
  // fallback contract above.
  const thisFraction = GUIDE_DIALOGUE_AXIS_FRACTIONS[index] ?? 1;
  const scrollingBackward = signedSpeed < -1e-3;
  const neighborFraction = scrollingBackward
    ? GUIDE_DIALOGUE_AXIS_FRACTIONS[index - 1] ?? 0
    : GUIDE_DIALOGUE_AXIS_FRACTIONS[index + 1] ?? 1;
  const remainingFraction = Math.max(0, Math.abs(neighborFraction - thisFraction));
  const remainingDistanceMeters = remainingFraction * VORTEX.travelSpan;
  const remainingDwellSeconds = remainingDistanceMeters / Math.max(speedForFit, 0.001);

  // Fit against the tighter of (a) the flat leisurely default and (b) this specific gap's real
  // dwell estimate, same shape as seeking-orbs.js's triggerResolve() — never lengthen past the leisurely
  // default for a slow/idle scroller, only ever shorten it when the real geometry demands it.
  const fitted = Math.min(TRAVERSE_LINE_HOLD_SECONDS, remainingDwellSeconds - TRAVERSE_LINE_HOLD_MARGIN_SECONDS);

  // v2.3 FIX (interaction-designer review, part 2), RETUNED v2.6, RETUNED AGAIN v2.13: even with
  // the real-distance fit above, the flat TRAVERSE_LINE_HOLD_FLOOR_SECONDS can still be shorter
  // than this SPECIFIC line's own true reveal time — since the hold timer and the reveal tween
  // both start on the same frame (see fireTraverseLine below), a hold shorter than the reveal
  // means the fade branch can fire while the line is still mid-type. Two compounding problems
  // fixed here:
  // (1) the floor must be the line's true total reveal time, and (v2.13) a typewriter's total
  //     reveal time is GENUINELY length-dependent (a longer line takes longer to type) — unlike
  //     the old motion-character stagger, which was deliberately made length-INDEPENDENT.
  //     totalRevealSeconds() now takes the line's REAL character count, not an estimate.
  // (2) "floor at the reveal's own duration" only guarantees the fade doesn't start before the
  //     reveal finishes — it allows a PAUSE of exactly zero, which is precisely the "fully render,
  //     pause for a tiny amount, THEN start disappearing" gap feedback called out as jarring. The
  //     floor now reserves a real settled pause on top of the true reveal time
  //     (GUIDE_DIALOGUE_MIN_PAUSE_AFTER_REVEAL_SECONDS), guaranteed regardless of scroll speed.
  const character = TRAVERSE_LINE_CHARACTERS[index] ?? MOTION_CHARACTERS.settling;
  const charCount = TRAVERSE_GUIDE_LINES[index]?.length ?? 0;
  const revealFloor = totalRevealSeconds(character, charCount) + GUIDE_DIALOGUE_MIN_PAUSE_AFTER_REVEAL_SECONDS;

  return Math.max(TRAVERSE_LINE_HOLD_FLOOR_SECONDS, revealFloor, fitted);
}

// Line-1 begins revealing shortly after the title card, not simultaneously with it — a
// holistic story-alignment pass found the two lines firing on the identical frame produced two
// voices making almost the same point at once ("the page isn't here" / "you're lost") rather
// than the orb *responding to* the system's statement, which is what CONCEPT.md Section 1's
// "the first line validates the feeling" framing actually implies (a response presupposes
// something to respond to). This small stagger is the difference between two captions
// competing for attention and one voice handing off to the next.
const GUIDE_LINE_1_DELAY_INTO_DROP = 0.35; // seconds into `drop` before line 1 starts

// Line-2 begins revealing partway into `freefall` — after line 1 has had a beat to read on
// its own — rather than at a fixed absolute clockTime, so both lines stay correctly staggered
// even if BEATS.drop/freefall's exact durations are retuned again later. ARCHITECTURE.md's
// director.js section explicitly allows line 1's reveal to continue briefly into `traverse`
// rather than compressing the copy to fit the shortened ~3.2s fall-in — this module honors that
// by keying the recede off `traverse` progress (mirroring the title card's own recede branch),
// not off a hard fall-in deadline.
const GUIDE_LINE_2_DELAY_INTO_FREEFALL = 0.5; // seconds into `freefall` before line 2 starts

// Tracks the last iris radius we rendered so we only tween the clip-path when
// state.iris.radius actually changes (director.js writes it repeatedly per frame).
let lastIrisRadius = null;
let irisTween = null;

const IRIS_MAX_PERCENT = 150; // fully-open radius, matches overlay.css's resting clip-path
const IRIS_MIN_PERCENT = 0; // fully-closed (collapsed) radius

/**
 * Grabs the DOM elements already present in index.html, splits the two
 * copy blocks into staggerable units, and wires the skip control.
 * Safe to call once, before the main render loop starts.
 */
export function initOverlayText() {
  titleCardEl = document.getElementById('title-card');
  skipButtonEl = document.getElementById('skip-button');
  returnCopyEl = document.getElementById('return-copy');
  irisMaskEl = document.getElementById('iris-mask');

  initGuideDialogue();

  if (titleCardEl) {
    titleSplit = new SplitText(titleCardEl, {
      type: 'chars,words',
      charsClass: 'split-char',
      wordsClass: 'split-word',
    });
    // v2.22: seeded to a plain opacity:0, exactly like the dialogue. The old positional/blur seed
    // belonged to the coalescing treatment this element used to have; a typed character does not
    // arrive from an offset, it simply appears where it was struck.
    gsap.set(titleSplit.chars, { opacity: 0 });
  }

  if (returnCopyEl) {
    returnSplit = new SplitText(returnCopyEl, {
      type: 'chars,words',
      charsClass: 'split-char',
      wordsClass: 'split-word',
    });
    // v2.22: same plain opacity:0 seed as every other text element — see the title card above.
    gsap.set(returnSplit.chars, { opacity: 0 });
  }

  if (skipButtonEl) {
    gsap.set(skipButtonEl, { opacity: 0 });
    if (!skipListenerAttached) {
      skipButtonEl.addEventListener('click', onSkipClick);
      skipListenerAttached = true;
    }
  }

  // v2.16, NEW — the ending's way home. This is a 404 page: after the iris/whiteout climax the
  // user was previously left stranded on a static gold frame with no link anywhere (the skip
  // button — whose own aria-label promises "Skip to homepage" — merely fast-forwards to that
  // same dead end, then fades itself out). A quiet anchor now assembles beneath the return copy
  // once the iris beat settles, completing the piece's actual job: routing a lost visitor
  // onward. Injected here (not index.html) per this module's existing self-injection precedent
  // (#guide-dialogue), styled inline to match #return-copy's warm-ink register.
  homeLinkEl = document.getElementById('home-link');
  if (!homeLinkEl) {
    const host = document.getElementById('overlay') || document.body;
    homeLinkEl = document.createElement('a');
    homeLinkEl.id = 'home-link';
    homeLinkEl.href = HOME_URL;
    homeLinkEl.textContent = 'Take me home →';
    Object.assign(homeLinkEl.style, {
      position: 'absolute',
      top: '68%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      fontFamily: 'var(--overlay-font-type)', // v2.22: the one shared typewriter face
      fontSize: 'clamp(0.8rem, 1.2vw, 0.98rem)',
      letterSpacing: '0.22em',
      textTransform: 'uppercase',
      textDecoration: 'none',
      color: '#241a08',
      borderBottom: '1px solid rgba(36, 26, 8, 0.35)',
      paddingBottom: '0.35em',
      opacity: '0',
      pointerEvents: 'none',
      userSelect: 'none',
      zIndex: '5',
    });
    host.appendChild(homeLinkEl);
  }

  if (irisMaskEl) {
    // state.iris.radius: 1 = fully open onto the scene (mask invisible),
    // 0 = closed (mask fully covers) — see state.js. radius=1 at load must
    // map to the SMALL clip-path circle (mask clipped away to nothing), not
    // IRIS_MAX_PERCENT, or the mask sits fully opaque over the whole scene
    // for the entire runtime.
    gsap.set(irisMaskEl, {
      clipPath: `circle(${IRIS_MIN_PERCENT}% at 50% 50%)`,
    });
    lastIrisRadius = 1;
  }
}

// Seeds a SplitText's chars to their pre-reveal resting state (v2.13: a plain opacity:0 — no
// yPercent/rotateX/blur offset. A real typewriter's characters don't fly in from anywhere, they
// simply appear at their final, resting position the instant they're typed; keeping any positional
// seed here would reintroduce exactly the "assembling from scatter" look the typewriter reveal is
// meant to replace).
function seedCharsForCharacter(chars) {
  gsap.set(chars, { opacity: 0 });
}


/**
 * Self-injects the Guiding Orb's dialogue DOM: the original two opening lines (v2.1 —
 * replaces the removed silhouette shot's opening beat) plus, new in v2.2, four more lines
 * fired at intervals through the traverse (TRAVERSE_GUIDE_LINES/GUIDE_DIALOGUE_AXIS_FRACTIONS).
 * No markup for this exists in index.html; per the existing convention (this file doesn't edit
 * index.html), the element is created and appended the same way the now-deleted
 * src/ui/silhouette.js used to inject #silhouette-figure: `document.createElement`, styled
 * inline, appended into #overlay alongside the other overlay children.
 *
 * Structure mirrors #title-card/#return-copy exactly (one line per child span so each can
 * be SplitText-staggered independently): a `#guide-dialogue` container holding
 * `#guide-line-1`/`#guide-line-2` (the original two) and `#guide-line-traverse-N` (N = 0..3,
 * one per TRAVERSE_GUIDE_LINES entry), each pre-split into chars/words on init. Only one line
 * is ever visible at once (the container itself stays at opacity:1 once first revealed; each
 * individual `.guide-dialogue-line` fades independently) — see updateOverlayText's traverse
 * dialogue branch for the show/hide choreography.
 */
function initGuideDialogue() {
  guideDialogueEl = document.getElementById('guide-dialogue');

  if (!guideDialogueEl) {
    const host = document.getElementById('overlay') || document.body;

    guideDialogueEl = document.createElement('div');
    guideDialogueEl.id = 'guide-dialogue';
    guideDialogueEl.className = 'overlay-text';
    guideDialogueEl.setAttribute('role', 'status');
    guideDialogueEl.setAttribute('aria-live', 'polite');

    guideLine1El = buildGuideDialogueLine('guide-line-1', GUIDE_LINE_1);
    guideLine2El = buildGuideDialogueLine('guide-line-2', GUIDE_LINE_2);

    // v2.16 FIX: the opening lines' LINE elements must start hidden, exactly like the traverse
    // lines below already do. Previously only their CHARS were seeded to opacity 0 — the visible
    // speech-blob wrapper itself rendered at full opacity the moment the container faded in, so
    // line 2's empty glowing blob sat on screen for ~2.3s before its text began typing (and the
    // two stacked empty pills read as a login form, not a voice). Each line's element now fades
    // in only when its own reveal actually starts — see the reveal branches in updateOverlayText.
    gsap.set(guideLine1El, { opacity: 0 });
    gsap.set(guideLine2El, { opacity: 0 });

    guideDialogueEl.appendChild(guideLine1El);
    guideDialogueEl.appendChild(guideLine2El);

    TRAVERSE_GUIDE_LINES.forEach((text, i) => {
      const lineEl = buildGuideDialogueLine(`guide-line-traverse-${i}`, text);
      gsap.set(lineEl, { opacity: 0 }); // each traverse line starts hidden independently — the container's own opacity is a separate, coarser on/off (see applyGuideDialogueStyles)
      guideDialogueEl.appendChild(lineEl);
      traverseLineState[i].el = lineEl;
    });

    applyGuideDialogueStyles(guideDialogueEl);
    host.appendChild(guideDialogueEl);
  } else {
    guideLine1El = document.getElementById('guide-line-1');
    guideLine2El = document.getElementById('guide-line-2');
    TRAVERSE_GUIDE_LINES.forEach((_, i) => {
      traverseLineState[i].el = document.getElementById(`guide-line-traverse-${i}`);
    });
  }

  // SplitText targets each line's `.guide-dialogue-text` child specifically (not the line
  // container itself) — this keeps the stagger-reveal scoped to the actual copy.
  const guideLine1TextEl = guideLine1El?.querySelector('.guide-dialogue-text');
  const guideLine2TextEl = guideLine2El?.querySelector('.guide-dialogue-text');

  if (guideLine1TextEl) {
    guideLine1Split = new SplitText(guideLine1TextEl, {
      type: 'chars,words',
      charsClass: 'split-char',
      wordsClass: 'split-word',
    });
    seedCharsForCharacter(guideLine1Split.chars);
  }

  if (guideLine2TextEl) {
    guideLine2Split = new SplitText(guideLine2TextEl, {
      type: 'chars,words',
      charsClass: 'split-char',
      wordsClass: 'split-word',
    });
    seedCharsForCharacter(guideLine2Split.chars);
  }

  traverseLineState.forEach((lineState, i) => {
    const textEl = lineState.el?.querySelector('.guide-dialogue-text');
    if (!textEl) return;
    lineState.split = new SplitText(textEl, {
      type: 'chars,words',
      charsClass: 'split-char',
      wordsClass: 'split-word',
    });
    seedCharsForCharacter(lineState.split.chars);
  });
}

/**
 * Builds one dialogue line's DOM: a flex row (`.guide-dialogue-line`, the existing
 * opacity/position/animation target — untouched) holding a purely visual
 * `.guide-dialogue-blob` layer (v2.4-v2.21 a glowing speech-blob shape; as of v2.21 a bare layout
 * box with no visual styling — see config.js's DIALOGUE_VOICE), which
 * in turn holds a `.guide-dialogue-text` span carrying the actual copy, which is what SplitText
 * above operates on. The blob wrapper changes nothing about what SplitText targets or how
 * opacity/hold/re-arm timers are applied (still `.guide-dialogue-line`/`.guide-dialogue-text`
 * exactly as before) — it is purely an added inner visual container.
 *
 * v2.13: the marker dot this function used to prepend (a small glowing `.guide-dialogue-marker`
 * span, the "name-tag" that visually tied a line back to the orb) is REMOVED — feedback: "remove
 * the bullet point like '.'" The typewriter reveal (see MOTION_CHARACTERS' header comment) and
 * the centered layout now carry the "the orb is speaking" read on their own; the marker had
 * started reading as a literal bullet-point/list-item glyph rather than a name-tag once the text
 * itself was centered under it.
 */
function buildGuideDialogueLine(id, text) {
  const lineEl = document.createElement('span');
  lineEl.id = id;
  lineEl.className = 'guide-dialogue-line';

  const blob = document.createElement('span');
  blob.className = 'guide-dialogue-blob';

  const textEl = document.createElement('span');
  textEl.className = 'guide-dialogue-text';
  textEl.textContent = text;

  blob.appendChild(textEl);
  lineEl.appendChild(blob);
  return lineEl;
}


// Inline styles only (this module owns no CSS file of its own, same as silhouette.js's
// precedent) — positioned as a second title-card-like line, slightly below #title-card so
// the two don't visually collide during the brief window both are visible.
//
// Deliberately typographically DISTINCT from #title-card (not just spatially offset): the title
// card is the system's own diagnostic statement ("The page you wanted isn't here" — impersonal,
// serif-italic, cool amber glow matching the rest of Act I's palette), while the Guiding Orb's
// lines are a specific character's validating voice (CONCEPT.md Section 1: "the load-bearing
// addition... a companion, not a system prompt"). Sharing near-identical serif-italic styling with
// matching amber text-shadow (the original v2.1 pass) risked the two blurring into one
// undifferentiated block of narration. To keep them legible as two different sources: an upright
// (non-italic) humanist sans rather than the title card's display serif, a warm tint pulled
// directly from GUIDE.color (config.js) rather than the title card's neutral ink.
//
// v2.13: this used to also include a small glowing "voice marker" dot immediately before the
// text (a wordless name-tag tying the line back to the orb). Feedback: "remove the bullet point
// like '.'" — once the text was centered under it (this same round), the dot read as a literal
// list-bullet/leading-punctuation mark rather than a name-tag. Removed; the typewriter reveal
// itself (MOTION_CHARACTERS) now carries the "this is a voice speaking, live" signal instead.
//
// v2.3 CLEARANCE FIX ("the orb is covering some text"): derived the orb's approximate on-screen
// region directly from vortex.js's chase-cam formula (CAMERA.chase: distanceBehind=5m,
// heightAbove=1.1m, lookAheadBeyond=4m — the camera sits behind+above the orb and looks PAST it,
// per chaseCamFromOrb()). Working the geometry (orb position relative to camera vs. the camera's
// look-at target, both expressed in the camera's local tangent/up frame) puts the orb only ~5.4
// degrees below the optical axis — i.e. close to true vertical CENTER of frame, not down near the
// bottom edge (an 18%-of-half-FOV offset at CAMERA.fov.traverse=60 deg is a small fraction of the
// frame). Add the fall-in's parallax (CAMERA.fallInParallax, +-4deg pitch) and the traverse's own
// bank/roll and the orb's own bob/weave (guide.js) on top, and the orb can plausibly render
// anywhere from just-above-center to a good ways below it — i.e. `top: 68%` (this module's old
// value) sits squarely inside that same band, which is the actual root cause of the overlap
// feedback. Fix: move the dialogue well clear of that whole band, down into the lower ~14% of the
// viewport (past where the orb's screen-space region can plausibly extend even with parallax/bank
// stacked on top), and add a soft background scrim behind the text as defense-in-depth so that even
// in the (now much less likely) case of a bright streak or companion orb passing behind the copy,
// legibility doesn't depend on pixel-perfect avoidance.
//
// v2.12 note: CAMERA.chase.distanceBehind was later tightened 5 -> 3.5 ("get the guiding orb a
// little bit closer") — re-verified this puts the orb ~9.1deg below the optical axis (30% of
// half-FOV), still well clear of the reserved bottom ~14% band this fix carves out, so the
// clearance conclusion above still holds; only the exact degree figure is now stale.
function applyGuideDialogueStyles(containerEl) {
  const guideColorHex = `#${GUIDE.color.toString(16).padStart(6, '0')}`;

  Object.assign(containerEl.style, {
    position: 'absolute',
    top: 'auto',
    bottom: '9%',
    left: '50%',
    transform: 'translateX(-50%)',
    maxWidth: 'min(90vw, 40rem)',
    // v2.21: generous padding with NO border-radius. The radius existed to shape a panel; there is
    // no panel now. The padding's only job is to let the legibility pool below extend well past
    // the copy on every side, so the pool's own falloff is never visible as an outline.
    padding: '2.2em 3.5rem 2em',
    // v2.21 — the legibility pool. A wide, soft, SHAPELESS darkening: at 150%/135% spread with the
    // fade complete by 70%, its edge always lands outside the padded box, so there is no point at
    // which the eye can resolve a boundary. This is the one job the retired speech container was
    // actually needed for (keeping copy readable over a bright throat), delivered without
    // introducing an object into a frame where nothing else has an edge.
    // v2.22: NO BACKGROUND AT ALL. The legibility pool is gone too — even at 0.32 and shapeless it
    // was still a darkening the eye could find, and the piece is stronger with the copy simply
    // present in the void. Contrast now lives entirely on the glyphs (see textShadow below), which
    // is also what lets the typewriter reveal read as words being typed into empty space rather
    // than into a reserved area. Do not reintroduce a background here.
    background: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6em',
    // v2.22: the shared typewriter face (overlay.css's --overlay-font-type). Read from the CSS
    // custom property rather than duplicated here, so the whole piece has exactly one place the
    // typeface is authored.
    fontFamily: 'var(--overlay-font-type)',
    fontWeight: '400',
    fontStyle: 'normal',
    fontSize: 'clamp(0.85rem, 1.35vw, 1.1rem)',
    lineHeight: '1.7',
    letterSpacing: '0.05em',
    color: '#f7f2e6',
    textAlign: 'center', // v2.13: feedback "make the text ... centered" — was unset (left, the browser default)
    // v2.21 — THE WORDS ARE THE LIGHT. Two halos in the Guide's own colour (a tight one that makes
    // the glyphs themselves luminous, and a much wider faint one that reads as real falloff),
    // plus a tight dark shadow purely for contrast against a bright throat. This is what carries
    // "the orb is speaking" now that there's no container to carry it — and it matches how every
    // other light in this piece is drawn: a bright core dissolving outward, never an edge.
    textShadow: [
      `0 0 14px ${hexToRgba(guideColorHex, DIALOGUE_VOICE.textGlowOpacity)}`,
      `0 0 38px ${hexToRgba(guideColorHex, DIALOGUE_VOICE.textGlowWideOpacity)}`,
      // Tight, near-opaque contact shadow. With the scrim deliberately too faint to read as a
      // shape, THIS is what actually guarantees legibility against a bright throat — contrast
      // carried by the glyph itself rather than by a panel behind it.
      `0 1px 3px rgba(0, 0, 0, 0.9)`,
      `0 0 6px rgba(0, 0, 0, 0.55)`,
    ].join(', '),
    opacity: '0',
    pointerEvents: 'none',
    userSelect: 'none',
    zIndex: '5',
  });

  // v2.4: `.guide-dialogue-line` stays the exact opacity/position/animation target it always
  // was (fireTraverseLine()/updateOverlayText() above still fade/tween THIS element and read
  // ITS opacity — none of that changed). It's now a plain block wrapper around the new
  // `.guide-dialogue-blob` inner layer rather than the flex row itself; the flex/baseline/gap
  // layout that used to live here moves onto the blob below, since the blob is now what
  // actually arranges/frames the text.
  containerEl.querySelectorAll('.guide-dialogue-line').forEach((el) => {
    Object.assign(el.style, {
      display: 'block',
      willChange: 'transform, opacity',
    });
  });

  // v2.21 — THE SPEECH CONTAINER IS GONE. `.guide-dialogue-blob` survives ONLY as a layout box
  // (it is still what centres the copy and what the traverse-line positioning below targets); it
  // has no background, no border-radius, no box-shadow and no backdrop-filter. See config.js's
  // DIALOGUE_VOICE block for the full reasoning — in short, it was the only element in the piece
  // with a resolvable edge, it read as a disabled search input at any real viewing size, and four
  // prior rounds of softening it never addressed that the object itself was the problem.
  //
  // DO NOT reintroduce any of: background fill, borderRadius, boxShadow, backdrop-filter, or a
  // border on this element. Each of those independently re-creates a silhouette, and a silhouette
  // is precisely what makes it read as UI chrome in a frame where nothing else has one. If copy
  // legibility is ever a problem, widen or deepen the container's shapeless scrim instead
  // (DIALOGUE_VOICE.scrim*) — that solves the same problem without drawing an object.
  containerEl.querySelectorAll('.guide-dialogue-blob').forEach((blob) => {
    Object.assign(blob.style, {
      display: 'block',
      background: 'none',
      border: 'none',
      borderRadius: '0',
      boxShadow: 'none',
      padding: '0',
    });
  });

  // v2.2: the four traverse lines share one on-screen slot (only ever one showing at a time,
  // per updateOverlayText's choreography below) rather than stacking in the flex column with
  // the two opening lines and each other — position them absolutely, layered directly on top
  // of one another, so a fade-out/fade-in handoff between two traverse lines (or the container
  // reusing the same visual position long after the opening two lines have receded) never
  // leaves a gap or a double-height jump in the layout.
  // v2.4: `.guide-dialogue-line` itself is now a plain block wrapper (see above), so centering
  // its child blob horizontally is done via the blob's own `margin: 0 auto` + the blob's
  // `justifyContent` (for the marker/text row inside it), not the line's own justifyContent
  // (which would be inert on a block-level element).
  containerEl.querySelectorAll('.guide-dialogue-line[id^="guide-line-traverse-"]').forEach((el) => {
    Object.assign(el.style, {
      position: 'absolute',
      // v2.21: centred rather than pinned to `top: 0`. An absolutely-positioned child anchors to
      // its containing block's PADDING box, and v2.21 grew that padding substantially (it's what
      // lets the legibility pool extend past the copy). At `top: 0` the traverse lines would now
      // sit well above the pool's own centre — lit copy drifting off its own light. Centring keeps
      // the two aligned no matter how the padding is retuned later.
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: '100%',
      textAlign: 'center', // v2.13: feedback "make the text ... centered" — matters when a line wraps to 2+ lines
    });
    const blob = el.querySelector('.guide-dialogue-blob');
    if (blob) {
      // v2.21: `width: fit-content` is gone with the container it used to size. A full-width block
      // simply centres its own text — and critically, a fit-content box GREW AS THE TYPEWRITER
      // TYPED, which is a large part of what made the old element read as an input field filling
      // up rather than a voice speaking.
      Object.assign(blob.style, {
        margin: '0',
        width: '100%',
      });
    }
  });

}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function onSkipClick() {
  state.skipRequested = true;
}

/**
 * Shows traverse dialogue line `index` (into TRAVERSE_GUIDE_LINES/traverseLineState), hiding
 * whichever traverse line was previously active first if one was. Writes
 * state.dialogue.activeIndex for the duration the line is visible, per ARCHITECTURE.md's
 * overlay-text.js contract ("write state.dialogue.activeIndex while a line is showing, -1 when
 * none are") — this module is the sole owner/writer of this field (lighting.js/vortex.js only
 * optionally READ it per state.js's comment), so there's no shared-write race to reconcile here,
 * but the field's MEANING (which of config.js's GUIDE_DIALOGUE_AXIS_FRACTIONS beats, if any, is
 * currently on screen) must stay exactly what those optional readers expect: the index into
 * GUIDE_DIALOGUE_AXIS_FRACTIONS itself (0..3), not an index into some other combined line list
 * (e.g. it does NOT include the two opening lines, which have no config.js-array position and
 * nothing else needs to sync to).
 */
function fireTraverseLine(index) {
  const lineState = traverseLineState[index];
  if (!lineState?.el || !lineState.split) return;

  const character = TRAVERSE_LINE_CHARACTERS[index] ?? MOTION_CHARACTERS.settling;

  // A different traverse line was showing — cut it out immediately (no cross-fade needed).
  // v2.3 FIX (interaction-designer review): this comment used to claim "the two trigger fractions
  // are spaced far enough apart... that this branch is a defensive guard... rather than something
  // that fires under normal pacing" — false at the documented max scroll speed (MAX_TRAVEL_SPEED
  // above, a real designed ceiling): the smallest inter-line gap (0.68->0.88, 0.20 of the traverse)
  // is crossed in ~1.2s at that speed, well inside the OLD flat 3.4s hold + 0.9s fade window, so
  // this branch genuinely fired under normal fast-scroll pacing, not just as a defensive edge case.
  // resolveTraverseLineHoldSeconds() above is now fitted per-gap against the real remaining
  // distance to the NEXT trigger (mirroring seeking-orbs.js's dwell-fitting pattern), which is what
  // actually keeps this branch a rare guard again rather than a routine cutout — but it's kept
  // regardless, since bidirectional scroll bursts can still, in principle, cross two trigger
  // fractions within a single frame.
  if (activeTraverseLineIndex !== -1 && activeTraverseLineIndex !== index) {
    const prev = traverseLineState[activeTraverseLineIndex];
    if (prev?.el) gsap.to(prev.el, { opacity: 0, duration: 0.3, overwrite: true });
    // v2.3: stop the preempted line's continuous breathing so it doesn't keep animating an
    // invisible element and so its chars are parked at rest for whenever it's shown again.
    if (prev) {
      stopBreathing(prev.breatheTween, prev.split?.chars);
      prev.breatheTween = null;
    }
  }
  if (activeLineHideTimer) {
    clearTimeout(activeLineHideTimer);
    activeLineHideTimer = null;
  }

  // v2.3: stop this line's own breathing before re-revealing it (covers the re-arm path, where
  // a fast back-and-forth could in principle re-fire before a prior breathing tween was cleaned
  // up) so the fresh reveal always starts from a clean, resting transform.
  stopBreathing(lineState.breatheTween, lineState.split.chars);
  lineState.breatheTween = null;

  activeTraverseLineIndex = index;
  state.dialogue.activeIndex = index;

  // v2.5: this line is actually firing right now — reset the min-interval floor's clock so the
  // NEXT trigger (immediate or pending) is measured from this exact moment, not from whenever the
  // previous line fired.
  secondsSinceLastReveal = 0;

  gsap.to(lineState.el, { opacity: 1, duration: 0.01, overwrite: true });

  // First time this exact line has ever shown: run the full typewriter reveal (chars appearing
  // one at a time, left to right — v2.13, see MOTION_CHARACTERS' header comment for why this
  // replaced the old coalescing-from-scatter treatment), using this line's own typing pace. On a
  // re-arm replay (the user revisited this trigger position), the chars are already resting at
  // full opacity from the first reveal — skip re-running the per-char stagger (it would look
  // identical anyway, since GSAP would just re-animate opacity 1 -> 1) and instead do a plain,
  // quicker opacity cross-fade for the line as a whole, which reads as "the orb is saying this
  // again" rather than a second identical typing animation.
  if (!lineState.revealed) {
    lineState.revealed = true;
    gsap.to(lineState.split.chars, {
      opacity: 1,
      duration: character.charFadeSeconds,
      ease: character.ease,
      stagger: { each: character.charIntervalSeconds, from: 'start' },
      onComplete: () => {
        // v2.3: once the line has fully arrived, give it a subtle continuous drift/breathing
        // rather than going static — only if it's still the active line (a fast re-arm/preempt
        // could have already moved on by the time this onComplete fires).
        if (activeTraverseLineIndex === index) {
          lineState.breatheTween = startBreathing(lineState.split.chars);
        }
      },
    });
  } else {
    gsap.fromTo(
      lineState.el,
      { opacity: 0 },
      {
        opacity: 1,
        duration: 0.5,
        ease: 'power2.out',
        overwrite: true,
        onComplete: () => {
          if (activeTraverseLineIndex === index) {
            lineState.breatheTween = startBreathing(lineState.split.chars);
          }
        },
      }
    );
  }

  // "Text is rushing" fix (v2.3): hold duration scales inversely with the CURRENT scroll speed
  // AND the real remaining distance to the next trigger fraction (state.vortex.travelSpeed,
  // written every frame by vortex.js; GUIDE_DIALOGUE_AXIS_FRACTIONS' own per-gap spacing), mirroring
  // seeking-orbs.js's own dwell-time-fitting pattern (a leisurely default, fitted down toward a hard
  // floor as speed/gap-narrowness demand, never fitted UP past the leisurely default for a
  // slow/idle scroller) — see resolveTraverseLineHoldSeconds() above for the full rationale.
  const holdSeconds = resolveTraverseLineHoldSeconds(index);

  // Decay back to baseline on its own after a hold — same resonance-not-response, nothing-stays-
  // "on"-forever spirit as every other reactive effect in this piece (ripple/glow/etc.). Uses a
  // plain setTimeout (not a gsap delayedCall) purely so it can be reliably cleared from the
  // skip-to-end branch above via clearTimeout without needing to hold a handle to a gsap tween
  // that may already have been overwritten.
  activeLineHideTimer = setTimeout(() => {
    gsap.to(lineState.el, { opacity: 0, duration: TRAVERSE_LINE_FADE_SECONDS, ease: 'power1.out' });
    stopBreathing(lineState.breatheTween, lineState.split?.chars);
    lineState.breatheTween = null;
    if (activeTraverseLineIndex === index) {
      activeTraverseLineIndex = -1;
      // Only clear state.dialogue.activeIndex if nothing newer has already claimed it — guards
      // against a pathological rapid-fire re-arm (line fires again before this timer runs) from
      // clobbering the newer line's activeIndex with a stale -1.
      if (state.dialogue.activeIndex === index) {
        state.dialogue.activeIndex = -1;
      }
    }
    activeLineHideTimer = null;
  }, holdSeconds * 1000);
}

/**
 * Per-frame update. Reads `state` (including state.traverse.progress for the v2.2 traverse
 * dialogue triggers) and mutates it in two places: the skip button's click handler (sets
 * state.skipRequested = true) and the traverse dialogue system (writes state.dialogue.activeIndex
 * — the index of config.js's GUIDE_DIALOGUE_AXIS_FRACTIONS beat currently on screen, or -1 when
 * none are; see fireTraverseLine()/the skip-to-end branch above for the two places this is
 * written). This module is the sole writer of state.dialogue.activeIndex — other modules
 * (lighting.js/vortex.js) may only read it, per state.js's comment on that field.
 */
export function updateOverlayText(state, dt) {
  // --- Title card: coalesce from scattered characters at the very first beat -----
  // v2.1: the silhouette beat is gone (removed per playtest feedback — see config.js/
  // state.js). The title card now triggers on 'drop' alone, the new first beat.
  if (!titleRevealed && titleSplit && state.beat === 'drop') {
    titleRevealed = true;
    gsap.to(titleCardEl, { opacity: 1, duration: 0.01 });
    // v2.22: a real typewriter reveal, identical in kind to the orb's dialogue — one character at
    // a time, strictly left to right, each simply appearing. Previously this was a staggered
    // arrival (position + rotation + blur resolving over a fixed total spread); against a
    // monospaced face that read as an effect layered on top of type rather than as typing.
    gsap.to(titleSplit.chars, {
      opacity: 1,
      duration: TITLE_CHARACTER.charFadeSeconds,
      ease: TITLE_CHARACTER.ease,
      stagger: { each: TITLE_CHARACTER.charIntervalSeconds, from: 'start' },
    });
  }

  // --- Guiding Orb dialogue: line 1 assembles shortly after the title card, as a response --
  // Same SplitText "text assembles rather than fades in" treatment as the title card/return
  // copy (CONCEPT.md Section 1: "using the same SplitText-coalescing treatment the title card
  // already uses, so the copy *arrives* rather than just appearing"). Deliberately offset from
  // the title card by GUIDE_LINE_1_DELAY_INTO_DROP rather than firing on the identical frame —
  // see that constant's comment for why simultaneity read as two competing voices rather than
  // one responding to the other. Allowed to fire across drop/freefall/catch (mirrors line 2's
  // defensive multi-beat window) so a retuned or unusually short `drop` beat can't swallow the
  // trigger before the offset threshold is reached.
  if (
    !guideLine1Revealed &&
    guideLine1Split &&
    (state.beat === 'drop' || state.beat === 'freefall' || state.beat === 'catch') &&
    state.clockTime - BEATS.drop.start >= GUIDE_LINE_1_DELAY_INTO_DROP
  ) {
    guideLine1Revealed = true;
    gsap.to(guideDialogueEl, { opacity: 1, duration: 0.01 });
    // v2.16: the line element (and its speech blob) becomes visible only now, as its own text
    // starts typing — never as an empty pill waiting for copy (see the init-time seed comment).
    gsap.to(guideLine1El, { opacity: 1, duration: 0.35, ease: 'power1.out' });
    gsap.to(guideLine1Split.chars, {
      opacity: 1,
      duration: OPENING_LINE_1_CHARACTER.charFadeSeconds,
      ease: OPENING_LINE_1_CHARACTER.ease,
      stagger: { each: OPENING_LINE_1_CHARACTER.charIntervalSeconds, from: 'start' },
      onComplete: () => {
        guideLine1BreatheTween = startBreathing(guideLine1Split.chars);
      },
    });
  }

  // --- Guiding Orb dialogue: line 2 assembles once line 1 has had a beat to read ---------
  // "Follow me. I'll show you the way." per CONCEPT.md Section 1's "first line validates...
  // second line is a plain, confident invitation." Keyed off elapsed time since
  // BEATS.freefall.start (GUIDE_LINE_2_DELAY_INTO_FREEFALL) rather than a one-off hardcoded
  // clockTime, so the stagger stays correctly relative to BEATS.drop/freefall even if their
  // exact durations are retuned again. Allowed to still fire in 'catch'/'traverse' too (guards
  // against a fast skip or an unusually short freefall beat swallowing the threshold).
  if (
    !guideLine2Revealed &&
    guideLine2Split &&
    (state.beat === 'freefall' || state.beat === 'catch' || state.beat === 'traverse') &&
    state.clockTime - BEATS.freefall.start >= GUIDE_LINE_2_DELAY_INTO_FREEFALL
  ) {
    guideLine2Revealed = true;
    // v2.16: same deferred-blob reveal as line 1, and the already-read first line settles back
    // to a supporting weight as the second begins speaking — the exchange reads as one voice
    // moving on, not two captions competing at equal emphasis.
    gsap.to(guideLine2El, { opacity: 1, duration: 0.35, ease: 'power1.out' });
    if (guideLine1El) gsap.to(guideLine1El, { opacity: 0.55, duration: 0.8, ease: 'power1.out' });
    gsap.to(guideLine2Split.chars, {
      opacity: 1,
      duration: OPENING_LINE_2_CHARACTER.charFadeSeconds,
      ease: OPENING_LINE_2_CHARACTER.ease,
      stagger: { each: OPENING_LINE_2_CHARACTER.charIntervalSeconds, from: 'start' },
      onComplete: () => {
        guideLine2BreatheTween = startBreathing(guideLine2Split.chars);
      },
    });
  }

  // --- Guiding Orb dialogue: four more lines, position-triggered through the traverse (v2.2) --
  // Fires off state.traverse.progress against GUIDE_DIALOGUE_AXIS_FRACTIONS (config.js), NOT
  // state.clockTime/elapsedSeconds — clockTime is frozen once the traverse begins (see
  // state.js's header) and elapsedSeconds would make a line's timing depend on how long the
  // user happened to take, defeating the "fires at the same *place* regardless of pace" point
  // (ARCHITECTURE.md). Only evaluated during the 'traverse' beat itself so a stray progress
  // value from a skip-to-end reset (main.js sets state.traverse.progress = 1 before flipping
  // beat away from 'traverse' entirely) can't retrigger anything after the fact.
  //
  // Re-arm-on-revisit (v2.2, deliberate per ARCHITECTURE.md, not accidental): bidirectional
  // scroll means the user can pass a trigger fraction, keep going, then scroll backward past it
  // again later, then forward again — each line uses a small armed/disarmed flag with a
  // hysteresis margin (DIALOGUE_REARM_HYSTERESIS) so it: (a) fires the instant progress first
  // crosses its fraction going forward or reaches it going backward — direction of approach
  // doesn't matter, only proximity does, since these are the orb "noticing where you are," not
  // a one-directional plot beat; (b) will not fire again until progress has moved at least
  // DIALOGUE_REARM_HYSTERESIS away from that fraction (either direction) and then comes back —
  // this is what stops scroll jitter sitting right at the boundary from machine-gunning the
  // same line on/off every frame, while still letting a genuine back-and-forth revisit replay
  // the line, which is the whole point of making this re-armable at all.
  if (state.beat === 'traverse') {
    const progress = state.traverse.progress;
    // Crossing test (cinematographer/interaction-designer review, v2.2 retune): compare against
    // last frame's progress, not just this frame's absolute position, so a large single-frame
    // step (fast scroll + a dt hitch) that jumps clean over a trigger fraction still counts as
    // having reached it, rather than silently skipping the line for the rest of the pass.
    const prevProgress = previousTraverseProgress ?? progress;
    const lo = Math.min(prevProgress, progress);
    const hi = Math.max(prevProgress, progress);

    GUIDE_DIALOGUE_AXIS_FRACTIONS.forEach((fraction, i) => {
      const lineState = traverseLineState[i];
      const distance = Math.abs(progress - fraction);

      if (!lineState.armed) {
        // Re-arm once the user has demonstrably left this trigger's neighborhood (spatial
        // hysteresis — this alone only prevents scroll jitter right at the boundary from
        // re-triggering the SAME line repeatedly; see the SEPARATE check below for whether a
        // still-queued reveal should be dropped, now governed by direction, not this margin).
        if (distance >= DIALOGUE_REARM_HYSTERESIS) {
          lineState.armed = true;
        }
        // v2.9 FIX — real bug, not tuning (feedback: "if I scroll through too fast, I'm missing a
        // lot of the texts"): this used to drop a still-pending queued line (see the min-interval
        // floor mechanism further below) the instant `distance` alone exceeded
        // DIALOGUE_REARM_HYSTERESIS, in EITHER direction — but that hysteresis (0.035 of the whole
        // traverse) is a tiny spatial margin, crossed in a fraction of a second at anything above
        // roughly half of SCROLL's max velocity (verified directly: ~0.21s at max scroll speed,
        // against the up-to-2.4s window GUIDE_DIALOGUE_MIN_INTERVAL_SECONDS is supposed to let a
        // queued line survive) — so ordinary fast-forward scrolling, the EXACT scenario the queue
        // exists to serve, was itself silently clearing the queue before it could ever fire. This
        // file's own v2.5 comment on the original fix specifically described the intended failure
        // case as the user "scrolling BACK OUT of its neighborhood" — genuine reversal, not
        // continued forward progress. Fixed to only drop a still-pending entry for THIS line when
        // the CURRENT scroll direction is actually backward (state.vortex.travelSpeed < 0);
        // continuing forward past the hysteresis window, or past several more trigger fractions,
        // no longer clears it — the crossing-check below already overwrites a stale pending entry
        // with a fresher one the instant a later trigger is crossed, so there's still no risk of
        // an unbounded backlog (at most one line is ever queued, always the most recent).
        if (pendingTraverseLineIndex === i && (state.vortex?.travelSpeed ?? 0) < -1e-3) {
          pendingTraverseLineIndex = null;
        }
        return;
      }

      // Armed and either (a) within the trigger's hair-trigger distance this frame, or (b) the
      // trigger fraction was crossed sometime between last frame and this one (covers a large
      // single-frame progress step stepping clean over the whole epsilon window) — fire it.
      const crossedThisStep = fraction >= lo && fraction <= hi;
      if ((distance <= 0.004 || crossedThisStep) && lineState.split) {
        lineState.armed = false;
        // v2.5: dialogue min-interval floor (ARCHITECTURE.md's overlay-text.js contract). If the
        // floor has already elapsed since the last reveal, fire immediately, exactly as before.
        // Otherwise this trigger doesn't fire and isn't dropped either — it becomes the one
        // pending line, overwriting whatever was previously pending (only the most recent moment
        // is ever queued).
        if (secondsSinceLastReveal >= GUIDE_DIALOGUE_MIN_INTERVAL_SECONDS) {
          fireTraverseLine(i);
        } else {
          pendingTraverseLineIndex = i;
        }
      }
    });

    previousTraverseProgress = progress;
  } else {
    // Reset so re-entering 'traverse' later (e.g. after a beat transition) doesn't treat a stale
    // progress sample from a prior pass as "last frame" and manufacture a bogus crossing.
    previousTraverseProgress = null;
  }

  // --- v2.5: dialogue min-interval floor — flush the pending line once the floor elapses -------
  // Once per frame, outside the crossing-check loop above: if something is queued and the floor
  // has now elapsed (accumulated below), fire it and clear the slot. This is what actually
  // delivers the "fires the instant the floor is satisfied" half of the contract — the crossing
  // loop above only ever enqueues, it never fires a pending line itself.
  //
  // v2.5 FIX (kinetic/motion review): this flush used to run completely unconditionally, every
  // frame, regardless of state.beat — but a trigger can be queued here mid-traverse and then the
  // user can skip-to-end (state.skipRequested) before the floor elapses, which jumps state.beat
  // straight to 'turn'/'approach'/'overflow'/'iris' without ever clearing
  // pendingTraverseLineIndex (only the SEPARATE activeTraverseLineIndex/state.dialogue.activeIndex
  // pair gets reset by the 'iris' skip-to-end branch below). The unconditional flush would then
  // call fireTraverseLine() during the return phase — reviving a traverse dialogue line's DOM
  // opacity tween and re-writing state.dialogue.activeIndex to a stale non--1 value well after the
  // 'iris' branch already declared "nothing showing." Gating this to state.beat === 'traverse'
  // (the only beat this whole mechanism is scoped to per ARCHITECTURE.md) makes a skip-to-end
  // simply drop the still-pending line, exactly like scrolling back out of a trigger's
  // neighborhood already does a few lines above — not a queue that outlives the phase it was
  // queued in.
  if (state.beat === 'traverse') {
    secondsSinceLastReveal += dt;
    if (pendingTraverseLineIndex !== null && secondsSinceLastReveal >= GUIDE_DIALOGUE_MIN_INTERVAL_SECONDS) {
      const indexToFire = pendingTraverseLineIndex;
      pendingTraverseLineIndex = null;
      fireTraverseLine(indexToFire);
    }
  } else {
    pendingTraverseLineIndex = null;
  }

  // --- Guiding Orb dialogue recedes once the traverse trance begins, same as the title ----
  // card and for the same reason: CONCEPT.md's arc keeps the Orb's two opening lines scoped to
  // the fall-in ("near the very start"), not lingering through the trance. Non-negotiable #8
  // (ARCHITECTURE.md) — the Orb itself hands off at 'turn', but its introductory *dialogue* is
  // an even earlier, one-time beat, so it recedes as soon as the traverse settles in, well
  // before the Orb's own visual dissolve at 'turn'.
  //
  // v2.2: this now fades only the two OPENING lines themselves (guideLine1El/guideLine2El),
  // not the shared `#guide-dialogue` container — the container stays at opacity 1 for the rest
  // of the traverse so the four new position-triggered lines below (children of the same
  // container, per-line opacity already independently controlled) can keep using it. The
  // `guideDialogueReceded` flag name/semantics are preserved (still means "the opening two-line
  // beat has finished and receded") so the skip-to-end coverage further down still reads
  // correctly; it now targets the two line elements directly instead of the whole container.
  if (!guideDialogueReceded && guideDialogueEl && state.beat === 'traverse' && state.beatProgress > 0.08) {
    guideDialogueReceded = true;
    if (guideLine1El) gsap.to(guideLine1El, { opacity: 0, duration: 1.2, ease: 'power1.out' });
    if (guideLine2El) gsap.to(guideLine2El, { opacity: 0, duration: 1.2, ease: 'power1.out' });
    // v2.3: stop the opening lines' continuous breathing as they recede — they're fading out
    // for good here (never re-shown), so there's no reason to keep the loop running underneath.
    stopBreathing(guideLine1BreatheTween, guideLine1Split?.chars);
    stopBreathing(guideLine2BreatheTween, guideLine2Split?.chars);
    guideLine1BreatheTween = null;
    guideLine2BreatheTween = null;
    // The container itself must actually be visible (opacity 1) for the traverse lines to show —
    // it starts at 0 (index.html/CSS resting state) and is normally only ever raised to 1 by
    // guideLine1's own reveal tween above. If line 1 never got a chance to reveal (e.g. an
    // unusually fast skip through fall-in that still passed through 'traverse' briefly), make
    // sure the container is opaque here too so the traverse dialogue system isn't silently
    // invisible underneath a still-zero container opacity.
    gsap.to(guideDialogueEl, { opacity: 1, duration: 0.01 });
  }

  // --- Title card recedes once the traverse trance begins -----------------
  // CONCEPT.md's beat sheet only stages the title card at beat 0-1 ("Trigger"/"Drop") — Act I's
  // "loss of ground" message. Leaving it on screen through the entire ~20s trance and the Act III
  // whiteout contradicts Section 1's arc ("the mind stops problem-solving" in Act II; Act III
  // should read as wordless generosity, not qualified by a lingering failure-message). Fade it
  // out shortly after the traverse beat begins — the user has had the full "catch" beat plus a
  // moment of flying to read it — well before the trance settles in.
  if (!titleReceded && titleCardEl && state.beat === 'traverse' && state.beatProgress > 0.08) {
    titleReceded = true;
    gsap.to(titleCardEl, { opacity: 0, duration: 1.2, ease: 'power1.out' });
  }

  // --- Return copy: assembles as the iris opens onto the homepage ---------
  if (!returnRevealed && returnSplit && state.beat === 'iris') {
    returnRevealed = true;
    // Title card has done its job by now — let it recede so it doesn't
    // compete with the return copy during the whiteout/iris hold. (Also covers the
    // skip-to-end path, where state.beat can jump straight to 'iris' without ever
    // passing through 'traverse' long enough to trigger the recede branch above.)
    if (titleCardEl) {
      titleReceded = true;
      gsap.to(titleCardEl, { opacity: 0, duration: 0.6, ease: 'power1.out' });
    }
    // v2.3: stop the opening lines' breathing here too — this branch is the skip-to-end path,
    // which can fire before the normal traverse-recede branch above ever runs.
    stopBreathing(guideLine1BreatheTween, guideLine1Split?.chars);
    stopBreathing(guideLine2BreatheTween, guideLine2Split?.chars);
    guideLine1BreatheTween = null;
    guideLine2BreatheTween = null;
    // Same skip-to-end coverage for the Guiding Orb's dialogue — a skip triggered during
    // 'drop'/'freefall'/'catch' jumps straight to the return phase's 'turn' beat (main.js/
    // director.js's skipToEnd(), never passes through 'traverse'), so the recede branch above
    // (gated on state.beat === 'traverse') would never fire and the dialogue would be left
    // stuck at opacity 1 underneath the return copy/whiteout. v2.2: also covers a skip fired
    // MID-traverse, after one or more of the four new lines have already revealed — the whole
    // container (and, for tidiness, each individual traverse line) is forced to opacity 0 here,
    // and any in-flight traverse-line hide timer is cleared alongside state.dialogue.activeIndex
    // being reset to -1 (see the shared-field contract note above the traverse dialogue block:
    // this is one of the only two writers of this field, and both must agree it means "nothing
    // showing" once we've moved on to 'iris').
    if (guideDialogueEl) {
      guideDialogueReceded = true;
      gsap.to(guideDialogueEl, { opacity: 0, duration: 0.6, ease: 'power1.out' });
      traverseLineState.forEach((lineState) => {
        if (lineState.el) gsap.to(lineState.el, { opacity: 0, duration: 0.3, overwrite: true });
        // v2.3: stop every traverse line's breathing tween on skip-to-end, same reasoning as the
        // opening lines above — none of these will be shown again once we're at 'iris'.
        stopBreathing(lineState.breatheTween, lineState.split?.chars);
        lineState.breatheTween = null;
      });
      if (activeLineHideTimer) {
        clearTimeout(activeLineHideTimer);
        activeLineHideTimer = null;
      }
      activeTraverseLineIndex = -1;
      state.dialogue.activeIndex = -1;
    }
    gsap.to(returnCopyEl, { opacity: 1, duration: 0.01 });
    // v2.22: typed, like everything else. Deliberately the slowest pace in the piece — this is the
    // line the whole journey resolves onto, and it should feel set down rather than delivered.
    gsap.to(returnSplit.chars, {
      opacity: 1,
      duration: RETURN_CHARACTER.charFadeSeconds,
      ease: RETURN_CHARACTER.ease,
      stagger: { each: RETURN_CHARACTER.charIntervalSeconds, from: 'start' },
    });
  }

  // --- v2.16: the way home — reveals once the iris beat has settled -----------------------
  // Gated a beat into 'iris' (rather than on its first frame) so the return copy's own reveal
  // lands first and the link reads as the quiet final answer, not a competing headline. Once
  // revealed it stays: this is the one overlay element that must never fade back out.
  if (!homeLinkRevealed && homeLinkEl && state.beat === 'iris' && state.beatProgress >= 0.5) {
    homeLinkRevealed = true;
    homeLinkEl.style.pointerEvents = 'auto';
    gsap.to(homeLinkEl, { opacity: 1, duration: 1.1, ease: 'power1.out' });
  }

  // --- Skip affordance: fades in only after SKIP_AFFORDANCE_DELAY --------
  // v2.16 FIX: also gated on NOT being at 'iris'/skip-requested — without that, this branch and
  // the recede branch below toggled each other every frame once the ending began (recede sets
  // skipVisible=false, clockTime is still past the delay, so this re-revealed it next frame),
  // leaving the "skip" control strobing half-visible on the final frame it has no purpose on.
  if (
    !skipVisible &&
    skipButtonEl &&
    state.clockTime >= SKIP_AFFORDANCE_DELAY &&
    state.beat !== 'iris' &&
    !state.skipRequested
  ) {
    skipVisible = true;
    gsap.to(skipButtonEl, { opacity: 1, duration: 0.8, ease: 'power1.out' });
  }
  // Once the piece is handing off to the homepage, the skip control has
  // nothing left to skip to — let it recede along with the title card.
  if (skipVisible && skipButtonEl && (state.beat === 'iris' || state.skipRequested)) {
    gsap.to(skipButtonEl, { opacity: 0, duration: 0.4, ease: 'power1.out' });
    skipVisible = false;
  }

  // --- Iris mask: clip-path circle radius driven by state.iris.radius ----
  // Inverted on purpose: state.iris.radius=1 ("fully open onto the scene")
  // must collapse the mask's own visible clip-circle down toward
  // IRIS_MIN_PERCENT (mask clipped away, scene fully visible); radius=0
  // ("closed") expands it toward IRIS_MAX_PERCENT (mask fully covers).
  if (irisMaskEl && state.iris.radius !== lastIrisRadius) {
    const clamped = Math.min(1, Math.max(0, state.iris.radius));
    const percent = IRIS_MAX_PERCENT - clamped * (IRIS_MAX_PERCENT - IRIS_MIN_PERCENT);
    if (irisTween) irisTween.kill();
    irisTween = gsap.to(irisMaskEl, {
      clipPath: `circle(${percent}% at 50% 50%)`,
      duration: Math.min(0.5, Math.max(dt * 2, 0.05)),
      ease: 'sine.out',
      overwrite: true,
    });
    lastIrisRadius = state.iris.radius;
  }
}
