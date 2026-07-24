// Authoritative constants derived from CONCEPT.md (v2.2 — void/particle-vortex pivot,
// Follow-the-Orb revision). Every module reads timing/color/motion values from here — nothing
// should be hand-copied or re-derived in individual modules, so the experience stays a single
// source of truth as it's built by multiple contributors.
//
// v2.2 CHANGES FROM v2.1 (post-playtest feedback, second round):
// - The camera now FOLLOWS the Guiding Orb (a proper chase-cam: behind and slightly above,
//   looking at/past it) during fall-in and traverse, rather than the orb leading a fixed
//   distance ahead of an independently-computed camera path. This is a real architectural
//   change — see CAMERA.chase below and ARCHITECTURE.md's guide.js/vortex.js sections. Directly
//   answers "the orb isn't in a position where it's guiding" / "camera needs to be behind the
//   orb following the orb."
// - Scroll is now BIDIRECTIONAL — velocity is signed, the user can scroll back to revisit, not
//   just pace forward. Idle-drift remains a small, constant *forward* bias so the piece still
//   guarantees eventual resolution even if a user only ever scrolls backward or does nothing
//   (non-negotiable #1 still holds — see SCROLL below).
// - Return phase (turn/approach/overflow/iris) durations are cut roughly in half — feedback:
//   "the ending screen is too much dragged."
// - New: GUIDE_DIALOGUE_AXIS_FRACTIONS — the orb's voice continues speaking at intervals
//   through the traverse (not just two lines at the very start), addressing "there's no
//   interesting stories going on" / "cinematic kinetic text having conversation."
// - New: RIPPLE.clickBoostGain — a click/tap-triggered particle disturbance, the explicit
//   "something to fiddle with" interaction, still fully resonance/decay-based.
// - New: CAMERA.fallInParallax — mouse-look during the fall itself (previously parallax was
//   traverse-only), the concrete "initial camera movement needs to be interactive" fix.
// - New: AUDIO — a continuous ambient soundscape starting at t=0 (very quiet), building
//   throughout, replacing "audio only kicks in near the end."
//
// v2 TIMING MODEL (unchanged in structure — read this before touching BEATS/state.js's
// updateBeat()): three independently-clocked phases —
//   1. Fall-in (drop/freefall/catch) — fixed duration, driven by state.clockTime.
//   2. Traverse — duration is NOT fixed. state.traverse.progress (0..1, written by scroll.js,
//      now bidirectionally) decays toward a small forward idle-drift bias rather than freezing
//      or holding position when input stops.
//   3. Return (turn/approach/overflow/iris) — fixed *relative* durations from the moment
//      state.traverse.progress reaches 1, tracked via state.actIII.clockTime.
// See state.js's updateBeat() for exactly how state.beat/state.beatProgress get derived.

export const BEATS = {
  // --- Fall-in phase: fixed clockTime, autoplay. No silhouette hold — motion starts at t=0. ---
  // v2.5 ROLLBACK: v2.4 widened `drop` from 0.6s to 1.1s to hold a room/TV cold-open staged right
  // at the fall's own opening frame. Feedback ("I don't see the room/tv") plus the two rounds of
  // advisor fixes it took just to get the framing merely correct (see VISION_ENCOUNTER below for
  // the replacement) confirmed that staging content against the fall-in's own near-vertical,
  // autoplay camera tangent is fundamentally fragile — there's no scroll control to compose the
  // shot with, and no interaction moment to anchor it to. The room/TV imagery now lives INSIDE the
  // traverse instead (VISION_ENCOUNTER, placed exactly like seeking-orbs.js's encounters, which
  // have never had a framing problem because they're placed relative to a scroll-paced axis the
  // camera actually chases, not a fixed autoplay fall). `drop`/`freefall`/`catch`/`traverse.start`
  // revert to their pre-v2.4 (v2.2/v2.3) timings — nothing here needs to hold open for scenery
  // anymore.
  drop:       { start: 0,    end: 0.6 },
  freefall:   { start: 0.6,  end: 2.2 },
  catch:      { start: 2.2,  end: 3.2 },  // control (scroll + parallax) activates as this ends

  // --- Traverse phase: scroll-paced (bidirectional), no fixed end ----------------------------
  traverse:   { start: 3.2 },

  // --- Return phase: fixed *relative* durations from traverse-complete, NOT absolute clockTime.
  // v2.2: roughly halved across the board — feedback: "the ending screen is too much dragged."
  turn:       { duration: 1.2 },
  approach:   { duration: 2.2 },
  overflow:   { duration: 1.4 },
  iris:       { duration: 0.7 },
};

// Sum of the return phase's relative durations — the fixed length of Act III once it begins,
// regardless of how long the preceding scroll-paced traverse took.
export const RETURN_TOTAL_DURATION =
  BEATS.turn.duration + BEATS.approach.duration + BEATS.overflow.duration + BEATS.iris.duration; // 5.5s (was 12s in v2.1)

export const SKIP_AFFORDANCE_DELAY = 2; // seconds before the skip control is allowed to appear

// v2.16, NEW — where "home" actually is. The piece is a 404 page: after the iris/whiteout climax
// the user MUST be offered a way onward (previously the experience simply stopped on the final
// gold frame with no link anywhere — a literal dead end on the exact page whose one job is to
// route lost visitors back). The ending's "Take me home" CTA (overlay-text.js) navigates here;
// the skip button's own promise ("Skip to homepage") is fulfilled by the same CTA once the
// skip-to-end lands on the ending frame.
export const HOME_URL = '/';

