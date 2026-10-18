/**
 * The Nines — Cinematic Scroll Easer & Cruise Tween Engine
 *
 * Provides:
 * 1. Adaptive Duration Calculation: scales smoothly from 500ms to 1550ms based on scroll distance.
 * 2. C1-Continuous Trapezoidal Cruise Curve: smooth acceleration (z = 0.20), constant cruise velocity
 *    (1.25x peak), and smooth deceleration, ensuring all intermediate sections are visibly traversed.
 * 3. Dropped-Frame Protection: capped frame delta (dt <= 20ms) prevents teleports during heavy network load.
 * 4. Clean Tween Supersession: rapid clicks smoothly retarget without firing stale callbacks.
 */

const SNAP_THRESHOLD = 0.15;
const TOUCH_TAU_MS = 22;   // Fast micro-smoothing on touch screens
const DESKTOP_TAU_MS = 55; // Smooth momentum glide on desktop wheel/trackpad

export function computeAdaptiveDuration(distancePx) {
  const absDist = Math.abs(distancePx);
  return Math.round(Math.min(1550, Math.max(500, 360 + Math.sqrt(absDist) * 5.8)));
}

/**
 * C1-continuous trapezoidal velocity cruise curve.
 * Ramp fraction z = 0.20, constant velocity window [0.20, 0.80], peak velocity 1.25x.
 */
export function easeCinematicCruise(t) {
  const clamped = Math.max(0, Math.min(1, t));
  const z = 0.20;
  const vMax = 1 / (1 - z); // 1.25
  if (clamped < z) {
    return 0.5 * (vMax / z) * clamped * clamped;
  } else if (clamped <= 1 - z) {
    return vMax * (clamped - 0.5 * z);
  } else {
    const rem = 1 - clamped;
    return 1 - 0.5 * (vMax / z) * rem * rem;
  }
}

export class ScrollEaser {
  constructor() {
    this._display = typeof window !== 'undefined' ? window.scrollY : 0;
    this._lastTime = typeof performance !== 'undefined' ? performance.now() : 0;
    this._reduced = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
    this._isTouchDevice = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(pointer: coarse)').matches
      : false;
    this._tween = null;

    if (typeof window !== 'undefined' && window.matchMedia) {
      window.matchMedia('(prefers-reduced-motion: reduce)')
        .addEventListener('change', e => { this._reduced = e.matches; });

      // Cancel programmatic nav jump if user manually touches or wheels
      const cancelOnUserGesture = () => {
        if (this._tween) this.cancelTween(false);
      };
      window.addEventListener('touchstart', cancelOnUserGesture, { passive: true });
      window.addEventListener('wheel', cancelOnUserGesture, { passive: true });
      window.addEventListener('keydown', cancelOnUserGesture, { passive: true });
    }
  }

  get isTweening() {
    return this._tween !== null;
  }

  /**
   * Programmatic scroll tween with adaptive duration and cinematic cruise curve.
   */
  tweenTo(targetY, durationMs = 'auto', onComplete = null) {
    const startY = this._tween ? this._display : (typeof window !== 'undefined' ? window.scrollY : 0);
    const distance = targetY - startY;

    if (Math.abs(distance) < 2) {
      this.cancelTween(false);
      this._display = targetY;
      if (typeof window !== 'undefined') window.scrollTo(0, targetY);
      if (onComplete) onComplete();
      return;
    }

    const finalDuration = durationMs === 'auto'
      ? computeAdaptiveDuration(distance)
      : (typeof durationMs === 'number' ? durationMs : computeAdaptiveDuration(distance));

    if (this._reduced) {
      this.cancelTween(false);
      this._display = targetY;
      if (typeof window !== 'undefined') window.scrollTo(0, targetY);
      if (onComplete) onComplete();
      return;
    }

    // Cancel previous tween without firing stale callbacks
    this.cancelTween(false);

    this._tween = {
      startY,
      targetY,
      startTime: typeof performance !== 'undefined' ? performance.now() : 0,
      elapsed: 0,
      durationMs: finalDuration,
      onComplete,
    };
    this._lastTime = typeof performance !== 'undefined' ? performance.now() : 0;

    if (typeof window !== 'undefined') {
      window.scrollTo(0, startY);
      window.dispatchEvent(new Event('scroll'));
    }
  }

  cancelTween(fireCallback = false) {
    if (!this._tween) return;
    const cb = this._tween.onComplete;
    this._tween = null;
    if (fireCallback && cb) cb();
  }

  tick(realScrollY) {
    const clampedScrollY = Math.max(0, realScrollY);
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const rawDt = Math.max(1, now - this._lastTime);
    const dt = Math.min(64, rawDt);
    this._lastTime = now;

    // Handle active programmatic nav tween
    if (this._tween) {
      // Advance using capped frame step so dropped frames under load never teleport past sections
      this._tween.elapsed += Math.min(20, rawDt);
      const t = Math.min(1, this._tween.elapsed / this._tween.durationMs);
      const eased = easeCinematicCruise(t);
      const nextY = this._tween.startY + (this._tween.targetY - this._tween.startY) * eased;
      this._display = nextY;

      if (typeof window !== 'undefined') {
        window.scrollTo(0, nextY);
      }

      if (t >= 1) {
        const cb = this._tween.onComplete;
        this._tween = null;
        this._display = nextY;
        if (cb) cb();
      }
      return this._display;
    }

    if (this._reduced) {
      this._display = clampedScrollY;
      return clampedScrollY;
    }

    const delta = clampedScrollY - this._display;
    if (Math.abs(delta) < SNAP_THRESHOLD) {
      this._display = clampedScrollY;
      return clampedScrollY;
    }

    // Frame-rate independent exponential smoothing
    const tau = this._isTouchDevice ? TOUCH_TAU_MS : DESKTOP_TAU_MS;
    const alpha = 1 - Math.exp(-dt / tau);
    this._display += delta * alpha;
    return this._display;
  }

  snap(scrollY) {
    this.cancelTween(false);
    this._display = scrollY;
    this._lastTime = typeof performance !== 'undefined' ? performance.now() : 0;
  }
}
