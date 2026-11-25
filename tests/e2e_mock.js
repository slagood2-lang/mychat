// 가짜 시세로 화면 전체를 돌려 보는 점검 · 준비: npm i playwright lightweight-charts@5.2.1 (크롬 경로는 CHROME 환경변수)
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium } = pw;
const fs = require('fs');
const HTML = __dirname + '/../index.html';
const LWC = fs.readFileSync(require('path').join(require('path').dirname(require.resolve('lightweight-charts/package.json')), 'dist/lightweight-charts.standalone.production.js'), 'utf8');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const TF = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '8h': 28800, '12h': 43200, '1d': 86400, '3d': 259200, '1w': 604800, '1M': 2592000 };
function klines(u) {
  const q = u.searchParams, sec = TF[q.get('interval')] || 3600, lim = Math.min(+q.get('limit') || 500, 1500);
  const end = q.get('endTime') ? +q.get('endTime') : Date.now(), last = Math.floor(end / 1000 / sec) * sec, out = [];
  for (let i = lim - 1; i >= 0; i--) { const t = (last - i * sec), x = t / sec; const base = 60000 + 4000 * Math.sin(x / 37) + 1500 * Math.sin(x / 7) + 300 * Math.sin(x * 1.7);
    const o = base, c = base + 200 * Math.sin(x * 2.3), h = Math.max(o, c) + 80 + 60 * Math.abs(Math.sin(x)), l = Math.min(o, c) - 80 - 60 * Math.abs(Math.cos(x));
    out.push([t * 1000, o.toFixed(1), h.toFixed(1), l.toFixed(1), c.toFixed(1), (100 + 50 * Math.abs(Math.sin(x * 3))).toFixed(3), t * 1000 + sec * 1000 - 1, (6e6).toFixed(1), 100, '50', '3000000', '0']); }
  return out;
}
const sym = (s, base, ct = 'PERPETUAL', ut = 'COIN') => ({ symbol: s, baseAsset: base, quoteAsset: 'USDT', status: 'TRADING', contractType: ct, underlyingType: ut, pricePrecision: 1, onboardDate: 1569398400000, filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.10' }] });
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = [], unknown = new Set();
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errs.push('CONSOLE ' + m.text().slice(0, 300)); });
  await page.routeWebSocket(/.*/, ws => {
    const url = ws.url(); let iv;
    if (url.includes('@depth')) { let u = 1000; iv = setInterval(() => { u += 5; const mid = 60000 + Math.round(Math.sin(Date.now() / 3000) * 20) / 10;
      ws.send(JSON.stringify({ e: 'depthUpdate', E: Date.now(), s: 'BTCUSDT', U: u - 4, u, b: [[(mid - 0.1).toFixed(2), (Math.random() * 5).toFixed(3)], [(mid - 0.5).toFixed(2), '2.500']], a: [[(mid + 0.1).toFixed(2), (Math.random() * 5).toFixed(3)], [(mid + 0.6).toFixed(2), '1.250']] })); }, 100); }
    else if (url.includes('@aggTrade')) { iv = setInterval(() => { const big = Math.random() < 0.2; ws.send(JSON.stringify({ e: 'aggTrade', E: Date.now(), s: 'BTCUSDT', p: (60000 + Math.random() * 2).toFixed(1), q: (big ? 3 + Math.random() : Math.random() * 0.2).toFixed(3), T: Date.now(), m: Math.random() < 0.5 })); }, 150); }
    ws.onClose(() => clearInterval(iv));
  });
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    const json = o => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
    if (u.host === 'app.test') return route.fulfill({ status: 200, contentType: u.pathname.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain', body: u.pathname.endsWith('.html') ? fs.readFileSync(HTML) : '' });
    if (u.href.includes('lightweight-charts')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: LWC });
    if (u.host.includes('fonts.g')) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (u.pathname.endsWith('/exchangeInfo')) return json({ symbols: [sym('BTCUSDT', 'BTC'), sym('ETHUSDT', 'ETH'), sym('SOLUSDT', 'SOL'), sym('1000PEPEUSDT', '1000PEPE'), sym('TSLAUSDT', 'TSLA', 'TRADIFI_PERPETUAL', 'EQUITY'), sym('XAUUSDT', 'XAU', 'TRADIFI_PERPETUAL', 'COMMODITY'), sym('QQQUSDT', 'QQQ', 'TRADIFI_PERPETUAL', 'EQUITY')] });
    if (u.pathname.endsWith('/klines') || u.pathname.endsWith('/continuousKlines')) return json(klines(u));
    if (u.pathname.endsWith('/ticker/24hr')) return json(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', '1000PEPEUSDT', 'TSLAUSDT', 'XAUUSDT', 'QQQUSDT'].map(s => ({ symbol: s, lastPrice: '60000', priceChangePercent: '1.23', quoteVolume: '5000000000', openPrice: '59000' })));
    if (u.pathname.endsWith('/depth')) { const b = [], a = []; for (let i = 1; i <= 1000; i++) { b.push([(60000 - i * 0.1).toFixed(2), (1 + (i % 7) * 0.3).toFixed(3)]); a.push([(60000 + i * 0.1).toFixed(2), (1 + (i % 5) * 0.4).toFixed(3)]); } return json({ lastUpdateId: 900, bids: b, asks: a }); }
    if (u.host === 'assets.coincap.io') return u.pathname.includes('/btc@') ? route.fulfill({ status: 200, contentType: 'image/png', body: PNG }) : route.fulfill({ status: 404, body: '' });
    if (u.host.includes('jsdelivr') || u.host.includes('financialmodelingprep')) return u.pathname.includes('TSLA') ? route.fulfill({ status: 200, contentType: 'image/png', body: PNG }) : route.fulfill({ status: 404, body: '' });
    unknown.add(u.host + u.pathname);
    return route.fulfill({ status: 404, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' });
  });
  await page.goto('http://app.test/index.html');
  await page.waitForFunction(() => typeof CH !== 'undefined' && CH.data && CH.data.N > 100, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const base = errs.length; console.log('after load: errors', base, errs.slice(0, 6));
  const info = await page.evaluate(() => ({ key: UI.state ? UI.state.key : null, N: CH.data.N, types: Object.keys(CH.TYPES).length, pack: Object.keys(PACK.S).length, legend: document.querySelectorAll('#legend .lg-row').length, icons: document.querySelectorAll('.list .tki').length }));
  console.log('info', JSON.stringify(info));
  // 지표 팩: 6개씩 넣어 보고 오류 행·콘솔 오류 확인
  const keys = await page.evaluate(() => Object.keys(PACK.S));
  const fails = [];
  for (let i = 0; i < keys.length; i += 6) {
    const part = keys.slice(i, i + 6);
    const r = await page.evaluate(async part => {
      const added = part.map(k => CH.addIndicator(k));
      await new Promise(r => setTimeout(r, 350));
      const res = added.map(inst => { const row = document.querySelector(`#legend .lg-row[data-id="${inst.id}"]`); return { type: inst.type, row: !!row, err: !!row && row.classList.contains('err'), vals: row ? row.querySelector('.vals').textContent.trim().slice(0, 40) : '' }; });
      for (const inst of added) CH.removeIndicator(inst);
      await new Promise(r => setTimeout(r, 120));
      return res;
    }, part);
    for (const x of r) if (!x.row || x.err || (!x.vals && x.type !== 'gmma')) fails.push(x);
  }
  console.log('pack indicators tested', keys.length, 'fails', JSON.stringify(fails));
  console.log('errors after pack', errs.length - base, errs.slice(base, base + 8));
  // 화면 확인용: 몇 개 올려 두고 사진
  await page.evaluate(() => { for (const k of ['supertrend', 'ichimoku', 'psar', 'stoch', 'adx', 'ao']) CH.addIndicator(k); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/tmp/shot_chart.png' });
  // 지표 창
  await page.click('#indBtn'); await page.waitForTimeout(300);
  const dlg = await page.evaluate(() => ({ all: document.querySelectorAll('#il .ind-item').length, chips: [...document.querySelectorAll('#icat button')].map(b => b.textContent) }));
  await page.click('#icat button[data-c="mom"]'); await page.waitForTimeout(150);
  dlg.mom = await page.evaluate(() => document.querySelectorAll('#il .ind-item').length);
  await page.fill('#iq', 'ichimoku'); await page.waitForTimeout(150);
  dlg.search = await page.evaluate(() => [...document.querySelectorAll('#il .ind-item b')].map(b => b.textContent));
  console.log('dialog', JSON.stringify(dlg));
  await page.screenshot({ path: '/tmp/shot_dialog.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  // 호가 탭
  await page.click('#sideTabs button[data-tab="ob"]'); await page.waitForTimeout(2500);
  const ob = await page.evaluate(() => ({ asks: document.querySelectorAll('.ob-a .ob-r').length, bids: document.querySelectorAll('.ob-b .ob-r').length, trades: document.querySelectorAll('.ob-t .ob-tr').length, mid: document.querySelector('.ob-mid b')?.textContent, bestAsk: document.querySelector('.ob-a .ob-r:last-child .p')?.textContent, bestBid: document.querySelector('.ob-b .ob-r .p')?.textContent, listHidden: document.getElementById('list').hidden, note: document.querySelector('.ob-note')?.textContent || '' }));
  console.log('orderbook', JSON.stringify(ob));
  await page.selectOption('#obPanel select[data-o="g"]', '2'); await page.waitForTimeout(600);
  const ob2 = await page.evaluate(() => [...document.querySelectorAll('.ob-b .ob-r .p')].slice(0, 3).map(x => x.textContent));
  await page.selectOption('#obPanel select[data-o="min"]', '100000'); await page.waitForTimeout(1200);
  const big = await page.evaluate(() => document.querySelectorAll('.ob-t .ob-tr').length + ' rows, all big: ' + [...document.querySelectorAll('.ob-t .ob-tr')].every(r => r.classList.contains('big')));
  console.log('grouped bids (step 10)', JSON.stringify(ob2), '| big trades', big);
  await page.screenshot({ path: '/tmp/shot_ob.png' });
  // 관심목록으로 돌아가면 소켓이 닫히는지 · 아이콘
  await page.click('#sideTabs button[data-tab="wl"]'); await page.waitForTimeout(600);
  const wl = await page.evaluate(() => ({ obKey: OB.key, rows: document.querySelectorAll('.list .row').length, icons: document.querySelectorAll('.list .row .tki').length, imgs: document.querySelectorAll('.list .row .tki img').length, sym: document.querySelector('#symIco .tki') ? document.querySelector('#symIco .tki').textContent + '/' + document.querySelectorAll('#symIco img').length : null, first: [...document.querySelectorAll('.list .row')].slice(0, 6).map(r => r.querySelector('.tki').textContent + (r.querySelector('.tki img') ? '+img' : '')) }));
  console.log('watchlist', JSON.stringify(wl));
  await page.screenshot({ path: '/tmp/shot_wl.png', clip: { x: 1100, y: 0, width: 400, height: 500 } });
  console.log('total errors', errs.length, errs.slice(base).slice(0, 10));
  console.log('unmocked', [...unknown].slice(0, 25));
  await browser.close();
})().catch(e => { console.error('E2E FAIL', e); process.exit(1); });
