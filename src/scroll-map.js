/**
 * The Nines — Scroll Map
 *
 * Pure function: given absolute scroll position → section state.
 * All animation state is derived from this — no timers, fully reversible.
 */

import { CHOREOGRAPHY } from './config.js';

/**
 * C1-continuous velocity easing near segment boundaries.
 * Eliminates the 2.0x velocity spike that occurred at t = 1 - zone and t = zone
 * when splicing quadratic curves onto a unit-slope line.
 */
function easeVideoProgress(t, applyEaseOut, applyEaseIn, zone = 0.18) {
  t = Math.max(0, Math.min(1, t));

  if (applyEaseOut && !applyEaseIn) {
    const z = zone;
    const v = 1 / (1 - 0.5 * z); // cruising slope so integral equals 1.0
    if (t <= 1 - z) {
      return v * t;
    }
    const u = (t - (1 - z)) / z; // 0..1 in deceleration zone
    return v * (1 - z) + v * z * (u - 0.5 * u * u);
  }

  if (applyEaseIn && !applyEaseOut) {
    const z = zone;
    const v = 1 / (1 - 0.5 * z);
    if (t < z) {
      const u = t / z; // 0..1 in acceleration zone
      return v * z * (0.5 * u * u);
    }
    return v * (t - 0.5 * z);
  }

  if (applyEaseIn && applyEaseOut) {
    const z = zone;
    const v = 1 / (1 - z);
    if (t < z) {
      const u = t / z;
      return v * z * (0.5 * u * u);
    }
    if (t <= 1 - z) {
      return v * (t - 0.5 * z);
    }
    const u = (t - (1 - z)) / z;
    return v * (1 - 1.5 * z) + v * z * (u - 0.5 * u * u);
  }

  return t;
}

/**
 * Given absolute scroll position, return the current state.
 *
 * @param {number} scrollY - absolute scroll position in px
 * @param {Array} layout - from computeScrollLayout()
 * @returns {object} state object
 */
