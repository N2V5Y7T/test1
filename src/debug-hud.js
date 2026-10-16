/**
 * The Nines — Debug HUD
 * 
 * Activated via ?debug=1 query parameter.
 * Shows: scroll position, video progress p, segment (A/H/X/C/J),
 * entrance/exit progress, "+" button state, frame index, section key.
 */

export class DebugHUD {
  constructor() {
    this.enabled = new URLSearchParams(window.location.search).has('debug');
    this.el = null;
    this._fields = {};

    if (this.enabled) this._create();
  }

  _create() {
    this.el = document.createElement('div');
    this.el.id = 'debug-hud';
    Object.assign(this.el.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      zIndex: '9999',
      background: 'rgba(0,0,0,0.85)',
      color: '#0f0',
      fontFamily: 'monospace',
      fontSize: '11px',
      lineHeight: '1.4',
      padding: '8px 10px',
      pointerEvents: 'none',
      maxWidth: '280px',
      borderBottomRightRadius: '8px',
    });

    const fields = [
      'scroll', 'section', 'segment', 'p', 'frame',
      'entrance', 'category', 'menu', 'exit',
      'buttons', 'holdScroll', 'crossDissolve',
      'fps', 'memory',
    ];

    fields.forEach(f => {
      const row = document.createElement('div');
      const label = document.createElement('span');
      label.style.color = '#888';
      label.textContent = `${f}: `;
      const value = document.createElement('span');
      row.appendChild(label);
      row.appendChild(value);
      this.el.appendChild(row);
      this._fields[f] = value;
    });

    document.body.appendChild(this.el);

    // FPS counter
    this._frameCount = 0;
    this._lastFpsTime = performance.now();
    this._fps = 0;
  }

  /**
   * Update HUD with current scroll state.
   *
   * @param {object} state - from getScrollState()
   * @param {number} scrollY - raw scroll position
   * @param {number} totalScroll - total document scroll height
   */
  update(state, scrollY, totalScroll) {
    if (!this.enabled) return;

    // FPS
    this._frameCount++;
    const now = performance.now();
    if (now - this._lastFpsTime >= 1000) {
      this._fps = this._frameCount;
      this._frameCount = 0;
      this._lastFpsTime = now;
    }

    const f = this._fields;
    const sec = state.section;

    f.scroll.textContent = `${Math.round(scrollY)}px / ${Math.round(totalScroll)}px`;
    f.section.textContent = `${sec.key} [${state.sectionIndex}] "${sec.label}"`;
    f.section.style.color = sec.type === 'group-intro' ? '#ff0' : '#0f0';

    f.segment.textContent = state.segment;
    f.segment.style.color = {
      A: '#4af', H: '#0f0', X: '#fa4', C: '#aaf', J: '#f4a',
    }[state.segment] || '#fff';

    f.p.textContent = `${state.videoProgress.toFixed(3)} (frame ${state.frameIndex}/${sec.frameCount - 1})`;
    f.frame.textContent = `seg ${state.segmentProgress.toFixed(3)}`;

    f.entrance.textContent = state.entranceProgress.toFixed(2);
    f.category.textContent = state.categoryProgress.toFixed(2);
    f.menu.textContent = state.menuProgress.toFixed(2);
    f.exit.textContent = state.exitProgress.toFixed(2);

    f.buttons.textContent = state.buttonsActive ? '✅ ACTIVE' : '❌ inactive';
    f.buttons.style.color = state.buttonsActive ? '#0f0' : '#f44';

    f.holdScroll.textContent = state.segment === 'H'
      ? `${Math.round(state.holdMenuScroll)}px / ${Math.round(sec.H_length)}px`
      : '—';

    f.crossDissolve.textContent = state.crossDissolve
      ? `→ ${state.crossDissolve.nextSection.key} (${(state.crossDissolve.progress * 100).toFixed(0)}%)`
      : '—';

    f.fps.textContent = `${this._fps} fps`;
    f.fps.style.color = this._fps >= 55 ? '#0f0' : this._fps >= 30 ? '#ff0' : '#f00';

    // Memory estimate (rough)
    f.memory.textContent = `~${Math.round(performance.memory?.usedJSHeapSize / 1024 / 1024 || 0)}MB heap`;
  }
}
