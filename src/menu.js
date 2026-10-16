/**
 * The Nines — DOM Menu Builder & State Updater
 *
 * Generates the HTML for the menu, measures actual rendered heights,
 * and syncs GPU-accelerated CSS transforms/opacities to the current scroll state
 * without mutating inherited CSS variables on large DOM subtrees.
 */

import {
  registerItem,
  addVariant,
  incrementItem,
  decrementItem,
  getVariantQty,
} from './list.js';

const _itemRegistry = new Map();
let _scrimEl = null;

function closeOptionPicker() {
  const picker = document.getElementById('option-picker');
  const bg = document.getElementById('option-picker-bg');
  if (picker) {
    picker.classList.remove('open');
    setTimeout(() => picker.remove(), 240);
  }
  if (bg) {
    bg.classList.remove('open');
    setTimeout(() => bg.remove(), 240);
  }
}

/**
 * Shows a mobile bottom sheet letting the user pick a variant
 * (e.g. Veg / Chicken / Prawns or 30ml / Bottle) before adding to the list.
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
  picker.setAttribute('aria-label', `Choose option for ${item.name}`);

  picker.innerHTML = `
    <div class="picker-handle"></div>
    <h3 class="picker-title">${item.name}</h3>
    ${item.desc ? `<p class="picker-desc">${item.desc}</p>` : ''}
    <div class="picker-options">
      ${options.map(o => {
        const currentQty = getVariantQty(itemId, o.label);
        return `
          <button class="picker-option-btn ${currentQty > 0 ? 'selected' : ''}" data-base-id="${itemId}" data-label="${o.label}" data-price="${o.price}">
            <div class="picker-option-info">
              <span class="picker-option-label">${o.label}${currentQty > 0 ? ` · In list (${currentQty})` : ''}</span>
              ${o.desc ? `<span class="picker-option-subdesc">${o.desc}</span>` : ''}
            </div>
            <span class="picker-option-price">₹${Number(o.price).toLocaleString('en-IN')}</span>
          </button>
        `;
      }).join('')}
    </div>
  `;

  let picked = false;
  picker.addEventListener('click', (e) => {
    if (picked) return;
    const btn = e.target.closest('.picker-option-btn');
    if (!btn) return;
    picked = true;

    const baseId = btn.getAttribute('data-base-id');
    const label  = btn.getAttribute('data-label');
    const price  = parseFloat(btn.getAttribute('data-price'));

    addVariant(baseId, label, price);
    btn.classList.add('selected');

    setTimeout(closeOptionPicker, 220);
  });

  document.body.appendChild(picker);
  requestAnimationFrame(() => picker.classList.add('open'));
}

function renderPriceBlock(item) {
  if (item.options && item.options.length > 0) {
    const chips = item.options
      .map(o => `<span class="price-chip"><span class="chip-label">${o.label}</span><span class="chip-price">₹${Number(o.price).toLocaleString('en-IN')}</span></span>`)
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

  // Support both item-level desc and option-level desc (e.g. Tunisian, Grilled)
  let descText = item.desc || '';
  if (!descText && item.options) {
    const optDescs = item.options
      .filter(o => o.desc)
      .map(o => `<strong>${o.label}:</strong> ${o.desc}`);
    if (optDescs.length > 0) {
      descText = optDescs.join('<br/>');
    }
  }
  const descHtml = descText ? `<div class="item-desc">${descText}</div>` : '';
  const noteHtml = item.note ? `<div class="item-note">${item.note}</div>` : '';

  const options = getOptions(item);
  const hasMultipleOptions = options.length > 1;
  const canAdd = hasValidPrice(item);
  const priceHtml = renderPriceBlock(item);

  const actionBtnHtml = canAdd
    ? `<button class="add-btn"
         data-id="${item.id}"
         data-has-options="${hasMultipleOptions ? 'true' : 'false'}"
         aria-label="Add ${item.name} to list">＋</button>`
    : '';

  if (hasMultipleOptions || options.length === 1) {
    return `
      <div class="menu-item has-options" id="item-${item.id}">
        <div class="item-top-row">
          <h4 class="item-name">${dietDot}${item.name}</h4>
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
    <div class="menu-item" id="item-${item.id}">
      <div class="item-header">
        <div class="item-name-wrap">
          <h4 class="item-name">${dietDot}${item.name}</h4>
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
      el.innerHTML = `<h1 class="group-title">${sec.label}</h1>`;
    } else {
      let html = `<div class="sec-header">`;
      html += `<h2 class="section-title">${sec.label}</h2>`;
      if (sec.note) html += `<p class="section-note">${sec.note}</p>`;
      html += `</div>`;

      html += `<div class="menu-content">`;
      html += `<div class="menu-scroll-track">`;
      if (sec.subgroups) {
        sec.subgroups.forEach(sg => {
          const sgTitle = sg.subHeader || sg.label;
          html += `<div class="subgroup">`;
          if (sgTitle) html += `<h3 class="subgroup-title">${sgTitle}</h3>`;
          if (sg.note) html += `<p class="subgroup-note">${sg.note}</p>`;
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

    // Cache child element references once to avoid querySelector calls and CSS var inheritance during scroll
    sec.domElement = el;
    sec.titleEl    = el.querySelector('.group-title');
    sec.headerEl   = el.querySelector('.sec-header');
    sec.contentEl  = el.querySelector('.menu-content');
    sec.trackEl    = el.querySelector('.menu-scroll-track');
    sec._lastButtonsActive = null;
  });

  if (!layer._boundClickListener) {
    layer._boundClickListener = true;
    layer.addEventListener('click', (e) => {
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

      // Reserve bottom space for the bottom tab strip + safe area (96px)
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

      // Apply entrance transforms directly to cached child layers (zero CSS variable subtree invalidation)
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

    // Only mutate DOM attributes when button interactivity actually changes
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

  if (_scrimEl) {
    let scrimOpacity = 0;
    if (activeSec.type === 'group-intro') {
      scrimOpacity = 0.1 * (state.introTitleOpacity || 0);
    } else {
      if (state.segment === 'A') scrimOpacity = state.entranceProgress;
      else if (state.segment === 'H') scrimOpacity = 1;
      else if (state.segment === 'X') scrimOpacity = 1 - state.exitProgress;
    }
    _scrimEl.style.opacity = scrimOpacity.toFixed(3);
  }
}
