# THE NINES — Animation Choreography (authoritative for all section animation)

**Non-negotiable.** This is the exact intended scroll behavior. Do not simplify it, redesign it, swap it for generic fade/slide animations, or treat the menu as a separate page or card layered over the video. On any animation/timing conflict with `the-nines-website-spec.md`, this file wins.

Mental model (never lose this):

> The menu is temporarily floating directly inside the cinematic video. It is not a page, not a card, not an opaque overlay, not an independent animation. It is a transparent, scroll-linked UI layer.
> UI: **EMERGES → RISES → OPENS → HOLDS → INTERACTS → RISES → FADES → OVERLAPS with video resuming → DISAPPEARS**
> Video: **MOVES → SETTLES → FREEZES → MOVES AGAIN → CONTINUES**
> The two are choreographed together as one seamless continuous shot.

---

## 1. Background and transparency

- The section frame sequence is the actual background, clearly visible behind the UI throughout. Not a video box behind a menu.
- Menu/category/prices/descriptions/buttons are DOM elements floating **directly** over it.
- **Forbidden behind the menu:** solid panel, opaque rectangle, glass/card container, white/black menu background, `backdrop-filter`, any `filter: blur`, blurred opaque backdrop, boxed "website section".
- Readability aids allowed: text color/weight/size, a soft text-shadow on the glyphs, a good `holdFrame` choice, and an alpha-mask fade on the top/bottom edges of the scrolling item list. Only if readability still genuinely fails after those, an extremely subtle, translucent overlay is allowed as a last resort — it must never visually read as a menu background/panel, and the AI must show the user the result and get approval first.
- Target look: video visible in the gaps between `STARTERS` / `Tomato Basil ₹220 +` / `Hot & Sour ₹240 +` lines — **not** a boxed card with those lines inside.

## 2. One continuous shot — never these breaks

- video stops → menu suddenly appears
- menu disappears → pause → video starts
- video ends → separate menu section → next video

Everything overlaps naturally. No perceptible dead pause anywhere.

## 3. Definitions (so the numbers below are unambiguous)

- **Video progress `p`** (0–1) = position in the section's frame sequence (frame / frameCount).
- Percentages in Section 4 are in **video progress**. `holdFrame` ≈ p 0.50 by default (tuned per video and configurable).
- All animation state is a pure function of scroll position. Segments in scroll order:
  **A** scrub+entrance (p: 0 → holdP) · **H** hold (p fixed = holdP) · **X** exit (menu leaves; video resumes partway through) · **C** continuation (p → 1) · **J** handoff to next section.
- **H length = actual rendered menu height** (short menu → short hold, long menu → long hold; never a fixed duration).
- The 40–50% figures are **tuning targets, not rigid playback times.** Report the final tuned values.

```json
"choreography": {
  "categoryStart": 0.40,
  "categoryRiseEnd": 0.47,
  "menuStart": 0.47,
  "holdAt": 0.50,
  "exitVideoResumeAt": 0.40,
  "exitLengthVh": 70
}
```
(`exitVideoResumeAt` = fraction of the exit segment X at which the video starts moving again; tune by eye.)

## 4. Entrance (scroll-linked)

| Video progress | Video | UI |
|---|---|---|
| 0 → 0.40 | Moving continuously | **Nothing** — no menu, no category |
| ≈ 0.40 | Moving | Category (STARTERS / SOUPS / MAINS / ASIAN …) begins **emerging from the CENTER of the screen** — smooth fade/emergence plus movement, not a side slide |
| 0.40 → 0.47 | Still moving | Category becomes more visible and moves **upward** |
| 0.47 → 0.50 | Easing toward `holdFrame` | Category keeps rising; **menu emerges beneath it** (revealed from underneath the category) |
| ≈ 0.50 | Reaches `holdFrame`, settles into freeze | Category + menu at completed state |

**Critical overlap:** never "video moves → stops → menu opens." The video moves while the category emerges, rises, and the menu appears; the video ends slightly ahead/underneath and everything settles together. Video eases out (decelerates) into the hold so there is no jerk. There is no dead pause.

## 5. Hold

- Video frozen on the explicit `holdFrame` (never replaced by another background); menu fully open and usable.
- Each item: name, description, price (₹), "+" button, optional dietary/allergen info.
- User scrolls through the whole section's menu; **background stays frozen** the whole time; no opaque container covers it.
- Category title placement during hold: **pinned at the top** and lifts away with the menu at exit (assumption — see Section 11).

## 6. Exit (upward — NOT a shutter)

Triggered when the user reaches the end of the menu and keeps scrolling. **Not** top+bottom closing to the center. The whole visible composition leaves **upward**:

1. Final menu content begins moving up; the rest follows.
2. The category title follows the menu up (same composition, same direction — never left floating behind, never leaving in another direction).
3. While rising, everything rapidly fades to transparent.
4. Composition is gone at the top. Relatively quick and decisive: "the menu has been lifted away."

