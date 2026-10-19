/**
 * The Nines — Hamburger Navigation & Continuous Bottom Category Bar
 */

import { acquireLock, releaseLock, registerOverlayCloseHandler } from './scroll-lock.js';
import { escapeHtml } from './utils.js';
import { computeAdaptiveDuration } from './scroll-easer.js';
import { pushModalHistoryState, popModalHistoryStateIfNeeded } from './list.js';

let _activeSectionKey = null;
let _renderedSectionKeys = '';

export function initNav(layout, loader, easer) {
  const drawer = document.getElementById('nav-drawer');
  const overlay = document.getElementById('drawer-overlay');
  const openBtn = document.getElementById('nav-hamburger-btn');
  const closeBtn = document.getElementById('close-nav-btn');
  const linksContainer = document.getElementById('nav-links');
  const bottomNav = document.getElementById('bottom-nav');

  function rebuildLinks(currentLayout) {
    let html = '';
    let currentGroup = null;

    currentLayout.forEach((sec, idx) => {
      if (sec.groupKey && sec.groupKey !== currentGroup) {
        currentGroup = sec.groupKey;
        if (sec.type !== 'group-intro' && sec.groupLabel) {
          html += `<div class="nav-group-header">${escapeHtml(sec.groupLabel)}</div>`;
        }
      }

      const isGroup = sec.type === 'group-intro';
      const className = isGroup ? 'nav-link group-link' : 'nav-link section-link';

      if (sec.label) {
        const scrollTarget = isGroup ? sec.scrollStart : sec.H_start;
        html += `<button class="${className}" data-scroll="${scrollTarget}" data-idx="${idx}" data-key="${escapeHtml(sec.key)}">${escapeHtml(sec.label)}</button>`;
      }
    });
    linksContainer.innerHTML = html;

    // Also ensure the continuous bottom category bar has fresh layout indices
    buildContinuousBottomBar(bottomNav, currentLayout);
  }

  rebuildLinks(layout);

  function openDrawer() {
    drawer.classList.add('open');
    overlay.classList.add('open');
    acquireLock('nav-drawer');
    pushModalHistoryState();
  }

  function closeDrawer() {
    drawer.classList.remove('open');
    const listDrawer = document.getElementById('list-drawer');
    if (!listDrawer || !listDrawer.classList.contains('open')) {
      overlay.classList.remove('open');
    }
    releaseLock('nav-drawer');
    popModalHistoryStateIfNeeded();
  }

  registerOverlayCloseHandler('nav-drawer', closeDrawer);

  function jumpToSection(destIdx, currentLayout) {
    const sec = currentLayout[destIdx];
    if (!sec) return;
    const targetScroll = sec.type === 'group-intro' ? sec.scrollStart : sec.H_start;

    const currentY = easer && easer.isTweening ? easer._display : window.scrollY;
    let currentIdx = 0;
    for (let i = 0; i < currentLayout.length; i++) {
      const s = currentLayout[i];
      if (currentY >= s.scrollStart && currentY < s.scrollEnd) {
        currentIdx = i;
        break;
      }
    }

    if (loader) loader.jumpTo(destIdx, currentIdx);

    const dist = Math.abs(targetScroll - currentY);
    const duration = computeAdaptiveDuration(dist);

    if (easer) {
      easer.tweenTo(targetScroll, duration, () => {
        if (loader) loader.finishJump(destIdx);
      });
    } else {
      window.scrollTo({ top: targetScroll, behavior: 'smooth' });
      if (loader) setTimeout(() => loader.finishJump(destIdx), duration);
    }
  }

  openBtn.addEventListener('click', openDrawer);
  closeBtn.addEventListener('click', closeDrawer);
  overlay.addEventListener('click', closeDrawer);

  linksContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-link');
    if (!btn) return;
    const destIdx = parseInt(btn.getAttribute('data-idx') || '0', 10);
    const activeLayout = window.__theNines ? window.__theNines.layout : layout;
    closeDrawer();
    jumpToSection(destIdx, activeLayout);
  });

  if (bottomNav) {
    bottomNav.addEventListener('click', (e) => {
      const tab = e.target.closest('.bottom-tab-btn');
      if (!tab) return;
      const destIdx = parseInt(tab.getAttribute('data-idx') || '0', 10);
      const activeLayout = window.__theNines ? window.__theNines.layout : layout;
      jumpToSection(destIdx, activeLayout);
    });
  }

  return { rebuildLinks };
}

