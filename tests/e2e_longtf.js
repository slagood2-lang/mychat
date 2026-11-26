// 월봉·년봉 전환 점검: 그림이 같은 날짜·가격에 있는지, 봉이 잘리거나 한쪽에 몰리지 않는지, 패널 높이가 유지되는지, 관심목록 그대로인지
// 가짜 바이낸스로 돌려 봄 · 준비: npm i playwright lightweight-charts@5.2.1 · 실행: node tests/e2e_longtf.js
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const fs = require('fs'), path = require('path');
const HTML = path.join(__dirname, '..', 'index.html');
const LWC = fs.readFileSync(path.join(path.dirname(require.resolve('lightweight-charts/package.json')), 'dist/lightweight-charts.standalone.production.js'), 'utf8');
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const NOW = Date.parse('2026-11-26T07:27:00Z'), DAY = 864e5;
const STEP = { '1m': 6e4, '5m': 3e5, '15m': 9e5, '1h': 36e5, '4h': 144e5, '1d': DAY };
const openOf = (iv, t) => {
  if (STEP[iv]) return Math.floor(t / STEP[iv]) * STEP[iv];
  const di = Math.floor(t / DAY);
  if (iv === '1w') return (di - (((di - 4) % 7) + 7) % 7) * DAY;
  const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
};
const prevOpen = (iv, t) => STEP[iv] ? t - STEP[iv] : iv === '1w' ? t - 7 * DAY : (d => Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))(new Date(t));
const nextOpen = (iv, t) => STEP[iv] ? t + STEP[iv] : iv === '1w' ? t + 7 * DAY : (d => Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))(new Date(t));
const f = t => 30000 * Math.exp(Math.sin(t / DAY / 300)) + 2000 * Math.sin(t / DAY / 7);
const bar = (iv, t) => { const T = nextOpen(iv, t) - 1, o = f(t), c = f(Math.min(T, NOW)), h = Math.max(o, c) * 1.02, l = Math.min(o, c) * 0.98;
  return [t, o.toFixed(1), h.toFixed(1), l.toFixed(1), c.toFixed(1), '100', T, (100 * c).toFixed(2), 10, '0', '0', '0']; };

