/**
 * The Nines — Centered ~48% Preload Window & Scroll-First Parallel Navigation
 *
 * Implements a centered ~48% preload window (9 of 19 sections) ordered in
 * concentric rings outward from the user's active section.
 *
 * During navigation jumps:
 * - Does NOT unload active or intermediate sections.
 * - Deprioritizes distant sections to 'low'.
 * - Immediately warms destination at 'high' priority.
 * - Suppresses full-resolution intermediate bulk downloads during the tween.
 */

const PRELOAD_WINDOW_RATIO = 0.48;
const EVICT_HYSTERESIS = 1;

export class SmartLoader {
  /**
   * @param {import('./frame-cache.js').FrameCache} frameCache
   * @param {Array} layout — from computeScrollLayout
   */
  constructor(frameCache, layout) {
    this._cache = frameCache;
    this._layout = layout;
    this._queued = new Map(); // key -> priority ('high' | 'medium' | 'low')
    this._lastIdx = -1;
    this._lastEvictIdx = -1;
    this._jumping = false;
    this._scrollDir = 1;
    this._scrollVelocity = 0;
    this._lastScrollY = 0;
    this._lastScrollTime = typeof performance !== 'undefined' ? performance.now() : 0;

    // Level 1: Preload tiny blurred placeholders immediately on startup
    this._cache.preloadPlaceholders(layout);
    // Pre-warm anchor frames across all sections in the background
    this._cache.preloadAnchorFrames(layout);
  }

  setLayout(layout) {
    this._layout = layout;
  }

  getCenteredWindowBounds(centerIdx, extraLookahead = 0) {
    const total = this._layout.length;
    if (total === 0) return [0, 0];
    const baseWindowSize = Math.max(5, Math.round(total * PRELOAD_WINDOW_RATIO));
    const halfRadius = Math.floor(baseWindowSize / 2);

    let start = centerIdx - halfRadius;
    let end = centerIdx + halfRadius;

    if (extraLookahead > 0) end += extraLookahead;
    else if (extraLookahead < 0) start += extraLookahead;

    // Slide window away from edges while keeping baseWindowSize
    if (start < 0) {
      end = Math.min(total - 1, end + (-start));
      start = 0;
    }
    if (end >= total) {
      start = Math.max(0, start - (end - (total - 1)));
      end = total - 1;
    }

    return [Math.max(0, start), Math.min(total - 1, end)];
  }

  _updateCenteredWindow(centerIdx, extraLookahead = 0) {
    if (centerIdx < 0 || centerIdx >= this._layout.length) return;
    const [winStart, winEnd] = this.getCenteredWindowBounds(centerIdx, extraLookahead);

    // 1. Center section at high priority
    this._ensureLoaded(centerIdx, 'high');

    // 2. Loop outward in concentric rings, prioritized by scroll direction
    const maxRadius = Math.max(centerIdx - winStart, winEnd - centerIdx);
    for (let d = 1; d <= maxRadius; d++) {
      const prio = d === 1 ? 'high' : (d === 2 ? 'medium' : 'low');
      const ahead = this._scrollDir >= 0 ? centerIdx + d : centerIdx - d;
      const behind = this._scrollDir >= 0 ? centerIdx - d : centerIdx + d;

      if (ahead >= winStart && ahead <= winEnd) {
        this._ensureLoaded(ahead, prio);
      }
      if (behind >= winStart && behind <= winEnd) {
        this._ensureLoaded(behind, prio);
      }
    }
  }

  _evictOutsideWindow(centerIdx) {
    if (centerIdx < 0 || centerIdx >= this._layout.length) return;
    const [winStart, winEnd] = this.getCenteredWindowBounds(centerIdx);
    const safeStart = winStart - EVICT_HYSTERESIS;
    const safeEnd = winEnd + EVICT_HYSTERESIS;

    for (const [key] of this._queued) {
      const secIdx = this._layout.findIndex(s => s.key === key);
      if (secIdx >= 0 && (secIdx < safeStart || secIdx > safeEnd)) {
        this._cache.unloadSection(key);
        this._queued.delete(key);
      }
    }
  }

  advance(state, isTweening = false, scrollY = 0) {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const dt = Math.max(1, now - this._lastScrollTime);
    if (scrollY !== this._lastScrollY) {
      this._scrollDir = scrollY >= this._lastScrollY ? 1 : -1;
      this._scrollVelocity = Math.abs(scrollY - this._lastScrollY) / dt;
      this._lastScrollY = scrollY;
      this._lastScrollTime = now;
    }

    // When tweening, let intermediate sections render from previews/anchors without spawning full-res bulk loads
    if (isTweening || this._jumping) {
      return;
    }

    const idx = state.sectionIndex;
    this._updateCenteredWindow(idx);

    if (idx !== this._lastEvictIdx) {
      this._lastEvictIdx = idx;
      this._evictOutsideWindow(idx);
    }
  }

  jumpTo(destIdx, currentIdx = -1) {
    if (destIdx < 0 || destIdx >= this._layout.length) return;
    const dest = this._layout[destIdx];
    if (!dest) return;

    this._jumping = true;
    const cur = currentIdx >= 0 ? currentIdx : (this._lastIdx >= 0 ? this._lastIdx : 0);
    this._scrollDir = destIdx >= cur ? 1 : -1;

    // Non-destructive: do NOT unload active or intermediate sections!
    // Deprioritize sections outside destination window to 'low'
    const [destStart, destEnd] = this.getCenteredWindowBounds(destIdx);
    for (const [key] of this._queued) {
      const secIdx = this._layout.findIndex(s => s.key === key);
      if (secIdx >= 0 && (secIdx < destStart || secIdx > destEnd)) {
        const secState = this._cache._sections.get(key);
        if (secState) secState.priority = 'low';
        this._queued.set(key, 'low');
      }
    }

    // Immediately queue destination at 'high' priority, prioritizing holdFrame and frame 0
    this._ensureLoaded(destIdx, 'high');
    if (dest.holdFrame != null) {
      this._cache.prioritizeWindow(dest.key, dest.holdFrame, this._scrollDir);
    } else {
      this._cache.prioritizeWindow(dest.key, 0, this._scrollDir);
    }

    // Queue centered ~48% window around destIdx
    this._updateCenteredWindow(destIdx);
  }

  finishJump(settledIdx = null) {
    this._jumping = false;
    const center = settledIdx != null ? settledIdx : (this._lastIdx >= 0 ? this._lastIdx : 0);
    this._lastIdx = center;
    this._lastEvictIdx = center;
    this._updateCenteredWindow(center);
    this._evictOutsideWindow(center);
  }

  getProgress(key) {
    return this._cache.getProgress(key);
  }

  _ensureLoaded(idx, priority) {
    if (idx < 0 || idx >= this._layout.length) return;
    const sec = this._layout[idx];
    const existingPrio = this._queued.get(sec.key);

    if (existingPrio) {
      if (
        (priority === 'high' && existingPrio !== 'high') ||
        (priority === 'medium' && existingPrio === 'low')
      ) {
        const state = this._cache._sections.get(sec.key);
        if (state) {
          state.priority = priority;
          if (priority === 'high') {
            this._cache.prioritizeWindow(sec.key, sec.holdFrame || 0, this._scrollDir);
          }
        }
        this._queued.set(sec.key, priority);
      }
      return;
    }

    this._queued.set(sec.key, priority);
    this._cache.loadSection(sec.key, sec.framePath, sec.frameCount, priority, sec.holdFrame);
  }
}