// v2.5 REPLACES v2.4's ROOM_SCENE — feedback: "I don't see the room/tv, I think it's better to
// just use the image somewhere in the journey portal, a random shadow... staring at the 404 tv."
// Two decisions this encodes: (1) use the user's actual reference photos (src/assets/
// couch-silhouette.jpg, src/assets/tv-404-screen.png) directly this time, not a procedural
// recreation — a deliberate reversal of v2.4's choice, per the user's own explicit direction; (2)
// place it as an in-tunnel apparition during the TRAVERSE (like seeking-orbs.js's encounters and
// COMPANION_ORBS' sightings), not a pre-fall cold-open — see BEATS' comment above for why the
// fall-in placement was structurally fragile.
//
// v2.7 CHANGES — feedback: "I don't see the 404 screen and the silhouette? we should repeatedly
// show the 404 screen in the portal + the silhouette looking at it... make the other orbs
// surround the silhouette."
// 1. REPEATED, not one-off: `axisFractions` (plural) replaces the old single `axisFraction` — the
//    vision now appears three times through the traverse, at fractions chosen to sit in genuinely
//    LOW-curvature stretches of PATH's curve (verified directly against the real built
//    CatmullRomCurve3, not estimated — see PATH's own v2.7 fix note for why curvature matters
//    here: a high-curvature stretch is what caused the Guiding Orb's jitter, and the same
//    high-curvature stretches also swing the chase-cam's boresight away from a fixed lateral
//    anchor point, which independently hurt this encounter's own visibility too), each also
//    deliberately clear of every other traverse moment already authored in this file
//    (SEEKING_ORBS' own two encounters land at ~0.31/0.69 via encounterParamPositions;
//    COMPANION_ORBS.sightingAxisFractions are 0.3/0.62; AMBIENT_EVENTS.axisFractions are 0.45/0.8;
//    GUIDE_DIALOGUE_AXIS_FRACTIONS are 0.22/0.45/0.68/0.88).
// 2. VISIBILITY FIX: `axisOffset` brought in from 4.5m to 2.2m and `approachRadius` widened from
//    16m to 18m. Root cause (verified by directly simulating the real chase-cam geometry across
//    the whole encounter window, not guessed): the proximity check measures distance from a point
//    projected ahead of the camera along its LOOK direction (matching where the camera is actually
//    looking, not merely where it sits — see vision.js's own header comment for why), and at the
//    old 4.5m lateral offset the encounter's peak achievable opacity was only ~0.47 of its own
//    0.92 ceiling, with a narrow, off-boresight window. At 2.2m/18m the same simulation shows peak
//    opacity climbing to ~0.73 and roughly doubling the number of frames the encounter stays both
//    reasonably bright (>0.3) AND close to boresight (<20 degrees) — genuinely visible, not just
//    technically non-zero.
// v2.8 CHANGES — feedback: "the silhouette and the screen needs to come into the portal
// repeatedly, clearly, floating, 20-30 times maybe." `axisFractions` (a hand-picked array of 3)
// is replaced by `count` + `margin`, generated the same evenly-spaced way seeking-orbs.js's own
// `encounterParamPositions()` already works (avoiding the traverse's very start/end) — verified
// directly against the real curve/chase-cam geometry across ALL 24 generated positions that this
// placement geometry generalizes cleanly (no weak spots: minimum peak opacity 0.69 of the 0.92
// ceiling at every single one, not just the 3 hand-picked spots from the previous round).
// `axisOffset`/`heightOffset`/`approachRadius` are also retuned smaller/wider respectively
// (verified to raise mean peak opacity further, to ~0.78-0.82, while still confirmed safe at 24+
// repetitions) — this was headroom already available, worth taking now that repetition puts more
// of the curve's varying geometry to the test than 3 hand-picked "easy" spots did.
// v2.9 CHANGE — creative-director judgment call (feedback: "thinking if we should show the
// silhouette and the TV screen only at the ending screen?"). Recommendation against moving it to
// the ending: the return/approach/overflow/iris sequence is a fast (~5.5s autoplay) plunge into a
// warm whiteout — its entire visual language is "light overtaking the frame," already tightened
// once for feeling dragged, and introducing a near-black couch/silhouette composition there for
// the FIRST time would fight that climax rather than support it. The real problem v2.8's count=24
// created wasn't placement, it was frequency — 24 repetitions turned "a poignant glimpse of what
// you're leaving" into ambient wallpaper, diluting the exact effect intended. Brought down to a
// small, deliberate number of encounters (closer to how seeking-orbs.js's own 2 encounters and
// COMPANION_ORBS' 2 sightings already work) — verified the same placement geometry still holds up
// cleanly at this count (min peak opacity 0.78, same headroom as v2.8's 24-count verification).
export const VISION_ENCOUNTER = {
  count: 4,                 // deliberately few, spaced-apart glimpses — see comment above for why not 24 and not ending-only
  margin: 0.08,             // fraction of the traverse kept clear at the very start/end (same role as seeking-orbs.js's own margin)
  // v2.18: 1.4 -> 3.2. The successive tightenings (4.5 -> 2.2 -> 1.4) were all fixes for the
  // encounter being HARD TO SEE — against a dim, cluttered box-field where it genuinely was. That
  // problem is gone: v2.18's field is sparser and softer, the screen is 5.5m wide, and the plateau
  // holds full opacity from 14m out. What's left at 1.4m is the opposite failure — the camera
  // effectively drives THROUGH a near-opaque photograph, which fills the frame and reads as a
  // collision rather than the "apparition glimpsed in passing" this encounter is specified to be
  // (see peakOpacity's own note). Verified live: at 3.2m it still reads large and unmistakable at
  // closest approach, but passes BESIDE the camera — a held moment, not a jump-scare.
  // v2.21: 3.2 -> 5.7. The encounter is now ONE composite plane (see planeWidth below) instead of a
  // 3.2m figure card plus a separate 5.5m screen card, and at planeWidth 9.13 its half-width (4.57m)
  // would extend PAST the travel axis at a 3.2m offset — i.e. the camera would fly straight through
  // the picture. Pushed out so the plane's near edge still clears the axis by ~1.1m (verified live:
  // it passes BESIDE the camera, the "held moment, not a jump-scare" read v2.18 tuned for). 5.7m is
  // still far inside plateauRadius (14m), so the encounter reaches full peak opacity exactly as
  // before; what it does cost is closest-pass angular size — see planeWidth's own honest caveat.
  axisOffset: 5.7,          // meters off the travel axis, lateral
  side: -1,                 // -1 = left of travel direction, +1 = right (alternates per encounter — see seeking-orbs.js-style side assignment in vision.js)
  heightOffset: -0.7,       // meters relative to eye height — a couch/figure sits low, this is looked slightly DOWN at, not levelly across from
  // v2.10 FIX — feedback: "the image fades in/out too fast, the user won't even understand what
  // they're seeing." The old single `approachRadius` drove a pure inverse-square falloff
  // (opacity = (1-distance/radius)^2 * peak) — a curve that only ever touches its own peak for a
  // single instant at distance=0, then falls away immediately in both directions. Verified
  // directly (simulating the real chase-cam/proximity geometry): even at IDLE drift speed, the
  // encounter stayed above a legible 0.3 opacity threshold for under 2 seconds — nowhere near
  // enough time to actually read a photographic image with real content (a figure, a couch,
  // on-screen text), let alone at faster scroll speeds. Replaced with a PLATEAU curve:
  // `plateauRadius` is a genuine flat "fully at peak opacity" zone (not a single point), with the
  // falloff now happening only between `plateauRadius` and `approachRadius` (the outer fade edge,
  // meaning unchanged from before). Verified this comfortably clears 2+ seconds of high-legibility
  // time (opacity >= 0.5) even at max scroll speed, and confirmed the widened approachRadius still
  // sits well inside half the spacing between adjacent encounters (so two are never visible/
  // fading at once).
  // v2.12 WIDENED — feedback: "make the images show up from further for better visibility."
  // Verified directly (same chase-cam/proximity simulation as the v2.10 fix above) against the
  // real encounter spacing (count=4, margin=0.08, VORTEX.travelSpan=260 -> ~54.6m between
  // adjacent encounters, so approachRadius must stay under ~27.3m or two encounters' fade zones
  // would start to overlap): plateauRadius 10->14, approachRadius 26->27 (the safe ceiling).
  // Confirmed this widens the encounter's first-noticeable distance from ~22.7m to ~24.3m and
  // extends real legible dwell time (opacity >= 0.3) from 1.52s to 2.51s even at max scroll speed
  // (6.51s at idle drift), with zero overlap risk between adjacent encounters.
  plateauRadius: 14,        // meters — full peak-opacity zone, NEW: the fix for "fades too fast"
  approachRadius: 27,       // meters — the OUTER edge where opacity reaches 0 (widened again for "show up from further," right at the safe ceiling given current encounter spacing)
  peakOpacity: 0.92,        // never fully opaque even at closest approach — an apparition, not solid scenery
  screenGlowColor: 0xe0a266,  // v2.17: pulled into the unified champagne family (was 0xff9a4d, a hotter orange) — warm ember glow behind the TV image, the encounter's one light-emitting element, same "glow is unlit material color, never a THREE.Light" discipline as the rest of this codebase
  // v2.16 FIX — peak halo opacity lowered 0.5 -> 0.28 (paired with vision.js's glow-scale
  // reduction, see screenGlowScale below): at 0.5 additive opacity across a 2.2x-screen-width
  // sprite the halo rendered as a huge flat mud-brown disc that swallowed the whole encounter —
  // the TV and silhouette lost all contrast inside it (verified live in-browser). The ember read
  // survives at a much lower opacity because the glow is additive against near-black.
  screenGlowPeakOpacity: 0.28,
  // v2.16, NEW — halo diameter as a multiple of screenWidth (was a hardcoded 2.2 in vision.js,
  // duplicated at construction and at texture-resolve). At 2.2x a 5.5m screen the halo spanned
  // ~12m — wider than the tunnel's inner radius — which is what made it read as scene-filling
  // mud rather than a glow hugging the screen. 1.35x keeps a visible soft ember rim just past
  // the screen's own edge.
  screenGlowScale: 1.35,
  // v2.7, NEW — feedback: "make the other orbs lively as well, and make them surround the
  // silhouette." A dedicated companion-orb behavior (owned by vortex.js's updateCompanionOrbs,
  // config'd here since it's this encounter's own contract) pulls a small cluster of the ambient
  // companion population in toward each vision-encounter anchor while it's approach-active,
  // mirroring COMPANION_ORBS' existing sighting-cluster mechanism (same "a subset drifts closer,
  // continuous, never a snap" shape) rather than inventing a new one.
  surroundRadius: 2.6,        // meters from the silhouette anchor the surrounding cluster settles around
  surroundClusterFraction: 0.25, // fraction of the ambient companion population that participates per encounter
  // v2.11, NEW — feedback: "let's add circling orbs around the silhouette, like energy spheres."
  // Distinct from `surroundRadius`/`surroundClusterFraction` above (which pulls a subset of the
  // AMBIENT companion-orb population toward the encounter, via vortex.js's updateCompanionOrbs) —
  // these are purpose-built small glow spheres owned directly by vision.js itself, always present
  // at every encounter (not a population subset that may or may not be nearby), reading as the
  // encounter's own "energy" rather than passersby drawn to it. Uses the same glow-sprite.js
  // core+halo additive technique every other orb in this codebase already uses, so it reads as the
  // same visual language, not a fourth new system.
  energyOrbCount: 4,          // how many small orbs circle each encounter's silhouette
  energyOrbRadius: 1.4,       // meters from the silhouette anchor the orbit sits at — inside surroundRadius (2.6), so ambient surrounding orbs (if any) orbit further out than these dedicated ones
  energyOrbHeightSpread: 1.6, // meters — vertical spread of the circling orbits around the silhouette's own eye-height anchor point
  energyOrbSpeedHz: { min: 0.03, max: 0.06 }, // revolutions per second — slow, deliberate circling, not a spinning-top blur
  energyOrbColor: 0x8fd0c9,   // cool, pale — same palette companion orbs use (config.js's own COMPANION_ORBS default hue family), distinct from the warm screenGlowColor so the two don't merge into one color
  energyOrbCoreDiameter: 0.22,
  energyOrbHaloDiameter: 0.75,
  energyOrbPeakOpacity: 0.85,
  // v2.15 FIX — feedback: "I can still see the box around the tv, and it's still not big?" Two
  // real, separate, verified problems: (1) SIZE — the v2.12 bump to 2.0m was verified this round
  // against the actual chase-cam distance at the moment the encounter reaches full opacity
  // (~23.2m, per the plateau/approachRadius geometry): at that distance and CAMERA.fov.traverse
  // (60deg), a 2.0m-wide screen occupies only ~7% of the vertical frame — legible as "a small
  // bright rectangle," not a screen. Widened to 5.5m (verified: ~19.5% of frame at the same entry
  // distance, ~32% by the plateau's inner edge at 14m) — matches roughly the same on-screen scale
  // the silhouette figure itself reads at (a couch-scale prop, not a phone-scale one). (2) THE
  // "BOX" — a separate bug, not a size issue at all: the screen's glow-halo plane (vision.js's
  // `screenGlow`) was a flat MeshBasicMaterial rectangle with `map: null` — with no gradient
  // texture, a PlaneGeometry renders as a literal uniform-color, hard-edged rectangle, additively
  // blended on top of everything behind it. That flat rectangle, 1.7x the screen's own size, IS
  // the "box" — fixed in vision.js by giving the glow-halo the same shared radial-gradient falloff
  // texture every other glow effect in this codebase already uses (glow-sprite.js), so it fades to
  // transparent at its own edge instead of ending in a hard rectangular silhouette.
  // v2.21 — ONE composite plane replaces the old silhouette-card + screen-card pair. The two cards
  // sat 1.6m apart along the travel axis in a T, and the camera passes at a lateral offset, so
  // parallax exposed the T as two flat photos rather than a scene; worse, the two assets were shot
  // separately (the couch photo's figure is lit from the left and faces near-left, while the TV it
  // is supposedly transfixed by sat behind and beside it), so the piece's single strongest image —
  // a man who cannot look away from the 404 — was the one thing that staging could not show. The
  // composite bakes gaze, light direction and depth into the pixels, where parallax cannot break
  // them, and retires the luminance-keying pipeline entirely (see vision.js).
  //
  // planeWidth is set for PHYSICAL GLYPH-SIZE PARITY with the old build, which is the legibility
  // metric that matters across most of the approach (the v2.15 note widened the old TV to 5.5m
  // because a small screen "reads as a small bright rectangle, not a screen"). Measured directly off
  // both files: the old asset's "404" is 69px of 363 (0.190 of its height) on a 5.5m-wide,
  // 1.410-aspect plane = 0.741m tall. The composite's "404" is 86px of the cropped render's 1060px
  // width, so glyph height = 0.741m at planeWidth 9.13.
  //
  // HONEST CAVEAT: parity is in METERS, not in on-screen angular size at closest pass. The plane is
  // much wider than the old TV card, so axisOffset had to move out from 3.2m to 5.7m to keep the
  // camera from flying through the picture (see axisOffset's own note), and glyph/distance at the
  // closest point therefore drops from ~0.23 to ~0.13. Out where the encounter actually fades in
  // and holds (plateauRadius 14m, approachRadius 27m) distance is dominated by the along-axis term,
  // so the two are within a few percent there and the text reads exactly as before — it is only the
  // closest-pass punch that is softer. Verified live in-browser at both encounters.
  //
  // The source render is CROPPED (scripts/prepare-vision-asset.py) rather than merely scaled for
  // this exact reason: empty margin costs plane width, plane width forces axisOffset outward, and
  // axisOffset is what shrinks the text. Scaling cannot break that loop — it grows the glyph and the
  // plane's half-width in lockstep. Cropping the dead void is the only lever that does.
  planeWidth: 9.13,
  // Where the TV sits INSIDE the composite, as fractions of the plane's own width/height measured
  // from its center (two different scalars — right scales width, up scales height). Measured off the
  // cropped asset (1060x640): bezel center x = 800/1060 = 0.755, bezel center y = 217/640 = 0.339
  // from the top, i.e. above center. Consumed by vision.js to park the glow halo on the TV rather
  // than at the plane's center.
  screenCenterOffset: { right: 0.255, up: 0.161 },
  screenWidthFraction: 0.377, // TV bezel width as a fraction of the composite's width (400/1060) — the glow halo is sized off this, not off the whole plane
  // v2.21, NEW — the plane's own opacity flicker, replacing the old positional CRT jitter. Jitter
  // used to move the screen CARD, which was safe when the card was only a TV; the same offset
  // applied to the composite would shake the couch and the man too. Same "unstable signal, not a
  // vibrating prop" intent, expressed as a small brightness flutter instead of movement (the
  // positional/rotational jitter below now drives the glow halo alone).
  planeFlickerAmplitude: 0.06, // fraction of current opacity, +/-
  // v2.12, NEW — feedback: "add jittering effect to the tv screen." A CRT-static-style unsteady
  // image: small, fast, noise-driven positional/rotational jitter, sampled off
  // state.traverse.elapsedSeconds (never state.clockTime — frozen during traverse, per this
  // codebase's established "frozen-clock" rule, see guide.js's own bob-clock comment) so it never
  // stalls regardless of scroll speed/direction. Deliberately subtle (a few millimeters/a fraction
  // of a degree) — reads as "unstable signal," not a shaking/vibrating prop. v2.21: the positional
  // jitter now drives the GLOW HALO only (the picture plane is the whole scene now — see
  // planeFlickerAmplitude above), and the rotational channel is gone with the screen card it used
  // to rotate; a camera-facing sprite has no meaningful roll to jitter.
  screenJitterAmplitude: 0.012, // meters — positional jitter magnitude
  screenJitterSpeedHz: 9,      // how fast the noise field is sampled — fast enough to read as "static," not a slow wobble
};


