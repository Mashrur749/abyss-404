# 404: The Descent — Experience Concept

A choreography document, not a spec. Four lenses, then a creative director's synthesis into a beat-by-beat script. No code yet — this is the thing the code should be *faithful to*.

---

## 0. The One Insight Everything Else Depends On

**Build a labyrinth, not a maze.**

A maze is multicursal — branching paths, dead ends, the possibility of being *actually* lost. A labyrinth (Chartres Cathedral, classical 7-circuit) is unicursal — one winding path in, the same path (or its mirror) out. No wrong turns exist. It *looks* like a maze — the walls, the turns, the sense of enclosure — but structurally it cannot fail the user.

This matters because the person hitting this page is already lost (they mistyped a URL, followed a dead link). A page that punishes them with more choice-paralysis is cruel. A page that gives them the *aesthetic* of a maze but the *mechanic* of a labyrinth lets us have both: visual complexity for the thrill, and guaranteed resolution for the calm. This single decision reconciles "psychological thrill" with "make the user feel calm, in a trance" — it's the fulcrum the whole design balances on.

Everything below assumes this.

---

## 1. The Storyteller's Lens — What Is This Story Actually About?

A 404 is a small failure: intention met void. Most 404 pages either apologize (boring) or joke (forgettable). The opportunity here is to make the *failure itself* the content — to let the user feel the "lost-ness" as an actual sensation for a few seconds, then resolve it. That resolution is what they'll remember, not the joke.

**Arc (three-act, compressed to ~20–40 seconds):**

- **Act I — The Fall (loss of ground).** The floor the user expected (the page they wanted) is gone. We don't soften this — we let them feel it drop out from under them for a beat. This is the "psychological thrill" — a genuine, brief vertigo.
- **Act II — The Labyrinth (surrender).** Falling becomes walking. The panic has nowhere to go because there's no decision to make — just turns to follow. This is where thrill converts to trance: repetition, rhythm, low information load. The mind stops problem-solving and starts drifting. This is the emotional center of the piece and should be the longest beat.
- **Act III — The Overflow (return with a gift).** Light doesn't just appear — it *overflows*, spilling toward the user rather than the user walking up to it. They didn't find their way out through effort; they're being *poured back* into the world. That inversion (light comes to you, rather than you reaching light) is what makes the return feel generous instead of like "puzzle solved."

**Tone guardrail:** calm-with-thrill, not horror. No jump scares, no predatory shapes, no sense of being hunted. The "fun" comes from wonder (bioluminescent details, a wink of playfulness in the 404 glyphs themselves) not from dread. Think *"floating in a planetarium at night"* more than *"trapped in a horror maze."*

**Micro-story motif — the 404 itself becomes a character.** The numerals "4-0-4" can appear as physical objects embedded in the labyrinth walls or floating in the void — carved into stone, or made of the same glowing material as the escape light — so the wayfinding number and the narrative payoff are the same object. Finding/passing a glowing "404" is what triggers the overflow. This gives the user something concrete to have "discovered," even though the path was never actually optional.

---

## 2. The Cinematographer's Lens — How Do We Frame It?

**Act I — The Fall.**
- Wide/fisheye FOV (~90–100°) — distorts peripheral geometry, standard vertigo-inducing lens choice (cf. the falling shots in *Fight Club*, *Panic Room*).
- Camera is locked to a first-person rig with no user control yet — this is a *cinematic*, not interactive, beat. Taking control away first makes giving it back later (Act II) feel like relief, not a UI default.
- Subtle uncommanded roll (2–4°) as if the body is tumbling slightly, not falling perfectly true. Imperfection reads as "real."
- Depth cue: thin vertical light-streaks (like Rothko-esque bands of dim color) rush past and elongate with motion blur, giving speed without needing detailed geometry to render.

**Act II — The Labyrinth.**
- FOV narrows to a natural ~55–65° as falling becomes walking — this recalibration is itself a felt transition, an exhale.
- Camera height settles to human eye-level. Walls read as tall, slightly oppressive (2.5–3x head height) but never claustrophobic-close — corridor width should feel like a cathedral aisle, not a coffin.
- Occasional slow Dutch-tilt (1–2°, held for a few seconds, then correcting) at turns — disorientation as texture, not as a repeated gimmick.
- Rack-focus moments: foreground wall detail sharp, corridor-ahead soft, then reverse — draws the eye forward without forcing camera motion.
- Fog/atmospheric depth (volumetric, not flat skybox) so the maze reads as infinite without infinite draw distance — the eye trusts the haze more than it would trust a hard render horizon.

