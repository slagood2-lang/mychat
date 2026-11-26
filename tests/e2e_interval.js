// 봉 간격 메뉴 점검: ★ 즐겨찾기 막대 · 전체 메뉴 · 사용자 간격(7분·45분·2일·2달) · 묶음 간격(10분·8시간·3주) · 다시 열기 · 관심목록 그대로
// 가짜 바이낸스(REST·웹소켓)로 돌려 봄 · 준비: npm i playwright lightweight-charts@5.2.1 · 실행: node tests/e2e_interval.js
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const fs = require('fs'), path = require('path');
const HTML = path.join(__dirname, '..', 'index.html');
const LWC = fs.readFileSync(path.join(path.dirname(require.resolve('lightweight-charts/package.json')), 'dist/lightweight-charts.standalone.production.js'), 'utf8');
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const NOW = Date.parse('2026-11-26T07:27:00Z'), DAY = 864e5, LIST0 = Date.parse('2019-09-09T00:00:00Z');
const STEP = { '1m': 6e4, '3m': 18e4, '5m': 3e5, '15m': 9e5, '30m': 18e5, '1h': 36e5, '2h': 72e5, '4h': 144e5, '6h': 216e5, '12h': 432e5, '1d': DAY };
// 바이낸스처럼 시작 시각 맞춘 봉 (주봉 = 월요일, 월봉 = 1일)
const openOf = (iv, t) => {
  if (STEP[iv]) return Math.floor(t / STEP[iv]) * STEP[iv];
  const di = Math.floor(t / DAY);
  if (iv === '1w') return (di - (((di - 4) % 7) + 7) % 7) * DAY;
  const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
};
const prevOpen = (iv, t) => STEP[iv] ? t - STEP[iv] : iv === '1w' ? t - 7 * DAY : (d => Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))(new Date(t));
const nextOpen = (iv, t) => STEP[iv] ? t + STEP[iv] : iv === '1w' ? t + 7 * DAY : (d => Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))(new Date(t));
const f = t => 60000 + 2000 * Math.sin(t / DAY / 7) + 300 * Math.sin(t / 36e5) + 50 * Math.sin(t / 6e4 / 13);
const bar = (iv, t) => { const T = nextOpen(iv, t) - 1, o = f(t), c = f(T - 59999), m = Math.floor(t / 6e4);
  const h = Math.max(o, c) + 10 + m % 17, l = Math.min(o, c) - 10 - m % 11, v = 1 + m % 5;
  return [t, o.toFixed(1), h.toFixed(1), l.toFixed(1), c.toFixed(1), v.toFixed(3), T, (v * c).toFixed(2), 10, '0', '0', '0']; };
function klines(u) {
  const iv = u.searchParams.get('interval'), lim = Math.min(+u.searchParams.get('limit') || 500, 1500), end = Math.min(+u.searchParams.get('endTime') || NOW, NOW);
  const out = []; let t = openOf(iv, end);
  while (out.length < lim && t >= LIST0) { out.unshift(bar(iv, t)); t = prevOpen(iv, t); }
  return out;
}
// 사용자 간격 기대값 (앱 코드와 따로 계산)
function expect(base, tf) {
  const n = +tf.slice(0, -1), u = tf.slice(-1), g = new Map();
  for (const x of base) {
    const t = x[0]; let key;
    if (u === 'm' || u === 'h') { const step = n * (u === 'm' ? 6e4 : 36e5), d0 = Math.floor(t / DAY) * DAY; key = d0 + Math.floor((t - d0) / step) * step; }
    else if (u === 'd') key = Math.floor(Math.floor(t / DAY) / n);
    else if (u === 'w') key = Math.floor((Math.floor(t / DAY) + 3) / 7 / n | 0);
    else { const d = new Date(t); key = Math.floor((d.getUTCFullYear() * 12 + d.getUTCMonth()) / n); }
    if (u === 'w') key = Math.floor(Math.floor((Math.floor(t / DAY) + 3) / 7) / n);
    const o = g.get(key);
    if (!o) g.set(key, { t: u === 'm' || u === 'h' ? key : t, o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] });
    else { o.h = Math.max(o.h, +x[2]); o.l = Math.min(o.l, +x[3]); o.c = +x[4]; o.v += +x[5]; }
  }
  return [...g.values()];
}

