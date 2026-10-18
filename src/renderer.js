/**
 * The Nines — Canvas Renderer
 *
 * Draws video frames to the main canvas, handles cross-dissolve,
 * section-accurate preview fallbacks, 140ms progressive sharpening cross-fade,
 * and velocity-aware sub-frame blending.
 */

const MAX_DPR = 2;
const PROGRESSIVE_SHARPEN_MS = 140;

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('./frame-cache.js').FrameCache} frameCache
   */
  constructor(canvas, frameCache) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.frameCache = frameCache;
    this._lastDrawnKey = null;
    this._lastDrawnFrame = -1;
    this._lastDrawnFloat = -1;
    this._lastValidImage = null;

    // Track preview transitions for 140ms progressive sharpening
    // sectionKey -> { startTime: number, previewImg: Image|Canvas, sharpImg: Image, duration: number }
    this._previewTransitions = new Map();
    this._lastResolvedPreview = new Map(); // sectionKey -> boolean

    this.resize(true);
  }

  /**
   * Invalidates last drawn state so the next render() call draws immediately.
   */
  invalidate() {
    this._lastDrawnKey = null;
    this._lastDrawnFloat = -1;
    this._lastDrawnFrame = -1;
  }

  /**
   * Set canvas dimensions based on viewport, capped at DPR 2.
   * On mobile, pre-allocates height to full physical screen height so the canvas
   * buffer is NEVER reallocated when the browser address bar collapses/expands.
   */
  resize(force = false) {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const viewportEl = this.canvas.parentElement || this.canvas;
    const rect = viewportEl.getBoundingClientRect();
    const rawW = window.innerWidth < 768
      ? window.innerWidth
      : (rect.width || window.innerWidth);
    const w = Math.max(1, Math.round(rawW));
    const screenH = typeof window !== 'undefined' && window.screen && window.screen.height
      ? window.screen.height
      : window.innerHeight;
    const h = Math.round(Math.max(rect.height || window.innerHeight, screenH));

    if (
      !force &&
      this._lastWidth === w &&
      this._lastDpr === dpr &&
      Math.abs((this._lastHeight || 0) - h) < 180
    ) {
      return;
    }

    if (this._lastWidth === w && this._lastHeight === h && this._lastDpr === dpr) {
      return;
    }

    this._lastWidth = w;
    this._lastHeight = h;
    this._lastDpr = dpr;

    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'medium';

    this._displayWidth = w;
    this._displayHeight = h;

    this.invalidate();
    if (this._lastValidImage) {
      this.ctx.globalAlpha = 1;
      this._drawImageCover(this._lastValidImage);
    }
  }

  /**
   * Resolves visual asset for section at targetIndex in priority order:
   * 1. Exact frame
   * 2. Nearest frame within 24 frames
   * 3. Section's Level 1 blurred preview
   * 4. Section anchor fallback (frame 0 or holdFrame)
   * 5. Last valid canvas image
   */
  _resolveSectionVisual(section, targetIndex) {
    if (!section) {
      return { image: this._lastValidImage, isPreview: false };
    }
    const key = section.key;

    // 1. Exact frame
    const exact = this.frameCache.getFrame(key, targetIndex);
    if (exact) return { image: exact, isPreview: false };

    // 2. Nearest frame within 24 frames
    const near = this.frameCache.nearestFrame(key, targetIndex, 24);
    if (near) return { image: near, isPreview: false };

    // 3. Section's Level 1 blurred preview
    const preview = this.frameCache.getPlaceholder(key);
    if (preview) return { image: preview, isPreview: true };

    // 4. Section anchor fallback
    const anchor = this.frameCache.nearestFrame(key, targetIndex, Infinity);
    if (anchor) return { image: anchor, isPreview: false };

    // 5. Fallback
    return { image: this._lastValidImage, isPreview: false };
  }

  /**
   * Render the current scroll state to the canvas.
   *
   * @param {object} state - from getScrollState()
   * @param {boolean} force - whether to force redraw
   */
  render(state, force = false) {
    if (window.innerWidth < 768 && Math.abs(Math.round(window.innerWidth) - this._displayWidth) > 1) {
      this.resize(true);
    }

    const { section, crossDissolve } = state;
    const key = section.key;
    const frameFloat = state.frameFloat !== undefined ? state.frameFloat : state.frameIndex;
    const frameIndex = Math.floor(frameFloat);

    // Prioritize upcoming frames in direction of motion
    const direction = this._lastFrameIndex !== undefined ? (frameIndex >= this._lastFrameIndex ? 1 : -1) : 1;
    this._lastFrameIndex = frameIndex;
    this.frameCache.prioritizeWindow(key, frameIndex, direction);

    if (crossDissolve) {
      this.frameCache.prioritizeWindow(crossDissolve.nextSection.key, 0, 1);
      this._renderCrossDissolve(
        key, frameFloat,
        crossDissolve.nextSection.key, 0,
        crossDissolve.progress,
        section,
        crossDissolve.nextSection
      );
    } else {
      this._renderFrame(key, frameFloat, section, force);
    }
  }

  /**
   * Draw a frame from a section with velocity-aware sub-frame continuous blending
   * and 140ms progressive sharpening cross-fade from blurred preview to sharp frame.
   */
  _renderFrame(sectionKey, frameFloat, section, force = false) {
    const count = section.frameCount;
    const clampedFloat = Math.max(0, Math.min(count - 1, frameFloat));
    const floorIndex = Math.floor(clampedFloat);
    const ceilIndex = Math.min(count - 1, floorIndex + 1);
    const blendAlpha = clampedFloat - floorIndex;

    const frameDelta = this._lastDrawnKey === sectionKey && this._lastDrawnFloat >= 0
      ? Math.abs(clampedFloat - this._lastDrawnFloat)
      : 0;

    const primaryIndex = (frameDelta <= 0.04 && blendAlpha >= 0.5) ? ceilIndex : floorIndex;
    const visual = this._resolveSectionVisual(section, primaryIndex);

    // Detect transition from preview to sharp frame for 140ms progressive sharpening
    const wasPreview = this._lastResolvedPreview.get(sectionKey) === true;
    if (wasPreview && !visual.isPreview && visual.image) {
      const prevPlaceholder = this.frameCache.getPlaceholder(sectionKey) || this._lastValidImage;
      if (prevPlaceholder && prevPlaceholder !== visual.image) {
        this._previewTransitions.set(sectionKey, {
          startTime: performance.now(),
          previewImg: prevPlaceholder,
          sharpImg: visual.image,
          duration: PROGRESSIVE_SHARPEN_MS,
        });
      }
    }
    this._lastResolvedPreview.set(sectionKey, visual.isPreview);

    const activeTransition = this._previewTransitions.get(sectionKey);
    const now = performance.now();
    const hasActiveTransition = activeTransition && !visual.isPreview && (now - activeTransition.startTime < activeTransition.duration);

    if (!force && !hasActiveTransition && this._lastDrawnKey === sectionKey && Math.abs(this._lastDrawnFloat - clampedFloat) < 0.004) {
      return;
    }

    if (!visual.image) {
      this._drawPlaceholder(section);
      return;
    }

    // Draw active transition or direct image
    if (hasActiveTransition) {
      const elapsed = now - activeTransition.startTime;
      const progress = Math.min(1, elapsed / activeTransition.duration);

      // Base blurred preview
      this.ctx.globalAlpha = 1;
      this._drawImageCover(activeTransition.previewImg);

      // Incoming sharp frame
      this.ctx.globalAlpha = progress;
      this._drawImageCover(visual.image);
      this.ctx.globalAlpha = 1;
      this._lastValidImage = visual.image;
    } else {
      if (activeTransition) {
        this._previewTransitions.delete(sectionKey);
      }
      this.ctx.globalAlpha = 1;
      this._drawImageCover(visual.image);
      this._lastValidImage = visual.image;
    }

    // Optical blend: only blend adjacent frames during active moderate scrubbing
    if (
      !visual.isPreview &&
      frameDelta > 0.04 &&
      frameDelta < 0.65 &&
      blendAlpha > 0.04 &&
      blendAlpha < 0.96 &&
      ceilIndex !== floorIndex
    ) {
      const imgCeil = this.frameCache.getFrame(sectionKey, ceilIndex);
      if (imgCeil) {
        this.ctx.globalAlpha = blendAlpha;
        this._drawImageCover(imgCeil);
        this.ctx.globalAlpha = 1;
      }
    }

    this._lastDrawnKey = sectionKey;
    this._lastDrawnFloat = clampedFloat;
    this._lastDrawnFrame = primaryIndex;
  }

  /**
   * Draw the section's pre-rendered 90x160 blurred preview or fallback background.
   */
  _drawPlaceholder(section) {
    if (section) {
      const ph = this.frameCache.getPlaceholder(section.key);
      if (ph) {
        this.ctx.globalAlpha = 1;
        this._drawImageCover(ph);
        this._lastValidImage = ph;
        return;
      }
    }

    if (this._lastValidImage) {
      this.ctx.globalAlpha = 1;
      this._drawImageCover(this._lastValidImage);
      return;
    }

    this.ctx.fillStyle = '#0a0a0a';
    this.ctx.fillRect(0, 0, this._displayWidth, this._displayHeight);
  }

  /**
   * Cross-dissolve between two frames from different sections.
   */
  _renderCrossDissolve(keyA, frameFloatA, keyB, frameFloatB, progress, secA, secB) {
    const floorA = Math.floor(Math.max(0, frameFloatA));
    const floorB = Math.floor(Math.max(0, frameFloatB));

    const visualA = this._resolveSectionVisual(secA, floorA);
    const visualB = this._resolveSectionVisual(secB, floorB);

    if (visualA.image) {
      this.ctx.globalAlpha = 1;
      this._drawImageCover(visualA.image);
      this._lastValidImage = visualA.image;
    } else {
      this.ctx.fillStyle = '#0a0a0a';
      this.ctx.fillRect(0, 0, this._displayWidth, this._displayHeight);
    }

    if (visualB.image && progress > 0) {
      const alpha = Math.max(0, Math.min(1, progress));
      this.ctx.globalAlpha = alpha;
      this._drawImageCover(visualB.image);
      this.ctx.globalAlpha = 1;
      if (progress >= 0.5) {
        this._lastValidImage = visualB.image;
      }
    }

    this.invalidate();
  }

  /**
   * Draw an image covering the canvas (object-fit: cover).
   */
  _drawImageCover(img) {
    const cw = this._displayWidth;
    const ch = this._displayHeight;
    const iw = img.naturalWidth || img.videoWidth || img.width;
    const ih = img.naturalHeight || img.videoHeight || img.height;
    if (!iw || !ih) return;

    const canvasRatio = cw / ch;
    const imageRatio = iw / ih;

    let sx, sy, sw, sh;
    if (imageRatio > canvasRatio) {
      sh = ih;
      sw = ih * canvasRatio;
      sx = (iw - sw) / 2;
      sy = 0;
    } else {
      sw = iw;
      sh = iw / canvasRatio;
      sx = 0;
      sy = (ih - sh) / 2;
    }

    this.ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
  }
}