**Act III — The Overflow.**
- A light source appears distant and small (a single point, not a wall of brightness) — scarcity first.
- As the user approaches, we cheat focal length slightly wider again (~70°) so the light's growth feels accelerating/exponential rather than linear — an old dolly-zoom-adjacent trick (inverse of *Vertigo*'s effect: here the world seems to stretch *toward* the light rather than away from the subject).
- Final beat: full whiteout bloom overtakes frame, then an iris-style reveal (soft-edged, not hard-cut) opens onto the homepage — echoing old-Hollywood iris transitions, which read as "a scene closing," not "a page loading."

---

## 3. The Kinetic / Motion Lens — How Does It *Move*?

**Act I — The Fall (≈3–5s).**
- Ease: sharp `ease-in` acceleration (cubic or expo) — motion should feel like it's *taking over*, not gently ramping. The user should feel like control was removed, not offered a smooth ride.
- Screen-shake/noise amplitude highest at the very start (the "drop") and decaying — front-loaded intensity, not sustained.
- Sound and motion synced: a low sub-bass whoosh with a falling pitch-bend (classic riser-in-reverse) — the ear confirms what the eye is doing.

**Act II — The Labyrinth (≈15–25s, the bulk of the runtime).**
- Ease: everything shifts to `ease-in-out`, long and gentle — footstep-cadence camera bob at a slow, deliberate walking pace (~0.8–1 step/sec, slower than natural gait — dream-logic pacing).
- Turns are telegraphed *before* they happen (a light cue or wall-glyph a few meters ahead) so the camera can begin easing rotation early — no motion should surprise the inner ear once Act II begins. This is the mechanical definition of "calm": predictability of movement, even amid visual complexity.
- Introduce a very slow, almost-subliminal camera drift/sway (like breathing) — this is the "trance" signal. Constant micro-motion with no sharp edges reads physiologically as safety (compare: fire, water, breath — all soothing because they move continuously without abrupt state changes).
- Optional light interactivity here (mouse-parallax or gyroscope tilt on mobile) — small-magnitude, heavily damped — gives the user *agency* without giving them the ability to get lost, reinforcing the labyrinth-not-maze mechanic kinetically as well as spatially.
- Infinite-feeling geometry achieved via modular repeat + fog occlusion (a technical note, not a build step): the same 8–12 corridor segments recombine procedurally, so "infinite" is a perceptual trick, not a genuine unbounded scene.

**Act III — The Overflow (≈5–8s).**
- Ease: `ease-out`, decelerating — the opposite curve of Act I. Symmetry between the fall's ease-in and the return's ease-out is what makes the piece feel *composed* rather than just "reversed."
- Light bloom intensity grows on an accelerating curve (quadratic/cubic) even as camera movement decelerates — the mismatch (slowing body, speeding light) is what produces the "overflowing" sensation rather than "arriving."
- Final transition to the homepage should not be an abrupt cut — cross-dissolve/whiteout hold (~400–600ms) so the vestibular system gets a moment to "land" before real UI (with its own scroll, clicks, cursor) resumes authority.

---

## 4. The Light Artist's Lens — What Does It Feel Like Emotionally, Color by Color?

