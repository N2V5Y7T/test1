/**
 * The Nines — DOM Menu Builder & State Updater
 *
 * Generates the HTML for the menu, measures actual rendered heights,
 * and syncs GPU-accelerated CSS transforms/opacities to the current scroll state.
 */

import {
  registerItem,
  addVariant,
  incrementItem,
  decrementItem,
  getVariantQty,
  pushModalHistoryState,
  popModalHistoryStateIfNeeded,
} from './list.js';
import { acquireLock, releaseLock, registerOverlayCloseHandler } from './scroll-lock.js';
import { escapeHtml } from './utils.js';

const _itemRegistry = new Map();
let _scrimEl = null;
let _thankYouEl = null;

function closeOptionPicker() {
  const picker = document.getElementById('option-picker');
  const bg = document.getElementById('option-picker-bg');
  if (picker) {
    picker.classList.remove('open');
    setTimeout(() => picker.remove(), 260);
  }
  if (bg) {
    bg.classList.remove('open');
    setTimeout(() => bg.remove(), 260);
  }
  releaseLock('option-picker');
  popModalHistoryStateIfNeeded();
}

registerOverlayCloseHandler('option-picker', closeOptionPicker);

/**
 * Shows an interactive mobile bottom sheet letting the user add, increment,
 * decrement, or deselect variants (e.g. Veg / Chicken / Prawns or 30ml / Bottle)
 * with dedicated inline quantity steppers.
 */
