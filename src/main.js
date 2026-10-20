/**
 * The Nines — Main Entry Point
 *
 * Orchestrates: config loading → scroll container setup →
 * scroll listener → frame loading → canvas rendering → debug HUD.
 */

import { buildSectionConfig, computeScrollLayout, filterSectionsForPureVeg } from './config.js';
import { getScrollState } from './scroll-map.js';
import { FrameCache } from './frame-cache.js';
import { SmartLoader } from './loader.js';
import { ScrollEaser } from './scroll-easer.js';
import { Renderer } from './renderer.js';
import { DebugHUD } from './debug-hud.js';

import { buildMenuDOM, measureMenuHeights, updateMenuState } from './menu.js';
import { initListUI, syncAllMenuButtons } from './list.js';
import { initNav, updateBottomNav } from './nav.js';
import { isScrollLocked, getLockedScrollY, onLockChange } from './scroll-lock.js';

// ── Global state ────────────────────────────────────────────────
let masterSections = [];
let isPureVeg = false;
let vegToggleTransitionId = 0;
let layout = [];
let frameCache;
let loader;
let easer;
let renderer;
let debugHUD;
let navController;
let scrollContainer;
let canvas;
let rafId = null;
let resizeTimer = null;
let lastScrollY = -1;
let viewportHeight = window.innerHeight;
let viewportWidth = window.innerWidth;
let lastState = null;

function applyFilteredLayoutAtSection(targetKey, holdRatio = 0, wasAtTop = false) {
  const activeSections = filterSectionsForPureVeg(masterSections, isPureVeg);
  layout = computeScrollLayout(activeSections, viewportHeight);
  buildMenuDOM(layout);
  refreshLayoutHeights();
  syncAllMenuButtons();

  const targetSec = layout.find(s => s.key === targetKey) || layout[0];
  let newScrollY = 0;
  if (wasAtTop || !targetSec || targetSec.type === 'group-intro') {
    newScrollY = wasAtTop ? 0 : (targetSec ? targetSec.scrollStart : 0);
  } else {
    const offsetInHold = holdRatio > 0
      ? Math.max(16, Math.round(holdRatio * targetSec.H_length))
      : 16;
    newScrollY = Math.min(targetSec.H_end - 4, Math.ceil(targetSec.H_start + offsetInHold));
  }

  if (easer) easer.snap(newScrollY);
  window.scrollTo(0, newScrollY);
  if (loader && targetSec) loader.finishJump(targetSec.index);
  if (renderer) renderer.invalidate();
  lastScrollY = -1;
  onScroll();
}

function setPureVegMode(enabled) {
  isPureVeg = Boolean(enabled);
  const myTransitionId = ++vegToggleTransitionId;

  const toggleBtn = document.getElementById('pure-veg-toggle');
  if (toggleBtn) {
    toggleBtn.classList.toggle('active', isPureVeg);
    toggleBtn.setAttribute('aria-checked', isPureVeg ? 'true' : 'false');
  }

  const wasAtTop = window.scrollY < 40;
  const prevSec = lastState?.section || layout[0];
  const prevKey = prevSec?.key || 'food';
  const prevIdx = lastState?.sectionIndex ?? 0;

  // Check if user is turning Pure Veg ON while currently on (or dissolving into) a 100% non-veg section
  const NON_VEG_TO_VEG_MAP = {
    'nonveg-starters': 'veg-starters',
    'nonveg-mains': 'veg-mains',
  };
  const pairedVegKey = isPureVeg ? NON_VEG_TO_VEG_MAP[prevKey] : null;

  if (pairedVegKey && easer) {
    // PHASE 1: Smoothly scroll from "To Begin Non-Veg" -> "To Begin Veg" (or "All Together Non-Veg" -> "All Together Veg")
    // BEFORE removing the non-veg section from `layout`, so the video & menu scroll naturally instead of popping!
    const vegSecInCurrentLayout = layout.find(s => s.key === pairedVegKey);
    if (vegSecInCurrentLayout) {
      const targetScrollInCurrent = Math.min(
        vegSecInCurrentLayout.H_end - 4,
        Math.ceil(vegSecInCurrentLayout.H_start + 16)
      );
      const currentY = easer.isTweening ? easer._display : window.scrollY;
      const distancePx = Math.abs(targetScrollInCurrent - currentY);
      const durationMs = Math.max(560, Math.min(950, Math.round(380 + Math.sqrt(distancePx) * 5.2)));

      if (loader) loader.jumpTo(vegSecInCurrentLayout.index, prevIdx);

      easer.tweenTo(targetScrollInCurrent, durationMs, () => {
        if (myTransitionId !== vegToggleTransitionId) return;
        // PHASE 2: Now that we have smoothly scrolled into and landed on "To Begin Veg" (at H_start + 16),
        // silently rebuild the 17-section Pure Veg layout anchored at the exact same spot in "To Begin Veg"!
        applyFilteredLayoutAtSection(pairedVegKey, 0, false);
      });
      return;
    }
  }

  // For all other sections (which remain in the menu in both modes):
  // Softly cross-fade the menu layer while keeping the current section's video frame steady
  const menuLayer = document.getElementById('menu-layer');
  if (menuLayer && !wasAtTop && prevSec?.type === 'section') {
    menuLayer.classList.add('veg-filtering-fade');
    setTimeout(() => {
      if (myTransitionId !== vegToggleTransitionId) return;
      applyFilteredLayoutAtSection(prevKey, 0, wasAtTop);
      requestAnimationFrame(() => {
        menuLayer.classList.remove('veg-filtering-fade');
      });
    }, 150);
  } else {
    applyFilteredLayoutAtSection(prevKey, 0, wasAtTop);
  }
}

