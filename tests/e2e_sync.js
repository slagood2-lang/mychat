// 브라우저 맞춤 점검: 진짜 PC 서버(chart_server.py) 하나에 브라우저 두 개(크롬 · Claude 앱 흉내)를 붙여
// 관심목록·도구/차트 설정·그림·도구별 마지막 모양이 같아지는지, 고르기 창, 종목·간격은 브라우저마다 따로인지 확인
// 준비: npm i playwright lightweight-charts@5.2.1 · 실행: node tests/e2e_sync.js  (포트 8000이 비어 있어야 함)
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const fs = require('fs'), path = require('path'), os = require('os'), { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..'), HTML = path.join(ROOT, 'index.html');
const LWC = fs.readFileSync(path.join(path.dirname(require.resolve('lightweight-charts/package.json')), 'dist/lightweight-charts.standalone.production.js'), 'utf8');
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const APP = 'https://slagood2-lang.github.io/mychat/';
const NOW = Date.parse('2026-11-26T07:27:00Z'), H4 = 144e5;

// 사장님 크롬 같은 데이터 (29종목 · 그림 · 차트 색 · 즐겨찾기 도구)
const CHROME_LIST = ['BINANCE:BTCUSDT', 'COINBASE:BTCUSD', 'YAHOO:NDAQ', 'BINANCE:ETHUSDT', 'BINANCE:SOLUSDT', 'BINANCE:XRPUSDT', '###선물·지수', 'YAHOO:CL=F', 'YAHOO:SI=F', 'YAHOO:GC=F', 'YAHOO:NQ=F', 'YAHOO:^GSPC', 'YAHOO:DX-Y.NYB',
  '###한국', 'YAHOO:005930.KS', 'YAHOO:000660.KS', '###새 구역', 'YAHOO:NVDA', 'YAHOO:BLK', 'YAHOO:TSLA', 'YAHOO:ANT', 'YAHOO:SOXL', 'YAHOO:AAPL', 'YAHOO:SOXS', 'YAHOO:CRWV', 'YAHOO:NKE', 'YAHOO:INTC', 'YAHOO:MRK', 'YAHOO:NFLX', 'YAHOO:PFE', 'YAHOO:MRNA', 'YAHOO:PLTR'];
const CHROME = { lists: [{ name: '내 관심목록', items: CHROME_LIST }, { name: '바이낸스', layout: 'full', items: ['YAHOO:NVDA'] }], active: 0, tf: '4h', key: 'BINANCE:BTCUSDT', view: 'chart', sideTab: 'wl',
  v2: 1, v3: 1, v4: 1, v5: 1, magnet: false, log: true, theme: 'dark', drawLock: false,
  chartCfg: { bg: '', border: true, crosshair: 'normal', down: '#f23645', gridH: false, gridV: false, up: '#089981', rightOffset: 12, scale: 'log', type: 'candle', wick: true, lastLine: true, legendOHLC: true, legendValues: true, watermark: false, indLabels: false, scalePriceOnly: true },
  favTools: ['hline', 'hray', 'fib', 'rect', 'measure', 'fibext', 'fibchannel', 'fibtime', 'channel', 'cycles', 'trend', 'daterange', 'dpr', 'vwap'],
  toolSel: { fibs: 'fib', lines: 'trend', pen: 'highlighter' } };
const CLAUDE = { lists: [{ name: '내 관심목록', items: ['BINANCE:BTCUSDT', 'BINANCE:ETHUSDT', '###미국', 'BINANCE:NVDAUSDT'] }], active: 0, tf: '1d', key: 'BINANCE:ETHUSDT', view: 'chart', sideTab: 'wl', v2: 1, v3: 1, v4: 1, v5: 1 };
const T = s => Date.parse(s) / 1000;
const DRAW_BTC = [{ id: 'tr1', type: 'trend', pane: 'main', p: [{ t: T('2026-11-10T00:00:00Z'), p: 60000 }, { t: T('2026-11-20T00:00:00Z'), p: 62000 }], style: { color: '#ff0000', w: 3, dash: false } }];

async function startServer(dir) {
  const p = spawn('python3', ['chart_server.py', '--port', '8000', '--no-browser', '--no-us-universe'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  for (let i = 0; i < 50; i++) { try { const r = await fetch('http://127.0.0.1:8000/api/ping'); if (r.ok) return p; } catch {} await sleep(200); }
  throw new Error('PC 서버가 안 켜짐\n' + out);
}
const serverState = async () => (await fetch('http://127.0.0.1:8000/api/sync?since=0', { headers: { 'X-MC-Sync': '1' } })).json();

async function openPage(browser, ua, seed, drawings, label) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, userAgent: ua });
  const page = await ctx.newPage();
  page.errs = [];
  page.on('pageerror', e => page.errs.push(e.message));
  await page.routeWebSocket(/.*/, () => {});
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    const json = (o, st = 200) => route.fulfill({ status: st, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
    if (u.href.startsWith(APP)) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(HTML) });
    if (u.href.includes('lightweight-charts')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: LWC });
    if (u.host === 'localhost:8000') return route.continue();
    if (u.host === 'fapi.binance.com' && u.pathname.endsWith('/exchangeInfo')) return json({ symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'NVDAUSDT'].map(s => ({ symbol: s, baseAsset: s.replace('USDT', ''), quoteAsset: 'USDT', status: 'TRADING', contractType: 'PERPETUAL', underlyingType: 'COIN', pricePrecision: 1, onboardDate: Date.parse('2019-09-09'), filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.10' }] })) });
    if (u.host === 'fapi.binance.com' && u.pathname.endsWith('/klines')) {
      const lim = Math.min(+u.searchParams.get('limit') || 500, 1500), end = Math.floor(Math.min(+u.searchParams.get('endTime') || NOW, NOW) / H4) * H4, out = [];
      for (let t = end - (lim - 1) * H4; t <= end; t += H4) { const o = 60000 + 3000 * Math.sin(t / H4 / 40), c = o + 400 * Math.sin(t / H4 / 3); out.push([t, o.toFixed(1), (Math.max(o, c) + 300).toFixed(1), (Math.min(o, c) - 300).toFixed(1), c.toFixed(1), '100', t + H4 - 1, '1', 10, '0', '0', '0']); }
      return json(out);
    }
    return json({}, 404);
  });
  await page.addInitScript(([seed, drawings]) => {
    if (localStorage.getItem('seeded')) return; localStorage.setItem('seeded', '1');
    localStorage.setItem('mc.useLocal', '1');
    localStorage.setItem('mc.v1', JSON.stringify(seed));
    for (const [k, v] of Object.entries(drawings || {})) localStorage.setItem('mc.d.' + k, JSON.stringify(v));
  }, [seed, drawings]);
  await page.goto(APP);
  await page.waitForFunction(() => typeof CH !== 'undefined' && CH.data && CH.data.N > 50, null, { timeout: 30000 });
  page.label = label;
  return page;
}
const stOf = page => page.evaluate(() => JSON.parse(localStorage.getItem('mc.v1')));
const syncState = page => page.evaluate(() => UI.SYNC.state);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcsync-'));
  for (const f of ['chart_server.py', 'us_universe.py', 'us_market.py']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  let srv = await startServer(dir);
  // 실제 크롬은 처음 한 번 「로컬 네트워크 접근 허용」을 물음 → 시험에서는 그 확인을 끔
  const browser = await pw.chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights'] });
  const UA_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
  const UA_CLAUDE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Claude/1.0 Chrome/142.0.0.0 Electron/45.3.3 Safari/537.36';
  try {
    // 1) 크롬이 먼저: 서버가 비어 있으면 크롬 것을 올림
    const A = await openPage(browser, UA_CHROME, CHROME, { 'BINANCE:BTCUSDT': DRAW_BTC }, '크롬');
    await A.waitForFunction(() => UI.SYNC.state === 'on', null, { timeout: 15000 }).catch(() => {});
    let S = await serverState();
    const sl = S.sec['st.lists'] && JSON.parse(S.sec['st.lists'].v);
    ok((await syncState(A)) === 'on' && sl && sl[0].items.length === CHROME_LIST.length && S.sec['st.lists'].by === '크롬', `크롬 첫 연결 → 서버가 비어 있어 크롬 것 올림 (관심목록 ${sl && sl[0].items.length}칸, 올린 브라우저: ${S.sec['st.lists'] && S.sec['st.lists'].by})`);
    ok(S.sec['d.BINANCE:BTCUSDT'] && JSON.parse(S.sec['d.BINANCE:BTCUSDT'].v)[0].id === 'tr1' && !S.sec['st.key'] && !S.sec['st.tf'] && !S.sec['st.view'], '그림도 올라감 · 지금 보는 종목·간격·화면은 안 올림');
    ok(!Object.keys(S.sec).some(k => /finnhub|alpaca/i.test(k)), '키(Finnhub·Alpaca)는 안 올림');

    // 2) Claude 앱 브라우저: 다른 목록 → 어느 쪽 쓸지 물음 (서버 쪽 추천)
    const B = await openPage(browser, UA_CLAUDE, CLAUDE, {}, 'Claude 앱');
    await B.waitForSelector('#syServer', { timeout: 15000 });
    const ask = await B.evaluate(() => ({ txt: document.getElementById('dlg').innerText, rec: document.querySelector('#syServer').classList.contains('primary') }));
    ok(ask.rec && /크롬/.test(ask.txt) && /29종목/.test(ask.txt) && /Claude 앱/.test(ask.txt) && /3종목/.test(ask.txt), '처음 연결: 고르기 창 (PC 서버=크롬 29종목 vs 이 브라우저=Claude 앱 3종목, 서버 쪽 추천)');
    if (!/3종목/.test(ask.txt)) console.log(ask.txt);
    await Promise.all([B.waitForNavigation({ timeout: 20000 }), B.click('#syServer')]);
    await B.waitForFunction(() => typeof CH !== 'undefined' && CH.data && CH.data.N > 50 && UI.SYNC.state === 'on', null, { timeout: 30000 });
    let b = await stOf(B);
    ok(JSON.stringify(b.lists) === JSON.stringify(CHROME.lists), `「PC 서버 것 쓰기」 → Claude 앱 관심목록이 크롬과 같음 (${b.lists[0].items.length}칸, 목록 ${b.lists.length}개)`);
    ok(JSON.stringify(b.chartCfg) === JSON.stringify(CHROME.chartCfg) && JSON.stringify(b.favTools) === JSON.stringify(CHROME.favTools) && b.magnet === false && JSON.stringify(b.toolSel) === JSON.stringify(CHROME.toolSel), '차트 색·즐겨찾기 도구 14개·자석·도구 고름도 같음');
    ok(b.key === 'BINANCE:ETHUSDT' && b.tf === '1d', `지금 보는 종목·간격은 Claude 앱 것 그대로 (${b.key} ${b.tf})`);
    ok(await B.evaluate(() => (JSON.parse(localStorage.getItem('mc.d.BINANCE:BTCUSDT') || '[]')[0] || {}).id === 'tr1'), '크롬에서 그린 BTC 그림이 Claude 앱에도 있음');
    ok(await B.evaluate(() => !!document.querySelector('.row[data-key="YAHOO:PLTR"]')), '관심목록 화면에 PLTR 줄 보임');
    ok(await B.waitForFunction(() => /크롬에서 바꾼/.test((document.querySelector('.toast') || {}).textContent || ''), null, { timeout: 5000 }).then(() => true).catch(() => false), '새로 연 뒤 「크롬에서 바꾼 관심목록·설정을 불러왔습니다」 안내');

    // 3) 크롬에서 종목 추가 → Claude 앱으로 돌아오면(창 전환) 바로 보임 (새로 열지 않고)
    await A.evaluate(() => { UI.ST.lists[0].items.push('YAHOO:AMD'); UI.save(); });
    await sleep(4500);
    S = await serverState();
    ok(JSON.parse(S.sec['st.lists'].v)[0].items.includes('YAHOO:AMD'), '크롬에서 AMD 추가 → 3초 안에 PC 서버에 올라감');
    const navB = B.waitForNavigation({ timeout: 3000 }).then(() => true).catch(() => false);
    await B.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await B.waitForFunction(() => JSON.parse(localStorage.getItem('mc.v1')).lists[0].items.includes('YAHOO:AMD'), null, { timeout: 8000 }).catch(() => {});
    b = await stOf(B);
    ok(b.lists[0].items.includes('YAHOO:AMD') && !(await navB), 'Claude 앱으로 돌아오면 AMD 추가됨 (관심목록만 바뀌면 새로 열지 않고 그 자리에서)');
    ok(await B.evaluate(() => UI.ST.lists[0].items.includes('YAHOO:AMD')), '화면 쪽 관심목록(메모리)도 바뀜');

    // 4) Claude 앱에서 BTC 그림 추가 → 크롬(BTC 보는 중)으로 돌아오면 그림이 바로 보임
    await B.evaluate(async () => { await UI.openChart('BINANCE:BTCUSDT'); });
    await B.waitForFunction(() => CH.state.key === 'BINANCE:BTCUSDT' && CH.data.N > 50, null, { timeout: 15000 });
    await B.evaluate(() => { CH.drawings.list.push({ id: 'hl2', type: 'hline', pane: 'main', p: [{ t: 1764000000, p: 61000 }], style: { color: '#00ff00', w: 2, dash: false } }); CH.saveDrawings(); });
    await sleep(4500);
    await A.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await A.waitForFunction(() => CH.drawings.list.some(d => d.id === 'hl2'), null, { timeout: 8000 }).catch(() => {});
    ok(await A.evaluate(() => CH.drawings.list.some(d => d.id === 'hl2') && CH.drawings.list.some(d => d.id === 'tr1')), 'Claude 앱에서 그린 수평선이 크롬 차트에 바로 나타남 (기존 추세선도 그대로)');

    // 5) 도구별 마지막 모양: 크롬에서 추세선 두께 6 · 색 바꿈 → 새 추세선이 그 모양 → Claude 앱도 같게
    await A.evaluate(() => { const d = CH.drawings.list.find(x => x.id === 'tr1'); CH.selectDrawing(d); });
    await A.waitForSelector('#selbar:not([hidden]) select[data-k="w"]');
    const wOpts = await A.$$eval('#selbar select[data-k="w"] option', o => o.map(x => +x.value));
    await A.selectOption('#selbar select[data-k="w"]', '6');
    await A.evaluate(() => { const i = document.querySelector('#selbar input[data-k="color"]'); i.value = '#ff9800'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); });
    const tsA = await A.evaluate(() => UI.ST.toolStyle && UI.ST.toolStyle.trend);
    ok(wOpts.includes(10) && tsA && tsA.w === 6 && tsA.color === '#ff9800', `빠른 막대 두께 1~10 · 추세선 두께 6·주황 기억 (${JSON.stringify(tsA)})`);
    const nd = await A.evaluate(() => { const d = CH.addDrawing('trend', { t: 1763000000, p: 59000 }); d.p.push({ t: 1763500000, p: 60000 }); return d.style; });
    ok(nd.w === 6 && nd.color === '#ff9800', `새 추세선이 마지막 모양으로 그려짐 (두께 ${nd.w}, ${nd.color})`);
    await sleep(4500);
    const navB2 = B.waitForNavigation({ timeout: 15000 }).then(() => true).catch(() => false);
    await B.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    ok(await navB2, 'Claude 앱으로 돌아오면 설정(도구 모양)이 바뀐 것이라 한 번 새로 열림');
    await B.waitForFunction(() => typeof CH !== 'undefined' && CH.data && CH.data.N > 50 && UI.SYNC.state === 'on', null, { timeout: 30000 });
    const ndB = await B.evaluate(() => { const d = CH.addDrawing('trend', { t: 1763000000, p: 59000 }); return d.style; });
    ok(ndB.w === 6 && ndB.color === '#ff9800', `Claude 앱에서도 새 추세선이 같은 모양 (두께 ${ndB.w}, ${ndB.color})`);

    // 6) 글자 크기 300까지
    const sizes = await A.evaluate(() => { const d = CH.addDrawing('text', { t: 1763000000, p: 61000 }); d.text = '테스트'; CH.selectDrawing(d); return new Promise(r => setTimeout(() => r([...document.querySelectorAll('#selbar select[data-k="size"] option')].map(o => +o.value)), 200)); });
    ok(sizes.includes(40) && sizes.includes(300) && Math.max(...sizes) === 300, `글자 크기 고르기 ${sizes[0]}~${Math.max(...sizes)} (40 포함)`);

    // 7) 새 브라우저(엣지 흉내, 기본값): 고르기 창에서 「나중에」 → 서버의 크롬 목록은 그대로
    const E = await openPage(browser, UA_CHROME.replace('Safari/537.36', 'Safari/537.36 Edg/142.0.0.0'), { lists: [{ name: '내 관심목록', items: ['BINANCE:BTCUSDT'] }], active: 0, tf: '1d', key: 'BINANCE:BTCUSDT', view: 'chart', v2: 1, v3: 1, v4: 1, v5: 1 }, {}, '엣지');
    await E.waitForSelector('#syLater', { timeout: 15000 });
    const eTxt = await E.evaluate(() => document.getElementById('dlg').innerText);
    await E.click('#syLater'); await sleep(4500);
    S = await serverState();
    ok(/엣지/.test(eTxt) && JSON.parse(S.sec['st.lists'].v)[0].items.length === CHROME_LIST.length + 1 && (await syncState(E)) === 'skip', '엣지(새 브라우저) 「나중에」 → 서버의 관심목록은 그대로 (덮어쓰지 않음)');
    await E.context().close();

    // 8) PC 서버를 껐다 켜도 그대로 · 그 사이 바꾼 것은 다시 켜지면 올라감
    srv.kill(); await sleep(800);
    await A.evaluate(() => { UI.ST.lists[0].items.push('YAHOO:COIN'); UI.save(); });
    await sleep(3500);
    srv = await startServer(dir);
    await A.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    for (let i = 0; i < 40; i++) { S = await serverState(); if (JSON.parse(S.sec['st.lists'].v)[0].items.includes('YAHOO:COIN')) break; await sleep(1000); }   // PC 서버 확인(15초마다) 뒤 다시 맞춤
    ok(JSON.parse(S.sec['st.lists'].v)[0].items.includes('YAHOO:COIN') && JSON.parse(S.sec['st.lists'].v)[0].items.includes('YAHOO:AMD'), '서버를 껐다 켜도 기록 그대로 · 꺼진 동안 크롬에서 추가한 COIN도 다시 켜지면 올라감');
    ok(fs.existsSync(path.join(dir, 'data', 'sync_state.json')) && fs.readdirSync(path.join(dir, 'data', 'sync_backup')).length === 1, 'PC 서버 폴더 data/sync_state.json 저장 · 하루 백업 1개');

    // 9) 오른쪽 클릭으로 도구 풀기 (맞춤과 함께 있어도)
    await A.evaluate(() => CH.setTool('trend'));
    const box = await A.evaluate(() => { const r = document.getElementById('chart').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 3 }; });
    await A.mouse.click(box.x, box.y, { button: 'right' }); await sleep(200);
    ok(await A.evaluate(() => CH.state.tool === 'cursor' && !document.querySelector('.menu.ctx')), '오른쪽 클릭 → 도구 풀림');

    ok(A.errs.length === 0 && B.errs.length === 0, '페이지 오류 없음 ' + JSON.stringify([...A.errs, ...B.errs].slice(0, 3)));
  } finally {
    await browser.close().catch(() => {});
    srv.kill();
  }
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('E2E FAIL', e); process.exit(1); });