// Scroll-pacing bounds for the traverse phase (CONCEPT.md Section 3's velocity-clamp/idle-drift
// guardrails) — scroll.js owns the actual damping-curve implementation, these authored bounds
// are the creative/product contract it must satisfy.
// v2.2: BIDIRECTIONAL. Velocity is signed: positive = forward (toward the light), negative =
// backward (revisiting). The idle-drift floor is NOT zero — it's a small, constant *forward*
// bias (`1/idleDriftDuration`), so a user who never scrolls, or who only ever scrolls backward
// for a while, still eventually completes the traverse — this is what keeps "guaranteed
// resolution" true in a world where backward motion exists. Backward maximum velocity is scaled
// down from forward (`backwardVelocityScale`) so reversing is real and useful for revisiting,
// but the piece still leans forward overall, never becoming a place you can get lost drifting
// backward in.
export const SCROLL = {
  // v2.17: 26 -> 18 — direct feedback: "the scroll feels too long." The default (idle/gentle)
  // pace now completes the journey ~30% sooner. minDuration below is deliberately NOT lowered:
  // 10s is the verified arithmetic floor for all four traverse dialogue lines to fire and be
  // readable at max scroll speed (see the v2.9 note on it) — the pacing win comes from the
  // default pace, not from re-opening that bug.
  idleDriftDuration: 18,  // seconds to complete the traverse via idle-drift alone (zero input)
  // v2.9 FIX — feedback: "we also need to ensure all the texts are rendered, and read by the
  // user... currently, if I scroll through too fast, I'm missing a lot of the texts." Raised from
  // 6 to 10. Verified directly (simulating the real dialogue trigger/queue/min-interval-floor
  // logic against GUIDE_DIALOGUE_AXIS_FRACTIONS/GUIDE_DIALOGUE_MIN_INTERVAL_SECONDS): at the OLD
  // 6s floor, a max-speed scroll physically could not fit more than 2 of the 4 traverse dialogue
  // lines no matter what — the full traverse (6s) was shorter than the 2.4s x 4-line minimum
  // reading budget (9.6s) the min-interval floor itself requires, an arithmetic ceiling no
  // per-line pacing fix could ever get around. 10s comfortably clears that 9.6s minimum (verified:
  // all 4 lines fire even at this exact new max speed), while still keeping the fastest possible
  // traversal fast in absolute terms.
  minDuration: 10,        // fastest possible FORWARD completion even at max scroll velocity
  backwardVelocityScale: 0.7, // backward max speed relative to forward max speed
  inputResponseSeconds: 0.12, // time-constant for velocity to catch up to fresh input — low, so scrolling reads as immediate rather than laggy
  // Reference duration used ONLY for time-based cosmetic curves within the traverse (e.g. the
  // pulse-deceleration in PULSE below) that must not stall if the user lingers past this, or
  // rush if they blow through it.
  pulseReferenceDuration: 20,
};

