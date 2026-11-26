// 웨돔식 미국 주식 화면 점검: 종목 찾기 창(전체·관심·테마·섹터·ETF), 시세판, 장 상태, 윗줄·상세, 하단 띠, 김프, 국내식 색, 깜빡임, Alpaca 키 창
// 가짜 PC 서버 · 가짜 바이낸스 · 가짜 업비트로 화면을 돌려 봄 · 준비: npm i playwright lightweight-charts@5.2.1 · 실행: node tests/e2e_usboard.js
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const fs = require('fs'), path = require('path');
const HTML = path.join(__dirname, '..', 'index.html');
const LWC = fs.readFileSync(path.join(path.dirname(require.resolve('lightweight-charts/package.json')), 'dist/lightweight-charts.standalone.production.js'), 'utf8');
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const NOW = '2026-11-25T14:00:00Z';   // 뉴욕 09:00 (프리마켓, 30분 뒤 정규장)

// 가짜 미국 종목 목록: [기호, 한글명, 영문명, 거래소, 종류, ETF 분류]
const ROWS = [['NVDA', '엔비디아', 'NVIDIA Corporation', 'NASDAQ', 'cs', ''], ['TSLA', '테슬라', 'Tesla, Inc.', 'NASDAQ', 'cs', ''], ['AAPL', '애플', 'Apple Inc.', 'NASDAQ', 'cs', ''],
  ['AMD', 'AMD', 'Advanced Micro Devices', 'NASDAQ', 'cs', ''], ['JPM', 'JP모건', 'JPMorgan Chase', 'NYSE', 'cs', ''], ['SPY', 'SPDR S&P 500', 'SPDR S&P 500 ETF Trust', 'NYSE Arca', 'etf', 'e-idx'],
  ['QQQ', '인베스코 QQQ', 'Invesco QQQ Trust', 'NASDAQ', 'etf', 'e-idx'], ['SOXL', '반도체 3X', 'Direxion Semiconductor Bull 3X', 'NYSE Arca', 'etf', 'e-lev'], ['DIA', 'SPDR 다우', 'SPDR Dow Jones', 'NYSE Arca', 'etf', 'e-idx']];
const GROUPS = { theme: [{ id: 't-big7', name: '빅테크 7', syms: ['NVDA', 'AAPL', 'TSLA'] }, { id: 't-aichip', name: 'AI 반도체', syms: ['NVDA', 'AMD'] }],
  sector: [{ id: 's-tech', name: '기술', syms: ['AAPL'] }, { id: 's-semi', name: '반도체', syms: ['NVDA', 'AMD'] }, { id: 's-fin', name: '금융', syms: ['JPM'] }, { id: 's-indu', name: '산업재', syms: ['TSLA'] }],
  etf: [{ id: 'e-idx', name: '지수', syms: ['SPY', 'QQQ', 'DIA'] }, { id: 'e-lev', name: '레버리지', syms: ['SOXL'] }] };
// 시세판: [기호, 가격, 전일종가, 거래대금, 거래량, 시각, 고가, 저가] — 거래대금 순서: SPY > NVDA > TSLA > QQQ > AAPL > AMD > SOXL > JPM > DIA
const PX = { SPY: [668, 660, 9e10], NVDA: [182, 180, 5e10], TSLA: [375, 385, 4e10], QQQ: [610, 600, 3e10], AAPL: [230, 232, 2e10], AMD: [150, 140, 1e10], SOXL: [32, 30, 5e9], JPM: [300, 301, 2e9], DIA: [470, 468, 1e9] };
let tick = 0, keysSet = null;
const boardRow = s => { const [p, pc, dv] = PX[s]; const q = p + (tick % 5) * 0.01; return [s, q, pc, dv, Math.round(dv / p), Date.now(), p * 1.02, p * 0.97]; };

