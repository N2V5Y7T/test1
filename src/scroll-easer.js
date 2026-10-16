const SNAP_THRESHOLD = 0.15;
const TOUCH_TAU_MS = 22;    // Fast micro-smoothing on touch screens (eliminates touch-sample jitter with zero lag)
const DESKTOP_TAU_MS = 55;  // Smooth momentum glide on desktop wheel/trackpad

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class ScrollEaser {
  constructor() {
    this._display = window.scrollY;
    this._lastTime = performance.now();
    this._reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
    this._tween = null;

    window.matchMedia('(prefers-reduced-motion: reduce)')
      .addEventListener('change', e => { this._reduced = e.matches; });

    // Cancel programmatic nav jump if user manually touches or wheels
    const cancelOnUserGesture = () => {
      if (this._tween) this.cancelTween();
    };
    window.addEventListener('touchstart', cancelOnUserGesture, { passive: true });
    window.addEventListener('wheel', cancelOnUserGesture, { passive: true });
    window.addEventListener('keydown', cancelOnUserGesture, { passive: true });
  }

  get isTweening() {
    return this._tween !== null;
  }

  /**
   * Capped ~800ms custom rAF scroll tween for navigation jumps (Spec §5).
   * Prevents browser-native smooth scroll from taking multiple seconds over 40,000px.
   */
  tweenTo(targetY, durationMs = 780, onComplete = null) {
    if (this._reduced) {
      this.cancelTween();
      this._display = targetY;
      window.scrollTo(0, targetY);
      if (onComplete) onComplete();
      return;
    }

    const startY = window.scrollY;
    const distance = targetY - startY;
    if (Math.abs(distance) < 2) {
      this._display = targetY;
      window.scrollTo(0, targetY);
      if (onComplete) onComplete();
      return;
    }

    this._tween = {
      startY,
      targetY,
      startTime: performance.now(),
      durationMs,
      onComplete,
    };
    this._lastTime = performance.now();
    // Trigger scroll loop
    window.scrollTo(0, startY);
    window.dispatchEvent(new Event('scroll'));
  }

  cancelTween() {
    if (!this._tween) return;
    const cb = this._tween.onComplete;
    this._tween = null;
    if (cb) cb();
  }

  tick(realScrollY) {
    const now = performance.now();
    const dt = Math.min(64, Math.max(1, now - this._lastTime));
    this._lastTime = now;

    // Handle active programmatic nav tween
    if (this._tween) {
      const elapsed = now - this._tween.startTime;
      const t = Math.min(1, elapsed / this._tween.durationMs);
      const eased = easeInOutCubic(t);
      const nextY = this._tween.startY + (this._tween.targetY - this._tween.startY) * eased;
      this._display = nextY;
      window.scrollTo(0, nextY);

      if (t >= 1) {
        const cb = this._tween.onComplete;
        this._tween = null;
        this._display = nextY;
        if (cb) cb();
      }
      return this._display;
    }

    if (this._reduced) {
      this._display = realScrollY;
      return realScrollY;
    }

    const delta = realScrollY - this._display;

    if (Math.abs(delta) < SNAP_THRESHOLD) {
      this._display = realScrollY;
      return realScrollY;
    }

    // Frame-rate independent exponential smoothing (consistent across 60Hz, 90Hz, and 120Hz ProMotion)
    const tau = this._isTouchDevice ? TOUCH_TAU_MS : DESKTOP_TAU_MS;
    const alpha = 1 - Math.exp(-dt / tau);
    this._display += delta * alpha;
    return this._display;
  }

  snap(scrollY) {
    this.cancelTween();
    this._display = scrollY;
    this._lastTime = performance.now();
  }
}