function showOptionPicker(itemId) {
  const item = _itemRegistry.get(itemId);
  if (!item) return;

  const options = getOptions(item);
  if (!options.length) return;

  const existing = document.getElementById('option-picker');
  if (existing) existing.remove();
  const existingBg = document.getElementById('option-picker-bg');
  if (existingBg) existingBg.remove();

  const bg = document.createElement('div');
  bg.id = 'option-picker-bg';
  bg.addEventListener('click', closeOptionPicker);
  document.body.appendChild(bg);
  requestAnimationFrame(() => bg.classList.add('open'));

  const picker = document.createElement('div');
  picker.id = 'option-picker';
  picker.setAttribute('role', 'dialog');
  picker.setAttribute('aria-label', `Choose options for ${escapeHtml(item.name)}`);

  function buildOptionRowHtml(o) {
    const qty = getVariantQty(itemId, o.label);
    const inList = qty > 0;
    return `
      <div class="picker-option-row ${inList ? 'in-list' : ''}" data-base-id="${escapeHtml(itemId)}" data-label="${escapeHtml(o.label)}">
        <div class="picker-option-info">
          <span class="picker-option-label">${escapeHtml(o.label)}</span>
          ${o.desc ? `<span class="picker-option-subdesc">${escapeHtml(o.desc)}</span>` : ''}
          <span class="picker-option-price">₹${Number(o.price).toLocaleString('en-IN')}</span>
        </div>
        <div class="picker-option-action">
          ${qty === 0 ? `
            <button class="picker-add-btn" data-base-id="${escapeHtml(itemId)}" data-label="${escapeHtml(o.label)}" data-price="${escapeHtml(o.price)}" aria-label="Add ${escapeHtml(o.label)}">
              ＋ Add
            </button>
          ` : `
            <div class="picker-stepper">
              <button class="picker-step-btn picker-minus-btn" data-base-id="${escapeHtml(itemId)}" data-label="${escapeHtml(o.label)}" aria-label="Decrease quantity">
                −
              </button>
              <span class="picker-qty-num">${escapeHtml(qty)}</span>
              <button class="picker-step-btn picker-plus-btn" data-base-id="${escapeHtml(itemId)}" data-label="${escapeHtml(o.label)}" data-price="${escapeHtml(o.price)}" aria-label="Increase quantity">
                ＋
              </button>
            </div>
          `}
        </div>
      </div>
    `;
  }

  picker.innerHTML = `
    <div class="picker-handle" title="Close"></div>
    <div class="picker-header">
      <h3 class="picker-title">${escapeHtml(item.name)}</h3>
      ${item.desc ? `<p class="picker-desc">${escapeHtml(item.desc)}</p>` : ''}
    </div>
    <div class="picker-options">
      ${options.map(buildOptionRowHtml).join('')}
    </div>
    <div class="picker-footer">
      <button class="picker-done-btn">Done</button>
    </div>
  `;

  picker.addEventListener('click', (e) => {
    // 1. Done button or pull-handle closes sheet
    if (e.target.closest('.picker-done-btn') || e.target.closest('.picker-handle')) {
      closeOptionPicker();
      return;
    }

    // 2. Add button (qty goes from 0 to 1)
    const addBtn = e.target.closest('.picker-add-btn');
    if (addBtn) {
      const baseId = addBtn.getAttribute('data-base-id');
      const label  = addBtn.getAttribute('data-label');
      const price  = parseFloat(addBtn.getAttribute('data-price'));
      addVariant(baseId, label, price);
      updateRow(baseId, label);
      return;
    }

    // 3. Stepper '+' button (increments quantity)
    const plusBtn = e.target.closest('.picker-plus-btn');
    if (plusBtn) {
      const baseId = plusBtn.getAttribute('data-base-id');
      const label  = plusBtn.getAttribute('data-label');
      const price  = parseFloat(plusBtn.getAttribute('data-price'));
      addVariant(baseId, label, price);
      updateRow(baseId, label);
      return;
    }

    // 4. Stepper '-' button (decrements quantity or deselects at 0)
    const minusBtn = e.target.closest('.picker-minus-btn');
    if (minusBtn) {
      const baseId = minusBtn.getAttribute('data-base-id');
      const label  = minusBtn.getAttribute('data-label');
      decrementItem(`${baseId}:${label}`);
      updateRow(baseId, label);
      return;
    }
  });

  function updateRow(baseId, label) {
    const safeSelectorLabel = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(label) : label;
    const row = picker.querySelector(`.picker-option-row[data-label="${safeSelectorLabel}"]`);
    if (!row) return;

    const opt = options.find(o => o.label === label);
    if (!opt) return;

    const qty = getVariantQty(baseId, label);
    const actionContainer = row.querySelector('.picker-option-action');

    if (qty > 0) {
      row.classList.add('in-list');
      actionContainer.innerHTML = `
        <div class="picker-stepper">
          <button class="picker-step-btn picker-minus-btn" data-base-id="${escapeHtml(baseId)}" data-label="${escapeHtml(label)}" aria-label="Decrease quantity">
            −
          </button>
          <span class="picker-qty-num">${escapeHtml(qty)}</span>
          <button class="picker-step-btn picker-plus-btn" data-base-id="${escapeHtml(baseId)}" data-label="${escapeHtml(label)}" data-price="${escapeHtml(opt.price)}" aria-label="Increase quantity">
            ＋
          </button>
        </div>
      `;
    } else {
      row.classList.remove('in-list');
      actionContainer.innerHTML = `
        <button class="picker-add-btn" data-base-id="${escapeHtml(baseId)}" data-label="${escapeHtml(label)}" data-price="${escapeHtml(opt.price)}" aria-label="Add ${escapeHtml(label)}">
          ＋ Add
        </button>
      `;
    }
  }

  document.body.appendChild(picker);
  requestAnimationFrame(() => picker.classList.add('open'));
  acquireLock('option-picker');
  pushModalHistoryState();
}

function renderPriceBlock(item) {
  if (item.options && item.options.length > 0) {
    const chips = item.options
      .map(o => `<span class="price-chip"><span class="chip-label">${escapeHtml(o.label)}</span><span class="chip-price">₹${Number(o.price).toLocaleString('en-IN')}</span></span>`)
      .join('');
    return `<div class="price-chips">${chips}</div>`;
  }
  if (item.pour30ml != null || item.glass != null || item.bottle != null) {
    const parts = [];
    if (item.pour30ml != null) parts.push(`<span class="price-chip"><span class="chip-label">30ml</span><span class="chip-price">₹${Number(item.pour30ml).toLocaleString('en-IN')}</span></span>`);
    if (item.glass    != null) parts.push(`<span class="price-chip"><span class="chip-label">Glass</span><span class="chip-price">₹${Number(item.glass).toLocaleString('en-IN')}</span></span>`);
    if (item.bottle   != null) parts.push(`<span class="price-chip"><span class="chip-label">Bottle</span><span class="chip-price">₹${Number(item.bottle).toLocaleString('en-IN')}</span></span>`);
    if (parts.length > 0) {
      return `<div class="price-chips">${parts.join('')}</div>`;
    }
  }
  if (item.price === 'seasonal') return `<span class="price-flat">Seasonal</span>`;
  if (item.price == null) return `<span class="price-flat">—</span>`;
  return `<span class="price-flat">₹${Number(item.price).toLocaleString('en-IN')}</span>`;
}

