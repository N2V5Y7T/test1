/**
 * The Nines — Canvas Renderer
 *
 * Draws video frames to the main canvas, handles cross-dissolve,
 * uses velocity-aware sub-frame blending (skipping double-draw during fast mobile flicks),
 * and draws pre-blurred 130B placeholder.webp without slow ctx.filter calls.
 */

const MAX_DPR = 2;

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

    this.resize(true);
    // Note: window resize is managed centrally by main.js so mobile URL-bar height
    // shifts never clear or reallocate the canvas backing store mid-scroll.
  }

  /**
   * Set canvas dimensions based on viewport, capped at DPR 2.
   * Ignores small vertical-only mobile toolbar shifts unless force=true.
   */
  resize(force = false) {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const rect = this.canvas.getBoundingClientRect();

    const w = Math.round(rect.width || window.innerWidth);
    const h = Math.round(rect.height || window.innerHeight);

    // Ignore mobile browser toolbar show/hide height-only changes (<160px)
    if (
      !force &&
      this._lastWidth === w &&
      this._lastDpr === dpr &&
      Math.abs((this._lastHeight || 0) - h) < 160
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
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'medium';

    this._displayWidth = w;
    this._displayHeight = h;

    this._lastDrawnKey = null;
    this._lastDrawnFrame = -1;
    this._lastDrawnFloat = -1;
    if (this._lastValidImage) {
      this.ctx.globalAlpha = 1;
      this._drawImageCover(this._lastValidImage);
    }
  }

  /**
   * Render the current scroll state to the canvas.
   *
   * @param {object} state - from getScrollState()
   */
  render(state) {
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
      this._renderFrame(key, frameFloat, section);
    }
  }

  /**
   * Draw a frame from a section with velocity-aware sub-frame continuous blending.
   */
  _renderFrame(sectionKey, frameFloat, section) {
    const count = section.frameCount;
    const clampedFloat = Math.max(0, Math.min(count - 1, frameFloat));
    const floorIndex = Math.floor(clampedFloat);
    const ceilIndex = Math.min(count - 1, floorIndex + 1);
    const blendAlpha = clampedFloat - floorIndex;

    if (this._lastDrawnKey === sectionKey && Math.abs(this._lastDrawnFloat - clampedFloat) < 0.004) {
      return;
    }

    const frameDelta = this._lastDrawnKey === sectionKey && this._lastDrawnFloat >= 0
      ? Math.abs(clampedFloat - this._lastDrawnFloat)
      : 0;

    const imgFloorExact = this.frameCache.getFrame(sectionKey, floorIndex);
    const imgFloor = imgFloorExact || this.frameCache.nearestFrame(sectionKey, floorIndex);
    if (!imgFloor) {
      this._drawPlaceholder(section);
      return;
    }

    this.ctx.globalAlpha = 1;
    this._drawImageCover(imgFloor);
    this._lastValidImage = imgFloor;

    // Velocity-aware optical blend: only double-draw when scrubbing slowly/moderately (<0.65 frames/tick).
    // During fast mobile flicks, drawing a single frame avoids ghosting and halves GPU fill bandwidth.
    if (imgFloorExact && frameDelta < 0.65 && blendAlpha > 0.02 && blendAlpha < 0.98 && ceilIndex !== floorIndex) {
      const imgCeil = this.frameCache.getFrame(sectionKey, ceilIndex);
      if (imgCeil) {
        this.ctx.globalAlpha = blendAlpha;
        this._drawImageCover(imgCeil);
        this.ctx.globalAlpha = 1;
      }
    }

    this._lastDrawnKey = sectionKey;
    this._lastDrawnFloat = clampedFloat;
    this._lastDrawnFrame = floorIndex;
  }

  /**
   * Draw the section's pre-blurred 20x36 placeholder.webp (130 bytes)
   * using hardware-accelerated bilinear scaling (zero ctx.filter overhead).
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
    const imgA = this.frameCache.nearestFrame(keyA, floorA)
      || (secA && this.frameCache.getPlaceholder(secA.key))
      || this._lastValidImage;
    const imgB = this.frameCache.nearestFrame(keyB, floorB)
      || (secB && this.frameCache.getPlaceholder(secB.key));

    if (imgA) {
      this.ctx.globalAlpha = 1;
      this._drawImageCover(imgA);
      this._lastValidImage = imgA;
    } else {
      this.ctx.fillStyle = '#0a0a0a';
      this.ctx.fillRect(0, 0, this._displayWidth, this._displayHeight);
    }

    if (imgB && progress > 0) {
      const alpha = Math.max(0, Math.min(1, progress));
      this.ctx.globalAlpha = alpha;
      this._drawImageCover(imgB);
      this.ctx.globalAlpha = 1;
      if (progress >= 0.5) {
        this._lastValidImage = imgB;
      }
    }

    this._lastDrawnKey = null;
    this._lastDrawnFloat = -1;
    this._lastDrawnFrame = -1;
  }

  /**
   * Draw an image covering the canvas (object-fit: cover).
   */
  _drawImageCover(img) {
    const cw = this._displayWidth;
    const ch = this._displayHeight;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
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
