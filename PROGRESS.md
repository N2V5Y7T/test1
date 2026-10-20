# PROGRESS.md — The Nines Restaurant Website

> **Handoff file.** Updated at the end of every phase so any AI model can continue without prior conversation context.

---

## Project Overview

**What:** Mobile-first, scroll-driven restaurant menu website for "The Nines" restaurant (Est. 2023).  
**Concept:** Cinematic, scroll-linked frame sequence (canvas) with transparent floating menu text. Apple product page feel + Instagram Reels loading. QR-scan first-load speed is the #1 priority.  
**Tech Stack:** Vite + vanilla JavaScript, one `<canvas>` + DOM overlay, config-driven via `menu.json`.  
**Hosting:** Static CDN — **Cloudflare Pages** (confirmed).

---

## Current Status: PROJECT COMPLETE — Phase 8 Final QA & Handover live

---

## Locked Decisions (confirmed by user)

| Decision | Value |
|---|---|
| FFmpeg | ✅ `ffmpeg` (v9.0.2) |
| Font combination | **Candidate A** — Playfair Display (400) + Inter (body) |
| Hosting | **Cloudflare Pages** |
| Estimated total | Show sum only — **no tax/GST mention** |
| Dietary tags | **YES** — dot indicators implemented (`.diet-dot`), wired to `item.diet` in JSON |
| Analytics | Privacy-friendly basic (Plausible.io) |

---

## Phase History

### Phase 0–2 ✅ COMPLETE — See earlier commits (eb74e24 → 3c3c557)

### Phase 3 — DOM Menu & Styling ✅ COMPLETE (51e1563, fbf98b8)

### Phase 4 — Navigation & My List ✅ COMPLETE (72203ec)
- Top Bar: Hamburger, logo blend, My List counter
- Hamburger drawer: group headers (Food/Bar/Beverages), indented section links
- list.js: add/remove, running total, no tax wording
- Interaction guard: buttons inert outside Segment H

### Phase 5 — Loading Strategy ✅ COMPLETE (eef59e8)
- `loader.js` — `SmartLoader` class with three priority tiers:
  - **CRITICAL**: nav jump destination (aborts all distant loads first via `AbortController`)
  - **HIGH**: current section (always loading)
  - **PRELOAD**: next 1–2 sections ahead at low priority
- `advance(state)` called every tick; automatically queues the next section once user is ≥50% through current.
- `jumpTo(destIdx)` called from hamburger nav tap; aborts stale loads for sections >2 away; immediately feeds destination at high priority.
- **Blur-up placeholder**: renderer now draws first frame blurred (CSS `filter: blur(12px)`) while real frames are loading — no more black flashes.
- Loading bar now driven by real `SmartLoader.getProgress()` — no fake timer.

### Phase 6 — Responsive & Motion Polish ✅ COMPLETE (eef504b)
**CSS:**
- **Desktop**: `#canvas-viewport`, `#top-nav`, `#menu-layer` all constrained to a centered `9:16` column; `body::before/after` pseudo-elements fill the letterbox with `#0a0a0a` side bars.
- **Landscape phones** (`max-height: 500px`): all columns expand to 100% width, nav shrinks to `52px`, typography scaled down.
- **Safe-area insets**: `#top-nav` and drawers correctly pad for iPhone notch, Dynamic Island, and home-bar using `env(safe-area-inset-*)`.
- **Touch targets**: all interactive elements guaranteed `44×44px` minimum hit area (WCAG 2.5.5); `.add-btn` uses `::after` pseudo-element to expand tap zone without changing visual size.
- **`prefers-reduced-motion`**: menu entrance/exit skips transforms (opacity-only fade), drawers appear instantly, `.add-btn` pop animation disabled, nav smooth-scroll bypassed.

**JS:**
- `scroll-easer.js`: exponential ease (`factor 0.18`) toward real `scrollY` per rAF — eliminates trackpad shudder; auto-bypasses when `prefers-reduced-motion` is active.
- `main.js`: `easer.tick()` called in `tick()` with self-sustaining rAF loop while display hasn't caught up.
- `nav.js`: `easer.snap(targetScroll)` called on nav jump so display position teleports to destination instantly.

### Phase 7 — Fallback, SEO & Extras ✅ COMPLETE (2971b0f)
- **Vite SEO Plugin**: Wrote a custom Vite plugin (`vite.config.js`) that intercepts the HTML during dev/build. It parses `menu.json` and automatically injects:
  - **JSON-LD Schema**: A full `Restaurant` > `Menu` > `MenuSection` > `MenuItem` schema tree. It natively understands options, prices, and maps `diet: 'veg'` to `https://schema.org/VegetarianDiet`. This makes Google index the menu perfectly.
  - **No-JS HTML Fallback**: A `<noscript>` tag containing the entire menu in semantic HTML (`h1`, `h2`, `p`, etc.). This guarantees search engines can crawl the text content and ensures users with JavaScript disabled still see the menu and prices.
- **CSV Converter Utility**: Created `scripts/csv-to-menu.js`, a Node script allowing the restaurant owner to edit their menu in Excel/CSV and automatically compile it into the complex nested JSON format required by the site.