function getOptions(item) {
  if (item.options && item.options.length > 0) return item.options;
  const variants = [];
  if (item.pour30ml != null) variants.push({ label: '30ml', price: item.pour30ml });
  if (item.glass != null)    variants.push({ label: 'Glass', price: item.glass });
  if (item.bottle != null)   variants.push({ label: 'Bottle', price: item.bottle });
  return variants;
}

function hasValidPrice(item) {
  if (typeof item.price === 'number' || item.price === 'seasonal') return true;
  return getOptions(item).length > 0;
}

function renderItem(item) {
  registerItem(item);
  _itemRegistry.set(item.id, item);

  const dietDot = item.diet === 'veg'    ? '<span class="diet-dot veg" title="Vegetarian"></span>' :
                  item.diet === 'nonveg' ? '<span class="diet-dot nonveg" title="Non-Vegetarian"></span>' : '';

  let descHtml = '';
  if (item.desc) {
    descHtml = `<div class="item-desc">${escapeHtml(item.desc)}</div>`;
  } else if (item.options) {
    const optDescs = item.options
      .filter(o => o.desc)
      .map(o => `<strong>${escapeHtml(o.label)}:</strong> ${escapeHtml(o.desc)}`);
    if (optDescs.length > 0) {
      descHtml = `<div class="item-desc">${optDescs.join('<br/>')}</div>`;
    }
  }
  const noteHtml = item.note ? `<div class="item-note">${escapeHtml(item.note)}</div>` : '';

  const options = getOptions(item);
  const hasMultipleOptions = options.length > 1 || Boolean(item.hadMultipleOptions);
  const canAdd = hasValidPrice(item);
  const priceHtml = renderPriceBlock(item);

  const actionBtnHtml = canAdd
    ? `<button class="add-btn"
         data-id="${escapeHtml(item.id)}"
         data-has-options="${hasMultipleOptions ? 'true' : 'false'}"
         aria-label="Add ${escapeHtml(item.name)} to list">＋</button>`
    : '';

  if (hasMultipleOptions || options.length === 1) {
    return `
      <div class="menu-item has-options" id="item-${escapeHtml(item.id)}">
        <div class="item-top-row">
          <h4 class="item-name">${dietDot}${escapeHtml(item.name)}</h4>
        </div>
        ${noteHtml}
        ${descHtml}
        <div class="item-bottom-row">
          <div class="item-price">${priceHtml}</div>
          ${actionBtnHtml}
        </div>
      </div>
    `;
  }

  return `
    <div class="menu-item" id="item-${escapeHtml(item.id)}">
      <div class="item-header">
        <div class="item-name-wrap">
          <h4 class="item-name">${dietDot}${escapeHtml(item.name)}</h4>
          ${noteHtml}
          ${descHtml}
        </div>
        <div class="price-action-wrapper">
          <div class="item-price">${priceHtml}</div>
          ${actionBtnHtml}
        </div>
      </div>
    </div>
  `;
}

/**
 * Builds the HTML structure, mounts it to #menu-layer, and caches child DOM refs.
 */
