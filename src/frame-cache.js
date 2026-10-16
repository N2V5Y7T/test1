/**
 * The Nines — Frame Cache & Memory Manager
 *
 * Manages loading, caching, and memory eviction of section frame images.
 * Uses a hybrid Keyframe + Coarse-to-Fine + Sequential load order so both
 * initial scrubbing and nav-jumps into Hold (holdFrame) are instant and smooth.
 */

const MAX_CONCURRENT_LOADS = 6;

/**
 * Builds an intelligent loading order:
 * 1. Anchor frames first: frame 0, holdFrame (for instant nav jump), and last frame
 * 2. Coarse pass (every 6th frame) so fast mobile scrolling never hits a wall of unloaded frames
 * 3. Sequential pass to fill all adjacent frames for sub-frame blending
 */
function buildSmartOrder(count, holdFrame = null) {
  const seen = new Set();
  const order = [];
  const push = (idx) => {
    if (idx >= 0 && idx < count && !seen.has(idx)) {
      seen.add(idx);
      order.push(idx);
    }
  };

  // 1. Key anchor frames
  push(0);
  if (holdFrame != null) {
    push(holdFrame);
    push(holdFrame - 1);
    push(holdFrame + 1);
  }
  push(count - 1);

  // 2. First 12 frames sequentially for immediate entrance smoothness
  for (let i = 0; i < Math.min(12, count); i++) {
    push(i);
  }

  // 3. Coarse-to-fine pass across the entire section (every 6th frame)
  for (let i = 0; i < count; i += 6) {
    push(i);
  }

  // 4. Fill all remaining frames sequentially
  for (let i = 0; i < count; i++) {
    push(i);
  }

  return order;
}

function pad(n) {
  return String(n + 1).padStart(4, '0');  // frames are 1-indexed on disk
}

export class FrameCache {
  constructor() {
    // sectionKey → { images: Map<frameIdx, Image>, loading: boolean, abortController, loadedCount }
    this._sections = new Map();
    // sectionKey → Image (tiny 130-byte pre-blurred placeholder.webp)
    this._placeholders = new Map();
    this._frameDecodedListeners = [];
  }

  onFrameDecoded(callback) {
    this._frameDecodedListeners.push(callback);
  }

  _notifyFrameDecoded(key, frameIdx) {
    for (let i = 0; i < this._frameDecodedListeners.length; i++) {
      this._frameDecodedListeners[i](key, frameIdx);
    }
  }