// The Guiding Orb. A single warm, glowing companion present from the very first frame through
// the end of the traverse. Character: positive, accepting, validating — "you're lost, and that
// happens, follow me, I'll show you the way." Never a wayfinding puzzle element and never
// clickable — pure companion, same resonance-not-response spirit as everything else.
//
// v2.2: the orb is now the thing that actually MOVES ALONG THE AXIS (its position is the direct
// function of state.traverse.progress / the fall-in axial position) — the camera FOLLOWS it via
// CAMERA.chase below, rather than the orb leading a fixed distance ahead of an
// independently-computed camera. This is the concrete fix for "the orb isn't in a position
// where it's guiding" / "camera needs to be behind the orb following the orb." leadDistance
// (v2.1) is removed — CAMERA.chase.distanceBehind is the one source of truth for this spatial
// relationship now, owned by the module that actually positions the camera.
export const GUIDE = {
  color: 0xffd9a0,       // warm, inviting glow — softer/whiter than the amber accent so it reads as "a presence," not just another wayfinding light
  radius: 0.4,            // meters — now the CORE radius of a soft light, not a solid sphere's radius (see LIGHT_FALLOFF below)
  // v2.2: reduced from 0.3 and intentionally slowed — feedback: "I can see the orb going up and
  // down" (i.e. the bob read as an obvious mechanical animation, not a living, barely-perceptible
  // drift). Small amplitude + slow frequency (see guide.js's BOB_FREQUENCY_HZ) is the fix.
  bobAmplitude: 0.12,
  // The orb's guidance is handed off to (dissolves into) the Act III overflow light rather than
  // persisting to the very end — narratively, it delivers the user to the threshold and the
  // light itself takes over, preserving "light comes to you" as the return phase's own
  // generosity beat rather than the orb "arriving" anywhere with the user.
  dissolveStartBeat: 'turn',
  // v2.3 FIX (light-artist review): guide.js's own GUIDE_BRIGHTNESS (1.35) * its pulse-glow peak
  // (1.22) gives the orb a realized brightness CEILING of ~1.647x its flat authored color — this
  // is the true, current ceiling, not the stale "streaks stack to ~1.3x" estimate the ceiling used
  // to be justified against. vortex.js's per-streak brightness stack (pulse * jitter * turnCue *
  // catchLight * region * livingCycle * speedBrightness * clickBurst) has grown well past that
  // estimate since it was written and can now realistically exceed 10x during ordinary
  // interaction (fast scroll + a click), which would let individual streaks visibly out-bloom the
  // Guiding Orb — a direct violation of CONCEPT.md's "deliberately the brightest, warmest thing in
  // frame" non-negotiable. Exported here (rather than kept local to guide.js) specifically so
  // vortex.js can clamp its own stacked brightness against this SAME live ceiling without either
  // file importing the other (avoids the vortex.js<->guide.js circular-import hazard
  // ARCHITECTURE.md warns about) — config.js is a shared leaf module both already depend on.
  brightnessCeiling: 1.35 * 1.22,
  // v2.18, NEW — THE ORB ACTUALLY CASTS LIGHT. Until now the Guiding Orb was a glow sprite
  // floating IN FRONT OF the streak field, never interacting with it: the field's brightness had
  // no idea the orb existed. That is the concrete reason "the lighting doesn't feel premium" —
  // there was no lighting, only two independent layers of self-lit material. lighting.js can't
  // solve this either (its ambient/hemi lights do nothing to the unlit MeshBasicMaterial and
  // sprites everything here is built from — see that file's own header on why scene lights are
  // deliberately absent).
  //
  // So the illumination is authored where the field's color already is: vortex.js's per-instance
  // color write gains a proximity-to-orb term, warming and brightening threads near the orb and
  // falling to nothing beyond castRadius. The orb now visibly moves a pool of warm light through
  // the field as it leads — the single strongest "this is a real space with a real light in it"
  // cue available in an unlit pipeline. The lift stays UNDER GUIDE.brightnessCeiling via the same
  // clamp every other streak term already passes through, so the orb still reads as unambiguously
  // the brightest thing in frame (a load-bearing non-negotiable).
  // Verified live: at 14m the pool swallowed the entire foreground (the orb rides only ~3.5m
  // ahead of the camera, so every near-camera thread fell inside it and the field lost its cool
  // teal identity up close). 10m keeps the warm pool visibly AROUND the orb — which is what reads
  // as a light source — while the foreground and mid-field stay teal.
  castRadius: 10,        // meters — how far the orb's warm pool reaches into the streak field
  castBrightnessGain: 1.5, // peak additional brightness multiplier for a thread right at the orb
  castWarmth: 0.75,      // peak fraction a lit thread's hue is pulled toward the orb's own color
};

// v2.4, NEW — "A floating light-orb that feels like a soft light source in darkness, not a solid
// sphere" (user's verbatim design spec, kept as the reference). Replaces the orb's previous
// shaded-sphere-with-emissive-material look with genuine concentric radial falloff: a
// bright/near-white core, several rings of decreasing opacity, and a large soft outer glow that
// dissolves into the background via opacity alone — never a hard geometric edge. Same established
// GUIDE.color throughout (this is a shape/rendering change, not a palette change). Implementation
// note: troika/basic-material spheres don't produce this on their own — realize it as either a
// small stack of alpha-blended, camera-facing (billboarded) soft-edged circular sprites at
// increasing radius/decreasing opacity (cheapest, most robust in this all-unlit-material
// codebase), or a single custom shader material with an analytic radial falloff function if a
// build agent judges that cleaner — either approach must produce the same visual result: sharp
// bright center dissolving smoothly outward, no visible ring edges/banding, no hard silhouette.
export const GUIDE_LIGHT_FALLOFF = {
  coreOpacity: 1.0,
  coreRadiusScale: 0.35,   // fraction of GUIDE.radius that reads as the "solid-feeling" bright center
  ringCount: 3,            // concentric falloff rings beyond the core (3, within the user's "2-4" spec)
  ringOpacityFalloff: 0.45, // each successive ring's opacity is this fraction of the previous ring's
  outerGlowRadiusScale: 4.5, // fraction of GUIDE.radius the large soft outer halo extends to before reaching ~0 opacity
  outerGlowOpacity: 0.1,    // opacity of the outermost halo at ITS OWN inner edge (fades to 0 at outerGlowRadiusScale)
};

// How much headroom (fraction) individual vortex streaks must stay under GUIDE.brightnessCeiling
// at their stacked worst case — kept just under 1 (rather than exactly 1) so the orb reads as
// unambiguously, comfortably the brightest thing in frame rather than merely tied with the
// occasional streak at its own peak.
export const STREAK_BRIGHTNESS_CEILING = GUIDE.brightnessCeiling * 0.85;


