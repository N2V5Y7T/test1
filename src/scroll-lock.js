/**
 * The Nines — Unified Overlay Scroll Lock Manager
 *
 * Implements reference-counted, coordinated scroll locking across all overlays:
 * - Hamburger Navigation Menu (#nav-drawer)
 * - My List / Cart Panel (#list-drawer)
 * - Option Picker Bottom Sheet (#option-picker)
 *
 * Guarantees:
 * 1. Background page scrolling is completely locked while any overlay is open.
 * 2. Background canvas video progression remains 100% stationary during gestures in overlays.
 * 3. Mobile touch gesture chaining over empty space, headers, and footers is eliminated.
 * 4. Boundary scroll chaining (top / bottom rubber-banding) is contained.
 * 5. Opening one overlay and then another does not prematurely unlock background scrolling.
 * 6. Saved scroll position is strictly preserved and restored upon closing.
 */

const _activeOverlays = new Set();
const _closeHandlers = new Map();
const _lockChangeListeners = [];

let _isLocked = false;
let _savedScrollY = 0;

let _lastTouchY = 0;
let _lastTouchX = 0;
let _activeScrollable = null;

export function isScrollLocked() {
  return _isLocked;
}

export function getLockedScrollY() {
  return _savedScrollY;
}

export function onLockChange(callback) {
  _lockChangeListeners.push(callback);
}

export function registerOverlayCloseHandler(overlayId, closeFn) {
  _closeHandlers.set(overlayId, closeFn);
}

/**
 * Finds the nearest vertically scrollable element for the given target,
 * bounded by the active overlay root.
 */
function findScrollableParent(target, overlayRoot) {
  let el = target;
  while (el && el !== overlayRoot && el !== document.body && el !== document.documentElement) {
    const style = window.getComputedStyle(el);
    const overflowY = style.overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') {
      // Must actually have content exceeding client height to be scrollable
      if (el.scrollHeight > el.clientHeight + 1) {
        return el;
      }
    }
    el = el.parentElement;
  }
  return null;
}

/**
 * Intercepts desktop mouse wheel / trackpad gestures.
 */
function handleWheel(e) {
  if (!_isLocked) return;

  const overlay = e.target.closest('.drawer.open, #option-picker.open, #drawer-overlay.open, #option-picker-bg.open');

  // Outside open overlay or over backdrop: freeze completely
  if (!overlay || overlay.id === 'drawer-overlay' || overlay.id === 'option-picker-bg') {
    e.preventDefault();
    return;
  }

  // Inside overlay: check if target is inside an element that can actually scroll
  const scrollable = findScrollableParent(e.target, overlay);
  if (!scrollable) {
    // Non-scrollable area: header, footer, or empty/short list
    e.preventDefault();
    return;
  }

  // Check top / bottom boundaries to prevent scroll chaining to the page
  const deltaY = e.deltaY;
  const atTop = scrollable.scrollTop <= 1;
  const atBottom = scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight - 1.5;

  if (deltaY < 0 && atTop) {
    // Scrolling up while already at top
    e.preventDefault();
    return;
  }
  if (deltaY > 0 && atBottom) {
    // Scrolling down while already at bottom
    e.preventDefault();
    return;
  }

  // Within bounds of scrollable container: allow native wheel scrolling
}

/**
 * Intercepts touch gestures on mobile devices.
 */
function handleTouchStart(e) {
  if (!_isLocked) return;
  if (!e.touches || e.touches.length !== 1) return;

  const touch = e.touches[0];
  _lastTouchY = touch.clientY;
  _lastTouchX = touch.clientX;

  const overlay = e.target.closest('.drawer.open, #option-picker.open, #drawer-overlay.open, #option-picker-bg.open');
  if (overlay && overlay.id !== 'drawer-overlay' && overlay.id !== 'option-picker-bg') {
    _activeScrollable = findScrollableParent(e.target, overlay);
  } else {
    _activeScrollable = null;
  }
}

