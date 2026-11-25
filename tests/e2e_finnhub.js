// 미국 주식 실시간(Finnhub) 점검: 가짜 Finnhub(REST·웹소켓) + 가짜 PC 서버로 화면을 돌려 봄
// 준비: npm i playwright lightweight-charts@5.2.1 · 실행: node tests/e2e_finnhub.js
let pw; try { pw = require('playwright'); } catch { pw = require('/opt/npm-tools/node_modules/playwright'); }
const fs = require('fs'), path = require('path');
const HTML = path.join(__dirname, '..', 'index.html');
const LWC = fs.readFileSync(path.join(path.dirname(require.resolve('lightweight-charts/package.json')), 'dist/lightweight-charts.standalone.production.js'), 'utf8');
const GOOD = 'goodkey123456', T0 = Date.parse('2026-11-24T20:55:00Z');   // 마지막 5분봉 = 뉴욕 15:55 (정규장)
const BASE = { AAPL: 350, NVDA: 150, 'BRK.B': 480, SPY: 600 };
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

async function run(withServer) {
  const browser = await pw.chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = [], subs = new Set(), wsUrls = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errs.push(m.text().slice(0, 200)); });
  let tick = 0;
  await page.routeWebSocket(/.*/, ws => {
    const url = ws.url();
    if (!url.startsWith('wss://ws.finnhub.io')) return;   // 바이낸스 등은 그냥 열리지 않게 둠
    wsUrls.push(url);
    if (!url.includes(GOOD)) { setTimeout(() => ws.send(JSON.stringify({ type: 'error', msg: 'Invalid API key' })), 50); return; }
    const mine = new Set();
    ws.onMessage(m => { const o = JSON.parse(m); if (o.type === 'subscribe') { mine.add(o.symbol); subs.add(o.symbol); } if (o.type === 'unsubscribe') mine.delete(o.symbol); });
    const iv = setInterval(() => {
      if (!mine.size) return; tick++;
      // 정규장 시각(T0 + 1~4분)의 체결 · 가격은 매번 조금씩 오름
      ws.send(JSON.stringify({ type: 'trade', data: [...mine].map(s => ({ s, p: +(BASE[s] + tick * 0.01).toFixed(2), t: T0 + 60000 + (tick % 180) * 1000, v: 10, c: ['1'] })) }));
    }, 150);
    ws.onClose(() => clearInterval(iv));
  });
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    const json = (o, st = 200) => route.fulfill({ status: st, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-private-network': 'true' }, body: JSON.stringify(o) });
    if (u.host === 'app.test') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(HTML) });
    if (u.href.includes('lightweight-charts')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: LWC });
    if (u.host === 'finnhub.io') { const t = u.searchParams.get('token'), s = u.searchParams.get('symbol'); if (t !== GOOD) return json({ error: 'Invalid API key' }, 401); return json({ c: BASE[s] || 10, pc: (BASE[s] || 10) * 0.98, d: 1, dp: 2.04, t: T0 / 1000 }); }
    if (withServer && u.host === 'localhost:8000') {
      if (u.pathname === '/api/ping') return json({ ok: true, yfinance: '0.2.66', version: '2026-12-01' });
      if (u.pathname === '/api/yf/quotes') { const o = {}; for (const s of (u.searchParams.get('symbols') || '').split(',')) { const b = BASE[s.replace('-', '.')] || 10; o[s] = { price: b - 1, prev: b * 0.98, chgPct: 1 }; } return json(o); }
      if (u.pathname === '/api/yf/klines') {
        const tf = u.searchParams.get('tf'), sec = { '5m': 300, '1d': 86400, '1h': 3600 }[tf] || 300, n = u.searchParams.get('recent') ? 3 : 300, b = BASE[(u.searchParams.get('symbol') || '').replace('-', '.')] || 10, bars = [];
        const last = tf === '1d' ? Date.parse('2026-11-24T05:00:00Z') : T0;
        for (let i = n - 1; i >= 0; i--) { const t = last - i * sec * 1000, c = b - 1 + Math.sin(i / 5); bars.push([t, c, c + 0.5, c - 0.5, c, 1000, t + sec * 1000 - 1, 1000 * c]); }
        return json({ symbol: u.searchParams.get('symbol'), tf, meta: { currency: 'USD', longName: 'Test' }, bars });
      }
      return json({});
    }
    if (u.pathname.endsWith('/exchangeInfo')) return json({ symbols: [] });
    if (u.pathname.endsWith('/klines')) return json([]);
    return json({}, 404);
  });
  await page.addInitScript(([good, server]) => {
    if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    localStorage.setItem('mc.finnhubKey', good);
    if (server) localStorage.setItem('mc.useLocal', '1');
  }, [GOOD, withServer]);
  await page.goto('http://app.test/index.html');
  await page.waitForFunction(() => typeof UI !== 'undefined' && typeof USRT !== 'undefined', null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  // 관심목록에 미국 주식 넣고 AAPL 열기
  await page.evaluate(() => { const L = UI.curList(); L.items.unshift('YAHOO:AAPL', 'YAHOO:NVDA', 'YAHOO:BRK-B', 'YAHOO:GC=F'); UI.save(); UI.ST.tf = '5m'; UI.openChart('YAHOO:AAPL'); });
  await page.waitForTimeout(4000);
  const r = await page.evaluate(() => {
    const row = k => { const el = document.querySelector(`#list .row[data-key="${k}"]`); return el ? { pk: el.dataset.pk, p: el.querySelector('.p').textContent, c: el.querySelector('.c').textContent } : null; };
    return { key: UI.ST.key, st: USRT.status, count: USRT.count, trades: USRT.trades, aapl: row('YAHOO:AAPL'), nvda: row('YAHOO:NVDA'), brk: row('YAHOO:BRK-B'), gc: row('YAHOO:GC=F'),
      px: UI.px['YAHOO:AAPL'], lastC: CH.data && CH.data.N ? CH.data.C[CH.data.N - 1] : null, lastT: CH.data && CH.data.N ? CH.data.T[CH.data.N - 1] : null, kind: document.querySelector('.live') ? document.querySelector('.live').textContent : '' };
  });
  console.log(withServer ? '\n[PC 서버 있음]' : '\n[PC 서버 없음 · 홈페이지]', JSON.stringify(r));
  ok(r.st === 'on', 'Finnhub 웹소켓 연결됨');
  ok(['AAPL', 'NVDA', 'BRK.B'].every(s => subs.has(s)) && !subs.has('GC=F'), '미국 주식만 구독 (BRK-B → BRK.B, 금 선물 제외): ' + [...subs].join(','));
  ok(r.aapl && r.aapl.pk === 'YAHOO:AAPL' && parseFloat(r.aapl.p.replace(/,/g, '')) > 350, '관심목록 AAPL 가격이 체결로 움직임: ' + (r.aapl && r.aapl.p));
  ok(r.px && r.px.live === 'finnhub' && r.px.prev > 0 && Math.abs(r.px.chgPct - (r.px.price / r.px.prev - 1) * 100) < 1e-9, '변동%는 전일 종가 기준: ' + (r.px && r.px.chgPct && r.px.chgPct.toFixed(2)));
  if (withServer) {
    ok(r.key === 'YAHOO:AAPL', '차트가 AAPL(야후) 그대로');
    ok(r.lastT === Math.floor(T0 / 1000) && r.lastC > 350, '정규장 체결로 지금 5분봉 종가가 바뀜: ' + r.lastC);
  } else ok(r.key !== 'YAHOO:AAPL' || r.lastC == null, '서버 없으면 차트는 기존대로 (대체 종목 또는 안내): ' + r.key);
  // 잘못된 키는 저장 안 됨 (설정 창)
  await page.click('#menuBtn'); await page.waitForTimeout(300);
  await page.locator('text=미국 주식 실시간 (Finnhub)').first().click(); await page.waitForTimeout(300);
  await page.fill('#fhKey', 'badkey9999999'); await page.click('#fhSave');
  await page.waitForTimeout(2500);
  const res = await page.evaluate(() => ({ msg: document.querySelector('#fhRes')?.textContent, key: localStorage.getItem('mc.finnhubKey') }));
  ok(res.key === GOOD && /저장하지 않았습니다/.test(res.msg), '잘못된 키는 거절: ' + res.msg);
  // 키 지우기 → 구독 끊김, 백업에 키 없음
  await page.click('#fhOff'); await page.waitForTimeout(800);
  const gone = await page.evaluate(() => ({ on: USRT.on(), st: USRT.status, ls: localStorage.getItem('mc.finnhubKey'), inState: JSON.stringify(UI.ST).includes('goodkey') }));
  ok(!gone.on && gone.ls === null && gone.st === 'off' && !gone.inState, '키 지우기 · 상태 저장(백업)에 키 없음');
  ok(errs.length === 0, '페이지 오류 없음 ' + JSON.stringify(errs.slice(0, 3)));
  if (withServer) await page.screenshot({ path: '/tmp/shot_finnhub.png' });
  await browser.close();
}
(async () => { await run(false); await run(true); })().catch(e => { console.error('E2E FAIL', e); process.exit(1); });