// Ambient "other travelers" — distant, dim, non-interactive orbs drifting through the field.
// Pure environmental storytelling: "there are other orbs finding their way too, you're not
// alone." Never close enough to read as an obstacle or a second guide.
// v2.2: feedback was that this theme wasn't landing ("no interesting stories going on... others
// who are lost as well"). Two additions beyond just existing in the background (see
// ARCHITECTURE.md's vortex.js section for the implementation): (1) `sightingAxisFractions` —
// specific travel-axis positions where a small cluster of companions drifts noticeably closer
// and more visible than the constant ambient background population, a deliberate "moment" rather
// than pure ambience; (2) `convergeAtEnd` — during the return phase, companions drift toward and
// dissolve into the same overflow light the Guiding Orb hands off to, unifying the finale
// ("everyone finds their way, together") instead of the guide dissolving in visual isolation.
//
// v2.3 FIX: minDistance/maxDistance were 20..60m against a `VORTEX.tunnelRadiusMax` of only 14m
// — the companions were floating entirely OUTSIDE the visible portal/tunnel boundary, in open
// space beyond where the vortex streak field itself even reaches. This is the concrete mechanism
// behind "the other orbs need to settle within the bound of the portal pathway": they were never
// inside it in the first place. Distances brought inside tunnelRadiusMax (with a small margin so
// they never clip through the outer edge), so they now read as genuinely part of the same
// tunnel/portal space the user is traveling through, not separate objects adrift beyond it.
export const COMPANION_ORBS = {
  count: 14,
  color: 0x6fb8c2,   // cooler, dimmer than the guide — visually distinct as "other," not a second wayfinder
  minDistance: 4,    // meters from the travel axis (ambient background population) — just outside tunnelRadiusMin so they never overlap the guide/camera path
  maxDistance: 12,   // stays comfortably inside tunnelRadiusMax (14) with margin
  sightingAxisFractions: [0.3, 0.62],  // 0..1 fractions of the traverse where a noticeable cluster drifts closer
  sightingMinDistance: 3,   // meters from the axis during a sighting — closer than ambient, a genuinely noticeable approach, still inside the tunnel bounds
  sightingMaxDistance: 7,
  // v2.4 FIX — feedback: "the ending feels off, it feels like all the orbs are suddenly jumping
  // into the bigger orb, it needs to flow with the scroll." Two things were wrong: convergence
  // was triggered as a one-time state flip at a BEAT boundary (state.beat === 'turn'), and the
  // return phase's own clock (state.actIII.clockTime) is autoplay-driven, NOT tied to scrolling
  // at all — so "flowing with the scroll" specifically requires the convergence to ramp in
  // continuously against state.traverse.progress (the actual scroll-driven value) DURING the
  // tail of the traverse, before the beat boundary is ever reached, not against anything in the
  // return phase. convergeAtEnd stays a feature flag (whether this happens at all);
  // convergeRampStartFraction is NEW — the state.traverse.progress fraction at which continuous,
  // monotonic convergence motion begins (still fully reversible if the user scrolls backward
  // past this point, consistent with bidirectional scroll elsewhere in this codebase), so by the
  // time 'turn' actually begins the companions are already smoothly mid-drift toward the light,
  // not starting from a standstill at that exact instant.
  convergeAtEnd: true,
  convergeRampStartFraction: 0.85, // state.traverse.progress fraction where continuous convergence drift begins
  // v2.8, NEW — feedback: "give them similar glow, vary it out, give them diverse range of colors
  // to feel mesmerizing, ensuring that this truly feels like people are on their own journey of
  // exploration." `color` above stops being every orb's literal color and becomes the shared
  // template this population's GLOW CHARACTER derives from (same opacity/brightness/pulse/
  // sighting/surround behavior, unchanged) — each orb's own HUE is spread across the color wheel
  // instead (golden-angle spacing, vortex.js's makeCompanionOrbs — an even, non-repeating spread
  // rather than random hues that could cluster two adjacent orbs on near-identical colors by
  // chance), while saturation/lightness stay fixed at the values below so every orb reads as one
  // consistent "glow," just individually colored — literally many small journeys, one shared
  // language of light.
  hueVariety: 1.0,       // 0..1 fraction of the full color wheel spread across the population (1 = full spread, every hue represented)
  colorSaturation: 0.55, // HSL saturation shared by every orb regardless of hue — vivid enough to feel mesmerizing without going neon/oversaturated
  colorLightness: 0.64,  // HSL lightness shared by every orb regardless of hue — keeps the population in one consistent "glowing" brightness family
  // v2.8, NEW — fraction of the population that ever participates in the vision-encounter
  // "surround" behavior (a stable, deterministic subset, not re-chosen per frame) — see
  // vortex.js's makeCompanionOrbs/updateCompanionOrbs for the nearest-active-anchor mechanism this
  // drives. Raised from the old fixed-anchor-count v2.7 approach's effective ~25%-per-encounter to
  // a single population-wide fraction now that VISION_ENCOUNTER.count can be 20-30 (any one
  // participating orb may surround whichever encounter it's currently nearest to, not a single
  // fixed encounter).
  visionSurroundFraction: 0.4,
};

// v2.3 addition (playtest item 7: "the whole environment needs to feel alive... things happening
// around, others moving around, evolving"). The two scripted `sightingAxisFractions` moments above
// are still user-position-triggered every single run — CONCEPT.md's v2.3 revision explicitly asks
// for something DISTINCT from those: "a small number of one-off ambient events... so things read
// as happening on their own terms, not only ever in reaction to the user's presence." These fire
// once per traverse, at fixed axis fractions deliberately NOT overlapping sightingAxisFractions or
// each other's influence windows, as a brief, self-contained flare (a momentary brightness bloom
// on a small existing cluster of the ambient companion population, off in the field rather than
// on the travel axis) — not a new sighting cluster, not tied to scroll speed or any interaction
// signal, so it reads as ambient/independent rather than another response to the user.
export const AMBIENT_EVENTS = {
  axisFractions: [0.45, 0.8], // distinct from COMPANION_ORBS.sightingAxisFractions (0.3, 0.62)
  influenceWidth: 0.035,       // narrower than a sighting's window — reads as a brief flare, not a sustained approach
  brightnessBoost: 1.6,        // peak additive brightness multiplier on the affected cluster at event center
  clusterFraction: 0.18,       // fraction of the ambient companion population that flares per event
};

export const CAMERA = {
  fov: {
    fall: 100,       // Act I wide/fisheye
    catchStart: 100,
    catchEnd: 60,    // narrows as fall becomes flight
    traverse: 60,    // Act II resting FOV
    approach: 70,    // cheats wider as light is neared, Act III
  },
  // v2.23 — THE FALL-IN TUMBLE IS REMOVED. v2.20 softened it (2-4° -> 1-2.2°) and it was still
  // reported as jumpy, because the problem was never the amplitude — it was the SHAPE. The roll
  // was tweened 0 -> max on `power4.in` across `drop`, which barely moves for most of that beat
  // and then snaps almost the whole way in its final fraction of a second, and then immediately
  // REVERSED direction toward `min` at the freefall boundary. Two velocity discontinuities back to
  // back, right at the opening. Reducing the numbers just made a smaller jump.
  //
  // Zeroed rather than re-shaped: against v2.18's calm field there is nothing left for an
  // uncommanded tumble to do except disturb an otherwise still frame. The fall now reads through
  // the things that actually carry it — the accelerating descent, the streaks, and the FOV
  // recalibration at `catch`. The tweens that write these values are left in place and simply
  // animate 0 -> 0 (inert), so the timeline's structure and beat contract are untouched.
  rollDegrees: { min: 0, max: 0 },       // uncommanded roll during the fall — retired, see above
  bankDegrees: { min: 1, max: 2 },       // occasional Act II roll/bank as the vortex curves
  eyeHeight: 1.6,                        // meters, human eye-level reference

  // v2.2, new — the chase-cam relationship to the Guiding Orb (fall-in AND traverse). The
  // camera's position is derived FROM the orb's position (behind + above it, looking at/past
  // it), not computed independently — this is the structural fix for "camera needs to be
  // behind the orb following the orb." Handled in vortex.js's getCameraRigPosition, which now
  // reads the orb's resolved position/tangent (passed in as parameters by main.js, avoiding a
  // circular import between vortex.js and guide.js — see ARCHITECTURE.md).
  chase: {
    // v2.12: tightened from 5 -> 3.5 — feedback: "get the guiding orb a little bit closer."
    // Verified directly (same camera-local tangent/up-frame geometry overlay-text.js's own header
    // comment already uses to place the dialogue clear of the orb's on-screen region): at 5m the
    // orb sits ~5.44deg below the optical axis (18% of half-FOV at CAMERA.fov.traverse=60deg); at
    // 3.5m it's ~9.10deg (30% of half-FOV) — closer and more present in frame, still comfortably
    // inside the upper-middle band, nowhere near the dialogue's own reserved bottom ~14% of the
    // viewport, so this doesn't reopen the v2.3 orb/text overlap bug that comment describes.
    distanceBehind: 3.5, // meters behind the orb along its direction of travel
    heightAbove: 1.1,    // meters above the orb's own height
    lookAheadBeyond: 4,  // meters past the orb the camera's lookAt target sits, so the orb reads as "in frame, ahead," not dead-center blocking the view
    // v2.4, NEW — feedback: "it doesn't feel like the orb is guiding me, it feels like the orb
    // is 'me'." Root cause: the chase-cam previously copied the orb's exact position every
    // single frame with ZERO independent smoothing of its own, so any bob/weave in the orb was
    // instantly and identically mirrored by the camera — mechanically indistinguishable from
    // "the camera IS the orb." A camera that is genuinely FOLLOWING something always lags
    // slightly behind its subject's exact motion; that lag is what "following" kinematically
    // means. This is a time-constant (seconds) for the camera's own exponential smoothing
    // toward the orb-derived target position/orientation, applied ON TOP OF the existing
    // distanceBehind/heightAbove/lookAheadBeyond offset math, not a replacement for it. Small
    // and fast enough that it never reads as sluggish/laggy (a real prior complaint elsewhere in
    // this project) — just enough to break the 1:1 rigid attachment.
    followDampingSeconds: 0.22,
  },

  // v2.2, new — small mouse-look during the fall itself (previously parallax was traverse-only).
  // Feedback: "the initial camera movement needs to hook the user, and be interactive." This is
  // gaze only (where you're looking), never pace/outcome — falling still happens on the fixed
  // autoplay curve, satisfying "control as instrument" (Act I still strips *pace* control, just
  // not *gaze* control anymore).
  fallInParallax: {
    maxYawDeg: 6,
    maxPitchDeg: 4,
    dampingSeconds: 0.18,
  },
};

