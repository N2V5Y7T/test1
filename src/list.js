/**
 * The Nines — My List Manager
 *
 * State: selectedItems Map — id → { item, qty, baseId, variantLabel }
 * Single source of truth for all quantity state, persisted to localStorage (Spec §6).
 */

import { acquireLock, releaseLock, registerOverlayCloseHandler } from './scroll-lock.js';
import { escapeHtml } from './utils.js';

const STORAGE_KEY = 'the_nines_my_list_v1';

// id → { item, qty, baseId, variantLabel }
const selectedItems = new Map();

// id → item object (populated during menu build)
const allItemsMap = new Map();

export function registerItem(item) {
  const existing = allItemsMap.get(item.id);
  if (!existing || (item.options?.length || 0) >= (existing.options?.length || 0)) {
    allItemsMap.set(item.id, item);
  }
}

let _modalHistoryPushed = false;
let _closingFromPopState = false;

export function isAnyModalOpen() {
  if (typeof document === 'undefined') return false;
  const navDrawer = document.getElementById('nav-drawer');
  const listDrawer = document.getElementById('list-drawer');
  const picker = document.getElementById('option-picker');
  return Boolean(
    (navDrawer && navDrawer.classList.contains('open')) ||
    (listDrawer && listDrawer.classList.contains('open')) ||
    (picker && picker.classList.contains('open'))
  );
}

export function pushModalHistoryState() {
  if (typeof window === 'undefined' || _modalHistoryPushed) return;
  try {
    window.history.pushState({ theNinesModal: true }, '');
    _modalHistoryPushed = true;
  } catch (_) {}
}

export function popModalHistoryStateIfNeeded() {
  if (typeof window === 'undefined') return;
  if (_closingFromPopState) return;
  if (_modalHistoryPushed && !isAnyModalOpen()) {
    _modalHistoryPushed = false;
    try {
      window.history.back();
    } catch (_) {}
  }
}

function syncModalScrollLock() {
  releaseLock('list-drawer');
  releaseLock('nav-drawer');
  releaseLock('option-picker');
}

export function syncAllMenuButtons() {
  selectedItems.forEach((entry, id) => {
    if (id.includes(':') || entry.variantLabel) {
      syncVariantMenuButton(entry.baseId || id.split(':')[0]);
    } else {
      syncMenuButton(id);
    }
  });
}

// ── Internal helpers ────────────────────────────────────────────

function getPriceNumber(item) {
  if (typeof item.price === 'number') return item.price;
  if (item.options && item.options.length > 0 && typeof item.options[0].price === 'number') {
    return item.options[0].price;
  }
  if (typeof item.pour30ml === 'number') return item.pour30ml;
  if (typeof item.glass === 'number') return item.glass;
  if (typeof item.bottle === 'number') return item.bottle;
  return 0;
}