export function buildMenuDOM(layout) {
  const layer = document.getElementById('menu-layer');
  _scrimEl = document.getElementById('video-scrim');
  if (!layer) return;
  layer.innerHTML = '';

  layout.forEach(sec => {
    const el = document.createElement('div');
    el.className = `menu-section ${sec.type}`;
    el.id = `menu-sec-${sec.key}`;

    if (sec.type === 'group-intro') {
      el.innerHTML = `<h1 class="group-title">${escapeHtml(sec.label)}</h1>`;
    } else {
      let html = `<div class="sec-header">`;
      html += `<h2 class="section-title">${escapeHtml(sec.label)}</h2>`;
      if (sec.note) html += `<p class="section-note">${escapeHtml(sec.note)}</p>`;
      html += `</div>`;

      html += `<div class="menu-content">`;
      html += `<div class="menu-scroll-track">`;
      if (sec.subgroups) {
        sec.subgroups.forEach(sg => {
          const sgTitle = sg.subHeader || sg.label;
          html += `<div class="subgroup">`;
          if (sgTitle) html += `<h3 class="subgroup-title">${escapeHtml(sgTitle)}</h3>`;
          if (sg.note) html += `<p class="subgroup-note">${escapeHtml(sg.note)}</p>`;
          html += `<div class="items-grid">${sg.items.map(renderItem).join('')}</div>`;
          html += `</div>`;
        });
      } else if (sec.items) {
        html += `<div class="items-grid">${sec.items.map(renderItem).join('')}</div>`;
      }
      html += `</div>`;
      html += `</div>`;
      el.innerHTML = html;
    }

    el.style.display = 'none';
    layer.appendChild(el);

    sec.domElement = el;
    sec.titleEl    = el.querySelector('.group-title');
    sec.headerEl   = el.querySelector('.sec-header');
    sec.contentEl  = el.querySelector('.menu-content');
    sec.trackEl    = el.querySelector('.menu-scroll-track');
    sec._lastButtonsActive = null;
  });

  const thankYouEl = document.createElement('div');
  thankYouEl.className = 'menu-section thank-you-section';
  thankYouEl.id = 'menu-sec-thank-you';
  thankYouEl.innerHTML = `
    <div class="sec-header thank-you-header">
      <h2 class="thank-you-title">Thank You</h2>
      <div class="thank-you-ornament" aria-hidden="true">✦</div>
      <p class="thank-you-subtitle">The Nines</p>
    </div>
  `;
  thankYouEl.style.display = 'none';
  layer.appendChild(thankYouEl);
  _thankYouEl = thankYouEl;

  const hintEl = document.createElement('div');
  hintEl.id = 'swipe-hint';
  hintEl.innerHTML = `
    <span class="swipe-hint-pill">
      <span class="swipe-hint-text">Swipe to Explore</span>
      <svg class="swipe-hint-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </span>
  `;
  layer.appendChild(hintEl);

  if (!layer._boundClickListener) {
    layer._boundClickListener = true;
    layer.addEventListener('click', (e) => {
      const interactiveEl = e.target.closest('.add-btn, .qty-minus, .qty-plus');
      if (!interactiveEl) return;

      // Verify element is physically within the visible content area
      const contentEl = interactiveEl.closest('.menu-content');
      if (contentEl) {
        const cRect = contentEl.getBoundingClientRect();
        const bRect = interactiveEl.getBoundingClientRect();
        if (bRect.bottom < cRect.top - 2 || bRect.top > cRect.bottom + 2) {
          return; // Scrolled out of the visible clip container
        }
      }

      const minusSpan = e.target.closest('.qty-minus');
      if (minusSpan) {
        e.stopPropagation();
        decrementItem(minusSpan.getAttribute('data-id'));
        return;
      }

      const plusSpan = e.target.closest('.qty-plus');
      if (plusSpan) {
        e.stopPropagation();
        incrementItem(plusSpan.getAttribute('data-id'));
        return;
      }

      const btn = e.target.closest('.add-btn');
      if (!btn || btn.classList.contains('qty-active')) return;

      const id = btn.getAttribute('data-id');
      const hasOptions = btn.getAttribute('data-has-options') === 'true';

      if (hasOptions) {
        showOptionPicker(id);
      } else {
        incrementItem(id);
      }
    });
  }
}

/**
 * Measures the actual scrollable height of each menu section.
 */
