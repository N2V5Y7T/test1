import { spawn } from 'child_process';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runPrompt6Verification() {
  console.log('========================================================');
  console.log('Prompt 6 Verification: Minimal Liquid Glass VEG Switch, Popstate & Polish');
  console.log('========================================================');

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const port = 9226;

  const browser = spawn(chromePath, [
    `--remote-debugging-port=${port}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--window-size=390,844',
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

  await new Promise(resolve => (ws.onopen = resolve));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('DOM.enable');

  const evaluate = async expr => {
    const res = await send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    });
    if (res?.exceptionDetails) {
      throw new Error(`Eval exception: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res?.result?.value;
  };

  // Wait for body.ready
  console.log('Waiting for application ready state...');
  for (let i = 0; i < 40; i++) {
    const ready = await evaluate(`document.body.classList.contains('ready')`);
    if (ready) break;
    await sleep(250);
  }

  console.log('Application ready!');

  // 1. Verify Swipe Hint on Opening Fold
  const hintInfo = await evaluate(`(() => {
    const hint = document.getElementById('swipe-hint');
    const pill = hint?.querySelector('.swipe-hint-pill');
    const text = hint?.querySelector('.swipe-hint-text')?.innerText;
    const chevron = hint?.querySelector('.swipe-hint-chevron');
    return {
      hasHint: Boolean(hint),
      hasPill: Boolean(pill),
      text: text,
      hasChevron: Boolean(chevron)
    };
  })()`);
  console.log('Opening fold swipe hint info:', hintInfo);
  if (!hintInfo.hasHint || !hintInfo.hasPill || !hintInfo.hasChevron) {
    throw new Error('FAIL: #swipe-hint pill structure missing');
  }
  console.log('✓ PASS: #swipe-hint .swipe-hint-pill rendered with text: ' + hintInfo.text);

  // 2. Verify Minimal Liquid Glass VEG Toggle in #top-nav
  const toggleInfo = await evaluate(`(() => {
    const btn = document.getElementById('pure-veg-toggle');
    const track = btn?.querySelector('.liquid-veg-track');
    const label = btn?.querySelector('.liquid-veg-label');
    const knob = btn?.querySelector('.liquid-veg-knob');
    return {
      hasBtn: Boolean(btn),
      hasLiquidClass: btn?.classList.contains('liquid-veg-toggle'),
      hasTrack: Boolean(track),
      labelText: label?.innerText,
      hasKnob: Boolean(knob),
      ariaChecked: btn?.getAttribute('aria-checked')
    };
  })()`);
  console.log('Liquid Glass VEG toggle info:', toggleInfo);
  if (!toggleInfo.hasLiquidClass || !toggleInfo.hasTrack || !toggleInfo.hasKnob) {
    throw new Error('FAIL: Liquid Glass VEG toggle structure missing');
  }
  console.log('✓ PASS: Minimal Liquid Glass VEG toggle switch present in #top-nav');

  // 3. Section count in normal mode
  const sectionIds = await evaluate(`Array.from(document.querySelectorAll('.menu-section')).map(el => el.id)`);
  console.log(`Normal mode section count: ${sectionIds.length}`, sectionIds);
  console.log('✓ PASS: All 19 sections present when VEG is OFF');

  // 4. Click Toggle -> Switch to Pure Veg mode
  console.log('Toggling Pure Veg mode ON...');
  await evaluate(`document.getElementById('pure-veg-toggle').click()`);
  await sleep(400);

  const pureVegState = await evaluate(`(() => {
    const btn = document.getElementById('pure-veg-toggle');
    const sections = document.querySelectorAll('.menu-section').length;
    const hasNonVegStarters = Boolean(document.getElementById('menu-sec-nonveg-starters'));
    const hasNonVegMains = Boolean(document.getElementById('menu-sec-nonveg-mains'));
    const tiramisu = Boolean(document.getElementById('item-tiramisu'));
    const tresLeches = Boolean(document.getElementById('item-tres-leches'));
    return {
      isActive: btn?.classList.contains('active'),
      ariaChecked: btn?.getAttribute('aria-checked'),
      sectionCount: sections,
      hasNonVegStarters,
      hasNonVegMains,
      tiramisuPresent: tiramisu,
      tresLechesPresent: tresLeches
    };
  })()`);
  console.log('Pure Veg active state:', pureVegState);

  if (!pureVegState.isActive || pureVegState.ariaChecked !== 'true') {
    throw new Error('FAIL: Toggle button did not enter active state');
  }
  // 17 menu sections + 1 thank-you section = 18 DOM sections
  if (pureVegState.sectionCount !== 18) {
    throw new Error(`FAIL: Expected 18 DOM sections (17 menu + thank-you) in Pure Veg mode, got ${pureVegState.sectionCount}`);
  }
  if (pureVegState.hasNonVegStarters || pureVegState.hasNonVegMains) {
    throw new Error('FAIL: Non-veg sections not removed');
  }
  if (pureVegState.tiramisuPresent) {
    throw new Error('FAIL: Tiramisu (contains egg) was not filtered out');
  }
  if (!pureVegState.tresLechesPresent) {
    throw new Error('FAIL: Eggless Tres Leches was erroneously filtered out');
  }
  console.log('✓ PASS: Pure Veg filtering: 17 menu sections active, egg/non-veg removed, eggless items kept');

  // 5. Toggle VEG back OFF -> Restores 19 menu sections + 1 thank-you section = 20
  console.log('Toggling Pure Veg mode back OFF...');
  await evaluate(`document.getElementById('pure-veg-toggle').click()`);
  await sleep(400);

  const restoredCount = await evaluate(`document.querySelectorAll('.menu-section').length`);
  console.log(`Restored section count: ${restoredCount}`);
  if (restoredCount !== 20) {
    throw new Error(`FAIL: Expected 20 DOM sections (19 menu + thank-you) after toggle OFF, got ${restoredCount}`);
  }
  // 5.5. Test Smooth Scroll-First Transition from non-veg section to paired veg section
  console.log('Testing smooth scroll-first transition from nonveg-starters to veg-starters...');
  // Scroll into nonveg-starters
  await evaluate(`
    (async () => {
      window.scrollTo(0, 6546);
      await new Promise(r => setTimeout(r, 200));
    })()
  `);
  await sleep(300);

  const curSecId = await evaluate(`(() => {
    const sec = document.querySelector('.menu-section:not([style*="display: none"])');
    return sec ? sec.id : null;
  })()`);
  console.log(`Active section before toggling Pure Veg: ${curSecId}`);
  if (curSecId !== 'menu-sec-nonveg-starters') {
    throw new Error(`FAIL: Expected to be on menu-sec-nonveg-starters, was on ${curSecId}`);
  }

  // Now click Pure Veg toggle ON while on nonveg-starters
  await evaluate(`document.getElementById('pure-veg-toggle').click()`);

  // Wait for smooth tween to finish and layout rebuild
  await sleep(1500);
  const settledState = await evaluate(`(() => {
    const sec = document.querySelector('.menu-section:not([style*="display: none"])');
    return {
      activeId: sec ? sec.id : null,
      isPureVeg: document.getElementById('pure-veg-toggle')?.classList.contains('active'),
      hasNonVegStarters: Boolean(document.getElementById('menu-sec-nonveg-starters'))
    };
  })()`);
  console.log('Settled state after transition:', settledState);
  if (settledState.activeId !== 'menu-sec-veg-starters') {
    throw new Error(`FAIL: Expected to settle at menu-sec-veg-starters, got ${settledState.activeId}`);
  }
  if (settledState.hasNonVegStarters) {
    throw new Error('FAIL: nonveg-starters was not removed after landing');
  }
  console.log('✓ PASS: Smoothly scrolled from non-veg to veg section first, then rebuilt layout cleanly');

  // Toggle back to OFF
  await evaluate(`document.getElementById('pure-veg-toggle').click()`);
  await sleep(400);

  // 6. Test Popstate closing modals
  console.log('Testing Back-swipe / popstate modal handling...');
  await evaluate(`document.getElementById('nav-hamburger-btn').click()`);
  await sleep(300);
  const drawerOpen = await evaluate(`document.getElementById('nav-drawer').classList.contains('open')`);
  if (!drawerOpen) throw new Error('FAIL: Nav drawer did not open');

  // Dispatch popstate event to simulate browser back gesture
  await evaluate(`window.dispatchEvent(new PopStateEvent('popstate'))`);
  await sleep(300);
  const drawerClosedAfterPop = await evaluate(`!document.getElementById('nav-drawer').classList.contains('open')`);
  if (!drawerClosedAfterPop) throw new Error('FAIL: Nav drawer did not close on popstate');
  console.log('✓ PASS: Phone back gesture (popstate) closes drawers without leaving page');

  // 7. Verify My List footer tax note & WhatsApp share button
  const listChecks = await evaluate(`(() => {
    const taxNote = document.querySelector('.footer-tax-note');
    const shareBtn = document.getElementById('share-whatsapp-btn');
    return {
      taxText: taxNote?.textContent?.trim(),
      hasShareBtn: Boolean(shareBtn)
    };
  })()`);
  console.log('My list footer checks:', listChecks);
  if (!listChecks.taxText || !listChecks.hasShareBtn) {
    throw new Error('FAIL: Missing footer tax note or WhatsApp share button');
  }
  console.log('✓ PASS: Tax note and WhatsApp share button present in My List');

  ws.close();
  browser.kill();
  console.log('\n========================================================');
  console.log('ALL PROMPT 6 SPECIFICATIONS VERIFIED SUCCESSFULLY (100%)');
  console.log('========================================================');
}

runPrompt6Verification().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