// Void/particle-vortex flow field.
export const VORTEX = {
  // v2.18 — count cut 2400 -> 700 as PART OF the additive-quad swap (vortex.js's makeStreaks),
  // not as a separate tuning choice. Two reasons, pointing the same way:
  //   (a) Necessity: opaque boxes don't stack, additive quads do. At 2400 the near-axis band
  //       would accumulate to a blown-out white wash no matter what the per-instance brightness
  //       ceiling clamps, because the ceiling is per-streak and blow-out is a sum.
  //   (b) Aesthetics: fewer, softer, larger-reading threads with real space between them is what
  //       produces calm and negative space. A dense swarm reads as busy no matter how soft it is.
  streakCount: 900,         // instanced elongated-particle count for the primary Act II visual
  // v2.18: 3 -> 4.5m. Short threads read as sparks/scratches; long ones read as flowing silk,
  // which is the reference image's whole character. Safe to change now that the visible depth
  // window (vortex.js's STREAK_FAR_FADE_*) is authored independently rather than derived from
  // STREAK_WRAP_SPAN — but STREAK_WRAP_SPAN itself still scales off this, so keep the far-fade
  // end comfortably inside STREAK_WRAP_SPAN/2 if this grows a lot.
  streakLength: 4.5,        // meters, elongated to read as motion-blurred flow
  // v2.18: 0.03 -> 0.18. These are no longer solid sticks whose width IS their visible size —
  // they're soft quads whose luminous core occupies only the middle ~40% of the quad, the rest
  // dissolving to transparent. A 0.03 quad under that falloff is a barely-visible hairline; 0.18
  // yields a thread that reads at tunnel distances while still looking like silk, not rope.
  streakWidth: 0.18,
  tunnelRadiusMin: 2.5,      // meters, inner radius of the flow field around the travel axis
  tunnelRadiusMax: 14,       // meters, outer radius before particles fade/recycle
  travelSpan: 260,           // meters of "distance" the traverse phase covers along its axis
  vortexTwistRate: 0.35,     // radians of spiral rotation per unit of travel — shapes the funnel/vortex curve
  // v2.2, new — a slow, continuous evolution over REAL ELAPSED TIME (not just axial position),
  // so the field never looks like a frozen loop even if a user lingers in one spot via backward
  // scroll or a long idle-drift. Feedback: "the space needs to give you the living vibe, where
  // things not dead, rather evolving." Kept subtle — this modulates existing brightness/density/
  // hue parameters, it is not a second hard color pivot (non-negotiable #2 still applies).
  livingCycle: {
    periodSeconds: 22,    // one full slow evolution cycle
    intensityAmplitude: 0.12, // fraction of brightness the cycle modulates by
  },
};

// v2.20, NEW — HOW SCROLLING SHOULD FEEL. The authored answer to "what should the user feel while
// scrolling," in one tunable place.
//
// THE PROBLEM: scroll was a throttle. Input went in, the camera moved, and nothing in the world
// had an opinion about it. Mechanically correct, emotionally inert — you were operating a slider
// attached to a dolly. Nothing about it said "you are travelling with someone."
//
// THE DESIGN — "the light answers you." Three interlocking responses, driven by scroll.js's
// intent/stillness/impulse signals (see state.js's `scroll` block):
//
//  1. THE ORB ANSWERS (guide.js). Push, and the orb brightens and swells a little — a companion
//     saying "yes, this way." It's a response, not a readout: small enough that you feel
//     acknowledged rather than watch a meter move.
//  2. STILLNESS IS REWARDED (guide.js + vortex.js). Stop scrolling, and the piece does not nag or
//     stall — it SETTLES. The orb eases to a calmer, steadier glow; the companion orbs drift a
//     little closer. Almost every scroll-driven experience punishes stopping; this one answers it.
//     That inversion is the single most calming decision available here, and it's the literal
//     content of the orb's own dialogue: "However long this takes you, it's exactly enough."
//  3. YOU PUSH LIGHT INTO THE DARK (vortex.js). Every deliberate push releases a soft wave of
//     light that travels forward down the tunnel and dissipates. It makes agency physical and
//     visible: you are not scrolling a page, you are pushing back the dark, and the dark answers.
//
// Together these read as breathing: push and the world brightens ahead of you; rest and everything
// gathers quietly back toward you. Every one of them is resonance-not-response compliant — each
// decays fully to baseline on its own and none of them gate progress.
export const SCROLL_FEEL = {
  // --- 1. The orb's answer (guide.js) ---
  orbResponseGlowGain: 0.22,  // peak extra brightness at full scroll intent. If the orb visibly "flashes" when you scroll, this is too high — it must read as a companion, never as a UI element.
  orbResponseScaleGain: 0.09, // peak extra scale at full scroll intent
  orbStillnessDim: 0.16,      // how far the orb settles back when the user rests

  // --- 2. Stillness gathering (vortex.js) ---
  stillnessGatherFraction: 0.35, // how far companion orbs drift toward the travel axis at full stillness (0 = no gathering, 1 = all the way in)
  stillnessGatherLift: 0.35,     // extra brightness on gathered companions at full stillness — they lean in a little, so resting feels ANSWERED rather than merely quiet

  // --- 3. Light waves (vortex.js) ---
  waveSpeed: 52,          // meters/sec the wave front travels forward — fast enough to read as light, slow enough to watch it go
  waveLifetimeSeconds: 1.6,
  waveWidth: 7,           // meters — gaussian half-width of the bright band
  waveGain: 0.85,         // peak brightness multiplier added at the wave's own crest
  waveMaxActive: 4,       // concurrent waves; beyond this the oldest is recycled
};

// v2.19, NEW — the far depth layer (src/scene/starfield.js). Answers "should we add a lot of
// granular details to make the outer space lively?" with a deliberate NO to the general version
// and a YES to exactly one thing: a second, much more distant population, so the piece has real
// parallax between depth bands instead of one populated band floating in empty black.
//
// Every value here is chosen to stay SUBORDINATE. These are the dimmest, smallest, slowest things
// in the piece by a wide margin — they exist to make the dark feel inhabited, never to be looked
// at. If this field ever becomes noticeable as "particles," it has failed; turn it down.
// FIRST LIVE PASS FAILED, AND THE FAILURE IS INSTRUCTIVE — it is the very thing this field's
// header warns about. At count 1100 / minRadius 26 / size 2.4 the stars rendered as a dense swarm
// of clearly-visible soft blobs: granular detail that made the frame busy, exactly the outcome
// that argued against "a lot of granular details" in the first place. Retuned by a lot, not a
// little: far fewer, much further out, much smaller, much dimmer. The test is not "can I see the
// stars" — it's "does the dark feel inhabited." If you can pick out individual particles, it is
// still too strong.
export const STARFIELD = {
  count: 650,
  minRadius: 55,          // meters from the travel axis — far outside VORTEX.tunnelRadiusMax (14); nothing should ever pass NEAR the camera, or it stops reading as distance
  maxRadius: 170,
  spanMarginBehind: 80,   // meters of star coverage behind the journey's start (the fall-in enters from here)
  spanMarginAhead: 140,   // meters past VORTEX.travelSpan, so the return phase still flies through populated space
  size: 1.0,              // world-units point size before perspective attenuation
  baseOpacityMin: 0.06,   // deliberately very dim — far below the companion orbs, further below the Guide
  baseOpacityMax: 0.22,
  twinkleHzMin: 0.04,     // extremely slow — a star that visibly blinks reads as a UI element, not distance
  twinkleHzMax: 0.14,
  twinkleAmount: 0.22,    // +-22% brightness, well under the streak field's own breathing
  colorCool: 0x9fc6d8,    // pale cold blue-white — the far, cold end of the piece's existing teal family
  colorWarm: 0xffe3c0,    // a warm minority, drawn from the same champagne family as GUIDE.color
  warmFraction: 0.22,
};