export function measureMenuHeights(layout, vh) {
  layout.forEach(sec => {
    const el = sec.domElement;
    if (!el) return;

    if (sec.type === 'group-intro') {
      sec.measuredHeightPx = 0;
    } else {
      const wasVisible = el.style.display !== 'none';
      el.style.display = 'block';
      el.style.transform = 'translate3d(-50%, 0px, 0)';
      if (sec.headerEl) sec.headerEl.style.transform = 'translate3d(0, 0px, 0)';
      if (sec.contentEl) sec.contentEl.style.transform = 'translate3d(0, 0px, 0)';
      if (sec.trackEl) sec.trackEl.style.transform = 'translate3d(0, 0px, 0)';

      const h = sec.trackEl ? sec.trackEl.scrollHeight : el.offsetHeight;
      const contentTop = sec.contentEl ? sec.contentEl.getBoundingClientRect().top : 148;

      const availableSpace = Math.max(180, vh - contentTop - 96);
      if (sec.contentEl) {
        sec.contentEl.style.maxHeight = `${Math.round(availableSpace)}px`;
      }
      sec.measuredHeightPx = Math.max(0, h - availableSpace);

      if (!wasVisible) {
        el.style.display = 'none';
      }
    }
  });
}

let _lastActiveKey = null;

/**
 * Syncs the DOM elements to the current scroll state using direct GPU-composited transforms.
 */
