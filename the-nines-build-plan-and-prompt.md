# "The Nines" — Build Plan + Execution Prompt (v2)

Two parts:
1. **PART A** — the phased build plan (context for the AI).
2. **PART B** — the prompt you paste in.

Upload together with `the-nines-website-spec.md` (v2.1) and `the-nines-animation-choreography.md`, plus your folders: `assets/videos/`, `assets/reference/`, `assets/menu/`.

---

## PART A — Phased Build Plan

**Fixed tech decisions (so different models across phases stay consistent):**
- Vite + vanilla JavaScript (no React needed), one `<canvas>` + DOM overlay, config-driven via `menu.json`.
- Native scroll with sticky canvas (no wheel/touch hijacking).
- Static hosting on a CDN (Cloudflare Pages / Netlify / Vercel) — confirm with user in Phase 0.

**Handoff file:** at the end of every phase, update `PROGRESS.md` (what's done, file map, decisions made, open issues, next phase). The user may switch AI models between phases — the next model knows nothing except the repo and this file.

### Phase 0 — Setup, Inventory & Approvals
- Scan `assets/`. Report: every video found → mapped section key (or "unmatched"), missing videos for config sections, contents of `reference/`.
- Extract stills from reference video(s) with ffmpeg; **measure** the color palette with code and report hex values; propose 2–3 font-pair candidates (Google Fonts) side by side.
- **`menu.json` is already provided** at `assets/menu/the-nines-menu.json` (pre-structured, 18 sections/videos: Food×14, Bar×1 with 14 subgroups, Beverages×3 — 315 items total). Validate it against the videos found (every section key has a matching video filename) rather than drafting it from scratch. Confirm sub-header rendering (Bar's 14 spirit lists; House of Steam's dimsum+Bun Bar; Sushi Bar's veg+nonveg — each inside one hold) is understood before Phase 3.
- Check for variant-pricing items (`options`, `pour30ml`+`bottle`, `glass`+`bottle`, `"price": "seasonal"`) in the menu data — confirm the planned UI can show a choice control for these before building, not just a flat price.
- Confirm hosting choice and the open decisions in spec Section 12.
- **Stop.** Nothing else starts until the user approves palette, fonts, structure.

### Phase 1 — Asset Pipeline (one section first, then one at a time)
1. Process the FIRST section only: extract at 15fps → WebP (~720px) → tiny inline blur placeholder.
2. Watermark check on first/middle/last frames (spec 4a). If a sparkle is found, stop and report.
3. Build a **minimal test viewer** (a frame slider) so quality can be judged visually on a phone. *Do not wire scroll checkpoints in this phase — the scroll engine doesn't exist until Phase 2.*
4. **Quality gate (first section only):** report frame count, per-frame size, total size, and visual quality vs source (blur, banding, artifacts) with side-by-side stills. Test 720 vs a wider option; try quality settings before touching AVIF. **Wait for explicit approval.**
5. After approval, process remaining sections **one at a time**, verifying each (frames clean, count correct, no watermark, filename matches config key) before the next.
- **Hold frame proposal (per section):** propose a `holdFrame` (default ≈ 50% of frames) and show that still, with a contrast check of the area where menu text will sit (no panel allowed behind it). If the frame is too busy, propose an alternative frame.
- Output filenames hashed for long-term caching; per-section manifest (frame count, sizes, placeholder, `holdFrame`).

### Phase 2 — Core Scroll-Scrub Engine
- Sticky canvas + tall scroll container; scroll timeline per the choreography file: segments A (scrub+entrance) · H (hold) · X (exit, video resumes partway) · C (continuation) · J (handoff), all a pure function of scroll position.
- Progress → frame mapping (deterministic), nearest-loaded-frame fallback, DPR capped at 2, `100dvh`.
- Checkpoint/hold logic driven by config (`holdFrame`, `scrubLengthVh`, hold length = measured menu height).
- Video eases out into the hold and eases in when resuming (no jump); resume point during exit is the tunable `exitVideoResumeAt`. Tuned values reported.
- **Debug HUD (`?debug=1`)**: scroll position, video progress p, segment (A/H/X/C/J), entrance/exit progress, "+" state. Required so the owner can verify exactly when video stops/resumes and when UI enters/leaves.
- **Decoded-frame sliding window** (memory safety) built into the renderer from day one — not added later.
- Test on a phone-sized viewport from this phase onward (mobile is not a late-phase concern).

### Phase 3 — Menu UI & Transitions
- Real DOM menu text: name, description, price (₹), "+" button; category header; scrim for legibility.
- Bottom tab strip (current group's sections only) + pagination dots.
- Entrance and exit exactly per the choreography file: category emerges from center → rises → menu revealed beneath; exit lifts menu + category **upward** and fades, overlapping with the video resuming. **No shutter anywhere.**
- "+" buttons inert (`pointer-events:none` + `inert`) outside HOLD.
- Transparent UI: no panel/glass/blur/`backdrop-filter` behind menu; alpha-mask edge fade for the item list.
- Video-to-video handoff (default short cross-dissolve) unless the user says otherwise.
- Apply approved fonts/colors.

### Phase 4 — Navigation & My List
- Fixed top bar (hamburger, logo, My List + count badge); hamburger panel listing groups/sections.
- Custom rAF capped scroll tween (~800ms), rapid-tap cancel; tab strip uses the same tween.
- "+" fly-to-list animation and count pulse.
- My List panel: quantity −/+, remove, clear, line totals, estimated total, `localStorage` persistence (try/catch), prices looked up from `menu.json` by id. **No payment UI.**

### Phase 5 — Loading Strategy
- Priority queue: destination/current > next section (~20–30%, coarse-to-fine order) > nothing.
- Abort in-flight loads (AbortController) for sections scrolled past; nav jumps load only the destination while intermediate sections show placeholders.
- Compressed-frame cache (HTTP cache headers + optional service worker); decoded window stays capped.
- Blur-up from inline placeholders; progress-based initial loader (no fake timer).
- Prove with the network panel: only the intended frames load at the intended times.

### Phase 6 — Desktop, Responsive & Motion Polish
- Desktop centered vertical frame with dark/placeholder-blur side bars; landscape phones; safe-area insets.
- Wheel-input smoothing (display eases toward computed target).
- `prefers-reduced-motion` behavior; touch-target and contrast checks.

### Phase 7 — Fallback, SEO & Extras
- Static HTML menu + JSON-LD (`Restaurant`/`Menu`/`MenuItem`) **generated from `menu.json`** at build time.
- Dietary/allergen tags only if data is supplied.
- Optional: Excel/CSV → `menu.json` converter for the owner.

### Phase 8 — Testing & Final QA

**A. AI-runnable (must attach evidence: screenshots, network log, numbers):**
1. Throttled Slow 4G / 3G scroll-through, no blank/white frames
2. Fast scroll through many sections
3. Slow deliberate scroll
4. Scroll backwards through visited sections (instant, sharp, no re-download)
5. Rapid nav-tab clicks between distant sections
6. "+" and My List behavior incl. persistence after reload
7. Reload mid-scroll
8. JS-disabled fallback readable
9. Desktop Chrome full scroll-through
10. Payload check vs budget, memory check (decoded window stays capped)
11. No payment wording/UI anywhere; prices present on every item
12. Choreography verification: capture screenshots/HUD readings at scroll positions across entrance, hold, exit, continuation, and confirm the video is moving during category emergence and already moving before the menu is fully gone
13. "+" is inactive during entrance and exit, active only in HOLD (test taps at each stage)
14. Reverse scroll through entrance/exit is symmetrical (no timers, stops where scrolling stops)
15. CSS/DOM search proves no `backdrop-filter`, no `filter: blur`, no background on menu containers

**B. User must test on real devices (AI cannot do these — it must hand the user this checklist):**
1. Chrome on a real Android phone (include one low-end phone if possible)
2. Safari on a real iPhone (address bar collapse, momentum scroll, memory)
3. Opening via QR scan → in-app browsers (WhatsApp / Instagram) if used
4. Restaurant Wi-Fi / mobile data reality check
5. Landscape rotation, iOS Low Power Mode

Anything the AI could not verify is marked **UNVERIFIED** — never "complete".

---

## PART B — The Execution Prompt (paste into Antigravity / Claude Code)

```
You are building "The Nines," a mobile-first, scroll-driven restaurant menu website.

Inputs:
1. the-nines-website-spec.md (v2) — the full requirements. It is the source of truth.
2. the-nines-animation-choreography.md — the exact animation behavior. It overrides the spec on any animation/timing conflict.
3. the-nines-build-plan-and-prompt.md — the phased plan (Part A).
4. assets/videos/ (section videos, named by section key), assets/reference/ (style-only videos and photos), assets/menu/ (menu content).

Work through Part A's phases IN ORDER (Phase 0 first). Do not skip ahead.

HARD RULES (from spec Section 0):
- Every menu item shows its price (₹) and a "+" button. Never remove prices.
- No payment of any kind: no gateway, no checkout/pay/order button, no payment wording. My List may show an informational estimated total only.
- The menu floats directly over the video: no panel, card, glass, blur, backdrop-filter or opaque layer behind menu/category text.
- Files in assets/reference/ are style-only, never content. Any Gemini sparkle/watermark is an artifact: never reproduce it. If one appears in a section video's frames, stop and tell me — do not silently crop or hide it.

VIDEO MAPPING:
Map videos to sections strictly by filename → section key/alias in the config. Never guess or reorder by upload order. If a filename matches nothing, or a section has no video, stop and ask me with a proposed mapping.

REFERENCE STYLE:
You may not be able to "watch" video. Extract still frames with ffmpeg and inspect them. Measure colors with code and report hex values. Propose 2–3 font-pair candidates and wait for my approval; never silently pick generic defaults.

PAUSE-AND-CONFIRM AFTER EVERY PHASE:
After each phase: (1) update PROGRESS.md (done, file map, decisions, open issues), (2) commit to git with a clear message, (3) summarize what was built and how it satisfies the spec, (4) ask: "Phase [N] complete — should I continue to Phase [N+1]?" Do not continue without my reply. I may switch AI models between phases, so PROGRESS.md and the repo must be enough for a fresh model to continue.

PHASE 1 QUALITY GATE:
Run the full pipeline on ONE section first. Report frame count, per-frame size, section total, and visual quality vs the source (with side-by-side stills). Wait for my explicit approval before processing the remaining sections. If quality is weak, adjust WebP quality/width and re-test the same section first.

QUALITY RULE:
Never silently degrade visual quality, features or effort to save tokens, time or file size. Performance budgets are targets, not permission to cut corners. If you're running low on context and can't finish a phase properly, STOP and tell me exactly what's incomplete.

DESIGN FIDELITY RULE:
Don't redesign or simplify the specified interaction model (scroll-scrub, the choreography file's entrance/hold/exit/overlap timing, upward exit, inert buttons outside HOLD, capped nav scroll). If you think something else is better, build the spec'd version first, then suggest the alternative separately.

NO FAKE IMPLEMENTATION RULE:
A feature is "complete" only if it works in a real browser. Placeholder logic, unconnected functions, simulated data or a fake loading timer do not count. "Lazy loading works" means the network log shows only the right frames at the right time. If you cannot test something (real iPhone, real Android), mark it UNVERIFIED and list it for me — never claim it passed.

ANIMATION CHOREOGRAPHY RULE:
Follow the-nines-animation-choreography.md exactly. Specifically: the video is still moving while the category and menu emerge; the menu exits UPWARD (never a shutter); the video starts moving again BEFORE the menu has fully disappeared; the video is frozen while the menu is held; nothing sits behind the menu text. All of it is scroll-linked, reversible and timer-free. Verify with the debug HUD and report actual numbers; if something can't be verified, mark it UNVERIFIED.

DETERMINISTIC MAPPING:
Frame shown = function of normalized scroll progress in the section's scrub zone — never incremented per scroll event. Missing frame → show nearest loaded frame, never blank.

MEMORY RULE:
Do not keep all decoded frames in memory (a 720×1280 decoded frame ≈ 3.5MB; a section ≈ 260MB). Keep compressed data cached, and only a sliding window of decoded frames near the current position.

SELF-CORRECTION LOOP (per phase, before asking to continue):
Re-read the relevant spec sections and check your work point by point: matches behavior (not "close enough"), timing/feel (entrance/exit overlap, easing, upward exit, capped scroll), loading actually implemented, nothing hardcoded that belongs in config, no rule above violated. If anything fails, fix and re-check from the top. Maximum 3 full passes per phase; if issues remain after that, report them honestly to me instead of looping or hiding them. Include evidence (screenshots, network logs, numbers) in your report.

FINAL FULL-SPEC PASS (after Phase 8 and my confirmation):
Re-read the entire spec top to bottom and verify the finished site against every section (including that out-of-scope items are absent and all prices are shown). Fix mismatches and re-run, up to 3 passes, then report any remaining gaps and the list of UNVERIFIED items.

Begin with Phase 0.
```

---

### How to use
1. Put files in place: `assets/videos/`, `assets/reference/`, `assets/menu/`; upload both `.md` files.
2. Paste the Part B prompt. It starts at Phase 0 and stops for your approval of palette, fonts and section structure.
3. Before replying "continue" each time, switch model if you want — `PROGRESS.md` carries the context.
4. In Phase 8, run the real-device checklist yourself and report back.
