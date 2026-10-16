/**
 * The Nines — Main Entry Point
 *
 * Orchestrates: config loading → scroll container setup →
 * scroll listener → frame loading → canvas rendering → debug HUD.
 */

import { buildSectionConfig, computeScrollLayout } from './config.js';
import { getScrollState } from './scroll-map.js';
import { FrameCache } from './frame-cache.js';
import { SmartLoader } from './loader.js';
import { ScrollEaser } from './scroll-easer.js';
import { Renderer } from './renderer.js';
import { DebugHUD } from './debug-hud.js';

import { buildMenuDOM, measureMenuHeights, updateMenuState } from './menu.js';
import { initListUI } from './list.js';
import { initNav, updateBottomNav } from './nav.js';
import { isScrollLocked, getLockedScrollY, onLockChange } from './scroll-lock.js';

// ── Global state ────────────────────────────────────────────────
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

  const sections = await buildSectionConfig();
  console.log(`[The Nines] ${sections.length} sections configured`);

  viewportHeight = window.innerHeight;
  viewportWidth = window.innerWidth;
  layout = computeScrollLayout(sections, viewportHeight);

  // Set up canvas & core systems
  canvas = document.getElementById('main-canvas');
  frameCache = new FrameCache();
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

  // Phase 4: Init Nav and List
  navController = initNav(layout, loader, easer);
  initListUI();

  window.__theNines = { layout, loader, easer, renderer, frameCache };

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

  renderer.render(state);
  updateMenuState(state, layout, viewportHeight);
  updateBottomNav(state, layout);
  loader.advance(state, isTweening);

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
