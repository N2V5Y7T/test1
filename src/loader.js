/**
 * The Nines — Smart Loading Queue & Memory Window Manager (Phase 5)
 *
 * Priority rules:
 *   CRITICAL  — destination section during a nav jump (intermediate loads suppressed)
 *   HIGH      — current section
 *   PRELOAD   — next 1-2 sections ahead
 *   EVICT     — sections more than 3 indices away are unloaded from decoded RAM
 *               to prevent mobile Safari/Chrome tab crashes (HTTP cache retains WebPs)
 */

const MAX_ACTIVE_SECTION_DISTANCE = 3;

export class SmartLoader {
  /**
   * @param {import('./frame-cache.js').FrameCache} frameCache
   * @param {Array} layout — from computeScrollLayout
   */
  constructor(frameCache, layout) {
    this._cache    = frameCache;
    this._layout   = layout;
    this._queued   = new Set();
    this._lastIdx  = -1;
    this._jumping  = false;

    // Preload all 19 tiny 130B placeholder.webp images (~2.5KB total) immediately
    this._cache.preloadPlaceholders(layout);
  }

  setLayout(layout) {
    this._layout = layout;
  }

  /**
   * Called on every scroll tick with the current scroll state.
   */
  advance(state, isTweening = false) {
    // Do not trigger intermediate section downloads while flying across sections in a nav jump
    if (isTweening || this._jumping) return;

    const idx = state.sectionIndex;

    // Always ensure current section is loading at HIGH priority
    this._ensureLoaded(idx, 'high');

    // Ensure next section is preloading ahead of time
    if (idx + 1 < this._layout.length) {
      this._ensureLoaded(idx + 1, 'low');
    }

    // Preload section after next once user is past 25% of A or in H/X/C/J
    const nearEnd = state.segment === 'H' || state.segment === 'X'
      || state.segment === 'C' || state.segment === 'J'
      || (state.segment === 'A' && state.segmentProgress > 0.25);

    if (nearEnd && idx + 2 < this._layout.length) {
      this._ensureLoaded(idx + 2, 'low');
    }

    // When active section changes, evict distant sections from decoded RAM
    if (idx !== this._lastIdx) {
      this._lastIdx = idx;
      this._evictDistantSections(idx);
    }
  }

  /**
   * Nav jump: immediately promote the destination to CRITICAL priority,
   * abort distant loads, and suppress intermediate section loads until tween finishes.
   */
  jumpTo(destIdx) {
    const dest = this._layout[destIdx];
    if (!dest) return;

    this._jumping = true;

    // Abort/unload sections far from destination
    for (const key of [...this._queued]) {
      const secIdx = this._layout.findIndex(s => s.key === key);
      if (secIdx >= 0 && Math.abs(secIdx - destIdx) > 2) {
        this._cache.unloadSection(key);
        this._queued.delete(key);
      }
    }

    // Force-start destination at high priority (prioritizing holdFrame first)
    this._queued.delete(dest.key);
    this._ensureLoaded(destIdx, 'high');
    if (dest.holdFrame != null) {
      this._cache.prioritizeWindow(dest.key, dest.holdFrame, 1);
    }

    // Preload adjacent neighbors
    if (destIdx - 1 >= 0)                  this._ensureLoaded(destIdx - 1, 'low');
    if (destIdx + 1 < this._layout.length) this._ensureLoaded(destIdx + 1, 'low');
  }

  finishJump() {
    this._jumping = false;
  }

  getProgress(key) {
    return this._cache.getProgress(key);
  }

  _evictDistantSections(centerIdx) {
    for (const key of [...this._queued]) {
      const secIdx = this._layout.findIndex(s => s.key === key);
      if (secIdx >= 0 && Math.abs(secIdx - centerIdx) > MAX_ACTIVE_SECTION_DISTANCE) {
        this._cache.unloadSection(key);
        this._queued.delete(key);
      }
    }
  }

  _ensureLoaded(idx, priority) {
    if (idx < 0 || idx >= this._layout.length) return;
    const sec = this._layout[idx];
    if (this._queued.has(sec.key)) {
      if (priority === 'high') {
        const state = this._cache._sections.get(sec.key);
        if (state && state.priority !== 'high') {
          state.priority = 'high';
          this._cache.prioritizeWindow(sec.key, sec.holdFrame || 0, 1);
        }
      }
      return;
    }

    this._queued.add(sec.key);
    this._cache.loadSection(sec.key, sec.framePath, sec.frameCount, priority, sec.holdFrame);
  }
}