function refreshLayoutHeights() {
  viewportHeight = window.innerHeight;
  viewportWidth = window.innerWidth;
  measureMenuHeights(layout, viewportHeight);
  layout = computeScrollLayout(layout, viewportHeight);
  if (loader) loader.setLayout(layout);
  if (navController && navController.rebuildLinks) {
    navController.rebuildLinks(layout);
  }
  if (window.__theNines) {
    window.__theNines.layout = layout;
  }
  const totalScroll = layout[layout.length - 1].scrollEnd;
  if (scrollContainer) {
    scrollContainer.style.height = `${totalScroll + viewportHeight}px`;
  }
  return totalScroll;
}

// ── Init ────────────────────────────────────────────────────────
async function init() {
  console.log('[The Nines] Initializing…');

  masterSections = await buildSectionConfig();
  console.log(`[The Nines] ${masterSections.length} master sections configured`);

  viewportHeight = window.innerHeight;
  viewportWidth = window.innerWidth;
  const sections = filterSectionsForPureVeg(masterSections, isPureVeg);
  layout = computeScrollLayout(sections, viewportHeight);

  // Set up canvas & core systems
  canvas = document.getElementById('main-canvas');
  frameCache = new FrameCache((loadedSectionKey) => {
    if (!lastState || !renderer) return;
    const activeKey = lastState.section?.key;
    const nextKey = lastState.crossDissolve?.nextSection?.key;
    if (loadedSectionKey === activeKey || loadedSectionKey === nextKey) {
      renderer.invalidate();
      renderer.render(lastState, true);
    }
  });
  loader = new SmartLoader(frameCache, layout);
  easer  = new ScrollEaser();
  renderer = new Renderer(canvas, frameCache);
  debugHUD = new DebugHUD();

  // Kick off loading section 0 (current) at high priority and section 1 ahead of time
  loader.jumpTo(0);
  loader.finishJump();
  if (layout.length > 1) {
    loader._ensureLoaded(1, 'low');
  }

  // Phase 3: Build DOM menu and measure real heights
  scrollContainer = document.getElementById('scroll-container');
  buildMenuDOM(layout);
  const totalScroll = refreshLayoutHeights();
  console.log(`[The Nines] Total scroll height: ${Math.round(totalScroll)}px`);

  // Phase 4: Init Nav, List, and Pure Veg Toggle
  navController = initNav(layout, loader, easer);
  initListUI();

  const vegToggleBtn = document.getElementById('pure-veg-toggle');
  if (vegToggleBtn) {
    vegToggleBtn.addEventListener('click', () => {
      setPureVegMode(!isPureVeg);
    });
  }

  const isDebugOrLocal =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' ||
     window.location.hostname === '127.0.0.1' ||
     window.location.search.includes('debug=1'));

  if (isDebugOrLocal) {
    window.__theNines = { layout, loader, easer, renderer, frameCache };
  }

  // Re-measure heights once Google Fonts finish loading so custom font metrics never clip the last dish
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      refreshLayoutHeights();
      lastScrollY = -1;
      onScroll();
    }).catch(() => {});
  }

  // Wait for initial sequential frames to load before revealing the screen
  await new Promise(resolve => {
    const startTime = performance.now();
    const checkReady = () => {
      const firstKey = layout[0].key;
      const progress = loader.getProgress(firstKey);

      if (progress >= 0.30 || (performance.now() - startTime > 700 && progress > 0.08)) {
        setTimeout(() => {
          document.body.classList.add('ready');
          resolve();
        }, 60);
      } else {
        requestAnimationFrame(checkReady);
      }
    };
    requestAnimationFrame(checkReady);
  });

  // Start scroll loop
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });

  onLockChange((locked, savedY) => {
    if (easer) easer.snap(savedY);
    if (!locked) {
      lastScrollY = -1;
      onScroll();
    }
  });

  frameCache.onFrameDecoded((key, frameIdx) => {
    if (lastState && lastState.section && lastState.section.key === key) {
      const activeIdx = Math.floor(lastState.frameFloat !== undefined ? lastState.frameFloat : lastState.frameIndex);
      if (Math.abs(activeIdx - frameIdx) <= 1) {
        renderer.render(lastState, true);
      }
    }
  });

  // Initial render
  onScroll();

  console.log('[The Nines] Ready');
}