async function run(list0) {
  const browser = await pw.chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errs.push(m.text().slice(0, 200)); });
  await page.clock.setFixedTime(new Date(NOW));
  await page.routeWebSocket(/.*/, () => {});
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    const json = (o, st = 200) => route.fulfill({ status: st, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
    if (u.host === 'app.test') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(HTML) });
    if (u.href.includes('lightweight-charts')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: LWC });
    if (u.host === 'fapi.binance.com' && u.pathname.endsWith('/exchangeInfo')) return json({ symbols: ['BTCUSDT', 'NEWUSDT'].map(s => ({ symbol: s, baseAsset: s.replace('USDT', ''), quoteAsset: 'USDT', status: 'TRADING', contractType: 'PERPETUAL', underlyingType: 'COIN', pricePrecision: 1, onboardDate: s === 'BTCUSDT' ? Date.parse('2019-09-09T00:00:00Z') : Date.parse('2026-06-02T00:00:00Z'), filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.10' }] })) });
    if (u.host === 'fapi.binance.com' && u.pathname.endsWith('/klines')) {
      const iv = u.searchParams.get('interval'), lim = Math.min(+u.searchParams.get('limit') || 500, 1500), end = Math.min(+u.searchParams.get('endTime') || NOW, NOW);
      const first = u.searchParams.get('symbol') === 'NEWUSDT' ? Date.parse('2026-06-02T00:00:00Z') : Date.parse('2019-09-09T00:00:00Z');
      const out = []; let t = openOf(iv, end);
      while (out.length < lim && t >= openOf(iv, first)) { out.unshift(bar(iv, t)); t = prevOpen(iv, t); }
      return json(out);
    }
    return json({}, 404);
  });
  await page.addInitScript(([lists]) => {
    if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    localStorage.setItem('mc.v1', JSON.stringify({ lists, active: 0, tf: '1d', key: 'BINANCE:BTCUSDT', sideTab: 'wl', view: 'chart' }));
  }, [list0]);
  await page.goto('http://app.test/index.html');
  await page.waitForFunction(() => typeof CH !== 'undefined' && CH.data && CH.data.N > 500 && UI.ST.tf === '1d', null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const listsStart = await page.evaluate(() => JSON.parse(localStorage.getItem('mc.v1')).lists);
  ok(list0.every(L => listsStart.some(x => x.name === L.name && JSON.stringify(x.items) === JSON.stringify(L.items))), '처음 열었을 때 내 관심목록 그대로');

  // 일봉에서 그림 6개 (날짜·가격 고정)
  const DR = await page.evaluate(() => {
    const T = s => Date.parse(s) / 1000, st = { color: '#2962ff', w: 2, dash: false };
    const L = [
      { id: 'tr', type: 'trend', p: [{ t: T('2024-03-14T00:00:00Z'), p: 52000 }, { t: T('2025-10-06T00:00:00Z'), p: 61000 }] },
      { id: 'hl', type: 'hline', p: [{ t: T('2025-01-01T00:00:00Z'), p: 45000 }] },
      { id: 'rc', type: 'rect', p: [{ t: T('2022-06-01T00:00:00Z'), p: 20000 }, { t: T('2022-11-21T00:00:00Z'), p: 32000 }] },
      { id: 'fb', type: 'fib', p: [{ t: T('2021-11-10T00:00:00Z'), p: 60000 }, { t: T('2022-11-21T00:00:00Z'), p: 25000 }], fib: JSON.parse(JSON.stringify(CH.fibTemplate)) },
      { id: 'vl', type: 'vline', p: [{ t: T('2024-04-20T00:00:00Z'), p: 40000 }] },
      { id: 'fu', type: 'trend', p: [{ t: T('2026-10-15T00:00:00Z'), p: 40000 }, { t: T('2027-03-01T00:00:00Z'), p: 50000 }] },   // 마지막 봉 뒤(미래)까지
    ];
    for (const d of L) CH.drawings.list.push({ pane: 'main', style: { ...st }, ...d });
    CH.saveDrawings(); CH.redraw && CH.redraw();
    return L.map(d => ({ id: d.id, ts: d.p.map(q => q.t) }));
  });
  // 거래량 패널을 사용자가 키운 것처럼
  const setH = await page.evaluate(() => { const ps = CH.chart.panes(); if (ps.length < 2) return null; ps[1].setHeight(260); return ps.map(p => p.getHeight()); });
  await page.waitForTimeout(300);
  const h0 = await page.evaluate(() => CH.chart.panes().map(p => p.getHeight()));

  const pick = async tf => {
    await page.click('#tfBar [data-more]'); await page.click(`.tfm-i[data-tf="${tf}"]`);
    await page.waitForFunction(t => UI.ST.tf === t && CH.state.tf === t && CH.data.N > 0 && !CH.state.loading, tf, { timeout: 30000 });
    await page.waitForTimeout(900);
  };
  const look = () => page.evaluate(() => {
    const ts = CH.chart.timeScale(), w = ts.width(), sp = ts.options().barSpacing, D = CH.data, vr = ts.getVisibleLogicalRange();
    const x0 = ts.logicalToCoordinate(0), xN = ts.logicalToCoordinate(D.N - 1);
    const xs = []; for (let i = -2; i <= D.N + 20; i++) xs.push([i, ts.logicalToCoordinate(i)]);
    return { N: D.N, w, sp, vr, x0, xN, xs, T: Array.from(D.T), dr: CH.debugDraw(), h: CH.chart.panes().map(p => p.getHeight()) };
  });
  const checkTf = async (tf, label) => {
    const r = await look();
    // 1) 그림: 모두 보이고(좌표 있음) 각 점이 그 날짜를 담은 봉 안(또는 마지막 봉 뒤 같은 비율)에 있음
    let bad = [];
    for (const d of r.dr) {
      const exp = DR.find(x => x.id === d.id);
      if (!d.P || d.P.some(v => !v)) { bad.push(d.id + ' 안 보임'); continue; }
      d.L.forEach((lg, k) => {
        const t = exp.ts[k], T = r.T, n = T.length;
        let i = -1; for (let j = 0; j < n; j++) if (T[j] <= t) i = j;
        if (i >= 0 && i < n - 1 && !(lg >= i && lg < i + 1)) bad.push(`${d.id}#${k} 봉 ${i} 아님 (${lg.toFixed(2)})`);
        if (i === n - 1 && !(lg >= n - 1)) bad.push(`${d.id}#${k} 마지막 봉 뒤 아님`);
        // 화면 x가 정수 봉 x 사이에 비율대로 있는지 (라이브러리가 소수 봉 번호에 0을 주던 문제)
        if (['hl'].includes(d.id)) return;
        const fl = Math.floor(lg), xa = (r.xs.find(v => v[0] === fl) || [])[1], xb = (r.xs.find(v => v[0] === fl + 1) || [])[1];
        if (xa != null && xb != null) { const want = xa + (xb - xa) * (lg - fl); if (Math.abs(d.P[k][0] - want) > 1) bad.push(`${d.id}#${k} x=${d.P[k][0].toFixed(0)} (맞는 x ${want.toFixed(0)})`); }
      });
    }
    ok(!bad.length, `${label}: 그림 6개 모두 그 날짜·가격 자리 ${bad.join(', ')}`);
    // 2) 봉: 첫 봉이 왼쪽에 잘리지 않고, 봉이 너무 굵거나 한쪽에 몰리지 않음
    const firstOk = r.vr && r.vr.from <= -0.5 + 1e-6 ? true : r.x0 == null || r.x0 - r.sp / 2 >= -1;
    ok(firstOk || r.vr.from > 0, `${label}: 첫 봉 안 잘림 (보이는 범위 ${r.vr && r.vr.from.toFixed(2)}~${r.vr && r.vr.to.toFixed(2)}, 봉 ${r.N}개)`);
    ok(r.sp <= 60, `${label}: 봉 폭 ${r.sp.toFixed(1)}px (60px 이하)`);
    const used = r.xN != null && r.x0 != null ? (Math.min(r.xN, r.w) - Math.max(r.x0, 0)) / r.w : 0;
    if (r.N >= 20) ok(used > 0.6, `${label}: 봉이 화면 폭의 ${(used * 100).toFixed(0)}%를 씀 (한쪽에 안 몰림)`);
    else ok(r.xN != null && r.xN > r.w * 0.5, `${label}: 봉이 적어도 오른쪽(최근 쪽)에 붙어 보임 (마지막 봉 x=${r.xN && r.xN.toFixed(0)} / ${r.w})`);
    return r;
  };
  const rD = await checkTf('1d', '일봉');
  for (const [tf, label] of [['1w', '주봉'], ['1M', '월봉'], ['1y', '년봉'], ['1d', '다시 일봉']]) {
    await pick(tf);
    const r = await checkTf(tf, label);
    ok(r.h.length === h0.length && r.h.every((v, i) => Math.abs(v - h0[i]) <= 2), `${label}: 패널 높이 그대로 ${JSON.stringify(r.h)} (처음 ${JSON.stringify(h0)})`);
    await page.screenshot({ path: `/tmp/shot_longtf_${tf}.png`, timeout: 15000 }).catch(() => {});
  }
  // 차트를 한 번 누르면(경계 끌고 놓기와 같음) 높이를 저장 → 새로 열어도 그대로
  const cb = await page.evaluate(() => { const r = document.querySelector('#chart').getBoundingClientRect(); return [r.left + r.width / 2, r.top + 80]; });
  await page.mouse.click(cb[0], cb[1]); await page.waitForTimeout(200);
  await page.reload();
  await page.waitForFunction(() => typeof CH !== 'undefined' && CH.data && CH.data.N > 500, null, { timeout: 30000 }); await page.waitForTimeout(800);
  const hR = await page.evaluate(() => CH.chart.panes().map(p => p.getHeight()));
  ok(hR.every((v, i) => Math.abs(v - h0[i]) <= 2), `새로 열어도 패널 높이 그대로 ${JSON.stringify(hR)}`);
  // 상장 6개월 된 종목의 월봉·년봉
  await page.evaluate(() => UI.openChart('BINANCE:NEWUSDT'));
  await page.waitForFunction(() => CH.state.key === 'BINANCE:NEWUSDT' && CH.data.N > 0, null, { timeout: 30000 }); await page.waitForTimeout(600);
  for (const [tf, label] of [['1M', '새 종목 월봉 (6개)'], ['1y', '새 종목 년봉 (1개)']]) {
    await pick(tf);
    const r = await look();
    ok(r.vr && r.x0 - r.sp / 2 >= -1, `${label}: 첫 봉 안 잘림 (x0=${r.x0 && r.x0.toFixed(0)}, 폭 ${r.sp.toFixed(0)}px)`);
    ok(r.sp <= 60 && r.xN > r.w * 0.5, `${label}: 봉 폭 ${r.sp.toFixed(0)}px · 마지막 봉이 오른쪽 쪽 (x=${r.xN && r.xN.toFixed(0)}/${r.w})`);
    await page.screenshot({ path: `/tmp/shot_new_${tf}.png`, timeout: 15000 }).catch(() => {});
  }
  // TOP2 홈페이지 차트 메뉴처럼 링크로 열기
  await page.goto('http://app.test/index.html?symbol=NEWUSDT.P&tf=1w');
  await page.waitForFunction(() => typeof CH !== 'undefined' && CH.state.key === 'BINANCE:NEWUSDT' && CH.state.tf === '1w' && CH.data.N > 0, null, { timeout: 30000 }).catch(() => {});
  const lk = await page.evaluate(() => ({ key: CH.state.key, tf: CH.state.tf, url: location.search, bar: document.querySelector('#tfBar .tb.on')?.dataset.tf }));
  ok(lk.key === 'BINANCE:NEWUSDT' && lk.tf === '1w' && lk.bar === '1w' && lk.url === '', `링크로 열기 ?symbol=NEWUSDT.P&tf=1w → ${lk.key} ${lk.tf} · 주소 정리됨(${JSON.stringify(lk.url)})`);
  // 차트가 숨어 있을 때(다른 화면·숨은 탭) 월봉을 열고 나중에 보이면: 봉이 오른쪽 끝에 몰리지 않아야 함
  const hid = await page.evaluate(async () => {
    const vc = document.getElementById('viewChart'); vc.hidden = true;
    await CH.load('BINANCE:BTCUSDT', '1M');
    const hiddenW = CH.chart.timeScale().width();
    vc.hidden = false;
    await new Promise(r => setTimeout(r, 900));
    const ts = CH.chart.timeScale(), r = ts.getVisibleLogicalRange(), n = CH.data.N;
    const x0 = ts.logicalToCoordinate(0);
    return { hiddenW, n, from: r.from, to: r.to, sp: ts.options().barSpacing, x0, w: ts.width() };
  });
  ok(hid.hiddenW === 0 && hid.to - hid.from < hid.n + 20 && hid.sp >= 2 && hid.x0 > 0 && hid.x0 < hid.w * 0.3,
    `숨은 채로 월봉을 열고 나중에 보여도 봉이 폭을 채움 (봉 ${hid.n}개, 보이는 칸 ${(hid.to - hid.from).toFixed(1)}, 봉 폭 ${hid.sp.toFixed(1)}px, 첫 봉 x=${hid.x0 && hid.x0.toFixed(0)}/${hid.w})`);
  // 다른 화면에 있다가 차트 화면으로 돌아와도 (화면 버튼 → render(true))
  const hid2 = await page.evaluate(async () => {
    document.querySelector('#views [data-view="scan"]').click();
    await CH.load('BINANCE:BTCUSDT', '1y');
    document.querySelector('#views [data-view="chart"]').click();
    await new Promise(r => setTimeout(r, 900));
    const ts = CH.chart.timeScale(), r = ts.getVisibleLogicalRange();
    return { n: CH.data.N, span: r.to - r.from, sp: ts.options().barSpacing, x0: ts.logicalToCoordinate(0), w: ts.width() };
  });
  ok(hid2.span < Math.max(hid2.n + 20, hid2.w / 40 + 2) && hid2.x0 > 0 && hid2.sp <= 41,
    `스캐너 화면에서 년봉을 열고 차트 화면으로 와도 정상 (봉 ${hid2.n}개, 보이는 칸 ${hid2.span.toFixed(1)}, 봉 폭 ${hid2.sp.toFixed(1)}px)`);
  const lists1 = await page.evaluate(() => JSON.parse(localStorage.getItem('mc.v1')).lists);
  ok(JSON.stringify(lists1) === JSON.stringify(listsStart), '끝까지 관심목록 그대로 (' + lists1.map(l => l.name + ' ' + l.items.length).join(' · ') + ')');
  ok(errs.length === 0, '페이지 오류 없음 ' + JSON.stringify(errs.slice(0, 3)));
  await browser.close().catch(() => {});
}
const LISTS = [
  { name: '내 관심목록', items: ['BINANCE:BTCUSDT', 'COINBASE:BTCUSD', 'YAHOO:NDAQ', 'BINANCE:ETHUSDT', '###선물·지수', 'YAHOO:CL=F', 'YAHOO:SI=F', '###한국', 'YAHOO:005930.KS', '###새 구역', 'YAHOO:NVDA', 'YAHOO:TSLA', 'YAHOO:AAPL'] },
  { name: '★ 즐겨찾기', items: ['BINANCE:BTCUSDT', 'YAHOO:NVDA'] }];
run(LISTS).then(() => process.exit(process.exitCode || 0)).catch(e => { console.error('E2E FAIL', e); process.exit(1); });