## 7. Critical exit overlap with the video

The video must **not** wait for the menu to fully disappear.

| Exit stage | Menu + category | Video |
|---|---|---|
| Early | Start rising, fade begins | Still at/near `holdFrame` |
| Middle | Continue rising, fading | **Begins moving away from `holdFrame`** (eased in from zero speed — no visual jump) |
| Late | Almost gone | Visibly moving |
| End | Completely gone | Already in motion; continues naturally into segment C |

Never: menu disappears → video waits → video starts.

## 8. "+" / Add-to-List button states (interaction rule)

State is derived from scroll position only (no timers):

| State | "+" buttons |
|---|---|
| Entrance (category/menu emerging) | **Inactive** — no response to taps, no Add-to-List, no fly-to-list animation, no interference with scroll |
| HOLD (menu fully settled) | **Active** — normal My List behavior |
| Exit begins → section fully gone | **Inactive** immediately — pointer/touch disabled, no button animation |

Implementation: `pointer-events: none` **and** `inert` (so keyboard/screen-reader can't trigger them either) whenever not in HOLD. Reversing scroll re-enters the state that matches the position.

## 9. Scroll-linked and reversible (no timers)

- Forbidden for entrance/exit/video: autoplay timers, `setTimeout` sequences, one-shot entrance/exit animations, animations that continue after the user stops scrolling.
- Stop scrolling mid-animation → animation stops right there. Reverse direction → animation reverses smoothly and symmetrically.
- The only allowed non-scroll animation: the one-shot "+" feedback (fly-to-list, badge pulse) in HOLD.

## 10. Wrong interpretations — never implement

- Video stops completely, then menu suddenly appears
- Opaque menu/card background, large dark rectangle, glass panel, blur behind menu
- Menu as a separate webpage section
- Category sliding in from a random direction
- Category remaining behind after menu exit, or exiting in a different direction
- Menu closing from top and bottom toward the center (shutter)
- Menu disappearing instantly without movement
- Menu disappearing fully before the video begins moving; any pause between menu exit and video resume
- Active "+" buttons during entrance or exit
- Timer-driven or irreversible animation
- Background changing while the user reads/interacts with the held menu
- Any visual jump between the held frame and the resumed video

## 11. Interpretation notes and assumptions (added during review — confirm or override)

1. **Percentages are video progress**, with the hold frame at ≈ 50%. The video's second half plays *after* the menu exits (segment C) — so a section's video is ~50% "before menu" and ~50% "after menu".
2. **Category pinned during hold** (default): the title stays at the top while items scroll, then lifts with the menu at exit. Because nothing may sit behind the text, items fade out near the top via an alpha mask so they don't collide with the pinned title or fixed top bar.
3. **Video-to-video handoff** isn't described in the choreography; default = a short scroll-linked cross-dissolve between the last frame of one video and frame 0 of the next (no menu on screen). If the user's videos chain visually, replace with a hard continuation.
4. **Separate overlays** (My List drawer, hamburger panel) are not part of this rule and may have their own backgrounds.
5. The menu/category composition is "one composition": items, category and mask move together during exit.
6. **Debug HUD (required, `?debug=1`):** shows scroll position, video progress `p`, current segment (A / H / X / C / J), entrance progress, exit progress, and "+" state (active/inactive). Purpose: the owner and the AI can verify exactly when the video stops, when it resumes, and when the UI enters/leaves.
7. **Static guard:** no `backdrop-filter`, no `filter: blur`, and no background color/gradient on any menu container may exist in the CSS (verified by search).

## 12a. Group intro video (`food.mp4`) — same rules as any section

The Food group's intro video is not a special case animation-wise — it follows every rule above exactly, with "FOOD" standing in for the category title:

- Entrance (Section 4): video moves → "FOOD" emerges from center around p≈0.40 → rises → menu-less hold at the chosen `holdFrame` (no items, just the settled title).
- Exit (Sections 6–7): "FOOD" lifts upward and fades while the video resumes moving underneath it — never a hard cut.
- Handoff into `first-course.mp4` uses the standard cross-dissolve (Section 3), with no menu visible during the crossfade.
- If the supplied footage's natural hold moment (e.g. a sushi-themed closing shot) sits at the very last frame, there's no room left for the post-hold "video resumes" beat before the handoff. Confirm with the user whether a few extra seconds of footage exist after that shot; if not, this one handoff may skip segment C and go straight from exit-fade into the cross-dissolve — report this as a deviation rather than silently forcing it.

## 12. What the user should feel

Video moving → a title emerges from its center → rises and reveals the menu beneath → the background settles into one beautiful frame → the menu floats directly over it, comfortable to scroll and use → at the end the whole composition lifts upward and fades → before it's gone, the video is already moving again → menu vanishes while the video continues → the same shot carries on. One continuous sequence, not separate sections.
