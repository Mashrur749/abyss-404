# 404: The Descent — Experience Concept

A choreography document, not a spec. Four lenses, then a creative director's synthesis into a beat-by-beat script. No code yet — this is the thing the code should be *faithful to*.

---

## REVISION (v2.20) — A Clean Opening, and "The Light Answers You"

*(Twentieth round. Two asks: "the initial camera movements feels off, it feels like it starts off
very shaky," and "for the interactions, go nuts, get ultra creative to resolve how we should make
the user feel while scrolling.")*

### The shaky opening

The fall-in's easing curve was `t²`, whose derivative at t=0 is exactly **zero** — the camera does
not move at all for the first fraction of a second. Meanwhile director.js ramps camera roll in from
frame one. A stationary frame with a rotation applied to it does not read as falling; it reads as
wobbling in place.

That also contradicted this document. Section 3 is explicit that "motion is continuous from t=0 —
the felt goal is 'immediate,' not 'eventually gets going'." A pure square curve is exactly
"eventually gets going." The curve is now a blend with a real non-zero initial velocity that still
accelerates hard into the fall. The uncommanded roll was separately softened (2–4° → 1–2.2°): that
range was authored for a much busier, harder-edged opening, and against v2.18's calm field it had
become the loudest thing in the first two seconds.

A third change is hygiene rather than a proven cause: the silhouette photo's alpha-keying ran a
synchronous ~1.08-million-pixel loop on the main thread inside `img.onload`, which lands during the
opening beats on a cold load. It's now sliced across idle callbacks so no frame absorbs more than a
couple of milliseconds. **Honest caveat:** the frame-timing measurements taken while investigating
this were invalid — the automated browser tab was backgrounded and Chrome was throttling it, so the
"hitches" recorded were the measurement, not the app. The keying block is a real main-thread hazard
worth removing on its own merits, but it should not be recorded as the confirmed cause of what was
reported.

### "The light answers you"

Scrolling was a throttle. Input went in, the camera moved, and nothing in the world had an opinion
about it — mechanically correct and emotionally inert. You were operating a slider attached to a
dolly, which is the opposite of the piece's own premise that you are travelling *with* someone.

Three interlocking responses now, all authored in one place (`config.js`'s `SCROLL_FEEL`):

1. **The orb answers.** Push, and it brightens and swells slightly — a companion saying "yes, this
   way." Deliberately rendered as brightness and scale rather than movement, so it can't fight the
   chase-cam damping that exists to stop the orb reading as *you*.
2. **Stillness is rewarded.** Stop scrolling and the piece doesn't nag or stall — it *settles*. The
   orb eases to a calmer, steadier glow; the other travellers drift closer and lift slightly.
   Almost every scroll-driven experience punishes stopping. Answering it instead is the calmest
   move available here, and it is the literal content of the orb's own line: "However long this
   takes you, it's exactly enough."
3. **You push light into the dark.** Every deliberate push releases a soft wave of light that
   travels forward down the tunnel and dissipates. It makes agency physical and visible — you are
   not scrolling a page, you are pushing back the dark, and the dark answers.

Together they read as breathing: push and the world brightens ahead of you; rest and everything
gathers quietly back toward you. All three decay fully to baseline on their own and none of them
gate progress, so "resonance not response" is intact.

**What did NOT change:** scroll still only ever paces — never redirects, never gates. The
three-act shape, guaranteed resolution, the single hard color pivot, and the orb-is-brightest
non-negotiable all hold (see ARCHITECTURE.md for how the last one survives light waves).

---

## REVISION (v2.19) — One More Depth Layer, Not More Detail

*(Nineteenth round. Question: "should we add a lot of granular details to make the outer space
lively?" The answer, as creative director, was **no** — with one exception, which is what got
built. The reasoning is the point of this entry.)*

**Why not.** "A lot of granular detail" is what v2.18 just removed. The 2400-box field WAS granular
detail, and it read as busy debris rather than as life. Under the additive rendering the piece now
uses, more detail is actively worse than neutral: every added element brightens the frame, and the
darkness is what makes an abyss feel like an abyss. Density has never been this piece's problem —
the mid-field is already populated by the streak field, companion orbs (14, individually hued,
with sighting and convergence behaviours), seeking-orb encounters, vision encounters, one-off
ambient flares, a slow real-time living cycle, and regional density/warmth variation. Adding more
things at that same distance would have bought busyness, not life.

**What the question was right about.** The frame's outer thirds were pure empty black, so the piece
read as *a tunnel in a void* rather than *a tunnel in a space*. That's a real gap — but the fix for
it isn't more objects at the same depth, it's one more depth **layer**. The piece had exactly one
populated distance band (2.5–14m). A far band at 55–170m gives the eye genuine parallax: near
threads sweep past fast while far stars barely move, and that difference is what the brain reads as
real three-dimensional space. One layer, large depth gain, almost no added agitation.

**The new far field** (`src/scene/starfield.js`) is deliberately the dimmest, smallest, slowest
thing in the piece. It is static (distant stars shouldn't recycle — and not recycling also
sidesteps the wrap-seam bug class that bit the companion orbs twice), it fades out across the Act
III pivot so it never leaves cool specks over a warm whiteout, and it sits behind the streak field
in draw order.

**The first live attempt failed, and the failure proved the point.** At the initially-authored
density and size, the stars rendered as a swarm of clearly-visible soft blobs — exactly the busy
granular detail the whole argument above rejects. Retuned by a large factor, not a small one:
fewer, much further out, much smaller, much dimmer. The test to apply if this is ever touched is
not "can I see the stars," it's **"does the dark feel inhabited"** — if individual particles are
pickable, it's still too strong.

---

## REVISION (v2.18) — The Abyss Was Made of Boxes

*(Eighteenth round. Feedback: "the lighting, the environment, all of these, doesn't feel premium,
calming abyss experience?" — with an offer to re-choreograph the whole piece if needed. It wasn't
needed, and this section records why, because that judgement is the most reusable thing here.)*

**The root cause, and why two rounds of tuning couldn't touch it.** The abyss was 2400 opaque
`BoxGeometry` sticks. A box has a hard silhouette; this renderer also runs `antialias: false`
permanently (main.js documents the depth-blit crash that forbids enabling it), so every one of
those silhouettes was *also* aliased. That is a **material/geometry** failure, and v2.16's palette
work and v2.17's intensity work were both **color** interventions. No color value makes a
hard-edged box read as light, mist, or atmosphere — which is exactly why the piece kept looking
like floating debris no matter how carefully the palette was aligned. The lesson worth keeping:
when two rounds of tuning a parameter don't move a problem, the problem is not that parameter.

**What changed — a renderer swap inside the existing structure, not a new experience.** Every
placement, twist, local-frame, curve, encounter, dialogue and camera system is untouched. Only how
the field is *drawn* changed:

1. **Threads of light instead of sticks.** Each streak is now an additively-blended quad carrying
   a soft elongated gradient texture — no silhouette at all, dissolving into the void at its own
   edges. Because a flat quad (unlike a square-section box) is not symmetric about its long axis,
   each one now billboards around the flow direction: length pinned to the flow tangent, face
   rotated to meet the camera. Still one `InstancedMesh` / one draw call.
2. **Fewer, longer, softer.** 2400 → 900 threads, each longer (4.5m) and wider. Additive light
   *accumulates* where opaque boxes didn't, so a high count would have washed to white; and fewer,
   larger elements with real space between them is also simply what reads as calm. Necessity and
   the aesthetic goal pointed the same way.
3. **Actual depth.** Threads now fade out with distance as well as nearness, so the tunnel recedes
   into darkness instead of ending at an invisible population boundary.
4. **The void stopped being #000.** The renderer had always cleared to true black — the most
   reliable tell of cheap-looking dark rendering. It now clears to `COLOR.voidBase`, the
   near-black-but-cold value config.js had authored for exactly this purpose and nothing applied.
5. **Bloom became a real lighting lever.** `lighting.js` is effectively inert for this piece (its
   ambient/hemi lights do nothing to unlit materials and sprites), which makes bloom the only
   lighting the environment has — and its threshold was set so high that, against the deliberately
   dimmed v2.17 field, it essentially never fired. Lowered and heavily smoothed: the field finally
   has light bleed.
6. **The Guiding Orb actually casts light.** This is the round's biggest single win. The orb was a
   glow sprite floating *in front of* the field; the field had no idea it existed. Threads near
   the orb now take on its warmth and brightness with a soft falloff, so the orb visibly carries a
   pool of warm light through the cool teal field as it leads. One warm source in a cool space,
   with real falloff, is what "premium lighting" actually is — and it's now literally true rather
   than implied. It stays under the orb's own brightness ceiling, so the orb remains the brightest
   thing in frame.
7. **The apparition is glimpsed again, not driven through.** The vision encounter sat 1.4m off the
   travel axis — the end of a series of tightenings that were all fixes for it being hard to see
   against the old cluttered field. Against the new one it was the opposite problem: the camera
   effectively drove through a near-opaque 5.5m photograph. Moved to 3.2m, so it passes beside the
   camera, large and unmistakable, as the held glimpse it was always specified to be.

**What did NOT change:** the three-act shape, guaranteed resolution, the single hard color pivot,
scroll pacing (deliberately — the "too long" fix from v2.17 stands; calm here comes from low
visual agitation, never from slower travel), and every dialogue, encounter, and camera system.

---

## REVISION (v2.17) — Calm, Premium, One Warm Family, a Shorter Road

*(Seventeenth round: a full design-language pass over the live build — goal: premium, color
aligned, easy on the eyes, a felt sense of calm — plus direct feedback: "the scroll feels too
long." Every change re-verified live in-browser. Read this first — older sections still apply
except where noted here.)*

1. **The journey is shorter by default.** `SCROLL.idleDriftDuration` 26s -> 18s (~30% faster at
   the default/gentle pace). `minDuration` (10s) deliberately unchanged — it's the verified floor
   below which the four traverse lines can't all be read (v2.9's arithmetic ceiling).
2. **The field breathes instead of strobing.** Streak pulse amplitude ±45% -> ±24%, per-streak
   brightness jitter tightened, speed-brightness and turn-cue boosts reduced. The trance act now
   actually reads as trance.
3. **Misty silk, not electric wire.** `COLOR.streakBase` softened (0x2f9fae -> 0x4f939e, same hue,
   lower charge) and streak width 0.04 -> 0.03 — fine luminous threads, easy on the eyes over a
   20-30s stare.
4. **One warm family.** The three competing oranges (accent 0xffb347, screen glow 0xff9a4d, guide
   0xffd9a0) are now one champagne band anchored on the Guide's own color: accent 0xe9bc82,
   screen glow 0xe0a266. Every warm element reads as the same light at different intensities.
5. **Quieter text chrome.** Dialogue type slightly smaller, wider-tracked, more open leading;
   scrim lightened; blob fill/glow reduced — light gathering faintly around a voice, not a
   highlighted UI region. Film grain 0.08 -> 0.05.
6. **The whiteout no longer glares.** Iris gradient stepped down from full-brightness gold to a
   softer cream — still warm overexposure after the dark, no longer painful to dark-adapted eyes.

**What did NOT change:** the three-act shape, guaranteed resolution, the single hard color pivot,
all trigger/hold/placement machinery, and every v2.16 fix are untouched. This round changes only
intensity, saturation, weight, and pace — the piece's structure is stable.

---

## REVISION (v2.16) — The Field Made Luminous, the Voice Made Clean, a Way Home

*(Sixteenth round: a full creative-director pass over the live running build — every phase walked
end-to-end in a real browser, screenshots at every beat, each fix re-verified live afterward. Read
this first — older sections still apply except where noted here.)*

1. **The vortex finally looks like the reference.** The streak field was coloring its particles
   with the near-black *environment* base (`COLOR.traverseBase`), so the teal majority of the
   field was essentially invisible — only the warm amber accent minority registered, and the whole
   tunnel read as sparse brown straw instead of a luminous teal-cyan vortex. Streaks now have
   their own authored luminous color (`COLOR.streakBase`), same hue family, bright enough to carry
   the field's identity. Verified live: the tunnel now reads as the reference image's cyan vortex.
2. **No more giant planks.** A streak passing within a meter or two of the camera projected as an
   enormous opaque bar slicing across the whole frame. Streaks now fade out (scale + color,
   smoothstepped over 1.2–5m) as they near the camera.
3. **The vision encounter is no longer drowned in mud.** The TV's glow-halo was 2.2x the screen's
   width at 0.5 additive opacity — a ~12m flat brown disc that swallowed the TV and silhouette
   both. Now 1.35x at 0.28: a tight ember rim; the TV reads crisply and the silhouette is finally
   legible against it.
4. **The speech blobs no longer read as a login form.** Two bugs and one styling flaw: (a) the two
   opening lines' blob wrappers were never seeded hidden (only their characters were), so line 2's
   empty glowing pill sat on screen for seconds before its text typed — each line's blob now
   appears only as its own line starts speaking; (b) the blob's inset glow ring and hard-clipped
   backdrop-blur both traced the border-radius as a crisp pill outline — both removed, leaving
   only soft outward halos; (c) when line 2 begins, line 1 settles back to a supporting weight so
   the exchange reads as one voice moving on.
5. **The opening copy is restored.** The shipped line had silently become "You're lost. it's a
   very human thing." — dropping "That happens —" (the clause that does the actual validating) and
   leaving a lowercase typo. Restored to the authored line.
6. **The title card no longer sits on the orb, and no longer assembles from noise.** Moved from
   42% to 30% viewport height (clear of the orb's on-screen band), and its reveal is now
   left-to-right (was `from: 'random'`, which mid-reveal read as garbled text) — the same
   typewriter language as every other text in the piece.
7. **The ending finally goes somewhere.** This is a 404 page, and it dead-ended: after the
   iris/whiteout the user was stranded on the final gold frame with no link anywhere (the skip
   button — aria-labeled "Skip to homepage" — merely fast-forwarded to that same dead end, then
   faded out; it also strobed half-visible there due to a reveal/recede toggle loop, now fixed).
   A quiet "Take me home →" anchor (`HOME_URL`, config.js) now assembles beneath "Welcome back."
   once the iris settles — the piece's actual job, routing a lost visitor onward, completed.

**What did NOT change:** the three-act shape, guaranteed resolution, the single hard color pivot
(streakBase is a brightness/legibility fix inside the existing teal family, not a palette change),
scroll pacing, dialogue triggering/hold machinery, encounter placement/timing, and every
alpha-keying decision are all untouched.

---

## REVISION (v2.15) — A Real TV, Not a Photo of One

*(Fifteenth round of playtest feedback, on the built v2.14 experience. Read this first — older sections still apply except where noted here. Applied via direct hand-edits, verified via a hand-rolled PNG decoder against both the old and new shipped assets, and via direct execution of the real vision.js module end-to-end against the new asset, not assumed.)*

**"I can still see the box around the tv, and it's still not big?"** Two real, separate, verified problems, neither of which the previous round's border-removal keying fix actually addressed:

1. **The source photograph itself was replaced.** The old TV asset was a plain photo with no real alpha channel, needing a fragile luminance+warmth keying hack to approximate a cutout — verified directly that even the two-factor version of that hack couldn't fully eliminate a faint box, because the photo's own background glow/vignette extended past the TV's silhouette all the way to the frame edges; no per-pixel threshold on that file could ever produce a clean edge. Replaced with a real rendered TV graphic that already carries clean, correct alpha transparency around its own silhouette — verified by decoding the file directly (the new asset is genuinely RGBA with real alpha; the old one was opaque RGB, alpha entirely faked). The keying hack is now gone entirely for this asset; its alpha is used as-is.
2. **A second, unrelated "box":** the screen's own glow-halo effect (behind the TV, giving it an ember-like radiance) was a flat, hard-edged rectangle — additively blended, but with no soft falloff texture, so it rendered as a literal glowing box regardless of what the screen photo itself looked like. Fixed by giving it the same soft, camera-facing radial-gradient glow every other light-emitting orb in this piece already uses, so it now fades to nothing at its own edge instead of ending abruptly.
3. **Size:** re-measured against the actual distance the camera sits at when an encounter reaches full visibility, and the screen was legible as only a small bright rectangle at that range. Widened meaningfully so it reads clearly as a television, not a smudge.

**What did NOT change:** the silhouette figure's own asset/keying, the encounter placement/timing/frequency, and every other system in the piece are untouched.

---

## REVISION (v2.14) — A Smooth Zoom Into the Light, Not a Jump

*(Fourteenth round of playtest feedback, on the built v2.13 experience. Read this first — older sections still apply except where noted here. Applied via direct hand-edits, verified by directly measuring the real GSAP timeline's own velocity at every beat boundary in the return phase, not assumed.)*

**"The last screen, where it's centering in, needs to be smoothed out — it feels like it jumps at the end of the tunnel to get to the center."** Root-caused to the camera's field-of-view (the "zooming toward the light" sensation the return phase's final centering IS, mechanically): the FOV widens once as the camera nears the light ('approach') and narrows back once more as it settles ('overflow'), and both of those tweens restarted their easing curve at a dead stop — meaning FOV velocity jumped instantly from motionless to fast the moment each beat began, rather than accelerating into it. Measured directly: 0 to +13.6 degrees/second in a single frame at the start of 'approach', and 0 to -17.1 degrees/second at the start of 'overflow' — exactly the kind of real, felt snap the feedback describes, even though the camera's own physical path was already smooth (verified separately — position/lookAt were never the problem). Fixed the same way an earlier round already fixed an analogous camera-position snap at this same span: each tween now ramps its own velocity up from zero over its first fraction of a second, rather than starting at full speed.

**What did NOT change:** every authored FOV value (60->70->62 degrees), every beat's duration, and the camera's own position/lookAt path are all untouched — this only smooths how quickly the FOV starts moving at two specific instants.

---



*(Thirteenth round of playtest feedback, on the built v2.12 experience. Read this first — older sections still apply except where noted here. Applied via direct hand-edits, verified via GSAP's own measured timeline durations against the hand-derived reveal-timing formula, not assumed.)*

**"Make the text appear like a typewriter, centered. Remove the bullet point like '.'. The text should feel like the guiding orb is speaking to the user."** The Guiding Orb's dialogue (opening two lines + the four traverse lines) no longer arrives as kinetic-typography art — characters flying in from a scattered offset, several at once. It now types out strictly left-to-right, one character at a time, each simply fading in at its resting position — the way a voice speaking live, word by word, actually reads. The five named "voices" from the previous kinetic-type system are kept, but they're now typing *paces* rather than motion profiles: an unhurried line types slower, an excited one faster, same character-to-line assignments as before. The dialogue is now centered (it read off-center once the arrival motion, which used to visually balance it, was removed), and the small glowing "voice marker" dot that used to sit before each line is gone — once the text was centered under it, it read as a stray bullet point rather than the name-tag it was meant to be. The typewriter reveal itself, plus the centering, now carries the "this is a voice speaking to you" read that the marker used to help supply.

**What did NOT change:** which line fires when (position-triggered), how long a line holds before fading, the re-arm/hysteresis system, the speech-blob framing, and every other system in the piece are untouched — only how each line's own characters arrive is different.

---

## REVISION (v2.12) — A Clearer Screen, a Bigger Screen, a Closer Guide

*(Twelfth round of playtest feedback, on the built v2.11 experience. Read this first — older sections still apply except where noted here. Applied via direct hand-edits, verified against the real shipped image asset (direct pixel decode) and via direct execution of the real per-frame update logic, not just a successful build.)*

**"Remove the border from the tv screen."** Not a styling bug — the perceived border was the source photograph's own gray plastic CRT bezel, which the old alpha-key (luminance-only) couldn't distinguish from real screen content because the bezel is dark enough to read as "content" on luminance alone (verified directly against the shipped file: the old key left the bezel at ~96% opacity). Fixed by adding a second keying factor — warmth (how much redder than blue a pixel is) — since the screen's real content glows warm amber/orange while the bezel is neutral gray. A pixel now has to be both dim enough *and* warm enough to survive keying; verified against the real file that this drops the bezel to ~1-5% opacity while leaving the warm content at ~94-97%, with the background still at exactly 0%.

**"Add jittering effect to the tv screen."** A small, fast, noise-driven positional/rotational unsteadiness — reads as an unstable CRT signal, not a shaking prop. Sampled off real elapsed traversal time (never the frozen per-traverse clock), so it never stalls regardless of scroll speed or direction, consistent with every other continuous ambient motion in the piece.

**"Increase the size of the tv screen."** Widened meaningfully (screen width 1.4m → 2m) — a prop the camera only glimpses from a distance needs to actually read as a screen, not a bright smudge.

**"Make the images show up from further for better visibility."** The vision encounter's plateau (full peak-opacity hold) and outer fade radius were both widened again (plateau 10m→14m, outer edge 26m→27m), verified against the real encounter spacing that this sits right at the safe ceiling before two encounters' fade zones would start to overlap — any further widening needs fewer/more widely-spaced encounters, not just a bigger radius.

**"Get the guiding orb a little bit closer."** The chase camera's following distance was tightened (5m → 3.5m behind the orb). Verified this still keeps the orb comfortably clear of the reserved lower band where the dialogue text lives (a real bug fixed back in v2.3) — it just reads as more present and less distant in frame.

**What did NOT change:** encounter count/placement fractions, the silhouette's own alpha-keying, the plateau curve's shape, and every other system in the piece are untouched.

---



*(Eleventh round of playtest feedback, on the built v2.10 experience. Read this first — older sections still apply except where noted here. Applied via direct hand-edits, verified by directly re-executing the real orbit math against the shipped code.)*

**"Let's add circling orbs around the silhouette, like energy spheres."** Each vision encounter now has its own small population of dedicated glow orbs in continuous, slow orbit around the silhouette's anchor point — always present at every encounter (not a population subset that happens to be nearby, which is what the existing companion-orb "surround" behavior already does), so they read as the encounter's own quiet energy rather than passersby drawn to it. Built from the same soft additive glow-sprite technique every other orb in this piece already uses, so it's an extension of an established visual language, not a new one. The orbits are deliberately slow and each one is individually varied (different speed, radius, direction, vertical offset) so the small cluster reads as several independent presences circling together, not one mechanical ring. They fade in and out in exact lockstep with the rest of the encounter (the same plateau curve from the previous round), so the whole apparition — figure, screen, and its circling energy — arrives and recedes as one held moment.

**What did NOT change:** the vision encounter's placement, frequency, alpha-keyed photographs, and plateau fade timing are all untouched; every other system in the piece is unaffected.

---

## REVISION (v2.10) — Time to Actually See It

*(Tenth round of playtest feedback, on the built v2.9 experience. Read this first — older sections still apply except where noted here. Applied via direct hand-edits. Verified by directly simulating the real chase-cam/proximity geometry against the shipped code, measuring actual seconds-of-legibility at real scroll speeds — not estimated.)*

**"The image fades in/out too fast, the user won't even understand what they're seeing."** A real, measurable problem, not a subjective tuning note: the vision encounter's opacity curve was a pure inverse-square falloff — a shape that only ever touches its own authored peak brightness for a single mathematical instant at the closest point of approach, then falls away immediately in both directions. Measured directly against the real chase-cam geometry: even scrolling at the slowest, most patient idle-drift pace, the encounter stayed reasonably legible for under two seconds — nowhere near enough time to actually register a photograph with real content (a figure, a couch, readable text on a screen), let alone at any faster pace. Fixed by replacing the falloff with a genuine plateau: full peak opacity across an actual held zone, not a single point, with the fade only happening in a ring further out. Verified this now holds at high legibility for 1.3-2 seconds even at maximum scroll speed, and 3.5-5+ seconds at a relaxed pace — with room to spare before the next encounter ever comes into view.

**What did NOT change:** everything else about the vision encounter (its placement, its alpha-keyed real photographs, its frequency) and every other system in the piece are all still exactly as they were.

---

## REVISION (v2.9) — Orbs That Actually Glow, a Teleport Bug Found Under the Glow, Room to Read at Any Speed

*(Ninth round of playtest feedback, on the built v2.8 experience. Read this first — older sections still apply except where noted here. Applied via direct hand-edits, same as v2.6-v2.8. Every claim below was independently verified by directly executing the real per-frame update loops against the shipped code — not estimated or eyeballed.)*

**1. "The movement of the orbs are very awkward."** Investigating this surfaced a real, serious, pre-existing bug that simply wasn't obvious until this round's other change (see item 2) made the orbs bright enough to notice it: companion orbs recycle behind the camera using a "wrap around" trick — the same one the particle-streak field uses — but unlike the streak field, nothing ever faded an orb's opacity as it approached its own recycling point. Verified directly by executing the real update loop against a live camera sweep: orbs were teleporting 200-290 meters across the tunnel in a single frame while still fully opaque. A second, smaller version of the same class of bug was found in this round's own new "surround the vision encounter" behavior (v2.7/v2.8) — at high encounter density, an orb could start blending toward a newly-nearest encounter before it had finished releasing its previous one, producing a smaller but still real snap. Both are fixed: orbs now fade smoothly to fully invisible before their wrap-around recycling point, and an orb only ever adopts a new encounter to orbit once it has fully finished leaving its previous one.

**2. "The portal orbs doesn't have the glow effect, they need to represent soft glowing orbs of soul."** Both companion orbs and the "seeking orb" encounters were, underneath, literal solid spheres with a flat lit-looking material — never actually glows in the rendering sense, just small colored balls. Replaced with the same additive, soft-edged sprite technique the Guiding Orb already uses (a bright core plus a larger, dimmer, soft halo, sharing one radial-gradient texture), now factored out into a shared building block both populations use. They read as genuine light now, not geometry.

**3. "We also need to ensure all the texts are rendered, and read by the user... if I scroll through too fast, I'm missing a lot of the texts."** Two compounding causes, both fixed: a dialogue line queued behind the pacing floor added two rounds ago was being silently dropped the instant the user scrolled slightly past its trigger point in EITHER direction — but that drop-margin clears in a fraction of a second at real scroll speeds, while the queue is meant to hold a line for up to several seconds, so ordinary fast scrolling (exactly the case the queue exists to help) was itself clearing the queue before a line could ever appear. Fixed to only drop a queued line on genuine backward scrolling, not continued forward progress. Separately, and more fundamentally: at the fastest possible scroll speed, the entire journey completed faster than the minimum reading-room floor required to show even half the dialogue lines — a hard arithmetic ceiling no amount of per-line pacing could work around. The scroll-speed ceiling itself is eased back slightly so the fastest possible pace still comfortably allows every line to be read.

**4. "Thinking if we should show the silhouette and the TV screen only at the ending screen?"** Considered and recommended against, as creative director: the ending sequence is a fast, warm-whiteout climax whose entire visual language is "light overtaking the frame" — a near-black couch/silhouette composition would fight that rather than support it, especially appearing there for the first time. The actual problem with the vision encounter wasn't where it lived, it was how often it repeated — the previous round's 24 appearances turned a poignant glimpse into wallpaper. Brought down to a small, deliberate number of encounters instead, keeping it inside the journey where it already has a proven, safe framing.

**What did NOT change:** the three-act shape, guaranteed resolution, the single hard color pivot, resonance-not-response, the restrained kinetic typography and reveal-completion pause floor, the retuned curve/chase-cam damping fix, the real-image vision encounter's placement/alpha-keying, the chase-cam follow-damping, the speech-blob dialogue framing, and the continuous scroll-driven companion convergence are all still load-bearing.

---

## REVISION (v2.8) — The Silhouette's Real Bug, a Field of Visions, Orbs of Every Color

*(Eighth round of playtest feedback, on the built v2.7 experience — this time accompanied by the user's own reference screenshot of the source image. Read this first — older sections still apply except where noted here. Applied via direct hand-edits, same as v2.6/v2.7. Every claim below was independently verified by directly decoding and sampling the real shipped image files and executing the real curve/chase-cam/companion-orb math — not estimated or eyeballed.)*

**1. "Still don't see the silhouette?"** The v2.7 placement/visibility fix was real, but it wasn't the actual reason the silhouette never appeared — investigating this round with the user's own reference image in hand led to directly decoding the real shipped photograph and sampling its actual pixel values, which found the true bug: the figure is deliberately painted as a very dark, smoky shape (luminance roughly 6-12 out of 255), but the alpha-keying threshold that separates it from its pure-black background was tuned wrong, treating anything at or below 18 as "background" — silently making about 97% of the figure's own body transparent, leaving only its brightest rim-light edges. The true background sits at luminance 0 with zero measurable noise, so the threshold could be tightened dramatically with no risk of clipping into it. This is the actual, sole reason the silhouette never showed up — not a placement, distance, or curvature problem, all of which were real bugs already fixed but none of which were *this* bug.

**2. "The silhouette and the screen needs to come into the portal repeatedly, clearly, floating, 20-30 times maybe."** The vision now appears 24 times through the traverse, evenly spaced, using the same placement approach already proven to generalize cleanly across the whole curved path (verified directly: every single one of the 24 positions reaches strong, consistent visibility, not just a few hand-picked favorable spots). The encounter is also brought slightly closer to the travel axis for extra visibility headroom now that there are so many of them to register.

**3. "The floating orbs in the portal, give them similar glow, vary it out, give them diverse range of colors to feel mesmerizing, ensuring that this truly feels like people are on their own journey of exploration."** Every companion orb now has its own distinct hue, evenly spread across the full color wheel (never two adjacent orbs landing on near-identical colors by chance), while sharing the exact same glow character — brightness, pulse, opacity behavior, sighting/surrounding responses — as before. The effect: a field of many individually-colored small presences rather than one repeated color, literally reading as many different journeys sharing the same void, converging toward the same warm light at the very end regardless of which color they arrived as. The companion-orb "surround the silhouette" behavior from v2.7 was also generalized to correctly handle this round's much higher number of vision encounters — a subset of orbs now gathers around whichever encounter is nearest at any moment, rather than being permanently tied to one of a small fixed number of encounters (which would have broken down at 24).

**What did NOT change:** the three-act shape, guaranteed resolution, the single hard color pivot, resonance-not-response, the restrained kinetic typography and reveal-completion pause floor, the seeking orbs, the retuned curve/chase-cam damping fix, the chase-cam follow-damping and light-based orb rendering, the speech-blob dialogue framing, and the continuous scroll-driven companion convergence are all still load-bearing.

---

## REVISION (v2.7) — The Vision Made Visible, a Sharp Turn Straightened, Orbs That Gather

*(Seventh round of playtest feedback, on the built v2.6 experience. Read this first — older sections still apply except where noted here. Applied via direct hand-edits, same as v2.6. Every claim below was independently verified by directly executing the real chase-cam/curve/companion-orb math against the shipped code — not estimated or eyeballed.)*

**1. "I don't see the 404 screen and the silhouette? We should repeatedly show the 404 screen in the portal + the silhouette looking at it."** Two real, distinct, verified problems, not one: (a) the single vision encounter was placed far enough off the travel axis (4.5m) that, measured directly against the real chase-cam geometry across its whole approach window, it only ever reached ~47% of its own authored peak opacity, in a narrow window that was also mostly off the camera's actual boresight — technically present, essentially never actually seen; (b) it only appeared once. Both are fixed: the encounter is brought in closer (2.2m) with a wider proximity radius (18m), verified to roughly double both peak visible opacity and the number of frames it's genuinely on-screen and bright, and it now repeats three times through the traverse rather than once.

**2. The Guiding Orb's jitter "when the screen starts" turned out to share a root cause with item 1.** Investigating the jitter report led to measuring the actual curvature of the journey's own curved path directly — and finding a genuine, sharp spike in how fast the path's direction changes right around the traverse's midpoint, nearly 4x sharper than anywhere else on a comparable stretch, and sitting almost exactly on top of where the (old, single) vision encounter lived. A turn that sharp overwhelms the chase-cam's own tangent-following damping, which is the literal mechanical cause of the orb visibly jittering right as the encounter came into view. The path's mid-journey waypoint is retuned to continue its existing leftward bank/rise more gently instead of reversing it outright — still a real, felt swing in the journey, just no longer sharp enough to fight the camera's damping. Re-verified directly against the real curve: peak curvature in that stretch dropped roughly 7x, and the orb's own measured jitter (frame-to-frame acceleration) in that region is now indistinguishable from the rest of the journey's ordinary texture.

**3. "Let's make the other orbs lively as well, and make them surround the silhouette."** A dedicated behavior (mirroring the existing companion-orb "sighting" mechanism already in the piece, not a new system) now pulls a small cluster of the ambient companion population into a slow, continuous orbit around each vision encounter's own position while the camera is near it — brightened slightly above their normal ambient dimness so they read as genuinely drawn to the moment, not just incidentally nearby. Fully continuous and reversible, exactly like every other proximity-driven behavior in this piece: scrolling backward past an encounter smoothly un-gathers the same orbs rather than snapping them away.

**4. "Increase the time a little bit for how long the texts stays."** The traverse dialogue's leisurely hold ceiling (the amount of time a slow/idle scroller gets to read a line before it fades, per v2.6's own reveal-then-pause-then-fade guarantee) is raised from 3.4s to 4.2s. The speed-aware compression that shortens this for a fast scroller (so lines never overlap) is untouched — this only raises the comfortable upper bound.

**What did NOT change:** the three-act shape, guaranteed resolution, the single hard color pivot, resonance-not-response, the restrained kinetic typography and reveal-completion pause floor (v2.6), the seeking orbs (v2.6), the chase-cam follow-damping and light-based orb rendering, the speech-blob dialogue framing, and the continuous scroll-driven companion convergence are all still load-bearing.

---

## REVISION (v2.6) — Restrained Kinetic Type, a Real Pause Before Fading, Orbs That Search Instead of Numbers That Appear

*(Sixth round of playtest feedback, on the built v2.5 experience. Read this first — older sections still apply except where noted here. This round was applied via direct hand-edits rather than the usual agent-swarm build process, after the swarm's second advisor-review pass hit a hard account budget cap mid-run — round 1 of that v2.5 swarm review had already completed and landed cleanly; only the second, confirmatory pass was skipped. Everything below was independently verified by directly executing the relevant math/timing logic against the real shipped code, not merely inspected.)*

**1. "Make the text appearance cinematic kinetic typography art. Make the motions subtle."** The per-line motion-character system (five named "characters" — settling/inviting/reassuring/wistful/anticipatory) was moving characters up to 85% of a line-height with up to 55° of per-character rotation — closer to text flying in from scatter than restrained, art-directed kinetic type. Every character's amplitude is cut roughly 4-6x (yPercent now 8-18%, rotateX now 5-12°), and a blur-to-sharp resolve is layered onto every text reveal in the piece (title card, both opening Guiding-Orb lines, all four traverse lines) — a technique the return-copy element already used on its own, now extended everywhere for one consistent, considered kinetic-type language rather than one element behaving differently from the rest.

**2. "The text needs to fully render, pause for a tiny amount of time, then start disappearing, or else it's a jarring effect... the user is just rushing through it."** Investigating this surfaced a genuine bug, not just a subtlety complaint: the per-character stagger was authored as a PER-CHARACTER time increment (GSAP's `{ each }` shape), so a line's true total reveal time scaled with how many characters its copy happened to have — measured directly (not assumed) against the real shipped code, the longest lines were taking up to **~5.5 seconds** to finish revealing, nearly 4x their own declared "duration" value, which is exactly the number `resolveTraverseLineHoldSeconds()` was using as its reveal-completion floor. A line's fade-out could genuinely be scheduled to start while the line was still mid-assembly. Fixed at the root two ways: (a) stagger is now authored as a fixed total spread (`{ amount }`) rather than a per-character increment, so total reveal time is a constant, length-independent value the hold-fitting logic can compute exactly rather than underestimate; (b) a new, explicit minimum settled-pause floor is reserved on top of that real reveal time, guaranteed regardless of scroll speed — "fully render, pause, then fade" is now a real, measured guarantee, not an accident of how long a reveal happened to take.

**3. "I noticed we have random numbers showing up in our portal... we should show hanging orbs that are trying to find themselves, properly choreograph this."** The two "404" glyph-formation encounters (scrambled characters resolving into the numeral, mid-traverse) are retired entirely — they read as a disconnected number gag rather than something belonging to this piece's own emotional register. Replaced with small clusters of orbs, visually kin to the Guiding Orb and the ambient companion orbs (extending an established visual language rather than adding a fourth, unrelated one): while distant, each cluster's orbs visibly wander and flicker uncertainly — individually varied jitter/rate so a cluster of several orbs reads as several small, independently-searching presences, not one animation repeated — and as the camera approaches, the wander and flicker smooth into a calm, brightening, steadying glow that peaks at closest approach and holds there permanently once settled (a one-shot "found, once" moment, mirroring the retired system's own one-shot resolve discipline and the whole piece's own "lost → found" arc). The underlying placement/dwell-time-fitting machinery is deliberately unchanged from the retired system (same two encounter positions, same proximity-fitted choreography timing, same worst-case-dwell floor for fast scrollers) — only the visual/thematic content is new, not the mechanism other modules (camera framing, particle-field regional density) already key off of.

**What did NOT change:** the three-act shape, guaranteed resolution, the single hard color pivot, resonance-not-response, the curved journey path, the chase-cam follow-damping and light-based orb rendering, the speech-blob dialogue framing, the continuous scroll-driven companion convergence, and the real-image vision encounter (v2.5) are all still load-bearing.

---

## REVISION (v2.5) — The Vision Mid-Journey, Real Photographs Instead of a Recreation, Room to Read

*(Fifth round of playtest feedback, on the built v2.4 experience. Read this first — older sections still apply except where noted here.)*

**1. "I don't see the room/tv, I think it's better to just use the image somewhere in the journey portal, a random shadow, staring at the 404 tv."** Two decisions packed into this note, both honored: first, the room/TV cold-open is **removed from the fall-in entirely** — staging content against `drop`'s own fixed, near-vertical autoplay camera tangent proved structurally fragile (it took two separate rounds of advisor fixes just to get the framing merely on-axis, and it apparently still didn't land for the user watching the real build). Second, and more interesting: the user reversed their own earlier direction. v2.4 deliberately recreated the reference photos in the vortex's procedural style, reasoning that literal photographic imagery would clash with the piece's coherent teal/amber visual language. The user now wants the **actual reference images** — the silhouette on the couch, the glowing "ERROR 404" TV — used directly. Both images are pre-cut, transparent-background photographic/painterly renders (not snapshots), which turns out to matter: they already read as apparitions, not documentary photos, so using them directly doesn't fight the vortex's dreamlike register the way a literal snapshot would have.

The images now live as a **single in-tunnel encounter partway through the traverse** (`VISION_ENCOUNTER`, config.js) — placed exactly like `glyphs.js`'s existing "404" glyph-formation encounters and `COMPANION_ORBS`' sighting moments: a fixed position along the scroll-paced travel axis, faded in/out by proximity as the camera actually flies past it. This is a structurally safer home for this content than the fall-in ever was — the traverse camera is chase-cam-derived from the orb's own scroll-paced position, not an independent autoplay curve, so "does this framing actually work" is the same solved problem glyphs.js and the companion sightings already are, not a new one. It reads as exactly what the user described: a random, glimpsed apparition — a figure, still watching a screen that still says you're lost — passed once, off to the side, mid-journey. Not a plot beat, not a puzzle, just a haunting image the void happens to be holding.

Because the room/TV cold-open is gone, so is its knock-on machinery: the Guiding Orb no longer "ignites from the dying screen" (v2.4 item 2) — it reverts to simply already being present and lit from the very first frame, its v2.1 original character. `BEATS.drop`/`freefall`/`catch`/`traverse.start` revert to their pre-v2.4 timings, since nothing needs the fall-in beat held open for scenery anymore.

**2. "The texts move too fast, we should think about how we should give them room to appear when a user is scrolling through fast."** This is a real, distinct gap from v2.3's fix, not a regression of it. v2.3 made a line's *hold duration* shrink as needed so it never overlapped the *next* trigger — but that's a guarantee about not overlapping, not a guarantee about having genuinely arrived and settled first. At high scroll speed, several trigger fractions can be crossed in quick succession; each line could still be fired, held for barely more than its own arrival animation, and cut, one after another — nothing overlapped, but nothing had room to actually be *read* either. The fix is a floor on real wall-clock time between the start of one line's reveal and the next, independent of how many trigger positions get crossed in that window. A trigger crossed while this floor hasn't elapsed yet doesn't fire immediately and doesn't get dropped — it's remembered as the one pending line, and fires the moment the floor is satisfied. If a still-newer trigger arrives before that, it simply replaces the pending one (only the most recent moment is ever queued) — consistent with "resonance not response": the piece doesn't owe the user every possible line, only genuine room to read whichever one it shows.

**What did NOT change:** the three-act shape, guaranteed resolution, the single hard color pivot, resonance-not-response, the curved journey path (v2.3), the chase-cam follow-damping and light-based orb rendering (v2.4, both independent of the now-removed room scene), the speech-blob dialogue framing (v2.4), and the continuous scroll-driven companion convergence (v2.4) are all still load-bearing.

---

## REVISION (v2.4) — The Room Before the Fall, an Orb That Leads Rather Than Is You, a Real Light Instead of a Ball

*(Fourth round of playtest feedback. Read this first — older sections still apply except where noted here.)*

**1. A cold-open: the room, the couch, the dying TV.** The user provided two reference images — a figure slumped on a couch, and an old TV glowing amber with "ERROR 404 / PAGE NOT FOUND / YOU ARE LOST." Rather than importing the literal photographic/painterly assets (which would clash with the vortex's own coherent procedural teal/amber visual language everywhere else), this is **recreated in the existing style**: a dim, warm-toned room built from the same primitives already in use (unlit emissive geometry, no new rendering system) — a silhouette shape, a couch shape, and a small glowing "screen" plane carrying the "404 / YOU ARE LOST" text via the same troika-text approach the "404" glyph-formations already use elsewhere in the piece.

This is **not a held establishing shot** (that mistake was already made and corrected once this project — see v2.1's silhouette removal). It is the literal first ~1–1.2 seconds of the existing `drop` beat: the camera is already pushing forward, toward the screen, from frame zero. The screen's glow overtakes the frame; room, couch, and silhouette are consumed by the light and never seen again — this is the fall's actual visual mechanism, not a separate scene bolted in front of it.

This produces a deliberate **warm → cold → warm** structure across the whole piece: the ember-toned room (opening) gives way to the vortex's cold teal void (the entire journey), which resolves into the warm gold overflow (the ending). The piece now literally rhymes with itself — leaving one light, traveling through the dark, arriving at another. This is new, and worth stating as its own principle alongside the existing three-act arc.

**2. The Guiding Orb ignites from the dying screen.** As the TV's glow is what consumes the frame, the orb is authored to spark directly out of that same dying light — a single ember leaping free of the screen — rather than simply already existing in the void with no origin. This gives it a concrete birth as *something other than the user*, which is the first half of fixing feedback item 3 below.

**3. "It feels like the orb is guiding me... it feels like the orb is 'me.'"** This has a real, mechanical cause, not just a vibe: the chase-camera currently copies the orb's exact position every frame with zero independent smoothing of its own — any bob or weave in the orb is instantly and identically mirrored by the camera, which is mechanically indistinguishable from "the camera *is* the orb wearing a costume." A camera that is actually *following* something always lags slightly behind its subject's exact motion — that's what following *means*, kinematically. The chase-cam now has its own independent, slightly slower damping on top of the orb's motion, so the orb's movement reads as something the camera is reacting to a beat later, not a rigid 1:1 attachment. Combined with item 2's origin-story fix, this is meant to resolve the confusion at both the narrative and the mechanical level.

**4. "We should show maybe some text blobs to make a conversation."** The orb's dialogue currently renders as plain floating text with no visual container — nothing frames it as *speech*. Each line now appears inside an actual soft, glowing speech-blob shape (not a hard-edged UI chat bubble — a soft, irregular, glowing form consistent with the orb's own light-in-the-dark visual language), so the dialogue reads unambiguously as the orb *speaking*, i.e. a conversation happening, not narration floating independently in space.

**5. A new visual design for the orb itself — a light, not a lit ball.** The existing orb reads as a solid sphere with an emissive material. The user's spec (verbatim, kept as the design reference) describes something categorically different: **a light source in darkness, not an object** — a bright near-white/warm core, several concentric rings of falloff at decreasing opacity, and a large soft outer glow that dissolves into the background via opacity alone, never a hard edge. Same established color (the existing warm `GUIDE.color`), rebuilt as genuine radial light-falloff rather than a shaded sphere. Gentle float and a subtle breathing pulse (both of which the orb already has, from earlier rounds) are kept and folded into this new visual, not replaced.

**6. "The ending feels off — all the orbs suddenly jump into the bigger orb, it needs to flow with the scroll."** The companion-orb convergence at the end currently reads as a discrete cutscene-like snap rather than a continuous motion tied to the user's own scrolling — likely because convergence is triggered as a one-time state flip at a beat boundary rather than being a continuous function of actual scroll/travel progress. Convergence must become continuous and monotonic with the same progress value driving everything else in the return phase, ramping in smoothly *before* the beat boundary rather than switching on at it, so it feels like a natural consequence of the user's own continued scrolling, not an authored moment that happens *to* them independent of their input.

**What did NOT change:** the three-act shape, guaranteed resolution, the single hard color pivot, resonance-not-response, the curved journey path (v2.3), and the Guiding Orb's core character and hand-off-to-light arc are all still load-bearing.

---

## REVISION (v2.3) — Curved Journey, Living Orb, Flowing Text

*(Third round of playtest feedback, on the v2.2 build. Read this section first — it's the authoritative summary of this round's changes; older sections below still apply except where noted here.)*

1. **"The camera feels too static, maybe due to straight path... we want it to feel like a journey, rather than a straight boring path."** Root-caused, not patched: the travel path was a literal mathematically-straight line the whole time — the spiral particle motion and camera bank were cosmetic overlays on top of a dead-straight camera trajectory, which is why it never stopped feeling flat regardless of how much surface texture was added. Fixed by replacing the straight axis with one continuous curved path (`config.js`'s new `PATH.waypointOffsets`, a real `CatmullRomCurve3`) spanning the *entire* journey — fall-in, traverse, and the return phase all sample the same curve now, not three independent straight-line systems.
2. **This same fix directly answers "the ending needs to flow with the movement, rather than feeling like a separate segment."** The return phase used to be a structurally different camera system (its own straight-line math) that took over once the orb dissolved. Now it's a continuation of the exact same curve — the ending is the path finishing, not a different path starting.
3. **"The orb needs to glow, animated, living... follow some more movement."** The orb gets a genuine pulsing glow (tied to the same pulse-bpm rhythm the rest of the field breathes to) independent of its position bob, plus a small amount of its own lateral weave on top of whatever character the new curved path already supplies — so it reads as an animate, breathing companion, not a lit ball that happens to move forward.
4. **"The other orbs need to settle within the bound of the portal pathway."** A real, direct bug: companion orbs were placed 20–60m from the axis while the visible tunnel itself only extends to 14m — they were floating entirely outside the portal, in space the vortex field doesn't even reach. Distances corrected to sit inside the tunnel radius.
5. **"For the texts, it feels like they lack emotion (in motion)... the orb is covering some text... the text needs to be cinematic, flowing... if I keep scrolling it feels like the text is rushing."** Three fixes: more expressive, varied motion per dialogue line (not one generic stagger reused everywhere) with a subtle continuous life even after a line is fully revealed; the dialogue box repositioned with guaranteed clearance from the orb's on-screen region; and each line's on-screen hold time now scales with actual scroll speed (mirroring the existing glyph dwell-time system) so fast scrolling doesn't compress or overlap consecutive lines.
6. **"I'm confused on why we have 012 there."** A genuine bug, not a design choice: the glyph-formations' resting/pre-resolve text was generated via `SCRAMBLE_CHARS.slice(0, 3)`, which on a fixed string literal always evaluates to the exact same three characters ("012") instead of the randomized scramble noise the design intended. Fixed to genuinely randomize.
7. **"The whole environment needs to feel alive, more stories embedded there, things happening around, others moving around, evolving."** Companion orbs get individually-varied motion (not 14 copies of one animation) and the environment gains small one-off ambient events distinct from the two scripted "sightings," so things read as happening on their own terms, not only ever in reaction to the user's presence.

**What did NOT change:** the three-act shape, guaranteed resolution (a curved path is still exactly as unicursal as a straight one — curvature changes shape, never adds branches or choice), the single hard color pivot, resonance-not-response, and the Guiding Orb's core character (validating, unhurried, hands off to the light) are all still load-bearing.

---

## REVISION (v2.2) — Follow-the-Orb, Bidirectional Scroll, Living Space

*(Second round of playtest feedback, on the v2.1 build. This section is the authoritative summary of everything that changed this round — read it first. Every numbered item below traces back to specific user feedback; the older per-lens sections further down are still valid but should be read as amended wherever they conflict with this section.)*

1. **"The position of the orb isn't in a position where it's guiding the user."** Fixed structurally, not cosmetically: the camera now genuinely **follows the orb** (a chase-cam — behind and slightly above it, looking at/past it) during fall-in and the traverse, rather than the orb floating a fixed distance ahead of an independently-computed camera path. The orb's position now *drives* where the camera goes, not the other way around. See Section 2/3's updated Act I/II camera language and `ARCHITECTURE.md`'s `guide.js`/`vortex.js`/`camera.js` sections for the technical restructuring this required.
2. **"There's no interesting stories going on... others who are lost as well... orb going up and down is distracting... ending needs to be more coherent... none of this should feel lagging."** Four concrete responses:
   - The orb's bob amplitude is reduced and slowed so it reads as a barely-perceptible living quality, not an obvious mechanical animation (`GUIDE.bobAmplitude` cut by more than half).
   - Companion orbs now have deliberate "sighting" moments (a cluster drifts noticeably closer at two specific points in the traverse, `COMPANION_ORBS.sightingAxisFractions`) rather than existing only as constant, easy-to-miss background ambience — the "you're not alone" theme now has actual beats, not just a permanent backdrop.
   - At the end, companion orbs **converge into the same overflow light** the Guiding Orb dissolves into (`COMPANION_ORBS.convergeAtEnd`), unifying the finale into one coherent image — "everyone finds their way, together" — instead of the guide dissolving alone while the companions are simply left behind, unremarked.
   - The return phase (turn/approach/overflow/iris) durations are cut roughly in half (see item 8) — a faster, tighter ending reads as more coherent partly because it isn't given time to feel disjointed or padded.
3. **"Initial camera movement needs to hook the user, and be interactive."** Mouse-look (small yaw/pitch) is now active during the fall itself (`CAMERA.fallInParallax`), not just during the traverse. This is gaze-only, not pace — the fall still happens on its fixed autoplay curve (preserving "control as instrument": Act I still strips *pace* control, it just no longer strips *gaze* control too).
4. **"The scroll needs to be able to go forward and backward."** Scroll is now bidirectional — velocity is signed, and the user can scroll back to revisit any point already passed. Guaranteed resolution is preserved by keeping idle-drift as a small, constant *forward* bias (never zero) — a user who only ever scrolls backward, or does nothing, still eventually completes the traverse. Backward maximum speed is deliberately a bit slower than forward (`SCROLL.backwardVelocityScale`), so reversing is real and useful without the piece losing its overall forward lean.
5. **"Cinematic kinetic text having conversation... interactions to fiddle with... visual, psychological conversations throughout... living, evolving, not dead."** Three additions:
   - The Guiding Orb's voice continues at intervals through the traverse (`GUIDE_DIALOGUE_AXIS_FRACTIONS` — four more short lines beyond the original two, position-triggered so they land at the same place regardless of scroll speed or direction), not just at the very start.
   - A click/tap-triggered particle-burst ripple (`RIPPLE.clickBoostGain`/`clickFadeDurationSeconds`) — the explicit "something to fiddle with," still fully resonance/decay-based, never gating progress, distinct from the existing passive gaze-driven wake trail so it has its own more deliberate payoff.
   - The vortex field itself now has a slow, continuous evolution over real elapsed time (`VORTEX.livingCycle`), not just over travel-axis position — so lingering in one place (including via backward scroll) never reads as a frozen loop.
6. **"Audio shouldn't be just at the end... start from the start in the slightest possible way, then create audible interest as it moves forward (no music anywhere)."** Audio is redesigned as one continuous ambient soundscape (`AUDIO` constants) starting near-silent at t=0 and building gradually through the whole piece — the existing Act III riser/swell is the peak of this same continuous layer, not something that switches on separately. Explicitly texture/drone-based (filtered noise, granular grain, sub-bass) — no melodic or harmonic content, ever.
7. **"The user should be able to go through this with the psychological feeling of fast, and also experience the whole experience."** This is a perception-craft note, not a duration cut (the point is explicitly to feel fast *without* skipping content): lean on velocity-linked visual cues (motion blur/streak intensity, subtle chromatic aberration tied to scroll speed rather than only to the Act I fall) so the *sensation* of speed scales with how the user is moving, independent of the actual wall-clock time they spend experiencing every beat.
8. **"The ending screen is too much dragged."** `BEATS.turn`/`approach`/`overflow`/`iris` durations cut from a combined 12s to 5.5s — see item 2's note on why a tighter ending also reads as more coherent, not just shorter.

**What did NOT change:** the three-act shape (Fall → Traverse → Overflow), the guaranteed-resolution/no-failure-state principle, the single hard color pivot, the "resonance not response" interaction philosophy, and the Guiding Orb's core character (validating, unhurried, hands off to the light rather than persisting) are all still load-bearing and still hold under this revision — everything above is either a structural fix (orb positioning, bidirectional scroll) or additive content (more dialogue, more sighting moments, continuous audio), not a change to the piece's underlying values.

---

## 0. The One Insight Everything Else Depends On

**REVISION (v2.1): the silhouette bookend is gone, replaced by a recurring character — the Guiding Orb.** *(Playtest feedback on the v2 build: the opening silhouette "looks very bad." Removed entirely — see below for what replaces it, and Section 1 for the full character treatment.)*

**REVISION (v2): Build a void, not a maze.** *(Original v1 concept — "build a labyrinth, not a maze" — is preserved at the end of this document for reference; the pivot below supersedes it as the active direction. The load-bearing insight underneath survives the pivot intact — see below.)*

The v1 concept solved "psychological thrill + calm trance" via a labyrinth: the aesthetic of a maze (walls, turns, enclosure) with the mechanic of a unicursal path (no wrong turns, guaranteed resolution). The pivot replaces the *aesthetic* — walled corridor → open particle-vortex void, walking → flying/falling through a flow field, modeled on a reference image of a gravitational vortex: countless thin teal-cyan particle-streaks flowing along field lines into a dark central aperture, a lone silhouette at the threshold.

The underlying insight doesn't change, it simplifies: **there is nothing to bump into.** A labyrinth needed an explicit unicursal-path guarantee because walls create the *possibility* of a wrong turn even when none exists. Open void has no walls, so "the user can never get lost" is true by construction, not by careful path design — the camera simply flies along one fixed trajectory through the flow field, and the user is never asked to choose one direction over another. Same fulcrum (guaranteed resolution enabling both thrill and calm), fewer moving parts.

**What's new in v2, layered on top of the original three-act arc (Fall → Traverse → Overflow) rather than replacing it:**
- **Visual metaphor**: a particle-based gravitational vortex/wormhole (teal-cyan streaks on near-black, per the reference image) instead of a walled corridor.
- **Scroll-driven traversal (hybrid, not full-timeline)**: the middle act — now "traveling through the milky way to find a way out" rather than "walking a labyrinth" — is scroll-paced. Act I (falling in) and Act III (re-entering the world) stay autoplay/cinematic, preserving the "control as instrument" principle from Section 3/the non-negotiables: control is stripped for the fall (vertigo), returned for the traversal (agency), stripped again for the return (generosity — light comes to you, you don't scroll to it).
- **A Guiding Orb (v2.1, replaces the original silhouette idea)**: a single warm, glowing companion, present from the very first frame through the end of the traverse — see Section 1 for its full character.

Everything below is updated section-by-section for v2/v2.1; where a section's guidance didn't need to change, it says so explicitly rather than repeating itself.

---

## 1. The Storyteller's Lens — What Is This Story Actually About?

A 404 is a small failure: intention met void. Most 404 pages either apologize (boring) or joke (forgettable). The opportunity here is to make the *failure itself* the content — to let the user feel the "lost-ness" as an actual sensation for a few seconds, then resolve it. That resolution is what they'll remember, not the joke.

**Arc (three-act, compressed to ~20–40 seconds) — v2.1:**

- **Act I — The Fall (loss of ground).** The floor the user expected (the page they wanted) is gone. We don't soften this — we let them feel it drop out from under them for a beat. This is the "psychological thrill" — a genuine, brief vertigo. **v2.1: motion begins immediately at t=0** — no held establishing shot (the earlier silhouette idea read badly in practice and is removed). The Guiding Orb ignites alongside the camera in the very first frame, already present as the fall begins — see below for its full character.
- **Act II — The Traverse (surrender).** Falling becomes flying/drifting through a field of light — "traveling through the milky way to find a way out of the void." The panic has nowhere to go because there's no decision to make about *direction* — the path is fixed — but unlike the labyrinth, the user now *paces* the journey themselves via scroll (see Section 3). This is where thrill converts to trance: repetition, rhythm, low information load, now combined with a felt sense of self-directed velocity. Still the emotional center of the piece, still the longest beat. The Guiding Orb leads throughout, and distant companion orbs (see below) populate the field.
- **Act III — The Overflow (return with a gift).** Light doesn't just appear — it *overflows*, spilling toward the user rather than the user scrolling up to it. Scroll control is deliberately taken away again here — they didn't find their way out through effort; they're being *poured back* into the world. That inversion (light comes to you, rather than you reaching light) is what makes the return feel generous instead of like "puzzle solved." The Guiding Orb dissolves into this light rather than accompanying the user all the way to the end (see below) — the light itself, not the orb, is what delivers the final generosity beat.

**Tone guardrail:** unchanged from v1 — calm-with-thrill, not horror. No jump scares, no predatory shapes, no sense of being hunted. Think *"floating in a planetarium at night."*

**The Guiding Orb (v2.1 — new character, replaces the removed silhouette idea).**

A single warm, glowing companion, roughly the size of a large marble, present from the very first frame of the fall through the end of the traverse, always drifting a comfortable distance ahead of the camera along the path. It is never a puzzle element, never clickable, never something the user directs — it simply *is there*, leading, the same "resonance not response" way everything else in this piece behaves (Section 5).

**Character and voice — this is the load-bearing addition.** The orb is not a wayfinding UI marker with a neutral affect; it has a specific emotional register, established directly via two short lines of assembling overlay text near the very start (using the same SplitText-coalescing treatment the title card already uses, so the copy *arrives* rather than just appearing):

> *"You're lost. That happens — it's a very human thing."*
> *"Follow me. I'll show you the way."*

The first line validates the feeling without minimizing it — it doesn't say "don't worry" or "you'll be fine," it names the feeling and normalizes it as something universal. The second line is a plain, confident invitation, not a command. Together they set the orb's whole character: *positive, accepting, unhurried, genuinely on your side.* Every other design decision about the orb (gentle bob rather than a rigid locked-on-axis hover, warm-but-soft color rather than a piercing beacon, no urgency in how it leads) should reinforce this same register — it is a companion, not a system prompt.

**Companion orbs (v2.1, new) — "you're not alone."** The field is populated with other, dimmer, cooler-toned orbs drifting at a distance — never close enough to read as obstacles or a second guide, never interactive. They exist purely as environmental storytelling: other travelers, also finding their way, visible at the edges of attention. This directly extends the Guiding Orb's validating message from words into the world itself — the piece doesn't just *tell* the user being lost is a shared human experience, it *shows* them a field full of others in the same passage.

**The handoff, not a persistence.** The orb accompanies the user through the fall and the entire traverse, then **dissolves into the Act III overflow light** as the return phase begins (rather than leading all the way to the literal end) — narratively, it delivers the user to the threshold and the light itself takes over. This preserves the existing, load-bearing "light comes to you" inversion (light overflows *toward* the user in Act III, they don't walk/scroll toward it) — an orb that persisted as an active guide all the way through the ending would compete with that beat rather than complete it. The orb's arc is: *appear → validate and invite → lead → hand off.*

**Micro-story motif — the 404 itself becomes a character.** Still applies, adapted to the new visual: the numerals "4-0-4" appear as glowing formations *within* the particle flow (a cluster of streaks momentarily coalescing into the shape of the numbers, then dissolving back into the field) rather than carved into walls — the same "wayfinding number = narrative payoff" idea, native to a walls-less environment.

---

## 2. The Cinematographer's Lens — How Do We Frame It?

**Act I — The Fall.**
- **v2.1: no held establishing shot.** First-person motion begins in the very first frame — the earlier idea of a static "silhouette" composed shot read badly in practice and is removed. The Guiding Orb (Section 1) is already visible and igniting as the fall begins, giving the eye an immediate point of focus without costing any of the "without waiting" immediacy this beat needs.
- Wide/fisheye FOV (~90–100°) from the first frame — distorts peripheral geometry, standard vertigo-inducing lens choice (cf. the falling shots in *Fight Club*, *Panic Room*).
- Camera is locked to a first-person rig with no user control yet — this is a *cinematic*, not interactive, beat. Taking control away first makes giving it back later (Act II) feel like relief, not a UI default.
- Subtle uncommanded roll (2–4°) as if the body is tumbling slightly, not falling perfectly true. Imperfection reads as "real."
- Depth cue: the particle-vortex streaks themselves (see Section 6's technical note) rush past and elongate with motion blur, giving speed without needing detailed geometry to render — this replaces v1's separate "light-streaks" device, since the primary visual *is* the streak field now.

**Act II — The Traverse.**
- FOV narrows to a natural ~55–65° as falling becomes flying — this recalibration is itself a felt transition, an exhale.
- No walls, so no "cathedral aisle" framing — instead, the streak field should read as *volumetric depth in every direction* (streaks above, below, beside, not just ahead), so the open void still feels enclosing/embracing rather than empty. Enclosure now comes from density of particles, not geometry.
- Occasional slow roll/bank (1–2°, held briefly, then correcting) as the flow field curves — the vortex-appropriate replacement for v1's Dutch-tilt-at-turns, same "disorientation as texture" function.
- Rack-focus moments: near-field streaks sharp, the deep convergence point soft, then reverse — same "draws the eye forward" function as v1, now applied to particle depth-of-field rather than wall detail.
- Depth is communicated by streak density/parallax falloff into the dark convergence point (the vortex's "throat"), the void-native equivalent of v1's fog-for-infinity trick — no fog needed since there's no far wall to hide, just genuine depth via particle count falloff.
- **v2.1 addition — more cinematic variety, per playtest feedback that the traverse felt monotonous.** The bank/roll moments above shouldn't be the *only* camera texture across a 6–26 second act: vary the field's apparent density and the camera's framing distance from the axis at different points along the travel span (not randomly — tie it to real progress markers, e.g. denser/closer-feeling near a glyph-formation or companion-orb encounter, more open/sparse in between), so different stretches of the traverse are visually distinguishable from each other rather than one continuous, undifferentiated tunnel.

**Act III — The Overflow.** *(unchanged from v1 — this act's cinematography didn't depend on the walled-corridor aesthetic and survives the pivot as-is.)*
- A light source appears distant and small (a single point, not a wall of brightness) — scarcity first.
- As the user approaches, we cheat focal length slightly wider again (~70°) so the light's growth feels accelerating/exponential rather than linear — an old dolly-zoom-adjacent trick (inverse of *Vertigo*'s effect: here the world seems to stretch *toward* the light rather than away from the subject).
- Final beat: full whiteout bloom overtakes frame, then an iris-style reveal (soft-edged, not hard-cut) opens onto the homepage — echoing old-Hollywood iris transitions, which read as "a scene closing," not "a page loading."

---

## 3. The Kinetic / Motion Lens — How Does It *Move*?

**Act I — The Fall (≈3.2s, shortened in v2.1).** *(autoplay/cinematic, no scroll here.)*
- **v2.1: total duration roughly halved from the original pivot (was ~6.8s, now ~3.2s) per playtest feedback that the initial approach felt "very very slow."** No held opening shot at all now (see Section 1/2) — motion is continuous from t=0. The felt goal is "immediate," not "eventually gets going."
- Ease: sharp `ease-in` acceleration (cubic or expo) — motion should feel like it's *taking over*, not gently ramping. The user should feel like control was removed, not offered a smooth ride.
- Screen-shake/noise amplitude highest at the very start (the "drop") and decaying — front-loaded intensity, not sustained.
- Sound and motion synced: a low sub-bass whoosh with a falling pitch-bend (classic riser-in-reverse) — the ear confirms what the eye is doing.

**Act II — The Traverse (≈6–26s depending on scroll pace, the bulk of the runtime) — scroll-driven.**
- **Scroll is the primary motion input for this act only.** Wheel/touch/trackpad delta (captured via GSAP's Observer plugin — normalizes input without needing a real scrollable page, since this is a full-viewport canvas with nothing to actually scroll) maps to forward-travel velocity through the flow field. This directly answers the "give the user agency" half of Section 5's interaction philosophy — scroll *is* the resonance mechanic for this act, not a separate layer on top of an autoplaying camera move.
- **v2.1: scroll responsiveness tightened per playtest feedback ("too much lag/delay," "wrong overall speed").** The velocity-response time-constant should be low enough that scrolling reads as immediate, not laggy — input should visibly affect motion within a couple of frames, not after a noticeable ramp-up. Overall pace bounds are also tightened (shorter idle-drift and min-duration than the original pivot's first pass) so the act doesn't feel like it's dragging even at a comfortable, unhurried scroll speed.
- **Guardrails so scroll-driven ≠ scroll-jacked-into-a-maze:** velocity is clamped (min/max travel speed) and *responsively* damped (an idle scroll doesn't instantly stop the camera; a scroll burst doesn't instantly max it, but the response itself should feel snappy, not sluggish — the damping is about preventing jarring extremes, not about adding perceptible lag) — the user paces the *speed* of a fixed, guaranteed-length journey, they never choose a *direction* or a *shortcut*. If the user stops scrolling entirely, the camera drifts forward at a slow idle-minimum rather than truly stopping (so it's never possible to get "stuck," preserving the no-failure-state non-negotiable in a scroll-input world). If the user scrolls very fast, a velocity ceiling still gives every "404" glyph-formation moment (Section 1) enough on-screen time to register.
- Ease: the damping curve itself (see above) — no separate autoplay easing needed for the bulk of this act since the user's own input *is* the motion curve now. The one autoplay-owned exception: turn/curve moments in the flow field (the vortex spiraling one way then another) are still gently telegraphed a beat ahead via brightness/density cues, same function as v1's turn-telegraphing, now guiding *where the camera looks/banks* rather than *whether it turns* (there's still only one path).
- A very slow, almost-subliminal camera drift/sway (like breathing) layers on top of the scroll-driven forward motion, same as v1 — the "trance" signal, constant micro-motion with no sharp edges. This must be driven by real elapsed time-in-act, not a frozen clock — see ARCHITECTURE.md's three-phase timing model for why this specific gotcha matters here.
- Mouse-parallax/gyroscope tilt (v1's Section 3 mechanic) still applies as a secondary, small-magnitude layer *on top of* scroll-driven forward travel — scroll controls *how fast you go*, parallax still controls *where you're looking*, so both agency mechanics coexist without conflicting.
- "Infinite-feeling" is now a particle-density/parallax trick rather than a modular-geometry-repeat trick (see Section 6) — same underlying goal (perceptual infinity, not genuine unbounded scene), different technique for a walls-less environment.
- **v2.1 addition — the Guiding Orb's motion.** The orb maintains a comfortable lead distance ahead of the camera along the axis, with its own gentle independent bob (not locked rigidly in place, or it reads as a HUD element rather than a companion) — see Section 1/config.js's `GUIDE` constants. It never outruns the camera or lags so far back it's lost from view; its distance-ahead is a soft target the camera's own position homes toward, not a hard-coded offset.

**Act III — The Overflow (≈5–8s).** *(unchanged from v1 — scroll control is deliberately taken away here, restoring the autoplay/cinematic mode.)*
- Ease: `ease-out`, decelerating — the opposite curve of Act I. Symmetry between the fall's ease-in and the return's ease-out is what makes the piece feel *composed* rather than just "reversed."
- Light bloom intensity grows on an accelerating curve (quadratic/cubic) even as camera movement decelerates — the mismatch (slowing body, speeding light) is what produces the "overflowing" sensation rather than "arriving."
- Final transition to the homepage should not be an abrupt cut — cross-dissolve/whiteout hold (~400–600ms) so the vestibular system gets a moment to "land" before real UI (with its own scroll, clicks, cursor) resumes authority. Note the double meaning now: the user's *scroll* itself resumes normal page-scrolling authority at this exact moment, having been repurposed for Act II's traversal and then handed back — this transition is now also a literal "your scroll wheel means something different again" moment, not just a visual one.
- The Guiding Orb dissolves into the emerging overflow light at the very start of this act (Section 1) — a brief, deliberate visual event (the orb's glow blooming outward and merging with the growing light source), not an abrupt disappearance.

---

## 4. The Light Artist's Lens — What Does It Feel Like Emotionally, Color by Color?

**Act I — The Fall.**
- Palette: near-black void with cold undertones — deep indigo/ink (#0a0a14 territory), no pure black (pure black reads as "empty render," not "abyss"). Unchanged from v1.
- Almost no light sources yet — just enough ambient falloff to render the Guiding Orb's own glow and early streak-field depth. Darkness here should feel *total but not blind* — the eye should be straining, which is itself part of the thrill. The orb is deliberately the brightest, warmest thing in frame from the very first moment — it should read as *the* point of visual anchor in an otherwise near-black void.

**Act II — The Traverse.**
- **v2.1 addition — visual variety, per playtest feedback that the field felt monotonous.** The teal/cyan base shouldn't be perfectly uniform for the entire act — introduce gentle variation in particle density/brightness/hue-temperature at different points along the travel span (denser and slightly warmer-leaning near glyph-formation or companion-orb encounters, sparser and cooler in the stretches between), so the traverse has a felt sense of passing through different *regions* of the void rather than one undifferentiated tunnel. This must stay subtle enough not to violate the single-hard-pivot non-negotiable (Section 7) — these are gentle regional variations within the cool palette, not a second hard pivot.
- **Palette pivot from v1**: the reference image's teal-cyan-on-black replaces v1's violet-blue-with-amber-accent as the primary Act II palette. Base streak color: a cool, deep teal/cyan (~7000–8000K, bluer and greener than v1's violet-blue). This is a closer match to the reference and, combined with keeping Act III's pivot warm, produces an even sharper "cold deep space → warm light" emotional turn than v1's violet→gold — the contrast is the point, so leaning further cool here (rather than v1's more moderate violet) makes the eventual warm pivot land harder.
- The "404" glyph-formations (Section 1) should still be the *brightest, warmest* objects in this act by a wide margin — now a genuine warm-amber accent standing out against the cool teal field (v1's "pick one accent" guidance still applies: teal base + amber accent, not teal + a second cool accent, or the glyphs won't read as distinct).
- Light should never be static: the streak field's overall brightness/pulse should have a slow, irregular rhythm (like breathing) — same decelerating-heartbeat device as v1 (~70bpm-equivalent down to ~50bpm), now expressed as a subtle density/brightness pulse across the whole particle field rather than individual wall-seam lights.
- **New consideration**: since Act II is now scroll-paced rather than autoplay-paced, the pulse-deceleration curve should be driven by *elapsed time in the act*, not literal clockTime against a fixed schedule — otherwise a user who scrolls slowly (spending longer in Act II) would exit the "calming down" pulse-curve before they're actually done experiencing the act, and a fast scroller would blow through it too quickly to register at all.

**Act III — The Overflow.** *(unchanged from v1 in mechanism, sharper in effect given Act II is now cooler.)*
- Color temperature inverts hard: teal/cyan washes out into warm gold/white. This remains the only hard palette pivot in the whole piece — everywhere else transitions are gradual; here we want an unmistakable emotional turn, now more dramatic given the wider color-temperature gap being bridged.
- Bloom/glow should feel like it has volume and weight — light "spilling" like liquid toward camera, not just a brightening skybox. A volumetric light shaft pouring through/around the particle field (so it reads as the void being *filled* with light, streaks themselves catching and carrying it) is the void-native version of v1's "pour around the walls" language.
- Final frame before the iris-transition: pure warm whiteout, slightly overexposed — deliberately "too bright," like walking out of a cinema into daylight. Unchanged from v1.

---

## 5. The Interaction Lens — Resonance, Not Response (+ Scroll as Agency, v2)

The brief calls for the experience to be **immersive, transient, hypnotizing**. All three words point away from conventional "interactivity" (click a thing, get a discrete result) and toward a single mechanic: **the void should behave like still water — undisturbed until touched, and touched it ripples, glows, sighs, then settles back to stillness.** Cause and effect stay connected (immersive — your presence matters), but the effect never persists or accumulates (transient — nothing is collected, unlocked, or remembered), and the causality is soft and delayed rather than snappy (hypnotizing — it feels like the world is dreaming *about* you, not responding *to* you).

This rules out anything that would reintroduce choice-paralysis or gamification: no clickable elements beyond the skip affordance, no "find all 3 glyphs" collectible logic, no branching outcomes. Interaction here is a **texture on top of a fixed-length journey**, never a fork in it. It should be discoverable by accident (scrolling, moving the mouse, tilting the phone) rather than by being told "click here."

**v2 addition — scroll is now a first-class agency mechanic, not just texture, but it still obeys the resonance rules:** per Section 3, scroll controls *pace* (how fast the fixed-length Act II passes), never *direction* or *outcome*. It still decays — stop scrolling and the camera settles to a slow idle-forward drift rather than a hard stop (nothing stays "activated" at a chosen velocity forever; the system always relaxes toward a baseline idle pace, same decay-to-baseline logic as every other mechanic below). This is why scroll fits the resonance philosophy rather than breaking it: it's continuous, damped, and non-discrete, exactly like the mechanics below — the difference is only that its effect (pace) is more structurally significant than the others (cosmetic ripple/glow).

**Concrete mechanics, all confined to Act II (the trance is the only place interaction belongs — Act I needs total helplessness, Act III needs total surrender):**

- **Scroll-paced traversal (v2, primary).** See Section 3 for the full mechanic. This is the load-bearing interaction of the piece now — everything below is secondary texture layered on top of it.
- **Wake/ripple trail.** The user's parallax-driven gaze direction leaves a faint disturbance behind it in the particle field — like a fingertip dragged through water — that blooms softly for ~1–2s then fades. Always looking forward = calm, unrippled field. Looking around = the world visibly responds, but never in a way that redirects the path.
- **Proximity resonance on the "404" glyph-formations.** As the camera nears a glyph-formation, it brightens and its pulse-rate syncs toward the camera's own decelerating heartbeat-glow rhythm — like two things falling into sync (entrainment). No click required; proximity alone is the "interaction." It peaks as you pass it, then relaxes back to ambient as you move on — nothing stays activated.
- **Breath-synced ambient pulse (passive, but reactive if mic/motion permission is ever granted).** Baseline: the field's glow pulse follows its own scripted decelerating rhythm regardless of user input. As a *bonus* layer only, if the user is idle (no scroll, no mouse/gyro movement) for a few seconds, the glow can slow further, as if the scene itself relaxes when the user does.
- **Whisper-fade audio spatialization.** Soft, indistinct tonal shimmer pans subtly with the user's look-direction, decaying quickly — the auditory sibling of the ripple.

**Why this stays hypnotic and doesn't tip into "game":**
- Every response has a **decay curve back to baseline** — nothing is ever left "on," scroll-driven pace included.
- Direction/outcome are never under user control, even though pace now is — this preserves "no decision to make about *where*," the load-bearing promise carried over from v1's Section 0.
- Nothing here is **required** to progress — a user who never touches the scroll wheel still completes the exact same journey (at the idle-minimum pace) in a bounded time; a user who scrolls furiously still can't skip past the "404" glyph-formation beats (velocity ceiling, Section 3) or shorten Act I/III (not scroll-driven at all).

---

## 6. The Technical Craft Lens — Libraries That Earn Their Weight

"Production-grade cinematic" is a rendering-quality and typography-quality bar, not a framework decision — so the additions here are all narrowly-scoped libraries (a few KB to a couple hundred KB each), not app frameworks, and each one maps to a specific beat that would otherwise look like a demo rather than a film.

**Void/vortex particle system (v2 — replaces "instanced/modular corridor geometry" from v1):**

| Library | Role | Why it earns its place |
|---|---|---|
| **Three.js `Points`/`InstancedMesh` + a curl-noise flow field** | The primary Act II visual — thousands of thin, elongated streak instances flowing along a vortex-shaped field (spiraling inward/forward toward a dark convergence point), replacing v1's walled corridor entirely | This is a scale-up of a technique already prototyped in the v1 build (`corridor.js`'s small-scale "void light-streaks" used only for Act I decoration) — same primitive (instanced elongated geometry + procedural motion), now the primary environment rather than an accent. No new dependency needed beyond what's already installed. |
| **GSAP Observer** (official GSAP plugin, already installed alongside SplitText/ScrambleTextPlugin) | Normalizes wheel/touch/pointer delta input for Act II's scroll-paced traversal (Section 3), without requiring a real scrollable page | This is a full-viewport canvas experience with nothing to actually scroll — `ScrollTrigger` (which scrubs against real element scroll position) is the wrong tool here; `Observer` is built exactly for "capture input deltas, drive a virtual progress value" without any DOM scroll height involved. Already present in the installed `gsap` package, no new install required. |

**Kinetic typography (the "404" glyphs, both in-scene and any 2D overlay text):** *(unchanged from v1 — troika-three-text/SplitText/ScrambleTextPlugin usage doesn't depend on the walled-corridor aesthetic.)*

| Library | Role | Why it earns its place |
|---|---|---|
| **troika-three-text** | Renders the "404" glyph-formations as crisp, SDF-based text *inside* the Three.js scene | Three.js's built-in `TextGeometry` is polygon-based and looks jagged/low-res when it glows or is seen at an angle. Troika renders signed-distance-field text that stays crisp under bloom and at any distance/angle. |
| **GSAP SplitText** | Splits 2D overlay text (title card, skip affordance, homepage-return micro-copy) into chars/words for staggered reveal | Lets text *assemble* — coalescing from scattered characters into a stable word — rather than just fading in. |
| **GSAP ScrambleTextPlugin** | Cipher-style character-scramble effect for the "404" numerals | The glyph-formations can visibly *resolve* out of scattered particles into "404" as the camera nears them — reinforcing the "discovery" beat from Section 1. |

**Rendering polish (Act III especially depends on this — "overflow" is a bloom/volumetric-light problem):** *(unchanged from v1.)*

| Library | Role | Why it earns its place |
|---|---|---|
| **pmndrs/postprocessing** | Production-quality Bloom, Vignette, Chromatic Aberration, Film Grain, God Rays passes | The single highest-leverage addition for making Act III's light-overflow read as cinematic bloom rather than a CSS `filter: brightness()` look. |
| **simplex-noise / curl noise** | Now doing double duty: the v1 use (camera micro-drift/sway) plus the primary driver of the vortex flow field's motion (v2) | Hand-rolled `Math.sin()` noise reads as mechanical/looping; noise-driven flow is what makes both the camera sway *and* the particle vortex itself feel organic rather than a repeating animation loop. |

**Audio (the sub-bass riser, decelerating pulse, warm swell):** *(unchanged from v1.)*

| Library | Role | Why it earns its place |
|---|---|---|
| **Tone.js** | Higher-level synthesis/scheduling on top of Web Audio API | Makes audio *tempo-locked* to the timeline achievable without hand-built clock math — now needs to also tempo-lock to Act II's *variable* (scroll-paced) duration rather than a fixed clock, which Tone.js's scheduling model still handles cleanly (schedule against elapsed-progress rather than absolute time for that one act). |

**Deliberately excluded / not needed (v2 update):**
- **GSAP `ScrollTrigger`** is deliberately *not* used, in favor of `Observer` — see the table above. This reverses v1's blanket "no scroll library" exclusion, but the reasoning updates rather than contradicts: v1 excluded scroll because the whole piece was autoplay; v2 needs scroll for one act only, and the right tool for "virtual progress from input deltas with no real scrollable page" is `Observer`, not a smooth-scroll or scroll-position library.
- No physics engine (Cannon/Rapier) — the traversal path is still scripted (Section 0's guaranteed-resolution principle, now via open void rather than a unicursal corridor), not simulated; physics would add cost and an actual risk of unintended collision/failure states.
- No UI/dev-tool libraries (dat.gui/lil-gui) belong in the shipped page — fine as a local build-time tuning aid, but should be stripped from production output.

---

## 7. The Creative Director's Synthesis — Full Beat Sheet (v2)

A single authoritative timeline merging all four lenses (v2.1). Timecodes for Acts I and III are relative/approximate as before; Act II's timecodes are now approximate *ranges* rather than fixed points, since scroll paces that act — the numbers below assume an average-pace scroll.

| Beat | Time | Camera / Motion | Light / Color | Story beat | User control |
|---|---|---|---|---|---|
| **1. The Drop** | 0–0.6s | First-person from t=0, no held opening shot, sharp ease-in fall, fisheye, 2–4° uncommanded roll | Near-black, cold, minimal falloff; Guiding Orb already ignited and visible | Loss of ground — the thrill spike; the Orb's validating lines assemble ("You're lost... Follow me...") | None (cinematic) |
| **2. Freefall** | 0.6–2.2s | Sustained fall, decaying shake, streak field rushing past | Still dark, first faint teal hint appears far below; Orb leads ahead | Disorientation settling | None |
| **3. The Catch** | 2.2–3.2s | FOV narrows 100°→60°, fall velocity eases into forward-drift | First proper streak-field glow ignites around camera | Falling becomes flying — surrender begins | Control returns here — scroll and parallax both activate |
| **4. The Traverse** | ~3.2–~19s (scroll-paced, 6–26s range, tightened in v2.1) | Scroll-driven forward velocity (clamped/damped, low-latency response), telegraphed field-curve moments, micro-drift/sway, occasional roll, regional density/color variety | Cool teal/cyan with regional variation, warm amber "404" glyph-formations, glow pulse decelerating over elapsed act-time | The trance — repetition-with-variety, 1–2 "404" glyph-formation encounters, distant companion orbs ("you're not alone"), the Guiding Orb leading throughout | **Scroll controls pace** (velocity-clamped, decays to idle-drift, tightened responsiveness) + parallax/gyro tilt drives a fading ripple trail + glyph proximity-resonance + idle-mirroring pulse |
| **5. The Turn** | +0–3s after Traverse ends | A held beat — camera slows almost to stop, then the vortex ahead reveals a single point of light | Warmest color shift begins subtly here (foreshadow); Guiding Orb begins dissolving into the light | Recognition — "there it is"; the handoff begins | None (scroll deliberately deactivates here — cinematic re-take of control) |
| **6. The Approach** | +3–8s | Ease-out deceleration begins, FOV cheats wider so light grows faster than distance closed | Teal→gold pivot in full swing, bloom volume increasing | Being drawn/poured toward resolution, not "finding" it | None |
| **7. The Overflow** | +8–11s | Near-stop, light fills frame, volumetric spill | Full warm whiteout, deliberate overexposure | Generosity — light comes to you (the Orb has fully dissolved into this light — see Section 1) | None |
| **8. The Iris** | +11–12s | Soft iris-style reveal | Cross-dissolve hold ~500ms | Scene closes, not "page navigates" | Homepage resumes normal control — including normal page-scroll, handed back from Observer |

**Total runtime: ~15–24 seconds depending on scroll pace** (shortened from v2's ~30–40s: fall-in roughly halved, traverse bounds tightened), with a floor (idle-drift minimum, Section 3) and ceiling (velocity clamp, Section 3) on Act II's duration so it can't be skipped instantly or stalled forever. Skip affordance (unchanged from v1) fades in after ~2s for returning visitors/accessibility.

**Non-negotiables for whoever builds this next (v2.1):**
1. **Guaranteed resolution, void edition** — one path through open space, no failure state, ever. (Same non-negotiable as v1's "labyrinth not maze," restated for a walls-less environment — see Section 0.)
2. The only hard color pivot in the entire piece is the Act II→III turn (now teal→gold, sharper than v1's violet→gold) — everything else is gradual, to protect the trance. Regional density/color variety within Act II (Section 2/4) must stay gentle enough not to read as a second pivot.
3. Act I strips user control; Act II returns it via **scroll (pace) + parallax (gaze)**; Act III strips it again deliberately, including handing scroll back to normal page behavior only at the very end. Control itself is a storytelling instrument, not just a UX default.
4. Motion is front-loaded intense (the drop) and back-loaded generous (the overflow) — symmetric easing curves across Acts I/III is what makes it feel *composed*. Act II's motion curve is now user-authored (scroll) rather than autoplay-authored, which is the deliberate exception, not an oversight.
5. Scroll controls *pace only*, never direction or outcome — velocity-clamped and decay-to-idle-drift, so it can never produce a "stuck" or "skippable" failure state. This is the v2-specific corollary of non-negotiable #1. Scroll response latency should read as immediate, not laggy (v2.1 addition).
6. Skip affordance exists but is invisible for the first ~2 seconds — don't rob first-time visitors of the thrill for the sake of impatient repeat ones.
7. Interaction is resonance (disturb → bloom → decay to baseline), never response (click → discrete result) — every reactive effect, scroll-pace included, must decay toward a baseline, and nothing about the journey's *outcome* may depend on whether the user interacts at all (its *duration* may now vary within the clamped range, which is new and intentional in v2).
8. **The Guiding Orb appears once, at the start, and hands off to the Act III overflow light rather than persisting to the end** (v2.1, replaces the old silhouette-once-only rule) — reintroducing an active guide-figure at the very end would contradict Section 1's "light comes to you" inversion.
9. Companion orbs (v2.1) are pure environmental storytelling — never interactive, never close enough to read as obstacles, never a second guide.

---

## Appendix: v1 Concept (superseded, kept for reference)

*The following is the original "labyrinth, not maze" concept this document opened with before the v2 pivot to a void/particle-vortex aesthetic with scroll-driven Act II traversal. Retained so the reasoning that carried forward (guaranteed resolution, control-as-instrument, resonance-not-response, symmetric easing) is traceable back to its source, and so a future revision could selectively revert if needed.*

**v1's Section 0 in full:** "Build a labyrinth, not a maze." A maze is multicursal — branching paths, dead ends, the possibility of being *actually* lost. A labyrinth (Chartres Cathedral, classical 7-circuit) is unicursal — one winding path in, the same path (or its mirror) out. No wrong turns exist. It *looks* like a maze — the walls, the turns, the sense of enclosure — but structurally it cannot fail the user. This reconciled "psychological thrill" with "make the user feel calm, in a trance."

v1's Act II was "The Labyrinth" — walking a walled, modular-repeat corridor with fog-based perceptual infinity, wall-seam bioluminescent accents (violet-blue base + amber accent), Dutch-tilt at telegraphed turns, and rack-focus on wall detail. v1 explicitly excluded scroll ("this experience is autoplaying/cinematic, not scroll-driven"). The full original text of every section is preserved in this document's edit history / version control if needed verbatim; this appendix summarizes rather than reproduces it in full, since v2's sections above already note exactly what changed and what didn't at each point.

---

*Next phase (v2 rebuild, not started): replace `src/scene/corridor.js`'s walled-corridor geometry with a particle-vortex flow-field system; keep `src/config.js`/`src/state.js`/`src/director.js`/`src/main.js`'s orchestration layer (beat timeline, shared-state contract) and adapt `camera.js`/`lighting.js`/`glyphs.js` to the new visual. Confirmed stack (all already installed, no new dependencies needed):*
- *Three.js — `Points`/`InstancedMesh` particle-vortex flow field (replaces wall/floor/ceiling geometry), fog removed (no longer needed — depth now comes from particle density falloff)*
- *GSAP (core + SplitText + ScrambleTextPlugin + **Observer**, all already present in the installed `gsap` package) — timeline orchestration, per-act easing curves, kinetic typography, and now scroll-input normalization for Act II's scroll-paced traversal*
- *troika-three-text — crisp SDF-rendered "404" glyph-formations*
- *pmndrs/postprocessing — production-grade Bloom/God-Rays/Vignette/Grain pipeline, carries Act III's light-overflow*
- *simplex-noise / curl noise — drives both the camera micro-drift/sway and the vortex flow field's particle motion*
- *Tone.js — tempo-locked audio layer, now scheduled against Act II's variable (scroll-paced) elapsed progress rather than a fixed clock for that one act*

*Full rationale per library in Section 6. Held until this concept is reviewed.*
