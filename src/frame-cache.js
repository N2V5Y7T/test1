/**
 * The Nines — Frame Cache & 3-Tier Session Asset Manager
 *
 * Tier 1: Session Downloaded Asset Cache (_sessionBlobs Map, capped at 90 MB)
 *         Retains compressed WebP blobs as Object URLs for the entire session.
 * Tier 2: Bounded Decoded Asset Cache (_sections Map)
 *         Stores decoded Image bitmaps for the active preload window.
 * Tier 3: Active Render Window (prioritizeWindow)
 *         Interleaves frames in scroll direction with strict concurrency limits.
 *
 * Level 1 Previews:
 *         Pre-rendered 90x160 blurred canvas previews for all 19 sections.
 * Anchor Frames:
 *         Pre-warmed frame 0 and holdFrame across all sections.
 */

const MAX_ANCHOR_WORKERS = 3;
const MAX_CONCURRENT_HIGH = 10;
const MAX_CONCURRENT_MEDIUM = 6;
const MAX_CONCURRENT_LOW = 3;
const MAX_GLOBAL_WORKERS = 14;
const SESSION_CACHE_MAX_BYTES = 90 * 1024 * 1024; // 90 MB

function pad(n) {
  return String(n + 1).padStart(4, '0'); // frames are 1-indexed on disk
}

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

  // 2. First 12 frames sequentially
  for (let i = 0; i < Math.min(12, count); i++) {
    push(i);
  }

  // 3. Coarse-to-fine pass (every 6th frame)
  for (let i = 0; i < count; i += 6) {
    push(i);
  }

  // 4. Fill all remaining frames
  for (let i = 0; i < count; i++) {
    push(i);
  }

  return order;
}

function createSmoothBlurredPreview(img) {
  if (typeof document === 'undefined') return img;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 90;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');
    if (!ctx) return img;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if ('filter' in ctx) {
      ctx.filter = 'blur(6px)';
    }
    // Draw with slight overshoot to eliminate transparent border from blur filter
    ctx.drawImage(img, -8, -8, 106, 176);
    return canvas;
  } catch (_) {
    return img;
  }
}

export class FrameCache {
  constructor(onFrameLoaded = null) {
    this.onFrameLoaded = onFrameLoaded;

    // sectionKey -> { key, framePath, frameCount, holdFrame, images: Map<frameIdx, Image>, inFlight: Set<frameIdx>, queue: number[], loading: boolean, loadedCount: number, activeWorkers: number, priority: string, abortController: AbortController }
    this._sections = new Map();

    // sectionKey -> 90x160 blurred offscreen canvas preview
    this._placeholders = new Map();

    // sectionKey -> Map<frameIdx, Image> (pre-warmed anchor frames)
    this._anchors = new Map();

    // Tier 1: url -> { blobUrl, size, key, frameIdx, lastUsed }
    this._sessionBlobs = new Map();
    this._sessionBlobsSize = 0;
    this._inFlightDownloads = new Map(); // url -> Promise<string>
    this.sessionCacheHits = 0;

    this._globalActiveWorkers = 0;
    this._frameDecodedListeners = [];
    this._anchorLoadingStarted = false;
  }

  onFrameDecoded(callback) {
    this._frameDecodedListeners.push(callback);
  }

  _notifyFrameDecoded(key, frameIdx) {
    if (this.onFrameLoaded) {
      try { this.onFrameLoaded(key, frameIdx); } catch (_) {}
    }
    for (let i = 0; i < this._frameDecodedListeners.length; i++) {
      try { this._frameDecodedListeners[i](key, frameIdx); } catch (_) {}
    }
  }