(async () => {
  const browser = await pw.chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errs.push(m.text().slice(0, 200)); });
  await page.clock.setFixedTime(new Date(NOW));
  await page.routeWebSocket(/.*/, ws => {
    if (!ws.url().includes('miniTicker')) return;
    let i = 0; const iv = setInterval(() => { i++; ws.send(JSON.stringify([{ s: 'BTCUSDT', c: String(60000 + (i % 3) * 50), o: '59000', q: '1e9' }, { s: 'ETHUSDT', c: '3000', o: '2950', q: '5e8' }])); }, 300);
    ws.onClose(() => clearInterval(iv));
  });
  await page.route('**/*', async route => {
    const u = new URL(route.request().url()), m = route.request().method();
    const json = (o, st = 200) => route.fulfill({ status: st, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
    if (u.host === 'app.test') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(HTML) });
    if (u.href.includes('lightweight-charts')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: LWC });
    if (u.host === 'api.upbit.com') return json([{ market: 'KRW-BTC', trade_price: 90000000 }, { market: 'KRW-USDT', trade_price: 1450 }]);
    if (u.host === 'localhost:8000') {
      const p = u.pathname, sy = (u.searchParams.get('symbols') || '').split(',').filter(Boolean);
      if (p === '/api/ping') return json({ ok: true, yfinance: 'x', version: '2026-11-26a' });
      if (p === '/api/us/universe') return json({ v: '1-1', rows: ROWS, groups: GROUPS, sic: { done: 5, total: 5, running: false }, building: false });
      if (p === '/api/us/board') { tick++; return json({ v: tick, mode: keysSet ? 'alpaca' : 'yahoo', session: 'pre', count: 9, stat: {}, rows: (sy.length ? sy : Object.keys(PX)).filter(s => PX[s]).map(boardRow) }); }
      if (p === '/api/us/spark') { const o = {}; for (const s of sy) o[s] = Array.from({ length: 13 }, (_, i) => 100 + Math.sin(i / 2) * (s.length)); return json(o); }
      if (p === '/api/us/keys') { if (m === 'POST') { const b = JSON.parse(route.request().postData() || '{}'); keysSet = b.key || null; return json(b.key === 'PKGOOD' ? { ok: true, msg: '연결됨 · SPY 668' } : { ok: false, msg: 'Alpaca 401 unauthorized' }); } return json({ alpaca: !!keysSet, mode: keysSet ? 'alpaca' : 'yahoo', stat: {} }); }
      if (p === '/api/yf/quotes') { const o = {}; for (const s of sy) { const b = PX[s] || [1400, 1395]; o[s] = { price: b[0] + (tick % 3) * 0.5, prev: b[1], chgPct: (b[0] / b[1] - 1) * 100, day: '2026-11-25' }; } tick++; return json(o); }
      if (p === '/api/yf/klines') { const sec = 86400, n = u.searchParams.get('recent') ? 3 : 200, b = (PX[u.searchParams.get('symbol')] || [100])[0], bars = [], last = Date.parse('2026-11-24T00:00:00Z');
        for (let i = n - 1; i >= 0; i--) { const t = last - i * sec * 1000, c = b + Math.sin(i / 5); bars.push([t, c, c + 1, c - 1, c, 1000, t + sec * 1000 - 1, 1000 * c]); }
        return json({ symbol: u.searchParams.get('symbol'), tf: '1d', meta: { currency: 'USD', longName: 'Test' }, bars }); }
      return json({}, 404);
    }
    if (u.pathname.endsWith('/exchangeInfo')) return json({ symbols: [{ symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', status: 'TRADING', contractType: 'PERPETUAL', underlyingType: 'COIN', pricePrecision: 1, onboardDate: 1569398400000, filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.10' }] }] });
    if (u.pathname.endsWith('/klines')) { const out = [], now = Date.parse(NOW); for (let i = 299; i >= 0; i--) { const t = Math.floor(now / 86400000) * 86400000 - i * 86400000, c = 60000 + Math.sin(i / 9) * 2000; out.push([t, String(c), String(c + 300), String(c - 300), String(c), '100', t + 86399999, '6000000', 100, '50', '3000000', '0']); } return json(out); }
    return json({}, 404);
  });
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    localStorage.setItem('mc.useLocal', '1'); localStorage.removeItem('mc.srchF'); localStorage.removeItem('mc.usbTab');
  });
  await page.goto('http://app.test/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof UI !== 'undefined' && DS.srv.ok === true, null, { timeout: 30000 });
  await page.evaluate(() => { const L = UI.curList(); L.items.unshift('YAHOO:NVDA', 'YAHOO:SPY', 'BINANCE:BTCUSDT'); UI.save(); UI.openChart('YAHOO:NVDA'); });
  await page.waitForTimeout(3500);

  // 1. 장 상태
  const mkt = await page.$eval('#mkt', e => e.className + ' | ' + e.textContent);
  ok(/pre/.test(mkt) && mkt.includes('프리마켓 · 30분 후 정규장 시작'), '장 상태 (뉴욕 09:00 = 프리마켓 30분 전): ' + mkt);
  const hol = await page.evaluate(() => [UI.MKT.state(new Date('2026-11-26T15:00:00Z')).label, UI.MKT.state(new Date('2026-11-27T18:30:00Z')).ph, UI.MKT.state(new Date('2026-11-27T16:00:00Z')).next]);
  ok(hol[0].includes('휴장') && hol[1] === 'after' && hol[2].includes('조기폐장'), '추수감사절 휴장 · 다음날 13시 조기폐장: ' + hol.join(' / '));

  // 2. 윗줄 · 오른쪽 상세 (미국 주식)
  await page.waitForTimeout(2500);
  const top = await page.$eval('#legend .lg-main .fund', e => e.textContent).catch(() => '');
  ok(top.includes('전일 종가') && top.includes('오늘 범위') && top.includes('거래량'), '차트 윗줄: ' + top.trim());
  const det = await page.$eval('#detail', e => e.textContent);
  ok(det.includes('전일 종가') && det.includes('오늘 범위') && det.includes('장 상태'), '오른쪽 상세에 전일 종가·오늘 범위·장 상태');

  // 3. 하단 시세 띠
  const tape = await page.$eval('#tape', e => e.textContent);
  ok(tape.includes('SPY') && /66[89]/.test(tape) && tape.includes('BTC'), '하단 시세 띠: ' + tape.slice(0, 90));

  // 4. Alpaca 키 창 (틀린 키 → 거절, 맞는 키 → 연결)
  await page.evaluate(() => UI.alpacaDialog()); await page.waitForTimeout(500);
  await page.fill('#apK', 'BAD'); await page.fill('#apS', 'x'); await page.click('#apSave'); await page.waitForTimeout(400);
  const bad = await page.$eval('#apRes', e => e.textContent);
  await page.fill('#apK', 'PKGOOD'); await page.fill('#apS', 'secret'); await page.click('#apSave'); await page.waitForTimeout(400);
  const good = await page.$eval('#apRes', e => e.textContent);
  ok(bad.includes('✗') && good.includes('✓ 연결됨'), `Alpaca 키: 틀림 "${bad}" · 맞음 "${good}"`);
  await page.keyboard.press('Escape');

  // 5. 종목 찾기 창 — 장 상태 누르면 미국 탐색
  await page.click('#mkt'); await page.waitForTimeout(1500);
  const tabs = await page.$$eval('.usb-tabs button', b => b.map(x => x.textContent));
  ok(tabs.join('|') === '전체9|관심목록2|테마2|섹터5|ETF4', '탭과 개수: ' + tabs.join(' '));
  const order = await page.$$eval('.usr', r => r.map(x => x.dataset.s));
  ok(order.slice(0, 5).join(',') === 'SPY,NVDA,TSLA,QQQ,AAPL', '거래대금 큰 순: ' + order.join(','));
  const r0 = await page.$eval('.usr[data-s="NVDA"]', e => e.innerText.replace(/\s+/g, ' '));
  ok(/NVDA\s*엔비디아/.test(r0) && /NASDAQ/.test(r0) && /\+1\.1\d%/.test(r0) && /\$50\.00B|50\.00B/.test(r0), '행: 기호·한글명·거래소·변동·거래대금: ' + r0);
  await page.waitForTimeout(800);
  ok(await page.$$eval('.usr svg polyline', p => p.length) >= 5, '미니 차트');
  const foot = await page.$eval('.usb-foot', e => e.textContent);
  ok(foot.includes('프리마켓') && foot.includes('Alpaca 실시간'), '아래 줄 장 상태·시세 출처: ' + foot.replace(/\s+/g, ' '));
  const p1 = await page.$eval('.usr[data-s="NVDA"] .p', e => e.textContent); await page.waitForTimeout(3200);
  const p2 = await page.$eval('.usr[data-s="NVDA"] .p', e => e.textContent);
  ok(p1 !== p2, `보이는 종목 가격이 계속 바뀜: ${p1} → ${p2}`);
  await page.click('.usb-tabs [data-t="sector"]'); await page.waitForTimeout(300);
  await page.click('.usb-chips [data-c="s-semi"]'); await page.waitForTimeout(300);
  ok((await page.$$eval('.usr', r => r.map(x => x.dataset.s))).join(',') === 'NVDA,AMD', '섹터 → 반도체 칩');
  await page.click('.usb-tabs [data-t="etf"]'); await page.waitForTimeout(300);
  const etf = await page.$$eval('.usr', r => r.map(x => x.dataset.s)); ok(etf.join(',') === 'SPY,QQQ,DIA', 'ETF → 지수 (거래대금순): ' + etf);
  await page.click('.usb-tabs [data-t="theme"]'); await page.waitForTimeout(300);
  ok((await page.$$eval('.usr', r => r.map(x => x.dataset.s))).join(',') === 'NVDA,AAPL,TSLA', '테마 → 빅테크 7 (정한 순서)');
  await page.click('.usb-tabs [data-t="all"]'); await page.fill('#sq', '테슬'); await page.waitForTimeout(400);
  ok((await page.$$eval('.usr', r => r.map(x => x.dataset.s))).join(',') === 'TSLA', '한글로 거르기: 테슬 → TSLA');
  await page.click('.usr[data-s="TSLA"] .addst'); await page.waitForTimeout(200);
  ok(await page.evaluate(() => UI.curList().items.includes('YAHOO:TSLA')), '☆ 눌러 관심목록 추가');
  await page.screenshot({ path: '/tmp/usboard.png' });
  await page.click('.usr[data-s="TSLA"] .nm'); await page.waitForTimeout(1500);
  ok(await page.evaluate(() => UI.ST.key) === 'YAHOO:TSLA' && !(await page.evaluate(() => document.getElementById('dlg').open)), '행 누르면 차트로 (TSLA)');

  // 6. 김프 (업비트 9천만 원 ÷ (BTC 6만 달러 × 환율))
  await page.evaluate(() => UI.openChart('BINANCE:BTCUSDT')); await page.waitForTimeout(4000);
  const kimp = await page.$eval('#legend .lg-main .fund', e => e.textContent).catch(() => '');
  ok(/김프 \+\d+\.\d\d%/.test(kimp), '코인 김프: ' + kimp.trim());

  // 7. 관심목록 깜빡임 · 국내식 색
  const flashed = await page.evaluate(() => new Promise(res => { const seen = new Set(); const mo = new MutationObserver(ms => ms.forEach(m => m.target.classList && (m.target.classList.contains('fl-up') || m.target.classList.contains('fl-dn')) && seen.add(m.target.dataset.key))); mo.observe(document.getElementById('list'), { subtree: true, attributes: true, attributeFilter: ['class'] }); setTimeout(() => { mo.disconnect(); res([...seen]); }, 2500); }));
  ok(flashed.includes('BINANCE:BTCUSDT'), '가격 바뀌면 깜빡임: ' + flashed);
  await page.evaluate(() => { localStorage.setItem('mc.krColor', '0'); });
  await page.click('#menuBtn'); await page.waitForTimeout(300);
  await page.evaluate(() => [...document.querySelectorAll('body *:not(script)')].find(e => e.children.length === 0 && e.textContent.includes('국내식'))?.click());
  await page.waitForTimeout(300);
  const col = await page.evaluate(() => [getComputedStyle(document.documentElement).getPropertyValue('--up').trim(), UI.ST.chartCfg && UI.ST.chartCfg.up]);
  ok(col[0] === '#f04452' && col[1] === '#f04452', '국내식 색 (오르면 빨강) 화면·차트: ' + col);

  ok(errs.length === 0, '페이지 오류 없음 ' + JSON.stringify(errs.slice(0, 5)));
  await Promise.race([browser.close(), new Promise(r => setTimeout(r, 3000))]);
  process.exit(process.exitCode || 0);
})();