export function updateMenuState(state, layout, vh) {
  const activeSec = state.section;

  if (_lastActiveKey !== activeSec.key) {
    layout.forEach(sec => {
      if (sec.key !== activeSec.key && sec.domElement) {
        sec.domElement.style.display = 'none';
      }
    });
    if (_thankYouEl && activeSec.index !== layout.length - 1) {
      _thankYouEl.style.display = 'none';
    }
    _lastActiveKey = activeSec.key;
  }

  const el = activeSec.domElement;
  if (!el) return;

  if (activeSec.type === 'group-intro') {
    const titleOpacity = state.introTitleOpacity !== undefined
      ? state.introTitleOpacity
      : (state.segment === 'A' ? state.entranceProgress : 0);
    const prog = state.introTitleProgress !== undefined ? state.introTitleProgress : 0;
    const driftY = (2 - prog * 18) * (vh / 100);

    if (titleOpacity > 0.005) {
      if (el.style.display !== 'block') el.style.display = 'block';
      el.style.opacity = titleOpacity.toFixed(3);
      el.style.transform = `translate3d(-50%, calc(-50% + ${driftY.toFixed(1)}px), 0)`;
      if (activeSec.titleEl) {
        activeSec.titleEl.style.opacity = '1';
        activeSec.titleEl.style.transform = 'translate3d(0, 0, 0)';
      }
    } else if (el.style.display !== 'none') {
      el.style.display = 'none';
    }

    if (activeSec._lastButtonsActive !== false) {
      el.style.pointerEvents = 'none';
      el.setAttribute('inert', '');
      activeSec._lastButtonsActive = false;
    }
  } else {
    let sectionOpacity = 0;
    let catProg = 1;
    let menuProg = 1;
    let trackY = 0;
    let sectionY = 0;

    const maxScroll = activeSec.measuredHeightPx !== undefined
      ? activeSec.measuredHeightPx
      : (activeSec.H_length || 0);

    if (state.segment === 'A') {
      catProg = state.categoryProgress;
      menuProg = state.menuProgress;
      sectionOpacity = state.entranceProgress;
      trackY = 0;
      sectionY = 0;
    } else if (state.segment === 'H') {
      catProg = 1;
      menuProg = 1;
      sectionOpacity = 1;
      trackY = -Math.min(state.holdMenuScroll, maxScroll);
      sectionY = 0;
    } else if (state.segment === 'X') {
      catProg = 1;
      menuProg = 1;
      sectionOpacity = 1 - state.exitProgress;
      trackY = -maxScroll;
      sectionY = -state.exitProgress * vh * 0.24;
    } else {
      sectionOpacity = 0;
    }

    if (sectionOpacity <= 0.004) {
      if (el.style.display !== 'none') el.style.display = 'none';
    } else {
      if (el.style.display !== 'block') el.style.display = 'block';
      el.style.opacity = sectionOpacity.toFixed(3);
      el.style.transform = `translate3d(-50%, ${sectionY.toFixed(1)}px, 0)`;

      if (activeSec.headerEl) {
        const headerOffset = (1 - catProg) * vh * 0.14;
        activeSec.headerEl.style.opacity = catProg.toFixed(3);
        activeSec.headerEl.style.transform = `translate3d(0, ${headerOffset.toFixed(1)}px, 0)`;
      }
      if (activeSec.contentEl) {
        const contentOffset = (1 - menuProg) * vh * 0.06;
        activeSec.contentEl.style.opacity = menuProg.toFixed(3);
        activeSec.contentEl.style.transform = `translate3d(0, ${contentOffset.toFixed(1)}px, 0)`;
      }
      if (activeSec.trackEl) {
        activeSec.trackEl.style.transform = `translate3d(0, ${trackY.toFixed(1)}px, 0)`;
      }
    }

    if (activeSec._lastButtonsActive !== state.buttonsActive) {
      if (state.buttonsActive) {
        el.style.pointerEvents = 'auto';
        el.removeAttribute('inert');
      } else {
        el.style.pointerEvents = 'none';
        el.setAttribute('inert', '');
      }
      activeSec._lastButtonsActive = state.buttonsActive;
    }
  }

  const isLastSec = activeSec.index === layout.length - 1;
  let thankYouProg = 0;

  if (_thankYouEl) {
    if (!isLastSec) {
      if (_thankYouEl.style.display !== 'none') _thankYouEl.style.display = 'none';
    } else {
      // Emergence begins as the last dish on the menu disappears in Segment X,
      // and completes smoothly in Segment C to hold at 100% opacity at the end of the menu.
      if (state.segment === 'X' && state.exitProgress >= 0.82) {
        thankYouProg = ((state.exitProgress - 0.82) / 0.18) * 0.25;
      } else if (state.segment === 'C') {
        const cNorm = Math.min(1, Math.max(0, state.segmentProgress / 0.38));
        thankYouProg = 0.25 + 0.75 * cNorm;
      }

      if (thankYouProg > 0.005) {
        const easedProg = thankYouProg * thankYouProg * (3 - 2 * thankYouProg);
        const offsetY = (1 - easedProg) * vh * 0.10;
        if (_thankYouEl.style.display !== 'block') _thankYouEl.style.display = 'block';
        _thankYouEl.style.opacity = easedProg.toFixed(3);
        _thankYouEl.style.transform = `translate3d(-50%, calc(-50% + ${offsetY.toFixed(1)}px), 0)`;
      } else {
        if (_thankYouEl.style.display !== 'none') _thankYouEl.style.display = 'none';
      }
    }
  }

  if (_scrimEl) {
    let scrimOpacity = 0;
    if (activeSec.type === 'group-intro') {
      scrimOpacity = 0.1 * (state.introTitleOpacity || 0);
    } else {
      if (state.segment === 'A') scrimOpacity = state.entranceProgress;
      else if (state.segment === 'H') scrimOpacity = 1;
      else if (state.segment === 'X') {
        scrimOpacity = Math.max(1 - state.exitProgress, 0.45 * thankYouProg);
      } else if (state.segment === 'C' && isLastSec) {
        scrimOpacity = 0.45 * thankYouProg;
      }
    }
    _scrimEl.style.opacity = scrimOpacity.toFixed(3);
  }

  const swipeHintEl = document.getElementById('swipe-hint');
  if (swipeHintEl) {
    if (state.sectionIndex === 0 && activeSec.type === 'group-intro' && state.segment === 'A') {
      const fadeOut = Math.max(0, Math.min(1, 1 - (state.segmentProgress / 0.24)));
      swipeHintEl.style.opacity = fadeOut.toFixed(3);
      swipeHintEl.style.display = fadeOut > 0.01 ? 'flex' : 'none';
    } else {
      swipeHintEl.style.opacity = '0';
      swipeHintEl.style.display = 'none';
    }
  }
}
