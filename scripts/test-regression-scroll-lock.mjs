import { spawn } from 'child_process';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runRegressionTests() {
  console.log('====================================================');
  console.log('Running Regression Tests: Overlay Scroll Lock');
  console.log('====================================================');

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const port = 9224;

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
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/' });

  // Wait for initial render
  await sleep(2000);

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

  const results = [];
  function assert(condition, message) {
    if (condition) {
      console.log(`  PASS: ${message}`);
      results.push({ message, pass: true });
    } else {
      console.error(`  FAIL: ${message}`);
      results.push({ message, pass: false });
    }
  }

  try {
    // Wait for page and nav elements to load
    for (let i = 0; i < 50; i++) {
      try {
        const isReady = await evaluate(`!!document.getElementById('nav-list-btn')`);
        if (isReady) break;
      } catch (e) {}
      await sleep(150);
    }

    // Scroll page down a bit first so savedScrollY > 0
    await evaluate(`
      window.scrollTo(0, 1200);
      new Promise(r => setTimeout(r, 100));
    `);
    const initialScrollY = await evaluate(`window.scrollY`);
    console.log(`[Setup] Scrolled page to ${initialScrollY}px`);

    // --- TEST 1: Open My List and swipe/wheel over its empty space ---
    console.log('\n--- Test 1: Empty My List background stationary ---');
    const t1 = await evaluate(`
      (async () => {
        // Open list
        document.getElementById('nav-list-btn').click();
        await new Promise(r => setTimeout(r, 100));

        const scrollYBefore = window.scrollY;
        const listContainer = document.getElementById('list-items-container');

        // Dispatch wheel event on empty space
        const wheelEvt = new WheelEvent('wheel', { deltaY: 200, bubbles: true, cancelable: true });
        const wheelAllowed = listContainer.dispatchEvent(wheelEvt);

        // Dispatch touch gestures on empty space
        const touch1 = new Touch({ identifier: 1, target: listContainer, clientX: 200, clientY: 400 });
        const touch2 = new Touch({ identifier: 1, target: listContainer, clientX: 200, clientY: 200 }); // swipe up
        listContainer.dispatchEvent(new TouchEvent('touchstart', { touches: [touch1], bubbles: true, cancelable: true }));
        const touchAllowed = listContainer.dispatchEvent(new TouchEvent('touchmove', { touches: [touch2], bubbles: true, cancelable: true }));

        const scrollYAfter = window.scrollY;
        const isLocked = document.body.classList.contains('overlay-scroll-locked');

        // Close list
        document.getElementById('close-list-btn').click();
        await new Promise(r => setTimeout(r, 100));

        return {
          scrollYBefore,
          scrollYAfter,
          wheelPrevented: !wheelAllowed,
          touchPrevented: !touchAllowed,
          isLocked
        };
      })()
    `);
    assert(t1.scrollYBefore === t1.scrollYAfter, `Background scroll stayed at ${t1.scrollYBefore}px`);
    assert(t1.wheelPrevented, 'Wheel event over empty space was intercepted and prevented');
    assert(t1.touchPrevented, 'Touchmove over empty space was intercepted and prevented');

    // --- TEST 2: Long My List (12 items) scrolls internally, background stationary ---
    console.log('\n--- Test 2: Long My List scrolls only within panel ---');
    const t2 = await evaluate(`
      (async () => {
        // Add 12 items to cart (using plain items without option sheet)
        const addBtns = Array.from(document.querySelectorAll('.add-btn:not([data-has-options="true"])')).slice(0, 12);
        addBtns.forEach(b => b.click());
        await new Promise(r => setTimeout(r, 50));

        // Open list
        document.getElementById('nav-list-btn').click();
        await new Promise(r => setTimeout(r, 100));

        const listContainer = document.getElementById('list-items-container');
        const scrollHeight = listContainer.scrollHeight;
        const clientHeight = listContainer.clientHeight;
        const hasOverflow = scrollHeight > clientHeight;

        const scrollYBefore = window.scrollY;
        const listScrollBefore = listContainer.scrollTop;

        // Scroll inside list
        listContainer.scrollTop = 150;
        await new Promise(r => setTimeout(r, 50));

        const listScrollAfter = listContainer.scrollTop;
        const scrollYAfter = window.scrollY;

        document.getElementById('close-list-btn').click();
        await new Promise(r => setTimeout(r, 100));

        return {
          hasOverflow,
          listScrollBefore,
          listScrollAfter,
          scrollYBefore,
          scrollYAfter
        };
      })()
    `);
    assert(t2.hasOverflow, 'My List content height exceeds panel height with 12 items');
    assert(t2.listScrollAfter > t2.listScrollBefore, `List content scrolled internally from ${t2.listScrollBefore} to ${t2.listScrollAfter}px`);
    assert(t2.scrollYBefore === t2.scrollYAfter, `Background page remained stationary at ${t2.scrollYBefore}px`);

    // --- TEST 3: Hamburger menu swipe/wheel over header/empty space ---
    console.log('\n--- Test 3: Hamburger menu empty space background stationary ---');
    const t3 = await evaluate(`
      (async () => {
        document.getElementById('nav-hamburger-btn').click();
        await new Promise(r => setTimeout(r, 100));

        const navHeader = document.querySelector('#nav-drawer .drawer-header');
        const scrollYBefore = window.scrollY;

        const wheelEvt = new WheelEvent('wheel', { deltaY: 150, bubbles: true, cancelable: true });
        const wheelAllowed = navHeader.dispatchEvent(wheelEvt);

        const touch1 = new Touch({ identifier: 2, target: navHeader, clientX: 100, clientY: 50 });
        const touch2 = new Touch({ identifier: 2, target: navHeader, clientX: 100, clientY: 20 });
        navHeader.dispatchEvent(new TouchEvent('touchstart', { touches: [touch1], bubbles: true, cancelable: true }));
        const touchAllowed = navHeader.dispatchEvent(new TouchEvent('touchmove', { touches: [touch2], bubbles: true, cancelable: true }));

        const scrollYAfter = window.scrollY;
        document.getElementById('close-nav-btn').click();
        await new Promise(r => setTimeout(r, 100));

        return {
          scrollYBefore,
          scrollYAfter,
          wheelPrevented: !wheelAllowed,
          touchPrevented: !touchAllowed
        };
      })()
    `);
    assert(t3.scrollYBefore === t3.scrollYAfter, 'Background did not move during header gesture');
    assert(t3.wheelPrevented, 'Wheel on header was intercepted');
    assert(t3.touchPrevented, 'Touchmove on header was intercepted');

    // --- TEST 4: Scroll through hamburger menu ---
    console.log('\n--- Test 4: Scroll through hamburger navigation links ---');
    const t4 = await evaluate(`
      (async () => {
        document.getElementById('nav-hamburger-btn').click();
        await new Promise(r => setTimeout(r, 100));

        const navLinks = document.getElementById('nav-links');
        const scrollYBefore = window.scrollY;
        const navScrollBefore = navLinks.scrollTop;

        navLinks.scrollTop = 100;
        await new Promise(r => setTimeout(r, 50));

        const navScrollAfter = navLinks.scrollTop;
        const scrollYAfter = window.scrollY;

        document.getElementById('close-nav-btn').click();
        await new Promise(r => setTimeout(r, 100));

        return {
          navScrollBefore,
          navScrollAfter,
          scrollYBefore,
          scrollYAfter
        };
      })()
    `);
    assert(t4.scrollYBefore === t4.scrollYAfter, 'Background remained stationary during hamburger scroll');

    // --- TEST 5: Boundary scroll containment (top and bottom limits) ---
    console.log('\n--- Test 5: Boundary overscroll containment ---');
    const t5 = await evaluate(`
      (async () => {
        document.getElementById('nav-list-btn').click();
        await new Promise(r => setTimeout(r, 100));

        const listContainer = document.getElementById('list-items-container');
        listContainer.scrollTop = 0; // at top

        // Scroll UP when already at top (deltaY < 0 in wheel, finger moving down in touch)
        const wheelTop = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
        const wheelTopAllowed = listContainer.dispatchEvent(wheelTop);

        const touch1 = new Touch({ identifier: 3, target: listContainer, clientX: 100, clientY: 200 });
        const touch2 = new Touch({ identifier: 3, target: listContainer, clientX: 100, clientY: 250 }); // moving down
        listContainer.dispatchEvent(new TouchEvent('touchstart', { touches: [touch1], bubbles: true, cancelable: true }));
        const touchTopAllowed = listContainer.dispatchEvent(new TouchEvent('touchmove', { touches: [touch2], bubbles: true, cancelable: true }));

        // Scroll to bottom
        listContainer.scrollTop = listContainer.scrollHeight;
        const wheelBottom = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
        const wheelBottomAllowed = listContainer.dispatchEvent(wheelBottom);

        const touch3 = new Touch({ identifier: 4, target: listContainer, clientX: 100, clientY: 250 });
        const touch4 = new Touch({ identifier: 4, target: listContainer, clientX: 100, clientY: 200 }); // moving up
        listContainer.dispatchEvent(new TouchEvent('touchstart', { touches: [touch3], bubbles: true, cancelable: true }));
        const touchBottomAllowed = listContainer.dispatchEvent(new TouchEvent('touchmove', { touches: [touch4], bubbles: true, cancelable: true }));

        document.getElementById('close-list-btn').click();
        await new Promise(r => setTimeout(r, 100));

        return {
          wheelTopPrevented: !wheelTopAllowed,
          touchTopPrevented: !touchTopAllowed,
          wheelBottomPrevented: !wheelBottomAllowed,
          touchBottomPrevented: !touchBottomAllowed
        };
      })()
    `);
    assert(t5.wheelTopPrevented, 'Top boundary wheel scroll chaining prevented');
    assert(t5.touchTopPrevented, 'Top boundary touch overscroll prevented');
    assert(t5.wheelBottomPrevented, 'Bottom boundary wheel scroll chaining prevented');
    assert(t5.touchBottomPrevented, 'Bottom boundary touch overscroll prevented');

    // --- TEST 6: Close overlay and confirm normal scrolling resumes ---
    console.log('\n--- Test 6: Normal scrolling resumes upon overlay closure ---');
    const t6 = await evaluate(`
      (async () => {
        const isLockedBefore = document.body.classList.contains('overlay-scroll-locked');
        window.scrollTo(0, 1500);
        await new Promise(r => setTimeout(r, 100));
        const scrollY = window.scrollY;
        return { isLockedBefore, scrollY };
      })()
    `);
    assert(!t6.isLockedBefore, 'Lock removed from body upon overlay closure');
    assert(t6.scrollY === 1500, `Page smoothly scrolled to ${t6.scrollY}px`);

    // --- TEST 7: Repeated open/close cycles (no stuck scroll lock) ---
    console.log('\n--- Test 7: Repeated open/close cycles ---');
    const t7 = await evaluate(`
      (async () => {
        const openList = document.getElementById('nav-list-btn');
        const closeList = document.getElementById('close-list-btn');
        const openNav = document.getElementById('nav-hamburger-btn');
        const closeNav = document.getElementById('close-nav-btn');

        for (let i = 0; i < 5; i++) {
          openList.click();
          await new Promise(r => setTimeout(r, 20));
          closeList.click();
          await new Promise(r => setTimeout(r, 20));
          openNav.click();
          await new Promise(r => setTimeout(r, 20));
          closeNav.click();
          await new Promise(r => setTimeout(r, 20));
        }

        return {
          hasLockClass: document.body.classList.contains('overlay-scroll-locked'),
          scrollY: window.scrollY
        };
      })()
    `);
    assert(!t7.hasLockClass, 'No stuck scroll lock after 10 rapid open/close cycles');

    // --- TEST 8: Coordinated multi-overlay locking ---
    console.log('\n--- Test 8: Coordinated multi-overlay locking ---');
    const t8 = await evaluate(`
      (async () => {
        // Open Nav Drawer
        document.getElementById('nav-hamburger-btn').click();
        await new Promise(r => setTimeout(r, 50));
        const lock1 = document.body.classList.contains('overlay-scroll-locked');

        // Open List Drawer while Nav Drawer is open
        document.getElementById('nav-list-btn').click();
        await new Promise(r => setTimeout(r, 50));
        const lock2 = document.body.classList.contains('overlay-scroll-locked');

        // Close Nav Drawer only
        document.getElementById('close-nav-btn').click();
        await new Promise(r => setTimeout(r, 50));
        const lockAfterNavClose = document.body.classList.contains('overlay-scroll-locked');

        // Close List Drawer
        document.getElementById('close-list-btn').click();
        await new Promise(r => setTimeout(r, 50));
        const lockAfterAllClose = document.body.classList.contains('overlay-scroll-locked');

        return {
          lock1,
          lock2,
          lockAfterNavClose,
          lockAfterAllClose
        };
      })()
    `);
    assert(t8.lock1, 'Lock active when hamburger opened');
    assert(t8.lock2, 'Lock active when both opened');
    assert(t8.lockAfterNavClose, 'Lock STAYS ACTIVE when one closes while other remains open');
    assert(!t8.lockAfterAllClose, 'Lock released only when all overlays have closed');

    // --- TEST 9: Background video stationary during gestures in overlay ---
    console.log('\n--- Test 9: Video frame stationary during overlay interaction ---');
    const t9 = await evaluate(`
      (async () => {
        window.scrollTo(0, 800);
        await new Promise(r => setTimeout(r, 80));

        const scrollYBefore = window.scrollY;

        document.getElementById('nav-list-btn').click();
        await new Promise(r => setTimeout(r, 80));

        // Simulate 20 aggressive wheel events inside list
        const list = document.getElementById('list-items-container');
        for (let i = 0; i < 20; i++) {
          list.dispatchEvent(new WheelEvent('wheel', { deltaY: (i % 2 === 0 ? 100 : -100), bubbles: true, cancelable: true }));
        }
        await new Promise(r => setTimeout(r, 80));

        const scrollYAfter = window.scrollY;

        document.getElementById('close-list-btn').click();
        await new Promise(r => setTimeout(r, 80));

        return { scrollYBefore, scrollYAfter };
      })()
    `);
    assert(t9.scrollYBefore === t9.scrollYAfter, `Page scroll remained completely frozen at ${t9.scrollYBefore}px throughout 20 aggressive gestures`);

    // --- TEST 10: Existing cart operations and links work ---
    console.log('\n--- Test 10: Cart increment, decrement, and clear functions ---');
    const t10 = await evaluate(`
      (async () => {
        document.getElementById('nav-list-btn').click();
        await new Promise(r => setTimeout(r, 60));

        // Test plus button
        const plusBtn = document.querySelector('.list-qty-plus');
        const numEl = document.querySelector('.list-qty-num');
        const qtyBefore = parseInt(numEl ? numEl.textContent : '0', 10);
        if (plusBtn) plusBtn.click();
        await new Promise(r => setTimeout(r, 40));
        const qtyAfterPlus = parseInt(document.querySelector('.list-qty-num')?.textContent || '0', 10);

        // Test minus button
        const minusBtn = document.querySelector('.list-qty-minus');
        if (minusBtn) minusBtn.click();
        await new Promise(r => setTimeout(r, 40));
        const qtyAfterMinus = parseInt(document.querySelector('.list-qty-num')?.textContent || '0', 10);

        // Test clear
        const clearBtn = document.getElementById('clear-list-btn');
        if (clearBtn) clearBtn.click();
        await new Promise(r => setTimeout(r, 40));
        const totalText = document.getElementById('list-total-sum')?.textContent;

        document.getElementById('close-list-btn').click();

        return {
          qtyBefore,
          qtyAfterPlus,
          qtyAfterMinus,
          totalText
        };
      })()
    `);
    assert(t10.qtyAfterPlus === t10.qtyBefore + 1, `Cart increment works: ${t10.qtyBefore} -> ${t10.qtyAfterPlus}`);
    assert(t10.qtyAfterMinus === t10.qtyBefore, `Cart decrement works: ${t10.qtyAfterPlus} -> ${t10.qtyAfterMinus}`);
    assert(t10.totalText === '₹0', 'Cart clear works: total is ₹0');

    console.log('\n====================================================');
    const allPass = results.every(r => r.pass);
    console.log(`Summary: ${results.filter(r => r.pass).length}/${results.length} tests passed.`);
    if (allPass) {
      console.log('ALL REGRESSION TESTS PASSED!');
    } else {
      console.error('SOME TESTS FAILED!');
    }
    console.log('====================================================');
  } catch (err) {
    console.error('Error during test execution:', err);
  } finally {
    browser.kill();
  }
}

runRegressionTests();
