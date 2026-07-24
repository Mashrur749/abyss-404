# Vision-encounter art — one composite apparition

**Decision: replace both assets with ONE image.** Rationale below. Generate this file, drop it at
`src/assets/vision-apparition.png`, and the `vision.js` wiring listed at the bottom follows.

## Why one image beats the current two planes

Today the encounter is two flat photo cards in a T arrangement (`vision.js` `placeEncounter`): the
silhouette billboard faces back down the travel axis, the TV sits 1.6m further along `+tangent`
facing back at it. The camera passes at 3.2m lateral offset, so parallax *reveals the T* — two cards
at different depths, not a scene. Worse, the two assets were shot separately: the couch photo's
figure is lit from the left and faces near-left, while the TV it is supposedly hypnotized by is
behind and to the side of it. The single strongest idea in the piece — *a man who cannot look away
from the 404* — is the one thing the current staging cannot show. One composite plane bakes the gaze
relationship, the light direction, and the depth relationship into the pixels, where parallax can't
break them. It also deletes the luminance-keying hack (`SILHOUETTE_KEY_BAND`), which is a whole bug
class (`v2.8`, `v2.15`) that only exists because the source was a JPG with no alpha.

---

## The prompt

> A hypnotized man sitting slumped on a sagging old couch in absolute void, seen from behind and
> slightly to his left, camera raised a little and looking mildly down at him. He stares at a small
> vintage CRT television floating a few feet in front of him — the only light source in the frame.
> The CRT is angled so its screen is visible past his shoulder: it glows warm champagne-amber
> (#e0a266) and shows pixel/dot-matrix text — "ERROR" in red, a huge white "404" below it, then
> "PAGE NOT FOUND" and "YOU ARE LOST" in amber — over faint scanlines, signal tearing and analog
> static bands. Its 1980s plastic bezel is near-black charcoal, catching only a thin amber glint.
> The man is almost pure silhouette: face unseen, head tilted slightly forward, shoulders collapsed,
> arms limp, one hand fallen open beside him, utterly still, as if he has been sitting there for
> years. A thin rim of amber screen-light traces the edge of his head, shoulder and knee; everything
> facing away from the screen falls to absolute black. The couch is worn fabric, its far side
> dissolving into drifting smoke, ash and fine floating particles trailing off into nothing, as if
> the scene is eroding at its edges. A few tiny pale teal (#8fd0c9) motes hang suspended in the air
> around him. No room, no floor, no walls, no horizon — the couch and TV float in empty darkness.
>
> Style: photoreal, cinematic, extreme low-key chiaroscuro, single practical light source, heavy
> negative space, muted desaturated palette of black and charcoal with warm amber and one cool teal
> accent, subtle film grain, shallow depth of field. Mood: liminal, hypnotic, lonely, dreamlike
> apparition — not horror, not gore.
>
> Composition: wide horizontal, 16:9. Man and couch occupy the left half; the TV sits in the right
> third at roughly a quarter of the frame width, its screen face turned partly toward the viewer so
> the 404 text is fully legible. Generous empty black above and below.
>
> Technical: fully transparent background (alpha 0), PNG RGBA, subject cleanly cut out with soft
> feathered edges. NO background plate, NO white or gray fill, NO glow or vignette gradient reaching
> the canvas edge — light must fade to full transparency well inside the frame. No text other than
> the on-screen text. No logos, no watermark, no border. 2048x1152 or larger.

**Negative prompt:** `white background, gray background, studio backdrop, room interior, walls,
floor, ceiling, window, lamp, bright lighting, high key, colorful, saturated, HDR, visible face,
eyes, gore, blood, text overlay, caption, watermark, signature, border, frame, vignette to edge,
hard rectangular glow, cartoon, illustration, lens flare, low camera angle looking up, modern flat
screen, LCD, TV stand, cables, reflection, floor shadow`

## Non-negotiable technical checks before shipping the file

- **PNG colorType 6 (RGBA) with real alpha.** `vision.js` already trusts real alpha for the old TV
  asset; this file gets the same treatment and the keying pass is deleted. If a tool forces JPG,
  the background must be pure `#000000` with no compression ringing — the current band is
  `SILHOUETTE_KEY_BAND = { innerEdge: 1, outerEdge: 9 }` (`vision.js:111`), so ringing at luminance
  2–8 survives the key as a faint grey rectangle.
- **No glow reaching the canvas edge.** The old TV asset's edge-to-edge vignette is exactly what
  forced the v2.15 asset swap; additive blending turns any such gradient into a visible box.
- **Camera looks slightly down** (`heightOffset: -0.7`). A low upward angle reads wrong.
- **Keep it dark.** Peak plane opacity is 0.92 and the engine adds its own additive halo on top.

## Tool notes

- Midjourney/Imagen: transparent output is unreliable — generate on pure `#000000` and matte out.
- Nano Banana / GPT-image / Flux Kontext: ask explicitly for transparent PNG, then verify colorType.
- If the model won't put legible small text on the CRT, generate the scene with a blank glowing
  screen and composite the "ERROR / 404 / PAGE NOT FOUND / YOU ARE LOST" panel in afterwards — the
  text must be crisp, it's read at ~20–32% of frame height during the pass.

---

## `vision.js` changes once the file exists

1. Import `vision-apparition.png` in place of the two current assets; delete `SILHOUETTE_KEY_BAND`,
   the canvas keying pass and the `CanvasTexture` path — use the loaded texture's own alpha.
2. Collapse the `silhouette` + `screen` meshes to one plane, sized off `VISION_ENCOUNTER.screenWidth`
   (raise `5.5` → `~11`, since the TV is now ~a quarter of the composite's width, landing it near its
   current on-screen size) with aspect from the decoded texture. Drop `screenForwardOffset` /
   `screenHeightOffset`.
3. Keep `screenGlow` — reposition it from the old screen anchor onto the TV's location *within* the
   composite (roughly `+0.28 * planeWidth` along the plane's local right, slightly up).
4. Move the CRT jitter off the plane's transform. Shaking one card now shakes the couch too. Apply
   `screenJitterAmplitude` / `screenJitterRotationDeg` to the glow sprite only, plus a small
   noise-driven opacity flicker (±0.06) on the plane — same "unstable signal, not a vibrating prop"
   intent, without moving furniture.
5. Energy orbs, companion-orb surround, plateau/approach opacity curve: unchanged.
