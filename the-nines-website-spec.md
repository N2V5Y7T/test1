# "The Nines" — Restaurant Website: Project Spec (v2)

Living document. v2.1 = reviewed spec + animation choreography integrated.
**Animation behavior (entrance, hold, exit, overlap, button states) is defined in `the-nines-animation-choreography.md` — upload it together with this file. On any animation/timing conflict, the choreography file wins.**

---

## 0. Three hard rules (read first)

1. **Prices ARE shown.** Every menu item shows its price (₹) and a "+" button. Item prices are core content — never remove or hide them.
2. **No payment of any kind.** No payment gateway, no "Pay/Checkout/Order" button, no card/UPI input, no payment wording anywhere. The list panel may show an informational total (sum of items) — that is all.
3. **Reference material and watermarks are never content.** Anything in `reference/` is for style matching only. Any AI-generation sparkle/watermark is an artifact — ignore it, never reproduce it (see 4a).
4. **The menu floats directly over the video.** No panel, card, glass, blur, `backdrop-filter` or opaque layer behind the menu/category text. The video must be plainly visible between and behind the text at all times.
5. **One continuous cinematic shot.** The menu is temporarily *inside* the video experience, not a separate page or section (details in the choreography file).

---

## 1. Core Concept

A single-page, scroll-driven, mobile-first restaurant menu built as a cinematic scroll experience (Apple product page feel + Instagram Reels-style loading). No dish photos — text-only menu overlaid on ambient video imagery. Opened mainly by **QR-code scan on a phone, often on shared restaurant Wi-Fi or mobile data** — first-load speed matters more than anything else.

---

## 2. Background Visual System