  preloadPlaceholders(layout) {
    if (!layout) return;
    for (const sec of layout) {
      if (this._placeholders.has(sec.key)) continue;
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        const preview = createSmoothBlurredPreview(img);
        this._placeholders.set(sec.key, preview);
        this._notifyFrameDecoded(sec.key, -1);
      };
      img.src = `${sec.framePath}placeholder.webp`;
    }
  }

  getPlaceholder(key) {
    return this._placeholders.get(key) || null;
  }

  preloadAnchorFrames(layout) {
    if (!layout || this._anchorLoadingStarted) return;
    this._anchorLoadingStarted = true;

    const anchorTasks = [];
    for (const sec of layout) {
      if (!this._anchors.has(sec.key)) {
        this._anchors.set(sec.key, new Map());
      }
      const hold = sec.holdFrame != null ? sec.holdFrame : Math.floor(sec.frameCount / 2);
      anchorTasks.push({ sec, frameIdx: 0 });
      anchorTasks.push({ sec, frameIdx: hold });
    }

    let activeAnchorWorkers = 0;
    const pumpAnchors = () => {
      while (activeAnchorWorkers < MAX_ANCHOR_WORKERS && anchorTasks.length > 0) {
        const task = anchorTasks.shift();
        const anchorMap = this._anchors.get(task.sec.key);
        if (anchorMap && anchorMap.has(task.frameIdx)) continue;

        activeAnchorWorkers++;
        const url = `${task.sec.framePath}frame${pad(task.frameIdx)}.webp`;
        this._acquireFrameImage(url, task.sec.key, task.frameIdx, 'low')
          .then(img => {
            if (img && anchorMap) {
              anchorMap.set(task.frameIdx, img);
              this._notifyFrameDecoded(task.sec.key, task.frameIdx);
            }
          })
          .catch(() => {})
          .finally(() => {
            activeAnchorWorkers--;
            pumpAnchors();
          });
      }
    };
    pumpAnchors();
  }

  getAnchor(key, frameIdx) {
    const anchorMap = this._anchors.get(key);
    if (!anchorMap || anchorMap.size === 0) return null;
    if (anchorMap.has(frameIdx)) return anchorMap.get(frameIdx);
    let closest = null;
    let minD = Infinity;
    for (const [idx, img] of anchorMap) {
      const d = Math.abs(idx - frameIdx);
      if (d < minD) {
        minD = d;
        closest = img;
      }
    }
    return closest;
  }

  _enforceSessionBlobCap() {
    if (this._sessionBlobsSize <= SESSION_CACHE_MAX_BYTES) return;
    const entries = Array.from(this._sessionBlobs.entries()).sort(
      (a, b) => a[1].lastUsed - b[1].lastUsed
    );
    for (const [url, item] of entries) {
      if (this._sessionBlobsSize <= SESSION_CACHE_MAX_BYTES) break;
      if (item.frameIdx === 0) continue; // Retain initial anchor frame
      try { URL.revokeObjectURL(item.blobUrl); } catch (_) {}
      this._sessionBlobsSize -= item.size;
      this._sessionBlobs.delete(url);
    }
  }

  async _acquireFrameImage(url, sectionKey, frameIdx, priority = 'high', signal = null) {
    // 1. Session Blob Cache hit
    if (this._sessionBlobs.has(url)) {
      this.sessionCacheHits++;
      const cached = this._sessionBlobs.get(url);
      cached.lastUsed = performance.now();
      return this._decodeImageFromUrl(cached.blobUrl);
    }

    // 2. In-flight download deduplication
    let downloadPromise = this._inFlightDownloads.get(url);
    if (!downloadPromise) {
      downloadPromise = (async () => {
        try {
          const fetchOpts = { cache: 'force-cache' };
          if (signal) fetchOpts.signal = signal;
          const res = await fetch(url, fetchOpts);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const blobUrl = URL.createObjectURL(blob);
          this._sessionBlobs.set(url, {
            blobUrl,
            size: blob.size,
            key: sectionKey,
            frameIdx,
            lastUsed: performance.now()
          });
          this._sessionBlobsSize += blob.size;
          this._enforceSessionBlobCap();
          return blobUrl;
        } finally {
          this._inFlightDownloads.delete(url);
        }
      })();
      this._inFlightDownloads.set(url, downloadPromise);
    }

    const blobUrl = await downloadPromise;
    return this._decodeImageFromUrl(blobUrl);
  }

  _decodeImageFromUrl(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        if (typeof img.decode === 'function') {
          img.decode().then(() => resolve(img)).catch(() => resolve(img));
        } else {
          resolve(img);
        }
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  loadSection(key, framePath, frameCount, priority = 'high', holdFrame = null) {
    if (this._sections.has(key)) {
      const state = this._sections.get(key);
      if (priority === 'high' && state.priority !== 'high') {
        state.priority = 'high';
        this._pump(state);
      }
      return state;
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

    const maxWorkersForPriority = state.priority === 'high'
      ? MAX_CONCURRENT_HIGH
      : (state.priority === 'medium' ? MAX_CONCURRENT_MEDIUM : MAX_CONCURRENT_LOW);

    while (
      state.activeWorkers < maxWorkersForPriority &&
      this._globalActiveWorkers < MAX_GLOBAL_WORKERS &&
      state.queue.length > 0
    ) {
      const frameIdx = state.queue.shift();

      if (state.images.has(frameIdx) || state.inFlight.has(frameIdx)) {
        continue;
      }

      state.inFlight.add(frameIdx);
      state.activeWorkers++;
      this._globalActiveWorkers++;

      const url = `${state.framePath}frame${pad(frameIdx)}.webp`;
      const signal = state.abortController.signal;

      const onSlotFree = () => {
        state.inFlight.delete(frameIdx);
        state.activeWorkers--;
        this._globalActiveWorkers--;
        if (state.queue.length === 0 && state.activeWorkers === 0) {
          state.loading = false;
        } else {
          this._pump(state);
        }
      };

      this._acquireFrameImage(url, state.key, frameIdx, state.priority, signal)
        .then(img => {
          if (!signal.aborted && img) {
            state.images.set(frameIdx, img);
            state.loadedCount++;
            this._notifyFrameDecoded(state.key, frameIdx);
          }
        })
        .catch(() => {})
        .finally(() => {
          onSlotFree();
        });
    }

    if (state.queue.length === 0 && state.activeWorkers === 0) {
      state.loading = false;
    }
  }

  prioritizeWindow(key, currentFrameIndex, direction = 1) {
    const state = this._sections.get(key);
    if (!state || !state.queue || state.abortController.signal.aborted) return;

    const count = state.frameCount;
    const center = Math.max(0, Math.min(count - 1, Math.round(currentFrameIndex || 0)));

    if (state._lastPrioritizedCenter !== undefined && Math.abs(state._lastPrioritizedCenter - center) < 2) {
      return;
    }
    state._lastPrioritizedCenter = center;

    const priorityFrames = [];
    const spanAhead = 24;
    const spanBehind = 14;

    const maxSpan = Math.max(spanAhead, spanBehind);
    for (let i = 0; i <= maxSpan; i++) {
      if (i <= spanAhead) {
        const aheadIdx = direction >= 0 ? center + i : center - i;
        if (aheadIdx >= 0 && aheadIdx < count && !state.images.has(aheadIdx) && !state.inFlight.has(aheadIdx)) {
          priorityFrames.push(aheadIdx);
        }
      }
      if (i > 0 && i <= spanBehind) {
        const behindIdx = direction >= 0 ? center - i : center + i;
        if (behindIdx >= 0 && behindIdx < count && !state.images.has(behindIdx) && !state.inFlight.has(behindIdx)) {
          priorityFrames.push(behindIdx);
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
      this._globalActiveWorkers = Math.max(0, this._globalActiveWorkers - state.activeWorkers);
      state.activeWorkers = 0;
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

  nearestFrame(key, frameIndex, maxDistance = Infinity) {
    const state = this._sections.get(key);
    const count = state ? state.frameCount : 96;
    const target = Math.max(0, Math.min(count - 1, Math.round(Number(frameIndex) || 0)));

    if (state && state.images.has(target)) {
      return state.images.get(target);
    }

    if (state && state.loadedCount > 0) {
      const limit = Math.min(count, maxDistance);
      for (let d = 1; d <= limit; d++) {
        const left = target - d;
        const right = target + d;
        if (left >= 0 && state.images.has(left)) return state.images.get(left);
        if (right < count && state.images.has(right)) return state.images.get(right);
      }
      if (maxDistance === Infinity) {
        for (const img of state.images.values()) {
          if (img) return img;
        }
      }
    }

    const anchor = this.getAnchor(key, target);
    if (anchor) return anchor;

    return null;
  }

  unloadSection(key) {
    const state = this._sections.get(key);
    if (!state) return;
    this.abortSection(key);
    state.images.clear();
    this._sections.delete(key);
  }
}