// v2.3, NEW — the journey is now a single continuous CURVED path (a real 3D spline), not a
// straight line, spanning fall-in through the very end of the return phase. Feedback: "the
// camera feels too static, maybe due to straight path... we want it to feel like a journey,
// rather than a straight boring path" AND "the ending needs to flow with the movement, rather
// than feeling like a separate segment." Both trace to the same prior design decision (the v2
// pivot's own comments explicitly chose "a single straight line... not even a spline," reasoning
// that the spiral particle motion and camera bank alone would supply enough curve-cue — playtest
// feedback now says that reasoning didn't hold up in practice). One curve, one arc-length
// parametrization, used by EVERY phase (fall-in's axial descent, the traverse, and the return's
// turn/approach/overflow/iris) — this is also what makes the ending "flow with the movement"
// rather than being a bolted-on separate camera system: it's the same curve continuing, not a
// different one taking over.
//
// Waypoints are authored as lateral (X) and vertical (Y) OFFSETS from the straight axis, at
// fractions of the curve's total authored length (fall-in + travelSpan + past-end return
// distance) — gentle, not a maze; the point is a felt sense of banking/rising/dipping over the
// course of the journey, not navigational complexity (the guaranteed-resolution non-negotiable
// is untouched: this is still one continuous unicursal curve, curvature doesn't add branches or
// choice, only shape).
export const PATH = {
  waypointOffsets: [
    // { atFraction: 0..1 along the WHOLE authored path (fall-in start -> return's far end),
    //   lateralX: meters, verticalY: meters (relative to the straight axis's own Y) }
    { atFraction: 0.0, lateralX: 0, verticalY: 0 },      // fall-in start — matches existing void-drop entry exactly, no change to the opening frame
    { atFraction: 0.12, lateralX: 3.5, verticalY: -1.5 }, // early traverse: gentle bank right and a slight dip
    { atFraction: 0.3, lateralX: -4.5, verticalY: 2.0 },  // banks left and rises — first sighting/dialogue region lands near here
    // v2.7 FIX: was { lateralX: 2.0, verticalY: -2.5 } — a sharp reversal from the previous
    // waypoint's (-4.5, 2.0) that produced a genuine curvature spike right around t=0.49-0.50 of
    // the whole authored path (~7x sharper than any comparable stretch elsewhere on this curve —
    // verified directly against the real CatmullRomCurve3 vortex.js builds, not estimated: peak
    // per-unit-t tangent rotation dropped from ~344 to ~49 with this retune). This spike sits
    // almost exactly on VISION_ENCOUNTER.axisFraction (0.55, in the traverse's own [0,1]
    // parametrization) — the chase-cam's damped tangent-following (guide.js's lastTangent lerp)
    // can't fully absorb a turn this sharp, which is the mechanical cause of "the guiding orb
    // jitters when the screen starts." Retuned to continue the curve's existing left-bank/rise
    // gently rather than reversing it outright — still a real, felt swing (this is not a flattened
    // straight line), just no longer sharp enough to overwhelm the chase-cam's own damping.
    { atFraction: 0.5, lateralX: -3.75, verticalY: 1.5 },
    { atFraction: 0.68, lateralX: -3.0, verticalY: 1.0 }, // banks left again near the second sighting region
    { atFraction: 0.85, lateralX: 1.5, verticalY: -1.0 }, // settling, smaller swings as the journey nears its end
    { atFraction: 0.94, lateralX: 0, verticalY: 0.5 },    // straightening out into the return phase — no sharp moves right at the handoff
    { atFraction: 1.0, lateralX: 0, verticalY: 0 },       // return's far end (past the overflow light) — dead straight for the final approach, so the whiteout/iris climax isn't fighting a lateral curve
  ],
  curveTension: 0.35, // CatmullRomCurve3 tension — matches the value v1's corridor.js used for a similarly gentle, non-kinked curve
};


// Palette: reference-image teal-cyan base; amber accent (sharper contrast against a cooler base).
export const COLOR = {
  voidBase: 0x05070a,        // Act I: near-black, cold, never pure black
  traverseBase: 0x0a2a30,    // Act II: deep teal/cyan base (reference-image match)
  // v2.16 FIX — the streak field's own particle color. The streaks previously reused
  // `traverseBase` directly, but that value is authored as a near-black ENVIRONMENT base
  // (luminance ~16%) — as an unlit particle color it renders essentially invisible, which left
  // the warm amber accent minority as the only streaks the eye could register: the whole tunnel
  // read as sparse brown/amber straw instead of the reference image's luminous teal-cyan vortex.
  // Streaks need their own luminous member of the same hue family, bright enough to carry the
  // field's teal identity on their own (verified live in-browser against the running build).
  // v2.17 (calm/premium pass): softened from 0x2f9fae — the first luminous value read as
  // electric/neon at full field density, which fought the "floating in a planetarium" tone
  // guardrail. This sits in the same hue, lower saturation, gentler peak luminance: misty
  // teal threads rather than charged wires. Easy on the eyes over a 20-30s stare.
  // v2.18: saturation restored (0x4f939e -> 0x3d92a6). v2.17 desaturated this to calm an
  // OPAQUE-box field that was reading harsh; under v2.18's additive blending + bloom the maths
  // run the other way — accumulated light and bloom both pull perceived hue toward white, so a
  // pre-desaturated base washes out to colorless scratches. Deeper input, calm output.
  streakBase: 0x3d92a6,      // misty teal — the visible-particle sibling of traverseBase
  // v2.17 (calm/premium pass): 0xffb347 -> 0xe9bc82 — the old accent was a saturated tangerine
  // that clashed against both the misty teal field and the Guide's soft champagne (0xffd9a0).
  // The whole warm family now sits in one champagne band: GUIDE.color (lightest) -> this accent
  // -> VISION_ENCOUNTER.screenGlowColor (deepest), so every warm element reads as the same light
  // at different intensities rather than three competing oranges.
  traverseAccent: 0xe9bc82,  // champagne amber accent (aligned to GUIDE.color's family)
  overflowStart: 0x2a5550,   // pivot begins here (foreshadow, end of "Turn" beat) — teal-leaning, not violet-leaning
  overflowEnd: 0xfff4d6,     // warm gold/white bloom
  whiteout: 0xffffff,        // final overexposed frame before iris
};

export const PULSE = {
  bpmStart: 70, // traverse-opening glow-pulse rate
  bpmEnd: 50,   // decelerates across the traverse — biofeedback "you are calming down" illusion.
                // Driven by state.traverse.elapsedSeconds (real wall-clock time in-phase) clamped
                // against SCROLL.pulseReferenceDuration above, NOT by traverse.progress or global
                // clockTime.
};

// v2.2: RIPPLE now covers both the passive gaze-driven wake trail (unchanged from v2.1) AND a
// new click/tap-triggered burst — the explicit "something to fiddle with" interaction feedback
// asked for. Both are fully resonance/decay-based (never left "on," never gates progress).
export const RIPPLE = {
  fadeDurationSeconds: 1.5, // wake/ripple trail decay-to-baseline (1-2s range)
  idleMirrorDelaySeconds: 3, // no pointer/gyro/scroll movement for this long before pulse slows further
  clickBoostGain: 1.6,       // additive boost strength for a click/tap-triggered burst, stronger than the passive move-driven ripple so it reads as a deliberate "fiddle," not an accident
  clickFadeDurationSeconds: 2.2, // click bursts linger slightly longer than the passive trail, since they're a deliberate action worth a beat of payoff
};

// v2.6 REPLACES GLYPHS — feedback: "I noticed we have random numbers showing up in our portal...
// we should show hanging orbs that are trying to find themselves, properly choreograph this." The
// old "404" glyph-formations (scrambled characters resolving into the numeral) read as a
// disconnected number gag rather than something that belongs to this piece's own emotional
// register. Retired entirely in favor of small clusters of orbs — visually kin to the Guiding Orb
// (GUIDE_LIGHT_FALLOFF) and the ambient COMPANION_ORBS, extending that same "orb" visual language
// rather than introducing a fourth, unrelated visual system — that visibly wander/flicker
// uncertainly while distant, then calm and settle into a steady glow as the camera nears, a
// one-shot "found, once" moment (never re-triggers) that echoes the whole piece's own "lost ->
// found" arc instead of a numeral appearing out of nowhere. Same placement discipline the retired
// GLYPHS system used (same 1-2 encounters, same even spacing along the traverse, same proximity-
// triggered choreography shape) — only the visual/thematic content changes, not the underlying
// mechanism other modules (camera.js's regional framing, vortex.js's regional density/warmth,
// lighting.js's boost-registry slots) already key off of.
export const SEEKING_ORBS = {
  count: 2, // 1-2 seeking-orb-cluster encounters along the fixed traverse path (unchanged from GLYPHS.count)
  clusterSize: 4, // small orbs per encounter — "orbs" plural, per the feedback, not a single point
  color: 0x8fd0c9, // cool, pale — kin to COMPANION_ORBS.color (0x6fb8c2) but a touch paler/cooler, distinct enough from both the warm Guide and the ambient companions to read as its own small, specific moment
  wanderRadius: 0.55, // meters — how far each orb's uncertain jitter/wander swings while still distant/"lost"
  wanderSpeedHz: { min: 0.4, max: 1.1 }, // per-orb randomized wander rate range so a cluster's members don't move in lockstep — "several little consciousnesses," not four clones
  proximityResonanceRadius: 6, // meters, distance at which the settling arc begins — same value/meaning GLYPHS.proximityResonanceRadius had
  settledScaleBoost: 1.35, // how much an orb grows as it settles — a gentle "arriving," not a jarring pop
  settledBrightnessBoost: 1.7, // multiplier on top of baseOpacity at full settle, so "found" reads as visibly, unambiguously calmer/brighter than "still searching"
};

