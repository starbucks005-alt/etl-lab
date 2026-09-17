/* leadership-table-smoke.js -- drive the shared classroom table in a real
   browser, with every Netlify function stubbed.

   NOT in tests/, on purpose: everything in there runs with plain node and no
   install, and this needs Playwright and a local server. It lives here so the
   next person changing leadership-room.html can prove the room still works
   before a class finds out, rather than because it runs on its own.

   To run it:
       cd <repo> && python3 -m http.server 8765 &
       npm install playwright     (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1, and
                                   CHROMIUM_PATH=..., if a browser is already
                                   on the machine)
       node tools/leadership-table-smoke.js

   What it checks in one pass: the host opens a table and gets a code and a
   link, a student arriving with that code is told whose table it is and who is
   at it, a name is required, the seat survives a reload rather than handing out
   a second one, voices default to off for a guest, and a table the host closed
   is not resumed afterwards. Nothing here touches the real database.
*/

const { chromium } = require('playwright');
const path = process.env.TABLE_URL || 'http://127.0.0.1:8765/leadership-room.html';

// Every function call the page makes, answered the way the real ones would.
const ROUTES = {
  'leadership-table-open': { room_id: 'r1', seat_token: 'AHT-hosthosthosthosthost', code: 'PXNW44CN', code_display: 'PXNW-44CN', join_url: 'https://emerging-tech-lab.com/leadership-room.html?table=PXNW44CN', cursor: null, expires_at: new Date(Date.now() + 86400000).toISOString() },
  'leadership-table-poll': { messages: [], roster: [{ name: 'Dr. O', is_host: true }, { name: 'Dr. Wooley', is_host: false }], active_agents: ['mlk', 'csking'], agent_state: {}, busy: false, closed: false },
  'leadership-table-say': { ok: true },
  'leadership-table-close': { ok: true },
  'leadership-table-poll-closed': { messages: [], roster: [], active_agents: [], busy: false, closed: true },
};

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.route('**/.netlify/functions/*', async (route) => {
    const name = route.request().url().split('/').pop().split('?')[0];
    const body = route.request().postDataJSON() || {};
    let payload = ROUTES[name] || { ok: true };
    if (name === 'leadership-table-join') {
      payload = body.peek
        ? { peek: true, host_name: 'Dr. O', leaders: ['Martin Luther King Jr.', 'Coretta Scott King'], seats_taken: 1 }
        : { room_id: 'r1', seat_token: 'AHT-guestguestguestguestguest', active_agents: ['mlk', 'csking'], leaders: ['Martin Luther King Jr.', 'Coretta Scott King'], host_name: 'Dr. O', joined_at: new Date().toISOString() };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });

  // ── the host ────────────────────────────────────────────────────────────
  await page.goto(path);
  await page.click('.picker-grid .pick:nth-child(7)').catch(() => {});
  const cards = await page.$$('.picker-grid > *');
  await cards[6].click(); await cards[5].click();            // two leaders
  await page.click('#startBtn');
  console.log('chat open:', await page.isVisible('#log'));
  await page.click('#bringBtn');
  console.log('share panel:', await page.isVisible('#sharePanel'));
  await page.fill('#hostName', 'Dr. O');
  await page.click('#openTableBtn');
  await page.waitForTimeout(400);
  console.log('code shown :', await page.textContent('#shareCode'));
  console.log('link shown :', (await page.textContent('#shareUrl')).slice(0, 60));
  await page.waitForTimeout(300);
  console.log('roster     :', await page.textContent('#shareRoster'));
  await page.fill('#input', 'Dr. King, welcome.');
  await page.click('#send');
  await page.waitForTimeout(300);
  console.log('host can still send, input cleared:', (await page.inputValue('#input')) === '');

  // ── a student with the code ─────────────────────────────────────────────
  const guest = await browser.newPage();
  guest.on('pageerror', (e) => errors.push('GUEST PAGE ERROR: ' + e.message));
  await guest.route('**/.netlify/functions/*', async (route) => {
    const name = route.request().url().split('/').pop().split('?')[0];
    const body = route.request().postDataJSON() || {};
    let payload = ROUTES[name] || { ok: true };
    if (name === 'leadership-table-join') {
      payload = body.peek
        ? { peek: true, host_name: 'Dr. O', leaders: ['Martin Luther King Jr.', 'Coretta Scott King'], seats_taken: 1 }
        : { room_id: 'r1', seat_token: 'AHT-guestguestguestguestguest', active_agents: ['mlk', 'csking'], leaders: ['Martin Luther King Jr.', 'Coretta Scott King'], host_name: 'Dr. O', joined_at: new Date().toISOString() };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  await guest.goto(path + '?table=PXNW-44CN');
  await guest.waitForTimeout(400);
  console.log('\nguest sees the door:', await guest.isVisible('#joinPanel'));
  console.log('guest is told whose:', await guest.textContent('#joinWho'));
  console.log('picker hidden for guest:', !(await guest.isVisible('#picker')));
  await guest.click('#joinBtn');
  console.log('name refused politely:', await guest.textContent('#joinNote'));
  await guest.fill('#joinName', 'Dr. Wooley');
  await guest.click('#joinBtn');
  await guest.waitForTimeout(400);
  console.log('guest seated  :', await guest.isVisible('#log'), '| door closed:', !(await guest.isVisible('#joinPanel')));
  console.log('guest voices off by default:', (await guest.getAttribute('#voiceToggle', 'aria-pressed')) === 'false');
  console.log('leaders along the top:', await guest.textContent('#avatars'));

  // ── the student's phone locks and she reloads ───────────────────────────
  await guest.reload();
  await guest.waitForTimeout(900);
  console.log('\nafter a reload, still seated:', await guest.isVisible('#log'), '| picker still hidden:', !(await guest.isVisible('#picker')));
  const log = await guest.textContent('#log');
  console.log('and told so:', log.includes('back at the table'));

  // ── the host closes the class ───────────────────────────────────────────
  await page.click('#closeTableBtn');
  await page.waitForTimeout(300);
  console.log('host closed it:', (await page.textContent('#log')).includes('code no longer works'));
  await page.reload();
  await page.waitForTimeout(500);
  console.log('a closed table is not resumed:', await page.isVisible('#picker'));

  console.log('\nerrors:', errors.length ? errors : 'none');
  await browser.close();
})();