- **Format:** frame sequence drawn on a `<canvas>`, NOT a playing `<video>` element. Reason: exact scroll-scrubbing without keyframe/decode lag.
- **Source:** section videos (~5 sec each) provided by the user — AI-generated (e.g. Gemini/Veo) or real footage. Frames extracted at **15 fps**, WebP, ~720–900px wide (final width decided at the Phase 1 quality gate).
- **Scroll mechanism:** native page scroll with a sticky full-screen canvas. **Do not hijack wheel/touch events** (breaks on iOS, breaks keyboard/accessibility, fights momentum scroll).
- **Frames advance only while the user scrolls**; scrolling back up reverses everything exactly. Every animation in this spec (frames, category, menu entry and exit, handoff cross-dissolve) is **scroll-linked and reversible**, not a timer-triggered one-shot.
- **Deterministic mapping:** scroll progress is deterministically mapped to the available frame sequence — frame = f(normalized scroll progress in the section's scrub zone), with each frame owning a defined range of scroll progress (there is no unique frame per physical pixel). Never increment per scroll event. On desktop wheel input, the *displayed* position may ease (lerp) toward the target for smoothness, but the target is always computed from scroll progress.
- **If the exact frame isn't loaded yet**, show the nearest loaded frame (never blank).

### Section anatomy (summary — full rules in `the-nines-animation-choreography.md`)
Each section runs in this scroll order, all scroll-linked and reversible:
1. **Scrub + entrance** — video advances from frame 0 toward the hold frame (~50% of the video). The category and menu emerge over the *still-moving* video (roughly 40–50% of video progress) and everything settles together at the hold frame.
2. **Hold** — video frozen on `holdFrame`; menu fully open and usable; length = rendered menu height.
3. **Exit + video resume** — menu and category lift **upward** and fade; the video starts moving again *before* they finish disappearing.
4. **Continuation** — video plays on to its last frame, then hands off to the next section (Section 3).

Config per section: `holdFrame` (`null` = default ≈ 50% of frames; tuned per video), `scrubLengthVh`, frame count/path, and the choreography timing fractions.

---

## 3. Section Transitions

- **No shutter, no center-closing, no top/bottom "doors" anywhere.** The old shutter transition is removed. The menu always exits **upward**.
- **Video-to-video handoff** (end of one section's video → start of the next): default = short scroll-linked cross-dissolve (~30–40vh of scroll) from the last frame of the current video to frame 0 of the next, with no menu on screen. Reversible. This is an assumption — see open decisions (Section 12).
- Food → Drinks (group change) uses the same handoff.

---

## 4. Menu Content Display

- Text only. Menu text is **real DOM text** overlaid on the canvas (selectable, accessible, crawlable) — never drawn onto the canvas.
- Each item: **name**, **short description**, **price (₹)**, and a **"+" button** (min 44×44px tap target).
- Optional per item (only if data supplied): veg/non-veg dot, spice level, allergen icons.
- Category header (e.g. "STARTERS") above each group of items.
- **Legibility without any backing layer:** no scrim, panel, card, glass, `backdrop-filter` or blur behind menu text — text is drawn directly over the video. Readability comes from text color/weight/size, at most a soft text-shadow on the glyphs themselves, and choosing a `holdFrame` whose text area has good contrast. In Phase 1 the AI reports contrast in the text area for each candidate hold frame; if a frame is too busy, propose a different hold frame (or an approved global grade applied to the video itself) — never a panel. The top/bottom edges of the scrolling item list may fade out via an alpha mask (transparent, not a layer) so items don't collide with the fixed top bar or the category title.
- **Bottom tab strip:** shows the sections of the *current group* only (e.g. Starters · Soups · Mains · Asian), active one bold/highlighted, with pagination dots showing progress in the group. Tapping a tab uses the same capped smooth-scroll as the top nav (Section 5).
- **Fonts & colors — do not guess.**
  - The AI must extract still frames from the reference video(s) (e.g. with ffmpeg) and inspect them.
  - **Colors:** measure with code (dominant/sampled colors from the stills) and report exact hex values for background tones, overlay, text cream/white, accents. Do not eyeball.
  - **Fonts:** identify the closest Google Fonts pair for the serif display face (titles like "FOOD", "THE NINES") and the clean sans (body/labels/prices). Show 2–3 candidates side by side and **wait for approval** — never silently default to Arial/Times/Inter. Note: fonts inside AI-generated video are often not real fonts, so an exact match may not exist; the user's own font choice wins if given.
- **Gemini sparkle/star watermark:** an AI-generation artifact, NOT a design element. Do not build it, replicate it, or use it as an icon.

---

## 4a. Asset Folders, Naming & Mapping

```
assets/
  videos/       ← section videos, one per section, named by section key
  reference/    ← style-only videos + photos (never used as content)
  menu/         ← menu.json (or menu.xlsx / menu.csv to convert)
```

**Video naming rule:** the filename (without extension) is the section key. Confirmed filenames for this project (18 total): `first-course.mp4`, `bar-snacks.mp4`, `veg-starters.mp4`, `nonveg-starters.mp4`, `dimsum-bao.mp4`, `sushi-bar.mp4`, `pizza.mp4`, `pasta-risotto.mp4`, `veg-mains.mp4`, `nonveg-mains.mp4`, `sides.mp4`, `charcoal.mp4`, `staples.mp4`, `sweet-ending.mp4`, `bar.mp4`, `cold-press-juices.mp4`, `refreshers.mp4`, `soft-beverages.mp4`.

**Added (see resolution in Section 4a below): `food.mp4`** — a 19th video, the Food group's own intro. This one maps to the `food` group's top-level `video` field (`groups[].video` in `menu.json`), not to any section — same naming rule applies, mapped by filename, not upload order.

**Mapping rules (strict):**
- Map by filename → config section `key` or its `aliases`. Case-insensitive; singular/plural handled through aliases in config (e.g. `soups` has alias `soup`).
- **Never guess or reorder by upload order.** Section order comes only from the config file.
- A video whose name matches no section key/alias → **stop and ask** with a proposed mapping. Do not invent a section.
- A config section with no matching video → stop and report; do not substitute another video.
- **Resolved:** Bar's spirit categories (vodka, tequila, rum, whisky, gin, etc.) are `subgroups` within the single `bar` section — NOT separate sections with their own videos (user-confirmed; see Section 4a structure table).

**Reference folder:** everything in `reference/` informs fonts, colors, pacing, mood and animation feel **only**. It must never be rendered as a live section or mapped to a menu section.

**Watermark precaution (section videos):** even though the user removes watermarks before upload, in Phase 1 the AI must inspect the first, middle and last extracted frames of every section for a visible sparkle/watermark. If one is found: **stop and report it** (which file, where in frame). Do not silently crop, blur, inpaint or overlay it — that changes framing and needs the user's decision.

### Section structure (CONFIRMED — from the user's actual menu, verified against screenshots, replaces all earlier guesses)

The menu is far larger and more granular than first assumed from the PDF extract — it has 14 distinct Food categories (not 5), each shown as its own page in the restaurant's own menu app, confirming these are meant to be distinct sections. User-confirmed: **each category gets its own video/checkpoint** (no consolidation for Food, unlike Bar).

| Group | Sections (each = own video + own checkpoint) |
|---|---|
| Food | First Course (soups/salads), By the Bar (snacks), To Began Veg (veg starters), To Began Nonveg (nonveg starters — includes Tawa Fish Fry / Ghee Roast / Keema Pav / Mediterranean Sliders), House of Steam (dimsum + Bun Bar, sub-headers), Sushi Bar (veg + nonveg, sub-headers), Taste of Italy (pizza), Pasta and Risotto, All Together Veg (veg mains), All Together Nonveg (nonveg mains), Sides, From the Charcoal, Staples, Sweet Ending |
| Bar | **Bar** (single section, 14 spirit sub-headers inside one hold — see below) |
| Beverages | Cold Press Juices, The Nines Refreshers (Mocktails), Soft Beverages |

**Bar stays consolidated (user-confirmed earlier, unchanged):** one `bar` section, one `bar.mp4`, one hold — all 14 spirit/wine/beer categories (Cocktail Studio, Liqueurs & Digestif, Bourbon, Single Malt, Irish/Japanese Whisky, Rum, Blended Scotch, Gin, Vodka, Tequila, Mezcal, Brandy, Champagne, Rose/Red/White Wine, Beer) scroll inside it as sub-headers.

**House of Steam and Sushi Bar also use sub-headers** (a lighter version of the Bar pattern) since each bundles two visually-distinct sub-lists (dimsum + bao; veg sushi + nonveg sushi) under one page in the source menu — one video, one hold, two sub-header groups inside.

**Total video count: 14 (Food) + 1 (Bar) + 3 (Beverages) = 18 videos.**

Open: does each group have its own intro video (e.g. `food.mp4`, `beverages.mp4`)? Default: yes if the file exists; otherwise the group intro uses the first section's frame 0.

**RESOLVED (user-confirmed):**
- **Food** gets a dedicated intro video, `food.mp4`. It plays first, on scroll: video moves → "FOOD" emerges from center (same emergence pattern as any category title, per the choreography file) → rises → holds on a chosen frame (the user's footage naturally ends on a sushi-themed shot) → "FOOD" lifts and fades while the video resumes → short cross-dissolve handoff (per Section 3) straight into `first-course.mp4`, which then runs its own normal entrance ("The First Course" title, menu, etc.). No group title and no section title are ever shown at the same time — they are sequential, never overlapping in the same frame.
  - **Technical note for the builder:** if the user's supplied hold frame (the sushi shot) is *literally* the last frame of `food.mp4`, there is no footage left for the required post-hold "video resumes/continues" beat before the handoff. Either ask the user for a few extra seconds of footage after that shot, or — if none exists — treat this one specific transition as an exception and go straight from exit-fade into the cross-dissolve, skipping segment C. Flag this to the user during the Phase 1 quality gate rather than guessing.
- **Bar** needs no separate intro video. The Bar group has exactly one section (`bar`), so its existing single video (`bar.mp4`) already does double duty: the section's own category title ("Bar") emerging IS the group's title moment. Its `groups[].video` field stays `null` by design — this is intentional, not an oversight.
- **Beverages** also needs no separate intro video. Its `groups[].video` field stays `null`: on group entry it simply proceeds straight into its first section's own video (`cold-press-juices.mp4`) and that section's own title ("Cold Press Juices") emerges normally — there is no separate standalone "BEVERAGES" title screen. (If the user later wants one, the same `food.mp4` pattern above can be reused for a `beverages.mp4`.)

---

## 4b. Content Data (single source of truth)

All content lives in one `menu.json`. The scroll site, the static fallback, and the SEO structured data are all generated from this same file so prices never go out of sync.

```json
{
  "brand": { "name": "The Nines", "logo": "assets/logo.svg" },
  "currency": { "code": "INR", "symbol": "₹", "locale": "en-IN" },
  "groups": [
    {
      "key": "food", "label": "Food", "video": null,
      "sections": [
        {
          "key": "main-course", "label": "Main Course",
          "video": "main-course.mp4", "holdFrame": null, "scrubLengthVh": 120,
          "items": [
            { "id": "chicken-cafreal", "name": "Chicken Cafreal", "price": 669 },
            { "id": "sukkah-kerala-parotta", "name": "Sukkah with Kerala Parotta",
              "options": [{ "label": "Chicken", "price": 699 }, { "label": "Mutton", "price": 699 }] }
          ]
        },
        {
          "key": "bar", "label": "Bar",
          "video": "bar.mp4", "holdFrame": null, "scrubLengthVh": 600,
          "subgroups": [
            {
              "subHeader": "Single Malt",
              "items": [
                { "id": "glenfiddich-12yo", "name": "Glenfiddich 12 Y.O.", "pour30ml": 889, "bottle": 20500 }
              ]
            },
            {
              "subHeader": "Wines",
              "items": [
                { "id": "stonecross-pinotage-rose", "name": "Stonecross Pinotage Rose", "glass": 789, "bottle": 3999 }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```
**Price field variants (an item uses exactly one of these):**
- `"price": number` — single flat price (most food items).
- `"options": [{ "label": "Chicken", "price": 709 }, ...]` — same dish, different price per choice (e.g. Dum Biryani by protein). Render as a small choice control, not a single price. An option may carry its own `"desc"` when the two choices are different enough to need separate descriptions (e.g. "Tunisian" Chicken vs. Lamb, "Grilled" Chicken vs. Fish) — fall back to the item's own top-level `"desc"` when no option-level one is given.
- `"pour30ml": number, "bottle": number` — spirits (30ml pour + full bottle). Either may be `null` if not offered (e.g. no bottle option).
- `"glass": number, "bottle": number` — wine/champagne by the glass + bottle. Either may be `null`.
- `"price": "seasonal"` — a string instead of a number for items without a fixed price (e.g. Fresh Juice). Display as "Seasonal" / "Market price," not as ₹0 or blank.
- A `null` price value must render as "—" or be hidden, never as ₹0 or blank (e.g. Dom Pérignon has no glass price).

**Sub-headers:** a section may have `"subgroups"` instead of a flat `"items"` array — each subgroup has a `"subHeader"` label and its own `"items"`. Rendered as one continuous scrollable hold with sub-header labels breaking up the list, not as separate sections. Used for Bar (14 spirit categories) and also for House of Steam (dimsum + Bun Bar) and Sushi Bar (veg + nonveg) sections, which each bundle two sub-lists under one video/hold.

- `holdFrame: null` means the default (≈ 50% of frames) from the choreography file.
- Cart stores item **ids + quantity + chosen option/variant label**, and looks prices up from this file (so a price change never leaves stale prices in a saved list). For `options`/`pour30ml`+`bottle`/`glass`+`bottle` items, the "+" flow must let the user pick which variant before adding — never assume the first one.
- Owner editing: start with `menu.json`; a small script to build it from an Excel/CSV sheet is recommended so non-technical owners can update prices.
- **Source data note:** the menu was extracted from a PDF; some special characters were garbled in extraction (e.g. `NÂ°` instead of `N°`, `MoÃ«t` instead of `Moët`). All item names in the actual `the-nines-menu.json` file have been manually corrected — if the owner edits/re-exports from a PDF in future, re-check special characters (°, é, ë, ô) before publishing.

---

## 5. Navigation

- Fixed top bar: hamburger (left), logo (center), **My List** icon with count badge (right). Bar sits over the video with enough contrast to read.
- **Logo sourcing:** `menu.json`'s `brand.logo` is `null` by default — check `assets/reference/` for a logo image file (any obviously-named logo file, e.g. containing "logo" in the name, or the clearest standalone brand mark among the reference images) and use it in place of the text wordmark if one is found; copy it into the project as `assets/logo.png` (or matching extension) and update `brand.logo` to that path. If no separate logo file exists in `reference/`, fall back to a text wordmark reading the `brand.name` value ("THE NINES"), styled in the matched serif display font — this matches how the reference screenshots show it. Do not invent a logo or leave the space blank either way.
- Hamburger opens a panel listing groups and sections; tapping one triggers the capped smooth-scroll.
- **Nav jump behaviour:** custom rAF scroll tween, ~800ms total (under 1 sec), eased, regardless of distance. (`scrollTo({behavior:'smooth'})` has no duration control — don't rely on it.) Disable scroll-snap during the tween.
- During a jump, intermediate sections show **only their blur placeholder / first frame** and trigger no downloads; only the **destination** section loads (highest priority). Rapid taps cancel the previous jump.

---

## 6. "Add to List" Flow

- Purpose: build a simple list to **read out to the waiter**. Not an order, not a cart in the shopping sense. UI wording: **"My List"** — avoid "Cart/Checkout/Order".
- "+" tap: small animation (dot flies to the list icon, icon pulses, count updates). This one-shot feedback is the only non-scroll-linked animation allowed.
- **"+" buttons are active only while the menu is fully open (HOLD).** During entrance and exit they are disabled (`pointer-events: none` + `inert`), derived from scroll position — no add, no fly-to-list, no button animation.
- Slide-in panel from the right shows: item name, quantity with − / + controls, remove, price per item, line total, and a **running total** labelled e.g. "Estimated total" (informational; note whether taxes/service charge are included — see open decisions). Plus "Clear list".
- **Persisted** in `localStorage` so a refresh or accidental back-navigation doesn't wipe the list. Wrap storage access in try/catch (private mode can block it).
- **No payment UI of any kind** (Rule 2).

---

## 7. Performance & Loading Strategy

Guiding principle: Instagram Reels-style predictive lazy loading — with correct memory handling.

| Section state | Behavior |
|---|---|
| Current section | Fully loaded, ready to scrub |
| Next section | ~20–30% loaded once user is ~70–80% through current |
| Further ahead | Not loaded |
| Scrolled past quickly | In-progress loads **aborted** (fetch + AbortController) |

- **Coarse-to-fine loading:** load frames in a spread order (e.g. every 4th frame first, then fill gaps) so scrubbing works smoothly at low fidelity early, instead of frames 0–20 sharp and the rest missing.
- **Blur-up:** a tiny (~2–3KB) placeholder per section, **inlined in the config/JS** so it exists with zero extra requests. Never a blank or white screen.
- **Cache (compressed) vs decode (memory) — two different things:**
  - Loaded frames are kept as **compressed data** (HTTP cache with long `immutable` cache headers + hashed filenames, optionally a service worker). Scrolling back to a visited section never re-downloads.
  - **Decoded** bitmaps are **not** kept for whole sections. One decoded 720×1280 frame ≈ 3.5MB; a 75-frame section ≈ 260MB decoded — several sections would crash a phone browser. Keep only a **sliding window of decoded frames** around the current position (e.g. ±10 frames ≈ 70MB) and decode on demand.
  - "Keep last 4–5 sections" applies to *compressed* data only, and is a fallback for low-end devices.
- Cap canvas devicePixelRatio at 2.
- **Hosting:** static hosting behind a CDN (Cloudflare Pages / Netlify / Vercel) with HTTP/2 or HTTP/3 and long cache headers — ~700+ small files must not be served from a slow single-region server. Decide hosting before Phase 1.
- **Initial loader:** progress-based, not a fake timer. It ends as soon as the first section's placeholder + minimum frames are ready (with a short minimum display time only to avoid a flash). Target: interactive quickly on real slow-4G; measured, not assumed.

---

## 8. File Size / Data Budget (estimate)

- ~10–15 sections (depends on drinks sub-sections). Each: 5 sec @ 15 fps = 75 frames × ~15–25KB WebP ≈ **1.1–1.9MB per section**.
- Total across all sections ≈ 15–25MB, **never loaded at once**. Typical active load ≈ 2–3MB (current + partial next).
- Budgets are targets reached through lazy-loading and sane compression — **not** permission to degrade quality.
- All load-time and size figures in this spec (e.g. ~2–3MB active load, "a few seconds on 4G") are approximate targets to measure against, **not guaranteed acceptance criteria**.
- Quality gate on the first section decides final width (720 vs 810/900 for sharper high-DPI phones), WebP quality, and whether AVIF is worth it (AVIF decodes slower on low-end phones and needs newer iOS — WebP is the default).

---

## 9. Mobile-First, Desktop Fallback

- Mobile 9:16 is the source of truth. Use `100dvh`/`svh` (not `100vh`) so the iOS/Android address bar collapsing doesn't cause layout jumps; don't resize the canvas on every toolbar show/hide.
- Desktop: the vertical frame stays at its natural ratio, centered, with plain dark side bars. No stretching. No blur effects anywhere over or behind the menu.
- Touch/scroll updates via passive listeners + `requestAnimationFrame`.
- Landscape phones: show the same centered vertical layout; don't stretch.

---

## 10. Explicitly Out of Scope

- Payment gateway, online ordering, checkout, any payment wording/UI.
- Dish photography.
- User accounts, backend, table ordering to kitchen.

---

## 11. Accessibility, SEO, Fallback

- **Reduced motion:** honor `prefers-reduced-motion` (shorter/simple transitions, no fly-to-cart travel; scrub still works).
- **Keyboard/screen reader:** native scroll keeps Space/PageDown working; "+" buttons are real buttons with labels ("Add Tomato Basil to list").
- **Static fallback:** plain HTML menu (`<noscript>` + failure fallback) generated from `menu.json`.
- **SEO:** real DOM text + schema.org `Restaurant`/`Menu`/`MenuItem` JSON-LD generated from `menu.json`.
- **Theme color / meta viewport** set for mobile; add `viewport-fit=cover` and respect safe-area insets.

---

## 12. Decisions Still Open

1. ~~Final section structure~~ — **RESOLVED**, see Section 4a (9 videos: 5 Food + 1 Bar + 3 Beverages). ~~Whether groups have intro videos still open.~~ — **RESOLVED**: Food gets its own `food.mp4` intro; Bar and Beverages don't need one (see full reasoning in Section 4a).
2. Dietary/allergen tags: yes/no (food items don't currently indicate veg/non-veg — needs owner input, several dishes are ambiguous e.g. "Fried Rice (Veg/Egg/Chicken/Prawns)").
3. Total label: does the "Estimated total" include GST/service charge, or say "excluding taxes"?
4. Owner editing: JSON only vs Excel→JSON script vs admin panel.
5. Reuse as a template for other restaurants (affects how strictly everything is config-driven).
6. Analytics: none / privacy-friendly basic (sections viewed, items added).
7. Font choice (user's own vs approved candidate).
8. Video-to-video handoff: default is a short scroll-linked cross-dissolve; does the user's footage chain naturally instead?
9. Category title: pinned at top during hold (default) vs scrolling with the items.
10. My List drawer and hamburger panel are separate overlays and may have their own background (default yes); the no-panel rule applies to the menu/category over the video.
11. Whether a soft glyph text-shadow is acceptable for legibility.

---

## 13. What's Needed From User to Start

1. Section videos in `assets/videos/`, named by section key, ~5 sec each, watermark-free.
2. `reference/` folder with the style video(s) and photos.
3. Full menu content (sections, items, descriptions, prices) — or the raw list; the AI structures it into `menu.json`.
4. Logo / brand name + font preference if any.
5. Answers to the open decisions above.

---

*Business/pricing notes for the freelance project were removed from this spec on purpose — they live in `the-nines-review-notes.md` (do not upload that file to the AI builder).*