**Act I — The Fall.**
- Palette: near-black void with cold undertones — deep indigo/ink (#0a0a14 territory), no pure black (pure black reads as "empty render," not "abyss").
- Almost no light sources yet — just enough ambient falloff to render silhouette/depth. Darkness here should feel *total but not blind* — the eye should be straining, which is itself part of the thrill.

**Act II — The Labyrinth.**
- Introduce sparse bioluminescent accents: thin glowing seams in the wall joints, a scatter of slow-drifting particulate light (dust-mote / firefly quality) at low density. These are the "breadcrumbs" — not literal navigation aids (remember, there's only one path) but emotional pacing markers, so 25 seconds of walking doesn't feel monotonous.
- Color temperature: cool violet-blue base (~6500K-cold) with the glowing seams pushed slightly warmer (~3000K amber or a soft cyan — pick one accent, not both, for coherence) so they read as intentional, not incidental.
- The "404" glyphs embedded in the walls should be the *brightest* objects in this act by a wide margin — a clear visual hierarchy that makes them feel like waypoints/discoveries even though they're actually just scenery beats timed to the fixed path.
- Light should never be static: every glow source should have a slow, irregular pulse (like breathing or a heartbeat slowing down over the course of Act II — literally decelerating the pulse rate as the act progresses, from ~70bpm-equivalent flicker down to ~50bpm) — this is a subtle biofeedback illusion reinforcing "you are calming down."

**Act III — The Overflow.**
- Color temperature inverts hard: violet-blue washes out into warm gold/white (3000K → 6000K daylight-white bloom). This is the only hard palette pivot in the whole piece — everywhere else transitions are gradual; here we want an unmistakable emotional turn.
- Bloom/glow should feel like it has volume and weight — light "spilling" like liquid down the corridor toward camera, not just a brightening skybox. If technically feasible later: a volumetric light shaft that appears to pour around the silhouette of the walls, so it reads as the corridor being *filled* rather than a lamp being switched on.
- Final frame before the iris-transition: pure warm whiteout, slightly overexposed — deliberately "too bright," like walking out of a cinema into daylight. That overexposure is what the user should carry as the residual feeling into the homepage.

---

## 5. The Interaction Lens — Resonance, Not Response

The brief calls for the experience to be **immersive, transient, hypnotizing**. All three words point away from conventional "interactivity" (click a thing, get a discrete result) and toward a single mechanic: **the labyrinth should behave like still water — undisturbed until touched, and touched it ripples, glows, sighs, then settles back to stillness.** Cause and effect stay connected (immersive — your presence matters), but the effect never persists or accumulates (transient — nothing is collected, unlocked, or remembered), and the causality is soft and delayed rather than snappy (hypnotizing — it feels like the world is dreaming *about* you, not responding *to* you).

This rules out anything that would reintroduce choice-paralysis or gamification: no clickable puzzle elements, no "find all 3 glyphs" collectible logic, no branching outcomes. Interaction here is a **texture on top of the fixed path**, never a fork in it. It should be discoverable by accident (moving the mouse, tilting the phone, simply existing in the scene) rather than by being told "click here."

**Concrete mechanics, all confined to Act II (the trance is the only place interaction belongs — Act I needs total helplessness, Act III needs total surrender):**

- **Wake/ripple trail.** The user's parallax-driven gaze direction leaves a faint bioluminescent disturbance behind it in the wall/floor material — like a fingertip dragged through water — that blooms softly for ~1–2s then fades. Always looking forward = calm, unrippled surface. Looking around = the world visibly responds, but never in a way that redirects the path.
- **Proximity resonance on the "404" glyphs.** As the camera nears an embedded glyph, it brightens and its pulse-rate syncs toward the camera's own decelerating heartbeat-glow rhythm — like two things falling into sync (entrainment, a well-documented hypnotic device: metronomes, binaural beats). No click required; proximity alone is the "interaction." It peaks as you pass it, then relaxes back to ambient as you move on — nothing stays activated.
- **Breath-synced ambient pulse (passive, but reactive if mic/motion permission is ever granted).** Baseline: the wall-glow pulse follows its own scripted decelerating rhythm regardless of user input (this must work with zero interaction, since permissions may be denied or device may be desktop). As a *bonus* layer only, if the user is idle (no mouse/gyro movement) for a few seconds, the glow can slow further, as if the scene itself relaxes when the user does — reinforcing hypnosis via mirroring rather than prompting.
- **Whisper-fade audio spatialization.** Tying to the wake/ripple trail: soft, indistinct tonal shimmer (not words, not a jump-scare whisper) pans subtly with the user's look-direction, decaying quickly. This is the auditory sibling of the ripple — the same "disturb → fade" logic in sound rather than light, so no single sense carries all the interactivity alone.

**Why this stays hypnotic and doesn't tip into "game":**
- Every response has a **decay curve back to baseline** — nothing is ever left "on." A hypnotic state depends on the environment returning to neutral so the *next* disturbance can register; a UI that stays lit up from prior clicks accumulates state and starts to feel like a dashboard.
- All triggers are **continuous and proximity/attention-based**, never discrete click targets — this preserves "no decision to make," the load-bearing promise from Section 0.
- Nothing here is **required** to progress — a user who never moves their mouse still completes the exact same journey in the exact same time. Interaction is seasoning on the fixed path, not a mechanic gating it.

---

## 6. The Technical Craft Lens — Libraries That Earn Their Weight

"Production-grade cinematic" is a rendering-quality and typography-quality bar, not a framework decision — so the additions here are all narrowly-scoped libraries (a few KB to a couple hundred KB each), not app frameworks, and each one maps to a specific beat that would otherwise look like a demo rather than a film.

**Kinetic typography (the "404" glyphs, both in-scene and any 2D overlay text):**

| Library | Role | Why it earns its place |
|---|---|---|
| **troika-three-text** | Renders the embedded "404" wall-glyphs as crisp, SDF-based text *inside* the Three.js scene | Three.js's built-in `TextGeometry` is polygon-based and looks jagged/low-res when it glows or is seen at an angle in fog. Troika renders signed-distance-field text that stays crisp under bloom and at any distance/angle — this is the difference between the glyphs looking "placeholder" vs. "designed." |
| **GSAP SplitText** (official GSAP plugin, now free) | Splits any 2D overlay text (e.g. a title card, the skip affordance, homepage-return micro-copy) into chars/words for staggered reveal | Lets text *assemble* — coalescing from scattered characters into a stable word — rather than just fading in. Matches the "world dreaming" quality from Section 5 far better than an opacity tween. |
| **GSAP ScrambleTextPlugin** (official GSAP plugin, now free) | Cipher-style character-scramble effect, specifically for the "404" numerals themselves | The glyphs can visibly *resolve* out of noise as the camera nears them (scrambled glyph-like characters settling into "4-0-4") — reinforcing the "discovery" beat from Section 1 kinetically, and giving the entrainment/pulse-sync moment from Section 5 a typographic payoff, not just a light one. |

**Rendering polish (Act III especially depends on this — "overflow" is a bloom/volumetric-light problem):**

| Library | Role | Why it earns its place |
|---|---|---|
| **pmndrs/postprocessing** | Drop-in replacement for Three.js's example `EffectComposer`, adds production-quality Bloom, Vignette, Chromatic Aberration, Film Grain, God Rays (volumetric light) passes | Three's stock example post-processing is functional but visibly "demo-grade" (bloom halos, banding). This library is what most award-winning WebGL sites (Awwwards-tier) actually use under the hood — it's the single highest-leverage addition for making Act III's light-overflow read as cinematic bloom rather than a CSS `filter: brightness()` look. God Rays specifically realizes the "volumetric light shaft pouring around the walls" beat from Section 4 directly. |
| **simplex-noise** (tiny, ~2KB) | Procedural noise for camera micro-drift/sway (Act II), fog density variation, and particle drift | Hand-rolled `Math.sin()` noise reads as mechanical/looping; simplex noise is what makes the "breathing" camera sway in Section 3 and the drifting bioluminescent particulates in Section 4 feel organic rather than metronomic — worth it specifically because repetition is where a "loop" gives itself away, and this experience is *built* on repetition (the modular corridor). |

**Audio (the sub-bass riser, decelerating pulse, warm swell — currently scoped to raw Web Audio API):**

| Library | Role | Why it earns its place |
|---|---|---|
| **Tone.js** | Higher-level synthesis/scheduling on top of Web Audio API — envelopes, LFOs, filters, precise scheduling | Hand-writing the decelerating heartbeat-pulse (70bpm→50bpm over Act II) and the riser/whoosh/swell in raw Web Audio is finicky (manual oscillator/gain-node graphs, manual scheduling). Tone.js turns that into a few declarative lines and makes the audio *tempo-locked* to the GSAP timeline achievable without hand-built clock math — important since audio/visual sync is what sells "cinematic" over "webpage with sound effects." |

**Deliberately excluded / not needed:**
- No smooth-scroll library (Lenis, etc.) — this experience is autoplaying/cinematic, not scroll-driven, so nothing in the beat sheet is gated on scroll position.
- No physics engine (Cannon/Rapier) — the labyrinth path is scripted (Section 0's unicursal guarantee), not simulated; physics would add cost and an actual risk of unintended collision/failure states, which directly contradicts the no-failure-state non-negotiable.
- No UI/dev-tool libraries (dat.gui/lil-gui) belong in the shipped page — fine as a local build-time tuning aid, but should be stripped from production output.

---

## 7. The Creative Director's Synthesis — Full Beat Sheet

A single authoritative timeline merging all four lenses. Timecodes are relative/approximate — meant to guide *ratios*, not be literal frame numbers.

| Beat | Time | Camera / Motion | Light / Color | Story beat | User control |
|---|---|---|---|---|---|
| **0. Trigger** | 0s | Page load = ground gives way (no "click to start") | Cut from whatever cold UI chrome exists straight to void | "The page you wanted isn't here" — the void *is* the message | None |
| **1. The Drop** | 0–1s | Sharp ease-in fall, fisheye, 2–4° uncommanded roll | Near-black, cold, minimal falloff | Loss of ground — the thrill spike | None (cinematic) |
| **2. Freefall** | 1–4s | Sustained fall, decaying shake, light-streaks rushing past | Still dark, first faint bioluminescent hint appears far below | Disorientation settling | None |
| **3. The Catch** | 4–5.5s | FOV narrows 100°→60°, fall velocity eases into walk cadence | First proper wall-glow ignites around camera | Falling becomes walking — surrender begins | Control returns here (subtle) |
| **4. The Labyrinth** | 5.5–25s | Slow deliberate walk-bob, telegraphed turns, micro-drift/sway, occasional Dutch-tilt | Cool violet-blue, sparse warm particulates, glow pulse decelerating over time | The trance — repetition, low-stakes wandering, 1–2 glowing "404" glyph encounters as waypoints | Parallax/gyro tilt drives a fading ripple trail + glyph proximity-resonance + idle-mirroring pulse — resonance, not navigation |
| **5. The Turn** | 25–28s | A held beat — camera slows almost to stop, then a corridor ahead reveals a single point of light | Warmest color shift begins subtly here (foreshadow) | Recognition — "there it is" | None (cinematic re-take of control, deliberately) |
| **6. The Approach** | 28–33s | Ease-out deceleration begins, FOV cheats wider so light grows faster than distance closed | Violet→gold pivot in full swing, bloom volume increasing | Being drawn/poured toward resolution, not "finding" it | None |
| **7. The Overflow** | 33–36s | Near-stop, light fills frame, volumetric spill | Full warm whiteout, deliberate overexposure | Generosity — light comes to you | None |
| **8. The Iris** | 36–37s | Soft iris-style reveal | Cross-dissolve hold ~500ms | Scene closes, not "page navigates" | Homepage resumes normal control |

**Total runtime: ~35–40 seconds**, skippable after ~2s (a small "skip ↓" affordance should fade in around beat 2 for returning visitors/accessibility — thrill is best on first encounter, not on every retry).

**Non-negotiables for whoever builds this next:**
1. Labyrinth mechanic, not maze mechanic — one path, no failure state, ever.
2. The only hard color pivot in the entire piece is the Act II→III turn — everything else is gradual, to protect the trance.
3. Act I strips user control; Act II returns a small amount (parallax only); Act III strips it again deliberately. Control itself is a storytelling instrument, not just a UX default.
4. Motion is front-loaded intense (the drop) and back-loaded generous (the overflow) — symmetric easing curves (ease-in / ease-in-out / ease-out) across the three acts is what makes it feel *composed*.
5. Skip affordance exists but is invisible for the first ~2 seconds — don't rob first-time visitors of the thrill for the sake of impatient repeat ones.
6. Interaction is resonance (disturb → bloom → decay to baseline), never response (click → discrete result) — every reactive effect must fade back to neutral, and nothing about the journey's length or outcome may depend on whether the user interacts at all.

---

*Next phase (not started): technical prototyping. Confirmed stack (all vanilla HTML/CSS/JS, no app framework/build-step required — though a lightweight bundler like Vite-as-a-dev-tool-only is reasonable purely for ES module imports of these libraries):*
- *Three.js — scene, camera, fog, instanced/modular corridor geometry*
- *GSAP (core + SplitText + ScrambleTextPlugin) — timeline orchestration, per-act easing curves, kinetic typography*
- *troika-three-text — crisp SDF-rendered in-scene "404" glyphs*
- *pmndrs/postprocessing — production-grade Bloom/God-Rays/Vignette/Grain pipeline, carries Act III's light-overflow*
- *simplex-noise — organic camera micro-drift and particle motion, avoids mechanical-looking repetition*
- *Tone.js — tempo-locked audio layer (riser, decelerating pulse, warm swell) synced to the GSAP timeline*

*Full rationale per library in Section 6. Held until this concept is reviewed.*