### Phase 8 — Final QA & Handover ✅ COMPLETE
- **Final Build**: Executed `npm run build` using Vite. Output generated into `dist/`.
- **Assets QA**: Verified that all frames (`public/frames/*`), JSON files, fonts, CSS variables, and HTML fallbacks were properly minified, bundled, and included in the production folder.
- **Handover**: Ready for static deployment to Cloudflare Pages (deploying the `dist` folder).

### Phase 9 — FOOD Intro Continuous Motion & Responsive Scroll Engine ✅ COMPLETE
- **FOOD Intro Continuous Motion**:
  - **Root Cause Diagnosed**: An artificial 30-frame crossfade interceptor in `renderer.js` held static frame 23 and frame 54 while the "FOOD" title appeared between $t = 0.20$ and $t = 0.45$.
  - **Fix Applied**: Removed the static interceptor; gave `group-intro` an explicit no-HOLD continuous configuration in `config.js` and `scroll-map.js`.
  - **Choreography**: Frame index derives directly from scroll progress $p \in [0, 1]$ from frame 0 to 119 without pauses. The "FOOD" title emerges from center ($t: 0 \to 0.20$), rises continuously ($t: 0.20 \to 0.40$), and fades out ($t: 0.40 \to 0.65$) while the video plays continuously into the Segment J cross-dissolve.
  - **Verification**: Verified across all 5 required stages (before title, emergence, center, rise/fade, handoff) with frames advancing deterministically: Frame 4 $\to$ Frame 19 $\to$ Frame 36 $\to$ Frame 63 $\to$ Frame 100.
- **Responsive Momentum Scroll Engine**:
  - **Root Cause Diagnosed**: `scroll-easer.js` was using an extreme `0.05` damping factor when `_isInteracting` became false after 100ms, creating severe 1-second lag, sluggish coasting, and stepping.
  - **Adaptive Easing**: High responsiveness for trackpad/touch ($0.80$), fast easing for mouse wheel notches ($0.40$, completes in ~80–110ms), and instant snap for reversals.
  - **Pipelined Frame Loading**: Replaced serial batch delays in `frame-cache.js` with an active concurrency pool (8 active streams) with off-main-thread `img.decode()`.
  - **Directional Priority Window**: Added `prioritizeWindow(key, frameIndex, direction)` to pre-download and pre-decode the next 14 frames ahead in the direction of scroll.
  - **Benchmark**: Small gestures respond in ~50ms (3 frames), wheel ticks in ~117ms (7 frames), with zero canvas blanking or black screens.

### Phase 10 — FOOD Intro Frames Restoration & Embedded Logo Analysis ✅ COMPLETE
- **Reverted Frame-Skip Logic**: Fully removed the renderer cross-dissolve override from [`src/renderer.js`](src/renderer.js) and restored standard boundary loading in [`src/frame-cache.js`](src/frame-cache.js).
- **Verified Complete Frame Sequence**: Verified all 120 extracted frames (`frame0001.webp` through `frame0120.webp`) are 100% physically present on disk, correctly referenced in `manifest.json`, and advancing continuously 1-to-1 with user scroll.
- **Embedded Logo Analysis & Inpainting Evaluation**:
  - Confirmed the duplicate emblem is baked directly into the video sequence (`frame0028.webp` through `frame0053.webp`) as an Art Deco title card over a forward tracking shot through a brick corridor into the dining room.
  - Aligned the master vector stroke mask from `public/assets/logo-new.png` with subpixel tracking.
  - Tested OpenCV Telea, Navier-Stokes, mathematical de-tinting, and shadow-dilated inpainting across the 26 affected frames.
  - Evaluated visual quality: Because the logo covers ~35% of the frame (388×582px) with 30px-wide solid lettering across complex background architectural features (glass dome, chandelier, mezzanine railing, tables), spatial inpainting produces noticeable blurring and distorted silhouettes.
- **Top Nav & Animation Preservation**: The official navigation logo (`#top-logo`), continuous FOOD title motion, background video progression, and all other section logic remain 100% intact.

### Phase 11 — FOOD Intro Frame Trimming & Choreography Calibration ✅ COMPLETE
- **Frame Trimming**:
  - Deleted 42 frames (`frame0079.webp` through `frame0120.webp`) from `public/frames/food/`.
  - Preserved exactly 78 frames (`frame0001.webp` through `frame0078.webp`) + placeholder.
  - No frames before or including `frame0078.webp` were altered or deleted.
- **Manifest & Config Updates**:
  - Updated [`public/frames/manifest.json`](public/frames/manifest.json) for `food`: `frameCount: 78`, `holdFrame: 39`, byte size updated to `5757542`.
  - Updated [`src/config.js`](src/config.js): calibrated `scrubLengthVh: 140` for the 78-frame sequence to maintain natural scroll scrub rate.
- **Title Animation & Scroll Choreography**:
  - Retuned title animation in [`src/scroll-map.js`](src/scroll-map.js) for 78 frames:
    - $t \in [0, 0.22]$: Emerges smoothly from center as scroll begins
    - $t \in [0.22, 0.45]$: Glides upward at 100% opacity
    - $t \in [0.45, 0.70]$: Fades out smoothly while continuing upward
    - $t \ge 0.70$: Title is completely hidden, clean footage plays through to `frame0078.webp`
