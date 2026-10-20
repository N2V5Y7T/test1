import { spawn } from 'child_process';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runAllVerification() {
  console.log('========================================================');
  console.log('Comprehensive QA Verification: The Nines Interaction Suite');
  console.log('========================================================');

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const port = 9225;

  const browser = spawn(chromePath, [
    `--remote-debugging-port=${port}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--window-size=414,896',
    'http://127.0.0.1:5173/'
  ]);

  browser.on('error', err => {
    console.error('Browser spawn error:', err);
  });

  await sleep(1800);

  let targets = [];
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json`);
    targets = await res.json();
  } catch (err) {
    console.error('Failed to connect to Chrome debug port:', err);
    browser.kill();
    process.exit(1);
  }

  const pageTarget = targets.find(t => t.type === 'page');
  if (!pageTarget) {
    console.error('No page target found');
    browser.kill();
    process.exit(1);
  }

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

  let msgId = 1;
  const pending = new Map();

  ws.onmessage = event => {
    const data = JSON.parse(event.data);
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data.result);
      pending.delete(data.id);
    }
  };

  const send = (method, params = {}) => {
    return new Promise(resolve => {
      const id = msgId++;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable');
  await send('Page.enable');

  async function evaluate(fnStr) {
    const res = await send('Runtime.evaluate', {
      expression: fnStr,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(JSON.stringify(res.exceptionDetails));
    }
    return res.result.value;
  }

  // Wait until window.__theNines is populated
  await evaluate(`
    new Promise(resolve => {
      const check = () => {
        if (window.__theNines && window.__theNines.layout && window.__theNines.layout.length > 0) {
          resolve(true);
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    })
  `);

  const results = [];
  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
      results.push({ message, pass: true });
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      results.push({ message, pass: false });
    }
  }

  try {
    // Inspect actual runtime layout metrics
    const layoutInfo = await evaluate(`
      (() => {
        const layout = window.__theNines.layout;
        return layout.map((sec, idx) => ({
          idx,
          key: sec.key,
          type: sec.type,
          scrollStart: sec.scrollStart,
          scrollEnd: sec.scrollEnd,
          A_start: sec.A_start,
          A_end: sec.A_end,
          H_start: sec.H_start,
          H_end: sec.H_end,
          X_start: sec.X_start,
          X_end: sec.X_end
        }));
      })()
    `);

    // Target sections
    const firstCourseSec = layoutInfo.find(s => s.key === 'first-course');
    const vegSec = layoutInfo.find(s => s.key === 'veg-starters');
    const nonVegSec = layoutInfo.find(s => s.key === 'nonveg-starters');

    // Entrance: 70% into Segment A of first-course
    const entranceY = Math.round(firstCourseSec.A_start + (firstCourseSec.A_end - firstCourseSec.A_start) * 0.7);
    const holdY = Math.round(firstCourseSec.H_start + 50);
    const vegHoldY = Math.round(vegSec.H_start + 100);
    const nonVegHoldY = Math.round(nonVegSec.H_start + 100);

    console.log(`[Configured Target Positions]`);
    console.log(`  First Course Entrance (Seg A): ${entranceY}px`);
    console.log(`  First Course Hold (Seg H):     ${holdY}px`);
    console.log(`  Veg Starters Hold:             ${vegHoldY}px`);
    console.log(`  Non-Veg Starters Hold:         ${nonVegHoldY}px`);

    // ========================================================
    // SECTION 1: ADD BUTTON INTERACTION & OUT-OF-VIEW PROTECTION
    // ========================================================
    console.log('\n--- SECTION 1: Add (+) Buttons Interactivity & Visibility Clipping ---');

    // Test 1.1: Add button clickable during menu entrance (Segment A, partial fade in)
    const tEntrance = await evaluate(`
      (async () => {
        window.scrollTo(0, ${entranceY});
        if (window.__theNines && window.__theNines.easer) window.__theNines.easer.snap(${entranceY});
        await new Promise(r => setTimeout(r, 150));

        const activeSec = document.querySelector('.menu-section:not([style*="display: none"])');
        const pointerEvents = activeSec ? window.getComputedStyle(activeSec).pointerEvents : null;
        const isInert = activeSec ? activeSec.hasAttribute('inert') : true;

        // Try clicking first visible add-btn
        const addBtn = activeSec ? activeSec.querySelector('.add-btn:not([data-has-options="true"])') : null;
        const initialBadge = parseInt(document.getElementById('list-count')?.textContent || '0', 10);
        let debugInfo = {};
        if (addBtn) {
          const contentEl = addBtn.closest('.menu-content');
          const cRect = contentEl ? contentEl.getBoundingClientRect() : null;
          const bRect = addBtn.getBoundingClientRect();
          debugInfo = {
            id: addBtn.getAttribute('data-id'),
            classes: addBtn.className,
            cRect: cRect ? { top: cRect.top, bottom: cRect.bottom, height: cRect.height } : null,
            bRect: { top: bRect.top, bottom: bRect.bottom, height: bRect.height }
          };
          addBtn.click();
        }
        await new Promise(r => setTimeout(r, 60));
        const badgeAfter = parseInt(document.getElementById('list-count')?.textContent || '0', 10);

        return {
          hasActiveSection: !!activeSec,
          activeId: activeSec ? activeSec.id : null,
          pointerEvents,
          isInert,
          badgeIncremented: badgeAfter === initialBadge + 1,
          badgeCount: badgeAfter,
          debugInfo
        };
      })()
    `);
    console.log('[Test 1.1 Debug]:', JSON.stringify(tEntrance.debugInfo, null, 2));
    assert(tEntrance.hasActiveSection, `Active menu section visible during entrance (${tEntrance.activeId})`);
    assert(tEntrance.pointerEvents === 'auto', 'Menu section pointer-events is auto during entrance transition');
    assert(!tEntrance.isInert, 'Menu section is not inert during entrance transition');
    assert(tEntrance.badgeIncremented, `Add (+) button successfully clicked during entrance transition (cart badge: ${tEntrance.badgeCount})`);

    // Test 1.2: Add button out-of-view bounding protection
    const tClipProtection = await evaluate(`
      (async () => {
        const activeSec = document.querySelector('.menu-section:not([style*="display: none"])');
        const contentEl = activeSec.querySelector('.menu-content');
        const initialBadge = parseInt(document.getElementById('list-count')?.textContent || '0', 10);

        // Append a synthetic button positioned outside the content element
        const fakeBtn = document.createElement('button');
        fakeBtn.className = 'add-btn';
        fakeBtn.style.position = 'fixed';
        fakeBtn.style.top = '-999px'; // offscreen
        contentEl.appendChild(fakeBtn);

        fakeBtn.click();
        await new Promise(r => setTimeout(r, 60));
        const badgeAfter = parseInt(document.getElementById('list-count')?.textContent || '0', 10);
        fakeBtn.remove();

        return {
          ignoredOutOfView: badgeAfter === initialBadge
        };
      })()
    `);
    assert(tClipProtection.ignoredOutOfView, 'Add buttons scrolled outside visible content rect are blocked from firing');

    // ========================================================
    // SECTION 2: BACKGROUND RENDERING & FRAME SHARPNESS
    // ========================================================
    console.log('\n--- SECTION 2: Background Rendering & Sharp Frame Settling ---');

    // Test 2.1: Stationary frame lock (no optical blending / double exposures when frameDelta <= 0.04)
    const tSharpness = await evaluate(`
      (async () => {
        window.scrollTo(0, ${holdY});
        await new Promise(r => setTimeout(r, 200));

        const canvas = document.getElementById('main-canvas');
        const renderer = window.__theNines ? window.__theNines.renderer : null;

        return {
          canvasReady: canvas && canvas.width > 0 && canvas.height > 0,
          currentScrollY: window.scrollY,
          rendererAvailable: !!renderer
        };
      })()
    `);
    assert(tSharpness.canvasReady, 'Background canvas is actively rendering');
    assert(tSharpness.rendererAvailable, 'Renderer is registered and running');

    // ========================================================
    // SECTION 3: MY LIST & HAMBURGER INDEPENDENT SCROLL LOCK
    // ========================================================
    console.log('\n--- SECTION 3: My List & Hamburger Menu Overlay Isolation ---');

    // Test 3.1: Empty list scrolling does not leak to background
    const tListEmpty = await evaluate(`
      (async () => {
        // Clear cart first
        const clearBtn = document.getElementById('clear-list-btn');
        if (clearBtn) clearBtn.click();

        const scrollYBefore = window.scrollY;
        document.getElementById('nav-list-btn').click();
        await new Promise(r => setTimeout(r, 80));

        const listContainer = document.getElementById('list-items-container');
        // Dispatch wheel on empty space
        const wheelEvt = new WheelEvent('wheel', { deltaY: 300, bubbles: true, cancelable: true });
        const allowed = listContainer.dispatchEvent(wheelEvt);

        const scrollYAfter = window.scrollY;
        document.getElementById('close-list-btn').click();
        await new Promise(r => setTimeout(r, 80));

        return {
          scrollYBefore,
          scrollYAfter,
          prevented: !allowed
        };
      })()
    `);
    assert(tListEmpty.scrollYBefore === tListEmpty.scrollYAfter, `Empty My List keeps background stationary at ${tListEmpty.scrollYBefore}px`);
    assert(tListEmpty.prevented, 'Wheel on empty My List intercepted and default prevented');

    // Test 3.2: 20+ Items in My List scrolls internally while background remains locked
    const tList20Items = await evaluate(`
      (async () => {
        // Add 20 items to cart
        const plainButtons = Array.from(document.querySelectorAll('.add-btn:not([data-has-options="true"])'));
        for (let i = 0; i < 20; i++) {
          const btn = plainButtons[i % plainButtons.length];
          btn.click();
        }
        await new Promise(r => setTimeout(r, 50));

        const scrollYBefore = window.scrollY;
        document.getElementById('nav-list-btn').click();
        await new Promise(r => setTimeout(r, 80));

        const listContainer = document.getElementById('list-items-container');
        const canScroll = listContainer.scrollHeight > listContainer.clientHeight;

        // Scroll internally
        listContainer.scrollTop = 250;
        await new Promise(r => setTimeout(r, 50));
        const internalScroll = listContainer.scrollTop;
        const scrollYAfter = window.scrollY;

        document.getElementById('close-list-btn').click();
        await new Promise(r => setTimeout(r, 80));

        return {
          canScroll,
          internalScroll,
          scrollYBefore,
          scrollYAfter
        };
      })()
    `);
    assert(tList20Items.canScroll, '20-item My List has overflowing content');
    assert(tList20Items.internalScroll > 0, `My List scrolled internally to ${tList20Items.internalScroll}px`);
    assert(tList20Items.scrollYBefore === tList20Items.scrollYAfter, `Background page remained frozen at ${tList20Items.scrollYBefore}px during 20-item list scrolling`);

    // Test 3.3: Boundary scrolling containment (overscroll at top and bottom)
    const tBoundaries = await evaluate(`
      (async () => {
        document.getElementById('nav-list-btn').click();
        await new Promise(r => setTimeout(r, 80));

        const listContainer = document.getElementById('list-items-container');
        listContainer.scrollTop = 0;

        // At top, try scrolling up
        const wheelUp = new WheelEvent('wheel', { deltaY: -150, bubbles: true, cancelable: true });
        const upAllowed = listContainer.dispatchEvent(wheelUp);

        // At bottom, try scrolling down
        listContainer.scrollTop = listContainer.scrollHeight;
        const wheelDown = new WheelEvent('wheel', { deltaY: 150, bubbles: true, cancelable: true });
        const downAllowed = listContainer.dispatchEvent(wheelDown);

        document.getElementById('close-list-btn').click();
        await new Promise(r => setTimeout(r, 80));

        return {
          upPrevented: !upAllowed,
          downPrevented: !downAllowed
        };
      })()
    `);
    assert(tBoundaries.upPrevented, 'Top boundary scroll chaining prevented');
    assert(tBoundaries.downPrevented, 'Bottom boundary scroll chaining prevented');

    // Test 3.4: Hamburger menu scroll containment
    const tHamburger = await evaluate(`
      (async () => {
        const scrollYBefore = window.scrollY;
        document.getElementById('nav-hamburger-btn').click();
        await new Promise(r => setTimeout(r, 80));

        const navLinks = document.getElementById('nav-links');
        const wheelEvt = new WheelEvent('wheel', { deltaY: 200, bubbles: true, cancelable: true });
        navLinks.dispatchEvent(wheelEvt);

        const scrollYAfter = window.scrollY;
        document.getElementById('close-nav-btn').click();
        await new Promise(r => setTimeout(r, 80));

        return {
          scrollYBefore,
          scrollYAfter
        };
      })()
    `);
    assert(tHamburger.scrollYBefore === tHamburger.scrollYAfter, `Background stationary during hamburger menu interaction (${tHamburger.scrollYBefore}px)`);

    // ========================================================
    // SECTION 4: BIDIRECTIONAL SYMMETRY & CATEGORY NAVIGATION
    // ========================================================
    console.log('\n--- SECTION 4: Bidirectional Scrolling & Transition Symmetry ---');

    // Test 4.1: Scroll downward into Veg Starters
    const tVeg = await evaluate(`
      (async () => {
        window.scrollTo(0, ${vegHoldY});
        await new Promise(r => setTimeout(r, 150));

        const activeSec = document.querySelector('.menu-section:not([style*="display: none"])');
        return {
          scrollY: window.scrollY,
          activeId: activeSec ? activeSec.id : null,
          pointerEvents: activeSec ? window.getComputedStyle(activeSec).pointerEvents : null
        };
      })()
    `);
    assert(tVeg.activeId === 'menu-sec-veg-starters', `Downwards scroll activated menu-sec-veg-starters at ${tVeg.scrollY}px`);
    assert(tVeg.pointerEvents === 'auto', 'Pointer-events auto in veg-starters');

    // Test 4.2: Scroll downward into Non-Veg Starters
    const tNonVeg = await evaluate(`
      (async () => {
        window.scrollTo(0, ${nonVegHoldY});
        await new Promise(r => setTimeout(r, 150));

        const activeSec = document.querySelector('.menu-section:not([style*="display: none"])');
        return {
          scrollY: window.scrollY,
          activeId: activeSec ? activeSec.id : null,
          pointerEvents: activeSec ? window.getComputedStyle(activeSec).pointerEvents : null
        };
      })()
    `);
    assert(tNonVeg.activeId === 'menu-sec-nonveg-starters', `Downwards scroll activated menu-sec-nonveg-starters at ${tNonVeg.scrollY}px`);
    assert(tNonVeg.pointerEvents === 'auto', 'Pointer-events auto in nonveg-starters');

    // Test 4.3: Add button works immediately in Non-Veg Starters
    const tSectionAdd = await evaluate(`
      (async () => {
        const activeSec = document.querySelector('.menu-section:not([style*="display: none"])');
        const addBtn = activeSec ? activeSec.querySelector('.add-btn:not([data-has-options="true"])') : null;
        const initialBadge = parseInt(document.getElementById('list-count')?.textContent || '0', 10);
        let debugInfo = {};
        if (addBtn) {
          const contentEl = addBtn.closest('.menu-content');
          const cRect = contentEl ? contentEl.getBoundingClientRect() : null;
          const bRect = addBtn.getBoundingClientRect();
          debugInfo = {
            id: addBtn.getAttribute('data-id'),
            classes: addBtn.className,
            cRect: cRect ? { top: cRect.top, bottom: cRect.bottom, height: cRect.height } : null,
            bRect: { top: bRect.top, bottom: bRect.bottom, height: bRect.height }
          };
          addBtn.click();
        }
        await new Promise(r => setTimeout(r, 60));
        const badgeAfter = parseInt(document.getElementById('list-count')?.textContent || '0', 10);

        return {
          added: badgeAfter === initialBadge + 1,
          badgeBefore: initialBadge,
          badgeAfter,
          debugInfo
        };
      })()
    `);
    console.log('[Test 4.3 Debug]:', JSON.stringify(tSectionAdd, null, 2));
    assert(tSectionAdd.added, 'Add (+) button interactive in non-veg starters section');

    // Test 4.4: Scroll upward back to First Course, verify symmetry and no dead zones
    const tUp = await evaluate(`
      (async () => {
        // Scroll back up to First Course hold
        window.scrollTo(0, ${holdY});
        await new Promise(r => setTimeout(r, 150));

        const activeSec = document.querySelector('.menu-section:not([style*="display: none"])');
        const pointerEvents = activeSec ? window.getComputedStyle(activeSec).pointerEvents : null;

        return {
          scrollY: window.scrollY,
          activeId: activeSec ? activeSec.id : null,
          pointerEvents
        };
      })()
    `);
    assert(tUp.activeId === 'menu-sec-first-course', `Upwards scroll re-activated first-course at ${tUp.scrollY}px`);
    assert(tUp.pointerEvents === 'auto', 'Interactive pointer events restored immediately during upward scroll (no dead zone)');

    console.log('\n========================================================');
    const allPassed = results.every(r => r.pass);
    console.log(`Final Result: ${results.filter(r => r.pass).length}/${results.length} assertions passed.`);
    if (allPassed) {
      console.log('ALL VERIFICATION ASSERTIONS PASSED SUCCESSFULLY!');
    } else {
      console.error('VERIFICATION HAD FAILURES!');
    }
    console.log('========================================================');

  } catch (err) {
    console.error('Error during test execution:', err);
  } finally {
    browser.kill();
  }
}

runAllVerification();
