/**
 * The Nines — Hamburger Navigation & Bottom Section Tab Strip
 */

let _activeSectionKey = null;
let _activeGroupKey = null;

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
          html += `<div class="nav-group-header">${sec.groupLabel}</div>`;
        }
      }

      const isGroup = sec.type === 'group-intro';
      const className = isGroup ? 'nav-link group-link' : 'nav-link section-link';

      if (sec.label) {
        const scrollTarget = isGroup ? sec.scrollStart : sec.H_start;
        html += `<button class="${className}" data-scroll="${scrollTarget}" data-idx="${idx}" data-key="${sec.key}">${sec.label}</button>`;
      }
    });
    linksContainer.innerHTML = html;
  }

  rebuildLinks(layout);

  function openDrawer() {
    drawer.classList.add('open');
    overlay.classList.add('open');
  }

  function closeDrawer() {
    drawer.classList.remove('open');
    overlay.classList.remove('open');
  }

  function jumpToSection(destIdx, currentLayout) {
    const sec = currentLayout[destIdx];
    if (!sec) return;
    const targetScroll = sec.type === 'group-intro' ? sec.scrollStart : sec.H_start;

    if (loader) loader.jumpTo(destIdx);

    if (easer) {
      easer.tweenTo(targetScroll, 780, () => {
        if (loader) loader.finishJump();
      });
    } else {
      window.scrollTo({ top: targetScroll, behavior: 'smooth' });
      if (loader) setTimeout(() => loader.finishJump(), 800);
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
    jumpToSection(destIdx, activeLayout);
    closeDrawer();
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
 * Updates the bottom section pill strip + pagination dots for the current group (Spec §4).
 */
export function updateBottomNav(state, layout) {
  const bottomNav = document.getElementById('bottom-nav');
  if (!bottomNav || !state || !state.section) return;

  const sec = state.section;
  const groupKey = sec.groupKey;

  // Hide on initial food intro before first-course
  if (sec.type === 'group-intro' && state.segment === 'A' && state.segmentProgress < 0.7) {
    bottomNav.classList.remove('visible');
  } else {
    bottomNav.classList.add('visible');
  }

  if (_activeGroupKey !== groupKey) {
    _activeGroupKey = groupKey;
    const groupSections = layout.filter(s => s.groupKey === groupKey && s.type === 'section');

    const tabsHtml = groupSections.map(s => `
      <button class="bottom-tab-btn ${s.key === sec.key ? 'active' : ''}" data-idx="${s.index}" data-key="${s.key}">
        ${s.label}
      </button>
    `).join('');

    const dotsHtml = groupSections.length > 1
      ? `<div class="bottom-dots">${groupSections.map(s => `<span class="bottom-dot ${s.key === sec.key ? 'active' : ''}" data-key="${s.key}"></span>`).join('')}</div>`
      : '';

    bottomNav.innerHTML = `
      <div class="bottom-tabs-scroll">${tabsHtml}</div>
      ${dotsHtml}
    `;
    _activeSectionKey = null;
  }

  if (_activeSectionKey !== sec.key) {
    _activeSectionKey = sec.key;

    const tabs = bottomNav.querySelectorAll('.bottom-tab-btn');
    tabs.forEach(t => {
      const isMatch = t.getAttribute('data-key') === sec.key;
      t.classList.toggle('active', isMatch);
      if (isMatch) {
        // Center active pill horizontally inside the strip without vertical page scroll
        const scrollWrap = bottomNav.querySelector('.bottom-tabs-scroll');
        if (scrollWrap) {
          const targetLeft = t.offsetLeft - (scrollWrap.clientWidth / 2) + (t.offsetWidth / 2);
          scrollWrap.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
        }
      }
    });

    const dots = bottomNav.querySelectorAll('.bottom-dot');
    dots.forEach(d => {
      d.classList.toggle('active', d.getAttribute('data-key') === sec.key);
    });
  }
}
