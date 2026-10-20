import { spawn } from 'child_process';
import http from 'http';

// Helper to sleep
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('[Test] Starting headless browser verification...');

  // Launch Chrome with remote debugging
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const port = 9223;

  const browser = spawn(chromePath, [
    `--remote-debugging-port=${port}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--window-size=414,896', // iPhone XR/11 viewport size
    'http://localhost:5173/?debug=1'
  ]);

  browser.on('error', err => {
    console.error('[Test] Browser spawn error:', err);
  });

  // Wait for browser to be ready
  await sleep(1500);

  // Get debug target
  let targets = [];
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json`);
    targets = await res.json();
  } catch (err) {
    console.error('[Test] Failed to connect to CDP:', err);
    browser.kill();
    return;
  }

  const pageTarget = targets.find(t => t.type === 'page');
  if (!pageTarget) {
    console.error('[Test] No page target found');
    browser.kill();
    return;
  }

  console.log('[Test] Connected to page:', pageTarget.url);
  console.log('[Test] WebSocket URL:', pageTarget.webSocketDebuggerUrl);

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

  let msgId = 1;
  const pending = new Map();
  const consoleLogs = [];

  ws.onmessage = event => {
    const data = JSON.parse(event.data);
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data.result);
      pending.delete(data.id);
    }
    if (data.method === 'Runtime.consoleAPICalled') {
      const text = data.params.args.map(a => a.value || a.description || '').join(' ');
      consoleLogs.push(`[Browser] ${data.params.type}: ${text}`);
      console.log(`[Browser Console] ${text}`);
    }
    if (data.method === 'Runtime.exceptionThrown') {
      console.error(`[Browser Exception]`, data.params.exceptionDetails);
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

  // Wait for initial load and frames to be ready
  console.log('[Test] Waiting for ready class on body...');
  await sleep(2000);

  // Evaluate ready state and initial layout
  const evalResult = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const win = window.__theNines;
        return {
          isReady: document.body.classList.contains('ready'),
          sectionsCount: win ? win.layout.length : 0,
          totalScroll: win ? win.layout[win.layout.length - 1].scrollEnd : 0,
          scrollY: window.scrollY,
          foodProgress: win ? win.loader.getProgress('food') : 0,
        };
      })()
    `,
    returnByValue: true
  });

  console.log('[Test] Initial state:', evalResult.result?.value);

  // Simulate scrolling through FOOD intro smoothly
  console.log('[Test] Simulating smooth scroll through FOOD intro (0 -> 1200px)...');
  const scrollSteps = 24;
  for (let i = 1; i <= scrollSteps; i++) {
    const targetY = (1200 / scrollSteps) * i;
    await send('Runtime.evaluate', {
      expression: `window.scrollTo(0, ${targetY});`
    });
    await sleep(35); // ~30fps scroll pacing
  }

  await sleep(500);

  const scrollState = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const hud = document.getElementById('debug-hud');
        const state = window.__theNines ? window.__theNines.renderer : null;
        return {
          scrollY: window.scrollY,
          hudText: hud ? hud.innerText.replace(/\\n/g, ' | ') : 'no HUD',
          lastDrawnKey: state ? state._lastDrawnKey : null,
          lastDrawnFrame: state ? state._lastDrawnFrame : null,
          lastDrawnFloat: state ? state._lastDrawnFloat : null,
        };
      })()
    `,
    returnByValue: true
  });

  console.log('[Test] State after intro scroll:', scrollState.result?.value);

  // Simulate scrolling into First Course (H segment with menu)
  console.log('[Test] Simulating scroll into First Course menu (hold & items)...');
  for (let i = 1; i <= 20; i++) {
    const targetY = 1200 + (1000 / 20) * i;
    await send('Runtime.evaluate', {
      expression: `window.scrollTo(0, ${targetY});`
    });
    await sleep(35);
  }

  await sleep(500);

  const firstCourseState = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const hud = document.getElementById('debug-hud');
        const sec = document.querySelector('.menu-section:not([style*="display: none"])');
        return {
          scrollY: window.scrollY,
          hudText: hud ? hud.innerText.replace(/\\n/g, ' | ') : 'no HUD',
          activeSection: sec ? sec.id : 'none',
          activeSectionOpacity: sec ? sec.style.opacity : null,
          activeSectionTransform: sec ? sec.style.transform : null,
        };
      })()
    `,
    returnByValue: true
  });

  console.log('[Test] First Course State:', firstCourseState.result?.value);

  // Close browser
  ws.close();
  browser.kill();
  console.log('[Test] Verification completed successfully!');
}

main().catch(err => {
  console.error('[Test] Fatal error:', err);
  process.exit(1);
});