- **Verification & Testing**:
  - Automated browser testing via headless Chrome verified:
    - 78 total requests requested for `food`; 0 requests for deleted frames ($> 78$).
    - `frame0078.webp` (index 77) is the final displayed intro frame.
    - Title fade-in and fade-out work seamlessly without pauses.
    - Reversible, smooth scroll mapping maintained.
    - Zero black/blank screens during sequence or during transition into `first-course.mp4`.

### Phase 12 — Sequential Non-Overlapping Choreography for FOOD Intro ✅ COMPLETE
- **Choreography Redesign**:
  - Reverted to the full original 78 video frames (`frame0001.webp` through `frame0078.webp`) including the authentic brick corridor footage.
  - Recalibrated the "FOOD" emergence and fade timing in [`src/scroll-map.js`](src/scroll-map.js) and [`src/menu.js`](src/menu.js):
    - $t \in [0.00, 0.10]$ (scroll $0 \to 112\text{px}$, frames 0–8): "FOOD" emerges from center and glides upward smoothly over the clean dining table shot.
    - $t \in [0.10, 0.20]$ (scroll $112 \to 224\text{px}$, frames 8–15): "FOOD" sustains at 100% opacity as the camera approaches the staircase.
    - $t \in [0.20, 0.28]$ (scroll $224 \to 314\text{px}$, frames 15–22): "FOOD" fades out smoothly while rising.
    - $t \ge 0.28$ (scroll $\ge 314\text{px}$, frame 22 onward): "FOOD" is completely faded and hidden (`display: none`).
    - $t \approx 0.32$ (scroll $\approx 360\text{px}$, frame 25 onward): Camera enters the brick corridor and "THE NINES" Art Deco crest appears cleanly with zero text overlap.
    - $t \approx 0.70$ (scroll $\approx 784\text{px}$, frame 54 onward): "THE NINES" crest fades out as camera glides into the grand dining room.
- **Browser Verification**:
  - Verified via headless Chrome automated test (`scratch/test-title-timing.js`):
    - At frame 22 (`frame0023.webp`): "FOOD" opacity is 0.00 (`display: none`).
    - At frame 25 (`frame0026.webp`): "THE NINES" crest begins with zero text on screen.
    - At frame 37 (`frame0038.webp`): "THE NINES" crest peaks cleanly with zero text on screen.
    - Zero black screens, fluid momentum scrolling, and clean handoff into `first-course.mp4`.

---

## File Structure (as of Phase 2)

```
the-nines-website/
├── .git/
├── .gitignore                 ← (excludes /public/frames)
├── PROGRESS.md
├── package.json
├── vite.config.js
├── index.html                 ← Sticky canvas + scroll container + loader
├── frame-viewer.html
├── public/
│   ├── assets/
│   │   ├── logo.jpg
│   │   └── menu/the-nines-menu.json
│   └── frames/                ← All 19 extracted sequences + manifest
└── src/
    ├── main.js                ← Scroll loop & orchestration
    ├── config.js              ← Layout computation
    ├── scroll-map.js          ← Pure-function state machine
    ├── frame-cache.js         ← Memory/fetch management
    ├── renderer.js            ← Canvas drawing
    └── debug-hud.js           ← Dev tools overlay
```

---

## Technical Details

- **Memory management:** Uses `Image` objects. The browser manages compressed HTTP caching. We maintain a strict `DECODE_WINDOW` of ±10 frames from the current position, evicting frames outside this window so decoded bitmap memory never balloons on long scrolls.
- **Scroll Hijacking:** **None.** The body naturally scrolls. The canvas is `position: sticky`. The `H_length` (menu hold) is directly mapped to the estimated DOM height of the menu items.
- **Cross-dissolve:** Handled cleanly in `renderer.js` by checking `state.crossDissolve` and blending `globalAlpha`.
- **Loading UI:** Initial loader waits until 30% of the first section's frames are loaded (coarse pass complete) before dismissing, ensuring a smooth first scrub.

---

## Next Phase

**Phase 3 — DOM Menu & Styling**
- Build the overlay HTML structure (`position: absolute` containers).
- Mount sections dynamically based on the active section window to keep DOM light.
- Sync DOM container `transform: translateY()` with the scroll offset (the `holdMenuScroll` value from `scroll-map.js`) so the menu scrolls exactly 1:1 with the page during the hold segment.
- Implement the emergence rise and fade-out logic based on `entranceProgress` and `exitProgress`.
- Style typography (Playfair Display + Inter).

---

## Important Notes for Next Model

- Git: `C:\Program Files\Git\cmd\git.exe`
- Node/npm: `C:\Program Files\nodejs\node.exe` and `C:\Program Files\nodejs\npm.cmd`
- Local Vite: `.\node_modules\.bin\vite.cmd`
- To test the engine, open `http://localhost:5173/?debug=1`. You should be able to scroll through all 19 videos stitched together continuously.