function handleTouchMove(e) {
  if (!_isLocked) return;
  if (!e.touches || e.touches.length !== 1) return;

  const touch = e.touches[0];
  const currentY = touch.clientY;
  const currentX = touch.clientX;

  const moveDeltaY = currentY - _lastTouchY; // positive = moving downwards, negative = moving upwards
  _lastTouchY = currentY;
  _lastTouchX = currentX;

  const overlay = e.target.closest('.drawer.open, #option-picker.open, #drawer-overlay.open, #option-picker-bg.open');

  // Outside open overlay or over backdrop: freeze completely
  if (!overlay || overlay.id === 'drawer-overlay' || overlay.id === 'option-picker-bg') {
    e.preventDefault();
    return;
  }

  const scrollable = _activeScrollable || findScrollableParent(e.target, overlay);
  if (!scrollable) {
    // Non-scrollable area: header, footer, empty space, short list
    e.preventDefault();
    return;
  }

  const atTop = scrollable.scrollTop <= 1;
  const atBottom = scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight - 1.5;

  // Moving downwards (finger dragged down -> scrolling content up toward top)
  if (moveDeltaY > 0 && atTop) {
    e.preventDefault();
    return;
  }

  // Moving upwards (finger dragged up -> scrolling content down toward bottom)
  if (moveDeltaY < 0 && atBottom) {
    e.preventDefault();
    return;
  }

  // Within bounds of scrollable element: native touch scrolling permitted
}

/**
 * Ensures window.scrollY never drifts while locked.
 */
function handleWindowScroll() {
  if (_isLocked && Math.abs(window.scrollY - _savedScrollY) > 0.5) {
    window.scrollTo(0, _savedScrollY);
  }
}

/**
 * Keyboard accessibility: Escape closes topmost overlay, prevents page scroll keys.
 */
function handleKeyDown(e) {
  if (!_isLocked) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    for (const [id, closeFn] of [..._closeHandlers.entries()].reverse()) {
      if (_activeOverlays.has(id)) {
        closeFn();
        break;
      }
    }
    return;
  }

  const scrollKeys = ['Space', ' ', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
  if (scrollKeys.includes(e.key)) {
    const activeEl = document.activeElement;
    const overlay = activeEl ? activeEl.closest('.drawer.open, #option-picker.open') : null;
    const scrollable = overlay ? findScrollableParent(activeEl, overlay) : null;
    if (!scrollable) {
      e.preventDefault();
    }
  }
}

function attachLockListeners() {
  window.addEventListener('wheel', handleWheel, { passive: false });
  document.addEventListener('touchstart', handleTouchStart, { passive: false });
  document.addEventListener('touchmove', handleTouchMove, { passive: false });
  window.addEventListener('scroll', handleWindowScroll, { passive: true });
  window.addEventListener('keydown', handleKeyDown, { passive: false });
}

function removeLockListeners() {
  window.removeEventListener('wheel', handleWheel);
  document.removeEventListener('touchstart', handleTouchStart);
  document.removeEventListener('touchmove', handleTouchMove);
  window.removeEventListener('scroll', handleWindowScroll);
  window.removeEventListener('keydown', handleKeyDown);
}

/**
 * Request scroll lock for an overlay by ID.
 * Uses reference counting so multiple open overlays coordinate cleanly.
 */
export function acquireLock(overlayId) {
  if (!_activeOverlays.has(overlayId)) {
    _activeOverlays.add(overlayId);
  }

  if (!_isLocked) {
    _isLocked = true;
    _savedScrollY = Math.round(window.scrollY);

    document.documentElement.classList.add('overlay-scroll-locked');
    document.body.classList.add('overlay-scroll-locked');

    attachLockListeners();

    _lockChangeListeners.forEach(cb => cb(true, _savedScrollY));
  }
}

/**
 * Release scroll lock for an overlay by ID.
 * Only unlocks the background when ALL overlays have closed.
 */
export function releaseLock(overlayId) {
  _activeOverlays.delete(overlayId);

  if (_activeOverlays.size === 0 && _isLocked) {
    _isLocked = false;

    removeLockListeners();

    document.documentElement.classList.remove('overlay-scroll-locked');
    document.body.classList.remove('overlay-scroll-locked');

    // Restore exact scroll position
    window.scrollTo(0, _savedScrollY);

    _lockChangeListeners.forEach(cb => cb(false, _savedScrollY));
  }
}