  /**
   * Preload tiny 130-byte placeholder.webp files for all sections (~2.5KB total)
   * so there is NEVER a black canvas frame during fast scroll or nav jumps.
   */
  preloadPlaceholders(layout) {
    for (const sec of layout) {
      if (this._placeholders.has(sec.key)) continue;
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        this._placeholders.set(sec.key, img);
      };
      img.src = `${sec.framePath}placeholder.webp`;
    }
  }

  getPlaceholder(key) {
    return this._placeholders.get(key) || null;
  }

  /**
   * Start loading frames for a section.
   *
   * @param {string} key - section key
   * @param {string} framePath - e.g. './frames/first-course/'
   * @param {number} frameCount - total frames
   * @param {string} priority - 'high' | 'low'
   * @param {number|null} holdFrame - section hold frame index
   * @returns {object} section state
   */
  loadSection(key, framePath, frameCount, priority = 'high', holdFrame = null) {
    if (this._sections.has(key)) {
      return this._sections.get(key);
    }

    const ac = new AbortController();
    const images = new Map();
    const inFlight = new Set();
    const order = buildSmartOrder(frameCount, holdFrame);

    const state = {
      key,
      framePath,
      frameCount,
      holdFrame,
      images,
      inFlight,
      queue: order,
      loading: true,
      loadedCount: 0,
      activeWorkers: 0,
      priority,
      abortController: ac,
    };
    this._sections.set(key, state);

    this._pump(state);
    return state;
  }

  _pump(state) {
    if (state.abortController.signal.aborted) return;

    const maxWorkers = state.priority === 'high' ? MAX_CONCURRENT_LOADS : 3;

    while (state.activeWorkers < maxWorkers && state.queue.length > 0) {
      const frameIdx = state.queue.shift();

      if (state.images.has(frameIdx) || state.inFlight.has(frameIdx)) {
        continue;
      }

      state.inFlight.add(frameIdx);
      state.activeWorkers++;

      const img = new Image();
      img.decoding = 'async';
      if (state.priority === 'high') img.fetchPriority = 'high';

      const onSlotFree = () => {
        state.inFlight.delete(frameIdx);
        state.activeWorkers--;
        if (state.queue.length === 0 && state.activeWorkers === 0) {
          state.loading = false;
        } else {
          this._pump(state);
        }
      };

      img.onload = () => {
        if (state.abortController.signal.aborted) {
          onSlotFree();
          return;
        }

        if (typeof img.decode === 'function') {
          img.decode().catch(() => {}).finally(() => {
            if (!state.abortController.signal.aborted) {
              state.images.set(frameIdx, img);
              state.loadedCount++;
              this._notifyFrameDecoded(state.key, frameIdx);
            }
            onSlotFree();
          });
        } else {
          state.images.set(frameIdx, img);
          state.loadedCount++;
          this._notifyFrameDecoded(state.key, frameIdx);
          onSlotFree();
        }
      };

      img.onerror = () => {
        onSlotFree();
      };

      img.src = `${state.framePath}frame${pad(frameIdx)}.webp`;
    }

    if (state.queue.length === 0 && state.activeWorkers === 0) {
      state.loading = false;
    }
  }

  /**
   * Prioritize a window of upcoming frames in the direction of scroll.
   */
  prioritizeWindow(key, currentFrameIndex, direction = 1) {
    const state = this._sections.get(key);
    if (!state || !state.queue || state.queue.length === 0 || state.abortController.signal.aborted) return;

    const count = state.frameCount;
    const center = Math.max(0, Math.min(count - 1, Math.round(currentFrameIndex || 0)));

    if (state._lastPrioritizedCenter !== undefined && Math.abs(state._lastPrioritizedCenter - center) < 2) {
      return;
    }
    state._lastPrioritizedCenter = center;

    const priorityFrames = [];
    const spanAhead = 18;
    const spanBehind = 6;

    if (direction >= 0) {
      for (let i = 0; i <= spanAhead; i++) {
        const idx = center + i;
        if (idx < count && !state.images.has(idx) && !state.inFlight.has(idx)) {
          priorityFrames.push(idx);
        }
      }
      for (let i = 1; i <= spanBehind; i++) {
        const idx = center - i;
        if (idx >= 0 && !state.images.has(idx) && !state.inFlight.has(idx)) {
          priorityFrames.push(idx);
        }
      }
    } else {
      for (let i = 0; i <= spanAhead; i++) {
        const idx = center - i;
        if (idx >= 0 && !state.images.has(idx) && !state.inFlight.has(idx)) {
          priorityFrames.push(idx);
        }
      }
      for (let i = 1; i <= spanBehind; i++) {
        const idx = center + i;
        if (idx < count && !state.images.has(idx) && !state.inFlight.has(idx)) {
          priorityFrames.push(idx);
        }
      }
    }

    if (priorityFrames.length > 0) {
      const pSet = new Set(priorityFrames);
      state.queue = priorityFrames.concat(state.queue.filter(idx => !pSet.has(idx)));
      state.priority = 'high';
      this._pump(state);
    }
  }

  abortSection(key) {
    const state = this._sections.get(key);
    if (state) {
      state.abortController.abort();
      state.loading = false;
      state.inFlight.clear();
      state.queue = [];
    }
  }

  hasSection(key) {
    return this._sections.has(key);
  }

  getProgress(key) {
    const state = this._sections.get(key);
    if (!state) return 0;
    return state.loadedCount / state.frameCount;
  }

  getFrame(key, frameIndex) {
    const state = this._sections.get(key);
    if (!state) return null;
    return state.images.get(frameIndex) || null;
  }

  nearestFrame(key, frameIndex) {
    const state = this._sections.get(key);
    if (!state || state.loadedCount === 0) return null;

    const count = state.frameCount;
    const target = Math.max(0, Math.min(count - 1, Math.round(Number(frameIndex) || 0)));

    if (state.images.has(target)) return state.images.get(target);

    for (let d = 1; d < count; d++) {
      const left = target - d;
      const right = target + d;
      if (left >= 0 && state.images.has(left)) return state.images.get(left);
      if (right < count && state.images.has(right)) return state.images.get(right);
    }

    for (const img of state.images.values()) {
      if (img) return img;
    }

    return null;
  }

  /**
   * Unload a section's decoded Image objects so mobile memory stays bounded.
   * Compressed WebP files remain in the browser HTTP cache for fast reload.
   */
  unloadSection(key) {
    const state = this._sections.get(key);
    if (!state) return;
    this.abortSection(key);
    state.images.clear();
    this._sections.delete(key);
  }
}
