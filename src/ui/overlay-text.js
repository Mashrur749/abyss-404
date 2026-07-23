// src/ui/overlay-text.js
//
// Owns the 2D overlay DOM: #title-card, #skip-button, #return-copy, #iris-mask.
// This module never touches Three.js objects — only `state` (read) and the DOM
// elements it owns (write). See ARCHITECTURE.md's contract for this file.

import { gsap } from 'gsap';
import { SplitText } from 'gsap/SplitText';
import { SKIP_AFFORDANCE_DELAY } from '../config.js';
import { state } from '../state.js';

gsap.registerPlugin(SplitText);

let titleCardEl = null;
let skipButtonEl = null;
let returnCopyEl = null;
let irisMaskEl = null;

let titleSplit = null;
let returnSplit = null;

// Internal reveal-state flags so each stagger-reveal / fade only ever fires once.
let titleRevealed = false;
let titleReceded = false;
let returnRevealed = false;
let skipVisible = false;
let skipListenerAttached = false;

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

  if (titleCardEl) {
    titleSplit = new SplitText(titleCardEl, {
      type: 'chars,words',
      charsClass: 'split-char',
      wordsClass: 'split-word',
    });
    gsap.set(titleSplit.chars, { opacity: 0, yPercent: 60, rotateX: -40 });
  }

  if (returnCopyEl) {
    returnSplit = new SplitText(returnCopyEl, {
      type: 'chars,words',
      charsClass: 'split-char',
      wordsClass: 'split-word',
    });
    gsap.set(returnSplit.chars, { opacity: 0, yPercent: 40, filter: 'blur(6px)' });
  }

  if (skipButtonEl) {
    gsap.set(skipButtonEl, { opacity: 0 });
    if (!skipListenerAttached) {
      skipButtonEl.addEventListener('click', onSkipClick);
      skipListenerAttached = true;
    }
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

function onSkipClick() {
  state.skipRequested = true;
}

/**
 * Per-frame update. Reads `state` only; never mutates it except for the
 * skip button's click handler, which sets state.skipRequested = true.
 */
export function updateOverlayText(state, dt) {
  // --- Title card: coalesce from scattered characters at trigger/drop -----
  if (!titleRevealed && titleSplit && (state.beat === 'trigger' || state.beat === 'drop')) {
    titleRevealed = true;
    gsap.to(titleCardEl, { opacity: 1, duration: 0.01 });
    gsap.to(titleSplit.chars, {
      opacity: 1,
      yPercent: 0,
      rotateX: 0,
      duration: 1.1,
      ease: 'power3.out',
      stagger: { each: 0.035, from: 'random' },
    });
  }

  // --- Title card recedes once the labyrinth trance begins -----------------
  // CONCEPT.md's beat sheet only stages the title card at beat 0-1 ("Trigger"/"Drop") — Act I's
  // "loss of ground" message. Leaving it on screen through the entire ~20s trance and the Act III
  // whiteout contradicts Section 1's arc ("the mind stops problem-solving" in Act II; Act III
  // should read as wordless generosity, not qualified by a lingering failure-message). Fade it
  // out shortly after the labyrinth beat begins — the user has had the full "catch" beat plus a
  // moment of walking to read it — well before the trance settles in.
  if (!titleReceded && titleCardEl && state.beat === 'labyrinth' && state.beatProgress > 0.08) {
    titleReceded = true;
    gsap.to(titleCardEl, { opacity: 0, duration: 1.2, ease: 'power1.out' });
  }

  // --- Return copy: assembles as the iris opens onto the homepage ---------
  if (!returnRevealed && returnSplit && state.beat === 'iris') {
    returnRevealed = true;
    // Title card has done its job by now — let it recede so it doesn't
    // compete with the return copy during the whiteout/iris hold. (Also covers the
    // skip-to-end path, where state.beat can jump straight to 'iris' without ever
    // passing through 'labyrinth' long enough to trigger the recede branch above.)
    if (titleCardEl) {
      titleReceded = true;
      gsap.to(titleCardEl, { opacity: 0, duration: 0.6, ease: 'power1.out' });
    }
    gsap.to(returnCopyEl, { opacity: 1, duration: 0.01 });
    gsap.to(returnSplit.chars, {
      opacity: 1,
      yPercent: 0,
      filter: 'blur(0px)',
      duration: 0.9,
      ease: 'power2.out',
      stagger: { each: 0.045, from: 'start' },
    });
  }

  // --- Skip affordance: fades in only after SKIP_AFFORDANCE_DELAY --------
  if (!skipVisible && skipButtonEl && state.clockTime >= SKIP_AFFORDANCE_DELAY) {
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