(async () => {
  const browser = await pw.chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = [], wsUrls = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errs.push(m.text().slice(0, 200)); });
  await page.clock.setFixedTime(new Date(NOW));
  let tick = 0;
  await page.routeWebSocket(/.*/, ws => {
    const url = ws.url(), m = /@kline_(\w+)$/.exec(url); if (!m) return;
    wsUrls.push(url); const iv = m[1];
    const timer = setInterval(() => { tick++; const t = openOf(iv, NOW), b = bar(iv, t), c = 61000 + tick;
      ws.send(JSON.stringify({ e: 'kline', k: { t, T: b[6], o: b[1], h: String(Math.max(+b[2], c)), l: b[3], c: String(c), v: b[5], q: b[7] } })); }, 250);
    ws.onClose(() => clearInterval(timer));
  });
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    const json = (o, st = 200) => route.fulfill({ status: st, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
    if (u.host === 'app.test') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(HTML) });
    if (u.href.includes('lightweight-charts')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: LWC });
    if (u.host === 'fapi.binance.com' && u.pathname.endsWith('/exchangeInfo')) return json({ symbols: [{ symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', status: 'TRADING', contractType: 'PERPETUAL', underlyingType: 'COIN', pricePrecision: 1, onboardDate: LIST0, filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.10' }] }] });
    if (u.host === 'fapi.binance.com' && u.pathname.endsWith('/klines')) return json(klines(u));
    return json({}, 404);
  });
  // 사장님 관심목록과 같은 모양 (화면에 보인 29개 중 일부 + 구분선) + 다른 목록 2개
  const LISTS = [
    { name: '내 관심목록', items: ['BINANCE:BTCUSDT', 'COINBASE:BTCUSD', 'YAHOO:NDAQ', 'BINANCE:ETHUSDT', 'BINANCE:SOLUSDT', 'BINANCE:XRPUSDT', '###선물·지수', 'YAHOO:CL=F', 'YAHOO:SI=F', 'YAHOO:GC=F', 'YAHOO:NQ=F', 'YAHOO:^GSPC', 'YAHOO:DX-Y.NYB',
      '###한국', 'YAHOO:005930.KS', 'YAHOO:000660.KS', '###새 구역', 'YAHOO:NVDA', 'YAHOO:BLK', 'YAHOO:TSLA', 'YAHOO:SOXL', 'YAHOO:AAPL', 'YAHOO:SOXS', 'YAHOO:CRWV', 'YAHOO:NKE', 'YAHOO:INTC', 'YAHOO:MRK', 'YAHOO:NFLX', 'YAHOO:PFE'] },
    { name: '전체 차트 · 코인 TOP20', layout: 'full', items: ['###CRYPTO 달러', 'CRYPTO:BTCUSD', 'CRYPTO:ETHUSD', 'COINBASE:SOLUSD'] },
    { name: '★ 즐겨찾기', items: ['BINANCE:BTCUSDT', 'YAHOO:NVDA'] }];
  await page.addInitScript(([lists]) => {
    if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    localStorage.setItem('mc.v1', JSON.stringify({ lists, active: 0, tf: '5m', key: 'BINANCE:BTCUSDT', sideTab: 'wl', view: 'chart' }));
  }, [LISTS]);
  await page.goto('http://app.test/index.html');
  await page.waitForFunction(() => typeof CH !== 'undefined' && CH.data && CH.data.N > 100, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const listsOf = () => page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('mc.v1') || '{}').lists || UI.ST.lists));
  const lists0 = JSON.parse(await page.evaluate(() => JSON.stringify(UI.ST.lists)));
  ok(LISTS.every(L => lists0.some(x => x.name === L.name && JSON.stringify(x.items) === JSON.stringify(L.items))), '처음 열었을 때 관심목록 3개 그대로 (' + lists0.map(l => l.name + ' ' + l.items.length).join(' · ') + ')');

  const barTfs = () => page.evaluate(() => [...document.querySelectorAll('#tfBar [data-tf]')].map(b => b.textContent + (b.classList.contains('on') ? '*' : '') + (b.classList.contains('tmp') ? '~' : '')));
  ok(JSON.stringify(await barTfs()) === JSON.stringify(['1분', '5분*', '15분', '1시', '4시', '날', '주', '달', '12달']), '막대 = 웨돔 기본 7개 + 달·12달, 5분 선택: ' + (await barTfs()).join(' '));
  // 메뉴
  await page.click('#tfBar [data-more]'); await page.waitForTimeout(200);
  const menu = await page.evaluate(() => ({ heads: [...document.querySelectorAll('.tfm-h span')].map(x => x.textContent), items: [...document.querySelectorAll('.tfm-i span')].map(x => x.textContent), on: document.querySelector('.tfm-i.on span')?.textContent, stars: document.querySelectorAll('.tfm-s.on').length, add: !!document.querySelector('[data-add]') }));
  ok(menu.heads.join() === '분,시간,일 · 주 · 달' && menu.items.length === 19 && menu.on === '5분' && menu.stars === 9 && menu.add, '메뉴: 분 6 · 시간 7 · 일·주·달 6, ★ 9개, 사용자 간격 추가: ' + menu.items.join(' '));
  await page.click('.tfm-s[data-fav="30m"]'); await page.waitForTimeout(150);
  ok((await barTfs()).includes('30분') && (await page.evaluate(() => JSON.parse(localStorage.getItem('mc.tfs')).fav.includes('30m'))) && !!(await page.$('.menu.tfm')), '☆ 누르면 막대에 30분 고정 · 메뉴는 열린 채');
  await page.click('.tfm-s[data-fav="30m"]'); await page.waitForTimeout(150);
  ok(!(await barTfs()).includes('30분'), '★ 다시 누르면 막대에서 빠짐');
  await page.click('.tfm-h[data-g="1"]'); await page.waitForTimeout(100);
  const folded = await page.evaluate(() => document.querySelectorAll('.tfm-i').length);
  await page.click('.tfm-h[data-g="1"]'); await page.waitForTimeout(100);
  ok(folded === 12 && (await page.evaluate(() => document.querySelectorAll('.tfm-i').length)) === 19, '시간 묶음 접기·펴기');

  // 간격을 열고 기본 봉과 비교
  async function check(tf, base, label, how) {
    await how();
    await page.waitForFunction(t => UI.ST.tf === t && CH.data && CH.data.N > 5 && !document.querySelector('.menu.tfm'), tf, { timeout: 30000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async ([tf, base]) => {
      const b = await DS.klines('BINANCE:BTCUSDT', base, { need: base === '1m' ? 3000 : 1500 });
      const D = CH.data, n = D.N, rows = []; for (let i = 0; i < n; i++) rows.push([D.T[i] * 1000, D.O[i], D.H[i], D.L[i], D.C[i], D.V[i]]);
      return { base: b.map(x => [+x[0], x[1], x[2], x[3], x[4], x[5]]), rows, ws: null, bar: [...document.querySelectorAll('#tfBar [data-tf]')].map(x => x.dataset.tf + (x.classList.contains('on') ? '*' : '')) };
    }, [tf, base]);
    const exp = expect(r.base, tf).slice(1), byT = new Map(r.rows.map(x => [x[0], x]));
    let cmp = 0, bad = 0;
    for (const e of exp.slice(0, -2)) { const a = byT.get(e.t); if (!a) continue; cmp++;
      if (Math.abs(a[1] - e.o) > 1e-6 || Math.abs(a[2] - e.h) > 1e-6 || Math.abs(a[3] - e.l) > 1e-6 || Math.abs(a[4] - e.c) > 1e-6 || Math.abs(a[5] - e.v) > 1e-6 * Math.max(1, e.v)) { bad++; if (bad < 3) console.log('   diff', tf, new Date(e.t).toISOString(), a, e); } }
    const last = r.rows[r.rows.length - 1], le = exp[exp.length - 1];
    const live = last && le && last[0] === le.t && Math.abs(last[1] - le.o) < 1e-6 && last[4] > 61000;
    const sub = wsUrls.some(u => u.endsWith('@kline_' + base));
    ok(cmp >= Math.min(20, exp.length - 3) && bad === 0, `${label}: ${cmp}개 봉이 ${base} 묶음과 같음 (시가·고가·저가·종가·거래량)`);
    ok(live && sub, `${label}: 웹소켓 kline_${base} 구독 · 지금 봉 시가는 앞 봉 그대로, 종가는 실시간 (${last && last[4]})`);
    ok(r.bar.includes(tf + '*'), `${label}: 막대에 지금 간격 표시`);
    return r;
  }
  await check('10m', '5m', '10분 (메뉴)', () => page.click('.tfm-i[data-tf="10m"]'));
  ok((await barTfs()).includes('10분*~'), '10분은 즐겨찾기 아님 표시(점선)로 잠깐 보임');
  await check('8h', '4h', '8시간 (메뉴)', async () => { await page.click('#tfBar [data-more]'); await page.click('.tfm-i[data-tf="8h"]'); });
  const addCustom = async (n, u) => { await page.click('#tfBar [data-more]'); await page.click('[data-add]'); await page.fill('#tfN', String(n)); await page.selectOption('#tfU', u); await page.click('#tfOk'); };
  await check('45m', '15m', '사용자 45분', () => addCustom(45, 'm'));
  await check('7m', '1m', '사용자 7분 (하루 0시마다 새로 셈)', () => addCustom(7, 'm'));
  const t7 = await page.evaluate(() => { const T = CH.data.T; return T.slice(-300).filter(t => t % 86400 === 0).length > 0 && T.slice(-300).every(t => ((t % 86400) / 60) % 7 === 0); });
  ok(t7, '7분봉: 매일 00:00에 시작하고 그날 안에서 7분 간격');
  await check('2d', '1d', '사용자 2일', () => addCustom(2, 'd'));
  await check('3w', '1w', '3주 (메뉴)', async () => { await page.click('#tfBar [data-more]'); await page.click('.tfm-i[data-tf="3w"]'); });
  await check('2M', '1M', '사용자 2달', () => addCustom(2, 'M'));
  // 입력 확인
  await page.click('#tfBar [data-more]'); await page.click('[data-add]');
  await page.fill('#tfN', '2000'); await page.selectOption('#tfU', 'm');
  const m1 = await page.textContent('#tfMsg');
  await page.fill('#tfN', '120'); await page.dispatchEvent('#tfN', 'input');
  const m2 = await page.textContent('#tfMsg');
  await page.fill('#tfN', '90'); await page.dispatchEvent('#tfN', 'input');
  const m3 = await page.textContent('#tfMsg');
  ok(/1~1439분/.test(m1) && /2시간 — 이미 있는/.test(m2) && /90분 = 30분 × 3/.test(m3), `입력 확인: 「${m1}」 「${m2}」 「${m3}」`);
  await page.keyboard.press('Escape');
  const tfs = await page.evaluate(() => JSON.parse(localStorage.getItem('mc.tfs')));
  ok(JSON.stringify(tfs.custom) === '["45m","7m","2d","2M"]' && ['45m', '7m', '2d', '2M'].every(x => tfs.fav.includes(x)), '사용자 간격 저장 (mc.tfs): ' + JSON.stringify(tfs));
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('mc.v1')));
  ok(!JSON.stringify(st).includes('"fav"') && st.tf === '2M', '관심목록·차트 상태(mc.v1)에는 간격 즐겨찾기를 안 넣음 · 지금 간격만 저장');

  // 다시 열기
  await page.reload();
  await page.waitForFunction(() => typeof CH !== 'undefined' && CH.data && CH.data.N > 5, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => ({ tf: UI.ST.tf, n: CH.data.N, bar: [...document.querySelectorAll('#tfBar [data-tf]')].map(b => b.textContent) }));
  ok(after.tf === '2M' && after.n > 10 && ['7분', '45분', '2날', '2달'].every(x => after.bar.includes(x)), '다시 열어도 2달봉 · 사용자 간격 그대로: ' + after.bar.join(' '));
  // 사용자 간격 지우기 · 오른쪽 클릭 메뉴
  await page.click('#tfBar [data-more]'); await page.click('.tfm-x[data-del="7m"]'); await page.waitForTimeout(150);
  ok(!(await page.evaluate(() => JSON.parse(localStorage.getItem('mc.tfs')).custom.includes('7m'))) && !(await barTfs()).includes('7분'), '✕로 사용자 간격 지우기');
  await page.keyboard.press('Escape');
  await page.click('#tfBar [data-tf="45m"]', { button: 'right' }); await page.waitForTimeout(150);
  const ctx = await page.evaluate(() => [...document.querySelectorAll('.menu.ctx button')].map(b => b.textContent.trim()));
  ok(ctx.some(x => x.startsWith('막대에서 빼기')), '막대 오른쪽 클릭: ' + ctx.join(' / '));
  await page.keyboard.press('Escape');
  await page.click('#tfBar [data-tf="1h"]');
  await page.waitForFunction(() => UI.ST.tf === '1h' && CH.data.N > 100, null, { timeout: 30000 });
  ok(true, '기본 간격(1시간)으로 돌아가기');

  const lists1 = JSON.parse(await listsOf());
  ok(JSON.stringify(lists1) === JSON.stringify(lists0), '끝까지 관심목록이 처음과 똑같음 (저장된 것 기준)');
  ok(errs.length === 0, '페이지 오류 없음 ' + JSON.stringify(errs.slice(0, 3)));
  await page.click('#tfBar [data-more]'); await page.waitForTimeout(200);
  await page.screenshot({ path: '/tmp/shot_interval.png', clip: { x: 0, y: 0, width: 900, height: 700 }, timeout: 15000 }).catch(() => console.log('(사진 건너뜀)'));
  await browser.close().catch(() => {}); process.exit(process.exitCode || 0);
})().catch(e => { console.error('E2E FAIL', e); process.exit(1); });