function saveToStorage() {
  if (typeof localStorage === 'undefined') return;
  try {
    const serialized = [];
    selectedItems.forEach((entry, id) => {
      serialized.push({
        id,
        qty: entry.qty,
        baseId: entry.baseId || entry.item.id,
        variantLabel: entry.variantLabel || null,
      });
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
  } catch (_) {
    // Ignore storage errors in private browsing mode
  }
}

/**
 * Strict variant price lookup.
 * Returns numeric price if and only if label matches an authentic variant,
 * otherwise returns null (no fallback to base item price).
 */
function lookupStrictVariantPrice(baseItem, label) {
  if (!baseItem || !label || typeof label !== 'string') return null;
  if (Array.isArray(baseItem.options)) {
    const found = baseItem.options.find(o => o && o.label === label);
    if (found && typeof found.price === 'number') return found.price;
  }
  if (label === '30ml' && typeof baseItem.pour30ml === 'number') return baseItem.pour30ml;
  if (label === 'Glass' && typeof baseItem.glass === 'number') return baseItem.glass;
  if (label === 'Bottle' && typeof baseItem.bottle === 'number') return baseItem.bottle;
  return null;
}

export function restoreFromStorage() {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;

    parsed.forEach(record => {
      if (!record || typeof record !== 'object' || !record.id || typeof record.id !== 'string') return;
      const rawQty = parseInt(record.qty, 10);
      if (isNaN(rawQty) || rawQty < 1) return;
      // Clamp restored quantities to safe integers in [1, 99]
      const safeQty = Math.min(99, Math.max(1, rawQty));

      if (record.variantLabel && record.baseId) {
        if (typeof record.variantLabel !== 'string' || typeof record.baseId !== 'string') return;
        const baseItem = allItemsMap.get(record.baseId);
        if (!baseItem) return;

        const variantPrice = lookupStrictVariantPrice(baseItem, record.variantLabel);
        if (variantPrice == null) return; // Reject tampered variant

        const expectedId = `${record.baseId}:${record.variantLabel}`;
        if (record.id !== expectedId) return; // Reject tampered ID

        const variantItem = {
          ...baseItem,
          id: expectedId,
          name: `${baseItem.name} (${record.variantLabel})`,
          price: variantPrice,
        };
        allItemsMap.set(expectedId, variantItem);
        selectedItems.set(expectedId, {
          item: variantItem,
          qty: safeQty,
          baseId: record.baseId,
          variantLabel: record.variantLabel,
        });
        syncVariantMenuButton(record.baseId);
      } else {
        const item = allItemsMap.get(record.id);
        if (!item) return;
        selectedItems.set(record.id, { item, qty: safeQty, baseId: item.id, variantLabel: null });
        syncMenuButton(record.id);
      }
    });
    updateHUD(false);
    renderDrawer();
  } catch (_) {
    // Ignore malformed or blocked storage
  }
}

/**
 * Find and update the menu's add-btn / qty-control for a given plain item id.
 */
function syncMenuButton(id) {
  if (typeof document === 'undefined') return;
  const safeSelectorId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id;
  const btn = document.querySelector(`.add-btn[data-id="${safeSelectorId}"]`);
  if (!btn) return;

  if (btn.getAttribute('data-has-options') === 'true') {
    syncVariantMenuButton(id);
    return;
  }

  const entry = selectedItems.get(id);
  const qty = entry ? entry.qty : 0;
  const baseItem = allItemsMap.get(id);

  if (qty === 0) {
    btn.className = 'add-btn';
    btn.innerHTML = '＋';
    btn.setAttribute('aria-label', `Add ${baseItem ? escapeHtml(baseItem.name) : 'item'} to list`);
    return;
  }

  btn.className = 'add-btn qty-active';
  btn.innerHTML = `
    <span class="qty-minus" data-id="${escapeHtml(id)}" aria-label="Decrease quantity">−</span>
    <span class="qty-num">${escapeHtml(qty)}</span>
    <span class="qty-plus"  data-id="${escapeHtml(id)}" aria-label="Increase quantity">＋</span>
  `;
}

/**
 * Update the menu button for a multi-option dish so the user sees how many
 * variants of that dish are currently in My List.
 */
function syncVariantMenuButton(baseId) {
  if (typeof document === 'undefined') return;
  const safeSelectorBaseId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(baseId) : baseId;
  const btn = document.querySelector(`.add-btn[data-id="${safeSelectorBaseId}"][data-has-options="true"]`);
  if (!btn) return;

  let totalVariantQty = 0;
  selectedItems.forEach((entry, key) => {
    if (key === baseId || key.startsWith(`${baseId}:`)) {
      totalVariantQty += entry.qty;
    }
  });

  if (totalVariantQty > 0) {
    btn.classList.add('added');
    btn.innerHTML = `<span class="variant-count-badge">${Number(totalVariantQty)}</span>`;
  } else {
    btn.classList.remove('added');
    btn.innerHTML = '＋';
  }
}

export function getVariantQty(baseId, variantLabel) {
  const entry = selectedItems.get(`${baseId}:${variantLabel}`);
  return entry ? entry.qty : 0;
}

export function getItemOptionsTotalQty(baseId) {
  let total = 0;
  selectedItems.forEach((entry, key) => {
    if (key === baseId || key.startsWith(`${baseId}:`)) {
      total += entry.qty;
    }
  });
  return total;
}

// ── Public API ──────────────────────────────────────────────────

export function incrementItem(id) {
  const item = allItemsMap.get(id);
  if (!item) return;

  if (selectedItems.has(id)) {
    selectedItems.get(id).qty += 1;
  } else {
    selectedItems.set(id, { item, qty: 1, baseId: id, variantLabel: null });
  }

  syncMenuButton(id);
  saveToStorage();
  updateHUD(true);
  renderDrawer();
}

export function decrementItem(id) {
  if (!selectedItems.has(id)) return;

  const entry = selectedItems.get(id);
  const baseId = entry.baseId || (id.includes(':') ? id.split(':')[0] : id);
  entry.qty -= 1;

  if (entry.qty <= 0) {
    selectedItems.delete(id);
  }

  if (id.includes(':')) {
    syncVariantMenuButton(baseId);
  } else {
    syncMenuButton(id);
  }
  saveToStorage();
  updateHUD(false);
  renderDrawer();
}

export function toggleItem(id) {
  if (selectedItems.has(id)) {
    const entry = selectedItems.get(id);
    const baseId = entry.baseId || (id.includes(':') ? id.split(':')[0] : id);
    selectedItems.delete(id);
    if (id.includes(':')) syncVariantMenuButton(baseId);
    else syncMenuButton(id);
  } else {
    const item = allItemsMap.get(id);
    if (!item) return;
    selectedItems.set(id, { item, qty: 1, baseId: id, variantLabel: null });
    syncMenuButton(id);
  }

  saveToStorage();
  updateHUD(true);
  renderDrawer();
}

export function addVariant(baseId, variantLabel, variantPrice) {
  const baseItem = allItemsMap.get(baseId);
  if (!baseItem) return;

  const variantId = `${baseId}:${variantLabel}`;
  const variantItem = {
    ...baseItem,
    id: variantId,
    name: `${baseItem.name} (${variantLabel})`,
    price: variantPrice,
  };

  if (selectedItems.has(variantId)) {
    selectedItems.get(variantId).qty += 1;
  } else {
    selectedItems.set(variantId, {
      item: variantItem,
      qty: 1,
      baseId,
      variantLabel,
    });
  }

  allItemsMap.set(variantId, variantItem);
  syncVariantMenuButton(baseId);
  saveToStorage();
  updateHUD(true);
  renderDrawer();
}

export function clearList() {
  const keys = [...selectedItems.keys()];
  selectedItems.clear();
  keys.forEach(key => {
    if (key.includes(':')) {
      syncVariantMenuButton(key.split(':')[0]);
    } else {
      syncMenuButton(key);
    }
  });
  saveToStorage();
  updateHUD(false);
  renderDrawer();
}

export function updateHUD(animate = true) {
  if (typeof document === 'undefined') return;
  let count = 0;
  selectedItems.forEach(entry => { count += entry.qty; });

  const badge = document.getElementById('list-count');
  if (badge) {
    badge.textContent = count;
    if (count > 0) {
      badge.classList.add('has-items');
      if (animate && typeof badge.animate === 'function') {
        badge.animate([
          { transform: 'scale(1)' },
          { transform: 'scale(1.22)' },
          { transform: 'scale(1)' }
        ], { duration: 260 });
      }
    } else {
      badge.classList.remove('has-items');
    }
  }
}

export function renderDrawer() {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('list-items-container');
  const totalEl   = document.getElementById('list-total-sum');
  const clearBtn  = document.getElementById('clear-list-btn');
  const shareBtn  = document.getElementById('share-whatsapp-btn');
  if (!container || !totalEl) return;

  if (clearBtn) {
    clearBtn.style.display = selectedItems.size > 0 ? 'inline-flex' : 'none';
  }
  if (shareBtn) {
    shareBtn.style.display = selectedItems.size > 0 ? 'inline-flex' : 'none';
  }

  if (selectedItems.size === 0) {
    container.innerHTML = '<p class="empty-list">Your list is empty.</p>';
    totalEl.textContent = '₹0';
    return;
  }

  let html  = '';
  let total = 0;

  selectedItems.forEach((entry, id) => {
    const { item, qty } = entry;
    const unitPrice = getPriceNumber(item);
    const lineTotal = unitPrice * qty;
    total += lineTotal;

    const priceDisplay = unitPrice > 0
      ? `₹${unitPrice.toLocaleString('en-IN')}`
      : (item.price === 'seasonal' ? 'Seasonal' : '');

    const lineTotalDisplay = unitPrice > 0
      ? `₹${lineTotal.toLocaleString('en-IN')}`
      : (item.price === 'seasonal' ? 'Seasonal' : '');

    html += `
      <div class="list-item" data-id="${escapeHtml(id)}">
        <div class="list-item-info">
          <span class="list-item-name">${escapeHtml(item.name)}</span>
          ${priceDisplay ? `<span class="list-item-unit-price">Unit: ${escapeHtml(priceDisplay)}</span>` : ''}
          ${lineTotalDisplay ? `<span class="list-item-price">${escapeHtml(lineTotalDisplay)}</span>` : ''}
        </div>
        <div class="list-item-qty-control">
          <button class="list-qty-btn list-qty-minus" data-id="${escapeHtml(id)}" aria-label="Decrease quantity">−</button>
          <span class="list-qty-num">${escapeHtml(qty)}</span>
          <button class="list-qty-btn list-qty-plus"  data-id="${escapeHtml(id)}" aria-label="Increase quantity">＋</button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  totalEl.textContent = `₹${total.toLocaleString('en-IN')}`;
}

export function initListUI() {
  if (typeof document === 'undefined') return;
  const drawer   = document.getElementById('list-drawer');
  const overlay  = document.getElementById('drawer-overlay');
  const openBtn  = document.getElementById('nav-list-btn');
  const closeBtn = document.getElementById('close-list-btn');
  const clearBtn = document.getElementById('clear-list-btn');
  const shareBtn = document.getElementById('share-whatsapp-btn');

  function openDrawer() {
    renderDrawer();
    drawer.classList.add('open');
    overlay.classList.add('open');
    acquireLock('list-drawer');
    pushModalHistoryState();
  }
  function closeDrawer() {
    drawer.classList.remove('open');
    const navDrawer = document.getElementById('nav-drawer');
    if (!navDrawer || !navDrawer.classList.contains('open')) {
      overlay.classList.remove('open');
    }
    releaseLock('list-drawer');
    popModalHistoryStateIfNeeded();
  }

  registerOverlayCloseHandler('list-drawer', closeDrawer);

  openBtn.addEventListener('click', openDrawer);
  closeBtn.addEventListener('click', closeDrawer);
  overlay.addEventListener('click', closeDrawer);
  if (clearBtn) {
    clearBtn.addEventListener('click', () => clearList());
  }

  if (shareBtn) {
    shareBtn.addEventListener('click', () => {
      if (selectedItems.size === 0) return;
      const lines = ['*My Order at The Nines:*', ''];
      let total = 0;
      selectedItems.forEach((entry) => {
        const { item, qty } = entry;
        const unitPrice = getPriceNumber(item);
        const lineTotal = unitPrice * qty;
        total += lineTotal;
        const priceStr = unitPrice > 0 ? ` - ₹${lineTotal.toLocaleString('en-IN')}` : '';
        lines.push(`• ${qty}x ${item.name}${priceStr}`);
      });
      lines.push('');
      lines.push(`*Estimated Total:* ₹${total.toLocaleString('en-IN')}`);
      lines.push('_(Taxes & service charge extra as applicable)_');
      const text = encodeURIComponent(lines.join('\n'));
      window.open(`https://wa.me/?text=${text}`, '_blank');
    });
  }

  if (!window._theNinesPopStateBound) {
    window._theNinesPopStateBound = true;
    window.addEventListener('popstate', () => {
      const navDrawer = document.getElementById('nav-drawer');
      const listDrawer = document.getElementById('list-drawer');
      const overlayEl = document.getElementById('drawer-overlay');
      const picker = document.getElementById('option-picker');
      const pickerBg = document.getElementById('option-picker-bg');

      const hadOpenModal = Boolean(
        (navDrawer && navDrawer.classList.contains('open')) ||
        (listDrawer && listDrawer.classList.contains('open')) ||
        picker
      );

      if (hadOpenModal) {
        _closingFromPopState = true;
        _modalHistoryPushed = false;
        if (navDrawer) navDrawer.classList.remove('open');
        if (listDrawer) listDrawer.classList.remove('open');
        if (overlayEl) overlayEl.classList.remove('open');
        if (picker) {
          picker.classList.remove('open');
          setTimeout(() => picker.remove(), 260);
        }
        if (pickerBg) {
          pickerBg.classList.remove('open');
          setTimeout(() => pickerBg.remove(), 260);
        }
        syncModalScrollLock();
        _closingFromPopState = false;
      }
    });
  }

  restoreFromStorage();

  document.getElementById('list-items-container').addEventListener('click', (e) => {
    const minusBtn = e.target.closest('.list-qty-minus');
    const plusBtn  = e.target.closest('.list-qty-plus');

    if (minusBtn) {
      const id = minusBtn.getAttribute('data-id');
      decrementItem(id);
    } else if (plusBtn) {
      const id = plusBtn.getAttribute('data-id');
      if (id.includes(':')) {
        if (selectedItems.has(id)) {
          const entry = selectedItems.get(id);
          entry.qty += 1;
          syncVariantMenuButton(entry.baseId || id.split(':')[0]);
          saveToStorage();
          updateHUD(true);
          renderDrawer();
        }
      } else {
        incrementItem(id);
      }
    }
  });
}