// ── Scroll handler ──────────────────────────────────────────────
function onScroll() {
  if (isScrollLocked()) {
    const lockedY = getLockedScrollY();
    if (Math.abs(window.scrollY - lockedY) > 0.5) {
      window.scrollTo(0, lockedY);
    }
    return;
  }
  if (rafId) return;
  rafId = requestAnimationFrame(tick);
}

function tick() {
  rafId = null;
  if (isScrollLocked()) {
    const lockedY = getLockedScrollY();
    if (easer) easer.snap(lockedY);
    if (Math.abs(window.scrollY - lockedY) > 0.5) {
      window.scrollTo(0, lockedY);
    }
    return;
  }
  const realScrollY = window.scrollY;

  const scrollY = easer ? easer.tick(realScrollY) : realScrollY;
  const isTweening = easer ? easer.isTweening : false;

  // Keep firing rAF while easing or tweening
  const stillEasing = isTweening || Math.abs(scrollY - realScrollY) > 0.15;
  if (stillEasing) {
    rafId = requestAnimationFrame(tick);
  }

  if (Math.abs(scrollY - lastScrollY) < 0.04 && !stillEasing) return;
  lastScrollY = scrollY;

  const state = getScrollState(scrollY, layout);
  lastState = state;

  renderer.render(state);
  updateMenuState(state, layout, viewportHeight);
  updateBottomNav(state, layout);
  loader.advance(state, isTweening, scrollY);

  const totalScroll = layout.length > 0 ? layout[layout.length - 1].scrollEnd : 0;
  debugHUD.update(state, scrollY, totalScroll);
}

// ── Resize handler ──────────────────────────────────────────────
function onResize() {
  const newW = window.innerWidth;
  const newH = window.innerHeight;

  // Ignore mobile URL bar height-only shifts (<160px when width is unchanged)
  if (newW === viewportWidth && Math.abs(newH - viewportHeight) < 160) {
    return;
  }

  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const prevScrollRatio = layout.length > 0 && layout[layout.length - 1].scrollEnd > 0
      ? window.scrollY / layout[layout.length - 1].scrollEnd
      : 0;

    renderer.resize(true);
    const newTotalScroll = refreshLayoutHeights();

    // Preserve relative scroll position across orientation/layout changes
    if (prevScrollRatio > 0 && newTotalScroll > 0) {
      const targetY = prevScrollRatio * newTotalScroll;
      if (easer) easer.snap(targetY);
      window.scrollTo(0, targetY);
    }

    lastScrollY = -1;
    onScroll();
  }, 120);
}

// ── Start ───────────────────────────────────────────────────────
init().catch(err => {
  console.error('[The Nines] Init failed:', err);
});