/**
 * Builds a single, unbroken horizontal stream of ALL menu sections
 * (Food → Bar → Beverages) so scrolling or swiping never stops at a group boundary.
 */
function buildContinuousBottomBar(bottomNav, layout) {
  if (!bottomNav || !layout || !layout.length) return;

  const allSections = layout.filter(s => s.type === 'section');
  const signature = allSections.map(s => `${s.key}:${s.index}`).join('|');
  if (_renderedSectionKeys === signature && bottomNav.children.length > 0) {
    return;
  }
  _renderedSectionKeys = signature;

  let lastGroupKey = null;
  const tabsParts = [];
  const dotsParts = [];

  allSections.forEach(s => {
    if (lastGroupKey && s.groupKey !== lastGroupKey) {
      tabsParts.push(`<span class="bottom-group-sep" aria-hidden="true"></span>`);
      dotsParts.push(`<span class="bottom-dot-sep" aria-hidden="true"></span>`);
    }
    lastGroupKey = s.groupKey;

    tabsParts.push(`
      <button class="bottom-tab-btn" data-idx="${s.index}" data-key="${escapeHtml(s.key)}" data-group="${escapeHtml(s.groupKey)}">
        ${escapeHtml(s.label)}
      </button>
    `);
    dotsParts.push(`<span class="bottom-dot" data-key="${escapeHtml(s.key)}" data-group="${escapeHtml(s.groupKey)}"></span>`);
  });

  bottomNav.innerHTML = `
    <div class="bottom-tabs-scroll">${tabsParts.join('')}</div>
    <div class="bottom-dots">${dotsParts.join('')}</div>
  `;
  _activeSectionKey = null;
}

/**
 * Updates the continuous bottom section pill strip + pagination dots as the user scrolls.
 * Flows seamlessly from Food → Bar → Beverages in one continuous stream.
 */
export function updateBottomNav(state, layout) {
  const bottomNav = document.getElementById('bottom-nav');
  if (!bottomNav || !state || !state.section) return;

  buildContinuousBottomBar(bottomNav, layout);

  const sec = state.section;

  // Hide only at the very beginning of the opening Food intro before First Course
  if (sec.type === 'group-intro' && state.segment === 'A' && state.segmentProgress < 0.65) {
    bottomNav.classList.remove('visible');
  } else {
    bottomNav.classList.add('visible');
  }

  // Determine active section key:
  // - If in group-intro, highlight the first section right after it
  // - If in cross-dissolve (Segment J) and >25% through, advance highlight to incoming section
  let targetKey = sec.key;
  if (sec.type === 'group-intro') {
    const firstRegular = layout.find(s => s.type === 'section');
    if (firstRegular) targetKey = firstRegular.key;
  } else if (state.segment === 'J' && state.crossDissolve && state.crossDissolve.progress >= 0.25) {
    const nextSec = state.crossDissolve.nextSection;
    if (nextSec && nextSec.type === 'section') {
      targetKey = nextSec.key;
    }
  }

  if (_activeSectionKey !== targetKey) {
    _activeSectionKey = targetKey;

    const tabs = bottomNav.querySelectorAll('.bottom-tab-btn');
    tabs.forEach(t => {
      const isMatch = t.getAttribute('data-key') === targetKey;
      t.classList.toggle('active', isMatch);
      if (isMatch) {
        const scrollWrap = bottomNav.querySelector('.bottom-tabs-scroll');
        if (scrollWrap) {
          const targetLeft = t.offsetLeft - (scrollWrap.clientWidth / 2) + (t.offsetWidth / 2);
          scrollWrap.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
        }
      }
    });

    const dots = bottomNav.querySelectorAll('.bottom-dot');
    dots.forEach(d => {
      d.classList.toggle('active', d.getAttribute('data-key') === targetKey);
    });
  }
}