// v2.2, new — additional Guiding Orb dialogue beats spread through the traverse (beyond the
// original two opening lines), keyed by fraction of traverse progress (0..1) rather than time,
// so they fire at the same *place* regardless of scroll pace or direction (including on a
// backward revisit — see ARCHITECTURE.md's overlay-text.js section for the re-arm/no-repeat
// contract). Exact copy lives in overlay-text.js (matching where the original two lines live);
// this array is only the trigger positions, the single source of truth every module agrees on.
export const GUIDE_DIALOGUE_AXIS_FRACTIONS = [0.22, 0.45, 0.68, 0.88];

// v2.5, NEW — feedback: "the texts move too fast, we should think about how we should give them
// room to appear when a user is scrolling through fast." resolveTraverseLineHoldSeconds() (v2.3)
// already shortens a line's HOLD once it's showing so it doesn't overlap the next trigger — but at
// high scroll speed the trigger fractions themselves can be crossed in rapid succession, so a line
// could still be fired, held for barely longer than its own reveal animation, and cut, one after
// another, with no genuine "room to appear" in between even though nothing technically overlapped.
// This is a SEPARATE guarantee from the hold-fitting: a floor on real wall-clock seconds between
// the START of one traverse line's reveal and the next, regardless of how many trigger fractions
// get crossed in that window. If the user scrolls fast enough to cross another trigger before this
// elapses, that newer trigger is queued (not dropped, not stacked) — it fires the instant the floor
// is satisfied, and a still-later trigger crossed while one is already queued simply replaces it
// (only the most recent/relevant moment is ever queued, per "resonance not response" — the piece
// never owes the user every possible line, only room to actually read whichever one it shows).
export const GUIDE_DIALOGUE_MIN_INTERVAL_SECONDS = 2.4;

// v2.6, NEW — feedback: "the text needs to fully render, pause for a tiny amount of time, then
// start disappearing, or else it's a jarring effect... the user is just rushing through it." A
// real, distinct gap from the min-interval floor above: that constant governs the MINIMUM time
// BETWEEN one line's reveal starting and the next one starting; this constant guarantees a
// genuine settled pause AFTER a line has fully finished arriving, before its fade-out is ever
// scheduled to begin — previously the two could collapse into each other at high scroll speed
// (resolveTraverseLineHoldSeconds' floor only guaranteed the hold lasted at least as long as the
// reveal itself, which allows a pause of exactly zero).
export const GUIDE_DIALOGUE_MIN_PAUSE_AFTER_REVEAL_SECONDS = 0.6;

// v2.4, NEW — feedback: "we should show maybe some text blobs to make a conversation." The
// dialogue previously rendered as plain floating text with nothing visually framing it as
// SPEECH. Each line now sits inside an actual soft, glowing blob shape — consistent with the
// orb's own new light-in-the-dark visual language (GUIDE_LIGHT_FALLOFF above), not a hard-edged
// UI chat bubble — so the dialogue reads unambiguously as the orb talking, a conversation
// happening, rather than narration floating independently in space.
// v2.21 REPLACES SPEECH_BLOB (v2.4-v2.20) — the speech container is RETIRED.
//
// Feedback: "the text boxes don't fit the design taste." Correct, and the honest reading is that
// this element had been failing for four rounds and was only ever sanded down instead of
// questioned. Its history: the voice-marker dot was removed (v2.13), the inset ring and
// backdrop-blur were removed because both traced its border-radius as a crisp pill edge (v2.16),
// and its fill and glow were halved (v2.17). Every round removed another part of it, and it still
// read wrong — because the problem was never the styling, it was that the element EXISTS.
//
// Seen at zoom against the v2.18+ field, it read as a disabled search input: a hard
// rounded-rectangle silhouette with a rim highlight, darker inside than the scene, sitting ON the
// frame. It was the only object in the entire piece with a defined edge — everything else
// (streaks, orbs, stars, the guide) dissolves. Worse, because the container is sized to the
// finished line, an empty bar sat waiting while the typewriter filled it, which is exactly what
// makes it read as an input field rather than a voice.
//
// What replaces it is the piece's own established language: LIGHT EMERGING FROM DARK, NO EDGES.
// The copy is now luminous text floating in the void, lit in the Guide's own colour, over a wide
// shapeless pool of darkness that exists only for legibility and never resolves into a shape. The
// "is this a conversation?" question that originally justified a container (v2.4) is already
// answered by the typewriter reveal and the centred layout — neither of which existed back then.
export const DIALOGUE_VOICE = {
  color: 0xffd9a0,         // GUIDE.color — the words are lit by the same light that speaks them
  textGlowOpacity: 0.5,    // inner halo on the glyphs themselves: the copy GLOWS rather than sitting on a lit panel
  textGlowWideOpacity: 0.24, // a second, much wider halo — how light actually falls off, and what sells "spoken" rather than "printed"
  // v2.22 — THE SCRIM IS GONE TOO. It went 0.55 (read as a dark oval, and banded) -> 0.32 (much
  // better, but still a darkening the eye could locate) -> removed. There is now NO background of
  // any kind behind any text in this piece: contrast lives entirely on the glyphs, via the warm
  // inner halo plus a tight dark contact shadow. That is also what lets the typewriter reveal read
  // as words being typed directly into the void rather than into a reserved area waiting for them.
  // If legibility ever needs help, deepen the glyphs' own dark shadow — never add a panel back.
};

export const EASE = {
  drop: 'power4.in',       // fall-in: sharp ease-in, motion "taking over"
  traverse: 'sine.inOut',  // traverse: long, gentle, breathing quality (used for cosmetic tweens only)
  overflow: 'power2.out',  // return: decelerating, symmetric opposite of the drop
};

// v2.2, new — a continuous ambient soundscape, not "audio that starts near the end." Explicitly
// texture/drone-based (filtered noise, granular grain, sub-bass) — NEVER melodic/harmonic
// content ("no music anywhere" per feedback). Starts at t=0 at near-silence and builds gradually
// through the whole piece; the existing Act III riser/swell is the peak of this same continuous
// layer, not a separate thing that switches on. See ARCHITECTURE.md's audio.js section.
export const AUDIO = {
  ambientStartGain: 0.03,  // barely audible at t=0 — "in the slightest possible way" per feedback
  ambientPeakGain: 0.55,   // reached during the Act III overflow swell
  traverseGrainDensity: { start: 0.15, end: 0.7 }, // textural "grain" density ramps across the traverse's elapsed time, reinforcing the living/evolving feel audibly too
};

// Non-negotiables (CONCEPT.md Section on Beat Sheet) encoded as assertions any module can
// import and check against during development — not enforced at runtime in production.
export const NON_NEGOTIABLES = [
  'guaranteed-resolution',      // one path through open space, no failure state, ever — still true with bidirectional scroll because idle-drift is always a forward bias (see SCROLL above)
  'single-hard-color-pivot',    // only traverse -> return is a hard palette pivot (teal -> gold); the v2.2 living-cycle/companion-sightings modulate brightness/density, never introduce a second pivot
  'control-as-instrument',      // fall-in strips pace-control (gaze control now allowed, v2.2), traverse returns full agency (scroll pace, now bidirectional, + parallax gaze), return strips it again
  'scroll-paces-never-directs', // v2.2: scroll now moves bidirectionally along the SAME single path — it still never picks a different path or changes the outcome, only where along the fixed path you currently are
  'symmetric-easing',           // ease-in (drop) mirrors ease-out (overflow)
  'delayed-skip-affordance',    // invisible for first SKIP_AFFORDANCE_DELAY seconds
  'resonance-not-response',     // interaction always decays to baseline, never required to progress — now including click-triggered ripple bursts (v2.2)
  'guide-hands-off-to-light',   // the Guiding Orb dissolves into the Act III overflow light rather than persisting to the end — companion orbs now converge into the same light too (v2.2), unifying the finale
];