export function getScrollState(scrollY, layout) {
  const defaultState = {
    sectionIndex: 0,
    section: layout[0],
    segment: 'A',
    videoProgress: 0,
    frameIndex: 0,
    frameFloat: 0,
    segmentProgress: 0,
    entranceProgress: 0,
    categoryProgress: 0,
    menuProgress: 0,
    exitProgress: 0,
    holdMenuScroll: 0,
    buttonsActive: false,
    crossDissolve: null,
  };

  if (!layout.length) return defaultState;

  // Clamp scroll
  const totalScroll = layout[layout.length - 1].scrollEnd;
  scrollY = Math.max(0, Math.min(scrollY, totalScroll));

  // Binary search for active section (O(log N) instead of linear scan)
  let lo = 0;
  let hi = layout.length - 1;
  let sec = layout[hi];
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const candidate = layout[mid];
    if (scrollY < candidate.scrollStart) {
      hi = mid - 1;
    } else if (scrollY >= candidate.scrollEnd && mid < layout.length - 1) {
      lo = mid + 1;
    } else {
      sec = candidate;
      break;
    }
  }

  const idx = sec.index;
  const { holdP, frameCount } = sec;

  // ── Special handling for Group Intro (FOOD) ───────────────────────────
  if (sec.type === 'group-intro') {
    if (scrollY < sec.A_end) {
      const rawT = sec.A_length > 0 ? (scrollY - sec.A_start) / sec.A_length : 0;
      const t = Math.max(0, Math.min(1, rawT));
      const p = t;

      // Title choreography for 78-frame sequence:
      // Emerges right from initial view (visible at scrollY=0 so first screen has clear identity),
      // rises smoothly, and fades out completely by t = 0.26 (frame 20), well before the
      // brick corridor "THE NINES" crest appears at frame 28 (t ≈ 0.36).
      const FADE_OUT_END = 0.26;
      let titleOpacity = 0;
      if (t < 0.04) {
        titleOpacity = 0.85 + (t / 0.04) * 0.15;
      } else if (t < 0.16) {
        titleOpacity = 1;
      } else if (t < FADE_OUT_END) {
        titleOpacity = 1 - (t - 0.16) / (FADE_OUT_END - 0.16);
      } else {
        titleOpacity = 0;
      }

      const titleProg = Math.min(1, t / FADE_OUT_END);
      const frameFloat = Math.max(0, Math.min(frameCount - 1, p * (frameCount - 1)));
      const frameIndex = Math.floor(frameFloat);

      return {
        sectionIndex: idx,
        section: sec,
        segment: 'A',
        videoProgress: p,
        frameIndex,
        frameFloat,
        segmentProgress: t,
        entranceProgress: titleOpacity,
        categoryProgress: titleOpacity,
        menuProgress: 0,
        exitProgress: 0,
        holdMenuScroll: 0,
        buttonsActive: false,
        crossDissolve: null,
        introTitleProgress: titleProg,
        introTitleOpacity: titleOpacity,
      };
    }

    // Segment J: Cross-dissolve into next section (First Course)
    if (scrollY < sec.J_end) {
      const rawT = sec.J_length > 0 ? (scrollY - sec.J_start) / sec.J_length : 0;
      const t = Math.max(0, Math.min(1, rawT));
      const nextIdx = Math.min(idx + 1, layout.length - 1);

      return {
        sectionIndex: idx,
        section: sec,
        segment: 'J',
        videoProgress: 1.0,
        frameIndex: frameCount - 1,
        frameFloat: frameCount - 1,
        segmentProgress: t,
        entranceProgress: 0,
        categoryProgress: 0,
        menuProgress: 0,
        exitProgress: 1,
        holdMenuScroll: 0,
        buttonsActive: false,
        crossDissolve: {
          nextSectionIndex: nextIdx,
          nextSection: layout[nextIdx],
          progress: t,
        },
        introTitleProgress: 1,
        introTitleOpacity: 0,
      };
    }
  }

  // ── Segment A: Scrub + Entrance ──────────────────────────────
  if (scrollY < sec.A_end) {
    const rawT = sec.A_length > 0 ? (scrollY - sec.A_start) / sec.A_length : 0;
    const t = Math.max(0, Math.min(1, rawT));

    // C1-continuous ease-out near hold (video decelerates into freeze without speed spike)
    const easedT = easeVideoProgress(t, true, false);
    const p = easedT * holdP;

    // Normalize entrance thresholds relative to holdP so any holdFrame works seamlessly
    const scale = holdP > 0 ? (holdP / (CHOREOGRAPHY.holdAt || 0.5)) : 1;
    const catStart = CHOREOGRAPHY.categoryStart * scale;
    const catEnd = CHOREOGRAPHY.categoryRiseEnd * scale;
    const menuStart = CHOREOGRAPHY.menuStart * scale;
    const holdAt = holdP;

    const categoryProgress = p <= catStart ? 0 :
      p >= catEnd ? 1 :
      (p - catStart) / Math.max(0.001, catEnd - catStart);

    const menuProgress = p <= menuStart ? 0 :
      p >= holdAt ? 1 :
      (p - menuStart) / Math.max(0.001, holdAt - menuStart);

    const entranceProgress = Math.max(categoryProgress, menuProgress);
    const frameFloat = Math.max(0, Math.min(frameCount - 1, p * (frameCount - 1)));
    const frameIndex = Math.floor(frameFloat);

    return {
      sectionIndex: idx,
      section: sec,
      segment: 'A',
      videoProgress: p,
      frameIndex,
      frameFloat,
      segmentProgress: t,
      entranceProgress,
      categoryProgress,
      menuProgress,
      exitProgress: 0,
      holdMenuScroll: 0,
      buttonsActive: menuProgress >= 0.08,
      crossDissolve: null,
    };
  }

  // ── Segment H: Hold (video frozen, menu scrollable) ──────────
  if (scrollY < sec.H_end) {
    const t = sec.H_length > 0 ? (scrollY - sec.H_start) / sec.H_length : 0;

    return {
      sectionIndex: idx,
      section: sec,
      segment: 'H',
      videoProgress: holdP,
      frameIndex: sec.holdFrame,
      frameFloat: sec.holdFrame,
      segmentProgress: Math.max(0, Math.min(1, t)),
      entranceProgress: 1,
      categoryProgress: 1,
      menuProgress: 1,
      exitProgress: 0,
      holdMenuScroll: scrollY - sec.H_start,
      buttonsActive: true,
      crossDissolve: null,
    };
  }

  // ── Segment X: Exit (menu lifts, video resumes) ──────────────
  if (scrollY < sec.X_end) {
    const rawT = sec.X_length > 0 ? (scrollY - sec.X_start) / sec.X_length : 0;
    const t = Math.max(0, Math.min(1, rawT));

    const resumeAt = CHOREOGRAPHY.exitVideoResumeAt;
    let p;
    if (t < resumeAt) {
      p = holdP;
    } else {
      const resumeT = (t - resumeAt) / (1 - resumeAt);
      const easedResumeT = easeVideoProgress(resumeT, false, true);
      p = holdP + easedResumeT * sec.p_covered_in_X;
    }

    const exitProgress = t;
    const frameFloat = Math.max(0, Math.min(frameCount - 1, p * (frameCount - 1)));
    const frameIndex = Math.floor(frameFloat);

    return {
      sectionIndex: idx,
      section: sec,
      segment: 'X',
      videoProgress: p,
      frameIndex,
      frameFloat,
      segmentProgress: t,
      entranceProgress: 1,
      categoryProgress: 1,
      menuProgress: 1,
      exitProgress,
      holdMenuScroll: sec.H_length,
      buttonsActive: exitProgress <= 0.92,
      crossDissolve: null,
    };
  }

  // ── Segment C: Continuation (video plays to end) ─────────────
  if (scrollY < sec.C_end) {
    const rawT = sec.C_length > 0 ? (scrollY - sec.C_start) / sec.C_length : 0;
    const t = Math.max(0, Math.min(1, rawT));

    const p = sec.p_at_exit_end + t * (1.0 - sec.p_at_exit_end);
    const frameFloat = Math.min(frameCount - 1, p * (frameCount - 1));
    const frameIndex = Math.floor(frameFloat);

    return {
      sectionIndex: idx,
      section: sec,
      segment: 'C',
      videoProgress: Math.min(1, p),
      frameIndex,
      frameFloat,
      segmentProgress: t,
      entranceProgress: 0,
      categoryProgress: 0,
      menuProgress: 0,
      exitProgress: 1,
      holdMenuScroll: 0,
      buttonsActive: false,
      crossDissolve: null,
    };
  }

  // ── Segment J: Handoff (cross-dissolve to next section) ──────
  if (scrollY < sec.J_end) {
    const rawT = sec.J_length > 0 ? (scrollY - sec.J_start) / sec.J_length : 0;
    const t = Math.max(0, Math.min(1, rawT));

    const nextIdx = Math.min(idx + 1, layout.length - 1);

    return {
      sectionIndex: idx,
      section: sec,
      segment: 'J',
      videoProgress: 1.0,
      frameIndex: frameCount - 1,
      frameFloat: frameCount - 1,
      segmentProgress: t,
      entranceProgress: 0,
      categoryProgress: 0,
      menuProgress: 0,
      exitProgress: 1,
      holdMenuScroll: 0,
      buttonsActive: false,
      crossDissolve: {
        nextSectionIndex: nextIdx,
        nextSection: layout[nextIdx],
        progress: t,
      },
    };
  }

  // Past end — show last frame of last section
  return {
    sectionIndex: idx,
    section: sec,
    segment: 'C',
    videoProgress: 1.0,
    frameIndex: frameCount - 1,
    frameFloat: frameCount - 1,
    segmentProgress: 1,
    entranceProgress: 0,
    categoryProgress: 0,
    menuProgress: 0,
    exitProgress: 1,
    holdMenuScroll: 0,
    buttonsActive: false,
    crossDissolve: null,
  };
}
